$dest = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\reap_community\Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
$expect = 10599958400L
$log = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-watch.log"
function W($m){ Add-Content $log ("[{0}] {1}" -f (Get-Date -Format s), $m) }
W "watch3 start (wait for final gguf)"
for ($i=0; $i -lt 600; $i++) {
  $sz = 0
  if (Test-Path $dest) { $sz = (Get-Item $dest).Length }
  $hf = Get-Process -Name hf,python -EA SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddHours(-2) }
  if (($i % 2) -eq 0) { W ("size={0} pct={1:n1} procs={2}" -f $sz, (100.0*$sz/[math]::Max(1,$expect)), @($hf).Count) }
  if ($sz -eq $expect) {
    W "COMPLETE"
    Set-Location "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\run_reap_f0_pc.ps1" *>> $log 2>&1
    W ("F0_PC exit=" + $LASTEXITCODE)
    break
  }
  # if hf gone and no file - report fail
  $hfAlive = $false
  foreach ($p in Get-CimInstance Win32_Process -Filter "Name='python.exe'" ) {
    if ($p.CommandLine -and $p.CommandLine -match 'REAP20') { $hfAlive = $true }
  }
  if (-not $hfAlive -and $sz -eq 0 -and $i -gt 10) {
    W "hf gone without dest ? FAIL"
    break
  }
  Start-Sleep -Seconds 30
}
W "watch3 exit"
