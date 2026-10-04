# gate-G — NPU from the tiled HOST buffer (one-copy), measurement prep 2026-10-04

Engine: `kalsallama` worktree `~/Projects/kalsallama-gov-onecopy`, branch `feat/governor-onecopy`,
gate-G commit on `b39a45be7c` (loader fix + proof hooks). Artifacts built in
`build-gateg/` (ARM aarch64 Android + v73 HTP skel, `GGML_HEXAGON_HTP_DEBUG=ON` so the DSP
`hmx-mm-2d:` FARF lines can be enabled at runtime with the farf mask file).

## Build (docker, same recipe as onecopy-hmx-numerics §7)

```
docker run --rm --platform linux/amd64 -u 501:20 -v ~/Projects/kalsallama-gov-onecopy:/workspace -w /workspace \
  ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c \
  'cmake -S . -B build-gateg -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF \
   -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-34 \
   -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_ROOT/build/cmake/android.toolchain.cmake \
   -DCMAKE_C_FLAGS="-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE" \
   -DCMAKE_CXX_FLAGS="-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE" \
   -DCMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG" -DCMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG" \
   -DHEXAGON_SDK_ROOT=$HEXAGON_SDK_ROOT -DHEXAGON_TOOLS_ROOT=$HEXAGON_TOOLS_ROOT \
   -DPREBUILT_LIB_DIR=android_aarch64 -DGGML_OPENMP=OFF -DGGML_LLAMAFILE=OFF \
   -DGGML_OPENCL=ON -DGGML_HEXAGON=ON -DLLAMA_OPENSSL=OFF -DGGML_HEXAGON_HTP_DEBUG=ON \
   && cmake --build build-gateg -j2 --target htp-v73 llama-bench llama-perplexity'
```

Known flakes: the OpenCL `embed_kernel.py` codegen step fails sporadically under -j2 (rerun), and
the LTO link of llama-perplexity needs the docker daemon idle. The `embed_kernel.py` flake hit
twice here; both retries went through.

## Run (Marco runs the phone; one adb shell, unplugged, screen on)

```
~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-three-legs/gate-g/push-and-check.sh   # [serial] optional
adb -s <serial> shell          # then, on the phone:
. /data/local/tmp/govhtp/gate-g/run-gate-g.sh
```

Arms: **A** = two-copy NPU (HTP device buffer, mmap as shipped, no env) — the today baseline;
**B** = tiled HOST one-copy (`GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 -lm none`).
Order A B B A; each arm = `llama-bench -p 512 -n 128 -ub 512 -r 3 -t 1 -ngl 99 -dev HTP0`
(peak RSS via `toybox time -v`) + `llama-perplexity` KLD vs `$R/input/cause-cpu-base.logits`
(fixture `kld_english_fixture.txt`), byte-for-byte the df538c50c kld.sh flags.

## Proof lines (session fails an arm without them)

| line | where | grep |
|---|---|---|
| packed tiles: tensor, buft, bytes | every arm-B log (INFO, not verbose-gated) | `grep -c 'HOST-REPACK tensor='` (>0 in B, =0 in A); bytes = sum of `bytes=` |
| placement | loader, every log | `grep 'HTP0-HOST model buffer size'` (B only) |
| decode kernel family (tiled vs flat) | proof pass `proof_decode_*.log` (PROFILE=1 VERBOSE=1 -v) | `grep 'profile-op MUL_MAT' \| grep -c 'hvx-tiled\\|hmx-tiled'` (>0); `hvx-flat` must be 0 |
| prefill HMX | proof pass logcat `adsprpc_*.log` (farf mask 0x1F during pass) | `grep -c 'hmx-mm-2d:'` (>0 both arms) |
| load time | proof pass, `-v` | `grep -m1 'load time ='` |

The decode tag is the HOST-side kparams column (`hvx-tiled`/`hmx-tiled`/`hvx-flat`,
`htp-opnode.h` format_kernel_params); `q4_0_tiled-f32` (`htp/matmul-ops.c:1416`) is the DSP-side
mmctx type and does not appear in host logs. `hmx-mm-2d:` is `htp/matmul-ops.c:2642`.

Note: `-lm` is this fork's load-mode flag (`common/arg.cpp:2691`, `{"-lm", "--load-mode"}`);
`none` = `LLAMA_LOAD_MODE_NONE` (`llama-model-loader.cpp:559`). Without it, with mmap the loader
moves host-buft weights to CPU (`llama-model-loader.cpp:1263-1274`), and without the loader fix
it read_raw's host buffers directly (`:1668`), never calling set_tensor — that is why the tiled
arm never executed before (FABLE-DESIGN §0).

Gate to pass (PLAN-INTEGRATION step G): pp512/tg128 >= 0.95 of two-copy (876 / 22.1), KLD equal;
else one uncached-rpcmem try (`GGML_HEXAGON_HOSTBUF_UNCACHED=1`), then stop.
