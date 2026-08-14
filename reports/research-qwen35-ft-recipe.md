RECIPE_YELLOW — target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj","in_proj_qkv","in_proj_z","in_proj_a","in_proj_b","out_proj"]

# Recon: LoRA recipe for Qwen/Qwen3.5-2B (hybrid GDN + gated attention)

Date: 2026-08-13. Web + two local files only (`docs/tool-registry-v1.md`, `reports/research-epfl-lfm25.md` §7). Every claim has a URL. `NOT_PUBLISHED` where nothing is published. Official docs are marked **OFFICIAL**; community cards / issues / Unsloth are **COMMUNITY**.

**Why YELLOW, not GREEN.** The hybrid module map is now closed and a first-pass skeleton is runnable. Three things are still not safe to treat as “just copy LFM §7.4”:

1. Qwen3.5’s *native* `tools=` path is **qwen3_coder XML**, not the Hermes JSON the frozen registry calls “Qwen35 canonical.” Training compact inventory + `<tool_call>{JSON}</tool_call>` while serving `tools=` is the dual-prefix bug already frozen as High in the registry.
2. GDN has two silent-skip classes (wrong Next names `in_proj_qkvz`/`in_proj_ba`; `A_log`/`dt_bias` as `nn.Parameter`). Published 2B adapters disagree on whether to LoRA GDN at all; nobody published a tool-format + Italian outcome for either choice.
3. `convert_lora_to_gguf.py` is **open-broken** on Qwen3.5 when GDN `out_proj` is in the adapter (`_reorder_v_heads` → `LoraTorchTensor.reshape`). Merge-then-`convert_hf_to_gguf.py` is the path that matches how stock GGUFs already ship in the app.

None of these say “do not train.” They say “do not pass `tools=`, do not copy a Qwen3-Next / Llama name list, merge before GGUF.”

---

## 1. Architecture map

### 1.1 What the 2B actually is

| Field | Value | Source |
| --- | --- | --- |
| Hub id | `Qwen/Qwen3.5-2B` (post-trained; **not** `-Base`) | https://huggingface.co/Qwen/Qwen3.5-2B |
| `architectures` | `Qwen3_5ForConditionalGeneration` | https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/config.json |
| Top `model_type` | `qwen3_5` | same |
| Text `model_type` | `qwen3_5_text` | same `text_config` |
| Class family | VLM (vision encoder + language decoder). Text-only path exists as `Qwen3_5ForCausalLM`. | https://huggingface.co/docs/transformers/en/model_doc/qwen3_5 |
| Params / hidden / FFN | 2B / 2048 / 6144 (SwiGLU, `hidden_act=silu`) | card + config |
| Vocab | 248320, tied embeddings | config |
| Layers | **24** | config `num_hidden_layers` |
| Mix | **18 Gated DeltaNet + 6 gated full-attention**, pattern `3× linear + 1× full` × 6 | config `layer_types`; card “Hidden Layout: 6 × (3 × (Gated DeltaNet → FFN) → 1 × (Gated Attention → FFN))” |
| `full_attention_interval` | 4 | config |
| MoE on 2B? | **No.** Dense FFN every layer. `base_model_ep_plan = None  # no Moe`. All `num_experts` / `mlp_only_layers` attributes deleted on `Qwen3_5TextConfig`. The card slogan “GDN + sparse MoE” is the *family* slogan; 2B/4B/9B/27B dense do not have experts. | https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_5/modular_qwen3_5.py |
| GDN heads (2B) | 16 QK heads × 128, 16 V heads × 128 (equal — unlike the 9B/Next default 16/32) | config `linear_*` |
| Full-attn (2B) | 8 Q heads, 2 KV heads, `head_dim=256`, RoPE dim 64 (`partial_rotary_factor=0.25`), `attn_output_gate=true` | config + card |
| Conv kernel | 4 | `linear_conv_kernel_dim` |
| MTP | `mtp_num_hidden_layers: 1`. CausalLM load ignores `^mtp.*`. | config; `Qwen3_5ForCausalLM._keys_to_ignore_on_load_unexpected` |
| Context | 262144 native | card |
| Transformers file | generated `modeling_qwen3_5.py`; **edit** `modular_qwen3_5.py`. GDN/Attention/MLP inherit Qwen3-Next, then 3.5 **splits** the GDN in-projections. | https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_5/modeling_qwen3_5.py · https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_5/modular_qwen3_5.py · parent https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_next/modeling_qwen3_next.py |

`layer_types` (verbatim from the 2B config):

```
linear_attention × 3, full_attention,
linear_attention × 3, full_attention,
… (six groups; full-attn at indices 3, 7, 11, 15, 19, 23)
```

https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/config.json

Decoder layer (`Qwen3_5DecoderLayer`): `block_type = config.layer_types[layer_idx]`. Linear layers own `self.linear_attn`; full-attn layers own `self.self_attn`. Every layer has `self.mlp`, `input_layernorm`, `post_attention_layernorm`. https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_5/modular_qwen3_5.py

