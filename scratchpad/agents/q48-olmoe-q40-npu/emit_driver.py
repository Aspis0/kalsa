#!/usr/bin/env python3
"""Emit LF-only q48 OLMoE Q4_0 experts-on-NPU probe driver + launch (no CR)."""
from pathlib import Path

HERE = Path(__file__).resolve().parent

DRIVER = r'''#!/system/bin/sh
# q48 - OLMoE all-Q4_0 experts-on-NPU probe v73. REGISTRA+DICHIARA.
# LF-only. Detached via phase2_launch.sh (setsid+nohup).

BASE=/data/local/tmp/kalsa_q48
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
        echo "phase=q48 OLMoE Q4_0 experts-on-NPU probe v73 REGISTRA+DICHIARA"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "unplugged_declared=yes"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:"
        echo "HOSTBUF_note=llama-bench path UNSETS GGML_HEXAGON_HOSTBUF (v73 run_bench_htp.sh). HOSTBUF=1 is test-backend-ops only and CPU-falls back quantized MUL_MAT."
        echo "binary=$BIN stub=$PIN_STUB hexagon=$PIN_HEX htp_v73=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
        echo "meminfo:"
        grep -E "MemTotal:|MemFree:|MemAvailable:|SwapTotal:|SwapFree:" /proc/meminfo
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

extract_buffers() {
    src="$1"
    dest="$2"
    grep "load_tensors: offloaded" "$src" > "$dest" || true
    grep "model buffer size" "$src" >> "$dest" || true
}

extract_probe() {
    src="$1"
    prefix="$2"
    grep "execute-op" "$src" | grep "HTP0" > "$BASE/${prefix}_execute_op_htp0.txt" || true
    grep "execute-op" "$src" | grep "MUL_MAT_ID" > "$BASE/${prefix}_execute_op_mul_mat_id.txt" || true
    grep "HTP0 execute-op MUL_MAT_ID" "$src" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" > "$BASE/${prefix}_execute_op_exps_htp0.txt" || true
    grep "execute-op" "$src" | grep -E "attn_q|attn_k|attn_v|attn_output|attn_qkv" > "$BASE/${prefix}_execute_op_attn.txt" || true
    grep "execute-op" "$src" | grep -iE "ffn_gate_exps|ffn_up_exps|ffn_down_exps" > "$BASE/${prefix}_execute_op_exps_any.txt" || true
    grep -c "execute-op" "$src" > "$BASE/${prefix}_execute_op_count.txt" 2>/dev/null || echo 0 > "$BASE/${prefix}_execute_op_count.txt"
    grep "init-tensor" "$src" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" > "$BASE/${prefix}_init_tensor_exps.txt" || true
    grep "init-tensor" "$src" | grep -E "attn_q|attn_k|attn_v|attn_output" > "$BASE/${prefix}_init_tensor_attn.txt" || true
    grep "supports-op MUL_MAT_ID" "$src" > "$BASE/${prefix}_supports_mul_mat_id.txt" || true
    grep "supports-op MUL_MAT_ID" "$src" | grep '|no' > "$BASE/${prefix}_supports_mul_mat_id_no.txt" || true
    grep "supports-op MUL_MAT_ID" "$src" | grep '|yes' > "$BASE/${prefix}_supports_mul_mat_id_yes.txt" || true
    grep -iE "not supported|VTCM|vtcm|reject|fallback" "$src" | grep -iE "MUL_MAT_ID|exps|expert|HTP0" > "$BASE/${prefix}_reject_why.txt" || true
    grep "not supported" "$src" > "$BASE/${prefix}_not_supported.txt" || true
}

count_lines() {
    n=$(wc -l < "$1" 2>/dev/null)
    as_int "$(trim "$n")" 0
}

jsonl_ok() {
    f="$1"
    if [ ! -s "$f" ]; then
        echo 0
        return
    fi
    n=$(grep -c "avg_ts" "$f" 2>/dev/null)
    as_int "$(trim "$n")" 0
}

status "STARTING"
heartbeat
dump_header "$BASE/header_session.txt"
dumpsys battery > "$BASE/battery_session_start.txt"
df -h /data > "$BASE/df.txt"
cat /proc/meminfo > "$BASE/meminfo_session_start.txt"

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
log "model_sha=$got_model"
if [ "$got_model" != "$PIN_MODEL" ]; then
    status "STOP model_sha_mismatch got=$got_model"
    exit 11
fi

# ----- (a) pp16/tg8 sanity with -v : THE PROBE -----
wait_cool "a_pp16_tg8"
dump_header "$BASE/header_a.txt"
dumpsys battery > "$BASE/battery_a_pre.txt"
cat /proc/meminfo > "$BASE/meminfo_a_pre.txt"
setup_env_htp
log "launch (a) pp16/tg8 -v HTP0 PROBE experts MUL_MAT_ID"
./llama-bench -m "$MODEL" -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/a_stdout.jsonl" 2> "$BASE/a_stderr.txt"
echo $? > "$BASE/a_rc.txt"
rc_a=$(as_int "$(cat "$BASE/a_rc.txt")" 99)
dumpsys battery > "$BASE/battery_a_post.txt"
cat /proc/meminfo > "$BASE/meminfo_a_post.txt"
log "a rc=$rc_a"

extract_buffers "$BASE/a_stderr.txt" "$BASE/a_buffer_split.txt"
extract_probe "$BASE/a_stderr.txt" "a"
n_htp=$(count_lines "$BASE/a_execute_op_htp0.txt")
n_attn=$(count_lines "$BASE/a_execute_op_attn.txt")
n_exps_htp=$(count_lines "$BASE/a_execute_op_exps_htp0.txt")
n_mmid=$(count_lines "$BASE/a_execute_op_mul_mat_id.txt")
n_mmid_yes=$(count_lines "$BASE/a_supports_mul_mat_id_yes.txt")
n_mmid_no=$(count_lines "$BASE/a_supports_mul_mat_id_no.txt")
n_json=$(jsonl_ok "$BASE/a_stdout.jsonl")
{
    echo "rc_a=$rc_a n_htp_execute_op=$n_htp n_attn_execute_op=$n_attn n_exps_htp0_mul_mat_id=$n_exps_htp n_mul_mat_id_execute_op=$n_mmid n_supports_mmid_yes=$n_mmid_yes n_supports_mmid_no=$n_mmid_no n_jsonl_avg_ts=$n_json"
    echo "--- buffer split ---"
    cat "$BASE/a_buffer_split.txt"
    echo "--- first 20 supports-op MUL_MAT_ID ---"
    head -20 "$BASE/a_supports_mul_mat_id.txt"
    echo "--- first 10 HTP0 execute-op MUL_MAT_ID exps ---"
    head -10 "$BASE/a_execute_op_exps_htp0.txt"
    echo "--- first 20 reject/why ---"
    head -20 "$BASE/a_reject_why.txt"
} > "$BASE/a_proof.txt"
log "a proof n_htp=$n_htp n_attn=$n_attn n_exps_htp=$n_exps_htp n_mmid=$n_mmid yes=$n_mmid_yes no=$n_mmid_no n_json=$n_json"

if [ "$rc_a" -ne 0 ]; then
    status "STOP a_rc=$rc_a n_exps_htp=$n_exps_htp"
    exit 23
fi
if [ "$n_json" -lt 1 ]; then
    status "STOP a_garbage_or_empty_jsonl n_exps_htp=$n_exps_htp"
    exit 25
fi

# (a) sane even if experts did NOT dispatch (clean negative is a successful probe)
# ----- (b) pp512 + tg128 exploratory, 2 reps, HTP -----
wait_cool "b_pp512_tg128"
dump_header "$BASE/header_b.txt"
dumpsys battery > "$BASE/battery_b_pre.txt"
cat /proc/meminfo > "$BASE/meminfo_b_pre.txt"
setup_env_htp
log "launch (b) pp512 tg128 -r 2 HTP0 exploratory"
./llama-bench -m "$MODEL" -p 512 -n 128 -r 2 -ngl 99 -dev HTP0 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/b_stdout.jsonl" 2> "$BASE/b_stderr.txt"
echo $? > "$BASE/b_rc.txt"
rc_b=$(as_int "$(cat "$BASE/b_rc.txt")" 99)
dumpsys battery > "$BASE/battery_b_post.txt"
cat /proc/meminfo > "$BASE/meminfo_b_post.txt"
log "b rc=$rc_b"
extract_buffers "$BASE/b_stderr.txt" "$BASE/b_buffer_split.txt"

# ----- (c) same-harness CPU-only reference, 1 rep, exploratory -----
wait_cool "c_pp512_tg128_cpu"
dump_header "$BASE/header_c.txt"
dumpsys battery > "$BASE/battery_c_pre.txt"
cat /proc/meminfo > "$BASE/meminfo_c_pre.txt"
setup_env_cpu
log "launch (c) pp512 tg128 -r 1 CPU-only same-harness exploratory"
./llama-bench -m "$MODEL" -p 512 -n 128 -r 1 -ngl 0 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/c_stdout.jsonl" 2> "$BASE/c_stderr.txt"
echo $? > "$BASE/c_rc.txt"
rc_c=$(as_int "$(cat "$BASE/c_rc.txt")" 99)
dumpsys battery > "$BASE/battery_c_post.txt"
cat /proc/meminfo > "$BASE/meminfo_c_post.txt"
log "c rc=$rc_c"
extract_buffers "$BASE/c_stderr.txt" "$BASE/c_buffer_split.txt"

dumpsys battery > "$BASE/battery_session_end.txt"
cat /proc/meminfo > "$BASE/meminfo_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE a_rc=$rc_a b_rc=$rc_b c_rc=$rc_c n_exps_htp=$n_exps_htp n_htp=$n_htp n_attn=$n_attn"
log "q48 DONE"
exit 0
'''

LAUNCH = r'''#!/system/bin/sh
cd /data/local/tmp/kalsa_q48 || exit 90
setsid nohup sh /data/local/tmp/kalsa_q48/phase2_driver.sh </dev/null >/data/local/tmp/kalsa_q48/driver.out 2>&1 &
echo $!
'''


def emit(name: str, text: str) -> None:
    data = text.replace("\r\n", "\n").replace("\r", "\n")
    if not data.endswith("\n"):
        data += "\n"
    path = HERE / name
    path.write_bytes(data.encode("ascii"))
    raw = path.read_bytes()
    if b"\r" in raw:
        raise SystemExit(f"CR leaked into {name}")
    print(f"wrote {path} bytes={len(raw)} cr=0")


def main() -> None:
    emit("phase2_driver.sh", DRIVER)
    emit("phase2_launch.sh", LAUNCH)


if __name__ == "__main__":
    main()
