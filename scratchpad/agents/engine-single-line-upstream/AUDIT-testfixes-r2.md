# Hostile audit r2 — the five post-audit commits (`24a94ce15 … e775fb2bf`)

Target: `Aspis0/kalsallama` @ `e775fb2bf` (`git diff 4d89cc436 e775fb2bf`).
Answers `AUDIT-testfixes.md` P1-A..F, P2-A..H, P3-A..F, P4-E and `AUDIT-stepB.md` I3.

Read-only on `~/Projects/kalsallama`. All builds/runs in a throwaway
`git worktree add /tmp/kalsa-audit-r2 e775fb2bf`, **deleted** at the end
(`git worktree list` no longer lists it; the repo shows only the pre-existing
untracked `CMakeUserPresets.json`). No delegation, no sub-agents. English only.

Metal host, Release, `-DGGML_METAL=ON -DLLAMA_BUILD_TESTS=ON`.
Fixtures: `KALSA_HYBRID_GGUF=~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`,
`KALSA_MIRROR_GGUF=~/kalsa-models/test/gemma-3-270m-it-Q8_0.gguf`,
`KALSA_GEMMA4_TARGET_GGUF=~/lab/spec/dl/gemma-4-12B-it-Q8_0.gguf`,
`KALSA_GEMMA4_DRAFT_GGUF=~/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf`.
(The env names are the ones the new test reads — `KALSA_GEMMA4_TARGET_GGUF` /
`KALSA_GEMMA4_DRAFT_GGUF`, `tests/test-governor-v0-draft-alias.cpp:359-360`.)

---

## VERDICT: **FIX FIRST** — one item

| commit | verdict | one line |
|---|---|---|
| `afbb4b971` tests | **FIX FIRST** | Everything structural in it is right, but the new test's numeric floor is calibrated with **zero margin on 4 samples** and I measured a *working* drafter failing it on **3 of 6 natural prompts**. That red is one bad afternoon away from being "fixed" by raising the floor to 1. |
| `24a94ce15` devices | **SHIP with one fix** | The route forcing is the right fix and the negative control works (I re-ran it: EXIT=1). One residual vacuity is now *always* active: the token oracle is disabled by the forced route (V3). |
| `5ab6eddbc` F5 | **SHIP** | The warning text is true now for every reachable case. |
| `543e77985` F4 | **SHIP** | Citation is off by one line (nit). |
| `e775fb2bf` I3 | **SHIP** | Include restored, builds, corrects the step-B report. |

---

# 1. `test-governor-v0-draft-alias.cpp` (NEW, 370 lines) — the headline

## D1 — **CONFIRMED (blocker)** — the floor `2/4` is a property of one hard-coded prompt, not of "reads the target's K/V"

`tests/test-governor-v0-draft-alias.cpp:42-47`

```cpp
constexpr int k_steps = 4;
// Floor for this prompt: a garbage view samples near-random vocab ids, which
// never track the target's argmax, so anything at or above half the
// comparisons proves the view reads the target's K/V. Calibrated on the real
// pair - see the draft_alias_agree= line before touching this constant.
constexpr int k_min_agree = 2;
```

`:343` `if (agree < k_min_agree) {`

I ran the identical harness on **six** prompts with the real pair and **intact**
K/V (each run ~25 s; same build, same fixtures, only the prompt string changes):

| prompt | `agree` (of 4) | floor 2 |
|---|---|---|
| `The capital of France is Paris, and the capital of Italy is` (the committed one) | 2/4 | pass |
| `Once upon a time in a small village by the sea there lived` | **1/4** | **FAIL** |
| `The quick brown fox jumps over the lazy dog. The quick brown fox` | 4/4 | pass |
| `In 1969 humans first landed on the Moon, an achievement that` | **1/4** | **FAIL** |
| `Hi there` | 3/4 | pass |
| `Red green blue` | **1/4** | **FAIL** |

And more steps does not help — same failing prompt, `k_steps=8`:

```
AUDIT agree=3/8 target_rank_of_proposal=2,1,56,10,16,125,1,1
```

