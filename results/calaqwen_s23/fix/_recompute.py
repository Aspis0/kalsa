import json, math, statistics
from pathlib import Path

root = Path(__file__).resolve().parent
rows = []
for meta in sorted((root / "n1").glob("sess_k*_r*/meta.json")):
    d = json.loads(meta.read_text(encoding="utf-8"))
    t2 = d.get("t2") or {}
    rows.append(
        {
            "k": d["k"],
            "rep": d["rep"],
            "n_prompt": d.get("n_prompt"),
            "expected": d["expected"],
            "status": d.get("status"),
            "prefill_s": t2.get("prefill_s"),
            "prefill_tps": t2.get("prefill_tps"),
            "tok_s": t2.get("tok_s"),
            "read_mib": t2.get("read_mib"),
            "tokens": t2.get("tokens"),
        }
    )

ok = [r for r in rows if r["status"] == "OK" and r["prefill_s"] is not None and r["n_prompt"] is not None]
print("OK rows", len(ok))
from collections import defaultdict

byk = defaultdict(list)
for r in ok:
    byk[r["k"]].append(r)
print("k\tn_prompt\tprefill_med\tprefill_tps_med")
for k in sorted(byk):
    ps = [r["prefill_s"] for r in byk[k]]
    pt = [r["prefill_tps"] for r in byk[k] if r.get("prefill_tps")]
    print(
        f"{k}\t{byk[k][0]['n_prompt']}\t{statistics.median(ps):.3f}\t{statistics.median(pt) if pt else float('nan'):.2f}"
    )

xs = [r["n_prompt"] for r in ok]
ys = [r["prefill_s"] for r in ok]
n = len(xs)
sx, sy = sum(xs), sum(ys)
sxx = sum(x * x for x in xs)
sxy = sum(x * y for x, y in zip(xs, ys))
den = n * sxx - sx * sx
m = (n * sxy - sx * sy) / den
F = (sy - m * sx) / n
yhat = [F + m * x for x in xs]
ybar = sy / n
ss_tot = sum((y - ybar) ** 2 for y in ys) or 1.0
ss_res = sum((y - yh) ** 2 for y, yh in zip(ys, yhat))
r2 = 1 - ss_res / ss_tot
s_yx = math.sqrt(ss_res / max(n - 2, 1))
se_m = s_yx / math.sqrt(sxx - sx * sx / n)
ic = (m - 1.96 * se_m, m + 1.96 * se_m)
ctrl = json.loads((root / "n1" / "ctrl_decode1.json").read_text(encoding="utf-8"))
t1 = ctrl["t_decode1_s"]
thr = 0.3 * t1
amm = m <= thr
if F > 0.5 and amm:
    verdict = "OPEN_MTP_SPEC"
elif m > thr:
    verdict = "EPITAPH_SPEC"
else:
    verdict = "INCONCLUSIVE"
print(
    f"FIT F={F:.4f} m={m:.6f} R2={r2:.4f} se_m={se_m:.6f} IC95=[{ic[0]:.6f},{ic[1]:.6f}]"
)
print(f"t1={t1:.4f} thr0.3t1={thr:.4f} ammortizza={amm} verdict={verdict}")
fit = {
    "rows": ok,
    "F": F,
    "m": m,
    "R2": r2,
    "se_m": se_m,
    "m_ic95": list(ic),
    "t_decode1_s": t1,
    "threshold_0.3_t1": thr,
    "ammortizza": amm,
    "verdict": verdict,
    "tok_s_ctrl": ctrl.get("tok_s"),
}
(root / "n1" / "fit_recomputed.json").write_text(json.dumps(fit, indent=2), encoding="utf-8")

combo = root / "conv5" / "combo.txt"
dones = []
if combo.exists():
    for line in combo.read_text(encoding="utf-8", errors="replace").splitlines():
        if "BMOE_DONE" not in line:
            continue
        i = line.find("{")
        if i >= 0:
            try:
                dones.append(json.loads(line[i:]))
            except Exception:
                pass
print("CONV5 dones", len(dones))
for d in dones:
    print(
        f"T{d.get('id')} n_prompt={d.get('n_prompt')} n_past={d.get('n_past')} "
        f"prefill_s={d.get('prefill_s')} prefill_tps={d.get('prefill_tps')} "
        f"tok_s={d.get('tok_s')} tokens={d.get('tokens')}"
    )
(root / "conv5" / "turns_from_done.json").write_text(json.dumps(dones, indent=2), encoding="utf-8")
