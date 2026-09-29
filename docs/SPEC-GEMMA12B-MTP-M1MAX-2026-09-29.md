# Spec-Gemma-4-12B MTP on the M1 Max — measured, 2026-09-29

Lab from `RESEARCH-SPECULATION-BIG-MODELS-2026-09-28.md` §5 item 1 + item 4
(Italian gate), §1.2/§3. Question: does `--spec-type draft-mtp` with the
official Gemma-4-12B assistant drafter pay for the catalog's
gemma-4-12B-it-Q4_K_M row on the M1 Max? Every number below is
MEASURED-BY-US on this machine (MacBookPro18,2, M1 Max, 64 GB) unless tagged
otherwise. Port 8190, one server at a time, scratch in `~/lab/spec/`.
The kalsa-brain tree was not modified; nothing was committed.

## Headline

**Final state (after the fork fix and three review rounds, branch
`kalsa/gemma-mtp` tip `a0cc09109`, not merged — the merge into the fork's
main is the owner's call): the fork serves Gemma-4 MTP.** All four defects
are fixed in the fork (commits `9a586ce49`, `281394434`, `a3c617306`,
`56e1beecd` plus review fixes); measured on the fork build at n_max 3:
**Q4_K_M 1.06–1.38x, Q8_0 1.25–1.77x** (the Q8 ratios are against a Q8
no-spec baseline that is itself 1.1–3.0% slower than Q4_K_M); Italian gate
passes; `-np 2` and multi-turn serve. Exactness: **Q4_K_M 4 of 5 greedy
prompts diverge; Q8_0 is byte-identical except en_code**, whose char-1623
divergence is deterministic but request-history-dependent, cause
unattributed and OPEN (H1 vs H2 below). Hybrid/Qwen3.5 MTP remains out of
scope (reverted; its fences stay). The three numbered items below are the
pre-fix snapshot that motivated the lab — kept for history; their numbers
are the upstream engine's, not the fork's.

1. **The app's engine line cannot serve Gemma-4 MTP at all today** (written
   before the fork fix — superseded by the final state above). On fork
   HEAD `833cde99b` the drafter fails to load through three independent gates,
   and after patching all three the llama-server still aborts on its first
   request (details below). The numbers therefore come from **upstream
   `526c43b8f` + a one-line fix** — the only engine that serves this pair —
   with the baseline re-run on that same engine for fairness.
2. **Measured with the fix, MTP is a real win on this row**: n_max 3 gives
   **1.08–1.42x** across the five-prompt harness, the **Italian gate passes**
   (it_long +16% greedy / +8% catalog — no DSpark-style regression), long
   context holds (+22–23%), and the sweep optimum is n=3 (24.7 tok/s on
   en_code vs 22.7 at n=4, 18.1 at n=2).
