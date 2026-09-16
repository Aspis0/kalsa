# Hostile audit — core-placement energy sweep instrument (`scripts/device-energy-sweep.sh`)

Commit under audit: `da3192e6903aff124f758d20b40be2e263aab25b` — "feat(energy): add core placement sweep
instrument" (branch `energy-framework`, tree clean, one file added, 691 lines).
Subject: `scripts/device-energy-sweep.sh`, the instrument that will decide whether Fase 2b (an
energy-objective core-placement policy) is worth building.
Date: 2026-09-16.
Mode: read-only. **No adb was run, no phone was touched** (the Jelly is idle and was left idle; the S23 was
never addressed). No repo file was created, modified, committed or pushed; `git status --porcelain` is empty
before and after. All scratch under `/tmp/kalsa-audit-sweep/`.

Method. Because the instrument has never executed on a device, "it would work" is not checkable directly, so
verification is split into three falsifiable layers, all executed:

1. **The committed bytes** — `bash -n`, the two node harnesses, `git show --stat`, the sibling diffs.
2. **The real functions, with a fake `adb`** — the prefix of the committed file up to `main() {` was extracted
   verbatim (`awk '/^main\(\) \{/{exit} {print}'`, md5 `4571c3ad…`) into `/tmp/kalsa-audit-sweep/scripts/` next to
   symlinks to the real `device-share-send.sh` / `device-env.sh` / `ci-lib.sh`, with a scripted `adb` on
   `PATH` that logs every call and scripts battery/charging/CLI outcomes. Every log line quoted below with a
   `[B]`/`[C]`/`[E2]` prefix comes from that harness. Where the script dies (F1) or where a file must be
   *absent*, the trace is from a one-line-patched copy of the extracted prefix; that patch is exactly flip
   item 1 and is named every time it is used.
3. **The real analysis, on real device bytes** — the sweep's stem scheme was reproduced with byte-identical
   copies of the committed v3 run-1 artifacts (`device-v3-out/run1/*`) renamed to
   `${model}_${block}_p${position}_${arm}`, and the committed pipeline (splitter + the report heredoc
   `e8f236b8…` extracted from the file) was run over that tree. This tests the plumbing, the join keys, and
   every gate with real sampler/stamp/mark bytes. It is labelled a plumbing probe throughout: it manufactures
   no physics and its *energy numbers mean nothing*.

Nothing below rests on inspection alone. Where a claim is reasoned rather than tested it says so.

## Verdict

**NO-SHIP.**

One blocker makes the instrument non-executable: `energy_start` dies on its own `local` line under the
script's `set -u`, before a single sampler starts, on the first device action of the campaign (F1). It is a
one-line fix, and after it the harness does run — the fake-adb trace shows the whole block machinery working
end to end (mask applied to the CLI itself, gate before every arm including the first and the control,
mark written before the stamp pull, sampler started and stopped on every path exercised).

The second layer of blocking findings is the one that matters for the decision: the instrument **cannot
certify the mask**, **cannot certify the J-per-token figure at the few-percent level the pilot needs**, and
**reports "stable" for arms with no data**. F2 (no proof of placement), F3 (idle floor and arms measured in
different, unrecorded screen/awake states, with a documented 0.87 W session step at stake), F4 (the stability
gate fails open on missing reps and ignores the row warnings it prints), F5 (no order-confound estimate, so a
10 % same-arm position step moves the headline by 4.8 points unflagged) each survive on their own. F1–F5 must
be fixed before a device run, otherwise the run costs a device session and produces a number the owner's
15 % rule cannot safely be applied to.

---

## F1 — BLOCKER. `energy_start` expands a variable it is declaring in the same `local`; under `set -u` the instrument dies before the first sampler starts

`scripts/device-energy-sweep.sh:261`:

```bash
energy_start() {
  local tag="$1" max_iter="$2" stop="$BENCH_DIR/stop.energy.$tag"
```

`local` is a builtin: the *whole simple command's* words are expanded before it runs, so `$tag` in the third
word is expanded while `tag` is still unset and the script's `set -uo pipefail` (line 41) turns that into a
fatal error. The host's only bash is 3.2.57 (`#!/usr/bin/env bash` resolves to `/bin/bash`), which is also the
shell the sibling scripts document as the host shell.

Minimal reproduction, on the extracted-verbatim function body and on a two-line equivalent:

```
$ /bin/bash --version | head -1
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
$ bash -c 'set -u; f(){ local tag="$1" stop="/x/$tag"; echo "ok stop=$stop"; }; f hello'; echo "rc=$?"
bash: tag: unbound variable
rc=127
$ bash -c 'f(){ local tag="$1" stop="/x/$tag"; echo "stop=$stop tag=$tag"; }; f hello'
stop=/x/ tag=hello
```

The second command is the same bug with `set -u` off: the local `stop` is built from the *empty* string, i.e.
`stop.energy.` with no tag — a second, independent reason the line is wrong.

Fatal, not local. Against the unpatched extracted prefix (`h0.sh` sources
`/tmp/kalsa-audit-sweep/scripts/sweep-prefix.sh` and calls `energy_start` with two arguments, exactly as
`run_one_arm` does):

```
$ bash h0.sh
/tmp/kalsa-audit-sweep/scripts/sweep-prefix.sh: line 261: tag: unbound variable
shell rc=1
$ bash -x h1.sh 2>&1 | grep -B2 "unbound variable"          # full harness, before the one-line patch
+ energy_start LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2 7200
/tmp/kalsa-audit-sweep/scripts/sweep-prefix.sh: line 261: tag: unbound variable
+ sweep_cleanup
```

The gate had already run (`temperature gate: ready at 300 deci-C (threshold 300), waited 4s`) and the block
had already logged `block start: … position=1 arm=a55_t2`; the failure is the first statement of
`energy_start`, i.e. before the sampler, before any `taskset`, before any CLI.

On the real script the *first* caller is `run_idle_floor` (line 429), which `main` calls at line 679 — after
`select_serial`, `preflight`, `device_keepawake_begin` (screen_off_timeout→24 h), `push_bin` (~200 MB of
`.so`), `verify_models` and `push_prompt`, and before any model block. So the observable device-run outcome is:
several minutes of setup, then a bash error on stderr that `blog` never records (nothing is written to
`results.txt`), then the EXIT trap restores and exits. The operator sees a broken harness and no reason for it
— `results.txt` will contain no line explaining the failure, because the error bypasses `blog`.

