# Evidence: server test run (all infrastructure required, nothing may skip)

Command: REQUIRE_INTEGRATION_TESTS=true REQUIRE_DOCKER_TESTS=true npx tsx --test src/tests/*.test.ts

```
ok 1 - provider created while consented sends nothing after consent is revoked
ok 2 - a queued job holding an old provider cannot bypass revoked consent
ok 3 - a transient failure retries only while consent still holds (retry rechecks consent)
ok 4 - fallback to the next provider rechecks consent too
ok 5 - consent withdrawn while a request is in flight aborts it and discards the result
ok 6 - a provider that ignores the abort signal still cannot return its result after revocation
ok 7 - self-hosted mode never builds or calls a cloud provider, and a mid-run switch is refused
ok 8 - an unreadable settings store fails closed
ok 9 - expired consent stops working
ok 10 - redaction and size limits apply to every request, including retries and fallbacks
ok 11 - default settings send nothing anywhere (safest default)
ok 12 - choosing a mode without recorded consent is refused
ok 13 - consent for an older version of the terms stops working
ok 14 - consented CLOUD / LOCAL are allowed; LOCAL never needs cloud providers
ok 15 - fails closed when the selected backend is not configured (no silent switch to the other mode)
ok 16 - no AI provider object is created without consent, and no prompt reaches a model
ok 17 - with consent, prompts are redacted before they reach the model and egress is audited without content
ok 18 - withdrawing consent (mode NONE) stops AI immediately and clears the consent record
ok 19 - enabling AI requires explicit consent for the current version in the same request
ok 20 - consent changes are written to the audit log, and a failing audit write blocks the change (fail closed)
ok 21 - an unavailable audit log blocks AI egress rather than sending unaudited data
ok 22 - retention days are clamped to a sane range
ok 23 - db helper + prisma seam work against real postgres
ok 24 - repository deletion removes every dependent row, is scoped to the owner, and is audited
ok 25 - delete-all-data wipes analysis data, withdraws the GitHub connection and consent, keeps the account
ok 26 - account deletion removes the user and everything under it
ok 27 - retention purge: expired analyses go, fresh ones stay, user retention is honoured, pending approvals are protected
ok 28 - concurrent deletes of the same repository: exactly one reports true and nothing is left over
ok 29 - concurrent claims of one repair job: the compare-and-set lets exactly one winner through
ok 30 - PullRequest uniqueness is enforced under concurrent inserts
ok 31 - schema.prisma and the migrated database agree on every table and column (no drift)
ok 32 - Docker is available when REQUIRE_DOCKER_TESTS=true
ok 33 - container: non-root, read-only rootfs, no capabilities, no new privileges
ok 34 - container: no network
ok 35 - container: host paths and the Docker socket are not visible
ok 36 - container: /tmp is noexec
ok 37 - container: pids limit stops a fork bomb; memory limit kills a runaway allocation
ok 38 - container: writes to the mounted workspace stay inside it; a symlink created inside cannot reach host files
ok 39 - hostile test script: network, host files, secrets, privilege and persistence attempts all fail
ok 40 - runaway process is killed at the timeout, reported as timed out, and the container is removed
ok 41 - memory bomb is OOM-killed within the limit and reported as failure
ok 42 - workspace with a symlink leaving the repository is refused BEFORE any container starts
ok 43 - a non-zero exit is reported as failure with output captured; secrets in the environment are not forwarded
ok 44 - dependency volumes are removed by removeDependencyVolumes (cleanup on the real daemon)
ok 45 - repository files are placed inside a nonce-delimited untrusted block
ok 46 - hostile content cannot forge the closing marker
ok 47 - sensitive files never enter a prompt even if collected
ok 48 - every model request carries the non-overridable security rules
ok 49 - if a model obeys the injection anyway, the resulting patch is rejected
ok 50 - IMMUTABILITY: every migration shipped in the original release is byte-identical to its recorded sha256
ok 51 - IMMUTABILITY: the edited variant differs from the original, and the original is restored in prisma/migrations
ok 52 - migration directory is well-formed: lock file, chronological names, no empty SQL, corrective migration is last
ok 53 - PATH 1 fresh installation: every migration applies in order; archive table exists
ok 54 - PATH 2 upgrade from the previous production schema, no duplicates: all new migrations apply, data preserved
ok 55 - PATH 3a duplicates WITHOUT the pre-deploy script: the ORIGINAL migration fails atomically and leaves the database untouched
ok 56 - PATH 3b duplicates WITH the pre-deploy script: earliest kept, others archived, then every migration applies
ok 57 - PATH 4 EXISTING install that already applied the ORIGINAL 20261031: only the new migrations run; corrective one creates the archive
ok 58 - PATH 5 EXISTING install that applied the EDITED variant: the corrective migration is an idempotent no-op; archived rows survive
ok 59 - audit trail is append-only after upgrade (UPDATE always rejected; DELETE only past the 365-day floor)
ok 60 - a failing migration leaves no partial change (all-or-nothing)
ok 61 - allowed test commands
ok 62 - arbitrary code execution through the test command is refused
ok 63 - malicious patches are rejected: paths
ok 64 - malicious patches are rejected: content and size
ok 65 - benign patches pass; removing a dangerous call is a fix, not a hazard
ok 66 - symlinks planted by a repository cannot redirect a write outside the workspace
ok 67 - applier: DELETE must match the text it claims to remove, and valid patches apply
ok 68 - successful change writes settings and exactly one audit event
ok 69 - retention-only change is audited as RETENTION_CHANGED; a no-op writes nothing
ok 70 - withdrawal is audited as CONSENT_WITHDRAWN and the mode becomes NONE
ok 71 - audit write failure rolls back the privacy settings change
ok 72 - sensitive values never reach audit rows
ok 73 - audit rows are append-only at the database level
ok 74 - audit endpoint returns only the caller's events, paginated; unauthenticated is rejected
ok 75 - deletion and its audit event commit together; a failing audit write keeps the data
ok 76 - happy path: one branch, one PR, COMPLETED, PullRequest row saved, notification states the PR
ok 77 - crash at after-claim then recovery: exactly one branch and one PR
ok 78 - crash at after-patch then recovery: exactly one branch and one PR
ok 79 - crash at after-tests then recovery: exactly one branch and one PR
ok 80 - crash at after-push-before-persist then recovery: exactly one branch and one PR
ok 81 - crash at after-branch-persisted then recovery: exactly one branch and one PR
ok 82 - crash at after-pr-created-before-persist then recovery: exactly one branch and one PR
ok 83 - crash at after-pr-persisted then recovery: exactly one branch and one PR
ok 84 - existing remote branch with identical content is reused (no second push, one PR)
ok 85 - existing remote branch with DIFFERENT content blocks publication; never overwritten
ok 86 - existing open PR for the branch is reused, never duplicated
ok 87 - a closed or merged PR is reported as such and no new PR is created
ok 88 - GitHub 5xx after the branch was pushed: retryable, message says the branch exists, retry completes with one PR
ok 89 - failing tests block publication and say nothing was pushed
ok 90 - sandbox infrastructure failure is retryable, not a verdict on the patch
ok 91 - approval revoked before publishing: nothing is pushed
ok 92 - approval revoked WHILE publishing: no branch is pushed after the revocation
ok 93 - duplicate approval requests: exactly one wins, the other gets 409
ok 94 - approval with a wrong or missing patch hash is refused (PATCH_CHANGED); the patch edited after verification cannot be approved
ok 95 - patch modified AFTER approval is never published: NEEDS_REAPPROVAL
ok 96 - base commit changed in an unrelated file: revalidated and published; in a touched file: renewed approval required
ok 97 - unauthorized user cannot publish or approve another user's repair
ok 98 - repository authorization lost since approval (no push access) blocks publication
ok 99 - recovery sweep re-queues stale publication stages with a new generation and blocks after too many attempts
ok 100 - REAL SANDBOX: the patch is re-tested in a real container (fails before, passes after) and only then pushed
ok 101 - REAL SANDBOX: a patch whose tests still fail in the container is NOT pushed
ok 102 - detects and redacts GITHUB_TOKEN
ok 103 - detects and redacts AWS_ACCESS_KEY
ok 104 - detects and redacts SLACK_TOKEN
ok 105 - detects and redacts STRIPE_KEY
ok 106 - detects and redacts API_KEY
ok 107 - detects and redacts GOOGLE_API_KEY
ok 108 - detects and redacts JWT
ok 109 - redacts PEM private keys, including a truncated block
ok 110 - redacts credential assignments in code, JSON and env style
ok 111 - does not mangle ordinary code (no false redaction of env lookups)
ok 112 - redaction report counts types but never contains the secret
ok 113 - sensitive files are recognised by path
ok 114 - guarded provider: secrets in either prompt never reach the model
ok 115 - guarded provider: oversized prompts are refused (data minimisation)
ok 116 - guarded provider: fails closed if the audit hook throws
ok 117 - workspace: absolute and relative symlinks escaping the root are rejected; internal links allowed
ok 118 - workspace: FIFOs and excessive size/depth are rejected
ok 119 - isInside handles traversal lookalikes
ok 120 - install policy: registry specs only
ok 121 - install policy: rejects git/url deps, rc files, overrides, and foreign lockfile hosts; accepts a clean project
ok 122 - sandbox config: root user, bad runtime and bad network fail closed; hardened-runtime requirement enforced
ok 123 - install container args: non-root, no caps, read-only root, limits, no host mounts beyond workspace and volume
ok 124 - gVisor runtime is passed through to both install and test containers when configured
ok 125 - test command cannot smuggle docker options or shell metacharacters into the argv
ok 126 - network is disabled and IPC is not shared
ok 127 - all capabilities dropped, no privilege escalation, read-only root, non-root user
ok 128 - CPU, memory (no swap) and PID limits are applied
ok 129 - scratch space is tmpfs with noexec; only the disposable workspace is mounted
ok 130 - no dangerous flags can appear
ok 131 - host environment is not forwarded: only explicit variables are set
ok 132 - the test command comes after the image and cannot inject docker options
ok 133 - unsafe inputs are refused
ok 134 - real container: outbound network is unreachable
ok 135 - real container: root filesystem is read-only and process is not root
ok 136 - real container: memory limit kills a runaway allocation
ok 137 - v1 format: versioned, key id recorded, AAD binds key id, no plaintext leak
ok 138 - classification of plaintext, legacy GCM, v1 and garbage
ok 139 - legacy GCM still decrypts with the current key; wrong key fails without leaking
ok 140 - old keys decrypt but are never used to encrypt; key-id reuse and bad lists are rejected
ok 141 - fail closed: production never returns plaintext; no key means no save
ok 142 - migration: plaintext and legacy rows become v1, values round-trip, dry-run changes nothing
ok 143 - rotation re-encrypts only rows under a retired key, and only with rotate
ok 144 - a row whose old key is missing is left unchanged and reported (never lost)
ok 145 - concurrent change during migration: compare-and-set refuses to clobber
ok 146 - failed post-write verification restores the original value
ok 147 - startup gate: production refuses plaintext, invalid and missing key; development only warns; counts only in messages
ok 148 - startup checks: weak, short, malformed keys and bad key ids are rejected
ok 149 - scan counts formats
ok 150 - real PostgreSQL: Prisma token store migrates representative legacy rows via CAS
ok 151 - stored token is ciphertext, never contains the plaintext, and round-trips
ok 152 - tampering, truncation and the wrong key are detected (GCM authentication)
ok 153 - without a key, saving a token FAILS rather than storing plaintext
ok 154 - plaintext opt-in works only outside production
ok 155 - a malformed key is rejected
ok 156 - a correct production configuration has no errors
ok 157 - production refuses to start with each insecure setting
ok 158 - outside production the same problems are warnings, not startup failures
ok 159 - a model saying VERIFIED cannot override a failing test run
ok 160 - timeouts and missing exit codes are INCONCLUSIVE, never VERIFIED
ok 161 - only exit code 0 without timeout stays VERIFIED; other verdicts are never upgraded
ok 162 - pre-publication gate: the stored verdict alone never authorises a pull request
ok 163 - pull request body states evidence and that nothing is auto-merged
ok 164 - only the repository owner can approve; other users and unknown ids get the same 404
ok 165 - approval requires AWAITING_APPROVAL and stored evidence
ok 166 - duplicate repair requests and duplicate pull requests are refused
ok 167 - queue job ids are deterministic so concurrent duplicates collapse
ok 168 - scheduled scans: one job per repository per interval, only when due
ok 169 - stale-job classification after a worker crash
ok 170 - retention cutoff
ok 171 - audit details are scrubbed of secrets and bounded
ok 172 - audit: failClosed rethrows, otherwise a storage failure does not break the request
ok 173 - concurrent identical deliveries against real Postgres + BullMQ: one record, exactly one job per repository
ok 174 - Redis unreachable: the delivery is durable and truthful, then recovered into the real queue
ok 175 - worker crash between DB update and queue insertion: lease expiry + deterministic job id give exactly one job
ok 176 - two concurrent claims of one delivery: exactly one winner (compare-and-set)
ok 177 - replay of a captured, validly signed delivery is acknowledged as duplicate with no new jobs
ok 178 - invalid signature creates no database row
ok 179 - legacy rows from the pre-lifecycle schema are terminal duplicates
ok 180 - happy path: durable record, both jobs queued with deterministic ids, state QUEUED
ok 181 - Redis unavailable: delivery is recorded, response is truthful (not queued), recovery completes it
ok 182 - partial repository failure: only the failed repository is retried; no duplicate job for the first
ok 183 - worker crash during processing: lease blocks others, expiry lets recovery finish exactly once
ok 184 - crash after enqueue but before the outbox row was marked: re-dispatch does not duplicate the job
ok 185 - retry of the same delivery id (GitHub redelivery) resumes a recoverable delivery and acknowledges a finished one as duplicate
ok 186 - attempt budget exhausted -> FAILED_PERMANENT and is never retried automatically
ok 187 - concurrent identical deliveries produce one record and one job per repository
ok 188 - a failed store write is never acknowledged (503) and queues nothing
ok 189 - stale events are refused; ignored events are stored so replays are acknowledged
ok 190 - legacy-claimed deliveries are terminal duplicates; purge removes only terminal rows
ok 191 - signature: valid accepted; tampered body, wrong secret, malformed header rejected
ok 192 - unsigned / badly signed requests get 401 and trigger nothing
ok 193 - missing secret configuration disables the endpoint (503)
ok 194 - a captured, correctly signed delivery cannot be replayed
ok 195 - if the replay store is down, the webhook fails closed (503) and queues nothing
ok 196 - malformed delivery ids are rejected
ok 197 - fork pull requests and non-opted-in repositories are ignored
ok 198 - accepted push queues one scan per opted-in repository, with per-repository job ids
ok 199 - negative: the detector flags the previous vulnerable pattern
ok 200 - deploy: version flows through env and is never interpolated into a shell script
ok 201 - deploy: SemVer is validated before anything else runs
ok 202 - deploy: tests gate publishing, publish uses the production environment, and both images are scanned before the push
ok 203 - deploy: least privilege — contents:read at top level; packages:write only in the publish job
ok 204 - deploy: no auto-deploy and no merge automation anywhere
ok 205 - every third-party action is pinned to a full 40-character commit SHA, with a version comment
ok 206 - negative: a tag-pinned action is rejected by the pin rule
ok 207 - pinned SHAs match the verified table in docs/ACTIONS_PINS.md
ok 208 - ci: default permissions are read-only and workflow cancels superseded runs
ok 209 - ci: integration job has real Postgres + Redis, real docker tests, and fails (not skips) when they are missing
ok 210 - ci: migrations job applies migrations and checks for drift; images are built only after tests
ok 211 - ci: dependency audit, filesystem scan and both image scans are present and blocking
ok 212 - dependabot covers npm (server, client), github-actions and docker
# tests 212
# pass 212
# fail 0
# cancelled 0
# skipped 0
```
