# HTP prefill vs `no_kv_offload` — QDC Snapdragon 8 Elite Gen 5 (SM8850 MRD, Hexagon v81), 2026-10-02

Repeat of `REPORT-qdc-8elite.md` (8 Elite, v79) on the next generation. **Board caveat: v81, not the S23's v73.**
Nothing here transfers to v73 or to v79 by itself; the v79 comparison below is cross-board and cross-session.

## Answer

**Same result as v79, slightly stronger.** With the KV cache on the host (`-nkvo 1`, attention on the CPU) the cost
of a 128-token chunk grows with context: A 117 → 859 ms from depth 0 to 3100. With the KV on HTP (`-nkvo 0`) it
is almost flat: B 82 → 98 ms. B/A is 1.43× at depth 0, 2.30× at 512, 5.27× at 1.7k and 8.79× at 3.1k. The
shipping app KV (C, V q4_0, `-nkvo 1`) is again the slowest arm: B/C 9.91× at 3.1k.

## Setup

- Session: QDC interactive **860923**, "SSH only", cap 35 min; account aspis; device `f5139b8f`
  (`Canoe for arm64`, `ro.soc.model` = **SM8850**, 8 cores, Android 16 per the session page; the wizard's device
  step said Android 17). Tunnel to local adb port 6037. Started 23:59:26, ended 00:12:10 (EDT): **12 min 44 s of
  runtime**.
- DSP arch read on the board, not assumed: `ggml-hex: Hexagon Arch version v81, DMA64 enabled`, and the HTP
  session opened `uri file:///libggml-htp-v81.so?…_dom=nsp1000` (every `*.excerpt.txt`).
- Kit `~/kalsa-qdc/kit-5b596ce43` (engine kalsallama 5b596ce43), `libggml-htp-v81.so` sha `8585c812…40cd`.
  Model LFM2.5-2.6B-QAD-Q4_0.gguf, sha256 `a247afd6…8d40b03`. The driver's sha check (fixed in 131db579 to fail
  on missing lines) printed `STAGE_SHAS_OK` for llama-bench, llama-completion, the v81 skel and the model
  (`session-events.log`).
- Driver: lab 131db579, `run_bench.py --adb-port 6037 --dsp-arch v81 --stage all --deadline-minutes 25`
  (dry-run first: EXIT 0). Real run EXIT 0, `STAGE_END all error=None` (`driver-stdout.txt`).
- `llama-bench -ngl 99 -dev HTP0 -p 128 -n 0 -b 128 -ub 128 -t 5 -fa auto --no-warmup -d 0,512,1700,3100 -r 3`.
  - A = `-ctk q8_0 -ctv q8_0 -nkvo 1`
  - B = `-ctk q8_0 -ctv q8_0 -nkvo 0`
  - C = `-ctk q8_0 -ctv q4_0 -nkvo 1`
- Difference from the v79 run: every number below comes from the driver's gated **clean** run (no `-v`, no
  verbose env), after a gated verbose route-proof run of the same arm. Nothing was run by hand.

## Results: clean timing, n = 3 reps per cell

ms/chunk = 128000 / tok/s; sd is llama-bench's ± over 3 reps, carried to ms proportionally.
Source: `raw/qdc-8elite-gen5-860923/tables.txt` (computed from the three `*-clean.log`; same values in `bench.tsv`).

| arm | depth | pp128 tok/s ± sd | ms / 128-tok chunk ± sd | raw file |
|---|---:|---:|---:|---|
| A nkvo=1 q8/q8 | 0 | 1089.5 ± 302.0 | 117.5 ± 32.6 | A-nkvo-clean.log |
| A | 512 | 641.6 ± 32.9 | 199.5 ± 10.2 | 〃 |
| A | 1700 | 260.9 ± 11.4 | 490.6 ± 21.4 | 〃 |
| A | 3100 | 148.9 ± 3.6 | 859.4 ± 20.7 | 〃 |
| B nkvo=0 q8/q8 | 0 | 1555.0 ± 69.7 | 82.3 ± 3.7 | B-offload-clean.log |
| B | 512 | 1475.9 ± 48.2 | 86.7 ± 2.8 | 〃 |
| B | 1700 | 1374.9 ± 71.9 | 93.1 ± 4.9 | 〃 |
| B | 3100 | 1309.0 ± 41.7 | 97.8 ± 3.1 | 〃 |
| C nkvo=1 q8/q4 (app) | 0 | 1168.8 ± 313.1 | 109.5 ± 29.3 | C-app-vq4-clean.log |
| C | 512 | 625.1 ± 8.4 | 204.8 ± 2.8 | 〃 |
| C | 1700 | 247.2 ± 4.0 | 517.9 ± 8.5 | 〃 |
| C | 3100 | 132.0 ± 8.2 | 969.5 ± 60.1 | 〃 |

| depth | B/A tok/s | C/A tok/s | B/C tok/s |
|---:|---:|---:|---:|
| 0 | 1.43 | 1.07 | 1.33 |
| 512 | 2.30 | 0.97 | 2.36 |
| 1700 | 5.27 | 0.95 | 5.56 |
| 3100 | 8.79 | 0.89 | 9.91 |

**Slope of ms/chunk vs depth** (OLS over the 4 depths; source: tables.txt):

| arm | ms per 1k context tokens | intercept ms | v79 slope (REPORT-qdc-8elite.md) |
|---|---:|---:|---:|
| A | 242.9 | 94.2 | 247.9 |
| B | **4.9** | 83.5 | 7.7 |
| C | 280.0 | 78.6 | 313.0 |

