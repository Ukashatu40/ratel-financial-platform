// src/auth/authentication/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user; // populated by JwtAuthGuard -> JwtStrategy.validate()
  },
);
