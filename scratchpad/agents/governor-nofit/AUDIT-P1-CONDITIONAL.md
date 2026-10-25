# AUDIT — conditional P1: governor `decode_repack` (binding `e89660d8`, app `266111ad`)

**Verdict: SHIP-WITH-FIXES.** The mechanism is correct end to end and the decision direction matches
the engine flag; the fixes are (1) the package's emitted types were not rebuilt, so `decode_repack`
is absent from the published `d.ts`, and (2) the with-repack price uses a proxy fraction
(0.895 × file bytes) that is ~10 % below the weight bytes the engine actually repacks for this model,
so the report's "matches what the binding allocates" is not established for LFM2.5-2.6B.

Verified here: app `npx jest src/engine/governorInputs.test.ts --runInBand` → **EXIT=0** (14/14);
binding `npx jest src/__tests__/governorLaneRepack.test.ts --runInBand` → **EXIT=0** (3/3);
app `npx tsc --noEmit -p tsconfig.json` → **EXIT=0**; `scripts/assert-engine-provenance.sh` →
**EXIT=0** (`OK: 1119 files match Aspis0/kalsa.rn@e89660d81cb3`, `engine inside it:
kalsallama@9875acabef87 == native/kalsallama.pin`). Read-only otherwise.

## 1. The parameter reaches `load_governor_models`, and is not dropped — CONFIRMED

