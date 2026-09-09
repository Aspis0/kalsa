# Hostile audit: S2 governor owner (feat/governor-in-app @ 67c9f7f)

Method: read-only. Plan S2 + AUDIT-PLAN fallback/oracle; applied `node_modules/llama.rn/cpp/` + `patches/llama.rn+0.12.8.patch`; fork `kalsallama-wt-governor-v03` @ `8665e9a9`. No builds, no other writes.

**Overall: NO-GO.** Flag-on load never constructs `completion` / `templates` / `n_ctx`; first completion is a null deref. S2’s own test (“flag-on synthetic turn and save/restore complete”) cannot pass.

## 1. FLAG OFF = byte-for-byte today — REFUTED (strict) / functionally close

S2 hunks wrap every listed decode/ctx read. Flag-off still hits extra work:

- Every init: `llama_governor_params governorParams{};` + `parseGovernorLoadParams` (`RNLlamaJSI.cpp:640-642`).
- Every owner: 3 extra unique_ptrs (`rn-llama.h:122-124`).
- Every decode: `governor ? governor->decode(batch) : llama_decode(ctx, batch)` (`rn-llama.cpp:521-522`).
- `.so` always compiles `rn-governor.cpp` (patch android CMake + ios `rn-governor.cpp`).
- `shouldUseMTP` extra branch (`rn-completion.cpp:719-721`).

Sampling order / error text with **no `governor` key**: `active_ctx()` returns `ctx` (`rn-llama.cpp:517-518`). No changed error string on the CPU path.

Trap: `governor` object without bool `enabled` throws `"governor.enabled must be a boolean"` (`RNLlamaJSI.cpp:244-246`) — new FLAG-OFF failure if JS ever stubs the key.

**Verdict:** REFUTE “byte-for-byte”; PLAUSIBLE “same sampling/errors when key absent”.

## 2. `llama_decode` / `ctx` routing table

| site | routed? |
|---|---|
| `rn-llama.cpp:522` `llama_decode(ctx, batch)` | accessor; FLAG-OFF only |
| `rn-completion.cpp:849` `parent_ctx->decode(spec_batch)` | accessor; MTP throws first if governor |
| `rn-completion.cpp:941` same | accessor |
| `rn-completion.cpp:1104` `parent_ctx->decode(llama_batch_get_one(...))` | accessor |
| `rn-completion.cpp:1473` bench `parent_ctx->decode(batch_view)` | accessor |
| `rn-slot-manager.cpp:991` `parent_ctx->decode(batch)` | accessor |
| `rn-completion.cpp:639` `llama_encode(parent_ctx->active_ctx(), ...)` | **not** governor-decode |

Leftover **member** `ctx` (set to prefill: `owner.ctx = owner.governor->prefill_ctx();` `rn-llama.cpp:93`) in governor mode:

- `rn-llama.cpp:825` `common_tokenize(ctx, ...)` — prefill; OK vs bench tokenize-on-prefill.
- `rn-llama.cpp:1025` `llama_get_memory(ctx)` in `clearCache` — **prefill KV only**. CONFIRMED bug.
- `rn-llama.cpp:857` `common_set_adapter_lora(ctx, lora)` — prefill only; JSI apply has no governor guard (`RNLlamaJSI.cpp:2011`).
- `rn-llama.cpp:880` `llama_rn_context_mtmd(..., ctx, ...)` — prefill; `llamaInitMultimodal` unguarded (`RNLlamaJSI.cpp:2071`).
- `rn-llama.cpp:722` `cparams.ctx_other = ctx` MTP — dead if load refusal holds.

JSI/completion/slots/session swapped `ctx->ctx` → `active_ctx()`. No leftover `ctx->ctx` in listed JSI files.

**Verdict:** decode calls routed; leftover prefill alias is a governor-mode bug (clearCache / LoRA / mmproj).

## 3. Lifecycle

**Owners:** two `common_init_result_ptr` (models, `model_only=true`) + `unique_ptr<rn_governor>` (contexts via `llama_governor_init_with_params`). Models borrowed (`llama-ext.h:329`).

