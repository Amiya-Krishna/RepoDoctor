# RepoDoctor AI — Manual Testing and Execution Guide

Every command, route, port, table and button label below was checked against the repository (`server/package.json`, `client/package.json`, `server/src/routes/*`, `server/prisma/schema.prisma`, `docker-compose.yml`, `client/src/pages/*`). Nothing here contains secrets; replace `<placeholders>` with your own values.

**How to read the status tags.**

| Tag | Meaning |
|---|---|
| **EXECUTED** | Run exactly as written during verification, with the result stated |
| **PARTLY EXECUTED** | The part that needs no database/GitHub/AI was run; the rest was not |
| **NOT EXECUTED** | Written from the source code; the verification sandbox could not run it (no generated Prisma client, no Docker daemon, no GitHub or AI credentials). Treat as unverified until you run it |

The sandbox blocked `binaries.prisma.sh` (HTTP 403), so the real Prisma client was never generated there. That is why every database-backed flow below is NOT EXECUTED. On a normal network these should work, but nobody has confirmed it yet.

**Re-audit, 14 October 2026.** Repeated in a new sandbox: Docker Hub (`registry-1.docker.io`) and `binaries.prisma.sh` both returned 403, so no image could be pulled and `prisma generate` still failed. Re-run and passing: AT-01 to AT-06, AT-15, AT-16, AT-18 (including `--profile bundled-db`), and the 16 migrations applied with `psql` on PostgreSQL 16. Still not executed: `docker compose build/up`, `prisma generate`, `prisma migrate deploy`, server `tsc`/build, AT-07 to AT-10, every database test.

---

## A. Prerequisites

| Item | Requirement |
|---|---|
| OS | Linux, macOS or Windows. Commands are bash; on Windows use Git Bash or WSL |
| Node.js / npm | Node 22.x, npm 10.x (verification used 22.22.0 / 10.9.4) |
| Git | any recent version; the workers run `git clone` |
| PostgreSQL | 16 |
| Redis | 7 (BullMQ queues and Socket.IO progress events) |
| Docker | Only for the repair worker (it runs repository tests in a `--network none` container) and for the Compose stack (Compose v2+ for `depends_on.required`; checked with Compose v5). Not needed for the API, scan worker or client |
| Network | Outbound HTTPS to `binaries.prisma.sh` during `npm ci` (Prisma engines), to Docker Hub for Compose image builds, to `github.com` / `api.github.com`, and to your AI provider |
| Tools used by the test cases | `curl`, `jq`, `openssl`, `psql`, `redis-cli` |

### Server environment (`server/.env`, created from `server/.env.example`)

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | everything | `postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<database>?sslmode=require` |
| `JWT_SECRET` | API start | the API refuses to start without it; use a long random value (the template contains only a placeholder) |
| `JWT_EXPIRES_IN` | optional | digits + `s`/`m`/`h`/`d` (for example `12h`); anything else falls back to `1d` |
| `PORT` | API | default `5000` (Compose sets `4000`) |
| `FRONTEND_URL` | CORS, Socket.IO, OAuth redirect | default `http://localhost:5173` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | queues | defaults `127.0.0.1`, `6379`, none (not a URL) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | GitHub OAuth | callback in the template: `http://localhost:5000/api/github/callback` |
| `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` | analysis and repair | **at least one** real key; empty or `...` keys are ignored. `*_MODEL` may stay empty |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | optional | base64 of 32 random bytes; when set, new GitHub tokens are stored encrypted |
| `GITHUB_WEBHOOK_SECRET` | webhook | without it `/api/github/webhook` answers `503` |
| `SCAN_WORKER_CONCURRENCY`, `REPAIR_WORKER_CONCURRENCY` | optional | defaults 2 and 1 |
| `TRUST_PROXY` | optional | number of reverse proxies in front of the API (Compose sets `1`) |

Client (`client/.env`, optional): `VITE_API_URL` (default `http://localhost:5000/api`; the Docker image uses `/api`).

You must supply yourself: a GitHub OAuth App (client id/secret), an AI provider key, and a GitHub account with a small JavaScript/TypeScript repository (use a **disposable** one for repair tests).

---

## B. Initial Setup (bash, from the folder that contains `docker-compose.yml`)

