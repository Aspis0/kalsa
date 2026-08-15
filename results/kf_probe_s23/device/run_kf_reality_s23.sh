#!/data/data/com.termux/files/usr/bin/bash
# run_kf_reality_jelly.sh — KF REALITY cell on Jelly Star.
# Sustained + tail + energy + memory. Build-only sibling of kernel_kf_proto.
#
# Sequence: BLOCK_PLAN (space-separated ARM[:WIDTH] tokens).
# Default "OFF ON:6 ON:6 OFF" is exact v1 ABBA. Sweep example:
#   BLOCK_PLAN="OFF ON:6 ON:4 ON:3 ON:2 OFF"
# Each block = ONE continuous generation of N_GEN tokens, same prompt.
# NO cold reset / fadvise between blocks (hot page-cache regime is the point).
# ON blocks pass --kf-prefetch --kf-prefetch-width $w; OFF ignores width.
# Plan is persisted to $OUTDIR/block_plan.txt; resume refuses a mismatched env.
#
# Per-token latencies: native CLI flag `--csv PATH` (csv_metrics_sink.cpp).
# Columns: step,steps,wall_ms,io_ms,compute_ms,read_bytes,cache_hit_pct,stall_ms,
#          mgmt_ms,majflt,cpu_ms,...,ra_issue_ms,ra_wd_ms
# Preamble includes kf_prefetch= / kf_prefetch_width=.
#
# Samplers: ONE combined 1 Hz loop (battery + freq + /proc/pid/stat + /proc/pid/io
# + MemAvailable). PID cleaned on abort/EXIT. Every termux-battery-status is
# `timeout 10`. sysfs battery is Permission denied on this uid — termux JSON only.
#
# Battery: UNPLUGGED only, floor 35%, abort 43 C. Budget ~30 points max.
# Expected wall: ~5.3 min OFF / ~3.5 min ON per 1000-token block (~18 min decode
# + load/prefill ≈ 20–25 min). Proto 1400 tok burned ~5 points; 4000 tok ≈ 15–22.
#
# Campaign pin ~/bin/bmoe-cli.JELLY is NEVER written.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/kf_reality_jelly}"
BIN="${BINARY:-$HOME/bin/kernel_kf/bmoe-cli}"
CAMPAIGN_BIN="${CAMPAIGN_BIN:-$HOME/bin/bmoe-cli.JELLY}"
MODEL="${MODEL:-$HOME/models/Marco-Mini-Instruct-KEXP.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_KF_SHA="${EXPECTED_KF_SHA:-77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e}"
EXPECTED_CAMPAIGN_SHA="${EXPECTED_CAMPAIGN_SHA:-36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81}"
EXPECTED_MODEL_SHA="2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777"
EXPECTED_MODEL_SIZE="6385238848"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
EXPECTED_PROMPT_SHA="${EXPECTED_PROMPT_SHA:-$EXPECTED_FACT_SHA}"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=60   # 1 Hz × 60s, same 60s window as proto's 5s×12
BATT_FLOOR=35
TEMP_ABORT_C=43
N_GEN="${N_GEN:-1000}"
DEFAULT_BLOCK_PLAN="OFF ON:6 ON:6 OFF"
PLAN_FILE="$OUTDIR/block_plan.txt"
N_BLOCKS=0
PLAN_ARMS=()
PLAN_WIDTHS=()

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/gen" "$OUTDIR/power" "$OUTDIR/per_token"
CSV="$OUTDIR/runs.csv"
MASTER="$OUTDIR/KF_REALITY.master.log"
STATUS="$OUTDIR/STATUS.txt"
RESUME_AT="$OUTDIR/RESUME_AT.txt"
CSV_HEADER="ts,order_idx,arm,label,decode_tps,wall_s_tok,compute,mgmt,stall,stall_pct,issued_mib,hit_mib,wasted_mib,precision_pct,hit_pct,joules,j_per_tok,j_window,ttft_s,majflt_delta,read_bytes,read_bytes_gb,temp_start,cooldown_wait_s,temp_max,temp_end,batt_start,batt_end,freq_p50_c0,freq_p95_c0,freq_p50_c1,freq_p95_c1,n_tokens,duration_s,memavail_start_kib,memavail_min_kib,screen,plugged,excluded,csv_path,freq_readable,kf_width"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }
sha_of(){ sha256sum "$1" | awk '{print $1}'; }

# Collapse whitespace; strip CR. Used for persist + resume compare.
normalize_plan_str(){
  printf '%s' "$1" | tr -d '\r' | tr -s '[:space:]' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# Fill PLAN_ARMS / PLAN_WIDTHS / N_BLOCKS from a normalized plan string.
# ON without :WIDTH defaults to 6. OFF ignores any supplied width.
parse_block_plan(){
  local plan="$1"
  PLAN_ARMS=()
  PLAN_WIDTHS=()
  local tok arm width
  for tok in $plan; do
    case "$tok" in
      *:*)
        arm="${tok%%:*}"
        width="${tok#*:}"
        ;;
      *)
        arm="$tok"
        width=""
        ;;
    esac
    arm=$(printf '%s' "$arm" | tr '[:lower:]' '[:upper:]')
    if [ "$arm" != "OFF" ] && [ "$arm" != "ON" ]; then
      log "bad BLOCK_PLAN token='$tok' (arm must be OFF or ON)"
      echo "FAIL_BLOCK_PLAN" > "$STATUS"
      exit 13
    fi
    if [ "$arm" = "ON" ]; then
      if [ -z "$width" ]; then
        width=6
      fi
      if ! printf '%s' "$width" | grep -qE '^[1-9][0-9]*$'; then
        log "bad BLOCK_PLAN width in token='$tok'"
        echo "FAIL_BLOCK_PLAN" > "$STATUS"
        exit 13
      fi
    else
      width=""
    fi
    PLAN_ARMS+=("$arm")
    PLAN_WIDTHS+=("$width")
  done
  N_BLOCKS=${#PLAN_ARMS[@]}
  if [ "$N_BLOCKS" -lt 1 ]; then
    log "empty BLOCK_PLAN"
    echo "FAIL_BLOCK_PLAN" > "$STATUS"
    exit 13
  fi
}

