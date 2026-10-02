# HTP prefill vs `no_kv_offload` — QDC Snapdragon 8 Elite (QRD8750, Hexagon v79), 2026-10-01

**Board caveat first: this is the 8 Elite (Hexagon v79), NOT the Galaxy S23's 8 Gen 2 (v73).** The S23 repeat
comes later; nothing below transfers to v73 until it has been measured there.

## Answer

**Yes. On v79, keeping the KV cache on the host (`-nkvo 1`, attention pinned to the CPU) is what makes HTP
prefill slow down as context grows.** With the same q8_0/q8_0 KV and attention on HTP (`-nkvo 0`), the cost of a
128-token chunk is almost flat with context: 92 → 115 ms from depth 0 to 3100. With attention on the CPU it goes
111 → 878 ms. B/A is 1.20× at depth 0, 2.40× at 512, 4.81× at 1.7k and 7.61× at 3.1k. The shipping app config
(C, V q4_0, `-nkvo 1`) is the slowest arm: B/C is 9.35× at 3.1k.

The FLOP-based estimate in PLAN.md ("Research 2026-10-01": attention is about 2.7–4.8 % of a chunk's FLOPs, so the
suspect was WEAKENED) is contradicted by this measurement. The CPU attention path costs about 400 ms per chunk at
1.7k context, against about 10 ms of HTP FLASH_ATTN_EXT (see the profile below).

## Setup

- Session: QDC interactive 860914, "SSH only", cap 38 min; account aspis; device `ae7378cd` (`Sun for arm64`,
  `SM8750`, 8 cores, Android 16). Tunnel to local adb port 6037. Started 23:15:47, ended 23:22:49 (EDT), so 7 min
  of runtime.
- Kit `~/kalsa-qdc/kit-5b596ce43` (engine kalsallama 5b596ce43, see its PROVENANCE.txt). Model
  LFM2.5-2.6B-QAD-Q4_0.gguf, sha256 `a247afd6…8d40b03`. The device shas of the model, llama-bench and
  libggml-htp-v79.so were re-read by hand after staging. They match SHA256SUMS. The driver's own sha check passes
  on empty output, so it was not trusted alone.
- `llama-bench -ngl 99 -dev HTP0 -p 128 -n 0 -b 128 -ub 128 -t 5 -fa auto --no-warmup -d 0,512,1700,3100 -r 3`.
  - A = `-ctk q8_0 -ctv q8_0 -nkvo 1`
  - B = `-ctk q8_0 -ctv q8_0 -nkvo 0`
  - C = `-ctk q8_0 -ctv q4_0 -nkvo 1`

## Results: clean timing (no logging), n = 3 reps per cell

ms/chunk = 128000 / tok/s. sd is llama-bench's ± over 3 reps, carried over to ms proportionally.
Source: `raw/qdc-8elite-860914/tables.txt` ("clean" block).

| arm | depth | pp128 tok/s ± sd | ms / 128-tok chunk ± sd | raw file |
|---|---:|---:|---:|---|
| A nkvo=1 q8/q8 | 0 | 1149.2 ± 149.4 | 111.4 ± 14.5 | A-nkvo.attempt2-noverbose.log |
| A | 512 | 561.0 ± 3.3 | 228.2 ± 1.3 | 〃 |
| A | 1700 | 245.7 ± 1.8 | 521.0 ± 3.8 | 〃 |
| A | 3100 | 145.9 ± 0.7 | 877.6 ± 4.3 | 〃 |
| B nkvo=0 q8/q8 | 0 | 1384.0 ± 13.0 | 92.5 ± 0.9 | B-offload.clean-noverbose.log |
| B | 512 | 1343.9 ± 19.0 | 95.2 ± 1.3 | 〃 |
| B | 1700 | 1182.2 ± 22.5 | 108.3 ± 2.1 | 〃 |
| B | 3100 | 1109.9 ± 6.7 | 115.3 ± 0.7 | 〃 |
| C nkvo=1 q8/q4 (app) | 0 | 1188.7 ± 55.5 | 107.7 ± 5.0 | C-app-vq4.clean-noverbose.log |
| C | 512 | 491.8 ± 1.8 | 260.3 ± 1.0 | 〃 |
| C | 1700 | 205.4 ± 1.0 | 623.1 ± 3.1 | 〃 |
| C | 3100 | 118.7 ± 0.4 | 1078.0 ± 3.9 | 〃 |

