#!/data/data/com.termux/files/usr/bin/bash
# run_typeahead.sh — S23 ONLY. Growing-prefix KV typeahead vs full re-prefill.
# Binary: bmoe-cli.CAMPAIGN  Model: Qwen3.6-35B-A3B-KEXP.gguf
# Speed only UNPLUGGED. Abort if batt<45, temp>45C, or MemAvailable<300 MiB sustained.
# MemFree 300 MiB is a false-positive on 35B cache-2000 (campaign memfree_min 13-52 MiB).
# n_predict=0: prefill-only so KV stays a prefix of the next growing prompt (no probe token / seq_rm).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

WS="${WS:-$HOME/gdn_k2/idle_ideas}"
OUTDIR="${OUTDIR:-$WS/typeahead}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

MEMAVAIL_ABORT_KB="${MEMAVAIL_ABORT_KB:-300000}"
MEMFREE_LMKD_KB="${MEMFREE_LMKD_KB:-50000}"
BATT_FLOOR="${BATT_FLOOR:-45}"
TEMP_CEIL="${TEMP_CEIL:-45}"
READY_TIMEOUT_S="${READY_TIMEOUT_S:-900}"
STEP_TIMEOUT_S="${STEP_TIMEOUT_S:-1800}"
BUSY_WAIT_S="${BUSY_WAIT_S:-3600}"
FIFO_OPEN_S="${FIFO_OPEN_S:-30}"
N_PREDICT="${N_PREDICT:-0}"

mkdir -p "$OUTDIR/prefixes" "$OUTDIR/batt" "$OUTDIR/mem"
MASTER="$OUTDIR/TYPEAHEAD.master.log"
STATUS="$OUTDIR/STATUS.txt"
CSV="$OUTDIR/steps.csv"
SUMMARY="$OUTDIR/summary.csv"
DONE_JL="$OUTDIR/done_lines.jsonl"
SESSION_LOG="$OUTDIR/session.stdout.log"
SESSION_ERR="$OUTDIR/session.stderr.log"
REQ_FIFO="$OUTDIR/req.fifo"
WD_FLAG="$OUTDIR/WATCHDOG.txt"
FIFO_OK="$OUTDIR/fifo_open.ok"
: > "$MASTER"
: > "$DONE_JL"
: > "$WD_FLAG"
rm -f "$FIFO_OK"
echo "RUNNING" > "$STATUS"
echo "step,id,label,clear_kv,prompt_bytes,prefill_s,tokens,tok_s,prefill_tps,n_prompt,n_past,load_s,cache_hit_pct,wall_s,batt_pct,plugged,temp_c,memfree_kb,memavail_kb,rc" > "$CSV"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

BMOE_PID=""
WD_PID=""
cleanup() {
  local ec=$?
  if [ -n "${WD_PID:-}" ]; then kill "$WD_PID" 2>/dev/null || true; wait "$WD_PID" 2>/dev/null || true; fi
  exec 3>&- 2>/dev/null || true
  if [ -n "${BMOE_PID:-}" ] && kill -0 "$BMOE_PID" 2>/dev/null; then
    kill -TERM "$BMOE_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$BMOE_PID" 2>/dev/null || true
    wait "$BMOE_PID" 2>/dev/null || true
  fi
  rm -f "$REQ_FIFO" "$FIFO_OK"
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

batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 termux-battery-status 2>/dev/null || echo ''
  else
    termux-battery-status 2>/dev/null || echo ''
  fi
}

batt_fields() {
  # stdin: battery JSON. stdout: plugged pct temp
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
  # Real infer only. Bracket-trick so this pgrep cmdline cannot match itself.
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
      fail "BLOCKED_BUSY" "bmoe-cli/llama-cli still running after ${BUSY_WAIT_S}s: $hits"
    fi
    log "WAIT other infer still running (${hits}); not killing"
    sleep 15
  done
}

