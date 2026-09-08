// src/idempotency/idempotency.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { EnvConfig } from '../config/env.schema';
import {
  IdempotencyKeyInProgressError,
  InvalidIdempotencyKeyError,
} from '../shared-kernel/errors/domain-error';
import { UserPrincipal } from '../shared-kernel/auth/user-principal';
import { CachedResponse, IdempotencyStoreService } from './idempotency-store.service';
import {
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_MAX_KEY_LENGTH,
  IDEMPOTENCY_REPLAYED_HEADER,
} from './idempotency.constants';

const MUTATING_METHODS = new Set(['POST', 'PATCH']);

/**
 * Global (bound via APP_INTERCEPTOR, idempotency.module.ts), but a no-op
 * for the vast majority of requests: it only does anything for POST/PATCH
 * requests that actually send an `Idempotency-Key` header — every other
 * request passes through with zero Redis calls. "Every mutating endpoint
 * accepts" (Phase 7.5) means opt-in support everywhere, not a requirement,
 * so no controller needs to remember to wire this up individually — the
 * same reasoning #40's global PermissionGuard and rate-limit.module.ts's
 * global ThrottlerGuard already established in this codebase.
 *
 * Deliberately caches only SUCCESSFUL (2xx) responses. The risk this
 * feature protects against — a network retry double-creating a resource —
 * is specifically a success-path problem: a failed request didn't create
 * anything to duplicate, and a genuinely-failing mutation (e.g. "period
 * closed") will fail the same way again on retry regardless of caching.
 * Caching errors would also mean replaying a transient failure (a dropped
 * DB connection, say) indefinitely for the TTL even after the underlying
 * problem is fixed. On failure the claim is released instead, so a retry
 * with the same key gets a fresh, real attempt.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly store: IdempotencyStoreService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<EnvConfig>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    const header = request.headers[IDEMPOTENCY_KEY_HEADER];
    if (!header) return next.handle();

    const rawKey = Array.isArray(header) ? header[0] : header;
    if (rawKey.length === 0) {
      throw new InvalidIdempotencyKeyError('must not be empty');
    }
    if (rawKey.length > IDEMPOTENCY_MAX_KEY_LENGTH) {
      throw new InvalidIdempotencyKeyError(`must be at most ${IDEMPOTENCY_MAX_KEY_LENGTH} characters`);
    }

    const key = this.buildRedisKey(context, request, rawKey);
    const lockTtlMs =
      this.config.get('IDEMPOTENCY_LOCK_TTL_MS', { infer: true }) ?? IDEMPOTENCY_DEFAULTS.LOCK_TTL_MS;
    const responseTtlMs =
      this.config.get('IDEMPOTENCY_RESPONSE_TTL_MS', { infer: true }) ??
      IDEMPOTENCY_DEFAULTS.RESPONSE_TTL_MS;

    return from(this.store.claim(key, lockTtlMs)).pipe(
      switchMap((claimed) => {
        if (claimed) return this.executeAndCache(context, next, key, responseTtlMs);
        return this.replayOrConflict(context, key);
      }),
    );
  }

  private executeAndCache(
    context: ExecutionContext,
    next: CallHandler,
    key: string,
    responseTtlMs: number,
  ): Observable<unknown> {
    const statusCode = this.resolveStatusCode(context);

    return next.handle().pipe(
      tap({
        next: (body) => {
          // Fire-and-forget from the response's perspective — the caller
          // already got a real answer; a failure to WRITE the cache entry
          // just means the next retry re-executes instead of replaying,
          // the same outcome as if no key had been sent at all. Logged by
          // the store's own error handling if the connection is down.
          void this.store.complete(key, { status: statusCode, body }, responseTtlMs);
        },
      }),
      catchError((err) => {
        void this.store.release(key);
        throw err;
      }),
    );
  }

  private replayOrConflict(context: ExecutionContext, key: string): Observable<unknown> {
    return from(this.store.read(key)).pipe(
      switchMap((entry) => {
        if (entry === 'in-progress' || entry === null) {
          // null is a genuine race: the claim existed when our SET NX
          // failed but was released (the other request failed) or expired
          // between then and this read. Either way there is no cached
          // response to replay, and re-executing here would defeat the
          // lock this request just lost — surfacing the conflict is more
          // honest than silently executing a second time.
          throw new IdempotencyKeyInProgressError();
        }
        return of(this.replay(context, entry));
      }),
    );
  }

  private replay(context: ExecutionContext, entry: CachedResponse): unknown {
    const response = context.switchToHttp().getResponse<FastifyReply>();
    response.status(entry.status);
    response.header(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return entry.body;
  }

  private resolveStatusCode(context: ExecutionContext): number {
    const explicit = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    if (explicit !== undefined) return explicit;
    const method = context.switchToHttp().getRequest<FastifyRequest>().method;
    return method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }

  /**
   * Scoped by handler (so the same key value used against two different
   * endpoints can't collide, mirroring ThrottlerGuard's own per-handler
   * bucket keys) and by caller (`request.user.id` when authenticated,
   * falling back to IP for the rare unauthenticated mutating endpoint —
   * `AuthController.login`/`refresh` — so two different users' keys can't
   * collide). Safe to read `request.user` here: Nest runs ALL guards
   * (including JwtAuthGuard, which sets it) before ANY interceptor,
   * regardless of global-vs-controller registration — unlike
   * ThrottlerGuard-vs-JwtAuthGuard, which are both guards and therefore
   * ordered by registration (see TECH_DEBT #60's per-IP-not-per-user note).
   */
  private buildRedisKey(context: ExecutionContext, request: FastifyRequest, rawKey: string): string {
    const user = (request as FastifyRequest & { user?: UserPrincipal }).user;
    const scope = user?.id ?? `ip:${request.ip}`;
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    return `idempotency:${handler}:${scope}:${rawKey}`;
  }
}
