# Host-side keep-awake + re-promote for staccato3 (Windows PowerShell)
$ErrorActionPreference = 'Continue'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$S23 = 'adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'
$SSH = @('ssh','-p','8022','-i',"$env:USERPROFILE\.ssh\moe_s23",'-o','BatchMode=yes','-o','ConnectTimeout=10','u0_a344@192.168.1.152')
$LogDir = 'C:/Users/gualt/Desktop/Kalsa/moe-experiments/results/staccato3'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'host_watch.log'

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
  Add-Content -Path $Log -Value $line
  Write-Output $line
}

function Promote {
  & $ADB -s $S23 shell input keyevent KEYCODE_WAKEUP 2>$null | Out-Null
  & $ADB -s $S23 shell input keyevent 82 2>$null | Out-Null
  & $ADB -s $S23 shell am start -n com.termux/.app.TermuxActivity 2>$null | Out-Null
}

Log "host_watch.ps1 start"
$cur = (& $ADB -s $S23 shell settings get system screen_off_timeout 2>$null | Out-String).Trim()
Log "screen_off_timeout=$cur"
if ($cur -ne '7200000') {
  & $ADB -s $S23 shell settings put system screen_off_timeout 7200000 | Out-Null
  Log "re-set screen_off_timeout=7200000"
}
Promote

$lastKeep = 0
while ($true) {
  $now = [int][double]::Parse((Get-Date -UFormat %s))
  if (($now - $lastKeep) -ge 60) {
    Promote
    $lastKeep = $now
    Log "keep-awake tick"
  }
  $remoteCmd = @'
export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH
OUT=$HOME/experiments/results/staccato3
n=$(nproc 2>/dev/null || echo ?)
if [ -f $OUT/REPROMOTE.request ]; then echo REPROMOTE; cat $OUT/REPROMOTE.request; rm -f $OUT/REPROMOTE.request
elif [ -f $OUT/staccato2.pid ] && kill -0 $(cat $OUT/staccato2.pid) 2>/dev/null; then
  echo ALIVE nproc=$n
  tail -1 $OUT/STACCATO2.master.log 2>/dev/null || true
  tail -1 $OUT/STATUS.txt 2>/dev/null || true
else
  echo DEAD nproc=$n
  tail -8 $OUT/STATUS.txt 2>/dev/null || true
fi
'@
  try {
    $remote = & $SSH[0] $SSH[1..($SSH.Length-1)] $remoteCmd 2>$null
    $remoteStr = ($remote -join ' | ')
    Log "remote: $remoteStr"
    if ($remoteStr -match 'REPROMOTE') {
      Log "re-promote on request"
      Promote
      Start-Sleep -Seconds 2
    }
    if ($remoteStr -match 'DEAD' -and ($remoteStr -match 'DONE|DONE_PARTIAL|FATAL|STOPPED')) {
      Log "session finished — host_watch exit"
      exit 0
    }
  } catch {
    Log "ssh fail: $_"
  }
  Start-Sleep -Seconds 20
}
