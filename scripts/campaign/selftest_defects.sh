#!/usr/bin/env bash
# Host-only proofs for the three 2026-09-16 campaign-harness defects. A fake
# `adb` (selftest_fakedevice.sh) on PATH replays fixtures; no device is touched
# and no real logcat/turn timing is waited for.
#
#   bash scripts/campaign/selftest_defects.sh
#
# (a) a turn that keeps producing text but never emits KALSA_TELEMETRY is NOT
#     declared hang — one case per liveness signal (native lines, growing
#     reply, new assistant bubble) plus a frozen negative control that must
#     still be a hang;
# (b) a run whose completion signal never appears stops after turn 2, rc=4,
#     naming 'KALSA_TELEMETRY ';
# (c) every skip path in oneTurn.sh appends a RECOVERY-shaped record,
#     verified by reading the jsonl back.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# Reuse logcat's derived marker so fake-device fixtures cannot drift.
source "$HERE/logcat.sh"
export CAMPAIGN_STARTUP_MARKER
CAMPAIGN_METRO_IN_FLIGHT_NEEDLE="$(sed -n '/POST_FIX_IN_FLIGHT_NEEDLE/{n;s/^[[:space:]]*"\([^"\\]*\)";[[:space:]]*$/\1/p;}' "$REPO/scripts/campaign/metroGate.mjs")"
if [ -z "$CAMPAIGN_METRO_IN_FLIGHT_NEEDLE" ]; then
  printf 'selftest_defects: gate in-flight needle is missing\n' >&2
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kalsa-defects.XXXXXX")"

# The one KALSA_TELEMETRY line the app emitted in 32,683 logcat lines on
# 2026-09-16 (out/t20c-gate-20260916/logcat.txt, 11:50:53.532).
TELEMETRY_LINE='-16 11:50:53.532 19312 19372 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":2865,"tokensEvaluated":2662,"tokensPredicted":202,"draftTokens":0,"draftAccepted":0,"promptMs":8659.059,"predictedMs":21862.297,"predictedPerSecond":9.23965125896881,"contextFull":false,"interrupted":false,"prompt_n":282,"ciswireFlags":1}'

export FAKE_DEV="$WORK/device"
mkdir -p "$FAKE_DEV/fake" "$FAKE_DEV/databases" "$FAKE_DEV/data/local/tmp"
mkdir -p "$WORK/bin"
cp "$HERE/selftest_fakedevice.sh" "$WORK/bin/adb"
chmod +x "$WORK/bin/adb"
PATH="$WORK/bin:$PATH"
export PATH

pass=0
fail=0
ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }

cleanup() {
  pkill -f "$WORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── fake device fixtures ────────────────────────────────────────────────────
fake_reset() {
  local mode="$1" temp=350
  [ "$mode" = "hot" ] && temp=500
  rm -rf "$FAKE_DEV/fake" "$FAKE_DEV/databases"
  mkdir -p "$FAKE_DEV/fake" "$FAKE_DEV/databases" "$FAKE_DEV/data/local/tmp"
  sqlite3 "$FAKE_DEV/databases/RKStorage" \
    'CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT);'
  printf '%s\n' "$mode" > "$FAKE_DEV/fake/mode"
  printf '%s' 4242 > "$FAKE_DEV/fake/pid"
  printf '%s' 4242 > "$FAKE_DEV/fake/pid_base"
  printf '%s\n' device > "$FAKE_DEV/fake/adb_state"
  printf '%s' 0 > "$FAKE_DEV/fake/turn"
  printf '%s\n' "$TELEMETRY_LINE" > "$FAKE_DEV/fake/telemetry.line"
  cat > "$FAKE_DEV/fake/battery.txt" <<EOF
  AC powered: false
  USB powered: false
  Wireless powered: false
  Dock powered: false
  status: 3
  level: 90
  temperature: $temp
EOF
  printf '%s\n' 'Thermal Status: 0' > "$FAKE_DEV/fake/thermalservice.txt"
  cat > "$FAKE_DEV/fake/stream.txt" <<'EOF'
09-16 12:00:00.000 4242 4243 I ReactNativeJS: KALSA_CTX_FLOOR n_ctx=8192
09-16 12:00:00.010 4242 4243 I ReactNativeJS: KALSA_NATIVE_VARIANT {"androidLib":"fake","nGpuLayers":0}
09-16 12:00:00.020 4242 4243 I llama_context: n_ctx = 8192
EOF
  cat > "$FAKE_DEV/fake/ui.xml" <<'EOF'
<hierarchy>
<node class="android.widget.TextView" text="Pronto" bounds="[0,0][10,10]"/>
<node class="android.widget.Button" text="Send" bounds="[900,2000][1000,2100]"/>
</hierarchy>
EOF
}

db_put_messages() {
  python3 - "$FAKE_DEV/databases/RKStorage" "$1" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute(
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (?,?)",
    ("kalsa.messages.v1", open(sys.argv[2], encoding="utf-8").read()),
)
conn.commit()
PY
}

# make_messages <path> <n_assistant> <assistant_len>
make_messages() {
  python3 -c '
import json, sys
path, n_asst, asst_len = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
msgs = [{"role": "user", "text": "domanda"}]
for k in range(n_asst):
    msgs.append({"role": "assistant", "text": ("r%d " % k) + "x" * asst_len})
json.dump(msgs, open(path, "w", encoding="utf-8"))
' "$1" "$2" "$3"
}

# jsonl_reason <jsonl> <i> <reason> — exit 0 only when a RECOVERY-shaped record
# for turn <i> with <reason> is on disk.
jsonl_reason() {
  python3 -c '
import json, sys
path, want_i, want_reason = sys.argv[1], int(sys.argv[2]), sys.argv[3]
rows = []
try:
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
except OSError:
    pass
hit = [
    r for r in rows
    if r.get("event") == "RECOVERY"
    and r.get("reason") == want_reason
    and r.get("i") == want_i
    and r.get("scores") is None
    and r.get("arm") == "T20C"
    and r.get("variant") == "V1"
    and r.get("conv") == "c1-V1"
]
print("records=%d summary=%s" % (len(rows), " ".join(
    "%s/%s%s" % (r.get("i"), r.get("event", "TURN"), "/" + str(r.get("reason")) if r.get("reason") else "")
    for r in rows)))
sys.exit(0 if len(hit) == 1 else 1)
' "$1" "$2" "$3"
}

# ── (a) liveness is not the completion marker ───────────────────────────────
# driver = background mutation; expect = CAMPAIGN_TURN_STATUS the wait must end
# with. hang is the failure mode being fixed; timeout means liveness kept the
# turn alive for the whole budget.
liveness_case() {
  local label="$1" expect="$2" driver="$3" out="$WORK/live"
  fake_reset marker-turn1
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    # shellcheck source=../../scripts/ci-lib.sh
    source "$REPO/scripts/ci-lib.sh"
    # shellcheck source=../../scripts/device-share-send.sh
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=6000
    CAMPAIGN_TELEMETRY_GAP_MS=2000
    CAMPAIGN_POLL_MS=1000
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    case "$driver" in
      native)
        (
          for i in $(seq 1 30); do
            printf '09-16 12:00:30.%03d 4242 4243 I ReactNativeJS: KALSA_NATIVE info Grammar still awaiting trigger after token %d\n' "$i" "$i" \
              >> "$FAKE_DEV/fake/stream.txt"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      reply)
        (
          for i in $(seq 1 30); do
            make_messages "$FAKE_DEV/fake/live.json" 1 "$((10 + i))"
            db_put_messages "$FAKE_DEV/fake/live.json"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      bubble)
        (
          for i in $(seq 1 30); do
            make_messages "$FAKE_DEV/fake/live.json" "$i" 20
            db_put_messages "$FAKE_DEV/fake/live.json"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      complete)
        make_messages "$FAKE_DEV/fake/live.json" 1 20
        db_put_messages "$FAKE_DEV/fake/live.json"
        printf '%s\n' "$TELEMETRY_LINE" >> "$FAKE_DEV/fake/stream.txt"
        ;;
      frozen) : ;;
    esac
    campaign_wait_turn 0 "$out/.slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  )
  local status
  status=$(cat "$out/status.txt" 2>/dev/null || printf 'missing')
  if [ "$status" = "$expect" ]; then
    ok "$label (status=$status)"
  else
    bad "$label (status=$status, want $expect)"
  fi
}

