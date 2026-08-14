#!/data/data/com.termux/files/usr/bin/bash
# KERNEL K-E — energy/thermal A/B on S23.
# A = campaign-equivalent dotprod (mellum2 pin for Mellum2, CAMPAIGN pin for CalaQwen)
# B = kernel_ke i8mm (same source as mellum2 pin, ONLY arch flag delta)
# Do NOT write campaign / mellum2 / kernel_s1 / kernel_s2 pins.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH"
export LC_ALL=C

ROOT="$HOME/experiments/results/kernel_ke"
MELLUM="$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
CALAQWEN="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
if [ ! -f "$CALAQWEN" ]; then
  CALAQWEN="$HOME/models/Qwen3.6-35B-A3B-KEXP.gguf"
fi
BIN_A_MELLUM="$HOME/bin/bmoe-cli-mellum2"
BIN_A_CAMPAIGN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
BIN_B="$HOME/bin/bmoe-cli-kernel-ke"
PFACT="$ROOT/p_fact.txt"
CSV="$ROOT/runs.csv"
STATUS="$ROOT/STATUS.txt"
MASTER="$ROOT/master.log"
PIN_CAMPAIGN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
PIN_EXPECT="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"
MELLUM_EXPECT="0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
FLOOR_BATT=45
ABORT_TEMP=43
CLK_TCK="$(getconf CLK_TCK 2>/dev/null || echo 100)"

mkdir -p "$ROOT/s23" "$ROOT/logs" "$ROOT/samples"
cd "$ROOT"

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }
set_status() { echo "$*" | tee "$STATUS"; }

hash_file() {
  sha256sum "$1" 2>/dev/null | awk '{print $1}'
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
  local s
  s="$(dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | sed 's/.*mWakefulness=//' | tr -d ' \r')"
  if [ -z "$s" ]; then
    if [ -f "$ROOT/s23/screen_host.txt" ]; then
      s="$(tail -1 "$ROOT/s23/screen_host.txt" | awk '{print $NF}')"
    fi
  fi
  echo "${s:-UNKNOWN}"
}

mem_avail() {
  awk '/MemAvailable:/ {printf "%.1f", $2/1024; exit}' /proc/meminfo
}

abort_if_hot_or_empty() {
  local t p plug
  t="$(batt_temp)"
  p="$(batt_pct)"
  plug="$(batt_plug)"
  t="${t:-0}"
  p="${p:-0}"
  if [ -n "$plug" ] && [ "$plug" != "UNPLUGGED" ] && [ "$plug" != "false" ] && [ "$plug" != "0" ]; then
    case "$plug" in
      UNPLUGGED|unplugged|false|False|0) ;;
      *)
        log "ABORT_PLUGGED plug=$plug"
        set_status "ABORT_PLUGGED $plug"
        exit 5
        ;;
    esac
  fi
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

# /proc/<pid>/stat utime+stime in ticks. comm may contain spaces.
cpu_ticks() {
  local pid="$1" s
  s="$(cat "/proc/$pid/stat" 2>/dev/null || true)"
  [ -n "$s" ] || { echo 0; return; }
  s="${s##*)}"
  set -- $s
  echo $(( ${12:-0} + ${13:-0} ))
}

