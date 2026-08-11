$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$bin = "$root\build-pc\cli\bmoe-cli.exe"
$py = "$root\scripts\run_multi5_ppl_host.py"
$out = "$root\results\trial_marco\ppl_it_v2"
$log = "$root\logs\it_v2_marco_qwen.log"
function L($m){ $t="[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content $log $t; Write-Host $t }

L "START Marco IT v2"
& python $py --binary $bin --model "$root\models\Marco-Mini-Instruct.i1-Q4_K_M.gguf" --tag Marco --outdir "$out\marco" --langs it --moe-stream --cache-mb 2000 --dense-weights anon --threads 8 --ctx 4096 --ubatch 512 --io-threads 4 --n-expert-used 8
L "Marco rc=$LASTEXITCODE"

$qwen = "$root\models\draft\Qwen3.5-4B-Q4_K_M.gguf"
if (-not (Test-Path $qwen)) { $qwen = "C:\Users\gualt\Desktop\Kalsa\lab\models\Qwen3.5-4B-Q4_K_M.gguf" }
L "START Qwen IT v2 $qwen"
& python $py --binary $bin --model $qwen --tag Qwen35_4B --outdir "$out\qwen35_4b" --langs it --threads 8 --ctx 4096 --ubatch 512
L "Qwen rc=$LASTEXITCODE"

python -c @"
import json, hashlib
from pathlib import Path
root = Path(r'$out')
repo = Path(r'$root')
def load(sub, tag):
    d = json.loads((root/sub/f'{tag}_multi5.json').read_text(encoding='utf-8'))
    return d['langs']['it']
rows = {}
for sub, tag, name in [('kexp_k6d065','KEXP_k6d065','KEXP_k6d065'),('marco','Marco','Marco'),('qwen35_4b','Qwen35_4B','Qwen35_4B')]:
    e = load(sub, tag)
    rows[name] = {k: e.get(k) for k in ('bpb','ppl','n_tokens','n_bytes','seconds','bytes_per_token')}
    print(name, rows[name]['bpb'], rows[name]['ppl'])
k,m,q = rows['KEXP_k6d065']['bpb'], rows['Marco']['bpb'], rows['Qwen35_4B']['bpb']
raw = (repo/'corpus'/'multi5'/'it.txt').read_bytes()
out = {
  'corpus': 'corpus/multi5/it.txt v2 Wikipedia Caffe (modern IT)',
  'corpus_bytes': len(raw),
  'corpus_sha256': hashlib.sha256(raw).hexdigest(),
  'models': rows,
  'delta_Marco_KEXP': m-k,
  'delta_Marco_Qwen': m-q,
  'delta_Qwen_KEXP': q-k,
  'v1_literary_ref': {'KEXP_k6d065_bpb': 0.3842, 'Marco_bpb': 1.6377, 'note': 'it_v1_literary.txt Dante/prose - NOT modern IT'},
}
(root/'it_v2_comparison.json').write_text(json.dumps(out, indent=2)+'\n', encoding='utf-8')
print('WROTE comparison', 'M-K', m-k, 'M-Q', m-q)
"@
L "ALL_DONE"