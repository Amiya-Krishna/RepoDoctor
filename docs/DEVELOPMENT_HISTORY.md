# RepoDoctor AI — Development History, Day 1 to Day 30

This is the single, continuous record of the 30-day plan. Every day has its own section, in order, using the same structure. Days 21–30 continue the same system as Days 1–20; none of them starts a new project, architecture or workflow.

## 1. How to read this document

### 1.1 Evidence base and what "verified" means

This revision was produced by auditing the supplied archive (`RepoDoctor.zip`, last file timestamps 10–11 October 2026). The audit method was:

- **Static inspection** of the source, Prisma schema and migrations, Docker/Compose files, `package.json` files and the client.
- **Execution of five dependency-free scripts** in a scratch copy of the archive on 11 October 2026 (Node 22.22.0, `tsx`, no `npm install`, no Docker, no Redis, no PostgreSQL, no network). Results are in [Testing, evaluation and demo](TESTING_EVALUATION_DEMO.md).
- **No** clean install, TypeScript build, Prisma migration, queue run, Docker run, live AI call, live GitHub call or browser run was performed. The archive contains no `.git` directory, so commit history is unavailable and no commit is cited anywhere.

The only dates this document can support are the Prisma migration directory names (22 September – 10 October 2026). They are quoted as evidence of when a schema change was made, not as proof that a day's work was finished on a particular date.

### 1.2 Status labels (used identically in every document)

| Label | Meaning |
|---|---|
| **Implemented and verified** | The code exists and a check was actually run and observed to pass (named in the day section). |
| **Implemented, not yet verified** | The code exists and is wired in, but no check has been run. This is the default for most of the system. |
| **Partially implemented** | Some of the original goal exists; the day section says exactly what is missing. |
| **Planned / not implemented** | No implementation evidence in the archive. |
| **Blocked or failing** | Static inspection found a defect that would stop the feature working as configured. These are *observed in source, not reproduced by execution*. |

A file existing is never treated as proof that a feature works.

### 1.3 Corrections to the previous history

The previous version of this file was a single table and a plan for Days 25–30. Reading the source showed that it was out of date and partly wrong:

| Previous statement | What the source shows |
|---|---|
| Day 21 was "the autonomous repair loop". | Per the original plan Day 21 is the Week 3 milestone and validation point. The loop it validates is built in Days 15–20 and exposed through Days 21–22 wiring (see Day 21). |
| Day 18 was "Docker verification"; Day 17 was "Safe patch application". | The original plan has Day 17 = Test Runner (Docker runner) and Day 18 = Verification Agent. Patch application belongs with Day 16 (isolated workspace). Sections below follow the original plan. |
| Day 25 (RAG/memory) "not evidenced". | `server/src/rag/`, `server/src/services/repository-memory.service.ts`, the `RepositoryMemoryChunk` model, migration `20261010190000_repository_memory_chunks` and a call in `analysis.pipeline.ts` exist. It is **lexical hashed-vector retrieval**, not neural-embedding RAG (see Day 25). |
| Day 26 benchmark "not evidenced". | An evaluator, a CLI and a 5-case seeded fixture exist. **No measured results exist** (see Day 26). |
| Day 27: token encryption, rate limiting, audit logging "gaps". | Token encryption module, rate-limit middleware, a command policy, an untrusted-context helper and an audit-event table all exist, but several are **not wired in** (see Day 27). |
| Day 28: Compose "has hard-coded credentials and publishes DB/cache ports". | The current `docker-compose.yml` requires `POSTGRES_PASSWORD` and `REDIS_PASSWORD`, publishes no database/cache ports and uses an internal network. It has *other* defects (see Day 28). |
| Days 1–24 "present". | Several days carry caveats not previously recorded, e.g. generated tests are never persisted by the pipeline (Day 12) and `express-rate-limit` was imported but not declared in `package.json` (Day 27; declared on 11 October 2026). |

### 1.4 Summary table

| Day | Title | Status |
|---:|---|---|
| 1 | Architecture and repository setup | Implemented, not yet verified |
| 2 | Authentication | Partially implemented |
| 3 | GitHub OAuth | Partially implemented |
| 4 | Repository management | Implemented, not yet verified |
| 5 | Repository ingestion | Partially implemented |
| 6 | Repository Analyzer | Partially implemented |
| 7 | Week 1 milestone | Implemented, not yet verified |
| 8 | LLM integration | Implemented, not yet verified |
| 9 | Code analysis engine (context) | Partially implemented |
| 10 | Bug Detection Agent | Implemented, not yet verified |
| 11 | Security Agent | Partially implemented (static scanner verified) |
| 12 | Test Agent | Partially implemented |
| 13 | Risk Engine | Implemented and verified (unit level) |
| 14 | Week 2 milestone | Partially implemented |
| 15 | Fix Agent | Implemented, not yet verified |
| 16 | Isolated repair workspace | Implemented, not yet verified |
| 17 | Test Runner | Partially implemented |
| 18 | Verification Agent | Partially implemented |
| 19 | Re-planning and retries | Implemented, not yet verified |
| 20 | GitHub pull request generation | Implemented, not yet verified |
| 21 | Week 3 milestone | Implemented, not yet verified (no end-to-end run) |
| 22 | BullMQ and background processing | Implemented, not yet verified |
| 23 | GitHub webhooks | Implemented (signature verified), rest not yet verified |
| 24 | Real-time dashboard | Implemented, not yet verified |
| 25 | RAG and repository memory | Partially implemented |
| 26 | Benchmark and evaluation | Partially implemented (no measured results) |
| 27 | Security and reliability | Partially implemented |
| 28 | Deployment | Blocked or failing (as configured) |
| 29 | Resume and GitHub polish | Partially implemented |
| 30 | Final demo and interview preparation | Planned / not implemented (not validated) |

### 1.5 Architecture facts that stay constant across all 30 days

- Database is **PostgreSQL through Prisma** (`server/prisma/schema.prisma`, 16 migrations). The original roadmap diagram mentioned MongoDB; MongoDB is not used. RepoDoctor is **not** a MERN application.
- Backend is TypeScript, Express 5, ESM/NodeNext. Relative imports use `.js` suffixes.
- AI access goes through `AIProviderManager` built by `createAIProvider()` in `server/src/ai/ai.provider.factory.ts`; order OpenRouter → Groq → Gemini.
- Background work uses BullMQ on Redis: queues `repository-scan` and `autonomous-repair`, workers `server/src/workers/scan.worker.ts` and `server/src/workers/repair.worker.ts`.
- Test execution uses `runDockerTest()` in `server/src/execution/docker.runner.ts`.
- Retry loop: `runRepairRetryLoop()` in `server/src/repair/retry/repair.retry.service.ts`, maximum three attempts.
- Pull requests are created only through `publishVerifiedRepairWithCleanup()` in `server/src/services/pull-request.service.ts`. RepoDoctor never merges.

### 1.6 One flow, used by every day

```text
GitHub integration → Repository ingestion → Repository context → Analysis
  → Repair proposal → Isolated execution → Verification
  → Retry or stop → Pull request only if verified
```