**Dtor order:** members reverse of `rn-llama.h:121-126`: `ctx` ptr, `llama_init`, **`governor` (frees both contexts)**, `governor_decode_init`, `governor_prefill_init` (models), `moe_stream`. Body (`rn-llama.cpp:499-515`) does not `llama_governor_free` itself. Order is correct. `llama_governor_free` is `delete governor` (`llama-governor-runtime.cpp:195`).

**Reject:** ctor frees both ctx then throws (`llama-governor.cpp:45-50`); C API returns nullptr (`llama-governor-runtime.cpp:186-191`); wrapper throws `"llama_governor_init_with_params returned null"` (`rn-governor.cpp:17-19`); catch resets both inits (`rn-llama.cpp:82-89`). No double-free. JSI then `delete ctx; throw "Failed to load model"` (`RNLlamaJSI.cpp:770-772`). **No CPU reload.** PLAN §4 / S2 test “existing CPU load path succeeds” is **not implemented**. CONFIRMED.

**Second-model fail:** `return false` at `rn-llama.cpp:72-74` without FALLBACK; first GPU model lives until JSI `delete ctx`. CONFIRMED.

**Sticky:** `llama_governor::decode_impl` `if (failed) return fail("governor is failed")` (`llama-governor.cpp:151-153`). Wrapper sets `failed_` on rc≠0 && rc≠-2 (`rn-governor.cpp:47-51`). Completion does not swap to `llama_decode(ctx)`. CONFIRMED no mid-turn single-ctx fallback.

**-2 wait:** not sticky; `if (parent_ctx->decode(...))` stops the loop (`rn-completion.cpp:1104-1116`); `governorFailed()` false → JSI may return empty success (`RNLlamaJSI.cpp:1294-1302`). PLAUSIBLE silent abort.

**Flag-on load hole (blocker):** `if (governor_enabled) return load_governor_models(...)` (`rn-llama.cpp:604-606`) skips `completion = new llama_rn_context_completion(this)` (`:687`), `templates = ...` (`:667`), `n_ctx = llama_n_ctx(ctx)` (`:668`). JSI `ctx->completion->rewind()` (`RNLlamaJSI.cpp:1149`) UAF/null. Even if patched, `num_prompt_tokens >= (size_t)parent_ctx->n_ctx` with `n_ctx=0` (`rn-completion.cpp:410`) marks every prompt full.

## 4. Memory / mmap

Two `llama_model_load_from_file` via `common_init_from_params(..., true)` (`rn-llama.cpp:66,71`; `common.cpp:1236,1359-1360`). `prefill_params.n_gpu_layers = 99;` `decode_params.n_gpu_layers = 0;` (`rn-llama.cpp:61-62`). `use_mmap` copied from `owner.params`; default `bool use_mmap = true;` (`common.h:574`); JSI `cparams.use_mmap = getPropertyAsBool(..., "use_mmap", cparams.use_mmap)` (`JSIParams.cpp:358`). Both loads share the flag. CONFIRMED two model objects, mmap unless JS disables it.

## 5. Refusals

| path | loud fail? | bypass |
|---|---|---|
| parallel load `n_parallel > 1` | throw `rn-llama.cpp:565-566` | — |
| `enableParallelMode` | throw `rn-llama.cpp:946-948` | slot-manager itself has **no** `hasGovernor` |
| MTP/spec load | throw `:568-569` | — |
| `shouldUseMTP` / `should_use_mtp` | throw `rn-completion.cpp:719-720`; `rn-slot.cpp:334-335` | — |
| session save/load | throw `JSISession.h:48-49`, `:157-158` | no other `llama_state_{save,load}_file` in jsi/ |
| moe_stream / LoRA at load | throw `:571-576` | runtime `applyLoraAdapters` + `initMultimodal` **unguarded** |

S2 also required paired session save/load API. Implementation is cold-session refusal, not the API. CONFIRMED gap vs plan §1/S2.

## 6. Params / thermo

