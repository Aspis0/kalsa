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

wait_ready() {
  # Engine load of 4B (2.8GB) + mmproj (0.67GB) on the CI AVD is SLOW: run
  # 31230993302 proved 10 min is not enough (bundle accepted, engine still
  # loading or dying). 25 min ceiling; on failure dump native logcat so the
  # next diagnosis has llama.cpp's own words (load progress vs lmkd death).
  local label="$1" i
  log "waiting for Ready ($label)"
  for i in $(seq 1 100); do
    sleep 15
    if dump_ui | grep -qE 'text="Ready|content-desc="Ready|text="Pronto'; then
      log "Ready after ~$((i * 15))s ($label)"
      shot "ready_${label}"
      ui_texts > "$OUT/ready_${label}.txt"
      return 0
    fi
    log "ready poll $i ($label): not yet"
  done
  ui_texts > "$OUT/ready_fail_${label}.txt"
  shot "ready_fail_${label}"
  adb logcat -d | grep -iE "RNLlama|llama|lmkd|lowmemorykiller|am_kill|FATAL" | tail -120 \
    > "$OUT/ready_fail_${label}_logcat.txt" 2>/dev/null || true
  adb shell dumpsys meminfo "$PKG" 2>/dev/null | head -40 > "$OUT/ready_fail_${label}_meminfo.txt" || true
  die "app did not reach Ready ($label) within ~25 min"
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
  local sent i hist n reply poll_prefix

  log "[$tag] type message: $msg"
  tap_node "Ask a question…" || die "composer not found ($tag)"
  sleep 4
  adb shell input text "$msg"
  sleep 3
  if ! dump_ui | grep -qF "$msg"; then
    log "[$tag] text not visible yet — retrying once"
    tap_node "Ask a question…" || true
    sleep 3
    adb shell input text "$msg"
    sleep 3
  fi
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
  for i in $(seq 1 60); do
    sleep 15
    ui_texts > "$OUT/${poll_prefix}_$i.txt"
    shot "${poll_prefix}_$i" 2>/dev/null
    # History can grow; pull enough for multi-turn assistant count.
    hist=$(sql "SELECT substr(value,1,12000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
    echo "$hist" > "$OUT/${tag}_history_$i.json"
    n=$(printf '%s' "$hist" | grep -o '"role":"assistant"' | wc -l | tr -d ' \r')
    if [ "${n:-0}" -ge "$min_assistants" ]; then
      reply=$(echo "$hist" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
      log "[$tag] REPLY AFTER $(( $(date +%s) - sent ))s (assistants=$n): $reply"
      break
    fi
    log "[$tag] poll $i: still generating ($(( $(date +%s) - sent ))s) assistants=${n:-0}"
  done

  LAST_REPLY="$reply"
  LAST_ELAPSED=$(( $(date +%s) - sent ))
  [ -n "$LAST_REPLY" ] || die "no assistant reply captured ($tag)"
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
}

capture_telemetry() {
  local config="$1" dest="$OUT/telemetry_${config}.txt"
  log "capturing KALSA_TELEMETRY → telemetry_${config}.txt"
  adb logcat -d | grep -F "KALSA_TELEMETRY" | sed 's/.*KALSA_TELEMETRY /KALSA_TELEMETRY /' > "$dest" || true
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
# CONFIG A — MTP (control): production path, no speculative seed.
# ---------------------------------------------------------------------------
log "=== CONFIG A: MTP (control) ==="
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
seed_kv "kalsa.bench.speculative" "$SPEC_JSON"
sql "SELECT key,substr(value,1,120) FROM catalystLocalStorage WHERE key='kalsa.bench.speculative';" \
  | tee "$OUT/prefs_dflash.txt"
# Relaunch so LlamaService re-reads the override at init (idempotence fingerprint).
force_stop_relaunch
wait_ready "dflash"
run_two_turns "dflash"
capture_telemetry "dflash"

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

const mtp = load("mtp");
const dflash = load("dflash");
const m = pickTurns(mtp);
const d = pickTurns(dflash);

const lines = [];
lines.push("model=qwen3.5-4b thinking=off");
lines.push("draftPath=" + (process.env.DRAFT_DEV_PATH || ""));
lines.push("");
lines.push("=== CONFIG MTP (control) ===");
lines.push(turnMetrics("turn1", m.t1));
lines.push(turnMetrics("turn2", m.t2));
lines.push("");
lines.push("=== CONFIG DFLASH ===");
lines.push(turnMetrics("turn1", d.t1));
lines.push(turnMetrics("turn2", d.t2));
lines.push("");

const m1 = pps(m.t1); const m2 = pps(m.t2);
const d1 = pps(d.t1); const d2 = pps(d.t2);
const mAcc = acceptancePct(mtp).toFixed(1);
const dAcc = acceptancePct(dflash).toFixed(1);
const fmt = (v) => (v != null ? v.toFixed(2) : "?");

lines.push("MTP    : tg tok/s turn1=" + fmt(m1) + " turn2=" + fmt(m2) + " acceptance=" + mAcc + "%");
lines.push("DFLASH : tg tok/s turn1=" + fmt(d1) + " turn2=" + fmt(d2) + " acceptance=" + dAcc + "%");

// VERDICT on turn2 decode (predictedPerSecond). Measurement only — no exit 1.
if (m2 != null && d2 != null && m2 > 0) {
  const delta = ((d2 / m2) * 100) - 100;
  if (delta >= 0) {
    lines.push("VERDICT: DFLASH is " + delta.toFixed(1) + "% faster on decode (turn2 predictedPerSecond)");
  } else {
    lines.push("VERDICT: DFLASH is " + Math.abs(delta).toFixed(1) + "% slower on decode (turn2 predictedPerSecond)");
  }
} else {
  lines.push("VERDICT: UNKNOWN (missing turn2 predictedPerSecond for comparison)");
}

fs.writeFileSync(path.join(outDir, "RESULT.txt"), lines.join("\n") + "\n");
process.stdout.write(lines.join("\n") + "\n");
' "$OUT"

cat "$OUT/RESULT.txt"
log "PASS: DFlash vs MTP A/B completed (measurement only — verdict never fails the job)"
