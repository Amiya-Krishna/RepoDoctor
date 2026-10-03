# RepoDoctor AI — Implementation Log (Updated through Day 15)

## Day 1 — Initial Foundation

### Implemented
- Root project structure
- React/Vite frontend
- Express/TypeScript backend
- Basic server configuration
- Health endpoint
- Environment files
- Initial database connectivity
- Git repository initialization

### Initial stack
- React
- Vite
- Express
- TypeScript
- MongoDB
- Mongoose

### Commit
```text
chore: initialize RepoDoctor MERN foundation
```

### Later change
MongoDB/Mongoose was subsequently replaced by PostgreSQL + Prisma.

---

## Day 2 — Authentication

### Implemented
- Registration
- bcrypt password hashing
- Login
- JWT generation
- JWT middleware
- Protected `/api/auth/me`
- Temporary React login integration

### Packages
```text
bcryptjs
jsonwebtoken
```

### Commit
```text
feat: implement JWT authentication
```

### Migration consideration
Authentication persistence must use the current Prisma/PostgreSQL User model.

---

## Day 3 — GitHub OAuth

### Implemented/planned
- GitHub OAuth application
- GitHub Client ID/Secret
- Authorization URL
- OAuth callback
- GitHub user lookup
- Repository API access

### Original implementation issue
The first version was built around MongoDB/Mongoose.

### Current requirement
GitHub connection data must now be persisted using Prisma/PostgreSQL.

Expected GitHub fields include:
```text
githubId
githubUsername
githubAccessToken
```

Use the actual current Prisma schema as the source of truth.

---

## Day 4 — PostgreSQL + Prisma Restart

### Architectural migration
The project was migrated from:

```text
MongoDB + Mongoose
```

to:

```text
PostgreSQL + Prisma
```

### Added/planned
- Prisma client
- Repository model
- Analysis model
- Repository service
- Repository routes
- Repository listing
- Docker directories

### Core relationship

```text
User
 ↓
Repository
 ↓
Analysis
```

---

## Day 5 — Docker + Safe Repository Ingestion

### Added/planned
- `docker/server/Dockerfile`
- `docker/analysis/Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- Temporary workspace service
- Repository ingestion service
- Safe `git clone`
- Default-branch-aware clone
- Repository ingestion endpoint

### Safety decisions
- `execFile` instead of shell-based `exec`
- Disposable temporary workspaces
- No direct modification of source repositories
- No direct push to source branches
- No GitHub token logging
- No GitHub token inside analysis containers
- No arbitrary repository scripts executed yet

### Required invariant

```text
Source GitHub repository = READ ONLY
```

---

## Day 6 — Repository Analyzer

### Added/planned
- Repository analyzer
- JS/TS detection
- Package manager detection
- Framework detection
- Test framework detection
- Linter detection
- TypeScript detection
- Source-file counting
- Test-file counting
- File inventory
- Dependency inventory
- Repository snapshot
- Analysis persistence in PostgreSQL
- Analysis history endpoint

### Deliberate limitation
The analyzer does not yet run:

```text
npm install
npm test
npm run build
```

against arbitrary repositories.

Those operations will be introduced only after a controlled Docker execution environment is implemented.

### Current pipeline

```text
Repository
 ↓
Temporary clone
 ↓
Static analyzer
 ↓
Snapshot
 ↓
PostgreSQL
 ↓
Cleanup
```

---

## Day 7 — Repository Dashboard + Analysis Results

### Implemented/planned
- Repository analysis results presentation
- Analysis history/results flow
- Dashboard layer connected to the existing repository-analysis data
- Separation between repository metadata and analysis findings

### Architectural purpose
Day 7 provides the UI/readout layer before AI analysis is added. It does not change the repository safety model.

---

## Day 8 — AI Provider Abstraction

### Implemented
- Provider abstraction for API-key based LLM access
- `AIProviderManager`
- `createAIProvider()`
- Provider order:
  1. OpenRouter — Primary
  2. Groq — Secondary
  3. Gemini — Tertiary
- Automatic provider switching when the current provider fails

### Current OpenRouter model
```text
qwen/qwen3.8-27b:free
```

### Verification
OpenRouter returned an upstream HTTP 429 during provider testing; `AIProviderManager` successfully continued with Groq.

### Important naming rule
Use `AIProviderManager`. Do not introduce the old `FallbackAIProvider` architecture.

---

## Day 9 — Context Builder

### Implemented
- Repository-context preparation for AI agents
- Relevant repository information is selected from the repository snapshot rather than blindly sending the entire repository
- Context is prepared for structured agent analysis

### Pipeline
```text
Repository Snapshot
      ↓
