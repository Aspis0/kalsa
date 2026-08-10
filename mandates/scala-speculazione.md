# MANDATO — SCALA FAIL-FAST: speculazione eterogenea (draft su GPU, verifica GEMM su CPU)

La porta "speculazione" è stata chiusa per: niente testa MTP, ngram senza match,
letteratura memory-bound. Ma NOI siamo **compute-bound su GEMV**, e la verifica
speculativa trasforma N GEMV in un GEMM — trasformazione che sul nostro device vale
già 2.3-2.6× (prefill vs decode, stesso binario). La versione mai provata: **draft
denso piccolo sulla GPU Adreno ferma** (a costo CPU ~zero) + **verifica batch sul
CPU** col nostro streaming. Tre numeri PRIMA di scrivere una riga di integrazione.
Se due su tre falliscono, la porta era chiusa davvero — per misura, non per resa.

**Regole fisse:** binario CAMPAIGN `1ca51420…` INVARIATO; PREFAULT intatto; nessuna
modifica al fork in questo mandato; guardrail `74bbb4d` + flight; floor 30%; timing
solo da STACCATO; deterministico ok in carica; screen ripristinato; non toccare
`../ai-chat`; STOP ai gate; mai `complete_goal`.

**Predizioni a verbale (PRIMA dei numeri):** N1: C(4) ≈ 1.8-2.5; N2: α ≈ 55-70%
col draft 1.7B stessa famiglia; N3: 15-30 tok/s su GPU per un ≤1.7B Q4.

---

## N1 — Il denominatore: costo del batch-verify sul modello VERO (device, staccato)

Col binario pinnato e config di campagna (drop 0.65), misurare il costo di
processare k token IN BATCH vs generarli in sequenza:

- **decode**: tempo per n token generati in sequenza (già noto: ~1/4.4 s/token —
  rimisurare 1 cella di controllo);
- **prefill corto**: tempo di prefill di k token nuovi su un contesto esistente
  (via `--session` due turni: il turno 2 aggiunge k token → il prefill del turno 2
  È il batch-verify simulato). k ∈ {2, 4, 8, 16}, 2 rep, cold a inizio serie.

**C(k) = tempo_prefill(k) / tempo_decode(1 token)**. Attenzione: il prefill a
~10 tok/s era su batch grossi; a k=4 l'efficienza GEMM potrebbe non esserci ancora
— è ESATTAMENTE ciò che N1 misura. Annotare anche MiB/tok del batch (unione degli
esperti dei k token: quanto costa in I/O e hit?).

| C(4) | lettura |
|---|---|
| ≤ 2.2 | VERDE — verificare 4 token costa ≤2.2 token: l'ammortamento c'è |
| 2.2-3.0 | GIALLO — margine stretto, servono α alti e k più grossi |
| > 3.0 | ROSSO — il batch corto non ammortizza sul nostro path: porta chiusa per misura |

## N2 — Il numeratore: acceptance offline (SOLO PC, zero telefono, parte subito)

Serve un draft **stessa famiglia e STESSO tokenizer** del target (Qwen3.6-35B-A3B,
vocab 151936): cercare su HF il più piccolo denso Qwen3.6 (0.6B/1.7B/4B — anche
Qwen3.5 se il tokenizer è identico: VERIFICARE hash tokenizer nei metadata GGUF,
non fidarsi del nome). Scaricare in Q4_K/Q8 su PC.

Protocollo: i testi greedy del TARGET esistono già (`results/f5.5/b/*-k8.gen.txt`,
generati a temp 0). Per ciascun testo: teacher-forcing del draft sul testo del
target (build host del submodule o llama.cpp vanilla PC, `--ppl-decode`-style o
logits greedy) e conteggio: **α = P(argmax_draft == token_target)** posizione per
posizione, più la statistica utile per la speculazione: **lunghezza media della
run di match consecutivi** (è quella che decide i token accettati per ciclo).

| α (e run-length medio a k=4) | lettura |
|---|---|
| α ≥ 60% (≥ ~2 accettati/ciclo) | VERDE (criterio di riapertura storico rispettato) |
| 45-60% | GIALLO — l'e2e si assottiglia, decidere con N1/N3 alla mano |
| < 45% | ROSSO — la prosa IT non si lascia draftare da un piccolo: porta chiusa |

Riportare α per taglia draft se più taglie disponibili (0.6B vs 1.7B vs 4B: la
curva α/costo è parte del dossier).

## N3 — Il draft gira sulla GPU ferma? (device: build in carica, bench staccato)

Build **vanilla** llama.cpp (mainline recente o submodule) con `GGML_OPENCL=ON`
su Termux (la ricerca GPU dà il path; il binario NON tocca nulla di campagna).
Bench del draft scelto in **Q4_0 o Q4_K** (quant supportate dal backend OpenCL):
`llama-bench -ngl 99 -t 2` tg128, 2 rep, staccato. Durante il run: `top` per la
CPU usata dal processo (il punto è il costo CPU ~zero) e die.

| draft tok/s su GPU | lettura |
|---|---|
| ≥ 15 (≈3.5× il target 4.35) con CPU libera | VERDE |
| 8-15 | GIALLO — draft più piccolo o pipeline draft/verify sovrapposta |
| < 8 o CPU occupata comunque | ROSSO su GPU — fallback da valutare: draft CPU nei tempi morti? (probabilmente no, buco 2 dice che i core non bastano) |

## Sintesi richiesta

**e2e stimato** = k_accettati_per_ciclo / (t_draft(k) + C(k)·t_decode1), con i tre
numeri misurati e la formula esplicita nel report. Confronto col baseline 4.35-4.7.

| combinazione | decisione |
|---|---|
| 3 VERDI (o 2 verdi + 1 giallo con e2e stimato ≥ +25%) | **GO INTEGRAZIONE**: si scrive il piano del cantiere (wiring draft/verify nel fork, checkpoint ibridi per il rollback — il meccanismo esiste, va verificato) |
| e2e stimato +10-25% | dossier a gualt: cantiere sì/no col numero davanti |
| ≥ 2 ROSSI o e2e < +10% | **PORTA CHIUSA PER MISURA** — a verbale con i tre numeri, e la campagna va al consolidamento/integrazione Kalsa |

## Deliverable

`reports/moe-scala-spec.md`: i tre numeri con tabelle run per run, α e run-length,
la formula e2e compilata, verdetto per le regole. Ordine di esecuzione: N2 subito
(PC), N1 alla prima finestra staccato, N3 build in carica + bench staccato.
Artefatti `results/spec_ladder/`. **STOP al report — il GO al cantiere è di gualt.**
