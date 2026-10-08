# Hostile review: rule v3 `HEAT_RANK` (engine commit 08ca9a82b)

Target: `08ca9a82b` "governor: HEAT_RANK leg weighting (owner rule v3)", parent `dc48ec8cc`,
worktree `~/Projects/kalsallama-gov-rulev3` (detached). `git rev-parse HEAD` =
`08ca9a82bd12f241a5559d6a8ddc2e73343d356c`; `git status --short` empty at the end of the review —
no source file was edited, nothing committed, no device, no build of the tree.

Spec this commit had to satisfy: `PLAN.md:2195-2198` (rule v3 dispatch):
`rank present legs by heat per token, stay while headroom >= guard (default 5 C), a non-current leg`
`must have headroom - load step >= guard + hysteresis; none fit -> NPU_FIRST loop; bench --hop-mode heat_rank`
`--guard-headroom C; NPU_FIRST/GPU_BURST byte-identical.`

What was actually run:

- `git show 08ca9a82b` (8 files, +328/-19) and full reads of the touched files plus
  `src/llama-governor-policy.h`, `src/llama-governor-runtime.cpp`, `src/llama-governor.cpp`,
  `src/llama-governor-legs.cpp`.
- `ctest --test-dir build-host -R governor > /tmp/ctest-gov-rulev3.log 2>&1; echo $?` → **exit 0**,
  24/24 passed, 7 model-gated skips; the new `test-governor-v02-hop-heat-rank` (#78) passed.
- one targeted recompile of the changed TU with extra warnings:
  `/usr/bin/c++ -std=c++17 -O1 -I src -I include -I ggml/include -c src/llama-governor-policy-hop.cpp`
  `-Wall -Wextra -Wswitch-enum -Wshadow` → **exit 0, no diagnostics** (the new enumerator has no
  missing `switch` case here; a tree-wide grep shows `llama_governor_leg_weighting` is switched on only
  in `hop_mode_name`, `tools/governor-bench/governor-bench.cpp:240-246`, which has the case).
- a throwaway host probe in `/tmp/rulev3probe/` (nothing written into the repo) linking
  `build-host/bin/libllama.dylib` and driving `llama_governor_policy` directly with an injected clock.
  Probe outputs quoted below are real; commands were `probe` (runs A/C/D), `probe2` (run B),
  `probe4` (fallback + heat-order). Their exit codes were 0 (they are measurements, not assertions).

Verdict vocabulary: CONFIRMED = reproduced by reading and/or measurement; PLAUSIBLE = code-argued but
one physical input is not measurable inside this repo; REFUTED = I looked for it and it is not there.

---

## 1. Behaviour

### 1.1 [CONFIRMED] [P1] The real re-entry bar for the cheapest leg is `guard + hysteresis + load step` = **20 C of idle headroom** (S23 NPU), not the documented 5 C guard; the only place that says so is the probe.

Code:

- `src/llama-governor-policy-hop.cpp:78-80`:
  `const bool fit = engine == current`
  `    ? present_headroom[next] >= guard_c`
  `    : present_headroom[next] - load_step_of(params, engine) >= guard_c + k_hop_hysteresis_c;`
- `src/llama-governor-policy.h:30`: `constexpr float k_hop_hysteresis_c = 4.0f;`
- `src/llama-ext.h:367-370`: `// Used only by HEAT_RANK: the headroom (C) below which the current leg is`
  `// left. Invalid values (NaN, negative, infinite) are rejected to 5 at`
  `// construction.` / `float decode_guard_headroom_c = 5;`
- `tools/governor-bench/governor-bench.cpp:44-45`: `--guard-headroom (heat_rank only) defaults 5 C: the headroom the`
  `current leg must keep before the window leaves it;`

So the *exit* threshold is 5 C while the *entry* threshold is `5 + 4 + step_npu = 20 C` with the S23's
measured NPU load step of 11 C (`step5-s23/run-step5-vsleg3.sh:6-8`: `load step NPU 11 / GPU 14 / CPU 0 C (round-2 zone means; the CPU step is unmeasured, so 0 - ...)`).
Measured (probe2, force the NPU off, then hold its raw at R and count windows):

```
tau=0 off_at=1 (gpu) raw_npu=19 -> back_at_window=-1
tau=0 off_at=1 (gpu) raw_npu=20 -> back_at_window=1
tau=8 off_at=16 (gpu) raw_npu=20 -> back_at_window=-1      <- EMA must EXCEED 20, not reach it
tau=8 off_at=16 (gpu) raw_npu=21 -> back_at_window=13
tau=8 off_at=16 (gpu) raw_npu=25 -> back_at_window=5
```

Consequences, in the S23's own numbers (`PLAN.md:2214` round-2 zone means: `NSP 63.5 C while the GPU leg runs vs`
`74.7 while the NPU runs (step ~11 C)`; `PLAN.md:2209`: `its 95 C passive trip never engaged a cooling device`):

- the NPU leg's headroom is the NSP zone's `lowest passive trip - temp`
  (`step5-s23/headroom-feeder.sh`: `case "$(cat $z/type 2>/dev/null)" in cpu*) leg=cpu;; nsp*) leg=npu;;`), i.e.
  ≈95 C trip minus NSP temp;
