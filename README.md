# RepoDoctor AI

**AI-assisted analysis and verification-gated repair for JavaScript and TypeScript repositories.**

RepoDoctor AI connects to a user's GitHub repositories, builds a repository snapshot and context, runs AI-assisted bug and security analysis with a deterministic risk score, and can attempt a repair: generate a patch, apply it in a disposable workspace, run tests in a network-less Docker container, ask a verification step to judge the evidence, retry up to three times, and open a GitHub pull request **only if verification succeeds**. It never merges pull requests.

The project is Docker-based: the supported way to run the whole stack is `docker compose up`. Docker is also what the repair worker uses to run a repository's tests in isolation.

## Contents

[Quick start](#quick-start-docker-compose) · [Verification status](#what-was-verified-and-what-was-not) · [Deploying the frontend](#deploying-the-frontend-and-connecting-the-github-repository) · [Accounts](#registration-and-login) · [Status](#implementation-status) · [Architecture](#architecture) · [Stack](#technology-stack) · [Local development](#local-development-without-compose) · [Tests](#testing) · [Security](#security-boundaries) · [Troubleshooting](#troubleshooting) · [Limitations](#known-limitations) · [Docs](#documentation)

## Quick start (Docker Compose)

### Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`). The commands below were checked with Docker 29 and Compose v5.
- Access to Docker Hub (images `node:22-bookworm-slim`, `nginx:alpine`, `redis:7-alpine`, and `postgres:16-alpine` for the bundled database) and to `binaries.prisma.sh` / the npm registry during image builds.
- A PostgreSQL 16 database: either an external one such as Neon (default) or the bundled container (`bundled-db` profile).
- At least **one** AI provider key (`OPENROUTER_API_KEY`, `GROQ_API_KEY` or `GEMINI_API_KEY`) for analysis and repair.
- A GitHub OAuth app, only for the GitHub features (registration and login work without it).
- Commands are written for bash/zsh. On Windows use Git Bash or WSL; in PowerShell use `Copy-Item` instead of `cp`, run each command on its own line (Windows PowerShell 5.1 has no `&&`), and generate secrets with the `node -e` commands shown below.

### Environment setup

```bash
cp .env.example .env                 # root file read by `docker compose`
cp server/.env.example server/.env   # API and worker settings (required: compose fails without this file)
```

Root `.env`:

- `REDIS_PASSWORD`: **required**, any long random string. `docker compose` stops with `required variable REDIS_PASSWORD is missing a value` if it is empty.
- Database, choose one:
  - **External (default, e.g. Neon):** set `DATABASE_URL` (direct, non-pooled endpoint, `sslmode=require`, `connect_timeout=30`).
  - **Bundled PostgreSQL:** comment out `DATABASE_URL`, set `POSTGRES_PASSWORD` (letters, digits, `-`, `_` only) and add `--profile bundled-db` to every `docker compose` command below.

`server/.env` (values for the containers; Compose itself overrides `DATABASE_URL`, `REDIS_*`, `PORT` (4000), `NODE_ENV` and `TRUST_PROXY`):

- `JWT_SECRET`: required, long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- At least one AI key (see prerequisites).
- `FRONTEND_URL=http://localhost:8080`: **change this from the template's `http://localhost:5173`**, otherwise the GitHub OAuth redirect and Socket.IO CORS point at the wrong origin.
- `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback`, and the same URL as the *Authorization callback URL* of your GitHub OAuth app. Also set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
- Optional: `GITHUB_TOKEN_ENCRYPTION_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and `GITHUB_WEBHOOK_SECRET`.

### Start, use and stop

```bash
docker compose config -q             # validates both env files and the interpolation; prints nothing on success
docker compose up --build -d         # (add --profile bundled-db for the bundled PostgreSQL)
docker compose ps                    # server -> healthy; migrate -> exited (0)
docker compose logs -f server        # follow logs (also: scan-worker, repair-worker, migrate, client)
docker compose down                  # stop and remove containers; keeps the Redis (and bundled PostgreSQL) volumes
docker compose down -v               # ALSO DELETES the volumes: Redis data and, with the profile, the bundled database
```

Status: `docker compose config -q` was run and passes; `up`, `ps`, `logs` and `down` were **not executed** (Docker Hub unreachable in the audit environment), so treat them as unverified until you run them.

When you started the stack with `--profile bundled-db`, pass the same flag to `docker compose down` so the `postgres` container is stopped too.

### Database initialisation

There is no manual step. The one-shot `migrate` service runs `npx prisma migrate deploy` against the database in `DATABASE_URL` (or the bundled PostgreSQL) and the API and both workers start only after it exits successfully. There are 16 migrations in `server/prisma/migrations/`. To see what happened: `docker compose logs migrate`. Never run `prisma migrate reset` against data you need.

### Services and URLs

| Service | Reachable at | Notes |
|---|---|---|
| Web client (nginx) | http://localhost:8080 | the **only published port** |
| API through nginx | http://localhost:8080/api/health | proxied to `server:4000` |
| Socket.IO | `http://localhost:8080/socket.io/` | proxied by nginx, used by the client for live progress |
| API (`server`), `scan-worker`, `repair-worker`, `redis`, `postgres` | Compose networks only | no host ports; use `docker compose exec` / `logs` |

Registration and login can be tried straight away at http://localhost:8080 (see below).

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

## Deploying the frontend and connecting the GitHub repository

This section is configuration guidance derived from the files in this archive. No GitHub account, hosting dashboard or deployed site was accessible while writing it, so **nothing here was applied or verified remotely**.

### What the archive shows

- The project root is **not a git repository** (no `.git` at the root). The only `.git` directory is inside `test-generation-repo/`, whose `origin` is a different repository (`RepoDoctor-Test`); the root `.gitignore` excludes that folder and the other fixture folders, so the nested repository is never committed to the main one.
- There is **no deployment configuration** for a hosted frontend: no `.github/workflows/`, `vercel.json`, `netlify.toml` or similar. A host connected to the GitHub repository therefore has no build instructions and must be configured by hand.
- The frontend lives in `client/`, not the repository root. A host that builds from the root finds no `package.json` there and fails or serves nothing.
- The frontend is only a static build. The API, Redis, PostgreSQL and both workers cannot run on a static host and must be deployed separately (for example with `docker-compose.yml` on a server). Without a reachable API the deployed UI cannot log in.
- `VITE_API_URL` is read at **build time**. If it is not set when the host builds, the bundle falls back to `http://localhost:5000/api` (verified by building both ways), which a visitor's browser cannot reach.

### Steps to connect the repository (run by the project owner)

1. Create (or choose) the GitHub repository for the project root and link it from a clean checkout of this folder:
   ```bash
   git init -b main
   git remote add origin https://github.com/<owner>/<repo>.git
   git add -A
   git status            # confirm no .env files are staged; only the three .env.example files should appear
   git commit -m "Initial commit"
   git push -u origin main
   ```
   In a scratch copy, `git add -A` tracked the three `.env.example` files, no real `.env`, and none of `test-generation-repo/`, `bug-test-repo/`, `security-test-repo/`.
2. In your frontend host (Vercel, Netlify, Cloudflare Pages, Render static site, ...), import that GitHub repository and use:

   | Setting | Value |
   |---|---|
   | Root / base directory | `client` |
   | Node version | 22 |
   | Install command | `npm ci` |
   | Build command | `npm run build` |
   | Output / publish directory | `dist` |
   | Environment variable | `VITE_API_URL=https://<your-api-host>/api` (must end in `/api`; applied at build time, so **redeploy after changing it**) |
   | SPA fallback | rewrite every unknown path to `/index.html` (what `client/nginx.conf` does for Docker) |

3. Deploy the API stack to a host with HTTPS and WebSocket support and set, in `server/.env` / the host's environment:
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://<your-frontend-host>`: the exact origin, with scheme and **no trailing slash**. CORS (`app.ts`) and Socket.IO (`realtime/socket.ts`) compare it literally, and the OAuth callback redirects back to it. In production the `localhost` allowance is disabled.
   - `GITHUB_CALLBACK_URL=https://<your-api-host>/api/github/callback`, identical to the *Authorization callback URL* in the GitHub OAuth app settings (GitHub → Settings → Developer settings → OAuth Apps).
   - `GITHUB_WEBHOOK_SECRET` and, in the repository's webhook settings, payload URL `https://<your-api-host>/api/github/webhook`, content type `application/json`, the same secret.
   - `TRUST_PROXY=1` behind one reverse proxy, plus the Redis and database settings described above.
4. Keep the frontend and API on the **same site**. The OAuth state cookie (`github_oauth_state`) is set by an XHR to `/api/github/connect` with `SameSite=Lax`; browsers do not store such a cookie from a response to a cross-site request, after which the callback answers `400 Invalid GitHub OAuth state`. This follows from the code and standard browser cookie rules and was not tested here. Either:
   - serve both under one registrable domain (for example `app.example.com` and `api.example.com`), or
   - make the frontend host proxy `/api/` and `/socket.io/` to the API (exactly what `client/nginx.conf` does) and build with `VITE_API_URL=/api`.
   Default `*.vercel.app` / `*.onrender.com` style hostnames are different sites from each other, so use a custom domain or the proxy approach.
5. After deploying, check from your own machine: `curl -i https://<your-api-host>/api/health` returns `200`; opening the frontend shows no CORS or `localhost:5000` errors in the browser console; **Connect GitHub** completes and returns to the frontend.

### Symptom → cause

| Symptom on the deployed frontend | Cause |
|---|---|
| Requests go to `http://localhost:5000/api` | `VITE_API_URL` was not set during the host's build |
| Host build fails (`package.json` not found) or serves an empty site | root directory not set to `client` |
| Refreshing a deep link gives 404 | no SPA rewrite to `index.html` |
| CORS "Network Error" on login | `FRONTEND_URL` differs from the page origin (typo, `http` vs `https`, trailing slash, `www`) |
| After GitHub authorisation: `Invalid GitHub OAuth state` | cookie not stored (cross-site API, step 4) or `GITHUB_CALLBACK_URL` differs from the one registered at GitHub |
| GitHub says `redirect_uri` mismatch | OAuth app callback URL does not equal `GITHUB_CALLBACK_URL` |
| Live progress never appears | WebSocket upgrade blocked by the API host/proxy, or `FRONTEND_URL` mismatch for Socket.IO |
| Pushes to GitHub do not trigger a scan | webhook URL/secret wrong; the API must be publicly reachable |

## Implementation status

Status labels are defined in the [development history](docs/DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document).

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
| Docker Compose deployment (PostgreSQL, Redis, API, workers, client) | Implemented; `docker compose config` validates; images not yet built or run (see [verification status](#what-was-verified-and-what-was-not)) |
| CI/CD, AWS deployment, refresh tokens | Planned / not implemented |
| Real screenshots, demo recording, licence file | Planned / not implemented |

## What was verified and what was not

This documentation was audited on 14 October 2026 in a sandbox whose network policy blocked Docker Hub (`registry-1.docker.io` returned 403) and `binaries.prisma.sh` (403). The Docker daemon itself could be started, but no image could be pulled. Results, stated exactly:

| Check | Result |
|---|---|
| `docker compose config -q` with root `.env` and `server/.env` present | **Passed** (exit 0), default and `--profile bundled-db` |
| Same command with `REDIS_PASSWORD` empty / missing `server/.env` | **Fails as documented** (`required variable REDIS_PASSWORD is missing a value`; `env file ... server/.env not found`) |
| Rendered config with the bundled profile | `DATABASE_URL` becomes `postgresql://repodoctor:<POSTGRES_PASSWORD>@postgres:5432/repodoctor?schema=public`; only port `8080` is published |
| `docker compose build` / `up` / `down` | **Not executed** (images could not be pulled). Commands are taken from `docker-compose.yml` and the Dockerfiles |
| `client`: `npm ci`, `npm run lint`, `npm run build` | **Passed** (no lint output; Vite build succeeded) |
| `client`: `VITE_API_URL=https://api.example.test/api npm run build` | The URL is embedded in the bundle; without the variable the bundle contains `http://localhost:5000/api` |
| All 16 `migration.sql` files applied in order with `psql` on local PostgreSQL 16 | **Passed**: 16 tables created. This is **not** `prisma migrate deploy` |
| `npx prisma generate`, `prisma migrate deploy`, `npm run build` in `server/` | **Not executed** (Prisma engine download blocked). Without a generated client `tsc` reports `TS7006` and missing `PrismaClient` errors, so a server build result is unknown here |
| `redis-server --requirepass` + `redis-cli -a ... ping` | **Passed** (`PONG`, Redis 7.0.15; the Compose image is `redis:7-alpine`, not tested) |
| Server scripts `test:webhook-signature`, `test:static-security`, `test:risk-engine`, `test:benchmark`, `test:verification-gate`, `test:security` | **Passed** (exit 0, no database or Redis needed) |
| `test:app`, `test:rag`, `test:auth` and every script that imports Prisma | **Not executed** (need a generated Prisma client; `test:auth` also needs a database) |
| Neon, GitHub OAuth, webhooks, AI providers, repair flow, Playwright e2e | **Not tested** |

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

Prerequisites: Node.js 22, npm, Git, a PostgreSQL 16 database (Neon or local), Redis 7 (and Docker, only for the repair worker). Use bash (Git Bash/WSL on Windows).

```bash
cd server
cp .env.example .env                 # fill in values (DATABASE_URL, JWT_SECRET, an AI key, ...); never commit .env
npm install                          # runs prisma generate (postinstall); needs access to binaries.prisma.sh
npx prisma migrate deploy            # applies the 16 migrations; never `migrate reset` on data you need
npm run dev                          # API + Socket.IO on PORT (default 5000): http://localhost:5000/api/health
npm run worker                       # scan worker (separate terminal)
npm run repair-worker                # repair worker (separate terminal; needs git and a Docker daemon)

cd ../client
npm install
npm run dev                          # http://localhost:5173 (API default http://localhost:5000/api, override with VITE_API_URL)
```

Configuration notes: `JWT_EXPIRES_IN` is digits plus `s`/`m`/`h`/`d` (invalid values fall back to `1d`); Redis uses `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` (not a URL; defaults `127.0.0.1:6379`, no password); without `GITHUB_TOKEN_ENCRYPTION_KEY` GitHub tokens are stored as plain text and a warning is logged; set `TRUST_PROXY=1` behind a reverse proxy; at least one AI provider key is required (code that loads `src/ai/ai.config.ts` throws `No AI provider is configured` otherwise; reproduced with `tsx`). For local development keep `FRONTEND_URL=http://localhost:5173` and `GITHUB_CALLBACK_URL=http://localhost:5000/api/github/callback`. Full variable reference: [Operations §2](docs/OPERATIONS_SECURITY.md#2-configuration). These local commands were **not run end to end** in the audit environment (Prisma engines could not be downloaded); the migration SQL, the client and the scripts listed in [verification status](#what-was-verified-and-what-was-not) were.

## Testing

```bash
# Server (from server/). Scripts that need nothing else (verified, exit 0):
npm run test:webhook-signature
npm run test:static-security
npm run test:risk-engine
npm run test:benchmark
npm run test:verification-gate
npm run test:security
# Scripts that import Prisma need a generated client (`npx prisma generate`); some also need services:
#   test:app (Redis), test:scan-queue / test:repair-queue (Redis; export REDIS_PASSWORD first, the scripts do not read server/.env)
#   test:auth, test:rag (database; they WRITE to DATABASE_URL, so point it at a Neon branch or a throwaway database)
# Scripts that take an argument: npm run test:context -- <repo-path>, npm run test:docker-runner -- <repo-path>
npx tsc --noEmit && npm run build    # needs the generated Prisma client
# Client (from client/)
npm run lint && npm run build
# Compose file (root .env and server/.env must exist)
docker compose config -q
# Browser end-to-end for registration/login (needs a running API + client; first time: npx playwright install chromium)
npm run test:e2e                     # E2E_BASE_URL overrides the client URL (default http://localhost:5173; Compose: http://localhost:8080)
```

The full list of `test:*` scripts is in `server/package.json` (many call AI providers or GitHub and need real credentials). Step-by-step manual checks are in the [manual testing guide](docs/MANUAL_TESTING_GUIDE.md).

## Security boundaries

By design: fixes are applied only in disposable workspaces; repository tests run only in Docker with no network, dropped capabilities, resource limits and a 120-second timeout; the GitHub token is passed to git through environment variables, never into the container or URLs; retries are bounded to three; `INCONCLUSIVE` stops the loop; publication requires a verified result and never force-pushes, pushes the default branch or merges; webhooks require a valid HMAC; repository text, test output and model output are treated as untrusted.

Gaps (see [Operations §3](docs/OPERATIONS_SECURITY.md#3-security-control-status)): the verification verdict comes from an LLM, but a `VERIFIED` verdict is downgraded unless the Docker run exited 0 without timing out; GitHub tokens are encrypted only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set; the strict command policy, untrusted-context wrapper and audit logging are not connected; no cross-user authorization tests exist.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose` says `required variable REDIS_PASSWORD is missing a value` | create the root `.env` from `.env.example` and set `REDIS_PASSWORD` (also `DATABASE_URL`, or `POSTGRES_PASSWORD` with `--profile bundled-db`) |
| `env file .../server/.env not found` | `cp server/.env.example server/.env` and fill it in |
| Bundled database requested but `postgres` is not running | every compose command needs `--profile bundled-db`, including `down` and `logs` |
| After GitHub login you land on `localhost:5173` | `FRONTEND_URL` in `server/.env` is still the template value; set it to `http://localhost:8080` and `docker compose up -d` again |
| `server` never becomes healthy | `docker compose logs server migrate`; usually `JWT_SECRET` missing or a database URL problem (a missing AI key makes any process that loads the AI config throw `No AI provider is configured`) |
| `migrate` fails with a timeout, `P1001`, SSL or advisory-lock error on Neon | use the direct (non-pooled) URL with `sslmode=require&connect_timeout=30`; the first connection after idle can be slow while Neon wakes the compute |
| Login shows "Cannot reach the server" | API not running or `VITE_API_URL` wrong (Compose uses `/api` through nginx) |
| "Too many authentication attempts" | the auth rate limit (10 failures / 15 min) — wait, or restart the API in development |
| Scans stay `waiting` | the scan worker is not running or cannot reach Redis |
| Repair ends `INCONCLUSIVE` under Compose | the repair worker has no Docker daemon (see Limitations) |
| Queue test scripts hang | export `REDIS_PASSWORD` in the shell first; the scripts do not read `server/.env` |
| `npm ci` in `server/` fails in `prisma generate` with `403` | the network blocks `binaries.prisma.sh`; allow it or build elsewhere |
| `docker compose build` fails pulling images | the network blocks Docker Hub; allow `registry-1.docker.io` or use a registry mirror |
| Deployed frontend problems | see [Deploying the frontend](#deploying-the-frontend-and-connecting-the-github-repository) |

## Benchmark

An evaluator, a CLI and a five-case seeded fixture exist, but **no benchmark has been run**, so there are no precision, recall or repair-rate results. `server/benchmarks/seeded-repo/run-results.example.json` is hand-written illustration. 

## Known limitations

- Docker image builds and `docker compose up` have **never been executed** in any verification environment so far (the latest, on 14 October 2026, could not pull base images from Docker Hub); the Compose file validates with `docker compose config`. Run the Quick start on a machine with registry access to confirm.
- Earlier database-backed tests were run against a local PostgreSQL with Prisma's engine-less client and the SQL migrations applied directly; the 14 October 2026 audit re-applied the 16 migrations with `psql` on PostgreSQL 16 (success). **Neon itself was not tested**, and neither were `prisma migrate deploy` or schema/migration drift.
- In Compose the repair worker has no Docker daemon, so repairs there end `INCONCLUSIVE`.
- Generated tests are saved with the analysis but are never executed.
- Test execution has no network and the clone has no `node_modules`, so repositories whose tests need installed packages fail or are inconclusive; test commands are supplied by the caller, not detected.
- Context selection is the first 30 JS/TS files, not finding-relevant files; repository memory is lexical and rebuilt on every scan.
- Static security rules are line-based heuristics, not SAST or dependency auditing.
- Fork pull requests from webhooks are intentionally ignored.
- No screenshots, demo recording, CI configuration, hosted-frontend configuration or repository licence file (`server/package.json` says ISC). The project root is not a git repository in this archive (see [Deploying the frontend](#deploying-the-frontend-and-connecting-the-github-repository)).

## Documentation

1. [Architecture](docs/ARCHITECTURE.md) — reference diagram, stack, API surface, flows, trust boundaries.
2. [Operations and security](docs/OPERATIONS_SECURITY.md) — environment variables, security controls, Compose deployment, failure triage.
3. [Manual testing guide](docs/MANUAL_TESTING_GUIDE.md) — setup and functional test cases.
4. [Development history](docs/DEVELOPMENT_HISTORY.md) — day-by-day development log of the 30-day plan.
5. [Server](server/README.md) and [client](client/README.md) notes.

