# P1-CONDITIONAL — governor `decode_repack` (binding, no vendor change)

Binding **`e89660d8`** (`kalsarn-governor-engine`, on the pushed `f8e3a748`; local,
NOT pushed). One commit, 8 files, +86/−23.

## The parameter

- **JS name / path:** `governor.decode_repack` (optional boolean) on the context
  init params, i.e. `initLlama({ ..., governor: { enabled: true, thermo,
  decode_repack: false } })`. TS type: `src/types.ts` `governor?` block, with the
  WHY comment (repack-on is upstream default; false only where the lane does not
  fit with repack — 8 GB S23 — costing ~1.41× lane decode and KLD p99
  0.0341 → 0.0422).
- **Default TRUE** = upstream behaviour (repack on). When false:
  `cpp/rn-llama.cpp` `load_governor_models` sets `decode_params.no_extra_bufts =
  true` exactly as P1 did. Absent → true; non-boolean → parse refusal
  (`governor.decode_repack must be a boolean`).
- **Travel:** `rnllama::governor_load_options { bool decode_repack = true; }`
  (`cpp/rn-governor-params.h`, binding-level — it shapes the model load, so it
  deliberately does NOT enter the engine's `llama_governor_params`) →
  `parse_governor_params` (4th out-param, `bool_or(..., "decode_repack", true)`)
  → `parseGovernorLoadParams` → `loadModel(…, const governor_load_options &)`
  (default-constructed default, so the non-governor path is untouched) →
  `load_governor_models`. The prefill model is untouched; no vendor change.

## Tests (red in both directions)

- Native `tests/governor_params_test.cpp` `governor decode_repack parses both
  directions`: absent → true, `false` → false, `true` → true, `1` → refused.
  Sabotage (parse hardcodes `true`, flag ignored) → **exit 1**, the test FAILED.
  Restored → **exit 0, 6/6**.
- Source guard `src/__tests__/governorLaneRepack.test.ts` (P1's pin, updated):
  pins `if (!load_options.decode_repack) { decode_params.no_extra_bufts = true; }`
  inside `load_governor_models`, the parse line in `rn-governor-params.cpp`, and
  the unchanged single-assignment census. Sabotage (unconditional P1 restored) →
  **exit 1** (`✕ no_extra_bufts on the decode params is conditional`);
  restored → **exit 0**.

## Gates (exit codes)

`npm run lint` **0**; `npm run typecheck` **0**; `npm test -- --maxWorkers=2`
**0** (14 suites / 51 tests / 5 snapshots); `make governor_params_test rnllama_tests
-j3` **0 errors**; `./governor_params_test` **0** (6/6). Two disclosed stumbles,
both stale-build artifacts caught by the gates and fixed before the commit: the
`loadModel` definition initially missed the new fourth parameter (native build
exit 2), and a sabotage restore landed within the same mtime second and needed a
forced TU rebuild.

## Not verified

No device run: the 1.41×/KLD numbers are the task's cited measurements, not
re-measured here; the app side (`LlamaService`) is not touched — the app coder
decides when to set `decode_repack: false` (the 8 GB S23 shape).

## App side

kalsa worktree `kalsa-wt-bench-apk`, from `c6ab4c46` (origin/main), detached.

**Decision rule** — `src/engine/governorInputs.ts`:
- `laneFit(model, profile, memory, repack)` (:82): the old fit arithmetic,
  now parameterised by the `repack` price.
- `gpuFit(..., benchNoRepack)` (:120): price WITH repack first →
  `decode_repack: true`; else price WITHOUT → `decode_repack: false`; else
  `NoFit`. One WHY comment (:126-133) states the P1 cost (~1.41x lane decode,
  KLD p99 0.034 → 0.042; 8 GB S23: 4358.70 MiB with vs 2998.06 without) and
  the precedence: `kalsa.bench.norepack` outranks the fit — `"1"` skips the
  with-repack attempt (no-repack arm), `"0"` skips the P1 fallback (repack-on
  arm is refused rather than silently re-priced), absent → production order.
- `buildGovernorParams` (:152, :161) exposes `decode_repack` in the plan;
  `LlamaService` passes `benchNoRepack` (tri-state, `kalsa.bench.norepack`)
  as the 5th arg at the `buildGovernorParams` call (`LlamaService.ts:2360`)
  and the existing spread `{ ...governorBase, ... }` → `governor: governorLoad`
  (`:2371`, `:2453`) carries `decode_repack` into `initLlama`. The value is
  part of `governorKey = JSON.stringify(governorBase)` (:2376), so crossing a
  fit boundary forces a reload.

**Tests** (`governorInputs.test.ts`): red first — new 5-arg calls failed to
compile (`TS2554 Expected 3-4 arguments, but got 5`, exit 1) — green after
(14/14). New: fits-with-repack → `decode_repack: true` (4359 MiB, boundary of
4358.70), fits-only-without → false (4358 and 2999 MiB), neither → NoFit
(2998 and 2997 MiB, boundary of 2998.06 — both confirmed by the green run,
not just arithmetic); bench precedence `"1"` → false even where repack fits,
`"0"` → no P1 fallback (2999 MiB → NoFit). Knife-edge test kept unchanged.
Sabotage once (with-repack attempt hard-disabled = unconditional P1) →
exit 1, three tests red; restore → exit 0, identical.

**Pin:** `llama.rn` → `e89660d81cb3d369c53c8d92a370092bb3338d9e`; lockfile
3/3 lines; `npm ci` exit 0, real directory; `native/kalsallama.pin` unchanged
at `9875acabef87af4eeeb17dc5577c352d26d3aa0d`, confirmed from that binding's
`vendor/VERSIONS`.

**Gates:** provenance exit 0 (`kalsa.rn@e89660d81cb3`, 1119 files match,
`kalsallama@9875acabef87 == native/kalsallama.pin`); tsc exit 0; one full
jest exit 0 — 116 suites / 1458 tests; apk.yml harnesses 59/59.

**Not verified:** no device run — the 1.41x/KLD figures remain the cited
measurements; the S23 4358.70/2998.06 boundaries were re-derived by the test
run on this machine, not on hardware.
