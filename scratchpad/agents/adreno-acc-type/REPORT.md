# REPORT — cella `adreno-acc-type`
Board QRD8650 (SM8650/pineapple, **Adreno 750**), sessione QDC **808196**, host `sa812265`, serial `80003b9c`,
7/09/2026. Kit `kit-gemm-acc-probe.tgz` sha `6c0414bacd36c26ffad5a44cc44a6238a2cf6463f7593c97d16e56336669428c`
costruito da `kalsallama-wt-accprobe` @`7ef9389bc` (ramo `kalsa/gemm-acc-probe`, due soli file diversi dal pinnato
2f3b24dee, `source_dirty=0`, `fault_define_occurrences=0`). Modello `LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6…`,
corpus 3079 parole, `-s 42 -c 256 -b 256 -fa off --temp 0`, base CPU generata **una sola volta** per invocazione e
condivisa da tutte le varianti.

## Le otto misure
| variante | Median KLD | Same top p | PPL delta | pp512 (t/s) |
|---|---|---|---|---|
| `stock:half` (controllo) | 0,453822 | 62,823 ± 1,146 % | 8,400806 | 286,30 ± 0,61 |
| `strict:half` | **0,453822** | **62,823 %** | **8,400806** | 287,99 ± 3,30 |
| `stock:acc` | 0,460999 | 61,417 ± 1,155 % | 10,085475 | 172,84 ± 0,68 |
| `strict:acc` | **0,460999** | **61,417 %** | **10,085475** | 172,70 ± 0,30 |
| **`stock:mul`** | **0,004736** | **94,826 %** | **0,349474** | 189,73 ± 0,27 |
| `strict:mul` | **0,004736** | **94,826 %** | **0,349474** | 189,50 ± 0,91 |
| `stock:deq` | 0,004793 | 94,488 % | 0,360485 | 182,08 ± 0,56 |
| `strict:deq` | **0,004793** | **94,488 %** | **0,360485** | 182,06 ± 0,47 |
Riferimenti fissi dalla cella precedente: stock GPU 0,4538 / 62,8 % / +8,40; GEMV fp32 (batch 1) 0,000962 / 98,0 % / +0,27.

## Le tre letture, nell'ordine in cui erano pre-registrate
1. **I flag matematici del compilatore non c'entrano — lettura 0.b.** `stock` e `strict` danno numeri **identici alla
   sesta cifra decimale** in tutte e quattro le coppie, e velocità uguali entro il rumore. Togliere
   `-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` dal solo programma del GEMM non cambia
   nulla. Cade anche il timore dell'audit che i flag potessero far compilare varianti diverse nello stesso binario:
   `acc` e `mul` sono chiaramente binari diversi (velocità e KLD diverse), quindi il collasso non è avvenuto.
2. **L'accumulatore f16 NON è la causa — lettura 3.** Portare `c0..c3` da `half8` a `float8` lasciando il prodotto in
   half **non ripara**: 0,4610 contro 0,4538, same-top 61,4 % contro 62,8 %, PPL delta persino peggiore (10,09 contro
   8,40). Questo **refuta l'analogia** con i due precedenti che avevamo trovato online: su WebGPU (#25748) *"f16 loads,
   f32 accumulation"* risolveva la corruzione e su Vulkan (#18969) il default `f16acc` è indicato come causa. Su Adreno
   quella stessa leva non serve.
3. **La causa è la MOLTIPLICAZIONE in f16 — lettura 4.** Convertendo gli operandi a float **prima** di moltiplicarli
   (`convert_float8(B) * (float)dequantized_weights.sN`), a parità di tutto il resto — stessi pesi, stesso corpus,
   stesso seme, stessa immagine B in `CL_HALF_FLOAT`, stessi flag — la KLD mediana crolla da **0,4538 a 0,004736**
   (96×) e il "stesso token in testa" sale da **62,8 % a 94,8 %**. Il PPL delta passa da +8,40 a +0,35.
   La variante `deq`, che in più allarga anche la dequantizzazione dei pesi, **non aggiunge nulla** (0,004793 contro
   0,004736, cioè leggermente peggio): la precisione della dequantizzazione non fa parte della storia.

