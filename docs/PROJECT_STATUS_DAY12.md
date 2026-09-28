# RepoDoctor AI — Project Status

**Current milestone:** Day 12 — Test Generation Agent completed/planned implementation baseline  
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
