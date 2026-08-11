# PC quality pipeline for trial-marco: wait KEXP multi5 -> Marco multi5 -> Qwen3.5-4B multi5
# Does NOT run T3 (device, unplugged). Writes results/trial_marco/PC_PIPELINE_STATUS.txt
$ErrorActionPreference = "Stop"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$bin = Join-Path $root "build-pc\cli\bmoe-cli.exe"
$py = Join-Path $root "scripts\run_multi5_ppl_host.py"
$status = Join-Path $root "results\trial_marco\PC_PIPELINE_STATUS.txt"
$log = Join-Path $root "logs\orchestrate-trial-marco-pc.log"

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $m
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
  Set-Content -Path $status -Value $line -Encoding utf8
}

function Wait-KexpDone {
  $json = Join-Path $root "results\trial_marco\ppl_kexp\KEXP_multi5.json"
  Log "WAIT KEXP multi5..."
  while ($true) {
    if (Test-Path $json) {
      try {
        $d = Get-Content $json -Raw -Encoding utf8 | ConvertFrom-Json
        if ($null -ne $d.macro_bpb) {
          Log ("KEXP DONE macro_bpb={0}" -f $d.macro_bpb)
          return
        }
        $n = @($d.langs.PSObject.Properties | Where-Object { $_.Value.bpb }).Count
        Log ("KEXP progress langs_with_bpb={0}/5" -f $n)
      } catch {
        Log "KEXP json parse pending"
      }
    }
    # also alive if bmoe-cli running
    $p = Get-Process bmoe-cli -ErrorAction SilentlyContinue
    if (-not $p) {
      # process died without macro - fail if incomplete
      if (Test-Path $json) {
        $d = Get-Content $json -Raw -Encoding utf8 | ConvertFrom-Json
        if ($null -eq $d.macro_bpb) {
          Log "FAIL KEXP process exited without macro_bpb"
          exit 2
        }
      } else {
        Log "FAIL KEXP process gone, no json"
        exit 2
      }
    }
    Start-Sleep -Seconds 120
  }
}

function Run-Multi5($tag, $model, $outdir, [switch]$MoeStream, [int]$NExpertUsed = 0, [double]$DropCold = 0.0) {
  New-Item -ItemType Directory -Force -Path $outdir | Out-Null
  Log "START $tag -> $outdir (k=$NExpertUsed drop=$DropCold)"
  $args = @(
    $py,
    "--binary", $bin,
    "--model", $model,
    "--tag", $tag,
    "--outdir", $outdir,
    "--threads", "8",
    "--ctx", "4096",
    "--ubatch", "512",
    "--langs", "en,es,fr,it,zh"
  )
  if ($MoeStream) {
    $args += @("--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--io-threads", "4")
    if ($NExpertUsed -gt 0) { $args += @("--n-expert-used", "$NExpertUsed") }
    if ($DropCold -gt 0) { $args += @("--drop-cold-experts", "$DropCold") }
  }
  & python @args
  if ($LASTEXITCODE -ne 0) {
    Log "FAIL $tag rc=$LASTEXITCODE"
    exit $LASTEXITCODE
  }
  Log "DONE $tag"
}

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $status) | Out-Null
Log "orchestrate_trial_marco_pc START"

# Historical k8 no-drop baseline already on disk as ppl_kexp/ (pre-correction).
# Gate comparator is campaign default k=6 drop=0.65 -> ppl_kexp_k6d065/
$kexpModel = Join-Path $root "models\Qwen3.6-35B-A3B-KEXP.gguf"
$k6dir = Join-Path $root "results\trial_marco\ppl_kexp_k6d065"
$k6json = Join-Path $k6dir "KEXP_k6d065_multi5.json"
# run_multi5 tags the file as {tag}_multi5.json
$k6json2 = Join-Path $k6dir "KEXP_k6d065_multi5.json"

if (-not (Test-Path $kexpModel)) { Log "FAIL KEXP model missing"; exit 3 }

# If an older wait was for k8 macro, we still re-baseline k6d065 for gates.
if (-not (Test-Path (Join-Path $k6dir "KEXP_k6d065_multi5.json")) -and -not (Test-Path (Join-Path $k6dir "KEXP_multi5.json"))) {
  # Prefer waiting until no other bmoe-cli is hammering disk/RAM
  while (Get-Process bmoe-cli -ErrorAction SilentlyContinue) {
    Log "WAIT free bmoe-cli before KEXP k6d065 baseline..."
    Start-Sleep -Seconds 120
  }
  Run-Multi5 -tag "KEXP_k6d065" -model $kexpModel -outdir $k6dir -MoeStream -NExpertUsed 6 -DropCold 0.65
} else {
  Log "KEXP k6d065 baseline already present"
}

