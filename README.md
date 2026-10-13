# RepoDoctor AI

**AI-assisted analysis and verification-gated repair for JavaScript and TypeScript repositories.**

RepoDoctor AI connects to a user's GitHub repositories, builds a repository snapshot and context, runs AI-assisted bug and security analysis with a deterministic risk score, and can attempt a repair: generate a patch, apply it in a disposable workspace, run tests in a network-less Docker container, ask a verification step to judge the evidence, retry up to three times, and open a GitHub pull request **only if verification succeeds**. It never merges pull requests.

The project is Docker-based: the supported way to run the whole stack is `docker compose up`. Docker is also what the repair worker uses to run a repository's tests in isolation.

## Contents

[Quick start](#quick-start-docker-compose) · [Accounts](#registration-and-login) · [Status](#implementation-status) · [Architecture](#architecture) · [Stack](#technology-stack) · [Local development](#local-development-without-compose) · [Tests](#testing) · [Security](#security-boundaries) · [Troubleshooting](#troubleshooting) · [Limitations](#known-limitations) · [Docs](#documentation)

## Quick start (Docker Compose)

Prerequisites: Docker Engine 24+ with the Compose plugin, and a GitHub OAuth app (only needed for the GitHub features; registration and login work without it).

```bash
# 1. Configure
cp .env.example .env                 # set DATABASE_URL (your Neon connection string) and REDIS_PASSWORD
cp server/.env.example server/.env   # set JWT_SECRET (long random string), GitHub OAuth values, at least one AI key
# Optional: GITHUB_TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
# For Compose set in server/.env: FRONTEND_URL=http://localhost:8080 and
# GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback

# 2. Build and start (migrations, Redis, API, both workers, client)
docker compose up --build -d
docker compose ps                    # server should become "healthy"

# 3. Open the app
#    http://localhost:8080

# Logs / stop / stop and delete data
docker compose logs -f server
docker compose down                  # keeps the database and Redis volumes
docker compose down -v               # DELETES the database and Redis volumes
```

Only the client is published (port 8080). nginx proxies `/api/` and `/socket.io/` to the API. The `migrate` service applies the Prisma migrations to the database in `DATABASE_URL` before the API starts.

**Neon:** put the Neon connection string in the root `.env` as `DATABASE_URL`. Use the **direct** (non-pooled) endpoint (no `-pooler` in the host), keep `sslmode=require`, and add `connect_timeout=30` so a scaled-to-zero compute has time to wake. A pooled (PgBouncer) endpoint can break `prisma migrate deploy`; if you want pooling for the app, that requires a separate direct URL for migrations, which this project does not configure. Create a Neon **branch** for testing so test users and data never touch your main database. To run the bundled PostgreSQL instead, leave `DATABASE_URL` unset, set `POSTGRES_PASSWORD` (URL-safe characters) and start with `docker compose --profile bundled-db up --build -d`. Deployment details and limitations (notably: the repair worker has no Docker daemon inside Compose) are in [Operations §6](docs/OPERATIONS_SECURITY.md#6-docker-compose-deployment).

## Registration and login

Open the client, choose **Create an account**, enter a name, an email address and a password of 8–128 characters. Registration signs you in; later use **Log in**. Sessions are JWTs (lifetime `JWT_EXPIRES_IN`, default `1d`) kept in the browser; an expired or invalid token returns you to the login form.

Check it from the command line against a running stack (replace the port with `5000` when running the API locally):

```bash
curl -s -X POST http://localhost:8080/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"you@example.test","password":"a-long-password"}'
curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.test","password":"a-long-password"}'
```

Behaviour: invalid input returns `400`; an existing email (any letter case, including concurrent requests) returns `409`; wrong password and unknown user both return the same `401` message; passwords are stored only as bcrypt hashes and never returned; authentication endpoints are rate limited to 10 failed attempts per 15 minutes per client.

## Implementation status

Status labels are defined in the [development history](docs/DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document). "Verified" means a named check was executed; see [Testing](docs/TESTING_EVALUATION_DEMO.md).

| Capability | Status |
|---|---|
| Registration, login, JWT-protected routes (bcrypt) | **Implemented and verified** (API, database and browser tests); no refresh tokens |
| GitHub OAuth with signed, cookie-bound state | Partially implemented (token stored unencrypted) |
| Repository sync, list, delete | Implemented, not yet verified |
| Ingestion (shallow clone, temp workspace) and analyzer snapshot | Partially implemented |
| LLM provider manager (OpenRouter → Groq → Gemini) | Implemented, not yet verified |
| Context builder (first 30 JS/TS files ≤ 50 KB) | Partially implemented |
| Bug detection agent | Implemented, not yet verified |
| Security agent + six-rule static scanner | Partially implemented; scanner **verified (unit)** |
| Test generation agent | Partially implemented (output never persisted or executed) |
| Deterministic risk engine | **Implemented and verified (unit)** |
| Fix agent, disposable workspace, patch validation | Implemented, not yet verified |
| Docker test runner | Partially implemented (no command detection; no dependency installation) |
| Verification agent | Partially implemented (model verdict; exit code not independently enforced) |
| Bounded retry (3) with re-planning | Implemented, not yet verified |
| Verified-only pull request publication | Implemented, not yet verified |
| End-to-end repair flow | Implemented, not yet verified (never demonstrated) |
| BullMQ queues and two worker processes | Implemented, not yet verified |
| GitHub webhooks | Signature **verified (unit)**; delivery not yet verified |
| Socket.IO real-time progress | Implemented, not yet verified |
| Repository memory (lexical hashed-vector retrieval) | Partially implemented |
| Benchmark evaluator and 5-case fixture | Evaluator **verified (unit)**; **no measured results** |
| Rate limiting | **Implemented and verified** (`test:app`) |
| Token encryption, strict command policy, untrusted-context wrapper | Partially implemented (modules exist, not wired in) |
| Audit logging | Planned / not implemented (table only) |
| Docker Compose deployment (PostgreSQL, Redis, API, workers, client) | Implemented; `docker compose config` validates; images not yet built in CI-less verification (see Testing) |
| CI/CD, AWS deployment, refresh tokens | Planned / not implemented |
| Real screenshots, demo recording, licence file | Planned / not implemented |

## Architecture

```text
Developer ─ React client ──REST + JWT──▶ Express API ──▶ PostgreSQL (Prisma)
                 ▲  Socket.IO + JWT          │  ▲
                 │                           │  │ webhook (HMAC)  GitHub
                 │                           ▼  │
                 │              Redis / BullMQ: repository-scan │ autonomous-repair
                 │                  │                          │
                 │            Scan worker               Repair worker
                 │                  │                          │
                 │   clone → snapshot → context → memory   clone → retry loop (max 3):
                 │   → bug / security / test agents          fix agent → patch in workspace
                 │   → risk engine → DB                      → Docker tests → verification
                 │                                            ├ VERIFIED → branch + PR
                 └──────── progress events ◀──────────────────┤ INCONCLUSIVE → stop
                                                              └ FAILED → re-plan or stop
```

See [Architecture](docs/ARCHITECTURE.md) for the full reference diagram, API surface and trust boundaries.

## Core workflow

GitHub integration → repository ingestion → repository context → bug, security and test analysis → risk scoring → repair proposal → isolated execution → verification → retry or stop → pull request only if verified. Human review and merge follow outside RepoDoctor.

## Technology stack

| Area | Technology (from the code and manifests) |
|---|---|
| Frontend | React 19, TypeScript, Vite, axios, socket.io-client |
| API | Node 22, Express 5, TypeScript (ESM/NodeNext) |
| Database | **PostgreSQL with Prisma 6** (the original plan mentioned MongoDB; it is not used; this is not a MERN app) |
| Jobs | Redis, BullMQ 5, two worker processes |
| Live progress | Socket.IO 4, JWT handshake, per-user rooms |
| AI | `AIProviderManager`: OpenRouter → Groq → Gemini |
| Execution | Docker (`node:22-bookworm-slim`, `--network none`) |
| GitHub | OAuth, REST, git over HTTPS, signed webhooks, pull requests |

## Local development (without Compose)

Prerequisites: Node.js 22, npm, Git, a PostgreSQL 16 database (Neon or local), Redis 7 (Docker only for the repair worker).

```bash
cd server
cp .env.example .env                 # fill in values (DATABASE_URL = Neon direct connection string); never commit .env
npm install                          # runs prisma generate (postinstall)
npx prisma migrate deploy            # never `migrate reset` on data you need
npm run dev                          # API + Socket.IO on PORT (default 5000)
npm run worker                       # scan worker (separate terminal)
npm run repair-worker                # repair worker (needs git and Docker)

cd ../client
npm install
npm run dev                          # http://localhost:5173 (API default http://localhost:5000/api, override with VITE_API_URL)
```

Configuration notes: `JWT_EXPIRES_IN` is digits plus `s`/`m`/`h`/`d` (invalid values fall back to `1d`); Redis uses `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` (not a URL); without `GITHUB_TOKEN_ENCRYPTION_KEY` GitHub tokens are stored as plain text and a warning is logged; set `TRUST_PROXY=1` behind a reverse proxy; at least one AI provider key is required for analysis. Full variable reference: [Operations §2](docs/OPERATIONS_SECURITY.md#2-configuration).

## Testing

```bash
# Server (from server/; needs a migrated PostgreSQL, Redis, JWT_SECRET; export REDIS_PASSWORD for queue tests)
# `test:auth` and `test:rag` write to DATABASE_URL: point it at a Neon branch, not your main database
npx tsc --noEmit && npm run build
npm run test:auth                    # registration + login against the real app and database
npm run test:app                     # and the other scripts: npm run test:<name>
# Client (from client/)
npm run lint && npm run build
# Compose file
docker compose config -q
# Browser end-to-end for registration/login (needs a running API + client; first time: npx playwright install chromium)
npm run test:e2e                     # E2E_BASE_URL overrides the client URL (default http://localhost:5173)
```

Server `test:*` scripts are standalone programs, not a test framework; which ones need AI keys, repository paths or existing database rows is listed in [Testing §2](docs/TESTING_EVALUATION_DEMO.md#2-test-inventory). Step-by-step manual checks are in the [manual testing guide](docs/MANUAL_TESTING_GUIDE.md).

## Security boundaries

By design: fixes are applied only in disposable workspaces; repository tests run only in Docker with no network, dropped capabilities, resource limits and a 120-second timeout; the GitHub token is passed to git through environment variables, never into the container or URLs; retries are bounded to three; `INCONCLUSIVE` stops the loop; publication requires a verified result and never force-pushes, pushes the default branch or merges; webhooks require a valid HMAC; repository text, test output and model output are treated as untrusted.

Gaps (see [Operations §3](docs/OPERATIONS_SECURITY.md#3-security-control-status)): the verification verdict comes from an LLM, but a `VERIFIED` verdict is downgraded unless the Docker run exited 0 without timing out; GitHub tokens are encrypted only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set; the strict command policy, untrusted-context wrapper and audit logging are not connected; no cross-user authorization tests exist.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose` says a variable is required | create the root `.env` from `.env.example` (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`) and `server/.env` from `server/.env.example` |
| `server` never becomes healthy | `docker compose logs server migrate`; usually `JWT_SECRET` missing or a database URL problem |
| `migrate` fails with a timeout, `P1001`, SSL or advisory-lock error on Neon | use the direct (non-pooled) URL with `sslmode=require&connect_timeout=30`; the first connection after idle can be slow while Neon wakes the compute |
| Login shows "Cannot reach the server" | API not running or `VITE_API_URL` wrong (Compose uses `/api` through nginx) |
| "Too many authentication attempts" | the auth rate limit (10 failures / 15 min) — wait, or restart the API in development |
| Scans stay `waiting` | the scan worker is not running or cannot reach Redis |
| Repair ends `INCONCLUSIVE` under Compose | the repair worker has no Docker daemon (see Limitations) |
| Queue test scripts hang | export `REDIS_PASSWORD` in the shell first; the scripts do not read `server/.env` |

## Benchmark

An evaluator, a CLI and a five-case seeded fixture exist, but **no benchmark has been run**, so there are no precision, recall or repair-rate results. `server/benchmarks/seeded-repo/run-results.example.json` is hand-written illustration. Method and the empty results table: [Testing §6](docs/TESTING_EVALUATION_DEMO.md#6-seeded-defect-benchmark).

## Known limitations

- Docker image builds and `docker compose up` were not executed in the most recent verification environment because it could not pull base images; the Compose file validates with `docker compose config`. Run the Quick start on a machine with registry access to confirm.
- The database-backed tests were run against a local PostgreSQL (the verification environment could not download Prisma's engines, so it used Prisma's engine-less client with the same schema and the SQL migrations applied directly). **Neon itself was not tested**, and neither were `prisma migrate deploy` or schema/migration drift.
- In Compose the repair worker has no Docker daemon, so repairs there end `INCONCLUSIVE`.
- Generated tests are saved with the analysis but are never executed.
- Test execution has no network and the clone has no `node_modules`, so repositories whose tests need installed packages fail or are inconclusive; test commands are supplied by the caller, not detected.
- Context selection is the first 30 JS/TS files, not finding-relevant files; repository memory is lexical and rebuilt on every scan.
- Static security rules are line-based heuristics, not SAST or dependency auditing.
- Fork pull requests from webhooks are intentionally ignored.
- No screenshots, demo recording, CI configuration or repository licence file (`server/package.json` says ISC).

## Documentation

1. [Architecture](docs/ARCHITECTURE.md) — reference diagram, stack, API surface, flows, trust boundaries.
2. [Operations and security](docs/OPERATIONS_SECURITY.md) — environment variables, security controls, Compose deployment, failure triage.
3. [Testing, evaluation and demo](docs/TESTING_EVALUATION_DEMO.md) — script inventory, benchmark method, demo protocol, release checklist.
4. [Manual testing guide](docs/MANUAL_TESTING_GUIDE.md) — setup and functional test cases.
5. [Development history](docs/DEVELOPMENT_HISTORY.md) — day-by-day development log of the 30-day plan.
6. [Server](server/README.md) and [client](client/README.md) notes.

