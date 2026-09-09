# Market/positioning research — Adreno vs Mali, Adreno 8xx (owner-supplied, 2026-08-22)

Source: owner (gualt) paste, 2026-08-22 evening. Primary references: the
Sun Yat-Sen + Nanjing measurement study (arXiv 2410.03613v2, 6 real devices,
llama.cpp + MLC LLM), Phoronix (Freedreno Gen-8), Chips and Cheese (Adreno
microarch), community Turnip release notes, and the Qualcomm-maintained OpenCL
backend discussion (llama.cpp #8273).

Owner's reading: **(1) the market is open, (2) hurry.**

## Adreno 7xx vs Mali — measured, not marketing

- **Adreno beats Mali even when Mali wins on paper.** Mali-G720 Immortalis MP12
  has ~1.5× the theoretical FP16 GFLOPS of Adreno 750, yet prefill is **5.3×
  slower** in practice. ALU utilization during compute-bound prefill: **<3% on
  Mali-G720 vs ~20% on Adreno 750** — generic OpenCL/MLC kernels cannot feed
  the Mali architecture. Decode: Adreno 750 is 1.6× Mali-G720; Adreno 730 is
  1.4× Mali-G78.
- Old Malis (G78, 2020-21) are so weak at prefill the study had to shrink test
  prompts from 64 to 32 tokens to get usable data.
- FP16 GFLOPS / real memory bandwidth: Mali-G78 MP22 1010 / 26 GB/s ·
  Adreno 730 1583 / 39 · Mali-G720 MP12 3418 / 48 (77 theoretical) ·
  Adreno 750 2232 / 63 (77 theoretical).
- Tuning distance is architectural, not driver-level: MLC uses loop unroll 4 on
  Adreno vs 64 on Mali.
- CPU side: Armv8 (A76/A77) ~2-4 tok/s decode; Armv9 (X4, smmla/sdot) up to
  56 tok/s prefill — an ISA jump, vendor-independent.
- Hexagon NPU via Qualcomm AI Hub: 690 tok/s prefill (~50× CPU/GPU) but decode
  comparable to CPU/GPU (memory-bound) — consistent with our own NPU verdict
  (decode DRAM-bound; HTP loads 0.67 MiB).

**Kalsa implication:** on Mali (any generation) a generic Vulkan/OpenCL backend
throws the advantage away unless dedicated Mali kernels are written. On
Adreno-only targets, Qualcomm's OpenCL story is mature and "free" from a
generic backend — which is exactly where our A7X kernel work sits. This also
explains why the Jelly (Mali G57) is CPU-only in the product: correct call.

## Do we need physical Adreno 8xx hardware?

**No for correctness, yes (eventually) for tuning.**

- 8xx is a real architectural jump ("Slice" architecture, significant register
  reshuffle per the Linux kernel driver notes) — but that is driver-level; the
  API surface we consume (OpenCL 2.0 FP, Vulkan 1.3) is unchanged, so standard
  code should run.
- Fine tuning (workgroup size, wave32/64, occupancy) changes per generation and
  is only discoverable by microbenchmarks on real hardware.
- Open-source (Mesa/Turnip) Gen-8 support is embryonic and gaming-driven;
  production Android uses the proprietary Qualcomm driver anyway. The thing to
  track/steal from with confidence is **Qualcomm's own OpenCL backend for
  llama.cpp** (github.com/qualcomm/llama.cpp) — generational tuning is done by
  their engineers there.
- Practical: don't buy 8xx hardware for development. Cloud device farms
  (Firebase Test Lab, AWS Device Farm) rent Snapdragon 8 Elite / Elite Gen 5 by
  the minute and Snapdragon Profiler works remotely. Physical purchase only for
  what cloud can't reproduce (real thermal throttling — which is precisely
  where cloud tests are weakest, and our campaign is thermally-aware).

## Action hooks

- Dossier #8: the Mali <3% ALU-utilization datum + "Qualcomm engineers maintain
  the OpenCL backend" strengthen the case that our A7X MoE kernels target the
  only mobile GPU lane where the work pays.
- #16 follow-ups (750): confirmatory A/C + Marco table — in flight 22/08.
- 8xx validation when relevant: cloud farm first (test-backend-ops MUL_MAT_ID
  is exactly the kind of correctness suite that runs well remotely); physical
  device only if a thermal/throttling question opens.
