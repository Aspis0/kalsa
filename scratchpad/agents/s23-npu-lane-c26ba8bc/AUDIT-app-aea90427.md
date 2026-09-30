# Hostile audit — app commits f012dd1f + aea90427 (base c26ba8bc)

Scope: `git diff c26ba8bc HEAD` in `~/Projects/kalsa` (package.json, package-lock.json,
src/engine/LlamaService.ts, src/engine/governorInputs.ts, 2 test files).
No edits, no builds, no commits. Read-only verification incl. two out-of-tree
`npm pack` recomputations of the git-dep integrity.

**VERDICT: SHIP.** No functional defect, no parser break, no security/privacy
regression. The pin bump is provably correct (independently recomputed). What is
wrong is the *justification* written into the commit message and two test
comments: two of the three stated reasons are false. 4 findings to fix when this
file is next touched; none blocks the S23 run.

---

## 1. Lockfile (f012dd1f)

### 1.1 Only the llama.rn entry changed — CONFIRMED
```
$ git show f012dd1f --stat
 package-lock.json | 6 +++---
 package.json      | 2 +-
```
3 lines in the lock: the root `dependencies` mirror, `resolved`, `integrity`.
The `node_modules/llama.rn` entry keeps 7 keys (`version, resolved, integrity,
license, bin, engines, peerDependencies`) — byte-identical shape to the
b4a13d9a bump `73ecc97c`, which likewise touched only `resolved`+`integrity`.
No new transitive entry, and none is missing: the fork's `package.json` at
c8471449 and at b4a13d9a is identical in every field the lock records
(`version 0.13.0-rc.4`, `dependencies {}`, `peerDependencies {react:*,react-native:*}`,
`bin {llama-rn-download-artifacts: ./install/download-native-artifacts.js}`,
`engines.node >= 16.0.0`, `license MIT`). `bin` normalisation (`./` stripped)
matches the previous entry. **REFUTED** that the lock is stale.

### 1.2 The integrity is what npm computes for c8471449 — CONFIRMED (recomputed)
Fresh `git clone` of `Aspis0/kalsa.rn` branch `feat/governor-platform-status`
(HEAD = `c8471449`), `npm pack --json --ignore-scripts` (npm 11.16.0, node 26.3.0):
```
computed: sha512-5UD93Ovgk3satYbKdLa3G0KgzezViKiON5dG7ynloBIv+LcOGb71rqMOdqC9oV3D/c5XfGliWSYzpPqhgoCClQ==
lockfile: sha512-5UD93Ovgk3satYbKdLa3G0KgzezViKiON5dG7ynloBIv+LcOGb71rqMOdqC9oV3D/c5XfGliWSYzpPqhgoCClQ==
MATCH          entryCount 1121
```
Control, same procedure on the parent b4a13d9a:
```
computed b4a13d9a: sha512-20wGTeOMcKgiIG31zE5m1HIORbri7Gmxi8+cZd0r31sm+kUTT4x/pFamaxHDaSm/dTNl3ywXNIMlIKi1iZuTsw==
```
which is exactly the value `73ecc97c` wrote. So integrity is a faithful content
witness here, and the bump's integrity is correct. `entryCount 1121` also
independently confirms the commit message's "1121 files match".
`node_modules/.package-lock.json` already carries the same c8471449 resolved +
integrity → the working tree is not stale against the lock.

### 1.3 The provenance gate's own header is factually wrong — CONFIRMED (pre-existing, not in the diff)
`scripts/assert-engine-provenance.sh:4-5`:
```
# The lockfile's integrity hash is NOT a witness for this git dependency: it
# did not change across commits with different content.
```
§1.2 disproves this: the hash changes with content on this exact dependency. The
gate's *behaviour* is unaffected (it compares files against a codeload tarball,
which is the right check) but the stated reason for distrusting the hash is
false, and it is probably why nobody recomputed the integrity on this bump.
Cross-check that does hold: fork `vendor/VERSIONS` at c8471449 is
`n=b3249189c6132e0c9d669ec7164de6cc`, i.e. `d07d0181b3249189c6132e0c9d669ec7164de6cc`
= `native/kalsallama.pin` line 1, as claimed.

