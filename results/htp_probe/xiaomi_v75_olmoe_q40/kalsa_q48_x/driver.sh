#!/system/bin/sh
# Xiaomi houji v75 OLMoE-Q4_0 experts-on-NPU probe. REGISTRA+DICHIARA.
# Same harness as Marco v75 cells: HOSTBUF=1 NDEV=1 -dev HTP0 --no-host 1.

BASE=/data/local/tmp/kalsa_q48_x
BINDIR=/data/local/tmp/kalsahtp
MODEL=/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf
PIN_MODEL=43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500
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

as_int() {
    v="$1"
    def="$2"
    case "$v" in
        ''|*[!0-9]*) echo "$def" ;;
        *) echo "$v" ;;
    esac
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

wait_cool() {
    tag="$1"
    while true; do
        date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/HEARTBEAT"
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
        log "cool-start WAIT tag=$tag temp10=$temp10; sleep 60"
        sleep 60
    done
}

dump_header() {
    dest="$1"
    note="$2"
    {
        echo "phase=xiaomi_v75_olmoe_q40 experts-on-NPU discriminator REGISTRA+DICHIARA"
        echo "device=houji 23127PN0CG serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "note=$note"
        echo "power_declared_below=yes"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|^  Charge counter:|^  voltage:"
        echo "HOSTBUF=1 NDEV=1 --no-host 1 -dev HTP0 (v75 Marco cell convention)"
        echo "binary=$BINDIR/llama-bench stub=$PIN_STUB htp_v75=$PIN_HTP"
        echo "model=$MODEL pin=$PIN_MODEL"
        echo "speed_label=exploratory"
        echo "sysfs_charge_counter=EACCES_use_dumpsys"
    } > "$dest"
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

setup_env() {
    cd "$BINDIR" || exit 90
    export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
    export ADSP_LIBRARY_PATH="$BINDIR"
    export CDSP_LIBRARY_PATH="$BINDIR"
    export GGML_HEXAGON_NDEV=1
    export GGML_HEXAGON_HOSTBUF=1
    unset GGML_OPENCL_LOG_ALLOC
}

extract_jsonl() {
    src="$1"
    dest="$2"
    grep '^{' "$src" > "$dest" 2>/dev/null || true
}

count_errs() {
    errf="$1"
    dest="$2"
    {
        echo "file=$errf"
        echo "dspqueue=$(grep -c dspqueue "$errf" 2>/dev/null || echo 0)"
        echo "INTERNAL_ERROR=$(grep -c INTERNAL-ERROR "$errf" 2>/dev/null || echo 0)"
        echo "hmx_error=$(grep -ci 'hmx error' "$errf" 2>/dev/null || echo 0)"
        echo "Aborted=$(grep -c 'Aborted' "$errf" 2>/dev/null || echo 0)"
        echo "ggml_abort=$(grep -c ggml_abort "$errf" 2>/dev/null || echo 0)"
    } > "$dest"
}

save_crash_context() {
    errf="$1"
    dest="$2"
    if ! grep -q "dspqueue_read failed\|INTERNAL-ERROR\|ggml-hex: dspqueue" "$errf" 2>/dev/null; then
        return 0
    fi
    n=$(wc -l < "$errf")
    n=$(as_int "$(trim "$n")" 0)
    hit=$(grep -n "dspqueue_read failed" "$errf" | tail -1 | awk -F: '{print $1}')
    hit=$(as_int "$hit" 0)
    if [ "$hit" -eq 0 ]; then
        hit=$(grep -n "INTERNAL-ERROR" "$errf" | tail -1 | awk -F: '{print $1}')
        hit=$(as_int "$hit" 0)
    fi
    if [ "$hit" -eq 0 ]; then
        start=$((n - 80))
        [ "$start" -lt 1 ] && start=1
        {
            echo "source=$errf"
            echo "nlines=$n"
            echo "pattern=tail"
            sed -n "${start},${n}p" "$errf"
        } > "$dest"
        return 0
    fi
    start=$((hit - 50))
    [ "$start" -lt 1 ] && start=1
    end=$((hit + 20))
    [ "$end" -gt "$n" ] && end=$n
    {
        echo "source=$errf"
        echo "dspqueue_line_1based=$hit"
        echo "window=${start}-${end} of $n"
        echo ""
        sed -n "${start},${end}p" "$errf"
    } > "$dest"
}

copy_tombstone() {
    dest="$1"
    ls -lt /data/tombstones 2>/dev/null | head -8 > "$BASE/tombstones_ls.txt"
    # newest tombstone_* (not .pb) if readable
    newest=$(ls -t /data/tombstones/tombstone_* 2>/dev/null | grep -v '\.pb$' | head -1)
    if [ -n "$newest" ] && [ -r "$newest" ]; then
        cp "$newest" "$dest" 2>/dev/null || true
        echo "copied=$newest" > "$dest.meta"
    else
        echo "no_readable_tombstone newest=$newest" > "$dest.meta"
    fi
}

run_htp() {
    tag="$1"
    shift
    wait_cool "$tag"
    dump_header "$BASE/header_${tag}.txt" "$tag"
    probe_charge "$BASE/charge_${tag}_pre.txt" "$tag PRE"
    dumpsys battery > "$BASE/battery_${tag}_pre.txt"
    setup_env
    export GGML_HEXAGON_VERBOSE=1
    log "launch HTP $tag $*"
    # stdout jsonl + -oe jsonl on stderr (stderr typically unbuffered) so a row survives abort
    ./llama-bench -m "$MODEL" -ngl 99 -dev HTP0 --no-host 1 -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024 "$@" > "$BASE/${tag}_stdout.jsonl" 2> "$BASE/${tag}_stderr.txt"
    echo $? > "$BASE/${tag}_rc.txt"
    probe_charge "$BASE/charge_${tag}_post.txt" "$tag POST"
    dumpsys battery > "$BASE/battery_${tag}_post.txt"
    extract_jsonl "$BASE/${tag}_stderr.txt" "$BASE/${tag}_stdout_from_stderr.jsonl"
    count_errs "$BASE/${tag}_stderr.txt" "$BASE/${tag}_errcounts.txt"
    save_crash_context "$BASE/${tag}_stderr.txt" "$BASE/${tag}_crash_context.txt"
    copy_tombstone "$BASE/${tag}_tombstone.txt"
    log "$tag rc=$(cat "$BASE/${tag}_rc.txt")"
}

run_cpu() {
    tag="$1"
    shift
    wait_cool "$tag"
    dump_header "$BASE/header_${tag}.txt" "$tag"
    probe_charge "$BASE/charge_${tag}_pre.txt" "$tag PRE"
    dumpsys battery > "$BASE/battery_${tag}_pre.txt"
    setup_env
    unset GGML_HEXAGON_VERBOSE
    log "launch CPU $tag $* (no -dev HTP0, no --no-host)"
    ./llama-bench -m "$MODEL" -ngl 0 -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024 "$@" > "$BASE/${tag}_stdout.jsonl" 2> "$BASE/${tag}_stderr.txt"
    echo $? > "$BASE/${tag}_rc.txt"
    probe_charge "$BASE/charge_${tag}_post.txt" "$tag POST"
    dumpsys battery > "$BASE/battery_${tag}_post.txt"
    extract_jsonl "$BASE/${tag}_stderr.txt" "$BASE/${tag}_stdout_from_stderr.jsonl"
    count_errs "$BASE/${tag}_stderr.txt" "$BASE/${tag}_errcounts.txt"
    log "$tag rc=$(cat "$BASE/${tag}_rc.txt")"
}

status "STARTING"
dump_header "$BASE/header_session.txt" "session"
dumpsys battery > "$BASE/battery_session_start.txt"
df -h /data > "$BASE/df.txt"
getprop ro.product.device > "$BASE/device.txt"

got_stub=$(sha256sum "$BINDIR/llama-bench" | awk '{print $1}')
got_htp=$(sha256sum "$BINDIR/libggml-htp-v75.so" | awk '{print $1}')
got_hex=$(sha256sum "$BINDIR/libggml-hexagon.so" | awk '{print $1}')
echo "stub=$got_stub" > "$BASE/binary_sha.txt"
echo "htp_v75=$got_htp" >> "$BASE/binary_sha.txt"
echo "hexagon=$got_hex" >> "$BASE/binary_sha.txt"
if [ "$got_stub" != "$PIN_STUB" ] || [ "$got_htp" != "$PIN_HTP" ] || [ "$got_hex" != "$PIN_HEX" ]; then
    status "STOP binary_sha_mismatch"
    exit 10
fi
echo "model_sha_preverified=$PIN_MODEL" > "$BASE/model_sha.txt"

# ----- (a) pp16/tg8 -v -----
wait_cool "a"
dump_header "$BASE/header_a.txt" "a pp16/tg8 -v"
probe_charge "$BASE/charge_a_pre.txt" "a PRE"
dumpsys battery > "$BASE/battery_a_pre.txt"
setup_env
export GGML_HEXAGON_VERBOSE=1
log "launch (a) pp16/tg8 -v"
./llama-bench -m "$MODEL" -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -v -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/a_stdout.jsonl" 2> "$BASE/a_stderr.txt"
echo $? > "$BASE/a_rc.txt"
probe_charge "$BASE/charge_a_post.txt" "a POST"
dumpsys battery > "$BASE/battery_a_post.txt"
extract_jsonl "$BASE/a_stderr.txt" "$BASE/a_stdout_from_stderr.jsonl"
count_errs "$BASE/a_stderr.txt" "$BASE/a_errcounts.txt"
save_crash_context "$BASE/a_stderr.txt" "$BASE/a_crash_context.txt"
copy_tombstone "$BASE/a_tombstone.txt"

# execute-op proof extracts
grep "model buffer size" "$BASE/a_stderr.txt" > "$BASE/a_buffer_sizes.txt" || true
grep "offloaded" "$BASE/a_stderr.txt" | grep layers > "$BASE/a_offload.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep "HTP0" > "$BASE/a_execute_op_htp0.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep "MUL_MAT_ID" > "$BASE/a_execute_op_mul_mat_id.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep "MUL_MAT_ID" | grep "ffn_.*_exps" > "$BASE/a_execute_op_exps.txt" || true
grep "execute-op" "$BASE/a_stderr.txt" | grep -E "attn_q|attn_k|attn_v|attn_output|attn_qkv" > "$BASE/a_execute_op_attn.txt" || true
grep "supports-op" "$BASE/a_stderr.txt" | grep MUL_MAT_ID > "$BASE/a_supports_mul_mat_id.txt" || true
grep "init-tensor" "$BASE/a_stderr.txt" | grep exps > "$BASE/a_init_tensor_exps.txt" || true

n_htp=$(as_int "$(trim "$(wc -l < "$BASE/a_execute_op_htp0.txt")")" 0)
n_mmid=$(as_int "$(trim "$(wc -l < "$BASE/a_execute_op_mul_mat_id.txt")")" 0)
n_exps=$(as_int "$(trim "$(wc -l < "$BASE/a_execute_op_exps.txt")")" 0)
n_attn=$(as_int "$(trim "$(wc -l < "$BASE/a_execute_op_attn.txt")")" 0)
echo "rc=$(cat "$BASE/a_rc.txt") n_htp=$n_htp n_mul_mat_id=$n_mmid n_exps=$n_exps n_attn=$n_attn" > "$BASE/a_proof.txt"
log "a proof $(cat "$BASE/a_proof.txt")"

# ----- (b) pp512 -n 0, two process-level reps (per-rep charge); stdout+oe jsonl -----
run_htp "b_r1" -p 512 -n 0 -r 1 -v
run_htp "b_r2" -p 512 -n 0 -r 1 -v

b1=$(as_int "$(cat "$BASE/b_r1_rc.txt")" 99)
b2=$(as_int "$(cat "$BASE/b_r2_rc.txt")" 99)
b_ok=0
if [ "$b1" -eq 0 ] || [ "$b2" -eq 0 ]; then
    b_ok=1
fi
echo "b_r1=$b1 b_r2=$b2 b_ok=$b_ok" > "$BASE/b_survival.txt"
log "b survival b_r1=$b1 b_r2=$b2 b_ok=$b_ok"

if [ "$b_ok" -eq 1 ]; then
    run_htp "b_tg" -p 0 -n 128 -r 1 -v
else
    log "skip tg: (b) pp512 did not survive"
    echo "skipped" > "$BASE/b_tg_skipped.txt"
fi

# ----- (c) CPU -ngl 0 pp512+tg128 two -r 1 (per-rep charge) -----
run_cpu "c_r1" -p 512 -n 128 -r 1
run_cpu "c_r2" -p 512 -n 128 -r 1

dumpsys battery > "$BASE/battery_session_end.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BASE/t_session_end.txt"
status "DONE a_rc=$(cat "$BASE/a_rc.txt") b_r1=$b1 b_r2=$b2 c_r1=$(cat "$BASE/c_r1_rc.txt") c_r2=$(cat "$BASE/c_r2_rc.txt")"
log "q48 xiaomi DONE"
exit 0
