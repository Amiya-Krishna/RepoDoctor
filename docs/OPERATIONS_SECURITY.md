# RepoDoctor AI — Operations, Configuration, and Security

**Scope:** operational configuration, security controls and deployment notes. status labels are defined in the [development history](DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document).

## 1. Scope

This document covers local development, configuration, the real security posture and the state of the Docker Compose file. RepoDoctor is not ready for a public deployment; section 7 lists the blockers.

## 2. Configuration

### 2.1 Prerequisites

Node.js 22, npm, Git, Docker (daemon reachable by whichever process runs the repair worker), PostgreSQL 16, Redis 7, a GitHub OAuth application, at least an OpenRouter API key (required at import time), and optionally Groq and Gemini keys.

### 2.2 Server environment variables

Names are taken from the code and `server/.env.example`. Copy `server/.env.example` to `server/.env`; never commit the result.

| Variable | In `.env.example` | Read by | Notes |
|---|:-:|---|---|
| `DATABASE_URL` | yes | Prisma datasource | PostgreSQL URL |
| `PORT` | yes (5000) | `server.ts` | default 5000 (Compose/nginx expect 4000) |
| `JWT_SECRET` | yes | auth, OAuth state, sockets | server refuses to start without it |
| `JWT_EXPIRES_IN` | no (default `1d`) | `services/auth.service.ts` | digits + `s`/`m`/`h`/`d`; invalid values fall back to `1d` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | yes | `services/github.service.ts` | OAuth |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | yes | `ai/ai.config.ts` | key **required**; import throws if empty |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL` | yes | `ai/ai.config.ts` | `.env.example` contains placeholder `...` values for Gemini |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH`, `GITHUB_TOKEN` | yes | PR service fallbacks, `test-github-pr.ts` | production repair passes owner, repo, base branch and the user's token explicitly |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | yes | `security/token-encryption.ts` | base64, 32 bytes; module is not wired into the application |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | yes | `queue/scan.queue.ts` | Compose's `REDIS_URL` is **not** read |
| `SCAN_WORKER_CONCURRENCY` | yes (2) | scan worker | |
| `REPAIR_WORKER_CONCURRENCY` | no (default 1) | repair worker | |
| `GITHUB_WEBHOOK_SECRET` | yes | webhook controller | missing → webhook returns 503 |
| `FRONTEND_URL` | yes | CORS, Socket.IO, OAuth redirect | default `http://localhost:5173` |
| `NODE_ENV` | no | cookie `secure` flag | |

Client: `VITE_API_URL` (`client/.env.example`; default `http://localhost:5000/api`; the client Docker build uses `/api`).

Compose-level: `POSTGRES_PASSWORD` and `REDIS_PASSWORD` must be set in the shell or a root `.env` file (Compose refuses to start otherwise).

### 2.3 Local run (outside Docker) — commands match the manifests; not executed

```powershell
# terminal 0: PostgreSQL and Redis must already be running and match server/.env
cd server
npm install                 # postinstall runs `prisma generate`
npx prisma migrate deploy   # or: npm run prisma:deploy
npm run dev                 # API + Socket.IO (tsx watch src/server.ts)
```

```powershell
cd server; npm run worker          # scan worker
cd server; npm run repair-worker   # repair worker (needs git, Docker daemon, GitHub token in DB)
cd client; npm install; npm run dev
```

Do not run `prisma migrate reset` against data that must be kept. Before applying migrations to a shared database, back it up and review the SQL.

## 3. Security control status

| Control | Where | Status | Evidence / caveat |
|---|---|---|---|
| Password hashing | `services/auth.service.ts` | Implemented, not yet verified | bcryptjs, cost 10 |
| JWT sessions | `middleware/auth.middleware.ts` | Partially implemented | 1-day tokens, no refresh/revocation |
| Authorization by ownership | controllers | Implemented, not yet verified | queries filter by `userId` through `Repository`; no cross-user tests exist |
| OAuth CSRF state | `github.controller.ts` | Implemented, not yet verified | signed JWT, 10 min, HttpOnly cookie match |
| Webhook HMAC | `github/github-webhook.signature.ts` | **Implemented and verified (unit)** | `npm run test:webhook-signature` passed on 11 Oct 2026 |
| API rate limiting | `middleware/rate-limit.middleware.ts`, `app.ts` | Implemented (loads in `npm run test:app`) | in-memory store; set `TRUST_PROXY=1` behind a reverse proxy (Compose does) |
| GitHub token encryption at rest | `security/token-encryption.ts` | Implemented (unit verified), opt-in | AES-256-GCM; since audit 2 the OAuth callback stores `protectToken(token)` and the controllers/workers read with `revealToken`. Encrypts only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set; legacy plaintext values still read. Not verified against a live database |
| Token kept out of containers | repair worker, runner | Implemented, not yet verified | Docker receives only `REPO_DOCTOR_ATTEMPT` |
| Token kept out of URLs/args | ingestion, worker, PR service | Implemented, not yet verified | passed via `GIT_CONFIG_*` environment |
| Sandboxed test execution | `execution/docker.runner.ts` | Implemented, not yet verified | `--network none`, 512 MB, 1 CPU, 128 PIDs, `--cap-drop ALL`, `no-new-privileges`, read-only root, `noexec` tmpfs, 120 s timeout; workspace bind-mounted read-write; no `--user`; no seccomp/AppArmor profile specified |
| Command allow-listing | `controllers/repair.controller.ts` | Partially implemented | first argv must be `node`/`npm`/`npx`/`pnpm`/`yarn`, arrays only, ≤ 20 parts; `node -e` and `npx <pkg>` are allowed. `security/test-command-policy.ts` is stricter but unused |
| Patch validation | `repair/repair.patch.ts` | Implemented, not yet verified | rejects absolute, `..`, escaping paths; checks ranges and original code; no symlink check, no size/file-count cap |
| Bounded retries | `retry.policy.ts` | Implemented, not yet verified | 3 attempts; queue-level attempts 1 |
| Verification gate | `services/verification-gate.ts`, `pull-request.service.ts` | Implemented and verified (unit) | model verdict plus `testPassed`, no regression, confidence ≥ 0.7; since audit 2 a `VERIFIED` verdict is downgraded unless the Docker run exited 0 without timing out (`npm run test:verification-gate`) |
| Prompt-injection handling | `rag` formatter; `security/untrusted-context.ts` | Partially implemented | retrieved memory carries a warning; the wrapper is still unused, but its leftover literal `$DIL1`/`$DIL2` delimiters were replaced by a per-call random nonce (audit 2) |
| Static secret/SAST checks | `security/static-security-scanner.ts` | **Implemented and verified (unit)** | six regex rules; not a SAST replacement |
| Audit logging | `SecurityAuditEvent` table | Planned / not implemented | table and migration only; `security-audit.service.ts` is empty; console logging only |
| Secret redaction in memory | `rag/chunker.ts` | Implemented, not yet verified | regex redaction before indexing |
| CORS | `app.ts`, `realtime/socket.ts` | Implemented, not yet verified | single origin from `FRONTEND_URL`; no `helmet`/security headers |
| Request size | `express.json` default | Implemented, not yet verified | default 100 kB body limit |

