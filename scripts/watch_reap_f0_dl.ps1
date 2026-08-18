$dest = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\reap_community\Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
$expect = 10599958400L
$log = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-watch.log"
$pidf = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-reap-f0-curl.pid"
function W($m){ $l="[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content $log $l; Write-Host $l }
W "watch start expect=$expect"
for ($i=0; $i -lt 720; $i++) {
  $alive = $false
  if (Test-Path $pidf) {
    $cp = Get-Content $pidf
    if ($cp -and (Get-Process -Id $cp -ErrorAction SilentlyContinue)) { $alive = $true }
  }
  $sz = 0
  if (Test-Path $dest) { $sz = (Get-Item $dest).Length }
  if ($i % 6 -eq 0) { W ("progress size={0} pct={1:n1} curl={2}" -f $sz, (100.0*$sz/$expect), $alive) }
  if ($sz -eq $expect) {
    W "DOWNLOAD COMPLETE"
    # wait curl exit
    Start-Sleep -Seconds 3
    Set-Location "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
    W "START F0 PC smoke"
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run_reap_f0_pc.ps1" *>> $log
    W "F0 PC exit=$LASTEXITCODE"
    break
  }
  if (-not $alive -and $sz -gt 0 -and $sz -lt $expect) {
    W "curl DEAD incomplete size=$sz — will not auto-resume here"
    break
  }
  Start-Sleep -Seconds 30
}
W "watch exit"
