#!/usr/bin/env bash
# Drives one PIANO V4.2 benchmark ARM (Fase 0 or Fase 4) on a KVM-accelerated
# emulator and writes bench-out/result.json. Reuses ci-e2e.sh's proven adb
# idioms via ci-lib.sh (bounds-based tap_node, ui_texts, sql). The APK is
# built ONCE by the workflow's `build` job and downloaded as an artifact —
# this script NEVER rebuilds it: one inference turn already costs ~8.6 min
# on a 2-vCPU runner, a rebuild per arm would blow the job matrix budget.
#
# Env:
#   PHASE          fase0 | fase4                              (required)
#   ARM            free-form label, used only for logging       (required)
#   SEED           replicate index — fase4: 1|2|3, one per matrix job;
#                  fase0: unused (see RUNS_PER_ARM: repeats happen IN this
#                  job so a single result.json can report all of them)
#   BLOCK_FORMAT   kalsa.bench.format value (fase0; see benchConfig.ts for
#                  the real identifiers: none | user-prefix | user-note —
#                  "system-end" exists in code but PIANO V4.2 marks it DEAD,
#                  it is not part of the Fase 0 matrix)
#   THINKING       kalsa.bench.thinking value (both phases)
#   COMPACTION     on|off → kalsa.context.compaction (fase4 only; fase0
#                  always forces "on", see NOTE(fase0-compaction) below)
#   RUNS_PER_ARM   fase0 in-job repeat count (default 3, per PIANO "3 run/formato")
#   MODEL_DIR/MODEL_FILE   as ci-e2e.sh
#   APK_PATH       path to the pre-built release APK (default matches the
#                  standard gradle output path; the workflow downloads the
#                  shared build artifact there)
set -uo pipefail
OUT="bench-out"; mkdir -p "$OUT"

PHASE="${PHASE:?PHASE is required (fase0|fase4)}"
ARM="${ARM:?ARM is required}"
SEED="${SEED:-1}"
BLOCK_FORMAT="${BLOCK_FORMAT:-none}"
THINKING="${THINKING:-off}"
RUNS_PER_ARM="${RUNS_PER_ARM:-3}"
MODEL_FILE="${MODEL_FILE:-Qwen3.5-2B-Q4_K_M.gguf}"
MODEL_DIR="${MODEL_DIR:-qwen3.5-2b}"
APK_PATH="${APK_PATH:-android/app/build/outputs/apk/release/app-release.apk}"
PKG=com.kalsa.app

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

case "$PHASE" in
  fase0)
    # NOTE(fase0-compaction): the operative block (kalsa.bench.format) is only
    # ever injected once the compactor has produced digest/summary content —
    # applyOperativeBlockFormat() in src/engine/LlamaService.ts short-circuits
    # to "no block" when there is nothing to show. Fase 0 therefore runs with
    # compaction ON in every arm so the format axis has something to bite on.
    # CAVEAT (verified by reading src/context/compactor.ts): with production
    # defaults (rebuildEveryKUserTurns=3, recentWindow=6) a bare 3-turn
    # conversation (plant/filler/probe) never crosses a *second* rebuild
    # boundary before the probe, and the background summary job (which only
    # starts at turn K-1=2) cannot finish in time either — so the digest is
    # still effectively empty at the probe turn regardless of format. In
    # practice this cheap 3-turn Fase 0 mostly measures thinking-mode latency
    # and honesty, not true block-format recall. See the delivery report for
    # how to extend this conversation (bump filler turns to reach turn 7) if
    # a real block-content A/B is needed later.
    COMPACTION="on"
    ;;
  fase4)
    COMPACTION="${COMPACTION:?COMPACTION is required for fase4 (on|off)}"
    ;;
  *)
    die "unknown PHASE '$PHASE' (expected fase0|fase4)"
    ;;
esac

log "arm=$ARM phase=$PHASE seed=$SEED format=$BLOCK_FORMAT thinking=$THINKING compaction=$COMPACTION runsPerArm=$RUNS_PER_ARM"

# Fail fast on setup errors — do not burn emulator boot time on a broken input.
[ -f "$APK_PATH" ] || die "APK not found at $APK_PATH (build job artifact missing?)"
[ -f "model.gguf" ] || die "model.gguf not found in cwd (download step missing?)"

install_and_sideload "$APK_PATH" "model.gguf" "$MODEL_DIR" "$MODEL_FILE"

set_prefs() {
  local compaction_val; compaction_val=$([ "$COMPACTION" = "on" ] && echo 1 || echo 0)
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','$compaction_val');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.thinking','$THINKING');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.format','$BLOCK_FORMAT');"
  sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"
}
set_prefs