- idle-ish NSP (GPU leg running) 63.5 C ⇒ headroom ≈31.5 C: 20 C entry is reachable, so **a permanent park off
  the NPU is REFUTED for the S23** — but the margin is 11 C, not 100 C;
- the loaded NPU's own NSP mean is 74.7 C ⇒ 20.3 C headroom, i.e. **the entry bar is essentially equal to the
  NPU's loaded-zone headroom**; the return therefore depends on the NSP cooling back (its idle 55-60 C per
  `PLAN.md:2214`) before the rule can re-enter a leg it stopped using;
- the exposed `--guard-headroom` knob is not free: entry = `guard + 4 + 11`, so any guard above ≈16.5 C makes the
  NPU unreachable on this phone while the GPU leg runs, and nothing in the help, the header or a test bounds it.

Not a deviation from the spec — `PLAN.md:2197` literally says `must have headroom - load step >= guard + hysteresis` —
but the *effective* bar is never stated where an operator looks (help, `llama-ext.h`, commit message), and the
commit's own summary ("Invalid guards ... are rejected to 5 C") invites the reading that the guard is 5 C.

### 1.2 [CONFIRMED] [P2] With `decode_headroom_tau_s > 0` the guard is an EMA test, so the "guard exit" fires tens of seconds after the sample crosses the line; the commit's "the current leg is left below `decode_guard_headroom_c`" holds only for tau = 0.

Code:

- `src/llama-governor-policy-hop.cpp:213`: `present_headroom[i] = headroom_of(present[i]);` and
  `:182-197` (`headroom_of`) returns `decode_headroom_smooth_[...]` when `smoothed`, the raw sample otherwise.
- `src/llama-governor-policy-hop.cpp:121-130` (the EMA update), `:128`:
  `decode_headroom_smooth_[i] += alpha * (raw[i] - decode_headroom_smooth_[i]);`
- `src/llama-governor-policy-hop.cpp:109-115` (the comment that already recognises the hazard for the v2 rule:
  `the S23's min-zone headroom jumps tens of C between 32-token windows (single-core spikes)`).

Measured (probe, tau 8 s, one 1 s sample per window, NPU raw collapsed 30 → 4 C, guard 5):

```
C tau=8 raw_npu collapses 30->4: first window off NPU = 27
D tau=0 raw_npu collapses 30->4: first window off NPU = 1
```
and with the collapse 30 → 1 C: 16 windows (that run logged
`governor: decode hop npu->gpu at token 108 (headroom ... npu 4.9 C, ...)` — the EMA was 4.9 C when the
raw was already 1 C). The campaign's tau is 10 s (`run-step5-vsleg3.sh:7`: `tau 10 s, heat weight 7, per-token 2.8/3.2/4.7, load step NPU 11 / GPU 14 / CPU 0 C`), which stretches the
same delay further. The rule keeps the window on a leg whose *measured* headroom has been under the guard
for the whole EMA transient; the tape that guards skin temperature in a skin-budget campaign therefore acts
with a tau-sized blind spot. No test in the tree exercises HEAT_RANK with tau > 0 (see §5).

### 1.3 [REFUTED] No self-flap between legs; the guard exit is not ping-pong.

Proof (tau = 0 and tau > 0, any weights): HEAT_RANK only leaves the current leg when `heat_rank_fit` found the
current leg unfit — `src/llama-governor-policy-hop.cpp:78-79` — i.e. `V_current < guard`. If it then selects a
non-current leg, that leg passed `V_next - step >= guard + 4` (`:80`), so immediately after the hop the new
current leg reads `V_next - step >= guard + 4` under the shift (`:138-148`: entering `-= step` at `:143`, leaving `+= step` at `:146`), and `V_next >= guard + 4` without it, so the new current leg is fit with at least the hysteresis of margin and
cannot be dropped on the next window. Conversely the departing leg is now judged as a candidate, and its stored
value is `V_pre + step` (shift) or `V_pre` (no shift), so the candidate test `V - step >= guard + 4` reduces to
`V_pre >= guard + 4`, while it was `V_pre < guard` when it lost the window: it must *improve* by ≥ 4 C of headroom
before it can return. Measured on the constant-input walks: no A→B→A sequence occurs in any probe run
(e.g. `tau=0 ... raw_npu=19 -> back_at_window=-1`, with the window parked on the GPU). The EMA only adds damping
(§1.2), so smoothing cannot create a flap either.

### 1.4 [CONFIRMED] [P2] The NPU_FIRST fallback can place a window on a leg the rule just called unfit, and the next window *ratifies* it under the weaker current-leg bar; the rule label flips while the leg does not.

Code: the fallback (`src/llama-governor-policy-hop.cpp:239-253`) compares *effective* headroom, not the guard:
`:250-251`: `if (best >= 0 &&` / `effective_of(present[best]) - effective_of(decode_hop_leg_) >= k_hop_hysteresis_c) {`.
The next window re-enters `heat_rank_fit`, where the same leg is now `current` and only needs `>= guard`.

Measured (probe4, campaign heat weights, guard 5, steps NPU 11 / GPU 14):

