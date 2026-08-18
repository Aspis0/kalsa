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
# OEM demotes idle Termux to /moderate; run_f4.sh waits this long for
# promotion before exit 93. Same name, same default, same reason.
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"

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

# --- F4.3-bis cpuset (gate + covariates) -------------------------------------
# A row without nproc/affinity_mask cannot be interpreted later (2026-08-06:
# measurements on a background cpuset were 3× A510). The GATE probes the
# shell because a child inherits that set and refusing to start is cheaper
# than a cell of unreadable rows. The CSV columns are a different question:
# cpuset is per-process, so those values come from the bmoe-cli PID, never
# from $$. /proc/self here is preflight only — same split as run_bench.sh
# (read_cpuset_info vs read_pid_cpuset).
#
# taskset is optional on Termux; do not depend on it. Popcount the
# Cpus_allowed_list (e.g. 0-2 / 0-3,6-7) in pure shell.

count_cpu_list() {
    # $1 = Cpus_allowed_list. Empty → 0 (fail-closed for the gate; empty
    # string for the CSV is decided by the caller when /proc is gone).
    local list="$1"
    local n=0
    [ -n "$list" ] || { echo 0; return; }
    local oldifs="$IFS"
    IFS=','
    # shellcheck disable=SC2086
    set -- $list
    IFS="$oldifs"
    local part a b
    for part in "$@"; do
        case "$part" in
            *-*)
                a="${part%-*}"
                b="${part#*-}"
                if [ -n "$a" ] && [ -n "$b" ]; then
                    n=$((n + b - a + 1))
                fi
                ;;
            *)
                [ -n "$part" ] && n=$((n + 1))
                ;;
        esac
    done
    echo "$n"
}

popcount_hex() {
    # Nibble table in this shell — no bash -c, no 16# overflow on long
    # masks, commas/0x skipped. Same numeric result as run_bench.sh for
    # the short hex it actually writes (3f/5f/ff).
    local hex="$1"
    local c=0 ch
    [ -n "$hex" ] || { echo 0; return; }
    while [ -n "$hex" ]; do
        ch="${hex%"${hex#?}"}"
        hex="${hex#?}"
        case "$ch" in
            1|2|4|8) c=$((c + 1)) ;;
            3|5|6|9|a|A|c|C) c=$((c + 2)) ;;
            7|b|B|d|D|e|E) c=$((c + 3)) ;;
            f|F) c=$((c + 4)) ;;
        esac
    done
    echo "$c"
}

read_pid_cpuset() {
    # Prints: nproc affinity_mask
    # Prefer Cpus_allowed (hex) popcount; fallback Cpus_allowed_list count.
    # Empty if unreadable. Never invent. PROC_ROOT override is for tests.
    # One awk (both fields) + in-shell popcount: this can sit on the
    # measured cpuset, so do not fork a second bash per sample.
    local pid="$1"
    local proc_root="${PROC_ROOT:-/proc}"
    local st="${proc_root}/${pid}/status"
    if [ ! -r "$st" ]; then
        echo " "
        return
    fi
    local raw list mask n
    raw="$(awk -F: '
        /^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); list=$2}
        /^Cpus_allowed:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); mask=$2}
        END{print list "\t" mask}
    ' "$st" 2>/dev/null)"
    list="${raw%%	*}"
    mask="${raw#*	}"
    mask="${mask#0x}"
    mask="${mask#0X}"
    mask="${mask,,}"
    n=""
    if [ -n "$mask" ]; then
        n="$(popcount_hex "$mask")"
    fi
    if [ -z "$n" ] || [ "$n" = "0" ]; then
        n="$(count_cpu_list "$list")"
    fi
    echo "${n} ${mask}"
}

sanitize_notes() {
    # run_bench.sh:143 — a comma in any CSV field splits the row.
    printf '%s' "$1" | tr ',\n\r' ';;;' | tr -s ';' | sed 's/^;//;s/;$//'
}

CPUSET_NOTE=""
CSV_HAS_CPUSET=0

cpuset_gate_why() {
    # $1=nproc $2=Cpus_allowed_list $3=/proc/self/cpuset $4=cgroup cpuset path
    # Prints the restricted_cpuset(...) reason and returns 1 if the F4.3-bis
    # gate should fire; prints nothing and returns 0 if the set is usable.
    # Split out so the decision can be fed fake /proc strings on a PC.
    # Note carries bits= (popcount), not the raw list: a multi-range list
    # contains a comma and would split exclude_reason.
    local np="$1"
    local mask_list="$2"
    local cpuset_path="$3"
    local cg="$4"
    local bits bad
    bits="$(count_cpu_list "$mask_list")"
    bad=0
    if [ -z "$np" ] || [ "$np" -lt 6 ] 2>/dev/null; then bad=1; fi
    # Match list is background / system-background / moderate — same as
    # run_f4.sh. "restricted" is the English for the gate, not a path token.
    case "${cpuset_path} ${cg}" in
        *background*|*system-background*|*moderate*) bad=1 ;;
    esac
    if [ "$bits" -lt 6 ] 2>/dev/null; then bad=1; fi
    if [ "$bad" -eq 0 ]; then
        return 0
    fi
    printf '%s' "restricted_cpuset(nproc=${np:-};bits=${bits:-};cpuset=${cpuset_path:-};cgroup=${cg:-})"
    return 1
}

