// test/e2e/setup/global-setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { MinioContainer, StartedMinioContainer } from '@testcontainers/minio';
import { GenericContainer, Wait } from 'testcontainers';
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
  const minio: StartedMinioContainer = await new MinioContainer('minio/minio:latest').start();

  // eslint-disable-next-line no-console
  console.log(
    '[e2e setup] Starting ClamAV container — this can take several minutes on first run while it downloads virus signatures...',
  );

  const clamav = await new GenericContainer('clamav/clamav:stable')
    .withExposedPorts(3310)
    .withWaitStrategy(Wait.forLogMessage(/socket found, clamd started/i))
    .withStartupTimeout(300000)
    .start();

  const clamavHost = clamav.getHost();
  const clamavPort = clamav.getMappedPort(3310);

  // eslint-disable-next-line no-console
  console.log(`[e2e setup] ClamAV ready at ${clamavHost}:${clamavPort}`);

  const databaseUrl = postgres.getConnectionUri();
  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);
  // eslint-disable-next-line no-console
  console.log(`\n[e2e setup] Postgres: ${databaseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`[e2e setup] Redis: ${redisHost}:${redisPort}`);
  const minioEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  // Create the test bucket via the AWS SDK directly — simplest way to do
  // this from within globalSetup without shelling out to `mc`.
  const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: minio.getUsername(), secretAccessKey: minio.getPassword() },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'e2e-test-attachments' }));

  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      postgresContainerId: postgres.getId(),
      redisContainerId: redis.getId(),
      minioContainerId: minio.getId(),
      clamavContainerId: clamav.getId(),
      databaseUrl,
      redisHost,
      redisPort,
      minioEndpoint,
      minioAccessKey: minio.getUsername(),
      minioSecretKey: minio.getPassword(),
      clamavHost,
      clamavPort,
    }),
    'utf8',
  );
}