---

## 2. Week 1 — Foundation and GitHub integration (Days 1–7)

### Day 1 — Architecture and repository setup

- **Objective:** a working local development environment with the repository layout, TypeScript on both sides, a database, Redis, linting and environment configuration.
- **Context:** first day; nothing precedes it.
- **Planned work:** Git/GitHub repository; React + TypeScript; Node/Express + TypeScript; database and Redis; lint/format; environment variables.
- **Actual implementation:** `client/` (React 19, Vite, TypeScript, ESLint flat config) and `server/` (Express 5, TypeScript, `tsx` for development, `tsc` for build). PostgreSQL through Prisma replaced the MongoDB shown in the original diagram. Redis arrives through BullMQ and `docker-compose.yml`. `.env.example` files exist in `server/` and `client/`. No Prettier configuration and no ESLint configuration exist for `server/`; only the client has `npm run lint`.
- **Files and components:** `client/package.json`, `client/vite.config.ts`, `client/eslint.config.js`, `server/package.json`, `server/tsconfig.json`, `server/.env.example`, `client/.env.example`, `.gitignore`, `.dockerignore`, `docker-compose.yml`.
- **Technical workflow:** client (Vite dev server, default `http://localhost:5173`) calls the API at `VITE_API_URL` (default `http://localhost:5000/api`); the API reads `PORT` (default 5000) and `DATABASE_URL`.
- **Validation:** none run. A clean `npm install`, `npm run build` (server and client) and `npm run lint` (client) have not been executed. The root `.gitignore` excludes `.env*` except `.env.example`.
- **Result:** Implemented, not yet verified.
- **Known gaps:** no server lint/format tooling; no Git history in the archive; no CI workflow files exist (Day 29 and Day 30 depend on this).
- **Connection to Day 2:** a running API and database make user accounts the first feature.

### Day 2 — Authentication

- **Objective:** registered users can log in and reach protected routes.
- **Context:** builds on the Day 1 API, `users` table and `JWT_SECRET` setting.
- **Planned work:** registration, login, JWT, protected routes, password hashing, refresh tokens "if feasible", user storage.
- **Actual implementation:** `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`. Passwords hashed with `bcryptjs` (cost 10); 8–128 character password rule and e-mail normalization in the controller. JWT payload `{ userId }`, expiry hard-coded to `1d` in `auth.service.ts`. `protect` middleware reads `Authorization: Bearer`. The `JWT_EXPIRES_IN` entry in `.env.example` is **not read by any source file**. The client stores the token in `localStorage`.
- **Files and components:** `server/src/routes/auth.routes.ts`, `controllers/auth.controller.ts`, `services/auth.service.ts`, `middleware/auth.middleware.ts`, `prisma/migrations/20260922000000_init`, `client/src/App.tsx`, `client/src/lib/auth.ts`.
- **Technical workflow:** client posts credentials → controller validates → bcrypt → Prisma `user` row → JWT returned → client sends it on later calls.
- **Validation:** none run (no auth test script exists).
- **Result:** Partially implemented — everything except refresh tokens.
- **Known gaps:** no refresh-token strategy; token lifetime not configurable; `localStorage` token storage is exposed to XSS; the server `protect` middleware logs the full error object on failure.
- **Connection to Day 3:** an authenticated user identity is needed before attaching a GitHub account.

### Day 3 — GitHub OAuth

- **Objective:** let an authenticated user connect a GitHub account.
- **Context:** uses the Day 2 `protect` middleware and `userId` claim.
- **Planned work:** OAuth flow, secure token handling, storage of GitHub connection information.
- **Actual implementation:** `GET /api/github/connect` returns an authorization URL whose `state` is a signed JWT (`purpose: github_oauth`, 10-minute expiry, nonce) that is also set in an HttpOnly, `SameSite=lax` cookie scoped to `/api/github/callback`. `GET /api/github/callback` requires cookie and query state to match, verifies the JWT, exchanges the code, loads the GitHub user and updates `users.githubId`, `githubUsername` and `githubAccessToken`. Requested scopes: `repo read:user user:email`.
- **Files and components:** `server/src/controllers/github.controller.ts`, `services/github.service.ts`, `routes/github.routes.ts`.
- **Technical workflow:** client calls `/github/connect` → redirects browser to GitHub → GitHub redirects to `GITHUB_CALLBACK_URL` → API stores the token → redirects to `FRONTEND_URL`.
- **Validation:** none run; needs real GitHub OAuth credentials.
- **Result:** Partially implemented.
- **Known gaps:** the access token is stored **in plain text** in `users.githubAccessToken`. `server/src/security/token-encryption.ts` (AES-256-GCM) exists but is not imported by the controller or by any reader (see Day 27). The `repo` scope is broad.
- **Connection to Day 4:** a stored token lets the API list the user's repositories.

### Day 4 — Repository management

- **Objective:** show and manage the user's GitHub repositories and their scan status.
- **Context:** consumes the Day 3 token and `Repository` model.
- **Planned work:** retrieve repositories; add, list, remove projects; show repository information and scan status.
- **Actual implementation:** `GET /api/github/repositories` fetches repositories from GitHub and upserts every one into `Repository` (there is no selective "add"). `GET /api/repositories`, `GET /api/repositories/:repositoryId`, `DELETE /api/repositories/:repositoryId` (404 if not owned; 409 if repair records still reference it because `RepairJob` uses a restrictive relation). Every query filters by the authenticated `userId`. Client page `Repositories.tsx` lists, scans and deletes.
- **Files and components:** `controllers/repository.controller.ts`, `services/repository.service.ts`, `routes/repository.routes.ts`, migration `20260924081326_add_repository_analysis`, `client/src/pages/Repositories.tsx`.
- **Technical workflow:** sync → upsert by unique `githubId` → list → delete.
- **Validation:** none run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** `Repository.githubId` is globally unique, so one GitHub repository can belong to only one RepoDoctor user; no pagination of GitHub results was checked.
- **Connection to Day 5:** a chosen repository can now be fetched and read.

### Day 5 — Repository ingestion

- **Objective:** obtain a repository's source for analysis without sending everything to the model.
- **Context:** uses the repository row and token from Days 3–4.
- **Planned work:** metadata, relevant branches and files, `package.json`/README/source inspection, structured representation, no indiscriminate LLM input.
- **Actual implementation:** `ingestRepository()` creates a temporary workspace under `os.tmpdir()/repodoctor/<uuid>`, runs `git clone --depth 1 --branch <ref> -- <cloneUrl>`, passes the token through git's environment (`http.https://github.com/.extraheader`) rather than the URL, runs analysis, and removes the workspace in a `finally` block. Only one branch (the requested `ref`) is cloned.
- **Files and components:** `server/src/services/ingestion.service.ts`, `services/workspace.service.ts`, `controllers/ingestion.controller.ts`.
- **Technical workflow:** called by the scan worker (Day 22); clone → `analyzeRepository` (Day 6) → `saveAnalysis` → `runAnalysisPipeline` (Day 14) → cleanup.
- **Validation:** none run.
- **Result:** Partially implemented.
- **Known gaps:** no multi-branch retrieval; no explicit README extraction (README can enter memory indexing on Day 25); the git subprocess inherits the full `process.env` (not only the git variables).
- **Connection to Day 6:** the cloned tree is what the analyzer inspects.