gate_cpuset() {
    # Hard fail, exit 93, no CSV row — schema F4.3-bis. Trigger: nproc < 6,
    # or the cgroup/cpuset path is background / system-background / moderate,
    # or the affinity-list popcount is < 6.
    # Wait-and-retry like run_f4.sh: the OEM demotes idle Termux to /moderate
    # (screen-off ssh launch is the normal posture) and promotes once the
    # app is visibly working. Exit 93 only after MAX_COOL_WAIT_S.
    # ALLOW_RESTRICTED_CPUSET=1 skips the wait: deliberate little-core
    # experiment, loud warning, every row tagged in exclude_reason.
    local np mask_list cpuset_path cg why
    local waited=0
    while true; do
        np="$(nproc 2>/dev/null || echo 0)"
        mask_list="$(awk -F: '/^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); print $2; exit}' /proc/self/status 2>/dev/null || true)"
        cpuset_path="$(tr -d '\n' < /proc/self/cpuset 2>/dev/null || true)"
        cg="$(awk -F: '/cpuset/{print $3; exit}' /proc/self/cgroup 2>/dev/null || true)"
        why="$(cpuset_gate_why "$np" "$mask_list" "$cpuset_path" "$cg")" || true
        if [ -z "$why" ]; then
            log "cpuset OK nproc=$np bits=$(count_cpu_list "$mask_list") cpuset=${cpuset_path:-?} cgroup=${cg:-?}"
            return 0
        fi
        if [ "${ALLOW_RESTRICTED_CPUSET:-0}" = "1" ]; then
            log "WARN cpuset restricted but ALLOW_RESTRICTED_CPUSET=1 — $why"
            CPUSET_NOTE="$why"
            return 0
        fi
        if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
            log "FATAL cpuset restricted — $why (no recovery within ${MAX_COOL_WAIT_S}s; set ALLOW_RESTRICTED_CPUSET=1 to proceed anyway)"
            echo FAIL_CPUSET > "$STATUS"
            exit 93
        fi
        log "WAIT/cpuset: $why — need top-app >=6 cores (waited ${waited}s)"
        beat "WAIT/cpuset ${waited}s/${MAX_COOL_WAIT_S}s"
        sleep 30
        termux-wake-lock >/dev/null 2>&1
        waited=$((waited + 30))
    done
}

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

# Existing cells on the phones have the old header (ends at exclude_reason).
# DictReader already treats short rows as done (it keys by name, so resume
# stays correct either way). A silently ragged file — header claiming N
# columns, rows with N-2 — is the failure mode. So we migrate: rewrite the
# header and pad every existing row with two empty fields. Empty is honest
# (we did not observe those runs). New rows get real values. Columns are
# only ever appended; nothing that indexes the old order shifts.
CSV_HEADER="ts,pass,run_idx,round,drop,label,s_tok,tok_s,read_MiB,proc_read_bytes,stall_s_tok,compute_s_tok,io_s_tok,cache_hit_pct,experts_routed,experts_dropped,evictions,rereads,majflt_tok,n_tokens,cached_before_kib,cached_after_kib,cached_drop_mb,cold_valid,batt_start,batt_end,temp_start,temp_end,plugged,excluded,exclude_reason,nproc,affinity_mask"

csv_migrate_append() {
    # $1=csv $2=comma-separated new names $3=how many empty fields to pad.
    # Atomic replace; rm the temp on both success (already renamed) and
    # failure so schema_migrate.$$ cannot leak.
    local csv="$1"
    local cols="$2"
    local n="$3"
    local tmp="${csv}.schema_migrate.$$"
    {
        printf '%s,%s\n' "$(head -n1 "$csv")" "$cols"
        tail -n +2 "$csv" | awk -F, -v n="$n" 'BEGIN{OFS=","} {
            extra=""
            i=0
            while (i < n) { extra=extra OFS ""; i++ }
            print $0 extra
        }'
    } > "$tmp" && mv "$tmp" "$csv"
    rm -f "$tmp"
}

