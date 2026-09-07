# PREREG — cella `adreno-acc-type`
Aperta 7/09/2026. Board: QRD8650 (SM8650/pineapple, Adreno 750) su Qualcomm Device Cloud.
Budget dichiarato: ≤ 60 min di device 8 Gen 3 (residuo ~290 min). Nessun lavoro su 8 Elite in questa cella.

## Domanda
La cella `adreno-precision-bisect` ha stabilito che il prefill GPU Adreno è infedele **per il percorso GEMM usato
quando il batch > 1** (KLD mediana 0,454 → 0,000962 instradando la stessa GPU sul GEMV fp32). Quell'esperimento
**non separa** accumulatore, prodotto, dequantizzazione e formato dell'operando: cambiano tutti insieme perché cambia
il kernel. Questa cella chiede: **quale di quelle precisioni, da sola, spiega l'infedeltà — e quanto costa in velocità
ripararla nel GEMM.**

## Il codice in causa (letto sull'albero pinnato, non citato a memoria)
Albero `kalsallama-wt-oclpicks-25910` @`2f3b24dee5833faeeb0ef6f097c4db3d11a96fb0`,
`ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl`:
- riga 38 `    half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0; // 8x4 output elements` — accumulatori f16
- riga 39 `    half8 B; // registers for activations` — attivazioni f16, caricate con `read_imageh` (righe 46-47)
- riga 40 `    half4 dequantized_weights; // registers for dequantized weights` — pesi dequantizzati in f16 (righe 56-59)
- riga 61 `        c0 += B * dequantized_weights.s0; // vector-scalar multiplication to accumulate` (e le 15 righe gemelle
  ai blocchi j=0..3) — prodotto f16 e accumulo f16
- riga 109 `        vstore4((float4)(c0.s0, c1.s0, c2.s0, c3.s0), 0, dst + idx);` — la scrittura in C è **già** float:
  nessuna modifica serve in uscita.
Quattro assi di precisione, uno per volta.

## Le varianti, e cosa cambia ciascuna
Tutte partono dallo stesso albero pinnato; ciascuna tocca SOLO il file del kernel Q4_0 GEMM; nessuna tocca l'host,
il formato dell'immagine B (`CL_HALF_FLOAT`), la selezione del kernel, o gli altri nove `gemm_noshuffle_*`.

| id | cosa cambia | cosa resta f16 |
|----|-------------|----------------|
| **V1 ACC** | accumulatori `half8 c0..c3` → `float8`; le 16 righe di accumulo diventano `c0 += convert_float8(B * dequantized_weights.s0);` | prodotto, dequantizzazione, immagine B |
| **V2 MUL** | V1 + prodotto in float: `c0 += convert_float8(B) * (float)dequantized_weights.s0;` | dequantizzazione, immagine B |
| **V3 DEQ** | V2 + `dequantized_weights` e `scale` in float | immagine B (operando in memoria) |
Fuori scoperta di questa cella: il quarto asse, cioè l'immagine B in `CL_HALF_FLOAT` (richiede una modifica host) e
gli altri nove kernel quantizzati.

