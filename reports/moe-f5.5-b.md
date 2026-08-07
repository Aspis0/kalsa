# F5.5-B — k-sweep qualità 8/6/5/4 su 8 prompt — 2026-08-07

**Stato:** **DONE** — 32/32 celle ok, 0 fail, 0 retry.  
**Device:** Samsung S23 (SM-S911U), **PLUGGED_AC / CHARGING** (batt 46→43 %).  
**Runtime:** `bmoe-cli` `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli` (stesso binario di F5.2/F5.4, no rebuild).  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size gate **11522702304 B**.  
**Marca:** **F5.5-B IN-CARICA** — `hit%` e `mib_tok` sono deterministici e validi; **nessun verdetto di velocità** (tok/s inutilizzabili in carica).  
**Driver:** `scripts/start_f5_5_b.sh` detached (`nohup setsid`), PID 12337, 16:16–17:34 EDT.  
**Artefatti:** `results/f5.5/b/` (gen.txt, meta, metrics.csv, stdout/stderr, cells_fixed.csv, quality_compare.txt).

## Cosa è stato fatto (vs piano)

| voce | piano | esito |
|---|---|---|
| Flag k | confermare `--n-expert-used` | **OK** — help + smoke n=1: override `expert_used_count` 8→6 confermato in stderr |
| Prompt | 8 file byte-identici | **OK** — sha256 in `prompt_sha256.txt` |
| Celle | 8 prompt × k=8/6/5/4 | **32/32 ok**, ordine k=8→6→5→4 per prompt |
| cold_model | tra celle | **OK** — `~/bin/cold_model.sh` (posix_fadvise DONTNEED) |
| Gate termico | pre-start die≤80 °C, hard-stop 95 °C | **OK** — die max campagna **92.0 °C** (short-k5); nessun hard-stop |
| nproc | ≥6 | **OK** — 6–8 per tutta la corsa |
| n_gen | 200 short suite / 256 long | **OK** |
| Config base | gate-identica + flag k anche a k=8 | **OK** (vedi sotto) |

Config base (identica per tutte le celle):

```
-t 4 -c 4096 -n <200|256> --chatml --no-think --progress --temp 0
--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--ubatch 512 --n-expert-used <k>
```

Smoke flag (n=1, short "Ciao"):

| k | stderr | n_expert_used |
|---:|---|---:|
| 8 | `validate_override … expert_used_count = 8` | 8 |
| 6 | `validate_override … expert_used_count = 6` | 6 |

## Checksum prompt (byte-identità)

| file | sha256 |
|---|---|
| short.txt | `197480d977685dc8…c2f619` |
| f45_1_esplicativo.txt | `bc5c1e584031aa57…55cbcf` |
| f45_2_scrittura.txt | `5cd6c45c4fcdeafb…edc0f79` |
| f45_3_istruzioni.txt | `ac1e64e271aacce3…45a03d9` |
| f45_4_codice.txt | `0da7e292bda861df…ee80e199` |
| f45_5_ragionamento.txt | `a6ddeb2fadf73758…27ecd5d1` |
| long_conversational_it.txt | `b74f074858db2703…128aaaa` |
| d1_long.txt | `96629f53df322550…a8e37650` |

## Numeri chiave — hit% e mib_tok (deterministici)

Fonte: riga `moe-stream: read … MiB (X.XX MiB/token)` + `moe-cache: Y.Y% hit` in stdout; header CSV `n_expert_used=k`.  
`cells.csv` harness aveva un bug di parse su mib_tok (regex greedy); valori canonici in **`cells_fixed.csv`**.

### Tabella completa

