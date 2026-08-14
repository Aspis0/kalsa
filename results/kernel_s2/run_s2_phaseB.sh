#!/data/data/com.termux/files/usr/bin/bash
# KERNEL S2 Phase B — gate cells. ONLY after DETERMINISTIC_REORDER.
# Do NOT rebuild. Do NOT touch campaign pin.
# k6d065: OFF t2 → ON t2 → ON t4 → ON t6; k6d1.0: OFF t2 → ON t2 → ON t4
# 2 reps, n=200, temp 0, fadvise DONTNEED between cold cells.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH"

ROOT="$HOME/experiments/results/kernel_s2"
MODEL="$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
BMOE="$HOME/bin/bmoe-cli-kernel-s2"
PFACT="$ROOT/p_fact.txt"
CSV="$ROOT/runs.csv"
STATUS="$ROOT/STATUS.txt"
MASTER="$ROOT/master.log"
PIN_CAMPAIGN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
PIN_EXPECT="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"
FLOOR_BATT=45
ABORT_TEMP=43

mkdir -p "$ROOT/s23" "$ROOT/logs" "$ROOT/s23/phaseB"
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
  local cell="$1" fused="$2" threads="$3" k="$4" drop="$5" ngen="$6"
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

  csv_row "${cell},$(ts),s2-phaseB,mellum2-q4km,${cell},${fused},${threads},${k},${drop},${ngen},${RUN_TYPE:-cold},${DECODE_TOKS:-},${COMPUTE:-},${FLASH:-},${MIB:-},${HIT:-},${rss_mb},${b0},${b1},${t0},${t1},${plug0},${scr0},${mem0},${rc},${fused_banner//,/;}"
  return "$rc"
}

run_pair_or_cell() {
  local name="$1" fused="$2" t="$3" k="$4" drop="$5"
  local r
  for r in 1 2; do
    set_status "PHASEB_${name}_r${r}"
    COLD=1 RUN_TYPE=cold run_bmoe "${name}_r${r}" "$fused" "$t" "$k" "$drop" 200 || {
      log "WARN cell ${name}_r${r} rc=$?"
    }
  done
}

median2() {
  awk -v a="${1:-}" -v b="${2:-}" 'BEGIN{
    if (a=="" && b=="") { print ""; exit }
    if (a=="") { print b; exit }
    if (b=="") { print a; exit }
    print (a+b)/2
  }'
}

cell_compute() {
  local f="$1"
  if [ -f "$f" ]; then
    sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$f" | head -1
  fi
}

# ---------- preflight ----------
log "S2 Phase B gate cells start"
set_status "PHASEB_PREFLIGHT"
csv_header

pin_now="$(hash_pin)"
echo "$pin_now  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.phaseB_before"
if [ "$pin_now" != "$PIN_EXPECT" ]; then
  log "PIN MISMATCH got=$pin_now expect=$PIN_EXPECT"
  set_status "PIN_MISMATCH"
  exit 2
fi
log "campaign pin MATCH $pin_now"

if [ ! -x "$BMOE" ] || [ ! -f "$MODEL" ] || [ ! -f "$PFACT" ]; then
  log "missing bins/model/prompt"
  set_status "MISSING_INPUTS"
  exit 2
fi

log "preflight batt=$(batt_pct)% temp=$(batt_temp)C plug=$(batt_plug) screen=$(screen_state) mem=$(mem_avail)MiB"

# k6d065: fused OFF t2 (re-anchor vs 0.181) → ON t2 → ON t4 → ON t6
run_pair_or_cell "k6d065_off_t2" off 2 6 0.65
run_pair_or_cell "k6d065_on_t2"  on  2 6 0.65

off_c="$(median2 "$(cell_compute "$ROOT/logs/k6d065_off_t2_r1/stdout.txt")" "$(cell_compute "$ROOT/logs/k6d065_off_t2_r2/stdout.txt")")"
on_c="$(median2 "$(cell_compute "$ROOT/logs/k6d065_on_t2_r1/stdout.txt")" "$(cell_compute "$ROOT/logs/k6d065_on_t2_r2/stdout.txt")")"
log "compare k6d065 t2 OFF=$off_c ON=$on_c"
if [ -n "$off_c" ] && [ -n "$on_c" ] && awk "BEGIN{exit !($on_c > $off_c)}"; then
  log "RETRY k6d065_on_t2 (ON slower than OFF)"
  set_status "PHASEB_k6d065_on_t2_retry"
  COLD=1 RUN_TYPE=retry run_bmoe "k6d065_on_t2_retry" on 2 6 0.65 200 || true
fi

run_pair_or_cell "k6d065_on_t4" on 4 6 0.65
run_pair_or_cell "k6d065_on_t6" on 6 6 0.65

# k6d1.0: fused OFF t2 → ON t2 → ON t4
run_pair_or_cell "k6d10_off_t2" off 2 6 1.0
run_pair_or_cell "k6d10_on_t2"  on  2 6 1.0
off_c="$(median2 "$(cell_compute "$ROOT/logs/k6d10_off_t2_r1/stdout.txt")" "$(cell_compute "$ROOT/logs/k6d10_off_t2_r2/stdout.txt")")"
on_c="$(median2 "$(cell_compute "$ROOT/logs/k6d10_on_t2_r1/stdout.txt")" "$(cell_compute "$ROOT/logs/k6d10_on_t2_r2/stdout.txt")")"
log "compare k6d10 t2 OFF=$off_c ON=$on_c"
if [ -n "$off_c" ] && [ -n "$on_c" ] && awk "BEGIN{exit !($on_c > $off_c)}"; then
  log "RETRY k6d10_on_t2 (ON slower than OFF)"
  set_status "PHASEB_k6d10_on_t2_retry"
  COLD=1 RUN_TYPE=retry run_bmoe "k6d10_on_t2_retry" on 2 6 1.0 200 || true
fi
run_pair_or_cell "k6d10_on_t4" on 4 6 1.0

pin_after="$(hash_pin)"
echo "$pin_after  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.phaseB_after"
if [ "$pin_after" != "$PIN_EXPECT" ]; then
  log "PIN CHANGED after Phase B $pin_after"
  set_status "PIN_TAMPERED"
  exit 2
fi
log "campaign pin still MATCH $pin_after"
log "PHASE2 GATES DONE"
set_status "GATES_DONE"
exit 0
