# RepoDoctor AI — Operations, Configuration, and Security

**Scope:** operational configuration, security controls and deployment notes. status labels are defined in the [development history](DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document).

## 1. Scope

This document covers local development, configuration, the real security posture and the state of the Docker Compose file. RepoDoctor is not ready for a public deployment; section 7 lists the blockers.

## 2. Configuration

### 2.1 Prerequisites

Node.js 22, npm, Git, Docker (daemon reachable by whichever process runs the repair worker), PostgreSQL 16, Redis 7, a GitHub OAuth application, and **at least one** AI provider key (OpenRouter, Groq or Gemini; `ai.config.ts` throws at import only when none of the three is a real value). Commands in this document are bash (Git Bash or WSL on Windows); Windows PowerShell variants are given where they differ. On Windows, Docker Desktop must be running for the Compose stack and for the host-side repair worker.

### 2.2 Server environment variables

Names are taken from the code and `server/.env.example`. Copy `server/.env.example` to `server/.env`; never commit the result.

| Variable | In `.env.example` | Read by | Notes |
|---|:-:|---|---|
| `DATABASE_URL` | yes | Prisma datasource | PostgreSQL URL |
| `PORT` | yes (4000) | `server.ts` | default 4000 locally and in Compose (`client/nginx.conf` and the Vite dev proxy both forward to it); the browser address is always `http://localhost:8080` |
| `JWT_SECRET` | yes | auth, OAuth state, sockets | server refuses to start without it |
| `JWT_EXPIRES_IN` | no (default `1d`) | `services/auth.service.ts` | digits + `s`/`m`/`h`/`d`; invalid values fall back to `1d` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | yes | `services/github.service.ts` | OAuth |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | yes | `ai/ai.config.ts` | at least one of the three provider keys must be set; import throws `No AI provider is configured` otherwise (reproduced) |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL` | yes | `ai/ai.config.ts` | empty and `...` values count as not configured |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH`, `GITHUB_TOKEN` | yes | PR service fallbacks, `test-github-pr.ts` | production repair passes owner, repo, base branch and the user's token explicitly |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | yes | `security/token-encryption.ts` | base64, 32 bytes; module is not wired into the application |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | yes | `queue/scan.queue.ts` | not a URL; no `REDIS_URL` is read anywhere. Compose sets host `redis`, port `6379` and `REDIS_PASSWORD` |
| `SCAN_WORKER_CONCURRENCY` | yes (2) | scan worker | |
| `REPAIR_WORKER_CONCURRENCY` | no (default 1) | repair worker | |
| `GITHUB_WEBHOOK_SECRET` | yes | webhook controller | missing → webhook returns 503 |
| `FRONTEND_URL` | yes | CORS, Socket.IO, OAuth redirect | default `http://localhost:8080` (Docker and local development); must equal the browser origin exactly (no trailing slash). In production only this origin is allowed |
| `NODE_ENV` | no | cookie `secure` flag | |

Client: `VITE_API_URL` (`client/.env.example`; default `/api`, same origin: proxied by the Vite dev server locally and by nginx in Docker).

Compose-level (shell or root `.env`): `REDIS_PASSWORD` is always required (Compose fails with `required variable REDIS_PASSWORD is missing a value`); `DATABASE_URL` for an external database, or `POSTGRES_PASSWORD` with `--profile bundled-db`. `server/.env` must exist.

### 2.3 Local run (outside Docker) — commands match the manifests; not executed end to end (Prisma engine download was blocked during the audit)

```bash
# PostgreSQL and Redis must already be running and match server/.env
cd server
npm install                 # postinstall runs `prisma generate`
npx prisma migrate deploy   # or: npm run prisma:deploy
npm run dev                 # API + Socket.IO (tsx watch src/server.ts), http://localhost:4000/api/health (API directly; http://localhost:8080/api/health once the client runs)
```

