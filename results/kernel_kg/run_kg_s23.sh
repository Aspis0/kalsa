#!/data/data/com.termux/files/usr/bin/bash
# K-G boundary prototype — on-device orchestrator (S23 / Adreno 740).
# Measurement + scripting only. Does not touch campaign pins or existing ~/gdn_k2/bin*.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

ROOT="${ROOT:-$HOME/experiments/results/kernel_kg}"
BINDIR="${BINDIR:-$HOME/bin/kernel_kg}"
CAMPAIGN="${CAMPAIGN:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
CALA="${CALA:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
M2B="${M2B:-$HOME/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf}"
M4B="${M4B:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
OCLBIN="${OCLBIN:-$HOME/gdn_k2/bin_fix2}"
ABORT_C="${ABORT_C:-43}"
FLOOR_BATT="${FLOOR_BATT:-45}"

mkdir -p "$ROOT"/{logs,m0,m1,m2,m3} "$BINDIR"
MASTER="$ROOT/master.log"
STATUS="$ROOT/STATUS.txt"
CELLS="$ROOT/cells.csv"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

batt_json(){
  # Termux API. dumpsys battery hangs / is empty for this uid.
  timeout 8 termux-battery-status 2>/dev/null | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print("level=? temp_c=? plugged=? status=? current=? voltage=?")
    raise SystemExit(0)
print("level={level} temp_c={temperature} plugged={plugged} status={status} current={current} voltage={voltage}".format(
    level=d.get("percentage", d.get("level","?")),
    temperature=d.get("temperature","?"),
    plugged=d.get("plugged","?"),
    status=d.get("status","?"),
    current=d.get("current","?"),
    voltage=d.get("voltage","?")))
' || echo "level=? temp_c=? plugged=? status=? current=? voltage=?"
}

screen_state(){
  timeout 3 dumpsys power 2>/dev/null | awk '/mWakefulness=/{print $1; exit}' || echo "screen=?"
}

die_c(){
  # Prefer termux temperature (battery). AP/SKIN via dumpsys often hangs here.
  timeout 8 termux-battery-status 2>/dev/null | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    print("batt_c=%s" % d.get("temperature","?"))
except Exception:
    print("batt_c=?")
' || echo "batt_c=?"
}

batt_level(){
  timeout 8 termux-battery-status 2>/dev/null | python3 -c '
import sys,json
d=json.load(sys.stdin)
print(int(d.get("percentage", d.get("level", 0))))
' || echo 0
}

batt_temp(){
  timeout 8 termux-battery-status 2>/dev/null | python3 -c '
import sys,json
d=json.load(sys.stdin)
print(float(d.get("temperature", 0)))
' || echo 0
}

guard(){
  python3 - "$FLOOR_BATT" "$ABORT_C" <<'PY'
import json,subprocess,sys
floor,abort=int(sys.argv[1]),float(sys.argv[2])
try:
    raw=subprocess.check_output(["termux-battery-status"], timeout=8)
    d=json.loads(raw)
    batt=int(d.get("percentage", d.get("level", 0)))
    temp=float(d.get("temperature", 99))
except Exception as e:
    print(f"ABORT_BATT_API {e}")
    sys.exit(7)
if batt < floor:
    print(f"ABORT_BATT {batt}<{floor}")
    sys.exit(7)
if temp >= abort:
    print(f"ABORT_TEMP {temp}>={abort}")
    sys.exit(8)
print(f"ok batt={batt} temp_c={temp}")
PY
}

snap(){
  local tag="$1"
  {
    echo "=== SNAP $tag $(ts) ==="
    batt_json
    die_c
    echo "screen=$(screen_state)"
    echo "uptime=$(uptime)"
    free -m 2>/dev/null | head -2 || true
  } | tee -a "$ROOT/logs/snap_${tag}.txt" | tee -a "$MASTER"
}

echo "RUNNING" > "$STATUS"
: >> "$MASTER"
if [ ! -f "$CELLS" ]; then
  echo "cell,rc,wall_s,note,batt_s,batt_e,temp_s,temp_e,screen_s,screen_e" > "$CELLS"
fi

log "K-G start ROOT=$ROOT"
snap start
guard | tee -a "$MASTER"

