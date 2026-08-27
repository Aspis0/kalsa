#!/usr/bin/env bash
# Drives Kalsa on a KVM-accelerated emulator and proves real on-device inference
# (two turns in one conversation so KV-cache prefix-reuse can be measured, then
# a third turn after force-stop/restart to prove KV session restore).
# Evidence (screenshots, UI dumps, logcat, chat DB, telemetry) lands in ./e2e-out.
set -uo pipefail
OUT="e2e-out"; mkdir -p "$OUT"
MODEL_FILE="${MODEL_FILE:-Qwen3.5-2B-Q4_K_M.gguf}"
MODEL_DIR="${MODEL_DIR:-qwen3.5-2b}"
COMPACTION_IN="${COMPACTION:-on}"
THINKING="${THINKING:-off}"
PKG=com.kalsa.app

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

# Robust typing: the AVD IME swallows keystrokes right after focus, and a
# single retry proved insufficient under load (runs 31236583365/31272714706).
# 4 attempts, re-tapping the composer between tries — the shape proven in
# ci-dflash-ab. Returns 0 when the text is visible in the UI dump.
type_into_composer() {
  local msg="$1" attempt
  dismiss_anr
  tap_node "Ask a question…" || { dismiss_anr; tap_node "Ask a question…" || return 1; }
  sleep 4
  for attempt in 1 2 3 4; do
    adb shell input text "$msg"
    sleep 3
    if dump_ui | grep -qF "$msg"; then
      return 0
    fi
    log "text not visible (attempt $attempt) — re-tapping composer"
    dismiss_anr
    tap_node "Ask a question…" || true
    sleep 3
  done
  ui_texts > "$OUT/typing_failed_ui.txt" 2>/dev/null || true
  shot typing_failed 2>/dev/null || true
  return 1
}

install_and_sideload \
  "android/app/build/outputs/apk/release/app-release.apk" \
  "model.gguf" \
  "$MODEL_DIR" \
  "$MODEL_FILE"

log "set prefs: model=$MODEL_DIR compaction=$COMPACTION_IN thinking=$THINKING"
sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
[ "$COMPACTION_IN" = "on" ] && sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','1');"
[ "$COMPACTION_IN" = "off" ] && sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','0');"
# Explicit-choice marker so leftover "0" is not upgraded to ON (V2-3).
[ "$COMPACTION_IN" = "on" ] || [ "$COMPACTION_IN" = "off" ] && sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction.choice','1');"
sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.thinking','$THINKING');"
sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"

log "launch app"
adb logcat -c
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 30
shot 01_home
ui_texts > "$OUT/01_home.txt"


log "screen size: $(adb shell wm size | tr -d '\r')"


log "type message"
# Keep the prompt alphanumeric: `adb shell input text` mangles punctuation and
# does not reliably turn '+' into spaces, which made the assertion below fail
# even though the tap was correct.
MSG="CiaoChiSei"
type_into_composer "$MSG" || die "composer typing failed (turn 1)"
adb shell input keyevent 111   # ESC: hide IME so bounds are stable
sleep 3
shot 02_typed
ui_texts > "$OUT/02_typed.txt"
# Hard gate: if the text is not in the composer there is nothing to send, and
# waiting for a reply would burn 15 minutes for nothing (it did, once).
grep -qF "$MSG" "$OUT/02_typed.txt" || die "typing did not land in the composer"
log "text confirmed in composer"

log "send"
tap_node "Send" || die "Send button not found"
SENT=$(date +%s)
sleep 20
ui_texts > "$OUT/03_sent.txt"
shot 03_sent
grep -qF "$MSG" "$OUT/03_sent.txt" || die "message did not appear in the conversation after send"
log "message is in the conversation — engine should be running"
log "sent at $SENT — polling for the reply"

