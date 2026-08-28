#!/system/bin/sh
# Guarded one-shot. POSIX/toybox. LF only.
# Usage: run_guarded.sh TAG WARN_TENTHS KILL_TENTHS INTERVAL_S CMDFILE
# CMDFILE is exec'd after the guard publishes READY+TRACKING.

set -u

TAG=$1
WARN=$2
KILL=$3
INTERVAL=$4
CMDFILE=$5

DIR=/data/local/tmp/s23_unplugged_night0
GUARD=/data/local/tmp/thermal_guard.sh
PIDFILE=$DIR/${TAG}.pid
READY=$DIR/${TAG}.ready
TRACKING=$DIR/${TAG}.tracking
GLOG=$DIR/${TAG}.guard.log
GRC=$DIR/${TAG}.guard_rc
WRC=$DIR/${TAG}.workload_rc
STDOUT=$DIR/${TAG}.out
STDERR=$DIR/${TAG}.err
HARNESS=$DIR/${TAG}_HARNESS_cpuset.txt
BINCS=$DIR/${TAG}_BIN_cpuset.txt
FAIL=$DIR/${TAG}.supervisor_failure

count_cpu_list() {
    _list=$1
    _n=0
    [ -n "$_list" ] || { echo 0; return; }
    _IFS=$IFS; IFS=','; set -- $_list; IFS=$_IFS
    for _part in "$@"; do
        case "$_part" in
            *-*) _a=${_part%-*}; _b=${_part#*-}
                if [ -n "$_a" ] && [ -n "$_b" ]; then _n=$((_n + _b - _a + 1)); fi ;;
            *) if [ -n "$_part" ]; then _n=$((_n + 1)); fi ;;
        esac
    done
    echo $_n
}

cpuset_bad() {
    np=$1; mask_list=$2; cpuset_path=$3; cg=$4
    bits=$(count_cpu_list "$mask_list")
    bad=0
    if [ -z "$np" ] || [ "$np" -lt 6 ] 2>/dev/null; then bad=1; fi
    case "${cpuset_path} ${cg}" in
        *background*|*system-background*|*moderate*) bad=1 ;;
    esac
    if [ "$bits" -lt 6 ] 2>/dev/null; then bad=1; fi
    echo $bad
}

read_self() {
    NP=$(nproc 2>/dev/null || echo 0)
    MASK=$(awk -F: '/^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); print $2; exit}' /proc/self/status 2>/dev/null || true)
    CS=$(tr -d '\n' < /proc/self/cpuset 2>/dev/null || true)
    CG=$(awk -F: '/cpuset/{print $3; exit}' /proc/self/cgroup 2>/dev/null || true)
}

mkdir -p "$DIR" || exit 73
: > "$GLOG" || exit 73

read_self
{
    echo "GATE_HARNESS nproc=$NP bits=$(count_cpu_list "$MASK") cpuset=${CS:-?} cgroup=${CG:-?} mask=$MASK"
    echo -n "cpuset="; printf '%s\n' "$CS"
    grep -E '^Cpus_allowed' /proc/self/status 2>/dev/null || true
} > "$HARNESS"
if [ "$(cpuset_bad "$NP" "$MASK" "$CS" "$CG")" -ne 0 ]; then
    echo "FAIL_CPUSET HARNESS restricted_cpuset(nproc=$NP;mask=$MASK;cpuset=$CS;cgroup=$CG)" > "$FAIL"
    echo 93 > "$WRC"
    exit 93
fi

if [ ! -x "$GUARD" ]; then echo "missing guard" > "$FAIL"; echo 90 > "$WRC"; exit 90; fi
if [ ! -f "$CMDFILE" ]; then echo "missing cmdfile" > "$FAIL"; echo 90 > "$WRC"; exit 90; fi

rm -f "$READY" "$TRACKING" "$PIDFILE" "$GRC" "$WRC" "$FAIL"

nohup setsid sh -c "$GUARD \"$PIDFILE\" \"$WARN\" \"$KILL\" \"$GLOG\" \"$INTERVAL\" 0 \"$READY\" \"$TRACKING\" 4; echo \$? > \"$GRC\"" </dev/null >/dev/null 2>&1 &
GUARD_PID=$!
echo "GUARD_PID=$GUARD_PID" > "$DIR/${TAG}.guard.pid"

(
    while [ ! -f "$READY" ] || [ ! -f "$TRACKING" ]; do
        if [ ! -d "/proc/$GUARD_PID" ]; then
            echo GUARD_DIED_BEFORE_TRACKING > "$FAIL"
            exit 75
        fi
        sleep 1
    done
    exec sh "$CMDFILE" > "$STDOUT" 2> "$STDERR"
) &
CHILD=$!
{
    echo "BINARY_PID=$CHILD"
    echo "GUARD_PID=$GUARD_PID"
} > "$PIDFILE"

i=0
while [ "$i" -lt 30 ] && [ ! -f "$TRACKING" ]; do
    i=$((i + 1))
    sleep 1
done
sleep 1
j=0
while [ "$j" -lt 15 ] && [ -d "/proc/$CHILD" ]; do
    {
        echo "binary_pid=$CHILD"
        echo -n "comm="; tr -d '\n' < /proc/$CHILD/comm 2>/dev/null; echo
        echo -n "cpuset="; tr -d '\n' < /proc/$CHILD/cpuset 2>/dev/null; echo
        echo -n "cgroup="; awk -F: '/cpuset/{print $3; exit}' /proc/$CHILD/cgroup 2>/dev/null
        grep -E '^Cpus_allowed' /proc/$CHILD/status 2>/dev/null || true
    } > "$BINCS"
    COMM=$(tr -d '\n' < /proc/$CHILD/comm 2>/dev/null || true)
    case "$COMM" in
        llama-bench|test-backend-ops) break ;;
    esac
    j=$((j + 1))
    sleep 1
done
if [ -d "/proc/$CHILD" ]; then
    BLIST=$(awk -F: '/^Cpus_allowed_list:/{gsub(/^[ \t]+/,"",$2); gsub(/[ \t]+$/,"",$2); print $2; exit}' /proc/$CHILD/status 2>/dev/null || true)
    BCS=$(tr -d '\n' < /proc/$CHILD/cpuset 2>/dev/null || true)
    BCG=$(awk -F: '/cpuset/{print $3; exit}' /proc/$CHILD/cgroup 2>/dev/null || true)
    BBITS=$(count_cpu_list "$BLIST")
    echo "binary_gate nproc_bits=$BBITS list=$BLIST cpuset=$BCS cgroup=$BCG comm=${COMM:-}" >> "$BINCS"
    if [ "$(cpuset_bad "$BBITS" "$BLIST" "$BCS" "$BCG")" -ne 0 ]; then
        echo "FAIL_CPUSET BINARY restricted_cpuset(bits=$BBITS;list=$BLIST;cpuset=$BCS;cgroup=$BCG)" > "$DIR/${TAG}_BIN_why.txt"
        kill -9 "$CHILD" 2>/dev/null
        echo 93 > "$WRC"
        wait "$CHILD" 2>/dev/null
        exit 93
    fi
fi

wait "$CHILD"
RC=$?
echo $RC > "$WRC"
exit $RC
