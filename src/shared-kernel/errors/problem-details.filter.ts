// src/shared-kernel/errors/problem-details.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from './domain-error';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  correlationId?: string;
}

/**
 * Single global filter, per Phase 5.7 / 7.6 — every error response, whether
 * a domain error or an unexpected exception, comes out shaped as RFC 7807.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);
  private static readonly BASE_URL = 'https://api.ratel-plus.com/errors';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = (request.headers['x-correlation-id'] as string) ?? undefined;

    const problem = this.toProblemDetails(exception, request.url, correlationId);

    if (problem.status >= 500) {
      this.logger.error(problem.detail, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblemDetails(
    exception: unknown,
    instance: string,
    correlationId?: string,
  ): ProblemDetails {
    if (exception instanceof DomainError) {
      return {
        type: `${ProblemDetailsFilter.BASE_URL}/${exception.code}`,
        title: exception.name,
        status: exception.httpStatus,
        detail: exception.message,
        instance,
        correlationId,
      };
    }

    if (exception instanceof HttpException) {
      return {
        type: `${ProblemDetailsFilter.BASE_URL}/http-error`,
        title: exception.name,
        status: exception.getStatus(),
        detail: exception.message,
        instance,
        correlationId,
      };
    }

    return {
      type: `${ProblemDetailsFilter.BASE_URL}/internal-server-error`,
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance,
      correlationId,
    };
  }
}