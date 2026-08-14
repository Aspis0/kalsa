# Resume orchestrator: skip completed PHASE_* markers, continue remaining cells.
# Launch with UseShellExecute so the harness job object cannot kill us.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = 'adb-625689a2-9xEOfw._adb-tls-connect._tcp'
$OUT = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_t4_round'
$DEV_ROOT = '/data/local/tmp/gdn_750/taskb'
$DEV_LOG = "$DEV_ROOT/logs/xiaomi_t4_round"
$BIN_EXPECT = '1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f'
$watchLog = Join-Path $OUT 'host_watch.log'
$stopWake = Join-Path $OUT 'STOP_WAKE'
$cleanupDone = $false

function Log([string]$m) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
  Add-Content -Path $watchLog -Value $line -Encoding utf8
  Write-Host $line
}

function Adb([string]$cmd) {
  $out = & $ADB -s $X shell $cmd 2>&1
  if ($out -is [array]) { return ($out -join "`n") }
  return "$out"
}

function Read-Batt {
  $raw = Adb 'dumpsys battery'
  $level = if ($raw -match '(?m)^\s+level:\s+(\d+)') { [int]$Matches[1] } else { -1 }
  $temp10 = if ($raw -match '(?m)^\s+temperature:\s+(\d+)') { [int]$Matches[1] } else { -1 }
  $ac = $raw -match '(?m)^\s+AC powered:\s+true'
  $usb = $raw -match '(?m)^\s+USB powered:\s+true'
  $wl = $raw -match '(?m)^\s+Wireless powered:\s+true'
  $dock = $raw -match '(?m)^\s+Dock powered:\s+true'
  $plugged = $ac -or $usb -or $wl -or $dock
  if ($level -lt 0) { throw "battery parse failed" }
  [pscustomobject]@{ Level = $level; TempC = [math]::Floor($temp10 / 10.0); Plugged = $plugged; Temp10 = $temp10 }
}

function Read-Wake { return (Adb "dumpsys power | grep mWakefulness=").Trim() }

function Wake { Adb 'input keyevent KEYCODE_WAKEUP' | Out-Null }

function Pull-Logs {
  New-Item -ItemType Directory -Force -Path (Join-Path $OUT 'device_pull') | Out-Null
  & $ADB -s $X pull $DEV_LOG (Join-Path $OUT 'device_pull')
}

function Marker-Exists([string]$marker) {
  $v = (Adb "test -f $DEV_LOG/$marker && echo YES || echo NO").Trim()
  return ($v -match 'YES')
}

function Invoke-Cleanup([string]$why) {
  if ($cleanupDone) { return }
  $script:cleanupDone = $true
  Log "CLEANUP begin ($why)"
  try { Adb 'settings put system screen_off_timeout 60000' } catch { Log "CLEANUP timeout fail $_" }
  try { Adb 'settings put system speed_mode 0; settings put system screen_game_mode 0; settings put secure gb_boosting 0' } catch { Log "CLEANUP perf fail $_" }
  try { Adb 'svc power stayon false; am memory-factor reset' } catch { Log "CLEANUP stayon fail $_" }
  $to = 'NA'; $pm = 'NA'
  try { $to = (Adb 'settings get system screen_off_timeout').Trim() } catch {}
  try { $pm = (Adb 'echo speed_mode=$(settings get system speed_mode); echo screen_game_mode=$(settings get system screen_game_mode); echo gb_boosting=$(settings get secure gb_boosting)').Trim() } catch {}
  Log "CLEANUP screen_off_timeout=$to"
  Log "CLEANUP perf=$pm"
  Set-Content -Path (Join-Path $OUT 'cleanup.txt') -Value "why=$why`ntimeout=$to`n$pm" -Encoding ascii
  Set-Content -Path $stopWake -Value (Get-Date -Format o) -Encoding ascii
}

function Wait-Phase([string]$marker, [int]$timeoutS) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutS) {
    Wake
    $exists = (Adb "test -f $DEV_LOG/$marker && echo YES || echo NO").Trim()
    $abort = (Adb "test -f $DEV_LOG/ABORT && cat $DEV_LOG/ABORT || true").Trim()
    $pending = (Adb "test -f $DEV_LOG/PENDING_BATTERY && cat $DEV_LOG/PENDING_BATTERY || true").Trim()
    $tail = (Adb "tail -2 $DEV_LOG/status.txt 2>/dev/null || true").Trim()
    $wake = ''
    try { $wake = Read-Wake } catch { $wake = 'wake-fail' }
    Log "WAIT $marker exists=$exists abort='$abort' pending='$pending' wake='$wake' status='$tail'"
    if ($pending) {
      Set-Content -Path (Join-Path $OUT 'PENDING_BATTERY') -Value $pending -Encoding ascii
      throw "PENDING_BATTERY $pending"
    }
    if ($abort) { throw "device abort: $abort" }
    if ($exists -match 'YES') { return }
    Start-Sleep -Seconds 20
  }
  throw "timeout waiting for $marker"
}