printf '== (a) liveness vs completion marker ==\n'
liveness_case "frozen turn is still a hang" hang frozen
liveness_case "native engine lines keep it alive" timeout native
liveness_case "growing reply keeps it alive" timeout reply
liveness_case "new assistant bubbles keep it alive" timeout bubble
liveness_case "telemetry + new bubble still completes ok" ok complete

# ── (b) the run stops after turn 2 without the completion signal ────────────
# marker-turn1 = today's replay: turn 1 emits KALSA_TELEMETRY, turn 2 does not.
# never        = the signal never appears at all.
run_campaign_case() {
  local mode="$1" want_rc="$2" out served port url
  out="$WORK/out-b-$mode"
  served="$WORK/bundle"
  fake_reset "$mode"
  rm -rf "$out" "$served"
  mkdir -p "$out" "$served/.expo"
  {
    printf '%s\n' "$CAMPAIGN_STARTUP_MARKER"
    printf '%s\n' 'function shouldRunForegroundIdleDispose(args) {'
    printf '%s\n' "$CAMPAIGN_METRO_IN_FLIGHT_NEEDLE"
    printf '%s\n' '}'
  } > "$served/.expo/.virtual-metro-entry.bundle"
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
  python3 -m http.server "$port" --directory "$served" >/dev/null 2>&1 &
  local http_pid=$!
  disown "$http_pid" 2>/dev/null || true
  url="http://127.0.0.1:$port/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&lazy=true&minify=false&app=com.kalsa.app&modulesOnly=false&runModule=true"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$FAKE_DEV" PKG=com.kalsa.app BENCH_TARGET=device \
    ANDROID_SERIAL=192.168.1.152:43089 OUT="$out" \
    CAMPAIGN_METRO_BUNDLE_URL="$url" \
    CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  local rc=$?
  kill "$http_pid" >/dev/null 2>&1 || true
  printf 'mode=%s rc=%d (want %s)\n' "$mode" "$rc" "$want_rc"
  if [ "$rc" -eq "$want_rc" ]; then
    ok "$mode run exit rc=$want_rc"
  else
    bad "$mode run exit rc=$rc (want $want_rc); tail: $(tail -3 "$out/run.log" | tr '\n' '|')"
  fi
  if grep -q "ABORT after turn 2: completion signal 'KALSA_TELEMETRY '" "$out/run.log"; then
    ok "$mode abort names the missing signal"
  else
    bad "$mode abort message missing in $out/run.log"
  fi
  if grep -q 'UNHANDLED' "$FAKE_DEV/fake/unhandled.log" 2>/dev/null; then
    bad "$mode fake-device gaps: $(sort -u "$FAKE_DEV/fake/unhandled.log" | tr '\n' '|')"
  else
    ok "$mode fake adb handled every call"
  fi
  printf '   jsonl: %s\n' "$(jsonl_reason "$out/T20C/c1-V1.jsonl" 2 already-landed-skip-send >/dev/null 2>&1 && printf ok || printf 'no already-landed row')"
}

printf '\n== (b) early abort after turn 2 ==\n'
run_campaign_case marker-turn1 4
run_campaign_case never 4