# Resume of a pre-sweep CSV: append kf_width to the header so new rows align.
# Existing data rows stay short; DictReader then sees kf_width as empty.
ensure_csv_header_kf_width(){
  if [ ! -f "$CSV" ] || [ ! -s "$CSV" ]; then
    return 0
  fi
  python3 - "$CSV" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")
if text.startswith("\ufeff"):
    text = text[1:]
lines = text.splitlines()
if not lines:
    raise SystemExit
hdr = lines[0].replace("\r", "")
cols = [c.strip() for c in hdr.split(",")]
if "kf_width" in cols:
    raise SystemExit
lines[0] = hdr + ",kf_width"
p.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

CAMP_SHA=""
KF_SHA=""
FREQ_READABLE=1
FREQ_SKIP_LOGGED=0
N_CPU=0
SAMPLER_PID=""
CLI_PID=""
BASELINE_TEMP=""
LAST_EXCLUDED=0

# --- sensors (timeout 10 on every termux-battery-status) ---
batt_json(){ timeout 10 termux-battery-status 2>/dev/null || echo '{}'; }
batt_plugged(){
  local j p
  j=$(batt_json)
  p=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 p=d.get("plugged","UNKNOWN")
 print("UNKNOWN" if p is None or str(p).strip()=="" else p)
except Exception:
 print("UNKNOWN")' 2>/dev/null || echo UNKNOWN)
  if [ "$p" = "UNKNOWN" ] || [ -z "$p" ] || [ "$p" = "None" ]; then
    echo UNKNOWN
  else
    echo "$p"
  fi
}
batt_pct(){
  local j p
  j=$(batt_json)
  p=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(int(d.get("percentage") or d.get("level") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1)
  echo "$p"
}
batt_temp(){
  local j t
  j=$(batt_json)
  t=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(float(d.get("temperature") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1)
  echo "$t"
}
memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }
screen_state(){
  timeout 3 dumpsys window 2>/dev/null | awk '/mWakefulness=/{gsub(/.*mWakefulness=/,""); print $1; exit}'
  :
}

# termux JSON on Jelly: voltage=mV (~4175), current=µA (~-188000). Same S23 scaling.
read_power_from_json(){
  timeout 10 termux-battery-status 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get("voltage")
    i = d.get("current")
    pct = d.get("percentage", d.get("level", -1))
    temp = d.get("temperature", -1)
    plug = d.get("plugged", "UNKNOWN")
    if plug is None or str(plug).strip() == "":
        plug = "UNKNOWN"
    if v is None or i is None:
        print("-1,-1,-1,-1,-1,%s" % plug)
    else:
        vf = float(v)
        iff = float(i)
        # mV if >=100 else V; µA if |I|>=1000 else A
        mv = vf if vf >= 100 else vf * 1000.0
        ua = iff if abs(iff) >= 1000 else iff * 1e6
        uv = int(round(mv * 1000.0))
        print("%d,%d,%.1f,%s,%.3f,%s" % (uv, int(round(ua)), mv, pct, float(temp), plug))
except Exception:
    print("-1,-1,-1,-1,-1,UNKNOWN")
'
}

kill_our_cli(){
  if [ -n "${CLI_PID:-}" ]; then
    kill "$CLI_PID" 2>/dev/null || true
  fi
  pkill -f "kernel_kf/bmoe-cli" 2>/dev/null || true
}

probe_freq(){
  local f0="/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq"
  N_CPU=$(ls -d /sys/devices/system/cpu/cpu[0-9]* 2>/dev/null | wc -l | tr -d ' ')
  if [ -r "$f0" ] && cat "$f0" >/dev/null 2>&1; then
    FREQ_READABLE=1
    log "FREQ_READABLE=1 n_cpu=$N_CPU sample=$(cat "$f0")"
  else
    FREQ_READABLE=0
    log "FREQ_READABLE=0 scaling_cur_freq denied or missing — skip freq for the cell"
  fi
}

# Combined 1 Hz sampler. Writes power/${label}.csv.
# Columns: ts,uV,uA,pct,temp_c,mV,majflt,cmajflt,read_bytes,memavail_kib,plug,freqs
start_sampler(){
  local csv="$1"
  local pid="$2"
  echo "ts,uV,uA,pct,temp_c,mV,majflt,cmajflt,read_bytes,memavail_kib,plug,freqs" > "$csv"
  rm -f "$OUTDIR/ABORT_RAM.txt" "$OUTDIR/ABORT_THERMAL.txt" "$OUTDIR/ABORT_BATT.txt" "$OUTDIR/ABORT_PLUG.txt"
  FREQ_SKIP_LOGGED=0
  (
    bad=0
    freq_denied=0
    while true; do
      pair=$(read_power_from_json)
      IFS=',' read -r uv ua mv pct temp plug <<<"$pair"
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      majflt=""; cmajflt=""; rbytes=""
      if [ -n "$pid" ] && [ -r "/proc/$pid/stat" ]; then
        # fields after comm: 10=majflt (1-based 12), 11=cmajflt (1-based 13)
        rest=$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null || true)
        if [ -n "$rest" ]; then
          majflt=$(echo "$rest" | awk '{print $10}')
          cmajflt=$(echo "$rest" | awk '{print $11}')
        fi
      fi
      if [ -n "$pid" ] && [ -r "/proc/$pid/io" ]; then
        rbytes=$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null || true)
      fi
      freqs=""
      if [ "$FREQ_READABLE" = "1" ] && [ "$freq_denied" = "0" ]; then
        if ! freqs=$(cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null | tr '\n' ';'); then
          freqs=""
        fi
        if [ -z "$freqs" ]; then
          freq_denied=1
          echo "# freq became unreadable — skipping further freq samples" >> "$csv"
        fi
      fi
      echo "$(ts),${uv},${ua},${pct},${temp},${mv},${majflt},${cmajflt},${rbytes},${ma},${plug},${freqs}" >> "$csv"

      if [ -n "${ma}" ] && [ "${ma}" -lt "${MEMAVAIL_ABORT_KIB}" ] 2>/dev/null; then
        bad=$((bad + 1))
        if [ "${bad}" -ge "${MEMAVAIL_STREAK_NEED}" ]; then
          echo "ABORT MemAvailable=${ma} KiB < 300 MiB sustained 60s" >> "$csv"
          echo "ABORT_RAM ma=${ma}" > "$OUTDIR/ABORT_RAM.txt"
          kill_our_cli
          exit 0
        fi
      else
        bad=0
      fi
      if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "${temp:- -1}" 2>/dev/null; then
        echo "ABORT thermal temp=${temp}" >> "$csv"
        echo "ABORT_THERMAL temp=${temp}" > "$OUTDIR/ABORT_THERMAL.txt"
        kill_our_cli
        exit 0
      fi
      if [ "${pct}" -ge 0 ] 2>/dev/null && [ "${pct}" -lt "${BATT_FLOOR}" ]; then
        echo "ABORT batt ${pct} < ${BATT_FLOOR}" >> "$csv"
        echo "ABORT_BATT pct=${pct}" > "$OUTDIR/ABORT_BATT.txt"
        kill_our_cli
        exit 0
      fi
      if [ -n "${plug}" ] && ! echo "${plug}" | grep -qi UNPLUGGED; then
        if [ "${plug}" != "UNKNOWN" ] && [ "${plug}" != "-1" ] && [ "${plug}" != "None" ]; then
          echo "ABORT plugged=${plug}" >> "$csv"
          echo "ABORT_PLUG plug=${plug}" > "$OUTDIR/ABORT_PLUG.txt"
          kill_our_cli
          exit 0
        fi
      fi
      sleep 1
    done
  ) >/dev/null 2>&1 &
  SAMPLER_PID=$!
  echo "$SAMPLER_PID" > "$OUTDIR/sampler.pid"
}

