# Research — split eterogeneo CPU+GPU (Adreno 740 / OpenCL) per MoE streaming

**Data ricerca:** 2026-08-09  
**Mandato:** `mandates/research-adreno-opencl.md`  
**Scope:** SOLO ricerca (zero codice, zero telefono, zero build). Decisione GO/NO-GO spike → gualt.  
**Device di campagna:** Galaxy S23, Snapdragon 8 Gen 2, Adreno 740, 8 GB.  
**Modello:** Qwen3.6-35B-A3B UD-IQ2_M (ibrido attention + gated delta net / SSM).  
**Runtime:** fork BigMoeOnEdge di llama.cpp (submodule locale `e5605f3bd`).

Legenda claim: **[V]** = fonte primaria verificata (repo/doc ufficiale/paper/dump locale); **[S]** = stima/inferenza da fonti secondarie o aritmetica. Se assente: **NON TROVATO**.

---

## K1 — Supporto quant del backend OpenCL di llama.cpp

### Cosa supporta OGGI il backend OpenCL (matmul nativo)

Documento ufficiale upstream `docs/backend/OPENCL.md` (snapshot master, crawl 2026-08-09) elenca i datatype supportati: **[V]**

| DataType | Status OpenCL |
|----------|---------------|
| Q1_0, Q4_0, Q4_1, Q5_0, Q5_1, Q8_0 | Support |
| **Q4_K, Q5_K, Q6_K** | Support |
| MXFP4, IQ4_NL | Support |
| **IQ2_XXS / IQ2_XS / IQ2_S / IQ2_M / IQ3_XXS / IQ3_S / IQ4_XS / IQ1_*** | **NON elencati** |

Fonte: <https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md> (2026-08-09)

**i-quants IQ2_***: **NON supportate** nativamente sul backend OpenCL al momento della ricerca. Solo `IQ4_NL` tra le i-quants compare nella tabella ufficiale. **[V]**

Nota Qualcomm IWOCL 2026: coverage quant “expanded” a Q4_K_M, Q5, Q8, MXFP4; non menziona IQ2. **[V]**  
Fonte: <https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf> (IWOCL 2026, May 2026)

### Il NOSTRO GGUF — tipi per-tensore (dense vs expert)

Dump locale campagna: `results/gguf_ud-iq2m_dump.txt` (F0.6, 2026-08-03).  
File: `Qwen3.6-35B-A3B-UD-IQ2_M.gguf`, arch = `qwen35moe`, 40 layer, 256 exp / top-8, `full_attention_interval=4`, campi `qwen35moe.ssm.*` presenti. **[V]**

Mapping ggml type id → nome (enum ggml standard):  
0=F32, 12=Q4_K, 13=Q5_K, 14=Q6_K, 16=IQ2_XXS, 18=IQ3_XXS, 23=IQ4_XS.

| Classe | Tensori | Bytes | Tipi |
|--------|---------|-------|------|
| **Esperti routed** (`*_exps`) | 120 | **~9.77 GB** | IQ2_XXS (80), IQ3_XXS (37), IQ4_XS (3) |
| **Non-expert (dense+attn+SSM+shexp+embd)** | 613 | **~1.75 GB** | Q5_K (181), Q6_K (70), Q4_K (1), F32 (361) |

Breakdown non-expert per ruolo:

| Ruolo | Bytes approx |
|-------|--------------|
| Attention (q/k/v/o/qkv/gate) | ~707 MB |
| Embed + output | ~636 MB |
| SSM (conv, alpha/beta, out, …) | ~226 MB |
| FFN shared / router (`shexp`, `gate_inp`) | ~176 MB |
| Norms | ~0.3 MB |

**Implicazione per offload GPU del “dense”:** i matmul che vogliamo spingere su Adreno sono **Q5_K / Q6_K / Q4_K / F32**, tutti nella tabella OpenCL “Support”. Gli IQ2/IQ3/IQ4_XS stanno quasi solo negli esperti, che resterebbero su CPU/streaming. **Non serve requant del dense** per far passare i pesi sul backend OpenCL. **[V]**

