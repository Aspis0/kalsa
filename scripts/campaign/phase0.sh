#!/usr/bin/env bash
# Phase 0 — IMPLEMENT but do not invoke from dry-run.
# Reset flags OFF; R1 6-turn collector+profile+ciswireFlags absent=0;
# R2 mini-conv with winbudget; one web + one calendar tool-request;
# crash/restore drill; per-axis σ from R1 → floors.
set -uo pipefail

campaign_phase0_reset_flags() {
  log "phase0: reset all three flags OFF"
  COMPACTION_VAL=off MEMORY_VAL=0 TOOLHELP_VAL=0 FLAG_PARAMS="" campaign_write_flags
}

# R1 6 turns. Caller supplies first 6 script turns in $1 (script json).
campaign_phase0_r1() {
  local script_json="${1:?}"
  CAMPAIGN_ARM_ID=R1
  CAMPAIGN_VARIANT_ID=B
  CAMPAIGN_CONV_ID=phase0-r1
  COMPACTION_VAL=off MEMORY_VAL=0 TOOLHELP_VAL=0
  campaign_write_flags
  campaign_wipe_chat
  campaign_logcat_clear_arm
  campaign_launch
  campaign_wait_ready || die "phase0 R1: no Pronto"
  log "phase0 R1: 6-turn collector (ciswireFlags absent=0)"
  campaign_run_script_turns "$script_json" 6
}

campaign_phase0_measure_winbudget() {
  local n_ctx log_file winbudget
  log_file="$OUT/logcat.txt"
  n_ctx=""
  if [ -f "$log_file" ]; then
    n_ctx=$(sed -nE 's/.*llama_context: n_ctx[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "$log_file" | tail -1)
  fi
  if [ -z "$n_ctx" ]; then
    n_ctx=$(adb logcat -d </dev/null 2>/dev/null | sed -nE 's/.*llama_context: n_ctx[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' | tail -1) || true
  fi
  [ -n "$n_ctx" ] || die "phase0: n_ctx missing from $log_file and adb logcat -d; cannot calibrate"
  winbudget=$(python3 - "$n_ctx" <<'PY'
import math
import sys

n_ctx = int(sys.argv[1])
budget_tokens = max(0, n_ctx - 2048) * 0.6
char_budget = math.floor(budget_tokens * 3)
print(max(1, math.floor(char_budget / 4)))
PY
  ) || die "phase0: winbudget calculation failed"
  printf '%s\n' "$winbudget" > "$OUT/winbudget.txt"
  printf '%s\n' "$winbudget" > "$(dirname "$OUT")/winbudget.txt"
  PHASE0_WINBUDGET="$winbudget"
  export PHASE0_WINBUDGET
  log "phase0: n_ctx=$n_ctx winbudget=$winbudget"
}

# R2 mini-conv: winbudget set, digest presence, evictionTurn, bit0=1,
# post-eviction per-turn cost.
campaign_phase0_r2() {
  local script_json="${1:?}" winbudget="${2:-512}"
  CAMPAIGN_ARM_ID=R2
  CAMPAIGN_VARIANT_ID=A
  CAMPAIGN_CONV_ID=phase0-r2
  COMPACTION_VAL=ciswire MEMORY_VAL=0 TOOLHELP_VAL=0
  FLAG_PARAMS="kalsa.bench.winbudget=$winbudget"
  campaign_write_flags
  campaign_wipe_chat
  campaign_logcat_clear_arm
  campaign_launch
  campaign_wait_ready || die "phase0 R2: no Pronto"
  log "phase0 R2: mini-conv winbudget=$winbudget (digest, evictionTurn, bit0=1)"
  campaign_run_script_turns "$script_json" 8
}

campaign_phase0_tool_smoke() {
  local script_json="${1:?}"
  log "phase0: one web + one calendar tool-request; gate launch on observed events"
  CAMPAIGN_ARM_ID=R1
  CAMPAIGN_VARIANT_ID=B
  CAMPAIGN_CONV_ID=phase0-tools
  COMPACTION_VAL=off MEMORY_VAL=0 TOOLHELP_VAL=0 FLAG_PARAMS=""
  campaign_write_flags
  campaign_wipe_chat
  campaign_logcat_clear_arm
  campaign_launch
  campaign_wait_ready || die "phase0 tools: no Pronto"
  campaign_run_script_intents "$script_json" "web-request,calendar-request"
}

campaign_phase0_crash_restore() {
  log "phase0: crash/restore drill (force-stop + relaunch, no wipe, kvtranscript=1)"
  local dir="$OUT/phase0-restore-db"
  campaign_pull_db "$dir"
  campaign_restore_same_conv
}

campaign_phase0_floors() {
  log "phase0: per-axis σ from R1 convs → detection floors"
  local prereg="$REPO/campaigns/ciswire/prereg.json"
  node "$CAMPAIGN_ROOT/prereg.mjs" --floors \
    --r1-dir "$OUT/R1" \
    --prereg "$prereg" \
    --out "$OUT/floors.json" \
    || die "phase0 floors failed"
}

# Full phase0. Supervisor calls this only with --phase0.
campaign_phase0() {
  local script_json="${1:?}"
  campaign_phase0_reset_flags
  campaign_phase0_r1 "$script_json"
  campaign_phase0_measure_winbudget
  campaign_phase0_r2 "$script_json" "$PHASE0_WINBUDGET"
  campaign_phase0_tool_smoke "$script_json"
  campaign_phase0_crash_restore
  campaign_phase0_floors
}