Context Builder
      ↓
AI Agent
```

---

## Day 10 — Bug Detection Agent

### Implemented
- Bug Detection Agent
- Structured bug-detection output
- AI-provider abstraction through `AIProviderManager`
- Prompt/schema/type separation for structured AI results
- Service layer for persisting analysis results

### Pipeline
```text
Repository Context
      ↓
Bug Detection Agent
      ↓
Structured Bug Findings
      ↓
PostgreSQL
```

The agent does not modify the source repository.

---

## Day 11 — Security Agent

### Implemented/planned
- Security analysis agent
- Structured security detection result
- Security findings persistence
- Separation of security findings from bug findings
- Provider abstraction reused through `AIProviderManager`

### Safety boundary
Security analysis is read-only. It does not execute repository code and does not modify the source repository.

---

## Day 12 — Test Generation Agent

### Implemented
- Test Generation Agent
- Test-generation prompt
- Structured test-generation schema/types
- Test-generation service
- Generated-test persistence service
- Prisma relation/model support for generated tests
- Test-generation agent test script

### Pipeline
```text
Repository Context
      ↓
Test Generation Agent
      ↓
Structured Generated Tests
      ↓
PostgreSQL
```

### Safety boundary
Generated tests are saved as reviewable artifacts only.

Day 12 does **not**:
- write generated tests into the user's source repository
- execute generated tests
- run arbitrary repository scripts on the host
- push changes to GitHub
- create a Pull Request

Those actions require the later isolated repair/verification architecture.

---

## Current Analysis-Agent Pipeline

```text
GitHub Repository
      ↓
Read-only Clone
      ↓
Repository Analyzer
      ↓
Repository Snapshot
      ↓
Context Builder
      ↓
AIProviderManager
      ↓
 ┌──────────────┬────────────────┬────────────────────┐
 ▼              ▼                ▼
Bug Agent   Security Agent   Test Generation Agent
 ▼              ▼                ▼
Structured   Structured       Generated Tests
Findings     Findings         / Artifacts
 └──────────────┬────────────────┘
                ▼
           PostgreSQL
```

---

## Planned Next Steps

### Day 13
Risk Engine.

### Day 14
Unified Analysis Pipeline.

### Day 15+
Autonomous repair, isolated Dockerized test execution, verification, retry/replanning, and GitHub PR generation.

### Day 22+
Redis + BullMQ.

### Day 23+
GitHub webhooks.

### Day 25+
Repository memory/RAG.

### Day 26+
Evaluation benchmark.

### Day 28+
Production Docker deployment.


---

# Day 11 — Security Analysis

### Implemented

- Security Agent integration.
- Structured security findings.
- Common AI provider abstraction.
- Finding validation.
- Security results prepared for persistence.

### Architecture

```text
Repository Context
       ↓
AIProviderManager
       ↓
SecurityAgent
       ↓
Structured SecurityFinding
```

### Safety

The agent analyzes supplied repository context only. It does not execute repository code or modify the source repository.

---

# Day 12 — Test Generation Agent

### Implemented

- Test Generation Agent.
- Structured generated-test output.
- Repository-context validation.
- Target-file validation.
- Windows path normalization.

### Important Windows Fix

Repository-relative paths are normalized from:

```text
src\calculator.ts
```

to:

```text
src/calculator.ts
```

This prevents generated test references from being rejected merely because Windows uses backslashes.

### Test

The generated test target must exist in the repository context.

---

# Day 13 — Risk & Severity Engine

### Implemented

```text
src/risk/risk.types.ts
src/risk/risk.rules.ts
src/risk/risk.calculator.ts
src/risk/risk.engine.ts
src/services/risk-assessment.service.ts
src/test-risk-engine.ts
```

### Purpose

Convert findings into deterministic risk assessments.

### Flow

```text
Severity
   +
