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
      this.transporter = nodemailer.createTransport({
        host: this.config.get('SMTP_HOST', { infer: true }),
        port: this.config.get('SMTP_PORT', { infer: true }),
        secure: false, // Mailpit (and most local dev SMTP catchers) don't use TLS
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
    });
  }
}
