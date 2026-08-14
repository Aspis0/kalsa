#!/data/data/com.termux/files/usr/bin/bash
# KERNEL S2 S23 harness — correctness then gate cells.
# Bins live in ~/bin/kernel_s2/. Campaign pin is never written.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH"

ROOT="$HOME/experiments/results/kernel_s2"
BIN="$HOME/bin/kernel_s2"
MODEL="$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
BMOE="$HOME/bin/bmoe-cli-kernel-s2"
OPS="$BIN/test-backend-ops"
PFACT="$ROOT/p_fact.txt"
CSV="$ROOT/runs.csv"
STATUS="$ROOT/STATUS.txt"
MASTER="$ROOT/master.log"
PIN_CAMPAIGN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
PIN_EXPECT="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"
FLOOR_BATT=45
ABORT_TEMP=43
S1_N32_PREFIX='A Mixture-of-Experts (MoE) language model is a type of neural network that splits the model into many specialized “expert” sub‑'

mkdir -p "$ROOT/s23" "$ROOT/logs"
cd "$ROOT"

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }
set_status() { echo "$*" | tee "$STATUS"; }

hash_pin() {
  sha256sum "$PIN_CAMPAIGN" 2>/dev/null | awk '{print $1}'
}

batt_json() {
  termux-battery-status 2>/dev/null || echo '{}'
}

batt_pct() {
  termux-battery-status 2>/dev/null | tr -d '\r' | awk -F'[:,]' '/"percentage"/ {gsub(/ /,"",$2); print $2; exit}'
}

batt_temp() {
  termux-battery-status 2>/dev/null | tr -d '\r' | awk -F'[:,]' '/"temperature"/ {gsub(/ /,"",$2); print $2; exit}'
}

batt_plug() {
  termux-battery-status 2>/dev/null | tr -d '\r' | awk -F'[:,]' '/"plugged"/ {gsub(/[" ]/,"",$2); print $2; exit}'
}

screen_state() {
  dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | sed 's/.*mWakefulness=//' | tr -d ' \r' || echo 'UNKNOWN'
}

mem_avail() {
  awk '/MemAvailable:/ {printf "%.1f", $2/1024; exit}' /proc/meminfo
}

abort_if_hot_or_empty() {
  local t p
  t="$(batt_temp)"
  p="$(batt_pct)"
  t="${t:-0}"
  p="${p:-0}"
  if awk "BEGIN{exit !($t >= $ABORT_TEMP)}"; then
    log "ABORT_TEMP t=$t C"
    set_status "ABORT_TEMP $t"
    exit 3
  fi
  if awk "BEGIN{exit !($p < $FLOOR_BATT)}"; then
    log "FLOOR_BATTERY p=$p"
    set_status "PENDING_BATTERY $p"
    exit 4
  fi
}

extract_gen() {
  # stdout: prompt+generation, blank, then "generation:" metrics
  sed '/^generation:/,$d' "$1" | sed 's/^.*Assistant://'
}

parse_metrics() {
  local f="$1"
  DECODE_TOKS="$(sed -n 's/^generation:.*(\([0-9.]*\) tok\/s).*/\1/p' "$f" | head -1)"
  COMPUTE="$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$f" | head -1)"
  FLASH="$(sed -n 's/.*flash I\/O \([0-9.]*\) s\/token.*/\1/p' "$f" | head -1)"
  MIB="$(sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' "$f" | head -1)"
  HIT="$(sed -n 's/moe-cache: \([0-9.]*\)% hit.*/\1/p' "$f" | head -1)"
}

csv_header() {
  if [ ! -f "$CSV" ]; then
    echo "run_id,date,phase,model,cell,fused,threads,k,drop,n_gen,run_type,decode_toks,compute_s_tok,flash_s_tok,mib_tok,hit_pct,vmrss_peak_mb,batt_pct_start,batt_pct_end,batt_temp_start,batt_temp_end,plugged,screen,memavail_mb,rc,notes" > "$CSV"
  fi
}

csv_row() {
  echo "$1" >> "$CSV"
}