The other fifteen `local` statements in the file were checked; `energy_stop` (line 275) has the same shape but
is safe (`dest="$DATA_DIR"` does not reference `tag`). `grep -n '^\s*local '` output is in the transcript;
line 261 is the only self-referencing one.

## F2 — MASK EFFECTIVENESS: the mechanism is right and the proof is absent; the preflight asserts only that `taskset` exits 0

What is right, and verified:

```
$ grep -oE 'timeout 600 (taskset [0-9a-f]+ )?\./llama-cli' harness/trace.txt | sort | uniq -c
   2 timeout 600 ./llama-cli
   4 timeout 600 taskset 3f ./llama-cli
   4 timeout 600 taskset c0 ./llama-cli
$ grep -n 'launcher' scripts/device-energy-sweep.sh
329:  launcher="./llama-cli"
330:  [ -n "$mask" ] && launcher="taskset $mask ./llama-cli"
```

(Each arm's command line is logged twice in the trace — once as the adb argv, once by the fake device — hence
4 lines for the two `3f` arms, 4 for the two `c0` arms, and 2 for the single unpinned control arm.)

`taskset` is the direct parent of `./llama-cli` (the only parent above it is `timeout`), so the mask is applied
to the CLI's own process and inherited by every thread — there is no parent for the child to escape from. Two
further facts, checked rather than assumed: the sweep passes no affinity flag of its own
(`strings tmp/build-android-phase-stamps/bin/libllama-cli-impl.so | grep -E 'cpu-mask|cpu-range|strict-cpu'`
printed nothing, and the arm command line above carries no affinity flag),
and nothing inside the engine can re-widen the mask afterwards:

```
$ grep -n "sched_setaffinity\|__gnu_linux__" tmp/kalsallama-pin/ggml/src/ggml-cpu/ggml-cpu.c | sed -n '5,8p'
2447:#if defined(__gnu_linux__)
2907:#elif defined(__gnu_linux__)
2924:    err = sched_setaffinity(0, sizeof(cpuset), &cpuset);
$ for f in tmp/build-android-phase-stamps/bin/*.so; do printf '%s sched=%s pthread=%s\n' "$(basename $f)" "$(strings $f|grep -c sched_setaffinity)" "$(strings $f|grep -c pthread_setaffinity)"; done
libggml-base.so sched=0 pthread=0
libggml-cpu.so sched=0 pthread=0
libggml.so sched=0 pthread=0
libllama-cli-impl.so sched=0 pthread=0
libllama-common.so sched=0 pthread=0
libllama-server-impl.so sched=0 pthread=0
libllama.so sched=0 pthread=0
libmtmd.so sched=0 pthread=0
```

The Android guard (`__gnu_linux__`, F3 of `ENERGY-2B-SELF-AUDIT-2026-09-15.md`) holds in the built
`build-android-phase-stamps` artifacts: no affinity symbol is present at all, so a worker cannot move itself
off the mask. The mask is therefore sufficient *if it is applied*.

What is missing: nothing in the instrument establishes that it was applied, and nothing in the outputs would
let a reader tell "the arm ran on the A55s" from "the mask was ignored". The complete list of mask-related
evidence the outputs carry is:

| artifact | content | can it distinguish a failed mask? |
|---|---|---|
| `order.tsv.mask` | the *requested* literal `3f`/`c0` | no — it is the script's own constant |
| `block-meta.tsv.mask` | same requested literal | no |
| report §4 `mask` column | same requested literal (`unset` for the control) | no |
| report §4 `gen t/s` | implies placement only against an external expectation (~2.9× A55/A76: `archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md:88`, "on an A55 reads 3.95 tok/s against 11.43 on an A76 — a 2.89x ratio") | indirectly, and only if someone brings the expectation |
| `phase-data/<stem>.csv` `cpu_freqs_kHz` | the per-CPU clock of every CPU, every sample — the one field that can see placement | **recorded and never read**: `grep -c cpu_freqs` = 0 in both the script and the report heredoc |

```
$ grep -n "Cpus_allowed\|cpu_freqs\|scaling" scripts/device-energy-sweep.sh || echo "NO MATCH"
NO MATCH
$ grep -c cpu_freqs /tmp/kalsa-audit-sweep/report-inline.mjs
0
```

The instrument's only mask check is:

```
$ sed -n '221,222p' scripts/device-energy-sweep.sh
  if ! adb shell "taskset 3f /system/bin/true && taskset c0 /system/bin/true" </dev/null >/dev/null 2>&1; then
    blog "ABORT: toybox taskset rejected one of the required bare masks (3f/c0)"
```

`/system/bin/true` exits 0 whatever happens to it, so this proves that toybox *parses* the mask and exits 0. It
cannot fail on a silent no-op, and it says nothing about which CPUs `c0` selects on this device. The design
audit's own probe (F11 there) is the stronger form —
`taskset 3f sh -c 'grep Cpus_allowed_list /proc/self/status'` → `0-5`, `c0` → `6-7`, unconstrained → `0-7` —
was run once on device by hand and is not part of the instrument. Item 1 also asks whether all 8 CPUs are
eligible when the mask is unset: the instrument never checks that either, and the design audit's on-device
`0-7` reading is the only evidence that the unset arm is unconstrained.

Consequence: the project's documented burn (two byte-identical arms measured as if they differed) recurs in a
new form here. With the plumbing probe I ran four arms built from the *same* bytes: four requested masks, two
different arms, and the report emitted `stable` for all four with a frontier of `0.0 % / 0.0 %` and no
comment. If the `a55_t2` mask had silently failed, the report would look exactly like that (speeds differing
by ~0 %, J/token change ≈ 0 %): a null result that is indistinguishable from a correct measurement of "A55
placement does not help decode energy".

## F3 — TEMPERATURE GATE and IDLE FLOOR: the gate turns the screen off for every arm that has to wait, the floor is deliberately taken with the screen on, and neither state is recorded

The gate runs before every arm, including the first and including the unset-mask control — verified by the
event sequence the fake device logged for a full `primary_t2` + `control` run (`REPS=1`), not by reading:

```
$ grep -o 'TRACE [a-z_]*' harness/trace.txt | awk '{print $2}' | uniq -c | tr '\n' ' '
   4 screen_off    1 sampler_pkill    1 sampler_start    1 cli    1 cli_start    1 mark    1 pull    1 sampler_stop    2 pull
   1 sampler_pkill    1 sampler_start    1 cli    1 cli_start    1 mark    1 pull    1 sampler_stop    2 pull
   … (repeated for arms p2, p3, p4) … the control block repeats the same 8 events with no screen_off
```

