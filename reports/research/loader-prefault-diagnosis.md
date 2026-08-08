# Diagnosi loader: 20.76 GiB letti per materializzarne ~2.8

**Runtime:** `BigMoeOnEdge` @ `b0c4e5b`, submodule llama.cpp `5236140e5`  
**Modello:** Qwen3.6-35B-A3B UD-IQ2_M, 11.52 GiB, `qwen35moe`, 40 layer, 256 esperti, 8 attivi  
**Config campagna:** `--moe-stream --cache-mb 2000 --dense-weights anon`  
**Misura (F4.8):** `read_bytes=20.76 GiB`, `rchar=1.62 GiB`, load 19.563 s @ 1086.7 MiB/s  

**Sola lettura. Nessun file di progetto modificato.**

---

## Prima riga — è già una flag?

**No. Non esiste una flag CLI/API pubblica che disattivi il prefault dell’intero mmap.**

- Nessun campo in `llama_model_params` controlla `prefetch` / `MAP_POPULATE` (`third_party/llama.cpp/include/llama.h:324-327`: solo `use_mmap`, `use_direct_io`, `use_mlock`, `check_tensors`).
- `init_mappings(bool prefetch = true, …)` ha il default `true` (`llama-model-loader.h:189`) e il path di load modello lo chiama **sempre** con `true` (`llama-model.cpp:1506`).
- L’unica chiamata con `prefetch=false` è in quantizzazione (`llama-quant.cpp:885`), non nel load runtime.
- `--dense-weights mmap|warm` **elimina solo il secondo passaggio dense via O_DIRECT** (~1.62 GiB di `rchar`), **non** i ~19 GiB di page-fault mmap. Non è un fix a costo zero del problema principale.

Il fix minimo richiede una riga nel submodule llama.cpp (fork Helldez, coerente con la regola AGENTS.md sul patch out-of-tree).

---

## 1. CHI tocca i corpi degli esperti durante il load?

### Catena di controllo (bmoe)

| Step | Dove | Cosa fa sui corpi esperti |
|------|------|---------------------------|
| CLI | `cli/main.cpp:622+` (`--moe-stream`), `638+` (`--dense-weights`) | Solo config. **Non tocca dati.** |
| Open sessione | `core/src/engine/session.cpp:405-436` | Forza `use_mmap=true`, `use_extra_bufts=false`, `n_gpu_layers=0`; chiama `llama_model_load_from_file`. |
| Meta GGUF | `core/src/moe/gguf_offsets.cpp:41-45` | `gguf_init` con `no_alloc=true`: **solo metadata/offset**, zero byte di tensore. |
| Capture warm-up | `session.cpp:594-614` | Un decode mmap-resident **prima** del rebind streamer: tocca **dense + soli esperti routed** (8/layer), non tutti i 256. Harvest puntatori in `router_hook.cpp:1214-1238` (solo nomi/`ggml_tensor*`, nessun memcpy). |
| Bind streamer | `session.cpp:616-675` → `expert_stream_source.cpp:27-269` | Rilegge offset, rebind di `tensor->data` su slot/cache **vuoti**, apre `FileReader`. **Nessuna lettura dei corpi esperti.** |
| Dense anon | `dense_weights.cpp:46-66`, `84-127`, `155-174` | O_DIRECT **solo** sui tensori non-esperto; poi `drop_mmap_copies` (`dropped … mmap pages`). **Non legge esperti.** |

### Causa del fault sull’**intero** file (inclusi tutti gli esperti)

**Punto unico, mainline llama.cpp, non bmoe:**

1. `llama_model.cpp:1506`
   ```cpp
   ml.init_mappings(true, use_mlock ? &pimpl->mlock_mmaps : nullptr);
   ```
2. `llama-model-loader.cpp:1358`
   ```cpp
   std::unique_ptr<llama_mmap> mapping =
       std::make_unique<llama_mmap>(file.get(), prefetch ? -1 : 0, is_numa);
   ```
   Con `prefetch=true` passa `-1` → `size_t` enorme, truthy.
