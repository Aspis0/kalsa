#!/data/data/com.termux/files/usr/bin/bash
# Drop sweep on Jelly Star — throughput AND bytes, measured together, from cold.
#
# WHY THIS CELL EXISTS
# --------------------
# `--drop-cold-experts` is the campaign's best surviving lever. Its QUALITY cost
# is measured (PC drop curve: d0.3 +0.06% bpb, d0.8 +1.6%, d1.0 +4.0%). Its BYTE
# saving has NEVER been measured — it is the flag's design intent, quoted as if
# it were a result. The PC cell never instrumented bytes and its timings are
# confounded by CPU contention that differed per arm.
#
# This measures both on the device where bytes actually cost time (slow flash,
# stall share ~22%), from a verified-cold page cache, with the levels interleaved
# so drift cannot fake a trend.
#
# DECLARED BEFORE RUNNING
# -----------------------
# - Arms: drop D in {0.0, 0.3, 0.65, 1.0}. Nothing else changes between runs.
# - Order: round-robin over the four levels, 3 rounds = 12 runs. Every level is
#   sampled early, middle and late, so thermal or battery drift cannot produce a
#   monotone trend by itself.
# - n = 200 tokens, same prompt every run.
# - COLD RESET before EVERY run: fadv DONTNEED on the model, Cached recorded
#   before and after. A run is COLD-VALID only if the drop is >= 1000 MB. This is
#   the same gate that caught three silently-warm runs in the K-F cold cell.
# - Cooldown 120 s (the K-F cell used 300 s targeting 30 C; this device is at
#   ~20 C ambient, far below that target — declared, not discovered).
# - UNPLUGGED required, battery floor 45%.
#
# INTERNAL CONTROL (the reason d=0.65 is in the sweep)
# ----------------------------------------------------
# d=0.65 with no prefetch is exactly the OFF arm of the K-F cold cell, same
# binary, same model, same flags. It should reproduce ~0.192 s/tok and ~22.3 GB
# of /proc read_bytes. If it does not, this cell is measuring something else and
# the whole sweep is void.
#
# PRE-DECLARED EXPECTATION AND KILL
# ---------------------------------
# Expect bytes to fall monotonically with D. If bytes do NOT fall, the flag does
# not do what we have been claiming, and "expert skipping is our fast mode" loses
# its mechanism — that outcome is a result, not a failure, and gets reported.
#
# Exploratory characterisation. No p-value, no pre-registration, no ship claim.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

OUT="${OUT:-$HOME/experiments/results/dropsweep_jelly}"
BIN="${BIN:-$HOME/bin/kernel_kf/bmoe-cli}"
MODEL="${MODEL:-$HOME/models/Marco-Mini-Instruct-KEXP.gguf}"
FADV="${FADV:-$HOME/bin/fadv}"
PROMPT="${PROMPT:-$HOME/experiments/results/kf_cold_jelly/prompts/p_fact.txt}"
NGEN="${NGEN:-200}"
COOLDOWN="${COOLDOWN:-120}"
BATT_FLOOR="${BATT_FLOOR:-45}"
DROPS="${DROPS:-0.0 0.3 0.65 1.0}"
ROUNDS="${ROUNDS:-3}"
MIN_DROP_MB=1000

# bmoe-cli ships its .so files next to the executable and they are NOT on the
# default loader path. Without this the binary dies with
# 'CANNOT LINK EXECUTABLE ... library "libllama-common.so" not found' before it
# reads a single byte of the model. Same line as run_kf_reality_jelly.sh:42.
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

mkdir -p "$OUT/per_token" "$OUT/logs"
CSV="$OUT/runs.csv"
LOG="$OUT/sweep.log"
STATUS="$OUT/STATUS.txt"

ts(){ date +%Y-%m-%dT%H:%M:%S%z; }
log(){ echo "[$(ts)] $*" | tee -a "$LOG"; }
cached_kib(){ awk '/^Cached:/{print $2; exit}' /proc/meminfo; }
batt(){ termux-battery-status 2>/dev/null | tr -d '\n' | sed -n 's/.*"percentage": *\([0-9]*\).*/\1/p'; }
plugged(){ termux-battery-status 2>/dev/null | tr -d '\n' | sed -n 's/.*"plugged": *"\([A-Z_]*\)".*/\1/p'; }
temp(){ termux-battery-status 2>/dev/null | tr -d '\n' | sed -n 's/.*"temperature": *\([0-9.]*\).*/\1/p'; }

BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap
            --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think
            --n-expert-used 6)

if [ ! -x "$BIN" ]; then log "FATAL binary missing: $BIN"; echo FAIL_BIN > "$STATUS"; exit 2; fi
if [ ! -f "$MODEL" ]; then log "FATAL model missing: $MODEL"; echo FAIL_MODEL > "$STATUS"; exit 2; fi
if [ ! -f "$PROMPT" ]; then log "FATAL prompt missing: $PROMPT"; echo FAIL_PROMPT > "$STATUS"; exit 2; fi
if [ ! -x "$FADV" ]; then log "FATAL fadv missing: $FADV"; echo FAIL_FADV > "$STATUS"; exit 2; fi

if [ ! -f "$CSV" ]; then
  echo "ts,run_idx,round,drop,label,s_tok,tok_s,read_MiB,proc_read_bytes,stall_s_tok,compute_s_tok,io_s_tok,cache_hit_pct,experts_routed,experts_dropped,evictions,rereads,majflt_tok,n_tokens,cached_before_kib,cached_after_kib,cached_drop_mb,cold_valid,batt_start,batt_end,temp_start,temp_end,plugged,excluded,exclude_reason" > "$CSV"
