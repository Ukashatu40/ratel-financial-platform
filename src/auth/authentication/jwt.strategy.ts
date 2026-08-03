// src/auth/authentication/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../../config/env.schema';
import { requireConfig } from '../../config/require-config';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<EnvConfig>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireConfig(config, 'JWT_ACCESS_SECRET'),
    });
  }

  // Whatever this returns becomes req.user — the payload was already
  // constructed and signed correctly at login time (AuthService below), so
  // this just passes it through, trusting the signature verification
  // passport-jwt already performed before calling validate().
  async validate(payload: UserPrincipal): Promise<UserPrincipal> {
    return payload;
  }
}
