#!/data/data/com.termux/files/usr/bin/bash
# Drop sweep on Jelly Star, v2 — RESUMABLE, model-parameterised.
#
# WHY V2 EXISTS
# -------------
# v1 (results/dropsweep_jelly/run_dropsweep_jelly.sh) produced a real result but
# died at 11/12 runs and had to be re-parsed offline. Its post-mortem named the
# root cause: a new harness was written instead of parameterising the proven one
# (run_kf_reality_jelly.sh). This version fixes that class of failure:
#
#   1. RESUME. State is derived from runs.csv itself — a (round,drop) label with
#      an excluded=0 row is never re-run. There is no separate resume file that
#      can disagree with the data. Kill the script at any point and relaunch it:
#      it costs one run, not the cell.
#   2. VOID PASSES. The round-robin is wrapped in an outer pass loop. Labels that
#      failed or were excluded get retried on the next pass; complete ones are
#      skipped. DONE only when nothing is void.
#   3. PRE-FLIGHT SMOKE. A 5-token run before any measurement, which must yield a
#      parseable summary. v1 burned an entire launch on a missing LD_LIBRARY_PATH
#      and another on a parser that silently returned empty timing fields; both
#      would have been caught here in 20 seconds.
#   4. TERMUX:API GUARD. termux-battery-status returning nothing must not be read
#      as "plugged in". v1 would have hit a false STOP_PLUGGED; here the API is
#      restarted and re-probed, and an unreadable API is a hard stop with its own
#      status, not a silent misclassification.
#
# PROTOCOL (unchanged from v1 — this is the same measurement)
# -----------------------------------------------------------
# - Arms: drop D in $DROPS. Nothing else changes between runs.
# - Order: round-robin over the levels, $ROUNDS rounds. Every level is sampled
#   early, middle and late, so thermal or battery drift cannot fake a trend.
# - COLD RESET before EVERY run: fadv DONTNEED on the model, Cached recorded
#   before and after. COLD-VALID iff the drop is >= MIN_DROP_MB.
# - UNPLUGGED required, battery floor $BATT_FLOOR.
#
# Exploratory characterisation. No p-value, no pre-registration, no ship claim.
set -uo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"

OUT="${OUT:?set OUT to the cell directory}"
BIN="${BIN:-$HOME/bin/kernel_kf/bmoe-cli}"
MODEL="${MODEL:?set MODEL to the gguf path}"
FADV="${FADV:-$HOME/bin/fadv}"
PROMPT="${PROMPT:-$HOME/experiments/results/kf_cold_jelly/prompts/p_fact.txt}"
NGEN="${NGEN:-200}"
COOLDOWN="${COOLDOWN:-120}"
BATT_FLOOR="${BATT_FLOOR:-45}"
DROPS="${DROPS:-0.0 0.3 0.65 1.0}"
ROUNDS="${ROUNDS:-3}"
PASSES="${PASSES:-3}"
MIN_DROP_MB="${MIN_DROP_MB:-1000}"
THREADS="${THREADS:-2}"
CACHE_MB="${CACHE_MB:-2000}"
# Extra engine flags for this model (e.g. "--n-expert-used 6"). Empty = the
# model's own routing width. Do not force a k the model was not trained for.
EXTRA_FLAGS="${EXTRA_FLAGS:-}"

# bmoe-cli ships its .so files next to the executable and they are NOT on the
# default loader path. Without this the binary dies with
# 'CANNOT LINK EXECUTABLE ... library "libllama-common.so" not found' before it
# reads a single byte of the model. Same line as run_kf_reality_jelly.sh:42.
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

mkdir -p "$OUT/per_token" "$OUT/logs"
CSV="$OUT/runs.csv"
LOG="$OUT/sweep.log"
STATUS="$OUT/STATUS.txt"
HEARTBEAT="$OUT/HEARTBEAT.txt"

ts(){ date +%Y-%m-%dT%H:%M:%S%z; }
log(){ echo "[$(ts)] $*" | tee -a "$LOG"; }
beat(){ echo "$(ts) $*" > "$HEARTBEAT"; }
cached_kib(){ awk '/^Cached:/{print $2; exit}' /proc/meminfo; }

