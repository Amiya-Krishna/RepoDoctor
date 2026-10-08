# RepoDoctor AI — Day 16 to Day 20 Complete Documentation

This document records the implementation progression from Day 16 through Day 20. It is intended to be read together with the existing Day 1–5, Day 6–10, and Day 11–15 cumulative documentation.

## 1. Fixed Project Context

```text
Project root: F:\RepoDoctor
Server:       F:\RepoDoctor\server
Test repo:    F:\RepoDoctor\test-generation-repo
```

Backend: `TypeScript + ESM + NodeNext`

Database: `PostgreSQL + Prisma`

AI provider order:

```text
OpenRouter → Primary
Groq       → Secondary
Gemini     → Tertiary
```

Managed through `AIProviderManager`. `FallbackAIProvider` is not used.

## 2. Day 16 — Isolated Repair Workspace

Move repair work from proposal-only output into a disposable workspace. The original repository remains read-only.

```text
Original repository
      ↓
READ ONLY
      ↓
Disposable repair workspace
      ↓
Dedicated repair branch
```

Cleanup uses:

```ts
removeRepairWorkspace(workspace.rootPath)
```

`F:\RepoDoctor\test-generation-repo` remains a source/test repository and is not the direct patching workspace.

## 3. Day 17 — Safe Fix Application

The validated Fix Agent result is applied inside the isolated workspace through:

```ts
applyFixResult(repositoryPath, fixResult)
```

Flow:

```text
Fix Agent
   ↓
FixResult
   ↓
Validate proposal
   ↓
Target isolated repositoryPath
   ↓
Apply file changes
```

The AI does not receive arbitrary shell execution capability. The repair layer applies structured file changes.

## 4. Day 18 — Docker Repair Verification

Authoritative execution file:

```text
F:\RepoDoctor\server\src\execution\docker.runner.ts
```

Execution API:

```ts
runDockerTest(...)
```

The repaired repository/test harness is executed in an isolated Docker environment rather than directly on the host. Sensitive GitHub/database credentials are not passed into the container.

`DockerTestInput.environment` supports:

```text
REPO_DOCTOR_ATTEMPT
```

## 5. Day 19 — Retry, Replanning and Strict Verification

Authoritative retry file:

```text
F:\RepoDoctor\server\src\repair\retry\repair.retry.service.ts
```

Retry state:

```ts
attempts: RetryAttemptResult[]
```

Maximum attempts: `3`.

Attempt 1 uses the original finding and normal Fix Agent flow. Replanning is applied only to retry attempts after failure evidence exists.

```text
Attempt 1 → original finding
       ↓ failure
Replanning
       ↓
Attempt 2
       ↓ failure if necessary
Replanning
       ↓
Attempt 3
```

Verification is strict. Insufficient evidence produces `INCONCLUSIVE`, which is not success and must not create a Pull Request.

The real calculator behavior test uses a temporary JavaScript harness inside Docker `/tmp`.

Workspace cleanup uses:

```ts
removeRepairWorkspace(workspace.rootPath)
```

## 6. Day 20 — GitHub Pull Request Layer

A repair may be published only after strict verification succeeds:

```text
VERIFIED
   ↓
Commit repair branch
   ↓
Push repair branch
   ↓
Create GitHub Pull Request
```

The following states must not create a PR:

```text
FAILED
INCONCLUSIVE
ERROR
MAX_RETRIES_REACHED
```

The repair branch is operated from the isolated workspace. The original/default branch is not used as the repair workspace. No automatic merge is performed.

The GitHub token stays outside Docker and is not embedded in repository URLs or ordinary Git command arguments.

## 7. End-to-End Day 16–20 Flow

```text
Finding
   ↓
Fix Agent
   ↓
FixResult
   ↓
Disposable Repair Workspace
   ↓
applyFixResult(repositoryPath, fixResult)
   ↓
runDockerTest()
   ↓
Strict Verification
   ├── VERIFIED → Commit → Push → GitHub PR
   ├── FAILED → Replan → Retry (max 3)
   └── INCONCLUSIVE → Stop
```

## 8. Authoritative Paths

```text
server/src/services/
server/src/repair/retry/repair.retry.service.ts
server/src/execution/docker.runner.ts
server/src/ai/ai.provider.ts
server/src/ai/ai.provider.factory.ts
```

The folder is `services`, not `service`. The retry service is under `repair/retry`.

## 9. Persistent Architecture Rules

```text
AI:          OpenRouter → Groq → Gemini
Manager:     AIProviderManager
Database:    PostgreSQL + Prisma
Execution:   Docker-isolated
Repair:      isolated workspace only
Retry:       maximum 3 attempts
PR:          VERIFIED only; no automatic merge
```

## 10. Day 20 Completion

```text
Day 16  Isolated Repair Workspace        ✓
Day 17  Safe Fix Application              ✓
Day 18  Docker Verification                ✓
Day 19  Retry + Replanning + Verification ✓
Day 20  Verified GitHub PR Layer           ✓
```

RepoDoctor now has the core path from AI-generated fix proposal to isolated repair, Docker verification, bounded retry, and verified GitHub Pull Request publication while keeping the original repository read-only.