# Turn 1 must have produced a TURN record only in marker-turn1; turn 2 must
# never vanish silently in either mode (defect 3 site at oneTurn.sh's
# "user+assistant already landed — skip retry send").
check_jsonl() {
  local mode="$1" want_turns="$2" want_skips="$3" out
  out="$WORK/out-b-$mode"
  local got
  got=$(python3 -c '
import json, sys
rows = []
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line:
        rows.append(json.loads(line))
turns = sorted({r["i"] for r in rows if r.get("event") != "RECOVERY"})
skips = [r for r in rows if r.get("event") == "RECOVERY" and r.get("reason") == "already-landed-skip-send"]
print("%s|%s|%s" % (",".join(map(str, turns)), len(skips), ",".join(sorted({str(r["i"]) for r in skips}))))
' "$out/T20C/c1-V1.jsonl")
  printf '%-12s turns=[%s] already-landed-skips=%s (i=%s)\n' "$mode" "${got%%|*}" \
    "$(printf '%s' "$got" | cut -d'|' -f2)" "$(printf '%s' "$got" | cut -d'|' -f3)"
  if [ "$(printf '%s' "$got" | cut -d'|' -f1)" = "$want_turns" ] \
    && [ "$(printf '%s' "$got" | cut -d'|' -f2)" -eq "$want_skips" ]; then
    ok "$mode: skip rows=$want_skips, no silent disappearance (turns=[$want_turns])"
  else
    bad "$mode: jsonl turns=[$(printf '%s' "$got" | cut -d'|' -f1)] want [$want_turns], skip rows=$(printf '%s' "$got" | cut -d'|' -f2) want $want_skips"
  fi
}

check_jsonl marker-turn1 1 1
check_jsonl never "" 2

# ── (c) every skip path appends a record ────────────────────────────────────
# stub: none | cooldown-fail | recover-2 — only the dependency that would wait
# hours (or that is unreachable) is replaced; the skip path itself is real.
skip_case() {
  local mode="$1" stub="$2" want="$3" out
  out="$WORK/out-c-$mode-$stub"
  fake_reset "$mode"
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export SCRIPT="$REPO/campaigns/t20c/script.json"
    # shellcheck source=../../scripts/ci-lib.sh
    source "$REPO/scripts/ci-lib.sh"
    # shellcheck source=../../scripts/device-share-send.sh
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/conversation.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    CAMPAIGN_LAUNCHED_PID=4242
    CAMPAIGN_TURN_TIMEOUT_MS=6000
    CAMPAIGN_TELEMETRY_GAP_MS=2000
    CAMPAIGN_POLL_MS=1000
    CAMPAIGN_THERMAL_MAX_C=42
    case "$stub" in
      cooldown-fail) campaign_thermal_cooldown() { return 1; } ;;
      recover-2) campaign_recover_status() { return 2; } ;;
    esac
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["turns"][0]["user"])' "$SCRIPT")
    campaign_one_turn 1 "$user"
    printf '%s' "$?" > "$out/rc.txt"
    campaign_logcat_stop
  ) > "$out/turn.log" 2>&1
  local rc
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf 'missing')
  if [ "$rc" = "0" ] && jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" >/dev/null 2>&1; then
    ok "skip path '$want' recorded (oneTurn rc=$rc)"
    printf '   jsonl: %s\n' "$(jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" | sed 's/^records=[0-9]* //')"
  else
    bad "skip path '$want': rc=$rc jsonl=$(jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" 2>&1 | head -1)"
    tail -5 "$out/turn.log" | sed 's/^/   | /' 
  fi
}

printf '\n== (c) skip paths leave a RECOVERY-shaped record ==\n'
skip_case fail-send none send-failed
skip_case vanish none retry-send-failed
skip_case hot cooldown-fail thermal-cooldown-failed
skip_case never recover-2 recovery-refused

