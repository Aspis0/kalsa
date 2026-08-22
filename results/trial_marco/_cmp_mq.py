import json
from pathlib import Path
root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\trial_marco")
m = json.loads((root / "ppl_marco" / "Marco_multi5.json").read_text(encoding="utf-8"))
q = json.loads((root / "ppl_qwen35_4b" / "Qwen35_4B_multi5.json").read_text(encoding="utf-8"))
print(f"{'lang':4} {'Marco_bpb':>10} {'Qwen4B_bpb':>10} {'M-Q':>10} {'vince':>8}")
for L in ["en", "es", "fr"]:
    mb = m["langs"][L]["bpb"]
    e = q.get("langs", {}).get(L, {})
    if "bpb" not in e:
        print(f"{L:4} {mb:10.4f} {'n/a':>10}")
        continue
    qb = e["bpb"]
    d = mb - qb
    win = "Marco" if d < -1e-6 else ("Qwen4B" if d > 1e-6 else "pari")
    print(f"{L:4} {mb:10.4f} {qb:10.4f} {d:+10.4f} {win:>8}")
print()
print("bpb piu basso = meglio")
print("gate T2c: Marco deve stravincere (macro < Qwen-0.03); per-lingua Marco <= Qwen su >=4/5")
