# Plan — bring the engine into the app, and let the app refuse honestly

Written 2026-08-22, against the numbers in `KALSA.md` §2.1 / §9 and `HARNESS_FINDINGS.md`
§7.27, §7.39, §7.40. Every claim below that is a number is a measured one; where a number is
missing the plan says so rather than guessing.

## What already exists (checked, not assumed)

- `deviceThroughput.ts` already does the §9 calibration, **including per-quant-family bandwidth**
  (`quantizationFamilyFor`) — that was §9's limit (d) and it is closed.
  `MODEL_SPEED_FLOOR = 20`, `MODEL_SPEED_DEGRADED_FLOOR = 10`.
- `deviceProfile.ts:163` already folds `modelSpeedAdvisory` into `modelGateVerdict`, so the gate
  already answers *will it be usable*, not only *will it fit*.
- `AppShell.tsx:2446` already records a bandwidth sample after decode. The constant is learned.
- `modelGateVerdict` / `evaluateModelFit` are consumed by `AppShell` and `SettingsScreen`.
- The streaming engine is vendored and compiles (`native/bmoe/`, `feat/moe-stream`), with a bench
  arm that can turn it on.

**What does not exist:** any onboarding flow (`grep -rln onboard src/` → nothing), any use of
streaming in the gate, and any *explanation* when the app declines or downgrades.

## The chicken-and-egg that decides phase order

The device constant is learned **by decoding**, and decoding needs a model already chosen and
downloaded. So a phone with no history has no constant, and §9's own rule (c) says: until a
measurement exists, use a prudent default, **not an invented one**.

That is why the onboarding micro-test comes before the recommender, and why it must not need a
multi-GB download to produce its first number.

---

## Phase 0 — de-hardcode the dependency chain (prerequisite, no user-visible change)

Today the port is held together by hand: the engine was copied with `cp`, the ggml hook was
re-typed (and silently lost a line — see §7.40's note on `#include "ggml-cpu.h"`), and the patch is
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

Run to the plateau, not turn 1 — §7.23 shows the achieved rate decays *within* a session, and
three wrong headlines in one day came from two-turn numbers.

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
