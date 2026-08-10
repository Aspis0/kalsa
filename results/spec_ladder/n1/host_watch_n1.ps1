$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$S23 = 'adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'
$key = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\spec_ladder\n1\.ssh\moe_s23'
$Log = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\spec_ladder\n1\host_watch_n1.log'
function L($m){ $line = "[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content $Log $line }
L 'host_watch start'
for ($i=0; $i -lt 240; $i++) {
  try {
    & $ADB -s $S23 shell input keyevent KEYCODE_WAKEUP 2>$null | Out-Null
    & $ADB -s $S23 shell am start -n com.termux/.app.TermuxActivity 2>$null | Out-Null
  } catch {}
  # remote status every 60s (every 2 ticks of 30s)
  if (($i % 2) -eq 0) {
    try {
      $st = ssh -p 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=8 u0_a344@192.168.1.152 "export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH; export HOME=/data/data/com.termux/files/home; cat $HOME/experiments/results/spec_ladder/n1/STATUS.txt 2>/dev/null; tail -1 $HOME/experiments/results/spec_ladder/n1/N1.master.log 2>/dev/null; if [ -f $HOME/experiments/results/spec_ladder/n1/n1_launch.pid ]; then ps -p $(cat $HOME/experiments/results/spec_ladder/n1/n1_launch.pid) >/dev/null 2>&1 && echo ALIVE || echo DEAD; fi; termux-battery-status 2>/dev/null | tr -d '\n' | head -c 180" 2>$null
      L ($st -join ' | ')
    } catch { L "ssh_fail $_" }
  }
  Start-Sleep 30
}
L 'host_watch end'
