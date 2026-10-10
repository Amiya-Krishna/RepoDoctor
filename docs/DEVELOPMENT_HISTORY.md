# RepoDoctor AI — Development History and Day 1–30 Status

## 1. How to read this document

This is the canonical cumulative milestone record for the 30-day project plan. It consolidates the previous Day 1–5, Day 6–10, Day 11–15, Day 16–20, status, implementation-log, error-fix, and reconciliation documents to remove repeated descriptions.

Status terms:

- **Source present:** the supplied reconciled archive contains implementation files or wiring for the capability.
- **Needs validation:** the capability has not been confirmed by a clean build, focused test, or integration run in the available evidence.
- **Not evidenced:** the supplied archive/documents do not demonstrate the implementation; do not claim it is complete.
- **Planned:** a milestone goal, not a completed feature.

The earlier documents describe Days 1–20 as implementation milestones and Days 22–24 as added in the reconciled working archive. The available evidence does not establish that all tests passed. Day 21 is inferred from the autonomous repair loop described in the reconciliation. Days 25–30 were described as the final hardening phase, but their implementation is not evidenced in the supplied archive.

## 2. Day-by-day milestone table

| Day | Milestone | Reconciled status and evidence |
|---:|---|---|
| 1 | Project foundation | React/Vite client, Express/TypeScript server, initial configuration and Docker files are present. Clean startup still needs validation. |
| 2 | Authentication | Registration/login, password hashing, JWT issuance, and protected middleware are described as present. Refresh-token rotation is not implemented. |
| 3 | GitHub connection | OAuth routes and GitHub API integration are present. OAuth state is described as signed, expiring, and bound to an HttpOnly cookie. Token encryption at rest remains a gap. |
| 4 | PostgreSQL + Prisma | Database architecture uses PostgreSQL and Prisma, not MongoDB/Mongoose. Schema, migrations, and persistence services are present. Apply migrations against a clean database to validate. |
| 5 | Docker and safe ingestion | Temporary workspace and Git-based ingestion foundation are present. Credentials should be supplied through environment configuration, not embedded in clone URLs. |
| 6 | Repository analyzer | Static analyzer, metadata/file inventory, and snapshot persistence are present. Fixture coverage and real-repository behavior need validation. |
| 7 | Analysis dashboard | Repository, analysis history, findings, generated-test proposals, and progress UI are present in the reconciled archive. Accessibility and full browser flow need review. |
| 8 | AI provider manager | `AIProviderManager` and OpenRouter → Groq → Gemini order are recorded. One OpenRouter 429 → Groq fallback was noted; broader live failover remains unverified. |
| 9 | Repository context | Context builder exists and requires `buildRepositoryContext(repositoryPath, repositoryId)`. The correct repository ID must be passed through ingestion. |
| 10 | Bug detection agent | Structured bug-detection agent and persistence path are present. Precision and false-positive rate have not been measured. |
| 11 | Security agent | AI security findings and a heuristic static scanner are present. This is not comprehensive SAST, authorization analysis, or dependency auditing. |
| 12 | Test-generation agent | Generated test proposals are persisted/displayed. Arbitrary dependency installation is not generally supported in the restricted test environment. |
| 13 | Risk engine | Deterministic risk scoring and persistence are present. Scoring calibration against a benchmark is pending. |
| 14 | Unified analysis pipeline | Bug/security/test stages and risk evaluation are connected. Reconciliation notes corrected the ingestion integration to pass `repositoryId` and run before source workspace cleanup. |
| 15 | Fix agent | Structured `FixResult` proposal generation and validation are present. AI proposals are untrusted and must not directly alter the source checkout. |
| 16 | Isolated repair workspace | A disposable workspace and dedicated repair branch are used for repair work. Source repository protection needs a destructive-operation test. |
| 17 | Safe patch application | `applyFixResult(repositoryPath, fixResult)` is the recorded API; `repositoryPath` must target the isolated workspace. |
| 18 | Docker verification | `server/src/execution/docker.runner.ts` provides the recorded Docker execution boundary. Resource limits and lack of network are described in reconciliation, but require runtime security validation. |
| 19 | Retry and replanning | `server/src/repair/retry/repair.retry.service.ts`, a maximum of three attempts, retry evidence, and conservative `INCONCLUSIVE` status are described. Runtime behavior needs test execution. |
| 20 | Verified GitHub pull request | Publisher path is described as verified-only, with branch commit/push/PR and no automatic merge. Real GitHub integration has not been evidenced as passing. |
| 21 | Autonomous repair loop | Reconciliation describes an authenticated repair endpoint and separate repair worker connecting findings → isolated repair → Docker verification → verified-only PR. Source wiring is present; complete E2E behavior needs validation. |
| 22 | BullMQ queues and workers | Scan and repair queues/workers, retry/retention settings, job status, progress callbacks, and PostgreSQL/Redis Compose services are described in the reconciled archive. Redis integration and failure recovery need validation. |
| 23 | GitHub webhooks | Raw-body HMAC signature validation, `push`/selected `pull_request` handling, delivery-ID deduplication, and queue enqueueing are described. Fork PRs are intentionally ignored. Needs a real webhook round trip. |
| 24 | Real-time dashboard | JWT-authenticated Socket.IO rooms, queue event forwarding, progress UI, and REST polling/status recovery are described. Needs browser/worker/reconnect testing. |
| 25 | RAG / repository memory | **Not evidenced in the supplied archive.** The reconciliation explicitly lists RAG as later work. Do not claim chunking, embeddings, retrieval, memory tables, or a migration exist unless added and tested. |
| 26 | Seeded-defect benchmark | **Not evidenced.** The earlier target mentioned a benchmark of seeded defects, but no measured dataset/results were supplied. Do not publish fabricated precision, recall, F1, or repair-rate values. |
| 27 | Security and reliability hardening | **Partially incomplete / not evidenced as complete.** Token encryption at rest, production-grade rate limiting, comprehensive dependency auditing, and full execution-boundary review remain gaps. |
| 28 | Deployment | **Not evidenced as production-ready.** Compose is development-oriented, contains hard-coded development credentials, publishes DB/cache ports, and has no validated production frontend deployment path in the supplied archive. |
| 29 | README, docs, screenshots, demo, evaluation | **Documentation consolidated by this five-file set.** Real screenshots, a recorded end-to-end demo, and measured evaluation results were not supplied and must be added only after they are captured. |
| 30 | Final E2E validation and interview readiness | **Validation still pending.** The authoring environment did not complete dependency installation; Docker was unavailable. Day 30 should be called complete only after the release checklist in `TESTING_EVALUATION_DEMO.md` passes in the user's environment. |