## Strumento e configurazione, identici alla cella precedente
`llama-perplexity --kl-divergence-base` (braccio CPU `-ngl 0`) + `--kl-divergence` (braccio GPU `-ngl 99`), corpus
`adreno-precision-bisect/corpus.txt` (3079 parole), modello `LFM2.5-2.6B-QAD-Q4_0.gguf` sha
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`, `-s 42`, `-c 256`, `-b 256`, `-fa off` su
entrambi i bracci. Velocità: `llama-bench -p 512 -n 0 -ngl 99 -fa 0 -r 3`.
**Il braccio CPU è la base in ogni run**: la patch è in un kernel OpenCL, quindi con `-ngl 0` i due kit devono dare
la stessa base — se non la danno, la run è VOID e il kit è sospetto.

## Letture PRE-REGISTRATE (scritte prima di vedere qualunque numero)
Riferimenti fissi: **stock GPU = KLD mediana 0,4538 / same-top 62,8 % / PPL delta +8,40** (misura 2 della cella
precedente, `-fa off`); **GEMV fp32 = 0,000962 / 98,0 % / +0,27** (misura 3); **pp512 stock = 289,98 ± 1,28 t/s**.

1. **V1 con mediana ≤ 0,05 e same-top ≥ 90 %** → la precisione dell'**accumulatore**, da sola, spiega l'infedeltà del
   prefill GPU. È la lettura che chiude la domanda causale aperta da ALIVE 56.
2. **V1 con 0,05 < mediana < 0,20** → l'accumulatore è causa **parziale**: si prosegue con V2 e la conclusione si
   scrive solo dopo V2.
3. **V1 con mediana ≥ 0,20** (cioè entro il 60 % dello stock) → l'accumulatore **non** è la causa dominante; il difetto
   sta a monte (prodotto, dequantizzazione o operando). Si prosegue con V2, e V1 resta bancata come refutazione.
4. **V2 (o V3) che scende a mediana ≤ 0,05 e same-top ≥ 90 %** → la causa è l'asse aggiunto da quella variante,
   nominato esplicitamente; le varianti precedenti restano come refutazioni misurate.
5. **Nessuna variante sotto 0,05** → la causa non è nell'aritmetica del kernel ma nell'operando in memoria
   (immagine `CL_HALF_FLOAT`) o nell'ordine di somma; la cella si chiude con quella conclusione negativa e apre la
   cella host.
6. **Velocità**: per la prima variante che soddisfa la lettura 1 o 4 si misura `pp512` e si riporta il rapporto contro
   289,98 t/s. Nessuna soglia di accettazione di prodotto viene decisa qui — è dell'owner. Pre-registro solo questo:
   **sotto 0,50×** l'opzione "prefill GPU sempre acceso" è morta e la decisione passa al governor per fase;
   **sopra 0,85×** il costo è irrilevante per il prodotto.
7. **Controllo di sanità obbligatorio, per ogni run**: il braccio CPU deve dare `PPL` entro l'incertezza della cella
   precedente e il log deve contenere la riga di build del kernel senza errori. Un fallimento di compilazione del
   kernel OpenCL sul device è un esito **VOID**, non un risultato — si corregge la patch e si rimisura.

## Regole di condotta della cella
- Kit costruito SOLO da `kalsallama-wt-oclpicks-25910` @2f3b24dee con `build-kit.sh` e le sue guardie
  (`source_dirty=0`, `fault_define_occurrences=0`, tutte le `.so` imbarcate, dipendenze verificate).
  **MAI** da `kalsallama-wt-governor-v03`: quell'albero ha `#define KALSA_BENCH_FAULT_INJECT 1` attivo.
- Gate offline prima di spendere device: ogni kernel modificato passa un `-fsyntax-only` OpenCL con il clang dell'NDK.
  I kernel sono compilati a runtime dal driver Adreno, quindi senza questo gate un errore di tipo si scopre solo
  bruciando minuti di device.
- Le tre varianti si costruiscono e si trasferiscono **insieme**, e si eseguono in ordine V1 → V2 → V3 fermandosi alla
  prima che soddisfa la lettura; una sola sessione QDC.
- Nessun claim senza il log che lo contiene; ogni numero riportato in REPORT.md cita il file in `raw/`.
- L'albero pinnato non si sporca: le patch vivono come file `.patch` nella cella e vengono applicate a una copia.

## Cosa questa cella NON dimostrerà, qualunque esito
- Nulla sugli altri board (732, 735, 8 Elite): stesso sorgente, misura assente.
- Nulla sugli altri nove kernel `gemm_noshuffle_*` quantizzati: stesso schema `half8 c0`, misura assente.
- Nulla sul decode, che usa il GEMV fp32 e non è esposto.
- Non dimostrerà che la KLD residua sia "abbastanza bassa" per il prodotto: quella è una decisione, non una misura.

---

## Amendment 1 — 7/09, PRIMA di qualunque misura: i flag del compilatore sono un quinto asse
Il recon del codice ha trovato, e ho verificato io sull'albero pinnato, che i due percorsi confrontati nella cella
precedente non differiscono solo per la precisione:
- `ggml/src/ggml-opencl/ggml-opencl.cpp:1575-1577` — opzioni generali:
  `std::string compile_opts = std::string("-cl-std=") + opencl_c_std + " -cl-mad-enable -cl-unsafe-math-optimizations" " -cl-finite-math-only -cl-fast-relaxed-math";`
- `:3791` — il GEMM Q4_0 è costruito **con quelle**:
  `cl_program prog = build_program_from_source(backend_ctx->context, backend_ctx->device, kernel_src_CL_gemm.c_str(), compile_opts);`
- `:3678-3681` — il GEMV ha invece opzioni proprie **senza** unsafe/fast-relaxed math:
  `std::string CL_gemv_compile_opts = std::string("-cl-std=") + opencl_c_std + " -cl-mad-enable " " -DSIMDGROUP_WIDTH=" + ...`
