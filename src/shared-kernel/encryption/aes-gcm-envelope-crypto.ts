// src/shared-kernel/encryption/aes-gcm-envelope-crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { EncryptedEnvelope } from './encryption.port';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
export const CURRENT_KEY_VERSION = 'v1';

/**
 * Pure, DI-free envelope encryption primitives (Phase 9.3 pattern, reused
 * from BED-6D). Deliberately has ZERO NestJS/ConfigService dependency —
 * this is what lets the seed script (which runs outside the Nest DI
 * container entirely) encrypt salary data using the exact same logic
 * AesGcmEnvelopeEncryptionService uses at runtime, rather than a second,
 * drift-prone copy.
 */
export function encryptEnvelope(kek: Buffer, plaintext: Buffer): EncryptedEnvelope {
  const dek = randomBytes(32);

  const ciphertextIv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, ciphertextIv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ciphertextAuthTag = cipher.getAuthTag();

  const dekIv = randomBytes(IV_LENGTH);
  const dekCipher = createCipheriv(ALGORITHM, kek, dekIv);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  return {
    keyVersion: CURRENT_KEY_VERSION,
    wrappedDek,
    dekIv,
    dekAuthTag,
    ciphertext,
    ciphertextIv,
    ciphertextAuthTag,
  };
}

export function decryptEnvelope(kek: Buffer, envelope: EncryptedEnvelope): Buffer {
  void envelope.keyVersion; // placeholder until KEK rotation exists (piece 3.5's note, unchanged)

  const dekDecipher = createDecipheriv(ALGORITHM, kek, envelope.dekIv);
  dekDecipher.setAuthTag(envelope.dekAuthTag);
  const dek = Buffer.concat([dekDecipher.update(envelope.wrappedDek), dekDecipher.final()]);

  const decipher = createDecipheriv(ALGORITHM, dek, envelope.ciphertextIv);
  decipher.setAuthTag(envelope.ciphertextAuthTag);
  return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
}

export function packEnvelope(e: EncryptedEnvelope): Buffer {
  const keyVersionBuf = Buffer.from(e.keyVersion, 'utf8');
  const header = Buffer.alloc(1 + keyVersionBuf.length + 12 + 16 + 4);
  let offset = 0;

  header.writeUInt8(keyVersionBuf.length, offset);
  offset += 1;
  keyVersionBuf.copy(header, offset);
  offset += keyVersionBuf.length;
  e.dekIv.copy(header, offset);
  offset += 12;
  e.dekAuthTag.copy(header, offset);
  offset += 16;
  header.writeUInt32BE(e.wrappedDek.length, offset);

  return Buffer.concat([header, e.wrappedDek, e.ciphertextIv, e.ciphertextAuthTag, e.ciphertext]);
}

export function unpackEnvelope(blob: Buffer): EncryptedEnvelope {
  let offset = 0;
  const keyVersionLen = blob.readUInt8(offset);
  offset += 1;
  const keyVersion = blob.subarray(offset, offset + keyVersionLen).toString('utf8');
  offset += keyVersionLen;
  const dekIv = blob.subarray(offset, offset + 12);
  offset += 12;
  const dekAuthTag = blob.subarray(offset, offset + 16);
  offset += 16;
  const wrappedDekLen = blob.readUInt32BE(offset);
  offset += 4;
  const wrappedDek = blob.subarray(offset, offset + wrappedDekLen);
  offset += wrappedDekLen;
  const ciphertextIv = blob.subarray(offset, offset + 12);
  offset += 12;
  const ciphertextAuthTag = blob.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = blob.subarray(offset);

  return { keyVersion, wrappedDek, dekIv, dekAuthTag, ciphertext, ciphertextIv, ciphertextAuthTag };
}

export function encryptJson<T>(kek: Buffer, value: T): Buffer {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  return packEnvelope(encryptEnvelope(kek, plaintext));
}

export function decryptJson<T>(kek: Buffer, blob: Buffer): T {
  const plaintext = decryptEnvelope(kek, unpackEnvelope(blob));
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function loadKekFromBase64(raw: string): Buffer {
  const kek = Buffer.from(raw, 'base64');
  if (kek.length !== 32) {
    throw new Error('Master encryption key must decode to exactly 32 bytes');
  }
  return kek;
}
