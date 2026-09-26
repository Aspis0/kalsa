# NPU-verified speculative decoding, acceptance-gated — research verdict (no device, 2026-09-25)

**Verdict after Step 0 (see bottom section): NOT WORTH IT on speed, on QRD8750/v79 — with the
surprise that CPU verify is nearly free at K=4 on this board, which strengthens plain CPU
speculative decoding instead. NPU stays parked behind an energy meter (J/token still unmeasured).**

Design under test: CPU/GPU drafts K=3-4 tokens; the target verifies all K positions in ONE fixed-shape
Hexagon call; CPU accepts/rejects. Round is taken only when acceptance is likely (owner's gate); otherwise
plain CPU decode. Question: is a Step-0 device test warranted?

## Verdict: UNKNOWN — but Step 0 is a ~15-min llama-bench run, and it is warranted.

Two unmeasured quantities decide everything, and one llama-bench matrix measures both: (1) does an NPU call
over 4 query positions cost ~1 call (flatness), and (2) does a CPU call over 4 positions cost ~1 step (the
premise that makes CPU spec the baseline). The lab has zero NPU measurements below pp128; all banked NPU
decode numbers are tg128, i.e. K=1.

## Best existing evidence on small-batch NPU call cost

- **K=1 call cost is banked**: tg128 @ d1920, LFM2.5-2.6B-QAD-Q4_0, QRD8650/v75 — CPU 17.68 ± 4.17 t/s
  (56.6 ms/token), NPU `-nkvo` 15.08 ± 0.55 (66.4 ms), NPU KV-on-HTP 13.37 (worse: moved attention onto the
  DSP). `scratchpad/agents/npu-decode-kv/REPORT.md` (ALIVE 58, cell npu-decode-kv).
- **No K>1 point exists.** Indirect arguments both ways: (a) arm B ran 137,467 execute-ops over 384 decode
  steps ≈ 358 ops/step ≈ 0.19 ms/op at 66.4 ms/step — if a large share of that is per-op dispatch/FastRPC,
  a K=4 call is nearly flat (same graph, same op count, 4× activation rows). Upstream treats this overhead
  as real: commit "hexagon: introduce op request batching and rewrite buffer management" exists precisely to
  amortize per-op cost. (b) Decode on both arms is weight-stream-bound: 1.48 GiB / 56.6 ms (CPU) ≈ 27 GiB/s,
  1.48 GiB / 66.4 ms (NPU) ≈ 24 GiB/s — weight streaming amortizes over K for free on BOTH backends.
- **Kernel tier**: per `scratchpad/agents/q35-htp-batch-classification/REPORT.md`, repacked quantized MUL_MAT
  dispatches HVX for ≤4 activation rows and HMX for ≥5 — K=4 stays on the same kernel tier decode already
  uses (proven correct on-device); K≥5 flips tiers. Stay at K≤4.
- **Modeling caveat**: LFM2.5 is hybrid conv/SSM; the conv/SSM state update is serial across positions on
  any backend, so only the GEMM/attention share of the step amortizes. Expect pp4/pp1 > 1 even in the best
  case; gate at ≤ 1.5×.
- **Prior art for NPU-verify speculation exists on other NPUs, not on Hexagon**: AHASD (DAC 2026: draft on
  PIM, verify on NPU), EAGLE-Pangu (tree verify on Ascend NPU, huggingface.co/papers), HeteroLLM
  (GPU+NPU smartphone, 2025), EdgeLLM (IEEE 2025, on-device spec decoding), "Scaling LLM Test-Time Compute
  with Mobile NPU" (ACM 2026 — names QNN's fixed-shape static graphs as the exact obstacle this design
  works around). No Hexagon-verifier speculation found — the specific measurement would be new.

## Baseline to beat — correction to the premise

The brief says CPU also verifies K tokens for ~one step (memory-bound). Our own A/B already falsified that
on these phones: three-arm BASELINE/MTP/DFlash on Qwen3.5-4B (dense) had **both** speculative arms lose,
and the F6 post-mortem fixes the mechanism: "su CPU la verifica di k token costa ~k× il compute di un token"
(`archived/PLAN-archive.md` 2026-08-08 entry; `reports/research/speculative-cpu-literature.md`). So today the
de-facto baseline is **plain CPU decode, 56.6 ms/token** — not CPU spec. Step 0's CPU pp1/2/4/8 columns
decide whether the flat-CPU-verify premise revives on the dense ship model.

