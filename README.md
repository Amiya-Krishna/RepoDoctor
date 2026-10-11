# RepoDoctor AI

**AI-assisted analysis and verification-gated repair for JavaScript and TypeScript repositories.**

RepoDoctor AI is a student portfolio project. It connects to a user's GitHub repositories, builds a repository snapshot and context, runs AI-assisted bug and security analysis with a deterministic risk score, and can attempt a repair: generate a patch, apply it in a disposable workspace, run tests in a network-less Docker container, ask a verification step to judge the evidence, retry up to three times, and open a GitHub pull request **only if verification succeeds**. It never merges pull requests.

**Project status:** The implementation includes the main stages of the RepoDoctor workflow, with fixes for authentication middleware ordering, analysis pipeline persistence and retry handling, AI provider configuration, verification-gate enforcement, GitHub token encryption, and Docker/Compose configuration.

Additional fixes address Socket.IO proxying, OpenSSL availability in the server build stage, JWT expiry configuration, stale environment templates, client lint issues, and confirmed unused code. Regression tests and manual testing instructions have also been added or updated.

See [MANUAL_TESTING_GUIDE.md](MANUAL_TESTING_GUIDE.md) for setup instructions, commands, and steps to test the application.

**Verification limitations:** Client lint, type checking, and build checks pass. The available server test scripts and Docker Compose configuration validation also pass. However, the real Prisma Client generation and server build, Docker image builds, and live Docker integration remain unverified because of environment limitations. Database-backed application flows, live AI and GitHub integrations, and full end-to-end behavior still require verification in a properly configured environment.

The project should not be considered production-ready until the remaining integration and deployment checks have been completed.

## Contents

