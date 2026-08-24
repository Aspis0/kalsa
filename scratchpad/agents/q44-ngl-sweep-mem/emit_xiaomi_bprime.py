"""Emit LF-only Xiaomi v75 B-prime HTP smoke driver."""
from pathlib import Path

HERE = Path(__file__).resolve().parent

DRIVER = r'''#!/system/bin/sh
# Xiaomi houji v75 B-prime Q8_0-trunk HTP smoke. REGISTRA+DICHIARA.
# LF-only. Detached via setsid+nohup.

BASE=/data/local/tmp/kalsa_bprime_x
BINDIR=/data/local/tmp/kalsahtp
BIN="$BINDIR/llama-bench"
MODEL=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf
PIN_MODEL=bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419
PIN_STUB=5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507
PIN_IMPL=5c744d726e76b03c03e2b7821915ab21b8794bdbe1d32d6092169f78d0183915
PIN_HEX=f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448
PIN_HTP=46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182

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

dump_header() {
    dest="$1"
    {
        echo "phase=xiaomi_v75_bprime HTP smoke REGISTRA+DICHIARA"
        echo "device=houji 23127PN0CG serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "power_declared_below=yes (plugged acceptable for dispatch proof; t/s exploratory)"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|^  plugged:"
        echo "HOSTBUF=1 (v75 cell1 llama-bench path) NDEV=1 --no-host 1 -dev HTP0 -ngl 99"
        echo "binary=$BIN stub=$PIN_STUB impl=$PIN_IMPL hexagon=$PIN_HEX htp_v75=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
        echo "speed_label=exploratory"
    } > "$dest"
}

setup_env() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_HOSTBUF=1
    unset GGML_OPENCL_LOG_ALLOC
}

status "STARTING"
heartbeat
dump_header "$BASE/header_session.txt"
dumpsys battery > "$BASE/battery_session_start.txt"
df -h /data > "$BASE/df.txt"
getprop ro.product.device > "$BASE/device.txt"
echo "houji_ok" >> "$BASE/device.txt"

got_stub=$(sha256sum "$BIN" | awk '{print $1}')
got_impl=$(sha256sum "$BINDIR/libllama-bench-impl.so" | awk '{print $1}')
got_hex=$(sha256sum "$BINDIR/libggml-hexagon.so" | awk '{print $1}')
got_htp=$(sha256sum "$BINDIR/libggml-htp-v75.so" | awk '{print $1}')
{
    echo "stub=$got_stub"
    echo "impl=$got_impl"
    echo "hexagon=$got_hex"
    echo "htp_v75=$got_htp"
} > "$BASE/binary_sha.txt"
if [ "$got_stub" != "$PIN_STUB" ] || [ "$got_impl" != "$PIN_IMPL" ] || [ "$got_hex" != "$PIN_HEX" ] || [ "$got_htp" != "$PIN_HTP" ]; then
    status "STOP binary_sha_mismatch"
    exit 10
fi

echo "model_sha_preverified=$PIN_MODEL" > "$BASE/model_sha.txt"
ls -l "$MODEL" >> "$BASE/model_sha.txt"

# ----- (a) pp16/tg8 sanity with -v -----
dump_header "$BASE/header_a.txt"
dumpsys battery > "$BASE/battery_a_pre.txt"
setup_env
export GGML_HEXAGON_VERBOSE=1
log "launch (a) pp16/tg8 -v HTP0 HOSTBUF=1 --no-host 1"
./llama-bench -m "$MODEL" -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/a_stdout.jsonl" 2> "$BASE/a_stderr.txt"
echo $? > "$BASE/a_rc.txt"
rc_a=$(as_int "$(cat "$BASE/a_rc.txt")" 99)
dumpsys battery > "$BASE/battery_a_post.txt"
log "a rc=$rc_a"

grep "model buffer size" "$BASE/a_stderr.txt" > "$BASE/a_buffer_sizes.txt" || true
grep "offloaded" "$BASE/a_stderr.txt" | grep "layers" > "$BASE/a_offload.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep "HTP0" > "$BASE/a_execute_op_htp0.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep -E "attn_q|attn_k|attn_v|attn_output|attn_qkv" > "$BASE/a_execute_op_attn.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep -iE "ffn_moe|ffn_gate_exps|ffn_up_exps|ffn_down_exps|exps" > "$BASE/a_execute_op_experts.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep "MUL_MAT" > "$BASE/a_execute_op_mul_mat.txt" || true

n_htp=$(wc -l < "$BASE/a_execute_op_htp0.txt" 2>/dev/null)
n_htp=$(as_int "$(trim "$n_htp")" 0)
n_attn=$(wc -l < "$BASE/a_execute_op_attn.txt" 2>/dev/null)
n_attn=$(as_int "$(trim "$n_attn")" 0)
n_mm=$(wc -l < "$BASE/a_execute_op_mul_mat.txt" 2>/dev/null)
n_mm=$(as_int "$(trim "$n_mm")" 0)
echo "rc_a=$rc_a n_htp_execute_op=$n_htp n_attn_execute_op=$n_attn n_mul_mat=$n_mm" > "$BASE/a_proof.txt"
log "a proof n_htp=$n_htp n_attn=$n_attn n_mul_mat=$n_mm"

if [ "$rc_a" -ne 0 ]; then
    status "STOP a_rc=$rc_a"
    exit 23
fi
if [ ! -s "$BASE/a_stdout.jsonl" ]; then
    status "STOP a_empty_stdout"
    exit 25
fi
if [ "$n_htp" -lt 1 ]; then
    status "STOP a_no_HTP0_execute_op"
    exit 24
fi
if [ "$n_attn" -lt 1 ]; then
    log "WARN no attn name match in execute-op; HTP0 still present n_htp=$n_htp — continue if MUL_MAT HTP0 exists"
    if [ "$n_mm" -lt 1 ]; then
        status "STOP a_no_HTP0_MUL_MAT"
        exit 24
    fi
fi

# ----- (b) pp512 + tg128, 2 reps, exploratory -----
dump_header "$BASE/header_b.txt"
dumpsys battery > "$BASE/battery_b_pre.txt"
setup_env
unset GGML_HEXAGON_VERBOSE
log "launch (b) pp512 tg128 -r 2 HTP0 HOSTBUF=1 --no-host 1 (exploratory)"
./llama-bench -m "$MODEL" -p 512 -n 128 -r 2 -ngl 99 -dev HTP0 --no-host 1 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/b_stdout.jsonl" 2> "$BASE/b_stderr.txt"
echo $? > "$BASE/b_rc.txt"
rc_b=$(as_int "$(cat "$BASE/b_rc.txt")" 99)
dumpsys battery > "$BASE/battery_b_post.txt"
log "b rc=$rc_b"

dumpsys battery > "$BASE/battery_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE a_rc=$rc_a b_rc=$rc_b n_htp=$n_htp n_attn=$n_attn"
log "xiaomi bprime DONE"
exit 0
'''

LAUNCH = r'''#!/system/bin/sh
# Detach so adb hangup cannot SIGHUP llama-bench.
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/setsid.pid
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

emit("xiaomi_bprime_driver.sh", DRIVER)
emit("xiaomi_bprime_launch.sh", LAUNCH)