3. **Exactness is quant-dependent**: on the pinned Q4_K_M target the greedy
   output diverges from the no-spec baseline on 3 of 5 prompts (plausible
   alternative text, not corruption — the #25618 family); on a Q8_0 target the
   same setup is **byte-identical** and faster still (29–33 tok/s).

## Setup

| Thing | Value | Tag |
|---|---|---|
| Fork build | `~/Projects/kalsallama` HEAD `833cde99b47b81f5f6a2a6309fbb8504033174f5` (branch `main`, clean clone at `~/lab/spec/kalsallama`); `git merge-base --is-ancestor 73159c303 HEAD` → **yes** (the #28183 gemma4-assistant fix is in); Metal Release into `~/lab/spec/build`, build.log `EXIT=0`; `llama-server --version` → `0.4.1-dev (build 11193, commit 833cde99b)` | MEASURED-BY-US |
| Upstream build | `ggml-org/llama.cpp` master `526c43b8f` (+1 line, below) into `~/lab/spec/up-build`, `EXIT=0` | MEASURED-BY-US |
| Target (pinned row) | `bartowski/gemma-4-12B-it-GGUF` @ `2ae7d41be21ca62de00a2d320ee9cec50daa3aa6`, `gemma-4-12B-it-Q4_K_M.gguf`, 7,662,533,088 B, sha256 `3962624dcd25b947d889dc9ae1bf275b61db6cd4dbe694057f34fffef1671509` — **reused the app's downloaded copy** (`~/Library/Application Support/kalsa-brain/runtime/models/`), sha matches the pin at `crates/kalsa-catalog/src/manifest.rs:765-771` | MEASURED-BY-US |
| Target (control) | `bartowski/gemma-4-12B-it-GGUF` `gemma-4-12B-it-Q8_0.gguf`, 12,669,647,328 B, sha256 `929bd294cbdc59e41450488bea524a174f1c6ddc43f140fdb5905a5fd1e41969` | MEASURED-BY-US |
| Drafter | `ggml-org/gemma-4-12B-it-GGUF` → `mtp-gemma-4-12B-it-Q8_0.gguf`, 465,109,152 B, sha256 `16c90eb9f2b2891cc138f3d2b3bf11e23b2ced2aeab9a9d39d90fe446f2f0610`; arch `gemma4-assistant`, block_count 4, `nextn_predict_layers` 4 | MEASURED-BY-US |
| argv (A and B common) | the app's launch shape (`crates/kalsa-launch/src/argv.rs`): `--threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512 --ctx-size 65536 --n-gpu-layers all --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --temp 1.0 --top-p 0.95 --top-k 64 --sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 6144` (sampling = this row's publisher values, `manifest.rs:754-762`); `--cache-ram`/`sleep-idle` dropped on the MTP server (see defects) | MEASURED-BY-US |
| argv (B adds) | `--model-draft <drafter> --spec-type draft-mtp --spec-draft-n-max {2,3,4} --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0` — the draft KV flags are **required**: with the target KV at q8_0 the drafter's f16 default cannot share cells (`llama-kv-cache.cpp:108`) | MEASURED-BY-US |
| Harness | the DSPARK-M1MAX harness recreated at `~/lab/spec/bench.py`: same 5 prompts (it_short, it_long, en_short, en_code, long_ctx = 7,855 tokens on Gemma's tokenizer), greedy (temp 0) + catalog (temp 1.0, top_p 0.95, top_k 64), 3 reps, seed 42 | MEASURED-BY-US |

Local patches, both in **my throwaway clones only**, uncommitted (the owner's
`~/Projects/kalsallama` untouched):

```
# 1) upstream + fork both: load the drafter file, not the target, again
 common/speculative.cpp:2545 (upstream) / :2562 (fork)
-        llama_model * model_dft = llama_model_load_from_file(params.model.path.c_str(), mparams);
+        llama_model * model_dft = llama_model_load_from_file(model_path.c_str(), mparams);
# 2) fork-only: the refusal gate must know the assistant layout
 src/llama-model.cpp:2235 has_mtp_weights(): return true early for
 LLM_ARCH_GEMMA4_ASSISTANT (its required tensors are enforced by the loader;
 it never carries the eh_proj/enorm/hnorm trio the gate checks)
# 3) fork-only: equal layer counts is the no-share-map case
 src/llama-kv-cache.cpp:116: skip the hparams.n_layer_all equality check when
 a layer_share_cb is present (the Gemma4 assistant maps 4 layers onto the
 target's last two by design, llama-model.cpp:2748)
```

## Why the fork build cannot serve this (the defect chain)

All steps reproduced on fork HEAD `833cde99b` (Metal build above); the chain,
in the order a user hits it:

a. `--model-draft <assistant> --spec-type draft-mtp` loads **the target file a
   second time** instead of the drafter: `common/speculative.cpp:2562` passes
   `params.model.path` where `model_path` (the draft path, printed by the log
   line immediately above) is meant. Result: `context type MTP requested but
   the MTP weights are not loaded`. **Present in upstream master too** (raw
   `common/speculative.cpp:2545` at `526c43b8f`); introduced by `f5525f7e7`
   (#25056). MEASURED-BY-US (the misload is observed; the upstream line read
   today).
b. With (a) fixed, the fork's `has_mtp_weights()` gate
   (`src/llama-model.cpp:2235`, fork commit `98bee958d`) refuses the
   assistant: it demands the bundled-nextn `eh_proj/enorm/hnorm` trio, which
   the gemma4-assistant arch never has (it carries `nextn.post/pre_projection`,
   `n_layer()`==0, its 4 blocks in `layers[0..n_layer_nextn)`). Upstream has
   no such gate. MEASURED-BY-US.
c. With (b) bypassed, the fork's KV-share hardening
   (`src/llama-kv-cache.cpp:116`, commit `6f3881baf`) throws `cannot share KV
   cells with a different layer count` for the 4-layer assistant against the
   48-layer target — although the fork's own share map
   (`llama-model.cpp:2748`) exists precisely to map those 4 layers onto the
   target's last two (`layer 0-2 → 46, layer 3 → 47` in the working log; the
   share callback returns `n_layer - 2`/`n_layer - 1`).
   Neither check string exists in upstream master. MEASURED-BY-US.
d. With (a)-(c) patched, the server starts and the KV sharing works, but the
   **first request aborts**: `seq_rm: sequence removal is not allowed from a
   shared KV cache` → `ggml_abort` from `common_memory::seq_rm` in the
   server's pre-decode path (both with `cache_prompt` false and true). The
   fork's shared-cells design is marked `[TAG_KV_CACHE_SHARE_CELLS]`
   TODO in `llama-kv-cache.h:311`; the server's cache invalidation does not
   yet have a legal path through it. Not fixable with a one-liner; **this is
   where the fork measurement stops.** MEASURED-BY-US.

Upstream master + fix (a) has none of (b)-(d) and serves the pair — that is
the engine for every number below. Baseline check: the fork build's A arm
(30 runs, before the patches) is **~2–4% faster than upstream, not equal** —
greedy it_short medians 19.77 (19.72–19.78) vs upstream 19.10 (18.91–19.33),
greedy long_ctx 16.03 (15.98–16.11) vs 15.58 (15.36–15.78); the ranges do
not overlap, and all ten condition medians sit above upstream's (+1.9% to
+4.7%). MEASURED-BY-US (results-A.jsonl vs results-A-up.jsonl).

## n_max sweep (en_code, greedy, upstream+fix, 1 rep each)

| n_max | tok/s | draft_n | accepted | tokens/step | per-position rate |
|---|---|---|---|---|---|
| 2 | 18.1 | 383 | 319 | 2.67 | 0.83 |
| 3 | **24.7** | 449 | 361 | 3.42 | 0.80 |
| 4 | 22.7 | 526 | 379 | 3.89 | 0.72 |

**n_max 3** chosen for the full arm; 4 tested and loses (verify width), so the
brief's conditional 4-test resolves as "done, slower". Baseline for this
prompt on the same engine: 18.5 tok/s. tokens/step = predicted_n × n_max /
draft_n (the drafter proposes n_max per verify step, exact); per-position
rate = draft_n_accepted / draft_n. Both MEASURED-BY-US.

