# Adversarial follow-up review: Qwen repack-policy fixes

Target: `/Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy`, branch
`qwen-repack-policy`, HEAD `fc3627dc7314baa4577aef87f0b5b2c943abbd69`, parent
`964dd536f13b24219d383526e75607b038a23d48`.

The target was kept read-only. For the required mutation test, I copied it to
`/private/tmp/qwen-repack-mutant.wT5IlT`, removed the production handoff there,
ran the test, and left the real worktree untouched.

## Verdicts

1. **CONFIRMED — the guard is non-decorative.**
2. **CONFIRMED — the resolver precedence prose is accurate for the resolver;
   the native streaming enforcement is outside this repository.**
3. **CONFIRMED with a precision caveat — the requested figures are labelled
   estimator outputs and the calibration warning is present, but the 16K/high-
   RAM context for 3451/457 is not stated locally.**
4. **CONFIRMED — the stale harness comment is corrected and no touched-file
   comment still says that UI gates are repack-on-only.**
5. **CONFIRMED for scope and targeted checks; UNVERIFIABLE for the repository
   typecheck/full suite because this checkout has no `node_modules`.**
6. **CONFIRMED — no new house-rule violation was introduced.**
7. **Overall: PUSH-SAFE for this follow-up commit, pending owner approval, but
   not performance-qualified as the final Qwen default until the separate timing
   experiment is complete.**

## 1. Guard mutation

The production handoffs are present at:

```text
src/engine/loadGate.ts:90:  loadPolicy: input.model.loadPolicy,
src/engine/loadGate.ts:224:      loadPolicy: input.model.loadPolicy,
src/engine/deviceProfile.ts:448:    policy: model.loadPolicy,
src/engine/LlamaService.ts:2255:    const load = resolveLoadPolicy({
src/engine/LlamaService.ts:2256:      policy: modelInfo?.loadPolicy,
```

The new guard is at `src/engine/loadGate.test.ts:315-408`. It uses the exact
`qwen3.5-4b` registry entry, throws if that entry is absent (`:325-327`),
checks the policy-bearing path against a dynamically computed repack-on budget
(`:329-367`), checks `loadGateFitModel` forwarding directly (`:370-385`), and
checks the forced-repack and streaming paths (`:387-408`). It is not a vacuous
optional-chain assertion: the missing registry entry throws before the tests
run.

Baseline command, using the repository's Jest test and a read-only shared
Jest installation because the target has no dependencies:

```text
NODE_PATH=/Users/marco/Projects/kalsa/node_modules /opt/homebrew/bin/node /Users/marco/Projects/kalsa/node_modules/jest/bin/jest.js src/engine/loadGate.test.ts --runInBand --config='{"rootDir":"/Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy","roots":["<rootDir>/src"],"testEnvironment":"node","testMatch":["**/*.test.ts"],"moduleFileExtensions":["ts","js","json"],"transform":{"^.+\\.ts$":["/Users/marco/Projects/kalsa/node_modules/ts-jest",{"tsconfig":"/private/tmp/qwen-repack-tsconfig.json"}]}}'
```

Output:

```text
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```

Mutation A removed only `loadPolicy: input.model.loadPolicy` from
`gateModelLoad`'s `decidePreSendFit` input (`loadGate.ts:223` in the disposable
copy). The same command then failed:

```text
Expected: true
Received: false
at src/engine/loadGate.test.ts:357
Test Suites: 1 failed, 1 total
Tests:       1 failed, 20 passed, 21 total
```

Mutation B independently removed the `loadGateFitModel` handoff at its
`loadGate.ts:90`. It failed with:

```text
Expected: {"mmap": true, "repack": false}
Received: undefined
at src/engine/loadGate.test.ts:384
Test Suites: 1 failed, 1 total
Tests:       1 failed, 20 passed, 21 total
```

This proves the new test is protective at both gate hops. It does not instantiate
the native `LlamaService.initEngine`; the test comment honestly identifies that
boundary at `loadGate.test.ts:318-320`. A future regression only in the
LlamaService call would still require source review or a native integration
harness, but the added test is not decorative and satisfies the earlier gate/load
wiring finding.

## 2. Precedence prose versus code

The single authoritative statement is `src/engine/loadPolicy.ts:4-25`:

```text
loadPolicy.ts:8: expert streaming > bench levers > per-model policy > default
loadPolicy.ts:15-20: the bench levers apply to the NON-streamed load only ...
```

The implementation at `loadPolicy.ts:64-82` matches it in every resolver path:

| Inputs | Result |
|---|---|
| `streamExperts=true`, any policy or bench values | `useMmap=true`, `noExtraBufts=true` at `:69-76` |
| streamed plus `benchNoRepack=false` | streaming branch wins before the bench branch |
| non-streamed, `benchNoRepack=true` | repack off at `:77-78` |
| non-streamed, `benchNoRepack=false` | repack on at `:79-80` |
| non-streamed, `benchUseMmap` present | its value wins at `:71-73` |
| no bench lever, registry policy present | policy wins at `:65`, `:73`, `:81` |
| no registry policy | `DEFAULT_LOAD_POLICY` at `:65`, which is `{mmap:true,repack:true}` at `:37` |

`ModelRegistry.ts:163-168` now correctly says that the field supplies the
per-model term and that the resolver owns the ordering. The LlamaService
comments at `:2246-2254` and `:2416-2422` correctly explain its two-stage use:
it resolves the non-streamed base with `streamExperts:false`, then applies the
streaming force, while a bench arm that disables streaming falls back to the
non-streamed bench-over-policy result.

