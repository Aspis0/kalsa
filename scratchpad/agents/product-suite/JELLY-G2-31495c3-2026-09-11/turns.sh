#!/usr/bin/env bash
# Jelly G2 31495c3: 10 Italian turns then stop. Abort a turn after 180s with no tokens.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
case "$ANDROID_SERIAL" in 192.168.1.152*|192.168.1.193*) echo refuse; exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-G2-31495c3-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
FLOG="$EVID/logcat-full.txt"
RUN="$EVID/turns.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[turns] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$(adb shell pidof com.kalsa.app | tr -d '\r')"

tel_user_count() {
  grep 'KALSA_TELEMETRY' "$FLOG" | grep -v util-extractMemory | grep -c '"turnId"' || true
}

wait_turn() {
  local before="$1" t=0 thinking=0
  while [ "$t" -lt 360 ]; do
    if grep -q 'KALSA_STALL' "$FLOG"; then
      rlog STALL
      return 2
    fi
    if grep 'KALSA_THINKING' "$FLOG" | tail -1 | grep -q 'budget'; then
      thinking=1
    fi
    local now
    now=$(tel_user_count)
    if [ "${now:-0}" -gt "$before" ]; then
      rlog "telemetry after ${t}s count=$now"
      grep 'KALSA_TELEMETRY' "$FLOG" | grep -v util-extractMemory | tail -1 | tee -a "$RUN"
      grep 'KALSA_THINKING' "$FLOG" | tail -1 | tee -a "$RUN"
      return 0
    fi
    if [ "$t" -ge 180 ] && [ "$thinking" -eq 0 ]; then
      rlog "NO_TOKENS_3MIN — tapping Ferma"
      tap_node "Ferma" 2>/dev/null || tap_node "Stop" 2>/dev/null || true
      return 3
    fi
    sleep 2
    t=$((t + 2))
  done
  rlog TIMEOUT_TURN
  tap_node "Ferma" 2>/dev/null || true
  return 1
}

MSGS=(
  "Dimmi solo: sì."
  "Quanti giorni ha una settimana? Una sola parola."
  "Scrivi due frasi brevi sul caffè, in italiano."
  "Usa lo strumento calcolatrice con expression='18+7'. Rispondi solo col numero."
  "Di' solo: pronto."
  "Elenca tre colori in italiano, uno per riga, nient'altro."
  "Quanto fa due più due? Solo il numero."
  "Una frase sul mare, in italiano."
  "Di' solo: fine."
  "Rispondi con una sola parola: ciao."
)

n=0
ok=0
for msg in "${MSGS[@]}"; do
  n=$((n + 1))
  before=$(tel_user_count)
  case "$before" in ''|*[!0-9]*) before=0 ;; esac
  rlog "TURN $n before_tel=$before msg=$msg utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  device_collapse_shade || true
  if ! device_share_send "$msg"; then
    rlog "FAIL send turn $n"
    echo "$n" > "$EVID/turns-completed.txt"
    exit 1
  fi
  if ! wait_turn "$before"; then
    rc=$?
    rlog "turn $n wait rc=$rc"
    echo "$n" > "$EVID/turns-completed.txt"
    exit "$rc"
  fi
  ok=$((ok + 1))
  rlog "TURN $n done"
done
echo "$ok" > "$EVID/turns-completed.txt"
rlog "all $ok turns done utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
grep -E 'KALSA_THINKING|KALSA_TELEMETRY|KALSA_TOOL|tool' "$FLOG" | grep -v util-extractMemory | tail -80 > "$EVID/turns-excerpt.txt" || true
