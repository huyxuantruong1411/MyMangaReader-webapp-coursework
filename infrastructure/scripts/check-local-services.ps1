<#
.SYNOPSIS
    Checks availability of reusable local services on the host machine
    (SQL Server QL_DocTruyen, Memurai/Redis, MinIO, Backend API, Frontend Web).
#>
$ErrorActionPreference = 'Continue'

function Test-TcpPort {
    param([string]$HostName, [int]$Port, [int]$TimeoutMs = 300)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        return ($ok -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

Write-Host "=== Manga Reader Local Services Diagnostic ===" -ForegroundColor Cyan

# 1. SQL Server Service & QL_DocTruyen DB
$mssqlSvc = Get-Service -Name "MSSQLSERVER" -ErrorAction SilentlyContinue
if ($mssqlSvc -and $mssqlSvc.Status -eq "Running") {
    Write-Host "[OK]   SQL Server service (MSSQLSERVER) is Running" -ForegroundColor Green
    $dbCheck = sqlcmd -S localhost -d QL_DocTruyen -E -C -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND TABLE_NAME <> 'sysdiagrams'" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK]   Database QL_DocTruyen reachable ($($dbCheck.Trim()) user tables)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] SQL Server running, but QL_DocTruyen query failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "[INFO] SQL Server service not running (dev SQLite fallback can still be used)" -ForegroundColor Yellow
}

# 2. Memurai / Redis (6379)
if (Test-TcpPort -HostName "127.0.0.1" -Port 6379) {
    Write-Host "[OK]   Redis / Memurai listening on 127.0.0.1:6379" -ForegroundColor Green
} else {
    Write-Host "[INFO] Redis / Memurai not listening on 6379 (InMemoryCacheAdapter fallback available)" -ForegroundColor Yellow
}

# 3. MinIO (9010)
if (Test-TcpPort -HostName "127.0.0.1" -Port 9010) {
    Write-Host "[OK]   MinIO S3 API listening on 127.0.0.1:9010 (Console: 9011)" -ForegroundColor Green
} else {
    Write-Host "[INFO] MinIO not listening on 9010 (LocalDevStorageAdapter fallback available)" -ForegroundColor Yellow
}

# 4. Manga Reader API (8020) & Web (5173)
if (Test-TcpPort -HostName "127.0.0.1" -Port 8020) {
    Write-Host "[OK]   Manga Reader API listening on 127.0.0.1:8020" -ForegroundColor Green
} else {
    Write-Host "[INFO] Manga Reader API not running on 8020" -ForegroundColor DarkGray
}

if (Test-TcpPort -HostName "127.0.0.1" -Port 5173) {
    Write-Host "[OK]   Manga Reader Web listening on 127.0.0.1:5173" -ForegroundColor Green
} else {
    Write-Host "[INFO] Manga Reader Web not running on 5173" -ForegroundColor DarkGray
}