### 3.1 Non-negotiable invariants (design intent)

Source immutability; repository and model output treated as untrusted; no repository code on the host; no credentials in the test container; conservative verification (`FAILED` and `INCONCLUSIVE` are never success); verified-only publication; no force-push, no default-branch push, no merge. The code supports most of these by construction; items marked above are not yet proven by tests.

### 3.2 Threats worth testing before any real use

Malicious repository scripts or symlinks; prompt injection in README/comments; oversized or malicious AI patches; forged or replayed webhooks; cross-user access to repository, analysis, finding or job ids; token leakage through logs; resource exhaustion through large repositories, long prompts or long tests; false confidence from weak tests or an over-trusting verification model.

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

Required variables (root `.env`, template `.env.example`): `DATABASE_URL` and `REDIS_PASSWORD` (or `POSTGRES_PASSWORD` instead of `DATABASE_URL` with the `bundled-db` profile; use URL-safe characters because it is embedded in the database URL).

**Neon:** use the direct (non-pooled) connection string with `sslmode=require&connect_timeout=30`. Pooled (PgBouncer) endpoints can break `prisma migrate deploy`, and the schema declares no separate direct URL. Neon computes that scale to zero take a moment to wake, so the first `migrate` run may be slow. Use a Neon branch for test runs. A filled-in `server/.env` is also required (`JWT_SECRET`, GitHub OAuth, AI keys). Compose overrides `DATABASE_URL`, `REDIS_*`, `PORT` and `NODE_ENV` for the containers.

Known limitations:

- **Repair worker and Docker:** the runtime image has no `docker` CLI and Compose does not mount the host Docker socket (that would grant root on the host). The `repair-worker` can therefore only finish with an `INCONCLUSIVE` result. Run it on a host with Docker, or build an image that adds the CLI and a daemon connection you trust.
- **Shutdown:** Compose sends `SIGTERM` and waits 10 s; workers wait for the active job to finish. Consider `stop_grace_period` for the workers if jobs are long.
- **No TLS:** the bundled nginx serves plain HTTP. Put a TLS-terminating proxy in front for anything beyond local use.
- **Verification status:** `docker compose config` validates the file.

## 7. Release blockers (security and operations)

Before any public deployment: resolve the Compose limitations above; run a clean install and build; make token encryption real (wire it in, migrate existing tokens, manage the key outside the database); enforce the Docker result independently of the model; use the stricter command policy; wire the audit service; add `trust proxy` and a shared rate-limit store if more than one API instance is used; add cross-user authorization tests; add TLS, backups, log retention, health checks and a rollback procedure.

## 8. Failure triage

| Symptom | Check first | Safe response |
|---|---|---|
| API exits at start | `JWT_SECRET`, database reachability, Redis reachability (realtime waits for queue events) | fix configuration; do not reset a database holding data |
| Scan stays `waiting` | scan worker running? Redis settings | start `npm run worker`; inspect job status endpoint |
| AI error at startup | `OPENROUTER_API_KEY` | set it; the other providers cannot substitute because config import throws |
| Docker run fails | daemon reachable from the repair worker, image pull possible | record as execution failure; never treat as verified |
| Verification `INCONCLUSIVE` | tests missing, dependencies absent (no network, no `node_modules`) | stop; improve fixture or test command |
| PR not created | verification status, token scopes, branch push errors | keep the repair unmerged; inspect redacted logs on a disposable repository |
| Live progress missing | socket auth, API↔Redis connection | query the job-status endpoint |

## 9. Operational release gate

Do not deploy publicly until the blockers in section 7 are closed and recorded with evidence.
