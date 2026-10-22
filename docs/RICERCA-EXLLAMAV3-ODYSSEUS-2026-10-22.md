# Ricerca engine: ExLlamaV3 vs Odysseus

**Data ricerca:** 22 ottobre 2026 · **Autore:** ricercatore web Kalsa Brain · **Contesto:** valutazione sostituzione/affiancamento di `kalsallama` (fork llama.cpp) per app desktop macOS arm64 (Metal) + app telefono Android arm64 (Adreno OpenCL / NPU Snapdragon).

> **Nota metodologica — URL iniziali errati.** L'URL fornito `https://github.com/turboderp/exllamav3` **restituisce 404**: il repository non esiste a quel path. Il repo reale è **`https://github.com/turboderp-org/exllamav3`** (org `turboderp-org`). Per Odysseus, `https://odysseus-dev.github.io/odysseus` esiste ed è la landing page officiale; il repo linkato è `https://github.com/odysseus-dev/odysseus`.
>
> **Metodo:** cloning superficiale di entrambi i repo + analisi sorgente (grep su kernel/backend/modelli), API GitHub (meta, release, commit, issue, discussion), API HuggingFace (artefatti), TabbyAPI clonato, benchmark pubblici (llamaperf, atomic.chat, issue tracker, post community datati). Ogni affermazione di seguito è tracciata a una fonte con data.

---

## 0. Verdetto in una riga

| Progetto | Cos'è davvero | Verdetto per noi |
|---|---|---|
| **ExLlamaV3** | Libreria Python + estensione CUDA/HIP (Triton), **solo GPU NVIDIA/AMD**. Nessun Metal, Vulkan, OpenCL, Android, NPU. | **NO** come motore principale. **SÌ** come motore secondario **solo su Windows x64 + NVIDIA** (dove è oggettivamente superiore a GGUF per qualità/bit e per speculative decoding). |
| **Odysseus** | Workspace AI self-hosted (FastAPI + web UI). **Non è un inference engine**: il suo "Cookbook" compila e lancia **`llama-server` di llama.cpp**, o Ollama / vLLM / SGLang / MLX. | **NESSUN SENSO** come motore. Ha senso solo come *client* verso il nostro server OpenAI-compatible, o come riferimento di design per un model-manager. |

---

# PROGETTO A — ExLlamaV3

Repo: https://github.com/turboderp-org/exllamav3 · Licenza: **MIT** · PyPI: `exllamav3` 1.6.4

## A.1 — Stato oggi (22-10-2026)

| Metrica | Valore | Fonte |
|---|---|---|
| Ultima release | **v1.6.4**, pubblicata **2026-10-20** | GitHub Releases API, `turboderp-org/exllamav3` |
| Ultimo commit | `da68d57` "Bump to v1.6.4", **2026-10-21 01:51 +0200** | clone locale, `git log -1` |
| Ultimo push | **2026-10-22T10:57:38Z** (oggi) | GitHub API `pushed_at` |
| Star / fork / watcher | **1.731 / 265 / 31** | GitHub API, 22-10-2026 |
| Issue | **80 aperti**, **284 totali** | GitHub API + search API, 22-10-2026 |
| Creato | **2025-04-06** | GitHub API |
| Licenza | **MIT** | `LICENSE` nel repo |
| Manutentore | **Turboderp** (autore unico di ExLlama), copyright 2025 | `LICENSE` |
| PyPI | `exllamav3` **1.6.4**, unico artefatto `exllamav3-1.6.4-py3-none-any.whl` | PyPI JSON API |
| Community | Discord ExLlama; issue tracker molto attivo su kernel e ottimizzazioni | README riga 279 |

**Vivo o morto? → Vivo, e in accelerazione.** Nell'ultimo trimestre c'è stato lavoro su ROCm, CPU-MoE offload, MTP, DFlash, `cpu_moe_offload_layers`, `tensor_parallel`, cache quantizzata. Il ritmo di commit è di **decine a settimana**.

**Nota sui rilasci:** non esistono release GitHub *tagged* con allegati binari precompilati per ogni piattaforma — il pacchetto PyTorch/Triton deve essere compilato localmente (vedi A.3).

## A.2 — Cos'è esattamente

- **Libreria Python** (`pip install exllamav3`) con **estensione nativa compilata** (sorgenti C++/CUDA/HIP + kernel **Triton**). `setup.py` compila l'estensione con `CUDA_HOME`, aggiunge `-DWIN32_LEAN_AND_MEAN` su Windows, e seleziona `cublas` (CUDA) o `hipblas` (ROCm) a runtime.
- **Non** è un runtime C++ autonomo né un engine embedded: è un **SDK Python** + un `Generator` asincrono ad alto livello.
- **Struttura interna** (verificata sul clone):
  - `exllamav3/architecture/` — **84 moduli** di architettura (una classe per famiglia di modello).
  - `exllamav3/generator/` — `generator.py`, `job.py`, `pagetable.py`, `cpu_cache.py`, `disk_cache.py`, `draft_confidence.py`, `ngram.py`, `filter/`, `sampler/`.
  - `exllamav3/cache/` — `fp16.py`, `quant.py`, `qsa.py`, `dsa.py`, `mla.py`, `recurrent.py` (cache KV quantizzati).
  - `exllamav3/conversion/` — il quantizzatore EXL3.
- **Binding:** **solo Python**. Nessun binding Rust / Kotlin / Swift / JS ufficiale. Esiste un plugin Transformers (`examples/transformers_integration.py`).
- **Naturaleza della community:** ~1,7k star, 284 issue, Discord; l'attività è concentrata su kernel e ottimizzazioni di throughput. È un progetto di un singolo autore con una community di nicchia tecnica.

## A.3 — Matrice piattaforme / backend (LA TABELLA ELIMINATORIA)

Metodo: grep su **tutto il sorgente** del clone (esclusi `vendor/` e i corpus di calibrazione). I token `metal`/`mps`/`android`/`ios` che compaiono nel sorgente sono **rumore** (parole inglesi dentro file di testo di calibrazione: `various`, `prompts`, `attempts`). Nessun supporto reale.