### Day 6 — Repository Analyzer

- **Objective:** produce structured metadata about a repository.
- **Context:** runs on the Day 5 workspace.
- **Planned work:** languages/frameworks, dependencies, structure, important files, API routes, test files, entry points.
- **Actual implementation:** `analyzeRepository()` walks the tree (ignoring `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`) and returns `projectType`, `language`, `packageManager`, `framework` (next/express/vite detection from dependencies), `testFramework`, `linter`, `hasTypeScript`, source/test file counts, file list, dependencies and devDependencies. Stored in the `Analysis` row and its `snapshot` JSON.
- **Files and components:** `server/src/analyzers/repository.analyzer.ts`, `services/analysis.service.ts`, migration `20260925080134_add_repository_snapshot`.
- **Technical workflow:** workspace path → snapshot object → `saveAnalysis` (status `COMPLETED` at this point) → pipeline.
- **Validation:** none run.
- **Result:** Partially implemented.
- **Known gaps:** no detection of API routes or entry points; `markAnalysisCompleted` in the pipeline later writes `projectType`, `language`, `framework` and `packageManager` from the context object, which `buildRepositoryContext` receives without metadata, so those four columns can be overwritten with `null` after the analyzer set them. (Observed in source only.) `saveAnalysis` marks the analysis `COMPLETED` before the pipeline starts.
- **Connection to Day 7:** snapshot data is what the dashboard shows.

### Day 7 — Week 1 milestone

- **Objective:** a user can log in, connect GitHub, select a repository, ingest and analyze it, and see results in the dashboard.
- **Context:** integrates Days 1–6.
- **Planned work:** the milestone itself; verify which parts work.
- **Actual implementation:** the client (`App.tsx`, `Repositories.tsx`, `RepositoryAnalysis.tsx`, `AnalysisHistory.tsx`) covers register/login, "Connect GitHub", repository list, scan trigger, latest analysis and history. All scanning goes through the Day 22 queue, so the Week 1 path now needs Redis and a running scan worker.
- **Files and components:** `client/src/pages/*`, `client/src/services/repository.service.ts`, `client/src/types/repository.ts`, `GET /api/repositories/:id/analysis/latest`, `GET /api/repositories/:id/analyses`.
- **Technical workflow:** login → connect → sync → `POST /api/repositories/ingest` (202 + job id) → worker → analysis rows → dashboard.
- **Validation:** milestone not demonstrated. No browser, OAuth, queue or database run was performed.
- **Result:** Implemented, not yet verified.
- **Known gaps:** see Days 2–6; the client has no router, minimal styling and no accessibility review.
- **Connection to Day 8:** a stored repository snapshot is the input the AI layer will reason over.

---

## 3. Week 2 — AI intelligence layer (Days 8–14)

### Day 8 — LLM integration

- **Objective:** call language models through an abstraction, with structured output.
- **Context:** consumes repository data from Week 1; introduces the first external AI dependency.
- **Planned work:** provider abstraction, structured outputs, avoid single-provider coupling.
- **Actual implementation:** `AIProvider` interface (`generate`, `generateStructured`) with `OpenRouterProvider`, `GroqProvider`, `GeminiProvider`. `AIProviderManager` tries providers in order and throws `All AI providers failed` if none succeeds. Models come from environment variables with defaults in `ai.config.ts`.
- **Files and components:** `server/src/ai/ai.provider.ts`, `ai.provider.manager.ts`, `ai.provider.factory.ts`, `ai.config.ts`, `openrouter.provider.ts`, `groq.provider.ts`, `gemini.provider.ts`, `services/ai.service.ts`.
- **Technical workflow:** agents call `createAIProvider()` and pass a system prompt, a user prompt and a JSON schema.
- **Validation:** live scripts `test:ai`, `test:openrouter`, `test:groq`, `test:gemini` exist and need API keys; none was run. A single OpenRouter 429 → Groq fallback was reported in earlier notes but is not reproduced here.
- **Result:** Implemented, not yet verified.
- **Known gaps:** `ai.config.ts` throws at import time when `OPENROUTER_API_KEY` is empty, so Groq/Gemini cannot act as fallbacks without an OpenRouter key; no per-provider timeout/backoff beyond what each SDK does.
- **Connection to Day 9:** the model needs bounded, relevant code context.

### Day 9 — Code analysis engine (repository context)

- **Objective:** build prompt context from the repository.
- **Context:** feeds Day 8 providers.
- **Planned work:** target file, related files, dependencies, tests; avoid oversized prompts.
- **Actual implementation:** `buildRepositoryContext(workspacePath, repositoryId, metadata?)` collects `.js/.jsx/.ts/.tsx` files, skipping ignored directories, files over 50 KB, and stopping at 30 files. `formatRepositoryContext` renders them for the prompt. Selection is by traversal order, not by relevance to a finding.
- **Files and components:** `server/src/context/context.builder.ts`, `context.filters.ts`, `context.formatter.ts`, `context.types.ts`.
- **Technical workflow:** workspace path + `repositoryId` → `RepositoryContext` → formatted string → agent prompt. The signature requires the real repository id.
- **Validation:** `test:context` needs a path argument; not run.
- **Result:** Partially implemented.
- **Known gaps:** no dependency graph, related-file or test-file selection; `package.json` and config files are not included (`importantFiles` is defined but only source extensions pass the filter); the 500,000-character `limitContextSize` helper and the `importantFiles` set are defined in `context.builder.ts` but referenced nowhere else in the source (confirmed by search).
- **Connection to Day 10:** the first consumer is bug detection.

### Day 10 — Bug Detection Agent

- **Objective:** structured bug findings for JavaScript/TypeScript.
- **Context:** receives the Day 9 context through the Day 8 provider.
- **Planned work:** supported defect classes; severity, file, line, explanation, confidence.
- **Actual implementation:** `BugDetectionAgent.detect(context, formattedContext)` returns findings with `title`, `description`, `category` (`LOGIC`, `RUNTIME`, `TYPE`, `ASYNC`, `SECURITY`, `PERFORMANCE`, `OTHER`), `severity` (`LOW`–`CRITICAL`), `filePath`, `lineStart`, `lineEnd`, `evidence`, `suggestedFix`, `confidence`. Findings are validated and saved to `BugFinding`.
- **Files and components:** `agents/bug-detection.agent.ts`, `.schema.ts`, `.types.ts`, `prompts/bug-detection.prompt.ts`, `services/bug-finding.service.ts`, migration `20260928112727_add_bug_finding`.
- **Technical workflow:** pipeline stage 3 → provider → validation → persistence.
- **Validation:** `test:bug-agent` needs live AI; not run. Precision and false-positive rate are unmeasured.
- **Result:** Implemented, not yet verified.
- **Known gaps:** the fixture repositories (`bug-test-repo/`) are local and git-ignored; no measured accuracy.
- **Connection to Day 11:** security issues are a parallel, stricter class of finding.

