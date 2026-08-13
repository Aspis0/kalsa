# Quantize Marco Q8 into KEXP-1c then KEXP-cons. Verify tensor types.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$Q = Join-Path $root 'build-pc-quantize\bin\llama-quantize.exe'
$SRC = Join-Path $root 'models\Marco-Mini-Instruct.Q8_0.gguf'
$IM = Join-Path $root 'models\Marco-Mini-Instruct.imatrix.gguf'
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }
$log = Join-Path $root 'logs\quantize-marcokexp.log'
$status = Join-Path $root 'results\marcokexp\QUANTIZE_STATUS.txt'
$verify = Join-Path $root 'results\marcokexp\QUANTIZE_VERIFY.md'

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}

function Verify-Gguf($tag, $path, $expectGate, $expectUp, $expectDown, $expectAttn) {
    $code = @'
import json, sys
from collections import Counter
from gguf import GGUFReader
path, tag = sys.argv[1], sys.argv[2]
r = GGUFReader(path)
c = Counter()
iq = 0
attn_q = Counter()
gate = Counter(); up = Counter(); down = Counter()
for t in r.tensors:
    name = t.name
    typ = t.tensor_type.name
    c[typ] += 1
    if typ.startswith("IQ"):
        iq += 1
    if "attn_q.weight" in name:
        attn_q[typ] += 1
    if "ffn_gate_exps.weight" in name:
        gate[typ] += 1
    if "ffn_up_exps.weight" in name:
        up[typ] += 1
    if "ffn_down_exps.weight" in name:
        down[typ] += 1
out = {
    "tag": tag,
    "n_tensors": len(r.tensors),
    "types": dict(c),
    "iq_count": iq,
    "attn_q": dict(attn_q),
    "gate_exps": dict(gate),
    "up_exps": dict(up),
    "down_exps": dict(down),
}
print(json.dumps(out, indent=2))
'@
    $tmp = Join-Path $root 'scripts\_tmp_verify_gguf.py'
    Set-Content $tmp $code -Encoding utf8
    $json = & $py $tmp $path $tag
    $rc = $LASTEXITCODE
    L ("verify {0} rc={1}" -f $tag, $rc)
    Add-Content $verify ("## {0}`n" -f $tag) -Encoding utf8
    Add-Content $verify ('size={0}' -f (Get-Item $path).Length) -Encoding utf8
    $sha = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
    Add-Content $verify ('sha256={0}' -f $sha) -Encoding utf8
    Add-Content $verify ($json -join "`n") -Encoding utf8
    Add-Content $verify '' -Encoding utf8
    L ("verify {0} sha={1}" -f $tag, $sha)
    L ($json -join ' ')
    return $json
}

if (-not (Test-Path $Q)) { L 'FAIL no llama-quantize'; 'FAIL_BIN' | Set-Content $status; exit 2 }
if (-not (Test-Path $SRC)) { L 'FAIL no Q8'; 'FAIL_SRC' | Set-Content $status; exit 2 }
if (-not (Test-Path $IM)) { L 'FAIL no imatrix'; 'FAIL_IMATRIX' | Set-Content $status; exit 2 }

'' | Set-Content $verify -Encoding utf8
'RUNNING' | Set-Content $status
L 'START quantize both recipes'

$jobs = @(
    @{
        Tag = 'KEXP-1c'
        Types = Join-Path $root 'results\marcokexp\tensor_types_1c.txt'
        Out = Join-Path $root 'models\Marco-Mini-Instruct-KEXP.gguf'
    },
    @{
        Tag = 'KEXP-cons'
        Types = Join-Path $root 'results\marcokexp\tensor_types_conservative_q3k.txt'
        Out = Join-Path $root 'models\Marco-Mini-Instruct-KEXP-q3k.gguf'
    }
)

foreach ($j in $jobs) {
    L ('=== {0} types={1} out={2} ===' -f $j.Tag, $j.Types, $j.Out)
    if (-not (Test-Path $j.Types)) {
        L ('FAIL missing types {0}' -f $j.Types)
        'FAIL_TYPES' | Set-Content $status
        exit 3
    }
    if (Test-Path $j.Out) {
        L ('WARN removing existing {0}' -f $j.Out)
        Remove-Item $j.Out -Force
    }
    & $Q --allow-requantize --imatrix $IM --tensor-type-file $j.Types $SRC $j.Out Q4_K_M
    $rc = $LASTEXITCODE
    L ('quantize {0} rc={1}' -f $j.Tag, $rc)
    if ($rc -ne 0 -or -not (Test-Path $j.Out)) {
        L ('FAIL quantize {0}' -f $j.Tag)
        ('FAIL_QUANT_' + $j.Tag) | Set-Content $status
        exit 4
    }
    $sz = (Get-Item $j.Out).Length
    L ('{0} size={1} ({2:N2} GB)' -f $j.Tag, $sz, ($sz / 1GB))
    if ($sz -ge 10505424704) {
        L ('WARN {0} size >= i1-Q4 10.5GB — cache prize doubtful' -f $j.Tag)
    }
    [void](Verify-Gguf $j.Tag $j.Out)
}

'OK' | Set-Content $status
L 'DONE both quantized + verified'
exit 0
