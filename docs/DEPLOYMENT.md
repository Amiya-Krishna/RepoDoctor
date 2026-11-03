# Secure production deployment

RepoDoctor runs untrusted code (the tests of repositories it analyses). The deployment is therefore split in two zones. Read "Sandbox host" before anything else.

```
Internet ── TLS proxy ──► client (nginx) ──► server (API) ──► PostgreSQL
                                   │              │
                                   │              └──► Redis (queues) ◄── scan-worker
                                   │
        PRIVATE NETWORK ONLY ──────┴──► Redis / PostgreSQL ◄── repair-worker ──► local Docker daemon ──► sandbox containers
                                                              (dedicated sandbox host)
```

## 1. Prerequisites

- A TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of the `client` service. The bundled nginx speaks plain HTTP; production **refuses to start** with a non-`https://` `FRONTEND_URL`.
- PostgreSQL 16 with TLS, Redis 7 with a password, both reachable only from private networks.
- A GitHub OAuth App (or, preferably, see "Least privilege" below) whose callback is `https://<your-host>/api/github/callback`.
- At least one of: provider keys for Cloud AI, or an OpenAI-compatible endpoint for Self-hosted AI (`LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`).

## 2. Secrets

Generate every secret randomly and keep them in your secret manager or in GitHub **environment** secrets (with required reviewers on the `production` environment), never in the repository or an image.

| Variable | How to generate | Notes |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | ≥ 32 chars, enforced at startup |
| `GITHUB_TOKEN_ENCRYPTION_KEY` + `GITHUB_TOKEN_ENCRYPTION_KEY_ID` | `openssl rand -base64 32`; id such as `k1` | **Required.** Low-entropy keys are rejected. Losing it makes stored GitHub tokens unreadable (users reconnect). Keep it outside the database. Rotation: `GITHUB_TOKEN_ENCRYPTION_OLD_KEYS`, see `OPERATIONS_SECURITY.md` §12. |
| `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 24` | same value in the GitHub webhook settings |
| `REDIS_PASSWORD` | `openssl rand -hex 24` | |

Startup checks (`server/src/config/startup-checks.ts`) abort the API and both workers in production when any of these is missing/weak, when `FRONTEND_URL` is not https, or when `ALLOW_PLAINTEXT_TOKENS` is set.

If you are upgrading an installation that stored tokens in plaintext: set the key, **take a database backup**, then `npm run tokens:migrate -- --dry-run` and `npm run tokens:migrate -- --i-have-a-backup` (idempotent). The API and workers refuse to start in production until no plaintext token remains.

## 2a. Installing and upgrading (migrations are immutable)

Shipped migrations are **never edited**: `server/prisma/SHIPPED_MIGRATIONS.sha256` pins the sha256 of every migration from the original release and `migration-upgrade.test.ts` fails if one changes. Fixes go into new, forward-only migrations. `20261031000000_privacy_security_hardening` is back to its original text; an earlier remediation build had edited it in place (that text is kept for reference in `docs/migration-variants/`), which is why there are two upgrade situations below.

### Fresh installation (empty database)
1. `npx prisma migrate deploy` — applies every migration in order, including the corrective `20261102000000_pull_request_duplicate_archive`.
2. Set the secrets (section 2), start the stack. There are no tokens to migrate.

### Existing installation — first find out where you are
```bash
cd server
DATABASE_URL=... ./scripts/migration-checksum-check.sh        # read-only
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-preflight.sql
```
Whether `20261031000000` has been applied in **your** environment cannot be known from the repository; the script reports it per migration and says `applied ORIGINAL text`, `applied EDITED variant`, or nothing (not applied).

| Situation | Procedure |
|---|---|
| **A. `20261031…` not applied, pre-flight shows 0 duplicate pull requests** | Back up → `prisma migrate deploy`. |
| **B. `20261031…` not applied, duplicates > 0** | Back up → `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pre-migrate-archive-duplicate-pull-requests.sql` (keeps the earliest row per finding, archives the rest in one transaction, idempotent) → `prisma migrate deploy`. Without the script the migration fails **atomically** (nothing half-applied; verified by test) and Prisma records it as failed: fix the data, then `prisma migrate resolve --rolled-back 20261031000000_privacy_security_hardening` and deploy again. |
| **C. `20261031…` applied with the ORIGINAL text** (checksum matches) | Back up → `prisma migrate deploy`. Only `20261101000000` and `20261102000000` run. |
| **D. `20261031…` applied with the EDITED variant** (script says so; `prisma migrate status` reports the file changed) | The database state is already a superset of the original. Back up → `prisma migrate deploy` runs the two new migrations; the corrective one is an idempotent no-op (verified by test). The recorded checksum for `20261031…` will differ from the restored file. **Do not** rewrite `_prisma_migrations` blindly: first confirm that `PullRequest_analysisId_findingId_key` exists, then either keep the mismatch (recorded, understood) or, with a backup and after review, update that single row's checksum to the original's sha256 printed by the script. How `prisma migrate deploy` itself reacts to the mismatch was **not** verified here (native engine unavailable): rehearse on a restored copy first. |

After any path: tokens (section 2: backup → `tokens:migrate --dry-run` → `--i-have-a-backup`), start API and workers, check `/api/ready`, startup logs (no `[config] warning`), and `SELECT status,count(*) FROM "WebhookDelivery" GROUP BY 1`. `APPROVED` repairs with no recorded patch hash are reset to `AWAITING_APPROVAL` (re-approval required); `PUBLISHED` becomes `COMPLETED`. Roll back only by restoring the backup.