### Day 11 — Security Agent

- **Objective:** report selected security issue classes.
- **Context:** same inputs as Day 10.
- **Planned work:** secrets, auth flaws, `eval`, injection, unsafe dependencies; combine AI with deterministic checks.
- **Actual implementation:** `SecurityAgent.detect` merges AI findings with `scanStaticSecurity()` (six regex rules: hard-coded secret, dynamic `exec`, `eval`/`new Function`, SQL string building, request-derived file path, wildcard CORS), de-duplicated by `file:line:category`. Secret evidence is redacted. Categories include `SECRET_EXPOSURE`, `INJECTION`, `AUTHENTICATION`, `AUTHORIZATION`, `CRYPTOGRAPHY`, `INPUT_VALIDATION`, `PATH_TRAVERSAL`, `SSRF`, `COMMAND_EXECUTION`, `DATA_EXPOSURE`, `INSECURE_CONFIGURATION`, `DEPENDENCY`. Saved to `SecurityFinding`.
- **Files and components:** `agents/security.agent.ts`, `security/static-security-scanner.ts`, `prompts/security.prompt.ts`, `services/security-finding.service.ts`, migration `20260928152835_add_security_findings`.
- **Technical workflow:** pipeline stage 4.
- **Validation:** `npm run test:static-security` was run on 11 October 2026 in a scratch copy and printed `Static security scanner tests passed.` The AI part (`test:security-agent`) was not run.
- **Result:** Partially implemented; the deterministic scanner is Implemented and verified at unit level.
- **Known gaps:** no dependency vulnerability audit despite the `DEPENDENCY` category; regex rules are line-based heuristics, not SAST; an LLM is not a complete scanner.
- **Connection to Day 12:** findings suggest where tests should probe.

### Day 12 — Test Agent

- **Objective:** propose candidate tests.
- **Context:** same context; runs after bug and security stages.
- **Planned work:** tests from the target function, dependencies and existing tests; normal, boundary, invalid inputs; verify generated tests are executed.
- **Actual implementation:** `TestGenerationAgent.generate` returns proposals (`title`, `type`, `filePath`, `targetFunction`, `testCode`, `rationale`, `confidence`). A `GeneratedTest` model, migration (`20260928162818_add_generated_tests`) and `saveGeneratedTests` exist. **The pipeline imports `saveGeneratedTests` but never calls it**, so generated tests are returned in the pipeline result and never stored; `GET .../analysis/latest` includes `generatedTests`, which therefore stays empty for pipeline-created analyses. Generated tests are never executed.
- **Files and components:** `agents/test-generation.agent.ts`, `.schema.ts`, `.types.ts`, `prompts/test-generation.prompt.ts`, `services/generated-test.service.ts`, `test-generation-repo/` (local fixture).
- **Technical workflow:** pipeline stage 5 → result held in memory only.
- **Validation:** `test:test-generation` needs live AI; not run.
- **Result:** Partially implemented.
- **Known gaps:** persistence not wired; no execution of generated tests; dependency installation is not available to the Docker runner (Day 17).
- **Connection to Day 13:** findings, not tests, drive prioritization.

### Day 13 — Risk Engine

- **Objective:** prioritize findings with a defensible, deterministic score.
- **Context:** consumes saved bug and security findings.
- **Planned work:** factors such as severity, confidence, affected files, dependency impact, security implications, coverage; document the real method.
- **Actual implementation:** `calculateRisk` computes `(severityScore + categoryBonus) × (0.7 + 0.3 × confidence)` capped at 100, where severity scores are LOW 20, MEDIUM 45, HIGH 70, CRITICAL 95, with fixed per-category bonuses (`risk.rules.ts`). Levels: ≥85 CRITICAL, ≥65 HIGH, ≥35 MEDIUM, else LOW; priorities P0–P3. Repository score is the mean of the top five finding scores; repository level/priority come from the single highest finding. Saved to `RiskAssessment`.
- **Files and components:** `server/src/risk/risk.calculator.ts`, `risk.engine.ts`, `risk.rules.ts`, `risk.types.ts`, `services/risk-assessment.service.ts`, migration `20260928203613_add_risk_assessments`.
- **Technical workflow:** pipeline stages 6–8.
- **Validation:** `npm run test:risk-engine` was run on 11 October 2026 (scratch copy) and exited 0; its fixture printed overall score 73, level CRITICAL, priority P0 for three findings. The script prints results and does not assert on them.
- **Result:** Implemented and verified (unit level, deterministic output only).
- **Known gaps:** only severity, category and confidence are used. `filePath` is passed in but unused; there is no dependency impact, affected-file count or coverage factor. The weights are chosen constants and are uncalibrated against any dataset.
- **Connection to Day 14:** the risk step completes the analysis workflow.

### Day 14 — Week 2 milestone

- **Objective:** repository → context → bug → security → test → risk → dashboard.
- **Context:** integrates Days 8–13.
- **Planned work:** verify and distinguish intended from working components.
- **Actual implementation:** `runAnalysisPipeline()` runs context building, memory indexing and retrieval (Day 25), bug, security and test agents, risk evaluation and persistence, updating `Analysis.status` (`RUNNING` → `COMPLETED`/`FAILED`) and emitting progress callbacks. The dashboard reads bug findings, security findings and risk assessments.
- **Files and components:** `server/src/pipeline/analysis.pipeline.ts`, `analysis.pipeline.errors.ts`, `analysis.pipeline.types.ts`, `controllers/analysis.controller.ts`, `client/src/pages/RepositoryAnalysis.tsx`.
- **Technical workflow:** see Day 5 for how the pipeline is reached.
- **Validation:** `test:analysis-pipeline` needs a database and AI keys; not run.
- **Result:** Partially implemented — everything runs in source except test persistence (Day 12); end-to-end behaviour unverified.
- **Known gaps:** Day 6 metadata overwrite; no per-stage retry; one failing stage fails the whole analysis.
- **Connection to Day 15:** persisted findings are the input to repair.

---

## 4. Week 3 — Autonomous repair (Days 15–21)

### Day 15 — Fix Agent

- **Objective:** turn a finding into a structured patch proposal.
- **Context:** consumes a saved finding and repository context.
- **Planned work:** patches from bug reports and context; store proposals; never edit the user's repository.
- **Actual implementation:** `FixAgent.generateFix(finding, context, formattedContext)` returns a `FixResult` with `changes[]` (`filePath`, `startLine`, `endLine`, `changeType` of `REPLACE`/`DELETE`/`INSERT`, `originalCode`, `replacementCode`), `risk`, `confidence`, `reasoning`. Proposals are stored in `FixProposal` with status `PROPOSED`.
- **Files and components:** `agents/fix.agent.ts`, `fix.schema.ts`, `fix.types.ts`, `prompts/fix.prompt.ts`, `services/fix-proposal.service.ts`, `services/fix-generation.service.ts`, migration `20261003091709_add_fix_proposals`.
- **Technical workflow:** called inside every repair attempt (Day 19).
- **Validation:** `test:fix-agent` needs live AI; not run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** the Fix Agent receives the same first-30-files context as Day 9, not the Day 25 retrieved memory.
- **Connection to Day 16:** a proposal must be applied somewhere safe.