```bash
# 1. Open
 cd RepoDoctor   # adjust if the folder layout differs
ls                                                                               # expect: client  server  docker-compose.yml  README.md ...

# 2. PostgreSQL 16 and Redis 7 (skip if you already run them).
#    Docker option, local development only (replace the password):
docker run -d --name repodoctor-pg -e POSTGRES_USER=repodoctor -e POSTGRES_PASSWORD='<dev-password>' -e POSTGRES_DB=repodoctor -p 5432:5432 postgres:16
docker run -d --name repodoctor-redis -p 6379:6379 redis:7-alpine
#    Non-Docker option (Debian/Ubuntu, run as root):
#    pg_ctlcluster 16 main start
#    su postgres -c "psql -c \"CREATE USER repodoctor WITH PASSWORD '<dev-password>' CREATEDB;\" -c 'CREATE DATABASE repodoctor OWNER repodoctor;'"
#    redis-server --daemonize yes

# 3. Server dependencies. The postinstall hook runs `prisma generate` (needs binaries.prisma.sh)
cd server
npm ci

# 4. Environment (never commit server/.env)
cp .env.example .env
#    Edit .env: DATABASE_URL (use your password), JWT_SECRET, GITHUB_*, at least one AI key.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # a value for JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # optional value for GITHUB_TOKEN_ENCRYPTION_KEY

# 5. Generate the Prisma client explicitly (already done by `npm ci`; safe to repeat) and apply the 16 migrations
npx prisma generate
npx prisma migrate deploy        # do NOT use `migrate reset` on data you want to keep

# 6. Client dependencies
cd ../client
npm ci
```

Expected: `npm ci` ends without error; `prisma generate` prints `Generated Prisma Client`; `prisma migrate deploy` ends with `All migrations have been successfully applied.`

**Database access for the checks below.** `DATABASE_URL` carries a Prisma-only `?schema=public` suffix that `psql` rejects (`invalid URI query parameter: "schema"` — reproduced). Strip it:

```bash
export PSQL_URL="${DATABASE_URL%%\?*}"          # run after exporting DATABASE_URL, e.g. export $(grep ^DATABASE_URL server/.env | xargs)
psql "$PSQL_URL" -c 'select 1'
```

**What was executed here.** `client`: `npm ci` — EXECUTED, PASS. `server`: plain `npm ci` — BLOCKED (Prisma engine download 403); `npm ci --ignore-scripts` — PASS. The 16 migration files were applied in order with `psql -f` on PostgreSQL 16 — PASS, and the resulting 16 tables and 180 columns matched `schema.prisma` name for name. That is **not** the same as `prisma migrate deploy` (which also records history in `_prisma_migrations` and checks checksums) and was not run.

---

## C. Run the Project

Use four terminals from the project root.

| Terminal | Command | Expected output | URL / port |
|---|---|---|---|
| 1 – API + Socket.IO | `cd server && npm run dev` | `PostgreSQL connected successfully`, then `RepoDoctor API and realtime server listening on port 5000` | `http://localhost:5000/api/health` |
| 2 – Scan worker | `cd server && npm run worker` | `RepoDoctor scan worker started` | – |
| 3 – Repair worker (needs git and a Docker daemon) | `cd server && npm run repair-worker` | `RepoDoctor autonomous repair worker started` | – |
| 4 – Client | `cd client && npm run dev` | Vite prints `Local: http://localhost:5173/` | `http://localhost:5173` |

The start messages and port above were observed for the API and both workers with a stand-in database client (EXECUTED). Real database connectivity is NOT EXECUTED.

Production-style run:

```bash
cd server && npm run build && npm start        # tsc -> dist/, then node dist/server.js   (NOT EXECUTED: needs the real Prisma client)
cd client && npm run build && npm run preview  # static build in client/dist (EXECUTED: build passes)
```

### Docker Compose (images NOT built or run in verification)

```bash
cp server/.env.example server/.env             # fill in; set FRONTEND_URL=http://localhost:8080 and GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback; PORT, DATABASE_URL, REDIS_*, NODE_ENV and TRUST_PROXY are overridden by Compose
cp .env.example .env                           # root file: set REDIS_PASSWORD and DATABASE_URL (external, e.g. Neon) or POSTGRES_PASSWORD (bundled)
docker compose config -q                       # EXECUTED: exit 0 with both env files; fails with 'required variable REDIS_PASSWORD is missing a value' or 'env file .../server/.env not found'
docker compose up --build -d                   # NOT EXECUTED. Client on http://localhost:8080 (API only via the nginx /api/ and /socket.io/ proxies)
docker compose ps                              # server should become "healthy"; migrate exits 0; client waits for server
docker compose down                            # keeps volumes; `down -v` deletes them
```

