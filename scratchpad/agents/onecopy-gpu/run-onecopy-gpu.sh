#!/bin/sh
# S23 session for the one-copy GPU spike. NOT RUN by the author (no adb in phase 1).
# The coordinator runs it when it hands over the S23. Usage:
#   sh run-onecopy-gpu.sh push        # push binaries + kernels, print sha256
#   sh run-onecopy-gpu.sh probe       # extension dump + kernel check on dma-buf imports
#   sh run-onecopy-gpu.sh kld         # control (normal GPU) vs raw one-copy, prefill path
#   sh run-onecopy-gpu.sh kld-decode  # same, one token per ubatch (GEMV path)
# Logs land in ./out/. Correctness only: plugged is allowed, no timing conclusions.
set -u

serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
root=/data/local/tmp/govhtp
dev=$root/onecopy-gpu
eng=/Users/marco/Projects/kalsallama-onecopy-gpu
build=$eng/build-onecopy-gpu
out=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/out
mkdir -p "$out"

# Q4_0 matmul weights of the ship model: the only tensors the raw kernels read.
raw_regex='blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up|down)|shortconv\.(in|out)_proj)\.weight=HTP0:0-HOST'

gate() {
    # No `local` in POSIX sh: assigning to a name here would clobber the caller's
    # (arm's) $name, so the gate logs and the final pull would use the wrong stem.
    adb -s "$serial" shell '
        wake=$(dumpsys power | sed -n "s/.*mWakefulness=//p" | head -1)
        battery=$(dumpsys battery 2>/dev/null | grep -E "^  level:|^  temperature:")
        level=$(printf "%s\n" "$battery" | sed -n "s/^  level: //p" | head -1)
        temp=$(printf "%s\n" "$battery" | sed -n "s/^  temperature: //p" | head -1)
        thermal=$(dumpsys thermalservice | sed -n "s/.*Thermal Status: //p" | head -1)
        traced=$(getprop persist.traced.enable)
        ac=$(dumpsys battery 2>/dev/null | sed -n "s/^  AC powered: //p" | head -1)
        printf "mWakefulness=%s AC=%s level=%s temperature_dC=%s thermal_status=%s traced=%s\n" \
          "$wake" "$ac" "$level" "$temp" "$thermal" "$traced"
        [ "$wake" = Awake ] && [ "$level" -gt 30 ] && [ "$temp" -lt 430 ] \
          && [ "$thermal" -lt 3 ] && [ "$traced" = 0 ]
    ' > "$out/$1.gate.log" 2>&1
    rc=$?
    echo "GATE_EXIT=$rc" >> "$out/$1.gate.log"
    cat "$out/$1.gate.log"
    return "$rc"
}

force_stop_app() {
    adb -s "$serial" shell am force-stop com.kalsa.app > /dev/null 2>&1 || return 31
    if adb -s "$serial" shell pidof com.kalsa.app | grep -q .; then return 31; fi
    return 0
}

push() {
    adb -s "$serial" shell "mkdir -p $dev/bin $dev/dsp $dev/kernels $dev/probe" || exit 20
    adb -s "$serial" push "$build/bin/llama-perplexity" $dev/bin/ || exit 21
    adb -s "$serial" push "$build/ggml/src/ggml-hexagon/libggml-htp-v73.so" $dev/dsp/ || exit 22
    adb -s "$serial" push "$build/q4raw-probe" $dev/probe/ || exit 23
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mm_q4_0_f32_l4_lm_raw.cl" $dev/kernels/ || exit 24
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_v.cl" $dev/kernels/ || exit 25
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled.cl" $dev/kernels/ || exit 26
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v2.cl" $dev/kernels/ || exit 30
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v3i.cl" $dev/kernels/ || exit 32
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v3h.cl" $dev/kernels/ || exit 33
    # SoA baseline arm: the engine's own convert + decode-gemv sources
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/cvt.cl" $dev/kernels/ || exit 27
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/gemv_noshuffle_q4_0_f32.cl" $dev/kernels/ || exit 28
    adb -s "$serial" push "$eng/ggml/src/ggml-opencl/kernels/transpose.cl" $dev/kernels/ || exit 29
    adb -s "$serial" shell "sha256sum $dev/bin/llama-perplexity $dev/dsp/libggml-htp-v73.so $dev/probe/q4raw-probe $dev/kernels/*.cl $root/input/kld_english_fixture.txt $root/input/cause-cpu-base.logits" | tee "$out/payload-sha256.log"
}