# --- Termux:API, guarded ------------------------------------------------------
# The API service dies (screen-off, OOM kill, app update). When it does,
# termux-battery-status prints nothing and a naive `[ "$p" != UNPLUGGED ]` reads
# that as "plugged" and stops a healthy cell. Probe, restart once, re-probe.
batt_json(){ termux-battery-status 2>/dev/null | tr -d '\n'; }
api_ok(){ [ -n "$(batt_json)" ]; }
api_ensure(){
  api_ok && return 0
  log "termux-api unresponsive — termux-api-start, re-probe"
  termux-api-start >/dev/null 2>&1
  sleep 3
  api_ok
}
jfield(){ printf '%s' "$1" | sed -n "s/.*\"$2\": *\"\{0,1\}\([A-Za-z0-9._-]*\)\"\{0,1\}.*/\1/p"; }

# WHY THE COOLDOWN IS NOT A PLAIN `sleep` (added 2026-08-17 after the second loss)
# ------------------------------------------------------------------------------
# Both harness deaths on this phone happened during the cooldown, not during a
# run. 2026-08-16: last run ended 23:34:26, died in the following cooldown.
# 2026-08-17: last run ended 00:22:02, last heartbeat "cooldown before r2_d0.0",
# gone within three minutes. The phone still answered ICMP with every Termux port
# closed, so the whole app process group was killed, not just sshd.
#
# That pattern does not fit the screen timeout (the two deaths were 30 min and
# 13 min after launch). It fits Android freezing an app that has gone idle: a
# process sitting in `sleep 120` does nothing for two minutes, while a process
# doing periodic work does not look idle. So the cooldown keeps a slow pulse:
# short sleeps, a heartbeat write each time, and the wake lock re-acquired
# periodically in case the API restarted and dropped it.
#
# The MEASUREMENT is unchanged: same total cooldown seconds, same flags, same
# gate. Only the liveness mechanics differ.
cooldown_alive(){ # $1 = seconds, $2 = label being cooled down for
  # `local a="$1" b="$a"` does NOT work: local is a command, so ALL of its
  # arguments are expanded BEFORE it runs, and "$a" is therefore expanded while a
  # is still unset. Under `set -u` that is fatal, and it killed this harness at
  # every single cooldown until 2026-08-17 11:45. Assign, then derive.
  local total="$1" lbl="$2" step=5 since=0
  local left="$total"
  while [ "$left" -gt 0 ]; do
    [ "$step" -gt "$left" ] && step="$left"
    sleep "$step"
    left=$(( left - step ))
    since=$(( since + step ))
    beat "cooldown ${left}s left before $lbl"
    if [ "$since" -ge 30 ]; then
      since=0
      termux-wake-lock >/dev/null 2>&1
    fi
  done
}

# Thread count is a parameter, not a constant: the Marco-Mini sweep used the
# A/B-validated -t 2, while the CalaQwen campaign config ships -t 4. Passing it
# through EXTRA_FLAGS instead would emit `-t 2 ... -t 4` and rely on the parser
# taking the last one — true today, but not something a measurement should lean on.
BASE_FLAGS=(--moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap
            --io-threads 4 --ubatch 512 -t "$THREADS" -c 4096 --temp 0 --chatml --no-think)
# shellcheck disable=SC2206
[ -n "$EXTRA_FLAGS" ] && BASE_FLAGS+=($EXTRA_FLAGS)

if [ ! -x "$BIN" ];    then log "FATAL binary missing: $BIN";  echo FAIL_BIN    > "$STATUS"; exit 2; fi
if [ ! -f "$MODEL" ];  then log "FATAL model missing: $MODEL"; echo FAIL_MODEL  > "$STATUS"; exit 2; fi
if [ ! -f "$PROMPT" ]; then log "FATAL prompt missing: $PROMPT"; echo FAIL_PROMPT > "$STATUS"; exit 2; fi
if [ ! -x "$FADV" ];   then log "FATAL fadv missing: $FADV";   echo FAIL_FADV   > "$STATUS"; exit 2; fi

if [ ! -f "$CSV" ]; then
  echo "ts,pass,run_idx,round,drop,label,s_tok,tok_s,read_MiB,proc_read_bytes,stall_s_tok,compute_s_tok,io_s_tok,cache_hit_pct,experts_routed,experts_dropped,evictions,rereads,majflt_tok,n_tokens,cached_before_kib,cached_after_kib,cached_drop_mb,cold_valid,batt_start,batt_end,temp_start,temp_end,plugged,excluded,exclude_reason" > "$CSV"
fi

# --- resume: which labels are already good? ----------------------------------
# The CSV is the state. A label with an excluded=0 row is done, full stop.
label_done(){
  python3 - "$CSV" "$1" <<'PY'
import csv, sys
from pathlib import Path
p, want = Path(sys.argv[1]), sys.argv[2]
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            if (row.get("label") or "").strip() == want and str(row.get("excluded", "1")).strip() == "0":
                raise SystemExit(0)
raise SystemExit(1)
PY
}

