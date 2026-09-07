# GPU prefill divergence on Adreno 750

> **Status 7/09 (orchestrator) — RISOLTA LA CAUSA, e l'ipotesi che apriva questo documento è SUPERATA.**
> Questo documento nasceva con l'ipotesi "miscompile E031/A7X nel GEMM denso f16/bf16×f32, probabilmente
> `kernel_mul_mm_f16_f32_l4_lm`". Non è quella la causa della divergenza che abbiamo misurato sul modello spedito.
> Due celle con strumento di serie (`llama-perplexity --kl-divergence`) l'hanno isolata sul percorso Q4_0 dell'Adreno:
> **la moltiplicazione dentro `gemm_noshuffle_q4_0_f32.cl` è eseguita in half.** Numeri, su QRD8650/Adreno 750,
> modello `LFM2.5-2.6B-QAD-Q4_0` (quello che spediamo):
>
> | configurazione | Median KLD | Same top p |
> |---|---|---|
> | stock (prodotto f16) | 0,453822 | 62,823 % |
> | senza i flag `-cl-fast-relaxed-math` &c. | **identico alla sesta cifra** | **identico** |
> | accumulatori `float8`, prodotto ancora f16 | 0,460999 | 61,417 % |
> | **prodotto in float** (`convert_float8(B) * (float)w`) | **0,004736** | **94,826 %** |
> | dequantizzazione anche in float | 0,004793 | 94,488 % |
>
> Refutati **per misura**, non per ragionamento: l'attenzione (`-fa off` su entrambi i bracci non cambia nulla,
> ALIVE 56), i flag del compilatore, l'accumulatore f16, la dequantizzazione. Refutata anche l'analogia con i due
> precedenti upstream su cui ci si sarebbe basati per il fix "ovvio" — WebGPU #25748 e Vulkan #18969 indicano
> l'accumulatore, e su Adreno l'accumulatore non serve.
>
> **Il fix**: in `gemm_noshuffle_q4_0_f32.cl`, accumulatori `float8` e le 16 righe di accumulo che diventano
> `c0 += convert_float8(B) * (float)dequantized_weights.s0;`. Operandi ancora a 16 bit in memoria.
> **Costo**: `pp512` 189,73 contro 289,98 t/s di riferimento = 0,654× — **numero indicativo**, preso su un board che
> si scaldava; la misura pulita (cooldown + ordine randomizzato + temperatura per passo) è la prossima consegna.
>
> **Residuo aperto**: 0,004736 contro lo 0,000962 del percorso GEMV in batch 1 — un fattore ~5 — e il same-top
> 94,826 % che resta 0,174 punti sotto il 95 % del riferimento pubblicato. Il candidato è localizzato:
> le attivazioni arrivano in f32 (`ggml-opencl.cpp:17164` `CL_FLOAT`) e il kernel di trasposizione le **restringe
> deliberatamente** a f16 (`transpose.cl:113` `// converts to FP16`, `:127` `read_imageh`, `:139` `write_imageh`);
> il percorso batch-1, che misura pulito, non traspone affatto. Cella `adreno-operand-b`, PREREG scritto.
>
> **Cosa NON è superato di questo documento**: il difetto upstream del MUL_MAT denso f16/bf16 batched (20 fail in
> `test-backend-ops`) resta un problema noto e separato — non l'abbiamo testato qui, e le nostre misure sono sul
> percorso Q4_0, non su quello f16 denso. Le due cose non vanno confuse.
> Fonti: `scratchpad/agents/adreno-precision-bisect/` (ALIVE 56), `scratchpad/agents/adreno-acc-type/` (ALIVE 57),
> `scratchpad/agents/adreno-operand-b/PREREG.md`.

> **Status 6/09 06:15 (orchestrator):** the device test pre-registered as S5 run 6 (QRD8750 / Adreno 830, same APK 0265333) gave oracle PASS on all GPU-prefilled turns, while runs 3-5 on QRD8650 / Adreno 750 failed deterministically and a CPU-routed turn on the 750 passed. The divergence is therefore confined to the Adreno 750 GPU prefill path, consistent with the f16/bf16-batched MUL_MAT defect below (ALIVE #38/#39). Experiment #1 remains the kernel-level confirmation; the product decision for V75 is a CPU-prefill route (or GGML_OPENCL_OPFILTER containment) until the driver/compiler defect is fixed or worked around in the fork.


Date: 2026-09-06. Investigation only; no app, fork, or kernel changes.

## Finding

The top hypothesis is an E031/A7X miscompile in the batched dense F16/BF16 x F32
GEMM used by GPU prefill, probably `kernel_mul_mm_f16_f32_l4_lm`. This is a
strong hypothesis, not a proof: CPU-routed prefill is token-identical, while
GPU-routed prefill is deterministic but differs at token 14.

`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_A_t1_ids.txt:14` is `20`;
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_B_t1_ids.txt:14` is
`5439`; `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_B_t3_ids.txt:14` is `20`. B1/B2 report GPU prefill and
`KALSA_GOVERNOR ... "prefill_chunks":"2+13"`; B3 reports CPU prefill.

The telemetry is consistent with that split: A has `promptMs:44925.62` and
GPU B1 has `promptMs:452.87`, while B1 prewarm separately reports
`promptMs:5355.202` (`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_A_t1_logcat_all.txt:5066`,
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_B_t1_logcat_all.txt:2870,5385,5388`). The raw capture contains no
exact prompt text or tokenized prompt artifact, so it cannot isolate the
1024-token prewarm from the 15-token tail without another capture.

