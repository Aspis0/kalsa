import json
from pathlib import Path
root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments") / "results" / "trial_marco"

def load(sub, tag):
    p = root / sub / f"{tag}_multi5.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))

sets = [
    ("KEXP k8 no-drop (storico)", "ppl_kexp", "KEXP"),
    ("KEXP k6d065 (gate)", "ppl_kexp_k6d065", "KEXP_k6d065"),
    ("Marco", "ppl_marco", "Marco"),
    ("Qwen3.5-4B", "ppl_qwen35_4b", "Qwen35_4B"),
]
for L in ["fr", "it"]:
    print("=" * 60)
    print("LINGUA:", L.upper())
    print("=" * 60)
    for name, sub, tag in sets:
        d = load(sub, tag)
        if not d or L not in d.get("langs", {}) or "bpb" not in d["langs"][L]:
            print(f"{name:28}  (manca o incompleto)")
            continue
        e = d["langs"][L]
        fert = e.get("bytes_per_token")
        fert_s = f"{fert:.3f}" if fert is not None else "?"
        print(
            f"{name:28}  bpb={e['bpb']:.4f}  ppl={e['ppl']:.3f}  "
            f"tok={e.get('n_tokens')}  fert={fert_s}  bytes={e.get('n_bytes')}"
        )
    k = load("ppl_kexp_k6d065", "KEXP_k6d065")
    m = load("ppl_marco", "Marco")
    if k and m and "bpb" in k["langs"].get(L, {}) and "bpb" in m["langs"].get(L, {}):
        kb, mb = k["langs"][L]["bpb"], m["langs"][L]["bpb"]
        print(f"  -> Delta Marco - KEXP(k6d065) = {mb - kb:+.4f}  (veto se > +0.15)")
    print()