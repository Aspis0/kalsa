#!/usr/bin/env bash
# run-arm.sh — ONE arm run of the S23 repack A/B (required fix #4).
#
# Reuses the project's audited primitives instead of re-implementing them:
#   - device-share-send.sh  : kalsa://share deep-link + Send tap (the documented
#                             working send path; adb input text does not reach
#                             React `draft`, see that file's header)
#   - device-env.sh / ci-lib.sh : sql / sql_write with read-back, keep-awake,
#                             capture_sysprobe_snapshot (RssAnon/RssFile/VmRSS/
#                             VmHWM/VmSwap/minflt/majflt/MemAvailable/…)
#
# What it adds on top, and why:
#   - a hard power gate before every run (project rule: never under charge);
#   - a temperature gate before each run (numbers that drift with temperature
#     are not comparable);
#   - a 3 s peak sampler that also reads Mlocked, which ci-lib's sysprobe does
#     not capture;
#   - a python logcat reducer that computes load wall time from the device's own
#     logcat timestamps (KALSA_SEND phase:fit -> KALSA_SESSION op:init) and pulls
#     prefill/decode out of KALSA_TELEMETRY;
#   - an explicit loaded-model proof (run-as ls + /proc/<pid>/maps GGUF VMA).
#
# One run writes into $OUT/$ARM/rep$REP/ and appends one row to $OUT/results.tsv.
set -uo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT must point at the app worktree}"
SERIAL="${SERIAL:?SERIAL is required}"
ARM="${ARM:?ARM is required}"
MODEL_DIR="${MODEL_DIR:?MODEL_DIR is required}"     # written to kalsa.model.id
MODEL_FILE="${MODEL_FILE:?MODEL_FILE is required}"
NOREPACK="${NOREPACK-}"                             # 1 | 0 | empty
REP="${REP:-1}"
OUT="${OUT:?OUT is required}"
PROMPT="${PROMPT:-Rispondi in una sola frase breve: quanto fa 2 piu 2?}"
TURN_TIMEOUT_S="${TURN_TIMEOUT_S:-900}"
TEMP_GATE_DECI="${TEMP_GATE_DECI:-390}"             # 39.0 C = ci-lib THERMAL_BATTERY_RESUME_DECI
TEMP_GATE_TIMEOUT_S="${TEMP_GATE_TIMEOUT_S:-1800}"
SETTLE_S="${SETTLE_S:-20}"

export ANDROID_SERIAL="$SERIAL"
export BENCH_TARGET=device
PKG=com.kalsa.app
export PKG

RUN="$OUT/$ARM/rep$REP"
mkdir -p "$RUN"
RESULTS="$OUT/results.tsv"

# shellcheck source=/dev/null
source "$APP_ROOT/scripts/device-share-send.sh"

# Keep the display awake for the whole run. Without this the phone dozes in the
# 20 s settle window, uiautomator dump fails and the Send tap never lands — the
# exact way the first device-preflight run failed on this device. Installs the
# EXIT trap that restores screen_off_timeout / Doze whitelist afterwards.
device_keepawake_setup

say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RUN/run.log"; }

# ── raw battery fields ──────────────────────────────────────────────────────
battery_field() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' \
    | awk -v f="$1" '$0 ~ "^[[:space:]]*" f ":[[:space:]]" { sub("^[[:space:]]*" f ":[[:space:]]*",""); sub("[[:space:]]*$",""); print; exit }'
}

power_gate() {
  local ac usb wl lvl t
  ac=$(battery_field "AC powered"); usb=$(battery_field "USB powered"); wl=$(battery_field "Wireless powered")
  lvl=$(battery_field "level"); t=$(battery_field "temperature")
  say "POWER level=${lvl} temp_deciC=${t} AC=${ac} USB=${usb} WIRELESS=${wl}"
  if [ "$ac" = "true" ] || [ "$usb" = "true" ] || [ "$wl" = "true" ]; then
    say "ABORT: charging (AC=$ac USB=$usb WL=$wl) — project rule forbids measuring under charge"
    return 1
  fi
  return 0
}

