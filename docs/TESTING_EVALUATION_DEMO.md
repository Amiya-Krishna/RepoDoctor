# RepoDoctor AI — Testing, Evaluation, Demo, and Release Checklist

## 1. Purpose and evidence policy

This document is the canonical test and demo plan. It separates test scripts that exist in the source tree from test results that have actually been observed.

**No test, build, benchmark, or pull-request creation is claimed as passing solely because a command or implementation file exists.** Record the commit SHA, environment, exact command, exit code, relevant sanitized output, and any required external service. Do not record secrets or full untrusted source snippets.

The previous authoring attempt could not complete `npm ci`, and Docker was unavailable. Therefore the supplied evidence does not establish a successful clean build or complete end-to-end run.

## 2. Validation layers

1. **Static/configuration:** TypeScript builds, lint, Prisma schema validation, lockfile consistency.
2. **Focused unit/component tests:** parser/validator, risk engine, context builder, webhook signature, retry policy, workspace validation.
3. **Service integration:** PostgreSQL migrations/persistence, Redis/BullMQ queues, worker progress, Socket.IO and REST status recovery.
4. **External integration:** GitHub OAuth/API/webhook, AI provider selection/failover, pull-request creation.
5. **Safety/security:** source immutability, patch path validation, token isolation, Docker limits, forged webhook rejection, authorization boundaries.
6. **End-to-end acceptance:** scan a disposable repository, inspect findings, repair a seeded defect, verify it, and create a pull request only on success.
7. **Evaluation:** benchmark detection and repair on a versioned dataset with defined ground truth.

## 3. Clean-checkout validation sequence

Run from a clean checkout and retain the outputs. First ensure the lockfiles correspond to the package manifests. If they are stale, run `npm install` in both packages, review the changes, and commit them before using `npm ci` in CI.

### 3.1 Backend setup and build

```powershell
cd server
npm install
npx prisma validate
npx prisma generate
npm run build
```

For a reproducible CI run after lockfiles are current:

```powershell
npm ci
npm run build
```

Use the project’s migration procedure against a fresh disposable PostgreSQL database:

```powershell
npx prisma migrate deploy
```

Confirm that the database schema and generated Prisma client agree. Do not use `prisma migrate reset` against valuable data.

### 3.2 Frontend build and lint

```powershell
cd client
npm install
npm run build
npm run lint
```

If a script is absent from the current package manifest, record that fact and either add the intended script or remove it from the documented command list. Do not report an absent command as a passed check.

### 3.3 Focused backend checks

The original package manifest includes these focused scripts; verify the current manifest before execution:

```powershell
cd server
npm run test:context
npm run test:bug-agent
npm run test:security-agent
npm run test:test-generation
npm run test:risk-engine
npm run test:analysis-pipeline
npm run test:fix-agent
npm run test:repair-workspace
npm run test:docker-runner
npm run test:verification-agent
npm run test:repair-retry
npm run test:github-pr
npm run test:autonomous-repair
```

The reconciled Day 22–24 package may also define queue/webhook/job-history scripts such as:

```powershell
npm run test:webhook-signature
npm run test:scan-queue
npm run test:repair-queue
npm run test:repair-job-history
npm run test:repair-job-pagination
npm run test:repair-job-metrics
```

Run only scripts that actually exist in the checked-out `server/package.json`. Some tests require AI keys, GitHub credentials, Docker, Redis, PostgreSQL, or a dedicated test environment. Label tests that need external services; never silently skip them and call the suite complete.

## 4. Integration test matrix