## Full A/B at n_max 3 (upstream+fix engine, 3 reps each, median tok/s)

| cond | prompt | A tok/s | A min..max | B tok/s | B min..max | speedup | B tok/step | B pos rate |
|---|---|---|---|---|---|---|---|---|
| greedy | it_short | 19.1 | 18.9..19.3 | 24.4 | 24.3..24.5 | **1.28x** | 3.12 | 0.69 |
| greedy | it_long | 18.5 | 18.4..18.8 | 21.5 | 20.2..21.5 | **1.16x** | 2.86 | 0.62 |
| greedy | en_short | 19.1 | 18.6..19.3 | 27.1 | 27.0..27.1 | **1.42x** | 3.53 | 0.83 |
| greedy | en_code | 18.5 | 18.4..18.5 | 24.1 | 24.1..24.4 | **1.31x** | 3.42 | 0.80 |
| greedy | long_ctx | 15.6 | 15.4..15.8 | 19.1 | 19.1..19.1 | **1.22x** | 3.11 | 0.70 |
| catalog | it_short | 18.9 | 18.8..18.9 | 24.2 | 24.0..24.2 | **1.28x** | 3.08 | 0.69 |
| catalog | it_long | 18.7 | 18.4..18.8 | 20.2 | 20.2..20.9 | **1.08x** | 2.96 | 0.65 |
| catalog | en_short | 19.0 | 18.8..19.3 | 25.0 | 25.0..25.0 | **1.32x** | 3.27 | 0.74 |
| catalog | en_code | 18.5 | 18.5..18.7 | 21.6 | 21.6..22.3 | **1.17x** | 3.12 | 0.70 |
| catalog | long_ctx | 15.6 | 15.3..15.6 | 19.2 | 19.2..19.2 | **1.23x** | 3.10 | 0.70 |

- A prefill 88–173 tok/s (short→7.9k). B prefill: **cache_prompt had to be
  true** on the MTP server (false aborts, defect (d)), so reps 2–3 of each
  prompt reuse the cached prefix and their prompt tok/s is not comparable.
- Acceptance is excellent and *rises* where text is predictable
  (en_short 0.83); even Italian holds 0.62–0.69. The gain is capped by the
  M1 Max verify-width cost, exactly the DSpark lesson: 3.4 tokens/step
  translates to only 1.3x because a width-4 verify + drafter pass costs
  ~2.6x a single-token step.
- **Italian gate: PASS.** it_long +16% greedy / +8% catalog; it_short +28%
  both conditions. No DSpark-style regression anywhere in the matrix.
- The Strix Halo 2.44x (13.74→33.49, build 9553, Vulkan) and RTX 5060 1.47x
  (27.4→40.4, n=2) remain MEASURED-BY-SOURCE from the research doc — not
  reproduced here (different chip, backend, and a much newer llama.cpp); our
  1.42x best-prompt (greedy en_short) / ~1.2x mean is the M1 Max number.

## Exactness (greedy, byte-identical output vs the no-spec baseline)