ensure_csv_header() {
    local csv="$1"
    # 0-byte is "no header": DictReader would treat the first data row as
    # the header and the cell would end STOP_VOID.
    if [ ! -s "$csv" ]; then
        printf '%s\n' "$CSV_HEADER" > "$csv"
        CSV_HAS_CPUSET=1
        return 0
    fi
    local old tmp
    old="$(head -n1 "$csv" 2>/dev/null || true)"
    case "$old" in
        *",exclude_reason,nproc,affinity_mask")
            CSV_HAS_CPUSET=1
            return 0
            ;;
        *",exclude_reason")
            tmp="${csv}.schema_migrate.$$"
            {
                printf '%s\n' "$CSV_HEADER"
                tail -n +2 "$csv" | awk -F, 'BEGIN{OFS=","} { print $0 OFS "" OFS "" }'
            } > "$tmp" && mv "$tmp" "$csv"
            rm -f "$tmp"
            CSV_HAS_CPUSET=1
            log "csv schema migrate: appended nproc,affinity_mask (old rows padded empty)"
            return 0
            ;;
        *)
            # Not our header (reused run_bench cell dir, or a future header
            # that grew past affinity_mask). Guarantee: after this returns,
            # the header names nproc and affinity_mask and every existing
            # row has the same NF as the header. We only append; we do not
            # reshuffle, and we do not promise the header is ours.
            if ! printf '%s' "$old" | grep -q ',nproc,affinity_mask'; then
                csv_migrate_append "$csv" "nproc,affinity_mask" 2
                log "csv schema migrate: unknown header, appended nproc,affinity_mask"
            fi
            CSV_HAS_CPUSET=1
            return 0
            ;;
    esac
}

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

# F4.3-bis: refuse the cell before any measurement (including the smoke).
# Same voice as the API refusal above: a restricted cpuset is worse than
# no cell, because the rows would look real and be uninterpretable.
gate_cpuset

# After the gate, not before: exit 93 must leave an existing CSV untouched
# (no header rewrite, no padded rows). New cells get the new header here.
ensure_csv_header "$CSV"

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
      bin_nproc=""
      bin_mask=""
      cpuset_age=0
      while kill -0 "$pid" 2>/dev/null; do
        v=$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null)
        [ -n "$v" ] && proc_rb="$v"
        # Cpuset is near-static; last live sample is what we write. Sample
        # on the first tick and every 8s so the extra /proc read does not
        # sit on the measured cpuset every second.
        if [ "$cpuset_age" -eq 0 ]; then
          # shellcheck disable=SC2046
          set -- $(read_pid_cpuset "$pid")
          [ -n "${1:-}" ] && bin_nproc="$1"
          [ -n "${2:-}" ] && bin_mask="$2"
        fi
        cpuset_age=$((cpuset_age + 1))
        [ "$cpuset_age" -ge 8 ] && cpuset_age=0
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
      # Hatch tag is a note, not an exclude: excluded=1 would make resume
      # retry the label forever. The row stays excluded=0 and self-identifies.
      if [ -n "${CPUSET_NOTE:-}" ]; then
        reason="${reason:+$reason;}$CPUSET_NOTE"
      fi
      # Sanitize AFTER assembly: a comma in reason/mask (Cpus_allowed_list
      # 0-3,6-7, or a comma-grouped hex mask) would silently split the row.
      reason="$(sanitize_notes "${reason:-ok}")"
      bin_nproc="$(sanitize_notes "${bin_nproc:-}")"
      bin_mask="$(sanitize_notes "${bin_mask:-}")"

      row="$(ts),$pass,$run_idx,$round,$D,$label,$s_tok,$tok_s,$read_mib,$proc_rb,$stall,$comp,$ios,$hit,$er,$ed,$ev,$rr,$mf,$nt,$cb,$ca,$dmb,$cold_valid,$b,$be,$t0,$t1,$p,$excluded,$reason"
      if [ "${CSV_HAS_CPUSET:-0}" -eq 1 ]; then
        row="${row},${bin_nproc},${bin_mask}"
      fi
      # If the header is wider than our schema (unknown-header append, or a
      # later column after affinity_mask), pad so we cannot emit a short row.
      hdr_nf="$(awk -F, 'NR==1{print NF; exit}' "$CSV")"
      row_nf="$(printf '%s\n' "$row" | awk -F, '{print NF}')"
      while [ "${row_nf:-0}" -lt "${hdr_nf:-0}" ]; do
        row="${row},"
        row_nf=$((row_nf + 1))
      done
      # A torn append after field 30 (excluded=0) with empty covariates is
      # treated as done by resume. Needs an exotic partial write; no fsync.
      echo "$row" >> "$CSV"
      log "DONE $label pass=$pass rc=$rc s/tok=$s_tok tok/s=$tok_s read_MiB=$read_mib proc_rb=$proc_rb stall=$stall hit=$hit routed=$er dropped=$ed batt=${b}->${be} temp=${t0}->${t1} nproc=${bin_nproc:-} mask=${bin_mask:-} excluded=$excluded ${reason:-ok}"
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