# --- pin / sha inventory (do not touch these files) ---
{
  echo "=== SHAS $(ts) ==="
  sha256sum \
    "$CAMPAIGN" \
    "$OCLBIN/llama-cli" \
    "$OCLBIN/llama-bench" \
    "$OCLBIN/test-backend-ops" \
    "$OCLBIN/libc++_shared.so" \
    2>&1
  echo "expected campaign 1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"
  echo "expected llama-cli 0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da"
  echo "expected llama-bench 1456239bc3a033e9d6198d2370516990e0e97c0dc939c54d94b2bf7fb8e18aca"
  echo "expected test-backend-ops 8f0037c90f9edf2e70ac56c4ba9c5874d625999b140f85bfb84ed8f9a954b0ea"
} | tee "$ROOT/SHAS.txt" | tee -a "$MASTER"

# --- prompt ~1.4k tokens (English, chatml will wrap) ---
PROMPT="$ROOT/prompt_14h.txt"
python3 - "$PROMPT" <<'PY'
import sys
p=sys.argv[1]
para = (
    "Write a careful step by step explanation of how a transformer language model "
    "turns a long prompt into the next token, covering tokenization, embedding lookup, "
    "attention over the full context, the feed forward layers, and the final language "
    "model head that produces a probability distribution. Include routing in a mixture "
    "of experts, why some layers use gated delta net linear attention, and how a phone "
    "runtime streams expert weights from flash. "
)
# ~5.6k chars ≈ 1.4k English tokens; chatml wrapper adds a bit.
text = (para * 12).strip()
open(p,"w",encoding="utf-8").write(text+"\n")
print(f"prompt_chars={len(text)}")
PY
PROMPT512="$ROOT/prompt_512ish.txt"
python3 - "$PROMPT512" <<'PY'
import sys
p=sys.argv[1]
para = (
    "Write a careful step by step explanation of how a transformer language model "
    "turns a long prompt into the next token, covering tokenization, embedding lookup, "
    "attention over the full context, the feed forward layers, and the final language "
    "model head that produces a probability distribution. "
)
text = (para * 5).strip()
open(p,"w",encoding="utf-8").write(text+"\n")
print(f"prompt512_chars={len(text)}")
PY

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
cleanup(){
  if [ -n "${SCREEN_PREV:-}" ] && [ "${SCREEN_PREV}" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
  log "cleanup"
}
trap cleanup EXIT

run_cell(){
  local name="$1"; shift
  local t0 t1 rc=0
  snap "before_${name}"
  guard | tee -a "$MASTER" || { echo "$name,7,0,guard_fail,,,,," >> "$CELLS"; return 7; }
  local bs be ts_ te ss se
  bs=$(batt_level)
  ts_=$(batt_temp)
  ss=$(screen_state)
  t0=$(date +%s)
  set +e
  "$@" > "$ROOT/logs/${name}.out" 2> "$ROOT/logs/${name}.err"
  rc=$?
  set -e
  t1=$(date +%s)
  be=$(batt_level)
  te=$(batt_temp)
  se=$(screen_state)
  echo "${name},${rc},$((t1-t0)),cmd,${bs},${be},${ts_},${te},${ss},${se}" >> "$CELLS"
  snap "after_${name}"
  log "CELL ${name} rc=${rc} wall=$((t1-t0))s batt=${bs}->${be} temp=${ts_}->${te}"
  return 0
}

# =====================================================================
# M1 — OpenCL boundary microbench (new binary in ~/bin/kernel_kg only)
# Skip if already measured this session (reruns start at M2).
# =====================================================================
if [ -f "$ROOT/m1/m1_512x2048.txt" ]; then
  log "M1 skip (m1_512x2048.txt exists)"
else
  log "M1 compile"
  cp -f "$ROOT/kg_boundary.c" "$BINDIR/kg_boundary.c"
  clang -O2 -ldl "$BINDIR/kg_boundary.c" -o "$BINDIR/kg_boundary"
  sha256sum "$BINDIR/kg_boundary" | tee "$ROOT/m1/kg_boundary.sha256"
  export LD_LIBRARY_PATH="/vendor/lib64:${LD_LIBRARY_PATH:-}"
  run_cell m1_512x2048 "$BINDIR/kg_boundary" --tokens 512 --embd 2048 --iters 16 --warmup 4
  cp -f "$ROOT/logs/m1_512x2048.out" "$ROOT/m1/m1_512x2048.txt"
  cp -f "$ROOT/logs/m1_512x2048.err" "$ROOT/m1/m1_512x2048.err"
  run_cell m1_1x2048 "$BINDIR/kg_boundary" --tokens 1 --embd 2048 --iters 16 --warmup 4
  cp -f "$ROOT/logs/m1_1x2048.out" "$ROOT/m1/m1_1x2048.txt"
fi

# =====================================================================
# M2 — dense 2B/4B GPU vs CPU prefill at p512 (existing K2.2b binaries)
# =====================================================================
export LD_LIBRARY_PATH="${OCLBIN}:/vendor/lib64:${LD_LIBRARY_PATH:-}"
# Prefill only (-n 0). Decode on this OpenCL binary is the known 0.41x lose and
# was eating 15+ min/cell. -p 512 is the ubatch the gate asked for. -p 128
# calibrates against K2.2's published 1.29x.

if [ -f "$M2B" ]; then
  if [ ! -f "$ROOT/m2/bench_2b_cpu_p128.json" ]; then
    run_cell m2_2b_cpu_p128 "${OCLBIN}/llama-bench" -m "$M2B" -t 4 -p 128 -n 0 -r 2 -ngl 0 -o json
    cp -f "$ROOT/logs/m2_2b_cpu_p128.out" "$ROOT/m2/bench_2b_cpu_p128.json" || true
  fi
  if [ ! -f "$ROOT/m2/bench_2b_gpu_p128.json" ]; then
    run_cell m2_2b_gpu_p128 "${OCLBIN}/llama-bench" -m "$M2B" -t 4 -p 128 -n 0 -r 2 -ngl 99 -fa off -o json
    cp -f "$ROOT/logs/m2_2b_gpu_p128.out" "$ROOT/m2/bench_2b_gpu_p128.json" || true
  fi
  if [ ! -f "$ROOT/m2/bench_2b_cpu.json" ]; then
    run_cell m2_2b_cpu "${OCLBIN}/llama-bench" -m "$M2B" -t 4 -p 512 -n 0 -r 2 -ngl 0 -o json
    cp -f "$ROOT/logs/m2_2b_cpu.out" "$ROOT/m2/bench_2b_cpu.json" || true
  fi
  if [ ! -f "$ROOT/m2/bench_2b_gpu.json" ]; then
    run_cell m2_2b_gpu "${OCLBIN}/llama-bench" -m "$M2B" -t 4 -p 512 -n 0 -r 2 -ngl 99 -fa off -o json
    cp -f "$ROOT/logs/m2_2b_gpu.out" "$ROOT/m2/bench_2b_gpu.json" || true
  fi
else
  log "WARN no 2B model at $M2B"
fi

if [ -f "$M4B" ]; then
  if [ ! -f "$ROOT/m2/bench_4b_cpu.json" ]; then
    run_cell m2_4b_cpu "${OCLBIN}/llama-bench" -m "$M4B" -t 4 -p 512 -n 0 -r 2 -ngl 0 -o json
    cp -f "$ROOT/logs/m2_4b_cpu.out" "$ROOT/m2/bench_4b_cpu.json" || true
  fi
  if [ ! -f "$ROOT/m2/bench_4b_gpu.json" ]; then
    run_cell m2_4b_gpu "${OCLBIN}/llama-bench" -m "$M4B" -t 4 -p 512 -n 0 -r 2 -ngl 99 -fa off -o json
    cp -f "$ROOT/logs/m2_4b_gpu.out" "$ROOT/m2/bench_4b_gpu.json" || true
  fi
else
  log "WARN no 4B model at $M4B"
fi

# =====================================================================
# M0 — CalaQwen CPU prefill split (campaign pin, k6d065)
# =====================================================================
export LD_LIBRARY_PATH="$(dirname "$CAMPAIGN"):${LD_LIBRARY_PATH:-}"
P1400=$(cat "$PROMPT")
P512=$(cat "$PROMPT512")
FLAGS=( -t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
        --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65
        --temp 0 --chatml --no-think --progress )

# untraced wall on ~1.4k prompt (honest prefill tok/s)
run_cell m0_wall_14h "$CAMPAIGN" -m "$CALA" -p "$P1400" -n 1 "${FLAGS[@]}"
cp -f "$ROOT/logs/m0_wall_14h.out" "$ROOT/m0/wall_14h.out"

# instrumented split: one ubatch-ish prompt (proportions; NOT a bench)
run_cell m0_trace_512 "$CAMPAIGN" -m "$CALA" -p "$P512" -n 1 "${FLAGS[@]}" \
  --compute-trace "$ROOT/m0/compute_512.csv"
cp -f "$ROOT/logs/m0_trace_512.out" "$ROOT/m0/trace_512.out"

# classify if python present
if [ -f "$ROOT/analyze_m0.py" ]; then
  python3 "$ROOT/analyze_m0.py" "$ROOT/m0/compute_512.csv" "$ROOT/m0/split_512.json" \
    | tee "$ROOT/m0/split_512.txt" || true
fi

snap end
log "K-G orchestrator done"
echo "ORCH_DONE" > "$STATUS"
