# Loader-fix — `mmap_prefetch`: togliere i 19 GiB di prefault inutile al load

**Data:** 2026-08-08  
**Host:** Samsung S23 (SM-S911U), Termux SSH `u0_a344@192.168.1.152:8022`  
**Stato alimentazione:** PLUGGED_AC (batteria ~83 %, temp batteria ~39–40 °C)  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size **11 522 702 304 B** (sha256 `2be7ef1e…`)  
**Config gate:** `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 -t 4 --ubatch 512 --temp 0 --n-expert-used 8`  
**Diagnosi di partenza:** `reports/research/loader-prefault-diagnosis.md` (E1 da F4.8: `read_bytes(load)=20.76 GiB`)  
**Stato:** COMPLETE — gate G1–G4 eseguiti; **adozione come default di campagna: NON fatta** (decide gualt).

---

## 1. Contesto

F4.8 ha misurato **20.76 GiB** letti al load per materializzarne ~2.8. La diagnosi ha isolato la causa in un solo punto mainline:

`llama-model.cpp:1506` → `ml.init_mappings(true, …)` → `MAP_POPULATE` + `MADV_WILLNEED` sull’intero GGUF.

Con `--moe-stream` gli esperti si leggono via O_DIRECT quando servono; con `--dense-weights anon` il trunk denso viene copiato fuori dall’mmap. Il prefault dell’intero file è I/O che non verrà mai usato (~19 GiB di page fault). **Nessuna flag pubblica** lo disattivava.

Questo mandato implementa **solo** l’interruttore esplicito e lo spegne quando lo streaming è attivo. Non tocca il decode. Non implementa il fix secondario (doppio passaggio dense).

---

## 2. Diff (file e righe)

### 2.1 Submodule `third_party/llama.cpp` — branch `kalsa/mmap-prefetch-opt`

Partenza pin esatto `5236140e5` → commit **`206a8fe7f`**.

| file | riga | cosa |
|---|---|---|
| `include/llama.h` | **332** (fondo struct `llama_model_params`) | `bool mmap_prefetch; // prefault the whole mapping at load (default true)` — append ABI-safe |
| `src/llama-model.cpp` | **2320** (`llama_model_default_params`) | `/*.mmap_prefetch =*/ true` — compat: chi non lo tocca non cambia |
| `src/llama-model.cpp` | **1506** | `ml.init_mappings(params.mmap_prefetch, …)` al posto di `true` hardcoded |

### 2.2 `BigMoeOnEdge` — session wiring

Commit **`026b8f0`** su `core/src/engine/session.cpp` **411–417**:

```cpp
// Streaming reads experts via O_DIRECT when needed, and --dense-weights anon copies the
// dense trunk out of the mmap; prefaulting the whole GGUF is I/O that will never be used
// (measured 19.14 GiB page-fault of 20.76 GiB load read_bytes on Qwen3.6-35B UD-IQ2_M).
// Leave mmap_prefetch=true for non-streaming loads (classic warm path).
if (cfg.moe.enabled) {
    mparams.mmap_prefetch = false;
}
```

### 2.3 Bump submodule (repo padre BigMoeOnEdge)

Commit **`f58980c`**: pin `5236140e5` → `206a8fe7f`.

### 2.4 Catena commit (già fatta dall’implementatore — **non ricommittata**)

| repo | commit | messaggio |
|---|---|---|
| llama.cpp (sub) | `206a8fe7f` | `mmap: add llama_model_params.mmap_prefetch (default true)` |
| BigMoeOnEdge | `026b8f0` | `session: disable mmap_prefetch when expert streaming is enabled` |
| BigMoeOnEdge | `f58980c` | `submodule: bump llama.cpp to kalsa/mmap-prefetch-opt` |
| moe-experiments | *(questo report)* | `reports: loader-fix mmap_prefetch G1–G4` |

Decode path: **non toccato**. Upstream llama.cpp: **non aggiornato** (un solo cambiamento).

---

## 3. PASSO 0 — rete di sicurezza

| pezzo | valore |
|---|---|
| `bmoe-cli.PREFAULT` (campagna, **non sovrascritto**) | sha256 `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` |
| GGUF | sha256 `2be7ef1ed7e1af8b10d3829102cf9a6c2bd5ddb64d675b4ece23a60799403d43` |
| pin submodule pre-modifica | `5236140e5` |
| 8 riferimenti k=8 F5.5-B | presenti su PC in `results/f5.5/b/*-k8.gen.txt` (checksum in `results/f5.5/b/prompt_sha256.txt`) |

