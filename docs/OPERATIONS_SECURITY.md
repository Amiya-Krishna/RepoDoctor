# RepoDoctor AI — Operations, Configuration, and Security Runbook

## 1. Scope

This document describes local development and the minimum operational controls required before a wider deployment. The supplied Docker Compose configuration is a development setup, not a production-ready deployment. The instructions below must be verified against the exact checkout being run.

## 2. Local prerequisites

- Node.js 22+ and npm.
- Git.
- Docker Desktop/Engine for isolated repair tests.
- PostgreSQL and Redis.
- GitHub OAuth application and a disposable GitHub test repository.
- At least one supported AI provider key for live AI operations.

## 3. Environment configuration

Copy `server/.env.example` to `server/.env` and configure the variable names already defined by the project. The typical categories are:

| Setting | Purpose | Handling rule |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | Use a least-privilege account; never expose it to the test runner |
| `JWT_SECRET` | Signing JWTs | Generate a strong random value; rotate deliberately |
| GitHub OAuth client ID/secret | OAuth flow | Keep secret server-side; restrict callback URLs |
| AI provider API keys | Model calls | Use environment/secret management; redact from logs |
| Redis host/port | BullMQ connection | Bind privately; do not expose Redis to the public internet |
| `GITHUB_WEBHOOK_SECRET` | Verify webhook HMAC | Must match GitHub configuration; treat as a secret |
| `FRONTEND_URL` | Expected browser origin / CORS configuration | Restrict to the intended origin in deployment |

Check the actual `.env.example` before use. Do not paste secret values into issues, screenshots, commit messages, test logs, Docker build arguments, or the model context.

## 4. Local startup runbook

### 4.1 Install dependencies

From the repository root:

```powershell
cd server
npm install
cd ../client
npm install
cd ..
```

The supplied lockfiles may be stale relative to the manifests. Inspect and commit any lockfile updates before using `npm ci` in a clean CI/release workflow.

### 4.2 Start services

```powershell
docker compose up --build -d postgres redis server worker repair-worker
docker compose ps
docker compose logs -f server worker repair-worker
```

If running the backend outside Docker, make sure `DATABASE_URL` points to the host-visible PostgreSQL address and Redis settings point to the host-visible Redis address. Start the API and each worker in separate terminals using scripts present in `server/package.json`.

### 4.3 Database

