# GPU gate removal + V73 enablement — report

Repo: `/Users/marco/Projects/kalsa` (React Native app), local `main`, base HEAD `e5788cf`.
Working tree: two modified files (`src/engine/governorInputs.ts`, `src/engine/governorInputs.test.ts`)
plus a pre-existing unrelated `M AGENTS.md` and `?? local-artifacts/` that were already dirty
before this task and were not touched. No commit, no push, no build, no device, no adb.

---

## Order 1 — RAM threshold removed from `gpuFit`

### Diff (a)

`src/engine/governorInputs.ts`

```diff
@@ -5,7 +5,6 @@ import { estimateMemory, fitMemoryEstimate } from "./memoryEstimate";
 
 const MIB = 1024 * 1024;
-const EIGHT_GIB = 8 * 1024 * MIB;
 const BENCH_THERMO_KEY = "kalsa.bench.thermo";
@@ -86,10 +85,8 @@ function gpuFit(
   profile: DeviceProfile,
   memory: MemorySnapshot,
 ) {
-  const total = profile.totalMemoryBytes ?? memory.totalMemoryBytes;
   const kv = model.kvBytesPerToken;
   if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit" as const;
-  if (typeof total !== "number" || total <= EIGHT_GIB) return "NoFit" as const;
   if (generationFor(profile) === "Unknown") return "NoFit" as const;
```

What was removed and why it is fully removed:
- `const EIGHT_GIB = 8 * 1024 * MIB;` — the constant (was line 7, now gone).
- The read `const total = profile.totalMemoryBytes ?? memory.totalMemoryBytes;` — became unused
  the moment the check went, so it was deleted too (it was used nowhere else in `gpuFit`).
- The pre-filter `if (typeof total !== "number" || total <= EIGHT_GIB) return "NoFit" as const;`
  (was line 91).

No replacement threshold and no second RAM check was added. The real admission test is untouched:
`estimateMemory` (`governorInputs.ts:91-98`) + `fitMemoryEstimate` against
`memory.availableMemoryBytes` (`governorInputs.ts:99-104`) and the final
`requiredMiB <= availableMiB` comparison (`governorInputs.ts:117`) are byte-identical to `e5788cf`.
`profile` is still used (`generationFor(profile)` at `governorInputs.ts:90`), so nothing went dead.

File length after the change: `governorInputs.ts` 214 lines, `governorInputs.test.ts` 275 lines —
both inside the ~350-450 limit.

### Tests updated (b)

Five expectations asserted behaviour that no longer exists. Old -> new, verbatim from the diff:

`src/engine/governorInputs.test.ts:103-108` (test `enables the V75 GPU-prefill route`) — this
asserted the V73 prefill rejection, not the RAM gate:

```
old:
    expect(buildGovernorParams(model, device("SM8550"), memory)).toMatchObject({
      enabled: false,
      generation: "V73",
      gpu_prefill_measured: false,
      reason: "gpu-prefill-incorrect-V73",
    });
new:
    expect(buildGovernorParams(model, device("SM8550"), memory)).toMatchObject({
      enabled: true,
      generation: "V73",
      gpu_prefill_measured: false,
    });
```

`src/engine/governorInputs.test.ts:122-126` (test `maps V73 variants and wires the bench GPU-prefill force`):

```
old:
    expect(buildGovernorParams(model, device("SM7675"), memory)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: false,
      reason: "gpu-prefill-incorrect-V73",
    });
new:
    expect(buildGovernorParams(model, device("SM7675"), memory)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: true,
    });
```

`src/engine/governorInputs.test.ts:139-143` (same test, explicit `force = false`):

```
old:
    expect(buildGovernorParams(model, device("SM7675"), memory, false)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: false,
      reason: "gpu-prefill-incorrect-V73",
    });
new:
    expect(buildGovernorParams(model, device("SM7675"), memory, false)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: true,
    });
```

`src/engine/governorInputs.test.ts:165-174` — this is the test that asserted the old RAM
rejection. The test name also changed, because after the ruling it no longer refuses 8 GiB
devices and leaving the name would have been a false statement:

```
old:
  test("refuses unknown KV and 8 GiB devices", () => {
    expect(
      buildGovernorParams({ sizeBytes: model.sizeBytes }, device("SM8650"), memory).gpu_fit,
    ).toBe("NoFit");
    expect(
      buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("NoFit");
  });
new:
  test("refuses unknown KV and no longer gates on total RAM", () => {
    expect(
      buildGovernorParams({ sizeBytes: model.sizeBytes }, device("SM8650"), memory).gpu_fit,
    ).toBe("NoFit");
    // Total RAM is not a gate; the memory estimate against availableMemoryBytes decides.
    expect(
      buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("Fit");
  });
```

