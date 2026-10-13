# RepoDoctor AI — Server

Express 5 + TypeScript (ESM/NodeNext) backend for [RepoDoctor AI](../README.md): REST API, Socket.IO gateway, BullMQ workers, AI agents, repair loop and GitHub integration. Database is **PostgreSQL via Prisma** (not MongoDB).

> Status labels follow the [development history](../docs/DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document); 

## Notes

- `src/ai/ai.config.ts` requires at least one provider key (`OPENROUTER_API_KEY`, `GROQ_API_KEY` or `GEMINI_API_KEY`) for AI features.
- `npm run test:auth` exercises registration and login against the real app and database and cleans up its own users.
- The auth rate limit (10 failed attempts per 15 minutes) can be raised for automated runs with `AUTH_RATE_LIMIT_MAX`.
- The Docker image and Compose stack are described in [Operations §6](../docs/OPERATIONS_SECURITY.md#6-docker-compose-deployment).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` (API + Socket.IO, port `PORT`, default 5000) |
| `npm run build` / `npm start` | `tsc` to `dist/` / `node dist/server.js` |
| `npm run worker` | scan worker (`src/workers/scan.worker.ts`) |
| `npm run repair-worker` | repair worker (`src/workers/repair.worker.ts`; needs git and a Docker daemon) |
| `npm run prisma:generate`, `prisma:migrate`, `prisma:deploy` | Prisma client / dev migration / deploy migrations |
| `npm run test:*` | standalone `tsx` scripts, not a test framework; inventory and requirements in [Testing](../docs/TESTING_EVALUATION_DEMO.md#2-test-inventory) |
| `npm run benchmark:evaluate -- <ground-truth.json> <run-results.json>` | compute benchmark metrics from two JSON files |

## Setup

```powershell
copy .env.example .env      # fill in real values; never commit .env
npm install                 # postinstall runs prisma generate
npx prisma migrate deploy   # 16 migrations; never `migrate reset` on data you need
npm run dev
npm run worker              # separate terminal
npm run repair-worker       # separate terminal
```

PostgreSQL 16 and Redis 7 must be running and match `.env`. Environment variable reference: [Operations §2.2](../docs/OPERATIONS_SECURITY.md#22-server-environment-variables). Notes: Redis uses `REDIS_HOST`/`REDIS_PORT`/`REDIS_USERNAME`/`REDIS_PASSWORD` (not a URL); `JWT_EXPIRES_IN` (e.g. `12h`, `1d`) sets token lifetime and falls back to `1d` when invalid.

## API

| Path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | liveness |
| `POST /api/auth/register`, `/login`; `GET /api/auth/me` | rate limited / JWT | accounts |
| `GET /api/github/connect`, `/callback`, `/repositories` | JWT / state cookie | OAuth and repository sync |
| `POST /api/github/webhook` | HMAC-SHA256 | enqueue scan (push, same-repo PR) |
| `GET/DELETE /api/repositories[/:id]` | JWT | list, read, delete |
| `POST /api/repositories/ingest`, `GET /api/repositories/jobs/:jobId` | JWT | enqueue / poll scan |
| `GET /api/repositories/:id/analyses`, `/analysis/latest` | JWT | results |
| `POST /api/repairs`, `GET /api/repairs/jobs/:jobId` | JWT | enqueue / poll repair (`testCommand` is an argv array starting with node, npm, npx, pnpm or yarn) |

Socket.IO (JWT handshake, room `user:<id>`): `scan:progress|completed|failed`, `repair:progress|completed|failed`.

## Source layout

```text
src/app.ts, server.ts      Express app and bootstrap
src/routes, controllers/   HTTP layer
src/services/              persistence and orchestration
src/pipeline/              runAnalysisPipeline
src/context/ analyzers/    repository context and snapshot
src/agents/ prompts/ ai/   bug, security, test, fix, verification agents; OpenRouter → Groq → Gemini
src/risk/                  deterministic risk engine
src/repair/ (retry/)       workspace, patch, branch, retry loop (max 3)
src/execution/             docker.runner.ts
src/github/                REST client, PR service, webhook signature
src/queue/ workers/        repository-scan and autonomous-repair
src/realtime/              Socket.IO gateway
src/rag/                   chunker and lexical hashed-vector embedding
src/security/              token encryption, command policy, untrusted wrapper, static scanner
src/benchmark/             evaluator and CLI
src/test-*.ts              focused scripts
prisma/                    schema.prisma and migrations
benchmarks/seeded-repo/    5-case fixture and ground truth (no measured results)
```

## Safety design and gaps

Fixes are applied only in disposable workspaces; tests run in Docker with `--network none`, dropped capabilities, resource limits and a 120 s timeout; at most 3 attempts; PRs only for a verified result; no merge. Gaps: the verification verdict comes from an LLM and the Docker exit code is not enforced separately; GitHub tokens are encrypted only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set; the strict command policy, untrusted-context wrapper and audit service are not connected; generated tests are never saved. Full table: [Operations §3](../docs/OPERATIONS_SECURITY.md#3-security-control-status).