- `:3695` — ed è con quelle che viene costruito il GEMV.

Quindi la misura 3 della cella `adreno-precision-bisect` ha cambiato **cinque** cose insieme (identità del kernel,
accumulatore, operando B, ordine di somma, flag matematici), non quattro. Attribuire l'infedeltà alla precisione senza
provare i flag sarebbe un errore di attribuzione. Si aggiunge quindi in testa alla scala:

| id | cosa cambia | costo |
|----|-------------|-------|
| **V0 MATHSTRICT** | kernel sorgente **invariato**; il solo programma del GEMM Q4_0 costruito senza `-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` (restano `-cl-std` e `-cl-mad-enable`, e `-qcom-enable-large-buffer` se attivo) | nessuna modifica al kernel |

Lettura pre-registrata aggiuntiva (scritta prima di vedere i numeri):
- **0.a V0 con mediana ≤ 0,05 e same-top ≥ 90 %** → la causa NON è la precisione dell'accumulatore ma i flag di
  compilazione, e la conclusione di ALIVE 56 va riscritta di conseguenza. È l'esito che manderebbe all'aria la spiegazione
  che tutti danno per buona: va cercato per primo, non per ultimo.
- **0.b V0 entro il 20 % dello stock (mediana ≥ 0,36)** → i flag non c'entrano; la scala prosegue con V1 e
  l'attribuzione alla precisione resta viva.
- **0.c V0 fra i due** → contributo parziale dei flag, da riportare come tale; V1 si misura comunque **con i flag stock**
  in modo che i due assi restino separabili.

## Amendment 2 — un solo kit, varianti selezionate a runtime
Costruire cinque kit e distinguerli per sha è fragile (la cella precedente ha già avuto due tarball dallo stesso albero).
Si costruisce **un solo kit** in cui kernel e opzioni sono parametrizzati con macro, sullo stesso meccanismo che il
GEMV già usa (`-DSIMDGROUP_WIDTH`, `-DVECTOR_SUB_GROUP_BROADCAST`, righe 3680/3683), e la variante si sceglie con due
variabili d'ambiente lette a caricamento kernel:
- `KALSA_GEMM_MATH` = `stock` (default) | `strict`
- `KALSA_GEMM_PREC` = `half` (default) | `acc` | `mul` | `deq`
I default devono lasciare il comportamento **identico** allo stock, e questo si verifica ri-misurando `stock/half` in
questa stessa sessione: deve riprodurre la mediana 0,4538 entro l'incertezza. Se non la riproduce, il kit è VOID.
Ogni run deve stampare a log la variante attiva e la stringa di opzioni realmente passata a `clBuildProgram`: è quella
riga, non il nome del file, la provenienza di ciascuna misura.

## Amendment 3 — gate di sintassi offline, verificato
`/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang -x cl -cl-std=CL1.2 -Xclang
-finclude-default-header -target spirv64 -fsyntax-only <kernel>.cl` dà rc=0 sul kernel stock (un solo warning,
`cl_qcom_reqd_sub_group_size` ignorato) e fallisce sulla modifica ingenua `half8 c0` → `float8 c0` con
`error: implicit conversions between vector types ('float8' ... and 'half8') are not permitted` alle righe 61-64.
Il gate va eseguito su OGNI combinazione di macro prima di spendere minuti di device. Corollario già acquisito: la
variante ACC **non** è una modifica di una riga — servono i `convert_float8(...)` sulle 16 righe di accumulo.

## Amendment 4 — 7/09, prior art (ricerca online, PRIMA di misurare)
Tutte le fonti seguenti sono di terzi: nessuna è una nostra misura, e nessuna riguarda Adreno + OpenCL + accumulatore.

**Nessuno l'ha già fatto.** Non esiste PR, issue, commit o fork upstream che implementi l'accumulo fp32 nei kernel GEMM
Adreno di `ggml-opencl`, né un confronto KLD pubblicato per quella modifica. La cella è inedita.

**Ma lo stesso interruttore ha già riparato lo stesso sintomo su altri due backend.** Sono i due precedenti che
giustificano di provare V1 per primo fra le varianti di precisione:
- WebGPU, issue #25748: *"Forcing the legacy mul_mat pipeline (f16 loads, f32 accumulation) … produces correct output"*
  — cioè esattamente la nostra V1: operandi half, accumulo float.
