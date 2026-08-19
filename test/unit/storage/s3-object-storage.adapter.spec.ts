// test/unit/storage/s3-object-storage.adapter.spec.ts
import { S3ObjectStorageAdapter } from '../../../src/storage/s3-object-storage.adapter';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it } from '@jest/globals';

const FULL_CONFIG: Record<string, string> = {
  OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORAGE_BUCKET: 'ratel-test',
  OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
  OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
};

// Overrides are applied by iterating the caller's OWN keys, so passing
// `{ OBJECT_STORAGE_BUCKET: undefined }` genuinely unsets it. A `??`/`||`
// merge would silently fall back to FULL_CONFIG and quietly test the
// opposite of what the caller asked for (critical convention #4).
function buildAdapter(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = { ...FULL_CONFIG };
  for (const key of Object.keys(overrides)) {
    values[key] = overrides[key];
  }

  const config = { get: (key: string) => values[key] };
  return new S3ObjectStorageAdapter(config as any);
}

describe('S3ObjectStorageAdapter — boot-time config visibility', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    warn.mockClear();
    log.mockClear();
  });

  it('logs the configured bucket and endpoint when everything is set', () => {
    buildAdapter().onModuleInit();

    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('ratel-test');
  });

  it('warns at boot naming EVERY missing variable, not just the first', () => {
    buildAdapter({
      OBJECT_STORAGE_ENDPOINT: undefined,
      OBJECT_STORAGE_SECRET_KEY: undefined,
    }).onModuleInit();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('OBJECT_STORAGE_ENDPOINT');
    expect(message).toContain('OBJECT_STORAGE_SECRET_KEY');
    expect(message).not.toContain('OBJECT_STORAGE_BUCKET'); // that one IS set
  });

  it('treats an empty-string value as unset, not as configured', () => {
    buildAdapter({ OBJECT_STORAGE_BUCKET: '' }).onModuleInit();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('OBJECT_STORAGE_BUCKET');
  });

  it('does NOT throw when config is missing — boot must not depend on storage', () => {
    // The whole point of #27's chosen fix: visible at deploy time without
    // making object storage a boot dependency for deployments that don't
    // use it. A hard-fail here would be the wrong trade.
    expect(() => buildAdapter({ OBJECT_STORAGE_ENDPOINT: undefined }).onModuleInit()).not.toThrow();
  });

  it('still hard-fails on first ACTUAL use when config is missing', async () => {
    const adapter = buildAdapter({ OBJECT_STORAGE_BUCKET: undefined });
    adapter.onModuleInit(); // warned, did not throw

    await expect(adapter.upload('k', Buffer.from('x'), 'text/csv')).rejects.toThrow(
      /not configured/,
    );
  });
});
