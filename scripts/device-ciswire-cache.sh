#!/usr/bin/env bash
# ciswire's retrieval leg on a real phone: does it produce content, and what does
# the KV cache do while it runs? One phone, one model, one regime per run.
#
# WHY THIS EXISTS
#   `ciswire` is the legacy sliding window plus a BM25 query digest; `anchored` is
#   the boundary->end window that replaced the dead `v42` regime. v42's rolling
#   summary logged summaryChars = 0 on every arm of every campaign
#   (compactor.ts:292, HARNESS_FINDINGS 7.12): half the regime never ran, and no
#   run could say so, because a regime whose content is empty produces exactly the
#   same prompts as one whose content was never built. Every claim below therefore
#   rides a number read back off the device, never a boolean the app sets about
#   itself. The one flag it does read (KALSA_WINDOW `hasDigest`) is policy
#   (retrievalOn && !kvHeld) and is true whether or not the digest has any text.
#
# CAPTURED PER TURN (columns of turns.tsv; evidence.txt keeps the same lines)
#   KALSA_WINDOW      kvHeld, nPast, hasDigest, legacyWindowStart, and — anchored
#                     only — historyDropped + rebuildBudgetSource/Chars. This is
#                     the per-send boundary signal. KALSA_WINDOW_SLIDE fires only
#                     at the token ceiling and is NOT the boundary.
#   KALSA_KVPREFIX    embd=<total> text_tokens=<prompt> n_common=<reused>, i.e.
#                     "reused X/Y". Fallback order: `Input processed: n_past=…,
#                     embd.size=…`, then KALSA_KVDIAG n_common=/total=. The column
#                     reuse_src names which one answered.
#   KALSA_TELEMETRY   promptMs, prompt_n, tokensCached, tokensEvaluated,
#                     ciswireFlags (bit0 == this run is ciswire).
#   storage           kalsa.chat.compactor.<chatId> + kalsa.chat.summary.<chatId>,
#                     read over adb; only LENGTHS are kept as digestChars /
#                     summaryChars / summaryKeyChars. builtAtUserTurn and
#                     boundaryIndex exist only there — no log line carries them.
#   KALSA_DIGEST      selectedCount / corpusSize, so "the builder never ran" (no
#                     line at all) stays distinct from "it ran and selected
#                     nothing" (selectedCount=0).
#
# ARITHMETIC THAT MAKES THE RUN MEANINGFUL
#   A slide needs the charged window to cross the ceiling: at n_ctx=8192 that is
#   8192 - 2048 (WINDOW_RESERVE_TOKENS) - ~1832 (system prompt) = ~4312 tokens =
#   ~12936 charged chars at WINDOW_CHARS_PER_TOKEN=3. PROMPT_CHARS=2000 crosses it
#   near turn 7 and 14 turns cross it twice. If it never crosses — or the device
#   loaded 16384 — `boundary_reached` FAILS and the run is reported as vacuous
#   instead of quietly green. Raise PROMPT_CHARS or TURNS.
#
# STORAGE IS NOT INJECTION (the one false PASS this harness must never emit)
#   AppShell persists the digest/summary BEFORE deciding to inject, and
#   `operativeContextForLiveKv` (src/engine/windowKvInvariant.ts:294) returns null
#   while the live chat KV is held — `if (args.kvHeld) return null;`. A non-empty
#   digest and an injected digest are therefore different events, and the KV is
#   normally held. The app's gate inputs are on the device: KALSA_WINDOW
#   `hasDigest` is `retrievalOn && !kvHeld`, and a SUCCESSFUL slide clear
#   (`kvCleared:true`) also lets the block ride. So a row counts as injected only
#   when the content exists AND one of those holds; otherwise it is recorded as
#   storage-only (injected=-1) and `operative_content` FAILS on a run that never
#   injected. Storage length alone never passes it.
#
#   Same rule for slides: AppShell emits KALSA_WINDOW_SLIDE even when the clear
#   failed (AppShell.tsx ~6335 `kvCleared: slideOk`), so only `kvCleared:true` is a
#   clean slide, only a clean slide grants a reprefill exemption, and a
#   failed-clear slide FAILS (`slide_cleared`).
#
# kalsa.bench.kvtranscript (checked on disk, not assumed)
#   device-share-send.sh:14-16 names this flag as the difference between a ~2 s
#   session load and an ~80 s re-prefill after the `am start` that backgrounds RN
#   and disposes the engine, so this harness writes it, reads it back and aborts if
#   it is not "1" (scripts/campaign/flags.sh:76/139 does the same). Recorded here
#   because the key is NOT read by this APK: it is absent from src/, from
#   benchConfig.ts's key list and from the shipped bundle (0 occurrences in
#   assets/index.android.bundle), while session save/load is unconditional. The
#   write is defensive; the read-back lands in run.meta.tsv either way.
#
# THE VERDICT, AND THE FLIP THAT PROVES IT CAN GO RED
#   `--self-test` runs the SHIPPED cw_verdict (and the capture extractors) on
#   canned capture lines with no device present, and asserts PASS/FAIL per case.
#   The mutations it must catch: summaryChars=0 on every row (the v42 shape), a
#   full re-prefill with no slide to explain it, and a ciswireFlags/regime
#   mismatch. One production line flips a healthy run: `shouldInjectOperativeBlock`
#   (src/context/compactor.ts) returning false stops the operative block riding the
#   last user message, so digestChars is 0 on every turn and `operative_content`
#   FAILS. Letting the capture lose W-level lines (KALSA_KVPREFIX, KALSA_PREWARM)
#   makes `reuse_recorded` FAIL and every reuse_state read "none".
#
# PASS REQUIRES (every check is computed from the captured numbers, can fail, and
# any failure is named in `failed=`)
#   turn_count window_signal telemetry_signal engine_alive
#   reuse_recorded (every completed row)  reuse_matched (line tied to the turn, not
#                                         to the prewarm queued before it)
#   regime_identity (flags bit0)          arm_isolated (bits 1/2 off)
#   boundary_reached slide_observed       slide_cleared (kvCleared true)
#   reprefill_without_slide               operative_read (ALL rows readable)
#   digest_telemetry_present operative_content (INJECTED, not stored)
#   ciswire_summary_leg reply_complete reply_not_interrupted assistant_progress
#   (ciswire) | anchored_no_operative_content anchored_no_digest_build (anchored)
#   restore_exercised
#
# DEVICE SAFETY (hard rules — these are the owner's phones)
#   keep-awake armed before the first adb write; `</dev/null` on every adb call
#   (main also does `exec </dev/null`, so the sourced helpers inherit it). Never
#   measure on charge: AC/USB/wireless are read before the run and by the watchdog,
#   and an unreadable power field is an ABORT, not a licence (AC false with USB
#   true still charges). Battery floor 25%; thermal SEVERE (>=3) or 44.0 C aborts.
#   BOTH gates are fail-CLOSED here: an unreadable thermal status aborts instead of
#   being read as 0/cool (the Jelly cannot afford that), and only an unambiguous
#   mWakefulness=Awake passes — an unreadable probe is fatal in this harness even
#   though ci-lib's shared wakefulness_is_fatal is fail-open for other callers.
#   cw_keepawake_begin refuses to run before that gate, so no KEYCODE_WAKEUP can
#   reach a locked phone.
#   No KEYCODE_POWER / KEYCODE_SLEEP / `svc power` / reboot: the Xiaomi is
#   lock-password protected, so a non-Awake mWakefulness aborts instead. The S23's
#   adsprpcd/cdsprpcd spin a core at ~100% with the app idle: their cumulative
#   /proc ticks go in every row as bg_cpu_ticks and are reported first->last,
#   never subtracted.
#
# PRIVACY
#   The conversation is seeded and synthetic (cw_prompt: every word derives from
#   SEED and the turn number), so no user text can reach the model or an artifact.
#   Raw logcat lives in a mktemp file outside $OUT and the EXIT trap removes it;
#   evidence.txt receives counter-only lines by construction. KALSA_KVDIAG0 (token
#   ids) and KALSA_KVDIVERGE (ids + detokenized text in a debug build) are never
#   copied whole — only their digit-shaped prefixes. The chatId is used for SQL
#   reads and never reaches a filename, a log line or the TSV. The APK is
#   identified by bytes + sha256.
#
# EXIT  0 PASS | 4 FAIL | 3 ABORTED (device safety, mid-run) | 1 env/usage
#
# USAGE
#   ANDROID_SERIAL=<serial> scripts/device-ciswire-cache.sh [APK]
#   CONTEXT_MODE=ciswire|anchored MODEL_DIR=... MODEL_FILE=... TURNS=14
#   PROMPT_CHARS=2000 SEED=... CW_OUT_DIR=<dir>       one arm -> one directory
#   scripts/device-ciswire-cache.sh --self-test       verdict fixture, no device
#   scripts/device-ciswire-cache.sh --verdict-only turns.tsv
#   scripts/device-ciswire-cache.sh --compare <dirA> <dirB>
set -uo pipefail

_CW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-share-send.sh
source "$_CW_DIR/device-share-send.sh"

# Set AFTER sourcing and unconditionally: device-share-send.sh already defaulted
# OUT to its own directory at source time, so `${OUT:-…}` here would silently keep
# that one and the artifacts would land in the wrong place (the same trap
# device-prefill-threads.sh records).
OUT="${CW_OUT_DIR:-device-ciswire-cache-out}"
ACTIVITY="${ACTIVITY:-com.kalsa.app/.MainActivity}"

# ── knobs ────────────────────────────────────────────────────────────
APK="${APK:-/Users/marco/kalsa-apks/35444615003/app-release.apk}"
MODEL_DIR="${MODEL_DIR:-qwen3.5-4b}"
MODEL_FILE="${MODEL_FILE:-Qwen3.5-4B-Q4_K_M.gguf}"
CONTEXT_MODE="${CONTEXT_MODE:-ciswire}"
TURNS="${TURNS:-14}"
PROMPT_CHARS="${PROMPT_CHARS:-2000}"
SEED="${SEED:-20260919}"
REPLY_TIMEOUT="${REPLY_TIMEOUT:-600}"
READY_TIMEOUT="${READY_TIMEOUT:-240}"
# The turn-end signal is KALSA_TELEMETRY in the local capture, so polling costs
# the phone nothing; the DB (which costs an adb pull) is only touched as a
# fallback and once per turn for the compactor state.
TURN_END_POLL_S="${TURN_END_POLL_S:-3}"
TURN_END_DB_POLL_S="${TURN_END_DB_POLL_S:-30}"
RESET_CONVERSATION="${RESET_CONVERSATION:-1}"

# Owner stop rules (same numbers device-restore-protocol.sh enforces: WARN 40.0,
# STOP 44.0, thermal SEVERE).
CW_TEMP_WARN_DECI="${CW_TEMP_WARN_DECI:-400}"
CW_TEMP_STOP_DECI="${CW_TEMP_STOP_DECI:-440}"
CW_THERMAL_STOP="${CW_THERMAL_STOP:-3}"
CW_BATTERY_FLOOR="${CW_BATTERY_FLOOR:-25}"
CW_WD_INTERVAL="${CW_WD_INTERVAL:-10}"

CW_EXIT_PASS=0
CW_EXIT_ABORT=3
CW_EXIT_FAIL=4

# ── persisted logging ────────────────────────────────────────────────
# Append inside the helper, never `exec > >(tee …)`: process substitution
# detaches the writer and breaks the exit-status contract main's callers use.
# The stdout shape stays ci-lib's log ("[ci] " prefix).
CW_LOG_FILE=""
CW_LOG_OK=0
log() {
  echo "[ci] $*"
  # Gated on the once-checked CW_LOG_OK so an unwritable log warns once at setup
  # instead of once per line.
  if [ "$CW_LOG_OK" = 1 ]; then
    printf '%s\n' "[ci] $*" >> "$CW_LOG_FILE"
  fi
}

# Device-safety abort: distinct from a measurement FAIL and from an env error.
cw_abort() {
  printf 'verdict=ABORTED reason=%s\n' "$*" >&2
  log "ABORT: $*"
  if [ "$CW_LOG_OK" = 1 ]; then
    printf 'verdict=ABORTED reason=%s\n' "$*" >> "$OUT/VERDICT.txt"
  fi
  exit "$CW_EXIT_ABORT"
}

# ── pure parsers ─────────────────────────────────────────────────────
# NOTE for whoever edits this file: the awk bodies below are single-quoted bash
# strings, so an apostrophe inside one (even in a comment) closes the string and
# bash parses the rest as shell. `bash -n` catches it; it was hit twice while
# writing this script, on the words "assert_engine_ran's" and "file's".
#
# Value or "-" for absent: "the app never emitted the field" and "the field was 0"
# are different findings and must not look the same in the artifacts. JSON.stringify
# omits undefined members, so an absent key is the normal encoding of "none".
cw_or_dash() {
  if [ -z "${1:-}" ]; then printf '%s\n' "-"; else printf '%s\n' "$1"; fi
}

# Last numeric value of "key":N in a file (targeted scan; no jq dependency).
cw_json_num() {
  local file="$1" key="$2" v=""
  v=$(grep -oE "\"$key\":-?[0-9]+" "$file" 2>/dev/null | tail -1 \
        | sed -E 's/.*:(-?[0-9]+)$/\1/') || true
  printf '%s\n' "$v"
}

# Last "key":true|false in a file; empty when absent.
cw_json_bool() {
  local file="$1" key="$2" v=""
  v=$(grep -oE "\"$key\":(true|false)" "$file" 2>/dev/null | tail -1 \
        | sed -E 's/.*:(true|false)$/\1/') || true
  printf '%s\n' "$v"
}

# Last "key":"…" in a file. Values here are app constants ("ceiling", "profile",
# the history-drop reason); no escapes are expected.
cw_json_str() {
  local file="$1" key="$2" v=""
  v=$(grep -oE "\"$key\":\"[^\"]*\"" "$file" 2>/dev/null | tail -1 \
        | sed -E 's/.*:"([^"]*)"$/\1/') || true
  printf '%s\n' "$v"
}

cw_count() {
  local file="$1" needle="$2" n=""
  n=$(grep -cF -- "$needle" "$file" 2>/dev/null) || true
  case "${n:-}" in ''|*[!0-9]*) printf '%s\n' 0 ;; *) printf '%s\n' "$n" ;; esac
}

# Count lines carrying <needle> AFTER the last occurrence of <marker> in the live
# capture, starting from $CW_SLICE_OFF. Used for the turn-end watch: counting over
# the whole file would let the previous turn's KALSA_TELEMETRY (the few hundred ms
# between the offset snapshot and the begin marker) end this turn instantly.
cw_count_after_marker() {
  local marker="$1" needle="$2" n=""
  n=$(tail -c "+$((CW_SLICE_OFF + 1))" "$CW_LOGCAT" 2>/dev/null \
      | awk -v m="$marker" -v nd="$needle" '
          index($0, m) { c = 0; seen = 1; next }
          { if (seen && index($0, nd)) c++ }
          END { print (seen ? c + 0 : 0) }
        ') || n=0
  case "${n:-}" in ''|*[!0-9]*) printf '%s\n' 0 ;; *) printf '%s\n' "$n" ;; esac
}

# "embd text_tokens n_common" of the LAST KALSA_KVPREFIX line. Last, not first:
# the static-prefix prewarm is queued in front of the send's completion and emits
# its own KVPREFIX, so the chat turn's line is the last one (the same attribution
# rule as ci-lib's capture_kv_reuse). kvprefix_count records how many lines the
# slice held, so a reader can see when that attribution was a guess.
cw_kvprefix_last() {
  grep -oE 'KALSA_KVPREFIX embd=[0-9]+ text_tokens=[0-9]+ n_common=[0-9]+' "$1" 2>/dev/null \
    | tail -1 | sed -E 's/.*embd=([0-9]+) text_tokens=([0-9]+) n_common=([0-9]+)$/\1 \2 \3/'
}

# "n_past embd_size" of the LAST Input-processed line (same attribution rule).
cw_inputprocessed_last() {
  grep -oE 'Input processed: n_past=[0-9]+, embd\.size=[0-9]+' "$1" 2>/dev/null \
    | tail -1 | sed -E 's/.*n_past=([0-9]+), embd\.size=([0-9]+)$/\1 \2/'
}

cw_kvdiag_last() {
  grep -oE 'KALSA_KVDIAG n_common=[0-9]+ total=[0-9]+' "$1" 2>/dev/null | tail -1 \
    | sed -E 's/.*n_common=([0-9]+) total=([0-9]+)$/\1 \2/'
}

# ── pure decisions (each one is exercised by cw_selftest) ────────────