- Vulkan, issue #18969: *"This appears to be caused by the Vulkan backend defaulting to F16 Accumulation (`f16acc`)
  for `mul_mat_mat` operations on quantized models, which overflows…"*, e il segnalatore aggiunge che riducendo il
  chunk a 8 il lavoro passa per `mul_mat_vec` e il problema sparisce. È la stessa forma del nostro esperimento batch-1,
  su un altro backend. **CLAIMED**, non confermato da un manutentore.
Vulkan sceglie fra i due accumulatori a runtime — `base_dict["ACC_TYPE"] = f16acc ? "float16_t" : "float";` — e nessun
benchmark pubblico isola il costo di `_f32acc` su GPU mobile: il costo in velocità ce lo dobbiamo misurare noi.

**Esistono però cause NON di precisione con la stessa firma** (batch>1 rotto, batch-1 pulito), e la scala deve poterle
distinguere invece di attribuire per esclusione:
- Hexagon, issue #24201: *"Prefill produces corrupted logits when a ubatch contains ≥ 32 tokens"*, risolto abbassando
  la ubatch — sospetto un limite di vettorizzazione HVX, non la precisione.
- Vulkan, issue #25734: *"2 of 229 f16 cases FAIL with large error, all of them batched + broadcast + partial-tile
  shapes"*, causa reale = invariante di subgroup/tile violata, indicizzazione fuori tile.
- Issue #19957: fallback silenzioso su CPU per operazioni mancanti, con corruzione al confine GPU↔CPU.
Quindi la **lettura 5 si estende**: se nessuna variante scende sotto soglia, i sospetti non sono solo l'operando in
memoria ma anche (a) la geometria del tile del GEMM — il kernel dichiara `qcom_reqd_sub_group_size("full")` e viene
lanciato con due forme di workgroup diverse, `{1,128,1}` e `{2,64,1}` (`ggml-opencl.cpp:17208-17214`) — e (b) il
kernel di trasposizione che il percorso batch>1 esegue PRIMA del GEMM (`:17170` `kernel_transpose_32_16`, immagine di
destinazione `:17150` `img_fmt = {CL_RGBA, CL_HALF_FLOAT};`), che nel percorso batch-1 non esiste affatto.

