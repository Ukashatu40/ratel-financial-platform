// src/shared-kernel/encryption/aes-gcm-envelope-encryption.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptedEnvelope, EncryptionService } from './encryption.port';
import { EnvConfig } from '../../config/env.schema';
import { requireConfig } from '../../config/require-config';
import {
  decryptEnvelope,
  decryptJson,
  encryptEnvelope,
  encryptJson,
  loadKekFromBase64,
} from './aes-gcm-envelope-crypto';

@Injectable()
export class AesGcmEnvelopeEncryptionService implements EncryptionService {
  private readonly kek: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService<EnvConfig>) {
    this.kek = loadKekFromBase64(requireConfig(config, 'FIELD_ENCRYPTION_MASTER_KEY'));
  }

  async encrypt(plaintext: Buffer): Promise<EncryptedEnvelope> {
    return encryptEnvelope(this.kek, plaintext);
  }

  async decrypt(envelope: EncryptedEnvelope): Promise<Buffer> {
    return decryptEnvelope(this.kek, envelope);
  }

  async encryptJson<T>(value: T): Promise<Buffer> {
    return encryptJson(this.kek, value);
  }

  async decryptJson<T>(blob: Buffer): Promise<T> {
    return decryptJson<T>(this.kek, blob);
  }
}
