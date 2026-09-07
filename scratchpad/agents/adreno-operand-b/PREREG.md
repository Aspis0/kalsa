# PREREG — cella `adreno-operand-b`
Aperta 7/09/2026, dopo ALIVE 57. Board QRD8650 (SM8650/pineapple, Adreno 750). Budget ≤ 60 min di 8 Gen 3
(residuo ~264 min). Due consegne, la seconda è un debito già contratto.

## Domanda 1 — l'ultimo asse
La cella `adreno-acc-type` ha dimostrato che l'infedeltà del prefill GPU viene dal **prodotto in f16** e che ripararlo
porta la KLD mediana da 0,4538 a **0,004736** (same-top 94,826 %). Resta un fattore ~5 contro il percorso GEMV fp32
misurato in batch 1 (**0,000962**, same-top 98,031 %), e la soglia congiuntiva dell'Amendment 4 della cella precedente
(mediana ≤ 0,005 **e** same-top ≥ 95 %) **non è soddisfatta** proprio per lo 0,174 % di same-top.
L'unico asse mai toccato è l'operando **come è memorizzato**, e ora è localizzato riga per riga sull'albero
`kalsallama-wt-accprobe` @7ef9389bc:
- `ggml-opencl.cpp:17164` `img_fmt = {CL_RGBA, CL_FLOAT};` — le attivazioni **arrivano in f32**;
- `transpose.cl:113` `// converts to FP16`, `:127` `temp0 = read_imageh(input, (j_2+0)*cols+i);`, `:139` `write_imageh(...)`
  — il kernel di trasposizione le **restringe deliberatamente a f16**;
- `ggml-opencl.cpp:17185` `img_fmt = {CL_RGBA, CL_HALF_FLOAT};` su scratch `:17180`
  `region.size = K * (N + padding) * sizeof(float)/2;` — la destinazione è f16 e dimensionata a metà;
- `:17087` `if (ne1 == 1) {` — il percorso che misura pulito **non traspone affatto** e resta in `CL_FLOAT` (`:17106`).
**Domanda: portando la gamba trasposta a f32, la KLD residua si chiude?**

## Come si costruisce la variante (vincoli, non suggerimenti)
- ⛔ `kernel_transpose_32_16` è **condiviso da dieci percorsi quantizzati** (q1_0, q4_0, q4_1, q5_0, q5_1, iq4_nl,
  q8_0, q4_K, q6_K, q5_K: launch a `:17002`, `:17205`, `:17404`, `:17584`, `:17765`, `:17939`, `:18228`, `:18410`,
  `:18598`, `:18799`). **Non si modifica**: si aggiunge un kernel f32 separato, usato solo dal percorso q4_0 e solo
  quando la variante è attiva. Toccare quello condiviso cambierebbe nove percorsi non misurati.
- Selettore a runtime `KALSA_GEMM_B=half|float`, default `half` = comportamento odierno **bit a bit**, verificato come
  nella cella precedente: senza `-D` il kernel deve preprocessare identico al file base (`clang -E`, diff vuoto).
- La variante si misura **sopra `KALSA_GEMM_PREC=mul`**, che è la configurazione candidata a spedire; misurarla sopra
  `half` risponderebbe a una domanda che non interessa a nessuno.
- Il gate di sintassi OpenCL dell'NDK gira su tutte le combinazioni prima di spendere device.

## Letture PRE-REGISTRATE (scritte prima di qualunque numero)
Riferimenti fissi: `mul` con B in f16 = **0,004736 / 94,826 % / +0,349**; GEMV fp32 in batch 1 = **0,000962 / 98,031 % /
+0,274**; stock = 0,453822 / 62,823 %.
1. **mediana ≤ 0,0015 e same-top ≥ 97,5 %** → la precisione dell'operando memorizzato spiega il residuo, e il percorso
   batch>1 raggiunge il batch-1. La catena causale si chiude: prodotto **e** operando, in quest'ordine di importanza.
2. **mediana ≤ 0,005 e same-top ≥ 95 %** (ma fuori dalla 1) → la soglia congiuntiva del riferimento pubblicato è
   soddisfatta per la prima volta; il residuo è ridotto ma non chiuso, e va nominato come tale.
3. **mediana entro il 20 % di 0,004736** → l'operando memorizzato **non** è il residuo. I sospetti che restano, già
   nominati e non ancora testati: la geometria del tile (due forme di workgroup, `{1,128,1}` e `{2,64,1}`) e l'ordine
   di somma. Si banca come refutazione.
4. **Qualunque peggioramento oltre il 20 %** → difetto nell'implementazione della variante, non un risultato: VOID e
   si rilegge il codice.
