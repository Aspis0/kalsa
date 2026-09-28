# qdc-8elite-onecopy-cost — pre-registration

Written 2026-09-28 BEFORE the QDC session. Locked at session start; changes go in a dated
amendment. Every number is an **8 Elite fact** (QRD8750: SM8750, HTP v79, HMX present), never
an S23 (v73) fact. Procedure copied from `../qdc-8elite-hopping-heat/` and `../qdc-8elite-heat-arms/`.

## Question

The one-copy fix (engine branch `spike/hexagon-onecopy-rawq4`, commit `c939a135d`) lets the
HTP read raw GGUF Q4_0 rows from the `-HOST` buffer that the CPU also reads, converting rows
to tiles in VTCM per matmul. Correctness is proven on the S23 (v73) only
(`../hexagon-onecopy-rawq4/REPORT.md`, P5: mean KLD 0.002750, same-top 97.059 %). This
measures, on the 8 Elite:

1. what one-copy costs in **prefill speed** against the two-copy layout;
2. what it costs in **decode speed** (CPU reading raw `-HOST` weights);
3. what it saves in **memory**.

## Build (provenance)

Engine worktree `/Users/marco/Projects/kalsallama-onecopy`, HEAD `c939a135d44b0a7570006cf5d4ec706a58a402d3`
(tracked tree clean; the untracked `CMakeUserPresets.json` is the `docs/backend/snapdragon` preset). Toolchain image
`ghcr.io/snapdragon-toolchain/arm64-android:v0.7`, preset `arm64-android-snapdragon-release`,
`-DBUILD_SHARED_LIBS=OFF`, build dir `build-onecopy-v79b` (fresh; the stopped agent's
`build-onecopy-v79` held only a CMakeFiles stub and was not reused). Configure `EXIT=0`,
build `-j2` attempt 1 `EXIT=0` (`raw/build_v79b_1.exit`), 38 warnings, none in the changed files.
`hexagon-nm` lists the two raw jobs in the v79 skel (`raw/needed-and-nm.log`).

| artifact | SHA-256 |
|---|---|
| `bin/llama-bench` | `bb3ebd71e223abfce1d7b5de2df5c1ebc532ab0754534c5299ca79c688950341` |
| `bin/llama-perplexity` | `4406145252f4df27e4595646fa081adb7c580399ad6d57a55176c28c1e5013fd` |
| `libggml-htp-v79.so` | `080f316a84a090dae2ae631cc1baafcc4805234d94863315750579ec911e4cc8` |

Fixed inputs: model `LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6…` (the S23 `ship.gguf`); KLD fixture
`kld_english_fixture.txt` sha `bca6ac9f…` (the S23 one). Device dir `/data/local/tmp/oc8`.
`ADSP_LIBRARY_PATH` = `$D/dsp`, `GGML_HEXAGON_NDEV=1`. No kit libs: the binaries link ggml statically.

## Arms

All: `llama-bench -lm none -fa 1 -t 6 -o jsonl -v`, warmup on (bench default). `HTPB`/`HOSTB` are the
buffer-type names read from the binary's own "Available buffer types" list (expected `HTP0`, `HTP0-HOST`).
`P5` = `(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm|shortconv\.conv)|token_embd_norm)\.weight=HTPB`, everything else `=HOSTB`.
If the flat HTP arm cannot load with the KV cache on the device (probe run), **all** HTP arms add `-nkvo 1`.

| arm | what it is | device / placement | env beyond the base |
|---|---|---|---|
| **a-hmx** | two-copy, normal HTP buffer, the shipping HTP config on v79 (HMX kernel: default `MM_SELECT=3`) | `-dev HTP0 -ngl 99` | none |
| **a-flat** | two-copy, normal HTP buffer, flat kernel: same kernel family as one-copy, isolates the layout cost | `-dev HTP0 -ngl 99` | `MM_SELECT=1 OPFUSION=0` |
| **b** | one-copy, P5 | `-dev HTP0 -ngl 99 -ot P5` | `MM_SELECT=1 OPFUSION=0 HOSTBUF=1 OP_OFFLOAD_MIN_BATCH=32` |
| **c** | CPU prefill reference | `-dev none -ngl 0` | none |

(`GGML_HEXAGON_` prefix omitted on the first four; `GGML_OP_OFFLOAD_MIN_BATCH` is the threshold 32.)
The one-copy path cannot run on HMX (the DSP refuses raw weights unless flat, `htp/matmul-ops.c:3690`),
so **a-hmx is what the governor does today on this SoC and a-flat is the like-for-like control**.
On the S23 (v73, no HMX) the two coincide; on the 8 Elite they do not, and the report shows both.

