#!/system/bin/sh
# q51 F2b - v73 host guard: GGML_HEXAGON_NO_BINARY=1. REGISTRA+DICHIARA.

BASE=/data/local/tmp/kalsa_q51_f2b
BINDIR=/data/local/tmp/kalsahtp_f2b
MODEL=/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf
PIN_MODEL=43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500
PIN_STUB=f01a4d425a0dbacba9e5da17e88d33b032ccf85345f89725ec2b46441f241a33
PIN_HEX=57c7ca6f4c86b0153439cf9b8c44e6bec00aee25f465b3be86612d582d220dfc
PIN_HTP=c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5

mkdir -p "$BASE"
echo $$ > "$BASE/driver.pid"

log() {
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
    echo "$line" >> "$BASE/driver.log"
    echo "$line"
}
status() { echo "$*" > "$BASE/STATUS"; log "STATUS $*"; }
heartbeat() { date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/HEARTBEAT"; }
trim() { echo "$1" | awk '{print $1}'; }
as_int() {
    v="$1"; def="$2"
    case "$v" in ''|*[!0-9]*) echo "$def" ;; *) echo "$v" ;; esac
}
batt_level() { dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}'; }
batt_temp10() { dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}'; }

wait_cool() {
    tag="$1"
    while true; do
        heartbeat
        level=$(as_int "$(batt_level)" 0)
        temp10=$(as_int "$(batt_temp10)" 9999)
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag level=$level temp10=$temp10" >> "$BASE/battery_gate.log"
        log "gate tag=$tag level=$level temp10=$temp10"
        if [ "$level" -lt 40 ]; then status "SKIP batt_level=$level lt 40"; exit 20; fi
        if [ "$temp10" -gt 420 ]; then status "STOP batt_temp10=$temp10"; exit 21; fi
        if [ "$temp10" -le 350 ]; then log "cool-start PASS tag=$tag temp10=$temp10"; return 0; fi
        log "cool-start WAIT tag=$tag temp10=$temp10"; sleep 15
    done
}

dump_header() {
    dest="$1"; note="$2"
    {
        echo "phase=q51 F2b v73 GGML_HEXAGON_NO_BINARY=1 REGISTRA+DICHIARA"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "note=$note"
        echo "unplugged_declared=yes"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|Charge counter:|^  voltage:"
        echo "BINDIR=$BINDIR NO_BINARY=1 NDEV=1 VERBOSE=1 HOSTBUF=1 --no-host 1"
        echo "binary=$BINDIR/llama-bench stub=$PIN_STUB hexagon=$PIN_HEX htp_v73=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
    } > "$dest"
}

setup_env_htp() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_VERBOSE=1
    export GGML_HEXAGON_HOSTBUF=1
    export GGML_HEXAGON_NO_BINARY=1
    unset GGML_OPENCL_LOG_ALLOC
}

setup_env_cpu() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    unset ADSP_LIBRARY_PATH; unset CDSP_LIBRARY_PATH
    unset GGML_HEXAGON_NDEV; unset GGML_HEXAGON_VERBOSE
    unset GGML_HEXAGON_HOSTBUF; unset GGML_HEXAGON_NO_BINARY
    unset GGML_OPENCL_LOG_ALLOC
}

count_lines() { as_int "$(trim "$(wc -l < "$1" 2>/dev/null)")" 0; }
jsonl_n() {
    f="$1"
    if [ ! -s "$f" ]; then echo 0; return; fi
    as_int "$(trim "$(grep -c avg_ts "$f" 2>/dev/null)")" 0
}

extract_jsonl() { grep '^{' "$1" > "$2" 2>/dev/null || true; }

