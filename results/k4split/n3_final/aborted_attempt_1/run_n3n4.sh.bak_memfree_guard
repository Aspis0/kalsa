#!/data/data/com.termux/files/usr/bin/bash
# K4 N3 burst ABBA + optional N4 marathon. UNPLUGGED only. No python3.
set -u

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="${PREFIX}/bin:${PREFIX}/bin/applets:${PATH}"
export HOME="${HOME:-/data/data/com.termux/files/home}"
export TMPDIR="${PREFIX}/tmp"

WS="${HOME}/gdn_k2/k4split"
BIN="${WS}/bin/bmoe-cli"
LIB="${WS}/bin"
MODEL="${HOME}/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="${LIB}:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

N3="${WS}/logs/n3"
N4="${WS}/logs/n4"
mkdir -p "${N3}" "${N4}" "${N3}/runs" "${N4}/logs"

EXPECTED_BIN_SHA="b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab"
N_PREDICT_N3="${N_PREDICT_N3:-200}"
N_PREDICT_N4="${N_PREDICT_N4:-2048}"
ARM_SECONDS="${ARM_SECONDS:-900}"
BATT_START_MIN="${BATT_START_MIN:-45}"
BATT_ABORT="${BATT_ABORT:-25}"
TEMP_ABORT_C="${TEMP_ABORT_C:-45.0}"
COOLDOWN_TOL_C="${COOLDOWN_TOL_C:-1.0}"
COOLDOWN_MAX_S="${COOLDOWN_MAX_S:-3600}"
SAMPLE_EVERY_S="${SAMPLE_EVERY_S:-60}"
MEMFREE_ABORT_KIB=307200
MEMFREE_STREAK_NEED=12   # 12 x 5s = 60s

COMMON_MOE=(
  -t 4 -c 4096 --moe-stream --cache-mb 1000 --force-cache
  --dense-weights anon --overlap --io-threads 4 --ubatch 512
  --n-expert-used 6 --drop-cold-experts 0.65
  --flash-attn off --temp 0 --seed 42
)

ts() { date -Iseconds; }
epoch() { date +%s; }
log() {
  local line
  line="$(ts) $*"
  printf '%s\n' "${line}" | tee -a "${N3}/master.log" >&2
}

status() {
  printf '%s\n' "$*" > "${N3}/STATUS.txt"
  log "STATUS $*"
}

batt_json() {
  local tmp="${N3}/.batt.$$"
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
  if [ -s "${tmp}" ]; then cat "${tmp}"; else echo ""; fi
  rm -f "${tmp}"
}

# pct temp_c voltage_mV current_uA plugged status
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
  if [ "${pct}" = "NA" ] || [ "${pct}" -lt "${BATT_START_MIN}" ]; then
    log "REFUSE: battery ${pct}% < ${BATT_START_MIN}%"
    status "REFUSE_BATT pct=${pct}"
    return 8
  fi
  log "battery=${pct}% temp=${temp_c}C plugged=${plugged} ${st}"
  return 0
}

cold_model() {
  if [ -x "${HOME}/bin/cold_model.sh" ]; then
    "${HOME}/bin/cold_model.sh" "${MODEL}" || true
  elif [ -x "${HOME}/bin/fadv" ]; then
    "${HOME}/bin/fadv" --dontneed "${MODEL}" 2>/dev/null || true
  fi
}

kill_our_cli() {
  pkill -f "${HOME}/gdn_k2/k4split/bin/bmoe-cli" 2>/dev/null || true
}

# 60s MemFree window (12 x 5s). N1 lesson: 15s is a false kill during OpenCL alloc.
start_mem_sampler() {
  local csv="$1"
  echo "iso,memfree_kib,memavail_kib" > "${csv}"
  rm -f "${N3}/ABORT_RAM.txt"
  (
    bad=0
    while true; do
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      echo "$(ts),${mf},${ma}" >> "${csv}"
      if [ -n "${mf}" ] && [ "${mf}" -lt "${MEMFREE_ABORT_KIB}" ]; then
        bad=$((bad + 1))
        echo "LOW MemFree=${mf} KiB consec=${bad}/${MEMFREE_STREAK_NEED}" >> "${csv}"
        if [ "${bad}" -ge "${MEMFREE_STREAK_NEED}" ]; then
          echo "ABORT MemFree=${mf} KiB < 300 MiB sustained 60s" | tee -a "${csv}"
          echo "ABORT_RAM mf=${mf}" > "${N3}/ABORT_RAM.txt"
          kill_our_cli
          exit 0
        fi
      else
        bad=0
      fi
      sleep 5
    done
  ) >/dev/null 2>&1 &
  echo $! > "${N3}/mem_sampler.pid"
}