3. `llama-mmap.cpp:445-466` (POSIX/Linux):
   - se `prefetch != 0`: `flags |= MAP_POPULATE` (**line 455**) → prefault di **tutta** la mappa in `mmap()`
   - se `prefetch > 0`: `posix_madvise(..., POSIX_MADV_WILLNEED)` sull’intero file (**line 462-466**)

Questo è **upstream llama.cpp**, non un’estensione del fork. Il submodule di bmoe aggiunge solo l’expert-ready hook (`5236140e5`); `init_mappings(true)` è invariato.

Con `check_tensors=false` (default, `llama-model.cpp:2316`) e mmap+host_ptr, `load_all_data` fa solo puntamento (`llama-model-loader.cpp:1545-1569`: `ggml_backend_tensor_alloc` sul mapping), **non** un secondo scan byte-a-byte dei tensori. I body esperti entrano in RAM perché **MAP_POPULATE/WILLNEED faultano l’intera VMA**, non perché bmoe o `load_all_data` li copiano uno a uno.

### `use_mmap = true` è richiesto? Perché?

**Sì, forzato da bmoe** in `session.cpp:405-409`:

```cpp
// Load with the layout the streamer requires: file-backed mmap, no repack ...
mparams.use_mmap = true;
mparams.use_extra_bufts = false;
```

Documentato come hard rule in `AGENTS.md:43-45` e `docs/architecture.md:60-62`.

| Vincolo | Origine | Motivo |
|---------|---------|--------|
| `use_mmap=true` | bmoe (streamer) | Senza mmap, llama alloca buffer host e **carica tutti i pesi (esperti inclusi) in RAM** (`load_all_data` ramo non-mmap: `read_raw`, `llama-model-loader.cpp:1573-1578`). Su un file 11.52 GiB > RAM è OOM al load. Il mmap file-backed permette di **rebindare** `tensor->data` via senza aver materializzato permanentemente gli esperti. |
| `use_extra_bufts=false` | bmoe (streamer) | Il repack cambia layout; il rebind assume layout GGUF nativo. |
| Prefetch eager | **llama.cpp mainline**, non bmoe | `init_mappings(true)` hardcodato. **Nessuna API pubblica** per disattivarlo. |

Quindi: **mmap è obbligatorio per lo streaming beyond-RAM; l’eager populate no.** È un default di performance di llama pensato per “modello che sta in RAM e va scaldato subito”, opposto al caso MoE streamato.

### Coerenza con la timeline F4.8

| Tempo | Evento | Codice |
|-------|--------|--------|
| t≈0–9.6 s | Intero file già faultato | `MAP_POPULATE`+`WILLNEED` in `init_mappings(true)` durante `llama_model_load_from_file` |
| (dopo load, prima di streamer) | Capture warm-up | `session.cpp:594-614` — fault **addizionali** solo se pagine già reclaimate; altrimenti soft-fault |
| t≈12–15 s | `dropped 1662 MiB of now-unused mmap pages` | `dense_weights.cpp:172-173` |
| t≈17.5 s | `rchar` sale di ~1.62 GiB | `read_anonymous` O_DIRECT (`dense_weights.cpp:117-120`) |

Aritmetica I/O:

- `rchar ≈ 1.62 GiB` → solo le `read()`/`pread` esplicite = conversione dense anon (allineato a “dropped 1662 MiB”).
- `read_bytes − rchar ≈ 19.14 GiB` → page fault da storage sul mapping.
- File = 11.52 GiB ma fault mmap ≈ 19.14 GiB (**~1.66×**): con file > free RAM, durante/dopo il populate le pagine iniziali vengono reclaimate e **ri-faultate** (warm-up dense+esperti routed, pressione da allocazioni successive, thrash). Non serve un secondo scan esplicito del codice: il moltiplicatore è reclaim sotto pressione, non un altro `for` sui tensori.

