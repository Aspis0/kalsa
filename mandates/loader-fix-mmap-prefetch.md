# IMPLEMENTAZIONE — `mmap_prefetch`: togliere i 19 GiB di prefault inutile al load

Prima modifica di codice della campagna. Tocca il **percorso di caricamento**, non il decode.
La diagnosi è già fatta e archiviata: `reports/research/loader-prefault-diagnosis.md` — leggila
prima di scrivere una riga.

Repo: `C:/Users/gualt/Desktop/Kalsa/moe-experiments/BigMoeOnEdge`
Submodule: `third_party/llama.cpp` (fork Helldez, pin `5236140e5`)
Non toccare `../ai-chat`. STOP ai gate, mai `complete_goal`.

## Il fatto e la causa (dalla diagnosi, verificati)

`llama-model.cpp:1506` chiama `ml.init_mappings(true, …)`; il default di `prefetch` è `true`
(`llama-model-loader.h:189`) e fa **`MAP_POPULATE` + `MADV_WILLNEED` sull'intero GGUF**.
Nessun parametro pubblico lo disattiva.

Per noi è spreco integrale: con `--moe-stream` gli esperti si leggono via O_DIRECT quando
servono, e con `--dense-weights anon` il trunk denso viene copiato fuori dall'mmap. Misurato:
**20.76 GiB letti al load** per materializzarne ~2.8, di cui **19.14 GiB sono page fault**.

---

## PASSO 0 — LA RETE DI SICUREZZA (prima di qualunque modifica)

1. **Salva il binario di campagna**:
   `cp build-bmoe/cli/bmoe-cli build-bmoe/cli/bmoe-cli.PREFAULT` sul telefono, e registrane lo
   `sha256`. È il riferimento per l'A/B e la via di ritorno. **Non sovrascriverlo mai.**
2. Registra lo `sha256` del GGUF e il commit del submodule **prima** di toccare nulla.
3. Verifica che gli **8 riferimenti k=8** di F5.5-B siano sul PC con i loro checksum: sono il
   gate di accettazione.

## PASSO 1 — IL FORK NOSTRO

Il submodule punta al fork Helldez. La modifica va su **un nostro ramo**, non in-tree silenzioso:

1. Nel submodule, crea un branch dedicato (es. `kalsa/mmap-prefetch-opt`) **partendo dal pin
   esatto attuale** `5236140e5` — non da un aggiornamento upstream: un solo cambiamento per volta.
2. Committa lì la modifica, con un messaggio che spiega **perché** (streaming + anon rendono il
   prefault spreco integrale) e cita la misura.
3. Nel repo padre, aggiorna il puntatore del submodule e committa il bump **separatamente**
   dalla modifica, così il diff è leggibile.
4. **Non** fare push su remoti che non siano nostri. Se serve un remoto, fermati e chiedi:
   la creazione di un fork pubblico è una decisione di gualt, non tua.

## PASSO 2 — LA MODIFICA (fatta bene, non l'hardcode)

**Non** cambiare il default globale a `false`: romperebbe il caricamento classico per chi non
streamma. Serve un interruttore esplicito.

1. `llama.h` — aggiungi a `llama_model_params`:
   `bool mmap_prefetch;  // prefault the whole mapping at load (default true)`
   Mettilo **in fondo alla struct** per non spostare gli offset dei campi esistenti.
2. `llama_model_default_params()` — inizializzalo a **`true`** (compatibilità: chi non lo tocca
   non vede alcun cambiamento).
3. `llama-model.cpp:1506` — `ml.init_mappings(params.mmap_prefetch, …)`.
4. `core/src/engine/session.cpp` — dove si compongono i `llama_model_params`, imposta
   `mparams.mmap_prefetch = false` **SOLO quando lo streaming degli esperti è attivo**
   (`cfg.moe.enabled`). Fuori da quel caso, comportamento invariato.
5. Un commento sul perché, non sul cosa: *lo streaming legge gli esperti via O_DIRECT quando
   servono, quindi il prefault del GGUF intero è I/O che non verrà mai usato.*

Se durante l'implementazione scopri che la catena reale è diversa da come la descrive la
diagnosi, **fermati e riportalo** invece di adattare il codice a una descrizione sbagliata.

## PASSO 3 — I GATE DI ACCETTAZIONE (in quest'ordine, tutti obbligatori)

**G1 — compila** con la stessa toolchain e gli stessi flag della campagna (`build-bmoe`,
`GGML_NATIVE=OFF`, `armv8.2-a+dotprod+i8mm+fp16`).

**G2 — NON-REGRESSIONE 8/8 BYTE-IDENTICI.** Rigenera gli 8 prompt di riferimento a `temp 0`
con il binario nuovo e confronta lo `sha256` di ogni output con i riferimenti k=8.
A `temp 0` su questo stack gli output sono **bit-identici** — dimostrato in F5.4-D1 confrontando
`--ubatch 512` e `2048` — quindi **anche una sola differenza è un difetto, non rumore**.
Se G2 fallisce: **fermati**, non "aggiustare". Riporta quale prompt diverge e dove.

**G3 — LA MISURA CHE DECIDE.** Campiona `/proc/<pid>/io` ogni 200 ms durante il caricamento,
con i due binari, stessa config (`--moe-stream --cache-mb 2000 --dense-weights anon --ubatch 512`),
cache pagina fredda via `cold_model.sh` prima di ciascuno:

```
                        PREFAULT (rif.)      NUOVO
  read_bytes al load     20.76 GiB            ?
  rchar al load           1.62 GiB            ?
  load_seconds            19.6 s              ?
  VmHWM durante il load   4416 MiB            ?
```

REGOLA DI DECISIONE, dichiarata ora:
- `read_bytes(load) ≤ 8 GiB` **e** G2 passato → **il fix funziona**, si adotta
- `read_bytes(load)` fra 8 e 15 GiB → parziale: riportare cosa resta a faultare
- nessun calo → la diagnosi era sbagliata: **riportalo**, non insistere

**G4 — nessun nuovo modo di rompersi**: il run arriva in fondo, RSS sana, nessun kill.

## PASSO 4 — COSA NON FARE

- **Non** toccare il percorso di decode. Se un cambiamento lo sfiora, fermati.
- **Non** aggiornare llama.cpp upstream insieme a questa modifica: un cambiamento per volta,
  altrimenti se qualcosa si rompe non sapremo quale dei due.
- **Non** implementare anche il fix secondario (il doppio passaggio dense). È un mandato a parte:
  prima si misura quanto vale il primo da solo.
- **Non** cancellare né sovrascrivere `bmoe-cli.PREFAULT`.

## REPORT

`reports/moe-loader-fix.md`, italiano: il diff (file e righe), l'esito di G1-G4 con i numeri,
la tabella prima/dopo, e la sezione "cosa non dice". Committa modifica, bump del submodule e
report. Poi **FERMATI**: la decisione di adottare il nuovo binario come default di campagna la
prendo io dopo aver letto i gate.
