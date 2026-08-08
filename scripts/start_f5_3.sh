#!/data/data/com.termux/files/usr/bin/bash
# start_f5_3.sh — F5.3 TRE COSE CHE SONO DIVENTATE POSSIBILI OGGI
# A: sessione 10 turni --ubatch 512 n_ctx 8192 + cur_freq
# B: Q4_0 vs Q4_K_M su LFM2-8B-A1B (kernel GEMM)
# C: sweep cache-mb 2000/2500/3000/3500 con --ubatch 512
# Detached via nohup. SSH drop ≠ fail. Safety: die>98C o batt<30% → STOP.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.3}"
mkdir -p "$OUTDIR" "$TMPDIR" \
  "$OUTDIR/a" "$OUTDIR/b" "$OUTDIR/c" "$OUTDIR/prompts"
MASTER="$OUTDIR/F5.3.master.log"
PIDFILE="$OUTDIR/f5_3.pid"
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

MODEL35="${MODEL35:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
EXPECTED_SIZE35="11522702304"
MODEL_Q40="${MODEL_Q40:-$HOME/models/LFM2-8B-A1B-Q4_0.gguf}"
MODEL_Q4KM="${MODEL_Q4KM:-$HOME/models/LFM2-8B-A1B-Q4_K_M.gguf}"
EXPECTED_Q40="4733893312"
EXPECTED_Q4KM="5044779712"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPT_LONG="${PROMPT_LONG:-$HOME/experiments/prompts/long_conversational_it.txt}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"

THREADS=4
IO_THREADS=4
CACHE_MB_BASE=2000
DIE_STOP_MC=98000
BATT_STOP=30

# A params
A_N_CTX=8192
A_N_PRED=256
A_UBATCH=512
A_N_TURNS=10
A_CACHE_MB=2000

# B params (LFM2 small MoE)
B_N_CTX=2048
B_N_PRED=128
B_CACHE_MB=400
B_UBATCH=256
B_N_REP=3
B_SENTINEL=1

# C params
C_N_CTX=4096
C_N_PRED=256
C_UBATCH=512
C_N_REP=2
C_CACHES="2000 2500 3000 3500"

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
        case "$cmd" in *start_f5_3.sh*) ;; *)
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
  local target_c="${1:-55}" max_wait="${2:-120}"
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

read_rss() {
  local pid=$1
  if [ -r "/proc/$pid/status" ]; then
    awk '/^VmRSS:/{print $2+0}' "/proc/$pid/status"
  else
    echo 0
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

json_escape_prompt() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")' <<<"$1"
}

# ── detach entry ──
if [ "${1:-}" = "--detach" ]; then
  shift
  nohup setsid bash "$0" --run "$@" >"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_3.sh --detach"
  exit 2
fi
shift || true

echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$SAFETY_LOG"
echo "RUNNING $(ts)" > "$STATUS"
echo "cell,tag,phase,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rb_delta,rss_end_kb,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,extra,stopped_reason,notes" > "$CSV_ALL"

log "=== F5.3 START pid=$$ ==="
log "bin=$BIN runtime_commit=$RUNTIME_COMMIT"
log "model35=$MODEL35 q40=$MODEL_Q40 q4km=$MODEL_Q4KM"

