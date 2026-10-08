# RepoDoctor AI — Project Status (Updated through Day 20)

**Current milestone:** Day 20 — Verified repair can be published as a GitHub Pull Request

**Project root:** `F:\RepoDoctor`

**Server:** `F:\RepoDoctor\server`

**Test repository:** `F:\RepoDoctor	est-generation-repo`

## Current Architecture Decisions

- Backend: Node.js + Express + TypeScript
- Module system: ESM + NodeNext
- Frontend: React + Vite + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Containerization: Docker
- GitHub integration: GitHub OAuth + GitHub API
- AI: API-key based provider abstraction
- AI provider order: OpenRouter -> Groq -> Gemini
- OpenRouter model: `qwen/qwen3.8-27b:free`
- AI manager: `AIProviderManager`
- Repository safety: source repositories are read-only
- Repair work: disposable isolated workspaces
- Verification: Docker-based and evidence-driven
- Retry policy: maximum 3 attempts
- PR policy: only verified repairs may be published; no automatic merge

## Day-by-Day Status

### Day 1 — Foundation
Project/backend/frontend foundation established.

### Day 2 — Authentication
Registration, login, bcrypt password hashing, JWT, protected API middleware.

### Day 3 — GitHub Connection
GitHub OAuth/API connection foundation established.

### Day 4 — PostgreSQL + Prisma
Database architecture migrated from MongoDB/Mongoose to PostgreSQL + Prisma.

### Day 5 — Docker + Safe Ingestion
Docker foundation, temporary workspace handling, and safe repository ingestion established.

### Day 6 — Repository Analyzer
Static/metadata repository analysis, project detection, file inventory, and snapshot persistence.

### Day 7 — Analysis Results/Dashboard
Repository and analysis result presentation layer.

### Day 8 — AI Provider Manager
API-key provider abstraction with OpenRouter primary, Groq secondary, Gemini tertiary. Provider switching verified.

### Day 9 — Context Builder
Repository context selection for AI analysis. Current contract requires `repositoryId`.

### Day 10 — Bug Detection Agent
Structured bug detection using `AIProviderManager`.

### Day 11 — Security Agent
Structured security findings and persistence.

### Day 12 — Test Generation Agent
Structured generated-test proposals and persistence.

### Day 13 — Risk Engine
Deterministic severity/risk scoring and persistence.

### Day 14 — Unified Analysis Pipeline
Bug detection + security analysis + test generation + risk evaluation in one pipeline.

### Day 15 — Fix Agent
Structured FixResult generation and validation. No direct source-repository modification.

### Day 16 — Isolated Repair Workspace
Repair work moved into a disposable workspace and dedicated repair branch. Source repository remains read-only.

### Day 17 — Safe Fix Application
`applyFixResult(repositoryPath, fixResult)` applies validated AI changes inside the isolated workspace.

### Day 18 — Docker Verification
`runDockerTest()` from `src/execution/docker.runner.ts` executes repair verification inside Docker.

### Day 19 — Retry/Replanning
`src/repair/retry/repair.retry.service.ts` owns bounded retry behavior. `attempts` is `RetryAttemptResult[]`. Maximum attempts are 3. Attempt 1 uses the original finding; replanning applies only to retries. Strict verification returns `INCONCLUSIVE` when evidence is insufficient. `REPO_DOCTOR_ATTEMPT` is available through `DockerTestInput.environment`.

### Day 20 — GitHub Pull Request
A verified repair can be committed to its isolated repair branch, pushed, and published as a GitHub Pull Request. No automatic merge is performed.

## Current Authoritative Paths

```text
F:\RepoDoctor\server\src\services\
F:\RepoDoctor\server\srcepairetryepair.retry.service.ts
F:\RepoDoctor\server\src\execution\docker.runner.ts
F:\RepoDoctor\server\srcii.provider.ts
F:\RepoDoctor\server\srcii.provider.factory.ts
```

The service directory is `services`, not `service`.

## Current Repair Flow

```text
Finding
  ↓
Fix Agent
  ↓
FixResult
  ↓
Isolated Repair Workspace
  ↓
applyFixResult()
  ↓
runDockerTest()
  ↓
Strict Verification
  ├── VERIFIED → Commit → Push → PR
  ├── FAILED → Replan → Retry (max 3)
  └── INCONCLUSIVE → Stop
```

## Safety Requirements

```text
[✓] Original repository is read-only
[✓] Repair changes occur in isolated workspace
[✓] Docker used for repository/test execution
[✓] GitHub token not passed into Docker
[✓] No direct push to default branch
[✓] No force-push
[✓] No automatic merge
[✓] Maximum 3 repair attempts
[✓] Retry replanning only after a failed attempt
[✓] INCONCLUSIVE is not VERIFIED
[✓] PR creation requires successful verification
```

## Day 20 Completion

RepoDoctor has progressed from repository analysis to an end-to-end verified repair path:

```text
Analyze
  → Detect
  → Propose
  → Isolate
  → Apply
  → Test in Docker
  → Verify
  → Retry if justified
  → Publish verified branch as PR
```

The default/source repository is still protected throughout the workflow.
