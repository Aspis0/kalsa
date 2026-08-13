#!/data/data/com.termux/files/usr/bin/bash
# Bounded waiter: start the marathon only when the pre-declared gate is met.
# Does not start while charging. After unplug, waits for temp to settle.
set -eu

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="${PREFIX}/bin:${PREFIX}/bin/applets:${PATH}"
export HOME="${HOME:-/data/data/com.termux/files/home}"

OUT="${HOME}/gdn_k2/gpu_sustained_4b"
RUN="${OUT}/run_marathon.sh"
LOG="${OUT}/waiter.log"
mkdir -p "${OUT}"

WAIT_MAX_S="${WAIT_MAX_S:-21600}"   # 6 h
POLL_S="${POLL_S:-60}"
START_MIN="${START_MIN:-55}"
SETTLE_MAX_C="${SETTLE_MAX_C:-32.0}"
SETTLE_HARD_C="${SETTLE_HARD_C:-36.0}"

ts() { date -Iseconds; }
log() { printf '%s %s\n' "$(ts)" "$*" | tee -a "${LOG}" >&2; }

batt_json() {
  local tmp="${OUT}/.waiter_batt.$$"
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

fields() {
  local js
  js="$(batt_json || true)"
  if [ -z "${js}" ]; then
    echo "NA NA NA"
    return 1
  fi
  printf '%s\n' "${js}" | awk '
    /"percentage"/ { gsub(/[^0-9]/,"",$2); p=$2 }
    /"temperature"/ { gsub(/[^0-9.]/,"",$2); t=$2 }
    /"plugged"/ { gsub(/[",]/,"",$2); pl=$2 }
    END { printf "%s %s %s\n", p+0, t+0, (pl==""?"NA":pl) }
  '
}

if [ -f "${OUT}/waiter.pid" ]; then
  old="$(cat "${OUT}/waiter.pid")"
  if kill -0 "${old}" 2>/dev/null; then
    log "already running pid=${old}"
    exit 0
  fi
fi
echo $$ > "${OUT}/waiter.pid"
trap 'rm -f "${OUT}/waiter.pid"' EXIT

t0="$(date +%s)"
log "waiter start max=${WAIT_MAX_S}s poll=${POLL_S}s start_min=${START_MIN}%"
echo "WAITER_ARMED" > "${OUT}/STATUS.txt"

unplug_seen=0
while true; do
  now="$(date +%s)"
  if [ $((now - t0)) -ge "${WAIT_MAX_S}" ]; then
    log "TIMEOUT after ${WAIT_MAX_S}s — still below gate"
    echo "WAITER_TIMEOUT" > "${OUT}/STATUS.txt"
    exit 12
  fi
  if pgrep -f "${HOME}/gdn_k2/bin_cpufix/llama-cli" >/dev/null 2>&1; then
    log "llama-cli already running — will not start"
    echo "WAITER_BUSY" > "${OUT}/STATUS.txt"
    exit 13
  fi
  read -r pct temp plugged <<EOF
$(fields)
EOF
  log "poll pct=${pct} temp=${temp}C plugged=${plugged}"
  printf '%s,%s,%s,%s\n' "$(ts)" "${pct}" "${temp}" "${plugged}" >> "${OUT}/waiter_samples.csv"

  if [ "${plugged}" != "UNPLUGGED" ]; then
    unplug_seen=0
    sleep "${POLL_S}"
    continue
  fi
  if [ "${pct}" = "NA" ] || [ "${pct}" -lt "${START_MIN}" ]; then
    sleep "${POLL_S}"
    continue
  fi
  # UNPLUGGED and >=60%. Need temp not still cooking from the charge.
  cool_ok=0
  awk -v t="${temp}" -v lim="${SETTLE_MAX_C}" 'BEGIN { exit !(t+0 <= lim+0) }' && cool_ok=1 || cool_ok=0
  if [ "${cool_ok}" -eq 0 ]; then
    too_hot=0
    awk -v t="${temp}" -v lim="${SETTLE_HARD_C}" 'BEGIN { exit !(t+0 > lim+0) }' && too_hot=1 || too_hot=0
    log "charged enough but temp ${temp}C not settled (want <=${SETTLE_MAX_C}, hard ${SETTLE_HARD_C})"
    if [ "${too_hot}" -eq 1 ]; then
      sleep "${POLL_S}"
      continue
    fi
    # between 32 and 36: require two consecutive unplugged cool-enough polls after first unplug
    unplug_seen=$((unplug_seen + 1))
    if [ "${unplug_seen}" -lt 2 ]; then
      sleep "${POLL_S}"
      continue
    fi
  fi

  log "GATE MET pct=${pct}% temp=${temp}C plugged=${plugged} — starting marathon"
  echo "WAITER_LAUNCHING" > "${OUT}/STATUS.txt"
  exec bash "${RUN}" all
done