# Returns 0 if safe. On abort, writes STATUS and returns non-zero.
# $1 = tag for logs. $2 = optional "nowait" to skip the 2s MemAvailable pair.
guardrail() {
  local tag="$1"
  local nowait="${2:-}"
  local bj plug pct temp mf ma mf2 ma2
  bj=$(batt_json)
  printf '%s\n' "$bj" > "$OUTDIR/batt/${tag}.json"
  read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
  mf=$(memfree_kb)
  ma=$(memavail_kb)
  echo "$mf $ma" > "$OUTDIR/mem/${tag}.kb"
  log "guard $tag plugged=$plug batt=$pct temp=$temp MemFree_kB=$mf MemAvail_kB=$ma"
  if [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ] || [ "$plug" = "?" ] || [ -z "$plug" ]; then
    fail "BLOCKED_BATT" "$tag cannot read termux-battery-status ($plug)"
  fi
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    fail "BLOCKED_PLUGGED" "$tag plugged=$plug"
  fi
  if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    fail "BLOCKED_BATT" "$tag batt=$pct < $BATT_FLOOR"
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$temp" "$TEMP_CEIL"; then
    fail "BLOCKED_THERMAL" "$tag temp=$temp > $TEMP_CEIL"
  fi
  if [ -z "$ma" ] || [ "$ma" -lt 1 ] 2>/dev/null; then
    fail "BLOCKED_MEM" "$tag MemAvailable unreadable"
  fi
  if [ "$ma" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null || [ "$mf" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
    if [ "$nowait" = "nowait" ]; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$mf MemAvail_kB=$ma"
    fi
    sleep 2
    mf2=$(memfree_kb)
    ma2=$(memavail_kb)
    echo "$mf2 $ma2" >> "$OUTDIR/mem/${tag}.kb"
    log "guard $tag mem pair free=$mf/$mf2 avail=$ma/$ma2"
    if [ "$ma2" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "$tag MemAvail_kB=$ma then $ma2 < $MEMAVAIL_ABORT_KB sustained"
    fi
    if [ "$mf2" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "$tag MemFree_kB=$mf then $mf2 < $MEMFREE_LMKD_KB LMKD"
    fi
  fi
  return 0
}

# chunk0 = marco_phase1/speed_s23/prompts/p_fact.txt (byte-stable copy)
CHUNK0=$(cat <<'EOF'
You are a helpful technical assistant. Answer clearly, in plain English, with one short paragraph and then two bullet points.

User: Explain what a Mixture-of-Experts language model is, and why activating only a few experts per token can reduce compute while still needing a large on-disk weight file on a phone. Mention routing and flash streaming.
Assistant:
EOF
)

# Extra English growth blocks. Each must be 400-600 ASCII bytes (asserted below).
GROW1=$(cat <<'EOF'
 Incremental typeahead reuses the KV cache for the already typed prefix and prefills only the newly appended characters. This paragraph is English filler with stable ASCII bytes so later reruns compare the same token counts. Mixture-of-experts routing still runs on every new token, and experts stream from flash when they are not resident in the two-gigabyte cache. Record prefill_s, n_prompt, tokens, and tok_s from BMOE_DONE after the single-token probe.
EOF
)
GROW2=$(cat <<'EOF'
 A phone-side session keeps the model loaded so the expensive mmap and expert warmup are paid once. Each JSON line is one generate request with n_predict set to one. When clear_kv is false the engine compares the new tokenized prompt with kv_tokens and should skip the common prefix. If n_prompt stays near the size of this appended block, incremental prefill is working. If n_prompt jumps to the full document length, the KV prefix did not match and the typeahead win is gone.
EOF
)
GROW3=$(cat <<'EOF'
 Context length is four thousand ninety six tokens with an ubatch of five hundred twelve. Four compute threads and four IO threads overlap expert reads with math. Drop-cold-experts at zero point six five with six experts used is the campaign default for this KEXP file. The dense weights stay in anonymous memory. This paragraph exists only to grow the prompt by about one hundred to one hundred fifty tokens of plain English.
EOF
)
GROW4=$(cat <<'EOF'
 Between steps the harness reads termux-battery-status and MemFree from proc meminfo. The run aborts if the charger is connected, if the battery is below forty five percent, or if free memory stays under three hundred mebibytes. Speed numbers collected while plugged are not valid for this campaign. Battery temperature should stay at or below forty five Celsius. These sentences are more ASCII ballast for the growing prefix.
EOF
)
GROW5=$(cat <<'EOF'
 The last control request sends this same full prompt again with clear_kv true so the KV is dropped and the whole document is prefilled from scratch. Compare that full prefill_s with the previous incremental step. A large gap means typeahead incremental prefill is worth wiring into the product. A tiny gap means the session still re-encodes the prefix and the idea is not ready. End of the baked growth text used by run_typeahead.sh.
EOF
)

assert_grow() {
  local name="$1" text="$2" n
  n=$(printf %s "$text" | wc -c)
  log "grow $name bytes=$n"
  if [ "$n" -lt 400 ] || [ "$n" -gt 600 ]; then
    fail "BLOCKED_PROMPT" "$name bytes=$n not in 400-600"
  fi
  if printf %s "$text" | grep -q '[^[:print:][:space:]]'; then
    fail "BLOCKED_PROMPT" "$name contains non-ASCII or non-print"
  fi
}

assert_grow GROW1 "$GROW1"
assert_grow GROW2 "$GROW2"
assert_grow GROW3 "$GROW3"
assert_grow GROW4 "$GROW4"
assert_grow GROW5 "$GROW5"

P0="$CHUNK0"
P1="${P0}${GROW1}"
P2="${P1}${GROW2}"
P3="${P2}${GROW3}"
P4="${P3}${GROW4}"
P5="${P4}${GROW5}"

printf %s "$P0" > "$OUTDIR/prefixes/step0_chunk0.txt"
printf %s "$P1" > "$OUTDIR/prefixes/step1_grow1.txt"
printf %s "$P2" > "$OUTDIR/prefixes/step2_grow2.txt"
printf %s "$P3" > "$OUTDIR/prefixes/step3_grow3.txt"
printf %s "$P4" > "$OUTDIR/prefixes/step4_grow4.txt"
printf %s "$P5" > "$OUTDIR/prefixes/step5_grow5.txt"
printf %s "$P5" > "$OUTDIR/prefixes/step6_control.txt"
sha256sum "$OUTDIR/prefixes/"*.txt | tee "$OUTDIR/prefixes/SHA256SUMS.txt" | tee -a "$MASTER"

if [ ! -x "$BIN" ]; then
  fail "BLOCKED_BIN" "missing or not executable: $BIN"
fi
if [ ! -f "$MODEL" ]; then
  fail "BLOCKED_MODEL" "missing model: $MODEL"
fi
if ! command -v python3 >/dev/null 2>&1; then
  fail "BLOCKED_PY" "python3 required to emit session JSON"
fi
if ! command -v termux-battery-status >/dev/null 2>&1; then
  fail "BLOCKED_BATT" "termux-battery-status not on PATH"
fi

log "BIN=$BIN sha=$(sha256sum "$BIN" | awk '{print $1}')"
log "MODEL=$MODEL size=$(stat -c%s "$MODEL" 2>/dev/null || echo '?')"
log "chunk0_bytes=$(printf %s "$P0" | wc -c) full_bytes=$(printf %s "$P5" | wc -c) n_predict=$N_PREDICT"
log "mem floors MemAvail=${MEMAVAIL_ABORT_KB}kB MemFree_LMKD=${MEMFREE_LMKD_KB}kB"

# Do not kill other jobs. Wait if a campaign CLI is already running.
wait_idle

guardrail "preflight"

FLAGS=( -m "$MODEL" -t 4 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 \
  --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 \
  --drop-cold-experts 0.65 --session --no-think --temp 0 )
{
  echo "date=$(ts)"
  echo "BIN=$BIN"
  echo "MODEL=$MODEL"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "N_PREDICT=$N_PREDICT"
  printf 'cmd='
  printf '%q ' "$BIN" "${FLAGS[@]}"
  echo
} > "$OUTDIR/cmdline.txt"

rm -f "$REQ_FIFO" "$FIFO_OK"
mkfifo "$REQ_FIFO"
: > "$SESSION_LOG"
: > "$SESSION_ERR"
"$BIN" "${FLAGS[@]}" < "$REQ_FIFO" > "$SESSION_LOG" 2> "$SESSION_ERR" &
BMOE_PID=$!
echo "$BMOE_PID" > "$OUTDIR/bmoe.pid"
log "bmoe pid=$BMOE_PID (fifo open next, timeout ${FIFO_OPEN_S}s)"

# Unblock exec 3> if bmoe dies or the open hangs: dummy reader on the fifo.
(
  n=0
  while [ "$n" -lt "$FIFO_OPEN_S" ]; do
    if [ -f "$FIFO_OK" ]; then exit 0; fi
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      timeout 1 cat "$REQ_FIFO" >/dev/null 2>&1 || true
      echo "BLOCKED_LOAD bmoe died before fifo open" > "$WD_FLAG"
      exit 0
    fi
    sleep 1
    n=$((n + 1))
  done
  if [ ! -f "$FIFO_OK" ]; then
    timeout 1 cat "$REQ_FIFO" >/dev/null 2>&1 || true
    echo "BLOCKED_LOAD fifo open timeout ${FIFO_OPEN_S}s" > "$WD_FLAG"
  fi
) &
exec 3>"$REQ_FIFO"
: > "$FIFO_OK"
if [ -s "$WD_FLAG" ]; then
  fail "$(awk '{print $1}' "$WD_FLAG")" "fifo: $(cat "$WD_FLAG")"
fi
if ! kill -0 "$BMOE_PID" 2>/dev/null; then
  tail -n 40 "$SESSION_ERR" >> "$MASTER" || true
  fail "BLOCKED_LOAD" "bmoe died during fifo open"
fi
log "fifo writer open"
echo "ts,memfree_kb,memavail_kb,plugged,batt_pct,temp_c" > "$OUTDIR/watchdog.csv"

# Watchdog: our process only. Abort if MemAvailable stays low, MemFree hits LMKD, charger, or heat.
(
  streak=0
  lmkd_streak=0
  plug_streak=0
  bad_streak=0
  while kill -0 "$BMOE_PID" 2>/dev/null; do
    mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
    ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
    if command -v timeout >/dev/null 2>&1; then
      bj=$(timeout 5 termux-battery-status 2>/dev/null || echo '')
    else
      bj=$(termux-battery-status 2>/dev/null || echo '')
    fi
    read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | python3 -c '
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
' 2>/dev/null || echo 'BADJSON 0 0')
EOF
    echo "$(date +%s),$mf,$ma,$plug,$pct,$temp" >> "$OUTDIR/watchdog.csv"
    if [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ] || [ "$plug" = "?" ] || [ -z "$plug" ]; then
      bad_streak=$((bad_streak + 1))
    else
      bad_streak=0
    fi
    if [ "$bad_streak" -ge 2 ]; then
      echo "BLOCKED_BATT battery JSON fail x2 ($plug)" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    if [ -n "$ma" ] && [ "$ma" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
      streak=$((streak + 1))
    else
      streak=0
    fi
    if [ "$streak" -ge 3 ]; then
      echo "BLOCKED_MEM MemAvail_kB=$ma x3" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    if [ -n "$mf" ] && [ "$mf" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
      lmkd_streak=$((lmkd_streak + 1))
    else
      lmkd_streak=0
    fi
    if [ "$lmkd_streak" -ge 3 ]; then
      echo "BLOCKED_MEM MemFree_kB=$mf LMKD x3" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    if echo "$plug" | grep -qi UNPLUGGED; then
      plug_streak=0
    elif [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ] || [ "$plug" = "?" ] || [ -z "$plug" ]; then
      :
    else
      plug_streak=$((plug_streak + 1))
    fi
    if [ "$plug_streak" -ge 2 ]; then
      echo "BLOCKED_PLUGGED plugged=$plug" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null && [ "$pct" -gt 0 ] 2>/dev/null; then
      echo "BLOCKED_BATT batt=$pct" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$temp" "$TEMP_CEIL" 2>/dev/null; then
      echo "BLOCKED_THERMAL temp=$temp" > "$WD_FLAG"
      kill -TERM "$BMOE_PID" 2>/dev/null || true
      exit 0
    fi
    sleep 2
  done
) &
WD_PID=$!

t0=$(date +%s)
while ! grep -q 'BMOE_READY' "$SESSION_LOG" 2>/dev/null; do
  if [ -s "$WD_FLAG" ]; then
    fail "$(awk '{print $1}' "$WD_FLAG")" "watchdog during load: $(cat "$WD_FLAG")"
  fi
  if ! kill -0 "$BMOE_PID" 2>/dev/null; then
    tail -n 40 "$SESSION_ERR" >> "$MASTER" || true
    fail "BLOCKED_LOAD" "bmoe died before BMOE_READY"
  fi
  now=$(date +%s)
  if [ $((now - t0)) -gt "$READY_TIMEOUT_S" ]; then
    fail "BLOCKED_READY" "no BMOE_READY in ${READY_TIMEOUT_S}s"
  fi
  if grep -q 'BMOE_ERROR' "$SESSION_LOG" 2>/dev/null; then
    grep BMOE_ERROR "$SESSION_LOG" | head -n 3 >> "$MASTER" || true
    fail "BLOCKED_LOAD" "BMOE_ERROR during load"
  fi
  sleep 1
done
log "READY $(grep BMOE_READY "$SESSION_LOG" | head -n 1)"

wait_done() {
  local id="$1" timeout_s="$2"
  local t0 now
  t0=$(date +%s)
  while :; do
    if [ -s "$WD_FLAG" ]; then
      echo "WATCHDOG"
      return 99
    fi
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      echo "DEAD"
      return 1
    fi
    if grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
      grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" | tail -n 1
      return 0
    fi
    if grep -E "BMOE_ERROR \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
      grep -E "BMOE_ERROR \{\"id\":${id}[,}]" "$SESSION_LOG" | tail -n 1
      echo "ERROR"
      return 2
    fi
    now=$(date +%s)
    if [ $((now - t0)) -gt "$timeout_s" ]; then
      echo "TIMEOUT"
      return 3
    fi
    sleep 0.5
  done
}

parse_done() {
  # stdin: BMOE_DONE line; stdout: 8 fields, one per line
  python3 -c '
import json, sys, re
line = sys.stdin.read().strip()
payload = line.split(" ", 1)[1].strip() if " " in line else line
obj = {}
try:
    obj = json.loads(payload)
except Exception:
    obj = {}
def grab(key):
    if key in obj and obj[key] is not None:
        return obj[key]
    m = re.search(r"\"%s\"\s*:\s*([0-9.]+)" % re.escape(key), line)
    return m.group(1) if m else ""
for k in ("prefill_s", "tokens", "tok_s", "prefill_tps", "n_prompt", "n_past", "load_s", "cache_hit_pct"):
    print(grab(k))
'
}

emit_req() {
  local id="$1" ck="$2" prompt="$3"
  printf %s "$prompt" | python3 -c '
import json, sys
body = sys.stdin.read()
obj = {
    "cmd": "generate",
    "id": int(sys.argv[1]),
    "prompt": body,
    "n_predict": int(sys.argv[3]),
    "think": False,
    "clear_kv": sys.argv[2] == "true",
}
sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\n")
' "$id" "$ck" "$N_PREDICT"
}

run_step() {
  local step="$1" id="$2" label="$3" ck="$4" prompt="$5"
  local pbytes wall0 wall1 wall done_line rc
  local prefill_s tokens tok_s prefill_tps n_prompt n_past load_s hit
  local bj plug pct temp mf ma

  guardrail "pre_step${step}_${label}"

  pbytes=$(printf %s "$prompt" | wc -c)
  log "STEP $step id=$id label=$label clear_kv=$ck prompt_bytes=$pbytes n_predict=$N_PREDICT"
  wall0=$(python3 -c 'import time; print("%.3f" % time.time())')
  emit_req "$id" "$ck" "$prompt" >&3

  set +e
  done_line=$(wait_done "$id" "$STEP_TIMEOUT_S")
  rc=$?
  set -e
  wall1=$(python3 -c 'import time; print("%.3f" % time.time())')
  wall=$(python3 -c "print('%.3f' % (float('$wall1')-float('$wall0')))")

  if [ -s "$WD_FLAG" ]; then
    fail "$(awk '{print $1}' "$WD_FLAG")" "watchdog at step $step: $(cat "$WD_FLAG")"
  fi

  prefill_s=""; tokens=""; tok_s=""; prefill_tps=""; n_prompt=""; n_past=""; load_s=""; hit=""
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$done_line" >> "$DONE_JL"
    {
      read -r prefill_s
      read -r tokens
      read -r tok_s
      read -r prefill_tps
      read -r n_prompt
      read -r n_past
      read -r load_s
      read -r hit
    } <<EOF
$(printf '%s\n' "$done_line" | parse_done)
EOF
    log "DONE step=$step label=$label prefill_s=$prefill_s tokens=$tokens tok_s=$tok_s n_prompt=$n_prompt n_past=$n_past prefill_tps=$prefill_tps wall_s=$wall"
  else
    log "FAIL step=$step label=$label rc=$rc line=$done_line"
    tail -n 20 "$SESSION_ERR" >> "$MASTER" || true
  fi

  bj=$(batt_json)
  printf '%s\n' "$bj" > "$OUTDIR/batt/post_step${step}_${label}.json"
  read -r plug pct temp <<EOF
$(printf '%s\n' "$bj" | batt_fields)
EOF
  mf=$(memfree_kb)
  ma=$(memavail_kb)
  echo "$mf $ma" > "$OUTDIR/mem/post_step${step}_${label}.kb"
  log "post $label plugged=$plug batt=$pct temp=$temp MemFree_kB=$mf MemAvail_kB=$ma"

  echo "$step,$id,$label,$ck,$pbytes,$prefill_s,$tokens,$tok_s,$prefill_tps,$n_prompt,$n_past,$load_s,$hit,$wall,$pct,$plug,$temp,$mf,$ma,$rc" >> "$CSV"

  if [ "$rc" -ne 0 ]; then
    fail "BLOCKED_STEP${step}" "label=$label wait_rc=$rc"
  fi
  if [ "$plug" = "MISSING" ] || [ "$plug" = "BADJSON" ] || [ "$plug" = "?" ] || [ -z "$plug" ]; then
    fail "BLOCKED_BATT" "after $label cannot read battery ($plug)"
  fi
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    fail "BLOCKED_PLUGGED" "after $label plugged=$plug"
  fi
  if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    fail "BLOCKED_BATT" "after $label batt=$pct"
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "$temp" "$TEMP_CEIL"; then
    fail "BLOCKED_THERMAL" "after $label temp=$temp > $TEMP_CEIL"
  fi
  if [ -z "$ma" ] || [ "$ma" -lt 1 ] 2>/dev/null; then
    fail "BLOCKED_MEM" "after $label MemAvailable unreadable"
  fi
  if [ "$ma" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
    sleep 2
    ma=$(memavail_kb)
    if [ "$ma" -lt "$MEMAVAIL_ABORT_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "after $label MemAvail_kB=$ma"
    fi
  fi
  if [ "$mf" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
    sleep 2
    mf=$(memfree_kb)
    if [ "$mf" -lt "$MEMFREE_LMKD_KB" ] 2>/dev/null; then
      fail "BLOCKED_MEM" "after $label MemFree_kB=$mf LMKD"
    fi
  fi
}

run_step 0 1 chunk0 true "$P0"
run_step 1 2 grow1 false "$P1"
run_step 2 3 grow2 false "$P2"
run_step 3 4 grow3 false "$P3"
run_step 4 5 grow4 false "$P4"
run_step 5 6 grow5 false "$P5"
run_step 6 7 control true "$P5"

printf '%s\n' '{"cmd":"close"}' >&3 || true
sleep 2
exec 3>&- || true
if [ -n "${WD_PID:-}" ]; then kill "$WD_PID" 2>/dev/null || true; wait "$WD_PID" 2>/dev/null || true; WD_PID=""; fi
if kill -0 "$BMOE_PID" 2>/dev/null; then
  sleep 3
  kill -TERM "$BMOE_PID" 2>/dev/null || true
  sleep 2
  kill -KILL "$BMOE_PID" 2>/dev/null || true
fi
wait "$BMOE_PID" 2>/dev/null || true
BMOE_PID=""

python3 -c '
import csv, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, newline="") as f:
    rows = list(csv.DictReader(f))
with open(dst, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["step", "prompt_chars", "clear_kv", "prefill_s", "decode_tok", "memfree", "batt", "temp"])
    for r in rows:
        w.writerow([
            r.get("step", ""),
            r.get("prompt_bytes", ""),
            r.get("clear_kv", ""),
            r.get("prefill_s", ""),
            r.get("tokens", ""),
            r.get("memfree_kb", ""),
            r.get("batt_pct", ""),
            r.get("temp_c", ""),
        ])
' "$CSV" "$SUMMARY"

echo "TYPEAHEAD_DONE" > "$STATUS"
log "TYPEAHEAD_DONE csv=$CSV summary=$SUMMARY"
exit 0
