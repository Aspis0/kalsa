# q43: wait for Marco Q8 download, cook q8_0 trunk variant, verify arms (blocking),
# wait for the 4 language corpora + MANIFEST, then run the 9 PPL cells sequentially.
# Control-wiki is REUSED from q41 (PREREG.md) and is NOT run here.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$q37 = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$here = Join-Path $root 'scratchpad\agents\q43-q8trunk-ppl-gate'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$log = Join-Path $root 'logs\q43-pipeline.log'
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
L 'START q43 pipeline'
$dlStatus = Join-Path $q37 'DL_MARCO_STATUS.txt'
$deadline = (Get-Date).AddHours(6)
while ($true) {
    $s = ''
    if (Test-Path $dlStatus) { $s = (Get-Content $dlStatus -Raw).Trim() }
    L ("dl_status=$s")
    if ($s -eq 'OK') { break }
    if ($s -like 'FAIL*' -or $s -eq 'ABORT_DISK') { $s | Set-Content $status; L "ABORT $s"; exit 2 }
    if ((Get-Date) -gt $deadline) { 'TIMEOUT_DL' | Set-Content $status; exit 3 }
    Start-Sleep -Seconds 60
}

try {
    $d = Get-PSDrive C
    L ("DISK free_GB={0:N2} before cook" -f ($d.Free/1GB))
    if ($d.Free -lt 40GB) { throw 'ABORT_DISK' }
    'COOKING' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $q37 'cook_model.py'), 'marco', 'q8_0' )
    'VERIFY' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'verify_arms.py'), 'q8_0' )

    # Corpora must be frozen (all 4 files >= 400 KB + MANIFEST.md) before any PPL run.
    'WAITING_CORPORA' | Set-Content $status -Encoding utf8
    $cdir = Join-Path $here 'corpus'
    $langs = @('it','es','fr','zh')
    $cDeadline = (Get-Date).AddHours(6)
    while ($true) {
        $ready = (Test-Path (Join-Path $cdir 'MANIFEST.md'))
        foreach ($l in $langs) {
            $f = Join-Path $cdir "$l.txt"
            if (-not (Test-Path $f) -or ((Get-Item $f).Length -lt 400000)) { $ready = $false }
        }
        if ($ready) { break }
        if ((Get-Date) -gt $cDeadline) { 'TIMEOUT_CORPORA' | Set-Content $status; L 'TIMEOUT corpora'; exit 4 }
        L 'corpora not ready yet'
        Start-Sleep -Seconds 60
    }
    L 'corpora ready, settling 60s'
    Start-Sleep -Seconds 60

    'PPL_WIKI_Q8' | Set-Content $status -Encoding utf8
    Run-Py @( (Join-Path $here 'run_ppl.py'), 'q8_0', 'wiki' )
    foreach ($l in $langs) {
        "PPL_$($l.ToUpper())_CONTROL" | Set-Content $status -Encoding utf8
        Run-Py @( (Join-Path $here 'run_ppl.py'), 'control', $l )
        "PPL_$($l.ToUpper())_Q8" | Set-Content $status -Encoding utf8
        Run-Py @( (Join-Path $here 'run_ppl.py'), 'q8_0', $l )
    }
    'OK' | Set-Content $status -Encoding utf8
    L 'DONE q43 pipeline'
    exit 0
} catch {
    L ("FAIL " + $_.Exception.Message)
    'FAIL' | Set-Content $status -Encoding utf8
    exit 1
}
