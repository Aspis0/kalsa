#!/data/data/com.termux/files/usr/bin/bash
# run_all.sh — S23 ONLY. IDEA1 peakiness / k=1, IDEA2 ngram+mtp smoke, IDEA3 session KV.
# Binary: bmoe-cli.CAMPAIGN (sha 1ca51420…). Model: Qwen3.6-35B-A3B-KEXP.gguf
# Do NOT launch llama-cli (no moe-stream → RescueParty on the 13GB GGUF).
# Do NOT abort on MemFree<300 MiB (35B loaded sits ~100 MiB). Guard MemAvail<400000 kB + LMKD.
# Speed cells: UNPLUGGED, batt>=45, batt temp<=45. Abort if boot_id changes. One process at a time.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

HERE="$(cd "$(dirname "$0")" && pwd)"
WS="${WS:-$HOME/gdn_k2/s23_123}"
OUT="${OUTDIR:-$WS}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
PROMPT="${PROMPT:-$HERE/p_fact.txt}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

PIN_PREFIX="1ca51420"
MODEL_SIZE_EXPECT="13416430592"
MEMAVAIL_ABORT_KB="${MEMAVAIL_ABORT_KB:-400000}"
MEMFREE_LMKD_KB="${MEMFREE_LMKD_KB:-50000}"
BATT_FLOOR="${BATT_FLOOR:-45}"
TEMP_CEIL="${TEMP_CEIL:-45}"
CELL_TIMEOUT_S="${CELL_TIMEOUT_S:-1800}"
MTP_TIMEOUT_S="${MTP_TIMEOUT_S:-900}"
BUSY_WAIT_S="${BUSY_WAIT_S:-3600}"
WATCH_SLEEP_S="${WATCH_SLEEP_S:-5}"
SECOND_USER="In one sentence, what is the main phone-side trade-off of storing every expert on flash?"

mkdir -p "$OUT/A" "$OUT/B" "$OUT/C" "$OUT/D" "$OUT/E" "$OUT/batt" "$OUT/mem"
MASTER="$OUT/S23_123.master.log"
STATUS="$OUT/STATUS.txt"
CSV="$OUT/cells.csv"
WD_FLAG="$OUT/WATCHDOG.txt"
BOOT_FILE="$OUT/boot_id.txt"
: > "$MASTER"
: > "$WD_FLAG"
echo "RUNNING" > "$STATUS"
echo "cell,rc,wall_s,n_gen,tok_s,n_prompt,n_past,drafted,accepted,drafted_steps,batt_pct,plugged,temp_c,memfree_kb,memavail_kb,notes" > "$CSV"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

CELL_PID=""
WD_PID=""
cleanup() {
  local ec=$?
  stop_watch || true
  if [ -n "${CELL_PID:-}" ] && kill -0 "$CELL_PID" 2>/dev/null; then
    kill -TERM "$CELL_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$CELL_PID" 2>/dev/null || true
    wait "$CELL_PID" 2>/dev/null || true
  fi
  if [ ! -s "$STATUS" ] || [ "$(cat "$STATUS" 2>/dev/null)" = "RUNNING" ]; then
    if [ "$ec" -ne 0 ]; then echo "BLOCKED_EXIT_$ec" > "$STATUS"; fi
  fi
}
trap cleanup EXIT

fail() {
  local code="$1"; shift
  log "ABORT $code $*"
  echo "$code" > "$STATUS"
  exit 1
}

memfree_kb() { awk '/^MemFree:/{print $2}' /proc/meminfo; }
memavail_kb() { awk '/^MemAvailable:/{print $2}' /proc/meminfo; }
boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo UNKNOWN; }

batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 termux-battery-status 2>/dev/null || echo ''
  else
    termux-battery-status 2>/dev/null || echo ''
  fi
}

batt_fields() {
  python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("MISSING 0 0")
    raise SystemExit(0)
try:
    d = json.loads(raw)
except Exception:
    print("BADJSON 0 0")
    raise SystemExit(0)
plug = str(d.get("plugged", "?"))
try:
    pct = int(d.get("percentage", 0))
except Exception:
    pct = 0
try:
    temp = float(d.get("temperature", 0))
except Exception:
    temp = 0.0
print("%s %s %s" % (plug, pct, temp))
'
}

