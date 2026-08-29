# Governor v0 — per-phase backend routing (prefill=GPU/OpenCL, decode=CPU)

> **STATUS 2026-08-28 sera** (branch kalsallama `kalsa/governor-v0`):
> step 1 CHIUSO @ 409ef5ef3 (harness 2 contesti, oracolo logits bit-perfetto,
> audit+re-audit in audit-step1.md); step 2 CHIUSO @ 951df1f92 (cells share
> generalizzato, guardie+fence "mai silenzioso", fence decode non-owner provata
> non aggirabile su 8 rotte — audit-step2.md, verdetto APPLY); step 3 CHIUSO
> @ 93e21f361 (llama-kv-commit.{h,cpp}: route query Direct|MirrorAndCopy|Reject
> + commit per range, offset byte-identici a state_write_data — audit-step3.md:
> quantizzati REFUTATI come rischio, compatible() con dims per-layer dopo fix,
> Direct richiede cells condivise); step 4 CHIUSO @ 8e5de77da (oggetto governor:
> routing per batch-size letto PRIMA dello split, watermark airtight su traccia
> a mano 3 turni, reverse commit B→A provato dal caso prompt monotoken, replay
> del token trattenuto non più necessario — audit-step4.md verdetto APPLY al
> primo giro); step 5 CHIUSO @ 3551c3d55 (stats: commit 269568 B = riprodotti
> da principi primi dall'auditor, ~90 µs per 3 commit; n_reused conta UBATCH
> non chiamate — documentato; graph_builds onesto 4/1; split=1 vacuo su
> CPU-only, morde allo step 8 — audit-step5.md APPLY; auditor GLM RUOTATO su
> fresco: i veterani saturano a ~350k ctx); step 6 IN VOLO (mem_other
> attraverso llama_memory_hybrid — sblocca KEXP/LFM2). Ogni step: implementer
> Luna → verifica orchestratore su disco → audit GLM file-first → fix → re-audit.

Piano dell'architetto, 28/08/2026. Claim portanti spot-verificate dall'orchestratore su
disco: `ctx_other` pubblico (llama.h:401), gate `mem_other` su GEMMA4_ASSISTANT
(llama-model.cpp:2201), OpenCL `.offload_op = NULL` (ggml-opencl.cpp:11992), repack extra
buft `.is_host = nullptr` (repack.cpp). Nota di processo: prodotto dall'ULTIMO built-in
Plan consentito (regola revocata 28/08); da qui architettura inline (Fable) o Paseo.
Fork: ~/Projects/kalsallama @ a0cabca6b. Studio sorgente: litert-architecture-study/STUDY.md.

## 1. Cosa fa il codice oggi (investigazione, path:riga)

- **KV**: `llama_kv_cache` ctor (src/llama-kv-cache.cpp:64-293) — buft CPU oppure, con
  `offload_kqv`, il device del layer (210-232). Residenza decisa UNA volta da -ngl ×
  offload_kqv, SOTTO i backend, non sopra. Recurrent uguale (llama-memory-recurrent.cpp:24,85).
- **ggml_backend_sched** (ggml/src/ggml-backend.cpp): assegnazione per nodo — op che
  scrivono in tensori pre-allocati (view KV) pinnate al backend del buffer (845-933); op
  coi pesi girano dove stanno i pesi (916-928); split con copie input automatiche (1014,
  1541); fallback supports_op→CPU. Unico meccanismo per-fase esistente: `op_offload`
  (919-926) — **morto per noi**: OpenCL ha `.offload_op = NULL` (11992) e i pesi repack
  q23k vivono nell'extra buft CPU_REPACK con `is_host = nullptr` → mai offloadabili senza
  perdere la velocità decode misurata. OpenCL `supports_buft` accetta solo i propri buffer
  (11965-11977): zero-copy cross-backend oggi non esiste.
- **Confine prefill/decode**: llama_context::decode (llama-context.cpp:1647) → ubatch;
  process_ubatch (1271-1341) ricostruisce grafo/split SOLO se `can_reuse` fallisce → il
  decode loop è già alloc-free dopo il primo token (contatore `n_reused`). graph_get_cb
  (2421-2445) ha già un pin condizionale sul batch (`n_tokens < 32`) = precedente di
  placement per-fase.
- **Perché -ngl 99 prefill + -ngl 0 decode non funziona in un contesto**: un modello = un
  buffer per peso; sched segue i pesi; KV allocata una volta sul device del layer. Il
  mezzo-offload è l'arm B BANDITO dalle misure (0.38-0.45×, ALIVE §6).
