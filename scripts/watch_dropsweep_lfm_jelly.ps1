# Watchdog for the LFM2.5 drop sweep on Jelly Star.
#
# The v1 sweep died at 11/12 runs and lost the cell because nothing restarted it.
# v2 of the device script resumes from runs.csv, so a death costs exactly one run
# -- but only if something relaunches it. That is this script's whole job.
#
# It relaunches ONLY when the harness died without a terminal verdict. A protocol
# stop (STOP_BATT, STOP_PLUGGED, STOP_API) is a decision the cell made about the
# physical state of the device, and restarting through it would silently produce
# data the protocol forbids. Those are reported, not overridden.
#
# Hardened 2026-08-17 after a hostile audit found three real gaps:
#   - a HUNG engine was invisible: `kill -0` keeps the harness "alive" forever, so
#     ALIVE=1 was never questioned and the night would burn doing nothing. The
#     heartbeat is now a liveness input, not just a log decoration.
#   - ssh dying (which happened tonight) produced an identical log line every 5
#     minutes with no escalation and nothing a human would see in the morning.
#   - the on-device duplicate guard grepped only the exec'd target, so during
#     launch.sh's ~1-2 s pre-exec window a second harness could still be started.

# The cell is a parameter: the same watchdog serves the LFM2.5 and CalaQwen sweeps,
# which share one device and one harness. Two edited copies would drift apart, and
# the copy that drifted would be the one running unattended.
param(
    [string]$CellName = 'dropsweep_lfm_jelly'
)

$ErrorActionPreference = 'Continue'
$sshArgs = @(
    '-o','BatchMode=yes','-o','StrictHostKeyChecking=no',
    '-o','UserKnownHostsFile=/dev/null','-o','ConnectTimeout=15',
    '-p','8022','u0_a225@192.168.1.82'
)
$cell    = "/data/data/com.termux/files/home/experiments/results/$CellName"
$repo    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$log     = "$repo\logs\watch-$CellName.log"
$alertF  = "$repo\logs\JELLY-ALERT.txt"
$intervalSec  = 300
$maxRelaunch  = 12
$relaunched   = 0
$unreachable  = 0
# A run is cold reset + <=120 s cooldown + ~60 s generation. 900 s is ~4x the
# longest legitimate gap between heartbeats, so a stale beat past this means the
# engine is wedged, not busy.
$staleBeatSec = 900

$terminal = @('DONE','STOP_VOID','STOP_BATT','STOP_PLUGGED','STOP_API',
              'FAIL_BIN','FAIL_MODEL','FAIL_PROMPT','FAIL_FADV','FAIL_API','FAIL_SMOKE','FAIL_CPUSET')

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
}
function Alert([string]$m) {
    Say "ALERT: $m"
    Set-Content -Path $alertF -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m) -Encoding utf8
}

function Push-Harness() {
    # Push the current local harness before relaunching. Without this a fix made
    # on the PC never reaches the phone and the watchdog faithfully restarts the
    # same script into the same death. Returns $true only if the sha matches.
    $scpArgs = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=no',
                 '-o','UserKnownHostsFile=/dev/null','-o','ConnectTimeout=15','-P','8022')
    $null = & scp @scpArgs "$repo\scripts\run_dropsweep_jelly.sh" `
                 "u0_a225@192.168.1.82:experiments/scripts/run_dropsweep_jelly.sh" 2>$null
    $null = & scp @scpArgs "$repo\results\$CellName\launch.sh" `
                 "u0_a225@192.168.1.82:experiments/results/$CellName/launch.sh" 2>$null
    $shaLocal  = (Get-FileHash "$repo\scripts\run_dropsweep_jelly.sh" -Algorithm SHA256).Hash.Substring(0,16).ToLower()
    $shaRemote = ((& ssh @sshArgs "sha256sum ~/experiments/scripts/run_dropsweep_jelly.sh | cut -c1-16" 2>$null) -join '').Trim()
    if ($shaRemote -ne $shaLocal) {
        Say "ABORT relaunch: harness sha mismatch after scp (local=$shaLocal remote='$shaRemote') - not starting a cell with an unknown script"
        return $false
    }
    Say "harness pushed and verified sha=$shaLocal"
    return $true
}

