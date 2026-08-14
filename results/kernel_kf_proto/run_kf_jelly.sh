#!/data/data/com.termux/files/usr/bin/bash
# run_kf_jelly.sh — K-F issue-only prefetch A/B on Jelly Star.
# ABBA 2+2 (OFF/ON/ON/OFF) + 1 hot ON. Campaign pin is NEVER written.
# UNPLUGGED, batt floor 35%, abort 43 C, screen column logged.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/kernel_kf_proto}"
BIN="${BINARY:-$HOME/bin/kernel_kf/bmoe-cli}"
CAMPAIGN_BIN="${CAMPAIGN_BIN:-$HOME/bin/bmoe-cli.JELLY}"
MODEL="${MODEL:-$HOME/models/Marco-Mini-Instruct-KEXP.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_CAMPAIGN_PREFIX="36b01966"
EXPECTED_MODEL_SHA="2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777"
EXPECTED_MODEL_SIZE="6385238848"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
BATT_FLOOR=35
TEMP_ABORT_C=43

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem" "$OUTDIR/gen"
CSV="$OUTDIR/runs.csv"
MASTER="$OUTDIR/KF.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
echo "ts,order_idx,flag,cold,decode_tps,wall_s_tok,compute,mgmt,stall,stall_pct,issued_mib,hit_mib,wasted_mib,precision_pct,spec_useful,spec_experts,hit_pct,mib_per_tok,n_gen,batt_start,batt_end,temp_max,screen,plugged,memavail_start_kib" > "$CSV"
echo "RUNNING" > "$STATUS"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

sha_of(){ sha256sum "$1" | awk '{print $1}'; }

# Campaign pin must stay the lineup binary. We only READ it.
camp_sha=$(sha_of "$CAMPAIGN_BIN")
log "CAMPAIGN_SHA=$camp_sha path=$CAMPAIGN_BIN"
case "$camp_sha" in
  ${EXPECTED_CAMPAIGN_PREFIX}*) log "CAMPAIGN PIN OK ($EXPECTED_CAMPAIGN_PREFIX)" ;;
  *) log "CAMPAIGN PIN FAIL expected ${EXPECTED_CAMPAIGN_PREFIX}* got $camp_sha"; echo "FAIL_PIN" > "$STATUS"; exit 6 ;;
esac
echo "$camp_sha  bmoe-cli.JELLY" > "$OUTDIR/campaign.sha256"

if [ ! -x "$BIN" ]; then
  log "NEW BIN missing: $BIN"; echo "FAIL_NEW_BIN" > "$STATUS"; exit 7
fi
new_sha=$(sha_of "$BIN")
log "NEW_BIN_SHA=$new_sha path=$BIN"
echo "$new_sha  kernel_kf/bmoe-cli" > "$OUTDIR/kf_bin.sha256"
if [ "$new_sha" = "$camp_sha" ]; then
  log "NEW BIN is the campaign pin — refuse to A/B a no-op"; echo "FAIL_NEW_IS_PIN" > "$STATUS"; exit 7
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

P_FACT="$OUTDIR/prompts/p_fact.txt"
if [ ! -f "$P_FACT" ]; then
  log "prompt missing $P_FACT"; echo "FAIL_PROMPTS" > "$STATUS"; exit 9
fi
fact_sha=$(sha_of "$P_FACT")
log "prompt_fact_sha=$fact_sha"
if [ "$fact_sha" != "$EXPECTED_FACT_SHA" ]; then
  log "fact prompt sha mismatch"; echo "FAIL_PROMPT_SHA" > "$STATUS"; exit 9
fi

cold(){
  local m="${1:-$MODEL}"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$m" || true
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" --dontneed "$m" 2>/dev/null || true
  fi
}

batt_json(){ timeout 5 termux-battery-status 2>/dev/null || echo '{}'; }
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
  # capacity is 0-100 on this kernel
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
  # sysfs is tenths of a degree C
  t=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo "")
  if [ -n "$t" ]; then python3 -c "print(float('$t')/10.0)"; else echo -1; fi
}
memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }
screen_state(){
  timeout 3 dumpsys window 2>/dev/null | awk '/mWakefulness=/{gsub(/.*mWakefulness=/,""); print $1; exit}'
  :
}

kill_our_cli(){ pkill -f "kernel_kf/bmoe-cli" 2>/dev/null || true; }

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

