# REPORT-vtcm-relayout — one-copy raw-row decode: can a VTCM relayout reach the tiled kernel's speed?

Engine `~/Projects/kalsallama-onecopy-hmx`, branch `spike/onecopy-hmx-raw`, base `df538c50c` (verified
before starting), three commits on top, **not pushed**. No device was used. Raw material:
`raw/vtcm-relayout/` (logs, asm, prototype, device scripts; raw dumps are not in the lab repo).

## Verdict (read this first)

1. **The tiled kernel's speed is NOT reached, and nothing here proves it can be.** A relayout in VTCM
   is the wrong tool on the evidence below: both relayouts I could build cost MORE packets than the
   raw dot they would replace (conversion to tiles + the tiled dot 192 Pcycles/tile; a 32-row word
   transpose + per-column dot 136.5; the raw dot 70.0; the tiled dot alone 84.3, all K 10752 under
   hexagon-sim). The DMA cannot do the transposition either (reasoned, not measured, §2).
2. **What is delivered instead** is a change aimed at the one instruction-set fact the sim does not
   charge: a double-vector multiply takes both multiply slots of its packet, and each row-window of the
   raw dot paid two of them plus two `vrmpy`. Two rows now share the scale multiply (6 → 5 multiply
   slots per row-window, −17 %), **bit-identical** to `df538c50c` (120 cases, §4). Whether the S23
   cares is the open question; the S23 gets three extra arms to answer it (§8). If the multiplier is
   the limiter the prediction is ~17.9 tok/s tg128 (15.6 → +15 %); if not, 15.6 ± noise. Tiled speed
   (22.1) is not predicted by anything here.
3. **Side result, fixed:** the `-p 32 -n 2` `INTERNAL-ERROR` abort is a host/DSP VTCM mismatch in the
   raw HMX path (not this kernel): the host solved 32-row chunks for the single-buffer layout, the DSP
   forces the double-buffered one (§5).
4. **Sim cycles did NOT predict the silicon gap** (it priced the per-row dot at 0.87× the tiled dot;
   the S23 measured ~1.5×). Every sim figure below is a packet count / sanity check, not a speed claim.

## 1. Engine state

| commit | what |
|---|---|
| `6a6ec8678` | raw Q4_0 HMX chunks solved for the pipelined layout at 32 rows (`-p 32` fix) + host test `tests/test-hexagon-hmx-raw-fit.c` |
| `23178fb24` | raw-row dot: two rows share the scale multiply; per-row dot kept as `RAWROW_PROBE=8`; gate extended |
| `7e4945582` | diagnostic dots `RAWROW_PROBE=16` (integer stage only) and `32` (float tail only); gate checks |

Artifacts (`build-onecopy-hmx-fused-v73`, built from the tree of `7e4945582`; docker recipe in §7):

| artifact | sha256 |
|---|---|
| `bin/llama-bench` (75,041,416 B) | `ca9086268b1b53ecc49b65f6d23dc049485c4ff19e0512450fbc8d5dddd66f77` |
| `bin/llama-perplexity` (99,577,120 B) | `43d8d829134dd042a5c21d7f84cf2a0e4970d8d2f76ed30ef4d5305d6f9241d1` |
| `ggml/src/ggml-hexagon/libggml-htp-v73.so` (849,000 B, Hexagon DSP6) | `717d26227240adfd773438d65c79316f3ecc350e8b6f11eb9a435217def29a71` |
| `ggml/src/ggml-hexagon/libggml-hexagon.a` (host backend, static, linked into both binaries) | `5488eee1a262f8dd150f27906a300801ac791ced97ea0af82866f642a67ec7c7` |

