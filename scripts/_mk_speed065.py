#!/usr/bin/env python3
"""Transform run_speed_dropcold.sh → run_speed_dropcold_065.sh (A=0.50 vs B=0.65)."""
from pathlib import Path

SRC = Path(__file__).with_name("run_speed_dropcold.sh")
DST = Path(__file__).with_name("run_speed_dropcold_065.sh")
src = SRC.read_text(encoding="utf-8")

src = src.replace(
    """# run_speed_dropcold.sh — test velocità da STACCATO del candidato --drop-cold-experts 0.50
# Disegno A/B dichiarato PRIMA dei numeri:
#   A = F=0 (flag assente)  baseline
#   B = --drop-cold-experts 0.50
# Celle: 2 prompt (short + f45_1) × 2 rep × 2 bracci, n=200
# Ordine ABBA per prompt (A,B,B,A). Fadvise cold PRIMA DI OGNI run.
# Smoke KV con flag ON (atteso n_common=71). Opzionale sostenuto n=512 se batt≥38%.
# Floor batteria 30% = fine sessione. Solo bmoe-cli.CAMPAIGN (pin).
""",
    """# run_speed_dropcold_065.sh — gate SOSTITUZIONE F=0.65 vs default 0.50 (non-regressione)
# Disegno A/B dichiarato PRIMA dei numeri (mandates/speed-dropcold-065.md):
#   A = --drop-cold-experts 0.50  (default campagna attuale)
#   B = --drop-cold-experts 0.65  (override esplicito, candidato sostituzione)
# Celle: 2 prompt (short + f45_1) × 2 rep × 2 bracci, n=200
# Ordine ABBA per prompt (A,B,B,A). Fadvise cold PRIMA DI OGNI run.
# Smoke KV con B (atteso n_past t1=71). Opzionale sostenuto n=512 se batt≥38%.
# Gate NON-REGRESSIONE: mediana decode B ≥ A − 2% → SOSTITUZIONE RACCOMANDATA.
# Banda attesa B: MiB/tok ≈ 28.6±10%, hit ≈ 82.4, drop ≈ 6.1%.
# Floor batteria 30% = fine sessione. Solo bmoe-cli.CAMPAIGN (pin). NESSUN rebuild.
""",
)

src = src.replace(
    'OUTDIR="${OUTDIR:-$HOME/experiments/results/dropcold/speed}"',
    'OUTDIR="${OUTDIR:-$HOME/experiments/results/dropcold/speed065}"',
)
src = src.replace(
    'MASTER="$OUTDIR/SPEED_DROPCOLD.master.log"\nPIDFILE="$OUTDIR/speed_dropcold.pid"',
    'MASTER="$OUTDIR/SPEED_DROPCOLD065.master.log"\nPIDFILE="$OUTDIR/speed_dropcold065.pid"',
)
src = src.replace('TAG_PHASE="SPEED-DROPCOLD"', 'TAG_PHASE="SPEED-DROPCOLD-065"')
src = src.replace(
    """DROP_F="0.50"
EXPECTED_DROP_PCT="2.2"
EXPECTED_HIT_A="77"
EXPECTED_HIT_B="79"
NCOMMON_EXPECTED=71
""",
    """DROP_F_A="0.50"
DROP_F_B="0.65"
DROP_F="$DROP_F_B"   # default for smoke/sostenuto = B
EXPECTED_DROP_PCT_B="6.1"
EXPECTED_HIT_B="82.4"
EXPECTED_MIB_B="28.6"
EXPECTED_MIB_TOL="0.10"  # ±10%
NCOMMON_EXPECTED=71
""",
)

src = src.replace(
    "*run_speed_dropcold*|*run_cache_down*|*run_staccato*",
    "*run_speed_dropcold*|*run_cache_down*|*run_staccato*|*speed_dropcold065*",
)

old_flags = """  if [ "$arm" = "B" ]; then
    FLAGS+=(--drop-cold-experts "$DROP_F")
  fi"""
new_flags = """  if [ "$arm" = "A" ]; then
    FLAGS+=(--drop-cold-experts "$DROP_F_A")
  else
    FLAGS+=(--drop-cold-experts "$DROP_F_B")
  fi"""
assert old_flags in src, "flags block missing"
src = src.replace(old_flags, new_flags, 1)

old_flags_s = '  if [ "$arm" = "B" ]; then flags_s="$flags_s --drop-cold-experts ${DROP_F}"; fi'
new_flags_s = (
    '  if [ "$arm" = "A" ]; then flags_s="$flags_s --drop-cold-experts ${DROP_F_A}"; '
    'else flags_s="$flags_s --drop-cold-experts ${DROP_F_B}"; fi'
)
assert old_flags_s in src, "flags_s missing"
src = src.replace(old_flags_s, new_flags_s, 1)

src = src.replace(
    'local notesx="speed_dropcold;arm=${arm};F=${DROP_F};seq=${seq};abba"',
    'local _f="${DROP_F_A}"; [ "$arm" = "B" ] && _f="${DROP_F_B}"; '
    'local notesx="speed_dropcold065;arm=${arm};F=${_f};seq=${seq};abba"',
)
src = src.replace(
    'local notesx="speed_dropcold;arm=B;sostenuto;n=${N_SOSTENUTO}"',
    'local notesx="speed_dropcold065;arm=B;F=${DROP_F_B};sostenuto;n=${N_SOSTENUTO}"',
)

