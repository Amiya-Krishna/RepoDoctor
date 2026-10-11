# RepoDoctor AI — Testing, Evaluation, Demo, and Release Checklist

## 1. Purpose and evidence policy

This document separates **test scripts that exist** from **results that were observed**. A command or file existing is never recorded as a pass. For every result the date, environment, exact command and exit code are given.

Status labels are defined in the [development history](DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document).

## 2. Results actually observed

The archive contains no `.git` directory, so no commit SHA exists to record.

**Environment for every entry below:** 11 October 2026, Linux 6.18, Node.js 22.22.0, `tsx` installed globally, run inside a **scratch copy** of the archive (the delivered files were not touched). `npm install` was **not** run, so no `node_modules` existed; only scripts that depend on nothing but Node built-ins and project files could run. No Docker, Redis, PostgreSQL, GitHub or AI provider access.

| Test | Command (from `server/`) | Services/credentials needed | Exit | Result | Evidence (sanitized) |
|---|---|---|:-:|---|---|
| Risk engine | `npm run test:risk-engine` (executed as `tsx src/test-risk-engine.ts`) | none | 0 | **PASS** (script prints, does not assert) | printed overall score 73, level CRITICAL, priority P0, 3 findings (1 critical, 1 high, 1 medium) |
| Webhook signature | `npm run test:webhook-signature` | none | 0 | **PASS** | `GitHub webhook signature tests passed.` |
| Static security scanner | `npm run test:static-security` | none | 0 | **PASS** | `Static security scanner tests passed.` |
| Benchmark evaluator | `npm run test:benchmark` | none | 0 | **PASS** | `Benchmark evaluator tests passed.` |
| Security control modules | `npm run test:security` with a throw-away random `GITHUB_TOKEN_ENCRYPTION_KEY` | none | 0 | **PASS** | `Security control tests passed.` Proves the modules behave; does **not** prove the app uses them |
| Benchmark CLI on the example file | `tsx src/benchmark/run-benchmark.ts benchmarks/seeded-repo/ground-truth.json benchmarks/seeded-repo/run-results.example.json` | none | 0 | ran | 1 of 5 expected found → recall 0.2, F1 ≈ 0.33. **Illustrative example data, not a measurement.** Default paths in the script point at files that do not exist |
| RAG | `npm run test:rag` | PostgreSQL, dependencies | 1 | **BLOCKED** | `ERR_MODULE_NOT_FOUND` (no installed dependencies) |
| Context builder | `npm run test:context -- <path>` | a repository path | 1 | **NOT RUN** | exited on the missing path argument |
| Repair workspace | `npm run test:repair-workspace -- <git-repo-path>` | a git repository path | 1 | **NOT RUN** | exited on the missing path argument |

Nothing else has been run. In particular **not run**: `npm install`, `npm run build` (server and client), `npm run lint` (client), `npx prisma validate`, migrations on a database, any queue test, any Docker test, any live AI or GitHub test, any browser test. Their status is **NOT RUN**, which is not a pass.

## 3. Test and script inventory (from `package.json`)

There is no test framework and no `npm test` in `server/`; each `test:*` script is a standalone `tsx` program. The client has no tests (`build` and `lint` only).

| Script | Needs | Observed? |
|---|---|---|
| `test:risk-engine`, `test:webhook-signature`, `test:static-security`, `test:benchmark`, `test:security` | nothing external | passed (§2) |
| `benchmark:evaluate` | ground-truth and run-results JSON paths | ran on the example file (§2) |
| `test:context` | repository path | not run |
| `test:repair-workspace` | git repository path | not run |
| `test:rag`, `test:analysis-pipeline`, `test:repair-job-history`, `test:repair-job-pagination`, `test:repair-job-metrics` | PostgreSQL (and, for the pipeline, AI keys) | not run |
| `test:scan-queue`, `test:repair-queue` | Redis (BullMQ), possibly PostgreSQL | not run |
| `test:ai`, `test:openrouter`, `test:groq`, `test:gemini`, `test:bug-agent`, `test:security-agent`, `test:test-generation`, `test:fix-agent`, `test:verification-agent` | live AI keys | not run |
| `test:docker-runner` | Docker daemon | not run |
| `test:repair-retry`, `test:autonomous-repair` | PostgreSQL, AI, Docker, repository fixture | not run |
| `test:github-pr` | GitHub token and a disposable repository | not run |
| Client `build`, `lint` | `npm install` | not run |
| `npx prisma validate`, `npm run prisma:deploy` | dependencies, database | not run |

## 4. Validation layers (target)

