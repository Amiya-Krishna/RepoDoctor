# RepoDoctor AI

RepoDoctor AI analyzes JavaScript/TypeScript repositories, stores findings, proposes fixes, verifies repairs in an isolated Docker environment, and can publish a pull request only after strict verification.

## Current stack

- React + Vite + TypeScript
- Node.js + Express + TypeScript (ESM/NodeNext)
- PostgreSQL + Prisma
- Redis + BullMQ for background repository scans
- Socket.IO for authenticated live scan progress
- GitHub OAuth, GitHub API and signed GitHub webhooks
- AI provider manager: OpenRouter → Groq → Gemini
- Docker-based repair/test execution

## Local setup

1. Install Node.js 22+, Docker Desktop, and Git.
2. Copy `server/.env.example` to `server/.env`.
3. Set a strong `JWT_SECRET`, GitHub OAuth credentials, AI provider API keys, `GITHUB_WEBHOOK_SECRET`, and `FRONTEND_URL`.
4. From the project root, start PostgreSQL, Redis, API, and scan worker:

   ```powershell
   docker compose up --build -d postgres redis server worker repair-worker
   ```

5. Apply database migrations:

   ```powershell
   cd server
   npm install
   npx prisma migrate deploy
   npx prisma generate
   ```

6. Start the client in another terminal:

   ```powershell
   cd client
   npm install
   npm run dev
   ```

7. Open `http://localhost:5173`, register/login, connect GitHub, refresh repositories, and queue a scan.

For a local non-container backend, set `DATABASE_URL` to `localhost` and `REDIS_HOST=127.0.0.1`, then run `npm run dev`, `npm run worker`, and `npm run repair-worker` in separate terminals.

## Focused validation

After installing dependencies and applying migrations:

```powershell
cd server
npm run build
npm run test:webhook-signature
npm run test:scan-queue
npm run test:repair-queue
npm run test:repair-job-history
npm run test:repair-job-pagination
npm run test:repair-job-metrics
```

Queue tests require Redis. History/metrics tests require a reachable PostgreSQL database and their documented test environment variables. Agent/repair/PR integration tests additionally require the appropriate AI/GitHub credentials and a disposable test repository.

## GitHub webhook configuration

Configure the repository webhook URL as `https://YOUR_PUBLIC_HOST/api/github/webhook`, choose a strong webhook secret matching `GITHUB_WEBHOOK_SECRET`, select JSON payloads, and subscribe to `push` and `pull_request` events. The first implementation scans same-repository pull-request branches; fork pull requests are intentionally ignored until a separate trust policy is implemented.

## Scan flow

`POST /api/repositories/ingest` queues a scan and returns HTTP 202 with a `jobId`. The BullMQ worker clones the selected branch, creates a repository analysis record, runs static repository inspection and the unified AI analysis pipeline, and reports progress through Socket.IO. The original GitHub repository is not modified by analysis.

## Safety boundaries

- GitHub webhook requests require a valid `X-Hub-Signature-256`.
- GitHub OAuth state is signed, short-lived and bound to an HttpOnly cookie.
- Source analysis is read-only. Repair changes happen in isolated workspaces.
- GitHub tokens are not passed into Docker test containers.
- Repair attempts are capped at three; insufficient verification evidence is `INCONCLUSIVE`.
- Only strictly verified repairs may enter PR publication. RepoDoctor does not auto-merge.

## Current scope limitations

This remains an MVP under active development. Fork PR scanning, encrypted-at-rest GitHub token storage, production-grade rate limiting, full repair-job queueing, RAG, benchmark evaluation, and production deployment hardening still require implementation and validation. Do not expose the development Compose configuration directly to the public internet.