if [ ! -x "$BIN" ]; then log "FATAL: binary missing"; echo "FATAL_NO_BIN" > "$STATUS"; exit 2; fi
SZ=$(stat -c%s "$MODEL35" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE35" ]; then log "FATAL: model35 size $SZ"; echo "FATAL_SIZE35" > "$STATUS"; exit 2; fi
SZ40=$(stat -c%s "$MODEL_Q40" 2>/dev/null || echo 0)
SZKM=$(stat -c%s "$MODEL_Q4KM" 2>/dev/null || echo 0)
if [ "$SZ40" != "$EXPECTED_Q40" ]; then log "FATAL: q40 size $SZ40"; echo "FATAL_SIZE_Q40" > "$STATUS"; exit 2; fi
if [ "$SZKM" != "$EXPECTED_Q4KM" ]; then log "FATAL: q4km size $SZKM"; echo "FATAL_SIZE_Q4KM" > "$STATUS"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL: nproc=$NPROC"; echo "FATAL_NPROC" > "$STATUS"; exit 2; fi
CPUSET=$(cat /proc/self/cpuset 2>/dev/null || echo "?")
log "nproc=$NPROC cpuset=$CPUSET"

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

HELP=$("$BIN" --help 2>&1 || true)
for f in ubatch session compute-trace compute-trace-layers cache-mb moe-stream; do
  if echo "$HELP" | grep -q -- "--$f"; then log "FLAG_OK --$f"; else log "FLAG_MISS --$f"; fi
done

# verify cur_freq readable
for c in 0 3 5 7; do
  if [ -r "/sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq" ]; then
    log "FREQ_OK cpu$c=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq)"
  else
    log "FREQ_MISS cpu$c"
  fi
done

BATT_JSON=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_JSON" > "$OUTDIR/batt_start.json"
log "battery_start: $BATT_JSON"
saf=$(safety_check) || { log "FATAL safety: $saf"; echo "FATAL_SAFETY $saf" > "$STATUS"; exit 2; }
log "safety $saf"
kill_bmoe_exact

# long prompt for C (and B)
python3 - <<'PY' > "$OUTDIR/prompts/long_it.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. Continua il racconto in modo dettagliato. "
text = instr + (" " + base) * 12
print(text[:4500])
PY
python3 - <<'PY' > "$OUTDIR/prompts/b_prompt.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. "
text = instr + (" " + base) * 6
print(text[:2200])
PY

# ═══════════════════════════════════════════════════════════════
# PHASE A — conversazione 10 turni, ubatch 512, n_ctx 8192
# ═══════════════════════════════════════════════════════════════
run_phase_a() {
  local AOUT="$OUTDIR/a"
  local SESSION_LOG="$AOUT/session.stdout.log"
  local SESSION_ERR="$AOUT/session.stderr.log"
  local SAMPLER_LOG="$AOUT/sampler_500ms.csv"
  local TURNS_CSV="$AOUT/turns.csv"
  local CONV_TXT="$AOUT/conversation_full.txt"
  local REQ_FIFO="$AOUT/req.fifo"
  local PHASE_FILE="$AOUT/phase.txt"

  : > "$CONV_TXT"
  : > "$SESSION_LOG"
  : > "$SESSION_ERR"
  echo "turn,cell,tag,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,ttft_s,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,cache_resident_mib,rb_delta,rss_start_kb,rss_end_kb,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_pct_start,batt_pct_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,stopped_reason,notes" > "$TURNS_CSV"
  echo "ts_epoch_ms,ts_iso,pid,alive,die_max_c,read_bytes,rchar,vmrss_kb,memfree_kb,cur_freq0,cur_freq3,cur_freq5,cur_freq7,phase" > "$SAMPLER_LOG"

  local P1 P2 P3 P4 P5 P6 P7 P8 P9 P10
  P1='Ciao! Sto pianificando un viaggio di 7 giorni in Sicilia partendo da Milano a meta settembre. Budget circa 1200 euro a persona, volo incluso. Preferisco mare e un po di cultura, niente resort tutto incluso. Dammi una bozza di itinerario giorno per giorno, realistica sui tempi di spostamento. Rispondi in italiano, max 250 parole.'
  P2='Grazie. Sulla base di quello che hai proposto, concentriamoci sui primi 3 giorni: dove dormiresti (fascia 70-100 euro/notte) e quale mezzo useresti tra Catania e le altre tappe? Voglio alternative concrete, non generiche. Sempre in italiano, max 250 parole.'
  P3='Ok, tengo la tua idea sul mezzo. Pero ho un vincolo nuovo: viaggio con un bambino di 6 anni, quindi niente tappe troppo lunghe in auto e mi serve almeno una spiaggia balneabile facile. Come rivedi i primi 3 giorni? Cita esplicitamente cosa cambi rispetto a prima. Italiano, max 250 parole.'
  P4='Perfetto. Ora il budget: spezzami i 1200 euro a persona (volo, alloggio 6 notti, cibo, spostamenti, attivita) con stime plausibili basate sull itinerario rivisto. Se sforiamo, dimmi dove tagliare senza rovinare il viaggio col bambino. Italiano, max 250 parole.'
  P5='Sul cibo: proponi 4 posti (anche semplici) coerenti con le tappe che hai scelto, uno per zona, con cosa ordinare di tipico e una fascia di prezzo a persona. Niente catene internazionali. Italiano, max 250 parole.'
  P6='Torna un attimo sull itinerario completo dei 7 giorni: tieni i vincoli (bambino, budget, no resort) e scrivi solo l elenco giorno-citta-focus in forma compatta, poi 3 rischi concreti (meteo, scioperi, code) con un piano B ciascuno. Italiano, max 250 parole.'
  P7='Supponiamo che il giorno 4 piova forte come nel piano B. Riscrivi SOLO il giorno 4 e il 5 in versione indoor/cultura, restando nella stessa area geografica che avevi scelto. Non ricominciare da capo. Italiano, max 250 parole.'
  P8='Chiudi: dammi una checklist di prenotazioni da fare entro 10 giorni (volo, hotel, auto/treno, attivita) in ordine di priorita, riferendoti alle scelte concrete di questa conversazione (citta e mezzi che abbiamo fissato). Italiano, max 250 parole.'
  P9='Aggiungi un piano per il giorno di ritorno a Milano: orari realistici, bagaglio, e un buffer se il volo e da Catania o Palermo. Tieni presente il bambino e il budget residuo che hai stimato. Italiano, max 250 parole.'
  P10='Ultima richiesta: riassumi in 8 bullet le decisioni ferme di questa chat (tappe, alloggi, mezzi, budget, cibo, piano B pioggia, checklist, ritorno) senza introdurre citta nuove. Italiano, max 250 parole.'

  log "==== PHASE A start ubatch=$A_UBATCH n_ctx=$A_N_CTX n_turns=$A_N_TURNS ===="
  echo "PHASE_A $(ts)" > "$STATUS"

  saf=$(safety_check) || { log "STOP safety before A: $saf"; echo "STOPPED A $saf $(ts)" > "$STATUS"; return 1; }
  log "safety_pre_A: $saf"
  kill_bmoe_exact

  log "cold_model $MODEL35"
  if ! "$COLD_MODEL_SH" "$MODEL35" >> "$MASTER" 2>&1; then
    log "FATAL: cold_model failed"; echo "FATAL_COLD_A" > "$STATUS"; return 2
  fi
  log "cold_model OK"

  local FLAGS="--moe-stream --cache-mb ${A_CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${A_UBATCH}"
  local SESSION_FLAGS="-m $MODEL35 -t $THREADS -c $A_N_CTX -n $A_N_PRED --chatml --no-think $FLAGS --session"
  log "flags: $SESSION_FLAGS"

  rm -f "$REQ_FIFO"
  mkfifo "$REQ_FIFO"

  # shellcheck disable=SC2086
  "$BIN" $SESSION_FLAGS < "$REQ_FIFO" > "$SESSION_LOG" 2> "$SESSION_ERR" &
  local BMOE_PID=$!
  echo "$BMOE_PID" > "$AOUT/bmoe.pid"
  log "bmoe pid=$BMOE_PID"
  exec 3>"$REQ_FIFO"

  # sampler with cur_freq
  echo "load" > "$PHASE_FILE"
  (
    while kill -0 "$BMOE_PID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      now_iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      die_c=$(mc_to_c "$(max_die_mc)")
      if [ -r "/proc/$BMOE_PID/io" ]; then
        rb=$(awk '/^read_bytes:/{print $2}' "/proc/$BMOE_PID/io")
        rc=$(awk '/^rchar:/{print $2}' "/proc/$BMOE_PID/io")
      else
        rb=0; rc=0
      fi
      if [ -r "/proc/$BMOE_PID/status" ]; then
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BMOE_PID/status")
      else
        rss=0
      fi
      memfree=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f3=$(cat /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f5=$(cat /sys/devices/system/cpu/cpu5/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      phase=$(cat "$PHASE_FILE" 2>/dev/null || echo "?")
      alive=1
      kill -0 "$BMOE_PID" 2>/dev/null || alive=0
      echo "${now_ms},${now_iso},${BMOE_PID},${alive},${die_c},${rb},${rc},${rss},${memfree},${f0},${f3},${f5},${f7},${phase}" >> "$SAMPLER_LOG"
      if [ "$(max_die_mc)" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        echo "[$(ts)] SAMPLER die > stop" >> "$SAFETY_LOG"
      fi
      sleep 0.5
    done
    echo "[$(ts)] sampler A exit" >> "$MASTER"
  ) &
  local SAMPLER_PID=$!
  echo "$SAMPLER_PID" > "$AOUT/sampler.pid"
  log "sampler pid=$SAMPLER_PID"

  # wait READY
  log "waiting BMOE_READY..."
  local ready_t0 now
  ready_t0=$(date +%s)
  while :; do
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      log "FATAL: bmoe died during load"
      echo "FATAL_LOAD_A" > "$STATUS"
      tail -80 "$SESSION_ERR" >> "$MASTER" || true
      return 2
    fi
    if grep -q 'BMOE_READY' "$SESSION_LOG" 2>/dev/null; then
      log "READY: $(grep 'BMOE_READY' "$SESSION_LOG" | head -1)"
      grep 'BMOE_READY' "$SESSION_LOG" | head -1 > "$AOUT/ready.jsonl"
      break
    fi
    if grep -q 'BMOE_ERROR' "$SESSION_LOG" 2>/dev/null; then
      log "FATAL: BMOE_ERROR during load"
      grep 'BMOE_ERROR' "$SESSION_LOG" | head -5 >> "$MASTER"
      echo "FATAL_LOAD_ERR_A" > "$STATUS"
      return 2
    fi
    now=$(date +%s)
    if [ $((now - ready_t0)) -gt 900 ]; then
      log "FATAL: READY timeout"; echo "FATAL_READY_A" > "$STATUS"; return 2
    fi
    sleep 1
  done

  wait_done() {
    local id="$1" timeout_s="$2"
    local t0 now
    t0=$(date +%s)
    while :; do
      if ! kill -0 "$BMOE_PID" 2>/dev/null; then
        echo "DEAD"; return 1
      fi
      if grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" | tail -1
        return 0
      fi
      if grep -E "BMOE_ERROR \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        echo "ERROR:$(grep -E "BMOE_ERROR \{\"id\":${id}[,}]" "$SESSION_LOG" | tail -1)"
        return 2
      fi
      now=$(date +%s)
      if [ $((now - t0)) -gt "$timeout_s" ]; then
        echo "TIMEOUT"; return 3
      fi
      sleep 0.5
    done
  }

  local STOPPED_AT="" STOP_REASON="" t PROMPT CK
  for t in 1 2 3 4 5 6 7 8 9 10; do
    sc=$(safety_check) || true
    log "safety_pre_A_T$t: $sc"
    echo "pre_A_T$t $sc" >> "$SAFETY_LOG"
    case "$sc" in
      STOP_*)
        STOPPED_AT=$t; STOP_REASON=$sc
        log "SAFETY STOP before A turn $t: $sc"
        break
        ;;
    esac
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      STOPPED_AT=$t; STOP_REASON="PROCESS_DEAD"
      log "bmoe dead before A turn $t"
      break
    fi

    case $t in
      1) PROMPT="$P1"; CK=true ;;
      2) PROMPT="$P2"; CK=false ;;
      3) PROMPT="$P3"; CK=false ;;
      4) PROMPT="$P4"; CK=false ;;
      5) PROMPT="$P5"; CK=false ;;
      6) PROMPT="$P6"; CK=false ;;
      7) PROMPT="$P7"; CK=false ;;
      8) PROMPT="$P8"; CK=false ;;
      9) PROMPT="$P9"; CK=false ;;
      10) PROMPT="$P10"; CK=false ;;
    esac

    local cell="F5.3-A-T${t}"
    log "---- $cell start clear_kv=$CK ----"
    echo "turn${t}_run" > "$PHASE_FILE"
    echo "PHASE_A $cell $(ts)" > "$STATUS"

    local die_s_mc die_s_c batt_s volt_s curr_s temp_s plugged_s
    die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
    read -r batt_s volt_s curr_s temp_s plugged_s <<<"$(batt_fields)"
    read -r rb_s rchar_s <<<"$(read_io "$BMOE_PID")"
    local rss_s; rss_s=$(read_rss "$BMOE_PID")
    local wall_s wall_s_epoch; wall_s=$(ts); wall_s_epoch=$(date +%s)

    local esc req
    esc=$(json_escape_prompt "$PROMPT")
    req=$(printf '{"cmd":"generate","id":%d,"prompt":%s,"n_predict":%d,"think":false,"clear_kv":%s}\n' \
      "$t" "$esc" "$A_N_PRED" "$CK")
    log "send id=$t bytes=${#req}"
    printf '%s\n' "$req" >&3

    local done_line rc
    set +e
    done_line=$(wait_done "$t" 3600)
    rc=$?
    set -e

    local wall_e wall_e_epoch elapsed
    wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch - wall_s_epoch))
    local die_e_mc die_e_c batt_e
    die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
    read -r batt_e _ _ _ _ <<<"$(batt_fields)"
    read -r rb_e rchar_e <<<"$(read_io "$BMOE_PID")"
    local rss_e; rss_e=$(read_rss "$BMOE_PID")
    local rb_d=$((rb_e - rb_s))

    # die max + rss peak + cur_freq averages during turn from sampler
    local stats
    stats=$(python3 - "$SAMPLER_LOG" "$wall_s_epoch" "$die_s_c" "$die_e_c" "$rss_s" "$rss_e" <<'PY'
import sys
path, s, ds, de, rs, re = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), int(float(sys.argv[5])), int(float(sys.argv[6]))
die_max = max(ds, de)
rss_peak = max(rs, re)
f0s=[]; f3s=[]; f5s=[]; f7s=[]
with open(path, encoding="utf-8", errors="replace") as f:
    next(f, None)
    for line in f:
        p=line.strip().split(",")
        if len(p) < 13: continue
        try:
            t=int(int(p[0])/1000)
        except Exception:
            continue
        if t < s-1: continue
        try:
            die=float(p[4]); rss=int(float(p[7]))
            f0=float(p[9]); f3=float(p[10]); f5=float(p[11]); f7=float(p[12])
        except Exception:
            continue
        if die > die_max: die_max = die
        if rss > rss_peak: rss_peak = rss
        f0s.append(f0); f3s.append(f3); f5s.append(f5); f7s.append(f7)