temp_gate() {
  local waited=0 t
  while [ "$waited" -lt "$TEMP_GATE_TIMEOUT_S" ]; do
    t=$(battery_field "temperature")
    case "$t" in ''|*[!0-9]*) say "temp unreadable ('$t'), proceeding"; return 0 ;; esac
    if [ "$t" -le "$TEMP_GATE_DECI" ]; then say "temp gate ok: ${t} deciC after ${waited}s"; return 0; fi
    say "temp ${t} deciC > ${TEMP_GATE_DECI}, cooling (${waited}s)"
    sleep 20; waited=$((waited + 20))
  done
  say "ABORT: device did not cool to ${TEMP_GATE_DECI} deciC within ${TEMP_GATE_TIMEOUT_S}s"
  return 1
}

# ── peak sampler: one adb shell per tick, reads the fields ci-lib does not ──
arm_sample() {
  local dest="$1"
  touch "$dest.run"
  {
    echo "t_epoch,pid,rss_kb,anon_kb,file_kb,mlocked_kb,swap_kb,vmsize_kb,majflt,minflt,memavail_kb"
    while [ -f "$dest.run" ]; do
      adb shell "pid=\$(pidof $PKG 2>/dev/null | awk '{print \$1}'); \
        if [ -n \"\$pid\" ]; then \
          awk -v t=\$(date +%s) -v p=\$pid '/^VmRSS:/{r=\$2}/^RssAnon:/{a=\$2}/^RssFile:/{f=\$2}/^Mlocked:/{m=\$2}/^VmSwap:/{s=\$2}/^VmSize:/{v=\$2}END{printf \"%s,%s,%s,%s,%s,%s,%s,%s\",t,p,r,a,f,m,s,v}' /proc/\$pid/status; \
          awk -v p=\$pid '{printf \",%s,%s\",\$12,\$10}' /proc/\$pid/stat; \
          awk '/^MemAvailable:/{printf \",%s\",\$2}' /proc/meminfo; echo; \
        fi" 2>/dev/null | tr -d '\r'
      sleep 3
    done
  } > "$dest" 2>/dev/null &
  SAMPLER_PID=$!
}
arm_sample_stop() {
  [ -n "${SAMPLER_PID:-}" ] || return 0
  rm -f "$1.run"
  wait "$SAMPLER_PID" 2>/dev/null
  SAMPLER_PID=""
}

# ── environment contamination probe (DSP daemons + swap) ───────────────────
# adsprpcd/cdsprpcd spin at roughly 100% of one core independently of this app
# and have contaminated earlier thermal and tok/s runs. Recorded at the start and
# end of every arm, NEVER killed: the contamination gets documented, not
# engineered away. A lifetime tick total says nothing about the current rate, so
# the percentage is derived from two samples 5 s apart (USER_HZ = 100).
DAEMONS="adsprpcd cdsprpcd audioadsprpcd"
daemon_raw() {
  adb shell "for d in $DAEMONS; do \
      p=\$(pidof \$d 2>/dev/null | awk '{print \$1}'); \
      if [ -n \"\$p\" ]; then \
        t=\$(awk '{print \$14+\$15}' /proc/\$p/stat 2>/dev/null); \
        echo \"daemon=\$d pid=\$p ticks=\$t\"; \
      else \
        echo \"daemon=\$d pid= ticks=\"; \
      fi; \
    done; \
    echo \"loadavg=\$(cat /proc/loadavg)\"; \
    awk '/^SwapTotal:/{t=\$2}/^SwapFree:/{f=\$2}END{print \"swap_total_kb=\"t\" swap_free_kb=\"f}' /proc/meminfo; \
    echo '---top---'; top -b -n 1 2>/dev/null | head -10" 2>/dev/null | tr -d '\r'
}
daemon_probe() {
  local tag="$1" a b d ta tb
  a=$(daemon_raw); sleep 5; b=$(daemon_raw)
  {
    echo "=== daemon probe tag=$tag epoch=$(date +%s) interval_s=5 USER_HZ=100 ==="
    echo "--- sample A ---"; printf '%s\n' "$a"
    echo "--- sample B ---"; printf '%s\n' "$b"
    echo "--- derived %CPU over the 5 s interval ---"
    for d in $DAEMONS; do
      ta=$(printf '%s\n' "$a" | awk -v d="$d" -F'[ =]' '$1=="daemon" && $2==d {print $6; exit}')
      tb=$(printf '%s\n' "$b" | awk -v d="$d" -F'[ =]' '$1=="daemon" && $2==d {print $6; exit}')
      if [ -n "$ta" ] && [ -n "$tb" ]; then
        awk -v d="$d" -v x="$ta" -v y="$tb" 'BEGIN{printf "%s %%CPU=%.1f (ticks %d -> %d)\n", d, (y-x)/5.0, x, y}'
      else
        printf '%s %%CPU=absent\n' "$d"
      fi
    done
  } > "$RUN/daemon_$tag.txt" 2>/dev/null
  say "daemon_$tag: $(grep -h 'loadavg=\|%CPU=' "$RUN/daemon_$tag.txt" 2>/dev/null | tr '\n' ' ')"
}


