// test/e2e/setup/global-teardown.ts
import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join(__dirname, '.e2e-state.json');

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;

  const { postgresContainerId, redisContainerId, minioContainerId, clamavContainerId } = JSON.parse(
    readFileSync(STATE_FILE, 'utf8'),
  );

  for (const id of [postgresContainerId, redisContainerId, minioContainerId, clamavContainerId]) {
    try {
      execSync(`docker stop ${id}`, { stdio: 'inherit' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e teardown] Failed to stop container ${id} — may need manual 'docker stop ${id}'.`,
        err,
      );
    }
  }

  unlinkSync(STATE_FILE);
}
