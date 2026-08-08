#!/data/data/com.termux/files/usr/bin/bash
# start_f5_2.sh — F5.2 LE MISURE CHE DECIDONO L'INGEGNERIA
# C1 compute-trace (300/1500) → C2 thermal-vs-context → C3 ngram/mtp → C4 n-expert-used
# Detached via nohup. SSH drop ≠ fail. Safety: die>98C or batt<30% → STOP with cell.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.2}"
mkdir -p "$OUTDIR" "$TMPDIR" \
  "$OUTDIR/c1" "$OUTDIR/c2a" "$OUTDIR/c2b" \
  "$OUTDIR/c3" "$OUTDIR/c4" "$OUTDIR/prompts"
MASTER="$OUTDIR/F5.2.master.log"
PIDFILE="$OUTDIR/f5_2.pid"
STATUS="$OUTDIR/STATUS.txt"
SAFETY_LOG="$OUTDIR/safety.log"
CSV_ALL="$OUTDIR/cells.csv"

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"

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

MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
EXPECTED_SIZE="11522702304"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPT_LONG="${PROMPT_LONG:-$HOME/experiments/prompts/long_conversational_it.txt}"
THREADS=4
CACHE_MB=2000
IO_THREADS=4
BASE_FLAGS="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS}"
DIE_STOP_MC=98000
BATT_STOP=30

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

batt_fields() {
  termux-battery-status 2>/dev/null | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0), d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
}

safety_check() {
  local die_mc batt plugged
  die_mc=$(max_die_mc)
  read -r batt _ _ _ plugged <<<"$(batt_fields)"
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "STOP_DIE:$(mc_to_c "$die_mc")"
    return 1
  fi
  if [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    echo "STOP_BATT:$batt"
    return 1
  fi
  echo "OK:die=$(mc_to_c "$die_mc"):batt=$batt:plugged=$plugged"
  return 0
}

kill_bmoe_exact() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"/bmoe-cli "*|*/bmoe-cli\ --*|*/bmoe-cli\ -m*)
        case "$cmd" in *start_f5_2.sh*) ;; *)
          log "killing residual bmoe pid=$pid"
          kill "$pid" 2>/dev/null || true
          sleep 1
          kill -9 "$pid" 2>/dev/null || true
        ;; esac
        ;;
    esac
  done
  sleep 2
}

wait_cool() {
  local target_c="${1:-55}" max_wait="${2:-180}"
  local t0 now die_mc die_c
  t0=$(date +%s)
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    if awk -v d="$die_c" -v t="$target_c" 'BEGIN{exit !(d+0 <= t+0)}'; then
      log "cool OK die=${die_c}C <= ${target_c}C"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge "$max_wait" ]; then
      log "cool timeout die=${die_c}C after ${max_wait}s"
      return 0
    fi
    sleep 5
  done
}

read_io() {
  local pid=$1
  if [ -r "/proc/$pid/io" ]; then
    awk '/^read_bytes:/{rb=$2} /^rchar:/{rc=$2} END{print rb+0, rc+0}' "/proc/$pid/io"
  else
    echo "0 0"
  fi
}

json_get() {
  local line="$1" key="$2"
  echo "$line" | sed -n "s/.*\"${key}\":\([0-9.-][0-9.eE+-]*\).*/\1/p" | head -1
}

json_get_str() {
  local line="$1" key="$2"
  python3 - "$line" "$key" <<'PY'
import sys,json,re
line,key=sys.argv[1],sys.argv[2]
try:
    raw=line
    for p in ("BMOE_DONE ","BMOE_ERROR ","BMOE_PROGRESS "):
        if raw.startswith(p):
            raw=raw[len(p):]
    obj=json.loads(raw)
    v=obj.get(key,"")
    if isinstance(v,(dict,list)):
        print(json.dumps(v,ensure_ascii=False))
    else:
        print(v)
except Exception:
    m=re.search(r'"%s"\s*:\s*"((?:\\.|[^"\\])*)"'%re.escape(key), line)
    if m:
        print(m.group(1).encode("utf-8").decode("unicode_escape"))
PY
}

if [ "${1:-}" = "--detach" ]; then
  shift
  nohup setsid bash "$0" --run "$@" >"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_2.sh --detach"
  exit 2
fi
shift || true

echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$SAFETY_LOG"
echo "RUNNING $(ts)" > "$STATUS"
echo "cell,tag,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rb_delta,rchar_delta,rss_end_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,mtp_drafted,mtp_accepted,mtp_decodes,drafted_steps,accept_pct,extra,stopped_reason,notes" > "$CSV_ALL"

log "=== F5.2 START pid=$$ ==="
log "bin=$BIN model=$MODEL"

if [ ! -x "$BIN" ]; then log "FATAL: binary missing"; echo "FATAL_NO_BIN" > "$STATUS"; exit 2; fi
SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE" ]; then log "FATAL: model size $SZ"; echo "FATAL_SIZE" > "$STATUS"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL: nproc=$NPROC"; echo "FATAL_NPROC" > "$STATUS"; exit 2; fi
CPUSET=$(cat /proc/self/cpuset 2>/dev/null || echo "?")
log "nproc=$NPROC cpuset=$CPUSET"

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

HELP=$("$BIN" --help 2>&1 || true)
DROP_OK=0
echo "$HELP" | grep -q -- "--drop-cold-experts" && DROP_OK=1
echo "$DROP_OK" > "$OUTDIR/drop_cold_exists.txt"
for f in compute-trace compute-trace-layers n-expert-used mtp ngram draft drop-cold-experts; do
  if echo "$HELP" | grep -q -- "--$f"; then log "FLAG_OK --$f"; else log "FLAG_MISS --$f"; fi
done

BATT_JSON=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_JSON" > "$OUTDIR/batt_start.json"
log "battery_start: $BATT_JSON"
saf=$(safety_check) || { log "FATAL safety: $saf"; echo "FATAL_SAFETY $saf" > "$STATUS"; exit 2; }
log "safety $saf"
kill_bmoe_exact

python3 - <<'PY' > "$OUTDIR/prompts/c1_short.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. "
text = instr + (" " + base) * 4
print(text[:1100])
PY

python3 - <<'PY' > "$OUTDIR/prompts/c1_long.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. Continua il racconto. "
text = instr + (" " + base) * 20
print(text[:5200])
PY

P1='Ciao! Sto pianificando un viaggio di 7 giorni in Sicilia partendo da Milano a meta settembre. Budget circa 1200 euro a persona, volo incluso. Preferisco mare e un po di cultura, niente resort tutto incluso. Dammi una bozza di itinerario giorno per giorno, realistica sui tempi di spostamento. Rispondi in italiano, max 250 parole.'
P2='Grazie. Sulla base di quello che hai proposto, concentriamoci sui primi 3 giorni: dove dormiresti (fascia 70-100 euro/notte) e quale mezzo useresti tra Catania e le altre tappe? Voglio alternative concrete, non generiche. Sempre in italiano, max 250 parole.'
P3='Ok, tengo la tua idea sul mezzo. Pero ho un vincolo nuovo: viaggio con un bambino di 6 anni, quindi niente tappe troppo lunghe in auto e mi serve almeno una spiaggia balneabile facile. Come rivedi i primi 3 giorni? Cita esplicitamente cosa cambi rispetto a prima. Italiano, max 250 parole.'
P4='Perfetto. Ora il budget: spezzami i 1200 euro a persona (volo, alloggio 6 notti, cibo, spostamenti, attivita) con stime plausibili basate sull itinerario rivisto. Se sforiamo, dimmi dove tagliare senza rovinare il viaggio col bambino. Italiano, max 250 parole.'
P5='Sul cibo: proponi 4 posti (anche semplici) coerenti con le tappe che hai scelto, uno per zona, con cosa ordinare di tipico e una fascia di prezzo a persona. Niente catene internazionali. Italiano, max 250 parole.'
cp "$PROMPT_LONG" "$OUTDIR/prompts/c3.txt"
printf '%s\n' "$P1" > "$OUTDIR/prompts/c4.txt"