| depth | B/A tok/s | C/A tok/s | B/C tok/s |
|---:|---:|---:|---:|
| 0 | 1.20 | 1.03 | 1.16 |
| 512 | 2.40 | 0.88 | 2.73 |
| 1700 | 4.81 | 0.84 | 5.75 |
| 3100 | 7.61 | 0.81 | 9.35 |

**Slope of ms/chunk vs depth** (ordinary least-squares fit over the 4 depths; source: tables.txt):

| arm | ms per 1k context tokens | intercept ms |
|---|---:|---:|
| A | 247.9 | 105.4 |
| B | **7.7** | 92.6 |
| C | 313.0 | 101.6 |

B flattens the growth by about 32× against A and 41× against C. C's slope (0.31 ms per context token) is in the
same range as the in-app slope quoted in PLAN.md (+0.41 ms per context token, measured on a different device and
pipeline).

### Route-proved repeat (driver matrix, `-v` + `GGML_HEXAGON_VERBOSE=1`)

The driver's gated matrix ran with per-op logging (needed for the route proof). It gives the same picture.
Logging costs 0–6 % against the clean run, so the clean numbers above are the headline.
Source: tables.txt "verbose" block and `bench.tsv`; raw logs `*.excerpt.txt`.

| depth | A ms | B ms | C ms | B/A |
|---:|---:|---:|---:|---:|
| 0 | 115.9 ± 14.9 | 102.5 ± 11.8 | 114.6 ± 11.7 | 1.13 |
| 512 | 235.9 ± 4.6 | 101.4 ± 3.5 | 253.9 ± 6.5 | 2.33 |
| 1700 | 523.5 ± 2.3 | 114.7 ± 6.6 | 614.4 ± 26.2 | 4.56 |
| 3100 | 927.1 ± 6.8 | 121.6 ± 6.8 | 1100.6 ± 13.2 | 7.62 |

Slopes in the verbose run: A 261.2, B 6.9, C 318.8 ms per 1k context tokens.

## Route proofs

The driver gate (`HTP0 model buffer size` + `HTP0 execute-op` + `libggml-htp-v79.so`) passed for all 5 verbose
runs. Evidence is in `raw/qdc-8elite-860914/<arm>.excerpt.txt`:

- All arms: `load_tensors: HTP0 model buffer size = 1525.87 MiB` (CPU 205.08 MiB = token embeddings);
  `Hexagon Arch version v79`; HTP session uri `file:///libggml-htp-v79.so`. The `HTP0 execute-op` line counts are
  A 23317, B 27189, plus the C and profile logs (see the excerpts).
- **KV placement** (profiled runs): A `llama_kv_cache: CPU KV buffer size = 17.00 MiB`;
  B `llama_kv_cache: HTP0 KV buffer size = 17.00 MiB`.
- **Scheduler placement** (`GGML_SCHED_DEBUG=2`, profiled runs at depth 1700; `profile-summary.txt`):
  - A: FLASH_ATTN 128 nodes on **CPU**, plus CPY 704, SET_ROWS 256, SCALE 352 and GET_ROWS 720 on CPU.
  - B: FLASH_ATTN 128, CPY 704, SET_ROWS 256 and SCALE 352 nodes all on **HTP0**; only 16 GET_ROWS on CPU.
  - All MUL_MAT / SSM_CONV / RMS_NORM nodes are on HTP0 in both arms.
- HTP execute counts (`*-profile-placement.txt`): FLASH_ATTN_EXT 120, SET_ROWS 240 and CPY 330 executions on
  HTP in B; none of these on HTP in A.

## Per-op HTP profile (`GGML_HEXAGON_PROFILE=1`, depth 1700, r=1)

Whole run = the 1700-token depth fill plus the timed 128-token chunk (15 ubatches × 8 attention layers = 120
FLASH_ATTN_EXT calls). Source: `profile-summary.txt`. The shares below exclude `OPBATCH` (A 1.20 s, B 1.37 s).
OPBATCH looks like a batch-wrapper record that overlaps the per-op records; that is my reading, not verified in
the source.

