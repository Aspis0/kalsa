$key = "C:\Users\gualt\.ssh\moe_s23"
$outDir = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kexp_grid"
$log = Join-Path $outDir "host_watch_speed.log"
$pull = Join-Path $outDir "from_phone_speed"
New-Item -ItemType Directory -Force -Path $pull | Out-Null
function Stamp { (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss") }
function W($m) { $line = "[$(Stamp)] $m"; Add-Content -Path $log -Value $line; Write-Host $line }
W "host_watch start"
for ($i=0; $i -lt 240; $i++) {
  try {
    $raw = ssh -p 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=12 u0_a344@192.168.1.152 "export PREFIX=/data/data/com.termux/files/usr; export PATH=`$PREFIX/bin:`$PATH; export HOME=/data/data/com.termux/files/home; S=`$HOME/experiments/results/kexp_grid/speed; echo STATUS:`$(cat `$S/STATUS.txt 2>/dev/null || echo NONE); echo PID:`$(cat `$S/speed.pid 2>/dev/null); if [ -f `$S/speed.pid ]; then ps -p `$(cat `$S/speed.pid) >/dev/null 2>&1 && echo ALIVE || echo DEAD; fi; echo LOG:`$(tail -3 `$S/speed.master.log 2>/dev/null | tr '\n' '|' ); echo CSV_LINES:`$(wc -l < `$S/speed_cells.csv 2>/dev/null || echo 0); termux-battery-status 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"BATT:%s %s%% T=%.1f\"%(d.get(\"plugged\"),d.get(\"percentage\"),d.get(\"temperature\",0)))' 2>/dev/null" 2>&1
    W ($raw -join " | ")
    if ($raw -match "STATUS:DONE") {
      W "DONE detected - pulling artifacts"
      scp -P 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -r u0_a344@192.168.1.152:experiments/results/kexp_grid/speed/* $pull/ 2>&1 | Out-String | ForEach-Object { W $_ }
      W "PULL_OK"
      break
    }
    if ($raw -match "STATUS:STOP_") {
      W "STOP detected - pulling"
      scp -P 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -r u0_a344@192.168.1.152:experiments/results/kexp_grid/speed/* $pull/ 2>&1 | Out-String | ForEach-Object { W $_ }
      break
    }
    if ($raw -match "DEAD" -and $raw -notmatch "STATUS:DONE") {
      W "DEAD without DONE - investigate"
      scp -P 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -r u0_a344@192.168.1.152:experiments/results/kexp_grid/speed/* $pull/ 2>&1 | Out-String | ForEach-Object { W $_ }
      break
    }
  } catch {
    W "ERR $_"
  }
  Start-Sleep -Seconds 90
}
W "host_watch exit"
