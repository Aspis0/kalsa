"""Emit LF-only phase2 HTP smoke driver."""
from pathlib import Path

HERE = Path(__file__).resolve().parent

DRIVER = r'''#!/system/bin/sh
# q44 phase2 — B-prime Q8_0-trunk HTP smoke (v73). REGISTRA+DICHIARA.
# LF-only. Detached via phase2_launch.sh.

BASE=/data/local/tmp/kalsa_q44/phase2
BINDIR=/data/local/tmp/kalsahtp
BIN="$BINDIR/llama-bench"
MODEL=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf
PIN_MODEL=bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419
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
        echo "phase=2 B-prime Q8_0-trunk HTP smoke v73 REGISTRA+DICHIARA"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "unplugged_declared=yes"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:"
        echo "HOSTBUF_note=llama-bench path UNSETS GGML_HEXAGON_HOSTBUF (v73 run_bench_htp.sh). HOSTBUF=1 is test-backend-ops only and CPU-falls back quantized MUL_MAT."
        echo "binary=$BIN stub=$PIN_STUB hexagon=$PIN_HEX htp_v73=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
    } > "$dest"
}

setup_env() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_VERBOSE=1
    unset GGML_HEXAGON_HOSTBUF
    unset GGML_OPENCL_LOG_ALLOC
}

status "STARTING"
heartbeat
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
log "model_sha=$got_model"
if [ "$got_model" != "$PIN_MODEL" ]; then
    status "STOP model_sha_mismatch got=$got_model"
    exit 11
fi

# ----- (a) pp16/tg8 sanity with -v -----
wait_cool "a_pp16_tg8"
dump_header "$BASE/header_a.txt"
dumpsys battery > "$BASE/battery_a_pre.txt"
setup_env
log "launch (a) pp16/tg8 -v HTP0"
./llama-bench -m "$MODEL" -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/a_stdout.jsonl" 2> "$BASE/a_stderr.txt"
echo $? > "$BASE/a_rc.txt"
rc_a=$(as_int "$(cat "$BASE/a_rc.txt")" 99)
dumpsys battery > "$BASE/battery_a_post.txt"
log "a rc=$rc_a"

# proof: HTP0 execute-op on trunk Q/K/V/O
grep "execute-op" "$BASE/a_stderr.txt" | grep "HTP0" > "$BASE/a_execute_op_htp0.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep -E "attn_q|attn_k|attn_v|attn_output|attn_qkv" > "$BASE/a_execute_op_attn.txt" || true
grep -c "execute-op" "$BASE/a_stderr.txt" > "$BASE/a_execute_op_count.txt" 2>/dev/null || echo 0 > "$BASE/a_execute_op_count.txt"
# experts expected CPU / not HTP
grep "execute-op" "$BASE/a_stderr.txt" | grep -iE "ffn_moe|ffn_gate_exps|ffn_up_exps|ffn_down_exps|exps" > "$BASE/a_execute_op_experts.txt" || true

n_htp=$(wc -l < "$BASE/a_execute_op_htp0.txt" 2>/dev/null)
n_htp=$(as_int "$(trim "$n_htp")" 0)
n_attn=$(wc -l < "$BASE/a_execute_op_attn.txt" 2>/dev/null)
n_attn=$(as_int "$(trim "$n_attn")" 0)
echo "rc_a=$rc_a n_htp_execute_op=$n_htp n_attn_execute_op=$n_attn" > "$BASE/a_proof.txt"
log "a proof n_htp=$n_htp n_attn=$n_attn"

if [ "$rc_a" -ne 0 ]; then
    status "STOP a_rc=$rc_a"
    exit 23
fi
if [ "$n_htp" -lt 1 ]; then
    status "STOP a_no_HTP0_execute_op"
    exit 24
fi
if [ "$n_attn" -lt 1 ]; then
    log "WARN no attn Q/K/V/O execute-op name match; HTP0 dispatch still present n_htp=$n_htp"
fi

# ----- (b) pp512 + tg128 exploratory -----
wait_cool "b_pp512_tg128"
dump_header "$BASE/header_b.txt"
dumpsys battery > "$BASE/battery_b_pre.txt"
setup_env
# VERBOSE still on: extra proof on the long run; numbers remain exploratory
log "launch (b) pp512 tg128 HTP0"
./llama-bench -m "$MODEL" -p 512 -n 128 -r 1 -ngl 99 -dev HTP0 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/b_stdout.jsonl" 2> "$BASE/b_stderr.txt"
echo $? > "$BASE/b_rc.txt"
rc_b=$(as_int "$(cat "$BASE/b_rc.txt")" 99)
dumpsys battery > "$BASE/battery_b_post.txt"
log "b rc=$rc_b"

dumpsys battery > "$BASE/battery_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE a_rc=$rc_a b_rc=$rc_b n_htp=$n_htp n_attn=$n_attn"
log "phase2 DONE"
exit 0
'''

LAUNCH = r'''#!/system/bin/sh
cd /data/local/tmp/kalsa_q44/phase2 || exit 90
nohup sh /data/local/tmp/kalsa_q44/phase2/phase2_driver.sh </dev/null >/data/local/tmp/kalsa_q44/phase2/driver.out 2>&1 &
echo $!
'''

def emit(name: str, text: str) -> None:
    data = text.replace("\r\n", "\n").replace("\r", "\n")
    if not data.endswith("\n"):
        data += "\n"
    raw = data.encode("utf-8")
    if b"\r" in raw:
        raise SystemExit(f"CR survived in {name}")
    (HERE / name).write_bytes(raw)
    print(f"wrote {name} bytes={len(raw)}")

emit("phase2_driver.sh", DRIVER)
emit("phase2_launch.sh", LAUNCH)
