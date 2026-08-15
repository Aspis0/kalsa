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
#   COMPACTION     on|off|ciswire → kalsa.context.compaction raw 1|0|ciswire
#                  (fase4/smoke only; fase0 always forces "on" → raw 1 / v42,
#                  see NOTE(fase0-compaction))
#   TOOLCHOICE     auto|required|none → kalsa.bench.toolchoice (default auto)
#   TOOLGATE       1|0 → kalsa.bench.toolgate (default 1; 0 disables the
#                  echo-of-context rules gate)
#   MEMORY         1|0 → kalsa.memory.enabled (default 0; 1 enables memory extract/inject)
#   RUNS_PER_ARM   fase0 in-job repeat count (default 3, per PIANO "3 run/formato")
#   INTER_TURN_DELAY_S  seconds of pure idle between turns (default 0).
#                  After capture_turn_evidence, before the next prompt is typed.
#                  Lets the app's SUMMARY_IDLE_DEBOUNCE_MS (8s) fire; without a
#                  gap the next send keeps streamInFlight and the debounce
#                  never schedules the rolling summary. Applied identically on
#                  every arm (shared timing, not a treatment). Skipped after
#                  the final turn of the run.
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
TOOLCHOICE="${TOOLCHOICE:-auto}"
TOOLGATE="${TOOLGATE:-1}"
NCTX="${NCTX:-}"
WINBUDGET="${WINBUDGET:-}"
LEGACYWINDOW="${LEGACYWINDOW:-}"
RANKING="${RANKING:-}"
MEMORY="${MEMORY:-0}"
RUNS_PER_ARM="${RUNS_PER_ARM:-3}"
INTER_TURN_DELAY_S="${INTER_TURN_DELAY_S:-0}"
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
# Both languages on purpose (not derived from $LOCALE / seeded kalsa.locale):
# the list stays correct if the seed changes again, and a stale entry costs nothing.
# Ellipsis is the single char "…", not three dots (src/i18n/{en,it}.ts chat.placeholder).
readonly COMPOSER_PLACEHOLDERS=(
  "Ask a question…"
  "Fai una domanda…"
)
# Send button label (chat.send / chat.a11ySend in src/i18n/{en,it}.ts). Both
# languages for the same reason as COMPOSER_PLACEHOLDERS. CI run 31399547762:
# all 12 arms dead at turn 1 — placeholder check passed (IT) but Send stayed
# EN-only while kalsa.locale=it showed "Invia".
readonly SEND_LABELS=(
  "Send"
  "Invia"
)
# Busy-status whole-line labels the settle check must wait out. Both languages
# for the same reason as COMPOSER_PLACEHOLDERS. Deliberately EXCLUDES reasoning
# headers in both languages ("Thinking" / "Sto pensando" / "Ragionamento") —
# under THINKING=budget256 the finished bubble still shows a collapsed header
# and treating it as live status burns the full settle cap (run 31358530713).
readonly BUSY_STATUS_LABELS=(
  "Writing" "Sto scrivendo"
  "Searching the web…" "Cerco sul web…"
  "Fetching page…" "Recupero pagina…"
  "Tool failed — continuing without it" "Strumento fallito — continuo senza"
)

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
  fase4|smoke|mem)
    COMPACTION="${COMPACTION:?COMPACTION is required for $PHASE (on|off|ciswire)}"
    case "$COMPACTION" in
      on|off|ciswire) ;;
      *) die "COMPACTION must be on|off|ciswire (got '$COMPACTION')" ;;
    esac
    ;;
  *)
    die "unknown PHASE '$PHASE' (expected fase0|fase4|smoke)"
    ;;
esac

case "$TOOLCHOICE" in
  auto|required|none) ;;
  *) die "TOOLCHOICE must be auto|required|none (got '$TOOLCHOICE')" ;;
esac
case "$TOOLGATE" in
  0|1) ;;
  *) die "TOOLGATE must be 0|1 (got '$TOOLGATE')" ;;
esac
# Empty = no override (catalog n_ctx). Anything else must be an integer at or
# above the llama.rn floor: the app parser silently ignores a malformed value,
# so without this the run would report the requested nctx and quietly execute
# the whole campaign at catalog 16384 — the exact regime bug this axis exists
# to fix.
case "$NCTX" in
  "") ;;
  *[!0-9]*) die "NCTX must be empty or a positive integer (got '$NCTX')" ;;
  *) [ "$NCTX" -ge 2048 ] || die "NCTX must be >= 2048 (llama.rn floor), got '$NCTX'" ;;
esac
case "$WINBUDGET" in
  "") ;;
  *[!0-9]*) die "WINBUDGET must be empty or a positive integer (got '$WINBUDGET')" ;;
  *) [ "$WINBUDGET" -ge 500 ] || die "WINBUDGET must be >= 500 chars, got '$WINBUDGET'" ;;
esac
case "$LEGACYWINDOW" in
  "") ;;
  *[!0-9]*) die "LEGACYWINDOW must be empty or a positive integer (got '$LEGACYWINDOW')" ;;
  *) [ "$LEGACYWINDOW" -ge 4 ] || die "LEGACYWINDOW must be >= 4 (floor to hold current turn), got '$LEGACYWINDOW'" ;;
esac
case "$RANKING" in
  ""|bm25|hybrid) ;;
  *) die "RANKING must be empty, bm25, or hybrid (got '$RANKING')" ;;
esac
case "$MEMORY" in
  0|1) ;;
  *) die "MEMORY must be 0 or 1 (got '$MEMORY')" ;;
esac

log "arm=$ARM phase=$PHASE seed=$SEED format=$BLOCK_FORMAT thinking=$THINKING compaction=$COMPACTION toolchoice=$TOOLCHOICE toolgate=$TOOLGATE nctx=$NCTX winBudget=$WINBUDGET legacyWindow=$LEGACYWINDOW memory=$MEMORY runsPerArm=$RUNS_PER_ARM interTurnDelayS=$INTER_TURN_DELAY_S"
# LFM2.5 is always-on reasoning: the chat template has preserve_thinking only,
# no off switch. Record THINKING as today; do not try to force it off.
if [ "$MODEL_DIR" = "lfm2.5-2.6b" ] || [ "$MODEL_DIR" = "lfm2.5-8b-a1b" ]; then
  log "thinking axis is not applicable for $MODEL_DIR (always-on reasoning; template has no off) — THINKING=$THINKING is recorded but not enforced"
