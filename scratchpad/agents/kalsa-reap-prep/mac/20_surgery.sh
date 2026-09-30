#!/usr/bin/env bash
# 20_surgery.sh — cut the pruned checkpoint on the MAC, CPU-only: moep's
# surgery streams shard-by-shard with device="cpu" (moep surgery.py), so the
# 72 GB base never needs to be resident. Responsibility: one pruned HF dir
# from the pod's keep-set; .ok only after the config expert count AND moep's
# own prune manifest both pass.
# Usage: mac/20_surgery.sh <keep-set.json>   (env: KALSA_MODELS, MOEP_DIR, PY)
set -euo pipefail

KALSA_MODELS="${KALSA_MODELS:-$HOME/kalsa-models}"
MOEP_DIR="${MOEP_DIR:-$KALSA_MODELS/reap-moep}"
PY="${PY:-$KALSA_MODELS/reap-calib/.venv/bin/python}"
BASE="${BASE:-$KALSA_MODELS/reap-src/base}"
RATIO="${PRUNE_RATIO:-50}"
KEEP="${1:?usage: 20_surgery.sh <keep-set.json> (keep_reap_0.5.json from the pod)}"

OUT="$KALSA_MODELS/reap-src/kalsa-reap$RATIO"
OK="$KALSA_MODELS/reap-src/kalsa-reap$RATIO.pruned-ok"
PRUNE_RATIO="$RATIO" bash "$(dirname "$0")/ensure_moep.sh"

if [ -f "$OK" ]; then echo "20_surgery: already verified OK"; exit 0; fi
rm -rf "$OUT"   # partial surgery output is not resumable state
test -f "$BASE/model.safetensors.index.json" || { echo "20: base model missing — run 10_fetch_base.sh" >&2; exit 1; }
test -f "$KEEP" || { echo "20: keep-set missing at $KEEP" >&2; exit 1; }

PYTHONPATH="$MOEP_DIR/src" "$PY" -m moep.cli prune \
  --run "$KALSA_MODELS/reap-src/runs" --model "$BASE" \
  --selection "$KEEP" --out "$OUT"

n_exp=$("$PY" -c "
import json
c = json.load(open('$OUT/config.json'))
print(c.get('text_config', c)['num_experts'])")
expect=$(awk -v r="$RATIO" 'BEGIN {printf "%d", 256 - r * 256 / 100}')
[ "$n_exp" = "$expect" ] \
  || { echo "20: config num_experts=$n_exp, expected $expect" >&2; rm -rf "$OUT"; exit 1; }

# moep's own manifest: status ok + byte-row checks recorded + pruned index exists
"$PY" - "$KALSA_MODELS/reap-src/runs" "$OUT" <<'EOF'
import json, pathlib, sys
run, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
m = json.loads((run / f"prune_{out.name}.json").read_text())
assert m["status"] == "ok", m["status"]
assert m["evidence"]["row_checks"] > 0, m["evidence"]
assert pathlib.Path(m["outputs"]["model"]).exists(), m["outputs"]
print(f"20: surgery manifest ok, row_checks={m['evidence']['row_checks']}")
EOF

touch "$OK"
echo "20_surgery: OK ($OUT, $n_exp experts/layer)"
