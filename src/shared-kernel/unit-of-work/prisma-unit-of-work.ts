// src/shared-kernel/unit-of-work/prisma-unit-of-work.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionClient, UnitOfWork } from './unit-of-work.port';

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx), {
      isolationLevel: 'ReadCommitted',
      timeout: 10_000,
      maxWait: 5_000,
    });
  }
}