Dopo il rebind degli esperti (`expert_stream_source.cpp:136-164`), le pagine mmap degli esperti restano **orfane in page cache** (nessun `drop` analogo a `drop_mmap_copies` per gli esperti). Questo spiega la fragilità di memoria / cascata OOM a fine load: ~9+ GiB di page cache esperto non referenziata dal grafo, competono con cache LRU e buffer dense.

---

## 2. È evitabile, e a quale costo?

### Causa A — `MAP_POPULATE` + `MADV_WILLNEED` sull’intero file

| Classificazione | **Incidentale** rispetto allo streaming MoE |
|-----------------|-----------------------------------------------|
| Serve al load streamato? | **No.** Servono solo: (1) mapping lazy o buffer, (2) puntatori tensori, (3) offset GGUF, (4) rebind. I body dei 256 esperti non servono al load. |
| Flag esistente? | **No** (vedi prima riga). |
| Evitabile? | **Sì**, con `init_mappings(false)` (o param pubblico `mmap_prefetch=false`). |
| Costo | Lazy fault al primo accesso. Il capture warm-up faulta solo dense + 8 esperti/layer (~ordine del trunk + frazione esperti ≈ i ~2.8 GiB “utili”). Decode streamato continua a leggere esperti via O_DIRECT/cache come oggi. **Decode path invariato** se il rebind resta com’è. |
| Rischio bit-identity | Basso: i byte dei pesi non cambiano; cambia solo *quando* entrano in RAM. Gate 8/8 a `temp 0` dovrebbe restare verde. |

### Causa B — doppio passaggio dense con `--dense-weights anon`

| Classificazione | **Necessario nella policy anon**, ma **il secondo passaggio flash è evitabile in design** |
|-----------------|----------------------------------------------------------------------------------------|
| Cosa fa | Warm-up (e/o MAP_POPULATE) faulta il dense in page cache; poi `read_anonymous` lo **rilegge** da file con O_DIRECT in buffer anon e droppa le pagine mmap (`dense_weights.cpp:46-66`, `84-127`, `149-174`). |
| Flag esistenti | **`mmap`**: nessun O_DIRECT, nessun drop → **salva ~1.62 GiB** di secondo passaggio; dense resta reclaimabile a flash (peggio in decode oltre-RAM: è proprio la patologia che `anon` risolve; vedi `config.h:91-103`). **`warm`**: sweep sequenziale buffered sulle sole range dense (`dense_weights.cpp:176+`); con MAP_POPULATE già fatto è ridondante su I/O disco se le pagine sono ancora residenti. **`ahwb`**: come `anon` (stesso doppio passaggio; buffer pinned). |
| Costo zero “completo”? | **No.** `mmap`/`warm` tolgono solo ~8% del volume load (1.62/20.76), non i ~19 GiB di fault esperti. |

### Causa C — capture warm-up decode

| Classificazione | **Necessario** per lo streamer (scoperta `ggml_tensor*` + dense list) |
|-----------------|----------------------------------------------------------------------|
| Tocco body | Solo esperti **routed** + dense, non 256×layer. |
| Con prefetch off | Diventa il **primo** (e unico) fault utile: ~2.8 GiB, non 11.52. |

### Causa D — init streamer / `FileReader` / cache LRU

| Classificazione | **Non tocca body esperti al load** |
|-----------------|-------------------------------------|
| Evidenza | `expert_stream_source.cpp:58-68` calcola solo size; `136-164` rebind; `181-189` open fd; `232-252` avvia dense policy. Letture expert solo in `load_layer` a runtime. |

---

## 3. Fix minimo (solo descrizione — non implementato)

### Fix primario (obbligatorio per i ~19 GiB)

