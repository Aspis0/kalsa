$ErrorActionPreference = 'Continue'
$status = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\DL_STATUS.txt'
$q8 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Marco-Mini-Instruct.Q8_0.gguf'
$watch = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-marco-q8-watch.log'
$expect = [int64]18356453952
Add-Content $watch ('[watch-start ' + (Get-Date -Format o) + ']')
while (-not (Test-Path $status)) {
    $sz = 0
    if (Test-Path $q8) { $sz = (Get-Item $q8).Length }
    $pct = if ($expect -gt 0) { 100.0 * $sz / $expect } else { 0 }
    $line = '[watch {0}] q8={1}B {2:N1}%' -f (Get-Date -Format o), $sz, $pct
    Add-Content $watch $line
    Start-Sleep -Seconds 120
}
$st = (Get-Content $status -Raw).Trim()
Add-Content $watch ('[watch-done ' + (Get-Date -Format o) + '] ' + $st)
if ($st -eq 'OK') {
    Write-Output 'DONE marco Q8+imatrix verified'
    Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-marco-q8.log' -Tail 20
    exit 0
}
Write-Output ('FAILED download status=' + $st)
Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\dl-marco-q8.log' -Tail 30
exit 2
