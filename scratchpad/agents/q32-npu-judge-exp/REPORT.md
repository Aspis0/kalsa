# q32 — HTP NaN judge experiment #1 (PC-only)

PC-only. No adb. No device. Local branch only; origin.pushurl=DISABLED.

Pinned checkout: `upstream-hexagon/llama.cpp` @ `3f545beccee69d9975f466ec7e45fd9aacd8ba90`
Local branch: `judge-exp1-plain-host` @ `dbf3f009fa864df408f8a7208da6f129d8374f27`
(parent `d5f4166d` + review-fix `dbf3f009`). Patch: `tests/test-backend-ops.cpp` only.

## 1. Upstream check (desk)

Fetched `origin/master` (`blob:none`, no merge). After 3f545be, master has **one** commit:

| sha | date | title | relevance |
|---|---|---|---|
| `70adb1b4cea5ee39f867792c78dc59320921eda7` | 2026-08-23 | `common: json.h: fix clang lto (#27575)` | none — not tests, not buffers, not repack |

**Verdict: 3f545be does not predate a landed reference-buffer fix.** Nothing after the pin touches `test-backend-ops` allocation, aarch64 extra-buffer init, or extra-buft handling in tests. Do not cherry-pick; do not merge.

Related *prior* commits already **in** 3f545be (known extra-buffer / hexagon-repack class — not a post-pin fix):

