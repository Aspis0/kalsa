# F0.4 — Audit BigMoeOnEdge — 2026-08-03

> Audit ostile (security + engineering) del progetto `Helldez/BigMoeOnEdge`.
> Obiettivo: decidere se costruire F4/F8 su questo codebase o su mainline llama.cpp (+PR #26003).
> Contesto di contenimento (§7-F0.4 / §11): device S23 VERGINE dedicato; build SOLO da sorgente a commit pinnato; mai binari/release precompilati del fork.

## Cosa è stato fatto (vs piano)

- Clonato `Helldez/BigMoeOnEdge` in `./BigMoeOnEdge` (gitignored) e registrato HEAD esatto.
- Clonato `ggml-org/llama.cpp` in `./llama.cpp` (storia completa, filter blob:none).
- Inizializzato il submodule `third_party/llama.cpp` (= `Helldez/llama.cpp`, non lo stesso tree del monorepo).
- Calcolato merge-base / divergenza del submodule vs `upstream/master`.
- Passata di sicurezza su tree del monorepo (src, CMake, workflows, app Android): rete/exec/obfuscation + diff build-time fetch.
- Review ingegneristica del path di streaming: thread model, LRU, race, mmap/rebind, failure modes, flag CLI, semantica di `k`, hook di strumentazione.
- F0.1 non presente in `reports/` al momento della scrittura: stato del fork verificato direttamente sul clone.

**Correzione strutturale rispetto al piano.** Il piano parlava di "fork llama.cpp con flag custom". In realtà BigMoeOnEdge **non è un fork git di llama.cpp con storia condivisa**. È un monorepo autonomo (Apache-2.0, 340 commit, v0.19.0) che:
1. usa `llama.cpp` come **submodule** (`third_party/llama.cpp` → `Helldez/llama.cpp.git`);
2. implementa lo streaming **sopra** la public API (`cb_eval` + gguf offsets + rebind di `tensor->data`);
3. porta **un solo commit** di patch sul submodule (~28 righe) solo per `--overlap`.

Questo cambia positivamente sia il rischio di sicurezza sia la strategia F8.

## Numeri chiave (commit pinnato, base upstream, diff stat, righe di codice streaming)

| Voce | Valore |
|---|---|
| **BigMoeOnEdge HEAD (pinnato)** | `b0c4e5bfffd5b10ec636ad7edd7d5a0564c790a1` |
| Data HEAD | 2026-08-02 06:44:40 +0200 |
| Subject | `docs: say less and mean it, in the parts of the README that were selling (#154)` |
| Versione dichiarata | 0.19.0 (CMake `project(... VERSION 0.19.0)`) |
| Licenza monorepo | Apache-2.0 |
| Commit monorepo | 340 (primo: 2026-07-10 bootstrap) |
| Autore dominante | Helldez (371 entries shortlog) |
| **Submodule llama.cpp pin** | `5236140e514d5ceef2b801815b3ba9330f19732e` |
| Data pin | 2026-07-11 20:39:03 +0200 |
| Subject pin | `ggml-cpu : add expert-ready hook for mul_mat_id (expert streaming)` |
| **Base upstream del pin** | `22b69b6e92e831442fdd287901816ce3aa8a2b43` (2026-07-10, `arg: prevent duplicate spec model downloads (#25527)`) |
| Diff submodule vs base | **+28 righe / 2 file** (`ggml/include/ggml-cpu.h`, `ggml/src/ggml-cpu/ggml-cpu.c`) |
| Commit del fork submodule vs base | **1** (solo l'hook expert-ready) |
| Commit di Helldez/llama.cpp `master` oltre upstream | **0** (master del fork = upstream al momento del pin; HEAD del pin è l'unico commit "in avanti") |
| Submodule vs upstream/master attuale | pin è **antenato**; upstream è **~328 commit avanti** (submodule stantio di ~3 settimane rispetto al 2026-08-03) |
| LOC streaming core (`core/src/moe/*` + `core/src/io/*` + `expert_source.h`) | **~5359** |
| LOC session/engine | `session.cpp` 1535 + runtime/chat/thinking/ngram ~300 |
| File monorepo (no submodule content) | 379 tracked |
| Branch remoti rilevanti monorepo | `main`, `docs/cache-sizing-in-token-cycles`, `exp/thread-affinity`, `perf/odirect-zero-copy` |

### Diff monorepo vs "upstream di pari data"

Non applicabile come `git diff base HEAD` su un tree condiviso: BigMoeOnEdge **non condivide storia** con `ggml-org/llama.cpp`. Il "diff" rilevante è:

1. **intero monorepo bmoe** (engine proprio, ~8–10 kLOC C++/Kotlin rilevanti);
2. **patch submodule** di 28 righe citata sopra.

### File nuovi introdotti dal progetto (non presenti in llama.cpp)

- `core/` — engine streaming (MoE, I/O, dense weights, metrics, session)
- `cli/main.cpp` — `bmoe-cli` (non `llama-cli`)
- `examples/android/` — app Compose di demo + downloader modelli
- `tests/` — gate di byte-identity (G1…G13…)
- `scripts/` — bench/analyze (host + Termux)
- `docs/` + `docs/bench-data/` — documentazione e CSV di campagna
- `tools/` — diagnostica opzionale

## Risultati audit per punto

### (a) Sicurezza — codice malevolo / rete / exec

**Verdetto: NO RED FLAGS di sicurezza (gate F0).**

Cosa è stato cercato (tree monorepo, escl. submodule e docs di bench):
`curl|wget|http|socket|connect(|sendto|exec(|system(|popen|fork(|base64|eval(|/bin/sh|bash -c|telemetry|analytics|crashreport|api[_-]?key|token`.

**Hit ispezionati e classificazione:**

| Hit | Giudizio |
|---|---|
| `LLAMA_CURL OFF` in `CMakeLists.txt` | **Benigno e difensivo**: disabilita esplicitamente il path di download modelli di llama.cpp `common` |
| `cli/main.cpp` "telemetry" / `BMOE_PROGRESS` / `BMOE_DONE` | **Locale**: JSON/CSV di metrica verso stdout/file, non esfiltra nulla |
| `scripts/*.sh` shebang `#!/system/bin/sh` | **Benigno**: script Termux di bench |
| `examples/android/gradlew` `/bin/sh` | **Standard Gradle wrapper** |
| `DownloadWorker.kt` + `ModelDownloader.kt` + `HttpURLConnection` | **Feature legittima dell'app**: download modelli da URL catalogo HuggingFace (http/https only, scheme check). **Non** nel path CLI/`bmoe-cli` che useremo in F4 |
| `ModelCatalog.kt` URL `huggingface.co/...gguf?download=true` | Catalogo hardcoded di GGUF pubblici; nessun endpoint del progetto Helldez |
| CI `.github/workflows/ci.yml` | Build + `ctest` byte-identity; `actions/checkout@v5`, apt, cmake, ninja. Niente download di payload arbitrari a runtime |
| `release-apk.yml` | Build NDK arm64, stage jniLibs, firma con secrets GitHub (keystore). Produce APK — **non lo useremo** (regola: mai binari precompilati) |
| `gradle-wrapper.jar` | Binario vendored standard Gradle (43 KB). Atteso in progetti Android; non è un payload del fork MoE |
| `system(`/`popen`/`exec(`/`fork(` nel core C++ | **Nessun hit** nel codice engine |
| Blob base64 / file nascosti sospetti / estensioni strane | **Nessuno** (solo `.clang-format`, `.gitmodules`, `.github`) |
| Telemetria esterna / analytics / crash reporter | **Assente** |
| API key / token hardcoded | **Assente** |

**Nota di minaccia residuale (non red flag di gate):** l'app Android può scaricare da URL http(s) arbitrari se l'utente li passa a `ModelDownloader` (solo scheme check). Sul device vergine e con uso **solo di `bmoe-cli` da sorgente** questo path non viene esercitato. Non è codice malevolo: è un downloader di modelli.

**Diff network/exec del submodule vs base:** l'unico commit aggiunge un callback process-global in `mul_mat_id`. Zero rete, zero exec, zero I/O.

### (f) Build system

| Meccanismo | Presente? | Origine | Fetch di rete a build-time? |
|---|---|---|---|
| `add_subdirectory(third_party/llama.cpp)` | Sì | monorepo | No (submodule locale; richiede `git submodule update`) |
| `FetchContent` / `ExternalProject` | **No** | — | — |
| `file(DOWNLOAD` | **No** | — | — |
| `curl` / `wget` in CMake custom commands | **No** | — | — |
| `LLAMA_CURL` | **OFF forzato** | monorepo | No |
| Submodule `Helldez/llama.cpp` | Sì | monorepo | Solo a `git submodule update` (fonte git, non build) |
| Detection hook via `file(READ ggml-cpu.h)` + regex | Sì | monorepo | No — legge header locale, setta `BMOE_HAVE_EXPERT_READY_HOOK` |
| Gradle wrapper + NDK toolchain (Android) | Sì | monorepo | NDK/deps Android standard in CI; non nel path Termux CLI |
| Patch applicate a build-time | **No** | — | L'hook è già committato nel submodule |
| Binari vendored nel core streaming | **No** | — | Solo `gradle-wrapper.jar` (Android) |

**Verdetto build: pulito.** Nessun red flag di fetch a build-time introdotto dal fork. Il percorso di build che useremo (Termux / NDK CLI, `bmoe-cli`) non scarica nulla.

### (b) Correttezza dello streaming — review ingegneristica

#### Architettura (due piani)

1. **Seam pubblica (serial path, zero patch):**
   - `llama_context_params.cb_eval` isola `ffn_moe_topk-<il>`;
   - non-ask callback legge gli expert id (I32, stride-aware);
   - `gguf_get_*_offset` per offset byte per tensore;
   - rebind di `ggml_tensor->data` su buffer proprietari;
   - `load_layer()` legge solo le slice routed da flash (`O_DIRECT` default).

2. **Hook fork (~28 righe, solo `--overlap`):**
   - `ggml_cpu_set_expert_ready_hook` process-global;
   - chiamato da `ggml_compute_forward_mul_mat_id` **prima** di leggere le row di ogni expert;
   - zero-cost se NULL (un check).

Documentato in `docs/seam.md`. Serial path compila contro stock upstream.

#### Thread model

| Thread | Ruolo |
|---|---|
| **Eval / llama decode** | Unico mutatore della LRU (`touch_entry`, `lru_*`, `evict_tail`, `quiesce_spec`, `retain`). Chiama `load_layer` dal callback. |
| **I/O pool** (`io_threads`, default 4; max 8) | Worker che drenano `jobs_` (batch demand) e `spec_jobs_` (prefetch). Solo leggono byte → buffer già committed. **Non** toccano LRU. |
| **Compute threads** (pool ggml-cpu) | Solo in overlap: chiamano `on_expert_ready` e spin/wait su `ReadyFlag` per (proj, expert). |
| **Prediction worker** (`pred_worker_`) | Opzionale: GEMV del gate per `--predict-prefetch` / route-ahead, off del critical path. |

Sincronizzazione I/O: `io_mtx_` + `io_cv_` / `io_cv_done_`, generazione `batch_gen_`.
Sincronizzazione overlap: `ReadyFlag.gen` atomico (seq_cst sul path waiter/publisher) + `ready_cv_` + contatore `ready_waiters_` per evitare `notify_all` inutili.

#### Buffer / cache data structure

- **Cache OFF (`cache_mb=0`):** 1 slot allineato full-size per proiezione (gate/up/down o fused), riusato da ogni layer. Ogni token ri-legge le slice routed. Nessuna hit.
- **Cache ON (LRU):** per ogni `(layer, projection)` un range `vm_reserve` (address-only, `MAP_PRIVATE|MAP_ANONYMOUS|MAP_NORESERVE` su POSIX). Pagine fisiche con `vm_commit` al miss; `vm_evict` (`madvise MADV_DONTNEED`) all'eviction. Entry key = `il * n_expert + e`. Lista doppiamente linkata `cprev_/cnext_`, head=MRU, tail=LRU. Contatori `chits_/clookups_`, `evictions_/rereads_`, `cspec_` (entry riempita da prefetch).

Rebind all'init (`expert_stream_source.cpp:139-163`):
```cpp
L.proj[p].tensor->data = lbuf_[p][il];  // o slot_[p] se cache off
```
`mul_mat_id` vede l'expert all'offset canonico `e * nb[2]` dentro quel buffer. **Non** unmap del file GGUF degli esperti: i tensor expert non puntano più al mmap del modello, puntano ai buffer bmoe. Il file resta aperto via `FileReader` (fd pool, positioned read, O_DIRECT).

#### Race / UAF / coherency — punti critici

**1. Barriera eval-callback (serial) — corretta per costruzione.**
Il topk è isolato e sincronizzato prima di `load_layer`; il matmul esperti parte dopo il return. Un layer non può sovrascrivere le slice del precedente finché il matmul non è sincronizzato (`docs/seam.md`, header di `expert_stream_source.h`).

**2. Overlap: drain del batch precedente prima di riusare `jobs_`/flag** (`load_layer_async` ~1046-1055):
```cpp
io_cv_done_.wait(lk, [&] { return done_cnt_ == batch_njobs_ || io_stop_; });
```
Garantisce che nessun worker stia ancora scrivendo una pagina che l'eviction sta per rilasciare.

**3. Eviction solo su eval thread, dopo quiesce_spec** — i worker non mutano LRU. Spec integrate fallisce-safe: non integra entry con `spec_remaining_ != 0` (evita il "segfault" documentato nel commento a `spec_integrate_done`, ~785-791: decommit di pagine che una lane stava scrivendo).

**4. `on_expert_ready` fail-fast su layer mismatch** (~1285-1291): se il kernel chiede un layer non staged → `fatal_` + wake, non hang.

**5. Publisher/waiter handshake seq_cst** (~1310-1322, e simmetrico in `io_drain` ~332-342): o il compute vede il flag e non dorme, o il publisher vede `ready_waiters_ != 0` e notifica. Disegnato per non perdere wakeup.

**6. Prefetch stage-then-publish** (~378-400): job speculativi pubblicati solo dopo commit di **tutte** le proiezioni dell'expert; un fallimento mid-expert non lascia job orfani su accounting non inizializzato.

**7. Drop-cold scrive nei tensor scratch del grafo** (non nei pesi del modello): azzera weight e reindirizza id al top expert. Documentato come lossy by design; le gate G8* coprono la machinery, non l'output.

#### Failure modes

| Fallimento | Comportamento |
|---|---|
| I/O read error | `io_err_`; in overlap anche `fatal_`; `llama_set_abort_callback` osserva `fatal_` e abortisce il grafo invece di computare su pesi a metà |
| `vm_commit` OOM | `touch_entry`/`commit_proj_pages` ritorna false → load fallisce / `fatal_` in async; messaggio `bmoe: commit failed` |
| `vm_reserve` init fail | `init()` false, streaming non parte |
| Hook assente + `--overlap` | `run()` fail-fast (richiede `BMOE_HAVE_EXPERT_READY_HOOK`) |
| Modello non MoE + `--moe-stream` | fail-fast a init |
| Layout tensor non previsto | binding per-arch via registry; layer non bound restano mmap-resident (shared expert, dense blocks) |

#### Assunzioni di layout GGUF / grafo

- Nomi grafo `ffn_moe_topk-<il>`, catena `ffn_moe_weights*`, tensor `blk.<il>.ffn_{gate,up,down}_exps` (o fused `ffn_gate_up_exps`).
- Expert contiguity: **per tensore** lungo dim 2 con stride `nb[2]`; non richiede contiguity cross-layer nel file.
- Multi-shard: ogni tensore mappa a `(file_idx, offset)` via `gguf_offsets`.
- Arch supportate (registry): `qwen3moe`, `qwen2moe`, `qwen35moe` (**target del piano**), `gemma4`, `gpt-oss`, `lfm2moe`, `deepseek4`.
- `use_mmap = true` obbligatorio al load (session.cpp ~404-407): serve il file-backed layout; niente repack.
- Shared experts / leading dense blocks **non** streamati (restano mmap o anon dense policy).

#### Rischi di correttezza residui (non bloccanti per il gate, rilevanti per F4/F8)

1. **Submodule ~3 settimane indietro** su upstream: bump non banale se l'API `common_chat_*` o i nomi grafo MoE cambiano. Il seam è deliberatamente stretto, ma va ri-verificato a ogni bump (`docs/seam.md`).
2. **Dipendenza da naming interno del grafo** (`ffn_moe_topk-…`): non è ABI stabile di llama.cpp; un refactor upstream del builder MoE rompe il hook senza errori di compilazione. Mitigazione: gate di byte-identity + fail rumoroso se il topk non matcha.
3. **`--drop-cold-experts` non riproducibile** (state-dependent). OK come knob lossy; **non** usarlo come baseline scientifica senza fissare seed di cache (o tenerlo off).
4. **Limitazioni dichiarate** (`docs/limitations.md`): esperti streamati solo su CPU; n=1 era la premessa storica — oggi c'è self-spec (MTP/ngram) ma allarga il read-set (documentato). GPU MoE offload non supportato (allineato al nostro piano: CPU-only su Adreno 740).
5. **Process-global hook**: non thread-safe rispetto a compute concorrente al register/unregister. Il codice registra prima del decode e smonta in `shutdown()` prima di distruggere lo source — corretto se si rispetta il lifecycle della `Session`.

**Giudizio correttezza:** implementazione matura per un progetto di ~3 settimane di età. Ingegneria difensiva visibile (commenti che citano bug reali già chiusi: segfault integrate, false-share ReadyFlag, two-wave publish, drop duplicate promote). Gate di byte-identity seriali (streamed == resident) sono un segnale forte. Non ho eseguito i test su questo host (fuori scope F0.4 statico); vanno rilanciati in F0.5/F4.

### (c) Semantica esatta dei flag CLI + parametro `k`

Fonte: `core/include/bmoe/config.h`, `cli/main.cpp`, `README.md`, `docs/expert-dropping.md`, `docs/benchmarks.md`.

| Flag | Semantica | Default CLI | Default app |
|---|---|---|---|
| `--moe-stream` | Abilita streaming esperti on-demand (fail se modello non MoE) | off | on (se non mmap baseline) |
| `--cache-mb N\|auto` | Budget **LRU expert cache in MiB**. `0` = off (shared slots, re-read ogni token). `auto` = size once at load = available RAM − `cache_floor_mb`, clamp `[cache_min_mb, total expert bytes]`, opz. `cache_ceil_mb`. Banda patologica `1..1499` rifiutata salvo `--force-cache` (`cache_min_mb=1500`). **Copre solo slice esperti cached**, non dense weights né KV. | `0` (env `BMOE_CACHE_MB` se flag assente) | `2000` o `auto` |
| `--cache-floor-mb N` | Con auto: RAM da lasciare libera | 1536 | — |
| `--cache-ceil-mb N` | Con auto: cap superiore (0 = solo full expert set) | 0 | — |
| `--dense-weights M` | Policy pesi **non-expert** (header, emb, attn, norms, lm_head, shared expert): `mmap` \| `warm` \| `anon` \| `ahwb`. `anon` = O_DIRECT → buffer anonimi + rebind (reclaim → zram, non flash). `ahwb` = Android AHardwareBuffer reclaim-exempt (cap 2047 MiB/buffer). | `anon` | `anon` (ahwb opzionale) |
| `--drop-cold-experts F` | `F ∈ (0,1]`. Salta un expert **routed** sse è **cache MISS** e weight `< F × (1/top-k)`. Hit residenti girano sempre. Top-weighted expert pinnato (routing mai vuoto). `drop_renorm=true` di default. Prefill off di default (`drop_prefill`). **Lossy e non riproducibile.** Richiede cache on. | `0` (off) | app rungs 50/75/100 % → F=0.5/0.75/1.0 (default app 75%) |
| `--n-expert-used N` | Override del top-k del modello (kv_override su `expert_used_count`). Lossy ma **deterministico**. | `0` = modello | opzioni 6/4/3/2 |
| `--io-threads N` | Lane di lettura parallele (incl. calling thread in serial) | 4 | 4 |
| `--overlap` | I/O async + wait per-expert via hook fork | off | on |
| `--prefetch K` | Prefetch temporale: mentre calcola layer l, legge esperti del **token precedente** a l+1..l+K | 0 | exp. |
| `--predict-prefetch` + `--predict-spec-max M` | Prefetch predittivo (gate early); M = max miss speculati/layer | off / 2 | exp. |
| `--route-ahead N` | Sostituisce il routing di layer L con ranking prodotto N layer prima (lossy) | 0 | exp. |
| `--load-all` | Debug: carica TUTTI gli expert ogni token | off | — |
| `--mtp` / `--ngram` + `--draft` | Self-speculative decode | off | exp. |

#### Cos'è `k` nelle tabelle di benchmark del fork

**`k` = `n_expert_used` = top-k del routing**, cioè quanti esperti ogni token attiva per layer.

- README: *"`k` is how many experts each token routes to, i.e. `n_expert_used`"*.
- Tabelle "Turbo top-k": default del modello (es. Qwen top-8) vs `--n-expert-used 6` (righe `k=6`).
- **Non** è un parametro di eviction, né di `--drop-cold-experts`.
- Interazione con drop-cold: la soglia effettiva è `F / k` della massa di routing. A k=8, F=0.75 → soglia 9.375%; a k=2, F=0.75 → 37.5% (warning automatico se `k ≤ drop_low_topk_warn=4`).

Per F4 del nostro piano: i valori di `k` da griglia sono **override di top-k** (`--n-expert-used`), separati da on/off di `--drop-cold-experts F`.

### (d) Policy di eviction

**LRU classica** (lista doppiamente linkata, head=MRU, tail=LRU).

Codice di selezione (`expert_stream_source.cpp:728-737`):
```cpp
void ExpertStreamSource::evict_tail() {
    const int32_t id = ctail_;   // coldest
    ++evictions_;
    ever_evicted_[id] = 1;
    release_entry_pages(id);     // madvise MADV_DONTNEED sulle pagine intere della slice
    cvalid_[id] = 0;
    cspec_[id] = 0;
    cresident_ -= entry_bytes(id / n_expert_);
    lru_unlink(id);
}
```
Trigger: dopo lo staging di un layer, `while (cresident_ > cache_max_ && ctail_ != -1) evict_tail();`.

Varianti sul tema LRU (non LFU/ARC/Clock):
- Hit / miss demand → `lru_push_front` (MRU).
- Prefetch indovinato male → `lru_push_back` (entra cold, primo a uscire).
- Route-ahead committed → `lru_push_front` (entra hot: non è un guess).
- `retain()` promuove residenti predetti senza contare hit.

**Non è:** LFU, Clock, ARC, cost-aware (tutte le entry costano `entry_bytes(il)`, l'ordine è solo recency). Un esperimento `layer-lfu` è citato in `docs/roadmap.md` come negato/archiviato.

**Contatori hit/miss:** sì, e già esposti:
- `chits_ / clookups_` → `Stats::cache_hits / cache_lookups` → `cache_hit_pct` in summary, CSV, `BMOE_PROGRESS`, `BMOE_DONE`;
- `evictions_`, `rereads_` loggati come `moe-cache: N evictions, M re-reads`.

### (e) Hook di strumentazione

| Bisogno piano | Stato nel fork | Dove agganciare (minimo patch) |
|---|---|---|
| **(i) per-token expert activation log** (expert ids per layer per token) — F7.1 | **Già presente** come `--route-trace` | `RouterHook` al nodo topk: `router_hook.cpp` ~1328-1399 (gather ids, weight, residency, dropped). Schema: `core/include/bmoe/route_trace.h` (`RouteTraceRow`: step, layer, slot, expert, weight, residency, dropped). Sink: `core/src/metrics/route_trace_sink.cpp`. **Patch minima per F7.1: 0 righe** se il formato CSV del trace va bene; altrimenti un sink alternativo sulla stessa callback. |
| **(ii) cache hit/miss counters** — metrica primaria F4 | **Già presenti e loggati** | `ExpertStreamSource::touch_entry` `expert_stream_source.cpp:884-918` (`clookups_++`, `chits_++` su hit). Esportati in `stats()` :1349-1350. Summary CLI `moe-cache: X% hit` (`cli/main.cpp:843-857`). CSV col `cache_hit_pct`. **Patch minima: 0**. |
| **(iii) prefetch trigger points** | Esistono due path | (1) **Temporal:** `RouterHook` dopo load layer l emette `source_->prefetch(l+k, prev_ids)` (vedi `set_prefetch_layers`, `prefetch_layers_`). (2) **Predictive:** `predict_at_topk` / worker → `source_->prefetch` + `retain` (`router_hook.h` ~104-113, ~284-323). Implementazione coda: `ExpertStreamSource::prefetch` `expert_stream_source.cpp:378+`. Per un predictor nostro (F8): nuovo caller su `IExpertSource::prefetch/retain` senza toccare la LRU. |

**Hit-rate già in log output:** sì — `moe-cache: %.1f%% hit`, JSON progress `cache_hit_pct`, CSV per-token e summary di run. Inoltre `moe-stream: read X MiB (Y MiB/token)`, stall/compute/mgmt split, evictions/rereads.

## Deviazioni / sorprese / bug

1. **Sorpresa maggiore:** non è un fork monolitico di llama.cpp. È un engine esterno + submodule + 28 righe di hook. Il piano va riletto con questa architettura (F0.5 build scripts, F4 cmdline = `bmoe-cli` non `llama-cli`).
2. **`k` ≠ drop-cold.** Il piano sospettava ambiguità: chiarito — `k` è top-k (`--n-expert-used`).
3. **Hit-rate e route-trace già production-grade** per le nostre metriche F4/F7: meno patch di strumentazione del previsto.
4. **Submodule stantio (~328 commit dietro upstream al 2026-08-03):** rischio di bit-rot su arch/model support se aspettiamo mesi; per F4 sul target `qwen35moe` il pin di luglio 2026 è sufficiente (il modello è già in registry).
5. **App Android con downloader di rete:** fuori dal path di misura; non alzare il gate, ma non installare APK di release.
6. **Limitations.md dice "n=1 only / no speculative"** ma il tree ha MTP/ngram: doc parzialmente superata. Self-spec esiste ed è misurata come trade-off di read-set.
7. **Nessun bug di sicurezza trovato.** Bug di correttezza aperti non emersi dalla sola lettura; la suite di gate nel repo è il vero oracolo (da far girare in F0.5 su host).
8. **F0.1 assente** in `reports/` al momento dell'audit: non bloccante per F0.4 (stato repo verificato sul clone).

## Verdetto gate: PASS

**Security (a)+(f): nessun red flag** — niente rete/exec malevolo nel core, niente fetch a build-time, patch submodule minima e ispezionata (+28 righe, solo callback), `LLAMA_CURL=OFF`, telemetria solo locale.

Condizioni operative vincolanti (già nel piano, ribadite):
- build **solo da sorgente** a commit pinnato `b0c4e5b` (monorepo) + submodule `5236140e5`;
- **mai** APK/release precompilati;
- path di misura = `bmoe-cli` in Termux, non l'app store-like;
- device vergine, Termux senza storage permission.

Engineering: codebase usabile come base F4; strumentazione F4/F7.1 già presente.

## Prossima azione proposta

1. **F0.5** — scrivere gli script di build Termux/NDK per **questo** tree (`cmake -S BigMoeOnEdge -B build`, submodule init, `bmoe-cli`, flags auto dotprod/i8mm, `LLAMA_CURL=OFF`, `GGML_OPENCL=OFF`). Smoke: `--help` + gate `ctest` su host se fattibile.
2. **F0.6** — download UD-IQ2_M + gguf-dump (invariato).
3. **F4** — campagna su S23 con `bmoe-cli --moe-stream`, griglia:
   - `--cache-mb {0, auto, 1500, 2000}` (rispetto al floor 1500),
   - `--dense-weights anon` (e A/B `ahwb` se build Android lo espone),
   - `--n-expert-used {0, 6, 4}` (= k),
   - `--drop-cold-experts {0, 0.75}`,
   - `--overlap` on (richiede il pin con hook),
   - metriche native: `cache_hit_pct`, MiB/token, tok/s + harness F0.3 (majflt, io, temp).
4. **F7.1** — usare `--route-trace` as-is; convertire al formato del simulatore se serve.

### Raccomandazione strategia F8

**Patchare / estendere BigMoeOnEdge (il monorepo), non riscrivere da zero su mainline+#26003.**

Motivazione:
- Lo streaming expert-selective con LRU + O_DIRECT + dense-anon + overlap + route-trace è **già il prodotto di F4–F7**. Mainline `#26003` (`--lazy-experts`) risolve un pezzo più basso (caricamento pigro) e **non** offre cache DRAM predittiva, drop-cold, dense policy, nè i counter che ci servono.
- Il seam è pulito: quasi tutto vive fuori da llama.cpp; la patch interna è 28 righe con sunset esplicito. Portare un predictor F8 = nuovo codice su `IExpertSource::prefetch/retain` + hook nel `RouterHook`, senza toccare ggml.
- Costo di abbandono: riscrivere ~5–8 kLOC di I/O/cache/metrics collaudati, più i gate.
- Rischio del restare: submodule da bumpare periodicamente; naming grafo fragile. Mitigazione: pin + gate CI + procedura di bump documentata in `docs/seam.md`.
- **Piano B** resta valido se F4 mostra immaturità runtime (crash, silent wrong, thrash non governabile): mainline + PR #26003 a mano + nostra cache (F8 anticipata). Oggi non c'è evidenza per attivarlo.
- **Non** usare l'APK demo come veicolo di misura; solo `bmoe-cli`.

**In sintesi:** gate F0 di sicurezza **PASS**; base tecnica **adottabile**; F8 = predittore sopra `IExpertSource` in questo monorepo, con submodule pin auditato.

DONE
