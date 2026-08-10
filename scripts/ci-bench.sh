#!/usr/bin/env bash
# Drives one PIANO V4.2 benchmark ARM (Fase 0, Fase 4, or smoke) on a
# KVM-accelerated emulator and writes bench-out/raw.json (+ graded
# result.json via benchGrade.mjs). Reuses ci-e2e.sh's proven adb idioms via
# ci-lib.sh (bounds-based tap_node, ui_texts, sql). The APK is built ONCE by
# the workflow's `build` job and downloaded as an artifact — this script
# NEVER rebuilds it: one inference turn already costs ~8.6 min on a 2-vCPU
# runner, a rebuild per arm would blow the job matrix budget.
#
# Env:
#   PHASE          fase0 | fase4 | smoke                      (required)
#   ARM            free-form label, used only for logging       (required)
#   SEED           replicate index — fase4/smoke: 1|2|3, one per matrix
#                  job; also rotates filler order (paired design).
#                  fase0: unused for rotation (see RUNS_PER_ARM)
#   BLOCK_FORMAT   kalsa.bench.format value (fase0; see benchConfig.ts for
#                  the real identifiers: none | user-prefix | user-note —
#                  "system-end" exists in code but PIANO V4.2 marks it DEAD,
#                  it is not part of the Fase 0 matrix)
#   THINKING       kalsa.bench.thinking value (both phases)
#   COMPACTION     on|off → kalsa.context.compaction (fase4/smoke only;
#                  fase0 always forces "on", see NOTE(fase0-compaction))
#   RUNS_PER_ARM   fase0 in-job repeat count (default 3, per PIANO "3 run/formato")
#   MODEL_DIR/MODEL_FILE   as ci-e2e.sh
#   APK_PATH       path to the pre-built release APK (default matches the
#                  standard gradle output path; the workflow downloads the
#                  shared build artifact there)
set -uo pipefail
OUT="bench-out"; mkdir -p "$OUT"

PHASE="${PHASE:?PHASE is required (fase0|fase4|smoke)}"
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

# Empty React Native TextInput: uiautomator reports the PLACEHOLDER in the
# EditText text="…" attribute (not a real empty string). composer_text therefore
# returns this on a truly empty field; tap_node matches it the same way.
# Treating the placeholder as non-empty would clear-and-fail every turn.
readonly COMPOSER_PLACEHOLDER="Ask a question…"

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
  fase4|smoke)
    COMPACTION="${COMPACTION:?COMPACTION is required for $PHASE (on|off)}"
    ;;
  *)
    die "unknown PHASE '$PHASE' (expected fase0|fase4|smoke)"
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
  # Opt-in memory subsystem must stay off: otherwise its extract/recall path
  # confounds the compaction A/B (same facts could leak via memory, not context).
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.memory.enabled','0');"
  sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"
}
set_prefs

# On-device proof of what the app will actually read (not what we intended to write).
COMPACTION_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction';" | head -1 | tr -d '[:space:]')

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

# Emulator-image nuisance dismiss labels — NOT app UI. CI run 31367691176
# (arm fase4, v42, seed 5) died at turn 9/13 (~63 min): Google Calendar
# onboarding ("Got it" / Schedule View…) sat on top of the app and held focus;
# dismiss_anr only matches system ANR ("isn't responding"), so nothing recovered.
# These are common system/preinstall dialog buttons on the CI AVD image.
readonly FOREIGN_DIALOG_LABELS=(
  "Got it" "OK" "Dismiss" "No thanks" "Not now" "Close" "Continue" "Allow"
)