run_bmoe() {
  local cell="$1" fused="$2" threads="$3" k="$4" drop="$5" ngen="$6" extra="${7:-}"
  local outd="$ROOT/logs/$cell"
  mkdir -p "$outd"
  abort_if_hot_or_empty

  local b0 t0 plug0 scr0 mem0
  b0="$(batt_pct)"; t0="$(batt_temp)"; plug0="$(batt_plug)"; scr0="$(screen_state)"; mem0="$(mem_avail)"
  log "CELL start $cell fused=$fused t=$threads k=$k drop=$drop n=$ngen batt=$b0 temp=$t0 plug=$plug0 screen=$scr0 mem=$mem0"

  echo "$b0" > "$outd/batt_start.txt"
  echo "$t0" > "$outd/temp_start.txt"
  echo "$plug0" > "$outd/plugged.txt"
  echo "$scr0" > "$outd/screen.txt"
  batt_json > "$outd/battery_start.json"
  echo "mWakefulness=$scr0" > "$outd/dumpsys_power.txt"

  if [ "${COLD:-1}" = "1" ]; then
    log "fadvise DONTNEED $MODEL"
    if ! "$HOME/bin/cold_model.sh" "$MODEL" > "$outd/cold.txt" 2>&1; then
      log "WARN cold_model failed (see $outd/cold.txt) — continuing"
    fi
  fi

  local prompt
  prompt="$(cat "$PFACT")"
  local args=(
    -m "$MODEL"
    -p "$prompt"
    -n "$ngen"
    --n-expert-used "$k"
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
    -t "$threads" -c 4096 --temp 0 --chatml --no-think
  )
  if [ "$fused" = "on" ]; then
    args+=(--moe-fused-ffn)
  else
    args+=(--no-moe-fused-ffn)
  fi
  if [ -n "$drop" ] && [ "$drop" != "-" ]; then
    args+=(--drop-cold-experts "$drop")
  fi

  printf '%s\n' "${args[@]}" > "$outd/cmdline.args"
  echo "$BMOE ${args[*]}" > "$outd/cmdline.txt"

  local rss_peak=0
  "$BMOE" "${args[@]}" > "$outd/stdout.txt" 2> "$outd/stderr.txt" &
  local pid=$!
  echo "$pid" > "$outd/pid.txt"
  while kill -0 "$pid" 2>/dev/null; do
    local rss
    rss="$(awk '/VmRSS:/ {print $2; exit}' /proc/$pid/status 2>/dev/null || echo 0)"
    if [ -n "$rss" ] && [ "$rss" -gt "$rss_peak" ] 2>/dev/null; then
      rss_peak="$rss"
    fi
    sleep 1
  done
  wait "$pid"
  local rc=$?
  echo "$rc" > "$outd/rc.txt"
  echo "$rss_peak" > "$outd/rss_kib.txt"
  local rss_mb
  rss_mb="$(awk -v k="$rss_peak" 'BEGIN{printf "%.1f", k/1024}')"

  local b1 t1 plug1 scr1
  b1="$(batt_pct)"; t1="$(batt_temp)"; plug1="$(batt_plug)"; scr1="$(screen_state)"
  batt_json > "$outd/battery_end.json"
  echo "$scr1" >> "$outd/screen.txt"

  parse_metrics "$outd/stdout.txt"
  extract_gen "$outd/stdout.txt" > "$outd/gen.txt"

  local fused_banner
  fused_banner="$(grep -m1 'moe-fused-ffn' "$outd/stderr.txt" || true)"
  log "CELL end $cell rc=$rc decode=${DECODE_TOKS:-?} compute=${COMPUTE:-?} flash=${FLASH:-?} mib=${MIB:-?} hit=${HIT:-?} rss=$rss_mb batt=$b0->$b1 temp=$t0->$t1 screen=$scr0/$scr1 banner=$fused_banner"

  csv_row "${cell},$(ts),s2,mellum2-q4km,${cell},${fused},${threads},${k},${drop},${ngen},${RUN_TYPE:-cold},${DECODE_TOKS:-},${COMPUTE:-},${FLASH:-},${MIB:-},${HIT:-},${rss_mb},${b0},${b1},${t0},${t1},${plug0},${scr0},${mem0},${rc},${fused_banner//,/;}"
  return "$rc"
}

# ---------- preflight ----------
log "S2 harness start"
set_status "PREFLIGHT"
csv_header

pin_now="$(hash_pin)"
echo "$pin_now  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.preflight"
if [ "$pin_now" != "$PIN_EXPECT" ]; then
  log "PIN MISMATCH got=$pin_now expect=$PIN_EXPECT"
  set_status "PIN_MISMATCH"
  exit 2