# Is this a KALSA_WINDOW_SLIDE payload whose clear actually SUCCEEDED?
#   "1"  kvCleared true  — the KV really went away, so a reprefill after it is
#         explained
#   "0"  kvCleared false — AppShell emits the marker even when the clear failed
#         (kvCleared: slideOk), which is the failure this harness hunts
#   "-"  no marker in the slice (no slide this turn)
#   "?"  marker present but the flag is unreadable
cw_slide_cleared() {
  local file="$1" kv
  [ "$(cw_count "$file" 'KALSA_WINDOW_SLIDE ')" -gt 0 ] || { printf '%s\n' "-"; return 0; }
  kv=$(cw_json_bool "$file" kvCleared)
  case "$kv" in
    true) printf '%s\n' 1 ;;
    false) printf '%s\n' 0 ;;
    *) printf '%s\n' "?" ;;
  esac
}

# Bits of a KALSA_TELEMETRY ciswireFlags value, as "bit0 bit1 bit2". Absent
# flags mean 0 (anchored/off: JSON.stringify omits a falsy member).
cw_flag_bits() {
  local flags="${1:-}"
  case "$flags" in ''|*[!0-9]*) flags=0 ;; esac
  printf '%s %s %s\n' "$((flags & 1))" "$(((flags >> 1) & 1))" "$(((flags >> 2) & 1))"
}

# Did ciswire actually put its content INTO THE PROMPT this turn?
#   1  injected   non-empty content AND the app's injection gate was open
#   0  empty      there was no content to inject
#  -1  storage    content is persisted but injection is NOT proven
#
# WHY THIS IS NOT JUST "digestChars > 0": AppShell persists the digest/summary
# before deciding to inject, and `operativeContextForLiveKv`
# (src/engine/windowKvInvariant.ts:294) returns null while the live chat KV is
# held — `if (args.kvHeld) return null;`. The KV is normally held, so a non-empty
# digest and an injected digest are different events. The app's own gate inputs
# are on the device: KALSA_WINDOW `hasDigest` == `retrievalOn && !kvHeld`, and a
# successful slide clear (`kvCleared:true`) also lets the block ride
# (AppShell applies `kvHeld: nativeClearedForAssemble ? false : kvHeld`).
# Anything else is reported as storage-only and never counted as ciswire working.
cw_injected_state() {
  local content="${1:-0}" has_digest="${2:-}" kv_cleared="${3:-}"
  case "$content" in ''|*[!0-9]*) content=0 ;; esac
  if [ "$content" -eq 0 ]; then
    printf '%s\n' 0
    return 0
  fi
  if [ "$has_digest" = "true" ] || [ "$kv_cleared" = "1" ]; then
    printf '%s\n' 1
    return 0
  fi
  printf '%s\n' -1
}

# Classify a turn's reuse from reused/total tokens. "none" when either number is
# missing — a missing figure is NOT evidence of reuse, and the verdict treats it
# as a failed signal rather than as "nothing to see".
cw_reuse_state() {
  local n="${1:-}" total="${2:-}"
  case "$n" in ''|*[!0-9]*) printf '%s\n' none; return 0 ;; esac
  case "$total" in ''|*[!0-9]*) printf '%s\n' none; return 0 ;; esac
  if [ "$total" -eq 0 ]; then printf '%s\n' none
  elif [ "$n" -eq "$total" ]; then printf '%s\n' whole
  elif [ "$n" -gt 0 ]; then printf '%s\n' partial
  else printf '%s\n' reprefill
  fi
}

# FAIL-CLOSED thermal predicate: only a read numeric status strictly below the
# SEVERE threshold passes. "unknown"/empty is NOT cool — the Jelly overheats fast
# and an unreadable thermalservice must never be read as a safe phone.
cw_thermal_ok() {
  local t="${1:-}"
  case "$t" in
    ''|unknown|*[!0-9]*) return 1 ;;
  esac
  [ "$t" -lt "$CW_THERMAL_STOP" ]
}

# FAIL-CLOSED wakefulness gate. ci-lib's wakefulness_is_fatal is deliberately
# fail-OPEN on ""/unknown (its contract, relied on by other callers) and this
# harness must not inherit that: the Xiaomi is lock-password protected and the
# keep-awake path sends KEYCODE_WAKEUP (ci-lib.sh:1149), so proceeding on an
# unreadable probe could wake a locked phone. Only an unambiguous Awake passes.
cw_wakefulness_ok() {
  case "${1:-}" in
    Awake) return 0 ;;
    *) return 1 ;;
  esac
}

# The wake-event invariant, enforced rather than documented: keep-awake (and
# therefore any KEYCODE_WAKEUP) may only run after the safety gate passed.
cw_keepawake_gate_ok() {
  [ "${CW_SAFETY_GATE:-0}" = "1" ]
}

cw_keepawake_begin() {
  if ! cw_keepawake_gate_ok; then
    printf 'FATAL: keep-awake (which sends KEYCODE_WAKEUP) must not run before the wakefulness gate passed\n' >&2
    return 1
  fi
  device_keepawake_begin
}

# Charging state from a dumpsys battery blob: true | false | unknown.
# Anchored like device-env.sh's parsers (its own comment: "never scrape digits off
# the whole dump") — the first occurrence of each key is the service-state block;
# every later occurrence is a Battery History line. ALL THREE keys must be
# present, because AC can be false while USB is true and that state charges. An
# incomplete triple reports `unknown`, which callers must treat as an abort rather
# than as unplugged. device-env.sh has no standalone AC reader (its AC read lives
# inside capture_sysprobe_snapshot's remote probe), so this one parse is local.
cw_plugged_from_dump() {
  awk '
    /^[[:space:]]+AC powered:[[:space:]]*[a-z]+[[:space:]]*$/ {
      if (!("ac" in v)) v["ac"] = $3
    }
    /^[[:space:]]+USB powered:[[:space:]]*[a-z]+[[:space:]]*$/ {
      if (!("usb" in v)) v["usb"] = $3
    }
    /^[[:space:]]+Wireless powered:[[:space:]]*[a-z]+[[:space:]]*$/ {
      if (!("wl" in v)) v["wl"] = $3
    }
    END {
      if (!("ac" in v) || !("usb" in v) || !("wl" in v)) { print "unknown"; exit }
      print (v["ac"] == "true" || v["usb"] == "true" || v["wl"] == "true") ? "true" : "false"
    }'
}

# ── device probes ────────────────────────────────────────────────────
# ONE adb round trip per poll: the battery block and the thermal block are split
# by a sentinel line, and each half is parsed by device-env.sh's own pure parsers.
# Prints "plugged=… level=… temp_deci=… thermal=…".
cw_probe_state() {
  local dump b1 b2 plugged level temp thermal
  dump=$(adb shell 'dumpsys battery; echo ---KALSA-CW-SPLIT---; dumpsys thermalservice' </dev/null 2>/dev/null | tr -d '\r')
  b1=$(printf '%s\n' "$dump" | awk '/^---KALSA-CW-SPLIT---$/ {exit} {print}')
  b2=$(printf '%s\n' "$dump" | awk 'f {print} /^---KALSA-CW-SPLIT---$/ {f=1}')

  plugged=$(printf '%s\n' "$b1" | cw_plugged_from_dump)
  level=$(printf '%s\n' "$b1" | device_battery_level_from_dump || true)
  temp=$(printf '%s\n' "$b1" | device_battery_temp_from_dump || true)
  thermal=$(printf '%s\n' "$b2" | device_thermal_status_from_dump || true)
  case "${level:-}" in ''|*[!0-9]*) level=unknown ;; esac
  case "${temp:-}" in ''|*[!0-9]*) temp=unknown ;; esac
  case "${thermal:-}" in ''|*[!0-9]*) thermal=unknown ;; esac
  printf 'plugged=%s level=%s temp_deci=%s thermal=%s\n' "$plugged" "$level" "$temp" "$thermal"
}

# Cumulative CPU ticks (utime+stime) of the S23's adsprpcd/cdsprpcd, as
# "procs=<n> ticks=<t>". Ticks, not %CPU: a single `top` sample says nothing about
# the load across a turn, and the two processes are known by name. utime/stime are
# fields 14/15 of /proc/<pid>/stat, which `cut -d" "` reaches correctly because
# those comm names contain no spaces.
# shellcheck disable=SC2016  # the device shell must expand $p/$t, not this one
CW_BG_CMD='t=0; n=0; for p in $(pidof adsprpcd cdsprpcd 2>/dev/null); do n=$((n+1)); set -- $(cut -d" " -f14,15 /proc/$p/stat 2>/dev/null); t=$((t + ${1:-0} + ${2:-0})); done; echo "procs=$n ticks=$t"'

cw_bg_cpu() {
  local out
  if out=$(adb shell "$CW_BG_CMD" </dev/null 2>/dev/null | tr -d '\r'); then
    case "$out" in
      procs=*ticks=*) printf '%s\n' "$out" ;;
      *) printf '%s\n' "unreadable" ;;
    esac
  else
    printf '%s\n' "unreadable"
  fi
}

# ── keep-awake / thermal watchdog ────────────────────────────────────
CW_STOP_FILE=""
CW_MAXTEMP_FILE=""
CW_WD_PID=""

cw_write_max() {
  local tmp="${CW_MAXTEMP_FILE}.$$"
  printf '%s\n' "$1" > "$tmp" 2>/dev/null && mv -f "$tmp" "$CW_MAXTEMP_FILE" 2>/dev/null
}

cw_write_sentinel() {
  local reason="$1" temp="$2" thermal="$3" maxtemp="$4" tmp="${CW_STOP_FILE}.$$"
  printf 'reason=%s temp_deci=%s thermal=%s max_temp_deci=%s\n' \
    "$reason" "$temp" "$thermal" "$maxtemp" > "$tmp" 2>/dev/null && mv -f "$tmp" "$CW_STOP_FILE" 2>/dev/null
}

# 0 when a stop condition has been recorded; the sentinel is logged once.
CW_WD_LOGGED=0
cw_watchdog_stop_requested() {
  local state
  [ -f "$CW_STOP_FILE" ] || return 1
  if [ "$CW_WD_LOGGED" = 0 ]; then
    state=$(tr -d '\r\n' < "$CW_STOP_FILE" 2>/dev/null || true)
    log "STOP: watchdog sentinel (${state:-state unavailable})"
    CW_WD_LOGGED=1
  fi
  return 0
}

cw_watchdog_loop() {
  local parent="$1" maxtemp="" line plugged temp thermal level reason warned=0
  while kill -0 "$parent" 2>/dev/null; do
    line=$(cw_probe_state)
    plugged=$(printf '%s\n' "$line" | sed -n 's/.*plugged=\([^ ]*\).*/\1/p')
    level=$(printf '%s\n' "$line" | sed -n 's/.*level=\([^ ]*\).*/\1/p')
    temp=$(printf '%s\n' "$line" | sed -n 's/.*temp_deci=\([^ ]*\).*/\1/p')
    thermal=$(printf '%s\n' "$line" | sed -n 's/.*thermal=\([^ ]*\).*/\1/p')
    case "$temp" in ''|*[!0-9]*) temp=0 ;; esac
    # Thermal unreadable is a STOP, not a 0. Treating it as cool is the fail-open
    # the Jelly cannot afford.
    thermal_unreadable=0
    case "$thermal" in ''|unknown|*[!0-9]*) thermal=0; thermal_unreadable=1 ;; esac

    if [ -n "$temp" ] && [ "$temp" != 0 ]; then
      if [ -z "$maxtemp" ] || [ "$temp" -gt "$maxtemp" ]; then
        maxtemp="$temp"
        cw_write_max "$maxtemp"
      fi
      if [ "$temp" -ge "$CW_TEMP_WARN_DECI" ] && [ "$warned" = 0 ]; then
        warned=1
        log "WARN: battery ${temp} deci-C >= ${CW_TEMP_WARN_DECI} deci-C"
      fi
    fi

    reason=""
    case "$plugged" in
      true) reason="charging" ;;
      unknown) reason="power_state_unreadable" ;;
    esac
    if [ -z "$reason" ] && [ "$thermal_unreadable" = 1 ]; then
      reason="thermal_status_unreadable"
    fi
    if [ -z "$reason" ] && [ "$thermal" -ge "$CW_THERMAL_STOP" ]; then
      reason="thermal_status_${thermal}"
    fi
    if [ -z "$reason" ] && [ "$temp" -ge "$CW_TEMP_STOP_DECI" ]; then
      reason="battery_temp_${temp}"
    fi
    if [ -z "$reason" ]; then
      case "$level" in
        ''|unknown|*[!0-9]*) reason="battery_level_unreadable" ;;
        *) [ "$level" -lt "$CW_BATTERY_FLOOR" ] && reason="battery_level_${level}" ;;
      esac
    fi

    if [ -n "$reason" ]; then
      cw_write_sentinel "$reason" "$temp" "$thermal" "${maxtemp:-$temp}"
      return 0
    fi
    sleep "$CW_WD_INTERVAL" &
    wait "$!" 2>/dev/null || true
  done
}

cw_watchdog_start() {
  CW_STOP_FILE="$OUT/.watchdog.stop"
  CW_MAXTEMP_FILE="$OUT/.watchdog.maxtemp"
  rm -f "$CW_STOP_FILE" "$CW_MAXTEMP_FILE" "${CW_STOP_FILE}.$$" "${CW_MAXTEMP_FILE}.$$"
  log "watchdog: armed interval=${CW_WD_INTERVAL}s stop_temp=${CW_TEMP_STOP_DECI} deci-C stop_thermal=${CW_THERMAL_STOP} floor=${CW_BATTERY_FLOOR}%"
  cw_watchdog_loop "$$" &
  CW_WD_PID=$!
}

cw_watchdog_stop() {
  if [ -n "${CW_WD_PID:-}" ]; then
    kill "$CW_WD_PID" 2>/dev/null || true
    wait "$CW_WD_PID" 2>/dev/null || true
    CW_WD_PID=""
  fi
  if [ -n "${CW_MAXTEMP_FILE:-}" ] && [ -f "$CW_MAXTEMP_FILE" ]; then
    log "watchdog: max battery temperature seen=$(cat "$CW_MAXTEMP_FILE" 2>/dev/null || true) deci-C"
  fi
}

# ── logcat capture ───────────────────────────────────────────────────
CW_LOGCAT=""
CW_LOGCAT_PID=""
CW_SLICE_OFF=0
CW_SLICE_TAG=""
CW_SLICE_FILE=""
# Set by cw_wait_turn_end at the instant the turn-end signal fired, so the
# recorded replyS is the send-to-signal gap and not the send-to-row-write gap
# (which would absorb the slice extraction and the storage reads).
CW_TURN_END_S=""

cw_cleanup() {
  if [ -n "${CW_LOGCAT_PID:-}" ]; then
    kill "$CW_LOGCAT_PID" 2>/dev/null || true
    wait "$CW_LOGCAT_PID" 2>/dev/null || true
  fi
  cw_watchdog_stop
  # The raw capture is the one artifact that could hold generated text: a mktemp
  # file OUTSIDE $OUT, removed on every exit path.
  [ -n "${CW_LOGCAT:-}" ] && rm -f "$CW_LOGCAT"
  [ -n "${CW_SLICE_FILE:-}" ] && rm -f "$CW_SLICE_FILE"
  return 0
}

# Markers go into the DEVICE's log stream, not appended to the host file: adb
# logcat is writing that file in the background, so ordering against it would be a
# race (proven in device-restore-protocol.sh).
cw_mark() {
  adb shell log -p i -t KALSA_CW_MARK "$1" </dev/null >/dev/null 2>&1 || true
}

# The whole per-turn slicing depends on markers reaching logcat. Probe once: if
# `adb shell log` cannot write, every slice is empty, every capture column reads
# "-", and the run would look finished while having measured nothing.
cw_marker_probe() {
  local nonce=""
  nonce="probe=$$-$(date +%s)"
  cw_mark "$nonce"
  sleep 2
  # awk reads the capture directly (no pipe to a grep -q that would exit 141 once
  # bytes after the match exceed the pipe buffer — device-restore-protocol.sh
  # measured exactly that false negative).
  if awk -v n="$nonce" 'index($0, "KALSA_CW_MARK") && index($0, n) {found=1} END {exit !found}' "$CW_LOGCAT" 2>/dev/null; then
    log "marker probe ok ($nonce)"
    return 0
  fi
  printf 'FATAL: KALSA_CW_MARK markers never reached logcat — without them every per-turn slice is empty\n' >&2
  return 1
}

