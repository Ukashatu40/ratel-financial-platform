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

interface ResponseWithMessage {
  message: unknown;
}

function hasMessage(response: unknown): response is ResponseWithMessage {
  return typeof response === 'object' && response !== null && 'message' in response;
}

/**
 * Single global filter, per Phase 5.7 / 7.6 — every error response, whether
 * a domain error or an unexpected exception, comes out shaped as RFC 7807.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);
  private static readonly BASE_URL = 'https://api.ratel-plus.com/errors';

  /**
   * Terminus's HealthCheckService throws HttpException with a response body
   * shaped like {status, info, error, details} — NOT the {message: [...]}
   * shape validation errors use. Health-check payloads have their own
   * well-established convention (consumed by orchestrators, monitoring
   * dashboards, anything Terminus-aware) that's more useful diagnostically
   * than RFC 7807 would be here — flattening it into `detail` string would
   * destroy exactly the "which dependency failed" information a readiness
   * endpoint exists to surface.
   */
  private isTerminusHealthResult(response: unknown): response is {
    status: string;
    info: unknown;
    error: unknown;
    details: unknown;
  } {
    return (
      typeof response === 'object' &&
      response !== null &&
      'status' in response &&
      'info' in response &&
      'error' in response &&
      'details' in response
    );
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (this.isTerminusHealthResult(body)) {
        // Send Terminus's own shape untouched, at its own status code —
        // bypass the RFC 7807 transformation entirely for this one case.
        response.status(exception.getStatus()).send(body);
        return;
      }
    }

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
      const response = exception.getResponse();
      const detail = hasMessage(response)
        ? Array.isArray(response.message)
          ? response.message.join('; ')
          : String(response.message)
        : exception.message;

      return {
        type: `${ProblemDetailsFilter.BASE_URL}/http-error`,
        title: exception.name,
        status: exception.getStatus(),
        detail,
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