stop_sampler(){
  local pid="${SAMPLER_PID:-}"
  if [ -z "$pid" ] && [ -f "$OUTDIR/sampler.pid" ]; then
    pid="$(tr -d $' \r\n' < "$OUTDIR/sampler.pid")"
  fi
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  SAMPLER_PID=""
  rm -f "$OUTDIR/sampler.pid"
}

# Trapezoid |V·I| over samples with ts >= t0+ttft (j_window=decode). Else full file.
integrate_joules(){
  local csv="$1"
  local t0_epoch="${2:-}"
  local ttft="${3:-}"
  python3 - "$csv" "$t0_epoch" "$ttft" <<'PY'
import sys
from datetime import datetime
from pathlib import Path

def parse_ts(s):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None

p = Path(sys.argv[1])
t0_s = sys.argv[2] if len(sys.argv) > 2 else ""
ttft_s = sys.argv[3] if len(sys.argv) > 3 else ""
t_lo = None
try:
    if t0_s != "" and ttft_s != "":
        t_lo = float(t0_s) + float(ttft_s)
except Exception:
    t_lo = None
if not p.exists():
    print("")
    raise SystemExit
rows = []
for line in p.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
    if line.startswith("[") or line.startswith("#"):
        continue
    parts = line.split(",")
    if len(parts) < 3:
        continue
    try:
        uv = float(parts[1]); ua = float(parts[2])
    except Exception:
        continue
    if uv < 0 or ua == 0:
        continue
    ts = parse_ts(parts[0])
    if t_lo is not None and ts is not None and ts.timestamp() < t_lo:
        continue
    rows.append((ts, uv, ua))
if len(rows) < 2:
    print("")
    raise SystemExit
j = 0.0
for i in range(1, len(rows)):
    t0, uv0, ua0 = rows[i-1]
    t1, uv1, ua1 = rows[i]
    if t0 is not None and t1 is not None:
        dt = (t1 - t0).total_seconds()
    else:
        dt = 1.0
    if dt <= 0 or dt > 30:
        continue
    p0 = (uv0 * 1e-6) * (abs(ua0) * 1e-6)
    p1 = (uv1 * 1e-6) * (abs(ua1) * 1e-6)
    j += 0.5 * (p0 + p1) * dt
print(f"{j:.6f}")
PY
}

summarize_power_csv(){
  local csv="$1"
  python3 - "$csv" <<'PY'
import csv, statistics, sys
from pathlib import Path
p = Path(sys.argv[1])
maj0 = maj1 = None
rb0 = rb1 = None
temps = []
mems = []
# cpu -> list of freqs
by_cpu = {}
if not p.exists():
    print("||||")
    raise SystemExit
with p.open(encoding="utf-8", errors="replace", newline="") as f:
    r = csv.DictReader(f)
    for row in r:
        ts0 = (row.get("ts") or "").strip()
        if ts0.startswith("#") or ts0.startswith("["):
            continue
        try:
            if (row.get("majflt") or "") == "":
                maj = None
            else:
                maj = int(row.get("majflt") or 0) + int(row.get("cmajflt") or 0)
        except Exception:
            maj = None
        try:
            if (row.get("read_bytes") or "") == "":
                rb = None
            else:
                rb = int(row["read_bytes"])
        except Exception:
            rb = None
        if maj is not None:
            if maj0 is None:
                maj0 = maj
            maj1 = maj
        if rb is not None:
            if rb0 is None:
                rb0 = rb
            rb1 = rb
        try:
            temps.append(float(row["temp_c"]))
        except Exception:
            pass
        try:
            mems.append(int(row["memavail_kib"]))
        except Exception:
            pass
        freqs = (row.get("freqs") or "").strip().strip(";")
        if freqs:
            parts = [x for x in freqs.split(";") if x]
            for i, x in enumerate(parts):
                try:
                    by_cpu.setdefault(i, []).append(float(x))
                except Exception:
                    pass
maj_d = "" if maj0 is None or maj1 is None else str(maj1 - maj0)
rb_d = "" if rb0 is None or rb1 is None else str(rb1 - rb0)
rb_gb = "" if rb_d == "" else f"{int(rb_d)/1e9:.6f}"
tmin = "" if not temps else f"{min(temps):.3f}"
tmax = "" if not temps else f"{max(temps):.3f}"
tend = "" if not temps else f"{temps[-1]:.3f}"
mmin = "" if not mems else str(min(mems))

def pctile(xs, q):
    if not xs:
        return ""
    s = sorted(xs)
    if len(s) == 1:
        return f"{s[0]:.0f}"
    k = (len(s) - 1) * q
    lo = int(k); hi = min(lo + 1, len(s) - 1)
    w = k - lo
    return f"{s[lo] * (1 - w) + s[hi] * w:.0f}"

# Two clusters by per-cpu median: low = little, high = big (Jelly T606: 6+2).
meds = {i: statistics.median(vs) for i, vs in by_cpu.items() if vs}
c0, c1 = [], []
if meds:
    lo, hi = min(meds.values()), max(meds.values())
    if hi > lo * 1.2:
        for i, m in meds.items():
            (c1 if m >= (lo + hi) / 2 else c0).extend(by_cpu[i])
    else:
        for vs in by_cpu.values():
            c0.extend(vs)
p50_0, p95_0 = pctile(c0, 0.50), pctile(c0, 0.95)
p50_1, p95_1 = pctile(c1, 0.50), pctile(c1, 0.95)
print("|".join([maj_d, rb_d, rb_gb, tmax, tend, mmin, p50_0, p95_0, p50_1, p95_1]))
PY
}