adb logcat -c

reset_chat() {
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.messages.v1';"
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';"
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';"
}

launch_app() {
  adb shell am start -n $PKG/.MainActivity >/dev/null
  sleep 30
}

# Force-stop, wipe chat state, relaunch → a genuinely fresh conversation.
# Plain "clear the messages key" is not enough: AiChatPage only reads
# kalsa.messages.v1 at mount, so the running React tree would keep showing
# the stale in-memory history without a real process restart.
new_conversation() {
  adb shell am force-stop $PKG; sleep 2
  reset_chat
  launch_app
}

# JSON string escaping (backslash/quote/newline/tab) — replies are natural
# language, not arbitrary binary, so this covers the realistic cases.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

TURNS_JSON=()
PROBES_JSON=()

add_turn() {
  local idx="$1" prompt="$2" elapsed="$3" reply="$4"
  local excerpt="${reply:0:300}"
  local reply_len="${#reply}"
  local esc_excerpt esc_prompt
  esc_excerpt=$(json_escape "$excerpt")
  esc_prompt=$(json_escape "$prompt")
  TURNS_JSON+=("{\"index\":\"$idx\",\"prompt\":\"$esc_prompt\",\"elapsed_s\":$elapsed,\"reply_len\":$reply_len,\"reply_excerpt\":\"$esc_excerpt\"}")
}

add_probe() {
  local name="$1" expected="$2" found="$3"
  PROBES_JSON+=("{\"name\":\"$name\",\"expected\":\"$expected\",\"found\":$found}")
}

