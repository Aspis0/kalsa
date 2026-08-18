# M4 renormalization ablation on CalaQwen — chained after the drop curve.
#
# THE QUESTION
# ------------
# The campaign's headline quality result is that --drop-cold-experts costs almost
# nothing (macro bpb 0.6781 at d=0.0 -> 0.6803 at d=0.5, +0.33 %) and has been
# read as "cold experts are under-trained noise; removing them is nearly free".
#
# But drop_renorm defaults to TRUE (config.h:175). router_hook.cpp:278-282
# rescales the surviving weights by total/kept > 1 after a drop, and the top
# expert is never droppable (line 262). So the operation actually applied is
# "sharpen the mixture toward its strongest experts", not "delete experts". Two
# independent external audits ranked separating these the single highest-value
# missing measurement in the campaign.
#
# THE DESIGN (2 x 2, pre-declared 2026-08-17 before any arm ran)
# ---------------------------------------------------------------
#            renorm ON (default)      renorm OFF (--drop-no-renorm)
#   d=0.5    k6d05   0.6802864 DONE   k6d05_norenorm   <- this script
#   d=1.0    k6d10   0.7049320 DONE   k6d10_norenorm   <- this script
#
# Only the two OFF cells are missing; the ON cells are already measured on this
# exact binary and model, so the contrast is confound-free. d=1.0 is included
# because at d=0.5 the renorm correction is small and a null there would be
# uninformative; d=1.0 is where the quality cost is largest (+4.0 %) and where
# renormalization has the most work to do.
#
# HOW TO READ THE OUTCOME (declared in advance)
#   - OFF ~= ON at both levels -> renormalization is not the mechanism. The
#     "dropping cold experts is nearly free" claim survives as stated.
#   - OFF clearly worse than ON -> the renormalization is carrying the result.
#     The honest claim becomes "sharpening the mixture is nearly free", which is
#     a different and much less novel statement, and the wording in PLAN.md,
#     ALIVE.md and NAMING.md has to change.
#   - OFF better than ON -> the default is wrong and there is free quality on the
#     table.
#
# POSITIVE CONTROL THAT THE FLAG ACTUALLY FIRED (declared in advance)
# -------------------------------------------------------------------
# In --ppl-decode mode the engine echoes only `drop_cold=0.500 k=6`; it never
# prints drop_renorm, and the ppl CSV is just pos,token_id,logprob. So there is no
# direct log line proving --drop-no-renorm took effect, and a null result would be
# indistinguishable from a silently ignored flag. The decision rule, fixed here
# BEFORE any number exists:
#
#   macro_bpb(OFF) identical to macro_bpb(ON) at full precision
#       -> treat as NO-OP FLAG, not as "renormalization does not matter".
#          Investigate the flag before drawing any conclusion.
#   macro_bpb(OFF) different but close
#       -> a real null: the renorm is doing little.
#   macro_bpb(OFF) clearly worse
#       -> the renorm is carrying the result.
#
# This is sound because with renorm off the surviving weights are NOT rescaled by
# total/kept (router_hook.cpp:278-282), so the layer output is systematically
# shrunk and the perplexity cannot come out bit-identical.
#
# WHY IT IS CHAINED, NOT PARALLEL
# The PC has 31.6 GB RAM with ~0.1 GB genuinely free; two 35B streaming jobs
# thrash RAM/IO and this machine has already OOM-reset once under that load.
# This script therefore waits for the curve orchestrator to exit AND for every
# bmoe-cli process to be gone before it starts anything.
#
# NOTE ON THE THIRD ARM
# A random-drop arm (drop the same COUNT of experts, chosen at random rather than
# by coldness) would separate "which experts" from "how many". No such flag
# exists in the engine, so it needs a code change and a rebuild -- and a new
# binary would break the identity pin that makes these arms comparable. It is
# left as an owner decision, not smuggled in tonight.

$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$py      = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$harness = "$root\scripts\run_multi5_ppl_host.py"
$binary  = "$root\build-pc-mellum-ppl\cli\bmoe-cli.exe"
$model   = "$root\models\Qwen3.6-35B-A3B-KEXP.gguf"
$cell    = "$root\results\m4_renorm_ablation"
$log     = "$root\logs\m4-renorm-ablation.log"
$statusF = "$cell\STATUS.txt"
$orchPid = 66864   # results/calaqwen_dropcurve/orchestrator.pid.txt

New-Item -ItemType Directory -Force -Path $cell | Out-Null

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log     -Value $line -Encoding utf8
    Add-Content -Path $statusF -Value $line -Encoding utf8
}

# A bare PID is not an identity. Once the orchestrator exits, Windows is free to
# hand 66864 to any other process, and this machine spawns python constantly; the
# wait loop would then block on a stranger until the 24 h cap and the night would
# be spent doing nothing. Verify the process is actually the curve orchestrator.
function OrchAlive() {
    $p = Get-Process -Id $orchPid -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $orchPid" -ErrorAction Stop).CommandLine
    } catch { $cmd = $null }
    if ($cmd -and $cmd -notmatch 'run_mellum2_dropcurve') {
        Say "pid $orchPid is no longer the orchestrator (cmdline: $cmd) - ignoring it"
        return $false
    }
    return $true
}