preflight_block(){
  local floor="${1:-$BATT_FLOOR}"
  local plug pct temp i ma
  for i in $(seq 1 720); do
    plug=$(batt_plugged)
    pct=$(batt_pct)
    temp=$(batt_temp)
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor screen=$(screen_state)"
    if [ "$plug" = "UNKNOWN" ]; then
      log "WARN battery JSON unknown (termux-api dead?) — retry after termux-api-start"
      timeout 10 termux-api-start >/dev/null 2>&1 || true
      sleep 3
    fi
    if ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged (now $plug)"
      sleep 20
      continue
    fi
    if [ "$pct" -lt "$floor" ] 2>/dev/null; then
      log "STOP batt $pct < $floor needs charge"
      echo "STOP_BATT" > "$STATUS"
      return 3
    fi
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp"; then
      log "WAIT battery temp $temp > ${TEMP_ABORT_C}C"
      sleep 30
      continue
    fi
    return 0
  done
  log "STOP preflight timeout"
  echo "STOP_PLUGGED" > "$STATUS"
  return 2
}

write_resume_at(){
  local blk="$1"
  echo "$blk" > "$RESUME_AT"
  log "RESUME_AT=$blk"
}

load_baseline_temp(){
  if [ -n "${BASELINE_TEMP:-}" ]; then
    return 0
  fi
  if [ ! -f "$CSV" ] || [ ! -s "$CSV" ]; then
    return 0
  fi
  BASELINE_TEMP=$(python3 - "$CSV" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
if not p.exists() or p.stat().st_size == 0:
    raise SystemExit
with p.open(encoding="utf-8", errors="replace", newline="") as f:
    for row in csv.DictReader(f):
        if str(row.get("order_idx") or "").strip() != "1":
            continue
        t = (row.get("temp_start") or "").strip()
        if t:
            print(t)
            raise SystemExit
PY
)
}

# Wait until battery temp <= block-1 start + 1.0 C. Poll 30 s, cap 300 s.
# Sets COOLDOWN_WAIT_S. Not counted in any metric window (called before t0).
wait_cooldown(){
  local blk="$1"
  COOLDOWN_WAIT_S=0
  if [ "$blk" -le 1 ]; then
    return 0
  fi
  load_baseline_temp
  if [ -z "${BASELINE_TEMP:-}" ]; then
    log "COOLDOWN block=$blk skipped (no block-1 baseline temp)"
    return 0
  fi
  local target now now_fmt
  target=$(python3 -c "print(f'{float('$BASELINE_TEMP') + 1.0:.1f}')")
  while [ "$COOLDOWN_WAIT_S" -lt 300 ]; do
    now=$(batt_temp)
    now_fmt=$(python3 -c "print(f'{float('$now'):.1f}')" 2>/dev/null || echo "$now")
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)" "$now" "$target" 2>/dev/null; then
      log "COOLDOWN block=$blk target=$target reached=$now_fmt waited=${COOLDOWN_WAIT_S} s"
      return 0
    fi
    sleep 30
    COOLDOWN_WAIT_S=$((COOLDOWN_WAIT_S + 30))
  done
  now=$(batt_temp)
  now_fmt=$(python3 -c "print(f'{float('$now'):.1f}')" 2>/dev/null || echo "$now")
  log "COOLDOWN block=$blk target=$target reached=$now_fmt waited=${COOLDOWN_WAIT_S} s (cap expired — proceed)"
  return 0
}

recheck_campaign_pin(){
  local after
  after=$(sha_of "$CAMPAIGN_BIN")
  log "CAMPAIGN_SHA_AFTER=$after"
  echo "$after  bmoe-cli.JELLY" > "$OUTDIR/campaign.sha256.after"
  if [ "$after" != "$CAMP_SHA" ]; then
    log "CAMPAIGN PIN CHANGED during cell (was $CAMP_SHA)"
    echo "FAIL_PIN_AFTER" > "$STATUS"
    return 1
  fi
  return 0
}

# Lineup cell flags — exact copy of kernel_kf_proto BASE_FLAGS.
BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think --n-expert-used 6 --drop-cold-experts 0.65)

