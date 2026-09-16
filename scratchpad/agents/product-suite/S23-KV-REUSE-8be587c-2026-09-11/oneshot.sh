#!/usr/bin/env bash
# S23: restore then one Italian turn; capture RNLlama KVPREFIX + prompt_n.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) echo "refusing $ANDROID_SERIAL" >&2; exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-KV-REUSE-8be587c-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
MSG="${MSG:-Scrivi una frase breve sul cioccolato, in italiano.}"
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-kv-reuse] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

coords_for() {
  python3 - "$1" "$2" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
if "com.android.systemui" in xml and "com.kalsa.app" not in xml:
    sys.exit(2)
pat = re.compile(
    r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    % re.escape(needle))
m = pat.search(xml) or re.compile(
    r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
    % re.escape(needle)).search(xml)
if not m:
    sys.exit(1)
x1, y1, x2, y2 = map(int, m.groups())
print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
}
dump_idle() {
  local dest="$1" ui
  device_collapse_shade
  ui=$(device_dump_ui_retry || true)
  printf '%s\n' "$ui" > "$dest"
}

rlog "force-stop Kalsa only"
adb shell am force-stop com.kalsa.app
sleep 2
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
rlog "logcat pid=$LPID"
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
rlog "started utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

load_ok=0
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep -F 'KALSA_SESSION' "$FLOG" | grep -q '"op":"load"' && grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog "LOAD ok:true elapsed=$(( $(date +%s) - t0 ))s"
    grep KALSA_SESSION "$FLOG" | grep '"op":"load"' | tail -3 | tee -a "$RUN"
    load_ok=1
    break
  fi
  if grep KALSA_SESSION "$FLOG" | grep '"op":"load"' | grep -q '"ok":false'; then
    rlog "LOAD ok:false"
    grep KALSA_SESSION "$FLOG" | tail -8 | tee -a "$RUN"
    break
  fi
  sleep 2
done
if [ "$load_ok" -ne 1 ]; then
  rlog "FAIL no load ok:true"
  echo FAIL > "$EVID/verdict.txt"
  kill "$LPID" 2>/dev/null || true
  exit 1
fi

# wait Pronto / kv_holds_chat skip
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 90 ]; do
  if grep -q 'kv_holds_chat' "$FLOG" || grep KALSA_PREWARM "$FLOG" | grep -q '"op":"done"'; then
    rlog "engine ready elapsed=$(( $(date +%s) - t1 ))s"
    grep -E 'KALSA_PREWARM|KALSA_KVRESUME' "$FLOG" | tail -8 | tee -a "$RUN"
    break
  fi
  sleep 2
done
sleep 2
dump_idle "$EVID/ui-ready.xml"
if ! INV=$(coords_for "Invia" "$EVID/ui-ready.xml"); then
  rlog "FAIL no Invia"
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi
read -r IX IY <<< "$INV"
rlog "Invia $IX,$IY"

device_collapse_shade
device_share_intent "$MSG" "kv_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1100
sleep 2
dump_idle "$EVID/ui-composer.xml"
if ! grep -qF "cioccolato" "$EVID/ui-composer.xml"; then
  device_share_intent "$MSG" "kvr_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1100
  sleep 2
  dump_idle "$EVID/ui-composer.xml"
fi
if ! grep -qF "cioccolato" "$EVID/ui-composer.xml"; then
  rlog "FAIL composer"
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi
rlog "tap Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY"

send_ok=0
t2=$(date +%s)
while [ $(( $(date +%s) - t2 )) -lt 30 ]; do
  if grep -q 'KALSA_SEND' "$FLOG"; then
    grep KALSA_SEND "$FLOG" | tee "$EVID/kalsa-send.txt" | tee -a "$RUN"
    send_ok=1
    break
  fi
  sleep 0.4
done
if [ "$send_ok" -ne 1 ]; then
  rlog "FAIL no KALSA_SEND"
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi

rlog "wait KALSA_TELEMETRY"
tel_ok=0
t3=$(date +%s)
while [ $(( $(date +%s) - t3 )) -lt 180 ]; do
  if grep KALSA_STALL "$FLOG" | grep -q .; then
    rlog "FAIL stall"
    grep KALSA_STALL "$FLOG" | tee -a "$RUN"
    break
  fi
  if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"'; then
    rlog "TELEMETRY elapsed=$(( $(date +%s) - t3 ))s"
    grep 'KALSA_TELEMETRY' "$FLOG" | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
    tel_ok=1
    break
  fi
  sleep 0.5
done
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true

