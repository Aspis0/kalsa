# MANDATO — dense double-pass: non rileggere da flash ciò che è già in RAM

Il pezzo mancante di E1. Base: fork `main` @ `2c675a5` (fix KV adottato, CAMPAIGN =
`ede3ac7c…`). Diagnosi di riferimento: `reports/research/loader-prefault-diagnosis.md`
(sezione "Fix secondario").

**Regole fisse:** non toccare `../ai-chat`; STOP ai gate, mai `complete_goal`; binario di
lavoro → `bmoe-cli.DENSE2`, CAMPAIGN/PREFAULT intatti; adozione decisa da gualt dopo i
gate. Conteggi citabili in carica; nessun timing citabile.

---

## Il difetto (dalla diagnosi, non da rifare)

Con `--dense-weights anon` il trunk denso viene letto **due volte**:
1. il capture warm-up (`session.cpp:594-614`) lo faulta nel page cache via mmap;
2. `read_anonymous` (`dense_weights.cpp:84-127`, read a ~117-120) lo **rilegge da flash**
   con O_DIRECT nel buffer anon, poi `drop_mmap_copies` butta le pagine mmap.

Il secondo passaggio vale **~1.62 GiB** di flash (misurato: `rchar` a load, stabile in
tutti i G3). In più, dopo il rebind degli esperti le pagine mmap **esperto** toccate dal
warm-up restano orfane in page cache (nessun drop simmetrico): pressione inutile.

## Il fix — due pezzi indipendenti, stesso mandato

### Pezzo 1 — memcpy invece di O_DIRECT quando le pagine sono residenti

In `read_anonymous`: se `tensor->data` punta ancora dentro l'mmap, verificare la residenza
delle pagine della range (`mincore`) e:
- range **residente** → `memcpy` nel buffer anon (zero flash);
- range **non residente** (reclaim sotto pressione) → O_DIRECT come oggi, **per quella
  range** — mai un fallback globale.

~20-40 righe in `dense_weights.cpp`. Il decode non si tocca: cambia solo COME il buffer
anon viene riempito, non cosa contiene (il gate di byte-identità lo prova).

### Pezzo 2 — drop delle pagine mmap esperto dopo il rebind

Simmetrico a `drop_mmap_copies` ma sulle range **esperti** toccate dal warm-up
(`expert_stream_source.cpp:136-164` è il punto del rebind; il drop va dopo). Non riduce
I/O già speso: riduce la page cache orfana e la pressione che causa re-fault. `madvise
DONTNEED` sulle range esperto del mapping.

**Commit separati** (uno per pezzo), Conventional Commits, inglese.

## Gate (dichiarati ora)

**G-D1 — byte-identità 8/8.** `bmoe-cli.DENSE2` vs ref `results/f5.5/b/*-k8.gen.txt`,
path `-p`, config G-A esatta, prompt sha verificati. Attesa: identici (il decode legge lo
stesso buffer anon). Una differenza = difetto: STOP. (`ALLOW_UNPINNED=1` annotato: gate,
non misura.)

**G-D2 — la misura che decide.** Harness G3 già collaudato (`scripts/run_g3_redo.sh`:
confine = riga `bmoe: expert streaming ON`, sampler on-device ~200 ms con gate mediana
≤400 ms): A/B **CAMPAIGN vs DENSE2**, cache fredda (fadvise) prima di ogni run, 2
ripetizioni per braccio (3ª se scarto >15%).

| metrica | attesa dichiarata |
|---|---|
| `read_bytes_at_load` | CAMPAIGN ~10.3 GiB → DENSE2 **~8.7 GiB** (−1.62 del memcpy); sotto 8 possibile se cala anche il re-fault da pressione |
| `rchar_at_load` | ~1.65 → **~0.03-0.1 GiB** (sparisce l'O_DIRECT dense) — questa è la firma specifica del Pezzo 1: se non crolla, il memcpy non sta scattando |
| `VmHWM` | non deve **salire** (il memcpy non alloca nulla di nuovo) |

**Regole di decisione:**

| esito (mediane) | conclusione |
|---|---|
| Δread_bytes ≥ 1.3 GiB e rchar crollato e VmHWM non peggiorato | **PASS** — proporre adozione (re-pin deciso da gualt) |
| Δ fra 0.5 e 1.3 GiB | PARZIALE — riportare quante range sono cadute nel fallback O_DIRECT (contatore nel log, una riga) e perché |
| Δ < 0.5 GiB o rchar invariato | il memcpy non scatta (pagine già reclaimate al momento della conversione, o `tensor->data` non punta più all'mmap): STOP e riportare la diagnosi, non forzare |
| VmHWM peggiora | STOP: il drop/memcpy sta interagendo male con la pressione |

**Strumentazione richiesta nel binario** (permanente, una riga ciascuna): a fine
conversione dense, log `dense-anon: memcpy=<MiB> odirect=<MiB> ranges_fallback=<n>`; dopo
il drop esperti, log `expert-mmap: dropped <MiB>`. Sono le due righe che rendono G-D2
interpretabile senza indovinare.

## ADDENDUM (2026-08-08, dopo la riclassificazione del riavvio delle 15:21)

Il riavvio di ieri a metà suite è **inspiegato** (gualt non c'era; `LAST_KMSG_KP` senza
stack). Da questo mandato in poi, per ogni run:

1. **Flight recorder**: un loop leggero che ogni ~5 s appende su file in flash
   `timestamp, die °C, memfree, batteria%` con flush/fsync per riga (il sampler G3 fa già
   quasi tutto: basta tenerne acceso una variante minima per l'intera suite, non solo al
   load). File in `~/experiments/results/dense2/flight.log`. Se il telefono muore, l'ultima
   riga è la testimonianza.
2. **A ogni boot inatteso** (uptime < inizio suite): PRIMA di ogni altra azione, catturare
   `getprop persist.sys.boot.reason.history` + `dumpsys dropbox | tail -30` e salvarli.
   Poi STOP e riportare: un secondo riavvio inspiegato ferma la campagna.

## Deliverable

`reports/moe-dense2.md`: commit hash (2), tabella G-D1, tabella G-D2 con le due righe di
log per run, verdetto secondo le regole, sha256 di DENSE2, e conferma che il flight
recorder era attivo (+ ultima riga registrata). Artefatti in `results/dense2/`.
**STOP al report** — niente re-pin, lo decide gualt.