void_labels(){
  # Print every planned label with no excluded=0 row, in plan order.
  python3 - "$CSV" "$ROUNDS" "$DROPS" <<'PY'
import csv, sys
from pathlib import Path
p, rounds, drops = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3].split()
plan = [f"r{r}_d{d}" for r in range(1, rounds + 1) for d in drops]
ok = set()
if p.exists() and p.stat().st_size > 0:
    with p.open(encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            if str(row.get("excluded", "1")).strip() == "0":
                ok.add((row.get("label") or "").strip())
print(" ".join(l for l in plan if l not in ok))
PY
}

log "=== DROP SWEEP v2 START ==="
log "out=$OUT"
log "bin=$BIN sha=$(sha256sum "$BIN" | cut -c1-16)"
log "model=$(basename "$MODEL") sha=$(sha256sum "$MODEL" | cut -c1-16)"
log "prompt=$(basename "$PROMPT") sha=$(sha256sum "$PROMPT" | cut -c1-16)"
log "drops='$DROPS' rounds=$ROUNDS passes=$PASSES ngen=$NGEN cooldown=${COOLDOWN}s batt_floor=$BATT_FLOOR"
log "extra_flags='$EXTRA_FLAGS'"
log "resume: void at start = [$(void_labels)]"
echo RUNNING > "$STATUS"
beat "start"

termux-wake-lock >/dev/null 2>&1 && log "wake-lock acquired" || log "wake-lock FAILED (continuing)"

if ! api_ensure; then
  log "FATAL termux-api will not answer — refusing to start (a blind battery/plug read is worse than no cell)"
  echo FAIL_API > "$STATUS"; exit 5
fi

# --- parse the engine's own summary line -------------------------------------
# The engine's keys contain slashes (s/tok, tok/s, stall_s/tok, majflt/tok).
# A sed s///-based extractor breaks on them: the slash inside the key is read as
# the s/// delimiter and the field silently comes back empty, which is what
# voided all 11 runs of v1. Split on whitespace and match the key literally
# instead — no delimiter, no escaping, no silent failure.
parse_into_vars(){ # $1 = per-token csv path
  S=$(grep '^# summary' "$1" 2>/dev/null | tail -1)
  g(){ printf '%s' "$S" | tr ' ' '\n' | awk -F= -v k="$1" '$1==k {print $2; exit}'; }
  s_tok=$(g 's/tok'); tok_s=$(g 'tok/s'); read_mib=$(g 'read_MiB')
  stall=$(g 'stall_s/tok'); comp=$(g 'compute_s/tok'); ios=$(g 'io_s/tok')
  hit=$(g 'cache_hit_pct'); er=$(g 'experts_routed'); ed=$(g 'experts_dropped')
  ev=$(g 'evictions'); rr=$(g 'rereads'); mf=$(g 'majflt/tok'); nt=$(g 'tokens')
}

# --- PRE-FLIGHT SMOKE ---------------------------------------------------------
# 5 tokens, no cold reset, not recorded as data. It proves three things v1 got
# wrong in production: the binary links, the model loads with these flags, and
# the parser returns a numeric s/tok. Cheap, and it fails in seconds.
smoke="$OUT/logs/_smoke.csv"
log "PREFLIGHT smoke n=5"
"$BIN" -m "$MODEL" -p "$(cat "$PROMPT")" -n 5 "${BASE_FLAGS[@]}" \
  --drop-cold-experts 0.0 --csv "$smoke" \
  > "$OUT/logs/_smoke.out" 2> "$OUT/logs/_smoke.err"
srup=$?
parse_into_vars "$smoke"
case "${s_tok:-}" in
  ''|*[!0-9.]*)
    log "FATAL preflight smoke failed rc=$srup s_tok='${s_tok:-}' — see $OUT/logs/_smoke.err"
    log "$(tail -5 "$OUT/logs/_smoke.err" 2>/dev/null)"
    echo FAIL_SMOKE > "$STATUS"; exit 6;;
esac
log "PREFLIGHT ok rc=$srup s/tok=$s_tok experts_routed=${er:-?} experts_dropped=${ed:-?} read_MiB=${read_mib:-?}"
log "PREFLIGHT native routing width: experts_routed=${er:-?} over 5 tokens"

