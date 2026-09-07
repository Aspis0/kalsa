# REPORT — cella `adreno-acc-type`
Board QRD8650 (SM8650/pineapple, **Adreno 750**), sessione QDC **808196**, host `sa812265`, serial `80003b9c`,
7/09/2026. Kit `kit-gemm-acc-probe.tgz` sha `6c0414bacd36c26ffad5a44cc44a6238a2cf6463f7593c97d16e56336669428c`
costruito da `kalsallama-wt-accprobe` @`7ef9389bc` (ramo `kalsa/gemm-acc-probe`, due soli file diversi dal pinnato
2f3b24dee, `source_dirty=0`, `fault_define_occurrences=0`). Modello `LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6…`,
corpus 3079 parole, `-s 42 -c 256 -b 256 -fa off --temp 0`. I due file diversi dal pinnato sono
`ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl` e `ggml/src/ggml-opencl/ggml-opencl.cpp`; senza `-D` il primo
preprocessa **identico** al file base (`clang -E`, 167 righe contro 167, diff vuoto).
La base CPU è generata **una volta per invocazione** e condivisa da tutte le varianti di quell'invocazione: le
invocazioni sono state due (`raw/sa812265/`, `raw/sa812265b/`) quindi le basi sono due, e sono **identiche** —
vedi il controllo di sanità qui sotto.
⚠️ La sha del kit **sul device** è registrata solo nel secondo batch (`raw/sa812265b/kit-device-sha.txt` =
`6c0414ba…`, uguale al tarball costruito); in `raw/sa812265/kit-device-sha.txt` c'è `MISSING`. Il kit sul device è lo
stesso file in entrambi i batch, ma il primo non ne conserva una prova propria.

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

## Il controllo di sanità pre-registrato (lettura 7) — PASSATO, e più forte del richiesto
La lettura 7 chiedeva che il braccio CPU desse una PPL entro l'incertezza della cella precedente. Risultato:
`Final estimate: PPL = 22.9415 +/- 1.68463` in **entrambe** le invocazioni di questa cella **e** nella cella
precedente (`adreno-precision-bisect/raw/sa812121-faoff/cpu-kld.log`) — cifra per cifra, con un kit diverso, in una
sessione diversa, su un esemplare fisico diverso di board. Non "entro l'incertezza": identica. Nessun log di variante
contiene errori di build del kernel (`raw/*/variant-*.errors` sono tutti vuoti).

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
   (95,8×) e il "stesso token in testa" sale da **62,8 % a 94,8 %**. Il PPL delta passa da +8,40 a +0,35.
   La variante `deq`, che in più allarga anche la dequantizzazione dei pesi, **non aggiunge nulla** (0,004793 contro
   0,004736, cioè leggermente peggio): la precisione della dequantizzazione non fa parte della storia.