```
1 w0 npu=10,gpu=7,cpu=8 -> npu rule=headroom
1 w1 npu=3 ,gpu=7,cpu=8 -> cpu rule=headroom     <- no leg fit; fallback picks the CPU at 8 C (< the 9 C candidate bar)
1 w2 npu=3 ,gpu=7,cpu=8 -> cpu rule=heat_rank    <- HEAT_RANK keeps the leg it just rejected
```
One extra hop per fallback episode is inserted exactly when the phone is hottest (no leg has 9 C + step), and it
is invisible as a rule change in the hop log (see §6.1), visible only as `rule=` churn on `leg_window` lines
(`tools/governor-bench/governor-bench-run.cpp:445-447`). The existing test stops one window short of this
(`tests/test-governor-v02-hop-heat-rank.cpp:135-139`).

### 1.5 [CONFIRMED] [P2] With all-zero heat params — the default of `llama_governor_params` and of the bench — the "ranking" is the `present[]` order NPU > GPU > CPU, i.e. the leg the engine's own comment calls the hottest decode leg is ranked second.

Code: ties are decided by `src/llama-governor-policy-hop.cpp:70-71`:
`if (!used[i] && (next < 0 || heat_per_token_of(params, present[i]) <`
`                                 heat_per_token_of(params, present[next]))) {`
with the documented intent at `:62-63`: `The strict compare keeps present[] order on exact heat ties (NPU > GPU > CPU).`
and `present[]` built NPU, GPU, CPU at `:164-172`. Defaults: `src/llama-ext.h:356-358`
(`float decode_heat_per_token_npu = 0; ... _gpu = 0; ... _cpu = 0;`), bench `tools/governor-bench/governor-bench.h:53-55`.

Measured (probe4, identical readings `npu=3, gpu=25, cpu=30` after an NPU window):

```
2 campaign 2.8/3.2/4.7       ... w1 ... -> gpu
2 header 0.16/0.40/0.30      ... w1 ... -> cpu
2 all-zero (bench default)   ... w1 ... -> gpu
```
The engine's own statements of the decode heat order are `NPU coolest, CPU between, GPU hottest`
(`src/llama-governor-policy.cpp:514-516`) and `NPU 0.15-0.17, CPU 0.30, GPU 0.35-0.42`
(`src/llama-ext.h:349-350`) — both put the GPU last — while the S23 campaign measured
`session13: NPU 2.8, GPU 3.2, CPU 4.7` (`step5-s23/run-step5-weight.sh:3-4`) and the new test fixture hard-codes
the same order (`tests/test-governor-v02-hop-heat-rank.cpp:49-51`). The commit ships no way to see the effective
rank order (`run_start` prints the heat values, `tools/governor-bench/governor-bench.cpp:379-387`, but never the
derived ranking), so a run whose heat params are all zero silently measures "NPU, then GPU, then CPU by enum".

### 1.6 [CONFIRMED] [P2] `decode_heat_weight` is inert for the HEAT_RANK ranking while still live in the fallback: one run uses two different weightings, and the campaign's own invocation is exactly that shape.

Code: `heat_rank_fit` compares `heat_per_token_of(...)` directly (`src/llama-governor-policy-hop.cpp:70-71`) and
never reads `params.decode_heat_weight`; the only reader is the v2 `effective_of`
(`:203-207`: `return headroom_of(engine) - params_.decode_heat_weight * heat - step_c;`) used by the fallback loop
(`:246, :251`). The bench help says nothing about it: `tools/governor-bench/governor-bench.cpp:41`
(`--heat-weight 0 = pure headroom = v1 rule (default),`). The campaign runs HEAT_RANK-relevant values with
`heat weight 7, per-token 2.8/3.2/4.7` (`run-step5-vsleg3.sh:6-7`), so in heat_rank mode the ranking uses
(2.8, 3.2, 4.7) unweighted while the fallback compares 7× them.

### 1.7 [CONFIRMED] [P3] Floors do exclude below-floor legs where HEAT_RANK runs; the refresh timing is safe; the "current leg demoted by a floor" hazard is REFUTED.

- `src/llama-governor-legs.cpp:296-297`: `set_decode_legs(npu_ok, gpu_ok,` / `true); // H-05: the CPU leg is never excludable`
  called from `refresh_decode_legs()` (`:271`), which is invoked at every turn latch
  (`src/llama-governor-legs.cpp:217`, `src/llama-governor.cpp:392-394`, `src/llama-governor-runtime.cpp:250-252`
  and `:294-297`) — and always *after* `policy_.reset_decode_hop()`.
- `present[]` is built from that mask (`src/llama-governor-policy-hop.cpp:164-172`), so a floored leg is not a
  candidate for either the guard test or the candidate test.
- `reset_decode_hop` (`src/llama-governor-policy.cpp:538-553`) does **not** reset `decode_hop_leg_`, so a demoted
  leg can still be the "current" leg into the next turn; but the first decode after every refresh has
  `window == 0` (`:247`, `:290` set `decode_tokens_since_prefill_ = 0`), and window 0 overwrites the leg from
  `present[]` in both rules (`:232-238`). The hazard I went looking for (a rule stuck on an absent current leg via
  `effective_of(decode_hop_leg_)` at `:251`) is therefore unreachable through the refresh paths in the tree.
  It would take a mid-turn mask change with `window > 0`, which no caller performs.

### 1.8 [CONFIRMED] [P3] The new window-0 comment describes only the all-known case; with any present leg's sample unknown the fallback is `alternation`, i.e. the **last** present leg (the CPU), for any weighting.