### Day 16 — Isolated repair workspace

- **Objective:** apply patches without touching the source checkout.
- **Context:** follows Day 15 proposals.
- **Planned work:** isolated workspace, branch, patch application, protect the original.
- **Actual implementation:** `createRepairWorkspace` runs `git clone --no-local <source> <tmp>/repair-<uuid>/repository` and checks out `repodoctor/repair/<analysisId>/<findingId-attempt-N>` (sanitized). `applyFixResult(repositoryPath, fixResult)` rejects absolute paths, `..` traversal and escapes from the workspace, validates line ranges, checks `originalCode` for `REPLACE`, and applies edits bottom-to-top. `removeRepairWorkspace` deletes the tree. The "source" is itself a fresh shallow clone made by the repair worker, not the user's working copy.
- **Files and components:** `server/src/repair/repair.workspace.ts`, `repair.patch.ts`, `repair.branch.ts`, `repair.types.ts`.
- **Technical workflow:** one new workspace per attempt, removed in a `finally`.
- **Validation:** `test:repair-workspace` requires a git repository path argument; not run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** symlinks inside the repository are not explicitly rejected in the patch code; no patch-size or file-count limit; no destructive-operation test exists.
- **Connection to Day 17:** the patched tree must be tested.

### Day 17 — Test Runner

- **Objective:** execute the repository's checks and record the evidence.
- **Context:** runs in the Day 16 workspace.
- **Planned work:** detect test/build/lint commands; capture exit code, stdout, stderr, duration; record results.
- **Actual implementation:** `runDockerTest()` runs `docker run --rm` on image `node:22-bookworm-slim` with `--network none`, `--memory 512m`, `--cpus 1`, `--pids-limit 128`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `noexec` tmpfs mounts, and the workspace bind-mounted read-write. It enforces a 120 s timeout, truncates output at 1,000,000 characters and force-removes the container afterwards. Only `REPO_DOCTOR_ATTEMPT` is passed as environment. Results are saved to `DockerTestRun`. **Commands are not detected**: the caller supplies an argument array; the API requires its first element to be `node`, `npm`, `npx`, `pnpm` or `yarn`, and the client defaults to `npm test`.
- **Files and components:** `server/src/execution/docker.runner.ts`, `docker.types.ts`, `services/docker-test-result.service.ts`, `services/test-runner.service.ts`, migration `20261005134824_add_retry_execution_tracking`.
- **Technical workflow:** attempt → `runDockerTest` → persisted run → verification.
- **Validation:** `test:docker-runner` needs Docker; not run.
- **Result:** Partially implemented.
- **Known gaps:** no command detection; no `--user` flag, so the container runs as the image's default user; no network means dependencies cannot be installed and the workspace has no `node_modules` (clones exclude them), so most real repositories' tests cannot run; Docker is not a complete sandbox on its own.
- **Connection to Day 18:** raw test evidence needs an explicit verdict.

### Day 18 — Verification Agent

- **Objective:** decide whether a fix is supported by the evidence.
- **Context:** receives the finding, the proposed fix and the Day 17 result.
- **Planned work:** success/failure/inconclusive distinction; block unverified repairs from being published.
- **Actual implementation:** `VerificationAgent.verify` asks the model for `status` (`VERIFIED`, `FAILED`, `INCONCLUSIVE`, `ERROR`), `testPassed`, `regressionDetected`, `confidence`, `evidence[]`, `reasoning`, and validates the result's shape (for example `VERIFIED` requires `testPassed=true`). Results are stored in `VerificationResult`. The PR publisher adds its own gate: status `VERIFIED`, `testPassed`, no regression, confidence ≥ 0.7.
- **Files and components:** `agents/verification.agent.ts`, `.schema.ts`, `.types.ts`, `prompts/verification.prompt.ts`, `services/verification.service.ts`, `services/verification-result.service.ts`, migration `20261004182527_add_verification_results`.
- **Technical workflow:** `verifyFix()` after each Docker run.
- **Validation:** `test:verification-agent` needs live AI; not run.
- **Result:** Partially implemented.
- **Known gaps:** the verdict is produced by an LLM; no code path independently requires `DockerTestResult.success === true` before `VERIFIED` is accepted. A model that returns `VERIFIED` with `testPassed=true` on a failing run would pass the gate. This is the most important safety gap in the repair loop and should be closed in code (not changed by this documentation task).
- **Connection to Day 19:** failures should feed another attempt.

### Day 19 — Re-planning and retries

- **Objective:** retry with failure evidence, within a bound.
- **Context:** wraps Days 15–18.
- **Planned work:** feed failures back; revised candidate; maximum three attempts.
- **Actual implementation:** `runRepairRetryLoop` loops `DEFAULT_RETRY_POLICY.maxAttempts = 3`. Each attempt gets a new workspace, calls the Fix Agent, saves the proposal, applies it, runs Docker, saves the run, verifies, and persists a `RepairAttempt`. Outcomes: `VERIFIED` → stop (and publish if a publisher was supplied); `INCONCLUSIVE` → stop, no retry; verification `FAILED`/`ERROR` → record and retry; thrown exception → status `ERROR` and stop; third failure → `MAX_RETRIES_REACHED`. Re-planning text (`buildReplanningContext`) contains the previous Docker result and previous verification JSON. `RepairJob` and `RepairJobAttempt` store job-level history.
- **Files and components:** `repair/retry/repair.retry.service.ts`, `retry.policy.ts`, `retry.replanner.ts`, `retry.types.ts`, `services/repair-attempt.service.ts`, `repair-job.service.ts`, `repair-job-history.service.ts`, `repair-job-metrics.service.ts`, migrations `20261005134824`, `20261008101704_add_repair_job_tracking`, `20261009153413_add_repair_job_attempt_history`.
- **Technical workflow:** see Day 20 for publication and Day 22 for queueing. The queue sets `attempts: 1` so the loop is never repeated by BullMQ.
- **Validation:** `test:repair-retry`, `test:repair-job-history`, `test:repair-job-pagination`, `test:repair-job-metrics` exist; none was run (database, Docker and/or AI required).
- **Result:** Implemented, not yet verified.
- **Known gaps:** the re-planning prompt does not include the previous *patch*, only the previous evidence; a thrown error on any attempt ends the job rather than retrying; `RepairJobAttempt.durationMs` is supported by `saveRepairAttempt` but `runAutonomousRepair` never supplies it, so it stays empty.
- **Connection to Day 20:** a verified result is the only thing allowed to leave the machine.

### Day 20 — GitHub pull request generation

