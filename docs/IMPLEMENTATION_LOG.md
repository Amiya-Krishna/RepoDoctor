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
