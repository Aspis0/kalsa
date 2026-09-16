#!/usr/bin/env bash
# Xiaomi 14 G2: save → force-stop Kalsa only → restore → one Italian continuation.
# Installed APK only. No reinstall. No MiniCPM5. No S23/Jelly. No file deletes.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.193:37707}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/XIAOMI-G2-RESTORE-2026-09-11}"
mkdir -p "$OUT"
export OUT

case "$ANDROID_SERIAL" in
  192.168.1.193:*) ;;
  *) echo "FATAL: serial $ANDROID_SERIAL is not Xiaomi 192.168.1.193"; exit 2 ;;
esac

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[xg2] $*" | tee -a "$OUT/run.log"; }

care_dump() {
  local tag="$1"
  adb shell dumpsys battery > "$OUT/battery-${tag}.txt" 2>&1 || true
  adb shell dumpsys thermalservice > "$OUT/thermal-${tag}.txt" 2>&1 || true
  log "care $tag $(awk '/^[[:space:]]+level:/{print "level="$2} /^[[:space:]]+temperature:/{print "batt_deci="$2} /^[[:space:]]+AC powered:/{print "ac="$2}' "$OUT/battery-${tag}.txt" | tr '\n' ' ')"
  awk '/^[[:space:]]*Thermal Status:/{print "thermal_status="$3} /mName=battery,/{print}' "$OUT/thermal-${tag}.txt" | head -4 | tee -a "$OUT/run.log"
}

battery_deci() {
  awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ { print $2; exit }' "$OUT/battery-${1}.txt"
}

thermal_gate() {
  local tag="$1" t skin
  t=$(battery_deci "$tag")
  skin=$(awk -F'[=,}]' '/Temperature\{/ && /mName=skin/ { v=$2 } END { print v+0 }' "$OUT/thermal-${tag}.txt" 2>/dev/null || echo 0)
  case "$t" in
    ''|*[!0-9]*) log "WARN thermal parse fail tag=$tag" ;;
    *)
      if [ "$t" -ge 400 ]; then
        log "STOP thermal battery_deci=$t >= 400"
        return 1
      fi
      ;;
  esac
  if awk "BEGIN{exit !($skin >= 40)}"; then
    log "STOP thermal skin=${skin}C >= 40"
    return 1
  fi
  return 0
}

# 0 = locked/unknown. 1 = unlocked per dumpsys (not uiautomator PIN nodes).
_window_unlocked() {
  local focus
  # Write then grep the file. Do not `printf | grep -q` under pipefail:
  # grep -q closes early, printf SIGPIPE → pipeline fails → false lock.
  adb -s "$ANDROID_SERIAL" shell dumpsys window > "$OUT/window-check.txt" 2>/dev/null || true
  tr -d '\r' < "$OUT/window-check.txt" > "$OUT/window-check.nocr.txt" 2>/dev/null || true
  mv "$OUT/window-check.nocr.txt" "$OUT/window-check.txt" 2>/dev/null || true
  [ -s "$OUT/window-check.txt" ] || { log "keyguard: empty dumpsys"; return 1; }
  grep -q 'mDreamingLockscreen' "$OUT/window-check.txt" || { log "keyguard: no mDreamingLockscreen"; return 1; }
  grep -q 'mDreamingLockscreen=false' "$OUT/window-check.txt" || { log "keyguard: not false"; return 1; }
  grep -q 'mDreamingLockscreen=true' "$OUT/window-check.txt" && { log "keyguard: true present"; return 1; }
  focus=$(awk '/mCurrentFocus=/{print; exit}' "$OUT/window-check.txt")
  log "keyguard focus=$focus"
  printf '%s' "$focus" | grep -q 'NotificationShade' && { log "keyguard: focus NotificationShade"; return 1; }
  return 0
}

# Empty dumpsys = still locked; wait 20s and recheck twice.
locked() {
  local i
  for i in 1 2 3; do
    if _window_unlocked; then
      log "keyguard unlocked attempt=$i"
      return 1
    fi
    [ "$i" -lt 3 ] && sleep 20
  done
  return 0
}

wait_pronto() {
  local t=0
  while [ "$t" -lt 180 ]; do
    if dump_ui 2>/dev/null | grep -q "Pronto"; then
      log "Pronto t=${t}s"
      return 0
    fi
    tap_node "Tocca per ricaricare" 2>/dev/null || true
    sleep 3
    t=$((t + 3))
  done
  log "FATAL: no Pronto"
  dump_ui > "$OUT/ui-no-pronto.xml" 2>/dev/null || true
  return 1
}

wait_kalsa() {
  local needle="$1" dest="$2" t=0
  while [ "$t" -lt 300 ]; do
    adb logcat -d -v time > "$dest" 2>/dev/null || true
    if grep -q "$needle" "$dest"; then
      return 0
    fi
    sleep 3
    t=$((t + 3))
  done
  return 1
}

extract_kalsa() {
  local src="$1" dest="$2"
  grep -E "KALSA_|RNLlama|llama_" "$src" | grep -vE "BufferQueue|gralloc" | tee "$dest" || true
}

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"
care_dump before
thermal_gate before || exit 3

if locked; then
  log "FATAL: lockscreen PIN up — not sending, not force-stopping"
  dump_ui > "$OUT/ui-locked.xml" 2>/dev/null || true
  exit 4
fi

adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell svc power stayon true >/dev/null
device_collapse_shade || true

# App was stopped at identity; start only Kalsa. Do not kill other packages.
if adb shell pidof "$PKG" >/dev/null 2>&1; then
  log "kalsa already running — am start, no force-stop before save"
else
  log "kalsa not running — am start"
