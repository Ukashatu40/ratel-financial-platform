// test/unit/integration/csv-file-validation.spec.ts
import {
  ALLOWED_CSV_CONTENT_TYPES,
  sniffCsvContent,
  validateCsvUpload,
} from '../../../src/integration/domain/csv-file-validation';
import { describe, expect, it } from '@jest/globals';

const csv = Buffer.from('department,category,amountMinorUnits,currency,expenseDate\nEng,Cloud,1,NGN,2026-08-01\n');

describe('csv-file-validation', () => {
  describe('validateCsvUpload — declared content type', () => {
    it.each(ALLOWED_CSV_CONTENT_TYPES)('accepts %s', (contentType) => {
      expect(validateCsvUpload({ contentType, buffer: csv })).toEqual([]);
    });

    it('ignores a charset parameter on the content type', () => {
      expect(validateCsvUpload({ contentType: 'text/csv; charset=utf-8', buffer: csv })).toEqual([]);
    });

    it('is case-insensitive about the content type', () => {
      expect(validateCsvUpload({ contentType: 'TEXT/CSV', buffer: csv })).toEqual([]);
    });

    it('rejects a content type that could never be a CSV', () => {
      const problems = validateCsvUpload({ contentType: 'image/png', buffer: csv });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('image/png');
    });

    it('rejects a missing content type rather than defaulting to allowed', () => {
      const problems = validateCsvUpload({ contentType: undefined, buffer: csv });
      expect(problems[0]).toContain('unknown');
    });

    it('rejects on CONTENT even when the declared type is allowed', () => {
      // The point of the whole exercise: the declared type is client-supplied,
      // so an allowed value must not be able to wave binary content through.
      const pdfBytesLabelledAsCsv = Buffer.from('%PDF-1.7\n%binary junk\n');
      const problems = validateCsvUpload({ contentType: 'text/csv', buffer: pdfBytesLabelledAsCsv });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('a PDF');
    });

    it('reports both problems when the type AND the content are wrong', () => {
      const problems = validateCsvUpload({
        contentType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n'),
      });
      expect(problems).toHaveLength(2);
    });
  });

  describe('sniffCsvContent', () => {
    it('accepts ordinary CSV text', () => {
      expect(sniffCsvContent(csv)).toEqual([]);
    });

    it('accepts CSV with a leading UTF-8 BOM, as Excel writes it', () => {
      expect(sniffCsvContent(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv]))).toEqual([]);
    });

    it('rejects an empty file', () => {
      expect(sniffCsvContent(Buffer.alloc(0))[0]).toContain('empty');
    });

    it('rejects a file containing nothing but a BOM', () => {
      expect(sniffCsvContent(Buffer.from([0xef, 0xbb, 0xbf]))[0]).toContain('byte-order mark');
    });

    it.each([
      ['a PDF', Buffer.from('%PDF-1.7\n')],
      ['a ZIP archive or .xlsx/.docx workbook', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
      ['a legacy Excel/Word document (.xls/.doc)', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])],
      ['a PNG image', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ['a JPEG image', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
      ['a GIF image', Buffer.from('GIF89a')],
      ['a gzip archive', Buffer.from([0x1f, 0x8b, 0x08])],
      ['an executable binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ])('identifies %s by its signature', (label, buffer) => {
      const problems = sniffCsvContent(buffer);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(label);
    });

    it('still rejects a signature hidden behind a BOM', () => {
      const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('%PDF-1.7')]);
      expect(sniffCsvContent(buffer)[0]).toContain('a PDF');
    });

    it('rejects binary content that matches no known signature, via NUL bytes', () => {
      const buffer = Buffer.from([0x01, 0x02, 0x00, 0x03, 0x04]);
      expect(sniffCsvContent(buffer)[0]).toContain('NUL bytes');
    });

    it('does not scan past the sniff window, so a large valid file stays cheap', () => {
      // A NUL beyond the window is not detected — a deliberate trade
      // (bounded cost per upload) rather than an oversight.
      const buffer = Buffer.concat([Buffer.alloc(9000, 0x41), Buffer.from([0x00])]);
      expect(sniffCsvContent(buffer)).toEqual([]);
    });

    it('accepts non-ASCII UTF-8 text — a CSV is not required to be ASCII', () => {
      expect(sniffCsvContent(Buffer.from('department,category\nRecherche,Café ☕\n'))).toEqual([]);
    });
  });
});
