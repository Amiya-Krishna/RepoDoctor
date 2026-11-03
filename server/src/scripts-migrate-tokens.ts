import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "./config/prisma.js";
import { migrateTokens, prismaTokenStore } from "./security/token-migration.js";

/**
 * Encrypts legacy plaintext / legacy-format GitHub tokens (and with --rotate, tokens under retired keys).
 *   npm run tokens:migrate -- --dry-run
 *   npm run tokens:migrate -- --i-have-a-backup [--rotate]
 */
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--i-have-a-backup") && process.env.TOKENS_MIGRATE_BACKUP_CONFIRMED !== "true") {
  console.error("Refusing to modify tokens without a backup. Take a database backup, then pass --i-have-a-backup (or --dry-run to preview).");
  process.exit(2);
}

let exitCode = 0;
try {
  await connectDatabase();
  const result = await migrateTokens(await prismaTokenStore(), { dryRun, rotate: args.has("--rotate") });
  console.log(JSON.stringify({ ...result, failedIds: undefined, failedCount: result.failed }));
  if (result.failed > 0) {
    console.error(`${result.failed} row(s) failed and were left unchanged: ${result.failedIds.join(", ")}`);
    exitCode = 1;
  }
} catch (error) {
  console.error("Token migration failed:", error instanceof Error ? error.message : "unknown error");
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
