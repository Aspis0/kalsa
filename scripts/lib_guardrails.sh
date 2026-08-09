#!/usr/bin/env bash
# lib_guardrails.sh — guardrail termico + memoria per harness di campagna
#
# Ricalibrati dopo riavvio #2 (2026-08-08 ~20:51, rescueparty sotto die~90 + OOM):
#   - HARD STOP a 98 °C non è mai scattato: il telefono muore / RescueParty a ~90.
#   - Limite operativo termico: die > 88 °C sostenuto 60 s → PAUSA.
#   - MemFree < 100 MiB sostenuto 10 s → ABORT_MEM della cella.
#
# Uso (dopo aver definito max_die_mc / mc_to_c / log / FLIGHT_LOG / STATUS / OUTDIR):
#   source lib_guardrails.sh
#   guardrails_reset
#   # in un loop di sample ogni ~0.5 s:
#   guardrail_tick "$die_mc" "$mf_kb"   # setta GR_ACTION
#   case "$GR_ACTION" in
#     CONTINUE) ;;
#     PAUSE_THERMAL) ... kill bmoe; guardrail_thermal_wait_cool; ;;
#     ABORT_MEM) ... kill bmoe; guardrail_abort_mem; ;;
#     HARD_DIE) ... kill bmoe; ;;
#   esac
#
# shellcheck shell=bash

# --- soglie (mc = milli-°C come da sysfs thermal_zone) ---
DIE_PAUSE_MC="${DIE_PAUSE_MC:-88000}"       # 88 °C
DIE_RESUME_MC="${DIE_RESUME_MC:-80000}"     # 80 °C
DIE_PAUSE_HOLD_S="${DIE_PAUSE_HOLD_S:-60}"  # secondi sostenuti sopra 88
DIE_STOP_MC="${DIE_STOP_MC:-98000}"         # HARD STOP legacy 98 °C
MEM_ABORT_KB="${MEM_ABORT_KB:-102400}"      # 100 MiB
MEM_ABORT_HOLD_S="${MEM_ABORT_HOLD_S:-10}"  # secondi sostenuti sotto 100 MiB
GR_SAMPLE_DT_S="${GR_SAMPLE_DT_S:-0.5}"     # periodo del sampler che chiama tick

# streak accumulati (secondi stimati)
GR_HOT_S=0
GR_LOW_MF_S=0
GR_ACTION=CONTINUE
GR_LAST_DETAIL=""

guardrails_reset() {
  GR_HOT_S=0
  GR_LOW_MF_S=0
  GR_ACTION=CONTINUE
  GR_LAST_DETAIL=""
}

# Scrive una riga evento nel flight.log (e nel master se log() esiste).
# Formato: GUARDRAIL,<epoch>,<iso>,<EVENT>,<detail>
flight_guardrail_log() {
  local event="$1"
  shift
  local detail="$*"
  local now iso line
  now=$(date +%s.%N 2>/dev/null || date +%s)
  iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
  line="GUARDRAIL,${now},${iso},${event},${detail}"
  if [ -n "${FLIGHT_LOG:-}" ]; then
    echo "$line" >> "$FLIGHT_LOG" || true
    # best-effort fsync
    if command -v python3 >/dev/null 2>&1; then
      python3 -c "import os; f=open(r'''$FLIGHT_LOG''','a'); os.fsync(f.fileno()); f.close()" 2>/dev/null || true
    fi
  fi
  if type log >/dev/null 2>&1; then
    log "$line"
  else
    echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $line" >&2
  fi
}

# Valuta un sample. Imposta GR_ACTION in {CONTINUE,PAUSE_THERMAL,ABORT_MEM,HARD_DIE}.
# Arg: die_mc (milli-C o C*1000), mf_kb (MemFree kB).
guardrail_tick() {
  local die_mc="${1:-0}"
  local mf_kb="${2:-0}"
  local dt="${GR_SAMPLE_DT_S}"
  GR_ACTION=CONTINUE
  GR_LAST_DETAIL=""

  # HARD 98 resta
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    GR_ACTION=HARD_DIE
    GR_LAST_DETAIL="die_mc=$die_mc thr=$DIE_STOP_MC"
    return 0
  fi

  # Termico operativo 88 °C
  if [ "$die_mc" -gt "$DIE_PAUSE_MC" ] 2>/dev/null; then
    # awk per sommare float secondi
    GR_HOT_S=$(awk -v a="$GR_HOT_S" -v d="$dt" 'BEGIN{printf "%.1f", a+d}')
  else
    GR_HOT_S=0
  fi
  if awk -v a="$GR_HOT_S" -v h="$DIE_PAUSE_HOLD_S" 'BEGIN{exit !(a+0>=h+0)}'; then
    GR_ACTION=PAUSE_THERMAL
    GR_LAST_DETAIL="die_mc=$die_mc hot_s=$GR_HOT_S thr_mc=$DIE_PAUSE_MC hold_s=$DIE_PAUSE_HOLD_S"
    return 0
  fi

  # Memoria 100 MiB
  if [ "$mf_kb" -gt 0 ] 2>/dev/null && [ "$mf_kb" -lt "$MEM_ABORT_KB" ] 2>/dev/null; then
    GR_LOW_MF_S=$(awk -v a="$GR_LOW_MF_S" -v d="$dt" 'BEGIN{printf "%.1f", a+d}')
  else
    GR_LOW_MF_S=0
  fi
  if awk -v a="$GR_LOW_MF_S" -v h="$MEM_ABORT_HOLD_S" 'BEGIN{exit !(a+0>=h+0)}'; then
    GR_ACTION=ABORT_MEM
    GR_LAST_DETAIL="mf_kb=$mf_kb low_s=$GR_LOW_MF_S thr_kb=$MEM_ABORT_KB hold_s=$MEM_ABORT_HOLD_S"
    return 0
  fi
}