block_complete(){
  local want="$1"
  python3 - "$CSV" "$want" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
want = int(sys.argv[2])
if not p.exists() or p.stat().st_size == 0:
    raise SystemExit(1)
with p.open(encoding="utf-8", errors="replace", newline="") as f:
    for row in csv.DictReader(f):
        try:
            idx = int(row.get("order_idx") or 0)
        except Exception:
            continue
        if idx != want:
            continue
        if str(row.get("excluded", "1")).strip() == "0":
            raise SystemExit(0)
raise SystemExit(1)
PY
}

csv_void_blocks(){
  # Print order_idx 1..N_BLOCKS that do not have an excluded=0 row.
  python3 - "$CSV" "$N_BLOCKS" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
n = int(sys.argv[2])
need = set(range(1, n + 1))
ok = set()
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            try:
                idx = int(row.get("order_idx") or 0)
            except Exception:
                continue
            if idx not in need:
                continue
            if str(row.get("excluded", "1")).strip() == "0":
                ok.add(idx)
void = [i for i in sorted(need) if i not in ok]
print(" ".join(str(i) for i in void))
PY
}

csv_excluded_labels(){
  # Labels of excluded=1 rows whose order_idx still has no excluded=0 row.
  python3 - "$CSV" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
kept = set()
excl = []
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        try:
            idx = int(row.get("order_idx") or 0)
        except Exception:
            continue
        if str(row.get("excluded", "1")).strip() == "0":
            kept.add(idx)
    for row in rows:
        try:
            idx = int(row.get("order_idx") or 0)
        except Exception:
            continue
        if str(row.get("excluded", "0")).strip() == "1" and idx not in kept:
            excl.append((row.get("label") or "?").strip())
print(" ".join(excl) if excl else "(none)")
PY
}