grep -E 'KALSA_KVPREFIX|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_SESSION|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_SEND|keep_prefix' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
grep -E 'KALSA_KVPREFIX|KALSA_KVDIAG|KALSA_KVRESUME|keep_prefix' "$FLOG" \
  > "$EVID/quoted-rnllama.txt" || true

python3 - "$EVID" <<'PY'
import json, re, pathlib, sys
evid = pathlib.Path(sys.argv[1])
blob = (evid / "quoted-kalsa.txt").read_text(encoding="utf-8", errors="replace")
rn = (evid / "quoted-rnllama.txt").read_text(encoding="utf-8", errors="replace") if (evid / "quoted-rnllama.txt").exists() else blob

def last_json(prefix):
    lines = [ln for ln in blob.splitlines() if prefix in ln]
    if not lines:
        return None, ""
    ln = lines[-1]
    i = ln.find("{")
    if i < 0:
        return None, ln
    try:
        return json.loads(ln[i:]), ln
    except Exception:
        m = re.search(r"\{.*\}", ln)
        return (json.loads(m.group(0)), ln) if m else (None, ln)

load, load_ln = last_json("KALSA_SESSION")
# prefer load op
for ln in blob.splitlines():
    if "KALSA_SESSION" in ln and '"op":"load"' in ln:
        i = ln.find("{")
        try:
            load = json.loads(ln[i:])
            load_ln = ln
        except Exception:
            pass

tel, tel_ln = None, ""
for ln in blob.splitlines():
    if "KALSA_TELEMETRY" in ln and '"turnId":"1"' in ln:
        i = ln.find("{")
        try:
            tel = json.loads(ln[i:])
            tel_ln = ln
        except Exception:
            pass

kvprefix = [ln for ln in rn.splitlines() if "KALSA_KVPREFIX" in ln]
keep0 = [ln for ln in rn.splitlines() if "keep_prefix=0" in ln or "keep_prefix=1" in ln]

n_common = None
saved = None
if kvprefix:
    m = re.search(r"n_common=(\d+)", kvprefix[-1])
    if m:
        n_common = int(m.group(1))
    m2 = re.search(r"embd=(\d+)", kvprefix[-1])
    if m2:
        saved = int(m2.group(1))
tokens = (load or {}).get("tokens") if isinstance(load, dict) else None
prompt_n = (tel or {}).get("prompt_n")
tok_eval = (tel or {}).get("tokensEvaluated")
prompt_ms = (tel or {}).get("promptMs")
load_ok = isinstance(load, dict) and load.get("ok") is True

# PASS: load ok, n_common ≈ saved (not ~0, not 2 on user turn), prompt_n << tokens_evaluated or promptMs not 37s full
verdict = "FAIL"
reason = "unknown"
if not load_ok:
    verdict, reason = "FAIL", "no_load_ok"
elif n_common is None:
    verdict, reason = "FAIL", "no_kvprefix"
elif n_common <= 2:
    verdict, reason = "FAIL", f"n_common={n_common}_user_turn"
elif saved is not None and n_common + 50 < saved * 0.5:
    verdict, reason = "FAIL", f"n_common={n_common}_vs_embd={saved}"
elif prompt_n is not None and tok_eval and prompt_n >= tok_eval * 0.85 and (prompt_ms or 0) >= 25000:
    verdict, reason = "FAIL", f"cold_prefill prompt_n={prompt_n} promptMs={prompt_ms}"
elif prompt_n is not None and tok_eval and prompt_n < tok_eval * 0.5:
    verdict, reason = "PASS", "prompt_n_much_less_than_evaluated"
elif (prompt_ms or 0) < 15000 and n_common > 100:
    verdict, reason = "PASS", "n_common_large_promptMs_not_cold"
elif n_common > 100 and (prompt_ms or 0) < 25000:
    verdict, reason = "PASS", "n_common_reuse"
else:
    verdict, reason = "FAIL", f"n_common={n_common} prompt_n={prompt_n} promptMs={prompt_ms}"

detail = {
    "verdict": verdict, "reason": reason,
    "load_ok": load_ok, "load_tokens": tokens,
    "n_common": n_common, "embd": saved,
    "prompt_n": prompt_n, "tokensEvaluated": tok_eval, "promptMs": prompt_ms,
    "load_line": load_ln, "telemetry_line": tel_ln,
    "kvprefix_lines": kvprefix, "keep_prefix_lines": keep0,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
(evid / "verdict.txt").write_text(f"{verdict} {reason}\n")
print(f"VERDICT {verdict} {reason}")
print(json.dumps({k: detail[k] for k in ("load_ok","load_tokens","n_common","embd","prompt_n","tokensEvaluated","promptMs")}, indent=2))
PY
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) $(cat "$EVID/verdict.txt")"