# Attende die < 80 °C (o timeout). Logga PAUSE start/end.
# Ritorna 0 se raffreddato, 1 se timeout.
guardrail_thermal_wait_cool() {
  local timeout_s="${1:-600}"
  local t0 now die_mc die_c
  t0=$(date +%s)
  flight_guardrail_log "THERMAL_PAUSE_WAIT" "resume_below_mc=$DIE_RESUME_MC timeout_s=$timeout_s ${GR_LAST_DETAIL}"
  while :; do
    die_mc=$(max_die_mc 2>/dev/null || echo 0)
    die_c=$(mc_to_c "$die_mc" 2>/dev/null || echo "?")
    if [ "$die_mc" -le "$DIE_RESUME_MC" ] 2>/dev/null; then
      flight_guardrail_log "THERMAL_PAUSE_COOL_OK" "die_c=$die_c"
      GR_HOT_S=0
      return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge "$timeout_s" ]; then
      flight_guardrail_log "THERMAL_PAUSE_TIMEOUT" "die_c=$die_c waited_s=$((now - t0))"
      return 1
    fi
    sleep 5
  done
}

# Marca ABORT_MEM nello STATUS e STOP_REASON; logga su flight.
guardrail_abort_mem() {
  local detail="${1:-$GR_LAST_DETAIL}"
  flight_guardrail_log "ABORT_MEM" "$detail"
  if [ -n "${STATUS:-}" ]; then
    echo "ABORT_MEM $(date '+%Y-%m-%dT%H:%M:%S%z') $detail" > "$STATUS"
  fi
  if [ -n "${OUTDIR:-}" ]; then
    echo "ABORT_MEM" > "$OUTDIR/STOP_REASON.txt"
  fi
}

# Marca PAUSE termica scattata.
guardrail_mark_thermal_pause() {
  local detail="${1:-$GR_LAST_DETAIL}"
  flight_guardrail_log "THERMAL_PAUSE" "$detail"
  if [ -n "${STATUS:-}" ]; then
    echo "THERMAL_PAUSE $(date '+%Y-%m-%dT%H:%M:%S%z') $detail" > "$STATUS"
  fi
  if [ -n "${OUTDIR:-}" ]; then
    echo "THERMAL_PAUSE" > "$OUTDIR/STOP_REASON.txt"
  fi
}

# Marca HARD die 98.
guardrail_mark_hard_die() {
  local detail="${1:-$GR_LAST_DETAIL}"
  flight_guardrail_log "HARD_STOP_DIE" "$detail"
  if [ -n "${STATUS:-}" ]; then
    echo "HARD_STOP_DIE $(date '+%Y-%m-%dT%H:%M:%S%z') $detail" > "$STATUS"
  fi
  if [ -n "${OUTDIR:-}" ]; then
    echo "DIE_98" > "$OUTDIR/STOP_REASON.txt"
  fi
}

# Helper per sampler: dato BPID + opfx, applica azione (kill) e scrive KILL.txt.
# Ritorna: 0=continue, 97=thermal_pause, 96=abort_mem, 99=hard_die
guardrail_apply_to_pid() {
  local bpid="$1"
  local opfx="${2:-}"
  case "$GR_ACTION" in
    CONTINUE) return 0 ;;
    PAUSE_THERMAL)
      guardrail_mark_thermal_pause
      if [ -n "$opfx" ]; then
        echo "THERMAL_PAUSE ${GR_LAST_DETAIL} $(date -Iseconds)" >> "${opfx}.KILL.txt"
      fi
      kill -TERM "$bpid" 2>/dev/null || true
      sleep 1
      kill -KILL "$bpid" 2>/dev/null || true
      return 97
      ;;
    ABORT_MEM)
      guardrail_abort_mem
      if [ -n "$opfx" ]; then
        echo "ABORT_MEM ${GR_LAST_DETAIL} $(date -Iseconds)" >> "${opfx}.KILL.txt"
      fi
      kill -TERM "$bpid" 2>/dev/null || true
      sleep 1
      kill -KILL "$bpid" 2>/dev/null || true
      return 96
      ;;
    HARD_DIE)
      guardrail_mark_hard_die
      if [ -n "$opfx" ]; then
        echo "DIE_98 ${GR_LAST_DETAIL} $(date -Iseconds)" >> "${opfx}.KILL.txt"
      fi
      kill -TERM "$bpid" 2>/dev/null || true
      sleep 1
      kill -KILL "$bpid" 2>/dev/null || true
      return 99
      ;;
  esac
  return 0
}
