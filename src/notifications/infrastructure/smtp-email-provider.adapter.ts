// src/notifications/infrastructure/smtp-email-provider.adapter.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { EnvConfig } from '../../config/env.schema';
import { EmailMessage, EmailProvider } from '../../shared-kernel/notifications/email-provider.port';

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<EnvConfig>) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const user = this.config.get('SMTP_USER', { infer: true });
      const pass = this.config.get('SMTP_PASSWORD', { infer: true });

      this.transporter = nodemailer.createTransport({
        host: this.config.get('SMTP_HOST', { infer: true }),
        port: this.config.get('SMTP_PORT', { infer: true }),
        // false works for BOTH the common transactional-provider case
        // (port 587, STARTTLS — nodemailer upgrades automatically when the
        // server advertises it) and local Mailpit (no TLS support at all).
        // SMTP_SECURE exists as an explicit override for a provider that
        // specifically wants port 465 (implicit TLS).
        secure: this.config.get('SMTP_SECURE', { infer: true }) ?? false,
        // Mailpit and other no-auth local catchers don't accept an `auth`
        // block at all — some reject the connection outright if one is
        // sent. Every real transactional provider requires it. Omitting
        // the key entirely (not passing `auth: undefined`) when either
        // credential is unset keeps local dev working exactly as before.
        ...(user && pass ? { auth: { user, pass } } : {}),
      });
    }
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.config.get('SMTP_FROM', { infer: true }),
      to: message.to,
      subject: message.subject,
      html: message.html,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
    });
  }
}
