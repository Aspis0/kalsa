# q53b — v73 batch-size discriminator for the trunk-NPU death (PREREG)

**Status: LOCKED at commit time.** Owner: "Manda" 2026-08-25. Follow-up to
q53 (FAIL): the LFM-B′ HTP perplexity arm died at chunk 2-3 with
`dspqueue_write 0x1` under `-b 2048 -ub 1024`, while the same model+build ran
clean at llama-bench pp512 (q46). Question: **is the death batch-size-bound?**
This cell does NOT re-litigate q53's verdict; it only characterizes the lane
for the router ledger and the upstream report.

## Arms (same device, model, binary, corpus, pins as q53 — re-verify shas)

| arm | flags (only these differ from q53 lane 1 HTP) | chunks |
|---|---|---|
| b512 | `-b 512 -ub 512` | 32 at `-c 2048` |
| b1024 | `-b 1024 -ub 512` | 32 at `-c 2048` (only if b512 survives) |

Execute-op proof required per arm (`-v` on the measured arm this time, audit
recommendation). CPU-ref: REUSE q53's 32.4892 ± 0.665 (same corpus/chunks/ctx;
batch size does not change the CPU reference in exact arithmetic — record any
mismatch if a fresh CPU run is done, but it is not required).

## Outcomes (frozen)

- **SURVIVES-512**: b512 completes 32/32 with finite PPL → compute
  `r = PPL_b512 / 32.4892 − 1`, apply q53's numeric gate (PASS ≤2%, GREY 2–5%,
  FAIL >5%) as a **characterization**, not a certification: the lane is
  "batch-bound: correct/incorrect at ≤512". Then run b1024 to bracket the
  threshold.
- **DIES-512**: abort at any chunk → the death is not batch-bound at this
  granularity; lane stays dead; signature recorded (same 0x1? or new?).
- Any silent CPU fallback (proof lost) → VOID for that arm.

## Hygiene

As q53: unplugged declared or plugged declared (not a speed cell), cool-start
≤35 °C, sha on device before first run, cpuset of the binary pid, LF scripts,
no model pushes, runs from `adb shell`. Outputs in this directory:
RUN_LOG.md, manifest.json, raw/, REPORT.md (numbers only).

## Also in the same device session (q53 lane 2 completion — under q53's own
locked PREREG, not this one)

Complete q53 lane 2 (Qwen3.5-4B-Q4_0 hybrid): HTP PPL 32/32 (`-v`), CPU-ref
32/32, r and the q53 gate arithmetic, appended to q53's REPORT.md as
"lane 2 (session 2)". If the HTP arm dies, record the signature — it becomes
a data point for the batch question too.