fi

# Fail fast on setup errors — do not burn emulator boot time on a broken input.
[ -f "$APK_PATH" ] || die "APK not found at $APK_PATH (build job artifact missing?)"
[ -f "model.gguf" ] || die "model.gguf not found in cwd (download step missing?)"

install_and_sideload "$APK_PATH" "model.gguf" "$MODEL_DIR" "$MODEL_FILE"

# WHY: ModelRegistry qwen3.5-4b requires mmproj alongside weights;
# ModelDownloader isFileComplete is size-exact (ModelDownloader.ts:67-68).
# Sideloading only the main GGUF made every turn reply "Modello non ancora
# scaricato" while both smoke arms stayed green (CI run 31420693167).
# Skip silently when MMPROJ_FILE unset (2B has no mmproj — leave alone).
# Push after install_and_sideload (same idioms) rather than changing ci-lib.sh.
if [ -n "${MMPROJ_FILE:-}" ] && [ -f mmproj.gguf ]; then
  log "sideload mmproj $MMPROJ_FILE"
  adb push mmproj.gguf /data/local/tmp/mmproj.gguf 2>&1 | tail -1
  adb shell "cp /data/local/tmp/mmproj.gguf /data/data/$PKG/files/models/$MODEL_DIR/$MMPROJ_FILE"
  adb shell "rm -f /data/local/tmp/mmproj.gguf"
  _mmproj_uid=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
  adb shell "chown -R $_mmproj_uid:$_mmproj_uid /data/data/$PKG/files/models"
  # Presence check is size-exact — a truncated push fails the same silent way
  # as 31420693167. Expected size from workflow (MMPROJ_BYTES), not hardcoded.
  [ -n "${MMPROJ_BYTES:-}" ] \
    || die "MMPROJ_FILE set but MMPROJ_BYTES missing (workflow must export expected size)"
  _mmproj_dev_sz=$(adb shell "stat -c %s /data/data/$PKG/files/models/$MODEL_DIR/$MMPROJ_FILE" 2>/dev/null | tr -d '\r')
  [ "$_mmproj_dev_sz" = "$MMPROJ_BYTES" ] \
    || die "mmproj size on device $_mmproj_dev_sz != expected MMPROJ_BYTES $MMPROJ_BYTES (truncated/corrupt push)"
  log "mmproj OK ($_mmproj_dev_sz bytes)"
  adb shell "ls -la /data/data/$PKG/files/models/$MODEL_DIR/" | tr -d '\r'
fi

# Map COMPACTION env (on|off|ciswire) → raw AsyncStorage value (1|0|ciswire).
# Unknown values die — never silently fall back to 0 (that turns a broken arm
# into a fake baseline and we would never notice).
compaction_pref_raw_for() {
  case "$1" in
    on) echo 1 ;;
    off) echo 0 ;;
    ciswire) echo ciswire ;;
    *) die "COMPACTION must be on|off|ciswire (got '$1')" ;;
  esac
}

set_prefs() {
  local compaction_val
  compaction_val=$(compaction_pref_raw_for "$COMPACTION")
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','$compaction_val');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.thinking','$THINKING');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.format','$BLOCK_FORMAT');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.toolchoice','$TOOLCHOICE');"
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.toolgate','$TOOLGATE');"
  # NCTX override. Empty must DELETE the key, not merely skip the write: an
  # arm that inherits a previous arm's pref would run at that n_ctx while the
  # report claims catalog — the exact silent-wrong-regime this axis exists to
  # prevent. Inert on today's fresh-per-job emulator, live the moment an AVD
  # is reused. Both branches are asserted below.
  if [ -n "$NCTX" ]; then
    sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.nctx','$NCTX');"
  else
    sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.nctx';"
  fi
  # WINBUDGET: the knob that actually controls how often the compactor runs —
  # shouldRebuild fires on this char budget and on the K-turn cadence, never on
  # n_ctx. Same delete-when-empty rule, same both-branch assert.
  if [ -n "$WINBUDGET" ]; then
    sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.winbudget','$WINBUDGET');"
  else
    sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.winbudget';"
  fi
  # LEGACYWINDOW: the knob that decides what falls out of context on BOTH arms
  # of the primary comparison (ciswire vs off). Same delete-when-empty rule,
  # same both-branch assert.
  if [ -n "$LEGACYWINDOW" ]; then
    sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.legacywindow','$LEGACYWINDOW');"
  else
    sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.legacywindow';"
  fi
  # RANKING: the knob that decides digest retrieval ranking mode.
  # Same delete-when-empty rule, same both-branch assert.
  if [ -n "$RANKING" ]; then
    sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.ranking','$RANKING');"
  else
    sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.ranking';"
  fi
  # Opt-in memory subsystem: MEMORY env controls kalsa.memory.enabled (0=off, 1=on, default 0).
  # With a short legacy window (kalsa.bench.legacywindow), planted facts fall out of verbatim
  # context, so memory becomes the only retrieval path — not a confounder. Both-branch assert below.
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.memory.enabled','$MEMORY');"
  # Locale MUST be "it" on every phase/arm. Bench prompts and probes are Italian.
  # DEFAULT_LOCALE in src/i18n/index.ts is "en"; without this seed both arms run
  # English. The operative block's language rule (en.ts operativeBlock.language)
  # is injected only on the compaction arm (LlamaService format none→user-prefix
  # upgrade when digest exists), so an unseeded locale puts a *different
  # instruction* in one arm — a confounder, not a treatment effect. Evidence:
  # CI run 31379031892 scored language 6/6 baseline vs 2/5 v42 because v42 was
  # told in English to answer in English while probes asked in Italian.
  # LOCALE_KEY is exactly "kalsa.locale"; "it" is a valid Locale (src/i18n/index.ts).
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.locale','it');"
  sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"
}
set_prefs