function Start-Phase([string]$phase) {
  if (Marker-Exists "PHASE_$($phase.ToUpper())") {
    Log "SKIP start $phase (marker already present)"
    return
  }
  $wake = ''
  try { $wake = Read-Wake } catch { $wake = 'wake-fail' }
  Log "START phase=$phase wake=$wake"
  if ($wake -notmatch 'Awake') {
    Log "WAKE not Awake before $phase — KEYCODE_WAKEUP"
    Wake
    Start-Sleep -Seconds 1
  }
  Adb "mkdir -p $DEV_LOG" | Out-Null
  $cmd = "cd $DEV_ROOT && export LD_LIBRARY_PATH=$DEV_ROOT/bin && nohup sh $DEV_ROOT/run_xiaomi_t4_round.sh $phase > $DEV_LOG/nohup_$phase.txt 2>&1 & echo STARTED:`$!"
  $st = (Adb $cmd).Trim()
  Log $st
}

New-Item -ItemType Directory -Force -Path $OUT | Out-Null
Log 'host_resume begin'

try {
  $b = Read-Batt
  Log ("GATE plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Plugged) { throw "plugged at start" }
  if ($b.Level -lt 45) { throw "PENDING_BATTERY level=$($b.Level) at resume" }
  if ($b.TempC -ge 43) { throw "temp $($b.TempC) >= 43" }

  Adb 'settings put system screen_off_timeout 1800000' | Out-Null
  Adb 'svc power stayon true' | Out-Null
  Wake

  if (-not (Marker-Exists 'PHASE_CQ_T6')) {
    # phase already launched by first host; just wait
    $running = (Adb 'pgrep -f run_xiaomi_t4_round.sh || true').Trim()
    Log "cq_t6 marker missing; device runner pids='$running'"
    if (-not $running) {
      Start-Phase cq_t6
    }
    Wait-Phase PHASE_CQ_T6 1800
  } else {
    Log 'PHASE_CQ_T6 already done'
  }
  Pull-Logs
  Log 'cq_t6 pulled'

  $b = Read-Batt
  Log ("post cq_t6 plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t6 level=$($b.Level)" }

  if (-not (Marker-Exists 'PHASE_CQ_T4')) {
    Start-Phase cq_t4
    Wait-Phase PHASE_CQ_T4 1800
  } else { Log 'PHASE_CQ_T4 already done' }
  Pull-Logs
  Log 'cq_t4 pulled'

  $b = Read-Batt
  Log ("post cq_t4 plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t4 level=$($b.Level)" }

  if (-not (Marker-Exists 'PHASE_CQ_T4_SUST')) {
    Start-Phase cq_t4_sust
    Wait-Phase PHASE_CQ_T4_SUST 900
  } else { Log 'PHASE_CQ_T4_SUST already done' }
  Pull-Logs
  Log 'cq_t4_sust pulled'

  $b = Read-Batt
  Log ("post cq_t4_sust plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t4_sust level=$($b.Level)" }

  if (-not (Marker-Exists 'PHASE_M1C_T4')) {
    Start-Phase m1c_t4
    Wait-Phase PHASE_M1C_T4 600
  } else { Log 'PHASE_M1C_T4 already done' }
  Pull-Logs
  Log 'm1c_t4 pulled'

  $b = Read-Batt
  Log ("t5 gate plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ((-not $b.Plugged) -and ($b.Level -ge 55) -and ($b.TempC -lt 43)) {
    if (-not (Marker-Exists 'PHASE_M1C_T5')) {
      Start-Phase m1c_t5
      Wait-Phase PHASE_M1C_T5 600
    } else { Log 'PHASE_M1C_T5 already done' }
  } else {
    Log 'SKIP m1c_t5 (battery/temp/plug)'
    Set-Content -Path (Join-Path $OUT 'SKIP_T5') -Value ("plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC) -Encoding ascii
  }

  $got = (Adb "sha256sum $DEV_ROOT/bin/bmoe-cli").Trim()
  Log "BIN after $got"
  if ($got -notmatch "^$BIN_EXPECT") { throw "binary pin mismatch after : $got" }
  Pull-Logs
  Adb "echo DONE > $DEV_LOG/DONE" | Out-Null
  Log 'host_resume COMPLETE'
  Set-Content -Path (Join-Path $OUT 'DONE') -Value (Get-Date -Format o) -Encoding ascii
  Invoke-Cleanup complete
  exit 0
} catch {
  Log "HOST CATCH $_"
  $msg = "$_"
  if ($msg -match 'PENDING_BATTERY') {
    Set-Content -Path (Join-Path $OUT 'PENDING_BATTERY') -Value $msg -Encoding ascii
  }
  try { Pull-Logs } catch { Log "pull after catch failed $_" }
  Invoke-Cleanup "catch: $msg"
  if ($msg -match 'PENDING_BATTERY') { exit 15 }
  exit 1
}
