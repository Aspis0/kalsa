#!/system/bin/sh
# q44 ngl-sweep device driver. POSIX /system/bin/sh (mksh). LF-only.
# Survives adb disconnect: launched via nohup from launch.sh.

BASE=/data/local/tmp/kalsa_q44
BINDIR=/data/local/tmp/s3oracle
BIN="$BINDIR/llama-bench"
MODEL=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
PIN_STUB=b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c
PIN_IMPL=8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807
PIN_OCL=f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d
PIN_MODEL=b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4

mkdir -p "$BASE/points"
echo $$ > "$BASE/driver.pid"

log() {
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
    echo "$line" >> "$BASE/driver.log"
    echo "$line"
}

status() {
    echo "$*" > "$BASE/STATUS"
    log "STATUS $*"
}

heartbeat() {
    date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/HEARTBEAT"
}

trim() {
    echo "$1" | awk '{print $1}'
}

batt_level() {
    dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}'
}

batt_temp10() {
    dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}'
}

as_int() {
    v="$1"
    def="$2"
    case "$v" in
        ''|*[!0-9]*) echo "$def" ;;
        *) echo "$v" ;;
    esac
}

wait_cool() {
    tag="$1"
    while true; do
        heartbeat
        level=$(as_int "$(batt_level)" 0)
        temp10=$(as_int "$(batt_temp10)" 9999)
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag level=$level temp10=$temp10" >> "$BASE/battery_gate.log"
        log "gate tag=$tag level=$level temp10=$temp10"
        if [ "$level" -lt 30 ]; then
            status "STOP batt_level=$level"
            exit 20
        fi
        if [ "$temp10" -gt 420 ]; then
            status "STOP batt_temp10=$temp10 gt 420"
            exit 21
        fi
        if [ "$temp10" -le 350 ]; then
            log "cool-start PASS tag=$tag temp10=$temp10"
            return 0
        fi
        log "cool-start WAIT tag=$tag temp10=$temp10 > 350"
        sleep 15
    done
}

