// src/storage/clamav-scan.adapter.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import NodeClam from 'clamscan';
import { EnvConfig } from '../config/env.schema';
import { ScanResult, VirusScanPort } from '../shared-kernel/scanning/virus-scan.port';

@Injectable()
export class ClamAvScanAdapter implements VirusScanPort {
  private scannerPromise: Promise<NodeClam> | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<EnvConfig>) {}

  private getScanner(): Promise<NodeClam> {
    if (!this.scannerPromise) {
      this.scannerPromise = new NodeClam().init({
        clamdscan: {
          host: this.config.get('CLAMAV_HOST', { infer: true }),
          port: this.config.get('CLAMAV_PORT', { infer: true }),
          timeout: 60000,
          active: true,
        },
        preference: 'clamdscan', // talk to the daemon over TCP, never shell out to a local `clamscan` binary
      });
    }
    return this.scannerPromise;
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    const scanner = await this.getScanner();
    const { isInfected } = await scanner.scanStream(bufferToStream(buffer));
    return isInfected ? 'infected' : 'clean';
  }
}

// clamscan's scanStream() expects a Readable, not a raw Buffer — small local helper
import { Readable } from 'stream';
function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
