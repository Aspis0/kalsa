#!/usr/bin/env bash
# DFlash vs MTP A/B on one emulator session (same install, two configs).
# CONFIG A = production MTP (no speculative seed). CONFIG B = draft-dflash.
# Measurement only: a slow DFLASH verdict does NOT fail the job. Failures:
#   - model / draft not installable (size mismatch or missing path)
#   - app never reaches Ready
#   - no KALSA_TELEMETRY lines for a config (knob did not take)
#
# Env (set by .github/workflows/dflash-ab.yml):
#   MODEL_FILE / MODEL_DIR  — Qwen3.5-4B (only model with a DFlash draft)
#   DRAFT_FILE              — basename discovered from HF API
#   THINKING                — forced off for clean decode telemetry
set -uo pipefail
OUT="dflash-ab-out"; mkdir -p "$OUT"
MODEL_FILE="${MODEL_FILE:-Qwen3.5-4B-Q4_K_M.gguf}"
MODEL_DIR="${MODEL_DIR:-qwen3.5-4b}"
# ModelRegistry sizeBytes for qwen3.5-4b Q4_K_M — app accepts the file by size.
EXPECTED_MODEL_BYTES=2834975040
THINKING="${THINKING:-off}"
DRAFT_FILE="${DRAFT_FILE:-}"
PKG=com.kalsa.app
APK_PATH="${APK_PATH:-android/app/build/outputs/apk/release/app-release.apk}"
# Host-side draft GGUF produced by the workflow (cached curl download).
DRAFT_HOST="${DRAFT_HOST:-draft.gguf}"

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

# Run 31234384102: zero KALSA_TELEMETRY at end-capture even though both MTP
# turns completed — the default logcat ring buffer rotated the lines out over
# the ~8-min config. Belt 1: grow the buffer. (Belt 2: per-turn snapshots in
# run_turn; capture_telemetry merges them.)
adb logcat -G 16M 2>/dev/null || true

[ -f "$APK_PATH" ] || die "APK not found at $APK_PATH"
[ -f "model.gguf" ] || die "model.gguf not found in cwd (download step missing?)"
[ -n "$DRAFT_FILE" ] || die "DRAFT_FILE env empty — workflow must resolve HF .gguf name"
[ -f "$DRAFT_HOST" ] || die "draft host file missing at $DRAFT_HOST"

# ---------------------------------------------------------------------------
# Install main model + draft GGUF into app sandbox.
# ---------------------------------------------------------------------------
install_and_sideload "$APK_PATH" "model.gguf" "$MODEL_DIR" "$MODEL_FILE"

# Verify main model landed with the catalog size (download/accept gate).
MODEL_DEV_PATH="/data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE"
MODEL_DEV_SZ=$(adb shell "stat -c %s $MODEL_DEV_PATH" 2>/dev/null | tr -d '\r')
[ "$MODEL_DEV_SZ" = "$EXPECTED_MODEL_BYTES" ] \
  || die "main model size on device '$MODEL_DEV_SZ' != ModelRegistry sizeBytes $EXPECTED_MODEL_BYTES"

# The 4B bundle also REQUIRES the mmproj: isModelBundleDownloaded checks BOTH
# files by exact byte size. Run 31229531625 failed at Ready with the header
# showing "Download 3.5 GB" because only the main GGUF was present.
EXPECTED_MMPROJ_BYTES=672423616
MMPROJ_FILE="mmproj-F16.gguf"
[ -f "mmproj.gguf" ] || die "mmproj.gguf not found in cwd (download step missing?)"
adb push mmproj.gguf /data/local/tmp/mmproj.gguf 2>&1 | tail -1
adb shell "cp /data/local/tmp/mmproj.gguf /data/data/$PKG/files/models/$MODEL_DIR/$MMPROJ_FILE"
adb shell "rm -f /data/local/tmp/mmproj.gguf"
MMPROJ_UID=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
adb shell "chown -R $MMPROJ_UID:$MMPROJ_UID /data/data/$PKG/files/models"
MMPROJ_DEV_SZ=$(adb shell "stat -c %s /data/data/$PKG/files/models/$MODEL_DIR/$MMPROJ_FILE" 2>/dev/null | tr -d '\r')
[ "$MMPROJ_DEV_SZ" = "$EXPECTED_MMPROJ_BYTES" ] \
  || die "mmproj size on device '$MMPROJ_DEV_SZ' != ModelRegistry mmproj.sizeBytes $EXPECTED_MMPROJ_BYTES"
