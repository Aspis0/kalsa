# Lightweight completion watcher. Prints ONLY DONE/FAILED/CANCELLED.
$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\mellum2_dropcurve"
$pidFile = Join-Path $root "orchestrator.pid"
$statusFile = Join-Path $root "STATUS.txt"
$deadline = (Get-Date).AddHours(30)

function Get-OrchPid {
    if (Test-Path $pidFile) {
        $t = (Get-Content $pidFile -Raw).Trim()
        if ($t -match '^\d+$') { return [int]$t }
    }
    return $null
}

while ((Get-Date) -lt $deadline) {
    $st = ""
    if (Test-Path $statusFile) { $st = Get-Content $statusFile -Raw -ErrorAction SilentlyContinue }
    if ($st -match 'DONE DROPCURVE_') {
        Write-Output "DONE"
        exit 0
    }
    if ($st -match 'STOP after') {
        Write-Output "FAILED"
        exit 1
    }
    $oid = Get-OrchPid
    $alive = $false
    if ($oid) {
        $alive = [bool](Get-Process -Id $oid -ErrorAction SilentlyContinue)
    }
    if (-not $alive) {
        Start-Sleep -Seconds 15
        if (Test-Path $statusFile) { $st = Get-Content $statusFile -Raw -ErrorAction SilentlyContinue }
        if ($st -match 'DONE DROPCURVE_') { Write-Output "DONE"; exit 0 }
        Write-Output "FAILED"
        exit 1
    }
    Start-Sleep -Seconds 120
}
Write-Output "FAILED"
exit 1
