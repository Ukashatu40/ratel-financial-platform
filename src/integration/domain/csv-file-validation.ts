// src/integration/domain/csv-file-validation.ts
import { DomainError } from '../../shared-kernel/errors/domain-error';

/**
 * Upload-time gate for "is this actually a CSV file?" (TECH_DEBT #25).
 *
 * Before this, any uploaded bytes were accepted as CSV and only failed later
 * inside the worker with a generic parse error — safe, but it meant an
 * accidentally-uploaded .xlsx produced an ImportJob that sat in `failed`, and
 * it meant the app took the client's declared file type entirely on trust.
 *
 * Two checks, in order of how much they can be trusted:
 *  1. The DECLARED content type, which is client-supplied and therefore only
 *     a cheap first filter — it can catch an honest mistake but never a
 *     deliberate one.
 *  2. The actual CONTENT, which is the real gate: known binary signatures and
 *     NUL bytes are rejected regardless of what the client claimed.
 *
 * Deliberately does NOT validate CSV *structure* (headers, column count,
 * delimiters). `CsvProviderAdapter` already owns that and produces better,
 * mapping-aware messages; duplicating it here would recreate exactly the
 * drift risk TECH_DEBT #22/#37 closed.
 */

export class UnsupportedImportFileError extends DomainError {
  readonly code = 'unsupported-import-file';
  readonly httpStatus = 400;

  constructor(problems: string[]) {
    super(`Uploaded file was rejected: ${problems.join('; ')}`);
  }
}

/**
 * Ambiguous-but-legitimate types are allowed on purpose. Real clients label
 * the same .csv file `text/csv`, `application/vnd.ms-excel` (Windows, where
 * Excel owns the extension), `text/plain` (many editors), or
 * `application/octet-stream` (curl with no explicit header, which is how this
 * project's own manual verification uploads files). Rejecting those would
 * block real users while stopping no attacker, since the header is
 * self-declared — content sniffing below is what actually decides.
 */
export const ALLOWED_CSV_CONTENT_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
] as const;

/** How much of the file is examined for binary markers. */
const SNIFF_WINDOW_BYTES = 8192;

/** Leading bytes that identify a format this endpoint can never parse. */
const BINARY_SIGNATURES: ReadonlyArray<{ bytes: readonly number[]; label: string }> = [
  { bytes: [0x25, 0x50, 0x44, 0x46], label: 'a PDF' }, // %PDF
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'a ZIP archive or .xlsx/.docx workbook' }, // PK..
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: 'a legacy Excel/Word document (.xls/.doc)' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'a PNG image' },
  { bytes: [0xff, 0xd8, 0xff], label: 'a JPEG image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], label: 'a GIF image' },
  { bytes: [0x1f, 0x8b], label: 'a gzip archive' },
  { bytes: [0x42, 0x5a, 0x68], label: 'a bzip2 archive' },
  { bytes: [0x52, 0x61, 0x72, 0x21], label: 'a RAR archive' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'an executable binary' },
];

const startsWith = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

/**
 * Both validations, as a list of human-readable problems (empty means
 * acceptable) rather than a throw — same shape as
 * `validateColumnMappingShape`, so each caller raises the error type that
 * suits its own layer.
 */
export function validateCsvUpload(input: { contentType?: string; buffer: Buffer }): string[] {
  const problems: string[] = [];

  // Strip any `; charset=utf-8` parameter before comparing.
  const declared = (input.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!(ALLOWED_CSV_CONTENT_TYPES as readonly string[]).includes(declared)) {
    problems.push(
      `content type "${declared || 'unknown'}" is not accepted for CSV import ` +
        `(expected one of: ${ALLOWED_CSV_CONTENT_TYPES.join(', ')})`,
    );
  }

  problems.push(...sniffCsvContent(input.buffer));
  return problems;
}

/** The content-only half — trustworthy regardless of what the client claimed. */
export function sniffCsvContent(buffer: Buffer): string[] {
  if (buffer.length === 0) return ['the file is empty'];

  // A UTF-8 BOM is legitimate here (Excel writes one) and is skipped for
  // signature matching only. Verified separately that papaparse itself
  // handles a leading BOM without corrupting the first header name.
  const body =
    startsWith(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;

  if (body.length === 0) return ['the file contains nothing but a byte-order mark'];

  const signature = BINARY_SIGNATURES.find((s) => startsWith(body, s.bytes));
  if (signature) {
    return [`the content looks like ${signature.label}, not a CSV file`];
  }

  // The catch-all for binary formats with no signature above: text files do
  // not contain NUL bytes, binaries almost always do. Checked over a window
  // rather than the whole file so a large upload stays cheap.
  const window = body.subarray(0, SNIFF_WINDOW_BYTES);
  if (window.includes(0x00)) {
    return ['the content contains binary data (NUL bytes), so it is not a text CSV file'];
  }

  return [];
}
