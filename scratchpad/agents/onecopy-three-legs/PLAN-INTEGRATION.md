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

## Revision 1 (Fable critique, b1fb0210, 2026-10-04) - adopted

- HMX consumes the same tiles (`hmx_mm_2d_f32` DMAs `tile_size` 576 B; dequant reads scales at `tile_src + 512`,
  `hmx-mm-kernels-tiled.h:37,48`): layout is not the HMX risk on any generation; the memory path is (gate G).
- Gate G needs a loader change: non-mmap host buffers are filled by `read_raw` (`llama-model-loader.cpp:1668-1670`),
  never `set_tensor`, so the tiled-HOST pack never ran. G = loader routes packing host bufts through set_tensor +
  three non-verbose proof lines in one log (HOST buffer size, DSP `q4_0_tiled-f32` profile tag on decode,
  `hmx-mm-2d` on prefill). Forwarded to GLM 1ca4c880.
- Step 2 adds an MBUF cap: Hexagon `opt_mbuf` is 1 GiB (`ggml-hexagon.cpp:96`) > the S23's 884 MB CL max alloc; the
  binding caps the Hexagon buffer size to the CL max before load so every HOST buffer is importable.
- Self-tests test the PATH, not a row: per leg at load - GPU alias check after the publish sync; a 32-token decode on
  each leg with KLD against the CPU leg; a tok/s floor recorded in the table row (e.g. GPU leg >= 0.8x two-copy GPU
  decode). Below the floor = leg off for the session.
- The table is the ONLY allow-list: the engine's generation list (`llama-governor-policy.cpp:301-307`) and the app's
  (`governorInputs.ts:117-120`) read from it or are deleted in step 6. The GPU driver match gates the GPU leg only.
- A2's CPU refusal must exist before any HTP admission gate is used (`ggml_hexagon_op_htp_only` treats HOST as
  CPU-readable and could release a tiled op to a CPU that cannot read tiles).
- Step 5 host test: no norm-pinned node (`llama-context.cpp:2637-2638`, keyed on `dev_layer(il)`) lands on a backend
  the leg context lacks.
- Order: env -> setter (step 2) before any APK run of the one-copy path. R2 negative controls: Jelly (non-Snapdragon)
  AND an untested Snapdragon with no row (stronger) - Xiaomi 14 only with the owner's ok.