# On-device proof of what the app will actually read (not what we intended to write).
COMPACTION_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction';" | head -1 | tr -d '[:space:]')
LOCALE_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.locale';" | head -1 | tr -d '[:space:]')
# Exact raw match for all three modes — silent mismatch would poison the A/B.
_EXPECTED_COMPACTION_RAW=$(compaction_pref_raw_for "$COMPACTION")
[ "$COMPACTION_PREF_RAW" = "$_EXPECTED_COMPACTION_RAW" ] \
  || die "compaction pref on device is '$COMPACTION_PREF_RAW', expected '$_EXPECTED_COMPACTION_RAW' (COMPACTION=$COMPACTION)"
TOOLCHOICE_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.toolchoice';" | head -1 | tr -d '[:space:]')
[ "$TOOLCHOICE_PREF_RAW" = "$TOOLCHOICE" ] \
  || die "toolchoice pref on device is '$TOOLCHOICE_PREF_RAW', expected '$TOOLCHOICE'"
TOOLGATE_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.toolgate';" | head -1 | tr -d '[:space:]')
[ "$TOOLGATE_PREF_RAW" = "$TOOLGATE" ] \
  || die "toolgate pref on device is '$TOOLGATE_PREF_RAW', expected '$TOOLGATE'"
# NCTX assert, BOTH branches. When set, the on-device pref must match exactly:
# a silent write failure would leave catalogCtx in place and the whole bench
# regime wrong. When empty, the key must be ABSENT — an inherited value from a
# previous arm is the same failure with the opposite sign, and asserting only
# the non-empty branch would leave it unguarded.
NCTX_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.nctx';" | head -1 | tr -d '[:space:]')
if [ -n "$NCTX" ]; then
  [ "$NCTX_PREF_RAW" = "$NCTX" ] \
    || die "nctx pref on device is '$NCTX_PREF_RAW', expected '$NCTX'"
else
  [ -z "$NCTX_PREF_RAW" ] \
    || die "nctx pref on device is '$NCTX_PREF_RAW', expected absent (NCTX empty = catalog n_ctx)"
fi
WINBUDGET_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.winbudget';" | head -1 | tr -d '[:space:]')
if [ -n "$WINBUDGET" ]; then
  [ "$WINBUDGET_PREF_RAW" = "$WINBUDGET" ] \
    || die "winbudget pref on device is '$WINBUDGET_PREF_RAW', expected '$WINBUDGET'"
else
  [ -z "$WINBUDGET_PREF_RAW" ] \
    || die "winbudget pref on device is '$WINBUDGET_PREF_RAW', expected absent (WINBUDGET empty = WINDOW_CHAR_BUDGET)"
fi
LEGACYWINDOW_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.legacywindow';" | head -1 | tr -d '[:space:]')
if [ -n "$LEGACYWINDOW" ]; then
  [ "$LEGACYWINDOW_PREF_RAW" = "$LEGACYWINDOW" ] \
    || die "legacywindow pref on device is '$LEGACYWINDOW_PREF_RAW', expected '$LEGACYWINDOW'"
else
  [ -z "$LEGACYWINDOW_PREF_RAW" ] \
    || die "legacywindow pref on device is '$LEGACYWINDOW_PREF_RAW', expected absent (LEGACYWINDOW empty = LEGACY_MAX_HISTORY)"
fi
RANKING_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.ranking';" | head -1 | tr -d '[:space:]')
if [ -n "$RANKING" ]; then
  [ "$RANKING_PREF_RAW" = "$RANKING" ] \
    || die "ranking pref on device is '$RANKING_PREF_RAW', expected '$RANKING'"
else
  [ -z "$RANKING_PREF_RAW" ] \
    || die "ranking pref on device is '$RANKING_PREF_RAW', expected absent (RANKING empty = bm25)"
fi
# Memory is always written (default 0, never deleted) — simple equality assert.
MEMORY_PREF_RAW=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.memory.enabled';" | head -1 | tr -d '[:space:]')
[ "$MEMORY_PREF_RAW" = "$MEMORY" ] \
  || die "memory pref on device is '$MEMORY_PREF_RAW', expected '$MEMORY'"

adb logcat -c

