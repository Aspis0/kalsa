# One copy, three legs: integration plan (coordinator, 2026-10-04)

Owner go 2026-10-04: integrate, with two hard requirements: (R1) it works on the phones we tested - same CPU, GPU,
NPU as measured; (R2) every leg is disabled on phones not tested/supported (they keep today's behaviour).
Inputs: `FABLE-DESIGN.md` (architecture, adopted as the base), `RECON-CODE.md`, `WEB-PRIOR-ART.md`, `REPORT.md`.

## Decisions

- Mechanism = FABLE-DESIGN A1-A6: the tile layout is a ggml contract (shared header + packer); one buffer property
  (`get_weight_layout` = TILE32) so no backend can misread tiles; weights in the Hexagon HOST buffer, no-mmap,
  `token_embd` (Q6_K, tied) on the CPU; a leg = a context's backend set (`leg_devices`); stock scheduler routing;
  a fork guard turns any silent weight copy into a load failure -> fallback; one dma-buf import per shared buffer
  for OpenCL.
- Capability table = ONE host-tested pure function in the binding (`cpp/rn-legs-table.cpp`), facts read in-process
  (ro.soc.model, Hexagon arch from the registered device, Adreno model + compiler version, dotprod via getauxval).
  Exactly one row today: SM8550 + v73 + Adreno 740 + E031.41 + dotprod. Anything else, or any unreadable fact:
  today's loads, byte for byte. Runtime self-checks at load (GPU alias check, one-row numeric check per leg) can
  only switch a leg OFF. Rows for Xiaomi 14 / 8 Elite / SM8850 only after a lab report on that hardware.
- The hop stays in ONE place (`llama-governor.cpp` hop site + `llama-governor-policy.cpp` decision): the GPU leg
  enters the existing (phase, route, engine) switch.
- Lessons from prior art (WEB-PRIOR-ART): coherence needs an explicit sync, not shared addresses; split by
  CL_DEVICE_MAX_MEM_ALLOC_SIZE; CPU fallback always; never treat "v73+" or "device detected" as validated; measure
  PSS/dma-buf accounting per phone; no concurrent GPU+NPU without measuring contention.

## Corrections to the inputs

- FABLE doubt 3 premise is wrong: the S23 (v73) HAS HMX - the HMX reader ran on S23 at pp512 851.5 one-copy (raw)
  vs 876.4 two-copy (ALIVE ~885-888). The open question is HMX from the TILED HOST buffer, on v73 first.
- FABLE challenge accepted: the S23 shipped CPU decode baseline is the no-repack generic path
  (`rn-llama.cpp:245-247`), not repack 4x8; step 1 measures against it.

## Steps (each: implement -> verify on disk -> one hostile audit -> S23 check -> next)

| # | what | gate to pass |
|---|---|---|
| G | e1 FIRST, no new kernel: NPU from the tiled HOST buffer (existing `feat/governor-onecopy` HOSTBUF_REPACK path, made to really execute; log proves packing happened) | S23 pp512 and tg128 >= 0.95 of two-copy (876 / 22.1), KLD equal; else try uncached rpcmem once, then stop and report |
| 0 | A1 tile header, Hexagon calls the shared packer | packer bit-equal to the old one; NPU numbers unchanged |
| 1 | A2 marker + CPU tile reader (spike kernel) + refusal of other ops on TILE32 | host 2-layer graph logits == native; S23 tg128 CPU tiled vs today's no-repack and vs repack, 1 and 5 threads |
| 2 | A3 placement default, no-mmap, env -> setter | loader test (all Q4_0 MUL_MAT in HOST, token_embd on CPU, no CPU_REPACK); S23 RSS, load time cold/warm |
| 3 | A5 weight-copy guard | unsupported op on TILE32 fails reserve with the tensor name |
| 4 | A6 OpenCL import + v4 kernel | S23 alias PASS on real buffers; GPU-leg tg128 + per-op time + CPU zone temps at -t 1 (e3: does the CPU rest?) |
| 5 | A4 leg contexts + third leg in the hop switch | 32-token hops CPU->NPU->GPU->CPU, KLD vs two-copy over 256 tokens |
| 6 | binding one-model load + table + fallback | APK on S23: one load, 3 legs, RSS; Jelly (UX session's phone, ask first): log identical to today = R2 negative control |

R1 for other phones: QDC 8 Elite (v79, Adreno 830) after step 2 (HMX from tiles, v4 compile + alias); Xiaomi 14 only
with the owner's ok (daily driver). No row before its report.

## Open risks (cheapest check)

- e3 GPU leg heat: in a real token the CPU still runs attention, norms, conv and the 205 MiB Q6_K lm_head; the
  03/10 GPU arm kept CPU zones ~90 C at -t 5 (61-67 C at -t 1). Step 4 measures it; if the CPU share dominates, KV and
  lm_head move to the GPU leg (step 5b) - or the GPU leg is not worth it on the S23.
- e4 CPU prefill on tiles (LOWBAT route) may collapse: step 1 pp512; owner decision if it does.
- e6/e7 rpcmem buffer split vs the 884 MB CL cap; no-mmap load time and peak RSS: step 2.
- dma-buf / PSS accounting per vendor (LMK risk): step 6 measures PSS + dma-buf sysfs on the S23.
