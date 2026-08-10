#!/usr/bin/env bash
# Fase C — gate velocità A/B ABBA: A=IQ2_M B=KEXP, drop 0.65 both, STACCATO
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:${PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/requant1c/phase_c}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL_A="${MODEL_A:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
MODEL_B="${MODEL_B:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
PROMPT_DIR="${PROMPT_DIR:-$HOME/experiments/prompts}"
P1="${P1:-$PROMPT_DIR/short.txt}"
P2="${P2:-$PROMPT_DIR/f45_1.txt}"
[ -f "$P1" ] || P1="$HOME/experiments/prompts/short.txt"
[ -f "$P2" ] || P2="$HOME/experiments/prompts/f45_1.txt"

THREADS=4
CACHE_MB=2000
IO_THREADS=4
N_CTX=4096
UBATCH=512
N_EXPERT_USED=8
DROP_F=0.65
NGEN=200
NGEN_SOS=512

if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { echo "PIN FAIL"; exit 6; }
  BIN_SHA256="$got"
fi
if [ -f "$HOME/experiments/scripts/lib_guardrails.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_guardrails.sh" || true
fi
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR/runs"
MASTER="$OUTDIR/phase_c.master.log"
CSV="$OUTDIR/abba_cells.csv"
ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

: > "$MASTER"
echo "label,arm,prompt,rep,eval_tok_s,prefill_tok_s,hit,mib_tok,drop_pct,die_max,batt,wall_s,rc" > "$CSV"
log "phase C ABBA start bin=$BIN_SHA256 drop=$DROP_F"
sha256sum "$BIN" "$MODEL_A" "$MODEL_B" | tee -a "$MASTER"
termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_start.json" || true

plug=$(python -c "import json;print(json.load(open('$OUTDIR/battery_start.json')).get('plugged','?'))" 2>/dev/null || echo "?")
pct=$(python -c "import json;print(json.load(open('$OUTDIR/battery_start.json')).get('percentage',0))" 2>/dev/null || echo 0)
log "preflight plugged=$plug batt=$pct"
if [ "$plug" != "UNPLUGGED" ]; then
  log "STOP: not UNPLUGGED (plugged=$plug) — phase C not citable"
  echo "STOP_PLUGGED" > "$OUTDIR/STATUS.txt"
  exit 3
fi
if [ "${pct:-0}" -lt 45 ]; then
  log "STOP: battery $pct < 45"
  echo "STOP_BATT" > "$OUTDIR/STATUS.txt"
  exit 3
fi

BASE=(--moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap --io-threads "$IO_THREADS" --ubatch "$UBATCH" -t "$THREADS" -c "$N_CTX" --n-expert-used "$N_EXPERT_USED" --drop-cold-experts "$DROP_F")

cold() {
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$1" || true
  elif command -v fadv >/dev/null 2>&1; then
    fadv --dontneed "$1" 2>/dev/null || true
  fi
}

parse_metrics() {
  local t="$1"
  local eval_s prefill hit mib drop die
  eval_s=$(grep -Eoi 'eval[^0-9]*[0-9]+\.[0-9]+ tok' "$t" | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1 || true)
  prefill=$(grep -Eoi 'prompt[^0-9]*[0-9]+\.[0-9]+ tok|prefill[^0-9]*[0-9]+\.[0-9]+' "$t" | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1 || true)
  hit=$(grep -Eoi 'hit[=: ]+[0-9.]+%?' "$t" | tail -1 | grep -Eo '[0-9]+\.?[0-9]*' | head -1 || true)
  mib=$(grep -Eoi 'MiB/tok[=: ]+[0-9.]+|mib/tok[=: ]+[0-9.]+' "$t" | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1 || true)
  drop=$(grep -Eoi 'moe-drop:[^)]*\([0-9.]+%\)' "$t" | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1 || true)
  die=$(grep -Eoi 'die[^0-9]*[0-9]+\.[0-9]+' "$t" | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1 || true)
  echo "${eval_s:-}|${prefill:-}|${hit:-}|${mib:-}|${drop:-}|${die:-}"
}

run_cell() {
  local label="$1" arm="$2" model="$3" prompt="$4" ngen="$5" rep="$6"
  local out="$OUTDIR/runs/${label}"
  mkdir -p "$out"
  local batt_s
  batt_s=$(python -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('percentage','?'))" 2>/dev/null || echo "?")
  log "CELL $label arm=$arm ngen=$ngen batt=$batt_s"
  cold "$model"
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "$BIN" -m "$model" "${BASE[@]}" -n "$ngen" -f "$prompt" \
    >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt"
  local m eval_s prefill hit mib drop die
  m=$(parse_metrics "$out/combo.txt")
  IFS='|' read -r eval_s prefill hit mib drop die <<<"$m"
  log "DONE $label eval=$eval_s prefill=$prefill hit=$hit mib=$mib drop=$drop die=$die wall=$wall rc=$rc"
  echo "$label,$arm,$(basename "$prompt"),$rep,${eval_s},${prefill},${hit},${mib},${drop},${die},${batt_s},${wall},${rc}" >> "$CSV"
  if type guardrail_tick >/dev/null 2>&1; then guardrail_tick || true; fi
}

for prompt_tag in p1 p2; do
  if [ "$prompt_tag" = p1 ]; then PR="$P1"; else PR="$P2"; fi
  if [ ! -f "$PR" ]; then log "WARN missing prompt $PR — skip"; continue; fi
  run_cell "${prompt_tag}_A1" A "$MODEL_A" "$PR" "$NGEN" 1
  run_cell "${prompt_tag}_B1" B "$MODEL_B" "$PR" "$NGEN" 1
  run_cell "${prompt_tag}_B2" B "$MODEL_B" "$PR" "$NGEN" 2
  run_cell "${prompt_tag}_A2" A "$MODEL_A" "$PR" "$NGEN" 2
done

if [ -f "$P1" ]; then
  run_cell "sos_B_n512" B "$MODEL_B" "$P1" "$NGEN_SOS" 1
fi

termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_end.json" || true
log "phase C done"
echo "DONE" > "$OUTDIR/STATUS.txt"