cw_slice_begin() {
  local turn="$1" phase="$2"
  CW_SLICE_TAG="t${turn}-${phase}"
  CW_SLICE_OFF=$(wc -c < "$CW_LOGCAT" 2>/dev/null | tr -d ' ')
  case "${CW_SLICE_OFF:-}" in ''|*[!0-9]*) CW_SLICE_OFF=0 ;; esac
  cw_mark "$CW_SLICE_TAG begin"
}

# Everything from the LAST begin-marker to the moment of the call, into
# $CW_SLICE_FILE. The byte offset recorded at begin bounds the read to this turn's
# volume; the marker anchor keeps attribution exact when that offset snapshot
# landed mid-line of the previous turn.
cw_slice_end() {
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/kalsa-cw-slice.XXXXXX") || return 1
  cw_mark "$CW_SLICE_TAG end"
  sleep 1
  tail -c "+$((CW_SLICE_OFF + 1))" "$CW_LOGCAT" 2>/dev/null \
    | awk -v m="$CW_SLICE_TAG begin" '
        index($0, m) { n = 0; found = 1; next }
        { if (found) line[n++] = $0 }
        END { for (i = 0; i < n; i++) print line[i] }
      ' > "$tmp"
  mv -f "$tmp" "$CW_SLICE_FILE" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# Lines whose payload is counters only by each emitting site's own contract
# (turnTelemetry.ts: "NEVER log user text … counters, timings, and tool-name /
# strategy labels only"; digestTelemetry.ts enumerates its fields for the same
# reason). Copied whole.
CW_EVIDENCE_RE='KALSA_CW_MARK|KALSA_WINDOW |KALSA_WINDOW_SLIDE |KALSA_KVPREFIX |KALSA_KVREUSE |KALSA_KVRESUME |KALSA_KVSHIFT |KALSA_PREWARM |KALSA_SESSION |KALSA_TELEMETRY |KALSA_DIGEST |Input processed'
# Lines that CAN carry payloads in some build, extracted digit-shaped only:
#   KALSA_KVDIAG    n_common / total / search_max counts
#   KALSA_KVDIVERGE ids + detokenized text under RNLLAMA_ANDROID_ENABLE_LOGGING
#   KALSA_KVDIAG0   cache_head/prompt_head are token ids (detokenizing recovers
#                   the words — rn-completion.cpp:541)
CW_EVIDENCE_SHAPED='KALSA_KVDIAG n_common=[0-9]+ total=[0-9]+ search_max=[0-9]+'
CW_EVIDENCE_SHAPED2='KALSA_KVDIVERGE n_common=[0-9]+ shared_lo=[0-9]+ embd_hi=[0-9]+ text_hi=[0-9]+'
CW_EVIDENCE_SHAPED3='KALSA_KVDIAG0 cache_len=[0-9]+ prompt_len=[0-9]+'

# Append matching lines. grep rc 1 (no match) is normal; rc > 1 is a real write
# error and must not be swallowed. NOT called inside a command substitution: a
# fatal check there only kills the subshell (ci-lib's documented `die`-in-$(…)
# trap — the caller retries and the run finishes PASS).
cw_append_matching() {
  local src="$1" dest="$2" re="$3" rc=0
  grep -E "$re" "$src" >> "$dest" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then
    printf 'FATAL: could not append evidence to %s (grep rc=%s)\n' "$dest" "$rc" >&2
    return 1
  fi
  return 0
}

cw_persist_slice() {
  cw_append_matching "$CW_SLICE_FILE" "$OUT/evidence.txt" "$CW_EVIDENCE_RE" || return 1
  cw_append_matching "$CW_SLICE_FILE" "$OUT/evidence.txt" "$CW_EVIDENCE_SHAPED" || return 1
  cw_append_matching "$CW_SLICE_FILE" "$OUT/evidence.txt" "$CW_EVIDENCE_SHAPED2" || return 1
  cw_append_matching "$CW_SLICE_FILE" "$OUT/evidence.txt" "$CW_EVIDENCE_SHAPED3" || return 1
  return 0
}

# ── AsyncStorage reads ───────────────────────────────────────────────
# The active conversation id, printed, or 1 on failure. Deliberately NOT ci-lib's
# resolve_active_conversation_id: that one calls `die` internally, so any caller
# capturing it with $(…) downgrades a fatal to a subshell exit and keeps going.
# The fatal belongs to the caller, at the top level.
cw_active_chat_id() {
  local raw="${1-}" out=""
  [ -n "$raw" ] || return 1
  out=$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "")
except Exception:
    sys.exit(1)
if not isinstance(obj, dict) or not isinstance(obj.get("items"), list):
    sys.exit(1)
items = [it for it in obj["items"] if isinstance(it, dict) and isinstance(it.get("id"), str) and it["id"]]
if not items:
    sys.exit(1)
active = obj.get("activeId")
if isinstance(active, str) and active and any(it["id"] == active for it in items):
    print(active)
    sys.exit(0)
def recency(it):
    u = it.get("updatedAt")
    return u if isinstance(u, (int, float)) and u == u else 0
items.sort(key=recency, reverse=True)
print(items[0]["id"])
' 2>/dev/null) || return 1
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
}

# Assistant messages persisted for the active conversation. Returns 1 on a read
# failure so a caller can tell "no reply yet" (0) from "could not read".
cw_assistant_count() {
  local cid="$1" key out=""
  key=$(messages_storage_key "$cid")
  out=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" 2>/dev/null \
    | python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read() or "[]")
    print(sum(1 for m in data if isinstance(m, dict) and m.get("role") == "assistant"))
except Exception:
    sys.exit(1)
' 2>/dev/null) || return 1
  case "$out" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$out"
}

# The operative-content lengths and the compactor bookkeeping, read from the app's
# own storage. Prints
#   summaryChars<TAB>summaryKeyChars<TAB>digestChars<TAB>builtAtUserTurn<TAB>boundaryIndex<TAB>read_ok
# read_ok is 1 only when `sql` returned success for the compactor row: an empty
# value for an absent key is a legitimate 0 and is NOT a failed read, while a
# failed device pull must never be scored as "the app produced no content".
# The stored text is never written anywhere: python reads it on stdin and prints
# integers only.
cw_operative_lengths() {
  local cid="$1" comp="" sum="" comp_rc=0 sum_rc=0 res sumkey digestchars sumchars read_ok=1
  comp=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$(compactor_storage_key "$cid")';" 2>/dev/null)
  comp_rc=$?
  sum=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$(summary_storage_key "$cid")';" 2>/dev/null)
  sum_rc=$?
  [ "$comp_rc" -eq 0 ] && [ "$sum_rc" -eq 0 ] || read_ok=0

  res=$(printf '%s' "$comp" | python3 -c '
import json, sys
raw = sys.stdin.read()
obj = None
try:
    obj = json.loads(raw) if raw.strip() else None
except Exception:
    obj = None
if not isinstance(obj, dict):
    obj = {}
d = obj.get("frozenDigest") if isinstance(obj.get("frozenDigest"), str) else ""
s = obj.get("rollingSummary") if isinstance(obj.get("rollingSummary"), str) else ""
b = obj.get("builtAtUserTurn")
x = obj.get("boundaryIndex")
def num(v):
    return int(v) if isinstance(v, (int, float)) and v == v else -1
print("%d %d %d %d" % (len(s.strip()), len(d.strip()), num(b), num(x)))
' 2>/dev/null) || res=""
  case "$res" in
    # Sanity on the python output: four whitespace-separated integers (two lengths
    # >= 0, builtAtUserTurn and boundaryIndex possibly -1). An over-strict glob here
    # previously demanded a '-' in the last two fields, which would have discarded
    # every well-formed read and reported ciswire as producing nothing.
    *[!0-9\ -]*) res="0 0 -1 -1" ;;
    *)
      if [ "$(printf '%s' "$res" | wc -w | tr -d ' ')" != "4" ]; then res="0 0 -1 -1"; fi
      ;;
  esac
  sumchars=$(printf '%s' "$res" | awk '{print $1}')
  digestchars=$(printf '%s' "$res" | awk '{print $2}')
  local builtat boundary
  builtat=$(printf '%s' "$res" | awk '{print $3}')
  boundary=$(printf '%s' "$res" | awk '{print $4}')
  sumkey=$(printf '%s' "$sum" | python3 -c 'import sys; print(len(sys.stdin.read().strip()))' 2>/dev/null) || sumkey=0
  case "${sumkey:-}" in ''|*[!0-9]*) sumkey=0 ;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$sumchars" "$sumkey" "$digestchars" "$builtat" "$boundary" "$read_ok"
}

# ── seeded synthetic conversation ────────────────────────────────────
# No real user data can enter: every word derives from SEED and the turn number.
# Each turn's body carries that turn's marker word, and from turn 2 on the
# QUESTION names a marker word from an earlier turn. Once the window has slid, the
# evicted turns are a corpus that shares a token with the current query — the
# condition the BM25 digest needs to select anything at all. Without it the digest
# would be empty for a reason that has nothing to do with ciswire.
cw_prompt() {
  python3 - "$SEED" "$1" "$PROMPT_CHARS" <<'PY'
import random, sys
seed, turn, chars = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
base = "n%d" % seed
mine = "%s-w%d" % (base, turn)
recall = "%s-w%d" % (base, max(1, turn - 3))
rng = random.Random(seed * 1000003 + turn)
body, n = [], 0
while sum(len(w) + 1 for w in body) < chars:
    n += 1
    body.append(mine if n % 7 == 0 else "%s-f%d" % (base, rng.randrange(97)))
text = " ".join(body)
if turn == 1:
    q = ("Reply with one short sentence, the number only. Count how many times "
         "the word %s appears in the text below.\n\n%s" % (mine, text))
else:
    q = ("Reply with one short sentence, the number only. The word %s appeared in "
         "an earlier message of this conversation. Count how many times it appears "
         "in the text below.\n\n%s" % (recall, text))
print(q)
PY
}

# ── readiness / turn-end waits ───────────────────────────────────────
cw_wait_ready() {
  local t=0 ui
  while [ "$t" -lt "$READY_TIMEOUT" ]; do
    cw_watchdog_stop_requested && return 2
    if ui=$(device_dump_ui_retry); then
      device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}" && { log "ready after ${t}s"; return 0; }
    fi
    sleep 5
    t=$((t + 5))
  done
  log "never reported Ready after ${READY_TIMEOUT}s"
  return 1
}

# Turn end, watched on the HOST capture: the engine's own KALSA_TELEMETRY lands in
# the logcat file this script is already writing, so the poll costs the phone
# nothing. A DB poll is the fallback on a 30s cadence — reading the conversation
# out of the device database during generation is adb traffic *while the thing
# being measured is running*, which is why it is not the primary signal. (The
# campaign family learned the same lesson from the other side: a phone busy
# generating does not persist the reply in time.)
cw_wait_turn_end() {
  local prev="$1" t=0 next_db=0 found count db_fallback=1
  # A non-numeric baseline (the previous read failed) disables the DB fallback
  # instead of becoming -1, which every count would exceed and every turn would
  # then "finish" instantly.
  case "$prev" in ''|*[!0-9]*) db_fallback=0 ;; esac
  [ "$db_fallback" -eq 1 ] || log "WARN: no assistant-count baseline — waiting on KALSA_TELEMETRY only"
  while [ "$t" -lt "$REPLY_TIMEOUT" ]; do
    cw_watchdog_stop_requested && return 2
    found=$(cw_count_after_marker "$CW_SLICE_TAG begin" 'KALSA_TELEMETRY ')
    if [ "$found" -ge 1 ]; then
      log "turn end: KALSA_TELEMETRY after ${t}s"
      CW_TURN_END_S=$(date +%s)
      return 0
    fi
    if [ "$db_fallback" -eq 1 ] && [ "$t" -ge "$next_db" ]; then
      if count=$(cw_assistant_count "$CW_CHAT_ID"); then
        if [ "$count" -gt "$prev" ]; then
          log "turn end: reply persisted after ${t}s (assistants ${prev}->${count})"
          CW_TURN_END_S=$(date +%s)
          return 0
        fi
      else
        log "WARN: assistant count unreadable (DB read failed) — the capture path may be broken"
      fi
      next_db=$((t + TURN_END_DB_POLL_S))
    fi
    sleep "$TURN_END_POLL_S"
    t=$((t + TURN_END_POLL_S))
  done
  log "no turn-end signal within ${REPLY_TIMEOUT}s"
  return 1
}

# ── per-turn recording ───────────────────────────────────────────────
# The column count is DERIVED from the header: hand-maintaining it next to a
# 44-name list is how a silent column drift gets in.
CW_TSV_HEADER=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
  turn phase end replyS assistantCount tel_lines promptMs tokensEval promptN tokensCached \
  flags interrupted digestLines digestSelected digestCorpus summaryChars summaryKeyChars digestChars \
  builtAtUserTurn boundaryIndex window_lines windowSlide kvCleared slideAdvanced \
  kvHeld nPast hasDigest legacyStart historyDropped \
  budgetChars budgetSource kvprefix_count embd textTokens nCommon inputprocessed_nPast inputprocessed_embd \
  reuse_src reuse_state session_lines sessionLoadOk bg_cpu_ticks operativeRead injected)
CW_TSV_COLS=$(printf '%s' "$CW_TSV_HEADER" | awk -F'\t' '{print NF}')

# Field count is the invariant that keeps a silent column drift out of the
# artifacts: the header and every row must have the same number of fields.
cw_tsv_check() {
  local file="$1" header_n row_n
  header_n=$(awk -F'\t' 'NR==1 {print NF}' "$file" 2>/dev/null | tr -d ' ')
  row_n=$(awk -F'\t' 'END {print NF}' "$file" 2>/dev/null | tr -d ' ')
  if [ "$header_n" != "$CW_TSV_COLS" ] || [ "$row_n" != "$CW_TSV_COLS" ]; then
    printf 'FATAL: TSV column drift in %s (header=%s last_row=%s expected=%s)\n' \
      "$file" "${header_n:-?}" "${row_n:-?}" "$CW_TSV_COLS" >&2
    return 1
  fi
  return 0
}