## 3. Application stack

```bash
cp .env.example .env && cp server/.env.example server/.env   # fill in real values
docker compose up --build -d      # migrate -> server, scan-worker, client
curl -fsS https://<host>/api/health   # liveness
curl -fsS https://<host>/api/ready    # database + Redis reachable
```

All services run with a read-only root filesystem, all Linux capabilities dropped and `no-new-privileges`. Only the client port is published.

## 4. Sandbox host (repair worker)

The repair worker clones repositories, refuses a checkout containing escaping symlinks or special files, applies the install policy (no git/URL dependencies, no rc files, registry-only lockfile hosts), installs dependencies in a **non-root, read-only, capability-less** container (network on by default, lifecycle scripts **off**; `REPAIR_INSTALL_NETWORK=none` to disable), and runs their tests in a container with **no network**, no capabilities, a read-only root, memory/CPU/PID limits and a non-root user (`server/src/execution/`). A root `REPAIR_SANDBOX_USER` is refused.

Run it on a **dedicated VM** that holds nothing else of value:

1. Install Docker Engine and Node 22 + git; pull the image once: `docker pull node:22-bookworm-slim`.
2. Give the VM network access only to Redis, PostgreSQL, GitHub and the npm registry. Block everything else, **especially cloud metadata endpoints (169.254.169.254)** and your internal networks.
3. Run the worker as an unprivileged user in the `docker` group with the same `server/.env`: `npm ci && npm run build && node dist/workers/repair.worker.js` under systemd with `Restart=always`.
4. Never run this worker inside the public stack and never mount `/var/run/docker.sock` into any internet-facing container. The worker and the Docker daemon must share a filesystem (workspaces are bind-mounted), which is why a remote `DOCKER_HOST` does not work.

Membership of the `docker` group is root-equivalent on that VM: that is the reason for the dedicated host.

Hardening options (see `OPERATIONS_SECURITY.md` §15): install gVisor and set `REPAIR_SANDBOX_RUNTIME=runsc` (plus `REPAIR_REQUIRE_HARDENED_RUNTIME=true` to make it mandatory), or use rootless Docker. Validate the host with `docker pull node:22-bookworm-slim && cd server && npm run test:docker` — all nine real-container tests must pass, not skip.

## 5. GitHub configuration

- Webhook: payload URL `https://<host>/api/github/webhook`, content type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, events: *Pushes* and *Pull requests*. Deliveries are accepted once per delivery id (replays are rejected).
- Webhook-triggered and scheduled scans run only for repositories whose owner enabled "Scan automatically" **and** whose privacy settings allow AI processing.
- **Least privilege:** users connect with `public_repo` by default; private repositories require the user to opt in to GitHub's broader `repo` scope. OAuth Apps cannot be narrower than that. A GitHub App with per-repository, fine-grained permissions (contents: write, pull requests: write, metadata: read) is the better long-term design and is listed under remaining risks.
- Protect the default branch (required reviews). RepoDoctor never merges.

## 6. CI/CD

`.github/workflows/ci.yml` runs on every pull request: typecheck and unit tests; an **integration** job with real PostgreSQL 16, Redis 7 and Docker (`REQUIRE_INTEGRATION_TESTS` / `REQUIRE_DOCKER_TESTS` make a missing dependency fail instead of skip); migrations applied plus `prisma migrate diff` drift check; client lint, component tests, build and Playwright; `npm audit`; Trivy (filesystem incl. secrets and misconfiguration, and both images).

`deploy.yml` is a manual release: the version input is validated as SemVer and only ever passed through `env` (never interpolated into a shell script); tests must pass first; **both** images are built and scanned before **anything** is pushed; the push runs in the `production` environment (configure required reviewers in GitHub — a repository setting this file cannot enforce); permissions are `contents: read`, with `packages: write` only on the publish job. Every third-party action is pinned to a verified full commit SHA (`docs/ACTIONS_PINS.md` records how); Dependabot proposes SHA bumps. Rolling images out to hosts is operator-specific and not automated; nothing merges automatically.

## 7. Operations

- Logs are JSON lines on stdout (`logging/logger.ts`): request id, method, path (no query string, no bodies), status, duration; secrets are scrubbed. Source code and prompts are never logged. Ship them to your log system and set retention there.
- Health: `/api/health` (liveness), `/api/ready` (readiness). Alert on `ready=false`, on queue backlog, and on audit events `AI_EGRESS_BLOCKED`, `WEBHOOK_REJECTED`, `AUTHZ_DENIED`, `PR_BLOCKED` spikes.
- Error tracking: unhandled rejections and startup failures are logged as structured errors. Attach an error tracker (for example Sentry) at the log-shipping layer if you need one; none is bundled.
- Data lifecycle: expired analyses are purged daily per each user's retention setting; audit events are kept 365 days; webhook delivery ids `WEBHOOK_RETENTION_DAYS` (default 30).
- Backups: back up PostgreSQL (it holds encrypted tokens, findings, audit log) and test restores (`docs/DATABASE_MIGRATIONS.md`). Redis holds queue state; run it with `maxmemory-policy noeviction` (the bundled Compose does) and `appendonly yes`. Webhook and publication durability does **not** depend on Redis: PostgreSQL is the source of truth and the recovery loops rebuild queue state.
- Rollback: images are tagged by version; migrations are forward-only, so take a database backup before deploying a release that includes one.