function Relaunch([string]$why) {
    if (-not (Push-Harness)) { return }
    # Re-check liveness ON THE DEVICE immediately before launching; the probe is
    # up to 15 s stale over the network, this guard is not. It must match BOTH the
    # exec'd harness AND launch.sh itself: `exec` only happens after the env
    # exports and termux-api-start, so for ~1-2 s a starting harness is visible
    # only as `bash ./launch.sh`.
    $rl = @"
export PATH=/data/data/com.termux/files/usr/bin:`$PATH
export HOME=/data/data/com.termux/files/home
cd $cell || exit 9
if ps -o args 2>/dev/null | grep -qE 'run_dropsweep_jell[y]|$CellName/launc[h]\.sh'; then
  echo "relaunch_aborted_still_running"
else
  setsid nohup bash ./launch.sh >> outer.log 2>&1 < /dev/null &
  echo "relaunch_pid=`$!"
fi
"@
    $r = & ssh @sshArgs $rl 2>$null
    Say "relaunch ($why) result: $($r -join ' ')"
}

Say "watchdog start interval=${intervalSec}s maxRelaunch=$maxRelaunch staleBeat=${staleBeatSec}s"

while ($true) {
    # One round trip: liveness, status, row count, battery, heartbeat AGE.
    # Age is computed on the device so no timezone parsing can get it wrong.
    $probe = @"
export PATH=/data/data/com.termux/files/usr/bin:`$PATH
export HOME=/data/data/com.termux/files/home
echo "ALIVE=`$(ps -o args 2>/dev/null | grep -cE 'run_dropsweep_jell[y]')"
echo "STARTING=`$(ps -o args 2>/dev/null | grep -cE '$CellName/launc[h]\.sh')"
echo "STATUS=`$(cat $cell/STATUS.txt 2>/dev/null | tr -d '\r\n')"
echo "ROWS=`$(tail -n +2 $cell/runs.csv 2>/dev/null | grep -c ',0,ok$')"
echo "TOTROWS=`$(tail -n +2 $cell/runs.csv 2>/dev/null | wc -l)"
echo "BEAT=`$(cat $cell/HEARTBEAT.txt 2>/dev/null | tr -d '\r\n')"
echo "BEATAGE=`$(if [ -f $cell/HEARTBEAT.txt ]; then echo `$(( `$(date +%s) - `$(stat -c %Y $cell/HEARTBEAT.txt) )); else echo -1; fi)"
echo "BATT=`$(termux-battery-status 2>/dev/null | tr -d '\n' | sed -n 's/.*"percentage": *\([0-9]*\).*/\1/p')"
"@
    $out = & ssh @sshArgs $probe 2>$null

    if (-not $out) {
        $unreachable++
        $mins = $unreachable * $intervalSec / 60
        # Escalate once at 15 min, then only every 30 min, so the log stays readable
        # but a human reading it in the morning cannot miss that the phone went away.
        if ($unreachable -eq 3) {
            Alert @"
JELLY UNREACHABLE for $mins min. Port 8022 refuses while the phone still answers ping,
which means Android killed the whole Termux process group (sshd AND the sweep), not just
the network. There is no adb channel to this phone, so nothing here can fix it remotely.

TO RECOVER (30 seconds, on the phone):
  1. Open the Termux app. That alone usually brings sshd back via Termux:Boot.
     If not, type:  sshd
  2. Nothing else. This watchdog probes every 5 min, will push the current harness,
     and resumes the cell at the first unfinished run - completed runs are never redone.

TO STOP IT HAPPENING AGAIN (one-time, Android settings):
  Settings > Apps > Termux > Battery > Unrestricted. The harness now keeps a pulse
  during cooldowns (that is when both deaths happened), but battery optimisation can
  still kill the app group.
"@
        } elseif ($unreachable -gt 3 -and ($unreachable % 6) -eq 0) {
            Say "still unreachable after $mins min"
        } else {
            Say "unreachable (ssh gave nothing) - retry next cycle"
        }
        Start-Sleep -Seconds $intervalSec
        continue
    }
    if ($unreachable -gt 0) {
        Say "phone reachable again after $($unreachable * $intervalSec / 60) min"
        Remove-Item $alertF -ErrorAction SilentlyContinue
        $unreachable = 0
    }

    $kv = @{}
    foreach ($l in $out) { if ($l -match '^(\w+)=(.*)$') { $kv[$matches[1]] = $matches[2].Trim() } }
    $aliveRaw = $kv['ALIVE']
    $alive = 0
    if ($aliveRaw -match '^\d+$') { $alive = [int]$aliveRaw }
    $starting = 0
    if ($kv['STARTING'] -match '^\d+$') { $starting = [int]$kv['STARTING'] }
    $beatAge = -1
    if ($kv['BEATAGE'] -match '^-?\d+$') { $beatAge = [int]$kv['BEATAGE'] }
    $status = $kv['STATUS']
    Say ("alive=$alive starting=$starting status='$status' good_rows=" + $kv['ROWS'] + " tot_rows=" + $kv['TOTROWS'] +
         " batt=" + $kv['BATT'] + " beat_age=${beatAge}s beat='" + $kv['BEAT'] + "'")

    if ($terminal -contains $status) {
        Say "terminal status '$status' - watchdog exits"
        if ($status -ne 'DONE') { Alert "cell ended with status '$status' (good rows: $($kv['ROWS']) of 12)" }
        break
    }

    # A missing/garbled ALIVE field is NOT evidence of death. Relaunching on a bad
    # probe is how a duplicate harness gets started on top of a healthy one, which
    # corrupts the cell it was meant to save.
    if (-not ($aliveRaw -match '^\d+$')) { Say "probe incomplete (ALIVE='$aliveRaw') - no action"; Start-Sleep -Seconds $intervalSec; continue }

    if ($alive -gt 1) {
        Alert "ALIVE=$alive - MORE THAN ONE HARNESS on the phone. Not relaunching; rows written from here on may be from concurrent runs that polluted each other's cold state."
        Start-Sleep -Seconds $intervalSec
        continue
    }

    if ($alive -eq 0 -and $starting -gt 0) {
        Say "harness is in launch.sh pre-exec window - not relaunching"
        Start-Sleep -Seconds $intervalSec
        continue
    }

    if ($alive -eq 0) {
        if ($relaunched -ge $maxRelaunch) { Alert "harness died again but the relaunch budget ($maxRelaunch) is spent - giving up with $($kv['ROWS']) of 12 rows"; break }
        $relaunched++
        Say "DEAD with non-terminal status '$status' - relaunch #$relaunched (resume skips completed runs)"
        Relaunch "died"
    }
    elseif ($beatAge -ge 0 -and $beatAge -gt $staleBeatSec) {
        # ALIVE but not beating: the engine is wedged. `kill -0` would keep this
        # harness "alive" until morning, so the resume logic never gets a chance.
        # Killing it is safe: a wedged label has no excluded=0 row, so resume
        # re-runs exactly that label and nothing else.
        if ($relaunched -ge $maxRelaunch) { Alert "harness appears hung (beat ${beatAge}s old) and the relaunch budget is spent - giving up"; break }
        $relaunched++
        Alert "harness HUNG: alive but heartbeat is ${beatAge}s old (> ${staleBeatSec}s). Killing and resuming (relaunch #$relaunched)."
        $null = & ssh @sshArgs "export PATH=/data/data/com.termux/files/usr/bin:`$PATH; pkill -f 'run_dropsweep_jelly.sh'; pkill -f 'bmoe-cli'; sleep 3; echo killed" 2>$null
        Relaunch "hung"
    }

    Start-Sleep -Seconds $intervalSec
}
Say "watchdog end"
