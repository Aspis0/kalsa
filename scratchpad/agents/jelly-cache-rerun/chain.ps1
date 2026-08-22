# Sequential covariate rerun of the three Jelly Marco cache cells.
# One cell at a time. Reuses scripts/watch_dropsweep_lfm_jelly.ps1.
# Prints ONLY cell-boundary lines (the monitor tool treats every stdout line
# as a wake). Never tails a device STATUS/log file.
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$sshArgs = @(
    '-o','BatchMode=yes','-o','StrictHostKeyChecking=no',
    '-o','UserKnownHostsFile=/dev/null','-o','ConnectTimeout=15',
    '-p','8022','u0_a225@192.168.1.82'
)
$adb = 'C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$adbSerial = '192.168.1.82:39591'
$cells = @(
    'cachesweep_marco_jelly_c1500_cov',
    'cachesweep_marco_jelly_c2000_cov',
    'cachesweep_marco_jelly_c4000_cov'
)
$chainLog = Join-Path $repo 'scratchpad\agents\jelly-cache-rerun\chain.log'

function Say([string]$m) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $chainLog -Value $line -Encoding utf8
}

function Keep-Alive {
    try {
        & $adb -s $adbSerial shell input keyevent KEYCODE_WAKEUP 2>$null | Out-Null
        & $adb -s $adbSerial shell settings put system screen_off_timeout 7200000 2>$null | Out-Null
    } catch {}
}

function Remote-Status([string]$cell) {
    $path = "/data/data/com.termux/files/home/experiments/results/$cell/STATUS.txt"
    $s = & ssh @sshArgs "cat $path 2>/dev/null | tr -d '\r\n'" 2>$null
    if ($s) { return "$s".Trim() }
    return ''
}

function Launch-Cell([string]$cell) {
    $script = @"
export PATH=/data/data/com.termux/files/usr/bin:`$PATH
export HOME=/data/data/com.termux/files/home
cd `$HOME/experiments/results/$cell || exit 9
if ps -o args 2>/dev/null | grep -qE 'run_dropsweep_jell[y]|$cell/launc[h]\.sh'; then
  echo already_running
else
  setsid nohup bash ./launch.sh >> outer.log 2>&1 < /dev/null &
  echo launch_pid=`$!
fi
"@
    $r = & ssh @sshArgs $script 2>$null
    return ($r -join ' ')
}

Keep-Alive
foreach ($cell in $cells) {
    $st = Remote-Status $cell
    if ($st -eq 'DONE') {
        Write-Output "CELL_SKIP $cell already DONE"
        Say "skip $cell already DONE"
        continue
    }
    Write-Output "CELL_START $cell status='$st'"
    Say "start $cell status='$st'"
    Keep-Alive
    $lr = Launch-Cell $cell
    Say "launch $cell -> $lr"
    & powershell.exe -NoProfile -File (Join-Path $repo 'scripts\watch_dropsweep_lfm_jelly.ps1') -CellName $cell
    $st2 = Remote-Status $cell
    if ($st2 -eq 'DONE') {
        Write-Output "CELL_DONE $cell"
        Say "done $cell"
    } else {
        Write-Output "CELL_FAIL $cell status='$st2'"
        Say "fail $cell status='$st2'"
        Write-Output 'FAILED'
        exit 1
    }
}
Write-Output 'ALL_DONE'
Say 'ALL_DONE'
exit 0
