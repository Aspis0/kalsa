#!/data/data/com.termux/files/usr/bin/bash
# start_f5_1.sh — F5.1 CONVERSAZIONE VERA: sessione multi-turno SENZA cooldown
# Un solo bmoe-cli --session, clear_kv=false, 8 turni IT concatenati.
# NIENTE cooldown tra turni (deliberato). Safety: die>98C o batt<30% → stop.
# Detached via nohup. SSH drop ≠ fail.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.1}"
mkdir -p "$OUTDIR" "$TMPDIR"
MASTER="$OUTDIR/F5.1.master.log"
PIDFILE="$OUTDIR/f5_1.pid"
SESSION_LOG="$OUTDIR/session.stdout.log"
SESSION_ERR="$OUTDIR/session.stderr.log"
SAMPLER_LOG="$OUTDIR/sampler_500ms.csv"
TURNS_CSV="$OUTDIR/turns.csv"
CONV_TXT="$OUTDIR/conversation_full.txt"
SAFETY_LOG="$OUTDIR/safety.log"
STATUS="$OUTDIR/STATUS.txt"
REQ_FIFO="$OUTDIR/req.fifo"
DRIVER_LOG="$OUTDIR/driver.log"

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

MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
THREADS=4
N_CTX=4096
N_PREDICT=256
CACHE_MB=2000
IO_THREADS=4
FLAGS="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS}"
# --chatml required for multi-turn KV reuse of only the new user message
# --no-think: app default; clean suffix re-prefill (session.md)
SESSION_FLAGS="-m $MODEL -t $THREADS -c $N_CTX -n $N_PREDICT --chatml --no-think $FLAGS --session"

DIE_STOP_MC=98000   # 98.0 C in millideg
BATT_STOP=30
N_TURNS=8
TAG="F5.1 SESSIONE-SENZA-COOLDOWN"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$DRIVER_LOG"
: > "$SAFETY_LOG"
: > "$CONV_TXT"
echo "RUNNING $(ts)" > "$STATUS"

log "=== F5.1 START pid=$$ ==="
log "bin=$BIN model=$MODEL expected_size=$EXPECTED_SIZE"
log "flags: $SESSION_FLAGS"
log "n_ctx=$N_CTX n_predict=$N_PREDICT threads=$THREADS (stima contesto: 8*(user~80+gen~256+wrap)~ 8*360 ≈ 2880 + system; n_ctx=4096)"

# ── preflight ──
if [ ! -x "$BIN" ]; then log "FATAL: binary missing"; echo "FATAL_NO_BIN" > "$STATUS"; exit 2; fi
SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE" ]; then log "FATAL: model size $SZ != $EXPECTED_SIZE"; echo "FATAL_SIZE" > "$STATUS"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL: nproc=$NPROC < 6 (not top-app?)"; echo "FATAL_NPROC" > "$STATUS"; exit 2; fi
CPUSET=$(cat /proc/self/cpuset 2>/dev/null || echo "?")
log "nproc=$NPROC cpuset=$CPUSET"

BATT_JSON=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_JSON" > "$OUTDIR/batt_start.json"
log "battery_start: $BATT_JSON"

# residual bmoe? match only a real bmoe-cli process (not bash -c text containing the string)
resid=""
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  [ -r "/proc/$pid/cmdline" ] || continue
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  case "$cmd" in
    *"/bmoe-cli "*|*/bmoe-cli\ --*|*/bmoe-cli\ -m*)
      case "$cmd" in *start_f5_1.sh*) ;; *) resid="$resid $pid";; esac
      ;;
  esac
done
if [ -n "$resid" ]; then
  log "WARN: residual bmoe-cli pids:$resid; listing:"
  for pid in $resid; do echo "pid=$pid $(tr '\0' ' ' </proc/$pid/cmdline 2>/dev/null)"; done >> "$MASTER" || true
  log "FATAL: refuse to start with residual bmoe"; echo "FATAL_RESIDUAL" > "$STATUS"; exit 2
fi

# max die among cpu-* zones
max_die_mc() {
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in
      cpu-*|cpuss-*|*cpu*|*CPU*)
        v=$(cat "$z/temp" 2>/dev/null || echo 0)
        # values are millideg on this device
        if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
        ;;
    esac
  done
  echo "$max"
}