REPLY=""
for i in $(seq 1 60); do
  sleep 15
  ui_texts > "$OUT/poll_$i.txt"
  shot "poll_$i" 2>/dev/null
  # The assistant bubble is persisted only when the turn completes.
  HIST=$(sql "SELECT substr(value,1,4000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
  echo "$HIST" > "$OUT/history_$i.json"
  if echo "$HIST" | grep -q '"role":"assistant"'; then
    REPLY=$(echo "$HIST" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
    log "REPLY AFTER $(( $(date +%s) - SENT ))s: $REPLY"
    break
  fi
  log "poll $i: still generating ($(( $(date +%s) - SENT ))s)"
done

wait_ui_idle
capture_kv_reuse 1

adb logcat -d | grep -iE "RNLlama|llama|ReactNativeJS" | tail -80 > "$OUT/logcat.txt" 2>/dev/null
shot 99_final
ui_texts > "$OUT/99_final.txt"
sql "SELECT substr(value,1,4000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" > "$OUT/history_final.json"

{
  echo "model=$MODEL_DIR compaction=$COMPACTION_IN thinking=$THINKING"
  echo "elapsed_to_reply_s=$(( $(date +%s) - SENT ))"
  echo "reply<<<"
  echo "$REPLY"
  echo ">>>"
} > "$OUT/RESULT.txt"
cat "$OUT/RESULT.txt"

[ -n "$REPLY" ] || { log "FAIL: no assistant reply captured"; exit 1; }

# Regression: Thinking=Off must not persist raw think tags in THIS turn's reply
# (Qwen3.5 force-closed template + stream stripper). Scope to $REPLY (current
# turn) — whole-history grep false-positives under adb install -r keep-data.
# Skip when THINKING != off.
if [ "$THINKING" = "off" ]; then
  if printf '%s' "$REPLY" | grep -qE '<[/]?think>|<thi'; then
    log "FAIL: THINKING=off but current-turn REPLY still contains think markup (<think>/</think>/<thi) — template override / stripper regression"
    exit 1
  fi
  log "OK: no think markup in current-turn REPLY under THINKING=off"
fi

# ---------------------------------------------------------------------------
# TURN 2 — same conversation; measures KV prefix-reuse via native n_past.
# ---------------------------------------------------------------------------
log "type message (turn 2)"
# Alphanumeric for adb `input text` (same constraint as MSG / turn 1).
# Intent: short follow-up distinct from turn 1 ("E dimmi un altro fatto breve.").
MSG2="EDimmiUnAltroFattoBreve"
type_into_composer "$MSG2" || die "composer typing failed (turn 2)"
adb shell input keyevent 111
sleep 3
shot 04_typed2
ui_texts > "$OUT/04_typed2.txt"
grep -qF "$MSG2" "$OUT/04_typed2.txt" || die "typing did not land in the composer (turn 2)"
log "text confirmed in composer (turn 2)"

log "send (turn 2)"
tap_node "Send" || die "Send button not found (turn 2)"
SENT2=$(date +%s)
sleep 20
ui_texts > "$OUT/05_sent2.txt"
shot 05_sent2
grep -qF "$MSG2" "$OUT/05_sent2.txt" || die "message did not appear in the conversation after send (turn 2)"
log "message is in the conversation (turn 2) — engine should be running"
log "sent at $SENT2 — polling for the reply (turn 2)"

REPLY2=""
for i in $(seq 1 60); do
  sleep 15
  ui_texts > "$OUT/poll2_$i.txt"
  shot "poll2_$i" 2>/dev/null
  # Need a *second* assistant bubble; turn-1 alone must not satisfy this poll.
  HIST2=$(sql "SELECT substr(value,1,8000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
  echo "$HIST2" > "$OUT/history2_$i.json"
  ASSISTANT_N=$(printf '%s' "$HIST2" | grep -o '"role":"assistant"' | wc -l | tr -d ' \r')
  if [ "${ASSISTANT_N:-0}" -ge 2 ]; then
    REPLY2=$(echo "$HIST2" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
    log "REPLY2 AFTER $(( $(date +%s) - SENT2 ))s: $REPLY2"
    break
  fi
  log "poll2 $i: still generating ($(( $(date +%s) - SENT2 ))s) assistants=${ASSISTANT_N:-0}"
done

wait_ui_idle
capture_kv_reuse 2

shot 06_reply2
ui_texts > "$OUT/06_reply2.txt"
sql "SELECT substr(value,1,8000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" > "$OUT/history2_final.json"

{
  echo "elapsed_to_reply2_s=$(( $(date +%s) - SENT2 ))"
  echo "reply2<<<"
  echo "$REPLY2"
  echo ">>>"
} >> "$OUT/RESULT.txt"

[ -n "$REPLY2" ] || die "FAIL: no assistant reply captured on turn 2"

# Telemetry capture — KV-cache health probe (data first; COLD does not fail the job).
# tokensCached in KALSA_TELEMETRY is n_past at END of completion (total context),
# NOT tokens reused — warm/cold uses native loadPrompt n_past from reuse_t2.txt.
log "capturing KALSA_TELEMETRY from logcat"
adb logcat -d | grep -F "KALSA_TELEMETRY" | sed 's/.*KALSA_TELEMETRY /KALSA_TELEMETRY /' > "$OUT/telemetry.txt" || true

node -e '
const fs = require("fs");
const path = process.argv[1];
const reusePath = process.argv[2];
let raw = "";
try { raw = fs.readFileSync(path, "utf8"); } catch (_) {}
const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const payloads = [];
for (const line of lines) {
  const idx = line.indexOf("{");
  if (idx < 0) continue;
  try { payloads.push(JSON.parse(line.slice(idx))); } catch (_) {}
}
const n = (o, k) => (o && typeof o[k] === "number" ? o[k] : (o && o[k] != null ? Number(o[k]) : 0));
const fmt = (label, o) => {
  if (!o) return label + ": cached=? evaluated=? predicted=? promptMs=? (missing)";
  return label + ": cached=" + n(o, "tokensCached")
    + " evaluated=" + n(o, "tokensEvaluated")
    + " predicted=" + n(o, "tokensPredicted")
    + " promptMs=" + n(o, "promptMs");
};
const t1 = payloads.length ? payloads[0] : null;
const t2 = payloads.length ? payloads[payloads.length - 1] : null;
const linesOut = [fmt("turn1", t1), fmt("turn2", t2)];
// tokensCached is n_past at end of turn (not reuse). Use native Input processed line.
let reuseRaw = "";
try { reuseRaw = fs.readFileSync(reusePath, "utf8").trim(); } catch (_) {}
// reuse_tN.txt holds EVERY prompt load of the turn (newest last): pick the
// one whose embd.size equals the tokensEvaluated of this turn, so a
// background summarize load cannot be mistaken for the chat turn.
const pickReuse = (raw, evaluated) => {
  const all = [...raw.matchAll(/n_past=(\d+),\s*embd\.size=(\d+)/g)];
  if (!all.length) return null;
  const exact = all.filter((m) => Number(m[2]) === evaluated);
  return exact.length ? exact[exact.length - 1] : all[all.length - 1];
};
const rm = pickReuse(reuseRaw, t2 ? n(t2, "tokensEvaluated") : -1);
let kv;
if (!rm) {
  kv = "KV_CACHE: UNKNOWN (no native Input processed line)";
} else {
  const nPast = Number(rm[1]);
  const embd = Number(rm[2]);
  if (nPast > 0) {
    kv = "KV_CACHE: WARM (turn2 reused " + nPast + "/" + embd + " prompt tokens)";
  } else {
    kv = "KV_CACHE: COLD (turn2 reused 0/" + embd + " — full re-prefill)";
  }
}
linesOut.push(kv);
process.stdout.write(linesOut.join("\n") + "\n");
' "$OUT/telemetry.txt" "$OUT/reuse_t2.txt" | tee -a "$OUT/RESULT.txt"

if grep -qF "KV_CACHE: COLD" "$OUT/RESULT.txt"; then
  log "KV_CACHE: COLD (turn2 full re-prefill) — logged, not failing job"
elif grep -qF "KV_CACHE: WARM" "$OUT/RESULT.txt"; then
  log "KV_CACHE: WARM — native n_past > 0 (prefix reuse observed)"
else
  log "KV_CACHE: UNKNOWN — no native Input processed line"
fi

# ---------------------------------------------------------------------------
# RESTART LEG — force-stop + relaunch; TURN 3 proves KV session restore.
# ---------------------------------------------------------------------------
log "=== RESTART LEG (session restore) ==="
# Wait for the turn-end session SAVE to finish before killing the app: the
# .kvs write is a multi-hundred-MB file and runs seconds after the reply is
# detected (run 31274549471: force-stop ~3s after turn 2 left turn-1-era meta
# on disk → meta_mismatch → cold). Up to 90s for a save line ok:true.
# Require BOTH turns' saves (>=2 ok:true): run 31275960345 rerun still hit
# meta_mismatch:historyHash and 'any ok:true' cannot tell a turn-1-only save
# (stale hash) from a complete turn-2 save. Pre-restart lines are preserved to
# a file since the restart clears logcat.
save_ok_n=0
for i in $(seq 1 24); do
  save_ok_n=$(adb logcat -d 2>/dev/null | grep -F 'KALSA_SESSION' | grep -F '"op":"save"' | grep -cF '"ok":true' | tr -d ' \r')
  if [ "${save_ok_n:-0}" -ge 2 ]; then
    log "both turn saves confirmed after ~$((i * 5))s (ok saves: $save_ok_n)"
    break
  fi
  sleep 5
done
adb logcat -d 2>/dev/null | grep -F 'KALSA_SESSION' > "$OUT/session_prerestart.txt" || true
if [ "${save_ok_n:-0}" -lt 2 ]; then
  log "WARN: only ${save_ok_n:-0} ok:true saves within 120s — restore will use a stale hash (see session_prerestart.txt)"
  tail -6 "$OUT/session_prerestart.txt" | sed 's/^/[ci]   save-tail: /' || true
fi
adb shell am force-stop $PKG
sleep 3
# Simpler-to-assert: clear logcat so post-restart turn ids restart from 1 in the
# new process (KALSA_TELEMETRY / KALSA_SESSION lines below are only from this leg).
# Do NOT keep pre-restart logcat — turn numbering continuity is not required here.
adb logcat -c
adb shell am start -n $PKG/.MainActivity >/dev/null
# Engine is lazy; session LOAD happens at first engine init on send, not at launch.
sleep 25
shot 07_restarted
ui_texts > "$OUT/07_restarted.txt"

log "type message (turn 3 / post-restart)"
# Alphanumeric for adb `input text` (same constraint as MSG / MSG2).
# Intent: short final follow-up ("Un ultimo fatto breve, grazie").
MSG3="UnUltimoFattoBreveGrazie"
type_into_composer "$MSG3" || die "composer typing failed (turn 3)"
adb shell input keyevent 111
sleep 3
shot 08_typed3
ui_texts > "$OUT/08_typed3.txt"
grep -qF "$MSG3" "$OUT/08_typed3.txt" || die "typing did not land in the composer (turn 3)"
log "text confirmed in composer (turn 3)"

log "send (turn 3)"
tap_node "Send" || die "Send button not found (turn 3)"
SENT3=$(date +%s)
sleep 20
ui_texts > "$OUT/09_sent3.txt"
shot 09_sent3
grep -qF "$MSG3" "$OUT/09_sent3.txt" || die "message did not appear in the conversation after send (turn 3)"
log "message is in the conversation (turn 3) — engine should be running (session load on init)"
log "sent at $SENT3 — polling for the reply (turn 3)"

# History persists across restart (catalystLocalStorage keep-data); need a *third*
# assistant bubble. Same assistant-count style as turn 2 (not dflash telemetry poll).
REPLY3=""
for i in $(seq 1 60); do
  sleep 15
  ui_texts > "$OUT/poll3_$i.txt"
  shot "poll3_$i" 2>/dev/null
  HIST3=$(sql "SELECT substr(value,1,12000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
  echo "$HIST3" > "$OUT/history3_$i.json"
  ASSISTANT_N3=$(printf '%s' "$HIST3" | grep -o '"role":"assistant"' | wc -l | tr -d ' \r')
  if [ "${ASSISTANT_N3:-0}" -ge 3 ]; then
    REPLY3=$(echo "$HIST3" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
    log "REPLY3 AFTER $(( $(date +%s) - SENT3 ))s: $REPLY3"
    break
  fi
  log "poll3 $i: still generating ($(( $(date +%s) - SENT3 ))s) assistants=${ASSISTANT_N3:-0}"
done

wait_ui_idle
capture_kv_reuse 3

shot 10_reply3
ui_texts > "$OUT/10_reply3.txt"
sql "SELECT substr(value,1,12000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" > "$OUT/history3_final.json"

{
  echo "elapsed_to_reply3_s=$(( $(date +%s) - SENT3 ))"
  echo "reply3<<<"
  echo "$REPLY3"
  echo ">>>"
} >> "$OUT/RESULT.txt"

[ -n "$REPLY3" ] || die "FAIL: no assistant reply captured on turn 3 (post-restart)"

# Session + turn-3 telemetry (logcat was cleared at restart; only this process).
# tokensCached is n_past at END of completion — not reuse. Warm/cold uses
# native loadPrompt n_past from reuse_t3.txt (HIT/MISS still from KALSA_SESSION).
log "capturing KALSA_SESSION + post-restart KALSA_TELEMETRY from logcat"
adb logcat -d | grep -F "KALSA_SESSION" | sed 's/.*KALSA_SESSION /KALSA_SESSION /' > "$OUT/session_telemetry.txt" || true
adb logcat -d | grep -F "KALSA_TELEMETRY" | sed 's/.*KALSA_TELEMETRY /KALSA_TELEMETRY /' > "$OUT/telemetry_restart.txt" || true

node -e '
const fs = require("fs");
const sessionPath = process.argv[1];
const telemPath = process.argv[2];
const reusePath = process.argv[3];

function readLines(p) {
  let raw = "";
  try { raw = fs.readFileSync(p, "utf8"); } catch (_) {}
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}
function payloads(lines) {
  const out = [];
  for (const line of lines) {
    const idx = line.indexOf("{");
    if (idx < 0) continue;
    try { out.push(JSON.parse(line.slice(idx))); } catch (_) {}
  }
  return out;
}
const n = (o, k) => (o && typeof o[k] === "number" ? o[k] : (o && o[k] != null ? Number(o[k]) : 0));

const sess = payloads(readLines(sessionPath));
const loads = sess.filter(o => o && o.op === "load");
let sessionLine;
if (!loads.length) {
  sessionLine = "SESSION_RESTORE: MISS (reason=no_load_line)";
} else {
  const last = loads[loads.length - 1];
  if (last.ok === true) {
    sessionLine = "SESSION_RESTORE: HIT";
  } else {
    const reason = last.reason != null ? String(last.reason) : "unknown";
    sessionLine = "SESSION_RESTORE: MISS (reason=" + reason + ")";
  }
}

const telem = payloads(readLines(telemPath));
// logcat -c at restart: first (and typically only) telemetry line is turn 3.
// Format of turn3Line is kept byte-stable for greps; do not use tokensCached for warm.
const t3 = telem.length ? telem[telem.length - 1] : null;
const cached = t3 ? n(t3, "tokensCached") : 0;
const evaluated = t3 ? n(t3, "tokensEvaluated") : 0;
const promptMs = t3 ? n(t3, "promptMs") : 0;
const turn3Line = t3
  ? ("turn3(restart): cached=" + cached + " evaluated=" + evaluated + " promptMs=" + promptMs)
  : "turn3(restart): cached=? evaluated=? promptMs=? (missing)";

// tokensCached is n_past at end of turn (not reuse). Warm requires native n_past > 0.
let reuseRaw = "";
try { reuseRaw = fs.readFileSync(reusePath, "utf8").trim(); } catch (_) {}
// Same attribution rule as the turn-2 verdict: among every prompt load
// captured for this turn, take the one whose embd.size matches what the chat
// turn evaluated. ALSO report how many loads ran — more than one after a
// restore means a utility completion replaced embd before the chat turn,
// which is itself the explanation for a zero-reuse restart.
const allLoads = [...reuseRaw.matchAll(/n_past=(\d+),\s*embd\.size=(\d+)/g)];
const exact = allLoads.filter((m) => Number(m[2]) === evaluated);
const rm = exact.length ? exact[exact.length - 1] : (allLoads.length ? allLoads[allLoads.length - 1] : null);
const nPast = rm ? Number(rm[1]) : null;
const embd = rm ? Number(rm[2]) : null;
const loadsBefore = rm ? allLoads.indexOf(rm) : -1;
const loadOk = loads.some(o => o && o.ok === true);
let verdict;
if (loadOk && nPast != null && nPast > 0) {
  verdict = "SESSION_RESTORE: WARM RESTART CONFIRMED (reused " + nPast + "/" + embd + ")";
} else if (loadOk && nPast != null && nPast === 0) {
  // Load gate ok but binding discarded restored KV (full re-prefill).
  verdict = "SESSION_RESTORE: LOADED BUT COLD (reused 0/" + embd
    + "; prompt loads before the chat turn: " + loadsBefore + ")";
} else {
  // Load itself failed / missing, or no native line when load claimed ok.
  verdict = "SESSION_RESTORE: COLD (see reasons)";
}

process.stdout.write([sessionLine, turn3Line, verdict].join("\n") + "\n");
' "$OUT/session_telemetry.txt" "$OUT/telemetry_restart.txt" "$OUT/reuse_t3.txt" | tee -a "$OUT/RESULT.txt"

if grep -qF "SESSION_RESTORE: WARM RESTART CONFIRMED" "$OUT/RESULT.txt"; then
  log "SESSION_RESTORE: WARM RESTART CONFIRMED (native n_past > 0)"
elif grep -qF "SESSION_RESTORE: LOADED BUT COLD" "$OUT/RESULT.txt"; then
  log "SESSION_RESTORE: LOADED BUT COLD (gate ok, native discarded KV — logged, not failing job)"
elif grep -qF "SESSION_RESTORE: HIT" "$OUT/RESULT.txt"; then
  log "SESSION_RESTORE: HIT but COLD/UNKNOWN native reuse (logged, not failing job)"
else
  log "SESSION_RESTORE: COLD/MISS (logged, not failing job — data first)"
fi

cat "$OUT/RESULT.txt"

log "PASS: real on-device inference completed (3 turns + telemetry + session restore leg)"