## Dove ci lascia, rispetto ai riferimenti pubblicati
La soglia più severa dell'Amendment 4 era **congiuntiva**: mediana ≤ 0,005 **e** same-top ≥ 95 %. `mul` soddisfa la
prima (0,004736) e **non** la seconda (94,826 %, cioè 0,174 punti sotto): **la congiunzione NON è soddisfatta**, e
questo va scritto così, non arrotondato a "dentro la soglia". Per contesto, i riferimenti pubblicati per pesi identici:
CUDA contro FP32 mediana 0,004962 / same-top 95,0 % (issue #25593), Q8_0 0,002344 / 97,5 % (discussion #22498). Resta anche un fattore ~5 fra `mul` (0,004736) e il percorso GEMV fp32 misurato
in batch 1 (0,000962): un residuo esiste, e il candidato che questa cella **non** ha potuto toccare è l'ultimo asse —
gli operandi come sono **memorizzati**, cioè l'immagine B in `CL_HALF_FLOAT` scritta dal kernel di trasposizione
(`ggml-opencl.cpp:17150`, `:17170`, righe dell'albero `kalsallama-wt-accprobe` @7ef9389bc) che nel percorso batch-1 non esiste affatto. Serve una modifica host: è la
prossima cella.

## Il costo in velocità: INDICATIVO, non stabilito
`mul` gira a 189,73 t/s. Contro i 286,30 dello **stesso batch** fa 0,663×; contro i **289,98 ± 1,28 pre-registrati**
come riferimento (misurati in una sessione fredda della cella precedente) fa 0,654×. Il PREREG chiedeva il secondo
denominatore e nel primo giro ho usato il primo: entrambi vanno detti. Su quella soglia la lettura 6 si applica solo
in un verso: **sotto 0,50× l'opzione "prefill GPU sempre acceso" sarebbe morta, e non lo è** con nessuno dei due
denominatori; la domanda dello 0,85× resta aperta e non è decidibile con questi numeri.
Perché non sono una misura: le otto celle sono state prese in sequenza su un board che si scaldava. La prova sta nel
raw, e va descritta con precisione perché la prima stesura di questo REPORT la descriveva male: **non** è la stessa
riga di comando dei passi di bench. È una `llama-bench -p 512 -n 128 -ngl 99 -fa 0 -r 3` (quindi con in più il
carico `tg128`), lanciata **a mano fuori dal driver**, senza timestamp proprio, dopo la fine dell'ultimo passo del
driver (`bench-strict-deq` chiuso alle `09:04:28Z`) e quindi circa **12 minuti** dopo `bench-stock-half`
(`08:54:33Z`) e ~20 minuti dopo l'inizio della sessione (`Started On 04:49:11` locale). Il carico `pp512` misurato è
lo stesso, l'invocazione no. Risultato: `pp512 = 165,74 ± 53,58` contro `286,30 ± 0,61`. Una deviazione standard di
quel calibro su una configurazione che venti minuti prima dava ±0,61 è il segnale che il board sta throttlando; con
n=1 e senza telemetria termica archiviata, "deriva termica" resta la spiegazione più probabile, non una diagnosi
misurata. Cosa regge comunque: le coppie `stock`/`strict`, prese **adiacenti**, concordano entro l'1 %; e `acc`
(172,8) è più lento di `mul` (189,7) pur essendo stato misurato **prima**, quindi quell'ordine non è un artefatto
del riscaldamento. Una misura valida richiede raffreddamento fra le celle e ordine randomizzato: non è stata fatta.
Il decode non è stato misurato in modo valido per lo stesso motivo; che la patch non lo tocchi è invece un fatto di
codice (il diff cambia solo il kernel GEMM e il suo blocco di build, `gemv_noshuffle_q4_0_f32.cl` è intatto).

## Provenienza, e il buco che ha VOIDato le righe
⚠️ **Tutte e otto le righe di `variants.tsv` sono marcate VOID con `provenance_missing`**, e la regola è giusta: il
driver esige che il log della run contenga la riga `prec=… math=…` emessa dal binario, e quella riga **non c'è**.
Motivo, accertato dopo: `llama-perplexity` filtra i log INFO del backend ggml (nei suoi log non compare nemmeno
`ggml_opencl: selected platform`), e `llama-bench` li silenzia se non gli si passa `-v`. La riga esiste e funziona:
catturata a parte con `llama-bench -v` e archiviata in `raw/provenance/provenance-lines.txt`. **Copertura delle sonde:
quattro combinazioni su otto** — `half`/stock, `mul`/stock, `deq`/stock e `acc`/**strict**. Non sono state sondate
`acc`/stock, `strict`/half, `strict`/mul, `strict`/deq. Le due righe complete, copiate dal file:
```
gemm_noshuffle_q4_0_f32 prec=acc math=strict compile_opts='-cl-std=CL3.0 -cl-mad-enable -DKALSA_GEMM_PREC=1'
gemm_noshuffle_q4_0_f32 prec=mul math=stock compile_opts='-cl-std=CL3.0 -cl-mad-enable -cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math -DKALSA_GEMM_PREC=2'
```
La riga `acc` è l'unica prova diretta che `math=strict` toglie davvero i tre flag, e la riga `mul` l'unica che
`math=stock` li tiene: le due varianti dell'asse MATH sono quindi verificate una volta ciascuna, non otto.
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
- La KLD di ogni braccio GPU contiene anche operazioni che nessuna variante tocca (`ne1 == 1` va al GEMV, `ggml-opencl.cpp:17087` nello stesso albero,
  `use_adreno_kernels` esclude forme piccole e tensori non 2D): i confronti fra varianti restano validi, il valore
  assoluto GPU-contro-CPU non è attribuibile per intero al GEMM.
