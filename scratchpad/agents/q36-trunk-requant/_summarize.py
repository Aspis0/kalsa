import json
from collections import Counter, defaultdict
from pathlib import Path
p = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q36-trunk-requant\baseline_tensors.json")
d = json.loads(p.read_text(encoding="utf-8"))
out = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q36-trunk-requant\baseline_summary.txt")
lines = []
lines.append(f"n_tensors={d['n_tensors']}")
lines.append(f"types={d['types']}")
by_kind = defaultdict(list)
for t in d["tensors"]:
    name = t["name"]
    if "ffn_gate_exps" in name: kind = "expert_gate"
    elif "ffn_up_exps" in name: kind = "expert_up"
    elif "ffn_down_exps" in name: kind = "expert_down"
    elif "ffn_gate_inp" in name: kind = "router"
    elif name.endswith("_norm.weight") or "norm.weight" in name: kind = "norm"
    elif "attn_q.weight" in name: kind = "attn_q"
    elif "attn_k.weight" in name: kind = "attn_k"
    elif "attn_v.weight" in name: kind = "attn_v"
    elif "attn_output.weight" in name: kind = "attn_output"
    elif name == "token_embd.weight": kind = "token_embd"
    elif name == "output.weight": kind = "output"
    elif "weight" in name: kind = "other_weight"
    else: kind = "other"
    by_kind[kind].append(t)

lines.append("\n== by kind ==")
for k, ts in sorted(by_kind.items()):
    types = Counter(t["type"] for t in ts)
    nbytes = sum(t["nbytes"] or 0 for t in ts)
    shapes = Counter(tuple(t["shape"]) for t in ts)
    lines.append(f"{k}: n={len(ts)} types={dict(types)} bytes={nbytes} ({nbytes/1024/1024/1024:.3f} GiB) shapes={ {str(s):c for s,c in shapes.items()} }")
    if k in ("token_embd","output","other_weight","other"):
        for t in ts:
            lines.append(f"  {t['name']} {t['type']} {t['shape']} nbytes={t['nbytes']}")

# ncols % 32 and % 256 for Q5_K trunk
lines.append("\n== trunk Q5_K ncols alignment ==")
bad32=[]
for t in d["tensors"]:
    if t["type"] != "Q5_K":
        continue
    # gguf reader shape is typically reversed vs ggml ne[]
    shape = t["shape"]
    # In GGUFReader, shape is stored as listed in file; ggml ne[0] is innermost = last dim in numpy, first in ggml.
    # Safer: report both first and last
    lines.append(f"  {t['name']} shape={shape} first%32={shape[0]%32} last%32={shape[-1]%32} first%256={shape[0]%256} last%256={shape[-1]%256}")

out.write_text("\n".join(lines)+"\n", encoding="utf-8")
print(out.read_text(encoding="utf-8"))
