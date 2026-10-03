# RepoDoctor AI — Project Status (Updated through Day 15)

**Current milestone:** Day 15 — Fix Agent proposal generation completed  
**Project:** RepoDoctor AI  
**Scope:** Autonomous repository analysis and repair for JavaScript/TypeScript GitHub repositories

## Current Architecture Decisions

- Backend: Node.js + Express + TypeScript
- Frontend: React + Vite + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Containerization: Docker
- GitHub integration: GitHub OAuth + GitHub API
- AI: API-key based provider abstraction; **not Ollama**
- Initial repository language scope: JavaScript/TypeScript
- Repository safety: source repositories are treated as read-only
- Automated work must happen in disposable isolated workspaces/containers
- Fixes will use dedicated repair branches
- No direct push to existing/default branches
- PR creation only after automated verification succeeds

## Day-by-Day Status

### Day 1 — MERN Foundation
Initial project structure and backend/frontend foundation were created.

Initial stack at this stage:
- React + Vite
- Express + TypeScript
- MongoDB + Mongoose
- Basic health endpoint
- Environment configuration
- Git initialization

**Status:** Completed historically; database stack was later migrated.

### Day 2 — Authentication
Implemented:
- User registration
- Password hashing with bcrypt
- Login
- JWT generation
- JWT authentication middleware
- Protected `/api/auth/me`
- Temporary React login integration

**Status:** Completed, but authentication/database code must remain aligned with the current PostgreSQL + Prisma architecture.

### Day 3 — GitHub OAuth
Implemented/planned:
- GitHub OAuth App
- GitHub client ID/secret configuration
- OAuth authorization URL
- OAuth callback
- GitHub user information retrieval
- GitHub repository API access

**Important migration note:** The original implementation used MongoDB/Mongoose. After the database migration, GitHub connection persistence must use Prisma/PostgreSQL.

### Day 4 — PostgreSQL + Prisma + Repository Management
Architecture restarted around:
- PostgreSQL
- Prisma
- Repository model
- Analysis model
- Prisma client
- Repository service
- Repository API
- Docker project structure

Repository information is persisted in PostgreSQL.

**Status:** Current architecture baseline.

### Day 5 — Docker + Safe Repository Ingestion
Implemented/planned:
- Docker server image
- Docker analysis image
- Docker Compose foundation
- Temporary workspace manager
- Safe Git clone using `execFile`
- Default-branch-aware cloning
- Repository ingestion service
- Repository ingestion endpoint
- Temporary workspace cleanup

Safety rules established:
- Never modify the source GitHub repository
- Never push to the source/default branch
- Never execute untrusted repository code directly on the host
- Never expose GitHub access tokens to analysis containers
- Never log authenticated clone URLs
- Use disposable workspaces

### Day 6 — Repository Analyzer
Implemented/planned:
- Repository analyzer
- JavaScript/TypeScript detection
- Package-manager detection
- Framework detection
- Test-framework detection
- Linter detection
- TypeScript detection
- Source-file inventory
- Test-file inventory
- Repository snapshot
- PostgreSQL/Prisma analysis persistence
- Analysis history endpoint

The analyzer is intentionally metadata/static-analysis focused. Arbitrary `npm install`, `npm test`, or repository scripts are **not** executed yet.

## Day 7 — Repository Dashboard + Analysis Results
- Analysis results/dashboard layer added to the project flow.
- Repository and analysis information is presented without changing the read-only repository model.

**Status:** Completed/planned.

## Day 8 — AI Provider Abstraction
- API-key based AI provider abstraction.
- `AIProviderManager`.
- Provider order:
  - OpenRouter — Primary
  - Groq — Secondary
  - Gemini — Tertiary
- Automatic provider switching on provider failure.
- Current OpenRouter model: `qwen/qwen3.8-27b:free`.
- Verified fallback behavior: OpenRouter HTTP 429 → Groq success.
- `createAIProvider()` creates the manager.
- Agents use the manager instead of direct provider coupling.

**Status:** Completed.

## Day 9 — Context Builder
- Repository context is prepared from the repository snapshot.
- Relevant information is selected for AI analysis instead of blindly sending the entire repository.

**Status:** Completed.

## Day 10 — Bug Detection Agent
- Bug Detection Agent added.
- Structured AI output using prompt/schema/type separation.
- Findings can be persisted through the analysis service layer.
- Agent uses `AIProviderManager`.

**Status:** Completed/planned implementation baseline.