$marco = Join-Path $root "models\Marco-Mini-Instruct.i1-Q4_K_M.gguf"
$qwen = Join-Path $root "models\draft\Qwen3.5-4B-Q4_K_M.gguf"
if (-not (Test-Path $qwen)) {
  $qwen = "C:\Users\gualt\Desktop\Kalsa\lab\models\Qwen3.5-4B-Q4_K_M.gguf"
}
if (-not (Test-Path $marco)) { Log "FAIL marco missing"; exit 3 }
if (-not (Test-Path $qwen)) { Log "FAIL qwen3.5-4b missing"; exit 3 }

$marcoDir = Join-Path $root "results\trial_marco\ppl_marco"
$marcoJson = Join-Path $marcoDir "Marco_multi5.json"
if (-not (Test-Path $marcoJson)) {
  while (Get-Process bmoe-cli -ErrorAction SilentlyContinue) {
    Log "WAIT free bmoe-cli before Marco multi5..."
    Start-Sleep -Seconds 120
  }
  Run-Multi5 -tag Marco -model $marco -outdir $marcoDir -MoeStream
} else {
  Log "Marco multi5 already present"
}

$qwenDir = Join-Path $root "results\trial_marco\ppl_qwen35_4b"
$qwenJson = Join-Path $qwenDir "Qwen35_4B_multi5.json"
if (-not (Test-Path $qwenJson)) {
  while (Get-Process bmoe-cli -ErrorAction SilentlyContinue) {
    Log "WAIT free bmoe-cli before Qwen multi5..."
    Start-Sleep -Seconds 60
  }
  Run-Multi5 -tag Qwen35_4B -model $qwen -outdir $qwenDir
} else {
  Log "Qwen multi5 already present"
}

# Gate summary — comparator KEXP is k6d065 (campaign default)
Log "Writing gate summary (gates vs KEXP k6d065)..."
python -c @"
import json
from pathlib import Path
root = Path(r'$root') / 'results' / 'trial_marco'

def load_any(dirnames, tags):
    for d, t in zip(dirnames, tags):
        p = root / d / f'{t}_multi5.json'
        if p.exists():
            return json.loads(p.read_text(encoding='utf-8')), str(p)
    raise SystemExit(f'missing one of {list(zip(dirnames, tags))}')

k, kpath = load_any(['ppl_kexp_k6d065'], ['KEXP_k6d065'])
# optional historical
k8path = root / 'ppl_kexp' / 'KEXP_multi5.json'
k8 = json.loads(k8path.read_text(encoding='utf-8')) if k8path.exists() else None
m, mpath = load_any(['ppl_marco'], ['Marco'])
q, qpath = load_any(['ppl_qwen35_4b'], ['Qwen35_4B'])
langs = ['en','es','fr','it','zh']
rows = []
for L in langs:
    kb, mb, qb = k['langs'][L]['bpb'], m['langs'][L]['bpb'], q['langs'][L]['bpb']
    rows.append((L, kb, mb, qb, mb-kb, mb-qb))
macro_k, macro_m, macro_q = k['macro_bpb'], m['macro_bpb'], q['macro_bpb']
t2a_ok = all(m['langs'][L]['bpb'] <= k['langs'][L]['bpb'] + 0.15 for L in ['en','zh','it'])
t2b_macro = macro_m <= macro_k + 0.05
t2b_veto = all(m['langs'][L]['bpb'] - k['langs'][L]['bpb'] <= 0.15 for L in langs)
t2c_macro = macro_m < macro_q - 0.03
wins = sum(1 for L in langs if m['langs'][L]['bpb'] <= q['langs'][L]['bpb'] + 1e-12)
no_blow = all(m['langs'][L]['bpb'] - q['langs'][L]['bpb'] <= 0.10 for L in langs)
t2c_lang = wins >= 4 and no_blow
out = {
  'kexp_gate_config': 'k=6 drop=0.65 (k6d065)',
  'kexp_gate_path': kpath,
  'kexp_historical_k8_nodrop_path': str(k8path) if k8 else None,
  'kexp_historical_k8_nodrop_macro': (k8 or {}).get('macro_bpb'),
  'macro': {'KEXP_k6d065': macro_k, 'Marco': macro_m, 'Qwen35_4B': macro_q},
  'per_lang': [
    {'lang': L, 'KEXP_k6d065': kb, 'Marco': mb, 'Qwen35_4B': qb, 'd_Marco_KEXP': dmk, 'd_Marco_Qwen': dmq}
    for L, kb, mb, qb, dmk, dmq in rows
  ],
  'gates': {
    'T2a_failfast_en_zh_it': t2a_ok,
    'T2b_macro_le_kexp_plus_0.05': t2b_macro,
    'T2b_no_lang_gt_plus_0.15': t2b_veto,
    'T2c_macro_marco_lt_qwen_minus_0.03': t2c_macro,
    'T2c_win_or_tie_ge_4_of_5': wins >= 4,
    'T2c_no_loss_gt_0.10': no_blow,
    'T2c_pass': t2c_macro and t2c_lang,
  }
}
(root / 'quality_gates.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
print(json.dumps(out['gates'], indent=2))
print('macro', out['macro'])
"@

Log "PC QUALITY PIPELINE COMPLETE - gates vs KEXP k6d065"
exit 0
