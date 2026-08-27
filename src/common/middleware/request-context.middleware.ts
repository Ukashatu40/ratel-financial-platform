// src/common/middleware/request-context.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContext } from '../../shared-kernel/context/request-context';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestLike, _res: unknown, next: () => void): void {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    const requestId = randomUUID();
    const ipAddress: string | undefined =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] as string | undefined;

    RequestContext.run({ correlationId, requestId, ipAddress, userAgent, source: 'api' }, () => {
      next();
    });
  }
}
