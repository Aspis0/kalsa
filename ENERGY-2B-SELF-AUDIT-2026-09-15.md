# Self-audit — "Fase 2b first experiment: taskset sweep" as proposed by the orchestrator

Auditor: the orchestrating agent (self-audit, adversarial). Date: 2026-09-15.
Worktree: `/Users/marco/Projects/kalsa-ngram-spec`.
Subject: the proposal to open Fase 2b with a `taskset` core-placement sweep on the
Jelly Star, read through the Tema-1 per-phase sidecars.

Every finding below rests on a command actually executed in this session, quoted with
its output. Nothing here is inherited from a document.

## Verdict

**NO-GO as proposed.** The proposal is not wrong in direction, but three of its
load-bearing claims are false or unverified, and one missing measurement (a
repeatability floor) makes any result it could produce unfalsifiable. It becomes GO
only after step 0 below, and after the framing in F7 is accepted.

Retracted by this audit (all three were stated by the orchestrator earlier today):

| # | claim I made | status |
|---|---|---|
| R1 | "a 23 % effect is an order of magnitude above our noise floor" | **FALSE** — see F1 |
| R2 | "the sweep needs no code, it is a `taskset` wrap" | **FALSE** — see F3 and F6 |
| R3 | "three arms: A55-only / A76-only / all" | **WRONG SHAPE** — one of the three is the current baseline — see F4 |

## F1 — BLOCKER. No validated minimum detectable effect exists for this metric

Command: `j_per_tok_decode` range per stem, read from the four committed sidecars in
`device-ngram-spec-out/*.phases.csv` (schema `kalsa-energy-rep-v2`).

```
LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE      J/tok 0.1830-0.2420  spread 29.06%
LFM2.5-1.2B-Instruct-Q4_K_M_none_REP       J/tok 0.2930-0.2950  spread  0.68%
LFM2.5-2.6B-Q4_K_M_none_PURE               J/tok 0.6080-0.6720  spread 10.06%
LFM2.5-2.6B-Q4_K_M_none_REP                J/tok 0.6450-0.6530  spread  1.23%
```

The 1.2B/REP figure (0.68 %, coverage 95.1 %) is the number I quoted as "the noise
floor". It is a **within-arm, within-session, three-rep spread** — it bounds nothing
about a between-arm comparison, and it is contradicted by the third row.

**2.6B/PURE spreads 10.06 % across three reps while passing every published gate**:
coverage 96.7–96.9 %, and its only row warning is the sampler cadence (max 3.020 s),
not low resolution. The published contract (`docs/ENERGY-SCHEMA.md:113-119`,
`:128-136`) treats coverage and the low-resolution warning as the quotability gate for
this cell. That gate does not bound repeatability.

The project's own register records worse, on adjacent benches:

- `archived/docs/HARNESS_FINDINGS.md:2539` — "consecutive-run variance on that rig
  reached **±50 %** (3.99 → 8.27 t/s), so speed claims there need ABBA pairs".
- `archived/docs/HARNESS_FINDINGS.md:3664-3673` — two arms that were **byte-identical**
  measured run-to-run reproducibility instead, and the second arm never exceeded
  4.12 tok/s against the first arm's 16–20 tok/s for its entire hour.
- `archived/docs/HARNESS_FINDINGS.md:1618` (§7.6) — thermal drift runs *inside* the
  arm; "the first arm of a session is the fastest by construction".

Those benches are not this harness (they are the app-turn bench, over hours, not a
CLI arm over minutes) and the Jelly is documented elsewhere as thermally flat. So this
is not a measurement of our exposure. It is a demonstration that **this project has
been burned by exactly the failure mode an A/B on this metric would walk into**, and
that no repeatability number for this harness was ever taken.

Consequence: before any sweep, run the null experiment described under "Step 0". Until
then any taskset result is unfalsifiable.

## F2 — Coverage and warnings are not repeatability certificates

Follow-on to F1, recorded separately because it changes the schema contract. The
10.06 % spread in F1 sits on a row that passes every published gate. I deliberately do
not name a cause: the 2.6B/REP row has a coarser cadence (max 3.520 s) and a *lower*
spread (1.23 %), so cadence alone does not explain it.