## 3. What the supplied archive does and does not prove

The archive supports that substantial source code exists for authentication, GitHub integration, repository analysis, AI-assisted analysis, repair orchestration, queues, webhooks, and progress reporting. It does **not** prove that:

- The backend and frontend compile from a clean checkout.
- Prisma migrations apply to a new database and match the schema.
- PostgreSQL and Redis workers complete jobs correctly under failure.
- GitHub OAuth and webhooks work end to end with real credentials.
- Docker isolation resists malicious repository content.
- A verified repair creates a real pull request in a disposable test repository.
- RAG, benchmark evaluation, production rate limiting, or production deployment have been implemented.

During the previous validation attempt, Node.js 22.16.0 and npm 10.9.0 were available, but Docker was unavailable and `npm ci` timed out. No clean build/test pass is claimed in this documentation.

## 4. Architecture decisions that must remain consistent

- Database: PostgreSQL + Prisma, not MongoDB/Mongoose.
- Backend: TypeScript + ESM/NodeNext; relative imports use `.js` suffixes where required.
- AI providers: OpenRouter → Groq → Gemini through `AIProviderManager`.
- Service folder: `server/src/services/`, plural.
- Retry service: `server/src/repair/retry/repair.retry.service.ts`.
- Docker runner: `server/src/execution/docker.runner.ts`.
- Repository context signature: `buildRepositoryContext(repositoryPath, repositoryId)`.
- Fix application signature: `applyFixResult(repositoryPath, fixResult)`.
- Repair workspace cleanup: `removeRepairWorkspace(workspace.rootPath)`.
- Repair retries: maximum three attempts; replan only after failure evidence; `INCONCLUSIVE` stops.
- Publication: only verified repairs may be offered as PRs; no automatic merge.