# Snapshot: epoch_ms current_now_mA current_avg_mA voltage_mV temp source
# dumpsys Samsung current is mA. termux-battery-status "current" is uA.
batt_sample_line() {
  local raw now avg volt temp src
  raw="$(dumpsys battery 2>/dev/null || true)"
  now="$(printf '%s\n' "$raw" | awk -F: '/current now/ {gsub(/ /,"",$2); print $2; exit}')"
  avg="$(printf '%s\n' "$raw" | awk -F: '/current.?avg|current_avg/ {gsub(/ /,"",$2); print $2; exit}')"
  volt="$(printf '%s\n' "$raw" | awk -F: '/^  voltage:/ {gsub(/ /,"",$2); print $2; exit}')"
  temp="$(printf '%s\n' "$raw" | awk -F: '/^  temperature:/ {gsub(/ /,"",$2); print $2; exit}')"
  src="dumpsys"
  if [ -z "$now" ] && [ -z "$avg" ]; then
    local tj
    tj="$(termux-battery-status 2>/dev/null || echo '{}')"
    now="$(printf '%s\n' "$tj" | tr -d '\r' | awk -F'[:,]' '/"current"/ && $0 !~ /average/ {gsub(/ /,"",$2); print $2; exit}')"
    avg="$(printf '%s\n' "$tj" | tr -d '\r' | awk -F'[:,]' '/"current_average"/ {gsub(/ /,"",$2); print $2; exit}')"
    volt="$(printf '%s\n' "$tj" | tr -d '\r' | awk -F'[:,]' '/"voltage"/ {gsub(/ /,"",$2); print $2; exit}')"
    temp="$(printf '%s\n' "$tj" | tr -d '\r' | awk -F'[:,]' '/"temperature"/ {gsub(/ /,"",$2); print $2; exit}')"
    src="termux"
    # termux current is uA when |I| > 10000
    if [ -n "$now" ] && awk "BEGIN{i=$now; if(i<0)i=-i; exit !(i>10000)}"; then
      now="$(awk -v i="$now" 'BEGIN{printf "%.1f", i/1000}')"
    fi
  fi
  printf '%s %s %s %s %s %s\n' "$(date +%s%3N)" "${now:--}" "${avg:--}" "${volt:--}" "${temp:--}" "$src"
}

# Integrate samples -> joules. current_avg preferred, fallback current_now.
# Assume Samsung dumpsys current is mA, voltage mV. J = |I_mA| * V_mV * dt_s / 1e6
integrate_joules() {
  local f="$1"
  awk '
    BEGIN { prev_t=-1; prev_i=0; prev_v=0; j=0; n=0; sum_i=0; sum_v=0 }
    NF>=4 {
      t=$1+0
      now=$2; avg=$3; v=$4+0
      i=avg
      if (i=="-" || i=="" || i+0==0 && avg=="-") i=now
      if (i=="-" || i=="") next
      i=i+0
      if (i<0) i=-i
      if (v<=0) next
      if (prev_t>0 && t>prev_t) {
        dt=(t-prev_t)/1000.0
        i_mid=(i+prev_i)/2.0
        v_mid=(v+prev_v)/2.0
        j += i_mid * v_mid * dt / 1000000.0
      }
      prev_t=t; prev_i=i; prev_v=v
      n++; sum_i+=i; sum_v+=v
    }
    END {
      if (n<1) { print "0 0 0"; exit }
      printf "%.6f %.1f %.1f\n", j, sum_i/n, sum_v/n
    }
  ' "$f"
}

extract_gen() {
  sed '/^generation:/,$d' "$1" | sed 's/^.*Assistant://'
}

parse_metrics() {
  local f="$1"
  DECODE_TOKS="$(sed -n 's/^generation:.*(\([0-9.]*\) tok\/s).*/\1/p' "$f" | head -1)"
  N_GEN="$(sed -n 's/^generation: \([0-9]*\) tokens.*/\1/p' "$f" | head -1)"
  COMPUTE="$(sed -n 's/.*compute \([0-9.]*\) +.*/\1/p' "$f" | head -1)"
  FLASH="$(sed -n 's/.*flash I\/O \([0-9.]*\) s\/token.*/\1/p' "$f" | head -1)"
  MIB="$(sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' "$f" | head -1)"
  HIT="$(sed -n 's/moe-cache: \([0-9.]*\)% hit.*/\1/p' "$f" | head -1)"
}

csv_header() {
  if [ ! -f "$CSV" ]; then
    echo "run_id,date,phase,model,cell,binary,arch,threads,k,drop,n_gen,run_type,decode_toks,compute_s_tok,flash_s_tok,mib_tok,hit_pct,cpu_s,cpu_s_tok,joule,joule_tok,i_avg_ma,v_avg_mv,vmrss_peak_mb,batt_pct_start,batt_pct_end,batt_temp_start,batt_temp_end,plugged,screen,memavail_mb,rc,bin_sha256,notes" > "$CSV"
  fi
}

