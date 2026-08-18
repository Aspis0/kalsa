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
