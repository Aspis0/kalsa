# F5.2 — Le misure che decidono l'ingegneria (S23)

**Stato:** COMPLETO (C1–C4 eseguiti; STOP ai gate).  
**Telefono:** SM-S911U, UNPLUGGED, top-app, `nproc=6–7`.  
**Runtime:** `bmoe-cli` `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli` (b0c4e5b),  
`Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size gate **11522702304 B**.  
**Config base:** `-t 4 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --moe-stream`  
(+ `n_ctx` adeguato, `--chatml --no-think`).  
**Prompt lungo:** `~/experiments/prompts/long_conversational_it.txt` (C1/C3);  
prompt conversazionale Sicilia (C2/C4, stessi di F5.1).  
**HEAD locale al commit report:** vedi git log al momento del commit.  
**Driver:** `scripts/start_f5_2.sh` detached (`nohup setsid`), PID telefono in `results/f5.2/f5_2.pid`.  
**Artefatti grezzi:** `results/f5.2/` (pull completo).  
**Flag verificati nel binario:** `--compute-trace`, `--compute-trace-layers`, `--n-expert-used`,  
`--mtp`, `--ngram`, `--draft`, `--mtp-p-min`, **`--drop-cold-experts` PRESENTE** (help e run).

### PASSO 0 — pull F5.1

`results/f5.1/` allineato al telefono (file regolari; `req.fifo` escluso perché named pipe).  
Report F5.1 già committato: **non toccato**. Nessuna correzione necessaria al testo F5.1.

### Sicurezza

| gate | esito |
|---|---|
| die stop >98 °C | **mai raggiunto**; die max campagna **91.6 °C** (C1-300-layers) |
| batt stop <30 % | **mai**; start 74 % → fine **52 %** |
| caricatore | UNPLUGGED per tutta la corsa |
| residual bmoe | kill esatto per cmdline `/bmoe-cli`, no broad pkill |

---

## C1 — Dove vanno i 0.16–0.22 s/token (`--compute-trace`)

Due lunghezze di contesto (prompt chatml → `n_prompt` = posizione prefill):

| cella | n_prompt | n_gen | tok/s (headline) | compute s/tok (telemetry) | trace |
|---|---:|---:|---:|---:|---|
| F5.2-C1-300-node | **288** | 48 | 5.116 | 0.140 | per-node 8.7 MB |
| F5.2-C1-300-layers | 288 | 48 | 4.993 | 0.136 | layer 144 KB |
| F5.2-C1-1500-node | **1314** | 32 | 3.309 | **0.220** | per-node 6.0 MB |
| F5.2-C1-1500-layers | 1314 | 32 | 4.101 | 0.177 | layer 100 KB |

> Nota: i run *traced* **non** sono benchmark (barriera per nodo). Si leggono le **quote**, non gli assoluti.  
> La telemetria `compute_s_tok` (residual wall−io−mgmt) sale **0.140 → 0.220 (+57 %)** da 288 a 1314 token di contesto — stessa direzione del +41 % multi-turno F5.1.

### Ripartizione per-nodo (phase=decode only)

Classificazione su nomi ggml grezzi (`MUL_MAT_ID` = ffn_moe_{gate,up,down}; full-attn layers = {3,7,…,39}):

| bucket | ~300 tok (n_prompt=288) ms/tok | share | ~1500 tok (n_prompt=1314) ms/tok | share |
|---|---:|---:|---:|---:|
| **expert_gemm** (MUL_MAT_ID gate+up+down) | 98.65 | **50.5 %** | 151.21 | **50.0 %** |
| + expert_dispatch (GET_ROWS ffn_moe_weights) | 7.87 | 4.0 % | 13.52 | 4.5 % |
| **expert totale** | **106.5** | **54.5 %** | **164.7** | **54.5 %** |
| attn_full (FLASH_ATTN_EXT + Q/O full) | 9.21 | **4.7 %** | 20.46 | **6.8 %** |
| di cui FLASH_ATTN_EXT solo | 2.12 | 1.1 % | **9.27** | **3.1 %** |
| attn_gdn (GATED_DELTA_NET + linear_attn/z/ssm) | 13.14 | 6.7 % | 19.42 | 6.4 % |
| + unnamed MUL_MAT (`node_*`, tipicamente proiezioni GDN) | 14.45 | 7.4 % | 23.62 | 7.8 % |
| **attn_gdn stimato** | **27.6** | **14.1 %** | **43.0** | **14.2 %** |
| router (logits + ARGSORT/TOP_K) | 3.74 | 1.9 % | 5.49 | 1.8 % |
| barrier_like (VIEW/RESHAPE/CPY/…) | 5.16 | 2.6 % | 7.37 | 2.4 % |
| shared_ffn (ffn_gate/up/shexp) | 5.73 | 2.9 % | 9.14 | 3.0 % |
| lm_head (result_output) | 9.64 | 4.9 % | 10.50 | 3.5 % |
| rest | 27.80 | 14.2 % | 41.41 | 13.7 % |

Spezzatura **GEMM esperti** (stabile in quota):

| proiezione | share @300 | share @1500 |
|---|---:|---:|
| ffn_moe_gate | 25.1 % | 24.6 % |
| ffn_moe_down | 14.3 % | 13.0 % |
| ffn_moe_up | 11.1 % | 12.5 % |

### Layer-mode (quote assolute più vicine al run non-traced)

| | full-attn layers (10) | GDN layers (30) | pre/post |
|---|---:|---:|---:|
| @300 | 20.3 % | 73.8 % | 5.8 % |
| @1500 | 22.0 % | 72.5 % | 5.5 % |

I 10 layer full-attn **non** esplodono col contesto: +1.7 pp. La crescita di FLASH_ATTN_EXT in assoluto (2.12 → 9.27 ms/tok, ×4.4) è reale ma resta una frazione piccola del token.

### Verdetto C1 (regole dichiarate)

| regola | esito misurato | decisione |
|---|---|---|
| GEMM esperti > 60 % | **NO** — 50.5 % puro / **54.5 %** con dispatch | il ramo kernel/ri-quant **resta il primo candidato** (è il bucket più grosso e stabile), ma **non** passa la soglia 60 % da sola |
| attn full > 30 % a 1500 **e** cresce col contesto | **NO** — 6.8 % a 1500 (FLASH 3.1 %); cresce ma da 4.7→6.8 | il collo su conversazione lunga **non** è “l’attenzione al posto del MoE” |
| dispatch/barriere > 25 % | **NO** — router+barrier ≈ 4–5 % | non è scheduling |
| nessuna domina | **SÌ (formale)** rispetto alle soglie scritte | ma il segnale pratico è chiaro: **expert GEMM ≈ metà del compute isolato**, quota **invariata** col contesto; l’assoluto expert sale 99→151 ms/tok e spiega la maggior parte del +57 % di `compute_s_tok` |

**Raccomandazione operativa (dal dato, non dalla soglia 60 %):**  
procedere con la **versione economica Q4_0 / IQ4_NL** sul ramo expert **prima** del kernel IQ2 a mano. L’attenzione full merita lavoro solo come secondo ordine (FLASH ×4.4 col contesto, ma 3 % del token a 1.3k).

CSV grezzi: `results/f5.2/c1/ct_{300,1500}_{node,layers}.csv` (celle `F5.2-C1-*`).

---

## C2 — Termico o contesto? (5 turni × 2 sequenze)

Stesso carico (Sicilia, `-n 256`, sessione `--chatml`), stessa durata di campagna, no cooldown.

### (a) CONTESTO CRESCENTE — `F5.2-C2a` (`clear_kv=false`)

| turno | n_prompt | n_past | tok/s | compute s/tok | die start→end (max) | batt |
|---:|---:|---:|---:|---:|---|---:|
| 1 | 96 | 352 | **4.211** | 0.1837 | 54.7→58.1 (81.0) | 69→68 |
| 2 | 435 | 691 | 4.064 | 0.1935 | 52.5→64.8 (72.1) | 68→67 |
| 3 | 774 | 1030 | 3.945 | 0.1979 | 53.1→62.4 (70.9) | 67→66 |
| 4 | 1118 | 1374 | 3.866 | 0.2016 | 53.3→60.1 (72.9) | 66→64 |
| 5 | 1440 | 1696 | **4.099** | 0.1928 | 53.3→64.0 (71.3) | 64→63 |

- Δ tok/s T1→T4 (fondo monotono): 4.211→3.866 = **−8.2 %**  
- Δ compute T1→T4: 0.1837→0.2016 = **+9.7 %**  
- T5 recupera (4.099 / 0.1928) — non monotono fino in fondo; pendenza media T1→T5 compute **+5.0 %**.  
- n_prompt cresce ~+340/turno (ri-prefill, come F5.1).  
- Die **respira** 52–65 °C, max sessione 81 °C (T1), poi ~71–73.

### (b) CONTESTO TRONCATO — `F5.2-C2b` (`clear_kv=true` ogni turno)

| turno | n_prompt | n_past | tok/s | compute s/tok | die start→end (max) | batt |
|---:|---:|---:|---:|---:|---|---:|
| 1 | 96 | 352 | **4.109** | 0.1888 | 56.7→61.7 (71.3) | 62→62 |
| 2 | **85** | 341 | 3.845 | 0.2053 | 55.3→57.7 (71.3) | 62→61 |
| 3 | **86** | 342 | 3.690 | 0.2149 | 52.9→58.5 (68.9) | 61→60 |
| 4 | **90** | 346 | 3.892 | 0.2073 | 53.1→59.1 (69.7) | 60→60 |
| 5 | **68** | 304 | **3.600** | **0.2176** | 52.1→59.7 (69.7) | 60→59 |

- n_prompt **resta corto** (68–96): la troncazione funziona.  
- Δ tok/s T1→T5: 4.109→3.600 = **−12.4 %**  
- Δ compute T1→T5: 0.1888→0.2176 = **+15.3 %**  
- Die stesso regime di (a): respira 52–62, max ~71.

### Pendenze separate (compute s/tok per turno, regressione grezza T1–T5)

| sequenza | Δ compute T1→T5 | Δ tok/s T1→T5 | n_past T5 |
|---|---:|---:|---:|
| (a) growing | +5.0 % (con rimbalzo T5; T1→T4 +9.7 %) | −2.7 % (T1→T4 −8.2 %) | 1696 |
| (b) truncated | **+15.3 %** | **−12.4 %** | 304 |

### Verdetto C2 (regola dichiarata)

Il calo **c’è in entrambe**. In questa corsa il pezzo troncato (b) **non** è più leggero del crescente (a) sul decode: peggiora di più in tok/s e compute nonostante n_past fisso ~300.

**Verdetto: ENTRAMBI, con peso termico/sostenuto dominante sul decode di 5 turni corti; il contesto lungo colpisce soprattutto il prefill/TTFT (già chiuso in F5.1 come ri-prefill), non solo il s/tok di generate.**

- Contesto: spiega la crescita monotona di `prefill_s` in (a) (9→47→84→123→157 s) e l’assenza di quella rampa in (b) (~10–14 s).  
- Termico/sostenuto: spiega il calo di tok/s **anche** a n_past costante, con die che non accumula oltre ~71 ma non torna ai 40 °C cold tra un turno e l’altro (no cooldown, deliberato).  
- Rimedi: **finestra scorrevole / fix KV-append** restano prioritari per TTFT; **pacing / meno thread / meno calcolo per token** restano in gioco per il decode sostenuto. Non si può chiudere “solo contesto”.

CSV: `results/f5.2/c2a/turns.csv`, `results/f5.2/c2b/turns.csv` (celle `F5.2-C2a-T*`, `F5.2-C2b-T*`).

---

## C3 — Speculazione sull’asse giusto (`--ngram`, `--mtp`)

Stesso prompt lungo IT, `-c 2048 -n 128`, config base. Un run per variante (warm cache dopo baseline cold).

| cella | tok/s | compute s/tok | mib_tok | accept | note |
|---|---:|---:|---:|---|---|
| **F5.2-C3-baseline** | **4.882** | 0.162 | 32.40 | — | cold model pre-run |
| **F5.2-C3-ngram3** | 4.827 (−1.1 %) | 0.162 | 32.40 | **0/0 (0 %)**; drafted 0/128 step | ngram non ha mai draftato |
| **F5.2-C3-ngram5** | 5.173 (+6.0 %) | 0.153 | 32.40 | **0/0 (0 %)**; drafted 0/128 step | stessa bozza zero; Δ entro rumore termico |
| **F5.2-C3-mtp3** | — | — | — | — | **FAIL rc=1** |

**MTP — blocco strutturale su questo GGUF:**

```
error: --mtp needs a model with a trained MTP head, and this gguf has no nextn block
(nextn_predict_layers is absent or zero).
```

Il file `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` **non** porta il blocco nextn. `--mtp` non è misurabile su questa quant senza un GGUF MTP dedicato.

**ngram — bozza zero sul carico narrativo IT:**  
`drafted on 0 of 128 steps`. Senza match n-gram nel prompt/generato, il path è decode plain (costo zero di draft, zero ammortamento GEMM). I ±6 % di tok/s tra baseline/ngram3/ngram5 **non** sono un segnale di speculazione: mib_tok identico (32.40), accept 0, drafted_steps 0.

`read_bytes` da `/proc` (sampler rb_delta, grezzo whole-run): stesso ordine di grandezza tra baseline e ngram (nessuna riduzione del traffico pesi da batch k).

### Verdetto C3 (regola dichiarata)

| soglia | esito |
|---|---|
| tok/s netti ≥ +10 % con mib_tok ≤ baseline | **NO** |
| 0…+10 % | ngram5 +6 % **senza** draft → **marginale / rumore**, non un win di speculazione |
| ≤ 0 | ngram3 −1 % |

**F6 sull’asse RAM+calcolo: CHIUSA DEFINITIVAMENTE su questo modello/quant e su questo carico.**  
- ngram non attiva draft su prosa IT libera (0 match).  
- MTP assente nel GGUF di prodotto.  
Misurata su due assi (flash già morto in F6 precedente; RAM/calcolo morto qui). Riaprire solo con (1) GGUF MTP reale e/o (2) carico con altissima ridondanza n-gram (codice/ripetizioni), non la chat narrativo-prodottistica.

---

## C4 — Leve lossy gratis (`--n-expert-used`, `--drop-cold-experts`)

Esplorativo, **non** decisione di prodotto (niente metro di perplessità). Stesso prompt Sicilia, `-n 256`.  
`--drop-cold-experts` **esiste** nel binario (contrario al sospetto del mandato sul grep iniziale).

| cella | k / drop | tok/s | compute s/tok | mib_tok | hit % |
|---|---|---:|---:|---:|---:|
| F5.2-C4-k8 | k=8 (default) | **4.045** | 0.197 | **47.52** | 79.3 |
| F5.2-C4-k6 | k=6 | 3.719 (−8 %) | 0.209 | 26.14 | 82.9 |
| F5.2-C4-k4 | k=4 | **5.296 (+31 %)** | **0.152** | **13.12** | 84.9 |
| F5.2-C4-drop05 | F=0.5 | 3.752 (−7 %) | 0.214 | 38.27 | 81.8 |
| F5.2-C4-drop10 | F=1.0 | 4.859 (+20 %) | 0.176 | **7.78** | 90.4 |

> k=6 più lento di k=8 è **anomalo** rispetto alla teoria e al bench fork (5.8 @k=6).  
> Possibili confondenti: k=8 era cold-start post-`cold_model`, k=6 warm ma con die/cache diversi; **una sola replica**. Non usare k=6 come “peggio di k=8” senza ripetizione.  
> k=4 e drop F=1.0 sono i due win di velocità chiari su **questa** corsa.

### Testi integrali (stesso prompt utente)

**Prompt:**  
`Ciao! Sto pianificando un viaggio di 7 giorni in Sicilia partendo da Milano a meta settembre. Budget circa 1200 euro a persona, volo incluso. Preferisco mare e un po di cultura, niente resort tutto incluso. Dammi una bozza di itinerario giorno per giorno, realistica sui tempi di spostamento. Rispondi in italiano, max 250 parole.`

#### F5.2-C4-k8 (baseline)

Ciao! Con 1200€ a persona a settembre, il budget è gestibile se voli low cost da Milano (Malpensa o Linate) verso Catania o Palermo. Ecco un itinerario equilibrato mare-cultura:

**Giorno 1:** Arrivo a Catania. Transfer a Taormina (45 min). Check-in e tramonto a Isola Bella.  
**Giorno 2:** Taormina. Mattina al Teatro Greco e passeggiata lungo Corso Umberto. Pomeriggio relax alla spiaggia di Mazzaro.  
**Giorno 3:** Trasferimento a Siracusa (2h). Visita al Parco Archeologico della Neapolis (Teatro Greco e Orecchio di Dionisio) e passeggiata a Ortigia al tramonto.  
**Giorno 4:** Siracusa. Mattina libera per shopping o relax. Pomeriggio visita al Duomo e Piazza Duomo.  
**Giorno 5:** Gita a Noto (1h). Mattina nel centro barocco, patrimonio UNESCO. Pomeriggio a Marina di Noto per bagno.  
**Giorno 6:** Trasferimento a Agrigento (3h). Visita alla Valle dei Templ  
*(troncato a 256 token)*

#### F5.2-C4-k6

Ciao! Con 1200€ a persona (volo incluso), il budget è limitato ma gestibile prenotando con anticipo voli low cost da Malpensa/Linate verso Catania o Palermo. A metà settembre il clima è perfetto. Ecco un itinerario realistico concentrato sulla costa ionica e sud-occidentale per minimizzare gli spostamenti.

**Giorno 1:** Arrivo a Catania. Noleggio auto essenziale.  
**Giorno 2:** Catania e Taormina. Visita il Duomo, il Mercato e la Villa Bellini. Pomeriggio a Taormina per il Teatro Greco e vista sull’Etna. Pernottamento a Catania o Giardini Naxos.  
**Giorno 3:** Siracusa. Tarda mattina arrivo a Siracusa. Visita il Parco Archeologico della Neapolis (Teatro Greco) e l’Isola di Ortigia al tramonto. Pernottamento a Siracusa.  
**Giorno 4:** Noto e Modica. Mattina a Noto per il barocco e il cannolo. Pomeriggio a Modica per il cioccolato e il centro storico. Pernottamento a Noto o Ragusa.  
*(troncato a 256 token)*

#### F5.2-C4-k4

Per 7 giorni a settembre, il budget di 120€ a persona (su 1200€ totali) è esiguo per un volo Milano-Sicilia. Ti consiglio di puntare su una **tappa a scalo gratuito** (Espresso Air, Ryanair, Wizzair) prenotando con largo anticipo o volando su aeroporti alternativi come Catania o Palermo.

Ecco un itinerario realistico e spedito, focalizzato su Nord e Centro:

**Giorno 1:** Arrivo a Palermo. Noleggia un’auto o usa i treni.  
**Giorno 2:** Palermo. Mattina: Cattedrale e Palazzo dei Normanni. Pomeriggio: Quartiere Vucciria.  
**Giorno 3:** Trasferimento verso Cefalù. Pranzo in vista mare. Pomeriggio: Basilica normanna e borgo.  
**Giorno 4:** Cefalù. Mattinata libera al bagno greco. Inizio pomeriggio verso Agrigento (lungo ma fattibile con i mezzi).  
**Giorno 5:** Valle dei Templi ad Agrigento. Pomeriggio: trasferimento verso Scicassi  
*(troncato a 256 token)*

#### F5.2-C4-drop05 (F=0.5)

Ciao! Con 1200€ a persona a settembre, il budget è gestibile se voli low cost (Ryanair/EasyJet) verso Catania o Palermo. Ecco un itinerario realistico mare-cultura:

**Giorno 1:** Arrivo a Catania. Transfer a Taormina (45 min). Check-in e tramonto a Isola Bella.  
**Giorno 2:** Taormina. Mattina al Teatro Greco e passeggiata lungo Corso Umberto. Pomeriggio relax alla Spiaggia di Mazzaro.  
**Giorno 3:** Trasferimento a Siracusa (2h). Visita al Parco Archeologico della Neapolis (Teatro e Orecchio di Dionisio) e passeggiata a Ortigia al tramonto.  
**Giorno 4:** Siracusa. Mattina a Noto (1h) per il barocco e la Cattedrale. Pomeriggio ritorno a Siracusa e bagno alla Spiaggia di Tindaro.  
**Giorno 5:** Noleggio auto o treno per Agrigento (3h). Visita alla Valle dei Templi. Serata ad Agrigento.  
**Giorno 6:** Agrigento  
*(troncato a 256 token)*

#### F5.2-C4-drop10 (F=1.0)

Ciao! Con 1200€ a persona (volo incluso) a settembre, hai un budget medio ma gestibile. Ecco un itinerario realistico e bilanciato:

**Giorni 1-2: Catania**  
Arrivo a Catania. Visita il mercato di Pescheria e il quartiere San Nullo. Serata a Piazza Duomo.

**Giorno 3: Taormina & Isola**  
Treno regionale per Taormina (1h). Mattinata all’Isola di Ortygia o passeggiata a Taormina. Pomeriggio libero per shopping e relax.

**Giorno 4: Siracusa**  
Treno per Siracusa (1h30). Visita il Parco Archeologico (Teatro Greco, Piazza Aratore) e la parte greca (Ortigia). Cena a base di pesce.

**Giorno 5: Noto & Marina di Noto**  
Treno per Noto (30 min). Visita il Duomo e il centro barocco. Pomeriggio a Marina di Noto per bagno.

**Giorno 6: Agrigento**  
Treno per Agrigento (2h). Visita la Valle dei  
*(troncato a 256 token)*

### Giudizio umano esplicito (qualità)

| cella | giudizio |
|---|---|
| k=8 | Coerente, itinerario ionico classico (Taormina–Siracusa–Noto–Agrigento), tempi plausibili. Baseline di riferimento. |
| k=6 | **Indistinguibile in struttura** da k=8 (stessa costa ionica, aggiunge Modica/cioccolato). Nessuna collasso evidente. |
| k=4 | **Visibilmente peggiore su fatti e aritmetica:** “budget di 120€ a persona (su 1200€ totali)” confonde 1200 con 120; “Espresso Air” non esiste; sposta il piano su Palermo/Cefalù con tempi “verso Agrigento” ottimistici; “Scicassi” (presumibile Scicli/Sciacca deforme). Usabile come bozza grezza, **non** come testo prodotto. |
| drop F=0.5 | Molto vicino a k=8 (stesso scheletro Taormina–Siracusa–Noto–Agrigento). “Spiaggia di Tindaro” è fuori zona rispetto a Siracusa (Tindari è NE). Lieve degrado geografico. |
| drop F=1.0 | Struttura ok ma errori: “Isola di Ortygia” messa sotto il giorno Taormina; “Piazza Aratore”; San Nullo a Catania dubbia come highlight. Più rumoroso di F=0.5, meno rotto di k=4. |

**Informazione forte:** a k=6 il modello **non** collassa; a k=4 la velocità sale (+31 %) ma la qualità **cade in modo udibile**.  
Nessuna leva entra in prodotto senza metro di perplessità/blind A/B — qui si misura solo velocità + lettura umana.

---

## Tabella master CSV (estratto; file completo `results/f5.2/cells.csv`)

Ogni riga marcata con cella `F5.2-C*`. I campi `tok_s`/`mib_tok` nel CSV driver hanno un bug di parsing regex (cattura multipla da grep su stdout+stderr); **i numeri di questo report sono presi dalle sezioni `=== perf ===` e da `BMOE_DONE`**, non dal CSV malformato. Da correggere in un harness futuro.

---

## Cosa non dice

1. **Non dice** che il kernel IQ2 a mano sia obbligatorio: expert è ~50–55 %, sotto la soglia 60 % scritta, ma è il pezzo più grosso e stabile.  
2. **Non dice** che l’attenzione full sia il collo multi-turno: a 1.3k token è ancora <7 % del compute isolato.  
3. **Non dice** “solo termico” o “solo contesto”: C2 mostra **entrambi**, con decode sostenuto che cala anche a n_past fisso.  
4. **Non dice** che ngram/MTP salvino F6 su questo quant e su prosa IT: ngram drafta 0; MTP assente nel GGUF.  
5. **Non dice** che k=4 sia pronto al prodotto: +31 % tok/s con errori fattuali evidenti.  
6. **Non dice** la perplessità / win-rate umano blind — C4 è esplorativo.  
7. **Non ripete** la misura F5.1 (ri-prefill KV): resta il problema n.1 di prodotto per TTFT.  
8. Una sola replica per cella C3/C4; k=6 vs k=8 va ripetuto cold-vs-cold prima di citare un regressione.

---

## Artefatti

| path | contenuto |
|---|---|
| `results/f5.2/c1/` | compute-trace node+layers @300/@1500, stdout/stderr, meta |
| `results/f5.2/c2a/`, `c2b/` | turns.csv, conversation_full, sampler, session logs |
| `results/f5.2/c3/` | baseline / ngram3 / ngram5 / mtp3 (fail) |
| `results/f5.2/c4/` | k8/k6/k4 + drop 0.5/1.0, gen.txt integrali |
| `results/f5.2/cells.csv` | master (parsing tok_s da sistemare) |
| `results/f5.2/F5.2.master.log` | timeline driver |
| `scripts/start_f5_2.sh` | harness |
| `scripts/analysis/f52_compute_trace_summary.py` | classifier C1 |

---

## Sintesi decisioni

| cella | verdetto esplicito |
|---|---|
| **C1** | Expert GEMM ~**50–55 %** (non >60); attn full **≪30 %** anche a 1.5k; dispatch/barrier irrilevanti. **Ramo quant economico esperti prima del kernel a mano.** |
| **C2** | Calo in **(a) e (b)** → **termico/sostenuto + contesto (prefill)**; non solo l’uno. |
| **C3** | **F6 CHIUSA** su questo GGUF/carico: ngram 0 draft; MTP no nextn. |
| **C4** | k=4 **+31 %** tok/s ma testo **visibilmente peggiore**; k=6 ~parità qualitativa; drop F=1.0 veloce ma lossy. Solo esplorativo. |
