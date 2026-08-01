// src/shared-kernel/encryption/encryption.port.ts
export interface EncryptedEnvelope {
  keyVersion: string;      // which KEK version wrapped this DEK — enables KEK rotation later
  wrappedDek: Buffer;      // the DEK, encrypted under the KEK
  dekIv: Buffer;
  dekAuthTag: Buffer;
  ciphertext: Buffer;      // the actual plaintext, encrypted under the DEK
  ciphertextIv: Buffer;
  ciphertextAuthTag: Buffer;
}

export interface EncryptionService {
  encrypt(plaintext: Buffer): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope): Promise<Buffer>;

  // Convenience for the common case: encrypting/decrypting a JSON-serializable
  // value directly, packed to a single Buffer suitable for a BYTEA column
  // (Phase 6.2's `encrypted_detail_blob`) — repositories use this, not the
  // raw envelope methods, so they never touch crypto primitives directly.
  encryptJson<T>(value: T): Promise<Buffer>;
  decryptJson<T>(blob: Buffer): Promise<T>;
}

export const ENCRYPTION_SERVICE = Symbol('ENCRYPTION_SERVICE');