Do not add similarly named but nonexistent files or APIs merely to match a document. Confirm the current tree before editing code.

## 5. Day 25–30 completion plan

### Day 25 — Repository memory (planned)

1. Define the exact data model and migration for memory records/chunks.
2. Implement deterministic chunking with repository-relative file path and source-ref metadata.
3. Exclude secrets, generated artifacts, dependency folders, oversized files, and binary content.
4. Add retrieval that filters by repository identity and analyzed commit/source ref.
5. Test stale-context invalidation, deletion, and access isolation between users/repositories.
6. If embeddings or a vector store are not actually implemented, describe the system as lexical/context retrieval rather than RAG.

### Day 26 — Evaluation benchmark (planned)

1. Create a versioned dataset of seeded defects with expected locations and expected behavior.
2. Separate benchmark fixtures from the production code and keep labels hidden from the detection pipeline.
3. Define matching rules before running experiments.
4. Measure precision, recall, F1, false positives, verified repair rate, test pass rate, PR creation rate, and latency.
5. Record environment, model/provider, prompt/config version, dataset hash, and failures.
6. Publish only measured values with denominator and uncertainty/limitations; never turn target counts into claimed results.

### Day 27 — Security and reliability (planned)

1. Encrypt GitHub tokens at rest using a managed key and documented rotation procedure.
2. Add per-user/IP rate limits to authentication, scan, repair, and webhook-related routes as appropriate.
3. Audit authorization for repository/job/finding IDs to prevent cross-user access.
4. Review webhook replay/deduplication, request-size limits, log redaction, and secret handling.
5. Validate Docker CPU/memory/PID/time/output limits and host mount restrictions.
6. Test path traversal, symlink, patch-size, shell-injection, and malicious package-script cases.
7. Add health checks, graceful shutdown, queue back-pressure, and retry/dead-letter policy.

### Day 28 — Deployment (planned)

1. Replace development credentials with required secrets.
2. Stop publishing PostgreSQL/Redis ports publicly; use private networks and least-privilege accounts.
3. Build a production client artifact and serve it through a supported production web server/reverse proxy.
4. Separate API, scan worker, repair worker, and infrastructure configuration.
5. Add health/readiness checks, persistent database storage, backups, migrations, TLS, log retention, and resource budgets.
6. Document rollback, secret rotation, and incident response.
7. Validate from a clean environment before claiming a deployment is reproducible.

### Day 29 — Documentation and demo (this consolidation)

The five canonical files are:

- `README.md` — project overview and entry point.
- `docs/ARCHITECTURE.md` — architecture and contracts.
- `docs/DEVELOPMENT_HISTORY.md` — milestone history and status.
- `docs/OPERATIONS_SECURITY.md` — configuration, runbook, security.
- `docs/TESTING_EVALUATION_DEMO.md` — validation, demo, benchmark, release checklist.

Add actual screenshots and demo output only after the real UI/workflow is run. Remove old duplicate Day-range documents from the published docs directory after backing them up, if the repository owner approves.

### Day 30 — Final validation and interview readiness (planned)

1. Regenerate lockfiles and run clean installs.
2. Build the backend and frontend.
3. Validate Prisma schema and migrations against a fresh disposable PostgreSQL database.
4. Run focused unit/integration tests with the required services.
5. Run a full scan-to-repair-to-PR demonstration against a disposable repository.
6. Prove failed and inconclusive verification cannot publish a PR.
7. Test source-repository immutability, cleanup, token isolation, queue recovery, and webhook signature rejection.
8. Record logs, screenshots, measured evaluation results, known limitations, and the exact commit SHA.
9. Fix blockers, rerun the failed checks, and tag a release only after the checklist passes.

## 6. Day 30 completion definition

**The documentation consolidation is complete; the product release is not certified complete by this document.** Day 30 is complete only when the code at a recorded commit passes the build, migration, focused test, security, and end-to-end acceptance checks described in `TESTING_EVALUATION_DEMO.md`. Any unrun check must remain marked pending.
