# Host watcher for Xiaomi Task B retry. Does NOT touch S23 or Jelly.
$ErrorActionPreference = 'Continue'
$ADB = 'C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$SerialHint = 'adb-625689a2'
$OutDir = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab\taskb_retry'
$DevLog = '/data/local/tmp/gdn_750/taskb/logs/taskb_retry'
$WatchLog = Join-Path $OutDir 'host_watch.log'

function W([string]$m) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
  Add-Content -Path $WatchLog -Value $line
  Write-Host $line
}

function Resolve-Xiaomi {
  $mdns = & $ADB mdns services 2>$null | Out-String
  if ($mdns -match 'adb-625689a2\S*\s+(\d+\.\d+\.\d+\.\d+:\d+)') {
    $ep = $Matches[1]
    & $ADB connect $ep 2>$null | Out-Null
  }
  $devs = & $ADB devices -l 2>$null
  foreach ($ln in $devs) {
    if ($ln -match '^(adb-625689a2\S*)\s+device') { return $Matches[1] }
    if ($ln -match '^(192\.168\.1\.193:\d+)\s+device') { return $Matches[1] }
  }
  return $null
}

W 'watcher start'
$lastPull = Get-Date '2000-01-01'
while ($true) {
  $x = Resolve-Xiaomi
  if (-not $x) {
    W 'NO_DEVICE retry 15s'
    Start-Sleep -Seconds 15
    continue
  }
  $st = & $ADB -s $x shell "cat $DevLog/status.txt 2>/dev/null | tail -n 8" 2>$null
  $alive = & $ADB -s $x shell "pgrep -f /data/local/tmp/gdn_750/taskb/bin/bmoe-cli; echo ---; test -f $DevLog/DONE && echo HAS_DONE; test -f $DevLog/ABORT && echo HAS_ABORT && cat $DevLog/ABORT" 2>$null
  W ("serial=$x status=<<{0}>> alive=<<{1}>>" -f (($st | Out-String).Trim(), ($alive | Out-String).Trim()))
  if ((Get-Date) - $lastPull -gt [TimeSpan]::FromMinutes(2)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'device_logs') | Out-Null
    & $ADB -s $x pull "$DevLog/status.txt" (Join-Path $OutDir 'device_logs\status.txt') 2>$null | Out-Null
    & $ADB -s $x pull "$DevLog/runs.csv" (Join-Path $OutDir 'device_logs\runs.csv') 2>$null | Out-Null
    & $ADB -s $x pull "$DevLog/battery_notes.txt" (Join-Path $OutDir 'device_logs\battery_notes.txt') 2>$null | Out-Null
    $lastPull = Get-Date
  }
  if (($alive | Out-String) -match 'HAS_DONE') { W 'DONE seen'; break }
  if (($alive | Out-String) -match 'HAS_ABORT') { W 'ABORT seen'; break }
  Start-Sleep -Seconds 30
}
W 'watcher exit'
exit 0
