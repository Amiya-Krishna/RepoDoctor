# Secure production deployment

RepoDoctor runs untrusted code (the tests of repositories it analyses). The deployment is therefore split in two zones. Read "Sandbox host" before anything else.

```
Internet ── TLS proxy ──► client (nginx) ──► server (API) ──► PostgreSQL
                                   │              │
                                   │              └──► Redis (queues) ◄── scan-worker
                                   │
        PRIVATE NETWORK ONLY ──────┴──► Redis / PostgreSQL ◄── repair-worker ──► local Docker daemon ──► sandbox containers
                                                              (dedicated sandbox host)
```

## 1. Prerequisites

- A TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of the `client` service. The bundled nginx speaks plain HTTP; production **refuses to start** with a non-`https://` `FRONTEND_URL`.
- PostgreSQL 16 with TLS, Redis 7 with a password, both reachable only from private networks.
- A GitHub OAuth App (or, preferably, see "Least privilege" below) whose callback is `https://<your-host>/api/github/callback`.
- At least one of: provider keys for Cloud AI, or an OpenAI-compatible endpoint for Self-hosted AI (`LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`).

## 2. Secrets

Generate every secret randomly and keep them in your secret manager or in GitHub **environment** secrets (with required reviewers on the `production` environment), never in the repository or an image.

| Variable | How to generate | Notes |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | ≥ 32 chars, enforced at startup |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` | **Required.** Losing it makes stored GitHub tokens unreadable (users reconnect). Keep it outside the database. |
| `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 24` | same value in the GitHub webhook settings |
| `REDIS_PASSWORD` | `openssl rand -hex 24` | |

Startup checks (`server/src/config/startup-checks.ts`) abort the API and both workers in production when any of these is missing/weak, when `FRONTEND_URL` is not https, or when `ALLOW_PLAINTEXT_TOKENS` is set.

If you are upgrading an installation that stored tokens in plaintext: set the key, then run `npm run tokens:migrate` once (idempotent).

## 3. Application stack

```bash
cp .env.example .env && cp server/.env.example server/.env   # fill in real values
docker compose up --build -d      # migrate -> server, scan-worker, client
curl -fsS https://<host>/api/health   # liveness
curl -fsS https://<host>/api/ready    # database + Redis reachable
```

All services run with a read-only root filesystem, all Linux capabilities dropped and `no-new-privileges`. Only the client port is published.

## 4. Sandbox host (repair worker)

The repair worker clones repositories, installs their dependencies (network on, lifecycle scripts **off**) and runs their tests in a container with **no network**, no capabilities, a read-only root, memory/CPU/PID limits and a non-root user (`server/src/execution/docker.args.ts`).

Run it on a **dedicated VM** that holds nothing else of value:

1. Install Docker Engine and Node 22 + git; pull the image once: `docker pull node:22-bookworm-slim`.
2. Give the VM network access only to Redis, PostgreSQL, GitHub and the npm registry. Block everything else, **especially cloud metadata endpoints (169.254.169.254)** and your internal networks.
3. Run the worker as an unprivileged user in the `docker` group with the same `server/.env`: `npm ci && npm run build && node dist/workers/repair.worker.js` under systemd with `Restart=always`.
4. Never run this worker inside the public stack and never mount `/var/run/docker.sock` into any internet-facing container. The worker and the Docker daemon must share a filesystem (workspaces are bind-mounted), which is why a remote `DOCKER_HOST` does not work.

Membership of the `docker` group is root-equivalent on that VM: that is the reason for the dedicated host.

## 5. GitHub configuration

- Webhook: payload URL `https://<host>/api/github/webhook`, content type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, events: *Pushes* and *Pull requests*. Deliveries are accepted once per delivery id (replays are rejected).
- Webhook-triggered and scheduled scans run only for repositories whose owner enabled "Scan automatically" **and** whose privacy settings allow AI processing.
- **Least privilege:** users connect with `public_repo` by default; private repositories require the user to opt in to GitHub's broader `repo` scope. OAuth Apps cannot be narrower than that. A GitHub App with per-repository, fine-grained permissions (contents: write, pull requests: write, metadata: read) is the better long-term design and is listed under remaining risks.
- Protect the default branch (required reviews). RepoDoctor never merges.

## 6. CI/CD

`.github/workflows/ci.yml` runs on every pull request: typecheck and the security test suite, migrations applied to a real PostgreSQL plus a schema-drift check, client lint/build/UI tests, `npm audit`, Trivy (filesystem incl. secrets and misconfiguration, and both images). `deploy.yml` is a manual release that builds, scans and pushes images; it runs in the `production` environment, so configure required reviewers there. Rolling images out to hosts is operator-specific and not automated.

## 7. Operations

- Logs are JSON lines on stdout (`logging/logger.ts`): request id, method, path (no query string, no bodies), status, duration; secrets are scrubbed. Source code and prompts are never logged. Ship them to your log system and set retention there.
- Health: `/api/health` (liveness), `/api/ready` (readiness). Alert on `ready=false`, on queue backlog, and on audit events `AI_EGRESS_BLOCKED`, `WEBHOOK_REJECTED`, `AUTHZ_DENIED`, `PR_BLOCKED` spikes.
- Error tracking: unhandled rejections and startup failures are logged as structured errors. Attach an error tracker (for example Sentry) at the log-shipping layer if you need one; none is bundled.
- Data lifecycle: expired analyses are purged daily per each user's retention setting; audit events are kept 365 days; webhook delivery ids 7 days.
- Backups: back up PostgreSQL (it holds encrypted tokens, findings, audit log) and test restores. Redis holds only queue state.
- Rollback: images are tagged by version; migrations are forward-only, so take a database backup before deploying a release that includes one.