infer_busy_lines() {
  pgrep -af '[b]moe-cli|[l]lama-cli' 2>/dev/null || true
}

wait_idle() {
  local t0 now hits
  t0=$(date +%s)
  while :; do
    hits=$(infer_busy_lines)
    if [ -z "$hits" ]; then
      return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -gt "$BUSY_WAIT_S" ]; then
      fail "BLOCKED_BUSY" "infer still running after ${BUSY_WAIT_S}s (not killing): $hits"
    fi
    log "WAIT other infer still running; not killing: $hits"
    sleep 15
  done
}

check_reboot() {
  local now expected
  now=$(boot_id)
  expected=$(cat "$BOOT_FILE" 2>/dev/null || echo "")
  if [ -z "$expected" ]; then
    echo "$now" > "$BOOT_FILE"
    return 0
  fi
  if [ "$now" != "$expected" ]; then
    fail "ABORT_REBOOT" "boot_id changed $expected -> $now"
  fi
}

snapshot() {
  local tag="$1"
  local bj plug pct temp mf ma
  bj=$(batt_json)
  printf '%s\n' "$bj" > "$OUT/batt/${tag}.json"
  read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
  mf=$(memfree_kb)
  ma=$(memavail_kb)
  echo "$mf $ma" > "$OUT/mem/${tag}.kb"
  log "snap $tag plugged=$plug batt=$pct temp=$temp MemFree_kB=$mf MemAvail_kB=$ma"
  LAST_PLUG="$plug"
  LAST_PCT="$pct"
  LAST_TEMP="$temp"
  LAST_MF="$mf"
  LAST_MA="$ma"
}

