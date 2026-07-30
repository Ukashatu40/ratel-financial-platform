// src/shared-kernel/cqrs/query-handler.ts
export interface QueryHandler<TQuery, TResult> {
  execute(query: TQuery): Promise<TResult>;
}