## Prior art

The earlier 750 campaign says: `/Users/marco/Projects/kalsa-moe-experiments/docs/ALIVE.md:356-361 "dense MUL_MAT 905/925 — 20
deterministic FAILs, all f16/bf16×f32 batched with nr≠[1,1] ... every nr=[1,1]
and f32×f32 case passes. Not our kernels: upstream f16 batched."`

Its exact shape is `/Users/marco/Projects/kalsa-moe-experiments/docs/ALIVE.md:435 "f16|bf16 × f32, m=128 n=1 k=1056 k_v=2112"`;
`/Users/marco/Projects/kalsa-moe-experiments/PLAN-archive.md:8865-8872` records that every tested `bs` with `nr≠[1,1]`
failed, while `nr=[1,1]` passed. `/Users/marco/Projects/kalsallama-wt-governor-v03/tests/test-backend-ops.cpp:8834-8835` still
generates these two dense families, including `m=128,n=1,k=1056,k_v=2112`.

The same prior art reports `MUL_MAT_ID 407/407` clean on the 750
(`/Users/marco/Projects/kalsa-moe-experiments/docs/ALIVE.md:351-353`); the observed issue is therefore not the known MoE
`MUL_MAT_ID` surface.

The fork has no dedicated 750 dense-batched correctness fix. It classifies
730/740/750 as `A7X` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:274-294`) and has an A7X Flash-Attention
compile carve-out, but no dense F16/BF16 result gate. Its trans4-only repair
hooks are `GGML_OPENCL_CVT_OPTS` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:1704-1716`) and
`GGML_OPENCL_CVT_VARIANT=bitselect` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:1719-1733`); they do not
cover dense F16/BF16 GEMM. `GGML_OPENCL_OPFILTER` can contain an op on CPU
(`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:7487-7489`), and `GGML_OPENCL_ADRENO_XMEM_GEMM` enables an
alternate F16xF32 GEMM (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:6093-6096`), but neither is a known
750 fix. No `kalsakernel` literal or 750-specific dense workaround is present
in the fork OpenCL tree.

## What the GPU path can execute

For F32 activations and a batched right-hand side, the host chooses local-memory
GEMM when `ne11 > 1` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:19526-19531`). For F16 weights it first
tries opt-in xmem, then selects `kernel_mul_mm_f16_f32_l4_lm`
(`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:19599-19607`). This is the primary static match for prompt
batches 512/128/13/2; the exact model shapes still need dispatch logging.

For a one-token right-hand side, the host selects `kernel_mul_mat_f16_f32_1row`
or the Adreno lane/multi-output variants, eventually the generic
`kernel_mul_mat_f16_f32` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:20242-20309`). Thus decode does not
exercise the same batched GEMM route.

The graph can also dispatch SSM convolution and GDN directly
(`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:25827-25839`); SSM chooses its scalar or `_4` kernel based on
`ne10 % 4` (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:13393-13415`). Flash attention is separately
dispatched (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:25934-25939`). DK=512 attention is explicitly
decode-only on Adreno and sends prefill to CPU (`/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:15518-15522`);
the A7X mixed/quantized compile carve-out is at `/Users/marco/Projects/kalsallama-wt-governor-v03/ggml/src/ggml-opencl/ggml-opencl.cpp:7803-7816`.
The app log says `flash_attn=auto`, but it does not log every selected kernel;
the exact prefill surface is therefore unresolved until the dispatch logger is
enabled.

## App provenance