# MemFree ~100 MiB after 35B load is expected. Abort only on MemAvail floor or LMKD MemFree.
guardrail() {
  local tag="$1"
  local nowait="${2:-}"
  local mf2 ma2
  snapshot "$tag"
  if [ "$LAST_PLUG" = "MISSING" ] || [ "$LAST_PLUG" = "BADJSON" ] || [ "$LAST_PLUG" = "?" ] || [ -z "$LAST_PLUG" ]; then
    fail "BLOCKED_BATT" "$tag cannot read termux-battery-status ($LAST_PLUG)"
  fi
  if ! echo "$LAST_PLUG" | grep -qi UNPLUGGED; then
    fail "BLOCKED_PLUGGED" "$tag plugged=$LAST_PLUG"
  fi
  if [ "$LAST_PCT" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    fail "BLOCKED_BATT" "$tag batt=$LAST_PCT < $BATT_FLOOR"
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$LAST_TEMP" "$TEMP_CEIL"; then
    fail "BLOCKED_THERMAL" "$tag temp=$LAST_TEMP > $TEMP_CEIL"
  fi
  if [ -z "$LAST_MA" ] || [ "$LAST_MA" -lt 1 ] 2>/dev/null; then
    fail "BLOCKED_MEM" "$tag MemAvailable unreadable"
  fi
  if [ "$LAST_MA" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null || [ "$LAST_MF" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
    if [ "$nowait" = "nowait" ]; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$LAST_MF MemAvail_kB=$LAST_MA"
    fi
    sleep 2
    mf2=$(memfree_kb)
    ma2=$(memavail_kb)
    echo "$mf2 $ma2" >> "$OUT/mem/${tag}.kb"
    log "guard $tag mem pair free=$LAST_MF/$mf2 avail=$LAST_MA/$ma2"
    if [ "$ma2" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "$tag MemAvail_kB=$LAST_MA then $ma2 < $MEMAVAIL_ABORT_KB"
    fi
    if [ "$mf2" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$LAST_MF then $mf2 < $MEMFREE_LMKD_KB LMKD"
    fi
    LAST_MF="$mf2"
    LAST_MA="$ma2"
  fi
}

stop_watch() {
  rm -f "$OUT/WATCH.alive"
  if [ -n "${WD_PID:-}" ] && kill -0 "$WD_PID" 2>/dev/null; then
    kill "$WD_PID" 2>/dev/null || true
    wait "$WD_PID" 2>/dev/null || true
  fi
  WD_PID=""
}

start_watch() {
  local cell_pid_file="$1"
  stop_watch || true
  : > "$OUT/WATCH.alive"
  : > "$WD_FLAG"
  echo "ts,plugged,batt,temp,memfree_kb,memavail_kb,event" > "$OUT/watchdog.csv"
  (
    streak=0
    lmkd_streak=0
    plug_streak=0
    bad_streak=0
    while [ -f "$OUT/WATCH.alive" ]; do
      bj=$(batt_json)
      read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
      mf=$(memfree_kb)
      ma=$(memavail_kb)
      ev="ok"
      if [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ]; then
        bad_streak=$((bad_streak + 1))
        ev="batt_unreadable"
        if [ "$bad_streak" -ge 2 ]; then
          echo "BLOCKED_BATT battery JSON fail x2 ($plug)" > "$WD_FLAG"
          echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
          if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
          rm -f "$OUT/WATCH.alive"
          exit 0
        fi
      else
        bad_streak=0
      fi
      if echo "$plug" | grep -qi UNPLUGGED; then
        plug_streak=0
      elif [ "$plug" != "MISSING" ] && [ "$plug" != "BADJSON" ] && [ -n "$plug" ] && [ "$plug" != "?" ]; then
        plug_streak=$((plug_streak + 1))
        ev="plugged"
        if [ "$plug_streak" -ge 2 ]; then
          echo "BLOCKED_PLUGGED plugged=$plug" > "$WD_FLAG"
          echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
          if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
          rm -f "$OUT/WATCH.alive"
          exit 0
        fi
      fi
      if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null && [ "$pct" -gt 0 ] 2>/dev/null; then
        ev="batt_low"
        echo "BLOCKED_BATT batt=$pct" > "$WD_FLAG"
        echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
        if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
        rm -f "$OUT/WATCH.alive"
        exit 0
      fi
      if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$temp" "$TEMP_CEIL" 2>/dev/null; then
        ev="thermal"
        echo "BLOCKED_THERMAL temp=$temp" > "$WD_FLAG"
        echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
        if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
        rm -f "$OUT/WATCH.alive"
        exit 0
      fi
      if [ -n "$ma" ] && [ "$ma" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
        streak=$((streak + 1))
        ev="memavail_low_$streak"
        if [ "$streak" -ge 3 ]; then
          ev="memavail_sustained"
          echo "BLOCKED_MEM MemAvail_kB=$ma x3 < $MEMAVAIL_ABORT_KB" > "$WD_FLAG"
          echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
          if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
          rm -f "$OUT/WATCH.alive"
          exit 0
        fi
      else
        streak=0
      fi
      if [ -n "$mf" ] && [ "$mf" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
        lmkd_streak=$((lmkd_streak + 1))
        ev="lmkd_$lmkd_streak"
        if [ "$lmkd_streak" -ge 3 ]; then
          ev="lmkd_sustained"
          echo "BLOCKED_MEM MemFree_kB=$mf LMKD x3 < $MEMFREE_LMKD_KB" > "$WD_FLAG"
          echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
          if [ -f "$cell_pid_file" ]; then kill "$(cat "$cell_pid_file")" 2>/dev/null || true; fi
          rm -f "$OUT/WATCH.alive"
          exit 0
        fi
      else
        lmkd_streak=0
      fi
      echo "$(ts),$plug,$pct,$temp,$mf,$ma,$ev" >> "$OUT/watchdog.csv"
      sleep "$WATCH_SLEEP_S"
    done
  ) &
  WD_PID=$!
}

between_cells() {
  local tag="$1"
  wait_idle
  check_reboot
  guardrail "$tag"
}

cold_optional() {
  local note="cold=skip"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    if "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1; then
      note="cold=fadv"
    else
      note="cold=fadv_fail"
    fi
  elif [ -x "$HOME/bin/fadv" ]; then
    if "$HOME/bin/fadv" --dontneed "$MODEL" >>"$MASTER" 2>&1; then
      note="cold=fadv"
    else
      note="cold=fadv_fail"
    fi
  fi
  log "A $note (optional; not a hard fail)"
  echo "$note" > "$OUT/A/cold.txt"
}

extract_gen() {
  # One-shot without --progress prints the prompt then the pieces. Cell A uses
  # --progress (=== answer ===). Cell B does not. Comparing those raw files
  # would always "diverge" at byte 0.
  python3 -c '
import sys
from pathlib import Path
src = Path(sys.argv[1])
dest = Path(sys.argv[2])
prompt = ""
if len(sys.argv) > 3 and sys.argv[3]:
    pp = Path(sys.argv[3])
    if pp.is_file():
        prompt = pp.read_text(encoding="utf-8", errors="replace")
text = src.read_text(encoding="utf-8", errors="replace")
method = "empty"
body = ""
if "=== answer ===" in text:
    body = text.split("=== answer ===", 1)[1]
    if "=== perf ===" in body:
        body = body.split("=== perf ===", 1)[0]
    body = body.lstrip("\n").rstrip()
    method = "answer_block"
else:
    lines = text.splitlines()
    cut = len(lines)
    for i, line in enumerate(lines):
        if line.startswith("generation:") or line.startswith("=== perf ===") or line.startswith("BMOE_"):
            cut = i
            break
    body = "\n".join(lines[:cut])
    method = "head_cut"
    if prompt:
        for cand in (prompt, prompt.rstrip("\n")):
            if cand and body.startswith(cand):
                body = body[len(cand):]
                if body.startswith("\n") and not cand.endswith("\n"):
                    body = body[1:]
                method = "prompt_stripped"
                break
    body = body.lstrip("\n").rstrip()
dest.write_text(body + ("\n" if body else ""), encoding="utf-8")
dest.with_name("gen_meta.txt").write_text(
    "method=%s\nbytes=%d\n" % (method, len(body.encode("utf-8"))),
    encoding="utf-8",
)
' "$1" "$2" "${3:-}"
}

parse_oneshot() {
  python3 -c '
import json, re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
n_gen = tok_s = n_prompt = n_past = drafted = accepted = steps = ""
m = re.search(r"generation:\s*(\d+)\s+tokens,.*?(\d+(?:\.\d+)?)\s*tok/s", text)
if m:
    n_gen, tok_s = m.group(1), m.group(2)
m = re.search(r"prefill:\s*(\d+)\s+tokens", text)
if m:
    n_prompt = m.group(1)
for src in ("ngram", "mtp"):
    m = re.search(rf"{src}:\s*(\d+)/(\d+)\s+drafts accepted", text)
    if m:
        accepted, drafted = m.group(1), m.group(2)
m = re.search(r"ngram:\s*drafted on\s+(\d+)\s+of\s+(\d+)\s+steps", text)
if m:
    steps = m.group(1)
for line in text.splitlines():
    if "BMOE_DONE" not in line:
        continue
    i = line.find("{")
    if i < 0:
        continue
    try:
        obj = json.loads(line[i:])
    except Exception:
        continue
    if obj.get("tokens") is not None:
        n_gen = str(obj["tokens"])
    if obj.get("tok_s") is not None:
        tok_s = str(obj["tok_s"])
    if obj.get("n_prompt") is not None:
        n_prompt = str(obj["n_prompt"])
    if obj.get("n_past") is not None:
        n_past = str(obj["n_past"])
    if obj.get("mtp_drafted") is not None:
        drafted = str(obj["mtp_drafted"])
    if obj.get("mtp_accepted") is not None:
        accepted = str(obj["mtp_accepted"])
    if obj.get("drafted_steps") is not None:
        steps = str(obj["drafted_steps"])
print("|".join([n_gen, tok_s, n_prompt, n_past, drafted, accepted, steps]))
' "$1"
}

record_cell() {
  local cell="$1" rc="$2" wall="$3" combo="$4" notes="$5"
  local n_gen tok_s n_prompt n_past drafted accepted steps
  n_gen=""; tok_s=""; n_prompt=""; n_past=""; drafted=""; accepted=""; steps=""
  if [ -f "$combo" ]; then
    IFS='|' read -r n_gen tok_s n_prompt n_past drafted accepted steps <<EOF
$(parse_oneshot "$combo")
EOF
  fi
  echo "${cell},${rc},${wall},${n_gen},${tok_s},${n_prompt},${n_past},${drafted},${accepted},${steps},${LAST_PCT},${LAST_PLUG},${LAST_TEMP},${LAST_MF},${LAST_MA},${notes}" >> "$CSV"
  log "CELL $cell rc=$rc wall=${wall}s n_gen=$n_gen tok_s=$tok_s n_prompt=$n_prompt n_past=$n_past drafted=$drafted accepted=$accepted steps=$steps notes=$notes"
}

run_oneshot() {
  local cell="$1" timeout_s="$2"
  shift 2
  local celldir="$OUT/$cell"
  local stdout="$celldir/stdout.txt"
  local stderr="$celldir/stderr.txt"
  local combo="$celldir/combo.txt"
  local pidfile="$celldir/cell.pid"
  local rcfile="$celldir/rc.txt"
  local t0 t1 wall rc
  mkdir -p "$celldir"
  : > "$stdout"
  : > "$stderr"
  {
    echo "date=$(ts)"
    echo "BIN=$BIN"
    echo "MODEL=$MODEL"
    printf 'cmd='
    printf '%q ' "$BIN" "$@"
    echo
  } > "$celldir/cmd.txt"
  check_reboot
  if [ -s "$WD_FLAG" ]; then
    fail "$(awk '{print $1}' "$WD_FLAG")" "watchdog before $cell: $(cat "$WD_FLAG")"
  fi
  log "RUN $cell timeout=${timeout_s}s"
  t0=$(date +%s)
  set +e
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM --kill-after=20 "$timeout_s" "$BIN" "$@" >"$stdout" 2>"$stderr" &
  else
    "$BIN" "$@" >"$stdout" 2>"$stderr" &
  fi
  CELL_PID=$!
  echo "$CELL_PID" > "$pidfile"
  echo "$CELL_PID" > "$OUT/current.pid"
  wait "$CELL_PID"
  rc=$?
  set -e
  CELL_PID=""
  t1=$(date +%s)
  wall=$((t1 - t0))
  echo "$rc" > "$rcfile"
  echo "$wall" > "$celldir/wall.txt"
  cat "$stdout" "$stderr" > "$combo" 2>/dev/null || true
  if [ -s "$WD_FLAG" ]; then
    fail "$(awk '{print $1}' "$WD_FLAG")" "watchdog during $cell: $(cat "$WD_FLAG")"
  fi
  LAST_RC="$rc"
  LAST_WALL="$wall"
}

# --- preflight ---
if [ ! -x "$BIN" ]; then
  fail "BLOCKED_BIN" "missing or not executable: $BIN"
fi
case "$BIN" in
  *llama-cli*) fail "FAIL_BIN" "llama-cli is forbidden on the 13GB GGUF" ;;
esac
if [ ! -f "$MODEL" ]; then
  fail "BLOCKED_MODEL" "missing model: $MODEL"
fi
case "$MODEL" in
  *Qwen3.6-35B-A3B-KEXP.gguf) ;;
  *) fail "FAIL_MODEL" "expected Qwen3.6-35B-A3B-KEXP.gguf got $MODEL" ;;
esac
if [ ! -f "$PROMPT" ]; then
  fail "BLOCKED_PROMPT" "missing prompt: $PROMPT"
fi
if ! command -v python3 >/dev/null 2>&1; then
  fail "BLOCKED_PY" "python3 required"
fi
if ! command -v termux-battery-status >/dev/null 2>&1; then
  fail "BLOCKED_BATT" "termux-battery-status not on PATH"
fi

got=$(sha256sum "$BIN" | awk '{print $1}')
log "BIN_SHA=$got path=$BIN"
case "$got" in
  ${PIN_PREFIX}*) log "PIN OK" ;;
  *) fail "FAIL_PIN" "expected ${PIN_PREFIX}* got $got" ;;
esac
msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize expect=$MODEL_SIZE_EXPECT"
if [ "$msize" != "$MODEL_SIZE_EXPECT" ]; then
  fail "FAIL_MODEL" "KEXP size $msize != $MODEL_SIZE_EXPECT"
fi
if [ -f "$HERE/p_fact.txt" ] && [ "$PROMPT" != "$HERE/p_fact.txt" ]; then
  cp -f "$HERE/p_fact.txt" "$OUT/p_fact.txt" 2>/dev/null || true
elif [ "$PROMPT" != "$OUT/p_fact.txt" ]; then
  cp -f "$PROMPT" "$OUT/p_fact.txt"
fi
log "PROMPT=$PROMPT sha=$(sha256sum "$PROMPT" | awk '{print $1}') bytes=$(wc -c < "$PROMPT")"

prop=$(getprop ro.product.model 2>/dev/null || true)
log "device_model=${prop:-unknown}"
if [ -n "$prop" ]; then
  case "$prop" in
    SM-S911*) ;;
    *) fail "BLOCKED_DEVICE" "S23 only (SM-S911*), got $prop" ;;
  esac
