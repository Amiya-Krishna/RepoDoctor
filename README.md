# RepoDoctor AI

**AI-assisted analysis and verification-gated repair for JavaScript and TypeScript repositories.**

RepoDoctor AI connects to a user's GitHub repositories, builds a repository snapshot and context, runs AI-assisted bug and security analysis with a deterministic risk score, and can attempt a repair: generate a patch, apply it in a disposable workspace, run tests in a network-less Docker container, ask a verification step to judge the evidence, retry up to three times, and open a GitHub pull request **only if verification succeeds**. It never merges pull requests.

The project is Docker-based: the supported way to run the whole stack is `docker compose up`. Docker is also what the repair worker uses to run a repository's tests in isolation.

## Contents

[Run on port 8080](#run-on-port-8080-docker-or-powershell) · [Quick start](#quick-start-docker-compose) · [Connecting GitHub](#connecting-github-oauth) · [Deploying the frontend](#deploying-the-frontend-and-connecting-the-github-repository) · [Accounts](#registration-and-login) · [Status](#implementation-status) · [Architecture](#architecture) · [Stack](#technology-stack) · [Local development](#local-development-without-compose) · [Tests](#testing) · [Security](#security-boundaries) · [Troubleshooting](#troubleshooting) · [Limitations](#known-limitations) · [Docs](#documentation)

## Run on port 8080 (Docker **or** PowerShell)

RepoDoctor has **one address in every mode: http://localhost:8080**. The browser, the GitHub OAuth callback and `server/.env` are identical whether you run the stack with Docker or directly from PowerShell.

| | Docker Compose | Local (PowerShell, `npm`) |
|---|---|---|
| App in the browser | http://localhost:8080 (nginx) | http://localhost:8080 (Vite dev server) |
| API health | http://localhost:8080/api/health | http://localhost:8080/api/health (proxied) or http://localhost:4000/api/health (direct) |
| Socket.IO | `/socket.io/` on 8080 (nginx proxy) | `/socket.io/` on 8080 (Vite proxy) |
| API port | 4000 (inside the Compose network only) | 4000 (`PORT` in `server/.env`) |
| Redis / PostgreSQL | bundled Redis (+ optional Postgres), no host ports | Redis `127.0.0.1:6379`, your own PostgreSQL / Neon |
| GitHub OAuth callback | `http://localhost:8080/api/github/callback` | **the same** `http://localhost:8080/api/github/callback` |

**Only one of the two can run at a time**, because both want host port 8080. Stop one before starting the other (`docker compose down`, or `Ctrl+C` in the Vite window). The Vite dev server uses `strictPort`: if 8080 is taken it stops with `Port 8080 is already in use` instead of silently picking another port.

Run every command from the folder that contains `docker-compose.yml`. Windows PowerShell 5.1 has no `&&`, so each command goes on its own line.

### One-time setup (both modes)

```powershell
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # value for JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # value for REDIS_PASSWORD and GITHUB_TOKEN_ENCRYPTION_KEY
```

Edit `server\.env` (this one file works for Docker **and** local; the template already has the 8080 values):

- `JWT_SECRET`, at least one AI key (`OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY`), and for GitHub `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- keep `PORT=4000`, `FRONTEND_URL=http://localhost:8080`, `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback`
- `DATABASE_URL` (used by local runs), `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, empty `REDIS_PASSWORD` (used by local runs; Docker Compose overrides `DATABASE_URL`, `REDIS_*`, `PORT` and `NODE_ENV` for the containers)

Edit the root `.env` (**Docker only**): `REDIS_PASSWORD` (any long random string) and `DATABASE_URL`, or `POSTGRES_PASSWORD` for the bundled database (then add `--profile bundled-db` to every `docker compose` command below).

In your GitHub OAuth app set *Homepage URL* `http://localhost:8080` and *Authorization callback URL* `http://localhost:8080/api/github/callback`. One OAuth app now serves both modes.

### Option A: Docker (PowerShell)

Docker Desktop must be running.

```powershell
docker compose config -q
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/api/health
```

`docker compose ps` should show `server` as `healthy` and `migrate` as exited (0). Open **http://localhost:8080**.

```powershell
docker compose logs -f server                     # logs (also: scan-worker, repair-worker, migrate, client)
docker compose up -d --force-recreate server scan-worker repair-worker   # after editing server\.env
docker compose down                               # stop (keeps volumes); `down -v` also deletes them
```

### Option B: local development in PowerShell (no Docker for the app)

Prerequisites: Node.js 22, Git, a PostgreSQL 16 database (Neon or local), Redis on `127.0.0.1:6379`. Docker is only needed to host Redis and for the repair worker's test runs.

**Window 0, once** (stop the Docker stack first if it is running: `docker compose down`):

```powershell
docker run -d --name repodoctor-redis -p 6379:6379 redis:7-alpine
cd server
npm install
npx prisma migrate deploy
cd ..\client
npm install
```

Next time, start Redis again with `docker start repodoctor-redis`. If you also want a local PostgreSQL: `docker run -d --name repodoctor-pg -e POSTGRES_USER=repodoctor -e POSTGRES_PASSWORD=<dev-password> -e POSTGRES_DB=repodoctor -p 5432:5432 postgres:16` and `DATABASE_URL=postgresql://repodoctor:<dev-password>@localhost:5432/repodoctor?schema=public`.

**Then four windows, each opened in the folder that contains `docker-compose.yml`:**

```powershell
# Window 1: API + Socket.IO on port 4000
cd server
npm run dev
```

```powershell
# Window 2: scan worker
cd server
npm run worker
```

```powershell
# Window 3: repair worker (needs git on PATH and Docker Desktop running)
cd server
npm run repair-worker
```

```powershell
# Window 4: web client on port 8080 (proxies /api and /socket.io to the API on 4000)
cd client
npm run dev
```

Check: `Invoke-RestMethod http://localhost:8080/api/health` (through the Vite proxy) and `Invoke-RestMethod http://localhost:4000/api/health` (API directly) both return `status: ok`. Open **http://localhost:8080**. Stop with `Ctrl+C` in each window.

If the API runs on a different host or port, start the client with `$env:API_PROXY_TARGET = "http://127.0.0.1:<port>"` set first.

### Port 8080 is busy

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalPort, OwningProcess
Get-Process -Id <OwningProcess>
docker ps --filter "publish=8080"
```

If it is the other RepoDoctor mode: `docker compose down` (Docker) or `Ctrl+C` in the Vite window (local).

## Quick start (Docker Compose)

### Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`). The commands below were checked with Docker 29 and Compose v5.
- Access to Docker Hub (images `node:22-bookworm-slim`, `nginx:alpine`, `redis:7-alpine`, and `postgres:16-alpine` for the bundled database) and to `binaries.prisma.sh` / the npm registry during image builds.
- A PostgreSQL 16 database: either an external one such as Neon (default) or the bundled container (`bundled-db` profile).
- At least **one** AI provider key (`OPENROUTER_API_KEY`, `GROQ_API_KEY` or `GEMINI_API_KEY`) for analysis and repair.
- A GitHub OAuth app, only for the GitHub features (registration and login work without it).
- Node.js 22 on the host, only to generate secrets with `node -e` (the containers bring their own Node). The full local-development route also needs Node 22, npm and Git (see [Local development](#local-development-without-compose)).
- On Windows: Docker Desktop must be **running** (Linux containers, WSL 2 backend) before any `docker compose` command. Run every command below from the folder that contains `docker-compose.yml`, in one Windows PowerShell or PowerShell 7 window. Windows PowerShell 5.1 has no `&&`, so each command goes on its own line (or is joined with `;`). If `npm` fails with *running scripts is disabled on this system*, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call `npm.cmd` instead of `npm`. bash/zsh, Git Bash and WSL users can use the bash variants.

### Environment setup

```bash
cp .env.example .env                 # root file read by `docker compose`
cp server/.env.example server/.env   # API and worker settings (required: compose fails without this file)
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # value for JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # value for REDIS_PASSWORD (any long random string works) or GITHUB_TOKEN_ENCRYPTION_KEY
```

Root `.env`:

- `REDIS_PASSWORD`: **required**, any long random string. `docker compose` stops with `required variable REDIS_PASSWORD is missing a value` if it is empty.
- Database, choose one:
  - **External (default, e.g. Neon):** set `DATABASE_URL` (direct, non-pooled endpoint, `sslmode=require`, `connect_timeout=30`).
  - **Bundled PostgreSQL:** comment out `DATABASE_URL`, set `POSTGRES_PASSWORD` (letters, digits, `-`, `_` only) and add `--profile bundled-db` to every `docker compose` command below.

`server/.env` (values for the containers; Compose itself overrides `DATABASE_URL`, `REDIS_*`, `PORT` (4000 inside the container network), `NODE_ENV` and `TRUST_PROXY`; the template's `PORT=4000` is the same value Compose uses, so one `server/.env` serves both Docker and local runs):

- `JWT_SECRET`: required, long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- At least one AI key (see prerequisites).
- `FRONTEND_URL=http://localhost:8080`: already the template value (the same in Docker and local development). Open the app as `http://localhost:8080` exactly.
- `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback`, and the same URL as the *Authorization callback URL* of your GitHub OAuth app (already the template value). Also set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Step by step: [Connecting GitHub](#connecting-github-oauth).
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

```powershell
# Windows PowerShell: the same docker compose commands, one per line
docker compose config -q
docker compose up --build -d
docker compose ps
docker compose logs -f server
docker compose down
```

When you started the stack with `--profile bundled-db`, pass the same flag to `docker compose down` so the `postgres` container is stopped too. Changes to `server/.env` are read when a container is created: after editing it run `docker compose up -d --force-recreate server scan-worker repair-worker`. Changes to the root `.env` or to the client need `docker compose up --build -d`.

### Workers under Compose

The queue workers are Compose services, so no separate terminal and no `npm run worker` / `npm run repair-worker` is needed: `scan-worker` runs `node dist/workers/scan.worker.js` and `repair-worker` runs `node dist/workers/repair.worker.js`; both start automatically with `docker compose up`. Check them with `docker compose logs scan-worker repair-worker` (look for `RepoDoctor scan worker started` and `RepoDoctor autonomous repair worker started`). The `npm run worker` and `npm run repair-worker` scripts run the same code with `tsx` on the host and are meant for [local development](#local-development-without-compose); they cannot reach the Compose Redis, which has no published port.

The `repair-worker` container has no `docker` CLI and no access to a Docker daemon (the host socket is deliberately not mounted), so under Compose a repair attempt can only end `INCONCLUSIVE`. Scans and analysis are unaffected. To run repairs that execute tests in Docker, use the local-development route below, where the repair worker runs on the host next to Docker Desktop.

### Database initialisation

There is no manual step. The one-shot `migrate` service runs `npx prisma migrate deploy` against the database in `DATABASE_URL` (or the bundled PostgreSQL) and the API and both workers start only after it exits successfully. There are 16 migrations in `server/prisma/migrations/`. To see what happened: `docker compose logs migrate`. Never run `prisma migrate reset` against data you need.

### Services and URLs

| Service | Reachable at | Notes |
|---|---|---|
| Web client (nginx) | http://localhost:8080 | the **only published port** |
| API through nginx | http://localhost:8080/api/health | proxied to `server:4000` (the API's port inside the Compose network) |
| Socket.IO | `http://localhost:8080/socket.io/` | proxied by nginx, used by the client for live progress |
| API (`server`), `scan-worker`, `repair-worker`, `redis`, `postgres` | Compose networks only | no host ports; use `docker compose exec` / `logs` |

Registration and login can be tried straight away at http://localhost:8080 (see below).

## Registration and login

Open the client, choose **Create an account**, enter a name, an email address and a password of 8–128 characters. Registration signs you in; later use **Log in**. Sessions are JWTs (lifetime `JWT_EXPIRES_IN`, default `1d`) kept in the browser; an expired or invalid token returns you to the login form.

Check it from the command line against a running stack (the same URLs work when running locally with `npm run dev`, because the Vite dev server also listens on 8080 and proxies `/api`; the API itself is on `http://localhost:4000`):

```bash
curl -s -X POST http://localhost:8080/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"you@example.test","password":"a-long-password"}'
curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.test","password":"a-long-password"}'
```

In Windows PowerShell `curl` is an alias of `Invoke-WebRequest`; use `Invoke-RestMethod`:

```powershell
Invoke-RestMethod http://localhost:8080/api/health
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/auth/register -ContentType 'application/json' -Body '{"name":"Test User","email":"you@example.test","password":"a-long-password"}'
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/auth/login -ContentType 'application/json' -Body '{"email":"you@example.test","password":"a-long-password"}'
```

Behaviour: invalid input returns `400`; an existing email (any letter case, including concurrent requests) returns `409`; wrong password and unknown user both return the same `401` message; passwords are stored only as bcrypt hashes and never returned; authentication endpoints are rate limited to 10 failed attempts per 15 minutes per client.

## Connecting GitHub (OAuth)

The **Connect GitHub** button works like this: the browser calls `GET /api/github/connect` with the login JWT; the API sets an HttpOnly `github_oauth_state` cookie (path `/api/github/callback`) and returns a `github.com/login/oauth/authorize` URL (scopes `repo read:user user:email`, `redirect_uri` = `GITHUB_CALLBACK_URL`); the browser goes to GitHub and comes back to `GITHUB_CALLBACK_URL`; the API checks the cookie against the `state` parameter, exchanges the code for a token, stores it on the user and redirects the browser to `FRONTEND_URL`. The repository list then comes from `GET /api/github/repositories`.

Local Compose setup:

1. On GitHub: Settings → Developer settings → OAuth Apps → **New OAuth App**. *Homepage URL* `http://localhost:8080`, *Authorization callback URL* `http://localhost:8080/api/github/callback`. Generate a client secret.
2. In `server/.env` set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback` and `FRONTEND_URL=http://localhost:8080`. The callback must match the one registered at GitHub in scheme, host, port and path. Docker and local development both use `8080`, so the same OAuth app works for both (never run both at once).
3. Apply the change: `docker compose up -d --force-recreate server scan-worker repair-worker`.
4. Open `http://localhost:8080` (not `127.0.0.1`, not a LAN address), log in and choose **Connect GitHub**. After authorising you return to `http://localhost:8080` and the repository list loads.

The API container needs outbound HTTPS to `github.com` and `api.github.com`; `/api/github/repositories` returns the 100 most recently updated repositories the token can access. Organisation repositories appear only if the organisation has approved the OAuth app. If it fails, see the table below and `docker compose logs server`.

| Symptom | Cause |
|---|---|
| Browser error `ERR_CONNECTION_REFUSED` on `localhost:5000` / `5173` after authorising | `server/.env` still has the old values from an earlier template; set `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback` and `FRONTEND_URL=http://localhost:8080` |
| `Port 8080 is already in use` (Vite) or `port is already allocated` (Docker) | the other mode is still running; stop it (see [Port 8080 is busy](#port-8080-is-busy)) |
| GitHub shows a `redirect_uri` mismatch | the OAuth app's callback URL differs from `GITHUB_CALLBACK_URL` |
| `Invalid GitHub OAuth state` | the app was opened on a different host than the callback (`127.0.0.1` vs `localhost`); the state cookie is `Secure` when `NODE_ENV=production` (Compose sets it) and browsers accept that over plain HTTP only for `localhost`; the 10-minute state expired; or `JWT_SECRET` changed in between |
| `Failed to obtain GitHub access token` | wrong `GITHUB_CLIENT_SECRET` or `GITHUB_CLIENT_ID`, or the code was already used |
| `GitHub account is not connected` (400) | no successful connection yet for this RepoDoctor user |
| `Failed to fetch repositories` (500) | the call to GitHub failed (revoked token, no outbound access, GitHub error); the cause is in `docker compose logs server` |

## Deploying the frontend and connecting the GitHub repository

### Steps to connect the repository

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
5. After deploying, check from your own machine: `curl -i https://<your-api-host>/api/health` returns `200`; opening the frontend shows no CORS or `localhost` errors in the browser console; **Connect GitHub** completes and returns to the frontend.

### Symptom → cause

| Symptom on the deployed frontend | Cause |
|---|---|
| Requests go to `/api` on the frontend host and return 404 | `VITE_API_URL` was not set during the host's build (the default is the same-origin `/api`) |
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
| Registration, login, JWT-protected routes (bcrypt) | Implemented (API, database and browser tests); no refresh tokens |
| GitHub OAuth with signed, cookie-bound state | Partially implemented (token stored unencrypted) |
| Repository sync, list, delete | Implemented |
| Ingestion (shallow clone, temp workspace) and analyzer snapshot | Partially implemented |
| LLM provider manager (OpenRouter → Groq → Gemini) | Implemented |
| Context builder (first 30 JS/TS files ≤ 50 KB) | Partially implemented |
| Bug detection agent | Implemented |
| Security agent + six-rule static scanner | Partially implemented |
| Test generation agent | Partially implemented |
| Deterministic risk engine | Implemented |
| Fix agent, disposable workspace, patch validation | Implemented |
| Docker test runner | Partially implemented (no command detection; no dependency installation) |
| Verification agent | Partially implemented (model verdict; exit code not independently enforced) |
| Bounded retry (3) with re-planning | Implemented |
| Verified-only pull request publication | Implemented |
| End-to-end repair flow | Implemented |
| BullMQ queues and two worker processes | Implemented |
| GitHub webhooks | Signature **verified (unit)** |
| Socket.IO real-time progress | Implemented |
| Repository memory (lexical hashed-vector retrieval) | Partially implemented |
| Benchmark evaluator and 5-case fixture | Evaluator **verified (unit)**; **no measured results** |
| Rate limiting | Implemented (`test:app`) |
| Token encryption, strict command policy, untrusted-context wrapper | Partially implemented |
| Audit logging | Planned / not implemented (table only) |
| Docker Compose deployment (PostgreSQL, Redis, API, workers, client) | Implemented |
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

| Area | Technology |
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

The step-by-step PowerShell commands are in [Run on port 8080](#option-b-local-development-in-powershell-no-docker-for-the-app). Summary: the web client (Vite dev server) listens on **8080** and proxies `/api` and `/socket.io` to the API on **4000**, so the browser address, the GitHub callback and `server/.env` are the same as under Docker Compose. Stop the Compose stack first (`docker compose down`): both use host port 8080.

Prerequisites: Node.js 22, npm, Git, a PostgreSQL 16 database (Neon or local), Redis 7 (and Docker, only for the repair worker). `npm run dev`, `npm run worker`, `npm run repair-worker` and the client's `npm run dev` are long-running processes: each needs **its own terminal window**, and the three server commands must be run from `server/` because `dotenv` reads `server/.env` from the current directory.

Local PostgreSQL and Redis can be started with Docker (development only; replace the password):

```bash
docker run -d --name repodoctor-pg -e POSTGRES_USER=repodoctor -e POSTGRES_PASSWORD='<dev-password>' -e POSTGRES_DB=repodoctor -p 5432:5432 postgres:16
docker run -d --name repodoctor-redis -p 6379:6379 redis:7-alpine
```

Matching `server/.env` values: `DATABASE_URL=postgresql://repodoctor:<dev-password>@localhost:5432/repodoctor?schema=public`, `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, an empty `REDIS_PASSWORD`, `PORT=4000`, `FRONTEND_URL=http://localhost:8080` and `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback` (register that callback in a GitHub OAuth app; see [Connecting GitHub](#connecting-github-oauth)).

```bash
cd server
cp .env.example .env                 # fill in values (DATABASE_URL, JWT_SECRET, an AI key, ...); never commit .env
npm install                          # runs prisma generate (postinstall); needs access to binaries.prisma.sh
npx prisma migrate deploy            # applies the 16 migrations; never `migrate reset` on data you need
npm run dev                          # API + Socket.IO on PORT (default 4000): http://localhost:4000/api/health
npm run worker                       # scan worker (separate terminal)
npm run repair-worker                # repair worker (separate terminal; needs git and a Docker daemon)

cd ../client
npm install
npm run dev                          # http://localhost:8080 (proxies /api and /socket.io to http://127.0.0.1:4000; override with API_PROXY_TARGET)
```

Configuration notes: `JWT_EXPIRES_IN` is digits plus `s`/`m`/`h`/`d` (invalid values fall back to `1d`); Redis uses `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` (not a URL; defaults `127.0.0.1:6379`, no password); without `GITHUB_TOKEN_ENCRYPTION_KEY` GitHub tokens are stored as plain text and a warning is logged; set `TRUST_PROXY=1` behind a reverse proxy; at least one AI provider key is required (code that loads `src/ai/ai.config.ts` throws `No AI provider is configured` otherwise; reproduced with `tsx`). Keep `FRONTEND_URL=http://localhost:8080` and `GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback` for both local and Docker runs. Full variable reference: [Operations §2](docs/OPERATIONS_SECURITY.md#2-configuration).

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
npm run test:e2e                     # E2E_BASE_URL overrides the client URL (default http://localhost:8080, the same for Compose and `npm run dev`)
```

The full list of `test:*` scripts is in `server/package.json` (many call AI providers or GitHub and need real credentials). Step-by-step manual checks are in the [manual testing guide](docs/MANUAL_TESTING_GUIDE.md).

## Documentation

1. [Architecture](docs/ARCHITECTURE.md) — reference diagram, stack, API surface, flows, trust boundaries.
2. [Operations and security](docs/OPERATIONS_SECURITY.md) — environment variables, security controls, Compose deployment, failure triage.
3. [Manual testing guide](docs/MANUAL_TESTING_GUIDE.md) — setup and functional test cases.
4. [Development history](docs/DEVELOPMENT_HISTORY.md) — day-by-day development log of the 30-day plan.
5. [Server](server/README.md) and [client](client/README.md) notes.

