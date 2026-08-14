# Host orchestrator: Xiaomi t4 + screen-ON round.
# KEYCODE_WAKEUP every 60s. Cleanup screen_off_timeout=60000 even on PENDING_BATTERY.
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
  & $ADB -s $X shell $cmd
}

function Read-Batt {
  $raw = ((Adb 'dumpsys battery') | Out-String)
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

function Read-Wake {
  $w = (Adb "dumpsys power | grep mWakefulness=" | Out-String).Trim()
  return $w
}

function Pull-Logs {
  New-Item -ItemType Directory -Force -Path (Join-Path $OUT 'device_pull') | Out-Null
  & $ADB -s $X pull $DEV_LOG (Join-Path $OUT 'device_pull')
}

function Verify-Bin([string]$when) {
  $got = (Adb "sha256sum $DEV_ROOT/bin/bmoe-cli").ToString().Trim()
  Log "BIN $when $got"
  if ($got -notmatch "^$BIN_EXPECT") { throw "binary pin mismatch $when : $got" }
}

function Invoke-Cleanup([string]$why) {
  if ($cleanupDone) { return }
  $script:cleanupDone = $true
  Log "CLEANUP begin ($why)"
  try { Adb 'settings put system screen_off_timeout 60000' } catch { Log "CLEANUP timeout fail $_" }
  try { Adb 'settings put system speed_mode 0; settings put system screen_game_mode 0; settings put secure gb_boosting 0' } catch { Log "CLEANUP perf fail $_" }
  try { Adb 'svc power stayon false; am memory-factor reset' } catch { Log "CLEANUP stayon fail $_" }
  $to = ''
  $pm = ''
  try { $to = (Adb 'settings get system screen_off_timeout').ToString().Trim() } catch { $to = 'NA' }
  try { $pm = (Adb 'echo speed_mode=$(settings get system speed_mode); echo screen_game_mode=$(settings get system screen_game_mode); echo gb_boosting=$(settings get secure gb_boosting)').ToString().Trim() } catch { $pm = 'NA' }
  Log "CLEANUP screen_off_timeout=$to"
  Log "CLEANUP perf=$pm"
  Set-Content -Path (Join-Path $OUT 'cleanup.txt') -Value "why=$why`ntimeout=$to`n$pm" -Encoding ascii
  Set-Content -Path $stopWake -Value (Get-Date -Format o) -Encoding ascii
}

function Wait-Phase([string]$marker, [int]$timeoutS) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutS) {
    $exists = (Adb "test -f $DEV_LOG/$marker && echo YES || echo NO").ToString().Trim()
    $abort = (Adb "test -f $DEV_LOG/ABORT && cat $DEV_LOG/ABORT || true").ToString().Trim()
    $pending = (Adb "test -f $DEV_LOG/PENDING_BATTERY && cat $DEV_LOG/PENDING_BATTERY || true").ToString().Trim()
    $tail = (Adb "tail -3 $DEV_LOG/status.txt 2>/dev/null || true").ToString().Trim()
    $wake = ''
    try { $wake = Read-Wake } catch { $wake = 'wake-fail' }
    Log "WAIT $marker exists=$exists abort='$abort' pending='$pending' wake='$wake' status='$tail'"
    if ($pending) {
      Set-Content -Path (Join-Path $OUT 'PENDING_BATTERY') -Value $pending -Encoding ascii
      throw "PENDING_BATTERY $pending"
    }
    if ($abort) { throw "device abort: $abort" }
    if ($exists -eq 'YES') { return }
    Start-Sleep -Seconds 15
  }
  throw "timeout waiting for $marker"
}

function Start-Phase([string]$phase) {
  $wake = ''
  try { $wake = Read-Wake } catch { $wake = 'wake-fail' }
  Log "START phase=$phase wake=$wake"
  if ($wake -notmatch 'Awake') {
    Log "WAKE not Awake before $phase — KEYCODE_WAKEUP"
    Adb 'input keyevent KEYCODE_WAKEUP'
    Start-Sleep -Seconds 1
  }
  Adb "mkdir -p $DEV_LOG"
  $cmd = "cd $DEV_ROOT && export LD_LIBRARY_PATH=$DEV_ROOT/bin && nohup sh $DEV_ROOT/run_xiaomi_t4_round.sh $phase > $DEV_LOG/nohup_$phase.txt 2>&1 & echo STARTED:`$!"
  $st = (Adb $cmd).ToString().Trim()
  Log $st
}

New-Item -ItemType Directory -Force -Path $OUT | Out-Null
if (Test-Path $stopWake) { Remove-Item $stopWake -Force }

Log 'host_run begin — t4 + screen-ON round'
try {
  $b = Read-Batt
  Log ("GATE plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Plugged) { throw "plugged at start" }
  if ($b.Level -lt 45) { throw "battery $($b.Level) < 45 at start" }
  if ($b.TempC -ge 43) { throw "temp $($b.TempC) >= 43 at start" }

  Adb 'settings put system screen_off_timeout 1800000'
  $to = (Adb 'settings get system screen_off_timeout').ToString().Trim()
  Log "screen_off_timeout set=$to"
  Set-Content -Path (Join-Path $OUT 'screen_off_timeout.set') -Value $to -Encoding ascii

  Verify-Bin before
  $extm = (Adb 'getprop persist.miui.extm.enable').ToString().Trim()
  $pm = (Adb 'echo speed_mode=$(settings get system speed_mode); echo screen_game_mode=$(settings get system screen_game_mode); echo gb_boosting=$(settings get secure gb_boosting)').ToString().Trim()
  Log "extm.enable='$extm' (must be empty)"
  Log "perf-mode $pm (must be 0/0/0)"
  Adb 'am kill-all; am memory-factor set NORMAL; svc power stayon true; input keyevent KEYCODE_WAKEUP'

  Start-Phase cq_t6
  Wait-Phase PHASE_CQ_T6 1800
  Pull-Logs
  Log 'cq_t6 pulled'

  $b = Read-Batt
  Log ("post cq_t6 plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t6 level=$($b.Level)" }

  Start-Phase cq_t4
  Wait-Phase PHASE_CQ_T4 1800
  Pull-Logs
  Log 'cq_t4 pulled'

  $b = Read-Batt
  Log ("post cq_t4 plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t4 level=$($b.Level)" }

  Start-Phase cq_t4_sust
  Wait-Phase PHASE_CQ_T4_SUST 900
  Pull-Logs
  Log 'cq_t4_sust pulled'

  $b = Read-Batt
  Log ("post cq_t4_sust plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ($b.Level -lt 45) { throw "PENDING_BATTERY after cq_t4_sust level=$($b.Level)" }

  Start-Phase m1c_t4
  Wait-Phase PHASE_M1C_T4 600
  Pull-Logs
  Log 'm1c_t4 pulled'

  $b = Read-Batt
  Log ("t5 gate plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
  if ((-not $b.Plugged) -and ($b.Level -ge 55) -and ($b.TempC -lt 43)) {
    Start-Phase m1c_t5
    Wait-Phase PHASE_M1C_T5 600
  } else {
    Log 'SKIP m1c_t5 (battery/temp/plug)'
    Set-Content -Path (Join-Path $OUT 'SKIP_T5') -Value ("plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC) -Encoding ascii
  }

  Verify-Bin after
  Pull-Logs
  Adb "echo DONE > $DEV_LOG/DONE"
  Log 'host_run COMPLETE'
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