- **Q4_K_M target: NOT exact.** 3 of 5 prompts diverge (it_short at char 84,
  it_long at 562, long_ctx at 844); en_short and en_code are identical. The
  divergent texts are plausible alternatives (same structure, different
  phrasing), and B sometimes finishes shorter — this is the target's argmax
  changing under speculation, i.e. the open upstream issue #25618 family
  ("draft-mtp / draft-dspark: greedy output diverges from vanilla on
  quantized targets"), with the target at Q4_K_M. MEASURED-BY-US.
- **Q8_0 target control: byte-identical** on the two previously-diverging
  prompts (A==B exact), so the divergence is quant-sensitivity, not the
  shared-KV design. The same control measured **29.2 tok/s (it_short) and
  33.0 tok/s (en_code)** at n_max 3 against a 19.2 Q8 baseline — the Q8_0+MTP
  combination is both exact and 1.53–1.78x over the pinned Q4 row's baseline,
  at 12.67 GB of weights. MEASURED-BY-US.
- Whether upstream's #25618 fix lands and backports decides whether the
  catalog's Q4_K_M row may carry MTP with "exact" in its description.

## Hygiene

- `pgrep -x cargo; pgrep -x rustc` before every timed run: never present
  (the task's `pgrep -fl` form also matches `.cargo/bin` inside unrelated
  processes' PATH — noted, exact-name checks used). No run overlapped a
  compile.
- One llama-server at a time; each stopped by PID before the next; all
  stopped at the end (`pgrep -x llama-server` empty). The owner's Kalsa.app
  server (pid 9587 in the DSpark doc) was **no longer running** today — the
  machine was idle; nothing of the app was touched.
- No run was interrupted by sleep; all 30+30+sweep+control runs completed.
- Runtime patches live only in `~/lab/spec/kalsallama` and
  `~/lab/spec/upstream` (uncommitted `git diff`, quoted above). The fork's
  working tree in `~/Projects/kalsallama` was not modified.

## What I could not verify

- **The planned fork-HEAD measurement does not exist** — defects (a)-(d) make
  it impossible without server-side shared-cache invalidation work; the A/B
  numbers are upstream+fix, with the fork baseline as corroboration only.
- No F16 target control (bartowski ships none; Q8_0 stands in) — the exact
  quant threshold between "diverges" and "exact" is untested.
- The DSpark doc's five prompts were reused verbatim, but the long_ctx token
  count differs slightly (7,855 vs 7,895 — different tokenizer); acceptance
  comparisons across the two labs are indicative, not paired.
- Upstream master moves daily; (a) was read at `526c43b8f` today. If it is
  fixed upstream tomorrow, defect (b)-(d) still block the fork specifically.
- Whether Liquid/slb350's older builds (b9553-era) diverged on quantized
  targets the same way — their losslessness claims predate #25618.

## Recommendation (updated to the final state)

The fork now serves this pair, so the original "do not wire it in — the fork
cannot serve it" no longer applies; what remains is exactness policy:
- **Do not describe the pinned Q4_K_M row as exact** — 4 of 5 greedy prompts
  diverge from no-spec (the #25618 family), the same on every build tested.
- **Q8_0+MTP is exact on 4 of 5 prompts** and the fastest option
  (1.25–1.77x, against a baseline 1.1–3.0% slower than Q4's); the en_code
  char-1623 divergence is deterministic but request-history-dependent, cause
  unattributed and OPEN (H1 vs H2) — acceptable only if "exact" is not
  claimed, and worth re-pinning once #25618 closes upstream.
- Merging `kalsa/gemma-mtp` into the fork's main is the owner's decision;
  the branch is unmerged, unpushed, and re-verified through three review
  rounds. Hybrid/Qwen3.5 MTP stays out of scope (reverted, fences intact —
  phone team's path).
- The parked follow-ups: upstream's `state_clear()` K/V zeroing (linked to
  the OPEN argmax question) and the `state_read_data` cell-count guard.

The pre-fix recommendation (kept for history) was: do not wire draft-mtp in
today — the fork could not serve it (four defects, two fork-local) and the
pinned Q4_K_M target diverged from vanilla greedy.

## Fork fix (same-night session, 2026-09-28)

The owner ordered the fix inside the fork instead of the stop-and-report the
defect chain pointed at. Worktree `~/lab/spec/fork-mtp`, branch
`kalsa/gemma-mtp` (from fork main `833cde99b`), one commit per defect, built
Metal Release in `~/lab/spec/fork-mtp-build` (build.log EXIT=0;
`llama-server --version` → `0.4.1-dev (build 11196, commit a3c617306)` — the
(d) commit lands minutes after the stamp; the binary contains it). Nothing
pushed, `~/Projects/kalsallama` untouched.

- **(a) `9a586ce49`** — `common/speculative.cpp`: the draft branch loads
  `model_path` (set from `params.speculative.draft.mparams.path`) instead of
  `params.model.path`. Kept from the previous agent's uncommitted change; it
  is the same patch the upstream numbers above ran on.
- **(b) `281394434`** — `llama_model::has_mtp_weights()`
  (`src/llama-model.cpp:2235`) returns true for `LLM_ARCH_GEMMA4_ASSISTANT`
  after the `n_layer_nextn`/bounds checks. The arch has no
  `eh_proj/enorm/hnorm` trio: its `n_layer_nextn` blocks are the whole model,
  created required by its own arch loader, which never consults `load_mtp` —
  so the trio loop could only refuse a valid file. The trio loop stays for
  every other arch: 98bee958d's purpose (refuse an MTP context whose nextn
  tensors were skipped) has no skip path to guard on this arch.
- **(c) `a3c617306`** — the constructor throw on
  `hparams.n_layer_all != other->hparams.n_layer_all`
  (`src/llama-kv-cache.cpp:116`) is skipped when a share callback is present:
  the share map is the one case where counts legitimately differ (assistant
  4 → the target's last two layers; the brief's "42" was wrong — the target
  has 48 layers, share maps to 46/47 per the callback's
  `n_layer - 2`/`n_layer - 1`). Share-less count mismatches still throw —
  6f3881baf's purpose (catch genuinely incompatible pairings at construction,
  loudly) is intact.
- **(d) `56e1beecd`** — owner decision: implement, preference 1 = the
  upstream shared-view semantics. The shared cells are one aliased object
  (`v_cells_impl` is shared at construction), so the source cache's cell
  mutation is already the view's mutation. In `src/llama-kv-cache.cpp`:
  `seq_rm` no-ops into success (the abort came from
  `common_memory::seq_rm` → `common/common.cpp:1640` `GGML_ABORT` on the old
  refusal), `seq_cp`/`seq_keep`/`seq_div` no-op silently, `seq_add` and
  `update` skip the rope-shift/stream-copy graphs (the source runs them once
  over the shared K tensors; a second run would shift them twice),
  `clear` runs through (one cell store), `apply_ubatch` leaves cell
  bookkeeping to the source, and state IO returns silently. The callers that
  do state IO on the draft context are the prompt-cache load
  (server-context.cpp:324/:331) and the spec-checkpoint paths (:2382, :3274,
  :3313, :3344, :3628, :4206); the source's IO covers the shared tensors, and
  the old throw would have killed the second request. `--slot-save-path` is
  unaffected by construction: it saves and loads `ctx_tgt` only
  (server-context.cpp:2798, :2859). `init_batch`/`prepare` lost their "decode is not
  allowed" fences: drafting through the target's last-layer K/V is the
  mechanism the sharing exists for, and upstream never fenced any of this
  (`llama-kv-cache.cpp:383-386` at `526c43b8f`: `seq_rm` returns true).
  Alternatives, per the owner's order of preference: (2) drafter-owned
  non-shared KV — rejected because the assistant graph reads
  `model_other->tok_embd` and its blocks share the target's last-layer
  weights by design (that is why the share map exists); "own KV" is a
  different design, not a flag, and was not measured. (3) disable the
  triggering operation — unnecessary once (d) landed; multi-turn
  `cache_prompt:true` measured working (below). `tests/
  test-governor-v0-shared-cells.cpp` now pins the mirror contract instead of
  the fences (non-owner clear empties the shared cells; non-owner decode
  succeeds without touching bookkeeping; non-owner `seq_rm` succeeds without
  removing until the owner removes). The constructor guards
  (type/layout/kv_size/layer mismatch) are unchanged.

### Fork A/B at n_max 3 (final fork build, 3 reps, medians) — MEASURED-BY-US

Final build = branch tip after the review pass (heads revert, share-map
bound, state-mirror WARN, hybrid mirror; `llama-server --version` build 11202,
commit 604824d90 — later reverted in parts, see Second review round). A arms unchanged from the earlier fork build: none of the
review changes is reachable without a drafter, and the no-spec texts and
speeds reproduce (A-side en_code byte-identical across fresh servers). Raw
rows: results-B-review-q4/q8.jsonl vs results-A-forkfix-q4/q8.jsonl.

| quant | cond | prompt | A tok/s | B tok/s | speedup | B pos rate | B tok/step |
|---|---|---|---|---|---|---|---|
| Q4_K_M | greedy | it_short | 19.86 | 24.73 | 1.24x | 0.69 | 3.12 |
| Q4_K_M | greedy | it_long | 19.25 | 21.74 | 1.13x | 0.67 | 3.02 |
| Q4_K_M | greedy | en_short | 19.90 | 27.52 | 1.38x | 0.83 | 3.53 |
| Q4_K_M | greedy | en_code | 19.46 | 24.34 | 1.25x | 0.78 | 3.36 |
| Q4_K_M | greedy | long_ctx | 16.12 | 19.10 | 1.18x | 0.69 | 3.09 |
| Q4_K_M | catalog | it_short | 19.95 | 24.65 | 1.24x | 0.69 | 3.08 |
| Q4_K_M | catalog | it_long | 19.30 | 20.45 | 1.06x | 0.61 | 2.84 |
| Q4_K_M | catalog | en_short | 19.84 | 26.23 | 1.32x | 0.77 | 3.33 |
| Q4_K_M | catalog | en_code | 19.36 | 22.53 | 1.16x | 0.70 | 3.10 |
| Q4_K_M | catalog | long_ctx | 16.24 | 19.81 | 1.22x | 0.73 | 3.20 |
| Q8_0 | greedy | it_short | 19.62 | 30.20 | 1.54x | 0.69 | 3.14 |
| Q8_0 | greedy | it_long | 18.94 | 24.43 | 1.29x | 0.61 | 2.83 |
| Q8_0 | greedy | en_short | 19.49 | 34.41 | 1.77x | 0.85 | 3.58 |
| Q8_0 | greedy | en_code | 19.05 | 29.19 | 1.53x | 0.78 | 3.35 |
| Q8_0 | greedy | long_ctx | 15.95 | 22.80 | 1.43x | 0.71 | 3.15 |
| Q8_0 | catalog | it_short | 19.68 | 31.73 | 1.61x | 0.73 | 3.22 |
| Q8_0 | catalog | it_long | 18.94 | 23.76 | 1.25x | 0.59 | 2.77 |
| Q8_0 | catalog | en_short | 19.32 | 29.00 | 1.50x | 0.68 | 3.08 |
| Q8_0 | catalog | en_code | 18.89 | 27.36 | 1.45x | 0.71 | 3.13 |
| Q8_0 | catalog | long_ctx | 15.75 | 22.55 | 1.43x | 0.70 | 3.12 |

Ranges: **Q4_K_M 1.06–1.38x, Q8_0 1.25–1.77x** at n_max 3 on the final build.

### Exactness on the fork build (greedy, A vs B) — MEASURED-BY-US

- **Q4_K_M target: 4 of 5 diverge** (it_short at char 84, it_long at 1339,
  en_code at 1433, long_ctx at 844); en_short byte-identical. Same #25618
  family — plausible alternatives; A reps and B reps each internally
  identical.
- **Q8_0 target: 4 of 5 byte-identical**; en_code is a **deterministic
  divergence at char 1623/1895** ("in a given text" vs "in a string", then +2
  chars), request-history-dependent. What was measured (same binary, build
  11205 / `15f5d14f4`): with find_slot instrumented (env-gated scratch
  build), the drafter's cell is contained in the owner's span for **461 of
  461** placements both made per sub-cache (compared positions 0..573,
  which includes the 490–515 region around the divergence at ≈ pos 501),
  and the view never landed on an owner cell of a different position
  (0 collisions; join script and analysis filed:
  `~/lab/spec/slotlog-join.py`, `~/lab/spec/slotlog-analysis.txt`). en_code
  as the FIRST request on 5/5 fresh servers produced one identical
  divergent text (draft 459/357, rate 0.7778); as the FOURTH request
  (after it_short/it_long/en_short) on 2/2 fresh servers it produced the
  no-spec text byte-for-byte (draft 459/358, rate 0.7800) — acceptance
  profiles differing by one accepted token of 459, cache_n 0 vs 7; the
  no-spec A side is stable either way (3/3). Artifacts:
  `~/lab/spec/h1h2-{first,fourth}-*-{en_code,}.jsonl/.txt`,
  `~/lab/spec/h1h2-analysis.txt`. **Why request history moves the argmax
  is an OPEN question** about the fork's shared-view mirror: the join
  excludes misallocation but NOT stale K/V inside a correctly allocated
  cell (apply_ubatch no-ops for a view, llama-kv-cache.cpp:~1169, and the
  fork lacks upstream's state_clear() K/V zeroing — see the parked
  follow-up below), and the acceptance data does not separate that from a
  numerically-shifted argmax. The earlier "run-unstable" wording is
  withdrawn. Do not put "exact" in a catalog description on this evidence;
  #25618 covers both quants on the fork.

### Multi-slot and multi-turn — MEASURED-BY-US

- `--parallel 2` (`-np 2`): two concurrent requests, both completed with the
  drafter live (draft 36/34 each), no abort, no fence lines in the log.
- `cache_prompt:true` turns 2-3 of the same prompt: cache_n=18 reused,
  24.7–24.8 tok/s with draft 60/41 — the silent drafter state IO costs
  nothing because the target's state save/restore covers the shared tensors.

### Why Q8_0 no-spec is only 1–3% slower than Q4_K_M on this chip — MEASURED-BY-US

The oddity from ctl-A-q8-*.json is real and reproduces on the fork build,
back to back, same binary: Q8_0 decode loses a uniform 1.1–3.0% to Q4_K_M
across all ten A-arm conditions (greedy it_short 19.62 vs 19.86 = −1.2%,
en_code −2.1%, long_ctx −1.1%; catalog en_short −2.7%, long_ctx −3.0%)
despite 11.78 vs 7.12 GiB of weights — near parity, not equality.
`llama-bench` on the final build (build 11205, commit `15f5d14f4`;
`-t 4 -p 512 -n 128 -ngl 99 -fa 1`, 3 reps, raw output filed at
`~/lab/spec/llama-bench-q4q8.log`):

| quant | pp512 tok/s | tg128 tok/s | implied tg128 bandwidth |
|---|---|---|---|
| Q4_K_M | 231.88 ± 0.07 | 24.66 ± 0.01 | ~189 GB/s (~47% of the 400 GB/s spec) |
| Q8_0 | 268.53 ± 0.13 | 23.90 ± 0.00 | ~303 GB/s (~76%) |

The two quants are pinned by different resources that happen to cost the
same here. Q8_0 decode sits near the practical batch-1 GEMV bandwidth
ceiling (~303 GB/s effective); if it were bandwidth-bound below that,
Q8_0 would have to be ~1.6x slower than Q4_K_M, and it loses only 1–3%.
Q4_K_M
decode is instead pinned by the K-quant dequant ALU work per weight (~189
GB/s effective is far off the bandwidth ceiling). Prefill confirms the
split: at pp512 — compute-bound, big batches — Q8_0 is 16% FASTER (268.53 vs
231.88), because its dequant is much cheaper per weight; the server harness
shows the same +14% on long_ctx prefill (195 vs 171 tok/s). The near parity
is a chip+kernel property, not a fork property: the upstream engine showed
the same (Q4 19.1 vs Q8 ~19.2 in the control above). Consequence for the
speedups below: every Q8_0 x-factor is measured against a baseline that is
itself 1–3% slower than the Q4_K_M one, which inflates the Q8_0 ratios by
about that much.

### Targeted fork tests (fixture: stories260K) — MEASURED-BY-US

- `test-governor-v0-shared-cells` — PASS (exit 0): mirror clear/decode/
  seq_rm assertions + negative guards (bad type_k and bad kv_size still
  rejected at construction).
- `test-governor-v0-commit` — PASS (exit 0).
- `test-governor-v0-mtp-hybrid` — SKIP (exit 77; needs a Qwen3.5-class GGUF,
  not on disk).
- `test-governor-v0-hybrid` — SKIP (exit 77; needs `KALSA_HYBRID_GGUF`).

### Hygiene (fork-fix session)

- The owner's Kalsa.app server was RESIDENT and idle (pid 47057, ~0.1% CPU,
  Qwen3.6-35B row, ctx 131072) during every fork-build run above — unlike
  the original lab, whose runs had an idle machine. Each A/B pair is
  internally fair (same resident load on both arms), but absolute tok/s may
  read slightly low.
- One llama-server at a time; each stopped by PID before the next; none
  running at the end (`pgrep -x llama-server` empty).
- No cargo/rustc at any timed run (pgrep before each).

### What I could not verify (fork fix)

- The Q8 en_code single-prompt divergence is attributed to build drift by
  elimination, not proof — a bisect would need a fork build at the merge
  base.
- Exactness was checked on the 5 harness prompts only.
- Alternative (2) (drafter-owned KV) was not measured.
- The B-arm equality with the upstream engine is same-day, same-machine,
  different-binary; a same-binary A/B would need the upstream build to pick
  up (b)-(d), which it does not have.

## Review pass (2026-09-29, fixes for the FIX review)

Five more commits on `kalsa/gemma-mtp`, one per review item, same worktree,
nothing pushed. Final tree `604824d90` (content-identical to the tree the
review measured; its tip is `604824d90`).

- **find_slot heads (blocking 1+2), `66360e816`** — 6f3881baf's fork-only
  `other->v_heads` read in find_slot reverted to upstream shape. Decision
  from the code: the head cursor is a per-cache search hint, "not part of
  the KV state" (llama-kv-cache.h, v_heads decl), and no path advances a
  shared view's own cursor (apply_ubatch, seq_rm, seq_keep, seq_cp all
  no-op for a view) — so borrowing the source's cursor coupled the two
  caches' scan heuristics for no invariant. The discriminating bisect did
  **not** confirm a numeric cause, and we say so: with only this line
  flipped, one fresh-server run returned all five Q8_0 greedy prompts
  byte-identical (en_code included), but the same binary re-run fresh
  produced the en_code divergence again (char 1623), and the final build
  (whose only other changes cannot touch gemma4 numerics: a log line, a
  lookup refactor resolving the same ids, an unreachable hybrid change)
  diverges too. The no-spec A side reproduces byte-for-byte across fresh
  servers. **We could not attribute it to the heads line** (superseded —
  see H1 vs H2 below: the divergence is history-dependent and its cause is
  unattributed), and the revert stands on the upstream-fidelity argument
  alone. Speeds: the two fork builds' B arms sit within a consistent small
  shift — 18 of 20 rows faster on the later build, −0.04..+0.76 tok/s
  (results-B-forkfix-* vs results-B-review-*), i.e. build-to-build noise in
  one direction, not a mirror cost.