mc_to_c() {
  # millideg or already C*1000
  awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'
}

DIE0=$(max_die_mc)
log "die_start_mc=$DIE0 ($(mc_to_c "$DIE0")C)"

# LD_LIBRARY_PATH = binary dir (+ parent for stubs)
BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

# ── cold cache ONLY before turn 1 ──
log "cold_model.sh $MODEL"
if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
  log "FATAL: cold_model failed"; echo "FATAL_COLD" > "$STATUS"; exit 2
fi
log "cold_model OK"

# ── conversation prompts (IT, concatenati, ~brevi) ──
# Theme: pianificare un viaggio in Sicilia di 7 giorni da Milano.
P1='Ciao! Sto pianificando un viaggio di 7 giorni in Sicilia partendo da Milano a metà settembre. Budget circa 1200 euro a persona, volo incluso. Preferisco mare e un po di cultura, niente resort tutto incluso. Dammi una bozza di itinerario giorno per giorno, realistica sui tempi di spostamento. Rispondi in italiano, max 250 parole.'
P2='Grazie. Sulla base di quello che hai proposto, concentriamoci sui primi 3 giorni: dove dormiresti (fascia 70-100 euro/notte) e quale mezzo useresti tra Catania e le altre tappe? Voglio alternative concrete, non generiche. Sempre in italiano, max 250 parole.'
P3='Ok, tengo la tua idea sul mezzo. Pero ho un vincolo nuovo: viaggio con un bambino di 6 anni, quindi niente tappe troppo lunghe in auto e mi serve almeno una spiaggia balneabile facile. Come rivedi i primi 3 giorni? Cita esplicitamente cosa cambi rispetto a prima. Italiano, max 250 parole.'
P4='Perfetto. Ora il budget: spezzami i 1200 euro a persona (volo, alloggio 6 notti, cibo, spostamenti, attivita) con stime plausibili basate sull itinerario rivisto. Se sforiamo, dimmi dove tagliare senza rovinare il viaggio col bambino. Italiano, max 250 parole.'
P5='Sul cibo: proponi 4 posti (anche semplici) coerenti con le tappe che hai scelto, uno per zona, con cosa ordinare di tipico e una fascia di prezzo a persona. Niente catene internazionali. Italiano, max 250 parole.'
P6='Torna un attimo sull itinerario completo dei 7 giorni: tieni i vincoli (bambino, budget, no resort) e scrivi solo l elenco giorno-citta-focus in forma compatta, poi 3 rischi concreti (meteo, scioperi, code) con un piano B ciascuno. Italiano, max 250 parole.'
P7='Supponiamo che il giorno 4 piova forte come nel piano B. Riscrivi SOLO il giorno 4 e il 5 in versione indoor/cultura, restando nella stessa area geografica che avevi scelto. Non ricominciare da capo. Italiano, max 250 parole.'
P8='Chiudi: dammi una checklist di prenotazioni da fare entro 10 giorni (volo, hotel, auto/treno, attivita) in ordine di priorita, riferendoti alle scelte concrete di questa conversazione (citta e mezzi che abbiamo fissato). Italiano, max 250 parole.'

# turns.csv header
echo "turn,tag,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,ttft_s,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,cache_resident_mib,rb_start,rb_end,rb_delta,rchar_start,rchar_end,rchar_delta,rss_start_kb,rss_end_kb,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_pct_start,batt_pct_end,volt_start_mV,curr_start_uA,volt_end_mV,curr_end_uA,energy_J_est,J_per_tok,stopped_reason,notes" > "$TURNS_CSV"

# sampler header
echo "ts_epoch_ms,ts_iso,pid,alive,die_max_c,read_bytes,rchar,vmrss_kb,memfree_kb,phase" > "$SAMPLER_LOG"

# ── fifo for requests ──
rm -f "$REQ_FIFO"
mkfifo "$REQ_FIFO"

# ── start bmoe session (reads fifo, writes session log) ──
log "starting bmoe-cli --session"
# shellcheck disable=SC2086
"$BIN" $SESSION_FLAGS < "$REQ_FIFO" > "$SESSION_LOG" 2> "$SESSION_ERR" &
BMOE_PID=$!
echo "$BMOE_PID" > "$OUTDIR/bmoe.pid"
log "bmoe pid=$BMOE_PID"