fi

echo "$(boot_id)" > "$BOOT_FILE"
log "boot_id=$(cat "$BOOT_FILE")"
log "floors MemAvail=${MEMAVAIL_ABORT_KB}kB MemFree_LMKD=${MEMFREE_LMKD_KB}kB (MemFree<300000 is NOT an abort)"

PTEXT=$(cat "$PROMPT")
if [ -z "$PTEXT" ]; then
  fail "BLOCKED_PROMPT" "prompt empty"
fi

BASE=( -m "$MODEL" -t 4 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000
  --dense-weights anon --overlap --io-threads 4 --drop-cold-experts 0.65 --temp 0 --no-think )

wait_idle
guardrail "preflight"
: > "$OUT/current.pid"
start_watch "$OUT/current.pid"

# ===== A: IDEA1 peakiness k=6 + route-trace =====
between_cells "pre_A"
cold_optional
run_oneshot A "$CELL_TIMEOUT_S" "${BASE[@]}" -p "$PTEXT" -n 40 --n-expert-used 6 \
  --route-trace "$OUT/A/route_k6.csv" --progress --csv "$OUT/A/metrics_k6.csv"
RC_A=$(cat "$OUT/A/rc.txt")
WALL_A=$(cat "$OUT/A/wall.txt")
extract_gen "$OUT/A/stdout.txt" "$OUT/A/gen.txt" "$PROMPT"
record_cell A "$RC_A" "$WALL_A" "$OUT/A/combo.txt" "route_k6"
if [ ! -f "$OUT/A/route_k6.csv" ]; then
  log "WARN A route_k6.csv missing rc=$RC_A"