- Missing `gpu_fit` → `""` → `Unknown` (`RNLlamaJSI.cpp:218-219`). **Not** Fit. REFUTE “default Fits”.
- `npu_lane_enabled` default false (`JSIParams.h:12`); `true` throws (`RNLlamaJSI.cpp:278-279`).
- **Permissive default:** `reload_budget_available` uses struct `true` (`llama-ext.h:214`; parse `RNLlamaJSI.cpp:268-269`). Gates GPU_COOLMODE (`llama-governor-policy.cpp:228`). CONFIRMED.
- `admission_margin_c` defaults `0.5f` (`llama-ext.h:215`).
- Thermo: **not** at init. Set at completion (`RNLlamaJSI.cpp:1154-1156,1196-1197`). `sensor_valid=false` → `profile_is_valid` false (`llama-governor-policy.cpp:54-55`) → `set_thermo_profile` false → JSI `"Invalid governor_thermo profile"` — never reaches Invalid-admission CPU path. CONFIRMED mismatch vs PLAN §3. `batt_level_pct` missing → 100 (`RNLlamaJSI.cpp:296`).

## 7. `KALSA_GOVERNOR_FALLBACK`

Present only in ctor catch: `LOG_ERROR("KALSA_GOVERNOR_FALLBACK {stage:\"init\", models_loaded:2, reason:\"%s\"}", error.what());` (`rn-llama.cpp:83`). Fields: stage, models_loaded, reason. **Missing** fit/profile (PLAN §4). Reason on Reject is `"llama_governor_init_with_params returned null"`, not `"governor contexts have incompatible KV routes"` (swallowed at `llama-governor-runtime.cpp:189-191`).

Reachable: Reject / ctx-create throw. **Not** reachable: first-model fail (`:67-68`), second-model fail (`:72-74`), JSI no-GPU throw (`RNLlamaJSI.cpp:680-682`). CONFIRMED incomplete.

Turn line `KALSA_GOVERNOR {prefill_engine:... fallback_reason:\"\"}` (`rn-llama.cpp:548-549`) is separate; `fallback_reason` hardcoded empty.

## 8. Hygiene

- Patch `2747` lines: CONFIRMED (`wc -l patches/llama.rn+0.12.8.patch`).
- Pin `native/kalsallama.pin` `"commit": "8665e9a9fc533c0775de153563b97f8a753a7737"`; `VENDOR_SHA` same; fork HEAD same.
- Sync list: 13 governor sources + existing `llama-ext.h` (`sync-kalsallama.sh:366-373`). Plan bullet list is 13 files; comment calls it “14-file set” counting `llama-ext.h`. Count=13 new. No `llama-governor-runtime.h`.
- Vendor vs fork: `llama-governor-policy.cpp` byte-equal; `llama-governor.cpp` / `llama-kv-commit.cpp` differ only `ggml_*` → `lm_ggml_*`. node_modules == vendor for those three.
- No `.o` / CMakeCache under vendor. 67c9f7f touches only patch + sync script.

## 9. Tests / S3 bar

**None.** `git diff --name-only 414b494..67c9f7f` = patch + `sync-kalsallama.sh`. No flag-off, Reject, sticky, or session tests.

Reviewer must demand before S3: (1) governor load finishes `completion`/`templates`/`n_ctx` like CPU path; (2) native or LlamaService CPU retry after FALLBACK with both models gone; (3) FALLBACK fields + logs on model-load fail; (4) tests: FLAG-OFF path identity, Reject→unload+FALLBACK, sticky no single-ctx, parallel/MTP/session loud fail, mmap ngl 99/0; (5) thermo after init before first decode without treating Invalid as a hard JSI throw unless specified; (6) `clearCache`/LoRA/mmproj through both contexts or refuse; (7) drop permissive `reload_budget_available=true`; (8) paired session API or an explicit S2 exception to PLAN.

**NO-GO.**

## Delta audit (42ddcf4 = b3a6137 + 1766cd3 + 42ddcf4 on 67c9f7f)

Method: opened every cited site in `/Users/marco/Projects/kalsa-wt-governor`. No builds. Previous NO-GO crash (no `completion`/`n_ctx`) is gone. Residual: duplicate FALLBACK, init-Reject reason still swallowed, test not in the build.

### 1. Convergence `rn-llama.cpp:629-784` — CONFIRMED with leftovers