cw_record_turn() {
  local turn="$1" phase="$2" end="$3" replyS="${4:--}"

  # Telemetry: ci-lib's own parser is reused rather than re-implemented, over the
  # JSON payloads extracted out of this turn's slice. _engine_tokens_evaluated is
  # a pure file→number function (no adb, no die), so calling it here is safe.
  local teljsonl="$OUT/.turn-telemetry.jsonl" tokensEval telLines
  grep -oE 'KALSA_TELEMETRY \{.*\}' "$CW_SLICE_FILE" 2>/dev/null \
    | sed -E 's/^KALSA_TELEMETRY //' > "$teljsonl" || true
  tokensEval=$(_engine_tokens_evaluated "$teljsonl")
  telLines=$(wc -l < "$teljsonl" 2>/dev/null | tr -d ' ')
  case "${telLines:-}" in ''|*[!0-9]*) telLines=0 ;; esac
  # Counter-only by construction; kept for the whole run so the verdict can be
  # re-derived without the device.
  cat "$teljsonl" >> "$OUT/telemetry.jsonl" 2>/dev/null || true
  rm -f "$teljsonl"

  local promptMs promptN tokensCached interrupted flags
  promptMs=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" promptMs)")
  promptN=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" prompt_n)")
  tokensCached=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" tokensCached)")
  interrupted=$(cw_or_dash "$(cw_json_bool "$CW_SLICE_FILE" interrupted)")
  # The raw ciswireFlags value: the verdict derives bit0 (this run is ciswire)
  # and bit1/bit2 (memory / tool-help contamination) from it. Omitted when 0.
  flags=$(cw_json_num "$CW_SLICE_FILE" ciswireFlags)
  flags=$(cw_or_dash "$flags")

  local digestLines digestSelected digestCorpus
  digestLines=$(cw_count "$CW_SLICE_FILE" "KALSA_DIGEST ")
  digestSelected=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" selectedCount)")
  digestCorpus=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" corpusSize)")

  # Operative content + compactor bookkeeping, from the app's stored state (the
  # only place builtAtUserTurn / boundaryIndex exist — no log line carries them).
  # The trailing read_ok is 1 when the compactor row was actually READ, so a failed
  # device pull cannot be reported as "ciswire produced no content".
  local operative sumchars sumkey digestchars builtAt boundary opRead
  operative=$(cw_operative_lengths "$CW_CHAT_ID")
  sumchars=$(printf '%s' "$operative" | cut -f1)
  sumkey=$(printf '%s' "$operative" | cut -f2)
  digestchars=$(printf '%s' "$operative" | cut -f3)
  builtAt=$(printf '%s' "$operative" | cut -f4)
  boundary=$(printf '%s' "$operative" | cut -f5)
  opRead=$(printf '%s' "$operative" | cut -f6)

  local windowLines windowSlide
  windowLines=$(cw_count "$CW_SLICE_FILE" "KALSA_WINDOW ")
  windowSlide=$(cw_count "$CW_SLICE_FILE" "KALSA_WINDOW_SLIDE ")

  # Slide provenance: a slide whose clear FAILED is not a clean slide (item #2),
  # and a successful clear is one of the two ways the operative block gets to ride
  # the prompt (item #4).
  local kvCleared slideAdvanced
  kvCleared=$(cw_slide_cleared "$CW_SLICE_FILE")
  slideAdvanced=$(cw_or_dash "$(cw_json_bool "$CW_SLICE_FILE" advanced)")

  local kvHeld nPast hasDigest legacyStart historyDropped budgetChars budgetSource
  kvHeld=$(cw_or_dash "$(cw_json_bool "$CW_SLICE_FILE" kvHeld)")
  nPast=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" nPast)")
  hasDigest=$(cw_or_dash "$(cw_json_bool "$CW_SLICE_FILE" hasDigest)")
  legacyStart=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" legacyWindowStart)")
  historyDropped=$(cw_or_dash "$(cw_json_str "$CW_SLICE_FILE" historyDropped)")
  budgetChars=$(cw_or_dash "$(cw_json_num "$CW_SLICE_FILE" rebuildBudgetChars)")
  budgetSource=$(cw_or_dash "$(cw_json_str "$CW_SLICE_FILE" rebuildBudgetSource)")

  # Reuse: KALSA_KVPREFIX (the native per-send prefix compare) is ground truth,
  # and the winning line must belong to THIS turn — the static-prefix prewarm is
  # queued in front of the send and emits its own KVPREFIX, so "the last line"
  # can be a prewarm's and would then masquerade as the chat turn's reuse. Tied by
  # the turn's own prompt size: KALSA_TELEMETRY tokensEvaluated IS the prompt token
  # count (the same number ci-lib's capture_kv_reuse matches on). The fallbacks
  # exist for a capture that lost the KVPREFIX line; they are matched the same way,
  # and reuse_src records which source answered and whether it matched.
  local kvp ip kvdiag embd="" textTokens="" nCommon="" ipNPastF="-" ipEmbdF="-"
  local reuseSrc="-" reuseState="none" reuseMatch=-1 want tie
  kvp=$(cw_kvprefix_last "$CW_SLICE_FILE")
  ip=$(cw_inputprocessed_last "$CW_SLICE_FILE")
  kvdiag=$(cw_kvdiag_last "$CW_SLICE_FILE")
  want="${tokensEval:-0}"
  case "$want" in ''|*[!0-9]*) want=0 ;; esac
  if [ -n "$kvp" ]; then
    embd=$(printf '%s' "$kvp" | awk '{print $1}')
    textTokens=$(printf '%s' "$kvp" | awk '{print $2}')
    nCommon=$(printf '%s' "$kvp" | awk '{print $3}')
    reuseSrc="kvprefix_last"
    tie=""
    while IFS= read -r tie; do
      [ -n "$tie" ] || continue
      case "$(printf '%s' "$tie" | awk '{print $1}')" in "$want") reuseMatch=1 ;; esac
      case "$(printf '%s' "$tie" | awk '{print $2}')" in "$want") reuseMatch=1 ;; esac
    done <<EOF
$(grep -oE 'KALSA_KVPREFIX embd=[0-9]+ text_tokens=[0-9]+ n_common=[0-9]+' "$CW_SLICE_FILE" 2>/dev/null \
  | sed -E 's/.*embd=([0-9]+) text_tokens=([0-9]+) n_common=([0-9]+)$/\1 \2 \3/')
EOF
    case "$reuseMatch" in
      1) reuseSrc="kvprefix_match" ;;
      *)
        # Unmatched: the only KVPREFIX in the slice may be the prewarm's.
        if [ -n "$promptN" ] && [ "$promptN" != "-" ] \
           && [ "$embd" = "$promptN" ] \
           && [ "$(cw_count "$CW_SLICE_FILE" 'KALSA_PREWARM ')" -gt 0 ]; then
          reuseSrc="prewarm_only"
        fi
        ;;
    esac
    [ "$reuseMatch" -eq 1 ] || reuseMatch=0
  elif [ -n "$ip" ]; then
    ipNPastF=$(printf '%s' "$ip" | awk '{print $1}')
    ipEmbdF=$(printf '%s' "$ip" | awk '{print $2}')
    embd="$ipEmbdF"; nCommon="$ipNPastF"; reuseSrc="input_processed"
    if [ "$want" -gt 0 ] && [ "$embd" = "$want" ]; then reuseMatch=1; else reuseMatch=0; fi
  elif [ -n "$kvdiag" ]; then
    nCommon=$(printf '%s' "$kvdiag" | awk '{print $1}')
    embd=$(printf '%s' "$kvdiag" | awk '{print $2}')
    reuseSrc="kvdiag"
    if [ "$want" -gt 0 ] && [ "$embd" = "$want" ]; then reuseMatch=1; else reuseMatch=0; fi
  fi
  if [ -n "$embd" ] && [ -n "$nCommon" ]; then
    reuseState=$(cw_reuse_state "$nCommon" "$embd")
  fi
  [ -n "$embd" ] || embd="-"
  [ -n "$textTokens" ] || textTokens="-"
  [ -n "$nCommon" ] || nCommon="-"

  # Did ciswire's content actually reach the prompt? Storage length alone is not
  # evidence (see cw_injected_state).
  local injected
  injected=$(cw_injected_state "$(( ${digestchars:-0} + ${sumchars:-0} + ${sumkey:-0} ))" "$hasDigest" "$kvCleared")

  local kvprefixCount sessionLines sessionLoadOk
  kvprefixCount=$(cw_count "$CW_SLICE_FILE" "KALSA_KVPREFIX ")
  sessionLines=$(cw_count "$CW_SLICE_FILE" "KALSA_SESSION ")
  # A session RESTORE is the load path with ok=true. Absent is 0, not "-": the
  # check that uses it must be able to fail when the subsystem never spoke.
  sessionLoadOk=0
  if grep -F 'KALSA_SESSION ' "$CW_SLICE_FILE" 2>/dev/null | grep -F '"op":"load"' 2>/dev/null | grep -F '"ok":true' >/dev/null 2>&1; then
    sessionLoadOk=1
  fi

  local assistantCount="-" count
  if count=$(cw_assistant_count "$CW_CHAT_ID"); then assistantCount="$count"; fi

  local fields
  fields=(
    "$turn" "$phase" "$end" "$replyS" "$assistantCount" "$telLines" "$promptMs" "$tokensEval"
    "$promptN" "$tokensCached" "$flags" "$interrupted" "$digestLines" "$digestSelected"
    "$digestCorpus" "$sumchars" "$sumkey" "$digestchars" "$builtAt" "$boundary"
    "$windowLines" "$windowSlide" "$kvCleared" "$slideAdvanced" "$kvHeld" "$nPast" "$hasDigest"
    "$legacyStart" "$historyDropped" "$budgetChars" "$budgetSource" "$kvprefixCount" "$embd"
    "$textTokens" "$nCommon" "$ipNPastF" "$ipEmbdF" "$reuseSrc" "$reuseState" "$sessionLines"
    "$sessionLoadOk" "$(cw_bg_cpu)" "$opRead" "$injected"
  )
  if [ "${#fields[@]}" -ne "$CW_TSV_COLS" ]; then
    printf 'FATAL: turn row has %s fields, expected %s\n' "${#fields[@]}" "$CW_TSV_COLS" >&2
    return 1
  fi
  local IFS=$'\t'
  printf '%s\n' "${fields[*]}" >> "$OUT/turns.tsv" || {
    printf 'FATAL: cannot append a turn row to %s/turns.tsv\n' "$OUT" >&2
    return 1
  }
  return 0
}

# ── turn driver ──────────────────────────────────────────────────────
# rc: 0 ok | 1 turn not completed | 2 watchdog stop | 3 fatal (cannot record)
cw_drive_turn() {
  local turn="$1" text="$2" prev="$3" rc t0 replyS="-"
  cw_slice_begin "$turn" "drive"
  t0=$(date +%s)
  CW_TURN_END_S=""
  if ! device_share_send "$text"; then
    cw_slice_end || true
    cw_persist_slice || return 3
    log "turn ${turn}: send failed"
    cw_record_turn "$turn" "drive" "send_failed" "-" || return 3
    return 1
  fi
  cw_wait_turn_end "$prev"
  rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$CW_TURN_END_S" ]; then replyS=$((CW_TURN_END_S - t0)); fi
  cw_slice_end || { log "turn ${turn}: slice extraction failed"; return 3; }
  cw_persist_slice || return 3
  case "$rc" in
    0) cw_record_turn "$turn" "drive" "replied" "$replyS" || return 3 ;;
    2) cw_record_turn "$turn" "drive" "watchdog_stop" "-" || return 3; return 2 ;;
    *) cw_record_turn "$turn" "drive" "no_turn_end" "-" || return 3; return 1 ;;
  esac
  return 0
}

# Force-stop → relaunch → Ready → one continuation turn. The slice OPENS before
# the force-stop so the relaunch's own session-load lines land in the restore row
# instead of being attributed to nothing.
cw_restore_turn() {
  local turn="$1" text="$2" prev="$3" rc t0 replyS="-"
  cw_slice_begin "$turn" "restore"
  adb shell am force-stop "$PKG" </dev/null >/dev/null 2>&1 || true
  sleep 5
  adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1 || true
  if ! cw_wait_ready; then
    cw_slice_end || true
    cw_persist_slice || return 3
    log "restore: no Ready after relaunch"
    cw_record_turn "$turn" "restore" "no_ready" "-" || return 3
    return 1
  fi
  t0=$(date +%s)
  CW_TURN_END_S=""
  if ! device_share_send "$text"; then
    cw_slice_end || true
    cw_persist_slice || return 3
    log "restore: continuation send failed"
    cw_record_turn "$turn" "restore" "send_failed" "-" || return 3
    return 1
  fi
  cw_wait_turn_end "$prev"
  rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$CW_TURN_END_S" ]; then replyS=$((CW_TURN_END_S - t0)); fi
  cw_slice_end || { log "restore: slice extraction failed"; return 3; }
  cw_persist_slice || return 3
  case "$rc" in
    0) cw_record_turn "$turn" "restore" "replied" "$replyS" || return 3 ;;
    2) cw_record_turn "$turn" "restore" "watchdog_stop" "-" || return 3; return 2 ;;
    *) cw_record_turn "$turn" "restore" "no_turn_end" "-" || return 3; return 1 ;;
  esac
  return 0
}

