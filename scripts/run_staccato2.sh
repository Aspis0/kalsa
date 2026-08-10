#!/data/data/com.termux/files/usr/bin/bash
# run_staccato2.sh — misure DA STACCATO parte 2: SOLO celle 2-3-4
# Correzioni: preflight re-promote nproc, STATUS onesto (no winner finto),
# OUTDIR=staccato2. Binario SOLO bmoe-cli.CAMPAIGN (pin). Niente ALLOW_UNPINNED.
# Flight recorder obbligatorio. UNPLUGGED hard-gate per cella.
# screen_off_timeout gestito dal lato host (adb) prima/dopo la sessione.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/staccato2}"
mkdir -p "$OUTDIR"/{cella1,cella2,cella3,cella4,prompts} "$TMPDIR"
MASTER="$OUTDIR/STACCATO2.master.log"
PIDFILE="$OUTDIR/staccato2.pid"
STATUS="$OUTDIR/STATUS.txt"
FLIGHT_LOG="$OUTDIR/flight.log"
FLIGHT_PIDF="$OUTDIR/flight.pid"
RUNS_CSV="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
CELL_CSV="$OUTDIR/cells.csv"
TURNS_CSV="$OUTDIR/cella1/turns.csv"
TAG_PHASE="STACCATO2"
SKIPPED_CELLS=()

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-cab20432}"

THREADS=4
N_CTX=4096
IO_THREADS=4
DIE_STOP_MC=98000
DIE_START_MC=80000
BATT_STOP=30
# TAG_PHASE set above to STACCATO2

# --- campaign pin ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts"
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
  case "$BIN" in *.CAMPAIGN) ;; *)
    echo "ERRORE pin: usare bmoe-cli.CAMPAIGN" >&2; exit 6;;
  esac
  if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
    echo "ERRORE pin sha mismatch got=$_got exp=$_exp" >&2; exit 6
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"

# --- guardrail termico/memoria (lib comune, post-riavvio #2) ---
_GR_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_guardrails.sh" ] && _GR_LIB="$_d/lib_guardrails.sh" && break
done
if [ -n "$_GR_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_GR_LIB"
else
  echo "WARN: lib_guardrails.sh assente — solo HARD STOP 98°C legacy" >&2
fi

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

max_die_mc() {
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in cpu-*|cpuss-*|*cpu*|*CPU*)
      v=$(cat "$z/temp" 2>/dev/null || echo 0)
      if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
    ;; esac
  done
  echo "$max"
}
mc_to_c() { awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }

batt_json() {
  # termux-api can hang under memory pressure — hard timeout 5s
  timeout 5 termux-battery-status 2>/dev/null || echo '{}'
}
batt_fields() {
  # Prefer /sys + dumpsys fallback if termux-api hangs
  local out
  out=$(timeout 5 termux-battery-status 2>/dev/null || true)
  if [ -n "$out" ] && echo "$out" | grep -q 'percentage'; then
    echo "$out" | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0),
        d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
    return 0
  fi
  # fallback: capacity from sysfs + UNPLUGGED assumed (campaign is unplugged-only)
  local pct temp
  pct=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo -1)
  temp=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo -1)
  if [ "$temp" -gt 100 ] 2>/dev/null; then
    temp=$(python3 -c "print(round($temp/10.0,1))" 2>/dev/null || echo -1)
  fi
  # status: Charging/Discharging/Full
  local st pl="UNPLUGGED"
  st=$(cat /sys/class/power_supply/battery/status 2>/dev/null || echo Unknown)
  case "$st" in Charging|Full) pl="PLUGGED";; esac
  echo "$pct -1 0 $temp $pl"
}

kill_bmoe() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*|*/bmoe-cli\ *)
      case "$cmd" in *run_staccato*) ;; *)
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
      ;; esac
    ;; esac
  done
  sleep 1
}

# flight recorder ~5s: ts, die, memfree, batt% with fsync
start_flight() {
  if [ -f "$FLIGHT_PIDF" ] && kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "flight already running pid=$(cat "$FLIGHT_PIDF")"
    return 0
  fi
  : > "$FLIGHT_LOG"
  echo "ts_epoch,ts_local,die_c,memfree_kb,batt_pct,plugged" > "$FLIGHT_LOG"
  (
    while :; do
      now=$(date +%s.%N 2>/dev/null || date +%s)
      iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      die=$(mc_to_c "$(max_die_mc)")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      read -r bp _ _ _ pl <<<"$(batt_fields)"
      echo "${now},${iso},${die},${mf},${bp},${pl}" >> "$FLIGHT_LOG"
      # fsync parent dir of flight log
      python3 -c "import os; f=open('$FLIGHT_LOG','a'); os.fsync(f.fileno()); f.close()" 2>/dev/null || true
      sleep 5
    done
  ) &
  echo $! > "$FLIGHT_PIDF"
  log "flight started pid=$(cat "$FLIGHT_PIDF")"
}

check_flight() {
  if [ ! -f "$FLIGHT_PIDF" ] || ! kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "WARN flight dead — restarting"
    start_flight
  fi
}

stop_flight() {
  if [ -f "$FLIGHT_PIDF" ]; then
    kill "$(cat "$FLIGHT_PIDF")" 2>/dev/null || true
    rm -f "$FLIGHT_PIDF"
  fi
}

# Best-effort re-promote Termux to top-app (wake-lock + am start).
# Host-side adb also polls REPROMOTE.request and does am start / keyevent.
repromote_termux() {
  termux-wake-lock >/dev/null 2>&1 || true
  # signal host to re-promote via adb
  echo "$(ts) nproc=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null)" > "$OUTDIR/REPROMOTE.request"
  # try local am (may fail under non-shell uid — best effort)
  /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
  # non-blocking notification for human
  termux-notification --id staccato2 --title "STACCATO2 nproc" \
    --content "nproc=$(nproc): tieni Termux foreground / schermo acceso" >/dev/null 2>&1 || true
}

