# Drop POLICY quality arms — is it *cold* experts, or would any experts do?
#
# THE QUESTION
# ------------
# `--drop-cold-experts` drops an expert when it is (a) not the token's best, (b) not
# resident in the expert cache, and (c) below a weight threshold. Condition (b) — the
# residency query — is what makes the drop "cold-aware", and it is also the suspected
# source of a fixed per-token compute tax (measured: at drop=0.3 two models dropped
# ~0.05 % of slots and still paid +7…21 % compute).
#
# So: does the *coldness* of the chosen experts matter for quality, or only how many
# are dropped? If random selection is as good, condition (b) buys nothing on the
# quality axis and can be considered for removal on the speed axis.
#
# ARMS (all four on the SAME new binary — see the identity note below)
#   dp_d0        d=0.0             machinery off — this build's own baseline
#   dp_cold_d10  d=1.0 policy cold today's rule, in this build
#   dp_rand_d10  d=1.0 policy random same COUNT per token, uniformly chosen non-best
#   dp_weight_d10 d=1.0 policy weight threshold only, no residency query
#
# HOW TO READ IT (declared before the numbers exist)
#   - cold ≈ random  -> coldness does not matter for quality; what matters is how many
#                       experts you drop. Condition (b) is then pure cost on this axis.
#   - cold ≪ random  -> "select the cold experts" is a real result worth naming: the
#                       cache-miss set is meaningfully better to discard than a random one.
#   - random ≪ cold  -> would be very surprising; treat as a bug hunt, not a finding.
#   - weight sits apart: it drops MORE (measured 63.4 % of slots vs cold's 46.9 % at
#     d=1.0) because it no longer protects resident experts, so its quality is expected
#     to be worse and is NOT a like-for-like comparison. It is here for completeness,
#     and its real question is speed, not quality.
#
# WHY A SEPARATE BASELINE, AND WHY NOTHING IS COMPARED TO THE EXISTING CURVE
# --------------------------------------------------------------------------
# The hostile review (2026-08-18) found that the same changeset carries a bump of the
# `third_party/llama.cpp` submodule pointer, e5605f3 -> 8d3c2ea — two CPU matmul
# commits, i.e. exactly the layer that decides floating-point rounding. The drop-policy
# code is bit-identical for `cold`, but bit-identical code is not bit-identical output
# across a kernel change. Therefore **every number this cell produces is comparable only
# to the other numbers in this cell**. Do not put `dp_cold_d10` next to the campaign
# curve's 0.7049320, and do not read `dp_d0` as 0.6780748: different binary.
#
# Model: Marco-Mini-Instruct-KEXP (6 GB, ~1.2 h per arm) rather than CalaQwen (13.4 GB,
# ~2.5 h), because the question is mechanistic and Marco is where the drop bites hardest
# (+12.41 % macro bpb at d=1.0 with renorm on, vs CalaQwen's +3.96 %) — so a difference
# between cold and random has the most room to show.

$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$py      = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$harness = "$root\scripts\run_multi5_ppl_host.py"
# The s2 build: the drop-policy patch applied on kalsa/kernel-s2-layer-fuse, which is
# the branch the campaign's pinned binary came from. The first build (build-pc-droppolicy,
# from main) rejected --no-moe-fused-gemv and killed the first attempt in 11 seconds.
# sha 262701dc32a96254. NOT the pinned binary (7722cb23…), which is never touched.
$binary  = "$root\build-pc-droppolicy-s2\cli\bmoe-cli.exe"
$model   = "$root\models\Marco-Mini-Instruct-KEXP.gguf"
$cell    = "$root\results\droppolicy_quality_marco"
$log     = "$root\logs\droppolicy-quality.log"

New-Item -ItemType Directory -Force -Path $cell | Out-Null

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
    Add-Content -Path "$cell\STATUS.txt" -Value $line -Encoding utf8
}

function ArmComplete([string]$dir, [string]$id) {
    $j = Join-Path $dir "${id}_multi5.json"
    if (-not (Test-Path $j)) { return $false }
    try { $d = Get-Content $j -Raw | ConvertFrom-Json } catch { return $false }
    return ($null -ne $d.finished) -and ($null -ne $d.macro_bpb)
}

if (-not (Test-Path $binary)) { Say "FATAL: $binary missing - build it first"; exit 2 }

Say "drop-policy quality start; waiting for the PC to go idle"
$waited = 0
while (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) {
    if ($waited % 1800 -eq 0) { Say "bmoe-cli busy (${waited}s)" }
    Start-Sleep -Seconds 60
    $waited += 60
    if ($waited -gt 86400) { Say "waited 24 h - giving up"; exit 1 }
}
Say "PC idle after ${waited}s; binary=$binary"

$arms = @(
    @{ id = 'dp_d0';         drop = '0.0'; policy = $null     },
    @{ id = 'dp_cold_d10';   drop = '1.0'; policy = 'cold'    },
    @{ id = 'dp_rand_d10';   drop = '1.0'; policy = 'random'  },
    @{ id = 'dp_weight_d10'; drop = '1.0'; policy = 'weight'  }
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
        '--n-expert-used', '6',
        '--drop-cold-experts', $arm.drop,
        '--ppl-mode', 'decode',
        # --stock-kernel appends --no-moe-fused-gemv/--no-moe-fused-ffn, which every
        # campaign arm uses. The FIRST attempt at this cell died in 11 s because it ran a
        # binary built from `main`, where those flags do not exist; the s2 build has them
        # (verified: accepted, exit 0). Keeping it means these arms use the same kernel
        # path as the curve — one less thing that differs.
        '--stock-kernel'
    )
    # Every armed cell states its policy explicitly, including `cold`: a result file
    # that does not name its policy is a result file nobody can trust later.
    if ($arm.policy) { $argList += "--extra=--drop-policy"; $argList += "--extra=$($arm.policy)" }
    Set-Content -Path "$outdir\command.txt" -Value ((@($py) + $argList) -join ' ') -Encoding utf8

    Say "START $($arm.id) drop=$($arm.drop) policy=$(if ($arm.policy) {$arm.policy} else {'(disarmed)'})"
    $t0 = Get-Date
    $env:PATH = (Split-Path $binary) + ';' + "$root\build-pc-droppolicy-s2\bin" + ';' + $env:PATH
    $p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
        -RedirectStandardOutput "$outdir\harness.out.log" `
        -RedirectStandardError  "$outdir\harness.err.log" `
        -WindowStyle Hidden -PassThru -Wait
    $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Set-Content -Path "$outdir\harness_rc.txt" -Value "$($p.ExitCode)`nseconds=$dt" -Encoding utf8
    Say "END $($arm.id) rc=$($p.ExitCode) wall=${dt}s"

    if ($p.ExitCode -ne 0) { Say "ARM FAILED $($arm.id) rc=$($p.ExitCode) - stopping"; exit 2 }
    if (-not (ArmComplete $outdir $arm.id)) { Say "ARM INCOMPLETE $($arm.id) - stopping"; exit 3 }
    $bpb = (Get-Content "$outdir\$($arm.id)_multi5.json" -Raw | ConvertFrom-Json).macro_bpb
    Say "OK $($arm.id) macro_bpb=$bpb"
}

Say "drop-policy quality finished - all arms complete"