`src/engine/governorInputs.test.ts:184-186` (test `prices two contexts with the measured LFM KV`) —
the 8 GiB-total device was accepted only by the RAM gate; the estimate itself passes:

```
old:
    expect(
      buildGovernorParams(lfm!, device("QRD8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("NoFit");
new:
    expect(
      buildGovernorParams(lfm!, device("QRD8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("Fit");
```

The `NoFit` for `{ sizeBytes: model.sizeBytes }` (unknown `kvBytesPerToken`) still holds and was
left as it was. No test was added or deleted; the suite count is unchanged.

### Commands run and output (c)

```
$ npx jest src/engine/governorInputs.test.ts          # before the test edits
Test Suites: 1 failed, 1 total
Tests:       4 failed, 6 passed, 10 total
   ● enables the V75 GPU-prefill route        (SM8550: expected enabled:false + reason)
   ● maps V73 variants ...                    (SM7675: expected enabled:false + reason)
   ● refuses unknown KV and 8 GiB devices     (expected "NoFit", received "Fit")
   ● prices two contexts with the measured LFM KV  (expected "NoFit", received "Fit")

$ npx jest src/engine/governorInputs.test.ts          # after the test edits
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total

$ npx tsc --noEmit
TSC_EXIT=0          (no diagnostics)

$ npx jest --silent
Test Suites: 94 passed, 94 total
Tests:       1213 passed, 1213 total
Snapshots:   0 total
Time:        7.377 s
```

Nothing went red. The full-suite counts are identical to the previously recorded 94 suites /
1213 tests — expected, since five assertions were edited in place and no test was added or removed.

### What could break now that RAM is no longer a gate (d)

The removed check was on *total* RAM, an upper bound that was available before any model was
loaded; the surviving decision is an estimate against `availableMemoryBytes` taken at load time.
So a device whose total RAM is at or below 8 GiB — the class the gate blocked outright — can now
return `gpu_fit = "Fit"` and be handed to the engine as a governor-eligible load, as long as the
snapshot's available memory sits above the estimate. The estimate is a model, not an allocation:
the KV cache, the graph buffers and the GPU reserve are actually allocated a few steps later when
the native context is created, and nothing in `gpuFit` bounds what the allocator does. The
reachable failure is therefore a load that the pre-check admits and that then fails during
context creation — an init error, or the process killed by the low-memory killer — instead of the
earlier, cheap refusal. Two guards already exist but neither covers this: `LlamaService.ts:2331`
only refuses to attach the governor when `gpu_fit === "NoFit"` (it cannot know a future alloc
will fail), and `activeGovernorFallbackReason` (`LlamaService.ts:2655-2660`) explains a governor
that was not attached, not a load that died after the governor was attached. Catching it would
need the load path to observe a native context-creation failure and retry with the governor off
(or with CPU prefill), plus a run on the sub-8 GiB class itself. NOT VERIFIED: no device was
touched in this task, so the failure mode and the retry are both unmeasured here.

---

## Order 2 — V73 on in production

### Diff (a)

`src/engine/governorInputs.ts:21-26`

```diff
@@ -22,7 +21,7 @@ const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
   V75: true,
-  V73: false, // never measured in-app; bench runs use kalsa.bench.governor_force
+  V73: true, // owner decision 2026-09-21: enabled in production, never measured in-app; kalsa.bench.governor_force still exists for the other paths
   Unknown: false,
 };
```

The V79 one-line comment and the multi-line V75 block comment are untouched. The V73 comment is a
single line and claims only what is true: owner decision of 2026-09-21, never measured in-app,
and the bench key still present for the other paths. No measurement is asserted that does not
exist. The constant is the path constant `BENCH_GOVERNOR_FORCE_KEY = "kalsa.bench.governor_force"`
(`governorInputs.ts:9`), exported and still read by `readBenchGovernorForce`.

`enabled = force || GPU_PREFILL_CORRECT[generation]` (`governorInputs.ts:128`) is unchanged; V73
now evaluates to `enabled: true` with no `reason` field, which the updated tests assert. Effect in
the app: `governorLoad` (`LlamaService.ts:2326-2341`) no longer rejects a V73 device on
`governorBase.enabled`, so the governor params reach the engine for V73 as they already did for
V75/V79. What the engine then does with them is the next section.

### What V73 still needs on the engine side (read-only finding, one paragraph)

