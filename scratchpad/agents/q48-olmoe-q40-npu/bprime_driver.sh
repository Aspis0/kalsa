#!/system/bin/sh
# q48 (b') - OLMoE Q4_0 experts-on-NPU PREFILL-ONLY. REGISTRA+DICHIARA.
# -p 512 -n 0 (skip tg). Two HTP -r 1 reps + two CPU -r 1 reps, charge-bracketed.

BASE=/data/local/tmp/kalsa_q48/bprime
BINDIR=/data/local/tmp/kalsahtp
BIN="$BINDIR/llama-bench"
MODEL=/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf
PIN_MODEL=43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500
PIN_STUB=5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507
PIN_HEX=f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448
PIN_HTP=c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5

mkdir -p "$BASE"
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

as_int() {
    v="$1"
    def="$2"
    case "$v" in
        ''|*[!0-9]*) echo "$def" ;;
        *) echo "$v" ;;
    esac
}

batt_level() {
    dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}'
}

batt_temp10() {
    dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}'
}

wait_cool() {
    tag="$1"
    while true; do
        heartbeat
        level=$(as_int "$(batt_level)" 0)
        temp10=$(as_int "$(batt_temp10)" 9999)
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag level=$level temp10=$temp10" >> "$BASE/battery_gate.log"
        log "gate tag=$tag level=$level temp10=$temp10"
        if [ "$level" -lt 40 ]; then
            status "SKIP batt_level=$level lt 40"
            exit 20
        fi
        if [ "$temp10" -gt 420 ]; then
            status "STOP batt_temp10=$temp10"
            exit 21
        fi
        if [ "$temp10" -le 350 ]; then
            log "cool-start PASS tag=$tag temp10=$temp10"
            return 0
        fi
        log "cool-start WAIT tag=$tag temp10=$temp10"
        sleep 15
    done
}

dump_header() {
    dest="$1"
    {
        echo "phase=q48 bprime OLMoE Q4_0 experts-on-NPU PREFILL-ONLY v73 REGISTRA+DICHIARA"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "unplugged_declared=yes"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|Charge counter:"
        echo "HOSTBUF_note=llama-bench path UNSETS GGML_HEXAGON_HOSTBUF"
        echo "binary=$BIN stub=$PIN_STUB hexagon=$PIN_HEX htp_v73=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
        echo "n_gen_mode=$N_GEN_MODE"
    } > "$dest"
}

dump_charge() {
    dest="$1"
    tag="$2"
    {
        echo "tag=$tag"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'sysfs_charge_counter='
        cat /sys/class/power_supply/battery/charge_counter 2>&1 || true
        printf '\n'
        printf 'sysfs_temp='
        cat /sys/class/power_supply/battery/temp 2>&1 || true
        printf '\n'
        dumpsys battery
    } > "$dest"
}

setup_env_htp() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_VERBOSE=1
    unset GGML_HEXAGON_HOSTBUF
    unset GGML_OPENCL_LOG_ALLOC
}

setup_env_cpu() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    unset ADSP_LIBRARY_PATH
    unset CDSP_LIBRARY_PATH
    unset GGML_HEXAGON_NDEV
    unset GGML_HEXAGON_VERBOSE
    unset GGML_HEXAGON_HOSTBUF
    unset GGML_OPENCL_LOG_ALLOC
}

# stdout unbuffered-ish: llama-bench jsonl + duplicate on stderr via -oe jsonl
run_pp() {
    tag="$1"
    ngl="$2"
    devargs="$3"
    ngen="$4"
    log "launch $tag pp512 n=$ngen ngl=$ngl"
    # shellcheck disable=SC2086
    ./llama-bench -m "$MODEL" -p 512 -n "$ngen" -r 1 --no-warmup -ngl "$ngl" $devargs -o jsonl -oe jsonl --progress --load-mode none -fa on --ubatch-size 1024 > "$BASE/${tag}_stdout.jsonl" 2> "$BASE/${tag}_stderr.txt"
    echo $? > "$BASE/${tag}_rc.txt"
    log "$tag rc=$(cat "$BASE/${tag}_rc.txt")"
    # copy any jsonl lines from stderr in case stdout was buffered and lost
    grep '{"build_commit"' "$BASE/${tag}_stderr.txt" >> "$BASE/${tag}_stdout_from_stderr.jsonl" 2>/dev/null || true
}

status "STARTING"
heartbeat
N_GEN_MODE=0
dump_header "$BASE/header_session.txt"
dumpsys battery > "$BASE/battery_session_start.txt"
df -h /data > "$BASE/df.txt"