reset_chat() {
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.messages.v1';"
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';"
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';"
  # Memory facts key — facts extracted in one arm must not persist into the next.
  # The enabled key is set at script start and should persist within an arm.
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.memory.facts';"
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

# WHY driver-local (not ci-lib dump_ui): uiautomator dump fails on a large or
# never-idle hierarchy; dump_ui swallows the error and cats a stale/absent
# file. Run 31367691176 logged "no EditText on screen" / "node 'Ask a
# question…' NOT FOUND" on a screen that had both. Retry up to 3×, 2 s apart;
# no <hierarchy → FAILED DUMP, not an empty screen. Leave ci-lib.sh alone.
dump_ui_retry() {
  local attempt out
  for attempt in 1 2 3; do
    out=$(dump_ui 2>/dev/null || true)
    if printf '%s' "$out" | grep -q '<hierarchy'; then
      printf '%s\n' "$out"
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 2
  done
  # stderr: callers capture stdout as the dump body (ui=$(dump_ui_retry)).
  log "dump failed, not an empty screen" >&2
  return 1
}

# True if $1 is blank or equals any accepted composer placeholder (empty field).
composer_looks_empty() {
  local t="$1" p
  [ -z "$t" ] && return 0
  for p in "${COMPOSER_PLACEHOLDERS[@]}"; do
    [ "$t" = "$p" ] && return 0
  done
  return 1
}

# Focus via any accepted placeholder; returns 1 only if none matched.
tap_composer_placeholder() {
  local p
  for p in "${COMPOSER_PLACEHOLDERS[@]}"; do
    tap_node "$p" && return 0
  done
  return 1
}

# Tap Send via any accepted language variant; returns 1 only if none matched.
tap_send() {
  local p
  for p in "${SEND_LABELS[@]}"; do
    tap_node "$p" && return 0
  done
  return 1
}

# Dump distinct text nodes for startup diagnostics (shared by assert steps).
_startup_ui_dump() {
  local ui
  ui=$(dump_ui_retry 2>/dev/null) || ui=""
  printf '%s' "$ui" | grep -o 'text="[^"]\{1,200\}"' \
    | sed 's/^text="//; s/"$//' | sort -u
}

# Fail-fast before any turn: exercise the whole composer→type→Send path once.
# Costs ~20 s once and turns a UI-string mismatch into a two-minute failure with
# a name instead of a dead 12-arm matrix. Runs 31396845208 (placeholder EN-only)
# and 31399547762 (Send EN-only) both died at turn 1 for exactly this class of
# defect, on two different strings. Does NOT send the probe — conversation starts
# clean.
#
# Bounded recovery (max 3 attempts): run 31402155067 had 5/12 arms die here with
# startup_ui.txt = Pixel Launcher ANR ("isn't responding" / Wait / Close app).
# dismiss_anr already handles that dialog; without a retry the assertion only
# detected the blocked screen and gave up.
assert_input_path_ready() {
  local attempt

  # WHY before attempt 1: ANR is provoked by the 1.7 GB model copy that
  # install_and_sideload just did — the screen is most likely blocked exactly
  # then. Ordering is not incidental; the dialog is a consequence of the sideload.
  dismiss_anr

  for attempt in 1 2 3; do
    log "startup: input-path check attempt $attempt/3"
    if _assert_input_path_ready_once; then
      return 0
    fi
    log "startup: attempt $attempt/3 failed — ${_startup_assert_fail:-unknown}"
    if [ -f "$OUT/startup_ui.txt" ]; then
      log "startup: screen when failed:"
      while IFS= read -r line || [ -n "$line" ]; do
        log "  $line"
      done < "$OUT/startup_ui.txt"
    fi
    if [ "$attempt" -ge 3 ]; then
      die "${_startup_assert_fail:-startup: input path not ready after 3 attempts}"
    fi
    dismiss_anr
    dismiss_foreign_dialog
    adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
    sleep 10
  done
}

# Single attempt of the input-path steps. On failure: write startup_ui.txt, set
# _startup_assert_fail for the outer die message, return 1 (do not exit).
_assert_input_path_ready_once() {
  local ui dump p found existing t
  local probe="BenchOk"
  _startup_assert_fail=""

  # 1) focus the composer (any placeholder variant)
  if ! tap_composer_placeholder; then
    _startup_ui_dump > "$OUT/startup_ui.txt"
    _startup_assert_fail="startup: focus composer failed — no COMPOSER_PLACEHOLDERS match (distinct text nodes in $OUT/startup_ui.txt)"
    return 1
  fi
  sleep 2

  # 2) type a short probe (alphanumeric only — adb input text mangles punctuation)
  type_text "$probe"

  # 3) require probe text to appear in the UI dump
  found=false
  t=0
  while [ "$t" -lt 15 ]; do
    if ui=$(dump_ui_retry) && printf '%s' "$ui" | grep -qF "$probe"; then
      found=true
      break
    fi
    sleep 1; t=$((t + 1))
  done
  if [ "$found" = false ]; then
    _startup_ui_dump > "$OUT/startup_ui.txt"
    _startup_assert_fail="startup: probe '$probe' not visible after type (distinct text nodes in $OUT/startup_ui.txt)"
    return 1
  fi

  # 4) require a Send node findable (any SEND_LABELS) — do NOT tap it
  found=false
  ui=$(dump_ui_retry) || {
    _startup_ui_dump > "$OUT/startup_ui.txt"
    _startup_assert_fail="startup: UI dump failed while looking for Send (distinct text nodes in $OUT/startup_ui.txt)"
    return 1
  }
  for p in "${SEND_LABELS[@]}"; do
    if printf '%s' "$ui" | grep -qE "content-desc=\"$p\"|text=\"$p\""; then
      found=true
      break
    fi
  done
  if [ "$found" = false ]; then
    printf '%s' "$ui" | grep -o 'text="[^"]\{1,200\}"' \
      | sed 's/^text="//; s/"$//' | sort -u > "$OUT/startup_ui.txt"
    _startup_assert_fail="startup: Send node not found (any of SEND_LABELS; distinct text nodes in $OUT/startup_ui.txt)"
    return 1
  fi

  # 5) clear composer (MOVE_END + 60× DEL) and require empty again
  adb shell input keyevent KEYCODE_MOVE_END
  for _ in $(seq 1 60); do adb shell input keyevent 67 >/dev/null 2>&1; done
  sleep 1
  existing=$(composer_text)
  if ! composer_looks_empty "$existing"; then
    _startup_ui_dump > "$OUT/startup_ui.txt"
    _startup_assert_fail="startup: composer not empty after clear (got [$existing]; distinct text nodes in $OUT/startup_ui.txt)"
    return 1
  fi

  log "startup: input path ready (focus, type, Send visible, clear — probe not sent)"
  return 0
}

# Recover focus when a foreign app's dialog steals the screen mid-arm.
# 1) Re-foreground our activity (displaces another app without guessing labels).
# 2) If the composer is still missing, tap the first matching nuisance label.
# Never fails a turn (always return 0). Called only from send_and_wait retry
# paths — dump_ui is expensive; the happy path already works without this.
dismiss_foreign_dialog() {
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
  sleep 2
  # Composer EditText back → re-foreground alone was enough; skip label hunt.
  # dump_ui_retry: do not treat a failed dump as "no EditText" (run 31367691176).
  local ui
  if ui=$(dump_ui_retry); then
    if printf '%s' "$ui" | grep -q 'class="android.widget.EditText"'; then
      return 0
    fi
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
    # once text is in, any COMPOSER_PLACEHOLDERS entry is gone, so a retry must
    # target the EditText itself (that mismatch failed 4 of 6 arms on the first
    # bench run). Try every accepted language variant until one taps.
    # WHY ANR/foreign only on this path: dump_ui is expensive; a 13-turn arm runs
    # ~2h and is more ANR/dialog-exposed than e2e, but we still pay the dump only
    # when focus fails (happy path unchanged for campaign comparability).
    if ! tap_composer_placeholder && ! tap_editable; then
      dismiss_anr
      dismiss_foreign_dialog
      if ! tap_composer_placeholder && ! tap_editable; then
        # Diagnose dump failure vs genuinely empty (run 31367691176 misread).
        if dump_ui_retry >/dev/null; then
          log "composer not found for: $msg (attempt ${attempt}/${max_attempts})"
        else
          log "composer not found for: $msg (attempt ${attempt}/${max_attempts}) — dump failed, not an empty screen"
        fi
        continue
      fi
    fi
    sleep 3

    # Composer must be empty before typing. WHY: the "did text land" gate is
    # dump_ui | grep -qF "$msg", which still passes when the field holds
    # <previous><new> — arm would record the intended prompt while the model
    # saw a different one. Fabricated evidence is worse than a failed arm.
    # Placeholder counts as empty: uiautomator puts a COMPOSER_PLACEHOLDERS
    # entry into EditText text="…" on a blank TextInput (see array comment).
    local existing
    existing=$(composer_text)
    if ! composer_looks_empty "$existing"; then
      log "composer non-empty before type (len=${#existing}) — clearing"
      adb shell input keyevent KEYCODE_MOVE_END
      for _ in $(seq 1 60); do adb shell input keyevent 67 >/dev/null 2>&1; done
      sleep 1
      existing=$(composer_text)
      if ! composer_looks_empty "$existing"; then
        log "composer still non-empty after clear: [$existing] (attempt ${attempt}/${max_attempts})"
        continue
      fi
    fi

    # Spaces must be sent as %s: `adb shell input text "a b"` reaches the device
    # as two args and only the first word is typed (this failed all 6 Fase 4 arms).
    type_text "$msg"

    # `input text` injects character by character and a long string can take
    # several seconds to appear: poll instead of assuming a fixed delay.
    # dump_ui_retry: a failed dump is not "text not visible" (run 31367691176).
    local typed=false t=0 ui
    while [ "$t" -lt 30 ]; do
      if ui=$(dump_ui_retry) && printf '%s' "$ui" | grep -qF "$msg"; then
        typed=true; break
      fi
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
        if ui=$(dump_ui_retry) && printf '%s' "$ui" | grep -qF "$msg"; then
          typed=true; break
        fi
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

  # Bounded Send retry (run 31379031892: fase4/v42/seed4 died at turn 10 after
  # ~50m — text had landed, composer focused, but one stale/failed dump missed
  # the Send node). Between attempts refresh the dump + dismiss overlays; do
  # NOT re-type: the message is already in the composer and retyping would
  # risk duplicating it.
  # One attempt tries every SEND_LABELS variant before counting as a miss
  # (same both-languages rationale as the composer placeholder).
  local send_ok=false send_attempt
  for send_attempt in $(seq 1 "$max_attempts"); do
    log "Send attempt ${send_attempt}/${max_attempts}: $msg"
    if tap_send; then
      send_ok=true
      break
    fi
    if [ "$send_attempt" -lt "$max_attempts" ]; then
      dump_ui_retry >/dev/null || true
      dismiss_anr
      dismiss_foreign_dialog
      sleep 2
    fi
  done
  if [ "$send_ok" = false ]; then
    log "Send button not found (any of SEND_LABELS) for: $msg"
    return 1
  fi
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

  local dump_ok=1
  if ! adb logcat -d > "$buf" 2>/dev/null; then
    dump_ok=0
    : > "$buf"
    # Marker for the grader: failed capture ≠ empty capture. Do NOT clear the
    # ring buffer so the next turn's capture can still salvage this telemetry.
    : > "$tdir/capture_failed"
  fi

  # telemetry.jsonl — strip the "KALSA_TELEMETRY " prefix so each line is bare JSON.
  grep -F "KALSA_TELEMETRY " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_TELEMETRY //' > "$tdir/telemetry.jsonl" 2>/dev/null || : > "$tdir/telemetry.jsonl"

  # summary.jsonl — rolling-summary lifecycle (KALSA_SUMMARY). Always write the
  # file (empty when none) so absent-file vs empty-capture stay distinguishable.
  grep -F "KALSA_SUMMARY " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_SUMMARY //' > "$tdir/summary.jsonl" 2>/dev/null || : > "$tdir/summary.jsonl"

  # toolcall.jsonl — per-round tool-call counters (KALSA_TOOLCALL). Always write
  # the file (empty when none) so absent-file vs empty-capture stay distinguishable.
  grep -F "KALSA_TOOLCALL " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_TOOLCALL //' > "$tdir/toolcall.jsonl" 2>/dev/null || : > "$tdir/toolcall.jsonl"

  # digest.jsonl — per-digest timing (KALSA_DIGEST). Always write the file
  # (empty when none) so absent-file vs empty-capture stay distinguishable.
  grep -F "KALSA_DIGEST " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_DIGEST //' > "$tdir/digest.jsonl" 2>/dev/null || : > "$tdir/digest.jsonl"

  # memory.jsonl — per-turn memory telemetry (KALSA_MEMORY). Always write the file
  # (empty when none) so absent-file vs empty-capture stay distinguishable.
  grep -F "KALSA_MEMORY " "$buf" 2>/dev/null \
    | sed 's/.*KALSA_MEMORY //' > "$tdir/memory.jsonl" 2>/dev/null || : > "$tdir/memory.jsonl"

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

  # WHY per-turn (not end-of-arm only): the only direct evidence of whether
  # boundaryIndex ever advanced and how much retrieved text (frozenDigest)
  # the arm was given. Assembled-prompt token sizes alone cannot settle the
  # contradiction between code (window shrinks with compaction ON) and
  # measured tokens (run 31379031892 turn 15: v42 larger than baseline).
  # Empty file when the key is absent — baseline reset_chat deletes it at
  # arm start, so anything here came from this run. Never fail a turn over it.
  adb shell "sqlite3 -noheader $DB \"SELECT value FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';\"" 2>/dev/null \
    | tr -d '\r' > "$tdir/compactor_state.json" 2>/dev/null \
    || : > "$tdir/compactor_state.json"

  # Clear only after a successful dump. A failed dump must leave the ring
  # intact so the next capture can salvage; clearing would destroy evidence.
  if [ "$dump_ok" -eq 1 ]; then
    adb logcat -c 2>/dev/null || true
  fi
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
  local expectation="${9:-}"
  python3 -c '
import json, sys
index, kind, tid, prompt, elapsed_s, sources, has_miniapp, reply_path, settled_s = sys.argv[1:10]
expectation = sys.argv[10] if len(sys.argv) > 10 else ""
reply = open(reply_path, encoding="utf-8").read()
# settled_s null when absent (running campaign raw.json has no field yet).
settled = int(settled_s) if settled_s not in ("", "None", "null") else None
expect = expectation if expectation in ("must", "must_not", "either") else None
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
    "expectation": expect,
}
print(json.dumps(rec, ensure_ascii=False))
' "$index" "$kind" "$id" "$prompt" "$elapsed_s" "$sources" "$has_miniapp" "$OUT/.reply_tmp" "$settled_s" "$expectation" \
    >> "$OUT/.turns.jsonl" \
    || die "record_turn python failed for turn $index ($id) — refusing to drop a turn silently"
}

