# What Kalsa's behaviour actually depends on

One question per row: **when this number changes, what changed it?** If the answer is "nothing
— someone typed it", the row is a constant pretending to be a decision, and this document exists
because we found one of those today (the verbatim window) only by chasing a bug.

Companion to `KALSA.md` (state) and `HARNESS_FINDINGS.md` (evidence). This one is structure: it
does not repeat the numbers, it says where each one comes from and whether anything measured it.

**Legend for "resolved from"**

| tag | meaning |
|---|---|
| **DERIVED** | computed at runtime from device + model, and it reports a provenance string (`PROVENANCE_SOURCES`, `deviceTuning.ts:153`) |
| **CATALOG** | per-model field in `ModelRegistry.ts` — changes with the model, not the device |
| **CONST** | a literal in the source. Not wrong by itself; wrong when the thing it bounds is variable |
| **PREF** | user setting or bench knob; nothing computes it |

**Legend for "evidence"**

| tag | meaning |
|---|---|
| **measured** | a number from a run, with a section in `HARNESS_FINDINGS.md` |
| **reasoned** | argued from something measured, never measured directly |
| **assumed** | nobody has checked. Named here so it can be attacked |

---

## 1. Engine parameters — the layer that already does this properly

Everything here flows through `resolveEngineTuningSync` (`deviceTuning.ts:625`) and comes out of
`TuningResult` with a provenance string attached. This is the model the rest of the app should
copy.

| knob | resolved from | RAM | CPU | GPU | model | evidence | where |
|---|---|:-:|:-:|:-:|:-:|---|---|
| `n_threads` (decode) | **DERIVED** — SoC preset → capacity rule → fallback 4 | — | ✓ | — | — | measured (presets seeded from llama-bench) | `deviceTuning.ts`, `threadProfile.ts` |
| `n_threads_batch` (prefill) | **DERIVED** — only emitted when it differs from decode (G99 2/8) | — | ✓ | — | — | measured | `deviceTuning.ts:127-140` |
| `n_ubatch` | **DERIVED** — `measured:ubatch-256`, hard cap 512 | ✓ | ✓ | — | — | measured (≈250 MB at 256) | `LlamaService.ts:749` |
| `n_ctx` | **DERIVED** — catalog `engineCtx`, upgraded to ≥16384 only when total RAM ≥ 7.5 GB | ✓ | — | — | ✓ | measured (the S23 misses it by **82 MB**) | `contextProfile.ts:45` |
| `n_batch` | **CONST** 512 | — | — | — | — | assumed | `LlamaService.ts:746` |
| `cache_type_k/v` | **CATALOG** (`kvCache`), fallback q8_0/q4_0 | — | — | — | ✓ | measured (q8_0 ≈ 98 % FP16) | `ModelRegistry.ts` |
| `n_gpu_layers` | **DERIVED by PLATFORM, not by GPU** — Apple → 99, Android → 0, emulator → 0 | — | — | ✗ | — | measured on one chip only (§7.16) | `deviceTuning.ts:335` |
| `flash_attn_type` | **CONST** `"auto"` (bench may override) | — | — | ✓ | — | reasoned | `LlamaService.ts:755` |
| `no_extra_bufts` (repack) | **PREF** (bench) — production always repacks | ✓ | ✓ | — | ✓ | measured (§7.11, §7.13) | `benchConfig.ts` |
| `ctx_shift` | **CONST** — on unless the turn is multimodal | — | — | — | ✓ | assumed | `LlamaService.ts:760` |
| model fit gate | **DERIVED** — repack fraction × size + compute + KV vs available | ✓ | — | — | ✓ | measured (§7.11 confirmed on hardware) | `deviceProfile.ts`, `AppShell.tsx` |

⚠️ **The one that does not belong in this table as it stands: `n_gpu_layers`.** It is resolved from
`Platform.OS`, not from the GPU. Every Android device gets 0 whether it holds an Adreno 740 or an
830 — and §7.16 records the owner's statement that from Adreno 750 up the GPU flies. So the app
cannot use a good GPU even in principle, and the single measurement we have is from the weakest
chip we own. **This is the largest known gap in the table.**

---

## 2. Context and history — where the magic numbers live

| knob | resolved from | RAM | CPU | GPU | model | evidence | where |
|---|---|:-:|:-:|:-:|:-:|---|---|
| verbatim window (messages) | **DERIVED** — char budget from post-clamp `n_ctx`, message count demoted to a cap | ✓ (via n_ctx) | — | — | ✓ (via n_ctx) | measured (20 msgs ≈ 4743 prompt tokens) | `windowProfile.ts` |
| window reserve | **CONST** 2048 tokens | — | — | — | — | reasoned (system ~500 + digest ~350 + thinking 512) | `windowProfile.ts:29` |
| chars per token | **CONST** 3 | — | — | — | ✗ | assumed — **it is a property of the tokenizer, i.e. of the model** | `windowProfile.ts:38` |
| window share (0.75 / 0.60) | **CONST**, switched by whether a digest exists | — | — | — | — | reasoned | `windowProfile.ts:50` |
| per-message char cap | **CONST** 4000 / 2000 with images | — | — | — | — | assumed | `compactor.ts:321` |
| compactor rebuild budget | **CONST** `WINDOW_CHAR_BUDGET = 16 000` | — | — | — | — | assumed | `compactor.ts:119` |
| long-chat nudge threshold | **CONST** `2/3` of `n_ctx`, plus 40 messages | — | — | — | ✓ (via n_ctx) | reasoned | `longChatEstimate.ts:27` |
| tokens per image | **CONST** 800 | — | — | — | ✗ | **assumed, and the file says so** — nobody has measured it on a device | `longChatEstimate.ts:48` |
| compaction mode | **PREF** — `off` / `ciswire` / `v42` | — | — | — | — | measured (ciswire +0.209 to +0.635) | `compactor.ts` |
| digest cadence | **PREF** (bench), default every turn | — | — | — | — | **never run** — knob written, no result | `compactor.ts` |
| summary budget | **CONST** 600 chars | — | — | — | — | assumed | `compactor.ts:325` |
| BM25 / RRF constants | **CONST** (B 0.75, RRF_K 60, dedup 0.7) | — | — | — | — | reasoned (standard values) | `retriever.ts` |