# ── verdict ──────────────────────────────────────────────────────────
# A pure function of the captured TSV: no adb, no $OUT state. That is what makes
# it re-runnable on a stored run (--verdict-only) and falsifiable without a phone.
# Writes the human verdict to $2 and the machine aggregate to $3. Returns 0 PASS,
# 2 FAIL, 1 could-not-compute.
cw_verdict() {
  local tsv="$1" verdict_out="$2" agg_out="$3" rc=0
  [ -f "$tsv" ] || return 1
  : > "$agg_out" 2>/dev/null || return 1
  # reset is passed through: the row-1 reprefill exemption is only legitimate when
  # THIS run wiped the conversation (cold KV). With RESET_CONVERSATION=0 row 1 is an
  # ordinary mid-conversation turn.
  awk -F'\t' -v mode="$CONTEXT_MODE" -v want="$TURNS" -v tmpfile="$agg_out" \
      -v reset="$RESET_CONVERSATION" '
    function fail(name, detail) {
      printf "check %s FAIL %s\n", name, detail
      failed = failed (failed ? "," : "") name
    }
    function pass(name, detail) { printf "check %s PASS %s\n", name, detail }
    NR == 1 { for (i = 1; i <= NF; i++) c[$i] = i; next }
    {
      n++
      turn[n]    = $c["turn"]
      phase[n]   = $c["phase"]
      endst[n]   = $c["end"]
      replyS[n]  = $c["replyS"]
      asst[n]    = $c["assistantCount"]
      asstRaw[n] = $c["assistantCount"]
      tel[n]     = $c["tel_lines"] + 0
      tEval[n]   = $c["tokensEval"] + 0
      flagsRaw[n]= $c["flags"]
      # Absent flags mean 0 (the app omits a falsy member). Bit0 = this run is
      # ciswire; bit1 = memory facts; bit2 = ciswire tool-help.
      fl = ($c["flags"] == "-") ? 0 : $c["flags"] + 0
      cbit[n]    = fl % 2
      mbit[n]    = int(fl / 2) % 2
      tbit[n]    = int(fl / 4) % 2
      intr[n]    = ($c["interrupted"] == "true") ? 1 : (($c["interrupted"] == "false") ? 0 : -1)
      dLines[n]  = $c["digestLines"] + 0
      dSel[n]    = ($c["digestSelected"] == "-") ? -1 : $c["digestSelected"] + 0
      summary[n] = $c["summaryChars"] + 0
      sumKey[n]  = $c["summaryKeyChars"] + 0
      digest[n]  = $c["digestChars"] + 0
      bIdxRaw[n] = $c["boundaryIndex"]
      bIdx[n]    = ($c["boundaryIndex"] == "-") ? -1 : $c["boundaryIndex"] + 0
      win[n]     = $c["window_lines"] + 0
      wslide[n]  = $c["windowSlide"] + 0
      kvcl[n]    = ($c["kvCleared"] == "1") ? 1 : (($c["kvCleared"] == "0") ? 0 : -1)
      sadv[n]    = $c["slideAdvanced"]
      inj[n]     = $c["injected"]
      rmatch[n]  = ($c["reuse_src"] == "-") ? -1 : (($c["reuse_src"] == "kvprefix_match" || $c["reuse_src"] == "input_processed" || $c["reuse_src"] == "kvdiag") ? 1 : 0)
      lsRaw[n]   = $c["legacyStart"]
      ls[n]      = ($c["legacyStart"] == "-") ? -1 : $c["legacyStart"] + 0
      hdrop[n]   = $c["historyDropped"]
      rsrc[n]    = $c["reuse_src"]
      rstate[n]  = $c["reuse_state"]
      embd[n]    = $c["embd"]
      nc[n]      = $c["nCommon"]
      sess[n]    = $c["sessionLoadOk"] + 0
      opRead[n]  = $c["operativeRead"] + 0
      promptMs[n]= $c["promptMs"]
      bg[n]      = $c["bg_cpu_ticks"]
    }
    END {
      printf "run context_mode=%s turns_requested=%s rows=%d\n", mode, want, n
      printf "per-turn (turn|phase|end|reuse=nCommon/embd|legacyStart|historyDropped|boundaryIndex|digestLines|digestChars|summaryChars|summaryKeyChars|sessionLoadOk|replyS|bg_cpu_ticks)\n"
      for (i = 1; i <= n; i++) {
        printf "  %s|%s|%s|%s=%s/%s|%s|%s|%s|%d|%d|%d|%d|%d|%s|%s\n", \
          turn[i], phase[i], endst[i], rstate[i], nc[i], embd[i], lsRaw[i], hdrop[i], \
          bIdxRaw[i], dLines[i], digest[i], summary[i], sumKey[i], sess[i], replyS[i], bg[i]
      }

      # ── derived facts ────────────────────────────────────────────
      driveRows = 0; restoreRows = 0; restoreOk = 0
      winTotal = 0; telTotal = 0
      engineDead = ""; regBad = ""; armBad = ""; replyMissing = ""
      intrMissing = ""; asstBad = ""; lastAsst = -1
      boundaryTurn = 0; postBoundary = 0
      postInjected = 0; postStorageOnly = 0; postDigestTel = 0
      slides = 0; slideReprefill = 0; slideClearFailed = ""; slideClearFailedN = 0
      everSummary = 0; everDigest = 0; everDigestTel = 0; opReadRows = 0
      minEval = -1
      reuseWhole = 0; reusePartial = 0; reusePrefill = 0; reuseNone = 0
      reuseRecordedN = 0; reuseMatchedN = 0; reuseUnmatched = ""; reuseMissing = ""
      prewarmOnlyN = 0; completedN = 0
      for (i = 1; i <= n; i++) {
        if (phase[i] == "restore") { restoreRows++; if (sess[i] == 1) restoreOk++ } else driveRows++
        winTotal += win[i]
        telTotal += tel[i]
        # "completed" = the turn produced a turn-end signal. Only those rows can be
        # asked for a reuse figure: an unfinished turn has nothing to report.
        completed = (replyS[i] != "-")
        if (completed) completedN++
        if (completed) {
          if (rsrc[i] != "-") reuseRecordedN++
          else reuseMissing = reuseMissing (reuseMissing ? "," : "") turn[i]
          if (rmatch[i] == 1) reuseMatchedN++
          else {
            reuseUnmatched = reuseUnmatched (reuseUnmatched ? "," : "") turn[i]
            if (rsrc[i] == "prewarm_only") prewarmOnlyN++
          }
        }
        if (tEval[i] <= 0) engineDead = engineDead (engineDead ? "," : "") turn[i]
        if (mode == "ciswire" && cbit[i] != 1) regBad = regBad (regBad ? "," : "") turn[i]
        if (mode == "anchored" && cbit[i] != 0) regBad = regBad (regBad ? "," : "") turn[i]
        # Arm isolation: memory and tool-help must not ride the arm.
        if (mbit[i] != 0 || tbit[i] != 0) armBad = armBad (armBad ? "," : "") turn[i]
        if (replyS[i] == "-") replyMissing = replyMissing (replyMissing ? "," : "") turn[i]
        # An interrupted generation is not a completed turn.
        if (intr[i] == 1) intrMissing = intrMissing (intrMissing ? "," : "") turn[i]
        if (intr[i] == -1 && completed) intrMissing = intrMissing (intrMissing ? "," : "") turn[i]
        # The assistant count must be readable and must advance: a dead storage
        # path must not look like a slow model.
        if (phase[i] == "restore") { lastAsst = -1 } else {
          a = (asstRaw[i] == "-") ? -1 : asstRaw[i] + 0
          if (a < 0) asstBad = asstBad (asstBad ? "," : "") turn[i]
          else if (lastAsst >= 0 && a <= lastAsst && completed) asstBad = asstBad (asstBad ? "," : "") turn[i]
          if (a >= 0) lastAsst = a
        }
        if (bIdx[i] > 0 && boundaryTurn == 0) boundaryTurn = turn[i]
        # A slide is clean only when the clear succeeded. A marker with
        # kvCleared:false (or unreadable) is the failure being hunted and grants no
        # reprefill exemption.
        slidClean = 0
        if (wslide[i] > 0) {
          if (kvcl[i] == 1) slidClean = 1
          else { slideClearFailedN++; slideClearFailed = slideClearFailed (slideClearFailed ? "," : "") turn[i] }
        }
        if (kvcl[i] == 1) slidClean = 1
        if (hdrop[i] != "-") slidClean = 1
        if (i > 1 && ls[i] >= 0 && ls[i-1] >= 0 && ls[i] > ls[i-1]) slidClean = 1
        if (slidClean) { slides++; if (rstate[i] == "reprefill") slideReprefill++ }
        if (bIdx[i] > 0) {
          postBoundary++
          if (dLines[i] > 0) postDigestTel++
          if (inj[i] == 1) postInjected++
          else if (inj[i] == -1) postStorageOnly++
        }
        if (summary[i] > 0 || sumKey[i] > 0) everSummary = 1
        if (digest[i] > 0) everDigest = 1
        if (dLines[i] > 0) everDigestTel = 1
        if (minEval < 0 || tEval[i] < minEval) minEval = tEval[i]
        if (rstate[i] == "whole") reuseWhole++
        else if (rstate[i] == "partial") reusePartial++
        else if (rstate[i] == "reprefill") reusePrefill++
        else reuseNone++
        if (opRead[i] == 1) opReadRows++
      }

      # H1 instruments alive
      if (driveRows != want)
        fail("turn_count", "drive rows=" driveRows " requested=" want)
      else
        pass("turn_count", "drive rows=" driveRows)
      if (winTotal < n)
        fail("window_signal", "KALSA_WINDOW lines=" winTotal " rows=" n " (per-send boundary signal missing)")
      else
        pass("window_signal", "KALSA_WINDOW lines=" winTotal " rows=" n)
      if (telTotal < n)
        fail("telemetry_signal", "KALSA_TELEMETRY lines=" telTotal " rows=" n)
      else
        pass("telemetry_signal", "KALSA_TELEMETRY lines=" telTotal " rows=" n)

      # H2 the engine actually ran on every turn (the lesson behind ci-lib
      # assert_engine_ran: a failed load writes error bubbles and a
      # complete-looking run)
      if (engineDead != "")
        fail("engine_alive", "no tokensEvaluated>0 on turns=" engineDead)
      else
        pass("engine_alive", "min tokensEvaluated=" minEval " over " n " rows")

      # H3 reuse recorded on EVERY completed row. A missing line is "no signal",
      # and a missing signal can hide a reprefill — so it fails instead of being
      # tolerated at 80%.
      if (reuseMissing != "")
        fail("reuse_recorded", "no reuse line on completed turns=" reuseMissing " (KALSA_KVPREFIX is W-level: a filtered capture drops it; a missing figure is not evidence of reuse)")
      else
        pass("reuse_recorded", "reuse figure on all " completedN " completed rows")

      # H4 the winning reuse line belongs to THIS turn, not to the prewarm that is
      # queued in front of the send (#10).
      if (reuseUnmatched != "")
        fail("reuse_matched", "reuse line not tied to the turn prompt size on turns=" reuseUnmatched " (prewarm-only turns=" prewarmOnlyN "): the figure may be the static-prefix prewarm, not the chat turn")
      else
        pass("reuse_matched", "reuse line tied to the turn on all " completedN " completed rows")

      # H5 the regime the run names is the regime that ran
      if (regBad != "")
        fail("regime_identity", "ciswireFlags bit0 mismatch on turns=" regBad " (expected " (mode == "ciswire" ? 1 : 0) ")")
      else
        pass("regime_identity", "ciswireFlags bit0=" (mode == "ciswire" ? 1 : 0) " on every row")

      # H6 arm isolation: ciswireFlags bit1 is memory, bit2 is tool-help. Either one
      # set means the arm is not the arm this run names.
      if (armBad != "")
        fail("arm_isolated", "ciswireFlags bit1 (memory) or bit2 (tool-help) set on turns=" armBad " — the arm is contaminated")
      else
        pass("arm_isolated", "memory and tool-help bits zero on every row")

      # H5 the seeded prompts crossed the window budget
      if (boundaryTurn == 0)
        fail("boundary_reached", "no row had boundaryIndex>0 — the charged window never crossed the ceiling, so the run measured nothing; raise PROMPT_CHARS or TURNS")
      else
        pass("boundary_reached", "first boundary turn=" boundaryTurn " post_boundary_rows=" postBoundary)

      # H7 a slide was observed, and every slide that named a clear actually cleared
      if (slides == 0)
        fail("slide_observed", "no slide (no cleared KALSA_WINDOW_SLIDE, no historyDropped, legacyWindowStart never advanced)")
      else
        pass("slide_observed", "clean slides=" slides " coinciding_with_reprefill=" slideReprefill)
      if (slideClearFailedN > 0)
        fail("slide_cleared", slideClearFailedN " slide(s) emitted KALSA_WINDOW_SLIDE with kvCleared false/unreadable (turns=" slideClearFailed "): the window did not move, so the prompt is still above the ceiling")
      else
        pass("slide_cleared", "every slide marker reported kvCleared=true")

      # H8 a full re-prefill with no CLEAN slide to explain it: the prompt HEAD
      # changed, which is a different failure from the window moving. Exemptions are
      # narrow and named: the first row ONLY when this run reset the conversation
      # (reset==1: cold KV, nothing to reuse — with RESET_CONVERSATION=0 row 1 is an
      # ordinary mid-conversation turn and must be judged like any other), and the
      # restore rows, whose cold-KV case is what restore_exercised judges.
      rogueReprefill = 0; rogueTurns = ""
      for (i = 1; i <= n; i++) {
        if (phase[i] == "restore") continue
        if (i == 1 && reset == 1) continue
        if (rstate[i] != "reprefill") continue
        # A slide grants the exemption only when its clear succeeded (#2). A
        # kvCleared:false marker sliding nothing means this reprefill is unexplained.
        slid = 0
        if (kvcl[i] == 1) slid = 1
        if (hdrop[i] != "-") slid = 1
        if (i > 1 && ls[i] >= 0 && ls[i-1] >= 0 && ls[i] > ls[i-1]) slid = 1
        if (!slid) {
          rogueReprefill++
          rogueTurns = rogueTurns (rogueTurns ? "," : "") turn[i]
        }
      }
      if (rogueReprefill > 0)
        fail("reprefill_without_slide", rogueReprefill " full re-prefill(s) with no slide to explain them (turns=" rogueTurns "): n_common=0 means the prompt head diverged, not that the window moved")
      else
        pass("reprefill_without_slide", "every re-prefill is explained by a slide")

      # H8..H11 regime-specific content claims. They are skipped, not passed, when
      # the operand itself was unreadable: a failed device pull must not be scored
      # as "ciswire produced no content".
      if (opReadRows != n) {
        fail("operative_read", "compactor/summary state readable on only " opReadRows "/" n " rows: one readable row is not evidence, and the content checks cannot judge the rest")
      } else {
        pass("operative_read", "compactor state readable on " opReadRows "/" n " rows")
      if (mode == "ciswire") {
        if (postBoundary == 0)
          fail("digest_telemetry_present", "no post-boundary row to judge")
        else if (postDigestTel == 0)
          fail("digest_telemetry_present", "no KALSA_DIGEST line on any of " postBoundary " post-boundary rows (the builder never ran)")
        else
          pass("digest_telemetry_present", "KALSA_DIGEST on " postDigestTel "/" postBoundary " post-boundary rows")
        # Judged on INJECTION, not on storage length: AppShell persists the digest
        # before deciding to inject, and operativeContextForLiveKv returns null while
        # the live KV is held, so a non-empty digest and an injected digest are
        # different events. Storage-only rows are reported as UNVERIFIED and cannot
        # carry the claim that ciswire works.
        if (postInjected == 0)
          fail("operative_content", "no post-boundary row shows ciswire content reaching the prompt (injected=0/" postBoundary "; storage-only rows=" postStorageOnly "): persisted digest/summary is NOT evidence of injection")
        else
          pass("operative_content", "injected on " postInjected "/" postBoundary " post-boundary rows (storage-only=" postStorageOnly ")")
        if (postStorageOnly > 0)
          printf "note operative_injection_storage_only %d post-boundary row(s) had persisted content but no injection evidence (hasDigest=false and kvCleared!=true): injection UNVERIFIED there\n", postStorageOnly
        if (everSummary == 0)
          fail("ciswire_summary_leg", "summaryChars and summaryKeyChars are 0 on every row (the v42 shape: the summary leg produces nothing)")
        else
          pass("ciswire_summary_leg", "summary content present on at least one row")
      } else {
        if (everDigest || everSummary)
          fail("anchored_no_operative_content", "digest/summary content present on an anchored run")
        else
          pass("anchored_no_operative_content", "no digest/summary content on any row (anchored carries none)")
        if (everDigestTel)
          fail("anchored_no_digest_build", "KALSA_DIGEST emitted on an anchored run")
        else
          pass("anchored_no_digest_build", "no KALSA_DIGEST line on any row")
      }
      }

      # H11 restore exercised
      if (restoreRows == 0)
        fail("restore_exercised", "no restore-phase row recorded")
      else if (restoreOk == 0)
        fail("restore_exercised", "no KALSA_SESSION op=load ok=true in the restore slice (session restore did not happen)")
      else
        pass("restore_exercised", "session load ok on the restore turn")

      # H12 every turn got a COMPLETE turn-end signal: a turn-end signal plus an
      # interruption flag that is not true and not unreadable. An interrupted or
      # error generation is not a completed reply, and counting one would let a
      # half-run look like a full one.
      if (replyMissing != "")
        fail("reply_complete", "no turn-end signal on turns=" replyMissing)
      else
        pass("reply_complete", "turn-end signal on all " n " rows")
      if (intrMissing != "")
        fail("reply_not_interrupted", "interrupted=true (or unreadable) on turns=" intrMissing ": an interrupted generation is not a completed reply")
      else
        pass("reply_not_interrupted", "no interrupted generation on any row")

      # H13 the assistant count was readable and advanced: a dead storage path must
      # not look like a slow model (device-share-send resolves the conversation id
      # through a helper that `die`s inside $(...), where the fatality is lost).
      if (asstBad != "")
        fail("assistant_progress", "assistant count unreadable or not advancing on turns=" asstBad " (the conversation could not be read back)")
      else
        pass("assistant_progress", "assistant count readable and advancing on every drive row")

      # ── machine aggregate (read by --compare) ─────────────────────
      printf "agg\tmode\t%s\n", mode >> tmpfile
      printf "agg\trows\t%d\n", n >> tmpfile
      printf "agg\tdrive_rows\t%d\n", driveRows >> tmpfile
      printf "agg\tslides\t%d\n", slides >> tmpfile
      printf "agg\tslides_with_reprefill\t%d\n", slideReprefill >> tmpfile
      printf "agg\treprefills_without_slide\t%d\n", rogueReprefill >> tmpfile
      printf "agg\tslides_clear_failed\t%d\n", slideClearFailedN >> tmpfile
      printf "agg\tpost_boundary_injected_rows\t%d\n", postInjected >> tmpfile
      printf "agg\tpost_boundary_storage_only_rows\t%d\n", postStorageOnly >> tmpfile
      printf "agg\treuse_matched_rows\t%d\n", reuseMatchedN >> tmpfile
      printf "agg\treuse_recorded_rows\t%d\n", reuseRecordedN >> tmpfile
      printf "agg\treuse_unmatched_rows\t%d\n", (completedN - reuseMatchedN) >> tmpfile
      printf "agg\tprewarm_only_rows\t%d\n", prewarmOnlyN >> tmpfile
      printf "agg\tarm_contaminated_rows\t%d\n", (armBad == "" ? 0 : split(armBad, _x, ",")) >> tmpfile
      printf "agg\tinterrupted_rows\t%d\n", (intrMissing == "" ? 0 : split(intrMissing, _y, ",")) >> tmpfile
      printf "agg\tlegacy_start_first\t%s\n", lsRaw[1] >> tmpfile
      printf "agg\tlegacy_start_last\t%s\n", lsRaw[n] >> tmpfile
      printf "agg\tfirst_boundary_turn\t%s\n", (boundaryTurn == 0 ? "-" : boundaryTurn) >> tmpfile
      printf "agg\tpost_boundary_rows\t%d\n", postBoundary >> tmpfile
      printf "agg\tpost_boundary_injected_rows\t%d\n", postInjected >> tmpfile
      printf "agg\tpost_boundary_digest_telemetry_rows\t%d\n", postDigestTel >> tmpfile
      printf "agg\tsummary_leg_nonzero_rows\t%d\n", everSummary >> tmpfile
      printf "agg\tdigest_chars_nonzero_rows\t%d\n", everDigest >> tmpfile
      printf "agg\treuse_whole_rows\t%d\n", reuseWhole >> tmpfile
      printf "agg\treuse_partial_rows\t%d\n", reusePartial >> tmpfile
      printf "agg\treuse_reprefill_rows\t%d\n", reusePrefill >> tmpfile
      printf "agg\treuse_none_rows\t%d\n", reuseNone >> tmpfile
      seq = ""
      for (i = 1; i <= n; i++) seq = seq (seq ? "," : "") rstate[i]
      printf "agg\treuse_state_sequence\t%s\n", seq >> tmpfile
      printf "agg\tfinal_assistant_count\t%s\n", asst[n] >> tmpfile
      printf "agg\tbg_cpu_ticks_first\t%s\n", bg[1] >> tmpfile
      printf "agg\tbg_cpu_ticks_last\t%s\n", bg[n] >> tmpfile

      printf "failed=%s\n", (failed == "" ? "none" : failed)
      printf "verdict=%s\n", (failed == "" ? "PASS" : "FAIL")
    }
  ' "$tsv" > "$verdict_out"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'FATAL: the verdict pass itself failed (awk rc=%s)\n' "$rc" >&2
    return 1
  fi
  if grep -q '^verdict=PASS$' "$verdict_out" 2>/dev/null; then return 0; fi
  return 2
}

