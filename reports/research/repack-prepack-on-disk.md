# Report: pesi quantizzati PRE-PACCATI su disco (llama.cpp / ggml repack)

**Data ricerca:** 2026-08-07  
**Ambito:** solo ricerca web + fonti pubbliche. Nessuna esecuzione di codice, nessuna modifica a repository di progetto.  
**Obiettivo:** validare o smontare l’idea di conservare gli esperti MoE sul disco già nel layout *repacked* (tile interlacciato tipo `Q4_0_4x4` / `4x8` / `8x8`), così lo streaming da flash fa solo copia byte e il kernel ARM veloce non ripaccetta sul percorso critico.

---

## TL;DR — risultato principale (prima di tutto)

**Sì: l’idea è già stata fatta in llama.cpp, e poi è stata abbandonata.**

Tra metà 2024 e fine 2024 esistevano tipi GGUF **su disco** con layout pre-interlacciato:

| Nome tipo (file / quantize) | Ruolo |
|---|---|
| `Q4_0_4_4` | layout 4×4 (dotprod / NEON) |
| `Q4_0_4_8` | layout 4×8 (i8mm / mmla) |
| `Q4_0_8_8` | layout 8×8 (SVE / AVX) |

Furono **rimossi come tipi di file** a favore della **ri-paccatura a runtime** dentro un buffer type dedicato (`CPU_AARCH64` → poi `CPU_REPACK` / `ggml_backend_cpu_repack_buffer_type()`).