- **share-map bound (7), `ad2babf20`** — the share wiring used
  `other->map_layer_ids[il_share]` (operator[] default-inserts 0 on an
  unmapped id → silent wiring onto the source's layer 0). Now find() +
  range check against the source's `n_layer_all`, throwing at construction
  like the other share guards. The gemma4 path resolves the same layers as
  before (46/47), so no behavior change on the measured rows.
- **state-mirror diagnostic (5), `a135043e0`** — a WARN in the shared
  view's state_write and state_read: the view carries no state of its own,
  the source cache's state IO covers its tensors. One per direction per
  process (two statics), worded per-cache with the cache pointer as of
  `15f5d14f4`.
- **hybrid state mirror (6), `b31b5a1ef` — REVERTED by `77764a668`** the
  next round: the orchestrator ruled hybrid/Qwen3.5 MTP the phone team's
  path and out of scope, and opening state IO alone while the eight
  shared_fence calls around it still error
  (llama-memory-hybrid.cpp:98,163,175,183,195,203,211,219) leaves the
  pairing half-served — worse than either extreme. Hybrid drafter
  pairings still cannot serve on this branch; lifting the remaining fences
  deliberately, with the phone team, is the follow-up.
- **mirror-contract tests (4), `604824d90`** — test-governor-v0-shared-cells
  now also asserts: after a non-owner decode the owner's cells are still
  empty and its next placement still starts at 0; seq_add/seq_cp/seq_keep/
  seq_div on the view are no-ops (owner cells unchanged, nothing copied
  into seq 1); a full state get/set round trip on the view succeeds
  without touching the owner. All PASS on stories260K (exit 0), together
  with the earlier mirror and negative-guard lines;
  test-governor-v0-commit PASS; mtp-hybrid and hybrid SKIP 77.

Re-measured on the final build (rows the review disputed or that the code
changed): both B arms re-run in full (60 rows, drafter live on every row —
e.g. greedy it_short 154/107, catalog en_code 490/347) → the tables above;
Q4_K_M exactness unchanged (4/5 diverge, same chars); Q8_0 exactness 4/5
with en_code the deterministic history-dependent divergence (above);
  llama-bench re-run and the raw output
filed at `~/lab/spec/llama-bench-q4q8.log`.

### Follow-ups recorded, not fixed (predate this branch)

- The fork's kv-cache has no `state_clear()`: upstream zeroes the K/V of
  freed cells after a failed restore ("the attention can still read the
  data of free cells", upstream llama-kv-cache.cpp:2667 and :2696); the
  fork relies on seq_rm alone. Divergence predates `kalsa/gemma-mtp`.
- The fork's `state_read_data` lacks the `cell_count > cells.size()` guard
  upstream has (upstream llama-kv-cache.cpp:2543; the fork keeps the two
  meta-path guards only, fork llama-kv-cache.cpp:2539/:2627). Also
  pre-existing.

### Hygiene (review session)

- The owner's kalsa-server (pid 47057, port 8130, Qwen3.6-35B) was resident
  and idle through every run; never touched. One llama-server at a time on
  :8190, each stopped by PID; `pgrep -x llama-server` empty at the end.
- No cargo/rustc during timed runs.

## Second review round (2026-09-29, fixes for the FIX re-review)

Three commits on top of `604824d90`; branch tip `15f5d14f4` (build 11205),
tree clean, nothing pushed.

- **Hybrid revert, `77764a668`** — reverts `b31b5a1ef` wholesale. The
  orchestrator ruled hybrid/Qwen3.5 MTP the phone team's path and out of
  scope; half-unfencing it (state IO open, the eight shared_fence calls at
  llama-memory-hybrid.cpp:98,163,175,183,195,203,211,219 still erroring)
  is worse than either extreme. Hybrid drafter pairings still cannot serve
  on this branch — recorded as a follow-up for the phone team.
- **Live-cells owner invariants, `9f8a2b44a`** — the owner_invariants block
  ran after llama_memory_clear reset every head, so it could not fail; it
  now runs with the owner mid-sequence (live cells, cursor at N) around a
  non-owner decode. The re-review also asked to mutation-prove that
  restoring 6f3881baf's `other->v_heads` read in find_slot turns the test
  red: it does not, and under the seq_rm/apply_ubatch head discipline it
  cannot — all free cells sit at or above the owner's head (seq_rm drops
  the head to the lowest freed index; apply_ubatch moves it to
  last-placed+1 of a monotone scan that leaves no free cell below the last
  pick), so a view scanning from its own cursor and one scanning from the
  source's choose the same cells. Verified empirically: mutation applied,
  full test still passes. That equivalence is conditional, not absolute —
  seq_keep breaks the head discipline (see the third round's `a0cc09109`).
  This also closes the heads question for good:
  the two cursor semantics are output-equivalent here, and the live run
  (below) shows the drafter and target agreeing on every cell.
- **Per-cache WARN wording, `15f5d14f4`** — the shared-view state WARN now
  names the cache pointer; two statics (one per direction), so at most two
  lines per process.

### The decisive experiment (blocking 2) — MEASURED-BY-US

Instrumented find_slot (env-gated scratch build, not committed) logging
side, cursors and chosen cell indices for every placement of both
contexts during the Q8_0 en_code greedy run:

- **Cells always agree**: for every position both the drafter view and the
  target owner placed, the view's cell is contained in the owner's span —
  461 of 461 placements per sub-cache (counts corrected and the join script
  filed in the third round; see there); and the view never wrote into a cell
  the owner had mapped to another position (0 collisions). Artifacts:
  `~/lab/spec/server-slotlog-en_code-B-q8.log` (1238 placement records),
  `~/lab/spec/slotlog-analysis.txt`, `~/lab/spec/slotlog-en_code-B-q8-text.txt`.
- **Text is deterministic given (binary, request history)**: en_code as
  the first request on 5/5 fresh servers → one identical divergent text
  (sha1 498d7198…); en_code as the fourth request (after it_short,
  it_long, en_short) on 2/2 fresh servers → the no-spec text
  byte-for-byte (sha1 36897aa…); no-spec A arm 3/3 fresh servers identical.
  Artifacts: `~/lab/spec/exactness-{A,B}-freshsrv*-en_code-q8.txt`,
  `~/lab/spec/exactness-freshsrv-summary.json`.
- **Verdict** (superseded in part — see H1 vs H2 below): deterministic
  divergence on the fork build at char 1623, request-history-dependent,
  cause unattributed, OPEN. The join above excludes misallocation (the
  drafter's cell is contained in the owner's span; no cell of another
  position is touched) but does NOT exclude stale K/V inside a correctly
  allocated cell, and the H1/H2 experiment does not separate the two
  hypotheses. The "run-unstable" wording from the previous round is
  withdrawn; "near-tie" was a guess, not a measurement.
- Because no code defect surfaced, no semantics changed and the exactness
  and speed rows were not re-run beyond the captures above (the measured
  tables stand on `604824d90`; the tip `15f5d14f4` adds only test and log
  wording).

### Second-round hygiene

- Owner's kalsa-server (pid 47057, :8130) resident and idle throughout,
  never touched; one llama-server at a time on :8190, all stopped
  (`pgrep -x llama-server` empty); no cargo/rustc during timed runs.
- Targeted tests on the final build: test-governor-v0-shared-cells PASS
  (exit 0, all eight lines), test-governor-v0-commit PASS (exit 0),
  test-governor-v0-mtp-hybrid SKIP (exit 77).
- llama-bench re-run on the final build and filed (numbers in the oddity
  section above).

## Third review round (2026-09-29, SHIP; documentation follow-ups, no fork code changes)

One commit, comment-only: `a0cc09109` — the cursor-equivalence note in
test-governor-v0-shared-cells no longer claims "provably": the induction has
a named exception, `seq_keep` (its new head is the first KEPT cell, so cells
it frees below the head stay below it — the head discipline breaks). It is
unreachable from the server today but exported in include/llama.h; worded as
a precondition: consumers of layer_share_cb must not rely on view/owner cell
agreement across a seq_keep on the source cache. The earlier commit body
(`9f8a2b44a`) still says "provably" and cannot be rewritten — this paragraph
supersedes it.

### H1 vs H2 (the open correctness question) — MEASURED-BY-US

The slotlog join excludes misallocation but not stale K/V inside a correctly
allocated cell (apply_ubatch no-ops for a view, llama-kv-cache.cpp:~1169;
the fork lacks upstream's state_clear() K/V zeroing). Experiment: en_code
greedy Q8_0, B arm, same binary, 3 fresh servers as the FIRST request vs 3
as the FOURTH (after it_short/it_long/en_short), recording timings, draft
counters, cache_n and text per request (`~/lab/spec/h1h2-*.jsonl/.txt`):

- FIRST (divergent, 3/3 identical): draft_n 459, accepted 357, rate 0.7778,
  cache_n 0, tps 29.16–29.21.
- FOURTH (matches no-spec, 3/3 identical): draft_n 459, accepted 358, rate
  0.7800, cache_n 7, tps 28.69–29.32.

The acceptance profiles differ by exactly one accepted token of 459 — not a
material difference — and one flipped acceptance is what either hypothesis
predicts downstream of a single flipped argmax. **The data does not separate
H1 (history → different acceptance) from H2 (stale K/V in a correctly
allocated cell).** The slotlog join was also reworked and its script filed
(`~/lab/spec/slotlog-join.py`): per sub-cache the drafter's cell is contained
in the owner's span for 461 of 461 placements both made (positions 0..573,
including the 490–515 region around the divergence at ≈ pos 501), 0
collisions, over 920 view / 318 owner raw records; the previous analysis
file's "310 of 310" was an artifact of a lossy dedup and is superseded.
"Why request history moves the argmax" stays OPEN, linked to the parked
state_clear() follow-up.

### Hygiene (third round)

Owner's kalsa-server (pid 47057, :8130) resident and idle throughout, never
touched; one llama-server at a time on :8190, all stopped; no cargo/rustc
during timed runs. Build after the comment-only commit: EXIT=0, all
targeted tests unchanged (shared-cells PASS, commit PASS, mtp-hybrid
SKIP 77).