log "mmproj OK ($MMPROJ_DEV_SZ bytes)"

install_draft() {
  # Release APK is non-debuggable → run-as is unreliable; adb root (set by
  # install_and_sideload) + direct /data/data paths match ci-lib sideload.
  local host="$1" file="$2"
  local dest_dir="/data/data/$PKG/files/models/draft"
  local dest="$dest_dir/$file"
  local host_sz dev_sz

  host_sz=$(stat -c%s "$host" 2>/dev/null || wc -c < "$host" | tr -d ' ')
  log "sideload draft $file (host ${host_sz} bytes)"
  adb push "$host" /data/local/tmp/draft.gguf 2>&1 | tail -1
  adb shell "mkdir -p $dest_dir"
  adb shell "cp /data/local/tmp/draft.gguf $dest"
  adb shell "rm -f /data/local/tmp/draft.gguf"
  local uid_line
  uid_line=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
  adb shell "chown -R $uid_line:$uid_line /data/data/$PKG/files/models"
  adb shell "ls -la $dest_dir/" | tr -d '\r' | tee "$OUT/draft_ls.txt"
  dev_sz=$(adb shell "stat -c %s $dest" 2>/dev/null | tr -d '\r')
  [ -n "$dev_sz" ] && [ "$dev_sz" = "$host_sz" ] \
    || die "draft not installable: device size '$dev_sz' != host $host_sz (path $dest)"
  log "draft OK at $dest ($dev_sz bytes)"
}
install_draft "$DRAFT_HOST" "$DRAFT_FILE"

DRAFT_DEV_PATH="/data/data/$PKG/files/models/draft/$DRAFT_FILE"

# ---------------------------------------------------------------------------
# Prefs / conversation helpers
# ---------------------------------------------------------------------------
seed_kv() {
  local key="$1" value="$2" esc
  esc=$(printf '%s' "$value" | sed "s/'/''/g")
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('$key','$esc');"
}

# JSON-safe seeding: sql() wraps the statement in shell double quotes, which EAT
# the JSON's own double quotes — the stored value became {type:none} (invalid
# JSON), JSON.parse failed, the knob fell back to production MTP, and EVERY
# "dflash" arm to date silently ran MTP (prefs_dflash.txt evidence, runs up to
# 31269775645). Host-side SQL file + adb push, same pattern as ci-screens.
seed_kv_json() {
  local key="$1" value="$2"
  local sql_file="$OUT/_seed.sql"
  printf '%s' "$value" > "$OUT/_seed_val.json"
  node -e 'const fs=require("fs");const key=process.argv[1];const val=fs.readFileSync(process.argv[2],"utf8");const esc=val.replace(/\x27/g,"\x27\x27");fs.writeFileSync(process.argv[3],"INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (\x27"+key+"\x27,\x27"+esc+"\x27);\n");' \
    "$key" "$OUT/_seed_val.json" "$sql_file"
  adb push "$sql_file" /data/local/tmp/kalsa_seed.sql >/dev/null 2>&1
  adb shell "sqlite3 $DB < /data/local/tmp/kalsa_seed.sql" 2>&1 | tr -d '\r' || true
}

# Fail-closed seed verify: the stored value must round-trip as the EXACT JSON.
verify_seed_json() {
  local key="$1" expect_sub="$2" out_file="$3"
  sql "SELECT key,value FROM catalystLocalStorage WHERE key='$key';" | tee "$out_file"
  grep -qF "$expect_sub" "$out_file" \
    || die "seed for $key did not land verbatim (expected substring: $expect_sub)"
}

clear_speculative() {
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.speculative';" || true
}