fi

# ===== B: IDEA1 free-run k=1 (no route-trace, no --progress) =====
between_cells "pre_B"
run_oneshot B "$CELL_TIMEOUT_S" "${BASE[@]}" -p "$PTEXT" -n 40 --n-expert-used 1
RC_B=$(cat "$OUT/B/rc.txt")
WALL_B=$(cat "$OUT/B/wall.txt")
extract_gen "$OUT/B/stdout.txt" "$OUT/B/gen.txt" "$PROMPT"
python3 -c '
from pathlib import Path
a = Path("'"$OUT"'/A/gen.txt")
b = Path("'"$OUT"'/B/gen.txt")
ta = a.read_text(encoding="utf-8", errors="replace") if a.is_file() else ""
tb = b.read_text(encoding="utf-8", errors="replace") if b.is_file() else ""
ba, bb = ta.encode("utf-8"), tb.encode("utf-8")
n = 0
for ca, cb in zip(ba, bb):
    if ca != cb:
        break
    n += 1
else:
    n = min(len(ba), len(bb))
if ba == bb and ba:
    n = len(ba)
nc = 0
for ca, cb in zip(ta, tb):
    if ca != cb:
        break
    nc += 1
else:
    nc = min(len(ta), len(tb))
if ta == tb and ta:
    nc = len(ta)
