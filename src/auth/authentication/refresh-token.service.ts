// src/auth/authentication/refresh-token.service.ts
import { randomBytes, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EnvConfig } from '../../config/env.schema';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig>,
  ) {}

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hash(token);
    const ttlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true }) ?? 7;

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });

    return token; // plaintext returned to the client ONCE — only the hash is ever persisted (Phase 9.2)
  }

  async validateAndRotate(
    presentedToken: string,
  ): Promise<{ userId: string; newToken: string } | null> {
    const tokenHash = this.hash(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      return null;
    }

    // Rotation: revoke the presented token, issue a fresh one — limits the
    // window a stolen refresh token remains usable to a single exchange.
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const newToken = await this.issue(existing.userId);

    return { userId: existing.userId, newToken };
  }

  async revoke(presentedToken: string): Promise<void> {
    const tokenHash = this.hash(presentedToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