`src/llama-governor-policy-hop.cpp:274-279`: `} else {` / `decode_hop_leg_ = present[(window + n_present - 1) % n_present];`
— with the three-leg mask that is index 2, the CPU. The new comment at `:223-226` says
`WHY window 0 passes no current leg: nothing is loaded yet, so the cheapest leg opens only if it clears its`
`load step and the hysteresis as an idle candidate; otherwise the cold open falls to present[0], as NPU_FIRST does.`
That is true only inside `if (all_known)` (`:220`). `reset_decode_hop` NaNs every sample
(`src/llama-governor-policy.cpp:545-550`) at every completion, so window 0 of a turn is an alternation window
until the caller lands its first sample — the binding does it before the first decode per the comment at `:540-542`,
but the bench's `--headroom-file` path tolerates a malformed read and feeds NaN (`tools/governor-bench/governor-bench-run.cpp:425-429`).
No HEAT_RANK test covers the unknown-sample window (the NPU_FIRST equivalent is covered in
`tests/test-governor-v02-hop-v2.cpp:157`).

---

## 2. Window 0 and the `GPU_COOLMODE` sentinel

### 2.1 [REFUTED] `GPU_COOLMODE` cannot collide with a present leg and cannot be stored in `decode_hop_leg_`.

- `present[]` is filled from the three mask booleans only: `src/llama-governor-policy-hop.cpp:164-172`
  (`present[n_present++] = llama_governor_engine::NPU;` / `GPU` / `CPU`); `GPU_COOLMODE` is never written there.
- All assignments to the leg: `:176` (`= CPU`, fail-closed), `:233` (`= present[ranked]`), `:238` (`= present[0]`),
  `:252` (`= present[best]`), `:268` (`= GPU`, GPU_BURST), `:278` (alternation), plus
  `src/llama-governor-policy.cpp:507` (`= CPU`, hop inactive). `GPU_COOLMODE` is in none of them.
- The parameter is only ever compared: `:78` `engine == current`; the sentinel never reaches
  `heat_per_token_of`/`load_step_of` for a *present* leg (both return 0 for `GPU_COOLMODE` anyway, `:44-46`, `:53-55`).

It is nevertheless an implicit optional passed as an engine value and documented nowhere in the header
(`llama_governor_engine` has no "no leg" member); if a future caller sets `decode_hop_leg_ = GPU_COOLMODE`,
HEAT_RANK would silently treat it as "no current leg" and weaken the guard for the cheapest leg. P3, type-safety only.

### 2.2 [CONFIRMED] [P3] The cold open bypasses the guard for whatever leg is `present[0]`, and on this phone that leg is the NPU — the same leg the candidate test just rejected.

`src/llama-governor-policy-hop.cpp:235-238`: `} else if (window == 0) {` … `decode_hop_leg_ = present[0];`
is reached when `ranked < 0`, i.e. when *no* leg cleared `candidate >= guard + 4` — so the window then opens on
`present[0]` even if that leg is at −8 C of loaded headroom (probe: `1 w0 npu=10,gpu=7,cpu=8 -> npu`, where
`10 - 11 = -1 < 9`). The commit message documents this (`Window 0 passes no current leg, so the cheapest leg opens`
`only if it is fit as an idle candidate, else present[0] as before`), and it matches the owner's "open every decode
on the NPU" rule; the finding is that the "else" branch makes the window-0 guard bypass *unconditional* whenever the
NPU is present (it always is `present[0]`), so the guard never applies to the first window of any turn.

---

## 3. Did NPU_FIRST / GPU_BURST change?

### 3.1 [REFUTED] No behaviour change for NPU_FIRST or GPU_BURST.

- The diff touches four regions of `src/llama-governor-policy-hop.cpp` only:
  `@@ -14,6 +14,8 @@` (the file header comment), `@@ -43,6 +45,46 @@` (the new helpers),
  `@@ -159,27 +201,17 @@` (the `effective_of` refactor + `present_headroom`/`all_known`),
  `@@ -187,7 +219,20 @@` (the HEAT_RANK block and the `window == 0` branch). The last hunk's old range ends at old line 193,
  so the hop log block (old lines 247 and 255) and the `shift_smoothed_for_hop` call site (old lines 262-264) are **outside the diff**
  — the log format string and the shift condition are byte-identical (`git show 08ca9a82b -- src/llama-governor-policy-hop.cpp | grep '^@@'`).
- `effective_of` (`src/llama-governor-policy-hop.cpp:203-207`) now calls `heat_per_token_of` (`:48-56`), which maps
  the same three fields as the removed switch (`CPU→decode_heat_per_token_cpu`, `GPU→..._gpu`, `NPU→..._npu`,
  `GPU_COOLMODE→` break) and returns 0.0f otherwise: identical.
- `all_known` (`:210-217`) calls `headroom_of` exactly once per present leg and tests `std::isfinite` on the stored
  value, replacing `if (!std::isfinite(headroom_of(present[i])))` — same number of calls, same values;
  `headroom_of` has no side effects (`:182-197` reads only). The fallback loop's per-use `effective_of` calls
  (`:246, :251, :265-266`) are unchanged, so the call order and count are unchanged too.