# Wait until the turn is fully settled — ALL of the following on the SAME poll:
#   1. last assistant message JSON byte-identical to the previous poll
#   2. raw uiautomator dump has no ▋ (streaming cursor)
#   3. any COMPOSER_PLACEHOLDERS entry present as a whole text node
#   4. none of BUSY_STATUS_LABELS as whole-line labels
# WHY NOT reasoning headers ("Thinking" / "Sto pensando" / "Ragionamento"): under
# THINKING=budget256 the finished bubble still has a whole text node for the
# collapsed header. wait_ui_idle treated it as live status and burned its full
# 240s cap every turn of smoke run 31358530713 (turnend_timeout_ui.txt while
# composer was already idle). Only that label was wrong — not the
# cursor/placeholder checks. Conditions 2–4 are wait_ui_idle minus reasoning;
# left driver-local so ci-e2e.sh keeps ci-lib.sh.
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
    # Any accepted placeholder language (whole text node).
    if grep -qxFf <(printf '%s\n' "${COMPOSER_PLACEHOLDERS[@]}") "$dump" 2>/dev/null; then
      placeholder_ok=true
    else
      placeholder_ok=false
    fi
    # Whole-line labels only (-x): substring grep hit assistant prose and pinned
    # wait_ui_idle at the cap (see ci-lib.sh). Reasoning headers deliberately
    # omitted — see header comment (run 31358530713 / collapsed header).
    if grep -qxFf <(printf '%s\n' "${BUSY_STATUS_LABELS[@]}") "$dump" 2>/dev/null; then
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