run_block(){
  local order_idx="$1" arm="$2"
  local width="${3:-}"
  local retry_tag="${4:-}"
  local label="b${order_idx}_${arm}"
  if [ "$arm" = "ON" ]; then
    [ -n "$width" ] || width=6
    label="b${order_idx}_ON_w${width}"
  fi
  if [ -n "$retry_tag" ]; then
    label="${label}_${retry_tag}"
  fi
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"
  local csv_tok="$OUTDIR/per_token/${label}.csv"
  local pwr="$OUTDIR/power/${label}.csv"
  LAST_EXCLUDED=0

  # Cooldown is outside the metric window (before t0 / sampler).
  wait_cooldown "$order_idx"
  local cooldown_wait_s="${COOLDOWN_WAIT_S:-0}"

  local plug pct_s temp_s ma_s screen_s
  plug=$(batt_plugged)
  pct_s=$(batt_pct)
  temp_s=$(batt_temp)
  ma_s=$(memavail_kib)
  screen_s=$(screen_state)
  [ -n "$screen_s" ] || screen_s="?"
  log "RUN $label arm=$arm kf_width=${width:-0} batt=$pct_s plugged=$plug temp=$temp_s screen=$screen_s memavail_kib=$ma_s n=$N_GEN cooldown_wait_s=$cooldown_wait_s"
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    log "STOP $label plugged=$plug"; echo "STOP_PLUGGED" > "$STATUS"; return 2
  fi
  if [ "$pct_s" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    log "STOP $label batt=$pct_s"; echo "STOP_BATT" > "$STATUS"; return 3
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_s"; then
    log "WAIT thermal before $label temp=$temp_s"
    sleep 45
    temp_s=$(batt_temp)
    plug=$(batt_plugged)
    pct_s=$(batt_pct)
    ma_s=$(memavail_kib)
    screen_s=$(screen_state); [ -n "$screen_s" ] || screen_s="?"
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_s"; then
      log "STOP thermal $label temp=$temp_s"; echo "STOP_THERMAL" > "$STATUS"; return 4
    fi
  fi
  if [ "$order_idx" -eq 1 ] && [ -z "${BASELINE_TEMP:-}" ]; then
    BASELINE_TEMP="$temp_s"
    log "BASELINE_TEMP=$BASELINE_TEMP (block 1 start)"
  fi

  local ptext
  ptext=$(cat "$P_FACT")

  local -a cmd
  cmd=("$BIN" -m "$MODEL" -p "$ptext" -n "$N_GEN")
  cmd+=("${BASE_FLAGS[@]}")
  if [ "$arm" = "ON" ]; then
    cmd+=(--kf-prefetch --kf-prefetch-width "$width")
  fi
  cmd+=(--csv "$csv_tok")

  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"

  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "${cmd[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt" &
  CLI_PID=$!
  echo "$CLI_PID" > "$OUTDIR/cli.pid"
  start_sampler "$pwr" "$CLI_PID"
  wait "$CLI_PID"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  CLI_PID=""
  rm -f "$OUTDIR/cli.pid"
  stop_sampler
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true

  if [ -f "$OUTDIR/ABORT_RAM.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_RAM.txt")"; echo "STOP_RAM" > "$STATUS"; return 5
  fi
  if [ -f "$OUTDIR/ABORT_THERMAL.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_THERMAL.txt")"; echo "STOP_THERMAL" > "$STATUS"; return 4
  fi
  if [ -f "$OUTDIR/ABORT_BATT.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_BATT.txt")"; echo "STOP_BATT" > "$STATUS"; return 3
  fi
  if [ -f "$OUTDIR/ABORT_PLUG.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_PLUG.txt")"; echo "STOP_PLUGGED" > "$STATUS"; return 2
  fi

  local pct_e temp_e screen_e
  pct_e=$(batt_pct)
  temp_e=$(batt_temp)
  screen_e=$(screen_state); [ -n "$screen_e" ] || screen_e="$screen_s"

  python3 - "$out/stdout.txt" "$OUTDIR/gen/${label}.txt" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
cut = text.find("\ngeneration:")
body = text[:cut] if cut >= 0 else text
idx = body.rfind("Assistant:")
gen = body[idx + len("Assistant:"):] if idx >= 0 else body
Path(sys.argv[2]).write_text(gen.strip() + "\n", encoding="utf-8")
PY

  local metrics
  metrics=$(python3 - <<PY
import re
from pathlib import Path
text = Path("$out/combo.txt").read_text(encoding="utf-8", errors="replace")
def g(pat, default=""):
    m = re.search(pat, text)
    return m.group(1) if m else default
tok_s = g(r"generation:\s*\d+\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)")
if not tok_s:
    tok_s = g(r"\(([0-9.]+)\s*tok/s\)")
wall = g(r"decode\s+([0-9.]+)\s*s/token")
comp = g(r"decode [0-9.]+ s/token \(compute ([0-9.]+)")
mgmt = g(r"cache mgmt ([0-9.]+)")
stall = g(r"moe-overlap: stall ([0-9.]+)\s*s/token")
issued = g(r"moe-kf-prefetch: issued ([0-9.]+)\s*MiB")
hit_m = g(r"moe-kf-prefetch: issued [0-9.]+ MiB, hit ([0-9.]+)\s*MiB")
wasted = g(r"wasted ([0-9.]+)\s*MiB")
prec = g(r"precision ([0-9.]+)%")
hit = g(r"moe-cache:\s*([0-9.]+)%\s*hit")
n_gen = g(r"generation:\s*(\d+)\s+tokens")
ttft = g(r"TTFT\s+([0-9.]+)\s*s")
if not ttft:
    ttft = g(r"prefill:\s*\d+\s+tokens,\s*([0-9.]+)\s*s")
stall_pct = ""
try:
    if stall and wall:
        stall_pct = f"{100.0 * float(stall) / float(wall):.1f}"
except Exception:
    pass
print("|".join([tok_s, wall, comp, mgmt, stall, stall_pct, issued, hit_m, wasted, prec, hit, n_gen, ttft]))
PY
)
  IFS='|' read -r decode_tps wall_s_tok compute mgmt stall stall_pct issued_mib hit_mib wasted_mib precision_pct hit_pct n_gen ttft_s <<<"$metrics"

  local joules j_per_tok j_window
  if [ -n "$ttft_s" ]; then
    j_window="decode"
    joules=$(integrate_joules "$pwr" "$t0" "$ttft_s")
  else
    j_window="full_run_fallback"
    joules=$(integrate_joules "$pwr")
  fi
  j_per_tok=""
  if [ -n "$joules" ] && [ -n "$n_gen" ] && [ "$n_gen" != "0" ]; then
    j_per_tok=$(python3 -c "print(f'{float('$joules')/float('$n_gen'):.8f}')")
  fi

  local psum majflt_delta read_bytes read_bytes_gb temp_max_s temp_end_s mem_min
  local freq_p50_c0 freq_p95_c0 freq_p50_c1 freq_p95_c1
  psum=$(summarize_power_csv "$pwr")
  IFS='|' read -r majflt_delta read_bytes read_bytes_gb temp_max_s temp_end_s mem_min freq_p50_c0 freq_p95_c0 freq_p50_c1 freq_p95_c1 <<<"$psum"
  if [ -z "$temp_max_s" ]; then
    temp_max_s=$(python3 -c "print(max(float('$temp_s'), float('$temp_e')))")
  fi
  if [ -z "$temp_end_s" ]; then
    temp_end_s="$temp_e"
  fi

  local excluded=0
  if [ "$rc" -ne 0 ]; then
    excluded=1
    log "EXCLUDE $label harness error cli rc=$rc"
  fi
  if [ -z "$wall_s_tok" ]; then
    excluded=1
    log "EXCLUDE $label missing decode s/token"
  fi
  LAST_EXCLUDED=$excluded

  local kf_width_csv=""
  if [ "$arm" = "ON" ]; then
    kf_width_csv="$width"
  fi
  local row
  row="$(ts),${order_idx},${arm},${label},${decode_tps},${wall_s_tok},${compute},${mgmt},${stall},${stall_pct},${issued_mib},${hit_mib},${wasted_mib},${precision_pct},${hit_pct},${joules},${j_per_tok},${j_window},${ttft_s},${majflt_delta},${read_bytes},${read_bytes_gb},${temp_s},${cooldown_wait_s},${temp_max_s},${temp_end_s},${pct_s},${pct_e},${freq_p50_c0},${freq_p95_c0},${freq_p50_c1},${freq_p95_c1},${n_gen},${wall},${ma_s},${mem_min},${screen_e},${plug},${excluded},${csv_tok},${FREQ_READABLE},${kf_width_csv}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s tps=$decode_tps s/tok=$wall_s_tok stall=$stall ($stall_pct%) issued=$issued_mib hit=$hit_mib wasted=$wasted_mib prec=$precision_pct joules=$joules j/tok=$j_per_tok ttft=$ttft_s j_window=$j_window majflt=$majflt_delta read_gb=$read_bytes_gb kf_width=${kf_width_csv:-0} batt=${pct_s}->${pct_e} temp=${temp_s}/${temp_max_s}/${temp_end_s} cooldown_wait_s=$cooldown_wait_s excluded=$excluded"
  tail -160 "$out/combo.txt" > "$out/tail.txt" || true
  return 0
}

write_tail_skeleton(){
  cat > "$OUTDIR/TAIL.md" <<'MD'
# KF REALITY — Jelly tail / energy / thermal / memory

Status: RUNNING (skeleton — fill with `analyze_kf_reality.py` after the cell)

## Sequence

Blocks follow `block_plan.txt` (default **OFF ON:6 ON:6 OFF** — v1 ABBA).
ON tokens are `ON:<width>` and pass `--kf-prefetch-width`. OFF ignores width.

Each block is one continuous N_GEN-token generation. No cold reset
between blocks. Per-token rows come from native `--csv` (`wall_ms`, `stall_ms`,
`ra_issue_ms`, `ra_wd_ms`). ON per-token files are `b{N}_ON_w{W}.csv`.

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | — | |
| KF_THERMAL_WIN | — | |
| KF_MEMORY_WIN | — | |
| KF_ROBUST_WIN | — | |

Thresholds live in `analyze_kf_reality.py` header. Do not invent numbers here.
MD
}

# --- termux-api must be alive (STOP_BATT false alarm if the service is dead) ---
timeout 10 termux-api-start >/dev/null 2>&1 || true
sleep 3
api_probe=$(timeout 10 termux-battery-status 2>/dev/null || echo '')
if ! echo "$api_probe" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert "percentage" in d or "level" in d' 2>/dev/null; then
  echo "FAIL_TERMUX_API" > "$STATUS"
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] termux-battery-status did not return JSON after termux-api-start; refuse to start (avoids STOP_BATT false alarm)" | tee -a "$MASTER"
  exit 12
