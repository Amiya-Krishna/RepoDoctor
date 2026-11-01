import "dotenv/config";
import { prisma, connectDatabase, disconnectDatabase } from "./config/prisma.js";
import { isEncryptedPayload, protectToken } from "./security/token-encryption.js";

/** One-off: encrypts GitHub tokens that were stored in plaintext by earlier versions. Idempotent. */
await connectDatabase();
const users = await prisma.user.findMany({ where: { githubAccessToken: { not: null } }, select: { id: true, githubAccessToken: true } });
let migrated = 0;
for (const u of users as { id: string; githubAccessToken: string | null }[]) {
  if (u.githubAccessToken && !isEncryptedPayload(u.githubAccessToken)) {
    await prisma.user.update({ where: { id: u.id }, data: { githubAccessToken: protectToken(u.githubAccessToken) } });
    migrated++;
  }
}
console.log(`Encrypted ${migrated} legacy token(s); ${users.length - migrated} were already encrypted.`);
await disconnectDatabase();