| Backend / Piattaforma | ExLlamaV3 | Prova (grep sul sorgente, 22-10-2026) |
|---|---|---|
| **CUDA** (NVIDIA, 12.4→13.2) | ✅ **Sì** | 2.350 occorrenze `cuda`; `setup.py` compila con `nvcc`; `torch>=2.6.0` con extra `cu124/cu126/cu128/cu129/cu130/cu132` (PyPI) |
| **ROCm / HIP** (AMD) | ✅ **Sì** (in via di maturazione) | 906 occorrenze `hip`; `setup.py` seleziona `hipblas`; `util/cuda_flags.py` con `use_rocm_sdk_devel()` |
| **Triton kernels** | ✅ | 337 occorrenze; `triton-windows` è dipendenza dichiarata su Windows (`pyproject.toml:31`) |
| **CPU** (AVX2 / AVX512) | ⚠️ **Solo offload** | `cpu_offload` (47), `cpu_moe_offload_layers` in TabbyAPI; **non** un backend CPU a sé stante per inferenza completa |
| **Windows x64** | ✅ **Sì** (richiede `triton-windows` + VS Build Tools + CUDA toolkit) | README righe 40 e 101: *"The PyPI package does not contain a prebuilt extension and requires the CUDA toolkit and build prerequisites (i.e. VS Build Tools on Windows…)"*; *"ExLlamaV3 does not import without it [triton-windows]"* |
| **Vulkan** | ❌ **No** | **0 occorrenze** di `vulkan` / `Vulkan` / `VulkanBackend` in tutto il sorgente |
| **Metal / MPS (macOS)** | ❌ **No** | **0 occorrenze reali**; `mps`/`MPS` presenti solo come sottostringhe (`prompts`, `attempts`) |
| **OpenCL** | ❌ **No** | **0 occorrenze** di `opencl`/`OpenCL` |
| **Android arm64** | ❌ **No** | Nessuna occorrenza reale; nessun target di build; l'estensione richiede `nvcc` |
| **iOS** | ❌ **No** | idem |
| **NPU (Snapdragon/Hexagon, NNAPI, QNN)** | ❌ **No** | **0 occorrenze** di `hexagon`, `nnapi`, `qnn` |
| **Tensor parallel multi-GPU** | ⚠️ Parziale | `tensor_parallel` in TabbyAPI; kernel `TensorParallel` presente |

> **Punto eliminatorio, secco:** ExLlamaV3 **non copre macOS Metal** e **non copre Android**. Copre solo Windows/Linux + NVIDIA/AMD. Poiché il nostro requisito è *macOS arm64 (Metal) + Android arm64 (Adreno OpenCL / NPU)*, **ExLlamaV3 da solo taglia 2 delle 3 piattaforme richieste**.
>
> **Vincolo ulteriore, spesso ignorato:** l'unico wheel PyPI è `py3-none-any.whl` — **pure Python, nessuna estensione precompilata**. Ogni installazione richiede compilazione locale con CUDA toolkit (`nvcc`), Ninja, VS Build Tools. Su Android è doppio impossibile (no CUDA, e servirebbe una NDK build custom).

### Esiste un port Metal di terze parti?

Sì, **ma è un'area grigia non ufficiale**, e va trattata come rischio, non come piano:

| Progetto | Star | Ultimo push | Note |
|---|---|---|---|
| `beamivalice/PonyExl3` | 58 | 2026-08-24 | "Convert and Run Exl3 format LLM quant on Apple Silicon" — è il port citato dai post community |
| `publicExcess/ijah` | 6 | 2026-10-19 | "Raw-Metal inference engine for Qwen3.8-Flash-Next on Apple M5: EXL3 weights, MTP, OpenAI + Anthropic APIs" |
| `0xZKnw/mlxl3` | 8 | 2026-10-22 | "Native EXL3 inference engine for macOS and Apple Silicon. Rust, MLX and Metal runtime, SwiftUI app + CLI" |
| `muyouming/exl3-server` | 0 | 2026-10-10 | Motore C++ MLX + server OpenAI-compatible |
| `daig/omlx-exl3` | 2 | 2026-10-08 | EXL3 su Apple Silicon via oMLX |
| `Infatoshi/exllama-ish` | 5 | 2026-01-06 | Port Apple Silicon (gennaio, fermo) |