# Preflight per cella: UNPLUGGED, die≤80, nproc≥6 (retry 30s × max 10 min), batt≥30
preflight_cella() {
  local cell="$1"
  check_flight
  local n die_mc die_c
  n=$(nproc)
  die_mc=$(max_die_mc)
  die_c=$(mc_to_c "$die_mc")
  read -r batt _ _ btemp plugged <<<"$(batt_fields)"
  log "PREFLIGHT $cell nproc=$n die=${die_c}C batt=$batt% plugged=$plugged btemp=$btemp"

  if [ "$plugged" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED=$plugged — run NON parte, NON entra nel CSV"
    echo "FATAL_PLUGGED $cell $(ts)" > "$STATUS"
    echo "PLUGGED" > "$OUTDIR/STOP_REASON.txt"
    return 4
  fi
  # batt=-1 means sensor timeout (termux-api hang), NOT empty battery — re-read, never FATAL on unknown
  if [ "$batt" -lt 0 ] 2>/dev/null; then
    log "WARN batt unknown ($batt) — re-read"
    sleep 2
    read -r batt _ _ btemp plugged <<<"$(batt_fields)"
    log "batt re-read=$batt plugged=$plugged"
  fi
  if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "FATAL batt=$batt < $BATT_STOP — sessione ferma"
    echo "FATAL_BATT $cell batt=$batt $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  # wait for top-app (nproc≥6) AND die cool — re-promote every 30s, max 10 min (mandato correzione 2)
  local t0 now
  t0=$(date +%s)
  while :; do
    n=$(nproc)
    die_mc=$(max_die_mc)
    die_c=$(mc_to_c "$die_mc")
    read -r batt _ _ _ plugged <<<"$(batt_fields)"
    if [ "$plugged" != "UNPLUGGED" ]; then
      log "FATAL became PLUGGED during preflight wait"
      return 4
    fi
    if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
      log "FATAL batt low during preflight wait"
      return 92
    fi
    if [ "$n" -ge 6 ] && [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null; then
      rm -f "$OUTDIR/REPROMOTE.request"
      break
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge 600 ]; then
      if [ "$n" -lt 6 ]; then
        log "FATAL nproc=$n < 6 after 600s wait (cpuset=$(cat /proc/self/cpuset 2>/dev/null)) — re-promote failed"
        echo "FATAL_NPROC $cell nproc=$n $(ts)" > "$STATUS"
        echo "NPROC_LOW" > "$OUTDIR/STOP_REASON.txt"
        echo "SKIPPED $cell nproc=$n after 600s re-promote" >> "$OUTDIR/SKIPPED.txt"
        return 93
      fi
      log "WARN die still ${die_c}C after 600s — proceed cautiously"
      break
    fi
    log "preflight wait cell=$cell nproc=$n die=${die_c}C cpuset=$(cat /proc/self/cpuset 2>/dev/null) — re-promote"
    repromote_termux
    sleep 30
  done
  n=$(nproc)
  if [ "$n" -lt 6 ]; then
    log "FATAL nproc=$n < 6"
    echo "FATAL_NPROC $cell $(ts)" > "$STATUS"
    echo "NPROC_LOW" > "$OUTDIR/STOP_REASON.txt"
    echo "SKIPPED $cell nproc=$n" >> "$OUTDIR/SKIPPED.txt"
    return 93
  fi
  log "PREFLIGHT $cell OK die=$(mc_to_c "$(max_die_mc)")C batt=$batt nproc=$n cpuset=$(cat /proc/self/cpuset 2>/dev/null)"
  return 0
}

safety_hard() {
  local die_mc
  die_mc=$(max_die_mc)
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    log "HARD_STOP die=$(mc_to_c "$die_mc")C"
    kill_bmoe
    echo "HARD_STOP_DIE $(ts)" > "$STATUS"
    echo "DIE_98" > "$OUTDIR/STOP_REASON.txt"
    return 99
  fi
  read -r batt _ _ _ plugged <<<"$(batt_fields)"
  if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "HARD_STOP batt=$batt"
    kill_bmoe
    echo "HARD_STOP_BATT $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  return 0
}

# lmkd event count since boot (or since mark) — always one integer line
lmkd_count() {
  local n
  # logcat -d can be huge/slow under load — hard timeout 8s
  n=$(timeout 8 logcat -d 2>/dev/null | grep -cE 'lowmemorykiller|lmkd|Kill.*lmk' 2>/dev/null || true)
  n=${n//$'\n'/}
  n=${n//[^0-9]/}
  if [ -z "$n" ]; then n=0; fi
  printf '%s' "$n"
}

# ensure runs.csv header
ensure_runs_header() {
  if [ ! -f "$RUNS_CSV" ] || [ ! -s "$RUNS_CSV" ]; then
    echo "run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,battery_pct,expert_hit_rate,nproc,affinity_mask,notes" > "$RUNS_CSV"
  fi
}

append_run() {
  # args as single CSV line already sanitized
  echo "$1" >> "$RUNS_CSV"
  echo "$1" >> "$OUTDIR/runs_added.csv"
}

# ── F5.1 prompts (byte-identical to start_f5_1.sh P1–P5) ──
archive_prompts() {
  P1='Ciao! Sto pianificando un viaggio di 7 giorni in Sicilia partendo da Milano a metà settembre. Budget circa 1200 euro a persona, volo incluso. Preferisco mare e un po di cultura, niente resort tutto incluso. Dammi una bozza di itinerario giorno per giorno, realistica sui tempi di spostamento. Rispondi in italiano, max 250 parole.'
  P2='Grazie. Sulla base di quello che hai proposto, concentriamoci sui primi 3 giorni: dove dormiresti (fascia 70-100 euro/notte) e quale mezzo useresti tra Catania e le altre tappe? Voglio alternative concrete, non generiche. Sempre in italiano, max 250 parole.'
  P3='Ok, tengo la tua idea sul mezzo. Pero ho un vincolo nuovo: viaggio con un bambino di 6 anni, quindi niente tappe troppo lunghe in auto e mi serve almeno una spiaggia balneabile facile. Come rivedi i primi 3 giorni? Cita esplicitamente cosa cambi rispetto a prima. Italiano, max 250 parole.'
  P4='Perfetto. Ora il budget: spezzami i 1200 euro a persona (volo, alloggio 6 notti, cibo, spostamenti, attivita) con stime plausibili basate sull itinerario rivisto. Se sforiamo, dimmi dove tagliare senza rovinare il viaggio col bambino. Italiano, max 250 parole.'
  P5='Sul cibo: proponi 4 posti (anche semplici) coerenti con le tappe che hai scelto, uno per zona, con cosa ordinare di tipico e una fascia di prezzo a persona. Niente catene internazionali. Italiano, max 250 parole.'
  printf '%s' "$P1" > "$OUTDIR/prompts/f5_1_t1.txt"
  printf '%s' "$P2" > "$OUTDIR/prompts/f5_1_t2.txt"
  printf '%s' "$P3" > "$OUTDIR/prompts/f5_1_t3.txt"
  printf '%s' "$P4" > "$OUTDIR/prompts/f5_1_t4.txt"
  printf '%s' "$P5" > "$OUTDIR/prompts/f5_1_t5.txt"
  {
    echo "prompt,sha256,bytes"
    for i in 1 2 3 4 5; do
      f="$OUTDIR/prompts/f5_1_t${i}.txt"
      echo "f5_1_t${i},$(sha256sum "$f" | awk '{print $1}'),$(wc -c < "$f")"
    done
    for name in short f45_1_esplicativo d1_long; do
      f="$PROMPTS_DIR/${name}.txt"
      echo "${name},$(sha256sum "$f" | awk '{print $1}'),$(wc -c < "$f")"
    done
  } > "$OUTDIR/prompt_sha256.txt"
  log "prompt sha archived → $OUTDIR/prompt_sha256.txt"
  cat "$OUTDIR/prompt_sha256.txt" | tee -a "$MASTER"
}

# ═══════════════════════════════════════════════════════════
# CELLA 1 — multi-turno 5 turni × 2 rep
# ═══════════════════════════════════════════════════════════
run_cella1() {
  local rep="$1"
  local sdir="$OUTDIR/cella1/rep${rep}"
  mkdir -p "$sdir"
  local SESSION_LOG="$sdir/session.stdout.log"
  local SESSION_ERR="$sdir/session.stderr.log"
  local REQ_FIFO="$sdir/req.fifo"
  local CONV="$sdir/conversation.txt"
  local DONE_JL="$sdir/done_lines.jsonl"
  local SAMP="$sdir/sampler.csv"
  : > "$SESSION_LOG"; : > "$SESSION_ERR"; : > "$CONV"; : > "$DONE_JL"
  echo "ts_epoch_ms,ts_iso,pid,alive,die_max_c,read_bytes,rchar,vmrss_kb,memfree_kb,phase" > "$SAMP"

  log "==== CELLA1 rep=$rep START ===="
  preflight_cella "cella1_rep${rep}" || return $?

  # cold only at conversation start
  log "cold_model (cella1 rep$rep)"
  kill_bmoe
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "FATAL cold_model cella1"; return 2
  fi

  local CACHE_MB=2000 UBATCH=512 N_PREDICT=256
  local FLAGS="-m $MODEL -t $THREADS -c $N_CTX -n $N_PREDICT --temp 0 --chatml --no-think --moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH} --drop-cold-experts 0.50 --session"

  rm -f "$REQ_FIFO"
  mkfifo "$REQ_FIFO"
  # shellcheck disable=SC2086
  "$BIN" $FLAGS < "$REQ_FIFO" > "$SESSION_LOG" 2> "$SESSION_ERR" &
  local BMOE_PID=$!
  echo "$BMOE_PID" > "$sdir/bmoe.pid"
  exec 3>"$REQ_FIFO"
  log "cella1 rep$rep bmoe pid=$BMOE_PID"

  # sampler
  (
    echo "load" > "$sdir/phase.txt"
    while kill -0 "$BMOE_PID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      now_iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      die_c=$(mc_to_c "$(max_die_mc)")
      rb=0; rc=0; rss=0
      [ -r "/proc/$BMOE_PID/io" ] && rb=$(awk '/^read_bytes:/{print $2}' "/proc/$BMOE_PID/io")
      [ -r "/proc/$BMOE_PID/io" ] && rc=$(awk '/^rchar:/{print $2}' "/proc/$BMOE_PID/io")
      [ -r "/proc/$BMOE_PID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BMOE_PID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ph=$(cat "$sdir/phase.txt" 2>/dev/null || echo "?")
      alive=1; kill -0 "$BMOE_PID" 2>/dev/null || alive=0
      echo "${now_ms},${now_iso},${BMOE_PID},${alive},${die_c},${rb},${rc},${rss},${mf},${ph}" >> "$SAMP"
      sleep 0.5
    done
  ) &
  local SAMP_PID=$!

  # wait READY
  local t0 now
  t0=$(date +%s)
  while ! grep -q 'BMOE_READY' "$SESSION_LOG" 2>/dev/null; do
    if ! kill -0 "$BMOE_PID" 2>/dev/null; then
      log "FATAL load die rep$rep"; cat "$SESSION_ERR" | tail -30 >> "$MASTER"
      return 2
    fi
    now=$(date +%s)
    if [ $((now - t0)) -gt 900 ]; then log "FATAL READY timeout"; return 2; fi
    if grep -q 'BMOE_ERROR' "$SESSION_LOG" 2>/dev/null; then
      log "FATAL BMOE_ERROR load"; grep BMOE_ERROR "$SESSION_LOG" | head -3 >> "$MASTER"
      return 2
    fi
    sleep 1
  done
  log "READY rep$rep: $(grep BMOE_READY "$SESSION_LOG" | head -1)"

  json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")' <<<"$1"; }
  json_get() {
    local line="$1" key="$2"
    echo "$line" | sed -n "s/.*\"${key}\":\([0-9.][0-9.]*\).*/\1/p" | head -1
  }
  json_get_str() {
    python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import sys,json,re
line,key=sys.argv[1],sys.argv[2]
try:
    obj=json.loads(line.split(' ',1)[1] if ' ' in line else line)
    v=obj.get(key,"")
    print(v if not isinstance(v,str) else v)
except Exception:
    m=re.search(r'"%s"\s*:\s*"((?:\\.|[^"\\])*)"'%re.escape(key), line)
    if m: print(m.group(1))
PY
  }

  wait_done() {
    local id="$1" timeout_s="$2" t0 now
    t0=$(date +%s)
    while :; do
      if ! kill -0 "$BMOE_PID" 2>/dev/null; then echo "DEAD"; return 1; fi
      if grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        grep -E "BMOE_DONE \{\"id\":${id}[,}]" "$SESSION_LOG" | tail -1
        return 0
      fi
      if grep -E "BMOE_ERROR \{\"id\":${id}[,}]" "$SESSION_LOG" >/dev/null 2>&1; then
        echo "ERROR"; return 2
      fi
      now=$(date +%s)
      if [ $((now - t0)) -gt "$timeout_s" ]; then echo "TIMEOUT"; return 3; fi
      # hard safety mid-wait
      if [ "$(max_die_mc)" -gt "$DIE_STOP_MC" ] 2>/dev/null; then echo "DIE"; return 99; fi
      sleep 0.5
    done
  }

  local t
  for t in 1 2 3 4 5; do
    safety_hard || { exec 3>&-; kill "$SAMP_PID" 2>/dev/null || true; return $?; }
    check_flight
    local PROMPT CK
    case $t in
      1) PROMPT=$(cat "$OUTDIR/prompts/f5_1_t1.txt"); CK=true ;;
      2) PROMPT=$(cat "$OUTDIR/prompts/f5_1_t2.txt"); CK=false ;;
      3) PROMPT=$(cat "$OUTDIR/prompts/f5_1_t3.txt"); CK=false ;;
      4) PROMPT=$(cat "$OUTDIR/prompts/f5_1_t4.txt"); CK=false ;;
      5) PROMPT=$(cat "$OUTDIR/prompts/f5_1_t5.txt"); CK=false ;;
    esac
    echo "turn${t}" > "$sdir/phase.txt"
    log "C1 rep$rep TURN $t clear_kv=$CK"

    read -r batt_s _ _ btemp_s plugged_s <<<"$(batt_fields)"
    if [ "$plugged_s" != "UNPLUGGED" ]; then
      log "FATAL PLUGGED mid-cella1"; exec 3>&-; return 4
    fi
    local die_s wall_s wall_s_e
    die_s=$(mc_to_c "$(max_die_mc)")
    wall_s=$(ts)
    wall_s_e=$(date +%s)

    local esc req
    esc=$(json_escape "$PROMPT")
    req=$(printf '{"cmd":"generate","id":%d,"prompt":%s,"n_predict":%d,"think":false,"clear_kv":%s}' \
      "$t" "$esc" "$N_PREDICT" "$CK")
    printf '%s\n' "$req" >&3

    local done_line rc
    set +e
    done_line=$(wait_done "$t" 2400)
    rc=$?
    set -e

    local wall_e wall_e_e elapsed
    wall_e=$(ts)
    wall_e_e=$(date +%s)
    elapsed=$((wall_e_e - wall_s_e))
    local die_e
    die_e=$(mc_to_c "$(max_die_mc)")
    read -r batt_e _ _ btemp_e _ <<<"$(batt_fields)"

    local n_prompt=0 n_past=0 tokens=0 tok_s=0 prefill_s=0 prefill_tps=0 cache_hit=-1
    local n_common=0 text=""
    if [ $rc -eq 0 ]; then
      n_prompt=$(json_get "$done_line" n_prompt); n_prompt=${n_prompt:-0}
      n_past=$(json_get "$done_line" n_past); n_past=${n_past:-0}
      tokens=$(json_get "$done_line" tokens); tokens=${tokens:-0}
      tok_s=$(json_get "$done_line" tok_s); tok_s=${tok_s:-0}
      prefill_s=$(json_get "$done_line" prefill_s); prefill_s=${prefill_s:-0}
      prefill_tps=$(json_get "$done_line" prefill_tps); prefill_tps=${prefill_tps:-0}
      cache_hit=$(json_get "$done_line" cache_hit_pct); cache_hit=${cache_hit:--1}
      text=$(json_get_str "$done_line" text)
      # n_common ≈ n_past - n_prompt - tokens (session reports n_prompt as THIS-turn prefill)
      n_common=$(python3 -c "print(max(0, int(float('$n_past'))-int(float('$n_prompt'))-int(float('$tokens'))))")
      echo "$done_line" >> "$DONE_JL"
      {
        echo "===== TURNO $t rep$rep ====="
        echo "USER: $PROMPT"
        echo "ASSISTANT: $text"
        echo "META: n_prompt=$n_prompt n_past=$n_past n_common=$n_common tokens=$tokens tok_s=$tok_s prefill_s=$prefill_s hit=$cache_hit wall=$elapsed"
        echo
      } >> "$CONV"
      log "C1 r$rep T$t DONE n_prompt=$n_prompt n_common=$n_common n_past=$n_past prefill_s=$prefill_s tok_s=$tok_s wall=${elapsed}s"
    else
      log "C1 r$rep T$t FAIL rc=$rc line=$done_line"
    fi

    # turns.csv
    echo "rep${rep},$t,STACCATO-C1,$wall_s,$wall_e,$elapsed,$n_prompt,$n_common,$n_past,$tokens,$tok_s,$prefill_s,$prefill_tps,$cache_hit,$die_s,$die_e,$batt_s,$batt_e,$rc" >> "$TURNS_CSV"

    # runs.csv row
    local run_id flags_s
    run_id="staccato-c1-r${rep}-t${t}-$(date +%Y%m%d-%H%M%S)"
    flags_s="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --drop-cold-experts 0.50 --session clear_kv=$CK"
    local ttft_ms
    ttft_ms=$(python3 -c "print(int(float('${prefill_s:-0}')*1000))")
    append_run "${run_id},$(date -Iseconds),${TAG_PHASE}-C1,Qwen3.6-35B-A3B-UD-IQ2_M,UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},${flags_s//,/;},4,4096,f16,256,warm,f5_1_t${t},${prefill_tps},${tok_s},${ttft_ms},,,,,,${btemp_s},${btemp_e},${batt_s},${cache_hit}%,$(nproc),,bin_sha256=${BIN_SHA256};n_prompt=${n_prompt};n_common=${n_common};n_past=${n_past};wall_s=${elapsed};rep=${rep}"

    if [ $rc -ne 0 ]; then
      log "abort cella1 rep$rep at turn $t"
      break
    fi
  done

  printf '%s\n' '{"cmd":"close"}' >&3 || true
  sleep 2
  exec 3>&- || true
  if kill -0 "$BMOE_PID" 2>/dev/null; then
    sleep 5
    kill -TERM "$BMOE_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$BMOE_PID" 2>/dev/null || true
  fi
  kill "$SAMP_PID" 2>/dev/null || true
  wait "$SAMP_PID" 2>/dev/null || true
  log "==== CELLA1 rep=$rep DONE ===="
  return 0
}

