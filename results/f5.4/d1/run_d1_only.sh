#!/data/data/com.termux/files/usr/bin/bash
# F5.4 D1 ONLY — ubatch 512 vs 2048 output equivalence (temp 0, same prompt file)
# Gates: termux-battery-status + die thermal. PREFIX/PATH fixed for naked sshd.
set +e
set -u
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="$HOME/experiments/results/f5.4"
D1DIR="$OUTDIR/d1"
mkdir -p "$D1DIR" "$HOME/experiments/prompts"
MASTER="$D1DIR/D1.master.log"
STATUS="$D1DIR/STATUS.txt"
PIDFILE="$D1DIR/d1.pid"
SAFETY_LOG="$D1DIR/safety.log"

BIN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"

# --- campaign binary pin (fix-bloccanti-audit §C) ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." 2>/dev/null && pwd)/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_campaign_pin.sh" ] && _PIN_LIB="$_d/lib_campaign_pin.sh" && break
done
if [ -n "$_PIN_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_PIN_LIB"
  assert_campaign_pin "$BIN"
else
  _sha_file="${CAMPAIGN_SHA_FILE:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"
  _exp=$(awk 'NF{print $1; exit}' "$_sha_file" 2>/dev/null || true)
  _got=$(sha256sum "$BIN" 2>/dev/null | awk '{print $1}')
  BIN_SHA256="$_got"
  if [ "${ALLOW_UNPINNED:-0}" != "1" ]; then
    case "$BIN" in *.CAMPAIGN) ;; *)
      echo "ERRORE pin campagna: usare bmoe-cli.CAMPAIGN (got $BIN). ALLOW_UNPINNED=1 per override." >&2
      exit 6
    ;; esac
    if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
      echo "ERRORE pin campagna: sha mismatch got=$_got expected=$_exp ($_sha_file)" >&2
      exit 6
    fi
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"
# --- end pin ---

export LD_LIBRARY_PATH="$(dirname "$BIN"):${LD_LIBRARY_PATH:-}"
MODEL="$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf"
EXPECTED_SIZE=11522702304
COLD="$HOME/bin/cold_model.sh"
MARK="F5.4 IN-CARICA"

STABLE_PROMPT="$HOME/experiments/prompts/d1_long.txt"
SRC_PROMPT="$OUTDIR/prompts/d1_prompt.txt"

THREADS=4
IO_THREADS=4
N_CTX=2048
N_PRED=256
CACHE_MB=2000
DIE_STOP_MC=95000
BATT_FLOOR=15

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

max_die_mc() {
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in
      cpu-*|cpuss-*|*cpu*|*CPU*)
        v=$(cat "$z/temp" 2>/dev/null || echo 0)
        if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
        ;;
    esac
  done
  echo "$max"
}
mc_to_c() { awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }

batt_json() {
  termux-battery-status 2>/dev/null
}

batt_pct() {
  batt_json | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(int(d.get("percentage", d.get("level", -1))))
except Exception:
  print(-1)'
}

batt_plugged() {
  batt_json | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d.get("plugged","UNKNOWN"))
except Exception:
  print("UNKNOWN")'
}

safety_check() {
  local die_mc die_c pct plug
  if ! command -v termux-battery-status >/dev/null 2>&1; then
    echo "NO_BATT_TOOL"
    return 1
  fi
  pct=$(batt_pct)
  plug=$(batt_plugged)
  die_mc=$(max_die_mc)
  die_c=$(mc_to_c "$die_mc")
  if [ "$pct" -lt 0 ] 2>/dev/null; then
    echo "BATT_READ_FAIL die=$die_c"
    return 1
  fi
  # In charge: floor is soft; unplugged: hard floor
  if [ "$plug" != "PLUGGED_AC" ] && [ "$plug" != "PLUGGED_USB" ] && [ "$plug" != "PLUGGED_WIRELESS" ]; then
    if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
      echo "BATT_LOW pct=$pct plug=$plug die=$die_c"
      return 1
    fi
  fi
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "DIE_HOT die=$die_c"
    return 1
  fi
  echo "ok pct=$pct plug=$plug die=$die_c"
  return 0
}