fi
log "campaign pin MATCH $pin_now"

if [ ! -x "$BMOE" ] || [ ! -x "$OPS" ]; then
  log "missing bins BMOE=$BMOE OPS=$OPS"
  set_status "MISSING_BINS"
  exit 2
fi
if [ ! -f "$MODEL" ]; then
  log "missing model $MODEL"
  set_status "MISSING_MODEL"
  exit 2
fi
if [ ! -f "$PFACT" ]; then
  log "missing p_fact $PFACT"
  set_status "MISSING_PROMPT"
  exit 2
fi
sha256sum "$PFACT" | tee "$ROOT/p_fact.sha256"
sha256sum "$BIN"/* | tee "$ROOT/bin.sha256.ondevice"
ps -A 2>/dev/null | grep -E 'bmoe-cli|test-backend-ops|llama' | grep -v grep | tee "$ROOT/foreign_procs.txt" || true

log "preflight batt=$(batt_pct)% temp=$(batt_temp)C plug=$(batt_plug) screen=$(screen_state) mem=$(mem_avail)MiB"

# ---------- phase 1a: kernel NMSE ----------
set_status "P1A_OPS"
log "P1A test-backend-ops test -b CPU -o MOE_SWIGLU_ID"
"$OPS" test -b CPU -o MOE_SWIGLU_ID > "$ROOT/s23/p1a_ops.txt" 2>&1
ops_rc=$?
echo "$ops_rc" > "$ROOT/s23/p1a_ops.rc"
if ! grep -q '7/7 tests passed' "$ROOT/s23/p1a_ops.txt"; then
  log "P1A FAIL rc=$ops_rc"
  set_status "CORRECTNESS_FAIL P1A"
  tail -40 "$ROOT/s23/p1a_ops.txt" | tee -a "$MASTER"
  exit 5
fi
log "P1A PASS 7/7"

# ---------- phase 1b: n=32 fused ON vs S1 prefix ----------
set_status "P1B_N32"
COLD=1 RUN_TYPE=warm run_bmoe "p1b_n32_on" on 4 8 - 32
cp "$ROOT/logs/p1b_n32_on/gen.txt" "$ROOT/s23/p1b_gen.txt"
cp "$ROOT/logs/p1b_n32_on/stdout.txt" "$ROOT/s23/p1b_stdout.txt"
cp "$ROOT/logs/p1b_n32_on/stderr.txt" "$ROOT/s23/p1b_stderr.txt"
gen32="$(tr -d '\r' < "$ROOT/s23/p1b_gen.txt" | tr -d '\n')"
printf '%s' "$S1_N32_PREFIX" > "$ROOT/s23/p1b_expected_prefix.txt"
printf '%s' "$gen32" > "$ROOT/s23/p1b_gen_oneline.txt"
if printf '%s' "$gen32" | grep -F -q -- "$S1_N32_PREFIX"; then
  log "P1B PASS n=32 prefix match"
else
  log "P1B FAIL n=32 prefix mismatch"
  echo "EXPECTED=$S1_N32_PREFIX" | tee "$ROOT/s23/p1b_diff.txt"
  echo "GOT=$gen32" | tee -a "$ROOT/s23/p1b_diff.txt"
  set_status "CORRECTNESS_FAIL P1B"
  exit 5
fi

# ---------- phase 1c: n=256 ON vs OFF ----------
set_status "P1C_N256"
COLD=1 RUN_TYPE=cold run_bmoe "p1c_n256_on" on 4 8 - 256
COLD=1 RUN_TYPE=cold run_bmoe "p1c_n256_off" off 4 8 - 256
cp "$ROOT/logs/p1c_n256_on/gen.txt" "$ROOT/s23/p1c_on_gen.txt"
cp "$ROOT/logs/p1c_n256_off/gen.txt" "$ROOT/s23/p1c_off_gen.txt"
if cmp -s "$ROOT/s23/p1c_on_gen.txt" "$ROOT/s23/p1c_off_gen.txt"; then
  log "P1C PASS n=256 ON==OFF"
else
  log "P1C FAIL n=256 token drift"
  # first differing byte / line
  diff -u "$ROOT/s23/p1c_off_gen.txt" "$ROOT/s23/p1c_on_gen.txt" | tee "$ROOT/s23/p1c_diff.txt" | head -40
  python3 - <<'PY' > "$ROOT/s23/p1c_diff_pos.txt" 2>/dev/null || true
off=open("s23/p1c_off_gen.txt","rb").read()
on=open("s23/p1c_on_gen.txt","rb").read()
n=min(len(off),len(on))
pos=next((i for i in range(n) if off[i]!=on[i]), n)
print(f"first_diff_byte={pos} off_len={len(off)} on_len={len(on)}")
print("off_ctx=", off[max(0,pos-20):pos+20])
print("on_ctx=", on[max(0,pos-20):pos+20])
PY
  set_status "CORRECTNESS_FAIL P1C"
  exit 5
fi

log "PHASE1 CORRECTNESS PASS"
set_status "P2_GATES"

# ---------- phase 2: gate cells ----------
# order: k6d065 OFF t2, ON t2, ON t4, ON t6; then k6d1.0 OFF t2, ON t2, ON t4
# 2 reps each. Retry once if fused ON slower than OFF at same t.

run_pair_or_cell() {
  local name="$1" fused="$2" t="$3" k="$4" drop="$5"
  local r
  for r in 1 2; do
    COLD=1 RUN_TYPE=cold run_bmoe "${name}_r${r}" "$fused" "$t" "$k" "$drop" 200 || {
      log "WARN cell ${name}_r${r} rc=$?"
    }
  done
}

median2() {
  # average of two numbers if both present
  awk -v a="${1:-}" -v b="${2:-}" 'BEGIN{
    if (a=="" && b=="") { print ""; exit }
    if (a=="") { print b; exit }
    if (b=="") { print a; exit }
    print (a+b)/2
  }'
}

run_pair_or_cell "k6d065_off_t2" off 2 6 0.65
run_pair_or_cell "k6d065_on_t2"  on  2 6 0.65

# retry rule: if ON slower than OFF at same t, one retry then accept
off_c="$(median2 "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d065_off_t2_r1/stdout.txt" | head -1)" "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d065_off_t2_r2/stdout.txt" | head -1)")"
on_c="$(median2 "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d065_on_t2_r1/stdout.txt" | head -1)" "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d065_on_t2_r2/stdout.txt" | head -1)")"
log "compare k6d065 t2 OFF=$off_c ON=$on_c"
if [ -n "$off_c" ] && [ -n "$on_c" ] && awk "BEGIN{exit !($on_c > $off_c)}"; then
  log "RETRY k6d065_on_t2 (ON slower than OFF)"
  COLD=1 RUN_TYPE=retry run_bmoe "k6d065_on_t2_retry" on 2 6 0.65 || true
fi

run_pair_or_cell "k6d065_on_t4" on 4 6 0.65
run_pair_or_cell "k6d065_on_t6" on 6 6 0.65

run_pair_or_cell "k6d10_off_t2" off 2 6 1.0
run_pair_or_cell "k6d10_on_t2"  on  2 6 1.0
off_c="$(median2 "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d10_off_t2_r1/stdout.txt" | head -1)" "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d10_off_t2_r2/stdout.txt" | head -1)")"
on_c="$(median2 "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d10_on_t2_r1/stdout.txt" | head -1)" "$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$ROOT/logs/k6d10_on_t2_r2/stdout.txt" | head -1)")"
log "compare k6d10 t2 OFF=$off_c ON=$on_c"
if [ -n "$off_c" ] && [ -n "$on_c" ] && awk "BEGIN{exit !($on_c > $off_c)}"; then
  log "RETRY k6d10_on_t2 (ON slower than OFF)"
  COLD=1 RUN_TYPE=retry run_bmoe "k6d10_on_t2_retry" on 2 6 1.0 || true
fi
run_pair_or_cell "k6d10_on_t4" on 4 6 1.0

pin_after="$(hash_pin)"
echo "$pin_after  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.after"
if [ "$pin_after" != "$PIN_EXPECT" ]; then
  log "PIN CHANGED after cells $pin_after"
  set_status "PIN_TAMPERED"
  exit 2
fi
log "campaign pin still MATCH $pin_after"
log "PHASE2 GATES DONE"
set_status "GATES_DONE"
exit 0