### 1.2 Exact module names

**Full-attention block** (`Qwen3_5Attention` = `Qwen3NextAttention`). Names are **Llama-style `o_proj`**, not LFM `out_proj`.

| Attribute | Type | Notes |
| --- | --- | --- |
| `self_attn.q_proj` | `nn.Linear` | outputs **2×** (`query` + sigmoid **gate**). `attn_output_gate=true`. |
| `self_attn.k_proj` | `nn.Linear` | |
| `self_attn.v_proj` | `nn.Linear` | |
| `self_attn.o_proj` | `nn.Linear` | **this name, not `out_proj`** |
| `self_attn.q_norm` / `k_norm` | `Qwen3NextRMSNorm` (`nn.Parameter` weight) | PEFT `target_modules` will not wrap these |

https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_next/modeling_qwen3_next.py (`class Qwen3NextAttention`) · tp plan in modular_qwen3_5.py

**Gated DeltaNet block** (`Qwen3_5GatedDeltaNet`). **This is the LFM-style name trap.** Qwen3-Next constructs `in_proj_qkvz` + `in_proj_ba`. Qwen3.5 **deletes those two** and splits into four Linears:

```python
# modular_qwen3_5.py — Qwen3_5GatedDeltaNet.__init__
del self.in_proj_qkvz
del self.in_proj_ba
self.in_proj_qkv = nn.Linear(...)
self.in_proj_z   = nn.Linear(...)
self.in_proj_b   = nn.Linear(...)
self.in_proj_a   = nn.Linear(...)
```

| Attribute | Type | PEFT `target_modules`? |
| --- | --- | --- |
| `linear_attn.in_proj_qkv` | `nn.Linear` | Yes |
| `linear_attn.in_proj_z` | `nn.Linear` | Yes |
| `linear_attn.in_proj_b` | `nn.Linear` | Yes (β / update rate) |
| `linear_attn.in_proj_a` | `nn.Linear` | Yes (α / decay input) |
| `linear_attn.out_proj` | `nn.Linear` | Yes. **GDN name is `out_proj`, not `o_proj`.** |
| `linear_attn.conv1d` | `nn.Conv1d` (depthwise, k=4, inherited) | Almost never LoRA’d. Not a Linear. |
| `linear_attn.A_log` | **`nn.Parameter`** (per V-head log-decay) | **No.** Silent skip — LFM-experts class. |
| `linear_attn.dt_bias` | **`nn.Parameter`** (per V-head, init 1) | **No.** Same trap. |
| `linear_attn.norm.weight` | `Qwen3NextRMSNormGated` Parameter | No |

Inherited GDN params + conv: https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_next/modeling_qwen3_next.py (`class Qwen3NextGatedDeltaNet`). 3.5 override: modular_qwen3_5.py. Independent write-up of the same names: https://gist.github.com/justinchuby/0213aa253664fb72e9adb0089816de15 (that gist still describes Next’s fused `in_proj_qkvz`/`in_proj_ba` — **do not copy those two strings onto 3.5**).

**MLP** (every layer, dense): `mlp.gate_proj`, `mlp.up_proj`, `mlp.down_proj` — all `nn.Linear`, SwiGLU. Same file, `Qwen3NextMLP` / `Qwen3_5MLP`.

**Norms:** `input_layernorm.weight`, `post_attention_layernorm.weight`, final `model.norm.weight` — `nn.Parameter`. Do not list them in `target_modules`.

### 1.3 What PEFT cannot reach (the LFM-experts equivalent)

On **this 2B there are no MoE experts**. The LFM trap (`gate_up_proj` / `down_proj` as `nn.Parameter`) **does not exist here**. https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/qwen3_5/modular_qwen3_5.py (`base_model_ep_plan = None  # no Moe`)

What *does* exist:

| Weight | Why PEFT misses it |
| --- | --- |
| `linear_attn.A_log`, `linear_attn.dt_bias` | `nn.Parameter`, not `nn.Linear`. Same class as LFM experts. `target_modules` will not wrap them. PEFT would need `target_parameters`. https://huggingface.co/docs/peft/en/package_reference/lora (“Targeting nn.Parameter directly”) |
| `linear_attn.conv1d.weight` | `Conv1d` |
| all RMSNorm / gated-RMSNorm `.weight` | Parameter |
| vision tower | separate module; freeze for text FT |
| MTP head | ignored on CausalLM load |

Copying a **Qwen3-Next** LoRA list (`in_proj_qkvz`, `in_proj_ba`) onto 3.5 is a **silent skip** of every GDN in-projection. Copying a **Llama** list that only has `o_proj` skips every GDN `out_proj`. Copying an **LFM** list that only has `out_proj` skips every full-attn `o_proj`. Those three typos are the 3.5 equivalents of Liquid’s own `o_proj` vs `out_proj` footgun (`research-epfl-lfm25.md` §7.3).

