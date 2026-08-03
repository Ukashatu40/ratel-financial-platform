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
  providers: [JwtStrategy, JwtAuthGuard, PermissionGuard, AuthService, RefreshTokenService],
  exports: [JwtAuthGuard, PermissionGuard],
})
export class AuthModule {}
