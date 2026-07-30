// src/app.controller.ts
import { Controller, Get } from '@nestjs/common';

/**
 * Minimal liveness/readiness endpoint so M0/M1 can be verified as actually
 * booting end-to-end. Gets superseded by a proper health module (DB/Redis
 * connectivity checks) in Phase 11 — this is intentionally bare for now.
 */
@Controller()
export class AppController {
  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}