run_idx=0
for pass in $(seq 1 "$PASSES"); do
  remaining="$(void_labels)"
  if [ -z "$remaining" ]; then log "pass $pass: nothing void — stopping early"; break; fi
  log "=== PASS $pass — void: [$remaining] ==="

  for round in $(seq 1 "$ROUNDS"); do
    for D in $DROPS; do
      label="r${round}_d${D}"

      if label_done "$label"; then
        log "SKIP $label (already excluded=0)"
        continue
      fi
      run_idx=$((run_idx + 1))

      if ! api_ensure; then
        log "STOP_API at $label — battery/plug state unreadable"
        echo STOP_API > "$STATUS"; exit 5
      fi
      J=$(batt_json); p=$(jfield "$J" plugged); b=$(jfield "$J" percentage)
      if [ "$p" != "UNPLUGGED" ]; then
        log "STOP_PLUGGED at $label (plugged='$p') — protocol requires UNPLUGGED"
        echo STOP_PLUGGED > "$STATUS"; exit 3
      fi
      case "$b" in
        ''|*[!0-9]*) log "STOP_BATT at $label — percentage unreadable ('$b')"
                     echo STOP_BATT > "$STATUS"; exit 4;;
      esac
      if [ "$b" -lt "$BATT_FLOOR" ]; then
        log "STOP_BATT at $label (batt=$b < $BATT_FLOOR)"
        echo STOP_BATT > "$STATUS"; exit 4
      fi

      if [ "$run_idx" -gt 1 ]; then
        log "cooldown ${COOLDOWN}s before $label"
        cooldown_alive "$COOLDOWN" "$label"
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

      # A drop token may carry the suffix `nr`, meaning "this level, with the
      # survivor rescale turned off" (e.g. DROPS="0.0 0.65 1.0 1.0nr"). It is an
      # arm of the same sweep rather than a separate cell so that it stays inside
      # the round-robin: appended at the end instead, thermal drift would land
      # entirely on the one arm we most want to trust.
      case "$D" in
        *nr) dval="${D%nr}"; arm_flags=(--drop-no-renorm) ;;
        *)   dval="$D";      arm_flags=() ;;
      esac

      pt="$OUT/per_token/${label}.csv"
      t0=$(jfield "$(batt_json)" temperature)
      beat "running $label (pass $pass)"
      "$BIN" -m "$MODEL" -p "$(cat "$PROMPT")" -n "$NGEN" "${BASE_FLAGS[@]}" \
        ${arm_flags[@]+"${arm_flags[@]}"} \
        --drop-cold-experts "$dval" --csv "$pt" \
        > "$OUT/logs/${label}.out" 2> "$OUT/logs/${label}.err" &
      pid=$!
      proc_rb=""
      while kill -0 "$pid" 2>/dev/null; do
        v=$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null)
        [ -n "$v" ] && proc_rb="$v"
        sleep 1
      done
      wait "$pid"; rc=$?
      # NOTE: do NOT `set -e` here. The header sets only `-uo pipefail`, so
      # errexit was never on; turning it on mid-loop made the next failing
      # command kill the whole sweep silently — the grep below legitimately
      # returns 1 when a run produced no summary, which is exactly the case we
      # need to record, not die on.
      J2=$(batt_json); t1=$(jfield "$J2" temperature); be=$(jfield "$J2" percentage)

      parse_into_vars "$pt"

      if [ "$rc" -ne 0 ]; then excluded=1; reason="${reason:+$reason;}cli_rc=$rc"; fi
      case "${s_tok:-}" in ''|*[!0-9.]*) excluded=1; reason="${reason:+$reason;}bad_s_tok='${s_tok:-}'";; esac
      if [ "${nt:-0}" != "$NGEN" ]; then excluded=1; reason="${reason:+$reason;}n_tokens=${nt:-}"; fi

      echo "$(ts),$pass,$run_idx,$round,$D,$label,$s_tok,$tok_s,$read_mib,$proc_rb,$stall,$comp,$ios,$hit,$er,$ed,$ev,$rr,$mf,$nt,$cb,$ca,$dmb,$cold_valid,$b,$be,$t0,$t1,$p,$excluded,${reason:-ok}" >> "$CSV"
      log "DONE $label pass=$pass rc=$rc s/tok=$s_tok tok/s=$tok_s read_MiB=$read_mib proc_rb=$proc_rb stall=$stall hit=$hit routed=$er dropped=$ed batt=${b}->${be} temp=${t0}->${t1} excluded=$excluded ${reason:-ok}"
    done
  done
done

still_void="$(void_labels)"
beat "finished"
if [ -n "$still_void" ]; then
  log "=== SWEEP INCOMPLETE after $PASSES passes — void: [$still_void] ==="
  echo STOP_VOID > "$STATUS"; exit 7
fi
log "=== DROP SWEEP COMPLETE ==="
echo DONE > "$STATUS"