- **Oro già nel fork**: `ctx_other` (llama.h:401) → `mem_other` (llama-memory.h:27) →
  kv-cache ctor: cells CONDIVISE (v_cells_impl :83-96) e con callback `share` tensori K/V
  aliasati (174-190); oggi gated a GEMMA4_ASSISTANT (model.cpp:2201-2229,
  llama-context.cpp:116-133). Estrazione/iniezione KV per range già scritta:
  state_write_data/state_read_data (kv-cache.cpp:2103-2320) + copy cross-buffer per
  stream (:844). KEXP = LFM2MOE → memoria IBRIDA (llama_memory_hybrid, model.cpp:
  2088-2151) — il ctor ibrido NON passa ancora mem_other.

## 2. Design (le tre gemme LiteRT su ggml, oneste)

Un processo, un governor, DUE path di esecuzione preparati:
- `model_cpu`: stesso GGUF, devices={CPU}, ngl=0, mmap, repack → `ctx_decode` (= arm C misurato).
- `model_gpu`: stesso GGUF, ngl=99 → `ctx_prefill` (= arm A; kernel MoE del fork). mmap
  condivide le pagine pulite; il fit-gate GPU (800 MiB + 1.05×byte) decide l'ammissibilità.
- **KVState sopra i backend** = bookkeeping del governor (watermark, generazione per lato)
  su due cache con cells condivise via `mem_other`, tensori riconciliati al **commit
  esplicito**: dopo prefill+synchronize copia dirty-range GPU→host; prima del prefill del
  turno dopo, range decode host→GPU. MAI cache intera, MAI per token.
- **PreparedPlan/attach-once** = due contesti warmati a startup (sched_reserve 527-660 +
  un ubatch caldo); il loop asserisce `n_reused` e split-count stabile — si MISURA la
  disciplina (ggml la offre già), non si costruisce macchinario nuovo.
- **Capability query** `Direct | MirrorAndCopy | Reject` consumata dal commit: Direct se
  i tensori aliasano la stessa allocazione host (callback share, o futuro import host-ptr
  Adreno via buffer_from_host_ptr :11952); MirrorAndCopy = copie di range (K contiguo /
  V staged); Reject su mismatch type_k/type_v/layout. Ha un consumatore reale dallo step
  in cui nasce.
- Alternativa rigettata a verbale: implementare offload_op OpenCL in un contesto solo =
  arm B bandito + ri-upload pesi a ogni ubatch + conflitto con gli extra repack.

## 3. Step (ognuno testabile su macOS build/, ognuno chiuso da audit ostile)

Vincoli sempre: file nuovi <250 righe; ogni funzione costruita/chiamata da test o tool
nello stesso step; NIENTE modifiche a ggml_backend_sched; defrag/context-shift fenced
(assert) finché una cache è condivisa. **RIUSO-PRIMA (regola owner 28/08): prima di
scrivere una riga, cercare il codice esistente — (a) nel fork/upstream llama.cpp (es.
offset math di state_write_data da riprendere verbatim), (b) nella lista "safe to copy"
dello STUDY LiteRT (copiare letteralmente con header Apache conservato dove i tipi
compilano). Si riscrive solo ciò che non esiste o non compila nei tipi ggml; ogni brief
di implementazione e ogni audit deve verificare questo punto.**

1. **Harness a due contesti, zero modifiche core**: un GGUF caricato come due modelli
   CPU-only (llama_model_params.devices), prefill in A, handoff con le API pubbliche
   llama_state_seq_get/set_data, decode in B. Oracolo: uguaglianza greedy token-per-token
   vs run a contesto singolo (n_threads=1). Misura il costo naive = numero che v0 deve
   battere. Audit: nondeterminismo, ownership di output_ids/logits tra contesti.
2. **Generalizzare la condivisione cells**: accettare ctx_other oltre GEMMA4
   (llama-context.cpp:116-133, model.cpp:2201-2229), path share=nullptr (:83-96). Guardie:
   stessi kv_size/type_k/type_v; defrag/shift/seq_rm fenced. Test: A popola le cells, il
   find_slot di B continua giusto. Audit: invarianti single-owner nascoste (v_heads :1093,
   find_slot :894).
3. **Primitiva di commit + capability query** in src/llama-kv-commit.{h,cpp} via
   llama-ext.h: `llama_kv_route_query(dst,src)` e `llama_kv_commit(dst,src,p0,p1)` con
   ggml_backend_tensor_get/set per layer/range, offset ripresi verbatim dalla matematica
   di state_write_data (2103-2200). Test CPU↔CPU: byte-equality vs oracolo step 1; casi
   MLA (no V) e V paddata. Audit: offset, stream index, KV quantizzata.