## Break-even (using banked numbers)

c_cpu = 56.6 ms/token; c_npu(1) = 66.4 ms; assume c_npu(4) ≈ c_npu(1) (Step-0). A gated round takes
d = draft + s = switch ms and yields E = α+α²+α³+α⁴ accepted tokens (per-token acceptance α). Beats plain
CPU iff E > 17.68·(66.4+d+s)/1000:

| d+s | break-even E | α* |
|---|---|---|
| 0 ms | 1.17 | ≈ 0.57 |
| 20 ms | 1.52 | ≈ 0.65 |
| 40 ms | 1.88 | ≈ 0.72 |

Measured acceptance today is 26-30% (Qwen3.5 MTP, CI + Xiaomi 14; `ModelRegistry.ts:81-85`, memory
mtp-payoff-is-per-device) — below break-even. The gate is therefore not optional: the speed case exists only
if high-α states (predictable spans) are common enough that the mixture clears 17.68 t/s. In a single NPU
context with no CPU fallback (every round rides the NPU at 66.4 ms), ~1/3 of rounds gated at α≥0.65 with a
10 ms draft is the approximate mixture break-even. Speed ceiling is not the issue: α=0.8, K=4 gives ~34 t/s
even with d+s=20 ms. Where NPU wins even at speed parity: **energy and heat** — NPU runs measured 0-1.1
°C/1k tokens vs CPU 3.2-14.8 (`scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md`; J/token itself remains
unmeasured, charge-counter unreliable), sustained throughput under throttle follows, and PELM (SenSys '26,
ACM) makes "speculative decoding + variable verification depth for power" the whole design point. Freeing
the CPU for the governor is real but partial: with `-nkvo` attention already runs on CPU during NPU steps.

## Gating (owner's design) — signal and implementation

- **Already in our fork**: `--draft-p-min` (`kalsallama`: common/arg.cpp:4193, common/common.h:330; stop
  drafting when the top draft-token prob < p_min: common/speculative.cpp:337, 799, 1309, 1686; NextN
  confidence variant at 1247-1274). Zero new code to gate draft length.
- **Signal ranking**: draft top-token probability is free and is what p_min uses; entropy of the draft
  distribution is the training-free upgrade (adaEDL, ACL 2025 — aclanthology.org/2025.acl-long.482);
  a trained acceptance-prediction head is SpecDec++ (arXiv 2405.19715, ICML 2024); DISCO (ICLR 2025,
  proceedings.iclr.cc/paper_files/paper/2025/hash/03b1043052700b1a471996b0baf309d4) treats stop/continue as
  a learned MDP; a rolling measured-acceptance EMA is free and directly estimates α. Recommendation: p_min +
  acceptance EMA first; entropy only if that under-fires.

## Switching cost — can CPU and NPU share one KV?

`-nkvo` = `no_kv_offload` → `cparams.offload_kqv = false` (kalsallama common/common.cpp:1758): KV stays in a
host buffer, attention runs on CPU, only weights/matmuls are on HTP (measured: zero FLASH_ATTN ops in arm B,
npu-decode-kv). But the KV cache is owned per `llama_context` (src/llama-kv-cache.h:25); **there is no
zero-copy KV sharing between contexts**. A true hybrid (CPU ctx for low-α rounds, NPU ctx for verify) means
two contexts over one shared llama_model with a KV handoff per switch via `llama_state_get_data/set_data`
(include/llama.h:824/835) — a 32 MiB memcpy at ctx 2048 (few ms of DDR) plus plumbing that does not exist
yet. That is engine work, but bounded and only needed if the CPU-fallback path is required (it is, for the
mixture math above).

## Step 0 (if approved): one llama-bench matrix, both questions, ~15 min on-device

Depth prefill is untimed and state-cached in llama-bench (`tools/llama-bench/llama-bench.cpp:2432-2458`);
pp here IS the verify call. Same env/kit as npu-decode-kv (`LD_LIBRARY_PATH=$D/lib ADSP_LIBRARY_PATH=$D/lib
GGML_HEXAGON_NDEV=1`):

