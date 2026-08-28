#!/usr/bin/env bash
# Force-stop THEN sql_write flags + params + compaction.choice + kvtranscript.
# Compaction literals: off|anchored|ciswire ONLY. Reject on/1/true.
# sql_write DIES if the app is running — force-stop is mandatory, not optional.
#
# Source from supervisor (ci-lib already loaded). Not a CLI.
set -uo pipefail

# campaign_validate_compaction <value>
# Pure. Exit 0 only for off|anchored|ciswire.
campaign_validate_compaction() {
  case "${1-}" in
    off|anchored|ciswire) return 0 ;;
    *)
      echo "REJECT compaction=${1-} (must be off|anchored|ciswire; on/1/true → anchored, not ciswire)" >&2
      return 1
      ;;
  esac
}

# campaign_validate_bit <value> <name>
campaign_validate_bit() {
  case "${1-}" in
    0|1) return 0 ;;
    *)
      echo "REJECT ${2-flag}=${1-} (must be 0|1)" >&2
      return 1
      ;;
  esac
}

_campaign_sql_put() {
  local key="$1" val="$2" esc
  esc=$(printf '%s' "$val" | sed "s/'/''/g")
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('$key','$esc');" "$key" "$val"
}

_campaign_sql_del() {
  local key="$1"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='$key';" "$key" "__ABSENT__"
}

# campaign_force_stop
campaign_force_stop() {
  adb shell am force-stop "$PKG" </dev/null >/dev/null 2>&1 || true
  sleep 2
}

# campaign_write_flags
# Env:
#   COMPACTION_VAL  off|anchored|ciswire
#   MEMORY_VAL      0|1
#   TOOLHELP_VAL    0|1
#   MODEL_ID        (optional)
#   FLAG_PARAMS     newline key=value (empty value → delete). PHASE0 sentinel
#                   for winbudget is resolved via PHASE0_WINBUDGET or fails.
# Always writes compaction.choice=1 and kalsa.bench.kvtranscript=1.
# Always DELETEs kalsa.bench.toolchoice (auto = absent).
# Does not write thinking unless THINKING_VAL is set.
campaign_write_flags() {
  campaign_validate_compaction "${COMPACTION_VAL:?}" || die "bad compaction"
  campaign_validate_bit "${MEMORY_VAL:?}" "kalsa.memory.enabled" || die "bad memory"
  campaign_validate_bit "${TOOLHELP_VAL:?}" "kalsa.ciswire.toolhelp" || die "bad toolhelp"

  log "flags: force-stop $PKG before sql_write"
  campaign_force_stop

  _campaign_sql_put "kalsa.context.compaction" "$COMPACTION_VAL"
  _campaign_sql_put "kalsa.context.compaction.choice" "1"
  _campaign_sql_put "kalsa.memory.enabled" "$MEMORY_VAL"
  _campaign_sql_put "kalsa.ciswire.toolhelp" "$TOOLHELP_VAL"
  _campaign_sql_put "kalsa.bench.kvtranscript" "1"
  _campaign_sql_del "kalsa.bench.toolchoice"
  if [ -n "${LOCALE_VAL:-}" ]; then
    _campaign_sql_put "kalsa.locale" "$LOCALE_VAL"
  fi
  if [ -n "${MODEL_ID:-}" ]; then
    _campaign_sql_put "kalsa.model.id" "$MODEL_ID"
  fi
  if [ -n "${THINKING_VAL:-}" ]; then
    _campaign_sql_put "kalsa.bench.thinking" "$THINKING_VAL"
  fi

  local line key val budget_file
  while IFS= read -r line || [ -n "${line-}" ]; do
    [ -z "${line-}" ] && continue
    key="${line%%=*}"
    val="${line#*=}"
    if [ "$key" = "kalsa.bench.winbudget" ] && [ "$val" = "PHASE0" ]; then
      if [ -z "${PHASE0_WINBUDGET:-}" ]; then
        if [ -n "${OUT:-}" ] && [ -f "$OUT/winbudget.txt" ]; then
          budget_file="$OUT/winbudget.txt"
        elif [ -n "${OUT:-}" ] && [ -f "$(dirname "$OUT")/winbudget.txt" ]; then
          budget_file="$(dirname "$OUT")/winbudget.txt"
        else
          die "variant A winbudget=PHASE0 but PHASE0_WINBUDGET unset and winbudget.txt missing (run --phase0 first)"
        fi
        PHASE0_WINBUDGET=$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$budget_file")
      fi
      val=$(printf '%s' "$PHASE0_WINBUDGET" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      case "$val" in
        ''|*[!0-9]*)
          die "variant A winbudget=PHASE0 must be a non-empty integer"
          ;;
      esac
    fi
    if [ -z "$val" ]; then
      _campaign_sql_del "$key"
    else
      _campaign_sql_put "$key" "$val"
    fi
  done <<EOF
${FLAG_PARAMS-}
EOF

  campaign_verify_flags
}

campaign_verify_flags() {
  local got
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction';" | head -1 | tr -d '[:space:]')
  [ "$got" = "$COMPACTION_VAL" ] || die "readback compaction='$got' expected '$COMPACTION_VAL'"
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction.choice';" | head -1 | tr -d '[:space:]')
  [ "$got" = "1" ] || die "readback compaction.choice='$got' expected 1"
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.memory.enabled';" | head -1 | tr -d '[:space:]')
  [ "$got" = "$MEMORY_VAL" ] || die "readback memory='$got' expected '$MEMORY_VAL'"
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.ciswire.toolhelp';" | head -1 | tr -d '[:space:]')
  [ "$got" = "$TOOLHELP_VAL" ] || die "readback toolhelp='$got' expected '$TOOLHELP_VAL'"
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.kvtranscript';" | head -1 | tr -d '[:space:]')
  [ "$got" = "1" ] || die "readback kvtranscript='$got' expected 1"
  got=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.toolchoice';" | head -1 | tr -d '[:space:]')
  [ -z "$got" ] || die "readback toolchoice='$got' expected ABSENT"
  log "flags readback ok compaction=$COMPACTION_VAL memory=$MEMORY_VAL toolhelp=$TOOLHELP_VAL"
}

# Unit entry: bash scripts/campaign/flags.sh --selftest  (no device)
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1-}" = "--selftest" ]; then
  set -euo pipefail
  campaign_validate_compaction off
  campaign_validate_compaction anchored
  campaign_validate_compaction ciswire
  campaign_validate_compaction on && { echo "FAIL: on accepted"; exit 1; } || true
  campaign_validate_compaction 1 && { echo "FAIL: 1 accepted"; exit 1; } || true
  campaign_validate_compaction true && { echo "FAIL: true accepted"; exit 1; } || true
  echo "flags.sh selftest ok"
  exit 0
fi
