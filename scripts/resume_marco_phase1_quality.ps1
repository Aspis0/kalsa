# Resume Marco phase1 full multi5 after crash/reset.
# Fail-fast A1/A2/A3 already PASS. Complete full multi5 only.
$ErrorActionPreference = "Continue"
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

$A0 = @{
  en = 0.6051011731162046
  es = 0.6766127803280786
  fr = 0.723385772761425
  it = 0.7501260841791423
  zh = 0.8833572076708988
}
$macroA0 = ($A0.en + $A0.es + $A0.fr + $A0.it + $A0.zh) / 5.0

function Run-Langs($id, $k, $drop, $outdir, $langs) {
  if ($langs.Count -eq 0) { L "$id nothing to run"; return 0 }
  $langStr = ($langs -join ",")
  L "=== $id run langs=$langStr k=$k drop=$drop out=$outdir ==="
  New-Item -ItemType Directory -Force -Path $outdir | Out-Null
  $tag = "${id}_resume"
  & python $py --binary $bin --model $model --tag $tag --outdir $outdir `
    --langs $langStr --threads 8 --ctx 4096 --ubatch 512 `
    --moe-stream --cache-mb 2000 --dense-weights anon --io-threads 4 --overlap `
    --n-expert-used $k --drop-cold-experts $drop
  $rc = $LASTEXITCODE
  L "$id langs rc=$rc"
  return $rc
}

function Merge-FullJson($id, $k, $drop, $fullDir) {
  # Merge per-lang results into ${id}_multi5.json under fullDir
  $langs = @("en", "es", "fr", "it", "zh")
  $merged = @{
    tag = $id
    k = $k
    drop = $drop
    model = $model
    langs = @{}
    sources = @{}
  }
  foreach ($lang in $langs) {
    $candidates = @(
      (Join-Path $fullDir "${id}_resume\${lang}"),  # wrong
      (Join-Path $fullDir $lang)
    )
    # run_multi5 writes outdir/lang/ and outdir/TAG_multi5.json
    $jsonMain = Join-Path $fullDir "${id}_resume_multi5.json"
    if (Test-Path $jsonMain) {
      $d = Get-Content $jsonMain -Raw -Encoding utf8 | ConvertFrom-Json
      if ($d.langs.$lang -and $d.langs.$lang.bpb) {
        $merged.langs[$lang] = $d.langs.$lang
        continue
      }
    }
    # also try id_multi5.json partial
    $jsonA = Join-Path $fullDir "${id}_multi5.json"
    if (Test-Path $jsonA) {
      $d = Get-Content $jsonA -Raw -Encoding utf8 | ConvertFrom-Json
      if ($d.langs.$lang -and $d.langs.$lang.bpb) {
        $merged.langs[$lang] = $d.langs.$lang
      }
    }
  }
  # re-read after resume file update
  $jsonResume = Join-Path $fullDir "${id}_resume_multi5.json"
  $jsonA = Join-Path $fullDir "${id}_multi5.json"
  $acc = @{}
  foreach ($jp in @($jsonA, $jsonResume)) {
    if (-not (Test-Path $jp)) { continue }
    $d = Get-Content $jp -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($lang in $langs) {
      if ($d.langs.$lang -and $d.langs.$lang.bpb) {
        $acc[$lang] = $d.langs.$lang
      }
    }
  }
  if ($acc.Count -lt 5) {
    L "WARN $id only has langs: $($acc.Keys -join ',')"
    return $false
  }
  $sum = 0.0
  $failLang = $false
  $outLangs = @{}
  foreach ($lang in $langs) {
    $e = $acc[$lang]
    # convert PSCustomObject to hashtable-ish for json
    $bpb = [double]$e.bpb
    $delta = $bpb - [double]$A0[$lang]
    if ($delta -le 0.10) { $g = "PASS" } else { $g = "FAIL"; $failLang = $true }
    $line = "{0},{1},{2},{3},full,{4},{5},{6},{7},{8},{9},{10},{11}" -f `
      (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $id, $k, $drop, $lang, `
      $bpb, $e.ppl, $e.n_tokens, $e.n_bytes, $e.seconds, $delta, $g
    Add-Content $csv $line -Encoding utf8
    L "$id full $lang bpb=$bpb dA0=$delta $g"
    $sum += $bpb
    $outLangs[$lang] = @{
      bpb = $bpb; ppl = [double]$e.ppl; n_tokens = $e.n_tokens
      n_bytes = $e.n_bytes; seconds = $e.seconds; delta_vs_a0 = $delta; gate = $g
    }
  }
  $macro = $sum / 5.0
  $dMacro = $macro - $macroA0
  $gM = if ((-not $failLang) -and ($dMacro -le 0.04)) { "PASS" } else { "FAIL" }
  L "$id macro=$macro macroA0=$macroA0 dMacro=$dMacro full_gate=$gM"
  $final = @{
    tag = $id; k = $k; drop = $drop
    macro_bpb = $macro; macro_a0 = $macroA0; delta_macro = $dMacro
    full_gate = $gM
    langs = $outLangs
  }
  $finalPath = Join-Path $fullDir "${id}_full_summary.json"
  ($final | ConvertTo-Json -Depth 6) | Set-Content $finalPath -Encoding utf8
  return ($gM -eq "PASS")
}

function Missing-Langs($fullDir, $id) {
  $have = @{}
  foreach ($jp in @(
      (Join-Path $fullDir "${id}_multi5.json"),
      (Join-Path $fullDir "${id}_resume_multi5.json")
    )) {
    if (-not (Test-Path $jp)) { continue }
    try {
      $d = Get-Content $jp -Raw -Encoding utf8 | ConvertFrom-Json
      foreach ($lang in @("en", "es", "fr", "it", "zh")) {
        if ($d.langs.$lang -and $d.langs.$lang.bpb) { $have[$lang] = $true }
      }
    } catch {}
  }
  # also check complete stdout/rc per lang
  $need = @()
  foreach ($lang in @("en", "es", "fr", "it", "zh")) {
    if (-not $have[$lang]) { $need += $lang }
  }
  return ,$need
}

L "RESUME phase1 full multi5 after reset"
L "A1 full had en+es; A2/A3 full not done"

# --- A1: resume missing langs ---
$a1full = Join-Path $outRoot "A1\full"
$need = Missing-Langs $a1full "A1"
L "A1 missing: $($need -join ',')"
if ($need.Count -gt 0) {
  # clean partial fr if incomplete (no bpb in json)
  $rc = Run-Langs "A1" 8 0.65 $a1full $need
  if ($rc -ne 0) { L "A1 resume failed rc=$rc"; exit $rc }
}
Merge-FullJson "A1" 8 0.65 $a1full | Out-Null

# --- A2 full ---
$a2full = Join-Path $outRoot "A2\full"
$need2 = Missing-Langs $a2full "A2"
L "A2 missing: $($need2 -join ',')"
if ($need2.Count -gt 0) {
  $rc = Run-Langs "A2" 6 0.65 $a2full $need2
  if ($rc -ne 0) { L "A2 full failed rc=$rc"; exit $rc }
}
Merge-FullJson "A2" 6 0.65 $a2full | Out-Null

# --- A3 full ---
$a3full = Join-Path $outRoot "A3\full"
$need3 = Missing-Langs $a3full "A3"
L "A3 missing: $($need3 -join ',')"
if ($need3.Count -gt 0) {
  $rc = Run-Langs "A3" 6 0.50 $a3full $need3
  if ($rc -ne 0) { L "A3 full failed rc=$rc"; exit $rc }
}
Merge-FullJson "A3" 6 0.50 $a3full | Out-Null

L "PHASE1 quality grid DONE (resumed)"
"DONE" | Set-Content (Join-Path $outRoot "QUALITY_STATUS.txt") -Encoding utf8

# short VERDICT
$verdict = @()
$verdict += "# Marco Phase1 quality VERDICT (post-reset resume)"
$verdict += ""
$verdict += "Fail-fast IT+EN: A1/A2/A3 all PASS (see runs_quality.csv)."
$verdict += "Full multi5 gates vs A0: per-lang d<=+0.10, macro d<=+0.04."
$verdict += ""
foreach ($id in @("A1", "A2", "A3")) {
  $p = Join-Path $outRoot "$id\full\${id}_full_summary.json"
  if (Test-Path $p) {
    $j = Get-Content $p -Raw | ConvertFrom-Json
    $verdict += ("{0}: full_gate={1} macro={2:N4} dMacro={3:N4}" -f $id, $j.full_gate, $j.macro_bpb, $j.delta_macro)
  } else {
    $verdict += "${id}: missing summary"
  }
}
$verdict += ""
$verdict += "Speed device: deferred (S23 busy, Jelly offline)."
$verdict -join "`n" | Set-Content (Join-Path $outRoot "VERDICT.md") -Encoding utf8
L "Wrote VERDICT.md"