Four `screen_off` calls, then five arms each with `pkill → sampler_start → CLI → mark → pull → sampler_stop →
pull ×2`. The first gate is the only one that waited (my scripted temperature fell to 290 deci-C at the fifth
poll), so **the display is asleep for every arm after the first gate wait and nothing ever wakes it** —
which is F3.

The unit the code compares is deci-°C, matching `dumpsys battery` (`temperature: 350` = 35.0 °C) and the
sibling's `COOL_DC` convention:

```
02:51:16 temperature gate: ready at 300 deci-C (threshold 300), waited 4s
$ grep -n 'ready at\|timed out at\|"$t" -le' scripts/device-energy-sweep.sh
166:        if [ "$t" -le "$TEMP_GATE_DECI" ]; then
167:          blog "temperature gate: ready at ${t} deci-C (threshold ${TEMP_GATE_DECI}), waited ${waited}s"
173:      blog "ABORT: temperature gate timed out at ${t:-unknown} deci-C after ${waited}s."
```

Never-cools behaviour is the safe one — it aborts loudly and does **not** run the block:

```
[B] 02:51:42 temperature gate: waiting at 380 deci-C; poll in 1s      (×3, timeout 3 s in the harness)
[B] 02:51:42 ABORT: temperature gate timed out at 380 deci-C after 3s.
[B] run_block rc=1
[B] cli invocations: 0
[B] screen_off calls: 3
```

An unreadable temperature behaves the same way (it can never satisfy `-le`): an early harness run with a
one-line temperature script produced `temperature gate: waiting at unknown deci-C` three times and then
`ABORT: temperature gate timed out at unknown deci-C after 3s.` — no arm ran.

Where it fails is the state it leaves behind and the state it starts from. `KEYCODE_SLEEP` at line 178 is the
only screen control inside `run_block`; the only `KEYCODE_WAKEUP` calls in the file are in `run_idle_floor`
(427, the floor is *defined* as "screen awake") and in `main` before `push_bin` (675). Nothing wakes the screen
after a gate wait, and nothing records it:

```
$ grep -n "keyevent" scripts/device-energy-sweep.sh
178:    if ! adb shell input keyevent KEYCODE_SLEEP </dev/null >/dev/null 2>&1; then
427:  adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || return 1
675:  adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || true
$ head -2 harness/out/block-meta.tsv | cut -f6-12
threads	start_level	start_temp_deci	end_level	end_temp_deci	start_state	end_state
2	50	290	50	290	Current Battery Service state:   AC powered: false   USB powered: false   Wireless powered: false   level: 50   scale: 100   voltage: 4000   temperature: 290 	Current Battery Service state: …
```

`start_state`/`end_state` carry the same battery blob as the level/temperature columns — not the screen, not
`mWakefulness`. So the report can never show whether an arm ran with the display lit.

Three consequences, in increasing order of cost:

1. **Floor vs arms (item 6, the stated requirement).** The floor is taken screen-awake by construction; the
   arms are screen-off from the first gate that has to wait. The report then prints the floor as the session's
   absolute anchor ("The screen-awake idle sampler ran for …"), which is a different electrical state from
   every arm.
2. **Arms vs each other.** Arm p1 runs in whatever state `run_idle_floor` left (screen on) unless its own gate
   has to wait; p2–p4 run after a gate that turned the screen off. In the ABBA pooling, that puts a screen-on
   sample into the `a55_t2` mean (p1) and a screen-off sample into the same arm's p4, while both `a76_t2`
   samples (p2/p3) sit after the first wait. The bias direction is against the treatment arm.