note = "EQUAL" if ta == tb and ta else ("PREFIX_%d" % n)
def snippet(s, i, span=40):
    if not s:
        return ""
    lo = max(0, i - 8)
    hi = min(len(s), i + span)
    return s[lo:hi].replace("\n", "\\n")
lines = [
    "a_bytes=%d" % len(ba),
    "b_bytes=%d" % len(bb),
    "a_chars=%d" % len(ta),
    "b_chars=%d" % len(tb),
    "common_prefix_bytes=%d" % n,
    "common_prefix_chars=%d" % nc,
    "verdict=%s" % note,
    "first_div_byte=%s" % ("-" if ta == tb else str(n)),
    "first_div_char=%s" % ("-" if ta == tb else str(nc)),
    "a_at_div=%s" % ("-" if ta == tb else snippet(ta, nc)),
    "b_at_div=%s" % ("-" if ta == tb else snippet(tb, nc)),
    "",
]
Path("'"$OUT"'/B/prefix_vs_A.txt").write_text("\n".join(lines), encoding="utf-8")
print(note, "common_prefix_bytes", n, "common_prefix_chars", nc)
' | tee -a "$MASTER"
PREF_NOTE=$(awk -F= '/^verdict=/{print $2}' "$OUT/B/prefix_vs_A.txt" 2>/dev/null || echo prefix)
record_cell B "${RC_B:-1}" "${WALL_B:-0}" "$OUT/B/combo.txt" "$PREF_NOTE"