stop_mem_sampler() {
  if [ -f "${N3}/mem_sampler.pid" ]; then
    local pid
    pid="$(cat "${N3}/mem_sampler.pid")"
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${N3}/mem_sampler.pid"
  fi
}

start_batt_sampler() {
  local arm="$1"
  local csv="$2"
  if [ ! -f "${csv}" ]; then
    echo "ts,arm,phase,batt_pct,temp_c,voltage_mV,current_uA,plugged" > "${csv}"
  fi
  rm -f "${N3}/ABORT.txt"
  (
    while true; do
      local pct temp_c volt curr plugged st
      read -r pct temp_c volt curr plugged st <<EOF
$(batt_fields)
EOF
      echo "$(ts),${arm},arm,${pct},${temp_c},${volt},${curr},${plugged}" >> "${csv}"
      if [ "${plugged}" != "UNPLUGGED" ] && [ "${plugged}" != "NA" ]; then
        echo "ABORT_PLUGGED plugged=${plugged}" > "${N3}/ABORT.txt"
        kill_our_cli
        break
      fi
      if [ "${pct}" != "NA" ] && [ -n "${pct}" ] && [ "${pct}" -lt "${BATT_ABORT}" ]; then
        echo "ABORT_BATT pct=${pct}" > "${N3}/ABORT.txt"
        kill_our_cli
        break
      fi
      hot=0
      awk -v t="${temp_c}" -v lim="${TEMP_ABORT_C}" 'BEGIN { exit !(t+0 > lim+0) }' && hot=1 || hot=0
      if [ "${hot}" -eq 1 ]; then
        echo "ABORT_TEMP temp=${temp_c}" > "${N3}/ABORT.txt"
        kill_our_cli
        break
      fi
      sleep "${SAMPLE_EVERY_S}"
    done
  ) >> "${N3}/batt_sampler_${arm}.log" 2>&1 &
  echo $! > "${N3}/batt_sampler.pid"
}

stop_batt_sampler() {
  if [ -f "${N3}/batt_sampler.pid" ]; then
    local pid
    pid="$(cat "${N3}/batt_sampler.pid")"
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${N3}/batt_sampler.pid"
  fi
}

parse_metrics() {
  # stdout: decode_tps|prefill_tps|ttft_s|load_s|mib_per_tok|hit_pct|n_gen|n_prefill
  local file="$1"
  awk '
    /generation:/ && /tok\/s/ {
      for (i=1;i<=NF;i++) if ($i=="tokens,") ngen=$(i-1)
      if (match($0, /\(([0-9.]+) tok\/s\)/, a)) dec=a[1]
    }
    /prefill:/ {
      if (match($0, /prefill:[[:space:]]*([0-9]+) tokens,[[:space:]]*([0-9.]+) s \(([0-9.]+) tok\/s\)/, b)) {
        npref=b[1]; pref_s=b[2]; pref_tps=b[3]
      }
      if (match($0, /model load[[:space:]]+([0-9.]+) s/, c)) load=c[1]
      if (match($0, /TTFT[[:space:]]+([0-9.]+) s/, d)) ttft=d[1]
    }
    /moe-stream:/ && /MiB\/token/ {
      if (match($0, /\(([0-9.]+) MiB\/token\)/, e)) mib=e[1]
    }
    /moe-cache:/ && /hit/ {
      if (hit=="" && match($0, /([0-9.]+)% hit/, f)) hit=f[1]
    }
    END {
      printf "%s|%s|%s|%s|%s|%s|%s|%s\n",
        (dec==""?"":dec), (pref_tps==""?"":pref_tps), (ttft==""?"":ttft),
        (load==""?"":load), (mib==""?"":mib), (hit==""?"":hit),
        (ngen==""?"":ngen), (npref==""?"":npref)
    }
  ' "${file}"
}

median() {
  # stdin: one number per line; prints empty if none
  awk '
    NF && $1+0==$1 { a[++n]=$1+0 }
    END {
      if (n==0) { print ""; exit }
      for (i=1;i<=n;i++) for (j=i+1;j<=n;j++) if (a[j]<a[i]) { t=a[i]; a[i]=a[j]; a[j]=t }
      if (n%2) printf "%.6f\n", a[(n+1)/2]
      else printf "%.6f\n", (a[n/2]+a[n/2+1])/2
    }
  '
}