Se in futuro si volessero anche esperti su GPU: requant o dequant-on-load degli IQ2_* → Q4_K/Q5_K (costo qualità + footprint; non necessario per lo split “expert CPU / resto GPU”).

**Verdetto K1: VERDE** (per lo split target: dense su GPU).  
*Caveat:* Adreno 740 **non** è nella tabella “Verified devices” di OPENCL.md (750/810/830/840/X1/X2 sì); IWOCL 2026 però dichiara ottimizzazione su “Adreno 7xx e 8xx (Snapdragon 8 Gen 2/3)” **[V]**. Funziona in campo (vedi K5) ma non è “first-class verified”.

---

## K2 — Ops SSM / ibride sul backend OpenCL

### Matrice ops ufficiale (killer)

`docs/ops.md` master (regenerato da `test-backend-ops`, crawl 2026-08-09): **[V]**  
Fonte: <https://github.com/ggml-org/llama.cpp/blob/master/docs/ops.md>

| Op rilevante | OpenCL | Vulkan | CUDA | CPU |
|--------------|--------|--------|------|-----|
| **GATED_DELTA_NET** | **❌** | ✅ | ❌ | ✅ |
| **SSM_SCAN** | **❌** | 🟡 | ✅ | ✅ |
| SSM_CONV | ✅ | ✅ | ✅ | ✅ |
| FLASH_ATTN_EXT | 🟡 | 🟡 | 🟡 | ✅ |
| MUL_MAT | 🟡 | 🟡 | 🟡 | 🟡 |
| MUL_MAT_ID (MoE) | 🟡 | ✅ | ✅ | ✅ |
| RMS_NORM / ROPE / SOFT_MAX | ✅ | ✅ | ✅ | ✅ |

Il nostro modello è **ibrido**: `full_attention_interval=4` → ~30/40 layer usano path SSM/GDN (non full attention). **[V]** dump locale.

### Fallout runtime

Se i pesi dense/SSM vanno su buffer OpenCL ma `GATED_DELTA_NET` e `SSM_SCAN` non hanno kernel OpenCL:

1. ggml scheduler **spezza il grafo** (CPU per le ops mancanti, GPU per il resto);
2. ogni split → **sync + possibile copia activation** tra device;
3. con hybrid-MoE, lo split avviene **molte volte per token** (quasi ogni layer non-attention), non una volta a fine layer.

Esperienza pubblica correlata: discussion #22791 (S23 Adreno 740, build b9071, 2026) ha **eseguito** Qwen 3.5 2B Q4_K_M (GDN) su OpenCL — quindi non crasha hard — ma decode **peggiore del CPU** (tg128 10.8 vs 14.6 tok/s). Prefill invece meglio (42.8 vs 25.6). **[V]**  
Fonte: <https://github.com/ggml-org/llama.cpp/discussions/22791>

IWOCL 2026 (Qualcomm, May 2026) elenca **ssm-scan** e **gated-delta-net full coverage (Qwen3-Next)** come lavoro **attivo sul fork Qualcomm**, non come già upstreamed; Qwen 3.5/3.6 A3B compare come “flagship demo” con path **ILA interno**. **[V]** PDF citato sopra. Quindi: **la demo Qualcomm non dimostra che mainline OpenCL copra GDN oggi**.

### Alternativa Vulkan

