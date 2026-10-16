# LEARNING-MERGE — the learning-governor plan, FIX 2, and one merged step plan

Read-only design exploration. No file outside this one was edited; no build, no git state change, no device
command. Every claim is quoted from a file on disk with `path:line` + verbatim text.

Owner question being answered (2026-10-16): "C'era il piano di far imparare il Governor no? Si può unire tutto."

---

## 1. What the learning-governor plan says, and what exists

### 1.1 Origin and shape

The plan starts as an owner idea on 2026-10-09, in the lab PLAN's own words
(`/Users/marco/Projects/kalsa-moe-experiments/archived/PLAN-2026-10-16-full.md:401`):

```
- The learning governor (2026-10-09 owner idea): design v0 in `scratchpad/agents/learning-governor/DESIGN.md`
```

The phone memory note records why it exists, in the owner's own framing
(`/Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/governor-learns-speed-when-there-is-headroom.md`):

```
Xiaomi 14 (SM8650) cells #75/#76, 2026-10-09: GPU 21 tok/s but ~3.2 C skin per 1k tokens; NPU 15-16.5 tok/s at ~1.1;
CPU 14.7 at ~7.3. Under HEAT_RANK the NPU is always the cheapest fit leg, so v3 on SM8650 = mostly NPU: cool, not fast.
On the S23 the NPU is both fastest and coolest, so a fixed "always NPU" / "always GPU" choice is wrong on one phone.
```

```
Marco confirmed (2026-10-09, "esatto ottimo... hai la mia stessa visione del governor"): using the GPU to go faster
while there is margin is the job of the governor that LEARNS per device (persisted speed/heat per leg, explores) -
planned after M1, not part of the M1 rule.
```

```
**Why:** the per-SoC legs row is hand-measured and static; speed-vs-heat trade-offs differ per phone and per moment.
**How to apply:** do not tune v3 rows to chase speed; keep rows = measured heat values. Speed-when-headroom is the
learning governor's scope.
```

That is the exact seam this document is about: **FIX 2's hot-NPU → GPU prefill rule is the first decision that
would consume a learned number.**

### 1.2 Stages, as written

`DESIGN.md` is v0.5, dated 2026-10-12
(`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/learning-governor/DESIGN.md:1`):

```
# Learning governor - DESIGN v0.5 (2026-10-12)
```

Its own summary of the whole design for the owner (`DESIGN.md:15`):

```
Nothing decides differently until Stage 2. Stage 0 only records, on your phone and in a private numeric file,
```

The stage list (`DESIGN.md:385`-`:403`, Stage 1-3 outline; Stage 0 at `:64`, Stage 0b at `:243`):

- **Stage 0** — observation only, binding + app, no engine change, no decision change (`DESIGN.md:64`):
  `## 3. Stage 0 - observation only (binding + app; no engine change, no decision change)`
- **Stage 0b** — the Xiaomi pacing lines, app only (`DESIGN.md:243`):
  `## 4. Stage 0b - the Xiaomi pacing lines (app only; owner decision 2026-10-12)`
- **Stage 1** — app, no decision change (`DESIGN.md:385`):
  `**Stage 1** (app, no decision change): `governorLearned.ts` (store, fingerprint, breaker latch), `governorLearnedFit.ts``
- **Stage 2** — engine, default off (`DESIGN.md:388`):
  `**Stage 2** (engine, default off; vendoring + HTP skel rebuild + pin + provenance): `llama-ext.h` params`
- **Stage 3** — the enablement turn (`DESIGN.md:399`):
  `**Stage 3**: SM8650 row `lookahead 10`; app sends ucb / bg.`

The gate between them (`DESIGN.md:383`):

```
sanitizers at construction; no row = off; `thermalHardGate.ts` untouched. Stage 0 adds no decision input, no engine
change and no new engine entry point; it adds one read-only
```

```
Each stage: implement -> verify on disk -> one
hostile audit -> fix -> next. Stage 2 does not start until OPEN 1-6 are closed.
```

### 1.3 What the learning rule actually learns (`DESIGN.md:336`)

```
### 5.6 Learning (summary; detail unchanged from v0.3 where not listed)

Speed: in-engine EWMA per completion at `refresh_decode_legs` (`llama-governor-legs.cpp:282-284` deltas, `>= 2
x hop` rule), seeds in the row (S23 17.1 / 15.0 / 13.0, Xiaomi 16.0 / 21.0 / 14.7). Heat: app-side ridge per phone
over `[npu_k, gpu_k, cpu_k, prompt_k, pre_gpu_k, wall_min, -h_first x wall_min]`, observation from the wake
sample, `y = 30 (h_last - h_first)`, prior = the applied row (stats expose it), n0 = 4, sd 25 %, residual sigma
with a 0.2 C floor, outlier `max(1.0 C, 3 sd)`, forgetting 0.95, sent as `ucb = clamp(max(mean,0) + sd, 0.75,
3) x seed` through `decode_speed_heat` (0 = engine seed) and `decode_speed_bg_c_per_min`; HEAT_RANK's
`decode_heat_per_token` never sent (`policy-hop.cpp:70-71`, `:206` untouched). Store keyed by `Build.MODEL` +
`socModel` (`GovernorBatteryModule.kt:96`) + `Build.FINGERPRINT` (new) + pin + row.
```

Two learned quantities: **speed** (an in-engine EWMA of decode tokens/s per leg) and **heat** (an app-side ridge on
heat-per-token per leg). Both are **decode-phase** quantities.

### 1.4 Owner statements, with dates

From `archived/PLAN-2026-10-16-full.md:401`-`:425` (one long bullet, quoted in the parts I rely on):

```
Owner 2026-10-12 ("va bene a tutto"): speed while
cold, heat (HEAT_RANK) once warm; heat learned per phone in the app, speed live in the engine; no
exploration in v0; Xiaomi first, S23 as the null control, row-less phones out of v0.
```

