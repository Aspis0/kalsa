param([int]$Hours = 6)
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q41-ppl-gate'
$statusFile = Join-Path $here 'PIPELINE_STATUS.txt'
$prog = Join-Path $root 'logs\dl-q41-wait.log'
$deadline = (Get-Date).AddHours($Hours)
function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $prog $t -Encoding utf8
}
L "WAIT start"
while ((Get-Date) -lt $deadline) {
    $s = ''
    if (Test-Path $statusFile) { $s = (Get-Content $statusFile -Raw).Trim() }
    $d = Get-PSDrive C
    L ("status=$s free_GB={0:N2}" -f ($d.Free/1GB))
    if ($s -eq 'OK') { Write-Output 'PIPELINE_OK'; exit 0 }
    if ($s -match '^(FAIL|TIMEOUT|ABORT)') { Write-Output "PIPELINE_$s"; exit 1 }
    Start-Sleep -Seconds 60
}
Write-Output 'PIPELINE_WAIT_TIMEOUT'
exit 3