# ═══════════════════════════════════════════════════════════
# Single-turn measured run (cella 2/3/4)
# ═══════════════════════════════════════════════════════════
run_single() {
  # args: label prompt_file prompt_id n_gen cache_mb ubatch n_expert_used run_type notes_extra out_prefix
  local label="$1" pfile="$2" pid="$3" ngen="$4" cmb="$5" ub="$6" nex="$7" rtype="$8" notesx="$9" opfx="${10}"
  local slog="${opfx}.stdout.log"
  local serr="${opfx}.stderr.log"
  local samp="${opfx}.sampler.csv"
  local sumf="${opfx}.summary.txt"
  : > "$slog"; : > "$serr"
  echo "ts_epoch_ms,die_c,vmrss_kb,vmhwm_kb,memfree_kb" > "$samp"

  log "---- single $label pid=$pid n=$ngen cache=$cmb ubatch=$ub ----"
  safety_hard || return $?
  check_flight

  read -r batt_s _ _ btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED before $label — skip CSV"
    return 4
  fi
  local die_s nproc_s
  die_s=$(mc_to_c "$(max_die_mc)")
  nproc_s=$(nproc)
  local lmkd_s
  lmkd_s=$(lmkd_count)

  local EXTRA=""
  if [ -n "$nex" ] && [ "$nex" != "0" ]; then
    EXTRA="--n-expert-used $nex"
  fi
  # -p takes PROMPT TEXT (not a path). Read file contents.
  local ptext
  ptext=$(cat "$pfile")
  local FLAGS=(
    -m "$MODEL" -p "$ptext" -t "$THREADS" -c "$N_CTX" -n "$ngen"
    --temp 0 --chatml --no-think --moe-stream
    --cache-mb "$cmb" --dense-weights anon --overlap
    --io-threads "$IO_THREADS" --ubatch "$ub"
    --drop-cold-experts 0.50
  )
  if [ -n "$EXTRA" ]; then
    # shellcheck disable=SC2206
    FLAGS+=(--n-expert-used "$nex")
  fi

  "$BIN" "${FLAGS[@]}" > "$slog" 2> "$serr" &
  local BPID=$!
  echo "$BPID" > "${opfx}.pid"

  # sampler + capture VmHWM/memfree + guardrail 88°C/60s PAUSA, MemFree<100MiB/10s ABORT_MEM
  (
    guardrails_reset 2>/dev/null || true
    while kill -0 "$BPID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_mc=$(max_die_mc)
      die_c=$(mc_to_c "$die_mc")
      rss=0; hwm=0
      [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      [ -r "/proc/$BPID/status" ] && hwm=$(awk '/^VmHWM:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      echo "${now_ms},${die_c},${rss},${hwm},${mf}" >> "$samp"
      if type guardrail_tick >/dev/null 2>&1; then
        guardrail_tick "$die_mc" "${mf:-0}"
        if [ "$GR_ACTION" != "CONTINUE" ]; then
          guardrail_apply_to_pid "$BPID" "$opfx"
          echo "$?" > "${opfx}.guardrail_rc"
          break
        fi
      else
        if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
          kill -TERM "$BPID" 2>/dev/null || true
        fi
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!

  local wall_s wall_e elapsed
  wall_s=$(date +%s)
  set +e
  wait "$BPID"
  local brc=$?
  set -e
  wall_e=$(date +%s)
  elapsed=$((wall_e - wall_s))
  kill "$SPID" 2>/dev/null || true
  wait "$SPID" 2>/dev/null || true

  # Guardrail post-run: thermal pause → cool; ABORT_MEM → stop cell
  local grc=0
  if [ -f "${opfx}.guardrail_rc" ]; then
    grc=$(cat "${opfx}.guardrail_rc" 2>/dev/null || echo 0)
    rm -f "${opfx}.guardrail_rc"
  fi
  if [ "$grc" = "97" ]; then
    log "THERMAL_PAUSE $label — wait cool <80C"
    if type guardrail_thermal_wait_cool >/dev/null 2>&1; then
      if guardrail_thermal_wait_cool 600; then
        echo "THERMAL_PAUSE_COOLED $(ts) $label" > "$STATUS"
        brc=97
      else
        echo "THERMAL_PAUSE_ABORT $(ts) $label" > "$STATUS"
        echo "THERMAL_PAUSE_TIMEOUT" > "$OUTDIR/STOP_REASON.txt"
        return 97
      fi
    else
      brc=97
    fi
  elif [ "$grc" = "96" ]; then
    log "ABORT_MEM $label — cella interrotta"
    echo "ABORT_MEM $(ts) $label" > "$STATUS"
    echo "ABORT_MEM" > "$OUTDIR/STOP_REASON.txt"
    brc=96
  elif [ "$grc" = "99" ]; then
    log "HARD_STOP_DIE $label"
    echo "HARD_STOP_DIE $(ts) $label" > "$STATUS"
    echo "DIE_98" > "$OUTDIR/STOP_REASON.txt"
    return 99
  fi

  read -r batt_e _ _ btemp_e _ <<<"$(batt_fields)"
  local die_e
  die_e=$(mc_to_c "$(max_die_mc)")
  local lmkd_e lmkd_d
  lmkd_e=$(lmkd_count)
  lmkd_s=${lmkd_s:-0}
  lmkd_e=${lmkd_e:-0}
  lmkd_d=$((lmkd_e - lmkd_s))
  if [ "$lmkd_d" -lt 0 ] 2>/dev/null; then lmkd_d=0; fi

  # parse timings from log (prefer stdout, then stderr; cat avoids dual-file grep headers)
  local prompt_tok_s="" eval_tok_s="" ttft_ms="" hit="" n_prompt=""
  local _combo
  _combo=$(cat "$slog" "$serr" 2>/dev/null || true)
  eval_tok_s=$(printf '%s\n' "$_combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  prompt_tok_s=$(printf '%s\n' "$_combo" | grep -E 'prefill:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  local prefill_s_val=""
  prefill_s_val=$(printf '%s\n' "$_combo" | grep -E 'prefill:' | tail -1 | sed -n 's/.*prefill: *[0-9]* tokens, *\([0-9.]*\) s.*/\1/p' | head -1)
  ttft_ms=$(printf '%s\n' "$_combo" | grep -E 'TTFT' | tail -1 | sed -n 's/.*TTFT *\([0-9.]*\) s.*/\1/p' | head -1)
  if [ -n "$ttft_ms" ]; then
    ttft_ms=$(python3 -c "print(int(float('$ttft_ms')*1000))")
  fi
  hit=$(printf '%s\n' "$_combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.*moe-cache: *\([0-9.]*\)% hit.*/\1%/p' | head -1)
  n_prompt=$(printf '%s\n' "$_combo" | grep -E 'prefill: *[0-9]+ tokens' | tail -1 | sed -n 's/.*prefill: *\([0-9]*\) tokens.*/\1/p' | head -1)

  local memfree_min_kb vmhwm_max_kb
  memfree_min_kb=$(awk -F, 'NR>1{if(m==""||$5+0<m)m=$5+0} END{print m+0}' "$samp")
  vmhwm_max_kb=$(awk -F, 'NR>1{if($4+0>m)m=$4+0} END{print m+0}' "$samp")
  local memfree_min_mb vmrss_peak_mb
  memfree_min_mb=$(python3 -c "print(int($memfree_min_kb/1024))")
  vmrss_peak_mb=$(python3 -c "print(int($vmhwm_max_kb/1024))")

  {
    echo "label=$label"
    echo "rc=$brc"
    echo "wall_s=$elapsed"
    echo "prompt_tok_s=$prompt_tok_s"
    echo "eval_tok_s=$eval_tok_s"
    echo "prefill_s=$prefill_s_val"
    echo "ttft_ms=$ttft_ms"
    echo "n_prompt=$n_prompt"
    echo "expert_hit_rate=$hit"
    echo "memfree_min_mb=$memfree_min_mb"
    echo "vmhwm_mb=$vmrss_peak_mb"
    echo "lmkd_delta=$lmkd_d"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "die_s=$die_s die_e=$die_e"
    echo "bin_sha256=$BIN_SHA256"
  } > "$sumf"
  cat "$sumf" | tee -a "$MASTER"
  log "single $label DONE eval=${eval_tok_s} prefill_tps=${prompt_tok_s} hit=$hit memfree_min=${memfree_min_mb} lmkd_d=$lmkd_d wall=${elapsed}s rc=$brc"

  local run_id flags_s
  run_id="staccato-${label}-$(date +%Y%m%d-%H%M%S)"
  flags_s="--moe-stream --cache-mb ${cmb} --dense-weights anon --overlap --io-threads 4 --ubatch ${ub} --drop-cold-experts 0.50"
  if [ -n "$EXTRA" ]; then flags_s="$flags_s $EXTRA"; fi
  append_run "${run_id},$(date -Iseconds),${TAG_PHASE},${MODEL##*/},UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},${flags_s//,/;},4,4096,f16,${ngen},${rtype},${pid},${prompt_tok_s},${eval_tok_s},${ttft_ms},,,,${vmrss_peak_mb},${memfree_min_mb},${btemp_s},${btemp_e},${batt_s},${hit},${nproc_s},,bin_sha256=${BIN_SHA256};lmkd_delta=${lmkd_d};wall_s=${elapsed};n_prompt=${n_prompt};${notesx}"

  # cell csv
  echo "${label},${pid},${ngen},${cmb},${ub},${prompt_tok_s},${eval_tok_s},${prefill_s_val},${hit},${memfree_min_mb},${vmrss_peak_mb},${lmkd_d},${batt_s},${batt_e},${die_s},${die_e},${elapsed},${brc},${BIN_SHA256}" >> "$CELL_CSV"

  if [ $brc -ne 0 ]; then
    log "WARN $label rc=$brc"
  fi
  # Propagate guardrail abort/pause to caller
  if [ "$brc" = "96" ] || [ "$brc" = "97" ] || [ "$brc" = "99" ]; then
    return "$brc"
  fi
  return 0
}

# ═══════════════════════════════════════════════════════════
# CELLA 2 — cache sweep 2000/3000/3500
# ═══════════════════════════════════════════════════════════
run_cella2() {
  log "==== CELLA2 START ===="
  preflight_cella "cella2" || return $?
  local C rep p
  for C in 2000 3000 3500; do
    preflight_cella "cella2_C${C}" || return $?
    # skip entire cache tier if all 4 summaries already present
    local need_cold=0
    for p in short f45_1_esplicativo; do
      for rep in 1 2; do
        if [ ! -f "$OUTDIR/cella2/C${C}_${p}_r${rep}.summary.txt" ]; then need_cold=1; fi
      done
    done
    if [ "$need_cold" = "0" ]; then
      log "skip cache=$C (all 4 summaries present)"
      continue
    fi
    log "cold_model for cache=$C"
    kill_bmoe
    if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
      log "FATAL cold cache=$C"; return 2
    fi
    for p in short f45_1_esplicativo; do
      for rep in 1 2; do
        local opfx="$OUTDIR/cella2/C${C}_${p}_r${rep}"
        if [ -f "${opfx}.summary.txt" ]; then
          log "skip existing ${opfx}.summary.txt"
          continue
        fi
        # incomplete prior attempt (e.g. OOM mid-run): archive and retry
        if [ -f "${opfx}.stdout.log" ] || [ -f "${opfx}.pid" ]; then
          local bak="${opfx}.partial.$(date +%Y%m%d%H%M%S)"
          log "archive partial attempt → $bak"
          for ext in pid sampler.csv stderr.log stdout.log summary.txt KILL.txt; do
            [ -f "${opfx}.${ext}" ] && mv "${opfx}.${ext}" "${bak}.${ext}" 2>/dev/null || true
          done
          # also plain names without double ext for KILL
          [ -f "${opfx}.KILL.txt" ] && mv "${opfx}.KILL.txt" "${bak}.KILL.txt" 2>/dev/null || true
        fi
        preflight_cella "cella2_C${C}_${p}_r${rep}" || return $?
        # cool between runs if hot
        local die_mc
        die_mc=$(max_die_mc)
        if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
          log "cool before C${C} $p r$rep die=$(mc_to_c $die_mc)C"
          local t0 now
          t0=$(date +%s)
          while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
            now=$(date +%s)
            [ $((now-t0)) -ge 600 ] && break
            safety_hard || return $?
            sleep 10
          done
        fi
        # free memory before large cache
        if [ "$C" -ge 3000 ]; then
          log "extra drop_caches best-effort before C=$C"
          sync 2>/dev/null || true
          # cannot drop_caches without root; just kill residual and wait
          kill_bmoe
          sleep 3
        fi
        local pfile="$PROMPTS_DIR/${p}.txt"
        [ "$p" = "f45_1_esplicativo" ] && pfile="$PROMPTS_DIR/f45_1_esplicativo.txt"
        # run_single: if killed mid-run, still produce a summary with rc!=0 so resume can skip? better retry once
        set +e
        run_single "c2-C${C}-${p}-r${rep}" "$pfile" "$p" 200 "$C" 512 8 warm "cella=2;cache=${C};rep=${rep}" \
          "$opfx"
        local rsrc=$?
        set -e
        if [ $rsrc -eq 4 ] || [ $rsrc -eq 92 ] || [ $rsrc -eq 99 ]; then return $rsrc; fi
        # if process was OOM-killed, run_single may still return 0 after wait with brc!=0 — summary exists
        # if parent itself got killed, outer resume handles it
        if [ ! -f "${opfx}.summary.txt" ]; then
          log "WARN no summary for C${C} $p r$rep — recording as KILL/incomplete"
          {
            echo "label=c2-C${C}-${p}-r${rep}"
            echo "rc=137"
            echo "wall_s=0"
            echo "prompt_tok_s="
            echo "eval_tok_s="
            echo "prefill_s="
            echo "ttft_ms="
            echo "n_prompt="
            echo "expert_hit_rate="
            echo "memfree_min_mb=0"
            echo "vmhwm_mb=0"
            echo "lmkd_delta=1"
            echo "batt_s=-1 batt_e=-1"
            echo "die_s=-1 die_e=-1"
            echo "bin_sha256=$BIN_SHA256"
            echo "note=INCOMPLETE_OR_OOM"
          } > "${opfx}.summary.txt"
          echo "c2-C${C}-${p}-r${rep},${p},200,${C},512,,,INCOMPLETE,0,0,1,-1,-1,-1,-1,0,137,${BIN_SHA256}" >> "$CELL_CSV"
        fi
      done
    done
  done
  log "==== CELLA2 DONE ===="
  return 0
}

# decide winner cache from cella2 cell csv
# HONEST: if no data, print NODATA (never invent winner=2000)
decide_cache() {
  python3 - "$CELL_CSV" <<'PY'
import sys
path=sys.argv[1]
rows=[]
try:
    with open(path) as f:
        for line in f:
            parts=line.strip().split(',')
            if len(parts)<10: continue
            # label,pid,ngen,cmb,ub,prompt_tok_s,eval_tok_s,...
            if not parts[0].startswith('c2-'): continue
            try:
                cmb=int(parts[3]); evals=float(parts[6]) if parts[6] else None
                mf=int(parts[9]) if parts[9] else 0
                lmkd=int(parts[11]) if parts[11] else 0
            except Exception:
                continue
            if evals is None: continue
            rows.append((cmb,evals,mf,lmkd,parts[0]))
except FileNotFoundError:
    print('NODATA'); sys.exit(0)

if not rows:
    print('NODATA'); sys.exit(0)

from collections import defaultdict
by=defaultdict(list)
for cmb,evals,mf,lmkd,lab in rows:
    by[cmb].append((evals,mf,lmkd,lab))

def med(xs):
    xs=sorted(xs)
    n=len(xs)
    if n==0: return None
    return xs[n//2] if n%2 else 0.5*(xs[n//2-1]+xs[n//2])

base=by.get(2000,[])
base_med=med([e for e,_,_,_ in base]) if base else None
print(f"# baseline 2000 med_eval={base_med} n={len(base)}", file=sys.stderr)
if base_med is None:
    print('NODATA'); sys.exit(0)
winner=2000
for C in (3000,3500):
    rs=by.get(C,[])
    if not rs:
        print(f"# C={C} skip (no data)", file=sys.stderr)
        continue
    m=med([e for e,_,_,_ in rs])
    min_mf=min(mf for _,mf,_,_ in rs)
    max_lmkd=max(l for _,_,l,_ in rs)
    gain=(m/base_med - 1.0)*100 if base_med>0 else -999
    ok = (gain >= 5.0) and (max_lmkd == 0) and (min_mf > 300)
    print(f"# C={C} med={m:.3f} gain={gain:.2f}% min_mf={min_mf} max_lmkd={max_lmkd} ok={ok}", file=sys.stderr)
    if ok:
        winner=C
print(winner)
PY
}

# ═══════════════════════════════════════════════════════════
# CELLA 3 — ubatch 512 vs 2048
# ═══════════════════════════════════════════════════════════
run_cella3() {
  local WIN_C="$1"
  log "==== CELLA3 START win_cache=$WIN_C ===="
  preflight_cella "cella3" || return $?
  local ub rep
  for ub in 512 2048; do
    for rep in 1 2; do
      preflight_cella "cella3_ub${ub}_r${rep}" || return $?
      kill_bmoe
      if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
        log "FATAL cold cella3"; return 2
      fi
      # cool
      local t0 now
      t0=$(date +%s)
      while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
        now=$(date +%s); [ $((now-t0)) -ge 600 ] && break
        safety_hard || return $?
        sleep 10
      done
      # n=256: abbastanza per prefill+decode (mandato misure-staccato / staccato-3)
      run_single "c3-ub${ub}-r${rep}" "$PROMPTS_DIR/d1_long.txt" "d1_long" 256 "$WIN_C" "$ub" 8 warm "cella=3;ubatch=${ub};cache=${WIN_C};rep=${rep}" \
        "$OUTDIR/cella3/ub${ub}_r${rep}" || {
          local rc=$?
          # 96=ABORT_MEM, 97=THERMAL_PAUSE, 99=HARD_DIE, 4=PLUGGED
          if [ $rc -eq 4 ] || [ $rc -eq 92 ] || [ $rc -eq 96 ] || [ $rc -eq 97 ] || [ $rc -eq 99 ]; then return $rc; fi
        }
    done
  done
  log "==== CELLA3 DONE ===="
  return 0
}

decide_ubatch() {
  # HONEST: NODATA if no measurements (never invent winner=512)
  python3 - "$CELL_CSV" <<'PY'
import sys
path=sys.argv[1]
rows=[]
try:
    with open(path) as f:
        for line in f:
            parts=line.strip().split(',')
            if len(parts)<10: continue
            if not parts[0].startswith('c3-'): continue
            try:
                ub=int(parts[4]); pts=float(parts[5]) if parts[5] else None
                mf=int(parts[9]) if parts[9] else 0
                lmkd=int(parts[11]) if parts[11] else 0
            except Exception:
                continue
            if pts is None: continue
            rows.append((ub,pts,mf,lmkd))
except FileNotFoundError:
    print('NODATA'); sys.exit(0)
if not rows:
    print('NODATA'); sys.exit(0)
from collections import defaultdict
by=defaultdict(list)
for ub,pts,mf,lmkd in rows:
    by[ub].append((pts,mf,lmkd))
def med(xs):
    xs=sorted(xs); n=len(xs)
    if n==0: return None
    return xs[n//2] if n%2 else 0.5*(xs[n//2-1]+xs[n//2])
b512=by.get(512,[]); b2048=by.get(2048,[])
m512=med([p for p,_,_ in b512]) if b512 else None
m2048=med([p for p,_,_ in b2048]) if b2048 else None
print(f"# ub512 med_prefill={m512} n={len(b512)}", file=sys.stderr)
print(f"# ub2048 med_prefill={m2048} n={len(b2048)}", file=sys.stderr)
if m512 is None:
    print('NODATA'); sys.exit(0)
winner=512
if m512 and m2048 and m512>0:
    gain=(m2048/m512 - 1.0)*100
    min_mf=min(mf for _,mf,_ in b2048) if b2048 else 0
    max_lmkd=max(l for _,_,l in b2048) if b2048 else 99
    ok=(gain>=10.0) and (max_lmkd==0) and (min_mf>300)
    print(f"# gain={gain:.2f}% min_mf={min_mf} max_lmkd={max_lmkd} ok={ok}", file=sys.stderr)
    if ok: winner=2048
print(winner)
PY
}

# ═══════════════════════════════════════════════════════════
# CELLA 4 — plateau n=512, curve per block 64
# ═══════════════════════════════════════════════════════════
run_cella4() {
  local WIN_C="$1" WIN_UB="$2"
  log "==== CELLA4 START cache=$WIN_C ubatch=$WIN_UB ===="
  preflight_cella "cella4" || return $?
  kill_bmoe
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "FATAL cold cella4"; return 2
  fi

  local opfx="$OUTDIR/cella4/plateau"
  local slog="${opfx}.stdout.log"
  local serr="${opfx}.stderr.log"
  local prog="${opfx}.progress.jsonl"
  local samp="${opfx}.sampler.csv"
  : > "$slog"; : > "$serr"; : > "$prog"
  echo "ts_epoch_ms,die_c,vmrss_kb,memfree_kb,tokens_seen" > "$samp"

  read -r batt_s _ _ btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then log "FATAL PLUGGED cella4"; return 4; fi

  # Plateau needs a prompt that does not EOS early; archive sha in prompts/
  local PLAT_FILE="$OUTDIR/prompts/plateau_n512.txt"
  if [ ! -f "$PLAT_FILE" ]; then
    printf '%s' 'Scrivi un saggio tecnico dettagliato e continuo (senza elenchi numerati brevi) sul funzionamento della memoria KV e dello streaming degli expert MoE su smartphone con 8 GB di RAM. Continua a scrivere fino al limite di token: spiega prefill, decode, cache LRU, page fault, thermal throttling, e ripeti i concetti con esempi concreti su Qwen 35B-A3B. Non chiudere la risposta.' > "$PLAT_FILE"
  fi
  local ptext
  ptext=$(cat "$PLAT_FILE")
  log "cella4 prompt_sha=$(sha256sum "$PLAT_FILE" | awk '{print $1}')"
  "$BIN" -m "$MODEL" -p "$ptext" -t "$THREADS" -c "$N_CTX" -n 512 \
    --temp 0 --chatml --no-think --moe-stream --cache-mb "${WIN_C}" \
    --dense-weights anon --overlap --io-threads "$IO_THREADS" --ubatch "$WIN_UB" \
    --n-expert-used 8 --drop-cold-experts 0.50 --progress > "$slog" 2> "$serr" &
  local BPID=$!
  echo "$BPID" > "${opfx}.pid"
  log "cella4 bmoe pid=$BPID"

  # monitor: parse BMOE_PROGRESS for token counts; sample die + guardrail
  (
    last_tok=0
    block_start_t=$(date +%s.%N 2>/dev/null || date +%s)
    block_start_tok=0
    guardrails_reset 2>/dev/null || true
    while kill -0 "$BPID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_mc=$(max_die_mc)
      die_c=$(mc_to_c "$die_mc")
      rss=0
      [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      # BMOE_PROGRESS uses "step":N (1-based generated token index)
      tok=$(grep -oE '"step":[0-9]+' "$slog" 2>/dev/null | tail -1 | cut -d: -f2)
      tok=${tok:-0}
      echo "${now_ms},${die_c},${rss},${mf},${tok}" >> "$samp"
      if type guardrail_tick >/dev/null 2>&1; then
        guardrail_tick "$die_mc" "${mf:-0}"
        if [ "$GR_ACTION" != "CONTINUE" ]; then
          guardrail_apply_to_pid "$BPID" "$opfx"
          echo "$?" > "${opfx}.guardrail_rc"
          break
        fi
      else
        if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
          kill -TERM "$BPID" 2>/dev/null || true
        fi
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!

  local wall_s wall_e
  wall_s=$(date +%s)
  set +e
  wait "$BPID"
  local brc=$?
  set -e
  wall_e=$(date +%s)
  kill "$SPID" 2>/dev/null || true
  wait "$SPID" 2>/dev/null || true

  read -r batt_e _ _ btemp_e _ <<<"$(batt_fields)"
  # extract block curve from sampler (tokens_seen jumps)
  python3 - "$samp" "$OUTDIR/cella4/block_curve.csv" <<'PY'
import sys
samp,out=sys.argv[1],sys.argv[2]
rows=[]
with open(samp) as f:
    next(f,None)
    for line in f:
        p=line.strip().split(',')
        if len(p)<5: continue
        try:
            t=float(p[0]); die=float(p[1]); tok=int(float(p[4]))
        except Exception:
            continue
        rows.append((t,die,tok))
# block every 64 tokens
blocks=[]
if rows:
    # normalize time to seconds
    t0=rows[0][0]
    # if ms
    if t0>1e12: scale=1000.0
    elif t0>1e10: scale=1000.0
    else: scale=1.0
    targets=list(range(64,513,64))
    prev_t=rows[0][0]; prev_tok=0; prev_die=rows[0][1]
    for tgt in targets:
        hit=None
        for t,die,tok in rows:
            if tok>=tgt:
                hit=(t,die,tok); break
        if hit is None:
            # use last
            t,die,tok=rows[-1]
            if tok<=prev_tok: break
            hit=(t,die,tok)
        t,die,tok=hit
        dt=(t-prev_t)/scale
        dtok=tok-prev_tok
        tps=(dtok/dt) if dt>0 else 0
        blocks.append((tgt,dtok,dt,tps,die))
        prev_t,prev_tok,prev_die=t,tok,die
with open(out,'w') as f:
    f.write('block_end_tok,dtok,dt_s,tok_s,die_c\n')
    for b in blocks:
        f.write('%d,%d,%.3f,%.3f,%.1f\n'%b)
print('blocks',len(blocks))
for b in blocks:
    print('block@%d tok/s=%.2f die=%.1f'% (b[0],b[3],b[4]))
PY

  # also parse final generation line
  local eval_tok_s prompt_tok_s hit
  eval_tok_s=$(grep -E 'generation:.*tok/s' "$slog" "$serr" 2>/dev/null | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  prompt_tok_s=$(grep -E 'prefill:.*tok/s' "$slog" "$serr" 2>/dev/null | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  hit=$(grep -E 'moe-cache:.*hit' "$slog" "$serr" 2>/dev/null | tail -1 | sed -n 's/.*moe-cache: *\([0-9.]*\)% hit.*/\1%/p' | head -1)

  {
    echo "rc=$brc wall=$((wall_e-wall_s))"
    echo "eval_tok_s=$eval_tok_s prompt_tok_s=$prompt_tok_s hit=$hit"
    echo "batt ${batt_s}->${batt_e}"
    echo "bin_sha256=$BIN_SHA256"
  } | tee "$OUTDIR/cella4/summary.txt" | tee -a "$MASTER"

  run_single_note() { :; }
  local run_id
  run_id="staccato-c4-plateau-$(date +%Y%m%d-%H%M%S)"
  append_run "${run_id},$(date -Iseconds),${TAG_PHASE}-C4,Qwen3.6-35B-A3B-UD-IQ2_M,UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},--moe-stream --cache-mb ${WIN_C} --ubatch ${WIN_UB} --n-expert-used 8 --drop-cold-experts 0.50,4,4096,f16,512,warm,short,${prompt_tok_s},${eval_tok_s},,,,,,$(mc_to_c "$(max_die_mc)"),,${batt_s},${hit},$(nproc),,bin_sha256=${BIN_SHA256};cella=4;plateau;cache=${WIN_C};ubatch=${WIN_UB}"

  log "==== CELLA4 DONE ===="
  return 0
}

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════
START_CELL="${START_CELL:-2}"  # staccato2 default: from cella2 (cella1 already done in parte 1)
DETACH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --detach) DETACH=1; shift ;;
    --from-cella2) START_CELL=2; shift ;;
    --from-cella3) START_CELL=3; shift ;;
    --from-cella4) START_CELL=4; shift ;;
    --win-cache) WIN_C_OVERRIDE="$2"; shift 2 ;;
    --win-ubatch) WIN_UB_OVERRIDE="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 3 ;;
  esac
done

if [ "$DETACH" = "1" ]; then
  ARGS=()
  case "$START_CELL" in
    2) ARGS+=(--from-cella2) ;;
    3) ARGS+=(--from-cella3) ;;
    4) ARGS+=(--from-cella4) ;;
  esac
  [ -n "${WIN_C_OVERRIDE:-}" ] && ARGS+=(--win-cache "$WIN_C_OVERRIDE")
  [ -n "${WIN_UB_OVERRIDE:-}" ] && ARGS+=(--win-ubatch "$WIN_UB_OVERRIDE")
  nohup bash "$0" "${ARGS[@]}" >"$OUTDIR/nohup_c${START_CELL}.out" 2>&1 &
  echo $! > "$PIDFILE"
  echo "DETACHED pid=$(cat "$PIDFILE") start_cell=$START_CELL out=$OUTDIR"
  exit 0
fi

echo $$ > "$PIDFILE"
# Fresh master only on first start; resume keeps cells.csv / runs_added / summaries
RESUME_KEEP=0
if [ -s "$CELL_CSV" ] && grep -q '^c2-' "$CELL_CSV" 2>/dev/null; then
  RESUME_KEEP=1
fi
if [ "$START_CELL" -le 2 ] && [ "$RESUME_KEEP" = "0" ]; then
  : > "$MASTER"
  : > "$OUTDIR/runs_added.csv"
  : > "$OUTDIR/SKIPPED.txt"
  echo "label,prompt_id,n_gen,cache_mb,ubatch,prompt_tok_s,eval_tok_s,prefill_s,hit,memfree_min_mb,vmhwm_mb,lmkd_delta,batt_s,batt_e,die_s,die_e,wall_s,rc,bin_sha256" > "$CELL_CSV"
  echo "RUNNING $(ts) start_cell=$START_CELL" > "$STATUS"
else
  echo "===== RESUME keep=$RESUME_KEEP from cella $START_CELL $(ts) =====" >> "$MASTER"
  echo "RESUME_CELLA${START_CELL} keep=$RESUME_KEEP $(ts)" >> "$STATUS"
  # ensure header exists
  if [ ! -s "$CELL_CSV" ]; then
    echo "label,prompt_id,n_gen,cache_mb,ubatch,prompt_tok_s,eval_tok_s,prefill_s,hit,memfree_min_mb,vmhwm_mb,lmkd_delta,batt_s,batt_e,die_s,die_e,wall_s,rc,bin_sha256" > "$CELL_CSV"
  fi
  [ -f "$OUTDIR/runs_added.csv" ] || : > "$OUTDIR/runs_added.csv"
  [ -f "$OUTDIR/SKIPPED.txt" ] || : > "$OUTDIR/SKIPPED.txt"
fi
ensure_runs_header

log "=== STACCATO2 START pid=$$ start_cell=$START_CELL ==="
log "bin=$BIN sha=$BIN_SHA256"
log "model=$MODEL"
log "screen_off_timeout host-managed (expect 7200000 during session)"
# keep screen awake via wake-lock for whole session
termux-wake-lock >/dev/null 2>&1 || true

# model size
SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE" ]; then
  log "FATAL model size $SZ != $EXPECTED_SIZE"; echo "FATAL_SIZE" > "$STATUS"; exit 2
fi
if [ ! -x "$BIN" ]; then log "FATAL no bin"; exit 2; fi

# residual bmoe?
kill_bmoe

start_flight
archive_prompts

# record batt window start (resume-aware)
if [ "$START_CELL" -le 1 ] || [ ! -f "$OUTDIR/batt_start.json" ]; then
  batt_json > "$OUTDIR/batt_start.json"
fi
echo "batt_window $(ts) $(batt_fields) start_cell=$START_CELL" | tee -a "$MASTER"

# No invented defaults: only override or post-measure values (correzione 3 STATUS onesto)
WIN_C="${WIN_C_OVERRIDE:-}"
WIN_UB="${WIN_UB_OVERRIDE:-}"
FINAL_RC=0

# CELLA 1 — NOT in staccato2 scope (done in parte 1). Never invent winners for missing cells.
if [ "$START_CELL" -le 1 ]; then
  log "WARN start_cell=1 requested but staccato2 is cells 2-3-4 only; running cella1 anyway"
  for rep in 1 2; do
    if ! run_cella1 "$rep"; then
      rc=$?
      log "cella1 rep$rep exit $rc"
      if [ $rc -eq 4 ] || [ $rc -eq 92 ] || [ $rc -eq 99 ]; then
        FINAL_RC=$rc
        echo "STOPPED_AFTER_CELLA1 rc=$rc $(ts)" > "$STATUS"
        stop_flight
        batt_json > "$OUTDIR/batt_end.json"
        exit $rc
      fi
    fi
    t0=$(date +%s)
    while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
      now=$(date +%s); [ $((now-t0)) -ge 300 ] && break
      sleep 10
    done
  done
  echo "CELLA1_DONE $(ts)" >> "$STATUS"
  log "CELLA1 complete"
else
  log "SKIP CELLA1 (staccato2 scope = cells 2-3-4; parte1 already measured)"
  echo "SKIPPED cella1 out_of_scope_staccato2" >> "$OUTDIR/SKIPPED.txt"
fi

# CELLA 2
CELLA2_OK=0
if [ "$START_CELL" -le 2 ]; then
  set +e
  run_cella2
  rc=$?
  set -e
  log "cella2 exit $rc"
  if [ $rc -ne 0 ]; then
    FINAL_RC=$rc
    echo "SKIPPED cella2 rc=$rc $(ts)" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    if [ $rc -eq 4 ] || [ $rc -eq 92 ] || [ $rc -eq 93 ] || [ $rc -eq 99 ]; then
      echo "STOPPED_AFTER_CELLA2 rc=$rc $(ts)" >> "$STATUS"
      # do NOT invent winner; still try to write honest status and exit
      stop_flight
      batt_json > "$OUTDIR/batt_end.json"
      {
        echo "DONE_PARTIAL $(ts)"
        echo "winner_cache=NODATA"
        echo "winner_ubatch=NODATA"
        echo "bin_sha256=$BIN_SHA256"
        echo "final_rc=$FINAL_RC"
        echo "SKIPPED cella2 rc=$rc"
      } >> "$STATUS"
      log "=== STACCATO2 STOPPED after cella2 rc=$FINAL_RC (no fake winner) ==="
      exit $FINAL_RC
    fi
  else
    CELLA2_OK=1
  fi
  WIN_C=$(decide_cache 2>"$OUTDIR/cella2/decision.log" | tail -1)
  echo "$WIN_C" > "$OUTDIR/cella2/winner_cache.txt"
  log "CELLA2 winner_cache=$WIN_C (see decision.log)"
  cat "$OUTDIR/cella2/decision.log" | tee -a "$MASTER" || true
  if [ "$WIN_C" = "NODATA" ] || [ -z "$WIN_C" ]; then
    FINAL_RC=1
    echo "SKIPPED cella2 NODATA $(ts)" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    echo "CELLA2_NODATA $(ts)" >> "$STATUS"
    # cannot run cella3/4 without measured cache winner — stop honestly
    stop_flight
    batt_json > "$OUTDIR/batt_end.json"
    {
      echo "DONE_PARTIAL $(ts)"
      echo "winner_cache=NODATA"
      echo "winner_ubatch=NODATA"
      echo "bin_sha256=$BIN_SHA256"
      echo "final_rc=$FINAL_RC"
    } >> "$STATUS"
    log "=== STACCATO2 STOPPED cella2 NODATA rc=$FINAL_RC ==="
    exit $FINAL_RC
  fi
  echo "CELLA2_DONE win_c=$WIN_C $(ts)" >> "$STATUS"
else
  if [ -f "$OUTDIR/cella2/winner_cache.txt" ]; then
    WIN_C=$(cat "$OUTDIR/cella2/winner_cache.txt")
  fi
  WIN_C="${WIN_C_OVERRIDE:-$WIN_C}"
  if [ -z "$WIN_C" ] || [ "$WIN_C" = "NODATA" ]; then
    log "FATAL no win_c for resume"
    FINAL_RC=1
    echo "SKIPPED cella3 no_win_cache" >> "$OUTDIR/SKIPPED.txt"
    stop_flight; batt_json > "$OUTDIR/batt_end.json"
    exit 1
  fi
  log "SKIP CELLA2 using win_c=$WIN_C"
fi

# CELLA 3 — only with measured (or override) cache
if [ "$START_CELL" -le 3 ]; then
  set +e
  run_cella3 "$WIN_C"
  rc=$?
  set -e
  log "cella3 exit $rc"
  if [ $rc -ne 0 ]; then
    FINAL_RC=$rc
    echo "SKIPPED cella3 rc=$rc $(ts)" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    # 96=ABORT_MEM, 97=THERMAL_PAUSE, 99=HARD_DIE, 4=PLUGGED, 92/93=batt
    if [ $rc -eq 4 ] || [ $rc -eq 92 ] || [ $rc -eq 93 ] || [ $rc -eq 96 ] || [ $rc -eq 97 ] || [ $rc -eq 99 ]; then
      echo "STOPPED_AFTER_CELLA3 rc=$rc win_c=$WIN_C $(ts)" >> "$STATUS"
      stop_flight
      batt_json > "$OUTDIR/batt_end.json"
      {
        echo "DONE_PARTIAL $(ts)"
        echo "winner_cache=$WIN_C"
        echo "winner_ubatch=NODATA"
        echo "bin_sha256=$BIN_SHA256"
        echo "final_rc=$FINAL_RC"
        echo "SKIPPED cella3 rc=$rc"
      } >> "$STATUS"
      log "=== STACCATO2 STOPPED after cella3 rc=$FINAL_RC ==="
      exit $FINAL_RC
    fi
  fi
  WIN_UB=$(decide_ubatch 2>"$OUTDIR/cella3/decision.log" | tail -1)
  echo "$WIN_UB" > "$OUTDIR/cella3/winner_ubatch.txt"
  log "CELLA3 winner_ubatch=$WIN_UB"
  cat "$OUTDIR/cella3/decision.log" | tee -a "$MASTER" || true
  if [ "$WIN_UB" = "NODATA" ] || [ -z "$WIN_UB" ]; then
    FINAL_RC=1
    echo "SKIPPED cella3 NODATA $(ts)" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    # cella4 still measurable with ubatch default only if override; else stop
    if [ -z "${WIN_UB_OVERRIDE:-}" ]; then
      stop_flight
      batt_json > "$OUTDIR/batt_end.json"
      {
        echo "DONE_PARTIAL $(ts)"
        echo "winner_cache=$WIN_C"
        echo "winner_ubatch=NODATA"
        echo "bin_sha256=$BIN_SHA256"
        echo "final_rc=$FINAL_RC"
      } >> "$STATUS"
      log "=== STACCATO2 STOPPED cella3 NODATA rc=$FINAL_RC ==="
      exit $FINAL_RC
    fi
    WIN_UB="$WIN_UB_OVERRIDE"
  fi
  echo "CELLA3_DONE win_ub=$WIN_UB $(ts)" >> "$STATUS"
else
  if [ -f "$OUTDIR/cella3/winner_ubatch.txt" ]; then
    WIN_UB=$(cat "$OUTDIR/cella3/winner_ubatch.txt")
  fi
  WIN_UB="${WIN_UB_OVERRIDE:-$WIN_UB}"
  log "SKIP CELLA3 using win_ub=$WIN_UB"
fi

# CELLA 4
if [ "$START_CELL" -le 4 ]; then
  if [ -z "$WIN_C" ] || [ "$WIN_C" = "NODATA" ] || [ -z "$WIN_UB" ] || [ "$WIN_UB" = "NODATA" ]; then
    log "SKIPPED cella4 missing winners win_c=$WIN_C win_ub=$WIN_UB"
    echo "SKIPPED cella4 missing_winners win_c=$WIN_C win_ub=$WIN_UB" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    FINAL_RC=1
  else
    # Plateau: ubatch fisso 512 se CELLA4_UBATCH impostato (mandato staccato-3), altrimenti winner C3
    UB4="${CELLA4_UBATCH:-$WIN_UB}"
    log "CELLA4 using cache=$WIN_C ubatch=$UB4 (CELLA4_UBATCH=${CELLA4_UBATCH:-unset})"
    if ! run_cella4 "$WIN_C" "$UB4"; then
      rc=$?
      log "cella4 exit $rc"
      FINAL_RC=$rc
      echo "SKIPPED cella4 rc=$rc $(ts)" | tee -a "$OUTDIR/SKIPPED.txt" | tee -a "$STATUS"
    else
      echo "CELLA4_DONE $(ts)" >> "$STATUS"
    fi
  fi
fi

batt_json > "$OUTDIR/batt_end.json"
echo "batt_end $(ts) $(batt_fields)" | tee -a "$MASTER"
stop_flight
termux-wake-unlock >/dev/null 2>&1 || true

{
  if [ "$FINAL_RC" -eq 0 ]; then
    echo "DONE $(ts)"
  else
    echo "DONE_PARTIAL $(ts)"
  fi
  echo "winner_cache=$WIN_C"
  echo "winner_ubatch=$WIN_UB"
  echo "bin_sha256=$BIN_SHA256"
  echo "final_rc=$FINAL_RC"
  if [ -s "$OUTDIR/SKIPPED.txt" ]; then
    echo "--- SKIPPED ---"
    cat "$OUTDIR/SKIPPED.txt"
  fi
} >> "$STATUS"

log "=== STACCATO2 COMPLETE win_c=$WIN_C win_ub=$WIN_UB rc=$FINAL_RC ==="
exit $FINAL_RC
