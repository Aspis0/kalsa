#!/data/data/com.termux/files/usr/bin/bash
# Lineup one-cell wrapper. F4.3-bis cpuset gate (exit 93). Records BINARY /proc/pid/cpuset.
# Usage: one_cell_lineup.sh TAG MODEL_PATH N_THREADS [extra bmoe flags...]
set -u
# run-as sets HOME to /data/user/0/com.termux — force the real Termux home.
export HOME="/data/data/com.termux/files/home"
export PREFIX="/data/data/com.termux/files/usr"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="$PREFIX/tmp"
export LC_ALL=C

OUTDIR="${LINEUP_OUTDIR:-$HOME/experiments/results/lineup_abs_s23}"
BIN="${LINEUP_BIN:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
PROMPT_FILE="${LINEUP_PROMPT:-$HOME/experiments/prompts/short.txt}"
N_GEN="${LINEUP_N_GEN:-512}"
mkdir -p "$OUTDIR/logs" "$OUTDIR/probes"
chmod 777 "$OUTDIR" "$OUTDIR/logs" "$OUTDIR/probes" 2>/dev/null || true
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

TAG="${1:-}"
MODEL="${2:-}"
THREADS="${3:-4}"
shift 3 || true
EXTRA=("$@")

if [ -z "$TAG" ] || [ -z "$MODEL" ]; then
  echo "usage: one_cell_lineup.sh TAG MODEL THREADS [extra flags]" >&2
  exit 91
fi

count_cpu_list() {
    _list="$1"
    _n=0
    [ -n "$_list" ] || { echo 0; return; }
    _IFS="$IFS"; IFS=','; set -- $_list; IFS="$_IFS"
    for _part in "$@"; do
        case "$_part" in
            *-*) _a="${_part%-*}"; _b="${_part#*-}"
                if [ -n "$_a" ] && [ -n "$_b" ]; then _n=$((_n + _b - _a + 1)); fi ;;
            *) if [ -n "$_part" ]; then _n=$((_n + 1)); fi ;;
        esac
    done
    echo "$_n"
}

cpuset_gate_why() {
    local np="$1" mask_list="$2" cpuset_path="$3" cg="$4"
    local bits bad
    bits="$(count_cpu_list "$mask_list")"
    bad=0
    if [ -z "$np" ] || [ "$np" -lt 6 ] 2>/dev/null; then bad=1; fi
    case "${cpuset_path} ${cg}" in
        *background*|*system-background*|*moderate*) bad=1 ;;
    esac
    if [ "$bits" -lt 6 ] 2>/dev/null; then bad=1; fi
    if [ "$bad" -eq 0 ]; then return 0; fi
    printf '%s' "restricted_cpuset(nproc=${np:-};bits=${bits:-};cpuset=${cpuset_path:-};cgroup=${cg:-})"
    return 1
}

read_self_cpuset() {
    NP="$(nproc 2>/dev/null || echo 0)"
    MASK="$(awk -F: '/^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); print $2; exit}' /proc/self/status 2>/dev/null || true)"
    CS="$(tr -d '\n' < /proc/self/cpuset 2>/dev/null || true)"
    CG="$(awk -F: '/cpuset/{print $3; exit}' /proc/self/cgroup 2>/dev/null || true)"
}

gate_or_93() {
    local who="$1"
    read_self_cpuset
    local why
    why="$(cpuset_gate_why "$NP" "$MASK" "$CS" "$CG")" || true
    echo "GATE_$who nproc=$NP bits=$(count_cpu_list "$MASK") cpuset=${CS:-?} cgroup=${CG:-?} mask=$MASK" > "$OUTDIR/probes/${TAG}_${who}_cpuset.txt"
    if [ -n "$why" ]; then
        echo "FAIL_CPUSET $who $why" > "$OUTDIR/logs/${TAG}.rc"
        echo "$why" > "$OUTDIR/probes/${TAG}_${who}_why.txt"
        exit 93
    fi
}

