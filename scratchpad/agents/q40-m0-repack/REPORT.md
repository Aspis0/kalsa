# Q40 M0 — Q2_K_8x4 / Q3_K_8x4 registration and sizing

Status: M0 done on host. Audit fixes pushed. No M1+.

Fork worktree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-repack-q23k`
Branch: `kalsa/repack-q23k` at `cef64aa4c` (base `1882bf8cd`)
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`
BigMoeOnEdge checkout: not touched.

## Files touched (fork)

| File | Change |
|---|---|
| `ggml/src/ggml-cpu/repack.h` | Internal tiles `block_q2_K_8x4` (672 B) and `block_q3_K_8x4` (912 B). No public GGML types. |
| `ggml/src/ggml-cpu/repack.cpp` | Scalar packers, traits `Q2_K_8x4`/`Q3_K_8x4`, neon+dotprod+shape selection, alloc size from tile bytes, extra init/reset, compute returns false, `supports_op` declines these traits including 3-D `MUL_MAT_ID`. |
| `ggml/include/ggml-cpu.h` | No Q2/Q3 8x4 helpers (removed after audit; was a public-API leak). |
| `tests/test-repack-q23k-m0.cpp` | Host selection/sizing/pack/lifecycle test. |
| `tests/CMakeLists.txt` | Registers the test. |

## Commits

```
09a5b1a51 ggml: add Q2_K_8x4 and Q3_K_8x4 tile structs
757adec33 ggml: Q2_K/Q3_K 8x4 pack, selection, and buffer sizing
e374f8475 tests: add M0 host test for Q2_K/Q3_K 8x4 repack
cef64aa4c ggml: keep Q2/Q3 8x4 helpers off the public CPU API
```

Pushed: `git push -u origin kalsa/repack-q23k` → `https://github.com/Aspis0/kalsallama.git` (pre-push Aspis0 allowlist passed). No AI trailers.

## Build

```
cmake -S worktree-repack-q23k -B build-repack-q23k-pc -G Ninja
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=ON -DGGML_NATIVE=ON
  -DGGML_OPENCL=OFF -DGGML_VULKAN=OFF -DLLAMA_BUILD_TOOLS=OFF
  -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF
  -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF
cmake --build build-repack-q23k-pc --target test-repack-q23k-m0 -j 8
```

MSVC 19.44 / Ninja. Host CPU: no NEON, no dotprod, no AVX-512 (`HAS_AVX512` cmake tests failed).

## Raw test output

