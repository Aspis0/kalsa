# MANDATO — TRIAL Marco-Mini-Instruct (17.3B-A0.86B) sul banco di campagna

Candidato primario dalla ricerca successori (`research-lowactive-moe.md`, fatti
chiave verificati dal coordinatore). Domanda unica del trial: **Marco-Mini merita
il dossier di adozione come modello del tier premium?** Gate dichiarati PRIMA:
qualità multilingua entro soglia E velocità ≥1.3× KEXP. Il design T0-T3 è nel
report §3 — questo mandato lo rende eseguibile.

**Regole fisse:** binario CAMPAIGN `1ca51420…` INVARIATO; KEXP e IQ2_M NON si
toccano; guardrail+flight; floor batteria 30%; bpb/PPL in carica OK, velocità
solo staccato; screen ripristinato; non toccare fork/`../ai-chat`; STOP ai gate;
mai `complete_goal`.

## PIANO DEVICE (il Samsung è occupato — si lavora senza)

| fase | dove | note |
|---|---|---|
| FASE 0 + T2a/b/c (qualità bpb) | **PC, build host del fork** | deterministico, più veloce di qualunque telefono; stessi numeri |
| T0/T1 (smoke) + T3 (velocità) | **Jelly Star** (Helio G99, 8 GB, lab già collaudato) | binario da BUILDARE su Jelly (sha a verbale, pin separato dal CAMPAIGN S23); **`-t 2`** (regola cpu_capacity misurata sul G99: 2×A76 forti); numeri assoluti NON citabili come prodotto — vale solo la CLASSIFICA relativa ABBA sullo stesso device |
| conferma assoluta | **S23, ~1h, solo per il vincitore, quando si libera** | prima di qualunque dossier di adozione |

**Bias dichiarato (conservativo per Marco):** la flash del Jelly è più lenta →
la tassa streaming pesa di più → Marco (streama ~10.5 GB) è svantaggiato vs
Qwen3.5-4B (~2.5 GB, in RAM). Se Marco vince sul Jelly, su S23 vince di più.
Riportare comunque MiB/tok e hit per stimare la correzione.

## FASE 0 — corpus multilingua (PC, subito, UNA VOLTA per tutta la campagna)

Costruire `corpus/multi5/` con slice **byte-identiche e versionate**:
`{en,es,fr,it,zh}.txt`, ~40-60 KB l'una, prosa naturale pulita (fonti dichiarate
con URL — es. Wikipedia/testi liberi, NO codice, NO liste), UTF-8 LF, sha256 per
file a verbale. La slice IT può derivare dal corpus storico (coerenza col metro
esistente). Queste slice diventano il metro cross-modello permanente.

**Baseline KEXP sulle slice** (device o host, deterministico): `--ppl-decode` per
slice → `bpb_KEXP,L = (Σ −log2 p) / N_bytes_L` + bytes/token (fertilità). Senza
questa baseline il trial non è interpretabile: farla PRIMA di scaricare Marco.

## FASE 1 — download e smoke (PC + device, in carica OK)

1. `mradermacher/Marco-Mini-Instruct-i1-GGUF → i1-Q4_K_M.gguf` (10 505 424 704 B;
   sha256 calcolato a download e messo a verbale) + tokenizer/config upstream
   (`ATH-MaaS/Marco-Mini-Instruct`). Opzionale: `i1-IQ2_M` come controllo in-RAM.
2. Push su telefono (`~/experiments/models/`), spazio verificato.
3. **T0** load smoke: 16 token generati, `general.architecture` a verbale
   (atteso `qwen3mooe`/`qwen3moe`). Crash/unknown → STOP candidato.
4. **T1** streaming smoke fork: config campagna (cache 2000, dense anon, overlap).
   Attenzione: esperti h=1024/int=768 → byte/esperto MOLTO più piccoli di KEXP
   (~0.1-0.2 MB): annotare slot effettivi e hit. OOM/anomalie → STOP e riportare.

## FASE 2 — qualità multilingua (in carica, deterministico)

**T2a smoke (fail-fast):** bpb su EN + ZH + IT. Se una delle tre sfora
`bpb_KEXP,L + 0.15` → **NO-GO qualità**, si chiude qui e si riporta.
**T2b full:** tutte e 5 le slice → tabella `bpb_L` (Marco vs KEXP), macro-bpb
(media aritmetica 5 lingue), bytes/token per lingua.

| gate | soglia |
|---|---|
| macro-bpb | ≤ macro-bpb_KEXP + **0.05** |
| veto per-lingua | nessuna L con Δbpb > **+0.15** |
| flag ZH | se ZH è l'unica a sforare → a verbale "ZH sotto Qwen", NON nascondere nella media |

**T2c — GATE DI PRODOTTO (aggiunto da gualt): Marco DEVE stravincere su
Qwen3.5-4B.** Terzo comparatore sulle STESSE 5 slice: Qwen3.5-4B (GGUF Q4 già in
casa dall'A/B F6 — verificare presenza/sha, altrimenti scaricare l'ufficiale).
Logica: Qwen3.5-4B-class è il tier GRATUITO di Kalsa — se il premium non lo
domina, non ha senso commerciale.

| gate T2c | soglia |
|---|---|
| macro-bpb Marco | < macro-bpb Qwen3.5-4B − **0.03** (vittoria netta, non pareggio) |
| per-lingua | Marco batte o pareggia Qwen3.5-4B su ≥4/5 lingue; nessuna persa oltre +0.10 |
| esito FAIL | Marco NON merita il dossier premium a prescindere da T3 (la velocità non compra la qualità qui) |

## FASE 3 — velocità (STACCATO, batteria ≥ 45%)

**T3**: ABBA A=KEXP vs B=Marco, 2 prompt × 2 rep, n=200, cold per run, config
campagna per entrambi (drop 0.65 su KEXP; su Marco drop OFF al primo giro — la
sua curva drop non esiste ancora, confronto onesto = ciascuno al suo meglio noto).
Metriche solite + MiB/tok + hit. Poi sostenuto n=512 con Marco (1 run, die curve).

| gate | soglia |
|---|---|
| decode Marco | ≥ **1.3× KEXP** (mediane pooled E per-prompt a verbale) |
| aspirazione | 12-20 tok/s: riportare dove atterra davvero |

## Deliverable

`reports/moe-trial-marco.md`: sha corpus+modello, T0/T1, tabella bpb 5 lingue con
fertilità, tabella velocità con sostenuto, verdetto per i gate, e la
raccomandazione secca (dossier adozione sì/no, con cosa si guadagna e cosa si
perde: ZH-depth, vision, qualità assoluta). Artefatti `results/trial_marco/`.
**STOP al report — l'adozione è di gualt.**
