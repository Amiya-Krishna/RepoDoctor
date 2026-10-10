# RepoDoctor AI

**AI-assisted repository analysis and verification-gated code repair for JavaScript and TypeScript projects.**

RepoDoctor AI is a student portfolio project that connects to GitHub repositories, builds a structured repository snapshot, runs AI-assisted bug and security analysis, generates test proposals, calculates deterministic risk scores, and can attempt a repair in a disposable workspace. Repair attempts are executed in Docker and may be published as a GitHub pull request only after the configured verification stage reports success. RepoDoctor does not automatically merge pull requests.

> **Project status (10 October 2026):** The supplied project archive contains implementation paths for the core analysis/repair flow and the Day 22–24 queue, webhook, and progress features. A file being present is not proof that it builds or passes integration tests. Days 25–30 are documented as the planned hardening, evaluation, deployment, documentation, and final-validation phase; the supplied archive does not contain evidence that all of those milestones were implemented or validated. See [Development history and Day 1–30 status](docs/DEVELOPMENT_HISTORY.md).

## Contents

- [Capabilities and scope](#capabilities-and-scope)
- [Technology stack](#technology-stack)
- [Architecture at a glance](#architecture-at-a-glance)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Useful commands](#useful-commands)
- [Security boundaries](#security-boundaries)
- [Known limitations](#known-limitations)
- [Documentation map](#documentation-map)

## Capabilities and scope

The supplied archive includes code for the following areas. Treat these as **implemented in the source tree, pending clean-environment verification** unless a test has been run successfully in your own environment.

- Account registration/login and JWT-protected API routes.
- GitHub OAuth/API integration and repository listing.
- Repository ingestion and static repository analysis.
- PostgreSQL persistence through Prisma.
- AI provider management with OpenRouter, Groq, and Gemini.
- Repository context building, bug detection, AI-assisted security findings, test-generation proposals, and deterministic risk scoring.
- A unified analysis pipeline and structured repair proposals.
- Disposable repair workspaces, validated patch application, Docker-based execution, conservative verification, and bounded repair retries.
- A verified-only GitHub pull-request publishing path.
- BullMQ-backed scan/repair workers, GitHub webhook handling, and authenticated Socket.IO progress events, as described in the reconciliation notes.

RepoDoctor is not a guarantee that all bugs or vulnerabilities will be found or fixed. Its intended first scope is JavaScript/TypeScript repositories with a usable test command and suitable test fixtures.

## Technology stack

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| API | Node.js, Express, TypeScript, ESM/NodeNext |
| Persistence | PostgreSQL, Prisma ORM |
| Background jobs | Redis, BullMQ, separate worker processes |
| Live progress | Socket.IO with JWT-authenticated user rooms |
| GitHub integration | OAuth, GitHub API, signed webhooks, pull requests |
| AI | `AIProviderManager`; OpenRouter → Groq → Gemini provider order |
| Repair execution | Disposable workspace and Docker runner |

The current provider factory returns `AIProviderManager`. Do not replace it with a fictional `FallbackAIProvider`. The current repository-context API requires both `repositoryPath` and `repositoryId`.

## Architecture at a glance

```text
Developer / React client
          |
          v
Express API ---- PostgreSQL (Prisma)
   |  \                 ^
   |   \                |
   |    +--> Redis / BullMQ --> Scan worker --> Repository ingestion
   |                                  |              |
   |                                  |              v
   |                                  +------> Unified analysis pipeline
   |                                                 |
   |                                  Bug + Security + Test proposals
   |                                                 |
   |                                           Risk assessment
   |
   +--> Repair queue --> Repair worker --> Disposable workspace
                                           |
                                           v
                                      Validated fix
                                           |
                                           v
                                      Docker checks
                                           |
                                  Strict verification gate
                                      /           \
                                INCONCLUSIVE     VERIFIED
                                    stop             |
                                                     v
                                              GitHub pull request
                                              (human review; no auto-merge)
```

This is the intended integrated flow represented by the source archive, not a claim that every external integration has passed an end-to-end test. Full details are in [Architecture](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22 or a compatible version supported by the project.
- npm and Git.
- Docker Desktop or Docker Engine for isolated repair verification.
- PostgreSQL and Redis, either locally or through the development Compose file.
- GitHub OAuth application credentials for the OAuth flow.
- At least one configured AI provider key for live AI analysis.
- A GitHub webhook secret if webhook-triggered scans are being tested.

## Local setup

These instructions are a starting point. Validate them against a clean checkout and your current `.env.example` files before treating them as a reproducible release procedure.

### 1. Get the project and install dependencies

```powershell
git clone <YOUR_REPOSITORY_URL>
cd RepoDoctor

cd server
npm install
cd ../client
npm install
cd ..
```

The supplied lockfiles may be stale relative to the current package manifests. Run `npm install` in each package, inspect the resulting lockfile changes, and commit them before relying on `npm ci` in a clean environment.

### 2. Configure environment variables

Copy `server/.env.example` to `server/.env`. Review `client/.env.example` if the client requires a configured API base URL. Set real values only in local environment files and never commit secrets.

Typical server settings include:

- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET` — strong, unique secret for signed sessions/tokens.
- GitHub OAuth client ID and secret.
- AI provider API keys.
- Redis host/port settings.
- `GITHUB_WEBHOOK_SECRET` — must match the secret configured in GitHub.
- `FRONTEND_URL` — expected client origin.

Use the exact variable names from the supplied `.env.example`; do not invent alternate names. The backend expects PostgreSQL and Redis to be reachable at the addresses specified by the environment.

### 3. Start infrastructure and backend workers

From the project root, the development Compose configuration can be started with:

```powershell
docker compose up --build -d postgres redis server worker repair-worker
```

**Development-only warning:** the supplied Compose setup has hard-coded development credentials and publishes database/cache ports. Do not expose it to the public internet. Review [Operations and security](docs/OPERATIONS_SECURITY.md) before using it beyond a local machine.

If running the backend outside Docker, start the API, scan worker, and repair worker in separate terminals after PostgreSQL and Redis are available:

```powershell
cd server
npm run dev
```

```powershell
cd server
npm run worker
```

```powershell
cd server
npm run repair-worker
```

Confirm the worker script names against the current `server/package.json` before running; scripts may change as the project evolves.

### 4. Apply database migrations

```powershell
cd server
npx prisma migrate deploy
npx prisma generate
```

For local schema development, use the project’s documented migration-development workflow. Do not run `npx prisma migrate reset` against a database whose data must be preserved.

### 5. Start the client

```powershell
cd client
npm run dev
```

Open the local Vite URL shown in the terminal (typically `http://localhost:5173`). Register or sign in, connect GitHub, refresh repository data, and queue a scan. Actual success depends on the database, Redis, GitHub OAuth, AI provider, and worker configuration being correct.

## Useful commands

### Backend

```powershell
cd server
npm run build
npx prisma validate
npx prisma generate
npm run test:webhook-signature
npm run test:scan-queue
npm run test:repair-queue
npm run test:repair-job-history
npm run test:repair-job-pagination
npm run test:repair-job-metrics
```

Queue tests require Redis; database-backed tests require a configured PostgreSQL database. AI/GitHub integration tests may require API keys, network access, and a disposable test repository. Run only scripts that exist in the current `server/package.json`.

### Frontend

```powershell
cd client
npm run build
npm run lint
```

### Inspect runtime logs

```powershell
docker compose ps
docker compose logs -f server worker repair-worker
```

A command listed here is a recommended validation command, not evidence that it has already passed in the authoring environment.

## Security boundaries

- Treat the connected/source repository as read-only during analysis.
- Apply fixes only inside the disposable repair workspace.
- Execute repository-controlled tests in the Docker runner, not directly on the host.
- Do not pass GitHub tokens, database credentials, or unrelated host secrets into test containers.
- Keep retries bounded to three attempts.
- Treat `INCONCLUSIVE` as a stop state, never as success.
- Permit pull-request publication only after strict verification succeeds.
- Never push to the default branch, force-push, or automatically merge.
- Treat source files, test output, webhook payloads, and model output as untrusted input.

See [Operations and security](docs/OPERATIONS_SECURITY.md) for the threat model and hardening checklist.

## Known limitations

The current archive/reconciliation notes identify these limitations or unverified areas:

- No clean build or complete end-to-end validation was completed in the authoring environment; dependency installation timed out and Docker was unavailable there.
- GitHub OAuth access tokens are stored unencrypted at rest in the supplied archive. Encrypt them before production use.
- The first webhook design deliberately ignores fork pull requests.
- Arbitrary dependency installation for every repository is not supported by the isolated/offline test runner; repositories requiring dependencies unavailable in the sandbox may fail or be inconclusive.
- The heuristic static security scanner is not a replacement for a dedicated SAST tool or dependency audit.
- RAG/repository memory, a measured seeded-defect benchmark, comprehensive production rate limiting, and production deployment hardening were listed as later milestones but are not evidenced as implemented in the supplied archive.
- The provided Compose configuration is for development, not production deployment.

Do not present any benchmark score, successful pull-request rate, or test pass rate until it has been measured and recorded with reproducible evidence.

## Documentation map

1. [Architecture and data flow](docs/ARCHITECTURE.md) — components, data flow, contracts, safety gates, and key paths.
2. [Development history and Day 1–30 status](docs/DEVELOPMENT_HISTORY.md) — cumulative milestones, reconciled status, and unresolved Day 25–30 work.
3. [Operations and security](docs/OPERATIONS_SECURITY.md) — configuration, local runbook, trust boundaries, incident handling, and deployment blockers.
4. [Testing, evaluation, and demo](docs/TESTING_EVALUATION_DEMO.md) — validation matrix, repeatable demo plan, benchmark protocol, result template, and release checklist.

The five files in this documentation set are intended to replace the older overlapping status, reconciliation, implementation-log, error-fix, and day-range notes. Keep implementation details in the relevant canonical document rather than creating multiple copies of the same instructions.
