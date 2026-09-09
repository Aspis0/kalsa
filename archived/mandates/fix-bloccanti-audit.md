# MANDATO — chiusura dei tre bloccanti dell'audit loader-fix

Tre lavori in **ordine obbligato**: **A** (fix ABI + rebuild + gate) → **C** (pin del binario
di campagna) → **B** (G3 rifatto con strumentazione sana). L'ordine non è negoziabile: C pinna
il binario che esce dal gate di A, e B misura il binario pinnato da C.

**Contesto fisso:**
- Repo `BigMoeOnEdge`, branch `main`, sopra `b0c4e5b`. Submodule `third_party/llama.cpp`,
  branch `kalsa/mmap-prefetch-opt`, sopra `5236140e5`, HEAD attuale `206a8fe7f`.
- Binari sul telefono in `build-bmoe/cli/`:
  - `bmoe-cli.PREFAULT` (sha256 `5c95cb5f…`) = via di ritorno, **mai toccarlo**;
  - `bmoe-cli.NEW` (sha256 `7354947b…`) = candidato attuale; `bmoe-cli` oggi è identico a NEW.
- **Non toccare `../ai-chat`.** STOP ai gate, **mai `complete_goal`**.
- Il mandato `kv-reuse-diagnosis.md` è separato: non mescolarlo qui.

---

## PARTE A — il fix ABI (bloccante 1)

**Il difetto.** `llama_model_params` è una struct aggregate. `llama_model_params p{}`
(value-init) o un initializer posizionale incompleto azzerano il nuovo campo
`bool mmap_prefetch` → **`false`** → prefault silenziosamente spento per chi non ha chiesto
nulla. Il default `true` protegge solo chi passa da `llama_model_default_params()`. Il
messaggio del commit `206a8fe7f` dichiara *"everyone else is unchanged"*: **falso**, e va
corretto.

**L'invariante da garantire (questo è il requisito, il resto è implementazione):**
> il valore **zero** del campo deve riprodurre il comportamento pre-patch (prefault attivo).

**Implementazione richiesta** — tri-stato `int32_t` al posto del `bool`:

```c
// llama.h — stesso posto (in coda alla struct, offset esistenti invariati)
int32_t mmap_prefetch;   // 0 = auto (prefault attivo, comportamento storico)
                         // 1 = prefault forzato, -1 = prefault disattivato
```

- `llama_model_default_params()`: imposta `0` (auto).
- `llama-model.cpp` (~riga 1506): `ml.init_mappings(params.mmap_prefetch >= 0, …)` — il
  prefault si spegne **solo** con `-1` esplicito. Zero-init → 0 → prefault attivo → chi non
  tocca nulla ottiene davvero il comportamento di prima.
- `session.cpp`: dentro `if (cfg.moe.enabled)` → `mparams.mmap_prefetch = -1;` (il commento
  esistente resta valido).

**Commit — regole:**
- **Niente rebase/amend** di `206a8fe7f`: quel hash è citato nei verbali. Fixup commit nuovo
  sopra di esso, su `kalsa/mmap-prefetch-opt`.
- Il messaggio del fixup deve dire esplicitamente che corregge la dichiarazione di
  compatibilità di `206a8fe7f` (con la vecchia codifica bool l'aggregate/value-init cambiava
  semantica; con il tri-stato lo zero riproduce il comportamento storico).
- Bump del puntatore submodule nel fork: commit separato, contenente solo il puntatore.
- Modifica a `session.cpp` (bool→-1): commit separato nel fork.

**Rebuild + GATE G-A (dichiarato ora, prima dei numeri):**
- Il nuovo binario deve superare la **non-regressione 8/8 byte-identici** contro
  `results/f5.5/b/*-k8.gen.txt`: stessi prompt di `prompts/` (verificare gli sha256 dei
  prompt prima di lanciare), `temp 0`, config del gate.
- Attesa dichiarata: **identici** — il percorso runtime non cambia (lo streaming disattiva
  il prefault come prima; è cambiata solo la codifica del campo).
- **Una sola differenza = difetto, non rumore** (bit-identità provata in F5.4-D1). In quel
  caso: STOP, riportare, non procedere a C né a B.

---

## PARTE C — pin del binario di campagna (bloccante 3)

**Il difetto.** `bmoe-cli` e `bmoe-cli.NEW` hanno lo stesso sha256: l'harness invoca
**l'output dell'ultima build**, non un binario scelto. Un `make` distratto cambia il binario
di campagna senza che nessuno lo decida.

Passi (solo dopo che G-A è passato):

1. `cp` del binario uscito dal gate → `build-bmoe/cli/bmoe-cli.CAMPAIGN`; togliere il
   permesso di scrittura (`chmod a-w`). Salvare lo sha256 in
   `build-bmoe/cli/CAMPAIGN.sha256`.
