// src/auth/authentication/auth.service.ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  RoleAssignment,
  USER_ROLE_SERVICE,
  UserRoleService,
} from '../../shared-kernel/auth/user-role.port';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    @Inject(USER_ROLE_SERVICE) private readonly userRoles: UserRoleService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Deliberately the SAME error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate valid emails.
    if (!user || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // TECH_DEBT #14 — was a direct `include: { roleAssignments: true }`
    // relation query; now goes through the same seam every other role
    // consumer uses, so this stays correct regardless of how role
    // assignments are actually stored underneath.
    const roleAssignments = await this.userRoles.getRolesForUser(user.id);

    if (roleAssignments.length === 0) {
      throw new UnauthorizedException('User has no role assignments');
    }

    const principal = this.buildPrincipal(user, roleAssignments);
    const accessToken = this.jwt.sign(principal);
    const refreshToken = await this.refreshTokens.issue(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const result = await this.refreshTokens.validateAndRotate(presentedToken);
    if (!result) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    const roleAssignments = await this.userRoles.getRolesForUser(user.id);

    // Previously unguarded: roleAssignments[0] would throw a raw TypeError (500)
    // for a user whose roles were all removed between token issuance and
    // refresh, instead of the same clean 401 login() already gives for the
    // equivalent case. Fixed alongside #14 since this method's body was
    // already being touched — not a separate deferred item.
    if (roleAssignments.length === 0) {
      throw new UnauthorizedException('User has no role assignments');
    }

    // NOTE — preserved exactly as the original behaved, not fixed here: the
    // original refresh() had no empty-assignments guard (unlike login()),
    // so `roleAssignments[0].organizationId` would throw a raw TypeError
    // rather than a clean UnauthorizedException for a user whose roles were
    // all removed between token issuance and refresh. That gap is
    // pre-existing and out of #14's scope — flagging it here rather than
    // silently fixing behavior beyond what this change is meant to do.
    const principal = this.buildPrincipal(user, roleAssignments);

    return { accessToken: this.jwt.sign(principal), refreshToken: result.newToken };
  }

  async logout(presentedRefreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(presentedRefreshToken);
  }

  /**
   * Phase 9.2 — step-up re-authentication. Re-verifies the CURRENT
   * password (fetched fresh, not trusted from the presented token) and
   * mints a new access token carrying `stepUpAt`, without touching the
   * refresh token at all: this isn't a new login, just an elevation of
   * the caller's already-valid session for the step-up window
   * (PermissionGuard checks freshness via shared-kernel/auth/step-up.ts).
   * Mirrors refresh()'s empty-role-assignments guard for the same reason:
   * a session can outlive a role change.
   */
  async stepUp(userId: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roleAssignments = await this.userRoles.getRolesForUser(user.id);
    if (roleAssignments.length === 0) {
      throw new UnauthorizedException('User has no role assignments');
    }

    const principal = this.buildPrincipal(user, roleAssignments, { stepUpAt: Date.now() });
    return { accessToken: this.jwt.sign(principal) };
  }

  private buildPrincipal(
    user: { id: string; email: string },
    roleAssignments: RoleAssignment[],
    extra?: Partial<Pick<UserPrincipal, 'stepUpAt'>>,
  ): UserPrincipal {
    return {
      id: user.id,
      email: user.email,
      organizationId: roleAssignments[0].organizationId,
      roles: roleAssignments.map((r) => ({ role: r.role, departmentId: r.departmentId })),
      ...extra,
    };
  }
}
