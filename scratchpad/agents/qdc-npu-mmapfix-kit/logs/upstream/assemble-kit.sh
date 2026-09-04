#!/bin/sh
# Assemble kit-upstream from pkg-snapdragon. Host-side after docker install.
set -u
WT=/Users/marco/Projects/kalsallama-wt-upstream
SRC="$WT/pkg-snapdragon/llama.cpp"
KIT=/Users/marco/kalsa-qdc/npu-v79-cell/kit-upstream
V6=/Users/marco/kalsa-qdc/npu-v79-cell/kit-v6
TGZ=/Users/marco/kalsa-qdc/npu-v79-cell/npu-kit-62-upstream.tgz

rm -rf "$KIT"
mkdir -p "$KIT/bin" "$KIT/lib" "$KIT/lib-fix"

for b in llama-bench llama-cli llama-perplexity test-backend-ops; do
    cp "$SRC/bin/$b" "$KIT/bin/$b"
done
cp "$V6/bin/test-backend-ops-153f" "$KIT/bin/test-backend-ops-153f"

LIBS="
libggml-base.so
libggml-cpu.so
libggml-hexagon.so
libggml-htp-v73.so
libggml-htp-v75.so
libggml-htp-v79.so
libggml-htp-v81.so
libggml-opencl.so
libggml.so
libllama-batched-bench-impl.so
libllama-bench-impl.so
libllama-cli-impl.so
libllama-common.so
libllama-completion-impl.so
libllama-fit-params-impl.so
libllama-perplexity-impl.so
libllama-quantize-impl.so
libllama-server-impl.so
libllama.so
libmtmd.so
"
for s in $LIBS; do
    cp "$SRC/lib/$s" "$KIT/lib/$s"
    cp "$SRC/lib/$s" "$KIT/lib-fix/$s"
done

(
    cd "$KIT"
    {
        for b in llama-bench llama-cli llama-perplexity test-backend-ops test-backend-ops-153f; do
            shasum -a 256 "bin/$b"
        done
        for s in $LIBS; do
            shasum -a 256 "lib-fix/$s"
        done
        for s in $LIBS; do
            shasum -a 256 "lib/$s"
        done
    } > SHA256SUMS
    tar -czf "$TGZ" bin lib lib-fix SHA256SUMS
)
echo "assembled $KIT"
shasum -a 256 "$TGZ"
wc -l "$KIT/SHA256SUMS"