# Recover focus when a foreign app's dialog steals the screen mid-arm.
# 1) Re-foreground our activity (displaces another app without guessing labels).
# 2) If the composer is still missing, tap the first matching nuisance label.
# Never fails a turn (always return 0). Called only from send_and_wait retry
# paths — dump_ui is expensive; the happy path already works without this.
dismiss_foreign_dialog() {
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
  sleep 2
  # Composer EditText back → re-foreground alone was enough; skip label hunt.
  if dump_ui 2>/dev/null | grep -q 'class="android.widget.EditText"'; then
    return 0
  fi
  local label
  for label in "${FOREIGN_DIALOG_LABELS[@]}"; do
    if tap_node "$label" 2>/dev/null; then
      # Log WHICH label so a real campaign hit names the interferer (run 31367691176).
      log "dismiss_foreign_dialog: tapped '$label' (emulator-image nuisance)"
      sleep 1
      return 0
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# History helpers — full value dump + python3 parse.
# Do NOT use substr(value,-N) or sed-on-JSON: both failed in run 30863711482
# (saturated 30k tail → stuck wait; escaped-quote sed → false-negative recall).
# ---------------------------------------------------------------------------

# Dump the FULL kalsa.messages.v1 value to $1. The value is a single JSON line
# (JSON escapes newlines), so no multiline handling is needed. Missing key → empty file.
snapshot_history() {
  adb shell "sqlite3 -noheader $DB \"SELECT value FROM catalystLocalStorage WHERE key='kalsa.messages.v1';\"" 2>/dev/null \
    | tr -d '\r' > "$1" || : > "$1"
}

# history_count <file>  → prints the number of assistant messages (0 on any error)
history_count() {
  python3 -c '
import json, sys
try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
    print(sum(1 for m in data if isinstance(m, dict) and m.get("role") == "assistant"))
except Exception:
    print(0)
' "$1"
}

# history_last <file>  → prints a JSON object for the last assistant message:
#     {"text": "...", "sources": <int>, "hasMiniapp": <bool>}
#   or "" if there is no assistant message / on any error.
history_last() {
  python3 -c '
import json, sys
try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
    msgs = [m for m in data if isinstance(m, dict) and m.get("role") == "assistant"]
    if not msgs:
        sys.exit(0)
    m = msgs[-1]
    out = {
        "text": m.get("text") or "",
        "sources": len(m.get("sources") or []),
        "hasMiniapp": bool(m.get("miniapp")),
    }
    print(json.dumps(out, ensure_ascii=False))
except Exception:
    pass
' "$1"
}

# Apply history_last JSON into SAW_* and write reply bytes to $OUT/.reply_tmp.
# WHY write the file here (not via SAW_REPLY=$(…)): command substitution strips
# trailing newlines, so record_turn would lose the last blank line the app stored.
# SAW_REPLY is only for the log line and length.
_apply_last_reply() {
  local info="$1"
  SAW_REPLY=""
  SAW_SOURCES=0
  SAW_MINIAPP=false
  : > "$OUT/.reply_tmp"
  [ -n "$info" ] || return 0
  printf '%s\n' "$info" > "$OUT/.last_assistant.json"
  python3 -c '
import json, sys
try:
    text = json.load(open(sys.argv[1], encoding="utf-8")).get("text") or ""
except Exception:
    text = ""
open(sys.argv[2], "w", encoding="utf-8").write(text)
' "$OUT/.last_assistant.json" "$OUT/.reply_tmp"
  # Shell var may lose trailing newlines — log/len only, not the recorded reply.
  SAW_REPLY=$(cat "$OUT/.reply_tmp" 2>/dev/null || true)
  SAW_SOURCES=$(python3 -c '
import json, sys
try:
    print(int(json.load(open(sys.argv[1], encoding="utf-8")).get("sources") or 0))
except Exception:
    print(0)
' "$OUT/.last_assistant.json")
  SAW_MINIAPP=$(python3 -c '
import json, sys
try:
    print("true" if json.load(open(sys.argv[1], encoding="utf-8")).get("hasMiniapp") else "false")
except Exception:
    print("false")
' "$OUT/.last_assistant.json")
}

# Snapshot history, take last assistant, apply into SAW_* / .reply_tmp.
# Shared by send_and_wait (first detection) and settle_turn_reply (post-idle).
# WHY re-read after idle: the app can append sources/miniapp AFTER first
# persisting text; sources is what the tool_call probe grades.
snapshot_and_apply_last_reply() {
  local hist_path="${1:-$OUT/.hist_now.json}"
  snapshot_history "$hist_path"
  local info
  info=$(history_last "$hist_path")
  _apply_last_reply "$info"
}

# send_and_wait <alphanumeric prompt> <timeout_s>
# `input text` mangles punctuation, so prompts must stay alphanumeric (spaces
# are fine). Sets SAW_REPLY / SAW_SOURCES / SAW_MINIAPP / SAW_ELAPSED on success;
# returns 1 on any failure without ever exiting — the caller decides whether
# that fails the whole arm via die().
# Typing is retried up to 3 times (busy UI mid-stream can swallow input text —
# run 31361781643 every arm). Reply WAIT is NOT retried: a timeout there is real.
send_and_wait() {
  local msg="$1"
  local timeout_s="${2:-1500}"

  snapshot_history "$OUT/.hist_prev.json"
  local prev_count
  prev_count=$(history_count "$OUT/.hist_prev.json")

  local attempt max_attempts=3 type_ok=false
  for attempt in $(seq 1 "$max_attempts"); do
    log "type attempt ${attempt}/${max_attempts}: $msg"

    if [ "$attempt" -gt 1 ]; then
      # Between attempts: UI may still be mid-stream (run 31361781643: next
      # turn typed into a busy composer). Re-settle then clear residual text.
      # Also clear foreign dialogs that stole focus (run 31367691176: Calendar
      # onboarding killed a 63-min arm at turn 9 — dismiss_anr alone was blind).
      dismiss_anr
      dismiss_foreign_dialog
      wait_turn_settled 60
      adb shell input keyevent KEYCODE_MOVE_END
      for _ in $(seq 1 60); do adb shell input keyevent 67 >/dev/null 2>&1; done
      sleep 1
    fi

    # Focus the composer. The placeholder only exists while the field is EMPTY:
    # once text is in, COMPOSER_PLACEHOLDER is gone, so a retry must target the
    # EditText itself (that mismatch failed 4 of 6 arms on the first bench run).
    # WHY ANR/foreign only on this path: dump_ui is expensive; a 13-turn arm runs
    # ~2h and is more ANR/dialog-exposed than e2e, but we still pay the dump only
    # when focus fails (happy path unchanged for campaign comparability).
    if ! tap_node "$COMPOSER_PLACEHOLDER" && ! tap_editable; then
      dismiss_anr
      dismiss_foreign_dialog
      if ! tap_node "$COMPOSER_PLACEHOLDER" && ! tap_editable; then
        log "composer not found for: $msg (attempt ${attempt}/${max_attempts})"
        continue
      fi
    fi
    sleep 3

    # Composer must be empty before typing. WHY: the "did text land" gate is
    # dump_ui | grep -qF "$msg", which still passes when the field holds
    # <previous><new> — arm would record the intended prompt while the model
    # saw a different one. Fabricated evidence is worse than a failed arm.
    # Placeholder counts as empty: uiautomator puts COMPOSER_PLACEHOLDER into
    # EditText text="…" on a blank TextInput (see COMPOSER_PLACEHOLDER comment).
    local existing
    existing=$(composer_text)
    if [ -n "$existing" ] && [ "$existing" != "$COMPOSER_PLACEHOLDER" ]; then
      log "composer non-empty before type (len=${#existing}) — clearing"
      adb shell input keyevent KEYCODE_MOVE_END
      for _ in $(seq 1 60); do adb shell input keyevent 67 >/dev/null 2>&1; done
      sleep 1
      existing=$(composer_text)
      if [ -n "$existing" ] && [ "$existing" != "$COMPOSER_PLACEHOLDER" ]; then
        log "composer still non-empty after clear: [$existing] (attempt ${attempt}/${max_attempts})"
        continue
      fi
    fi

    # Spaces must be sent as %s: `adb shell input text "a b"` reaches the device
    # as two args and only the first word is typed (this failed all 6 Fase 4 arms).
    type_text "$msg"

    # `input text` injects character by character and a long string can take
    # several seconds to appear: poll instead of assuming a fixed delay.
    local typed=false t=0
    while [ "$t" -lt 30 ]; do
      if dump_ui | grep -qF "$msg"; then typed=true; break; fi
      sleep 3; t=$((t + 3))
    done
    if [ "$typed" = false ]; then
      log "text not visible after ${t}s — clearing and retyping once"
      tap_editable || true
      sleep 2
      # Wipe whatever partial text landed, so the retry cannot concatenate.
      adb shell input keyevent KEYCODE_MOVE_END
      for _ in $(seq 1 60); do adb shell input keyevent 67 >/dev/null 2>&1; done
      sleep 2
      type_text "$msg"
      t=0
      while [ "$t" -lt 30 ]; do
        if dump_ui | grep -qF "$msg"; then typed=true; break; fi
        sleep 3; t=$((t + 3))
      done
    fi
    adb shell input keyevent 111   # ESC: hide IME so bounds are stable
    sleep 2
    if [ "$typed" = true ] || ui_texts | grep -qF "$msg"; then
      type_ok=true
      break
    fi
    log "typing did not land in the composer: $msg (attempt ${attempt}/${max_attempts})"
    log "composer actually contains: [$(composer_text)]"
  done
  if [ "$type_ok" = false ]; then
    log "typing did not land in the composer after ${max_attempts} attempts: $msg"
    log "composer actually contains: [$(composer_text)]"
    return 1
  fi

  tap_node "Send" || { log "Send button not found for: $msg"; return 1; }
  # SAW_SENT_AT is global so settle_turn_reply can derive settled_s
  # (Send → last history change). Do NOT repurpose SAW_ELAPSED: it remains
  # UI time-to-first-token for campaign comparability (run 31358530713).
  SAW_SENT_AT=$(date +%s)
  sleep 5

  SAW_REPLY=""; SAW_SOURCES=0; SAW_MINIAPP=false; SAW_ELAPSED=0
  SAW_SETTLED_S=""
  : > "$OUT/.reply_tmp"
  local waited=0 poll_interval=15
  while [ "$waited" -lt "$timeout_s" ]; do
    sleep "$poll_interval"
    waited=$((waited + poll_interval))
    snapshot_history "$OUT/.hist_now.json"
    local count
    count=$(history_count "$OUT/.hist_now.json")
    # Guard: non-integer history_count must not raise "integer expression expected"
    # every poll interval until timeout — treat garbage as 0 and log once.
    case "$count" in
      ''|*[!0-9]*)
        log "history_count returned non-integer '$count' — treating as 0"
        count=0
        ;;
    esac
    if [ "$count" -gt "$prev_count" ]; then
      # First persistence only — sources/miniapp may still be incomplete; settle
      # re-reads after wait_turn_settled (see run_turn_plan). SAW_ELAPSED is
      # UI-observed TTFT (assistant persists at first token, then updates in
      # place) — NOT full turn duration. Keep this meaning stable for the
      # running campaign; turn work time comes from telemetry turnComputeMs.
      snapshot_and_apply_last_reply "$OUT/.hist_now.json"
      SAW_ELAPSED=$(( $(date +%s) - SAW_SENT_AT ))
      log "reply after ${SAW_ELAPSED}s (len=${#SAW_REPLY} sources=$SAW_SOURCES miniapp=$SAW_MINIAPP): ${SAW_REPLY:0:200}"
      return 0
    fi
    log "waiting… ${waited}s / ${timeout_s}s"
  done
  log "TIMEOUT waiting for reply to: $msg"
  return 1
}

# Per-turn telemetry capture. Never fails a turn (always return 0).
# Call after settle_turn_reply. Settle does not wait out the background
# summarize job (see wait_turn_settled), so a summarize's telemetry can land
# in the NEXT turn's telemetry.jsonl — benchGrade.mjs attributes by matching
# tokensEvaluated to embd.size, not by file order.
capture_turn_evidence() {
  local turn_index="$1"
  local tdir="$OUT/turn${turn_index}"
  mkdir -p "$tdir" 2>/dev/null || true
  local buf="$OUT/.logcat_turn_buf.txt"

  adb logcat -d > "$buf" 2>/dev/null || : > "$buf"

  # telemetry.jsonl — strip the "KALSA_TELEMETRY " prefix so each line is bare JSON.
  grep -F "KALSA_TELEMETRY " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_TELEMETRY //' > "$tdir/telemetry.jsonl" 2>/dev/null || : > "$tdir/telemetry.jsonl"

  {
    grep -F "Input processed: n_past=" "$buf" 2>/dev/null || true
    grep -F "restored state checkpoint: reusing" "$buf" 2>/dev/null || true
  } > "$tdir/loadprompt.txt" 2>/dev/null || : > "$tdir/loadprompt.txt"

  # prompt_meta.txt: one line per "Input processed" — reused=n_past total=embd.size.
  # WHY no sha256 of loadPrompt token ids: logcat truncates a line at ~4 KB
  # (smoke run 31358530713), so `loadPrompt: prompt_tokens = …` only ever
  # carried the first ~218 token ids (the fixed system prompt). The hash was
  # constant on every turn of both arms by construction; restoring it would
  # make the aggregator's positive control fail a valid campaign with
  # IDENTICAL PROMPTS — MEASURING NOTHING. embd.size / n_past are not truncated.
  {
    grep -oE "Input processed: n_past=[0-9]+, embd\.size=[0-9]+" "$tdir/loadprompt.txt" 2>/dev/null \
      | sed -E 's/.*n_past=([0-9]+), embd\.size=([0-9]+)/reused=\1 total=\2/' \
      || true
  } > "$tdir/prompt_meta.txt" 2>/dev/null || : > "$tdir/prompt_meta.txt"

  # Clear so the next turn's capture is scoped (and the logcat ring cannot
  # retain prior-turn Input processed / telemetry lines).
  adb logcat -c 2>/dev/null || true
  return 0
}

# Append one turn record to the turns JSONL.
# Args: index kind id prompt elapsed_s sources hasMiniapp; reply bytes already
# in $OUT/.reply_tmp (written by _apply_last_reply — do not rebuild from SAW_REPLY).
# settled_s (optional 8th arg, or SAW_SETTLED_S): Send → last history change;
# omitted/empty → JSON null so older callers and mid-campaign rows still work.
record_turn() {
  local index="$1" kind="$2" id="$3" prompt="$4" elapsed_s="$5" sources="$6" has_miniapp="$7"
  local settled_s="${8:-${SAW_SETTLED_S:-}}"
  python3 -c '
import json, sys
index, kind, tid, prompt, elapsed_s, sources, has_miniapp, reply_path, settled_s = sys.argv[1:10]
reply = open(reply_path, encoding="utf-8").read()
# settled_s null when absent (running campaign raw.json has no field yet).
settled = int(settled_s) if settled_s not in ("", "None", "null") else None
rec = {
    "index": int(index),
    "kind": kind,
    "id": tid,
    "prompt": prompt,
    "elapsed_s": int(elapsed_s),
    "settled_s": settled,
    "reply": reply,
    "replyLen": len(reply),
    "sources": int(sources),
    "hasMiniapp": has_miniapp == "true",
}
print(json.dumps(rec, ensure_ascii=False))
' "$index" "$kind" "$id" "$prompt" "$elapsed_s" "$sources" "$has_miniapp" "$OUT/.reply_tmp" "$settled_s" \
    >> "$OUT/.turns.jsonl" \
    || die "record_turn python failed for turn $index ($id) — refusing to drop a turn silently"
}

# Wait until the turn is fully settled — ALL of the following on the SAME poll:
#   1. last assistant message JSON byte-identical to the previous poll
#   2. raw uiautomator dump has no ▋ (streaming cursor)
#   3. composer placeholder ($COMPOSER_PLACEHOLDER) present as a whole text node
#   4. none of these whole-line labels: Writing, Searching the web…,
#      Fetching page…, Tool failed — continuing without it
# WHY NOT "Thinking": under THINKING=budget256 the finished bubble still has a
# whole text node "Thinking" (collapsed reasoning header). wait_ui_idle treated
# it as live status and burned its full 240s cap every turn of smoke run
# 31358530713 (turnend_timeout_ui.txt while composer was already idle). Only
# that label was wrong — not the cursor/placeholder checks. Conditions 2–4 are
# wait_ui_idle minus Thinking; left driver-local so ci-e2e.sh keeps ci-lib.sh.
# WHY not history-only (wait_history_stable): the model writes tokens in bursts;
# two 10s polls can catch the same intermediate text while generation is still
# running. Run 31361781643: all 12 fase4 arms declared settle, typed into a
# still-disabled composer, died at turn 3–4.
# Cap 240s, poll 10s, ONE dump_ui per poll. Soft-fail on cap. Background
# summarize may still finish after return (benchGrade.mjs attribution).
wait_turn_settled() {
  local cap_s="${1:-240}"
  local poll_s=10
  local elapsed=0
  local polls=0
  local prev=""
  local cur
  local raw="$OUT/.wait_turn_settled_raw.xml"
  local dump="$OUT/.wait_turn_settled_dump.txt"
  # Last-poll flags for the timeout WARN (which condition was still false).
  local hist_ok=false cursor_ok=false placeholder_ok=false labels_ok=false
  # Timestamp of the last observed *change* to the stored assistant message.
  # Caller (settle_turn_reply) derives SAW_SETTLED_S = this − SAW_SENT_AT.
  # WHY record change time, not stability-return time: stability is "two equal
  # polls", so wall time at return includes one full poll interval of no-op
  # waiting; the last change is the real settle moment.
  SAW_LAST_HISTORY_CHANGE_AT=""
  log "wait_turn_settled: history stable + UI idle (cap ${cap_s}s)"
  while [ "$elapsed" -lt "$cap_s" ]; do
    snapshot_history "$OUT/.hist_stable.json"
    cur=$(history_last "$OUT/.hist_stable.json")
    # ONE dump per poll — uiautomator dump is expensive on a loaded AVD.
    dump_ui > "$raw" 2>/dev/null || true
    grep -o 'text="[^"]\{1,200\}"' "$raw" 2>/dev/null \
      | sed 's/^text="//; s/"$//' > "$dump" || true
    polls=$((polls + 1))

    hist_ok=false
    # Empty read: keep previous good snapshot (non-destructive — do not treat
    # empty as a new value or overwrite a good prev).
    if [ -n "$cur" ]; then
      if [ -n "$prev" ] && [ "$cur" = "$prev" ]; then
        hist_ok=true
      else
        # First sighting or content change — record wall clock of this observation.
        prev="$cur"
        SAW_LAST_HISTORY_CHANGE_AT=$(date +%s)
      fi
    fi

    # Cursor needs RAW xml: ui_texts truncates at 200 chars, so a long streaming
    # bubble's trailing ▋ never reaches $dump (same as wait_ui_idle).
    if grep -qF "▋" "$raw" 2>/dev/null; then cursor_ok=false; else cursor_ok=true; fi
    if grep -qxF "$COMPOSER_PLACEHOLDER" "$dump" 2>/dev/null; then
      placeholder_ok=true
    else
      placeholder_ok=false
    fi
    # Whole-line labels only (-x): substring grep hit assistant prose and pinned
    # wait_ui_idle at the cap (see ci-lib.sh). "Thinking" deliberately omitted —
    # see header comment (run 31358530713 / collapsed reasoning header).
    if grep -qxFf <(printf '%s\n' \
        "Writing" "Searching the web…" "Fetching page…" \
        "Tool failed — continuing without it") "$dump" 2>/dev/null; then
      labels_ok=false
    else
      labels_ok=true
    fi

    if [ "$hist_ok" = true ] && [ "$cursor_ok" = true ] \
      && [ "$placeholder_ok" = true ] && [ "$labels_ok" = true ]; then
      log "wait_turn_settled: settled after ${polls} poll(s) (${elapsed}s)"
      return 0
    fi
    sleep "$poll_s"
    elapsed=$((elapsed + poll_s))
  done
  log "WARN: wait_turn_settled timed out after ${cap_s}s (${polls} polls) — continuing (hist_ok=$hist_ok cursor_ok=$cursor_ok placeholder_ok=$placeholder_ok labels_ok=$labels_ok)"
  return 0
}

# After send_and_wait: wait until history + UI are settled, then re-read so
# sources/miniapp match what the grader needs.
# Non-destructive on empty re-read: _apply_last_reply resets SAW_* and truncates
# .reply_tmp when history_last returns "" (adb/sqlite hiccup, swallowed python
# except). Wiping a good detection-time reply would record empty reply +
# sources:0 — silent false-negative on every probe for that turn.
settle_turn_reply() {
  wait_turn_settled

  # Expose Send→last-change seconds for record_turn. Empty when we never saw a
  # change or SAW_SENT_AT is missing — grader maps missing settled_s to null.
  SAW_SETTLED_S=""
  if [ -n "${SAW_LAST_HISTORY_CHANGE_AT:-}" ] && [ -n "${SAW_SENT_AT:-}" ]; then
    SAW_SETTLED_S=$(( SAW_LAST_HISTORY_CHANGE_AT - SAW_SENT_AT ))
    # Guard clock skew / ordering glitches.
    if [ "$SAW_SETTLED_S" -lt 0 ] 2>/dev/null; then
      SAW_SETTLED_S=""
    fi
  fi

  local pre_sources=$SAW_SOURCES pre_miniapp=$SAW_MINIAPP
  local pre_len=${#SAW_REPLY}
  local pre_reply_file="$OUT/.reply_pre_settle"
  cp -f "$OUT/.reply_tmp" "$pre_reply_file" 2>/dev/null || : > "$pre_reply_file"

  snapshot_history "$OUT/.hist_settled.json"
  local info
  info=$(history_last "$OUT/.hist_settled.json")
  if [ -z "$info" ]; then
    cp -f "$pre_reply_file" "$OUT/.reply_tmp" 2>/dev/null || true
    SAW_REPLY=$(cat "$OUT/.reply_tmp" 2>/dev/null || true)
    SAW_SOURCES=$pre_sources
    SAW_MINIAPP=$pre_miniapp
    log "WARN: settle re-read returned nothing — keeping detection-time reply"
    return 0
  fi

  # Re-read produced an assistant message — apply (intentional reset of SAW_*).
  _apply_last_reply "$info"

  if [ "${#SAW_REPLY}" != "$pre_len" ] || [ "$SAW_SOURCES" != "$pre_sources" ] || [ "$SAW_MINIAPP" != "$pre_miniapp" ]; then
    log "settle changed reply (len ${pre_len}->${#SAW_REPLY} sources ${pre_sources}->${SAW_SOURCES} miniapp ${pre_miniapp}->${SAW_MINIAPP})"
  else
    log "settled reply (len=${#SAW_REPLY} sources=$SAW_SOURCES miniapp=$SAW_MINIAPP)"
  fi
  if [ -n "$SAW_SETTLED_S" ]; then
    log "settled_s=${SAW_SETTLED_S}s (Send→last history change; TTFT elapsed_s=${SAW_ELAPSED}s)"
  fi
}

# Run a turn plan: parallel arrays PLAN_KIND / PLAN_ID / PLAN_PROMPT (1-indexed turns).
# Shared by fase4 and smoke so the conversation length is the only difference.
run_turn_plan() {
  local i n msg
  n=${#PLAN_PROMPT[@]}
  for i in $(seq 0 $((n - 1))); do
    local turn=$((i + 1))
    msg="${PLAN_PROMPT[$i]}"
    log "=== turn $turn/${n} kind=${PLAN_KIND[$i]} id=${PLAN_ID[$i]} ==="
    # 1) first persistence (latency) 2) idle 3) re-read settled 4) evidence 5) record
    send_and_wait "$msg" 1500 || die "timeout/failure on turn $turn (${PLAN_ID[$i]})"
    settle_turn_reply
    capture_turn_evidence "$turn"
    record_turn "$turn" "${PLAN_KIND[$i]}" "${PLAN_ID[$i]}" "$msg" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
  done
}

# Base filler list (alphanumeric only — adb input text mangles punctuation).
FILLER_BASE=(
  MotoreElettrico
  RicettaVeloce
  BeneficiSport
  CuriositaSpazio
  ViaggioInTreno
  ClimaOMeteo
)

# Rotate filler list left by (SEED-1) mod 6. Both arms of a paired A/B use the
# SAME SEED → same rotation, so the only intentional difference is the factor
# under test (e.g. compaction on|off), not filler order.
FILLER_ROTATION=$(( (SEED - 1) % 6 ))
FILLERS=()
_fb_n=${#FILLER_BASE[@]}
for _i in $(seq 0 $((_fb_n - 1))); do
  FILLERS+=("${FILLER_BASE[$(( (_i + FILLER_ROTATION) % _fb_n ))]}")
done

: > "$OUT/.turns.jsonl"
FACTS_JSON='["Leopoldo","4500","Torino","PK42","Zaffiro","XR9","Brindisi","Nebbiolo"]'

if [ "$PHASE" = "fase0" ]; then
  PLANT="GattoLeopoldo"
  # 5 filler turns, not 1: rebuilds land on user-turns 1,4,7 (K=3) and the
  # verbatim window keeps the last 6 messages. With a single filler the planted
  # fact is still IN the verbatim window at probe time, so all block formats
  # score identically and the A/B measures nothing. With 5 fillers the turn-4
  # rebuild has pushed the fact into the compacted "older" side before the probe.
  F0_FILLERS=(
    "CosaEInternet"
    "CittaSulMare"
    "CosaEAlgoritmo"
    "PioggiaONeve"
    "SportInvernali"
  )
  PROBE="NomeDelGatto"
  FACTS_JSON='["Leopoldo"]'
  FILLER_ROTATION=0

  global_turn=0
  for run in $(seq 1 "$RUNS_PER_ARM"); do
    log "=== fase0 run $run/$RUNS_PER_ARM ==="
    new_conversation
    adb logcat -c 2>/dev/null || true

    global_turn=$((global_turn + 1))
    send_and_wait "$PLANT" 1500 || die "run $run: timeout/failure on plant turn"
    settle_turn_reply
    capture_turn_evidence "$global_turn"
    record_turn "$global_turn" "plant" "plant" "$PLANT" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"

    for i in "${!F0_FILLERS[@]}"; do
      f="${F0_FILLERS[$i]}"
      global_turn=$((global_turn + 1))
      send_and_wait "$f" 1500 || die "run $run: timeout/failure on filler $((i+1))"
      settle_turn_reply
      capture_turn_evidence "$global_turn"
      record_turn "$global_turn" "filler" "filler_$((i+1))" "$f" \
        "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
    done

    global_turn=$((global_turn + 1))
    send_and_wait "$PROBE" 1500 || die "run $run: timeout/failure on probe turn"
    settle_turn_reply
    capture_turn_evidence "$global_turn"
    record_turn "$global_turn" "probe" "probe" "$PROBE" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
  done

elif [ "$PHASE" = "fase4" ] || [ "$PHASE" = "smoke" ]; then
  # Build the turn plan as lists; phase only chooses which plan (no loop copy-paste).
  PLAN_KIND=()
  PLAN_ID=()
  PLAN_PROMPT=()
  plan_add() { PLAN_KIND+=("$1"); PLAN_ID+=("$2"); PLAN_PROMPT+=("$3"); }

  # Plants — alphanumeric + spaces only (adb shell input text mangles punctuation).
  plan_add plant plant_a \
    "Ricorda questi dati il gatto si chiama Leopoldo il budget e 4500 euro la citta e Torino il codice e PK42"
  if [ "$PHASE" = "fase4" ]; then
    plan_add plant plant_b \
      "Ricorda anche il colore e Zaffiro il modello e XR9 il porto e Brindisi il vino e Nebbiolo"
    for i in "${!FILLERS[@]}"; do
      plan_add filler "filler_$((i+1))" "${FILLERS[$i]}"
    done
    plan_add probe probe_facts \
      "Ripeti tutti i dati che ti ho dato nei primi due messaggi"
    plan_add probe probe_tool \
      "Cerca sul web le previsioni del meteo di domani a Milano"
    plan_add probe probe_miniapp \
      "Fammi un quiz di tre domande sulla geografia"
    plan_add probe probe_language \
      "In quale continente si trova il Brasile e perche"
    plan_add probe probe_honesty \
      "Chi ha vinto il premio Zorblax nel 2019"
  else
    # smoke: plant_a + plant_b + filler_1 + filler_2 + probe_facts (5 turns).
    # WHY 5: smoke exists to reach the first turn where a settle bug shows up.
    # 3 turns provably did not — smoke 31358530713 was green while all 12
    # fase4 arms of 31361781643 died at turn 3–4 on a premature settle.
    FACTS_JSON='["Leopoldo","4500","Torino","PK42","Zaffiro","XR9","Brindisi","Nebbiolo"]'
    plan_add plant plant_b \
      "Ricorda anche il colore e Zaffiro il modello e XR9 il porto e Brindisi il vino e Nebbiolo"
    plan_add filler filler_1 "${FILLERS[0]}"
    plan_add filler filler_2 "${FILLERS[1]}"
    plan_add probe probe_facts \
      "Ripeti tutti i dati che ti ho dato nei primi due messaggi"
  fi

  new_conversation
  adb logcat -c 2>/dev/null || true
  run_turn_plan
fi

# No final logcat dump: after per-turn adb logcat -c it can only capture post-last-
# turn noise, and nothing reads logcat.txt. (A7)

snapshot_history "$OUT/history_final.json"
HISTORY_CHARS=$(wc -c < "$OUT/history_final.json" | tr -d ' ')

# Strongest available positive control: the compactor's own persisted state
# (not an inference from timings). reset_chat deletes both keys at arm start,
# so a non-zero length can only come from this run. Smoke run 31358530713
# showed prompt-token hashes were constant; this is the on-device proof that
# the subsystem actually ran on the v42 arm.
_len_or_0() {
  local v
  v=$(sql "$1" | head -1 | tr -d '[:space:]')
  case "$v" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$v" ;;
  esac
}
COMPACTOR_CHARS=$(_len_or_0 "SELECT length(value) FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';")
SUMMARY_CHARS=$(_len_or_0 "SELECT length(value) FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';")
log "compactorState: compactorChars=$COMPACTOR_CHARS summaryChars=$SUMMARY_CHARS"

# raw.json via python3 (escaping correct by construction — no hand-concat JSON).
# Wipe any previous raw.json first so a failed write cannot leave stale data
# for the grader (A6).
rm -f "$OUT/raw.json"
python3 -c '
import json, sys

phase, arm, seed, block_format, thinking, compaction, compaction_pref_raw = sys.argv[1:8]
model_dir, model_file, facts_json, filler_rotation, history_chars = sys.argv[8:13]
turns_path, out_path, compactor_chars, summary_chars = sys.argv[13:17]

turns = []
try:
    with open(turns_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                turns.append(json.loads(line))
except Exception:
    turns = []

raw = {
    "schema": 2,
    "phase": phase,
    "arm": arm,
    "seed": int(seed),
    "blockFormat": block_format,
    "thinking": thinking,
    "compaction": compaction,
    "compactionPrefRaw": compaction_pref_raw,
    "model": {"dir": model_dir, "file": model_file},
    "facts": json.loads(facts_json),
    "fillerRotation": int(filler_rotation),
    "turns": turns,
    "historyChars": int(history_chars),
    # On-device proof the compactor subsystem ran (see comment above the SQL).
    "compactorState": {
        "compactorChars": int(compactor_chars),
        "summaryChars": int(summary_chars),
    },
}
with open(out_path, "w", encoding="utf-8") as out:
    json.dump(raw, out, ensure_ascii=False, indent=2)
    out.write("\n")
' \
  "$PHASE" "$ARM" "$SEED" "$BLOCK_FORMAT" "$THINKING" "$COMPACTION" "$COMPACTION_PREF_RAW" \
  "$MODEL_DIR" "$MODEL_FILE" "$FACTS_JSON" "$FILLER_ROTATION" "$HISTORY_CHARS" \
  "$OUT/.turns.jsonl" "$OUT/raw.json" "$COMPACTOR_CHARS" "$SUMMARY_CHARS" \
  || die "failed to write raw.json — refusing to grade stale or missing data"

# Grading is out-of-band: a raw.json that cannot be graded is a failed arm.
if ! node scripts/benchGrade.mjs "$OUT/raw.json" > "$OUT/result.json"; then
  die "benchGrade.mjs failed — raw.json cannot be graded (see raw.json + grader stderr)"
fi

# RESULT.txt: arm/seed/compaction + probes=found/total read back from result.json.
python3 -c '
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
out_path = sys.argv[2]
arm = r.get("arm", "")
seed = r.get("seed", "")
compaction = r.get("compaction", "")
# Accept either nested probes.found/total or top-level found/total/probes.
found = r.get("probesFound", r.get("found"))
total = r.get("probesTotal", r.get("total"))
if found is None or total is None:
    probes = r.get("probes")
    if isinstance(probes, dict):
        found = probes.get("found", found)
        total = probes.get("total", total)
    elif isinstance(probes, list):
        total = len(probes)
        found = sum(1 for p in probes if p.get("found") is True)
if found is None:
    found = "?"
if total is None:
    total = "?"
phase = r.get("phase", "")
fmt = r.get("blockFormat", "")
thinking = r.get("thinking", "")
lines = [
    "phase=%s arm=%s seed=%s format=%s thinking=%s compaction=%s" % (
        phase, arm, seed, fmt, thinking, compaction),
    "probes=%s/%s" % (found, total),
]
open(out_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
' "$OUT/result.json" "$OUT/RESULT.txt" 2>/dev/null || {
  # Fallback if result.json shape is unexpected — still leave a usable stamp.
  {
    echo "phase=$PHASE arm=$ARM seed=$SEED format=$BLOCK_FORMAT thinking=$THINKING compaction=$COMPACTION"
    echo "probes=?/?"
  } > "$OUT/RESULT.txt"
}
cat "$OUT/RESULT.txt"

log "PASS: arm $ARM completed, raw.json + result.json written"
