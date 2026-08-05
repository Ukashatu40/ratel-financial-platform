// test/e2e/setup/global-setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join(__dirname, '.e2e-state.json');

export default async function globalSetup(): Promise<void> {
  const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('ratel_financial_e2e')
    .withUsername('test')
    .withPassword('test')
    .start();

  const redis: StartedRedisContainer = await new RedisContainer('redis:7-alpine').start();

  const databaseUrl = postgres.getConnectionUri();
  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);

  // eslint-disable-next-line no-console
  console.log(`\n[e2e setup] Postgres: ${databaseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`[e2e setup] Redis: ${redisHost}:${redisPort}`);

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      postgresContainerId: postgres.getId(),
      redisContainerId: redis.getId(),
      databaseUrl,
      redisHost,
      redisPort,
    }),
    'utf8',
  );
}