reset_chat() {
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" || true
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';" || true
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';" || true
}

set_base_prefs() {
  # Compaction on (production default); thinking off for clean decode numbers.
  seed_kv "kalsa.model.id" "$MODEL_DIR"
  seed_kv "kalsa.context.compaction" "1"
  seed_kv "kalsa.bench.thinking" "$THINKING"
  sql "SELECT key,substr(value,1,80) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"
}

# Run 31235650917: a "Pixel Launcher isn't responding" ANR dialog covered the
# screen at presend (AVD strained after 3.5GB of pushes) and the composer was
# unfindable. Tap Wait (keeps processes) and re-foreground the app.
dismiss_anr() {
  if dump_ui | grep -qE "isn.{1,3}t responding"; then
    log "ANR dialog detected — tapping Wait + relaunching activity"
    tap_node "Wait" || true
    sleep 3
    adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
    sleep 8
  fi
}

wait_ready() {
  # Engine load is LAZY: it starts on the first SEND, not at app launch — an
  # idle app never shows "Ready" (run 31232372791: stuck at "Downloaded",
  # native heap 31MB, zero llama logcat: nothing was ever asked to load; the
  # 2B e2e works precisely because it sends first and its reply poll absorbs
  # the load). So: settle briefly, then let run_two_turns trigger the load;
  # the turn-1 poll ceiling covers 4B load+prefill on the AVD.
  local label="$1"
  log "settle before first send ($label) — engine loads lazily on send"
  sleep 20
  dismiss_anr
  shot "presend_${label}"
  ui_texts > "$OUT/presend_${label}.txt"
}

force_stop_relaunch() {
  adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
  sleep 3
  adb logcat -c
  adb shell am start -n "$PKG/.MainActivity" >/dev/null
  sleep 20
}