- **Objective:** publish a verified repair as a pull request.
- **Context:** the terminal step of the Day 19 loop.
- **Planned work:** branch, commit, push, PR with explanation and real verification results; never publish unverified work.
- **Actual implementation:** `publishVerifiedRepair` requires `VERIFIED` + `testPassed` + no regression + confidence ≥ 0.7, confirms the current branch is the repair branch and not the base, requires a non-empty working tree, points `origin` at `https://github.com/<owner>/<repo>.git`, commits as "RepoDoctor AI", pushes `--set-upstream` with the token supplied through git's environment, and opens a non-draft PR with a body from `buildRepairPullRequestBody`. The result is saved to `PullRequest`. There is no force-push and no merge call.
- **Files and components:** `services/pull-request.service.ts`, `services/pull-request-result.service.ts`, `github/github.pr.service.ts`, `github.pr-body.ts`, `github.client.ts`, `github.types.ts`, migration `20261007135109_add_pull_request_tracking`.
- **Technical workflow:** called from the retry loop's `onVerified` callback before the workspace is deleted.
- **Validation:** `test:github-pr` needs real GitHub credentials; not run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** the commit message is fixed (`fix: apply verified RepoDoctor repair`); PR body text comes from the LLM verification output; no PR de-duplication: the branch name is deterministic per analysis, finding and attempt, so repairing the same finding twice would likely be rejected by GitHub as a non-fast-forward push (inferred from the code, not tested).
- **Connection to Day 21:** the pieces now need to be proven as one flow.

### Day 21 — Week 3 milestone

- **Objective:** demonstrate GitHub repository → defect detection → fix generation → isolated patch → test execution → verification → pull request.
- **Context:** a validation point for Days 15–20. It is not a new component and does not start a new workflow.
- **Planned work:** the end-to-end demonstration.
- **Actual implementation:** `runAutonomousRepair()` creates a `RepairJob`, runs the retry loop with a publisher callback, stores attempt history and finishes the job. It is reached through `POST /api/repairs` and the repair worker (Day 22). The worker re-clones the analyzed branch (`Analysis.sourceRef`) into a disposable workspace using the user's token, then calls `runAutonomousRepair`. The client's `RepositoryAnalysis.tsx` lets a user pick a finding and a test command and shows status.
- **Files and components:** `services/autonomous-repair.service.ts`, `autonomous-repair.types.ts`, `workers/repair.worker.ts`, `controllers/repair.controller.ts`, `routes/repair.routes.ts`.
- **Technical workflow:** the full flow in section 1.6.
- **Validation:** `test:autonomous-repair` exists; it was not run. **The end-to-end milestone has not been demonstrated.** Nothing in the archive records a successful verified-to-PR run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** every gap listed on Days 16–20; plus the runtime dependency of the worker on `git` and on a reachable Docker daemon (see Day 28).
- **Connection to Day 22:** long-running repair and scan work must not run inside HTTP requests.

---

## 5. Week 4 — Production engineering and polish (Days 22–30)

### Day 22 — BullMQ and background processing

- **Objective:** move long work out of HTTP requests.
- **Context:** wraps the Week 1 scan path and the Week 3 repair path.
- **Planned work:** queue through Redis/BullMQ, return job ids, process in workers, document the real job types.
- **Actual implementation:** two queues. `repository-scan` (3 attempts, exponential back-off from 2 s, completed jobs kept 24 h/2,000, failed 7 days/5,000) and `autonomous-repair` (1 attempt, same retention). `POST /api/repositories/ingest` and `POST /api/repairs` return `202` with a `jobId`; `GET /api/repositories/jobs/:jobId` and `GET /api/repairs/jobs/:jobId` return state, progress, result and failure reason for the owning user only. Workers: `npm run worker` (scan, concurrency `SCAN_WORKER_CONCURRENCY`, default 2) and `npm run repair-worker` (concurrency `REPAIR_WORKER_CONCURRENCY`, default 1). Redis settings come from `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`.
- **Files and components:** `queue/scan.queue.ts`, `queue/repair.queue.ts`, `workers/scan.worker.ts`, `workers/repair.worker.ts`, `controllers/ingestion.controller.ts`, `controllers/repair.controller.ts`.
- **Technical workflow:** API validates ownership → enqueues → worker loads rows and token → runs ingestion/repair → progress via `job.updateProgress`.
- **Validation:** `test:scan-queue` and `test:repair-queue` need Redis; not run.
- **Result:** Implemented, not yet verified.
- **Known gaps:** scan job ids are not unique per repository (manual jobs use random ids), so duplicate manual scans are allowed; no dead-letter handling beyond BullMQ retention; the API process requires Redis at start-up because realtime waits for queue events (Day 24).
- **Connection to Day 23:** external events can now enqueue work.

### Day 23 — GitHub webhooks

- **Objective:** start scans from GitHub events.
- **Context:** feeds the Day 22 scan queue.
- **Planned work:** receive push/pull-request events, verify signatures, trigger jobs, handle duplicates.
- **Actual implementation:** `POST /api/github/webhook`. The raw body is captured by `express.json({ verify })`. `verifyGitHubWebhookSignature` (HMAC-SHA256, constant-time compare) guards the endpoint; missing secret returns 503, missing headers 400, bad signature 401. `ping` is acknowledged; `push` to a branch and `pull_request` (`opened`, `reopened`, `synchronize`, `ready_for_review`) from the same repository are queued; fork PRs and other events return 202 with an "ignored" reason. The job id is `github-<deliveryId>`, so BullMQ de-duplicates redeliveries while the job is retained.
- **Files and components:** `controllers/github-webhook.controller.ts`, `github/github-webhook.signature.ts`, `routes/github.routes.ts`. A second, unused implementation (`security/github-webhook-signature.ts`) was removed on 11 October 2026; `test:security` now imports the real one.
- **Technical workflow:** GitHub → signature check → repository lookup by `githubId` → scan job with the pushed ref.
- **Validation:** `npm run test:webhook-signature` was run on 11 October 2026 (scratch copy) and printed `GitHub webhook signature tests passed.` Delivery, de-duplication and queueing were not run.
- **Result:** Implemented (signature verification verified at unit level); the rest is not yet verified.
- **Known gaps:** the webhook shares the global 100-requests-per-15-minutes rate limiter keyed by IP; no automated repair is triggered from a webhook (only scans).
- **Connection to Day 24:** users need to see queued work progress.

### Day 24 — Real-time dashboard

- **Objective:** show scan and repair progress without manual refresh.
- **Context:** consumes Day 22 progress events.
- **Planned work:** WebSockets (or equivalent) showing ingestion, analysis, repair, verification and PR status, including failed and inconclusive states.
- **Actual implementation:** Socket.IO attached to the API's HTTP server. Connections must present a valid JWT (handshake `auth.token` or `Authorization` header) and join room `user:<userId>`. `QueueEvents` for both queues are forwarded as `scan:progress`, `scan:completed`, `scan:failed`, `repair:progress`, `repair:completed`, `repair:failed`; scan retries are reported as `RETRYING`. `Repositories.tsx` polls `GET /api/repositories/jobs/:jobId` and listens for scan events; `RepositoryAnalysis.tsx` listens for repair events, shows the verification status and a PR link when one exists, and states when no PR was created.
- **Files and components:** `realtime/socket.ts`, `server.ts`, `client/src/pages/Repositories.tsx`, `RepositoryAnalysis.tsx`.
- **Technical workflow:** worker `updateProgress` → Redis → API `QueueEvents` → Socket.IO room → client state.
- **Validation:** not run (needs Redis, workers, a browser).
- **Result:** Implemented, not yet verified.
- **Known gaps:** repair progress has no REST polling fallback in the client (only scans do, though the status endpoint exists); no accessibility review; the Socket.IO CORS configuration allows only `FRONTEND_URL`.
- **Connection to Day 25:** progress is visible, so the analysis quality can now be improved with memory.

