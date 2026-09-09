# G1 CPU smoke

Date: 2026-09-09

Prompt, exactly once per model:

~~~text
Spiega in tre frasi cosa fa un governor termico su un telefono.
~~~

Common settings:

- llama.cpp fork commit: 67c73d26cb4ce53d8f04b199b523bf05d18fbd61
- CPU-only build: GGML_METAL=OFF, GGML_BLAS=OFF
- n_ctx: 4096
- threads: 8; threads-batch: 8
- conversation mode: enabled; Jinja: enabled; template: taken from each GGUF
- thinking: enabled with --reasoning on
- reasoning display: deepseek-legacy, retaining the thought delimiters in the CLI transcript
- sampler: greedy, with temperature 0, top-k 0, top-p 1, min-p 0, seed 0
- generation cap: 256 tokens

Template/token evidence quoted from the inventory:

> tokenizer.chat_template contains '<|im_end|>'; token[124900] = '<|im_end|>'

> tokenizer.chat_template contains '<|im_end|>'; token[130073] = '<|im_end|>'

The first line is the LFM template/eos token; the second is the MiniCPM5
template turn delimiter. The exact full templates are in [inventory.md](/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/inventory.md).

## LFM2.5-2.6B-QAD-Q4_0.gguf

Exit: 0

Timing line from the raw CLI output:

~~~text
[ Prompt: 179.8 t/s | Generation: 56.6 t/s ]
~~~

Prefill: 179.8 tok/s (CLI label: Prompt). Decode: 56.6 tok/s (CLI label:
Generation).

The 256-token cap was reached inside reasoning, so the final answer is
truncated. Exact combined stdout/stderr is preserved in
[smoke-lfm.raw](/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/smoke-lfm.raw).

~~~text
[Start thinking]

*   Topic: What a thermal governor (thermal governor) does on a phone.
*   Constraint: Explain it in exactly three sentences.
*   Language: Italian.

    *   What is a thermal governor? It's a control mechanism that manages the CPU's clock speed based on temperature.
    *   How does it work? When the phone gets too hot, it slows down the CPU (throttling) to prevent overheating.
    *   Why? To protect hardware and maintain performance stability.

    *   *Sentence 1 (Definition/Function):* Un governor termico regola la velocità del processore in base alla temperatura del telefono. (A thermal governor regulates the processor speed based on the phone's temperature.)
    *   *Sentence 2 (Mechanism):* Quando la temperatura supera una certa soglia, il sistema rallenta il processore per evitare il surriscaldamento. (When the temperature exceeds a certain threshold, the system slows down the processor to avoid overheating.)
    *   *Sentence 3 (Purpose/Result):* Questo processo garantisce che il dispositivo rimanga stabile e protetto dal calore, mantenendo un funzionamento fluido. (This process ensures the
~~~

CLI delimiter observed: [Start thinking]; no closing delimiter appeared before
the generation cap.

## MiniCPM5-2B-Q4_K_M.gguf

Exit: 0

Timing line from the raw CLI output:

~~~text
[ Prompt: 259.1 t/s | Generation: 55.1 t/s ]
~~~

Prefill: 259.1 tok/s (CLI label: Prompt). Decode: 55.1 tok/s (CLI label:
Generation).

MiniCPM5 emitted a reasoning block. In the CLI transcript it is delimited by
[Start thinking] and [End thinking]; this is the readable
deepseek-legacy rendering of the model/template thinking tags. Exact combined
stdout/stderr is preserved in
[smoke-minicpm5.raw](/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/smoke-minicpm5.raw).

~~~text
[Start thinking]

We need to explain what a thermal governor does on a phone in three sentences. The user asked in Italian: "Spiega in tre frasi cosa fa un governor termico su un telefono." So we need to respond in Italian, in three sentences.

First, I need to make sure that I'm answering correctly. A thermal governor on a phone is likely a feature that manages the temperature of the phone's components, like the battery or processor, to prevent overheating. I need to explain that in three sentences.

Let's structure the answer:

1. First sentence: Introduce what a thermal governor is.
2. Second sentence: Explain its function.
3. Third sentence: Conclude or mention its importance.

I need to make sure that I keep it concise and clear.
[End thinking]

Un governor termico sul telefono regola la temperatura dei componenti per evitare il calore eccessivo. Funziona monitorando la temperatura e riducendo l'uso di energia quando è necessario. Questo aiuta a mantenere il telefono più affidabile e a prolungare la durata della batteria.
~~~

The MiniCPM5 block is emitted before the three-sentence answer and is fully
closed within the 256-token cap.