probe() {
    gate probe.pre || exit 30
    force_stop_app || exit 31
    for kind in rpcmem system; do
        adb -s "$serial" shell "cd $dev && export LD_LIBRARY_PATH=$root/lib && ./probe/q4raw-probe --kernels $dev/kernels --import $kind --k 2048 --m 6144 --n 128 --sweep-mb 64" > "$out/probe-$kind.log" 2>&1
        echo "probe $kind EXIT=$?"
        grep -E "^INFO|^RESULT" "$out/probe-$kind.log" | grep -v "^INFO name" | head -40
    done
    # Real model shapes near the end of a 768 MiB import (hang-vs-slow discriminator
    # for the G1 stall; see REPORT 2026-09-28 rerun-stall section).
    adb -s "$serial" shell "cd $dev && export LD_LIBRARY_PATH=$root/lib && ./probe/q4raw-probe --kernels $dev/kernels --model-shapes" > "$out/probe-model.log" 2>&1
    echo "probe model EXIT=$?"
    grep -E "^INFO model-shapes|^RESULT" "$out/probe-model.log"
    gate probe.post
}

# arm <name> <raw|normal> <ubatch>
arm() {
    name=$1 mode=$2 ub=$3
    gate "$name.pre" || return 30
    force_stop_app || return 31
    if [ "$mode" = raw ]; then
        setup="GGML_OPENCL_RAWQ4=1 GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_MBUF=512 GGML_HEXAGON_VERBOSE=1 GGML_OPENCL_LOG_KERNELS=1"
        override="-ot '$raw_regex'"
    else
        setup="GGML_OPENCL_LOG_KERNELS=1"
        override=
    fi
    # -v: raise the log threshold so ggml INFO lines (imported dma-buf, model
    # buffer sizes) are captured; they are filtered at the default level.
    adb -s "$serial" shell "cd $root && export LD_LIBRARY_PATH=$root/lib ADSP_LIBRARY_PATH='$dev/dsp;$root/lib' TMPDIR=$dev $setup && $dev/bin/llama-perplexity -v -m /data/local/tmp/heat3way/ship.gguf -f $root/input/kld_english_fixture.txt -c 512 -b 512 -ub $ub -ngl 99 -dev GPUOpenCL $override -lm none --chunks 2 --kl-divergence-base $root/input/cause-cpu-base.logits --kl-divergence > $dev/$name.log 2>&1; rc=\$?; echo EXIT=\$rc >> $dev/$name.log; echo BINARY_EXIT=\$rc; echo imports=\$(grep -c 'imported dma-buf' $dev/$name.log); grep -E 'model buffer size' $dev/$name.log | head -8; grep -E 'GGML_OPENCL_LOG_KERNELS: kernel_mul_(mm|mat)_q4_0' $dev/$name.log | sort -u; echo error_markers=\$(grep -Eic 'GGML_ABORT|GGML_ASSERT|Segmentation|does not meet|exceeds CL_DEVICE|clCreateBuffer.*failed|no usable dma-buf import extension' $dev/$name.log); grep -E 'Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p|prompt eval time' $dev/$name.log | tail -6; exit \$rc" > "$out/$name.run-summary.log" 2>&1
    run_rc=$?
    echo "ADB_EXIT=$run_rc" >> "$out/$name.run-summary.log"
    cat "$out/$name.run-summary.log"
    gate "$name.post"
    adb -s "$serial" pull "$dev/$name.log" "$out/$name.log" > /dev/null 2>&1
    # Status of the run, not of the pull: a good run must not look failed (pull
    # target missing on-device) nor a failed run look good.
    return "$run_rc"
}

case "${1:-}" in
    push)        push ;;
    probe)       probe ;;
    kld)         arm g0-normal-ub128 normal 128; arm g1-raw-ub128 raw 128 ;;
    kld-decode)  arm g0-normal-ub1 normal 1;     arm g1-raw-ub1 raw 1 ;;
    *)           echo "usage: $0 push|probe|kld|kld-decode" >&2; exit 2 ;;
esac