src = src.replace(
    'speed_dropcold --title "SPEED_DROPCOLD nproc"',
    'speed_dropcold065 --title "SPEED_DROPCOLD065 nproc"',
)
src = src.replace("SPEED_DROPCOLD nproc", "SPEED_DROPCOLD065 nproc")

src = src.replace(
    '  OUTDIR="$OUTDIR" DROP_F="$DROP_F" EXPECTED_DROP_PCT="$EXPECTED_DROP_PCT" BIN_SHA256="$BIN_SHA256" python3 - <<\'PY\'',
    '  OUTDIR="$OUTDIR" DROP_F_A="$DROP_F_A" DROP_F_B="$DROP_F_B" '
    'EXPECTED_DROP_PCT_B="$EXPECTED_DROP_PCT_B" EXPECTED_MIB_B="$EXPECTED_MIB_B" '
    'EXPECTED_MIB_TOL="$EXPECTED_MIB_TOL" EXPECTED_HIT_B="$EXPECTED_HIT_B" '
    'BIN_SHA256="$BIN_SHA256" python3 - <<\'PY\'',
)

old_py_start = """import json, os, statistics
from pathlib import Path

outdir = Path(os.environ["OUTDIR"])
drop_f = float(os.environ["DROP_F"])
exp_drop = float(os.environ["EXPECTED_DROP_PCT"])
bin_sha = os.environ["BIN_SHA256"]
"""
new_py_start = """import json, os, statistics, re
from pathlib import Path

outdir = Path(os.environ["OUTDIR"])
drop_f_a = float(os.environ["DROP_F_A"])
drop_f_b = float(os.environ["DROP_F_B"])
exp_drop = float(os.environ["EXPECTED_DROP_PCT_B"])
exp_mib = float(os.environ["EXPECTED_MIB_B"])
exp_mib_tol = float(os.environ["EXPECTED_MIB_TOL"])
exp_hit = float(os.environ["EXPECTED_HIT_B"])
bin_sha = os.environ["BIN_SHA256"]
"""
assert old_py_start in src, "py start missing"
src = src.replace(old_py_start, new_py_start, 1)

