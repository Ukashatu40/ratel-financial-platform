// src/shared-kernel/cqrs/command-handler.ts
export interface CommandHandler<TCommand, TResult = void> {
  execute(command: TCommand): Promise<TResult>;
}