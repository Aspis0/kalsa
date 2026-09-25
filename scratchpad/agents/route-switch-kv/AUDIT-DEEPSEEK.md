# AUDIT — route-switch KV continuity (engine `47f18811c`, binding `c502a603`)

**Verdict: SHIP.** The incident sequence now syncs instead of truncating/rejecting; the trim path is
sound; the other switch orders, LOWBAT, `clear_cache` and a binding rewind are covered by the
invariant. Real remnants are declared, not defects.

## Incident replay (GPU prewarm 1812 → forced CPU tail 92 → GPU turn) — CONFIRMED FIXED

    llama-governor.cpp:295-313  if (cpu_prefill) {
                                    sequence_end(ctx_prefill, 0, p_end) && sequence_end(ctx_decode, 0, d_end) &&
                                    p_end > d_end → commit_side(ctx_prefill, ctx_decode, prefill_state, decode_state,
                                                                "cpu-route catch-up")
                                    }
    llama-governor.cpp:70-81    sequence_end on an empty context: max_pos < 0 → end = 0; return true

- Prewarm: `p_end = 1812`, `prefill_state.watermark = 0` (watermarks advance only in `commit_side`,
  `:149-150`), `ctx_decode` empty → `d_end = 0` → guard passes.
- `commit_side(src=ctx_prefill, dst=ctx_decode)`: `end = 1812 >= src.watermark(0)`; `dst_end(0) > 1812`
  false → no trim; `end > src.watermark` → copy `[0, 1812)` (MirrorAndCopy) → `ctx_decode` frontier
  becomes **1812**; both watermarks = 1812.
- The CPU tail then decodes on `ctx_decode` from its frontier: the binding passes
  `n_past = 1812` (`rn-completion.cpp:622`) and `llama_batch_get_one(&embd[n_past], n_eval)` whose
  `pos = nullptr` (`llama-batch.cpp:938`) → the 92 tail tokens land at **1812..1903**, reply at
  1904..1941. No truncation, no RoPE rebase.
- The GPU turn's handoff `commit_side(ctx_decode → ctx_prefill)`: `end = 1942`, `dst_end = 1812`
  → no trim, copy `[1812, 1942)` → no `route Reject`. Test scenario 2 pins `n_past=66`, no failure;
  scenario 1 pins the split (`decode_pos=53`, `prefill_pos=39`) and greedy-token equality with a
  single-context baseline.

Binding accounting agrees because the target context now holds the whole sequence: `:533
find_common_prefix_length(embd, text_tokens)`, `:622 n_past = n_common`, `:636
llama_memory_seq_rm(kv, 0, n_past, -1)` on the active context, `:680 governor->trim_sequence(n_past)`
— all consistent with the frontier the engine now guarantees.

## `commit_side` destination trim — CONFIRMED sound (declared untested)

    llama-governor.cpp:96-114  dst_end > end → WARN + trim_sequence(end); re-check; else the old
                               "destination holds cells beyond the source end" ERROR + refuse
    llama-governor.cpp:180-225 trim_sequence: both sides seq_rm(0, p, -1); exact → watermarks =
                               min(watermark, p); untrimmable → clear that side wholesale, both
                               watermarks = 0

Exact path: the destination's surviving `[0, end)` is the prefix both contexts shared before the
divergence (the only way `end` shrinks below `dst_end` is a rewind of the source along that same
prefix), so keeping it is correct; the `copy [src.watermark, end)` range then adds the missing part.
Untrimmable (hybrid) path: both watermarks zeroed → the copy re-commits `[0, end)` and the wholesale
recurrent state. The refuse remains the last line. With the catch-up in place the state is
unreachable through the governor's own API (CPU route keeps `dst <= src`, the handoffs keep the pair
equal), so it is armour for binding-side raw rewinds — the report's isolation sabotage (trim removed
→ EXIT=0) is honest, and the path has no test (declared).

## Other sequences — CONFIRMED

- **Alternating (GPU→CPU→GPU→CPU):** after a GPU turn the phase handoff (`:275-278`) syncs
  `ctx_decode = ctx_prefill`; after a CPU turn the catch-up does the same; `trim_sequence` keeps
  both sides equal on a rewind; scenario 3 (`gpu-prewarm-cpu-gpu-cpu-gpu`, `n_past=94`).
- **LOWBAT (no override):** the same route mechanics are state-driven (`prefill_engine()` LOWBAT →
  CPU); scenario 4 (`n_past=66`).
- **`clear_cache` between:** clears both memories and resets `prefill_state`/`decode_state`/route
  (`llama-governor-runtime.cpp:206-217`) → both ends 0, no catch-up/trim needed; the next prefill
  starts clean on any route.
- **Binding rewind (`n_past` below both ends, e.g. regenerate):** `rn-completion.cpp:680
  governor->trim_sequence(n_past)` rewinds **both** sides (exact → watermarks lowered; hybrid
  untrimmable → wholesale clear + watermarks 0), so the next switch's ends/watermarks are coherent
  and the positionless tail starts at the rewound frontier. Raw `seq_rm` of only the active context
  (`:636`) is covered by the `commit_side` trim on the next switch.
- **Reverse order (GPU prefill right after a CPU prefill, no decode):** unreachable — the route
  latch holds for the whole prefill phase (`llama-governor.cpp:246-251`), so a route change needs a
  decode/`clear_cache`/reset re-arm, and the Decode→Prefill handoff then carries the CPU turn's
  tokens to `ctx_prefill`. No gap mirroring hole A.

## Tests and byte-stats — CONFIRMED

- `test-governor-v0-route-switch` (4 scenarios) compares every step's greedy token against a
  single-context baseline and checks position continuity; the catch-up removal leaves `ctx_decode`
  empty so the position 1812 tail lands at 0 → the baseline mismatch is structural (the report's
  `greedy token mismatch at pos 53` red); the full revert reds all four.
- The engine test feeds **explicit positions** while the binding sends positionless tails
  (declared); with the catch-up the target's frontier equals the logical position, so both forms
  land identically — verified by reading the batch construction, not executed in the test.
- Turns fixture byte-stats unchanged: `commits=3 bytes=1720320 expected_bytes=1720320` ✓.
- Run set: build `-j 3` **0**; route-switch **0** (4/4); router **0**; turns **0**; hybrid **0**
  (not 77); `v0` / `v0-commit` / `v0-shared-cells` **0** each with `-m` (my first invocation without
  `-m` exited 1 = `error: --model is required`, a usage exit, not a regression); bench-route **0**
  (7), evidence **0** (2), setter **0** (2), latch **0** (3); binding guard jest **0** (6).
- Binding `c502a603`: `llama-governor.cpp` sha256-equal to engine `47f18811c`,
  `VERSIONS=47f18811c6d084772bbcaa94aff9cd036df5b9d3`, `src/version.ts` 11234/47f1881; 9 files
  (the one vendored source + version identity).

## Pre-existing / declared (not defects of this fix)

- The `commit_side` trim path has no test (unreachable post-fix; declared, isolation-sabotage quote).
- The app-side `KVPREFIX` accounting still *sums* across the two contexts (`tokensCached` 1942 vs
  engine `prompt_n` 92); with the engine invariant restored its single-context assumption holds,
  but this was not re-verified from the app side (declared).
- `cpu_route_handoff` still skips the CPU-route cross-context phase handoff — correct now, the
  catch-up covers the pre-switch direction; the pre-existing positionless-batch convention is
  unchanged.
- No device run; engine/binding branches not pushed by this audit.