### 1.4 The commit message credits the wrong commit with the fix — CONFIRMED
`f012dd1f` message: *"The binding now keeps the governor prefill KV off HTP0"*.
`c8471449`'s own message is *"audit B1/B2"*: a stricter scoping pin in
`src/__tests__/governorLaneKvPlacement.test.ts` and a comment fix in
`cpp/rn-llama.cpp`. Real diffstat vs parent: 2 files, 39 insertions — no
behaviour. The behaviour commit is the **parent** `17446ac4` *"fix(governor):
prefill KV stays off HTP (kalsa.rn, feat/governor-platform-status, base
b4a13d9a)"*. The pinned tree does carry the fix (verified in the clone):
`cpp/rn-llama.cpp:119 if (device_plan.use_device) {` … `129 prefill_params.no_kv_offload = true;`.
So the pin is right; the *attribution* is off by one commit, and the message
implies c8471449 is the fix rather than the fix's audit.

---

## 2. npu_lane: is the logged value the one that drove `npu_lane_enabled`? — CONFIRMED

One read, one const, both consumers, no re-read, no window:
```
2284  const benchNpuLane = governorFeatureEnabled ? await readBenchNpuLane() : undefined;
2362            lanePref: benchNpuLane,          // → buildGovernorParams → laneEnabled → npu_lane_enabled
2418            benchNpuLane,                    // → buildGovernorPlanLog → npu_lane
```
`readBenchNpuLane` has exactly one production caller (`rg` over src: LlamaService:2284
only), so nothing can diverge between 2362 and 2418. The skip-reload key
`governorKey = governorLoad ? JSON.stringify(governorBase) : "off"` (:2380) is
computed from the same `governorBase`, and the idempotent return at :2382-2401
happens *before* the emission, so **every** emitted plan line describes a load
that actually followed. **REFUTED** (no race, no staleness). The AUDIT-17446ac4
F4 concern does not apply.

### 2.1 `"off"` default true on every path — CONFIRMED
- invalid/absent storage: `readBenchNpuLane` whitelists `raw === "off" || "on" || "auto"` else `undefined` → gate `:267-270`
  `npu?.lanePref === "auto" ? autoOk : npu?.lanePref === "on" ? … : false` → false. Log says `"off"`. **TRUE.**
- governor feature disabled: `benchNpuLane` is `undefined`, but `governorBase` is
  `governorFeatureEnabled && pricedModel != null ? … : null` (:2347) and the
  emission is gated `if (governorBase != null && …)` (:2403) → **no plan line at
  all**, so a wrong `"off"` can never be logged. **TRUE, and the safe way round.**
- `"auto"`: logged verbatim; the resolved lane may still be `false` (arch/kind/fit
  gate). See 2.2.
- Nothing but the 3-value whitelist can reach the field, so the value can never
  be an arbitrary string (no log injection via AsyncStorage). **TRUE.**

