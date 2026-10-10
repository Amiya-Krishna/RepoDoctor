# RepoDoctor AI — Implementation Log (Updated through Day 20)

## Day 1–15 Baseline

Days 1–15 established authentication, GitHub integration, PostgreSQL + Prisma, repository ingestion, analysis, AI provider abstraction, context building, bug/security/test agents, risk scoring, unified analysis, and Fix Agent proposal generation.

## Day 16 — Isolated Repair Workspace

### Objective

Move from proposal-only repair to a disposable workspace where a proposed repair can be applied without touching the user's original repository.

### Core safety model

```text
Original repository
      |
      | read-only
      v
Disposable repair workspace
      |
      v
Dedicated repair branch
```

The workspace is temporary and is cleaned using:

```ts
removeRepairWorkspace(workspace.rootPath)
```

The test repository remains source material and is not the direct patching workspace.

## Day 17 — Applying FixResult Safely

### Objective

Turn a validated Fix Agent proposal into actual file changes inside the isolated repair workspace.

### API

```ts
applyFixResult(repositoryPath, fixResult)
```

The application layer works from the structured FixResult and applies only its validated file changes. It does not allow the AI agent to execute arbitrary shell commands.

```text
FixResult
   |
   v
Validate target files/ranges
   |
   v
Apply changes to isolated workspace
   |
   v
Prepare for Docker verification
```

## Day 18 — Docker-Based Repair Verification

### Objective

Execute the repaired repository/test harness inside Docker rather than directly on the host.

### Main execution file

```text
src/execution/docker.runner.ts
```

### Main execution API

```ts
runDockerTest(...)
```

The Docker execution layer does not receive the GitHub token or database credentials. It operates on the isolated workspace with a deliberately limited environment.

## Day 19 — Retry, Replanning and Strict Verification

### Objective

Make repair autonomous but bounded. A failed repair can be replanned and retried, but the system stops after three attempts.

### Retry service

```text
F:\RepoDoctor\server\srcepairetryepair.retry.service.ts
```

### Attempt state

```ts
attempts: RetryAttemptResult[]
```

### Policy

```text
Maximum attempts = 3
```

### First attempt

The first attempt starts with the original finding and normal Fix Agent generation. No retry/replanning context is injected into attempt 1.

### Retry attempts

Only attempt 2 and attempt 3 receive replanning context derived from previous failure evidence.

### Docker attempt metadata

`DockerTestInput.environment` supports:

```text
REPO_DOCTOR_ATTEMPT
```

### Real behavior test

`src/test-repair-retry.ts` uses a temporary JavaScript calculator harness inside Docker `/tmp`. The test validates actual calculator behavior rather than simply reporting success.

### Verification

Insufficient evidence results in:

```text
INCONCLUSIVE
```

and is not treated as a successful repair.

## Day 20 — GitHub Pull Request Layer

### Objective

Publish only a strictly verified repair as a GitHub Pull Request.

### Publishing rule

```text
VERIFIED
   |
   v
Commit repair branch
   |
   v
Push repair branch
   |
   v
Create GitHub Pull Request
```

`FAILED`, `INCONCLUSIVE`, `ERROR`, and exhausted retry states must not create a PR.

### Branch safety

The repair branch is created/used in the isolated workspace. The original source repository's working tree and default branch are not used as the repair workspace.

### GitHub token safety

The token is kept in the Node process environment used for GitHub operations. It is not sent to Docker and is not embedded in authenticated repository URLs.

### Merge safety

RepoDoctor creates a Pull Request but does not automatically merge it. Human review remains the final merge gate.

## Day 20 End State

```text
Finding
  -> Fix Agent
  -> Isolated Workspace
  -> applyFixResult()
  -> Docker Test
  -> Strict Verification
  -> Retry/Replan when appropriate (max 3)
  -> VERIFIED
  -> Commit
  -> Push repair branch
  -> GitHub Pull Request
```

## Persistent Constraints

- Backend is TypeScript + ESM + NodeNext.
- Database is PostgreSQL + Prisma.
- Docker is required for isolated repair/test execution.
- AI providers remain OpenRouter -> Groq -> Gemini through `AIProviderManager`.
- `FallbackAIProvider` is not used.
- `buildRepositoryContext()` requires `repositoryId`.
- Existing repositories remain read-only.
- Workspace cleanup uses `removeRepairWorkspace(workspace.rootPath)`.
- Retry maximum is 3 attempts.
- Replanning applies only to retry attempts.


## Day 22 — BullMQ scan queue (implemented in current working archive)

- Added a BullMQ `repository-scan` queue with bounded exponential retries and retained job history.
- Added `server/src/workers/scan.worker.ts` as a separate worker process.
- Repository scans are now queued by the API and the endpoint returns `202 Accepted` with a job ID.
- Added a job-status endpoint scoped to the authenticated user's jobs.
- Added PostgreSQL and Redis services to Compose. PostgreSQL remains the authoritative database; Redis is for queue state.
- Added progress callbacks to the unified analysis pipeline.
- **Important integration correction:** repository ingestion now calls `runAnalysisPipeline()` while the cloned repository workspace still exists. The pipeline now receives the actual `repositoryId` rather than incorrectly using `analysisId` as the context repository ID.

## Day 23 — GitHub webhooks (implemented in current working archive)

- Added `POST /api/github/webhook`.
- Captures the raw JSON request body and validates `X-Hub-Signature-256` using constant-time comparison.
- Handles `push` and selected `pull_request` actions, enqueues scans, and uses the GitHub delivery ID as a queue job ID for deduplication.
- Fork pull requests are deliberately ignored; they need a separate trust and token-permission policy.

## Day 24 — Authenticated live progress (implemented in current working archive)

- Added Socket.IO server authentication using the existing JWT.
- Added QueueEvents-to-Socket.IO event forwarding for scan progress, completion, and failure.
- Updated the repository dashboard to show scan progress and analysis status.
- Added a job-status polling endpoint as a recovery path when a client misses a live event.
- Hardened GitHub OAuth state with a signed expiring JWT bound to an HttpOnly cookie.
- Connected the existing analysis overview/history components to the dashboard and exposed findings/test proposals in the latest-analysis response.

## Validation status

The uploaded archive did not contain `node_modules`, and dependency installation could not complete in the execution environment. Therefore, TypeScript builds, Prisma integration tests, Redis/BullMQ processing, Socket.IO delivery, and the GitHub webhook round trip still need to be run in the user's environment after regenerating the package lock files with `npm install`. No passing test result is claimed here.


### Day 11 reconciliation — selected deterministic security checks

- Added `src/security/static-security-scanner.ts`.
- It supplements AI security findings with heuristic checks for hardcoded credential-like literals (evidence is redacted), dynamic `eval`/`Function`, selected command/query construction, user-controlled filesystem paths, and wildcard CORS.
- Added `src/test-static-security-scanner.ts`.
- This is a first deterministic layer, not a replacement for a dedicated SAST tool or `npm audit`; authentication/authorization analysis and dependency auditing remain incomplete.
