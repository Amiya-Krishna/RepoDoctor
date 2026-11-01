# RepoDoctor AI — verified features and remaining risks

**Verdict: not yet production-ready.** The security controls below are implemented and unit-tested, but the system has **not** been run end to end (real PostgreSQL + Redis + Docker daemon + GitHub + a model) in the environment where this work was done. Do not expose it publicly until the "Not verified" list is closed.

## How this was checked

| Check | Result |
|---|---|
| New security/unit test suite (`cd server && npm test`) | 81 tests: **78 pass, 0 fail, 3 skipped** |
| Original non-DB scripts: `test:security` (updated), `test:webhook-signature`, `test:static-security`, `test:verification-gate`, `test:ai-selection`, `test:risk-engine` | pass |
| Server `tsc --noEmit` | only the 14 errors that already existed when no Prisma client can be generated (missing generated types); none introduced |
| Client `tsc -b`, `eslint`, `vite build` | clean |
| Client UI in a headless browser against a mocked API | privacy page renders; Save stays disabled until a mode is chosen *and* consent ticked; consent request carries `consent:true` and the consent version |

The 3 skipped tests are the real-container isolation checks (network unreachable, read-only root and non-root user, memory limit). They need a Docker daemon and the `node:22-bookworm-slim` image; **there was none here, so container isolation is verified only at the level of the generated `docker run` arguments**. They run automatically in CI and on any sandbox host.

## Verified by automated tests

- **Consent enforcement:** default mode sends nothing; each mode needs consent for the current terms version; outdated consent, missing backend configuration, and withdrawn consent all refuse; no provider is built and no prompt reaches a model when refused; a failing audit log blocks both consent changes and AI egress (fail closed).
- **Secret detection/redaction:** GitHub, AWS, Google, Slack, Stripe, npm, OpenAI-style, JWT, PEM (including truncated), URL credentials, bearer tokens, credential assignments (code/JSON/env). Ordinary code and `process.env.X` lookups are left intact. Redacted text is re-scanned; any remainder blocks the request. Sensitive files (`.env`, `*.pem`, `id_rsa`, …) are excluded by path.
- **Prompt injection:** repository text sits in a nonce-delimited untrusted block that cannot forge its closing marker; a fixed rules preamble is added to every request; if a model nevertheless obeys an injected instruction, the resulting patch (CI file edits, `child_process`, exfiltration via `fetch`, `package.json` scripts) is rejected. *This is mitigation: no test can prove a model will never be misled.*
- **Token encryption:** ciphertext only, round trip, tamper/wrong-key detection, fresh IV, hard failure without a key, plaintext only with an explicit non-production opt-in; production startup refuses weak/missing secrets, http origins and plaintext mode.
- **Webhooks:** valid/invalid/malformed signatures; bad signatures consume no delivery id; replay of a signed delivery rejected; store outage → 503, nothing queued; fork PRs and non-opted-in repositories ignored.
- **Command/patch safety:** `node -e`, `npx`, shells, chaining, `npm install` and similar refused; patches touching `.github`, `.git`, Dockerfiles, `.env`, lockfiles, `package.json`, escaping paths, planted symlinks (real filesystem test: the outside file stays untouched), oversize patches, secrets, and newly introduced `eval`/`child_process`/network calls refused; DELETE must match the text it removes.
- **Verification:** a model verdict of VERIFIED is downgraded unless the sandbox run exited 0 without timeout; timeouts are INCONCLUSIVE; before any push the stored verdict is not trusted and the tests must pass again on a fresh clone.
- **Authorization / duplicates:** approval only by the repository owner (other users and unknown ids get the identical 404); only `AWAITING_APPROVAL` can be approved; one live repair and one pull request per finding; deterministic queue job ids; one scheduled scan per repository per interval.
- **Recovery decisions:** stale `RUNNING`/`PUBLISHING` jobs are marked interrupted, lost approvals re-queued, healthy long jobs left alone.
- **Sandbox arguments:** `--network none`, `--ipc none`, `--cap-drop ALL`, `no-new-privileges`, read-only root, non-root user, memory (no swap)/CPU/PID/file limits, tmpfs `noexec`, only the disposable workspace mounted, no host environment forwarded, no way to inject docker options through the test command.