# Copy of ci-bench.sh:524 reset_chat, same keys and same helpers from ci-lib.sh.
# Without it the turn carries the phone's accumulated history (7 159 tokens
# measured) and prefill dominates the run, obscuring the load/repack term.
reset_chat() {
  local index_raw id msg_key c_key s_key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  while IFS= read -r id || [ -n "${id-}" ]; do
    [ -z "${id-}" ] && continue
    msg_key=$(messages_storage_key "$id")
    c_key=$(compactor_storage_key "$id")
    s_key=$(summary_storage_key "$id")
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$msg_key';" "$msg_key" "__ABSENT__"
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$c_key';" "$c_key" "__ABSENT__"
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$s_key';" "$s_key" "__ABSENT__"
  done <<EOF
$(list_conversation_ids "$index_raw")
EOF
  sql_write "DELETE FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" "$CONVERSATIONS_INDEX_KEY" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='$LEGACY_MESSAGES_KEY';" "$LEGACY_MESSAGES_KEY" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';" "kalsa.chat.compactor.default" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';" "kalsa.chat.summary.default" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.memory.facts';" "kalsa.memory.facts" "__ABSENT__"
}

set_prefs() {
  adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
  sleep 3
  reset_chat || { say "WARN: reset_chat reported an error"; }
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');" "kalsa.model.id" "$MODEL_DIR" || { say "ABORT: model pref write failed"; return 1; }
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','0');" "kalsa.context.compaction" "0" || return 1
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction.choice','1');" "kalsa.context.compaction.choice" "1" || return 1
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.thinking','default');" "kalsa.bench.thinking" "default" || return 1
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.locale','it');" "kalsa.locale" "it" || return 1
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.memory.enabled','0');" "kalsa.memory.enabled" "0" || return 1
  # Nothing may inherit a previous arm's engine shape.
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.engine';" "kalsa.bench.engine" "__ABSENT__" || return 1
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.nctx';" "kalsa.bench.nctx" "__ABSENT__" || return 1
  if [ -n "$NOREPACK" ]; then
    sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.norepack','$NOREPACK');" "kalsa.bench.norepack" "$NOREPACK" || return 1
  else
    sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.norepack';" "kalsa.bench.norepack" "__ABSENT__" || return 1
  fi
  # Read-back assertion on the two keys that define the arm.
  local m n
  m=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.model.id';" | head -1 | tr -d '[:space:]')
  n=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.norepack';" | head -1 | tr -d '[:space:]')
  sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" > "$RUN/prefs.txt" 2>/dev/null
  if [ "$m" != "$MODEL_DIR" ]; then say "ABORT: model pref on device is '$m', expected '$MODEL_DIR'"; return 1; fi
  if [ -n "$NOREPACK" ]; then
    [ "$n" = "$NOREPACK" ] || { say "ABORT: norepack pref is '$n', expected '$NOREPACK'"; return 1; }
  else
    [ -z "$n" ] || { say "ABORT: norepack pref is '$n', expected absent"; return 1; }
  fi
  say "prefs ok: model.id=$m norepack=${n:-<absent>}"
}