Consequence: if the sweep proceeds, the analysis must carry an arm-level repeatability
figure. The per-rep sidecar has no column for it (19 columns, `PHASES_COLUMNS` in
`scripts/energyPhaseSplit.mjs:88-92`), so this is either a v3 addition or a harness-side
artifact. It cannot stay implicit.

## F3 — FALSE CLAIM (R2). The lever is compiled out on Android, and the app has no pinning

Command: grep for affinity in the pin's CPU backend.

```
ggml/src/ggml-cpu/ggml-cpu.c:2445  // Android's libc implementation "bionic" does not support setting affinity
ggml/src/ggml-cpu/ggml-cpu.c:2447  #if defined(__gnu_linux__)
ggml/src/ggml-cpu/ggml-cpu.c:2515  #else
ggml/src/ggml-cpu/ggml-cpu.c:2517  static void set_numa_thread_affinity(int thread_n) { UNUSED(thread_n);  }
ggml/src/ggml-cpu/ggml-cpu.c:2518  static void clear_numa_thread_affinity(void) {}
ggml/src/ggml-cpu/ggml-cpu.c:817   #if defined(__gnu_linux__)   // ggml_get_numa_affinity
ggml/src/ggml-cpu/ggml-cpu.c:825   #else  → returns 0
```

Android defines `__linux__`, not `__gnu_linux__`, so ggml's entire thread-affinity
path is compiled out on our target, next to an explicit comment citing bionic.
Independently: `grep -rnE "affinity|Cpus_allowed|taskset" src/engine/*.ts native/bmoe/`
returns nothing — **the app does not pin threads today**.

Two consequences, both of which I had wrong:

1. The harness arm is not a wrap of existing code; the campaign harness
   (`scripts/device-ngram-spec.sh`) has one invocation shape and a new arm changes it.
2. *Shipping* an affinity lever means changing ggml's Android path in the fork that
   must keep the app's engine byte-identical by default — a new mechanism, subject to
   the prior-art rule. The stub plus its comment is evidence that someone already
   considered this on Android and stopped; the prior-art pass must say why our case
   differs, or we drop the shafting half and keep only evidence.

## F4 — WRONG SHAPE (R3). The baseline already runs on the big cluster

Command: mean `scaling_cur_freq` per CPU over the campaign window, from the
`cpu_freqs_kHz` column of `device-ngram-spec-out/LFM2.5-2.6B-Q4_K_M_none_REP.csv`.

```
cpu0 620 MHz  cpu1 620 MHz  cpu2 621 MHz  cpu3 618 MHz  cpu4 620 MHz  cpu5 624 MHz
cpu6 2159 MHz cpu7 2159 MHz
```

Device topology, read on the Jelly:
`cpu0-5 max=2000000 kHz` (A55), `cpu6-7 max=2200000 kHz` (A76).

So the campaign's `-t 2` decode already lands on both A76s at ~98 % of their maximum
clock, and the six A55s sit near idle. The "A76-only" arm is therefore the current
configuration, not a treatment. The real sweep is **two points**, and the interesting
one is A55-only — which is exactly MNN-AECS's lever.

This is also the good news in the audit: the baseline is the *latency-tuned* point, so
an energy policy has to beat a tuned configuration rather than a strawman.

## F5 — The three levers are not interchangeable, and I conflated them

`n_threads` (how many workers) is not `taskset` (where they may run) is not ggml NUMA
affinity (which node). MNN-AECS selects *where*. A `taskset` sweep tests "where" but
does not test what an in-app policy could do unless the app first acquires an affinity
lever (F3). Evidence that the count knob is real and already split:
`src/engine/deviceTuning.ts:136-142` exposes `n_threads` and `n_threads_prefill`
separately, the latter wired to `ContextParams.n_threads_batch`.

## F6 — FALSE CLAIM (R2, second half). New arms produce no metric without a manifest decision

Command: read the tool's count resolution path.