| prompt | k | hit% | mib_tok | n_prompt | tokens | gen_chars | die_max °C |
|---|---:|---:|---:|---:|---:|---:|---:|
| short | 8 | **74.1** | **57.15** | 114 | 200 | 1005 | 91.6 |
| short | 6 | 74.2 | 39.74 | 114 | 190 | 854 | 89.9 |
| short | 5 | 75.5 | 30.16 | 114 | 200 | 873 | **92.0** |
| short | 4 | 76.5 | 21.17 | 114 | 200 | 1005 | 82.6 |
| f45_1_esplicativo | 8 | **77.0** | **49.05** | 121 | 200 | 759 | 90.3 |
| f45_1_esplicativo | 6 | 79.7 | 28.57 | 121 | 200 | 793 | 89.5 |
| f45_1_esplicativo | 5 | 81.9 | 18.34 | 121 | 200 | 819 | 83.1 |
| f45_1_esplicativo | 4 | 80.9 | 15.39 | 121 | 200 | 749 | 89.9 |
| f45_2_scrittura | 8 | **71.6** | **57.68** | 133 | 139 | 588 | 77.4 |
| f45_2_scrittura | 6 | 74.3 | 35.08 | 133 | 147 | 639 | 89.9 |
| f45_2_scrittura | 5 | 73.3 | 29.18 | 133 | 143 | 622 | 91.2 |
| f45_2_scrittura | 4 | 71.1 | 23.98 | 133 | 131 | 525 | 90.3 |
| f45_3_istruzioni | 8 | **75.9** | **44.36** | 114 | 135 | 655 | 89.9 |
| f45_3_istruzioni | 6 | 79.3 | 25.54 | 114 | 156 | 724 | 89.9 |
| f45_3_istruzioni | 5 | 82.3 | 17.84 | 114 | 199 | 957 | 90.3 |
| f45_3_istruzioni | 4 | 81.3 | 13.66 | 114 | 184 | 927 | 90.3 |
| f45_4_codice | 8 | **67.0** | **78.53** | 148 | 200 | 699 | 90.3 |
| f45_4_codice | 6 | 69.9 | 49.71 | 148 | 200 | 667 | 89.5 |
| f45_4_codice | 5 | 70.8 | 38.12 | 148 | 200 | 668 | 90.3 |
| f45_4_codice | 4 | 70.1 | 30.16 | 148 | 200 | 711 | 89.9 |
| f45_5_ragionamento | 8 | **71.6** | **60.44** | 164 | 165 | 651 | 79.0 |
| f45_5_ragionamento | 6 | 73.6 | 37.36 | 164 | 161 | 630 | 90.3 |
| f45_5_ragionamento | 5 | 73.2 | 29.77 | 164 | 156 | 642 | 89.5 |
| f45_5_ragionamento | 4 | 73.1 | 23.07 | 164 | 165 | 713 | 90.8 |
| long_conversational_it | 8 | **84.2** | **31.18** | 143 | 256 | 1022 | 90.3 |
| long_conversational_it | 6 | 85.2 | 19.55 | 143 | 256 | 1092 | 88.7 |
| long_conversational_it | 5 | 86.2 | 13.54 | 143 | 256 | 1064 | 89.1 |
| long_conversational_it | 4 | 85.8 | 10.66 | 143 | 256 | 984 | 76.2 |
| d1_long | 8 | **69.3** | **36.33** | **1318** | 256 | 1007 | 86.7 |
| d1_long | 6 | 67.0 | 24.99 | 1318 | 256 | 1019 | 90.8 |
| d1_long | 5 | 66.3 | 17.75 | 1318 | 256 | 980 | 82.6 |
| d1_long | 4 | 64.6 | 12.26 | 1318 | 256 | 973 | 81.0 |

### Sintesi per k (media su 8 prompt)

| k | hit% mean | hit% med | mib_tok mean | mib_tok med | Δ mib vs k=8 (med) |
|---:|---:|---:|---:|---:|---:|
| **8** | 73.8 | 72.8 | **51.84** | **53.10** | — |
| **6** | 75.4 | 74.2 | **32.57** | **31.82** | **−40 %** |
| **5** | 76.2 | 74.4 | **24.34** | **23.76** | **−55 %** |
| **4** | 75.4 | 74.8 | **18.79** | **18.28** | **−66 %** |

Osservazioni numeriche (senza tok/s):

1. **mib_tok scende quasi linearmente con k** — atteso: meno esperti letti per token. Mediana k=6 ≈ 0.60× k=8; k=4 ≈ 0.34× k=8.
2. **hit% non crolla con k basso** — su prompt corti hit sale leggermente (cache meno affamata); su `d1_long` (n_prompt=1318) hit **scende** 69.3→64.6 (k=8→4): routing diverso + working set più “sparso” sul prefill lungo.
3. **n_expert_used nell’header CSV = k** su tutte le 32 celle — override applicato, non solo dichiarato.
4. **Nessun OOM/lmkd**, rc=0 su tutte le celle, un solo attempt ciascuna.

## Confronti qualità prompt-per-prompt (k=8 riferimento)

Giudizio preliminare per coppia: **regge** / **degradato** / **crolla**.  
Materiale grezzo: `results/f5.5/b/*-kN.gen.txt` e `quality_compare.txt`.  
**Verdetto di prodotto = di gualt** — qui solo classificazione con citazioni.

### short (EN, confronto 4B vs 35B MoE on-device)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **regge** | Stessa tesi e struttura (RAM fit vs swap/stream). Diverge a char 25: k8 `within the 8GB RAM` / k6 `in the 8GB RAM`. k6 ha un errore fattuale minore («4B … occupy roughly 16GB in full precision») ma resta coerente. |
| k8 vs k5 | **degradato** | Apre diverso (`The 4B` vs `A 4B`); typo **«shrizes»** (shrinks); troncamento a metà bullet termico. Compito ancora leggibile. |
| k8 vs k4 | **degradato** | Riformula da capo (`Running a dense 4B…`); contenuto ancora sul punto ma più generico e tagliato a metà frase. |

