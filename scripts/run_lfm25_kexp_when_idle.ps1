# Wait until Marco quality / any llama-quantize releases the CPU, then:
# A0 Q4_K_M PPL -> dry-run -> quantize F16 to KEXP -> KEXP PPL k=4,3,2.
# PC only. No phones.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$res = Join-Path $root 'results\lfm25_kexp'
$log = Join-Path $res 'pipeline.log'
$status = Join-Path $res 'PIPELINE_STATUS.txt'
$Q = Join-Path $root 'build-pc-quantize\bin\llama-quantize.exe'
$CLI = Join-Path $root 'build-pc\cli\bmoe-cli.exe'
$PY = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$F16 = Join-Path $root 'models\LFM2.5-8B-A1B-F16.gguf'
$Q4 = Join-Path $root 'models\LFM2.5-8B-A1B-Q4_K_M.gguf'
$IM = Join-Path $root 'models\imatrix_lfm25_unsloth.gguf_file'
$TYPES = Join-Path $res 'tensor_types_lfm25.txt'
$OUT = Join-Path $root 'models\LFM2.5-8B-A1B-KEXP.gguf'
$PPL = Join-Path $root 'scripts\run_multi5_ppl_host.py'
$F16_SHA = 'c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159'

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}

function Set-St($s) { Set-Content $status $s -Encoding utf8 }

function Test-PcBusy {
    # Match by process Name + script path. Do NOT grep CommandLine for
    # 'llama-quantize' alone — this session's grok prompt contains that
    # string and would deadlock the waiter forever.
    $procs = Get-CimInstance Win32_Process | Where-Object {
        $n = $_.Name
        $c = $_.CommandLine
        if (-not $c) { return $false }
        if ($n -eq 'llama-quantize.exe') { return $true }
        if ($n -eq 'llama-imatrix.exe') { return $true }
        if ($n -eq 'bmoe-cli.exe' -and $c -match 'Marco-Mini') { return $true }
        if ($n -match '^(powershell|pwsh)\.exe$' -and $c -match 'run_marcokexp_quality\.ps1') { return $true }
        if ($n -eq 'python.exe' -and $c -match 'run_multi5_ppl_host' -and $c -match 'marcokexp') { return $true }
        return $false
    }
    return @($procs)
}

Set-St 'WAITING_MARCO'
L 'START wait for PC idle of Marco/quantize'

while ($true) {
    $busy = Test-PcBusy
    if (-not $busy -or $busy.Count -eq 0) {
        L 'PC idle of Marco/quantize'
        break
    }
    $snap = ($busy | ForEach-Object { '{0}:{1}' -f $_.ProcessId, $_.Name }) -join ', '
    L ("still busy: " + $snap)
    Set-St 'WAITING_MARCO'
    Start-Sleep -Seconds 600
}

# --- A0 at k=4,3,2 (same-k G1 needs all three) ---
foreach ($k in 4, 3, 2) {
    $tag = "A0-Q4KM-k$k"
    Set-St "RUNNING_$tag"
    L $tag
    & $PY $PPL `
        --binary $CLI `
        --model $Q4 `
        --tag $tag `
        --outdir (Join-Path $res $tag) `
        --langs en,es,fr,it,zh `
        --threads 8 `
        --moe-stream --n-expert-used $k
    if ($LASTEXITCODE -ne 0) { Set-St "FAIL_$tag"; L "FAIL $tag rc=$LASTEXITCODE"; exit 2 }
}
L 'A0 done'

# --- F16 sha ---
if (-not (Test-Path $F16)) { Set-St 'FAIL_NO_F16'; L 'FAIL no F16'; exit 2 }
$got = (Get-FileHash $F16 -Algorithm SHA256).Hash.ToLower()
if ($got -ne $F16_SHA) { Set-St 'FAIL_F16_SHA'; L "FAIL F16 sha $got"; exit 2 }
L 'F16 sha match'

# --- dry-run ---
Set-St 'RUNNING_DRYRUN'
L 'dry-run'
& $Q --dry-run --imatrix $IM --tensor-type-file $TYPES $F16 $OUT Q5_K *>&1 |
    Tee-Object (Join-Path $res 'quantize_dryrun.log')
if ($LASTEXITCODE -ne 0) { Set-St 'FAIL_DRYRUN'; L "FAIL dry-run rc=$LASTEXITCODE"; exit 2 }

# --- quantize ---
if (Test-Path $OUT) {
    L "KEXP already exists, skip quantize: $OUT"
} else {
    Set-St 'RUNNING_QUANTIZE'
    L 'quantize'
    & $Q --imatrix $IM --tensor-type-file $TYPES $F16 $OUT Q5_K *>&1 |
        Tee-Object (Join-Path $res 'quantize.log')
    if ($LASTEXITCODE -ne 0) { Set-St 'FAIL_QUANTIZE'; L "FAIL quantize rc=$LASTEXITCODE"; exit 2 }
}
$kh = Get-FileHash $OUT -Algorithm SHA256
'{0}  {1}  {2}' -f (Get-Item $OUT).Length, $kh.Hash.ToLower(), $OUT |
    Set-Content (Join-Path $res 'KEXP.sha256') -Encoding utf8
L ("KEXP sha=" + $kh.Hash.ToLower())
Set-St 'RUNNING_VERIFY'
& $PY (Join-Path $res 'verify_kexp.py') $OUT
if ($LASTEXITCODE -ne 0) { Set-St 'FAIL_VERIFY'; L "FAIL verify rc=$LASTEXITCODE"; exit 2 }
L 'verify OK'

# --- KEXP PPL ---
foreach ($k in 4, 3, 2) {
    $tag = "KEXP-k$k"
    Set-St "RUNNING_$tag"
    L $tag
    & $PY $PPL `
        --binary $CLI `
        --model $OUT `
        --tag $tag `
        --outdir (Join-Path $res $tag) `
        --langs en,es,fr,it,zh `
        --threads 8 `
        --moe-stream --n-expert-used $k
    if ($LASTEXITCODE -ne 0) { Set-St "FAIL_$tag"; L "FAIL $tag rc=$LASTEXITCODE"; exit 2 }
}

Set-St 'DONE'
L 'PIPELINE DONE'
exit 0
