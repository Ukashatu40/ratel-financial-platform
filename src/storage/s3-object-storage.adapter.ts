// src/storage/s3-object-storage.adapter.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvConfig } from '../config/env.schema';
import { ObjectStoragePort } from './object-storage.port';
import { Readable } from 'stream';

/**
 * S3-compatible — works against real AWS S3 or MinIO (local dev) purely by
 * changing OBJECT_STORAGE_ENDPOINT. No vendor-specific code, matching the
 * original blueprint's port/adapter reasoning (Phase 3.3's pattern applied
 * to storage instead of payment providers).
 *
 * Lazily validates config on first use rather than at construction — this
 * means the app still boots (and every OTHER endpoint still works) even in
 * an environment where object storage isn't configured, e.g. today's e2e
 * test harness, which doesn't run a MinIO container and doesn't need to
 * for the suites that don't touch attachments. Tracked as a gap in
 * TECH_DEBT rather than silently accepted — see the note below.
 */
@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<EnvConfig>) {}

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
