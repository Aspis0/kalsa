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
manifest-generation bug, no payload file affected (audit fix #7: manifest and
labeled terminal capture now in raw/kit_SHA256SUMS_793389.txt and
raw/kit_verify_capture_793389.txt; the manifest demonstrably lists itself). Model:
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
1. In every failure that PRINTS a comparison the pattern is
   `HTP0=<finite> CPU=<non-finite>` — the auditor's full census: 362/362
   diagnostic lines (61 MUL_MAT + 301 MUL_MAT_ID), zero inversions; the CPU
   side shows nan/-nan/-inf and in 49 cases +inf. E.g. `[MUL_MAT_ID] NaN at
   index 0 (HTP0=20.906250 CPU=nan)`. CAVEAT (audit fix #5): 7 of the 70
   MUL_MAT FAILs print NO diagnostic at all (including the LLM-like shape
   q4_0 m=1,n=2048,k=8192) — those remain UNCHARACTERIZED and could be real
   numeric mismatches.
2. **Control experiment, same kit and session**
   (raw/backend_ops_MUL_MAT_ID_GPUOpenCL_judgeprobe.txt): `-b GPUOpenCL`
   passes **407/407** against the SAME CPU reference. The reference is not
   broken in general — it breaks ONLY when paired with HTP0. Scope limits
   (audit fix #6): the control covers 294 of HTP0's 297 failed MUL_MAT_ID
   signatures (3 iq4_nl shapes uncovered), and there is NO OpenCL control
   for the MUL_MAT run — there the poisoned-judge reading rests on signature
   matching alone.
3. The known prior: the Adreno campaign's banked "NaN-judge" defect
   (tiled-memcpy/is_host — a buffer-interop bug poisoning the comparison, not
   the compute). The HTP0 pairing uses fastrpc/host+REPACK buffer types the
   CPU reference must read back; the signature matches that class.
4. Separate real signal: **36 `dspcall : dsp-rsp: INTERNAL-ERROR`** lines in
   the MUL_MAT run (audit-corrected taxonomy, fix #1): 29/36 are m=16 with
   n=4..8 (never n=1..3) across the supported quants; **7/36 are NOT m=16**
   — one LARGE shape `q4_0 m=576,n=512,k=576` and six `m=1,n=64,k=256` on
   NON-supported types (bf16/q5_1/q1_0/iq1_m/iq4_xs). Messier than "tiny
   shapes only"; an HTP-side issue distinct from the judge pattern, worth
   its own follow-up. For these cases the HTP output is likely an
   uninitialized buffer, so "finite outputs" carries no weight there.
Claim discipline: correctness is NOT proven by these runs; equally, the
CHARACTERIZED FAILs do not prove the kernels wrong (finite outputs +
poisoned-pairing evidence, where a comparison was printed). Q4 below adds a
qualitative smoke signal only.

## Q3 — Speed probe (exploratory), ship model, N C C N, 4/4 exit 0

Flags exactly as preregistered (backend's documented recipe; declared
non-comparable with #38/#41). Thermal gate live-HAL before each invocation:
all 4 pre-gates PASS, status 0 throughout — actual values (audit fix #4):
pre 41.0 / 41.0 / 45.7 / **57.6** °C (N2's pre-gate passed by 2.4 °C, not
"well under"), and the CPU runs pushed post-run snapshots to **61.5 / 63.0
°C — above the 60.0 gate threshold DURING execution**. The gate is
pre-invocation by design and was honored; the in-run excursion is disclosed,
not hidden.

| run | arm | pp512 t/s | tg128 t/s |
|-----|-----|-----------|-----------|
| 1 | N (HTP0) | 1500.38 ± 20.68 | 22.59 ± 3.35 |
| 2 | C (CPU) | 211.95 ± 0.48 | 38.55 ± 0.04 |
| 3 | C (CPU) | 210.22 ± 0.35 | 38.43 ± 0.23 |
| 4 | N (HTP0) | 1524.09 ± 9.63 | 24.34 ± 0.21 |

Medians: N pp512 **1512.2**, tg128 23.47; C pp512 211.1, tg128 38.49.
(Note: the C arm's process still registers the OpenCL and HTP backends —
the table prints "OpenCL,HTP" — but computes with `-ngl 0`, i.e. on CPU,
exactly as preregistered.)
**NPU prefill = 7.2× CPU. CPU decode = 1.64× NPU.** The per-phase split — the
governor's thesis — appears on the THIRD engine class, day-0, on the shipping
model. (Exploratory per prereg: seeds the NPU column of the 2.6B/830 decision
table; a routing verdict needs its own preregistered cell.)

## Q4 — Text probe: a reasoning-trace-only smoke test (audit fix #2)

llama-cli, temp 0, seed 42, `-n 64`, same prompt ("List the planets..."),
full offload on N (`--device HTP0 -ngl 99`) vs CPU (`-ngl 0`). HONEST scope:
with `-n 64` and this model's thinking mode, **NEITHER arm ever emitted a
final answer** — both captures end INSIDE the `[Start thinking]` trace.
- **N (raw/cli_N.out, exit 0)**: the thinking trace enumerates the full
  correct list Mercury→Neptune in order before the token cap. Prompt 119.7
  t/s, gen 19.4 t/s.
- **C (raw/cli_C.out, exit 0)**: coherent thinking, list begun (Mercury,
  Venus, Earth) before the cap. Prompt 160.9, gen 33.8 t/s.
This shows the NPU generating coherent, factually correct LANGUAGE in the
reasoning trace — a qualitative smoke signal that the forward pass is not
garbage, nothing more. It is NOT correctness evidence in the certification
sense; that requires the PPL HTP-vs-CPU pattern (v75's q55) as future work.

**Binding deviation (audit fix #3)**: the prereg requires a live thermal gate
before EACH invocation; the two successful CLI probes (14:33) ran ~10 min
after the single pre-CLI gate snapshot (14:23), with NO fresh gate before
either — the interval that also contained the interactive-flood incident.
Mitigant on record: therm_post_cli = 48.0 °C status 0, and no banked number
depends on the CLI probes. The violation stands as a deviation.

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

## ERRATUM (2026-09-02, append-only — line 65 left as written)

The "one LARGE shape `q4_0 m=576,n=512,k=576`" attribution among the 36
INTERNAL-ERROR lines was a pty-interleave misread (stderr lines printed before
the next test's stdout header). Resolved during the 2/09 defect-desk
adjudication on cell #46's raw, where the interleave-immune end-of-run
`Failing tests:` list (`qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:2533-2570`)
shows m=576 ABSENT and the per-test invariant (`blocks = m·k/32`: 256 = 8192/32)
pins that INTERNAL-ERROR to the adjacent `q4_0 m=1,n=2048,k=8192` test. All 36
INTERNAL-ERROR shapes have test-m % 32 ≠ 0 (m ∈ {16, 1, 6}); the %32 host/DSP
contract mechanism covers 36/36. Full chain:
`scratchpad/agents/v79-defect-desk/` (REPORT rev-2, AUDIT, ARBITRATION + its own
erratum, FIXNOTES).

## ERRATUM-2 (2026-09-02, append-only — corrects the erratum above, per AUDIT-2 finding 3)

The erratum above overstates. In THIS cell's raw, `q4_0 m=576,n=512,k=576` IS in
the interleave-immune failing list (`raw/backend_ops_MUL_MAT_HTP0.txt:4233`) and
its own line carries a poisoned-judge diagnostic (`:1365` `[MUL_MAT] NaN at
index 1 (HTP0=-1.300781 CPU=nan)` — HTP finite, CPU non-finite, the judge-poison
signature). So in #43 the test genuinely FAILED; what is interleave-ambiguous is
only the `INTERNAL-ERROR` label glued onto that line. #43 ran the pre-repair
binary (error-swallowing graph_compute + poisoned judge), so its INTERNAL-ERROR
taxonomy — including the m=576 attribution AND the "six m=1,n=64 on
NON-supported types" reading — does not transfer to the repaired-judge world.
The "36" of #43 and the "36" of #46 are DIFFERENT SETS under different binaries
that happen to share a count. The certified defect census is #46's
(`Failing tests:` list): 36 INTERNAL-ERROR all with test-m % 32 ≠ 0 (m ∈
{16, 1, 6}) + 1 numeric NaN (q4_0 m=2880), with m=576 PASSING under the
repaired judge.
