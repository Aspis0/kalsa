#!/data/data/com.termux/files/usr/bin/bash
# Sustained thermal A/B: CPU decode vs GPU decode on S23.
# Protocol is pre-declared. Do not "improve" flags mid-run.
# Nothing outside ~/gdn_k2/.
set -eu

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="${PREFIX}/bin:${PREFIX}/bin/applets:${PATH}"
export HOME="${HOME:-/data/data/com.termux/files/home}"
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin_cpufix:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export TMPDIR="${PREFIX}/tmp"

ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin_cpufix"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
if [ ! -f "${MODEL}" ] && [ -f "${ROOT}/Qwen3.5-2B-Q4_K_M.gguf" ]; then
  MODEL="${ROOT}/Qwen3.5-2B-Q4_K_M.gguf"
fi

# On-device work dir (inside ~/gdn_k2/ only).
OUT="${ROOT}/gpu_sustained"
PROMPT="${OUT}/prompt.txt"
LOGDIR="${OUT}/logs"
mkdir -p "${LOGDIR}"

ARM_SECONDS="${ARM_SECONDS:-900}"          # 15 min per arm
N_PREDICT="${N_PREDICT:-6144}"
CTX="${CTX:-4096}"
TEMP="${TEMP:-0.7}"
THREADS="${THREADS:-4}"
BATT_START_MIN="${BATT_START_MIN:-60}"
BATT_ABORT="${BATT_ABORT:-25}"
TEMP_ABORT_C="${TEMP_ABORT_C:-48.0}"
TEMP_ABORT_STREAK="${TEMP_ABORT_STREAK:-2}"  # 2 consecutive 60s samples >48C
COOLDOWN_TOL_C="${COOLDOWN_TOL_C:-1.0}"
COOLDOWN_MAX_S="${COOLDOWN_MAX_S:-3600}"
SAMPLE_EVERY_S="${SAMPLE_EVERY_S:-60}"
CAPACITY_MAH="${CAPACITY_MAH:-3785}"
VOLTAGE_V="${VOLTAGE_V:-3.85}"

CLI="${BIN}/llama-cli"
COMMON_FLAGS=(
  -m "${MODEL}"
  -t "${THREADS}"
  -c "${CTX}"
  -n "${N_PREDICT}"
  --temp "${TEMP}"
  -st -no-cnv
  --ignore-eos
  --perf
  --simple-io
  --no-repack
  -f "${PROMPT}"
)

ts() { date -Iseconds; }
epoch() { date +%s; }

log() {
  local line
  line="$(ts) $*"
  printf '%s\n' "${line}" | tee -a "${OUT}/master.log" >/dev/null
  printf '%s\n' "${line}" >&2
}

status() {
  printf '%s\n' "$*" > "${OUT}/STATUS.txt"
  log "STATUS $*"
}

# termux-battery-status can hang (campaign fact). Hard-timeout via coproc.
batt_json() {
  local tmp="${OUT}/.batt.$$"
  rm -f "${tmp}"
  (termux-battery-status >"${tmp}" 2>/dev/null) &
  local pid=$!
  local i=0
  while [ "${i}" -lt 50 ]; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      wait "${pid}" 2>/dev/null || true
      break
    fi
    sleep 0.1
    i=$((i + 1))
  done
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${tmp}"
    echo ""
    return 1
  fi
  if [ -s "${tmp}" ]; then
    cat "${tmp}"
  else
    echo ""
  fi
  rm -f "${tmp}"
}

