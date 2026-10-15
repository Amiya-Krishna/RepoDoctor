# RepoDoctor AI — Manual Testing and Execution Guide

## A. Prerequisites

| Item | Requirement |
|---|---|
| OS | Linux, macOS or Windows. Commands are bash; on Windows use Git Bash or WSL, or the PowerShell variants given in sections C and the root README. Docker Desktop must be running for Docker steps |
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
| `PORT` | API | default `5000` for `npm run dev` (Compose sets `4000` inside its network; only host port `8080` is published) |
| `FRONTEND_URL` | CORS, Socket.IO, OAuth redirect | default `http://localhost:5173` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | queues | defaults `127.0.0.1`, `6379`, none (not a URL) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | GitHub OAuth | callback in the template: `http://localhost:5000/api/github/callback` (for Docker Compose use `http://localhost:8080/api/github/callback` and `FRONTEND_URL=http://localhost:8080`) |
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

---

## C. Run the Project

Use four terminals from the project root (on Windows PowerShell: four windows; in each of the three server windows start with `cd server`, in the client window `cd client`, and run the command from the table without the `cd ... &&` part).

| Terminal | Command | Expected output | URL / port |
|---|---|---|---|
| 1 – API + Socket.IO | `cd server && npm run dev` | `PostgreSQL connected successfully`, then `RepoDoctor API and realtime server listening on port 5000` | `http://localhost:5000/api/health` |
| 2 – Scan worker | `cd server && npm run worker` | `RepoDoctor scan worker started` | – |
| 3 – Repair worker (needs git and a Docker daemon) | `cd server && npm run repair-worker` | `RepoDoctor autonomous repair worker started` | – |
| 4 – Client | `cd client && npm run dev` | Vite prints `Local: http://localhost:5173/` | `http://localhost:5173` |

Production-style run:

```bash
cd server && npm run build && npm start        # tsc -> dist/, then node dist/server.js  
cd client && npm run build && npm run preview  # static build in client/dist
```

### Docker Compose 

```powershell
# Windows PowerShell equivalent (Docker Desktop running; one command per line)
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
docker compose config -q
docker compose up --build -d
docker compose ps
docker compose down
```

```bash
cp server/.env.example server/.env             # fill in; set FRONTEND_URL=http://localhost:8080 and GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback; PORT, DATABASE_URL, REDIS_*, NODE_ENV and TRUST_PROXY are overridden by Compose
cp .env.example .env                           # root file: set REDIS_PASSWORD and DATABASE_URL (external, e.g. Neon) or POSTGRES_PASSWORD (bundled)
docker compose config -q                       
docker compose up --build -d                 
docker compose ps                              # server should become "healthy"; migrate exits 0; client waits for server
docker compose down                            # keeps volumes; `down -v` deletes them
```

