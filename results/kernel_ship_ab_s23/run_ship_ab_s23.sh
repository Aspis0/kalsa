#!/data/data/com.termux/files/usr/bin/bash
# run_ship_ab_s23.sh — config-only kernel-ship A/B on S23 (campaign binary).
# Warm-up B + 12 ABBA pairs. Campaign pin is NEVER written.
# UNPLUGGED, batt floor 45%, abort 43 C, screen column logged.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/kernel_ship_ab_s23}"
BIN="${BINARY:-$HOME/bin/mellum2/bmoe-cli}"
CAMPAIGN_BIN="${CAMPAIGN_BIN:-$HOME/bin/mellum2/bmoe-cli}"
MODEL="${MODEL:-$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_CAMPAIGN_SHA="0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
EXPECTED_MODEL_SHA="b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_MODEL_SIZE="8071293600"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
BATT_FLOOR=45
TEMP_ABORT_C=43
N_GEN=200

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem" "$OUTDIR/gen" "$OUTDIR/power"
CSV="$OUTDIR/runs.csv"
MASTER="$OUTDIR/SHIP.master.log"
STATUS="$OUTDIR/STATUS.txt"
RESUME_AT="$OUTDIR/RESUME_AT.txt"
CSV_HEADER="ts,pair,arm,label,excluded,decode_tps,wall_s_tok,compute,mgmt,stall,tokens_generated,joules,j_per_tok,ttft_s,batt_start,batt_end,temp_start,temp_max,screen,plugged,memavail_start_kib,power_source,j_window"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }
sha_of(){ sha256sum "$1" | awk '{print $1}'; }

LAST_EXCLUDED=0
LAST_RC=0
POWER_SOURCE=""
CAMP_SHA=""

# --- pins ---
camp_sha=$(sha_of "$CAMPAIGN_BIN")
CAMP_SHA="$camp_sha"
log "CAMPAIGN_SHA=$camp_sha path=$CAMPAIGN_BIN"
if [ "$camp_sha" != "$EXPECTED_CAMPAIGN_SHA" ]; then
  log "CAMPAIGN PIN FAIL expected $EXPECTED_CAMPAIGN_SHA got $camp_sha"
  echo "FAIL_PIN" > "$STATUS"
  exit 6
fi
log "CAMPAIGN PIN OK"
echo "$camp_sha  mellum2/bmoe-cli" > "$OUTDIR/campaign.sha256"
if [ ! -x "$BIN" ]; then
  log "BIN missing: $BIN"; echo "FAIL_BIN" > "$STATUS"; exit 7
fi
if [ "$BIN" != "$CAMPAIGN_BIN" ]; then
  bin_sha=$(sha_of "$BIN")
  if [ "$bin_sha" != "$camp_sha" ]; then
    log "BIN sha != campaign pin — config-only A/B must use the campaign ELF"
    echo "FAIL_BIN_NOT_PIN" > "$STATUS"
    exit 7
  fi
fi

msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize"
if [ "$msize" != "$EXPECTED_MODEL_SIZE" ]; then
  log "MODEL size unexpected: $msize want $EXPECTED_MODEL_SIZE"
  echo "FAIL_MODEL_SIZE" > "$STATUS"
  exit 8
fi
if [ -f "$OUTDIR/model.sha256" ]; then
  msha=$(awk 'NF{print $1; exit}' "$OUTDIR/model.sha256")
  log "MODEL_SHA (cached)=$msha"
else
  log "computing MODEL sha256..."
  msha=$(sha_of "$MODEL")
  echo "$msha  Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" > "$OUTDIR/model.sha256"
  log "MODEL_SHA=$msha"