---

## 2. LoRA targets that work

No official Qwen cookbook publishes a 3.5-2B `target_modules` list. What exists:

### 2.1 Official-adjacent defaults

| Source | Kind | `target_modules` | r / α / lr / epochs | GDN? |
| --- | --- | --- | --- | --- |
| **Unsloth Qwen3.5 FT guide** | **COMMUNITY** (vendor of the notebook Qwen links from their training index) | `q_proj k_proj v_proj o_proj gate_proj up_proj down_proj` | r=16, α=16, (no lr in the snippet; their generic LoRA guide is 2e-4) | **Frozen** |
| **ms-swift Qwen3.5 Best Practices** (ModelScope / Alibaba training stack) | **OFFICIAL-ADJACENT** | `all-linear` | r=8, α=32, **lr 1e-4**, **1 epoch**, dense 4B demo | **Yes** — all GDN Linears (`in_proj_*`, `out_proj`) plus attn + MLP. Still skips `A_log`/`dt_bias`/`conv1d`. |
| **Qwen training docs → MS-SWIFT** | **OFFICIAL** but still written for **Qwen3**, not 3.5 | `all-linear`, r=8, α=32, lr 1e-4, 1 epoch | same | N/A (Qwen3 has no GDN) |

- Unsloth 3.5: https://unsloth.ai/docs/models/qwen3.5/fine-tune
- SWIFT 3.5: https://swift.readthedocs.io/en/latest/BestPractices/Qwen3_5-Best-Practice.html
- Qwen MS-SWIFT (Qwen3): https://qwen.readthedocs.io/en/latest/training/ms_swift.html
- LLaMA-Factory lists `qwen3_5` / `qwen3_5_nothink` as supported templates; their public 3.5 tutorial (9B vision, lr 1e-4, 5 epochs on 405 rows) does **not** print a module list. https://github.com/hiyouga/LlamaFactory · https://blog.llamafactory.net/posts/qwen3_5_finetuning/

### 2.2 Published 2B adapters (Hub)