preflight_block(){
  local floor="${1:-$BATT_FLOOR}"
  local plug pct temp i ma
  for i in $(seq 1 720); do
    plug=$(batt_plugged)
    pct=$(batt_pct)
    temp=$(batt_temp)
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor screen=$(screen_state)"
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

# Lineup cell flags. New binary; --kf-prefetch added per arm.
BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think --n-expert-used 6 --drop-cold-experts 0.65)

run_one(){
  local order_idx="$1" flag="$2" do_cold="$3"
  local drop_override="${4:-}"
  local label="${5:-fact_${flag}_o${order_idx}}"
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"

  local plug pct_s temp_s ma_s screen_s
  plug=$(batt_plugged)
  pct_s=$(batt_pct)
  temp_s=$(batt_temp)
  ma_s=$(memavail_kib)
  screen_s=$(screen_state)
  [ -n "$screen_s" ] || screen_s="?"
  log "RUN $label batt=$pct_s plugged=$plug temp=$temp_s screen=$screen_s memavail_kib=$ma_s cold=$do_cold"
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

  local cold_flag=0
  if [ "$do_cold" = "1" ]; then
    cold "$MODEL"
    cold_flag=1
  fi

  local ptext
  ptext=$(cat "$P_FACT")

  local -a cmd
  cmd=("$BIN" -m "$MODEL" -p "$ptext" -n 200)
  if [ -n "$drop_override" ]; then
    local f skip_next=0
    for f in "${BASE_FLAGS[@]}"; do
      if [ "$skip_next" = "1" ]; then
        skip_next=0
        continue
      fi
      if [ "$f" = "--drop-cold-experts" ]; then
        skip_next=1
        continue
      fi
      cmd+=("$f")
    done
    cmd+=(--drop-cold-experts "$drop_override")
  else
    cmd+=("${BASE_FLAGS[@]}")
  fi
  if [ "$flag" = "ON" ]; then
    cmd+=(--kf-prefetch --kf-prefetch-width 6)
  fi

  start_mem_sampler "$OUTDIR/mem/${label}.csv"
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "${cmd[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  stop_mem_sampler
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true

  if [ -f "$OUTDIR/ABORT_RAM.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_RAM.txt")"; echo "STOP_RAM" > "$STATUS"; return 5
  fi

  local pct_e temp_e temp_max screen_e
  pct_e=$(batt_pct)
  temp_e=$(batt_temp)
  temp_max=$(python3 -c "print(max(float('$temp_s'), float('$temp_e')))")
  screen_e=$(screen_state); [ -n "$screen_e" ] || screen_e="$screen_s"

  python3 - "$out/stdout.txt" "$OUTDIR/gen/${label}.txt" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
cut = text.find("\ngeneration:")
body = text[:cut] if cut >= 0 else text
# Prompt is echoed first; keep everything after the last "Assistant:" so
# ON vs OFF compare is the model output, not the shared prompt.
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
tok_s = g(r"\(([0-9.]+)\s*tok/s\)")
wall = g(r"decode\s+([0-9.]+)\s*s/token")
comp = g(r"decode [0-9.]+ s/token \(compute ([0-9.]+)")
mgmt = g(r"cache mgmt ([0-9.]+)")
stall = g(r"moe-overlap: stall ([0-9.]+)\s*s/token")
issued = g(r"moe-kf-prefetch: issued ([0-9.]+)\s*MiB")
hit_m = g(r"moe-kf-prefetch: issued [0-9.]+ MiB, hit ([0-9.]+)\s*MiB")
wasted = g(r"wasted ([0-9.]+)\s*MiB")
prec = g(r"precision ([0-9.]+)%")
su = g(r"precision [0-9.]+% \((\d+)/")
se = g(r"precision [0-9.]+% \(\d+/(\d+) experts\)")
# fallback: generic moe-prefetch line
if not issued:
    issued = g(r"moe-prefetch: ([0-9.]+) MiB speculative")
    su = g(r"moe-prefetch: [0-9.]+ MiB speculative, (\d+)/")
    se = g(r"moe-prefetch: [0-9.]+ MiB speculative, \d+/(\d+)")
    if su and se and se != "0":
        try:
            prec = f"{100.0 * int(su) / int(se):.1f}"
            hit_m = f"{float(issued) * int(su) / int(se):.1f}"
            wasted = f"{float(issued) - float(hit_m):.1f}"
        except Exception:
            pass
hit = g(r"moe-cache:\s*([0-9.]+)%\s*hit")
mib = g(r"\(([0-9.]+)\s*MiB/token\)")
n_gen = g(r"generation:\s*(\d+)\s+tokens")
stall_pct = ""
try:
    if stall and wall:
        stall_pct = f"{100.0 * float(stall) / float(wall):.1f}"
except Exception:
    pass
print("|".join([tok_s, wall, comp, mgmt, stall, stall_pct, issued, hit_m, wasted, prec, su, se, hit, mib, n_gen]))
PY
)
  IFS='|' read -r decode_tps wall_s_tok compute mgmt stall stall_pct issued_mib hit_mib wasted_mib precision_pct spec_useful spec_experts hit_pct mib_per_tok n_gen <<<"$metrics"

  local row
  row="$(ts),${order_idx},${flag},${cold_flag},${decode_tps},${wall_s_tok},${compute},${mgmt},${stall},${stall_pct},${issued_mib},${hit_mib},${wasted_mib},${precision_pct},${spec_useful},${spec_experts},${hit_pct},${mib_per_tok},${n_gen},${pct_s},${pct_e},${temp_max},${screen_e},${plug},${ma_s}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s tps=$decode_tps stall=$stall ($stall_pct%) issued=$issued_mib hit=$hit_mib wasted=$wasted_mib prec=$precision_pct batt=${pct_s}->${pct_e} temp_max=$temp_max screen=$screen_e"
  tail -120 "$out/combo.txt" > "$out/tail.txt" || true
  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"
  if [ "$rc" -ne 0 ]; then
    log "WARN $label cli rc=$rc"
  fi
  return 0
}

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
restore(){
  stop_mem_sampler
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore; log "trap cleanup"' EXIT

log "=== KF PROTO Jelly Marco1c START ==="
preflight_block "$BATT_FLOOR" || exit $?

# ABBA flag order + one hot ON (no fadvise). Same fact prompt every run.
run_one 1 OFF 1 || exit $?
run_one 2 ON  1 || exit $?
run_one 3 ON  1 || exit $?
run_one 4 OFF 1 || exit $?
run_one 5 ON  0 || exit $?   # hot

# Identity pair at drop 0: the byte-identity contract holds here. Under the
# campaign drop (0.65) residency is an input to apply_drop, so OFF vs ON text
# can diverge (review F2) — that is logged informationally after this pair.
run_one 6 OFF 0 0 identity_OFF_d0 || exit $?
run_one 7 ON  0 0 identity_ON_d0 || exit $?

id_off="$OUTDIR/gen/identity_OFF_d0.txt"
id_on="$OUTDIR/gen/identity_ON_d0.txt"
id_fail=0
if [ ! -f "$id_off" ] || [ ! -f "$id_on" ]; then
  log "IDENTITY_D0=FAIL missing gen files"
  echo "FAIL_IDENTITY_D0" > "$STATUS"
  id_fail=1
else
  sha_off=$(sha_of "$id_off")
  sha_on=$(sha_of "$id_on")
  {
    echo "sha_off=$sha_off"
    echo "sha_on=$sha_on"
  } > "$OUTDIR/identity_d0.txt"
  if [ "$sha_off" = "$sha_on" ]; then
    log "IDENTITY_D0=PASS"
  else
    log "IDENTITY_D0=FAIL sha_off=$sha_off sha_on=$sha_on"
    echo "FAIL_IDENTITY_D0" > "$STATUS"
    id_fail=1
  fi
fi

# d065 ABBA OFF vs ON: divergence under drop is expected (review F2).
d065_off="$OUTDIR/gen/fact_OFF_o1.txt"
d065_on="$OUTDIR/gen/fact_ON_o2.txt"
if [ -f "$d065_off" ] && [ -f "$d065_on" ] && [ "$(sha_of "$d065_off")" = "$(sha_of "$d065_on")" ]; then
  log "D065_TEXT_MATCH=yes (divergence under drop is EXPECTED per review F2 — informational, not a failure)"
else
  log "D065_TEXT_MATCH=no (divergence under drop is EXPECTED per review F2 — informational, not a failure)"
fi

if [ "$id_fail" -eq 0 ]; then
  echo "DONE" > "$STATUS"
fi
log "=== KF PROTO Jelly Marco1c COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"

# Re-read campaign pin after the cell. Must be unchanged.
camp_after=$(sha_of "$CAMPAIGN_BIN")
log "CAMPAIGN_SHA_AFTER=$camp_after"
if [ "$camp_after" != "$camp_sha" ]; then
  log "CAMPAIGN PIN CHANGED during cell"; echo "FAIL_PIN_AFTER" > "$STATUS"; exit 6
fi
echo "$camp_after  bmoe-cli.JELLY" > "$OUTDIR/campaign.sha256.after"
if [ "$id_fail" -ne 0 ]; then
  exit 1
fi
