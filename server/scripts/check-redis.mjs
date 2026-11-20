import 'dotenv/config';
import { Redis } from 'ioredis';

async function main() {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD || undefined;
  const username = process.env.REDIS_USERNAME || undefined;

  const redis = new Redis({
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const res = await redis.ping();
    if (res === 'PONG') {
      console.log('REDIS_OK');
      await redis.quit();
      process.exit(0);
    } else {
      console.error(`REDIS_ERROR: Unexpected response '${res}'`);
      await redis.quit();
      process.exit(1);
    }
  } catch (error) {
    const safeMsg = (error.message || '').replace(/AUTH\s+[^\s]+/gi, 'AUTH [REDACTED]');
    console.error('REDIS_ERROR:', safeMsg);
    redis.disconnect();
    process.exit(1);
  }
}

main();