| Repo | Targets | r/α | Outcome published? |
| --- | --- | --- | --- |
| [pebeto/amigo-lora](https://huggingface.co/pebeto/amigo-lora) | **attn+MLP only** (no GDN) | 16/32, QLoRA 4-bit, 3 ep, lr **2e-4**, 366 ES+EN rows | **Yes (COMMUNITY):** bilingual mix kept Spanish; 5 epochs overfit (verbatim recall); **attention-only underfit**. Shipped a llama.cpp LoRA GGUF. |
| [MDK-YLC/Qwen3.5-2B-WMT26-Ukrainian-LoRA](https://huggingface.co/MDK-YLC/Qwen3.5-2B-WMT26-Ukrainian-LoRA) | **attn+MLP only** | 16/32, 1-epoch stage-2 + **replay** (QA/MR/MT/GC) | Language-adaptation campaign (UK). No IT, no tools. GDN frozen. |
| [myyycroft/Qwen3.5-2B-AmbigQA-lora-8-member-2](https://huggingface.co/myyycroft/Qwen3.5-2B-AmbigQA-lora-8-member-2/raw/main/adapter_config.json) | attn+MLP **+ GDN Linears** (`in_proj_qkv/z/a/b`, `out_proj`) | r=8, α=16 | Config only. **No eval vs stock, no tool-call metric.** |
| [armand0e/qwen3.5-2b-opus-repair-stage1-lora](https://huggingface.co/armand0e/qwen3.5-2b-opus-repair-stage1-lora/raw/main/adapter_config.json) | Unsloth regex including `in_proj_qkv/z/a/b` + `out_proj` + attn/MLP | r=32, α=32 | Config only. Proves Unsloth *can* hit GDN when not using the short list in the docs. |

Hub tree as of this recon: **149 adapters**, **310 finetunes** of `Qwen/Qwen3.5-2B`. https://huggingface.co/Qwen/Qwen3.5-2B — I did not enumerate all 149.

A user asked on the 27B card whether to include the GDN four + `out_proj`. **No Qwen reply.** https://huggingface.co/Qwen/Qwen3.5-27B/discussions/26

### 2.3 Is attn+MLP enough (GDN frozen)?

**NOT_PUBLISHED** for tool-format + Italian.

What *is* published: two language-style 2B LoRAs (amigo voice, WMT26 Ukrainian) froze GDN and still moved the language. Amigo explicitly reports attention-only **underfit**. SWIFT’s own 3.5 recipe uses `all-linear`, i.e. they do **not** freeze GDN on the official-adjacent path. 18/24 mixer blocks are GDN; leaving them frozen means 75% of token-mixing is a frozen linear-attention path while we try to teach a new inventory + call syntax.

Nobody published “we LoRA’d `in_proj_*` and tool-call exact-match went up/down.” Treat GDN Linears as the **first escalation**, not the first experiment, unless we are already on SWIFT `all-linear`.

### 2.4 Known silent-skip bugs

1. **`in_proj_qkvz` / `in_proj_ba`** — Next names, deleted on 3.5. Silent skip of all GDN in-projections. modular_qwen3_5.py.
2. **`o_proj` vs `out_proj`** — both exist, on *different* blocks. A list with only one of them is a half-skip, not an error.
3. **`A_log` / `dt_bias`** — Parameters. `target_modules` cannot see them. Do not expect decay/beta biases to move under LoRA.
4. **`all-linear` vs a hand list** — `all-linear` is the only published way to guarantee every Linear (including GDN) is wrapped. A typo’d hand list fails closed.
5. **Vision / MTP** — `all-linear` on `Qwen3_5ForConditionalGeneration` will also hit the vision tower unless you freeze it (`finetune_vision_layers=False` in Unsloth; `--freeze_vit true` in SWIFT MoE demo). We do not want that.

---

## 3. Official guidance (3.5 series)

### 3.1 What Qwen actually published for 3.5 FT

| Doc | Status | What it says for *our* knobs |
| --- | --- | --- |
| 2B model card | **OFFICIAL** | Default **non-thinking**. No `/think`/`/nothink` soft switch. Sampling tables. Tool serve flag = `qwen3_coder`. No LoRA r/α/lr. https://huggingface.co/Qwen/Qwen3.5-2B |
| Qwen3.5 blog | **OFFICIAL** | Family pitch (hybrid, 201 langs, agents). No FT hyperparams. https://qwen.ai/blog?id=qwen3.5 |
| Qwen training index (Axolotl / LLaMA-Factory / MS-SWIFT / Unsloth / verl) | **OFFICIAL** | Still Qwen3-era examples. SWIFT page is Qwen3-8B, r=8/α=32/lr=1e-4/1 epoch/`all-linear`. https://qwen.readthedocs.io/en/latest/training/ms_swift.html · https://qwen.readthedocs.io/en/latest/training/llama_factory.html |
| ms-swift **Qwen3.5 Best Practices** | **OFFICIAL-ADJACENT** (Alibaba ModelScope; this is the only 3.5-specific FT recipe with numbers) | Dense: `transformers>=5.9`, `flash-linear-attention>=0.4.2`, `causal-conv1d`, LoRA r=8 α=32 lr **1e-4** 1 epoch `all-linear` bf16, `--add_non_thinking_prefix true`, `--loss_scale ignore_empty_think`, `--enable_thinking false`. 4B LoRA demo = 4×20 GiB at 2048. Packing: claimed supported on transformers with `ms-swift>=4.3.1`; older SWIFT docs said GDN **cannot** pack. https://swift.readthedocs.io/en/latest/BestPractices/Qwen3_5-Best-Practice.html |
| Unsloth 3.5 guide | **COMMUNITY** | **transformers v5 required.** 2B bf16 LoRA **5 GB** (at their 2048 start). r=16 α=16 attn+MLP. QLoRA 4-bit **not recommended** (quantization error, dense *and* MoE). Preserve reasoning ⇒ **≥75% reasoning rows**. GGUF export via `save_pretrained_gguf`. https://unsloth.ai/docs/models/qwen3.5/fine-tune |

**No official 2B-specific r/α/lr.** Closest official-adjacent: SWIFT 1e-4 / r=8 / α=32 / 1 epoch. Closest community 2B that reported a language outcome: amigo 2e-4 / r=16 / α=32 / 3 epochs on 366 rows (too few rows, too many epochs for us).

### 3.2 Thinking vs the registry’s 20% tagged subset

2B card, **OFFICIAL**: “Qwen3.5-2B operates in **non-thinking mode by default**.” Enable via `enable_thinking: True`. “Qwen3.5 does **not** officially support the soft switch of Qwen3, i.e. `/think` and `/nothink`.” In thinking mode the 2B is “more prone to entering thinking loops.” Historical turns should drop think content (implemented in the Jinja). https://huggingface.co/Qwen/Qwen3.5-2B

Template behavior (`chat_template.jinja`, **OFFICIAL bytes**):

- `enable_thinking is true` → assistant prompt is `<think>\n` (open).
- else (default) → `<think>\n\n</think>\n\n` (empty think, then answer).
- After the last user turn, think is kept; older assistant turns are stripped to final content.

https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/chat_template.jinja

Qwen MS-SWIFT (**OFFICIAL**, Qwen3 page, reused by SWIFT 3.5): if you train *without* CoT but want to keep the ability, use `--loss_scale ignore_empty_think` and/or `--add_non_thinking_prefix`. Do **not** use the Qwen3 `/no_think` query hack on 3.5 — the 2B card says that switch is unsupported. https://qwen.readthedocs.io/en/latest/training/ms_swift.html

**Compatibility with registry 20% tagged / never-strip:**

| Registry rule | 3.5 template | Verdict |
| --- | --- | --- |
| 20% traces tagged `<think>…</think>` | Those rows must be rendered with `enable_thinking=True` (open `<think>`). Half IT / half EN think text is fine — tokens are the same. | Compatible |
| 80% untagged | Render with default empty `<think>\n\n</think>\n\n`. Mask those four tokens out of the loss (`ignore_empty_think`). | Compatible, and this matches product default |
| “never strip” | Do not strip think from the *target* of a tagged row. Do strip think from *history* turns the way the Jinja already does. | Compatible |
| Unsloth “≥75% reasoning to preserve thinking” | **COMMUNITY**, opposite mix. Relevant only if we want thinking as the shipped default. We do not: 2B default + app chat is non-thinking. | Do not adopt 75% |

Training 20% open-think + 80% empty-think-and-ignore is the SWIFT-shaped way to keep the 20% registry tag without teaching the 2B to loop.

---

## 4. Tool-call format

### 4.1 What `apply_chat_template(tools=…)` actually injects

**OFFICIAL bytes**, 2B `chat_template.jinja`. If `tools` is a non-empty iterable it **replaces** the system prefix with:

```
<|im_start|>system
# Tools

You have access to the following functions:

<tools>
{tool | tojson}          # FULL JSON schema, one object per tool, no pretty-print
…
</tools>

If you choose to call a function ONLY reply in the following format with NO suffix:

<tool_call>
<function=example_function_name>
<parameter=example_parameter_1>
value_1
</parameter>
…
</function>
</tool_call>

<IMPORTANT>
Reminder:
- Function calls MUST follow the specified format: an inner <function=...></function>
  block must be nested within <tool_call></tool_call> XML tags
- …
</IMPORTANT>
{optional original system content}
<|im_end|>
```

Assistant `tool_calls` are re-rendered as the same XML (`<tool_call>\n<function=NAME>\n<parameter=k>\nv\n</parameter>…`). `role:tool` is wrapped as `<tool_response>…</tool_response>` inside a `user` turn.

https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/chat_template.jinja

Serve flags on the **same card**: vLLM/SGLang `--tool-call-parser qwen3_coder`. That is the XML dialect, not Hermes. https://huggingface.co/Qwen/Qwen3.5-2B

Qwen’s *older* function-calling page still says “We recommend using Hermes-style tool use for **Qwen3**” and `vllm … --tool-call-parser hermes`. That page has not been rewritten for 3.5. https://qwen.readthedocs.io/en/latest/framework/function_call.html

### 4.2 Special tokens vs our compact + Hermes JSON

From `tokenizer_config.json` **OFFICIAL**:

| Token | id | `special` |
| --- | --- | --- |
| `<tool_call>` / `</tool_call>` | 248058 / 248059 | **false** (added vocab, single token) |
| `<tool_response>` / `</tool_response>` | 248066 / 248067 | false |
| `<think>` / `</think>` | 248068 / 248069 | false |
| `<function=` / `<parameter=` / `<tools>` | — | **not** reserved; ordinary BPE |

https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/tokenizer_config.json

So: training `<tool_call>{"name":"web_search","arguments":{…}}</tool_call>` **reuses the same two reserved tokens** the XML path uses as a wrapper. The conflict is **not** a missing-token / embedding problem. The conflict is **prefix + inner syntax**:

- Native 3.5 + `tools=`: full JSON schemas in `<tools>` + XML inner + a long IMPORTANT essay.
- Frozen registry (KD3/KD4): compact one-liners `id(arg, opt?) — desc` under `Tools (call ONLY names listed…)` + Hermes JSON inner. `tools=` only if PR-2 dump shows **zero extra schema bytes**.

That is exactly the dual-prefix High in `tool-registry-v1.md`. Passing `tools=` at train *or* infer while gold is Hermes JSON fights the template the same way Terminal-ToolBench’s `{analysis,plan,commands}` fought LFM native tokens (`research-epfl-lfm25.md` §7.1).

### 4.3 What others who trained / served custom formats on Qwen3.5 reported

| Report | Kind | Fact |
| --- | --- | --- |
| Ollama wired **Qwen3 Hermes JSON** renderer onto 3.5 | **COMMUNITY** | “Qwen 3.5 tool calling is completely broken because Ollama wires the wrong renderer (Qwen 3 Hermes JSON format instead of the Qwen3-Coder XML).” https://www.answeroverflow.com/m/1478404374379364443 |
| NVIDIA forum, 122B | **COMMUNITY** | `--tool-call-parser qwen3_coder` + new template still silent-failed on long Hermes-Agent jobs; `qwen3_xml` was “the real winner.” Not a training report. https://forums.developer.nvidia.com/t/qwen3-5-tool-calling-finally-fixed-possibly/366451 |
| Stock 2B card parser | **OFFICIAL** | `qwen3_coder` |
| Anyone published an SFT that *replaced* 3.5 XML with compact-inventory + Hermes JSON and measured exact-match vs stock | — | **NOT_PUBLISHED** |

**Implication for us (not a guess about weights — a contract fact):** PR-2 must dump `apply_chat_template` **with and without** `tools=`. If extra bytes ≠ 0 (they will not be — the template above is dozens of schema tokens per tool), **omit `tools=`** at train and at v1 infer, put the frozen compact block in the system message, parse Hermes `<tool_call>{JSON}</tool_call>` (and keep the XML leak parser as a safety net). Do not also pass `tools=` “for the binding.” That is KD4.

Qwen’s own function-call page ends with the only official blessing we need for a custom format: if the generation is not up to expectation, “the ultimate solution is fine-tuning using your own data.” https://qwen.readthedocs.io/en/latest/framework/function_call.html

---

## 5. Forgetting / multilingual

No published 2B LoRA reports Italian PPL before/after. What exists:

| Report | Kind | Takeaway we can actually use |
| --- | --- | --- |
| 2B card | **OFFICIAL** | 201 languages; MMMLU-thinking 63.1, WMT24++ 45.8, MAXIFE 60.6. Italian is in the 201, not a first-class eval row. https://huggingface.co/Qwen/Qwen3.5-2B |
| Unsloth 3.5 | **COMMUNITY** | “powerful for multilingual fine-tuning (201 languages).” No mix recipe. To keep *reasoning*, ≥75% reasoning rows — different axis from language. https://unsloth.ai/docs/models/qwen3.5/fine-tune |
| amigo-lora (2B, ES+EN voice) | **COMMUNITY** | 186 ES + 180 EN. “Bilingual training kept the Spanish voice intact.” 5 epochs overfit. Attention-only underfit. https://huggingface.co/pebeto/amigo-lora |
| WMT26 Ukrainian LoRA (2B) | **COMMUNITY** | Stage-2 = 1 epoch on 16.9k CS→UK **plus replay** of QA / MR / MT / GC. Attn+MLP, r=16 α=32. Closest published “language + replay, don’t forget the other tasks” 2B recipe. https://huggingface.co/MDK-YLC/Qwen3.5-2B-WMT26-Ukrainian-LoRA |
| Biderman et al., *LoRA Learns Less and Forgets Less* | paper, **not 3.5** | LoRA forgets less than full FT; at long duration the gap grows. https://arxiv.org/html/2405.09673v2 |
| oflight 9B guide | **COMMUNITY lore** | 10–20% general QA replay, lr 1e-5–5e-5, 3–5 epochs. Not measured on 2B, not official. https://www.oflight.co.jp/en/columns/qwen35-9b-fine-tuning-guide |
| Ivan, Qwen3-1.7B (not 3.5) | **COMMUNITY** | 1 epoch, r=16 α=16, lr 1–2e-4, optional KL 0.03–0.10 “no obvious regression.” https://blog.ivan.digital/finetuning-qwen3-with-lora-done-right-94d6343e1814 |

**For our mix:** nobody published 50/50 IT-chat : tool-traces on Qwen3.5. That ratio is still the right *shape* (registry second axis + LFM §7.4). The only 2B evidence that replay works is WMT26’s stage-2 “task + replay.” Hold out IT PPL + tool exact-match vs stock 2B and stop at 1 epoch if either regresses (registry already says this).

Do **not** full-FT the 2B to “make Italian stick.” LoRA is the documented less-forgetting path, and SWIFT/Unsloth both treat LoRA as the 3.5 default.

---

## 6. Infra

### 6.1 Library support

| Piece | Min / status | Source |
| --- | --- | --- |
| transformers | **v5** (Unsloth). SWIFT writes `>=5.9`. Config on the Hub still says `4.57.0.dev0` (upload-time). Older 4.x will not load `qwen3_5`. | https://unsloth.ai/docs/models/qwen3.5/fine-tune · https://swift.readthedocs.io/en/latest/BestPractices/Qwen3_5-Best-Practice.html · https://huggingface.co/docs/transformers/en/model_doc/qwen3_5 |
| PEFT | works; `target_modules` on Linears. No 3.5-specific PEFT bug filed that I found for name matching. Parameters (`A_log`) need `target_parameters` if we ever want them. | PEFT LoRA docs https://huggingface.co/docs/peft/en/package_reference/lora |
| TRL SFT | works as the trainer. Watch `assistant_only_loss` + truncation (all-`-100` labels). Extra EOS on Qwen is a known TRL class of bug (Qwen2.5 #3318). | https://github.com/huggingface/trl/issues/3927 · https://github.com/huggingface/trl/issues/3318 |
| Unsloth | supported, 0.8B/2B/4B Colabs. Fast kernels compile slowly (Mamba/Triton). | Unsloth 3.5 guide |
| LLaMA-Factory | `qwen3_5` / `qwen3_5_nothink` in the model table. FP8 LoRA merge has an open issue on 27B (`#10328`). | https://github.com/hiyouga/LlamaFactory · https://github.com/hiyouga/LlamaFactory/issues/10328 |
| ms-swift | first-class 3.5 dense + MoE + GRPO on the **2B**. | SWIFT 3.5 best practices |
| flash-linear-attention + causal-conv1d | needed for fast GDN; without them transformers **silently falls back** to a slow, memory-hungry PyTorch chunk/recurrent impl. | https://huggingface.co/docs/transformers/en/model_doc/qwen3_5 |
| vLLM | card wants **nightly / main**. Unsloth: `0.16.0` does **not** support 3.5; wait for `0.17`. SWIFT: `vllm>=0.17.0`. | card · Unsloth · SWIFT |

### 6.2 Open training bugs on GDN

| Bug | Relevance at 4–8k |
| --- | --- |
| Unsloth #4906: inf `grad_norm` / NaN at **seq > 65536** | Not our ctx. https://github.com/unslothai/unsloth/issues/4906 |
| OpenRLHF #1194: DeltaNet layers do not handle **packed** sequence boundaries | **Do not pack** unless the exact transformers+FLA combo is the one SWIFT validated (`ms-swift>=4.3.1`). https://github.com/OpenRLHF/OpenRLHF/issues/1194 |
| Older SWIFT: “transformers’ GatedDeltaNet does not support packing/padding_free” | Same. Prefer `packing=False`. https://swift.readthedocs.io/en/v4.0/BestPractices/Qwen3_5-Best-Practice.html |
| HF thread: 4B loss explosion on mixed teacher-CoT | Format / empty-think / pad-token, not GDN math. Wrong 4-bit pad `<|vision_pad|>` → NaN (Unsloth #4104). https://discuss.huggingface.co/t/qwen3-5-4b-loss-exploding/174057 · https://github.com/unslothai/unsloth/issues/4104 |
| 2B card: thinking loops | Keep 80% non-think; don’t train long open `<think>` as the default. |

### 6.3 VRAM (2B LoRA bf16)

| Claim | Number | Caveat |
| --- | --- | --- |
| Unsloth, 2B bf16 LoRA | **5 GB** | their start ctx is **2048**, `per_device_train_batch_size=1`. https://unsloth.ai/docs/models/qwen3.5/fine-tune |
| SWIFT, 4B LoRA bf16 | 4 × 20 GiB | 2048, bs=4, ZeRO-2. Not 2B. |
| Full FT | “4× more VRAM” (Unsloth) | skip |

**4–8k ctx, response-only, gradient checkpointing (`unsloth` or HF), bs=1–2:** a **single 24 GB** card is enough. 48 GB is comfort, not a requirement. **NOT_PUBLISHED** as a measured 2B-@8k number; 5 GB @ 2k plus linear KV on only 6 full-attn layers makes 8k-on-24 GB a very safe extrapolation, not a lab measurement.

**QLoRA:** Unsloth **does not recommend** 4-bit on any Qwen3.5 (dense or MoE) because of quantization error. Amigo did it anyway on 2B for a 366-row voice job. For a 20–30k tool+IT campaign, stay **bf16 LoRA**.

### 6.4 Merged-LoRA → GGUF

| Path | Status |
| --- | --- |
| Stock 2B → GGUF | Works (we already ship it). llama.cpp needs a **recent** build (GDN ops). https://huggingface.co/AaryanK/Qwen3.5-9B-GGUF (same arch family) |
| **Merge adapter → `convert_hf_to_gguf.py`** | This is how official / Unsloth GGUFs are made. Unsloth: `save_pretrained_merged` then `save_pretrained_gguf`. https://unsloth.ai/docs/models/qwen3.5/fine-tune |
| **Unmerged** `convert_lora_to_gguf.py` | **OPEN BUG.** `_reorder_v_heads` on GDN V-projection + `LoraTorchTensor.reshape` → `NotImplementedError`. Triggered even when the adapter list includes `out_proj`. PR #24627 open. https://github.com/ggml-org/llama.cpp/issues/21125 |
| Adapter GGUF without GDN targets | amigo shipped `amigo-lora-Q8_0.gguf` and `llama-cli --lora` on a stock 2B GGUF. So the *adapter* path can work if you never LoRA a tensor that needs V-head reorder. |
| Post-FT tokenizer | Fine-tunes that rewrite `tokenizer.json` break conversion (“BPE pre-tokenizer was not recognized”). Copy tokenizer files from the **base** into the merged dir. https://discuss.huggingface.co/t/the-bpe-pre-tokenizer-was-not-recognized/175714 |

**Export we should run:** merge LoRA → copy base tokenizer/chat_template → `convert_hf_to_gguf.py` → quantize the way we already requant stock 2B. Do **not** ship an unmerged LoRA GGUF unless 21125 is closed. Inference of the hybrid arch is not the risk; **conversion of a GDN-containing adapter** is.

vLLM LoRA-on-3.5 also had a “module is not in supported LoRA target modules” bug (`vllm#38085`). Irrelevant if we merge.

---

## 7. Verdict and skeleton

**RECIPE_YELLOW.** Safe to spend a first 24 GB job *if* the blockers below are in the training script, not as afterthoughts.

### Blockers (do these or the job is wasted)

1. **Omit `tools=`.** Compact inventory lives in the frozen system prefix. Gold assistant = Hermes `<tool_call>{JSON}</tool_call>`. Confirm with the PR-2 dump. Serving `tools=` injects XML + full schemas — dual prefix, High.
2. **Use 3.5 GDN names, not Next / Llama / LFM.** Never `in_proj_qkvz`, `in_proj_ba`. Both `o_proj` (attn) and `out_proj` (GDN) if we touch GDN.
3. **Do not pack** unless the exact SWIFT≥4.3.1 + FLA combo is pinned and smoke-checked. Default `packing=False`.
4. **Merge, then convert HF→GGUF.** Do not `convert_lora_to_gguf.py` while #21125 is open.
5. **Freeze vision.** Load text-only (`Qwen3_5ForCausalLM`) or `finetune_vision_layers=False` / `--freeze_vit true`.
6. **Think rows must match the template.** 20% `enable_thinking=True` with real `<think>` gold; 80% empty-think + `ignore_empty_think`. No `/no_think`. No 75% reasoning mix.
7. **transformers v5 (≥5.9) + FLA + causal-conv1d + bf16.** Not 4-bit. Pad token must stay `<|endoftext|>`.

### Recommended skeleton (our 20–30k, 50/50 tool : IT-chat, 1 epoch, response-only)

Start from **`Qwen/Qwen3.5-2B`** (post-trained), not `-Base`.

```
# first pass — published-working language recipe (amigo / WMT26)
# escalate by adding the five GDN Linears if tool-JSON exact-match is dead
target_modules = [
    "q_proj", "k_proj", "v_proj", "o_proj",          # gated full-attn (6 layers)
    "gate_proj", "up_proj", "down_proj",              # dense SwiGLU (all 24)
    "in_proj_qkv", "in_proj_z", "in_proj_a", "in_proj_b", "out_proj",  # GDN Linears (18 layers)
]
# do NOT: A_log, dt_bias, conv1d, *norm, vision, in_proj_qkvz, in_proj_ba
# alternative if we want zero name risk: target_modules="all-linear" + freeze vision

r = 16
lora_alpha = 32          # SWIFT uses 8/32; Unsloth snippet 16/16; 2B cards that moved language used 16/32
lora_dropout = 0.05
lr = 1e-4                # SWIFT 3.5 official-adjacent. 2e-4 is Unsloth/amigo; try only if 1e-4 underfits
epochs = 1
warmup_ratio = 0.05
max_grad_norm = 1.0
optim = adamw_torch      # not 8-bit while debugging
bf16 = True
packing = False
max_seq_length = 4096    # 8192 if a tool sandwich + inventory actually needs it; measure, don't guess
per_device_train_batch_size = 2
gradient_accumulation_steps = 8   # effective 16; raise if 24 GB allows
gradient_checkpointing = True
completion / response-only = True
# verify: no batch with 0 supervised tokens (TRL assistant_only_loss + truncation)
```

**Think handling:** `add_generation_prompt` off at train. Tagged 20% → `apply_chat_template(..., enable_thinking=True)` and keep `<think>…</think>` in the assistant gold. Untagged 80% → default template (empty think) + mask `<think>\n\n</think>\n\n` out of the loss. History turns: let the Jinja strip old think.

**Replay mix:** keep the frozen 50/50 IT-chat : tool-traces. Language of user+final = 50 IT / 25 EN / 15 ES / 10 FR (registry). Tool names stay English. Include “no tool needed.” Hold out IT PPL + tool exact-match vs **stock** `Qwen3.5-2B`. Stop if either drops.

**Export:** merge → copy **base** `tokenizer.json` / `tokenizer_config.json` / `chat_template.jinja` → `convert_hf_to_gguf.py` → same requant we already run on stock 2B → set `ModelInfo.toolProtocol = "v1"` on the catalog entry (not a GGUF comment).

**Hardware:** one 24 GB GPU is the planned box. Install `flash-linear-attention` + `causal-conv1d` so GDN does not silently train on the PyTorch fallback.

**Do not:** full-FT; QLoRA; LoRA the router (n/a); LoRA `A_log`/`dt_bias` on pass 1; train on the eval slice; pass `tools=`; use `/no_think`; adopt Terminal-style or XML as the gold (registry is Hermes JSON).

DONE