The app source-build plugin applies the native overlay by default
(`/Users/marco/Projects/kalsa-wt-governor/plugins/withLlamaFromSource.js:13-20`). Its CMake says the OpenCL list is
derived from the kalsallama overlay (`/Users/marco/Projects/kalsa-wt-governor/node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt:251-256`), embeds the fork `.cl` files
(`/Users/marco/Projects/kalsa-wt-governor/node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt:415-427`), compiles the fork `ggml-opencl.cpp` (`/Users/marco/Projects/kalsa-wt-governor/node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt:447-451`), and enables
`LM_GGML_OPENCL_USE_ADRENO_KERNELS`, `LM_GGML_OPENCL_EMBED_KERNELS`, SOA-Q,
and OpenCL 3.0 (`/Users/marco/Projects/kalsa-wt-governor/node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt:453-458`). The fork and app kernel directories are bytewise
equal; the app C++ is the required `LM_GGML_`-prefixed overlay. B1 confirms
the runtime flag: `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_B_t1_logcat_all.txt:2364 "using kernels optimized
for Adreno (LM_GGML_OPENCL_USE_ADRENO_KERNELS)"`; it reports compiler
`E031.45.02.06` at `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_B_t1_logcat_all.txt:2348`. The QDC fork kit uses source kernels, with
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS=OFF` (`/Users/marco/kalsa-qdc/bin-gov-5c3979438-stripped/BUILD_NOTE.txt`).

## QDC kit and decisive experiment (numbered plan, 15 lines)

1. Available fork kits: `/Users/marco/kalsa-qdc/bin-gov-21d6ecc7d-stripped`, `bin-gov-5c3979438-stripped`, `bin-gov-ocl-stripped`, and `bin-governor-1bb3c24a0-ocl`; each contains `test-backend-ops`; the first, second, and fourth also contain `llama-cli`.
2. Use `/Users/marco/kalsa-qdc/bin-gov-5c3979438-stripped` first; it is an Android arm64 fork kit with embedded source kernels and `libomp.so`.
3. `adb shell 'rm -rf /data/local/tmp/kalsa-gpu-div && mkdir /data/local/tmp/kalsa-gpu-div'`; expected: empty experiment directory.
4. `adb push /Users/marco/kalsa-qdc/bin-gov-5c3979438-stripped/test-backend-ops /data/local/tmp/kalsa-gpu-div/ && adb push /Users/marco/kalsa-qdc/bin-gov-5c3979438-stripped/llama-cli /data/local/tmp/kalsa-gpu-div/ && adb push /Users/marco/kalsa-qdc/bin-gov-5c3979438-stripped/libomp.so /data/local/tmp/kalsa-gpu-div/ && adb push /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf /data/local/tmp/kalsa-gpu-div/model.gguf`; expected: four pushes succeed.
5. `adb shell 'chmod 755 /data/local/tmp/kalsa-gpu-div/test-backend-ops /data/local/tmp/kalsa-gpu-div/llama-cli'`; expected: no error.
6. `adb shell 'cd /data/local/tmp/kalsa-gpu-div && LD_LIBRARY_PATH=. GGML_OPENCL_LOG_KERNELS=1 ./test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "type_a=(f16|bf16),type_b=f32,m=128,n=1,k=1056,.*nr=\\[4,1\\].*k_v=2112"'`; expected: the known 750 batched family fails, while CPU reference comparison identifies the mismatch.
7. The raw capture has no prompt artifact; export the exact tokenized S5 prompt to `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_prompt.txt` before the model runs.
8. `adb push /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD8650_prompt.txt /data/local/tmp/kalsa-gpu-div/s5.prompt.txt`; expected: exact app prompt available to both arms.
9. Run CPU control: `adb shell 'cd /data/local/tmp/kalsa-gpu-div && LD_LIBRARY_PATH=. GGML_OPENCL_LOG_KERNELS=1 ./llama-cli -m /data/local/tmp/kalsa-gpu-div/model.gguf -f /data/local/tmp/kalsa-gpu-div/s5.prompt.txt -b 512 -ub 512 -c 2048 -n 67 --temp 0 --seed 42 -ngl 0 -fa auto --no-display-prompt'`; expected: stable reference IDs.
10. Run GPU baseline with the same command and `-ngl 99`; expected: reproduce token 14 `5439` versus CPU `20`, and log the actual kernel names.
11. Repeat GPU with `GGML_OPENCL_ADRENO_XMEM_GEMM=1`; expected: a changed result plus `Adreno xmem F16xF32 GEMM enabled` separates local GEMM from the alternate path.
12. Repeat GPU baseline with `-fa off`; expected: if it passes, attention is implicated; if it still fails, retain GEMM as the leading suspect.
13. Create verified `s5-prefix-1024.txt` and `s5-full-1314-plus-15.txt`; `--verbose-prompt` must report the intended token counts and the second file must share exactly the first 1024 tokens.
14. Warm-split run: evaluate the prefix with `--prompt-cache /data/local/tmp/kalsa-gpu-div/s5-1024.session`, then run the full file with `--prompt-cache-ro` and `-n 67`; expected: prefix-only failure implicates prewarm, tail-only failure implicates the tail batch.
15. If prompt-cache cannot preserve the exact token boundary, build a fork-only probe with the Android recipe in `bin-gov-5c3979438-stripped/BUILD_NOTE.txt` and call `llama_decode` with explicit `{1024,15}` batches; no app glue or kernel edits are needed.

The next capture should add one line before each prefill: `KALSA_GPU_PREFILL
{"phase":"prewarm|tail","n_tokens":<n>,"batch":"<sizes>","kernel_log":true}`.
Combined with `GGML_OPENCL_LOG_KERNELS=1`, that settles whether the defect is
the large prewarm, the tail, or a non-GEMM graph op.