```bash
# each in its own terminal, from the repository root
(cd server && npm run worker)          # scan worker
(cd server && npm run repair-worker)   # repair worker (needs git, Docker daemon, GitHub token in DB)
(cd client && npm install && npm run dev)   # http://localhost:8080 (proxies /api and /socket.io to the API on 4000; stop the Compose stack first, both use 8080)
```

In PowerShell, run the `cd` and `npm` commands on separate lines (Windows PowerShell 5.1 has no `&&`) and give each long-running process its own window. The `npm run dev`, `npm run worker` and `npm run repair-worker` scripts must run from `server/` (that is where `.env` is read) and need PostgreSQL and Redis reachable at the addresses in `server/.env`; the Compose Redis has no published port, so these host-side scripts cannot use it.

```powershell
# window 1
cd server
npm run dev
# window 2
cd server
npm run worker
# window 3 (git on PATH, Docker Desktop running)
cd server
npm run repair-worker
# window 4
cd client
npm run dev
```

Do not run `prisma migrate reset` against data that must be kept. Before applying migrations to a shared database, back it up and review the SQL.

## 3. Security control status

| Control | Where | Status | Evidence / caveat |
|---|---|---|---|
| Password hashing | `services/auth.service.ts` | Implemented | bcryptjs, cost 10 |
| JWT sessions | `middleware/auth.middleware.ts` | Partially implemented | 1-day tokens, no refresh/revocation |
| Authorization by ownership | controllers | Implemented | queries filter by `userId` through `Repository` |
| OAuth CSRF state | `github.controller.ts` | Implemented | signed JWT, 10 min, HttpOnly cookie match |
| Webhook HMAC | `github/github-webhook.signature.ts` | Implemented | `npm run test:webhook-signature`  |
| API rate limiting | `middleware/rate-limit.middleware.ts`, `app.ts` | Implemented (loads in `npm run test:app`) | in-memory store; set `TRUST_PROXY=1` behind a reverse proxy (Compose does) |
| GitHub token encryption at rest | `security/token-encryption.ts`, `security/token-migration.ts` | Implemented, **mandatory** | AES-256-GCM, versioned `v1:<keyId>:<iv>:<tag>:<ct>` with the key id bound as AAD. Saving without a key throws. Production never reads plaintext and the API and both workers refuse to start while any stored token is plaintext or unreadable. Rotation via `GITHUB_TOKEN_ENCRYPTION_OLD_KEYS` + `tokens:migrate --rotate` (section 12). |
| Token kept out of containers | repair worker, runner | Implemented | Docker receives only `REPO_DOCTOR_ATTEMPT` |
| Token kept out of URLs/args | ingestion, worker, PR service | Implemented |  Via `GIT_CONFIG_*` environment |
| Sandboxed test execution | `execution/docker.runner.ts`, `docker.args.ts`, `safe-path.ts`, `sandbox-config.ts` | Implemented; **container behaviour not verified in the build environment** (no Docker daemon, 9 tests skipped) | `--network none`, memory (no swap)/CPU/PID/file limits, `--cap-drop ALL`, `no-new-privileges`, read-only root, `noexec` tmpfs, non-root numeric user (root is refused), optional `--runtime runsc`; workspace is scanned first and refused if it contains symlinks leaving it, FIFOs/devices or absurd size. Default seccomp profile only. |
| Dependency-install policy | `execution/install-policy.ts`, `docker.dependencies.ts` | Implemented (unit-tested; install container itself not run here) | refuses git/URL/file/link dependencies, overrides pointing off-registry, `.npmrc`/`.yarnrc*`/`.pnpmfile*`, and lockfile `resolved` hosts other than the npm/yarn registries; lifecycle scripts off; install container is non-root, read-only, capability-less and resource-limited |
| Command allow-listing | `security/test-command-policy.ts` | Implemented | strict allowlist (`npm/pnpm test`, `run test|lint|typecheck|build`, `node [--check|--test] <file>`); `node -e`, `npx`, shells refused; enforced at the API and again in the worker |
| Patch validation | `repair/patch-policy.ts`, `repair/repair.patch.ts` | Implemented | path escape, CI/git/credential/manifest paths, symlinks, file/size caps, secrets and dangerous constructs in added code; DELETE now verifies the text it removes |
| Bounded retries | `retry.policy.ts` | Implemented | 3 attempts; queue-level attempts 1 |
| Verification gate | `services/verification-gate.ts`, `pull-request.service.ts` | Implemented and verified (unit) | model verdict plus `testPassed`, no regression, confidence ≥ 0.7; since audit 2 a `VERIFIED` verdict is downgraded unless the Docker run exited 0 without timing out (`npm run test:verification-gate`) |
| Prompt-injection handling | `context/context.formatter.ts`, `ai/guarded.provider.ts` | Implemented (mitigation, not a guarantee) | source and memory are nonce-delimited as untrusted data; a fixed rules preamble is added to every request; model output is untrusted and checked by the patch policy and sandbox |
| Static secret/SAST checks | `security/static-security-scanner.ts` | Implemented  | six regex rules; not a SAST replacement |
| Audit logging | `audit/audit.service.ts` | Implemented | consent changes, AI egress (hash + counts, no content), webhook rejects/replays, repair queue/approval/PR, authorization denials, deletions; approvals and consent fail closed when the log cannot be written |
| Secret redaction in memory | `rag/chunker.ts` | Implemented | regex redaction before indexing |
| CORS and headers | `app.ts`, `logging/logger.ts`, `realtime/socket.ts` | Implemented | single origin from `FRONTEND_URL`; nosniff, frame-deny, no-store, CSP `default-src none`, HSTS on API responses |
| Request size | `express.json` default | Implemented | default 100 kB body limit |

