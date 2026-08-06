// src/auth/auth.module.ts
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';
import { EnvConfig } from '../config/env.schema';
import { requireConfig } from '../config/require-config';
import { JwtStrategy } from './authentication/jwt.strategy';
import { JwtAuthGuard } from './authentication/jwt-auth.guard';
import { AuthService } from './authentication/auth.service';
import { RefreshTokenService } from './authentication/refresh-token.service';
import { PermissionGuard } from './authorization/permission.guard';
import { AuthController } from './presentation/controllers/auth.controller';
import { USER_ROLE_SERVICE } from '../shared-kernel/auth/user-role.port';
import { PrismaUserRoleService } from './authorization/prisma-user-role.service';
import { EFFECTIVE_SCOPE_RESOLVER } from '../shared-kernel/auth/effective-scope-resolver.port';
import { PrismaEffectiveScopeResolver } from './authorization/prisma-effective-scope.resolver';

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig>) => ({
        secret: requireConfig(config, 'JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: requireConfig(config, 'JWT_ACCESS_TTL') as StringValue },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    PermissionGuard,
    AuthService,
    RefreshTokenService,
    { provide: USER_ROLE_SERVICE, useClass: PrismaUserRoleService },
    { provide: EFFECTIVE_SCOPE_RESOLVER, useClass: PrismaEffectiveScopeResolver },
  ],
  exports: [JwtAuthGuard, PermissionGuard, USER_ROLE_SERVICE, EFFECTIVE_SCOPE_RESOLVER],
})
export class AuthModule {}