# --compare: two runs of this harness on the same phone and model, one per regime.
cw_compare() {
  local dir_a="$1" dir_b="$2" f
  for f in "$dir_a/aggregate.tsv" "$dir_b/aggregate.tsv" "$dir_a/turns.tsv" "$dir_b/turns.tsv"; do
    if [ ! -f "$f" ]; then
      printf 'compare: %s missing\n' "$f" >&2
      return 1
    fi
  done
  printf '%s\n' "=== ciswire vs anchored: same phone, same model, one invocation per regime ==="
  printf '%s\n' "A = $dir_a   B = $dir_b"
  printf '%s\n' "The S23 runs adsprpcd/cdsprpcd at ~100% of one core with the app idle;"
  printf '%s\n' "it is reported per row as bg_cpu_ticks (cumulative) and never subtracted."
  printf '%s\n' "--- aggregate ---"
  printf '%-36s %-22s %-22s\n' "metric" "A" "B"
  awk -F'\t' '
    FNR == 1 { file++ }
    $1 == "agg" {
      key = $2
      if (!(key in seen)) { seen[key] = 1; order[++k] = key }
      v[file, key] = $3
    }
    END {
      for (i = 1; i <= k; i++) {
        key = order[i]
        a = ((1, key) in v) ? v[1, key] : "-"
        b = ((2, key) in v) ? v[2, key] : "-"
        printf "%-36s %-22s %-22s%s\n", key, a, b, (a == b ? "" : "  <-- differs")
      }
    }
  ' "$dir_a/aggregate.tsv" "$dir_b/aggregate.tsv"
  printf '%s\n' "--- per-turn reuse state (whole|partial|reprefill per row) ---"
  awk -F'\t' '
    FNR == 1 {
      # Each header line is skipped; the column map comes from the first one.
      if (file == 0) for (i = 1; i <= NF; i++) c[$i] = i
      file++
      next
    }
    { seq[file] = seq[file] (seq[file] ? "," : "") $c["reuse_state"] }
    END { for (f = 1; f <= file; f++) printf "%s: %s\n", (f == 1 ? "A" : "B"), seq[f] }
  ' "$dir_a/turns.tsv" "$dir_b/turns.tsv"
  printf '%s\n' "--- verdicts ---"
  for f in "$dir_a" "$dir_b"; do
    printf '%s: %s\n' "$f" "$(grep -E '^(verdict|failed)=' "$f/VERDICT.txt" 2>/dev/null | tr '\n' ' ')"
  done
  return 0
}

# ── self-test (no device, no adb) ────────────────────────────────────
# The verdict's only value is that it can say FAIL. That property is checked HERE,
# against the SHIPPED functions, from canned capture lines:
#   * the extractors, on a canned slice of real-shaped log lines;
#   * cw_verdict, on canned rows written in the real column order (CW_TSV_HEADER)
#     and re-read by the real verdict.
# Nothing here touches a phone, and the fixture is skipped unless --self-test is
# given, so it cannot run on a device arm. Exit 0 when every case matches its
# expectation, 1 otherwise. Row generation is python3 because the rest of this
# script already requires python3 and the alternative is forty awk field
# assignments pretending to be a fixture.
cw_selftest() {
  local dir rc=0
  dir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa-cw-selftest.XXXXXX") || return 1

  # ── case 0: the capture extractors on canned lines ────────────────
  cat > "$dir/slice.txt" <<'SLICE'
09-19 12:00:00.000  1  1 I ReactNativeJS: KALSA_WINDOW {"kvHeld":true,"nPast":2865,"lastSaveTokens":2865,"loadedB":4,"hasDigest":true,"legacyWindowStart":4,"rebuildBudgetChars":8294,"rebuildBudgetSource":"ceiling","textEst":2748}
09-19 12:00:00.100  1  1 W rnllama: KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832 mtp_draft_mem_shared=0 is_enc_dec=0 this=0x1
09-19 12:00:00.200  1  1 W rnllama: KALSA_KVPREFIX embd=4800 text_tokens=4800 n_common=2865 mtp_draft_mem_shared=0 is_enc_dec=0 this=0x1
09-19 12:00:00.300  1  1 I ReactNativeJS: KALSA_DIGEST {"durationMs":12.5,"corpusSize":6,"selectedCount":4,"ciswireFlags":1}
09-19 12:00:00.400  1  1 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","promptMs":3000.5,"prompt_n":300,"tokensEvaluated":2840,"ciswireFlags":1}
SLICE
  # The LAST KVPREFIX wins (the prewarm line comes first), hasDigest is a policy
  # flag, and boundaryIndex is absent from logcat by construction — it must read
  # "-" here, because the verdict gets it from the stored compactor JSON instead.
  local expects got
  expects='nPast=2865 hasDigest=true budgetSource=ceiling historyDropped=- boundaryIndex=- kvp=4800/4800/2865 kvpCount=2 selectedCount=4'
  got=$(printf 'nPast=%s hasDigest=%s budgetSource=%s historyDropped=%s boundaryIndex=%s kvp=%s/%s/%s kvpCount=%s selectedCount=%s\n' \
    "$(cw_json_num "$dir/slice.txt" nPast)" \
    "$(cw_json_bool "$dir/slice.txt" hasDigest)" \
    "$(cw_or_dash "$(cw_json_str "$dir/slice.txt" rebuildBudgetSource)")" \
    "$(cw_or_dash "$(cw_json_str "$dir/slice.txt" historyDropped)")" \
    "$(cw_or_dash "$(cw_json_num "$dir/slice.txt" boundaryIndex)")" \
    "$(cw_kvprefix_last "$dir/slice.txt" | awk '{print $1}')" \
    "$(cw_kvprefix_last "$dir/slice.txt" | awk '{print $2}')" \
    "$(cw_kvprefix_last "$dir/slice.txt" | awk '{print $3}')" \
    "$(cw_count "$dir/slice.txt" 'KALSA_KVPREFIX ')" \
    "$(cw_json_num "$dir/slice.txt" selectedCount)")
  if [ "$got" = "$expects" ]; then
    printf 'selftest %-20s PASS  %s\n' extractors "$got"
  else
    printf 'selftest %-20s FAIL  got=%s expected=%s\n' extractors "$got" "$expects"
    rc=1
  fi

  # ── case 1: the safety predicates, which must be FAIL-CLOSED ──────
  # A fail-open gate here means a wake keyevent on a lock-password Xiaomi or a
  # measurement started on an unreadable thermal state.
  local bad=""
  for v in Awake Dozing Asleep Dreaming "" unknown Awake_Bogus; do
    if cw_wakefulness_ok "$v"; then got="open"; else got="closed"; fi
    case "$v" in Awake) want="open" ;; *) want="closed" ;; esac
    if [ "$got" != "$want" ]; then bad="$bad wakefulness[$v]=$got(want $want)"; fi
  done
  for v in 0 1 2 "" unknown 3 4 9; do
    if cw_thermal_ok "$v"; then got="open"; else got="closed"; fi
    case "$v" in 0|1|2) want="open" ;; *) want="closed" ;; esac
    if [ "$got" != "$want" ]; then bad="$bad thermal[$v]=$got(want $want)"; fi
  done
  # The keep-awake gate: no KEYCODE_WAKEUP before the safety gate passed.
  CW_SAFETY_GATE=0
  if cw_keepawake_gate_ok; then bad="$bad keepawake_gate_open_before_safety"; fi
  CW_SAFETY_GATE=1
  if ! cw_keepawake_gate_ok; then bad="$bad keepawake_gate_closed_after_safety"; fi
  CW_SAFETY_GATE=0
  # Injection predicate: storage-only must never read as injected.
  if [ "$(cw_injected_state 260 true 0)" != "1" ]; then bad="$bad injected_open_gate"; fi
  if [ "$(cw_injected_state 260 false 0)" != "-1" ]; then bad="$bad injected_storage_only_not_flagged"; fi
  if [ "$(cw_injected_state 260 false '' )" != "-1" ]; then bad="$bad injected_missing_kvcleared"; fi
  if [ "$(cw_injected_state 260 false 1)" != "1" ]; then bad="$bad injected_after_clear"; fi
  if [ "$(cw_injected_state 0 true 1)" != "0" ]; then bad="$bad injected_empty_content"; fi
  # Slide clear: a failed clear is not a clean slide.
  printf 'I KALSA_WINDOW_SLIDE {"nCtx":8192,"advanced":false,"kvCleared":false,"skipReason":"boundary_cannot_advance"}\n' > "$dir/slide_false.txt"
  printf 'I KALSA_WINDOW_SLIDE {"nCtx":8192,"advanced":true,"kvCleared":true}\n' > "$dir/slide_true.txt"
  printf 'I KALSA_WINDOW {}\n' > "$dir/slide_absent.txt"
  [ "$(cw_slide_cleared "$dir/slide_false.txt")" = "0" ] || bad="$bad slide_false_not_zero"
  [ "$(cw_slide_cleared "$dir/slide_true.txt")" = "1" ] || bad="$bad slide_true_not_one"
  [ "$(cw_slide_cleared "$dir/slide_absent.txt")" = "-" ] || bad="$bad slide_absent_not_dash"
  # Flag bits: bit0 ciswire, bit1 memory, bit2 tool-help.
  [ "$(cw_flag_bits 1)" = "1 0 0" ] || bad="$bad flag_bits_1=$(cw_flag_bits 1)"
  [ "$(cw_flag_bits 3)" = "1 1 0" ] || bad="$bad flag_bits_3=$(cw_flag_bits 3)"
  [ "$(cw_flag_bits 7)" = "1 1 1" ] || bad="$bad flag_bits_7=$(cw_flag_bits 7)"
  [ "$(cw_flag_bits '')" = "0 0 0" ] || bad="$bad flag_bits_absent=$(cw_flag_bits '')"
  # Reuse classification: a missing figure is NOT reuse.
  [ "$(cw_reuse_state 100 100)" = "whole" ] || bad="$bad reuse_whole"
  [ "$(cw_reuse_state 40 100)" = "partial" ] || bad="$bad reuse_partial"
  [ "$(cw_reuse_state 0 100)" = "reprefill" ] || bad="$bad reuse_reprefill"
  [ "$(cw_reuse_state '' 100)" = "none" ] || bad="$bad reuse_missing_not_none"
  [ "$(cw_reuse_state 0 '')" = "none" ] || bad="$bad reuse_total_missing_not_none"
  if [ -z "$bad" ]; then
    printf 'selftest %-20s PASS  fail-closed tables and pure decisions hold\n' predicates
  else
    printf 'selftest %-20s FAIL %s\n' predicates "$bad"
    rc=1
  fi

  # ── verdict cases on canned rows, through the real cw_verdict ─────
  # name | expected exit | check that must appear in failed= | args
  cw_selftest_case "$dir" name=good want=0 must="" mode=ciswire || rc=1
  cw_selftest_case "$dir" name=v42_summary_zero want=4 must=ciswire_summary_leg mode=ciswire sch=0 || rc=1
  cw_selftest_case "$dir" name=reprefill_no_slide want=4 must=reprefill_without_slide mode=ciswire zfrom=2 || rc=1
  cw_selftest_case "$dir" name=regime_mismatch want=4 must=regime_identity mode=ciswire cbit=0 || rc=1
  cw_selftest_case "$dir" name=anchored_good want=0 must="" mode=anchored dch=0 sch=0 cbit=0 || rc=1
  cw_selftest_case "$dir" name=operand_unreadable want=4 must=operative_read mode=ciswire dch=0 sch=0 noop=noopread || rc=1
  # One unreadable operand row in fifteen is not "readable enough" (item #8).
  cw_selftest_case "$dir" name=operand_one_row want=4 must=operative_read mode=ciswire opbad=5 || rc=1
  # A slide marker whose clear FAILED grants no clean slide (item #2).
  cw_selftest_case "$dir" name=slide_clear_failed want=4 must=slide_cleared mode=ciswire slat=7 zfrom=7 kvcl=0 || rc=1
  # Row-1 reprefill is exempt ONLY on a fresh (reset) conversation (item #3).
  cw_selftest_case "$dir" name=row1_reprefill_reset0 want=4 must=reprefill_without_slide mode=ciswire zfrom=1 zf_to=1 slat=0 reset=0 || rc=1
  # Persisted content with no injection evidence is UNVERIFIED, never a PASS (#4).
  cw_selftest_case "$dir" name=injection_unverified want=4 must=operative_content mode=ciswire slat=0 hasdig=false || rc=1
  # An interrupted generation is not a completed reply (item #5).
  cw_selftest_case "$dir" name=interrupted_turn want=4 must=reply_not_interrupted mode=ciswire interrupted=true || rc=1
  # Memory / tool-help bits riding the arm (item #6), bit1 then bit2.
  cw_selftest_case "$dir" name=arm_memory_bit want=4 must=arm_isolated mode=ciswire extra_bits=1 || rc=1
  cw_selftest_case "$dir" name=arm_toolhelp_bit want=4 must=arm_isolated mode=ciswire extra_bits=2 || rc=1
  # A missing reuse line is no signal, not a tolerance (item #9).
  cw_selftest_case "$dir" name=reuse_missing want=4 must=reuse_recorded mode=ciswire rsrc=- || rc=1
  # A prewarm-only reuse figure must not masquerade as the chat turn (item #10).
  cw_selftest_case "$dir" name=prewarm_only_reuse want=4 must=reuse_matched mode=ciswire rsrc=prewarm_only || rc=1
  # The "-" sentinels mean UNKNOWN, and unknown must not be read as a value: an
  # unknown boundaryIndex cannot satisfy boundary_reached, and an unknown
  # legacyStart cannot manufacture a slide that would excuse a reprefill (item #15).
  cw_selftest_case "$dir" name=dash_sentinels want=4 must=boundary_reached mode=ciswire dash=1 || rc=1
  # Only ONE reprefill, on turn 5, with every legacyStart unknown: if an unknown
  # sentinel were forward-filled it would look like a monotone advance and excuse
  # that reprefill, so the check must still fire on it.
  cw_selftest_case "$dir" name=dash_no_false_slide want=4 must=reprefill_without_slide mode=ciswire dash=1 zfrom=5 zf_to=5 slat=0 || rc=1

  rm -rf "$dir"
  if [ "$rc" -eq 0 ]; then
    printf 'selftest: all cases matched\n'
  else
    printf 'selftest: FAILURES above\n'
  fi
  return "$rc"
}

# One fixture case: generate rows, run the real verdict, compare rc and the
# failed= list. Args: <dir> <name> <want_rc> <must_fail> <mode> <boundary_at>
# <digest_chars> <summary_chars> <ncommon_zero_from> <slide_at> <ciswire_bit>
# [noopread]
cw_selftest_case() {
  # Named args, NOT positional: a 20-slot positional signature silently misaligns
  # (it did, and the fixture caught it only because the wrong arg was a string).
  # Unset knobs take the healthy value.
  local dir="$1"; shift
  local name="" want=0 must="" mode="ciswire" b=7 dch=260 sch=140 zfrom=0 slat=7
  local cbit=1 noop="" kvcl=1 extra_bits=0 interrupted="false" rsrc="kvprefix_match"
  local st_zf="" opro=1 case_reset="" zf_to=0 hasdig="" opbad=0 dash=0
  local arg k v
  for arg in "$@"; do
    k="${arg%%=*}"; v="${arg#*=}"
    case "$k" in
      name) name="$v" ;; want) want="$v" ;; must) must="$v" ;; mode) mode="$v" ;;
      b) b="$v" ;; dch) dch="$v" ;; sch) sch="$v" ;; zfrom) zfrom="$v" ;; slat) slat="$v" ;;
      cbit) cbit="$v" ;; noop) noop="$v" ;; kvcl) kvcl="$v" ;; extra_bits) extra_bits="$v" ;;
      interrupted) interrupted="$v" ;; rsrc) rsrc="$v" ;; st_zf) st_zf="$v" ;; opro) opro="$v" ;;
      reset) case_reset="$v" ;; zf_to) zf_to="$v" ;; hasdig) hasdig="$v" ;; opbad) opbad="$v" ;;
      dash) dash="$v" ;;
      *) printf 'selftest FATAL: unknown case arg %s\n' "$arg"; return 1 ;;
    esac
  done
  [ -n "$name" ] || { printf 'selftest FATAL: case without a name\n'; return 1; }
  [ -n "$st_zf" ] || st_zf="$zfrom"
  [ "$noop" = "noopread" ] && opro=0
  [ -n "$case_reset" ] || case_reset="$RESET_CONVERSATION"

  local tsv="$dir/$name.tsv" vout="$dir/$name.verdict" aout="$dir/$name.agg"

  # Canned rows, written in the REAL column order (CW_TSV_HEADER) and read back by
  # the real cw_verdict, in the real column order. Knobs, all defaulting healthy:
  #   b        last turn at/after which boundaryIndex > 0 (the cadence boundary)
  #   dch/sch  persisted digestChars / summaryChars
  #   zfrom/zf_to  turns whose nCommon is 0 (a full reprefill)
  #   slat     the turn carrying KALSA_WINDOW_SLIDE (0 = no slide)
  #   kvcl     kvCleared on the slide row: 1 clean, 0 FAILED clear
  #   extra_bits  ciswireFlags bits above bit0 (1 = memory, 2 = tool-help)
  #   hasdig   override hasDigest ("" = derive from the regime); "false" makes the
  #            row storage-only, i.e. persisted content with no injection evidence
  #   opbad    one turn whose operativeRead is 0
  #   dash     emit "-" for boundaryIndex/legacyStart (the unknown sentinels)
  CW_TSV_HEADER="$CW_TSV_HEADER" python3 - "$tsv" "$TURNS" "$b" "$dch" "$sch" "$zfrom" "$slat" "$cbit" "$opro" \
    "$kvcl" "$extra_bits" "$interrupted" "$rsrc" "$st_zf" "$zf_to" "$hasdig" "$opbad" "$dash" \
    <<'PYFIXTURE'
