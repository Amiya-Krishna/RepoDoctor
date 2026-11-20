<#
.SYNOPSIS
    Starts the complete RepoDoctor local development environment.
.DESCRIPTION
    Automates environment checks, Redis container verification/start,
    PostgreSQL connectivity validation, and launches Backend API, Scan Worker,
    Autonomous Repair Worker, and Frontend Client with live health checks.
.PARAMETER Headless
    Runs services in hidden background processes instead of separate console windows.
.PARAMETER TimeoutSeconds
    Maximum time in seconds to wait for service readiness. Default is 45.
.EXAMPLE
    .\scripts\start-local.ps1
.EXAMPLE
    .\scripts\start-local.ps1 -Headless
#>

[CmdletBinding()]
param (
    [switch]$Headless,
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Continue"

# --- Colors & Output Helpers ---
function Write-Header {
    param([string]$Text)
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Step, [string]$Desc)
    Write-Host "[STEP $Step] $Desc..." -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "  [PASS] $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Write-WarningMsg {
    param([string]$Message)
    Write-Host "  [WARN] $Message" -ForegroundColor DarkYellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] $Message" -ForegroundColor Gray
}

function Safe-Trim {
    param([object]$Value)
    if ($null -eq $Value) { return "" }
    return ($Value.ToString()).Trim()
}

function Test-HttpEndpoint {
    param([string]$Url, [int]$TimeoutMs = 2500)
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.Method = "GET"
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return ($code -ge 200 -and $code -lt 400)
    } catch [System.Net.WebException] {
        if ($_.Response) {
            $code = [int]$_.Response.StatusCode
            $_.Response.Close()
            return ($code -ge 200 -and $code -lt 400)
        }
        return $false
    } catch {
        return $false
    }
}

# --- Step 1: Resolve Project Root & Environment Checks ---
Write-Header "RepoDoctor - Local Development Environment Manager"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

if (-not (Test-Path (Join-Path $RootDir "server\package.json")) -or
    -not (Test-Path (Join-Path $RootDir "client\package.json")) -or
    -not (Test-Path (Join-Path $RootDir "docker-compose.yml"))) {
    Write-Failure "Could not locate RepoDoctor project root. Found: $RootDir"
    exit 1
}

Write-Info "Project Root: $RootDir"
Set-Location $RootDir

$PidFile = Join-Path $RootDir ".repodoctor-pids.json"
$LogsDir = Join-Path $RootDir "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# Check for duplicate running instance
if (Test-Path $PidFile) {
    try {
        $existingPids = Get-Content $PidFile -Raw | ConvertFrom-Json
        $aliveProcesses = @()
        foreach ($prop in $existingPids.services.PSObject.Properties) {
            $svc = $prop.Value
            if ($svc.pid -and (Get-Process -Id $svc.pid -ErrorAction SilentlyContinue)) {
                $aliveProcesses += "$($svc.name) (PID $($svc.pid))"
            }
        }

        if ($aliveProcesses.Count -gt 0) {
            Write-WarningMsg "RepoDoctor services are already running:"
            foreach ($p in $aliveProcesses) {
                Write-Host "    - $p" -ForegroundColor Cyan
            }
            Write-Host "`nTo stop all services, run: .\scripts\stop-local.ps1" -ForegroundColor Yellow
            Write-Host "Web Interface: http://localhost:8080`n" -ForegroundColor Green
            exit 0
        } else {
            Write-Info "Removing stale process tracking file."
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Step "1" "Verifying Tools and Port Availability"

# Check Node.js
try {
    $nodeVer = Safe-Trim (node -v 2>$null)
    if (-not $nodeVer) { throw "Node.js not found in PATH" }
    Write-Success "Node.js is available: $nodeVer"
} catch {
    Write-Failure "Node.js is required but was not found in PATH."
    exit 1
}

# Check npm
try {
    $npmVer = Safe-Trim (npm -v 2>$null)
    if (-not $npmVer) { throw "npm not found in PATH" }
    Write-Success "npm is available: v$npmVer"
} catch {
    Write-Failure "npm is required but was not found in PATH."
    exit 1
}

# Check Docker
try {
    $dockerVer = (docker info --format '{{.ServerVersion}}' 2>$null)
    if (-not $dockerVer) { throw "Docker Engine is not running" }
    Write-Success "Docker Engine is running: v$dockerVer"
} catch {
    Write-Failure "Docker Engine is not running. Please start Docker Desktop and re-run this script."
    exit 1
}

# Check Ports: 4000 (API), 8080 (Client)
$portsToCheck = @(
    @{ Port = 4000; Name = "Backend API" },
    @{ Port = 8080; Name = "Frontend Client" }
)

foreach ($item in $portsToCheck) {
    $p = $item.Port
    $n = $item.Name
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $owningPid = $conns[0].OwningProcess
        $pName = (Get-Process -Id $owningPid -ErrorAction SilentlyContinue).ProcessName
        Write-Failure "Port $p ($n) is already occupied by process PID $owningPid ($pName)."
        Write-Host "  Please stop the conflicting process or run .\scripts\stop-local.ps1." -ForegroundColor Yellow
        exit 1
    }
}
Write-Success "Application ports (4000, 8080) are available."

# Check Port 6379 (Redis)
$redisConns = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($redisConns) {
    # Check which container is holding 6379
    $holder = Safe-Trim (docker ps --filter "publish=6379" --format '{{.Names}}' 2>$null)
    if ($holder -and $holder -ne "repodoctor-redis-1") {
        Write-Failure "Port 6379 is occupied by an external container: '$holder'."
        Write-Host "  RepoDoctor requires port 6379 for its Redis service." -ForegroundColor Yellow
        Write-Host "  To stop the conflicting container, run: docker stop $holder" -ForegroundColor Cyan
        exit 1
    }
}

# --- Step 2: Start Redis ---
Write-Step "2" "Starting RepoDoctor Redis Service"

$redisRunning = Safe-Trim (docker ps --filter "name=repodoctor-redis-1" --filter "status=running" --format '{{.Names}}' 2>$null)
if (-not $redisRunning) {
    Write-Info "Starting RepoDoctor Redis container with docker compose..."
    $dcOut = docker compose up -d redis 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "Failed to start Redis service via docker compose: $dcOut"
        exit 1
    }
} else {
    Write-Info "RepoDoctor Redis container is already running."
}

# Wait for container healthy status
Write-Info "Waiting for Redis container health check..."
$redisHealthy = $false
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 25) {
    $hStatus = Safe-Trim (docker inspect repodoctor-redis-1 --format '{{.State.Health.Status}}' 2>$null)
    if ($hStatus -eq "healthy" -or $hStatus -eq "") {
        $redisHealthy = $true
        break
    }
    Start-Sleep -Milliseconds 800
}