The second sentence of the WHY ("anything at or above half the comparisons
proves the view reads the target's K/V") is **refuted by measurement**: a real,
fully-aliased drafter agrees on 25–37 % of tokens, not ≥ 50 %. The committed
prompt happens to be one of the three that pass. `k_min_agree = 2` has an
observed value of exactly 2 — one event of margin, on a sample of 4.

**Failure scenario.** Nobody has to break anything. Change the quantization of
the MTP head, the thread count, the llama.cpp build, or simply the prompt
constant, get `agree=1`, and the natural response is to lower `k_min_agree` to 1
("it's flaky"). At floor 1 the empty-K/V case still measured 0/4 here — but it
produced a rank-23 proposal once, i.e. a top-1 collision on one of four steps is
a live possibility. Lowering the floor destroys the last margin on a test whose
whole purpose is a margin.

## D2 — **CONFIRMED (the structural half is sound)** — pointer equality really pins the mapping

`tests/test-governor-v0-draft-alias.cpp:129-148` (`count_aliased`), `:217`
`if (layers == 0 || aliased != layers)`.

Three falsifications, all in the scratch worktree, all **fail the test**:

| falsification | result |
|---|---|
| `share` returns `-1` for every drafter layer (no aliasing at all — the drafter gets its own, never-written tensors) | `rc=1` — `draft-alias: 0 of 4 drafter layers alias the target's K/V - share wiring broken, or the draft is not a gemma4-assistant model` |
| SWA drafter layers mapped to an *earlier valid* target SWA layer (`n_layer_other - 4`) | `rc=1` — `draft-alias: 1 of 4 drafter layers alias the target's K/V …` |
| every drafter layer mapped to `n_layer_other - 1` | `rc=1` — `llama_init_from_model: failed to initialize the context: cannot share KV cells: layer 47 is not in the source cache` + `draft-alias: the draft context was refused` |

Could it pass on a wrong mapping? **No** — every drafter layer is compared
against the *one* mapped target layer, so a mixed or off-by-one mapping lands
between 1 and 3 of 4. The mapping it pins, measured:

```
llama_kv_cache: layer   3: sharing with layer 47. k = …, v = …
llama_kv_cache: layer   0: sharing with layer 46.
llama_kv_cache: layer   1: sharing with layer 46.
llama_kv_cache: layer   2: sharing with layer 46.
AUDIT layers=4 aliased=4 n_layer_t=48 dft_n_layer=0 dft_n_nextn=4
```

The draft model has `n_layer=0` + 4 nextn layers: 3 SWA → target layer 46
(`n_layer_t-2`, the SWA leaf), 1 full → target layer 47 (`n_layer_t-1`, the base
leaf). That matches `src/llama-model.cpp:2882-2890` exactly.

**PLAUSIBLE note (scope, not a defect).** The test re-derives the *same
arithmetic* as the production lambda (`n_layer_t - 1` / `n_layer_t - 2`,
`:210-211`), so it pins current wiring, not semantic correctness — nothing
asserts that layer 46 *should* be the drafter's SWA source. Worse, the lambda's
assumption ("the target's second-to-last layer is the last SWA layer") is
unenforced anywhere: a target whose last two layers are both full-attention makes
the SWA branch throw `layer N is not in the source cache` at context
construction. One `llama_kv_context_...`-free assertion (`is_swa(n_layer_t-2)`)
would make that a diagnostic instead of a load failure.

## D3 — **CONFIRMED** — the agreement is *caused* by the aliased K/V, not by the hidden-state channel

Same aliasing, **data zeroed** behind the alias (the four tensors the drafter
reads: base k/v of target layer 47, swa k/v of layer 46), which is literally
"a drafter decoding on EMPTY K/V", with the alias gate bypassed so the numeric
check is reached:

```
AUDIT zeroed target layer tensor 0x…, 262144 bytes, type=f16     (x2, base)
AUDIT zeroed target layer tensor 0x…, 1048576 bytes, type=f16    (x2, swa)
AUDIT agree=0/4 target_rank_of_proposal=2262,35505,215062,139799
AUDIT proposals=1037 89921 189440 192671
AUDIT expected =236761 107 100 45518
AUDIT mean_rank_of_proposal=98157.0 …
AUDIT VERDICT: floor=2 -> test would fail
```

So the numeric half is not decorative: with real data 2/4, with zeros 0/4.

## D4 — the metric that separates real from garbage, with margin (measured)

Same harness, 6 real prompts vs 4 empty-K/V prompts. Three candidate statistics:

| statistic | real K/V (6 prompts) | empty K/V (4 prompts) | separation |
|---|---|---|---|
| top-1 agreement over 4 steps | 1 … 4 (**min 1**) | 0, 0, 0, 0 | **fails** — real dips below any useful floor |
| **mean rank of the proposal under the target's logits** | 1.0, 3.5, 7.5, 17.2, 26.5, 50.8, 132.2 → **max 132** | 64773, 98157, 104261, 105257 → **min 6.5e4** | **~490× margin.** floor `mean_rank <= 1000` |
| **mean reciprocal rank of the *target's* token under the *drafter's* logits** | 0.25 … 1.00 → **min 0.25** | **0.0000** on all four | clean. floor `>= 0.10` |
| mean logit cosine | 0.7616 … 0.9336 | 0.2984 … **0.7309** | **only 0.03** — do not use alone |

Concrete recommendation:

1. Replace the `k_min_agree` count with **`mean rank of the proposal <= 1000`**
   (already computed — the `ranks` string at `:331-338` is per-step; average it)
   and/or **`mean reciprocal rank of the target's token in the drafter's
   distribution >= 0.10`** (needs one extra `llama_get_logits_ith(ctx_d, -1)`
   read per step; both logit vectors are already in memory).
2. Raise `k_steps` to 8–12 for a tighter estimate — but **only together with a
   rate-based floor**, never with the current absolute-count floor.
3. Keep `draft_alias_aliased_layers` as the hard gate (D2) and demote the
   numeric line to a *smell detector*: it is a 4-token, one-prompt sample of a
   distribution, not a pass/fail oracle.

The extra cost is one vocab-sized buffer (262144 floats × steps).

## D5 — **CONFIRMED (minor)** — missing vocab precondition → out-of-bounds read on the target's logits

`:237` `const int32_t n_vocab = llama_vocab_n_tokens(llama_model_get_vocab(model_t.get()));`
`:332` `rank += logits[i] > logits[proposals[step]] ? 1 : 0;`

`proposals[step]` comes from the **drafter's** sampler (`ctx_d`), but it indexes
the **target's** logits buffer. The test checks the hidden-state widths
(`:197 n_embd_h_t != n_embd_h_d`) and never the vocabularies. Both committed
fixtures are 262144 (measured: `AUDIT n_vocab_target=262144 n_vocab_draft=262144`),
so it is safe today.

**Failure scenario.** An operator points `KALSA_GEMMA4_DRAFT_GGUF` at any MTP
model with a different vocabulary (or a partial/merged one) — the env var is the
only thing validating the pair — and the rank loop reads past the target's
`logits` allocation. Add one line: `if (llama_vocab_n_tokens(vocab_d) != n_vocab) → fail`.

## D6 — **CONFIRMED (minor)** — a null logits row prints `rank=1`, i.e. a *better*-looking diagnostic

`:331` `for (int32_t i = 0; i < n_vocab && logits; ++i) {` — with
`llama_get_logits_ith` returning `nullptr` the loop never runs, `rank` stays 1
and the printed line becomes `draft_alias_target_rank_of_proposal=1,1,1,1`,
which reads as a perfect drafter. `agree` is unaffected (it comes from
`got != proposals[step]`), so this cannot fake a pass — but it is the one output
line an operator triages on. Guard the loop and report `rank=?` instead.

## D7 — **PLAUSIBLE (minor)** — cell sharing is never asserted; the regression it would miss crashes instead

Layer aliasing (`if (share && other)`, `src/llama-kv-cache.cpp:211`) and cell
sharing (`v_cells_impl(other ? other->v_cells_impl : …)`, `src/llama-kv-cache.cpp:90`)
are **two different consequences of `mem_other`**. The test asserts only the
first; the second is covered only indirectly, by the numbers. Falsified by
breaking the init-list line alone (layers still aliased):

```
$ ./test-governor-v0-draft-alias   →  Segmentation fault 11   (rc=139)
$ ./test-audit-falsify            →  Segmentation fault 11
```

So it is **not** a silent-pass hole (REFUTED as vacuous-pass), but the failure
mode is a crash with zero diagnostics, and the invariant is worth one line:
`llama_memory_seq_pos_max(llama_get_memory(ctx_d), 0) == pos_dft - 1` after the
rollback.

## D8 — **REFUTED** — the `h_seed` pointer is *not* stale (looked like a use-after-decode)

`h_seed` is taken at `:239` and used after **four more target decodes**
(`:247-259`) and a `seq_rm`. `llama_get_embeddings_nextn_ith` returns a pointer
into `embd_nextn.data` (`src/llama-context.cpp:1013-1035`), which is rewritten
per decode at `offset = n_tokens_prev` (`:2035-2046`). Measured staleness:

```
AUDIT prompt_tokens=14 h_seed_row_index=13
AUDIT h_seed_staleness maxabs(now[saved_index]-saved)=0.000000
AUDIT prompt_tokens=4  h_seed_row_index=3
AUDIT h_seed_staleness maxabs(now[saved_index]-saved)=0.000000
```

Safe because each reference decode is a **single-token** batch (writes row 0
only) and the guard `:227 tokens.size() < 4` keeps the seed index ≥ 3. Latent
only if the prompt guard is relaxed or the reference pass becomes multi-token.
Verified, not assumed.

## D9 — **CONFIRMED (coverage)** — the new test is a permanent `77` in every automated run

```
$ grep -rn "KALSA_GEMMA4" ~/Projects/kalsallama ~/Projects/kalsa-moe-experiments ~/lab
./tests/test-governor-v0-draft-alias.cpp:19,359,360
./tests/CMakeLists.txt:337
(zero hits anywhere else — no .sh, no CI, no report)
```

Nothing exports the pair, so:

```
$ env -u KALSA_GEMMA4_TARGET_GGUF -u KALSA_GEMMA4_DRAFT_GGUF ./test-governor-v0-draft-alias
draft-alias: SKIP KALSA_GEMMA4_TARGET_GGUF / KALSA_GEMMA4_DRAFT_GGUF is unset (exit 77)
```

Same for `KALSA_HYBRID_GGUF`/`KALSA_MIRROR_GGUF` (pre-existing pattern). The
CMake comment is honest; the **commit message is not** — it advertises "4/4
aliased layers, greedy agreement floor" with no mention that no battery in
either repo runs it. That is the `AUDIT-testfixes` P2-H pattern repeating on the
commit that was supposed to close it. Fix: export the pair in whatever battery
the coordinator runs, and say so in the commit body.

## D10 — clean code — 370 lines for a NEW file, two responsibilities

- **D10a** `wc -l tests/test-governor-v0-draft-alias.cpp` → **370** (> the ~350
  rule for new files). One responsibility? No: it is (a) fixture/context
  construction, (b) the **structural** alias gate — deterministic, zero tuning,
  the part that must never be weakened, and (c) a **calibrated** numeric gate
  over a hard-coded prompt. (b) and (c) in one TU is exactly the arrangement that
  invites "raise the floor until green". Split the gate out (≈330 lines, prompt
  and threshold gone) and the risk disappears structurally.
- **D10b** wrong family name: the file is `test-governor-*` but touches **no**
  `llama_governor_*` API. It is an MTP-drafter test → `test-mtp-draft-alias.cpp`.
- **D10c** *(refuted as a nit I raised myself)* `#include "llama-ext.h"` is
  **used** — removing it gives 4 errors: `use of undeclared identifier
  'llama_set_embeddings_nextn'` / `'llama_get_embeddings_nextn_ith'`. Keep.
- **D10d** duplication: `log_errors`, `model_ptr`, `load_model`, `sampler_ptr`,
  `decode_one` are copy-pasted across the three governor tests. Precedent for a
  shared header already exists: `tests/governor-bench-route-harness.h`.

## D11 — **CONFIRMED (claims check out)** — the header comment's protocol claim is true

`:24-30` "The draft follows the shared-memory protocol of common/speculative's
draft_mtp (is_mem_shared) … every draft token decoded at the one position the
shared store has not reached yet". Verified against the app:

`common/speculative.cpp:1697-1702`

```cpp
} else if (is_mem_shared) {
    // note: with shared memory (e.g. Gemma4 assistants) we use the same position for all draft tokens
    const int32_t idx = batch.add(id, dp.pos0, seq_id, true);
    batch.set_embd(idx, { h_row, 1, (size_t) n_embd });
```

Identical shape to `draft_step` (`:151-171`). And
`llama_process(LLAMA_PROCESS_TYPE_DECODE, …)` is literally `ctx->decode(*batch)`
(`src/llama-context.cpp`, the `llama_process` switch) — same path, so the mixed
`llama_process` / `llama_decode` usage in one file is harmless.

One deviation: the app sizes the h row by `llama_model_n_embd_out(ctx_dft)`
(`common/speculative.cpp:1375`), the test by `llama_model_n_embd_inp(model_d)`
(`:196`). Equal for this pair, different contract.

## D12 — teacher forcing (documented, but it caps what the number means)

`:280-282` "The token chain is the target's reference (teacher-forced, unlike the
app which chains its own proposals)". Honest and correct — and it means the
measured agreement is an **upper bound** on the app's acceptance rate. Calibrating
a pass/fail floor on an upper bound of a different quantity is what produced D1.