Vulkan ha `GATED_DELTA_NET` ✅ e `SSM_SCAN` 🟡 — **meglio di OpenCL sul piano ops** — ma:  
- Qualcomm/IWOCL posiziona OpenCL come backend Adreno di prima scelta (feature Adreno non esposte in Vulkan: ILA, on-chip global, image weights);  
- community Android: Vulkan su Adreno storicamente fragile (output gibberish #16881 Oct 2025; note “use OpenCL on Qualcomm”). **[V]/[S]**

**Verdetto K2: ROSSO** (killer primario per hybrid Qwen3.6 su OpenCL mainline).  
Senza GDN+SSM_SCAN nativi, lo split “dense su GPU” **non** offloada la metà del calcolo che si spera: la metà ibrida ricade su CPU con overhead di split.

---

## K3 — Split “esperti su CPU, resto su GPU” in llama.cpp mainline

### Meccanismi esistenti **[V]**

1. **`--n-cpu-moe N` / `-ncmoe N`**: tiene i tensori MoE expert delle **prime N layer** su CPU; il resto (attention, norms, shared experts se non matchati, …) può andare su GPU con `-ngl`. Documentato da issue/discussion upstream (es. #15136, #16579, #15263, 2025).
2. **`--cpu-moe`**: tutti gli esperti su CPU.
3. **`-ot` / `--override-tensor` / `tensor_buft_override`**: regex per buffer type, pattern tipico:
   ```text
   -ngl 99 -ot "\d+\.ffn_.*_exps\.=CPU"
   ```
   (esperti condizionali su CPU; shared expert + attention su GPU). Discussion #13154 (2025).

Uso pubblico su **Qwen3.5/3.6-35B-A3B** con Vulkan/CUDA + `-ncmoe` è documentato in discussion community 2026 (es. decode ~15–76 tok/s su desktop GPU+CPU, non mobile). **[V]**  
Fonte es. discussion #21112, #22183.

### Router e sync

- Il **router** (`ffn_gate_inp` / top-k) è un tensore/op nel grafo: se i pesi non-expert sono su GPU, il router gira sul device dei suoi tensori; l’id degli esperti selezionati deve comunque guidare il matmul expert sul **device dove stanno gli expert weights** (CPU nello split target).
- llama.cpp gestisce questo con **graph splits** multi-backend: ogni confine CPU↔GPU implica `ggml_backend_synchronize` e, se i buffer non sono shared, **copia delle activation**.
- Per MoE hybrid CPU experts: il path decode **non** è “zero sync”: tipicamente **≥ 1 split per layer MoE** (attention GPU → expert CPU → residual GPU), spesso di più se ops ibride mancano (K2).

### Compatibilità concettuale col nostro streaming

**Concettualmente sì:** “experts = CPU memory, dense = GPU” è esattamente lo use case di `-ncmoe` / `-ot …_exps.=CPU`.  
**Operativamente col fork BigMoeOnEdge:** lo streaming **rebinda** `tensor->data` degli expert su buffer applicativi (mmap/O_DIRECT/anon). Questo assume tensori expert con buffer type **CPU host-visible**, non OpenCL. Coerente con “experts on CPU”.  
**Incoerenza da gestire:** il fork forza oggi `n_gpu_layers = 0` e `use_extra_bufts = false` (vedi K7). Non c’è ancora il wiring GPU.

**Verdetto K3: VERDE** a livello mainline (feature esiste e si usa); **GIALLO** se la metrica è “compatibile col *nostro* streaming senza lavoro di integrazione” (serve innesto esplicito).

---

## K4 — Zero-copy / memoria unificata su Adreno

### Cosa fa il backend OpenCL (codice nel submodule locale)

Path buffer weight (`ggml-opencl.cpp` nel submodule BigMoeOnEdge):

- Allocazione: `clCreateBuffer(context, CL_MEM_READ_WRITE, size, NULL, …)` — **device buffer standard**, non `CL_MEM_ALLOC_HOST_PTR` / `CL_MEM_USE_HOST_PTR` nel path principale. **[V]** locale.
- Upload pesi: `clEnqueueWriteBuffer(...)` in `ggml_backend_opencl_buffer_set_tensor` — **copia esplicita host→device**. **[V]** locale.
- SVM: il backend **interroga** e logga `CL_DEVICE_SVM_*` (coarse/fine/system/atomics) ma i pesi non risultano mappati zero-copy via SVM nel path set_tensor sopra. **[V]**
- Feature Adreno: image-backed weights, large buffer, xmem GEMM prepack (pesi temporanei prepackati) — ottimizzazioni di **layout/copia**, non eliminazione della residenza GPU. **[V]** IWOCL 2026 + codice.

Estensioni Qualcomm citate da IWOCL 2026 (usate / shipping): `cl_qcom_reqd_sub_group_size`, `cl_qcom_recordable_queue`, `cl_qcom_image_array_indexing`, … — **NON** un path documentato “mmap GGUF → zero-copy OpenCL weight”. **[V]**

`cl_qcom_ext_host_ptr` / ION/dmabuf per pesi llama.cpp: **NON TROVATO** nel backend OpenCL mainline/submodule.

### Costo RAM su S23 8 GB (stima onesta)

Contesto campagna: processo già ~**3.9 GiB** residenziale. **[S]** (dal PLAN/STATO; non ricalibrato in questa ricerca).  
Dense da offloadare: **~1.75 GiB** (dump). **[V]**

Su Snapdragon UMA, GPU e CPU attingono allo **stesso pool DRAM**:

| Scenario | Costo extra RAM (ordine) | Note |
|----------|--------------------------|------|
| Dense solo su buffer OpenCL, mmap dense droppato | ~**+1.75 GiB** alloc GPU (sostituisce ~1.75 GiB host se unmappato) | Netto ≈ 0 se drop perfetto; in pratica residuali staging/image views **[S]** |
| Dense su GPU **e** ancora pin/mmap host | **+1.75–2.0 GiB** | Double residency — **morte OOM** su 8 GB con cache expert **[S]** |
| Staging `clEnqueueWrite` + image SoA views | +decine–centinaia MB | Temporaneo al load; image views possono restare **[S]** |

**Conclusione K4:** non è “zero-copy magico”. È **UMA con copia di load e buffer device**. Spostare 1.5–2 GiB di dense su GPU è fattibile **solo se** si **rilascia** la residenza host corrispondente e si tiene stretta la expert cache. Altrimenti 3.9 + 1.75 + expert cache → fuori budget 8 GB.

**Verdetto K4: GIALLO** (non kill immediato, ma zero-copy **non** c’è; budget RAM stretto e fragile).

---

## K5 — Numeri Adreno 740 reali

### Verificati su S23 / Adreno 740

**Discussion ggml-org/llama.cpp #22791** (2026, Galaxy S23 SM-S911B, Adreno 740 OpenCL 3.0 driver 0676.73, build b9071): **[V]**  
Fonte: <https://github.com/ggml-org/llama.cpp/discussions/22791>

| Modello | Backend | pp512 (t/s) | tg128 (t/s) |
|---------|---------|-------------|-------------|
| Llama 3.2 3B Q4_K_M | CPU 6 thr | **30.5** | **9.8** |
| stesso | OpenCL -ngl 99 | 14.5 | **5.9** |
| stesso | HTP NPU | 28.5 | 8.4 |
| Qwen 3.5 2B Q4_K_M (GDN) | CPU | 25.6 | **14.6** |
| stesso | OpenCL | **42.8** | 10.8 |
| stesso | HTP | 39.2 | 4.7 |

Osservazioni log: `vector subgroup broadcast support: false` sul driver S23 → path GEMM degradata. **OpenCL peggiore del CPU su decode** in entrambi i modelli. HTP quasi non carica i pesi (0.67 MiB su HTP0).

**Qiita 2025-09** (POCO F6 Pro, Snapdragon 8 Gen 2, Adreno 740): conferma detection OpenCL Adreno 740 e build funzionante; **non** riporta tok/s sostenuti confrontabili. **[V]**  
<https://qiita.com/chibibaku/items/7892af02c722504dcf4f>

### Qualcomm marketing / talk

- Blog OpenCL backend (Nov 2024 / Feb 2025): annuncio, **nessun numero S23/740 decode sostenuto** nel material fetchabile. **[V]** assenza.  
  <https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu>
- IWOCL 2026: **600+ tok/s prefill** gpt-oss-20B su **Snapdragon X2 Elite** (desktop/laptop class, ILA kernels binari non mainline). Non Adreno 740 phone. **[V]**
- OPENCL.md verified list: **non include 740**. **[V]**

### Termico sostenuto GPU vs CPU

**NON TROVATO** (misura pubblica di watt/temperatura sustained “dense su GPU, expert su CPU” su 8 Gen 2 / S23).  
Il bonus termico sperato dal PLAN resta **ipotesi [S]** non supportata da dati pubblici.

**Verdetto K5: ROSSO** per “GPU batte CPU decode su Adreno 740 oggi con OpenCL mainline”.  
I dati device-class dicono il contrario (decode). Prefill può migliorare; la nostra campagna è **decode-bound**.

---

## K6 — Prior art: MoE streaming + GPU/NPU su smartphone

### PowerInfer-2 **[V]**

- Paper: arXiv:2406.06282 (2024), site <https://powerinfer.ai/v2/>
- Claim: TurboSparse-Mixtral-47B a **11.68 tok/s** su smartphone; speedup fino ~22–29× vs llama.cpp in regime offload; OnePlus 12 / Ace 2 (16–24 GB), XPU Qualcomm.
- Meccanismo: neuron/cluster hot-cold, pipeline I/O–compute, hardware eterogeneo — **non** è lo stesso split “llama.cpp OpenCL + expert stream BigMoe”.
- **Codice Android PowerInfer-2: NON open-source riproducibile.** Issue ufficiali (SJTU-IPADS #194, #207, 2024): “will be open-sourced in the future”; al 2026-08 la ricerca non trova release mobile v2 usabile. PowerInfer v1 (desktop CUDA) è su GitHub.  
  Coerente con PLAN campagna (SmallThinker scartato: framework non pubblico Android).

### Altri

| Sistema | Cosa fa | Rilevanza |
|---------|---------|-----------|
| **MLC-LLM / ML Drift** | OpenCL mobile, bench Adreno 740/750 (paper arXiv:2505.00232, 2025) | Dense/small models; non MoE flash-stream BigMoe. Speedup prefill vs altre stack. **[V]** |
| **mllm / MNN-LLM / ExecuTorch** | inference mobile | **NON TROVATO** prior art “expert da flash + dense GPU” su Qwen3.6 hybrid. |
| **llama.cpp Vulkan Adreno** | alternativa OpenCL | Ops GDN migliori; qualità/stabilità Adreno mobile **dubbia** (#16881). **[V]** |
| **llama.cpp OpenCL + `-ncmoe`** desktop | expert CPU / resto GPU | Pattern validato su desktop, **non** con streaming flash expert. **[V]** |

**Qualcuno ha già fatto “esperti da flash su CPU + dense su GPU” su phone con numeri?**  
**NON TROVATO** (combinazione esatta). PowerInfer-2 è il più vicino (hetero + I/O) ma chiuso e su modelli TurboSparse diversi.

**Verdetto K6: GIALLO** (prior art incoraggia l’idea hetero, ma **non** riduce il rischio di integrazione; PowerInfer-2 non è riproducibile).

---

## K7 — Fattibilità nel NOSTRO fork (BigMoeOnEdge)

Fonti: `BigMoeOnEdge/docs/architecture.md`, `docs/moe-streaming.md`, `core/src/engine/session.cpp`, `core/src/moe/dense_weights.h`. **[V]** locale.

### Cosa tocca lo streaming

- **Solo tensori expert** `blk.<il>.ffn_{gate,up,down}_exps.weight`: cattura a warm-up, rebind di `tensor->data`, fill da O_DIRECT/mmap cache.
- Dense (attention, SSM, shexp, embd, lm_head, norms) gestiti da **`DenseWeights`** con policy separate (Mmap / Warmed / Anonymous / Pinned) — **path distinto**, non intrecciato byte-per-byte con lo streamer expert.
- Seam: `cb_eval` pubblico su nodi `ffn_moe_topk-*`; **nessuna dipendenza da backend GPU** per il path seriale.

### Assunzioni che rompono un backend GPU

Da `session.cpp` (load):

```text
mparams.use_mmap = true;
mparams.use_extra_bufts = false;   // load-bearing per rebind expert
mparams.n_gpu_layers = 0;         // hard-coded: tutto CPU
```

| Vincolo | Impatto GPU |
|---------|-------------|
| `n_gpu_layers = 0` | Nessun offload oggi; va esposto/configurato. |
| `use_extra_bufts = false` | OpenCL Adreno spinge spesso SoA/image repack a load (`set_tensor` converte layout). Conflitto potenziale con “layout = file nativo” per gli expert; i dense su GPU **potrebbero** usare extra bufts se isolati, ma l’API model-level è globale. **[S]** da spike. |
| Expert rebind `->data` | Funziona solo se expert restano su buffer **CPU**. OK con `-ot exps=CPU` / n-cpu-moe. |
| Dense Anonymous rebind | Confligge con buffer type OpenCL (non puoi rebindare `->data` host se il tensore è su `CL` buffer). Serve: dense **non** in modalità Anonymous host se offloadati. |
| `--overlap` hook | Hook CPU MoE kernel nel fork branch; irrilevante/GPU-n/a se expert matmul resta CPU. |

### Circoscrizione dell’innesto

**Relativamente circoscritto** a livello di architettura ports-and-adapters:

1. Build submodule con `GGML_OPENCL=ON` (Android NDK path da OPENCL.md).
2. Rilassare `n_gpu_layers` / passare tensor override o emulare n-cpu-moe.
3. Policy dense: **non** Anonymous-host per tensori offloadati; lasciare a llama load su buft GPU.
4. Mantenere expert streamer invariato su CPU buft.
5. Misurare graph splits (verbose) — se GDN forza split per layer, l’innesto “pulito” non basta.

Lo streaming **non** è “intrecciato ovunque”, ma **il grafo hybrid + flag di load globali** rendono lo spike non banale (giorni–settimane, non un flag).

**Verdetto K7: GIALLO** (architettura *permette* l’innesto expert-only; wiring GPU + buft + hybrid ops è lavoro non banale).

---

## Sintesi 1 — Tabella killer

| # | Domanda | Verdetto | Perché (1 riga) | Fonte primaria |
|---|---------|----------|-----------------|----------------|
| **K1** | Quant OpenCL vs nostro dense | **VERDE** | Dense offload = Q5_K/Q6_K/Q4_K/F32 supportati; IQ solo sugli expert (CPU) | OPENCL.md; `results/gguf_ud-iq2m_dump.txt` |
| **K2** | SSM/GDN su OpenCL | **ROSSO** | `GATED_DELTA_NET` ❌, `SSM_SCAN` ❌ su OpenCL mainline → split/sync per layer hybrid | ops.md; IWOCL 2026 (GDN solo fork QC) |
| **K3** | Split expert CPU / resto GPU | **VERDE**\* | `--n-cpu-moe` / `-ot` esistono e sono usati; \*innesto fork = GIALLO | llama.cpp issues/discussions 2025–26 |
| **K4** | Zero-copy Adreno | **GIALLO** | `clCreateBuffer` + `WriteBuffer`; UMA sì, free lunch no; +1.75 GiB se non si droppa host | ggml-opencl.cpp locale; IWOCL 2026 |
| **K5** | Numeri 740 reali | **ROSSO** | S23: OpenCL decode **più lento** del CPU su 2B/3B; 740 non “verified” | #22791 |
| **K6** | Prior art phone | **GIALLO** | PowerInfer-2 incoraggia ma **chiuso**; nessuno riproduce “flash expert + dense GPU” su Qwen hybrid | arXiv:2406.06282; GitHub issues PI |
| **K7** | Fork nostro | **GIALLO** | Streamer solo expert; ma `n_gpu_layers=0`, `use_extra_bufts=false` hard | architecture.md; session.cpp |

**Quadro complessivo: ROSSO in partenza** (K2 + K5 bastano a uccidere lo “spike serio” come scommessa +30–50% decode).  
K1 e K3 da soli non salvano: i pesi “giusti” e le flag “giuste” non bastano se le ops hybrid non stanno sulla GPU e se OpenCL su 740 non batte il CPU sul decode.

---

## Sintesi 2 — Stima onesta del potenziale (+30–50% del PLAN)

### Aritmetica del PLAN (rinfresco)

- Decode baseline campagna: ~**4.4–4.5 tok/s** sostenuto. **[V]** PLAN.  
- Collo: **calcolo** a ~1.39 GHz (ceiling termico, ~41% del picco); I/O ~20%. **[V]** PLAN.  
- Split sperato: GEMM expert ~50% compute, dense+attention ~50%. **[S]** PLAN.  
- Se overlap perfetto e GPU fa “gratis” la metà: \(T' \approx T / 0.5 = 2\times\) → ~9 tok/s.  
- Claim realistico PLAN: **+30–50%** → ~**5.7–6.8 tok/s**.

### Correzione con evidenza 2026

| Ipotesi PLAN | Evidenza | Correzione |
|--------------|----------|------------|
| GPU fa il 50% dense in meno tempo del CPU | Su 740, OpenCL **più lento** del CPU sul decode di modelli piccoli (#22791) | Speedup dense GPU **≤ 1.0×**, spesso **0.5–0.8×** **[S]** da proxy 2B/3B |
| Ops dense tutte su GPU | GDN+SSM_SCAN → CPU; solo matmul “classici” restano candidati | Frazione offloadabile **≪ 50%** del compute ibrido (ordine **20–35%** se va bene) **[S]** |
| Overlap pieno GPU∥CPU | Ogni layer hybrid impone sync split | Overlap **parziale o negativo** (sync > gain) **[S]** |
| Bonus termico | NON TROVATO | Non quantificabile; GPU+CPU insieme possono **peggiorare** il thermal **[S]** |

**Bound riveduto (onesto):**

- **Best case credibile** (se un giorno GDN/SSM su GPU Adreno + driver subgroup ok): **+10–25%** decode, non +30–50%.  
- **Caso base con mainline OpenCL oggi:** **0% a −20%** (più lento o flat, più RAM risk).  
- **+30–50% del PLAN: NON sostenibile** con lo stato OpenCL 2026-08 su Adreno 740 + Qwen3.6 hybrid.

Formula grezza:

\[
S \approx \frac{1}{(1-f) + f/g + o}
\]

con \(f\) = frazione compute realmente offloadata, \(g\) = speedup GPU vs CPU su quella frazione, \(o\) = frazione tempo di overhead sync/copy.

Con \(f=0.25\), \(g=0.8\) (GPU più lenta!), \(o=0.05\): \(S \approx 0.93\) → **regressione**.  
Con \(f=0.35\), \(g=1.5\), \(o=0.05\): \(S \approx 1.15\) → **+15%** (ancora sotto il target PLAN).

---

## Sintesi 3 — Disegno spike raccomandato (fail-fast)

**Raccomandazione di ricerca: lo spike “pieno fork+OpenCL+stream” come scommessa da settimane è NO-GO.**  
Se gualt vuole **comunque** un kill empirico a basso costo (1–3 giorni device, non settimane di integrazione fork), sequenza minima:

### Sequenza corta (vanilla first)

| Step | Azione | GO se… | NO-GO se… | Tempo |
|------|--------|--------|-----------|-------|
| **S0** | Build **vanilla** llama.cpp `GGML_OPENCL=ON` NDK, deploy S23 | binario parte, `ggml_opencl` vede Adreno 740 | non builda / non vede GPU | 0.5 d |
| **S1** | `llama-bench` dense **piccolo** Q4_K_M (Llama-3.2-3B o Qwen3.5-2B) CPU vs OpenCL `-ngl 99` | tg OpenCL ≥ **1.15×** CPU **e** ≥ 1.0× dopo 5 min termico | tg OpenCL < CPU (replica #22791) | 0.5 d |
| **S2** | Stesso su **Qwen3.5-4B o 2B hybrid** (GDN): conta `graph splits` verbose | splits per token bassi **o** GDN su GPU | splits ∝ n_layer hybrid, tg ≪ CPU | 0.5 d |
| **S3** | MoE **piccolo** che fitta in RAM (es. Qwen-A3B piccolo o Mixtral-tiny) `-ngl 99 --n-cpu-moe 999` | decode ≥ CPU-only dello stesso quant | peggio di CPU-only o OOM | 0.5 d |
| **S4** | **Solo se S1–S3 GO:** tentare innesto fork (`n_gpu_layers` + expert CPU stream) | tok/s ≥ baseline BigMoe **+15%** sostenuto 5 min, Mem stabile | qualsiasi regressione o OOM | 3–10 d |

### Soglie numeriche proposte

| Metrica | GO spike integrazione fork | NO-GO / stop |
|---------|----------------------------|--------------|
| tg OpenCL / tg CPU (dense 2–3B, cold+warm) | ≥ **1.15** | < **1.05** |
| tg OpenCL sustained 5 min / peak 30 s | ≥ **0.85** | < **0.70** (therm throttle peggiore CPU) |
| graph splits / token su hybrid | ≤ **4** | ≥ **n_layer/2** (~20) |
| RSS + GPU weights vs baseline | ≤ baseline + **400 MB** | + **>1.2 GB** o LMK |
| (solo post-fork) tok/s vs BigMoe CPU stream | ≥ **+15%** mediana | < **+5%** |

### Se il quadro resta ROSSO — alternative (non addolcite)

1. **Non fare lo spike OpenCL** sul 35B hybrid: probabilità di gain decode bassa, costo alto.  
2. **Kernel IQ2 a mano sul CPU** (candidato PLAN #3): attacca lo stesso collo compute **senza** dipendere da ops GDN GPU; nessun bonus termico cross-silicon, ma non sbatte su K2/K5.  
3. **Vulkan solo come esperimento collaterale** se S1 OpenCL fallisce: ha GDN ✅, ma Adreno mobile è campo minato — un pomeriggio di bench, non una campagna.  
4. **Aspettare / tracciare** Qualcomm fork ILA + upstream GDN/SSM_SCAN OpenCL (IWOCL 2026 roadmap) e **driver subgroup** su S23; oggi non shippabile.  
5. **NPU HTP**: #22791 mostra quasi zero offload pesi su 8 Gen 2 — **non** candidato serio oggi.  
6. **Prodotto Kalsa** (candidato PLAN #2): se l’obiettivo è valore utente, non tok/s, ha ROI più chiaro.

---

## Conclusioni operative (per gualt)

- **K1 non è il killer:** il nostro dense non è IQ2_M sui matmul critici.  
- **K2 + K5 sono i killer:** OpenCL mainline non ha GDN/SSM_SCAN; su Adreno 740 il decode OpenCL è già stato misurato **inferiore al CPU**.  
- Il **+30–50%** del PLAN va **ritirato** come target per questa leva; upper bound onesto ~**+15%** solo in scenari futuri con ops complete e GPU>CPU.  
- **Raccomandazione ricerca: NO-GO** allo spike di integrazione fork+OpenCL come “esperimento serio” primario.  
- Se serve un verdetto empirico ultra-economico: solo **S0–S2** su vanilla (≤1.5 giorni). Fermarsi al primo ROSSO (atteso a S1 o S2).

**STOP. Decisione GO/NO-GO spike: gualt.**
