# Learning governor - coordinator addendum, 2026-10-15

Three items settled on paper before Stage 2, plus the Step 0b spec restated against the code as it
stands at app `aa789620`. Written by the coordinator session, after the S23 Stage 0 device check
(`s23-stage0-obs-aa789620/REPORT.md`) and while the Xiaomi Stage 0 arm is running
(`xiaomi-stage0-obs-aa789620/`). Nothing here changes a decision by itself: each item keeps its own
check, and the numbers that need Stage 0 data stay OPEN rather than being guessed.

## Item A - Stage 0b: the Xiaomi pacing lines become their own step (app only)

**OPEN 1 is closed (2026-10-15, `xiaomi-stage0-obs-aa789620`): the Xiaomi's passive trips are
finite for all three legs** - `cpu 60-115 C`, `npu 100 C`, `gpu 95 C` (the row field `trips` is
`[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]`, read from `RNLlamaJSI.cpp:1039-1043`).
Consequence for the speed rule: the design asked for GPU >= 56.3 C to allow a cold fit, and 95 C
gives `trip - guard(5 C) = 90 C` as the GPU block ceiling, so the zone guard will not bind while
the blind path runs; the gain is real rather than clipped. The zone temps observed during the arm
stay far below it (gpu 47.7-58.0 C), which is the same conclusion from the other side.

Owner decision 2026-10-12 (`PLAN.md`, "Open decisions"): Xiaomi lines at skin **39.0 C start /
42.6 C full**, i.e. the S23's 3.6 C ramp, against the Xiaomi's own declared SEVERE 66.5 C. Today
every phone gets the S23's pair, converted per model.

State of the code, `src/engine/declaredSevere.ts` at `aa789620`:

- `:8-9` `const PACING_START_SKIN_C = 38.1;` / `const PACING_FULL_SKIN_C = 41.7;` - one shared pair.
- `:18` `const DECLARED_SEVERE: ReadonlyArray<{ model: RegExp; severeSkinC: number }> = [` - the row
  type carries no skin lines.
- `:28` `{ model: /^23127PN0CG$/, severeSkinC: 66.5 },` - the Xiaomi row.
- `:34-38` `headroomAt(skinC, severeSkinC)` - `(skinC - (severeSkinC - 30)) / 30`, floored at 0,
  rounded to 3 decimals.
- `:54-55` the two return lines that hand the shared pair to `pacingHeadroomLines`.

**The change.** Add optional `startSkinC` / `fullSkinC` to the row type; `pacingHeadroomLines`
reads `row.startSkinC ?? PACING_START_SKIN_C` and `row.fullSkinC ?? PACING_FULL_SKIN_C`. The Xiaomi
row gets `39.0` / `42.6`. No other row changes. Arithmetic, so the audit can check it by hand:

| line | skin | phone | `headroomAt` | result |
|---|---|---|---|---|
| start | 38.1 | S23 (`SEVERE 42.0`) | `(38.1 - 12) / 30` | **0.87** (unchanged) |
| full | 41.7 | S23 | `(41.7 - 12) / 30` | **0.99** (unchanged) |
| start | 39.0 | Xiaomi (`SEVERE 66.5`) | `(39.0 - 36.5) / 30` | **0.083** (was 0.053) |
| full | 42.6 | Xiaomi | `(42.6 - 36.5) / 30` | **0.203** (was 0.173) |

`declaredSevere.test.ts` pins the Xiaomi at 0.053 / 0.173 today and must be re-pinned to
0.083 / 0.203, with the S23 cases left asserting 0.87 / 0.99 (they are the regression guard for
"the default pair still applies to a row that declares no lines").

**Check, unchanged from DESIGN section 4** (it needs this phone's Stage 0 rows, so it runs after
them): `KALSA_GOVERNOR_PLAN` prints `pacing_start 0.083` / `pacing_full 0.203` on load; on the
windows constrained to battery < 39.5 C and status <= 1, sample k's `duty_last` aligned with
sample k-1's `h`: `h(k-1) <= 0.083` -> `duty_last(k) == 1` on every window, and `h(k-1) >= 0.10`
-> `duty_last(k) <= 0.95` on >= 95 % of windows. The S23 must keep printing 0.87 / 0.99 and pass
the same test. Refuted by a paced window under the start line with a cool battery and status <= 1.

The fallback (41 / 44 C) stays owner-gated: it is only for Stage 3 showing the GPU learns too
little.

