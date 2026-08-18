// src/notifications/infrastructure/console-sms-provider.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { SmsMessage, SmsProvider } from '../../shared-kernel/notifications/sms-provider.port';

/**
 * NOT a real SMS integration — no Twilio/MSG91/VOS3000 account exists to
 * integrate against, matching this build's practice of being honest rather
 * than half-building an unverifiable integration (same discipline as
 * Attachment.scanStatus: 'unscanned' — visibly under-deliver rather than
 * silently claim a capability that doesn't exist). Logs what WOULD have
 * been sent, at a distinct log prefix, so it's unmistakable in output.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(message: SmsMessage): Promise<void> {
    this.logger.warn(
      `[SMS NOT ACTUALLY SENT — no provider integrated] to=${message.to}: "${message.body}"`,
    );
  }
}