## 4. Job operations and observability

- `POST /api/repositories/ingest` and `POST /api/repairs` return `202` with a `jobId`.
- `GET /api/repositories/jobs/:jobId` and `GET /api/repairs/jobs/:jobId` return state, progress, result and failure reason for the owning user. Use them when a socket event is missed.
- Logging is `console.*` only. The auth middleware logs the whole error on a bad token; the AI manager logs provider names and error messages. Avoid logging tokens or secret-like source text; no log-redaction layer exists.
- Queue retention: completed 24 h or 2,000 jobs; failed 7 days or 5,000 jobs.
- There is no metrics endpoint beyond `GET /api/health`, which does not check the database or Redis.

## 5. Workspace lifecycle

1. Analysis: `os.tmpdir()/repodoctor/<uuid>/repository`, removed in `finally` by `removeWorkspace`.
2. Repair worker: its own disposable shallow clone of `Analysis.sourceRef`, removed in `finally`.
3. Each repair attempt: `os.tmpdir()/repodoctor/repair-<uuid>/repository` cloned with `git clone --no-local` from step 2, on branch `repodoctor/repair/<analysisId>/<findingId>-attempt-<n>`, removed with `removeRepairWorkspace(workspace.rootPath)`; a verified workspace is published before it is removed.

The user's own working copy is never involved; the "source" is always a fresh clone. A test that snapshots the clone's commit and status before and after a repair does not exist and should be added.

## 6. Docker Compose deployment

`docker-compose.yml` runs the whole stack. Only the client is published (host port 8080); PostgreSQL, Redis and the API are reachable only on the Compose networks.

| Service | Image / build | Purpose |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Optional bundled database, only with `--profile bundled-db` (volume `postgres_data`, health check). By default the stack uses the external database in `DATABASE_URL`, e.g. Neon. |
| `migrate` | `server/Dockerfile` (build stage) | One-shot `prisma migrate deploy`; the API and workers wait for it to complete. |
| `redis` | `redis:7-alpine` | BullMQ queues; password required, append-only persistence. |
| `server` | `server/Dockerfile` | API + Socket.IO on port 4000, health check on `/api/health`. |
| `scan-worker` | `server/Dockerfile` | Processes repository scans. |
| `repair-worker` | `server/Dockerfile` | Processes autonomous repairs (see limitation below). |
| `client` | `client/Dockerfile` (nginx) | Serves the SPA and proxies `/api/` and `/socket.io/` to `server:4000`. |

