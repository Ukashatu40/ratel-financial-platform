// src/idempotency/idempotency.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyStoreService } from './idempotency-store.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Module({
  providers: [
    IdempotencyStoreService,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
