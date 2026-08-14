#!/data/data/com.termux/files/usr/bin/bash
# KERNEL S2 Phase A — determinism triage. Do NOT rebuild. Do NOT touch campaign pin.
# Same prompt/config as P1C: n=256, t=4, k=8, temp 0, fadvise between cells.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH"

ROOT="$HOME/experiments/results/kernel_s2"
BIN="$HOME/bin/kernel_s2"
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

mkdir -p "$ROOT/s23" "$ROOT/logs" "$ROOT/s23/phaseA"
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

  csv_row "${cell},$(ts),s2-phaseA,mellum2-q4km,${cell},${fused},${threads},${k},${drop},${ngen},${RUN_TYPE:-cold},${DECODE_TOKS:-},${COMPUTE:-},${FLASH:-},${MIB:-},${HIT:-},${rss_mb},${b0},${b1},${t0},${t1},${plug0},${scr0},${mem0},${rc},${fused_banner//,/;}"
  return "$rc"
}

first_diff() {
  local a="$1" b="$2" out="$3"
  python3 - "$a" "$b" > "$out" <<'PY'
import sys
pa, pb = sys.argv[1], sys.argv[2]
off = open(pa, "rb").read()
on = open(pb, "rb").read()
n = min(len(off), len(on))
pos = next((i for i in range(n) if off[i] != on[i]), n if len(off) == len(on) else n)
same = off == on
print(f"identical={str(same).lower()}")
print(f"first_diff_byte={pos} a_len={len(off)} b_len={len(on)}")
print("a_ctx=", off[max(0, pos-24):pos+24])
print("b_ctx=", on[max(0, pos-24):pos+24])
# also char/word in decoded text (utf-8, replace)
ta = off.decode("utf-8", "replace")
tb = on.decode("utf-8", "replace")
npos = next((i for i in range(min(len(ta), len(tb))) if ta[i] != tb[i]), min(len(ta), len(tb)))
wa = ta[:npos].split()
print(f"first_diff_char={npos} first_diff_word={len(wa)}")
print("a_word=", (ta[npos:].split()[:1] or [""])[0])
print("b_word=", (tb[npos:].split()[:1] or [""])[0])
PY
}

# ---------- preflight ----------
log "S2 Phase A determinism triage start"
set_status "PHASEA_PREFLIGHT"
csv_header

pin_now="$(hash_pin)"
echo "$pin_now  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.phaseA_before"
if [ "$pin_now" != "$PIN_EXPECT" ]; then
  log "PIN MISMATCH got=$pin_now expect=$PIN_EXPECT"
  set_status "PIN_MISMATCH"
  exit 2
fi
log "campaign pin MATCH $pin_now"

if [ ! -x "$BMOE" ]; then
  log "missing BMOE=$BMOE"
  set_status "MISSING_BINS"
  exit 2
fi
if [ ! -f "$MODEL" ] || [ ! -f "$PFACT" ]; then
  log "missing model or prompt"
  set_status "MISSING_INPUTS"
  exit 2
fi

log "preflight batt=$(batt_pct)% temp=$(batt_temp)C plug=$(batt_plug) screen=$(screen_state) mem=$(mem_avail)MiB"

# ---------- ON twice, then OFF twice (P1C config: t=4 k=8 n=256 temp 0) ----------
set_status "PHASEA_ON1"
COLD=1 RUN_TYPE=cold run_bmoe "phaseA_on_r1" on 4 8 - 256
set_status "PHASEA_ON2"
COLD=1 RUN_TYPE=cold run_bmoe "phaseA_on_r2" on 4 8 - 256
set_status "PHASEA_OFF1"
COLD=1 RUN_TYPE=cold run_bmoe "phaseA_off_r1" off 4 8 - 256
set_status "PHASEA_OFF2"
COLD=1 RUN_TYPE=cold run_bmoe "phaseA_off_r2" off 4 8 - 256

A="$ROOT/s23/phaseA"
mkdir -p "$A"
cp "$ROOT/logs/phaseA_on_r1/gen.txt"  "$A/on_r1_gen.txt"
cp "$ROOT/logs/phaseA_on_r2/gen.txt"  "$A/on_r2_gen.txt"
cp "$ROOT/logs/phaseA_off_r1/gen.txt" "$A/off_r1_gen.txt"
cp "$ROOT/logs/phaseA_off_r2/gen.txt" "$A/off_r2_gen.txt"
cp "$ROOT/logs/phaseA_on_r1/stdout.txt"  "$A/on_r1_stdout.txt"
cp "$ROOT/logs/phaseA_on_r2/stdout.txt"  "$A/on_r2_stdout.txt"
cp "$ROOT/logs/phaseA_off_r1/stdout.txt" "$A/off_r1_stdout.txt"
cp "$ROOT/logs/phaseA_off_r2/stdout.txt" "$A/off_r2_stdout.txt"
cp "$ROOT/logs/phaseA_on_r1/stderr.txt"  "$A/on_r1_stderr.txt"
cp "$ROOT/logs/phaseA_on_r2/stderr.txt"  "$A/on_r2_stderr.txt"
cp "$ROOT/logs/phaseA_off_r1/stderr.txt" "$A/off_r1_stderr.txt"
cp "$ROOT/logs/phaseA_off_r2/stderr.txt" "$A/off_r2_stderr.txt"

first_diff "$A/on_r1_gen.txt"  "$A/on_r2_gen.txt"  "$A/diff_on_on.txt"
first_diff "$A/off_r1_gen.txt" "$A/off_r2_gen.txt" "$A/diff_off_off.txt"
first_diff "$A/on_r1_gen.txt"  "$A/off_r1_gen.txt" "$A/diff_on_off.txt"

on_on="$(grep -m1 '^identical=' "$A/diff_on_on.txt" | cut -d= -f2)"
off_off="$(grep -m1 '^identical=' "$A/diff_off_off.txt" | cut -d= -f2)"
on_off="$(grep -m1 '^identical=' "$A/diff_on_off.txt" | cut -d= -f2)"

{
  echo "on_on=$on_on"
  echo "off_off=$off_off"
  echo "on_off=$on_off"
  echo "--- on vs on ---"
  cat "$A/diff_on_on.txt"
  echo "--- off vs off ---"
  cat "$A/diff_off_off.txt"
  echo "--- on vs off (r1) ---"
  cat "$A/diff_on_off.txt"
} | tee "$A/verdict.txt"

pin_after="$(hash_pin)"
echo "$pin_after  $PIN_CAMPAIGN" | tee "$ROOT/campaign.sha256.phaseA_after"
if [ "$pin_after" != "$PIN_EXPECT" ]; then
  log "PIN CHANGED after Phase A $pin_after"
  set_status "PIN_TAMPERED"
  exit 2
fi
log "campaign pin still MATCH $pin_after"

if [ "$on_on" = "true" ] && [ "$off_off" = "true" ]; then
  log "VERDICT DETERMINISTIC_REORDER on==on off==off on_off=$on_off"
  set_status "DETERMINISTIC_REORDER"
  echo "DETERMINISTIC_REORDER" > "$A/VERDICT"
  exit 0
fi

if [ "$on_on" != "true" ]; then
  log "VERDICT RACE ON!=ON"
  set_status "RACE"
  echo "RACE" > "$A/VERDICT"
  exit 6
fi

log "VERDICT UNEXPECTED off_off=$off_off on_on=$on_on"
set_status "PHASEA_UNEXPECTED off_off=$off_off on_on=$on_on"
echo "UNEXPECTED" > "$A/VERDICT"
exit 7