Required variables (root `.env`, template `.env.example`): `REDIS_PASSWORD`, and either `DATABASE_URL` or, with `--profile bundled-db`, `POSTGRES_PASSWORD` (URL-safe characters only because it is embedded in the database URL). `server/.env` (template `server/.env.example`) is also required; set `FRONTEND_URL=http://localhost:8080` and `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback` there (these are already the template values and are the same for local development), and register the same callback URL in the GitHub OAuth app. Open the app as `http://localhost:8080`: the OAuth state cookie is `Secure` under `NODE_ENV=production`, which browsers accept over HTTP only for `localhost`.

Commands (add `--profile bundled-db` to each when using the bundled PostgreSQL):

```bash
docker compose config -q          # verified: exit 0 with both env files present
docker compose up --build -d      # NOT executed in the audit (Docker Hub blocked)
docker compose ps                 # migrate exits 0; redis and server healthy
docker compose logs migrate server
docker compose down               # keeps volumes; `down -v` deletes redis_data (and postgres_data)
```

The same commands run unchanged in Windows PowerShell (Docker Desktop running, one command per line). Workers need no `npm run worker` under Compose: `scan-worker` and `repair-worker` are services (`docker compose logs scan-worker repair-worker`). After editing `server/.env` run `docker compose up -d --force-recreate server scan-worker repair-worker`.

URLs: client http://localhost:8080, API health http://localhost:8080/api/health (through nginx). No other port is published. Database initialisation is the `migrate` service (`prisma migrate deploy`, 16 migrations).

**Neon:** use the direct (non-pooled) connection string with `sslmode=require&connect_timeout=30`. Pooled (PgBouncer) endpoints can break `prisma migrate deploy`, and the schema declares no separate direct URL. Neon computes that scale to zero take a moment to wake, so the first `migrate` run may be slow. Use a Neon branch for test runs. A filled-in `server/.env` is also required (`JWT_SECRET`, GitHub OAuth, AI keys). Compose overrides `DATABASE_URL`, `REDIS_*`, `PORT` and `NODE_ENV` for the containers.

Known limitations:

