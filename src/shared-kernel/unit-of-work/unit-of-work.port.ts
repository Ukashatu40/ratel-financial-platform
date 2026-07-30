// src/shared-kernel/unit-of-work/unit-of-work.port.ts
import { Prisma } from '@prisma/client';

export type TransactionClient = Prisma.TransactionClient;

export interface UnitOfWork {
  transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');