CPU-only unique: `moe_stream` + `llama_init` + optional draft (`:687-745`). Governor returns from `load_governor_models` then **joins** at `:748-784`: templates, `n_ctx`, lora metadata, `n_seq_max` log, `completion`, `ctx_shift` log.

| member | CPU | governor |
|---|---|---|
| `templates` | `common_chat_templates_init(model, …)` `:753` | `…(governor_decode_init->model(), …)` `:749-750` (decode GGUF, while `model` is prefill `:133`) |
| `n_ctx` | `llama_n_ctx(ctx)` `:754` | `llama_n_ctx(active_ctx())` `:751` |
| `n_seq_max` log | `llama_n_seq_max(ctx)` `:769` | `llama_n_seq_max(active_ctx())` `:768` |
| `lora` metadata | `:760-764` | same |
| `completion` | `:776` | same |
| `ctx_shift` log | `:779` | same |
| `llama_init` | set `:696` | **stays null** (uses `governor_*_init`) |
| `moe_stream` | `make_unique` `:688` | **not reset**; CPU→governor reload leaves a shutdown object (`:675` shutdown only) |
| `draft_model` | maybe loaded `:740` | reset `:659`, stays null (MTP refused) |
| `threadpool*` | `attachThreadpoolsIfAvailable` after load | skipped `if (governor) return false;` `:488-490` |

Blocker from parent audit (null `completion` / `n_ctx=0`) **FIXED**.

### 2. `KALSA_GOVERNOR_FALLBACK` — PARTIAL

Logger `:62-64`: `{stage, models_loaded, reason, gpu_fit, profile_valid}`.

| claim | actual |
|---|---|
| accelerator-load | CONFIRMED `:98-100` `stage:"accelerator_model_load"` models_loaded=0 |
| cpu-load | CONFIRMED `:108-110` `stage:"cpu_model_load"` models_loaded=1; `cleanup()` drops the GPU model |
| init | CONFIRMED `:125` `stage:"init"` (42ddcf4 renamed from `governor_init`) |
| route Reject | **REFUTED as init stage.** `llama_kv_route::Reject` still throws `"governor contexts have incompatible KV routes"` (`llama-governor.cpp:45-50`); C API returns nullptr; wrapper throws `"llama_governor_init_with_params returned null"` (`rn-governor.cpp:18-20`). Logged as **`init`**, reason generic. A **second** line is emitted from the overlay C API: `stage:"route_reject"` `profile_valid:1` hardcoded (`llama-governor-runtime.cpp:193-197`) **before thermo is set**. Decode-time `"route Reject during phase handoff"` (`llama-governor.cpp:191`) maps to `route_reject` via `reason.find("route Reject")` (`rn-llama.cpp:584-587`) — that is commit fail, not `llama_kv_route::Reject`. |

`common_init_from_params` does not throw (`common.cpp:1350+`); the `try/catch` at `:93-96/:103-106` is dead. The `if (model()==nullptr)` arms are live.

### 3. Thermo — CONFIRMED load gate; citation sloppy

- Absent `governor` key: `parseGovernorLoadParams` `return false` **before** `jsiToGovernorJson` (`RNLlamaJSI.cpp:236-238`).
- Parse+validate is `rn-governor-params.cpp:153-156` (`thermo = parse_governor_thermo(governor.at("thermo")); if (!governor_thermo_profile_is_valid(thermo)) throw "governor: thermo profile invalid"`), called from `:239-240`, **before** `loadModel` / any mmap. Belt: `loadModel` `:639-640` same throw if pointer null/invalid.
- Set-before-decode: **after both models** `set_thermo_profile` `:120-123`. Not before load. If this throws, FALLBACK `init` models_loaded=2 then `cleanup()`.
- Per-turn: `governor_thermo` is now **optional** (`RNLlamaJSI.cpp:1107-1111`); missing key reuses init profile. Invalid turn throw is `"Invalid governor_thermo profile"` `:1150-1151`, different string.

### 4. Refusals — CONFIRMED

