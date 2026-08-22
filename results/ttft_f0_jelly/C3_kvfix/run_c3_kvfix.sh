#!/data/data/com.termux/files/usr/bin/bash
# C3 re-run only — KVFIX A76 binary. Same prompts/flags as original C3.
# Does NOT overwrite ~/bin/bmoe-cli (campaign pin).
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/ttft_f0_jelly/C3_kvfix}"
BIN="${BINARY:-$HOME/bin/bmoe-cli-kvfix}"
MODEL="${MODEL:-$HOME/models/Qwen3.5-2B-Q4_K_M.gguf}"
PROMPTDIR="${PROMPTDIR:-$HOME/experiments/results/ttft_f0_jelly/prompts}"
KVFIX_LIBDIR="${KVFIX_LIBDIR:-$HOME/src/BigMoeOnEdge/build-kvfix/bin}"

EXPECTED_MODEL_SHA="aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223"
EXPECTED_C3_JSONL_SHA="1bccdaaea72bfd854b8f203fd67756361cb3332ed4fdc69ea00ecc3166f2a661"
BATT_FLOOR=35
TEMP_ABORT_C=45

mkdir -p "$OUTDIR/logs"
CSV="$OUTDIR/runs.csv"
MASTER="$OUTDIR/C3_kvfix.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
echo "RUNNING" > "$STATUS"

echo "ts,cell,rep,n_ctx,ubatch,cold,phase,n_prompt,n_past,n_gen,n_common,load_s,prefill_s,prefill_tps,ttft_s,tok_s,wall_s,rc,batt_pct,temp_c,plugged,memavail_kib,kv_mib,compute_mib,note" > "$CSV"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

ensure_api(){
  timeout 5 termux-api-start >/dev/null 2>&1 || true
  sleep 1
}

batt_json(){
  local f="$OUTDIR/.batt.json"
  : > "$f"
  ensure_api
  if timeout 10 termux-battery-status > "$f" 2>"$OUTDIR/.batt.err"; then
    :
  else
    echo '{}' > "$f"
  fi
  cat "$f"
}

batt_fields(){
  python3 - "$OUTDIR/.batt.json" <<'PY'
import json,sys
path=sys.argv[1]
try:
    d=json.loads(open(path,"r",encoding="utf-8").read() or "{}")
except Exception:
    d={}
plug=str(d.get("plugged","?"))
pct=int(d.get("percentage",0) or 0)
temp=float(d.get("temperature",0) or 0)
print("%s %s %s" % (plug, pct, temp))
PY
}

memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }

preflight(){
  local i bj fields plug pct temp ma
  for i in $(seq 1 90); do
    bj=$(batt_json)
    fields=$(batt_fields "$bj")
    plug=$(echo "$fields" | awk '{print $1}')
    pct=$(echo "$fields" | awk '{print $2}')
    temp=$(echo "$fields" | awk '{print $3}')
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma raw=$(tr '\n' ' ' < "$OUTDIR/.batt.json" | head -c 180)"
    if ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged (now $plug)"
      echo "WAIT_PLUGGED" > "$STATUS"
      sleep 15
      continue
    fi
    if [ "${pct:-0}" -lt "$BATT_FLOOR" ] 2>/dev/null; then
      log "STOP batt $pct < $BATT_FLOOR"
      echo "STOP_BATT" > "$STATUS"
      return 3
    fi
    python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp" && {
      log "WAIT temp $temp > ${TEMP_ABORT_C}"
      sleep 20
      continue
    }
    echo "RUNNING" > "$STATUS"
    return 0
  done
  log "STOP preflight timeout"
  echo "STOP_PLUGGED" > "$STATUS"
  return 2
}

cold(){
  local m="${1:-$MODEL}"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$m" || true
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" --dontneed "$m" 2>/dev/null || true
  fi
}

parse_done(){
  local id="$1"
  python3 - "$id" <<'PY'
import json,sys
want=int(sys.argv[1])
text=sys.stdin.read()
ready_load=""
for line in text.splitlines():
    if line.startswith("BMOE_READY "):
        try:
            d=json.loads(line.split(" ",1)[1])
            ready_load=d.get("load_s","")
        except Exception:
            pass
    if line.startswith("BMOE_DONE "):
        try:
            d=json.loads(line.split(" ",1)[1])
        except Exception:
            continue
        if int(d.get("id",-1))!=want:
            continue
        def g(k, default=""):
            v=d.get(k, default)
            return "" if v is None else str(v)
        print("|".join([
            g("n_prompt"), g("n_past"), g("tokens"),
            g("load_s", ready_load), g("prefill_s"), g("prefill_tps"),
            g("tok_s"),
        ]))
        sys.exit(0)
print("||||||")
sys.exit(1)
PY
}