kill_bmoe_exact() {
  local pid cmd
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"/bmoe-cli "*) kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null || true;;
    esac
  done
}

wait_cool() {
  local target="${1:-80}" maxw="${2:-180}"
  local start die
  start=$(date +%s)
  while :; do
    die=$(mc_to_c "$(max_die_mc)")
    awk -v d="$die" -v t="$target" 'BEGIN{exit !(d+0 <= t+0)}' && return 0
    if [ $(( $(date +%s) - start )) -ge "$maxw" ]; then
      log "wait_cool timeout die=$die target=$target"
      return 0
    fi
    sleep 5
  done
}

echo $$ > "$PIDFILE"
log "D1 ONLY start pid=$$ mark=$MARK PATH_has_termux=$(command -v termux-battery-status)"
echo "PHASE_D1 $(ts)" > "$STATUS"

# Gate preflight — hard fail if batt tool missing
if ! command -v termux-battery-status >/dev/null 2>&1; then
  log "FAIL termux-battery-status not in PATH after PREFIX export"
  echo "FAIL no_batt_tool $(ts)" > "$STATUS"
  exit 2
fi
saf=$(safety_check)
src=$?
log "preflight safety: $saf"
if [ $src -ne 0 ]; then
  echo "STOPPED preflight $saf $(ts)" > "$STATUS"
  exit 1
fi

sz=$(stat -c %s "$MODEL" 2>/dev/null || echo 0)
if [ "$sz" != "$EXPECTED_SIZE" ]; then
  log "FAIL model size $sz != $EXPECTED_SIZE"
  echo "FAIL size $(ts)" > "$STATUS"
  exit 2
fi
if [ ! -x "$BIN" ]; then
  log "FAIL binary missing $BIN"
  echo "FAIL bin $(ts)" > "$STATUS"
  exit 2
fi

# Install stable prompt once from existing f5.4 d1_prompt — never rewrite mid-run
if [ -f "$SRC_PROMPT" ]; then
  cp -f "$SRC_PROMPT" "$STABLE_PROMPT"
  cp -f "$SRC_PROMPT" "$D1DIR/d1_prompt.txt"
  log "installed STABLE_PROMPT from $SRC_PROMPT"
elif [ ! -f "$STABLE_PROMPT" ]; then
  log "FAIL no prompt source"
  echo "FAIL prompt $(ts)" > "$STATUS"
  exit 2
fi
SHA=$(sha256sum "$STABLE_PROMPT" | awk '{print $1}')
echo "$SHA" > "$D1DIR/prompt.sha256"
log "prompt path=$STABLE_PROMPT sha256=$SHA bytes=$(wc -c < "$STABLE_PROMPT")"

verify_prompt() {
  local now
  now=$(sha256sum "$STABLE_PROMPT" | awk '{print $1}')
  if [ "$now" != "$SHA" ]; then
    log "FATAL prompt mutated $now != $SHA"
    echo "FAIL prompt_mutated $(ts)" > "$STATUS"
    exit 3
  fi
}