3. **Doze.** With the screen off for the rest of the session and no wakelock held by the harness (the Doze
   exemption `device_keepawake_setup` installs is for `com.kalsa.app`, and no app is running), nothing keeps
   the device out of deep idle between and possibly inside arms. The project's own harness comment records
   exactly this failure on another device (ci-lib.sh, "an S23 mid-arm went mWakefulness=Dozing — the app
   stopped generating").

Size of the effect: the committed cross-session floor step recorded in `ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md`
§"Added 1" is **0.035 W (old session) against 0.900/0.926/0.926 W (v3, screen awake, p5 0.96–0.99 W)** — a
0.87 W step of the same order as the screen/awake state — against a decode-window mean power of ≈3.5 W
(committed v3 sidecars). That is ~25 % of the quantity being compared, i.e. larger than the 15 % the owner's
rule is asked to resolve. It cannot be cancelled by ABBA because it is not a monotone drift: it depends on
which arm happens to be first or to have a warm gate.

## F4 — The stability gate fails open: missing reps and missing metrics are reported as `stable`, and the warnings the report prints do not gate the frontier

The gate is the report's own first instruction ("read first"), so failing open is a decision-level defect.
Three paths, all reproduced on the real pipeline with the real splitter:

**(a) A rep with no stamps contributes a speed but no J/token.** Deleting the three `.stamps` files of p4 in
the probe tree (an arm with no usable energy numbers, exactly what a failed stamp pull produces) gives:

```
$ rm probe3/phase-data/*_primary_t2_p4_a55_t2_r*.stamps   # then re-run the committed pipeline
energyPhaseSplit: LFM2.5-2.6B-Q4_K_M_primary_t2_p4_a55_t2: r1: phase stamps absent; falling back to kalsa-energy-rep-v2 arithmetic
energyPhaseSplit: LFM2.5-2.6B-Q4_K_M_primary_t2_p4_a55_t2: r2: phase stamps absent; falling back to kalsa-energy-rep-v2 arithmetic
energyPhaseSplit: LFM2.5-2.6B-Q4_K_M_primary_t2_p4_a55_t2: r3: phase stamps absent; falling back to kalsa-energy-rep-v2 arithmetic
$ cut -d, -f2,6,11 probe3/phase-data/LFM2.5-2.6B-Q4_K_M_primary_t2_p4_a55_t2.phases.csv
rep,decode_s,j_per_tok_decode
1,,
2,,
3,,
$ sed -n '/## 1. Stability/,/^All/p' probe3/out/SWEEP-REPORT.md | tail -2
| … | primary_t2 | 4 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | r1=3.9/r2=3.9/r3=3.9 | 0.0% | stable |
All completed blocks are within the configured throughput-spread limit.
$ grep '| a55_t2 | 3f | 2 | 1 |' probe3/out/SWEEP-REPORT.md | tail -1     # the p4 r1 row in §4
| … | primary_t2 | 4 | a55_t2 | 3f | 2 | 1 | 3.9 |  | n/a |  |  |  |  | decode duration not derivable (needs gen token counts from counts manifest / --gen-tokens / perf line, and a speed line) | 87%/270 → 86%/270 | stable |
$ sed -n '/## 5. Frontier/,/## 6/p' probe3/out/SWEEP-REPORT.md | tail -3
| LFM2.5-2.6B-Q4_K_M | a55_t2 | 65.422 | 0.884 | 0.0% | 0.0% | does not meet rule |
| LFM2.5-2.6B-Q4_K_M | a76_t2 | 65.422 | 0.884 | 0.0% | 0.0% | does not meet rule |
```

p4 is *stable* with zero energy data; the `a55_t2` frontier row is then computed from p1's three reps where
six were intended, and nothing in §1 or §5 states the contributing count. The code is the cause: the spread is
built from `speeds` (the CLI's t/s, which exists even when the stamps do not) and an empty `jtok` array is
silently averaged.

**(b) "No data" is rendered as "stable".** A group with fewer than two finite speeds gets
`spread = NaN`, and `unstable` requires `Number.isFinite(spread)`, so it is reported `stable`:

```
$ sed -n '545,546p' scripts/device-energy-sweep.sh
  group.spread = speeds.length && mean > 0 ? ((Math.max(...speeds) - Math.min(...speeds)) / mean) * 100 : NaN;
  group.unstable = Number.isFinite(group.spread) && group.spread > stabilityLimit;
```

A single surviving rep, or a missing `_rN.txt`, therefore reads as a pass. This is the same shape as the
historical "two identical failures compare equal and masquerade as a pass" that `device-ngram-spec.sh` guards
against for its greedy gate — here the energy metric has no such guard.

**(c) The row warnings are printed but never gate.** §4 does surface the splitter's `warnings` column
(verified: a row with a low-resolution decode bucket carries the text), but the frontier's rule checks only
`unstable`:

```
$ sed -n '637,640p' scripts/device-energy-sweep.sh
  const unstable = [...(groupsByModel.get(group.model) ?? [])].some((g) => g.unstable);
  let rule = "n/a";
  if (unstable) rule = "UNINTERPRETABLE";
  else if (Number.isFinite(slowdown) && Number.isFinite(change)) rule = slowdown <= 25 && change <= -15 ? "meets rule" : "does not meet rule";
```

A row whose `j_per_tok_decode` is sampling-granularity dominated (the splitter's own
`decode bucket low-resolution` text, the F5/low-resolution family of the v3 audits) still feeds the headline
`J/token change`. The v3 audit's §8 shows how load-bearing that warning is:
the whole 1.2B/PURE family rests on 2–3-interval decode buckets.

## F5 — ABBA is genuinely scheduled and honestly reported, but the analysis pools positions and never estimates the order confound; a 10 % step in one arm moves the headline by 4.8 points unflagged

The schedule and the reporting are right:

```
$ sed -n '366,373p' scripts/device-energy-sweep.sh
block_arm_list() {
  case "$1" in
    primary_t2) printf '%s\n' 'a55_t2 a76_t2 a76_t2 a55_t2' ;;
    a55_t6) printf '%s\n' 'a55_t6 a76_t2 a76_t2 a55_t6' ;;
```

executed order is computed from `order.tsv`, which is appended immediately before each arm runs (line 399),
and `block-meta.tsv`'s separate `order` string is deliberately ignored in favour of it:

```
$ head -3 harness/out/order.tsv
sequence	model	block	position	arm	mask	threads	stem
1	LFM2.5-2.6B-Q4_K_M	primary_t2	1	a55_t2	3f	2	LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2
2	LFM2.5-2.6B-Q4_K_M	primary_t2	2	a76_t2	c0	2	LFM2.5-2.6B-Q4_K_M_primary_t2_p2_a76_t2
$ sed -n '9,10p' probe/out/SWEEP-REPORT.md
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | r1=3.9/r2=3.9/r3=3.9 | 0.0% | stable |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | r1=3.9/r2=3.9/r3=3.9 | 0.0% | stable |
```

The analysis, however, keys arms by `model|arm` and pools positions (`armGroups`, lines 621–627), and the
stability check is *within* a position only (`blockGroups` key = `model|block|position|arm`). The ABBA's
central protection — the two positions of the same arm bracket the two positions of the other arm — is
therefore computed nowhere. With the real pipeline I perturbed **only** p3's current column by +10 % (a
stand-in for the documented thermal step: the v3 audit measured a 23 % throughput drop coinciding with a 1.0 °C
battery-temperature rise) and got:

```
$ # p2 (a76_t2) and p3 (a76_t2), same arm, adjacent positions, real sidecars
p2 a76_t2  mean J/tok = 0.8837 (n=3)
p3 a76_t2  mean J/tok = 0.9727 (n=3)          # +10.1 % same-arm position difference
$ sed -n '/## 1. Stability/,/^All/p' probe5/out/SWEEP-REPORT.md | tail -2
| … | primary_t2 | 2 | a76_t2 | … | r1=3.9/r2=3.9/r3=3.9 | 0.0% | stable |
| … | primary_t2 | 3 | a76_t2 | … | r1=3.9/r2=3.9/r3=3.9 | 0.0% | stable |
All completed blocks are within the configured throughput-spread limit.
$ sed -n '/## 5. Frontier/,/## 6/p' probe5/out/SWEEP-REPORT.md | tail -3
| LFM2.5-2.6B-Q4_K_M | a55_t2 | 65.422 | 0.884 | 0.0% | -4.8% | does not meet rule |
| LFM2.5-2.6B-Q4_K_M | a76_t2 | 65.422 | 0.928 | 0.0% | 0.0% | does not meet rule |
```

Every gate passes; the published `J/token change` for `a55_t2` silently becomes −4.8 % (it was 0.0 % before the
step). If the step had landed on the treatment arm instead of the reference, the same mechanism would move the
headline in the other direction, and the step up to +10 % would appear as a real effect — 10 points of a
15 % decision threshold. This is precisely the artefact the self-audit's Step 0 (`ENERGY-2B-SELF-AUDIT`,
F1/Step 0) required be bounded before a sweep result could be read: *"measure the same configuration
interleaved, ABBA-ordered … report the spread of `j_per_tok_decode` across arms that differ only by run
order."* The sweep contains an A-A pair by construction (p2 and p3 are both `a76_t2`), so the bound is
available at zero device cost and is thrown away by pooling.