fi

# --- pins (campaign is read-only) ---
if [ ! -x "$CAMPAIGN_BIN" ]; then
  echo "FAIL_PIN" > "$STATUS"; echo "campaign pin missing $CAMPAIGN_BIN" | tee -a "$MASTER"; exit 6
fi
camp_sha=$(sha_of "$CAMPAIGN_BIN")
CAMP_SHA="$camp_sha"
log "CAMPAIGN_SHA=$camp_sha path=$CAMPAIGN_BIN"
if [ "$camp_sha" != "$EXPECTED_CAMPAIGN_SHA" ]; then
  log "CAMPAIGN PIN FAIL expected $EXPECTED_CAMPAIGN_SHA got $camp_sha"
  echo "FAIL_PIN" > "$STATUS"
  exit 6
fi
log "CAMPAIGN PIN OK"
echo "$camp_sha  bmoe-cli.JELLY" > "$OUTDIR/campaign.sha256"

if [ ! -x "$BIN" ]; then
  log "KF BIN missing: $BIN"; echo "FAIL_NEW_BIN" > "$STATUS"; exit 7
fi
new_sha=$(sha_of "$BIN")
KF_SHA="$new_sha"
log "KF_BIN_SHA=$new_sha path=$BIN"
echo "$new_sha  kernel_kf/bmoe-cli" > "$OUTDIR/kf_bin.sha256"
if [ "$new_sha" != "$EXPECTED_KF_SHA" ]; then
  log "KF BIN sha mismatch expected $EXPECTED_KF_SHA"
  echo "FAIL_KF_SHA" > "$STATUS"
  exit 7
fi
if [ "$new_sha" = "$camp_sha" ]; then
  log "KF BIN is the campaign pin — refuse to A/B a no-op"; echo "FAIL_NEW_IS_PIN" > "$STATUS"; exit 7
fi

msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize"
if [ "$msize" != "$EXPECTED_MODEL_SIZE" ]; then
  log "MODEL size unexpected: $msize want $EXPECTED_MODEL_SIZE"; echo "FAIL_MODEL_SIZE" > "$STATUS"; exit 8
fi
if [ -f "$OUTDIR/model.sha256" ]; then
  msha=$(awk 'NF{print $1; exit}' "$OUTDIR/model.sha256")
else
  log "computing MODEL sha256..."
  msha=$(sha_of "$MODEL")
  echo "$msha  Marco-Mini-Instruct-KEXP.gguf" > "$OUTDIR/model.sha256"