import os, sys
(out, want, b, dch, sch, zfrom, slat, cbit, opro, kvcl, extra_bits, interrupted,
 rsrc, st_zf, zf_to, hasdig, opbad, dash) = sys.argv[1:19]
cols = os.environ["CW_TSV_HEADER"].split("\t")
(want, b, dch, sch, zfrom, slat, cbit, opro, extra_bits, st_zf, zf_to, opbad,
 dash) = map(int, (want, b, dch, sch, zfrom, slat, cbit, opro, extra_bits, st_zf,
                   zf_to, opbad, dash))
flags = cbit | (extra_bits << 1)
rows = []
for t in range(1, want + 2):
    phase = "drive" if t <= want else "restore"
    post = t >= b
    slid = (t == slat)
    ls = 4 + 2 * (t - b) if post else 0
    embd = 4800 + 40 * t
    whole = 1 if t == 1 else 0
    reprefill = bool(st_zf) and t >= st_zf and (not zf_to or t <= zf_to)
    ncom = 0 if reprefill else (2865 + 40 * t)
    state = "whole" if (whole and ncom > 0) else ("partial" if ncom > 0 else "reprefill")
    if hasdig == "":
        hasdig = "true" if cbit == 1 else "false"
    content = dch + sch
    d = {c: "-" for c in cols}
    d.update({
        "turn": t, "phase": phase, "end": "replied", "replyS": 60 + t,
        "assistantCount": t, "tel_lines": 1, "promptMs": 3000 + t,
        "tokensEval": embd, "promptN": 300, "tokensCached": ncom,
        "flags": flags, "interrupted": interrupted,
        "digestLines": 1 if (cbit == 1 and hasdig == "true") or (cbit == 1 and slid and kvcl == "1") else 0,
        "digestSelected": 4 if cbit == 1 else "-",
        "digestCorpus": 6 if cbit == 1 else "-",
        "summaryChars": sch if (cbit == 1 and (post or phase == "restore")) else 0,
        "summaryKeyChars": 0,
        "digestChars": dch if (cbit == 1 and (post or phase == "restore")) else 0,
        "builtAtUserTurn": max(1, t - (t % 3)),
        "boundaryIndex": "-" if dash else (b if post else 0),
        "window_lines": 1, "windowSlide": 1 if slid else 0,
        "kvCleared": kvcl if slid else "-",
        "slideAdvanced": "true" if slid else "-",
        "kvHeld": "true" if t <= 2 else "false", "nPast": ncom,
        "hasDigest": hasdig, "legacyStart": "-" if dash else ls,
        "historyDropped": "-", "budgetChars": "-", "budgetSource": "-",
        "kvprefix_count": 2, "embd": embd, "textTokens": embd, "nCommon": ncom,
        "inputprocessed_nPast": ncom, "inputprocessed_embd": embd,
        "reuse_src": rsrc, "reuse_state": state,
        "session_lines": 1, "sessionLoadOk": 1 if phase == "restore" else 0,
        "bg_cpu_ticks": "procs=2 ticks=%d" % (10000 + 500 * t),
        "operativeRead": 0 if (opbad and t == opbad) else opro,
        # Injection is proven only when content exists AND the app gate was open:
        # hasDigest true (retrieval on, KV not held) or a SUCCESSFUL clear.
        "injected": (0 if content == 0
                     else (1 if (hasdig == "true" or (slid and kvcl == "1")) else -1)),
    })
    rows.append("\t".join(str(d[c]) for c in cols))
with open(out, "w") as f:
    f.write("\t".join(cols) + "\n" + "\n".join(rows) + "\n")
PYFIXTURE
  pyrc=$?
  if [ "$pyrc" -ne 0 ]; then
    printf 'selftest %-20s FAIL  could not generate the fixture rows (python rc=%s)\n' "$name" "$pyrc"
    return 1
  fi
  local saved_mode="$CONTEXT_MODE" saved_reset="$RESET_CONVERSATION"
  local vrc=0 got="" failed="" pyrc=0
  # cw_verdict reads the global CONTEXT_MODE, so set it for the call and put it
  # back — a bare VAR=x cw_verdict would leave the assignment behind, and the next
  # case would be judged as the previous regime.
  CONTEXT_MODE="$mode"
  RESET_CONVERSATION="$case_reset"
  cw_verdict "$tsv" "$vout" "$aout"
  vrc=$?
  CONTEXT_MODE="$saved_mode"
  RESET_CONVERSATION="$saved_reset"
  case "$vrc" in 0) got=0 ;; 2) got=4 ;; *) got=1 ;; esac
  failed=$(sed -n 's/^failed=//p' "$vout" 2>/dev/null | tail -1)
  if [ "$got" != "$want" ]; then
    printf 'selftest %-20s FAIL  exit=%s expected=%s (failed=%s)\n' "$name" "$got" "$want" "${failed:-none}"
    return 1
  fi
  if [ -n "$must" ]; then
    case ",$failed," in
      *",$must,"*) ;;
      *)
        printf 'selftest %-20s FAIL  exit ok but %s not in failed=(%s)\n' "$name" "$must" "${failed:-none}"
        return 1 ;;
    esac
  fi
  printf 'selftest %-20s PASS  exit=%s failed=%s\n' "$name" "$got" "${failed:-none}"
  return 0
}

# ── env validation ───────────────────────────────────────────────────
cw_require_int() {
  local name="$1" value="$2" min="$3"
  case "$value" in
    ''|*[!0-9]*) printf 'FATAL: %s must be a non-negative integer (got %s)\n' "$name" "$value" >&2; return 1 ;;
  esac
  if [ "$value" -lt "$min" ]; then
    printf 'FATAL: %s must be >= %s (got %s)\n' "$name" "$min" "$value" >&2
    return 1
  fi
  return 0
}

# The stored value that selects the regime. Compactor.parseContextMode maps
# anything that is not "0"/"false"/"off"/"ciswire" to anchored, so anchored is
# stored as "1" (the same string ci-e2e.sh writes for compaction on), and the
# read-back below compares against that exact string.
cw_mode_value() {
  case "$1" in
    ciswire) printf '%s\n' "ciswire" ;;
    anchored) printf '%s\n' "1" ;;
    *) return 1 ;;
  esac
}

cw_validate_env() {
  case "$CONTEXT_MODE" in
    ciswire|anchored) ;;
    *) printf 'FATAL: CONTEXT_MODE must be ciswire or anchored (got %s)\n' "$CONTEXT_MODE" >&2; return 1 ;;
  esac
  cw_require_int TURNS "$TURNS" 1 || return 1
  cw_require_int PROMPT_CHARS "$PROMPT_CHARS" 200 || return 1
  cw_require_int SEED "$SEED" 0 || return 1
  cw_require_int REPLY_TIMEOUT "$REPLY_TIMEOUT" 30 || return 1
  cw_require_int READY_TIMEOUT "$READY_TIMEOUT" 30 || return 1
  cw_require_int TURN_END_POLL_S "$TURN_END_POLL_S" 1 || return 1
  cw_require_int TURN_END_DB_POLL_S "$TURN_END_DB_POLL_S" 1 || return 1
  cw_require_int CW_THERMAL_STOP "$CW_THERMAL_STOP" 1 || return 1
  cw_require_int CW_TEMP_STOP_DECI "$CW_TEMP_STOP_DECI" 300 || return 1
  cw_require_int CW_BATTERY_FLOOR "$CW_BATTERY_FLOOR" 1 || return 1
  case "$RESET_CONVERSATION" in
    0|1) ;;
    *) printf 'FATAL: RESET_CONVERSATION must be 0 or 1 (got %s)\n' "$RESET_CONVERSATION" >&2; return 1 ;;
  esac
  case "$MODEL_DIR" in ''|*/*) printf 'FATAL: MODEL_DIR must be a single path segment (got %s)\n' "$MODEL_DIR" >&2; return 1 ;; esac
  case "$MODEL_FILE" in ''|*.gguf) ;; *) printf 'FATAL: MODEL_FILE must end in .gguf (got %s)\n' "$MODEL_FILE" >&2; return 1 ;; esac
  local tool
  for tool in adb sqlite3 python3; do
    command -v "$tool" >/dev/null 2>&1 || { printf 'FATAL: %s is required and not on PATH\n' "$tool" >&2; return 1; }
  done
  return 0
}

# Model bytes on the device. A run whose model is missing is the failure mode
# ci-lib's assert_engine_ran exists for (an arm that looked like a model failure);
# catching it before the first turn costs one adb call.
cw_check_model_on_device() {
  local path="files/models/$MODEL_DIR/$MODEL_FILE" size
  if ! adb shell "run-as $PKG test -f '$path'" </dev/null >/dev/null 2>&1; then
    printf 'FATAL: %s not found in %s on the device — sideload it first\n' "$MODEL_FILE" "$MODEL_DIR" >&2
    return 1
  fi
  size=$(adb shell "run-as $PKG stat -c %s '$path'" </dev/null 2>/dev/null | tr -d '\r')
  case "$size" in
    ''|*[!0-9]*) printf 'FATAL: %s present but its size is unreadable\n' "$MODEL_FILE" >&2; return 1 ;;
  esac
  log "model on device: dir=$MODEL_DIR bytes=$size"
  printf 'model=%s\nmodel_bytes=%s\n' "$MODEL_DIR/$MODEL_FILE" "$size" >> "$OUT/run.meta.tsv"
  return 0
}

# ── main ─────────────────────────────────────────────────────────────
cw_main() {
  local apk_arg="" verdict_only="" compare_a="" compare_b="" self_test=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --self-test) self_test=1; shift ;;
      --verdict-only)
        [ $# -ge 2 ] || { printf 'FATAL: --verdict-only needs a turns.tsv\n' >&2; return 1; }
        verdict_only="$2"; shift 2 ;;
      --compare)
        [ $# -ge 3 ] || { printf 'FATAL: --compare needs two run directories\n' >&2; return 1; }
        compare_a="$2"; compare_b="$3"; shift 3 ;;
      -h|--help)
        # The header IS the help text; stop at the first line of code so the
        # printed range cannot drift when the header grows.
        awk 'NR > 1 && /^set -uo pipefail$/ {exit} NR > 1 {print}' "$0"
        return 0 ;;
      -*) printf 'FATAL: unknown flag %s\n' "$1" >&2; return 1 ;;
      *) apk_arg="$1"; shift ;;
    esac
  done

  # stdin is /dev/null for the WHOLE process: a caller's stdin otherwise gets eaten
  # by the first adb call and the loop hangs. This script's own adb calls pass
  # </dev/null explicitly; the sourced helpers (device-share-send's tap_node /
  # dump_ui, device-env's probes) do not, and this covers them.
  exec </dev/null

  if [ "$self_test" = 1 ]; then
    # No device, no adb: the fixture proves the verdict can go red.
    cw_selftest
    return $?
  fi
  if [ -n "$compare_a" ]; then
    cw_compare "$compare_a" "$compare_b"
    return $?
  fi
  if [ -n "$verdict_only" ]; then
    # Test hook: judge a stored/synthetic TSV with no device. Returns the same
    # codes as a full run (0 PASS / 4 FAIL) so callers need one convention;
    # 1 means the verdict could not be computed at all.
    cw_verdict "$verdict_only" "${verdict_only}.VERDICT.txt" "${verdict_only}.aggregate.tsv"
    local vrc=$?
    cat "${verdict_only}.VERDICT.txt" 2>/dev/null || true
    case "$vrc" in
      0) return "$CW_EXIT_PASS" ;;
      2) return "$CW_EXIT_FAIL" ;;
      *) return 1 ;;
    esac
  fi

  if [ -n "$apk_arg" ]; then APK="$apk_arg"; fi
  cw_validate_env || return 1

  mkdir -p "$OUT" || { printf 'FATAL: cannot create %s\n' "$OUT" >&2; return 1; }
  CW_LOG_FILE="$OUT/run.log"
  if : > "$CW_LOG_FILE" 2>/dev/null; then CW_LOG_OK=1; else CW_LOG_OK=0; log "WARNING: cannot write $CW_LOG_FILE — lines stay stdout-only"; fi

  [ -f "$APK" ] || { printf 'FATAL: APK not found: %s\n' "$APK" >&2; return 1; }
  local apk_bytes apk_sha
  apk_bytes=$(wc -c < "$APK" 2>/dev/null | tr -d ' ')
  apk_sha=$(shasum -a 256 "$APK" 2>/dev/null | awk '{print $1}')
  # Artifacts are identified by bytes + hash: an APK path can carry a run id, and a
  # conversation id must never reach a filename.
  printf 'apk_bytes=%s\napk_sha256=%s\n' "${apk_bytes:-unknown}" "${apk_sha:-unknown}" > "$OUT/run.meta.tsv"

  local attached picked
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached") \
    || { printf "FATAL: need ANDROID_SERIAL (attached: %s)\n" "$(printf '%s' "$attached" | tr '\n' ' ')" >&2; return 1; }
  export ANDROID_SERIAL="$picked"
  BENCH_TARGET=device
  log "serial=$ANDROID_SERIAL target=$BENCH_TARGET mode=$CONTEXT_MODE model=$MODEL_DIR/$MODEL_FILE turns=$TURNS promptChars=$PROMPT_CHARS seed=$SEED"

  : > "$OUT/evidence.txt"
  : > "$OUT/telemetry.jsonl"
  printf '%s\n' "$CW_TSV_HEADER" > "$OUT/turns.tsv"
  cw_tsv_check "$OUT/turns.tsv" || return 1

  # ── device safety, before anything is installed or written ────────
  local state plugged level temp thermal wake wake_tok
  state=$(cw_probe_state)
  plugged=$(printf '%s\n' "$state" | sed -n 's/.*plugged=\([^ ]*\).*/\1/p')
  level=$(printf '%s\n' "$state" | sed -n 's/.*level=\([^ ]*\).*/\1/p')
  temp=$(printf '%s\n' "$state" | sed -n 's/.*temp_deci=\([^ ]*\).*/\1/p')
  thermal=$(printf '%s\n' "$state" | sed -n 's/.*thermal=\([^ ]*\).*/\1/p')
  local bg_first
  bg_first=$(cw_bg_cpu)
  log "state: $state bg=$bg_first"
  case "$plugged" in
    true) cw_abort "device is charging (plugged=true). Unplug it and re-run: timings and thermals taken on charge are not comparable (project rule)." ;;
    unknown) cw_abort "charging state unreadable (plugged=unknown). Refusing to measure on a power state it cannot prove." ;;
  esac
  case "$level" in
    ''|unknown|*[!0-9]*) cw_abort "battery level unreadable ($level)" ;;
    *) [ "$level" -lt "$CW_BATTERY_FLOOR" ] && cw_abort "battery ${level}% below the ${CW_BATTERY_FLOOR}% floor" ;;
  esac
  # Fail-closed: an unreadable thermal status is refused, not assumed cool. The
  # Jelly overheats fast and the whole point of the gate is that SEVERE is
  # detectable; "could not read it" is not evidence of a cool phone.
  if ! cw_thermal_ok "$thermal"; then
    cw_abort "thermal status '$thermal' is not a proved safe reading (need a number < ${CW_THERMAL_STOP}); refusing to start"
  fi
  case "$temp" in
    ''|unknown|*[!0-9]*) log "WARN: battery temperature unreadable ($temp)" ;;
    *) [ "$temp" -ge "$CW_TEMP_STOP_DECI" ] && cw_abort "battery temperature ${temp} deci-C >= ${CW_TEMP_STOP_DECI} at start" ;;
  esac

  # Never KEYCODE_POWER / KEYCODE_SLEEP / `svc power` / reboot: the Xiaomi is
  # lock-password protected and a power keyevent leaves it unreachable. A device
  # that is not Awake is an abort, not something this script tries to fix.
  #
  # FAIL-CLOSED on purpose. ci-lib's wakefulness_is_fatal treats ""/unknown as
  # "continue" (its documented contract, relied on elsewhere), but the keep-awake
  # path this script uses sends KEYCODE_WAKEUP (ci-lib.sh:1149, device-env.sh:104),
  # so proceeding on a probe that did not answer could wake a locked phone. Only an
  # unambiguous Awake passes here, and cw_keepawake_begin refuses to run at all
  # until that has happened (CW_SAFETY_GATE) — the restore half of keep-awake is
  # skipped before setup anyway (`_KA_SETUP_DONE` guard in ci-lib.sh:1152).
  wake=$(adb shell 'dumpsys power | grep -m1 mWakefulness' </dev/null 2>/dev/null | tr -d '\r')
  log "wakefulness raw: ${wake:-<unreadable>}"
  wake_tok="${wake##*mWakefulness=}"
  if ! cw_wakefulness_ok "$wake_tok"; then
    cw_abort "mWakefulness='${wake_tok:-<empty>}' is not a proved Awake — refusing to send a wake keyevent to a lock-password-protected phone; wake it by hand and re-run"
  fi
  CW_SAFETY_GATE=1
  log "safety gate passed (wakefulness=$wake_tok); keep-awake may now send KEYCODE_WAKEUP"
  printf 'plugged_at_start=%s\nbattery_pct_at_start=%s\nbattery_temp_deci_at_start=%s\nthermal_at_start=%s\nwakefulness=%s\nbg_cpu_at_start=%s\n' \
    "$plugged" "$level" "$temp" "$thermal" "${wake_tok:-unknown}" "$bg_first" >> "$OUT/run.meta.tsv"

  cw_check_model_on_device || return 1

  # ── keep-awake, then the capture ──────────────────────────────────
  # device_keepawake_begin arms device-env's EXIT trap; main replaces the trap
  # right after the capture starts and must chain BOTH of device-env's restore
  # calls, or a killed run leaves a 24h screen timeout and a Doze exemption behind.
  cw_keepawake_begin || return 1
  # The trap goes in BEFORE either mktemp: a failed second mktemp must still run the
  # cleanup (and, through it, the device restore). cw_cleanup guards every empty path
  # variable, so it is safe with nothing yet created.
  trap 'cw_cleanup; device_termux_wakelock_restore; _device_session_restore' EXIT
  CW_LOGCAT=$(mktemp "${TMPDIR:-/tmp}/kalsa-cw-logcat.XXXXXX") || { printf 'FATAL: cannot create a logcat file\n' >&2; return 1; }
  CW_SLICE_FILE=$(mktemp "${TMPDIR:-/tmp}/kalsa-cw-slice.XXXXXX") || { printf 'FATAL: cannot create a slice file\n' >&2; return 1; }
  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb logcat -v time </dev/null > "$CW_LOGCAT" 2>&1 &
  CW_LOGCAT_PID=$!
  cw_watchdog_start
  cw_marker_probe || return 1

  # ── install + prefs (the app must be STOPPED for sql_write) ───────
  adb shell am force-stop "$PKG" </dev/null >/dev/null 2>&1 || true
  sleep 3
  local install_log="$OUT/install.log" install_rc=0 lastup_before lastup_after version path
  lastup_before=$(adb shell "cmd package dump $PKG 2>/dev/null | grep -m1 lastUpdateTime" </dev/null 2>/dev/null | tr -d '\r')
  log "installing $APK (bytes=$apk_bytes sha256=$apk_sha)"
  adb install -r "$APK" > "$install_log" 2>&1 </dev/null
  install_rc=$?
  if [ "$install_rc" -ne 0 ]; then
    log "install failed (rc=$install_rc): $(tail -5 "$install_log" | tr '\n' ' ')"
    printf 'FATAL: adb install returned %s\n' "$install_rc" >&2
    return 1
  fi
  tail -3 "$install_log"
  version=$(adb shell "cmd package dump $PKG 2>/dev/null | grep -m1 versionName" </dev/null 2>/dev/null | tr -d '\r')
  lastup_after=$(adb shell "cmd package dump $PKG 2>/dev/null | grep -m1 lastUpdateTime" </dev/null 2>/dev/null | tr -d '\r')
  path=$(adb shell "pm path $PKG" </dev/null 2>/dev/null | tr -d '\r')
  if [ -z "$path" ]; then
    printf 'FATAL: %s is not installed after a successful adb install\n' "$PKG" >&2
    return 1
  fi
  log "installed: ${version:-versionName unreadable} | ${path} | ${lastup_after:-lastUpdateTime unreadable}"
  if [ -n "$lastup_before" ] && [ -n "$lastup_after" ] && [ "$lastup_before" = "$lastup_after" ]; then
    printf 'FATAL: lastUpdateTime did not change (%s): adb install reported success but the package on the device is the previous build\n' "$lastup_after" >&2
    return 1
  fi
  printf 'version=%s\nlast_update_before=%s\nlast_update_after=%s\n' \
    "${version:-unknown}" "${lastup_before:-unknown}" "${lastup_after:-unknown}" >> "$OUT/run.meta.tsv"

  local mode_value
  mode_value=$(cw_mode_value "$CONTEXT_MODE") || return 1
  # The ciswire gate audit is per-arm state; a stale one from another arm is the
  # blending ci-lib's clear_gate_audit exists to prevent.
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.ciswire.gateAudit';" "kalsa.ciswire.gateAudit" "__ABSENT__" || return 1
  # kalsa.bench.kvtranscript=1 is what device-share-send.sh's header names as the
  # difference between a ~2 s session load and an ~80 s re-prefill after the
  # `am start` that backgrounds RN and disposes the engine — i.e. it is the flag
  # that decides whether this run measures KV reuse at all. ON DISK (checked, not
  # assumed): the key is NOT read by this APK — it appears nowhere in src/, not in
  # benchConfig.ts's key list, and not in the shipped bundle (0 occurrences in
  # assets/index.android.bundle), while session save/load is unconditional. So it is
  # written and verified defensively: a build that does read it must not silently
  # punish this run, and the read-back is recorded either way.
  # Arm isolation in the same write: ciswireFlags bit1 is memory facts and bit2 is
  # tool-help (AppShell turnCiswireFlags). Either one riding the arm contaminates
  # the measurement, so both are forced off with the same string flags.sh writes.
  if ! sql_write "
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','$mode_value');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction.choice','1');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.kvtranscript','1');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.memory.enabled','0');
INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.ciswire.toolhelp','0');
" "kalsa.context.compaction" "$mode_value"; then
    printf 'FATAL: could not write the prefs (sql_write failed)\n' >&2
    return 1
  fi
  # Every one confirmed by reading it back, not by assuming the write landed.
  local rb_model rb_mode rb_choice rb_kvt rb_mem rb_tool
  rb_model=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.model.id';" 2>/dev/null || true)
  rb_mode=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction';" 2>/dev/null || true)
  rb_choice=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.context.compaction.choice';" 2>/dev/null || true)
  rb_kvt=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.kvtranscript';" 2>/dev/null || true)
  rb_mem=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.memory.enabled';" 2>/dev/null || true)
  rb_tool=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.ciswire.toolhelp';" 2>/dev/null || true)
  log "prefs read back: model=${rb_model:-<absent>} compaction=${rb_mode:-<absent>} choice=${rb_choice:-<absent>} kvtranscript=${rb_kvt:-<absent>} memory=${rb_mem:-<absent>} toolhelp=${rb_tool:-<absent>}"
  if [ "$rb_model" != "$MODEL_DIR" ] || [ "$rb_mode" != "$mode_value" ]; then
    printf 'FATAL: pref read-back mismatch (model=%s want %s, compaction=%s want %s)\n' \
      "${rb_model:-<absent>}" "$MODEL_DIR" "${rb_mode:-<absent>}" "$mode_value" >&2
    return 1
  fi
  if [ "$rb_kvt" != "1" ]; then
    printf 'FATAL: kvtranscript read-back=%s, expected 1 — without it the post-share engine disposal may re-prefill instead of restoring the session\n' "${rb_kvt:-<absent>}" >&2
    return 1
  fi
  if [ "$rb_mem" != "0" ] || [ "$rb_tool" != "0" ]; then
    printf 'FATAL: arm isolation read-back wrong (memory=%s want 0, toolhelp=%s want 0)\n' \
      "${rb_mem:-<absent>}" "${rb_tool:-<absent>}" >&2
    return 1
  fi
  printf 'context_mode=%s\ncompaction_value=%s\nmodel_dir=%s\nkvtranscript_verified=1\nmemory_enabled=%s\ntoolhelp=%s\n' \
    "$CONTEXT_MODE" "$mode_value" "$MODEL_DIR" "$rb_mem" "$rb_tool" >> "$OUT/run.meta.tsv"

  # Fresh conversation: the seeded arithmetic (turn N crosses the ceiling at a
  # known turn) only holds from an empty history, and a compactor state left by
  # another run would be loaded and then reset mid-run. Scoped to the app's chat
  # keys — never files/models, which holds GB of verified GGUF.
  if [ "$RESET_CONVERSATION" = "1" ]; then
    if ! sql_write "