got_stub=$(sha256sum "$BIN" | awk '{print $1}')
got_hex=$(sha256sum "$BINDIR/libggml-hexagon.so" | awk '{print $1}')
got_htp=$(sha256sum "$BINDIR/libggml-htp-v73.so" | awk '{print $1}')
echo "stub=$got_stub" > "$BASE/binary_sha.txt"
echo "hexagon=$got_hex" >> "$BASE/binary_sha.txt"
echo "htp_v73=$got_htp" >> "$BASE/binary_sha.txt"
if [ "$got_stub" != "$PIN_STUB" ] || [ "$got_hex" != "$PIN_HEX" ] || [ "$got_htp" != "$PIN_HTP" ]; then
    status "STOP binary_sha_mismatch"
    exit 10
fi
got_model=$(sha256sum "$MODEL" | awk '{print $1}')
echo "$got_model  $MODEL" > "$BASE/model_sha.txt"
if [ "$got_model" != "$PIN_MODEL" ]; then
    status "STOP model_sha_mismatch got=$got_model"
    exit 11
fi

# Probe whether -n 0 is accepted: tiny help-less dry via a one-shot that we will also use as HTP r1 if it works.
# First attempt HTP r1 with -n 0.
wait_cool "htp_r1"
dump_header "$BASE/header_htp_r1.txt"
dump_charge "$BASE/charge_htp_r1_pre.txt" "htp_r1_pre"
setup_env_htp
run_pp "htp_r1" 99 "-dev HTP0" 0
dump_charge "$BASE/charge_htp_r1_post.txt" "htp_r1_post"

rc1=$(as_int "$(cat "$BASE/htp_r1_rc.txt")" 99)
njson=$(grep -c '"n_prompt"' "$BASE/htp_r1_stdout.jsonl" 2>/dev/null)
njson=$(as_int "$(trim "$njson")" 0)
njson_err=$(grep -c '"n_prompt"' "$BASE/htp_r1_stdout_from_stderr.jsonl" 2>/dev/null)
njson_err=$(as_int "$(trim "$njson_err")" 0)
log "htp_r1 njson_stdout=$njson njson_stderr=$njson_err rc=$rc1"

N_GEN=0
if [ "$njson" -lt 1 ] && [ "$njson_err" -lt 1 ]; then
    log "FALLBACK -n 0 produced no jsonl; retrying HTP r1 with -n 1"
    N_GEN=1
    N_GEN_MODE=1
    wait_cool "htp_r1_n1"
    dump_header "$BASE/header_htp_r1.txt"
    dump_charge "$BASE/charge_htp_r1_pre.txt" "htp_r1_pre_n1"
    setup_env_htp
    run_pp "htp_r1" 99 "-dev HTP0" 1
    dump_charge "$BASE/charge_htp_r1_post.txt" "htp_r1_post_n1"
fi
echo "n_gen=$N_GEN" > "$BASE/n_gen.txt"

# HTP r2
wait_cool "htp_r2"
dump_header "$BASE/header_htp_r2.txt"
dump_charge "$BASE/charge_htp_r2_pre.txt" "htp_r2_pre"
setup_env_htp
run_pp "htp_r2" 99 "-dev HTP0" "$N_GEN"
dump_charge "$BASE/charge_htp_r2_post.txt" "htp_r2_post"

# CPU r1
wait_cool "cpu_r1"
dump_header "$BASE/header_cpu_r1.txt"
dump_charge "$BASE/charge_cpu_r1_pre.txt" "cpu_r1_pre"
setup_env_cpu
run_pp "cpu_r1" 0 "" "$N_GEN"
dump_charge "$BASE/charge_cpu_r1_post.txt" "cpu_r1_post"

# CPU r2
wait_cool "cpu_r2"
dump_header "$BASE/header_cpu_r2.txt"
dump_charge "$BASE/charge_cpu_r2_pre.txt" "cpu_r2_pre"
setup_env_cpu
run_pp "cpu_r2" 0 "" "$N_GEN"
dump_charge "$BASE/charge_cpu_r2_post.txt" "cpu_r2_post"

dumpsys battery > "$BASE/battery_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE n_gen=$N_GEN htp_r1=$(cat "$BASE/htp_r1_rc.txt") htp_r2=$(cat "$BASE/htp_r2_rc.txt") cpu_r1=$(cat "$BASE/cpu_r1_rc.txt") cpu_r2=$(cat "$BASE/cpu_r2_rc.txt")"
log "q48 bprime DONE"
exit 0
