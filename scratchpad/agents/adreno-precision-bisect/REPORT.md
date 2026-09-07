# REPORT — Adreno prefill precision bisection (cella `adreno-precision-bisect`)
Board QRD8650 (SM8650/pineapple, Adreno 750), kit `kit-2f3b24dee.tgz` da `kalsallama-wt-oclpicks-25910` @2f3b24dee
(albero verificato pulito: `source_dirty=0`, `fault_define_occurrences=0`), modello
`LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (lo stesso file che
spedisce l'app), corpus 3079 parole, `-s 42`, `-c 512`. Strumento: `llama-perplexity --kl-divergence-base` (braccio di
riferimento) + `--kl-divergence` (braccio in esame), cioè il confronto di serie di llama.cpp, non uno nostro.

## Le tre misure, in ordine
| # | sessione / job | configurazione | Median KLD | Same top p | PPL delta |
|---|---|---|---|---|---|
| 1 | 808042 / sa812111 | CPU `-ngl 0` vs GPU `-ngl 99`, flash attention lasciata ad `auto` | 0,454348 | 62,373 ± 1,149 % | 8,498116 ± 1,143139 |
| 2 | 808052 / sa812121-faoff | idem, ma `-fa off` su ENTRAMBI i bracci | 0,453822 | 62,823 ± 1,146 % | 8,400806 ± 1,140076 |
| 3 | 808052 / sa812121-b1 | `-fa off` su entrambi **e batch 1** (instrada la GPU sul kernel GEMV) | **0,000962** | **98,031 ± 0,330 %** | **0,274311 ± 0,062392** |
Costo: 51+31 s (misura 1), 32+30 s (misura 2), 254+191 s (misura 3, il batch 1 è lento per costruzione).

## Cosa dicono, nell'ordine in cui le letture erano pre-registrate
1. **La misura 1 non era pulita, e il difetto era nostro nel disegno**: i due bracci calcolavano l'attenzione con
   algoritmi diversi. Il log del braccio GPU dice `resolve_fused_ops: Flash Attention not supported, set to disabled`;
   nei dump: CPU 8 `FLASH_ATTN_EXT` e 0 `SOFT_MAX`, GPU 0 e 8. `compare_dump.py` si è correttamente rifiutato di
   allineare i due grafi (1014 vs 1054 tensori, `UNALIGNED`, rc=2), quindi la localizzazione tensore-per-tensore è
   **DESCRIPTIVE** per la lettura #4 del PREREG: da quei dump non si conclude nulla.
2. **La misura 2 uccide l'ipotesi dell'attenzione**: con lo stesso algoritmo su entrambi i bracci ogni cifra resta
   dentro l'incertezza della misura 1 (0,4538 vs 0,4543; 62,8 vs 62,4 %). Il percorso di attenzione NON è la causa
   (lettura #2 dell'Amendment 1).
3. **La misura 3 individua la causa senza modificare un kernel.** Il recon aveva stabilito che il percorso Adreno per
   Q4_0 sceglie il kernel in base alla larghezza del batch: `ne1 == 1` → `gemv_noshuffle_q4_0_f32.cl:225`
   `__private float2 totalSum = (float2)(0.0f);` (accumulo fp32, immagine B `CL_FLOAT`); `ne1 > 1` →
   `gemm_noshuffle_q4_0_f32.cl:38` `half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;` (accumulo f16, immagine B `CL_HALF_FLOAT`).
   Passando dal secondo al primo, con pesi, corpus, seme e attenzione identici, la divergenza **crolla di 472×** in KLD
   mediana e il "stesso token in testa" passa da 62,8 % a 98,0 %. La lettura pre-registrata ("median ≤ 0,05 e same-top
   ≥ 90 % → il percorso GEMM f16 è la causa") è soddisfatta con enorme margine.

## Conclusione e portata
**La divergenza del prefill GPU su Adreno è causata dall'accumulo in mezza precisione nel GEMM quantizzato**, non
dall'attenzione e non da un difetto localizzato di un singolo operatore. Il residuo con accumulo fp32 (KLD mediana
0,00096) è dello stesso ordine di quanto una GPU CUDA mostra per pure differenze aritmetiche, cioè fedeltà normale.
Lo schema `half8 c0` è identico in TUTTI E DIECI i `gemm_noshuffle_*` quantizzati (iq4_nl, q1_0, q4_0, q4_1, q4_k,
q5_0, q5_1, q5_k, q6_k, q8_0), quindi riguarda ogni quantizzazione spedibile, non solo la nostra. Il decode non è
esposto (GEMV, fp32).
Questo spiega a valle: la divergenza a livello app misurata in ALIVE 55 (8 token diversi su 32 con la CPU sicura) e i
FAIL dell'oracolo a token già visti su 732, 735 e 8650 (righe 51/52/54).

## Riferimento di velocità per il fix (misurato qui, stessa sessione)
`llama-bench -p 512 -n 0 -ngl 99 -fa 0 -r 3` → **pp512 = 289,98 ± 1,28 t/s** (OpenCL, Q4_0, 2,70 B).
È il numero che l'esperimento ACC_TYPE dovrà battere o pagare: Qualcomm documenta FP16 a throughput doppio rispetto a
FP32, quindi il costo atteso è al peggio ~2× sulla moltiplicazione, e la decisione di prodotto sarà "quanta velocità
vale la fedeltà".

## Cosa NON è dimostrato
- Che l'accumulo fp32 nel GEMM risolva: il batch 1 usa un kernel DIVERSO, non il GEMM con accumulatori cambiati. La
  prova arriva solo dalla cella ACC_TYPE, con il suo PREREG e la sua misura di velocità.
- Nulla su altri board: tutte e tre le misure sono sul solo Adreno 750. Il 732/735/8 Elite vanno rimisurati.
- Nessuna riga di `test-backend-ops` è citata come prova di fedeltà: la suite è verde su questa famiglia e non vede
  questo difetto — è il punto che la cella esisteva per rompere.