The whole chain, one path and no copy that strips it:

    cpp/rn-governor-params.h:15      bool decode_repack = true;
    cpp/rn-governor-params.cpp:135   options.decode_repack = bool_or(governor, "decode_repack", true);
    cpp/jsi/RNLlamaJSI.cpp:637       rnllama::governor_load_options governorLoadOptions{};
    cpp/jsi/RNLlamaJSI.cpp:710       if (ctx->loadModel(cparams, governorEnabled ? &governorParams : nullptr,
                                     governorEnabled ? &governorThermo : nullptr, governorLoadOptions)) {
    cpp/rn-llama.h:164               const governor_load_options & load_options = governor_load_options{});
    cpp/rn-llama.cpp:91              if (!load_options.decode_repack) {
    cpp/rn-llama.cpp:92                  decode_params.no_extra_bufts = true;

`loadModel` has exactly one caller (`grep -rn "loadModel(" cpp/` -> `RNLlamaJSI.cpp:710`,
`rn-llama.cpp:710` definition, `rn-llama.h:160` declaration), so there is no second init path that
would take the default and silently re-enable repack. The JS layer is transparent: the binding's
`src/index.ts` contains no `governor` handling at all (`grep -n governor src/index.ts` -> empty), so
the object the app spreads into `initLlama` reaches `llamaInitContext` unchanged;
`lib/typescript` staleness is a type-only issue, see §6. The engine honours it:
`common/common.cpp:1706 mparams.use_extra_bufts = !params.no_extra_bufts;` and
`src/llama-model.cpp:1093 if (use_extra_bufts) { ... ggml_backend_dev_get_extra_bufts ... }`.
CONFIRMED.

## 2. Default true wherever a caller omits it — CONFIRMED

Three independent defaults all true: the struct member initializer (`rn-governor-params.h:15`), the
parser fallback (`bool_or(..., "decode_repack", true)`, `rn-governor-params.cpp:135`), and
`loadModel`'s default argument (`rn-llama.h:164`). The only constructions in the tree are
brace-initialized (`RNLlamaJSI.cpp:637`, `tests/governor_params_test.cpp:58`) so the member
initializer applies. The JSI reaches the parser only when a `governor` object exists
(`parseGovernorLoadParams` returns false without it), so the non-governor path never loads a governor
and the flag is inert there. CONFIRMED.

## 3. Fit arithmetic vs. what the binding allocates — PLAUSIBLE (magnitude unproven)

The two prices differ by exactly the repack term, which is the right *shape*:

    governorInputs.ts:92-99   const estimate = estimateMemory({ fileBytes: model.sizeBytes, ..., repack });
    governorInputs.ts:134     if (benchNoRepack !== true && laneFit(..., true) === "Fit")  -> decode_repack: true
    governorInputs.ts:137     if (benchNoRepack !== false && laneFit(..., false) === "Fit") -> decode_repack: false
    memoryEstimate.ts:160     if (repack) repackMiB = weightsMiB * REPACK_FRACTION;
    memoryEstimate.ts:51      export const REPACK_FRACTION = (1333 - COMPUTE_MIB_AT_UBATCH_256) / 1211;   // = 1084/1211 = 0.8951

With the registry entry (`modelRegistry.ts:279 sizeBytes: 1_593_894_944`, `:281 bytes:
1_585_647_616`) the with-repack price adds `0.8951 × 1520.06 = 1360.6 MiB`, which is exactly the
report's 4358.70 − 2998.06. The engine's repack allocation is the repackable tensors' bytes:

    ggml/src/ggml-cpu/repack.cpp:5403   return ggml_nbytes(tensor);   // standard repack path (q2/q3 8x4 differs)

i.e. ≈ the CPU weight bytes under mmap, which for this model is 1512.2 MiB if the quantized tensors
are repackable — about 10 % (≈150 MiB) more than the app prices. The constant's own comment says it
was anchored on a 2B at 16k and a 4B (`memoryEstimate.ts:47-49 "both phone anchors… n=3, one model
family"`), not on the governor lane or this model, and the report's 4358.70 MiB is this arithmetic's
output, explicitly "re-derived by the test run on this machine, not on hardware". The error direction
is the dangerous one: an optimistic with-repack price can choose `decode_repack: true` where the lane
does not actually fit, which is the P1 failure returning. Derive the LFM2 repack fraction from its
tensor types (or measure the 8 GB lane's RssAnon in both arms) before trusting the boundary.
PLAUSIBLE, not a code defect.

## 4. The NoFit branch `decodeRepack: benchNoRepack === false` — CONFIRMED as shaped, one ambiguity

    governorInputs.ts:140   return { fit: "NoFit" as const, decodeRepack: benchNoRepack === false };

For the two forced arms this is right: knob `"0"` (repack-on arm) → `false === false` → plan carries
`true` (repack on, refused rather than re-priced); knob `"1"` → `true === false` → `false` (the
no-repack arm refused). For absent → `false`, and the plan is unused anyway: `LlamaService.ts:2367
governorBase.gpu_fit !== "NoFit"` keeps `governorLoad` null, and `:2376 const governorKey =
governorLoad ? JSON.stringify(governorBase) : "off"` means the NoFit plan never enters the reload
key. Minor readability nit only: a NoFit plan printing `decode_repack: false` looks like the P1 arm;
`true` or an omitted field there would be less ambiguous.

## 5. The A1 CPU-only reload ignores `decode_repack` correctly — CONFIRMED

    LlamaService.ts:2577-2581   const cpuParams: ContextParams = { ...params };
                                delete cpuParams.governor;
                                delete cpuParams.speculative;
                                cpuParams.n_gpu_layers = 0;
                                cpuParams.n_parallel = 1;
    LlamaService.ts:2587        enabled: !governorRuntimeOff,

`cpuParams` carries no `governor` key, so `parseGovernorLoadParams` returns false and
`load_governor_models` is never called on the reload — `decode_repack` (and the lane) are
irrelevant. The CPU-only load's own repack decision is the plain policy, independent of the lane:

    LlamaService.ts:2478-2479   params.no_extra_bufts = params.moe_stream?.enabled === true ? true : load.noExtraBufts;

and `governorRuntimeOff` forces the idempotent-skip guard to be bypassed (`:2393 !governorRuntimeOff`).
CONFIRMED. (The single-model repack policy itself is pre-existing behaviour, not changed here.)

## 6. Tests and provenance

- Native `tests/governor_params_test.cpp:126-136` `test_decode_repack_both_directions`: absent
  → true, `false` → false, `true` → true, `1` → refused via `bool_or`'s non-boolean throw
  (`rn-governor-params.cpp:26-28`). A parser that ignores the key leaves `options.decode_repack ==
  true` after the `false` case → `return false` → exit 1. Right reason. (Not compiled here — no
  builds.)
- Source pin `src/__tests__/governorLaneRepack.test.ts` asserts the conditional, the exact parse
  line, and the single-assignment census; I ran it → **EXIT=0, 3/3**. An unconditional-P1 revert
  removes `if (!load_options.decode_repack) {` → red. Right reason.
- App tests: `governorInputs.test.ts` boundary and precedence cases; I ran the file → **EXIT=0,
  14/14**, `tsc` **EXIT=0**.
- **Stale emitted types — CONFIRMED (fix):** `src/types.ts:243 decode_repack?: boolean` exists, but
  the package's `types` entry (`package.json:7 "types": "lib/typescript/index.d.ts"`) does not
  contain it — `grep decode_repack lib/` (binding) and
  `grep decode_repack node_modules/llama.rn/lib/typescript/*.d.ts` (app) are both empty, while
  `node_modules/llama.rn/src/types.ts:243` has it. The commit did not run `bob build` and the package
  has no `prepare` script (`grep '"prepare"' package.json` → none), so git-dependency installs ship
  the committed stale `lib/`. The app's tsc passes only because the value travels through the
  `governorBase` spread; a package consumer reading `NativeContextParams["governor"]` cannot see the
  field. Rebuild and commit `lib/` as the earlier bumps did.
- Pin/provenance — CONFIRMED: `package.json:49 github:Aspis0/kalsa.rn#e89660d81cb3…`, lockfile
  `git+ssh://…/kalsa.rn.git#e89660d81cb3…`, `native/kalsallama.pin 9875acabef87…` equals the
  binding's `vendor/VERSIONS:9`; both the binding commit (`origin/kalsarn-governor-engine`) and the
  engine commit (`origin/kalsa-phone-v1-1-3`) are on pushed remotes; the provenance script exits 0 on
  1119 files.

**Disclosed reload-churn note (PLAUSIBLE, declared):** `decode_repack` is part of `governorBase`, so
`governorKey` (`LlamaService.ts:2376`) changes when MemAvailable crosses the 4358.70/4359 MiB
boundary, forcing an engine reload between two working configurations; there is no hysteresis. The
report states the key inclusion, so this is a design choice to keep an eye on in the bench, not a
hidden defect (a device MemAvailable wobble of 1 MiB across the boundary reloads the model).

## What I could not verify

- No device run: the 1.41×/KLD figures and the true 8 GB lane requirement are cited, not re-measured;
  the fix for §3 needs either the LFM2 tensor-type census or a device RSS pair per arm.
- The native `governor_params_test` red/green (no build); the parser logic is read-verified only.
- Whether `decode_repack` should also be exposed on the multimodal/vocoder init paths (they do not
  call `loadModel`, so they are unaffected).