# Run a turn plan: parallel arrays PLAN_KIND / PLAN_ID / PLAN_PROMPT / PLAN_EXPECT
# (1-indexed turns). PLAN_EXPECT is the tool-call expectation (must|must_not|either)
# and is recorded on the turn so graders never infer it from prompt text.
# Shared by fase4 and smoke so the conversation length is the only difference.
# Per-turn ceiling 2400s (not 1500): run 31367691176 saw TTFT of 624 s at turn 13
# with thinking on, so 1500 s had no margin. fase0 still uses 1500 below.
run_turn_plan() {
  local i n msg
  n=${#PLAN_PROMPT[@]}
  for i in $(seq 0 $((n - 1))); do
    local turn=$((i + 1))
    msg="${PLAN_PROMPT[$i]}"
    log "=== turn $turn/${n} kind=${PLAN_KIND[$i]} id=${PLAN_ID[$i]} expect=${PLAN_EXPECT[$i]} ==="
    # 1) first persistence (latency) 2) idle 3) re-read settled 4) evidence 5) record
    send_and_wait "$msg" 2400 || die "timeout/failure on turn $turn (${PLAN_ID[$i]})"
    settle_turn_reply
    capture_turn_evidence "$turn"
    record_turn "$turn" "${PLAN_KIND[$i]}" "${PLAN_ID[$i]}" "$msg" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP" \
      "${SAW_SETTLED_S:-}" "${PLAN_EXPECT[$i]}"
    # Pure idle between turns (no adb/UI) so SUMMARY_IDLE_DEBOUNCE can fire.
    # Skipped after the final turn — wall-clock only, no more prompts to type.
    if [ "$turn" -lt "$n" ] && [ "$INTER_TURN_DELAY_S" -gt 0 ]; then
      log "inter-turn idle ${INTER_TURN_DELAY_S}s (after turn $turn/${n})"
      sleep "$INTER_TURN_DELAY_S"
    fi
  done
}

# Base filler list (alphanumeric only — adb input text mangles punctuation).
# 8 fillers as RESEARCH_CONTEXT_LOSS Fase 4 specifies. With thinking off,
# replies are much shorter, so the extra turns keep context pressure on the
# baseline — the point of the experiment is whether the baseline loses the facts.
FILLER_BASE=(
  MotoreElettrico
  RicettaVeloce
  BeneficiSport
  CuriositaSpazio
  ViaggioInTreno
  ClimaOMeteo
  StoriaAntica
  MusicaClassica
)

# Rotate filler list left by (SEED-1) mod 8. Both arms of a paired A/B use the
# SAME SEED → same rotation, so the only intentional difference is the factor
# under test (e.g. compaction on|off), not filler order.
FILLER_ROTATION=$(( (SEED - 1) % 8 ))
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
    # Once per arm (first run only): fail fast on UI-language mismatch.
    if [ "$run" -eq 1 ]; then
      assert_input_path_ready
    fi

    global_turn=$((global_turn + 1))
    send_and_wait "$PLANT" 1500 || die "run $run: timeout/failure on plant turn"
    settle_turn_reply
    capture_turn_evidence "$global_turn"
    record_turn "$global_turn" "plant" "plant" "$PLANT" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
    # More turns remain (fillers + probe) — pure idle for summary debounce.
    if [ "$INTER_TURN_DELAY_S" -gt 0 ]; then
      log "inter-turn idle ${INTER_TURN_DELAY_S}s"
      sleep "$INTER_TURN_DELAY_S"
    fi

    for i in "${!F0_FILLERS[@]}"; do
      f="${F0_FILLERS[$i]}"
      global_turn=$((global_turn + 1))
      send_and_wait "$f" 1500 || die "run $run: timeout/failure on filler $((i+1))"
      settle_turn_reply
      capture_turn_evidence "$global_turn"
      record_turn "$global_turn" "filler" "filler_$((i+1))" "$f" \
        "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
      # Probe still remains after every filler — idle before next prompt.
      if [ "$INTER_TURN_DELAY_S" -gt 0 ]; then
        log "inter-turn idle ${INTER_TURN_DELAY_S}s"
        sleep "$INTER_TURN_DELAY_S"
      fi
    done

    global_turn=$((global_turn + 1))
    send_and_wait "$PROBE" 1500 || die "run $run: timeout/failure on probe turn"
    settle_turn_reply
    capture_turn_evidence "$global_turn"
    record_turn "$global_turn" "probe" "probe" "$PROBE" \
      "$SAW_ELAPSED" "$SAW_SOURCES" "$SAW_MINIAPP"
    # No inter-turn delay after final turn of the run.
  done

elif [ "$PHASE" = "fase4" ] || [ "$PHASE" = "smoke" ]; then
  # Build the turn plan as lists; phase only chooses which plan (no loop copy-paste).
  PLAN_KIND=()
  PLAN_ID=()
  PLAN_PROMPT=()
  PLAN_EXPECT=()
  # $4 = must | must_not | either — travels in raw.json; do not infer from prompt.
  plan_add() { PLAN_KIND+=("$1"); PLAN_ID+=("$2"); PLAN_PROMPT+=("$3"); PLAN_EXPECT+=("$4"); }

  # Plants — alphanumeric + spaces only (adb shell input text mangles punctuation).
  plan_add plant plant_a \
    "Ricorda questi dati il gatto si chiama Leopoldo il budget e 4500 euro la citta e Torino il codice e PK42" \
    must_not
  if [ "$PHASE" = "fase4" ]; then
    plan_add plant plant_b \
      "Ricorda anche il colore e Zaffiro il modello e XR9 il porto e Brindisi il vino e Nebbiolo" \
      must_not
    for i in "${!FILLERS[@]}"; do
      plan_add filler "filler_$((i+1))" "${FILLERS[$i]}" either
    done
    # Fact-probe layout vs LEGACY_MAX_HISTORY = 20 (src/context/compactor.ts:128;
    # baseline arm uses messages.slice(-LEGACY_MAX_HISTORY) at :436-443 when
    # compactionEnabled is false). Evidence: run 31379031892 — a single mid-
    # conversation probe sat inside the baseline window (fact_recall noise:
    # 1,1,0.5,1,0,0.75), so the A/B could not show whether compaction recovers
    # facts. Arithmetic for a 16-turn conversation (2 plants + 8 fillers + 6
    # probes; each turn = user + assistant → 2 messages):
    #   turn 11 → 21 messages in history. slice(-20) keeps indices 1..20:
    #     plants (0,2) and their assistant echoes (1,3) are still inside the
    #     baseline window → CONTROL (both arms should pass; if not, the probe
    #     itself is broken).
    #   turn 16 → 31 messages. slice(-20) keeps indices 11..30: plants AND
    #     echoes are outside the baseline window → only retrieval can supply
    #     the facts. DISCRIMINATING probe (primary endpoint).
    plan_add probe probe_facts_early \
      "Ripeti tutti i dati che ti ho dato nei primi due messaggi" \
      must_not
    plan_add probe probe_tool \
      "Cerca sul web le previsioni del meteo di domani a Milano" \
      must
    plan_add probe probe_miniapp \
      "Fammi un quiz di tre domande sulla geografia" \
      must_not
    plan_add probe probe_language \
      "In quale continente si trova il Brasile e perche" \
      must_not
    plan_add probe probe_honesty \
      "Chi ha vinto il premio Zorblax nel 2019" \
      either
    plan_add probe probe_facts_late \
      "Ripeti tutti i dati che ti ho dato nei primi due messaggi" \
      must_not
  else
    # smoke: 2 plants + every campaign probe family (7 turns, ≤ 9).
    # WHY not 5: a smoke that only grades facts de-risks a different
    # thing than the campaign measures (same class as a78f126 — thinking
    # mode mismatch). Fillers omitted: not needed for grader dispatch
    # (ids) or fact-probe wording ("primi due messaggi"). 7 turns still
    # past the turn 3–4 settle window that 3-turn smoke missed
    # (31358530713 green vs 31361781643 dead).
    # Prompt/id strings below are copied from the fase4 branch — graders
    # dispatch on turn id; do not invent wording.
    FACTS_JSON='["Leopoldo","4500","Torino","PK42","Zaffiro","XR9","Brindisi","Nebbiolo"]'
    plan_add plant plant_b \
      "Ricorda anche il colore e Zaffiro il modello e XR9 il porto e Brindisi il vino e Nebbiolo" \
      must_not
    plan_add probe probe_facts \
      "Ripeti tutti i dati che ti ho dato nei primi due messaggi" \
      must_not
    plan_add probe probe_tool \
      "Cerca sul web le previsioni del meteo di domani a Milano" \
      must
    plan_add probe probe_miniapp \
      "Fammi un quiz di tre domande sulla geografia" \
      must_not
    plan_add probe probe_language \
      "In quale continente si trova il Brasile e perche" \
      must_not
    plan_add probe probe_honesty \
      "Chi ha vinto il premio Zorblax nel 2019" \
      either
  fi

  new_conversation
  adb logcat -c 2>/dev/null || true
  # Fail-fast before any turn: UI-string mismatch must not burn a 12-arm matrix.
  assert_input_path_ready
  run_turn_plan

elif [ "$PHASE" = "mem" ]; then
  # Memory subsystem benchmark: measure whether memory extract/inject carries
  # user facts when the verbatim window has evicted them.
  # Plants: facts about the USER (name, job, preference, language, interest)
  # plus a sensitive plant (IBAN) that should be rejected by isSensitiveFact.
  # Probes: after 8 fillers, all plants are outside legacywindow=16.
  PLAN_KIND=()
  PLAN_ID=()
  PLAN_PROMPT=()
  PLAN_EXPECT=()
  plan_add() { PLAN_KIND+=("$1"); PLAN_ID+=("$2"); PLAN_PROMPT+=("$3"); PLAN_EXPECT+=("$4"); }

  # Plant A: name, job, preference — distinctive tokens (Teodoro, orologiaio)
  # that cannot be guessed from general knowledge.
  plan_add plant plant_a \
    "Mi chiamo Teodoro lavoro come orologiaio e mi piace il cibo piccante" \
    must_not
  # Plant B: language, color, pet — distinctive tokens (indaco, basenji)
  plan_add plant plant_b \
    "Parlo italiano e il mio colore preferito e l indaco ho un cane di razza basenji" \
    must_not
  # Plant C: sensitive data (IBAN) — should be rejected by isSensitiveFact.
  # IT60X054281110100000012345 matches the IBAN regex: [A-Z]{2}\d{2}[A-Z0-9]{10,30}
  plan_add plant plant_sensitive \
    "Il mio iban e IT60X054281110100000012345" \
    must_not
  # 8 fillers to push plants outside legacywindow=16
  for i in "${!FILLERS[@]}"; do
    plan_add filler "filler_$((i+1))" "${FILLERS[$i]}" either
  done
  # Probe 1: identity (name + job) — must answer from memory
  # Turn 12: messages 22,23. slice(-16) keeps 8..23. Plants at 0..5 are OUTSIDE.
  plan_add probe probe_facts \
    "Come mi chiamo e che lavoro faccio" \
    must_not
  # Probe 2: preference (color + pet) — must answer from memory
  plan_add probe probe_facts \
    "Qual e il mio colore preferito e che razza di cane ho" \
    must_not
  # Probe 3: sensitive (IBAN) — should NOT contain the IBAN (was rejected by filter)
  plan_add probe probe_sensitive \
    "Ti ho dato un codice bancario nei messaggi precedenti" \
    must_not

  # Facts for grading: distinctive tokens from plants A and B
  FACTS_JSON='["Teodoro","orologiaio","indaco","basenji"]'

  new_conversation
  adb logcat -c 2>/dev/null || true
  assert_input_path_ready
  run_turn_plan

elif [ "$PHASE" = "tools" ]; then
  # Tool-use benchmark: measure whether the model calls tools at the right time
  # and picks the right tool. Three families:
  #   - tool_required: answer not in conversation, MUST call tool
  #   - tool_forbidden: answer is general knowledge or in conversation, MUST NOT call
  #   - tool_selection: tool required, only one of three is right
  # Several turns of each kind so a rate is meaningful.
  PLAN_KIND=()
  PLAN_ID=()
  PLAN_PROMPT=()
  PLAN_EXPECT=()
  plan_add() { PLAN_KIND+=("$1"); PLAN_ID+=("$2"); PLAN_PROMPT+=("$3"); PLAN_EXPECT+=("$4"); }

  # Plant turns: provide context for forbidden (recall) and selection (document_chat)
  plan_add plant plant_a \
    "Ricorda questi dati il progetto X ha budget 1000 euro e deadline dicembre 2024" \
    must_not
  plan_add plant plant_doc \
    "Ecco un documento il progetto Alpha ha budget 5000 euro e scadenza marzo 2025 ricorda queste informazioni" \
    must_not

  # Required turns (4): answer not in conversation, must call tool
  plan_add probe tool_required_weather \
    "Qual è la temperatura attuale a Roma" \
    must
  plan_add probe tool_required_price \
    "Qual è il prezzo attuale del bitcoin" \
    must
  plan_add probe tool_required_page \
    "Apri la pagina https example com" \
    must
  plan_add probe tool_required_news \
    "Quali sono le notizie di oggi" \
    must

  # Forbidden turns (5): answer is general knowledge or in conversation, must not call
  plan_add probe tool_forbidden_capital \
    "Qual è la capitale della Francia" \
    must_not
  plan_add probe tool_forbidden_math \
    "Quanto fa due piu due" \
    must_not
  plan_add probe tool_forbidden_haiku \
    "Scrivi un haiku sul mare" \
    must_not
  plan_add probe tool_forbidden_recall \
    "Ripetimi i dati del progetto X che ti ho dato prima" \
    must_not
  plan_add probe tool_forbidden_history \
    "Chi ha dipinto la Gioconda" \
    must_not

  # Selection turns (3): tool required, only one of three is right
  plan_add probe tool_sel_web_search \
    "Cosa sta succedendo nel mondo oggi" \
    must
  plan_add probe tool_sel_web_fetch \
    "Leggi https example com e riassumila" \
    must
  plan_add probe tool_sel_document_chat \
    "Cosa dice il documento riguardo al budget del progetto Alpha" \
    must

  new_conversation
  adb logcat -c 2>/dev/null || true
  assert_input_path_ready
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
turns_path, out_path, compactor_chars, summary_chars, locale_pref_raw, toolgate_pref_raw = sys.argv[13:19]

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
    # On-device locale the app actually read (see set_prefs kalsa.locale seed).
    # Empty string when the key was absent — grader notes when not "it".
    "localePrefRaw": locale_pref_raw,
    # On-device toolgate read-back (TOOLGATE_PREF_RAW), not the requested env.
    # Grader lifts this to result.toolGateActive; the label is not evidence.
    "toolgatePrefRaw": toolgate_pref_raw,
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
  "$OUT/.turns.jsonl" "$OUT/raw.json" "$COMPACTOR_CHARS" "$SUMMARY_CHARS" "$LOCALE_PREF_RAW" \
  "$TOOLGATE_PREF_RAW" \
  || die "failed to write raw.json — refusing to grade stale or missing data"

# Grading is out-of-band: a raw.json that cannot be graded is a failed arm.
if ! node scripts/benchGrade.mjs "$OUT/raw.json" > "$OUT/result.json"; then
  die "benchGrade.mjs failed — raw.json cannot be graded (see raw.json + grader stderr)"
fi

# WHY: a green arm that measured nothing is worse than a failed one — the
# aggregate would treat it as data (run 31420693167 would have reported
# "recall 0 on both arms of the 4B" while every turn was ⚠️ model-missing).
# Grader already flags errorTurns/emptyReplyTurns; act on them here. Do not
# change the grader. Threshold: more than half of plan turns error or empty.
_bad_arm_msg=$(python3 -c '
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
raw = json.load(open(sys.argv[2], encoding="utf-8"))
err = set(r.get("errorTurns") or [])
empty = set(r.get("emptyReplyTurns") or [])
bad = err | empty
turns = r.get("turns") or raw.get("turns") or []
n = len(turns)
if n <= 0 or len(bad) <= n / 2.0:
    sys.exit(0)
# Prefer first errorTurn for the named reply; else first empty.
first_idx = min(err) if err else min(empty)
reply = ""
for t in (raw.get("turns") or []):
    if t.get("index") == first_idx:
        reply = t.get("reply") or ""
        break
print(
    "arm measured nothing: %d/%d turns error-or-empty (threshold > half); "
    "first bad turn %s reply: %s"
    % (len(bad), n, first_idx, reply[:300])
)
sys.exit(1)
' "$OUT/result.json" "$OUT/raw.json" 2>/dev/null) || die "${_bad_arm_msg:-arm measured nothing (error/empty turns > half)}"

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