kv_compute_from_log(){
  python3 - <<'PY'
import re,sys
text=sys.stdin.read()
kv=""
comp=""
m=re.search(r"CPU KV buffer size =\s+([0-9.]+)\s+MiB", text)
if m: kv=m.group(1)
m=re.search(r"CPU compute buffer size =\s+([0-9.]+)\s+MiB", text)
if m: comp=m.group(1)
print(f"{kv} {comp}")
PY
}

run_session(){
  local cell="$1" rep="$2" n_ctx="$3" jsonl="$4" cold_flag="$5" timeout_s="$6" note="$7"
  local label="${cell}_r${rep}_c${n_ctx}"
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"
  cp "$jsonl" "$out/in.jsonl"

  preflight || return $?

  local bj fields plug pct_s temp_s ma_s
  bj=$(batt_json)
  fields=$(batt_fields "$bj")
  plug=$(echo "$fields" | awk '{print $1}')
  pct_s=$(echo "$fields" | awk '{print $2}')
  temp_s=$(echo "$fields" | awk '{print $3}')
  ma_s=$(memavail_kib)

  if [ "$cold_flag" = "cold" ]; then
    log "fadvise $MODEL"
    cold "$MODEL"
  fi

  local cmd=(
    "$BIN" -m "$MODEL"
    --session --chatml --no-think
    -t 2 -c "$n_ctx" --ubatch 512 --temp 0 -n 8
  )
  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"
  log "RUN $label plugged=$plug batt=$pct_s temp=$temp_s memavail=$ma_s cold=$cold_flag"

  local t0 t1 wall rc
  t0=$(date +%s)
  timeout --signal=TERM --kill-after=20 "$timeout_s" "${cmd[@]}" \
    < "$jsonl" > "$out/stdout.txt" 2> "$out/stderr.txt"
  rc=$?
  t1=$(date +%s)
  wall=$((t1 - t0))
  echo "$rc" > "$out/rc.txt"
  echo "$wall" > "$out/wall.txt"
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true

  local kvcomp kv_mib compute_mib
  kvcomp=$(kv_compute_from_log < "$out/combo.txt")
  kv_mib=$(echo "$kvcomp" | awk '{print $1}')
  compute_mib=$(echo "$kvcomp" | awk '{print $2}')

  local bj2 fields2 pct_e temp_e
  bj2=$(batt_json)
  fields2=$(batt_fields "$bj2")
  pct_e=$(echo "$fields2" | awk '{print $2}')
  temp_e=$(echo "$fields2" | awk '{print $3}')
  log "END $label batt_end=$pct_e temp_end=$temp_e"

  local id parsed n_prompt n_past tokens load_s prefill_s prefill_tps tok_s ttft_s phase n_common
  local any=0
  for id in 1 2 3 4; do
    parsed=$(parse_done "$id" < "$out/stdout.txt" || true)
    n_prompt=$(echo "$parsed" | awk -F'|' '{print $1}')
    n_past=$(echo "$parsed" | awk -F'|' '{print $2}')
    tokens=$(echo "$parsed" | awk -F'|' '{print $3}')
    load_s=$(echo "$parsed" | awk -F'|' '{print $4}')
    prefill_s=$(echo "$parsed" | awk -F'|' '{print $5}')
    prefill_tps=$(echo "$parsed" | awk -F'|' '{print $6}')
    tok_s=$(echo "$parsed" | awk -F'|' '{print $7}')
    if [ -z "$n_prompt" ] && [ -z "$prefill_s" ]; then
      continue
    fi
    any=1
    n_common=$(python3 -c "print(int('${n_past}' or 0)-int('${n_prompt}' or 0)-int('${tokens}' or 0))" 2>/dev/null || echo "")
    if [ "$id" = "1" ]; then
      phase="t1"
      ttft_s=$(python3 -c "print('{:.3f}'.format(float('${load_s:-0}' or 0)+float('${prefill_s:-0}' or 0)))" 2>/dev/null || echo "")
    else
      phase="t${id}"
      ttft_s="$prefill_s"
    fi
    echo "$(ts),$cell,$rep,$n_ctx,512,$cold_flag,$phase,$n_prompt,$n_past,$tokens,$n_common,$load_s,$prefill_s,$prefill_tps,$ttft_s,$tok_s,$wall,$rc,$pct_s,$temp_s,$plug,$ma_s,$kv_mib,$compute_mib,$note" >> "$CSV"
    log "DONE $label phase=$phase n_prompt=$n_prompt n_past=$n_past n_gen=$tokens n_common=$n_common load_s=$load_s prefill_s=$prefill_s ttft_s=$ttft_s rc=$rc wall=$wall kv=$kv_mib compute=$compute_mib"
  done
  if [ "$any" = "0" ]; then
    echo "$(ts),$cell,$rep,$n_ctx,512,$cold_flag,none,,,,,,,,,,$wall,$rc,$pct_s,$temp_s,$plug,$ma_s,$kv_mib,$compute_mib,NO_BMOE_DONE:${note}" >> "$CSV"
    log "FAIL $label rc=$rc wall=$wall no BMOE_DONE"
  fi
  return 0
}

