// src/shared-kernel/notifications/email-provider.port.ts

/** A CID-embedded inline image (e.g. the logo) — `cid` is what `<img src="cid:...">`
 * in the HTML references, matched to this attachment by the mail client. */
export interface EmailInlineAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailInlineAttachment[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