- Control flow: `ranked` stays −1 unless `params_.decode_leg_weighting == HEAT_RANK` (`:227-231`), so the
  `if (ranked >= 0) … else if (window == 0) … else …` chain collapses to the old `if (window == 0) … else …`.
- The enum values are appended (`HEAT_RANK` last, `src/llama-ext.h:299`), the default stays
  `NPU_FIRST` (`src/llama-ext.h:386-387`), and the bench default stays `npu_first`
  (`tools/governor-bench/governor-bench.h:47`). `test-governor-v02-hop-v2-knobs` (GPU_BURST) and
  the 24-test run above pass unchanged.
- The new test's NPU_FIRST walk (`tests/test-governor-v02-hop-heat-rank.cpp:194-205`) I recomputed by hand against
  `:246-251`: deltas 20 C (hop), 9−12 = −3 (hold), 19−12 = 7 (hop) — the labels are right.

### 3.2 [CONFIRMED] [P2] The *statistic* did change meaning: `decode_hop_headroom_windows` now counts exactly the fallback windows in a HEAT_RANK run.

- `src/llama-governor-runtime.cpp:199-203`:
  `if (selection.hop_rule != nullptr) {` / `stats_.decode_hop_rule = selection.hop_rule;` /
  `if (std::strcmp(selection.hop_rule, "headroom") == 0) {` / `++stats_.decode_hop_headroom_windows;`
- `src/llama-ext.h:515-517` documents the field as `the windows` / `whose leg the headroom rule decided (zero while the alternation` /
  `fallback decides every window).`

Under HEAT_RANK every window decided by the new rule returns `hop_rule = "heat_rank"`
(`src/llama-governor-policy-hop.cpp:234`) and the counter stays 0, while the fallback windows (`:221`, label
`"headroom"`) *are* counted. The exported field, its doc and the only test that reads it
(`tests/test-governor-legs.cpp:310-322`) now describe a different quantity in heat_rank mode. The commit updated
the log-line consumers' constraint but not this stats consumer.

---

## 4. Param validation and the struct

### 4.1 [CONFIRMED] [P2] A mid-struct insertion into a **by-value** exported struct, with the runtime schema stamp left at 3 — a recurrence of the item already in the backlog.

- Insertion: `src/llama-ext.h:370` `float decode_guard_headroom_c = 5;` sits between
  `decode_load_step_cpu_c` (`:366`) and the pointer `const llama_governor_engine * forced_leg_sequence = nullptr;`
  (`:377`).
- The struct crosses the exported API **by value**:
  `src/llama-ext.h:598-603` (`LLAMA_API struct llama_governor * llama_governor_init_with_params(` …
  `struct llama_governor_params governor_params);`) and `:627-631` (same for `_one_model_with_params`).
- The stamp that exists to catch a skew is unchanged and is checked:
  `src/llama-ext.h:322` `uint32_t schema_version = 3;            // LaunchConfig v0.3.` and
  `src/llama-governor-policy.cpp:24` `return params.schema_version == 3 && params.capability_schema_version == 2 &&`.
  A caller built against the previous header sets 3 and is accepted with a shifted layout; the engine then reads
  `decode_guard_headroom_c` out of the caller's pointer bytes and `forced_leg_sequence` past the caller's struct —
  and that pointer is dereferenced when the forced hook is on:
  `src/llama-governor.cpp:132-133` `for (uint32_t i = 0; i < governor_params.forced_leg_sequence_n; ++i) {` /
  `const auto engine = governor_params.forced_leg_sequence[i];`.
- Same hazard, already on file: `scratchpad/BACKLOG-LOW-PRIORITY.md:231-234`
  (`F4 P2 PLAUSIBLE: three floats inserted mid-llama_governor_params shift old positional aggregate initializers and`
  `the by-value ABI. ... Option if it ever matters: append new fields at the struct's end.`). This commit inserts a
  fourth field mid-struct and moves the pointer again instead of appending.

Practical exposure today is limited because the binding vendors the engine source and is rebuilt with it
(`src/llama-ext.h:409`: `The binding vendors the engine and compiles against this header`), so no in-tree breakage
exists. The finding is that the one guard against a stale consumer (the schema stamp) is not bumped when the layout
changes, so it cannot do its job.

### 4.2 [REFUTED] No positional aggregate initializer of `llama_governor_params` exists in the tree.

`grep -rn "llama_governor_params{"` finds only `{}`/`()` forms (`src/llama-governor.cpp:36`,
`tests/test-governor-*.cpp` passim) and `grep -rn "options{" tools/` finds only `load_options{}`
(`tools/server/server-models.cpp:1096`, unrelated type). Field-by-field assignment is used everywhere
(e.g. `tools/governor-bench/governor-bench-run.cpp:218-241`), so the mid-struct insertion breaks nothing source-level
inside this repo. Same for `options` (`tools/governor-bench/governor-bench.h:61-62`, no positional use).

### 4.3 [CONFIRMED] [P3] `sanitize_guard_headroom` rejects NaN/negative/inf as documented, but accepts arbitrary finite magnitudes that silently disable HEAT_RANK (and, via the bench parser, subnormal inputs that narrow to 0.0f).

- `src/llama-governor-policy.cpp:74-84`: `// NaN makes every guard compare false (the current leg is always left), a`
  `// negative guard never leaves it, +inf never keeps it: any value that is not`
  `// finite and >= 0 is rejected to the 5 C default, the warning naming the value.`
  `if (!std::isfinite(value) || value < 0.0f) { … return 5.0f; }`
