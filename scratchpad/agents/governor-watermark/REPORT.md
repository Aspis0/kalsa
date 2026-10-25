# REPORT — governor-watermark: the between-turn KV rewind invalidates the handoff

Engine **`290f577738daa8811f51d6deaab142323bc9bbba`** (kalsallama-wt-oom,
`kalsa-opencl-upload-oom-throw`, on e6200cc02; local, NOT pushed). Binding
**`fd36f610`** (vendor bump) + **`b395de13`** (call site) (`kalsarn-governor-engine`,
on d0a4a934; local, NOT pushed). Production evidence:
`../governor-nofit/raw/B2-logcat-live.txt` 22:42:46 (`KALSA_NATIVE error commit_side:
decode-to-prefill watermark is invalid` → `KALSA_GOVERNOR_FALLBACK {stage:"route_reject",
reason:"route Reject during phase handoff"}` → `nextToken:1687 failed to eval`).

## 1. Mechanism (proven, not assumed)

Engine: `commit_side` fails when `sequence_end(src_ctx) < src.watermark`
(`src/llama-governor.cpp:92`); both watermarks are set to the source end by every
successful commit (`:118-119`), so they track the previous turn's full length. The
binding, between turns, rewinds the **active** context's KV for prefix reuse — raw,
behind the governor's back:

| site | what |
|---|---|
| `cpp/rn-completion.cpp:628-632` | `llama_get_memory(active_ctx())` + raw `llama_memory_seq_rm(kv, 0, n_past, -1)` — the main trim (turn 2 of the B2 log) |
| `cpp/rn-completion.cpp:630` | `llama_memory_clear(kv, false)` (mtp_draft_mem_shared) on the same memory |
| `cpp/rn-completion.cpp:344-366, :388-390` | checkpoint restore INTO `active_ctx()` + `seq_rm(kv, 0, k, -1)` (`recoverStateCheckpoint`) — the actual path in tonight's log (`KALSA_KVDIAG0` → `KALSA_KVREUSE checkpoint n_past=1826`) |
| `cpp/rn-completion.cpp:664-666` | `llama_memory_clear(kv, false); n_past = 0` (restore-miss fallback) |
| `cpp/rn-completion.cpp:1164`, `cpp/rn-slot.cpp:493/:658` | `rn_seq_rm(active_ctx(), seq_id, …)` — **non-zero draft/slot sequences**: seq-0 watermarks untouched, not the bug, left alone |
| `cpp/bmoe_stream.cpp:229/:310` | `llama_memory_clear` on the bmoe CPU lane's own context — no governor interplay (`grep governor` in the file: none) |
| context shift | none in the binding (only comments; `rn-completion.cpp:1226` notes shifting is disabled) |

Under the governor `active_ctx()` is the decode context (`rn-llama.cpp:657-659`), so
after the rewind its sequence ends below `decode_state.watermark` while the prefill
context keeps stale cells — exactly the log. **Host reproduction (CPU-only, fixture,
`tests/test-governor-v0-turns.cpp::run_raw_trim_breaks_handoff`)**: turn-1 prefill +
3 decodes, one raw `seq_rm` on the decode context to pos 8, turn-2 prefill → the run
prints the production pair verbatim — `commit_side: decode-to-prefill watermark is
invalid` / `fail: route Reject during phase handoff` — and the scenario pins that
bypass failure (`governor_raw_trim_breaks_handoff=PASS (bypass pinned)`, turns exit 0).

## 2. The fix

