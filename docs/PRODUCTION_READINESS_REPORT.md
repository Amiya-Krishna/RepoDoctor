# RepoDoctor AI — production readiness report (second pass: real infrastructure)

**Verdict: STAGING READY. Not a production candidate.**
Critical checks listed under "Not executed" (gVisor, real GitHub, native Prisma, install container, dedicated sandbox VM) have not been run, so by the project's own rule the project cannot be called production-ready. Raw evidence is in `docs/evidence/`.

## Infrastructure actually used (this pass)
| Component | What was used | Caveat |
|---|---|---|
| PostgreSQL | 16.15, local server | not the native Prisma engine (pg driver adapter) |
| Redis | 7.0.15 with password | — |
| Docker | Engine 29.9.2, runc, cgroup v1, default seccomp, started inside the build sandbox | **not a dedicated VM**; sandbox image is a **local stand-in** built from the host Node 22 binary because registries are blocked |
| gVisor | **not available** (`runsc` not installable here) | unverified |
| GitHub | **none** (no account linked; `api.github.com` unreachable) | local fake REST + local bare git only |
| Git hosting for Actions SHAs | `git ls-remote` + clones of upstream repos | real data, used for pin verification |

## Exact results
| Check | Result |
|---|---|
| Server suite, all infra required (`REQUIRE_INTEGRATION_TESTS`, `REQUIRE_DOCKER_TESTS`) | **212 tests: 212 pass, 0 fail, 0 skipped** |
| Real-container isolation (`docker-isolation.test.ts`) | 7/7 pass, incl. non-root, read-only rootfs, zero capabilities, `NoNewPrivs`, no network, no Docker socket / host paths / host secrets, `noexec` /tmp, PID and memory limits |
| Hostile repository through the real runner (`docker-runner-malicious.test.ts`) | 6/6 pass: network/host-file/secret/privilege attempts fail; runaway process killed at timeout and container removed; memory bomb OOM-killed; escaping symlink refused **before** any container exists; non-zero exit reported; volume cleanup verified |
| Publication with the **real** sandbox | 26/26 in `publication.test.ts` incl. a patch re-tested in a real container (fails before, passes after) and a patch whose tests still fail in the container being **not** pushed |
| Migration immutability + 5 install paths on real PostgreSQL | pass (fresh; upgrade without duplicates; duplicates with and without the pre-deploy script; already applied original; already applied edited variant) |
| Checksum script against two synthetic histories | correctly reports `applied ORIGINAL text` vs `MISMATCH … applied EDITED variant` |
| Workflow static tests | 14/14: SHA pins required, negative test, pins documented, least privilege, both images scanned before push |
| Server `tsc`, build; client lint/build/vitest (13)/Playwright (2) | unchanged and passing from the previous pass |

## Findings fixed in this pass
1. **Sandbox `/tmp` unusable by the non-root user** (tmpfs mounted `0755` root-owned) → `mode=1777` with `noexec,nosuid` kept; would have broken `HOME=/tmp`/npm cache on a real host. Found only because containers were actually run.
2. **Fork-bomb test was measuring nothing** (async spawn errors counted as successes); now measures 57/200 vs 200/200 with and without `--pids-limit 64`.
3. **Migration 20261031 had been edited in place** → restored byte-for-byte; fix moved to corrective migration `20261102…` + documented pre-deploy script; hashes of all 17 shipped migrations pinned and tested. (My earlier docs also said "newest" kept; the logic keeps the **earliest** — corrected.)
4. **`aquasecurity/trivy-action@0.28.0` was not a real tag** (`v0.28.0` is), so scan steps could not have resolved; `v0.28.0` would also have left two nested actions on mutable tags. All five actions now pinned to verified commit SHAs, using trivy-action v0.36.0 whose nested actions are SHA-pinned (`docs/ACTIONS_PINS.md`).

## Not executed (each one blocks "production candidate")
| Item | Why | How to close |
|---|---|---|
| gVisor (`runsc`) | binary cannot be obtained here | install on the sandbox VM; run `npm run test:docker` with `REPAIR_SANDBOX_RUNTIME=runsc` |
| Dedicated staging sandbox VM + upstream `node:22-bookworm-slim` | cannot create VMs or pull images here | run `npm run test:docker` and `docker-runner-malicious` there; results on the stand-in prove flag behaviour on this kernel only |
| Dependency-install container, malicious `package.json`/lockfile through a real `npm ci` | no npm in the stand-in image, no registry access from containers | run on the sandbox VM; policy layer is unit-tested |
| Real GitHub: OAuth, webhook delivery + signature from github.com, replay, scan, approval, branch push, PR creation, duplicate webhooks, revoked approval, crash with a real repo | no linked GitHub account, no public URL for webhooks | throw-away repo + a GitHub OAuth App/webhook pointing at staging; follow `OPERATIONS_SECURITY.md` §11 and §13 |
| Native Prisma: `generate`, `migrate deploy`, `migrate diff`, schema and history verification, upgrade on a representative production backup | `binaries.prisma.sh` blocked (also for the WASM route) | CI `migrations` job; rehearsal per `DEPLOYMENT.md` §2a |
| Full app rehearsal (API + workers + browser + real model + GitHub) | needs the items above and an AI provider/consent | staging run; consent withdrawal, retention and deletion are covered at service level on real PostgreSQL only |
| `production` environment reviewers, branch protection | GitHub settings, not readable/settable from here | configure and screenshot in GitHub |

## Remaining vulnerabilities and limitations
- Container escape = host compromise unless gVisor/rootless/dedicated VM is used (runc shares the host kernel; seccomp default only).
- Install step has network access; registry packages are trusted at install time.
- SHA pins do not cover an action's own runtime downloads (Trivy binary/database) and the pinned code was inspected only at metadata level.
- Prompt injection and secret redaction are mitigations. OAuth `repo` scope is broad; JWTs are 1-day, no revocation; rate limiting is in-memory.
- Case D (install that applied the edited variant): behaviour of `prisma migrate deploy` with a changed checksum was not verified.
- No external penetration test.
