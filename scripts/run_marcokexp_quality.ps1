# MarcoKEXP quality: fail-fast IT+EN A2 on both recipes, full multi5 if PASS.
# Do NOT assign python stdout to $rc (PowerShell leak).
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$bin = Join-Path $root 'build-pc\cli\bmoe-cli.exe'
$py = Join-Path $root 'scripts\run_multi5_ppl_host.py'
$outRoot = Join-Path $root 'results\marcokexp'
$csv = Join-Path $outRoot 'runs_quality.csv'
$log = Join-Path $root 'logs\marcokexp_quality.log'
$status = Join-Path $outRoot 'QUALITY_STATUS.txt'
$verdict = Join-Path $outRoot 'VERDICT.md'

$A0 = @{
  en = 0.6051011731162046
  es = 0.6766127803280786
  fr = 0.723385772761425
  it = 0.7501260841791423
  zh = 0.8833572076708988
}
$macroA0 = ($A0.en + $A0.es + $A0.fr + $A0.it + $A0.zh) / 5.0

function L($m) {
  $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
  Add-Content $log $t -Encoding utf8
  Write-Host $t
}

function Run-Langs($tag, $model, $k, $drop, $outdir, $langs) {
  if ($langs.Count -eq 0) { L "$tag nothing"; return 0 }
  $langStr = ($langs -join ',')
  L "=== $tag langs=$langStr k=$k drop=$drop out=$outdir ==="
  New-Item -ItemType Directory -Force -Path $outdir | Out-Null
  & python $py --binary $bin --model $model --tag $tag --outdir $outdir `
    --langs $langStr --threads 8 --ctx 4096 --ubatch 512 `
    --moe-stream --cache-mb 2000 --dense-weights anon --io-threads 4 --overlap `
    --n-expert-used $k --drop-cold-experts $drop 2>&1 | ForEach-Object {
      Write-Host $_
      Add-Content $log $_ -Encoding utf8
    }
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
  L "$tag langs rc=$code"
  return $code
}

function Eval-Langs($tag, $stage, $k, $drop, $jsonPath, $langs, $itEnMax, $perLangMax, $macroMax) {
  if (-not (Test-Path $jsonPath)) {
    L "FAIL missing $jsonPath"
    return $false
  }
  $d = Get-Content $jsonPath -Raw -Encoding utf8 | ConvertFrom-Json
  $fail = $false
  $sum = 0.0
  $n = 0
  foreach ($lang in $langs) {
    $e = $d.langs.$lang
    if (-not $e -or -not $e.bpb) {
      L "FAIL $tag $stage missing $lang"
      return $false
    }
    $bpb = [double]$e.bpb
    $delta = $bpb - [double]$A0[$lang]
    $g = 'PASS'
    if ($stage -eq 'failfast') {
      if ($delta -gt $itEnMax) { $g = 'FAIL'; $fail = $true }
    } else {
      if ($delta -gt $perLangMax) { $g = 'FAIL'; $fail = $true }
    }
    $line = '{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12}' -f `
      (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $tag, $k, $drop, $stage, $lang, `
      $bpb, $e.ppl, $e.n_tokens, $e.n_bytes, $e.seconds, $delta, $g
    Add-Content $csv $line -Encoding utf8
    L "$tag $stage $lang bpb=$bpb dA0=$delta $g"
    $sum += $bpb
    $n++
  }
  if ($stage -eq 'full' -and $n -eq 5) {
    $macro = $sum / 5.0
    $dMacro = $macro - $macroA0
    if ((-not $fail) -and ($dMacro -le $macroMax)) { $gM = 'PASS' } else { $gM = 'FAIL'; $fail = $true }
    L "$tag full macro=$macro dMacro=$dMacro $gM"
    $sumObj = @{
      tag = $tag; k = $k; drop = $drop
      macro_bpb = $macro; delta_macro = $dMacro; full_gate = $gM
    }
    ($sumObj | ConvertTo-Json) | Set-Content (Join-Path (Split-Path $jsonPath) "${tag}_full_summary.json") -Encoding utf8
    if ($gM -eq 'FAIL') { return $false }
  }
  return (-not $fail)
}

# --- main ---
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
if (-not (Test-Path $csv)) {
  'ts,tag,k,drop,stage,lang,bpb,ppl,n_tokens,n_bytes,seconds,delta_a0,gate' | Set-Content $csv -Encoding utf8
}
'RUNNING' | Set-Content $status -Encoding utf8
L 'START MarcoKEXP quality both recipes A2 fail-fast then full'

$recipes = @(
  @{
    Tag = 'KEXP-1c'
    Model = Join-Path $root 'models\Marco-Mini-Instruct-KEXP.gguf'
  },
  @{
    Tag = 'KEXP-cons'
    Model = Join-Path $root 'models\Marco-Mini-Instruct-KEXP-q3k.gguf'
  }
)

$passedFull = @()

foreach ($r in $recipes) {
  if (-not (Test-Path $r.Model)) {
    L "FAIL missing model $($r.Model)"
    "FAIL_MODEL_$($r.Tag)" | Set-Content $status
    exit 2
  }
  $ff = Join-Path $outRoot "$($r.Tag)\failfast"
  $rc = Run-Langs $r.Tag $r.Model 6 0.65 $ff @('it', 'en')
  if ($rc -ne 0) {
    L "$($r.Tag) failfast rc=$rc — treat as FAIL"
    continue
  }
  $ok = Eval-Langs $r.Tag 'failfast' 6 0.65 (Join-Path $ff "$($r.Tag)_multi5.json") @('it', 'en') 0.08 0.12 0.06
  if (-not $ok) {
    L "$($r.Tag) FAILFAST FAIL — skip full"
    continue
  }
  L "$($r.Tag) FAILFAST PASS -> full multi5"
  $full = Join-Path $outRoot "$($r.Tag)\full"
  $rc = Run-Langs $r.Tag $r.Model 6 0.65 $full @('en', 'es', 'fr', 'it', 'zh')
  if ($rc -ne 0) {
    L "$($r.Tag) full rc=$rc FAIL"
    continue
  }
  $ok = Eval-Langs $r.Tag 'full' 6 0.65 (Join-Path $full "$($r.Tag)_multi5.json") @('en', 'es', 'fr', 'it', 'zh') 0.08 0.12 0.06
  if ($ok) {
    L "$($r.Tag) FULL PASS"
    $passedFull += $r
  } else {
    L "$($r.Tag) FULL FAIL"
  }
}

# k=8 drop OFF on first full-PASS recipe (prefer 1c = first in list)
if ($passedFull.Count -gt 0) {
  $r = $passedFull[0]
  L "A0-iso k=8 drop OFF on $($r.Tag)"
  $iso = Join-Path $outRoot "$($r.Tag)\k8_nodrop"
  $rc = Run-Langs "$($r.Tag)-k8" $r.Model 8 0 $iso @('it', 'en')
  if ($rc -eq 0) {
    [void](Eval-Langs "$($r.Tag)-k8" 'failfast' 8 0 (Join-Path $iso "$($r.Tag)-k8_multi5.json") @('it', 'en') 0.08 0.12 0.06)
  }
}

$lines = @(
  '# MarcoKEXP quality VERDICT',
  '',
  'Anchor A0 = i1-Q4. Fail-fast IT+EN d<=+0.08; full per-lang d<=+0.12 macro d<=+0.06.',
  ''
)
foreach ($r in $recipes) {
  $p = Join-Path $outRoot "$($r.Tag)\full\$($r.Tag)_full_summary.json"
  if (Test-Path $p) {
    $j = Get-Content $p -Raw | ConvertFrom-Json
    $lines += ('{0}: full_gate={1} macro={2} dMacro={3}' -f $r.Tag, $j.full_gate, $j.macro_bpb, $j.delta_macro)
  } else {
    $lines += ('{0}: no full (fail-fast FAIL or not run)' -f $r.Tag)
  }
}
if ($passedFull.Count -eq 0) {
  $lines += ''
  $lines += 'NO-GO Fase 2: zero recipes passed full multi5.'
} elseif ($passedFull.Count -eq 2) {
  $lines += ''
  $lines += 'Both PASS. Owner picks 1c vs cons (I/O vs quality).'
} else {
  $lines += ''
  $lines += ('One PASS: {0}' -f $passedFull[0].Tag)
}
$lines -join "`n" | Set-Content $verdict -Encoding utf8
'DONE' | Set-Content $status -Encoding utf8
L 'Wrote VERDICT.md'
L 'QUALITY GRID DONE'
exit 0