record_pin() {
  local tag="$1" out="$2"
  {
    echo "tag=$tag ts=$(ts)"
    echo -n "campaign "; sha256sum "$PIN_CAMPAIGN" 2>/dev/null || echo "MISSING"
    echo -n "mellum2 "; sha256sum "$HOME/bin/mellum2/bmoe-cli" 2>/dev/null || echo "MISSING"
    echo -n "kernel_ke "; sha256sum "$HOME/bin/kernel_ke/bmoe-cli" 2>/dev/null || echo "MISSING"
    echo -n "kernel_s1 "; sha256sum "$HOME/bin/kernel_s1/bmoe-cli" 2>/dev/null || echo "MISSING"
    echo -n "kernel_s2 "; sha256sum "$HOME/bin/kernel_s2/bmoe-cli" 2>/dev/null || echo "MISSING"
  } | tee "$out"
}

verify_pins_untouched() {
  local got
  got="$(hash_file "$PIN_CAMPAIGN")"
  if [ "$got" != "$PIN_EXPECT" ]; then
    log "PIN_MISMATCH campaign got=$got expect=$PIN_EXPECT"
    set_status "FAIL_PIN_CAMPAIGN $got"
    exit 6
  fi
  if [ -x "$HOME/bin/mellum2/bmoe-cli" ]; then
    got="$(hash_file "$HOME/bin/mellum2/bmoe-cli")"
    if [ "$got" != "$MELLUM_EXPECT" ]; then
      log "PIN_MISMATCH mellum2 got=$got expect=$MELLUM_EXPECT"
      set_status "FAIL_PIN_MELLUM2 $got"
      exit 6
    fi
  fi
}

