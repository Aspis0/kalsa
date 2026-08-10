$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$deadline = (Get-Date).AddHours(6)
while ((Get-Date) -lt $deadline) {
  if (Test-Path "$root\results\requant1c\orch_done.txt") {
    Write-Output "DONE orch complete"
    exit 0
  }
  if (Test-Path "$root\results\requant1c\q8_gate.txt") {
    $g = Get-Content "$root\results\requant1c\q8_gate.txt" -Raw
    if ($g -match "FAIL") { Write-Output "FAILED q8 gate $g"; exit 1 }
  }
  # health: if curl dead and no gate yet and size incomplete -> fail
  $cid = Get-Content "$root\results\requant1c\dl-q8.pid" -EA SilentlyContinue
  $sz = if (Test-Path "$root\models\Qwen3.6-35B-A3B-Q8_0.gguf") { (Get-Item "$root\models\Qwen3.6-35B-A3B-Q8_0.gguf").Length } else { 0 }
  $curl = if ($cid) { Get-Process -Id $cid -EA SilentlyContinue } else { $null }
  $gate = Test-Path "$root\results\requant1c\q8_gate.txt"
  if (-not $curl -and -not $gate -and $sz -lt 36903140320) {
    # watch may still be hashing - check watch
    $wid = Get-Content "$root\results\requant1c\watch-q8.pid" -EA SilentlyContinue
    $w = if ($wid) { Get-Process -Id $wid -EA SilentlyContinue } else { $null }
    $oid = Get-Content "$root\results\requant1c\orch.pid" -EA SilentlyContinue
    $o = if ($oid) { Get-Process -Id $oid -EA SilentlyContinue } else { $null }
    if (-not $w -and -not $o) {
      Write-Output "FAILED pipeline dead early size=$sz"
      exit 2
    }
  }
  Start-Sleep -Seconds 60
}
Write-Output "FAILED timeout"
exit 3