**Le soglie si stringono** (il PREREG permette solo di stringere). Riferimenti pubblicati per confronti a pesi identici:
CUDA vs FP32 mediana 0,004962 / same-top 95,0 % (issue #25593); Q8_0 0,002344 / 97,5 % e Q6_K 0,006159 / 96,5 %
(discussion #22498); linea guida di comunità *"I generally consider everything with a kld < 0.1 as totally safe"*
(discussion #27085), che però riguarda la quantizzazione, non la fedeltà di un backend. Quindi, in aggiunta e senza
sostituire le soglie già scritte:
- **mediana ≤ 0,005 e same-top ≥ 95 %** = la variante è indistinguibile da un backend corretto secondo il riferimento
  pubblicato più severo. Il nostro GEMV fp32 (0,000962 / 98,0 %) già la soddisfa.
- **0,005 < mediana ≤ 0,05** = riparata ma non al livello del GEMV; va detto così, non arrotondato a "risolto".

**Nota di contesto, non di merito:** le due issue upstream che riportano proprio questo sintomo su Adreno sono
**entrambe chiuse senza causa individuata** — #16152 (Adreno 830, chiusa stale) e #25477 (Adreno 740, *closed as not
planned*), quest'ultima con *"The OpenCL backend produces wrong results for Q6_K MUL_MAT…"*. Nessun manutentore ha
nominato una causa in nessuna delle due. Non interagiamo con quelle issue in alcun modo.

## Amendment 5 — 7/09, dall'audit: la scala si raddoppia sull'asse dei flag
L'audit ha sollevato un rischio che, se ignorato, renderebbe la misura incapace di distinguere le varianti:
`-cl-fast-relaxed-math` e `-cl-unsafe-math-optimizations` autorizzano il compilatore a riassociare e ad allargare le
espressioni, quindi il compilatore Adreno **potrebbe** compilare PREC=0, 1 e 2 nello stesso identico binario. In quel
caso tre varianti darebbero lo stesso numero e la conclusione "l'accumulatore non conta" sarebbe falsa: non conterebbe
perché non è mai stato davvero cambiato. Non è dimostrabile dall'albero — è una proprietà del compilatore sul device.
Quindi ogni variante di precisione si misura **anche** con `KALSA_GEMM_MATH=strict`, e l'ordine di esecuzione è:
1. `stock:half` — riproduce il controllo; deve dare ≈ 0,4538, altrimenti il kit è VOID
2. `strict:half` — l'asse dei flag da solo (V0)
3. `stock:acc` — l'accumulatore float **nella configurazione che spedirebbe** (flag di produzione)
4. `strict:acc` — lo stesso senza i flag: se 3 e 4 coincidono, i flag non hanno collassato nulla; se 3 ≈ `stock:half`
   ma 4 no, il compilatore aveva vanificato la modifica e la lettura 3 del PREREG non si applica
5-8. `stock:mul`, `strict:mul`, `stock:deq`, `strict:deq` — solo se le precedenti non soddisfano una lettura.
Aggiunta di onestà terminologica: `strict` **non** è IEEE-strict, perché `-cl-mad-enable` resta in tutte le varianti
(`ggml-opencl.cpp:1577`). La contrazione mad è essa stessa un cambiamento numerico, costante fra i bracci; il REPORT
deve chiamarla "senza i tre flag rilassati", non "in precisione stretta".

## Amendment 6 — 7/09, dall'audit: cosa NON passa dal kernel modificato
`ggml-opencl.cpp:17087` `if (ne1 == 1) {` manda ogni matmul q4_0 a riga singola ai kernel GEMV **non modificati**, e
`use_adreno_kernels` (`:7227-7231`) esclude del tutto i pesi sotto la soglia di forma e i tensori non 2D. Quindi il
numero KLD di ogni braccio GPU contiene anche operazioni che nessuna variante tocca. Conseguenze pre-registrate:
- i confronti **variante contro variante** restano validi: la parte non toccata è identica in tutte.
- il confronto **GPU contro CPU** non è attribuibile per intero al GEMM: se una variante migliora molto ma si ferma
  sopra soglia, la spiegazione "resta un residuo fuori dal GEMM" è ammessa **solo** citando questo punto, non come
  scusa generica.
- il tetto di quanto quel residuo possa valere è già misurato: la misura 3 della cella precedente, in cui quasi tutto
  passava dal GEMV, dava 0,000962. Non è una prova (le forme cambiano), ma è l'indizio che le operazioni fuori dal
  GEMM non spiegano una divergenza di 0,45.

## Amendment 7 — 7/09, DOPO le misure: deviazione dichiarata sulla provenienza
La regola pre-registrata era: la riga `prec=…/math=…` deve stare **nel log della misura**, altrimenti VOID. Non c'è, e
tutte e otto le righe sono VOID per quella ragione. Causa accertata dopo: `llama-perplexity` non stampa i log INFO del
backend ggml (nei suoi log manca perfino `ggml_opencl: selected platform`), e `llama-bench` li silenzia senza `-v`.
La riga esiste e funziona: catturata a parte con `llama-bench -v` per tutte e quattro le precisioni e archiviata in
`raw/provenance/provenance-lines.txt`. **La deviazione si dichiara, non si sana**: la provenienza di questa cella è
ricostruita a lato ed è più debole di quella pre-registrata. Sostegni indipendenti, entrambi verificabili nel raw:
`stock:half` riproduce il controllo archiviato alla sesta cifra decimale, e le varianti hanno velocità fisicamente
diverse (286/173/190/182 t/s) che un `-D` ignorato non potrebbe produrre. Correzione obbligatoria per la prossima
cella: sonda `llama-bench -v` per variante prima della run KLD, o log della riga a livello WARN.

## Amendment 8 — 7/09, DOPO le misure: la velocità di questa cella non è una misura
La lettura 6 chiedeva `pp512` per la variante che soddisfa una lettura. Il numero c'è (189,73 contro 286,30 = 0,66×)
ma **non è valido come misura di prodotto**: le otto celle sono state prese in sequenza su un board che si scaldava, e
la prova sta nel raw — rieseguendo la stessa identica configurazione stock dopo ~20 minuti di carico il board ha dato
`pp512 = 165,74 ± 53,58` contro i 286,30 ± 0,61 di venti minuti prima. Con quella deviazione standard, ogni confronto
fra varianti prese in momenti diversi porta una deriva termica non quantificata. Resta valido: le coppie
`stock`/`strict` prese adiacenti concordano entro l'1 %, e `acc` è più lento di `mul` pur essendo stato misurato prima.
La soglia pre-registrata (sotto 0,50× l'opzione "sempre acceso" è morta) **non si applica** a un numero che non è una
misura. La misura vera richiede cooldown fra le celle e ordine randomizzato: è lavoro della prossima sessione.
Le KLD non sono toccate da questo problema: sono aritmetica deterministica, e le coppie `stock`/`strict` identiche alla
sesta cifra lo dimostrano.