```
host: neon=0 dotprod=0 avx512=0
repack buft: CPU_REPACK

== selection + sizing ==
type     ne0   ne1   ne2      extra   expect    tiles    pad     helper       hand alloc
Q2_K     256     8     1       null       no        1     32        704        704 672
Q2_K     256     8     2       null       no        1     32       1408       1408 1344
Q2_K     256     8     3       null       no        1     32       2112       2112 2016
Q2_K     256    16     1       null       no        2      0       1344       1344 1344
Q2_K     256    16     2       null       no        2      0       2688       2688 2688
Q2_K     256    16     3       null       no        2      0       4032       4032 4032
Q2_K     256    24     1       null       no        3     32       2048       2048 2016
Q2_K     256    24     2       null       no        3     32       4096       4096 4032
Q2_K     256    24     3       null       no        3     32       6144       6144 6048
Q2_K     256    32     1       null       no        4      0       2688       2688 2688
Q2_K     256    32     2       null       no        4      0       5376       5376 5376
Q2_K     256    32     3       null       no        4      0       8064       8064 8064
Q2_K     512     8     1       null       no        2      0       1344       1344 1344
Q2_K     512     8     2       null       no        2      0       2688       2688 2688
Q2_K     512     8     3       null       no        2      0       4032       4032 4032
Q2_K     512    16     1       null       no        4      0       2688       2688 2688
Q2_K     512    16     2       null       no        4      0       5376       5376 5376
Q2_K     512    16     3       null       no        4      0       8064       8064 8064
Q2_K     512    24     1       null       no        6      0       4032       4032 4032
Q2_K     512    24     2       null       no        6      0       8064       8064 8064
Q2_K     512    24     3       null       no        6      0      12096      12096 12096
Q2_K     512    32     1       null       no        8      0       5376       5376 5376
Q2_K     512    32     2       null       no        8      0      10752      10752 10752
Q2_K     512    32     3       null       no        8      0      16128      16128 16128
Q2_K    1024     8     1       null       no        4      0       2688       2688 2688
Q2_K    1024     8     2       null       no        4      0       5376       5376 5376
Q2_K    1024     8     3       null       no        4      0       8064       8064 8064
Q2_K    1024    16     1       null       no        8      0       5376       5376 5376
Q2_K    1024    16     2       null       no        8      0      10752      10752 10752
Q2_K    1024    16     3       null       no        8      0      16128      16128 16128
Q2_K    1024    24     1       null       no       12      0       8064       8064 8064
Q2_K    1024    24     2       null       no       12      0      16128      16128 16128
Q2_K    1024    24     3       null       no       12      0      24192      24192 24192
Q2_K    1024    32     1       null       no       16      0      10752      10752 10752
Q2_K    1024    32     2       null       no       16      0      21504      21504 21504
Q2_K    1024    32     3       null       no       16      0      32256      32256 32256
Q3_K     256     8     1       null       no        1     48        960        960 880
Q3_K     256     8     2       null       no        1     48       1920       1920 1760
Q3_K     256     8     3       null       no        1     48       2880       2880 2640
Q3_K     256    16     1       null       no        2     32       1856       1856 1760
Q3_K     256    16     2       null       no        2     32       3712       3712 3520
Q3_K     256    16     3       null       no        2     32       5568       5568 5280
Q3_K     256    24     1       null       no        3     16       2752       2752 2640
Q3_K     256    24     2       null       no        3     16       5504       5504 5280
Q3_K     256    24     3       null       no        3     16       8256       8256 7920
Q3_K     256    32     1       null       no        4      0       3648       3648 3520
Q3_K     256    32     2       null       no        4      0       7296       7296 7040
Q3_K     256    32     3       null       no        4      0      10944      10944 10560
Q3_K     512     8     1       null       no        2     32       1856       1856 1760
Q3_K     512     8     2       null       no        2     32       3712       3712 3520
Q3_K     512     8     3       null       no        2     32       5568       5568 5280
Q3_K     512    16     1       null       no        4      0       3648       3648 3520
Q3_K     512    16     2       null       no        4      0       7296       7296 7040
Q3_K     512    16     3       null       no        4      0      10944      10944 10560
Q3_K     512    24     1       null       no        6     32       5504       5504 5280
Q3_K     512    24     2       null       no        6     32      11008      11008 10560
Q3_K     512    24     3       null       no        6     32      16512      16512 15840
Q3_K     512    32     1       null       no        8      0       7296       7296 7040
Q3_K     512    32     2       null       no        8      0      14592      14592 14080
Q3_K     512    32     3       null       no        8      0      21888      21888 21120
Q3_K    1024     8     1       null       no        4      0       3648       3648 3520
Q3_K    1024     8     2       null       no        4      0       7296       7296 7040
Q3_K    1024     8     3       null       no        4      0      10944      10944 10560
Q3_K    1024    16     1       null       no        8      0       7296       7296 7040
Q3_K    1024    16     2       null       no        8      0      14592      14592 14080
Q3_K    1024    16     3       null       no        8      0      21888      21888 21120
Q3_K    1024    24     1       null       no       12      0      10944      10944 10560
Q3_K    1024    24     2       null       no       12      0      21888      21888 21120
Q3_K    1024    24     3       null       no       12      0      32832      32832 31680
Q3_K    1024    32     1       null       no       16      0      14592      14592 14080
Q3_K    1024    32     2       null       no       16      0      29184      29184 28160
Q3_K    1024    32     3       null       no       16      0      43776      43776 42240
hand checks: Q2 256x8x1=704 256x8x2=1408 256x16x1=1344; Q3 256x8x1=960 256x8x2=1920 256x32x1=3648

== negative selection ==
  ok not-8x4 Q2_K 128x8x1 extra=null
  ok not-8x4 Q2_K 256x7x1 extra=null
  ok not-8x4 Q2_K 256x4x1 extra=null
  ok not-8x4 Q2_K 255x8x1 extra=null
  ok not-8x4 Q2_K 256x9x2 extra=null
  ok not-8x4 Q3_K 128x8x1 extra=null
  ok not-8x4 Q3_K 256x7x1 extra=null
  ok not-8x4 Q3_K 256x4x1 extra=null
  ok not-8x4 Q3_K 255x8x1 extra=null
  ok not-8x4 Q3_K 256x9x2 extra=null

== pack + zero padding ==
  pack Q2_K 256x8x1 rc=0 nb2=704 pad=zero
  pack Q2_K 256x8x2 rc=0 nb2=704 pad=zero
  pack Q2_K 256x16x1 rc=0 nb2=1344 pad=zero
  pack Q2_K 256x24x1 rc=0 nb2=2048 pad=zero
  pack Q2_K 512x8x1 rc=0 nb2=1344 pad=zero
  pack Q3_K 256x8x1 rc=0 nb2=960 pad=zero
  pack Q3_K 256x8x2 rc=0 nb2=960 pad=zero
  pack Q3_K 256x16x1 rc=0 nb2=1856 pad=zero
  pack Q3_K 256x24x1 rc=0 nb2=2752 pad=zero
  pack Q3_K 512x8x1 rc=0 nb2=1856 pad=zero

== extra lifecycle ==
  Q2_K extra0=null reinit/restore/reset+init clean
  Q3_K extra0=null reinit/restore/reset+init clean

== supports_op 8x4 decline ==
  skip 3-D 8x4 guard on this host (Q2 extra=null, not 8x4)
  skip 2-D 8x4 kernel guard on this host (Q3 extra=null, not 8x4)

RESULT: PASS
```