ratio() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    if (a+0<=0 || b+0<=0) { print ""; exit }
    printf "%.4f\n", b/a
  }'
}

# ttft speedup: cpu/split (higher = split faster, lower latency)
ttft_speedup() {
  awk -v cpu="$1" -v split="$2" 'BEGIN {
    if (cpu+0<=0 || split+0<=0) { print ""; exit }
    printf "%.4f\n", cpu/split
  }'
}

run_one() {
  local phase="$1" arm="$2" prompt_id="$3" order="$4" npred="$5" outdir="$6" do_cold="$7"
  shift 7
  local extra=("$@")
  local tag="${phase}_${arm}_${prompt_id}_o${order}"
  local rundir="${outdir}/runs/${tag}"
  mkdir -p "${rundir}"

  local pct0 temp0 volt0 curr0 plugged0 st0
  read -r pct0 temp0 volt0 curr0 plugged0 st0 <<EOF
$(batt_fields)
EOF
  if [ "${plugged0}" != "UNPLUGGED" ]; then
    log "STOP ${tag} plugged=${plugged0}"
    status "STOP_PLUGGED plugged=${plugged0} tag=${tag}"
    return 7
  fi
  if [ "${pct0}" = "NA" ] || [ "${pct0}" -lt "${BATT_ABORT}" ]; then
    log "STOP ${tag} batt=${pct0}"
    status "STOP_BATT pct=${pct0} tag=${tag}"
    return 8
  fi

  if [ "${do_cold}" = "1" ]; then
    log "COLD fadvise before ${tag}"
    cold_model
  else
    log "WARM (no fadvise) ${tag}"
  fi

  local pfile="${WS}/prompts/p_${prompt_id}.txt"
  if [ ! -f "${pfile}" ]; then
    log "REFUSE missing prompt ${pfile}"
    return 2
  fi
  local ptext
  ptext="$(cat "${pfile}")"

  local memcsv="${rundir}/memfree.csv"
  start_mem_sampler "${memcsv}"

  local t0 t1 wall rc
  t0="$(epoch)"
  log "RUN ${tag} n=${npred} batt=${pct0}% temp=${temp0}C extra=${extra[*]}"
  set +e
  "${BIN}" -m "${MODEL}" -p "${ptext}" -n "${npred}" \
    "${COMMON_MOE[@]}" "${extra[@]}" \
    > "${rundir}/stdout.txt" 2> "${rundir}/stderr.txt"
  rc=$?
  set +e
  t1="$(epoch)"
  wall=$((t1 - t0))
  stop_mem_sampler

  cat "${rundir}/stdout.txt" "${rundir}/stderr.txt" > "${rundir}/combo.txt" 2>/dev/null || true

  local pct1 temp1 volt1 curr1 plugged1 st1
  read -r pct1 temp1 volt1 curr1 plugged1 st1 <<EOF
$(batt_fields)
EOF

  local metrics decode_tps prefill_tps ttft_s load_s mib hit n_gen n_pref
  metrics="$(parse_metrics "${rundir}/combo.txt")"
  IFS='|' read -r decode_tps prefill_tps ttft_s load_s mib hit n_gen n_pref <<EOF
${metrics}
EOF

  local mfmin
  mfmin="$(awk -F, 'NR>1 && $2+0>0 { if(min==""||$2+0<min) min=$2+0 } END { if(min=="") print ""; else printf "%.1f", min/1024 }' "${memcsv}")"

  {
    echo "tag=${tag}"
    echo "phase=${phase}"
    echo "arm=${arm}"
    echo "prompt=${prompt_id}"
    echo "order=${order}"
    echo "rc=${rc}"
    echo "wall_s=${wall}"
    echo "decode_tps=${decode_tps}"
    echo "prefill_tps=${prefill_tps}"
    echo "ttft_s=${ttft_s}"
    echo "load_s=${load_s}"
    echo "mib_per_tok=${mib}"
    echo "hit_pct=${hit}"
    echo "n_gen=${n_gen}"
    echo "n_prefill=${n_pref}"
    echo "batt_start=${pct0}"
    echo "batt_end=${pct1}"
    echo "temp_start=${temp0}"
    echo "temp_end=${temp1}"
    echo "plugged_start=${plugged0}"
    echo "plugged_end=${plugged1}"
    echo "memfree_min_mib=${mfmin}"
    echo "end=$(ts)"
  } > "${rundir}/meta.txt"

  tail -n 80 "${rundir}/combo.txt" > "${rundir}/tail.txt" || true
  printf '%s\n' "${BIN}" -m "${MODEL}" -p "<p_${prompt_id}>" -n "${npred}" \
    "${COMMON_MOE[@]}" "${extra[@]}" > "${rundir}/cmdline.txt"

  local csv="${outdir}/runs_speed.csv"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(ts)" "${tag}" "${arm}" "${prompt_id}" "${order}" \
    "${decode_tps}" "${prefill_tps}" "${ttft_s}" "${load_s}" \
    "${mib}" "${hit}" "${n_gen}" "${pct0}" "${pct1}" \
    "${temp0}" "${temp1}" "${wall}" "${rc}" "${mfmin}" "${plugged0}" \
    >> "${csv}"

  log "DONE ${tag} rc=${rc} wall=${wall}s decode=${decode_tps} prefill=${prefill_tps} ttft=${ttft_s} load=${load_s} mib=${mib} hit=${hit} batt=${pct0}->${pct1} temp=${temp0}->${temp1} memfree_min=${mfmin}MiB"

  if [ -f "${N3}/ABORT_RAM.txt" ]; then
    log "RAM abort during ${tag}: $(cat "${N3}/ABORT_RAM.txt")"
    status "ABORT_RAM tag=${tag}"
    return 99
  fi
  if [ -f "${N3}/ABORT.txt" ]; then
    log "GUARD abort during ${tag}: $(cat "${N3}/ABORT.txt")"
    status "ABORT_GUARD tag=${tag} $(cat "${N3}/ABORT.txt")"
    return 10
  fi
  return 0
}