run_bmoe() {
  local cell="$1" bin="$2" arch="$3" model="$4" threads="$5" k="$6" drop="$7" ngen="$8" cold="$9"
  local outd="$ROOT/logs/$cell"
  mkdir -p "$outd"
  abort_if_hot_or_empty

  local b0 t0 plug0 scr0 mem0
  b0="$(batt_pct)"; t0="$(batt_temp)"; plug0="$(batt_plug)"; scr0="$(screen_state)"; mem0="$(mem_avail)"
  log "CELL start $cell arch=$arch t=$threads k=$k drop=$drop n=$ngen cold=$cold batt=$b0 temp=$t0 plug=$plug0 screen=$scr0 mem=$mem0"

  echo "$b0" > "$outd/batt_start.txt"
  echo "$t0" > "$outd/temp_start.txt"
  echo "$plug0" > "$outd/plugged.txt"
  echo "$scr0" > "$outd/screen.txt"
  batt_json > "$outd/battery_start.json"
  echo "$bin" > "$outd/bin.path"

  if [ "$arch" = "i8mm" ]; then
    hash_file "$HOME/bin/kernel_ke/bmoe-cli" > "$outd/elf.sha256"
  elif [ "$model" = "$MELLUM" ]; then
    hash_file "$HOME/bin/mellum2/bmoe-cli" > "$outd/elf.sha256"
  else
    hash_file "$PIN_CAMPAIGN" > "$outd/elf.sha256"
  fi

  if [ "$cold" = "1" ]; then
    log "fadvise DONTNEED $model"
    if ! "$HOME/bin/cold_model.sh" "$model" > "$outd/cold.txt" 2>&1; then
      log "WARN cold_model failed (see $outd/cold.txt) — continuing"
    fi
  else
    echo "no-fadvise" > "$outd/cold.txt"
  fi

  local prompt
  prompt="$(cat "$PFACT")"
  local args=(
    -m "$model"
    -p "$prompt"
    -n "$ngen"
    --n-expert-used "$k"
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
    -t "$threads" -c 4096 --temp 0 --chatml --no-think
  )
  if [ -n "$drop" ] && [ "$drop" != "-" ]; then
    args+=(--drop-cold-experts "$drop")
  fi

  printf '%s\n' "${args[@]}" > "$outd/cmdline.args"
  echo "$bin ${args[*]}" > "$outd/cmdline.txt"

  local samp="$outd/battery_samples.txt"
  echo "epoch_ms current_now_mA current_avg_mA voltage_mV temp source" > "$samp"

  local rss_peak=0 ticks0=0 ticks1=0
  "$bin" "${args[@]}" > "$outd/stdout.txt" 2> "$outd/stderr.txt" &
  local pid=$!
  echo "$pid" > "$outd/pid.txt"
  sleep 0.2
  ticks0="$(cpu_ticks "$pid")"
  echo "$ticks0" > "$outd/ticks_start.txt"

  local next_batt=0
  while kill -0 "$pid" 2>/dev/null; do
    local rss now tk
    rss="$(awk '/VmRSS:/ {print $2; exit}' /proc/$pid/status 2>/dev/null || echo 0)"
    if [ -n "$rss" ] && [ "$rss" -gt "$rss_peak" ] 2>/dev/null; then
      rss_peak="$rss"
    fi
    tk="$(cpu_ticks "$pid")"
    if [ -n "$tk" ] && [ "$tk" != "0" ]; then
      ticks1="$tk"
      echo "$ticks1" > "$outd/ticks_live.txt"
    fi
    now="$(date +%s)"
    if [ "$now" -ge "$next_batt" ]; then
      batt_sample_line >> "$samp" || true
      next_batt=$((now + 5))
    fi
    sleep 1
  done
  wait "$pid"
  local rc=$?
  echo "$rc" > "$outd/rc.txt"
  echo "$rss_peak" > "$outd/rss_kib.txt"
  echo "${ticks1:-$ticks0}" > "$outd/ticks_end.txt"
  batt_sample_line >> "$samp" || true

  local rss_mb cpu_s cpu_s_tok joule i_avg v_avg joule_tok
  rss_mb="$(awk -v k="$rss_peak" 'BEGIN{printf "%.1f", k/1024}')"
  cpu_s="$(awk -v a="$ticks0" -v b="${ticks1:-$ticks0}" -v hz="$CLK_TCK" 'BEGIN{
    d=b-a; if (d<0) d=0; printf "%.4f", d/hz
  }')"

  local integ
  integ="$(integrate_joules "$samp")"
  joule="$(echo "$integ" | awk '{print $1}')"
  i_avg="$(echo "$integ" | awk '{print $2}')"
  v_avg="$(echo "$integ" | awk '{print $3}')"

  local b1 t1 plug1 scr1
  b1="$(batt_pct)"; t1="$(batt_temp)"; plug1="$(batt_plug)"; scr1="$(screen_state)"
  batt_json > "$outd/battery_end.json"
  echo "$scr1" >> "$outd/screen.txt"

  parse_metrics "$outd/stdout.txt"
  extract_gen "$outd/stdout.txt" > "$outd/gen.txt"
  local ntok="${N_GEN:-$ngen}"
  cpu_s_tok="$(awk -v c="$cpu_s" -v n="$ntok" 'BEGIN{ if (n+0>0) printf "%.6f", c/n; else print "" }')"
  joule_tok="$(awk -v j="$joule" -v n="$ntok" 'BEGIN{ if (n+0>0) printf "%.6f", j/n; else print "" }')"

  local elfsha
  elfsha="$(cat "$outd/elf.sha256" 2>/dev/null || echo "")"
  local note="clk=$CLK_TCK ticks=$ticks0->${ticks1:-$ticks0}"
  log "CELL end $cell rc=$rc decode=${DECODE_TOKS:-?} compute=${COMPUTE:-?} cpu_s=$cpu_s cpu/tok=$cpu_s_tok J=$joule J/tok=$joule_tok Iavg=$i_avg batt=$b0->$b1 temp=$t0->$t1 screen=$scr0/$scr1"

  echo "${cell},$(ts),ke,${model##*/},${cell},${arch},${arch},${threads},${k},${drop},${ntok},${RUN_TYPE:-cold},${DECODE_TOKS:-},${COMPUTE:-},${FLASH:-},${MIB:-},${HIT:-},${cpu_s},${cpu_s_tok},${joule},${joule_tok},${i_avg},${v_avg},${rss_mb},${b0},${b1},${t0},${t1},${plug0},${scr0},${mem0},${rc},${elfsha},${note}" >> "$CSV"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
csv_header
: > "$MASTER"
set_status "KE_START"
log "KERNEL K-E start CLK_TCK=$CLK_TCK"
record_pin before "$ROOT/campaign.sha256.before"
verify_pins_untouched

if [ ! -x "$BIN_B" ]; then
  log "MISSING kernel_ke wrapper $BIN_B"
  set_status "FAIL_NO_KE_BIN"
  exit 7
fi
if [ ! -x "$BIN_A_MELLUM" ]; then
  log "MISSING mellum2 wrapper $BIN_A_MELLUM"
  set_status "FAIL_NO_MELLUM_BIN"
  exit 7
fi
if [ ! -f "$PFACT" ]; then
  log "MISSING $PFACT"
  set_status "FAIL_NO_PROMPT"
  exit 7
