// src/shared-kernel/scanning/virus-scan.port.ts
export type ScanResult = 'clean' | 'infected';

export interface VirusScanPort {
  scan(buffer: Buffer): Promise<ScanResult>;
}

export const VIRUS_SCAN_PORT = Symbol('VIRUS_SCAN_PORT');
