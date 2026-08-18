# Renormalisation ablation on Marco-Mini-Instruct-KEXP (Marco1c) — quality axis.
#
# WHY
# ---
# M4 (results/m4_renorm_ablation) showed on CalaQwen that ~70% of the quality cost
# of dropping comes from the survivor rescale rather than from the drop itself, and
# that turning it off is better at every level tested (d=0.5 -0.17%, d=0.65 -0.70%,
# d=1.0 -2.67%). The obvious conclusion is "ship --drop-no-renorm".
#
# But that measurement exists on ONE model. Marco1c ships on all three phones, and
# for it we have no renorm measurement at all. Recommending a flag for a model we
# never measured it on is exactly the kind of extrapolation this campaign keeps
# getting punished for. This cell closes that.
#
# The drop level under test is 1.0, not 0.65: on Marco-Mini the device sweep
# (results/dropsweep_jelly) found d=0.65 strictly dominated -- it costs quality AND
# time (+10.0% slower than no drop) -- while d=1.0 is -27.2% time and -68.5% bytes.
# So the candidate config for Marco is d=1.0, and what we need to know is what it
# costs in quality with the rescale on versus off.
#
# ARMS (3): d=0.0 baseline, d=1.0 renorm ON, d=1.0 renorm OFF.
#
# HOW TO READ IT (declared before the numbers exist)
#   - OFF better than ON, as on CalaQwen -> the renorm finding is not model-specific
#     and --drop-no-renorm ships everywhere.
#   - OFF == ON to full precision -> NO-OP FLAG, not a null (the CLI rejects unknown
#     args with rc=1, so a running engine proves the flag parsed; identical bpb
#     would instead mean something deeper is wrong).
#   - OFF worse than ON -> the renorm helps here and hurts on CalaQwen, i.e. the
#     right setting is per-model, which is the answer the owner asked for anyway.
#
# MODEL IDENTITY: models\Marco-Mini-Instruct-KEXP.gguf, sha256 starting
# 2f92195854011538 — verified 2026-08-17 to be byte-identical to the copy on the
# Jelly that produced the device sweep. There is now exactly one quantisation of
# each model on this PC (see models\DELETED-2026-08-17.md), so "the Marco model"
# is unambiguous.

$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$py      = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$harness = "$root\scripts\run_multi5_ppl_host.py"
$binary  = "$root\build-pc-mellum-ppl\cli\bmoe-cli.exe"
$model   = "$root\models\Marco-Mini-Instruct-KEXP.gguf"
$cell    = "$root\results\marco_renorm_ablation"
$log     = "$root\logs\marco-renorm-ablation.log"

New-Item -ItemType Directory -Force -Path $cell | Out-Null

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
    Add-Content -Path "$cell\STATUS.txt" -Value $line -Encoding utf8
}

# `<tag>_multi5.json` is written after every language and on both failure paths
# (run_multi5_ppl_host.py:218,229,258); only the final write adds `finished`.
# Testing for the file alone lets a crashed one-language arm pass as complete.
function ArmComplete([string]$dir, [string]$id) {
    $j = Join-Path $dir "${id}_multi5.json"
    if (-not (Test-Path $j)) { return $false }
    try { $d = Get-Content $j -Raw | ConvertFrom-Json } catch { return $false }
    return ($null -ne $d.finished) -and ($null -ne $d.macro_bpb)
}

# Never two streaming jobs at once: this PC has ~0.1 GB genuinely free and has
# OOM-reset under that load before.
Say "marco renorm ablation start; waiting for the PC to go idle"
$waited = 0
while (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) {
    if ($waited % 1800 -eq 0) { Say "bmoe-cli busy (${waited}s)" }
    Start-Sleep -Seconds 60
    $waited += 60
    if ($waited -gt 86400) { Say "waited 24 h - giving up"; exit 1 }
}
Say "PC idle after ${waited}s"

# marco_k8d0 added 2026-08-18: the stock k=8 reference. Without it we know that
# d=1.0+no-renorm costs +5.71% macro bpb against k=6/no-drop, but not whether that
# fits the campaign's MACRO_PASS = 0.04 budget — and on CalaQwen the same question
# turned out to be the difference between "50% of budget" and "passes by 0.0011".
# `k` is per-arm now; completed arms are skipped, so this re-run costs only the new one.
$arms = @(
    @{ id = 'marco_k6d0';        k = '6'; drop = '0.0'; norenorm = $false },
    @{ id = 'marco_k6d10';       k = '6'; drop = '1.0'; norenorm = $false },
    @{ id = 'marco_k6d10_noren'; k = '6'; drop = '1.0'; norenorm = $true  },
    @{ id = 'marco_k8d0';        k = '8'; drop = '0.0'; norenorm = $false }
)

foreach ($arm in $arms) {
    $outdir = "$cell\$($arm.id)"
    if (ArmComplete $outdir $arm.id) { Say "SKIP $($arm.id) - already complete"; continue }
    New-Item -ItemType Directory -Force -Path $outdir | Out-Null

    $argList = @(
        $harness,
        '--binary', $binary,
        '--model', $model,
        '--tag', $arm.id,
        '--outdir', $outdir,
        '--langs', 'en,es,fr,it,zh',
        '--threads', '16',
        '--ctx', '4096',
        '--ubatch', '512',
        '--moe-stream',
        '--cache-mb', '2000',
        '--dense-weights', 'anon',
        '--io-threads', '4',
        '--overlap',
        '--n-expert-used', $arm.k,
        '--drop-cold-experts', $arm.drop,
        '--ppl-mode', 'decode',
        '--stock-kernel'
    )
    if ($arm.norenorm) { $argList += '--extra=--drop-no-renorm' }
    Set-Content -Path "$outdir\command.txt" -Value ((@($py) + $argList) -join ' ') -Encoding utf8

    Say "START $($arm.id) drop=$($arm.drop) renorm=$(if ($arm.norenorm) {'OFF'} else {'ON'})"
    $t0 = Get-Date
    $env:PATH = (Split-Path $binary) + ';' + "$root\build-pc-mellum-ppl\bin" + ';' + $env:PATH
    $p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
        -RedirectStandardOutput "$outdir\harness.out.log" `
        -RedirectStandardError  "$outdir\harness.err.log" `
        -WindowStyle Hidden -PassThru -Wait
    $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Set-Content -Path "$outdir\harness_rc.txt" -Value "$($p.ExitCode)`nseconds=$dt" -Encoding utf8
    Say "END $($arm.id) rc=$($p.ExitCode) wall=${dt}s"

    if ($p.ExitCode -ne 0) {
        Say "ARM FAILED $($arm.id) rc=$($p.ExitCode) - stopping the chain; see $outdir\harness.err.log"
        exit 2
    }
    if (-not (ArmComplete $outdir $arm.id)) {
        Say "ARM INCOMPLETE $($arm.id): rc=0 but no finished/macro_bpb - stopping the chain"
        exit 3
    }
    $bpb = (Get-Content "$outdir\$($arm.id)_multi5.json" -Raw | ConvertFrom-Json).macro_bpb
    Say "OK $($arm.id) macro_bpb=$bpb"
}

Say "marco renorm ablation finished - all arms complete"