function Busy() {
    if (OrchAlive) { return 'orchestrator' }
    # The real gate: never run while any engine process is alive, whoever started it.
    if (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) { return 'bmoe-cli' }
    return $null
}

# `<tag>_multi5.json` is NOT a completion marker. run_multi5_ppl_host.py writes it
# after every language (line 258) AND on both failure paths (lines 218, 229); only
# the final write adds the `finished` key (line 265). Testing for the file alone
# would let a crashed 1-language arm be skipped forever as "already complete", and
# the ablation would silently compare a partial OFF arm against a full ON arm --
# which is exactly the wrong-data-that-looks-right failure this cell must not have.
function ArmComplete([string]$dir, [string]$id) {
    $j = Join-Path $dir "${id}_multi5.json"
    if (-not (Test-Path $j)) { return $false }
    try { $d = Get-Content $j -Raw | ConvertFrom-Json } catch { return $false }
    return ($null -ne $d.finished) -and ($null -ne $d.macro_bpb)
}

Say "chained M4 runner start; waiting for the PC to go idle (orch pid=$orchPid)"
$waited = 0
while ($true) {
    $b = Busy
    if (-not $b) { break }
    if ($waited % 1800 -eq 0) { Say "still waiting: $b busy (${waited}s)" }
    Start-Sleep -Seconds 60
    $waited += 60
    if ($waited -gt 86400) { Say "waited 24 h and the PC never went idle - giving up"; exit 1 }
}
Say "PC idle after ${waited}s - starting ablation arms"

# drop level -> arm id. Both use --drop-no-renorm; everything else is byte-for-byte
# the invocation the ON arms used (results/calaqwen_dropcurve/k6d05/command.txt).
# k6d065_norenorm added 2026-08-17 07:50, after the first two arms closed. With the
# renorm harm measured at -0.0012 (d=0.5) and -0.0188 (d=1.0), the shipped default's
# own level is the one arm that decides whether flipping a single flag improves the
# config we already ship, without touching the drop level at all. Completed arms are
# skipped by ArmComplete, so this re-run costs only the new arm.
$arms = @(
    @{ id = 'k6d05_norenorm';  drop = '0.5'  },
    @{ id = 'k6d10_norenorm';  drop = '1.0'  },
    @{ id = 'k6d065_norenorm'; drop = '0.65' }
)

foreach ($arm in $arms) {
    $outdir = "$cell\$($arm.id)"
    if (ArmComplete $outdir $arm.id) { Say "SKIP $($arm.id) - already complete (finished + macro_bpb present)"; continue }
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
        '--n-expert-used', '6',
        '--drop-cold-experts', $arm.drop,
        '--ppl-mode', 'decode',
        '--stock-kernel',
        '--extra=--drop-no-renorm'
    )
    Set-Content -Path "$outdir\command.txt" -Value ((@($py) + $argList) -join ' ') -Encoding utf8

    Say "START $($arm.id) drop=$($arm.drop) renorm=OFF"
    $t0 = Get-Date
    # The harness resolves the engine's DLLs from PATH, exactly as the curve
    # orchestrator does (run_mellum2_dropcurve.py:275-276).
    $env:PATH = (Split-Path $binary) + ';' + "$root\build-pc-mellum-ppl\bin" + ';' + $env:PATH
    $p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
        -RedirectStandardOutput "$outdir\harness.out.log" `
        -RedirectStandardError  "$outdir\harness.err.log" `
        -WindowStyle Hidden -PassThru -Wait
    $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Set-Content -Path "$outdir\harness_rc.txt" -Value "$($p.ExitCode)`nseconds=$dt" -Encoding utf8
    Say "END $($arm.id) rc=$($p.ExitCode) wall=${dt}s"

    # A nonzero rc, or a JSON without `finished`, means this arm is NOT comparable
    # to the ON arm it exists to be compared against. Stop the chain and say so:
    # a loud stop is worth more than a second arm sitting next to a broken first one.
    if ($p.ExitCode -ne 0) {
        Say "ARM FAILED $($arm.id) rc=$($p.ExitCode) - stopping the chain; see $outdir\harness.err.log"
        Say "M4 ablation runner ABORTED - the ablation is INCOMPLETE, do not compare these arms"
        exit 2
    }
    if (-not (ArmComplete $outdir $arm.id)) {
        Say "ARM INCOMPLETE $($arm.id): rc=0 but the json has no finished/macro_bpb - stopping the chain"
        Say "M4 ablation runner ABORTED - the ablation is INCOMPLETE, do not compare these arms"
        exit 3
    }
    $bpb = (Get-Content "$outdir\$($arm.id)_multi5.json" -Raw | ConvertFrom-Json).macro_bpb
    Say "OK $($arm.id) macro_bpb=$bpb"
}

Say "M4 ablation runner finished - both OFF arms complete"

# Emit the verdict here rather than leaving it to whoever reads the logs. The
# summariser encodes the decision rule that was fixed before any number existed
# (including the no-op guard), so the conclusion does not depend on who is awake.
$sum = Start-Process -FilePath $py -ArgumentList @("$root\scripts\summarize_m4_renorm.py") `
    -WorkingDirectory $root -RedirectStandardOutput "$cell\verdict.out.log" `
    -RedirectStandardError "$cell\verdict.err.log" -WindowStyle Hidden -PassThru -Wait
Say "verdict written rc=$($sum.ExitCode) -> $cell\VERDICT.md"
