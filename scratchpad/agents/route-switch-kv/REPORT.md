# REPORT — route-switch KV continuity (engine fix for the S23 turn-1 truncation + turn-2 reject)

Read first: `../s23-heat-cpu-vs-gpu/DIAG-ROUTE-REJECT.md` (both sections) and its logcat
cites. Engine `kalsallama-wt-oom` @ `60a5b9db5` (branch `kalsa-opencl-upload-oom-throw`,
pushed as `kalsa-phone-v1-1-6` — never rewritten); binding `llama.rn-kalsa` @ `f9aee4ec`.

## Plan (written before coding)

1. Fix hole A (silent truncation): in `decode_impl`, when a CPU-route prefill runs and the
   prefill context holds cells beyond the decode context's end, run the same
   `commit_side(ctx_prefill, ctx_decode, ...)` the Prefill→Decode handoff uses, guarded by
   `prefill_end > decode_end` so pure-CPU chats (decode ahead) are untouched.
2. Fix hole B (the reject): in `commit_side`, when the destination is ahead of the source end,
   rewind through the sanctioned `trim_sequence(end)` (hybrid-aware) and re-check; keep the
   hard refuse as the last line of defence when even that fails.
3. Assert the invariant in a comment at the catch-up site: every batch runs on a context that
   holds the whole logical sequence up to its start position.
4. New test `tests/test-governor-v0-route-switch.cpp`: one dual-run core (governor +
   single-context baseline, greedy-token equality, position continuity) and four scenarios:
   (1) GPU prewarm, no decode, forced-CPU tail; (2) prewarm → CPU turn → GPU turn (the
   incident); (3) GPU→CPU→GPU→CPU; (4) the same via LOWBAT profiles, no override.
5. CMake entry next to the other governor model tests.
6. Targeted runs of the new test while iterating; two sabotages (catch-up removed; auto-trim
   removed), each must exit 1; restored must pass.
7. Full suite `-j 3`: router, turns, bench-route, bench-route-evidence, bench-route-setter,
   bench-route-latch, route-switch, hybrid with `KALSA_HYBRID_GGUF` (77 = skipped, not passed).
8. Engine commit (branch printed, message names repo/branch/base HEAD).
9. Binding re-sync per REPORT-ENGINE.md: VERSIONS → new engine commit, sync → bob build →
   sync, `cmp` = 0 on every changed vendored file, jest, commit.
10. Fill this report with file:line, exit codes, hashes, and declared-not-verified.

## Work log

### Engine fix (kalsallama, `60a5b9db5` → **`47f18811c6d084772bbcaa94aff9cd036df5b9d3`**, branch `kalsa-opencl-upload-oom-throw`)

Two changes, both in `src/llama-governor.cpp` (+39/−6), no new engine file:

1. **CPU-route catch-up** (`src/llama-governor.cpp:295-313`, inserted in `decode_impl` after the
   phase-handoff commit): when a CPU-route prefill runs and the prefill side's sequence end is
   beyond the decode side's, run the same `commit_side(ctx_prefill, ctx_decode, prefill_state,
   decode_state, "cpu-route catch-up")` the normal Prefill→Decode handoff uses, guarded by
   `p_end > d_end` so a pure-CPU chat (decode side ahead or equal) is untouched — that is also
   why it cannot refuse: the guard makes the destination behind by construction. The invariant
   is stated in the comment at `:295-302`: every batch runs on a context that holds the whole
   logical sequence up to its start position; the phase-handoff commit cannot see a
   Prefill→Prefill route switch (prewarm GPU → CPU turn, `last_phase == Prefill` on both sides).
   Failure string: `route Reject during CPU-route catch-up` (`:309`).
2. **Sanctioned trim instead of the hard refuse** (`src/llama-governor.cpp:96-114`, in
   `commit_side`): when the destination holds cells beyond the source end, log a WARN and
   rewind through `trim_sequence(end)` — the sanctioned path the old comment itself pointed at,
   hybrid-aware (the untrimmable side is cleared wholesale and both watermarks go to 0, so the
   following copy re-commits `[0, end)`) — then re-check. The old
   `destination holds cells beyond the source end` ERROR + refuse stays as the **last line of
   defence** when even the trim could not bring the destination within the source end.

### Test — `tests/test-governor-v0-route-switch.cpp` (308 lines; CMake `tests/CMakeLists.txt` next to the other governor model tests)

One dual-run core (governor + single-context baseline fed identical batches at identical
positions, greedy-token equality per step, position continuity per batch) and four scenarios,
each with a 40-token GPU prewarm on top of the V75 default plan (n_ctx/n_batch 256/128):

| scenario | what it pins | PASS line |
|---|---|---|
| (1) prewarm, no decode, forced-CPU tail (12 tok + 2 gen) | decode ctx holds `0..53` (`decode_pos=53`), prefill ctx keeps exactly the prewarm (`prefill_pos=39`), tokens equal baseline | `governor_route_switch_prewarm_cpu_tail=PASS decode_pos=53 prefill_pos=39` |
| (2) prewarm → CPU turn → GPU turn (the incident) | no reject, not failed, tokens equal | `governor_route_switch_prewarm_cpu_gpu=PASS n_past=66` |
| (3) four turns on top of the prewarm, CPU/GPU/CPU/GPU — the alternation reads GPU→CPU→GPU→CPU→GPU with the prewarm as the leading GPU phase (a GPU turn first would sync the sides before any CPU turn and mask the defect; initial GPU-first ordering stayed green under sabotage, so the order was changed) | every switch continuous, tokens equal | `governor_route_switch_four_turns=PASS gpu-prewarm-cpu-gpu-cpu-gpu n_past=94` |
| (4) LOWBAT profiles, **no override** (LOWBAT latches CPU; the dwell clock lifts it) | product path, tokens equal | `governor_route_switch_lowbat=PASS n_past=66` |

**Sabotage** (each `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`):

| sabotage | EXIT | red |
|---|---|---|
| CPU catch-up disabled (`if (cpu_prefill && false)`) | **1** | all four: `greedy token mismatch at pos 53 (29889 vs 29892)` and three × `pos 50 (287 vs 482)` |
| full revert (catch-up disabled + `commit_side` back to the hard refuse) | **1** | all four, same greedy mismatches (the corruption fires at each CPU turn before a reject can) |
| isolation: catch-up kept, trim removed | 0 | none — quoted for honesty: with the catch-up in place the stale-destination state is unreachable through the governor's own API, so the trim is defence-in-depth (it is the recovery the brief asked for when a GPU prefill meets stale destination cells; the refuse remains the last line of defence) |
| restored | 0 | 4/4 PASS |

### Runs (all builds `-j 3`)

Brief list: router **0**, turns **0** (commit byte-statistics unchanged), bench-route **0**
(7 PASS), bench-route-evidence **0** (2 PASS), bench-route-setter **0** (2 PASS),
bench-route-latch **0** (3 PASS), route-switch **0** (4 PASS), hybrid **0** with
`KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`
(`governor_v0_hybrid=PASS` — ran, never 77).
Extra regression guards beyond the brief (commit_side changed, so): test-governor-v0 **0**,
test-governor-v0-shared-cells **0**, test-governor-v0-commit **0**; test-governor-v0-mtp-hybrid
**77 = SKIPPED** (`model has no MTP layers` — its designed skip; no Qwen3.5-class GGUF locally;
not a regression).

### Commits and sync

- Engine **`47f18811c`** "fix(governor): keep KV continuous across route switches", 3 files
  +345/−6, base HEAD `60a5b9db5…` named in the message; branch printed before the commit
  (`kalsa-opencl-upload-oom-throw`); `kalsa-phone-v1-1-6` (pushed at `60a5b9db5`) untouched —
  pure addition on top. `llama-governor.cpp` SHA-256 prefix `ad1311cde0484e5c`.
- Binding: `vendor/VERSIONS` REF+COMMIT → `47f18811c…` (cache fetched by branch from the engine
  checkout); sync #1 **1** (expected, `want 11234/47f1881`) → `npx bob build` **0** → sync #2
  **0** → `git diff --check` **0** → **cmp = 0** on the one changed vendored source
  (`llama-governor.cpp`) → jest **16 suites / 63 tests, 0** → commit **`c502a603`** on
  `kalsarn-governor-engine` (hooks lint/types/commitlint ✔) → post-commit sync **0**, tree
  clean. Identity 11233→11234, `60a5b9d`→`47f1881`. No `NativeRNLlama.d.ts.map` drift this
  round.

### Declared, not verified

- The sanctioned-trim path in `commit_side` executes only from states the governor's own API
  cannot produce once the catch-up exists (proof sketch: after any GPU turn the decode side is
  ≥ the prefill side; after any CPU turn the same holds; `trim_sequence` keeps both sides
  equal) — it is armour for binding-side raw rewinds and the pinned B2 bypass class. No test
  drives it on the fixed engine; the isolation sabotage quote above is the evidence.
- The incident's binding-side trigger (positionless `llama_batch_get_one` tails, `n_common`
  prefix reuse) is represented in the test by explicit-position tails at the same logical
  positions; with the fix both forms land identically, and without it both corrupt — but the
  positionless form itself was not executed (that is binding machinery, engine tests position
  batches).
- No device run (the fix is host-verified against the same model family logic; the S23 log was
  the device evidence); no binding native build; no re-audit; no push. The app-side
  `KVPREFIX` accounting that spans both contexts is unchanged — with the engine invariant
  restored its single-context assumption holds again, but that was not re-verified from the app
  side.
