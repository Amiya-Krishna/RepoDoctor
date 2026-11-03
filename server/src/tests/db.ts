/**
 * Real-PostgreSQL / real-Redis test infrastructure shared by integration tests.
 *
 * Environment:
 *   TEST_DATABASE_ADMIN_URL  e.g. postgresql://postgres@127.0.0.1:5433/postgres  (needs CREATEDB)
 *   TEST_REDIS_URL           e.g. redis://:pass@127.0.0.1:6380
 *   PRISMA_DRIVER_ADAPTER=pg only when the client was generated without the native engine.
 *
 * Tests call `integrationSkipReason()` and pass the result to `test(..., { skip })`, so a missing
 * dependency is reported as a SKIP with the reason instead of silently passing.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../prisma/migrations");

export const migrationNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

export function integrationSkipReason(needs: { postgres?: boolean; redis?: boolean } = { postgres: true }): string | false {
  let reason: string | false = false;
  if (needs.postgres && !process.env.TEST_DATABASE_ADMIN_URL) {
    reason = "TEST_DATABASE_ADMIN_URL is not set (real PostgreSQL required)";
  } else if (needs.redis && !process.env.TEST_REDIS_URL) {
    reason = "TEST_REDIS_URL is not set (real Redis required)";
  }
  // CI/release set REQUIRE_INTEGRATION_TESTS=true so missing infrastructure FAILS the run instead of skipping.
  if (reason && process.env.REQUIRE_INTEGRATION_TESTS === "true") throw new Error(`REQUIRE_INTEGRATION_TESTS=true but: ${reason}`);
  return reason;
}

export interface TestDatabase {
  url: string;
  name: string;
  /** Runs SQL with the admin-less connection to the test database. */
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<pg.QueryResult<T>>;
  /** Applies migrations [from, to) by directory name order. */
  applyMigrations: (opts?: { upTo?: string; after?: string }) => Promise<string[]>;
  drop: () => Promise<void>;
}

/** Creates an empty, uniquely named database. Migrations are NOT applied automatically. */
export async function createTestDatabase(label = "t"): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("TEST_DATABASE_ADMIN_URL is not set");
  const name = `rd_${label.replace(/[^a-z0-9_]/gi, "_").slice(0, 20)}_${randomBytes(4).toString("hex")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // Idle clients may be terminated by the FORCE drop during teardown; that is expected and must not crash the run.
  pool.on("error", () => undefined);

  return {
    url,
    name,
    query: (sql, params) => pool.query(sql, params as unknown[]),
    async applyMigrations(opts = {}) {
      const applied: string[] = [];
      for (const dir of migrationNames()) {
        if (opts.after && dir <= opts.after) continue;
        if (opts.upTo && dir > opts.upTo) break;
        const sql = readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
        const client = await pool.connect();
        try {
          // Prisma runs each migration file as one unit; BEGIN/COMMIT mirrors that so a failure leaves nothing behind.
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("COMMIT");
          applied.push(dir);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw new Error(`Migration ${dir} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          client.release();
        }
      }
      return applied;
    },
    async drop() {
      await pool.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250)); // let a driver-adapter pool finish closing before FORCE
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Points the process-wide Prisma client (src/config/prisma.ts) at `db`. Call BEFORE importing services. */
export function useDatabase(db: TestDatabase): void {
  process.env.DATABASE_URL = db.url;
  process.env.PRISMA_DRIVER_ADAPTER ??= "pg";
}

export function redisTestConnection() {
  const url = new URL(process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    maxRetriesPerRequest: null as null,
  };
}