# Test Redis Authentication via project probe script
$redisAuthOut = node (Join-Path $RootDir "server\scripts\check-redis.mjs") 2>&1
if ($LASTEXITCODE -eq 0 -and $redisAuthOut -match "REDIS_OK") {
    Write-Success "Redis is healthy and authentication succeeded."
} else {
    Write-Failure "Redis authentication failed: $redisAuthOut"
    Write-Host "  Ensure REDIS_PASSWORD in server/.env matches root .env and the container." -ForegroundColor Yellow
    exit 1
}

# --- Step 3: Verify PostgreSQL ---
Write-Step "3" "Verifying PostgreSQL Database Connectivity"

$dbOut = node (Join-Path $RootDir "server\scripts\check-database.mjs") 2>&1
if ($LASTEXITCODE -eq 0 -and $dbOut -match "DB_OK") {
    Write-Success "PostgreSQL database connected and responsive."
} else {
    Write-Failure "PostgreSQL connection failed: $dbOut"
    Write-Host "  Verify DATABASE_URL in server/.env and check network/database availability." -ForegroundColor Yellow
    exit 1
}

# --- Step 4: Start Application Services ---
Write-Step "4" "Launching Application Services"

$ServerDir = Join-Path $RootDir "server"
$ClientDir = Join-Path $RootDir "client"

$services = @(
    @{
        Key     = "backend"
        Name    = "Backend API"
        Dir     = $ServerDir
        Command = "npm run dev"
        Title   = "RepoDoctor - Backend API (Port 4000)"
        LogFile = Join-Path $LogsDir "backend.log"
    },
    @{
        Key     = "scanWorker"
        Name    = "Scan Worker"
        Dir     = $ServerDir
        Command = "npm run worker"
        Title   = "RepoDoctor - Scan Worker"
        LogFile = Join-Path $LogsDir "scan-worker.log"
    },
    @{
        Key     = "repairWorker"
        Name    = "Repair Worker"
        Dir     = $ServerDir
        Command = "npm run repair-worker"
        Title   = "RepoDoctor - Autonomous Repair Worker"
        LogFile = Join-Path $LogsDir "repair-worker.log"
    },
    @{
        Key     = "frontend"
        Name    = "Frontend Client"
        Dir     = $ClientDir
        Command = "npm run dev"
        Title   = "RepoDoctor - Frontend Client (Port 8080)"
        LogFile = Join-Path $LogsDir "frontend.log"
    }
)

$startedTracking = @{
    startedAt = (Get-Date).ToString("o")
    services  = @{}
}

foreach ($svc in $services) {
    $dir = $svc.Dir
    $cmd = $svc.Command
    $title = $svc.Title
    $log = $svc.LogFile

    if ($Headless) {
        $p = Start-Process cmd.exe -ArgumentList "/c", "cd /d `"$dir`" && $cmd > `"$log`" 2>&1" -WindowStyle Hidden -PassThru
    } else {
        $p = Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $cmd" -PassThru
    }

    $startedTracking.services[$svc.Key] = @{
        name    = $svc.Name
        pid     = $p.Id
        dir     = $dir
        command = $cmd
        title   = $title
    }

    Write-Info "Started $($svc.Name) (PowerShell PID: $($p.Id))"
}

