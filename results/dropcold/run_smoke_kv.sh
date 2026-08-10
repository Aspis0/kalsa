#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LC_ALL=C
OUT="$HOME/experiments/results/dropcold/smoke_kv"
BIN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
IN="$HOME/experiments/results/adopt_dense2/smoke/gk1_in.jsonl"
export LD_LIBRARY_PATH="$(dirname "$BIN")"
mkdir -p "$OUT"
MASTER="$OUT/smoke.master.log"
: > "$MASTER"
ts(){ date "+%Y-%m-%dT%H:%M:%S%z"; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }
log "smoke KV post-pin"
sha256sum "$BIN" | tee -a "$MASTER"
cat "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256" | tee -a "$MASTER"
sha256sum "$IN" | tee -a "$MASTER"
# prestart
for i in $(seq 1 20); do
  n=$(nproc)
  die=$(for z in /sys/class/thermal/thermal_zone*; do t=$(cat $z/type 2>/dev/null); case "$t" in *cpu*|*CPU*) cat $z/temp;; esac; done 2>/dev/null | sort -n | tail -1)
  if [ "${die:-0}" -le 80000 ] 2>/dev/null && [ "$n" -ge 6 ]; then log "prestart OK die=$die n=$n"; break; fi
  log "wait die=$die n=$n"; sleep 8
done
if [ -x "$HOME/experiments/scripts/cold_model.sh" ]; then "$HOME/experiments/scripts/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true; fi
set +e
"$BIN" -m "$MODEL" -t 4 -c 2048 -n 32 --temp 0 --chatml --no-think   --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session   < "$IN" > "$OUT/smoke.stdout" 2> "$OUT/smoke.stderr"
rc=$?
set -e
log "rc=$rc"
# extract n_common / n_prompt from stderr
grep -E "n_common|n_prompt|n_past|BMOE_|prefill|turn|kv" "$OUT/smoke.stderr" 2>/dev/null | head -80 | tee -a "$MASTER" || true
# also search stdout
grep -E "n_common|n_prompt|n_past" "$OUT/smoke.stdout" 2>/dev/null | head -40 | tee -a "$MASTER" || true
python3 - << PY
import re, json
from pathlib import Path
err=Path("/smoke.stderr").read_text(encoding="utf-8", errors="replace")
out=Path("/smoke.stdout").read_text(encoding="utf-8", errors="replace")
text=err+"
"+out
# find all n_common occurrences
nc=re.findall(r"n_common[=: ]+(\d+)", text)
np=re.findall(r"n_prompt[=: ]+(\d+)", text)
print("n_common_hits", nc)
print("n_prompt_hits", np)
# try JSON progress lines
for line in text.splitlines():
    if "n_common" in line or "n_prompt" in line:
        if len(line)<300: print("L:", line)
verdict="FAIL"
# expected: some n_common==71
if any(int(x)==71 for x in nc):
    verdict="PASS"
# also accept if second turn n_prompt==41
if any(int(x)==41 for x in np):
    verdict="PASS" if verdict=="PASS" or True else verdict
    if any(int(x)==71 for x in nc):
        verdict="PASS"
Path("/STATUS_SMOKE.txt").write_text(f"DONE {verdict} n_common={nc} n_prompt={np} rc=
", encoding="utf-8")
print("VERDICT", verdict)
PY
cat "$OUT/STATUS_SMOKE.txt" | tee -a "$MASTER"