```
# NPU arm
./bin/llama-bench -m $D/ship.gguf --device HTP0 -ngl 99 -nkvo 1 --mmap 0 -fa 1 -t 8 \
  -p 1,2,4,8 -n 0 -d 1920 -r 3 -v
# CPU arm
./bin/llama-bench -m $D/ship.gguf -ngl 0 --mmap 0 -fa 1 -t 8 -p 1,2,4,8 -n 0 -d 1920 -r 3
```

Readout: ms/call = 1000·p / (pp t/s). Decision gates: **NPU ms(4) ≤ 1.5× ms(1) AND CPU ms(4) ≥ 2.5× ms(1)**
→ green light: the flatness asymmetry is real, gated NPU verify beats plain CPU at α ≥ ~0.65, and a full
prototype (dual context + handoff + p_min gate) is justified. NPU not flat → NOT WORTH IT (KILL the idea,
record like #15). Both flat → CPU spec is the winner, NPU only for energy — park behind a J/token meter.
Device: S23 (8 Gen 2/v73) or QRD8650 (v75), whichever Marco frees; both have banked NPU baselines.

---

# Step 0 — device run (2026-09-25, QDC, new account aspis.launcher@gmail.com)

## Pre-registered prediction (written BEFORE any session; do not edit after numbers land)

Boards: QRD8750 (8 Elite, Hexagon v79) first, then QRD8635 (8s Gen 3, v73). Kit
`npu-kit-556118a08.tgz` (engine kalsa/governor-v0 @ `556118a08`; llama-bench `build_commit 4c7101af4`
= that + one docs commit) — carries v73/v75/v79/v81 skels; proven on QRD8750 in cell #43.
Model ship.gguf sha `a247afd6…40b03` verified on the Mac (1,593,894,944 B).

Predictions:
- NPU arm B (`-nkvo`): ms(1) ≈ 35-70 ms; **ms(4)/ms(1) ≈ 1.1-1.4** — per-op dispatch overhead
  amortizes, weight streaming amortizes, but the conv/SSM serial share keeps it above 1.
- CPU arm A: ms(1) ≈ 40-60 ms; **ms(4)/ms(1) ≈ 1.5-2.5** — LFM2.5-2.6B streams 1.48 GiB at
  ~27 GB/s (bandwidth-bound), so verify partially amortizes; F6's K× compute scaling was
  measured on Qwen3.5-4B/MoE, not this dense-hybrid, so I expect partial, not full, scaling.
- Gate: NPU side likely PASSES ≤1.5×; CPU side likely FAILS ≥2.5× → expected overall outcome
  "both flat → CPU spec wins on speed, NPU parks behind an energy meter". P(green light) ≈ 25-35%.
- QRD8635: v73 lane is at risk (cell #59 v73 death class was MoE MUL_MAT_ID-specific; dense
  LFM2.5 has no MUL_MAT_ID, so I predict HTP works; if not, CPU arm only, declared).
- Arm C (KV on HTP): predicted to map (1.51 GiB ≪ vmem ceiling) and to be ≈ arm B ± 15%.

Commands per board (order A → B → C, CPU reference first; `-r 5`):
```
A: ./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 -p 1,2,4,8,16 -n 0 -d 1920 -r 5 -v -ngl 0
B: same + --device HTP0 -ngl 99 -nkvo 1
C: same + --device HTP0 -ngl 99
```
Env: `LD_LIBRARY_PATH=$D/lib ADSP_LIBRARY_PATH=$D/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1`
(never /vendor/lib64). Proof per NPU arm: `Hexagon Arch version vNN`, `HTP0 execute-op` lines,
KV buffer name line; missing proof = METHOD-VOID, not a number. Readout: ms/call = 1000·p/(pp t/s).
Green light: NPU ms(4) ≤ 1.5×ms(1) AND CPU ms(4) ≥ 2.5×ms(1).

## Step 0 results — QRD8750 (session 845063, 2026-09-25)

Device `9aed338b`, QRD8750 / SM8750 / Hexagon v79 / Android 16, job host `sa849132`. Driver
`d_run.sh qrd8750 6038 sa849132`; model sha verified on device; kit `npu-kit-556118a08.tgz`
pushed 9.1 MB/s, model 21.7 MB/s (70 s). Arms A→B→C back-to-back 21:36:19–21:37:01 UTC,
all EXIT=0. Proofs: B/C headers `ggml-hex: Hexagon Arch version v79`; B `CPU KV buffer size
= 32.00 MiB` + 11,982 execute-ops; C `HTP0 KV buffer size = 32.00 MiB` (KV mapped on DSP) +
14,290 execute-ops. No silent CPU fallback. `-r 5` as printed means ±.

ms/call = 1000·p / (pp t/s):

| arm | ms(1) | ms(2) | ms(4) | ms(8) | ms(16) | ms(4)/ms(1) |
|---|---|---|---|---|---|---|
| A CPU `-ngl 0` | 28.8 | 38.8 | 35.7 | 57.9 | 92.2 | **1.24** |
| B NPU `-nkvo` HTP0 | 39.4 | 43.1 | 71.6 | 74.4 | 97.4 | **1.82** |
| C NPU KV-on-HTP | 50.9 | 59.0 | 97.1 | 79.9 | 81.0 | 1.91 (noisy ±18-20 t/s) |

Raw t/s: A pp1/2/4/8/16 = 34.76±0.87 / 51.60±0.56 / 111.92±0.77 / 138.24±0.52 / 173.51±0.91;
B = 25.35±1.10 / 46.44±1.94 / 55.84±1.43 / 107.52±2.51 / 164.31±17.18;
C = 19.64±1.10 / 33.93±3.93 / 41.20±1.81 / 100.14±18.39 / 197.49±19.79.

**Gate verdict: NO GREEN LIGHT — both conditions fail.** NPU ms(4)/ms(1) = 1.82 > 1.5; CPU
ms(4)/ms(1) = 1.24 ≪ 2.5. Per the pre-registered readings this lands in "both flat → CPU spec
wins on speed; NPU parks behind an energy meter" — and it is worse than that for the NPU side:

- **The CPU premise flips.** On this board/model the CPU verifies K=4 for 1.24× one step
  (35.7 vs 28.8 ms) — the F6 "verify ≈ K× compute" result (Qwen3.5-4B/MoE) does NOT transfer
  to LFM2.5-2.6B dense-hybrid on the 8 Elite CPU. CPU speculative decoding is cheap here.
- **The NPU loses at every K.** At K=1: 39.4 vs 28.8 ms (1.37× slower); at K=4: 71.6 vs
  35.7 ms (2.0× slower). B shows a step pattern (ms(1)≈ms(2)≈41; ms(4)≈ms(8)≈73; ms(16)=97)
  — consistent with the q35 HVX/HMX kernel tiers, not with per-call-overhead amortization.
- **Break-even with the measured c_npu(4)=71.6 ms**: needs E > 71.6/28.8 = 2.49 accepted
  tokens per round at zero draft/switch cost → α ≈ 0.79; with a realistic 20 ms draft+switch,
  α ≈ 0.84. Measured acceptance is 26-30%. **NOT WORTH IT on speed, on v79.**
- KV-on-HTP (C) is again the slowest at K≤4, matching npu-decode-stays-on-cpu (v75).

Skin temp: battery read 43.0 °C pre/post every arm, unmoved — consistent with the known QDC
rack stub; treat thermal as non-informative for this cell.

**Minutes**: QRD8750 card 1000 → **970** (cap 30 billed in full; device work 3.5 min —
cap-billing rule confirmed on this mobile board). Session Completed, Ended On 17:37:56
verified within 1 min, tunnel killed.

## QRD8635 (8s Gen 3, Hexagon v73) — NOT RUN: pool never freed

Minutes claimed (1000, "Claim Offer" answered truthfully, same answers as QRD8750), but the
device card stayed **Unavailable** for the entire ~15-min retry window (17:45–18:00 local,
retries every 3-4 min). The wizard disables the card while Unavailable, so no session could
even be submitted/queued — nothing was billed (QRD8635 still 1000 min; QRD8750 970).
Consequence: the owner's CPU-arm fallback for QRD8635 could not be exercised, and the v73
HTP lane stays unmeasured for this cell. This does not change the Step-0 verdict: the primary
board (v79, the strongest NPU we can book) answered both gate conditions decisively, and a
weaker NPU on a slower board cannot reverse a 2× deficit at K=4. Revisit only if a v73/v75
data point is wanted for the per-device catalogue (cf. mtp-payoff-is-per-device).

## Step 0 — Galaxy S23 / SM8550 / Hexagon v73 (2026-09-26)

This is the separate owner-requested v73 phone run (session `s23-v73-step0`), not the unavailable
QRD8635 booking above. It ran A/B/C from `d_run.sh` on engine pin `f25f0c1c5`; all arms exited
0. Preflight after two minutes idle with the screen awake: unplugged, battery 100%, 26.5 C,
thermal status 0, `persist.traced.enable=0`; adsprpcd `0/0` and cdsprpcd `0/4` utime/stime.

ms/call = `1000 × K / (pp t/s)`:

| arm | ms(1) | ms(4) | ms(4)/ms(1) |
|---|---:|---:|---:|
| CPU `-ngl 0` | 53.3* | 75.6 | 1.42* |
| HTP0 `-nkvo 1` | 102.5 | 185.1 | 1.81 |
| HTP0 with KV on HTP (C) | 59.6 | 159.1 | 2.67 |

The first CPU pp1 line was an anomalous `0.08 t/s` (12,500 ms/call), while pp2 and pp4 were
72.5 and 75.6 ms/call. Repeating CPU pp1 alone with the same settings after A/B/C returned
`18.77 ± 0.59 t/s` (53.3 ms/call); the table uses that confirmation, with the initial line
retained in the raw log and the cause unresolved. The K=4 comparison is unaffected: HTP0
`-nkvo` took 2.45× the CPU call time. **Verdict: NPU verification does not beat CPU verification
on v73**, at K=1 or K=4.

HTP ran on DSP: B reported Hexagon v73 and dispatched 11,407 HTP0 execute-op lines with 992
matched opqueue pushes/pops; C reported 13,715 execute-op lines and 32 queue responses. Thus
these are real HTP results, not CPU fallback. Immediately after A/B/C, adsprpcd remained `0/0`
and cdsprpcd `0/4`; after the later CPU-only pp1 confirmation they were `0/0` and `0/5`.
Battery was 98%, 31.2 C, thermal status 0, tracing 0 after the follow-up. Full evidence is in
`scratchpad/agents/npu-spec-verify/raw/s23/`; the prep record has command/gate details.

## Step 0 close-out

| board | state | minutes before → after |
|---|---|---|
| QRD8750 | session 845063 Completed, 3 arms EXIT=0, proofs banked | 1000 → 970 |
| QRD8635 | never bookable (pool Unavailable, card disabled) | 1000 → 1000 |
| Galaxy S23 | A/B/C EXIT=0, v73 HTP0 dispatch proved | N/A (local device) |

Raw data: `raw/qrd8750/` (A/B/C logs + tables, adbstatus, therm snapshots, push and sha
provenance, session.env). Zero INTERNAL-ERROR lines in any arm; arm A pure CPU (0 execute-ops,
all layers on CPU). Where this leaves the idea:

1. **NPU-verify spec decoding: KILLED on speed on measured v79 and SM8550/v73 phones** (record next to PLAN #1/#15;
   reopen gate: a J/token measurement showing NPU verify saves real energy at α ≥ 0.8 — nothing
   today supports spending on the dual-context engine work).
2. **The CPU remains faster than HTP for verification**: CPU K=4 costs 1.24× one step on the
   8 Elite/v79 and 1.42× on the Galaxy S23/v73, while HTP is 1.82× flat on v79 and 1.81× on
   S23. The NPU verifier loses at both K=1 and K=4 on S23. A CPU-only speculative lane (existing
   `--draft-p-min` gate + MTP) remains the better speed direction; acceptance and handoff costs
   still need measurement before a prototype.
3. QRD8635 remains an unrun board-specific cell, blocked on pool availability, not on minutes;
   the separate S23/SM8550 result now supplies the requested Hexagon v73 data point.