fi

log "=== DROP SWEEP START ==="
log "bin=$BIN sha=$(sha256sum "$BIN" | cut -c1-16)"
log "model=$(basename "$MODEL") sha=$(sha256sum "$MODEL" | cut -c1-16)"
log "prompt=$(basename "$PROMPT") sha=$(sha256sum "$PROMPT" | cut -c1-16)"
log "drops='$DROPS' rounds=$ROUNDS ngen=$NGEN cooldown=${COOLDOWN}s batt_floor=$BATT_FLOOR"
echo RUNNING > "$STATUS"

run_idx=0
for round in $(seq 1 "$ROUNDS"); do
  for D in $DROPS; do
    run_idx=$((run_idx + 1))
    label="r${round}_d${D}"

    p=$(plugged); b=$(batt)
    if [ "$p" != "UNPLUGGED" ]; then
      log "STOP_PLUGGED at $label (plugged=$p) — protocol requires UNPLUGGED"
      echo STOP_PLUGGED > "$STATUS"; exit 3
    fi
    if [ -n "$b" ] && [ "$b" -lt "$BATT_FLOOR" ]; then
      log "STOP_BATT at $label (batt=$b < $BATT_FLOOR)"
      echo STOP_BATT > "$STATUS"; exit 4
    fi
    if [ "$run_idx" -gt 1 ]; then
      log "cooldown ${COOLDOWN}s before $label"
      sleep "$COOLDOWN"
    fi

    # --- cold reset, verified ---
    cb=$(cached_kib); sync
    fout=$("$FADV" "$MODEL" 2>&1); frc=$?
    ca=$(cached_kib)
    dmb=$(( (cb - ca) / 1024 ))
    log "COLD_RESET $label cached ${cb}->${ca} drop_mb=$dmb fadv_rc=$frc"
    cold_valid=1; excluded=0; reason=""
    if [ "$frc" -ne 0 ] || [ "$dmb" -lt "$MIN_DROP_MB" ]; then
      cold_valid=0; excluded=1
      reason="not_cold_valid(drop_mb=$dmb;fadv_rc=$frc)"
      log "EXCLUDE $label $reason"
    fi

    pt="$OUT/per_token/${label}.csv"
    t0=$(temp)
    set +e
    "$BIN" -m "$MODEL" -p "$(cat "$PROMPT")" -n "$NGEN" "${BASE_FLAGS[@]}" \
      --drop-cold-experts "$D" --csv "$pt" \
      > "$OUT/logs/${label}.out" 2> "$OUT/logs/${label}.err" &
    pid=$!
    proc_rb=""
    while kill -0 "$pid" 2>/dev/null; do
      v=$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null)
      [ -n "$v" ] && proc_rb="$v"
      sleep 1
    done
    wait "$pid"; rc=$?
    # NOTE: do NOT `set -e` here. The header sets only `-uo pipefail`, so errexit
    # was never on; turning it on mid-loop made the next failing command kill the
    # whole sweep silently — the grep below legitimately returns 1 when a run
    # produced no summary, which is exactly the case we need to record, not die on.
    t1=$(temp); be=$(batt)

    # --- parse the engine's own summary line ---
    S=$(grep '^# summary' "$pt" 2>/dev/null | tail -1)
    # The engine's keys contain slashes (s/tok, tok/s, stall_s/tok, majflt/tok).
    # A sed s///-based extractor breaks on them: the slash inside the key is read
    # as the s/// delimiter and the field silently comes back empty, which is what
    # voided the first 11 runs of this cell. Split on whitespace and match the key
    # literally instead — no delimiter, no escaping, no silent failure.
    g(){ printf '%s' "$S" | tr ' ' '\n' | awk -F= -v k="$1" '$1==k {print $2; exit}'; }
    s_tok=$(g 's/tok'); tok_s=$(g 'tok/s'); read_mib=$(g 'read_MiB')
    stall=$(g 'stall_s/tok'); comp=$(g 'compute_s/tok'); ios=$(g 'io_s/tok')
    hit=$(g 'cache_hit_pct'); er=$(g 'experts_routed'); ed=$(g 'experts_dropped')
    ev=$(g 'evictions'); rr=$(g 'rereads'); mf=$(g 'majflt/tok'); nt=$(g 'tokens')

    if [ "$rc" -ne 0 ]; then excluded=1; reason="${reason:+$reason;}cli_rc=$rc"; fi
    case "$s_tok" in ''|*[!0-9.]*) excluded=1; reason="${reason:+$reason;}bad_s_tok='$s_tok'";; esac
    if [ "${nt:-0}" != "$NGEN" ]; then excluded=1; reason="${reason:+$reason;}n_tokens=$nt"; fi

    echo "$(ts),$run_idx,$round,$D,$label,$s_tok,$tok_s,$read_mib,$proc_rb,$stall,$comp,$ios,$hit,$er,$ed,$ev,$rr,$mf,$nt,$cb,$ca,$dmb,$cold_valid,$b,$be,$t0,$t1,$p,$excluded,${reason:-ok}" >> "$CSV"
    log "DONE $label rc=$rc s/tok=$s_tok tok/s=$tok_s read_MiB=$read_mib proc_rb=$proc_rb stall=$stall hit=$hit dropped=$ed batt=${b}->${be} temp=${t0}->${t1} excluded=$excluded ${reason:-ok}"
  done
done

log "=== DROP SWEEP COMPLETE ==="
echo DONE > "$STATUS"