# Prints: pct temp_c voltage_mV current_uA plugged status
# temp_c from termux-battery-status is already °C (e.g. 29.9).
batt_fields() {
  local js
  js="$(batt_json || true)"
  if [ -z "${js}" ]; then
    echo "NA NA NA NA NA NA"
    return 1
  fi
  printf '%s\n' "${js}" | awk '
    /"percentage"/ { gsub(/[^0-9]/,"",$2); p=$2 }
    /"temperature"/ { gsub(/[^0-9.]/,"",$2); t=$2 }
    /"voltage"/ { gsub(/[^0-9]/,"",$2); v=$2 }
    /"current"/ && !/"current_average"/ { gsub(/[^0-9-]/,"",$2); c=$2 }
    /"plugged"/ { gsub(/[",]/,"",$2); pl=$2 }
    /"status"/ { gsub(/[",]/,"",$2); st=$2 }
    END { printf "%s %s %s %s %s %s\n", p+0, t+0, v+0, c+0, (pl==""?"NA":pl), (st==""?"NA":st) }
  '
}

# tenths °C from float: 29.9 -> 299
temp_tenths() {
  awk -v t="$1" 'BEGIN { printf "%d", int(t*10 + 0.5) }'
}

assert_unplugged() {
  local pct temp_c volt curr plugged st
  read -r pct temp_c volt curr plugged st <<EOF
$(batt_fields)
EOF
  if [ "${plugged}" != "UNPLUGGED" ]; then
    log "REFUSE: plugged=${plugged} status=${st} (must be UNPLUGGED)"
    status "REFUSE_PLUGGED plugged=${plugged}"
    return 7
  fi
  return 0
}

assert_batt_ge() {
  local need="$1"
  local pct temp_c volt curr plugged st
  read -r pct temp_c volt curr plugged st <<EOF
$(batt_fields)
EOF
  if [ -z "${pct}" ] || [ "${pct}" = "NA" ] || [ "${pct}" -lt "${need}" ]; then
    log "REFUSE: battery ${pct:-unknown}% < ${need}%"
    status "REFUSE_BATT pct=${pct:-unknown} need=${need}"
    return 8
  fi
  log "battery=${pct}% temp=${temp_c}C voltage=${volt}mV current=${curr}uA plugged=${plugged} ${st}"
  return 0
}

sample_row() {
  # $1=csvpath $2=arm $3=phase
  local csv="$1" arm="$2" phase="$3"
  local pct temp_c volt curr plugged st tenths
  read -r pct temp_c volt curr plugged st <<EOF
$(batt_fields)
EOF
  tenths="$(temp_tenths "${temp_c:-0}")"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(ts)" "${arm}" "${phase}" "${pct}" "${temp_c}" "${tenths}" "${volt}" "${curr}" "${plugged}" \
    >> "${csv}"
  printf '%s %s %s\n' "${pct}" "${temp_c}" "${plugged}"
}

# Background 60s sampler. Writes samples.csv and watches abort conditions.
# PID file: ${OUT}/sampler.pid
# Abort flag: ${OUT}/ABORT.txt
start_sampler() {
  local arm="$1"
  local csv="${OUT}/battery_${arm}.csv"
  if [ ! -f "${csv}" ]; then
    echo "ts,arm,phase,batt_pct,temp_c,temp_tenths,voltage_mV,current_uA,plugged" > "${csv}"
  fi
  rm -f "${OUT}/ABORT.txt"
  (
    streak=0
    while true; do
      read -r pct temp_c plugged <<EOF
$(sample_row "${csv}" "${arm}" "arm")
EOF
      # battery floor
      if [ "${pct}" != "NA" ] && [ -n "${pct}" ] && [ "${pct}" -lt "${BATT_ABORT}" ]; then
        echo "ABORT_BATT pct=${pct} temp=${temp_c}" > "${OUT}/ABORT.txt"
        log "GUARD: battery ${pct}% < ${BATT_ABORT}% — abort ${arm}"
        # kill llama-cli if running
        pkill -f "${BIN}/llama-cli" 2>/dev/null || true
        break
      fi
      # thermal: >48C sustained 2 min (2 consecutive 60s samples)
      hot=0
      awk -v t="${temp_c}" -v lim="${TEMP_ABORT_C}" 'BEGIN { exit !(t+0 > lim+0) }' && hot=1 || hot=0
      if [ "${hot}" -eq 1 ]; then
        streak=$((streak + 1))
        log "GUARD: temp ${temp_c}C > ${TEMP_ABORT_C}C streak=${streak}/${TEMP_ABORT_STREAK}"
        if [ "${streak}" -ge "${TEMP_ABORT_STREAK}" ]; then
          echo "ABORT_TEMP temp=${temp_c} streak=${streak}" > "${OUT}/ABORT.txt"
          log "GUARD: temp ${temp_c}C sustained ${streak} min — abort ${arm}"
          pkill -f "${BIN}/llama-cli" 2>/dev/null || true
          break
        fi
      else
        streak=0
      fi
      if [ "${plugged}" != "UNPLUGGED" ] && [ "${plugged}" != "NA" ]; then
        echo "ABORT_PLUGGED plugged=${plugged}" > "${OUT}/ABORT.txt"
        log "GUARD: became plugged=${plugged} — abort ${arm}"
        pkill -f "${BIN}/llama-cli" 2>/dev/null || true
        break
      fi
      sleep "${SAMPLE_EVERY_S}"
    done
  ) >> "${OUT}/sampler_${arm}.log" 2>&1 &
  echo $! > "${OUT}/sampler.pid"
  log "sampler started pid=$(cat "${OUT}/sampler.pid") arm=${arm}"
}

stop_sampler() {
  if [ -f "${OUT}/sampler.pid" ]; then
    local pid
    pid="$(cat "${OUT}/sampler.pid")"
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${OUT}/sampler.pid"
    log "sampler stopped"
  fi
}

parse_generation_tps() {
  local file="$1"
  # Prefer CLI banner: [ Prompt: X t/s | Generation: Y t/s ]
  local gen
  gen="$(grep -oE 'Generation:[[:space:]]*[0-9.]+[[:space:]]*t/s' "${file}" 2>/dev/null | tail -n 1 | grep -oE '[0-9.]+' | head -n 1 || true)"
  if [ -n "${gen}" ]; then
    printf '%s\n' "${gen}"
    return 0
  fi
  # llama_perf_context_print eval line: "tokens per second"
  gen="$(awk '
    /eval time/ && /tokens per second/ {
      for (i=1;i<=NF;i++) if ($i=="tokens") { print $(i-1); found=1 }
    }
    END { if (!found) exit 1 }
  ' "${file}" 2>/dev/null | tail -n 1 || true)"
  if [ -n "${gen}" ]; then
    printf '%s\n' "${gen}"
    return 0
  fi
  printf '\n'
  return 1
}

parse_prompt_tps() {
  local file="$1"
  local pp
  pp="$(grep -oE 'Prompt:[[:space:]]*[0-9.]+[[:space:]]*t/s' "${file}" 2>/dev/null | tail -n 1 | grep -oE '[0-9.]+' | head -n 1 || true)"
  printf '%s\n' "${pp}"
}

parse_eval_tokens() {
  local file="$1"
  # "eval time = 12345.67 ms /  3800 runs"  or n-predict from log
  awk '
    /eval time/ && /runs/ {
      for (i=1;i<=NF;i++) if ($i=="runs" || $i=="runs)") { print $(i-1); exit }
    }
  ' "${file}" 2>/dev/null | tail -n 1
}

aborted() {
  [ -f "${OUT}/ABORT.txt" ]
}

run_arm() {
  local arm="$1"
  shift
  local extra=("$@")
  local seg=0
  local t0
  t0="$(epoch)"
  local deadline=$((t0 + ARM_SECONDS))
  local csv="${OUT}/segments.csv"

  start_sampler "${arm}"
  sample_row "${OUT}/battery_${arm}.csv" "${arm}" "arm_start" >/dev/null || true

  log "ARM ${arm} start t0=$(ts) deadline=+${ARM_SECONDS}s extra=${extra[*]}"

  while true; do
    if aborted; then
      log "ARM ${arm} abort flag: $(cat "${OUT}/ABORT.txt")"
      break
    fi
    local now
    now="$(epoch)"
    if [ "${now}" -ge "${deadline}" ] && [ "${seg}" -ge 1 ]; then
      log "ARM ${arm} reached ${ARM_SECONDS}s after ${seg} segments"
      break
    fi
    # If we already have at least one segment and the next one would start
    # well after the deadline, stop. If still inside the window, launch.
    if [ "${now}" -ge "${deadline}" ]; then
      break
    fi

    seg=$((seg + 1))
    local tag="${arm}_seg$(printf '%02d' "${seg}")"
    local raw="${LOGDIR}/${tag}.log"
    local meta="${LOGDIR}/${tag}.meta"
    local t_start t_end wall
    local pct0 temp0 plugged0
    read -r pct0 temp0 plugged0 <<EOF
$(batt_fields)
EOF

    {
      echo "date=$(ts)"
      echo "arm=${arm}"
      echo "segment=${seg}"
      echo "batt_pct=${pct0}"
      echo "temp_c=${temp0}"
      echo "plugged=${plugged0}"
      printf 'cmd='
      printf '%q ' "${CLI}" "${COMMON_FLAGS[@]}" "${extra[@]}"
      echo
    } > "${meta}"

    log "SEG ${tag} start batt=${pct0}% temp=${temp0}C"
    t_start="$(epoch)"
    set +e
    "${CLI}" "${COMMON_FLAGS[@]}" "${extra[@]}" > "${raw}" 2>&1
    local ec=$?
    set -e
    t_end="$(epoch)"
    wall=$((t_end - t_start))
    echo "exit=${ec}" >> "${meta}"
    echo "wall_s=${wall}" >> "${meta}"
    echo "end=$(ts)" >> "${meta}"

    local gen_tps pp_tps n_eval
    gen_tps="$(parse_generation_tps "${raw}" || true)"
    pp_tps="$(parse_prompt_tps "${raw}" || true)"
    n_eval="$(parse_eval_tokens "${raw}" || true)"
    echo "gen_tps=${gen_tps}" >> "${meta}"
    echo "pp_tps=${pp_tps}" >> "${meta}"
    echo "n_eval=${n_eval}" >> "${meta}"

    local pct1 temp1 plugged1
    read -r pct1 temp1 plugged1 <<EOF
$(batt_fields)
EOF
    echo "batt_pct_end=${pct1}" >> "${meta}"
    echo "temp_c_end=${temp1}" >> "${meta}"

    # User-declared CSV schema: arm, segment, t/s, batt%, temp
    printf '%s,%s,%s,%s,%s\n' "${arm}" "${seg}" "${gen_tps:-}" "${pct1}" "${temp1}" >> "${csv}"
    # Richer sidecar
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
      "${arm}" "${seg}" "${gen_tps:-}" "${pp_tps:-}" "${n_eval:-}" \
      "${wall}" "${pct0}" "${pct1}" "${temp0}" "${temp1}" \
      "${ec}" "$(ts)" "${tag}" \
      >> "${OUT}/segments_detail.csv"

    log "SEG ${tag} end exit=${ec} wall=${wall}s gen=${gen_tps:-NA} t/s batt=${pct0}->${pct1} temp=${temp0}->${temp1}"

    if aborted; then
      log "ARM ${arm} aborted during/after segment ${seg}: $(cat "${OUT}/ABORT.txt")"
      break
    fi
    # no sleep — back-to-back, no intra-arm cooldown
  done

  sample_row "${OUT}/battery_${arm}.csv" "${arm}" "arm_end" >/dev/null || true
  stop_sampler
  log "ARM ${arm} done segments=${seg} wall=$(( $(epoch) - t0 ))s"
}

cooldown_to() {
  local target_c="$1"
  local t0
  t0="$(epoch)"
  local csv="${OUT}/battery_cooldown.csv"
  if [ ! -f "${csv}" ]; then
    echo "ts,arm,phase,batt_pct,temp_c,temp_tenths,voltage_mV,current_uA,plugged" > "${csv}"
  fi
  log "COOLDOWN target<=${target_c}C + ${COOLDOWN_TOL_C}C (sample every ${SAMPLE_EVERY_S}s)"
  status "COOLDOWN target=${target_c}"
  while true; do
    local pct temp_c plugged
    read -r pct temp_c plugged <<EOF
$(sample_row "${csv}" "COOLDOWN" "cooldown")
EOF
    log "COOLDOWN now temp=${temp_c}C batt=${pct}% plugged=${plugged} (target ${target_c}+${COOLDOWN_TOL_C})"
    if awk -v t="${temp_c}" -v tgt="${target_c}" -v tol="${COOLDOWN_TOL_C}" \
        'BEGIN { exit !(t+0 <= tgt+tol+0) }'; then
      log "COOLDOWN reached temp=${temp_c}C"
      return 0
    fi
    if [ $(( $(epoch) - t0 )) -ge "${COOLDOWN_MAX_S}" ]; then
      log "COOLDOWN timeout after ${COOLDOWN_MAX_S}s still ${temp_c}C (need <= ${target_c}+${COOLDOWN_TOL_C})"
      echo "COOLDOWN_TIMEOUT temp=${temp_c} target=${target_c}" > "${OUT}/COOLDOWN_TIMEOUT.txt"
      return 9
    fi
    sleep "${SAMPLE_EVERY_S}"
  done
}

preflight() {
  log "=== PREFLIGHT $(ts) ==="
  log "host=$(uname -a)"
  log "pwd=$(pwd)"
  log "MODEL=${MODEL}"
  log "CLI=${CLI}"
  if [ ! -x "${CLI}" ]; then
    log "REFUSE: llama-cli missing/not executable"
    status "REFUSE_NO_CLI"
    exit 2
  fi
  if [ ! -f "${MODEL}" ]; then
    log "REFUSE: model missing"
    status "REFUSE_NO_MODEL"
    exit 2
  fi
  if [ ! -f "${PROMPT}" ]; then
    log "REFUSE: prompt missing at ${PROMPT}"
    status "REFUSE_NO_PROMPT"
    exit 2
  fi
  {
    echo "=== sha $(ts) ==="
    sha256sum "${CLI}" "${BIN}/libc++_shared.so" "${MODEL}" "${PROMPT}"
    echo "=== llama-cli --version ==="
    "${CLI}" --version || true
  } | tee -a "${OUT}/preflight.txt" >&2

  assert_unplugged || exit $?
  assert_batt_ge "${BATT_START_MIN}" || exit $?
}

init_csvs() {
  if [ ! -f "${OUT}/segments.csv" ]; then
    echo "arm,segment,t/s,batt%,temp" > "${OUT}/segments.csv"
  fi
  if [ ! -f "${OUT}/segments_detail.csv" ]; then
    echo "arm,segment,gen_tps,pp_tps,n_eval,wall_s,batt_start,batt_end,temp_start,temp_end,exit,ts,tag" \
      > "${OUT}/segments_detail.csv"
  fi
}

# --- main ---
MODE="${1:-all}"

# wake lock so the screen-off cpuset does not demote us mid-arm
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
  log "termux-wake-lock acquired"
fi

mkdir -p "${LOGDIR}"
init_csvs

case "${MODE}" in
  preflight)
    preflight
    status "PREFLIGHT_OK"
    ;;
  cpu)
    preflight
    T0_LINE="$(batt_fields)"
    T0_TEMP="$(printf '%s\n' "${T0_LINE}" | awk '{print $2}')"
    printf '%s\n' "${T0_TEMP}" > "${OUT}/t0_temp.txt"
    printf '%s\n' "${T0_LINE}" > "${OUT}/t0_batt.txt"
    log "T0 temp=${T0_TEMP}C fields=${T0_LINE}"
    status "ARM_CPU"
    run_arm ARM_CPU -ngl 0
    status "ARM_CPU_DONE"
    ;;
  cooldown)
    if [ ! -f "${OUT}/t0_temp.txt" ]; then
      log "REFUSE: no T0 temp (run cpu first)"
      exit 2
    fi
    T0_TEMP="$(cat "${OUT}/t0_temp.txt")"
    cooldown_to "${T0_TEMP}" || exit $?
    status "COOLDOWN_DONE"
    ;;
  gpu)
    assert_unplugged || exit $?
    assert_batt_ge "${BATT_ABORT}" || exit $?
    if [ -f "${OUT}/t0_temp.txt" ]; then
      T0_TEMP="$(cat "${OUT}/t0_temp.txt")"
      NOW_TEMP="$(batt_fields | awk '{print $2}')"
      if ! awk -v t="${NOW_TEMP}" -v tgt="${T0_TEMP}" -v tol="${COOLDOWN_TOL_C}" \
          'BEGIN { exit !(t+0 <= tgt+tol+0) }'; then
        log "REFUSE: GPU start temp ${NOW_TEMP}C not within ${COOLDOWN_TOL_C}C of T0 ${T0_TEMP}C — comparison void"
        status "REFUSE_GPU_TEMP now=${NOW_TEMP} t0=${T0_TEMP}"
        exit 9
      fi
    fi
    status "ARM_GPU"
    run_arm ARM_GPU -ngl 99 -fa off
    status "ARM_GPU_DONE"
    ;;
  all)
    preflight
    T0_LINE="$(batt_fields)"
    T0_TEMP="$(printf '%s\n' "${T0_LINE}" | awk '{print $2}')"
    printf '%s\n' "${T0_TEMP}" > "${OUT}/t0_temp.txt"
    printf '%s\n' "${T0_LINE}" > "${OUT}/t0_batt.txt"
    log "T0 temp=${T0_TEMP}C fields=${T0_LINE}"
    status "ARM_CPU"
    run_arm ARM_CPU -ngl 0
    if aborted; then
      status "ABORTED_AFTER_CPU $(cat "${OUT}/ABORT.txt")"
      log "CPU arm aborted; skipping GPU (partial result)"
      exit 10
    fi
    cooldown_to "${T0_TEMP}" || {
      status "COOLDOWN_FAILED — GPU arm not started (comparison would be void)"
      exit 9
    }
    assert_unplugged || exit $?
    # GPU start: still need enough battery to attempt the arm
    if ! assert_batt_ge "${BATT_ABORT}"; then
      status "PARTIAL_CPU_ONLY battery too low for GPU arm — recharge then rerun gpu with same T0 discipline"
      exit 11
    fi
    # If battery is below the *start* gate, we still run GPU if >= abort floor,
    # but record that the session could not cover both arms at the 60% start rule.
    NOW_PCT="$(batt_fields | awk '{print $1}')"
    if [ "${NOW_PCT}" -lt "${BATT_START_MIN}" ]; then
      log "NOTE: GPU start batt=${NOW_PCT}% < ${BATT_START_MIN}% session-start gate; continuing because abort floor is ${BATT_ABORT}% and CPU already ran. Energy comparison still valid if both complete."
    fi
    status "ARM_GPU"
    run_arm ARM_GPU -ngl 99 -fa off
    if aborted; then
      status "ABORTED_DURING_GPU $(cat "${OUT}/ABORT.txt")"
      exit 10
    fi
    status "BOTH_ARMS_DONE"
    log "=== DONE both arms ==="
    ;;
  *)
    echo "usage: $0 {preflight|cpu|cooldown|gpu|all}" >&2
    exit 2
    ;;
esac

if command -v termux-wake-unlock >/dev/null 2>&1; then
  # keep lock if we might continue with another mode; only unlock on all/done
  if [ "${MODE}" = "all" ] || [ "${MODE}" = "gpu" ]; then
    termux-wake-unlock || true
  fi
fi