Confidence
   +
Category
   ↓
Risk score
   ↓
Risk level
   ↓
Priority
```

### Persistence

Risk assessments are stored through the Prisma/PostgreSQL layer.

---

# Day 14 — Unified Analysis Pipeline

### Implemented

```text
src/pipeline/analysis.pipeline.ts
src/pipeline/analysis.pipeline.types.ts
src/pipeline/analysis.pipeline.errors.ts
src/test-analysis-pipeline.ts
```

### Pipeline

```text
Analysis RUNNING
       ↓
Repository Context
       ↓
BugDetectionAgent
       ↓
SecurityAgent
       ↓
TestGenerationAgent
       ↓
Persist findings/tests
       ↓
Risk Engine
       ↓
Persist risk assessments
       ↓
Analysis COMPLETED
```

### Successful Test Result

```text
Bugs: 2
Security findings: 2
Generated tests: 3
Risk score: 81
Risk level: HIGH
Priority: P1
```

### Provider Switching

OpenRouter intermittently returned structured-output failures. `AIProviderManager` correctly continued with Groq.

No provider architecture change was made.

---

# Day 15 — Fix Agent

### Implemented

```text
src/agents/fix.agent.ts
src/agents/fix.schema.ts
src/agents/fix.types.ts
src/prompts/fix.prompt.ts
src/services/fix-generation.service.ts
src/services/fix-proposal.service.ts
src/test-fix-agent.ts
```

### Fix Result Structure

```text
title
summary
changes[]
risk
confidence
reasoning
```

Each change contains:

```text
filePath
changeType
startLine
endLine
originalCode
replacementCode
explanation
```

### Safety Validation

Fix Agent validates:

- result is not empty
- title/summary exist
- confidence is between 0 and 1
- referenced files exist
- line ranges are valid
- REPLACE changes contain original code
- INSERT changes contain replacement code
- at least one change exists
- at least one change affects the finding's file

### Critical Safety Boundary

Day 15 only generates a proposal.

```text
Finding
  ↓
FixAgent
  ↓
Proposed change
  ↓
Validation
  ↓
Output
```

No repository mutation occurs.

### Successful Fix Agent Test

Observed:

```text
OpenRouter → empty structured response
Groq → succeeded
```

Generated proposal:

```text
File: src/calculator.ts
Type: REPLACE
Lines: 1-6
```

The proposed replacement added a division-by-zero guard.

### Test Fixture

The test fixture was intentionally changed to contain the bug:

```ts
export function divide(
  a: number,
  b: number
): number {
  return a / b;
}
```

Fix Agent then correctly proposed:

```ts
if (b === 0) {
  throw new Error('Division by zero');
}
return a / b;
```

The fixture remains separate from the user's existing repositories.

---

# Day 15 Implementation Notes

## Current AI factory path

Use:

```text
src/ai/ai.provider.factory.ts
```

Do not use invented paths such as:

```text
src/ai/a.factory.js
src/ai/ai.type.js
```

## Current provider abstraction

Use:

```text
src/ai/ai.provider.ts
```

and:

```text
AIProviderManager
```

## Current Context Builder Contract

Use:

```ts
const context =
  await buildRepositoryContext(
    repositoryPath,
    "fix-agent-test-repository"
  );
```

not:

```ts
const context =
  await buildRepositoryContext(
    repositoryPath
  );
```

The second argument is required by the current TypeScript function signature.

## Day 15 Completion

The Fix Agent proposal-generation stage is complete.

The remaining database issue is the unapplied `FixProposal` table in the Neon database; this must be resolved safely without resetting existing data before relying on Prisma Studio for persisted FixProposal records.
