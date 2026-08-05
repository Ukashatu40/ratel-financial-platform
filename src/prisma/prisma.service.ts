// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  constructor(configService: ConfigService) {
    // 1. Establish the pg connection pool
    const pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
    });

    // REQUIRED by node-postgres: without this listener, an idle client
    // losing its connection (e.g. the container being stopped, a network
    // blip, Postgres restarting) emits an 'error' event with NO listener
    // attached — which Node treats as an unhandled exception and crashes
    // the whole process, exactly what happened here. This isn't optional
    // defensive code; it's the documented, required pattern for using
    // `pg.Pool` at all.
    pool.on('error', (err) => {
      const isExpectedTermination =
        err.message?.includes('terminating connection') || err.message?.includes('57P01');

      if (isExpectedTermination) {
        // Still logged — just at a lower severity, since this specific error
        // is common during graceful shutdowns/restarts and less urgent than
        // an unexpected drop. NEVER fully silent in production code, unlike
        // the test harness's swallow-entirely approach, which is only safe
        // there because we control exactly when/why the DB goes away.
        this.logger.warn(`Database connection terminated: ${err.message}`);
      } else {
        this.logger.error(`Unexpected database connection error: ${err.message}`, err.stack);
      }
    });

    // 2. Wrap it with Prisma's driver adapter
    const adapter = new PrismaPg(pool);

    // 3. Pass the adapter to the PrismaClient constructor
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