One public engine function (Marco's design, no self-healing): **`llama_governor_trim_sequence
(governor, p)`** — `llama-ext.h:404-417`, `llama-governor.h:23-33` (contract comment),
`llama-governor.cpp:151-164`, runtime wrapper `llama-governor-runtime.cpp`. It removes
`[p, end)` of sequence 0 on **both** contexts and lowers **both** watermarks to
`min(watermark, p)`. A side whose cells beyond `p` survive (`pos_max >= p`, hybrid
rollback window) **keeps** its watermark and the call returns false — lowering it there
would let the next commit copy stale cells; the handoff then rejects loudly instead.

Binding: `rn_governor::trim_sequence(p)` (`cpp/rn-governor.h:34-38`, `.cpp:64-66`) and
**one call site** — `cpp/rn-completion.cpp:668-677`, right after the KV block settles
`n_past` (covers the seq_rm path, the checkpoint-restore path and the clear-0 path; the
raw active-side ops stay, they feed `cache_remove_success` and are idempotent under the
trim). False (hybrid window) logs `KALSA_KVTRIM` as a warning. Multimodal branch not
routed: governor + mmproj is refused app-side (`LlamaService` gate), unreachable.

## 3. Red / green (exit codes)

| step | exit |
|---|---|
| mechanism scenario, current tree | run **0** with the live `watermark is invalid` / `route Reject` pair on stdout/stderr (the defect reproduced) |
| fix scenario before the API | build **1**: `error: use of undeclared identifier 'llama_governor_trim_sequence'` |
| fix scenario with the API | build **0**, turns run **0**: `governor_trim_keeps_handoff=PASS` (handoff + turn-2 decode succeed; first draft re-decoded pos 0 over reused KV and failed `llama_batch_allocr` — the reuse-shaped batch must start at the trim point, corrected) |
| sabotage (watermark lowering skipped) | turns **1**: `governor-trim: turn 2 failed, rc=-1 reason=route Reject during phase handoff`; restored **0** |
| engine full suite at `290f57773` | seven standing targets **0 0 77 77 0 0 0**, `test-alloc` **0** (17/17) |
| binding gates | lint **0**, typecheck **0**, jest **14 suites / 50 tests 0**, `governor_params_test` **0** (5/5), `make rnllama_tests` **0 errors** (first compile missed the `rn-governor.h` include in `rn-completion.cpp` — incomplete type, caught by the native gate, fixed) |

## 4. Vendor bump and byte identity

`fd36f610`: sync with `LLAMA_CPP_REF=290f57773…` (cache seeded by a local fetch, no
remote contact), sync1 **1** (known lib/ assert) → `npm run build` **0** → sync2 **0**,
`assert-kalsa-vendor` **0**, `assert-rnllama-sources` **0**, declaration drift reverted
(plus the new `nativeSourceGuards.test.d.ts` emit removed). `src/version.ts`
11212/56f79e6 → **11215/290f577**. Engine delta `56f79e6cb..290f57773` over the vendored
subtree = exactly `llama-governor.h/.cpp`, `llama-ext.h`, `llama-governor-runtime.cpp`
(+ the engine test file, outside the export); per-file `cmp` engine@290f57773 vs vendored:
**rc=0 ×4**.

## 5. Not verified

- No device run: the production repro (S23, governor lane FIT) is not re-run; the host
  reproduction is CPU-only with the tinyllamas fixture. The `KALSA_KVTRIM` warning and
  the fixed turn flow need the next phone session.
- The app-side turn driver was not inspected this round (read-only scope was the
  binding's KV calls); nothing in the app needed to change for the fix.
- Non-kalsa lanes (parallel/slots, bmoe) were declared unreachable for the governor
  path by code read, not by test.
- The vendored bytes are reproducible only after the engine commit is pushed (delivery
  chain, Marco's call); the app pin (`kalsa/package.json:49`) is untouched.

## Round 2 (2026-09-24, audit NO: hybrid redesign)

Engine **`33cc1d2463f544a21b831e5a4dd0439e59d2eb3d`** (on 290f57773; local, NOT pushed).
Binding **`a26317e5`** (vendor bump, byte-identical, `src/version.ts` 11216/33cc1d2) +
**`a006e773`** (the two false comments corrected). Models verified on this Mac:
`LFM2.5-1.2B-Instruct-QAD-Q4_0.gguf` (695,755,488 B) and
`mac/LFM2.5-2.6B-QAD-Q4_0.gguf` (1,593,894,944 B), both hybrid.

### 1. Red first, on hybrid (final scenario, old engine)

New scenario `run_rewind` in `tests/test-governor-v0-hybrid.cpp` (three turns, faithful
to the binding: turn A ingests p tokens and a frontier checkpoint is captured with
`llama_state_seq_get/set_data_ext(..., PARTIAL_ONLY)`; turn B prefills a longer prompt
sharing p; turn C restores the checkpoint into the decode side and trims through the
governor; the oracle is a FRESH context fed the same tokens). Red on `290f57773`,
1.2B: **exit 1** — `turn C decode failed (trim_ok=0)`, the prefill side holding
`X = 15` vs batch `Y = 12`; same on the 2.6B. Oracle note, disclosed: the first draft
compared against a RESTORED context — its attention cache still physically held the
rewound cells, so its own tail decode double-attended duplicates and produced a false
`max_abs_diff=5.663` even with the fix; the fresh-context oracle replaced it.

### 2. The redesign (as ordered)

`trim_sequence` (`src/llama-governor.cpp`): try exact `seq_rm(0, p, -1)` per side; if
every side landed at `pos_max < p`, both watermarks become `min(watermark, p)` (the
cheap attention-only path). If any side is untrimmable (hybrid recurrent rollback
window), clear that side's whole sequence (`seq_rm(0, -1, -1)`) and set BOTH
watermarks to 0 — the next handoff re-commits `[0, end)` attention cells plus the
wholesale recurrent state (`llama-hybrid-commit.cpp:63-72`) from the rewound side.
`commit_side` additionally rejects any destination holding cells beyond the source
end (`llama-governor.cpp:96-103`) — no path can adopt stale cells silently anymore;
false from `trim_sequence` now means only "even the full clear failed".

### 3. Green (exit codes, no 77 on the scenarios that matter)

| run | exit | detail |
|---|---|---|
| hybrid 1.2B (`KALSA_HYBRID_GGUF=...1.2B...`) | **0** | `governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00` — bitwise-correct logits |
| hybrid 2.6B | **0** | same, `max_abs_diff=0.000e+00` |
| hybrid 2.6B, `KALSA_HYBRID_REWIND_TOKENS=1800` | **0** | cost below |
| stories15M turns | **0** | `governor_trim_keeps_handoff=PASS`, `governor_raw_trim_breaks_handoff=PASS (bypass pinned)`, full suite PASS |
| full engine suite | **0 0 0 0 0 77 0** | v0/commit/shared-cells/turns/router/hybrid(=0 above)/alloc; devices=77 = the standing no-GPU skip |
| sabotage (round-1 keep-watermark restored) | **1** | `WRONG STATE trim_ok=1 max_abs_diff=6.950e+00 commit_bytes=0` — the audit's silent-stale mode, caught (no commit at all); restored → 0 |

### 4. Cost of the full recommit, 2.6B, p=1800

`governor_hybrid_rewind p=1800 trim_ok=1 max_abs_diff=0.000e+00 commit_bytes=29851648
commit_us=3421` — **28.5 MiB and 3.4 ms per rewound turn** on host CPU (4 threads;
the whole three-turn scenario ran 32.6 s wall). That is the price of correctness on
hybrid; the attention-only path keeps the cheap `min(w, p)` trim.

### 5. Not verified

- No device run; the 3.4 ms host figure is not the phone's Adreno number (the commit
  is CPU-side copies, so it should transfer, but that is inference, not evidence).
- `run_raw_trim_breaks_handoff` (attention bypass pin) still encodes the
  attention-only reject; on hybrid the bypass now fails the batch-init position check
  instead (the red above shows that mode) — pinned by the red, not a separate
  hybrid scenario.
- The `KALSA_KVTRIM` warning now fires only on clear-failure; the phone session
  should still grep for `non-consecutive token position` (the stale-state signature)
  and expect none.

## Round 3 (2026-09-24, audit round-2 SHIP-WITH-FIXES)

Engine **`7af73d881dabb7769684381c0ab1ecdb699f2622`** (on 33cc1d246; local, NOT pushed).
Binding **`4f456234`** (vendor bump, `src/version.ts` 11217/7af73d8, byte-identical
`cmp` rc=0 on `llama-governor.{h,cpp}` — the round's only vendored engine files).

1. **Model-aware turns scenarios.** `run_raw_trim_breaks_handoff` now asserts per
   memory class: attention — the trim lands and the handoff rejects with `route
   Reject during phase handoff`; hybrid — the raw trim refuses silently (nothing
   mutates), the handoff passes, and the turn dies at `llama_decode` with the E1
   reason `llama_decode failed with rc=-1` (sticky). `run_governor_trim_keeps_handoff`
   on hybrid first restores a consistent `[0, 8)` state into the decode side from a
   sibling capture context (the binding's checkpoint shape — the live side at `[0, 19)`
   is itself untrimmable), then trims; attention keeps the exact-trim shape. The stale
   round-1 comment is replaced with the round-2 semantics.
2. **KV commit latch (Q4).** `commit_side` wraps `llama_kv_commit_with_stats` in a
   try/catch: the OpenCL `set_tensor` throw (86f602f8a) on device OOM becomes
   `fail("KV commit failed: <e.what() truncated at 80>")` (reason buffer 48 → 128 B);
   `decode_impl` no longer overwrites an already-latched reason with the generic
   route Reject. Surface: sticky failed + `-1` → JSI `"Governor decode failed: KV
   commit failed: …"` → the app's prefix-keyed runtime fallback. **Untested at
   runtime, stated plainly:** the throw exists only in the device `set_tensor` path;
   producing it on host would need a mock backend that nobody else constructs.
3. **`rewind_to` now returns and asserts the binding-shaped trim** at turns B and C;
   the idempotent third call is gone; `trim_ok` printed for turn C is that call's
   result.

Runs (all with `KALSA_HYBRID_GGUF=` the 2.6B): hybrid **0** (`trim_ok=1
max_abs_diff=0.000e+00`), v0/commit/shared-cells/turns **0**, router **0**, devices
**77** (standing no-GPU skip), mtp-hybrid **77** (no MTP layers), alloc **0**; and
`test-governor-v0-turns -m stories15M` **0**, `-m` 2.6B **0** (both bypass pins
model-tagged in the output). Disclosed stumble: after the header's buffer resize the
router binary was stale and SIGABRT'd at teardown (both PASS markers printed first);
rebuilding it fixed the run — a stale-ABI artifact, not a code defect. Binding gates:
lint **0**, typecheck **0**, jest **14 suites / 50 tests 0**, `governor_params_test`
5/5, `rnllama_tests` builds 0 errors.

## Round 4 (2026-09-24, audit round-3 one-liner)

Engine **`9875acabef87af4eeeb17dc5577c352d26d3aa0d`** (on 7af73d881; local, NOT pushed).
Binding **`f8e3a748`** (vendor bump). `trim_sequence` now opens with
`if (failed) return false;` — the binding calls it from `loadPrompt` before any
`governorFailed()` check, and a retry after a latched commit failure must not `seq_rm`
a half-copied side. Pinned by `run_trim_refuses_when_failed` (latch via the
out-of-vocab token, snapshot both memories' `pos_max`, trim must return false and
mutate nothing); sabotage (guard removed) → turns **exit 1** `trim succeeded on a
failed governor`; restored green. Runs: turns 2.6B **0** (all three rewind pins PASS),
turns stories15M **0**, hybrid 2.6B **0** (`trim_ok=1 max_abs_diff=0.000e+00`).
Binding: vendor bump byte-identical (`cmp` rc=0 on `llama-governor.cpp`),
`src/version.ts` 11218/9875aca; lint **0**, typecheck **0**, jest **14/50 0**,
native build **0**, `governor_params_test` **0**.
