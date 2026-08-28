# Ricognizione LiteRT / LiteRT-LM / ML Drift

Snapshot verificato: 2026-08-28. Scope: riuso nel fork MIT di llama.cpp per Android/Adreno/Hexagon. Il paper ML Drift è [CC BY 4.0](https://arxiv.org/html/2505.00232); il codice va valutato separatamente.

## COPIABILE

### LiteRT-LM

- **Licenza:** repository e codice sono Apache License 2.0; per un fork MIT è riusabile mantenendo copyright, `LICENSE`/`NOTICE` e indicando le modifiche. [LICENSE](https://github.com/google-ai-edge/LiteRT-LM/blob/main/LICENSE) · [repository](https://github.com/google-ai-edge/LiteRT-LM).
- **Executor NPU specializzato:** codice Apache utile come riferimento/copertura da portare: [`llm_litert_npu_compiled_model_executor.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_npu_compiled_model_executor.cc), [`llm_litert_npu_kv_cache.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/npu/llm_litert_npu_kv_cache.cc), [`llm_litert_npu_compiled_model_executor_utils.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/npu/llm_litert_npu_compiled_model_executor_utils.cc). Il pattern è: firme distinte prefill/decode, buffer KV persistenti, output KV a slice e fase esplicita di cache-update.
- **Loader/container:** [`litert_lm_loader.h`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/util/litert_lm_loader.h), [`litert_lm_loader.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/util/litert_lm_loader.cc), [`model_resources_litert_lm.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/components/model_resources_litert_lm.cc). Il formato `.litertlm` contiene sezioni `TFLiteModel`, `TFLiteWeights` e metadati; non è GGUF e non porta direttamente q2_K/q3_K.
- **Fallback/governor reference:** [`llm_litert_compiled_model_executor_factory.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_compiled_model_executor_factory.cc) manda il modello al path generico se manca `TF_LITE_AUX`; [`llm_executor_settings_utils.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_executor_settings_utils.cc) configura `NPU | CPU`; [`llm_litert_compiled_model_executor.cc`](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_compiled_model_executor.cc) gestisce il fallback host nel path generico.

### Cosa esiste davvero nel path Qualcomm AI Engine Direct

- La guida ufficiale richiede un modello `.litertlm` per SoC, QAIRT scaricato separatamente, `dispatch_api_so` compilata e le librerie `libQnnHtp*.so`/Skel/Stub sul device; il comando esegue `litert_lm_main --backend=npu`. [Guida Qualcomm LiteRT-LM](https://developers.google.cn/edge/litert/next/litert_lm_npu).
- La partizione non è magia runtime: il [Compiler Plugin](https://developers.google.cn/edge/litert/next/compiler_plugin) seleziona gli op supportati, LiteRT raggruppa isole connesse e le sostituisce con custom dispatch op; il Qualcomm plugin converte/valida ogni op contro QNN in [`qnn_compiler_plugin.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/compiler/qnn_compiler_plugin.cc) e compila un context binary per partizione.
- Il dispatch poi carica il context binary/JIT handle, attacca input/output a buffer QNN e chiama `graphExecute`: [`dispatch_api.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/dispatch/dispatch_api.cc), [`litert_dispatch_invocation_context.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/dispatch/litert_dispatch_invocation_context.cc). AOT, JIT on-device e cache dei risultati sono descritti nelle [istruzioni HTP](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/doc/HTP_INSTRUCTIONS.md).
- Nel path NPU Gemma3 il KV cache è **logicamente** in input buffer persistenti LiteRT condivisi tra prefill/decode; il decoder produce slice K/V che una fase cache-update scrive nel buffer completo. Il codice non impone `AHardwareBuffer` per questi buffer: la memoria fisica è scelta dall’allocator/backend. [Allocazione KV e slice](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_npu_compiled_model_executor.cc).
- Prefill accetta batch 1 e, per prompt più lunghi, spezza l’input in work-group/signature precompilate (`GetOptimizedPrefillWorkGroups`); non è batching multi-sequence. Decode è una firma separata, tipicamente un token alla volta. [Prefill](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_npu_compiled_model_executor.cc).
- I modelli Qualcomm pubblicati sono **4-bit per-channel**, con context 1280 per questa variante, non q2_K/q3_K a blocchi GGUF. [Tabella modelli Qualcomm](https://developers.google.cn/edge/litert/next/litert_lm_npu).

### LiteRT core: codice riusabile

- **Graph partitioning:** [`litert/compiler/plugin/compiler_plugin.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/compiler/plugin/compiler_plugin.cc) implementa `Partition`, raggruppamento delle isole (`GroupPartitions/V2`) e `OutlinePartition`; [`litert/runtime/compiled_model.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/compiled_model.cc) applica plugin/delegate in ordine e conserva i nodi non delegati per CPU/GPU. Licenza del repository: [Apache 2.0](https://github.com/google-ai-edge/LiteRT/blob/main/LICENSE).
- **Dispatch generico:** [`dispatch_delegate.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/dispatch/dispatch_delegate.cc), [`dispatch_delegate_kernel.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/dispatch/dispatch_delegate_kernel.cc), [`dispatch_kernel_facade.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/dispatch/dispatch_kernel_facade.cc). Sono il riferimento per trasformare ogni partizione in un invocation context e per fare attach/detach dei buffer.
- **Zero-copy buffer API:** [`runtime/tensor_buffer.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/tensor_buffer.cc), [`runtime/tensor_buffer.h`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/tensor_buffer.h), [`runtime/ahwb_buffer.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/ahwb_buffer.cc), [`c/litert_tensor_buffer.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/c/litert_tensor_buffer.cc). Le API espongono `CreateFromAhwb`/`GetAhwbBuffer` e buffer OpenCL separati; codice Apache.
- **Caveat Qualcomm importante:** la documentazione generica mostra `CreateFromAhwb`, ma il Qualcomm dispatch attuale accetta per la memoria QNN FastRPC/ION o DMA-BUF e rifiuta altri tipi; per il backend GPU QNN importa DMA-BUF come memoria OpenCL. Non assumere quindi che AHWB sia zero-copy sul Qualcomm path senza una prova sul device. [`litert_dispatch_device_context.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/dispatch/litert_dispatch_device_context.cc) · [esempio AHWB generico](https://developers.google.com/edge/litert/next/npu?authuser=4#zero-copy_with_npu_acceleration).

### ML Drift / GPU

- Nell’attuale LiteRT pubblico sono presenti wrapper e target Apache per OpenCL/WebGPU: [`ml_drift_delegate`](https://github.com/google-ai-edge/LiteRT/tree/main/ml_drift_delegate), [`gpu/BUILD`](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/accelerators/gpu/BUILD), ad esempio `ml_drift_cl_accelerator.cc` e `ml_drift_webgpu_accelerator.cc`. Il commit pubblico del 30 luglio 2026 documenta il fix dei build open-source OpenCL/WebGPU. [Commit](https://chromium.googlesource.com/external/github.com/google-ai-edge/LiteRT/%2B/202b35ba217cbe8b41919924103d5d3dba5497c0).
- Copiabile, previa verifica delle dipendenze: adapter/registration, gestione buffer, cache e plumbing del delegate nei file sopra. Il backend non è però un drop-in autonomo: usa l’archivio esterno `@ml_drift` e gli header `ml_drift/...`; il [WORKSPACE](https://github.com/google-ai-edge/LiteRT/blob/main/WORKSPACE) non dà una sorgente pubblica self-contained da incorporare nel fork.

## DA REIMPLEMENTARE

### 1. Kernel OpenCL q2_K/q3_K: cinque idee concrete dal paper

1. **Packing per slice e riordino dei pesi.** ML Drift usa slice contigue da 4 lane, padding a multipli di 4 e riordina i pesi da `OHWI/OHWDI` verso permutazioni di `(G,S_O,O_4,HWD,S_I,I_4)`; riporta fino al 20% sulla matmul rispetto al layout naive. Per q2_K/q3_K: prepara offline payload quantizzato e scale/min in unità coerenti con output-slice/input-slice, così ogni work-item riusa i metadata di blocco invece di rileggere scale sparse. **Fonte:** §3.1, Fig. 1–2. [Paper](https://arxiv.org/html/2505.00232#S3.SS1).
2. **Tensor virtualization + coordinate translation.** Separare shape logica da buffer fisico (1D buffer, 2D/3D image, più oggetti) e generare gli indici nel codice kernel; la traduzione non deve costare nel loop caldo. Per noi: una descrizione comune del blocco q2/q3 e varianti Adreno con pesi interleaved, scale separate o packed. **Fonte:** §3.2–3.3, Fig. 2, Tab. 1. [Paper](https://arxiv.org/html/2505.00232#S3.SS2).
3. **Specializzazione per device e scelta tra candidati.** Il paper seleziona a init il GPU object/kernel migliore in base alle proprietà rilevate e cita estensioni vendor come `cl_arm_matrix_multiply`; per Adreno: tabella di profili per GPU/driver, varianti di vector width e path estensioni, con micro-benchmark iniziale/cache. **Fonte:** §3.1 e §3.4. [Paper](https://arxiv.org/html/2505.00232#S3.SS4).
4. **Kernel distinti prefill/decode.** Prefill lungo: kernel compute/convolution-like e quantizzazione delle activation separata; decode memory-bound: quantizzazione activation fusa nel kernel FC per evitare round-trip. Per q2/q3: una matmul a tile grandi per prefill e una streaming/fused-dequant per decode, con soglia scelta da `sequence_length`. **Fonte:** §3.7. [Paper](https://arxiv.org/html/2505.00232#S3.SS7).
5. **Layout KV orientato all’operazione.** K è memorizzato come `OHWI` con `O=cache_size`, `I=d_h` per ottenere `K^T`; V in dimensioni invertite per produrre direttamente il layout dell’attention. Per noi: scegliere il layout K/V in funzione di QKᵀ e PV, evitando transpose kernel tra ogni token. **Fonte:** §3.8. [Paper](https://arxiv.org/html/2505.00232#S3.SS8).

Fusion di RoPE/QKV/layout e riuso dei buffer per lifetime non sovrapposte sono ulteriori pattern da reimplementare nel decoder; il paper li tratta in §3.5–3.6. [Paper](https://arxiv.org/html/2505.00232#S3.SS5).

### 2. Cosa non inventa il paper

- Non riporta un algoritmo `__local`/local-memory, dimensioni di workgroup, tile `(M,N,K)`, occupancy o register blocking per Adreno: le ricerche nel testo non trovano “local memory” né “workgroup”. Questi parametri vanno autotunati da noi; non attribuirli a ML Drift. [Testo completo](https://arxiv.org/html/2505.00232).
- Non riporta batching prefill multi-sequence su Adreno: il benchmark LLM usa context fisso 1280 = 1024 token prefill + 256 decode, non una ricetta di batching. [§4.2](https://arxiv.org/html/2505.00232#S4.SS2).
- Il paper usa q8 per-channel e mixed 8/4/4 per-channel, non i blocchi q2_K/q3_K; la mappatura delle scale e il tile ottimale sono quindi una nostra implementazione da validare numericamente. [Quantizzazioni ML Drift](https://arxiv.org/html/2505.00232#S4.SS2).

### 3. Governor CPU/GPU/NPU

- Reimplementare un governor per **fase**: tabella per SoC/driver con costo di launch, bandwidth, memoria condivisa e throughput separati per prefill/decode; selezione iniziale + hysteresis termica; fallback a CPU per op non supportati. LiteRT fornisce la struttura di partizionamento/fallback, non una migrazione dinamica cross-device per ogni fase. [Fallback/partial delegation](https://developers.google.com/edge/litert/next/npu?authuser=4) · [CompiledModel orchestration](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/compiled_model.cc).
- Copiare l’idea di pipeline del NPU executor: `RoPE → mask → decoder → cache update`, buffer persistenti e signature prefill/decode; nel nostro fork le firme diventano piani CPU/GPU/NPU e il KV owner va deciso dal governor per evitare copie. [Pipeline LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_npu_compiled_model_executor.cc).
- La selezione di op supportati deve restare compile-time/prepare-time, con isole connesse e fallback esplicito; non mettere la compilazione QNN nel token loop. [Plugin API](https://developers.google.cn/edge/litert/next/compiler_plugin).

## IGNORARE

- **Portare tutto ML Drift:** troppo accoppiato al proprio IR/runtime GPU e a `@ml_drift`; prendere i pattern sopra e mantenere il formato GGUF/q2_K/q3_K del fork. [GPU BUILD](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/accelerators/gpu/BUILD) · [WORKSPACE](https://github.com/google-ai-edge/LiteRT/blob/main/WORKSPACE).
- **`.litertlm`, TFLite e QNN come formato interno:** utili per capire metadata, firme e partizioni, ma divergono dal modello di pesi/blocchi di llama.cpp. [Loader LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/util/litert_lm_loader.h).
- **AHWB come assunzione universale:** l’API generica esiste, ma il Qualcomm dispatch richiede tipi di memoria diversi; mantenere backend-specific capability checks. [Qualcomm buffer registration](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/dispatch/litert_dispatch_device_context.cc).
- **MTP/PLE e modelli Gemma-specifici:** sono ottimizzazioni/protocolli del modello e dell’executor LiteRT-LM, non una base per kernel q2_K/q3_K generici. [NPU executor header](https://github.com/google-ai-edge/LiteRT-LM/blob/main/runtime/executor/llm_litert_npu_compiled_model_executor.h).
- **SDK/runtime Qualcomm:** `libQnnHtp.so`, `libQnnHtpPrepare.so`, `libQnnHtpVxxStub.so`, `libQnnHtpVxxSkel.so`, `libQnnSystem.so` e header QNN sono dipendenze QAIRT esterne; il BUILD LiteRT le importa da `@qairt`, non le rende Apache. [qairt.BUILD](https://github.com/google-ai-edge/LiteRT/blob/main/third_party/qairt/qairt.BUILD) · [guida distribuzione QAIRT](https://developers.google.cn/edge/litert/next/litert_lm_npu).

## NUMERI

### ML Drift — Qualcomm OpenCL

Unità: `prefill / decode` token/s. I device sono Adreno 830 = Xiaomi 15 Pro 16 GB, Adreno 750 = Samsung S24 8 GB, Adreno 740 = Samsung S23 Ultra 8 GB. Benchmark: 1024 prefill + 256 generation, context 1280, senza speculative decoding/flash attention, sync CPU/GPU a ogni token. [§4.2, Table 2](https://arxiv.org/html/2505.00232#S4.SS2).

| Modello / quantizzazione | Adreno 830 | Adreno 750 | Adreno 740 |
|---|---:|---:|---:|
| Llama 3.2 3B q8 | 960 / 17.1 | 917 / 17.5 | 720 / 15.4 |
| Llama 3.2 3B 8/4/4 | 983 / 30.4 | 959 / 30.3 | 741 / 26.8 |
| Gemma2 2B 8/4/4 | 1250 / 37.0 | 1370 / 37.1 | 1040 / 32.4 |
| Llama 3.1 8B 8/4/4 | 413 / 13.4 | 412 / 12.7 | 325 / 10.7 |

ML Drift dichiara 5–11× di speedup nel prefill su Adreno rispetto ad altre soluzioni open-source e +29% nel decode Llama 3.2 3B 8/4/4 rispetto al benchmark Qualcomm AI Hub; sono claim comparativi del paper, non risultati q2/q3. [§4.2](https://arxiv.org/html/2505.00232#S4.SS2).

### LiteRT-LM

- La pagina ufficiale aggiornata pubblica per **Gemma3-1B / Samsung S24 Ultra / GPU**: **1191 prefill / 24 decode token/s**. Il SoC non è indicato nella riga: conservarlo come dato Android GPU, non come datapoint Qualcomm certificato. [LiteRT-LM Overview](https://developers.google.com/edge/litert-lm/overview#supported_models).
- La pagina Qualcomm pubblica per Gemma3-1B q4 per-channel: **658 MB** su SM8750, **658 MB** su SM8650, **657 MB** su SM8550, context **1280**; non pubblica token/s NPU. [Tabella Qualcomm](https://developers.google.cn/edge/litert/next/litert_lm_npu).
- **NPU throughput:** non ho trovato un numero corrente, riproducibile e SoC-labeled in documentazione ufficiale LiteRT-LM/Qualcomm; non inserirlo nel bake-off finché non arriva un model card/release con versione, modello, prompt/context, thermal policy e conteggio token. [Overview ufficiale](https://developers.google.com/edge/litert-lm/overview) · [guida NPU](https://developers.google.cn/edge/litert/next/litert_lm_npu).

## Stato “chiuso” dei GPU accelerator

- La frase “GPU accelerator non open-source” è **time-scoped**: un issue di febbraio 2026 descriveva `libLiteRtGpuAccelerator.so` come prebuilt-only, ma il commit pubblico del 30 luglio 2026 aggiunge/fissa i build open-source OpenCL/WebGPU e i relativi wrapper Apache. [Issue storico](https://github.com/google-ai-edge/LiteRT/issues/5721) · [commit di apertura build](https://chromium.googlesource.com/external/github.com/google-ai-edge/LiteRT/%2B/202b35ba217cbe8b41919924103d5d3dba5497c0).
- **Binary-only per chi consuma i prebuilt:** `litert/prebuilt/*/libLiteRtWebGpuAccelerator.so`, `libLiteRtClGlAccelerator.so` e i corrispondenti file LiteRT-LM sono artefatti ELF senza sorgente nel file; non copiarli nel fork MIT come se fossero codice. [LiteRT prebuilt tree](https://github.com/google-ai-edge/LiteRT/tree/main/litert/prebuilt) · [LiteRT-LM prebuilt tree](https://github.com/google-ai-edge/LiteRT-LM/tree/main/prebuilt).
- **Non confondere wrapper e core:** i wrapper/target `ml_drift_*_accelerator.cc` hanno header Apache, ma il core arriva da `@ml_drift`; prima di copiare va verificata la licenza/sorgente dell’archivio effettivamente risolto dalla build. [Wrapper BUILD](https://github.com/google-ai-edge/LiteRT/blob/main/litert/runtime/accelerators/gpu/BUILD) · [WORKSPACE](https://github.com/google-ai-edge/LiteRT/blob/main/WORKSPACE).
- **Vendor-only:** QAIRT/QNN e Skel/Stub Hexagon restano componenti vendor separati; anche il repository LiteRT contiene termini separati per il Google Tensor SDK. In pratica: codice LiteRT/dispatch/adapter Apache sì; binari QAIRT, prebuilt accelerator e SDK vendor solo dopo audit della licenza/redistribuzione dell’artefatto. [QAIRT dipendenza](https://github.com/google-ai-edge/LiteRT/blob/main/third_party/qairt/qairt.BUILD) · [Google Tensor terms](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/google_tensor/compiler/TERMS_OF_USE.md).