# keep fifo open for writing (background exec)
exec 3>"$REQ_FIFO"

# ── sampler loop (500ms) ──
(
  PHASE_FILE="$OUTDIR/phase.txt"
  echo "load" > "$PHASE_FILE"
  while kill -0 "$BMOE_PID" 2>/dev/null; do
    now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
    now_iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
    die_mc=$(max_die_mc)
    die_c=$(mc_to_c "$die_mc")
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
    phase=$(cat "$PHASE_FILE" 2>/dev/null || echo "?")
    alive=1
    kill -0 "$BMOE_PID" 2>/dev/null || alive=0
    echo "${now_ms},${now_iso},${BMOE_PID},${alive},${die_c},${rb},${rc},${rss},${memfree},${phase}" >> "$SAMPLER_LOG"
    # soft safety log only (driver enforces hard stop between turns)
    if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
      echo "[$(ts)] SAMPLER die_mc=$die_mc > $DIE_STOP_MC" >> "$SAFETY_LOG"
    fi
    sleep 0.5
  done
  echo "[$(ts)] sampler exit (bmoe dead)" >> "$MASTER"
) &
SAMPLER_PID=$!
echo "$SAMPLER_PID" > "$OUTDIR/sampler.pid"
log "sampler pid=$SAMPLER_PID"

# wait BMOE_READY (load can take minutes)
log "waiting BMOE_READY (load)..."
echo "load" > "$OUTDIR/phase.txt"
READY_TIMEOUT=900
ready_t0=$(date +%s)
READY_LINE=""
while :; do
  if ! kill -0 "$BMOE_PID" 2>/dev/null; then
    log "FATAL: bmoe died during load"; echo "FATAL_LOAD" > "$STATUS"
    tail -50 "$SESSION_ERR" >> "$MASTER" || true
    exit 2
  fi
  if grep -q 'BMOE_READY' "$SESSION_LOG" 2>/dev/null; then
    READY_LINE=$(grep 'BMOE_READY' "$SESSION_LOG" | head -1)
    break
  fi
  if grep -q 'BMOE_ERROR' "$SESSION_LOG" 2>/dev/null; then
    log "FATAL: BMOE_ERROR during load"
    grep 'BMOE_ERROR' "$SESSION_LOG" | head -3 >> "$MASTER"
    echo "FATAL_LOAD_ERR" > "$STATUS"
    exit 2
  fi
  now=$(date +%s)
  if [ $((now - ready_t0)) -gt "$READY_TIMEOUT" ]; then
    log "FATAL: READY timeout ${READY_TIMEOUT}s"; echo "FATAL_READY_TIMEOUT" > "$STATUS"; exit 2
  fi
  sleep 1
done
log "READY: $READY_LINE"
echo "$READY_LINE" > "$OUTDIR/ready.jsonl"

json_get() {
  # crude extract "key":number or "key":"str" from a line
  local line="$1" key="$2"
  echo "$line" | sed -n "s/.*\"${key}\":\([0-9.][0-9.]*\).*/\1/p" | head -1
}

json_get_str() {
  local line="$1" key="$2"
  python3 - "$line" "$key" <<'PY' 2>/dev/null || true
import sys,json,re
line,key=sys.argv[1],sys.argv[2]
# try full json after first space
try:
    obj=json.loads(line.split(' ',1)[1])
    v=obj.get(key,"")
    if isinstance(v,str):
        print(v)
    else:
        print(v)
except Exception:
    m=re.search(r'"%s"\s*:\s*"((?:\\.|[^"\\])*)"'%re.escape(key), line)
    if m:
        print(m.group(1).encode('utf-8').decode('unicode_escape'))
PY
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

batt_fields() {
  # prints: pct volt_mV curr_uA temp_c
  termux-battery-status 2>/dev/null | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0), d.get("temperature",-1))
except Exception:
  print(-1,-1,0,-1)
'
}

# wait for BMOE_DONE with id=N appearing after a mark
wait_done() {
  local id="$1" timeout_s="$2"
  local t0 now
  t0=$(date +%s)
  local prev_sz=0
  if [ -f "$SESSION_LOG" ]; then prev_sz=$(wc -c < "$SESSION_LOG"); fi
  while :; do
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      echo "DEAD"
      return 1
    fi
    # match DONE for this id
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
      echo "TIMEOUT"
      return 3
    fi
    sleep 0.5
  done
}

