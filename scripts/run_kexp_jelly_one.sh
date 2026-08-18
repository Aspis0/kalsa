#!/data/data/com.termux/files/usr/bin/bash
# Single cold decode cell for LFM2.5 KEXP speed re-test on Jelly.
# Flags MUST match scripts/run_g99_freetier_jelly.sh (G99 free-tier).
# Battery gate is enforced by the PC orchestrator (adb dumpsys).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
unset LD_LIBRARY_PATH

OUTDIR="${OUTDIR:-$HOME/bench_kexp}"
BIN="${BINARY:-$HOME/bin/run-bmoe}"
THREADS="${THREADS:-2}"
N_CTX="${N_CTX:-1024}"
N_GEN="${N_GEN:-200}"
PROMPT_FILE="${PROMPT_FILE:-$OUTDIR/prompt.txt}"

CELL="${1:?cell}"
MODEL="${2:?model}"
RUN="${3:?run}"
EXTRA="${4:-}"

mkdir -p "$OUTDIR/logs"
MASTER="$OUTDIR/KEXP.master.log"
CSV="$OUTDIR/runs.csv"
outf="$OUTDIR/logs/${CELL}_r${RUN}.log"
rssf="$OUTDIR/logs/${CELL}_r${RUN}.rss"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

if [ ! -f "$CSV" ]; then
  echo "ts,cell,run,tok_s,majflt_tok,rss_kib,res_pages,res_pct,mapped_mib,n_expert_used,rc" > "$CSV"
fi

log "RUN cell=$CELL run=$RUN model=$MODEL extra=[$EXTRA]"

if [ -x "$HOME/bin/cold_model.sh" ]; then
  "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || log "WARN cold_model failed"
else
  log "WARN no cold_model.sh"
fi

{
  echo "=== MEM pre ${CELL}_r${RUN} $(ts) ==="
  free -h || true
  echo "---"
} >> "$OUTDIR/mem.log"

# RSS sampler while bmoe runs
: > "$rssf"
(
  for _i in $(seq 1 80); do
    sleep 1
    ps -o pid,rss,args -A 2>/dev/null | grep -E '[b]moe-cli|[l]lama' | awk '{print strftime("%Y-%m-%dT%H:%M:%S"), $0}' >> "$rssf" || true
  done
) &
samp=$!

prompt=$(cat "$PROMPT_FILE")
# shellcheck disable=SC2206
extra_arr=($EXTRA)
set +e
"$BIN" -m "$MODEL" \
  -t "$THREADS" -c "$N_CTX" -n "$N_GEN" \
  -p "$prompt" --temp 0 --ubatch 256 \
  "${extra_arr[@]}" \
  >"$outf" 2>&1
rc=$?
set -e
kill "$samp" 2>/dev/null || true
wait "$samp" 2>/dev/null || true

{
  echo "=== MEM post ${CELL}_r${RUN} $(ts) ==="
  free -h || true
  echo "---"
} >> "$OUTDIR/mem.log"

res_line=""
if [ -f "$OUTDIR/residency.py" ]; then
  res_line=$(python3 "$OUTDIR/residency.py" "$MODEL" 2>>"$MASTER" || true)
  echo "$res_line" | tee -a "$MASTER"
  echo "$res_line" > "$OUTDIR/logs/${CELL}_r${RUN}.residency"
fi

python3 - "$outf" "$rssf" "$MODEL" "$CELL" "$RUN" "$rc" "$CSV" "$res_line" <<'PY'
import re, sys, os, datetime
logp, rssp, model, cell, run, rc, csvp = sys.argv[1:8]
res_line = sys.argv[8] if len(sys.argv) > 8 else ""
text = open(logp, encoding="utf-8", errors="replace").read()

def last(pat, default=""):
    ms = re.findall(pat, text)
    return ms[-1] if ms else default

tok = last(r"generation:\s*\d+\s*tokens?,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)")
if not tok:
    tok = last(r"eval time\s*=\s*[0-9.]+ ms\s*/\s*\d+\s*tokens?\s*\(\s*[0-9.]+\s*ms per token,\s*([0-9.]+)\s*tokens per second\)")
maj = last(r"([0-9.]+)\s*major faults/token")
mapped = last(r"CPU_Mapped buffer\s*=\s*([0-9.]+)\s*MiB")
nexp = last(r"n_expert_used\s*=\s*(\d+)")
if not nexp:
    nexp = last(r"expert_used_count\s*=\s*(\d+)")

rss_vals = []
if os.path.isfile(rssp):
    for line in open(rssp, encoding="utf-8", errors="replace"):
        parts = line.split()
        for p in parts:
            if p.isdigit() and int(p) > 10000:
                rss_vals.append(int(p))
                break
rss = max(rss_vals) if rss_vals else 0

res_pages = ""
res_pct = ""
m = re.search(r"resident=(\d+)\s+hit_pct=([0-9.]+)", res_line)
if m:
    res_pages, res_pct = m.group(1), m.group(2)

print(f"PARSE tok={tok} majflt={maj} rss_kib={rss} res_pages={res_pages} hit_pct={res_pct} mapped_mib={mapped} n_expert_used={nexp} rc={rc}")
ts = datetime.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
with open(csvp, "a", encoding="utf-8") as f:
    f.write(f"{ts},{cell},{run},{tok},{maj},{rss},{res_pages},{res_pct},{mapped},{nexp},{rc}\n")
PY

log "RUN cell=$CELL run=$RUN rc=$rc"
echo "RC=$rc"
exit "$rc"
