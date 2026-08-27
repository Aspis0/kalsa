$ErrorActionPreference = 'Stop'

$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$stage = 'C:\q66p3b'
$launcher = Join-Path $phase 'launch-app-build-detached-v2.ps1'
$monitorLog = Join-Path $phase 'ram-monitor-v3.log'
$launcherOut = Join-Path $phase 'launcher-v3.out'
$launcherErr = Join-Path $phase 'launcher-v3.err'

function Get-RamState {
    $os = Get-CimInstance Win32_OperatingSystem
    $freeGiB = [math]::Round(([double]$os.FreePhysicalMemory * 1KB) / 1GB, 2)
    $commitPct = $null
    try {
        $commitPct = [math]::Round((Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples[0].CookedValue, 1)
    } catch {
        $total = [double]$os.TotalVirtualMemorySize
        $free = [double]$os.FreeVirtualMemory
        if ($total -gt 0) { $commitPct = [math]::Round((($total - $free) / $total) * 100, 1) }
    }
    [pscustomobject]@{ FreeGiB = $freeGiB; CommitPct = $commitPct }
}

$initial = Get-RamState
if ($initial.FreeGiB -lt 8) {
    "PRESTART_GATE=FAIL FREE_PHYSICAL_GIB=$($initial.FreeGiB) COMMIT_PCT=$($initial.CommitPct)" | Set-Content -LiteralPath $monitorLog
    exit 42
}

@(
    "START=$(Get-Date -Format o)",
    'STAGE=C:\q66p3b',
    "PRESTART_FREE_PHYSICAL_GIB=$($initial.FreeGiB)",
    "PRESTART_COMMIT_PCT=$($initial.CommitPct)",
    'MIN_FREE_PHYSICAL_GIB=3.0',
    'MAX_COMMIT_PCT=95.0',
    'INTERVAL_SECONDS=60',
    'LAUNCHER=launch-app-build-detached-v2.ps1'
) | Set-Content -LiteralPath $monitorLog

$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$launcherProc = Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$launcher) -WorkingDirectory $stage -WindowStyle Hidden -RedirectStandardOutput $launcherOut -RedirectStandardError $launcherErr -PassThru
"LAUNCHER_PID=$($launcherProc.Id)" | Add-Content -LiteralPath $monitorLog

$stoppedForSafety = $false
while (-not $launcherProc.HasExited) {
    Start-Sleep -Seconds 60
    $state = Get-RamState
    $line = "SAMPLE=$(Get-Date -Format o) FREE_PHYSICAL_GIB=$($state.FreeGiB) COMMIT_PCT=$($state.CommitPct)"
    $line | Add-Content -LiteralPath $monitorLog
    if (($state.FreeGiB -lt 3.0) -or ($state.CommitPct -gt 95.0)) {
        "SAFETY_STOP=$line" | Add-Content -LiteralPath $monitorLog
        $workers = @(Get-CimInstance Win32_Process | Where-Object {
            $_.CommandLine -match 'build-app-worker-v2\.ps1' -and $_.CommandLine -match 'q66p3b'
        })
        foreach ($worker in $workers) {
            & taskkill.exe /PID $worker.ProcessId /T /F | Add-Content -LiteralPath $monitorLog
        }
        $stoppedForSafety = $true
        break
    }
}

if ($stoppedForSafety) {
    while (-not $launcherProc.HasExited) { Start-Sleep -Seconds 2 }
}
$finalState = Get-RamState
@(
    "LAUNCHER_EXIT=$($launcherProc.ExitCode)",
    "FINAL=$(Get-Date -Format o) FREE_PHYSICAL_GIB=$($finalState.FreeGiB) COMMIT_PCT=$($finalState.CommitPct)",
    "SAFETY_STOPPED=$stoppedForSafety",
    'END='
) | Add-Content -LiteralPath $monitorLog

if ($stoppedForSafety) { exit 2 }
exit $launcherProc.ExitCode