# safety check; echoes OK or STOP reason; updates globals via stdout
safety_check() {
  local die_mc batt
  die_mc=$(max_die_mc)
  batt=$(batt_fields | awk '{print $1}')
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "STOP_DIE:$(mc_to_c "$die_mc")"
    return 1
  fi
  if [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    echo "STOP_BATT:$batt"
    return 1
  fi
  echo "OK:die=$(mc_to_c "$die_mc"):batt=$batt"
  return 0
}

# escape prompt for JSON
json_escape_prompt() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")' <<<"$1"
}

run_turn() {
  local turn=$1
  local prompt=$2
  local clear_kv=$3   # false for multi-turn
  local id=$turn

  log "---- TURN $turn start clear_kv=$clear_kv ----"
  echo "turn${turn}_prefill" > "$OUTDIR/phase.txt"

  local die_s_mc die_s_c batt_s volt_s curr_s temp_s
  die_s_mc=$(max_die_mc)
  die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s volt_s curr_s temp_s <<<"$(batt_fields)"
  read -r rb_s rchar_s <<<"$(read_io "$BMOE_PID")"
  local rss_s
  rss_s=$(read_rss "$BMOE_PID")
  local wall_s wall_s_epoch
  wall_s=$(ts)
  wall_s_epoch=$(date +%s)

  # mark log position
  local mark_line
  mark_line=$(wc -l < "$SESSION_LOG")

  local esc
  esc=$(json_escape_prompt "$prompt")
  # JSON line request
  local req
  req=$(printf '{"cmd":"generate","id":%d,"prompt":%s,"n_predict":%d,"think":false,"clear_kv":%s}\n' \
    "$id" "$esc" "$N_PREDICT" "$clear_kv")
  log "send id=$id bytes=${#req}"
  # IMPORTANT: $(printf ...\n) strips the trailing newline; getline needs one.
  printf '%s\n' "$req" >&3

  # wait DONE
  local done_line rc
  set +e
  done_line=$(wait_done "$id" 2400)
  rc=$?
  set -e

  local wall_e wall_e_epoch elapsed
  wall_e=$(ts)
  wall_e_epoch=$(date +%s)
  elapsed=$((wall_e_epoch - wall_s_epoch))

  local die_e_mc die_e_c batt_e volt_e curr_e temp_e
  die_e_mc=$(max_die_mc)
  die_e_c=$(mc_to_c "$die_e_mc")
  read -r batt_e volt_e curr_e temp_e <<<"$(batt_fields)"
  read -r rb_e rchar_e <<<"$(read_io "$BMOE_PID")"
  local rss_e
  rss_e=$(read_rss "$BMOE_PID")
  local rb_d=$((rb_e - rb_s))
  local rchar_d=$((rchar_e - rchar_s))

  # die max during turn from sampler (approx: max of start/end + scan sampler)
  local die_max_c
  die_max_c=$(awk -F, -v s="$wall_s_epoch" 'NR>1{
      # ts_epoch_ms
      t=int($1/1000);
      if(t+0>=s-1){ if($5+0>m) m=$5+0 }
    } END{ if(m=="") m=0; printf "%.1f", m+0 }' "$SAMPLER_LOG")
  # also consider endpoints
  die_max_c=$(python3 -c "print(max(float('$die_s_c'),float('$die_e_c'),float('${die_max_c:-0}')))")

  local rss_peak
  rss_peak=$(awk -F, -v s="$wall_s_epoch" 'NR>1{
      t=int($1/1000);
      if(t+0>=s-1){ if($8+0>m) m=$8+0 }
    } END{ print m+0 }' "$SAMPLER_LOG")
  if [ "${rss_peak:-0}" -lt "$rss_e" ]; then rss_peak=$rss_e; fi
  if [ "${rss_peak:-0}" -lt "$rss_s" ]; then rss_peak=$rss_s; fi

  local stopped_reason="ok" notes=""
  local n_prompt=0 n_past=0 tokens=0 tok_s=0 prefill_s=0 prefill_tps=0 cache_hit=-1
  local compute_s_tok=0 io_s_tok=0 stall_s_tok=0 read_mib=0 cache_res=0
  local text="" reasoning=""

  if [ $rc -ne 0 ]; then
    stopped_reason="wait_rc_$rc"
    notes="$done_line"
    log "TURN $turn FAIL rc=$rc line=$done_line"
  else
    # parse BMOE_DONE
    n_prompt=$(json_get "$done_line" n_prompt); n_prompt=${n_prompt:-0}
    n_past=$(json_get "$done_line" n_past); n_past=${n_past:-0}
    tokens=$(json_get "$done_line" tokens); tokens=${tokens:-0}
    tok_s=$(json_get "$done_line" tok_s); tok_s=${tok_s:-0}
    prefill_s=$(json_get "$done_line" prefill_s); prefill_s=${prefill_s:-0}
    prefill_tps=$(json_get "$done_line" prefill_tps); prefill_tps=${prefill_tps:-0}
    cache_hit=$(json_get "$done_line" cache_hit_pct); cache_hit=${cache_hit:- -1}
    compute_s_tok=$(json_get "$done_line" compute_s_tok); compute_s_tok=${compute_s_tok:-0}
    io_s_tok=$(json_get "$done_line" io_s_tok); io_s_tok=${io_s_tok:-0}
    stall_s_tok=$(json_get "$done_line" stall_s_tok); stall_s_tok=${stall_s_tok:-0}
    read_mib=$(json_get "$done_line" read_mib); read_mib=${read_mib:-0}
    cache_res=$(json_get "$done_line" cache_resident_mib); cache_res=${cache_res:-0}
    text=$(json_get_str "$done_line" text)
    reasoning=$(json_get_str "$done_line" reasoning)
    # TTFT ≈ prefill_s in session (model already loaded); load_s only at READY
    local ttft_s="$prefill_s"
    log "TURN $turn DONE n_prompt=$n_prompt n_past=$n_past tokens=$tokens tok_s=$tok_s prefill_s=$prefill_s hit=$cache_hit die ${die_s_c}->${die_e_c} batt ${batt_s}->${batt_e}"

    # conversation log
    {
      echo "===== TURNO $turn ====="
      echo "USER: $prompt"
      echo "ASSISTANT: $text"
      if [ -n "$reasoning" ]; then echo "REASONING: $reasoning"; fi
      echo "META: n_prompt=$n_prompt n_past=$n_past tokens=$tokens tok_s=$tok_s prefill_s=$prefill_s cache_hit_pct=$cache_hit ttft_s=$ttft_s"
      echo
    } >> "$CONV_TXT"

    # energy estimate: |I| in uA, V in mV, time in s → J = V*I*t with V in V, I in A
    # use average of start/end |current|
    local energy_J jpt
    energy_J=$(python3 -c "
vs=$volt_s; ve=$volt_e; cs=abs($curr_s); ce=abs($curr_e); t=$elapsed
v=((vs+ve)/2)/1000.0
i=((cs+ce)/2)/1e6
print(round(v*i*t, 3))
")
    jpt=$(python3 -c "
tok=max(int(float('$tokens')),1); e=float('$energy_J'); print(round(e/tok, 4))
")

    # mib_tok for prefill interval: rb_delta whole turn / n_prompt is rough;
    # better: we cannot split prefill/decode IO perfectly; report rb_delta and note whole-turn
    notes="whole_turn_io;mib_per_prompt_tok=$(python3 -c "print(round(($rb_d/1048576.0)/max(int(float('$n_prompt')),1),4))")"

    echo "$turn,$TAG,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$prefill_tps,$ttft_s,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$cache_res,$rb_s,$rb_e,$rb_d,$rchar_s,$rchar_e,$rchar_d,$rss_s,$rss_e,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$volt_s,$curr_s,$volt_e,$curr_e,$energy_J,$jpt,$stopped_reason,$notes" >> "$TURNS_CSV"

    # save raw done line
    echo "$done_line" >> "$OUTDIR/done_lines.jsonl"
    return 0
  fi

  # failure row
  echo "$turn,$TAG,$wall_s,$wall_e,$elapsed,0,0,0,0,0,0,0,-1,0,0,0,0,0,$rb_s,$rb_e,$rb_d,$rchar_s,$rchar_e,$rchar_d,$rss_s,$rss_e,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$volt_s,$curr_s,$volt_e,$curr_e,0,0,$stopped_reason,$notes" >> "$TURNS_CSV"
  return 1
}

STOPPED_AT=""
STOP_REASON=""

# Turn 1: clear_kv can be true or false (empty history). Use false for uniform path.
# Actually first turn with clear_kv=true is the clean "new chat". Then false thereafter.
# session.md: clear_kv true drops KV; first message either way is full prefill.
for t in 1 2 3 4 5 6 7 8; do
  # safety BEFORE turn (and after previous)
  sc=$(safety_check) || true
  log "safety_pre_turn$t: $sc"
  echo "$sc" >> "$SAFETY_LOG"
  case "$sc" in
    STOP_*)
      STOPPED_AT=$t
      STOP_REASON=$sc
      log "SAFETY STOP before turn $t: $sc"
      break
      ;;
  esac
  if ! kill -0 "$BMOE_PID" 2>/dev/null; then
    STOPPED_AT=$t
    STOP_REASON="PROCESS_DEAD"
    log "bmoe dead before turn $t"
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
  esac

  echo "turn${t}_run" > "$OUTDIR/phase.txt"
  if ! run_turn "$t" "$PROMPT" "$CK"; then
    # check if process died
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      STOPPED_AT=$t
      STOP_REASON="PROCESS_DEAD_DURING"
      log "process died during turn $t"
      break
    fi
    # recoverable error? try continue once
    log "turn $t returned failure; checking safety"
  fi

  # safety AFTER turn
  sc=$(safety_check) || true
  log "safety_post_turn$t: $sc"
  echo "post_turn$t $sc" >> "$SAFETY_LOG"
  case "$sc" in
    STOP_*)
      STOPPED_AT=$((t+1))
      STOP_REASON=$sc
      log "SAFETY STOP after turn $t: $sc"
      break
      ;;
  esac

  # NO COOLDOWN — deliberate
  log "NO COOLDOWN — next turn immediately"