---

# 2. `test-governor-v0-devices.cpp` — route forced

## V1 — **CONFIRMED** — negative control re-verified by me

Scratch worktree, `governor_params.bench_force_gpu_prefill = false` (the P1-C
lines removed):

```
$ ./test-governor-v0-devices -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
governor-devices: prefill route regressed: prefill_engine=0 want GPU=1 - staged/naive selection untested
rc=1
```

The **first** precondition fires (`:250`) before the counter one and names the
cause. This is the P1-D shape and it works.

## V2 — **CONFIRMED** — P1-A closed, P1-C/P1-B closed

```
$ ./test-governor-v0-devices -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
governor_v0_devices_stats prefill_reused=9 decode_reused=18 prefill_splits=2 decode_splits=1 \
  commits=3 naive=1 staged=2 k_transfers=48 v_naive_transfers=8192 v_staged_transfers=8208 \
  bytes=1720320 us=8172
governor_v0_devices=PASS turns=3 generated=6      rc=0
```

Counters identical to the audit's Variant A. The `commit_count == 0 → 77` branch
is gone; the only remaining `77` is the genuine environment skip at `:320-325`
(`no GPU backend available`). The P1-B wrong-cause WHY is replaced by the right
one (`:165-170`, names `gpu_fit`/the CPU latch, not staged V). ✔

