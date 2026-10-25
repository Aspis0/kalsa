# Kalsa Brain setting explanations

This document is product copy and review evidence for the Advanced controls. It was written on 2026-09-18 against the `llama-b10950` build. Build defaults come from code; usual values come from the cited web or repository evidence. If they differ, the build code wins.

### `temperature`
- **Label:** Temperature
- **Level:** message
- **What it is:** Temperature controls how freely the model chooses among possible next pieces of text.
- **What it's for:** Higher values make replies more varied and less predictable; lower values make them steadier and more repeatable.
- **Usual values:** 0.8 is the current llama.cpp starting point; lower values suit steadier answers.
- **Default in this build:** 0.80 (`common/common.h:236`) “`float   temp               = 0.80f;  // <= 0.0 to sample greedily, 0.0 to not output probabilities`”
- **Range the server accepts:** 0.0 to infinity (`tools/server/server-schema.cpp:116-118`).
- **Evidence:** [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) supports 0.8 as the current starting default; `common/common.h:236` supports this build’s default; `tools/server/server-schema.cpp:116-118` says it adjusts randomness and accepts 0.0 upward.

### `dynatemp_range`
- **Label:** Dynamic temperature range
- **Level:** message
- **What it is:** This is the most temperature may move up or down when the model judges the next choice more or less predictable.
- **What it's for:** It can add variety when the model is confident and restraint when it is uncertain; zero leaves temperature fixed.
- **Usual values:** No widely agreed value.
- **Default in this build:** 0.00 (`common/common.h:237`) “`float   dynatemp_range     = 0.00f;  // 0.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:120-121`).
- **Evidence:** [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) documents 0.0 as disabled but gives no accepted active value; `common/common.h:237` supports the default; `tools/server/server-schema.cpp:120-121` supplies the server description and no limit.