### Day 25 — RAG and repository memory

- **Objective:** give analyses retrieved repository context and history.
- **Context:** extends the Day 9 context inside the Day 14 pipeline.
- **Planned work:** retrieve documentation, code chunks, previous issues and fixes; explain the real retrieval and storage; claim embeddings/vector search only if they exist.
- **Actual implementation:** `indexRepositoryMemory` chunks files (70 lines, 10-line overlap, secrets redacted by regex) and the last ten completed analyses' findings and fix proposals; `createLexicalEmbedding` hashes unigrams and bigrams into a signed 384-dimension vector (no neural model, no external embedding API, no vector database); vectors are stored as JSON in `RepositoryMemoryChunk`; `retrieveRepositoryMemory` loads all chunks for the repository and ranks them by cosine similarity in application code (default top 6). Limits: 250 files, 256 KB per file, 3 MB total, 1,500 chunks; `.env*`, lockfiles and ignored directories skipped; symlinks not followed. The result is appended to the analysis prompt with a warning that retrieved text is untrusted. Failures degrade gracefully.
- **Files and components:** `rag/chunker.ts`, `rag/lexical-embedding.ts`, `services/repository-memory.service.ts`, `pipeline/analysis.pipeline.ts`, migration `20261010190000_repository_memory_chunks`, `test-rag.ts`.
- **Technical workflow:** after context building, stage "repository-memory" re-indexes the repository (delete-all then insert) and retrieves chunks for a query built from generic text plus file paths.
- **Validation:** `test:rag` needs a database; it failed to start without installed dependencies in the scratch copy and was not otherwise run. No retrieval quality measurement exists.
- **Result:** Partially implemented. Accurate description: **lexical retrieval over hashed vectors, scoped per repository**; not neural-embedding RAG.
- **Known gaps:** history is not filtered by branch or commit (`sourceRef`), so findings from other refs can be retrieved; the whole index is rebuilt on every scan; the retrieval query is crude; memory is used only by the analysis agents, not by the Fix Agent in the retry loop; no stale-context invalidation beyond rebuilding.
- **Connection to Day 26:** better context needs an honest measurement.

### Day 26 — Benchmark and evaluation

- **Objective:** measure detection and repair against seeded defects.
- **Context:** evaluates the whole Day 14–21 system.
- **Planned work:** reproducible seeded defects; precision, recall, false positives, repair success, retries, time; record dataset size, method, environment, limitations; never invent data.
- **Actual implementation:** `benchmark-evaluator.ts` matches findings to ground truth by normalized file path plus normalized category (one-to-one), and computes precision, recall, F1, false-discovery rate, verification rate, test-pass rate, PR-creation rate, average attempts, average repair duration and elapsed time, rejecting inconsistent repair records (for example a PR for an unverified repair). `run-benchmark.ts` writes `benchmarks/reports/latest-report.json`. A fixture `server/benchmarks/seeded-repo/` holds five seeded defects (`BUG-001`, `BUG-002`, `BUG-003`, `SEC-001`, `SEC-002`) with `ground-truth.json`.
- **Files and components:** `server/src/benchmark/*.ts`, `server/benchmarks/seeded-repo/**`, `test-benchmark-evaluator.ts`.
- **Technical workflow:** evaluator takes `ground-truth.json` and a `run-results.json` produced elsewhere. **No script produces `run-results.json` from a real pipeline run.**
- **Validation:** `npm run test:benchmark` was run on 11 October 2026 and printed `Benchmark evaluator tests passed.` `run-results.example.json` is a hand-written illustration (one finding, one repair); evaluating it gives recall 0.2 — that figure is **not a measurement of RepoDoctor**.
- **Result:** Partially implemented. Evaluator Implemented and verified at unit level; **no measured benchmark results exist**.
- **Known gaps:** 5 cases, not the 50 in the original example; ground-truth categories (`null_handling`, `code_injection`, `async_error_handling`) do not match the agents' enums (`LOGIC`, `INJECTION`, `ASYNC`), so real runs would need a mapping; no line-range matching; no latency percentiles or retry distribution; the seeded fixture has no test script, so repairs there would be inconclusive; the CLI defaults point at `benchmarks/ground-truth.json` and `benchmarks/run-results.json`, which do not exist.
- **Connection to Day 27:** known failure modes feed the security hardening list.

### Day 27 — Security and reliability

- **Objective:** harden the system against untrusted repositories, model output and abuse.
- **Context:** reviews every earlier day's trust boundaries.
- **Planned work:** rate limiting, webhook signatures, token protection, sandboxed execution, command allow-listing, timeouts, bounded retries, prompt-injection defences, audit logging.
- **Actual implementation:** see the control table below; several controls exist as modules that are not connected.
- **Files and components:** `middleware/rate-limit.middleware.ts`, `app.ts`, `security/token-encryption.ts`, `security/test-command-policy.ts`, `security/untrusted-context.ts`, `security/static-security-scanner.ts`, `services/security-audit.service.ts` (empty file), `SecurityAuditEvent` model, migration `20261010164636_security_audit_events`, `test-security-controls.ts`.
- **Technical workflow:** per control, below.
- **Validation:** `npm run test:security` (module-level tests of encryption, signature, command policy and untrusted wrapper) was run on 11 October 2026 and printed `Security control tests passed.` This proves the modules behave as unit-tested, **not** that they are used by the application.
- **Result:** Partially implemented.
- **Known gaps:** listed in the table.
- **Connection to Day 28:** controls only count once deployed correctly.

| Control | Evidence in source | Status |
|---|---|---|
| API rate limiting | `app.ts` applies `apiRateLimiter` (100 / 15 min) to `/api` and `authRateLimiter` (10 failed attempts / 15 min) to `/api/auth`. In-memory store; no `trust proxy` setting. `express-rate-limit` was imported but absent from `server/package.json` and its lockfile; **declared on 11 Oct 2026** (`^8.7.1`). | Implemented, not yet verified (build not run) |
| Webhook signature | Used by the controller; unit tested. | Implemented and verified (unit level) |
| GitHub token encryption | AES-256-GCM `encryptToken`/`decryptToken`, key from `GITHUB_TOKEN_ENCRYPTION_KEY`; unit tested; **not called** by `github.controller.ts` or any reader. Tokens remain plain text. | Partially implemented |
| Sandboxed test execution | Docker flags in Day 17; no network; resource limits; timeout. | Implemented, not yet verified |
| Command allow-listing | `repair.controller.ts` allows an argument array starting with `node`, `npm`, `npx`, `pnpm` or `yarn` (this still permits `node -e …` and `npx <package>` inside the container). The stricter `isAllowedTestCommand` policy is unit tested but **not used**. | Partially implemented |
| Execution timeouts | Docker 120 s; `git clone` 120 s. | Implemented, not yet verified |
| Bounded retries | Three attempts; queue `attempts: 1` for repairs. | Implemented, not yet verified (see Day 19) |
| Prompt-injection defence | `wrapUntrustedContext` exists but is **not used**, and its delimiter lines contain the literal text `$DIL1` / `$DIL2`; retrieved memory carries an "untrusted" notice. | Partially implemented |
| Audit logging | `SecurityAuditEvent` table and migration exist; `security-audit.service.ts` is a 0-byte file; nothing writes events. | Planned / not implemented (schema only) |
| Authorization of IDs | Controllers filter by `userId` through the repository relation. | Implemented, not yet verified |
| OAuth state | Signed, expiring, cookie-bound (Day 3). | Implemented, not yet verified |