- **Repair worker and Docker:** the runtime image has no `docker` CLI and Compose does not mount the host Docker socket (that would grant root on the host). The `repair-worker` can therefore only finish with an `INCONCLUSIVE` result. Run it on a host with Docker, or build an image that adds the CLI and a daemon connection you trust.
- **Shutdown:** Compose sends `SIGTERM` and waits 10 s; workers wait for the active job to finish. Consider `stop_grace_period` for the workers if jobs are long.
- **No TLS:** the bundled nginx serves plain HTTP. Put a TLS-terminating proxy in front for anything beyond local use.
- **Hosted frontend:** the Compose client is for local use. For a frontend hosted from GitHub (Vercel, Netlify, ...) see the root [README](../README.md#deploying-the-frontend-and-connecting-the-github-repository).

## 7. Release blockers (status)

Closed in code: token encryption wired and mandatory; Docker result enforced independently of the model and re-run before publishing; strict command policy; audit service; replay protection; cross-user checks; startup validation; approval-gated pull requests; deletion and retention controls.

Still open before a public launch (see `PRODUCTION_READINESS_REPORT.md` for the evidence-based status): run the Docker-backed isolation tests on a real sandbox host (`npm run test:docker`); run `prisma migrate deploy`/`migrate diff` (blocked in the build environment); exercise a real GitHub App/OAuth repository; TLS in front of the client; GitHub App for fine-grained permissions; shared rate-limit store for multiple API replicas; external security review.

## 8. Failure triage

| Symptom | Check first | Safe response |
|---|---|---|
| API exits at start | `JWT_SECRET`, database reachability, Redis reachability (realtime waits for queue events) | fix configuration; do not reset a database holding data |
| Scan stays `waiting` | scan worker running? Redis settings | Compose: `docker compose logs scan-worker`; local: start `npm run worker`; inspect job status endpoint |
| AI error at startup (`No AI provider is configured`) | `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` | set at least one real value; any one is enough |
| Docker run fails | daemon reachable from the repair worker, image pull possible | record as execution failure; never treat as verified |
| Verification `INCONCLUSIVE` | tests missing, dependencies absent (no network, no `node_modules`) | stop; improve fixture or test command |
| PR not created | verification status, token scopes, branch push errors | keep the repair unmerged; inspect redacted logs on a disposable repository |
| Live progress missing | socket auth, API↔Redis connection | query the job-status endpoint |

## 9. Operational release gate

Do not deploy publicly until the blockers in section 7 are closed and recorded with evidence.

## 10. Privacy, consent and audit

- **Per-request consent.** Every leaf AI provider is wrapped in a guard (`ai/guarded.provider.ts`). Immediately before each outbound call — including every retry and every fallback — the guard re-reads the user's privacy settings from the database and re-runs the egress policy. A mode change, withdrawn consent or an expired consent stops the next request and aborts one already in flight (its result is discarded and never returned to the pipeline). Errors are `MODE_CHANGED`, `CONSENT_EXPIRED`, `CONSENT_MISSING`, `CONSENT_OUTDATED`, …; a `PrivacyPolicyError` is never retried and never falls back to another provider.
- **Atomic settings + audit.** A settings change and its audit event are written in one database transaction; if the audit row cannot be written the change does not happen. `SecurityAuditEvent` is append-only at the database level: a trigger rejects every UPDATE and any DELETE of a row younger than 365 days (the retention purge may remove older rows).
- **What is logged.** Metadata only (event type, outcome, actor, repository, counts, hashes). Never source code, prompts, tokens or secrets; `sanitizeDetails` strips them before storage.
- **Audit history.** Users can read their own events (`GET /api/privacy/audit?limit=&cursor=`, newest first, never another user's).

## 11. Webhook lifecycle (durable acceptance)

GitHub does **not** redeliver failed deliveries automatically, so durability has to come from our database: a delivery is acknowledged as queued only once it is recoverable.

`PENDING → PROCESSING → QUEUED` (terminal: `IGNORED`, `FAILED_PERMANENT`; `FAILED_RETRYABLE` re-enters the sweep).

1. The signature is verified over the raw body, then the delivery id is recorded (`WebhookDelivery`) together with one `WebhookScanOutbox` row per target repository in a single transaction. If that write fails the endpoint returns 503 and nothing is queued, so GitHub's UI shows the failure and it can be redelivered.
2. A compare-and-set claim with a lease moves the delivery to `PROCESSING`; only one worker can hold it.
3. Each outbox row is enqueued with the deterministic BullMQ job id `github-<delivery>-<repo>`; adding an existing id is a no-op, so a crash between "enqueue" and "mark queued" cannot create duplicates.
4. A recovery loop in the scan worker re-claims deliveries whose lease expired or that are `FAILED_RETRYABLE`, with backoff and an attempt cap (then `FAILED_PERMANENT`, audited).
5. A replayed delivery id is rejected; terminal rows are purged after `WEBHOOK_RETENTION_DAYS` (default 30).

Operator view: `SELECT status, count(*) FROM "WebhookDelivery" GROUP BY 1;` Alert on any `FAILED_PERMANENT` and on `PENDING`/`PROCESSING` rows older than a few minutes.

## 12. GitHub token encryption and rotation

Stored format: `v1:<keyId>:<iv>:<tag>:<ciphertext>` (AES-256-GCM, base64url, key id as AAD). Legacy formats still recognised: `<iv>.<tag>.<ct>` (GCM under the current key) and bare plaintext.

- **Startup gate.** The API and both workers call `assertTokenStoreSecure()`. In production they refuse to start if the key is missing/invalid/low-entropy, or if any stored token is plaintext or unrecognisable. Messages contain counts only.
- **Upgrade (plaintext/legacy → v1).** Back up the database, then `npm run tokens:migrate -- --dry-run`, then `npm run tokens:migrate -- --i-have-a-backup` (in a container image: `npm run tokens:migrate:dist`). Each row is encrypted, decrypted back and compared, written with a compare-and-set, re-read and verified; if the post-write check fails or throws the original value is restored. Nothing is deleted or nulled; unreadable rows are reported by id and left untouched. Idempotent.
- **Rotate the key.** (1) Generate a new key and a new id. (2) Set `GITHUB_TOKEN_ENCRYPTION_KEY`/`_KEY_ID` to the new pair and move the old pair into `GITHUB_TOKEN_ENCRYPTION_OLD_KEYS=k1:<oldkey>`. (3) Deploy. (4) Back up, then `npm run tokens:migrate -- --rotate --i-have-a-backup`. (5) When the scan shows nothing under the old id, remove it from the old-keys list. Retired keys only decrypt; they are never used to encrypt.
- **Lost key.** Tokens cannot be recovered; users reconnect GitHub. Do not delete rows to "fix" the startup gate.

## 13. Pull-request publication, approval and recovery

`AWAITING_APPROVAL → APPROVED → REVALIDATING → TESTING → BRANCH_PUSHED → PR_CREATED → COMPLETED`, plus `NEEDS_REAPPROVAL`, `APPROVAL_REVOKED`, `PUBLISH_FAILED_RETRYABLE`, `PUBLISH_BLOCKED`.

- **Approval is bound** to the SHA-256 of the exact stored patch and to the repository base commit recorded when the patch was verified. The client sends the hash it displayed; a mismatch is refused with `409 PATCH_CHANGED`. Approving twice: one request wins, the other gets 409.
- **Before pushing**, the worker re-checks the owner's authorization and push access, that the approval still exists (revocation after approval is honoured until the branch is pushed), re-applies the patch to a fresh clone, and re-runs the tests. If the base branch moved, a file the patch touches changed → `NEEDS_REAPPROVAL`; only unrelated files changed → revalidate and continue.
- **Idempotent and crash-safe.** Every transition is a persisted compare-and-set with a lease. The branch name is deterministic (`repodoctor/fix-<patch-hash prefix>`). Position is re-derived from persisted state **and remote truth**: an existing remote branch with the identical tree is reused, a different tree blocks (never force-pushed, never overwritten), an existing open/closed/merged PR for the branch is reused and reported as such. Publish queue job ids carry a generation so a recovery re-queue is not swallowed by an old completed job.
- **Recovery.** `recoverStaleRepairJobs` runs in the repair worker: orphaned `RUNNING` loops become `INTERRUPTED`; lost approvals and expired publication leases are re-queued; after 5 attempts the job becomes `PUBLISH_BLOCKED` and the owner is told whether a branch exists on GitHub.
- **Never auto-merge.** There is no merge code path. Notifications say exactly what exists (nothing pushed / branch exists without PR / PR link).

## 14. Retention and deletion

- Per-user `retentionDays` (default 30, max 365). A daily purge deletes analyses older than the cutoff and everything hanging off them (including tables that store only the analysis id as text), except analyses with a repair still waiting for the owner's decision or publishing.
- Notifications: 90 days. Webhook deliveries: `WEBHOOK_RETENTION_DAYS`. Audit events: 365 days (also the database trigger's floor).
- "Delete my data" removes every analysis, patch, test output, repair record, memory chunk and notification, withdraws the GitHub token and consent; "delete account" also removes the user. The deletion request is audited first (fail closed) and the completion record is written in the same transaction as the deletion. Audit rows are kept for their retention period even after account deletion.
- Backups are outside RepoDoctor's control: deleted data persists in database backups until they expire; set backup retention accordingly.

## 15. Sandbox boundary evaluation

What isolates untrusted repository code, honestly:

| Layer | Protects against | Does not protect against |
|---|---|---|
| Docker default (runc) with the flags above | accidental damage, most casual escapes, network exfiltration at test time, resource exhaustion | kernel/runc vulnerabilities: a container shares the host kernel. Flags alone are **not** an isolation guarantee. |
| gVisor (`REPAIR_SANDBOX_RUNTIME=runsc`) | a large class of kernel-exploit escapes (syscalls are served by a user-space kernel) | some syscalls/features are unsupported, so a few repositories' tests may fail; performance cost; gVisor bugs |
| Rootless Docker/Podman on the sandbox host | a successful escape lands as an unprivileged user, not root | still the same kernel; slightly different networking/volume behaviour |
| Dedicated VM, no secrets, egress allow-list (169.254.169.254 blocked) | blast radius of any escape | an attacker with an escape and the host's own credentials, if any |
| Firecracker/Kata micro-VMs | strongest option (hardware virtualisation per job) | needs operator infrastructure not provided here |

Recommendation: dedicated VM **plus** gVisor (`runsc`) as the default for any deployment that processes repositories from people you do not know; set `REPAIR_REQUIRE_HARDENED_RUNTIME=true` to make that mandatory. This was evaluated by design review; gVisor was **not** installed or exercised in the build environment.

The dependency-install step is the only one with network access. It is non-root, capability-less and read-only, scripts are disabled, and `install-policy.ts` rejects repositories whose manifests/lockfiles point at hosts other than the npm/yarn registries; set `REPAIR_INSTALL_NETWORK=none` if you pre-seed an offline cache. A malicious *registry* package can still read the workspace during install and phone home: treat the install container as part of the untrusted zone.

## 16. Monitoring and incident response

Alert on: `/api/ready` false; Redis queue backlog; `WebhookDelivery` rows `FAILED_PERMANENT` or stuck `PENDING/PROCESSING`; `RepairJob` rows stuck in a publication stage; audit events `AI_EGRESS_BLOCKED`, `WEBHOOK_REJECTED`, `AUTHZ_DENIED`, `PR_BLOCKED` spikes; token-store gate failures at startup.

| Incident | Immediate actions |
|---|---|
| Suspected encryption-key leak | rotate per section 12; ask affected users to reconnect GitHub (revoking the OAuth grant on GitHub invalidates the token regardless of our key) |
| Suspected sandbox escape | isolate and destroy the sandbox VM; rotate every credential it could reach; review `repodoctor.sandbox` containers and volumes; do not reuse the host |
| Webhook secret leak | rotate `GITHUB_WEBHOOK_SECRET` in both places; inspect `WEBHOOK_REJECTED` and recent deliveries |
| Unwanted branch/PR created | confirm via `RepairJob.branchName/pullRequestNumber` and the `PR_APPROVED` audit event (patch hash); close the PR; RepoDoctor never merges |
| Data-subject deletion request | use the in-app deletion; then confirm no rows remain; note backup retention |

## 17. Known limitations

- Prisma's engines could not be downloaded where this was built: tests ran against real PostgreSQL through the pure-JS `pg` driver adapter (`PRISMA_DRIVER_ADAPTER=pg`, client generated engine-free), **not** the native query engine; `prisma migrate deploy` and `prisma migrate diff` were not run there (CI runs them).
- GitHub behaviour was exercised against a local fake of the REST endpoints used and a local bare git repository, not github.com.
- Real-container isolation tests need a Docker daemon; they skip (visibly) without one and fail with `REQUIRE_DOCKER_TESTS=true`.
- Redaction and prompt-injection defences are mitigations, not guarantees.