n3_burst() {
  status "N3_RUNNING"
  echo "ts,tag,arm,prompt,order,decode_tps,prefill_tps,ttft_s,load_s,mib_per_tok,hit_pct,n_gen,batt_start,batt_end,temp_start,temp_end,wall_s,rc,memfree_min_mib,plugged" \
    > "${N3}/runs_speed.csv"

  local cpu_flags=(--ngl 0 --moe-cpu-experts off)
  local split_flags=(--ngl 99 --moe-cpu-experts on --override-tensor ffn_gate_inp.weight=CPU)

  # ABBA per prompt: CPU, SPLIT, SPLIT, CPU
  local prompt order
  for prompt in fact creative; do
    log "=== N3 ABBA prompt=${prompt} ==="
    assert_unplugged || return $?
    run_one n3 ARM_CPU   "${prompt}" 1 "${N_PREDICT_N3}" "${N3}" 1 "${cpu_flags[@]}"   || return $?
    assert_unplugged || return $?
    run_one n3 ARM_SPLIT "${prompt}" 2 "${N_PREDICT_N3}" "${N3}" 1 "${split_flags[@]}" || return $?
    assert_unplugged || return $?
    run_one n3 ARM_SPLIT "${prompt}" 3 "${N_PREDICT_N3}" "${N3}" 1 "${split_flags[@]}" || return $?
    assert_unplugged || return $?
    run_one n3 ARM_CPU   "${prompt}" 4 "${N_PREDICT_N3}" "${N3}" 1 "${cpu_flags[@]}"   || return $?
  done

  # Gate: decode median split/cpu >= 1.10 OR TTFT cpu/split >= 1.50
  local med_cpu_dec med_spl_dec med_cpu_ttft med_spl_ttft dec_x ttft_x
  med_cpu_dec="$(awk -F, 'NR>1 && $3=="ARM_CPU" && $6!="" {print $6}' "${N3}/runs_speed.csv" | median)"
  med_spl_dec="$(awk -F, 'NR>1 && $3=="ARM_SPLIT" && $6!="" {print $6}' "${N3}/runs_speed.csv" | median)"
  med_cpu_ttft="$(awk -F, 'NR>1 && $3=="ARM_CPU" && $8!="" {print $8}' "${N3}/runs_speed.csv" | median)"
  med_spl_ttft="$(awk -F, 'NR>1 && $3=="ARM_SPLIT" && $8!="" {print $8}' "${N3}/runs_speed.csv" | median)"
  dec_x="$(ratio "${med_cpu_dec}" "${med_spl_dec}")"
  ttft_x="$(ttft_speedup "${med_cpu_ttft}" "${med_spl_ttft}")"

  {
    echo "n3_cpu_decode_median=${med_cpu_dec}"
    echo "n3_split_decode_median=${med_spl_dec}"
    echo "n3_decode_speedup=${dec_x}"
    echo "n3_cpu_ttft_median=${med_cpu_ttft}"
    echo "n3_split_ttft_median=${med_spl_ttft}"
    echo "n3_ttft_speedup=${ttft_x}"
    echo "gate_decode_need=1.10"
    echo "gate_ttft_need=1.50"
  } | tee "${N3}/gate.txt"

  local pass_dec=0 pass_ttft=0
  awk -v x="${dec_x}" 'BEGIN { exit !(x+0 >= 1.10) }' && pass_dec=1 || pass_dec=0
  awk -v x="${ttft_x}" 'BEGIN { exit !(x+0 >= 1.50) }' && pass_ttft=1 || pass_ttft=0

  if [ "${pass_dec}" -eq 1 ] || [ "${pass_ttft}" -eq 1 ]; then
    echo "N3_GATE=PASS decode_ok=${pass_dec} ttft_ok=${pass_ttft} decode_x=${dec_x} ttft_x=${ttft_x}" | tee -a "${N3}/gate.txt"
    status "N3_PASS decode_x=${dec_x} ttft_x=${ttft_x}"
    return 0
  fi
  echo "N3_GATE=FAIL decode_ok=0 ttft_ok=0 decode_x=${dec_x} ttft_x=${ttft_x}" | tee -a "${N3}/gate.txt"
  status "N3_FAIL_SKIP_N4 decode_x=${dec_x} ttft_x=${ttft_x}"
  return 20
}