- `+inf` is rejected to 5, but `1e30f` (finite) is accepted and makes `V >= guard` false for every leg forever:
  `ranked` is always −1 → HEAT_RANK degenerates to *window 0 → present[0]*, *else the NPU_FIRST loop*, with no
  warning. The "invalid" set is a finiteness test, not a range test.
- The bench parser (`tools/governor-bench/governor-bench.cpp:67-75`) rejects non-finite/negative and re-checks
  `std::isfinite(value)` after narrowing, but a value below `FLT_MIN` (e.g. `--guard-headroom 1e-40`) narrows to
  `0.0f` and passes: the guard becomes 0 C, i.e. the current leg is kept until its headroom is *negative*. The same
  class of narrowing bug was already reported for `--headroom-tau` (`audit-hop-knobs-luna.md`, finding 4).
- The sanitized value is stored in the policy (`src/llama-governor-policy.cpp:115`) but the caller's copy is not
  updated; `run_start` prints the *option* (`tools/governor-bench/governor-bench.cpp:380,387`), which for bench
  runs equals the sanitized value, so no run log lies — but an app logging its own params struct would.
- Validation runs only in the policy constructor; the governor passes the struct through unchanged
  (`src/llama-governor.cpp:39-40`), so this is the single choke point (fine).

Also: `--guard-headroom` is accepted in every arm and printed even in non-heat_rank runs, and is passed to the
params unconditionally (`tools/governor-bench/governor-bench-run.cpp:230`) though the help says `(heat_rank only)`.

---

## 5. The test (`tests/test-governor-v02-hop-heat-rank.cpp`, 223 lines, 7 cases)

### 5.1 [CONFIRMED] [P2] Case-by-case: what the labels claim vs what the code exercises.

- `test_cheapest_leg_holds_while_fit` (`:76-91`) — real. Window 0 (NPU 30) then window 1 with the idle CPU at 60 C
  (`:83`): the control (NPU_FIRST) hops to the CPU (`:89`). This is the one case the rule exists for, and it bites.
  The third assertion (`:85`, NPU 20) repeats the second one with a smaller margin — no new boundary.
- `test_guard_moves_to_next_fit_leg` (`:95-104`) — real, and it is the only test that exercises the *ordering*
  among candidates; but it only passes because the fixture sets `gpu 0.25 < cpu 0.30` (`:50-51`), i.e. the
  ordering that `src/llama-ext.h:349-350` and `src/llama-governor-policy.cpp:514-516` contradict (§1.5). With the
  header's numbers the leg chosen in that situation is the **CPU** and this assertion fails — the test pins one of
  two conflicting data sets without saying which is authoritative.
- `test_return_needs_guard_plus_hysteresis` (`:109-120`) — real: 19 C (8 after step) stays off, 20 C (exactly 9)
  returns; the boundary is honoured with `>=` and the comment's arithmetic is right. It is also the only place that
  documents the 20 C entry bar — but it never states that 20 = guard + hysteresis + step, and it tests only one
  candidate leg, so nothing says the bar is a *hard* floor (probe2 shows 19 C never returns).