```
Owner corrections
for the revision: the margin uses BOTH sources but not a plain minimum ("il minimo è troppo
conservatore") - the Android forecast reads 0 below SEVERE - 30 (Xiaomi: 36.5 C), so there the
component zones decide; real life (pauses, cooling, reloads, other apps, background load) must not
break it: live margin every window, an "everything else" heat term + outlier rejection + forgetting,
a surprise breaker (actual rise faster than predicted -> GPU off for the session), Stage 0 data from
real use.
```

```
v0.2 (2026-10-12, same
folder) answers AUDIT-1; owner on its questions: (1) Xiaomi pacing lines raised: start at skin 39.0 C,
full at 42.6 C (the S23's 3.6 C ramp), i.e. headroom 0.083 / 0.203 with SEVERE 66.5 ("si 39"; 41 / 44
is the fallback if Stage 0 shows the GPU learns too little).
```

```
(2) "blind forecast abstains, zones decide; when it speaks both must pass" approved ("mi piace, poi
testiamo"); (3) Stage 0 private numeric log file on the owner's Xiaomi approved (no model text, no user
content).
```

```
Starting values approved by the owner 2026-10-12 ("se hanno senso si"):
breaker latch 6 h, blind cap 2048 tokens, lookahead 10 s - all re-checked against Stage 0 data before Stage 2;
the blind cap must count across the tool rounds of one turn, not reset per completion (AUDIT-3). Open owner
question: repeat cell 75 (3 runs per leg) before Stage 3.
```

From the memory note (2026-10-12):

```
Marco approved the shape ("va bene a tutto")
but: no plain minimum of the margin sources (too conservative; the Android forecast is blind below SEVERE - 30, so
zones decide there), and it must survive real life - pauses, cooling, reloads, other apps: live margin, an
"everything else" heat term, a surprise breaker, Stage 0 data from real use. "Se scritto bene e pulito potrebbe
funzionare."
```

### 1.5 What is BUILT

**Stage 0, binding.** Five commits, all ancestors of the binding HEAD `7d15f8fe`, verified:

```
$ for c in 9f6ca8de 2461d845 af64d636 861a3cc3; do git merge-base --is-ancestor $c HEAD && echo "$c ancestor-of-HEAD"; done
9f6ca8de ancestor-of-HEAD
2461d845 ancestor-of-HEAD
af64d636 ancestor-of-HEAD
861a3cc3 ancestor-of-HEAD
```

What each one was, from `git show`:

- `9f6ca8de` (2026-10-12 10:08), "Eight items from the hostile audit of 1f1c718e; still observation-only,
  vendor/cmake/android untouched, no decision change." Highlights: stale forecast age fixed
  (`the freshness stamp now stores inside the headroom_due block, before the unchanged-value early return`),
  battery tag JSON quoted, torn stats read fixed by `stats_with_samples()` returning both under one hold, and
  the leg marker fix `observed_leg maps GPU_COOLMODE to the explicit marker 3 instead of unknown -1`.
- `2461d845` (10:26), "Five residuals from the re-audit of 9f6ca8de; still observation-only,
  vendor/cmake/android/ios untouched, header-only, no decision change." The staging split:
  `the window is now STAGED at its boundary (stage_window) and COMMITTED only once the decode step it precedes
  returned rc 0 (commit_window from decode)`.
- `af64d636` (10:41), "Three residuals from the third re-audit; still observation-only". Its bench fix was later
  **rejected**.
- `861a3cc3` (10:48), "Coordinator rejection of the bench fix in af64d636:
  resetGovernorPrefillStats reaches llama_governor_reset_prefill_stats, whose engine body resets the
  route, hop clock, forced_window_, decode hop policy, legs and prefill stats
  (llama-governor-runtime.cpp) - engine behavior the bench must not change. Stage 0 observes."

The record itself, as specified (`DESIGN.md:79`-`:91`):

```
struct rn_window_sample { uint32_t tokens; int8_t leg_prev;            // 0 cpu 1 gpu 2 npu, -1 none
    float headroom; int32_t headroom_age_ms; int32_t status; int32_t status_age_ms; int32_t app_age_ms;
    float cpu_hot_c, npu_hot_c, gpu_hot_c; float duty_last; };          // 11 cells; NaN/-1 = unknown
struct rn_leg_trips { float cpu_min_c, cpu_max_c, npu_min_c, npu_max_c, gpu_min_c, gpu_max_c; };
struct rn_battery_sysfs { bool temp_ok; int32_t temp_tenths_c; bool status_ok; int8_t status; };  // 3.1 probe
class rn_governor_samples {           // decode-thread only, under rn_governor::engine_mutex_
  void set_trips(const rn_leg_trips &);                // once, at init_hop_reader
  void reset(int64_t now_ms);                          // completion start: ring empty, stamps 0, latch open
  void first_step(int64_t now_ms, const rn_window_sample & snapshot, const rn_battery_sysfs &);  // once
  void last_step(int64_t now_ms);
  void record(const rn_window_sample &);               // ring of 256, overflow flag
```

and the cadence (`DESIGN.md:102`-`:108`):

```
**Hooks in `rn-governor.cpp`.** `before_decode_batch` (`:164-185`): at `n_tokens == 1` and mirror 0, `first_step`
with the snapshot and one battery sysfs read; at every multiple of the hop (`:181`) `record` a sample whose
`leg_prev` is the engine's current decode engine read with `llama_governor_get_stats` on the held lock
```

**Stage 0, app.** `src/engine/governorObservation.ts`, `governorObservationLog.ts`,
`governorObservationRead.ts` all exist on app main `5ebc7241`. Storage and cadence, verbatim from the code:

`/Users/marco/Projects/kalsa/src/engine/governorObservation.ts:67`-`:106` (the row type):