## Implemented but NOT verified (needs a real environment)

1. **Database behaviour.** Prisma's engines could not be downloaded in this environment, so the schema/migration (`20261031000000_privacy_security_hardening`) was never applied to a database and the Prisma code paths (controllers, lifecycle/deletion/purge, recovery, publish service, notifications, per-user repository uniqueness) were never executed. They typecheck structurally but are untested. CI's `migrations` job applies the migrations to PostgreSQL and checks for schema drift: **make it pass before merging.** Existing installs: back up first — the migration drops the global unique index on `Repository.githubId`, makes `RepairJob → Analysis` cascade, and adds a unique `(analysisId, findingId)` on `PullRequest` (duplicates in existing data would make it fail).
2. **Queues and workers end to end:** approval → publish worker → PR; crash recovery against a real killed worker; BullMQ job-id deduplication under concurrent requests.
3. **Docker isolation on a real host**, including that the new default (`--user 1000:1000`, 512 MB, 1 CPU) does not break your repositories' test runs; override with `REPAIR_SANDBOX_USER`, `REPAIR_TEST_MEMORY`, `REPAIR_TEST_CPUS`. The dependency-install step still has network access (lifecycle scripts disabled).
4. **Local-AI mode** against a real Ollama/vLLM endpoint, and **Cloud mode** against real providers.
5. **GitHub flows:** OAuth scope change, webhook delivery, real pull request creation.
6. Docker image builds, Trivy results, `npm audit` results: workflows are written, not run.

## Behaviour changes to be aware of

- AI analysis is **off for every user until they choose a mode and consent** (existing users included).
- Verified repairs no longer open pull requests automatically; the owner must approve, then tests re-run.
- Webhook scans run only for repositories with "Scan automatically" enabled.
- GitHub sign-in requests `public_repo` by default; private repositories need the explicit "allow private" button (`repo` scope). `read:user`/`user:email` are no longer requested.
- The API will not store a GitHub token without `GITHUB_TOKEN_ENCRYPTION_KEY`; production will not start without it.
- `repair-worker` was removed from the public compose file (it could only ever return INCONCLUSIVE there); run it on a dedicated sandbox host (`docs/DEPLOYMENT.md`).
- Importing the AI config no longer crashes the API when no provider key exists; the privacy gate reports it per request.

## Remaining risks

| Risk | Severity | Notes |
|---|---|---|
| Not run end to end | High | see above |
| Repository code executes on the sandbox host; a container escape reaches that host | High | use a dedicated, network-isolated VM; consider gVisor/Firecracker/rootless Docker |
| Dependency install has network access | Medium | scripts are disabled, but malicious packages can still read the workspace and call out during install |
| OAuth `repo` scope is broad | Medium | move to a GitHub App with fine-grained permissions |
| Redaction is pattern-based | Medium | unusual secret formats can slip through; sensitive-file exclusion and the "remaining secret" re-scan reduce, not remove, the risk |
| Prompt injection is mitigated, not solved | Medium | defence relies on patch policy + sandbox + human approval |
| Cloud providers' own retention is outside RepoDoctor's control | Medium | disclosed in the consent text; Self-hosted mode avoids it |
| JWTs are 1-day, no revocation; password policy minimal | Medium | pre-existing |
| In-memory rate limiting | Low–Med | per instance; use a shared store before running several API replicas |
| No token-encryption key rotation | Low–Med | |
| Test-verified ≠ correct | Inherent | a repository with weak tests can "verify" a bad fix; the report says so and a human approves |
| Static security scanner is six regexes | Low | pre-existing; not a SAST replacement |
| No external penetration test or review | — | recommended before launch |

## Suggested order to close the gaps

1. Push to a branch and get CI green (migrations, tests with Docker, client, Trivy, audit).
2. Stand up staging: PostgreSQL, Redis, API, scan worker; then a sandbox VM with the repair worker; connect a throw-away GitHub repo; walk through the seven acceptance steps.
3. Kill the repair worker mid-job and mid-publish; confirm recovery and notifications.
4. Fix whatever (1)–(3) uncover, then commission an external review.
