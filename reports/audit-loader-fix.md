# Audit — loader-fix mmap_prefetch (hostile)

**Data:** 2026-08-08 · **Auditor:** agente reviewer (7af52f70) con vincolo read-only + materializzazione coordinatore
**Oggetto:** mandato `mandates/loader-fix-mmap-prefetch.md`, report `reports/moe-loader-fix.md`, commit submodule `206a8fe7f` / session `026b8f0` / bump `f58980c` / report `e307db1`

## Verdict

**REQUEST CHANGES — non merge.** Il fix di codice è conforme al mandato, ma il gate G3 non è dimostrato (campionamento inaffidabile) e la compatibilità dichiarata ("chi non tocca non cambia") è incompleta per gli initializer aggregati/posizionali. Il binario nuovo NON va adottato come default di campagna finché G3 non è rifatto.

---

## 1. Conformità del diff — CONFORME

Verificato da fonti primarie (`git show 026b8f0`, `git show 206a8fe7f`):

- **`llama.h`**: `bool mmap_prefetch; // prefault the whole mapping at load (default true)` è IN FONDO alla struct `llama_model_params`, con commento esplicito "Appended at end so existing field offsets stay stable for ABI consumers" — gli offset dei campi esistenti non si spostano. ✅
- **`llama_model_default_params()`**: inizializza `/*.mmap_prefetch =*/ true` (llama-model.cpp:2320) — compatibilità per chi chiama la factory. ✅
- **`llama-model.cpp`**: `ml.init_mappings(params.mmap_prefetch, …)` passa il parametro. ✅ (riga 1506 nel mandato; verificato il wiring)
- **`session.cpp`** (026b8f0, +7 righe): `mparams.mmap_prefetch = false` SOLO dentro `if (cfg.moe.enabled)`, con commento che spiega il perché (streaming O_DIRECT + dense anon → prefault = I/O mai usato; citata la misura 19.14/20.76 GiB). NON è un default globale. ✅
- **Nessuna modifica silenziosa**: il diff di 026b8f0 tocca solo session.cpp (+7 righe); il diff del submodule è limitato ai 3 punti previsti.
- **Base del submodule**: parent di `206a8fe7f` = `5236140e5` esatto (il pin). Nessun aggiornamento upstream mescolato. ✅

## 2. Commit separati — CONFORME

- submodule: un solo commit di modifica (`206a8fe7f` su branch `kalsa/mmap-prefetch-opt`)
- session wiring: `026b8f0` (separato, 7 righe)
- bump puntatore submodule nel padre: `f58980c` — diff contenente SOLO il puntatore
- report: `e307db1`
I commit sono leggibili e separati come da PASSO 1 del mandato. ✅

## 3. G2 — non-regressione 8/8 — CONFORME (ricalcolato)

L'auditor ha RICALCOLATO gli 8 sha256 degli output (non fidandosi del report). Tutti coincidono coi riferimenti:

| prompt | sha256 (output) |
|---|---|
| short | `9a3f4175…` |
| f45_1 | `2424179f…` |
| f45_2 | `71216127…` |
| f45_3 | `baadf7b3…` |
| f45_4 | `d9c57c56…` |
| f45_5 | `9397d763…` |
| long_conv | `64f6f2bd…` |
| d1_long | `50b17f32…` |

**Nota**: `results/f5.5/b/prompt_sha256.txt` contiene i checksum dei PROMPT, non degli output — non è la fonte per la non-regressione (i riferimenti output sono `results/f5.5/b/*-k8.gen.txt`). Nit documentale.

## 4. G3 — la misura che decide — EVIDENZA INSUFFICIENTE (BLOCKING)

**Problema nel campionatore** (`results/loader-fix/run_gates.sh:run_g3_one`, righe ~177-180):

1. Gli intervalli reali tra campioni nei CSV sono **~2,5–3,3 s**, non i 200 ms dichiarati — il sampler non è realmente periodico.
2. La fase resta `load` finché compare la stringa `model load`, probabilmente scritta **solo a fine run** — quindi il confine "load" può includere warm-up, decode e letture O_DIRECT.
3. Ultimo campione misurato: **22,2 s** contro i 18,6 s dichiarati (e 12,5 s vs 10,57 s per il NEW) — il valore di `read_bytes_at_load` non corrisponde alla finestra dichiarata.

**Conseguenza**: `read_bytes_at_load` (22,72 → 12,08 GiB) può includere traffico post-load. Anche `rchar` (3,24/3,41 GiB vs storico F4.8 1,62 GiB) suggerisce contaminazione. Il confronto col riferimento storico 20,76 GiB non è giudicabile finché il confine load non è corretto.

**Fix richiesto**: marker esplicito di fine-load (stampato realmente a fine load, non speculato) + sampler con intervallo realmente periodico; poi RIFARE G3 su entrambi i binari (ctrl e nuovo).

## 5. Compatibilità ABI/API — INCOMPLETA (BLOCKING)

- `llama_model_params` è una struct aggregate: `llama_model_params{}` (value-init) o initializer posizionali senza il campo finale mettono `mmap_prefetch` a **`false`** per zero-initialization.
- Prima della modifica il prefault era sempre attivo (`true`); dopo, qualunque chiamante che usa `llama_model_params{}` o un initializer posizionale incompleto ottiene silenziosamente **prefault disattivato** — viola la promessa "chi non lo tocca non vede alcun cambiamento".
- Il default `true` vale solo per chi chiama `llama_model_default_params()` (come session.cpp del fork). Per chi inizializza in modo aggregato la semantica cambia.
- **Fix richiesto**: strategia esplicita — es. campo `int32_t` con valore sentinella (`-1` = "non impostato → prefault come prima", `0/1` espliciti), oppure versione/flag ABI, oppure inizializzare nel costruttore invece che lasciare value-init a zero. Documentare la scelta.

## 6. Rete di sicurezza — PARZIALMENTE VERIFICATO

- `bmoe-cli.PREFAULT` sul telefono: dichiarato intatto (sha256 `5c95cb5f…`) nel report G4, ma l'audit (vincolo read-only) non ha potuto verificarlo via SSH. **Da riconfermare a mano**.
- Decode non toccato: il diff di 026b8f0 è solo sul load (session.cpp, composizione mparams) — nessun file del decode nel diff. ✅

## 7. Rischi omessi / note

- G3 PARZIALE dichiarato (8-15 GiB) è COERENTE coi numeri grezzi (12,08 GiB) — ma il verdetto resta "non dimostrato" finché il confine load non è corretto.
- Il report NON dichiara l'adozione come default (rispetta la regola: decide gualt). ✅
- Il fix secondario (dense) è esplicitamente fuori scope (mandato a parte) — il report lo dice. ✅
- Limite: l'audit non ha potuto verificare via SSH la presenza fisica di PREFAULT né fare un diff reale di 2-3 output sul telefono.

## Giudizio complessivo

| domanda | risposta |
|---|---|
| Il codice è conforme al mandato? | SÌ (diff, commit, base pin, wiring) |
| G2 (non-regressione)? | SÌ — 8/8 ricalcolati |
| G3 (misura che decide)? | **NO — non dimostrato** (sampler rotto) |
| Compatibilità dichiarata? | **NO — incompleta** (aggregate init) |
| Adottabile come default? | **NO per ora** — rifare G3 + risolvere compatibilità, poi ri-audit |
