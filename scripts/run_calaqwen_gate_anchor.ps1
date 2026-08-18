# CalaQwen k8 d0 anchor — the reference that makes the CalaQwen quality gate real.
#
# WHY THIS EXISTS
# ---------------
# Every `GATE_PASS` in results/calaqwen_dropcurve is vacuous. `run_mellum2_dropcurve.py:31`
# hardcodes GATE_DIR = results/mellum2_ppl_gate, so the k8d0 anchor it loads is
# Mellum2-12B (macro 1.020819). Reusing that script for CalaQwen left the anchor
# unchanged, so `d_macro_vs_k8d0` is CalaQwen minus Mellum2 (about -0.34) against a
# MACRO_PASS threshold of 0.04: every arm passes by ~0.38 bpb because CalaQwen is a
# stronger model than Mellum2, which says nothing at all about the drop.
# See results/calaqwen_dropcurve/ERRATUM.md.
#
# The fix is one measurement: the same k=8, drop=0 stock arm, on CalaQwen, on this
# binary and corpus. With it, `macro(arm) - macro(k8d0)` becomes a real statement --
# "the drop costs less than stock k=8 by X" -- on one model instead of two.
#
# WHAT IT WILL SAY (declared before running)
# ------------------------------------------
# CalaQwen k6 d0 measured 0.6780748. The k8 anchor is the stock configuration, more
# experts per token, so it should come out LOWER (better) than k6 d0 -- that is the
# whole reason k=6 is a saving. Expect roughly 0.66-0.675.
#   - If k8d0 < k6d0, the gate becomes meaningful and every drop arm can finally be
#     scored against a same-model stock reference.
#   - If k8d0 >= k6d0, then dropping from 8 experts to 6 costs nothing or helps on
#     this model, which is itself a result worth having and changes how k=6 is
#     justified.
# Either way this is the anchor the campaign has been quoting without owning.
#
# Chained: never runs while another streaming job holds the machine.

$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$py      = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$harness = "$root\scripts\run_multi5_ppl_host.py"
$binary  = "$root\build-pc-mellum-ppl\cli\bmoe-cli.exe"
$model   = "$root\models\Qwen3.6-35B-A3B-KEXP.gguf"
$cell    = "$root\results\calaqwen_gate_anchor"
$log     = "$root\logs\calaqwen-gate-anchor.log"
$armId   = 'calaqwen_k8d0'

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

Say "gate anchor start; waiting for the PC to go idle"
$waited = 0
while (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) {
    if ($waited % 1800 -eq 0) { Say "bmoe-cli busy (${waited}s)" }
    Start-Sleep -Seconds 60
    $waited += 60
    if ($waited -gt 86400) { Say "waited 24 h - giving up"; exit 1 }
}
Say "PC idle after ${waited}s"

$outdir = "$cell\$armId"
if (ArmComplete $outdir $armId) { Say "SKIP - already complete"; exit 0 }
New-Item -ItemType Directory -Force -Path $outdir | Out-Null

# Byte-for-byte the curve arms' invocation, with k=8 and no drop: the anchor must
# differ from the arms it anchors ONLY in the two things under test.
$argList = @(
    $harness,
    '--binary', $binary,
    '--model', $model,
    '--tag', $armId,
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
    '--n-expert-used', '8',
    '--drop-cold-experts', '0.0',
    '--ppl-mode', 'decode',
    '--stock-kernel'
)
Set-Content -Path "$outdir\command.txt" -Value ((@($py) + $argList) -join ' ') -Encoding utf8

Say "START $armId k=8 drop=0.0 (stock reference on CalaQwen)"
$t0 = Get-Date
$env:PATH = (Split-Path $binary) + ';' + "$root\build-pc-mellum-ppl\bin" + ';' + $env:PATH
$p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
    -RedirectStandardOutput "$outdir\harness.out.log" `
    -RedirectStandardError  "$outdir\harness.err.log" `
    -WindowStyle Hidden -PassThru -Wait
$dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
Set-Content -Path "$outdir\harness_rc.txt" -Value "$($p.ExitCode)`nseconds=$dt" -Encoding utf8
Say "END rc=$($p.ExitCode) wall=${dt}s"

if ($p.ExitCode -ne 0) { Say "FAILED rc=$($p.ExitCode) - see $outdir\harness.err.log"; exit 2 }
if (-not (ArmComplete $outdir $armId)) { Say "INCOMPLETE: rc=0 but no finished/macro_bpb"; exit 3 }

$anchor = (Get-Content "$outdir\$armId`_multi5.json" -Raw | ConvertFrom-Json).macro_bpb
Say "OK $armId macro_bpb=$anchor"

# Score the whole CalaQwen drop curve against a SAME-MODEL anchor at last.
$curve = @(
    @{ d = '0.00'; f = "$root\results\calaqwen_dropcurve\k6d0\k6d0_multi5.json" },
    @{ d = '0.30'; f = "$root\results\calaqwen_dropcurve\k6d03\k6d03_multi5.json" },
    @{ d = '0.50'; f = "$root\results\calaqwen_dropcurve\k6d05\k6d05_multi5.json" },
    @{ d = '0.65'; f = "$root\results\calaqwen_dropcurve\k6d065\k6d065_multi5.json" },
    @{ d = '0.80'; f = "$root\results\calaqwen_dropcurve\k6d08\k6d08_multi5.json" },
    @{ d = '1.00'; f = "$root\results\calaqwen_dropcurve\k6d10\k6d10_multi5.json" }
)
$lines = @(
    "# CalaQwen quality gate, against a CalaQwen anchor",
    "",
    "Anchor measured $((Get-Date).ToString('yyyy-MM-dd')): **k=8, drop=0.0, macro bpb = $anchor** on the",
    "pinned binary and the multi5 corpus. This replaces the Mellum2 anchor that made",
    "every previous ``GATE_PASS`` on this curve vacuous (see",
    "``results/calaqwen_dropcurve/ERRATUM.md``).",
    "",
    "Threshold as used by the curve scripts: MACRO_PASS = 0.04 bpb worse than the anchor.",
    "",
    "| drop | macro bpb | vs k8d0 | gate |",
    "|---|---|---|---|"
)
foreach ($c in $curve) {
    if (-not (Test-Path $c.f)) { $lines += "| $($c.d) | *missing* | — | — |"; continue }
    $m = (Get-Content $c.f -Raw | ConvertFrom-Json).macro_bpb
    if ($null -eq $m) { $lines += "| $($c.d) | *incomplete* | — | — |"; continue }
    $d = $m - $anchor
    $gate = if ($d -le 0.04) { 'PASS' } else { 'FAIL' }
    $lines += ("| {0} | {1:F7} | {2:+0.0000000;-0.0000000} | {3} |" -f $c.d, $m, $d, $gate)
}
$lines += ""
$lines += "A negative ``vs k8d0`` means the k=6 arm is BETTER than stock k=8 on this model."
Set-Content -Path "$cell\GATE.md" -Value ($lines -join "`n") -Encoding utf8
Say "GATE.md written"
