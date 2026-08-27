# REVIEW_PHASE2 — hostile code review of kalsallama app-pin-compat-surface

Status: IN PROGRESS (incremental)

- Repo: `C:\Users\gualt\kals-pin` (kalsallama), branch `app-pin-compat`, HEAD `cb9fdd1f867afa53565a0547ceb8f86a79822857`, parent verified `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`, clean worktree.
- Scope: full diff `a0cabca6b..cb9fdd1f867afa53565a0547ceb8f86a79822857` (single commit "app-pin-compat-surface", 12 files, +140/−14).
- Spec: `ENGINE_PIN_GAP.md` §1.1 (8 minimum-coherent backports) + `GAP_JSI.md` (wrapper call-site contract).
- Reference implementations fetched for honesty checks: upstream `acb7c7906` (#20297) full patch. Upstream b10156-era `llama.h` / `chat.*` / `common.cpp` to be checked.

## Coverage matrix vs ENGINE_PIN_GAP §1.1

| # | Required backport | In diff? | Files | First-pass verdict |
|---|---|---|---|---|
| 1 | `load_mode` + `LLAMA_LOAD_MODE_*` | yes | llama.h, common.h, common.cpp, arg.cpp | Mapped; F3 (dio combos), F10 (enum divergence), F11 (no default) |
| 2 | `progress_callback` + `_user_data` aliases | yes | common.h, common.cpp | Live, coherent fallback; F12 |
| 3 | `vocab_only` on common_params | yes | common.h, common.cpp | Threaded via to_llama; F13 |
| 4 | `reasoning_budget_activate_immediately` | yes | common.h, sampling.cpp | Genuine but semantics drift; F4, F5, F6 |
| 5 | Multi-sequence `reasoning_budget_end` | yes | common.h, sampling.cpp, server-schema.cpp | first-sequence adapter exact for wrapper; F7 |
| 6 | Plural `thinking_end_tags` | yes | chat.h, chat.cpp | Sync shim in apply(); F8 |
| 7 | `common_chat_templates_has_variant` | yes | chat.h, chat.cpp | F9; collides with llama.rn patch: F1 |
| 8 | 2-arg `get_caps` + caps struct | yes | chat.h, chat.cpp | F9; collides with llama.rn patch: F1 |
| 9 | `mtmd_input_text.text_len` | yes | mtmd.h, mtmd.cpp, mtmd-cli.cpp, server-common.cpp | Clean; F14 |

Cross-cutting: F2 (finetune regression), F15 (commit message), F16 (test honesty),
F17 (default-path byte-identity audit), F18 (compile verification not performed).

Findings below; each tagged CONFIRMED / PLAUSIBLE / REFUTED with file:line evidence.

## Findings

### F1 — CONFIRMED (high): fork duplicates symbols that llama.rn v0.12.8 bootstrap patches also add → generated tree will not compile

The diff adds `common_chat_template_caps` + 2-arg `common_chat_templates_get_caps` +
`common_chat_templates_has_variant` to the fork (`common/chat.h:367-378`,
`common/chat.cpp:2955-2991`). llama.rn v0.12.8 `scripts/patches/chat.h.patch` (hunk
`@@ -253,6 +256,20 @@`) and `scripts/patches/chat.cpp.patch` (hunk `@@ -2945,3 +3029,34 @@`)
add the *identical* struct and functions to the generated tree — verified by fetching both
patches from tag v0.12.8.

- chat.h.patch hunk context: `common_chat_templates_support_enable_thinking` decl followed by
  `common_chat_msgs_parse_oaicompat` decl. In the fork these are still contiguous
  (`common/chat.h:350` → `:353`), the fork's insertion is at :365-378 — context matches →
  patch applies → **second definition of `struct common_chat_template_caps` in one TU →
  redefinition compile error** (duplicate function declarations alone would be legal; the
  struct is not).
- chat.cpp.patch hunk context: the 3-line epilogue of the 1-arg `get_caps`
  (`    }` / `    return chat_templates->template_default->caps.to_map();` / `}`), appending
  its impls. In the fork those 3 lines exist mid-file (`common/chat.cpp:2949-2951`) with the
  fork's own 2-arg impls after them → patch inserts its versions **above** the fork's →
  **duplicate function definitions in one TU → compile error**.

Consequence: at Phase 3 bootstrap (fork sources + llama.rn patch loop) the generated
`cpp/common/chat.{h,cpp}` fails to compile, far from the cause. ENGINE_PIN_GAP §1.1 rows 7-8
directed the fork-side addition and its §1.2 lists only common.h.patch/sampling.cpp.patch as
needing realignment — the spec missed this collision, and the diff neither strips the patch
hunks (llama.rn-side) nor documents the required remediation. Alternative design: do NOT add
these symbols fork-side (fork code never calls them; only the wrapper does, and the wrapper
compiles against the generated tree that receives them via patch).

### F2 — CONFIRMED (high): `examples/training/finetune.cpp` regression — forced `use_mmap=false` now silently ignored

`examples/training/finetune.cpp:29-33` post-parse mutation:
```cpp
if (params.use_mmap) { LOG_INF("...force disabling memory mapping..."); params.use_mmap = false; }
```
Before the diff, `common_model_params_to_llama` copied `mparams.use_mmap = params.use_mmap`
→ the guard worked. After the diff, the conversion ignores the bools entirely and derives
mparams exclusively from `params.load_mode` (`common/common.cpp:1563-1590`), which finetune
never touches and which still holds its default `LLAMA_LOAD_MODE_MMAP`
(`common/common.h:487`) → `mparams.use_mmap = true` → finetune mmaps the weights again,
reproducing the exact read-only-weight-pointers failure the guard exists for.
Generalizes: **any post-parse mutation of `use_mmap`/`use_mlock`/`use_direct_io` anywhere in
the fork is now dead** unless the mutator also updates `load_mode`. Sweep found only
finetune (common_params level); `common/fit.cpp:57-58` mutates mparams_copy post-conversion
(unaffected); `examples/diffusion/diffusion-cli.cpp:120-122` reads the bools directly — for
CLI-parsed params the new arg.cpp lambdas keep bools mirrored, so diffusion stays coherent;
`src/llama.cpp:415` and llama-bench operate at llama_model_params level (unaffected).
finetune is not in the Android/CLI campaign binary set, but it is a real fork-consumer
regression introduced by this diff. Fix: finetune must set `params.load_mode =
LLAMA_LOAD_MODE_NONE` (as upstream #20834 itself did), or to_llama must reconcile bools↔mode.


### F3 — CONFIRMED (medium): load_mode enum diverges from upstream #20834; dio+mlock and dio+mmap flag combos silently degraded

Upstream #20834 (patch fetched, commit d67263fd7): `enum llama_load_mode` has exactly
`NONE=0, MMAP=1, DIRECT_IO=2` and mlock is a separate bitflag
`llama_load_modifier::LLAMA_LOAD_MODIFIER_MLOCK`; loader consumes mode+modifier directly.
The fork invents a 5-value enum (`include/llama.h:208-215`:
NONE/MMAP/MLOCK/MMAP_MLOCK/DIRECT_IO = 0..4) folding mlock into the mode, keeps the bool
triple, and translates mode→bools in `common_model_params_to_llama`
(`common/common.cpp:1563-1590`). ENGINE_PIN_GAP §1.1 row 1 sanctioned the bool-retaining
variant ("fork's loader keeps consuming those"), so the shape is per spec — but the collapse
loses expressiveness BOTH vs the old bool triple AND vs upstream:

- `--mlock --direct-io` (either CLI order): the dio lambda wins
  (`common/arg.cpp:2424-2426` maps any dio → DIRECT_IO), to_llama DIRECT_IO → mlock=false.
  Old bools honored both (`use_mlock=true` applied in the non-mmap path via
  `src/llama-model.cpp:1232` buffer mlock). mlock silently dropped.
- `--mmap --direct-io` on a platform where dio is unavailable: old loader negotiated
  (`src/llama-model-loader.cpp:569-580`: dio not available → reopen via fopen, mmap kept);
  new mapping forces DIRECT_IO → `mparams.use_mmap=false` → plain read() path, no mmap.
  Slower load, silent change.
- Upstream expresses dio+mlock via mode+modifier; the fork's enum cannot. No deprecation
  warnings either (upstream deprecated --mmap/--mlock/--direct-io).

Wrapper path unaffected: the wrapper (q66c `JSIParams.cpp:363-379`) derives load_mode from
JS use_mmap/use_mlock only and never produces DIRECT_IO; mapping back through to_llama is
exact for MMAP/MLOCK/MMAP_MLOCK/NONE. CLI single-flag behavior preserved (each lambda
re-derives from the current bool triple; `--mlock` alone → MMAP_MLOCK = old mmap+mlock
default ✓). Impact confined to dio flag combos in CLI campaign binaries.

### F4 — CONFIRMED (medium): activate_immediately consumes generation-prompt tokens from the budget (drift vs upstream #20297)

`common/sampling.cpp:319-322` feeds every `prefill_tokens` entry (= tokenized
`params.generation_prompt`, built at `common/sampling.cpp:270-284`) through
`llama_sampler_accept(rbudget, …)`. With `reasoning_budget_activate_immediately=true` the
diff initializes the sampler in `REASONING_BUDGET_COUNTING`
(`common/sampling.cpp:306-308`), and accept() in COUNTING decrements `remaining`
(`common/reasoning-budget.cpp:100-104`) → the budget is reduced by
len(tokenize(generation_prompt)) before the first generated token. Upstream #20297 puts the
sampler in the sampler chain with NO prefill accept (upstream
`common/sampling.cpp` hunk: plain `samplers.push_back(...)`) → upstream counts only
generated tokens. Genuine, non-cosmetic (state machine honors the param), but the effective
budget is short by the generation-prompt length (≈5-30 tokens for typical templates; with
budget ≤ prompt length the block is force-closed at generation start, upstream would allow
`budget` generated tokens first).

### F5 — CONFIRMED (medium-high, wrapper-reachable): budget=0 + activate_immediately silently never forces the end sequence

Wrapper sets `reasoning_budget_activate_immediately = thinking_forced_open`
(q66c `JSIParams.cpp:557-560`) whenever `thinking_budget_tokens >= 0` — **0 included** —
with non-empty tokenized end/forced sequences. Fork chain for budget=0:

1. `common_reasoning_budget_init_state` promotes COUNTING→FORCING when budget≤0
   (`common/reasoning-budget.cpp:215-216`), ctx: state=FORCING, force_pos=0.
2. `common/sampling.cpp:319-322` prefill loop accepts generation-prompt tokens; fork's
   accept() advances force_pos in FORCING state and flips to DONE once
   `force_pos >= forced_tokens.size()` (`common/reasoning-budget.cpp:117-122`).
3. Generation prompt is realistically ≥ forced-sequence length (template header + start
   tag ≥ 2 tokens; forced = message+end tag) → by first generated token the state is DONE
   (passthrough forever) → **apply() never masks logits during generation → the end
   sequence is never forced; the thinking budget feature is a silent no-op**.

Upstream #20297 advances force_pos in apply(), not accept() (upstream patch, FORCING case:
"force_pos is advanced in apply(), not here") → upstream forces the end sequence on the
first generated token for the same inputs. The same consumption bug existed pre-diff only
when the start tag sat inside the generation prompt with budget=0; the new
activate_immediately path makes it unconditional and exposes it to the wrapper for the
first time. Fix options: skip the prefill accept loop when initial_state != IDLE, or port
upstream's advance-in-apply() ordering. Note `common/reasoning-budget.cpp` is untouched by
the diff — the bug is inherited latent fork behavior newly reachable through the new
wrapper-facing field; the diff's comment ("start counting without waiting for the start
tag") does not describe this outcome.

### F6 — PLAUSIBLE (low-medium): activate_immediately is unreachable without start tokens; fork gate stricter than upstream

The rbudget creation gate `!params.reasoning_budget_start.empty() && …`
(`common/sampling.cpp:299`, pre-existing, unchanged) requires a non-empty start sequence.
Upstream #20297's gate is `reasoning_budget_tokens >= 0 && !forced.empty()` — no start
requirement — because activate_immediately exists precisely for the case where no start
tag will ever be emitted (thinking forced open without an explicit `<think>` token stream).
The wrapper tokenizes start only from the JS option `thinking_start_tag`
(q66c `JSIParams.cpp:540-543`); a JS caller that omits it (relying on the template to open
thinking) gets **no budget enforcement at all** where pristine 0.12.8 + b10156 would
enforce. In practice chat UIs pass both tags, so impact is bounded; still, the diff adds
the activate_immediately field without reconciling this gate, so the advertised semantics
("start counting without waiting for the start tag") can never trigger with an empty start
sequence.

### F7 — REFUTED: multi-end `reasoning_budget_end` adapter is NOT lossy for the wrapper

Task question: "wrapper pushes vector-of-vectors, first-sequence semantics documented?".
Verified against the actual wrapper source: `JSIParams.cpp` pushes **at most one** sequence,
gated non-empty (`if (!reasoningBudgetEnd.empty()) sparams.reasoning_budget_end.push_back(…)`
— q66c `JSIParams.cpp:546-549`), built from the singular JS `thinking_end_tag`. The retyped
field `std::vector<llama_tokens> reasoning_budget_end` (`common/common.h:289`) plus the
first-sequence adapter (`common/sampling.cpp:305`, `!front().empty()` guard :300) is exact
for the only known caller — the adapter is exercised as a single-element passthrough, not a
truncation. The tradeoff is explicitly documented at both sites (`common/common.h:287-288`,
`common/sampling.cpp:303-305`). Residual note: if a second non-empty sequence were ever
pushed (no caller does), it would be silently ignored — the `server-schema.cpp:398-399`
`.clear()`+`push_back()` keeps the server at exactly one sequence too. The added
`!front().empty()` guard preserves old behavior for every reachable state: old flat-empty
vector → skip; new `[[]]` (server client sending `reasoning_budget_end_tag: ""`) → skip;
both identical to pre-diff skip.

### F8 — REFUTED: plural `thinking_end_tags` contract satisfied via the apply() sync shim; fragility noted

Task question: "wrapper iterates AND calls .front()". Wrapper reads (verified):
`isThinkingForcedOpen` iterates `thinking_end_tags` (q66c `RNLlamaJSI.cpp:255-264`) and JS
exposure does `.empty()` + `.front()` (`RNLlamaJSI.cpp:877-880`). Fork producers set only
the singular field; the sync in `common_chat_templates_apply` (`common/chat.cpp:2858-2863`)
maintains the invariant plural=[singular] / singular=plural.front() on every apply, and
every wrapper path obtains chat params through `common_chat_templates_apply` (rn-llama.cpp
apply call sites). Singular consumers in the fork stay coherent unchanged
(`tools/server/server-common.cpp:1128`, `tests/test-chat.cpp:1138,1156` read
`thinking_end_tag`) → no regression for existing users, wrapper satisfied. **Fragility**:
the shim is load-bearing — wrapper `isThinkingForcedOpen` returns TRUE when the plural is
empty (loop body never executes → falls through to `return true`), so any future producer
path that bypasses `common_chat_templates_apply` would flip forced-open misdetection. Also
the `else if` branch silently overwrites a disagreeing singular with `plural.front()` —
dead today (no producer sets plural), fine by construction.

### F9 — CONFIRMED (low): get_caps/has_variant semantics diverge from the canonical llama.rn patch (mostly for the better)

Fork vs llama.rn v0.12.8 chat.cpp.patch (both fetched):
- `has_variant`: fork rejects the variant name `"default"`
  (`common/chat.cpp:2982-2988`: only `""` and `"tool_use"`); patch accepts
  `variant.empty() || variant == "default"`. Wrapper only calls with `""`/`"tool_use"`
  (verified RNLlamaJSI.cpp:302,318) → no behavioral delta for the wrapper.
- Null-safety: fork guards `chat_templates == nullptr` in both functions
  (`common/chat.cpp:2958-2960, 2978-2980`); the patch dereferences unguarded (would
  segfault). Fork strictly safer.
- Missing-variant `get_caps` fallback: both return the default-constructed struct with all
  four caps `= true` (fork `chat.h:368-373`; patch identical defaults) — an all-true
  overstatement footgun, but the wrapper gates every get_caps call behind has_variant, and
  the fork's own 1-arg map API (`common/chat.cpp:2944-2952`, preserved) is untouched.
  REFUTED as a wrapper-facing defect; CONFIRMED as undocumented divergence from the
  canonical patch text the team will otherwise treat as ground truth in Phase 3.

### F10 — CONFIRMED (low, latent): enum numeric values diverge from upstream

Fork `include/llama.h:208-215`: DIRECT_IO=4, plus MLOCK=2/MMAP_MLOCK=3 which do not exist
upstream; upstream DIRECT_IO=2. Nothing in the wrapper or fork compares/serializes the enum
numerically (verified: wrapper uses name equality only, q66c JSIParams.cpp:363-379; no
`.load_mode` int casts anywhere in the fork). Latent only: any future numeric
serialization of `load_mode` across an engine/patch boundary would silently corrupt.
`llama_load_mode_name()` (upstream companion API) is not backported — nothing needs it.
Enum sits inside `extern "C"` correctly (`include/llama.h:207` context verified).

### F11 — CONFIRMED (low): missing `default` in the to_llama switch → out-of-enum load_mode silently yields default mmap=true

`common/common.cpp:1563-1590`: the switch covers all five enum values but has no
`default:` and no `GGML_ABORT`. `mparams` starts as `llama_model_default_params()`
(`common/common.cpp:1552`) whose use_mmap=true; an out-of-range `load_mode` (reachable only
via a deliberate/UB cast or a future enum addition, since the field is not
JSI/JSON-serialized) would silently produce mmap-default loading instead of failing loudly.
Nit given reachability, but this is exactly the class of silent-fallback the hostile
brief asks to flag. Fix: `default: GGML_ABORT("invalid load_mode");`.

### F12 — CONFIRMED (info, not dead): progress_callback alias is live and coherent

`common/common.h:731-733` adds wrapper-facing aliases; `common/common.cpp:1608-1609`
switches callback AND user_data together (no mixed-pairing hole), falling back to the
fork's legacy `load_progress_callback` pair when the alias is unset. Wrapper assignment
verified: lambda + `progress_callback_user_data = progressData.get()` (q66c
RNLlamaJSI.cpp:552-589). Callback genuinely reaches the loader via `mparams.progress_callback`
(existing invocation machinery, e.g. `tests/test-model-load-cancel.cpp` upstream-equivalent
path). Server consumers unaffected: `tools/server/server-context.cpp:1147-1148,1176-1177`
set only the legacy pair (fallback hits), and the mmproj path sets mparams directly
(:1056-1057), bypassing to_llama. No fork code writes the new alias → no conflict. Default
fields NULL → byte-identical default path. Not a dead field.

### F13 — CONFIRMED (info, not dead): vocab_only threaded and honored

`common/common.h:578` field → `common/common.cpp:1562` `mparams.vocab_only = params.vocab_only`
→ existing loader honoring (`src/llama.cpp:305,325,367`; hparams propagation
`src/llama-hparams.h:44`, gated loads `src/llama-model.cpp:1061,1752`). Wrapper's
`vocab_only` JS option (q66c JSIParams.cpp:323-334: sets field, forces `warmup=false`,
n_ctx floor 512) now flows end-to-end via `common_init_from_params` → to_llama (the only
conversion, `common/common.cpp:1347,1551`). Default false → byte-identical. Not dead.

### F14 — CONFIRMED (info): mtmd text_len clean; one pre-existing UB nit

`tools/mtmd/mtmd.h:70` adds `size_t text_len` (C-compatible struct, no default initializer
possible → every construction site must set it). Exhaustive construction sweep:
- fork: `tools/mtmd/mtmd-cli.cpp:252-255` (field-by-field, text_len set) and
  `tools/server/server-common.cpp:707-712` (positional aggregate, updated in-diff to
  `{prompt.c_str(), prompt.size(), true, true}` — order matches struct) — both covered;
- fork `*.c` files: zero constructions (test-mtmd-c-api.c never builds one);
- wrapper: `rn-mtmd.hpp:281-283` zero-initializes `mtmd_input_text input_text{};` then sets
  `text_len = prompt.size()` → no uninitialized-read path anywhere.
`tools/mtmd/mtmd.cpp:842` now honors the length (`input_text.assign(text->text,
text->text_len)`) — the point of the field (exact-length text, null-safe). Nit:
`assign(nullptr, 0)` is formally UB if a caller passes null text with len 0; the old
`input_text = text->text` had the same exposure — pre-existing, not introduced. ABI: all
consumers recompile together in the generated tree; no stale-TU risk identified. One
landmine note for the future: the struct cannot grow a default, so any new construction
site (fork or wrapper patch) that forgets `text_len` reads stack garbage — worth a comment
in mtmd.h, which the diff does not add.

### F15 — CONFIRMED (process): one-line commit message for a surface this delicate

`git log -1 --format=%B cb9fdd1f8` → "app-pin-compat-surface". No rationale for the
5-value enum divergence from upstream #20834 (F3/F10), no note that chat.h.patch/chat.cpp.patch
caps hunks must be dropped at bootstrap (F1), no record of the deliberate first-sequence
adaptation decision trail (F7) beyond code comments. For a compatibility surface whose
correctness is contractual against an external wrapper, this is inadequate.

### F16 — CONFIRMED (test honesty): none of the repo's passing tests exercise any new branch

Test files present in the fork (`tests/`): test-reasoning-budget.cpp, test-sampling.cpp,
test-chat.cpp, test-chat-template.cpp, test-chat-auto-parser.cpp, test-chat-peg-parser.cpp,
test-arg-parser.cpp, test-mtmd-c-api.c. Grep-verified probes:
- `test-reasoning-budget.cpp` drives `common_reasoning_budget_init(..., initial_state)`
  DIRECTLY (including COUNTING/budget=0 cases from #20297 ancestry) — it never goes through
  `common_sampler_init`, so the fork's prefill-accept loop that produces F4/F5 is invisible
  to it; it validates pre-existing machinery, not the diff.
- `test-sampling.cpp`: zero `reasoning_budget` references → the new rbudget branch
  (`common/sampling.cpp:298-322`) untested.
- `test-arg-parser.cpp:167` asserts only `params.use_mmap == false` — the load_mode outputs
  of the three new arg.cpp lambdas are asserted nowhere.
- No test touches: the load_mode switch outputs, plural sync shim, 2-arg get_caps,
  has_variant, text_len, progress fallback pairing, vocab_only threading.
Whichever 7 tests were reported passing, they pass because the new code is never exercised
— with the single exception that they also prove no default-path regression (which F17
confirms by inspection). Untested-by-design list is exactly the fix-verification list:
F2's finetune path, F3's dio combos, F4/F5's activate_immediately paths, F1's bootstrap
reproduction, F9's new overloads.

### F17 — REFUTED: default-path byte-identity for defaults holds (CLI campaign binaries safe) — except F2/F3

Task question 3, audited line-by-line:
- `load_mode` default `LLAMA_LOAD_MODE_MMAP` (`common/common.h:487`) → switch yields
  use_mmap=true/dio=false/mlock=false == old bool defaults → mparams identical.
- arg.cpp lambdas re-derive mode from the bool triple on every flag write, so bools and
  mode stay mirrored for CLI parsing in both orders (`--mlock --no-mmap`, `--no-mmap
  --mlock` → MLOCK; verified case by case) — single-flag behavior unchanged; only dio
  combos degrade (F3).
- `initial_state=IDLE` explicit == old implicit default (`common/reasoning-budget.h:40`),
  args otherwise identical.
- `!front().empty()` guard: no reachable old-passing/new-failing state (F7 analysis).
- server-schema `.clear()+push_back` == old assignment for the single-sequence flow.
- Singular `thinking_end_tag` consumers (`server-common.cpp:1128`, tests) unchanged;
  1-arg `get_caps` preserved verbatim; 2-arg wrapper calls resolve unambiguously to the new
  overload (1-arg not viable with 2 args).
- `src/` untouched; `llama_model_params` struct untouched (enum-only addition to llama.h).
→ No default-path regression for the CLI campaign binaries. The two exceptions are already
filed as F2 (finetune's post-parse mutation) and F3 (dio flag combos) — both non-default
paths.

### F18 — note: no compile verification performed

No C++ toolchain (gcc/clang/cl/cmake/ninja/make) exists on this review machine; nothing was
built. All compile-level claims (signatures, overload resolution, `llama_tokens` visibility
at common.h:58 vs use at :289, enum-in-extern-"C", jinja::caps field names at
common/jinja/caps.h) were verified by header/impl tracing only. The Android/generated-tree
compile remains unproven until Phase 3 — and per F1 it is expected to FAIL in the
generated tree until the llama.rn patch set is reconciled.

## Verdict

Wrapper-facing contract (GAP_JSI call sites): **satisfied** — all 10 hard compile blockers
from GAP_JSI §8.6 that belong to §1.1 are addressed with matching shapes, `llama_log_callback_default`
correctly NOT backported (ENGINE_PIN_GAP correction #1 verified: present at
`src/llama-impl.h:25`/`src/llama-impl.cpp:62`), `llama_get_ctx_other` correctly absent
(llama.rn-side patch). Default paths regression-clean (F17). Dead-field prohibition
respected: load_mode, vocab_only, progress_callback, activate_immediately all drive
behavior (F11-F13 traceability; F4/F5 show the reasoning branch is genuinely wired, not
cosmetic).

Must-fix before Phase 3 (in priority order):
1. F1 — strip the caps hunks from llama.rn chat.h.patch/chat.cpp.patch (or drop the
   fork-side symbols); also obsolete the common.h.patch/sampling.cpp.patch hunks now
   duplicated by this diff.
2. F5/F4 — guard the prefill accept loop for non-IDLE initial_state (and consider
   upstream's advance-in-apply() ordering) so budget=0 + forced_open enforces.
3. F2 — finetune (and any post-parse bool mutation) must update load_mode.
4. F11 — abort on out-of-enum load_mode; F15 — document F3/F10 divergence in the commit
   history.

**FINAL VERDICT: PASS-with-fixes**

COMPLETE — REVIEW_PHASE2 (q66-app-lifecycle-s23, diff a0cabca6b..cb9fdd1f8, reviewed 2026-08-27)
