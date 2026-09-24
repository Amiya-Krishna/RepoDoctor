# RepoDoctor AI — Implementation Log

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

## Planned Next Steps

### Day 7
Repository dashboard and analysis results UI.

### Day 8
AI provider abstraction.

### Day 9
Context builder.

### Day 10
Bug Detection Agent.

### Day 11
Security Agent.

### Day 12
Test Generation Agent.

### Day 13
Risk Engine.

### Day 14
Unified Analysis Pipeline.

### Day 15+
Autonomous repair, Dockerized test execution, verification, retry/replanning, and GitHub PR generation.

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