- `test_no_fit_matches_npu_first` (`:124-140`) — real, but the comparison `fallback.engine == control.engine`
  (`:137`) is against an independently built control policy, not a self-comparison, and is redundant with the
  hard-coded `:138`; the interesting follow-up (HEAT_RANK ratifying the fallback's unfit leg, §1.4) is missing.
- `test_ranking_follows_heat_params` (`:144-161`) — real; it does discriminate enum order from heat order
  (CPU-cheapest opens the window at `:151`, and the guarded CPU hands over to the NPU ahead of the GPU at `:159`).
  It does not cover the all-zero default (§1.5) or a leg dropped by a floor.
- `test_invalid_guard_defaults_to_5` (`:166-189`) — the loop's window-0 assertions (`:173-174`) cannot test the
  guard at all: window 0 never consults it (§2.2), and the sentinel path judges the NPU as an idle candidate, so
  these three checks are the same assertion three times. The discriminating ones are `:175-178` (with an
  un-sanitized `-1.0f` the NPU would *stay*, so the check bites) and `:187` (a valid 4 C guard keeps a 4.5 C NPU).
  Not a self-comparison. Missing: `1e30f` (accepted, §4.3), guard exactly 0, and a warning check.
- `test_npu_first_unchanged` (`:194-205`) — the four hand-computed legs are correct (I recomputed them), but this is
  a new-code test of the *new* code; it cannot demonstrate "byte-identical", which is what the commit message
  claims. Byte-identity rests entirely on the diff (§3.1); a golden-log or pre/post A/B check would be the evidence.

### 5.2 Missing coverage (all CONFIRMED absent by reading the file and grepping the tree)

1. **tau > 0**: `hop_params` (`:40-55`) never sets `decode_headroom_tau_s`, and `decide()` (`:63-67`) uses the
   3-argument setter; with tau 0 the EMA path (`src/llama-governor-policy-hop.cpp:100-102`) is inert. The whole
   EMA + `shift_smoothed_for_hop` interaction with the *new* guard (§1.2, §1.3) is untested — the same gap the
   load-step audit flagged (`audit-loadstep-luna.md`, finding 1: `No added test exercises nonzero load steps with tau > 0`).
2. **Floors / the leg mask**: every case calls `open_three_legs` (`:57-60`, `set_decode_legs(true, true, true)`) and
   never drops a leg, so HEAT_RANK with a floored cheapest leg (what `refresh_decode_legs` does on a slow leg) is untested.
3. **The default two-leg mask (NPU+CPU)** and `n_present == 1` (CPU only) are untested; all seven cases are three-leg.
4. **Unknown samples**: no case with a NaN leg, where HEAT_RANK is skipped entirely and the fallback is alternation (§1.8).
5. **Boundary at `headroom == guard` exactly** (the `>=` at `:79`) is untested; the hysteresis boundary *is* (20 C).
6. **`decode_heat_weight != 0`** in heat_rank mode (§1.6) and the **all-zero-heat tie order** (§1.5).
7. **`--guard-headroom` parsing** is exercised nowhere (grep: only the policy field assignments at `:170`, `:182`).

---

## 6. Readability, observability, dead code

### 6.1 [CONFIRMED] [P2] The only per-hop record cannot name the deciding rule, and the new label is missing from every header that documents the label vocabulary.

- `src/llama-governor-policy-hop.cpp:290-303` logs the leg change with the three headrooms and
  `k_hop_hysteresis_c` (`:292-293`: `(headroom cpu %.1f C,` / `" npu %.1f C, gpu %.1f C, hysteresis %.0f C)\n"`).
  The guard (5 C), the load step, and the rule name are absent, so a reader of `-v` output cannot tell a guard exit
  from a fallback hop — the two new-code paths that produce the same line. This is the exact place the review brief
  asks to show "WHEN and WHY each hop happens", and the commit's constraint (format unchanged for the instruments)
  is respected but leaves the new rule unexplained.
- The label vocabulary is stale in three headers:
  `src/llama-governor-policy.h:58-59` `// While the hop owns decode: static string naming what decided the` /
  `// current window's leg ("headroom" / "gpu_burst" / "alternation");`,
  `src/llama-governor.h:193` `// What decided the current hop window's leg ("headroom"/"alternation"),`,
  `src/llama-ext.h:536-537` `// the label of the last window decision ("headroom"/"alternation";` — none mentions
  `heat_rank` (or `forced`, `src/llama-governor.cpp:175`).
- Consequence for the campaign's own counting idiom
  (`step5-s23/run-step5-heat.sh:56`: `grep -oE 'rule=[a-z_]+' … | sort | uniq -c`): a heat_rank run's histogram
  reports the fallback windows as `headroom` and the *fallback-ratified* windows as `heat_rank`, so the tape cannot
  separate "HEAT_RANK decided" from "HEAT_RANK gave up" (see §1.4 and §3.2).
- `k_hop_hysteresis_c`'s comment (`src/llama-governor-policy.h:26-30`: `another leg must beat the current one's`
  `effective headroom by this much before a window boundary`) describes only the v2 use; in HEAT_RANK the same
  constant is added to the guard for the candidate test, a second meaning that is not documented where it is used.

### 6.2 [CONFIRMED] [P3] Smaller readability items.

- `src/llama-governor-policy-hop.cpp:67` `for (int step = 0; step < n_present; ++step) {` — the rank-iteration
  counter is named `step` in the one function that also reasons about load steps (`load_step_of`, `step_c`,
  `decode_load_step_*_c`). Renaming to `rank` costs nothing and removes the ambiguity.
- `:66-75`: `bool used[3]` + 3-element selection sort is a quadratic idiom for three legs; the tie-break property
  the header relies on (`:62-63`) is emergent from the strict compare rather than stated at the header's enum doc
  (`src/llama-ext.h:293-299`), which says `Decides from measured headroom, not a per-SoC ranking` but not that
  equal heat degenerates to `present[]` order (§1.5).
- `:210` `float present_headroom[3] = { 0.0f, 0.0f, 0.0f };` is computed for every mode but read only by HEAT_RANK,
  while `effective_of` (`:206`) still calls `headroom_of` for the same present legs — two mechanisms for one value.
  No behaviour change (§3.1), but the array's stated purpose ("the new present_headroom array") is only half-used.
- File growth: `src/llama-governor-policy-hop.cpp` 267 → 312 lines (+45, of which ~42 are the two new helpers),
  `src/llama-governor-policy.cpp` 563 → 576 (+13), the new test +223. No dead code was introduced: the two new
  helpers are both used (`heat_per_token_of` at `:204` and `:70-71`; `heat_rank_fit` only under HEAT_RANK, `:229`),
  and `heat_per_token_of`'s `GPU_COOLMODE` case is unreachable exactly like the pre-existing `load_step_of`'s
  (`:44-46`, `:53-55`).

---

## Verdict table

| # | Finding | Verdict | Severity |
|---|---|---|---|
| 1.1 | Re-entry bar is `guard+hysteresis+step` = 20 C (S23), 4× the documented guard; ≈ the loaded NSP headroom 20.3 C | CONFIRMED (probe + plan numbers) | P1 |
| 1.2 | Guard exit is an EMA test: 16-27 windows (tau 8 s) after the raw collapses; tau 10 s in the campaign | CONFIRMED (probe) | P2 |
| 1.3 | No self-flap; guard exit stable; departure requires +4 C improvement to return | REFUTED (proof + probe) | — |
| 1.4 | Fallback parks on an unfit leg, next window ratifies it; label flips while the leg does not | CONFIRMED (probe) | P2 |
| 1.5 | All-zero heat (bench default) ranks by enum order: GPU second though the engine's own comment calls it hottest | CONFIRMED (probe) | P2 |
| 1.6 | `decode_heat_weight` inert for the ranking, live in the fallback (the campaign's own invocation) | CONFIRMED | P2 |
| 1.7 | Floors do filter `present`; floor refresh cannot leave an absent current leg (window 0 repairs it) | CONFIRMED / hazard REFUTED | P3 |
| 1.8 | Window-0 comment covers only the all-known case; NaN samples ⇒ alternation ⇒ CPU | CONFIRMED | P3 |
| 2.1 | `GPU_COOLMODE` sentinel cannot collide or be stored | REFUTED | P3 note (type safety) |
| 2.2 | Cold open ignores the guard whenever the NPU is `present[0]` | CONFIRMED | P3 |
| 3.1 | NPU_FIRST/GPU_BURST decisions byte-identical; log format and shift block outside the diff; `all_known` identical | REFUTED | — |
| 3.2 | `decode_hop_headroom_windows` now counts the fallback in heat_rank runs; field doc lies | CONFIRMED | P2 |
| 4.1 | Mid-struct insertion in a by-value exported struct without bumping `schema_version` (backlog recurrence) | CONFIRMED (in-tree clean) | P2 |
| 4.2 | No positional initializers of the params/options structs in-tree | REFUTED | — |
| 4.3 | Validation accepts `1e30f` (HEAT_RANK silently off) and subnormal→0 via the bench parser | CONFIRMED | P3 |
| 5.1 | Case labels mostly honest; window-0 guard checks vacuous ×3; fixture pins a contested heat order; "byte-identical" not evidenced by the test | CONFIRMED | P2 |
| 5.2 | Missing: tau > 0, floors, two-leg/one-leg masks, NaN samples, the exact `headroom == guard` boundary, heat_weight, all-zero ties, bench parser | CONFIRMED | P2 |
| 6.1 | Hop line cannot name the rule or the guard; label vocabulary stale in 3 headers; stats/`rule=` counting misleading | CONFIRMED | P2 |
| 6.2 | `step` naming collision, `used[3]` sort, half-used `present_headroom`, file growth, no dead code | CONFIRMED | P3 |

## Open questions for the owner (not defects, but the rule's inputs are unresolved)

1. **Which decode heat order is authoritative, CPU vs GPU?** The engine text says `NPU < CPU < GPU`
   (`llama-ext.h:349-350`, `llama-governor-policy.cpp:514-516`); the S23 campaign measured `NPU < GPU < CPU`
   (`run-step5-weight.sh:3-4`) and the new test hard-codes that. On identical readings the two give different legs
   (probe: `gpu` vs `cpu`), and the fallback still uses `decode_heat_weight` (7 in the campaign) while the ranking
   does not (§1.6).
2. **Is the NSP-zone headroom the right budget for leg selection?** The owner already removed it from the
   endurance criterion (`PLAN.md:2209-2211`: `the NSP zone is a load step (55-60 -> 78-87 C in 2 s), its 95 C`
   `passive trip never engaged a cooling device (cdsp/cdsp_hw 0 throughout) and skin is what binds`). v3 hands leg
   selection to that same signal (guard 5 C ≈ NSP 90 C; entry 20 C ≈ NSP 75 C).
3. **Is the 20 C re-entry bar intended?** It follows from the dispatch spec (`PLAN.md:2197`) and from the load step,
   but it is the quantity that decides how much of a hot session runs on the CPU/GPU; with the NSP's measured
   loaded headroom at 20.3 C and the EMA needing the raw to *exceed* 20, the margin is ~1 C on this phone, and the
   exposed guard knob silently raises the bar (guard > ~16.5 C makes the NPU unreachable while the GPU leg runs).
4. **`--heat-per-token` with defaults 0,0,0 is not a no-op in heat_rank mode** — it silently means "NPU, then GPU,
   then CPU". Should the bench refuse heat_rank with all-zero heat (or warn), instead of measuring enum order?

## Probe reproducibility (nothing in the repo was touched)

- `ctest --test-dir build-host -R governor > /tmp/ctest-gov-rulev3.log 2>&1; echo $?` → `0`; the new test passed.
- Warning rebuild: `/usr/bin/c++ -std=c++17 -O1 -I src -I include -I ggml/include -c src/llama-governor-policy-hop.cpp`
  `-o /tmp/rulev3probe/hop.o -Wall -Wextra -Wswitch-enum -Wshadow` → exit 0, no output.
- Probes: `/tmp/rulev3probe/probe.{cpp,log}` (runs A/C/D), `probe2.{cpp,log}` (re-entry thresholds),
  `probe3.cpp` (void, wrong ctor — kept only as a discarded draft), `probe4.{cpp,log}` (fallback + heat order),
  linked with `-L build-host/bin -lllama -lggml-base`. Each prints its own numbers; exit code 0.
- Repo state at the end: `git status --short` empty, HEAD `08ca9a82b`; no build of the tree, no device, no commit.
