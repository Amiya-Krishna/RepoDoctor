import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('DB_OK');
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

main();
