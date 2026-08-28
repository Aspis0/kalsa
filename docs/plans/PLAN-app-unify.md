# Plan — bring the engine into the app, and let the app refuse honestly

Written 2026-08-22, against the numbers in `KALSA.md` §2.1 / §9 and `HARNESS_FINDINGS.md`
§7.27, §7.39, §7.40. Every claim below that is a number is a measured one; where a number is
missing the plan says so rather than guessing.

## What exists, and what it actually does

A hostile audit (2026-08-22) demolished the first version of this section. It is rewritten against
the code, and the corrections stay visible because they change the work.

- `deviceThroughput.ts` computes a per-quant-family bandwidth ceiling; `deviceProfile.ts:163`
  computes a `speedAdvisory`; `AppShell.tsx:2446` records a sample after decode.
- `modelGateVerdict` / `evaluateModelFit` are consumed by `AppShell` and `SettingsScreen`.
- The streaming engine is vendored and compiles (`native/bmoe/`), with a bench arm that turns it on.

⛔ **Three claims this section made, and the audit killed:**

1. **"The gate already answers *will it be usable*." FALSE.** `allowed` depends only on
   `blocked_tier`, `blocked_ram`, `blocked_disk` (`deviceProfile.ts:136-216`). **Speed never causes
   a refusal.** The advisory is decoration — no consumer outside engine files and tests.
2. **The speed question is not merely unanswered, it is unaskable.** `predictTokensPerSecond` needs
   `model.weightsBytesPerToken`, and **exactly one registry entry carries it**
   (`ModelRegistry.ts:299`, the KEXP). For the other eight the advisory returns `"unknown"`. The
   `MB/token` column in KALSA.md §2.1 lives **only in the doc** — the gate cannot read it.
   *Adding MB/token to every entry is a work item this plan did not list at all.*
3. **"§9's limit (d) is closed." FALSE, in both directions.** `recordDeviceBandwidthSample` keeps
   the **maximum** per family and never lowers it (`deviceThroughput.ts:68-71`; the merge helper
   says so outright: *"without ever lowering a ceiling"*). The family key is the registry `quant`
   **label**, so on the Jelly `q4_k_m` holds both the 8B (4.23 tok/s × ~1030 = 4.4 GB/s) and the
   2.6B (5.68 × 1666 = 9.5 GB/s) — a **2.2× spread inside one family on one phone** — and the max
   keeps 9.5, predicting the 8B at ~9.2 against 4.23 measured. Worse on the S23, where the ceiling
   is set by the *sickest* member: Qwen3.5-4B at 8.06 tok/s **while taking 961 major faults per
   token**, × ~2700 = 21.8 GB/s, from which the 8B Q4_K_M — this plan's own "known killer" —
   predicts **21.2 tok/s, clearing the 20 floor**, against 0.26–0.36 measured. Only the RAM gate
   refuses it. **A ceiling learned from a thrashing run blesses the model that thrashes.**

**What does not exist:** any onboarding flow (`grep -rln onboard src/` → nothing), any streaming
awareness in the gate, any *explanation* when the app declines, and `MB/token` for 8 of 9 models.

## Ordering: one honest reason, not a forced one

The first version claimed the order was *forced* — "the constant is learned by decoding, so a fresh
phone has none". The audit called that rationalisation, and it is right. The constant is only
learnable by decoding, but §9's rule (c) sanctions a **prudent default** before any measurement,
and phase 2 below offers the cheaper alternative the argument then denies (*calibrate on the first
model the user picks*). Either lets the recommender precede the micro-test.

The real reason for this order is a product judgement, and is stated as one: **thresholds should
come out of the kill campaign rather than precede it.** A choice, revisable.

What the audit did surface as real work: **today's code implements the opposite of rule (c)** — no
measurement → advisory `"unknown"` → the entire catalogue is admitted. Optimistic, not prudent.
Implementing rule (c) is a work item nobody had written down.

## Phase 0 — de-hardcode the dependency chain (prerequisite, no user-visible change)

Today the port is held together by hand: the engine was copied with `cp`, the ggml hook was
ported by hand and silently lost a line — the `#include "ggml-cpu.h"` the source commit also
carries, found only by diffing against it (commit `13f8582`). ⛔ An earlier draft of this plan
cited that note as living in §7.40; **it does not, and the citation was fabricated.** The patch is
regenerated manually. Three of my own errors this week came from that.