### Day 28 — Deployment

- **Objective:** a reproducible deployment of frontend, API, database, Redis/BullMQ, workers and isolated test execution.
- **Context:** packages Days 1–27.
- **Planned work:** Dockerize; document variables, ports, health checks, steps; separate development from production; document AWS only if performed.
- **Actual implementation:** `docker-compose.yml` defines `postgres` (16, health check, volume, required `POSTGRES_PASSWORD`), `migrate` (one-shot `prisma migrate deploy`), `redis` (7, append-only, required `REDIS_PASSWORD`), `server`, `worker` and `client` (nginx on host port 8080 proxying `/api/` to `server:4000`). The `backend` network is `internal: true`; no database or cache port is published. `client/Dockerfile` and `nginx.conf` build and serve the SPA. A multi-stage `server/Dockerfile` exists. The unreferenced older Dockerfiles under `docker/` were removed on 11 October 2026. No AWS configuration exists.
- **Files and components:** `docker-compose.yml`, `server/Dockerfile`, `client/Dockerfile`, `client/nginx.conf`, `.dockerignore`.
- **Technical workflow:** `migrate` → `server`/`worker`; `client` proxies to `server`.
- **Validation:** nothing built or started (Docker unavailable).
- **Result:** Blocked or failing as configured. Defects found by static inspection:
  1. *(Fixed 11 Oct 2026)* `server/Dockerfile` ended with `CMD ["node", "dist/index.js"]` although `tsc` emits `dist/server.js`, and contained its content twice; it is now de-duplicated and runs `dist/server.js`. The production stage's `npm ci --omit=dev` now uses `--ignore-scripts` so `postinstall` (`prisma generate`) does not run before `prisma/` is copied; the generated client is copied from the build stage. Untested: no image was built.
  2. The server listens on `PORT` (default 5000; `.env.example` sets 5000) while Compose and nginx use 4000.
  3. Compose sets `REDIS_URL`, but the code reads `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`; `.env.example` has `REDIS_HOST=127.0.0.1`, which is wrong inside a container.
  4. Only the **repair** worker is defined (service name `worker`); there is no scan-worker service, so queued scans are never processed under Compose.
  5. `worker` is attached only to the internal `backend` network, so it cannot reach GitHub or AI providers.
  6. The production image installs no `git`, and no Docker CLI/daemon access is provided, but the workers need both.
  7. *(Fixed 11 Oct 2026)* `express-rate-limit` was missing from the dependency manifest (Day 27).
  8. No health checks for `server`, `worker` or `client`; no CI/CD files exist.
- **Known gaps:** the above, plus TLS, secrets management, backups and a rollback procedure.
- **Connection to Day 29:** the documentation must describe this honestly.

### Day 29 — Resume and GitHub polish

- **Objective:** a README and documentation set that agree with each other and with the code.
- **Context:** presents Days 1–28.
- **Planned work:** README with problem, architecture, workflow, stack, screenshots, demo, evaluation, security, deployment, future work; real milestones; no fabricated commits.
- **Actual implementation:** this documentation set — `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_HISTORY.md`, `docs/OPERATIONS_SECURITY.md`, `docs/TESTING_EVALUATION_DEMO.md` and `client/README.md` (replacing the unmodified Vite template text). The Vite template images in `client/src/assets/` are not product screenshots.
- **Files and components:** the files above.
- **Technical workflow:** the README is the entry point; the four detailed documents own architecture, history, operations/security and testing.
- **Validation:** cross-document checks listed in the final report of this revision (day order, links, scripts versus `package.json`).
- **Result:** Partially implemented.
- **Known gaps:** no real screenshots, no demo recording or URL, no commit history, no `LICENSE` file (`server/package.json` declares ISC; the repository licence is not established).
- **Connection to Day 30:** documentation is only credible after a real run.

### Day 30 — Final demo and interview preparation

- **Objective:** validate the full workflow on a deliberately defective repository and prepare a 3–5 minute demo.
- **Context:** the final integration of Days 1–29.
- **Planned work:** end-to-end validation; defective test repository; demo of selection, ingestion, detection, repair, tests, verification and PR; limitations and talking points; record real results.
- **Actual implementation:** fixtures exist locally (`bug-test-repo/`, `security-test-repo/`, `test-generation-repo/`, `server/benchmarks/seeded-repo/`). Only `test-generation-repo` has a `test` script. The demo protocol and interview summary are in [Testing, evaluation and demo](TESTING_EVALUATION_DEMO.md).
- **Files and components:** fixtures above; `docs/TESTING_EVALUATION_DEMO.md`.
- **Technical workflow:** the full flow in section 1.6, once.
- **Validation:** **not performed.** No clean build, no migration, no queue run, no Docker run, no PR created, no benchmark run.
- **Result:** Planned / not implemented. The release checklist remains entirely unchecked except for the five dependency-free scripts recorded in the testing document.
- **Known gaps:** every unverified item above. Day 30 should be called complete only after the checklist passes at a recorded commit.
- **Connection to next steps:** the highest-value follow-ups are listed in section 6.

---

## 6. Prioritized follow-ups (documentation findings, not code changes)

1. ~~Declare `express-rate-limit`~~ (done 11 Oct 2026, manifest and lockfile); run a full `npm install` and `npm run build` for both packages.
2. Fix the Compose/Dockerfile defects listed on Day 28, then validate from a clean machine.
3. Enforce `DockerTestResult.success === true` (and a non-timeout) independently of the LLM verdict before accepting `VERIFIED`.
4. Wire in token encryption, the stricter command policy, the untrusted-context wrapper (after removing the `$DIL1`/`$DIL2` placeholders) and the audit-event service, or remove them from the claims.
5. Persist generated tests in the pipeline (Day 12) and stop overwriting analyzer metadata (Day 6).
6. Produce a real `run-results.json` from the seeded fixture with a category mapping, then publish measured numbers with the methodology in the testing document.
7. Run the Day 21 end-to-end demonstration against a disposable repository and record it.

## 7. Day 30 completion definition

**The documentation consolidation is complete; the product release is not certified complete by this document.** Day 30 is complete only when code at a recorded commit passes the build, migration, focused-test, security and end-to-end checks in the testing document. Any unrun check stays marked pending.
