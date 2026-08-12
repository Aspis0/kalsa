# Marco Phase 1 quality grid — fail-fast IT v2 + EN, then optional full multi5
# Declared gates: results/marco_phase1/PROTOCOL.md
$ErrorActionPreference = "Stop"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$bin = Join-Path $root "build-pc\cli\bmoe-cli.exe"
$py = Join-Path $root "scripts\run_multi5_ppl_host.py"
$model = Join-Path $root "models\Marco-Mini-Instruct.i1-Q4_K_M.gguf"
$outRoot = Join-Path $root "results\marco_phase1"
$csv = Join-Path $outRoot "runs_quality.csv"
$log = Join-Path $root "logs\marco_phase1_quality.log"

function L($m) {
  $t = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $m
  Add-Content -Path $log -Value $t -Encoding utf8
  Write-Host $t
}

function Ensure-Csv {
  if (-not (Test-Path $csv)) {
    "ts,cell,k,drop,langs,lang,bpb,ppl,n_tokens,n_bytes,seconds,delta_vs_a0,gate_failfast" |
      Set-Content $csv -Encoding utf8
  }
}

function Get-Bpb($jsonPath, $lang) {
  $d = Get-Content $jsonPath -Raw -Encoding utf8 | ConvertFrom-Json
  return $d.langs.$lang
}

# A0 anchors (IT from v2 only)
$A0 = @{
  en = 0.6051011731162046
  es = 0.6766127803280786
  fr = 0.723385772761425
  it = 0.7501260841791423   # ppl_it_v2 — NOT literary 1.6377
  zh = 0.8833572076708988
}

New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Ensure-Csv
L "PHASE1 quality start"
L "model=$model"
L "A0 anchors EN=$($A0.en) IT_v2=$($A0.it)"

# cells: id, k, drop
$cells = @(
  @{ id = "A1"; k = 8; drop = 0.65 },
  @{ id = "A2"; k = 6; drop = 0.65 },
  @{ id = "A3"; k = 6; drop = 0.50 }
)

$passFull = @()

foreach ($c in $cells) {
  $id = $c.id; $k = $c.k; $drop = $c.drop
  $od = Join-Path $outRoot "$id\failfast"
  New-Item -ItemType Directory -Force -Path $od | Out-Null
  L "=== $id fail-fast IT+EN k=$k drop=$drop ==="

  $args = @(
    $py, "--binary", $bin, "--model", $model, "--tag", $id,
    "--outdir", $od, "--langs", "it,en",
    "--threads", "8", "--ctx", "4096", "--ubatch", "512",
    "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon",
    "--io-threads", "4", "--overlap",
    "--n-expert-used", "$k",
    "--drop-cold-experts", "$drop"
  )
  & python @args
  if ($LASTEXITCODE -ne 0) {
    L "FAIL $id runner rc=$LASTEXITCODE"
    continue
  }

  $json = Join-Path $od "${id}_multi5.json"
  $ok = $true
  foreach ($lang in @("it", "en")) {
    $e = Get-Bpb $json $lang
    $bpb = [double]$e.bpb
    $a0b = [double]$A0[$lang]
    $delta = $bpb - $a0b
    $g = if ($delta -le 0.05) { "PASS" } else { "FAIL" }
    if ($g -eq "FAIL") { $ok = $false }
    $line = "{0},{1},{2},{3},it+en,{4},{5},{6},{7},{8},{9},{10},{11}" -f `
      (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $id, $k, $drop, $lang, `
      $bpb, $e.ppl, $e.n_tokens, $e.n_bytes, $e.seconds, $delta, $g
    Add-Content $csv $line -Encoding utf8
    L "$id $lang bpb=$bpb delta_A0=$delta $g"
  }

  if ($ok) {
    L "$id FAILFAST PASS -> queue full multi5"
    $passFull += $c
  } else {
    L "$id FAILFAST FAIL -> no full multi5"
  }
}

# Full multi5 for passers
foreach ($c in $passFull) {
  $id = $c.id; $k = $c.k; $drop = $c.drop
  $od = Join-Path $outRoot "$id\full"
  New-Item -ItemType Directory -Force -Path $od | Out-Null
  L "=== $id FULL multi5 k=$k drop=$drop ==="
  $args = @(
    $py, "--binary", $bin, "--model", $model, "--tag", $id,
    "--outdir", $od, "--langs", "en,es,fr,it,zh",
    "--threads", "8", "--ctx", "4096", "--ubatch", "512",
    "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon",
    "--io-threads", "4", "--overlap",
    "--n-expert-used", "$k",
    "--drop-cold-experts", "$drop"
  )
  & python @args
  L "$id full rc=$LASTEXITCODE"
  if ($LASTEXITCODE -ne 0) { continue }

  $json = Join-Path $od "${id}_multi5.json"
  $d = Get-Content $json -Raw -Encoding utf8 | ConvertFrom-Json
  $sum = 0.0; $n = 0
  $failLang = $false
  foreach ($lang in @("en", "es", "fr", "it", "zh")) {
    $bpb = [double]$d.langs.$lang.bpb
    $delta = $bpb - [double]$A0[$lang]
    $g = if ($delta -le 0.10) { "PASS" } else { "FAIL"; $failLang = $true }
    $sum += $bpb; $n++
    $line = "{0},{1},{2},{3},full,{4},{5},{6},{7},{8},{9},{10},{11}" -f `
      (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $id, $k, $drop, $lang, `
      $bpb, $d.langs.$lang.ppl, $d.langs.$lang.n_tokens, $d.langs.$lang.n_bytes, `
      $d.langs.$lang.seconds, $delta, $g
    Add-Content $csv $line -Encoding utf8
    L "$id full $lang bpb=$bpb dA0=$delta $g"
  }
  $macro = $sum / $n
  $macroA0 = (0.6051011731162046 + 0.6766127803280786 + 0.723385772761425 + 0.7501260841791423 + 0.8833572076708988) / 5.0
  $dMacro = $macro - $macroA0
  $gM = if ((-not $failLang) -and ($dMacro -le 0.04)) { "PASS" } else { "FAIL" }
  L "$id macro=$macro macroA0=$macroA0 dMacro=$dMacro full_gate=$gM"
}

L "PHASE1 quality grid DONE"
"DONE" | Set-Content (Join-Path $outRoot "QUALITY_STATUS.txt") -Encoding utf8