fi
if [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "MODEL sha mismatch want $EXPECTED_MODEL_SHA got $msha"
  echo "FAIL_MODEL_SHA" > "$STATUS"
  exit 8
fi

P_FACT="$OUTDIR/prompts/p_fact.txt"
if [ ! -f "$P_FACT" ]; then
  log "prompt missing $P_FACT"; echo "FAIL_PROMPTS" > "$STATUS"; exit 9
fi
fact_sha=$(sha_of "$P_FACT")
log "prompt_fact_sha=$fact_sha"
if [ "$fact_sha" != "$EXPECTED_FACT_SHA" ]; then
  log "fact prompt sha mismatch"; echo "FAIL_PROMPT_SHA" > "$STATUS"; exit 9
fi

# --- sensors ---
batt_json(){ timeout 10 termux-battery-status 2>/dev/null || echo '{}'; }
batt_plugged(){
  local j p
  j=$(batt_json)
  p=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(d.get("plugged","UNKNOWN"))
except Exception:
 print("UNKNOWN")' 2>/dev/null || echo UNKNOWN)
  if [ "$p" = "UNKNOWN" ] || [ -z "$p" ]; then
    local online=0 v
    for pth in /sys/class/power_supply/*/online; do
      [ -f "$pth" ] || continue
      v=$(cat "$pth" 2>/dev/null || echo 0)
      [ "$v" = "1" ] && online=1
    done
    if [ "$online" = "1" ]; then echo PLUGGED; else echo UNPLUGGED; fi
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
  if [ "$p" -ge 0 ] 2>/dev/null; then echo "$p"; return; fi
  cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo -1
}
batt_temp(){
  local j t
  j=$(batt_json)
  t=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(float(d.get("temperature") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1)
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= 0 else 1)" "$t" 2>/dev/null; then
    echo "$t"; return
  fi
  t=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo "")
  if [ -n "$t" ]; then python3 -c "print(float('$t')/10.0)"; else echo -1; fi
}
memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }
screen_state(){
  timeout 3 dumpsys window 2>/dev/null | awk '/mWakefulness=/{gsub(/.*mWakefulness=/,""); print $1; exit}'
  :
}

probe_power_source(){
  local uv ua
  uv=$(cat /sys/class/power_supply/battery/voltage_now 2>/dev/null || true)
  ua=$(cat /sys/class/power_supply/battery/current_now 2>/dev/null || true)
  if [ -n "${uv:-}" ] && [ -n "${ua:-}" ] && echo "$uv" | grep -qE '^[0-9]+$' && echo "$ua" | grep -qE '^-?[0-9]+$'; then
    POWER_SOURCE="sysfs"
    log "POWER_SOURCE=sysfs voltage_now=$uv current_now=$ua"
    return
  fi
  POWER_SOURCE="termux"
  local sample
  sample=$(timeout 10 termux-battery-status 2>/dev/null || echo '{}')
  log "POWER_SOURCE=termux (sysfs unreadable) sample=$sample"
}

read_power_uv_ua(){
  if [ "$POWER_SOURCE" = "sysfs" ]; then
    local uv ua
    uv=$(cat /sys/class/power_supply/battery/voltage_now 2>/dev/null || echo "")
    ua=$(cat /sys/class/power_supply/battery/current_now 2>/dev/null || echo "")
    echo "${uv},${ua}"
    return
  fi
  timeout 10 termux-battery-status 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get("voltage")
    i = d.get("current")
    if v is None or i is None:
        print(",")
    else:
        # termux-battery-status on this S23 is mV (~4064) and µA (~-432000):
        # uV = mV * 1000, uA as-is. Other Android/termux builds report V / A.
        vf = float(v)
        iff = float(i)
        uv = int(round(vf * 1e6)) if vf < 100 else int(round(vf * 1000.0))
        ua = int(round(iff * 1e6)) if abs(iff) < 1000 else int(round(iff))
        print("%d,%d" % (uv, ua))
except Exception:
    print(",")
'
}

kill_our_cli(){ pkill -f "mellum2/bmoe-cli" 2>/dev/null || true; }

start_mem_sampler(){
  local csv="$1"
  echo "iso,memfree_kib,memavail_kib" > "$csv"
  rm -f "$OUTDIR/ABORT_RAM.txt"
  (
    bad=0
    while true; do
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      echo "$(ts),${mf},${ma}" >> "$csv"
      if [ -n "${ma}" ] && [ "${ma}" -lt "${MEMAVAIL_ABORT_KIB}" ]; then
        bad=$((bad + 1))
        if [ "${bad}" -ge "${MEMAVAIL_STREAK_NEED}" ]; then
          echo "ABORT MemAvailable=${ma} KiB < 300 MiB sustained 60s" | tee -a "$csv"
          echo "ABORT_RAM ma=${ma}" > "$OUTDIR/ABORT_RAM.txt"
          kill_our_cli
          exit 0
        fi
      else
        bad=0
      fi
      sleep 5
    done
  ) >/dev/null 2>&1 &
  echo $! > "$OUTDIR/mem_sampler.pid"
}

stop_mem_sampler(){
  if [ -f "$OUTDIR/mem_sampler.pid" ]; then
    local pid
    pid="$(cat "$OUTDIR/mem_sampler.pid")"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$OUTDIR/mem_sampler.pid"
  fi
}

start_power_sampler(){
  local csv="$1"
  echo "ts,uV,uA" > "$csv"
  (
    while true; do
      pair=$(read_power_uv_ua)
      uv="${pair%%,*}"
      ua="${pair#*,}"
      echo "$(ts),${uv},${ua}" >> "$csv"
      sleep 1
    done
  ) >/dev/null 2>&1 &
  echo $! > "$OUTDIR/power_sampler.pid"
}

stop_power_sampler(){
  if [ -f "$OUTDIR/power_sampler.pid" ]; then
    local pid
    pid="$(cat "$OUTDIR/power_sampler.pid")"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$OUTDIR/power_sampler.pid"
  fi
}

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
    parts = line.split(",")
    if len(parts) < 3:
        continue
    try:
        uv = float(parts[1]); ua = float(parts[2])
    except Exception:
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

preflight_block(){
  local floor="${1:-$BATT_FLOOR}"
  local plug pct temp i ma
  for i in $(seq 1 720); do
    plug=$(batt_plugged)
    pct=$(batt_pct)
    temp=$(batt_temp)
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor screen=$(screen_state) power=$POWER_SOURCE"
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
  local pair="$1"
  echo "$pair" > "$RESUME_AT"
  log "RESUME_AT=$pair"
}

recheck_campaign_pin(){
  local after
  after=$(sha_of "$CAMPAIGN_BIN")
  log "CAMPAIGN_SHA_AFTER=$after"
  echo "$after  mellum2/bmoe-cli" > "$OUTDIR/campaign.sha256.after"
  if [ "$after" != "$CAMP_SHA" ]; then
    log "CAMPAIGN PIN CHANGED during cell (was $CAMP_SHA)"
    echo "FAIL_PIN_AFTER" > "$STATUS"
    return 1
  fi
  return 0
}

# Base flags from PREREG. Arm A adds -t 4 only. Arm B adds -t 2 + k/drop.
BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think)

run_one(){
  local pair="$1" arm="$2" label="$3" excluded_forced="$4"
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"
  LAST_EXCLUDED=0
  LAST_RC=0

  local plug pct_s temp_s ma_s screen_s
  plug=$(batt_plugged)
  pct_s=$(batt_pct)
  temp_s=$(batt_temp)
  ma_s=$(memavail_kib)
  screen_s=$(screen_state)
  [ -n "$screen_s" ] || screen_s="?"
  log "RUN $label pair=$pair arm=$arm batt=$pct_s plugged=$plug temp=$temp_s screen=$screen_s memavail_kib=$ma_s power=$POWER_SOURCE"
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

  local ptext
  ptext=$(cat "$P_FACT")
  local -a cmd
  cmd=("$BIN" -m "$MODEL" -p "$ptext" -n "$N_GEN")
  cmd+=("${BASE_FLAGS[@]}")
  if [ "$arm" = "A" ]; then
    # PREREG amendment 2026-08-14: explicit model-default k. Flag-absent
    # degenerates compute ~60-90x on this engine (see PREREG).
    cmd+=(-t 4 --n-expert-used 8)
  else
    cmd+=(-t 2 --n-expert-used 6 --drop-cold-experts 1.0)
  fi

  start_mem_sampler "$OUTDIR/mem/${label}.csv"
  start_power_sampler "$OUTDIR/power/${label}.csv"
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "${cmd[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  LAST_RC=$rc
  t1=$(date +%s); wall=$((t1-t0))
  stop_power_sampler
  stop_mem_sampler
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true

  if [ -f "$OUTDIR/ABORT_RAM.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_RAM.txt")"; echo "STOP_RAM" > "$STATUS"; return 5
  fi

  local pct_e temp_e temp_max screen_e plug_e
  pct_e=$(batt_pct)
  temp_e=$(batt_temp)
  temp_max=$(python3 -c "print(max(float('$temp_s'), float('$temp_e')))")
  screen_e=$(screen_state); [ -n "$screen_e" ] || screen_e="$screen_s"
  plug_e=$(batt_plugged)

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
import re, json
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
n_gen = g(r"generation:\s*(\d+)\s+tokens")
ttft = g(r"TTFT\s+([0-9.]+)\s*s")
if not ttft:
    ttft = g(r"prefill:\s*\d+\s+tokens,\s*([0-9.]+)\s*s")
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i = line.find("{")
        if i >= 0:
            try:
                j = json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s = str(j["tok_s"])
                if j.get("tokens") is not None: n_gen = str(j["tokens"])
                if j.get("ttft") is not None: ttft = str(j["ttft"])
            except Exception:
                pass
print("|".join([tok_s, wall, comp, mgmt, stall, n_gen, ttft]))
PY
)
  IFS='|' read -r decode_tps wall_s_tok compute mgmt stall n_gen ttft_s <<<"$metrics"

  local joules j_per_tok excluded j_window
  if [ -n "$ttft_s" ]; then
    j_window="decode"
    joules=$(integrate_joules "$OUTDIR/power/${label}.csv" "$t0" "$ttft_s")
  else
    j_window="full_run_fallback"
    joules=$(integrate_joules "$OUTDIR/power/${label}.csv")
  fi
  j_per_tok=""
  if [ -n "$joules" ] && [ -n "$n_gen" ] && [ "$n_gen" != "0" ]; then
    j_per_tok=$(python3 -c "print(f'{float('$joules')/float('$n_gen'):.8f}')")
  fi

  excluded="$excluded_forced"
  if [ "$rc" -ne 0 ]; then
    excluded=1
    log "EXCLUDE $label harness error cli rc=$rc"
  fi
  if [ -z "$wall_s_tok" ] && [ "$excluded_forced" != "1" ]; then
    excluded=1
    log "EXCLUDE $label missing decode s/token"
  fi
  if ! echo "$plug_e" | grep -qi UNPLUGGED; then
    excluded=1
    log "EXCLUDE $label plugged at end ($plug_e)"
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_max"; then
    excluded=1
    log "EXCLUDE $label thermal mid-run temp_max=$temp_max"
  fi
  LAST_EXCLUDED=$excluded

  local row
  row="$(ts),${pair},${arm},${label},${excluded},${decode_tps},${wall_s_tok},${compute},${mgmt},${stall},${n_gen},${joules},${j_per_tok},${ttft_s},${pct_s},${pct_e},${temp_s},${temp_max},${screen_e},${plug},${ma_s},${POWER_SOURCE},${j_window}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s tps=$decode_tps s/tok=$wall_s_tok joules=$joules j/tok=$j_per_tok ttft=$ttft_s j_window=$j_window batt=${pct_s}->${pct_e} temp_max=$temp_max screen=$screen_e excluded=$excluded"
  tail -120 "$out/combo.txt" > "$out/tail.txt" || true
  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"
  return 0
}

pair_order(){
  # odd pairs AB, even pairs BA
  local pair="$1"
  if [ $((pair % 2)) -eq 1 ]; then echo "A B"; else echo "B A"; fi
}

pair_label(){
  local pair="$1" arm="$2"
  printf 'p%02d_%s' "$pair" "$arm"
}

run_pair(){
  local pair="$1"
  local a1 a2
  # shellcheck disable=SC2086
  set -- $(pair_order "$pair")
  a1="$1"; a2="$2"
  LAST_EXCLUDED=0
  run_one "$pair" "$a1" "$(pair_label "$pair" "$a1")" 0 || return $?
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$pair after $a1"
    return 0
  fi
  run_one "$pair" "$a2" "$(pair_label "$pair" "$a2")" 0 || return $?
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$pair after $a2"
    return 0
  fi
  log "PAIR_OK pair=$pair order=$a1$a2"
  return 0
}

pair_complete(){
  local pair="$1"
  python3 - "$CSV" "$pair" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
want = int(sys.argv[2])
arms = set()
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                pair = int(row.get("pair") or 0)
            except Exception:
                continue
            if pair != want:
                continue
            if str(row.get("excluded", "1")).strip() != "0":
                continue
            arm = (row.get("arm") or "").strip()
            if arm in ("A", "B"):
                arms.add(arm)
sys.exit(0 if arms == {"A", "B"} else 1)
PY
}

csv_void_pairs(){
  # Print pair indices in 1..12 that do not have both arms excluded=0.
  python3 - "$CSV" <<'PY'
import csv, sys
from pathlib import Path
p = Path(sys.argv[1])
need = set(range(1, 13))
have = {i: set() for i in need}
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                pair = int(row.get("pair") or 0)
            except Exception:
                continue
            if pair not in have:
                continue
            if str(row.get("excluded", "1")).strip() != "0":
                continue
            arm = (row.get("arm") or "").strip()
            if arm in ("A", "B"):
                have[pair].add(arm)
ok = [i for i in sorted(need) if have[i] == {"A", "B"}]
void = [i for i in sorted(need) if i not in ok]
print(" ".join(str(i) for i in void))
PY
}

# --- start / resume ---
if [ -f "$STATUS" ] && [ "$(tr -d ' \r\n' < "$STATUS")" = "DONE" ] && [ -z "${RESUME_FROM:-}" ] && [ -z "${FORCE:-}" ]; then
  log "already DONE; set FORCE=1 to start a new campaign"
  exit 0
fi

RESUME_MODE=0
START_PAIR=1
if [ -n "${RESUME_FROM:-}" ]; then
  START_PAIR="$RESUME_FROM"
  RESUME_MODE=1
elif [ -f "$RESUME_AT" ]; then
  START_PAIR="$(tr -d ' \r\n' < "$RESUME_AT")"
  RESUME_MODE=1
  log "auto-resume from RESUME_AT=$START_PAIR"
elif [ -f "$CSV" ] && [ -s "$CSV" ] && [ -f "$STATUS" ]; then
  prev_st="$(tr -d ' \r\n' < "$STATUS")"
  if [ "$prev_st" != "DONE" ]; then
    RESUME_MODE=1
    START_PAIR=1
    log "auto-resume from existing CSV (STATUS=$prev_st); complete pairs will be skipped"
  fi
fi
if ! echo "$START_PAIR" | grep -qE '^[0-9]+$' || [ "$START_PAIR" -lt 1 ] || [ "$START_PAIR" -gt 12 ]; then
  log "bad START_PAIR=$START_PAIR"
  echo "FAIL_RESUME" > "$STATUS"
  exit 10
fi

if [ ! -f "$CSV" ] || [ ! -s "$CSV" ]; then
  echo "$CSV_HEADER" > "$CSV"
elif [ "$RESUME_MODE" = "1" ]; then
  log "=== RESUME append mode START_PAIR=$START_PAIR ==="
else
  echo "$CSV_HEADER" > "$CSV"
fi

echo "RUNNING" > "$STATUS"
rm -f "$OUTDIR/ABORT_RAM.txt"

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
restore(){
  stop_power_sampler
  stop_mem_sampler
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore; log "trap cleanup"' EXIT

probe_power_source
log "=== SHIP A/B S23 START resume=$RESUME_MODE start_pair=$START_PAIR ==="
log "ARM A: $BIN -m $MODEL -p <p_fact> -n $N_GEN ${BASE_FLAGS[*]} -t 4"
log "ARM B: $BIN -m $MODEL -p <p_fact> -n $N_GEN ${BASE_FLAGS[*]} -t 2 --n-expert-used 6 --drop-cold-experts 1.0"

preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$START_PAIR"; recheck_campaign_pin || true; exit "$rc"; }

if [ "$RESUME_MODE" = "0" ]; then
  run_one 0 B warmup 1 || { rc=$?; write_resume_at 1; recheck_campaign_pin || true; exit "$rc"; }
elif grep -q ',warmup,' "$CSV" 2>/dev/null; then
  log "warmup already in csv, skip"
else
  log "resume without warmup row — running excluded warmup once"
  run_one 0 B warmup 1 || { rc=$?; write_resume_at "$START_PAIR"; recheck_campaign_pin || true; exit "$rc"; }
fi

VOID_LIST=""
pair=$START_PAIR
while [ "$pair" -le 12 ]; do
  if pair_complete "$pair"; then
    log "skip complete pair=$pair"
    pair=$((pair + 1))
    continue
  fi
  preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$pair"; recheck_campaign_pin || true; exit "$rc"; }
  LAST_EXCLUDED=0
  if ! run_pair "$pair"; then
    rc=$?
    write_resume_at "$pair"
    recheck_campaign_pin || true
    exit "$rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    VOID_LIST="$VOID_LIST $pair"
  fi
  pair=$((pair + 1))
done

# Earlier incomplete pairs (previous cycle) plus voids this cycle, appended.
PRIOR_VOID=$(csv_void_pairs)
log "void_scan=$PRIOR_VOID this_cycle_void=$VOID_LIST"
# Retry each still-void pair once appended (PREREG continuation).
for pair in $PRIOR_VOID; do
  if pair_complete "$pair"; then
    log "skip complete void-scan pair=$pair"
    continue
  fi
  preflight_block "$BATT_FLOOR" || { rc=$?; write_resume_at "$pair"; recheck_campaign_pin || true; exit "$rc"; }
  LAST_EXCLUDED=0
  if ! run_pair "$pair"; then
    rc=$?
    write_resume_at "$pair"
    recheck_campaign_pin || true
    exit "$rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$pair persisted after append retry"
    write_resume_at "$pair"
    echo "STOP_VOID" > "$STATUS"
    recheck_campaign_pin || true
    exit 11
  fi
done

rm -f "$RESUME_AT"
if ! recheck_campaign_pin; then
  exit 6
fi
echo "DONE" > "$STATUS"
log "=== SHIP A/B S23 COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"