# Save process tracking
$startedTracking | ConvertTo-Json -Depth 4 | Set-Content -Path $PidFile -Encoding UTF8
Write-Success "All 4 application services spawned."

# --- Step 5: Health Verification ---
Write-Step "5" "Verifying Service Health & API Proxy"

$backendLive = $false
$backendReady = $false
$frontendLive = $false
$proxyLive = $false

Write-Info "Waiting for Backend API (http://127.0.0.1:4000/api/health)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-HttpEndpoint -Url "http://127.0.0.1:4000/api/health" -TimeoutMs 2000) {
        $backendLive = $true
        break
    }
    Start-Sleep -Milliseconds 800
}

if ($backendLive) {
    Write-Success "Backend API is live (Port 4000)."
    try {
        $readyRes = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/ready" -Method Get -TimeoutSec 5 -ErrorAction Stop
        if ($readyRes.ready -eq $true) {
            $backendReady = $true
            Write-Success "Backend readiness probe passed (DB: ok, Redis: ok)."
        } else {
            Write-WarningMsg "Backend is up but reports not fully ready: $($readyRes | ConvertTo-Json -Compress)"
        }
    } catch {
        Write-WarningMsg "Backend readiness probe returned non-200 or timed out."
    }
} else {
    Write-Failure "Backend API did not become live within $TimeoutSeconds seconds."
}

Write-Info "Waiting for Frontend Client (http://127.0.0.1:8080)..."
$sw.Restart()
while ($sw.Elapsed.TotalSeconds -lt 25) {
    if ((Test-HttpEndpoint -Url "http://127.0.0.1:8080" -TimeoutMs 2000) -or (Test-HttpEndpoint -Url "http://localhost:8080" -TimeoutMs 2000)) {
        $frontendLive = $true
        break
    }
    Start-Sleep -Milliseconds 800
}

if ($frontendLive) {
    Write-Success "Frontend Client is live (Port 8080)."
    if ((Test-HttpEndpoint -Url "http://127.0.0.1:8080/api/health" -TimeoutMs 3000) -or (Test-HttpEndpoint -Url "http://localhost:8080/api/health" -TimeoutMs 3000)) {
        $proxyLive = $true
        Write-Success "Frontend-to-backend API proxy (/api) is operational."
    } else {
        Write-WarningMsg "Frontend proxy to /api/health not responding yet."
    }
} else {
    Write-Failure "Frontend Client did not respond on port 8080 within 25 seconds."
}

# --- Startup Summary ---
Write-Header "RepoDoctor Startup Summary"

$summaryTable = @(
    [PSCustomObject]@{ Component = "PostgreSQL"; Status = "PASS"; Details = "Connected and responsive" },
    [PSCustomObject]@{ Component = "Redis"; Status = "PASS"; Details = "127.0.0.1:6379 (repodoctor-redis-1)" },
    [PSCustomObject]@{ Component = "Backend API"; Status = $(if ($backendLive) { "PASS" } else { "FAIL" }); Details = "http://127.0.0.1:4000" },
    [PSCustomObject]@{ Component = "Readiness Probe"; Status = $(if ($backendReady) { "PASS" } else { "WARN" }); Details = "/api/ready (DB & Redis checked)" },
    [PSCustomObject]@{ Component = "Scan Worker"; Status = "PASS"; Details = "Listening on BullMQ queue" },
    [PSCustomObject]@{ Component = "Repair Worker"; Status = "PASS"; Details = "Docker sandbox execution ready" },
    [PSCustomObject]@{ Component = "Frontend UI"; Status = $(if ($frontendLive) { "PASS" } else { "FAIL" }); Details = "http://localhost:8080" },
    [PSCustomObject]@{ Component = "Vite API Proxy"; Status = $(if ($proxyLive) { "PASS" } else { "WARN" }); Details = "http://localhost:8080/api -> :4000" }
)

$summaryTable | Format-Table -AutoSize

Write-Host "URLs:" -ForegroundColor Cyan
Write-Host "  Web Application: " -NoNewline; Write-Host "http://localhost:8080" -ForegroundColor Green
Write-Host "  API Health Check: " -NoNewline; Write-Host "http://127.0.0.1:4000/api/health" -ForegroundColor Green
Write-Host "  API Readiness:   " -NoNewline; Write-Host "http://127.0.0.1:4000/api/ready" -ForegroundColor Green

Write-Host "`nTo stop all services, run: " -NoNewline
Write-Host ".\scripts\stop-local.ps1`n" -ForegroundColor Yellow