The engine the app actually builds is the pinned vendored tree — kalsa.rn `0288dc2` -> kalsallama
`8537d097c`, present at
`node_modules/llama.rn/vendor/llama.cpp/src/llama-governor-policy.cpp:163-165` (same file in
`Aspis0/kalsallama` @ `8537d097c`; at `kalsallama` `main` `5c96b18dd` the identical condition sits
at lines 166-168). That condition admits the GPU prefill lane only when
`(generation == V75 || generation == V79) && gpu_fit == Fit && gpu_prefill_measured`, so with the
app now sending `enabled: true` for V73 the engine still refuses: `prefill_engine()` falls through
to `CPU` for every V73 model unless the bench force at `llama-governor-policy.cpp:161-162` is set,
which means this app change alters what the app *sends* and not what the engine *does* for V73.
V73 needs two coupled changes, not one: the engine must add `V73` to the generation set on
`llama-governor-policy.cpp:163-165`, and the app must then send `gpu_prefill_measured: true` for
V73 — but order 2 explicitly left `gpu_prefill_measured` at `generation === "V75" ||
generation === "V79"` (`governorInputs.ts:137`), so an engine-only change would still land on
`gpu_prefill_measured == false` and keep returning `CPU`. The one existing V73 path that does not
need `gpu_prefill_measured` is the coolmode lane at `llama-governor-policy.cpp:168-171`
(`generation == V73 && model_kind == MoE && cool_prefill_eligible && gpu_fit == Fit &&
!hot_plugged_` -> `GPU_COOLMODE`), and it is unreachable today: `cool_prefill_eligible` defaults to
`false` (`vendor/llama.cpp/src/llama-ext.h:255`), nothing in the engine ever sets it, and although
the binding glue would read it from the governor JSON (`node_modules/llama.rn/cpp/rn-governor-params.cpp:138`,
`bool_or(governor, "cool_prefill_eligible", false)`) the app never sends that key (no occurrence
anywhere under `src/`). That lane is also MoE-only, so it would not serve a dense or hybrid V73
model at all. Engine untouched in this task, as ordered.

### Enumeration — every `NoFit` return left inside `gpuFit` (THIRD THING, nothing changed)

Line numbers are the post-change file `src/engine/governorInputs.ts`.

| # | file:line | exact condition | what it means |
|---|---|---|---|
| 1 | `governorInputs.ts:89` | `if (typeof kv !== "number" \|\| !Number.isFinite(kv) \|\| kv <= 0) return "NoFit" as const;` | the model's `kvBytesPerToken` is missing, non-finite, or non-positive; the KV price is unknown so nothing can be priced |
| 2 | `governorInputs.ts:90` | `if (generationFor(profile) === "Unknown") return "NoFit" as const;` | the SoC string maps to no known generation, so the engine's generation-specific lanes cannot be trusted |
| 3 | `governorInputs.ts:106` | `if (verdict.status === "unknown" \|\| verdict.status === "does_not_fit") return "NoFit" as const;` | `fitMemoryEstimate` returned `unknown` (available memory null/non-finite/≤0, `memoryEstimate.ts:203-210`) or `does_not_fit` (non-evictable estimate exceeds available, `memoryEstimate.ts:214-221`) |
| 4 | `governorInputs.ts:117` | `return requiredMiB <= availableMiB ? "Fit" as const : "NoFit" as const;` | the final budget test: `estimate.nonEvictableMiB + gpuReserveMiB + estimate.computeMiB + estimate.kvMiB` exceeds `availableMemoryBytes` |

The removed RAM return was the only other one; four remain and not one was modified.

---

## Truth status

- Ran and saw pass: `npx tsc --noEmit` (exit 0), `npx jest --silent` (94/94 suites, 1213/1213
  tests), `npx jest src/engine/governorInputs.test.ts` (10/10).
- Read, not executed: the engine condition and the coolmode lane in the vendored pinned tree, and
  the two cited `LlamaService.ts` guards. No engine build, no device run, no app build.
- NOT VERIFIED: any on-device consequence of either order, real V73 GPU-prefill behaviour, and the
  post-load allocation failure mode in (d). V73 remains unmeasured in-app, as the V73 comment says.
- Risk carried by this change: enabling V73 makes a V73 device governor-eligible while the engine
  still routes it to CPU (no behavioural regression, but a misleading `enabled: true` in the params),
  and removing the RAM gate widens the set of devices that pass `gpuFit` to include sub-8 GiB
  boards whose KV/graph allocation is only proven later, on the phone.