**Una riga nel submodule llama.cpp (branch fork Helldez, non diff in-tree grezzo — AGENTS.md hard rule 1):**

```cpp
// llama-model.cpp:1506  — oggi:
ml.init_mappings(true, use_mlock ? &pimpl->mlock_mmaps : nullptr);
// proposta minima:
ml.init_mappings(false, use_mlock ? &pimpl->mlock_mmaps : nullptr);
```

O, meglio di un hardcode globale (impatti chi vuole warm load classico):

1. Aggiungere `bool mmap_prefetch;` a `llama_model_params` (default `true` per compat).
2. Propagarlo a `init_mappings(params.mmap_prefetch, …)`.
3. In `session.cpp` (solo se `--moe-stream`): `mparams.mmap_prefetch = false`.

| Stima | |
|-------|--|
| Righe | 1 (hardcode) oppure ~15–30 (param + wire + default) |
| File | `llama-model.cpp` [+ `llama.h` / default params se API]; opz. `session.cpp` |
| Decode | **Non toccato** se si cambia solo il prefetch al map |
| Cosa può rompere | Load “nudo” senza stream che contava sul populate per nascondere i fault nel `load_seconds` (li sposta al primo token). Con `--moe-stream` è esattamente il comportamento desiderato. Gate 8/8: non dovrebbe muoversi. Benchmark di load time senza streamer. |
| Vincolo repo | Patch sul fork `Helldez/llama.cpp` + bump submodule; non patch silenziosa in-tree. |

**Effetto atteso sul carico F4.8:**  
load I/O da ~20.76 GiB → ordine di **warm-up (~2.5–3 GiB fault) + O_DIRECT dense (~1.6 GiB)** ≈ **4–5 GiB**, TTFT load da ~19.6 s verso ~4–5 s a 1 GiB/s (stima; va rimisurato). Il target “~2.6 s / solo 2.8 GiB” richiede anche di non ridoppiare il dense (fix secondario).

### Fix secondario (opzionale, solo volume dense)

Dopo fix primario, con `anon` resta il doppio dense (fault warm-up + O_DIRECT). Mitigazioni possibili **senza toccare decode**:

1. In `read_anonymous`: se `tensor->data` punta ancora al mmap e le pagine sono residenti, **memcpy** nel buffer anon invece di O_DIRECT — elimina ~1.62 GiB flash. (~20–40 righe in `dense_weights.cpp`.)
2. Oppure: drop esplicito delle range **esperti** dopo rebind (simmetrico a `drop_mmap_copies`) per non lasciare 9 GiB di page cache orfana — non riduce I/O già speso, riduce pressione/OOM.

### Cosa **non** fare come “fix”

- `use_mmap=false`: materializza **tutto** in RAM → peggio.
- `use_direct_io` sul model load: disabilita mmap (`llama-model-loader.cpp:565-568`) → stesso esito.
- Solo `--dense-weights mmap`: toglie 1.62 GiB, lascia 19 GiB di fault e regredisce la residenza dense in decode oltre-RAM.

---

## 4. Cosa NON è la causa

