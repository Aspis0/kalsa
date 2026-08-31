# REPORT — Hexagon NPU day-0 on the 8 Elite (v79) — cell #43 candidate

Prereg `5606d929` (locked before any measurement). Session **793389** (queued
~11.5h against the pool marked Unavailable — the longest wait of the campaign;
Running relayed by the owner via the Connect host at ~14:20 local, device work
ended ~14:45; the orchestrator's own QDC web login was broken all morning, an
ops note, not cell data). Unit serial `2a38935c` (in raw/provenance_793389.txt
via ro.serialno), props `qti/sun/sun:16/BQ2A.260305.002-...`, SM8750,
Android 16 (QDC "Snapdragon 8 Elite / QRD8750" type). Kit npu-kit-556118a08:
llama-bench/llama-cli/test-backend-ops + 20 shared libs incl.
libggml-htp-v79.so, built from kalsallama kalsa/governor-v0 @ 556118a08 in the
official toolchain container (NDK r28b, Hexagon SDK 6.6.0.0). Kit integrity:
23/23 payload files OK on device; the SHA256SUMS line for itself reads FAILED
because the manifest hashed its own (then-empty) file at creation — a
manifest-generation bug, disclosed, no payload file affected. Model:
LFM2.5-2.6B-QAD-Q4_0 (THE ship model) as ship.gguf, sha `a247afd6...40b03`
identical local/device. Run env per the backend's docs:
`LD_LIBRARY_PATH=<kit>/lib ADSP_LIBRARY_PATH=<kit>/lib`.

## Q1 — Does HTP initialize on v79? YES (first try)

Every HTP invocation's header (bench_N*.txt, backend_ops_*.txt):
`ggml-hex: Hexagon Arch version v79`, `HTP0 allocating new session`,
`hwinfo: threads 6, hvx 6, hmx 1, vtcm 8 MB`, session uri
`file:///libggml-htp-v79.so?...&_dom=cdsp` — our Docker-built v79 skel loads
into the cDSP and serves calls. The unsigned-PD path works on the QDC rack
unit. **The v79 lane exists.**

## Q2 — Correctness day-0: test-backend-ops verdict is FAIL, with a
## characterized judge defect (counts and diagnosis both banked)

- MUL_MAT on HTP0 (raw/backend_ops_MUL_MAT_HTP0.txt): **472/542 passed,
  70 FAIL**, 928 unsupported skips, exit 1.
- MUL_MAT_ID on HTP0 (raw/backend_ops_MUL_MAT_ID_HTP0.txt): **0/301 passed**,
  exit 1, zero INTERNAL-ERROR.
- Per the prereg rule (executed>0 and FAIL=0) this banks as **"v79 defect
  list started"** — the rule is applied as written.

**The diagnosis, from the failure signatures themselves** (all quoted in raw):
1. In EVERY compared failure the pattern is `HTP0=<finite> CPU=nan/-nan/-inf`
   — e.g. `[MUL_MAT_ID] NaN at index 0 (HTP0=20.906250 CPU=nan)`. The
   NaN/Inf is in the CPU REFERENCE, not in the HTP output.
2. **Control experiment on the same binary, same run conditions**
   (raw/backend_ops_MUL_MAT_ID_GPUOpenCL_judgeprobe.txt): `-b GPUOpenCL`
   passes **407/407** against the SAME CPU reference. The reference is not
   broken in general — it breaks ONLY when paired with HTP0.
3. The known prior: the Adreno campaign's banked "NaN-judge" defect
   (tiled-memcpy/is_host — a buffer-interop bug poisoning the comparison, not
   the compute). The HTP0 pairing uses fastrpc/host+REPACK buffer types the
   CPU reference must read back; the signature matches that class.
4. Separate real signal: **36 `dspcall : dsp-rsp: INTERNAL-ERROR`** lines in
   the MUL_MAT run, concentrated on tiny shapes (m=16, n=1..4) across all
   supported quants — an HTP-side issue distinct from the judge pattern,
   worth its own follow-up.
Claim discipline: correctness is NOT proven by these runs; equally, the FAILs
do not prove the kernels wrong (finite outputs + poisoned-pairing evidence).
The decisive end-to-end probe is Q4 below.

## Q3 — Speed probe (exploratory), ship model, N C C N, 4/4 exit 0

Flags exactly as preregistered (backend's documented recipe; declared
non-comparable with #38/#41). Thermal gate live-HAL before each invocation:
all PASS, status 0 throughout (max HAL well under gate; snapshots in raw/).

| run | arm | pp512 t/s | tg128 t/s |
|-----|-----|-----------|-----------|
| 1 | N (HTP0) | 1500.38 ± 20.68 | 22.59 ± 3.35 |
| 2 | C (CPU) | 211.95 ± 0.48 | 38.55 ± 0.04 |
| 3 | C (CPU) | 210.22 ± 0.35 | 38.43 ± 0.23 |
| 4 | N (HTP0) | 1524.09 ± 9.63 | 24.34 ± 0.21 |

Medians: N pp512 **1512.2**, tg128 23.47; C pp512 211.1, tg128 38.49.
**NPU prefill = 7.2× CPU. CPU decode = 1.64× NPU.** The per-phase split — the
governor's thesis — appears on the THIRD engine class, day-0, on the shipping
model. (Exploratory per prereg: seeds the NPU column of the 2.6B/830 decision
table; a routing verdict needs its own preregistered cell.)

## Q4 — End-to-end text probe (the correctness evidence that matters)

llama-cli, temp 0, seed 42, `-n 64`, same prompt ("List the planets..."),
full offload on N (`--device HTP0 -ngl 99`) vs CPU (`-ngl 0`):
- **N (raw/cli_N.out, exit 0)**: correct reasoning and the full correct list
  Mercury→Neptune, in order. Reported speeds: prompt 119.7 t/s, gen 19.4 t/s.
- **C (raw/cli_C.out, exit 0)**: coherent, same list begun (verbose phrasing
  hits the 64-token cap). Prompt 160.9, gen 33.8 t/s.
- Outputs differ textually across backends at temp 0 (expected, as in cell
  #42's cross-arm divergence); BOTH are semantically correct. A full
  quantitative certification (PPL HTP-vs-CPU, the v75 q55 pattern) is future
  work; day-0 the NPU demonstrably computes sensible language.

## Operational notes (banked)

- One llama-cli attempt used `--mmap 0` (a llama-bench flag) → instant
  `invalid argument`; retried with `--no-mmap`. A second attempt looped in
  interactive mode flooding "> " (663 MB of prompt echo through the tunnel,
  file deleted, run redone with `< /dev/null` + `-st` writing to a device
  file). Neither touched any banked number.
- Session upload gate: kit 10.8 MB + model 1.59 GB at 23.8 MiB/s ≈ 75 s,
  PASS with huge margin.

## What this cell cannot say (prereg, binding)

Nothing about v73/v75; nothing about K-quant models (KEXP excluded by HTP
quant support); no routing verdict; nothing about sustained thermals or
energy; nothing about the app; correctness is characterized (Q2 defect list +
Q4 probe), not certified.

Pending: hostile audit before registry/ALIVE entry.