### 2.2 The key logs the REQUEST, not the state that drove the native flag — PLAUSIBLE (the real finding)
`npu_lane: "on"` does not mean the lane was enabled. The plan is emitted whenever
`governorBase != null`, including loads where `governorLoad` came back `null`
and **no governor params reached the native binding at all**:
```
2366  const governorLoad =
2367    governorBase != null && governorBase.enabled && governorThermo != null &&
2370    governorThermo.sensor_valid && governorBase.gpu_fit !== "NoFit" &&
2372    !options.mmprojPath && !streamExperts ? {…} : null;
```
So `gpu_fit:"NoFit"`, an invalid thermo sensor, a vision load, or a streaming
MoE load all emit a plan with `npu_lane:"on"` and a lane that was never
attempted. The `governorInputs.ts` comment is honest about this ("the pref
ASKED for, not the resolved lane") and the sibling key already carries the
resolved intent (`npu_device: laneEnabled ? "HTP0" : null`,
governorInputs.ts:297 → plan :207). A reader who takes `npu_lane` as the state
gets exactly the false attribution the commit claims to prevent. Severity:
observability only, and only for a reader who ignores `npu_device`.

### 2.3 The stated reason for the key is false — CONFIRMED
`aea90427`: *"The plan line could not be attributed to lane on vs off after a
crash."* It could: `npu_device` was already on the line and is `HTP0` **iff**
`laneEnabled`. The lab's own captured lane-on crash line proves it
(`scratchpad/agents/s23-npu-lane-c26ba8bc/REPORT.md:43`):
```
KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit",…,"npu_device":"HTP0","npu_fallback":null}
```
`npu_lane` adds exactly one thing `npu_device` does not: distinguishing
"operator asked `auto`, the gate refused" from "operator asked `off`". That is
useful — but it is not the stated reason. The false claim is repeated inside
the diff at `governorPlanEmission.test.ts:28-29`.

### 2.4 Naming: `npu_lane` where the audit asked for `npu_lane_enabled`/`lanePref` — PLAUSIBLE
`AUDIT-17446ac4.md:438` offered `npu_lane_enabled` (or `lanePref`). The app took
the second option but named it `npu_lane`, which sits beside `npu_device` /
`npu_fallback` and reads as a resolved state — while its value domain includes
`"auto"`, which is not a state. A future instrument grepping for
`npu_lane_enabled` finds nothing and may conclude the field is missing.

---

## 3. Parsers of KALSA_GOVERNOR_PLAN — REFUTED (nothing breaks)

All consumers JSON-parse the whole payload and read named fields; none is
positional, count-sensitive, or strict:
- `scripts/campaign/telemetryParse.mjs:34` `const obj = JSON.parse(payload);`
  then `applySchema` (`{...obj}` spread) → extra key rides along.
- `scripts/campaign/config.mjs:21` `{ prefix: "KALSA_GOVERNOR_PLAN" }` — prefix only.
- `scripts/campaign/governor.sh:44-50` `payload = json.loads(line[brace:end+1])`,
  `isinstance(payload, dict)` → extra key rides along.
- `scripts/campaign/turn.sh:265-287` — KALSA_TOOLCALL only, same pattern.
- No `additionalProperties:false` / fixed-column CSV writer consumes plan rows
  anywhere in kalsa or kalsa-moe-experiments (`rg` over both repos).
- No golden fixture breaks: the only `buildGovernorPlanLog` caller is
  LlamaService:2406; the selftests feed their own hardcoded old-shaped lines
  (`selftest.mjs:981`, `selftest_fakedevice.sh:378`, `selftest_defects.sh:1356`),
  which the parsers still accept.

---

## 4. Tests

### 4.1 Dropping the key is caught — CONFIRMED
`governorPlanLog.test.ts:47-57` uses `toEqual` with `npu_lane: "off"`, so dropping
the field fails. `Object.keys(plan)` at :60-70 also fails.
The emission test's slice is tight — `guardStart = lastIndexOf("if (", marker)`
(:16) → 2403, `fallbackStart` (:18) → 2420 — so the region is the console.log
alone; dropping `benchNpuLane,` at 2418 fails `toContain`.

### 4.2 The key-order test pins a phantom invariant and its comment is false — CONFIRMED
```
58  // Instruments parse this line: the pre-npu_lane keys keep their order
59  // and npu_lane is appended.
60  expect(Object.keys(plan)).toEqual([ … ]);
```
No instrument depends on order (§3: all `JSON.parse` + named access), so the
comment states a consumer requirement that does not exist. The test is harmless
today and will fail on any future key insertion — cost without benefit.

### 4.3 "Wrong variable passed" is only half-caught — PLAUSIBLE
`expect(emission).toContain("benchNpuLane,")` (:30) is a substring test. It fails
if the argument is dropped or if some other identifier is passed, but it passes
happily if `benchNpuLane` is passed in the **wrong position** (e.g. as
`benchNoRepack`'s 4th argument), which would put a boolean into `npuLanePref`
and log `npu_lane: true`. No unit test covers the call site — the
`governorPlanLog` tests call the function directly, so they cannot see it.
`tsc` catches that particular swap, so the residual risk is low; the guard is
just weaker than it reads.

### 4.4 The invariant the comments claim is asserted nowhere — CONFIRMED
The new comment says the logged value is the one that "drove `npu_lane_enabled`".
No test ties `npuLanePref` to the resolved flag: `laneOf` (:132-133) is a pure
passthrough over a `governor` built once at :131, and
```
138  // readBenchNpuLane maps absent/invalid storage to undefined, and the
139  // plan reports the value the gate resolves that to — not "auto".
140  expect(laneOf(undefined)).toBe("off");
```
is self-fulfilling: it pins `?? "off"`, and would still pass if the gate's
default changed to `"auto"`. The gate side is covered separately
(`governorInputs.test.ts:444-492`, `:501-510`), but the *agreement* between the
two — the thing the comment asserts — has no test. The emission test cannot
cover it either: the `lanePref: benchNpuLane` use is at :2362, far outside the
sliced region. A comment in the repo's own idiom would be the honest
place for it; a test would need the value threaded through one function.

---

## 5. Security / privacy — REFUTED (no regression)

`npu_lane` can only be `"off" | "on" | "auto"` or the literal `"off"`: the value
is either a `BenchNpuLanePref` from `readBenchNpuLane`'s three-way whitelist or
`?? "off"`. Nothing user-derived, no free text, no identifier, no path, no
prompt. The line already carried `available_mib` / `required_mib_*` (device
memory and model size); `npu_lane` adds no new class of information. No
`try/catch` was added to this `console.log` (the `KALSA_CTX_FLOOR` log above
does have one) — pre-existing, telemetry-throw is a non-issue for a 9-key
JSON.stringify of primitives.

---

## Dead code / cruft (last, as asked)

- `npu_fallback` on the plan is a hardcoded `null`: `buildGovernorParams` returns
  `npu_fallback: null` (governorInputs.ts:298) and the plan prints
  `governor.npu_fallback ?? null` (:208). The real fallback only ever arrives
  from native on `KALSA_GOVERNOR` (LlamaService:1787). Pre-existing; a constant
  column in every plan row.
- `buildGovernorPlanLog`'s `governor` parameter type omits `npu_lane_enabled`
  and `npu_fit` (governorInputs.ts:184-188) although `governorBase` carries both
  — i.e. the type is the reason the resolved flag could not be logged without a
  cast. Relevant to 2.2/2.4: the stronger field was available and unused.
- `benchNoRepack: boolean | undefined` (required, union-typed with `undefined`)
  next to `npuLanePref?: BenchNpuLanePref` (optional) — inconsistent arity
  convention in one signature. Cosmetic.
- `/tmp/kalsarn-audit/` (two clones + one worktree) is mine; delete it.

---

## Fix list (none blocking)

1. `governorPlanEmission.test.ts:28-29` — the "so a crash is attributable to lane
   on vs off" claim is false; `npu_device` already does that. Restate as
   "distinguishes an `auto` request the gate refused from an explicit `off`".
2. `governorPlanLog.test.ts:58-59` — drop the order assertion or fix the comment:
   no instrument depends on key order.
3. `scripts/assert-engine-provenance.sh:4-5` — the integrity-is-not-a-witness
   claim is false; verified by recomputation for both shas.
4. Naming/field choice: `npu_lane` (request) beside `npu_device` (resolved) will
   be misread. If the campaign wants crash attribution, `npu_lane_enabled` was
   already in `governorBase` and needed no new plumbing.
Report the f012dd1f attribution as "pin includes 17446ac4 (the KV fix); c8471449
is its B1/B2 audit follow-up".
