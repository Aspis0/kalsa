# Answer-quality A/B: do the candidate configs still ANSWER well?
#
# WHY THIS CELL EXISTS (owner question, 2026-08-17)
# -------------------------------------------------
# The entire campaign has measured two things: speed (tok/s, bytes) and bpb
# (how well the model predicts held-out text). It has never once measured whether
# the model still answers well. Those are different questions, and bpb is a weak
# proxy for the second one: a config can predict text at nearly the same bpb and
# still lose instruction-following, factual grounding, code correctness or fluency
# in a specific language — because dropping experts removes capacity unevenly, and
# a 5-language perplexity average is exactly the kind of metric that hides that.
#
# So this generates real answers with each candidate config, on the same prompts,
# at temperature 0 (deterministic: every difference between two outputs is caused
# by the config, not by sampling), and lays them out side by side to be read.
#
# CONFIGS (CalaQwen, the flagship)
#   stock      k=8, no drop            — the quality reference; what we give up from
#   k6d0       k=6, no drop            — isolates "fewer experts" from "dropping"
#   shipped    k=6, drop 0.65          — what ships today
#   candidate  k=6, drop 1.0, no-renorm — the proposed replacement
#
# WHAT TO LOOK FOR, and it is not "which is prettier":
#   - f45_3_istruzioni has checkable constraints (exactly three sentences, etc.).
#     A config that stops honouring them is degraded regardless of its bpb.
#   - f45_4_codice asks for one named function with a precise signature. Either it
#     compiles and is right, or it is not.
#   - long_conversational_it is the one that catches collapse into repetition or
#     drift out of Italian on long output — the failure mode a perplexity number
#     over short slices will not show.
#   - f45_1 / f45_2 / f45_5 are read for factual grounding and coherence.
#
# This is exploratory and qualitative BY DESIGN. It produces evidence to read, not
# a p-value. No config is declared "the same" on the basis of this cell alone.

$ErrorActionPreference = 'Continue'
$root   = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$binary = "$root\build-pc-mellum-ppl\cli\bmoe-cli.exe"
$model  = "$root\models\Qwen3.6-35B-A3B-KEXP.gguf"
$cell   = "$root\results\answer_quality_calaqwen"
$log    = "$root\logs\answer-quality-ab.log"
$ngen   = 420

New-Item -ItemType Directory -Force -Path "$cell\gen" | Out-Null

function Say([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
    Add-Content -Path "$cell\STATUS.txt" -Value $line -Encoding utf8
}

$configs = @(
    @{ id = 'stock';     k = '8'; drop = '0.0';  noren = $false; label = 'k=8, nessun drop (riferimento)' },
    @{ id = 'k6d0';      k = '6'; drop = '0.0';  noren = $false; label = 'k=6, nessun drop' },
    @{ id = 'shipped';   k = '6'; drop = '0.65'; noren = $false; label = 'k=6, drop 0.65 — SPEDITA OGGI' },
    @{ id = 'candidate'; k = '6'; drop = '1.0';  noren = $true;  label = 'k=6, drop 1.0 + no-renorm — CANDIDATA' }
)
$prompts = @('f45_1_esplicativo','f45_3_istruzioni','f45_4_codice','f45_5_ragionamento','f45_2_scrittura','long_conversational_it')

Say "answer-quality A/B start: $($configs.Count) configs x $($prompts.Count) prompts, n=$ngen, temp 0"

while (Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue) { Say "bmoe-cli busy - waiting"; Start-Sleep -Seconds 60 }

$env:PATH = (Split-Path $binary) + ';' + "$root\build-pc-mellum-ppl\bin" + ';' + $env:PATH

foreach ($p in $prompts) {
    $pf = "$root\prompts\$p.txt"
    if (-not (Test-Path $pf)) { Say "MISSING prompt $pf - skipping"; continue }
    $ptext = Get-Content $pf -Raw

    foreach ($c in $configs) {
        $out = "$cell\gen\${p}__$($c.id).txt"
        if ((Test-Path $out) -and ((Get-Item $out).Length -gt 0)) { Say "SKIP $p / $($c.id) - already generated"; continue }

        $a = @(
            '-m', $model, '-p', $ptext, '-n', "$ngen",
            '--moe-stream', '--cache-mb', '2000', '--dense-weights', 'anon', '--overlap',
            '--io-threads', '4', '--ubatch', '512', '-t', '16', '-c', '4096',
            '--temp', '0', '--chatml', '--no-think',
            '--n-expert-used', $c.k, '--drop-cold-experts', $c.drop,
            '--no-moe-fused-gemv', '--no-moe-fused-ffn'
        )
        if ($c.noren) { $a += '--drop-no-renorm' }

        Say "GEN $p / $($c.id) (k=$($c.k) drop=$($c.drop) noren=$($c.noren))"
        $t0 = Get-Date
        $pr = Start-Process -FilePath $binary -ArgumentList $a -WorkingDirectory $root `
              -RedirectStandardOutput $out -RedirectStandardError "$cell\gen\${p}__$($c.id).err" `
              -WindowStyle Hidden -PassThru -Wait
        $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        $len = if (Test-Path $out) { (Get-Item $out).Length } else { 0 }
        Say "  rc=$($pr.ExitCode) wall=${dt}s bytes=$len"
    }
}

# Lay the answers out side by side, grouped by prompt, so they can be read and judged.
$md = @(
    '# Qualita delle risposte — CalaQwen, quattro configurazioni, stesse domande',
    '',
    'Generato a **temperatura 0**: e deterministico, quindi ogni differenza fra due',
    'risposte e causata dalla configurazione, non dal campionamento.',
    '',
    '| id | configurazione |',
    '|---|---|'
)
foreach ($c in $configs) { $md += "| ``$($c.id)`` | $($c.label) |" }
$md += @('', 'Cosa guardare: in `f45_3_istruzioni` i vincoli sono verificabili (esattamente tre frasi);',
         'in `f45_4_codice` la funzione o e corretta o non lo e; in `long_conversational_it` si vede',
         'se la prosa collassa in ripetizioni o esce dall''italiano. Sono i guasti che una media di',
         'perplexity non mostra.', '')

foreach ($p in $prompts) {
    $pf = "$root\prompts\$p.txt"
    if (-not (Test-Path $pf)) { continue }
    $md += @('---', '', "## $p", '', '<details><summary>prompt</summary>', '', '```', (Get-Content $pf -Raw).TrimEnd(), '```', '', '</details>', '')
    foreach ($c in $configs) {
        $f = "$cell\gen\${p}__$($c.id).txt"
        $body = if (Test-Path $f) { (Get-Content $f -Raw) } else { '(mancante)' }
        if ([string]::IsNullOrWhiteSpace($body)) { $body = '(vuoto)' }
        $md += @("### $($c.id) — $($c.label)", '', '```', $body.TrimEnd(), '```', '')
    }
}
Set-Content -Path "$cell\ANSWERS.md" -Value ($md -join "`n") -Encoding utf8
Say "ANSWERS.md written"