```
scripts/energyPhaseSplit.mjs:218  splitStem(stem, { ... manifestEntry, cliPromptTokens, cliGenTokens })
scripts/energyPhaseSplit.mjs:299  const promptTokens = perf.promptTokens ?? manifestEntry?.promptTokens ?? cliPromptTokens ?? null;
scripts/energyPhaseSplit.mjs:355  "decode duration not derivable (needs gen token counts ...)" warning
scripts/energyPhaseSplit.mjs:398  if (genTokens > 0 && decJoules !== null) row.j_per_tok_decode = ...
scripts/energyPhaseSplit.mjs:525  const manifestEntry = manifestByStem.get(stem);
```

The counts manifest is keyed by stem (`${model}_${arm}_${prompt}`, parsed at
`:159-215`). A pinned arm is a new stem, so it has no manifest row, so `gen_tokens`
falls through to `null`, so `j_per_tok_decode` is **not computed at all** and the row
carries the "decode duration not derivable" warning. There is no metric to compare.

Making it work requires a decision that must be argued and audited, not assumed: the
prompt and `n_predict` are unchanged by `taskset`, so the counts are *claimed* to be
identical — a claim that needs its own evidence (the greedy-text gate at minimum), plus
a policy for the by-construction pairing warning at `:319-325`, since
`campaign_gen_tps_rN` will differ from the pinned arm's speed line.

## F7 — The effect would be a reproduction, not a contribution

MNN-AECS's mechanism is, verbatim from the abstract: "dynamically selecting low-power
CPU cores" during decode, "the first engine-level system solution without requiring
root access or OS modifications". That is this sweep's hypothesis, one engine away.

Prior-art status, checked today:

- No file *name* in `alibaba/MNN` master references AECS; the only commit matching
  "AECS" is `c3cdf189` — "Support smart barge-in with **AEC** for voice chat",
  acoustic echo cancellation, unrelated. No code or artifact link on the arXiv abstract
  page; a single arXiv version (v1, 2025-06-24).
- **Limit of this check, stated plainly:** I searched file names and commit messages,
  not the contents of the whole tree, and the paper's authors are MNN maintainers at
  Alibaba. "No shipped implementation exists anywhere" is therefore **not
  established** — only "not visible in the upstream repository by name or commit".
- CORE's actuator is DVFS ("unified DVFS governor for LLMs", offline profiling of
  frequency combinations, MLSys'26 Oral). An unprivileged app cannot use it. Its
  diagnosis transplants; its mechanism does not.
- MNN-AECS also reports 39–78 % energy saving *against llama.cpp* as an engine
  comparison. The honest baseline for a llama.cpp policy is **our own current
  configuration**, not MNN-AECS.

Consequence: a positive sweep result is a **transfer/validation** result — the AECS
effect reproduced in llama.cpp on hybrid LFM2.5 with phase-resolved battery-terminal
energy. That is worth having and is citable. It is not novelty, and the write-up must
not imply it is. The candidate novelty in this project remains elsewhere: the
split-context prefill/decode handoff as a schedulable object (F9), which neither prior
work has.

## F8 — No transfer to the S23 without re-measurement

G99 is two clusters (6×A55 + 2×A76). The S23 is SM-S911U / kalama, a three-cluster
part, so masks, the low-power set, and the optimum all differ. The result is
device-profile-specific, which is consistent with sequencing the S23 replication first,
and it means a policy needs a per-device profile rather than a constant.

## F9 — The arm changes more than decode

`taskset` applies to the whole process: model load, prefill and decode all move. The
decode bucket stays clean because it is anchored to `mark_N`
(`docs/ENERGY-SCHEMA.md:92-100`), but `j_pre` changes composition and load time changes
the window length, so cadence and coverage shift per arm. Read per row; do not assume
comparable coverage across arms with different decode durations
(`docs/ENERGY-SCHEMA.md:116-119`).

## F10 — The sampler is not in the mask

The on-device sampler (`scripts/energy-sample.sh`) is launched separately via `setsid`
and keeps its own affinity, so it will typically sit on an A76 while a pinned arm runs
on A55s. The measured window therefore has a different idle/SoC composition per arm.
The relative-metric contract absorbs this (between-arm deltas of the same stem are the
sanctioned read), but it makes the "absolute J is not quotable" rule *more* load-bearing
per arm, not less.

## F11 — Operational detail, verified rather than assumed

Toybox `taskset` (0.8.6-android) rejects the `0x` prefix and accepts bare hex:

```
taskset 3f  sh -c 'grep Cpus_allowed_list /proc/self/status'  →  Cpus_allowed_list: 0-5
taskset c0  sh -c 'grep Cpus_allowed_list /proc/self/status'  →  Cpus_allowed_list: 6-7
taskset 0x3f …                                                →  taskset: bad mask '0x3f'
unconstrained                                                 →  Cpus_allowed_list: 0-7
```

It fails loudly rather than silently ignoring the mask, which is the safe failure
direction. Good: the sweep design's arms are all masks over cpu0-5 (0x3f), so
thread-count variation within the A55 cluster is expressible.

## F12 — The slowdown constraint is a product decision, and it is missing

MNN-AECS's objective is energy subject to a bounded slowdown. The bound is not ours to
pick at analysis time. The 2.6B/REP baseline is 71.1 s of decode for 256 tokens; a 30 %
slowdown is +21 s on a chat turn, which is a product change and not a measurement
trade. Fix the number before the sweep, in writing, or the constraint will be
rationalized after the fact.

## Step 0 — the prerequisite, and it needs no policy

**Null experiment.** Same model, same prompt, same flags, same thread count: measure the
*same configuration* interleaved, ABBA-ordered, with N reps large enough to place a
confidence bound, and report the spread of `j_per_tok_decode` across arms that differ
only by run order. That converts F1 from an unknown into a number, and it is the only
way a later taskset delta can be called a result.

Reuse rather than reinvent: `scripts/device-moe-stream-abba.sh` already documents the
ABBA rationale, the consecutive-run variance that motivated it (±50 %, 3.99 → 8.27
t/s), and the `COOL_DC` temperature gate needed where the device has thermal headroom.
That script's header is the design note for step 0.

Results of step 0 decide the shape of everything downstream:

- If the null spread is small relative to an expected effect of the size AECS reports
  (23 % energy at no slowdown), the sweep is worth a campaign slot.
- If it is not, the sweep is not runnable at this sampling resolution and 2b needs a
  different instrument before it needs a policy.

## What would flip this to GO

1. Step 0 executed and reported with a stated confidence bound.
2. F6 resolved: a written decision on the pinned-arm counts (manifest rows plus the
   evidence for count invariance), and an accepted policy for the pairing warning
   at `scripts/energyPhaseSplit.mjs:319-325`.
3. F7 accepted in the framing: the sweep is a transfer/validation of a published
   finding, and the write-up says so.
4. F12 fixed: the slowdown bound in writing, as a product number.
5. F3 decided: evidence-only (harness `taskset`, no engine change) or evidence plus a
   gated Android affinity lever in ggml — the latter only after its own prior-art pass.

## Commands executed

```
awk -F, 'NR>1 && $6!="" {...}' device-ngram-spec-out/LFM2.5-2.6B-Q4_K_M_none_REP.csv   # F4
for f in device-ngram-spec-out/*.phases.csv; do python3 - "$f" …                        # F1
grep -rn "affinity|sched_setaffinity|pthread_setaffinity" tmp/kalsallama-pin/ggml/src/ggml-cpu/  # F3
grep -rnE "affinity|Cpus_allowed|taskset" src/engine/*.ts native/bmoe/                   # F3
adb -s 192.168.1.82:5555 shell 'taskset 3f|0xc0|0x3f sh -c "grep Cpus_allowed_list /proc/self/status"'  # F11
adb -s 192.168.1.82:5555 shell 'for c in /sys/devices/system/cpu/cpu[0-9]; do … cpuinfo_max_freq …'     # F4
grep -n "j_per_tok_decode = |decode duration not derivable|manifestEntry" scripts/energyPhaseSplit.mjs  # F6
grep -niE "repeatab|consecutive.run|bimodal|variance|drift" archived/docs/HARNESS_FINDINGS.md          # F1
curl api.github.com/search/commits?q=repo:alibaba/MNN+AECS                                # F7
git clone --filter=blob:none --no-checkout --depth 1 github.com/alibaba/MNN               # F7
```

No device benchmark was run: the Jelly was charging throughout, and everything above is
either host-side or a read of already-committed campaign data.