start_sampler() {
    tag="$1"
    pt="$BASE/points/$tag"
    samp="$pt/sampler.csv"
    pidf="$pt/bench.pid"
    alive="$pt/sampler.alive"
    touch "$alive"
    echo "epoch,MemAvailable_kB,MemFree_kB,SwapFree_kB,pid,VmRSS_kB,RssAnon_kB,RssFile_kB,VmSwap_kB,gpumem,cpuset,Cpus_allowed_list" > "$samp"
    (
        while [ -f "$alive" ]; do
            heartbeat
            epoch=$(date +%s)
            ma=NA
            mf=NA
            sf=NA
            while IFS= read -r line || [ -n "$line" ]; do
                case "$line" in
                    MemAvailable:*)
                        ma=$(trim "${line#*:}")
                        ma=$(trim "${ma%%kB*}")
                        ;;
                    MemFree:*)
                        mf=$(trim "${line#*:}")
                        mf=$(trim "${mf%%kB*}")
                        ;;
                    SwapFree:*)
                        sf=$(trim "${line#*:}")
                        sf=$(trim "${sf%%kB*}")
                        ;;
                esac
            done < /proc/meminfo
            pid=$(cat "$pidf" 2>/dev/null)
            vr=NA
            ra=NA
            rf=NA
            vs=NA
            gpu=NA
            cs=NA
            cl=NA
            if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
                while IFS= read -r line || [ -n "$line" ]; do
                    case "$line" in
                        VmRSS:*)
                            vr=$(trim "${line#*:}")
                            vr=$(trim "${vr%%kB*}")
                            ;;
                        RssAnon:*)
                            ra=$(trim "${line#*:}")
                            ra=$(trim "${ra%%kB*}")
                            ;;
                        RssFile:*)
                            rf=$(trim "${line#*:}")
                            rf=$(trim "${rf%%kB*}")
                            ;;
                        VmSwap:*)
                            vs=$(trim "${line#*:}")
                            vs=$(trim "${vs%%kB*}")
                            ;;
                        Cpus_allowed_list:*)
                            cl=$(trim "${line#*:}")
                            ;;
                    esac
                done < "/proc/$pid/status"
                if [ -r "/proc/$pid/cpuset" ]; then
                    cs=$(tr '\n' ' ' < "/proc/$pid/cpuset")
                    cs=$(trim "$cs")
                fi
                if [ ! -f "$pt/kgsl_proc_ls.txt" ]; then
                    ls -la "/sys/class/kgsl/kgsl-3d0/proc/$pid/" > "$pt/kgsl_proc_ls.txt" 2>&1
                fi
                if [ -r "/sys/class/kgsl/kgsl-3d0/proc/$pid/gpumem_mapped" ]; then
                    gpu=$(cat "/sys/class/kgsl/kgsl-3d0/proc/$pid/gpumem_mapped")
                elif [ -r "/sys/class/kgsl/kgsl-3d0/proc/$pid/gpumem" ]; then
                    gpu=$(cat "/sys/class/kgsl/kgsl-3d0/proc/$pid/gpumem")
                else
                    for gpath in /sys/class/kgsl/kgsl-3d0/proc/$pid/*; do
                        b=$(basename "$gpath")
                        case "$b" in
                            *mem*|*gpu*)
                                if [ -r "$gpath" ] && [ ! -d "$gpath" ]; then
                                    gpu="${b}=$(cat "$gpath" 2>/dev/null)"
                                    break
                                fi
                                ;;
                        esac
                    done
                fi
            fi
            echo "$epoch,$ma,$mf,$sf,${pid:-NA},$vr,$ra,$rf,$vs,$gpu,$cs,$cl" >> "$samp"
            sleep 1
        done
    ) &
    echo $! > "$pt/sampler.pid"
    log "sampler started tag=$tag spid=$(cat "$pt/sampler.pid")"
}

stop_sampler() {
    tag="$1"
    pt="$BASE/points/$tag"
    rm -f "$pt/sampler.alive"
    sp=$(cat "$pt/sampler.pid" 2>/dev/null)
    if [ -n "$sp" ]; then
        wait "$sp" 2>/dev/null
        if [ -d "/proc/$sp" ]; then
            sleep 1
        fi
        if [ -d "/proc/$sp" ]; then
            kill "$sp" 2>/dev/null
            sleep 1
        fi
    fi
    log "sampler stopped tag=$tag"
}

capture_cpuset() {
    pid="$1"
    pt="$2"
    g=0
    while [ "$g" -lt 45 ]; do
        if [ -r "/proc/$pid/cpuset" ]; then
            cat "/proc/$pid/cpuset" > "$pt/cpuset.txt"
            grep "^Cpus_allowed" "/proc/$pid/status" > "$pt/cpus_allowed.txt" 2>/dev/null
            cat "/proc/$pid/status" > "$pt/status_live.txt"
            tr '\0' ' ' < "/proc/$pid/cmdline" > "$pt/cmdline.txt" 2>/dev/null
            echo "$pid" > "$pt/captured_pid.txt"
            ls -la "/sys/class/kgsl/kgsl-3d0/proc/$pid/" > "$pt/kgsl_proc_ls.txt" 2>&1
            nproc > "$pt/nproc.txt" 2>/dev/null
            log "cpuset captured pid=$pid cpuset=$(tr '\n' ' ' < "$pt/cpuset.txt")"
            return 0
        fi
        sleep 1
        g=$((g + 1))
    done
    log "WARN cpuset NOT captured pid=$pid"
    return 1
}

run_point() {
    ngl="$1"
    tag="ngl${ngl}"
    pt="$BASE/points/$tag"
    mkdir -p "$pt"
    status "RUNNING ngl=$ngl"
    wait_cool "$tag"

    dumpsys battery > "$pt/battery_pre.txt"
    cat /proc/meminfo > "$pt/meminfo_pre.txt"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$pt/t_start.txt"
    nproc > "$pt/nproc.txt" 2>/dev/null
    : > "$pt/bench.pid"

    echo "BIN=$BIN" > "$pt/cmd.txt"
    echo "LD_LIBRARY_PATH=$BINDIR" >> "$pt/cmd.txt"
    echo "GGML_OPENCL_LOG_ALLOC=1" >> "$pt/cmd.txt"
    echo "llama-bench -m $MODEL -ngl $ngl -nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl" >> "$pt/cmd.txt"
    echo "stub_sha=$PIN_STUB" >> "$pt/cmd.txt"
    echo "impl_sha=$PIN_IMPL" >> "$pt/cmd.txt"
    echo "ocl_sha=$PIN_OCL" >> "$pt/cmd.txt"
    echo "model_sha=$PIN_MODEL" >> "$pt/cmd.txt"
    echo "threads=4" >> "$pt/cmd.txt"

    start_sampler "$tag"
    sleep 1

    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR"
    export GGML_OPENCL_LOG_ALLOC=1
    unset GGML_OPENCL_HOST_REPACK
    unset GGML_OPENCL_DUMP_Q
    unset GGML_OPENCL_ORACLE
    unset GGML_OPENCL_MOE_OPTS
    unset GGML_OPENCL_CVT_OPTS
    unset GGML_OPENCL_CVT_VARIANT

    log "launch llama-bench ngl=$ngl"
    ./llama-bench -m "$MODEL" -ngl "$ngl" -nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl > "$pt/stdout.jsonl" 2> "$pt/stderr.txt" &
    BPID=$!
    echo "$BPID" > "$pt/bench.pid"
    log "bench pid=$BPID ngl=$ngl"

    capture_cpuset "$BPID" "$pt"

    wait "$BPID"
    rc=$?
    echo "$rc" > "$pt/rc.txt"
    log "bench rc=$rc ngl=$ngl"

    sleep 2
    stop_sampler "$tag"

    cat /proc/meminfo > "$pt/meminfo_post.txt"
    dumpsys battery > "$pt/battery_post.txt"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$pt/t_end.txt"

    if [ ! -s "$pt/cpuset.txt" ]; then
        echo "INVALID_NO_CPUSET" > "$pt/INVALID.txt"
        log "WARN ngl=$ngl INVALID_NO_CPUSET"
    fi

    echo "$tag rc=$rc" >> "$BASE/progress.txt"
}

parse_N_from_err() {
    errf="$1"
    if [ ! -s "$errf" ]; then
        echo ""
        return 1
    fi
    line=$(grep "offloaded" "$errf" | grep "layers" | tail -1)
    if [ -z "$line" ]; then
        echo ""
        return 1
    fi
    echo "$line" > "$BASE/offload_line_raw.txt"
    frac=$(echo "$line" | awk '{for(i=1;i<=NF;i++) if($i=="offloaded"){print $(i+1); exit}}')
    den=$(echo "$frac" | awk -F/ '{print $2}')
    echo "$den"
}

probe_N() {
    pt="$BASE/points/probe_ngl1"
    mkdir -p "$pt"
    log "N missing from ngl0; load-only probe at ngl 1"
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR"
    export GGML_OPENCL_LOG_ALLOC=1
    ./llama-bench -m "$MODEL" -ngl 1 -nr -fa off -t 4 -p 1 -n 0 -r 1 --no-warmup -o jsonl > "$pt/stdout.jsonl" 2> "$pt/stderr.txt"
    echo $? > "$pt/rc.txt"
    parse_N_from_err "$pt/stderr.txt"
}

cooldown_180() {
    log "cooldown 180s start"
    s=0
    while [ "$s" -lt 180 ]; do
        heartbeat
        sleep 15
        s=$((s + 15))
        log "cooldown elapsed=${s}s"
    done
    log "cooldown 180s done"
}

# ---------- start ----------
status "STARTING"
heartbeat
log "driver start pid=$$"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_start.txt"
uname -a > "$BASE/uname.txt" 2>/dev/null
getprop ro.build.fingerprint > "$BASE/fingerprint.txt" 2>/dev/null
nproc > "$BASE/nproc.txt" 2>/dev/null
df -h /data > "$BASE/df.txt" 2>/dev/null
dumpsys battery > "$BASE/battery_session_start.txt"
cat /proc/meminfo > "$BASE/meminfo_session_start.txt"
printenv | grep GGML > "$BASE/env_ggml_raw.txt" 2>/dev/null || echo "NO_GGML_ENV_VARS" > "$BASE/env_ggml_raw.txt"

cd "$BINDIR" || {
    status "STOP no_bindir"
    exit 90
}
sha256sum llama-bench libllama-bench-impl.so libggml-opencl.so libllama.so libggml.so libggml-base.so libggml-cpu.so libllama-common.so > "$BASE/binary_sha.txt"
got_stub=$(awk '/llama-bench$/{print $1; exit}' "$BASE/binary_sha.txt")
got_impl=$(awk '/libllama-bench-impl.so$/{print $1; exit}' "$BASE/binary_sha.txt")
got_ocl=$(awk '/libggml-opencl.so$/{print $1; exit}' "$BASE/binary_sha.txt")
log "sha stub=$got_stub impl=$got_impl ocl=$got_ocl"
if [ "$got_stub" != "$PIN_STUB" ] || [ "$got_impl" != "$PIN_IMPL" ] || [ "$got_ocl" != "$PIN_OCL" ]; then
    status "STOP binary_sha_mismatch"
    exit 10
fi

echo "model_sha_preverified=$PIN_MODEL" > "$BASE/PINS.txt"
echo "stub=$PIN_STUB" >> "$BASE/PINS.txt"
echo "impl=$PIN_IMPL" >> "$BASE/PINS.txt"
echo "ocl=$PIN_OCL" >> "$BASE/PINS.txt"
echo "bindir=$BINDIR" >> "$BASE/PINS.txt"
echo "bin=$BIN" >> "$BASE/PINS.txt"
echo "model=$MODEL" >> "$BASE/PINS.txt"
echo "threads=4" >> "$BASE/PINS.txt"
echo "flags=-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl" >> "$BASE/PINS.txt"
echo "GGML_OPENCL_LOG_ALLOC=1" >> "$BASE/PINS.txt"
ls -l "$MODEL" > "$BASE/model_ls.txt"
stat -c %s "$MODEL" > "$BASE/model_bytes.txt" 2>/dev/null

consec_fail=0

# Point 1: ngl 0 (smoke)
run_point 0
rc0=$(cat "$BASE/points/ngl0/rc.txt" 2>/dev/null)
rc0=$(as_int "$rc0" 99)
nsamp=$(wc -l < "$BASE/points/ngl0/sampler.csv" 2>/dev/null)
nsamp=$(as_int "$(trim "$nsamp")" 0)
if [ "$nsamp" -gt 0 ]; then
    nsamp=$((nsamp - 1))
fi
log "smoke ngl0 rc=$rc0 samples=$nsamp"
echo "rc=$rc0 samples=$nsamp" > "$BASE/SMOKE.txt"
if [ "$rc0" -ne 0 ] || [ "$nsamp" -lt 30 ]; then
    status "STOP SMOKE_FAIL rc=$rc0 samples=$nsamp"
    exit 23
fi
status "SMOKE_OK samples=$nsamp"
if [ "$rc0" -ne 0 ]; then
    consec_fail=$((consec_fail + 1))
else
    consec_fail=0
fi

N=$(parse_N_from_err "$BASE/points/ngl0/stderr.txt")
N=$(trim "$N")
if [ -z "$N" ]; then
    N=$(probe_N)
    N=$(trim "$N")
fi
N=$(as_int "$N" 0)
if [ "$N" -le 0 ]; then
    status "STOP cannot_parse_N"
    exit 24
fi
n_q1=$(( (N + 3) / 4 ))
n_q2=$(( (N + 1) / 2 ))
n_q3=$(( (3 * N + 3) / 4 ))
{
    echo "N=$N"
    echo "ngl_points=0 $n_q1 $n_q2 $n_q3 99"
    echo "ceil_N_4=$n_q1"
    echo "ceil_N_2=$n_q2"
    echo "ceil_3N_4=$n_q3"
    echo "source=load_tensors offloaded X/N (ngl0 stderr, else ngl1 probe)"
} > "$BASE/N_MAP.txt"
log "N_MAP N=$N points=0,$n_q1,$n_q2,$n_q3,99"
status "SMOKE_OK N=$N points=0,$n_q1,$n_q2,$n_q3,99"

done_list=" 0 "
for ngl in $n_q1 $n_q2 $n_q3 99; do
    case "$done_list" in
        *" $ngl "*)
            log "skip duplicate ngl=$ngl"
            continue
            ;;
    esac
    cooldown_180
    run_point "$ngl"
    rc=$(cat "$BASE/points/ngl${ngl}/rc.txt" 2>/dev/null)
    rc=$(as_int "$rc" 99)
    if [ "$rc" -ne 0 ]; then
        consec_fail=$((consec_fail + 1))
        log "rc!=0 ngl=$ngl consec_fail=$consec_fail"
        if [ "$consec_fail" -ge 2 ]; then
            status "STOP two_consecutive_rc_nonzero last=$ngl"
            exit 22
        fi
    else
        consec_fail=0
    fi
    done_list="$done_list $ngl "
done

dumpsys battery > "$BASE/battery_session_end.txt"
cat /proc/meminfo > "$BASE/meminfo_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE"
log "driver DONE"
exit 0
