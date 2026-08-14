# Host orchestrator: wait UNPLUGGED>=55% (5 min poll, 3h window), then run cells.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = 'adb-625689a2-9xEOfw._adb-tls-connect._tcp'
$OUT = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco1c_xiaomi'
$DEV_ROOT = '/data/local/tmp/gdn_750/taskb'
$DEV_LOG = "$DEV_ROOT/logs/marco1c_xiaomi"
$BIN_EXPECT = '1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f'
$POLL_S = 300
$WINDOW_S = 10800
$pollCsv = Join-Path $OUT 'battery_poll.csv'
$watchLog = Join-Path $OUT 'host_watch.log'

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

function Pull-Logs {
  New-Item -ItemType Directory -Force -Path (Join-Path $OUT 'device_pull') | Out-Null
  & $ADB -s $X pull $DEV_LOG (Join-Path $OUT 'device_pull')
}

function Verify-Bin([string]$when) {
  $got = (Adb "sha256sum $DEV_ROOT/bin/bmoe-cli").ToString().Trim()
  Log "BIN $when $got"
  if ($got -notmatch "^$BIN_EXPECT") { throw "binary pin mismatch $when : $got" }
}

function Wait-Phase([string]$marker, [int]$timeoutS) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutS) {
    $exists = (Adb "test -f $DEV_LOG/$marker && echo YES || echo NO").ToString().Trim()
    $abort = (Adb "test -f $DEV_LOG/ABORT && cat $DEV_LOG/ABORT || true").ToString().Trim()
    $tail = (Adb "tail -3 $DEV_LOG/status.txt 2>/dev/null || true").ToString().Trim()
    Log "WAIT $marker exists=$exists abort='$abort' status='$tail'"
    if ($abort) { throw "device abort: $abort" }
    if ($exists -eq 'YES') { return }
    Start-Sleep -Seconds 15
  }
  throw "timeout waiting for $marker"
}

function Start-Phase([string]$phase) {
  Log "START phase=$phase"
  Adb "mkdir -p $DEV_LOG"
  $cmd = "cd $DEV_ROOT && export LD_LIBRARY_PATH=$DEV_ROOT/bin && nohup sh $DEV_ROOT/run_marco1c_xiaomi.sh $phase > $DEV_LOG/nohup_$phase.txt 2>&1 & echo STARTED:`$!"
  $st = (Adb $cmd).ToString().Trim()
  Log $st
}

New-Item -ItemType Directory -Force -Path $OUT | Out-Null
if (-not (Test-Path $pollCsv)) {
  Set-Content -Path $pollCsv -Value 'iso,plugged,level,temp_c,temp10,note' -Encoding ascii
}

Log 'host_run begin — 3h unplug window'
$tStart = Get-Date
$ready = $false
while (((Get-Date) - $tStart).TotalSeconds -lt $WINDOW_S) {
  try {
    $b = Read-Batt
  } catch {
    Log "POLL adb-fail $_"
    Add-Content -Path $pollCsv -Value ('{0},NA,-1,-1,-1,adb-fail' -f (Get-Date -Format o)) -Encoding ascii
    Start-Sleep -Seconds $POLL_S
    continue
  }
  $note = if ((-not $b.Plugged) -and ($b.Level -ge 55)) { 'GATE_OK' } else { 'wait' }
  Add-Content -Path $pollCsv -Value ('{0},{1},{2},{3},{4},{5}' -f (Get-Date -Format o), $b.Plugged, $b.Level, $b.TempC, $b.Temp10, $note) -Encoding ascii
  Log ("POLL plugged={0} level={1} tempC={2} {3}" -f $b.Plugged, $b.Level, $b.TempC, $note)
  if ($note -eq 'GATE_OK') { $ready = $true; break }
  Start-Sleep -Seconds $POLL_S
}

if (-not $ready) {
  $b = $null
  try { $b = Read-Batt } catch { }
  $msg = if ($null -eq $b) { 'adb lost' } else { "plugged=$($b.Plugged) level=$($b.Level) tempC=$($b.TempC)" }
  Log "PENDING_UNPLUG window expired $msg"
  Set-Content -Path (Join-Path $OUT 'PENDING_UNPLUG') -Value @"
window_s=$WINDOW_S
completed=transfer+sha+harness+preflight
timed_cells=none
$msg
"@ -Encoding ascii
  exit 12
}

# Re-read immediately before first cell
$b = Read-Batt
if ($b.Plugged -or $b.Level -lt 55) {
  Log "GATE lost at start plugged=$($b.Plugged) level=$($b.Level)"
  Set-Content -Path (Join-Path $OUT 'PENDING_UNPLUG') -Value "gate lost at start plugged=$($b.Plugged) level=$($b.Level)" -Encoding ascii
  exit 12
}

Verify-Bin before
$extm = (Adb 'getprop persist.miui.extm.enable').ToString().Trim()
Log "extm.enable='$extm' (must be empty)"
Adb 'am kill-all; am memory-factor set NORMAL; svc power stayon true'

Start-Phase decode
Wait-Phase PHASE_DECODE 900

Start-Phase sustained
Wait-Phase PHASE_SUSTAINED 600

Pull-Logs
Log 'decode+sustained pulled'

# Perf-mode ON
Log 'ENABLE perf-mode: speed_mode=1 screen_game_mode=1 gb_boosting=1'
Adb 'settings put system speed_mode 1; settings put system screen_game_mode 1; settings put secure gb_boosting 1'
$pm = (Adb 'echo speed_mode=$(settings get system speed_mode); echo screen_game_mode=$(settings get system screen_game_mode); echo gb_boosting=$(settings get secure gb_boosting)').ToString().Trim()
Log "perf-mode now: $pm"
Set-Content -Path (Join-Path $OUT 'perf_mode_on.txt') -Value $pm -Encoding ascii

Start-Phase perf_cq
Wait-Phase PHASE_PERF_CQ 1800

Start-Phase perf_m1c
Wait-Phase PHASE_PERF_M1C 600

# Restore
Log 'RESTORE perf-mode: all 0'
Adb 'settings put system speed_mode 0; settings put system screen_game_mode 0; settings put secure gb_boosting 0'
$pm2 = (Adb 'echo speed_mode=$(settings get system speed_mode); echo screen_game_mode=$(settings get system screen_game_mode); echo gb_boosting=$(settings get secure gb_boosting)').ToString().Trim()
Log "perf-mode restored: $pm2"
Set-Content -Path (Join-Path $OUT 'perf_mode_restored.txt') -Value $pm2 -Encoding ascii

# Optional t4 if battery allows
$b = Read-Batt
Log ("t4 gate plugged={0} level={1} tempC={2}" -f $b.Plugged, $b.Level, $b.TempC)
if ((-not $b.Plugged) -and ($b.Level -ge 48) -and ($b.TempC -lt 42)) {
  Start-Phase t4
  Wait-Phase PHASE_T4 600
} else {
  Log 'SKIP t4 (battery/temp/plug)'
}

Adb 'svc power stayon false; am memory-factor reset' | Out-Null
Verify-Bin after
Pull-Logs
Adb "echo DONE > $DEV_LOG/DONE"
Log 'host_run COMPLETE'
Set-Content -Path (Join-Path $OUT 'DONE') -Value (Get-Date -Format o) -Encoding ascii
exit 0