## V3 — **PLAUSIBLE (major)** — the forced route switches the token oracle off, and that is now permanent

`:220` `const bool strict_oracle = !llama_kv_context_has_non_host_v(prefill_ctx);`
and `:90-105`:

```cpp
    const float max_diff = logits_max_abs_diff(got_ctx, expected_ctx);
    if (strict || exact_seen < k_exact_prefix) {
        std::fprintf(stderr, "governor-devices: token mismatch at position %d …\n", …);
        return false;
    }
    std::fprintf(stderr, "governor-devices: tolerated cross-backend divergence position=%d …\n", position, max_diff);
```

Forcing the GPU route means V is device-resident → `strict_oracle == false` →
only the first `k_exact_prefix = 2` of **18** sampled tokens are hard-asserted;
the other 16 may diverge and the test still prints `governor_v0_devices=PASS`.
Nothing counts tolerated divergences. On this host none occurred (no
`tolerated` line in the output above), so it is not an active false pass — but
on Adreno/HTP, where arithmetic is least identical, this is the configuration
the test now always runs in.

**Failure scenario.** A real cross-backend numeric regression on the phone is
absorbed as 16 "tolerated" lines and the battery goes green. Fix (4 lines):
count the tolerated divergences and fail above a small bound, or require the
whole first turn to be exact.