### `dynatemp_exponent`
- **Label:** Dynamic temperature exponent
- **Level:** message
- **What it is:** This controls how strongly the model’s uncertainty changes the dynamic temperature.
- **What it's for:** It changes where the adjustment sits between the lower and upper temperature limits; it does not itself set the limits.
- **Usual values:** No widely agreed value.
- **Default in this build:** 1.00 (`common/common.h:238`) “`float   dynatemp_exponent  = 1.00f;  // controls how entropy maps to temperature in dynamic temperature sampler`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:123-124`).
- **Evidence:** [Dynamic Temperature paper](https://arxiv.org/abs/2309.02772) supports the sampler’s method but not a universal exponent; `common/common.h:238` supports the default; `tools/server/server-schema.cpp:123-124` describes the exponent and states no limit.

### `top_k`
- **Label:** Top K
- **Level:** message
- **What it is:** Top K limits the next choice to the K most likely pieces of text.
- **What it's for:** Lower values make answers more predictable; higher values leave more alternatives, which can add variety and mistakes.
- **Usual values:** 40 is the llama.cpp starting point; 0 disables this limit.
- **Default in this build:** 40 (`common/common.h:230`) “`int32_t top_k              = 40;     // <= 0 to use vocab size`”
- **Range the server accepts:** 0 to `INT32_MAX` (`tools/server/server-schema.cpp:89-91`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 40 as the documented default and 0 as disabled; `common/common.h:230` supports this build’s default; `tools/server/server-schema.cpp:89-91` gives the accepted range and description.

### `top_p`
- **Label:** Top P
- **Level:** message
- **What it is:** Top P keeps the smallest group of likely next choices whose combined probability reaches P.
- **What it's for:** Lower values narrow the answer towards likely wording; higher values allow more unusual wording and ideas.
- **Usual values:** 0.9 is used in Llama 2; current llama.cpp uses 0.95 as its baseline.
- **Default in this build:** 0.95 (`common/common.h:231`) “`float   top_p              = 0.95f;  // 1.0 = disabled`”
- **Range the server accepts:** 0.0 to 1.0 (`tools/server/server-schema.cpp:93-95`).
- **Evidence:** [Llama 2 paper](https://arxiv.org/abs/2307.09288) reports top-p 0.9; [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) documents 0.95; `common/common.h:231` supports the build default; `tools/server/server-schema.cpp:93-95` gives the range and description.

### `min_p`
- **Label:** Minimum probability
- **Level:** message
- **What it is:** Minimum probability removes a choice that is below P times the probability of the most likely choice.
- **What it's for:** It filters out weak alternatives while keeping the cutoff relative to the model’s confidence, so answers can stay varied without wandering.
- **Usual values:** 0.05 is the llama.cpp starting point; 0 disables this filter.
- **Default in this build:** 0.05 (`common/common.h:232`) “`float   min_p              = 0.05f;  // 0.0 = disabled`”
- **Range the server accepts:** 0.0 to 1.0 (`tools/server/server-schema.cpp:97-99`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 0.05 as the documented default and 0 as disabled; [Minimum P PR](https://github.com/ggml-org/llama.cpp/pull/3841) identifies the sampler; `common/common.h:232` supports the build default; `tools/server/server-schema.cpp:97-99` gives the range and description.

### `typical_p`
- **Label:** Typical probability
- **Level:** message
- **What it is:** Typical probability favours choices whose likelihood is close to the model’s usual likelihood for this point in the answer.
- **What it's for:** It can reduce dull loops while keeping natural alternatives; 1.0 leaves this sampler disabled.
- **Usual values:** No widely agreed value.
- **Default in this build:** 1.00 (`common/common.h:235`) “`float   typ_p              = 1.00f;  // typical_p, 1.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:112-114`).
- **Evidence:** [Locally Typical Sampling paper](https://arxiv.org/abs/2202.00666) supports the method and reports competitive results, not a universal setting; `common/common.h:235` supports the disabled default; `tools/server/server-schema.cpp:112-114` deliberately leaves the range unstated.

### `top_n_sigma`
- **Label:** Top N spread
- **Level:** message
- **What it is:** Top N spread keeps choices within N measures of score spread from the best choice.
- **What it's for:** It removes choices far below the best score; negative values disable this filter.
- **Usual values:** No widely agreed value.
- **Default in this build:** -1.00 (`common/common.h:250`) “`float   top_n_sigma        = -1.00f; // -1.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:101-102`).
- **Evidence:** [Top-nσ paper](https://arxiv.org/abs/2411.07641) introduces the method but does not establish a universal N; `common/common.h:250` supports the disabled default; `tools/server/server-schema.cpp:101-102` describes the filter and states no limit.

### `xtc_probability`
- **Label:** Exclude top choices chance
- **Level:** message
- **What it is:** XTC, or Exclude Top Choices, is the chance of removing some of the most likely choices.
- **What it's for:** It can break predictable wording and repeated patterns; higher values make that intervention happen more often.
- **Usual values:** No widely agreed value.
- **Default in this build:** 0.00 (`common/common.h:233`) “`float   xtc_probability    = 0.00f;  // 0.0 = disabled`”
- **Range the server accepts:** 0.0 to 1.0 (`tools/server/server-schema.cpp:104-106`).
- **Evidence:** [XTC description and implementation reference](https://github.com/oobabooga/text-generation-webui/pull/6335) supports what XTC does but not a universal chance; `common/common.h:233` supports the disabled default; `tools/server/server-schema.cpp:104-106` gives the range and description.

### `xtc_threshold`
- **Label:** Exclude top choices threshold
- **Level:** message
- **What it is:** This is the minimum probability a choice must have before XTC may remove it.
- **What it's for:** Lower values let XTC affect more choices; values above 0.5 turn XTC off in this server.
- **Usual values:** No widely agreed value.
- **Default in this build:** 0.10 (`common/common.h:234`) “`float   xtc_threshold      = 0.10f;  // > 0.5 disables XTC`”
- **Range the server accepts:** 0.0 to 1.0 (`tools/server/server-schema.cpp:108-110`).
- **Evidence:** [XTC implementation reference](https://github.com/oobabooga/text-generation-webui/pull/6335) supports the sampler but not a universal threshold; `common/common.h:234` supports the default and disabled condition; `tools/server/server-schema.cpp:108-110` gives the range and description.

### `repeat_penalty`
- **Label:** Repetition penalty
- **Level:** message
- **What it is:** Repetition penalty lowers the chance of text pieces already used in the recent answer.
- **What it's for:** Values above 1 can reduce repeated phrases; 1 leaves the penalty disabled, while values below 1 can encourage repetition.
- **Usual values:** 1.0 is the llama.cpp baseline; some llama.cpp examples use 1.1.
- **Default in this build:** 1.00 (`common/common.h:240`) “`float   penalty_repeat     = 1.00f;  // 1.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:130-131`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 1.0 as the baseline; [llama.cpp discussion #6824](https://github.com/ggml-org/llama.cpp/discussions/6824) shows a practitioner example using 1.1; `common/common.h:240` supports the default; `tools/server/server-schema.cpp:130-131` gives the description and no limit.

### `repeat_last_n`
- **Label:** Repetition lookback
- **Level:** message
- **What it is:** Repetition lookback says how many recent text pieces the repetition penalty can inspect.
- **What it's for:** A larger lookback catches older repeated wording but can make a reply less faithful to its own established phrasing; 0 disables it.
- **Usual values:** 64 is the llama.cpp baseline; 0 disables the penalty.
- **Default in this build:** 64 (`common/common.h:239`) “`int32_t penalty_last_n     = 64;     // last n tokens to penalize (0 = disable penalty)`”
- **Range the server accepts:** 0 to `INT32_MAX` (`tools/server/server-schema.cpp:126-128`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 64 as the documented baseline and 0 as disabled; `common/common.h:239` supports the build default; `tools/server/server-schema.cpp:126-128` gives the accepted range and description.

### `frequency_penalty`
- **Label:** Frequency penalty
- **Level:** message
- **What it is:** Frequency penalty lowers a choice more each time the same text piece has already appeared.
- **What it's for:** It can discourage repeated words and phrases; 0 leaves it disabled.
- **Usual values:** 0 is the llama.cpp baseline; active values depend on the model and task.
- **Default in this build:** 0.00 (`common/common.h:241`) “`float   penalty_freq       = 0.00f;  // 0.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:133-134`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 0 as the disabled baseline; `common/common.h:241` supports the build default; `tools/server/server-schema.cpp:133-134` gives the description and no limit.

### `presence_penalty`
- **Label:** Presence penalty
- **Level:** message
- **What it is:** Presence penalty lowers a choice simply because the same text piece has appeared before.
- **What it's for:** It can encourage the answer to introduce different words and topics; 0 leaves it disabled.
- **Usual values:** 0 is the llama.cpp baseline; active values depend on the model and task.
- **Default in this build:** 0.00 (`common/common.h:242`) “`float   penalty_present    = 0.00f;  // 0.0 = disabled`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:136-137`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) supports 0 as the disabled baseline; `common/common.h:242` supports the build default; `tools/server/server-schema.cpp:136-137` gives the description and no limit.

### `dry_multiplier`
- **Label:** DRY repetition multiplier
- **Level:** message
- **What it is:** DRY, or Don’t Repeat Yourself, controls the strength of a penalty for extending repeated text sequences.
- **What it's for:** It targets longer repeated phrases, including repetitions that ordinary recent-word penalties may miss; 0 disables it.
- **Usual values:** No widely agreed value.
- **Default in this build:** 0.0 (`common/common.h:243`) “`float   dry_multiplier     = 0.0f;   // 0.0 = disabled;      DRY repetition penalty for tokens extending repetition:`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:139-140`).
- **Evidence:** [DRY sampler reference](https://github.com/oobabooga/text-generation-webui/pull/5677) supports the technique but not a universal multiplier; `common/common.h:243` supports the disabled default; `tools/server/server-schema.cpp:139-140` gives the description and no limit.

### `dry_base`
- **Label:** DRY base
- **Level:** message
- **What it is:** DRY base controls how quickly the DRY penalty grows as a repeated sequence gets longer.
- **What it's for:** A larger base makes long repetitions increasingly costly; values below 1 are replaced by the build’s default.
- **Usual values:** 1.75 is the llama.cpp baseline; no broader active value is established.
- **Default in this build:** 1.75 (`common/common.h:244`) “`float   dry_base           = 1.75f;  // 0.0 = disabled;      multiplier * base ^ (length of sequence before token - allowed length)`”
- **Range the server accepts:** not stated; values below 1.0 are replaced with the default (`tools/server/server-schema.cpp:142-147`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) documents 1.75 as the baseline; `common/common.h:244` supports the default; `tools/server/server-schema.cpp:142-147` gives the replacement behaviour and no numeric field limit.

### `dry_allowed_length`
- **Label:** DRY allowed length
- **Level:** message
- **What it is:** DRY allowed length is how long a repeated sequence may become before the DRY penalty starts.
- **What it's for:** Raising it tolerates longer repeated phrases; lowering it reacts sooner and can make wording less natural.
- **Usual values:** 2 is the llama.cpp baseline; task-specific tuning has no agreed standard.
- **Default in this build:** 2 (`common/common.h:245`) “`int32_t dry_allowed_length = 2;      // tokens extending repetitions beyond this receive penalty`”
- **Range the server accepts:** 0 to `INT32_MAX` (`tools/server/server-schema.cpp:149-151`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) documents 2 as the baseline; `common/common.h:245` supports the default; `tools/server/server-schema.cpp:149-151` gives the accepted range and description.

### `dry_penalty_last_n`
- **Label:** DRY lookback
- **Level:** message
- **What it is:** DRY lookback says how many recent text pieces DRY scans for repeated sequences.
- **What it's for:** A larger lookback can catch older repetitions but costs more attention to history; 0 disables DRY’s penalty.
- **Usual values:** 64 is the llama.cpp baseline; 0 disables the penalty.
- **Default in this build:** 64 (`common/common.h:246`) “`int32_t dry_penalty_last_n = 64;     // how many tokens to scan for repetitions (0 = disable penalty)`”
- **Range the server accepts:** 0 to `INT32_MAX` (`tools/server/server-schema.cpp:153-155`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) documents 64 as the baseline and 0 as disabled; `common/common.h:246` supports the default; `tools/server/server-schema.cpp:153-155` gives the accepted range and description.

### `mirostat`
- **Label:** Mirostat mode
- **Level:** message
- **What it is:** Mirostat adjusts its choices while writing to keep the answer near a chosen level of surprise.
- **What it's for:** It can balance predictable and varied writing over time; 0 disables it, while 1 and 2 select its two versions.
- **Usual values:** 0 is the baseline; there is no agreed enabled choice for every model.
- **Default in this build:** 0 (`common/common.h:249`) “`int32_t mirostat           = 0;      // 0 = disabled, 1 = mirostat, 2 = mirostat 2.0`”
- **Range the server accepts:** 0 to 2 (`tools/server/server-schema.cpp:157-159`).
- **Evidence:** [Mirostat paper](https://arxiv.org/abs/2007.14966) supports the method and its target-perplexity idea; [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) documents 0, 1, and 2; `common/common.h:249` supports the default; `tools/server/server-schema.cpp:157-159` gives the range and description.

### `mirostat_tau`
- **Label:** Mirostat target
- **Level:** message
- **What it is:** Mirostat target is the desired average surprise of the model’s choices, measured by how unexpected they are.
- **What it's for:** Higher values aim for more surprising, varied answers; lower values aim for more predictable answers.
- **Usual values:** 5.0 is the llama.cpp baseline; there is no universal target across models.
- **Default in this build:** 5.00 (`common/common.h:251`) “`float   mirostat_tau       = 5.00f;  // target entropy`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:161-162`).
- **Evidence:** [Mirostat paper](https://arxiv.org/abs/2007.14966) supports tau as the target surprise; [llama.cpp Mirostat documentation](https://github.com/yuewucl/ggml-org_llama.cpp/blob/master/examples/main/README.md) documents 5.0 as its baseline; `common/common.h:251` supports the build default; `tools/server/server-schema.cpp:161-162` gives the description and no limit.

### `mirostat_eta`
- **Label:** Mirostat learning rate
- **Level:** message
- **What it is:** Mirostat learning rate controls how quickly Mirostat reacts when its recent surprise differs from the target.
- **What it's for:** Higher values react faster and can vary more; lower values react more gently and can take longer to settle.
- **Usual values:** 0.1 is the llama.cpp baseline; there is no universal rate across models.
- **Default in this build:** 0.10 (`common/common.h:252`) “`float   mirostat_eta       = 0.10f;  // learning rate`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:164-165`).
- **Evidence:** [Mirostat paper](https://arxiv.org/abs/2007.14966) supports eta as the update rate; [llama.cpp Mirostat documentation](https://github.com/yuewucl/ggml-org_llama.cpp/blob/master/examples/main/README.md) documents 0.1 as its baseline; `common/common.h:252` supports the build default; `tools/server/server-schema.cpp:164-165` gives the description and no limit.

### `adaptive_target`
- **Label:** Adaptive target
- **Level:** message
- **What it is:** Adaptive target asks the sampler to favour choices near a chosen probability, adapting that target as the answer continues.
- **What it's for:** It is intended to balance variety and predictability over time; negative values disable adaptive sampling.
- **Usual values:** No widely agreed value.
- **Default in this build:** -1.0 (`common/common.h:247`) “`float   adaptive_target    = -1.0f;  // select tokens near this probability (valid range 0.0 to 1.0; negative = disabled)`”
- **Range the server accepts:** `-FLT_MAX` to 1.0 (`tools/server/server-schema.cpp:167-169`); active targets are 0.0 to 1.0 and negative disables it.
- **Evidence:** [adaptive-p PR](https://github.com/ggml-org/llama.cpp/pull/17927) is the sampler’s introduction; `common/common.h:247` supports the default and active range; `tools/server/server-schema.cpp:167-169` gives the accepted limit and description. This is recent enough that no established practice exists yet.

### `adaptive_decay`
- **Label:** Adaptive decay
- **Level:** message
- **What it is:** Adaptive decay controls how much recent choices outweigh older choices when adaptive sampling updates its target.
- **What it's for:** Higher values remember more history and change gently; lower values respond more quickly to the latest choices.
- **Usual values:** No widely agreed value.
- **Default in this build:** 0.90 (`common/common.h:248`) “`float   adaptive_decay     = 0.90f;  // EMA decay for adaptation; history ≈ 1/(1-decay) tokens (0.0 - 0.99)`”
- **Range the server accepts:** 0.0 to 0.99 (`tools/server/server-schema.cpp:171-173`).
- **Evidence:** [adaptive-p PR](https://github.com/ggml-org/llama.cpp/pull/17927) introduces the recent sampler but establishes no common decay practice; `common/common.h:248` supports the default and meaning; `tools/server/server-schema.cpp:171-173` gives the accepted range and description.

### `min_keep`
- **Label:** Minimum kept choices
- **Level:** message
- **What it is:** Minimum kept choices prevents the other samplers from reducing the possible next choices below this number.
- **What it's for:** It provides a safety floor when several filters are combined; 0 lets each sampler decide freely.
- **Usual values:** 0 is the baseline; active values are normally chosen only for a specific sampler setup.
- **Default in this build:** 0 (`common/common.h:229`) “`int32_t min_keep           = 0;      // 0 = disabled, otherwise samplers should return at least min_keep tokens`”
- **Range the server accepts:** 0 to `INT32_MAX` (`tools/server/server-schema.cpp:183-185`).
- **Evidence:** [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) documents `min_keep` default 0 and its purpose; `common/common.h:229` supports the disabled default; `tools/server/server-schema.cpp:183-185` gives the accepted range and description.

### `seed`
- **Label:** Random seed
- **Level:** message
- **What it is:** The random seed starts the choices used when more than one answer is possible.
- **What it's for:** A fixed seed can repeat a run with the same inputs; the random setting avoids making every run follow the same choices.
- **Usual values:** Random is usual; use a fixed integer when you need repeatable tests.
- **Default in this build:** automatic random seed (`common/common.h:225`) “`uint32_t seed = LLAMA_DEFAULT_SEED; // the seed used to initialize llama_sampler`”
- **Range the server accepts:** not stated (`tools/server/server-schema.cpp:175-177`).
- **Evidence:** [llama.cpp CLI README](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md) documents -1 as random; `include/llama.h:37` defines `LLAMA_DEFAULT_SEED` as `0xFFFFFFFF`; `common/common.h:225` supports the build default; `tools/server/server-schema.cpp:175-177` describes -1 as random and states no limit.

### `max_tokens`
- **Label:** Maximum new tokens
- **Level:** message
- **What it is:** This is the maximum amount of new text the assistant may produce for one message.
- **What it's for:** A smaller limit ends long replies sooner; leaving it automatic lets the server's output length remain unlimited.
- **Usual values:** No widely agreed value.
- **Default in this build:** -1 (`common/common.h:449`) “`int32_t n_predict             =    -1; // max. number of new tokens to predict, -1 == no limit`”
- **Range the server accepts:** -1 to `INT32_MAX` (`tools/server/server-schema.cpp:44-48`); `max_tokens` is an alias for `n_predict`.
- **Evidence:** [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) documents -1 as no limit; `common/common.h:449` supports the build default; `tools/server/server-schema.cpp:44-48` gives the range, description, and alias.

### `context_size`
- **Label:** Context size
- **Level:** start
- **What it is:** Context size is how much of the conversation the model can hold while answering.
- **What it's for:** A larger context can keep more earlier conversation available but uses more memory; this app calculates the safe automatic value for the chosen model and computer.
- **Usual values:** Automatic is usual here: the app funds the largest safe value for this model and computer.
- **Default in this build:** automatic, the computed maximum (`crates/kalsa-launch/src/policy.rs:49-52`) “`None => maximum_context,`”
- **Range the server accepts:** not stated in `server-schema.cpp`; this app accepts a positive whole value no larger than its computed maximum (`crates/kalsa-launch/src/policy.rs:49-52`).
- **Evidence:** `crates/kalsa-launch/src/policy.rs:28-30` says a lower owner value is allowed and larger requests are rejected; `crates/kalsa-launch/src/policy.rs:47-52` supports the automatic maximum and accepted app range; `crates/kalsa-launch/src/argv.rs:36-37` shows it becomes `--ctx-size`.

### `batch_size`
- **Label:** Batch size
- **Level:** start
- **What it is:** Batch size is how many prompt pieces the server groups into one logical processing job.
- **What it's for:** Larger batches can process the prompt faster but need more working memory; this setting affects start-up processing, not the assistant’s wording.
- **Usual values:** 2048 here; the shipped run reached 1883 tokens/s versus 1151 at the old 512.
- **Default in this build:** 2048 (`crates/kalsa-launch/src/args.rs:16`) “`pub(crate) const BATCH: u32 = 2048;`”
- **Range the server accepts:** not stated in `server-schema.cpp`; this app accepts 64 to 8192 (`crates/kalsa-launch/src/args.rs:26-36`).
- **Evidence:** `crates/kalsa-launch/src/args.rs:11-16` supports the b10950 default and the 1151-to-1883 measurement; `crates/kalsa-launch/src/args.rs:26-36` supports the app range; `crates/kalsa-launch/src/argv.rs:31-34` shows the start argument.

### `ubatch_size`
- **Label:** Micro-batch size
- **Level:** start
- **What it is:** Micro-batch size is how many prompt pieces the server handles in one physical memory step.
- **What it's for:** Larger steps can improve prompt speed but use more compute-buffer memory; this computer’s measured budget limits the useful setting.
- **Usual values:** 512 default; 1024 fits at 346.6–414.0 MiB at 16k; 2048 costs 602.7 MiB at 4096.
- **Default in this build:** 512 (`crates/kalsa-launch/src/args.rs:24`) “`pub(crate) const UBATCH: u32 = 512;`”
- **Range the server accepts:** not stated in `server-schema.cpp`; this app accepts 64 to 1024 (`crates/kalsa-launch/src/args.rs:38-50`).
- **Evidence:** `docs/COMPUTE-BUFFERS-DENSE.md:417-423` supports the measured 1024 ceiling and the 346.6–414.0, 602.7, and 561.35 MiB figures; `crates/kalsa-launch/src/args.rs:18-24` supports the default; `crates/kalsa-launch/src/args.rs:38-50` supports the app range; `crates/kalsa-launch/src/argv.rs:34-35` shows the start argument.

### `cache_type`
- **Label:** KV cache type
- **Level:** start
- **What it is:** KV cache type chooses the precision used to remember earlier conversation inside the model.
- **What it's for:** q8_0 uses less memory but can lose a little cache precision; f16 keeps more precision but costs twice per cache element and roughly halves this computer’s funded context.
- **Usual values:** q8_0 is usual here; choose f16 when preserving cache precision matters more than context length.
- **Default in this build:** q8_0 (`crates/kalsa-launch/src/args.rs:98-101`) “`#[default]`” and “`Q8_0,`”
- **Range the server accepts:** not stated in `server-schema.cpp`; this app offers `q8_0` or `f16` (`crates/kalsa-launch/src/args.rs:96-105`).
- **Evidence:** `crates/kalsa-launch/src/args.rs:78-95` supports one versus two bytes per element, the memory trade, and q8_0 as default; `crates/kalsa-launch/src/args.rs:96-113` supports the two app choices and flag spelling; `crates/kalsa-launch/src/argv.rs:50-61` shows both start arguments; `crates/kalsa-launch/src/policy.rs:122-126` supports the context-halving arithmetic.

### `sleep_idle_seconds`
- **Label:** Unload after idle
- **Level:** start
- **What it is:** This is how long the unused model and its conversation cache stay loaded before the server releases them.
- **What it's for:** A shorter time frees memory sooner but reloads more often; a longer time keeps the next message ready but retains memory while idle.
- **Usual values:** 300 seconds is the app default; the panel allows 60 to 3600 seconds.
- **Default in this build:** 300 (`crates/kalsa-launch/src/args.rs:70`) “`pub const DEFAULT_IDLE_UNLOAD_SECONDS: u32 = 300;`”
- **Range the server accepts:** not stated in `server-schema.cpp`; this app accepts 60 to 3600 seconds (`crates/kalsa-launch/src/args.rs:72-76`).
- **Evidence:** `crates/kalsa-launch/src/args.rs:59-76` supports what is unloaded, the 300-second default, and the 60-to-3600 app range; `crates/kalsa-launch/src/argv.rs:63-66` shows `--sleep-idle-seconds`; `chat/src/components/AdvancedPanel.tsx:166-170` supports the panel wording.

### `internet_road`
- **Label:** Internet road
- **Level:** start
- **What it is:** Internet road is this app’s optional iroh connection that gives the phone a second way to reach the computer.
- **What it's for:** Turn it on only when the phone cannot use the other road; it announces the computer on a public directory service, while the door still checks its password.
- **Usual values:** Off, unless the phone cannot reach the computer another way.
- **Default in this build:** off (`chat/src/components/AdvancedPanel.tsx:190`) “`<p className="advanced-help">Opens a second way in over the internet: this computer announces itself on a public directory service, so the phone can find it without Tailscale. The door stays password-checked. Off is the default.</p>`”
- **Range the server accepts:** not a llama-server field; this app accepts on or off (`chat/src/components/AdvancedPanel.tsx:173-187`).
- **Evidence:** `src-tauri/src/road.rs:1-8` identifies iroh as the second road and says it is additive; `src-tauri/src/road.rs:38-45` supports the off/Tailscale wording and public node identity; `src-tauri/src/road.rs:80-85` shows the production public relay choice; `chat/src/components/AdvancedPanel.tsx:173-190` supports the switch, public directory announcement, password check, and off default.