4. **Oggetto governor v0** (vive accanto al primo consumatore: tool phase-bench + ctest):
   possiede i due contesti, fase = batch-size alla chiamata llama_decode, watermark/
   generazioni, commit nei due versi (il prefill del turno 2 vuole il reverse commit
   decode→prefill), sampling sopra entrambi. Test: conversazione multi-turno CPU+CPU
   identica al baseline a contesto singolo. Audit: prompt vuoto, prompt multi-ubatch,
   n_past, secondo turno.
5. **Strumentazione attach-once**: contatori n_reused, sched_get_n_splits, byte/µs di
   commit, µs di graph-build; il test asserisce n_reused=N−1 e split costanti. Lo step
   PreparedPlan onesto: misura, non macchinario.
6. **Supporto ibrido LFM2/LFM2MOE (serve per KEXP)**: mem_other attraverso
   llama_memory_hybrid (model.cpp:2088-2151) fino alla kv figlia; commit esteso agli
   stati shortconv (piccoli, contigui). Test su GGUF LFM2-class, CPU+CPU. Audit:
   semantica celle recurrent vs attention.
7. **Path V-trasposta staged (solo se il config di ship resta -fa off, come gli arm
   misurati)**: readback per-riga della V trasposta = migliaia di transfer; invece un
   copy-graph ggml preparato sul backend sorgente impacchetta V[:, p0:p1] in staging
   contiguo, poi UNA readback (analogo del kModel cache-update di LiteRT). La capability
   query guadagna la dimensione costo. Audit: conteggio transfer, byte, correttezza.
8. **Build Android + smoke S23 (deferito al ritorno del telefono)**: governor tool con
   model_gpu=ngl99/OpenCL (verifica dispatch kernel MoE q2/q3) + model_cpu=ngl0/repack,
   run sotto q56. Accept: prefill ≈ arm A bancato (pp512 ~69 t/s LFM-KEXP), decode ≈ arm
   C dal token 1 (niente cliff = niente compilazioni al confine), commit/TTFT come §5,
   RSS dentro il fit gate.

## 4. Assunzioni rischiose (in ordine)

1. **Fit RAM della doppia residenza su 8 GB**: LFM-KEXP (~3.6 GB) plausibile; Marco-KEXP
   6.4 GB quasi certamente NO su S23 → v0 fail-closed sul fit gate (dichiarazione di
   scope, non bug).
2. **Costo commit V-trasposta con -fa off** — lo step 7 esiste per questo; il claim
   "handoff quasi-zero" muore qui se lo staging non rende.
3. **Cells condivise senza invarianti single-owner nascoste** (defrag, SWA pruning,
   seq_rm dal lato sbagliato) — fenced in v0, auditate step 2.
4. **Logits GPU ≠ CPU bitwise** — su device si valida con PPL/generazione breve a
   tolleranza; byte-equality solo per l'oracolo macOS CPU+CPU.
5. **Due backend + mmap in un processo su Adreno** = comportamento degli arm misurati
   separatamente (non ancora verificato in-process).
6. Rebuild del grafo prefill per turno (prompt di lunghezze diverse battono can_reuse)
   resti a scala ms — misurato step 5.

## 5. Prova che l'handoff è quasi-zero

- commit_bytes = n_attn_layers × (k_row + v_row) × n_token_prefill (KEXP: pochi layer
  attn → piccolo; recurrent ~KB); target commit_ms / prefill_ms < 2%.
- TTFT(governor) − TTFT(arm A) ≈ commit_ms + sync_ms; decode t/s = arm C dal token 1.
- Baseline naive (step 1, state get/set completo) vs commit (step 3): il miglioramento è
  il deliverable.
- Contatori step 5: n_reused = N−1, split costanti, zero reserve post-warmup.

## File critici
- src/llama-context.cpp (300-430 ctor/backends; 527-660 sched_reserve; 1271-1341
  process_ubatch; 1647 decode; 2421-2445 graph_get_cb)
- src/llama-kv-cache.cpp (64-293 ctor/buft/cells-share; 844 copy stream; 2103-2320 state IO)
- src/llama-model.cpp (2028-2270 create_memory; 2201-2229 gate mem_other)
- ggml/src/ggml-backend.cpp (845-933 assegnazione; 1014 split; 1541 compute_splits)
- ggml/src/ggml-opencl/ggml-opencl.cpp (11965-11977 supports_buft; 11992 offload_op NULL;
  11952 buffer_from_ptr; 864-883 kernel MoE)
- src/llama-ext.h (casa di llama_kv_commit / llama_kv_route_query)
- src/llama-memory-hybrid.cpp (step 6)
- ggml/src/ggml-cpu/repack.cpp (5363-5504 vincoli extra buft — perché op_offload è morto)