- `scripts/vendor-bmoe.sh` — re-vendor `native/bmoe/{include,src}` from **`Aspis0/kalsa-forkbigmoeonedge`**
  at a pinned ref, then `npx patch-package llama.rn`.
- `scripts/derive-ggml-hook.sh` — re-derive the hook from **`Aspis0/kalsallama`** by
  `git diff <base>..<head> -- ggml/src/ggml-cpu/ggml-cpu.c ggml/include/ggml-cpu.h`, applying the
  `lm_` prefix. Never re-type.
- A CI check that **fails** when `native/bmoe/{include,src}` differs from the pinned upstream, and
  when the patch does not contain the derived hook. Drift must break a build, not a measurement.
- Refs live in one file (`native/bmoe/UPSTREAM.json`: repo + ref per source), nowhere else.

Exit: bumping either upstream is one command plus a green CI, and a stale copy cannot ship.

## Phase 1 — the kill campaign (measurement, app running, no new features)

This is the phase the owner asked for first, and it is deliberately before the recommender:
the recommender's thresholds should come from it, not precede it.

**Question:** with the app running, which (model × quant × phone) gets killed, when, with how much
RAM, and does streaming change it?

Both phones. Per turn record: `RssAnon`, `RssFile`, `MemAvailable`, `majflt`, decode tok/s,
prefill s, battery, temperature, **and the process's core count** (`nproc`) — §7.40 lost two S23
runs to core loss that battery temperature could not see.

