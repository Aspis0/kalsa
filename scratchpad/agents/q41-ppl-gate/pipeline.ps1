# q41: wait for Marco Q8 download, cook IQ4_NL+Q4_0, verify, wiki PPL, optional IT PPL.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$q37 = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$here = Join-Path $root 'scratchpad\agents\q41-ppl-gate'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$log = Join-Path $root 'logs\dl-q41-pipeline.log'
$status = Join-Path $here 'PIPELINE_STATUS.txt'
New-Item -ItemType Directory -Force -Path (Join-Path $here 'logs') | Out-Null

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
L 'START q41 pipeline'
$dlStatus = Join-Path $q37 'DL_MARCO_STATUS.txt'
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

try {
    $d = Get-PSDrive C
    L ("DISK free_GB={0:N2} before cook" -f ($d.Free/1GB))
    if ($d.Free -lt 40GB) { throw 'ABORT_DISK' }
    'COOKING' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $q37 'cook_model.py'), 'marco', 'iq4_nl', 'q4_0' )
    'VERIFY' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'verify_arms.py'), 'iq4_nl', 'q4_0' )
    'PPL_WIKI_CONTROL' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'control', 'wiki' )
    'PPL_WIKI_IQ4' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'iq4_nl', 'wiki' )
    'PPL_WIKI_Q40' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'q4_0', 'wiki' )
    'PPL_IT' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'control', 'it' )
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'iq4_nl', 'it' )
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'q4_0', 'it' )
    'OK' | Set-Content $status -Encoding utf8
    L 'DONE q41 pipeline'
    exit 0
} catch {
    L ("FAIL " + $_.Exception.Message)
    'FAIL' | Set-Content $status -Encoding utf8
    exit 1
}