# ===== C: IDEA2 ngram short confirm (F5.2-C3 drafted 0/128 on IT prose) =====
between_cells "pre_C"
run_oneshot C "$CELL_TIMEOUT_S" "${BASE[@]}" -p "$PTEXT" -n 32 --n-expert-used 6 \
  --ngram --draft 4 --progress
RC_C=$(cat "$OUT/C/rc.txt")
WALL_C=$(cat "$OUT/C/wall.txt")
extract_gen "$OUT/C/stdout.txt" "$OUT/C/gen.txt" "$PROMPT"
grep -E '^(ngram:|mtp:)|drafted|accepted' "$OUT/C/combo.txt" > "$OUT/C/ngram_lines.txt" 2>/dev/null || true
record_cell C "${RC_C:-1}" "${WALL_C:-0}" "$OUT/C/combo.txt" "ngram_draft4"
log "C ngram lines:"
cat "$OUT/C/ngram_lines.txt" >> "$MASTER" 2>/dev/null || true

# ===== D: IDEA2 MTP smoke KEXP only. Fail-fast if no nextn. Do not retry. =====
between_cells "pre_D"
run_oneshot D "$MTP_TIMEOUT_S" "${BASE[@]}" -p "$PTEXT" -n 8 --n-expert-used 6 --mtp --draft 3
RC_D=$(cat "$OUT/D/rc.txt")
WALL_D=$(cat "$OUT/D/wall.txt")
grep -E 'nextn|mtp:|error:|--mtp' "$OUT/D/stderr.txt" > "$OUT/D/mtp_stderr_hits.txt" 2>/dev/null || true
if grep -q 'no nextn' "$OUT/D/stderr.txt" 2>/dev/null || grep -q 'no nextn' "$OUT/D/combo.txt" 2>/dev/null; then
  DNOTE="failfast_no_nextn"
elif [ "${RC_D:-1}" -eq 0 ]; then
  DNOTE="mtp_ran"
else
  DNOTE="mtp_rc${RC_D:-1}"
fi
echo "$DNOTE" > "$OUT/D/mtp_note.txt"
log "D $DNOTE (no retry)"
cat "$OUT/D/mtp_stderr_hits.txt" >> "$MASTER" 2>/dev/null || true
record_cell D "${RC_D:-1}" "${WALL_D:-0}" "$OUT/D/combo.txt" "$DNOTE"

# ===== E: IDEA3 --session two JSON gens, then --help save/load/cache =====
between_cells "pre_E"
python3 -c '
import json, sys
from pathlib import Path
prompt = Path(sys.argv[1]).read_text(encoding="utf-8")
second = sys.argv[2]
prompt2 = prompt.rstrip("\n") + "\nUser: " + second + "\nAssistant:\n"
out = Path(sys.argv[3])
t1 = {"cmd": "generate", "id": 1, "prompt": prompt, "n_predict": 16, "think": False, "clear_kv": True}
t2 = {"cmd": "generate", "id": 2, "prompt": prompt2, "n_predict": 16, "think": False, "clear_kv": False}
(out / "t1.json").write_text(json.dumps(t1, ensure_ascii=True) + "\n", encoding="utf-8")
(out / "t2.json").write_text(json.dumps(t2, ensure_ascii=True) + "\n", encoding="utf-8")
(out / "second_user.txt").write_text(second + "\n", encoding="utf-8")
with (out / "in.jsonl").open("w", encoding="utf-8") as f:
    f.write(json.dumps(t1, ensure_ascii=True) + "\n")
    f.write(json.dumps(t2, ensure_ascii=True) + "\n")
    f.write(json.dumps({"cmd": "close"}) + "\n")
' "$PROMPT" "$SECOND_USER" "$OUT/E"

