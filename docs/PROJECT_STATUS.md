# RepoDoctor AI — Project Status

**Current milestone:** Day 6 completed/planned implementation baseline  
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
PostgreSQL
  ↓
Dashboard
```

## Next Milestone

**Day 7:** Repository dashboard + analysis results UI.

After Day 7:
- Day 8: AI provider abstraction
- Day 9: Context builder
- Day 10: Bug Detection Agent
