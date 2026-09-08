// src/auth/presentation/controllers/auth.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../../authentication/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { StepUpDto } from '../dto/step-up.dto';
import { authThrottle } from '../../../rate-limit/rate-limit.constants';
import { JwtAuthGuard } from '../../authentication/jwt-auth.guard';
import { CurrentUser } from '../../authentication/current-user.decorator';
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Phase 9.6 — stricter per-IP limit than the general 'default' throttle,
  // since login is the credential-stuffing surface. Same reasoning applies
  // to refresh: a stolen refresh token is still bounded by how many times
  // it can be tried.
  @Throttle({ default: { limit: authThrottle.limit, ttl: authThrottle.ttl } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Throttle({ default: { limit: authThrottle.limit, ttl: authThrottle.ttl } })
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto): Promise<{ success: true }> {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  // Phase 9.2 — re-enter the current password to elevate the CURRENT
  // session for the step-up window, without a fresh login. Requires an
  // already-valid access token (unlike login/refresh, which are
  // unauthenticated), and shares login/refresh's stricter throttle: an
  // attacker holding a stolen access token but not the password is still
  // running a password-guessing attack against this endpoint.
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: authThrottle.limit, ttl: authThrottle.ttl } })
  @Post('step-up')
  async stepUp(@CurrentUser() user: UserPrincipal, @Body() dto: StepUpDto) {
    return this.authService.stepUp(user.id, dto.password);
  }
}