## F6 — Sampler lifecycle: complete on success, failure, abort and interrupt; one hole on a start that fails while the device started it

Every path I could exercise stops the sampler, and the stopfile/pidfile discipline matches the device script
(`energy-sample.sh` writes `$OUT.pid`, loops on the stopfile, caps at `MAXIT`, and removes its pidfile):

```
$ grep -n 'setsid sh\|stop.energy.LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2 2>\|echo r1\|TRACE pull' harness/trace.txt
16:adb <shell> <pkill -f '[e]nergy-sample.sh' 2>/dev/null; rm -f /remote/bench/stop.energy.LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2 /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv …>
18:adb <shell> <(setsid sh /remote/bench/energy-sample.sh /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv /remote/bench/stop.energy.LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2 1 7200 >… 2>&1 </dev/null &)>
24:adb <shell> <echo r1 $(cut -d' ' -f1 /proc/uptime) >> /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.marks>
27:TRACE pull /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2_r1.stamps
28:adb <shell> <touch /remote/bench/stop.energy.LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2 2>/dev/null; sleep 2; kill $(cat /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv.pid 2>/dev/null) 2>/dev/null; rm -f /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv.pid>
31:TRACE pull /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv
33:TRACE pull /remote/bench/LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.marks
(lines 18 and 28 wrapped here; the sampler is given the tag-derived stopfile name, `energy_stop` kills the same
`.csv.pid` the device script writes, and the mark at line 24 precedes the stamp pull at line 27)
$ # CLI failure (fake adb exits 7); the extra "mark" hits are the substring inside "sampler_start"/"sampler_stop"
[D] order: mark sampler_start cli_start mark mark sampler_stop mark mark mark
$ # interrupt, foreground shell, SIGINT 0.5 s into the arm
$ bash h3b.sh; echo "exit=$?"
exit=130
$ grep -o 'sampler_pkill\|sampler_start\|cli_start\|sampler_stop' case-INT/trace.txt | tr '\n' ' '
sampler_pkill sampler_start cli_start sampler_stop
```

The host-side guard (`[ "$SAMPLER_ACTIVE" -eq 0 ]` in `energy_start`) plus the unconditional
`pkill -f '[e]nergy-sample.sh'` before every start prevents a second sampler while one is alive, and a stray
from an earlier aborted *run* is killed before the new CSV is created. The `[e]` trick is preserved from the
sibling (the pattern matches the invoking adb shell's own cmdline; the sibling's comment records the stale
stopfile that results when that trick is lost).

The hole is the failure return inside `energy_start` (lines 264–267): if the device starts the sampler but the
`adb shell` returns non-zero (transport hiccup, killed channel), `SAMPLER_ACTIVE` stays 0, so the EXIT trap's
`sweep_cleanup` skips `energy_stop`, and the run aborts — so the next `energy_start`'s `pkill` never comes:

```
$ bash h2.sh | grep '^\[C\]'
[C] 02:58:06 ABORT: could not start sampler for LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2
[C] run_one_arm rc=1
[C] SAMPLER_ACTIVE=0 CURRENT_TAG=
[C] sweep_cleanup rc=0
[C] sampler starts: 1
[C] sampler stops:  0
[C] cli invocations: 0
```

That is the historical defect class the sibling's F1 comment names ("a leaked sampler … stealthily steals CPU
from the SoC being measured"): the leaked process survives until its 7200-iteration cap (≈2 h) or the next
harness start, with no stopfile and no pidfile kill in this session. Probability is low (the device must
succeed where adb fails), severity is exactly the failure the file's own header claims to have inherited from
the audited path.

Two smaller lifecycle notes, both low severity: `energy_start`'s device-side `rm -f` list omits
`$BENCH_DIR/$tag.csv.pid`, so a pidfile from a previous session can be the target of a `kill` if the pid is
reused (the sampler overwrites the file within ~1 s, and the pid can only name a process of the same `shell`
uid); and on interrupt the sampler is stopped but the device-side `llama-cli` is not, so a killed adb channel
can leave a decode running on the device until `timeout 600` fires.

## F7 — Any abort produces no report at all, and the harness cannot be re-run into the same directory

`generate_report` is reached only after every model and every block has completed:

```
$ sed -n '679,686p' scripts/device-energy-sweep.sh
  run_idle_floor || return 1

  for model in $MODELS; do
    for block in $BLOCKS; do
      run_block "$model" "$block" || return 1
    done
  done
  generate_report || return 1
```

With the default schedule (2.6B: 4+4+1 arms × 3 reps) a failure on the last arm — including the two `ABORT`
paths that are *designed* to fire (charging mid-campaign; gate timeout) — publishes nothing but raw CSVs,
`.stamps`, `.marks` and `results.txt`. At the committed 2.6B/REP cadence (rep windows 87.5/88.5/89.6 s,
`device-v3-out/run1/LFM2.5-2.6B-Q4_K_M_none_REP.phases.csv`) that is ≈45–55 min if the A55 arms run at A76
speed, and roughly double if the archived 2.89× A55/A76 ratio holds, plus a temperature gate per arm. The
analysis in §5 of this report had to be run by hand to exist at all. And since the harness refuses a non-empty
`OUT`
(`ABORT: output directory is not empty: %s`, lines 68–73), the operator's only recovery is to rename/copy the
directory before re-running, which is the moment a partial dataset becomes an unmarked stray.

## F8 — The report's provenance sentence is false: no sweep stem can match the counts manifest, so the one guard rail it names is dead code

```
$ sed -n '647p' scripts/device-energy-sweep.sh
console.log("- The phase splitter used the committed counts manifest and its v3 rows; see `split.stdout` and `split.stderr` for the exact rerun output.");
$ head -2 scripts/fixtures/energy-counts/manifest.csv | cut -d, -f1-3
stem,prompt_tokens,gen_tokens
LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE,51,30
$ grep -n "manifestByStem.get(stem)" scripts/energyPhaseSplit.mjs
525:    const manifestEntry = manifestByStem.get(stem);
```

The manifest is keyed `${model}_${arm}_${prompt}`; the sweep's stems are
`${model}_${block}_p${position}_${arm}` (`LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2`), so every lookup misses.
The metric does not go empty — the phase stamps carry the counts, which is the only reason this is not fatal
(`genTokens = stamp?.predictedN ?? …` in `energyPhaseSplit.mjs`) — but the manifest's *entire* functional
effect in the splitter is the per-row `manifest campaign_gen_tps_rN … wrong manifest/campaign pairing?`
warning, and that check is now unreachable. Evidence, same real bytes, two stem schemes:

```
$ grep -c "manifest campaign_gen_tps" device-v3-out/run1/*.phases.csv
device-v3-out/run1/LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE.phases.csv:3
device-v3-out/run1/LFM2.5-1.2B-Instruct-Q4_K_M_none_REP.phases.csv:3
device-v3-out/run1/LFM2.5-2.6B-Q4_K_M_none_PURE.phases.csv:3
device-v3-out/run1/LFM2.5-2.6B-Q4_K_M_none_REP.phases.csv:3
$ grep -c "manifest campaign_gen_tps" probe/out/SWEEP-REPORT.md
0
```

(The probe's §4 `warnings` column is `—` on all twelve rows for this reason.) The v3 campaign's sidecars carry
that warning on 35 of 36 rows; under the sweep's naming the check cannot fire, so a mis-paired or stale
manifest would go unnoticed while the report asserts it was used. This is the same class of published-sentence
defect the v3 audit corrected thirteen times.

## F9 — `TEMP_GATE_DECI=0` looks like "gate off" and behaves like "wait for 0.0 °C"; an unreadable temperature also consumes the full timeout

The sibling design note defines its gate as `COOL_DC` with **0 = disabled**
(`scripts/device-moe-stream-abba.sh`: "`COOL_DC` gates each run on battery temperature (deci-degrees C, e.g.
300 = 30.0C); 0 disables it"). The sweep uses the same unit and a different meaning:

```
$ sed -n '658,659p' scripts/device-energy-sweep.sh
  is_uint "$TEMP_GATE_DECI" && is_pos_uint "$TEMP_GATE_TIMEOUT_S" && …
$ sed -n '163,166p' scripts/device-energy-sweep.sh
    case "$t" in
      ''|*[!0-9]*) ;;
      *)
        if [ "$t" -le "$TEMP_GATE_DECI" ]; then
```

The `''|*[!0-9]*) ;;` arm is why an unreadable temperature can never satisfy the gate: it falls straight
through to the timeout check.

`is_uint 0` passes, and `0` is a valid threshold, so an operator setting `TEMP_GATE_DECI=0` to avoid the gate
gets up to `TEMP_GATE_TIMEOUT_S` (default 1200 s = 20 min) of screen-off waiting per arm and then
`ABORT: temperature gate timed out`. The same happens when the temperature field is unreadable — the gate can
never satisfy `-le`. Both fail safe (no arm runs) and loudly, but the failure costs a device session.

A related default risk I cannot test: `TEMP_GATE_DECI=300` is 30.0 °C. The committed v3 dataset shows the
battery at 27.0–35.0 °C in the cold run and 35–38 °C in the two following runs
(`ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md` §1), and the sibling's comment records the battery temperature
"pinned at 38.0C while tok/s swung 2x". Whether a 3–8 °C drop is reachable inside 1200 s per arm on this
device is a device question; if it is not, the outcome is a hard abort after ~20 min and no report (F7).

## F10 — An unstable *control* block retroactively marks the whole model's frontier `UNINTERPRETABLE`

```
$ sed -n '637p' scripts/device-energy-sweep.sh
  const unstable = [...(groupsByModel.get(group.model) ?? [])].some((g) => g.unstable);
```

The scope is the model, not the comparison. Adding a control block with a 15.4 % per-rep spread (the fake
speeds 3.6/3.9/4.2) to the probe produces:

```
$ sed -n '/## 1. Stability/,/^\*\*STOP/p' probe6/out/SWEEP-REPORT.md | tail -3
| LFM2.5-2.6B-Q4_K_M | control | 1 | none | none(p1) | r1=3.6/r2=3.9/r3=4.2 | 15.4% | **UNINTERPRETABLE** |
**STOP:** at least one block exceeded the 5% stability limit; do not apply its frontier numbers.
$ sed -n '/## 5. Frontier/,/## 6/p' probe6/out/SWEEP-REPORT.md | tail -4
| LFM2.5-2.6B-Q4_K_M | a55_t2 | 65.422 | 0.884 | 0.0% | 0.0% | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | a76_t2 | 65.422 | 0.884 | 0.0% | 0.0% | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | none    | 65.422 | 0.884 | 0.0% | 0.0% | UNINTERPRETABLE |
```

The direction is conservative (it refuses a conclusion rather than inventing one), but §5's own header says
"unstable **blocks** remain uninterpretable", and the practical effect is that a noisy last block discards the
already-good primary comparison — an operator would re-run the whole campaign. One word to fix.

## F11 — The `--version` smoke gate cannot fire on a broken binary (local half verified, remote half reasoned)

```
$ sed -n '217,220p' scripts/device-energy-sweep.sh
  if ! adb shell "cd $BENCH_DIR && LD_LIBRARY_PATH=. ./llama-cli --version 2>&1 | head -2" </dev/null 2>&1 | tr -d '\r' | tee -a "$RESULT"; then
    blog "ABORT: llama-cli does not run on the device"
    return 1
  fi
```

The local side is protected by `pipefail` — a non-zero first element does abort:

```
$ bash -c 'set -uo pipefail; if ! bash -c "echo CANNOT_LINK_EXECUTABLE >&2; exit 127" 2>&1 | tr -d "\r" | tee -a /dev/null; then echo "SMOKE GATE WOULD ABORT"; else echo "gate passed"; fi'
CANNOT_LINK_EXECUTABLE
SMOKE GATE WOULD ABORT
```

but the first element here is `adb`, and adb's status is the *remote* shell's status for a remote command that
is itself a pipeline ending in `head -2`. Android's shell (mksh) does not enable `pipefail`, so the remote
pipeline reports `head`'s status — 0 — and a `CANNOT LINK EXECUTABLE` failure returns from adb as success. (The
local half above is executed; the remote half is reasoned from the remote shell, which I cannot exercise
without a device.) Cost if it happens: the run proceeds through `run_idle_floor` and the first gate, then dies
with `llama-cli failed with status 127` and, per F7, no report.

## F12 — No self-consistency checks: the one cheap cross-check that would expose a failed mask is never made

The design audit's F4 established that the unpinned baseline already lands on the two A76s, and the archived
affinity document measured a 2.89× ratio between A55-only and A76 decode (3.95 vs 11.43 tok/s,
`archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md:88`). The sweep measures both of these facts and never
compares them:

- `control` (unpinned, 2 threads) vs `a76_t2` (mask `c0`, 2 threads): if the mask is real and the baseline sits
  on the big cluster, these two arms should agree. The report prints both rows in §5 and never checks. The
  pairing also exists inside each block: `primary_t2` runs the unpinned `none` arm only in the separate
  `control` block.
- `a55_t2` vs `a76_t2` **throughput**: a failed mask collapses the expected ratio to ~1.0; a real mask gives a
  large ratio. §4 prints `gen t/s` for every row, so the check costs nothing, and no expectation is published
  for the reader to compare against.
- A-A repeatability: p2/p3 are the same arm, so the spread that the self-audit's Step 0 demanded is already in
  the data (F5).

The plumbing probe shows what the report does when the arms are literally identical: four `stable` blocks and a
`0.0 % / 0.0 %` frontier, with no note that the design was null. That is the historical failure mode
(`archived/docs/HARNESS_FINDINGS.md:3664-3673`, recopied verbatim: "because the two arms were byte-identical,
they measured something else: run-to-run reproducibility. And it is terrible … The second arm never exceeded
4.12 tok/s on any turn") — this instrument cannot tell that case apart from a real null result.

## F13 — Small items, each with its evidence

- `energy_start` does not clear `$BENCH_DIR/$tag.csv.pid` (line 263's `rm` list), so a stale pidfile can be the
  target of the `kill` at line 278 if the pid has been reused on the device. The sampler overwrites the file at
  startup, so the window is ~1 s and only same-uid processes are reachable.
- `run_one_arm`'s rep prompt is one item shorter than the pinned sibling's REP prompt (`- item 6: checked` and
  `items 7 through 40` versus `items 6 through 40`), so the sweep's absolute J/token is not comparable to the
  committed campaign's numbers. The report already says absolute J/token is session-relative and the frontier
  is arm-vs-arm, so the consequence is documentation only — but the divergence should be deliberate and stated.
- `source "$_SWEEP_DIR/device-share-send.sh"` is unchecked; a moved sibling leaves `device_pick_serial` /
  `device_keepawake_begin` undefined with only a shell error. I hit exactly this while building the harness
  (`/tmp/kalsa-audit-sweep/sweep-prefix.sh: line 66: /tmp/kalsa-audit-sweep/device-share-send.sh: No such file
  or directory`, and execution continued).
- The `pkill` exit status in `energy_start` is deliberately ignored (no match returns 1 and is the normal
  case), so a `pkill` that *failed* is indistinguishable from a no-op; the pidfile kill in `energy_stop` is the
  backstop.

---

## Disposition against the ten required checks

| # | item | verdict | evidence |
|---|---|---|---|
| 1 | mask effectiveness | **FAIL** | F2: mask applied to the CLI itself (trace) and un-escapable (no affinity symbol in the built Android libs), but no `Cpus_allowed` probe, per-CPU clocks recorded and never read, the only preflight check cannot fail, the unset arm is never checked as `0-7`; all 8 output fields carry only the requested mask |
| 2 | temperature gate | **PASS with two defects** | Runs before every arm including the first and the control (trace), screen off while waiting (line 178), 1200 s timeout aborts **without running the arm** (case B: `cli invocations: 0`); unit is deci-°C, matching `dumpsys battery` and `COOL_DC`. Defects: F3 (state not restored/recorded, floor mismatch), F9 (`0` ≠ off; unreadable temp burns the full timeout) |
| 3 | ABBA | **PARTIAL** | Schedule is genuinely A B B A (line 369) and the reported order is derived from `order.tsv` written before each arm, not from the hardcoded `block-meta` string (verified in the report output). The analysis does **not** pair by position and never estimates the order confound: F5, 10 % step → −4.8 % headline, every gate silent |
| 4 | sampler lifecycle | **PARTIAL** | Success, CLI-failure, arm-failure, abort and SIGINT all stop the sampler (traces and `exit=130`); stopfile+pidfile discipline matches `energy-sample.sh`; host guard + device `pkill` prevent a second sampler. Hole: a start whose adb call fails after the device started it (case C: `sampler starts: 1 / sampler stops: 0`). Notes: stale pidfile, device-side `llama-cli` not stopped on interrupt |
| 5 | charge gate | **PASS** | `check_mid_campaign_charge` is called unconditionally after every arm, and the harness proves the control arm is not exempt: `[E2] … arm=none … 1 cli ran; ABORT: device plugged in mid-campaign.` → `run_block rc=1`, same as the treatment arm (`[E3]`). 30 % floor and unreadable-level aborts are in `preflight`, in the gate and mid-campaign |
| 6 | idle floor | **FAIL** | Same sampler (yes: same script, same pull path, `tag=idle_floor`), same screen/awake state (**no**): the floor is explicitly woken (line 427, "screen awake"), the arms inherit whatever the gate left (line 178 sleeps the display, nothing wakes it), and neither state is recorded (`start_state`/`end_state` hold the battery blob). Documented step size 0.87 W ≈ 25 % of decode power |
| 7 | stamps and marks | **PASS with one gap** | `KALSA_PHASE_STAMPS` set per rep (line 338, per-stem per-rep path); the mark is the first host action after the CLI and the stamp pull follows it (trace: `cli_start → mark → pull`); missing/empty stamps are reported by name into `results.txt`. Gap: the report does not carry that fact (F4a) |
| 8 | analysis | **PARTIAL** | Imports the audited integrator (no second copy — the heredoc re-implements only a CSV reader, a coverage ratio and a p5 quantile); coverage per row and warnings per row are published; the stability check does gate the conclusion. Fails on: missing reps/metrics reported as `stable` (F4a/b), warnings not gating (F4c), the false manifest sentence and its dead guard rail (F8), scope-to-model over-blocking (F10), no order/position estimate (F5). The slowdown reference is the pinned `a76_t2` arm for the same model, which is the correct control per the design audit's F4 |
| 9 | scope | **PASS** | `git show --stat da3192e` → one file, 691 insertions; `git status --porcelain` empty; `bash -n` OK on both; `energySchemaHarness.mjs` → `OVERALL: PASS (77 passed, 0 failed)`, `energyPhaseSplitHarness.mjs` → `OVERALL: PASS (94 passed, 0 failed)`; no write outside `$OUT`, `$DATA_DIR` and the remote `$BENCH_DIR` (all redirections enumerated); the pin and both build directories are untouched (they are only read/pushed from) |
| 10 | everything else | **FAIL on the blocker** | F1 (cannot execute), F7 (abort ⇒ no report, no reuse of `OUT`), F11 (smoke gate blind), F12 (no self-consistency checks). Time-cost envelope measured from the schedule: default 2.6B/REP decode ≈65 s at `a76_t2` already in the committed data, ~3 reps × 9 arms + a gate per arm; a gate timeout costs up to 1200 s and ends the run |

## What I could not test without a device, said plainly

- **Whether toybox `taskset` applies the mask on this device at run time.** The instrument only checks that it
  *parses* the mask; the mapping `3f→0-5`, `c0→6-7`, unset→`0-7` is an on-device reading from
  `ENERGY-2B-SELF-AUDIT-2026-09-15.md` F11, not something this script re-establishes. Item 1's central
  question — what evidence the output carries — I *could* answer, and the answer is in F2.
- **Whether 30.0 °C is reachable per arm inside 1200 s on the Jelly**, and therefore whether the default gate
  is usable at all. The committed dataset brackets the question (27–38 °C across runs; 35–38 °C under load) but
  no device session was available to measure cooling.
- **What the arms' screen state actually is.** I verified the code path (gate sleeps the display, nothing wakes
  it) and that `screen_off_timeout` is set to 24 h by the shared keep-awake, but whether `KEYCODE_SLEEP` blanks
  the panel under that setting, and what the resulting power step is on this panel, needs the device.
- **The idle floor's absolute level and the direction of the floor-vs-arm step on the Jelly.** I used the
  committed cross-session step (0.035 W → 0.92 W) as the magnitude evidence, labelled as inference.
- **The remote half of F11** (Android mksh without `pipefail` masking a failing binary through `| head -2`).
- **Every energy number.** No pinned-arm data exists anywhere; the probe's numbers are copied campaign bytes
  and mean nothing.
- **Items 1, 2 (device-side behaviour), 3 (order effects), 6 (screen state) and 10 (device-time costs) can only
  be closed on hardware.** Items 4, 5, 7, 8, 9 were closed on the host, as quoted.

## Flip list — minimal ordered fixes

1. **Blocker.** `scripts/device-energy-sweep.sh:261` — split the declaration:
   `local tag="$1" max_iter="$2"` / `local stop="$BENCH_DIR/stop.energy.$tag"`.
2. **Mask proof (F2).** After the gate at line 393, before `start="$(battery_line)"`, add one line that records
   the *effective* mask of a `taskset`-wrapped child and aborts on mismatch:
   `eff="$(adb shell "taskset ${mask:-0-7} sh -c 'grep -m1 Cpus_allowed_list /proc/self/status'" | tr -d '\r')"; case "$mask:$eff" in 3f:*0-5*|c0:*6-7*|:*0-7*) ;; *) blog "ABORT: mask $mask not effective ($eff)"; return 1 ;; esac`
   (the on-device expected strings are the design audit's F11 readings), and append `$eff` to
   `BLOCK_META_TSV`.
3. **Floor vs arms (F3).** Make the state identical and recorded: wake the display after the gate
   (`adb shell input keyevent KEYCODE_WAKEUP`, one line after fix 2) *or* take the floor with the display off
   (replace line 427's `KEYCODE_WAKEUP` with `KEYCODE_SLEEP`) — and add
   `adb shell dumpsys power | grep -m1 mWakefulness` to the per-arm metadata.
4. **Stability gate must fail closed (F4).** In the heredoc add
   `group.usable = group.entries.filter((e) => finite(e.row.j_per_tok_decode) !== null).length;` and extend
   line 546 with `group.unstable = group.unstable || group.usable < Number(process.argv[6]) || group.entries.some((e) => /low-resolution|cadence max/.test(e.row.warnings || ""));`
   passing `"$REPS"` as the sixth argument on line 441.
5. **Order confound (F5).** In §5, before the frontier, print the two same-arm position pairs per ABBA block
   (`p1` vs `p4` for `a55_t2`, `p2` vs `p3` for `a76_t2`) with their relative difference, and mark the model
   `UNINTERPRETABLE` when any pair exceeds `STABILITY_MAX_PCT`.
6. **Start-failure leak (F6).** Move `CURRENT_TAG="$tag"; SAMPLER_ACTIVE=1` above the `setsid` call in
   `energy_start`, so the EXIT trap's `energy_stop` covers a start whose adb call failed after the device
   started the sampler.
7. **Partial report (F7).** In `sweep_cleanup`, before the restore calls, add
   `[ -s "$ORDER_TSV" ] && generate_report >/dev/null 2>&1 || true` so an aborted session still publishes the
   rows it has.
8. **Provenance sentence (F8).** Line 647 — replace with the truth: counts come from the phase stamps; the
   manifest is not consulted for these stems — or add the sweep stems to
   `scripts/fixtures/energy-counts/manifest.csv`.
9. **`TEMP_GATE_DECI=0` (F9).** In `main`'s numeric check, require `is_pos_uint "$TEMP_GATE_DECI"`, and state in
   the header that the gate cannot be disabled.
10. **Scope of `UNINTERPRETABLE` (F10).** Line 637 — filter to the entry's own block:
    `.filter((g) => g.block === group.block)`.
11. **Smoke gate (F11).** Line 217 — drop `| head -2` (or grep the version banner) so a broken binary fails at
    `push_bin` rather than at the first arm.
12. **Self-consistency block (F12).** Add three computed lines to §5: `none` vs `a76_t2` agreement,
    `a55_t2/a76_t2` throughput ratio, and the p2-vs-p3 A-A spread (fix 5 covers the arithmetic).

Reproduction: `/tmp/kalsa-audit-sweep/` — `report-inline.mjs` (md5 `e8f236b8d7f5e019ff258fc5d74ebe4a`), the
extracted prefix (`sweep-prefix.sh`, md5 `4571c3ad1d2976e9cbbab5cec0f7a2e5`, and `sweep-prefix-patched.sh`),
`bin/adb` (the fake device), `h1.sh`, `h2.sh`, `h3.sh`, `h3b.sh` (harnesses), `probe/`, `probe3/`, `probe4/`,
`probe5/`, `probe6/` (plumbing probes with their `out/SWEEP-REPORT.md`), `case-*/trace.txt` (per-case device
call traces).

**NO-SHIP.** Items 1, 6 and 10 fail outright; items 3, 4 and 8 are partial with named holes; item 2 is sound
except for the state it leaves the device in. The blocker is one line, but the J-per-token figure this run
exists to produce is not yet trustworthy at the few-percent level the pilot needs, and the run cannot certify
that its central manipulation took effect.