Bundled PostgreSQL: comment out `DATABASE_URL` in the root `.env`, set `POSTGRES_PASSWORD` (letters, digits, `-`, `_`) and put `--profile bundled-db` after `docker compose` in every command above (including `down`); `docker compose --profile bundled-db config -q` was EXECUTED and passes. Without the profile no `postgres` container exists and `DATABASE_URL` must point to a database reachable from the containers (for a database on the Docker host use `host.docker.internal`; on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`, which would be a change to `docker-compose.yml`). The `repair-worker` service has no Docker CLI and no daemon in its image, so repair jobs there end `INCONCLUSIVE`.

---

## D. Automated Checks

Run in `server/` unless stated. There is no `npm test`, no test framework and no server linter. The "tests" are standalone `tsx` scripts that exit non-zero on failure.

| ID | Command | Needs | Expected last line / result | Result |
|---|---|---|---|---|
| AT-01 | `npm run test:risk-engine` | nothing | exits 0 (prints severity counts) | PASS |
| AT-02 | `npm run test:webhook-signature` | nothing | `GitHub webhook signature tests passed.` | PASS |
| AT-03 | `npm run test:static-security` | nothing | `Static security scanner tests passed.` | PASS |
| AT-04 | `npm run test:benchmark` | nothing | `Benchmark evaluator tests passed.` | PASS |
| AT-05 | `npm run test:security` | nothing (makes its own key). Covers token round trip, wrong key, bad key length, legacy plaintext, `JWT_EXPIRES_IN` parsing, command policy, untrusted-context wrapper | `Security control tests passed.` | PASS |
| AT-06 | `npm run test:verification-gate` | nothing | `Verification gate tests passed.` | PASS |
| AT-07 | `npm run test:ai-selection` | Node + `tsx` only; spawns child processes, no network | `AI provider selection tests passed.` | PASS (new) |
| AT-08 | `npm run test:app` | Redis on `127.0.0.1:6379` and a loadable Prisma client; never touches the database. Covers body parsing, validation, CORS and preflight, health, 401, per-client rate limiting behind `TRUST_PROXY`, and webhook signature on raw bytes | `App middleware tests passed.` | PASS with local Redis 7 **and a throw-on-use stand-in Prisma client** (the real client could not be generated) |
| AT-09 | `npm run test:scan-queue` | Redis | `BullMQ scan queue test passed.` | PASS (stand-in client) |
| AT-10 | `npm run test:repair-queue` | Redis | `BullMQ repair queue test passed.` | PASS (stand-in client) |
| AT-11 | `npm run test:context -- ../bug-test-repo` and `npm run test:repair-workspace -- ../test-generation-repo` | git; paths are arguments | AT-11a prints the repository context; AT-11b ends `Day 16 repair workspace test passed.` and leaves the fixture unchanged | PASS (smoke; no assertions in 11a) |
| AT-12 | `npm run test:rag` | `REPOSITORY_ID` and `REPOSITORY_PATH` plus a database for the real run | prints `Database integration skipped…` otherwise | PASS only as a skip — the database part is NOT EXECUTED |
| AT-13 | `npx tsc --noEmit` | the real generated Prisma client | exits 0 | BLOCKED. With the stand-in client it prints the same 14 errors as the baseline (1 missing `PrismaClient` export + 13 implicit-`any` that come from it); no other category |
| AT-14 | `npm run build` | the real generated Prisma client | `dist/` created | BLOCKED (same reason) |
| AT-15 | `cd client && npm run lint` | – | no output, exit 0 | PASS |
| AT-16 | `cd client && npx tsc -b && npm run build` | – | `✓ built in …` | PASS |
| AT-17 | `npm audit` in `server/` and `client/` | network | see below | server: 3 high; client: 0 after the lockfile fix |
| AT-18 | `docker compose config -q` (project root, with `server/.env`, `DATABASE_URL`, `REDIS_PASSWORD` present) | Docker CLI only | exit 0 | PASS |
| AT-19 | `docker compose build` | Docker daemon + Docker Hub access | all images build | NOT EXECUTED (14 Oct 2026: daemon started but Docker Hub returned 403) |

Scripts needing API keys, a GitHub token or a Docker daemon (`test:ai`, `test:openrouter`, `test:groq`, `test:gemini`, `test:bug-agent`, `test:security-agent`, `test:test-generation`, `test:fix-agent`, `test:verification-agent`, `test:analysis-pipeline`, `test:docker-runner`, `test:repair-retry`, `test:github-pr`, `test:autonomous-repair`, `test:repair-job-history`, `test:repair-job-pagination`, `test:repair-job-metrics`) are **NOT EXECUTED**. Several spend money or modify GitHub; read each script first. Without keys they stop immediately with `No AI provider is configured…` or `Set ANALYSIS_ID…` — that is the missing-prerequisite message, not a defect.

**Dependency advisories.** Server: `deepmerge-ts` < 8 (stack exhaustion on recursive objects) reached through `prisma → @prisma/config → deepmerge-ts 7.1.5`. The only suggested fix is a downgrade to `prisma@6.12.0`; the newest 6.x and 7.x `@prisma/config` still pin 7.1.5. Not applied. Client: `source-map-js` fixed by updating the lockfile to 1.2.2.

Benchmark CLI: `npm run benchmark:evaluate` evaluates a results file against `server/benchmarks/seeded-repo/ground-truth.json`; `run-results.example.json` is a hand-written illustration, not a measured result.

---

## E. Functional Test Cases

Setup once (bash):

```bash
BASE=http://localhost:5000/api
EMAIL="tester+$(date +%s)@example.com"
PASS='CorrectHorse123'
```

### TC-01 — Health check — EXECUTED (PASS)
- **Preconditions:** API running.
- **Action:** `curl -i $BASE/health`
- **Expected:** `200`, `{"success":true,"message":"RepoDoctor API is running","timestamp":"..."}`. The endpoint does not check the database or Redis.
- **PASS if** status 200 and `success` is `true`.

### TC-02 — Register (happy path) — NOT EXECUTED (needs database)
- **Preconditions:** migrations applied.
- **Action:** `curl -i -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"name\":\"Test User\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"`
- **Expected:** `201`, `{"message":"Registration successful","token":"<jwt>","user":{"id","name","email"}}`; the email is lower-cased.
- **PASS if** status 201 and `token` is a non-empty string.

### TC-03 — Register invalid input — EXECUTED for rows 1–4 (PASS); row 5 NOT EXECUTED
Expected status **400** unless stated.

| Payload | Expected `message` |
|---|---|
| `{"name":"A","email":"not-an-email","password":"longenough1"}` | `Enter a valid email address` (proves the JSON body is parsed) |
| `{"name":"A","email":"a@b.co","password":"short"}` | `Name and email are required; password must be 8–128 characters` |
| `{"email":"a@b.co","password":"longenough1"}` | same as above |
| `{}` | same as above |
| the TC-02 payload sent twice | **409** `User already exists` |

- **PASS if** every row returns the stated status and message.

### TC-04 — Login — PARTLY EXECUTED (empty password → 400 PASS; the rest needs a database)
- **Action:** `curl -i -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"`
- **Expected:** `200`, `{"success":true,"message":"Login successful","data":{"token":"<jwt>","user":{...}}}`. Wrong password or unknown email → `401 Invalid email or password`. Empty password → `400 {"success":false,"message":"Email and password are required"}`.
- Keep the token: `TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .data.token)`
- **PASS if** statuses and messages match. (Note the response shapes differ from register: login nests under `data`. The client accepts both.)

### TC-05 — Auth rate limiting — PARTLY EXECUTED
- **Preconditions:** a fresh API process (counters are in memory and **every** earlier 4xx on `/api/auth` counts, including the 400s from TC-03/TC-04).
- **Action:** `for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"x@y.co","password":"bad"}'; done`
- **Expected:** ten `401` (needs the database) then `429` with `{"error":"Too many authentication attempts. Try again later."}`. Successful logins are not counted. General limit: 100 requests per 15 minutes per client.
- **PASS if** a `429` appears after ten failures. Restart the API to reset.
- *Executed variant:* with an empty `password` (which returns `400` without a database) the sequence was `400 400 400 429 …` because earlier 400s in the same process counted. The proxy-aware behaviour is covered by AT-08.
- **Behind a proxy:** with `TRUST_PROXY=1`, different `X-Forwarded-For` values have separate counters (AT-08, PASS); without it all clients share the proxy's address.

### TC-06 — Current user and JWT protection — PARTLY EXECUTED
- **Action and expected:** `curl -i $BASE/auth/me` → `401 {"message":"Authentication required"}` (PASS); `-H "Authorization: Bearer garbage"` → `401 {"message":"Invalid or expired token"}` (PASS); with a valid `$TOKEN` → `200` with `user.id/name/email/githubUsername` (needs the database; NOT EXECUTED).
- **PASS if** all three statuses match.

### TC-07 — CORS — EXECUTED (PASS, one correction)
- **Action:** `curl -i -X OPTIONS $BASE/auth/login -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'`
- **Expected:** `204` with `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.
- **Correction to the earlier guide:** the API answers with the single configured `FRONTEND_URL` even for a different request `Origin` (observed with `Origin: http://evil.example`). It does not omit the header; the **browser** then refuses the mismatch. Do not use `curl` to test origin blocking.
- **PASS if** the allow-origin header equals `FRONTEND_URL`.

### TC-08 — Connect GitHub (OAuth) — NOT EXECUTED
- **Preconditions:** OAuth App with callback `http://localhost:5000/api/github/callback`; logged in.
- **Action:** in the client, log in and use **Connect GitHub**; or `curl -i $BASE/github/connect -H "Authorization: Bearer $TOKEN"` (returns `{"authUrl": ...}` and a short-lived `github_oauth_state` cookie) and open `authUrl` in a browser that holds that cookie.
- **Expected:** the browser returns to `FRONTEND_URL`; `GET $BASE/auth/me` shows `githubUsername`. A tampered or expired `state` → `400`.
- **Database check (the table is `users`, not `"User"`):** `psql "$PSQL_URL" -c 'select "githubUsername", length("githubAccessToken"), ("githubAccessToken" like '"'"'%.%.%'"'"') as encrypted from users;'` — with `GITHUB_TOKEN_ENCRYPTION_KEY` set `encrypted` is `t`; without it the token is stored as plain text (the server logs a one-time warning). **Never print the token itself.**
- **PASS if** the user has `githubUsername` and, with a key set, `encrypted` is `t`.

### TC-09 — Sync and list repositories — NOT EXECUTED
- **Preconditions:** TC-08.
- **Action:** `curl -s $BASE/github/repositories -H "Authorization: Bearer $TOKEN"` (syncs from GitHub), then `curl -s $BASE/repositories -H "Authorization: Bearer $TOKEN"`.
- **Expected:** `200` and your repositories with `id`, `fullName`, `defaultBranch`. Without GitHub connected: `400 GitHub account is not connected`. Save an id: `REPO_ID=<id>`.
- **PASS if** your repositories are listed.

### TC-10 — Scan a repository (queue, scan worker, AI) — NOT EXECUTED
- **Preconditions:** TC-09; scan worker running; one AI key set; a small JS/TS repository.
- **Action:** `curl -i -X POST $BASE/repositories/ingest -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"repositoryId\":\"$REPO_ID\"}"` → `202` with `jobId`. Poll `curl -s $BASE/repositories/jobs/<jobId> -H "Authorization: Bearer $TOKEN"` until `status` is `completed`. Progress stages: `starting`, `clone`, `repository-analysis`, `context`, `repository-memory`, `security-analysis`, `test-generation`, `risk-assessment`, `completed`.
- **Expected:** `result.analysisId` set; `GET $BASE/repositories/$REPO_ID/analysis/latest` returns findings, risk assessments and **generated tests**, and `projectType`, `language`, `framework`, `packageManager` are **not null** for an ordinary Node project.
- **Invalid input:** missing `repositoryId` → `400`; unknown id or another user's repository → `404`; GitHub not connected → `400`.
- **PASS if** the job completes and the analysis carries the analyzer metadata and generated tests.

### TC-11 — Scan retry does not duplicate results — NOT EXECUTED
- **Preconditions:** TC-10 setup.
- **Action:** stop the scan worker with `Ctrl+C` while the job is in `security-analysis`/`test-generation`, restart it, let the job retry (up to 3 attempts), then compare `psql "$PSQL_URL" -Atc "select count(*) from \"BugFinding\" where \"analysisId\"='<analysisId>'"` with the number of `bugFindings` in the API response. Note that `Ctrl+C` waits for the active job to finish; use `kill -9` on the worker to simulate a crash, and wait for BullMQ's stalled-job check to re-queue the job.
- **PASS if** both counts are equal (the pipeline clears earlier results when it re-runs). Hard to trigger deterministically; record NOT TESTED if you cannot.

### TC-12 — Cross-user isolation — NOT EXECUTED
- **Action:** register a second user, obtain `TOKEN2`, then `curl -i $BASE/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN2"` and `curl -i $BASE/repositories/jobs/<jobId from TC-10> -H "Authorization: Bearer $TOKEN2"`.
- **Expected:** `404` for both; the repository is not in user 2's `GET $BASE/repositories`.
- **PASS if** user 2 never sees user 1's data. (No automated test covers this yet.)

### TC-13 — Delete repository — NOT EXECUTED
- **Action:** `curl -i -X DELETE $BASE/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN"`
- **Expected:** `204`; repeating it → `404 Repository not found`; `409` if related repair records block the delete.
- **PASS if** 204 then 404.

### TC-14 — Queue a repair (validation) — PARTLY EXECUTED
- **Preconditions:** a valid JWT (`TOKEN`). For the success path also a completed analysis (TC-10), `FINDING_ID` from `analysis/latest`, and GitHub connected.
- **Executed (HTTP 400, JWT only):** missing `analysisId`; `"testCommand":"npm test"` (string); `"testCommand":["bash","-c","id"]`. Messages: `analysisId and findingId are required` / `testCommand must be an argument array starting with node, npm, npx, pnpm, or yarn`.
- **Not executed:** more than 20 array items → `400`; unknown finding → `404 Finding not found in this analysis`; another user's analysis → `404 Analysis not found`; GitHub not connected → `400 Connect GitHub before starting a repair`.
- **Action (valid):** `curl -i -X POST $BASE/repairs -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"analysisId\":\"<analysisId>\",\"findingId\":\"$FINDING_ID\",\"testCommand\":[\"npm\",\"test\"]}"` → `202 {"status":"QUEUED","jobId":...}`.
- **PASS if** every invalid case is rejected with the stated status and the valid one is queued.

### TC-15 — Autonomous repair end to end (disposable repository only) — NOT EXECUTED
- **Preconditions:** repair worker with git and Docker daemon access; a GitHub token with push rights to a **throwaway** repository that has a test script; TC-14.
- **Action:** poll `GET $BASE/repairs/jobs/<jobId>` until `completed` or `failed`.
- **Expected:** up to three attempts, each in a fresh workspace and a `--network none` container. A pull request is opened **only** when the verification status is `VERIFIED`, and it is never merged. If the container exits non-zero or times out the result must be `FAILED` or `INCONCLUSIVE` and **no PR** is created, even if the model said otherwise (execution gate, unit-tested by AT-06).
- **Database check:** `psql "$PSQL_URL" -c 'select "attemptNumber","status","failureReason" from "RepairAttempt" order by "createdAt";'` and `psql "$PSQL_URL" -c 'select "status","testPassed","regressionDetected" from "VerificationResult" order by "createdAt";'`; PR rows: `select "status","pullRequestUrl" from "PullRequest";`
- **PASS if** a PR exists only for a run whose container exit code was 0. Repositories whose tests need installed packages will legitimately end `INCONCLUSIVE` (no network, no `node_modules` in the clone).

### TC-16 — GitHub webhook signature — EXECUTED (PASS)
- **Preconditions:** `GITHUB_WEBHOOK_SECRET` set in the API's environment (it is read per request), API running.
- **Action:**
```bash
export GITHUB_WEBHOOK_SECRET='<same value the API uses>'
BODY='{"zen":"test","repository":{"id":1}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | sed 's/^.* //')"
curl -i -X POST $BASE/github/webhook -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: $SIG" -H 'X-GitHub-Event: ping' -H 'X-GitHub-Delivery: manual-1' -d "$BODY"
```
- **Expected:** `200 {"accepted":true,"event":"ping"}`. A wrong signature → `401 Invalid webhook signature`; missing headers → `400 Missing required GitHub webhook headers or body`; secret not configured → `503`.
- **PASS if** the four outcomes match (three were run against a live API; `503` is covered by AT-08).
- A signed `push` for a known repository queues a scan; a tag push, a fork pull request or an unknown repository is acknowledged with `202` and ignored — NOT EXECUTED (needs the database).

### TC-17 — Real-time progress (Socket.IO) — PARTLY EXECUTED
- **Executed:** a `socket.io-client` connection with `auth: { token }` succeeded over websocket and polling both directly (`:4000`) and through nginx on `:8080` with `client/nginx.conf`; a bad token was rejected with `Invalid authentication token`.
- **Not executed:** progress events during a real scan.
- **Action:** with the client open on the repository list, start a scan (TC-10) and watch the progress text; the page also polls job status every 5 s as a fallback.
- **PASS if** progress updates arrive for your jobs and not another user's, and a connection with an invalid token is refused.

### TC-18 — Client UI smoke test — NOT EXECUTED (only lint, typecheck and build ran)
1. Open `http://localhost:5173`; register a new account → `Account created successfully`; reload, log in → `Login successful`.
2. Click **Connect GitHub**, authorize, return; the repository list loads.
3. Click **Refresh repositories** → the list reloads.
4. Click **Analyze Repository** (the label becomes `Scan queued/running…` while it runs) → progress updates; **View analysis** shows findings and generated tests; **Close analysis** closes the panel; **Remove repository** deletes it.
5. Failure check: stop the API, click **Refresh repositories** → an error message beginning `Failed to load repositories`, not a blank page.
- **PASS if** each step behaves as described.

### TC-19 — Token lifetime (`JWT_EXPIRES_IN`) — PARTLY EXECUTED (token generation checked: `1m` → 60, `forever` → 86400; the HTTP login path needs the database)
- **Action:** set `JWT_EXPIRES_IN=1m`, restart the API, log in, decode the token: `echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp - .iat'`.
- **Expected:** `60`. With an invalid value (for example `forever`) the difference is `86400`.
- If `base64 -d` complains about padding, use `echo "$TOKEN" | jq -R 'split(".")[1] | @base64d | fromjson | .exp - .iat'`.
- **PASS if** the difference matches.

### TC-20 — Compose stack smoke test — NOT EXECUTED (needs Docker)
1. `docker compose up --build -d` (add `--profile bundled-db` if used); `docker compose ps` → `redis` and `server` healthy, `migrate` exited with code 0 (`docker compose logs migrate` ends with `All migrations have been successfully applied.`).
2. `curl -i http://localhost:8080/api/health` → `200` (through nginx).
3. Open `http://localhost:8080`, log in, start a scan, and confirm live progress without console errors about `/socket.io/`.
4. `docker compose logs repair-worker` → the worker starts; any repair job ends `INCONCLUSIVE` because the image has no Docker CLI.
- **PASS if** steps 1–3 behave as described.

---

## F. Common Errors and Troubleshooting

| Symptom | Diagnose | Fix |
|---|---|---|
| `npm ci` in `server/` fails at `prisma generate` with `Failed to fetch sha256 checksum … 403` | the network or proxy blocks `binaries.prisma.sh` (reproduced) | allow that host (or use a mirror), then `npx prisma generate`. `npm ci --ignore-scripts` only skips the problem; `tsc` and `npm run build` will still fail |
| `tsc`: `Module '@prisma/client' has no exported member 'PrismaClient'` plus `TS7006` errors | Prisma client not generated | `cd server && npx prisma generate` |
| API exits: `JWT_SECRET must be configured` | `.env` missing or incomplete | create `server/.env` from the example |
| API exits at start with a Prisma connection error | `psql "$PSQL_URL" -c 'select 1'` | start PostgreSQL / fix `DATABASE_URL` |
| `psql: error: invalid URI query parameter: "schema"` | you passed `DATABASE_URL` as-is | use `PSQL_URL="${DATABASE_URL%%\?*}"` |
| `relation "User" does not exist` | the table is `users` | query `users` |
| `Error: No AI provider is configured…` at start of a scan/pipeline script | `grep -E '^(OPENROUTER|GROQ|GEMINI)_API_KEY' server/.env` | set at least one real key (not empty, not `...`) |
| Register/login says `Name and email are required…` for a valid payload | an old build with auth mounted before the JSON parser | use the current code; run `npm run test:app` |
| Scan stays `waiting` | `redis-cli ping`; is `npm run worker` running? | start the worker; check `REDIS_*` |
| `ECONNREFUSED 127.0.0.1:6379` | Redis not running | start Redis; in Compose use `REDIS_HOST=redis` |
| `NOAUTH` / `WRONGPASS` from Redis | the Redis instance has a password | set `REDIS_PASSWORD` (and `REDIS_USERNAME` if used) |
| Repair job `failed` or `INCONCLUSIVE` with a Docker error | `docker info` on the worker's machine | start Docker or give the worker a daemon; never treat it as verified |
| Verification `INCONCLUSIVE` | read the job `result` | the repository tests need dependencies (no network in the container), have no test command, or Docker itself failed |
| `GitHub token is encrypted but GITHUB_TOKEN_ENCRYPTION_KEY is not set` | the key is missing in this process | restore the key used when the token was stored, or reconnect GitHub |
| `GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes` | wrong key length | regenerate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| 429 on every request behind a proxy | all clients share the proxy IP | set `TRUST_PROXY=1` (number of proxies) |
| Live progress never appears behind nginx; browser shows failed `/socket.io/` requests | the nginx config lacks the `/socket.io/` block | use the current `client/nginx.conf` |
| `docker compose` says `env file …/server/.env not found` | missing file | `cp server/.env.example server/.env` |
| `docker compose` rejects `REDIS_PASSWORD` (`required variable ... is missing a value`) | variable unset or empty | put it in a root `.env` (`cp .env.example .env`); with `--profile bundled-db` also set `POSTGRES_PASSWORD`, otherwise `DATABASE_URL` |
| After GitHub login the browser goes to `localhost:5173` under Compose | `FRONTEND_URL` still has the template value | set `FRONTEND_URL=http://localhost:8080` in `server/.env`, then `docker compose up -d` |
| Deployed (hosted) frontend cannot log in or connect GitHub | see the symptom table in the root README | [Deploying the frontend](../README.md#deploying-the-frontend-and-connecting-the-github-repository) |
| Compose image build fails while pulling `node`, `nginx`, `redis` or `postgres` | Docker Hub unreachable (403 in the audit sandbox) | allow `registry-1.docker.io` or use a mirror |
| Prisma error about OpenSSL / engine not found inside a container | the generated client targets a different OpenSSL | rebuild with the current `server/Dockerfile` (installs `openssl` in the build stage); NOT image-tested |
| GitHub OAuth cookie missing in a Compose run on plain HTTP | `NODE_ENV=production` marks the state cookie `Secure` | browsers accept it on `localhost`, but not on other plain-HTTP hosts; use HTTPS in front |

---

## G. Cleanup and Shutdown

```bash
# 1. Foreground processes: Ctrl+C in terminals 1-4. Idle API and workers exit with status 0 in well under a second.
#    A worker waits for its active job before exiting.

# 2. Local development containers from section B (the pg container's data is lost with it)
docker stop repodoctor-redis repodoctor-pg
docker rm repodoctor-redis repodoctor-pg          # skip the pg line to keep the database

#    Non-Docker services
pg_ctlcluster 16 main stop                        # as root, if you started it in section B
redis-cli shutdown nosave                         # stops a local Redis

# 3. Compose
docker compose down                               # keeps the volumes; add -v only to delete them (redis_data, and postgres_data with --profile bundled-db)

# 4. Build artifacts (safe; regenerated by builds)
rm -rf server/dist client/dist

# 5. Temporary workspaces from analysis/repair (normally removed automatically); inspect before deleting
ls "${TMPDIR:-/tmp}/repodoctor" 2>/dev/null
```

Do not delete `server/.env`, the migrations, the database volume or the lockfiles unless you intend to.

---

## H. Final Verification Checklist

- [ ] `cd server && npm ci` completes and the Prisma client is generated.
- [ ] `npx prisma migrate deploy` applies all 16 migrations.
- [ ] AT-01 … AT-07 exit 0 (no services needed).
- [ ] AT-08 … AT-10 exit 0 with Redis running.
- [ ] `npx tsc --noEmit` and `npm run build` in `server/` succeed with the **real** Prisma client.
- [ ] `cd client && npm run lint && npm run build` succeed.
- [ ] `npm audit` reviewed in both folders (server: the 3 `deepmerge-ts` findings are expected).
- [ ] TC-01, TC-02, TC-03, TC-04, TC-06 behave as specified.
- [ ] Scan worker completes a scan (TC-10); the analysis contains generated tests and non-null project metadata.
- [ ] Cross-user access returns 404 (TC-12).
- [ ] Webhook accepts a valid and rejects an invalid signature (TC-16).
- [ ] `docker compose build` and TC-20 pass on a machine with Docker.
- [ ] (Optional, disposable repository) repair flow behaves as TC-15 and never opens a PR for a non-zero test exit.
- [ ] All processes stop cleanly; temporary containers removed.