## Dove ci lascia, rispetto ai riferimenti pubblicati
`mul` a 0,004736 sta **dentro** la soglia più severa che la nostra ricerca online abbia trovato per un backend
corretto — CUDA contro FP32 riporta mediana 0,004962 e same-top 95,0 % (issue #25593), Q8_0 riporta 0,002344 / 97,5 %
(discussion #22498). Il same-top di `mul`, 94,83 %, resta **0,17 punti sotto** il 95 % di quel riferimento: va detto
così e non arrotondato a "risolto". Resta anche un fattore ~5 fra `mul` (0,004736) e il percorso GEMV fp32 misurato
in batch 1 (0,000962): un residuo esiste, e il candidato che questa cella **non** ha potuto toccare è l'ultimo asse —
gli operandi come sono **memorizzati**, cioè l'immagine B in `CL_HALF_FLOAT` scritta dal kernel di trasposizione
(`ggml-opencl.cpp:17150`, `:17170`) che nel percorso batch-1 non esiste affatto. Serve una modifica host: è la
prossima cella.

## Il costo in velocità: INDICATIVO, non stabilito
`mul` gira a 189,73 t/s contro 286,30 dello stock nella stessa sessione, cioè **0,66×**. Ma queste cifre non sono una
misura pulita e non vanno citate come tale: sono state prese in sequenza su un board che si scaldava. La prova sta nel
raw di questa cella — rieseguendo **la stessa identica configurazione stock** dopo ~20 minuti di carico continuo il
board ha dato `pp512 = 165,74 ± 53,58` e `tg128 = 15,69 ± 6,63`, contro i 286,30 ± 0,61 di venti minuti prima. Con una
deviazione standard di quel calibro, qualunque confronto fra varianti prese in momenti diversi porta una deriva termica
non quantificata. Cosa si può dire onestamente: le coppie `stock`/`strict`, prese **adiacenti**, concordano entro l'1 %;
`acc` (172,8) è più lento di `mul` (189,7) pur essendo stato misurato **prima**, quindi quell'ordine non è un artefatto
termico. Una misura di velocità valida richiede raffreddamento fra le celle e ordine randomizzato: non è stata fatta.
Il decode non è stato misurato in modo valido per lo stesso motivo (il GEMV non è toccato dalla patch, quindi
l'aspettativa è "nessun effetto", ma è un'aspettativa, non un dato).

## Provenienza, e il buco che ha VOIDato le righe
⚠️ **Tutte e otto le righe di `variants.tsv` sono marcate VOID con `provenance_missing`**, e la regola è giusta: il
driver esige che il log della run contenga la riga `prec=… math=…` emessa dal binario, e quella riga **non c'è**.
Motivo, accertato dopo: `llama-perplexity` filtra i log INFO del backend ggml (nei suoi log non compare nemmeno
`ggml_opencl: selected platform`), e `llama-bench` li silenzia se non gli si passa `-v`. La riga esiste e funziona:
catturata a parte con `llama-bench -v`, archiviata in `raw/provenance/provenance-lines.txt`, per tutte e quattro le
precisioni. Esempio verbatim:
```
ggml_opencl: gemm_noshuffle_q4_0_f32 prec=acc math=strict compile_opts='-cl-std=CL3.0 -cl-mad-enable -DKALSA_GEMM_PREC=1'
ggml_opencl: gemm_noshuffle_q4_0_f32 prec=mul math=stock compile_opts='… -cl-fast-relaxed-math -DKALSA_GEMM_PREC=2'
```
Quindi la provenienza c'è, ma **non nel log della misura**: è una prova ricostruita a lato, ed è più debole di quella
che il PREREG chiedeva. Cosa la sostiene comunque, oltre alle sonde:
- `stock:half` ha riprodotto il controllo archiviato **alla sesta cifra decimale** (0,453822 / 62,823 / 8,400806,
  identici alla misura 2 della cella precedente, fatta con un altro kit su un altro esemplare di board): il default
  non ha cambiato nulla, come il confronto `clang -E` prevedeva.
- le varianti hanno velocità **fisicamente diverse** (286 / 173 / 190 / 182 t/s): un `-D` ignorato non può produrre un
  calo del 40 %.
Il driver va corretto per la prossima cella: sonda `llama-bench -v` per variante prima della run KLD, oppure il log
della riga a livello WARN.

## Cosa questa cella NON dimostra
- Nulla su altri board: solo Adreno 750. Su 732/735/8 Elite lo schema sorgente è lo stesso, la misura è assente.
- Nulla sugli altri nove `gemm_noshuffle_*` quantizzati, che hanno lo stesso `half8 c0` e lo stesso prodotto in half.
- Nulla sul decode, che passa dal GEMV fp32 e non è toccato.
- Non dimostra che `mul` sia "abbastanza buono" da spedire: 94,83 % di same-top è una misura, la soglia di prodotto è
  una decisione dell'owner.
- Non isola l'ultimo asse (operando B in memoria a f16), che resta il candidato per il residuo di 5× contro il GEMV.
- La KLD di ogni braccio GPU contiene anche operazioni che nessuna variante tocca (`ne1 == 1` va al GEMV,
  `use_adreno_kernels` esclude forme piccole e tensori non 2D): i confronti fra varianti restano validi, il valore
  assoluto GPU-contro-CPU non è attribuibile per intero al GEMM.
