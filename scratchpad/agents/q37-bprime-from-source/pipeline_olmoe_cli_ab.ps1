$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$log = Join-Path $root 'logs\dl-q37-olmoe-cli-ab.log'
$status = Join-Path $here 'PIPELINE_OLMOE_CLI_STATUS.txt'
function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}
'RUNNING' | Set-Content $status
L 'START olmoe llama-cli A/B'
try {
    L 'PY sanity'
    & $py (Join-Path $here 'run_olmoe_cli_ab.py') sanity
    if ($LASTEXITCODE -ne 0) { throw "sanity rc=$LASTEXITCODE" }
    L 'PY long'
    & $py (Join-Path $here 'run_olmoe_cli_ab.py') long
    if ($LASTEXITCODE -ne 0) { throw "long rc=$LASTEXITCODE" }
    'OK' | Set-Content $status
    L 'DONE'
    exit 0
} catch {
    L ("FAIL " + $_.Exception.Message)
    'FAIL' | Set-Content $status
    exit 1
}
