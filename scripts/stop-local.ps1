<#
.SYNOPSIS
    Stops the RepoDoctor local development environment safely.
.DESCRIPTION
    Terminates only the application services (Backend API, Scan Worker,
    Autonomous Repair Worker, and Frontend Client) started by start-local.ps1.
    Leaves the RepoDoctor Redis container running by default for fast restarts.
    Never terminates unrelated Node.js processes or other projects' containers.
.PARAMETER StopRedis
    Also stops the RepoDoctor Redis Docker container (without deleting data).
.EXAMPLE
    .\scripts\stop-local.ps1
.EXAMPLE
    .\scripts\stop-local.ps1 -StopRedis
#>

[CmdletBinding()]
param (
    [switch]$StopRedis
)

$ErrorActionPreference = "Continue"

function Write-Header {
    param([string]$Text)
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "  [STOPPED] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] $Message" -ForegroundColor Gray
}

function Write-WarningMsg {
    param([string]$Message)
    Write-Host "  [WARN] $Message" -ForegroundColor DarkYellow
}

Write-Header "RepoDoctor - Stopping Local Development Environment"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$PidFile = Join-Path $RootDir ".repodoctor-pids.json"
$stoppedCount = 0

if (Test-Path $PidFile) {
    try {
        $tracking = Get-Content $PidFile -Raw | ConvertFrom-Json
        $services = $tracking.services

        foreach ($prop in $services.PSObject.Properties) {
            $svc = $prop.Value
            $pidToStop = $svc.pid
            $name = $svc.name

            if ($pidToStop) {
                $proc = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Info "Terminating $name (PID $pidToStop) and child processes..."
                    # taskkill /T /F terminates the process tree cleanly on Windows
                    & taskkill /PID $pidToStop /T /F 2>$null | Out-Null
                    Start-Sleep -Milliseconds 300
                    Write-Success "$name (PID $pidToStop)"
                    $stoppedCount++
                } else {
                    Write-Info "$name (PID $pidToStop) was already stopped."
                }
            }
        }
    } catch {
        Write-WarningMsg "Error reading tracking file: $_"
    } finally {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        Write-Info "Removed process tracking file."
    }
} else {
    Write-Info "No active .repodoctor-pids.json file found."
    
    # Fallback safety: Check if ports 4000 or 8080 are currently owned by RepoDoctor node processes
    $ports = @(4000, 8080)
    foreach ($p in $ports) {
        $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $owningPid = $conns[0].OwningProcess
            $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -match "node|powershell|cmd") {
                # Verify commandline belongs to RepoDoctor before terminating
                $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $owningPid" -ErrorAction SilentlyContinue
                if ($wmi -and $wmi.CommandLine -match "RepoDoctor") {
                    Write-Info "Stopping RepoDoctor process listening on port $p (PID $owningPid)..."
                    & taskkill /PID $owningPid /T /F 2>$null | Out-Null
                    Write-Success "Process on port $p (PID $owningPid)"
                    $stoppedCount++
                }
            }
        }
    }
}

# Verify ports 4000 and 8080 are released
Start-Sleep -Milliseconds 800
$remaining4000 = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
$remaining8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue

if ($remaining4000 -or $remaining8080) {
    Write-WarningMsg "One or more ports are still in LISTEN state. They may need a few seconds to close (TIME_WAIT)."
} else {
    Write-Info "Application ports (4000, 8080) successfully freed."
}

# Redis Handling
if ($StopRedis) {
    Write-Info "Stopping RepoDoctor Redis container..."
    $dcOut = docker compose stop redis 2>&1
    Write-Success "RepoDoctor Redis container stopped."
} else {
    Write-Info "RepoDoctor Redis container left running for fast subsequent startups."
    Write-Info "(Pass -StopRedis if you want to stop the Redis container as well)."
}

Write-Header "RepoDoctor Shutdown Complete"
Write-Host "All RepoDoctor local application services have been stopped safely.`n" -ForegroundColor Green