2. Trovare **tutti** gli script dell'harness che lanciano il binario per misure di campagna
   (grep di `bmoe-cli` negli script): elencarli nel report, nessuno escluso.
3. Modificarli così:
   - invocano **solo** `bmoe-cli.CAMPAIGN` (mai `bmoe-cli` nudo);
   - a inizio run calcolano lo sha256 del binario e lo scrivono nella riga di `runs.csv`
     (**nuova colonna `bin_sha256` in coda** — le colonne esistenti non si spostano);
   - se lo sha256 non coincide con `CAMPAIGN.sha256` → **abort** con messaggio chiaro;
     override solo esplicito via `ALLOW_UNPINNED=1`.
4. `bmoe-cli.PREFAULT` resta dov'è, invariato (riverificare lo sha256 e riportarlo).

---

## PARTE B — G3 rifatto (bloccante 2)

I due difetti dell'originale, da sanare **prima** di misurare:
(a) sampler non periodico — intervalli reali 2,5–3,3 s contro i 200 ms dichiarati;
(b) confine di fine-load dedotto da una stringa (`model load`) che probabilmente arriva a
fine run → `read_bytes_at_load` contaminato da warm-up/decode.

**B0 — il confine.** Con stderr timestampato riga per riga
(`… 2>&1 | while IFS= read -r l; do printf '%s %s\n' "$(date +%s.%3N)" "$l"; done`)
individuare una riga **esistente** che coincide davvero col confine load→warm-up in
**entrambi** i binari (ctrl e nuovo). Verifica: dopo quella riga il regime di `read_bytes`
cambia (finisce il grande I/O sequenziale del load). Se nessuna riga esistente è affidabile
→ build strumentali `bmoe-cli.G3P` (tree di PREFAULT + **un solo** `fprintf(stderr,
"G3_LOAD_DONE\n")` a fine load) e `bmoe-cli.G3N` (tree nuovo, stesso fprintf, stesso punto):
sha256 registrati nel report, **mai** usate come binari di campagna, si buttano dopo.

**B1 — il sampler.** Loop **sul telefono** (non un round-trip ssh per campione — è la causa
probabile dei 2,5–3,3 s): ogni ~200 ms legge `/proc/<pid>/io` e `VmHWM` da
`/proc/<pid>/status`, con timestamp per campione.
**GATE G-B (prima di misurare):** mediana degli intervalli ≤ 400 ms e p95 ≤ 600 ms,
istogramma nel report. Se fallisce → si sistema il sampler, non si misura.

**B2 — la misura.** Per ciascun braccio — ctrl = `bmoe-cli.PREFAULT` (o G3P), nuovo =
`bmoe-cli.CAMPAIGN` (o G3N):
- cache pagina **fredda** con fadvise sul GGUF prima di **ogni** run;
- stesso prompt short del G3 originale (sha256 verificato prima di lanciare);
- **2 ripetizioni per braccio**; terza solo se le due differiscono >15% su
  `read_bytes_at_load`;
- telefono in carica ammesso: i **conteggi** (read_bytes, rchar, VmHWM) sono citabili, i
  **secondi** solo indicativi (regola di campagna: timing solo staccato).

**Regole di decisione (dichiarate ora, prima dei numeri):**

| esito (mediane per braccio) | conclusione |
|---|---|
| nuovo < ctrl di **≥ 40%** su `read_bytes_at_load` | G3 **CONFERMATO** — i numeri assoluti diventano citabili e sostituiscono i vecchi |
| riduzione tra 15% e 40% | G3 **PARZIALE** — fix utile, ma il report del loader va ridimensionato |
| riduzione ≤ 15%, o ctrl ≤ nuovo | la misura vecchia era un artefatto della strumentazione → il fix torna in discussione: **STOP e riportare** |
| `rchar` del braccio nuovo ~1,6 GiB (come F4.8 storico) | la contaminazione era del vecchio sampler — annotarlo esplicitamente |

---

## Deliverable (un report unico)

`reports/moe-blockers-fix.md`, con:
1. hash dei commit (fixup submodule, bump, session.cpp) e testo del messaggio del fixup;
2. esito G-A: tabella 8/8 con gli sha256 ricalcolati;
3. sha256 di **tutti** i binari toccati (CAMPAIGN, PREFAULT riverificato, eventuali G3P/G3N);
4. elenco completo degli script harness modificati per il pin + esempio di riga `runs.csv`
   con la colonna `bin_sha256`;
5. esito B0 (quale riga fa da confine e come è stata verificata) e G-B (istogramma
   intervalli);
6. tabella G3: per run e per braccio `read_bytes_at_load`, `rchar`, `VmHWM`, secondi
   (indicativi se in carica), + mediane e verdetto secondo le regole sopra;
7. CSV grezzi in `results/g3-redo/`.

**STOP al report.** Nessuna adozione oltre quanto scritto qui, nessun altro file toccato,
mai `complete_goal`.
