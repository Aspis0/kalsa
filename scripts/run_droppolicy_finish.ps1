# Finish the drop-policy quality cell — the two arms the first run never produced.
#
# WHAT HAPPENED
# -------------
# The first orchestrator (run_droppolicy_quality.ps1, pid 10804, started 08:29:51 on
# 2026-08-18) completed dp_d0 and dp_cold_d10, then dp_rand_d10 died at language 3 of 5
# with `bmoe: pread failed at 5783089152` (rc=1). That script stops the whole cell on a
# non-zero rc, so dp_weight_d10 never started.
#
# THE BINARY, AND WHY IT IS THE "WRONG" ONE ON PURPOSE
# ----------------------------------------------------
# All three completed arms record binary sha 59f2762e54ed56af = `build-pc-droppolicy`
# (the build from `main`), with NO --no-moe-fused-* flags — NOT the `-s2` build the
# script's header claims. The orchestrator started at 08:29:51; the s2 binary was
# compiled at 08:52, so PowerShell had already parsed the older version of the script.
# These two arms must run on the SAME binary as the arms they will be compared with,
# so this script pins 59f2762e54ed56af explicitly and verifies the sha before starting.
# Comparing across the two builds would be meaningless: the changeset also bumps the
# llama.cpp submodule across two CPU matmul commits.
#
# WHY dp_rand GOES TO A SEPARATE DIRECTORY
# ----------------------------------------
# run_multi5_ppl_host.py has no per-language resume — it would redo en/es/fr (~80 min of
# PC time) to reach it/zh. `--langs it,zh` into its own cell keeps the three good
# languages untouched; the two halves are merged at analysis time, which is safe because
# every language is an independent measurement on the same binary and model.
#
# DIFFERENCE FROM THE FIRST ORCHESTRATOR: a failed arm no longer kills the run. Each arm
# gets one retry (the pread failure looked transient — the first three languages were
# clean), then the script moves on. Losing arm 2 because arm 1 failed is what cost us
# today.

$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$py      = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$harness = "$root\scripts\run_multi5_ppl_host.py"
$binary  = "$root\build-pc-droppolicy\cli\bmoe-cli.exe"
$expect  = '59f2762e54ed56af'
$model   = "$root\models\Marco-Mini-Instruct-KEXP.gguf"
$cell    = "$root\results\droppolicy_quality_marco"
$log     = "$root\logs\droppolicy-finish.log"

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
    Add-Content -Path "$cell\STATUS.txt" -Value $line -Encoding utf8
}

# An arm is complete only with BOTH keys: the JSON is written per-language and on failure
# paths too, so file existence proves nothing (this is how the first run's dp_rand looked
# "present" while being 3/5).
function ArmComplete([string]$dir, [string]$id) {
    $j = Join-Path $dir "${id}_multi5.json"
    if (-not (Test-Path $j)) { return $false }
    try { $d = Get-Content $j -Raw | ConvertFrom-Json } catch { return $false }
    return ($null -ne $d.finished) -and ($null -ne $d.macro_bpb)
}

# Duplicate-instance guard. Two orchestrators ran simultaneously this morning; the second
# sat in an idle-wait loop and would have started an arm in parallel at the next handover.
$mine = $PID
$dupe = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" |
        Where-Object { $_.ProcessId -ne $mine -and $_.CommandLine -like '*run_droppolicy_finish*' }
if ($dupe) { Say "REFUSING: another run_droppolicy_finish is alive (pid $($dupe.ProcessId -join ','))"; exit 4 }

if (-not (Test-Path $binary)) { Say "FATAL: $binary missing"; exit 2 }
$sha = (Get-FileHash -Path $binary -Algorithm SHA256).Hash.ToLower().Substring(0,16)
if ($sha -ne $expect) { Say "FATAL: binary sha $sha != expected $expect - refusing (would not be comparable)"; exit 2 }
Say "binary verified sha=$sha ($binary)"

# Wait for the PC to be free, but bounded: the first script's 24 h wait is how a second
# instance ended up idling for hours.
$waited = 0
while (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) {
    if ($waited % 900 -eq 0) { Say "bmoe-cli busy (${waited}s)" }
    Start-Sleep -Seconds 60; $waited += 60
    if ($waited -gt 7200) { Say "still busy after 2 h - giving up"; exit 1 }
}
Say "PC idle after ${waited}s"

$arms = @(
    @{ id = 'dp_rand_d10_itzh'; policy = 'random'; langs = 'it,zh'         },
    @{ id = 'dp_weight_d10';    policy = 'weight'; langs = 'en,es,fr,it,zh' }
)

foreach ($arm in $arms) {
    $outdir = "$cell\$($arm.id)"
    if (ArmComplete $outdir $arm.id) { Say "SKIP $($arm.id) - already complete"; continue }
    New-Item -ItemType Directory -Force -Path $outdir | Out-Null

    # Flags are a byte-for-byte match of what dp_d0 / dp_cold_d10 / dp_rand_d10 actually
    # ran (read from their *_multi5.json cmd_tail), NOT what the old script intended:
    # no --stock-kernel, i.e. the fused MoE kernels stay ON.
    $argList = @(
        $harness,
        '--binary', $binary, '--model', $model,
        '--tag', $arm.id, '--outdir', $outdir,
        '--langs', $arm.langs,
        '--threads', '16', '--ctx', '4096', '--ubatch', '512',
        '--moe-stream', '--cache-mb', '2000', '--dense-weights', 'anon',
        '--io-threads', '4', '--overlap',
        '--n-expert-used', '6',
        '--drop-cold-experts', '1.0',
        '--ppl-mode', 'decode',
        "--extra=--drop-policy", "--extra=$($arm.policy)"
    )
    Set-Content -Path "$outdir\command.txt" -Value ((@($py) + $argList) -join ' ') -Encoding utf8

    foreach ($attempt in 1..2) {
        Say "START $($arm.id) policy=$($arm.policy) langs=$($arm.langs) attempt=$attempt"
        $t0 = Get-Date
        $p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
            -RedirectStandardOutput "$outdir\harness.out.$attempt.log" `
            -RedirectStandardError  "$outdir\harness.err.$attempt.log" `
            -WindowStyle Hidden -PassThru -Wait
        $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        Say "END $($arm.id) attempt=$attempt rc=$($p.ExitCode) wall=${dt}s"
        if ((ArmComplete $outdir $arm.id)) {
            $bpb = (Get-Content "$outdir\$($arm.id)_multi5.json" -Raw | ConvertFrom-Json).macro_bpb
            Say "OK $($arm.id) macro_bpb=$bpb"
            break
        }
        # The pread failure is suspected transient (three clean languages preceded it).
        # One retry; then move on rather than killing the remaining arm.
        if ($attempt -eq 1) { Say "RETRY $($arm.id) - incomplete after attempt 1"; Start-Sleep -Seconds 60 }
        else { Say "GIVING UP on $($arm.id) after 2 attempts - continuing to next arm" }
    }
}

Say "drop-policy finish: run complete (see per-arm OK/GIVING UP lines above)"