# send_and_wait <alphanumeric prompt> <timeout_s>
# `input text` mangles punctuation, so prompts must stay alphanumeric (spaces
# are fine). Sets SAW_REPLY / SAW_ELAPSED on success; returns 1 on any
# failure (composer not found, typing didn't land, or timeout) without ever
# exiting — the caller decides whether that fails the whole arm via die().
send_and_wait() {
  local msg="$1"
  local timeout_s="${2:-1500}"

  local prev_count
  prev_count=$(sql "SELECT substr(value,-30000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" \
    | grep -o '"role":"assistant"' | wc -l | tr -d ' ')

  tap_node "Ask a question…" || { log "composer not found for: $msg"; return 1; }
  sleep 3
  adb shell input text "$msg"
  sleep 3
  if ! dump_ui | grep -qF "$msg"; then
    log "text not visible yet — retrying once"
    tap_node "Ask a question…" || true
    sleep 3
    adb shell input text "$msg"
    sleep 3
  fi
  adb shell input keyevent 111   # ESC: hide IME so bounds are stable
  sleep 2
  if ! ui_texts | grep -qF "$msg"; then
    log "typing did not land in the composer: $msg"
    return 1
  fi

  tap_node "Send" || { log "Send button not found for: $msg"; return 1; }
  local sent_at; sent_at=$(date +%s)
  sleep 5

  SAW_REPLY=""; SAW_ELAPSED=0
  local waited=0 poll_interval=15
  while [ "$waited" -lt "$timeout_s" ]; do
    sleep "$poll_interval"
    waited=$((waited + poll_interval))
    local hist count
    # substr(value,-30000): the LAST 30000 chars, so the newest assistant
    # message (which the regex below greedily anchors on) is never cut off
    # once multi-turn history grows past the old 4000-char head-truncated
    # window ci-e2e.sh used (that was fine for its single-turn smoke test).
    hist=$(sql "SELECT substr(value,-30000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
    count=$(echo "$hist" | grep -o '"role":"assistant"' | wc -l | tr -d ' ')
    if [ "$count" -gt "$prev_count" ]; then
      SAW_REPLY=$(echo "$hist" | sed 's/.*"role":"assistant","text":"//; s/".*//')
      SAW_ELAPSED=$(( $(date +%s) - sent_at ))
      log "reply after ${SAW_ELAPSED}s (len=${#SAW_REPLY}): ${SAW_REPLY:0:200}"
      return 0
    fi
    log "waiting… ${waited}s / ${timeout_s}s"
  done
  log "TIMEOUT waiting for reply to: $msg"
  return 1
}

if [ "$PHASE" = "fase0" ]; then
  PLANT="IlGattoDiMarcoSiChiamaLeopoldo"
  FILLER="ParlamiInBreveDiComeFunzionaInternet"
  PROBE="ComeSiChiamaIlGattoDiMarco"

  for run in $(seq 1 "$RUNS_PER_ARM"); do
    log "=== fase0 run $run/$RUNS_PER_ARM ==="
    new_conversation

    send_and_wait "$PLANT" 1500 || die "run $run: timeout/failure on plant turn"
    add_turn "${run}.1" "$PLANT" "$SAW_ELAPSED" "$SAW_REPLY"

    send_and_wait "$FILLER" 1500 || die "run $run: timeout/failure on filler turn"
    add_turn "${run}.2" "$FILLER" "$SAW_ELAPSED" "$SAW_REPLY"

    send_and_wait "$PROBE" 1500 || die "run $run: timeout/failure on probe turn"
    add_turn "${run}.3" "$PROBE" "$SAW_ELAPSED" "$SAW_REPLY"

    found=false
    printf '%s' "$SAW_REPLY" | grep -qi "leopoldo" && found=true
    add_probe "fact_run${run}" "Leopoldo" "$found"
  done

elif [ "$PHASE" = "fase4" ]; then
  PLANT="MioGattoLeopoldo Budget4500 Scadenza14Marzo ColoreBlu"
  FILLERS=(
    "SpiegaComeFunzionaUnMotoreElettrico"
    "DammiUnaRicettaVelocePerLaCena"
    "QualiSonoIBeneficiDelloSportRegolare"
    "RaccontaUnaCuriositaSulloSpazio"
    "ComeSiOrganizzaUnViaggioInTreno"
    "SpiegaLaDifferenzaTraClimaEMeteo"
  )
  PROBE1="ComeSiChiamaIlMioGatto"
  PROBE2="QualEIlBudgetCheTiHoDetto"

  new_conversation

  send_and_wait "$PLANT" 1500 || die "timeout/failure on plant turn"
  add_turn 1 "$PLANT" "$SAW_ELAPSED" "$SAW_REPLY"

  for i in "${!FILLERS[@]}"; do
    msg="${FILLERS[$i]}"
    turn_idx=$((i + 2))
    send_and_wait "$msg" 1500 || die "timeout/failure on filler turn $turn_idx"
    add_turn "$turn_idx" "$msg" "$SAW_ELAPSED" "$SAW_REPLY"
  done

  send_and_wait "$PROBE1" 1500 || die "timeout/failure on probe turn 8"
  add_turn 8 "$PROBE1" "$SAW_ELAPSED" "$SAW_REPLY"
  found1=false
  printf '%s' "$SAW_REPLY" | grep -qi "leopoldo" && found1=true
  add_probe "cat_name" "Leopoldo" "$found1"

  send_and_wait "$PROBE2" 1500 || die "timeout/failure on probe turn 9"
  add_turn 9 "$PROBE2" "$SAW_ELAPSED" "$SAW_REPLY"
  found2=false
  printf '%s' "$SAW_REPLY" | grep -q "4500" && found2=true
  add_probe "budget" "4500" "$found2"
fi

total_probes=${#PROBES_JSON[@]}
found_probes=0
if [ "$total_probes" -gt 0 ]; then
  found_probes=$(printf '%s\n' "${PROBES_JSON[@]}" | grep -c '"found":true' || true)
fi
RECALL=$(awk "BEGIN{ if ($total_probes==0) print 0; else printf \"%.4f\", $found_probes/$total_probes }")

adb logcat -d | grep -iE "RNLlama|llama|ReactNativeJS" | tail -200 > "$OUT/logcat.txt" 2>/dev/null
sql "SELECT substr(value,-30000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" > "$OUT/history_final.json"

{
  echo "{"
  echo "  \"phase\": \"$PHASE\","
  echo "  \"arm\": \"$ARM\","
  echo "  \"seed\": $SEED,"
  echo "  \"blockFormat\": \"$BLOCK_FORMAT\","
  echo "  \"thinking\": \"$THINKING\","
  echo "  \"compaction\": \"$COMPACTION\","
  printf '  "turns": [%s],\n' "$(IFS=,; echo "${TURNS_JSON[*]}")"
  printf '  "probes": [%s],\n' "$(IFS=,; echo "${PROBES_JSON[*]}")"
  echo "  \"recall\": $RECALL"
  echo "}"
} > "$OUT/result.json"

{
  echo "phase=$PHASE arm=$ARM seed=$SEED format=$BLOCK_FORMAT thinking=$THINKING compaction=$COMPACTION"
  echo "recall=$RECALL ($found_probes/$total_probes probes)"
} > "$OUT/RESULT.txt"
cat "$OUT/RESULT.txt"

log "PASS: arm $ARM completed, result.json written"
