#!/data/data/com.termux/files/usr/bin/bash
# Retry decode short_r1, f45_1_r1, sostenuto — log MemFree, do NOT kill on low mem.
# Prior ABORT_MEM was false-positive: MoE runs routinely see MemFree 13–50 MiB
# (same as valid A/B runs in moe-speed-dropcold.md). HARD_DIE 98C still kills.
set -euo pipefail
export LC_ALL=C
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export HOME="${HOME:-/data/data/com.termux/files/home}"

BIN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
COLD="$HOME/bin/cold_model.sh"
OUT="$HOME/experiments/results/adopt_dropcold"
EXP="$HOME/experiments"
_ld="$(cd "$(dirname "$BIN")" && pwd -P)"
export LD_LIBRARY_PATH="${_ld}:${_ld}/../bin:${LD_LIBRARY_PATH:-}"
MASTER="$OUT/RETRY.master.log"
: > "$MASTER"
log(){ echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" | tee -a "$MASTER"; }

sha=$(sha256sum "$BIN" | awk '{print $1}')
exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
if [ "$sha" != "$exp" ]; then log "PIN FAIL $sha != $exp"; exit 6; fi
log "pin ok $sha"

batt(){
  termux-battery-status 2>/dev/null | python3 -c 'import sys,json
d=json.load(sys.stdin)
print(int(d.get("percentage",-1)), float(d.get("temperature",-1)), str(d.get("plugged","")))'
}
max_die_mc(){
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
mc_to_c(){ awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }

wait_pre(){
  local tries=0
  while :; do
    read -r pct _ plugged <<<"$(batt)"
    [ "$plugged" = "UNPLUGGED" ] || { log "PLUGGED"; return 4; }
    [ "$pct" -ge 30 ] || { log "BATT $pct"; return 5; }
    local die_mc n
    die_mc=$(max_die_mc); n=$(nproc)
    if [ "$die_mc" -le 80000 ] 2>/dev/null && [ "$n" -ge 6 ]; then
      log "pre OK die=$(mc_to_c "$die_mc") nproc=$n batt=$pct"
      return 0
    fi
    tries=$((tries+1))
    [ "$tries" -gt 40 ] && { log "pre TIMEOUT"; return 3; }
    log "wait die=$(mc_to_c "$die_mc") nproc=$n"
    termux-wake-lock >/dev/null 2>&1 || true
    /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
    sleep 10
  done
}

run_dec(){
  local label="$1" pfile="$2"
  local opfx="$OUT/decode/${label}_retry"
  wait_pre || return $?
  pkill -f bmoe-cli 2>/dev/null || true; sleep 1
  log "cold $label"; "$COLD" "$MODEL" >>"$MASTER" 2>&1
  sleep 3
  local ptext; ptext=$(cat "$pfile")
  : > "${opfx}.stdout"; : > "${opfx}.stderr"
  echo "ts_epoch_ms,die_c,vmrss_kb,memfree_kb" > "${opfx}.sampler.csv"
  read -r pct _ _ <<<"$(batt)"
  log "start $label batt=$pct nproc=$(nproc) die=$(mc_to_c "$(max_die_mc)")"
  "$BIN" -m "$MODEL" -p "$ptext" -t 4 -c 4096 -n 200 --temp 0 --chatml --no-think \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 \
    --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 \
    > "${opfx}.stdout" 2> "${opfx}.stderr" &
  local BPID=$!
  (
    while kill -0 "$BPID" 2>/dev/null; do
      now=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die=$(mc_to_c "$(max_die_mc)")
      rss=0; [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      echo "${now},${die},${rss},${mf}" >> "${opfx}.sampler.csv"
      if [ "$(max_die_mc)" -gt 98000 ] 2>/dev/null; then
        kill "$BPID" 2>/dev/null || true
        echo HARD_DIE > "${opfx}.guardrail"
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!
  set +e; wait $BPID; brc=$?; set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
  local combo; combo=$(cat "${opfx}.stdout" "${opfx}.stderr" 2>/dev/null || true)
  local eval_tok_s hit drop mib load
  eval_tok_s=$(printf '%s\n' "$combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p')
  hit=$(printf '%s\n' "$combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.* \([0-9.]*\)% hit.*/\1/p')
  drop=$(printf '%s\n' "$combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*(\([0-9.]*\)%).*/\1/p')
  mib=$(printf '%s\n' "$combo" | grep -E 'moe-stream: read' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p')
  load=$(printf '%s\n' "$combo" | grep -E 'model load' | tail -1 | sed -n 's/.*model load \([0-9.]*\) s.*/\1/p')
  die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0}END{print m+0}' "${opfx}.sampler.csv")
  mf_min=$(awk -F, 'NR>1{v=$4+0; if(m==""||v<m)m=v}END{printf "%.0f", m/1024}' "${opfx}.sampler.csv")
  read -r pct2 _ _ <<<"$(batt)"
  {
    echo "label=$label"
    echo "eval_tok_s=$eval_tok_s"
    echo "hit=$hit"
    echo "drop_pct=$drop"
    echo "mib_tok=$mib"
    echo "load_s=$load"
    echo "die_max=$die_max"
    echo "memfree_min_mb=$mf_min"
    echo "rc=$brc"
    echo "batt_s=$pct batt_e=$pct2"
    echo "bin_sha256=$sha"
  } | tee "${opfx}.summary.txt" | tee -a "$MASTER"
  log "DONE $label eval=$eval_tok_s hit=$hit drop=$drop rc=$brc"
}

run_sost(){
  local opfx="$OUT/sostenuto/B-short-n512_retry"
  wait_pre || return $?
  pkill -f bmoe-cli 2>/dev/null || true; sleep 1
  log "cold sost"; "$COLD" "$MODEL" >>"$MASTER" 2>&1
  sleep 3
  local plat="$OUT/sostenuto/plateau_n512.txt"
  if [ ! -f "$plat" ]; then
    printf '%s' 'Scrivi un saggio tecnico dettagliato e continuo (senza elenchi numerati brevi) sul funzionamento della memoria KV e dello streaming degli expert MoE su smartphone con 8 GB di RAM. Continua a scrivere fino al limite di token: spiega prefill, decode, cache LRU, page fault, thermal throttling, e ripeti i concetti con esempi concreti su Qwen 35B-A3B. Non chiudere la risposta.' > "$plat"
  fi
  local ptext; ptext=$(cat "$plat")
  : > "${opfx}.stdout"; : > "${opfx}.stderr"
  echo "ts_epoch_ms,die_c,vmrss_kb,memfree_kb" > "${opfx}.sampler.csv"
  read -r pct _ _ <<<"$(batt)"
  log "start sost batt=$pct"
  "$BIN" -m "$MODEL" -p "$ptext" -t 4 -c 4096 -n 512 --temp 0 --chatml --no-think \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 \
    --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --progress \
    > "${opfx}.stdout" 2> "${opfx}.stderr" &
  local BPID=$!
  (
    while kill -0 "$BPID" 2>/dev/null; do
      now=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die=$(mc_to_c "$(max_die_mc)")
      rss=0; [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      echo "${now},${die},${rss},${mf}" >> "${opfx}.sampler.csv"
      if [ "$(max_die_mc)" -gt 98000 ] 2>/dev/null; then
        kill "$BPID" 2>/dev/null || true
        echo HARD_DIE > "${opfx}.guardrail"
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!
  set +e; wait $BPID; brc=$?; set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
  local combo; combo=$(cat "${opfx}.stdout" "${opfx}.stderr" 2>/dev/null || true)
  local eval_tok_s hit drop mib
  eval_tok_s=$(printf '%s\n' "$combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p')
  hit=$(printf '%s\n' "$combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.* \([0-9.]*\)% hit.*/\1/p')
  drop=$(printf '%s\n' "$combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*(\([0-9.]*\)%).*/\1/p')
  mib=$(printf '%s\n' "$combo" | grep -E 'moe-stream: read' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p')
  die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0}END{print m+0}' "${opfx}.sampler.csv")
  read -r pct2 _ _ <<<"$(batt)"
  {
    echo "eval_tok_s=$eval_tok_s"
    echo "hit=$hit"
    echo "drop_pct=$drop"
    echo "mib_tok=$mib"
    echo "die_max=$die_max"
    echo "rc=$brc"
    echo "batt_s=$pct batt_e=$pct2"
    echo "bin_sha256=$sha"
  } | tee "${opfx}.summary.txt" | tee -a "$MASTER"
  log "DONE sost eval=$eval_tok_s rc=$brc die_max=$die_max"
}

termux-wake-lock >/dev/null 2>&1 || true
/system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
log "RETRY START"
run_dec short_r1 "$EXP/prompts/short.txt" || true
run_dec f45_1_r1 "$EXP/prompts/f45_1.txt" || true
run_sost || true
log "RETRY END"
echo DONE > "$OUT/RETRY.STATUS"
