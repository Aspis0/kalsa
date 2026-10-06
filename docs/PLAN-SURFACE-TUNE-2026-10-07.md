# Plan — the first start on a slow laptop (Wednesday 2026-10-07)

Owner, 2026-10-05 night: "fai tutto mercoledì". Goal: on a machine like the Surface (i7-1065G7,
Iris Plus, no dedicated GPU) the first start tunes once, inside the budget, and the result is
saved the first time.

## Where we are (measured on the Surface 2026-10-05, build 43740d87)

- The drafted pass now sweeps the off-winner and every shape reading the prompt ≥5 % faster
  (`crates/kalsa-tune/src/passes/mod.rs`, `PREFILL_EDGE`): 16 → 10 lifetimes. The tune line says
  "up to N min", then "about N min left", never climbing.
- Each lifetime costs ~2 min there. First tune: 9 of 10 ran, the budget (1080 s,
  `crates/kalsa-tune/src/measure/mod.rs`) stopped `graphics + drafter 4`, the verdict was
  "unfinished (Sweep) — withheld once", and the next start ran the WHOLE tune again (18.6 min) and
  pooled it (`src-tauri/src/tune_step.rs:378-420`). First use ≈ 37 min across two starts.
- Winner: processor 8 threads + MTP 3, reply 70.0 s vs 77.0 s off (−9 %).
- MTP on the Iris (Vulkan `graphics` shape): `refused (NoUsableAnswer)` at n=2 and n=3 in the first
  tune; in the second, one setting measured 3 tok/s, one refused. Its off lifetime answers
  (prompt 25 tok/s, decode 5 tok/s).
- Vulkan off numbers: graphics 88.4 s, mixed (`-ngl 0`) 84.0 s, CPU 4T 87.0 s, CPU 8T 77.0 s. On
  2026-10-01 (LFM 2.5) the mixed shape won on the same machine; with Gemma E4B it does not.

## Steps

### 1. Lab: why MTP on the Iris gives no usable answer
Run `kalsa-server` by hand on the Surface with the E4B drafter on the Vulkan build, n=2/3/4, `-lv 5`,
the tune's own decode ask (`crates/kalsa-tune/src/sample.rs` `DRAFT_PROMPT`, 128 tokens). Read
`timings` and `draft_n` / `draft_n_accepted`. Questions: does it finish within the 60 s request
bound at 3–5 tok/s, is the drafter on the iGPU or the CPU (`crates/kalsa-launch/src/argv.rs:68-73`),
is acceptance near zero, is it an engine bug. Deliverable: `docs/LAB-IRIS-MTP-2026-10-07.md` with
numbers, and one decision: fix (engine or launch flags) or never sweep drafted settings on an iGPU
shape.

### 2. Lab: Vulkan on the Iris
Same machine, same model: graphics vs mixed vs CPU, prompt and decode, two runs each, to see whether
any Vulkan shape can ever win Gemma E4B there. If none can, record it — dropping a shape saves one
lifetime plus its sweep on every Iris-class machine.

### 3. A shape whose drafter refuses stops sweeping
In pass two, the first `NoUsableAnswer` (or any refusal) on a drafted setting ends that shape's
remaining settings, and they leave the plan through `lower()`. On the 2026-10-05 tune this saves two
lifetimes (~4 min) and lets the tune finish inside the budget. Test with the Surface's numbers;
mutation proves it.

### 4. A retry measures only what is missing
When the verdict is withheld once, the next start runs only the lifetimes the first attempt did not
complete and pools them with the saved trials, instead of the whole tune. The plan total and the
"up to / about N min" line start from what is left. Test: an unfinished Sweep marker → the retry
runs only the missing drafted settings.

### 5. Walk on the Surface
Move the tuning record aside (never delete), first start from zero: one tune, inside ~18 min,
verdict saved the first time, the second start straight to the door. Close ×3 and minimized idle as
on 2026-10-05.

## Order and gates
1 and 2 first (they may change 3). Then 3 → review → 4 → review (one hostile review each, writer and
reviewer different models, P0/P1 fixed, the rest to `docs/BACKLOG.md`). Then 5. Push to `brain`; no
tags or releases.

## Not in this plan
Windows type-check from the Mac (BACKLOG), the LFM re-download, the download that resumes by itself,
the updater (beta).