Citazione chiave k8: *«A 4B model fits entirely within the 8GB RAM… whereas the 35B MoE model exceeds available RAM»*.  
Citazione k4: *«Running a dense 4B model is generally smoother because its entire weight matrix fits…»* — stesso topic, lessico diverso.

### f45_1_esplicativo (IT, cos’è un MoE)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **degradato** | Apre quasi uguale (prefix 74 char). k6 **sbaglia il punto memoria**: *«permette di caricare l’intero modello da 35B nella RAM»* — falso su 8 GB; k8 dice correttamente che i 35B restano su disco e in RAM solo gli esperti attivi. |
| k8 vs k5 | **degradato** | Prefisso simile; numeri confusi («3B … circa 12 GB in precisione intera»); troncato. |
| k8 vs k4 | **degradato** | Metafora **«cucine»** al posto di «esperti»; afferma che un denso 7B «è ideale» su 8 GB (discutibile) e inverte in parte il framing del prompt. Non crolla ma è il più lontano. |

Citazione k8: *«Il MoE … mantiene i 35B parametri sul disco … caricando in RAM solo gli esperti attivi»*.  
Citazione k6 (errore): *«caricare l’intero modello da 35B nella RAM dello smartphone»*.

### f45_2_scrittura (IT, email di test)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **regge** | Stessa email (Ciao / MoE 2.4 bit / ~5 tok/s / schermo acceso / temp-batt-toks). Microvarianti lessicali. |
| k8 vs k5 | **regge** | Come k6; un po’ più verboso, stesso compito completato. |
| k8 vs k4 | **regge** (borderline) | Completa il compito; aggiunge placeholder `[Tuo Nome]`; leggermente più corta. |

Citazione k8: *«modello MoE quantizzato a circa 2.4 bit per peso… velocità attesa è di circa 5 token al secondo… mantenere lo schermo acceso»*.  
k6/k5/k4 contengono gli stessi tre ingredienti.

### f45_3_istruzioni (IT, perché misurare a batteria scarica)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **crolla** (sul compito) | k8 argomenta **a favore** del test a batteria scarica. k6 **inverte**: *«Misurare … con la batteria carica garantisce…»* e tratta il pieno come indicatore di picco. Compito non rispettato. |
| k8 vs k5 | **crolla** | Stessa inversione + claim errato (*scarica elimina le variabili termiche*). |
| k8 vs k4 | **crolla** | Mescola scarica/carica in modo confuso; non sostiene la tesi richiesta. |

Citazione k8: *«Misurare le prestazioni a batteria scarica rivela i limiti termici e la degradazione della tensione»*.  
Citazione k6 (inversione): *«Misurare le prestazioni con la batteria carica garantisce una tensione stabile…»*.