fi
log "MODEL_SHA=$msha"
if [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "MODEL sha mismatch"; echo "FAIL_MODEL_SHA" > "$STATUS"; exit 8
fi

PROMPT_FILE="${PROMPT_FILE:-${P_FACT:-$OUTDIR/prompts/p_fact.txt}}"
case "$PROMPT_FILE" in
  /*) P_FACT="$PROMPT_FILE" ;;
  *)  P_FACT="$OUTDIR/$PROMPT_FILE" ;;
esac
if [ ! -f "$P_FACT" ]; then
  if [ "$(basename "$P_FACT")" = "p_fact.txt" ]; then
    for cand in \
      "$HOME/experiments/results/kernel_kf_proto/prompts/p_fact.txt" \
      "$HOME/experiments/results/kf_reality_jelly/prompts/p_fact.txt"; do
      if [ -f "$cand" ]; then
        mkdir -p "$OUTDIR/prompts"
        cp "$cand" "$OUTDIR/prompts/p_fact.txt"
        P_FACT="$OUTDIR/prompts/p_fact.txt"
        log "copied prompt from $cand"
        break
      fi
    done
  fi
fi
if [ ! -f "$P_FACT" ]; then
  log "prompt missing $P_FACT"; echo "FAIL_PROMPTS" > "$STATUS"; exit 9
fi
fact_sha=$(sha_of "$P_FACT")
log "prompt_fact_sha=$fact_sha"
if [ "$fact_sha" != "$EXPECTED_PROMPT_SHA" ]; then
  log "fact prompt sha mismatch"; echo "FAIL_PROMPT_SHA" > "$STATUS"; exit 9
fi

# --- start / resume ---
if [ -f "$STATUS" ] && [ "$(tr -d $' \r\n' < "$STATUS")" = "DONE" ] && [ -z "${RESUME_FROM:-}" ] && [ -z "${FORCE:-}" ]; then
  log "already DONE; set FORCE=1 to start a new campaign"
  exit 0
fi

RESUME_MODE=0
START_BLOCK=1
if [ -n "${RESUME_FROM:-}" ]; then
  START_BLOCK="$RESUME_FROM"
  RESUME_MODE=1
elif [ -f "$RESUME_AT" ]; then
  START_BLOCK="$(tr -d $' \r\n' < "$RESUME_AT")"
  RESUME_MODE=1
  log "auto-resume from RESUME_AT=$START_BLOCK"
elif [ -f "$CSV" ] && [ -s "$CSV" ] && [ -f "$STATUS" ]; then
  prev_st="$(tr -d $' \r\n' < "$STATUS")"
  if [ "$prev_st" != "DONE" ]; then
    RESUME_MODE=1
    START_BLOCK=1
    log "auto-resume from existing CSV (STATUS=$prev_st); complete blocks will be skipped"
  fi
fi
# BLOCK_PLAN persist / resume. Resume must replay the same plan.
EFFECTIVE_PLAN=""
if [ "$RESUME_MODE" = "1" ]; then
  if [ -f "$PLAN_FILE" ]; then
    EFFECTIVE_PLAN=$(normalize_plan_str "$(cat "$PLAN_FILE")")
  else
    EFFECTIVE_PLAN="$DEFAULT_BLOCK_PLAN"
    log "RESUME: no $PLAN_FILE — assuming default v1 plan '$DEFAULT_BLOCK_PLAN'"
    printf '%s\n' "$EFFECTIVE_PLAN" > "$PLAN_FILE"
  fi
  if [ -n "${BLOCK_PLAN+x}" ]; then
    env_plan=$(normalize_plan_str "$BLOCK_PLAN")
    if [ "$env_plan" != "$EFFECTIVE_PLAN" ]; then
      log "BLOCK_PLAN env='$env_plan' != persisted '$EFFECTIVE_PLAN' — refuse resume"
      echo "FAIL_BLOCK_PLAN" > "$STATUS"
      exit 13
    fi
  fi
  log "RESUME BLOCK_PLAN='$EFFECTIVE_PLAN'"
else
  EFFECTIVE_PLAN=$(normalize_plan_str "${BLOCK_PLAN:-$DEFAULT_BLOCK_PLAN}")
  printf '%s\n' "$EFFECTIVE_PLAN" > "$PLAN_FILE"
  log "BLOCK_PLAN='$EFFECTIVE_PLAN' persisted to $PLAN_FILE"
fi
parse_block_plan "$EFFECTIVE_PLAN"
log "parsed n_blocks=$N_BLOCKS arms=${PLAN_ARMS[*]}"

if ! echo "$START_BLOCK" | grep -qE '^[0-9]+$' || [ "$START_BLOCK" -lt 1 ] || [ "$START_BLOCK" -gt "$N_BLOCKS" ]; then
  log "bad START_BLOCK=$START_BLOCK (n_blocks=$N_BLOCKS)"
  echo "FAIL_RESUME" > "$STATUS"
  exit 10
fi

if [ ! -f "$CSV" ] || [ ! -s "$CSV" ]; then
  echo "$CSV_HEADER" > "$CSV"
elif [ "$RESUME_MODE" = "1" ]; then
  ensure_csv_header_kf_width
  log "=== RESUME append mode START_BLOCK=$START_BLOCK ==="
else
  echo "$CSV_HEADER" > "$CSV"
fi

echo "RUNNING" > "$STATUS"
rm -f "$OUTDIR/ABORT_RAM.txt" "$OUTDIR/ABORT_THERMAL.txt" "$OUTDIR/ABORT_BATT.txt" "$OUTDIR/ABORT_PLUG.txt"
write_tail_skeleton

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
restore(){
  stop_sampler
  if [ -n "${CLI_PID:-}" ]; then
    kill "$CLI_PID" 2>/dev/null || true
  fi
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore; log "trap cleanup"' EXIT

probe_freq
log "=== KF REALITY Jelly START resume=$RESUME_MODE start_block=$START_BLOCK n_gen=$N_GEN n_blocks=$N_BLOCKS ==="
log "BASE: $BIN -m $MODEL -p <prompt> -n $N_GEN ${BASE_FLAGS[*]}"
log "ON adds: --kf-prefetch --kf-prefetch-width <per-block> --csv <per_token>"
log "BLOCK_PLAN=$EFFECTIVE_PLAN (no cold reset)"

preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$START_BLOCK"; recheck_campaign_pin || true; exit "$rc"; }

# Iterate BLOCK_PLAN (order_idx is 1-based position).
VOID_LIST=""
blk=$START_BLOCK
while [ "$blk" -le "$N_BLOCKS" ]; do
  if block_complete "$blk"; then
    log "skip complete block=$blk"
    blk=$((blk + 1))
    continue
  fi
  preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$blk"; recheck_campaign_pin || true; exit "$rc"; }
  write_resume_at "$blk"
  arm="${PLAN_ARMS[$((blk-1))]}"
  width="${PLAN_WIDTHS[$((blk-1))]}"
  LAST_EXCLUDED=0
  if ! run_block "$blk" "$arm" "$width"; then
    rc=$?
    write_resume_at "$blk"
    recheck_campaign_pin || true
    exit "$rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    VOID_LIST="$VOID_LIST $blk"
  fi
  blk=$((blk + 1))
done

# Earlier incomplete blocks (previous cycle) plus voids this cycle, appended once.
PRIOR_VOID=$(csv_void_blocks)
log "void_scan=$PRIOR_VOID this_cycle_void=$VOID_LIST"
for blk in $PRIOR_VOID; do
  if block_complete "$blk"; then
    log "skip complete void-scan block=$blk"
    continue
  fi
  preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$blk"; recheck_campaign_pin || true; exit "$rc"; }
  write_resume_at "$blk"
  arm="${PLAN_ARMS[$((blk-1))]}"
  width="${PLAN_WIDTHS[$((blk-1))]}"
  LAST_EXCLUDED=0
  if ! run_block "$blk" "$arm" "$width" retry; then
    rc=$?
    write_resume_at "$blk"
    recheck_campaign_pin || true
    exit "$rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID block=$blk persisted after append retry"
    write_resume_at "$blk"
    echo "STOP_VOID" > "$STATUS"
    recheck_campaign_pin || true
    exit 11
  fi
done

rm -f "$RESUME_AT"
if ! recheck_campaign_pin; then
  exit 6
fi
# Re-verify kf bin too (read-only).
kf_after=$(sha_of "$BIN")
log "KF_BIN_SHA_AFTER=$kf_after"
if [ "$kf_after" != "$KF_SHA" ]; then
  log "KF BIN CHANGED during cell"; echo "FAIL_KF_SHA_AFTER" > "$STATUS"; exit 7
fi
still_void=$(csv_void_blocks)
excl_labels=$(csv_excluded_labels)
log "excluded rows remaining at DONE: $excl_labels"
log "void blocks remaining at DONE: ${still_void:-(none)}"
echo "DONE" > "$STATUS"
log "=== KF REALITY Jelly COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"
