// src/auth/authentication/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roleAssignments: true },
    });

    // Deliberately the SAME error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate valid emails.
    if (!user || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.roleAssignments.length === 0) {
      // A user with zero role assignments has no organizationId to derive
      // (v1's single-tenant assumption: organizationId comes from role
      // assignments, not a direct user.organizationId column — see
      // TECH_DEBT for the multi-org implication of this).
      throw new UnauthorizedException('User has no role assignments');
    }

    const principal: UserPrincipal = {
      id: user.id,
      email: user.email,
      organizationId: user.roleAssignments[0].organizationId,
      roles: user.roleAssignments.map((r) => ({ role: r.role, departmentId: r.departmentId })),
    };

    const accessToken = this.jwt.sign(principal);
    const refreshToken = await this.refreshTokens.issue(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const result = await this.refreshTokens.validateAndRotate(presentedToken);
    if (!result) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { roleAssignments: true },
    });

    const principal: UserPrincipal = {
      id: user.id,
      email: user.email,
      organizationId: user.roleAssignments[0].organizationId,
      roles: user.roleAssignments.map((r) => ({ role: r.role, departmentId: r.departmentId })),
    };

    return { accessToken: this.jwt.sign(principal), refreshToken: result.newToken };
  }

  async logout(presentedRefreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(presentedRefreshToken);
  }
}
