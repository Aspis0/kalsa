#!/usr/bin/env bash
set -eu

clang=/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang
kernel=/Users/marco/Projects/kalsallama-wt-accprobe/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl
log_dir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa-gemm-prec.XXXXXX")
trap 'rm -rf "$log_dir"' EXIT

failed=0
for prec in 0 1 2 3; do
    log="$log_dir/prec-$prec.log"
    set +e
    "$clang" -x cl -cl-std=CL1.2 -Xclang -finclude-default-header \
        -target spirv64 -DKALSA_GEMM_PREC="$prec" -fsyntax-only "$kernel" >"$log" 2>&1
    rc=$?
    set -e
    cat "$log"
    printf 'PREC=%s rc=%s\n' "$prec" "$rc"
    if [ "$rc" -ne 0 ]; then
        failed=1
    fi
done

for prec in 2 3; do
    log="$log_dir/prec-$prec-float.log"
    set +e
    "$clang" -x cl -cl-std=CL1.2 -Xclang -finclude-default-header \
        -target spirv64 -DKALSA_GEMM_PREC="$prec" -DKALSA_GEMM_B_FLOAT=1 -fsyntax-only "$kernel" >"$log" 2>&1
    rc=$?
    set -e
    cat "$log"
    printf 'PREC=%s B=float rc=%s\n' "$prec" "$rc"
    if [ "$rc" -ne 0 ]; then
        failed=1
    fi
done

exit "$failed"