# Locate and replace from "# coherence check on drop%" through the final print block
start = src.index("# coherence check on drop%")
end = src.index("PY\n  cat \"$OUTDIR/VERDICT.txt\"", start)
new_logic = r'''# coherence: B MiB/tok ≈ 28.6 ±10% (primary), drop≈6.1, hit≈82.4 secondary
drop_med = med(b_drop)
mib_med_b = med(b_mib)
hit_med_b = med(b_hit)
coherent = True
coherent_reason = "ok"
mib_lo = exp_mib * (1.0 - exp_mib_tol)
mib_hi = exp_mib * (1.0 + exp_mib_tol)
if mib_med_b is None:
    coherent = False
    coherent_reason = "mib_per_token missing on B"
elif not (mib_lo <= mib_med_b <= mib_hi):
    coherent = False
    coherent_reason = f"mib_B={mib_med_b} outside {mib_lo:.2f}..{mib_hi:.2f} (knee 28.6±10%)"
elif drop_med is None:
    coherent = False
    coherent_reason = "drop_pct missing on B"
drop_band_ok = True
if drop_med is not None and (drop_med < 2.0 or drop_med > 12.0):
    drop_band_ok = False

lmkd_total = int(sum(a_lmkd) + sum(b_lmkd)) if (a_lmkd or b_lmkd) else 0

# per-prompt medians (critical: pooling can inflate Δ)
def prompt_key(label):
    m = re.match(r"^[AB]-(short|f45_1)", label or "")
    return m.group(1) if m else "other"

def by_prompt(rows, key):
    out = {"short": [], "f45_1": [], "other": []}
    for r in rows:
        lab = r.get("label", r.get("_file", ""))
        pk = prompt_key(lab)
        v = r.get(key, "")
        if v in ("", None):
            continue
        try:
            out[pk].append(float(str(v).replace("%", "")))
        except Exception:
            pass
    return {k: med(vs) for k, vs in out.items() if vs}

per_prompt_A = by_prompt(A, "eval_tok_s")
per_prompt_B = by_prompt(B, "eval_tok_s")
per_prompt_delta = {}
for pk in sorted(set(per_prompt_A) | set(per_prompt_B)):
    a = per_prompt_A.get(pk); b = per_prompt_B.get(pk)
    if a and b and a != 0:
        per_prompt_delta[pk] = 100.0 * (b - a) / a
    else:
        per_prompt_delta[pk] = None

# smoke
smoke_path = outdir / "smoke_kv" / "smoke_meta.json"
smoke = {}
if smoke_path.exists():
    smoke = json.loads(smoke_path.read_text(encoding="utf-8"))

# sostenuto
sost_status = "NOT_ATTEMPTED"
sost_sum = outdir / "sostenuto"
if (sost_sum / "STATUS.txt").exists():
    sost_status = (sost_sum / "STATUS.txt").read_text(encoding="utf-8").strip()
sost_rows = []
for f in sorted(sost_sum.glob("*.summary.txt")) if sost_sum.exists() else []:
    d = {}
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    sost_rows.append(d)

# Gate NON-REGRESSIONE (mandato speed-dropcold-065):
# B ≥ A − 2% → SOSTITUZIONE_RACCOMANDATA
# B > A + 3% → SOSTITUZIONE_RACCOMANDATA_PLUS
# B < A − 2% → TIENE_0.50
# incoerenza banda MiB → STOP
if not coherent:
    verdict = "STOP_INCOHERENT_BANDA"
elif med_a is None or med_b is None or len(a_eval) < 4 or len(b_eval) < 4:
    verdict = "INCOMPLETE"
elif smoke and smoke.get("verdict") != "PASS":
    verdict = "STOP_SMOKE_KV"
elif delta_pct is not None and delta_pct >= -2.0:
    if delta_pct > 3.0:
        verdict = "SOSTITUZIONE_RACCOMANDATA_PLUS"
    else:
        verdict = "SOSTITUZIONE_RACCOMANDATA"
else:
    verdict = "TIENE_0.50"

meta = {
    "verdict": verdict,
    "med_eval_A": med_a,
    "med_eval_B": med_b,
    "delta_pct": delta_pct,
    "gate_threshold_pct": -2.0,
    "per_prompt_med_A": per_prompt_A,
    "per_prompt_med_B": per_prompt_B,
    "per_prompt_delta_pct": per_prompt_delta,
    "n_A": len(a_eval),
    "n_B": len(b_eval),
    "values_A": a_eval,
    "values_B": b_eval,
    "med_prefill_A": med(a_pref),
    "med_prefill_B": med(b_pref),
    "med_hit_A": med(a_hit),
    "med_hit_B": med(b_hit),
    "med_mib_A": med(a_mib),
    "med_mib_B": mib_med_b,
    "med_drop_A": med(nums(A, "drop_pct")),
    "med_drop_B": drop_med,
    "expected_drop_pct_B": exp_drop,
    "expected_mib_B": exp_mib,
    "expected_mib_band": [mib_lo, mib_hi],
    "expected_hit_B": exp_hit,
    "drop_band_ok": drop_band_ok,
    "coherent": coherent,
    "coherent_reason": coherent_reason,
    "lmkd_total": lmkd_total,
    "smoke": smoke,
    "sostenuto_status": sost_status,
    "sostenuto": sost_rows,
    "runs_A": A,
    "runs_B": B,
    "bin_sha256": bin_sha,
    "drop_f_A": drop_f_a,
    "drop_f_B": drop_f_b,
    "delta_ppl_quality_knee": 0.104,
}
(outdir / "verdict.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
(outdir / "VERDICT.txt").write_text(
    f"verdict={verdict}\nmed_A={med_a}\nmed_B={med_b}\ndelta_pct={delta_pct}\n"
    f"per_prompt_delta={per_prompt_delta}\nmib_B={mib_med_b}\ndrop_med_B={drop_med}\n"
    f"lmkd={lmkd_total}\ncoherent={coherent} ({coherent_reason})\n"
    f"smoke={smoke.get('verdict')}\nsostenuto={sost_status}\n",
    encoding="utf-8",
)
print(json.dumps({k: meta[k] for k in (
    "verdict","med_eval_A","med_eval_B","delta_pct","per_prompt_delta_pct",
    "med_mib_B","med_drop_B","coherent","coherent_reason",
    "lmkd_total","sostenuto_status","n_A","n_B"
)}, indent=2))
'''
src = src[:start] + new_logic + src[end:]

src = src.replace(
    'log "=== SPEED DROPCOLD START bin=$BIN sha=$BIN_SHA256 F=$DROP_F ==="',
    'log "=== SPEED DROPCOLD-065 START bin=$BIN sha=$BIN_SHA256 A=F${DROP_F_A} B=F${DROP_F_B} ==="',
)
src = src.replace(
    'log "=== SPEED DROPCOLD END $(cat "$OUTDIR/VERDICT.txt" | tr \'\\n\' \'; \') rc=$FINAL_RC ==="',
    'log "=== SPEED DROPCOLD-065 END $(cat "$OUTDIR/VERDICT.txt" | tr \'\\n\' \'; \') rc=$FINAL_RC ==="',
)

DST.write_text(src, encoding="utf-8", newline="\n")
print(f"wrote {DST} bytes={DST.stat().st_size} lines={src.count(chr(10))+1}")
for needle in [
    "DROP_F_A",
    "DROP_F_B",
    "SOSTITUZIONE_RACCOMANDATA",
    "speed065",
    "28.6",
    "EXPECTED_MIB_B",
    "TIENE_0.50",
]:
    assert needle in src, needle
assert 'drop_f = float(os.environ["DROP_F"])' not in src
assert 'FLAGS+=(--drop-cold-experts "$DROP_F")' not in src
print("sanity OK")