| arm | model | why |
|---|---|---|
| A | LFM2.5-8B-A1B Q4_K_M | the known killer: 100 % resident, 0.92 GB `MemAvailable`, lmkd at turn 8 (§7.27) |
| B | LFM2.5-8B-A1B-KEXP | 3.33 GB, survives on both phones; 7.31 tok/s Jelly, ~22 S23 |
| C | LFM2.5-2.6B-QAD-Q4_0 | best quality/size we have; **never measured on an S23** (§9's starred gap) |
| D | Qwen3.5-2B Q4_K_M | the competitor, and the one whose **prefill never drops** (§7.28) |
| E | arm A + streaming | does bounding RAM stop the kill? §7.39 says footprint becomes *anon* and unreclaimable, so this may make it **worse** — that prediction is the test |

⛔ **Two arms violate this phase's own "no new features" rule, and the audit caught both.**
*Arm C* named LFM2.5-2.6B-QAD-Q4_0, which had **no registry entry** — ~~it needs one plus a download
source before it can be selected at all~~ **(landed; arm C ran on both phones 2026-08-23)**. It also substitutes the QAD quant for the Q4_K_M that §9's starred gap is actually about,
so it answers a neighbouring question, not that one. *Arm E* needs streaming **in the app**, and
§7.40's own caveat says the glue has never executed on a phone — a prerequisite with no owner in
any phase. Given that commit `44f6035` found a live bug in that glue (a failed init unwinding into
decode-on-zeros) **by audit rather than by running it**, first on-device execution is a risk item
that needs its own step, before phase 1 assumes it works. Arm E is further constrained: the app's
bench arm deliberately excludes both drop knobs, so it can only run streaming **lossless**, while
§7.39's memory-shape prediction was measured with the lossy config. E as written measures a
different configuration from the finding it is meant to test.

Run to the plateau, not turn 1 — §7.23 shows the achieved rate decays *within* a session, and
three wrong headlines in one day came from two-turn numbers.

---

**STATUS 2026-08-23 — phase 1 ran. Results in KALSA.md §2.1.1 and HARNESS_FINDINGS §7.41–§7.42.**

| arm | outcome |
|---|---|
| A production | **refused before loading** (`blocked_ram`) — §7.11 confirmed through the user path |
| A `norepack=1` | 7 turns at **0.26–0.29 tok/s**, 1.74 M majflt, battery 51 % → 11 %, then doze |
| C, S23 | **16/16**, 19.2 → 14.1 tok/s (−26 %) |
| C, Jelly | **16/16**, 7.2 → 5.5 tok/s (−24 %) — first mainline-build arm on that phone |
| B, D | not run — S23 battery exhausted |
| E | **not runnable, see below** |

⛔ **The `killed at turn N` column this phase asked for is empty, and that is the answer.** Nothing
was killed. `MemAvailable` never moved on any arm that ran. §7.27's lmkd-at-turn-8 regime needs
repack ON to make the footprint anonymous — and with repack ON the gate refuses the model, so the
two states are mutually exclusive through the app. What ends a run is the gate, the battery, or the
plan finishing.

⛔ **Arm E could not run at all, and the reason was not in this plan.** `MoeStream::arm()` forces
`no_extra_bufts = true` — streaming *disables* repack, because repack would change the byte layout
the file offsets describe. The gate reads the `norepack` pref, not `moeStream`, so it charges the 8B
4401 MiB for a repack that streaming would have removed and refuses before the engine is reached.
The plan named "no streaming awareness in the gate" as a gap; this is that gap blocking its own
measurement. **Arm E needs the gate to know about streaming — that is a code change, not a run.**

✅ **The prerequisite this phase listed with no owner is done:** the streaming glue executed on a
phone for the first time (S23, KEXP), armed, bound, and produced a coherent reply. Evidence is from
the kernel, because success is silent by design.

Two arms remain: **B (KEXP)** and **D (Qwen3.5-2B)**, both blocked only on a charged S23.

**E is the one that can surprise.** §7.39 predicts streaming makes the 8B easier to kill; §7.40
shows streaming is the only way a >RAM model runs at all. Both can be true, and the boundary
between them is what E measures.

Exit: a table in §2.1 with a `killed at turn N` column, and a measured answer for E.

## Phase 2 — onboarding that measures instead of asking

**The micro-test must not need a multi-GB download.** Ship one tiny calibration GGUF (the smallest
thing that produces a real decode) or calibrate on the first model the user picks and treat the
pre-calibration state as *unknown*, never as *fine*.

What it records: the device constant per quant family, `MemAvailable` under load (not total RAM —
the Jelly has 7.97 GB and still dies), and core availability.

**Three limits from §9, built in from the start, not retrofitted:**
- measure on a **fresh chat** and keep the result as a **ceiling** — the rate decays in-session;
- apply a **margin**, do not gate on the raw number;
- a short test measures the **peak**, not the plateau. On the S23 today the same arm read 5.9 tok/s
  cold and 2.5 hot. Either run long enough to touch throttling, or **declare that it did not**.

## Phase 3 — recommend, and refuse out loud

Scope now: **LFM2.5 and Qwen3.5 only.** The giant MoEs stay research vehicles — §2.1's own rule.

- A model that cannot run is **not offered and not downloadable**. Hiding the button is the point;
  a gate the user can walk past is decoration.
- **The gate must be able to say "none".** KALSA.md already records that on Jelly-class silicon
  nothing measured clears even 10 tok/s (best 7.31), so "that class is a testbed, not a target". A
  recommender that always names a winner is lying on that phone.
- **Every refusal and every downgrade is stated and justified, in the user's words** — owner's
  requirement. Not a silent fallback: *"switched to KEXP: the 8B needs 4.6 GB that cannot be paged
  out and this phone has 0.9 GB free; it was killed at turn 8."* The reason is a measured fact
  about **this** phone, never a generic apology.
- **What the app does when the answer is "none" is undefined, and on Jelly-class silicon that is
  the expected answer for every catalogue entry** (best measured 7.31 tok/s against a 10 floor).
  An app that recommends nothing and then does nothing is a dead install. Options — all product
  calls, none of them the code's: ship anyway with the honest number stated up front; offer the
  fastest model as an explicitly-degraded mode; or say the phone is not supported. **Decide before
  building the gate**, because a gate whose refusal path is undesigned will be quietly bypassed.
- Re-evaluate over time, not once at onboarding: a decision frozen at first launch is wrong as soon
  as the load changes.

## Phase 4 — VL-3B (explicitly after the above)

`LFM2.5-VL-3B` is the named quality tier and is **still absent from `ModelRegistry.ts`**, so the
tier has never been testable on any phone. The mmproj infrastructure already exists in `AppShell`.
Deferred by owner decision until the text models are settled.

## What is deliberately NOT in this plan

- **The Adreno OpenCL kernels.** They are real work (four compiler miscompiles, novel q2/q3 MoE
  kernels) but they are not in the app, and on our two phones they would change nothing: the Jelly
  is Mali, and on the 740 the verdict is cool-mode only (−19 % speed, −2.75 °C). The 750-class
  prefill win (2.5×) is the reason to port them **later**, into the single llama.rn tree, per
  the one-kernel rule.
- **Streaming as a product default.** §7.39/§7.40 bound it precisely: it is 19.5× on a model that
  does not fit and a 3.6× loss on one that does. Until phase 1 arm E, it stays bench-only.
