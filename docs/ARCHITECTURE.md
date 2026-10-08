# RepoDoctor AI — Architecture (Updated through Day 20)

## 1. High-Level Architecture

```text
React Client
    |
    v
Express Backend (TypeScript + ESM + NodeNext)
    |
    +----------------+----------------+
    |                |                |
    v                v                v
JWT/Auth        GitHub API      Analysis/Repair API
    |                |                |
    +----------------+----------------+
                     |
                     v
              PostgreSQL + Prisma
```

The backend is TypeScript + ESM + NodeNext. The database is PostgreSQL with Prisma. Docker is used for isolated repair/test execution.

## 2. Repository Safety Architecture

The user's existing repository is always treated as read-only. RepoDoctor never applies AI-generated changes directly to the original repository.

```text
Original Repository
      |
      | read-only source
      v
Disposable Repair Workspace
      |
      v
Dedicated Repair Branch
      |
      v
AI Fix Proposal
      |
      v
applyFixResult(repositoryPath, fixResult)
      |
      v
Docker Verification
      |
      v
Strict Verification
      |
      +---- FAILED ------> Retry/Replan (bounded)
      |
      +---- INCONCLUSIVE -> STOP
      |
      +---- VERIFIED ----> Commit -> Push repair branch -> GitHub PR
```

Never: direct modification of the source checkout, direct push to the default branch, force-push, automatic merge, or host execution of untrusted repository code.

## 3. AI Provider Architecture

```text
createAIProvider()
       |
       v
AIProviderManager
       |
       +-- OpenRouter  (Primary)
       +-- Groq        (Secondary)
       +-- Gemini      (Tertiary)
```

Current OpenRouter model:

```text
qwen/qwen3.8-27b:free
```

Verified provider-switching behavior: OpenRouter upstream 429 -> Groq success. `FallbackAIProvider` is not part of the architecture.

Authoritative files:

```text
server/src/ai/ai.provider.ts
server/src/ai/ai.provider.factory.ts
```

## 4. Analysis Architecture through Day 15

```text
Repository Context
      |
      v
AIProviderManager
      |
      +-- BugDetectionAgent
      +-- SecurityAgent
      +-- TestGenerationAgent
      |
      v
Risk Engine
      |
      v
FixAgent
      |
      v
FixProposal
```

The Fix Agent remains proposal-only until the isolated repair stage.

## 5. Day 16–20 Repair Architecture

### Day 16 — Isolated Repair Workspace

The repair workflow works on a disposable workspace rather than the original repository. The workspace carries a dedicated repair branch.

### Day 17 — Safe Fix Application

The validated `FixResult` is applied through:

```ts
applyFixResult(repositoryPath, fixResult)
```

The function applies only validated changes inside the isolated workspace.

### Day 18 — Docker Verification

Docker execution is performed through:

```text
src/execution/docker.runner.ts
```

and:

```ts
runDockerTest(...)
```

Repository code is not executed directly on the host.

### Day 19 — Retry/Replanning

Retry orchestration is located at:

```text
server/src/repair/retry/repair.retry.service.ts
```

The retry state uses:

```ts
attempts: RetryAttemptResult[]
```

Maximum attempts: 3. The first attempt starts with the original finding. Replanning is applied only to retry attempts.

Docker test environment supports:

```text
REPO_DOCTOR_ATTEMPT
```

The real calculator behavior test uses a temporary JavaScript harness inside Docker `/tmp`. Insufficient evidence produces `INCONCLUSIVE`; it is not treated as success.

Workspace cleanup uses:

```ts
removeRepairWorkspace(workspace.rootPath)
```

### Day 20 — Verified GitHub Pull Request

The PR layer is reached only after strict verification succeeds. The repair branch is committed and pushed from the isolated workspace, then a GitHub Pull Request is created. No automatic merge is performed.

The GitHub token is kept outside Docker and is not placed in Git command arguments or authenticated clone URLs.

## 6. Day 20 End-to-End Architecture

```text
GitHub Repository
      |
      | read-only
      v
Analysis
      |
      v
Finding
      |
      v
FixAgent
      |
      v
FixProposal
      |
      v
Disposable Repair Workspace
      |
      v
applyFixResult()
      |
      v
runDockerTest()
      |
      v
Verification
      |
      +--> INCONCLUSIVE -> STOP
      |
      +--> FAILED -> Replan -> Retry (max 3)
      |
      +--> VERIFIED
              |
              v
          Git Commit
              |
              v
          Push repair branch
              |
              v
          GitHub Pull Request
              |
              v
          Human Review/Merge
```

## 7. Authoritative Paths

```text
server/src/services/
server/src/repair/retry/repair.retry.service.ts
server/src/execution/docker.runner.ts
server/src/ai/ai.provider.ts
server/src/ai/ai.provider.factory.ts
```

The folder is `services`, not `service`. The retry service is under `repair/retry`, not `src/retry` or `src/service`.

## 8. Current Runtime Constraints

- Backend: TypeScript + ESM + NodeNext
- Database: PostgreSQL + Prisma
- Docker: required for isolated verification
- Root: `F:\RepoDoctor`
- Server: `F:\RepoDoctor\server`
- Test repository: `F:\RepoDoctor	est-generation-repo`
- AI provider order: OpenRouter -> Groq -> Gemini
- No `FallbackAIProvider`
- Source repositories remain read-only
- Repair work occurs only in isolated workspaces
- Maximum repair attempts: 3
- PR creation only after `VERIFIED` evidence
