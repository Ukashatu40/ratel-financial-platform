// src/shared-kernel/encryption/encryption.module.ts
import { Global, Module } from '@nestjs/common';
import { ENCRYPTION_SERVICE } from './encryption.port';
import { AesGcmEnvelopeEncryptionService } from './aes-gcm-envelope-encryption.service';

@Global()
@Module({
  providers: [{ provide: ENCRYPTION_SERVICE, useClass: AesGcmEnvelopeEncryptionService }],
  exports: [ENCRYPTION_SERVICE],
})
export class EncryptionModule {}