1. Static: server and client builds, client lint, Prisma validate, lockfiles consistent with manifests. (`express-rate-limit` was undeclared and was added on 11 October 2026; no install/build has been run since.)
2. Focused unit scripts (the §2 set and `test:context`).
3. Service integration: migrations on a fresh PostgreSQL, Redis queues, worker progress, Socket.IO plus REST recovery.
4. External integration: OAuth, GitHub API, webhook delivery, AI failover, PR creation.
5. Safety: source immutability, patch path validation, token isolation, Docker limits, forged-webhook rejection, cross-user authorization.
6. End-to-end acceptance on a disposable repository.
7. Evaluation on a versioned seeded dataset.

## 5. Integration test matrix (what must be demonstrated)

| Area | Test | Evidence required | Expected behaviour |
|---|---|---|---|
| Authentication | register, login, wrong password, expired token | HTTP responses | rejected without leaking details |
| Authorization | user A requests user B's repository, analysis, finding, job | negative-test output | 404, no existence leak |
| OAuth | state mismatch, expiry, valid callback | trace without secrets | invalid state rejected |
| Ingestion | scan a disposable repository | job id, `Analysis` row, `sourceRef` | failure recorded, workspace removed |
| Context | repository with ignored/oversized files | included file list | ignored directories and big files excluded |
| AI manager | primary success, 429, secondary success, all fail | provider transition log | explicit error, no invented findings; confirm Groq/Gemini work without an OpenRouter key (currently the config import throws) |
| Agents | known positive and negative fixtures | matched findings | measured false positives |
| Risk engine | boundary severities | deterministic output | same input, same score |
| Generated tests | pipeline run | `GeneratedTest` rows | **currently expected to be empty**; fix then re-test |
| Repair workspace | patch a fixture, hash source clone before/after | hash and status | source clone unchanged |
| Patch validation | `../`, absolute, symlink, huge patch | negative report | rejected before write |
| Docker runner | timeout, non-zero exit, huge output, network attempt | container flags, logs | bounded; failure is not success |
| Verification gate | Docker run fails but model says `VERIFIED` | PR gate output | **currently expected to pass the gate**; fix then re-test |
| Retry loop | fail once then pass; fail 3 times; inconclusive | attempt rows | ≤ 3 attempts; inconclusive stops |
| PR publisher | verified, failed, inconclusive, error | PR list of the test repository | only verified can publish; no merge |
| Queues | worker down, retry, duplicate delivery, Redis restart | job states | recoverable and de-duplicated |
| Webhook | valid, invalid, duplicate delivery | HTTP codes and queue count | invalid 401; duplicate not re-queued |
| Socket.IO | valid and invalid JWT, missed event, reconnect | trace plus REST status | user rooms isolated |
| Rate limits | 11th failed login, 101st request | HTTP 429 | enforced (dependency now declared; not yet run) |
| Compose | clean machine, `docker compose up` | `docker compose ps`, logs | all services healthy (currently expected to fail, see Operations §6) |

## 6. Seeded-defect benchmark

### 6.1 What exists

- `server/benchmarks/seeded-repo/` with five seeded defects: `BUG-001` null handling in `src/user.ts`, `BUG-002` input validation in `src/profile.ts`, `BUG-003` async error handling in `src/payment.ts`, `SEC-001` authorization in `src/admin.ts`, `SEC-002` code injection in `src/parse.ts`; `ground-truth.json` lists file and category per case.
- `server/src/benchmark/benchmark-evaluator.ts` and `run-benchmark.ts` compute detection and repair metrics from two JSON files (unit-tested, §2).
- `run-results.example.json` — **hand-written example**, not an output of RepoDoctor.

### 6.2 What does not exist

- No script that runs the pipeline over the fixture and writes `run-results.json`.
- No test script in the seeded fixture, so any repair there would be inconclusive.
- No mapping between ground-truth categories (`null_handling`, `code_injection`, `async_error_handling`, …) and the agents' categories (`LOGIC`, `RUNTIME`, `INJECTION`, `ASYNC`, …). Only categories that happen to normalize to the same string (for example `authorization` / `AUTHORIZATION`) would match.
- No line-level matching, latency percentiles or retry distribution.
- **No measured results.** The original plan's "50 seeded defects" was an example target; the fixture has 5.

### 6.3 Metrics as implemented

True positive = a detected finding with the same normalized file path and category as an expected case (one-to-one). Precision = TP/(TP+FP); recall = TP/(TP+FN); F1; false-discovery rate; verification rate, test-pass rate and PR-creation rate over attempted/verified repairs; average attempts; average repair duration; elapsed time. Report the denominator for every rate.

### 6.4 Required reproducibility metadata (to record with any real run)