Bundled PostgreSQL: comment out `DATABASE_URL` in the root `.env`, set `POSTGRES_PASSWORD` (letters, digits, `-`, `_`) and put `--profile bundled-db` after `docker compose` in every command above (including `down`); such as `docker compose --profile bundled-db config -q`. Without the profile no `postgres` container exists and `DATABASE_URL` must point to a database reachable from the containers (for a database on the Docker host use `host.docker.internal`; on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`, which would be a change to `docker-compose.yml`).

---

## D. Automated Checks

Run in `server/` unless stated. There is no `npm test`, no test framework and no server linter. The "tests" are standalone `tsx` scripts that exit non-zero on failure.

| ID | Command | Needs | Expected last line / result | 
|---|---|---|---|
| AT-01 | `npm run test:risk-engine` | nothing | exits 0 (prints severity counts) | 
| AT-02 | `npm run test:webhook-signature` | nothing | `GitHub webhook signature tests passed.` | 
| AT-03 | `npm run test:static-security` | nothing | `Static security scanner tests passed.` | 
| AT-04 | `npm run test:benchmark` | nothing | `Benchmark evaluator tests passed.` | 
| AT-05 | `npm run test:security` | nothing (makes its own key). Covers token round trip, wrong key, bad key length, legacy plaintext, `JWT_EXPIRES_IN` parsing, command policy, untrusted-context wrapper | `Security control tests passed.` |
| AT-06 | `npm run test:verification-gate` | nothing | `Verification gate tests passed.` | 
| AT-07 | `npm run test:ai-selection` | Node + `tsx` only; spawns child processes, no network | `AI provider selection tests passed.` | 
| AT-08 | `npm run test:app` | Redis on `127.0.0.1:6379` and a loadable Prisma client; never touches the database. Covers body parsing, validation, CORS and preflight, health, 401, per-client rate limiting behind `TRUST_PROXY`, and webhook signature on raw bytes | `App middleware tests passed.` | 
| AT-09 | `npm run test:scan-queue` | Redis | `BullMQ scan queue test passed.` |
| AT-10 | `npm run test:repair-queue` | Redis | `BullMQ repair queue test passed.` | 
| AT-11 | `npm run test:context -- ../bug-test-repo` and `npm run test:repair-workspace -- ../test-generation-repo` | git; paths are arguments | AT-11a prints the repository context; AT-11b ends `Day 16 repair workspace test passed.` and leaves the fixture unchanged |
| AT-12 | `npm run test:rag` | `REPOSITORY_ID` and `REPOSITORY_PATH` plus a database for the real run | prints `Database integration skipped…` otherwise | 
| AT-13 | `npx tsc --noEmit` | the real generated Prisma client | exits 0 |
| AT-14 | `npm run build` | the real generated Prisma client | `dist/` created | 
| AT-15 | `cd client && npm run lint` | – | no output, exit 0 | 
| AT-16 | `cd client && npx tsc -b && npm run build` | – | `✓ built in …` |
| AT-17 | `npm audit` in `server/` and `client/` | network | see below | 
| AT-18 | `docker compose config -q` (project root, with `server/.env`, `DATABASE_URL`, `REDIS_PASSWORD` present) | Docker CLI only | exit 0 | 
| AT-19 | `docker compose build` | Docker daemon + Docker Hub access | all images build |

Benchmark CLI: `npm run benchmark:evaluate` evaluates a results file against `server/benchmarks/seeded-repo/ground-truth.json`.

---

## E. Functional Test Cases

Setup once (bash):

```bash
BASE=http://localhost:5000/api
EMAIL="tester+$(date +%s)@example.com"
PASS='CorrectHorse123'
```

### TC-01 — Health check
- **Preconditions:** API running.
- **Action:** `curl -i $BASE/health`
- **Expected:** `200`, `{"success":true,"message":"RepoDoctor API is running","timestamp":"..."}`. The endpoint does not check the database or Redis.
- **PASS if** status 200 and `success` is `true`.

### TC-02 — Register (happy path)
- **Preconditions:** migrations applied.
- **Action:** `curl -i -X POST $BASE/auth/register -H 'Content-Type: application/json' -d "{\"name\":\"Test User\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"`
- **Expected:** `201`, `{"message":"Registration successful","token":"<jwt>","user":{"id","name","email"}}`; the email is lower-cased.
- **PASS if** status 201 and `token` is a non-empty string.

### TC-03 — Register invalid input
Expected status **400** unless stated.

| Payload | Expected `message` |
|---|---|
| `{"name":"A","email":"not-an-email","password":"longenough1"}` | `Enter a valid email address` (proves the JSON body is parsed) |
| `{"name":"A","email":"a@b.co","password":"short"}` | `Name and email are required; password must be 8–128 characters` |
| `{"email":"a@b.co","password":"longenough1"}` | same as above |
| `{}` | same as above |
| the TC-02 payload sent twice | **409** `User already exists` |

- **PASS if** every row returns the stated status and message.

### TC-04 — Login
- **Action:** `curl -i -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"`
- **Expected:** `200`, `{"success":true,"message":"Login successful","data":{"token":"<jwt>","user":{...}}}`. Wrong password or unknown email → `401 Invalid email or password`. Empty password → `400 {"success":false,"message":"Email and password are required"}`.
- Keep the token: `TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .data.token)`
- **PASS if** statuses and messages match. (Note the response shapes differ from register: login nests under `data`. The client accepts both.)

### TC-05 — Auth rate limiting 
- **Preconditions:** a fresh API process (counters are in memory and **every** earlier 4xx on `/api/auth` counts, including the 400s from TC-03/TC-04).
- **Action:** `for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"x@y.co","password":"bad"}'; done`
- **Expected:** ten `401` (needs the database) then `429` with `{"error":"Too many authentication attempts. Try again later."}`. Successful logins are not counted. General limit: 100 requests per 15 minutes per client.
- **PASS if** a `429` appears after ten failures. Restart the API to reset.
- *Executed variant:* with an empty `password` (which returns `400` without a database); The proxy-aware behaviour is covered by AT-08.
- **Behind a proxy:** with `TRUST_PROXY=1`, different `X-Forwarded-For` values have separate counters (AT-08); without it all clients share the proxy's address.

### TC-06 — Current user and JWT protection
- **Action and expected:** `curl -i $BASE/auth/me` → `401 {"message":"Authentication required"}` (PASS); `-H "Authorization: Bearer garbage"` → `401 {"message":"Invalid or expired token"}` (PASS); with a valid `$TOKEN` → `200` with `user.id/name/email/githubUsername` (needs the database; NOT EXECUTED).
- **PASS if** all three statuses match.

### TC-07 — CORS
- **Action:** `curl -i -X OPTIONS $BASE/auth/login -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'`
- **Expected:** `204` with `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.
- **PASS if** the allow-origin header equals `FRONTEND_URL`.

### TC-08 — Connect GitHub (OAuth)
- **Preconditions:** OAuth App with callback `http://localhost:5000/api/github/callback`; logged in.
- **Action:** in the client, log in and use **Connect GitHub**; or `curl -i $BASE/github/connect -H "Authorization: Bearer $TOKEN"` (returns `{"authUrl": ...}` and a short-lived `github_oauth_state` cookie) and open `authUrl` in a browser that holds that cookie.
- **Expected:** the browser returns to `FRONTEND_URL`; `GET $BASE/auth/me` shows `githubUsername`. A tampered or expired `state` → `400`.
- **Database check:** `psql "$PSQL_URL" -c 'select "githubUsername", length("githubAccessToken"), ("githubAccessToken" like '"'"'%.%.%'"'"') as encrypted from users;'` — with `GITHUB_TOKEN_ENCRYPTION_KEY` set `encrypted` is `t`; without it the token is stored as plain text (the server logs a one-time warning). **Never print the token itself.**
- **PASS if** the user has `githubUsername` and, with a key set, `encrypted` is `t`.

### TC-09 — Sync and list repositories
- **Preconditions:** TC-08.
- **Action:** `curl -s $BASE/github/repositories -H "Authorization: Bearer $TOKEN"` (syncs from GitHub), then `curl -s $BASE/repositories -H "Authorization: Bearer $TOKEN"`.
- **Expected:** `200` and your repositories with `id`, `fullName`, `defaultBranch`. Without GitHub connected: `400 GitHub account is not connected`. Save an id: `REPO_ID=<id>`.
- **PASS if** your repositories are listed.

### TC-10 — Scan a repository (queue, scan worker, AI) 
- **Preconditions:** TC-09; scan worker running; one AI key set; a small JS/TS repository.
- **Action:** `curl -i -X POST $BASE/repositories/ingest -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"repositoryId\":\"$REPO_ID\"}"` → `202` with `jobId`. Poll `curl -s $BASE/repositories/jobs/<jobId> -H "Authorization: Bearer $TOKEN"` until `status` is `completed`. Progress stages: `starting`, `clone`, `repository-analysis`, `context`, `repository-memory`, `security-analysis`, `test-generation`, `risk-assessment`, `completed`.
- **Expected:** `result.analysisId` set; `GET $BASE/repositories/$REPO_ID/analysis/latest` returns findings, risk assessments and **generated tests**, and `projectType`, `language`, `framework`, `packageManager` are **not null** for an ordinary Node project.
- **Invalid input:** missing `repositoryId` → `400`; unknown id or another user's repository → `404`; GitHub not connected → `400`.
- **PASS if** the job completes and the analysis carries the analyzer metadata and generated tests.

### TC-11 — Scan retry does not duplicate results
- **Preconditions:** TC-10 setup.
- **Action:** stop the scan worker with `Ctrl+C` while the job is in `security-analysis`/`test-generation`, restart it, let the job retry (up to 3 attempts), then compare `psql "$PSQL_URL" -Atc "select count(*) from \"BugFinding\" where \"analysisId\"='<analysisId>'"` with the number of `bugFindings` in the API response. Note that `Ctrl+C` waits for the active job to finish; use `kill -9` on the worker to simulate a crash, and wait for BullMQ's stalled-job check to re-queue the job.
- **PASS if** both counts are equal (the pipeline clears earlier results when it re-runs). Hard to trigger deterministically; record NOT TESTED if you cannot.

### TC-12 — Cross-user isolation 
- **Action:** register a second user, obtain `TOKEN2`, then `curl -i $BASE/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN2"` and `curl -i $BASE/repositories/jobs/<jobId from TC-10> -H "Authorization: Bearer $TOKEN2"`.
- **Expected:** `404` for both; the repository is not in user 2's `GET $BASE/repositories`.
- **PASS if** user 2 never sees user 1's data. (No automated test covers this yet.)

### TC-13 — Delete repository
- **Action:** `curl -i -X DELETE $BASE/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN"`
- **Expected:** `204`; repeating it → `404 Repository not found`; `409` if related repair records block the delete.
- **PASS if** 204 then 404.

### TC-14 — Queue a repair (validation)
- **Preconditions:** a valid JWT (`TOKEN`). For the success path also a completed analysis (TC-10), `FINDING_ID` from `analysis/latest`, and GitHub connected.
- **Action (valid):** `curl -i -X POST $BASE/repairs -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"analysisId\":\"<analysisId>\",\"findingId\":\"$FINDING_ID\",\"testCommand\":[\"npm\",\"test\"]}"` → `202 {"status":"QUEUED","jobId":...}`.
- **PASS if** every invalid case is rejected with the stated status and the valid one is queued.

### TC-15 — Autonomous repair end to end (disposable repository only)
- **Preconditions:** repair worker with git and Docker daemon access; a GitHub token with push rights to a **throwaway** repository that has a test script; TC-14.
- **Action:** poll `GET $BASE/repairs/jobs/<jobId>` until `completed` or `failed`.
- **Expected:** up to three attempts, each in a fresh workspace and a `--network none` container. A pull request is opened **only** when the verification status is `VERIFIED`, and it is never merged. If the container exits non-zero or times out the result must be `FAILED` or `INCONCLUSIVE` and **no PR** is created, even if the model said otherwise (execution gate, unit-tested by AT-06).
- **Database check:** `psql "$PSQL_URL" -c 'select "attemptNumber","status","failureReason" from "RepairAttempt" order by "createdAt";'` and `psql "$PSQL_URL" -c 'select "status","testPassed","regressionDetected" from "VerificationResult" order by "createdAt";'`; PR rows: `select "status","pullRequestUrl" from "PullRequest";`
- **PASS if** a PR exists only for a run whose container exit code was 0. Repositories whose tests need installed packages will legitimately end `INCONCLUSIVE` (no network, no `node_modules` in the clone).

### TC-16 — GitHub webhook signature 
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

### TC-17 — Real-time progress (Socket.IO) 
- **Executed:** a `socket.io-client` connection with `auth: { token }` succeeded over websocket and polling both directly (`:4000`) and through nginx on `:8080` with `client/nginx.conf`; a bad token was rejected with `Invalid authentication token`.
- **Action:** with the client open on the repository list, start a scan (TC-10) and watch the progress text; the page also polls job status every 5 s as a fallback.
- **PASS if** progress updates arrive for your jobs and not another user's, and a connection with an invalid token is refused.

### TC-18 — Client UI smoke test 
1. Open `http://localhost:5173`; register a new account → `Account created successfully`; reload, log in → `Login successful`.
2. Click **Connect GitHub**, authorize, return; the repository list loads.
3. Click **Refresh repositories** → the list reloads.
4. Click **Analyze Repository** (the label becomes `Scan queued/running…` while it runs) → progress updates; **View analysis** shows findings and generated tests; **Close analysis** closes the panel; **Remove repository** deletes it.
5. Failure check: stop the API, click **Refresh repositories** → an error message beginning `Failed to load repositories`, not a blank page.
- **PASS if** each step behaves as described.

### TC-19 — Token lifetime (`JWT_EXPIRES_IN`) 
- **Action:** set `JWT_EXPIRES_IN=1m`, restart the API, log in, decode the token: `echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp - .iat'`.
- **Expected:** `60`. With an invalid value (for example `forever`) the difference is `86400`.
- If `base64 -d` complains about padding, use `echo "$TOKEN" | jq -R 'split(".")[1] | @base64d | fromjson | .exp - .iat'`.
- **PASS if** the difference matches.

### TC-20 — Compose stack smoke test 
1. `docker compose up --build -d` (add `--profile bundled-db` if used); `docker compose ps` → `redis` and `server` healthy, `migrate` exited with code 0 (`docker compose logs migrate` ends with `All migrations have been successfully applied.`).
2. `curl -i http://localhost:8080/api/health` → `200` (through nginx).
3. Open `http://localhost:8080`, log in, start a scan, and confirm live progress without console errors about `/socket.io/`.
4. `docker compose logs repair-worker` → the worker starts; any repair job ends `INCONCLUSIVE` because the image has no Docker CLI.
- **PASS if** steps 1–3 behave as described.

---

## F. Cleanup and Shutdown

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