fi
adb logcat -c >/dev/null 2>&1 || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 8
wait_pronto || { adb shell svc power stayon false >/dev/null || true; exit 1; }

# Confirm LFM, not MiniCPM5 (logcat cleared so G1 leftovers cannot trip this).
adb logcat -d -v time > "$OUT/logcat-boot.txt" 2>/dev/null || true
extract_kalsa "$OUT/logcat-boot.txt" "$OUT/kalsa-boot.txt"
if grep -qi "minicpm5\|MiniCPM5\|dev-minicpm5" "$OUT/kalsa-boot.txt"; then
  log "FATAL: MiniCPM5 mentioned in boot logs — aborting before send"
  adb shell svc power stayon false >/dev/null || true
  exit 5
fi
tap_node "Nuova chat" || log "WARN Nuova chat not tapped"
sleep 2

care_dump pre-turn1
thermal_gate pre-turn1 || { adb shell svc power stayon false >/dev/null || true; exit 3; }

adb logcat -c
log "turn1 share-send"
if ! device_share_send "Dimmi solo la parola: pane."; then
  log "FATAL turn1 send"
  adb shell svc power stayon false >/dev/null || true
  exit 1
fi
wait_kalsa "KALSA_TELEMETRY" "$OUT/logcat-turn1.txt" || log "WARN no telemetry turn1"
t=0
while [ "$t" -lt 90 ]; do
  adb logcat -d -v time > "$OUT/logcat-turn1.txt" 2>/dev/null || true
  if grep 'KALSA_SESSION {"op":"save"' "$OUT/logcat-turn1.txt" | grep -q '"ok":true'; then
    log "save ok:true"
    break
  fi
  sleep 3
  t=$((t + 3))
done
extract_kalsa "$OUT/logcat-turn1.txt" "$OUT/kalsa-turn1.txt"
if ! grep 'KALSA_SESSION {"op":"save"' "$OUT/kalsa-turn1.txt" | grep -q '"ok":true'; then
  log "FATAL: no chat save ok:true — not killing"
  care_dump after-turn1-fail
  adb shell svc power stayon false >/dev/null || true
  exit 1
fi

care_dump post-save
thermal_gate post-save || { adb shell svc power stayon false >/dev/null || true; exit 3; }

log "force-stop Kalsa only after save"
adb shell am force-stop "$PKG"
sleep 2
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 8
wait_pronto || { adb shell svc power stayon false >/dev/null || true; exit 1; }
adb logcat -d -v time > "$OUT/logcat-load.txt" || true
extract_kalsa "$OUT/logcat-load.txt" "$OUT/kalsa-load.txt"

care_dump pre-turn2
thermal_gate pre-turn2 || { adb shell svc power stayon false >/dev/null || true; exit 3; }

log "turn2 Italian continuation"
if ! device_share_send "Rispondi in italiano con una sola frase breve."; then
  log "FATAL turn2 send"
  adb logcat -d -v time > "$OUT/logcat-turn2-fail.txt" || true
  adb shell svc power stayon false >/dev/null || true
  exit 1
fi
wait_kalsa "KALSA_TELEMETRY" "$OUT/logcat-turn2.txt" || log "WARN no telemetry turn2"
extract_kalsa "$OUT/logcat-turn2.txt" "$OUT/kalsa-turn2.txt"

python3 - "$OUT/kalsa-load.txt" "$OUT/kalsa-turn2.txt" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, re, sys, os
load = open(sys.argv[1], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[1]) else ""
turn = open(sys.argv[2], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[2]) else ""
loads = re.findall(r"KALSA_SESSION (\{.*\})", load)
teles = re.findall(r"KALSA_TELEMETRY (\{.*\})", turn)
prefs = re.findall(r"KALSA_KVPREFIX[^\n]*", turn)
rn = [ln for ln in turn.splitlines() if "RNLlama" in ln][:20]
load_ok = tokens = stem = reason = None
for b in loads:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if d.get("op") == "load":
        load_ok = d.get("ok")
        tokens = d.get("tokens") or d.get("tokensOnDisk")
        stem = d.get("stem")
        reason = d.get("reason")
prompt_ms = evaluated = cached = predicted = interrupted = prompt_n = None
for b in teles:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if "promptMs" in d:
        prompt_ms = d.get("promptMs")
        evaluated = d.get("tokensEvaluated")
        cached = d.get("tokensCached")
        predicted = d.get("tokensPredicted")
        interrupted = d.get("interrupted")
        prompt_n = d.get("prompt_n") or d.get("promptN")
n_common = None
for p in prefs:
    m = re.search(r"n_common=(\d+)", p)
    if m:
        n_common = int(m.group(1))
tok = int(tokens) if isinstance(tokens, (int, float)) else 0
ok = (
    load_ok is True
    and tok > 0
    and interrupted is False
    and n_common is not None
    and n_common > 10
)
detail = {
    "load_ok": load_ok,
    "load_reason": reason,
    "tokens": tokens,
    "stem": stem,
    "promptMs": prompt_ms,
    "prompt_n": prompt_n,
    "tokensEvaluated": evaluated,
    "tokensCached": cached,
    "tokensPredicted": predicted,
    "n_common": n_common,
    "kvprefix": prefs[:5],
    "rnllama_sample": rn[:8],
    "pass": ok,
}
json.dump(detail, open(sys.argv[4], "w"), indent=2)
open(sys.argv[3], "w").write("PASS" if ok else "FAIL")
print("RESTORE", "PASS" if ok else "FAIL", json.dumps(detail, indent=2))
PY

log "verdict=$(cat "$OUT/verdict.txt" 2>/dev/null || echo NONE)"
care_dump after
adb shell am force-stop "$PKG" >/dev/null || true
adb shell svc power stayon false >/dev/null || true
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