# ── loaded-model + engine-mode proof ────────────────────────────────────────
prove_loaded() {
  local pid maps
  pid=$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
  say "pid=$pid"
  adb shell run-as "$PKG" ls -la "files/models/$MODEL_DIR/" 2>/dev/null | tr -d '\r' > "$RUN/model_files.txt"
  if [ -n "$pid" ]; then
    maps=$(adb shell run-as "$PKG" cat "/proc/$pid/maps" 2>/dev/null | tr -d '\r' | grep -E '\.gguf' || true)
    printf '%s\n' "$maps" > "$RUN/maps_gguf.txt"
    if [ -n "$maps" ]; then
      printf '%s\n' "$maps" > "$RUN/maps_gguf.txt"
      # macOS awk has no strtonum; python does the hex arithmetic.
      python3 - "$RUN/maps_gguf.txt" > "$RUN/maps_gguf_bytes.txt" <<'PYMAP'
import sys
tot = {}
for line in open(sys.argv[1], errors="replace"):
    parts = line.split()
    if len(parts) < 6 or not parts[5].endswith('.gguf'):
        continue
    a, b = parts[0].split('-')
    tot[parts[5]] = tot.get(parts[5], 0) + (int(b, 16) - int(a, 16))
for f, n in sorted(tot.items()):
    print(f"{f} mapped_bytes={n}")
PYMAP
      say "GGUF VMA: $(tr '\n' ' ' < "$RUN/maps_gguf_bytes.txt")"
    else
      say "GGUF VMA: none (mmap off or maps unreadable)"
    fi
  fi
}

# ── one run ────────────────────────────────────────────────────────────────
say "=== ARM=$ARM REP=$REP model=$MODEL_DIR/$MODEL_FILE norepack=${NOREPACK:-<absent>} ==="
power_gate || exit 3
temp_gate   || exit 3
set_prefs   || exit 4

START_EPOCH=$(date +%s)
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
lv0=$(battery_field "level"); tt0=$(battery_field "temperature")
say "run start $START_ISO level=$lv0 temp_deciC=$tt0"

adb logcat -c 2>/dev/null || true
capture_sysprobe_snapshot "$RUN" pre
daemon_probe start
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep "$SETTLE_S"

# pre-turn assistant count (from the app's own DB)
prev=$(device_history_assistant_count); case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
say "assistant count before turn: $prev"

arm_sample "$RUN/peak.csv"
SEND_T0=$(date +%s)
if ! device_share_send "$PROMPT"; then
  say "ABORT: share-send did not submit"
  arm_sample_stop "$RUN/peak.csv"
  adb logcat -d -v epoch > "$RUN/logcat.txt" 2>/dev/null || true
  exit 5
fi
say "submitted at t+$(( $(date +%s) - SEND_T0 ))s; waiting for turn completion"

done_flag=0; waited=0; refused=0
while [ "$waited" -lt "$TURN_TIMEOUT_S" ]; do
  sleep 10; waited=$((waited + 10))
  now=$(device_history_assistant_count); case "$now" in ''|*[!0-9]*) now="$prev" ;; esac
  if [ "$now" -gt "$prev" ]; then done_flag=1; say "turn completed after ${waited}s (assistant $prev -> $now)"; break; fi
  # A fit refusal produces no assistant message; poll for the gate's own line
  # so a refused arm is recorded in ~30 s instead of burning the whole timeout.
  if [ $((waited % 20)) -eq 0 ]; then
    if adb logcat -d 2>/dev/null | grep -q 'KALSA_LOAD .*"phase":"fitGate"'; then
      refused=1; say "fit-gate refusal observed after ${waited}s — stopping the wait"; break
    fi
  fi
done
if [ "$done_flag" -eq 0 ] && [ "$refused" -eq 0 ]; then say "WARN: no completion within ${TURN_TIMEOUT_S}s"; fi

arm_sample_stop "$RUN/peak.csv"
END_EPOCH=$(date +%s); END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
lv1=$(battery_field "level"); tt1=$(battery_field "temperature")
adb logcat -d -v epoch > "$RUN/logcat.txt" 2>/dev/null || true
capture_sysprobe_snapshot "$RUN" post
daemon_probe end
prove_loaded

say "run end $END_ISO level=$lv1 temp_deciC=$tt1 wall=$((END_EPOCH - START_EPOCH))s"

# ── reduce logcat ──────────────────────────────────────────────────────────
python3 - "$RUN" <<'PY'
import json, re, sys, os
run = sys.argv[1]
lines = open(os.path.join(run, "logcat.txt"), errors="replace").read().splitlines()
ts_re = re.compile(r'^\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}|\d+\.\d{3})')

def ts_of(line):
    m = ts_re.match(line)
    if not m: return None
    s = m.group(1)
    if "." in s and "-" in s:
        # threadtime: no year; use time-of-day seconds
        h, mi, rest = s.split(" ")[1].split(":")
        return int(h)*3600 + int(mi)*60 + float(rest)
    return float(s)

