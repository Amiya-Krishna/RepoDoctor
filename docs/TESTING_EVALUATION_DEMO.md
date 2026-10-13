# RepoDoctor AI — Testing, Evaluation, Demo, and Release Checklist

## 1. Purpose and evidence policy

This document separates **test scripts that exist** from **results that were observed**. A command or file existing is never recorded as a pass. For every result the environment, exact command and exit code are given. A check that could not run is marked **BLOCKED** (with the reason), never PASS.

Status labels are defined in the [development history](DEVELOPMENT_HISTORY.md#12-status-labels-used-identically-in-every-document). 

## 2. Test inventory

There is no test framework and no `npm test` in `server/`; each `test:*` script is a standalone `tsx` program that exits non-zero on failure. The client has `lint` and `build` only. Scripts are grouped by what they need.

| Group | Scripts (`npm run <name>` in `server/`) | Needs |
|---|---|---|
| Self-contained | `test:risk-engine`, `test:webhook-signature`, `test:static-security`, `test:benchmark`, `test:security`, `test:verification-gate`, `test:ai-selection` | nothing external (`test:security` needs `GITHUB_TOKEN_ENCRYPTION_KEY`) |
| HTTP / middleware | `test:app` | Redis, generated Prisma client |
| Authentication | `test:auth` | migrated PostgreSQL, `JWT_SECRET`, Redis settings. Registers, logs in and deletes unique throw-away users: validation, duplicate and concurrent-duplicate handling, bcrypt storage, wrong-password / unknown-user responses, protected endpoints |
| Database | `test:rag` | PostgreSQL |
| Queues | `test:scan-queue`, `test:repair-queue` | Redis (set `REDIS_PASSWORD` in the shell; the scripts do not load `server/.env`) |
| Need a path argument | `test:context -- <repo-path>`, `test:repair-workspace -- <git-repo-path>`, `test:docker-runner -- <repo-path>`, `test:github-pr -- <repo-path>` | a repository (a git repository for `repair-workspace`; Docker for `docker-runner`; GitHub token for `github-pr`) |
| Need AI keys | `test:ai`, `test:openrouter`, `test:groq`, `test:gemini`, `test:bug-agent`, `test:security-agent`, `test:test-generation`, `test:fix-agent`, `test:verification-agent`, `test:analysis-pipeline`, `test:repair-retry`, `test:autonomous-repair` | at least one of `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` (and for some, a database and Docker) |
| Need existing data | `test:repair-job-history`, `test:repair-job-pagination`, `test:repair-job-metrics` | `REPAIR_JOB_ID` / `ANALYSIS_ID` of existing rows |
| Browser | `npm run test:e2e` (in `client/`) | running API and client, Playwright Chromium |
| Static | `npx tsc --noEmit`, `npm run build` (server); `npm run lint`, `npm run build` (client); `docker compose config -q` | dependencies; a root `.env` and `server/.env` for Compose |

## 3. Results observed

All self-contained, HTTP, authentication, database, queue and path-argument scripts that could be run passed; the browser authentication check passed; AI-, GitHub- and Docker-dependent scripts and Docker image builds were not run.

## 4. Validation layers (target)

1. Static: server and client builds, client lint, Prisma validate, lockfiles consistent with manifests.
2. Focused unit scripts (the self-contained group and `test:context`).
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