count_errs() {
    errf="$1"; dest="$2"
    {
        echo "file=$errf"
        echo "dspqueue=$(as_int "$(trim "$(grep -c dspqueue "$errf" 2>/dev/null)")" 0)"
        echo "dspqueue_read_failed=$(as_int "$(trim "$(grep -c 'dspqueue_read failed' "$errf" 2>/dev/null)")" 0)"
        echo "INTERNAL_ERROR=$(as_int "$(trim "$(grep -c 'INTERNAL-ERROR' "$errf" 2>/dev/null)")" 0)"
        echo "Aborted=$(as_int "$(trim "$(grep -c Aborted "$errf" 2>/dev/null)")" 0)"
        echo "NO_BINARY_log=$(as_int "$(trim "$(grep -c 'NO_BINARY=1' "$errf" 2>/dev/null)")" 0)"
    } > "$dest"
}

extract_proof() {
    src="$1"; prefix="$2"
    grep "load_tensors: offloaded" "$src" > "$BASE/${prefix}_buffer_split.txt" || true
    grep "model buffer size" "$src" >> "$BASE/${prefix}_buffer_split.txt" || true
    grep "execute-op" "$src" | grep "HTP0" > "$BASE/${prefix}_execute_op_htp0.txt" || true
    grep "HTP0 execute-op MUL_MAT_ID" "$src" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" > "$BASE/${prefix}_execute_op_exps_htp0.txt" || true
    grep "execute-op" "$src" | grep -E "attn_q|attn_k|attn_v|attn_output" > "$BASE/${prefix}_execute_op_attn.txt" || true
    grep "HTP0 execute-op" "$src" | grep -E "execute-op (ADD|SUB|MUL|DIV)\\|" > "$BASE/${prefix}_execute_op_binary_htp0.txt" || true
    grep -F "execute-op MUL_MAT+ADD" "$src" > "$BASE/${prefix}_execute_op_mmadd_htp0.txt" || true
    grep "supports-op" "$src" | grep -E "ADD| MUL\|" | grep '|no' > "$BASE/${prefix}_supports_binary_no.txt" || true
    grep "supports-op MUL_MAT_ID" "$src" | grep '|yes' > "$BASE/${prefix}_supports_mmid_yes.txt" || true
}

status "STARTING"
heartbeat
dump_header "$BASE/header_session.txt" "session"
dumpsys battery > "$BASE/battery_session_start.txt"

got_stub=$(sha256sum "$BINDIR/llama-bench" | awk '{print $1}')
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

wait_cool "a"
dump_header "$BASE/header_a.txt" "a pp16/tg8 -v NO_BINARY=1"
dumpsys battery > "$BASE/battery_a_pre.txt"
setup_env_htp
log "launch (a) pp16/tg8 -v NO_BINARY=1"
./llama-bench -m "$MODEL" -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -v -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/a_stdout.jsonl" 2> "$BASE/a_stderr.txt"
echo $? > "$BASE/a_rc.txt"
dumpsys battery > "$BASE/battery_a_post.txt"
extract_jsonl "$BASE/a_stderr.txt" "$BASE/a_stdout_from_stderr.jsonl"
count_errs "$BASE/a_stderr.txt" "$BASE/a_errcounts.txt"
extract_proof "$BASE/a_stderr.txt" "a"
n_exps=$(count_lines "$BASE/a_execute_op_exps_htp0.txt")
n_bin=$(count_lines "$BASE/a_execute_op_binary_htp0.txt")
n_htp=$(count_lines "$BASE/a_execute_op_htp0.txt")
n_json=$(jsonl_n "$BASE/a_stdout.jsonl")
n_json_e=$(jsonl_n "$BASE/a_stdout_from_stderr.jsonl")
rc_a=$(as_int "$(cat "$BASE/a_rc.txt")" 99)
{
    echo "rc_a=$rc_a n_json=$n_json n_json_err=$n_json_e n_htp=$n_htp n_exps_htp0=$n_exps n_binary_htp0=$n_bin"
    echo "--- buffer ---"
    cat "$BASE/a_buffer_split.txt"
    echo "--- first 5 exps ---"
    head -5 "$BASE/a_execute_op_exps_htp0.txt"
} > "$BASE/a_proof.txt"
log "a proof $(head -1 "$BASE/a_proof.txt")"