run_one() {
  local tag="$1" ubatch="$2"
  local slog="$D1DIR/${tag}.stdout.log"
  local serr="$D1DIR/${tag}.stderr.log"
  local csvp="$D1DIR/${tag}.metrics.csv"
  local genf="$D1DIR/${tag}.gen.txt"
  local meta="$D1DIR/${tag}.meta.txt"
  local outfull="$D1DIR/${tag}.out"
  local sampler="$D1DIR/${tag}.sampler.csv"
  local donef="$D1DIR/${tag}.done"
  local die_s die_e die_max wall_s wall_e rc samp_pid n_prompt tokens saf batt_s batt_e

  log "==== CELL $tag ubatch=$ubatch ===="
  echo "CELL $tag $(ts)" > "$STATUS"
  verify_prompt

  saf=$(safety_check)
  if [ $? -ne 0 ]; then
    log "STOP safety before $tag: $saf"
    echo "STOPPED $tag $saf $(ts)" > "$STATUS"
    return 1
  fi
  log "safety $saf"

  kill_bmoe_exact
  wait_cool 80 180

  die_s=$(mc_to_c "$(max_die_mc)")
  batt_s=$(batt_pct)
  log "die_start=$die_s batt_start=$batt_s cold_model..."
  if [ -x "$COLD" ]; then
    "$COLD" "$MODEL" >> "$MASTER" 2>&1 || log "WARN cold_model failed"
  fi

  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb" > "$sampler"
  rm -f "$donef"
  (
    while :; do
      [ -f "$donef" ] && break
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_c=$(mc_to_c "$(max_die_mc)")
      bpid=""
      for pid in $(ls /proc | grep -E '^[0-9]+$'); do
        [ -r "/proc/$pid/cmdline" ] || continue
        cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
        case "$cmd" in *"/bmoe-cli "*) bpid=$pid; break;; esac
      done
      rb=0; rch=0; rss=0
      if [ -n "$bpid" ] && [ -r "/proc/$bpid/io" ]; then
        rb=$(awk '/^read_bytes:/{print $2}' "/proc/$bpid/io")
        rch=$(awk '/^rchar:/{print $2}' "/proc/$bpid/io")
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$bpid/status" 2>/dev/null || echo 0)
      fi
      echo "${now_ms},${die_c},${rb},${rch},${rss}" >> "$sampler"
      if [ -n "$bpid" ] && [ "$(max_die_mc)" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        echo "[$(ts)] THERMAL_KILL die>95 during $tag pid=$bpid" >> "$SAFETY_LOG"
        kill "$bpid" 2>/dev/null || true
        sleep 1
        kill -9 "$bpid" 2>/dev/null || true
      fi
      sleep 0.5
    done
  ) &
  samp_pid=$!

  wall_s=$(date +%s)
  verify_prompt
  # BYTE-IDENTICAL prompt: same STABLE_PROMPT file for both runs
  "$BIN" -m "$MODEL" -t "$THREADS" -c "$N_CTX" -n "$N_PRED" \
    --chatml --no-think --progress --csv "$csvp" \
    --temp 0 \
    --moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap \
    --io-threads "$IO_THREADS" --ubatch "$ubatch" \
    -p "$(cat "$STABLE_PROMPT")" \
    > "$slog" 2> "$serr"
  rc=$?
  wall_e=$(date +%s)
  touch "$donef"
  wait "$samp_pid" 2>/dev/null || true

  {
    echo "===== STDOUT ====="
    cat "$slog"
    echo "===== STDERR ====="
    cat "$serr"
  } > "$outfull"

  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    grep -v BMOE_PROGRESS "$slog" 2>/dev/null | tail -300 > "$genf" || true
  fi

  die_e=$(mc_to_c "$(max_die_mc)")
  batt_e=$(batt_pct)
  die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0} END{print m+0}' "$sampler")
  die_max=$(awk -v a="$die_s" -v b="$die_e" -v c="$die_max" 'BEGIN{m=a+0; if(b+0>m)m=b+0; if(c+0>m)m=c+0; printf "%.1f", m}')

  n_prompt=$(python3 -c '
import re,sys
t=""
for p in sys.argv[1:]:
  try: t+=open(p,encoding="utf-8",errors="replace").read()+"\n"
  except Exception: pass
m=re.search(r"prefill:\s*(\d+)\s*tokens", t)
np=m.group(1) if m else "0"
for line in t.splitlines():
  if "BMOE_DONE" in line:
    mm=re.search(r"\"n_prompt\":([0-9]+)", line)
    if mm: np=mm.group(1)
print(np)
' "$slog" "$serr")

  tokens=$(python3 -c '
import re,sys
t=""
for p in sys.argv[1:]:
  try: t+=open(p,encoding="utf-8",errors="replace").read()+"\n"
  except Exception: pass
m=re.search(r"generation:\s*(\d+)\s*tokens", t)
print(m.group(1) if m else "0")
' "$slog" "$serr")

  {
    echo "cell=$tag"
    echo "mark=$MARK"
    echo "ubatch=$ubatch n_ctx=$N_CTX n_pred=$N_PRED cache_mb=$CACHE_MB temp=0"
    echo "prompt_sha=$SHA"
    echo "n_prompt=$n_prompt tokens=$tokens"
    echo "rc=$rc elapsed=$((wall_e-wall_s))"
    echo "die_start=$die_s die_end=$die_e die_max=$die_max"
    echo "batt_start=$batt_s batt_end=$batt_e"
    echo "prompt_path=$STABLE_PROMPT"
  } > "$meta"

  log "$tag DONE rc=$rc n_prompt=$n_prompt tokens=$tokens die_max=$die_max batt ${batt_s}->${batt_e} elapsed=$((wall_e-wall_s))s"
  if [ "$ubatch" = "512" ]; then
    cp -f "$outfull" "$D1DIR/ubatch512.out"
    cp -f "$genf" "$D1DIR/ubatch512.gen.txt"
  else
    cp -f "$outfull" "$D1DIR/ubatch2048.out"
    cp -f "$genf" "$D1DIR/ubatch2048.gen.txt"
  fi
  return $rc
}

run_one "F5.4-D1-ubatch512" 512
rc1=$?
log "rc1=$rc1 cool before run2..."
wait_cool 80 240

saf=$(safety_check)
if [ $? -ne 0 ]; then
  log "STOP safety before run2: $saf"
  echo "STOPPED run2 $saf $(ts)" > "$STATUS"
  exit 1
fi

verify_prompt
run_one "F5.4-D1-ubatch2048" 2048
rc2=$?
log "rc2=$rc2"

python3 - <<'PY' > "$D1DIR/compare.txt" 2>&1
from pathlib import Path
d = Path("/data/data/com.termux/files/home/experiments/results/f5.4/d1")
def load(p):
    return Path(p).read_text(encoding="utf-8", errors="replace").strip()
a = load(d / "F5.4-D1-ubatch512.gen.txt")
b = load(d / "F5.4-D1-ubatch2048.gen.txt")
a_raw = Path(d / "F5.4-D1-ubatch512.gen.txt").read_text(encoding="utf-8", errors="replace")
b_raw = Path(d / "F5.4-D1-ubatch2048.gen.txt").read_text(encoding="utf-8", errors="replace")
print(f"len_512={len(a)} len_2048={len(b)}")
print(f"len_raw_512={len(a_raw)} len_raw_2048={len(b_raw)}")
print(f"head_512={a[:50]!r}")
print(f"head_2048={b[:50]!r}")
if a == b:
    print("VERDICT=IDENTICAL")
    print("first_diff_at=-1")
else:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    print(f"VERDICT=DIVERGENT first_diff_at={i}")
    lo = max(0, i-40); hi = min(max(len(a), len(b)), i+60)
    print("CTX_512:", repr(a[lo:hi]))
    print("CTX_2048:", repr(b[lo:hi]))
    print(f"match_prefix_chars={i} match_prefix_frac={i/max(n,1):.4f}")
    if i < 20:
        print("WHERE=early_first_tokens")
    elif i < n * 0.5:
        print("WHERE=mid")
    else:
        print("WHERE=late")
for tag in ("F5.4-D1-ubatch512", "F5.4-D1-ubatch2048"):
    meta = (d / f"{tag}.meta.txt").read_text(encoding="utf-8", errors="replace")
    print(f"--- {tag} meta ---")
    print(meta.strip())
PY

log "compare: $(tr '\n' ' | ' < "$D1DIR/compare.txt")"
echo "PHASE_D1_DONE $(ts)" > "$STATUS"
echo "PHASE_D1_DONE $(ts)" > "$D1DIR/STATUS.txt"
log "PHASE D1 done rc1=$rc1 rc2=$rc2"
date +%s > "$D1DIR/ALL.done"
exit 0
