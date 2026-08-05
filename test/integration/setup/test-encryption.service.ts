// test/integration/setup/test-encryption.service.ts
import {
  EncryptedEnvelope,
  EncryptionService,
} from '../../../src/shared-kernel/encryption/encryption.port';
import {
  decryptEnvelope,
  decryptJson,
  encryptEnvelope,
  encryptJson,
} from '../../../src/shared-kernel/encryption/aes-gcm-envelope-crypto';

// Fixed 32-byte test key — NEVER used outside this test file, deliberately
// distinct from any real dev/prod key so there's no risk of confusion.
const TEST_KEK = Buffer.from('0'.repeat(64), 'hex'); // 32 bytes of zeros, hex-encoded

/**
 * Real AES-256-GCM encryption (via the same pure functions the production
 * AesGcmEnvelopeEncryptionService wraps) — NOT a mock or stub. This is
 * genuinely testing the encryption round-trip, just with a fixed test key
 * instead of pulling ConfigService into the integration test harness.
 */
export class TestEncryptionService implements EncryptionService {
  async encrypt(plaintext: Buffer): Promise<EncryptedEnvelope> {
    return encryptEnvelope(TEST_KEK, plaintext);
  }

  async decrypt(envelope: EncryptedEnvelope): Promise<Buffer> {
    return decryptEnvelope(TEST_KEK, envelope);
  }

  async encryptJson<T>(value: T): Promise<Buffer> {
    return encryptJson(TEST_KEK, value);
  }

  async decryptJson<T>(blob: Buffer): Promise<T> {
    return decryptJson<T>(TEST_KEK, blob);
  }
}
