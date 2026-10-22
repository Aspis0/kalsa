# MLC-LLM: valutazione per la sostituzione del fork llama.cpp "kalsallama" — 2026-10-22

Oggetto: valutare MLC-LLM (https://github.com/mlc-ai/mlc-llm, https://mlc.ai) come
motore di inferenza al posto del nostro fork di llama.cpp, per il nostro caso:
desktop macOS arm64 (Metal), desktop Windows x64 (CPU + Vulkan, NVIDIA non
garantita), app telefono Android arm64 (Adreno/OpenCL, NPU Snapdragon/hexagon,
engine **dentro** l'app), iOS in futuro.

Documento scritto il 2026-10-22. Tutte le fonti sono elencate in fondo con URL e
data. Dove un dato non esiste o non è stato verificabile, lo scrivo esplicitamente:
**"non trovato"**.

---

## 0. Verdetto in una riga

**No: oggi MLC-LLM non è un cambio sensato per Kalsa.** Non supporta nessuno dei
due modelli che shippiamo (Qwen 3.6 35B-A3B e Gemma 4 E4B/12B), non ha MTP, non ha
NPU hexagon, non ha checkpoint/slot su disco, e sul telefono è *più* lento di
llama.cpp nel caso documentato. Ha però un vantaggio reale e non banale: il
**paged-KV/prefix-cache radix** che regge contesti lunghi meglio di llama.cpp, e un
percorso Android/Adreno *potenzialmente* superiore a llama.cpp se si prende il
fork Qualcomm (ma è un fork, non upstream).

---

## 1. Metodo e limiti della ricerca

- Ho letto il sorgente di `mlc-ai/mlc-llm` a `main` (clone locale, commit
  `8978ea9aec626d64096aaa92fbc89bda2e3ea802`, 2026-10-06) e le API pubbliche
  GitHub (`api.github.com/repos/mlc-ai/mlc-llm/...`, `/search/issues`), la
  documentazione pubblica su `llm.mlc.ai`, la Hugging Face API per gli artefatti
  `mlc-ai/*-MLC`, e fonti terze (paper arXiv, blog Qualcomm, Callstack, benchmark
  Android).
- **Limite 1 — la documentazione pubblica è vecchia.** `llm.mlc.ai/docs/...` è
  ancora intestata "mlc-llm 0.1.0 documentation" e il footer dice "© 2023-2025
  MLC LLM" (letto il 2026-10-22). I documenti nel repo (`docs/`) non citano né
  Gemma 4 né Qwen3.5 (l'unico file che li menziona è
  `docs/compilation/model_artifact_manifest.rst`). **Conclusione: per MLC-LLM il
  codice è la fonte, la documentazione no.**
- **Limite 2 — nessun benchmark MLC-vs-llama.cpp del 2026 su Qwen 3.6 o Gemma 4
  trovato.** I confronti esistenti sono su modelli più vecchi (Qwen2.5, Llama 3.x)
  o su fork non-upstream. Dove manca un dato, l'ho scritto.
- **Limite 3 — ho trattato come "fonte" anche blog e issue della community**, ma
  ho sempre distinto la voce upstream da quella terza. I numeri da blog non
  verificati sono marcati.
- **Limite 4 — nessun benchmark MLC-vs-llama.cpp su Windows x64 + Vulkan con CPU
  (senza NVIDIA) trovato.** Non esiste un confronto pubblico credibile su quella
  combinazione specifica.

---

## 2. Q1 — Stato oggi: vivo, ma rallentato e a manutenzione ridotta

### 2.1 Identificativi

| Voce | Valore | Fonte / data |
|---|---|---|
| Repo | `mlc-ai/mlc-llm`, creato 2023-04-29 | api.github.com/repos/mlc-ai/mlc-llm, letto 2026-10-22 |
| Licenza | **Apache-2.0** | idem |
| Stelle / fork | 23.263 / 2.163 | idem |
| Issue+PR aperti | 359 (di cui **57 PR aperti**) | idem + search/issues, 2026-10-22 |
| Ultimo tag | `v0.26.dev0` | api.github.com/.../tags, 2026-10-22 |
| Ultimo tag **stabile** | **`v0.20.0`**, committato **2026-07-07** da Ruihang Lai | commit `bb586e51eb20cba2e82216b75d22d8dd6657cce1` |
| Ultimo push su `main` | **2026-10-06T23:36:40Z** | api.github.com/repos/... |
| Release GitHub | solo `v0.1.dev0` (2023-04-29): il progetto **non usa GitHub Releases** | api.github.com/.../releases |

Nota di packaging: la distribuzione avviene via wheel (`mlc-llm`, `mlc-llm-nightly`,
`mlc-llm-nightly-cpu` servite da `https://mlc.ai/wheels`, cfr. la procedura di
installazione citata in issue #3536) e **non** via GitHub Releases.

### 2.2 Attività ultimi 3 mesi (2026-07-22 → 2026-10-22)

| Metrica | Valore |
|---|---|
| Commit mergeati su `main` | **18** (di cui 16 di Akaash Parthasarathy, 1 Ruihang Lai, 1 bot) |
| Issue + PR aperti | 62 (di cui **49 PR**) |
| PR chiusi/merged | 22 |
| Issue chiuse | 2 |
| PR aperti totali al momento | 57 |

Il backlog cresce: 49 PR aperti in 3 mesi contro 22 chiusi. Molte PR recenti sono
aperte da giorni senza merge (es. #3570 del 2026-10-03, #3553 del 2026-09-24
ancora aperte al 2026-10-22).

Istogramma commit su `main` per mese 2026 (api.github.com, 2026-10-22):

```
gen 4   feb 30   mar 25   apr 9   mag 3   giu 2   lug 4   ago 1   set 12   ott 3 (fino al 22)
```

Picchi a febbraio-marzo, poi **crollo a 1-4 commit/mese** fino ad agosto, risalita
a 12 in settembre (Gemma 4, Qwen3.5 vision) e 3 in ottobre.

### 2.3 Chi lo mantiene

- **Organizzazione:** `mlc-ai` (Tianqi Chen / tqchen, autore originale).
- **Committente dominante da luglio 2026:** **Akaash Parthasarathy** (`akaashrp`),
  con co-autori esterni inclusi **Gabriel Guralnick** (`gabriel@imbue.com`), che ha
  portato il port di Gemma 4.
- **Ruihang Lai** (`MasterJH5574`, CMU): ha taggato `v0.20.0` ed è il referente
  tecnico citato da Callstack per il caso Adreno.
- Contributori esterni rilevanti: **Qualcomm** (ottimizzazioni target Adreno,
  blog sviluppatore 2025-02) e **Google** (port Gemma 4 E2B).

### 2.4 Salute: indicatori concreti

| Indicatore | Lettura |
|---|---|
| CI GitHub Actions | **Solo 4 workflow: `documentation.yaml`, `lint.yml`, `update-relax.yaml`, `windows-build.yaml`.** Nessuna matrice di test Linux/macOS/Android. |
| Test end-to-end | Assenti dalla CI: solo Lint + build Windows |
| Documentazione pubblica | Ferma alla versione 0.1.0 (vedi Limite 1) |
| PR #3582 (2026-10-22) | "[Python] Fail loudly when a native library has an invalid macOS code signature" — **aperta il giorno stesso della ricerca** |
| Issue #3536 (aperta 2026-08-21, **0 commenti**) | Le wheel `mlc-llm-nightly-cpu` su **macOS ARM64** fanno crashare l'intero processo Python con `exit(0)` silenzioso: `libtvm_runtime.dylib` chiama `exit(0)` nella init statica C++ quando caricata via `dlopen` (firma di codice non valida) |
| Claim terzo "maintenance mode" | Una ricerca indipendente del 2026-09-19 scrive: *"MLC/TVM … 262–394 dispatches per token; MLC-LLM is in maintenance mode"* — **caratterizzazione di terzi, in parte superata**: a settembre/ottobre 2026 sono arrivate Gemma 4, Qwen3.5 vision, LFM2, SmolLM3, template MiniCPM5 |

**Verdetto su Q1:** progetto **vivo ma a bassa velocità e con manutenzione
incompleta**. Non è in letargo (modelli nuovi, PR freschi), ma non ha CI
multi-piattaforma, la documentazione pubblica è ferma a 3 anni fa, c'è un bug
di impacchettamento macOS ARM64 aperto da 2 mesi e il backlog PR cresce.

---

## 3. Q2 — Matrice piattaforme e backend

Fonte primaria: `python/mlc_llm/support/auto_target.py` (PRESET, letto a
`main` 2026-10-06) + tab target della doc di compilazione
`https://llm.mlc.ai/docs/compilation/compile_models.html`.

| Piattaforma | Backend MLC-LLM | Stato | Note / fonti |
|---|---|---|---|
| **macOS arm64 (Metal)** | ✅ `metal:generic` | **Supportato e maturo** | È il target di sviluppo primario (i test Qwen3.5 vision citano "tested with Qwen3.5-4B (q4f16_1, Metal)") |
| **Windows x64 (CPU)** | ✅ target `llvm` | Supportato | `docs/deploy/rest.rst`: `--device` accetta `cuda, metal, vulkan, rocm, opencl, auto`; per CPU il target è LLVM |
| **Windows x64 (Vulkan, senza NVIDIA)** | ✅ `vulkan:generic` | Supportato | Target Vulkan generico con `supports_float16/int8/...`; c'è CI di build Windows (`windows-build.yaml`) |
| **Windows x64 (CUDA)** | ✅ | Supportato | Non ci serve (NVIDIA non garantita) |
| **Android arm64 (Adreno, OpenCL)** | ✅ `android:adreno` / `android:generic` | **Supportato, ma con avvertenze serie** | Target con `kind: opencl`, `device: adreno`, `max_threads_per_block: 512`; host `aarch64-linux-android` |
| **Android (Vulkan)** | ⚠️ non è il target Android predefinito | Il path Android ufficiale è **OpenCL**; Vulkan esiste come target generico (`vulkan:generic`) ma non è il percorso documentato per Android | `auto_target.py` PRESET |
| **Android (Mali)** | ✅ `mali:generic` (OpenCL, host `aarch64-linux-gnu`) | Supportato | |
| **NPU Snapdragon / hexagon** | ❌ **NON SUPPORTATO** | `android/mlc4j/prepare_libs.py:40` imposta esplicitamente **`"-DUSE_HEXAGON_SDK=OFF"`**. Issue #1689 ("Support NPU: hexagon") aperta dal 2024, ultimo aggiornamento marzo 2025, **ancora aperta**. | |
| **iOS / iPadOS** | ✅ `iphone:generic` / `macabi:generic` (Metal, `arm64-apple-ios18.0-macabi`) | Supportato | SDK Swift; `docs/deploy/ios.html` |
| **Web / browser** | ✅ `webgpu:generic` | Supportato (WebLLM) | |
| **CoreML / ANE** | ❌ | MLC non usa CoreML/ANE: usa **Metal** su iOS/macOS | `auto_target.py` |

### 3.1 Come si integra in un'app Android

Pipeline documentata (`https://llm.mlc.ai/docs/deploy/android.html`, letto 2026-10-22):

1. Requisiti di build: **Android NDK** (docs: NDK 27.0.11718014), CMake, **JDK ≥ 17**,
   **Rust/cargo** (serve per cross-compilare i tokenizers HuggingFace), Android Studio.
2. `mlc_llm package` **compila il modello per il target Android** e produce
   `dist/lib/mlc4j/` con `libtvm4j_runtime_packed.so` (arm64-v8a) + `tvm4j_core.jar`
   (~60 KB di binding Java) + `dist/lib/mlc4j` come sottoprogetto Gradle.
3. I pesi si scaricano da HuggingFace (`HF://mlc-ai/<model>-q4f16_1-MLC`) o si
   "bundlano" nell'APK (`bundle_weight: true` + `python bundle_weight.py`).
4. L'app include `:mlc4j` come progetto Gradle e chiama l'engine **in-process via
   JNI**. **Non esiste un server HTTP in-app**: sull'Android MLC non è un server,
   è una libreria. (Il server OpenAI-compatible esiste solo in `mlc_llm serve`, che è
   Python e gira lato server, non dentro l'app telefono.)

**Known issue documentato (rilevante per noi):** su GPU Adreno i modelli con suffisso
`_1` (layout pesi trasposto) causano un **freeze della UI di sistema di 20-50 secondi
al prefill**; i modelli `_0` non lo fanno. Riferimento: issue #3363, e l'analisi
di terzi di Callstack del 2026-10-16.

### 3.2 Come si integra in un'app desktop

- **Non esiste binding Rust ufficiale.** I binding disponibili sono: **Python**
  (`mlc_llm`), **Swift** (iOS), **Java/JNI** (Android) e un livello **C++**
  (`cpp/json_ffi/json_ffi_engine.cc`, `cpp/serve/*`, `cpp/multi_gpu/*`). Non ho
  trovato un crate Rust nel repo.
- L'engine "nativo" C++ (prefisso `cpp/serve/`: `prefix_cache.cc`,
  `radix_tree.cc`, `draft_token_workspace_manager.h`) è un componente **nuovo** in
  sviluppo; i PR di settembre/ottobre 2026 parlano esplicitamente di "native
  engine" e di "manifest-driven model artifacts".
- Il percorso **praticato** per un desktop è: lanciare `mlc_llm serve` (server
  **Python/FastAPI**) e parlarci via HTTP OpenAI-compatible — che è anche il nostro
  modello di architettura (l'app desktop parla a un server HTTP).
- **Peso operativo**: `mlc_llm serve` richiede un ambiente Python con
  `mlc-llm` + dipendenze (tvM, numpy, fastapi, uvicorn, psutil…). È molto più
  pesante del binario `llama-server` del nostro fork. Non è un problema se
  l'app desktop NON incorpora il motore, ma lo è se loIncorporiamo.

---

## 4. Q3 — Copertura modelli: qui MLC fallisce sui nostri due modelli

### 4.1 I nostri modelli vs MLC-LLM (stato al 2026-10-22)

| Nostro modello | Supportato da MLC-LLM? | Evidenza |
|---|---|---|
| **Qwen 3.6 35B-A3B** (MoE, attenzione ibrida + sliding window) | ❌ **NO, zero support upstream** | `grep -ri "qwen3_6\|qwen36\|Qwen3\.6"` su `python/ cpp/ android/ ios/` → **0 occorrenze**. Il registry `python/mlc_llm/model/model.py` non contiene `qwen36`. Gli artefatti HF `mlc-ai/Qwen3.5-*` coprono solo **0.8B, 2B, 4B, 9B** (tutti densi, non MoE). |
| **Gemma 4 E4B** (MoE) | ❌ **NO** | `gemma4_config.py:110` → `raise ValueError("The first Gemma 4 target is the dense E2B architecture")` quando `enable_moe_block` è vero. |
| **Gemma 4 12B** | ❌ **NO** | Config Gemma 4 hard-coded su E2B: `hidden_size=1536`, `num_hidden_layers=35`, `num_attention_heads=8` (8 query head, 1 KV head), `hidden_size_per_layer_input=256`, `global_head_dim=512`. Artefatti HF: solo `gemma-4-E2B-it-q4f16_1-MLC` e `-q4f32_1-MLC` (creati 2026-10-11). |
| **Gemma 4 E2B** (non è il nostro target) | ⚠️ Parziale: **solo testo+audio, niente visione** | `gemma4_config.py:141` → *"Gemma 4 text+audio configuration; **vision is intentionally not instantiated**"* |
| Visione (mmproj) | ⚠️ **Non esiste un "mmproj" separato** | In MLC il proiettore visione è un *adapter* (`embed_image`) esportato **nella stessa libreria compilata** del modello, dichiarato nel manifest. Modelli con visione supportati: Gemma 3 vision, Qwen3.5 vision, Qwen2.5-VL, LLaVA, Phi-3.5-vision, MiniCPM-V. |
| **Decodifica speculativa con drafter MTP** | ❌ **NO** | `grep -ril "mtp"` su `python/ cpp/ android/ ios/` → **0 occorrenze**. Modalità supportate: `disable`, `small_draft`, `eagle`, `medusa` (`python/mlc_llm/serve/config.py:103`, `--speculative-mode`). |
| EAGLE / Medusa | ✅ Sì (`eagle`, `medusa`) | idem; serve un `--additional-models` (draft model) |
| MoE in generale | ✅ Sì, per altre architetture | `qwen3_moe`, `mixtral`, `deepseek_v2`, `ministral3`, `sarvam` (MoE) ecc. |
| Attenzione ibrida (GatedDeltaNet) | ✅ Sì per **Qwen3.5** | `python/mlc_llm/model/qwen35/qwen35_model.py`: *"Implementation for Qwen3.5 GatedDeltaNet hybrid architecture. 75% GatedDeltaNet (recurrent linear attention), 25% standard GQA softmax attention"*, con kernel TIR dedicato |

### 4.2 Quanto è indietro MLC sui nuovi schemi

Tre casi concreti, tutti verificati:

1. **Qwen 3.6 (settembre-ottobre 2026): MLC upstream non c'è.** Esiste solo un
   **fork della community** — issue #3492 (aperta 2026-05-01, aggiornata 2026-07-27,
   **ancora aperta**), branch `alansrobotlab2/mlc-llm` tree `qwen3_5`. Il fork
   dichiara per `qwen3.6-35b-a3b` su Orin AGX: **tg 54.46 tok/s vs 29.26 di
   llama.cpp Q4_K_XL (1.93×)**, e su `qwen3.5-0.8b` **134.8 vs 100.3 tok/s (1.34×)**.
   Ma è su **CUDA/Orin**, e richiede modifiche **anche a TVM**. Sul branch del fork
   l'**MTP è stato empiricamente scartato** ("MTP self-spec + B-ext spec decode
   were both empirically ruled out — token-agreement collapsed under fp16 drift",
   "mtp>1 (net negative on orin)"). E per **Gemma 4 E4B** la richiesta issue #3477
   (2026-04-05, aperta) documenta che il rilevamento automatico falliva con
   `ValueError: Unknown model type: gemma4`.
2. **Gemma 4 è arrivato in MLC solo a settembre 2026** (PR #3567 e successivi) e
   **solo per E2B dense text+audio**. Il commit del 2026-09-29 documenta
   esplicitamente: *"Record the experimental Gemma 4 audio scope and explicitly call
   out unsupported vision, video, ASR, compressed-audio, and native-server paths"*.
   Inoltre il 2026-10-06 (#3565) il motore native non passava i token id al modello,
   rendendo Gemma 4 non eseguibile dal server: *"Models that look up token IDs
   inside the model, such as Gemma 4, cannot run that way"*.
3. **Artefatti pubblicati con adozione quasi nulla**: `mlc-ai/gemma-4-E2B-it-q4f16_1-MLC`
   creato 2026-10-11 → **369 download**; `-q4f32_1` → 79. Gli `Qwen3.5-*` (0.8B/2B/4B/9B,
   q4f16_1/q4f32_1/q0f16) creati 2026-03/04 → **0-13 download** ciascuno.

**Conclusione Q3:** per i modelli che Kalsa shippa oggi, MLC-LLM è **indietro di
almeno una generazione di modelli** (supporta Qwen3.5 densi ≤9B e Gemma 4 E2B
text+audio; noi usiamo Qwen3.6 35B-A3B e Gemma 4 E4B/12B). E **non ha MTP**, che
è un nostro requisito esplicito.

---

## 5. Q4 — Quantizzazione

### 5.1 Formato

- **MLC non legge GGUF.** Codice sorgente, `python/mlc_llm/support/auto_weight.py:177`:
  `# "ggml", "gguf" are not supported yet.` → `AVAILABLE_WEIGHT_FORMAT = ["huggingface-torch", "huggingface-safetensor", "awq"]`.
  I pesi vanno convertiti da HF safetensors al **formato MLC** (`mlc_llm convert_weights`).
- I pesi convertiti sono *platform-independent* (sono tensor cache), ma la **libreria
  compilata (.so/.dylib) è per modello × quantizzazione × target**.

### 5.2 Schemi di quantizzazione supportati (`python/mlc_llm/quantization/quantization.py`)

`q0f16`, `q0bf16`, `q0f32`, `q3f16_0`, `q3f16_1`, `q4f16_0`, `q4f16_1`, `q4bf16_0`,
`q4bf16_1`, `q4f32_1`, `q4f16_2`, `q4f16_autoawq`, `q4f16_ft`; in più FP8
weight-activation su CUDA (`e4m3_e4m3_f16`, `e5m2_e5m2_f16`).

**Punto critico per noi: non esiste alcuno schema a 8 bit.** Il nostro Q8_0 non ha
equivalente: il massimo è `q4f32_1` (4 bit + accumulo fp32) o `q0f16` (16 bit, il
doppio della memoria di GGUF Q8_0).

Formato di `q4f16_1`: **group quantization con group_size=32, int4, scale fp16**,
layout `NK` (variante `_0` = layout `KN`). Per il confronto: GGUF `Q4_K_M` usa
super-block da 256 con scale 6-bit (~4.8 bpw) — cioè **Q4_K_M è di qualità
superiore a parità di bit nominale** rispetto a `q4f16_1` (~4.5 bpw, scale fp16 per
gruppo di 32). Il vantaggio di `q4f16_1` è la **semplicità del kernel**, non la
qualità. La documentazione MLC (`docs/compilation/configure_quantization.rst`)
dichiara inoltre `q4f16_autoawq` come "not stable".

### 5.3 Costo operativo

Il costo è reale e va detto chiaramente:

- **Ogni (modello × quantizzazione × target) va compilato.** La pipeline è:
  `gen_config` → `convert_weights` → `compile` → `package`. La compilazione richiede
  TVM + LLVM/NDK e **minuti per modello per piattaforma**.
- **Chi distribuisce gli artefatti:** storicamente la comunità MLC (`mlc-ai` su HF);
  oggi esiste il **"Model Artifact Manifest"** (`docs/compilation/model_artifact_manifest.rst`,
  nuovo in 2026) che è un contratto opt-in per pacchetti modello + programma
  compilato — un percorso più maturo per distribuire artefatti firmati, ma è
  infrastruttura nuova, non consolidata.
- **Sul telefono** la compilazione per Android è d'obbligo per ogni modello che
  vuoi offrire (`mlc_llm package` → `.tar` per android), quindi per i nostri 3-4
  modelli × 2 quant × 2 varianti di device è un costo di CI non banale.
- **Non esiste un "compila una volta, usa su tutti i device"**: lo `.so` è per
  architettura e backend. Su Android il runtime è compilato dentro l'APK
  (`libtvm4j_runtime_packed.so`), i pesi invece sono scaricabili a runtime.

**Conclusione Q4:** il modello di distribuzione MLC (compila-per-modello-per-target,
pesi in formato proprietario, niente GGUF, niente 8-bit) è **strutturalmente
incompatibile** con la nostra pipeline attuale basata su GGUF e con la nostra
offerta Q4_K_M/Q8_0.

---

## 6. Q5 — Serving

### 6.1 API e feature presenti (`python/mlc_llm/serve/`)

| Funzionalità | Stato MLC-LLM | Fonte |
|---|---|---|
| Endpoint OpenAI-compatible | ✅ `/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/v1/embeddings` | `serve/entrypoints/openai_entrypoints.py` |
| Streaming SSE | ✅ `StreamingResponse(..., media_type="text/event-stream")`, formato `data: {...}` + `data: [DONE]` | idem, righe 159-179 e 265-285 |
| Concorrenza / multi-slot | ✅ **continuous batching** con `max_num_sequence`; preset `--mode server` che inferisce il max batch possibile | `serve/config.py`, `docs/deploy/rest.rst` |
| Parallelismo | ✅ tensor parallel (`--overrides "tensor_parallel_shards=N"`), pipeline parallel | idem |
| Prompt caching / prefix cache | ✅ **radix tree** (`--prefix-cache-mode radix`, default) con riciclo di sequenze (`prefix_cache_max_num_recycling_seqs`) | `serve/config.py:118-124`, `serve/radix_tree.py`, `cpp/serve/prefix_cache.cc` |
| Autenticazione | ✅ solo `--api-key` con header `Authorization: Bearer` | `openai_entrypoints.py:29-39` |
| Metriche | ✅ Prometheus `/metrics` | `serve/entrypoints/metrics_entrypoints.py`, PR #3576 |
| API microserving | ✅ (`microserving_entrypoints.py`, docs `docs/microserving/`) | |
| **Header custom per richiesta** | ❌ **non nativi**. Si può aggiungere middleware FastAPI (server in Python), ma non esiste una nozione di header "portante semantica" | |
| **Isolamento cache per dispositivo** (`X-Kalsa-Cache-Salt`) | ❌ **non esiste**. La prefix cache è **per-processo**, globale, senza partizionamento per client | `cpp/serve/prefix_cache.cc` |
| **Selezione esplicita di slot** (`X-Kalsa-Slot`) | ❌ **non esiste**. Il modello è continuous-batching + radix cache, non "slot" alla llama.cpp | |
| **Save/restore slot su disco** (`--ctx-checkpoints`) | ❌ **non esiste**. `grep -ril checkpoint` su `python/ cpp/ android/ ios/` → **solo** riferimenti a `checkpoint_path` dei modelli HF, **zero** a checkpoint di contesto/KV su disco | |
| **Prefill disaggregato / hybrid prefill** | ✅ `prefill_mode: chunked|hybrid` | `serve/config.py:127` |

### 6.2 Cosa significa per noi

- **Multi-slot:** MLC lo fa meglio di llama.cpp in un senso (continuous batching
  vero, non "N slot" fissi) e peggio in un altro (non puoi *pinnare* una conversazione
  a uno slot, non puoi isolarne la cache, non puoi serializzarla).
- **Le nostre feature custom (`X-Kalsa-Cache-Salt`, `X-Kalsa-Slot`, checkpoint su
  disco) non hanno un equivalente.** Ricostruirle dentro MLC significa:
  (a) patchare il server Python per il routing e l'isolamento, (b) **implementare da
  zero** la serializzazione della KV cache su disco, che in MLC non esiste e che
  non è banale (KV paged + stato ricorrente per i modelli ibridi come Qwen3.5/3.6).
- **In più**: il commit del 2026-10-06 (#3565) documenta che i modelli token-aware
  (Gemma 4) **non sono ancora cablati** con draft models e prefill disaggregato
  ("Draft models and disaggregated prefill are not wired for token-aware models and
  stop with a check"): cioè **la combinazione visione + speculativa + hybrid prefill
  non è ancora disponibile**.

---

## 7. Q6 — Performance

### 7.1 Apple Silicon (Metal)

**Studio più rigoroso trovato** — arXiv **2511.05502**, *"Production-Grade Local LLM
Inference on Apple Silicon"* (pubblicato **novembre 2025**, quindi >1 anno: è il
confronto più metodologicamente solido ma non recente). Hardware: **Mac Studio M2
Ultra 192 GB**, famiglia **Qwen-2.5**, prompt da poche centinaia a 100k token.
Versioni: MLC-LLM commit `3d42929`, llama.cpp `b5963`, MLX v0.26.

| Runtime | Throughput | P99 latency | Note |
|---|---|---|---|
| MLX | ~230 tok/s | — | massimo assoluto |
| **MLC-LLM** | **~190 tok/s** | ~13 ms | **~17% sotto il picco MLX**; TTFT più basso su prompt moderati; KV paged regge 100k (70-85 GB a 128k) |
| llama.cpp | ~150 tok/s (short ctx) | — | **crolla a ~1,2 tok/s a 32k** (niente KV paged, in quella versione) |

Punto chiave: **MLC batte llama.cpp in throughput e soprattutto in contesti lunghi
(su quella versione di llama.cpp)**; llama.cpp vince in leggerezza e single-stream.

**Confronto datato 2026 (fonte secondaria, qualità bassa)**: un blog
(`localaimaster.com`) dichiara per **MacBook M4 Max, Llama 3.1 8B q4f16_1**:
**MLC Metal 62 tok/s vs llama.cpp 58 tok/s** — MLC *leggermente* davanti. **Non
verificato**: non ho trovato né la data di pubblicazione né un metodo; il blog
presenta anche numeri non standard. **Uso questa fonte solo come indicazione di
ordine di grandezza, non come benchmark.**

**Nessun benchmark 2026 credibile trovato su MLC-LLM con Qwen 3.6 / Gemma 4 su
Apple Silicon.** Il paper BaseRT (arXiv 2607.00501, luglio 2026) usa
**llama.cpp b9630 (giugno 2026)** e MLX come baseline, **non MLC-LLM**.

### 7.2 Android / Adreno

Qui il quadro è **chiaramente sfavorevole a MLC nel percorso upstream**:

| Fonte | Data | Risultato |
|---|---|---|
| **TinyBench** (fork MLC-LLM, Samsung S24 Ultra, SD8 Gen 3, Adreno 750, OpenCL) | 2026 | `Llama-3.2-3B q4f16_0`: **10.96 tok/s decode**, prefill 2341 ms, GPU 61-63 °C, 4812 mW medi, 14.4 mJ/tok, modello caricato in 18.4 s |
| **Research report** (repo `eclairsameal/android-on-device-llm-poc`) | 2026 | MLC-LLM su S24 Ultra: **throttling termico che termina completamente dopo 6 inferenze**; **prefill OpenCL più lento del CPU di llama.cpp (25.128 ms vs llama.cpp CPU)**; difficoltà d'integrazione **"Very Hard"** (NDK+Rust+TVM+LLVM+Java); API min 24 vs llama.cpp API 28; NPU ❌ |
| **Callstack** (profiling MLC OpenCL su Android) | **2026-10-16** | Il caso `_1` (layout trasposto) sul prefill: ~48 s contro ~0,5 s atteso; 56 kernel >0,4 s (28 >0,6 s) → `fused_dequantize_*_NT_matmul`. Workaround: usare il layout `_0`. Confermato con **Ruihang Lai** (manutentore MLC). Il team ha contribuito la sezione "known issues" alla doc MLC |
| **arXiv 2410.03613** (Performance Study on COTS Mobile Devices) | 2024 (v4) | In MLC LLM **i tempi di caricamento su Adreno sono ~9× più lunghi** che con llama.cpp (warm-up incluso); su Mali ~5×; Adreno batte Mali; M1 ~2× più veloce di Adreno 750 per modelli ~1B |
| **Qualcomm** (blog sviluppatore, ottimizzazioni Adreno) | 2025-02 | Su Snapdragon 8 Gen 3 con MLC: decode 11-14 tok/s per 7-8B, 22-42 tok/s per 2B/phi-2; Qualcomm dichiara miglioramenti generici su decode **e** TTFT |
| **IWOCL 2025** (Hongqiang Wang, Qualcomm) | 2025 | Confronto MLC vs llama.cpp su Adreno; MLC "well-optimized for high-end Adreno GPUs"; chiave: il layout dei dati (tile 32×16) e l'allineamento software-hardware dominano |
| **Nota ricerca 2026-02-09** | 2026-02-09 | Il **fork MLC ottimizzato da Qualcomm** raggiunge **6,8× sul prefill** rispetto a MLC generico (Llama2-7B Q4_0 su SD8G3: **8,3 → 56,5 tok/s**) |

**Sintesi Android:** il percorso MLC generico su Adreno è oggi **pari o peggiore di
llama.cpp CPU**, soffre di tempi di caricamento lunghi, di un freeze di UI di
20-50 s su layout `_1`, e di throttle termico che in un test uccide il servizio
dopo 6 inferenze. Ma il **potenziale è reale**: il fork con ottimizzazioni Qualcomm
(che è ciò che ha fatto Qualcomm con i propri contributi al repo MLC) è 6,8× più
veloce del MLC generico nel prefill. Questo però è un **fork**, non upstream, e
costa manutenzione nostra.

---

## 8. Q7 — Costo di migrazione: cosa si perde dal nostro fork

| Nostra feature (fork kalsallama) | Equivalente MLC-LLM | Costo di ricostruzione |
|---|---|---|
| **Qwen 3.6 35B-A3B** | ❌ assente | Porting di un'intera architettura (fork community disponibile solo su CUDA/Orin, con modifiche a TVM) |
| **Gemma 4 E4B / 12B (SWA)** | ❌ assente (solo E2B dense) | Porting complesso: config MoE, nesting multimodale, vision tower |
| **Drafter MTP** | ❌ assente (solo small_draft/eagle/medusa) | Porting di MTP + i problemi di token-agreement (misurati come negativi su Orin nel fork) |
| **Proiettore visione (mmproj) ~560 token/immagine** | ⚠️ esiste ma dentro la lib compilata, e **non per Gemma 4** (visione non istanziata); token/immagine derivati (196 per Qwen3.5 a 448²) | Riportare il conteggio a ~560 token/immagine e il pre-processing nostro |
| **Server HTTP OpenAI-compatible + SSE** | ✅ esistente | Nessuno (o meglio: passare da FastAPI a Python) |
| **Multi-slot** | ✅ diverso (continuous batching) | Nessuno, ma perdiamo l'addressing per slot |
| **Prompt caching** | ✅ migliore (radix paged) | Nessuno |
| **Isolamento cache per dispositivo** (`X-Kalsa-Cache-Salt`) | ❌ | Da implementare: partizionamento/namespace della radix cache per client |
| **Selezione slot via header** (`X-Kalsa-Slot`) | ❌ | Da implementare a mano, con semantica nuova |
| **Save/restore slot su disco** (`--ctx-checkpoints`) | ❌ | **Da implementare da zero**: serializzazione KV paged + **stato ricorrente** (per i modelli ibridi) su disco |
| **Desktop: binario server leggero** | ⚠️ server Python (`mlc_llm serve`) | Da risolvere: app desktop che non vuole un runtime Python |
| **Telefono: engine dentro l'app, governor termico, handoff NPU→GPU** | ❌/⚠️ | Il governor è **nostro** e costruito su llama.cpp: in MLC non esiste né NPU hexagon (`USE_HEXAGON_SDK=OFF`) né un'API per handoff prefill NPU→GPU. Da riscrivere. |
| **Formato GGUF** | ❌ | Conversione di tutta la distribuzione modelli + CI di compilazione per modello×quant×target |
| **Q8_0** | ❌ | Nessuno schema 8-bit: o `q4f32_1` o fp16 (2× memoria) |
| **Licenza** | Apache-2.0 vs MIT di llama.cpp | Nessun impatto (entrambi permissivi) |

**Costo di ricostruzione dei nostri custom:** i due pezzi veramente mancanti in MLC
sono **(a) l'isolamento cache per dispositivo** e **(b) il checkpoint di contesto su
disco**. Entrambi sono deep work non banale (b richiede di serializzare KV paged +
stato RNN per l'architettura ibrida). Il governor termico/handoff NPU→GPU del
telefono è già engine-specific e andrebbe riscritto comunque — ma su MLC non
avremmo nemmeno il backend NPU su cui innestarlo.

---

## 9. Dove MLC vincerebbe, dove ci costerebbe

### Dove MLC-LLM è oggettivamente migliore di llama.cpp

1. **Contesti lunghi (64k-128k+):** KV cache paged con radix tree — l'unico vantaggio
   strutturale misurabile su Apple (arXiv 2511.05502, nov. 2025).
2. **Continuous batching vero** per il multi-slot, superiore ai "slot fissi" di llama.cpp.
3. **Server più ricco out-of-the-box**: REST OpenAI-compatible, SSE, `/metrics`
   Prometheus, microserving, tensor/pipeline parallel.
4. **Potenziale Adreno:** con ottimizzazioni layout à la Qualcomm, il prefill è 6,8×
   il MLC generico e potenzialmente migliore di llama.cpp GPU (che su Adreno è
   storicamente rotto/limitato).
5. **Un modello vision "fatto bene"** per alcuni modelli (Qwen3.5 vision, Gemma 3
   vision) con adapter integrato, e verifica numerica fatta (cosine 0.999 vs
   HuggingFace) — qualità di ingegneria visibile nei commit.

### Dove ci costerebbe (o ci costerebbe di più)

1. **I due modelli che shippiamo non ci sono.** Punto non negoziabile.
2. **Niente MTP** → perdiamo il drafter e il suo guadagno (misurato sul nostro
   stack: +12% sul MoE 35B-A3B, +75% sul dense 27B — fonte
   `stared/benching-local-llms-on-apple-silicon`, 2026-06-14).
3. **Niente NPU hexagon** → il governor NPU→GPU che abbiamo costruito non ha backend.
4. **Niente checkpoint di contesto su disco** → la funzionalità `PLAN-CHAT-ON-DISK` /
   `--ctx-checkpoints` va riscritta da zero.
5. **Formato pesi proprietario + compilazione per modello×quant×target** → costo
   operativo e di CI reale, e incompatibilità con la nostra catena GGUF.
6. **Sul telefono MLC è (oggi) peggio di llama.cpp** nel percorso documentato:
   prefill più lento del CPU, caricamento 9× più lento, freeze UI 20-50 s sul layout
   `_1`, throttle che uccide il servizio dopo 6 inferenze.
7. **Integrazione Android "Very Hard"** (NDK+Rust+TVM+LLVM+Java) e nessun server
   HTTP in-app: la nostra architettura "engine dentro l'app" va mantenuta, quindi
   lato telefono MLC non ci dà il server che ci serve al desktop.
8. **Debilità di processo**: CI solo Lint+Windows, doc pubblica ferma al 2023,
   57 PR aperti e backlog in crescita, bug di firma codice macOS ARM64 aperto dal
   2026-08-21 (fix in PR #3582 del 2026-10-22, non ancora merged).

---

## 10. Verdetto finale

**Per il NOSTRO caso (Android + Windows + macOS, con Qwen 3.6 35B-A3B e Gemma 4
E4B/12B, drafter MTP, mmproj, checkpoint su disco): MLC-LLM oggi NON è un cambio
sensato.**

- **Decisione: NO-GO sul cambio di motore.** Non è una questione di maturità
  marginale: mancano i due modelli cardine, manca MTP, manca NPU, mancano i
  checkpoint di contesto. Anche se MLC fosse "più bello", oggi non girerebbe il
  nostro catalogo.
- **NO-GO anche parziale sull'Android**: il percorso OpenCL upstream è documentato
  come inferiore a llama.cpp su Adreno. Il solo percorso vincente è il **fork
  Qualcomm**, che è una seconda base di codice da mantenere — esattamente il
  costo che oggi ci tocca con kalsallama.
- **Il valore di MLC è reale ma per un prodotto diverso**: server con context
  lunghissimi (64k-128k), continuous batching, metriche, multi-GPU. Se in futuro
  Kalsa volesse un "modo cloud/locale-server" per documenti enormi, MLC-LLM è un
  candidato da valutare — ma su **Qwen 3.x ≤9B** e con **KV su disco in casa
  nostra**, non sui nostri due modelli.

### Cosa fare adesso (low-regret, tutto dentro il fork attuale)

1. **Tenere kalsallama.** Il vantaggio che ci dà è la specializzazione (MTP,
   governor termico, checkpoint, salt per dispositivo) — esattamente le aree dove
   MLC è debole.
2. **Monitorare, senza bloccare niente.** Segnali da sorvegliare:
   - l'**upstream merge di Qwen3.6/Qwen4 in MLC** (oggi zero occorrenze nel sorgente);
   - l'**implementazione di MTP** in MLC (oggi zero occorrenze);
   - il **target hexagon** (oggi `USE_HEXAGON_SDK=OFF`);
   - il **fix del bug firma macOS ARM64** (PR #3582);
   - l'**adozione degli artefatti** (Gemma 4 E2B: 369 download in 11 giorni;
     Qwen3.5: ~0 download → oggi nessuna base di utenti).
   - trigger di riconsiderazione: **MLC che supporta Qwen 3.6 35B-A3B + MTP + un
     backend NPU**, *oppure* un benchmark MLC-vs-llama.cpp 2026 su Android che
     mostri il path OpenCL ≥ llama.cpp.
3. **Se si vuole tenere la porta aperta** a costo quasi zero: MLC-LLM è
   **Apache-2.0**, quindi i suoi kernel (in particolare il `fused_dequantize` /
   layout Adreno e il GatedDeltaNet TIR di Qwen3.5) sono **reutilizzabili nel nostro
   fork** senza problemi di licenza. Vale la pena una lettura mirata di
   `python/mlc_llm/model/qwen35/qwen35_model.py` (kernel GatedDeltaNet) se il
   Qwen 3.6 ibrido sul telefono resta il collo di bottiglia.

---

## 11. Appendice — Fonti (tutte lette il 2026-10-22)

**Upstream / primarie**

- Repo e metadati: https://api.github.com/repos/mlc-ai/mlc-llm (23.263★, 359 issue+PR aperti, push 2026-10-06, Apache-2.0)
- Tag: https://api.github.com/repos/mlc-ai/mlc-llm/tags (v0.26.dev0 ultimo; v0.20.0 stabile)
- Commit di tag v0.20.0 (2026-07-07, Ruihang Lai): https://api.github.com/repos/mlc-ai/mlc-llm/commits/bb586e51eb20cba2e82216b75d22d8dd6657cce1
- Commit recenti: https://api.github.com/repos/mlc-ai/mlc-llm/commits (ultimo #3565, 2026-10-06)
- Issue #3492 "POC for qwen3.5 / qwen3.6 support optimized for AGX Orin" (aperta 2026-05-01, agg. 2026-07-27): https://github.com/mlc-ai/mlc-llm/issues/3492
- Issue #3477 "[Model Request] Support Gemma4" (aperta 2026-04-05): https://github.com/mlc-ai/mlc-llm/issues/3477
- Issue #3536 "macOS ARM64 mlc-llm-nightly-cpu pip wheel crashes entire Python process" (aperta 2026-08-21, 0 commenti): https://github.com/mlc-ai/mlc-llm/issues/3536
- Issue #3363 (freeze Adreno layout `_1`, citata nelle doc MLC)
- Issue #1689 (NPU hexagon, aperta dal 2024)
- PR #3582 (fix firma codice macOS, aperto 2026-10-22), #3580 (race softmax), #3579 (LFM2), #3578 (SmolLM3), #3570 (accumulazione fp32)
- Workflow CI: https://api.github.com/repos/mlc-ai/mlc-llm/contents/.github/workflows
- Sorgente `main` @ `8978ea9`: `python/mlc_llm/model/model.py`, `model/gemma4/gemma4_config.py`, `model/qwen35/qwen35_model.py`, `serve/config.py`, `serve/entrypoints/openai_entrypoints.py`, `quantization/quantization.py`, `support/auto_target.py`, `support/auto_weight.py`, `android/mlc4j/prepare_libs.py`, `docs/deploy/rest.rst`, `docs/compilation/configure_quantization.rst`
- Doc pubblica Android: https://llm.mlc.ai/docs/deploy/android.html — **intestata "mlc-llm 0.1.0 documentation", © 2023-2025**
- Doc compilazione (tab target): https://llm.mlc.ai/docs/compilation/compile_models.html
- Artefatti HF: https://huggingface.co/api/models?author=mlc-ai&search=Gemma-4 · https://huggingface.co/api/models?author=mlc-ai&search=Qwen3.5

**Terze (benchmark e analisi)**

- arXiv 2511.05502, "Production-Grade Local LLM Inference on Apple Silicon" (nov. 2025): https://arxiv.org/abs/2511.05502 — MLC ~190 tok/s / P99 ~13 ms; MLX ~230; llama.cpp ~150 short-ctx e ~1,2 tok/s a 32k; MLC migliore su contesti lunghi
- Callstack, "Profiling MLC LLM on Android: OpenCL" (**2026-10-16**): https://www.callstack.com/blog/profiling-mlc-llms-opencl-backend-on-android-performance-insights — freeze `_1` su Adreno, 56 kernel lenti, conferma di Ruihang Lai, workaround `_0`
- TinyBench (fork MLC-LLM), S24 Ultra: https://github.com/conscious-engines/TinyBench/blob/master/mlc-llm/README.md — 10,96 tok/s decode Llama-3.2-3B q4f16_0, GPU 61-63 °C
- Research report Android on-device: https://github.com/eclairsameal/android-on-device-llm-poc/blob/main/docs/research-report.md — throttle termico dopo 6 inferenze, prefill OpenCL 25.128 ms, integrazione "Very Hard", NPU ❌
- Qualcomm, "Harnessing Qualcomm Adreno GPU for Generative AI" (feb. 2025): https://www.qualcomm.com/developer/blog/2025/02/harnessing-qualcomm-adreno-gpu-generative-ai-open-source-approach
- IWOCL 2025, Hongqiang Wang (Qualcomm), MLC vs llama.cpp su Adreno: https://www.iwocl.org/wp-content/uploads/iwocl-2025-hongqiang-wang-lamacpp-backend-update.pdf
- arXiv 2410.03613, "Performance Study on COTS Mobile Devices" (v4): https://arxiv.org/html/2410.03613v4 — tempi di caricamento MLC ~9× llama.cpp su Adreno
- Nota prestazioni mobile (2026-02-09): https://github.com/brentmercado/android-on-device-ai/blob/main/wiki/sources/2026-02-09-xiao-mobile-llm-perf-paper.md — fork Qualcomm 6,8× prefill vs MLC generico
- Ricerca Apple indipendente (2026-09-19): https://github.com/jiazhihao/mpk-apple/blob/main/docs/research/apple-inference-systems.md — "MLC-LLM is in maintenance mode", 262-394 dispatch/token
- Benchmark M5 Max con MTP (2026-06-14): https://github.com/stared/benching-local-llms-on-apple-silicon — Qwen3.6-35B-A3B Q8 llama.cpp+MTP 105 tok/s vs 93 senza
- BaseRT (arXiv 2607.00501, lug. 2026) per il contesto M4 Pro: https://huggingface.co/buckets/huggingchat/papers-content/tree/2607/2607.00501.md

## 12. Cosa NON ho trovato (dichiarato esplicitamente)

- **Nessun benchmark MLC-LLM vs llama.cpp 2026** su Qwen 3.6, Gemma 4 E4B o 12B, su Apple Silicon o Android.
- **Nessun benchmark MLC-LLM vs llama.cpp su Windows x64** con CPU + Vulkan senza NVIDIA.
- **Nessun dato MLC su NPU hexagon**: non esiste nel repo, non esiste benchmark, non esiste issue risolta.
- **Nessun binding Rust ufficiale** per MLC-LLM (solo Python, Swift, Java/JNI, C++/JSON-FFI).
- **Nessun benchmark di adozione/qualità** degli schemi MLC `q4f16_1` vs GGUF `Q4_K_M` a parità di bit: ho solo la specifica tecnica (group 32, int4, scale fp16) e la documentazione MLC, nessuna misura di perplexità su Qwen3.x.
- **Nessun dato sulla latenza/throughput di MLC su M5/M6** (le generazioni più recenti citate nei paper di terzi).
- La data di pubblicazione e il metodo del benchmark `localaimaster.com` (M4 Max, MLC 62 vs llama.cpp 58 tok/s) **non sono verificabili**: non usato come dato.
- **Il conteggio "18 commit in 3 mesi"** conta i merge su `main`; i PR citano commit "cherry-picked from …", quindi una parte dello sviluppo avviene su branch/rami esterni e il conteggio **sottostima** il lavoro effettivo. L'ho dichiarato per non esagerare in nessuna direzione.