DELETE FROM catalystLocalStorage WHERE key='kalsa.conversations.v1';
DELETE FROM catalystLocalStorage WHERE key LIKE 'kalsa.messages.%';
DELETE FROM catalystLocalStorage WHERE key LIKE 'kalsa.chat.compactor.%';
DELETE FROM catalystLocalStorage WHERE key LIKE 'kalsa.chat.summary.%';
DELETE FROM catalystLocalStorage WHERE key='kalsa.conversations.migrated';
" "kalsa.conversations.v1" "__ABSENT__"; then
      printf 'FATAL: could not reset the conversation keys\n' >&2
      return 1
    fi
    local leftover
    leftover=$(sql "SELECT count(*) FROM catalystLocalStorage WHERE key LIKE 'kalsa.messages.%';" 2>/dev/null || true)
    log "conversation reset: leftover kalsa.messages.% rows=${leftover:-unreadable}"
  else
    log "RESET_CONVERSATION=0 — continuing the conversation already on the device"
  fi
  # Sessions are keyed by conversation stem: a stale .kvs would be loaded by the
  # restore turn and that measurement would be about another conversation.
  adb shell "run-as $PKG sh -c 'rm -f files/sessions/*.kvs files/sessions/*.kvs.meta files/sessions/*.kvs.bak files/sessions/*.kvs.tmp'" </dev/null >/dev/null 2>&1 || true

  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1 || true
  if ! cw_wait_ready; then
    printf 'FATAL: app never reported Ready after relaunch\n' >&2
    return 1
  fi

  # cw_wait_ready matches the "Ready"/"Pronto" status label, which the app can
  # render BEFORE it has created and persisted the fresh conversation: observed as
  # "ready after 0s" on a warm boot, racing ahead of conversation creation and
  # tripping the FATAL below (genuine cold boots reported 5-10s and did not). The
  # label is not a reliable precondition; gate on the real state instead. The app
  # writes kalsa.conversations.v1 within ~5s of a cold boot (measured on the S23).
  local conv_wait=0 conv_rows
  while [ "$conv_wait" -lt "${CW_CONV_TIMEOUT:-40}" ]; do
    conv_rows=$(sql "SELECT count(*) FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || printf 0)
    case "$conv_rows" in ''|*[!0-9]*) conv_rows=0 ;; esac
    [ "$conv_rows" -ge 1 ] && break
    sleep 5
    conv_wait=$((conv_wait + 5))
  done
  log "conversation index wait: ${conv_wait}s (rows=${conv_rows:-0})"

  # ── the conversation this run measures ────────────────────────────
  local index_raw start_count
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  if ! CW_CHAT_ID=$(cw_active_chat_id "$index_raw"); then
    # Top level: the fatal check is NOT inside the command substitution.
    printf 'FATAL: no active conversation id after relaunch — the compactor state and the reply count cannot be read\n' >&2
    return 1
  fi
  if ! start_count=$(cw_assistant_count "$CW_CHAT_ID"); then
    printf 'FATAL: cannot read the conversation from the device database — the whole capture path is dead\n' >&2
    return 1
  fi
  if [ "$start_count" -ne 0 ]; then
    if [ "$RESET_CONVERSATION" = "1" ]; then
      printf 'FATAL: the fresh conversation already holds %s assistants; the reset did not take and the window arithmetic would be wrong\n' "$start_count" >&2
      return 1
    fi
    log "WARN: RESET_CONVERSATION=0 and the conversation holds ${start_count} assistants — the turn at which the window crosses the ceiling is not predictable this run"
  fi
  log "conversation ready: assistants=${start_count} (its id is held in memory only and never reaches an artifact)"

  # ── drive ─────────────────────────────────────────────────────────
  local i rc text turn_rc=0 prev_count="$start_count"
  for i in $(seq 1 "$TURNS"); do
    if cw_watchdog_stop_requested; then turn_rc=2; break; fi
    text=$(cw_prompt "$i") || { printf 'FATAL: prompt generation failed on turn %s\n' "$i" >&2; return 1; }
    log "=== turn ${i}/${TURNS} ($(printf '%s' "$text" | wc -c | tr -d ' ') bytes) ==="
    cw_drive_turn "$i" "$text" "$prev_count"
    rc=$?
    if [ "$rc" -eq 3 ]; then
      printf 'FATAL: the capture could not be recorded on turn %s — stopping rather than producing a partial artifact that looks complete\n' "$i" >&2
      return 1
    fi
    if [ "$rc" -eq 2 ]; then turn_rc=2; break; fi
    if [ "$rc" -ne 0 ]; then turn_rc=1; log "turn ${i}: not completed (rc=$rc) — recorded and continuing"; fi
    # The post-turn count is both evidence and the next turn's baseline, so the
    # reply check costs one DB read per turn, not a poll. A FAILED read ABORTS: the
    # storage path this harness reads its operand through has died, and continuing
    # with an empty baseline would silently disable the reply cross-check (the
    # device-share-send helper family resolves the conversation id through a `die`
    # inside $(...), where the fatality is lost to the subshell).
    if ! prev_count=$(cw_assistant_count "$CW_CHAT_ID"); then
      printf 'FATAL: the conversation could not be read back after turn %s — the storage path is dead, so the remaining rows would be unverifiable\n' "$i" >&2
      return 1
    fi
    log "state: $(cw_probe_state)"
  done

  if [ "$turn_rc" -ne 2 ]; then
    log "=== restore: force-stop -> relaunch -> one continuation turn ==="
    adb shell am force-stop "$PKG" </dev/null >/dev/null 2>&1 || true
    sleep 5
    text=$(cw_prompt "$((TURNS + 1))") || { printf 'FATAL: restore prompt generation failed\n' >&2; return 1; }
    cw_restore_turn "$((TURNS + 1))" "$text" "$prev_count"
    rc=$?
    if [ "$rc" -eq 3 ]; then
      printf 'FATAL: the restore row could not be recorded\n' >&2
      return 1
    fi
    if [ "$rc" -eq 2 ]; then turn_rc=2; fi
  fi

  # ── verdict ───────────────────────────────────────────────────────
  cw_tsv_check "$OUT/turns.tsv" || return 1
  # Re-check the watchdog one last time: a charging/thermal stop that arrived while
  # the last slice was being extracted would otherwise be missed and the run would
  # still print PASS/FAIL as if the device had been inside its envelope throughout.
  if [ "$turn_rc" -ne 2 ] && cw_watchdog_stop_requested; then
    turn_rc=2
  fi
  if [ "$turn_rc" -eq 2 ]; then
    printf 'verdict=ABORTED reason=device_safety_stop\n' >> "$OUT/VERDICT.txt" || { printf 'FATAL: cannot write %s/VERDICT.txt\n' "$OUT" >&2; return 1; }
    log "run aborted by a device-safety stop; the TSV holds the rows recorded up to that point"
    cat "$OUT/VERDICT.txt"
    return "$CW_EXIT_ABORT"
  fi

  cw_verdict "$OUT/turns.tsv" "$OUT/VERDICT.txt" "$OUT/aggregate.tsv"
  rc=$?
  cat "$OUT/VERDICT.txt"
  if [ "$rc" -eq 1 ]; then
    printf 'FATAL: the verdict could not be computed\n' >&2
    return 1
  fi
  log "artifacts: $OUT/VERDICT.txt $OUT/turns.tsv $OUT/aggregate.tsv $OUT/evidence.txt $OUT/run.meta.tsv"
  if [ "$rc" -eq 0 ]; then return "$CW_EXIT_PASS"; fi
  return "$CW_EXIT_FAIL"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  cw_main "$@"
  exit $?
fi