⚠️ **Two constants describing one physical limit.** `LONG_CHAT_CTX_FRACTION = 2/3` and the window's
`0.75 / 0.60 of (n_ctx − 2048)` both answer "how much context may history occupy". They were written
independently and can disagree: the nudge can stay silent while the window is already trimming, or
fire while there is room. Neither is wrong on its own; having two is.

⚠️ **`WINDOW_CHARS_PER_TOKEN = 3` is a model property held as a constant.** Chars per token depends
on the tokenizer and the language. It is deliberately low so the error is a smaller window rather
than a silent `ctx_shift`, but it belongs in `ModelRegistry` next to `kvCache`, not in a shared file.

---

## 3. Generation, tools, memory

| knob | resolved from | RAM | CPU | GPU | model | evidence | where |
|---|---|:-:|:-:|:-:|:-:|---|---|
| thinking budget | **CATALOG** (`thinking.short/extended`) | — | — | — | ✓ | measured (§7.9: `preserve_thinking` reuse 0.035 → 0.599) | `ModelRegistry.ts` |
| thinking on/off | **fixed by policy** — never off, never budget 0 (owner) | — | — | — | — | measured (small models need it) | `KALSA.md` §10 |
| `preserveThinking` | **CATALOG** | — | — | — | ✓ | measured | `ModelRegistry.ts` |
| tool gate | **PREF** (`toolgate`, default on) | — | — | — | — | measured (precision 0.241 → 0.485) | `benchConfig.ts` |
| tool choice | **PREF** (`auto` / `required` / `none`) | — | — | — | — | measured | `benchConfig.ts` |
| tool-round KV replay | **not implemented** — a tool call always invalidates the cache | — | — | — | ✓ | measured that it costs; **fix unmeasured** | `LlamaService.ts:1967` |
| memory subsystem | **PREF** (default off) | — | — | — | — | **has never extracted anything** | `MemoryStore` |
| memory facts in prompt | **CONST** newest 10 | — | — | — | — | assumed | `AppShell.tsx` |
| image slots per message | **CONST** 5 | — | — | — | — | assumed | `longChatEstimate.ts:98` |
| `image_max_tokens` | **CONST** 512 | — | — | — | ✓ | reasoned (PocketPal ships the same) | `LlamaService.ts` |
| vision on GPU | **CONST** — iOS only; Android CPU after a field crash | — | — | ✗ | — | measured (Xiaomi 14 native crash) | `LlamaService.ts:957` |

---

## 4. What the table makes visible

Ordered by what it would cost us to keep ignoring.

1. **The GPU is chosen by operating system, not by GPU.** Android is pinned to `cpu-only`
   regardless of silicon. Our only measurement is an Adreno 740, the weakest chip we own, and the
   owner states that from 750 up the GPU flies. Kalsa ships to phones we have never measured and
   currently could not use even if we had.
2. **Nothing depends on the GPU at all** — the whole column is empty except for gates that switch
   it *off*. That is the honest summary of the accelerator story today.
3. **Two independent answers to "how much context may history take"** (§2). They will drift.
4. **Three numbers marked `assumed` sit in the user-visible path**: tokens per image (the file
   admits it), the per-message char cap, and chars per token. The first already shaped a UI
   threshold.
5. **`n_ctx` is the only place RAM reaches the context layer**, and it is a single cliff at 7.5 GB
   — 82 MB wide enough to exclude the device we test on. Everything downstream of `n_ctx` inherits
   that cliff, including the window.
6. **Two subsystems have knobs but no results**: digest cadence (written, never run) and the
   memory subsystem (on by pref, has never extracted a fact). Both are cost with no measured
   benefit.
7. **Tool rounds have a measured cost and no fix**, and on a model that cannot roll back recurrent
   state every tool call is a guaranteed full cache loss.

## 5. What would close the biggest gap

Not a plan, a note of what row 1 needs: `resolveBackendPolicy` would have to take a GPU
identity rather than a platform string. The identity already exists inside the OpenCL backend
(`get_adreno_gpu_gen`, `ggml-opencl.cpp:249`) — it is simply never surfaced to the JS side. Until
it is, "should Kalsa use the GPU" is not a question the app can ask, only one we can answer by
hand, per device, with a bench knob.
