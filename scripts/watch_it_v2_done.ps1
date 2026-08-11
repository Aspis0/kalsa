# Notify when IT v2 3-model comparison is written
$ErrorActionPreference = "Continue"
$j = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\trial_marco\ppl_it_v2\it_v2_comparison.json"
while (-not (Test-Path $j)) {
  Start-Sleep -Seconds 60
}
Get-Content $j -Raw
Write-Output "DONE it_v2 comparison complete"