B flattens the growth about 50× against A and 57× against C. The host-attention slope (A, C) is nearly the same
on v81 as on v79: it is CPU-side cost, and it does not shrink with the newer NPU. Only B, the HTP path, got faster
(intercept 83.5 vs 92.6 ms, slope 4.9 vs 7.7). So the gap the app loses widens on the newer chip.

## Route and placement proofs

The driver gate (`HTP0 model buffer size` + `HTP0 execute-op` + `libggml-htp-v81.so` + the arm's KV side) passed
for all 3 route runs and both profile runs (`CLI_OK` lines in `session-events.log`). Evidence lines and
execute-op counts are in `raw/qdc-8elite-gen5-860923/<arm>-{route,profile}.excerpt.txt`:

- All arms: `load_tensors: HTP0 model buffer size = 1525.87 MiB` (CPU 205.08 MiB = token embeddings);
  `Hexagon Arch version v81`; session uri `file:///libggml-htp-v81.so`.
- **KV placement**: A route `CPU KV buffer size = 2.12 MiB`; B route `HTP0 KV buffer size = 2.12 MiB`;
  C route `CPU KV buffer size = 1.62 MiB` with `K (q8_0): 1.06 MiB, V (q4_0): 0.56 MiB` (so C really is the
  q4_0 V arm). Profile runs (depth 1700, 2048 cells): A `CPU KV buffer size = 17.00 MiB`, B `HTP0 … 17.00 MiB`.
- `HTP0 execute-op` line counts: route A 425, B 515, C 425; profile A 6346, B 7388.
- **Scheduler placement** (`GGML_SCHED_DEBUG=2`, depth 1700; `profile-summary.txt`):
  - A: FLASH_ATTN 128 nodes on **CPU**, plus CPY 704, SET_ROWS 256, SCALE 352, GET_ROWS 720 on CPU.
  - B: FLASH_ATTN 128, CPY 704, SET_ROWS 256, SCALE 352 all on **HTP0**; only 16 GET_ROWS on CPU.
  - MUL_MAT 3184, SSM_CONV 352, RMS_NORM 1232 nodes on HTP0 in both arms.
- HTP execute counts (`*-profile-placement.txt`): FLASH_ATTN_EXT 120, SET_ROWS 240, CPY 330 on HTP in B; none
  of them on HTP in A.

## Per-op HTP profile (`GGML_HEXAGON_PROFILE=1`, depth 1700, r = 1)

Same caveat as v79: whole run = 1700-token fill + the timed chunk (15 ubatches × 8 attention layers = 120
FLASH_ATTN_EXT calls). Shares exclude `OPBATCH`. Source: `profile-summary.txt`.

| op on HTP | A µs | B µs | B share |
|---|---:|---:|---:|
| MUL_MAT + MUL_MAT_NX | 648084 | 703791 | 63.4 % |
| FLASH_ATTN_EXT | — (CPU) | 107250 | 9.7 % |
| SWIGLU | 114888 | 120235 | 10.8 % |
| ADD + MUL + SSM_CONV + CONCAT + ROPE | 150267 | 157798 | 14.2 % |
| CPY + SET_ROWS + GET_ROWS + SCALE | 278 | 21238 | 1.9 % |
| total excl. OPBATCH | 913517 | 1110312 | |

Reading: HTP FLASH_ATTN_EXT costs 107 ms over the 120 calls (≈0.9 ms per call, v79: ≈1.3 ms). MUL_MAT is 8.6 %
higher in B than in A here (v79: within 0.5 %); r = 1, one run each, so I do not read anything into that.
`OPBATCH` call counts are 465 in A against 15 in B, identical to v79: the host-KV graph is cut into ~31× more
HTP batches per run, which is the extra host↔HTP round trips. That is my reading of the record, not verified in
the backend source.

## Caveats (do not skip)

1. **v81, not v73.** The S23 repeat is still open.
2. **B's numerical correctness is NOT checked** (no output/PPL/KLD comparison). Same gate as on v79 before shipping.
3. **B is not the app's config**: the app ships V q4_0, which HTP SET_ROWS cannot write (PLAN.md).
4. `-t 5` fixed; the app's thread count changes A and C.
5. Depth 0 spread is large in A (±302 tok/s) and C (±313): the depth-0 ratios are weak. The A and C depth-0
   reps run first right after model load; the deeper cells are tight.
6. Thermal: skin 33.5–41.8 °C over 28 gated snapshots, Thermal Status 0 throughout, all plug flags false. The
   `battery_temp_c` 45.0 / level 100 are constant across the run (rack battery stub, not a measurement).
   `awake` was false (SSH-only, no screen; irrelevant to a CLI bench). `persist.traced.enable` = 1 on this board
   (the S23-only gate does not apply).
7. 120 s cool-down between arms (skin was 33.5–34.4 °C at each arm start).

## QDC minutes

- Gen 5 card before the session: **1000 min remaining**.
- Right after End Session: **965** (−35 = the cap: provisional hold per memory `qdc-bills-the-requested-cap`;
  actual runtime 12 min 44 s). Re-read the card later for the settled number. "Total Minutes Used" read 0.
- The card showed "Unavailable" right after ending (unit cleanup).

## Files

`raw/qdc-8elite-gen5-860923/`: tables.txt, profile-summary.txt, bench.tsv, session-events.log,
driver-stdout.txt, remote-listing.txt, cleanup.txt (device dir removed), the three `*-clean.log`, the five
verbose-log excerpts, two placement summaries. Full verbose logs (1.7–11 MB each) are off-repo on the Mac at
`~/kalsa-qdc/htp-kv-860923-full/logs/`.