- **Introduzione kernel + layout offline:** PR [#5780](https://github.com/ggerganov/llama.cpp/pull/5780) (feb–lug 2024, team Arm: Dibakar Gope, David Mansell), evoluta in tipi quant “riarrangiati”.
- **Runtime repack (online flow):** PR [#9921](https://github.com/ggml-org/llama.cpp/pull/9921) (merged ~15 nov 2024).
- **Rimozione tipi file `Q4_0_N_M`:** PR [#10446](https://github.com/ggml-org/llama.cpp/pull/10446) (merged 7 dic 2024, commit `19d8762`). Messaggio di errore ufficiale:
  > `TYPE_Q4_0_4_4 REMOVED, use Q4_0 with runtime repacking`  
  (analoghi per `4_8` / `8_8`).

**Motivazione esplicita del maintainer (testuale)** — Djip007, PR #10446:

> *remove Q4_0_N_M from ggml file tensor type, only the cpu backend have know of this type and do dynamic repacking for it on "ggml_backend_cpu_aarch64_buffer_type" only.*

E sulla scelta architetturale (stessa PR):

> *yes it will be the main/difficult choice :*  
> *- Allow weight repacking only at load time, and reduce the interest of mmap...*  
> *- Allow to add new "bloc" type... and be prepare to have lot of new type (AVX512 will like bloc of 16xN, AVX512BF16 of 2x16xN, AVX2 of 8xN, RDNA3 of 16x16 ...)*

slaren (29 nov 2024, PR #9921), prima della rimozione:

> *For Q4_0, that's the goal. Support for Q4_0_X_X model files is likely to be removed in the future.*

slaren (10 dic 2024, dopo #10446):

> *Yes, support for Q4_0_N_M model files has been removed and cannot be made anymore.*

**Traduzioni:**

- «rimuovere Q4_0_N_M dai tipi tensore del file ggml; solo il backend CPU conosce questo tipo e fa repack dinamico solo su `ggml_backend_cpu_aarch64_buffer_type`.»
- «sì, sarà la scelta principale/difficile: (1) permettere il repack solo a load-time e ridurre l’interesse di mmap… (2) permettere di aggiungere nuovi tipi “blocco”… e prepararsi ad averne tantissimi (AVX512 vorrà blocchi 16×N, AVX512BF16 2×16×N, AVX2 8×N, RDNA3 16×16 …)»
- «Per Q4_0, quello è l’obiettivo. Il supporto ai file modello Q4_0_X_X sarà probabilmente rimosso in futuro.»
- «Sì, il supporto ai file modello Q4_0_N_M è stato rimosso e non possono più essere creati.»

Questa è la **ragione negativa istituzionale** che cercavamo: non “impossibile fisicamente”, ma **ecosistema, proliferazione di formati su disco, e nascondere il layout dietro il buffer type**.

---

## 1. Storia: pre-paccati su disco → runtime repack

### 1.1 Nascita (online rearrange → tipi offline)

PR [#5780](https://github.com/ggerganov/llama.cpp/pull/5780) (28 feb 2024): kernel GEMV (dotprod) / GEMM (i8mm/mmla) Arm. Prima versione riordinava i pesi **a load** (lento, memoria extra). Feedback maintainer:

**ggerganov** (6 mar 2024):

> *These changes are too intrusive - there a lot of new quantization structs introduced to the core library which would be difficult to maintain. The approach proposed earlier in the discussion for implementing a dedicated backend and moving the entire matrix multiplication code there should be considered instead*

**slaren** (7 mar 2024) propone tipi riarrangiati:

> *I think that could also work, you could add new data types for the rearranged Q4_0 and Q8_0, add the ability to quantize models to these data types, and add all the relevant functions for these data types in type_traits to support them.*

**ggerganov** conferma:

> *Yes, rearranged data types should work. This way the logic in ggml_compute_forward_mul_mat could be delegated outside of ggml - it will be based on the data types, which would be determined upon model creation, based on the tensor sizes.*

**Dibakar** (2 mag 2024) documenta il passaggio a offline:

> *We rearrange the weights offline while the code is quantized to Q4_0. As a result, when we run the inference later, the weight loading time is identical to loading a Q4_0 model file. … In comparison to Q4_0, using Q4_0_AARCH64 gguf format does not result in an additional memory overhead.*

I nomi pubblici finiti in GGUF/quantize furono `Q4_0_4_4`, `Q4_0_4_8`, `Q4_0_8_8` (documentati in issue Ollama [#6125](https://github.com/ollama/ollama/issues/6125), Kobold [#1117](https://github.com/LostRuins/koboldcpp/issues/1117), discussioni Snapdragon [#8273](https://github.com/ggml-org/llama.cpp/discussions/8273), [#8336](https://github.com/ggml-org/llama.cpp/discussions/8336)). Benchmark di epoca mostrano **stessa footprint** del Q4_0 (es. entrambi 4.33 GiB su Llama 3.1 8B in [#8336](https://github.com/ggml-org/llama.cpp/discussions/8336)).

### 1.2 Runtime repack + buffer type

PR [#9921](https://github.com/ggml-org/llama.cpp/pull/9921) (chaxu01 / Arm, co-authored slaren): repack **a load** da Q4_0 generico, layout scelto dalla CPU. Architettura voluta da slaren:

> *Generally, the way changes in tensor layout are intended to be implemented is through the ggml-backend buffer interface, it gives more control to the application over which tensors will be changed, it allows changes to the tensor size, and the conversion would be done at load time.*

E sul non cambiare il `ggml_type` visibile:

> *The goal of using a buffer type to handle the conversion is to hide it from the user. From what the user is concerned, the tensor type is Q4_0, and if they use the get_tensor function to read it back, they should get the tensor in the original Q4_0 format. If you change the tensor type, we are back to the same kind of problems of the original implementation. You can use tensor->extra to store other details about the tensor (eg. the actual converted type) in the init_tensor function of the buffer interface.*

### 1.3 Rimozione tipi file

PR [#10446](https://github.com/ggml-org/llama.cpp/pull/10446) (Djip007, merged 7 dic 2024):

- rimuove `Q4_0_N_M` / `IQ4_*_N_M` dai tipi “file”;
- lascia i layout solo come stati interni del buffer CPU repack;
- abilita esplicitamente **`GGML_OP_MUL_MAT_ID`** (percorso MoE) col repack dinamico.

Conferma pubblica: issue [#10757](https://github.com/ggml-org/llama.cpp/issues/10757), [#11258](https://github.com/ggml-org/llama.cpp/issues/11258), commento slaren post-merge citato sopra.

### 1.4 Timeline sintetica

| Quando | Cosa | Riferimento |
|---|---|---|
| 2024-02 → 2024-07 | Kernel Arm + tipi pre-packed su disco | [#5780](https://github.com/ggerganov/llama.cpp/pull/5780) |
| 2024-07 → 2024-11 | Uso community di `Q4_0_4_4` / `4_8` / `8_8` | Ollama #6125, discussioni Snapdragon |
| 2024-11-15 | Runtime repack via buffer type | [#9921](https://github.com/ggml-org/llama.cpp/pull/9921) |
| 2024-12-07 | Tipi file rimossi | [#10446](https://github.com/ggml-org/llama.cpp/pull/10446) |
| 2024-12+ | Solo `Q4_0` (+ IQ4_NL ecc.) + repack a load | errori `TYPE_* REMOVED` |

---

## 2. Ragioni negative (documentate vs congettura)

### 2.1 Portabilità — **documentata**

Il layout dipende dall’hardware (dotprod → 4×4, i8mm → 4×8, SVE/AVX → 8×8). Djip007 elenca esplicitamente la proliferazione: AVX2 8×N, AVX512 16×N, RDNA3 16×16, ecc. ([#10446](https://github.com/ggml-org/llama.cpp/pull/10446)).

**Cosa succede se il file non matcha la CPU?**

- **Dopo la rimozione:** load fallisce con errore chiaro  
  `TYPE_Q4_0_4_X REMOVED, use Q4_0 with runtime repacking`  
  ([#10757](https://github.com/ggml-org/llama.cpp/issues/10757), [#11258](https://github.com/ggml-org/llama.cpp/issues/11258)).
- **Quando i tipi esistevano:** un file `Q4_0_4_8` su CPU senza i8mm/SVE poteva fallire o non usare i kernel giusti (report community: illegal instruction / build flags, es. thread in [#5780](https://github.com/ggerganov/llama.cpp/pull/5780)). Non c’è evidenza di un “soft fallback silenzioso” documentato come policy ufficiale; il rischio di kernel sbagliato = risultati spazzatura è **plausibile** ma non citato come motivazione ufficiale della rimozione.

Con runtime repack: **un solo file Q4_0** gira ovunque; il layout è scelto a load sul device.

### 2.2 Dimensione file — **documentata (stessa footprint)**

- Dibakar: *“does not result in an additional memory overhead”* vs Q4_0 ([#5780](https://github.com/ggerganov/llama.cpp/pull/5780)).
- max-krasnyansky: Q4_0 e Q4_0_4_8 entrambi **4.33 GiB** sullo stesso modello ([#8336](https://github.com/ggml-org/llama.cpp/discussions/8336)).
- Issue #10435: Q4_0 e Q4_0_4_4 entrambi **3.56 GiB** (Llama 7B).

**Conclusione:** la ripaccatura **non** è un cambio di bit-per-weight; è un **riordino** (interleave di blocchi/righe). Padding solo se le dimensioni del tensore non sono multiplo dell’interleave (slaren su overflow se `nrows` non multiplo: [#9921](https://github.com/ggml-org/llama.cpp/pull/9921)) → in quel caso **il repack non si applica**, non si gonfia il file.

**Costo memoria runtime (non file):** con **mmap** + repack online si tiene mappa + copia repacked → RAM più alta; con `--no-mmap` “the repacking has no overhead” (max-krasnyansky, [#8336](https://github.com/ggml-org/llama.cpp/discussions/8336)). Issue recenti su fallimento alloc `CPU_REPACK` con modelli MoE >> RAM ([#23603](https://github.com/ggml-org/llama.cpp/issues/23603), Kobold [#2207](https://github.com/LostRuins/koboldcpp/issues/2207)).

### 2.3 Manutenzione / quanti layout — **documentata**

Citazione Djip007 sopra: AVX2, AVX512, BF16, RDNA3… → **N formati GGUF per lo stesso quant semantico**. slaren: meglio “interleaved types” nascosti nel buffer, non nuovi tipi file per ogni ISA.

Per un **ecosistema** (HuggingFace, Ollama, bartowski quants): catastrofe distributiva.  
Per un **artefatto di ricerca mono-device**: il costo di manutenzione mainline **non** si applica allo stesso modo.

### 2.4 Interazione con streaming MoE / interleave righe — **parzialmente documentata + inferenza**

**Domanda critica:** il tile mescola righe di esperti diversi?

Evidenza:

1. Il repack opera su **tensore** e sull’**interleave di righe** di quella matrice (slaren: *“number of rows in the tensors is not a multiple of the interleave size”*, [#9921](https://github.com/ggml-org/llama.cpp/pull/9921)).
2. PR [#10446](https://github.com/ggml-org/llama.cpp/pull/10446) aggiunge esplicitamente **`GGML_OP_MUL_MAT_ID` con dynamic repacking** → il percorso MoE è stato reso compatibile col repack **per-tensore / per-matrice esperto**, non con un layout che fonde esperti diversi a livello di file.
3. In GGUF MoE tipico gli esperti sono tensori 3D (`…_exps.weight`) o slice per expert id; l’interleave 4/8 riguarda gruppi di **righe della matrice di un esperto** (output channels), non “esperto A riga 0 + esperto B riga 0”.

**Verdetto tecnico su contiguità:**

| Scenario | Contiguità su disco | Idea pre-pack |
|---|---|---|
| Ogni esperto = tensore/blob separato, repack **dentro** l’esperto | resta un blob contiguo streamabile | **vive** |
| Un unico tensore 3D `[n_expert, …]` ripaccato globalmente mescolando esperti | potrebbe rompere slice per expert | da evitare; non è il design documentato |
| Repack solo a load nel buffer `CPU_REPACK` | blob GGUF resta Q4_0 row-major; layout tile solo in RAM | standard llama.cpp; streaming custom **non** entra nel buffer giusto → kernel lento |

**Non trovato** un paper/issue che dica esplicitamente “pre-pack su disco per expert streaming è impossibile perché il tile mescola esperti”. La morte dell’idea in mainline **non** è questa.

### 2.5 Altre ragioni

| Ragione | Stato |
|---|---|
| Convenienza utenti / un solo file | **documentata** (runtime da Q4_0; bartowski non deve più pubblicare `Q4_0_N_M`) |
| Nascondere layout in buffer type (API stabile `type==Q4_0`) | **documentata** (slaren #9921) |
| mmap vs repack online | **documentata** (Djip007: repack solo a load “reduce interest of mmap”; workarounds `--no-mmap` / `--no-repack`) |
| Costo CPU del repack a load | **documentata empiricamente** (doonny su #9921: *“According to perf, the online repack consumes a significant amount of cpu runtime. Why don't you keep it offline?”* — nessuna risposta maintainer che lo smentisca) |
| Correttezza: embeddings condivisi / KV quant | **documentata** come bug della prima implementazione non-buffer (#9921 slaren su gemma shared emb + `-ctk q4_0`) |
| IQ2/IQ3 non supportati dal repack path | **dato di contesto utente**; **non trovato** un roadmap ufficiale che li aggiunga al repack |

---

## 3. Stato dell’arte fuori da llama.cpp

### 3.1 Motori che **persistono** pesi pre-packed / pre-tiled

| Motore | Pre-pack su disco? | Note | Fonte |
|---|---|---|---|
| **TFLite + XNNPACK** | **Sì (cache file)** | Pack runtime → salva su file → mmap; “Persisting packed weights on disk bypasses the costly repacking process each time a model is loaded.” | [Google Developers Blog, 13 ago 2024](https://developers.googleblog.com/streamlining-llm-inference-at-the-edge-with-tflite/) |
| **TensorRT / TRT-LLM** | **Sì (engine)** | Engine compilato hardware-specific include layout/kernel ottimizzati; weight-stripped engines separano pesi da kernel | [NVIDIA weight-stripped engines](https://developer.nvidia.com/blog/maximum-performance-and-minimum-footprint-for-ai-apps-with-nvidia-tensorrt-weight-stripped-engines/) |
| **OpenVINO** | Compressione su IR/bin, non “tile ARM GGUF-like” | Weight compression INT4 ecc. salvabile; non trovato layout interleave GGUF-style | [OpenVINO weight compression](https://docs.openvino.ai/weight_compression) |
| **ONNX Runtime** | EP-dependent | QNN/DirectML/… possono avere transform offline; **non trovato** standard “pre-tiled GGUF” | — |
| **MLC-LLM / TVM** | Compilazione target-specific | Artefatti compilati; **non trovato** focus su stream MoE expert da flash | — |
| **ExecuTorch** | Delegate pack | XNNPACK path eredita cache pack; **non trovato** MoE stream specialistico | (indiretto via XNNPACK) |
| **ncnn / MNN** | Formati ottimizzati device | Pack per target comune; **non trovato** documentazione su MoE expert streaming | — |
| **QNN / SNPE (Qualcomm)** | Offline conversion a DLC/context bin | Layout NPU proprietario pre-processato | community Snapdragon [#8336](https://github.com/ggml-org/llama.cpp/discussions/8336) |
| **KleidiAI (Arm)** | Pack in-memory dopo 1ª pass | *“we internally cache the packed weights after first forward pass”* — non necessariamente su disco | [ML-examples kleidiai llama_cpp](https://github.com/ARM-software/ML-examples/tree/main/kleidiai-examples/llama_cpp) citato in [#8336](https://github.com/ggml-org/llama.cpp/discussions/8336) |

### 3.2 Qualcuno lo fa **specificamente per MoE streammati da disco**?

**Non trovato.**  
Ricerca su “MoE expert streaming pre-packed weights”, “disk offload experts tiled layout”, e issue MoE llama.cpp ([#11532](https://github.com/ggml-org/llama.cpp/issues/11532), guide offload) mostra offload layer/expert CPU↔GPU, **non** pre-tile su flash per kernel ARM interleaved.

Il caso più vicino: **XNNPACK weight cache su disco** (stesso problema di latenza di repack a cold start), ma non MoE-expert-stream.

### 3.3 Letteratura “layout-aware weight storage” / “pre-tiled weight formats”

- **Trovato (ingegneria di prodotto):** post Google TFLite/XNNPACK citato; blog TensorRT engine / weight stripping.
- **Non trovato** (in questa passata): survey accademico dedicato a “pre-tiled GGUF-like formats for on-device MoE streaming”.  
  Termini utili per deep-dive futura: *weight packing*, *im2col offline*, *blocked layout for GEMM*, *persistent weight cache*, *memory-mapped packed weights*.

---

## 4. Domanda inversa: far accettare al path repack un buffer gestito dall’app

### 4.1 Meccanismo ufficiale

**Sì, ed è la strada che i maintainer hanno imposto.**

Il layout interleaved **non** è un `ggml_type` di file; è uno stato del **buffer type**:

- storicamente: `ggml_backend_cpu_aarch64_buffer_type` / `CPU_AARCH64`
- oggi (contesto utente): `ggml_backend_cpu_repack_buffer_type()` / `CPU_REPACK`

Il model loader sceglie quel buffer type per i tensori eligibili; `set_tensor` / init del buffer fa il repack; i kernel `mul_mat` / `mul_mat_id` guardano il **buffer type** (e `tensor->extra` per il layout interno), non un tipo GGUF `Q4_0_4_8`.

Citazione slaren (obiettivo design):

> *…implemented is through the ggml-backend buffer interface, it gives more control to the application over which tensors will be changed…*

### 4.2 Cosa **non** c’è (o non trovato)

| Meccanismo | Stato |
|---|---|
| API pubblica “questa memoria è già Q4_0_4x8, non ripacchettare” | **non trovato** |
| Trait `already_packed` / flag su `ggml_backend_buffer` | **non trovato** in doc/issue |
| Usare `ggml_backend_cpu_buffer_from_ptr` e farsi accettare dai kernel interleaved | **non trovato** come percorso supportato per repack; i kernel veloci richiedono il buffer type repack |
| Custom `ggml_backend_buffer_type` implementato dall’app | **plausibile** (ggml-backend è estendibile); richiederebbe clonare la logica di `repack.cpp` + `supports_op` / gemm dispatch — **non documentato come ricetta ufficiale** |

### 4.3 Implicazione per lo streaming LRU

Il blocco attuale (“condizione 2 mai soddisfatta”) è esatto: se la cache LRU alloca con `malloc` / buffer CPU generico, **non** c’è repack path.

Strade ordinate per “lunghezza”:

1. **Allocare slot LRU come buffer `CPU_REPACK`** e far passare i byte Q4_0 (o Q4_K/Q8_0/IQ4_NL supportati) da flash → `set_tensor` / API equivalente del buffer → repack **una volta al miss**, non a ogni matmul.  
   - Pro: allineato a design upstream.  
   - Contro: repack ancora sul miss path (CPU); non zero-copy da flash se il file è ancora row-major.

2. **Pre-pack su disco (idea sotto studio) + buffer custom o write diretto nella memoria del buffer repack** saltando la conversione.  
   - Pro: miss ≈ memcpy.  
   - Contro: formato device-specific; fuori dal GGUF standard; bisogna garantire che i kernel leggano quel layout (stesso contratto di `repack.cpp`).

3. **Fork / kernel propri** che leggono Q4_0 standard senza tile — non risolve la performance.

La (1) è “la strada più corta” se l’obiettivo è solo sbloccare i kernel; la (2) se l’obiettivo è azzerare il costo di repack sul cold miss da flash.

---

## 5. Fonti primarie (checklist)

| ID | URL | Cosa prova |
|---|---|---|
| PR 5780 | https://github.com/ggerganov/llama.cpp/pull/5780 | Nascita kernel + tipi riarrangiati offline |
| PR 9921 | https://github.com/ggml-org/llama.cpp/pull/9921 | Runtime repack + buffer type; citazioni slaren |
| PR 10446 | https://github.com/ggml-org/llama.cpp/pull/10446 | Rimozione tipi file; MUL_MAT_ID; motivazione proliferazione layout |
| Issue 10757 | https://github.com/ggml-org/llama.cpp/issues/10757 | Errore `TYPE_Q4_0_4_4 REMOVED`; regimi pre/post |
| Issue 11258 | https://github.com/ggml-org/llama.cpp/issues/11258 | `TYPE_Q4_0_4_8 REMOVED` su Android |
| llama-cpp-python 1860 | https://github.com/abetlen/llama-cpp-python/issues/1860 | Collegamento a #9921 e messaggio REMOVED |
| Discussion 8336 | https://github.com/ggml-org/llama.cpp/discussions/8336 | Stessa size; mmap vs no-mmap; commit pre-rimozione `1e58ee1` |
| Discussion 8273 | https://github.com/ggml-org/llama.cpp/discussions/8273 | Auto-repack Q4_0 → layout accelerato |
| Ollama 6125 | https://github.com/ollama/ollama/issues/6125 | Esistenza formati Q4_0_4_8 in eco |
| TFLite/XNNPACK blog | https://developers.googleblog.com/streamlining-llm-inference-at-the-edge-with-tflite/ | Pre-packed weights **persistiti su disco** in produzione |
| TensorRT weight-stripped | https://developer.nvidia.com/blog/maximum-performance-and-minimum-footprint-for-ai-apps-with-nvidia-tensorrt-weight-stripped-engines/ | Engine = artefatto layout/kernel-specific |
| Issue 23603 | https://github.com/ggml-org/llama.cpp/issues/23603 | CPU_REPACK + MoE grandi + mmap |

---

## 6. Verdetto

### Scelta: **(c)** — provata e abbandonata per ragioni che **in gran parte NON valgono** nel vostro caso (device singolo, artefatto di ricerca, portabilità irrilevante), con caveat importanti.

### Argomentazione

1. **Fatto storico incontrovertibile:** tipi GGUF pre-paccati (`Q4_0_4_4` / `4_8` / `8_8`) sono esistiti e sono stati **rimossi di proposito** (PR #10446), non per un bug, ma per:
   - un solo quant portabile (`Q4_0`) nel marketplace;
   - evitare N file per N ISA;
   - isolare il layout nel **buffer type** CPU.

2. **Quelle ragioni sono di prodotto/ecosistema.** Sul vostro scenario (stream esperti da flash, un chip, cache LRU, artefatto non “pubblicato come quant universale”) la portabilità e la proliferazione GGUF **non** sono vincoli duri. Anzi, l’industry (XNNPACK) ha **re-introdotto** la persistenza su disco dei pesi packed per il cold-start — esattamente la vostra motivazione di latenza.

3. **La ragione tecnica che avrebbe ucciso l’idea (tile che mescola esperti diversi) non è documentata e non combacia col design:** interleave = righe di **una** matrice; `MUL_MAT_ID` è stato esplicitamente supportato col repack dinamico. Se ogni esperto è un blob indipendente, pre-pack **dentro** l’esperto **non** rompe lo streaming.

4. **Caveat che spingono verso un ibrido, non un “vai pure con nuovi tipi GGUF upstream”:**
   - upstream **non** riaccetterà tipi file `Q4_0_N_M` (slaren: *cannot be made anymore*);
   - la via idiomatica è **buffer type** (`CPU_REPACK`) o un buffer custom con lo stesso contratto;
   - pre-pack su disco ha senso come **formato privato di shard esperti** (non come quant HuggingFace);
   - sul miss path potete: (A) copiare Q4_0 → repack buffer (repack 1×), o (B) copiare già-tiled → buffer che non ri-converte;
   - IQ2/IQ3 restano fuori dal path veloce: pre-pack non li “sblocca” magicamente.

5. **Non è (b)** in senso stretto: le ragioni di abbandono mainline **non** dicono “offline pack è sbagliato per MoE streaming su un device”. Dicono “non vogliamo N quant su disco nell’ecosistema”.  
   **Non è (d):** è già stata fatta.  
   **Non è (a)** come pratica corrente: i tipi file sono morti.

### Raccomandazione operativa (fuori scope implementativo, solo indirizzo)

- **Priorità 1:** far vivere gli esperti streammati in `ggml_backend_cpu_repack_buffer_type()` (o equivalente) così i kernel veloci si accendono; misurare costo repack sul miss.
- **Priorità 2 (se il miss è ancora troppo lento):** shard su disco **già interleaved per quel SoC**, formato **privato**, memcpy → RAM del buffer repack **senza** second conversion; validare con test bit-exact vs repack ufficiale su un tensore.
- **Non** investire nel reintrodurre `Q4_0_4_8` come tipo GGUF mainline.

---

## 7. Cosa è stato cercato e non trovato

| Query / tema | Esito |
|---|---|
| Paper “pre-tiled weight formats for MoE expert disk streaming” | **non trovato** |
| API ggml “already_packed=true” | **non trovato** |
| Qualcuno che fa pre-tile su flash *specificamente* per MoE expert LRU | **non trovato** |
| Motivazione maintainer del tipo “offline pack rompe la correttezza numerica” | **non trovato** (hanno curato PPL parity offline) |
| Dimensione file aumentata dal tile | **confutato** (stessa size nei benchmark pubblici) |

---

*Fine report. Fonti verificate via web al 2026-08-07.*