**What the new lines mean in our own measured range (auditor P3, 2026-10-15).** During the Xiaomi
arm the platform forecast reached `h ~ 0.196` at the hottest sample (skin ~42.3 C, 324 windows, 11
of them blind at exactly 0). With the OLD pair (0.053 / 0.173) the duty ramp reached its floor
inside that range; with the NEW pair (0.083 / 0.203) the ramp **starts** inside the observed
range but never **completes** it. So on this phone, in this thermal range, Stage 0b yields a
partial duty where today it yields the full one: pacing starts at skin 39.0 C instead of 38.1 C
and does not reach the 42.6 C full line within a normal session. That is the owner's decision,
applied honestly - it is not a regression to be silently corrected, and the DESIGN 4 device check
must compute its expected duty from the new lines (it already does: "computes the expected
`headroom_duty` from the lines"). Re-derive the expectation before running it: at the observed
maximum the expected duty is the value `headroom_ramp` gives between 0.083 and 0.203, NOT 1.0.

## Item B - the Stage 2 app-sample freshness gate is stated in the wrong unit

DESIGN 5.1 disarms the speed pass when `now_ms - app_sample_ms > 120000`, i.e. 120 s of wall clock.
The S23 cell measured that wrong against reality: **the app thermo sample age reaches 350 s inside
one paced 2048-token completion** (`s23-stage0-obs-aa789620/REPORT.md:53`: "the app pushes thermo
once per completion"). At 350 s, a gate at 120 s disarms the pass for most of every long paced
completion, on a healthy phone, with fresh data - a false disarm, not a safety action. And no
fixed wall-clock value can be right in general: a completion's length is a function of the pacing,
so the gate would have to be re-tuned every time pacing changes.

**What the gate is actually for.** Battery temperature, level and plugged state are inputs to
arming and to the battery ramp. The thing that must be fresh is the *charging state and the level*
at the moment the decision is taken, because a phone that plugged in mid-completion changes what
"safe" means (the standing rule: never benchmark charging; and `policy.cpp:191-192` takes a
different battery ramp when plugged).

**The shape the rule should take**, to be written into DESIGN 5.1 before Stage 2 starts:

1. **Ownership first, wall clock second.** The sample must be the one the app pushed for the
   *current completion*. The engine already knows completion boundaries (the ring is reset per
   completion), so "pushed before this completion started" is checkable without a new input.
2. **A wall-clock backstop sized from data, not from taste.** It exists only to catch an app that
   pushed nothing at all (the completion restarted under a stale profile). Its value comes from
   the Stage 0 `app_age` distribution on both phones, and that distribution is now measured
   (`xiaomi-stage0-obs-aa789620`, 4 rows / 148 windows, plus the S23 cell):

   | phone | windows | min | median | max |
   |---|---|---|---|---|
   | Xiaomi 14 (6-turn arm, 8 rows) | 324 | 0.58 s | 108.8 s | **503 s** |
   | Galaxy S23 (6-turn arm, 7 rows) | - | - | - | **350 s** |

   So any backstop must sit **above 503 s** - and that is the floor, not the value. Recommendation:
   **1200 s (20 min)**, about 2.4x the worst observation on either phone, still far inside one long
   turn, and it keeps catching the case it exists for (an app that pushed nothing at all). The
   earlier draft of this addendum said 600 s from the first four Xiaomi rows (max 213 s); the
   full arm showed 503 s, so the number moved. Recorded as the coordinator's starting value;
   Check B can tighten it once longer completions exist.
3. **The native 5 s refresh is DEAD on both our phones.** OPEN 4 is answered: the probe reads
   `/sys/class/power_supply/battery/{temp,status}` and gets `temp_ok false` on every row, on the
   S23 (`bsys:[0,null,0,null]`) and on the Xiaomi (`bsys:[0,null,0,null]`) - the sysfs is denied to
   the app on both. The app push stays the battery source and the backstop above is the primary
   staleness bound. Any future native refresh needs a different mechanism (a HAL/binder call), not
   this file.

What must NOT happen: the gate must not be deleted (a stale "not charging" while the phone is on
the charger is exactly the blind spot the item exists for), and it must not be widened blindly to
350 s because that is the largest value seen on one phone - that number is an observation of one
completion, not a bound.

## Item C - the blind budget must be counted per turn, and the engine has no turn

DESIGN 5.4 sets a blind budget of 2,048 GPU tokens per 10 minutes of wall time
(`k_speed_blind_budget_tokens`, `k_speed_blind_budget_ms`, DESIGN.md:323-325) and states it is
"shared across completions and tool rounds". The owner's audit (AUDIT-3, `PLAN.md` "Open
decisions") says the same in one line: the cap must count across the tool rounds of one turn, not
reset per completion.

**The hole, stated plainly.** The policy's unit is the completion. `rn_governor_samples::reset()`
runs at completion start and the ring is per completion; nothing in the engine knows where a turn
begins or ends, because a turn is an app-level concept (user message -> N completions -> answer).
So a per-turn cap implemented inside the policy today would silently reset at every tool round -
which is the exact defect AUDIT-3 caught, wearing a different hat. With the tools-on configuration
a turn can be several completions, so a 2,048-token budget per completion is a budget of
2,048 x (completions per turn).

**Proposed shape** (for the Stage 2 brief, engine + binding):

- The app already sends the governor params per round, and it already knows the turn id. Add one
  monotonic `turn_epoch` to the params the app builds (`buildGovernorParams`,
  `governorInputs.ts:321`); it increments on every turn start and is stable across that turn's
  tool rounds.
- The policy keeps the blind counters plus the epoch they were accumulated under: when
  `turn_epoch` differs from the stored one, the counters reset **once per turn** and the new epoch
  is stored. The 10-minute wall-clock window still applies across epochs, so an abandoned turn
  (app killed mid-turn, no next epoch) is still bounded by time.
- Stat additions so the device check can see it: `decode_speed_turn_epoch` and
  `decode_speed_blind_tokens_turn` (tokens accumulated in the current turn), so a reviewer can
  verify the counter did not reset inside a turn without reading the policy.
- Test: a completion sequence of N completions in one epoch accumulates; a new epoch zeroes once;
  the wall-clock bound holds across epochs.

**Open, deliberately**: whether the engine should instead learn the turn boundary itself (e.g. a
prompt-token delta or an idle gap) is a larger change and is not needed - the app knows the turn,
so the app should say so once per turn. Recorded as a coordinator decision, not a design change to
DESIGN 5.4's budget value, which stays 2,048 / 10 min until Check B.

## Delegation and audit (unchanged rules)

- Stage 0b is app-only and gets its own worktree, its own unit tests, and its own hostile audit by
  a model other than the writer. It is implemented **while the Xiaomi arm is running but never in
  the worktree that arm is reading from** - a measurement must not share a tree with an edit.
- Items B and C are paper now; each becomes part of the Stage 2 brief (engine + binding + app),
  audited in the same step as the code that implements it, with the same hostile prompt.
- Every delegated claim is verified on disk by the coordinator before it enters `PLAN.md` /
  `docs/ALIVE.md`.