### f45_4_codice (Python median_eval_tok_s)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **regge** | Stessa firma, filtro nproc≥6, sort, mediana; k6 più compatto, entrambi troncati a metà `return` (n_gen). |
| k8 vs k5 | **regge** | Quasi clone di k6; logica corretta fino al taglio. |
| k8 vs k4 | **degradato** | Manca fence \`\`\`python; commenti più verbosi; logica ancora giusta ma stile “student code”. |

Citazione k8: *`if nproc is None or nproc < 6: continue`* + mediana su lista ordinata.  
k4: *`if nproc is not None and nproc >= 6:`* — equivalente, senza docstring.

### f45_5_ragionamento (scelta B = cpuset little cores)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **regge** | Tutti scelgono **(B)**; k6 omette il testo lungo dell’opzione ma ragiona correttamente su A/C e indica `/proc/.../cpuset`. |
| k8 vs k5 | **regge** | Stesso verdetto B + verifica cpuset/cgroup. |
| k8 vs k4 | **regge** (lieve) | B corretto; typo *«anzessiare»* (anziché); verifica `Cpus_allowed_list` ok. |

Citazione k8: *«**(B) il processo è finito in un cpuset con solo 3 core little**»*.  
k6/k5/k4: stessa lettera B.

### long_conversational_it (prosa narrativa IT)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **degradato** | Entrambi prosa fluida sul treno/Milano/viaggio; **personaggio e trama divergono** già a char ~10 (k8 «scivolava nell’oscurità… Luca cabina 4»; k6 «si staccava da Milano Centrale…»). Qualità letteraria simile, non lo stesso testo. |
| k8 vs k5 | **degradato** | Io-narrante diverso; typo *«artificella»*, *«scadense»*; ancora leggibile. |
| k8 vs k4 | **degradato** | Protagonista **Marco** (non Luca); *«velluti grangi»*, *«equilibro»*, *«vagoto»*; prosa regge ma error rate più alto. |

Nessun crollo incoerente: tutti i k producono paragrafo narrativo continuo in italiano.

### d1_long (prosa lunga, n_prompt=1318)

| coppia | giudizio | perché |
|---|---|---|
| k8 vs k6 | **regge** | Stessi ingredienti del prompt (23:17, carrozza 7, valigia blu, posto 14B, nebbia/notte). Parafrasi, non clone. |
| k8 vs k5 | **degradato** | Stessi elementi; **carattere CJK spurio** `凝` in *«essersi凝ato»*; leggero calo di purezza ortografica. |
| k8 vs k4 | **degradato** | Timeline ok ma *«velluti grangi»*, *«vagoto»*, *«accolchie»*; introduce un secondo personaggio non nel seed. Ancora leggibile. |

Citazione k8: *«L’orologio digitale sul muro della carrozza 7 segna … le 23:17»*.  
k6: *«L’orologio digitale sopra la testiera segna … 23:17»* + carrozza 7 / posto 14B / valigia blu.

## Matrice riassuntiva giudizi

| prompt | k=6 | k=5 | k=4 |
|---|---|---|---|
| short | regge | degradato | degradato |
| f45_1_esplicativo | degradato (errore memoria) | degradato | degradato |
| f45_2_scrittura | **regge** | **regge** | **regge** |
| f45_3_istruzioni | **crolla** (tesi invertita) | **crolla** | **crolla** |
| f45_4_codice | **regge** | **regge** | degradato |
| f45_5_ragionamento | **regge** | **regge** | **regge** |
| long_conversational_it | degradato (trama diversa) | degradato | degradato |
| d1_long | **regge** | degradato (CJK) | degradato |

Conteggio grezzo (24 coppie): **regge 10 · degradato 11 · crolla 3**.  
I 3 crolli sono **tutti su f45_3** (compito “argomenta perché scarica”): a k≤6 il modello ribalta la tesi.

## Verdetto preliminare (non di prodotto)

1. **k=6 non è “indistinguibile” da k=8 in generale** — smentisce la lettura ingenua di F5.2-C4 su un solo prompt. Su scrittura email, codice, ragionamento a scelta multipla e d1_long **regge**; su esplicativo MoE introduce un errore fattuale grave; su f45_3 **crolla**.
2. **k=5/k=4**: traffico flash −55/−66 % (mediana mib_tok) a parità di cache 2000; qualità **mai crollata in non-senso**, ma più parafrasi, più typo, e lo stesso fallimento sistematico su f45_3.
3. **Leva k è reale sul traffico** (mib_tok monotono) e **parziale sulla qualità** (task-dependent). Per un eventuale “turbo k=6” servirebbe un giudizio umano mirato sui task prodotto, non un via libera globale.
4. **Hit-rate non è monotono “meglio con k basso”**: su prefill lungo (d1) hit scende con k; su prompt corti sale un po’. Non usare hit% come proxy di qualità.

## Deviazioni / caveat

- **IN-CARICA**: non confrontare tok/s; elapsed_s in meta solo diagnostico.
- **mib_tok in `cells.csv` harness rotto** (regex); usare `cells_fixed.csv` o le righe `moe-stream:` in stdout.
- **n_prompt in meta** per alcuni prompt corti recuperato da path secondario; per d1_long prefill esplicito `prefill: 1318 tokens` in stderr.
- **Output troncati da n_gen** (codice a metà `return`, prosa a metà frase) — non imputare al solo k.
- **Encoding**: un glyphe CJK in d1_long-k5; accenti IT ok nei file UTF-8.
- F5.2-C4 aveva k=6 “indistinguibile” su **un** prompt conversazionale Sicilia a n_ctx diversi — qui il corpus è più ampio e la conclusione è più sfumata.

## Artefatti

| path | contenuto |
|---|---|
| `results/f5.5/b/*-k{8,6,5,4}.{gen.txt,meta,metrics.csv,stdout,stderr,sampler.csv}` | 32 celle |
| `results/f5.5/b/cells_fixed.csv` | hit/mib_tok riparsati |
| `results/f5.5/b/quality_compare.txt` | testi affiancati |
| `results/f5.5/b/prompt_sha256.txt` | checksum prompt |
| `results/f5.5/b/F5.5-B.master.log` | log harness |
| `scripts/start_f5_5_b.sh` | harness |
| `scripts/analyze_f5_5_b.py` | reparse offline |

## Prossima azione proposta

- Giudizio umano di gualt sulle 24 coppie (priorità: f45_3 crollo, f45_1 errore k6, f45_2/f45_5 reggono).
- Se k=6 entra in prodotto: restringere ai task dove regge, o A/B su corpus app reale.
- Opzionale: una replica off-charger solo per tok/s (fuori scope B).

**Verdetto gate B:** **PASS** sul protocollo misura (32/32, flag confermato, hit/mib_tok deterministici, testi per audit). Qualità k&lt;8 = **task-dependent**, non blind-ok.

DONE