There is one pre-existing boundary worth retaining in the handover: the gate
passes `benchNoRepack` to `resolveGateLoadPolicy` at `deviceProfile.ts:448-451`,
but does not pass a `benchUseMmap` lever. That does not affect this Qwen entry
(`mmap:true`) and is not introduced by HEAD. Also, the repository does not
contain the native `bmoe_stream.cpp` implementation, so native enforcement of
`use_mmap=true` cannot be independently proven here; the JS resolver and tests
do enforce/document it.

## 3. Estimator labelling

`ModelRegistry.ts:176-186` explicitly says:

```text
These are ESTIMATOR OUTPUTS, not device measurements
```

It labels the 2994 MiB repack term, 3451 MiB non-evictable term, and ~457 MiB
repack-off term in that same paragraph. It also explicitly records the
under-calibration at `:182-184`, citing the one 2B anchor and the Q3 4B
`CPU_REPACK` observation near 1.00x rather than silently presenting 0.895 as a
Qwen measurement.

The arithmetic source still reproduces the stated values:

```text
node calculation: bundleMiB=3344.916015625
repackMiB=2994.12796113749
nonEvictableMiB at 16K=3451.12796113749
repackOffAt16K=457
memAvailMiB=3640.28515625
```

The 3451/457 values are specifically the 16K/high-RAM calculation (the prior
report established that; the current paragraph does not say so). The 3640 value
is an observed MemAvailable input, not an estimator output. I would tighten the
sentence to say “at the high-RAM 16K estimate, against observed 3640 MiB” so
the context and the measured input cannot be mistaken. This is a documentation
precision fix, not a new load-policy safety defect.

The Qwen entry comment at `ModelRegistry.ts:230-233` also calls 2994 an
“estimator's” value and points back to the caveat.

## 4. Harness comment and old assertions

The stale statement is gone. `scripts/memoryEstimateHarness.mjs:161-167` now
says that the UI gate resolves the model's policy through
`deviceProfile.decidePreSendFit` and `resolveGateLoadPolicy`, with only an
absent entry using the conservative default.

Command:

```text
rg -n -i 'always[^\\n]{0,60}repack|repack[^\\n]{0,60}always|UI gates always|repack-on-only|always estimate' scripts/memoryEstimateHarness.mjs src/engine/LlamaService.ts src/engine/ModelRegistry.ts src/engine/loadGate.test.ts src/engine/loadPolicy.ts
```

Output: empty. No touched-file comment still asserts the old repack-on-only UI
behaviour.

## 5. Scope, leaks, language, and checks

Shape:

```text
git rev-list --parents -n1 HEAD
fc3627dc7314baa4577aef87f0b5b2c943abbd69 964dd536f13b24219d383526e75607b038a23d48

git log --first-parent --oneline 964dd53..HEAD
fc3627d fix(engine): align repack precedence docs and guard the qwen load policy

git diff --name-status 964dd53..HEAD
M scripts/memoryEstimateHarness.mjs
M src/engine/LlamaService.ts
M src/engine/ModelRegistry.ts
M src/engine/loadGate.test.ts
M src/engine/loadPolicy.ts
```

The five files are justified by the four fixes: precedence comments and the
resolver's central wording, estimator/harness comments, and the gate test. No
production refactor or unrelated file was added. `git diff --check 964dd53..HEAD`
returned no output and exit 0.

Leak scan:

```text
git diff 964dd53..HEAD -- | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}' || echo 'no matches'
no matches
```

Added-line language scan:

```text
git diff --unified=0 964dd53..HEAD -- | rg -n '^\\+[^+].*(quindi|questo|questa|sempre|solo|senza|carico|misurato|misurata|misurazione|Il repo|Richiesto|Fase|[À-ÿ])' || echo 'no added Italian candidates'
no added Italian candidates
```

The branch still contains older Italian comments in pre-existing lines of the
large source files, including `ModelRegistry.ts:225`; none is added by this
commit. The changed lines themselves are English.

Relevant test command and output:

```text
...jest.js src/engine/loadPolicy.test.ts src/engine/loadGate.test.ts --runInBand --config=...
Test Suites: 2 passed, 2 total
Tests:       40 passed, 40 total
```

The split policy suite was also run independently:

```text
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

The target checkout has no `node_modules`. Consequently:

```text
npm run typecheck
sh: tsc: command not found

npm test -- --runInBand
npm error Missing script: "test"
```

Those are environment/packaging limitations, not test failures in the changed
logic. The relevant Jest suites are green under the shared read-only harness;
the full repository typecheck is **UNVERIFIABLE** here.

## 6. House rules

Line counts before and after the commit are:

```text
scripts/memoryEstimateHarness.mjs 337 -> 340
src/engine/LlamaService.ts        6231 -> 6230
src/engine/ModelRegistry.ts        396 -> 404
src/engine/loadGate.test.ts        311 -> 409
src/engine/loadPolicy.ts           101 -> 105
```

The new test and registry file remain within the owner's rough 350-450-line
range. `LlamaService.ts` is a pre-existing 6,231-line file and is one line
shorter after this commit; this change did not push it over the threshold or
justify a refactor. It should remain explicitly declared as an existing
exception in the integration handover. The new imports in `loadGate.test.ts`
(`MODEL_REGISTRY`, `ModelInfo`, and `resolveLoadPolicy`) are all used. The
added comments explain policy boundaries and mutation coverage; they do not
merely narrate the next executable line.

## Required fixes

None is required to make the four claimed follow-up fixes non-decorative and
correct. The only recommended text tightening is to qualify the 3451/457
figures as the high-RAM 16K estimator path and call 3640 the observed
MemAvailable input.

The separate fifth finding remains open by design: no rebuilt S23/Xiaomi timing,
fault, thermal, or battery comparison is present in this commit. Therefore this
commit is push-safe pending owner approval, but the Qwen default is not
performance-qualified until that experiment is completed.

**PUSH-SAFE pending owner approval for `fc3627d`; no push performed.**