```
export type GovernorObservationRow = {
  v: 1;
  t: string;
  round: number;
  attempt: number;
  gap: 0 | 1;
  fp: { model: string; soc: string; pin: string };
  first_row: 0 | 1;
  state: string;
  src: string;
  status: number;
  batt: number;
  level: number;
  plugged: 0 | 1;
  prompt_n: number | null;
  pred_n: number | null;
  pred_ms: number | null;
  pps: number | null;
  /** Monotonic ms stamps of the completion's first and last decode step
   * (0 when no step ran — a stopped or paused-first-batch completion). */
  wall: [number, number];
  /** 13 cells, the decode_window_samples column order. */
  first: Array<number | null>;
  /** [temp_ok, temp tenths C | null, status_ok, status | null]. */
  bsys: Array<number | null>;
  /** Platform forecast headroom the policy last read (null = none). */
  hl: number | null;
  duty: number;
  paced: [number, number];
  tok: [number, number, number];
  /** Per-leg decode time in microseconds (deltas across rows). */
  us: [number, number, number];
  hops: number;
  rule: string | null;
  /** Passive-trip range in C per leg (null = leg without zones). */
  trips: Array<number | null>;
  /** One 13-cell row per committed hop window, oldest first. */
  win: Array<Array<number | null>>;
  win_ovf: 0 | 1;
};
```

`/Users/marco/Projects/kalsa/src/engine/governorObservation.ts:96`-`:98` — **the per-leg speed that exists is decode
speed**, `tok` is `decode_tokens_*` and `us` is `decode_us_*` (`governorObservation.ts:146`-`:147`):

```
  const tok = tripleDelta(prev, stats, ["decode_tokens_cpu", "decode_tokens_gpu", "decode_tokens_npu"]);
  const us = tripleDelta(prev, stats, ["decode_us_cpu", "decode_us_gpu", "decode_us_npu"]);
```

Storage, verbatim from the file name and the writer (`LlamaService.ts:4891`): `void appendObservation(observationRow);`
into `governor/observations.jsonl` — confirmed by the test
(`/Users/marco/Projects/kalsa/src/engine/__tests__/governorObservationLog.test.ts:112`):

```
    expect(mockFs.writes[0].uri).toBe("/documents/governor/observations.jsonl");
```

with the 4 MB rotate (`governorObservationLog.test.ts:135`):
```
    to: "/documents/governor/observations.1.jsonl",
```

**Stage 0b.** Done and pushed: `archived/PLAN-2026-10-16-full.md:419`:
`**PUSHED 2026-10-15 on the owner's OK:
app main `54c36105` (fast-forward over `357e36d2`, 3 files, rev-list 0/0).**`

### 1.6 What is MEASURED

Two Stage 0 device arms, both observation-only.

S23 (`docs/ALIVE.md:66`):

```
| S23 Stage 0 observation | Six turns vs a `df359450` control; criteria 1–6 passed: seven rows, no gaps, tokens matched prediction, complete windows, forecast age at most 2.3 s. Leg mix was not judgeable; one 32-token GPU window per completion in each arm from turn 2. Native lines were absent, battery sysfs was denied, and app thermo sample age reached 350 s in a paced completion. | archived/ALIVE-2026-10-16-full.md:85 |
```

Xiaomi 14 (`docs/ALIVE.md:67`):

```
| Xiaomi 14 Stage 0 observation | Six turns, eight rows, no gaps; `sum(tok) - pred_n = +1` on each row; forecast age at most 2.65 s over 324 windows. Passive trips: CPU 60–115 C, NPU 100 C, GPU 95 C. Battery sysfs was unreadable; app thermo age reached 503 s. Decode stayed 100% NPU for 10229 tokens, 0 GPU and 0 CPU; speed moved 17.9→3.2 tok/s; skin peaked at 42.2 C; battery moved 79→63%; Android status stayed 0. There was no control arm, so no speed or heat claim. | archived/ALIVE-2026-10-16-full.md:86 |
```

and the scope limit, `docs/ALIVE.md:74`:

```
The S23 and Xiaomi Stage 0 records are observation-only; no controlled speed or heat comparison was made for Stage 0. [archived/ALIVE-2026-10-16-full.md:85-86]
```

Three measurement results that change the Stage 2 design (`xiaomi-stage0-obs-aa789620/REPORT.md:105`-`:113`, `:117`-`:120`, `:124`-`:130`):

```
The Xiaomi's passive trips are finite for all three legs: **cpu 60-115 C, npu 100 C, gpu 95 C**
```

```
`bsys:[0,null,0,null]` on every row: `/sys/class/power_supply/battery/{temp,status}` is not
readable by the app on this phone either, exactly as on the S23.
```

```
The app thermo sample age inside a completion (window cell 6, 324 windows): min 0.58 s, median
108.8 s, **max 503 s** (Xiaomi); **max 350 s** on the S23. A 120 s wall-clock gate therefore
disarms the speed pass for most of every long paced completion, on a healthy phone, with fresh
data - a false disarm.
```

### 1.7 What is OPEN

- **The `>= 20` completions batch is still owed** — `xiaomi-stage0-obs-aa789620/REPORT.md:156`-`:158`:

```
- The >= 20 completions of DESIGN 3.3 (replay statistics, OPEN 6 background/cooling collinearity):
  this arm was deliberately a bounded 6-turn smoke on the owner's daily driver. The app stays
  installed, so the batch can be collected from normal use instead of another heated session.
```

- **The replay tool does not exist.** `DESIGN.md:192` specifies
  `### 3.3 Lab replay (`scratchpad/agents/learning-governor/replay/`)`, and the folder
  `scratchpad/agents/learning-governor/` contains only `AUDIT-1.md`, `AUDIT-2.md`, `AUDIT-3.md`,
  `DESIGN.md`, `DESIGN-ADDENDUM-2026-10-15.md`, `PRIOR-ART.md`, `RECON.md`. **No `replay/`.**