printf '\n== (d) the verdict tool reads the markers it claims to read ==\n'
# Synthetic run, because the real 5.4 MB reference logcat lives under the
# gitignored out/. Line shapes copied from
# out/t20c-fixprotocol-20260915/logcat.txt.
VRUN="$WORK/verdict-run"
mkdir -p "$VRUN/T20C"
{
  printf '%s\n' '09-15 15:45:41.563  9858  9918 I ReactNativeJS: KALSA_SESSION {"op":"window_align","from":1,"to":0}'
  printf '%s\n' '09-15 15:47:11.832  9858  9918 I ReactNativeJS: KALSA_SESSION {"op":"window_align","from":2,"to":4}'
  printf '%s\n' '09-15 15:45:41.617  9858  9918 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"ceiling":4312,"prevStart":0,"newStart":4,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-15 16:03:35.302  9858  9918 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"ceiling":4312,"prevStart":4,"newStart":10,"advanced":true,"kvCleared":true}'
  # A telemetry line carrying `truncated` is what proves the build COULD have
  # reported a truncation; without it the verdict must refuse to score that
  # condition rather than pass it vacuously (asserted below).
  printf '%s\n' '09-15 16:03:40.100  9858  9918 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":10,"tokensEvaluated":10,"tokensPredicted":5,"truncated":false}'
} > "$VRUN/logcat.txt"
{
  printf '%s\n' '{"arm":"T20C","i":1,"intent":"chat-1","assistant":"a"}'
  printf '%s\n' '{"arm":"T20C","i":2,"intent":"chat-2","assistant":"b"}'
} > "$VRUN/T20C/c1-V1.jsonl"

vout="$(node "$HERE/verdict.mjs" "$VRUN" --turns 2 2>&1)"
vrc=$?
# The align count is the regression guard: keying on the inner "op" field finds
# no payload (the brace precedes it) and reports 0 of 0, which PASSES vacuously.
if printf '%s' "$vout" | grep -q '1 of 2 aligns land on 0'; then
  ok "verdict parses window_align through the outer marker (1 of 2)"
else
  bad "verdict lost the aligns (vacuous pass regression)"
  printf '%s\n' "$vout" | sed 's/^/   | /'
fi
if [ "$vrc" -eq 0 ]; then
  ok "verdict exits 0 when every turn answered and slides are monotone"
else
  bad "verdict exited $vrc on a clean synthetic run"
  printf '%s\n' "$vout" | sed 's/^/   | /'
fi

VBARE="$WORK/verdict-bare"
mkdir -p "$VBARE/T20C"
grep -v KALSA_TELEMETRY "$VRUN/logcat.txt" > "$VBARE/logcat.txt"
cp "$VRUN/T20C/c1-V1.jsonl" "$VBARE/T20C/c1-V1.jsonl"
# Capture, then grep: verdict.mjs exits 1 here by design, and under pipefail a
# `node ... | grep -q` pipeline inherits that 1 and sends the `if` to else even
# when grep matched.
vbout="$(node "$HERE/verdict.mjs" "$VBARE" --turns 2 2>&1 || true)"
if printf '%s' "$vbout" | grep -q 'UNVERIFIABLE'; then
  ok "verdict refuses to score truncation on a build that cannot report it"
else
  bad "verdict scored truncation vacuously on an uninstrumented run"
fi


# ── (e) a send the ENGINE accepted is not re-sent because the DB lags ───────
# 2026-09-17, S23 turn 3: the app logged KALSA_THINKING 0.3 s after the send but
# had not written the user message to RKStorage. campaign_user_landed read the
# DB, saw nothing for 45 s, and re-shared — the engine threw away 92 s of work
# and restarted the same question as a new turn. The run then died waiting for a
# completion marker that arrived 63 s after the harness gave up.
run_db_lag_send() {
  local out="$WORK/dblag"
  rm -rf "$out"; mkdir -p "$out"
  fake_reset db-lag
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    campaign_send_turn "Domanda di prova per il fake" && printf 'ok' > "$out/rc.txt" || printf 'fail' > "$out/rc.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  )
  local rc shares taps
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf 'missing')
  shares=$(grep -c 'android.intent.action.VIEW' "$FAKE_DEV/fake/invocations.log" 2>/dev/null || printf 0)
  taps=$(grep -c 'input tap' "$FAKE_DEV/fake/invocations.log" 2>/dev/null || printf 0)
  if [ "$rc" = "ok" ]; then
    ok "db-lag: send accepted on engine evidence (DB never got the user message)"
  else
    bad "db-lag: send reported $rc — the harness still needs the DB copy"
  fi
  if [ "$shares" -eq 1 ]; then
    ok "db-lag: exactly one share intent — no duplicate turn over live work"
  else
    bad "db-lag: $shares share intents — the harness re-sent over work in flight"
  fi
  # Hostile audit, 2026-09-17: the first version of this case passed with the
  # tap deleted from campaign_send_turn, because the fake emitted the engine
  # marker at share time. The fake now fires it from `input tap` on a non-empty
  # composer; this asserts the tap the marker is supposed to be evidence OF.
  if [ "$taps" -eq 1 ]; then
    ok "db-lag: the turn started from one Send tap, not from the share alone"
  else
    bad "db-lag: $taps send taps — the engine evidence is not evidence of a send"
  fi
}