| Ipotesi | Verdetto | Perché |
|---------|----------|--------|
| `check_tensors` valida tutti i body | **Esclusa** | Default `false` (`llama-model.cpp:2316`); bmoe non lo abilita. |
| `load_all_data` fa `memcpy`/`ggml_backend_tensor_set` su ogni esperto | **Esclusa** sul path CPU mmap | Con `buffer_from_host_ptr` alloca sul mapping senza copia (`llama-model-loader.cpp:1560-1561`). Il ramo `tensor_set` (1571) scatta se non c’è buf_mmap — non è il path di bmoe. |
| Meta GGUF / `read_gguf_meta` | **Esclusa** | `no_alloc=true` (`gguf_offsets.cpp:43`). |
| `ExpertStreamSource::init` legge tutti gli esperti | **Esclusa** | Solo size, rebind, open reader, dense policy (`expert_stream_source.cpp:27-269`). |
| Capture harvest (`RouterHook` capture) scansiona i body | **Esclusa** | Solo puntatori/nomi (`router_hook.cpp:1214-1238`). |
| Capture **decode** legge tutti i 256 esperti | **Esclusa come causa dei 11.52 GiB** | `mul_mat_id` usa solo gli id routed (8/layer). Può spiegare re-fault parziali post-reclaim, non il populate intero a t≈9.6 s. |
| `--dense-weights anon` come unica causa dei 20.76 GiB | **Esclusa** | Spiega solo `rchar≈1.62` e il log `dropped 1662 MiB`. I 19.14 GiB sono mmap fault. |
| `--cache-mb 2000` al load | **Esclusa** | La cache si riempie a runtime sui miss; init fa `vm_reserve` address-only (`expert_stream_source.cpp:158`). |
| `use_mmap=true` “di per sé” (mapping lazy) | **Esclusa** | mmap lazy **non** legge. Il danno è **`prefetch=true` → MAP_POPULATE**, non il flag mmap. |
| Fork bmoe / expert-ready hook | **Esclusa** | Hook usato a decode con `--overlap`; `init_mappings(true)` è mainline. |
| `llama_numa_init` come flag “gratis” su telefono | **Esclusa in pratica** | NUMA disattiva prefetch solo se `ggml_is_numa()` (`llama-mmap.cpp:449`); su telefono mono-nodo resta false. Non esposto da bmoe CLI. |
| Repack / `use_extra_bufts` | **Esclusa** | Forzato `false`; non causa I/O extra in questa config. |

---

## Sintesi operativa

```
20.76 GiB read_bytes
  ├─ ~19.14 GiB  page fault mmap
  │     └─ CAUSA: llama_model.cpp:1506 init_mappings(TRUE)
  │           → llama-mmap.cpp MAP_POPULATE + MADV_WILLNEED sull'intero file
  │           → thrash ×1.66 perché file 11.52 GiB > free RAM
  │
  └─ ~1.62 GiB   rchar / O_DIRECT
        └─ CAUSA: --dense-weights anon
              dense_weights.cpp read_anonymous + drop_mmap_copies
```

| Domanda | Risposta |
|---------|----------|
| Chi tocca i body esperti al load? | **Il kernel**, via `MAP_POPULATE`/`WILLNEED` di llama.cpp; non lo streamer bmoe. |
| Evitabile con flag esistente? | **No** per il grosso; `dense-weights mmap` solo per il pezzo da 1.62 GiB. |
| Fix minimo | `init_mappings(false)` (o param) nel fork submodule; decode invariato; gate 8/8 atteso verde. |
| Perché use_mmap? | Richiesto da bmoe per layout/rebind e per non allocare gli esperti in RAM; **non** implica populate eager. |

---

## File citati (indice)

| File | Righe chiave |
|------|----------------|
| `core/src/engine/session.cpp` | 405-436 load params; 594-675 streamer bind |
| `core/src/moe/expert_stream_source.cpp` | 27-269 init (no body read) |
| `core/src/moe/dense_weights.cpp` | 46-66, 84-127, 155-174 anon + drop |
| `core/src/moe/gguf_offsets.cpp` | 41-45 no_alloc meta |
| `core/src/moe/router_hook.cpp` | 1214-1238 capture pointers |
| `third_party/llama.cpp/src/llama-model.cpp` | 1506 init_mappings(true); 2301-2320 defaults |
| `third_party/llama.cpp/src/llama-model-loader.cpp` | 1342-1366, 1545-1571 |
| `third_party/llama.cpp/src/llama-mmap.cpp` | 445-466 MAP_POPULATE / WILLNEED |
| `third_party/llama.cpp/include/llama.h` | 324-327 (nessun flag prefetch) |
| `AGENTS.md` | 43-45 use_mmap + no in-tree llama patch |

DONE