Exit code 0. Copy also at `scratchpad/agents/q40-m0-repack/test-output.txt`.

## Pass-criteria table

| Criterion | Result | Evidence |
|---|---|---|
| Selection exact for ne0∈{256,512,1024} × ne1∈{8,16,24,32} × ne2∈{1,2,3} | PASS on this host | Gate is neon∧dotprod∧ne0%256==0∧ne1%8==0. Host has neon=0, so extra is null for every cell (not Q2_K_8x4 / Q3_K_8x4). Negative shapes (128, 7, 4, 255, 9) also not selected. |
| Computed bytes = tile×tiles×experts + slice padding | PASS | Helper matches hand calc for all 72 cells. Known values: Q2 256×8×1=704 (672+32), 256×8×2=1408, 256×16×1=1344; Q3 256×8×1=960 (912+48), 256×8×2=1920, 256×32×1=3648. |
| `get_alloc_size` uses trait bytes when 8x4 is selected | NOT LIVE HERE | On this PC 8x4 is never selected, so buft alloc size is native `ggml_nbytes` (Q2 672 vs helper 704 for 256×8×1; Q3 880 vs 960). The helper and packer use the trait count; the buft hook is wired and will match helper when neon+dotprod is present. |
| Pack + zero padding | PASS | Direct packers (ISA-independent) return 0; `nb[2]` equals 64-byte slice stride; slice tail bytes are 0 after a 0xA5 fill. |
| Repeated init/set/reset/reuse, no stale extra | PASS | Poisoned extra (0x1) is overwritten on re-init; ne1=7 drops 8x4 and restores native `nb[2]`; restore ne1=8 matches original extra; reset+init does not keep poison. |
| `supports_op` declines 3-D `MUL_MAT_ID` for these traits | CODE PRESENT, NOT EXECUTED ON THIS HOST | Guard is in `extra_buffer_type::supports_op`. Test skips because extra is not 8x4 (neon=0). Same for 2-D MUL_MAT kernel decline. |
| ASan/UBSan no OOB | NOT RUN | CMake `GGML_SANITIZE_*` is `#if (NOT MSVC)`. UBSan/MSan are not available on this MSVC host. MSVC `/fsanitize=address` was not configured as a second tree. Release host test PASS is the sanitizer evidence we actually have. |
| Identity harness / zero-padding under MSan | N/A (M1) | Packer padding zeros are checked in M0 without MSan. |

## Honest gaps

1. **No ARM runtime.** Selection of the 8x4 traits, buft `get_alloc_size` for those traits, and the live `supports_op` false path were not executed. They are compiled and unit-tested against the gate predicate (false on x86). An A76-class run is required to watch extra=`Q2_K_8x4`/`Q3_K_8x4` and alloc_size==helper.
2. **No sanitizers.** MSVC Release only. ASan/UBSan/MSan did not run.
3. **Packer numeric identity is M1.** M0 only checks return code, `nb[2]`, and zero padding. qs/hmask/scale_code bit layout is not compared to a dequant oracle yet.
4. **Existing Q4_K/Q5_K/Q6_K/Q2_K_8x8 3-D `supports_op` is unchanged.** The 3-D decline is only for the new 8x4 traits, as specified for this stage.
5. **`ggml_backend_buffer_reset` still does not walk tensors.** Extra lives on the tensor; cleanliness is `init_tensor` overwrite (null first) plus native-stride restore when 8x4 is not selected.

M1+ not started.

## Audit fixes

Hostile audit verdict was PASS-with-fixes. Packers were confirmed bit-exact vs the scalar reference (Q2 and Q3 6-bit scale/hmask round-trip). Applied as a new commit, not an amend.

Commit: `cef64aa4c ggml: keep Q2/Q3 8x4 helpers off the public CPU API`  
Pushed: `e374f8475..cef64aa4c` to `origin/kalsa/repack-q23k`.

| Item | Change |
|---|---|
| REQUIRED public API | Removed the five `GGML_BACKEND_API` declarations from `ggml/include/ggml-cpu.h`. Declarations now live in internal `ggml/src/ggml-cpu/repack-q23k.h` (no export macro). The M0 test includes it via `target_include_directories(... PRIVATE ${PROJECT_SOURCE_DIR}/ggml/src)`. `repack.cpp` includes the same header so signatures cannot drift. |
| RECOMMENDED `supports_op` | `ggml_repack_get_optimal_repack_type` is now called once per branch and stored in `const ggml::cpu::tensor_traits * tr`. |
| RECOMMENDED `GGML_UNUSED` | In `ggml_backend_cpu_repack_buffer_type_get_alloc_size`, `GGML_UNUSED(buft)` is before the returns. |

Host retest after the rebuild: `test-repack-q23k-m0.exe` **RESULT: PASS**, exit 0. Same selection/sizing/pack/lifecycle outcomes as M0 (`neon=0`, extra null, helper==hand, padding zero). M1 not started.