sends_fit, inits, tel, native_var, loads, stalls = [], [], [], [], [], []
loadprompts, ctxdone = [], []
for ln in lines:
    t = ts_of(ln)
    if 'KALSA_SEND ' in ln and '"phase":"fit"' in ln:
        try: sends_fit.append((t, json.loads(ln.split('KALSA_SEND ',1)[1])))
        except Exception: pass
    elif 'KALSA_SESSION ' in ln:
        try:
            o = json.loads(ln.split('KALSA_SESSION ',1)[1])
            if o.get("op") == "init": inits.append((t, o))
        except Exception: pass
    elif 'KALSA_TELEMETRY ' in ln:
        try: tel.append((t, json.loads(ln.split('KALSA_TELEMETRY ',1)[1])))
        except Exception: pass
    elif 'KALSA_NATIVE_VARIANT ' in ln:
        try: native_var.append((t, json.loads(ln.split('KALSA_NATIVE_VARIANT ',1)[1])))
        except Exception: pass
    elif 'KALSA_LOAD ' in ln:
        try: loads.append((t, json.loads(ln.split('KALSA_LOAD ',1)[1])))
        except Exception: pass
    elif 'KALSA_STALL ' in ln:
        try: stalls.append((t, json.loads(ln.split('KALSA_STALL ',1)[1])))
        except Exception: pass
    # Native Android logs (tag RNLlama). Their timestamps are written by the
    # native loader itself, unlike the KALSA_NATIVE lines which are native text
    # forwarded through JS console.log and can arrive late.
    elif 'RNLlama :' in ln:
        if 'Context initialized with n_seq_max' in ln:
            ctxdone.append(t)
        elif 'loadPrompt: prompt_n=' in ln:
            m = re.search(r'prompt_n=(\d+) n_ctx=(\d+) embd=(\d+)', ln)
            if m: loadprompts.append((t, int(m.group(1)), int(m.group(2)), int(m.group(3))))

out = {}
if inits:
    out["init"], t_init = inits[0][1], inits[0][0]
    # KALSA_SESSION op:init is emitted just BEFORE initLlama (LlamaService.ts:2429),
    # so it is the load START. `loadModel:884 Context initialized` is the native
    # load END. Both are on the device clock.
    if t_init is not None:
        after = [c for c in ctxdone if c is not None and c >= t_init]
        if after: out["load_wall_s"] = round(after[0] - t_init, 3)
        else: out["load_wall_s"] = None
    if sends_fit:
        out["send_fit"] = sends_fit[-1][1]
if loadprompts:
    out["loadprompts"] = [{"t": lp[0], "prompt_n": lp[1], "n_ctx": lp[2], "embd": lp[3]} for lp in loadprompts]
if tel:
    out["rounds"] = [{k: r.get(k) for k in ("turnId","round","tokensCached","tokensEvaluated","tokensPredicted","promptMs","prompt_n","promptN","predictedMs","predictedPerSecond")} for _, r in tel]