| sha | title | one-line relevance |
|---|---|---|
| `8be759e6f70d629638a7eb70db3824cbdcea370b` | hexagon MUL_MAT tiled 32x32 weight repack (#24954) | `set_tensor` packs q4_0/q4_1/q8_0/iq4_nl/mxfp4 **in-place** into the HTP buffer |
| `cff777f22614e3129203ddc93e78b5576c936b0c` | hexagon host buffers optional (#18822) | `GGML_HEXAGON_HOSTBUF` (default **1**) marks HTP default buft `is_host=true` |
| `609ea50026a336a6cf3c02e596792477530b5928` | hexagon Q4_0 / MXFP4 repack fixes (#20527) | pack/unpack correctness on HTP side, not the CPU reference path |
| `13002a08960e51a76c4d696165b5d7638d2f2b99` | hexagon get/set respect input size (#16836) | get/set size handling; unpack lives in `get_tensor` |
| `19d8762ab61df8286367588a80b9c7db4cb568db` | ggml: refactor online repacking (#10446) | CPU extra buft `CPU_REPACK` |
| `0bb2919335d00ff0bc79d5015da95c422de51f03` | cpu_buft_list: extra before CPU (#12632) | scheduler extra-buft order (llama load), not test-backend-ops |
| `d6818d06a6237631523bc0f45d42e79482667948` | `--no-repack` / allow other CPU bufts (#14990) | llama-bench `--no-host` uses **HTP0-REPACK** extra buft |

Desk reading of 3f545be (this is the smoking-gun mechanism, to confirm on device):

1. Harness allocates on **backend1 = HTP**, `init_tensor_uniform` writes canonical q4_0 via `ggml_backend_tensor_set`.
2. Hexagon `set_tensor` **repacks tiled in-place** for q4_0/q4_1/q8_0/iq4_nl/mxfp4.
3. `ggml_backend_graph_copy` → CPU. Because `HOSTBUF=1` makes HTP `is_host=true`, copy takes the `src is_host` branch: `ggml_backend_tensor_set(dst, src->data, …)` = **raw memcpy of tiled bytes**, skipping `get_tensor` unpack.
4. CPU dequant reads tiled payload as canonical `block_q4_0.d` → fp16 NaN/Inf → `CPU=nan`. HTP compute stays finite (it knows the tiled layout).

Qwen's ARM `CPU_REPACK` extra-buft is **not** used by `ggml_backend_alloc_ctx_tensors` (default buft only = `"CPU"`). Experiment #1 still discriminates: log `buft` names; `GGML_TEST_PLAIN_HOST=1` recopies through `get`/`set` into `ggml_backend_cpu_buffer_type()`. If NaNs vanish, the reference was layout-poisoned.

## 2. Patch

Branch `judge-exp1-plain-host` (local, not pushed).

- **(a)** On NaN / inf-mismatch / inf-sign / ERR: print `cpu_buf` / `cpu_buft` and dump `dev-*` / `cpu-*` (`buf`, `buft`, `host=`). `nan_scales`/`inf_scales` are printed **only** for `buft == ggml_backend_cpu_buffer_type()` (canonical blocks). q4_1/q5_1 scan **d and m**; mxfp4 counts `e==0xFF` in `nan_scales`. HTP tiled host bytes are **not** scanned (nibble false-positives).
- **(b)** `GGML_TEST_PLAIN_HOST=1`: after `ggml_backend_graph_copy` onto CPU (default buft already `"CPU"`), recopy through `get`+`set` (HTP unpack). Env off = stock `ggml_backend_compare_graph_backend`. Asserts copy buft is `ggml_backend_cpu_buffer_type()`. Extra-buft `CPU_REPACK` / `HTP0-REPACK` **cannot** appear in this harness (`alloc_ctx_tensors` = default buft only); `buft="CPU"` **rejects** the extra-buft theory, it does not confirm it.
- Banner: `[ref-buf] exp1 GGML_TEST_PLAIN_HOST=0|1 cpu_buft="CPU"`.

Full unified diff vs 3f545be: `scratchpad/agents/q32-npu-judge-exp/patch.diff`. Hostile review: `REVIEW.md` (no BLOCKER; scan holes above were fixed).

Key hunks:

```cpp
// env off: stock compare (callback still logs buft on fail)
if (!plain_host) {
    return ggml_backend_compare_graph_backend(...);
}
// env on: copy onto CPU, then get/set recopy (unpack HTP tiled -> canonical)
copy = ggml_backend_graph_copy(backend2, graph);
recopy_via_get_set(graph, copy.graph);
```

Fail line becomes:

```
[MUL_MAT] NaN at index 0 (HTP0=… CPU=nan) cpu_buf="CPU" cpu_buft="CPU"
[ref-buf] cpu-src0 type=q4_0 buf="CPU" buft="CPU" host=1 blocks=N nan_scales=M inf_scales=K
```

How to read it on-device:

| observation | meaning |
|---|---|
| `cpu-src0` `buft` contains `REPACK` | extra-buft theory — **cannot happen** on this harness (default buft only) |
| `cpu-src0` `buft="CPU"` | expected; extra-buft theory **rejected** |
| `cpu-src0` `buft="CPU"` and `nan_scales>0` (stock run) | packed HTP tiled bytes in the CPU reference (HOSTBUF memcpy) |
| `GGML_TEST_PLAIN_HOST=1` → `cpu-src0 nan_scales=0` and NaNs **gone** | reference was poisoned; HTP math not the bug |
| `GGML_TEST_PLAIN_HOST=1` → NaNs **remain** | not this class; next is exp 3 (CPU arch / fast-math) |

## 3. Build

Recipe: q28 five toolchain fixes (qaic `WinNT`→`bin` copy present, `LLAMA_BUILD_SERVER=OFF` already in cache, CMake 3.31.7 in `deps\cmake`, ninja 1.10.2 on PATH, target `test-backend-ops` only). Incremental rebuild in `build-android-hexagon` then **restore** the original binary so q30/q31 SHA is intact.

| item | value |
|---|---|
| new binary | `build-android-hexagon-judge\bin\test-backend-ops` |
| sha256 | `92511f27a8f199ac51e628a16592be464abeb763c0c1a2cc76cf2a208ef2a494` |
| size | **10640072** bytes |
| orig restored | `build-android-hexagon\bin\test-backend-ops` = `a254c6be99c5d9807b46091f53fc408023dfac5cb9aaf79305d457f1218ea6f4` (10513672 B) |
| .so / HTP skels | **do not push rebuilt .so**. Device keeps q30/q31 kalsahtp libs. After the local git commit, cmake re-ran and `libggml-base.so` on PC drifted (`cffac1e5…`, commit string only). `libggml.so` / `libggml-cpu.so` / `libggml-hexagon.so` / `libllama.so` / `libggml-htp-v73.so` / `v75.so` still match q28 MANIFEST. |
| HTP targets | v73 + v75 already in existing tree (`libggml-htp-v73.so`, `libggml-htp-v75.so`) |
| cmake | `deps\cmake\cmake-3.31.7-windows-x86_64\bin\cmake.exe` |
| ndk | 27.1.12297006, `arm64-v8a` / `android-31` |
| flags | `-march=armv8.7a+fp16+dotprod+i8mm -ffp-model=fast -fno-finite-math-only -flto` (same as q28) |

## 4. Next device window (do not run from this task)

Push **only** the new `test-backend-ops` over `/data/local/tmp/kalsahtp/` (libs stay). Filter to the 70 failing quant MUL_MAT cases. Redirect to `results/htp_judge/<device>/`.

Filter (same as `xiaomi_v75_baseline`):

```
./test-backend-ops test -b HTP0 -o MUL_MAT -p 'type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)'
```

Shared env (q30/q31):

```
cd /data/local/tmp/kalsahtp
export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64
export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_HOSTBUF=1
export GGML_HEXAGON_VERBOSE=1
```

### Xiaomi 14 (v75) — serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp`

```
# PC: push binary, then pull logs. Device: houji.
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp push build-android-hexagon-judge/bin/test-backend-ops /data/local/tmp/kalsahtp/test-backend-ops
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell chmod 755 /data/local/tmp/kalsahtp/test-backend-ops

# run A — stock path (expect CPU=nan + [ref-buf] lines)
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell "cd /data/local/tmp/kalsahtp && \
  export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64 \
         ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp \
         GGML_HEXAGON_NDEV=1 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_VERBOSE=1 \
         GGML_TEST_PLAIN_HOST=0 && \
  ./test-backend-ops test -b HTP0 -o MUL_MAT -p 'type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)' \
    > logs/judge_exp1_stock.out 2> logs/judge_exp1_stock.err; echo \$? > logs/judge_exp1_stock.rc"

# run B — plain host recopy (NaNs should vanish if root cause is packed reference)
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell "cd /data/local/tmp/kalsahtp && \
  export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64 \
         ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp \
         GGML_HEXAGON_NDEV=1 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_VERBOSE=1 \
         GGML_TEST_PLAIN_HOST=1 && \
  ./test-backend-ops test -b HTP0 -o MUL_MAT -p 'type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)' \
    > logs/judge_exp1_plain.out 2> logs/judge_exp1_plain.err; echo \$? > logs/judge_exp1_plain.rc"

adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_stock.out  results/htp_judge/xiaomi_v75/
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_stock.err  results/htp_judge/xiaomi_v75/
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_stock.rc   results/htp_judge/xiaomi_v75/
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_plain.out  results/htp_judge/xiaomi_v75/
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_plain.err  results/htp_judge/xiaomi_v75/
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp pull /data/local/tmp/kalsahtp/logs/judge_exp1_plain.rc   results/htp_judge/xiaomi_v75/
```

### S23 (v73) — serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`

Same two runs; pull to `results/htp_judge/s23_v73/`. Swap `-s` to the S23 serial. Workdir is still `/data/local/tmp/kalsahtp`.

Confirm device SHA before running:

```
adb … shell sha256sum /data/local/tmp/kalsahtp/test-backend-ops
# expect 92511f27a8f199ac51e628a16592be464abeb763c0c1a2cc76cf2a208ef2a494
```

Grep after pull:

```
rg "\[ref-buf\]|cpu_buft=|nan_scales=|tests passed" results/htp_judge/<device>/
```

Do **not** run llama-bench, do **not** touch Jelly, do **not** swap the other phone's tree.

## 5. Jelly v8.2 variant (PC-only)

Jelly Star / MT6789 (A78/A55) SIGILLs the v8.7+i8mm binary. Second tree, **same source** (`judge-exp1-plain-host` @ `dbf3f009`, patch unchanged). v8.7 artifacts in `build-android-hexagon-judge\` left untouched (`92511f27…`).

| item | value |
|---|---|
| dir | `build-android-hexagon-judge-v82\` |
| `-march` | `armv8.2-a+fp16+dotprod` (global C/CXX **and** `-DGGML_CPU_ARM_ARCH=…`) |
| i8mm / v8.7 | **absent** — `compile_commands.json` has zero `i8mm` |
| `GGML_USE_CPU_REPACK` | **ON** (dotprod kept) |
| recipe | `scratchpad/agents/q32-npu-judge-exp/build-android-hexagon-judge-v82.ps1` |
| rest | same q28 recipe (NDK 27.1, CMake 3.31.7, ninja, `LLAMA_BUILD_SERVER=OFF`, `GGML_HEXAGON=ON`, LTO, fp-model=fast) |

Do **not** mix with the v8.7 tree. DT_NEEDED of `test-backend-ops` is the same six ggml/llama `.so`; ship this set together.

| file | sha256 | bytes |
|---|---|---:|
| `build-android-hexagon-judge-v82\bin\test-backend-ops` | `945523136cee98061ab7f6ab7d7d05cd28c016519e3b0964d63a63b92109c607` | 10640080 |
| `build-android-hexagon-judge-v82\bin\libggml.so` | `3f4472fc2f8e0e5fe952792af7bbb9e22dc538c52addec3c651b979cecc9c724` | 601576 |
| `build-android-hexagon-judge-v82\bin\libggml-base.so` | `04c7dbc6bd281000620ccf7f39b667b216f9656feae043a04a626da14d3be40b` | 6144232 |
| `build-android-hexagon-judge-v82\bin\libggml-cpu.so` | `2a3a28c710e6575536b14d72a5f1deb28f52cda05fe6436d2097a6b56905b096` | 4116864 |
| `build-android-hexagon-judge-v82\bin\libggml-hexagon.so` | `4d7dd4c52162ac26e242f7455ccddb0481f018c08407cf7786e45f1d98964d98` | 3391968 |
| `build-android-hexagon-judge-v82\bin\libllama.so` | `850a45eb3e72eb612cea9466eb0dd2fc069359dbaff3142896df1415bc91d039` | 37429120 |
| `build-android-hexagon-judge-v82\bin\libllama-common.so` | `f28e0635b9c7900c49c9cb3c3ca1da4aa94172b0a27b66d10cd9d91866593622` | 68158464 |

`libggml-cpu.so` is ~114 KiB smaller than the v8.7+i8mm build (no i8mm kernels). `libggml-hexagon.so` is the Android-side stub (same DT_NEEDED as v8.7); HTP skels exist in-tree but are unused on MediaTek. Also in `build-android-hexagon-judge-v82\MANIFEST.txt`. No push, no adb.