Dataset version and hash, code commit SHA, Node/npm/Docker versions, OS, provider and model, prompt version, concurrency, timeouts, test commands, date, failed and excluded cases with reasons; separate synthetic fixtures from real repositories.

### 6.5 Results

| Metric | Result | Notes |
|---|---:|---|
| Cases evaluated | Pending | no real run exists |
| Precision | Pending | |
| Recall | Pending | |
| F1 | Pending | |
| False positives | Pending | |
| Verified repair rate | Pending | |
| Test pass rate | Pending | |
| PR creation rate | Pending | |
| Median / p95 latency | Pending | not implemented in the evaluator |

## 7. Test result log template

```text
Date/time (timezone):
Commit SHA (n/a if no git history):
Environment (OS, Node, npm, Docker):
Test name:
Exact command:
Services/credentials present (yes/no, never values):
Exit code:
Result: PASS / FAIL / BLOCKED / NOT RUN
Evidence location:
Failure summary (sanitized):
Follow-up:
```

`BLOCKED` = a prerequisite was unavailable. `NOT RUN` is not a pass.

## 8. End-to-end demonstration protocol (Day 21 and Day 30)

Use a **disposable GitHub repository**; never demonstrate autonomous repair on valuable code.

**Preparation.** Create a small JavaScript/TypeScript repository with one reproducible seeded defect and a test that fails before and passes after the correct fix, with the test needing **no installed dependencies** (the runner has no network and the clone has no `node_modules`; use `node:test` or plain `node` scripts, for example the style of `test-generation-repo/`). Record the expected file, line, behaviour, baseline commit and test command outside RepoDoctor. Use a token limited to that repository. Start PostgreSQL, Redis, API, scan worker, repair worker and client, and confirm Docker is reachable from the repair worker.

**Run.** Register/sign in → connect GitHub → refresh repositories → scan (capture job id) → watch progress in the UI and confirm the REST status agrees → inspect the analysis → start a repair with the test command (for example `npm test`) → watch attempts → show the explicit verification result → for a verified result show the branch and the open, **unmerged** pull request → repeat with an unfixable fixture and show no PR → confirm the source repository is unchanged → capture real screenshots and sanitized logs with the commit SHA.

**Screenshots to capture (none exist yet):** repository list; analysis with findings and risk; repair status with attempts; Docker verification output (redacted); the pull request; a failed or inconclusive case with no PR.

## 9. Release checklist (Day 30)

Mark a box only after collecting evidence. **Currently only the five unit-level scripts in §2 have evidence; every box is unchecked.**

- [ ] Server clean install and build pass; `express-rate-limit` declared (done 11 Oct 2026); lockfiles match manifests.
- [ ] Client clean install, build and lint pass.
- [ ] `npx prisma validate` passes; migrations apply to a fresh PostgreSQL.
- [ ] Register/login and OAuth work in a browser.
- [ ] Scan queue, webhook delivery, de-duplication and worker recovery work.
- [ ] Socket.IO progress and REST recovery work across reconnects.
- [ ] Generated tests are persisted (currently not).
- [ ] Verified repair opens a PR; failed and inconclusive repairs do not.
- [ ] A failing Docker run cannot be accepted as `VERIFIED` (currently not enforced).
- [ ] Source clone unchanged by repair; path traversal, symlink and oversized-patch cases rejected.
- [ ] Test container has no credentials and no network.
- [ ] Cross-user authorization tests pass.
- [ ] Tokens encrypted at rest (currently not wired).
- [ ] Rate limits, audit logging and webhook replay policy validated.
- [ ] Compose stack starts on a clean machine and passes a smoke test.
- [ ] Real screenshots and a reproducible demo exist.
- [ ] Benchmark numbers are measured with metadata, or remain "Pending".
- [ ] Release notes record the commit SHA and environment.

## 10. Interview-ready explanation (for use after a demonstration)

> "RepoDoctor AI is an AI-assisted analysis and repair workflow for JavaScript/TypeScript repositories. It builds repository context, runs structured bug and security analysis with deterministic scoring, generates a fix, applies it in a disposable workspace, runs the repository's tests in a network-less Docker container, asks a verification step to judge the evidence, retries up to three times, and opens a pull request only after verification succeeds. It never merges. Background jobs run on BullMQ and progress streams over Socket.IO. The data layer is PostgreSQL with Prisma. Repository memory is lexical hashed-vector retrieval, not neural embeddings. I have unit-level evidence for the risk engine, webhook signature, static scanner and benchmark evaluator; the end-to-end loop, the benchmark and the deployment are not yet validated, and I know the specific gaps."

Use it only to describe what has been demonstrated at the current commit.
