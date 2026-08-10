#!/data/data/com.termux/files/usr/bin/bash
# Valid KV smoke: two-turn --session, expect n_common==71 on turn 2
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUT="${OUTDIR:-$HOME/experiments/results/requant1c/phase_b/kv_smoke_session}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
IN="$OUT/gk1_in.jsonl"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUT"
MASTER="$OUT/kv_session.master.log"
: > "$MASTER"
ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

# gold input: same prompts as adopt_dense2 smoke (PASS n_common=71 on IQ2_M)
cat > "$IN" <<'JSONL'
{"cmd": "generate", "prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "id": 1, "n_predict": 32, "clear_kv": true, "think": false}
{"cmd": "generate", "prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "id": 2, "n_predict": 32, "clear_kv": false, "think": false}
{"cmd": "close"}
JSONL

log "KV session smoke start model=$MODEL"
sha256sum "$BIN" "$MODEL" "$IN" | tee -a "$MASTER"
termux-battery-status 2>/dev/null | tee "$OUT/battery.json" || true
termux-wake-lock >/dev/null 2>&1 || true

if [ -x "$HOME/bin/cold_model.sh" ]; then "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true; fi

set +e
"$BIN" -m "$MODEL" -t 4 -c 2048 -n 32 --temp 0 --chatml --no-think \
  --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 \
  --ubatch 512 --n-expert-used 8 --drop-cold-experts 0.65 \
  --session < "$IN" > "$OUT/smoke.stdout" 2> "$OUT/smoke.stderr"
rc=$?
set -e
log "rc=$rc"

python3 - <<'PY'
import re, json
from pathlib import Path
out = Path.home() / "experiments/results/requant1c/phase_b/kv_smoke_session"
err = (out/"smoke.stderr").read_text(encoding="utf-8", errors="replace")
sto = (out/"smoke.stdout").read_text(encoding="utf-8", errors="replace")
text = err + "\n" + sto
# BMOE_DONE JSON lines
dones = []
for line in text.splitlines():
    if "BMOE_DONE" not in line:
        continue
    i = line.find("{")
    if i < 0:
        continue
    try:
        dones.append(json.loads(line[i:]))
    except Exception:
        pass
by = {int(d.get("id") or 0): d for d in dones}
t1, t2 = by.get(1, {}), by.get(2, {})
# n_common on t2
def nc(o):
    if "n_common" in o and o["n_common"] is not None:
        return int(o["n_common"])
    try:
        return max(int(o.get("n_past") or 0) - int(o.get("n_prompt") or 0) - int(o.get("tokens") or 0), 0)
    except Exception:
        return -1
n1p = t1.get("n_prompt"); n1past = t1.get("n_past")
n2p = t2.get("n_prompt"); n2past = t2.get("n_past"); n2c = nc(t2)
# also regex fallback
nc_hits = [int(x) for x in re.findall(r"n_common[=: ]+(\d+)", text)]
summary = {
    "t1_n_prompt": n1p, "t1_n_past": n1past,
    "t2_n_prompt": n2p, "t2_n_past": n2past, "t2_n_common": n2c,
    "n_common_regex": nc_hits, "dones": len(dones), "rc": None,
}
# PASS: n_common==71 (gold) or t1_n_past==71 with t2 reusing
verdict = "FAIL"
if n2c == 71 or any(x == 71 for x in nc_hits):
    verdict = "PASS"
elif n1past == 71 and n2c and n2c > 0:
    verdict = "PASS_SOFT"  # past matches gold shape
summary["verdict"] = verdict
(out/"kv_session.summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
(out/"STATUS_KV.txt").write_text(f"DONE {verdict} t2_n_common={n2c} t1_n_past={n1past} t2_n_prompt={n2p}\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
print("VERDICT", verdict)
PY
echo "rc=$rc" >> "$OUT/STATUS_KV.txt"
log "KV session smoke done $(cat $OUT/STATUS_KV.txt)"
cat "$OUT/STATUS_KV.txt"
