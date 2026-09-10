// src/notifications/templates/email-layout.ts
//
// One shared HTML shell every notification template renders into, so
// "modern, professional email" is a property of this file, not of each of
// the 7 (and future) templates individually. A new template only supplies
// a heading, a tone, a badge glyph, and a body — the letterhead, footer,
// spacing, and cross-client quirks live here exactly once.
//
// Deliberately table-based layout + inline styles throughout, not a
// `<style>`-block/class-based design: this is email HTML, not a browser
// page. Outlook desktop (Word rendering engine) and a long tail of other
// clients strip `<style>` blocks and ignore flexbox/grid entirely, but
// every client renders `<table>`/inline `style=""` consistently — that's
// the actual, still-current constraint that makes table layout the
// professional default for transactional email, not a browser-era holdover
// choice. `RATEL_LOGO_CID` renders via a CID attachment
// (notification.processor.ts) rather than a data: URI or hosted URL — see
// ratel-logo.ts for why.
import { RATEL_LOGO_CID } from '../assets/ratel-logo';

export type EmailTone = 'success' | 'danger' | 'info';

const BRAND = {
  navy: '#00266B',
  navyDark: '#001845',
  green: '#00913A',
  red: '#E30016',
  gold: '#FCC024',
  bodyText: '#3C4257',
  mutedText: '#6B7280',
  pageBg: '#F1F4F9',
  cardBg: '#FFFFFF',
  detailsBg: '#F8FAFC',
  border: '#E5E9F0',
};

const TONE_COLORS: Record<EmailTone, { accent: string; badgeBg: string }> = {
  success: { accent: BRAND.green, badgeBg: BRAND.green },
  danger: { accent: BRAND.red, badgeBg: BRAND.red },
  info: { accent: BRAND.navy, badgeBg: BRAND.navy },
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailLayoutOptions {
  /** Short summary shown as the inbox preview snippet, never the visible heading. */
  preheader: string;
  tone: EmailTone;
  /** A single character/glyph rendered inside the circular badge — kept to plain
   * typographic symbols (✓ ✕ i), never emoji, for consistent rendering across
   * clients/OSes (a well-documented email-design gotcha: emoji glyph coverage and
   * color varies wildly by client and platform, plain symbols don't). */
  badgeGlyph: string;
  heading: string;
  /** Pre-rendered inner HTML — the body copy, details table, and any callout box. */
  bodyHtml: string;
}

/**
 * A labeled-row "details card" — the shared building block every template
 * uses instead of burying data inline in a sentence (the old design's
 * "Expense EXP-1 for NGN 2500.00 was approved by <uuid>" problem: dense,
 * hard to scan, and it's what let a raw ID slip into prose unnoticed).
 * Rows are `{label, value}` pairs; `value` must already be HTML-escaped by
 * the caller (Handlebars does this automatically for `{{var}}`).
 */
export function detailsCard(rows: Array<{ label: string; value: string }>): string {
  const rowsHtml = rows
    .map(
      (row, i) => `
        <tr>
          <td style="padding:${i === 0 ? '0' : '10px'} 0 0 0;font-family:${FONT_STACK};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.mutedText};">
            ${row.label}
          </td>
        </tr>
        <tr>
          <td style="padding:2px 0 ${i === rows.length - 1 ? '0' : '10px'} 0;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:${BRAND.navyDark};border-bottom:${i === rows.length - 1 ? 'none' : `1px solid ${BRAND.border}`};padding-bottom:${i === rows.length - 1 ? '0' : '10px'};">
            ${row.value}
          </td>
        </tr>`,
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:${BRAND.detailsBg};border:1px solid ${BRAND.border};border-radius:8px;margin:24px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>`;
}

/** A tinted callout box for a reason/explanation that needs to stand out from
 * ordinary body copy — used for rejection reasons and reopen reasons. */
export function calloutBox(label: string, value: string, tone: EmailTone): string {
  const { accent } = TONE_COLORS[tone];
  const tint = tone === 'danger' ? '#FEF2F2' : tone === 'success' ? '#F0FAF3' : '#F0F4FC';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:${tint};border-left:3px solid ${accent};border-radius:4px;margin:0 0 24px 0;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0 0 4px 0;font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${accent};">
            ${label}
          </p>
          <p style="margin:0;font-family:${FONT_STACK};font-size:15px;line-height:1.5;color:${BRAND.bodyText};">
            ${value}
          </p>
        </td>
      </tr>
    </table>`;
}

export function wrapEmailLayout(options: EmailLayoutOptions): string {
  const { accent, badgeBg } = TONE_COLORS[options.tone];
  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<meta name="x-apple-disable-message-reformatting" />
<title>${options.heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.pageBg};-webkit-text-size-adjust:100%;">
  <!-- Preheader: sets the inbox preview snippet, never rendered visibly. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.pageBg};">
    ${options.preheader}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:600px;background:${BRAND.cardBg};border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};">

          <!-- Tone accent bar -->
          <tr>
            <td style="background:${accent};height:5px;line-height:5px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding:32px 40px 8px 40px;">
              <img src="cid:${RATEL_LOGO_CID}" width="140" alt="Ratel-Plus" style="display:block;width:140px;max-width:60%;height:auto;border:0;" />
            </td>
          </tr>

          <!-- Icon badge -->
          <tr>
            <td align="center" style="padding:16px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" height="56" align="center" valign="middle"
                    style="width:56px;height:56px;border-radius:28px;background:${badgeBg};font-family:${FONT_STACK};font-size:26px;line-height:56px;color:#ffffff;font-weight:700;">
                    ${options.badgeGlyph}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding:20px 40px 0 40px;">
              <h1 style="margin:0;font-family:${FONT_STACK};font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.navyDark};">
                ${options.heading}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:16px 40px 40px 40px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${BRAND.bodyText};">
              ${options.bodyHtml}
            </td>
          </tr>

          <!-- Footer (inside card, separated) -->
          <tr>
            <td style="padding:24px 40px;background:${BRAND.detailsBg};border-top:1px solid ${BRAND.border};">
              <p style="margin:0 0 4px 0;font-family:${FONT_STACK};font-size:13px;font-weight:700;color:${BRAND.navy};">
                Ratel-Plus Nigeria Ltd
              </p>
              <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${BRAND.mutedText};">
                This is an automated message from the Ratel-Plus financial platform — please don't reply directly to this email.
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td align="center" style="padding:20px 16px 0 16px;font-family:${FONT_STACK};font-size:12px;color:${BRAND.mutedText};">
              &copy; ${year} Ratel-Plus Nigeria Ltd. All rights reserved.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