done

# close session
log "sending close"
printf '%s\n' '{"cmd":"close"}' >&3 || true
sleep 2
# close fifo writer
exec 3>&- || true

# give process a moment, then if still up leave it (or soft terminate)
if kill -0 "$BMOE_PID" 2>/dev/null; then
  log "bmoe still alive after close; waiting up to 30s"
  for i in $(seq 1 30); do
    kill -0 "$BMOE_PID" 2>/dev/null || break
    sleep 1
  done
fi
if kill -0 "$BMOE_PID" 2>/dev/null; then
  log "sending TERM to bmoe $BMOE_PID"
  kill -TERM "$BMOE_PID" 2>/dev/null || true
  sleep 3
fi
if kill -0 "$BMOE_PID" 2>/dev/null; then
  log "sending KILL to bmoe $BMOE_PID"
  kill -KILL "$BMOE_PID" 2>/dev/null || true
fi

# stop sampler
kill "$SAMPLER_PID" 2>/dev/null || true
wait "$SAMPLER_PID" 2>/dev/null || true

# final batt / die / mem
BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_END" > "$OUTDIR/batt_end.json"
DIE_END=$(max_die_mc)
MEM_MIN=$(awk -F, 'NR>1{if(m==""||$9+0<m)m=$9+0} END{print m+0}' "$SAMPLER_LOG")
RSS_MAX=$(awk -F, 'NR>1{if($8+0>m)m=$8+0} END{print m+0}' "$SAMPLER_LOG")
DIE_MAX=$(awk -F, 'NR>1{if($5+0>m)m=$5+0} END{printf "%.1f", m+0}' "$SAMPLER_LOG")

log "die_end_mc=$DIE_END die_max_c=$DIE_MAX memfree_min_kb=$MEM_MIN rss_max_kb=$RSS_MAX"
log "batt_end: $BATT_END"
log "stopped_at=$STOPPED_AT reason=$STOP_REASON"

{
  echo "DONE $(ts)"
  echo "stopped_at=$STOPPED_AT"
  echo "stop_reason=$STOP_REASON"
  echo "die_max_c=$DIE_MAX"
  echo "memfree_min_kb=$MEM_MIN"
  echo "rss_max_kb=$RSS_MAX"
  echo "nproc_start=$NPROC"
  echo "cpuset=$CPUSET"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "n_ctx=$N_CTX"
  echo "tag=$TAG"
} > "$STATUS"

log "=== F5.1 COMPLETE ==="
exit 0
