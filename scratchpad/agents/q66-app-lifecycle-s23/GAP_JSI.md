# GAP_JSI — symbol-level gap: llama.rn 0.12.8 wrapper vs kalsallama engine @ a0cabca6b

Status: IN PROGRESS (incremental)

- Wrapper side (read-only): `C:\Users\gualt\q66c\node_modules\llama.rn\` (version 0.12.8, pristine + app patch).
- Engine side (read-only): `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge\third_party\llama.cpp` @ `a0cabca6b`.
- Convention: engine symbols are recorded UNPREFIXED (bootstrap.sh applies ggml_→lm_ggml_ / GGML_→LM_GGML_ at generation time). A symbol "counts as present" if the unprefixed fork header declares it.
- Compiled TU list (Android, from `android/src/main/CMakeLists.txt`):
  - JNI target (always): `android/src/main/RNLlamaJSI.cpp`, `cpp/jsi/RNLlamaJSI.cpp`, `cpp/jsi/JSIContext.cpp`, `cpp/jsi/JSIUtils.cpp`, `cpp/jsi/JSIParams.cpp`, `cpp/jsi/JSITaskManager.cpp`, `cpp/jsi/ThreadPool.cpp`
  - rnllama target: globbed `llama*.cpp`, `common/*.cpp`, `common/jinja/*.cpp`, `tools/mtmd/**.cpp`, `models/*.cpp`, ggml files + `cpp/rn-llama.cpp`, `cpp/rn-completion.cpp`, `cpp/rn-tts.cpp`, `cpp/rn-slot.cpp`, `cpp/rn-slot-manager.cpp`
- Backport sizes: S = field/enum one-liner + trivial glue; M = one coherent function/small struct across 1–3 engine files; L = multi-file feature chain (parser + sampler + chat + tests).

## Sections (filled incrementally)

1. [x] Wrapper inventory (files, what they include)
2. [x] common_params / common_params_sampling fields
3. [x] common_chat_* types & fields (incl. thinking_end_tag vs thinking_end_tags)
4. [x] common_sampler_* / reasoning-budget API
5. [x] llama_* API (include/llama.h)
6. [x] common_* misc functions/structs (common_init, tokenize, mtmd, etc.)
7. [x] ggml_/gguf_ API surface referenced by wrapper
8. [x] Known-missing verification: load_mode, reasoning_budget_activate_immediately, thinking_end_tags
9. [x] COMPLETE marker (end of file)
---

## 1. Wrapper inventory (what reads engine headers)

| File (wrapper, llama.rn 0.12.8 + app patch) | Engine headers included | Notes |
|---|---|---|
| `cpp/rn-llama.h` (242 ln) | chat.h, common.h, ggml*.h, gguf.h, llama.h, llama-model.h, llama-impl.h, sampling.h | main context struct; `llama_model_ptr`, `common_init_result_ptr`, `common_chat_templates_ptr` |
| `cpp/rn-llama.cpp` (892 ln) | + tools/mtmd/{mtmd,mtmd-helper,clip}.h | loadModel, MTP draft context, LoRA, chat templates |
| `cpp/rn-completion.h/.cpp` (218+1603 ln) | + speculative.h, llama-ext.h (llama.rn staging hdr) | sampling, state checkpoints, MTP, embeddings, bench |
| `cpp/rn-slot.cpp` / `rn-slot-manager.cpp` (1145+1677 ln) | chat.h, ggml.h | parallel slots, shared MTP, state save/load |
| `cpp/rn-tts.cpp/.h` (604+59 ln) | llama.h, common.h | vocoder; `llama_model::name`, `llama_model_n_embd_out` |
| `cpp/rn-mtmd.hpp` (776 ln) | tools/mtmd/* | media tokenize/eval, bitmap hashing |
| `cpp/rn-common.hpp` (206 ln) | llama.h, ggml-backend.h | device info; llama.rn-LOCAL helpers `find_partial_stop_string` / `find_common_prefix_length` / `format_rerank_tokens` (rn-common.hpp:143,159,167) — NOT engine symbols |
| `cpp/jsi/JSIParams.cpp` (679 ln) | speculative.h (+ JSINativeHeaders.h → common.h, chat.h, gguf.h, ggml-backend.h, json-schema-to-grammar.h) | `parseCommonParams` / `parseCompletionParams` — densest field-access site |
| `cpp/jsi/RNLlamaJSI.cpp` (2204 ln) | via JSINativeHeaders.h | bindings; chat caps; device overrides; progress callback |
| `cpp/jsi/JSIHelpers.h` (54 ln) | | `lm_gguf_*` model-info reader |
| `cpp/jsi/JSICompletion.h` (265 ln) | | result marshalling; `llama_perf_context_data` fields |
| `cpp/jsi/JSISession.h` (177 ln) | | `llama_state_load/save_file`, memory reconcile |
| `android/src/main/RNLlamaJSI.cpp` (65 ln) | llama.h, llama-impl.h | JNI entry only — no engine symbols beyond includes |

App patch vs pristine 0.12.8 (diff vs tag): JSIParams.cpp 13 ln, RNLlamaJSI.cpp 3 ln, rn-llama.cpp 13 ln, rn-completion.cpp 40 ln, rn-slot.cpp 5 ln — all other glue files identical. Patch content: DFlash speculative-type handling, `cpuparams_batch.n_threads` passthrough, ctx_type fallback via `llama_model_n_layer_nextn`, KALSA_KVDIAG logging, `kalsa-native-patches` marker. The app patch introduces NO new engine symbols except `COMMON_SPECULATIVE_TYPE_DRAFT_DFLASH` (present in fork, see §4).

Engine base of pristine 0.12.8: llama.cpp **b10156 @ 91f8c9c** (`src/version.ts`). The kalsallama fork @ a0cabca6b is a pre-b10156-lineage fork (branched before upstream PRs #20834 and #25544) with Kalsa additions. That lineage difference is the source of most gaps below.

Legend: **yes** = present in fork (unprefixed name, bootstrap adds lm_/LM_ at generation); **diff** = present with different type/signature/name; **no** = absent.

---

## 2. common_params and sub-struct fields

### 2a. common_params top-level fields (fork: common/common.h:449)

| Symbol | Where used (wrapper) | Present in fork? | If gap: role per llama.rn usage + backport size |
|---|---|---|---|
| `model.path` (common_params_model) | rn-llama.cpp:471,474,509; rn-tts.cpp:434; jsi/JSIParams.cpp:323 | yes (common/common.h:315) | — |
| `speculative` (common_params_speculative) | rn-llama.cpp:488-506,568-572; rn-completion.cpp:628-633,698-722; jsi/JSIParams.cpp:208-310 | yes (common/common.h:372) | — |
| `sampling` (common_params_sampling) | rn-completion.cpp:37-44,73; rn-slot-manager.cpp:572; jsi/JSIParams.cpp:432+ | yes (common/common.h:227) | — |
| `vocoder.use_guide_tokens` | jsi/RNLlamaJSI.cpp:1107 | yes (common/common.h:410) | — |
| `prompt` | rn-completion.cpp:415,1307; jsi/JSIParams.cpp:432 | yes (common/common.h:501) | — |
| `antiprompt` | rn-completion.cpp:38,1057,1320; rn-slot-manager.cpp:592 | yes (common/common.h:526) | — |
| `n_predict` | rn-completion.cpp:619,831-836,1052,1090; jsi/JSIParams.cpp:434 | yes (common/common.h:450) | — |
| `n_ctx` | rn-completion.cpp:34,843,970,1081; jsi/JSIParams.cpp:336 | yes (common/common.h:451) | — |
| `n_keep` | rn-completion.cpp:282-291,988-995 | yes (common/common.h:455) | — |
| `n_batch` | rn-completion.cpp:560,970,1368; jsi/JSIParams.cpp:338 | yes (common/common.h:452) | — |
| `n_ubatch` | rn-completion.cpp:1369; jsi/JSIParams.cpp:339,398 | yes (common/common.h:453) | — |
| `n_parallel` | rn-llama.cpp:445-451; jsi/JSIParams.cpp:340 | yes (common/common.h:457) | — |
| `cpuparams`, `cpuparams_batch` (common_cpu_params) | rn-llama.cpp:394-397,1020; jsi/JSIParams.cpp:341,347,676,683 | yes (common/common.h:494-495) | — |
| `n_gpu_layers` | rn-llama.cpp:501; jsi/JSIParams.cpp:359 | yes (common/common.h:485) | — |
| `fit_params` | jsi/JSIParams.cpp:320 | yes (common/common.h:486) | — |
| `chat_template` | rn-llama.cpp:520,638; jsi/JSIParams.cpp:356 | yes (common/common.h:630) | — |
| `vocab_only` | jsi/JSIParams.cpp:324-334 | yes (llama_model_params has it; common_params does NOT expose vocab_only — see note) | **NOTE**: wrapper sets `cparams.vocab_only`/`cparams.warmup` on **common_params** (jsi/JSIParams.cpp:324-330). Fork common_params has `warmup` (common/common.h:570) but I found **no `vocab_only` field in common_params** (vocab_only lives on llama_model_params, include/llama.h:325). Pristine 0.12.8 compiles against b10156 → b10156 common_params exposes vocab_only. Fork: **missing** → add `bool vocab_only = false;` to common_params and thread into common_model_params_to_llama. Backport **S**. |
| `vocab_only` (on **common_params**) | jsi/JSIParams.cpp:324-334 (set + read, forces `warmup=false`, `n_ctx` floor 512) | **no** | `vocab_only` lives on llama_model_params (include/llama.h:325) but b10156 common_params also exposes it; fork common_params (common/common.h:449+) does not. Backport: add `bool vocab_only = false;` to common_params and thread into `common_model_params_to_llama`. Size **S**. |
| `warmup` | jsi/JSIParams.cpp:326 | yes (common/common.h:570) | — |
| `no_extra_bufts` | jsi/JSIParams.cpp:381 | yes (common/common.h:572) | — |
| `flash_attn_type` | jsi/JSIParams.cpp:384-390; rn-completion.cpp:1366; rn-slot.cpp:707,887,1012 | yes (common/common.h:482) | — |
| `cache_type_k`, `cache_type_v` | rn-llama.cpp:502-503; rn-slot.cpp:855-856,1046-1047; jsi/JSIParams.cpp:392-395 | yes (common/common.h:583-584) | — |
| `ctx_shift` | rn-completion.cpp:432,977; rn-mtmd.hpp:713; jsi/JSIParams.cpp:396 | yes (common/common.h:563) | — |
| `kv_unified` | rn-completion.cpp:1362; rn-slot.cpp:706,886,1011; jsi/JSIParams.cpp:397 | yes (common/common.h:565) | — |
| `swa_full` | rn-slot.cpp:734; jsi/JSISession.h:89; jsi/JSIParams.cpp:399 | yes (common/common.h:564) | — |
| `embedding` | rn-completion.cpp:1261-1264; rn-slot-manager.cpp:340; jsi/JSIParams.cpp:401 | yes (common/common.h:604) | — |
| `embd_normalize` | rn-completion.cpp:1284; rn-slot-manager.cpp:1302; jsi/JSIParams.cpp:403; jsi/RNLlamaJSI.cpp:1501,1521 | yes (common/common.h:605) | — |
| `pooling_type` | jsi/JSIParams.cpp:406-409 | yes (common/common.h:480) | — |
| `rope_freq_base`, `rope_freq_scale` | jsi/JSIParams.cpp:411-412 | yes (common/common.h:471-472) | — |
| `tensor_buft_overrides` | rn-llama.cpp:505; jsi/JSIParams.cpp:417-424 | yes (common/common.h:528) | — |
| `devices` (std::vector<ggml_backend_dev_t>) | rn-llama.cpp:499; jsi/RNLlamaJSI.cpp:454,462 | yes (common/common.h:481) | — |
| `lora_adapters` (std::vector<common_adapter_lora_info>) | rn-llama.cpp:524,687-736; jsi/JSIParams.cpp:428-447; jsi/RNLlamaJSI.cpp:1852-1869 | yes (common/common.h:531) | — |
| `n_cache_reuse` | rn-mtmd.hpp:717 (commented out — **not live**) | yes (common/common.h:616) | — |
| `is_pp_shared`, `kv_unified` (bench) | rn-completion.cpp:1361-1362 | yes (common/common.h:678, 571) | — |
| `load_mode` (enum llama_load_mode) + `LLAMA_LOAD_MODE_NONE/MMAP/MLOCK/MMAP_MLOCK` | jsi/JSIParams.cpp:363-379 (read + 4-way write) | **no** | Upstream PR #20834 (merge e6dd0e29a). Replaces the mmap/mlock JSI switches: wrapper computes `LLAMA_LOAD_MODE_*` from `use_mmap`/`use_mlock` JS options. Fork still has `use_mmap`/`use_mlock`/`use_direct_io` fields (common/common.h:566-568). Backport: `enum llama_load_mode` in include/llama.h, `load_mode` field in common_params, parser mapping, and conversion to `use_mmap/use_mlock` in `common_model_params_to_llama` (fork's loader keeps consuming those). Size **M** (include/llama.h, common/common.h, common/common.cpp, optional common/arg.cpp). |
| `progress_callback`, `progress_callback_user_data` | jsi/RNLlamaJSI.cpp:556,589 | **diff** (renamed) | Fork names them `load_progress_callback` / `load_progress_callback_user_data` (common/common.h:724-725). Wrapper assigns a float-progress closure during model load (llamaInitContext). Backport: rename fork fields to the wrapper names in common/common.h and fix fork-internal references (common/common.cpp and src uses). Size **S**. |

### 2b. common_params_sampling fields (fork: common/common.h:227)

| Symbol | Where used (wrapper) | Present in fork? | If gap: role + backport size |
|---|---|---|---|
| `seed` | jsi/JSIParams.cpp:433 | yes (common/common.h:228) | — |
| `n_probs` | rn-completion.cpp:1100,1141; rn-slot-manager.cpp:1216; jsi/JSIParams.cpp:437 | yes (common/common.h:231) | — |
| `temp`, `top_k`, `top_p`, `min_p`, `xtc_threshold`, `xtc_probability`, `typ_p`, `top_n_sigma` | jsi/JSIParams.cpp:439-463 | yes (common/common.h:232-240) | — |
| `penalty_last_n`, `penalty_repeat`, `penalty_freq`, `penalty_present` | jsi/JSIParams.cpp:441-444 | yes (common/common.h:241-244) | — |
| `mirostat`, `mirostat_tau`, `mirostat_eta` | jsi/JSIParams.cpp:446-448 | yes (common/common.h:246-249) | — |
| `ignore_eos` | jsi/JSIParams.cpp:435,633 | yes (common/common.h:250) | — |
| `n_prev` | rn-completion.cpp:44 | yes (common/common.h:230) | — |
| `dry_multiplier`, `dry_base`, `dry_allowed_length`, `dry_penalty_last_n`, `dry_sequence_breakers` | jsi/JSIParams.cpp:455-474 | yes (common/common.h:236-239,253) | — |
| `grammar` — assigned `{COMMON_GRAMMAR_TYPE_USER, str}` / `{COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT, str}`, read via `.empty()`, reset `= {}` | rn-completion.cpp:39; jsi/JSIParams.cpp:525-531 | yes — fork type is `common_grammar` struct (common/common.h:191) with 2-arg ctor + `empty()`; wrapper brace-init compiles | — |
| `grammar_lazy` | rn-completion.cpp:40; jsi/JSIParams.cpp:564 | yes (common/common.h:280) | — |
| `grammar_triggers` (std::vector<common_grammar_trigger>) | rn-completion.cpp:41; jsi/JSIParams.cpp:584-620 | yes (common/common.h:281) | — |
| `preserved_tokens` (std::set<llama_token>; `.insert`, `.find`) | rn-completion.cpp:42; jsi/JSIParams.cpp:514,578,597 | yes (common/common.h:282) | — |
| `generation_prompt` | rn-completion.cpp:43; jsi/JSIParams.cpp:512,531 | yes (common/common.h:293) | — |
| `logit_bias` — **map-style access**: `logit_bias[llama_vocab_eos(vocab)].bias = -INFINITY`, `logit_bias[tok].bias = val` | jsi/JSIParams.cpp:629-646 | **diff** | Fork: `std::vector<llama_logit_bias> logit_bias` (common/common.h:274; struct include/llama.h:433 with `token`+`bias`). Vector `operator[]` with a token id compiles but is semantically wrong (positional index, possible UB). Pristine 0.12.8 targets b10156 where the field is keyed. Backport: change fork field to a keyed map (`std::map<llama_token, float>`-style value exposing `.bias`, e.g. `std::map<llama_token, llama_logit_bias>`) and update fork consumers (common/sampling.cpp, common/arg.cpp, common/common.cpp). Size **M**. |
| `reasoning_budget_tokens` | jsi/JSIParams.cpp:515,553 | yes (common/common.h:285) | — |
| `reasoning_budget_start` (std::vector<llama_token>) | jsi/JSIParams.cpp:517,541,557 | yes (common/common.h:286) | — |
| `reasoning_budget_end` — wrapper does `.push_back(std::move(token_vector))` | jsi/JSIParams.cpp:518,547,552,558 | **diff** | Wrapper shape = `std::vector<std::vector<llama_token>>` (multiple end sequences, upstream PR #25544). Fork shape = flat `std::vector<llama_token>` (common/common.h:287). Backport together with `reasoning_budget_activate_immediately` and the sampler/chat consumers — see §8.2. Size **M** surface / **L** full chain. |
| `reasoning_budget_forced` (std::vector<llama_token>) | jsi/JSIParams.cpp:519,549,552,559 | yes (common/common.h:288) | — |
| `reasoning_budget_activate_immediately` (bool) | jsi/JSIParams.cpp:516,554-555 | **no** | Upstream PR #20297 (commit acb7c79): when true the reasoning-budget sampler begins forcing its end sequence on the first generated token (JS option `thinking_forced_open`). Fork has tokens/start/end/forced/message (common/common.h:285-290) but NOT this bool. Backport: field + sampler init logic (common/sampling.cpp) + reasoning-budget state (common/reasoning-budget.*). Size **M** (§8.2). |

*(Fork extras `reasoning_budget_message`, `reasoning_control` at common/common.h:289-291 are unused by the wrapper — not a gap.)*

### 2c. common_params_speculative / _draft (fork: common/common.h:372 / 335)

| Symbol | Where used (wrapper) | Present in fork? |
|---|---|---|
| `types` (std::vector<common_speculative_type>) | rn-llama.cpp:53,489-490; rn-completion.cpp:629-631; rn-slot.cpp:340-342; jsi/JSIParams.cpp:177,208 | yes (common/common.h:374) |
| `draft` (common_params_speculative_draft) | rn-llama.cpp:496-517,568-572; rn-slot-manager.cpp:105-116; jsi/JSIParams.cpp:116-144 | yes (common/common.h:375) |
| `has_dft()` | rn-llama.cpp:488 | yes (common/common.h:388) |
| `draft.mparams.path` (common_params_model) | rn-llama.cpp:498; jsi/JSIParams.cpp:116-119,283-286 | yes (common/common.h:345) |
| `draft.n_max` / `n_min` / `p_min` / `p_split` | rn-completion.cpp:633,835,852-856,875; rn-slot.cpp:337,393,513-517; rn-slot-manager.cpp:107-109; jsi/JSIParams.cpp:120-123,265-280 | yes (common/common.h:337-341) |
| `draft.n_gpu_layers` | rn-llama.cpp:500; rn-slot-manager.cpp:111; jsi/JSIParams.cpp:124,288 | yes (common/common.h:349) |
| `draft.cache_type_k` / `cache_type_v` | rn-llama.cpp:502-503,571-572; rn-slot-manager.cpp:112-113; jsi/JSIParams.cpp:127-134,292-299 | yes (common/common.h:351-352) |
| `draft.backend_sampling` | rn-slot-manager.cpp:110,120,162,415 | yes (common/common.h:343) |
| `draft.ctx_tgt`, `draft.ctx_dft` (llama_context*) | rn-completion.cpp:712-713; rn-slot.cpp:442-443; rn-slot-manager.cpp:118-119,139-140 | yes (common/common.h:347-348) |
| `draft.devices` / `cpuparams` / `cpuparams_batch` / `tensor_buft_overrides` | rn-llama.cpp:497,504-507 | yes (common/common.h:355-361) |
| `COMMON_SPECULATIVE_TYPE_DRAFT_MTP` / `_DRAFT_DFLASH` | rn-llama.cpp:490-491; rn-completion.cpp:630-631; rn-slot.cpp:341-342; jsi/JSIParams.cpp:303-304 | yes (common/common.h:168-172) |
| `common_speculative_types_from_names` | jsi/JSIParams.cpp:206 | yes (common/speculative.h:15) |

### 2d. common_cpu_params, adapter, model structs

| Symbol | Where used (wrapper) | Present in fork? |
|---|---|---|
| `common_cpu_params.n_threads` / `.cpumask[GGML_MAX_N_THREADS]` / `.mask_valid` / `.strict_cpu` | jsi/JSIParams.cpp:16-56 (set_best_cores), 345-354 | yes (common/common.h:66-72) |
| `common_cpu_get_num_math()` | jsi/JSIParams.cpp:67 | yes (common/common.h:96) |
| `common_adapter_lora_info.path` / `.scale` / `.ptr` / `.task_name` / `.prompt_prefix` | rn-llama.cpp:24-35,697-703; jsi/JSIParams.cpp:428-451; jsi/RNLlamaJSI.cpp:1857-1860,1864-1876 | yes (common/common.h:48-55) |
| `common_params_model.path` (vocoder/draft/main) | rn-tts.cpp:434; rn-llama.cpp:498; jsi/JSIParams.cpp:323 | yes (common/common.h:314) |
| `common_params_vocoder.use_guide_tokens` | jsi/RNLlamaJSI.cpp:1107 | yes (common/common.h:410) |

---

## 3. common_chat_* types and fields (fork: common/chat.h)

| Symbol | Where used (wrapper) | Present in fork? | If gap: role + backport size |
|---|---|---|---|
| `common_chat_params.prompt` | jsi/RNLlamaJSI.cpp:866 | yes (common/chat.h:271) | — |
| `common_chat_params.format` | jsi/RNLlamaJSI.cpp:867; rn-completion.cpp:1229; rn-slot.cpp:617 | yes (common/chat.h:270) | — |
| `common_chat_params.grammar` (read as **std::string** into jsi::String) | jsi/RNLlamaJSI.cpp:868 | yes (common/chat.h:272 — std::string) | — |
| `common_chat_params.grammar_lazy` | jsi/RNLlamaJSI.cpp:869 | yes (common/chat.h:273) | — |
| `common_chat_params.generation_prompt` | jsi/RNLlamaJSI.cpp:870,251,260; rn-completion.cpp:1231; rn-slot.cpp:619 | yes (common/chat.h:274) | — |
| `common_chat_params.supports_thinking` | jsi/RNLlamaJSI.cpp:247 | yes (common/chat.h:275) | — |
| `common_chat_params.thinking_start_tag` (singular) | jsi/RNLlamaJSI.cpp:247,251,875-876 | yes (common/chat.h:276) | — |
| `common_chat_params.thinking_end_tags` — **PLURAL**: iterated (`for (const auto& endTag : ...)` RNLlamaJSI.cpp:256) and `.front()` (RNLlamaJSI.cpp:879), `.empty()` (RNLlamaJSI.cpp:878) | jsi/RNLlamaJSI.cpp:255-264,878-879 | **diff — fork has SINGULAR `thinking_end_tag` (std::string, common/chat.h:277)** | Wrapper targets post-PR #25544 shape `std::vector<std::string>`. Used for: (a) `isThinkingForcedOpen` — decide whether the generation prompt ends inside an open thinking block by scanning for each end tag (RNLlamaJSI.cpp:244-266); (b) exposing first end tag to JS as `thinking_end_tag` (RNLlamaJSI.cpp:878-880). Backport = the #25544 multi-end-tag chain: `common/chat.h` field rename/retyping + every `common_chat_params_init_*` producer in common/chat.cpp + reasoning parser consumers. Size **M-L** (§8.3). |
| `common_chat_params.preserved_tokens` (std::vector<std::string>) | jsi/RNLlamaJSI.cpp:882-888 | yes (common/chat.h:282) | — |
| `common_chat_params.additional_stops` (std::vector<std::string>) | jsi/RNLlamaJSI.cpp:890-895 | yes (common/chat.h:283) | — |
| `common_chat_params.grammar_triggers` (std::vector<common_grammar_trigger>) | jsi/RNLlamaJSI.cpp:897-908 | yes (common/chat.h:281) | — |
| `common_chat_params.parser` (std::string; `.empty()`) | jsi/RNLlamaJSI.cpp:911-913 | yes (common/chat.h:284) | — |
| `common_chat_templates_inputs.messages` / `.use_jinja` / `.tools` / `.parallel_tool_calls` / `.tool_choice` / `.json_schema` / `.enable_thinking` / `.reasoning_format` / `.add_generation_prompt` / `.now` / `.chat_template_kwargs` / `.force_pure_content` | rn-llama.cpp:604-633,649-651 | yes — all 12 fields (common/chat.h:249-267) | — |
| `common_chat_parser_params.format` / `.reasoning_format` / `.generation_prompt` / `.parse_tool_calls` / `.parser` (`common_peg_arena::load(std::string)`) | rn-completion.cpp:1228-1236; rn-slot.cpp:616-624 | yes (common/chat.h:287-301; peg-parser.h:339 `void load(const std::string&)`) | — |
| `common_chat_msg.content` / `.reasoning_content` / `.tool_calls` | rn-completion.cpp:1241-1244; rn-slot.cpp:631-634; jsi/JSICompletion.h:32-41 | yes (common/chat.h:81-88) | — |
| `common_chat_tool_call.name` / `.arguments` / `.id` | jsi/JSICompletion.h:14-22 | yes (common/chat.h:28-31) | — |
| `common_chat_format` enum: `COMMON_CHAT_FORMAT_CONTENT_ONLY`, `COMMON_CHAT_FORMAT_PEG_SIMPLE/_PEG_NATIVE/_PEG_GEMMA4` | rn-completion.h:111, rn-completion.cpp:619,1229; rn-slot.cpp:617 | yes (common/chat.h:229-237) | — |
| `common_reasoning_format` + `COMMON_REASONING_FORMAT_NONE` | rn-completion.h:112,120-122; rn-slot.cpp:29,617; jsi/RNLlamaJSI.cpp:1061,1308 | yes (common/common.h:420-427) | — |
| `common_grammar_type`: `COMMON_GRAMMAR_TYPE_USER`, `COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT` | jsi/JSIParams.cpp:525,528 | yes (common/common.h:183-188) | — |
| `common_grammar_trigger_type`: `COMMON_GRAMMAR_TRIGGER_TYPE_WORD`, `_TOKEN` | jsi/JSIParams.cpp:590-616 | yes (common/common.h:151-156) | — |
| `common_grammar_trigger.type` / `.value` / `.token` | jsi/JSIParams.cpp:599-618; jsi/RNLlamaJSI.cpp:899-901 | yes (common/common.h:158-161) | — |
| `common_chat_templates_ptr` / `common_chat_templates_init(model, override)` | rn-llama.h:114; rn-llama.cpp:520,638,654 | yes (common/chat.h:314-318) | — |
| `common_chat_templates_apply(tmpls, inputs)` | rn-llama.cpp:639,641,652,654 | yes (common/chat.h:324-325) | — |
| `common_chat_verify_template(tmpl, use_jinja)` | rn-llama.cpp:586 | yes (common/chat.h:306) | — |
| `common_chat_templates_has_variant(tmpls, variant)` — 2-arg | jsi/RNLlamaJSI.cpp:302,318 | **no** | Gates the chat-template caps probe (only calls get_caps when a "" / "tool_use" variant exists). Fork has variant infrastructure (`common_chat_templates_source(tmpls, variant)` common/chat.h:329) but no `has_variant` symbol anywhere. Backport: declare in common/chat.h, implement in common/chat.cpp (~10 ln, upstream equivalent is a variant-existence check). Size **S**. |
| `common_chat_templates_get_caps(tmpls, variant)` — wrapper calls **2-arg** and reads fields `.supports_tools` / `.supports_tool_calls` / `.supports_parallel_tool_calls` / `.supports_system_role` | jsi/RNLlamaJSI.cpp:303-308,319-325 | **diff** | Fork signature: `std::map<std::string, bool> common_chat_templates_get_caps(const common_chat_templates *)` — 1 arg, map of string keys (common/chat.h:364, impl common/chat.cpp:2939). Wrapper expects the pre-refactor struct form (caps object with 4 bool fields, variant arg). Backport: re-add struct `common_chat_templates_caps` + 2-arg overload in common/chat.h/.cpp (fork already computes caps internally). Size **S-M**. |
| `common_chat_msgs_parse_oaicompat(json)` | rn-llama.cpp:605,650 | yes (common/chat.h:352) | — |
| `common_chat_tools_parse_oaicompat(json)` | rn-llama.cpp:608 | yes (common/chat.h:354) | — |
| `common_chat_tool_choice_parse_oaicompat(str)` | rn-llama.cpp:612 | yes (common/chat.h:347) | — |
| `common_reasoning_format_from_name(str)` | rn-llama.cpp:627; jsi/RNLlamaJSI.cpp:1061,1308 | yes (common/chat.h:345) | — |
| `common_chat_parse(input, is_partial, params)` | rn-completion.cpp:1239; rn-slot.cpp:629 | yes (common/chat.h:340) | — |

---

## 4. Sampler and speculative-decoding API

| Symbol | Where used (wrapper) | Present in fork? | Notes |
|---|---|---|---|
| `common_sampler_init(const llama_model*, common_params_sampling&)` | rn-completion.cpp:73,1259; rn-slot-manager.cpp:572 | yes (common/sampling.h:28) | signature matches |
| `common_sampler_free` | rn-completion.cpp:32,70; rn-slot.cpp:55,102; rn-slot-manager.cpp:157,570 | yes (common/sampling.h:31) | — |
| `common_sampler_sample(gsmpl, ctx, idx)` | rn-completion.cpp:1102; rn-slot-manager.cpp:894,904; rn-mtmd.hpp:731 | yes (common/sampling.h:62, `grammar_first` defaulted) | — |
| `common_sampler_accept(gsmpl, token, bool)` | rn-completion.cpp:603,1130; rn-slot-manager.cpp:905; rn-mtmd.hpp:741 | yes (common/sampling.h:34) | — |
| `common_sampler_get_candidates(gsmpl, do_sort)` → `llama_token_data_array*` (fields `.size`, `.data[i].id`, `.data[i].p`) | rn-completion.cpp:1106-1109; rn-slot-manager.cpp:1217-1220 | yes (common/sampling.h:99) | — |
| `common_sampler_sample_and_accept_n(gsmpl, ctx, draft_tokens)` (3-arg overload, returns std::vector<llama_token>) | rn-completion.cpp:887; rn-slot.cpp:548 | yes (common/sampling.h:78-81) | — |
| `common_perf_print(ctx, gsmpl)` | jsi/RNLlamaJSI.cpp:1182,1393 | yes (common/sampling.h:50) | — |
| `common_speculative_init(common_params_speculative&, uint32_t n_seq)` | rn-completion.cpp:717; rn-slot.cpp:446; rn-slot-manager.cpp:144 | yes (common/speculative.h:26) | non-const ref matches wrapper lvalue use |
| `common_speculative_free` | rn-completion.cpp:672; rn-slot.cpp:60; rn-slot-manager.cpp:154,172 | yes (common/speculative.h:28) | — |
| `common_speculative_process(spec, const llama_batch&)` | rn-completion.cpp:795,883; rn-slot.cpp:472,555 | yes (common/speculative.h:58) | — |
| `common_speculative_begin(spec, seq_id, prompt)` | rn-completion.cpp:816; rn-slot.cpp:479 | yes (common/speculative.h:55) | — |
| `common_speculative_draft(spec)` | rn-completion.cpp:860; rn-slot.cpp:521 | yes (common/speculative.h:64) | — |
| `common_speculative_accept(spec, seq_id, uint16_t n_accepted)` | rn-completion.cpp:914; rn-slot.cpp:572 | yes (common/speculative.h:67) | — |
| `common_speculative_get_draft_params(spec, seq_id)` → lvalue assigned aggregate `{drafting, n_max, n_past, id_last, prompt*, result*}` | rn-completion.cpp:852-859; rn-slot.cpp:513-520 | yes (common/speculative.h:52; struct `common_speculative_draft_params` common/speculative.h:30-49, field order matches) | — |
| `llama_context_ptr` (unique_ptr typedef) | rn-completion.h:134; rn-completion.cpp:679,711; rn-slot.h:52 | yes (include/llama-cpp.h:28) | — |

---

## 5. llama_* API (fork: include/llama.h unless noted)

| Symbol | Where used (wrapper) | Present in fork? | If gap: role + backport size |
|---|---|---|---|
| `llama_backend_init` | jsi/RNLlamaJSI.cpp:196 | yes (llama.h:461) | — |
| `llama_log_set(ggml_log_callback, void*)` | jsi/RNLlamaJSI.cpp:1236,1244,2152 | yes (llama.h:1527) | — |
| `llama_log_callback_default` | jsi/RNLlamaJSI.cpp:201,1244,2152 | **no** | Default log callback passed to `llama_log_set` (and used to forward logs before JS handler). Fork llama.h has `llama_log_set`/`llama_log_get` (llama.h:1526-1527) but no exported default callback. Backport: add `LLAMA_API void llama_log_callback_default(enum ggml_log_level, const char*, void*);` to include/llama.h + ~6-line impl in src/llama.cpp. Size **S**. |
| `llama_attach_threadpool` / `llama_detach_threadpool` | rn-llama.cpp:436,377 | yes (llama.h:470,475) | — |
| `llama_model_load_from_file` | rn-llama.cpp:513 | yes (llama.h:491) | — |
| `llama_init_from_model` | rn-llama.cpp:577 | yes (llama.h:521) | — |
| `llama_free` | rn-completion.cpp:676; rn-slot.cpp:67; rn-slot-manager.cpp:169,181 | yes (llama.h:531) | — |
| `llama_n_ctx` / `llama_n_batch` / `llama_n_seq_max` / `llama_n_rs_seq` / `llama_n_threads` / `llama_n_threads_batch` | rn-llama.cpp:521,599; rn-completion.cpp:700,724,838,1370-1372; jsi/JSISession.h:46 | yes (llama.h:547-552,979-982) | — |
| `llama_get_model` / `llama_model_get_vocab` | rn-completion.cpp:1265,1319; jsi/JSIParams.cpp:630-631; rn-slot-manager.cpp:306 | yes (llama.h:561,565) | — |
| `llama_model_n_embd` / `llama_model_n_params` / `llama_model_size` / `llama_model_desc` | jsi/RNLlamaJSI.cpp:272-276; rn-completion.cpp:1265; rn-slot-manager.cpp:1005; rn-mtmd.hpp:691 | yes (llama.h:555,614-627) | — |
| `llama_model_n_embd_out` | rn-tts.cpp:597 | yes (llama.h:571) | — |
| `llama_model_n_swa` | rn-completion.cpp:204,206; rn-slot.cpp:734; jsi/JSISession.h:89; rn-mtmd.hpp:541 | yes (llama.h:576) | — |
| `llama_model_n_layer_nextn` | rn-llama.cpp:569 | yes (llama.h:573) | — |
| `llama_model_has_encoder` / `llama_model_has_decoder` | rn-llama.cpp:597,688; rn-completion.cpp:345,689,1316; rn-slot.cpp:377; rn-slot-manager.cpp:366; jsi/RNLlamaJSI.cpp:600-601,1522 | yes (llama.h:630,633) | — |
| `llama_model_is_recurrent` / `llama_model_is_hybrid` | rn-completion.cpp:133,697-698; rn-slot.cpp:112,392,728,1036; jsi/JSISession.h:88; jsi/RNLlamaJSI.cpp:277-278; rn-mtmd.hpp:540 | yes (llama.h:640,643) | — |
| `llama_model_chat_template(model, name)` | rn-llama.cpp:582; rn-tts.cpp:486 | yes (llama.h:624) | — |
| `llama_model_decoder_start_token` | rn-completion.cpp:601 | yes (llama.h:637) | — |
| `llama_model_rope_type` + `LLAMA_ROPE_TYPE_MROPE` / `LLAMA_ROPE_TYPE_IMROPE` | rn-llama.cpp:162-163 | yes (llama.h:566,86-87) | — |
| `llama_model_meta_count` / `llama_model_meta_key_by_index` / `llama_model_meta_val_str_by_index` | jsi/RNLlamaJSI.cpp:282-288 | yes (llama.h:602-611) | — |
| `llama_adapter_lora_init` / `llama_adapter_lora_ptr` (typedef) | rn-llama.cpp:697-698; rn-llama.h:118,121 | yes (llama.h:660; include/llama-cpp.h:30) | — |
| `llama_adapter_meta_val_str` | rn-llama.cpp:31,33 | yes (llama.h:671) | — |
| `llama_decode` / `llama_encode` / `llama_synchronize` | rn-completion.cpp:580,787,879,1085,1418,1455; rn-slot.cpp:466,542; rn-slot-manager.cpp:660; rn-tts.cpp:590 | yes (llama.h:228,1006) | — |
| `llama_batch_init` / `llama_batch_free` / `llama_batch_get_one` | rn-completion.cpp:722,845,1394,1490; rn-slot.cpp:449; rn-slot-manager.cpp:54,80; rn-tts.cpp:581 | yes (llama.h:928-941) | — |
| `llama_batch` fields `.token` `.pos` `.n_seq_id` `.seq_id` `.logits` `.n_tokens` | rn-llama.h:216-226 (llama_batch_add); rn-completion.cpp:1398-1406; rn-slot-manager.cpp:45,617-627 | yes (llama.h:229) | — |
| `llama_token_data` / `llama_token_data_array` (`.size`, `.data[i].id`, `.data[i].p`) | rn-completion.cpp:1086,1107-1108; rn-slot-manager.cpp:1218 | yes (llama.h:211,217) | — |
| `llama_get_memory` / `llama_memory_clear` / `llama_memory_seq_rm` / `llama_memory_seq_add` / `llama_memory_seq_cp` / `llama_memory_seq_pos_min` / `llama_memory_seq_pos_max` | rn-llama.cpp:637-640; rn-completion.cpp:279,461-494,990-992,1324,1471; rn-slot.cpp:129,163,711-745,851-857,1041-1047; jsi/JSISession.h:72-98; rn-mtmd.hpp:487-546 | yes (llama.h:562,719-780) | — |
| `llama_state_save_file` / `llama_state_load_file` | jsi/JSISession.h:49,58,148,160 | yes (llama.h:822,836) | — |
| `llama_state_seq_save_file` / `llama_state_seq_load_file` (5-arg signatures match) | rn-slot.cpp:793,911; rn-slot-manager.cpp:803 | yes (llama.h:870-884) | — |
| `llama_state_seq_get_size_ext(ctx, seq_id, flags)` / `llama_state_seq_get_data_ext` / `llama_state_seq_set_data_ext` + `LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY` | rn-completion.cpp:195-196,230-232,301-302 | yes (llama.h:891,899-918) | — |
| `llama_get_embeddings` / `llama_get_embeddings_seq` / `llama_get_embeddings_ith` | rn-completion.cpp:1277-1280,1328; rn-slot-manager.cpp:1037-1046; rn-tts.cpp:595 | yes (llama.h:985-1042) | — |
| `llama_pooling_type` + `LLAMA_POOLING_TYPE_NONE` / `LLAMA_POOLING_TYPE_RANK` | rn-completion.cpp:1273,1294; rn-slot-manager.cpp:309; jsi/JSIParams.cpp:407-409 | yes (llama.h:175-182,549) | — |
| `llama_vocab_is_eog` / `is_control` / `eos` / `bos` / `sep` / `n_tokens` / `get_add_bos` / `get_add_eos` / `get_add_sep` / `get_attr` | rn-completion.cpp:355,896,1088-1091,1113; rn-slot-manager.cpp:368,900,1191; rn-tts.cpp:511-539; jsi/JSIParams.cpp:634; jsi/JSISession.h:75; jsi/RNLlamaJSI.cpp:1521 | yes (llama.h:1078-1097) | — |
| `LLAMA_TOKEN_NULL` / `LLAMA_TOKEN_ATTR_CONTROL` / `LLAMA_TOKEN_ATTR_USER_DEFINED` | rn-completion.cpp:355-360; rn-slot.cpp:96,774,942,1057; jsi/JSISession.h:61,76,84; rn-mtmd.hpp:335,340 | yes (llama.h:39,106-107) | — |
| `llama_flash_attn_type` + `LLAMA_FLASH_ATTN_TYPE_ENABLED/DISABLED/AUTO` | rn-llama.cpp:78-89; jsi/JSIParams.cpp:384-390; rn-slot.cpp:707,887,1012 | yes (llama.h:190-194) | — |
| `llama_context_params` fields used: `n_ctx`, `n_batch`, `n_ubatch`, `n_seq_max`, `n_rs_seq`, `n_threads`, `n_threads_batch`, `ctx_type`, `rope_freq_base/scale`, `type_k`, `type_v`, `pooling_type`, `flash_attn_type`, `swa_full`, `kv_unified`, `ctx_other` | rn-llama.cpp:565-576 (createMTPDraftContext, via common_context_params_to_llama) | yes (llama.h:343-403; Kalsa fields `n_rs_seq` :347, `ctx_type` :353, `ctx_other` :401) | — |
| `LLAMA_CONTEXT_TYPE_MTP` / `LLAMA_CONTEXT_TYPE_DEFAULT` (enum llama_context_type) | rn-llama.cpp:569-571 | yes (llama.h:205-208) | — |
| `llama_model_ptr` (unique_ptr typedef) | rn-llama.h:110 | yes (include/llama-cpp.h:27) | — |
| `llama_perf_context(ctx)` → `.n_p_eval`, `.t_p_eval_ms`; `llama_perf_context_reset` | jsi/JSICompletion.h:185-192; rn-completion.cpp:621,1256 | yes (llama.h:1535-1555) | — |
| `llama_tokens` (typedef std::vector<llama_token>) | rn-completion.h:137,140,144; rn-completion.cpp:850,858 | yes (common/common.h:58) | — |
| `llama_get_ctx_other` | rn-completion.cpp:6 (include llama-ext.h),729 | **yes-in-fork-internals; function itself is a llama.rn bootstrap patch** | Declared in llama.rn's own staging header `cpp/llama-ext.h:117` (not generated). Implemented in the SHIPPED generated `cpp/llama-context.cpp:4158` as `return ctx->get_cparams().ctx_other;`. Fork has `llama_cparams.ctx_other` (src/llama-context.cpp:116) and `llama_context_params.ctx_other` (llama.h:401), so the one-line function is compatible. Action on regeneration: re-apply as a llama.rn bootstrap patch onto fork `src/llama-context.cpp`. Size **S**. |

---

## 6. common_* misc functions and init/LoRA API

| Symbol | Where used (wrapper) | Present in fork? | If gap: role + backport size |
|---|---|---|---|
| `common_init_from_params(common_params&)` | rn-llama.cpp:476; rn-tts.cpp:437 | yes (common/common.h:906, `model_only` defaulted) | — |
| `common_init_result` accessors `.model()` / `.context()` / `.lora()`; `common_init_result_ptr` | rn-llama.cpp:37-42,477-478,705,718; rn-llama.h:111,121; rn-slot.cpp:698,860,1014 | yes (common/common.h:887-904; lora() :897) | — |
| `common_set_adapter_lora(ctx, lora)` | rn-llama.cpp:710,719 | yes (common/common.h:913) | — |
| `common_model_params_to_llama(params)` | rn-llama.cpp:511 | yes (common/common.h:908) | — |
| `common_context_params_to_llama(params)` | rn-llama.cpp:565 | yes (common/common.h:909) | — |
| `common_params_get_system_info(params)` | rn-llama.cpp:546 (commented); jsi/RNLlamaJSI.cpp:641 | yes (common/common.h:734) | — |
| `common_context_seq_rm(ctx, seq_id, p0, p1)` | rn-completion.cpp:866,925,927-928; rn-slot.cpp:451-452 | yes (common/common.h:934; Kalsa helper) | — |
| `common_batch_clear(llama_batch&)` / `common_batch_add(batch, token, pos, {seq}, logits)` | rn-completion.cpp:776,783,872-875; rn-slot.cpp:461-465,525-529; rn-tts.cpp:584 | yes (common/common.h:942-950) | — |
| `common_tokenize(ctx, text, add_special, parse_special)` | jsi/JSIParams.cpp:541,544,549,590,601; rn-completion.cpp:416,1318; rn-slot-manager.cpp:369-377; jsi/RNLlamaJSI.cpp:1521 | yes (common/common.h:975) | — |
| `common_tokenize(vocab, text, add_special, parse_special)` | rn-completion.cpp:1318,1327; rn-slot-manager.cpp:369,374; rn-tts.cpp:519,525,535 | yes (common/common.h:981) | — |
| `common_token_to_piece(ctx, token)` | rn-completion.cpp:90,95,358,911,1016,1021,1032; rn-slot.cpp:607; rn-slot-manager.cpp:908; jsi/RNLlamaJSI.cpp:1127 | yes (common/common.h:989, `special` defaulted) | — |
| `common_embd_normalize(inp, out, n, embd_norm)` | rn-completion.cpp:1284; rn-slot-manager.cpp:1302 | yes (common/common.h:1017) | — |
| `parse_cpu_mask(mask, bool(&)[GGML_MAX_N_THREADS])` | jsi/JSIParams.cpp:350 | yes (common/common.h:737) | — |
| `json_schema_to_grammar(ordered_json)` | jsi/JSIParams.cpp:528 | yes (common/json-schema-to-grammar.h:9, `force_gbnf` defaulted) | — |
| `lm_ggml_threadpool_params_from_cpu_params(params.cpuparams)` | rn-llama.cpp:394-397 | yes (common/common.h:910) | — |

---

## 7. ggml / gguf / mtmd surface referenced by wrapper+glue

All ggml_/gguf_ symbols appear PREFIXED (lm_ggml_ / LM_GGML_) in wrapper code; verdicts are against unprefixed fork headers (bootstrap adds the prefix). Fork locations below are the real headers; generated copies land in `cpp/`.

| Symbol | Where used (wrapper) | Present in fork? | If gap: role + backport size |
|---|---|---|---|
| `ggml_backend_dev_count` / `ggml_backend_dev_get` / `ggml_backend_dev_by_type` / `ggml_backend_dev_type` / `ggml_backend_dev_name` / `ggml_backend_dev_get_props` / `ggml_backend_dev_backend_reg` / `ggml_backend_reg_name` | rn-common.hpp:17-63; jsi/RNLlamaJSI.cpp:75-160,330-410,598-606; rn-slot.cpp:699-701,861-863,1015-1017 | yes (ggml/include/ggml-backend.h:179-242) | — |
| `GGML_BACKEND_DEVICE_TYPE_CPU/GPU/IGPU/ACCEL/META` + `ggml_backend_dev_props` (`.type`, `.device_id`) + `ggml_backend_dev_t` / `ggml_backend_reg_t` / `ggml_backend_buffer_type_t` | rn-common.hpp:26-45; jsi/RNLlamaJSI.cpp:97-128,394,599-605 | yes (ggml/include/ggml-backend.h:30,134-184) | — |
| `ggml_backend_cpu_buffer_type()` | jsi/JSIParams.cpp:421 | yes (ggml/include/ggml-backend.h, CPU backend) | — |
| `ggml_threadpool_new` / `ggml_threadpool_free` / `ggml_threadpool_params_match` / `ggml_threadpool_params` (`.n_threads`, `.paused`) | rn-llama.cpp:373-437 | yes (ggml/include/ggml.h:2846-2861) | — |
| `ggml_time_us` | rn-completion.cpp:647,656,1024; rn-slot.cpp:450,775,1046; rn-slot-manager.cpp:494,543,891,1180,1360 | yes (ggml/include/ggml.h:728) | — |
| `GGML_ASSERT` (as LM_GGML_ASSERT) | rn-completion.cpp:439 | yes (ggml/include/ggml.h:288) | — |
| `ggml_type_name` + `GGML_TYPE_F32/F16/BF16/Q8_0/Q4_0/Q4_1/IQ4_NL/Q5_0/Q5_1` (kv_cache_types table) + `GGML_MAX_N_THREADS` | rn-llama.cpp:56-75; rn-llama.h:152; jsi/JSIParams.cpp:349; rn-slot.cpp:855-856,1046-1047 | yes (ggml/include/ggml.h:225,393-420,751) | — |
| `GGML_LOG_LEVEL_ERROR/WARN/INFO` (log callback) | jsi/RNLlamaJSI.cpp:200-224 | yes (ggml/include/ggml.h:636-641) | — |
| `gguf_init_params{no_alloc, ctx}` / `gguf_init_from_file` / `gguf_free` / `gguf_get_version` / `gguf_get_alignment` / `gguf_get_data_offset` / `gguf_get_n_kv` / `gguf_get_key` | jsi/JSIHelpers.h:13-41 (llamaModelInfo) | yes (ggml/include/gguf.h:72-100) | — |
| `gguf_kv_to_str(ctx, i)` | jsi/JSIHelpers.h:36 | yes — declared in **src/llama-impl.h:105** (not gguf.h); wrapper reaches it via rn-llama.h → llama-impl.h include chain | — |
| `mtmd_context` / `mtmd_context_params` (`.use_gpu`, `.print_timings`, `.n_threads`, `.image_min_tokens`, `.image_max_tokens`) / `mtmd_context_params_default` / `mtmd_init_from_file` / `mtmd_free` | rn-mtmd.hpp:667-702 | yes (tools/mtmd/mtmd.h:88-127) | — |
| `mtmd_default_marker` / `mtmd_decode_use_mrope` / `mtmd_decode_use_non_causal(ctx, nullptr)` / `mtmd_support_vision` / `mtmd_support_audio` | rn-mtmd.hpp:421,686-690,717; rn-llama.cpp:556-560 | yes (tools/mtmd/mtmd.h:117-140) | — |
| `mtmd_tokenize` / `mtmd_input_text{.text, .add_special, .parse_special, `.text_len`}` | rn-mtmd.hpp:281-287,318 | **diff** | Fork `mtmd_input_text` has only `text`/`add_special`/`parse_special` (tools/mtmd/mtmd.h:68-72) — NO `.text_len`. Wrapper sets `input_text.text_len = prompt.size()` (rn-mtmd.hpp:283) → hard compile error. Backport: re-add `size_t text_len;` member to the struct in tools/mtmd/mtmd.h (field is unused by fork code, so S). Size **S**. |
| `mtmd_input_chunks_init` / `_free` / `_size` / `_get`; `mtmd_input_chunk_get_type` / `_get_tokens_text` / `_get_n_tokens` / `_get_n_pos` / `_get_id`; `MTMD_INPUT_CHUNK_TYPE_TEXT/IMAGE/AUDIO` | rn-mtmd.hpp:297-345; rn-llama.cpp:563 | yes (tools/mtmd/mtmd.h:55-57,210-226) | — |
| `mtmd_bitmap_get_id` / `mtmd_bitmap_set_id`; C++ `mtmd::bitmap` (`.ptr`, `.data()`, `.n_bytes()`, `.set_id`) and `mtmd::bitmaps` (`.entries`, `.clear()`, `.c_ptr()`) | rn-mtmd.hpp:163-178,238-242 | yes (tools/mtmd/mtmd.h:174-175,379-403) | — |
| `mtmd_helper_bitmap_init_from_buf(ctx, buf, len, bool placeholder)` / `mtmd_helper_bitmap_init_from_file(ctx, fname, bool)` → `.bitmap`, `.video_ctx`; `mtmd_helper::video_ptr` | rn-mtmd.hpp:159-161,193-195 | yes (tools/mtmd/mtmd-helper.h:31-48,176-179) | — |
| `mtmd_helper_eval_chunk_single(ctx, ctx_ll, chunk, n_past, seq_id, n_batch, logits_last, &n_past)` | rn-mtmd.hpp:641-649 | yes (tools/mtmd/mtmd-helper.h:85) | — |
| `llama_model::name` (std::string) | rn-tts.cpp:489 | yes (src/llama-model.h:547) | — |
| `llama_model::devices` (std::vector<llama_device>, `.dev` member) | rn-slot.cpp:698-701,860-863,1014-1017; jsi/RNLlamaJSI.cpp:598-606 | yes (src/llama-model.h:530-534,618) | requires llama-model.h — wrapper already includes it (rn-llama.h:15) |

---

## 8. Known-missing items — verified verdicts and backport plans

### 8.1 `common_params.load_mode` + `enum llama_load_mode` — CONFIRMED MISSING
- Wrapper: jsi/JSIParams.cpp:363-379 — reads `cparams.load_mode`, compares against `LLAMA_LOAD_MODE_MMAP` / `LLAMA_LOAD_MODE_MMAP_MLOCK` / `LLAMA_LOAD_MODE_MLOCK`, writes one of `LLAMA_LOAD_MODE_MMAP_MLOCK` / `LLAMA_LOAD_MODE_MMAP` / `LLAMA_LOAD_MODE_MLOCK` / `LLAMA_LOAD_MODE_NONE`. No other wrapper file touches it.
- Fork: zero hits for `load_mode`/`llama_load_mode`/`LLAMA_LOAD_MODE` in include/llama.h and common/ (checked 2026-08-27 @ a0cabca6b). Fork still carries `use_mmap` (common/common.h:566), `use_direct_io` (:567), `use_mlock` (:568).
- Backport (upstream PR #20834, merge commit e6dd0e29a): add `enum llama_load_mode { LLAMA_LOAD_MODE_NONE, LLAMA_LOAD_MODE_MMAP, LLAMA_LOAD_MODE_MLOCK, LLAMA_LOAD_MODE_MMAP_MLOCK }` to include/llama.h, `enum llama_load_mode load_mode` to common_params (common/common.h), map `use_mmap`/`use_mlock` JS options → load_mode stays in the wrapper (already there), and translate load_mode → `use_mmap`/`use_mlock` inside `common_model_params_to_llama` (common/common.cpp). Full upstream version also plumbs direct-io and loader behavior (src/llama-model-loader.cpp) — that part is optional for the wrapper and can be deferred. Size: **M** minimal (3 files), **L** full upstream parity.

### 8.2 Reasoning-budget siblings — PARTIAL MISMATCH
- Wrapper fields (jsi/JSIParams.cpp:515-560): `reasoning_budget_tokens` (int32), `reasoning_budget_start` (vector<llama_token>), `reasoning_budget_end` (**vector of vector<llama_token>** — `.push_back(token_vector)` at :547), `reasoning_budget_forced` (vector<llama_token>), `reasoning_budget_activate_immediately` (bool).
- Fork @ a0cabca6b (common/common.h:285-291): tokens/start/end/forced/message present; `reasoning_budget_end` is **flat** `std::vector<llama_token>`; `reasoning_budget_activate_immediately` **absent**. Sampler side exists: `common_sampler_reasoning_budget_force` (common/sampling.h:91), reasoning-budget module (common/reasoning-budget.h/.cpp).
- Meaning per llama.rn usage: JS options `thinking_budget_tokens` + `thinking_end_tag` + `thinking_start_tag` + `thinking_budget_message` + `thinking_forced_open` are tokenized on the wrapper side and pushed into the sampling params; the engine's budget sampler then monitors/forces the end sequence (llama.rn upstream patch pattern: eafd3f3 "fix: add bootstrap patches for reasoning budget").
- Backport: (a) retyping `reasoning_budget_end` to `std::vector<std::vector<llama_token>>` and adding `bool reasoning_budget_activate_immediately` in common/common.h; (b) updating the budget-sampler construction/matching in common/sampling.cpp + common/reasoning-budget.cpp to iterate multiple end sequences and honor immediate activation; (c) updating common/chat.cpp producers that fill these fields from template thinking tags. Size: **M** for the compile-compatible surface (field type + bool + sampler init branch), **L** for full upstream PR #25544 semantic parity (multi-end-sequence trie matcher, replay, continuation).

### 8.3 `common_chat_params.thinking_end_tags` (plural) vs fork `thinking_end_tag` (singular) — CONFIRMED MISMATCH
- Wrapper: plural form only — `chatParams.thinking_end_tags` iterated at jsi/RNLlamaJSI.cpp:256, `.front()` at :879, `.empty()` at :878. `thinking_start_tag` is singular on both sides (fork common/chat.h:276).
- Fork: `std::string thinking_end_tag;` (common/chat.h:277) — singular. Zero plural occurrences.
- Recorded form per side: **wrapper = plural `thinking_end_tags` (std::vector<std::string>, post-PR #25544, llama.cpp b10156)**; **fork = singular `thinking_end_tag` (std::string)**.
- Backport: rename/retyping in common/chat.h + all `common_chat_params_init_*` fillers in common/chat.cpp + parser consumers that check the end tag (chat auto-parser, reasoning handling). Size: **M-L**.

### 8.4 Additional gaps found during the sweep (beyond the three known ones)
| # | Symbol | Fork state | Backport size |
|---|---|---|---|
| 1 | `llama_log_callback_default` | absent from include/llama.h (only `llama_log_set`/`llama_log_get`, llama.h:1526-1527) | **S** — declare + ~6-line impl |
| 2 | `common_params.progress_callback` / `.progress_callback_user_data` | renamed to `load_progress_callback` / `load_progress_callback_user_data` (common/common.h:724-725) | **S** — rename or alias |
| 3 | `common_params.vocab_only` | absent (only on llama_model_params, llama.h:325); wrapper sets it on common_params (jsi/JSIParams.cpp:324) | **S** — add field + thread into common_model_params_to_llama |
| 4 | `common_params_sampling.logit_bias` | `std::vector<llama_logit_bias>` (common/common.h:274); wrapper uses keyed `[token].bias` access (jsi/JSIParams.cpp:634-646) — compiles against vector but is semantically wrong | **M** — retype to keyed map + update fork consumers (sampling.cpp, arg.cpp, common.cpp) |
| 5 | `common_chat_templates_has_variant(tmpls, variant)` | absent from common/chat.h entirely | **S** — declare + small impl (variant infra exists, common/chat.h:329) |
| 6 | `common_chat_templates_get_caps` | fork: 1-arg returning `std::map<std::string,bool>` (common/chat.h:364); wrapper: 2-arg + caps struct fields `.supports_tools/.supports_tool_calls/.supports_parallel_tool_calls/.supports_system_role` (jsi/RNLlamaJSI.cpp:303-308,319-325) | **S-M** — re-add struct form + variant arg |
| 7 | `mtmd_input_text.text_len` | absent from tools/mtmd/mtmd.h:68-72; wrapper writes it (rn-mtmd.hpp:283) → **hard compile error** | **S** — re-add field |
| 8 | `llama_get_ctx_other` | fork-internals compatible (`llama_cparams.ctx_other` exists, src/llama-context.cpp:116) but the function is a llama.rn patch living in the generated llama-context.cpp of the package (:4158); must be re-applied when regenerating cpp/ from the fork | **S** — llama.rn-side bootstrap patch |

### 8.5 Wrapper-local helpers (explicitly NOT engine gaps)
- `find_partial_stop_string` (rn-common.hpp:143), `find_common_prefix_length` (:159), `format_rerank_tokens` (:167) — defined in llama.rn's own rn-common.hpp.
- `utf8_is_well_formed` / `utf8_sanitize` / `utf8_stream_gate` (rn-llama.cpp:214-330) — wrapper-local.
- `llama_batch_add` (rn-llama.h:216) — wrapper-local inline (wraps llama_batch fields).
- `backend_devices_info`, `kv_cache_type_from_str`, `flash_attn_type_from_str` (rn-llama.cpp:51-89) — wrapper-local, built on engine primitives verified above.
- `chat.cpp.patch` present in the package cpp/ root: llama.rn upstream chat.cpp patch (extra_fields on content parts + gemma function parser) — applies to the generated common/chat.cpp, i.e. it must be re-applied after bootstrap against the fork's chat.cpp; it does not add wrapper-facing symbols.

### 8.6 Compile-risk summary
Hard compile blockers against the fork @ a0cabca6b (in first-encounter order):
1. jsi/JSIParams.cpp:363 — `cparams.load_mode` (no member) + `LLAMA_LOAD_MODE_*` (no enum). §8.1
2. jsi/RNLlamaJSI.cpp:556 — `cparams.progress_callback` (no member; renamed in fork). §8.4-2
3. jsi/JSIParams.cpp:324 — `cparams.vocab_only` (no member on common_params). §8.4-3
4. jsi/JSIParams.cpp:516/554 — `sparams.reasoning_budget_activate_immediately` (no member). §8.2
5. jsi/JSIParams.cpp:547 — `reasoning_budget_end.push_back(vector)` (type mismatch). §8.2
6. jsi/RNLlamaJSI.cpp:256/879 — `chatParams.thinking_end_tags` (no member; fork has singular). §8.3
7. jsi/RNLlamaJSI.cpp:302/318 — `common_chat_templates_has_variant` (no symbol). §8.4-5
8. jsi/RNLlamaJSI.cpp:303/319 — `common_chat_templates_get_caps(tmpls, "")` + field access (different signature). §8.4-6
9. jsi/RNLlamaJSI.cpp:201/1244/2152 — `llama_log_callback_default` (no symbol). §8.4-1
10. rn-mtmd.hpp:283 — `input_text.text_len` (no member). §8.4-7
Compiles-but-wrong: jsi/JSIParams.cpp:634-646 `logit_bias[tok].bias` on a vector (§8.4-4). Link/runtime risk: `llama_get_ctx_other` needs its generated-file patch re-applied (§8.4-8).

Everything else in sections 2-7 verified present in the fork with matching shapes (unprefixed names; bootstrap prefixing applies at generation time).

COMPLETE — q66-app-lifecycle-s23 GAP_JSI (wrapper 0.12.8+app-patch @ q66c vs kalsallama @ a0cabca6b; mapped 2026-08-27)