run_oneshot() {
  local cell="$1" sub="$2" extra="$3" n_ctx="$4" n_pred="$5" pfile="$6"
  local do_cold="${7:-1}"
  local odir="$OUTDIR/$sub"
  mkdir -p "$odir"
  local slog="$odir/${cell}.stdout.log"
  local serr="$odir/${cell}.stderr.log"
  local csvp="$odir/${cell}.metrics.csv"
  local genf="$odir/${cell}.gen.txt"
  local meta="$odir/${cell}.meta.txt"
  local donef="$odir/${cell}.done"
  rm -f "$donef"

  log "==== CELL $cell oneshot n_ctx=$n_ctx n_pred=$n_pred extra=[$extra] ===="
  echo "CELL $cell" > "$STATUS"

  local saf
  saf=$(safety_check) || {
    log "STOP safety before $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    echo "$cell,$cell,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,,,$saf,safety" >> "$CSV_ALL"
    return 1
  }
  log "safety $saf"
  kill_bmoe_exact
  if [ "$do_cold" = "1" ]; then
    log "cold_model $MODEL"
    "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || log "WARN cold_model failed"
  fi

  local die_s_mc die_s_c batt_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ _ <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  local sampler_log="$odir/${cell}.sampler.csv"
  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb" > "$sampler_log"
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
      rb=0; rc=0; rss=0
      if [ -n "$bpid" ] && [ -r "/proc/$bpid/io" ]; then
        rb=$(awk '/^read_bytes:/{print $2}' "/proc/$bpid/io")
        rc=$(awk '/^rchar:/{print $2}' "/proc/$bpid/io")
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$bpid/status" 2>/dev/null || echo 0)
      fi
      echo "${now_ms},${die_c},${rb},${rc},${rss}" >> "$sampler_log"
      sleep 0.5
    done
  ) &
  local samp_pid=$!

  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$MODEL" -t "$THREADS" -c "$n_ctx" -n "$n_pred" \
    --chatml --no-think --progress --csv "$csvp" \
    $BASE_FLAGS $extra \
    -p "$(cat "$pfile")" \
    > "$slog" 2> "$serr"
  local rc_bin=$?
  set -e
  touch "$donef"
  wait "$samp_pid" 2>/dev/null || true

  local wall_e wall_e_epoch elapsed die_e_mc die_e_c batt_e
  wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch - wall_s_epoch))
  die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
  read -r batt_e _ _ _ _ <<<"$(batt_fields)"

  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    grep -v BMOE_PROGRESS "$slog" 2>/dev/null | tail -200 > "$genf" || true
  fi

  local tok_s=0 tokens=0 compute_s_tok=0 io_s_tok=0 stall_s_tok=0 read_mib=0 mib_tok=0
  local prefill_s=0 cache_hit=-1 n_prompt=0 n_past=0
  local mtp_d=0 mtp_a=0 mtp_dec=0 drafted_steps=0 accept_pct=0

  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(grep -oE '\([0-9.]+ tok/s\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(grep -oE 'compute [0-9.]+ \+ cache' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(grep -oE 'flash I/O [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  read_mib=$(grep -oE 'read [0-9.]+ MiB' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(grep -oE '\([0-9.]+ MiB/token\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(grep -oE 'moe-cache: [0-9.]+% hit' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  if [ "$tok_s" = "0" ] || [ -z "$tok_s" ]; then
    tok_s=$(grep -oE '[0-9.]+ tok/s' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
    tok_s=${tok_s:-0}
  fi
  local acc_line
  acc_line=$(grep -E 'drafts accepted' "$slog" "$serr" 2>/dev/null | head -1 || true)
  if [ -n "$acc_line" ]; then
    mtp_a=$(echo "$acc_line" | grep -oE '[0-9]+/[0-9]+' | head -1 | cut -d/ -f1)
    mtp_d=$(echo "$acc_line" | grep -oE '[0-9]+/[0-9]+' | head -1 | cut -d/ -f2)
    accept_pct=$(echo "$acc_line" | grep -oE '\([0-9.]+%\)' | head -1 | tr -dc '0-9.')
  fi
  mtp_dec=$(grep -oE '[0-9]+ decodes for' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
  mtp_dec=${mtp_dec:-0}
  drafted_steps=$(grep -oE 'drafted on [0-9]+ of' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  drafted_steps=${drafted_steps:-0}

  local lastprog
  lastprog=$(grep BMOE_PROGRESS "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$lastprog" ]; then
    n_past=$(json_get "$lastprog" n_past); n_past=${n_past:-0}
    local pt; pt=$(json_get "$lastprog" tokens); [ -n "$pt" ] && [ "$pt" != "0" ] && tokens=$pt
    local pts; pts=$(json_get "$lastprog" tok_s); [ -n "$pts" ] && [ "$pts" != "0" ] && tok_s=$pts
    local pcs; pcs=$(json_get "$lastprog" compute_s_tok); [ -n "$pcs" ] && compute_s_tok=$pcs
    local pis; pis=$(json_get "$lastprog" io_s_tok); [ -n "$pis" ] && io_s_tok=$pis
    local pss; pss=$(json_get "$lastprog" stall_s_tok); [ -n "$pss" ] && stall_s_tok=$pss
    local prm; prm=$(json_get "$lastprog" read_mib); [ -n "$prm" ] && read_mib=$prm
    local pch; pch=$(json_get "$lastprog" cache_hit_pct); [ -n "$pch" ] && cache_hit=$pch
  fi
  if [ "${mib_tok:-0}" = "0" ] && [ "${tokens:-0}" != "0" ] && [ "${read_mib:-0}" != "0" ]; then
    mib_tok=$(python3 -c "print(round(float('$read_mib')/max(float('$tokens'),1),3))")
  fi

  local die_max_c
  die_max_c=$(awk -F, 'NR>1{if($2+0>m)m=$2+0} END{printf "%.1f", m+0}' "$sampler_log")
  die_max_c=$(python3 -c "print(max(float('$die_s_c'),float('$die_e_c'),float('${die_max_c:-0}')))")

  local rb_delta rchar_delta rss_end
  rb_delta=$(awk -F, 'NR==2{s=$3} END{if(NR>1) print ($3+0)-(s+0); else print 0}' "$sampler_log")
  rchar_delta=$(awk -F, 'NR==2{s=$4} END{if(NR>1) print ($4+0)-(s+0); else print 0}' "$sampler_log")
  rss_end=$(awk -F, 'END{print $5+0}' "$sampler_log")

  local stopped="ok"
  [ $rc_bin -ne 0 ] && stopped="bin_rc_$rc_bin"

  {
    echo "cell=$cell"
    echo "rc=$rc_bin elapsed_s=$elapsed"
    echo "die_start=$die_s_c die_end=$die_e_c die_max=$die_max_c"
    echo "batt $batt_s -> $batt_e"
    echo "tokens=$tokens tok_s=$tok_s compute_s_tok=$compute_s_tok io_s_tok=$io_s_tok stall_s_tok=$stall_s_tok"
    echo "read_mib=$read_mib mib_tok=$mib_tok cache_hit=$cache_hit n_past=$n_past"
    echo "mtp_drafted=$mtp_d mtp_accepted=$mtp_a mtp_decodes=$mtp_dec drafted_steps=$drafted_steps accept_pct=$accept_pct"
    echo "extra=$extra"
  } > "$meta"

  log "CELL $cell DONE tok_s=$tok_s compute=$compute_s_tok mib_tok=$mib_tok accept=$accept_pct die ${die_s_c}->${die_e_c} max=$die_max_c batt ${batt_s}->${batt_e} rc=$rc_bin"

  echo "$cell,$cell,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$mib_tok,$rb_delta,$rchar_delta,$rss_end,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$mtp_d,$mtp_a,$mtp_dec,$drafted_steps,$accept_pct,$extra,$stopped,oneshot" >> "$CSV_ALL"

  saf=$(safety_check) || {
    log "STOP safety after $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    return 1
  }
  return 0
}

run_session_turns() {
  local cell_prefix="$1" sub="$2" mode="$3" n_turns="${4:-5}"
  local odir="$OUTDIR/$sub"
  mkdir -p "$odir"
  local SESSION_LOG="$odir/session.stdout.log"
  local SESSION_ERR="$odir/session.stderr.log"
  local TURNS_CSV="$odir/turns.csv"
  local CONV_TXT="$odir/conversation_full.txt"
  local REQ_FIFO="$odir/req.fifo"
  local SAMPLER_LOG="$odir/sampler_500ms.csv"
  local N_CTX=4096
  local N_PREDICT=256

  log "==== SESSION $cell_prefix mode=$mode turns=$n_turns ===="
  echo "CELL $cell_prefix" > "$STATUS"

  local saf
  saf=$(safety_check) || { log "STOP safety: $saf"; echo "STOPPED $cell_prefix $saf $(ts)" > "$STATUS"; return 1; }
  kill_bmoe_exact
  log "cold_model for $cell_prefix"
  "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || log "WARN cold failed"

  : > "$SESSION_LOG"
  : > "$SESSION_ERR"
  : > "$CONV_TXT"
  echo "turn,tag,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,rb_delta,die_start_c,die_end_c,die_max_c,batt_start,batt_end,stopped_reason" > "$TURNS_CSV"
  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb,phase" > "$SAMPLER_LOG"
  rm -f "$REQ_FIFO"
  mkfifo "$REQ_FIFO"

  # shellcheck disable=SC2086
  "$BIN" -m "$MODEL" -t "$THREADS" -c "$N_CTX" -n "$N_PREDICT" \
    --chatml --no-think --progress $BASE_FLAGS --session \
    < "$REQ_FIFO" > "$SESSION_LOG" 2> "$SESSION_ERR" &
  local BMOE_PID=$!
  echo "$BMOE_PID" > "$odir/bmoe.pid"
  log "bmoe session pid=$BMOE_PID"
  exec 3>"$REQ_FIFO"

  (
    while kill -0 "$BMOE_PID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_c=$(mc_to_c "$(max_die_mc)")
      rb=0; rc=0; rss=0
      if [ -r "/proc/$BMOE_PID/io" ]; then
        rb=$(awk '/^read_bytes:/{print $2}' "/proc/$BMOE_PID/io")
        rc=$(awk '/^rchar:/{print $2}' "/proc/$BMOE_PID/io")
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BMOE_PID/status")
      fi
      phase=$(cat "$odir/phase.txt" 2>/dev/null || echo "?")
      echo "${now_ms},${die_c},${rb},${rc},${rss},${phase}" >> "$SAMPLER_LOG"
      sleep 0.5
    done
  ) &
  local SAMP=$!
  echo "$SAMP" > "$odir/sampler.pid"

  log "waiting BMOE_READY..."
  echo "load" > "$odir/phase.txt"
  local t0 now
  t0=$(date +%s)
  while :; do
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      log "FATAL bmoe died load"; echo "FATAL_LOAD $cell_prefix" > "$STATUS"; return 1
    fi
    if grep -q BMOE_READY "$SESSION_LOG" 2>/dev/null; then break; fi
    if grep -q BMOE_ERROR "$SESSION_LOG" 2>/dev/null; then
      log "FATAL load error"; grep BMOE_ERROR "$SESSION_LOG" | head -3 >> "$MASTER"
      echo "FATAL_LOAD_ERR $cell_prefix" > "$STATUS"; return 1
    fi
    now=$(date +%s)
    if [ $((now-t0)) -gt 900 ]; then log "FATAL ready timeout"; echo "FATAL_READY $cell_prefix" > "$STATUS"; return 1; fi
    sleep 1
  done
  log "READY $cell_prefix"

  local prompts=("$P1" "$P2" "$P3" "$P4" "$P5")
  local turn
  for turn in $(seq 1 "$n_turns"); do
    saf=$(safety_check) || {
      log "STOP safety mid-session $cell_prefix T$turn: $saf"
      echo "STOPPED $cell_prefix T$turn $saf $(ts)" > "$STATUS"
      exec 3>&- || true
      kill "$BMOE_PID" 2>/dev/null || true
      wait "$SAMP" 2>/dev/null || true
      return 1
    }
    local prompt="${prompts[$((turn-1))]}"
    local clear_kv="false"
    if [ "$mode" = "truncated" ]; then clear_kv="true"; fi
    local cell="${cell_prefix}-T${turn}"
    log "---- $cell clear_kv=$clear_kv ----"
    echo "turn${turn}" > "$odir/phase.txt"

    local die_s_mc die_s_c batt_s wall_s wall_s_epoch rb_s rchar_s
    die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
    read -r batt_s _ _ _ _ <<<"$(batt_fields)"
    read -r rb_s rchar_s <<<"$(read_io "$BMOE_PID")"
    wall_s=$(ts); wall_s_epoch=$(date +%s)

    local esc req
    esc=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")' <<<"$prompt")
    req=$(printf '{"cmd":"generate","id":%d,"prompt":%s,"n_predict":%d,"think":false,"clear_kv":%s}' \
      "$turn" "$esc" "$N_PREDICT" "$clear_kv")
    printf '%s\n' "$req" >&3

    local done_line="" rc=0
    t0=$(date +%s)
    while :; do
      if ! kill -0 "$BMOE_PID" 2>/dev/null; then done_line="DEAD"; rc=1; break; fi
      if grep -E "BMOE_DONE \{\"id\":${turn}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        done_line=$(grep -E "BMOE_DONE \{\"id\":${turn}[,}]" "$SESSION_LOG" | tail -1)
        rc=0; break
      fi
      if grep -E "BMOE_ERROR \{\"id\":${turn}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        done_line=$(grep -E "BMOE_ERROR \{\"id\":${turn}[,}]" "$SESSION_LOG" | tail -1)
        rc=2; break
      fi
      now=$(date +%s)
      if [ $((now-t0)) -gt 2400 ]; then done_line="TIMEOUT"; rc=3; break; fi
      sleep 0.5
    done

    local wall_e wall_e_epoch elapsed die_e_mc die_e_c batt_e rb_e rchar_e
    wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch-wall_s_epoch))
    die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
    read -r batt_e _ _ _ _ <<<"$(batt_fields)"
    read -r rb_e rchar_e <<<"$(read_io "$BMOE_PID")"
    local rb_d=$((rb_e - rb_s))

    local n_prompt=0 n_past=0 tokens=0 tok_s=0 prefill_s=0 cache_hit=-1
    local compute_s_tok=0 io_s_tok=0 stall_s_tok=0 read_mib=0 text=""
    local stopped="ok"
    if [ $rc -ne 0 ]; then
      stopped="wait_rc_$rc"
      log "$cell FAIL $done_line"
    else
      n_prompt=$(json_get "$done_line" n_prompt); n_prompt=${n_prompt:-0}
      n_past=$(json_get "$done_line" n_past); n_past=${n_past:-0}
      tokens=$(json_get "$done_line" tokens); tokens=${tokens:-0}
      tok_s=$(json_get "$done_line" tok_s); tok_s=${tok_s:-0}
      prefill_s=$(json_get "$done_line" prefill_s); prefill_s=${prefill_s:-0}
      cache_hit=$(json_get "$done_line" cache_hit_pct); cache_hit=${cache_hit:--1}
      compute_s_tok=$(json_get "$done_line" compute_s_tok); compute_s_tok=${compute_s_tok:-0}
      io_s_tok=$(json_get "$done_line" io_s_tok); io_s_tok=${io_s_tok:-0}
      stall_s_tok=$(json_get "$done_line" stall_s_tok); stall_s_tok=${stall_s_tok:-0}
      read_mib=$(json_get "$done_line" read_mib); read_mib=${read_mib:-0}
      text=$(json_get_str "$done_line" text)
      log "$cell DONE n_prompt=$n_prompt n_past=$n_past tok_s=$tok_s compute=$compute_s_tok die ${die_s_c}->${die_e_c}"
      {
        echo "===== TURNO $turn ====="
        echo "USER: $prompt"
        echo "ASSISTANT: $text"
        echo "META: n_prompt=$n_prompt n_past=$n_past tokens=$tokens tok_s=$tok_s compute_s_tok=$compute_s_tok"
        echo
      } >> "$CONV_TXT"
      echo "$done_line" >> "$odir/done_lines.jsonl"
    fi

    local die_max_c
    die_max_c=$(awk -F, -v s="$wall_s_epoch" 'NR>1{t=int($1/1000); if(t+0>=s-1){if($2+0>m)m=$2+0}} END{printf "%.1f", m+0}' "$SAMPLER_LOG")
    die_max_c=$(python3 -c "print(max(float('$die_s_c'),float('$die_e_c'),float('${die_max_c:-0}')))")

    echo "$turn,$cell,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$rb_d,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$stopped" >> "$TURNS_CSV"
    echo "$cell,$cell,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,0,$rb_d,0,0,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,0,0,0,0,0,mode=$mode,$stopped,session" >> "$CSV_ALL"

    if [ $rc -ne 0 ]; then break; fi
  done

  printf '%s\n' '{"cmd":"shutdown"}' >&3 2>/dev/null || true
  exec 3>&- || true
  sleep 2
  if kill -0 "$BMOE_PID" 2>/dev/null; then
    kill "$BMOE_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$BMOE_PID" 2>/dev/null || true
  fi
  wait "$SAMP" 2>/dev/null || true
  log "session $cell_prefix closed"
  return 0
}

log "======== C1 BEGIN ========"
run_oneshot "F5.2-C1-300-node" "c1" "--compute-trace $OUTDIR/c1/ct_300_node.csv" 1024 48 "$OUTDIR/prompts/c1_short.txt" 1 || log "C1-300-node fail"
wait_cool 58 120
run_oneshot "F5.2-C1-300-layers" "c1" "--compute-trace-layers $OUTDIR/c1/ct_300_layers.csv" 1024 48 "$OUTDIR/prompts/c1_short.txt" 0 || log "C1-300-layers fail"
wait_cool 58 120
run_oneshot "F5.2-C1-1500-node" "c1" "--compute-trace $OUTDIR/c1/ct_1500_node.csv" 2048 32 "$OUTDIR/prompts/c1_long.txt" 1 || log "C1-1500-node fail"
wait_cool 58 150
run_oneshot "F5.2-C1-1500-layers" "c1" "--compute-trace-layers $OUTDIR/c1/ct_1500_layers.csv" 2048 32 "$OUTDIR/prompts/c1_long.txt" 0 || log "C1-1500-layers fail"
log "======== C1 END ========"
wait_cool 55 180

log "======== C2a GROWING BEGIN ========"
run_session_turns "F5.2-C2a" "c2a" "growing" 5 || log "C2a stopped"
log "======== C2a END ========"
wait_cool 55 180

log "======== C2b TRUNCATED BEGIN ========"
run_session_turns "F5.2-C2b" "c2b" "truncated" 5 || log "C2b stopped"
log "======== C2b END ========"
wait_cool 55 180

log "======== C3 BEGIN ========"
run_oneshot "F5.2-C3-baseline" "c3" "" 2048 128 "$OUTDIR/prompts/c3.txt" 1 || log "C3-baseline fail"
wait_cool 58 120
run_oneshot "F5.2-C3-ngram3" "c3" "--ngram --draft 3" 2048 128 "$OUTDIR/prompts/c3.txt" 0 || log "C3-ngram3 fail"
wait_cool 58 120
run_oneshot "F5.2-C3-ngram5" "c3" "--ngram --draft 5" 2048 128 "$OUTDIR/prompts/c3.txt" 0 || log "C3-ngram5 fail"
wait_cool 58 120
run_oneshot "F5.2-C3-mtp3" "c3" "--mtp --draft 3" 2048 128 "$OUTDIR/prompts/c3.txt" 0 || log "C3-mtp3 fail"
log "======== C3 END ========"
wait_cool 55 150

log "======== C4 BEGIN ========"
run_oneshot "F5.2-C4-k8" "c4" "--n-expert-used 8" 2048 256 "$OUTDIR/prompts/c4.txt" 1 || log "C4-k8 fail"
wait_cool 58 120
run_oneshot "F5.2-C4-k6" "c4" "--n-expert-used 6" 2048 256 "$OUTDIR/prompts/c4.txt" 0 || log "C4-k6 fail"
wait_cool 58 120
run_oneshot "F5.2-C4-k4" "c4" "--n-expert-used 4" 2048 256 "$OUTDIR/prompts/c4.txt" 0 || log "C4-k4 fail"
if [ "$DROP_OK" = "1" ]; then
  wait_cool 58 120
  run_oneshot "F5.2-C4-drop05" "c4" "--drop-cold-experts 0.5" 2048 256 "$OUTDIR/prompts/c4.txt" 0 || log "C4-drop05 fail"
  wait_cool 58 120
  run_oneshot "F5.2-C4-drop10" "c4" "--drop-cold-experts 1.0" 2048 256 "$OUTDIR/prompts/c4.txt" 0 || log "C4-drop10 fail"
else
  log "C4: --drop-cold-experts ABSENT; skipped"
  echo "ABSENT" > "$OUTDIR/c4/drop_cold_status.txt"
fi
log "======== C4 END ========"

BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_END" > "$OUTDIR/batt_end.json"
DIE_END=$(max_die_mc)
log "FINAL die=$(mc_to_c "$DIE_END") batt=$BATT_END"
echo "DONE $(ts) die=$(mc_to_c "$DIE_END")" > "$STATUS"
log "=== F5.2 COMPLETE ==="