## V4 — **PLAUSIBLE (minor, new risk created by this commit)** — `77 → 1` is now unconditional

`:320` `auto gpu = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU);`
returns the first GPU-typed device. Per `AUDIT-stepB` I1, on the S23 **both**
`ggml_opencl` and `ggml_hexagon` register as `GGML_BACKEND_DEVICE_TYPE_GPU`.
If it returns the HTP device, `load_model(path, gpu, 99)` (`:162`) puts 99 layers
on the NPU, the governor's NPU lane is off by default → prefill lands on CPU →
`:250` returns 1. That is the *intended* direction (the skip used to hide exactly
this), but it should be a **ticket for the phone run**, not discovered there. The
`SKIP_RETURN_CODE 77` on the CMake target now only covers "no GPU at all".

## V5 — **REFUTED** — no other vacuous pass

`prefill_engine == GPU`, `commit_count > 0`, `commit_staged_count > 0 &&
commit_naive_count > 0 && commit_us > 0` (`:260`), plus the pre-loop
`llama_kv_route_query(...) == MirrorAndCopy` and
`llama_kv_context_has_non_host_v(prefill_ctx)` (`:196-201`) are all real and
unreachable by a policy lie. The forced params decide the *route*, not the
counters.

## V6 — **PLAUSIBLE (scope note)** — the default admission path now has no test anywhere

`gpu_fit` is hard-set to `Fit` (`:169`). The `Unknown` default — i.e. the actual
auto-fit decision a production run makes — is now permanently untested: on this
host it deterministically yields CPU + `commit_count == 0`. The commit message
is truthful ("forces the GPU prefill route"), but record the gap.

---

# 3. `test-governor-v0-shared-cells.cpp` — cells-only half

## S1 — **CONFIRMED (P2-D closed)** — the class assertion is real

`:368-374`

```cpp
    if ((kind == memory_kind::hybrid) != expect_hybrid) {
        std::fprintf(stderr, "shared-cells: %s must load a %s fixture, got %s - wrong contract, failing\n", …);
```

Falsified by pointing the mirror slot at the hybrid fixture:

```
$ KALSA_HYBRID_GGUF=<LFM2.5> KALSA_MIRROR_GGUF=<LFM2.5> ./test-governor-v0-shared-cells
shared-cells: KALSA_MIRROR_GGUF must load a non-hybrid (iSWA or plain) fixture, got llama_memory_hybrid - wrong contract, failing
rc=1
```

## S2 — **CONFIRMED (P2-C closed)** — the state guard is falsifiable

`:295-315`: the block now runs **before** the owner's `seq_rm`, asserts
`pos_live == expected_pos + 1` (so the owner really holds cells), and adds
`n_state_view == 0 || n_state_view >= n_state_owner` → fail. A `state_write` that
wiped the shared cells now trips `llama_memory_seq_pos_max(mem_a, 0) != pos_live`.
Both previous holes are gone. The P2-G wiring fix (`:331-334`: no `-m`, no
`FIXTURES_REQUIRED`, `SKIP_RETURN_CODE 77` kept) is correct, and matches the
`test-governor-v0-hybrid` precedent.

## S3 — **PLAUSIBLE (minor, new)** — `aliased != 0` is satisfied by an *empty* comparison

`:386-402`

```cpp
        for (const uint32_t il : owner_ids) {
            if (std::find(view_ids.begin(), view_ids.end(), il) == view_ids.end()) {
                continue;
            }
```