- **OPEN items 1–6 must close before Stage 2** (`DESIGN.md:383`); 1 and 4 are closed by the Xiaomi arm
  (`archived/PLAN-2026-10-16-full.md:421`: `OPEN 1 is CLOSED - the Xiaomi's passive trips are finite for
  all three legs` / `OPEN 4 is CLOSED negatively`). 2, 3, 5, 6 need the replay. 7, 8, 9 need post-enable data
  (`DESIGN.md:357`-`:359`).
- **The owner decision that is still open** (`PLAN.md:271`):

```
- Learning governor: continue from Stage 0 into Stage 2 after the Xiaomi normal-use collection; the owner still has a repeat-cell decision before Stage 3. [archived/PLAN-2026-10-16-full.md:418-425,440-442]
```

- **Stage 0b's own device check is not done** (`xiaomi-stage0-obs-aa789620/REPORT.md:162`):

```
- Stage 0b's own device check (DESIGN 4) still needs an APK built from `54c36105`.
```

### 1.8 WHO CONSUMES THE RECORD — the decisive fact

**Nothing.** Verified three ways:

```
$ ls /Users/marco/Projects/kalsa/src/engine/governorLearned*
NONE
```

The only writers/consumers of `observations.jsonl` are the writer and its tests:

```
src/engine/LlamaService.ts:4891:          void appendObservation(observationRow);
src/engine/governorObservationLog.test.ts:109:    appendObservation(row("7"));
```

`DESIGN.md:410` states the intended state of affairs: `no row = off` — a missing learned row turns the layer off,
so an unread file is not a failure. Stage 1 (`governorLearned.ts`, the consumer) is unbuilt.

---

## 2. Where it overlaps FIX 2, and the recommendation

### 2.1 The overlap is exact and it is the same sentence twice

FIX 2, in the lab's own words (`PLAN.md:208`):

```
2. **FIX 2 — NPU-first prefill.** Prefill on NPU; use GPU only when the NPU zone is too hot. The current policy says the NPU temperature input for prefill does not exist yet. **owner-approved 2026-10-16 (owner, in chat); not committed.**
```

The learning governor's stated job (`memory/governor-learns-speed-when-there-is-headroom.md`):

```
using the GPU to go faster
while there is margin is the job of the governor that LEARNS per device (persisted speed/heat per leg, explores)
```

Both choose a leg per phase from measured speed and heat. FIX 2 makes the **prefill** phase leg-choice real
(the route now carries the engine); the learning governor was always going to make it **per-device** instead of
per-constant. Same decision, different maturity.

### 2.2 What FIX 2's rule actually compares, and where each input comes from

From `FIX2-DESIGN.md:695`-`:697`:

```
Take the WIP's rule verbatim: gate on `gpu_prefill_capable()` (carries `gpu_leg`), read raw
`prefill_npu_headroom_c_`, `std::isfinite` both legs, threshold `decode_guard_headroom_c`, hysteresis
`k_hop_hysteresis_c`, `load_step_of(GPU)`.
```

Decomposed against the Stage 0 record:

| rule input | what it is | in the Stage 0 record today? |
|---|---|---|
| `prefill_npu_headroom_c_` | live zone headroom, read at admission | **no** — the row carries forecast `hl` and per-window `*_hot_c`, which are decode-window values |
| `prefill_gpu_headroom_c_` | same, GPU zones | **no** (same reason) |
| `decode_guard_headroom_c` | one shared threshold constant | **no** — and it is a constant, not a measurement |
| `k_hop_hysteresis_c` | hysteresis constant | **no** |
| `load_step_of(GPU)` | an assumed deg-C rise for a loaded idle leg | **no** |
| per-leg prefill speed | which leg is faster at prefill | **no** — `tok`/`us` are decode counters |
| which leg prefilled | `engine_prefill` / `layers_device` | **no** |

The binding *does* read all three legs' zone temperatures every window (`rn-governor-samples.h:35`-`:37`):

```
    float cpu_hot_c = std::numeric_limits<float>::quiet_NaN();
    float npu_hot_c = std::numeric_limits<float>::quiet_NaN();
    float gpu_hot_c = std::numeric_limits<float>::quiet_NaN();
```

so **heat per leg is available; speed per leg is available only for decode; the prefill leg is not recorded at
all.**

### 2.3 RECOMMENDATION: FIX 2 ships with fixed constants. The learning layer replaces them later.

**Recommendation, stated once: do not make FIX 2's rule learned. Ship the constants, and ship the seam that lets
Stage 2/3 replace them without touching the branch.**

Five reasons, each from the record:

1. **The data to learn a prefill rule from does not exist yet.** The row type
   (`governorObservation.ts:67`-`:106`) has no prefill leg, no `prefill_ms` per leg, and no `layers_device`. The
   only per-leg speed is decode (`governorObservation.ts:146`-`:147`). A "learned prefill speed" would be a
   learned number with no measurement behind it.

2. **The design's own gate forbids it, by name.** `DESIGN.md:383`:
   `Stage 2 does not start until OPEN 1-6 are closed.` Two of those six (2, 3, 5, 6) need the replay script,
   which was never written (`DESIGN.md:192` names `scratchpad/agents/learning-governor/replay/`; the folder does
   not exist). So the learning layer is not "ready next week" — it is behind an unwritten tool.

3. **The correctness verdict does not exist yet, and learning would enlarge the surface before it does.** The
   oracle is R2 FAIL on the two generations that already do GPU prefill
   (`/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:101`-`:111`):

```
   * Caveat: raw oracle is still FAIL on R2; R2 requires ≤0.02 at every step;
   * same-top is 94.8%; evidence is n=1 pair on one board (ALIVE 60).
```

   and `FIX2-DESIGN.md:541`-`:543` names the new exposure this creates:

```
**Risk:** R2 FAIL means GPU prefill's logit deltas can exceed 0.02 at some step. Today that is only
reachable when the NPU lane is *off* — a fallback the owner accepted. FIX 2 makes it reachable on a
**live, healthy NPU lane** purely because the NPU got hot.
```

   One rule, one constant, one correctness question. A learned rule is a harder correctness question, and the
   owner gate (R6) is a yes/no, not a tuned parameter.

4. **The per-device part is already measured; the constant part is not the thing that varies.** The trips in the
   record are per device and finite — Xiaomi `cpu 60-115 C, npu 100 C, gpu 95 C`
   (`xiaomi-stage0-obs-aa789620/REPORT.md:105`) — so the device-specific thresholds already come from the
   device's own zones at runtime. `decode_guard_headroom_c` is a headroom fraction, which is already
   normalised across devices. What learning would add is a *learned prefill speed per leg*, and the one place
   that exists is a bench cell, not the app:
   `PLAN.md:210` records the standing open item `J/token has never been measured as a valid device/model/backend/phase grid.`

5. **The Fable plan already warned that a learned table needs an energy signal that does not exist.**
   `governor-plan-fable/PLAN.md`, milestone 1: `Pass: current changes on >= 90 % of rows AND per-phase mean current
   differs between backends by > 3x idle std-dev. Fail: drop energy learning, rank on heat priors only.` And the
   app cannot read the battery node it would need — `bsys:[0,null,0,null]` on every row on **both** phones
   (`xiaomi-stage0-obs-aa789620/REPORT.md:117`).

**But ship three seams now, so the later replacement is a constant swap and not a rewrite:**

- **S1** — the rule reads its threshold from named policy fields with one owner, never inline literals, so
  Stage 2 can feed learned values into the same slot.
- **S2** — extend the observation row with prefill attribution (`engine_prefill`, `prefill_ms`, and the
  `route_chunks[].layers_device` device per chunk), so the learning layer inherits prefill data from the day
  FIX 2 ships instead of starting from zero. This is one small app change and it is behaviour-neutral.
- **S3** — keep `kalsa.bench.governor_force` and the FIX 2 attribution fields (Step 4's `prefill_npu_headroom_c`,
  `prefill_gpu_headroom_c`, rule `10`) as the measurement instrument the learning layer will read.

**The one thing not to do:** do not reuse the DECODE heat-ridge numbers as PREFILL heat. `DESIGN.md:341`-`:342`
fits `y = 30 (h_last - h_first)` to a decode wake sample; prefill heat is a different process with a different
lead time. The Fable plan already found the analogous trap — `Admission deltas {1.9, 3.25, 3.25, 5.15} applied to
all backends, "unmeasured defaults"` (`governor-plan-fable/PLAN.md`).

---

## 3. Merged step plan

Order rule: **every step is behaviour-neutral until the owner switches a generation on.** The switch is a single
one-line generation flag in `/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:109`-`:111`, and it is the
only step that changes which leg a healthy phone uses.

Legend: **[S23]** = needs the S23. **[XIAOMI]** = needs the Xiaomi, owner's daily phone, nights only.
**[LAB]** = no device. **[OWNER]** = a decision, not work.

---

### M0 — Re-vendor the binding and repair the red guard test `[LAB]` + `[S23]` for the check

Owner-independent, and **already overdue**: `FIX2-DESIGN.md:647`-`:651`:

```
1. **This test is already red** against the engine's `c8c128b03`, which changed `:407` to
   `if (mode == llama_governor_prefill_mode::GPU && params_.gpu_leg) {` and `:414` to
   `if (params_.bench_force_gpu_prefill && params_.gpu_leg &&`. The binding has not been re-vendored.
   That is a live breakage from the in-flight FIX 1, independent of FIX 2. **Report it to the owner
   now.**
```

**Files:** `vendor/llama.cpp/src/*` (from `c8c128b03`), `src/__tests__/governorPrefillOverrideSurface.test.ts:126`-`:151`.
Re-anchor the pinned slice on `npu_lane_live()` — `FIX2-DESIGN.md:653`-`:655`:
`The FIX 2 branch must be inserted **after** `bench_force_gpu_prefill** ... but **it will still break**`.
**Tests:** jest green on the binding; the guard slice green. **Device:** `[S23]` one turn, governor ON —
`KALSA_GOVERNOR` reads `engine_prefill: NPU`, `layers_device: HTP0` on every chunk (the lane-only regression
check). **Behaviour:** unchanged. Do this before any other step; every later step's device check is easier to
read on a green tree.

### M1 — Prefill route carries the engine `[LAB]` (engine only)

Exactly `FIX2-DESIGN.md:668`-`:673`, Step 1. **Files:** `src/llama-governor.h:96`,
`src/llama-governor-runtime.cpp:124`/`:251`, `src/llama-governor.cpp:417`-`:419`.
**Behaviour-neutral argument, from the same document:**

```
**Why first, and behaviour-neutral:** today `prefill_engine()` returns NPU whenever the lane is live
(`:429`), so mapping it into the new enum and back resolves to the same NPU leg `:308` returns
today. **No turn changes behaviour.**
```

**Tests:** new `tests/test-governor-prefill-route-engine.cpp` over `prefill_ctx`; `test-governor-legs.cpp` and
`test-governor-v0-route-switch.cpp` stay green unchanged — that is the regression proof. **Device:** none.

**Open fork to settle here:** `FIX2-DESIGN.md:395` — `**Decision needed from the owner**; I recommend CPU.` for the
lane-only fall-through when a GPU pick arrives with no GPU leg.

### M2 — The thermal rule, shipped inert-by-gate `[LAB]` (engine only)

Exactly `FIX2-DESIGN.md:688`-`:702`, Step 2: insert between `:417` and `:429`, delete the stale `:425`-`:427`
comment, take the WIP rule verbatim, gate on `gpu_prefill_capable()` which carries `gpu_leg`. Do **not** add rule
number 10 (that is M4). **Tests:** new `tests/test-governor-prefill-npu-hot.cpp` with the seven listed cases.
**Device:** `[S23]` **and** `[XIAOMI]` — the false-positive check:

```
**Device check — the rule must never fire on a healthy phone.** Run one 1,241-token turn on S23 and
Xiaomi with the lane on. `KALSA_GOVERNOR engine_prefill` must stay `NPU`, and
`route_chunks[].layers_device` must read `HTP0` on every chunk. **A single `GPUOpenCL` here is a
false positive** — the zone reader is NaN-or-hot and this proves the gate leaked.
```

then force it and read the signature (`FIX2-DESIGN.md:749`-`:752`):

```
**Device check:** a forced handoff turn logs `prefill_npu_headroom_c < 5`,
`prefill_gpu_headroom_c` finite, `last_router_rule: 10`, `engine_prefill: GPU`,
`layers_device: GPUOpenCL`, `commit_bytes > 0`, `decode_hop_commit_bytes: 0`. **That last pair is the
signature of the whole feature** — a commit that `decode_hop_*` will never attribute.
```

**This step can run on the S23 alone** — the forced arm does not need the owner to switch anything on.

### M3 — Binding thermal sample + attribution `[LAB]` + `[S23]`

`FIX2-DESIGN.md:711`-`:732` (Step 3's tail) + `:734`-`:747` (Step 4), merged into one step because they touch the
same files and the same log line. **Files:** `cpp/rn-governor.cpp` — build the leg reader unconditionally (today
`decode_hop_tokens` defaults to 0, so `FIX2-DESIGN.md:721`-`:722` says `on a production phone **no zone is ever
read**`), push through `llama_governor_set_prefill_headroom`; add `prefill_npu_headroom_c` /
`prefill_gpu_headroom_c` to `llama_governor_stats`; add rule number `10` in `prefill_rule()`; emit both on the
`KALSA_GOVERNOR` line and register them in `src/logReport/tagSchemas.ts`.
**Tests:** `tests/thermal_legs_test.cpp` for the always-constructed reader; default-on-absence parse test;
`prefill_rule()` returns 10 for a thermal handoff and 5 for the override; the schema test modelled on
`src/logReport/__tests__/schemaGovernor.test.ts:83`-`:89`. **Device check `[S23]`:**

```
`npu_headroom_c` finite on a cold phone (≈20 °C margin) and shrinking under load —
proves the reader is now constructed.
```

**Do not** change `llama_governor_prefill_mode` — it is pinned by the guard test (`FIX2-DESIGN.md:658`-`:659`).

### M4 — Prefill attribution in the observation record `[LAB]` + `[S23]` **[NEW — the learning seam]**

This is the step the merge adds. It is the smallest possible change that makes FIX 2 and the learning governor
share one instrument.

**Files:** `/Users/marco/Projects/kalsa/src/engine/governorObservation.ts` (extend
`GovernorObservationRow`), `governorObservation.ts:146`-`:147` (extend `tripleDelta`), its test, the row-shape
guard. **Add:** `engine_prefill` (from the existing `stats.prefill_engine`), `prefill_ms`, and per-chunk
`layers_device` from `route_chunks` — the honest device string, per `llama-ext.h:508`-`:512`
(`a phone NPU load labels the route GPU while Hexagon runs the matmuls, so consumers that need the device read
this`). **Tests:** the existing schema test extended; a row where `engine_prefill` is `GPU` and `layers_device` is
`HTP0` must round-trip both unchanged (that is the mislabel case the record must be able to express).
**Device check `[S23]`:** one turn, `observations.jsonl` pulled with `run-as`, and the row shows
`engine_prefill`/`layers_device` agreeing. **Behaviour:** unchanged; the row is a read-only append.
**Why now:** without it, when Stage 2 asks "how fast was the GPU prefill on this phone", the answer is in the
lab bench cells and nowhere else.

### M5 — The correctness check: logit oracle, NPU vs GPU prefill, hot NPU `[S23]` **`[OWNER]` after it**

Section 4 below has the full harness answer. **Device:** `[S23]` — see §4.3 for why it can and should be the S23
and not the Xiaomi.

### M6 — Lab replay over the Stage 0 JSONL `[LAB]` **`[XIAOMI]` for its input**

`DESIGN.md:192`-`:202` specifies the tool; the folder does not exist. Write it, then run it over the pulled rows.
Closes OPEN 2, 3, 5, 6 — the gate on Stage 2 (`DESIGN.md:383`).
**Input debt `[XIAOMI]`:** the `>= 20` completions from normal use
(`xiaomi-stage0-obs-aa789620/REPORT.md:156`-`:158`) — the dev build stays installed and the batch is collected
passively, no heated session needed. `[XIAOMI]`, nights only, no speed claims from it.

### M7 — Stage 1: the learned store, app-only `[LAB]`

`DESIGN.md:385`-`:387`: `governorLearned.ts` (store, fingerprint, breaker latch), `governorLearnedFit.ts`
(ridge, outlier, forgetting, ucb), `GovernorBatteryModule.kt` `readSoc` + `Build.FINGERPRINT`, the
`KALSA_GOVERNOR_LEARNED` line. **No decision change.** This is where the constants from M2 can be shadowed: the
store writes learned per-leg prefill speed and heat, and nothing reads them yet.

### M8 — Stage 2: the engine speed rule, default off `[LAB]` + `[S23]`

`DESIGN.md:388`-`:398`. Lands **off**: `no row = off`. The S23 check is `speed_fit_windows 0`
(`DESIGN.md:398`: `Check: S23 G2, `speed_fit_windows 0``) — the S23 is the null control, which is exactly its role
in the original design (`Xiaomi first, S23 as the null control`, `archived/PLAN-2026-10-16-full.md:403`).

### M9 — Stage 3: enablement `[OWNER]` — only after the oracle verdict

`DESIGN.md:399`-`:403`, Check B on the Xiaomi from skin < 35 C. Before this, the owner still owes the repeat-cell
decision (`PLAN.md:271`).

### 2.x — V73 `[OWNER]`

`FIX2-DESIGN.md:546`: `Note also **V73 has never been measured in-app** (`:110`), and it is in the generation
list.` `FIX2-DESIGN.md:759`: `Consider also whether V73 (never measured in-app, `:110`) belongs in
`gpu_prefill_capable()` at all.` **Recommendation: V73 stays a candidate, as the owner already decided.** FIX 2's
rule should require a generation that has an oracle verdict on record; today that is none of them
(`/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:453`: `No committed logit-oracle PASS exists for any
generation.`).

---

## 4. The correctness check: logit oracle, NPU vs GPU prefill, on a hot NPU

### 4.1 Which harness exists

`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-oracle-onoff-41dc728f/` — a complete, working
cell: `env.sh`, `setup.sh`, `turn.sh`, `oparse.sh`, `oracle.sh`, `steps.py`, `kmulti.sh`, `kset.sh`,
`skin-id.sh`, `wipe-chats.sh`, `enc-short.txt` / `enc-long.txt` / `prompts.sha256`, plus `raw/` and `REPORT.md`.

The verdict tool is **unmodified** (`oracle.sh`):

```
#!/usr/bin/env bash
# usage: BOARD=x oracle.sh A_LABEL B_LABEL — TF verdict of the UNMODIFIED oracle_logit.py (thresholds fixed in PREREG.md: 0.03 / 0.02 / 0.10),
# plus the per-step table from steps.py (same step_rule). Both read the KALSA_BENCH_PROBS files written by oparse.sh.
```

and the thresholds are pre-registered in `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/logit-oracle/PREREG.md:20`-`:31`:

```
## Rules (PASS requires ALL; any violation = FAIL)
R1 Confident disagreement = FAIL: at any comparable step where CPU margin p1−p2 ≥ 0.03, B's top-1 must equal A's top-1.
R2 Distribution agreement: at every comparable step, for every token in A's top-5 with pA ≥ 0.02, the token is in
```

```
R6 No automatic promotion: a PASS is reported; enabling GPU prefill on a generation in production is the owner's
```

**R6 is exactly the owner's gate in this plan** — the check produces a verdict, the owner decides.

### 4.2 What it needs

From `env.sh` (verbatim, the values that must be re-pointed):

```
LAB=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-oracle-onoff-41dc728f
BOARD=${BOARD:?set BOARD}
OUT=$LAB/raw/$BOARD; TMPD=/tmp/qdconoff/$BOARD; mkdir -p "$OUT" "$TMPD"
APK=/tmp/kalsa-apk-41dc728f/kalsa-apk-arm64-v8a-debuggable-41dc728f04eb9a6fd0c42fb5da0102eddb813a3d/app-release.apk
APK_SHA=f2eb381ffabede90f5cc68ff04c79398611b79df31e55df8144a30eff2baf2d4
```

- **APK flavour:** debuggable release, arm64-v8a — the cell's `REPORT.md` line 3 records
  `debuggable, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]``, and the hash is verified before install
  and again in `setup.sh`.
- **Model:** `LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`,
  size 1593894944 — `REPORT.md` line 5. This is the ship model.
- **Bench keys** (app-side, all in `/Users/marco/Projects/kalsa/src/engine/benchSampling.ts:3`-`:5`):
  ```
  export const BENCH_SAMPLING_KEY = "kalsa.bench.sampling";
  export const BENCH_PROBS_KEY = "kalsa.bench.probs";
  export const BENCH_FORCE_IDS_KEY = "kalsa.bench.force_ids";
  ```
  `benchSampling.ts:45`: `if (probs === "1") result.bench_raw_probs = 5;` — so `probs=1` emits top-5 raw probs,
  which is what `LlamaService.ts:4119`-`:4138` prints as `KALSA_BENCH_PROBS`.
  And the GPU-prefill arm key, `/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:460`:
  ```
      bench_force_gpu_prefill: force && gpuLeg,
  ```
  — i.e. **`kalsa.bench.governor_force=1` forces GPU prefill, but only when the load has a GPU leg**. On the S23
  that requires the lane-live one-copy fit; on a lane-only load the key is inert by design.
- **Prompts:** the cell's `enc-short.txt` / `enc-long.txt` with `prompts.sha256`, and the B arm replaying A's ids
  via `kalsa.bench.force_ids` so the 32 steps are comparable (`REPORT.md`: `B (GPU, forced to A's 32 ids)`).
- **Fresh logcat per turn:** `turn.sh` does `ad logcat -c` then a cold `am force-stop` + relaunch, and
  `oparse.sh` reads `KALSA_BENCH_PROBS` rows out of the per-turn capture.

### 4.3 Can it run on the S23 now?

**Yes for the mechanics, with two gaps that must be closed first.**

Supporting facts:

- The S23 is available now, charged, unplugged allowed — per the task frame, and consistent with
  `s23-belongs-to-the-coordinator.md` (the S23 is the coordinator's device and stays usable for engine/CLI tests
  and debuggable APKs).
- The S23 runs one-copy in-app with all three legs (`docs/ALIVE.md:60`: `One weight copy serves NPU, GPU, and CPU;
  correct on S23 and Xiaomi phones and QDC SM8650/SM8750/SM8850`), and the GPU leg is real there — the
  `npu_leg_devices[]` array lists GPUOpenCL second (`FIX2-DESIGN.md:113`) and the S23's GPU leg has `n_threads = 1`
  (`FIX2-DESIGN.md:117`-`:118`).
- `turn.sh`'s own header says it was adapted from the S23 one:
  `# --- preflight/state ---` … `turn.sh:2`: `Adapted from the S23 turn.sh (bounds come from uiautomator, English
  labels, skin-temp watchdog since QDC battery temp is stubbed)`. So the S23 has an earlier version of this driver.
- The Oracle's R5 sanity control is board-independent: `PREREG.md:28` — `R5 Sanity (before any board is judged):
  the 8 Elite (known-good GPU) must PASS R1–R4 on >= 2 pairs`, and the last run recorded
  `R5 is still unmet by the registry (the sanity PASS must come from the 8 Elite, not run here)`. Running on the
  S23 neither satisfies nor breaks R5 — it inherits the same caveat, which must be stated in the report.

**Gap 1 — transport.** The cell's `env.sh` drives QDC boards over SSH portal sessions
(`REPORT.md` line 5: `SSH-only sessions 888089 (SM8850, serial 4816891, host sa892158) and 888272 (QRD8750...)`).
The S23 is on wireless adb. The `ad` shell wrapper and the `skin_c`/`batt_c` helpers must be re-pointed at the
S23's adb transport. The S23's skin zone index must be re-measured with `skin-id.sh` — per
`REPORT.md` line 7, the live `mName=skin` entry is board-specific and `Never max()`.

**Gap 2 — the "hot NPU" part does not exist in the harness yet.** This is the real work. `turn.sh`'s thermal rig
is a *cool-down* rig, not a *heat-up* rig: it waits until skin is under `COOL_TARGET` and `VOID`s above
`VOID_ABOVE`, and the watchdog `KILL`s at `STOP_C`:

```
( while :; do sleep 10; t=$(skin_c); b=$(batt_c); [ -z "$t" ] && continue
    if awk "BEGIN{exit !($t >= $STOP_C)}"; then echo "$(date +%s) KILL skin=$t batt=$b" >> $P-watchdog.txt; ...
```

Nothing in the cell makes the **NPU zone** hot while leaving skin survivable. Producing the hot arm needs a new
trigger — most cheaply, **let FIX 2's own rule fire**: once M2/M3 land, a packed prefill block on a live lane
raises `npu_hot_c` and the rule hands off, which is precisely the condition the oracle must judge. Before the
owner switches a generation on, the hot arm is produced by `kalsa.bench.governor_force=1` on a lane the harness
has deliberately warmed. Either way the harness needs an NPU-zone-driven start condition and a stop that watches
the NPU zone, not just skin.

### 4.4 How long

- Porting the cell to the S23 transport + a fresh `skin-id.sh` + a cold-turn rehearsal: **half a day**.
- The run itself: the cell's per-turn cost is a cooldown wait (15 s polling, up to `COOL_CAP`), ~30 s cold launch,
  the turn, then another cooldown — `turn.sh:8`-`:9` shows the loop shape. Budget **~20–30 min per turn** including
  cooldowns.
- **R4 needs `>= 2` same-turn pairs per board** (`PREREG.md:26`), i.e. 2 NPU arms + 2 GPU arms; and the
  FIX 2 check needs each in both a cool and a hot NPU state. That is **8 turns ≈ 3–4 h** of device time, plus
  analysis.
- **Total: about one day**, and it can run unattended overnight on the S23 with the Mac watcher pattern the Xiaomi
  cell used (`xiaomi-stage0-obs-aa789620/REPORT.md:68`-`:75`, three proven watchdogs).

### 4.5 What the verdict will most likely be

Say this to the owner before the run, not after. The same kernel on SM8850 gave
(`qdc-oracle-onoff-41dc728f/REPORT.md`):

```
| pair | A (CPU) | B (GPU, forced to A's 32 ids) | verdict | max_dlogp | max_dp1 | R1 | R2 steps |
| 1 | p1a1 | p1b1 | **FAIL R2** | 0.5236 | 0.1075 | none | 5, 6, 9, 16 |
```

against a limit of `0.02` (`governorInputs.ts:106`: `R2 requires ≤0.02 at every step`), with top-1 agreeing on all
32 steps. And the app records the standing caveat (`governorInputs.ts:106`-`:107`):
`same-top is 94.8%; evidence is n=1 pair on one board (ALIVE 60).`

So the expected outcome is **FAIL R2 with ~95% same-top**, and the real question the run answers is *how often*
and *by how much* on the S23's own kernel — not whether it passes. The owner's R6 call follows.

---

## 5. What I could not verify

- **No builds, no tests, no device commands** — every behaviour claim is argued from source, not observed. The
  `M1` behaviour-neutrality claim is inherited from `FIX2-DESIGN.md:674`-`:677`, not re-derived by running it.
- **The binding guard test's current red/green state is inferred** from the byte-diff
  (`FIX2-DESIGN.md:771`), not executed.
- **I did not open the engine tree.** Every engine line number here is quoted from `FIX2-DESIGN.md`, which states
  its own basis at `FIX2-DESIGN.md:42`-`:43`: `Every quote from the engine below is from `git show HEAD:` of
  `/Users/marco/Projects/kalsallama-upstream-b11514` at `c8c128b03`.` The engine may have moved since.
- **`replay/` genuinely does not exist** — I listed the folder, but I did not search the whole lab for a replay
  tool under another name.
- **The oracle's S23 port is a plan, not a measurement.** `turn.sh` is adapted *from* an S23 script I did not
  read; the transport gap and the hot-NPU trigger are my two identified blockers and may not be the only two.
- **The `>= 20` completion Xiaomi batch is unobtainable on any schedule but the owner's normal use.**
- **Time estimates in §4.4 are estimates** — derived from the shell loops' shapes, not from a timed run.