{
  echo "date=$(ts)"
  echo "BIN=$BIN"
  printf 'cmd='
  printf '%q ' "$BIN" "${BASE[@]}" --n-expert-used 6 --session --progress
  echo
  echo "stdin=$OUT/E/in.jsonl"
} > "$OUT/E/cmd.txt"
check_reboot
log "RUN E timeout=${CELL_TIMEOUT_S}s stdin=in.jsonl"
t0=$(date +%s)
set +e
if command -v timeout >/dev/null 2>&1; then
  timeout --signal=TERM --kill-after=20 "$CELL_TIMEOUT_S" \
    "$BIN" "${BASE[@]}" --n-expert-used 6 --session --progress \
    < "$OUT/E/in.jsonl" > "$OUT/E/stdout.txt" 2> "$OUT/E/stderr.txt" &
else
  "$BIN" "${BASE[@]}" --n-expert-used 6 --session --progress \
    < "$OUT/E/in.jsonl" > "$OUT/E/stdout.txt" 2> "$OUT/E/stderr.txt" &
fi
CELL_PID=$!
echo "$CELL_PID" > "$OUT/E/cell.pid"
echo "$CELL_PID" > "$OUT/current.pid"
wait "$CELL_PID"
RC_E=$?
set -e
CELL_PID=""
t1=$(date +%s)
WALL_E=$((t1 - t0))
echo "$RC_E" > "$OUT/E/rc.txt"
echo "$WALL_E" > "$OUT/E/wall.txt"
cat "$OUT/E/stdout.txt" "$OUT/E/stderr.txt" > "$OUT/E/combo.txt" 2>/dev/null || true
if [ -s "$WD_FLAG" ]; then
  fail "$(awk '{print $1}' "$WD_FLAG")" "watchdog during E: $(cat "$WD_FLAG")"
fi

python3 -c '
import json, re, sys
from pathlib import Path
combo = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
dones = []
for line in combo.splitlines():
    if "BMOE_DONE" not in line:
        continue
    i = line.find("{")
    if i < 0:
        continue
    try:
        obj = json.loads(line[i:])
    except Exception:
        continue
    dones.append({
        "id": obj.get("id"),
        "n_prompt": obj.get("n_prompt"),
        "n_past": obj.get("n_past"),
        "n_common": obj.get("n_common"),
        "tokens": obj.get("tokens"),
        "tok_s": obj.get("tok_s"),
        "prefill_s": obj.get("prefill_s"),
        "text": obj.get("text"),
    })
grep_hits = re.findall(r"n_common[=: ]+(\d+)", combo)
out = {
    "bmoe_done_count": len(dones),
    "turns": dones,
    "n_common_in_schema": any(d.get("n_common") is not None for d in dones),
    "n_common_grep": [int(x) for x in grep_hits],
    "note": "CAMPAIGN BMOE_DONE emits n_prompt and n_past; n_common is engine-internal and may be absent",
}
Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print("E BMOE_DONE", len(dones), "n_common_in_schema", out["n_common_in_schema"], "grep", out["n_common_grep"])
' "$OUT/E/combo.txt" "$OUT/E/kv_fields.json" | tee -a "$MASTER"
record_cell E "${RC_E:-1}" "${WALL_E:-0}" "$OUT/E/combo.txt" "session_two_turn"

log "E grep binary --help for save/load/cache (no llama-cli)"
set +e
"$BIN" --help > "$OUT/E/help.txt" 2>&1
HELP_RC=$?
set -e
echo "$HELP_RC" > "$OUT/E/help.rc"
grep -niE 'save|load|cache' "$OUT/E/help.txt" > "$OUT/E/help_save_load_cache.txt" || true
log "E help_rc=$HELP_RC save/load/cache hits=$(wc -l < "$OUT/E/help_save_load_cache.txt")"
if grep -qiE -- '--save|--load-session|--save-session|--load-kv|--save-kv' "$OUT/E/help.txt"; then
  log "E help HAS explicit save/load session flag"
else
  log "E help has no --save/--load session flag (cache-* is the expert LRU, not KV persist)"
fi

stop_watch || true
snapshot "end"
check_reboot
echo "DONE" > "$STATUS"
log "DONE A_rc=${RC_A:-?} B_rc=${RC_B:-?} C_rc=${RC_C:-?} D_rc=${RC_D:-?} DNOTE=${DNOTE:-} E_rc=${RC_E:-?}"
exit 0