# --- F4.3-bis gate on the HARNESS (shell that will spawn the binary) ---
gate_or_93 HARNESS

if [ ! -x "$BIN" ]; then echo "missing BIN $BIN" >&2; echo 90 > "$OUTDIR/logs/${TAG}.rc"; exit 90; fi
if [ ! -e "$MODEL" ]; then echo "missing MODEL $MODEL" >&2; echo 90 > "$OUTDIR/logs/${TAG}.rc"; exit 90; fi
if [ ! -f "$PROMPT_FILE" ]; then echo "missing prompt $PROMPT_FILE" >&2; echo 90 > "$OUTDIR/logs/${TAG}.rc"; exit 90; fi

sha256sum "$BIN" > "$OUTDIR/probes/${TAG}_bin.sha" 2>/dev/null || true
PTEXT="$(cat "$PROMPT_FILE")"

OUTF="$OUTDIR/logs/${TAG}.out"
ERRF="$OUTDIR/logs/${TAG}.err"
RCF="$OUTDIR/logs/${TAG}.rc"
PIDF="$OUTDIR/logs/${TAG}.pid"
rm -f "$RCF" "$PIDF"

# Launch detached so a PC adb teardown cannot SIGHUP bmoe.
# NEVER SIGTERM from this wrapper.
(
  "$BIN" -m "$MODEL" -p "$PTEXT" -n "$N_GEN" -t "$THREADS" "${EXTRA[@]}" >"$OUTF" 2>"$ERRF"
  echo $? > "$RCF"
) &
BPID=$!
echo "$BPID" > "$PIDF"

# Record BINARY process cpuset (the validity artifact). Child is bmoe.
sleep 0.4
# The background subshell pid may not be bmoe; find the real binary pid.
BP="$(pidof bmoe-cli.CAMPAIGN 2>/dev/null || pidof bmoe-cli 2>/dev/null || echo "")"
if [ -z "$BP" ]; then
  # fallback: children of subshell
  BP="$(ps -o pid,ppid,comm 2>/dev/null | awk -v p="$BPID" '$2==p {print $1; exit}')"
fi
echo "wrapper=$BPID binary_pid=${BP:-NONE}" > "$OUTDIR/probes/${TAG}_pids.txt"
if [ -n "$BP" ] && [ -d "/proc/$BP" ]; then
  {
    echo "binary_pid=$BP"
    echo -n "cpuset="; tr -d '\n' < "/proc/$BP/cpuset"; echo
    echo -n "cgroup="; awk -F: '/cpuset/{print $3; exit}' "/proc/$BP/cgroup"
    grep -E '^Cpus_allowed' "/proc/$BP/status"
    echo "nproc_self_at_spawn=$NP"
  } > "$OUTDIR/probes/${TAG}_BIN_cpuset.txt"
  BLIST="$(awk -F: '/^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); print $2; exit}' "/proc/$BP/status")"
  BCS="$(tr -d '\n' < "/proc/$BP/cpuset" 2>/dev/null || true)"
  BCG="$(awk -F: '/cpuset/{print $3; exit}' "/proc/$BP/cgroup" 2>/dev/null || true)"
  BNPROC="$(count_cpu_list "$BLIST")"
  BWHY="$(cpuset_gate_why "$BNPROC" "$BLIST" "$BCS" "$BCG")" || true
  echo "binary_gate nproc_bits=$BNPROC list=$BLIST cpuset=$BCS why=${BWHY:-OK}" >> "$OUTDIR/probes/${TAG}_BIN_cpuset.txt"
  if [ -n "$BWHY" ]; then
    echo "FAIL_CPUSET BINARY $BWHY" > "$OUTDIR/probes/${TAG}_BIN_why.txt"
    # Do not SIGTERM. Wait for natural exit. Host will exclude.
  fi
fi

wait "$BPID"
if [ ! -f "$RCF" ]; then echo 99 > "$RCF"; fi
exit 0
