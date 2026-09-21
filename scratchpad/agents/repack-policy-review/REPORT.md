# Adversarial review: per-model repack policy

Target: /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy, branch
qwen-repack-policy, 964dd536f13b (parent 54297994aa1f). Review performed
read-only. The evidence report is
/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-check/bench-out/repack-s23/REPORT.md.

## Verdict summary

1. CONFIRMED — only qwen3.5-4b has a registry override; the default and other
   catalog entries are unchanged.
2. CONFIRMED — the qwen policy reaches both the fit estimator and native load
   flags on the normal, non-streamed path. There is no integration test for
   this complete path, and a generic benchUseMmap plumbing gap remains, but
   neither changes qwen's mmap:true repack result.
3. REFUTED — the measure and cost are directionally honest, but the new comment
   conflicts with the resolver's documented precedence and presents a 4B
   repack estimate with more precision than the calibration supports.
4. CONFIRMED — the pure resolver/registry tests kill the key policy mutations
   mentally; they could not be executed because dependencies are absent, and
   they do not protect LlamaService integration.
5. CONFIRMED — source-level diff shows no change to other models, expert
   streaming, or the non-streamed norepack=0 arm.
6. CONFIRMED — the S23 evidence supports a functional fit-gate diagnosis, not
   a performance claim. The report itself keeps that boundary and states the
   charger limitation correctly.
7. UNVERIFIABLE — no device timing, fault, thermal, or battery comparison
   exists for the shipping default. The policy is functionally motivated but
   not performance-qualified for release.

## 1. Registry scope and default

Verdict: CONFIRMED. The commit changes exactly two files, and the only
loadPolicy: occurrence in the production registry is the qwen entry. The
registry currently has only the qwen and LFM listed entries; the opt-in dev
catalog has no policy override. DEFAULT_LOAD_POLICY remains mmap-on/repack-on.

Command:

~~~
cd /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy
echo HEAD=$(git rev-parse --short=12 HEAD)
echo PARENT=$(git rev-parse --short=12 HEAD^)
git diff --name-status HEAD^ HEAD
git diff --check HEAD^ HEAD
rg -n 'loadPolicy:' src/engine/ModelRegistry.ts
rg -n '^    id:' src/engine/ModelRegistry.ts
rg -n 'loadPolicy:' src/engine/devModelCatalog.ts || true
nl -ba src/engine/loadPolicy.ts | sed -n '32,34p'
~~~

Output:

~~~
HEAD=964dd536f13b
PARENT=54297994aa1f
M       src/engine/ModelRegistry.ts
M       src/engine/loadPolicy.test.ts
225:    loadPolicy: { mmap: true, repack: false },
196:    id: "qwen3.5-4b",
258:    id: "lfm2.5-2.6b",
    33 export const DEFAULT_LOAD_POLICY: LoadPolicy = { mmap: true, repack: true };
~~~

The complete commit diff shows that the qwen entry is the only registry data
change:

~~~
git diff --unified=0 HEAD^ HEAD -- src/engine/ModelRegistry.ts
~~~

The added data is only at src/engine/ModelRegistry.ts:225.

## 2. Gate/engine agreement

Verdict: CONFIRMED for qwen's production path. The policy is carried from the
model through loadGate.ts:78-95, then passed into decidePreSendFit at
loadGate.ts:218-233. The fit decision resolves it at
deviceProfile.ts:448-460, and both requiredBytes and the final fit evaluation
use the resolved repack value.

The actual load resolves the same model policy at LlamaService.ts:2257-2273;
it passes the result into tuning and then sends no_extra_bufts at
LlamaService.ts:2373-2381. repack:false therefore becomes both estimator
repack:false and native no_extra_bufts:true. LlamaService.ts:2418-2423
preserves the native expert-streaming override after bench engine overrides.

Commands:

~~~
cd /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy
nl -ba src/engine/loadGate.ts | sed -n '78,96p;218,234p'
nl -ba src/engine/deviceProfile.ts | sed -n '445,471p'
nl -ba src/engine/LlamaService.ts | sed -n '2257,2274p;2373,2381p;2416,2423p'
~~~

Relevant output:

~~~
90:    loadPolicy: input.model.loadPolicy,
224:      loadPolicy: input.model.loadPolicy,
448:  const gateLoad = resolveGateLoadPolicy({
449:    policy: model.loadPolicy,
459:          repack: gateLoad.repack,
2257:    const load = resolveLoadPolicy({
2258:      policy: modelInfo?.loadPolicy,
2273:        repack: !load.noExtraBufts,
2379:      use_mmap: load.useMmap,
2381:      no_extra_bufts: load.noExtraBufts,
2423:      params.moe_stream?.enabled === true ? true : load.noExtraBufts;
~~~

The generic resolver proves that the repack term leaves the estimator when the
policy is off:

~~~
src/engine/loadPolicy.ts:61  const policy = input.policy ?? DEFAULT_LOAD_POLICY;
src/engine/loadPolicy.ts:71  noExtraBufts: input.streamExperts
src/engine/loadPolicy.ts:77    : !policy.repack,
src/engine/loadPolicy.ts:100 return { mmap: resolved.useMmap, repack: !resolved.noExtraBufts };
~~~

A scope caveat: resolveGateLoadPolicy supports benchUseMmap, but the
gateModelLoad/decidePreSendFit call only carries benchNoRepack. That can matter
to a future mmap:false model under an engine override. It does not alter this
commit's qwen entry, whose mmap policy is true, or either qwen repack arm.

## 3. Comment, quantitative explanation, and stated cost

Verdict: REFUTED as written. The arithmetic behind the new comment is
reproducible, and the comment correctly says decode speed and major faults are
unmeasured. However, two claims need correction:

* ModelRegistry.ts:164-165 says bench levers outrank expert streaming. The
  resolver says the opposite for effective flags: loadPolicy.ts:6-17 and
  :70-77 make streaming win, and loadPolicy.test.ts:74-86 asserts that.
  The actual native re-force at LlamaService.ts:2418-2423 also makes streaming
  win. The policy comment should say streaming > bench > entry > default, with
  bench precedence qualified as non-streamed only.
* ModelRegistry.ts:173-180 presents 2994 MiB as the qwen ARM repack copy. That
  is the estimator's 0.8951279 fraction, not a qwen-specific measurement.
  memoryEstimate.ts:52-55 explicitly warns that the fraction is
  under-calibrated for a 4B load and cites a 4B CPU_REPACK observation near
  1.00x file size. The comment should label the 2994/3451/457 figures as
  estimates, or add a qwen-specific measurement.

The arithmetic itself checks out for the high-RAM 16K path. The registry gives
2,834,975,040 B main weights plus 672,423,616 B mmproj at
ModelRegistry.ts:203-213, engineCtx:8192 at :216, and kvBytesPerToken:13312
at :234-249. High-RAM hybrids upgrade to 16K via contextProfile.ts:9-10 and
:193-200. The estimator formula is at memoryEstimate.ts:148-164.

Command and output:

~~~
cd /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy
node - <<'NODE'
const MIB=1024*1024;
const bytes=2834975040+672423616;
const f=(1333-249)/1211;
for (const ctx of [8192,16384]) {
  const repack=bytes/MIB*f;
  const kv=ctx*13312/MIB;
  console.log({ctx, bundleMiB:bytes/MIB, repackMiB:repack,
    kvMiB:kv, nonEvictableMiB:repack+249+kv});
}
console.log({repackOffAt16k:249+16384*13312/MIB});
console.log({memAvailMiB:3727652/1024});
NODE
~~~

~~~
{ ctx: 8192, bundleMiB: 3344.916015625, repackMiB: 2994.12796113749,
  kvMiB: 104, nonEvictableMiB: 3347.12796113749 }
{ ctx: 16384, bundleMiB: 3344.916015625, repackMiB: 2994.12796113749,
  kvMiB: 208, nonEvictableMiB: 3451.12796113749 }
{ repackOffAt16k: 457 }
{ memAvailMiB: 3640.28515625 }
~~~

The source artifact for the latter conversion is
analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md:77,
which records MemAvailable 3,727,652 kB. The mechanism/cost explanation is
consistent, but its precision is not a measurement.

## 4. Test protection

Verdict: CONFIRMED, with a coverage limitation. The added tests protect the
requested pure behavior:

* loadPolicy.test.ts:148-150 requires qwen's exact policy.
* :160-165 requires every other listed entry to remain default.
* :168-185 checks qwen/LFM in both load and gate forms.
* :188-196 checks norepack=1 and norepack=0 in both policy directions.
* Existing :74-86 checks streaming's forced flags.

Mutation check: changing qwen's repack:false to true fails :149, :171, and
:180; removing the benchNoRepack === false branch fails :195-196. Those
assertions are meaningful because qwen and LFM are found by exact ids; an
absent qwen cannot silently make the optional-chain expectation pass.

The tests were not executable because dependencies are absent:

~~~
cd /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy
test -d node_modules && echo node_modules=present || echo node_modules=absent
~~~

~~~
node_modules=absent
~~~

There is no test here that mutates LlamaService or gateModelLoad to prove the
end-to-end wiring. The source chain in item 2 is present, but a focused
integration test would make this change harder to regress.

## 5. Other models, streaming, and forced repack

Verdict: CONFIRMED. The diff does not touch loadPolicy.ts, deviceProfile.ts,
loadGate.ts, LlamaService.ts, or streaming code. LFM has no entry policy at
ModelRegistry.ts:258-290; its resolver therefore gets the unchanged default.
The only production override is qwen.

For the forced-repack arm, loadPolicy.ts:73-77 maps benchNoRepack:false to
noExtraBufts:false, and the native parameter remains false on a non-streamed
load at LlamaService.ts:2422-2423. Expert streaming intentionally wins and
forces no_extra_bufts:true; that is not an unintended qwen change because qwen
carries no canStreamExperts entry.

The relevant command is:

~~~
cd /Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy
git diff --name-only 54297994aa1f -- src/engine
rg -n 'canStreamExperts:|streamingResident:|loadPolicy:' src/engine/ModelRegistry.ts
~~~

~~~
src/engine/ModelRegistry.ts
src/engine/loadPolicy.test.ts
225:    loadPolicy: { mmap: true, repack: false },
~~~

## 6. What the S23 evidence proves

Verdict: CONFIRMED within its stated functional scope. The evidence report
states the intervention and outcome at REPORT.md:3-10: with the selected qwen
id held constant, norepack=1 allows the load and the absent lever refuses it
with model.tightNow. It records the actual engine mode at :74-83 and :101-117,
including no_extra_bufts=1 for ARM A and 0 for the LFM fallback in ARM B.

The report does not pretend that the two /proc footprints are controlled:
REPORT.md:119-123 explicitly notes that ARM B fell back to a different model. It
also states at :20-22 and :159-161 that no timing, throughput, tok/s, or energy
number is reported and that AC power changes the thermal/DVFS regime. That
charger caveat is correct, not an over-claim.

The remaining limitation is causal precision: the report does not emit the
gate's internal requiredBytes, and ARM A/B had slightly different
MemAvailable starting points. The functional A/B plus the source formula is
enough to support “the repack-priced fit decision is the cause of this gate
outcome”; it is not enough to claim a measured performance or energy effect.

## 7. Ship safety without a timing run

Verdict: UNVERIFIABLE. The policy fixes the observed functional refusal and the
device run reaches Qwen with the intended no-repack flag, but the change also
removes the ARM repack path from the default Qwen load. The comment identifies
decode speed and major faults as the unmeasured cost at ModelRegistry.ts:178-180.
The cited report supplies no timing or thermal qualification.

The old functional APK is also a pre-policy control: its report says at
REPORT.md:38-45 that qwen had no loadPolicy and used default repack-on policy
when the lever was absent. ARM A proves the same native mode as the new entry,
but it is not a build of commit 964dd53.

## Other stale or over-broad evidence

scripts/memoryEstimateHarness.mjs:161-164 still says UI gates always estimate
with repack:true, while the live gate resolves model policy at
deviceProfile.ts:448-460. This file is unchanged by 964dd53, so it is not a
regression introduced by this commit, but the statement is false on the target
branch and can mislead future validation.

## Ordered required fixes

1. Correct the precedence text in ModelRegistry.ts:164-165 (and corresponding
   LlamaService comments) to match the actual resolver: streaming wins over
   bench levers for the effective streamed load; bench norepack overrides the
   registry policy on non-streamed loads.
2. Label the 2994/3451/457 MiB figures in ModelRegistry.ts:173-180 as estimator
   outputs, or add a qwen-specific device measurement. The source explicitly
   warns that the 4B repack fraction is under-calibrated.
3. Add an end-to-end gate/load test for the qwen-shaped registry entry, or an
   equivalent harness assertion, so a future wiring change cannot leave pure
   resolver tests green while ignoring ModelInfo.loadPolicy.
4. Before shipping this as the Qwen default, run a rebuilt target APK on the
   S23 and the motivating Xiaomi if available with explicit repack-on and
   repack-off arms. Record load time, prefill/decode throughput, major faults,
   RssAnon/RssFile/Mlocked or equivalent, temperature and battery under
   controlled power conditions. No further code fix is required for the
   functional gate result, but the release-performance claim is unsupported.
5. Update the stale memoryEstimateHarness.mjs:163-164 comment so it no longer
   describes the current policy-aware UI gate as repack-on-only.