# One user turn: type alphanumeric prompt, send, poll until assistant count
# reaches min_assistants. Sets global LAST_REPLY / LAST_ELAPSED.
# Prefix for evidence files: $OUT/${tag}_*
run_turn() {
  local tag="$1" msg="$2" min_assistants="$3"
  local sent i hist n reply poll_prefix lines_now quiesced prev_lines
  prev_lines=""

  log "[$tag] type message: $msg"
  dismiss_anr
  tap_node "Ask a question…" || { dismiss_anr; tap_node "Ask a question…" || die "composer not found ($tag)"; }
  sleep 4
  # PROVEN retry shape only: tap + retype (runs 4/6/7 always landed by the 2nd
  # attempt). The v2.1 ESC+DEL-burst variant defocused the field and went 0/3
  # (run 31250710247). Short prompts (<=25 chars) already dodge the ~32-char
  # adb input-text truncation that caused fragment appends.
  typed_ok=0
  for attempt in 1 2 3 4; do
    adb shell input text "$msg"
    sleep 3
    if dump_ui | grep -qF "$msg"; then
      typed_ok=1
      break
    fi
    log "[$tag] text not visible (attempt $attempt) — re-tapping composer"
    dismiss_anr
    tap_node "Ask a question…" || true
    sleep 3
  done
  adb shell input keyevent 111
  sleep 3
  shot "${tag}_typed"
  ui_texts > "$OUT/${tag}_typed.txt"
  grep -qF "$msg" "$OUT/${tag}_typed.txt" || die "typing did not land in the composer ($tag)"

  log "[$tag] send"
  tap_node "Send" || die "Send button not found ($tag)"
  sent=$(date +%s)
  sleep 20
  ui_texts > "$OUT/${tag}_sent.txt"
  shot "${tag}_sent"
  grep -qF "$msg" "$OUT/${tag}_sent.txt" || die "message did not appear after send ($tag)"

  reply=""
  poll_prefix="${tag}_poll"
  # 120×15s = 30 min ceiling: turn 1 pays lazy engine load (4B 2.8GB + mmproj)
  # PLUS prefill on the AVD; turn 2 finishes early and just exits the loop.
  for i in $(seq 1 120); do
    sleep 15
    ui_texts > "$OUT/${poll_prefix}_$i.txt"
    shot "${poll_prefix}_$i" 2>/dev/null
    # TRUE turn-end signal = the KALSA_TELEMETRY line, emitted only when the
    # native completion returns. Counting assistant bubbles in the DB fired
    # EARLY (run 31252095679: partial-turn persistence saves the streaming
    # bubble mid-generation — harness moved on while t3 was still Writing,
    # then t4 typing hit a busy app and the extracted "reply" was a fragment).
    # util-* excluded; DISTINCT turnIds, not lines: web tools are always on by
    # design ("il modello decide") and a tool round emits one line per round —
    # all sharing the turn's id — so a search-y turn must not double-count.
    # Plus QUIESCENCE: a tool turn emits its round-0 line before the tool even
    # runs, so the id shows up mid-turn; require no NEW line since the last
    # 15s poll before declaring the turn done.
    n=$(adb logcat -d 2>/dev/null | grep -F "KALSA_TELEMETRY" | grep -v '"turnId":"util-' \
        | grep -oE '"turnId":"[0-9]+"' | sort -u | wc -l | tr -d ' \r')
    lines_now=$(adb logcat -d 2>/dev/null | grep -cF "KALSA_TELEMETRY" | tr -d ' \r')
    quiesced=0
    if [ "${lines_now:-0}" = "${prev_lines:-x}" ]; then quiesced=1; fi
    prev_lines="$lines_now"
    if [ "${n:-0}" -ge "$min_assistants" ] && [ "$quiesced" = 1 ]; then
      hist=$(sql "SELECT substr(value,1,12000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
      echo "$hist" > "$OUT/${tag}_history_$i.json"
      reply=$(echo "$hist" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
      log "[$tag] REPLY AFTER $(( $(date +%s) - sent ))s (telemetry_lines=$n): $reply"
      break
    fi
    log "[$tag] poll $i: still generating ($(( $(date +%s) - sent ))s) telemetry_lines=${n:-0}"
  done

  LAST_REPLY="$reply"
  LAST_ELAPSED=$(( $(date +%s) - sent ))
  [ -n "$LAST_REPLY" ] || die "no assistant reply captured ($tag)"

  # Belt 2 vs logcat rotation: snapshot telemetry lines NOW, seconds after the
  # turn emitted them, instead of trusting the buffer at config end.
  adb logcat -d | grep -F "KALSA_TELEMETRY" \
    | sed 's/.*KALSA_TELEMETRY /KALSA_TELEMETRY /' \
    >> "$OUT/telemetry_snap_${tag}.txt" 2>/dev/null || true
  # Diagnostic probe (run 31236583365: snap EMPTY even seconds after the turn —
  # not buffer rotation): are ReactNativeJS console lines present AT ALL?
  adb logcat -d -s ReactNativeJS 2>/dev/null | tail -40 \
    > "$OUT/rnjs_probe_${tag}.txt" || true
}

# Two-turn conversation identical to ci-e2e.sh prompts (alphanumeric for adb).
run_two_turns() {
  local config="$1"
  LAST_REPLY=""; LAST_ELAPSED=0
  run_turn "${config}_t1" "CiaoChiSei" 1
  echo "elapsed_t1_s=$LAST_ELAPSED" >> "$OUT/${config}_turns.txt"
  echo "reply_t1<<<" >> "$OUT/${config}_turns.txt"
  echo "$LAST_REPLY" >> "$OUT/${config}_turns.txt"
  echo ">>>" >> "$OUT/${config}_turns.txt"

  run_turn "${config}_t2" "EDimmiUnAltroFattoBreve" 2
  echo "elapsed_t2_s=$LAST_ELAPSED" >> "$OUT/${config}_turns.txt"
  echo "reply_t2<<<" >> "$OUT/${config}_turns.txt"
  echo "$LAST_REPLY" >> "$OUT/${config}_turns.txt"
  echo ">>>" >> "$OUT/${config}_turns.txt"

  # Turns 3-4: the first A/B (run 31239117041) rode on 9-33 draft tokens —
  # too thin to call a winner. t3 = long-form open generation (the regime
  # where MTP acceptance collapsed to 30%); t4 = structured/list output
  # (predictable regime where the embedded head shone). Alphanumeric-only
  # prompts (adb input text constraint).
  # <=28 chars: adb `input text` TRUNCATES long strings on a loaded AVD (run
  # 31249441015: three ~32-char truncations of a 39-char prompt concatenated
  # in the composer — retries appended instead of replacing).
  run_turn "${config}_t3" "StoriaDiPalermoDieciFrasi" 3
  echo "elapsed_t3_s=$LAST_ELAPSED" >> "$OUT/${config}_turns.txt"
  run_turn "${config}_t4" "ElencaVentiCittaItaliane" 4
  echo "elapsed_t4_s=$LAST_ELAPSED" >> "$OUT/${config}_turns.txt"
}

capture_telemetry() {
  # Split locals: in `local a="$1" b="...$a..."` bash expands ALL args BEFORE
  # any assignment, so $a is unbound under set -u (run 31237878782, line 252).
  local config="$1"
  local dest="$OUT/telemetry_${config}.txt"
  log "capturing KALSA_TELEMETRY → telemetry_${config}.txt"
  # Merge per-turn snapshots (belt 2, chronologically first) with the
  # end-capture; dedupe PRESERVING ORDER (report parsing relies on first line =
  # turn1 round0, last = turn2 final round) and drop util-* completions
  # (memory-extract etc.) so they can never masquerade as a chat turn.
  {
    cat "$OUT"/telemetry_snap_${config}_*.txt 2>/dev/null || true
    adb logcat -d | grep -F "KALSA_TELEMETRY" | sed 's/.*KALSA_TELEMETRY /KALSA_TELEMETRY /' || true
  } | grep -v '"turnId":"util-' | awk '!seen[$0]++' > "$dest" || true
  if [ ! -s "$dest" ]; then
    die "no KALSA_TELEMETRY lines for config=$config (speculative knob / engine path did not emit telemetry)"
  fi
  local n
  n=$(wc -l < "$dest" | tr -d ' ')
  log "telemetry_${config}: $n lines"
  # Need at least one parseable JSON payload (turn1); ideally two.
  if ! grep -q '{' "$dest"; then
    die "telemetry_${config}.txt has no JSON payload"
  fi
}

# ---------------------------------------------------------------------------
# CONFIG 0 — BASELINE: speculation OFF entirely (the missing control: is MTP
# net-positive vs plain decode when free-text acceptance sits at 30-44%?).
# ---------------------------------------------------------------------------
log "=== CONFIG 0: BASELINE (no speculation) ==="
# The AsyncStorage DB exists only after the app's FIRST run — seeding before
# that lands in a file RN then recreates (run 31263568869: the baseline arm
# silently ran production MTP; its telemetry showed draft tokens). AND the
# seed must run with the app STOPPED: RN holds the sqlite lock while running
# (run 31267900199: seed after force_stop_relaunch — which STARTS the app —
# did not land; the fail-closed assert caught it). Launch once to materialize
# the DB, STOP, seed, verify, relaunch.
force_stop_relaunch
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 3
# AsyncStorage creates its TABLE only on the app's first WRITE — a freshly
# launched idle app may leave RKStorage table-less, and the seed INSERT dies
# silently with 'no such table' (runs 31267900199/31268901866). Create it
# ourselves with AsyncStorage's own schema; harmless if it already exists.
sql "CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL);" \
  | tee "$OUT/seed_table_create.txt"
set_base_prefs
seed_kv_json "kalsa.bench.speculative" '{"type":"none"}'
# Fail-closed: a baseline without its VERBATIM seed is silent garbage science.
verify_seed_json "kalsa.bench.speculative" '"type":"none"' "$OUT/prefs_none.txt"
force_stop_relaunch
wait_ready "none"
run_two_turns "none"
capture_telemetry "none"
# Impossible-by-construction assert: the baseline must have ZERO draft tokens.
if grep -o '"draftTokens":[0-9]*' "$OUT/telemetry_none.txt" | grep -vq '"draftTokens":0'; then
  die "baseline arm SPECULATED (draftTokens>0 in telemetry_none.txt) — knob not honored"
fi
adb logcat -c

# ---------------------------------------------------------------------------
# CONFIG A — MTP (control): production path, no speculative seed.
# ---------------------------------------------------------------------------
log "=== CONFIG A: MTP (control) ==="
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 2
reset_chat
set_base_prefs
clear_speculative
force_stop_relaunch
wait_ready "mtp"
run_two_turns "mtp"
capture_telemetry "mtp"
adb logcat -c

# ---------------------------------------------------------------------------
# CONFIG B — DFlash: seed knobs, force-stop + relaunch (re-read at engine init).
# ---------------------------------------------------------------------------
log "=== CONFIG B: DFlash ==="
SPEC_JSON="{\"type\":\"draft-dflash\",\"draftModelPath\":\"$DRAFT_DEV_PATH\"}"
log "seed kalsa.bench.speculative=$SPEC_JSON"
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 2
reset_chat
set_base_prefs
seed_kv_json "kalsa.bench.speculative" "$SPEC_JSON"
# Fail-closed on the dflash arm too — the quoting bug ran every prior "dflash"
# arm as silent MTP; an arm that cannot prove its own config must die loudly.
verify_seed_json "kalsa.bench.speculative" '"type":"draft-dflash"' "$OUT/prefs_dflash.txt"
# Relaunch so LlamaService re-reads the override at init (idempotence fingerprint).
force_stop_relaunch
wait_ready "dflash"
run_two_turns "dflash"
capture_telemetry "dflash"
# Symmetric impossible-by-construction assert: the dflash arm MUST speculate.
# Run 31270817640: seed landed verbatim but the binding never loaded the draft
# (draft-mtp-only loader gate) → draftTokens=0 → the arm was a silent second
# baseline. An arm that cannot prove it differs from control dies loudly.
if ! grep -o '"draftTokens":[0-9]*' "$OUT/telemetry_dflash.txt" | grep -vq '"draftTokens":0'; then
  die "dflash arm did NOT speculate (all draftTokens=0) — draft model not engaged"
fi

# ---------------------------------------------------------------------------
# RESULT.txt — per-config per-turn metrics + final comparison.
# Never fail the job on a slow verdict.
# ---------------------------------------------------------------------------
export DRAFT_DEV_PATH
DRAFT_DEV_PATH="$DRAFT_DEV_PATH" node -e '
const fs = require("fs");
const path = require("path");
const outDir = process.argv[1];

function load(config) {
  const p = path.join(outDir, "telemetry_" + config + ".txt");
  let raw = "";
  try { raw = fs.readFileSync(p, "utf8"); } catch (_) {}
  const payloads = [];
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf("{");
    if (idx < 0) continue;
    try { payloads.push(JSON.parse(line.slice(idx))); } catch (_) {}
  }
  return payloads;
}

const n = (o, k) => {
  if (!o || o[k] == null) return null;
  const v = typeof o[k] === "number" ? o[k] : Number(o[k]);
  return Number.isFinite(v) ? v : null;
};

function turnMetrics(label, o) {
  if (!o) {
    return label + ": predicted=? predictedMs=? predictedPerSecond=? draftTokens=? draftAccepted=? acceptance=?% (missing)";
  }
  const predicted = n(o, "tokensPredicted");
  const predictedMs = n(o, "predictedMs");
  const ppsVal = n(o, "predictedPerSecond");
  const draftTokens = n(o, "draftTokens") ?? 0;
  const draftAccepted = n(o, "draftAccepted") ?? 0;
  // Guard div0: no drafts proposed → acceptance 0.0%, never NaN.
  const acc = draftTokens > 0
    ? ((100 * draftAccepted) / draftTokens).toFixed(1)
    : "0.0";
  return label
    + ": predicted=" + (predicted ?? "?")
    + " predictedMs=" + (predictedMs ?? "?")
    + " predictedPerSecond=" + (ppsVal != null ? ppsVal.toFixed(2) : "?")
    + " draftTokens=" + draftTokens
    + " draftAccepted=" + draftAccepted
    + " acceptance=" + acc + "%";
}

function pickTurns(payloads) {
  // First and last parseable lines ≈ turn1 / turn2 (same convention as ci-e2e).
  const t1 = payloads.length ? payloads[0] : null;
  const t2 = payloads.length >= 2 ? payloads[payloads.length - 1] : (payloads.length ? payloads[0] : null);
  return { t1, t2 };
}

// Aggregate decode tok/s over WARM turns (skip payload[0] = cold turn 1):
// sum(predicted)/sum(predictedMs). More draft tokens mean more statistical
// weight than any single-turn ratio. (No apostrophes here: single-quoted node -e.)
function warmAggregate(payloads) {
  let tok = 0, ms = 0;
  for (const o of payloads.slice(1)) {
    const p = n(o, "tokensPredicted") ?? n(o, "predicted") ?? 0;
    const t = n(o, "predictedMs") ?? 0;
    if (p > 0 && t > 0) { tok += p; ms += t; }
  }
  return ms > 0 ? (1000 * tok) / ms : null;
}

function acceptancePct(payloads) {
  let dt = 0, da = 0;
  for (const o of payloads) {
    dt += n(o, "draftTokens") ?? 0;
    da += n(o, "draftAccepted") ?? 0;
  }
  if (dt <= 0) return 0;
  return (100 * da) / dt;
}

function pps(o) {
  const v = n(o, "predictedPerSecond");
  return v != null && v > 0 ? v : null;
}

const baseline = load("none");
const mtp = load("mtp");
const dflash = load("dflash");

const lines = [];
lines.push("model=qwen3.5-4b thinking=off");
lines.push("draftPath=" + (process.env.DRAFT_DEV_PATH || ""));
lines.push("");
lines.push("=== CONFIG BASELINE (no speculation) ===");
baseline.forEach((o, i) => lines.push(turnMetrics("turn" + (i + 1), o)));
lines.push("");
lines.push("=== CONFIG MTP ===");
mtp.forEach((o, i) => lines.push(turnMetrics("turn" + (i + 1), o)));
lines.push("");
lines.push("=== CONFIG DFLASH ===");
dflash.forEach((o, i) => lines.push(turnMetrics("turn" + (i + 1), o)));
lines.push("");

const fmt = (v) => (v != null ? v.toFixed(2) : "?");
const bWarm = warmAggregate(baseline);
const mWarm = warmAggregate(mtp);
const dWarm = warmAggregate(dflash);
lines.push("BASELINE: warm-aggregate tok/s=" + fmt(bWarm) + " (no drafts by construction)");
lines.push("MTP     : warm-aggregate tok/s=" + fmt(mWarm) + " acceptance=" + acceptancePct(mtp).toFixed(1) + "%");
lines.push("DFLASH  : warm-aggregate tok/s=" + fmt(dWarm) + " acceptance=" + acceptancePct(dflash).toFixed(1) + "%");

// VERDICTS vs the plain-decode baseline (warm turns pooled). Measurement only.
function verdictVs(name, w) {
  if (bWarm != null && w != null && bWarm > 0) {
    const delta = ((w / bWarm) * 100) - 100;
    const dir = delta >= 0 ? "faster" : "slower";
    lines.push("VERDICT: " + name + " is " + Math.abs(delta).toFixed(1) + "% " + dir + " than BASELINE (warm-aggregate)");
  } else {
    lines.push("VERDICT: " + name + " vs BASELINE UNKNOWN (missing warm-aggregate)");
  }
}
verdictVs("MTP", mWarm);
verdictVs("DFLASH", dWarm);

fs.writeFileSync(path.join(outDir, "RESULT.txt"), lines.join("\n") + "\n");
process.stdout.write(lines.join("\n") + "\n");
' "$OUT"

cat "$OUT/RESULT.txt"
log "PASS: DFlash vs MTP A/B completed (measurement only — verdict never fails the job)"
