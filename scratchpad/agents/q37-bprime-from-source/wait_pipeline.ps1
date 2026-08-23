param(
    [Parameter(Mandatory=$true)][string]$Name,
    [int]$Hours = 6
)
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$statusFile = Join-Path $here ("PIPELINE_{0}_STATUS.txt" -f $Name.ToUpper())
$prog = Join-Path $root ("logs\dl-q37-{0}-wait.log" -f $Name.ToLower())
$deadline = (Get-Date).AddHours($Hours)
function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $prog $t -Encoding utf8
}
L "WAIT start name=$Name statusFile=$statusFile"
while ((Get-Date) -lt $deadline) {
    $s = ''
    if (Test-Path $statusFile) { $s = (Get-Content $statusFile -Raw).Trim() }
    $d = Get-PSDrive C
    $gb = [math]::Round($d.Free / 1GB, 2)
    L ("status=$s free_GB=$gb")
    if ($s -eq 'OK') { Write-Output "PIPELINE_OK $Name"; exit 0 }
    if ($s -match '^(FAIL|TIMEOUT|ABORT)') { Write-Output "PIPELINE_$s $Name"; exit 1 }
    Start-Sleep -Seconds 60
}
Write-Output "PIPELINE_WAIT_TIMEOUT $Name"
exit 3