Skel and host binaries are a pair (the DSP expects this build's admission and probe handling); `df538c50c`'s
pair on the phone is `5bcb3f74…` / `b357d834…` / `2808f70f…` (ABBA report).

## 2. Why not a VTCM relayout (evidence)

Steady Pcycles per tile (32 rows × 32 elements) from `tests/hexagon-sim/run-raw-mv-bench.sh`, K 10752
(`raw/vtcm-relayout/bench-*.log`); packets = Pcycles / 3.0 (measured, §3):

| work | Pcycles/tile | packets/tile |
|---|---:|---:|
| tiled decode dot (the two-copy decode) | 84.3 | 28.1 |
| raw dot, `df538c50c` | 69.9 | 23.3 |
| raw dot, paired (this tree) | 70.0 | 23.3 |
| raw dot, per row (this tree, recompiled: other codegen, same arithmetic) | 73.2 | 24.4 |
| HVX tile conversion + tiled dot (`c5a218321`: measured 11.8 tok/s on the S23) | 192–195 | ~64 |
| prototype: 32-row word transpose (5 vshuff stages) + per-column dot | **136.5** | 45.5 |
| — its transpose + loads alone | 88.8 | |
| — its dot alone (transposed data) | 78.4 | |
| diagnostic: integer stage only / float tail only | 38.7 / 39.8 | |

- The column-dot prototype (`raw/vtcm-relayout/prototype-column-dot/`, bit layout verified by a probe:
  five `vshuff` stages with a word granule give vector = column, lane = row) was the cheapest honest
  attempt at "lane = row, so the float tail is paid once per block per 32 rows, as in the tiled dot". It
  is 1.9× the raw dot in the sim (45.5 packets/tile; 32 unaligned loads + 80 shuffles + spills per
  window), so it was dropped from the tree. It is kept in the lab together with its tree diff.
- DMA-side relayout (2-D descriptors producing aligned quants and a separate scale array or tile words)
  was **not built**: the tile needs 4-byte units gathered across 32 rows (stride 18·n_k), the block
  quants need 16-byte units out of 18-byte blocks; the DMA would run at 4/16-byte width instead of
  the 576-byte rows the tiled path moves at the DMA floor. That reasoning is not a measurement.
- Alignment of the raw loads was not touched: the rewritten reader (`81c0d6ff5`) issues the same 32
  unaligned 128-byte loads per window and matched its sim estimate on silicon (reader 97.3 ms vs tiled 81.1 ms
  on the S23 = 1.20×; the sim said 190 vs 162 Pcycles = 1.17×), so unaligned VTCM loads are not the suspect.
- Padding each row's DMA destination to 128 bytes would not align the dot's loads (windows advance
  126 bytes); the 9-phase aligned alternative has more ops per vector, so it was not built.

## 3. The sim vs the silicon (measured facts, then one fit — read the caveat)

Measured under hexagon-sim v73 (`raw/vtcm-relayout/*.log`):
- **Pcycles = 3.0 × packets** for the tiled, per-lane and column dots (28.1 / 24.4 / 45.5 packets per tile
  ↔ 84.3 / 73.2 / 136.5 Pcycles). Whatever a packet holds, it costs the same.
- Four hardware threads running the same dot take as long as one (wall Pcycles per pass 30,330 tiled,
  26,736 per-lane, 48,243 column, identical at 1, 2 and 4 threads; with 6 threads the last two wait for a
  vector context: 82,406 / 53,466 / 116,245). The simulated threads share no vector unit.

So the sim cannot show a shared-unit effect. The hexagon-sdk intrinsics header says which instructions
take which slots (`Instruction Type` / `Execution Slots` per intrinsic): `vrmpy` = `CVI_VX` (1 of the
2 multiply slots, SLOT23); `Wqf32 = vmpy(hf,hf)` and `Vqf32 = vmpy(sf,sf)` = `CVI_VX_DV` (both slots);
the conversions and `vadd qf32` are `CVI_VS` (any slot). Counting multiply slots per tile: per-lane dot
27.4, tiled dot 12, paired dot 22.9.

**Post-hoc fit, not a finding.** The S23 numbers are: one-copy Q4_0 matvec ≈ 50 ms/token (MUL_MAT 54.7 −
q6_K 4.8), two copies ≤ 33 ms (the DMA floor, 32.3 = P1 44.4 − 12.1 non-matvec), `c5a218321`'s conversion +
tiled dot ≈ 70 ms (11.8 tok/s). With 2.378 M tiles/token (1306.12 MiB / 576 B) and t = max(packets/Cp,
multiply-slots/Cv): Cp ≈ 2.03 G packets/s, Cv ≈ 1.30 G slots/s reproduce all three (50 / 33 / 75 vs 70).
Three points, two parameters: it motivates the experiment below and proves nothing. Under it the paired
dot (22.9 slots/tile → 41.9 ms) saves 8.2 ms/token → 56.0 ms → **17.9 tok/s**; each diagnostic half runs
below the DMA floor and should read ~22.5 tok/s. Reading the device arms against that prediction is
the point of the change.

## 4. What changed, and the proof it computes the same bits

- `htp/q4_0-raw-mv-hvx.h`: `enum raw_mv_mode` (:28), `raw_mv_pair_terms` (:62), `raw_mv_add_window` (:73),
  `raw_mv_32x1_impl` (:110), `RAW_MV_DOT` instances (:161-171): `q4_0_raw_mv_32x1` (paired, default),
  `_per_row`, `_int_only`, `_fp_only`. Rows a/b of a pass: vdelta with the even control / the new odd
  control, one `vmux`, one `Wqf32` multiply, lo half = a, hi half = b.
- `htp/q4_0-raw-mv-geometry.h:40` `raw_mv_scale_fanout_odd`, generated by `tests/hexagon-sim/solve-raw-mv-fanout.py`
  (now prints both tables; routable).
- `htp/q4_0-raw-mv-act.h:34` the activation scale is stored in both halfwords of a lane (one 32-bit
  store; window layout and size unchanged at 512 B, so no VTCM budget or admission change).
- `htp/matmul-ops.c:870-884,1695` four instances of the matvec + `hvx_mv_2d_raw_q4_0_for(probe)`;
  `htp/matmul-ops.h:111-115` probe bits 8/16/32 and `HTP_MM_RAW_ROW_PROBE_DOT_MASK`;
  `ggml-hexagon.cpp:7494-7499` parser: bits 1/2/4 plus at most ONE of 8/16/32, else the existing WARN +
  probe 0. Probes 1 (skip dot), 2 (reuse slots), 4 (no l2fetch) keep their meaning on all dots.
- Final skel, instruction counts per matvec function (`hexagon-llvm-objdump -d`, then `qf32 = vmpy(hf,hf)` /
  `vmpy(sf,sf)` / `vrmpy` / `vmux`) and stack frame:

  | function | hf mpy | sf mpy | vrmpy | vmux | `allocframe` |
  |---|---:|---:|---:|---:|---:|
  | `hvx_mv_2d_raw_q4_0` (paired) | 6 | 12 | 24 | 6 | 0x500 = 1280 B |
  | `…_per_row` | 12 | 12 | 24 | 0 | 0x400 |
  | `…_int_only` | 0 | 0 | 24 | 0 | 0x280 |
  | `…_fp_only` | 6 | 12 | 0 | 6 | 0x300 |

  The halving of the half × half multiplies is in the binary. The worker-stack chain of the earlier report
  (≤ 6919 B of 16384) was not re-measured; the default dot's frame is 256 B larger than the per-row one.

Bit identity: `df538c50c`'s own headers (renamed copy, produced with the sed at the end of §7) against the paired and the per-row dot, same raw rows, same arranged activations: **120
cases (8 shapes × 5 row counts × random / d=1 / edge-scale data), bit-identical** (`old-vs-new-bits.log`,
scratch harness `zz-old-vs-new.c`, not in the tree). Hence the S23 KLD must equal `df538c50c`'s to every
digit: 0.004608 ± 0.000243, max 0.042651, same top p 97.059 ± 0.749 %, mean PPL(Q) 33.920876.
(The "KLD must not get worse" gate is met by construction: same bits. A lane-per-row design, such as the
column-dot prototype, associates the float tail differently and could not have kept it.)

## 5. `-p 32 -n 2` → `dsp-rsp INTERNAL-ERROR` → GGML_ABORT: cause and fix

Not the raw-row kernel: the 32-row **HMX** raw path. `htp_mm_hmx_pipeline(m)` was `m > 32`, so the host
solved the chunks (`htp_mm_hmx_solve_2d_params`) for the single weight buffer at m = 32, but
`hmx_mm_2d_f32` forces `pipeline = 1` for raw weights (`matmul-ops.c:2691`) and rebuilds the layout with
two buffers on the same chunks; `vtcm_used > vtcm_budget` returns −1 (`:2742`) →
`HMX matmul failed` (`:3830`) → `HTP_STATUS_INTERNAL_ERR`. Using the real header functions on the model's
shapes (thread counts 4 and 6): ffn_gate/up/down, in_proj and out_proj/attn_q/attn_output at m = 32 need
14.5–15.7 MiB against 8 MiB (only attn_k/v, N 512, fit); m = 33, 64, 128, 512 are unaffected. pp512 (m > 32) and decode (m = 1,
below the default offload min batch) never reached it.

Fix (`6a6ec8678`): the predicate takes the weight's rawness (`htp_mm_hmx_pipeline(m, raw)`), the host passes
`ggml_hexagon_is_raw_weight(src0)` (`ggml-hexagon.cpp:4480`). `tests/test-hexagon-hmx-raw-fit.c`
(`cc -std=c11 -O1 -Wall -Wextra -Iggml/src/ggml-hexagon -Iggml/src/ggml-hexagon/htp tests/test-hexagon-hmx-raw-fit.c
-o build-host/test-hmx-raw-fit`): EXIT=0 ALL PASS, and with the old rule substituted EXIT=1 (8 solves
overflow). **Host-only**: the device run of `-p 32 -n 2` is in `device/check.sh`.

## 6. Hexagon-sim gate, exit codes

All run in the toolchain container (`tests/hexagon-sim/*.sh`), final tree:

| command | exit | verdict lines |
|---|---:|---|
| `run-raw-mv.sh` | 0 | 5 × `ALL PASS`, `ALL LOADS IN PAYLOAD`; 170 `ok`, 0 `FAIL` |
| `run-raw-mv.sh --negative-control 1..10` | 1 each | each fails for its own reason (checked in the logs, no compile error); 6 = the documented abort of the aligned-source copy; 3/9/10 also trip the new diagnostic check |
| `run-raw-mv-bench.sh` | 0 | table above |
| `run-raw-reader.sh`, `run-raw-tiles.sh` (untouched code, regression) | 0, 0 | `ALL PASS` |
| host `test-hexagon-hmx-raw-fit.c` | 0 | `ALL PASS` |

New in the gate: both fan-out controls vs the geometry; the arrangement model with both halfwords; **paired ==
per-row bit for bit on all 80 numeric cases**; edge/tail/over-read for every dot (the diagnostic ones for
tail and loads only); a check that each diagnostic dot computes something else; controls 9 (odd table
corrupted), 10 (halves swapped), 8 kept valid (its old headers get the odd table and odd halfwords appended).
The existing negative controls' text edits (`sed` on copies of the headers) were re-run, not assumed.

## 7. Build

```
docker run --rm --platform linux/amd64 -u 501:20 -v ~/Projects/kalsallama-onecopy-hmx:/workspace -w /workspace \
  ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c \
  'cmake --build build-onecopy-hmx-fused-v73 -j1 --target htp-v73 llama-bench llama-perplexity; echo "INNER EXIT=$?"' \
  > /tmp/build.log 2>&1; echo "DOCKER EXIT=$?"
```
qaic was not re-run (ninja only recompiled `matmul-ops.c.obj` for the skel and relinked). Built with `-j2` the
first time (exit 0, `INNER EXIT=0`, the tree of `23178fb24`); after the diagnostic commit the skel and
`llama-bench` linked, but `llama-perplexity`'s LTO link was `Killed` twice while another session's container
(`kalsallama-htpfix`, `-j nproc`) shared the docker daemon's 7.7 GB; `-j1` once the daemon was idle linked it
(`INNER EXIT=0`, `DOCKER EXIT=0`). The hashes in §1 are of those final files; `git status` is clean (HEAD
`7e4945582`) and no source file is newer than the skel.
Renamed-old-header recipe for the bit-identity harness:
`git show df538c50c:ggml/src/ggml-hexagon/htp/<geometry|act|hvx>.h | sed -E -e 's/Q4_0_RAW_MV/OLD_Q4_0_RAW_MV/g' -e 's/raw_mv_/old_raw_mv_/g' -e 's/[[:<:]]RAW_MV_/OLD_RAW_MV_/g' -e 's/q4_0_raw_act_windows/old_q4_0_raw_act_windows/g' -e 's/#include "q4_0-raw-mv-/#include "old-q4_0-raw-mv-/'`.

## 8. Device re-run for the coordinator (S23 only; scripts in `raw/vtcm-relayout/device/`)

Unplugged, screen on, thermal 0, `persist.traced.enable 0`, one phone session, never a second one.
Push as a PAIR into a NEW dir (the skel and the host binary must come together):

```
ADB="adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"       # or the 192.168.1.152:<port> endpoint if mDNS is stale
B=~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73; S=~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-hmx-numerics/raw/vtcm-relayout/device
$ADB shell 'mkdir -p /data/local/tmp/govhtp/onecopy-pair/bin /data/local/tmp/govhtp/onecopy-pair/dsp'
$ADB push $B/bin/llama-bench $B/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-pair/bin/
$ADB push $B/ggml/src/ggml-hexagon/libggml-htp-v73.so /data/local/tmp/govhtp/onecopy-pair/dsp/
$ADB push $S/env.sh $S/run-arms.sh $S/check.sh /data/local/tmp/govhtp/onecopy-pair/
$ADB shell 'sha256sum /data/local/tmp/govhtp/onecopy-pair/bin/* /data/local/tmp/govhtp/onecopy-pair/dsp/*'      # must equal the table in §1
```

1. Correctness first (plugged is fine): `$ADB shell '. /data/local/tmp/govhtp/onecopy-pair/env.sh; . $D/check.sh'`, then read
   `$D/check.txt`. Expect: one-copy KLD **equal to every digit** to 0.004608 / 0.042651 / 97.059 % / 33.920876 (two
   copies 0.005313 / 0.094590 / 97.059 % / 33.994233); the `RAWROW_PROBE=8` KLD equal to the default's;
   `-p 32 -n 2` EXIT=0, no `INTERNAL-ERROR`; `RAWROW_PROBE=24` refused with the WARN; tg32 profile 10,956
   `hvx-rawrow` and 0 `hvx-flat`.
2. Speed ABBA (~35 min, unplugged, battery temp ≤ 33.0 °C at each arm start — `waitcool` enforces it):
   `$ADB shell '. /data/local/tmp/govhtp/onecopy-pair/env.sh; . $D/run-arms.sh'`, then `$D/speed.txt`
   (per-arm gates before/after, error grep). Arms: **T** two copies, **O** the `df538c50c` binaries
   (already on the phone, `onecopy-abba`), **N** new default, **L** `RAWROW_PROBE=8` (same binary, the
   dot before pairing), **I** `=16` integer stage only, **F** `=32` float tail only, **S** `=1` dot skipped
   (floor ≈ 22.5). Order T O N L I F S S2 F2 I2 L2 N2 O2 T2.

How to read it (tg128, mean of the two sides):
- **N − L** is the pairing effect. ≈ +2.3 tok/s (→ ~17.9) = multiply-slot limited as predicted; ≈ 0 = it is not,
  the model in §3 is wrong and the cost is elsewhere in the dot.
- **O ≈ L ≈ 15.6** reconfirms the baseline (the per-row arm is recompiled code, 73.2 vs 69.9 Pcycles in the sim:
  if L < O by a few %, that is codegen, not pairing).
- **I and F against S** (dot cost of each half = 1/t − 1/t_S in ms/token): each near S (22.5) while N is far
  below = the halves overlap fine alone and interact (a shared-resource / dependency effect of the whole);
  one half far below S = that half is the silicon cost (I: loads, nibble split, `vrmpy`; F: scale fan-out,
  double-vector multiplies, conversions) and the next change goes there; I + F ≈ N − S additive = plain compute.
- pp512 must stay 856–862 in every one-copy arm (the probes did not leak into prefill, as in the last ABBA).

## 9. Could not verify

- Everything silicon: the speed of N/L/I/F, the `-p 32` fix, the KLD (predicted identical by the sim proof, not run),
  the dspqueue/worker stack chain with the 256-byte larger frame.
- That Cv/Cp in §3 mean anything. The sim cannot test them; only the device arms can.
- The DMA-side relayout ideas (not built). Any design that lowers both packets (≤ ~28/tile) and multiply slots
  (≤ ~17/tile) would meet the model's DMA floor; I found none in the raw layout (lane-per-block needs the
  transpose, which costs 45 packets/tile).
- Process note: another session's container (`kalsallama-htpfix`, `-j nproc`) shared the docker daemon;
  my `llama-perplexity` LTO link was OOM-killed twice while it ran, hence the `-j1` retry above.
- The "host lib": with `BUILD_SHARED_LIBS=OFF` the hexagon host backend is the static `libggml-hexagon.a`
  linked into both binaries (hash in §1); there is no separate host `.so` in this build dir.
