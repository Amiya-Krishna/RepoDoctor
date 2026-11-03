# RepoDoctor AI — production readiness report

**Verdict: STAGING READY. Not a production candidate.**
The remediation is implemented and tested against real PostgreSQL, Redis and git, but four things the spec requires as evidence for a production candidate could not be exercised in the build environment: real-container isolation (no Docker daemon), `prisma migrate deploy/diff` (Prisma engines could not be downloaded), the native Prisma query engine (tests used the pure-JS `pg` adapter), and real github.com. Close those in CI/staging (checklist at the end), then reassess.

## Evidence actually executed

| Check | Result |
|---|---|
| Server `npm test` (`tsx --test src/tests/*.test.ts`) with real PostgreSQL 16 + Redis 7 | **198 tests: 189 pass, 0 fail, 9 skipped** (run twice, identical) |
| Server `tsc --noEmit`, `npm run build` | clean |
| Legacy scripts `test:security` (updated, see below), `test:webhook-signature`, `test:static-security`, `test:verification-gate` | exit 0 |
| Client `vitest run` | 13 pass |
| Client `tsc -b`, `eslint`, `vite build` | clean |
| Playwright `privacy-flow.spec.ts` (mocked API, local Chromium) | 2 pass |
| `docker compose config -q` | valid |
| Workflow static tests (`workflows.test.ts`, 12) | pass; they also caught invalid YAML in `ci.yml` (fixed) |
| Postgres backup → restore → migration rehearsal on the restored copy | executed, counts matched, duplicate PR archived |

**The 9 skips**, all in `docker-isolation.test.ts` (6) and `sandbox.test.ts` (3): "Docker daemon unavailable in this environment". With `REQUIRE_DOCKER_TESTS=true` (`npm run test:docker`, CI integration job) they fail instead of skipping. Container isolation is therefore verified only at the level of the generated `docker run` arguments (and the policy/path code), **not** by running containers.

One pre-existing assertion was changed deliberately: `test-security-controls.ts` used to assert that legacy plaintext GitHub tokens are readable; the spec now requires fail-closed, so it asserts the opposite (and the opt-in path). No other test was weakened, removed or skipped to get green.

## Findings by spec section

| § | Item | Status | Evidence |
|---|---|---|---|
| 2 | Consent checked before **every** AI request (retries, fallbacks, in flight) | Fixed | `consent-gate.test.ts` (mode change, expiry, withdrawal mid-flight, no retry/fallback on policy errors) |
| 3 | Durable webhook lifecycle, outbox, deterministic job ids, recovery | Fixed | `webhook*.test.ts` incl. real PG + Redis integration (crash between enqueue and mark, duplicate delivery, Redis outage → not acknowledged as queued) |
| 4 | Atomic privacy settings + audit, append-only audit | Fixed | `privacy-audit-db.test.ts`, trigger test in `migration-upgrade.test.ts` |
| 5 | Idempotent PR publication state machine, approval bound to patch hash + base commit | Fixed | `publication.test.ts` (24): crash at each of 7 crash points then recovery → exactly one branch and one PR; existing branch same/different tree; existing PR open/merged; 5xx after push; failing tests; revoke before/during; duplicate approvals; stale patch hash; patch edited after approval; base changed (touched vs unrelated file); wrong user; lost push access; recovery sweep + exhaustion. Remote = local bare git + local fake REST server |
| 6 | Release workflow hardening | Fixed | `deploy.yml`/`ci.yml` rewritten; `workflows.test.ts` |
| 7 | Token encryption migration/rotation | Fixed | `token-migration.test.ts` (14) incl. real-PG store; found and fixed a bug where a *throwing* post-write verification skipped the restore of the original value |
| 8 | DB migration safety | Fixed, partly verified | old-schema-with-data upgrade, duplicates archived, drift check, retention/deletion, concurrency on real PG; backup/restore executed. `migrate deploy/diff` **not run** |
| 9 | Sandbox and install security | Implemented; containers **not run** | `sandbox-policy.test.ts` (symlink/FIFO/size scan, install policy, non-root install args, gVisor flag, config fail-closed); fixed `~2` being misclassified as a path |
| 10 | Docs/config sync | Done | `OPERATIONS_SECURITY.md` §10–17, `DEPLOYMENT.md` §2a, `DATABASE_MIGRATIONS.md`, `.env.example`, `docker-compose.yml`, README |
| 11 | Frontend | Done | approve with `patchHash`, `PATCH_CHANGED`, revoke, new statuses with polling, branch-exists messaging, consent-withdraw confirmation, privacy error codes + recovery text, paginated audit history |

## Remaining risks

| Risk | Severity | Note |
|---|---|---|
| Container isolation never executed | High | run `npm run test:docker` on the sandbox host / CI; prefer gVisor or rootless; see `OPERATIONS_SECURITY.md` §15 |
| `prisma migrate deploy/diff` never run; tests used the pg driver adapter, not the native engine | High | CI `migrations` job; rehearse on a restored backup |
| Edited an already-dated migration (`20261031000000`) | Medium | checksum caveat and resolution in `DEPLOYMENT.md` §2a |
| GitHub semantics only emulated | Medium | staging run against a throw-away repository |
| Install container has network access; registry packages are trusted at install time | Medium | `REPAIR_INSTALL_NETWORK=none` with an offline cache removes it |
| Actions pinned to tags, not SHAs | Low–Med | SHAs could not be verified offline; Dependabot updates tags |
| `production` environment reviewers are a GitHub setting | Medium | not enforceable from the repo |
| Prompt injection and redaction are mitigations | Medium | cannot be proven |
| OAuth `repo` scope broad; 1-day JWTs without revocation; in-memory rate limits | Medium | pre-existing |
| No external penetration test | — | recommended |

## To reach "production candidate"

1. CI green on a branch with the integration job (real Postgres/Redis/**Docker**, nothing skipped) and the `migrations` job (`migrate deploy` + `migrate diff`).
2. Staging: sandbox VM with gVisor, `npm run test:docker` passing, one end-to-end run (webhook → scan → approve → PR) on a throw-away GitHub repository, kill the repair worker mid-publish and confirm recovery.
3. Upgrade rehearsal per `DEPLOYMENT.md` §2a on a restored production backup.
4. External review.
