# RepoDoctor AI — Days 1–24 Reconciliation

This audit is based on the uploaded repository archive. “Present” means the code path exists in the tree; it does not mean the behavior passed an integration test.

| Day | Original milestone | Current evidence/status |
|---|---|---|
| 1 | Foundation | React/Vite client, Express/TypeScript server, Prisma and Docker files exist. Compose now includes PostgreSQL and Redis. Needs a clean startup test. |
| 2 | Authentication | Register/login/JWT/protected middleware exist. Registration UI and server-side password/email validation are present. Refresh-token rotation is not implemented. |
| 3 | GitHub OAuth | OAuth routes and token storage exist. OAuth state now uses a signed expiring JWT bound to an HttpOnly cookie. GitHub tokens are still stored unencrypted at rest; this is a hardening item. |
| 4 | Repository management | GitHub repository sync/listing and repository detail exist. A protected delete endpoint is added. A separate “create project” endpoint is not needed for the current GitHub-linked repository model. |
| 5 | Repository ingestion | Ingestion now runs in a background scan job and records the analyzed source ref. Credentials are passed to host Git through environment configuration, not embedded in the clone URL. |
| 6 | Repository analyzer | Static repository analyzer and snapshot persistence exist. Needs fixture-based coverage and real-repository validation. |
| 7 | Dashboard | Repository list, latest analysis, history, findings, generated-test proposals, scan progress and repair actions are connected in the client. UI polish/accessibility still need review. |
| 8 | LLM integration | Existing AI provider manager and OpenRouter → Groq → Gemini architecture remain. Provider failover and structured output need live integration testing. |
| 9 | Code context | Context builder exists. The ingestion-to-pipeline integration now passes the actual `repositoryId`, not the `analysisId`. |
| 10 | Bug detection | Structured bug agent and persistence exist. Precision/false-positive evaluation is still pending. |
| 11 | Security agent | AI security findings and persistence exist. A comprehensive deterministic scanner for secrets, injection, unsafe dependencies and auth/authorization patterns is not yet complete. |
| 12 | Test agent | Generated test proposals are persisted and displayed. The system does not yet install arbitrary repository dependencies in the sandbox; projects requiring `node_modules` may fail tests. |
| 13 | Risk engine | Deterministic risk scoring and persistence exist. Scoring calibration against a benchmark remains pending. |
| 14 | Unified analysis pipeline | Critical gap fixed: ingestion now calls the unified bug/security/test/risk pipeline before the cloned source workspace is cleaned up. |
| 15 | Fix agent | Structured fix proposal generation exists. It is invoked by the autonomous repair loop. |
| 16 | Isolated workspace | Repair workspaces are separate from the original repository; source GitHub repositories are not patched directly. |
| 17 | Test runner | Docker runner exists with resource limits, no network, read-only container root, and no GitHub token. Dependency installation/build preparation for general repositories remains limited. |
| 18 | Verification | Evidence-based verification exists; `INCONCLUSIVE` is not success. Live integration tests still need to be run. |
| 19 | Re-planning | Retry loop is bounded to three attempts; retries use prior failure evidence. `INCONCLUSIVE` stops the loop. |
| 20 | GitHub PR generation | Verified-only publisher is now invoked from the successful retry attempt before the temporary workspace is cleaned up. Publication uses the linked user's token and selected repository, and never auto-merges. Needs a real test repository integration run. |
| 21 | Autonomous loop | Authenticated repair endpoint and separate repair worker now connect persisted findings → isolated repair → Docker verification → verified-only PR publication. |
| 22 | BullMQ | Separate scan and repair queues/workers, retry/retention settings, job status endpoints, and progress events are present. Redis and PostgreSQL are defined in Compose. |
| 23 | GitHub webhooks | HMAC signature validation, push/selected PR actions, delivery-ID job deduplication and queue enqueueing are present. Fork PRs are deliberately ignored in this first version. |
| 24 | Real-time dashboard | Socket.IO uses JWT-authenticated user rooms; queue events publish scan/repair progress, completion and failure. REST status endpoints provide a recovery path. |

## Required validation before marking Days 1–24 complete

The archive did not include `node_modules`, and dependency installation could not complete in this environment. The following have **not** been verified here:

- Full TypeScript type-check/build against installed dependencies.
- Prisma client generation and migration application against PostgreSQL.
- Redis/BullMQ scan and repair worker execution.
- Socket.IO live event delivery and reconnect/poll recovery.
- GitHub OAuth callback in a browser.
- Webhook HMAC and enqueue round trip against a configured GitHub webhook.
- End-to-end verified repair and actual PR creation.
- Security review of all repository-controlled code execution paths.

Before deployment, regenerate and commit `server/package-lock.json` and `client/package-lock.json` with `npm install`. Then run the commands in the root README and execute the end-to-end demo using a disposable test repository.

## Known limitations retained intentionally

- The first webhook version scans only same-repository pull-request branches. Fork PR support needs a trust/permission design.
- GitHub OAuth access tokens remain plaintext in PostgreSQL; encrypt them at rest before production use.
- Docker test execution does not yet provision arbitrary dependencies in an offline sandbox. Use a controlled test command/repository until dependency preparation is implemented safely.
- Security hardening, RAG, benchmarking, production deployment and complete docs/demo polish remain later milestones (Days 25–30).
