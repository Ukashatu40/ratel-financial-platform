// test/integration/setup/global-teardown.ts
import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join(__dirname, '.testcontainer-state.json');

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;

  const { containerId } = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

  try {
    execSync(`docker stop ${containerId}`, { stdio: 'inherit' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[integration teardown] Failed to stop container ${containerId} via docker CLI — you may need to run 'docker stop ${containerId}' manually.`,
      err,
    );
  } finally {
    unlinkSync(STATE_FILE);
  }
}