The check counts **matches**, never **comparisons**. Today both contexts come
from `make_context()` with identical params (`is_swa` filters identical) → the
intersection is non-empty → `shared_cells_aliased_tensors=0` means something. But
a future view built with a different `ctx_type` (e.g. `MTP`, whose filter is
`il >= hparams.n_layer()`, `src/llama-model.cpp:2868`) empties the intersection
and the assertion passes without comparing a single tensor. The sibling file
**does** have this guard — `tests/test-governor-v0-draft-alias.cpp:217`
`if (layers == 0 || aliased != layers)` — so the two new checks are
inconsistent. Fix: count comparisons, fail on 0, print the count.

## S4 — **CONFIRMED (P2-B resolved in substance)** — the cells-only half no longer overclaims

The PASS lines were renamed to what they measure
(`shared_cells_cellshare_decode`, `shared_cells_cellshare_clear`,
`shared_cells_cellshare_seq_rm`, `shared_cells_state_source_only`), the header
comment (`:208-214`) states the view owns its K/V and places nothing, and
`shared_cells_aliased_tensors=0` is both printed and enforced. Residual nit: the
only evidence for `cellshare_decode` is that `decode_one(ctx_b, …)` returns
true (`:225`, `:252`) — the line still contains the word "decode", which invites
the old reading. Acceptable.

## S5 — **note** — the `llama_kv_cache` branch stays dead with the documented fixture

`memory_kind::plain` is unreachable with `gemma-3-270m` (loads
`llama_kv_cache_iswa`, printed as `shared_cells_memory=llama_kv_cache_iswa`).
Now documented in the code (`:466-468`), so it is honest — but the
`KALSA_MIRROR_GGUF` name still implies "plain KV" coverage.

## S6 — `get_v_storage` — a test-only accessor on a production class

Declared `src/llama-kv-cache.h:176`, defined `src/llama-kv-cache.cpp:1318`:

```cpp
ggml_tensor * llama_kv_cache::get_v_storage(int32_t il) const {
    const int32_t ikv = map_layer_ids.at(il);
    return layers[ikv].v;
}
```

Callers, tree-wide (excluding `build/`): **`tests/test-governor-v0-draft-alias.cpp:137,145`** and
**`tests/test-governor-v0-shared-cells.cpp:395,396`** — zero production users.
The neighbour `get_k_storage` *is* production
(`src/llama-kv-cache-dsv4.cpp:360,410,1742`, `src/llama-memory-hybrid-idx.cpp:963,969`),
so this is the first accessor added purely for tests.

**Verdict: PLAUSIBLE-minor, not a blocker**, for two reasons I checked rather
than assumed: (i) `src/llama-kv-cache.h` is an *internal* header — the published
C ABI (`include/llama.h`) is untouched, and the fork's own precedent
(`governor_*.h`, `llama_kv_context_attn_cache`) is exactly this kind of internal
test surface; (ii) five lines is the minimum that makes the V half of the
assertion possible — comparing K only would leave the "drafter aliases both K and
V" claim unproven. Recommendation: mark it
(`// used only by tests/test-governor-v0-{draft-alias,shared-cells}.cpp`) so the
next reader does not hunt for the production caller, and consider folding it into
the existing `get_k_storage` as `get_storage(il, which)` if a third caller ever
appears.

---

# 4. F5 / F4 / I3 — one-line commits

## F5 — **CONFIRMED, SHIP** — the warning text is true now

`src/llama-kv-cache.cpp:2141-2148` + the helper at `:2141-2145`:

```cpp
static std::string state_seq_scope(llama_seq_id seq_id) {
    return seq_id >= 0 ? format("seq_id=%d", seq_id) : std::string("all sequences");
}
…
        LLAMA_LOG_WARN("%s: shared view - skipping state write for %s; "
                       "the shared cells are covered by the source cache's state IO "
                       "(layer tensors are the source's when aliased)\n",
```

Checked against every reachable case: (i) for a KV/iSWA shared view the *cells*
really are the source's, so the source's `state_write` does cover them — true;
(ii) the "(layer tensors are the source's when aliased)" qualifier is exactly
right, replacing the refuted "its cells and layers are covered" claim; (iii) the
view's own unwritten rows are honestly not described as saved; (iv) the stale
comment above (`:2137-2139` in the old file) was rewritten in the same commit;
(v) `seq_id=-1` prints `all sequences`; (vi) the `%p` ASLR disclosure is gone;
(vii) for the **hybrid** class the leaf's warn is unreachable anyway —
`llama_memory_hybrid::state_write` throws on `shared` *before* delegating to
`mem_attn`, so the message cannot print next to a throw it does not describe.
No behaviour change, no test observes the text (P3-E stands) — but the text is
now true, which was the point.

## F4 — **CONFIRMED, SHIP with a nit** — the citation is off by one