| op on HTP | A µs | B µs | B share |
|---|---:|---:|---:|
| MUL_MAT + MUL_MAT_NX | 799742 | 803992 | 62.6 % |
| FLASH_ATTN_EXT | — (CPU) | 153503 | 12.0 % |
| SWIGLU | 127846 | 129867 | 10.1 % |
| ADD + MUL + SSM_CONV + CONCAT + ROPE | 178623 | 175304 | 13.7 % |
| CPY + SET_ROWS + GET_ROWS + SCALE | 319 | 21456 | 1.7 % |
| total excl. OPBATCH | 1106530 | 1284122 | |

Reading: the HTP work common to both arms is the same (MUL_MAT within 0.5 %). Moving attention to HTP adds
~175 ms of HTP time across 15 ubatches, about 12 ms per ubatch, or ~1.3 ms per FLASH_ATTN_EXT call on average over
depths 0–1.7k. The CPU path it replaces costs ~400 ms per chunk at 1.7k (A 521 ms vs B 108 ms, clean). The CPU
attention time cannot be read directly from this log (no CPU per-op profiler). It also includes the host↔HTP
transfers of the extra graph splits: that is inferred, not measured.

## Caveats (do not skip)

1. **v79, not v73.** The S23 (8 Gen 2, v73) repeat is still to be done; HTP FA speed and CPU attention speed
   both differ there.
2. **B's numerical correctness is NOT checked.** No output, perplexity or KLD comparison was run. HTP
   FLASH_ATTN_EXT on q8_0 KV needs a correctness gate before anyone ships it.
3. **B is not the app's config.** The app ships V q4_0, and HTP SET_ROWS cannot write q4_0 (PLAN.md). Shipping
   B means either V q8_0 (more KV memory) or a q4_0 SET_ROWS on HTP.
4. `-t 5` CPU threads, a fixed choice in the matrix; the app's thread count may differ, which changes A and C.
5. **Clean B and C were run by hand** (same binary, same flags, only `-v` and `GGML_HEXAGON_VERBOSE` dropped) via
   adb on the tunnel, after the gated matrix and outside the driver's thermal gate. The clean A is the driver's
   attempt-2 run (gated, but no route proof possible without `-v`). Skin during the gated matrix: 32.9 → 40.0 °C
   (`session-events.log` SNAP lines), well under the 50 °C stop. Thermal status 0 throughout. Board unplugged
   (rack battery stub).
6. Depth 0 in A has a large spread (±149 tok/s, n = 3); the B/A ratio at depth 0 is therefore weak.

## Driver fixes made during the session (committed with this report)

- `run_bench.py`: the remote command was `export VAR=… ./bin/llama-bench`, and `sh` rejected the binary as an
  identifier (`raw/.../A-nkvo.attempt1-export-bug.log`). Fixed to `export …; ./bin/llama-bench`.
- `matrix.py`: llama-bench drops every log line unless `-v` is passed (`tools/llama-bench/llama-bench.cpp:2283`),
  so the route proof (`execute-op` is `GGML_LOG_DEBUG`) could never pass. Added `-v` to BASE_FLAGS.
- `analyze_profile.py` (new): per-op HTP µs and scheduler placement summary from a profiled log.
- Not fixed: the stage sha check in `stage()` passes if `sha256sum` prints nothing (it only rejects mismatching
  lines). It was compensated by hand this time.

## QDC minutes

- QRD8750 card before the session: **640 min remaining**.
- Right after End Session: **602** (−38 = the cap, a provisional hold per memory `qdc-bills-the-requested-cap`).
  Actual runtime was 7 min. Re-read the card in a few hours for the settled number.
- The page showed "Total Minutes Used 0" right after ending.

## Files

`raw/qdc-8elite-860914/`: tables.txt, profile-summary.txt, bench.tsv (driver, verbose rows), session-events.log,
stage-stdout.txt, remote-listing.txt, cleanup.txt (device dir removed), the three clean/attempt logs, the five
verbose-log excerpts, and two placement summaries. The full verbose logs (10–25 MB each, ~95 MB total) are kept
off-repo on the Mac at `~/kalsa-qdc/htp-kv-860914-full/logs/`.