```powershell
cd server
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

For a new development schema, use the documented development migration command when appropriate. Never run `prisma migrate reset` against data that must be preserved. Before applying migrations to a shared environment, back up the database and review the SQL.

### 4.4 Client

```powershell
cd client
npm run dev
```

Use the URL printed by Vite. Confirm that the client API base URL matches the backend origin and that CORS is restricted to the intended client origin.

## 5. Job operations and observability

- Scan requests are designed to return HTTP `202 Accepted` with a job ID when queued.
- Use the authenticated job-status endpoint to check persisted state; do not rely only on Socket.IO messages.
- Socket.IO progress is a convenience layer. REST status lookup/polling is the recovery path when the browser misses events or reconnects.
- Review API and worker logs together when a job remains queued, retries, or fails.
- Log job IDs, repository IDs, stage names, durations, and sanitized error categories. Do not log access tokens, webhook secrets, full environment variables, or unredacted secret-like source snippets.
- Set retention limits for queue history and application logs. Avoid storing repository source or test output longer than necessary.

## 6. Repository and repair workspace lifecycle

1. Read the source repository into a temporary workspace for analysis.
2. Record the repository/source reference used for the analysis.
3. Generate a structured finding and repair proposal.
4. Create a separate disposable repair workspace and branch.
5. Validate and apply the structured patch only within that workspace.
6. Execute allowed tests in Docker with resource and time limits.
7. Interpret verification conservatively.
8. Remove the workspace using the project's cleanup routine after publication/termination.

The recorded cleanup API is:

```ts
removeRepairWorkspace(workspace.rootPath)
```

The original repository must remain unchanged. Before release, run a test that snapshots the source checkout's commit and working-tree status before a repair attempt and confirms both remain unchanged afterward.

## 7. Security model and required controls

### 7.1 Threats

- Malicious repository files, package scripts, test runners, symlinks, or path traversal.
- Prompt injection embedded in README/source/comments/issues or generated tests.
- Malicious/oversized AI patches and malformed structured output.
- Forged/replayed GitHub webhooks.
- Cross-user access to repositories, findings, and job IDs.
- Token leakage through logs, clone URLs, environment variables, Docker mounts, or command arguments.
- Resource exhaustion through large repositories, expensive prompts, endless jobs, or long-running tests.
- False-positive findings or false confidence from incomplete tests.

### 7.2 Non-negotiable invariants

- **Source immutability:** never apply fixes to the original source checkout.
- **No implicit trust:** repository content and model output are untrusted.
- **Patch validation:** validate schema, file paths, file count, and patch size before application.
- **Execution boundary:** never execute repository-controlled code directly on the host.
- **Least privilege:** the Docker test runner receives no GitHub token, database URL, or AI API key.
- **No unnecessary network:** tests should run without network access unless a documented, separately approved requirement exists.
- **Resource bounds:** enforce CPU, memory, process, time, file/output, and workspace-size limits.
- **Conservative verification:** `FAILED` and `INCONCLUSIVE` never equal success.
- **Verified-only publication:** only an explicit verified state can reach the PR publisher.
- **No automatic merge:** human review remains required.

### 7.3 GitHub OAuth and tokens

The supplied reconciliation describes signed, expiring OAuth state bound to an HttpOnly cookie. It also states that GitHub OAuth access tokens are stored unencrypted at rest. Treat token encryption as a production blocker:

- Encrypt tokens using a managed encryption key or secret-management service.
- Never store the encryption key beside ciphertext in the same database.
- Define key rotation and recovery before enabling encryption.
- Redact tokens from logs and errors.
- Use minimal GitHub scopes and the narrowest repository permissions possible.
- Ensure repository and job queries are scoped to the authenticated user.

### 7.4 Webhook handling

The documented endpoint is `POST /api/github/webhook`. It should validate `X-Hub-Signature-256` against the raw request body before parsing/trusting event content, compare signatures in constant time, and deduplicate using the delivery ID. Configure only the events required by the implementation. Reject missing/invalid signatures and test replay/deduplication behavior.

Fork pull requests are intentionally ignored in the first version. Keep this restriction until a separate design defines the trust boundary and permissions for untrusted fork code.

### 7.5 Docker runner

The source notes describe no network, read-only container root, and resource limits. Validate these against the actual Docker command/configuration before relying on them. Review:

- No privileged mode and no Docker socket mount.
- No host home directory or broad source mounts.
- Minimal read-only mounts where possible and a disposable writable workspace only where required.
- Dropped capabilities, no-new-privileges, non-root user, seccomp/AppArmor profile where supported.
- CPU, memory, PID, wall-clock, disk, and output limits.
- No inherited GitHub/AI/database credentials.
- Safe cleanup after timeout, cancellation, worker crash, and host restart.
- Shell/command allow-listing and prevention of user-controlled command concatenation.

Do not claim that Docker is a complete sandbox by itself. The actual host configuration and mount/privilege choices determine the strength of the boundary.

### 7.6 AI output and source handling

- Treat prompts and model responses as data, not instructions with authority over system controls.
- Require structured output and reject malformed or unexpected fields.
- Validate file paths against the workspace root, including traversal and symlink edge cases.
- Redact credential-like values in findings and logs.
- Limit context length and exclude binary, generated, dependency, and secret files.
- Never let a model choose arbitrary privileged shell commands.
- Store evidence for each finding and distinguish static evidence from inferred explanations.

### 7.7 Rate limits and abuse controls

Production-grade rate limiting is not evidenced as complete in the supplied archive. Before public deployment, add and test per-user/IP limits for login/registration, scan creation, repair creation, expensive AI operations, and any endpoints that can enqueue work. Also enforce per-user concurrent-job limits, repository size limits, prompt/token budgets, queue back-pressure, and a clear cancellation policy.

## 8. Development Compose is not production

The supplied configuration has been reported to contain hard-coded development credentials and published PostgreSQL/Redis ports. Before production:

- Remove all hard-coded credentials and require environment/secret injection.
- Keep PostgreSQL and Redis on a private network without public host ports.
- Add health/readiness checks and explicit resource limits.
- Configure persistent volumes and backup/restore drills.
- Run API and workers as non-root with minimal privileges.
- Build immutable production images instead of using development/watch commands.
- Add a production client build and reverse proxy/TLS configuration.
- Configure secure CORS, cookies, headers, logging, metrics, alerting, and log retention.
- Add database migration/rollback procedures and a documented recovery plan.

A production deployment is not complete until a clean-environment smoke test and rollback drill have been recorded.

## 9. Failure triage

| Symptom | Check first | Safe response |
|---|---|---|
| API cannot connect to DB | `DATABASE_URL`, database readiness, migration state | Fix configuration; do not reset a database with valuable data |
| Queue job stays waiting | Redis reachability, worker process, queue name/config | Inspect sanitized logs and job status; restart only after understanding active work |
| Scan fails during analysis | source ref, repository context, provider configuration, workspace cleanup | Record stage and safe error details; rerun on a disposable repository |
| AI provider returns rate limit | provider health, quotas, fallback logs | Allow configured failover/backoff; do not treat an empty result as a finding-free repository |
| Docker command fails | Docker availability, runner args, timeout, image, workspace mount | Mark as execution failure or inconclusive; never claim verification passed |
| Verification is inconclusive | missing tests, unsupported project setup, insufficient evidence | Stop publication; improve evidence or test setup before retrying |
| PR not created | explicit verification status, token permissions, branch push and API errors | Keep the repair unmerged; inspect redacted logs and test with a disposable repo |
| Live progress is missing | Socket.IO auth/connection, queue event handler | Query persisted job status through REST; do not infer failure from a missed event |

## 10. Operational release gate

Do not deploy publicly until token encryption, authorization review, rate limiting, sandbox review, secret management, production infrastructure configuration, backups, health checks, and the end-to-end repair safety tests are complete and documented.
