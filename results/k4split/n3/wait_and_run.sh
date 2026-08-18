#!/data/data/com.termux/files/usr/bin/bash
# K4 N3/N4 waiter: start speed work ONLY when UNPLUGGED, batt>=45%, temp<=35C.
# 6h window. Timeout still plugged -> ARMED_EXPIRED. Never measures while charging.
set -eu

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="${PREFIX}/bin:${PREFIX}/bin/applets:${PATH}"
export HOME="${HOME:-/data/data/com.termux/files/home}"

WS="${HOME}/gdn_k2/k4split"
OUT="${WS}/logs/n3"
RUN="${WS}/n3/run_n3n4.sh"
LOG="${OUT}/waiter.log"
mkdir -p "${OUT}" "${WS}/logs/n4"

WAIT_MAX_S="${WAIT_MAX_S:-21600}"   # 6 h
POLL_S="${POLL_S:-60}"
START_MIN="${START_MIN:-45}"
SETTLE_MAX_C="${SETTLE_MAX_C:-35.0}"

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

busy_inference() {
  # Match real binaries only — not this waiter's own argv.
  if [ -d /proc ]; then
    for d in /proc/[0-9]*; do
      [ -r "${d}/cmdline" ] || continue
      tr '\0' ' ' < "${d}/cmdline" 2>/dev/null | grep -qE 'gdn_k2/k4split/bin/bmoe-cli|/llama-cli( |$)|bmoe-cli.CAMPAIGN' || continue
      tr '\0' ' ' < "${d}/cmdline" 2>/dev/null | grep -qE 'wait_and_run|run_n3n4' && continue
      return 0
    done
  fi
  return 1
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
log "waiter start max=${WAIT_MAX_S}s poll=${POLL_S}s start_min=${START_MIN}% temp<=${SETTLE_MAX_C}C"
echo "WAITER_ARMED" > "${OUT}/STATUS.txt"
printf '%s\n' "iso,pct,temp_c,plugged" > "${OUT}/waiter_samples.csv"

while true; do
  now="$(date +%s)"
  if [ $((now - t0)) -ge "${WAIT_MAX_S}" ]; then
    log "TIMEOUT after ${WAIT_MAX_S}s — still below gate (plugged or batt/temp)"
    echo "ARMED_EXPIRED" > "${OUT}/STATUS.txt"
    exit 12
  fi
  if busy_inference; then
    log "inference already running — will not start"
    echo "WAITER_BUSY" > "${OUT}/STATUS.txt"
    exit 13
  fi
  read -r pct temp plugged <<EOF
$(fields)
EOF
  log "poll pct=${pct} temp=${temp}C plugged=${plugged}"
  printf '%s,%s,%s,%s\n' "$(ts)" "${pct}" "${temp}" "${plugged}" >> "${OUT}/waiter_samples.csv"

  if [ "${plugged}" != "UNPLUGGED" ]; then
    sleep "${POLL_S}"
    continue
  fi
  if [ "${pct}" = "NA" ] || [ "${pct}" -lt "${START_MIN}" ]; then
    log "unplugged but batt ${pct}% < ${START_MIN}%"
    sleep "${POLL_S}"
    continue
  fi
  cool_ok=0
  awk -v t="${temp}" -v lim="${SETTLE_MAX_C}" 'BEGIN { exit !(t+0 <= lim+0) }' && cool_ok=1 || cool_ok=0
  if [ "${cool_ok}" -eq 0 ]; then
    log "unplugged batt=${pct}% but temp ${temp}C > ${SETTLE_MAX_C}C — waiting"
    sleep "${POLL_S}"
    continue
  fi

  log "GATE MET pct=${pct}% temp=${temp}C plugged=${plugged} — starting N3"
  echo "WAITER_LAUNCHING" > "${OUT}/STATUS.txt"
  if [ ! -x "${RUN}" ]; then
    log "REFUSE: runner missing ${RUN}"
    echo "REFUSE_NO_RUNNER" > "${OUT}/STATUS.txt"
    exit 2
  fi
  exec bash "${RUN}"
done