if native_var: out["native_variant"] = native_var[0][1]
if loads: out["kalsa_load"] = [l for _, l in loads]
if stalls: out["stalls"] = [s for _, s in stalls]
json.dump(out, open(os.path.join(run, "reduced.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
PY

# ── results row ────────────────────────────────────────────────────────────
peak_anon=$(awk -F, 'NR>1 && $4!="" {if ($4+0>m) m=$4+0} END{print m+0}' "$RUN/peak.csv" 2>/dev/null)
peak_file=$(awk -F, 'NR>1 && $5!="" {if ($5+0>m) m=$5+0} END{print m+0}' "$RUN/peak.csv" 2>/dev/null)
peak_mlock=$(awk -F, 'NR>1 && $6!="" {if ($6+0>m) m=$6+0} END{print m+0}' "$RUN/peak.csv" 2>/dev/null)
majf0=$(awk -F, 'NR>1 && $9!="" {print $9; exit}' "$RUN/peak.csv" 2>/dev/null)
majf1=$(awk -F, 'NR>1 && $9!="" {v=$9} END{print v}' "$RUN/peak.csv" 2>/dev/null)
mem0=$(awk -F, 'NR>1 && $11!="" {print $11; exit}' "$RUN/peak.csv" 2>/dev/null)
mem1=$(awk -F, 'NR>1 && $11!="" {v=$11} END{print v}' "$RUN/peak.csv" 2>/dev/null)

if [ ! -f "$RESULTS" ]; then
  printf 'arm\trep\tmodel\tnorepack\tmode_no_extra_bufts\tload_wall_s\tprompt_ms\tprompt_n\tpredicted_per_s\tpredicted_n\tpeak_anon_kb\tpeak_file_kb\tpeak_mlocked_kb\tmajflt_delta\tmemavail_pre_kb\tmemavail_post_kb\tlevel_pre\tlevel_post\ttemp_pre_deciC\ttemp_post_deciC\twall_s\tgguf_vma\trefusedBy\treasonKey\tadsprpcd_pct_start\tadsprpcd_pct_end\tcdsprpcd_pct_start\tcdsprpcd_pct_end\tloadavg_start\tloadavg_end\tswap_used_kb_start\tswap_used_kb_end\n' > "$RESULTS"
fi

python3 - "$RUN" "$RESULTS" "$ARM" "$REP" "$MODEL_DIR" "$NOREPACK" "$lv0" "$lv1" "$tt0" "$tt1" "$START_EPOCH" "$END_EPOCH" \
  "$peak_anon" "$peak_file" "$peak_mlock" "$majf0" "$majf1" "$mem0" "$mem1" <<'PY'
import json, os, re, sys
(run, results, arm, rep, model, norepack, lv0, lv1, tt0, tt1, s0, s1,
 anon, f, mlock, mj0, mj1, mem0, mem1) = sys.argv[1:21]
r = json.load(open(os.path.join(run, "reduced.json")))
init = r.get("init") or {}
rounds = r.get("rounds") or []
first = rounds[0] if rounds else {}
loads = r.get("kalsa_load") or []
ref = ""
for l in loads:
    if l.get("phase") == "fitGate":
        ref = l
refBy = (ref or {}).get("refusedBy") or ""
refKey = (ref or {}).get("reasonKey") or ""
vma = ""
vb = os.path.join(run, "maps_gguf_bytes.txt")
if os.path.exists(vb):
    vma = " | ".join(l.strip() for l in open(vb) if l.strip())
def num(v):
    try: return int(float(v))
    except Exception: return ""
mjd = ""
try: mjd = int(mj1) - int(mj0)
except Exception: pass

# Contamination record: DSP daemon rate + swap, carried in the same row as the
# timing so a quote of tok/s cannot be read without the background behind it.
def dnum(path, daemon):
    if not os.path.exists(path): return ""
    for line in open(path, errors="replace"):
        p = line.replace("=", " ").replace("(", " ").split()
        if len(p) > 2 and p[0] == daemon and p[1] == "%CPU":
            return p[2]
    return ""

def dval(path, key):
    if not os.path.exists(path): return ""
    for line in open(path, errors="replace"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().split()[0]
    return ""

def swap_used(path):
    if not os.path.exists(path): return ""
    txt = open(path, errors="replace").read()
    t = re.search(r'swap_total_kb=(\d+)', txt)
    f = re.search(r'swap_free_kb=(\d+)', txt)
    if not (t and f): return ""
    return int(t.group(1)) - int(f.group(1))

row = [arm, rep, model, norepack if norepack != "" else "<absent>",
       init.get("no_extra_bufts", ""), r.get("load_wall_s", ""),
       first.get("promptMs", ""), (first.get("prompt_n") if first.get("prompt_n") is not None else first.get("promptN", "")),
       first.get("predictedPerSecond", ""), first.get("tokensPredicted", ""),
       anon, f, mlock, mjd, mem0, mem1, lv0, lv1, tt0, tt1,
       int(s1) - int(s0), vma, refBy, refKey]

ds = os.path.join(run, "daemon_start.txt")
de = os.path.join(run, "daemon_end.txt")
row += [dnum(ds, "adsprpcd"), dnum(de, "adsprpcd"),
        dnum(ds, "cdsprpcd"), dnum(de, "cdsprpcd"),
        (dval(ds, "loadavg").split() or [""])[0], (dval(de, "loadavg").split() or [""])[0],
        swap_used(ds), swap_used(de)]
print("\t".join(str(x) for x in row), file=open(results, "a"))
PY

say "ROW: $(tail -1 "$RESULTS")"
say "=== ARM=$ARM REP=$REP done ==="