n4_cooldown_to() {
  local target_c="$1"
  local t0 now
  t0="$(epoch)"
  local csv="${N4}/battery_cooldown.csv"
  if [ ! -f "${csv}" ]; then
    echo "ts,arm,phase,batt_pct,temp_c,voltage_mV,current_uA,plugged" > "${csv}"
  fi
  log "COOLDOWN target<=${target_c}+${COOLDOWN_TOL_C}C"
  status "N4_COOLDOWN target=${target_c}"
  while true; do
    local pct temp_c volt curr plugged st
    read -r pct temp_c volt curr plugged st <<EOF
$(batt_fields)
EOF
    echo "$(ts),COOLDOWN,cooldown,${pct},${temp_c},${volt},${curr},${plugged}" >> "${csv}"
    log "COOLDOWN temp=${temp_c}C batt=${pct}% plugged=${plugged} target<=${target_c}+${COOLDOWN_TOL_C}"
    if awk -v t="${temp_c}" -v tgt="${target_c}" -v tol="${COOLDOWN_TOL_C}" \
        'BEGIN { exit !(t+0 <= tgt+tol+0) }'; then
      log "COOLDOWN reached temp=${temp_c}C"
      return 0
    fi
    now="$(epoch)"
    if [ $((now - t0)) -ge "${COOLDOWN_MAX_S}" ]; then
      log "COOLDOWN timeout still ${temp_c}C"
      echo "COOLDOWN_TIMEOUT temp=${temp_c} target=${target_c}" > "${N4}/COOLDOWN_TIMEOUT.txt"
      return 9
    fi
    if [ "${plugged}" != "UNPLUGGED" ] && [ "${plugged}" != "NA" ]; then
      log "COOLDOWN became plugged=${plugged}"
      status "STOP_PLUGGED_COOLDOWN plugged=${plugged}"
      return 7
    fi
    sleep "${SAMPLE_EVERY_S}"
  done
}

n4_arm() {
  local arm="$1"
  shift
  local extra=("$@")
  local t0 now deadline seg=0
  t0="$(epoch)"
  deadline=$((t0 + ARM_SECONDS))
  local csv="${N4}/segments.csv"
  local prompt_id="fact"

  start_batt_sampler "${arm}" "${N4}/battery_${arm}.csv"
  log "N4 ARM ${arm} start deadline=+${ARM_SECONDS}s extra=${extra[*]}"
  status "N4_RUNNING ${arm}"

  while true; do
    if [ -f "${N3}/ABORT.txt" ]; then
      log "N4 ${arm} abort: $(cat "${N3}/ABORT.txt")"
      break
    fi
    now="$(epoch)"
    if [ "${now}" -ge "${deadline}" ] && [ "${seg}" -ge 1 ]; then
      log "N4 ${arm} reached ${ARM_SECONDS}s after ${seg} segments"
      break
    fi
    if [ "${now}" -ge "${deadline}" ]; then
      break
    fi
    seg=$((seg + 1))
    local cold=0
    if [ "${seg}" -eq 1 ]; then cold=1; fi
    run_one n4 "${arm}" "${prompt_id}" "${seg}" "${N_PREDICT_N4}" "${N4}" "${cold}" "${extra[@]}" || {
      local rc=$?
      stop_batt_sampler
      return "${rc}"
    }
  done

  stop_batt_sampler
  log "N4 ARM ${arm} done segments=${seg} wall=$(( $(epoch) - t0 ))s"
  echo "${arm},${seg},$(( $(epoch) - t0 ))" >> "${N4}/arm_summary.txt"
  return 0
}