**Nota ABI:** il binario `bmoe-cli.PREFAULT` originale non è usabile come controllo G3 post-rebuild: la struct `llama_model_params` ha un campo in più e l’ABI non combacia. Per l’A/B G3 è stato ricostruito `bmoe-cli.G3_PREFAULT` (sha256 `198c554b…`) **sullo stesso tree**, forzando `mmap_prefetch=true`, così il confronto è ABI-safe e isola solo il flag. Il PREFAULT originale resta intatto come via di ritorno campagna.

| binario gate | sha256 |
|---|---|
| `bmoe-cli.NEW` (fix attivo) | `7354947b8a16cce01dbcaf9ac79c6a4b6f9f74a1fe29eabe4c53d315a69d1331` |
| `bmoe-cli.G3_PREFAULT` (controllo ABI-safe) | `198c554b0d64df87ed2de1ca316fbc68d33df9d00bab1090e4ad8036ab162ff3` |
| `bmoe-cli.PREFAULT` (campagna, intatto) | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` |

---

## 4. Esito G1–G4

### G1 — compila — **PASS**

`build-bmoe` EXIT:0, toolchain campagna (`GGML_NATIVE=OFF`, `armv8.2-a+dotprod+i8mm+fp16`). Log: `~/experiments/results/loader-fix/g1_build.log` sul telefono.

### G2 — non-regressione 8/8 byte-identici — **PASS**

Rigenerati a `temp 0` con `bmoe-cli.NEW`, stessa config del gate, `cold_model` tra celle. Confronto sha256 vs `results/f5.5/b/*-k8.gen.txt` (verifica indipendente su PC dopo scp):

| prompt | n_gen | sha256 | esito |
|---|---:|---|---|
| short-k8 | 200 | `9a3f4175a08474fa9bf4339fac11b085449e3787cc23ed8ab848775d0cb3a008` | **MATCH** |
| f45_1_esplicativo-k8 | 200 | `2424179fe22e5cfed996029c1b3646795af28950bed80c963a2240dca5915675` | **MATCH** |
| f45_2_scrittura-k8 | 200 | `71216127365912c87c03f8908cee38d794b5f262e60092d6083fa6bf5616be13` | **MATCH** |
| f45_3_istruzioni-k8 | 200 | `baadf7b31955c23a4bdc69058eccb23e662b595abfaeed08c34fbb727caaceb0` | **MATCH** |
| f45_4_codice-k8 | 200 | `d9c57c56fa8af23b126b5e0e36f6b61a7f07895f1a250cae46ed0b9b0b621376` | **MATCH** |
| f45_5_ragionamento-k8 | 200 | `9397d763d446894d37b46be3a6d26b8b8bd8c515d018fdbc7779d2d673e71741` | **MATCH** |
| long_conversational_it-k8 | 256 | `64f6f2bd655ca0f5e50b51259fd67a4e0dca80569db1b09b8a4ef539be1f2d41` | **MATCH** |
| d1_long-k8 | 256 | `50b17f329c6c19fcb269ead312504c25a18e9b5bbde5d7ae477855b0d93c21c6` | **MATCH** |

**G2_PASS=8 G2_FAIL=0.** Nessuna differenza = nessun difetto sul percorso di decode a temp 0.

### G3 — la misura che decide — **PARZIALE (8–15 GiB)**

Cold page cache (`cold_model.sh` → `COLD_OK`) prima di ciascuna cella. Campionamento `/proc/<pid>/io` + `status` durante il load. Config identica; solo il binario cambia (G3_PREFAULT vs NEW).

| metrica | PREFAULT (G3_PREFAULT, `mmap_prefetch=true`) | NEW (`mmap_prefetch=false` via stream) | Δ | rif. F4.8 |
|---|---:|---:|---:|---:|
| **read_bytes al load** | **22.7226 GiB** | **12.0772 GiB** | **−10.65 GiB (−47 %)** | 20.76 GiB |
| rchar al load | 3.2419 GiB | 3.4119 GiB | +0.17 GiB | 1.62 GiB |
| load_seconds | 18.608 s | 10.570 s | −8.0 s | 19.6 s |
| VmHWM al load | 4536.4 MiB | 3786.2 MiB | −750 MiB | 4416 MiB |

Regola di decisione (dichiarata nel mandato, non spostata):

| condizione | verdetto |
|---|---|
| `read_bytes(load) ≤ 8 GiB` e G2 PASS | fix funziona, si adotta |
| **`read_bytes(load)` fra 8 e 15 GiB** | **parziale: riportare cosa resta a faultare** |
| nessun calo | diagnosi sbagliata |

**Verdetto G3: PARZIALE.** Il taglio c’è e coincide con la diagnosi (sparisce il bulk del MAP_POPULATE sull’intero file). Non si scende sotto 8 GiB: restano a materializzarsi al load

1. **fault lazy del warm-up** (dense + soli esperti routed, 8/layer) — necessario al capture prima del rebind streamer;
2. **O_DIRECT dense anon** (`rchar` ~3.4 GiB su questo run; in F4.8 era ~1.62 GiB — differenza di binario/strumentazione, non del flag prefault);
3. eventuale reclaim/ri-fault sotto pressione RAM durante la fase load (ordine inferiore rispetto al bulk eliminato).

Il fix secondario (evitare il doppio passaggio dense) è **mandato a parte**, come dichiarato.

> **In carica:** G3 è un **conteggio di byte**, non un verdetto di velocità. `load_s` e tok/s qui sono diagnostici e **non** entrano in `runs.csv` come misure confrontabili. Il PREFAULT di controllo (22.72 GiB) è leggermente sopra F4.8 (20.76 GiB): stesso ordine di grandezza, stesso meccanismo; l’A/B che conta è PREFAULT vs NEW sullo stesso tree.

### G4 — nessun nuovo modo di rompersi — **PASS**

- 8/8 celle G2 terminate con **rc=0** (`results/loader-fix/g4/status.txt`).
- Nessun kill, nessun marker `lmkd` / OOM / SIGKILL / segfault nei log di gate.
- Die: pre-start gate ≤80 °C rispettato (cool tra celle); HARD STOP 98 °C **mai** raggiunto (max osservata in log ~64 °C post-cella).
- RSS: VmHWM load NEW **3786 MiB** (sotto il picco PREFAULT 4536 MiB); run lunghi (d1_long prefill 1318 tok) completati senza crash.
- `bmoe-cli.PREFAULT` campagna ancora presente e non sovrascritto.

---

## 5. Cosa non dice

1. **Il fix primario da solo non chiude sotto 8 GiB.** Per arrivare alla soglia “si adotta” serve anche il lavoro sul residuale (warm-up + doppio passaggio dense). Quello è un mandato separato; non mescolato qui.
2. **Non adottare `bmoe-cli.NEW` come default di campagna** finché gualt non legge i gate e decide. I commit di codice e bump sono già in BigMoeOnEdge (`206a8fe7f` / `026b8f0` / `f58980c`); l’adozione operativa (quale binario punta la campagna) è un altro passo.
3. **G3 misura byte, non velocità.** Il calo di `load_s` (18.6 → 10.6 s) è coerente ma non è la metrica di decisione e non è comparabile cross-run come prestazione.
4. **Il PREFAULT originale non è un controllo A/B post-patch.** Usare `G3_PREFAULT` ricostruito sullo stesso tree era obbligatorio per ABI; confrontare NEW col binario campagna pre-struct avrebbe confuso il segnale.
5. **Decode invariato a temp 0** (G2 8/8) non dimostra assenza di effetti su percorsi non coperti (temp>0, k≠8, cache diversa). Dice solo: a parità di stack F5.5-B, bit-identico.

---

## 6. Artefatti

| pezzo | dove |
|---|---|
| Report | `reports/moe-loader-fix.md` (questo file) |
| Diagnosi | `reports/research/loader-prefault-diagnosis.md` |
| Mandato | `mandates/loader-fix-mmap-prefetch.md` |
| Output G2 (gen + compare) | `results/loader-fix/g2/*-k8.gen.txt`, `results/loader-fix/compare.txt` |
| G3 summary + io csv | `results/loader-fix/g3/{PREFAULT,NEW}.{summary.txt,io.csv}` |
| G4 status | `results/loader-fix/g4/status.txt` |
| Summary master | `results/loader-fix/FINAL_SUMMARY.txt`, `gates.master.log` |
| Riferimenti k=8 | `results/f5.5/b/*-k8.gen.txt` |
| Telefono (grezzi completi) | `~/experiments/results/loader-fix/` |

**Non committati:** GGUF, binari, log grezzi stderr/stdout di cella, build.

---

## 7. Verdetto complessivo

| gate | esito |
|---|---|
| G1 build | **PASS** |
| G2 8/8 byte-identici | **PASS** |
| G3 read_bytes load | **PARZIALE** (22.72 → 12.08 GiB; soglia adozione ≤8 GiB non raggiunta) |
| G4 stabilità | **PASS** |

Diagnosi confermata in direzione e ordine di grandezza. Fix primario corretto, isolato, non regressivo. **Non adozione automatica.** Prossimo pezzo naturale (se gualt lo apre): mandato fix secondario dense / residuale load, con la stessa disciplina un-cambiamento-per-volta.