fi
if [ ! -f "$MELLUM" ]; then
  log "MISSING model $MELLUM"
  set_status "FAIL_NO_MELLUM_MODEL"
  exit 7
fi

# Wait until UNPLUGGED (host may have pushed while charging).
wait_unplugged() {
  local plug p t n=0
  while :; do
    plug="$(batt_plug)"; p="$(batt_pct)"; t="$(batt_temp)"
    if [ "$plug" = "UNPLUGGED" ]; then
      log "UNPLUGGED confirmed batt=$p temp=$t"
      return 0
    fi
    n=$((n+1))
    set_status "WAIT_UNPLUG plug=$plug batt=$p temp=$t n=$n"
    log "WAIT_UNPLUG plug=$plug batt=$p temp=$t"
    sleep 20
  done
}
wait_unplugged
abort_if_hot_or_empty
log "preflight batt=$(batt_pct) temp=$(batt_temp) plug=$(batt_plug) screen=$(screen_state)"

# Class 1 — Mellum2 k6 d1.0 t2, 2 cold reps, ABBA
set_status "KE_C1_MELLUM_ABBA"
RUN_TYPE=cold
run_bmoe "c1_A_r1" "$BIN_A_MELLUM" "dotprod" "$MELLUM" 2 6 1.0 200 1
run_bmoe "c1_B_r1" "$BIN_B"        "i8mm"    "$MELLUM" 2 6 1.0 200 1
run_bmoe "c1_B_r2" "$BIN_B"        "i8mm"    "$MELLUM" 2 6 1.0 200 1
run_bmoe "c1_A_r2" "$BIN_A_MELLUM" "dotprod" "$MELLUM" 2 6 1.0 200 1
record_pin after_c1 "$ROOT/campaign.sha256.after_c1"
verify_pins_untouched

# Class 2 — sustained 6+6, no fadvise, contiguous blocks (throttle test)
set_status "KE_C2_SUSTAINED_A"
RUN_TYPE=sustained
i=1
while [ "$i" -le 6 ]; do
  set_status "KE_C2_A_s${i}"
  run_bmoe "c2_A_s${i}" "$BIN_A_MELLUM" "dotprod" "$MELLUM" 2 6 1.0 200 0
  i=$((i+1))
done
set_status "KE_C2_SUSTAINED_B"
i=1
while [ "$i" -le 6 ]; do
  set_status "KE_C2_B_s${i}"
  run_bmoe "c2_B_s${i}" "$BIN_B" "i8mm" "$MELLUM" 2 6 1.0 200 0
  i=$((i+1))
done
record_pin after_c2 "$ROOT/campaign.sha256.after_c2"
verify_pins_untouched

# Class 3 — CalaQwen k6d065 t4, 1+1 cold, battery permitting
if [ -f "$CALAQWEN" ] && [ -x "$BIN_A_CAMPAIGN" ]; then
  p="$(batt_pct)"; t="$(batt_temp)"
  if awk "BEGIN{exit !($p >= $FLOOR_BATT + 4 && $t < $ABORT_TEMP - 2)}"; then
    set_status "KE_C3_CALAQWEN"
    RUN_TYPE=cold
    export LD_LIBRARY_PATH="$(dirname "$BIN_A_CAMPAIGN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    run_bmoe "c3_A_r1" "$BIN_A_CAMPAIGN" "dotprod" "$CALAQWEN" 4 6 0.65 200 1
    run_bmoe "c3_B_r1" "$BIN_B"          "i8mm"    "$CALAQWEN" 4 6 0.65 200 1
  else
    log "SKIP CalaQwen batt=$p temp=$t (need >=$((FLOOR_BATT+4))% and <$((ABORT_TEMP-2))C)"
    echo "SKIP_CALAQWEN batt=$p temp=$t" >> "$ROOT/s23/skip_c3.txt"
  fi
else
  log "SKIP CalaQwen model/bin missing model=$CALAQWEN bin=$BIN_A_CAMPAIGN"
  echo "SKIP_CALAQWEN missing" >> "$ROOT/s23/skip_c3.txt"
fi

record_pin after "$ROOT/campaign.sha256.after"
verify_pins_untouched
set_status "KE_DONE"
log "KERNEL K-E done"
echo DONE >> "$MASTER"
exit 0
