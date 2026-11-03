# GitHub Actions pins (supply chain)

Every third-party action in `.github/workflows/` is pinned to a **full commit SHA**, resolved from the upstream repository on 2026-11-03 (not from memory). Nothing was guessed.

| Action | Version | Commit SHA | Verification |
|---|---|---|---|
| actions/checkout | v4.4.0 | `11d5960a326750d5838078e36cf38b85af677262` | `git ls-remote --tags` (lightweight tag → commit); commit is on the official `releases/v4` branch |
| actions/setup-node | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `git ls-remote`; ancestor of default branch |
| docker/login-action | v3.7.0 | `c94ce9fb468520275223c153574b00df6fe4bcc9` | `git ls-remote`; ancestor of default branch |
| docker/setup-buildx-action | v3.12.0 | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | `git ls-remote`; ancestor of default branch |
| aquasecurity/trivy-action | v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | `git ls-remote`; cloned and inspected: ancestor of default branch; its `action.yaml` pins its own nested actions (`setup-trivy`, `actions/cache`) by SHA; all inputs the workflows use exist |

How each was verified: `git ls-remote --tags https://github.com/<owner>/<repo> refs/tags/<tag> refs/tags/<tag>^{}` (the peeled `^{}` entry is used when a tag is annotated), then a clone to confirm the commit exists, carries the tag, and is reachable from the default (or official release) branch.

Findings while doing this:
- The previous `aquasecurity/trivy-action@0.28.0` referenced a tag that does not exist upstream (the tag is `v0.28.0`), so those scan steps could not have resolved. `v0.28.0` would also have left two **nested** actions on mutable tags (`setup-trivy@v0.2.1`, `actions/cache@v4`), so `v0.36.0`, which pins its nested actions, is used instead.
- What a SHA pin does not cover: the action's own runtime downloads (for example the Trivy binary and vulnerability database) and the correctness of the pinned code, which is checked only at the metadata and `uses:` level, not audited line by line.

Updating: Dependabot (`github-actions`) opens PRs that change the SHA and the version comment. Re-run the verification above before merging a bump of `trivy-action`, `checkout` or the Docker actions, and keep the table in sync (`workflows.test.ts` fails if a pinned SHA is not listed here).