n4_marathon() {
  status "N4_START"
  echo "ts,tag,arm,prompt,order,decode_tps,prefill_tps,ttft_s,load_s,mib_per_tok,hit_pct,n_gen,batt_start,batt_end,temp_start,temp_end,wall_s,rc,memfree_min_mib,plugged" \
    > "${N4}/runs_speed.csv"
  echo "arm,segments,wall_s" > "${N4}/arm_summary.txt"

  local pct0 temp0 volt0 curr0 plugged0 st0
  read -r pct0 temp0 volt0 curr0 plugged0 st0 <<EOF
$(batt_fields)
EOF
  echo "${temp0}" > "${N4}/t0_temp.txt"
  echo "${pct0}" > "${N4}/t0_batt.txt"
  log "N4 T0 temp=${temp0}C batt=${pct0}% (cooldown target T0+${COOLDOWN_TOL_C})"

  local cpu_flags=(--ngl 0 --moe-cpu-experts off)
  local split_flags=(--ngl 99 --moe-cpu-experts on --override-tensor ffn_gate_inp.weight=CPU)

  n4_arm ARM_CPU "${cpu_flags[@]}" || return $?
  n4_cooldown_to "${temp0}" || return $?
  n4_arm ARM_SPLIT "${split_flags[@]}" || return $?

  status "N4_DONE"
  return 0
}

preflight() {
  log "=== PREFLIGHT $(ts) ==="
  if [ ! -x "${BIN}" ]; then
    status "REFUSE_NO_CLI"
    exit 2
  fi
  if [ ! -f "${MODEL}" ]; then
    status "REFUSE_NO_MODEL"
    exit 2
  fi
  local got
  got="$(sha256sum "${BIN}" | awk '{print $1}')"
  echo "${got}" > "${N3}/bin.sha256"
  log "BIN_SHA=${got}"
  case "${got}" in
    "${EXPECTED_BIN_SHA}") log "PIN OK b8b1c732" ;;
    *) log "PIN FAIL expected ${EXPECTED_BIN_SHA}"; status "FAIL_PIN got=${got}"; exit 6 ;;
  esac
  sha256sum "${WS}/prompts/p_fact.txt" "${WS}/prompts/p_creative.txt" | tee "${N3}/prompts.sha256" >&2
  awk '/MemFree:|MemAvailable:|MemTotal:/' /proc/meminfo | tee "${N3}/mem_pre.txt"
  batt_json | tee "${N3}/batt_pre.json" || true
  assert_unplugged || exit $?
}

restore() {
  stop_mem_sampler
  stop_batt_sampler
  termux-wake-unlock >/dev/null 2>&1 || true
}

# --- main ---
termux-wake-lock >/dev/null 2>&1 || true
trap 'restore' EXIT

preflight

n3_burst
n3_rc=$?
if [ "${n3_rc}" -eq 20 ]; then
  log "N3 gate FAIL — skip N4 (honest)"
  echo "N4_SKIPPED_GATE_FAIL" > "${N4}/STATUS.txt"
  status "N3_FAIL_SKIP_N4 $(tr '\n' ' ' < "${N3}/gate.txt")"
  exit 0
fi
if [ "${n3_rc}" -ne 0 ]; then
  log "N3 aborted rc=${n3_rc} — skip N4"
  echo "N4_SKIPPED_N3_ABORT" > "${N4}/STATUS.txt"
  exit "${n3_rc}"
fi

log "N3 gate PASS — starting N4 marathon"
n4_marathon
n4_rc=$?
if [ "${n4_rc}" -ne 0 ]; then
  log "N4 ended rc=${n4_rc}"
  status "N4_FAIL rc=${n4_rc}"
  exit "${n4_rc}"
fi
status "N3N4_DONE"
log "ALL DONE"
exit 0
