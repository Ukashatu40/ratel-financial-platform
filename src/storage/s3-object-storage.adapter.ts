// src/storage/s3-object-storage.adapter.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvConfig } from '../config/env.schema';
import { ObjectStoragePort } from './object-storage.port';
import { Readable } from 'stream';

const REQUIRED_CONFIG_KEYS = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
] as const;

/**
 * S3-compatible — works against real AWS S3 or MinIO (local dev) purely by
 * changing OBJECT_STORAGE_ENDPOINT. No vendor-specific code, matching the
 * original blueprint's port/adapter reasoning (Phase 3.3's pattern applied
 * to storage instead of payment providers).
 *
 * Lazily validates config on first use rather than at construction — this
 * means the app still boots (and every OTHER endpoint still works) even in
 * an environment where object storage isn't configured, e.g. an e2e suite
 * that doesn't run a MinIO container and doesn't need to.
 *
 * The cost of that deliberate laziness used to be that a genuinely
 * misconfigured production deployment stayed silent until someone's first
 * upload. `onModuleInit` now closes that gap the cheap way (TECH_DEBT #27):
 * it WARNS at boot naming the missing variables, without hard-failing the
 * way `validateEnv` would — which would couple every deployment to object
 * storage being configured, and that isn't true for every deployment.
 */
@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort, OnModuleInit {
  private readonly logger = new Logger(S3ObjectStorageAdapter.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<EnvConfig>) {}

  onModuleInit(): void {
    const missing = REQUIRED_CONFIG_KEYS.filter(
      (key) => !this.config.get(key, { infer: true }),
    );

    if (missing.length === 0) {
      this.logger.log(
        `Object storage configured: bucket "${this.config.get('OBJECT_STORAGE_BUCKET', { infer: true })}" ` +
          `at ${this.config.get('OBJECT_STORAGE_ENDPOINT', { infer: true })}`,
      );
      return;
    }

    // Warn, don't throw: everything unrelated to files still works. But say
    // exactly what breaks and exactly what is missing, so this is actionable
    // from a deploy log rather than a hint.
    this.logger.warn(
      `Object storage is NOT configured — missing: ${missing.join(', ')}. ` +
        'Expense attachments and CSV import will fail on first use; every other endpoint is unaffected.',
    );
  }

  private getClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      const endpoint = this.config.get('OBJECT_STORAGE_ENDPOINT', { infer: true });
      const bucket = this.config.get('OBJECT_STORAGE_BUCKET', { infer: true });
      const accessKeyId = this.config.get('OBJECT_STORAGE_ACCESS_KEY', { infer: true });
      const secretAccessKey = this.config.get('OBJECT_STORAGE_SECRET_KEY', { infer: true });

      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error(
          'Object storage is not configured — OBJECT_STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY must all be set',
        );
      }

      this.bucket = bucket;
      this.client = new S3Client({
        endpoint,
        region: 'us-east-1', // required by the SDK even for MinIO; MinIO ignores the actual value
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true, // required for MinIO/most self-hosted S3-compatible stores
      });
    }
    return { client: this.client, bucket: this.bucket };
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.getClient();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const { client, bucket } = this.getClient();
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { client, bucket } = this.getClient();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
