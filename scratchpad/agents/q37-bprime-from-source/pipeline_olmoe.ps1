# q37: wait for OLMoE Q8_0 download, then cook / verify / A/B.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$log = Join-Path $root 'logs\dl-q37-olmoe-pipeline.log'
$status = Join-Path $here 'PIPELINE_OLMOE_STATUS.txt'

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}
function Run-Py {
    param([Parameter(Mandatory=$true)][string[]]$PyArgs)
    L ("PY " + ($PyArgs -join ' '))
    & $py @PyArgs
    $rc = $LASTEXITCODE
    L ("PY rc=$rc")
    if ($rc -ne 0) { throw "python rc=$rc PyArgs=$($PyArgs -join ' ')" }
}

'WAITING_DL' | Set-Content $status -Encoding utf8
L 'START pipeline olmoe'
$dlStatus = Join-Path $here 'DL_OLMOE_STATUS.txt'
$deadline = (Get-Date).AddHours(6)
while ($true) {
    $s = ''
    if (Test-Path $dlStatus) { $s = (Get-Content $dlStatus -Raw).Trim() }
    L ("dl_status=$s")
    if ($s -eq 'OK') { break }
    if ($s -like 'FAIL*' -or $s -eq 'ABORT_DISK') { $s | Set-Content $status; L "ABORT $s"; exit 2 }
    if ((Get-Date) -gt $deadline) { 'TIMEOUT_DL' | Set-Content $status; exit 3 }
    Start-Sleep -Seconds 30
}
'COOKING' | Set-Content $status -Encoding utf8
try {
    Run-Py @( (Join-Path $here 'gen_recipes.py') )
    Run-Py @( (Join-Path $here 'cook_model.py'), 'olmoe' )
    'VERIFY' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'verify_variants.py'), 'olmoe' )
    $ctrl = Join-Path $here 'gguf\olmoe\OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-control.gguf'
    $q8 = Join-Path $here 'gguf\olmoe\OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-q8_0.gguf'
    Run-Py @( (Join-Path $here 'npu_desk.py'), $ctrl, (Join-Path $here 'npu\olmoe-control.md') )
    Run-Py @( (Join-Path $here 'npu_desk.py'), $q8, (Join-Path $here 'npu\olmoe-q8_0.md') )
    'AB_SANITY' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_q37_ab.py'), 'olmoe', 'sanity' )
    'AB_LONG' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_q37_ab.py'), 'olmoe', 'long' )
    'OK' | Set-Content $status -Encoding utf8
    L 'DONE pipeline olmoe'
    exit 0
} catch {
    L ("FAIL " + $_.Exception.Message)
    'FAIL' | Set-Content $status -Encoding utf8
    exit 1
}