a_ok=0
if [ "$rc_a" -eq 0 ]; then
    if [ "$n_json" -ge 1 ] || [ "$n_json_e" -ge 1 ]; then a_ok=1; fi
fi
echo "a_ok=$a_ok n_exps=$n_exps n_binary_htp0=$n_bin" > "$BASE/a_survival.txt"

if [ "$a_ok" -ne 1 ]; then
    dumpsys battery > "$BASE/battery_session_end.txt"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
    status "DONE a_died rc_a=$rc_a n_exps=$n_exps n_binary_htp0=$n_bin"
    log "F2b DONE died"
    exit 0
fi

if [ "$n_exps" -lt 1 ]; then
    log "WARN experts not on HTP; probe VOID for experts-on-NPU but (a) survived"
fi

wait_cool "b_pp"
dump_header "$BASE/header_b_pp.txt" "b pp512 -n 0 -r 2"
dumpsys battery > "$BASE/battery_b_pp_pre.txt"
setup_env_htp
log "launch (b) pp512 -n 0 -r 2"
./llama-bench -m "$MODEL" -p 512 -n 0 -r 2 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -o jsonl -oe jsonl --progress --load-mode none -fa on --ubatch-size 1024 > "$BASE/b_pp_stdout.jsonl" 2> "$BASE/b_pp_stderr.txt"
echo $? > "$BASE/b_pp_rc.txt"
dumpsys battery > "$BASE/battery_b_pp_post.txt"
extract_jsonl "$BASE/b_pp_stderr.txt" "$BASE/b_pp_stdout_from_stderr.jsonl"
count_errs "$BASE/b_pp_stderr.txt" "$BASE/b_pp_errcounts.txt"
log "b_pp rc=$(cat "$BASE/b_pp_rc.txt") njson=$(jsonl_n "$BASE/b_pp_stdout.jsonl")"

wait_cool "b_tg"
dump_header "$BASE/header_b_tg.txt" "b tg128 -r 1"
dumpsys battery > "$BASE/battery_b_tg_pre.txt"
setup_env_htp
log "launch (b) tg128 -r 1"
./llama-bench -m "$MODEL" -p 0 -n 128 -r 1 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -o jsonl -oe jsonl --progress --load-mode none -fa on --ubatch-size 1024 > "$BASE/b_tg_stdout.jsonl" 2> "$BASE/b_tg_stderr.txt"
echo $? > "$BASE/b_tg_rc.txt"
dumpsys battery > "$BASE/battery_b_tg_post.txt"
extract_jsonl "$BASE/b_tg_stderr.txt" "$BASE/b_tg_stdout_from_stderr.jsonl"
log "b_tg rc=$(cat "$BASE/b_tg_rc.txt")"

wait_cool "c_cpu"
dump_header "$BASE/header_c.txt" "CPU -ngl 0 -p 512 -n 128 -r 2"
dumpsys battery > "$BASE/battery_c_pre.txt"
setup_env_cpu
log "launch CPU -ngl 0 -p 512 -n 128 -r 2"
./llama-bench -m "$MODEL" -p 512 -n 128 -r 2 --no-warmup -ngl 0 -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/c_stdout.jsonl" 2> "$BASE/c_stderr.txt"
echo $? > "$BASE/c_rc.txt"
dumpsys battery > "$BASE/battery_c_post.txt"
extract_jsonl "$BASE/c_stderr.txt" "$BASE/c_stdout_from_stderr.jsonl"
log "c rc=$(cat "$BASE/c_rc.txt")"

dumpsys battery > "$BASE/battery_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE a_ok=1 n_exps=$n_exps b_pp=$(cat "$BASE/b_pp_rc.txt") b_tg=$(cat "$BASE/b_tg_rc.txt") c=$(cat "$BASE/c_rc.txt")"
log "F2b DONE survived"
exit 0