`src/llama-governor.cpp:196`

```cpp
        // early return in llama-kv-cache.cpp:427), so a "true" there never means
```

`src/llama-kv-cache.cpp:427` is `// cells a second time to free nothing` — the
last line of the TODO comment. The guard is `:428` (`if (other) {`), the early
return is `:429` (`return true;`). P4-E asked for a line number; it should be 428.

## I3 — **CONFIRMED, SHIP** — the include is restored and the build is clean

`ggml/src/ggml-cpu/ggml-cpu.c:6` `#include "ggml-cpu.h"`, consumed by
`ggml_cpu_expert_ready_hook_t` at `:61`. The whole governor battery builds and
runs Release + Metal ON. Nit: it sits between `ggml-backend.h` and `traits.h`;
every public ggml header in that block is grouped above the private ones, so move
it up two lines to match the file's own convention.

---

# 5. Clean-code checklist

| item | verdict |
|---|---|
| `tests/test-governor-v0-draft-alias.cpp` = **370** lines, NEW (> ~350) | **split** the structural gate from the calibrated numeric gate (D10a); rename out of the `governor-*` family (D10b) |
| `tests/test-governor-v0-shared-cells.cpp` = **483** lines | **two responsibilities in one TU**: hybrid *fence refusal* vs cells-only *share*, selected at runtime by an env switch. Split into `…-shared-fence.cpp` / `…-cellshare.cpp`, one env var each, and `collect_shared_caches`/`memory_kind`/`expect_hybrid`/`kind_name`'s hybrid case all disappear. 483 → ~250 each |
| `tests/test-governor-v0-devices.cpp` = 329 | fine |
| duplication of `log_errors` / `model_ptr` / `load_model` / `sampler_ptr` / `decode_one` across the three | extract into a header; `tests/governor-bench-route-harness.h` is the precedent |
| `src/llama-kv-cache.h:176 get_v_storage` | keep, mark it test-only (S6) |

---

# 6. Governor battery (Metal host, Release, `e775fb2bf`, all four fixtures exported)

```
test-governor-v0                    rc=0
test-governor-v0-commit             rc=0
test-governor-v0-devices            rc=0    commits=3 naive=1 staged=2
test-governor-v0-hybrid             rc=0
test-governor-v0-shared-cells       rc=0
test-governor-v0-draft-alias        rc=0    aliased 4/4, agree=2/4, ranks 2,1,199,1
test-governor-v0-turns              rc=0
test-governor-v0-mtp-hybrid         rc=77   "model has no MTP layers" (pre-existing, I2)
test-governor-v02-router            rc=0
test-governor-platform-thermal      rc=0
test-governor-bench-route           rc=0
test-governor-bench-route-evidence  rc=0
test-governor-bench-route-setter    rc=0
test-governor-bench-route-latch     rc=0
test-governor-v0-route-switch       rc=0
```

`shared-cells` in full:

```
shared_cells_memory=llama_memory_hybrid ; shared_cells_size=256 ; next_slot=6 ; aliased_tensors=0
shared_cells_clear_fence=PASS  decode_fence=PASS  seq_rm_fence=PASS  negative_guards=PASS
shared_cells_memory=llama_kv_cache_iswa ; shared_cells_size=256 ; next_slot=6 ; aliased_tensors=0
shared_cells_cellshare_decode=PASS  cellshare_clear=PASS  owner_invariants=PASS
shared_cells_seq_noops=PASS  cellshare_seq_rm=PASS  state_source_only=PASS  negative_guards=PASS
```

Without the env fixtures: `shared-cells → 77`, `draft-alias → 77` (D9).

---

# 7. Findings index

