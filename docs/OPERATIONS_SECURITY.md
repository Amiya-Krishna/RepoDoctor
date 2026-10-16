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
| GitHub token encryption at rest | `security/token-encryption.ts` | Implemented , opt-in | AES-256-GCM; The OAuth callback stores `protectToken(token)` and the controllers/workers read with `revealToken`. Encrypts only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set; legacy plaintext values still read. |
| Token kept out of containers | repair worker, runner | Implemented | Docker receives only `REPO_DOCTOR_ATTEMPT` |
| Token kept out of URLs/args | ingestion, worker, PR service | Implemented |  Via `GIT_CONFIG_*` environment |
| Sandboxed test execution | `execution/docker.runner.ts` | Implemented | `--network none`, 512 MB, 1 CPU, 128 PIDs, `--cap-drop ALL`, `no-new-privileges`, read-only root, `noexec` tmpfs, 120 s timeout; workspace bind-mounted read-write; no `--user`; no seccomp/AppArmor profile specified |
| Command allow-listing | `controllers/repair.controller.ts` | Partially implemented | first argv must be `node`/`npm`/`npx`/`pnpm`/`yarn`, arrays only, ≤ 20 parts; `node -e` and `npx <pkg>` are allowed. `security/test-command-policy.ts` is stricter but unused |
| Patch validation | `repair/repair.patch.ts` | Implemented | rejects absolute, `..`, escaping paths; checks ranges and original code; no symlink check, no size/file-count cap |
| Bounded retries | `retry.policy.ts` | Implemented | 3 attempts; queue-level attempts 1 |
| Verification gate | `services/verification-gate.ts`, `pull-request.service.ts` | Implemented and verified (unit) | model verdict plus `testPassed`, no regression, confidence ≥ 0.7; since audit 2 a `VERIFIED` verdict is downgraded unless the Docker run exited 0 without timing out (`npm run test:verification-gate`) |
| Prompt-injection handling | `rag` formatter; `security/untrusted-context.ts` | Partially implemented | retrieved memory carries a warning |
| Static secret/SAST checks | `security/static-security-scanner.ts` | Implemented  | six regex rules; not a SAST replacement |
| Audit logging | `SecurityAuditEvent` table | Planned / not implemented | table and migration only; `security-audit.service.ts` is empty |
| Secret redaction in memory | `rag/chunker.ts` | Implemented | regex redaction before indexing |
| CORS | `app.ts`, `realtime/socket.ts` | Implemented | single origin from `FRONTEND_URL`; no `helmet`/security headers |
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

## 7. Release blockers (security and operations)

Before any public deployment: resolve the Compose limitations above; run a clean install and build; make token encryption real (wire it in, migrate existing tokens, manage the key outside the database); enforce the Docker result independently of the model; use the stricter command policy; wire the audit service; add `trust proxy` and a shared rate-limit store if more than one API instance is used; add cross-user authorization tests; add TLS, backups, log retention, health checks and a rollback procedure.

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
