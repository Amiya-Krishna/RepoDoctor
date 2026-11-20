# RepoDoctor – Local Environment Automation Scripts

This folder contains the PowerShell automation scripts to start and stop the complete RepoDoctor local development environment using a single command.

---

## 1. Quick Start

### Start Everything (One Command)
Open Windows PowerShell in the project root (`F:\RepoDoctor`) and run:

```powershell
.\scripts\start-local.ps1
```

To run in the background without opening separate console windows, pass `-Headless`:

```powershell
.\scripts\start-local.ps1 -Headless
```

### Stop Everything (One Command)
```powershell
.\scripts\stop-local.ps1
```

To stop the Redis container as well:
```powershell
.\scripts\stop-local.ps1 -StopRedis
```

---

## 2. Architecture & Components Managed

When you run `.\scripts\start-local.ps1`, the script orchestrates the following:

| Component | Port / Host | Description | Started As |
|---|---|---|---|
| **Redis 7** | `127.0.0.1:6379` | BullMQ queue broker & pub/sub | Docker container (`repodoctor-redis-1`) |
| **PostgreSQL** | Cloud (Neon) / Local | Application database & migrations | Verified via Prisma probe |
| **Backend API** | `http://127.0.0.1:4000` | Node.js + Express + Socket.IO | Separate terminal window (`server`) |
| **Scan Worker** | Internal worker | BullMQ repository analysis worker | Separate terminal window (`server`) |
| **Repair Worker** | Docker sandbox | Autonomous repair & verification worker | Separate terminal window (`server`) |
| **Frontend UI** | `http://localhost:8080` | React + Vite with API & WS proxy | Separate terminal window (`client`) |

All process IDs are tracked in `.repodoctor-pids.json` (git-ignored) for safe, targeted lifecycle management.

---

## 3. First-Time Setup

Before the first run:

1. **Docker Desktop**: Ensure Docker Desktop is installed and running.
2. **Environment Files**:
   - Ensure root `.env` has `DATABASE_URL` and `REDIS_PASSWORD`.
   - Ensure `server/.env` has matching credentials and `ALLOW_INSECURE_HTTP=true`, `REPAIR_SANDBOX_HOST_OK=true`.
3. **Dependencies**:
   ```powershell
   cd server; npm install
   cd ..\client; npm install
   cd ..
   ```
4. **Database Migrations** (if not already applied):
   ```powershell
   cd server; npx prisma migrate deploy; cd ..
   ```

---

## 4. Verification & Health Checks

Once `start-local.ps1` finishes, it performs automated HTTP health and readiness checks:

- **Web Application**: Open [http://localhost:8080](http://localhost:8080)
- **API Health**: [http://127.0.0.1:4000/api/health](http://127.0.0.1:4000/api/health) (Liveness probe)
- **API Readiness**: [http://127.0.0.1:4000/api/ready](http://127.0.0.1:4000/api/ready) (Checks PostgreSQL and Redis connectivity)
- **Vite Proxy**: `http://localhost:8080/api/health` (Proxied to backend)

---

## 5. Troubleshooting Guide

### A. Port Conflicts (Ports 4000, 8080, 6379)
If a required port is in use:
- **Port 4000 or 8080**: The script detects which process owns the port and outputs its PID. Run `.\scripts\stop-local.ps1` to stop lingering RepoDoctor instances.
- **Port 6379 (Redis)**:
  - If an external container from another project (e.g. `freshkart-redis-1`) is holding port 6379, the script warns you.
  - To stop the conflicting container:
    ```powershell
    docker stop <container-name>
    ```
  - Then re-run `.\scripts\start-local.ps1`.

### B. Redis Authentication Errors (`WRONGPASS`)
- Verify that `REDIS_PASSWORD` in `server/.env` matches `REDIS_PASSWORD` in root `.env`.
- Verify that `repodoctor-redis-1` is running:
  ```powershell
  docker ps --filter "name=repodoctor-redis"
  ```
- Test authentication directly using the probe:
  ```powershell
  node server/scripts/check-redis.mjs
  ```

### C. PostgreSQL Connection Issues (`P1001` / `P2024`)
- Test database connectivity directly:
  ```powershell
  node server/scripts/check-database.mjs
  ```
- Check that `DATABASE_URL` in `server/.env` is the direct endpoint (no `-pooler`) and contains:
  `&connect_timeout=30&connection_limit=5&pool_timeout=30`

### D. Checking Running Services
To check the tracked running services at any time:
```powershell
Get-Content .repodoctor-pids.json | ConvertFrom-Json
```

To see active RepoDoctor Node processes:
```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*RepoDoctor*" }
```

---

## 6. What Happens After a Windows Restart?

1. **Docker Desktop**: Configured to launch on Windows login (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Run`).
2. **Redis Service**: Configured with `restart: unless-stopped` in `docker-compose.yml`, so Docker Desktop will automatically restart the `repodoctor-redis-1` container when Windows boots.
3. **Application Services**: Node.js services (API, workers, Vite) do not start automatically on boot. Simply run:
   ```powershell
   .\scripts\start-local.ps1
   ```
   The script will detect the already-healthy Redis container, verify database connectivity, clean up any stale PID file, and start all application services in seconds.