5. **Costo in banda**: la gamba trasposta raddoppia da 2K a 4K byte per token (dal codice, `:17180`). Se `pp512` cala
   di più del 25 % rispetto a `mul`, il fix completo è più caro del prodotto da solo e la decisione diventa
   "quanta fedeltà per quanta velocità" — che è dell'owner, non mia.

## Consegna 2 — il debito: la velocità di `mul` misurata come si deve
L'Amendment 8 della cella precedente dichiara che le velocità di quella sessione **non sono una misura** (stessa
configurazione stock: 286,30 ± 0,61 a freddo, 165,74 ± 53,58 dopo dodici minuti di carico). Il debito si paga qui, col
driver corretto: `--cool <s>` fra i passi di bench, **ordine randomizzato con seed registrato**, temperatura letta
prima e dopo ogni passo, e `bench.tsv` con ordine realizzato, temperature e gap reale. Si misurano `half`, `mul` e
`mul+B float`, e si riporta il rapporto contro **289,98 ± 1,28** (il riferimento pre-registrato) **e** contro l'arm
`half` della stessa sessione. Senza questo, la conseguenza per il governor scritta in PLAN (il vantaggio del prefill
GPU su V73/V75 che scenderebbe da ~1,7× a ~1,1×) resta una previsione non falsificata.

## Regole di condotta
- Provenienza: il driver ora esegue una sonda `llama-bench -v` per variante e pretende sia la riga `prec=…/math=…`
  sia `selected platform: 'QUALCOMM` (un fallback CPU silenzioso ha già bruciato una run in questa campagna).
- Nessun claim senza il log che lo contiene; ogni numero nel REPORT cita il file in `raw/`.
- Kit costruito solo dall'albero pinnato con le guardie già in uso (`source_dirty=0`, `fault_define_occurrences=0`,
  tutte le `.so` imbarcate, diff limitato ai file attesi).

## Cosa questa cella NON dimostrerà
- Nulla su 732/735/8 Elite, né sugli altri nove kernel `gemm_noshuffle_*`, né sui dieci percorsi che condividono il
  kernel di trasposizione.
- Nulla sul decode (GEMV, non toccato).
- Non deciderà se spedire: la soglia di prodotto è una decisione dell'owner, non una misura.

## Amendment 1 — 7/09, PRIMA della sessione: i bracci esatti e il protocollo di velocità
Scritto prima di vedere qualunque numero della nuova build.

**Bracci KLD, in quest'ordine** (il driver accetta `math:prec:b`, la forma a due campi vale `b=half`):
1. `stock:half` — **controllo di continuità del kit nuovo**: deve riprodurre 0,453822 / 62,823 %. Se non lo fa, il kit
   è VOID e non si va oltre: significa che qualcosa è cambiato oltre a ciò che volevamo.
2. `stock:mul` — **controllo di continuità della misura precedente**: deve riprodurre 0,004736 / 94,826 %. Serve a
   escludere che il nuovo kit (tre file diversi dal pinnato invece di due) abbia spostato il braccio già bancato.
3. `stock:mul:float` — **il braccio in esame**.
4. `stock:deq:float` — solo se il 3 soddisfa una lettura, per vedere se la dequantizzazione aggiunge qualcosa una
   volta che l'operando è f32 (con B in f16 non aggiungeva nulla).
I bracci `strict` non si ripetono: nella cella precedente `stock` e `strict` erano identici alla sesta cifra in tutte
e quattro le coppie, quindi ripeterli qui spenderebbe device per riconfermare un risultato nullo. Se una qualunque
lettura di questa cella risultasse ambigua, `strict:mul:float` si aggiunge come controllo.

**Protocollo di velocità** (paga il debito dell'Amendment 8 della cella `adreno-acc-type`): `--cool 180`,
`--bench-seed` registrato, temperatura letta prima e dopo ogni passo, tre bracci `half`, `mul`, `mul:float`.
Lettura di validità **pre-registrata**: se le temperature di **inizio** dei tre passi differiscono di più di **2 °C**,
il confronto è dichiarato degradato e i rapporti si riportano come indicativi, esattamente come nella cella
precedente — non si nasconde la deriva dietro una media. Se rientrano nei 2 °C, il rapporto `mul/half` misurato qui
**sostituisce** lo 0,663×/0,654× indicativo e chiude il debito. 180 s è una scelta, non una misura: nasce dal fatto che
i passi di bench durano ~25 s e che dodici minuti di carico continuo sono bastati a portare il board fuori scala;
se le temperature registrate mostrano che non basta, il numero si alza nella cella successiva e lo si dice.