# --- pin checks ---
if [ -n "${KVFIX_LIBDIR:-}" ] && [ -d "$KVFIX_LIBDIR" ]; then
  export LD_LIBRARY_PATH="$KVFIX_LIBDIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
fi

if [ ! -x "$BIN" ]; then
  log "FAIL no binary $BIN"
  echo "FAIL_BIN" > "$STATUS"
  exit 6
fi
got=$(sha256sum "$BIN" | awk '{print $1}')
log "BIN_SHA=$got path=$BIN"
echo "$got  bmoe-cli-kvfix" > "$OUTDIR/bin.sha256"
"$BIN" --version > "$OUTDIR/bin.version.txt" 2>&1 || true
"$BIN" --list-archs > "$OUTDIR/bin.list-archs.txt" 2>&1 || true

# Campaign pin must still be the original file.
camp=$(sha256sum "$HOME/bin/bmoe-cli" | awk '{print $1}')
log "CAMPAIGN_BIN_SHA=$camp (must remain 36b01966…)"
echo "$camp  bmoe-cli" > "$OUTDIR/campaign_bin.sha256"
case "$camp" in
  36b01966*) log "CAMPAIGN PIN INTACT" ;;
  *) log "WARN campaign pin changed: $camp" ;;
esac

msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize"
msha=$(sha256sum "$MODEL" | awk '{print $1}')
echo "$msha  Qwen3.5-2B-Q4_K_M.gguf" > "$OUTDIR/model.sha256"
log "MODEL_SHA=$msha"
if [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "MODEL sha mismatch want $EXPECTED_MODEL_SHA"
  echo "FAIL_MODEL_SHA" > "$STATUS"
  exit 7
fi

if [ ! -f "$PROMPTDIR/c3_reuse.jsonl" ]; then
  log "FAIL missing $PROMPTDIR/c3_reuse.jsonl"
  echo "FAIL_PROMPTS" > "$STATUS"
  exit 9
fi
psha=$(sha256sum "$PROMPTDIR/c3_reuse.jsonl" | awk '{print $1}')
log "C3_JSONL_SHA=$psha"
echo "$psha  c3_reuse.jsonl" > "$OUTDIR/prompt.sha256"
if [ "$psha" != "$EXPECTED_C3_JSONL_SHA" ]; then
  log "C3 jsonl sha mismatch want $EXPECTED_C3_JSONL_SHA"
  echo "FAIL_PROMPT_SHA" > "$STATUS"
  exit 9
fi
if [ -f "$PROMPTDIR/SHA256SUMS.txt" ]; then
  cp "$PROMPTDIR/SHA256SUMS.txt" "$OUTDIR/prompt_sha256.txt"
fi

log "BEGIN C3-KVFIX Jelly t=2 ubatch=512 chatml no-think n=8"
echo "RUNNING_C3" > "$STATUS"
for rep in 1 2; do
  run_session "C3" "$rep" 4096 "$PROMPTDIR/c3_reuse.jsonl" "cold" 800 "kv_reuse_kvfix"
done

log "ALL C3 REPS ATTEMPTED"
echo "DONE" > "$STATUS"
exit 0