[Problem](#problem-statement) · [Status](#current-implementation-status) · [Architecture](#architecture) · [Core workflow](#core-workflow) · [Stack](#technology-stack) · [Setup](#setup) · [Tests](#running-checks) · [Security](#security-boundaries) · [Benchmark](#benchmark) · [Limitations](#known-limitations) · [Docs](#documentation-map) · [Roadmap](#roadmap)

## Problem statement

Triaging and fixing routine defects in a codebase is repetitive, and AI-generated patches are untrustworthy unless they are isolated and tested. RepoDoctor explores a cautious loop: propose, isolate, test, verify, then hand a pull request to a human.

The defensible claim is: *RepoDoctor attempts to detect selected classes of defects in JavaScript and TypeScript repositories, proposes and applies fixes in an isolated environment, verifies them through automated tests, and creates a pull request when validation succeeds.* It cannot fix every bug, and a passing test is evidence, not proof.

## Current implementation status

Labels are defined in the [development history](docs/DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document). Each row links to the day that owns the detail.

| Capability | Status | Day |
|---|---|---|
| Registration, login, JWT-protected routes (bcrypt) | Partially implemented (no refresh tokens) | [2](docs/DEVELOPMENT_HISTORY.md#day-2--authentication) |
| GitHub OAuth with signed, cookie-bound state | Partially implemented (token stored unencrypted) | [3](docs/DEVELOPMENT_HISTORY.md#day-3--github-oauth) |
| Repository sync, list, delete | Implemented, not yet verified | [4](docs/DEVELOPMENT_HISTORY.md#day-4--repository-management) |
| Ingestion (shallow clone, temp workspace) and analyzer snapshot | Partially implemented | [5](docs/DEVELOPMENT_HISTORY.md#day-5--repository-ingestion), [6](docs/DEVELOPMENT_HISTORY.md#day-6--repository-analyzer) |
| LLM provider manager (OpenRouter → Groq → Gemini) | Implemented, not yet verified | [8](docs/DEVELOPMENT_HISTORY.md#day-8--llm-integration) |
| Context builder (first 30 JS/TS files ≤ 50 KB) | Partially implemented | [9](docs/DEVELOPMENT_HISTORY.md#day-9--code-analysis-engine-repository-context) |
| Bug detection agent | Implemented, not yet verified | [10](docs/DEVELOPMENT_HISTORY.md#day-10--bug-detection-agent) |
| Security agent + six-rule static scanner | Partially implemented; scanner **verified (unit)** | [11](docs/DEVELOPMENT_HISTORY.md#day-11--security-agent) |
| Test generation agent | Partially implemented (output never persisted or executed) | [12](docs/DEVELOPMENT_HISTORY.md#day-12--test-agent) |
| Deterministic risk engine | **Implemented and verified (unit)** | [13](docs/DEVELOPMENT_HISTORY.md#day-13--risk-engine) |
| Fix agent, disposable workspace, patch validation | Implemented, not yet verified | [15](docs/DEVELOPMENT_HISTORY.md#day-15--fix-agent), [16](docs/DEVELOPMENT_HISTORY.md#day-16--isolated-repair-workspace) |
| Docker test runner | Partially implemented (no command detection; no dependency installation) | [17](docs/DEVELOPMENT_HISTORY.md#day-17--test-runner) |
| Verification agent | Partially implemented (model verdict; exit code not independently enforced) | [18](docs/DEVELOPMENT_HISTORY.md#day-18--verification-agent) |
| Bounded retry (3) with re-planning | Implemented, not yet verified | [19](docs/DEVELOPMENT_HISTORY.md#day-19--re-planning-and-retries) |
| Verified-only pull request publication | Implemented, not yet verified | [20](docs/DEVELOPMENT_HISTORY.md#day-20--github-pull-request-generation) |
| End-to-end repair flow | Implemented, not yet verified (never demonstrated) | [21](docs/DEVELOPMENT_HISTORY.md#day-21--week-3-milestone) |
| BullMQ queues and two worker processes | Implemented, not yet verified | [22](docs/DEVELOPMENT_HISTORY.md#day-22--bullmq-and-background-processing) |
| GitHub webhooks | Signature **verified (unit)**; delivery not yet verified | [23](docs/DEVELOPMENT_HISTORY.md#day-23--github-webhooks) |
| Socket.IO real-time progress | Implemented, not yet verified | [24](docs/DEVELOPMENT_HISTORY.md#day-24--real-time-dashboard) |
| Repository memory (lexical hashed-vector retrieval) | Partially implemented | [25](docs/DEVELOPMENT_HISTORY.md#day-25--rag-and-repository-memory) |
| Benchmark evaluator and 5-case fixture | Evaluator **verified (unit)**; **no measured results** | [26](docs/DEVELOPMENT_HISTORY.md#day-26--benchmark-and-evaluation) |
| Rate limiting | Implemented, not yet verified (dependency declared 11 Oct; build not run) | [27](docs/DEVELOPMENT_HISTORY.md#day-27--security-and-reliability) |
| Token encryption, strict command policy, untrusted-context wrapper | Partially implemented (modules exist, not wired in) | [27](docs/DEVELOPMENT_HISTORY.md#day-27--security-and-reliability) |
| Audit logging | Planned / not implemented (table only) | [27](docs/DEVELOPMENT_HISTORY.md#day-27--security-and-reliability) |
| Docker Compose deployment | **Blocked or failing** as configured | [28](docs/DEVELOPMENT_HISTORY.md#day-28--deployment) |
| CI/CD, AWS deployment, refresh tokens | Planned / not implemented | — |
| Real screenshots, demo recording, licence file | Planned / not implemented | [29](docs/DEVELOPMENT_HISTORY.md#day-29--resume-and-github-polish), [30](docs/DEVELOPMENT_HISTORY.md#day-30--final-demo-and-interview-preparation) |

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

This is a simplified view of the single reference diagram in [Architecture](docs/ARCHITECTURE.md). It shows the implemented design, not a claim that every integration has passed a live run.

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

## Setup

These steps match the manifests and Compose file but **have not been executed**. Treat them as a starting point.

### Prerequisites

Node.js 22, npm, Git, Docker (daemon reachable by the repair worker), PostgreSQL 16, Redis 7, a GitHub OAuth app, an OpenRouter API key (required: configuration throws without it), optional Groq and Gemini keys, and a GitHub webhook secret for webhook tests.

### Configure

Copy `server/.env.example` to `server/.env` and fill in real values locally. Names and notes are in [Operations §2.2](docs/OPERATIONS_SECURITY.md#22-server-environment-variables). Points that commonly trip people up:

- `JWT_EXPIRES_IN` (digits + `s`/`m`/`h`/`d`, e.g. `12h`) sets the login-token lifetime since the third pass; an invalid or missing value falls back to `1d`.
- Redis settings are `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` (not a URL).
- Set `GITHUB_TOKEN_ENCRYPTION_KEY` (base64, 32 bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) to store GitHub tokens encrypted. Without it they are stored as plain text and a warning is logged.
- Set `TRUST_PROXY=1` when running behind a reverse proxy so rate limiting sees client IPs.
- The client reads `VITE_API_URL` (default `http://localhost:5000/api`).

### Install, migrate, run (outside Docker)

```powershell
cd server
npm install                  # runs prisma generate (postinstall)
npx prisma migrate deploy    # 16 migrations; never `migrate reset` on data you need
npm run dev                  # API + Socket.IO, default port 5000
```

In separate terminals:

```powershell
cd server; npm run worker           # scan worker
cd server; npm run repair-worker    # repair worker (needs git and Docker)
cd client; npm install; npm run dev # Vite, default http://localhost:5173
```

Note: `express-rate-limit` (`^8.7.1`) was missing from `server/package.json` and was added on 11 October 2026 (manifest and lockfile updated with `--package-lock-only`). A full `npm install` and `npm run build` have still **not** been run.

### Docker Compose

`docker-compose.yml` needs `DATABASE_URL` (an external PostgreSQL) and `REDIS_PASSWORD` in the environment or a root `.env` (template: `.env.example` in the project root), plus a filled-in `server/.env`, and publishes only the client on port 8080. The entry point, port, Redis variables, scan worker, `git` in the image and a server health check were fixed in the second audit and `docker compose config` validates, but **the images have not been built or run**. The repair worker still needs access to a Docker daemon, which Compose deliberately does not provide (mounting the host socket is root-equivalent). Details in [Operations §6](docs/OPERATIONS_SECURITY.md#6-docker-compose-reality-check). Do not run it exposed to the internet.

## Running checks

Only these were executed (11 October 2026, Node 22, scratch copy, no `npm install`); all exited 0:

```powershell
cd server
npm run test:risk-engine
npm run test:webhook-signature
npm run test:static-security
npm run test:benchmark
npm run test:security
```

Everything else (builds, lint, Prisma validation, queue, database, Docker, AI and GitHub scripts, the client) is **not run**. The full inventory and requirements are in [Testing](docs/TESTING_EVALUATION_DEMO.md). The server has no `npm test`; the client has `npm run build` and `npm run lint`.

## Security boundaries

By design: fixes are applied only in disposable workspaces; repository tests run only in Docker with no network, dropped capabilities, resource limits and a 120-second timeout; the GitHub token is passed to git through environment variables, never into the container or URLs; retries are bounded to three; `INCONCLUSIVE` stops the loop; publication requires a verified result and never force-pushes, pushes the default branch or merges; webhooks require a valid HMAC; repository text, test output and model output are treated as untrusted.

Gaps (see [Operations §3](docs/OPERATIONS_SECURITY.md#3-security-control-status)): the verification verdict still comes from an LLM, but a `VERIFIED` verdict is now downgraded unless the Docker run exited 0 without timing out; GitHub tokens are encrypted only when `GITHUB_TOKEN_ENCRYPTION_KEY` is set (legacy plaintext values remain readable until users reconnect); the strict command policy, untrusted-context wrapper and audit logging are not connected; no cross-user authorization tests exist.

## Benchmark

An evaluator, a CLI and a five-case seeded fixture exist, but **no benchmark has been run**, so there are no precision, recall or repair-rate results. `server/benchmarks/seeded-repo/run-results.example.json` is hand-written illustration. Method, gaps and the empty results table are in [Testing §6](docs/TESTING_EVALUATION_DEMO.md#6-seeded-defect-benchmark).

## Screenshots and demo

None. No screenshots, recording or demo URL exist; the images under `client/src/assets/` are Vite template assets. The demo protocol is in [Testing §8](docs/TESTING_EVALUATION_DEMO.md#8-end-to-end-demonstration-protocol-day-21-and-day-30).

## Known limitations

- Nothing has been built or run end to end; see the status banner.
- Compose images have not been built, and the repair worker has no Docker daemon in Compose (see Setup).
- Generated tests are now saved with the analysis (fixed) but are never executed.
- Test execution has no network and the clone has no `node_modules`, so repositories whose tests need installed packages will fail or be inconclusive; test commands are supplied by the caller, not detected.
- Context selection is the first 30 JS/TS files, not finding-relevant files; repository memory is lexical, rebuilt on every scan and not filtered by branch.
- At least one AI provider key is required; providers without a key are skipped (fixed).
- Static security rules are line-based heuristics, not SAST or dependency auditing.
- Fork pull requests from webhooks are intentionally ignored.
- There is no Git history in the archive, no CI configuration, and no repository licence file (`server/package.json` says ISC).

## Documentation map

1. [Architecture](docs/ARCHITECTURE.md) — single reference diagram, stack, API surface, flows, trust boundaries.
2. [Development history, Day 1–30](docs/DEVELOPMENT_HISTORY.md) — one section per day with objective, plan, actual implementation, evidence, gaps and next-day link.
3. [Operations and security](docs/OPERATIONS_SECURITY.md) — environment variables, control status table, Compose defects, blockers.
4. [Testing, evaluation and demo](docs/TESTING_EVALUATION_DEMO.md) — observed results, script inventory, benchmark method, demo protocol, release checklist.
5. [Client notes](client/README.md) — frontend specifics.
6. [Server notes](server/README.md) — backend layout, setup, API, scripts.
7. [Manual testing guide](MANUAL_TESTING_GUIDE.md)

## Roadmap

The 30-day plan is the original roadmap; what each day achieved is in the history. The next steps, in priority order, are the follow-ups in [development history §6](docs/DEVELOPMENT_HISTORY.md#6-prioritized-follow-ups-documentation-findings-not-code-changes): declare the dependency and build; fix Compose; enforce the Docker result independently of the model; wire in the security modules; persist generated tests; produce a real benchmark; record an end-to-end demo.
