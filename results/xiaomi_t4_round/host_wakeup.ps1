# Host-side screen keeper: KEYCODE_WAKEUP every 60s until STOP_WAKE exists.
$ErrorActionPreference = 'Continue'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = 'adb-625689a2-9xEOfw._adb-tls-connect._tcp'
$OUT = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_t4_round'
$stopWake = Join-Path $OUT 'STOP_WAKE'
$log = Join-Path $OUT 'wakeup.log'

function WLog([string]$m) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
  Add-Content -Path $log -Value $line -Encoding utf8
}

WLog 'wakeup loop start'
while (-not (Test-Path $stopWake)) {
  try {
    & $ADB -s $X shell 'input keyevent KEYCODE_WAKEUP' | Out-Null
    $w = (& $ADB -s $X shell 'dumpsys power | grep mWakefulness=' | Out-String).Trim()
    WLog $w
  } catch {
    WLog "wakeup fail $_"
  }
  Start-Sleep -Seconds 60
}
WLog 'wakeup loop stop (STOP_WAKE present)'