def avg(a):
    return round(sum(a)/len(a), 1) if a else 0.0
# prime core: max of mid/big cores avg (cpu3/5 typically performance)
prime = avg(f3s) if avg(f3s) >= avg(f5s) else avg(f5s)
print(f"{die_max:.1f} {rss_peak} {avg(f0s)} {avg(f3s)} {avg(f5s)} {avg(f7s)} {prime}")
PY
)
    local die_max_c rss_peak f0a f3a f5a f7a fprime
    read -r die_max_c rss_peak f0a f3a f5a f7a fprime <<<"$stats"

    local stopped_reason="ok" notes="" n_prompt=0 n_past=0 tokens=0 tok_s=0
    local prefill_s=0 prefill_tps=0 cache_hit=-1 compute_s_tok=0 io_s_tok=0 stall_s_tok=0
    local read_mib=0 cache_res=0 text=""

    if [ $rc -ne 0 ]; then
      stopped_reason="wait_rc_$rc"
      notes="$done_line"
      log "$cell FAIL rc=$rc line=$done_line"
      if ! kill -0 "$BMOE_PID" 2>/dev/null; then
        STOPPED_AT=$t; STOP_REASON="PROCESS_DEAD_DURING"
      fi
    else
      n_prompt=$(json_get "$done_line" n_prompt); n_prompt=${n_prompt:-0}
      n_past=$(json_get "$done_line" n_past); n_past=${n_past:-0}
      tokens=$(json_get "$done_line" tokens); tokens=${tokens:-0}
      tok_s=$(json_get "$done_line" tok_s); tok_s=${tok_s:-0}
      prefill_s=$(json_get "$done_line" prefill_s); prefill_s=${prefill_s:-0}
      prefill_tps=$(json_get "$done_line" prefill_tps); prefill_tps=${prefill_tps:-0}
      cache_hit=$(json_get "$done_line" cache_hit_pct); cache_hit=${cache_hit:--1}
      compute_s_tok=$(json_get "$done_line" compute_s_tok); compute_s_tok=${compute_s_tok:-0}
      io_s_tok=$(json_get "$done_line" io_s_tok); io_s_tok=${io_s_tok:-0}
      stall_s_tok=$(json_get "$done_line" stall_s_tok); stall_s_tok=${stall_s_tok:-0}
      read_mib=$(json_get "$done_line" read_mib); read_mib=${read_mib:-0}
      cache_res=$(json_get "$done_line" cache_resident_mib); cache_res=${cache_res:-0}
      text=$(json_get_str "$done_line" text)
      log "$cell DONE n_prompt=$n_prompt n_past=$n_past tokens=$tokens tok_s=$tok_s compute=$compute_s_tok cur_freq_prime=$fprime die ${die_s_c}->${die_e_c} batt ${batt_s}->${batt_e}"
      {
        echo "===== TURNO $t ($cell) ====="
        echo "USER: $PROMPT"
        echo "ASSISTANT: $text"
        echo "META: n_prompt=$n_prompt n_past=$n_past tokens=$tokens tok_s=$tok_s prefill_s=$prefill_s cache_hit_pct=$cache_hit compute_s_tok=$compute_s_tok cur_freq_prime_avg=$fprime"
        echo
      } >> "$CONV_TXT"
      echo "$done_line" >> "$AOUT/done_lines.jsonl"
      notes="ubatch=${A_UBATCH};n_ctx=${A_N_CTX};clear_kv=${CK}"
    fi

    echo "$t,$cell,F5.3-A,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$prefill_tps,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$cache_res,$rb_d,$rss_s,$rss_e,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$f0a,$f3a,$f5a,$f7a,$fprime,$stopped_reason,$notes" >> "$TURNS_CSV"
    echo "$cell,F5.3-A,A,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,0,$rb_d,$rss_e,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$f0a,$f3a,$f5a,$f7a,$fprime,ubatch=${A_UBATCH};n_ctx=${A_N_CTX},$stopped_reason,$notes" >> "$CSV_ALL"

    if [ -n "$STOP_REASON" ]; then break; fi

    sc=$(safety_check) || true
    log "safety_post_A_T$t: $sc"
    echo "post_A_T$t $sc" >> "$SAFETY_LOG"
    case "$sc" in
      STOP_*)
        STOPPED_AT=$((t+1)); STOP_REASON=$sc
        log "SAFETY STOP after A turn $t: $sc"
        break
        ;;
    esac
    log "NO COOLDOWN — next turn immediately"
  done

  log "A sending close"
  printf '%s\n' '{"cmd":"close"}' >&3 || true
  sleep 2
  exec 3>&- || true
  if kill -0 "$BMOE_PID" 2>/dev/null; then
    for i in $(seq 1 20); do kill -0 "$BMOE_PID" 2>/dev/null || break; sleep 1; done
  fi
  if kill -0 "$BMOE_PID" 2>/dev/null; then kill -TERM "$BMOE_PID" 2>/dev/null || true; sleep 3; fi
  if kill -0 "$BMOE_PID" 2>/dev/null; then kill -KILL "$BMOE_PID" 2>/dev/null || true; fi
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true

  {
    echo "PHASE_A_DONE $(ts)"
    echo "stopped_at=$STOPPED_AT"
    echo "stop_reason=$STOP_REASON"
    echo "turns_csv=$TURNS_CSV"
  } > "$AOUT/STATUS.txt"
  log "PHASE A done stopped_at=$STOPPED_AT reason=$STOP_REASON"
  echo "$STOPPED_AT" > "$AOUT/stopped_at.txt"
  echo "$STOP_REASON" > "$AOUT/stop_reason.txt"
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE B — Q4_0 vs Q4_K_M on LFM2-8B-A1B
# ═══════════════════════════════════════════════════════════════
run_oneshot_model() {
  local cell="$1" model="$2" sub="$3" extra="$4" n_ctx="$5" n_pred="$6" pfile="$7" do_cold="${8:-1}" cache_mb="${9:-$B_CACHE_MB}"
  local odir="$OUTDIR/$sub"
  mkdir -p "$odir"
  local slog="$odir/${cell}.stdout.log"
  local serr="$odir/${cell}.stderr.log"
  local csvp="$odir/${cell}.metrics.csv"
  local genf="$odir/${cell}.gen.txt"
  local donef="$odir/${cell}.done"
  local sampler_log="$odir/${cell}.sampler.csv"
  rm -f "$donef"

  log "==== CELL $cell oneshot model=$(basename "$model") n_ctx=$n_ctx n_pred=$n_pred cache=$cache_mb extra=[$extra] ===="
  echo "CELL $cell $(ts)" > "$STATUS"

  local saf
  saf=$(safety_check) || {
    log "STOP safety before $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    echo "$cell,F5.3-B,B,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,$saf,safety" >> "$CSV_ALL"
    return 1
  }
  log "safety $saf"
  kill_bmoe_exact
  if [ "$do_cold" = "1" ]; then
    log "cold_model $model"
    "$COLD_MODEL_SH" "$model" >> "$MASTER" 2>&1 || log "WARN cold_model failed for $model"
  fi

  local die_s_mc die_s_c batt_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ _ <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb,cur_freq0,cur_freq3,cur_freq5,cur_freq7" > "$sampler_log"
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
      f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f3=$(cat /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f5=$(cat /sys/devices/system/cpu/cpu5/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      echo "${now_ms},${die_c},${rb},${rc},${rss},${f0},${f3},${f5},${f7}" >> "$sampler_log"
      sleep 0.5
    done
  ) &
  local samp_pid=$!

  local base_flags="--moe-stream --cache-mb ${cache_mb} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${B_UBATCH}"
  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$model" -t "$THREADS" -c "$n_ctx" -n "$n_pred" \
    --chatml --no-think --progress --csv "$csvp" \
    $base_flags $extra \
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

  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(grep -oE '\([0-9.]+ tok/s\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(grep -oE 'compute [0-9.]+ \+ cache' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(grep -oE 'flash I/O [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(grep -oE 'stall [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
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
  # progress last line
  local lastprog
  lastprog=$(grep BMOE_PROGRESS "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$lastprog" ]; then
    local pt pcs pts ch
    pt=$(json_get "$lastprog" tokens); [ -n "$pt" ] && [ "$pt" != "0" ] && tokens=$pt
    pts=$(json_get "$lastprog" tok_s); [ -n "$pts" ] && [ "$pts" != "0" ] && tok_s=$pts
    pcs=$(json_get "$lastprog" compute_s_tok); [ -n "$pcs" ] && compute_s_tok=$pcs
    ch=$(json_get "$lastprog" cache_hit_pct); [ -n "$ch" ] && cache_hit=$ch
    local np; np=$(json_get "$lastprog" n_past); [ -n "$np" ] && n_past=$np
  fi
  # also try BMOE_DONE if any
  local doneline
  doneline=$(grep BMOE_DONE "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$doneline" ]; then
    local v
    v=$(json_get "$doneline" tokens); [ -n "$v" ] && tokens=$v
    v=$(json_get "$doneline" tok_s); [ -n "$v" ] && tok_s=$v
    v=$(json_get "$doneline" compute_s_tok); [ -n "$v" ] && compute_s_tok=$v
    v=$(json_get "$doneline" cache_hit_pct); [ -n "$v" ] && cache_hit=$v
    v=$(json_get "$doneline" prefill_s); [ -n "$v" ] && prefill_s=$v
    v=$(json_get "$doneline" n_prompt); [ -n "$v" ] && n_prompt=$v
    v=$(json_get "$doneline" n_past); [ -n "$v" ] && n_past=$v
    v=$(json_get "$doneline" io_s_tok); [ -n "$v" ] && io_s_tok=$v
    v=$(json_get "$doneline" stall_s_tok); [ -n "$v" ] && stall_s_tok=$v
    v=$(json_get "$doneline" read_mib); [ -n "$v" ] && read_mib=$v
  fi

  # csv metrics if present
  if [ -f "$csvp" ]; then
    python3 - "$csvp" <<'PY' > "$odir/${cell}.csv_parse.txt" 2>/dev/null || true
import sys,csv
p=sys.argv[1]
with open(p,encoding="utf-8",errors="replace") as f:
    r=csv.DictReader(f)
    rows=list(r)
if not rows:
    sys.exit(0)
last=rows[-1]
for k in ("tokens","tok_s","compute_s_tok","io_s_tok","stall_s_tok","cache_hit_pct","prefill_s","n_prompt","n_past","read_mib","mib_tok"):
    if k in last and last[k] not in (None,""):
        print(f"{k}={last[k]}")
PY
    while IFS= read -r line; do
      case "$line" in
        tokens=*) tokens=${line#tokens=} ;;
        tok_s=*) tok_s=${line#tok_s=} ;;
        compute_s_tok=*) compute_s_tok=${line#compute_s_tok=} ;;
        io_s_tok=*) io_s_tok=${line#io_s_tok=} ;;
        stall_s_tok=*) stall_s_tok=${line#stall_s_tok=} ;;
        cache_hit_pct=*) cache_hit=${line#cache_hit_pct=} ;;
        prefill_s=*) prefill_s=${line#prefill_s=} ;;
        n_prompt=*) n_prompt=${line#n_prompt=} ;;
        n_past=*) n_past=${line#n_past=} ;;
        read_mib=*) read_mib=${line#read_mib=} ;;
        mib_tok=*) mib_tok=${line#mib_tok=} ;;
      esac
    done < "$odir/${cell}.csv_parse.txt"
  fi

  local die_max_c rss_peak
  die_max_c=$(awk -F, -v ds="$die_s_c" -v de="$die_e_c" 'NR>1{if($2+0>m)m=$2+0} END{if(m=="")m=0; printf "%.1f", (m>ds&&m>de?m:(ds>de?ds:de))+0}' "$sampler_log")
  rss_peak=$(awk -F, 'NR>1{if($5+0>m)m=$5+0} END{print m+0}' "$sampler_log")

  local stopped_reason="ok"
  if [ "$rc_bin" -ne 0 ]; then stopped_reason="bin_rc_$rc_bin"; fi
  if [ "$tokens" = "0" ] || [ -z "$tokens" ]; then
    if grep -qi 'killed\|lmkd\|out of memory\|Cannot allocate' "$slog" "$serr" 2>/dev/null; then
      stopped_reason="OOM_OR_KILL"
    elif [ "$rc_bin" -ne 0 ]; then
      stopped_reason="bin_rc_$rc_bin"
    fi
  fi

  local notes="model=$(basename "$model");cache_mb=${cache_mb};ubatch=${B_UBATCH};n_ctx=${n_ctx};extra=${extra}"
  log "$cell DONE tokens=$tokens tok_s=$tok_s compute=$compute_s_tok hit=$cache_hit die ${die_s_c}->${die_e_c} batt ${batt_s}->${batt_e} reason=$stopped_reason"

  echo "$cell,F5.3-B,B,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$mib_tok,0,$rss_peak,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,0,0,0,0,0,$extra,$stopped_reason,$notes" >> "$CSV_ALL"
  {
    echo "cell=$cell"
    echo "model=$(basename "$model")"
    echo "tokens=$tokens tok_s=$tok_s compute_s_tok=$compute_s_tok io_s_tok=$io_s_tok"
    echo "cache_hit=$cache_hit read_mib=$read_mib mib_tok=$mib_tok"
    echo "die_max=$die_max_c rss_peak=$rss_peak elapsed=$elapsed"
    echo "rc=$rc_bin reason=$stopped_reason"
  } > "$odir/${cell}.meta.txt"
  return 0
}

run_phase_b() {
  log "==== PHASE B start Q4_0 vs Q4_K_M ===="
  echo "PHASE_B $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/b_prompt.txt"
  local total_runs=$(( (B_N_REP + B_SENTINEL) * 2 ))
  log "B config IDENTICAL: -t $THREADS -c $B_N_CTX -n $B_N_PRED --moe-stream --cache-mb $B_CACHE_MB --dense-weights anon --overlap --io-threads $IO_THREADS --ubatch $B_UBATCH --chatml --no-think"
  log "B reps=$B_N_REP + sentinel=$B_SENTINEL per quant; cold_cache before each"

  # Interleave to reduce thermal bias: Q40, Q4KM, Q40, Q4KM, ... then sentinels
  local i cell
  for i in $(seq 1 "$B_N_REP"); do
    saf=$(safety_check) || { log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
    cell="F5.3-B-Q4_0-r${i}"
    run_oneshot_model "$cell" "$MODEL_Q40" "b" "" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" || return 1
    wait_cool 55 90

    saf=$(safety_check) || { log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
    cell="F5.3-B-Q4_K_M-r${i}"
    run_oneshot_model "$cell" "$MODEL_Q4KM" "b" "" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" || return 1
    wait_cool 55 90
  done

  # sentinel (4th) with compute-trace if possible
  saf=$(safety_check) || { log "STOP B before sentinel: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
  cell="F5.3-B-Q4_0-sent"
  run_oneshot_model "$cell" "$MODEL_Q40" "b" "--compute-trace $OUTDIR/b/ct_q40.csv" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" || true
  wait_cool 55 90
  saf=$(safety_check) || { log "STOP B before sentinel KM: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
  cell="F5.3-B-Q4_K_M-sent"
  run_oneshot_model "$cell" "$MODEL_Q4KM" "b" "--compute-trace $OUTDIR/b/ct_q4km.csv" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" || true

  log "PHASE B done"
  echo "PHASE_B_DONE $(ts)" > "$OUTDIR/b/STATUS.txt"
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE C — cache sweep h(C) with ubatch 512
# ═══════════════════════════════════════════════════════════════
run_oneshot_35() {
  local cell="$1" cache_mb="$2" sub="$3" extra="$4" n_ctx="$5" n_pred="$6" pfile="$7" do_cold="${8:-1}" ubatch="${9:-$C_UBATCH}"
  local odir="$OUTDIR/$sub"
  mkdir -p "$odir"
  local slog="$odir/${cell}.stdout.log"
  local serr="$odir/${cell}.stderr.log"
  local csvp="$odir/${cell}.metrics.csv"
  local genf="$odir/${cell}.gen.txt"
  local donef="$odir/${cell}.done"
  local sampler_log="$odir/${cell}.sampler.csv"
  rm -f "$donef"

  log "==== CELL $cell oneshot cache=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred ===="
  echo "CELL $cell $(ts)" > "$STATUS"

  local saf
  saf=$(safety_check) || {
    log "STOP safety before $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    echo "$cell,F5.3-C,C,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,$saf,safety" >> "$CSV_ALL"
    return 1
  }
  log "safety $saf"
  kill_bmoe_exact
  if [ "$do_cold" = "1" ]; then
    log "cold_model $MODEL35"
    "$COLD_MODEL_SH" "$MODEL35" >> "$MASTER" 2>&1 || log "WARN cold_model failed"
  fi

  local die_s_mc die_s_c batt_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ _ <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb,cur_freq0,cur_freq3,cur_freq5,cur_freq7" > "$sampler_log"
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
      f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f3=$(cat /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f5=$(cat /sys/devices/system/cpu/cpu5/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      echo "${now_ms},${die_c},${rb},${rc},${rss},${f0},${f3},${f5},${f7}" >> "$sampler_log"
      sleep 0.5
    done
  ) &
  local samp_pid=$!

  local base_flags="--moe-stream --cache-mb ${cache_mb} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${ubatch}"
  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$MODEL35" -t "$THREADS" -c "$n_ctx" -n "$n_pred" \
    --chatml --no-think --progress --csv "$csvp" \
    $base_flags $extra \
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

  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(grep -oE '\([0-9.]+ tok/s\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(grep -oE 'compute [0-9.]+ \+ cache' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(grep -oE 'flash I/O [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(grep -oE 'stall [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
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
  local lastprog
  lastprog=$(grep BMOE_PROGRESS "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$lastprog" ]; then
    local pt pcs pts ch np
    pt=$(json_get "$lastprog" tokens); [ -n "$pt" ] && [ "$pt" != "0" ] && tokens=$pt
    pts=$(json_get "$lastprog" tok_s); [ -n "$pts" ] && [ "$pts" != "0" ] && tok_s=$pts
    pcs=$(json_get "$lastprog" compute_s_tok); [ -n "$pcs" ] && compute_s_tok=$pcs
    ch=$(json_get "$lastprog" cache_hit_pct); [ -n "$ch" ] && cache_hit=$ch
    np=$(json_get "$lastprog" n_past); [ -n "$np" ] && n_past=$np
  fi
  if [ -f "$csvp" ]; then
    python3 - "$csvp" <<'PY' > "$odir/${cell}.csv_parse.txt" 2>/dev/null || true
import sys,csv
p=sys.argv[1]
with open(p,encoding="utf-8",errors="replace") as f:
    r=csv.DictReader(f)
    rows=list(r)
if not rows: sys.exit(0)
last=rows[-1]
for k in ("tokens","tok_s","compute_s_tok","io_s_tok","stall_s_tok","cache_hit_pct","prefill_s","n_prompt","n_past","read_mib","mib_tok"):
    if k in last and last[k] not in (None,""):
        print(f"{k}={last[k]}")
PY
    while IFS= read -r line; do
      case "$line" in
        tokens=*) tokens=${line#tokens=} ;;
        tok_s=*) tok_s=${line#tok_s=} ;;
        compute_s_tok=*) compute_s_tok=${line#compute_s_tok=} ;;
        io_s_tok=*) io_s_tok=${line#io_s_tok=} ;;
        stall_s_tok=*) stall_s_tok=${line#stall_s_tok=} ;;
        cache_hit_pct=*) cache_hit=${line#cache_hit_pct=} ;;
        prefill_s=*) prefill_s=${line#prefill_s=} ;;
        n_prompt=*) n_prompt=${line#n_prompt=} ;;
        n_past=*) n_past=${line#n_past=} ;;
        read_mib=*) read_mib=${line#read_mib=} ;;
        mib_tok=*) mib_tok=${line#mib_tok=} ;;
      esac
    done < "$odir/${cell}.csv_parse.txt"
  fi

  local die_max_c rss_peak
  die_max_c=$(awk -F, -v ds="$die_s_c" -v de="$die_e_c" 'NR>1{if($2+0>m)m=$2+0} END{if(m=="")m=0; printf "%.1f", (m>ds&&m>de?m:(ds>de?ds:de))+0}' "$sampler_log")
  rss_peak=$(awk -F, 'NR>1{if($5+0>m)m=$5+0} END{print m+0}' "$sampler_log")

  local stopped_reason="ok"
  if [ "$rc_bin" -ne 0 ]; then stopped_reason="bin_rc_$rc_bin"; fi
  if [ "$tokens" = "0" ] || [ -z "$tokens" ]; then
    if grep -qi 'killed\|lmkd\|out of memory\|Cannot allocate' "$slog" "$serr" 2>/dev/null; then
      stopped_reason="OOM_OR_KILL"
    fi
  fi

  local notes="cache_mb=${cache_mb};ubatch=${ubatch};n_ctx=${n_ctx}"
  log "$cell DONE tokens=$tokens tok_s=$tok_s compute=$compute_s_tok hit=$cache_hit mib_tok=$mib_tok die_max=$die_max_c rss_peak=$rss_peak reason=$stopped_reason"

  echo "$cell,F5.3-C,C,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$mib_tok,0,$rss_peak,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,0,0,0,0,0,cache=${cache_mb},$stopped_reason,$notes" >> "$CSV_ALL"
  {
    echo "cell=$cell cache_mb=$cache_mb"
    echo "tokens=$tokens tok_s=$tok_s compute_s_tok=$compute_s_tok"
    echo "cache_hit=$cache_hit mib_tok=$mib_tok read_mib=$read_mib"
    echo "die_max=$die_max_c rss_peak=$rss_peak elapsed=$elapsed"
    echo "rc=$rc_bin reason=$stopped_reason"
  } > "$odir/${cell}.meta.txt"
  return 0
}

run_phase_c() {
  log "==== PHASE C start cache sweep ${C_CACHES} ubatch=$C_UBATCH ===="
  echo "PHASE_C $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/long_it.txt"
  local c rep cell
  for c in $C_CACHES; do
    for rep in $(seq 1 "$C_N_REP"); do
      saf=$(safety_check) || { log "STOP C mid: $saf"; echo "STOPPED C $saf $(ts)" > "$STATUS"; return 1; }
      cell="F5.3-C-cache${c}-r${rep}"
      run_oneshot_35 "$cell" "$c" "c" "" "$C_N_CTX" "$C_N_PRED" "$pfile" 1 "$C_UBATCH" || return 1
      wait_cool 55 90
    done
  done
  log "PHASE C done"
  echo "PHASE_C_DONE $(ts)" > "$OUTDIR/c/STATUS.txt"
  return 0
}

# ── main sequence ──
PHASE_REACHED="none"
set +e
run_phase_a
rc_a=$?
set -e
PHASE_REACHED="A"
log "phase A rc=$rc_a"

saf=$(safety_check) || {
  log "STOP after A before B: $saf"
  echo "STOPPED after_A $saf $(ts)" > "$STATUS"
  BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
  echo "$BATT_END" > "$OUTDIR/batt_end.json"
  echo "DONE_PARTIAL $(ts) phase=$PHASE_REACHED stop=$saf" > "$STATUS"
  exit 0
}

set +e
run_phase_b
rc_b=$?
set -e
PHASE_REACHED="B"
log "phase B rc=$rc_b"

saf=$(safety_check) || {
  log "STOP after B before C: $saf"
  echo "STOPPED after_B $saf $(ts)" > "$STATUS"
  BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
  echo "$BATT_END" > "$OUTDIR/batt_end.json"
  echo "DONE_PARTIAL $(ts) phase=$PHASE_REACHED stop=$saf" > "$STATUS"
  exit 0
}

set +e
run_phase_c
rc_c=$?
set -e
PHASE_REACHED="C"
log "phase C rc=$rc_c"

kill_bmoe_exact
BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_END" > "$OUTDIR/batt_end.json"
DIE_END=$(max_die_mc)
log "batt_end: $BATT_END"
log "die_end_mc=$DIE_END"
{
  echo "DONE $(ts)"
  echo "phase_reached=$PHASE_REACHED"
  echo "rc_a=$rc_a rc_b=$rc_b rc_c=$rc_c"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "nproc=$NPROC cpuset=$CPUSET"
} > "$STATUS"
log "=== F5.3 COMPLETE phase=$PHASE_REACHED ==="
exit 0