| Area | Test | Required evidence | Failure behavior expected |
|---|---|---|---|
| Authentication | Register, login, invalid credentials, expired token | HTTP responses and sanitized logs | Unauthorized request is rejected; no token/secret leaks |
| Authorization | User A requests User B's repository/job/finding | Explicit negative test | Request denied without exposing existence-sensitive details |
| GitHub OAuth | State mismatch/expiry and valid callback | Browser or API trace, no credentials | Invalid state is rejected; callback does not accept arbitrary state |
| Repository sync | List repositories for connected user | Repository IDs and counts, redacted | Only repositories permitted to the user are returned |
| Ingestion | Queue scan and inspect source ref/snapshot | Job ID, persisted analysis, source ref | Failed job is recorded and temporary workspace cleaned |
| Context builder | Repository with source, config, ignored and oversized files | Context contents and exclusions | Secret/dependency/binary files excluded according to policy |
| AI provider manager | Primary success; rate limit; secondary success; all providers fail | Sanitized provider transitions | No fabricated findings; error/empty result remains explicit |
| Bug/security agents | Known positive and negative fixtures | Expected finding matching | Findings include evidence; false positives are measured |
| Risk engine | Boundary values and severity combinations | Deterministic expected output | Same inputs produce same score/level/priority |
| Test generation | Known defect fixture | Generated proposal and validation result | Invalid or unsupported output is rejected or clearly marked |
| Repair workspace | Patch a disposable repository | Source hash/status before and after | Original checkout remains unchanged |
| Patch validation | `../` paths, absolute paths, symlinks, huge patch, malformed schema | Negative test report | Patch rejected before writing outside workspace |
| Docker runner | Timeout, nonzero exit, oversized output, network attempt | Container config and test logs | Execution is bounded; no secret/network escape; failure is not success |
| Retry loop | Fail once then pass; fail all attempts; inconclusive result | Attempt history up to three | No more than three attempts; inconclusive stops; retries use prior evidence |
| PR publisher | Verified, failed, inconclusive and error statuses | GitHub test repo PR list and logs | Only verified state can create PR; no auto-merge/default-branch push |
| BullMQ | Worker down, retry, duplicate job, Redis restart | Queue/job status and worker logs | Work is recoverable/deduplicated according to policy |
| Webhook | Valid signature, invalid signature, duplicate delivery | HTTP status and queue count | Invalid signature rejected; duplicate delivery does not enqueue duplicate work |
| Socket.IO | Valid/invalid JWT, missed event, reconnect | Browser trace plus REST status | User-room isolation enforced; REST status recovers missed progress |
| Cleanup | Worker crash, timeout, cancellation | Workspace inventory | Temporary workspaces are eventually removed without deleting user data |

## 5. End-to-end demo protocol

Use a **disposable test repository**. Do not demonstrate autonomous repair against a valuable production repository.

### Preparation

1. Create a small JavaScript/TypeScript repository with a clear, reproducible seeded defect.
2. Include a test that fails before the fix and passes after the correct fix.
3. Record the expected defect, expected file/line, expected behavior, baseline commit SHA, and test command outside the detection system.
4. Confirm GitHub token permissions are limited to the test repository and the Docker runner receives no credentials.
5. Start PostgreSQL, Redis, API, scan worker, repair worker, and client. Check health/logs.

### Demo run

1. Register/sign in.
2. Complete GitHub OAuth and refresh repository listing.
3. Queue a scan and capture the job ID.
4. Show progress in the UI and confirm REST status also reports progress/completion.
5. Open the persisted analysis and inspect finding evidence, severity/risk, and generated test proposal.
6. Trigger repair for the seeded defect.
7. Show that repair occurs in a disposable workspace, not the source checkout.
8. Show Docker verification logs and the explicit final status.
9. For a verified result, show the new repair branch and pull request. Confirm it is not merged automatically.
10. Repeat with an intentionally unfixable or inconclusive fixture and demonstrate that no pull request is created.
11. Confirm the source repository commit and working tree remain unchanged.
12. Capture genuine screenshots and sanitized logs. Include the project commit SHA and environment summary in the demo notes.

### Suggested screenshots

- Repository dashboard with a selected test repository.
- Analysis detail with real findings and evidence.
- Repair status showing attempts and verification result.
- Docker verification output with secrets redacted.
- GitHub pull request page from the disposable test repository.
- Failed/inconclusive example showing no PR was created.

Only include screenshots from the actual running app. Do not create mock UI screenshots and present them as proof of implementation.

## 6. Seeded-defect benchmark protocol (Day 26 target)

The supplied archive does not include measured benchmark results. Use the following protocol before reporting any score.

### 6.1 Dataset design

Each benchmark case should include:

- Unique case ID and dataset version.
- Repository fixture and baseline commit SHA/hash.
- Defect category and severity label.
- Ground-truth affected file/line range and expected behavior.
- Baseline test command and proof that the defect is reproducible.
- Expected fix criteria and regression tests.
- Whether the case is eligible for autonomous repair or detection-only evaluation.

Avoid near-duplicate fixtures that inflate apparent performance. Keep ground-truth labels unavailable to the model pipeline.

### 6.2 Metrics

- **Precision** = true positive detections / all positive detections.
- **Recall** = true positive detections / all ground-truth defects.
- **F1** = harmonic mean of precision and recall.
- **False-positive count/rate** = incorrect findings among evaluated negative or unmatched cases.
- **Verified repair rate** = cases with a correctly verified repair / repair-eligible cases attempted. Report denominator and exclusions.
- **Test pass rate** = repaired cases whose defined verification suite passes / cases tested.
- **PR creation rate** = eligible verified cases with successfully created PRs / eligible verified cases attempted for publication.
- **Latency** = report median and a tail percentile, not just a single average; define whether queue time and provider wait are included.
- **Retry distribution** = share of cases requiring one, two, or three attempts.

