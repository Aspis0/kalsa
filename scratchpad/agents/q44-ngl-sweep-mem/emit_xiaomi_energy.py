"""Per-rep charge-bracketed CPU (c) x2 and optional extra HTP (b) x1."""
from pathlib import Path

HERE = Path(__file__).resolve().parent

DRIVER = r'''#!/system/bin/sh
# Per-rep energy probes. dumpsys Charge counter (sysfs EACCES).
BASE=/data/local/tmp/kalsa_bprime_x
BINDIR=/data/local/tmp/kalsahtp
MODEL=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf
EDIR="$BASE/energy"
mkdir -p "$EDIR"
echo $$ > "$EDIR/driver.pid"

log() {
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
    echo "$line" >> "$EDIR/driver.log"
    echo "$line"
}

status() {
    echo "$*" > "$EDIR/STATUS"
    log "STATUS $*"
}

as_int() {
    v="$1"
    def="$2"
    case "$v" in
        ''|*[!0-9]*) echo "$def" ;;
        *) echo "$v" ;;
    esac
}

batt_temp10() {
    dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}'
}

batt_level() {
    dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}'
}

probe_charge() {
    dest="$1"
    note="$2"
    {
        echo "note=$note"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "sysfs_charge_counter=EACCES"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|^  Charge counter:|^  voltage:"
    } > "$dest"
}

wait_cool() {
    tag="$1"
    while true; do
        level=$(as_int "$(batt_level)" 0)
        temp10=$(as_int "$(batt_temp10)" 9999)
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag level=$level temp10=$temp10" >> "$EDIR/battery_gate.log"
        log "gate tag=$tag level=$level temp10=$temp10"
        if [ "$temp10" -le 350 ]; then
            log "cool-start PASS tag=$tag temp10=$temp10"
            return 0
        fi
        log "cool-start WAIT tag=$tag temp10=$temp10; sleep 60"
        sleep 60
    done
}

setup_env() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_HOSTBUF=1
    unset GGML_HEXAGON_VERBOSE
    unset GGML_OPENCL_LOG_ALLOC
}

run_cpu_rep() {
    i="$1"
    wait_cool "c_rep$i"
    probe_charge "$EDIR/c_rep${i}_charge_pre.txt" "CPU (c) process-rep $i PRE -ngl 0 -r 1"
    dumpsys battery > "$EDIR/c_rep${i}_battery_pre.txt"
    setup_env
    log "launch CPU rep $i -ngl 0 -p 512 -n 128 -r 1"
    ./llama-bench -m "$MODEL" -ngl 0 -p 512 -n 128 -r 1 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$EDIR/c_rep${i}_stdout.jsonl" 2> "$EDIR/c_rep${i}_stderr.txt"
    echo $? > "$EDIR/c_rep${i}_rc.txt"
    probe_charge "$EDIR/c_rep${i}_charge_post.txt" "CPU (c) process-rep $i POST"
    dumpsys battery > "$EDIR/c_rep${i}_battery_post.txt"
    log "CPU rep $i rc=$(cat "$EDIR/c_rep${i}_rc.txt")"
}

status "STARTING"
wait_cool "energy_start"

# two CPU process-level reps (each = warmup+1 pp512 + warmup+1 tg128 unless we --no-warmup;
# match original (c) defaults: warmup on, -r 1)
run_cpu_rep 1
run_cpu_rep 2

level=$(as_int "$(batt_level)" 0)
temp10=$(as_int "$(batt_temp10)" 9999)
log "after CPU reps level=$level temp10=$temp10"
if [ "$level" -ge 90 ]; then
    wait_cool "b_extra"
    level=$(as_int "$(batt_level)" 0)
    if [ "$level" -ge 90 ]; then
        probe_charge "$EDIR/b_extra_charge_pre.txt" "HTP (b) extra process-rep PRE -ngl 99 -dev HTP0 --no-host 1 -r 1"
        dumpsys battery > "$EDIR/b_extra_battery_pre.txt"
        setup_env
        log "launch extra HTP (b) -ngl 99 -dev HTP0 --no-host 1 -p 512 -n 128 -r 1"
        ./llama-bench -m "$MODEL" -ngl 99 -dev HTP0 --no-host 1 -p 512 -n 128 -r 1 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$EDIR/b_extra_stdout.jsonl" 2> "$EDIR/b_extra_stderr.txt"
        echo $? > "$EDIR/b_extra_rc.txt"
        probe_charge "$EDIR/b_extra_charge_post.txt" "HTP (b) extra process-rep POST"
        dumpsys battery > "$EDIR/b_extra_battery_post.txt"
        log "extra HTP rc=$(cat "$EDIR/b_extra_rc.txt")"
    else
        log "skip extra (b): level dropped to $level"
    fi
else
    log "skip extra (b): level=$level < 90"
fi

dumpsys battery > "$EDIR/battery_end.txt"
status "DONE"
log "energy probes DONE"
exit 0
'''

LAUNCH = r'''#!/system/bin/sh
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/energy_driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/energy/driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/energy/setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/energy/setsid.pid
'''

def emit(name: str, text: str) -> None:
    data = text.replace("\r\n", "\n").replace("\r", "\n")
    if not data.endswith("\n"):
        data += "\n"
    raw = data.encode("utf-8")
    if b"\r" in raw:
        raise SystemExit(f"CR survived in {name}")
    (HERE / name).write_bytes(raw)
    print("wrote", name, len(raw))

emit("xiaomi_energy_driver.sh", DRIVER)
emit("xiaomi_energy_launch.sh", LAUNCH)
