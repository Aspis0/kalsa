# Arm the CalaQwen drop sweep: wait for the cable to come out, then start it.
#
# The measurement protocol requires UNPLUGGED (charging changes both thermals and
# the CPU governor). The phone is charging right now because CalaQwen had to be
# transferred. Rather than make the owner send a message the moment they unplug,
# this waits for the device to report UNPLUGGED and starts the cell itself.
#
# It refuses to start on a low battery: the cell is ~12 runs of a 13.4 GB streaming
# model and the harness stops at BATT_FLOOR=45, so beginning below ~85% would just
# buy a STOP_BATT halfway through.

$ErrorActionPreference = 'Continue'
$repo     = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$cellName = 'dropsweep_calaqwen_jelly'
$cell     = "/data/data/com.termux/files/home/experiments/results/$cellName"
$log      = "$repo\logs\arm-calaqwen-sweep.log"
$minBatt  = 85
$sshArgs  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=no',
              '-o','UserKnownHostsFile=/dev/null','-o','ConnectTimeout=15',
              '-p','8022','u0_a225@192.168.1.82')

function Say([string]$m) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m) -Encoding utf8
}

Say "armed: waiting for UNPLUGGED (need batt >= $minBatt) over WiFi ssh"

$waited = 0
while ($true) {
    $probe = @"
export PATH=/data/data/com.termux/files/usr/bin:`$PATH
J=`$(termux-battery-status 2>/dev/null | tr -d '\n')
echo "PLUG=`$(printf '%s' "`$J" | sed -n 's/.*"plugged": *"\([A-Z_]*\)".*/\1/p')"
echo "BATT=`$(printf '%s' "`$J" | sed -n 's/.*"percentage": *\([0-9]*\).*/\1/p')"
echo "RUNNING=`$(ps -o args 2>/dev/null | grep -c 'run_dropsweep_jell[y]')"
echo "STATUS=`$(cat $cell/STATUS.txt 2>/dev/null | tr -d '\r\n')"
"@
    $out = & ssh @sshArgs $probe 2>$null
    if ($out) {
        $kv = @{}
        foreach ($l in $out) { if ($l -match '^(\w+)=(.*)$') { $kv[$matches[1]] = $matches[2].Trim() } }
        $plug = $kv['PLUG']; $batt = $kv['BATT']; $run = $kv['RUNNING']; $st = $kv['STATUS']

        if ($run -match '^\d+$' -and [int]$run -gt 0) { Say "a harness is already running - standing down"; break }
        if ($st -eq 'DONE') { Say "cell already DONE - standing down"; break }

        if ($plug -eq 'UNPLUGGED') {
            if ($batt -match '^\d+$' -and [int]$batt -lt $minBatt) {
                Say "UNPLUGGED but battery $batt% < $minBatt% - not starting (would hit STOP_BATT mid-cell). Plug it back in."
            } else {
                Say "UNPLUGGED at $batt% - starting the CalaQwen sweep"
                $start = @"
export PATH=/data/data/com.termux/files/usr/bin:`$PATH
export HOME=/data/data/com.termux/files/home
cd $cell || exit 9
if ps -o args 2>/dev/null | grep -qE 'run_dropsweep_jell[y]|$cellName/launc[h]\.sh'; then
  echo already_running
else
  setsid nohup bash ./launch.sh >> outer.log 2>&1 < /dev/null &
  echo "started_pid=`$!"
fi
"@
                $r = & ssh @sshArgs $start 2>$null
                Say "launch result: $($r -join ' ')"
                Start-Sleep -Seconds 20
                $p = Start-Process -FilePath 'pwsh' -ArgumentList @(
                        '-NoProfile','-WindowStyle','Hidden',
                        '-File',"$repo\scripts\watch_dropsweep_lfm_jelly.ps1",
                        '-CellName',$cellName) -WindowStyle Hidden -PassThru
                Say "watchdog started pid=$($p.Id) for cell $cellName"
                break
            }
        } else {
            if ($waited % 600 -eq 0) { Say "still plugged ($plug), batt $batt% - waiting" }
        }
    } else {
        if ($waited % 600 -eq 0) { Say "phone unreachable over WiFi - waiting" }
    }
    Start-Sleep -Seconds 30
    $waited += 30
    if ($waited -gt 21600) { Say "6 h with no unplug - standing down"; break }
}
Say "arming script end"