printf '\n== (e) a send the engine accepted is not re-sent ==\n'
run_db_lag_send

printf '%s\n' '{"arm":"T20C","i":3,"intent":"chat-3","assistant":""}' >> "$VRUN/T20C/c1-V1.jsonl"
node "$HERE/verdict.mjs" "$VRUN" --turns 3 > /dev/null 2>&1
if [ $? -eq 1 ]; then
  ok "verdict exits 1 when a turn was never answered"
else
  bad "verdict did not fail on an unanswered turn"
fi


# -- (f) the run-cost report survives the shapes a real logcat throws at it ---
# Hostile audit 2026-09-17 found three defects in verdictSpend.mjs, all of them
# invisible because nothing asserted its output: the -1 "missing counter"
# sentinel printed as a measurement ("-1 tok in -0s") because -1 is finite;
# two slides with no turn between them billed the SAME turn twice; and the
# prewarm's prefill was dropped entirely, because React Native renders a
# multi-arg console.log quoted and JSON.parse threw on a well-formed line.
SRUN="$WORK/spend-run"
mkdir -p "$SRUN/T20C"
{
  # Quoted RN shape: this is how a multi-argument console.log reaches logcat.
  printf '%s\n' "09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_PREWARM', '{\"op\":\"done\",\"promptMs\":10000,\"promptN\":1832}'"
  printf '%s\n' '09-17 10:01:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"promptMs":2000,"prompt_n":100,"predictedMs":8000,"predictedPerSecond":10.0}'
  printf '%s\n' '09-17 10:02:00.000 1 2 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"prevStart":0,"newStart":4,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-17 10:02:01.000 1 2 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"prevStart":4,"newStart":8,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-17 10:03:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"2","round":0,"promptMs":4000,"prompt_n":400,"predictedMs":8000,"predictedPerSecond":5.0}'
  # Every counter absent: the app encodes that as -1, not as a missing field.
  printf '%s\n' '09-17 10:04:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"3","round":0,"promptMs":-1,"prompt_n":-1,"predictedMs":-1,"predictedPerSecond":-1}'
} > "$SRUN/logcat.txt"
printf '%s\n' '{"arm":"T20C","i":1,"intent":"chat-1","assistant":"a"}' > "$SRUN/T20C/c1-V1.jsonl"

sout="$(node "$HERE/verdict.mjs" "$SRUN" --turns 1 2>&1 || true)"

printf '\n== (f) the run-cost report is asserted, not just printed ==\n'
if printf '%s' "$sout" | grep -qF '16s prefill (10s of it prewarm) / 16s decode (prefill 50%)'; then
  ok "spend: prewarm prefill is counted, and named separately"
else
  bad "spend: prefill split wrong: $(printf '%s' "$sout" | grep -F 'prefill vs decode')"
fi
if printf '%s' "$sout" | grep -qF '400 tok in 4s, turn after the slide reported no prefill counters'; then
  ok "spend: one turn pays one slide, and -1 is refused as a measurement"
else
  bad "spend: slide bill wrong: $(printf '%s' "$sout" | grep -F 're-prefill after')"
fi
if printf '%s' "$sout" | grep -q 'tok in -0s'; then
  bad "spend: the -1 sentinel printed as a measurement"
else
  ok "spend: no negative bill reached the report"
fi
if printf '%s' "$sout" | grep -qF '10.00 -> 5.00 (-50%)'; then
  ok "spend: decode decay skips the turn with no rate"
else
  bad "spend: decay wrong: $(printf '%s' "$sout" | grep -F 'decode tok/s')"
fi

printf '\npassed=%d failed=%d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
