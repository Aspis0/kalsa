# MANDATO — i tre buchi nel muro del calcolo (formato, thread, termica)

Le porte convenzionali sono chiuse per misura: GPU (ops+driver), kernel ik (g=0.72),
k (PPL), requant Q4 (pareggio storico), speculazione. Ma la ricerca di oggi ha
stabilito DOVE va il tempo: **gather sul codebook i-quant** (K1 research-iq2), e il
ceiling è **termico** (freq a 41% del picco). Tre attacchi non convenzionali, tutti
a costo basso, tutti falsificabili in fretta. Ordine = ordine di esecuzione.

**Regole fisse:** binario CAMPAIGN `1ca51420…` INVARIATO (nessun rebuild — il buco 1
è proprio "zero codice"); PREFAULT intatto; guardrail `74bbb4d` + flight; floor 30%;
timing SOLO da staccato; PPL/conteggi ok in carica; screen ripristinato; non toccare
fork/`../ai-chat`; STOP ai gate; mai `complete_goal`.

---

## BUCO 1 — il formato, non il kernel: esperti k-quant invece di i-quant

**Il fatto**: #164 mostra che su kernel MAINLINE (i nostri), Q2_K_S fa TG 1.60× vs
IQ2_XXS (13.91 vs 8.67, M2-Max). Il meccanismo (dequant aritmetico vs gather di
griglia) è ISA-generico — ma la regola "quale silicio" impone di misurarlo da noi.
Su HF esiste **`unsloth/Qwen3.6-35B-A3B-GGUF → UD-Q2_K_XL.gguf`, 12 290 628 576 B**
(+7% vs il nostro UD-IQ2_M). Se i suoi esperti sono k-quant, il "kernel speedup"
si compra cambiando FILE, non codice.

### 1a — micro-bench formato (fail-fast, ~30 min, staccato)

Scaricare Llama-3.2-3B **Q2_K** (unsloth, dichiarare sha) accanto ai 3B già sul
telefono. Harness S1 riusato: tg128 ABBA `ref-mainline` Q2_K vs IQ2_XXS, `-t 4`,
2 rep, cold.
**g_formato = med(Q2_K)/med(IQ2_XXS)**. Predizione a verbale: g ≥ 1.4.
| g_formato | decisione |
|---|---|
| ≥ 1.30 | GO al 1b |
| 1.15-1.30 | GO condizionato (si prosegue ma con aspettative e2e ridotte a +5-10%) |
| < 1.15 | BUCO 1 CHIUSO (il gather non domina sul nostro silicio) — si passa al 2 |

### 1b — il modello vero (solo se 1a passa)

1. Download `Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` (12.3 GB; sha vs LFS oid).
2. **Dump per-tensor** (gguf-dump): tipi degli esperti (attesi Q2_K/Q3_K) e dei
   dense; byte/esperto (impatto slot cache: a 2000 MB, quanti slot si perdono?).
   Se gli esperti risultassero ancora i-quant → STOP, buco chiuso, riportare.
3. **PPL decode-path** (in carica OK, deterministico): stesso subset 10k, stesso
   binario CAMPAIGN, config campagna con `--drop-cold-experts 0` PRIMA e poi il
   valore di campagna corrente. Confronto assoluto col dossier IQ2_M
   (2.0955 a F=0; 2.1466 a 0.50; 2.19992 a 0.65).
4. **Velocità da staccato**: A/B stesso protocollo ABBA di speed-065 — A = IQ2_M,
   B = Q2_K_XL, STESSO drop per entrambi, 2 prompt × 2 rep, n=200, cold. Più
   MiB/tok, hit, die.

**Regole di lettura (dichiarate ORA):**
| esito | conclusione |
|---|---|
| PPL(Q2KXL, drop pari) ≤ PPL(IQ2M, drop pari) + 0.02 **e** decode ≥ +8% | **CANDIDATO CAMBIO MODELLO** — dossier a gualt (nuova baseline, budget lossy RIAZZERATO sul nuovo file) |
| PPL migliore ma decode < +8% | dossier a gualt comunque (qualità gratis vale da sola) |
| PPL peggiore oltre +0.02 a parità di drop | buco chiuso, IQ2_M resta |
| hit% crolla per slot più grossi (>5 pp) | riportare la curva, decisione a gualt |

## BUCO 2 — i thread mai sweeppati (il -t 4 è ereditato, non misurato)

La campagna ha sempre girato `-t 4` + `--io-threads 4`. Su llama.rn (altro runtime)
6 thread davano −32% di prefill vs 4 e 8 era catastrofico — MAI verificato sul
fork, MAI sul decode. L'8 Gen 2 ha 1×X3 + 2×A715 + 2×A710 + **3×A510 fermi**: al
ceiling termico i piccoli core sono perf/watt migliori = throughput sostenuto
gratis, SE lo scheduler non li usa già.

Celle (staccato, ABBA-ish con cold, f45_1 n=200, 2 rep): `-t 4` (baseline), `-t 5`,
`-t 6`; se `-t 6` ≥ `-t 4`: aggiungere `-t 7`. Poi il vincitore × sostenuto n=512
(il verdetto vero è sul sostenuto: più thread = più watt = throttle prima?).
Metriche: eval tok/s, die curva, freq se leggibile da sysfs.
| esito | decisione |
|---|---|
| un -t batte 4 di ≥ +5% ANCHE sul sostenuto | candidato adozione config (gualt) |
| vince solo sul burst ma perde sul sostenuto | a verbale, resta 4 |
| tutto entro ±3% | chiuso: 4 era giusto |

## BUCO 3 — quantificare il ceiling termico (serve gualt fisicamente)

Se il decode è compute-bound a 1.39 GHz per termica, il numero che manca è: **quanto
vale un grado?** Esperimento: sostenuto n=512 × 2 condizioni — (a) normale,
(b) **raffreddamento attivo** (ventola puntata / piastra fredda dietro il telefono —
lo decide gualt, niente liquidi vicino alle porte). Stessa config, stesso prompt,
cold, staccato, 2 rep per condizione.
Lettura: Δ tok/s e Δ freq/die. Se (b) ≫ (a) (es. +20-30%): il ceiling è QUANTIFICATO
— non shippa una ventola, ma informa (1) se vale un cap di frequenza sotto la soglia
di throttle per un sostenuto più stabile, (2) la roadmap hardware (vapor chamber dei
device successivi = velocità gratis). Se (b) ≈ (a): il ceiling NON è (solo) termico
— scoperta grossa, riportare.

## Deliverable

`reports/moe-buchi-calcolo.md`: 1a subito con verdetto; poi 1b/2/3 man mano
(il mandato può chiudere in più sessioni; un commit per blocco). Predizioni a
verbale PRIMA dei numeri (1a: g≥1.4; 2: -t5/6 ±0; 3: +15-25% col cooling).
Artefatti `results/buchi/`. **STOP ai gate — cambio modello, config thread e
qualunque adozione sono di gualt.**
