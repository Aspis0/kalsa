import json
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
live = json.loads((root / "results/f6_certify_probe/acceptance/fact_k2_d0.ckpt.json").read_text(encoding="utf-8"))
f0 = json.loads((root / "results/selfspec_f0/acceptance/fact_k2_d0.ckpt.json").read_text(encoding="utf-8"))
lr = live["rows"]
fr = f0["rows"]
n = min(len(lr), len(fr))
mismatch = 0
for i in range(n):
    a, b = lr[i], fr[i]
    if a["pos"] != b["pos"] or a["accept"] != b["accept"] or a["draft_piece"] != b["draft_piece"]:
        mismatch += 1
        if mismatch <= 8:
            print("MISMATCH", i, "live", a["pos"], a["accept"], repr(a["draft_piece"]), "f0", b["pos"], b["accept"], repr(b["draft_piece"]))
print(f"compared={n} live_n={len(lr)} f0_n={len(fr)} mismatches={mismatch} live_t={live.get('t')}")