- LoRA load `:651-652`; runtime apply/remove `:929-931`, `:961-963`.
- Multimodal `:980-982`.
- Parallel load `:642-643`; `enableParallelMode` `:1051-1053`.
- MTP load `:645-646`; `createMTPDraftContext` `:796-798`; `shouldUseMTP` `rn-completion.cpp:719-720`; `should_use_mtp` `rn-slot.cpp:334-335`.
- Sessions `JSISession.h:48-49`, `:157-158`.
- `clearCache` `:1125-1129`.

Still no paired session API (S2 plan). Loud fail only.

### 5. Defaults — CONFIRMED

`reload_budget_available = bool_or(..., false)` (`rn-governor-params.cpp:125`) and vendor/node `llama-ext.h:214` now `= false` (fork overlay mutation). Absent `gpu_fit` → `""` → `Unknown` (`:59-60,:131`). Test asserts both (`scripts/governor-params-test.cpp:32-33`).

### 6. Parser test — PLAUSIBLE run, no recipe

Covers: minimal (Unknown fit, reload false, `batt_level_pct==100`), full enums, explicit reload true, `sensor_valid:false` → exact `"governor: thermo profile invalid"`, `enabled:false`. Does **not** cover missing `thermo`, `npu_lane_enabled`, plugged+bad `t_idle`, FLAG-OFF JSI.

No compile command in `package.json` / `scripts/*.sh` / CMake. `logs/governor-params-test.log` is one line `governor_params=PASS` (printed at `:71` then `return 0`). No `echo $?`, no argv. **No exit-code evidence.**

### 7. FLAG-OFF — CONFIRMED

`:236-238` returns before JSON. `rn-llama.cpp:576-577` `if (!governor) { return llama_decode(ctx, batch); }` is the only `llama_decode(` in `rn-llama.cpp` / completion / slots / JSI. Engine still has `llama_decode(target, batch)` at `llama-governor.cpp:195`. Extra FLAG-OFF cost (empty unique_ptrs, parse probe) unchanged.

### 8. Accessor sites — CONFIRMED

| site | verbatim |
|---|---|
| `rn-completion.cpp:849` | `const int ret = parent_ctx->decode(spec_batch);` |
| `:941` | `const int ret = parent_ctx->decode(spec_batch);` |
| `:1104` | `if (parent_ctx->decode(llama_batch_get_one(&embd[n_past], n_eval)))` |
| `:1473` | `const int ret = parent_ctx->decode(batch_view);` |
| `rn-slot-manager.cpp:991` | `int ret = parent_ctx->decode(batch);` |
| `rn-slot.cpp:468` | `const int ret = parent_ctx->decode(spec_batch);` |
| `:543` | `const int ret = parent_ctx->decode(spec_batch);` |

Zero `parent_ctx->ctx` in those three files. `tokenize` now uses `active_ctx()` (`rn-llama.cpp:918`). Leftover: `llama_encode(parent_ctx->active_ctx(), …)` `:639` (not governor-decode).

### 9. New breakage

- **Double FALLBACK** on init KV Reject: overlay C API `route_reject` + owner `init`/`returned null`. `profile_valid:1` is a lie (thermo not applied). CONFIRMED.
- Thermo-on-null: `setThermoProfile` short-circuits (`:605-606`); `rn_governor::set_thermo_profile` guards `governor_ == nullptr` (`rn-governor.cpp:62-63`). After `cleanup()`, unique_ptrs empty then JSI `unique_ptr` dtor. **No double-free** seen: `cleanup()` `:78-84` is `governor` then decode then prefill. CONFIRMED OK.
- `fail()` catch around non-throwing `common_init_from_params` is dead. Harmless.
- Per-turn thermo no longer required: PLAN “once per turn” not enforced.

**Delta verdict: GO-WITH-FIXES.** Ship-blockers from parent audit (null completion / n_ctx=0 / silent clearCache) are fixed. Do not start S3 until: (a) one FALLBACK line per init Reject with the KV-route reason, not `returned null` + hardcoded `profile_valid:1`; (b) `moe_stream.reset()` on the governor arm; (c) test hooked to a real compile+`echo $?` in-tree; (d) document that CPU retry is S4 (still absent).