| # | verdict | file:line | finding |
|---|---|---|---|
| **D1** | **CONFIRMED** | `tests/test-governor-v0-draft-alias.cpp:42-47`, `:343` | floor `2/4` has zero margin on n=4; a working drafter scores **1/4 on 3 of 6 prompts**, 3/8 at 8 steps. Blocker. |
| D2 | CONFIRMED | `:129-148`, `:217`, `src/llama-model.cpp:2882-2890` | pointer gate is real: 3 falsifications all `rc=1`. Maps 3 SWA→`n_layer_t-2`, 1 full→`n_layer_t-1`. |
| D3 | CONFIRMED | (falsification, `:331-338`) | zeroed aliased tensors → `agree=0/4`, mean rank 98157. The check does test the aliasing. |
| D4 | — | `:42-47`, `:331-338` | measured replacement metric: mean rank ≤ 1000 (real ≤ 132, empty ≥ 6.5e4) / MRR ≥ 0.10 (real ≥ 0.25, empty 0.0000). **cosine is not usable** (0.7616 vs 0.7309). |
| D5 | CONFIRMED | `:237`, `:332` | no vocab precondition; drafter token id indexes the target's logits → OOB on a mismatched pair (both fixtures are 262144 today). |
| D6 | CONFIRMED | `:331` | null logits ⇒ `rank=1` printed for every step (diagnostic lies in the passing direction). |
| D7 | PLAUSIBLE | `src/llama-kv-cache.cpp:90` vs `:211` | cell sharing never asserted; the falsification **segfaults** rather than failing cleanly. |
| D8 | REFUTED | `:227`, `:239` | `h_seed` staleness = 0.000000 (measured, incl. a 4-token prompt). |
| D9 | CONFIRMED | `tests/CMakeLists.txt:337`, `:359-360` | nothing exports `KALSA_GEMMA4_*`; the new test is 77 everywhere by default; commit message does not say so. |
| D10a | CONFIRMED | 370 lines | new file > 350; two responsibilities (structural gate + calibrated gate). |
| D10b | CONFIRMED | filename | `test-governor-*` name, zero governor API. |
| D10c | REFUTED | `:2` | `#include "llama-ext.h"` **is** used (4 errors without it). |
| D11 | CONFIRMED | `common/speculative.cpp:1697-1702` | the "follows draft_mtp is_mem_shared" claim is true; `llama_process(DECODE)` == `ctx->decode()`. |
| D12 | note | `:280-282` | teacher-forced chain ⇒ the number is an upper bound on acceptance, not acceptance. |
| V1 | CONFIRMED | `tests/test-governor-v0-devices.cpp:250` | negative control re-verified: `rc=1`, `prefill_engine=0 want GPU=1`. |
| V2 | CONFIRMED | `:165-170`, `:247-267`, `:320-325` | P1-A/B/C closed; only the genuine no-GPU 77 remains. |
| **V3** | **PLAUSIBLE** | `:220`, `:90-105`, `:27` | forced route ⇒ `strict_oracle=false` ⇒ 16 of 18 sampled tokens unchecked, tolerated divergences uncounted. |
| V4 | PLAUSIBLE | `:320`, `:162` | new 77→1 risk on the S23 (OpenCL **and** Hexagon register as GPU; the HTP lane is off by default). |
| V5 | REFUTED | `:196-201`, `:260-266` | no other vacuous pass. |
| V6 | PLAUSIBLE | `:169` | the default `gpu_fit=Unknown` admission path now has no test anywhere. |
| S1 | CONFIRMED | `tests/…shared-cells.cpp:368-374` | class assertion works (falsified → `rc=1`). |
| S2 | CONFIRMED | `:295-315` | state guard now runs on live cells + strict-blob-subset check. |
| S3 | PLAUSIBLE | `:386-402` | `aliased != 0` is satisfied by an empty intersection; no comparison counter (the sibling file has the guard). |
| S4 | CONFIRMED | `:208-214`, `:327-333` | cells-only half truthful now. |
| S5 | note | `:466-468` | the `plain` branch stays dead with the documented fixture (documented, not hidden). |
| S6 | PLAUSIBLE | `src/llama-kv-cache.h:176`, `src/llama-kv-cache.cpp:1318` | `get_v_storage` has zero production callers; internal header only; mark it test-only. |
| F5 | CONFIRMED | `src/llama-kv-cache.cpp:2141-2148` | warning text true for every reachable case; SHIP. |
| F4 | CONFIRMED | `src/llama-governor.cpp:196` | citation should be `:428`, not `:427`. |
| I3 | CONFIRMED | `ggml/src/ggml-cpu/ggml-cpu.c:6`, `:61` | include restored, builds; move it above the private-header group. |

---

# 8. Recommended order

1. **D1/D4 (fix first).** Replace the top-1 count with the mean-rank / MRR metric
   (D4 table), raise `k_steps`, and make the prompt a *sweep* (or drop the
   prompt-dependence entirely by scoring over a fixed reference token set).
2. **D5** one-line vocab precondition (OOB read).
3. **V3** count tolerated cross-backend divergences and fail above a small bound.
4. **D9** export `KALSA_GEMMA4_TARGET_GGUF` / `KALSA_GEMMA4_DRAFT_GGUF` in the
   battery the coordinator runs, and state the default `77` in the commit body.
5. **D10/S5 splits** and the `get_v_storage` comment (S6).
6. Nits: F4 `:428`, I3 include position, D6 rank guard, S3 comparison counter,
   D7 cell-identity assertion.

Nothing in `~/Projects/kalsallama` was edited, staged, committed or built; the
scratch worktree `/tmp/kalsa-audit-r2` was removed (`git worktree list` does not
list it, `git status` shows only the pre-existing untracked `CMakeUserPresets.json`).
Note for the record: `main` advanced during the audit — the worktree and every
result above are pinned to `e775fb2bf`, which was HEAD at the start; `main` is
now `a48cc3e08` (a DSP commit, outside this diff).