Fonte: GitHub Search API, 22-10-2026. **Nessuno di questi è ufficiale, nessuno ha trazione** (≤58 star). Un dato interessante: un post X datato (Yume_X, ott 2026) dichiara per `PonyExl3` **Qwen3.6-35B-A3B EXL3 4.0 bpw a 68,5 tok/s su M5 Max vs 52 tok/s su RTX 4090, stessi pesi**. È una misura da singolo utente su una porta non ufficiale: **non trattarla come benchmark** (fonte: https://x.com/yume_arasaki/status/2102395182184534404).

## A.4 — Copertura modelli

Tabella di supporto architetture dal README (righe 200-233) + `exllamav3/architecture/architectures.py`.

| Nostro modello | EXL3 | Prova |
|---|---|---|
| **Qwen 3.6 35B-A3B** (MoE, attenzione ibrida) | ✅ **Sì** (via famiglia Qwen3.5) | **Non elencato nella tabella README** (che elenca Qwen 3, 3-Next, 3-VL, 3-VL MoE, 3.5, 3.5 MoE, 3.8-Flash-Next). Gestito da `Qwen3_5MoeModel` / `Qwen3_5VLMoeModel` (`architectures.py:54,129-132`). Conferme: artefatto ufficiale `turboderp/Qwen3.6-27B-exl3` su HF; `doc/env_vars.md:402` cita *"issue trace on Qwen3.6-35B-A3B"*; artefatti community `yeasah/Qwen3.6-35B-A3B-exl3` (284 download), `UnstableLlama/Qwen3.6-35B-A3B-exl3-4.00bpw` |
| **Gemma 4 E4B** | ❌ **No** | **README riga 201, verbatim: `Gemma 4 \| Gemma4ForConditionalGeneration, Gemma4UnifiedForConditionalGeneration \| ✓ \| E2B/E4B unsupported`**. Esistono `turboderp/gemma-4-12B-it-exl3`, `gemma-4-26B-A4B-it-exl3`, `gemma-4-31b-it-exl3` — ma **E2B/E4B no** |
| **Gemma 4 12B** | ✅ Sì | `turboderp/gemma-4-12B-it-exl3` (HF) |
| **Gemma 3** | ✅ Sì | `gemma3.py`, `turboderp/gemma-3-27b-it-exl3` |
| **Visione (mmproj)** | ✅ Sì | Moduli `qwen3_vl.py`, `qwen3_vl_moe.py`, `qwen3_5.py` (varianti VL), `gemma3.py`, `gemma4.py`, `glm4v.py`, `lfm2_vl.py`, `mimo_v2_vision.py`, `deepseek_v4_vision.py`, `hcxvisionv2.py`; `exllamav3/architecture/mm_processing/` |
| **Decodifica speculativa MTP** | ✅ **Sì** | `qwen3_5_mtp.py`, `qwen4_exp_mtp.py`, `deepseek_v4_mtp.py`, `glm4_moe_lite_mtp.py`, `glm5_next_mtp.py`, `glm_moe_dsa_mtp.py`, `hy_v3_mtp.py`, `mimo_v2_mtp.py`, `nemotronh_mtp.py`, `bailing_hybrid_mtp.py`. Nel `Generator`: `mtp_depths`, `caps["mtp_draft"]`, `num_draft_tokens`. Artefatti: `turboderp/Qwen3.6-27B-MTP-exl3` |
| **Decodifica speculativa EAGLE** | ❌ **No** (nativo) | Nessun modulo EAGLE. Gli unici match `eagle*` sono in `dflash_laguna.py` (`eagle_aux_hidden_state_layer_ids`, usato per **validare** i punti di cattura vLLM), non per decodificare EAGLE |
| **DFlash / DFlash2** (drafter esterno) | ✅ Sì | `dflash.py`, `dflash2.py`, `dflash_laguna.py`; artefatti `turboderp/Qwen3.6-27B-DFlash-exl3` |
| **Prompt-lookup / n-gram drafting** | ✅ Sì | `ngram.py`, `ngram_match_min`, `ngram_corpus`; `draft_confidence.py` |

**Verdetto modelli:** copertura **eccellente su Qwen 3.x** e **sufficiente su Gemma 4**, con **un buco secco sul nostro Gemma 4 E4B**. Copertura speculativa ottima (MTP + DFlash), EAGLE assente.

## A.5 — Quantizzazione: EXL3

**Formato:** EXL3 è una derivazione di QTIP (Cornell RelaxML) a **trellis**: i pesi non sono arrotondati indipendentemente ma codificati come percorso in un codebook vincolato, con errore distribuito su più dimensioni via trasformata di Hadamard. Documentato in `doc/convert.md`; il quantizzatore calcola le Hessian "on the fly" con kernel Viterbi fuso → **conversione in un solo passo**.

### Qualità a parità di bit vs GGUF

Misura primaria pubblica: **atomic.chat, "EXL3 vs GGUF: Quality, Speed and VRAM"**, RTX 5090, ExLlamaV3 1.4.9 + TabbyAPI `de76ff88`, Ubuntu 24.04.3, CUDA 12.8, PyTorch 2.8.0+cu128 (https://atomic.chat/blog/guides/exl3-vs-gguf):

| Configurazione | bpw | Pesi | PPL | Mean KLD |
|---|---|---|---|---|
| BF16 (riferimento) | 16.000 | 22,18 GiB | 1.2598 | — |
| **EXL3 3.00 bpw** | 3.006 | 4,52 GiB | 1.3874 | 0.09399 |
| **EXL3 4.00 bpw** | 4.006 | **5,79 GiB** | **1.2908** | **0.02479** |
| **GGUF Q4_K_M** | 4.798 | 6,62 GiB | 1.3064 | 0.03985 |

**EXL3 4.00 bpw batte GGUF Q4_K_M sia in qualità (KLD 0,0248 vs 0,0398 → ~38% meno drift) sia in dimensione (5,79 vs 6,62 GiB di pesi).** Conferma indipendente su modello diverso (MiniCPM5-2B, HF `ewin-reg/MiniCPM5-2B-EXL3-Quantized`): EXL3 4.0 bpw ~0,010 KLD / ~95,8% same-top-1, contro GGUF Q4_K_M / NVFP4 ~0,030 / ~93,2%.

**Controindicazione onesta:** a **decode** llama.cpp era più veloce nei confronti a file dimensione-equivalente: **Q5_K_M 130,1 tok/s vs EXL3 4.00 bpw 113,1 tok/s; Q6_K 117,4 vs EXL3 5.00 bpw 98,8**. EXL3 vince invece nettamente in **prefill** (fino a 2,5× più veloce: 4.077 tok/s a 2.048 token di input) e in qualità/bit. In sintesi: **EXL3 = qualità per bit e prefill; llama.cpp = decode e portabilità.**

### Costi di conversione e distribuzione artifact

- **Costo di conversione:** da checkpoint HF a EXL3 in **un solo passo**, "a couple of minutes for smaller models, up to a few hours for larger ones (70B+) (on a single RTX 4090 or equivalent GPU)" (fonte: https://github.com/carpedm20/exllamav3, README spec). Serve GPU NVIDIA (CUBLAS/Triton). **Il server CUDA è quindi un prerequisito di build, non solo di runtime.**
- **Distribuzione artifact:** HuggingFace, formato `turboderp/<modello>-exl3`. Il repo `turboderp` ha **156 modelli**; i modelli con tag `exl3` su HF sono **>1.000** (query `filter=exl3`, limite API 1.000). Riferimenti per la nostra flotta:
  - `turboderp/Qwen3.6-27B-exl3`, `turboderp/Qwen3.6-27B-exl3_3.30bpw`, `turboderp/Qwen3.6-27B-MTP-exl3`, `turboderp/Qwen3.6-27B-DFlash-exl3`
  - `turboderp/Qwen3.5-35B-A3B-exl3`, `turboderp/Qwen3.5-122B-A10B-exl3`, `turboderp/Qwen3.5-9B-exl3`
  - `turboderp/gemma-4-12B-it-exl3`, `turboderp/gemma-4-26B-A4B-it-exl3`, `turboderp/gemma-4-31b-it-exl3`
  - **Nessun `gemma-4-E4B-exl3`** — coerente con il gap E2B/E4B.
- **Nota di lock-in:** `gguf` è una dipendenza **solo dell'extra `eval`**: a runtime EXL3 non legge GGUF. Passare a EXL3 = abbandonare l'ecosistema GGUF (Ollama, LM Studio, llama.cpp, MLX, LM Studio, tutti i quant pubblici).

## A.6 — Serving

ExLlamaV3 **non include un server**. Il README (riga 17) dice: *"TabbyAPI is the official and recommended backend server. It provides an OpenAI-compatible API… HF model downloading, embedding model support, and HF Jinja2 chat templates."*

**TabbyAPI** — https://github.com/theroyallab/tabbyAPI · AGPL-3.0 · 1.487 star / 220 fork · ultimo push **2026-10-21T18:37:25Z** · Python.

| Nostro requisito di serving | EXL3 + TabbyAPI | Prova |
|---|---|---|
| **Server HTTP OpenAI-compatible** | ✅ | README TabbyAPI riga 75: "OpenAI compatible API" |
| **Streaming SSE** | ✅ | TabbyAPI espone streaming; il `Generator` di EXL3 è asincrono (`async_generator.py`, `job.py`) |
| **Multi-slot** | ✅ | `total_slots` (`endpoints/core/types/model.py:356`), `max_batch_size` (`model.py:260,594`), continuous batching nel `Generator` (`num_active_jobs`) |
| **Prompt caching** | ✅ | KV paging con **content-hash chaining** (`generator/pagetable.py`) → riuso del prefisso per hash, non per posizione |
| **Cache su più tier (GPU → CPU pinned → disco)** | ✅ | `generator/cpu_cache.py` (tier CPU pinnato), `generator/disk_cache.py` (tier disco, `flush_cache_to_disk`), `disk_cache_dir` in `model_init.py:124` |
| **Save/restore dello slot su disco con checkpoint del contesto** | ✅ **Forte** | `disk_cache.py` espone `flush_cache_to_disk()` e `mp_disk_state_write`/`read`; `recurrent_checkpoint` per modelli ricorrenti; il checkpoint del contesto è la stessa meccanica di tiering |
| **Isolamento cache per dispositivo** | ⚠️ **Da costruire, non nativo** | `disk_cache_dir` è un **singolo path** condiviso fra modelli/configurazioni, con budget in byte globale (`generator.py:172`). Le pagine sono **keyed per content-hash**: se due dispositivi condividono la stessa root, i prompt identici deduplicano. L'isolamento si ottiene **dando a ogni dispositivo un `disk_cache_dir` distinto e un processo distinto** (TabbyAPI è già un processo per GPU). Non esiste un namespace per-device built-in |
| **Embeddings / multimodalità nel server** | ✅ | TabbyAPI: supporto embeddings; `backends/exllamav3/vision.py` con `image_embedding_cache` per il path EXL3 |
| **GPU pooling multi-GPU NVIDIA** | ⚠️ | TabbyAPI ha un path GPU pooling; non verificato in dettaglio (che il limiti: **richiede CUDA**) |

## A.7 — Performance

**llamaperf.com/engine/exllamav3** (aggregatore di report community, 22-10-2026): **17 report** ExLlamaV3, con caveat onesto della pagina stessa: *"llamaperf has no matched comparison for ExLlamaV3 yet: no card has plain runs of the same model size at the same bit class on ExLlamaV3 and on another engine"*. **Cioè: non esiste un confronto appaiato EXL3-vs-altro.**

| GPU | Modello / quant | Velocità | Note |
|---|---|---|---|
| RTX 3090 (24GB) | Qwen3.8 27B · exl3-5.00bpw | **60,0 t/s** | run pulito |
| RTX 3090 | Qwen3.8 27B · EXL3-4.00bpw | **162,9 t/s** | *speculative* |
| RTX 3090 | GLM-5.3 320B (18B attivi) · exl3-3.05bpw | 28,6 t/s | parte in RAM di sistema |
| RTX 4090 (24GB) | Qwen3.8 27B · EXL3 4.00bpw | **35,9 t/s** | run pulito, tabella mediana |
| RTX 4090 | Qwen3.8 125B (6B attivi) · 4.05bpw | 33,6 t/s | 1.944 t/s prefill, parte in RAM |
| RTX 5090 (32GB) ×2 | Qwen3.8 125B · 2.50bpw EXL3 | **291,1 t/s** | 2 carte, speculative |
| RTX 5090 ×2 | GLM-5.3 320B · 2.05bpw EXL3 | 64,8 t/s | 1.973 t/s prefill, speculative |
| RX 7900 XTX | Qwen3.8 27B · EXL3 3.5bpw | 157,0 t/s | speculative — **segnale che ROCm è già produttivo** |
| Radeon AI PRO R9700 32GB | Qwen3.8 125B · exl3-5.05bpw | 34,7 t/s | speculative |
| DGX Spark 128GB | Qwen3.8 27B · EXL3 3.5bpw | 47,5 t/s | speculative |

Benchmark RX 5090 (atomic.chat, medie su 5 run dopo warm-up, 2.048 token in / 512 out):

| Config | Prefill (mediana) | TTFT | Decode (mediana) |
|---|---|---|---|
| EXL3 3.00 bpw | 4.471 tok/s | 0,46 s | **119,2 tok/s** |
| EXL3 4.00 bpw | 4.077 tok/s | 0,50 s | **113,1 tok/s** |
| EXL3 5.00 bpw | 3.845 tok/s | 0,53 s | 98,8 tok/s |

**Windows NVIDIA — la lacuna onesta:** **non ho trovato un benchmark primario, datato e riproducibile di EXL3 su Windows nativo con GPU NVIDIA.** Quello che esiste:
- EXL3 **su Windows è supportato ufficialmente** (`triton-windows` in `pyproject.toml`, `setup.py` con flag `WIN32_LEAN_AND_MEAN`/`NOMINMAX`/`/Zc:preprocess`, README riga 101).
- `mw00/project-maya` (engine *compatibile* EXL3, **non** exllamav3) ha numeri **Windows 11**: RTX 5090 32GB @ 128K → 23,0 tok/s / 2.173 tok/s prefill; RTX 4090 24GB @ 128K → 16,4 tok/s / 1.371 tok/s; RTX 5090 Laptop 24GB → 14,5 tok/s; Radeon 8065S (Ryzen AI Max+ PRO 495) → 29,6 tok/s. Questi numeri **non sono** EXL3-upstream.
- Community (X, ott 2026): RTX 4090, Qwen3.8-27B EXL3 3.5bpw + DFlash2 → 129-174 tok/s a contesto corto, 93-105 tok/s sustained longform, contro ~37 tok/s del Q4_K_M su llama.cpp stessa card (misura su una sola 4090, autodeclarata, **piattaforma non dichiarata**).
- `BBQ2077/exl3-windows-gfx1201` — build EXL3 per AMD RX 9070 su Windows nativo, senza WSL: segnale che il supporto Windows si sta estendendo anche fuori NVIDIA.

**Benchmark su Apple Silicon:** nessuno ufficiale upstream (impossibile: niente Metal). Solo le porte di terze parti citate in A.3.

## A.8 — Costo di migrazione per noi

| Cosa perderemmo | Gravità | Dettaglio |
|---|---|---|
| **Tutti i backend non-NVIDIA/AMD** | 🔴 **Bloccante** | 0 righe di codice Metal, Vulkan, OpenCL, NNAPI/Hexagon. Metal e Vulkan andrebbero implementati da zero (i kernel Triton non sono portabili così com'è: richiederebbero MLX/Metal custom, come fanno i port di terze parti) |
| **Android on-device** | 🔴 **Bloccante** | L'estensione richiede `nvcc` + Triton + PyTorch. Su Android servirebbe: build NDK custom, Triton→Triton-Android (non esistente), PyTorch Mobile, e un runtime Python/CPython o un binding C. **Anni di lavoro, non mesi.** |
| **Ecosistema GGUF** | 🟠 Alto | Perderemmo Q4_K_M/Q8_0, l'intero catalogo pubblico GGUF, Ollama/LM Studio/MLX/llama.cpp come consumatori dei nostri stessi pesi. I pesi EXL3 sono un formato **proprietario di toolchain** (non GGUF): due binari, non uno |
| **Gemma 4 E4B** | 🟠 Alto | Non supportato da EXL3.Quel modello dovrebbe restare su GGUF/llama.cpp → **doppio stack** |
| **Wheel precompilate** | 🟠 Alto | `py3-none-any.whl`: ogni utente Windows deve compilare con CUDA toolkit + VS Build Tools. Per un'app desktop shipped, questo è un costo di supporto non sostenibile |
| **Catalogo vision/mmproj** | 🟡 Medio | EXL3 supporta la visione per le architetture elencate, ma i proiettori (`mmproj`) sono **specifici per formato**: andrebbero riconvertiti per Qwen3-VL/Gemma4 |
| **Multi-slot + caching + checkpoint su disco** | 🟢 **Guadagno netto** | EXL3+TabbyAPI è **più maturo** del nostro fork su questo punto: KV paging con content-hash, tier GPU→CPU→disco, `flush_cache_to_disk`, checkpoint del contesto |
| **Decodifica speculativa** | 🟢 **Guadagno netto** | MTP + DFlash + prompt-lookup sono più maturi e misurabili; benchmark 162,9 t/s speculativo vs 60,0 t/s pulito sullo stesso RTX 3090 |
| **Isolamento cache per dispositivo** | 🟡 Medio | Oggi lo facciamo con header privati nel fork. In EXL3/TabbyAPI l'isolamento è per directory + processo, non un meccanismo nativo: da reimplementare |

---

# PROGETTO B — Odysseus

Landing: https://odysseus-dev.github.io/odysseus · Repo: https://github.com/odysseus-dev/odysseus

## B.1 — Stato oggi (22-10-2026)

| Metrica | Valore | Fonte |
|---|---|---|
| Creato | **2026-05-31** (≈4,7 mesi fa) | GitHub API |
| Ultimo push | **2026-10-22T10:25:58Z** (oggi) | GitHub API |
| HEAD | `a98013d` "Merge pull request #6785 from RaresKeY/fix/emudhra-ca-trust", **2026-10-22 11:18 +0100** | clone locale |
| Versione interna | **HARNESS_VERSION 0.20.19** | file `HARNESS_VERSION` |
| Star / fork / watcher | **94.202 / 1.722 / 510** | GitHub API, 22-10-2026 |
| Issue | **1.491 aperti**, **2.358 totali** | GitHub API + search API |
| Commit ultimi 90 giorni | **>632** (header `Link ... rel="last"` → pagina 632 con `per_page=1`) | GitHub API commits `since=2026-07-24` |
| Release GitHub / tag | **Nessuna** | `releases` e `tags` API vuoti — distribuzione via immagine Docker con tag tipo `1.0.2-7c8070f` (dal README) |
| Licenza | **AGPL-3.0** | GitHub API |
| Lingua | Python | GitHub API |
| Issue #6798 | creata **2026-10-22T10:22:56Z** — ~1 ora prima della nostra ricerca | GitHub API |

**Vivo o morto? → Vivissimo.** Commit **orari**, issue aperte **nel minuto**. Nota bene: il numero issue **#6798** non significa 6.798 issue — i PR consumano numerazione; le issue totali sono **2.358**.

**Dimensione della community:** numeri atipici per un progetto di 4,7 mesi (94k star, 510 watcher). La landing page e la struttura del repo (Issue tracker pubblico con triage costante, `HARNESS_VERSION`, `THIRD_PARTY_PROVENANCE.json`, `THREAT_MODEL.md`, `ACKNOWLEDGMENTS.md`, `docs/maintainers/`) indicano un progetto **organizzato in modo professionale**, non un hobby. Il `ROADMAP.md` è onesto: *"it works great for me (lol), but this ship is moving fast and feedback/help would be appreciated! (I don't know what I'm doing, help)"*.

## B.2 — Cos'è esattamente — LA SCOPERTA CHIAVE

**Odysseus non è un inference engine. Non implementa inferenza.** È un **workspace AI self-hosted**: applicazione web (FastAPI + frontend) con chat, agenti, memoria/RAG, email (IMAP/SMTP), calendario (CalDAV), contatti (CardDAV), note, skills, ricerca (SearXNG), MCP server, TTS/STT, galleria, research.

**Prova diretta:** nel sorgente, `routes/cookbook_helpers.py` genera **comandi di build e avvio di `llama-server` di llama.cpp**:

- riga 993: `cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_HIP=ON && cmake --build build -j"$NPROC" --target llama-server && ln -sf ~/llama.cpp/build/bin/llama-server ~/bin/llama-server`
- riga 1012: `... -DGGML_CUDA=ON ... --target llama-server`
- riga 1022: `... -DGGML_VULKAN=ON ... --target llama-server`

E i provider supportati (dal grep su keyword, con conteggio dei file che li menzionano):

| Backend orchestrato | File che lo menzionano | Ruolo |
|---|---|---|
| **llama.cpp** (`llama-server`) | 73 (`llama.cpp`), 25 (`llamacpp`), 17 (`llama_cpp`) | **Il motore predefinito del "Cookbook"** |
| **Ollama** | 74 | Provider alternativo |
| **vLLM** | 53 | Provider (su Windows: WSL2) |
| **SGLang** | 29 | Provider (Windows: WSL2; su macOS: non supportato) |
| **MLX** | 43 | Solo Apple Silicon (Metal) |
| **EXL3 / ExLlamaV3** | **0** | ❌ **Nessun riferimento in tutto il repo** |
| **TabbyAPI** | **0** | ❌ Nessun riferimento |

**Conseguenza diretta:** se il "Cookbook" di Odysseus ci interessa, il motore che esegue è **llama.cpp** — cioè *esattamente la base del nostro fork `kalsallama`*, non un'alternativa.

**Tecnologia:** Python + FastAPI (`app.py`, ~50 router), frontend web in `frontend/` + `static/`, `Dockerfile` + `docker-compose.yml` + `.gpu-amd.yml` + `.gpu-nvidia.yml`, `Odysseus.spec` (PyInstaller), `build-macos-app.sh` (app macOS), `launch-windows.ps1` + `build-windows-portable.ps1` (Windows), `companion/` (client phone), `swift/` (ponte MLX per la build macOS), `mcp_servers/`, `integrations/`.

**Il "companion" non è un motore mobile:** `companion/README.md` descrive un **client di pairing** che si collega a un server Odysseus su desktop. L'inferenza resta **lato server**. Non esistono directory `android/`, `ios/` o `mobile/` nel repo (verificato con `find`).

## B.3 — Matrice piattaforme

| Piattaforma | Odysseus (l'app) | Il motore che Odysseus orchestra |
|---|---|---|
| **Linux x64** | ✅ nativo + Docker | llama.cpp (CUDA/ROCm/Vulkan/CPU), Ollama, vLLM, SGLang |
| **Linux arm64** | ✅ Docker multi-arch (`linux/amd64` + `linux/arm64`, `.github/workflows/docker-publish.yml`) | idem |
| **macOS arm64 (Apple Silicon)** | ✅ **nativo** (Metal — Docker **non** può usare la GPU Apple, motivo della build nativa) | llama.cpp Metal, MLX; Ollama |
| **Windows x64** | ✅ nativo (`launch-windows.ps1`, `build-windows-portable.ps1`) + Docker (WSL2 per GPU) | llama.cpp CUDA; Ollama; vLLM/SGLang via WSL2; **Vulkan: build disponibile** (riga 1022) |
| **Windows + Vulkan** | ⚠️ Il build `GGML_VULKAN=ON` esiste nel Cookbook, ma è un path Linux (`~/llama.cpp`) | llama.cpp Vulkan — *copre il nostro requisito Windows Vulkan, ma è llama.cpp, non Odysseus* |
| **Android arm64** | ❌ **Nessuna app nativa**. Solo `companion/` = client di pairing → l'inferenza resta sul server | — |
| **Android OpenCL (Adreno)** | ❌ Nessun percorso | llama.cpp su Android non è orchestrato da Odysseus |
| **Android NPU (Hexagon/QNN)** | ❌ Nessun percorso | — |
| **iOS** | ❌ Nessuna app nativa | — |
| **Docker arm64** | ✅ | — |

**Punto chiave:** Odysseus, *come motore*, non ha una riga di supporto mobile on-device. Il nostro requisito Android è **totalmente non coperto**.

## B.4 — Copertura modelli e formati

| Aspetto | Odysseus |
|---|---|
| **Formato principale** | **GGUF** (via llama.cpp) — 40 file citano `GGUF` |
| **Formato vLLM** | **safetensors** / AWQ / FP8 (28 file citano `safetensors`) |
| **Formato Apple** | **MLX** (43 file) |
| **Formato EXL3** | ❌ Nessun supporto (0 riferimenti) |
| **Catalogo** | Recuperato a runtime da HuggingFace. `services/hwfit/data/hf_models.json` e `mlx_community_models.json` sono **`[]` (3 byte)** — catalogo **non baked-in** |
| **Dimensione catalogo** | La landing page dichiara "270+ catalogued models" con one-click serving — ma c'è un issue aperto: **#6779, 2026-10-20, "Cookbook on Apple Silicon only recommends small models since the catalog was emptied"** → **regressione attiva** |
| **Visione / mmproj** | ✅ Via llama.cpp (il path `specs/model-providers/llama-cpp.md` e il ranking del Cookbook citano esplicitamente *"vision/mmproj requirements"* come criterio di selezione) |
| **Decodifica speculativa** | ✅ ereditata da llama.cpp (MTP/DFlash nativi in llama.cpp) |
| **Provider "local-compatible-engines"** | `specs/model-providers/local-compatible-engines.md` — permette puntare a **qualsiasi** server OpenAI-compatible. **Questo include il nostro endpoint** |

## B.5 — Serving

| Nostro requisito | Odysseus | Verdetto |
|---|---|---|
| Server HTTP **OpenAI-compatible** (noi dobbiamo esporlo) | ❌ **Odysseus NON espone un inbound `/v1/chat/completions`**. Tutte le sue route sono sotto il proprio schema (`/models`, `/model-endpoints`, `/cookbook`, `/chat`, …). Le uniche superfici `/v1/*` sono in script accessori: `scripts/diffusion_server.py` (`/v1/models`, `/v1/images/generations`, `/v1/images/edits`, `/v1/images/inpaint`, `/v1/images/harmonize`) e `scripts/mlx_image_server.py` (`/v1/models`, `/v1/images/*`) — **server di immagini, non di chat** | ❌ **Ruolo invertito** |
| Streaming SSE | ✅ verso i provider (client) | n/a |
| Multi-slot | ✅ ereditato da llama.cpp / provider | n/a |
| Prompt caching | ✅ ereditato da llama.cpp | n/a |
| **Essere un CLIENT del nostro server OAI-compatible** | ✅ **Sì, e questo è il suo uso reale** — via provider `local-compatible-engines` e endpoint `model-endpoints` con probe automatico (`/model-endpoints/probe-local`, `/model-endpoints/{id}/probe`) | ✅ **Utilizzabile** |

## B.6 — Performance

**Non applicabile**: Odysseus non esegue inferenza, quindi non ha benchmark propri. Le prestazioni sono **quelle di llama.cpp / Ollama / vLLM / SGLang / MLX** che essa orchestra — cioè, per la nostra flotta, **le stesse di oggi con `kalsallama`** (o migliori, se passiamo a un build llama.cpp più recente).

## B.7 — Costo di migrazione per noi

| Aspetto | Costo |
|---|---|
| Come **motore** | 🔴 **Non applicabile** — non è un motore. Migrazione impossibile per definizione. |
| Come **client** del nostro server | 🟡 **Moderato**: AGPL-3.0 (obbligo di licenza se modifichiamo/ridistribuiamo), Docker pesante, 2.358 issue e un ritmo di cambiamento incompatibile con una base di codice di prodotto stabile. Ha senso come *riferimento* di UX/funzionalità (Cookbook, model manager, pairing) |
| Come **riferimento di design** | 🟢 **Utile**: il pattern "model manager che detecta l'hardware, scarica il modello adatto, avvia il backend con i flag giusti" (`services/hwfit/`, `routes/cookbook_helpers.py`) è esattamente il tipo di orchestrazione che potremmo voler nel nostro desktop — **ma implementato sopra llama.cpp, che già abbiamo** |

---

# CONFRONTO DIRETTO CONTRO I NOSTRI REQUISITI

| # | Nostro requisito | ExLlamaV3 | Odysseus |
|---|---|---|---|
| 1 | **macOS arm64 (Metal)** | ❌ **Assente** (0 supporto Metal upstream) | ⚠️ L'app gira su macOS e orchestra llama.cpp-Metal/MLX — ma è un *client*, non un motore |
| 2 | **Windows x64 (CPU + Vulkan; NVIDIA non garantita)** | ⚠️ **Solo NVIDIA** (CUDA); **Vulkan assente**; CPU solo per offload MoE | ⚠️ Il backend llama.cpp che orchestra sa fare Vulkan (build `-DGGML_VULKAN=ON`), ma è llama.cpp, non Odysseus |
| 3 | **Android arm64 (Adreno OpenCL, NPU Hexagon), engine DENTRO l'app** | ❌ **Assente** (0 OpenCL, 0 NNAPI/Hexagon; richiede `nvcc`+Triton) | ❌ **Assente** (nessuna app mobile; solo companion di pairing) |
| 4 | **iOS (futuro)** | ❌ Assente | ❌ Assente |
| 5 | **Qwen 3.6 35B-A3B (MoE, attenzione ibrida)** | ✅ Via `Qwen3_5MoeModel`; artefatti `turboderp/Qwen3.6-27B-exl3` | ✅ Tramite llama.cpp/GGUF |
| 6 | **Gemma 4 E4B** | ❌ **Esplicitamente non supportato** ("E2B/E4B unsupported", README r.201) | ✅ Via llama.cpp/GGUF |
| 7 | **Gemma 4 12B (SWA)** | ✅ `gemma-4-12B-it-exl3` | ✅ |
| 8 | **Quantizzazione Q4_K_M / Q8_0** | ❌ Formato diverso (EXL3); GGUF solo per l'extra `eval` | ✅ Nativo (GGUF) |
| 9 | **Drafter MTP** | ✅ `qwen3_5_mtp.py`, `qwen4_exp_mtp.py`, … + `mtp_depths` nel Generator | ✅ Tramite llama.cpp |
| 10 | **Proiettore visione mmproj** | ✅ Nella famiglia di architetture; `mm_processing/` | ✅ Tramite llama.cpp |
| 11 | **Server OAI-compatible + SSE** | ✅ TabbyAPI | ❌ Non lo espone (è client) |
| 12 | **Multi-slot** | ✅ `total_slots` / `max_batch_size` | ✅ Ereditato |
| 13 | **Prompt caching** | ✅ KV paging con content-hash | ✅ Ereditato |
| 14 | **Isolamento cache per dispositivo** | ⚠️ Da implementare (dir distinta + processo) | n/a |
| 15 | **Save/restore slot su disco + checkpoint contesto** | ✅ `disk_cache.py`, `flush_cache_to_disk`, `mp_disk_state_*`, `recurrent_checkpoint` | ✅ Ereditato da llama.cpp |

---

# VERDETTO FINALE

## ExLlamaV3

- **Come motore principale per noi: ❌ NO.** Non copre **macOS Metal** né **Android** (OpenCL/NPU) — 2 delle 3 piattaforme obbligatorie. Non esistono backend Metal/Vulkan/OpenCL nel sorgente (0 occorrenze). Inoltre **non supporta Gemma 4 E4B**, che è nella nostra flotta. Il pacchetto richiede una compilazione CUDA locale: incompatibile con la distribuzione su app mobile.
- **Come motore secondario su una sola piattaforma: ✅ SÌ, su Windows x64 + NVIDIA.** È lì che EXL3 è oggettivamente superiore al GGUF: **qualità per bit migliore** (KLD 0,0248 vs 0,0398 a parità di peso; ~38% meno drift), **prefill fino a 2,5× più veloce**, e soprattutto **decodifica speculativa matura** (MTP + DFlash + prompt-lookup) con multi-slot, KV paging su 3 tier e **checkpoint del contesto su disco** — funzionalità che nel nostro fork sono state costruite a mano. Misure RTX 3090: 60,0 t/s pulito vs 162,9 t/s speculativo sullo stesso modello/quant.
  - **Costo realistico:** un **secondo backend** (TabbyAPI/exllamav3) da installare e mantenere **accanto** a `kalsallama`, con un **secondo formato di pesi** (EXL3) e un toolchain di build CUDA. Non è "sostituire", è "aggiungere".
  - **Attenzione:** EXL3 su Windows non ha benchmark primario NVIDIA datato che ho potuto trovare; i numeri Windows che ho trovato appartengono a `project-maya` (engine compatibile, non upstream). **Prima di impegolarsi serve un benchmark nostro su Windows 11 + RTX 4090/5090.**
  - **Sulla strada Metal:** esistono 5-6 port di terze parti (max 58 star), inclusa `mlxl3` (Rust/MLX/Metal, attiva 22-10-2026) e `PonyExl3`. Il claim "68,5 tok/s su M5 Max per Qwen3.6-35B-A3B" è misura singolo utente su porta non ufficiale. **Non è un piano**: è un'opportunità da monitorare, con costo di manutenzione a nostro carico.

## Odysseus

- **Come motore: ❌ NESSUN SENSO, e va detto chiaramente.** Odysseus **non è un inference engine**. È un workspace AI self-hosted (chat, agenti, email, calendario, RAG, MCP) che **compila e lancia `llama-server` di llama.cpp** — la stessa base del nostro `kalsallama` — oppure delega a Ollama / vLLM / SGLang / MLX. **Zero riferimenti a exllamav3 in tutto il repo.** Il suo "Cookbook" con "270+ modelli" e "one-click serving" è un *model manager* che parla GGUF e safetensors, non un motore.
- **Per Android: zero.** Nessuna app nativa; `companion/` è un client di pairing, e l'inferenza resta sul server desktop.
- **Come client del nostro server OAI-compatible: ✅ possibile**, e questo è l'unico uso con senso per noi. Con `local-compatible-engines` Odysseus può puntare al nostro endpoint. Ma: AGPL-3.0, stack Docker, 2.358 issue, ritmo di sviluppo orario → **sconsigliato come componente di prodotto**.
- **Come riferimento: ✅ utile.** Il pattern `services/hwfit/` + `routes/cookbook_helpers.py` (detect hardware → scarica modello → build/lancia il backend con i flag corretti) è un buon modello per il model manager del nostro desktop — **da implementare sopra llama.cpp, che già abbiamo e che copre già Metal/Vulkan/Android.**

## Cosa NON ho trovato (dichiarato esplicitamente)

1. **Nessun benchmark primario EXL3 su Windows nativo con NVIDIA** datato e riproducibile. Ho solo: supporto ufficiale dichiarato (`triton-windows`), numeri Windows di `project-maya` (engine *compatibile*, non upstream), e post community su 4090 senza piattaforma dichiarata.
2. **Nessun supporto Metal/Vulkan/OpenCL/NNAPI/Hexagon upstream** — verificato per grep su tutto il sorgente, non per documentazione.
3. **Nessun supporto EAGLE nativo** in EXL3 (solo MTP, DFlash/DFlash2, prompt-lookup/n-gram).
4. **Nessun benchmark EXL3 su Apple Silicon ufficiale** — esistono solo port di terze parti.
5. **Odysseus: nessun benchmark di inference proprio** (non è un engine) e **nessuna app nativa Android/iOS**.
6. **Il catalogo modelli di Odysseus è attualmente vuoto/rotto** (issue #6779, 2026-10-20): i file `hf_models.json` e `mlx_community_models.json` contengono `[]`.
7. **Non ho verificato in dettaglio** il percorso GPU-pooling multi-GPU NVIDIA di TabbyAPI (richiede comunque CUDA), né la maturità del supporto ROCm in EXL3 oltre ai benchmark RX 7900 XTX / R9700 (segnali positivi ma non audit completo).
8. **Il numero "94.202 star" di Odysseus** è insolitamente alto per 4,7 mesi: ho verificato il dato via API GitHub (non è un errore di parsing), ma **non ho verificato quanto sia "organico"**.

---

# Fonti

**ExLlamaV3**
- Repo: https://github.com/turboderp-org/exllamav3 (README, `LICENSE`, `setup.py`, `pyproject.toml`, `doc/convert.md`, `doc/env_vars.md`, `exllamav3/architecture/`, `exllamav3/generator/`)
- Releases/API: https://api.github.com/repos/turboderp-org/exllamav3 · PyPI: https://pypi.org/pypi/exllamav3/json
- Issue tracker (ROCm, CPU-MoE, MTP, DFlash): https://github.com/turboderp-org/exllamav3/issues
- TabbyAPI: https://github.com/theroyallab/tabbyAPI (README r.75/95/69; `endpoints/core/types/model.py`; `backends/exllamav3/model.py`, `vision.py`)
- EXL3 vs GGUF (qualità, prefill/decode, RTX 5090): https://atomic.chat/blog/guides/exl3-vs-gguf
- Benchmark aggregati: https://llamaperf.com/engine/exllamav3
- Artefatti: https://huggingface.co/api/models?author=turboderp&limit=400 · https://huggingface.co/api/models?filter=exl3&limit=1000
- Conversione/formato: https://github.com/carpedm20/exllamav3 (README) · https://huggingface.co/ewin-reg/MiniCPM5-2B-EXL3-Quantized
- Community: https://github.com/adrienbrault/qwen3.8-flash-next-2x-rtx5090 · https://github.com/mw00/project-maya · https://github.com/BBQ2077/exl3-windows-gfx1201 · https://x.com/yume_arasaki/status/2102395182184534404 · https://x.com/yume_arasaki/status/2095542446772166844

**Odysseus**
- Landing: https://odysseus-dev.github.io/odysseus · Repo: https://github.com/odysseus-dev/odysseus (`app.py`, `ROADMAP.md`, `HARNESS_VERSION`, `routes/cookbook_helpers.py` r.993/1012/1022, `routes/model_routes.py`, `routes/codex_routes.py`, `services/hwfit/data/`, `specs/model-providers/llama-cpp.md`, `specs/model-providers/local-compatible-engines.md`, `companion/README.md`, `scripts/diffusion_server.py`, `scripts/mlx_image_server.py`, `website/setup.md`, `.github/workflows/docker-publish.yml`)
- API: https://api.github.com/repos/odysseus-dev/odysseus · Issue #6779 (catalogo svuotato, 2026-10-20) · Issue #6798 (2026-10-22)

**Port Metal/EXL3 di terze parti** (tutti non ufficiali)
- https://github.com/beamivalice/PonyExl3 · https://github.com/publicExcess/ijah · https://github.com/0xZKnw/mlxl3 · https://github.com/muyouming/exl3-server · https://github.com/daig/omlx-exl3 · https://github.com/Infatoshi/exllama-ish