Define the matching policy before running the benchmark. A finding counts as a true positive only if it matches the labeled defect under that policy; a repair counts as correct only if it fixes the intended behavior without failing required regression checks.

### 6.3 Required reproducibility metadata

Record dataset version/hash, repository fixture hashes, code commit SHA, Node/npm/Docker versions, OS, provider/model, prompt/config version, concurrency, timeouts, test commands, date, failed cases, excluded cases, and reason for each exclusion. Separate local synthetic results from results on real repositories.

### 6.4 Results template

Do not replace the blanks until the benchmark has actually run.

| Metric | Result | Denominator / notes |
|---|---:|---|
| Cases evaluated | Pending | Dataset version/hash: pending |
| Precision | Pending | Matching policy: pending |
| Recall | Pending | Ground-truth positives: pending |
| F1 score | Pending | Calculated from measured precision/recall |
| False positives | Pending | Include negative cases and unmatched findings |
| Verified repair rate | Pending | Define repair-eligible denominator |
| Test pass rate | Pending | State exact verification suite |
| PR creation rate | Pending | Only verified eligible cases |
| Median latency | Pending | State included stages |
| 95th percentile latency | Pending | State sample size |

## 7. Test result log template

Use one entry per command or acceptance test:

```text
Date/time (timezone):
Commit SHA:
Environment (OS, Node, npm, Docker):
Test name:
Exact command:
Required services/credentials present (yes/no; do not list secret values):
Exit code:
Result: PASS / FAIL / BLOCKED / NOT RUN
Evidence location:
Failure summary (sanitized):
Follow-up issue:
```

`BLOCKED` means the test could not run because a prerequisite was unavailable. `NOT RUN` is not a pass. Preserve failure evidence and rerun after the underlying problem is fixed.

## 8. Day 30 release acceptance checklist

Mark a box only after collecting evidence.

### Build and database

- [ ] Backend clean install and `npm run build` pass.
- [ ] Frontend clean install, `npm run build`, and lint pass.
- [ ] Both lockfiles match package manifests and are committed.
- [ ] `npx prisma validate` and client generation pass.
- [ ] Migrations apply to a fresh disposable PostgreSQL database.
- [ ] Backup/restore procedure is tested for any persistent deployment.

### Functional integration

- [ ] Register/login and GitHub OAuth pass in a browser.
- [ ] Repository list/sync and scan queue work with a real test repository.
- [ ] Unified pipeline persists expected analysis and passes the correct repository ID.
- [ ] Queue retries, duplicate delivery handling, job status, and worker recovery are verified.
- [ ] Signed webhook succeeds; invalid signature and duplicate delivery are rejected/deduplicated.
- [ ] Socket.IO progress and REST recovery work across reconnects.
- [ ] Repair workflow produces a valid PR only after successful verification.
- [ ] Failed and inconclusive cases create no PR and are not reported as success.

### Safety and security

- [ ] Source repository remains unchanged throughout repair.
- [ ] Path traversal, symlink, malformed patch, oversized patch, timeout, and resource exhaustion tests pass.
- [ ] Docker test container has no GitHub/AI/database credentials and no unapproved network access.
- [ ] User/job/repository authorization tests prevent cross-user access.
- [ ] GitHub tokens are encrypted at rest before production use.
- [ ] Rate limits, secret redaction, webhook replay policy, and production secret management are validated.
- [ ] No default-branch push, force-push, or automatic merge occurs.

### Documentation and release

- [ ] Real screenshots and a reproducible demo are included.
- [ ] Benchmark numbers are measured and reproducible, or explicitly marked pending.
- [ ] Known limitations and unsupported repository types are documented.
- [ ] No development credentials or secrets are committed.
- [ ] Release notes identify the exact commit SHA and test environment.
- [ ] All blocking failures are fixed or explicitly disclosed; no pending test is described as passing.

## 9. Interview-ready project explanation

A defensible summary after the workflow has been demonstrated is:

> “RepoDoctor AI is an AI-assisted code-analysis and repair workflow for JavaScript/TypeScript repositories. It combines repository context, structured bug/security analysis, deterministic risk scoring, isolated patch application, Docker-based verification, bounded retries, background queues, and GitHub pull-request creation behind a verification gate. It does not automatically merge repairs. I evaluate it using seeded defects and report measured detection, repair, and execution results along with its limitations.”

Use the summary only to describe features actually demonstrated in the current commit. If RAG, benchmark results, token encryption, or production deployment remain incomplete, say so directly rather than implying they are finished.
