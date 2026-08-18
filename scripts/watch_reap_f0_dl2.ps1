$dest = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\reap_community\Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
$expect = 10599958400L
$log = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-watch.log"
$pidf = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-curl.pid"
function W([string]$m){ Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format s), $m) }
W "watch2 start"
for ($i=0; $i -lt 900; $i++) {
  $sz = 0; if (Test-Path $dest) { $sz = (Get-Item $dest).Length }
  $curlAlive = $false
  if (Test-Path $pidf) { $cp = [int](Get-Content $pidf -Raw).Trim(); if (Get-Process -Id $cp -ErrorAction SilentlyContinue) { $curlAlive = $true } }
  if (($i % 4) -eq 0) { W ("size={0} pct={1:n1} curl={2}" -f $sz, (100.0*$sz/$expect), $curlAlive) }
  if ($sz -ge $expect) {
    W "COMPLETE size=$sz"
    Set-Location "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\run_reap_f0_pc.ps1" *>> $log 2>&1
    W ("F0_PC done exit=" + $LASTEXITCODE)
    break
  }
  if (-not $curlAlive -and $sz -gt 0 -and $sz -lt $expect -and $i -gt 2) {
    W "curl dead incomplete=$sz ? try resume"
    $url = "https://huggingface.co/barozp/Qwen3.6-28B-REAP20-A3B-GGUF/resolve/main/Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
    $clog = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-curl.log"
    $p = Start-Process -FilePath curl.exe -ArgumentList @("-L","--http1.1","-C","-","--retry","8","--retry-delay","5","-o",$dest,$url) -RedirectStandardError $clog -PassThru -WindowStyle Hidden
    $p.Id | Set-Content $pidf
    W "resumed curl pid=$($p.Id)"
  }
  Start-Sleep -Seconds 45
}
W "watch2 exit"