## Day 11 — Security Agent
- Security analysis agent added/planned.
- Structured security detection result.
- Security findings persistence.
- Reuses `AIProviderManager`.
- Security analysis remains read-only.

**Status:** Completed/planned implementation baseline.

## Day 12 — Test Generation Agent
- Test Generation Agent added.
- Test-generation prompt.
- Structured schema and TypeScript types.
- Test-generation service.
- Generated-test persistence service.
- Prisma support for generated tests.
- Test-generation test script.

Generated tests are currently stored as reviewable artifacts. They are not automatically written into or executed against the user's source repository.

**Status:** Completed/planned implementation baseline.

## Current AI Pipeline

```text
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
Findings     Findings        Generated Tests
 └──────────────┬────────────────┘
                ▼
           PostgreSQL
```

## Current End-to-End Flow

```text
React
  ↓
Express API
  ↓
JWT authentication
  ↓
GitHub OAuth
  ↓
PostgreSQL + Prisma
  ↓
Repository selection
  ↓
Temporary isolated workspace
  ↓
Read-only Git clone
  ↓
Repository Analyzer
  ↓
Repository Snapshot
  ↓
Context Builder
  ↓
AIProviderManager
  ↓
Bug / Security / Test Generation Agents
  ↓
Structured Results
  ↓
PostgreSQL
  ↓
Dashboard / Analysis Results
```

## Day 12 Safety Boundary

The current system still does **not** automatically:
- modify the user's source repository
- push to `main`, `master`, or another source branch
- force-push
- merge changes
- execute generated tests against an untrusted repository
- execute arbitrary `npm install`, `npm test`, or `npm run build` on the host
- create a GitHub PR before the later verification architecture is implemented

## Next Milestone

**Day 13:** Risk Engine.

After Day 13:
- Day 14: Unified Analysis Pipeline
- Day 15+: Isolated repair, Dockerized verification, retry/replanning, and GitHub PR generation


---

# Day 11–15 Current Status

## Day 11 — Security Analysis

**Status:** Completed.

Security analysis was integrated as a structured AI agent using the common AI provider abstraction.

## Day 12 — Test Generation Agent

**Status:** Completed.

Generated tests are validated against repository context, including target-file validation.

## Day 13 — Risk & Severity Engine

**Status:** Completed.

Implemented deterministic risk calculation and persistence.

Main files:

```text
src/risk/risk.types.ts
src/risk/risk.rules.ts
src/risk/risk.calculator.ts
src/risk/risk.engine.ts
src/services/risk-assessment.service.ts
src/test-risk-engine.ts
```

## Day 14 — Unified Analysis Pipeline

**Status:** Completed and tested.

The pipeline coordinates bug detection, security detection, test generation, persistence, and risk assessment.

Observed successful test result:

```text
Bugs: 2
Security findings: 2
Generated tests: 3
Risk score: 81
Risk level: HIGH
Priority: P1
Critical findings: 0
High findings: 4
Medium findings: 0
Low findings: 0
```

Windows path normalization was added so repository paths use `/` consistently for AI-generated target paths.

## Day 15 — Fix Agent

**Status:** Completed.

Implemented:

```text
FixAgent
FixResult schema/types
Fix prompt
Fix generation service
Fix proposal service
FixProposal Prisma model
Fix Agent test
```

The Fix Agent generates proposed code changes without modifying the repository.

Successful test behavior:

```text
OpenRouter → failed with empty structured response
Groq       → succeeded
FixAgent   → generated valid REPLACE proposal
Validation → passed
Repository → unchanged
```

Example generated proposal:

```text
src/calculator.ts
REPLACE
Lines 1-6
```

The proposal added a division-by-zero guard.

## Current Database Caveat

The Prisma schema contains `FixProposal`, but the corresponding database table was not successfully applied to the Neon database during the latest migration attempt.

Observed Prisma Studio error:

```text
The table public.FixProposal does not exist in the current database.
```

Do not use `prisma migrate reset` because existing database data must be preserved.

## Current Build State

The TypeScript build was successfully made to compile after correcting the
`buildRepositoryContext` call contract.

The current signature requires:

```ts
buildRepositoryContext(
  workspacePath,
  repositoryId,
  metadata?
)
```

## Current AI Provider Architecture

```text
OpenRouter → Primary
Groq       → Secondary
Gemini     → Tertiary
```

Managed through:

```text
AIProviderManager
```

Do not introduce `FallbackAIProvider`.