Prefill: `-p 512,2048 -n 0 -r 3 -b 2048 -ub 1024` (3 reps per size per process, plus bench's warmup).
Decode (`-p 0 -n 256 -r 3`):

| arm | what it is | flags |
|---|---|---|
| **d-cpu** | CPU, normal buffer with CPU repack (today's CPU decode buffer) | `-dev none -ngl 0` |
| **d-cpu-nr** | CPU, normal buffer without repack (the app's S23 CPU config; the same generic Q4_0 kernel the raw `-HOST` weights get) | `-dev none -ngl 0 -nr` |
| **d-host** | CPU decode reading raw `-HOST` weights: batch 1 is below the offload threshold, so every matmul stays on the CPU | `-dev HTP0 -ngl 99 -nkvo 1 -ot '.*=HOSTB'` + one-copy env |

d-host uses all-`-HOST` placement, not P5: how CPU decode should treat the P5 norm/conv weights that
sit in the HTP-only buffer is an open design point in the one-copy REPORT, not measured here.

Order: **round 1** = prefill a-hmx, a-flat, b, c, then decode d-cpu, d-cpu-nr, d-host; **round 2** = the
reverse (prefill c, b, a-flat, a-hmx; decode d-host, d-cpu-nr, d-cpu). Each arm therefore runs twice
(two processes, 6 reps per size), once early and once late, so thermal drift is balanced.

Metrics per arm process: prefill / decode tok/s (bench `samples_ts`, per rep); model buffer MiB per
buffer from the load log; peak RSS (`VmHWM`, polled every 1 s from `/proc/<pid>/status`) and the last
`smaps_rollup`. HTP RPC/dma-buf memory may not show in RSS, so the **model-buffer MiB is the primary
memory metric** and RSS a cross-check.
Derived governor footprint (labelled derived, separate processes): two-copy = a-flat buffers + d-cpu buffers
(the governor loads a second, CPU model for decode) against one-copy = b buffers.

## Numerics gate (must pass before b's timing counts)

Run on the device first, 2 chunks, `-c 512 -b 512 -ub 128 -lm none`, base = a CPU run **on this device**
(`-dev none -ngl 0 HOSTBUF=0 --kl-divergence-base`), because the S23 base file is S23-specific:

- **k2-flat**: a-flat placement, fusion off (the S23 "Q0" arm).
- **k1-p5**: the exact S23 P5 (`-lv 5`, fusion off, HOSTBUF=1, threshold 32).

k1-p5 is **valid** iff all hold: exit 0; no crash marker; ≥ 1000 `execute-op MUL_MAT` lines and ≥ 1000 of
them reading `-HOST` (S23: 1080); mean KLD ≤ 0.0035 (S23 P5 0.002750, Q0 0.002788); same-top ≥ 95 %;
|KLD(k1) − KLD(k2)| ≤ 0.0005. If not valid, b's timing is informational and the verdict is UNDECIDED.

## Validity of a timing unit

A unit is void on: nonzero exit; any of `CDSP0 CRASHED`, `dspqueue_read failed`, `dspqueue_write failed`,
`ggml_abort`, `GGML_ASSERT`, `Segmentation`, `NO-SUPPORT`, `dsp-error` in its log; a missing backend proof;
or the deadline. Backend proof from the load log: a-hmx/a-flat need an `HTP0` model buffer and no `-HOST`
buffer; b needs a `-HOST` buffer plus the small `HTP0` buffer; d-host needs a `-HOST` buffer; c, d-cpu, d-cpu-nr
need CPU buffers only. Separate dispatch proofs (`GGML_HEXAGON_VERBOSE=1`, `-p 128`) for a-flat and b must show
`execute-op MUL_MAT` lines, and b's must show them reading `-HOST`. a-hmx and a-flat are told apart by speed only
(the DSP does not log the kernel choice); that is a limit of this design.

## Decision rule (stated before any measurement)

Medians of the pooled reps of both rounds; the **worse of the two prompt sizes** decides.
`r_flat = b / a-flat`, `r_cpu = b / c` (prefill tok/s), `dec = d-host / max(d-cpu, d-cpu-nr)`.

**V1, layout cost (like-for-like, the decision):**

- **GO** (one-copy is worth it for the governor): numerics valid **and** `r_flat ≥ 0.80` **and** `r_cpu ≥ 2.0`
  **and** `dec ≥ 0.90`.
- **NO-GO**: numerics valid and (`r_flat < 0.50` **or** `r_cpu < 1.5` **or** `dec < 0.75`).
- **MARGINAL** otherwise: keep experimental until the DSP converter is vectorised.
- **UNDECIDED** if numerics are not valid or an arm is void.

Why these numbers. One-copy removes roughly the whole HTP weight copy (S23: ~0.95 GiB of a ~2.5 GiB
two-copy footprint), so a prefill slowdown of up to 20 % against the same kernel on repacked weights is
accepted for it; at ≥ 50 % loss the NPU prefill stops being the fast lane it exists to be. HTP prefill must
also stay ≥ 2× the CPU (below 1.5× there is no reason to wake the NPU). CPU decode reading raw weights
must stay within 10 % of the best CPU decode buffer (below 25 % loss it is a regression of the decode
lane, which the governor cannot trade away).
A ratio whose [min/max, max/min] interval straddles a threshold is reported as straddling, not as a pass.

**V2, against the shipping HMX prefill (product verdict on HMX SoCs):** `r_hmx = b / a-hmx`. If `r_hmx < 0.50`
at the worse size, one-copy **forfeits more than half of today's 8 Elite prefill** and is not worth shipping on
HMX-capable devices until a raw-weight HMX path exists, whatever V1 says. Reported, not folded into V1,
because the S23 (no HMX) is the device this design targets first.

## Sampling and stop rules

One sampler for the whole session, every 1 s: CPU/GPU/NSP thermal zones, HAL skin and `Thermal Status`
(`smp.sh`). Speed is the subject, not heat, so there is no 60 s tail. Before each unit a **soft gate**: wait for
skin ≤ 37.0 °C and status 0, at most 60 s, then run anyway; start skin and gate result (`ok`/`warm`) are
recorded per unit. No data is voided for warmth; the reversed second round balances drift.
Watchdog: skin ≥ 45.0 °C kills the binary (unit void `watchdog`). Thermal status ≥ 3 stops the session.
Deadline: a unit starts only if `now + its limit` ≤ the deadline; skipped units are void `deadline`, and round 2
is the first to go.

## Budget and cap

| phase | estimate |
|---|---|
| tunnel, preflight, push (model 1.49 GiB ≈ 70 s, binaries 175 MB) | 4–5 min |
| names / nkv / dispatch proofs | ~1.5 min |
| KLD base + k2 + k1 | ~3 min |
| round 1 (prefill ≈ 3, decode ≈ 2, plus gates) | ~7 min |
| round 2 | ~7 min |
| pull, end session | ~3 min |
| **total** | **~26 min; worst ≈ 38** |

**Requested cap: 40 min.** `sess.sh` deadline = session start + 33 min, leaving 7 min for the pull and End Session.
Billing may show as the cap first and settle to actual use later; the report gives the card before, right
after, and a later re-read if one is possible.

## Rules

Account `aspis.launcher@gmail.com`; the password only ever goes from the macOS Keychain into the browser
field. Login asking for 2FA: stop and report. adb only to the QDC tunnel on port 6037, never the local server.
One session. Kalsa is not installed on the board; no app runs.

## Amendment A1 — 2026-09-28 15:29 EDT, written DURING the session, AFTER round 1 results were seen

Disclosed, not pre-registered. Two facts forced it:
1. The soft 60 s gate did not bind heat: P1-a-flat ran 176 s (the flat HVX kernel on v79 is slow), the
   skin rose to 45 °C and the watchdog killed P1-b, P1-c, D1-d-cpu and D1-d-cpu-nr (all VOID `watchdog`).
   Continuing sess.sh would have voided the rest, so the operator killed it at 15:27 (marker
   `H A1_operator_stop` was not written: the pkill also ended the adb shell). The sampler was restarted.
2. The numerics gate had already failed its absolute bound (k1-p5 mean KLD 0.019336 > 0.0035) while
   meeting the relative one (|k1 − k2| = 0.000016 ≤ 0.0005): the two-copy flat control itself sits at
   0.019320 on v79. Per the rule above the verdict is therefore UNDECIDED; A1 does not change that rule.

A1 (`a1.sh`): hard cooldown to skin ≤ 38.0 °C and status 0 (cap 240 s) before every unit, then
d-cpu, d-cpu-nr, d-host at `-n 128 -r 2`; b at `-p 512 -r 3` (a clean repeat of the watchdog-cut P1-b row);
c at `-p 2048 -r 2`; b at `-p 2048 -r 1`. Round 2 of the PREREG is dropped (no session time).
The rows P1-b/P1-c printed before the watchdog kill are reported as informational, marked VOID.
