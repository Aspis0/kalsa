# PIANO OPERATIVO V1 — "Beyond Memory Capacity": MoE 35B da flash su Galaxy S23 8GB

> **Brief operativo per Grok.** Data: 2026-08-03 · Progetto: Kalsa (ricerca "banda per token")
> Orchestratore: Claude (main loop) · Esecutore codice/analisi: **Grok** · Mani sul telefono: **gualt**
> **Repo di lavoro: `Kalsa/moe-experiments/`** (repo git dedicato, totalmente staccato dall'app)
> Device primario: **Samsung Galaxy S23 128GB VERGINE dedicato** (8GB RAM, Snapdragon 8 Gen 2, **UFS 3.1**, OneUI)
> Stato: piano iniziale, sostituisce integralmente il draft precedente (che era basato su Qwen3-30B-A3B)
>
> Tutti i fatti marcati [V] sono stati **verificati online il 2026-08-03** (URL in §13). Tutte le cifre
> marcate [S] sono **stime da confermare** in F0/F2. Grok NON deve fidarsi di nulla che non sia [V]:
> la prima cosa che fa è la checklist di ri-verifica in §7-F0.

---

# ⭐ STATO CORRENTE

> 📕 **GERARCHIA DEI DOCUMENTI (regola gualt, 2026-08-16 — non invertirla).**
> **`PLAN.md` è IL documento principale e si aggiorna SEMPRE**: a ogni verdetto,
> a ogni kill, a ogni misura, a ogni correzione — nel momento in cui succede,
> non a fine giornata. È il registro autoritativo della campagna e vince su
> qualunque altro file in caso di conflitto.
> **`docs/ALIVE.md` è un DERIVATO**, la vista a una pagina di cosa è ancora in
> piedi: si aggiorna **dopo una giornata di lavoro**, riassumendo dal PLAN.
> Non ci si scrive mai niente che non sia già nel PLAN, e non si legge mai
> ALIVE al posto del PLAN per decidere.

> 🛠️ **19/08 ~10:40 — L'ORACOLO LATO CONSUMER ESISTE: COSTRUITO, COMPILATO,
> NON ANCORA ESEGUITO (S23 occupato dall'altra sessione).**
>
> Due commit su `kalsa/kernel-s3-repack` (`538341999` atterraggio, `d8b6528e8`
> chunking anti-OOM per i tensori 2880×2880×32), **puramente additivi** (607+,
> 0−), verificati su disco da me. Gated da `GGML_OPENCL_ORACLE=1`, inerte
> altrimenti. Disegno: **4 kernel = (idioma gemv|gemm) × (lettura buffer|image)**,
> dump di float dequantizzati E word grezzi, confronto host **nello stesso run**
> contro `dequantize_row_q4_0`; verbatim-ness per **concatenazione dei sorgenti
> reali** (program = `gemv_src`/`gemm_src` + wrapper, niente ricopiature), stesse
> `CL_moe_compile_opts` dei consumer veri (onora `GGML_OPENCL_MOE_OPTS`). Il
> doppio read-path + dump raw serve a distinguere un difetto di **coerenza
> immagine/buffer** (il paradosso bitselect) da un difetto del **dequant
> compilato**.
> Build nuova `build-android-opencl-s3oracle/` (s3printf/s3base intatte);
> `libggml-opencl.so` sha `8da5316f9cdcdab5…3826048b`, 7 587 272 B,
> mtime 19/08 10:37. Invocazione pronta (REPORT dell'agente,
> `scratchpad/agents/oracle-consumer/REPORT.md`):
> `GGML_OPENCL_HOST_REPACK=1 GGML_OPENCL_ORACLE=1 ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'`
> ⚠️ **Limite epistemico dichiarato dall'implementatore e da tenere a mente:
> il program oracolo è un COMPILATO DIVERSO dal program consumer** (stesso testo
> dell'helper + stesse opzioni, ma kernel extra in coda): un oracolo ROSSO trova
> il difetto nell'idioma; un oracolo VERDE **non** proscioglie l'ISA del
> GEMM/GEMV reale. ⚠️ Non eseguito da nessuna parte (niente smoke PC OpenCL);
> q4_1/mxfp4 non aggiunti.
>
> 🔎 **AUDIT OSTILE CONSEGNATO (Reviewer Math/DeepSeek, report in
> `scratchpad/agents/oracle-consumer-review/REPORT.md`): 2 HIGH CONFIRMED,
> 4 MEDIUM, fix rimandati all'implementatore.**
> - **F1 (HIGH):** la produzione può selezionare il **GEMM binario offline**
>   `kernel_gemm_moe_q4_0_f32_ns_bin` (blob `_ila`, via
>   `libadreno-opencl-kernels.so`) che l'oracolo **non esercita mai**: un
>   oracolo verde proscioglierebbe il componente sbagliato. Il GEMV non ha
>   variante bin e trasferisce per intero. Mitigazione: log
>   `gemm_bin_loaded=0|1` + sezione esplicita nel report; NON si tenta di
>   oracolare il blob.
> - **F2 (HIGH, aritmetica confermata):** tolleranza 0.25·|d| ~64× più larga
>   del necessario (fp16-rounding ⇒ ≤0.0039·|d|): un errore di scala ≤3%
>   passerebbe TUTTI i check (`all_ok=1` con dequant corrotto). Fix: banda
>   giustificata + dump dei byte di `d` come canale indipendente.
> - MEDIUM: `ORACLE=0/false` ABILITA (check di presenza); `CL_CHECK` su
>   `clCreateImage` cambia il normal-path anche a oracolo spento; nessuna
>   detection di HOST_REPACK attivo (rosso misattribuibile al consumer);
>   skip silenzioso dei tensori fuori euristica di nome.
> - ✅ **SOUND con evidenza:** verbatim-ness (il `.cl.h` embedded nel `.so` è
>   byte-identico all'HEAD), aritmetica di indirizzamento e chunking, sync
>   (coda in-order + blocking read), sentinel, release delle risorse, sha.
>   L'onestà del report dell'implementatore è reale, con la sola omissione
>   bin-kernel (F1).
> 🔧 **FIX APPLICATI (commit `a97f7bd0c`, verificati su disco da me):** banda
> → `0.00390625·|d|` (2⁻⁸ = 0.5 ulp fp16 per |y|≤8|d|, derivazione a
> commento) + dump della half `d` letta dal kernel (`raw_d_mismatch`);
> `CL_CHECK` su `clCreateImage` solo a oracolo acceso (normal-path
> ripristinato); `ORACLE=0/""/false` spengono (⚠️ HOST_REPACK e DUMP_Q
> restano presence-only, stesso trap, notato e NON toccato); `hostrepack=0|1`
> su ogni riga + WARNING se 0; `ORACLE_PATHINFO{gemm_bin_loaded=0|1}`;
> `skipped=name_gate` una volta per nome. Nuovo `libggml-opencl.so`
> sha `3f3df26af2375d3b…07530bac`, 7 685 072 B, mtime 19/08 11:13.
> ✅ **RE-REVIEW CHIUSA (stesso auditor, appendice nel report): F2/F3/F5/F6/
> F7/F8 FIXED, F1/F4 PARTIAL per ragioni note e accettate. Nessun difetto
> nuovo critico (17/17 e 9/9 format string riverificate). L'ORACOLO È
> DICHIARATO PRONTO AL DEVICE.** Residui, tutti bounded:
> - **F1:** il blob `_ila` resta strutturalmente non-oracolabile; disclosure
>   rumorosa OK. **Protocollo del run: verificare `gemm_bin_loaded=0`
>   nell'output; se =1 il verdetto GEMM non vale** (niente lo forza sul
>   device).
> - **F2 edge:** con `|d| ≲ 2⁻²⁰` (subnormali fp16 + FTZ da fast-math) il
>   GEMM-path può dare falsi positivi mal classificati. **Irraggiungibile
>   coi dati random di test-backend-ops (scale ~0.06-0.12)**; da ricordare
>   SOLO se un giorno si oracolano pesi reali sparsi.
> - **F4:** `"0 "` (spazio/newline in coda), `"off"`, `"no"` ancora ARMANO
>   la sonda — igiene operatore: settare esattamente `1` per accendere,
>   unset per spegnere.
> ➡️ **Prossimo passo: eseguire sull'S23 appena libero** —
> `GGML_OPENCL_HOST_REPACK=1 GGML_OPENCL_ORACLE=1 ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'`
> (push list nel REPORT dell'agente, senza il blob; sha on-device prima del
> run; esiti attesi: rosso = difetto trovato nell'idioma → passo 2
> dell'ordine; verde = idioma pulito nel program oracolo → passo 3, GEMV
> n=1 isolato.)
>
> 🟥 **PRIMA SESSIONE DEVICE (19/08, S23 libero): L'ORACOLO NON È MAI
> PARTITO — COMPILE FAIL, né verde né rosso.** Il wrapper GEMV usava `local`
> come nome di parametro: **parola riservata OpenCL C**, il compilatore
> Qualcomm E031.41.03.62 rifiuta (`err=-11`, "parameter name omitted") e
> `build_program_from_source` fa `exit(1)` prima di qualunque riga ORACLE.
> Igiene della sessione comunque perfetta: sha on-device tutti verificati
> (incluso `3f3df26a…`), env esatte, cpuset `/`, blob non pushato, due run
> byte-identiche, cleanup fatto, log conservati in
> `results/oracle_consumer_s23/run{1,2}/`.
> 📌 **Lezione a verbale: NESSUN compilatore aveva mai visto i wrapper**
> (niente smoke PC OpenCL), e né l'implementatore né l'auditor hanno
> fiutato la keyword — l'auditor citava perfino gli store "`local`-indexed"
> senza vederla. Un difetto da compilatore lo becca solo un compilatore:
> lo smoke di compilazione va nel giro PRIMA del device, quando esiste una
> piattaforma. Fix (rename + sweep di TUTTE le parole riservate nei
> wrapper) e seconda sessione device in corso (run3/run4).
>
> 🟢 **SECONDA SESSIONE DEVICE (19/08 ~12:30) — ORACOLO VERDE SU TUTTI E
> QUATTRO I PATH, CON L'END-TO-END CHE FALLISCE NELLO STESSO RUN.
> IL DEQUANT COMPILATO DA SORGENTE È PULITO SU INPUT NOTO-BUONO.**
> Fix abilitante: `local`→`n_loc` solo nei wrapper (unico identificatore
> riservato trovato dallo sweep), commit `95046b85c`; nuovo `.so`
> `085b127f…a29be4`, sha on-device identica. PC smoke: wrapper GEMV
> **CL_SUCCESS su Intel** (il gate che mancava); il program GEMM non è
> compilabile su PC (`float32` qcom nel consumer) — per il GEMM il device
> resta l'unico compile gate. Verificato da me sui log pullati
> (`results/oracle_consumer_s23/run{3,4}/`).
> - `ORACLE_SUMMARY{tensors=74, lines_bad=0/296, float_mismatch_total=0,
>   raw_mismatch_total=0, raw_d_mismatch_total=0, hostrepack=1,
>   gemm_bin_loaded=0, all_ok=1}` — run3 e run4 concordi; zero WARNING,
>   zero skip; incluso il tensore 2880×2880×32.
> - **Nello stesso run: 74/74 MUL_MAT_ID q4_0 FAIL, ERR medio 0.456/0.450**
>   (cluster host-repack ~0.45 confermato).
> ➡️ **Cosa significa:** gli idiomi dequant dei consumer (macro GEMM e
> helper GEMV), compilati da sorgente con le stesse opzioni, letti sia da
> buffer sia da image, producono float corretti da un buffer perfetto.
> **Il difetto vincolante sta OLTRE l'idioma dequant:** riduzioni
> subgroup, geometria/argomenti di dispatch, gestione degli `ids`
> (routing), path di scrittura di `dst` — oppure un miscompile specifico
> del program consumer reale (caveat epistemico a verbale: il program
> oracolo è un compilato diverso).
> 📉 **Effetto collaterale sul paradosso bitselect:** il read-path image
> dell'oracolo ha letto byte GIUSTI (`raw_mismatch=0` via image sullo
> stesso `cl_mem`): l'ipotesi "coerenza immagine/buffer" ne esce
> indebolita (nelle condizioni dell'oracolo, non identiche a quelle del
> consumer in-flight).
> ➡️ **SI PASSA AL PUNTO 3 DELL'ORDINE: isolare GEMV n=1 con host-repack.**
> Strumento scelto: **audit in-situ del kernel di produzione** — niente
> kernel nuovi (zero rischio compile): a valle del dispatch reale
> (n=1, q4_0, HOST_REPACK), readback di dst/A/ids, riferimento host in
> doppia precisione, e classificazione del PATTERN d'errore per-elemento
> (per riga, per subgroup, per esperto; got/want ≈ costante = bug di
> riduzione/scala; pattern a blocchi = lane; random = memoria). È la
> mappa d'errore fine che non abbiamo mai avuto.
>
> 🛠️ **STEP-3 IMPLEMENTATO (19/08 ~12:40, commit `2bdef5c7d`, verificato su
> disco da me): `GGML_OPENCL_GEMV_AUDIT`**, 564+/5− solo in
> `ggml-opencl.cpp`, zero `.cl` nuovi. Dispatch di produzione intatto;
> con l'env accesa: `clFinish` + readback dst/src1/ids, reference
> `dequantize_row_q4_0` + dot in double, bound d'errore alla Higham
> (`gamma_k`, u=2⁻²⁴, fattore 8× per scala di blocco + riduzione a 4
> subgroup, stampato in `GEMV_AUDIT_BOUND{}`), classificatori di pattern
> (ratio costante / `LANE_MOD_{32,64,128}` / routing / sign-smear ≥0x80 /
> unstructured), cap sul volume di log. Nuovo `.so`
> `a8f1e2354f…ce331fe2` (7 921 880 B). **Limite di attribuzione
> dichiarato:** i valori di glue (shape/offset/geometry) sono
> logged-not-verified — il probe testa il kernel dato quel glue, non
> dimostra il glue. ⚠️ Il commit rifattorizza il parsing env dell'ORACLE
> in un helper condiviso: semantica sotto audit. 🔎 Audit ostile in corso
> (stesso auditor); il device (sessione ERR breve) parte solo dopo il suo
> verde + S23 disponibile.
>
> 🔎 **AUDIT DI `2bdef5c7d` CONSEGNATO: 1 HIGH che avrebbe mandato
> l'indagine sul ramo sbagliato, preso in tempo.**
> - **HIGH (CONFIRMED): il classificatore SIGN_SMEAR era VACUO** — test
>   row-level "almeno un byte ≥0x80" che con nibble random scatta con
>   P≈1−2⁻¹²⁸: OGNI caso fallente sarebbe stato etichettato SIGN_SMEAR a
>   prescindere dalla causa. Fix: test per-elemento con enrichment contro
>   il base rate (~50%).
> - MEDIUM: i casi del filtro sono **14, non 12** (due grid-case n=1 in
>   più, ~113+66 MB di stash — informativi, si tengono); stash AoS senza
>   cap né rilevanza (150 MB stashati per tensori GEMM-only mai usati;
>   nessun OOM sul run prescritto, cap aggiunto comunque); semantica env
>   ereditata ("tutto ciò che non è 0/false/vuoto arma") — accettata per
>   coerenza con ORACLE, documentata.
> - LOW: LANE_MOD co-firing (64 fa scattare anche 32 → si riporta il
>   divisore più grande che spiega); REDUCTION_OR_SCALE a mediana cieca
>   sulle mappe miste (60% ok + 40% quartered ⇒ med=1.0) → cluster di
>   ratio con frazioni.
> - ✅ SOUND: glue same-variable (passa esattamente i locals del dispatch),
>   ids+guardie OOB, bound Higham corretto (~1000× sopra il drift f32
>   legittimo e ~1000× sotto l'errore classe-0.45), readback bloccanti con
>   skip puliti, inerzia a env spenta, refactor ORACLE bit-identico.
> 🔧 Fix in lavorazione; re-review del diff dei classificatori prima del
> device.
>
> 🟥 **RE-REVIEW DI `6c822d826`: NO-GO — il fix dei classificatori ha
> introdotto una regressione peggiore del difetto che curava.**
> - **LANE_MOD REGRESSED:** col "divisore più grande prima", QUALUNQUE
>   pattern periodico (32/64/128) passa il test mod-128 (i suoi residui
>   fully-bad a 128 danno comunque rmax=1.0/rmin=0) → tutto etichettato
>   `LANE_MOD_128`, periodo perso. Fix giusto: inferire il periodo dal
>   CONTEGGIO dei residui fully-bad al modulo più grande
>   (periodo = m/n_residui: 4→32, 2→64, 1→128).
> - **SIGN_SMEAR onesto-ma-cieco, confermato col calcolo:** attraverso un
>   dot di lunghezza k su dati iid l'appartenenza alle righe bad è una
>   selezione ~50% casuale ⇒ `rate_ge80 ≈ rate_lt80` e la soglia
>   0.80/0.20 sta a ~10σ: **l'etichetta non può scattare sul veicolo a
>   dati random nemmeno per un sign-smear vero.** Il gate resta (giusto
>   non indebolirlo); la cecità va dichiarata NEL log del run e nel
>   report: "assenza di SIGN_SMEAR su dati random non esclude nulla".
> - ✅ FIXED e SOUND: ratio clustering sui soli bad (il caso misto ora è
>   etichettato), stash cap (il run da 14 casi sta in ~186 MB < 512),
>   layer di osservazione (numeri grezzi, dump, entrambe le rate)
>   affidabile e degno di raccolta; 44/44 format string.
> 🔧 Fix (~20 righe: periodo dai residui + nota di reachability) in
> lavorazione; poi re-check finale e device.
>
> ✅ **FINAL CHECK DI `d77e82347`: GO CONDIZIONATO — SESSIONE DEVICE
> AUTORIZZATA E LANCIATA (19/08 pomeriggio).** Periodo inferito dai residui
> fully-bad: tracciati nel codice i 3 casi nominali + i 2 avversari (3
> residui non-divisore → bloccato; residui parziali → bloccato, cade su
> BLOCK_RUNS; m<512 conservativo; all-bad bloccato). `GEMV_AUDIT_NOTE`
> emessa una volta per processo nello stesso blocco del BOUND. Nessun
> collaterale nelle righe cancellate.
> ⚠️ **Residuo nuovo (accettato per la sessione 1, da fixare prima di una
> eventuale sessione 2): l'inferenza conta i residui ma ne ignora la
> SPAZIATURA** — una banda contigua di 32 righe darebbe `LANE_MOD_4`
> (co-fire con BLOCK_RUNS, scontabile), e l'unione di due classi mod-64
> sfalsate darebbe `LANE_MOD_32` senza tag contraddittorio. Fix noto:
> check di equidistribuzione (~10 righe).
> 📖 **Regole di lettura vincolanti per il referto:** `LANE_MOD_N` =
> "reticolo single-coset a periodo N", niente di più; con `BLOCK_RUNS`
> co-fired non fidarsi del modulo; assenza di `SIGN_SMEAR` sul veicolo
> random NON esclude nulla; il canale decisionale è `REDUCTION_OR_SCALE`
> (ratio_clusters) + i dump grezzi — i tag sono indizi, i numeri sono
> evidenza.
> 📱 Sessione lanciata con precondizione anti-contesa (S23 raggiungibile E
> idle: ps su test-backend-ops/bmoe/llama, altrimenti stop), sha on-device
> `acb41c32…`, run5/run6, 14 casi n=1 q4_0, HOST_REPACK=1 GEMV_AUDIT=1.
> 🛑 **SESSIONE ABORTITA SU PAROLA DELL'OWNER (S23 rioccupato dall'altra
> sessione)** — la parola dell'owner vince sul check `ps` dell'agente. Lo
> strumento resta pronto (sha `acb41c32…`, comando documentato): il run5/6
> parte alla prossima finestra S23.
> 📦 **MA run5 e run6 erano GIÀ COMPLETI prima dell'abort, log già sul PC**
> (`results/oracle_consumer_s23/run{5,6}/`). Sessione ERR: la contesa col
> workload dell'altra sessione non tocca la correttezza. Letti e verificati
> da me riga per riga.
>
> 🎯 **VERDETTO STEP-3 (19/08): IL KERNEL GEMV DI PRODUZIONE CALCOLA
> GIUSTO, DATI I SUOI ARGOMENTI. IL DIFETTO VINCOLANTE È NELLA GLUE HOST
> DEL PATH MoE (ids / colonna attivazioni / layout dst), NON NEI KERNEL.**
>
> Il fatto, per ognuno dei 12 casi n=1 q4_0, in ENTRAMBI i run:
> - `GEMV_AUDIT`: **n_bad=0**, max_abs ≤2.3e-6, ratio_med=1,
>   pattern=ok — il dst prodotto dal kernel coincide col riferimento
>   host in double calcolato da (ids letti dalla GPU, src1 letto dalla
>   GPU, pesi AoS stashati, offset/geometrie del dispatch reale).
> - Lo STESSO dispatch fallisce il check semantico del test:
>   **0/12, ERR 0.36-0.70** (media ~0.48, cluster storico).
> - Gate tutti verdi: `hostrepack=1`, NOTE e BOUND presenti, zero skip,
>   zero OOB negli ids.
> ➡️ **Deduzione stringente:** kernel e audit concordano; entrambi
> dissentono dal riferimento del test. Le uniche componenti CONDIVISE fra
> kernel e audit sono i valori di glue (ids in GPU, ne11/offset/geometrie)
> — il famoso `glue=logged_not_verified`, che da caveat diventa
> l'INDIZIATO. Il difetto sta in ciò che la glue carica/interpreta:
> contenuto o mapping degli `ids`, selezione della colonna di attivazione
> (i casi b=1 girano con ne11=1, i b=0 con ne11=n_used — entrambi
> falliscono), o layout/offset di `dst` — non nell'aritmetica compilata.
> 💡 **E spiega OGNI paradosso storico in un colpo:** perché nove
> riscritture del convert e ogni variante dei consumer non hanno mai
> portato l'ERR sotto soglia (il kernel non era il vincolo); perché un
> buffer byte-exact può andare PEGGIO di uno corrotto (con routing/layout
> sbagliati l'ERR è ~casuale nel cluster 0.4-0.7, non monotono nella
> correttezza del buffer — il paradosso bitselect); perché il denso è
> perfetto (glue diversa); e — DA VERIFICARE SUL CODICE — perché q8_0 e
> q6_K passano: ipotesi che prendano un path di dispatch MUL_MAT_ID
> diverso da quello SoA/Adreno dei quant stretti.
> ⚠️ Caveat onesto: resta possibile in linea di principio che gli ids in
> GPU siano GIUSTI e l'errore sia solo nel layout di dst, o viceversa —
> il prossimo strumento distingue esattamente questo.
> ➡️ **PROSSIMO STRUMENTO (glue-audit, solo host, niente kernel):**
> (a) stash degli `ids` a set_tensor (come i pesi AoS); (b) riferimento
> SEMANTICO calcolato dai tensori stashati secondo la semantica ggml di
> MUL_MAT_ID; (c) triplo confronto nello stesso run — dst vs ref-semantico
> (deve fallire come l'e2e), dst vs ref-da-argomenti (già ok), ids
> GPU vs ids stashati — e per il primo elemento divergente la MAPPA:
> esperto semantico vs usato, colonna semantica vs usata, offset dst
> semantico vs usato. Quella mappa È il bug, nome e cognome.
>
> 🛠️ **GLUE-AUDIT IMPLEMENTATO (19/08 ~13:41, commit `b0684a2b6`,
> verificato su disco):** stash I32 ids + F32 src1, reference semantica
> specchiata dallo stock `ggml_compute_forward_mul_mat_id` (ggml-cpu.c
> 1924-1933 / 1685-1703, citato), triple compare, righe `GLUE_AUDIT` /
> `GLUE_AUDIT_DIV` / `GLUE_AUDIT_IDS`. Nuovo `.so` `2ab3624c…6fcf62`.
> Review ostile in corso; device alla prossima finestra S23.
>
> 🧩 **RISPOSTA SUL PATH (sola lettura, da confermare in review) — E
> RIMODELLA L'IPOTESI:** q8_0 prende `kernel_mul_mv_id_q8_0_f32_flat`
> (stride-based, NON il gemv MoE) → il suo 75/75 non scagiona la glue
> MoE. **MA q6_K prende lo STESSO path packed-ids `gemv_moe` di q4_0**
> (con `use_adreno_moe_kernels`) e passa 3/3. ➡️ Se confermato, la parte
> CONDIVISA della glue (packing degli ids, layout dst) è probabilmente
> sana; **l'indiziato si restringe ai valori di glue SPECIFICI del
> quant** — stride/offset per-esperto nel buffer SoA q4_0, offset delle
> image. ⚠️ Tensione da sciogliere in review: se l'offset pesi fosse
> sbagliato, il reference args-consistent (verde 12/12) avrebbe dovuto
> vederlo — dipende da COME l'audit pesca i pesi (per expert-id o per
> byte-offset della glue); la review deve dire quali indiziati il verde
> ha GIÀ scagionato.
>
> ⚖️ **19/08 ~14:00 — REVIEW `b0684a2b6` (GO condizionato) + ATTACCO
> ESTERNO DI QWEN 3.8 MAX SULLA DEDUZIONE: la sintesi stringe il campo.**
> - ✅ Reference semantica FEDELE allo stock (righe ggml-cpu.c confermate);
>   ids/src1 stash sound; path claims CONFERMATI a file:line (q8_0 →
>   `mul_mv_id_q8_0_f32_flat` stride-based :21813-21875; q6_K → STESSO
>   `gemv_moe` packed-ids :22261).
> - 🧾 **Lista degli scagionati dal verde args-consistent** (reviewer, con
>   evidenza): byte SoA, **indirizzamento per-esperto dei pesi** (un bug
>   di offset quant-specifico sarebbe andato ROSSO: l'audit pesca per
>   expert-id dallo stash), idioma dequant, VALORI di ids/src1 come letti,
>   posizioni di scrittura dst, atomi di offset. ➡️ **L'ipotesi "valore di
>   glue quant-specifico" è CONTRADDETTA.** Il residuo è una mappatura
>   common-mode (dominio del ramo semantico) o fuori dal dispatch.
> - 🗡️ **Attacco Qwen (le ipotesi che sopravvivono a TUTTE le misure):**
>   (1) ids mai confrontati con l'INTENTO → coperto da `GLUE_AUDIT_IDS`;
>   (2) **CLOBBER/READBACK di dst fra lo snapshot dell'audit e la lettura
>   del test via get_tensor** → NON coperto → **aggiunto ora** (hook
>   `DST_READBACK{match}` + `OVERLAP_MAP`, in implementazione);
>   (3) copertura solo GEMV n=1 (i GEMM del set da 74 restano inauditi —
>   per dopo).
> - 📐 **Correzioni di ragionamento accettate:** in ERR una permutazione ≈
>   garbage (indistinguibili su dati random); **ERR 0.36-0.70 sta SOTTO il
>   tetto del completamente-sbagliato (~1-2) ⇒ corruzione PARZIALE** (una
>   frazione di righe giuste) — vincola il modello del bug: il misrouting
>   uniforme predice il tetto, non 0.5.
> - 📚 Prior art (Qwen, con fonti): la lib di kernel binari Adreno copre
>   MUL_MAT_ID **esattamente per Q4_0/Q4_1/Q4_K/MXFP4** (OPENCL.md
>   upstream) — esclusa nei NOSTRI run (`gemm_bin_loaded=0`, blob non
>   pushato), ma in produzione è nel path: da tenere per il capitolo fix.
>   Classi di bug storiche: ids i32 letti male/stride/view-offset; pattern
>   CUDA sort-by-expert + scatter (scatter dimenticato = dst permutato).
> - 🎯 **Matrice della prossima sessione S23 (tre risposte ortogonali da
>   UN run):** ramo IDS (GPU vs intento) · ramo SEMANTICO (mappatura
>   slot→colonna→dst) · ramo READBACK (clobber). Condizioni del GO:
>   grep `skipped=` prima di credere al ramo semantico; un triplo verde =
>   negativo forte per il backend ⇒ pivot su geometria harness/reference,
>   NON ri-caccia al kernel.
>
> 🟢🟢🟢 **19/08 ~14:30 — SESSIONE LAMPO (finestra corta concessa
> dall'owner): TRIPLO VERDE SU TUTTI E 12 I CASI, IN ENTRAMBI I RUN.
> IL DISPATCH DEL BACKEND PRODUCE L'OUTPUT SEMANTICAMENTE GIUSTO —
> E IL TEST LEGGE COMUNQUE SPAZZATURA.**
> (`results/oracle_consumer_s23/run{7,8}/`, binario revisionato
> `2ab3624c…` sha-verificato on-device, `skipped=0`, verificato da me
> anche su run8: 12/12 righe con semantic=0, args=0, divergent=0, ids=0,
> src1=0 — e 12/12 e2e FAIL, ERR 0.41-0.66.)
> ➡️ **Scagionato l'INTERO percorso di calcolo:** kernel compilati
> (oracolo), valori e mappatura della glue (ids=intento, colonne, offset
> dst, semantica stock ggml). Il danno avviene DOPO: o (A) **un secondo
> scrittore sovrascrive dst** dopo il nostro snapshot (doppio dispatch /
> fall-through a un altro kernel — e se esiste, spiegherebbe TUTTA la
> campagna in un colpo: l'ultimo autore sarebbe un kernel le cui varianti
> narrow sono rotte e la q6_K sana; le 9 riscritture del convert non
> potevano aiutare perché il gemv auditato non era mai l'autore finale),
> o (B) **il path di readback `get_tensor` restituisce byte diversi** da
> quelli che il buffer contiene.
> 🔎 In corso, PC-only: lettura del sorgente del dispatch (ogni enqueue
> che tocca il dst cl_mem, in ordine, file:riga — il sospetto (A) è
> verificabile SENZA device); se il sorgente è pulito, hook
> `DST_READBACK{raw_match, returned_match}` + logger degli enqueue
> post-snapshot (WIP in stash@{0}, da estendere). Il device servirà solo
> per il caso (B) o per confermare (A).
>
> ☠️ **(A) È MORTA SUL SORGENTE (19/08 ~14:25, walk completo con
> file:riga):** in `ggml_cl_mul_mat_id` (:20932) l'UNICO writer di dst è
> il singolo `clEnqueueNDRangeKernel` del gemv (:21085); il path generico
> (`mul_mv_id_q4_0_f32_8x_flat`, enqueue :22711) è IRRAGGIUNGIBILE per il
> `return` a :21224; il ramo GEMM è l'`else` di `ne12==1`; il graph
> compute è single-pass e la fusion non tocca MUL_MAT_ID; il harness è
> nodo-per-nodo (`graph_view(i,i+1)`) coi sentinel computati DOPO la
> lettura di `out`. Niente doppio dispatch, niente legacy writer — il
> "fit bello" non è quello che fa il codice. (Nota a margine: a gate
> Adreno OFF il `case` q6_K non ha `break` e cade in MXFP4 :22429 — bug
> REALE ma di un altro path, registrato.)
> 🧨 **19/08 ~15:00 — INTEL CROSS-TREE DALL'ALTRO CLAUDE (llama.rn 0.12.8,
> app kalsa) + VERIFICA SUL NOSTRO ALBERO: UPSTREAM CONOSCE LA NOSTRA
> CLASSE DI DIFETTO E L'HA SPENTA COL GATE INVECE DI FIXARLA.**
> - Nel loro albero vendorizzato, `use_adreno_moe_kernels` **esclude
>   A6X/A7X** (730/740/750 sono tutti A7X: passa solo A8X) e il commento
>   upstream dichiara il perché: *miscompile del compilatore* — i kernel
>   `*_trans4_ns` fanno aliasing di una `ushort8` privata via `uchar*` e
>   su alcuni A6x/A7x *corrompono i pesi*. "For now."
> - **Nel NOSTRO albero il gate è SOLO nome+shape** (:6960-6964,
>   `backend_ctx` GGML_UNUSED, niente esclusione di generazione): per
>   questo sul 740 i kernel MoE Adreno GIRANO — ed è per questo che
>   misuriamo la corruzione che upstream ha solo spento. Il convert che
>   chiamiamo è letteralmente `convert_block_q4_0_trans4_ns` (:8366):
>   **il commento upstream è l'ammissione della nostra classe di difetto
>   (A)**, quella che abbiamo fixato byte-wise per il −55%.
> - Conseguenze coordinate con l'app: (1) **NON rimuovere l'esclusione
>   A7X nel loro albero oggi** — sbloccherebbe sul 740/750 esattamente i
>   kernel che misuriamo corrotti: si scambierebbe "CPU corretta" con
>   "GPU spazzatura"; (2) lo sblocco della famiglia K su A7X (Q4_K_M
>   compreso) è il PREMIO della nostra campagna: passa per la chiusura
>   del difetto residuo, non per la rimozione del gate; (3) **mxfp4 MoE
>   "gira oggi su S23"** è vero solo nel LORO albero (ramo generale
>   flat) e resta da verificare in correttezza — nel NOSTRO albero mxfp4
>   prende il path Adreno e fallisce 0/74; l'unico quant MoE
>   general-branch MISURATO verde sul 740 è **q8_0 (75/75)**;
>   (4) "supportato ≠ veloce" ha già un numero: decode MoE su GPU
>   0.41-0.44× CPU (~60 ms/token di glue, graveyard) — la leva GPU è il
>   PREFILL; e per i modelli streammati (>RAM) gli esperti restano su
>   CPU per architettura (Q7), quindi il MUL_MAT_ID GPU serve ai modelli
>   con esperti residenti e ai disegni di prefill.
>
> 🏛️ **19/08 ~15:20 — SESSIONE READBACK (run9/run10): BRANCH C, 12/12.
> IL BACKEND GPU È TOTALMENTE ASSOLTO. L'INDIZIATO PRINCIPALE ORA È IL
> RIFERIMENTO CPU DEL TEST — CIOÈ IL GIUDICE, NON L'IMPUTATO.**
> (`results/oracle_consumer_s23/run{9,10}/`, sha on-device `25044c5a…`
> = commit `bcdbc9ed6`; 12/12 `raw_match=1, returned_match=1` con
> checksum snap==raw==returned identici, `get_off==snap_off`, zero
> `POST_ENQUEUE`, zero overlap; run9 e run10 concordi; e2e sempre 0/12.)
> ➡️ Catena di assoluzioni completa: aritmetica compilata (oracolo) →
> valori e semantica della glue (glue-audit, riferimento = stock ggml) →
> integrità memoria + readback (`DST_READBACK`). **Il harness riceve
> byte semanticamente corretti e dichiara ERR 0.4-0.7 ⇒ out2 (il
> riferimento CPU) è il principale sospettato.**
> 🧩 **E i pezzi combacerebbero tutti:** questo albero porta gli
> esperimenti CPU S3/REPACK/i8mm (`8d3c2ea75` è su QUESTO branch, sotto
> i commit oracle); `ggml-cpu.c` NON è upstream puro (verificato); i
> path CPU sono quant-specifici ⇒ compatibile col pattern q4_0/q4_1/
> q4_K/mxfp4 rotti e q8_0/q6_K sani; e il paradosso bitselect si
> rileggerebbe — se il riferimento è corrotto in modo affine al vecchio
> convert, un buffer corrotto uguale produce output più VICINO al
> giudice sbagliato: "due difetti che si compensano", col secondo nel
> GIUDICE. ⚠️ IPOTESI, non verdetto: da provare col forensic diff del
> lato CPU (in corso, gratis su PC — attenzione: il harness device gira
> su ARM, un check x86 non scagiona i path NEON/i8mm/repack) e con la
> sessione f1/f2 (dump di entrambi i buffer del confronto, attesa:
> f1(OpenCL)==semantico, f2(CPU)≠semantico).
> 📌 Nota di metodo per il verbale: se l'ipotesi regge, OGNI numero ERR
> di questa campagna era una distanza da un bersaglio sbagliato — il
> −55% incluso — e la narrativa dei "due difetti" va riscritta con
> l'imputato e il giudice scambiati. Non si riscrive niente finché il
> forensic non parla.
>
> 🗡️ **SECONDO ROUND QWEN (19/08 ~15:40) — la prova logica regge "modulo
> fedeltà dello specchio", e la banda d'errore ora è PREDETTA, non solo
> tollerata.**
> - **Logica confermata:** dst==specchio(sorgente) ∧ dst≠out2 ⇒ il
>   runtime CPU diverge dalla semantica del SUO stesso sorgente (path
>   ottimizzati vec_dot/repack o codegen) — *purché lo specchio sia
>   trascrizione fedele*. Residui vivi: fedeltà specchio (kill:
>   judge-swap), loop naïf esso stesso campaign-modified (il forensic
>   deve classificare ANCHE quello), mutazione input T0→T1 (kill:
>   checksum), bug di codegen i8mm/NEON (invisibile al diff — serve A/B
>   del path).
> - ☠️ **A3 (convenzione righe di coda): morta sui dati esistenti** —
>   i casi n_used=1 non hanno code e falliscono a 0.36-0.66.
> - 💪 **Vincolo del denso, rafforzato:** q4_0 denso 46/46 INCLUSE le
>   forme GEMV n=1, stesso vec_dot via mul_mat ⇒ se il giudice è rotto,
>   è rotto nel codice SPECIFICO di mul_mat_id (gather per-esperto /
>   applicazione repack / chunking — esattamente le regioni
>   campaign-modified 1685-1703/1924-1933).
> - 📐 **Banda 0.36-0.70 PREDETTA dall'ipotesi giudice-repack:**
>   permutazione di partner dentro blocchi che condividono una scala
>   (magnitudini plausibili, NMSE intermedio) oppure miscela
>   condizionata dall'allineamento (~15-50% righe colpite). Il
>   misrouting grossolano predice il tetto ~1-2: le ipotesi kernel morte
>   restano morte anche per la banda.
> - 🎯 **Discriminatori (ranking Qwen, adottato):** (1) mappa per-riga
>   f2-vs-specchio [dentro la sessione f1/f2]; (2) **JUDGE-SWAP — build
>   con `ggml/src/ggml-cpu` riportato al merge-base upstream, stesso
>   OpenCL nostro: se 12/12 PASS, caso chiuso e specchio validato
>   insieme** [build in preparazione]; (3) checksum invarianza input;
>   (4) round-trip repack host-only; (5) niente switch runtime standard
>   per spegnere repack/i8mm — l'A/B è una rebuild con le flag off.
> - 🧪 Predizione testabile registrata: i residui (GPU-esatto − out2) e
>   (GPU-corrotto − out2) dovrebbero essere CORRELATI se i due difetti
>   si compensano via lo stesso layout.
>
> ⚡ **19/08 ~16:00 — JUDGE-SWAP ESEGUITO: 0/12 FAIL ANCHE COL GIUDICE
> PRISTINE. L'IPOTESI "GIUDICE CPU CORROTTO DALLA CAMPAGNA" È
> CONFUTATA.** (runJS1, ERR 0.31-0.61 — STESSA banda del giudice di
> campagna: i due giudici CONCORDANO fra loro; runJS_ctrl sotto giudice
> pristine: q8_0 74 OK, q6_K OK, denso q4_0 45 OK / 0 FAIL.)
> 🔥 **Il confronto che brucia ogni teoria di mapping:** q6_K
> `(n_mats=4, n_used=2, b=0, m=512, n=1, k=256)` **OK** contro q4_0
> **stessa identica forma** **FAIL** — glue condivisa, giudici
> condivisi, shape identica: **il discriminante è il QUANT e solo il
> quant.**
> ✅ Verificato da me ora: `ggml-quants.c/.h` INTOCCATI dal merge-base
> upstream (`22b69b6e9`) — `dequantize_row_q4_0` dello specchio è stock.
> 🧷 E il denso q4_0 46/46 prova che i giudici ≈ dequant stock SUGLI
> STESSI byte q4_0 (via mul_mat). Quindi lo stato logico è: specchio
> (dequant stock, byte stashati) == GPU ≠ giudici (valutazione q4_0
> corretta di byte "visti da loro") ⇒ **le ipotesi rimaste in piedi si
> contano su due dita:** (1) **i BYTE visti dai giudici ≠ i byte
> stashati** — divergenza degli input fra le due valutazioni backend
> (variante dell'A4 di Qwen: mutazione/rigenerazione fra eval GPU ed
> eval CPU, o gestione delle VIEW), quant-specifica per come il test
> costruisce i tensori; (2) il loop naïf di QUESTO albero è
> campaign-modified e lo specchio è fedele-al-sorgente-sbagliato
> (forensic in corso — ma deve spiegare perché q6_K passa con la stessa
> semantica). 📌 La banda 0.31-0.70 è compatibile con "esperti in
> parziale overlap": con ids diversi fra le due eval, la frazione di
> righe coincidenti produce esattamente NMSE sub-tetto.
> ➡️ **La Sessione B decide: f1/f2 per-riga contro lo specchio +
> checksum INPUT_INVARIANT (T0 vs T1).** Se gli input visti dal giudice
> differissero da quelli stashati, il "difetto" starebbe nel PROTOCOLLO
> del test, non in nessun kernel di nessuno.
>
> 🚪 **19/08 ~16:20 — LA PORTA, TROVATA A LIVELLO DI SORGENTE (verificata
> da me su ggml-backend.cpp:2156-2209 e graph_copy_init_tensor:2041-2055):
> IL GIUDICE RICEVE I PESI ATTRAVERSO IL `get_tensor` DELLA GPU.**
> `compare_graph_backend` costruisce il grafo del backend2 con
> `graph_copy` → `ggml_backend_tensor_copy(src, dst)` dove src sta sul
> backend1 (OpenCL): **i pesi q4_0 MoE del giudice sono il ROUND-TRIP
> write(SoA)→read(reverse) dello storage GPU.** Ipotesi ora in verifica
> byte-level: il reverse (get_tensor) del path MoE SoA q4_0 è ROTTO
> (quello q6_K sano). Spiegherebbe TUTTO:
> - judge-swap confutato: qualunque giudice mangia la stessa copia
>   avvelenata;
> - discriminante puro-quant a parità di forma (reverse per-quant);
> - denso immune (storage/reverse diverso, 46/46);
> - **paradosso bitselect sciolto**: convert-write e get_tensor-read sono
>   inversi dello STESSO storage — bug accoppiati (scrivi storto + leggi
>   storto uguale) si annullano in round-trip → giudice sano → ERR 0.18;
>   fixata la sola scrittura → la lettura rotta avvelena il giudice →
>   0.45. **"Due difetti che si compensano" = write e read dello stesso
>   storage.** Il −55% andrà riletto in questa chiave.
> - **la produzione non è mai passata di lì**: l'inferenza reale non
>   chiama `get_tensor` sui pesi — il path è esercitato SOLO dal
>   protocollo del test.
> 🔬 In corso: (1) round-trip byte test su device (set_tensor X →
> get_tensor → memcmp, q4_0 MoE vs q6_K vs denso, con e senza
> HOST_REPACK — sotto ipotesi, il write corretto DEVE mismatchare al
> read); (2) audit PC del reverse (transpose_2d/un-repack) contro il
> contratto, file:riga. Fix solo dopo conferma + review ostile.
>
> ⚔️ **QWEN ROUND 3 (19/08 ~16:40) — LA VARIANTE IDS È MORTA PER
> ARITMETICA, E C'È UN MECCANISMO CONCORRENTE CON PRIOR ART UPSTREAM.**
> - ☠️ **H1-via-ids esclusa quantitativamente:** con n_used=1 gli id
>   valgono tutti 0 per costruzione (non POSSONO differire); e per
>   n_used>1 id indipendenti danno NMSE ≥ 1.0 (righe sbagliate
>   scorrelate) — la banda osservata 0.31-0.61 sta SOTTO il pavimento
>   del fully-wrong. ☠️ H2 (specchio infedele) morta via q6_K
>   (mapping quant-agnostico).
> - ✅ Sopravvive solo: **divergenza nei BYTE DEI PESI visti dall'eval
>   CPU**, con NMSE ≈ f·(1..2) ⇒ f ≈ 16-61% di elementi corrotti in modo
>   STRUTTURATO (pattern block-periodico atteso; ERR shape-deterministico
>   atteso).
> - 🥊 **Meccanismo di Qwen (concorrente col nostro get_tensor):** il
>   REPACK ONLINE ARM del giudice CPU (dotprod/i8mm extra bufts) corrotto
>   o mis-sized per MUL_MAT_ID: copre Q4_0/IQ4_NL/Q4_K(+mxfp4?) = set
>   fallente, NON copre Q6_K/Q8_0 = controlli sani; il denso passa
>   (sizing corretto per mul_mat, storicamente rotto per mul_mat_id:
>   PR #12544, commit #14292, classe #10165). E la stoccata: *"il
>   judge-swap non ha confutato la colpa dell'input — ha scagionato il
>   codice di campagna e incriminato ggml pristine"* (il revert al
>   merge-base riporta lo STESSO stato repack upstream). ⚠️ Caveat suo:
>   `tensor_get` su buffer repackato può ri-trasformare in lettura —
>   un confronto via readback può MASCHERARE la divergenza.
> - 🧪 **Discriminatori ordinati (in esecuzione):** (1) git: i fix
>   #12544/#14292 sono nel merge-base 2026? (attesi sì ⇒ serve una
>   regressione più recente della stessa classe); (2) audit copertura
>   tipi del repack ARM vs set fallente — q4_1/q5_0/q5_1/q5_K con ERR
>   piccoli (0.09-0.12) potrebbero essere un SECONDO strato di difetto;
>   (3) **norepack judge-swap** (giudice ricompilato senza extra-bufts
>   ARM): 12/12 PASS ⇒ meccanismo Qwen confermato; ancora FAIL ⇒ resta
>   il nostro get_tensor, che il round-trip byte test decide.
> 📌 Nota di coerenza con la campagna: il motore BMoE carica con
> `use_extra_bufts=false` e "K-E (i8mm) never runs — mmla vive solo nel
> path REPACK che gli esperti streammati bypassano" ⇒ **la produzione
> bypassa il repack che il test invece esercita** — coerente con "solo
> il tribunale era truccato", qualunque dei due meccanismi vinca.
>
> 💥 **19/08 ~17:00 — ROUND-TRIP BYTE TEST: DIRTY. IL SECONDO DIFETTO HA
> NOME, FILE E RIGA: `kernel_restore_block_q4_0_trans4_ns` (cvt.cl:352-392),
> IL REVERSE DEL get_tensor, MISCOMPILATO CON LO STESSO IDIOMA CHE IL
> CONVERT FU PATCHATO PER EVITARE.**
> (Log: `results/oracle_consumer_s23/roundtrip/`; harness dedicato,
> OpenCL invariato `25044c5a…`.)
> | caso | A (convert GPU) | B (HOST_REPACK=1) |
> |---|---|---|
> | q4_0 MoE "as" 256×512×4 | **94208/294912** | **61440/294912** |
> | q6_K MoE "as" | 0/430080 | 0/430080 |
> | q4_0 denso "weight" | 0/73728 | 0/73728 |
> Firma al 100% dei mismatch: **byte `qs` DISPARI, `got=(want&0x0F)|0xF0`**
> (nibble alta forzata a 0xF, bassa intatta; `d` e byte pari sempre
> match). Il restore legge `uint4`→`as_ushort8`→`uchar*` su registro
> privato — **esattamente l'idioma che il commento del convert
> (cvt.cl:330-333) dichiara miscompilato su Adreno**; il restore q6_K usa
> un idioma diverso (`uchar*` su ARRAY) e round-trippa pulito; il denso
> non entra nel path trans4_ns. **La predizione dell'ipotesi era "(b)
> DEVE mismatchare": confermata. Il write corretto (host-repack) torna
> indietro corrotto.** Nota numerica: B = 7680/16384 = 46.9% dei blocchi
> per offset — la stessa cifra del "46% dei word alti" storico.
> ➡️ **Il "difetto residuo dei consumer" era il RESTORE del get_tensor:
> un path che solo il protocollo del test esercita.** La catena del
> veleno è verificata a livello di sorgente: compare_graph_backend →
> graph_copy → tensor_copy(src=OpenCL) → get_tensor → restore rotto →
> giudice avvelenato (qualunque giudice: per questo il judge-swap
> "falliva").
> 🧷 Qwen round 3, esiti delle sue piste: i fix #12544/#14292 SONO
> antenati del merge-base (versione semplice della sua ipotesi: morta);
> la sua mappa di copertura repack era sbagliata su q6_K/q8_0 (SONO
> coperti eppure passano) e q4_1/q5_0/q5_1 NON sono coperti eppure
> falliscono ⇒ il meccanismo repack-CPU non spiega il pattern; quello
> get_tensor sì. ⚠️ q4_1/q5_0/q5_1/q4_K/q5_K: da verificare i loro
> restore kernel (stesso idioma?) — ERR piccoli su q5_0/q5_1 (0.09-0.11)
> possibile strato separato.
> 🔎 **AUDIT FORENSE INDIPENDENTE LANCIATO su richiesta di gualt** (agente
> fresco, zero fiducia nei report, claim-vs-artefatti su TUTTA la catena:
> roundtrip, JS build purity, circolarità degli strumenti, sha, filtri,
> env; report in `scratchpad/agents/evidence-audit/`). **Nessun fix parte
> prima del suo verdetto + review ostile del fix stesso.**
>
> ✅✅ **19/08 ~17:30 — VERDETTO FORENSE: TUTTA LA CATENA CONFERMATA
> SUGLI ARTEFATTI.** (report: `scratchpad/agents/evidence-audit/REPORT.md`)
> C1 roundtrip CONFIRMED (X = pattern deterministico host `(i*131+17)&0xFF`,
> confronto contro l'originale, TUTTA l'aritmetica riderivata: 16384×18,
> 8×11776, 8×7680, 46.9%, firma MISURATA dal classificatore non asserita);
> C2 sorgente colpevole CONFIRMED (idioma letterale a cvt.cl:352-392,
> commento a :330-333, dispatch nel get_tensor a ggml-opencl.cpp:9914,
> rotta test→giudice verificata end-to-end); C3 judge-swap CONFIRMED
> (worktree con ggml-cpu.c byte-identico al merge-base: 0 righe di diff
> contro le 937 del branch); C4-C6 CONFIRMED (stash da set_tensor host,
> dequant stock, 3 checksum da 3 letture distinte, interleaving nei
> medesimi log). **Zero numeri allucinati.**
> 🔧 Correzioni minori a verbale: la prosa "zero POST_ENQUEUE" nel blocco
> Branch C è SBAGLIATA — il contatore arriva a 11 (sono gli OVERLAP a
> essere zero; il campo per-case n_post_enq=0 vale per il case 1);
> `SHA256.txt` del roundtrip ha una riga exe incoerente (538ae4ed vs
> 306af176 su disco) — la lib OpenCL è coerente ovunque; run5-8 senza
> file sha su disco (fanno fede le righe on-device nei log).
> ⚠️ **I due buchi residui dichiarati dall'audit, che il retrial DEVE
> chiudere:** (1) l'anello finale — "il giudice riceve ESATTAMENTE i
> byte avvelenati e da lì esce ERR 0.31-0.73" — è inferito, mai
> osservato DENTRO un confronto fallente: serve la sessione f1/f2 che
> dumpa entrambi i buffer + i pesi consumati dal giudice e RIDERIVA
> l'ERR; (2) "la produzione non è toccata" è da lettura del codice, mai
> dimostrato sul motore BMoE reale. (3) Nota fresca: A≠B nei conteggi
> roundtrip (94208 vs 61440 a X costante) ⇒ lo storage del convert GPU
> byte-wise ≠ storage host-repack — coerente col fatto NOTO che il
> byte-wise viola il contratto (DUMP_Q storico), ma da spiegare
> esplicitamente nel piano fix.
> ➡️ **VIA LIBERA AL FIX** (piano in redazione dal takeover codex, poi
> review ostile, poi S23: roundtrip=0 → 12/12 → bitselect → set completo
> + f1/f2 probatorio).
>
> 🗡️ **QWEN ROUND 4 (19/08 sera) — EMENDAMENTI AL PIANO FIX, da
> incorporare nell'ordine di implementazione:**
> - **`uint4 q_block[1]` BOCCIATO**: "la peggior forma di array
>   possibile" — materiale canonico da SROA, il compilatore la promuove a
>   registro e l'IR torna la forma che miscompila. Scommesse ranked:
>   (1) **shift/mask puro senza aliasing** (`(v.sN>>8*k)&0xFF` +
>   riassemblaggio aritmetico — l'idioma dei dequant già puliti);
>   (2) clone del **`uint4[8]`** provato-sano; `[1]` solo come CANDIDATO
>   nel bake-off, mai come assunzione. Niente `as_ushort8` in nessun
>   ruolo residuo.
> - **Buchi da chiudere PRIMA del device:** (1) il PREDICATO di gating
>   (cosa instrada un tensore nel path avvelenato) va DIMOSTRATO con
>   una riga di logging, non inferito; (2) mismatch ≠ poisoning (il
>   danno è invisibile dove la nibble alta era già 0xF): la derivazione
>   dell'ERR usa il modello di poisoning, non il conteggio; (3)
>   **NMSE atteso in forma chiusa** dalla firma (metà pesi forzati a
>   7·d, strutturato) deve cadere in 0.36-0.70 — se non ci cade, c'è un
>   secondo contributore; (4) **stato intermedio predetto**: restore
>   fixato + producer byte-wise attuale TOGLIE la compensazione ⇒ l'e2e
>   può PEGGIORARE prima del bitselect — va predetto numericamente in
>   anticipo perché si legga come conferma, non regressione; (5) firma
>   per-tipo da verificare su q5_x (interplay qh), non estrapolare.
> - **f1/f2 probatorio: PRE-REGISTRATO** (calibrazione a due punti:
>   byte avvelenati→ERR predetto, byte puliti→PASS; giudice pristine
>   per evitare circolarità di harness).
> - **Prova di produzione**: enqueue shim (log dei kernel-name in una
>   sessione del motore reale: i 5 restore NON devono mai apparire con
>   `use_extra_bufts=false`) + log del buft che riceve i pesi MoE +
>   A/B dei logits patched/unpatched su prompt fisso (delta ⇒ falsifica
>   "produzione immune").
> - **Matrice riordinata**: zero-device prima (forma chiusa + predicato);
>   sweep firme per-tipo su build NON patchata; bake-off delle forme di
>   patch sul device; stato intermedio confermatorio; controlli negativi
>   di buft; q4_K/q6_K roundtrip=0 come regressione; **il −55% si
>   rimisura nella STESSA sessione del confronto fix o si cancella il
>   claim** ("finché non rimisurato" senza scadenza diventa permanente);
>   **il round-trip byte test diventa regressione permanente** per ogni
>   restore di ogni quant — questa classe di bug è sopravvissuta perché
>   nessun test esisteva a livello di byte.
>
> ✅ **REVIEW DEL PIANO FIX: GO CON 3 EMENDAMENTI (19/08 sera).** Mappa
> del blast radius CONFERMATA citazione per citazione ("load-bearing and
> it holds"); loop del fix = inverso esatto (hand-trace k=3 e k=19);
> bitselect CONFERMATO (formule = byte esatti del producer, builtin
> definito su questo vintage CL3.0/Adreno). Emendamenti: (i) **NO
> `uint4[1]`** — stessa bocciatura di Qwen, convergenza indipendente:
> forma no-alias byte-wise o ≥[2]; (ii) aggiungere alla matrice il
> probatorio out1/out2 e lo smoke BMoE (o deferral esplicito);
> (iii) "94208 atteso" declassato a "≈94208, da rimisurare" (era
> misurato col restore ROTTO). Nota: l'auditor non trova la memoria
> `adreno-moe-two-defects` nei SUOI store pi — corretta: vive nello
> store Claude dell'orchestratore, già riscritta oggi.
> 🛠️ **ORDINE DI IMPLEMENTAZIONE EMESSO** (replacement coder
> qwen3.7-max, agente `13f74d68`): fusione piano + emendamenti dei due
> reviewer — forma PRIMARIA shift/mask puro senza aliasing sui 5
> restore; bitselect producer come variante env-selezionabile
> (`GGML_OPENCL_CVT_VARIANT=bitselect`, default invariato); harness
> roundtrip esteso a tutti e 5 i tipi + controlli con firma per-tipo;
> logging del predicato di gating; sezione RETRIAL PRE-REGISTRATION
> (NMSE in forma chiusa dal modello di poisoning, stato intermedio
> predetto, f1/f2 pre-registrato a due punti su giudice pristine,
> deferral esplicito dello smoke BMoE). Poi: verifica su disco → review
> ostile del diff → S23.
>
> ✅ **19/08 ~00:00 (notte) — IL FIX È IMPLEMENTATO E COMMITTATO (PC-only,
> build verde).** Odissea provider prima del via: qwen3.7-max fermo in
> lettura (zero scritture), quota FREE di `qwen-model-studio-sg` esaurita
> (morti in blocco kimi/Talk/qwen3.7/V4 Pro), 402 grok; implementato da
> **Codex gpt-5.6-sol** (fuori lista profili — errore di processo a
> verbale, vedi memoria `profile-list-is-law`: mai più senza chiedere).
> Due commit locali su `kalsa/kernel-s3-repack`, MAI push:
> `5cc6f2bd5` (harness roundtrip ereditato dalla sessione device, commit
> separato per attribuzione) → `eaec5d884` (fix: 3 file, +260/−147).
> Contenuto verificato SU DISCO dall'orchestratore: (1) i 5 restore
> `*_trans4_ns` (cvt.cl:372/565/772/1000/1602) riscritti shift/mask puro
> — grep di `as_ushort8`/cast/array nei corpi: ZERO match; i 6 cast
> `(uchar*)` residui stanno TUTTI nei K-quant (idioma sicuro su array,
> controlli non toccati, come da ordine); (2) producer bitselect a
> build-time del programma CL (`-DGGML_OPENCL_CVT_BITSELECT`), env
> `GGML_OPENCL_CVT_VARIANT` VALUE-parsed, default bytewise invariato
> (ggml-opencl.cpp:1646); (3) log `OPENCL_WEIGHT_PATH{...}` sul path
> davvero preso (ggml-opencl.cpp:6982); (4) harness esteso 5 tipi +
> K-quant + 2 densi, firma per-tipo con qh separato per i q5
> (test-opencl-moe-roundtrip.cpp:49); (5) RETRIAL PRE-REGISTRATION nel
> REPORT oracle-consumer (~riga 1219). **Primo dividendo della forma
> chiusa: NMSE atteso 0.4505813953, DENTRO la banda osservata 0.36-0.70
> (emendamento Qwen #3 soddisfatto), e 65536 eventi di poisoning − 4096
> invisibili (nibble alta già 0xF) = 61440 = esattamente il conteggio
> misurato sul device (61440/294912).** Build: target `ggml-opencl` +
> `test-backend-ops` + `test-opencl-moe-roundtrip` verdi; syntax-check
> NDK clang CL3.0 verde in ENTRAMBE le varianti (il gate anti-`local`);
> LF-only confermato byte-level. `.so`:
> `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c`
> (da riverificare on-device via sha, mai via strings). Fuori scope
> dichiarato: `test-chat.cpp` non compila per `mtmd.h` mancante nella
> config cache-ata (pre-esistente, non nostro). stash@{0} intatto
> (INPUT_INVARIANT hook + test semantico PC, ispezionato read-only).
> 🔎 **Review ostile del diff IN CORSO** (profilo Reviewer Math,
> deepseek-v4-flash: attacco su inversi aritmetici dei 5 contratti,
> bitselect bit-exact, idiomi vietati post-inline, classificatore
> harness, parsing env, ri-derivazione indipendente della NMSE).
> GO/NO-GO della review = gate per chiedere l'S23.
>
> ✅ **REVIEW OSTILE DEL DIFF: GO (19/08 notte, Reviewer Math, report 19KB
> in `scratchpad/agents/restore-fix-review/REPORT.md`).** Tutti e 7 gli
> attacchi CONFERMATI a favore: (1) inversi dei 5 restore corretti
> byte-per-byte (prova per sostituzione + simulazione 500k blocchi a
> letteralità di contratto: 0 fail; qh 200k round-trip: 0 fail; mxfp4 usa
> `e:uchar` correttamente); (2) bitselect bit-exact (256×256 esaustivo,
> 0 mismatch; env value-parsed con stringhe esatte, unknown→warn+default;
> un programma per processo, no riuso stantio); (3) zero idiomi vietati
> nei 5 restore e negli helper; (4) harness: layout = ggml-common.h,
> regioni qs/qh disgiunte (una corruzione qs non è mai contata come qh),
> firma `odd_qs_hi_to_f` esatta, no false-PASS; (5) host pulito, env
> one-shot, fuori dai hot loop; (6) NMSE ri-derivata indipendentemente
> (E[q²]=21.5, E[δ²|poison]=77.5 → 1240/2752 = 0.4505813953 ✓, conteggi ✓);
> (7) superficie di regressione minima (3 file esatti). **Trovati e a
> verbale (non bloccanti):** GAP — solo q4_0 logga tutti e 3 i path, gli
> altri 7 tipi loggano solo il ramo trans4-moe; NOTA ONESTA — i restore
> K-quant/q6_K INTOCCATI portano la stessa classe di aliasing: se l'S23
> miscompila anche quelli, le 3 righe di controllo escono sporche (rc≠0,
> riportato correttamente) e vanno documentate come evidenza di
> superficie intoccata, NON piegate nel claim di questo commit; la banda
> 0.36-0.70 ha potere discriminante debole (pre-registrato). **Prescrizioni
> device della review:** bytewise e bitselect in DUE processi separati con
> CVT_VARIANT registrato; log dei path attivo e verifica delle etichette
> (8 trans4-moe + noshuffle + generic); i 5 tipi fixati devono uscire
> `class=clean`; niente claim "produzione immune" senza lo smoke
> pre-registrato (enqueue shim + A/B logits). ➡️ **PROSSIMO PASSO: sessione
> S23** (in carica OK, è una sessione ERR) — matrice della RETRIAL
> PRE-REGISTRATION, sha del binario on-device prima di ogni run.
>
> 🏆 **19/08 NOTTE — RETRIAL S23 ESEGUITO: IL FIX È VERIFICATO SUL DEVICE.
> I 5 TIPI MoE COLPITI PASSANO DA FAIL A PASS.** (GLM 5.2, commit
> artefatti `890a775`: `scratchpad/agents/retrial-s23/REPORT.md` +
> MANIFEST + 22 log + entrambi i .so per provenienza; verificato su disco
> dall'orchestratore.) Verdetti per cella: **(0)** sha PC==device,
> Adreno 740, dir storiche intatte → PASS. **(1) Baseline non patchata:**
> firme per-tipo riprodotte (94.208 sporchi sui 5 colpiti, qh dei q5
> PULITO misurato indipendentemente — la firma NON era estrapolata),
> e2e q4_0 FAIL riprodotto → PASS. **(2a)** patched+HOST_REPACK: q4_0
> roundtrip **0 mismatch** (il restore fixato è byte-esatto sotto storage
> contract-conforme); ANOMALIA a verbale: HOST_REPACK repackava SOLO
> q4_0 (gli altri 4 giravano col producer bytewise). **(2b) Stato
> intermedio:** 65.536 sporchi da violazione di contratto del producer
> bytewise (il "≈94.208 da rimisurare" si rimisura in 65.536 = 131.072
> candidati odd-qs × 1/2; il falsificatore pre-registrato era uno ZERO,
> non scattato) → PASS. **(3) Predicato di gating DIMOSTRATO:** 8×
> trans4-moe, denso 256→generic-soa, denso 512→noshuffle. **(4) E2E:**
> q4_0 74/74, q4_1 75/75, q5_0 3/3, q5_1 3/3, mxfp4 74/74 — TUTTI
> FAIL→PASS; regressioni invariate: q8_0 75/75, q6_K 3/3, denso 915/925
> (i 10 FAIL sono i soliti q6_K flat); q4_K/q5_K MUL_MAT_ID FAIL
> pre-esistente (compute K2, confermato anche su unpatched, NON di questo
> commit). **(5a) PREDIZIONE FALSIFICATA (unica):** bitselect roundtrip
> ≠ 0 — 65.536 sporchi IDENTICI al bytewise: il device miscompila
> entrambe le forme allo stesso modo, o il difetto del convert è
> strutturale, non nella forma dell'helper. Thread STOPPATO come da
> disciplina, zero improvvisazioni, analisi off-device dovuta. Il fix del
> restore NON è implicato (2a lo prova). **(5b)** bitselect e2e 74/74
> PASS (coerenza). **(6) f1/f2 A DUE PUNTI CHIUSO — l'ultimo anello
> inferito è ora PROVATO:** byte consumati dal giudice→ERR ~0.43
> riderivato (in banda, vicino a 0.45058); byte puliti→PASS; il restore è
> il contributore UNICO; NMSE offline combacia 12/12. **(7) Il −55% è
> ri-ancorato in-sessione:** 61.440 riprodotto (== modello 65.536−4.096);
> il difetto vincolante era il RESTORE; il fix completo vale −100%
> (FAIL→PASS); il −55% storico va etichettato come delta parziale
> intermedio a restore ancora rotto. **Restano aperti:** analisi
> off-device del puzzle bitselect/producer-violation (perché l'e2e passa
> con roundtrip producer-violato: auto-consistenza producer↔consumer da
> caratterizzare); smoke di produzione BMoE (enqueue shim + A/B logits)
> PRIMA di ogni claim "produzione immune"; MAX RECALL finale sul diff
> cumulativo; decisione di pubblicazione (owner, dopo questi).
>
> 🔬 **19/08 NOTTE — MAX RECALL ESEGUITO (3 reviewer paralleli su angoli
> diversi) + IL PUZZLE È RISOLTO: C'È UN TERZO DIFETTO, E RESTA APERTO.**
> Report: `scratchpad/agents/maxrecall-{tracer,claims,puzzle}/REPORT.md`.
> **(1) Claims-vs-artefatti (mimo, voto B):** hash, manifest 22/22,
> TUTTI i conteggi roundtrip/e2e/firme verificati riga-per-riga nei log.
> DUE errori aritmetici nel report del retrial, ARBITRATI
> dall'orchestratore sul log grezzo (`cell6_armA_*_dump.log`): **media
> ERR cella 6 = 0.4158 (non 0.4325)** e **4/12 sotto 0.36 (non 2/12)** —
> la calibrazione f1/f2 è più lasca del dichiarato ma il verdetto
> qualitativo regge (restore contributore unico confermato).
> **(2) Tracer cross-file (GLM): purezza del default TIENE** (a env
> spenti: solo convert byte-wise + restore shift/mask); trovata
> l'ASIMMETRIA §3C: il rewrite shift-then-mask del consumer fu applicato
> solo a gemv/gemm_moe_q4_0, i consumer q4_1/q5_0/q5_1/q4_K tengono
> l'idioma originale — severità DECLASSATA dall'evidenza (il puzzle prova
> che quei consumer NON sono miscompilati: 156 casi affetti passati, una
> deviazione inietterebbe ~0.45 NMSE ≈ 900× soglia); resta debito di
> uniformità (port meccanico dei 6 macro). Minori: getenv non cache-ato
> in audit_q4_0; riga di log variant= incondizionata; `register_dst_snap`
> senza clRetainMemObject (solo path audit). **(3) Puzzle (v4-flash,
> simulazione byte-esatta sim1-3.py): MECCANISMO IDENTIFICATO — DUE
> difetti device distinti che forzano la nibble alta dei byte qs dispari
> a 0xF:** **P (convert, WRITE)** scatta su want<0x80 (bit7 basso) e
> colpisce ENTRAMBE le forme del producer (bytewise E bitselect) →
> 65.536 visibili col restore fixato, 0 invisibili; **R (vecchio
> restore, READ)** scattava block-even value-independent → 65.536 eventi,
> 4.096 invisibili = 61.440. **P∪R = 94.208 ✓, tutti e 4 i numeri
> misurati riprodotti esattamente.** Il rapporto 1/2 è una proprietà del
> pattern LCG dell'harness (`p[i]=(i·131+17)&0xFF`, biiezione
> periodo-256), non una probabilità del kernel. ⚠️ **CONSEGUENZA: l'e2e
> PASS = auto-consistenza giudice/GPU sugli STESSI pesi sporchi, NON
> fedeltà ai pesi originali. RISCHIO LATENTE PESI-SBAGLIATI: SÌ
> (condizionale)** — qualunque load path che accende il convert device
> su A740 (gate name+shape: `ffn+exps`/`as`, ne01%32==0 — matcha nomi
> reali di checkpoint) corrompe ⅛ dei pesi in silenzio. BMoE produzione
> immune BY DESIGN (use_extra_bufts=false) ma NON ancora dimostrato
> (smoke §4 sempre dovuto). **Il capitolo kernel NON è chiuso: resta il
> DIFETTO P (convert write).** Esperimento discriminante più economico
> (pre-registrato dal reviewer): cambiare la costante di fill_pattern e
> rerun della sweep (si ricompila solo il test exe, NON il .so) —
> predizione: il conteggio resta N/2 e l'insieme dei mismatch segue la
> nuova classe want<0x80. Ipotesi meccanicistica da vagliare per P:
> classe sign-extension (char vs uchar) negli store/helper del convert.
>
> 🧪 **ESPERIMENTO DISCRIMINANTE P ESEGUITO (S23, 4 run, stesso .so
> 9198f387… verificato prima di ogni run; commit test-only `5a952cb2`;
> report `scratchpad/agents/defectP-experiment/REPORT.md`, log
> `results/oracle_consumer_s23/defectP/`). VERDETTO: MIXED — il gate
> bit7 ESISTE ma la polarità del reviewer era INVERTITA e il trigger è
> un byte PARTNER trasposto:** (a) lcg default: 65.536 riprodotto ✓;
> (b) const40 (bit7 basso): **0 clean** — la predizione "tutti" VIOLATA;
> (c) constC0 (bit7 alto): **131.072, TUTTI corrotti** — predizione "zero"
> VIOLATA all'opposto; (d) lcg29: 57.344 con partizione bit7 imperfetta
> (bit7clear=15.360 / clean_bit7set=23.552). **Lettura: P scatta quando
> il byte SORGENTE PARTNER (quello che contribuisce la nibble alta del
> byte dispari di output, trasposto nel layout trans4) ha bit7=1 —
> perfettamente coerente con SIGN-EXTENSION (`char` vs `uchar`: (char)
> 0xC0>>4=0xFC inonda la nibble alta; 0x40>>4=0x04 pulito), condivisa da
> entrambe le forme producer perché sta nel LOAD/store comune, non negli
> helper di pack. Il "want<0x80" della simulazione era un proxy valido
> solo col moltiplicatore 131 (correlazione posizione↔partner).**
> Follow-up dovuti prima del fix: identificare il byte partner esatto da
> cvt.cl (read-only) e ri-derivare in forma chiusa TUTTI i conteggi
> (65.536 lcg / 0 const40 / 131.072 constC0 / 57.344+partizione lcg29 /
> 61.440 e 94.208 storici) da UN solo meccanismo — poi scrivere il fix
> (unsigned esplicito nel punto incriminato) e riverificare su device.
>
> 🎯 **P′ IDENTIFICATO AL BYTE (v4-flash, sim4.py: TUTTI e sei i
> datapoint ESATTI, più mxfp4 come extra).** Meccanismo: in
> `trans4_pack_hi` (cvt.cl:59 bytewise / :57 bitselect) l'idioma
> **mask-then-shift** `((x0 & 0xF0) >> 4)` viene miscompilato: il byte
> mascherato è trattato come signed, lo shift aritmetico sign-filla il
> campo, l'OR con `(x1 & 0xF0)` vince → la nibble alta del byte hi-word
> storato va a 0xF **sse bit7 del partner PARI x0=qs[2k] della stessa
> coppia è SET** (locale, stesso blocco; il restore fixato la mappa sulla
> nibble alta del byte dispari → firma `got=(want&0x0F)|0xF0`,
> `qs_other=0` ✓). Sotto qualunque fill biiettivo scatta esattamente su
> metà dei candidati (65.536); mult-131 vs mult-29 differiscono solo per
> l'overlap con posizioni già-0xF (0 vs 8.192 invisibili). R (block-even)
> regge invariato: 61.440 ✓, P∪R=94.208 ✓. Stessa classe dell'idioma
> "signed-smear" già documentato dalla campagna sul consumer q4_0 — ma
> nei PACK HELPER del convert, condivisi dalle due forme producer (per
> questo bytewise==bitselect). I path densi/K con lo stesso idioma
> round-trippano puliti: difetto specifico del path trans4. **FIX
> PREDETTO: shift-first-then-mask nei due helper** — `(x0>>4)&0x0F` (+
> difensivo `((x1<<4)&0xF0)` in trans4_pack_lo) — con predizione: TUTTI
> e sei i conteggi → 0 sotto OGNI fill. Se dopo il rewrite il bitselect
> corrompe ancora, il residuo è nel load/store condiviso (probe
> discriminante già disegnato: coppia singola even×{00,80}×odd×{40,C0}).
> ➡️ Implementazione in corso (GLM), poi: verifica disco → review ostile
> (Luna) ∥ verifica device (i 4 fill + sweep 5 tipi + e2e + regressioni).
>
> ❌➡️🔦 **FIX P TENTATIVO #1 (shift-first negli helper, `39a0b130f`):
> BIT-EXACT MA ZERO EFFETTO SUL DEVICE.** Review Luna: helper nuovi
> bit-identici ai vecchi su tutti i 65.536 input, robusti anche sotto
> compilatore avverso, scope +5/−4, GO condizionato agli zeri device.
> Device (16 log, `results/oracle_consumer_s23/defectP_fix/`, .so
> `69d6d862…` sha-verificato a ogni run): **tutti i conteggi
> BYTE-IDENTICI al pre-fix** — lcg 65.536, constC0 131.072, lcg29
> 57.344 con la stessa partizione, bitselect == bytewise, stesse
> posizioni first — su ENTRAMBE le arm. e2e tutto PASS (auto-consistenza,
> non fedeltà), K/denso puliti, HOST_REPACK 0. **Conclusione: P NON è
> nella forma dell'espressione dei pack helper — abbiamo cambiato l'unica
> cosa che distingue le due arm e non è cambiato NULLA. Il difetto vive
> nel LOAD di x0/x1 o nello STORE/assemblaggio della hi-word, condivisi
> (rank-2 della lista). Indizio di firma: got = want|0xF0 ≡ OR con 0xF0
> — coerente con sign-extension di un campo a 4 bit OR-ato
> nell'assemblaggio della word.** Il commit `39a0b130f` resta (innocuo,
> uccide l'idioma-classe per uniformità). **PROSSIMO: probe di
> localizzazione** — (a) fill "pair" mirato per blocco (even∈{00,80} ×
> odd∈{40,C0}, resto neutro) per inchiodare quale byte gate-a; (b)
> readback RAW del buffer SoA convertito via clEnqueueReadBuffer nel
> harness (SENZA passare dal restore) confrontato con le word di
> contratto attese host-side: separa definitivamente WRITE corrotto da
> READ corrotto — possibilità non ancora esclusa: il convert scrive
> giusto e il restore legge male i buffer GPU-converted (alignment
> diverso dallo storage host-repacked su cui fu assolto). Dopo la
> localizzazione: fix strutturale del convert in stile restore (uint
> word end-to-end, niente corsie uchar).
>
> 🔦 **PROBE ESEGUITO (commit test-only `bb05e4a0b`, 6 log,
> `results/oracle_consumer_s23/defectP_probe/`): P LOCALIZZATO — È LA
> SCRITTURA DEL CONVERT, IL RESTORE È INNOCENTE.** (1) pair-fill:
> pair8040 → 131.072 sporco, pair00C0 → 0 pulito ⇒ **gate = bit7 del
> byte PARI x0=qs[2k]**, il bit7 del dispari NON gate-a (era solo proxy
> posizionale). (2) Readback RAW dello storage SoA (via DUMP_Q, senza
> restore): **le word hi-nibble escono GIÀ corrotte dal convert**
> (lcg: 18.688/65.536 word sporche, pair8040: 32.768 = 50% esatto;
> 32.768×4 byte = 131.072 = roundtrip ✓), word lo-nibble TUTTE pulite,
> firma raw esatta got=(want&0x0F)|0xF0 (0x48→0xF8). Restore assolto
> in via definitiva (inverte fedelmente storage già sporco). **Indizio
> chiave: il bit7 di x0 corrompe il termine di x1 — effetto CROSS-BYTE
> impossibile dall'espressione di pack ⇒ il compilatore rivettorizza la
> forma byte-wise in corsie short/ushort con shift aritmetico — la
> STESSA classe as_ushort8 del difetto restore. Ecco perché il
> tentativo #1 (forma dell'espressione) non poteva funzionare.** FIX
> STRUTTURALE disegnato: riscrivere il path qs dei 5 convert trans4 in
> stile restore-fix — nibble extraction e assemblaggio delle word di
> output INTERAMENTE in uint scalari (shift/mask a livello word, uno
> store per word, zero corsie uchar/short intermedie). Verifica: il
> probe stesso (4 pair-fill + raw readback → tutto 0) + sweep + e2e +
> regressioni.
>
> 🏆 **DIFETTO P MORTO — FIX #2 (`f63746555`, riscrittura uint scalare
> dei 5 convert) VERIFICATO SUL DEVICE: TUTTE LE PREDIZIONI CONFERMATE,
> ZERO VIOLAZIONI** (review statica Luna: GO, contratto/segno/bitselect/
> scope tutti CONFIRMED; device 16 log,
> `results/oracle_consumer_s23/defectP_fix2/`, .so `2032b7c7…`
> sha-verificato a ogni run). **(1) GATE PRIMARIO — raw readback: 0/0**
> su lcg e pair8040 (erano 18.688/32.768): la scrittura deposita i byte
> di contratto, confrontati col riferimento host. **(2) Roundtrip 0 sui
> QUATTRO fill** (lcg/const40/constC0/lcg29 — constC0 era 131.072).
> **(3) Sweep 5 tipi: 0×5** (erano 65.536×5), controlli K/denso puliti.
> **(4) Arm bitselect: tutto 0, raw incluso** — anche la variante è
> sanata dalla stessa forma uint. **(5) e2e invariato tutto PASS e ORA
> WEIGHT-FAITHFUL** (GPU e giudice vedono i byte originali x): 74/74,
> 75/75, 3/3, 3/3, 74/74, q8_0 75/75, q6_K 3/3, denso 915/925.
> **(6) HOST_REPACK 0.** Lo smear cross-byte da bit7-del-pari è
> eliminato: la forma uint scalare batte la rivettorizzazione byte-lane
> di Adreno, la STESSA medicina che guarì il restore. **LA FAMIGLIA
> TRANS4 È INTEGRALMENTE SANATA — tre difetti, tre fix verificati al
> byte sul silicio:** convert-READ (9dc1ec0cb, ago), restore-READ
> (eaec5d884), convert-WRITE (f63746555). **Restano:** smoke di
> produzione BMoE (unico anello di fedeltà non misurato sul motore
> vero); 2 commenti stantii da ripulire (offset q4_0, "byte-wise
> stores" — segnalati da Luna, cosmetici); port di uniformità sui 6
> macro consumer (debito, non difetto); capitolo K2 q4_K/q5_K (grok);
> decisione di pubblicazione (owner). Lignaggio finale della notte:
> 1582f2d83 → eaec5d884 (restore) → 5a952cb2 (fill param) → 39a0b130f
> (helper, innocuo) → bb05e4a0b (probe) → f63746555 (convert uint) =
> **kalsakernel-v2**.
> **CODA AGGIORNATA:** (a) esperimento discriminante P (S23, breve);
> (b) fix del difetto P; (c) smoke produzione BMoE; (d) port meccanici
> di uniformità + retain cl_mem + getenv cache; (e) grok domani: capitolo
> K2 (q4_K/q5_K compute) — nota: Mellum2 è Q4_K_M, esperti in famiglia K.
>
> ➡️ **Ultimo indiziato in piedi: il READBACK (`get_tensor`).** Hook
> pronto (working tree, +287/−1, `.so` `0111c70d…4ed692`):
> `DST_READBACK{raw_match, returned_match}` (raw = re-read indipendente
> del range snapshottato; returned = checksum di ciò che get_tensor
> consegna), snap consumati dopo il log (anti falso-clobber su cl_mem
> riciclati), OVERLAP_MAP, POST_ENQUEUE (limite onesto: matcha il tensor
> del wrapper, OpenCL non espone i cl_mem bound). 🔎 Review ostile in
> corso, con domanda-crux: l'hook DISTINGUE davvero i quattro esiti
> (raw×returned), e cosa resta logicamente se esce tutto verde e l'e2e
> fallisce ancora (⇒ reference/NMSE del harness — la sessione deve poter
> essere interpretabile in anticipo per ogni esito).
>
> ➡️ Nel frattempo il Jelly (libero) è
> stato messo sul buco di provenienza del listino: **cella tracciabile per
> "Marco1c Jelly 3.64 t/s (t2, ranking)"** — uno dei due numeri di ALIVE §5
> che non risalgono a nessun runs.csv — con config spedita (d=0.0, flag da
> citare per file:riga), harness covariate, ≥3 round, unplugged
> (`results/lineup_marco_jelly_cov/`).
>
> 🏷️ **19/08 — REGOLA DI RICONOSCIBILITÀ DELL'ENGINE ("kalsallama", proposta
> gualt).** Paura a verbale: due kernel patchati in modo diverso su lignaggi
> separati. Protezione: (1) **una sola linea di patch** — tutto si impila su
> `kalsa/kernel-s3-repack`, mai patchare main/upstream (già a verbale); (2) al
> **prossimo commit engine** si aggiunge un **version banner di build**
> `kalsallama <branch> <sha>` in `--version` e nel log di avvio — chiude anche
> il buco "`strings` sull'exe mente"; (3) **niente rename di file o simboli
> kernel** (avvelenerebbe diff e rebase contro upstream). L'altro Claude lavora
> su macOS al repo app (kalsa), non su moe-experiments: nessuna collisione di
> working tree; la risorsa condivisa è solo l'S23.
>
> 📱 **19/08 — LE TRE CELLE CACHE JELLY SONO RIFATTE CON LA COVARIATA CPUSET
> E PASSATE ALL'AUDIT OSTILE. VERDETTO A DUE FACCE: c1500/c2000 REPLICANO,
> IL "+15/+20% a c4000" NON SOPRAVVIVE — E CADE ANCHE IL +39% ORIGINALE.**
> (Report agente: `scratchpad/agents/jelly-cache-rerun/REPORT.md`; audit con
> tutta l'aritmetica: `scratchpad/agents/jelly-cache-rerun-review/REPORT.md`.)
>
> Celle nuove `results/cachesweep_marco_jelly_c{1500,2000,4000}_cov/` (dir
> nuove, sennò il resume avrebbe skippato), harness al commit **`6a26036`**
> (già committato — la voce "uncommitted" di ALIVE §6 è superata; disco ==
> commit verificato dall'audit). **Tenuta della piattaforma, confermata riga
> per riga dall'audit:** 24/24 righe accettate con `nproc=8`,
> `affinity_mask=ff`, `/top-app 0-7` **dal PID di `bmoe-cli`** (harness
> L548-570); tutte UNPLUGGED, batteria **94→56 nei DATI** (il "97→55" del
> report agente è prosa che non sta in nessun file — stessa classe di errore
> già ritrattata in campagna); sha binario `77a94640a56a9043` (prefisso a 16
> hex, calcolato live dall'harness) identico in tutti e 6 i log.
>
> ✅ **Ciò che REGGE (12/12 righe appaiate, aritmetica ricalcolata):**
> a c1500 il drop paga **−24.8%**, a c2000 **−28.4%**, stabili ≤1.5% fra i
> due run. Per queste due celle "replica, non artefatto" è onesto — e sono
> le celle su cui poggia il default spedito. ➡️ **Il default NON poggia su
> un artefatto da cpuset.**
>
> ❌ **Ciò che NON regge (HIGH dell'audit):**
> - **c4000 "+15/+20%" era un sottoinsieme (r2/r3):** con TUTTI i round
>   accettati il danno del drop collassa a **+2.4% medio / −3.1% aggregato ≈ 0**.
>   E il **+39% della cella originale era portato al 100% dal suo outlier
>   r1**: esclusione simmetrica di r1 → +15.5% vs +17.4% (coerenti); tutti i
>   round → +39% vs +2% (incoerenti). **Il rerun SMENTISCE la grandezza
>   originale.** Lettura onesta di c4000: a cache grande il drop **non paga**
>   (il suo vantaggio va a ~0), ma il "fa male +39%/+15%" citabile non
>   esiste più. "Termicamente appaiate" non è sostenibile: l'anomalia r1 è
>   in `compute_s_tok` (0.154 vs 0.089), non termica.
> - **"Byte bit-identici" è FALSO sul contatore vero:** le colonne identiche
>   (read_MiB, hit%, evictions, …) sono **formule deterministiche**;
>   l'unica misura I/O reale, `proc_read_bytes`, differisce in **24/24**
>   righe (−0.58%…+1.16%, normale). Il meccanismo replica; "bit-identico"
>   no.
> - **0.184→0.142 a c1500: numero confermato, spiegazione refutata** — il
>   rerun misura 0.142 **alla stessa temperatura (35 °C)** dell'0.184
>   originale: era varianza run-to-run, non termica.
> ⚠️ **Caveat di provenienza (da chiudere):** le celle "originali" usate come
> termine di confronto **non esistono nel repo** se non nelle copie
> dell'agente — il bersaglio del confronto non è verificabile alla fonte.
> In coda: localizzare/committare gli originali o declassare il confronto.
> ➡️ Voce di coda "rerun celle Jelly con la covariata": **CHIUSA** (resta il
> gemello S23, telefono occupato). 🔧 Residuo harness confermato dall'audit
> (display-only, `watch_dropsweep_lfm_jelly.ps1` ~L112): il contatore righe
> buone fa `grep ',0,ok$'` e sul nuovo schema stampa 0 — non blocca il
> rilancio, da sistemare al prossimo giro.
>
> ✅ **KEEPALIVE JELLY: CONFERMA PIENA.** `mWakefulness=Awake` ininterrotto
> per **~83 min** (soglia era ≥60), Termux mai ucciso. ⚠️ Dettaglio operativo
> nuovo: **staccato il Jelly non ha USB** — la ricetta adb va applicata via
> **wireless debugging** (`192.168.1.82:39591` in questa sessione; la porta
> cambia a ogni pairing).
>
> 📇 **19/08 ~13:45 — CELLA DI LISTINO MARCO1c JELLY RIFATTA AL FLAG
> SPEDITO, E LA CARD VA CORRETTA IN DUE PUNTI.**
> (`results/lineup_marco_jelly_cov/`, harness covariato; report agente in
> `scratchpad/agents/jelly-lineup-marco/REPORT.md`.)
> - ✅ **Il flag di provenienza di ALIVE §5 era SBAGLIATO in un senso
>   inatteso: il 3.64 UN runs.csv ce l'ha** (`results/lineup_card/jelly_1c/`)
>   — ma misura **k6 d=0.65** (il default VECCHIO, ritirato), ABBA
>   fact+creative, binario `36b01966…`.
> - 📏 **Il flag spedito (d=0.0, t2, cache 2000 — ogni flag citato, cache
>   4000 è l'ottimo Jelly ma NON è nel flag) misura 3.27-3.39 t/s,
>   mediana 3.34** su 3 round freddi p_fact, range ±3%, stesso binario
>   della card verificato per sha, covariate tutte pulite (nproc=8, ff,
>   UNPLUGGED 46→41%).
> - ➡️ **Like-for-like (solo fact): lo spedito è ~7-9% più LENTO della
>   card** (3.27-3.39 contro 3.576-3.594); il 3.642 mescola anche il
>   creative (più veloce). **La riga Jelly del listino va aggiornata a
>   ~3.3 t/s con questa cella come fonte.**
> - 🔍 **Fatto nuovo che il confronto ha stanato:** lo sweep cache misura
>   **5.5-5.9 t/s** alla STESSA config (d=0.0, cache 2000) con gli STESSI
>   byte (11803.1 MiB) e hit (50.2%) — ma su **binario diverso**
>   (`kernel_kf`). Il regime I/O è identico alla cifra: **il gap di
>   tok/s (~+70%) è il BINARIO, non config né drop.** Va capito cosa ha
>   `kernel_kf` che il binario di listino non ha — possibile upgrade di
>   listino gratis. In coda.
> ⚠️ Batteria Jelly a 41%: prima di altre celle lunghe va ricaricato.
>
> 🔬 **PROFILING COMPUTE — LA DOMANDA APERTA DA GIORNI HA RISPOSTA: SONO I
> MATMUL MoE, IL GDN NON ESISTE (18/08, CalaQwen, `--compute-trace`).**
>
> Domanda di gualt: *"capire se quei 0.1407s sono dominati dai matmul MoE o
> dal GDN. Solo quello vi salverà."* Traccia per-nodo su CalaQwen
> (47.021 nodi, `qwen35moe`, 40 layer), separata per fase:
>
> | operazione | prefill | **decode** |
> |---|---|---|
> | **MUL_MAT_ID** (esperti MoE) | **81.6%** | **33.5%** |
> | MUL_MAT (densi/attenzione) | 9.9% | **23.1%** |
> | GET_ROWS | 2.0% | 7.6% |
> | ADD | 0.8% | 7.5% |
> | **GATED_DELTA_NET** | **0.94%** | **2.26%** |
> | **rapporto MoE/GDN** | **87×** | **15×** |
>
> ➡️ **Il compute è matmul: MoE + densi = 56.6% del decode. Il GDN è il
> 2.26%.** Tagliare FLOP ha senso solo su `MUL_MAT_ID`.
>
> 🪦 **E questo UCCIDE il "Predictive GDN State Update Skipping"** proposto
> nel PDF (DCB) — **per mano del suo stesso criterio di morte**, che
> recitava: *"se il layer GDN è sotto il 10% del compute per token, la
> componente state-skip probabilmente non vale la pena"*. Misurato:
> **2.26%**. Chiuso senza scrivere una riga di codice.
>
> ⚠️ **Limite dichiarato dallo strumento stesso:** `--compute-trace`
> *"isolates and times EVERY graph node — serializes the graph, proportions
> only"*. Quindi le operazioni minute (il ~40% di decode in `GET_ROWS`,
> `ADD`, `MUL`, `RMS_NORM`) sono **gonfiate**: perdono fusione e
> coalescing. **Il rapporto MoE/GDN regge** (15× e 87× sono fuori da
> qualunque artefatto di serializzazione), quel 40% no. Per una ripartizione
> fedele serve `--compute-trace-layers`, che tiene una barriera per layer e
> lascia sopravvivere coalescing e prefetch — **prossimo passo naturale**.
> ⚠️ Un secondo `bmoe-cli` girava in parallelo durante la traccia: altro
> motivo per non citare i tempi assoluti, solo le proporzioni.
>
> ✅ **Allineato con gualt (18/08): la speculative decoding è chiusa** — F6
> morta sui byte (β=0.594 contro 0.56 di pareggio) e draft-by-drop morta
> prima dell'implementazione. Il compute-bound si attacca tagliando FLOP,
> non aggiungendo draft head.
>
> 📦 **UN REPO SOLO, SENZA CANCELLARE NIENTE (18/08, commit `15b4e47`).**
> gualt: *"vorrei un repo solo per non perderci, ma senza cancellare o
> perdere niente"*. La proposta iniziale era spostare tutto in
> `kalsa-engine` e cancellare `moe-experiments`: **sconsigliata con un
> numero.** Fuori da git, perché gitignorato, c'è **`models/` = 57 GB** e
> **`build-pc-mellum-ppl/` con il binario pinnato** — ricostruibile dal
> branch giusto ma **non byte-identico**, e la campagna lo pinna per sha.
> Cancellare la cartella avrebbe distrutto entrambi.
>
> ✅ **Fatto invece:** `BigMoeOnEdge/` è ora un **submodule** puntato al
> nostro `Aspis0/kalsa-engine` (privato, 9 branch + uno snapshot per
> l'unica copia-cartella il cui sorgente non corrispondeva a nessun
> branch). Gitlink su `0c54a27`, cioè la linea del binario di campagna.
> **Da adesso ogni commit di risultati registra l'engine che li ha
> prodotti** — è il buco che il 18/08 è costato mezza giornata.
> 🔒 Remote rinominati: **`origin` = il nostro** (scrivibile),
> **`upstream` = Helldez** con push URL **disabilitato**. Nessuna nostra
> patch era mai uscita (verificato dal reflog), e ora non può.
>
> 🧾 **BATTERIA DI SANITÀ SU MARCO (18/08, 12/12) — IL GATE NON TROVA
> CONFERMA NELLE RISPOSTE, E VA DETTO.**
>
> Tre config: `stock` k=8 (ancora), `shipped` k=6 d=0.0 (**da spedire**),
> `rejected` k=6 d=1.0+nr (**bocciata dal gate al 122% del budget**).
>
> | | F1 Spa 2000 | tabellina 9 | giudizio | **vocali in "armadio"** |
> |---|---|---|---|---|
> | stock k=8 | ✅ Häkkinen | 10/10 | ✅ | **3** ❌ |
> | **shipped** k=6 d=0 | ✅ Häkkinen | 10/10 | ✅ | **5** ❌ |
> | **rejected** d=1.0+nr | ✅ Häkkinen | 10/10 | ✅ | **4** ✅ |
>
> ⚠️ **Sulla domanda che discrimina, la config MIGLIORE per bpb sbaglia
> (3, deduplicando le due "a"), quella da spedire sbaglia diversamente
> (5, inventando una "i"), e l'unica corretta è quella BOCCIATA.**
> Su CalaQwen le quattro config dicevano tutte 4. **Quindi è una
> debolezza di Marco, non della configurazione**, e quale config indovini
> è fortuna.
>
> ➡️ **Due conclusioni oneste:** (1) **quattro domande non bastano a
> ordinare le config** — la varianza fra domande è molto più grande della
> differenza fra config; (2) **il rifiuto di d=1.0 da parte del gate NON
> è corroborato da evidenza indipendente.** Non significa che il gate
> sbagli — la bpb integra su un corpus intero, quattro domande no — ma
> significa che al momento **la bocciatura di Marco poggia su un solo
> tipo di misura.** Se quella decisione diventa costosa, serve una
> batteria vera (decine di domande, giudice cieco), non queste quattro.
> ✅ **Quello che la batteria esclude davvero:** nessuna delle tre config
> è rotta — istruzioni rispettate, aritmetica esatta, giudizio sensato,
> italiano fluente ovunque.
>
> 🛑 **MARCO1c — ANCORA MISURATA, E IL DROP A 1.0 NON SI PUÒ SPEDIRE.
> NEMMENO COL FLAG. (18/08 03:38, `results/marco_renorm_ablation`)**
>
> Ancora sua: **`marco_k8d0` = 0.761332** (k=8, nessun drop, stesso binario
> e corpus). Contro quella, col budget di campagna `MACRO_PASS = 0.04`:
>
> | config Marco | macro bpb | vs ancora | quota budget | esito |
> |---|---|---|---|---|
> | k6 **d=0.0** | 0.766534 | **+0.0052** | **13%** | ✅ PASS |
> | k6 d=1.0 renorm ON | 0.861667 | +0.1003 | **251%** | ❌ FAIL |
> | k6 **d=1.0 + no-renorm** | 0.810295 | **+0.0490** | **122%** | ❌ **FAIL** |
>
> **`--drop-no-renorm` dimezza il danno (da +0.1003 a +0.0490) ma non
> basta: su Marco il drop a 1.0 sfonda comunque il budget del 22%.**
>
> ➡️ **Per Marco1c la risposta è: NESSUN DROP.** `d=0.0` passa col 13% del
> budget; `d=0.65` è già escluso dall'altro lato (sul device è **più
> lento** di non droppare, +5.4% su 3 round). Non esiste un livello di
> drop che convenga su questo modello.
> ✅ **È esattamente perché mi ero rifiutato di estendere a Marco il
> default deciso per CalaQwen senza la sua ancora.** Su CalaQwen d=1.0+nr
> sta al 50% del budget, su Marco al 122%: **stesso flag, stesso livello,
> esito opposto.** La config è per-modello, come diceva gualt.
>
> 📌 **E si incastra col risultato cache:** per Marco la leva giusta non è
> togliere esperti ma **dargli RAM** — cache 4000 senza drop è il minimo
> assoluto misurato (0.113 s/tok) e costa **zero** qualità, contro un drop
> che qui non passa nemmeno il gate.
>
> 🔭 **PREFILL GPU RIVERIFICATO (18/08, Xiaomi 14 / Adreno 750, scollegato,
> celle INTERLACCIATE, 5 ripetizioni per ordinamento) — IL 5.77× È
> RITIRATO, MA LA LEVA ESCE PIÙ FORTE DI PRIMA.**
>
> ❌ **Il 5.77× era un artefatto della BASELINE CPU, non della GPU.**
>
> | | riverifica 18/08 | report originale |
> |---|---|---|
> | GPU pp128 | 183-188 t/s (media 186.6) | 181.65 ✅ riprodotto |
> | **CPU pp128** | **57-62 t/s (media 58.7)** | **31.46** ❌ |
>
> **La GPU riproduce esattamente il valore storico; è la CPU che
> nell'originale girava in uno stato lento** (i suoi due campioni erano
> coerenti fra loro — 31.76 / 31.16 — quindi non un errore di misura ma
> uno stato reale, e mai rimisurato). Rapporto vero a pp128: **3.18×**.
> ✅ **E NON è l'artefatto da prima-cella-fredda che temevo** (quello che
> aveva fregato il 740): la prima GPU della serata è stata la **più lenta**
> (179.7) e le prime CPU le **più veloci** (62.4 → assestate a 57.2) —
> l'opposto del pattern. I due ordinamenti concordano: **3.10× e 3.27×**.
>
> 📈 **MA il vantaggio CRESCE con la lunghezza del prompt, e il nostro
> punto di lavoro non è 128 token — è il system prompt da ~1.4k:**
>
> | pp | 2B GPU/CPU | 4B GPU/CPU |
> |---|---|---|
> | 128 | 3.18× | 4.17× |
> | 512 | 3.95× | 5.70× |
> | **1024** | **5.35×** | **6.95×** |
> | 2048 | 6.69× | 6.46× |
>
> **TTFT interpolato a 1400 token: 2B ~6.5 s su GPU contro ~33 s su CPU;
> 4B ~16 s contro ~108 s.** Cioè il 4B diventa usabile solo con la GPU.
>
> 🌡️ **L'argomento più solido non è il rapporto, è la STABILITÀ: la CPU è
> termicamente fragile, la GPU no.** Gli outlier CPU (29.5 t/s a pp1024,
> 18.8 a pp2048) sono arrivati a 38-40 °C mentre la GPU accanto restava
> a 216.7 e 212.2. Su un telefono caldo — cioè in uso vero — la CPU
> degrada e la GPU tiene la banda 210-217 (2B) / 86-89 (4B).
>
> 🔧 **Niente da spremere: la config di partenza era già l'ottimo.**
> `-ngl 99` batte 8/16/24; `-ub 512` batte 128/256/1024; `-b` e i thread
> GPU sono rumore. ⚠️ **`-fa on` CRASHA (exit 134, JSON vuoto)** — da
> aprire come bug, non è una config.
>
> ---
>
> 🔭 **RECON SILICIO NON-CPU/GPU (18/08, due round Grok con fonti obbligatorie;
> report in `scratchpad/agents/isp-npu-recon/` e `.../eva-npu-round2/`).
> MANDATO gualt: "se nessuno l'ha fatto possiamo farlo noi".**
>
> ☠️ **EVA / CVP — CHIUSA COL SORGENTE DEL DRIVER, non con le slide.**
> `eva-kernel` è `msm_cvp` rinominato; device `/dev/cvp`; DT `qcom,kalama-cvp`
> = SM8550 = 8 Gen 2. L'ioctl **ignora `cmd`** e dispatcha su
> `eva_kmd_arg.type`; `EVA_KMD_SEND_CMD_PKT` (0x10001040) è un **pass-through
> HFI opaco** da 490 word. **MA il kernel tiene un allow-list `cvp_hfi_defs[]`
> e rifiuta `-EINVAL` ogni tipo non elencato.** La lista, letta dal sorgente:
> DFS (depth-from-stereo), SGM_OF e CV_TME (optical flow), WARP, NCC
> (correlazione fra patch), HCD (Harris), OD/ODT, FD/DLFD, ICA, DMM, DCM.
> ⚠️ **`DCM` = Descriptor Calc & Matching, NON "dense compute"** — era la mia
> speranza ed era sbagliata. I pacchetti di config sono 47 word (NCC) e 20
> (DCM): non c'è posto per un tensore di pesi. `SET_MODEL_BUFFERS` è l'IOVA
> persistente dei modelli face-detection Qualcomm, non pesi arbitrari.
> ➡️ **Nessun comando moltiplica una matrice del chiamante per un'altra.**
> 🔒 **Secondo cancello indipendente:** `/dev/cvp*` è etichettato
> `video_device`; AOSP ha un **neverallow** su tutto `appdomain`; il dominio
> previsto è `hal_camera`. Non apribile da app né da `adb shell` stock.
> ✅ **La parte giusta dell'intuizione di gualt: prior art = ZERO.** Nessun
> paper, repo, thread o writeup di compute generico su un ISP di telefono.
> ❌ La parte sbagliata: non perché nessuno abbia guardato, ma perché **la
> porta non esiste**.
> 📌 **"Patchiamo il kernel per togliere l'allow-list?"** Si può (sullo Xiaomi;
> sull'S23 il bootloader Samsung Snapdragon in genere non si sblocca e Knox si
> brucia) **e non serve**: l'allow-list è un filtro SOFTWARE, toglierlo non
> crea una GEMM che nel firmware/silicio non c'è. L'EVA è pipe a funzione
> fissa; un pacchetto non implementato dà errore firmware, non una matmul.
> **Il muro è l'op-set del firmware, non il filtro.** L'unica versione seria
> sarebbe reverse-engineerare il firmware firmato: mesi, premio ipotetico.
>
> ☠️ **VENUS — chiusa.** Nel UAPI V4L2 pubblico: nessuna modalità
> motion-estimation-only, nessun output di vettori di moto separato
> dall'encode, nessun pacchetto SAD/NCC, nessun controllo che accetti
> coefficienti del chiamante. Il trucco esiste **su desktop** (NVENC documenta
> un ME-only mode) **perché NVIDIA lo espone**; patchare un kernel non aggiunge
> una modalità al firmware Venus. E comunque sarebbe SAD, non GEMM.
>
> ☠️ **ISP Spectra / CHI — chiusa.** CHI compone pipeline *fotografiche* e i
> suoi "extended node" scaricano su **CPU, GPU o DSP**, non caricano microcodice
> sull'ISP; `qcom_camss` mainline è cattura V4L2. **CHI è un instradatore, non
> un motore.** ☠️ Sensor hub, DPU display, DSP del modem: chiusi anch'essi —
> sul modem la frase è netta, i core li programma solo Qualcomm.
>
> ☠️ **UFS HPB — chiusa, per tre ragioni indipendenti.** (1) Il nodo sysfs
> `flags/hpb_enable` è **read-only per ABI del kernel**: non è "serve root", da
> userspace non si accende. (2) HPB è stato **rimosso da Linux mainline nel
> 2023** ("not aware of any current users"). (3) Accelera le letture **random
> da 4 KB** — tutti i numeri pubblicati (58-67%, 43%, 46%) sono lì; noi
> leggiamo blocchi da centinaia di KB con O_DIRECT, dove un lookup di mappa si
> ammortizza su centinaia di pagine. Numeri sulle nostre dimensioni: NOT FOUND.
>
> 🔧 **DUE CORREZIONI MIE, ENTRAMBE DETTE A gualt PRIMA DI VERIFICARLE.**
> 1. **Lo 0.67 MiB NON era la prova che credevo.** Avevo dato «l'HTP carica
>    0.67 MiB, quindi l'NPU non è candidata» come fatto. Il thread vero
>    (llama.cpp #22791, **proprio su un Galaxy S23**) dice altro: il log è
>    `token_embd.weight (q6_K) (and 197 others) cannot be used with preferred
>    buffer type`, e il manutentore risponde **«We do not support Q4_K_M in the
>    Hexagon backend»**. Quasi tutti i tensori erano di un quant non supportato
>    e restavano su CPU: 0.67 MiB è ciò che avanzava, non un tetto.
>    ✅ **La conclusione regge su evidenza migliore:** col quant giusto il
>    decode su HTP non vince comunque — OnePlus 12, Qwen3.5-4B **Q4_0**: CPU
>    11.43 t/s, OpenCL 8.44, **HTP 3.02** (#23314); in una prova successiva
>    CPU 9.1 / OpenCL 9.4 / HTP 8.9. Pari, non 100×.
> 2. **`graph splits = 283` non erano handover intenzionali.** Avevo scritto
>    «se quelle 283 transizioni costano poco il disegno regge». Falso: era lo
>    scheduler GGML che esplodeva perché ogni tensore rimbalzava per quant non
>    supportato. Sul path Q4_0 funzionante l'esempio ufficiale mostra **un solo
>    device HTP e `graphs reused = 473`**.
>
> 🚫 **"L'NPU ha memoria propria e non compete per la banda" — SMENTITO da
> fonte primaria.** Doc Hexagon di llama.cpp, testuale: memoria **unificata**,
> «the NPU does have a dedicated tightly-coupled memory called VTCM but that
> memory is used only for intermediate data … or temporary data (chunks of the
> weight tensors fetched via DMA)». TCM dell'8 Gen 2 = **8 MB**: scratchpad,
> non VRAM.
> ⚖️ **Correzione a me stesso in senso opposto:** avevo detto "non si può
> sommare banda", troppo netto. PowerInfer-2 misura sull'8 Gen 3 **CPU sola
> 43.9 GB/s, NPU sola 56, CPU+NPU 59.6** — non si sommano, ma **+36% di
> utilizzo aggregato** esiste.
>
> ✅ **L'UNICA PISTA VIVA: PREFILL DENSO SU NPU, ESPERTI SU CPU.**
> Numeri altrui su 8 Gen 3: PowerInfer-2 **770 tok/s** di prefill NPU su 7B
> INT4 (GPU 37, CPU 8); mllm-NPU sullo Xiaomi 14 **>1000 tok/s** su
> Qwen1.5-1.8B, 7.3-18.4× la CPU a prompt 1024. È la **terza conferma
> indipendente** dello stesso confine — acceleratori per il prefill, CPU per il
> decode — dopo la nostra misura GPU e i numeri di campo llama.cpp. E il nostro
> dolore è il system prompt da ~1.4k token, cioè prefill.
> 🎯 **La novità che sarebbe nostra: prefill NPU su un MoE che NON sta in RAM e
> streamma da flash.** Nessuno lo fa: PowerInfer-2 fa offload su flash e il
> decode gli crolla a 1.4-2.3 tok/s; mllm-NPU fa NPU ma su modelli piccoli
> tenuti in memoria. Noi abbiamo già la metà difficile. **E la Q7-landmine, che
> sul decode ci blocca, qui è la forma GIUSTA: denso sull'acceleratore,
> esperti su CPU.**
>
> 🔬 **VINCOLI DURI (fonti primarie, round 2):**
> - **La strada NON è QNN, è il backend Hexagon di llama.cpp.** QNN è a grafo
>   statico (prepare-once/execute-many) e **non esiste API pubblica per
>   aggiornare i pesi di un grafo finalizzato**. Il backend llama.cpp non ha
>   grafo: i pesi stanno in buffer rpcmem, `set_tensor` li riscrive — memcpy +
>   re-tiling, non 11 s di compilazione. Ed è aperto.
> - **`mllm-NPU` non è riusabile come speravo:** MIT ma **non include QNN**
>   (proprietario), gira su **v75**, il suo MoE è **CPU-only**, i telefoni nel
>   README oggi sono **8 Elite** (non il nostro Xiaomi 14), e carica un
>   **context binary compilato**: non gli passi i tuoi pesi a runtime.
> - **v73 (S23): VA del cDSP a 32 bit, tetto pratico ~2 GiB, `ndev` forzato a
>   1.** EuroSys 2026 su OnePlus Ace 3 (stesso 8 Gen 2): i 3B **non si
>   caricano**. v75 (Xiaomi 14) può aprire più sessioni.
> - **FastRPC #137, misurata su 8 Gen 2: `munmap` NON libera la VA del DSP**
>   finché non si fa `rpcmem_free`. Una finestra scorrevole da 1 GiB fallisce
>   appena la *storia* delle mappature supera 2 GiB.
> - **Costo per handover CPU↔HTP: NOT FOUND.** Nessuno l'ha pubblicato. È il
>   rischio aperto vero: denso-su-NPU/esperti-su-CPU è uno split **per layer**.
> - **Prefill tok/s su v73 con un quant supportato: NOT FOUND.** È il numero
>   che deciderebbe se l'S23 è un bersaglio, e non esiste al mondo.
>
> 💡 **IDEA DI gualt CHE RIAPRE L'S23 — e regge.** Il tetto dei 2 GiB è su
> **quanto mappi nella sessione**, non sulla taglia del modello. **LFM2.5-8B-A1B
> (3.1 GB su disco, 1B attivo)** con i soli **densi** mappati sta in qualche
> centinaio di MB: dentro con margine. E **sparisce anche FastRPC #137**, perché
> quel bug morde solo se fai ruotare i buffer: densi mappati **una volta e mai
> smappati** non perdono VA. Disegno: densi in sessione una volta, esperti che
> streammano su CPU come già fanno.
> ⚠️ **Da verificare prima di entusiasmarsi:** LFM2.5 è **ibrida**, non un
> transformer puro — le sue op devono essere fra quelle che il backend Hexagon
> esegue. Se i blocchi conv/ricorrenti rimbalzano su CPU il grafo si spezza in
> mille pezzi, ed è esattamente il rischio numero uno.
> 💡 **E il quant si risolve senza requantare il valore nostro:** serve un quant
> supportato (Q4_0/IQ4_NL/MXFP4) **solo per i tensori DENSI** — GGUF misto,
> esperti KEXP intatti su CPU; `llama-quantize` fa override per tipo di tensore.
> Abbiamo `Mellum2-12B Q4_K_M` su disco ma **Q4_K_M non è supportato**: è
> proprio il quant che ha reso vacua la misura S23.
>
> ⏭️ **NPU + GPU insieme: si può, ma DOPO.** Lo scheduler GGML elenca CPU,
> `GPUOpenCL` e `HTP0..HTP4` come device dello stesso grafo, e il +36% di banda
> aggregata è reale. Ma un grafo a tre vie, prima di conoscere il costo di UN
> handover, rende il risultato non attribuibile.
>
> 🔬 **MISURA NUOVA (18/08 sera, S23 Adreno 740, binario K2.2, via `adb shell`):
> IL KERNEL MoE OPENCL È ROTTO SU TUTTI I QUANT STRETTI — E IL DENSO NO.**
> `test-backend-ops test -b GPUOpenCL`, stessa sessione, stesso driver:
>
> | type_a | `MUL_MAT` denso | `MUL_MAT_ID` MoE |
> |---|---|---|
> | q4_0 | **46/46 OK** | **0 / 74 FAIL** (ERR 0.42-0.44) |
> | q4_1 | 35/35 OK | 0 / 75 FAIL (ERR 0.38) |
> | q4_K | 33/33 OK | 0 / 73 FAIL (ERR ~0.9) |
> | mxfp4 | 34/34 OK | 0 / 74 FAIL (ERR 0.34) |
> | q5_0/q5_1/q5_K | OK | FAIL (q5_0 ERR 0.10) |
> | q8_0 | 47/47 OK | **75/75 OK** |
> | q6_K | 4 OK / **10 FAIL** | **3/3 OK** |
>
> Soglia ERR = 0.0005, quindi 0.42 è spazzatura non arrotondamento. Fallisce a
> **ogni** forma — `n=1` (GEMV) e `n=32` (GEMM), `m=64` e `m=2880` — e il q6_K
> passa **sulle stesse forme** dove il q4_0 muore: **il discriminante è il quant,
> non la shape.**
> ✅ **Cosa esclude (è la parte utile):** NON è il driver e NON è un miscompile
> dei dequant subgroup-free — il q4_0 **denso** è perfetto sullo stesso silicio
> e compilatore. (L'ipotesi miscompile era vera per il port MLD/M1; **qui non si
> applica**.) NON è la matematica di dequant: lo stesso quant è corretto in un
> percorso e sbagliato nell'altro. ➡️ **Il difetto è nei kernel MoE.**
> 🎁 **E c'è un riferimento funzionante**: per lo stesso quant, sullo stesso
> hardware, il kernel denso dà il risultato giusto. Non si debugga al buio.
> 📌 I 10 FAIL del q6_K **denso** NON sono una regressione: è il kernel flat
> ancora rotto (K2.2 corresse il *dispatch* perché i tensori veri non ci
> finissero; K2.3 fu deprioritizzato). `test-backend-ops` genera forme che i
> modelli non producono. *Invariato* è la condizione di pass, non *migliorato*.
>
> 🧭 **KERNEL MoE ADRENO — LA PATCH ESISTEVA GIÀ, È STATA RIVISTA, COMPILATA E
> MISURATA SUL DEVICE (18/08 sera). RISULTATO: L'ERRORE SI DIMEZZA MA NON SPARISCE.**
>
> 🔴 **CORREZIONE DI UN FATTO SCRITTO QUI SOPRA: «l'albero llama.cpp è rimasto
> pulito (nessuna modifica), nessuno stato a metà» ERA FALSO.** `cvt.cl` porta
> mtime **18:45:16**, cioè **tre minuti DOPO** le 18:42 in cui avevo dato Grok per
> morto: era solo staccato e ha continuato a lavorare. Sul disco c'erano **82
> righe aggiunte e 117 tolte**, mai compilate e mai viste da nessuno.
> *(Intuizione di gualt, non mia: «probabile che Grok era staccato e ha continuato».)*
>
> **Cosa conteneva la patch — due fix per due cause diverse, non l'ipotesi unica:**
> - **(A) allineamento**: i load `ushort8` da `b->qs[0]` (offset 2/4/6/8/1 nei
>   rispettivi struct, quindi **mai** allineati a 16 byte) sostituiti da accessi
>   byte-wise, su q4_0/q4_1/q5_0/q5_1/mxfp4 + la ricostruzione byte-wise di `qh`.
> - **(B) layout q4_K/q5_K**: riscrittura da gruppi da 64 a sub-blocchi da 32.
>
> 🔬 **AUDIT OSTILE (DeepSeek V4 Flash, thinking max, hand-trace + simulazione
> numerica di tutti i quant contro la matematica reale dei consumer):**
> - **(A) CORRETTA** — byte-exact contro i kernel densi che passano 46/46, con
>   round-trip esatti; la ricostruzione `qh` è l'equivalente little-endian esatto
>   della `memcpy` della CPU, nessuna trappola di endianness o sign-extension.
> - **(B) SBAGLIATA E DISTRUTTIVA — il layout vecchio era GIÀ corretto** (simulazione
>   **256/256** valori giusti), il nuovo ne sbaglia **122/256 e 124/256**. La CPU
>   impacchetta il byte `32g+l` come `(L[64g+l], L[64g+32+l])`, quindi il loop
>   vecchio emetteva già i valori `[32·ib, 32·ib+32)` nei 16 byte che il consumer
>   legge; quello nuovo, per ogni `ib` dispari, pesca 16 valori indietro e dal
>   nibble sbagliato. **Prova indipendente: q6_K usa lo stesso windowing del vecchio
>   q4_K e passa 3/3 sul device.** ➡️ **Le hunk q4_K/q5_K sono state RIMOSSE**; delle
>   16 hunk ne restano **12**, tutte e sole di allineamento (55+/93−).
> 📌 **Errore mio da mettere a verbale:** avevo verificato che il consumer legge tile
> da 32 e concluso che «la direzione regge» — **un lato solo dell'uguaglianza**, senza
> controllare che il convert vecchio già li producesse. Compilando subito avrei rotto
> q4_K e q5_K, che erano sani.
> 📌 Effetto collaterale non dichiarato della patch: **l'intero file era stato
> riconvertito da LF a CRLF** (invisibile nel diff perché git normalizza). Riportato a LF.
>
> 📱 **MISURA SUL DEVICE (S23, `adb shell`, cpuset `/`, build NUOVA
> `build-android-opencl-s3fix`; `build-android-opencl-k2` intatta come riferimento):**
>
> 🧪 **CONTROLLO FATTO BENE, e la prima versione di questo blocco NON lo era.**
> Avevo confrontato il binario nuovo con `build-android-opencl-k2` (build del
> **12/08**): fra i due non c'è solo la patch, ci sono anche i commit intermedi —
> quindi quel confronto **non isolava la patch**. Rifatto compilando lo **stesso
> commit senza la patch** (`build-android-opencl-s3base`): unica variabile il file
> `cvt.cl`, **311 casi identici appaiati per nome del test**.
>
> | type_a | ERR baseline (stesso commit, NO patch) | **ERR con patch (A)** | Δ | n |
> |---|---|---|---|---|
> | q4_0 | 0.4080 | **0.1842** | **−54.9%** | 74 |
> | q4_1 | 0.4297 | **0.1907** | **−55.6%** | 73 |
> | mxfp4 | 0.3525 | **0.1654** | **−53.1%** | 74 |
> | q5_0 | 0.1161 | **0.0546** | −52.9% | 3 |
> | q5_1 | 0.0880 | **0.0479** | −45.6% | 3 |
> | **q4_K** *(non toccato — controllo)* | 0.8891 | 0.8879 | **−0.1%** | 80 |
> | **q5_K** *(non toccato — controllo)* | 0.9140 | 0.9362 | **+2.4%** | 4 |
> | q8_0 / q6_K | pass | **pass** | — | 75/75 · 3/3 |
>
> 📏 **RUMORE MISURATO, non stimato (18/08 22:45): stesso identico binario rilanciato
> due volte, 311 casi appaiati. `test-backend-ops` rigenera i dati a ogni run —
> **0 casi su 311 sono bit-identici**.**
>
> | quant | n casi | rumore sulla MEDIA | peggior caso SINGOLO |
> |---|---|---|---|
> | q4_0 / q4_1 / mxfp4 / q4_K | 73-80 | **0.1 – 1.3%** | fino a **172%** |
> | q5_0 / q5_1 / q5_K | 3-4 | **fino a ±14%** | 35% |
>
> ➡️ **Conseguenze, e una correzione a me stesso.** Avevo stimato il rumore a ±2-3%
> dai quant di controllo: **sovrastimato dove n è grande, sottostimato dove è piccolo.**
> - Su **q4_0/q4_1/mxfp4** il −55% è **~50× il rumore**: solidissimo. Anche il +19% di
>   peggioramento della variante no-alias su q4_0 è reale (190× il rumore di quel quant).
> - Su **q5_0/q5_1/q5_K le medie poggiano su 3-4 casi e ballano fino al 14%**: i loro
>   numeri vanno citati come indicativi, mai come misure.
> - **Nessun caso singolo è citabile** (fino al 172% di scostamento fra due run dello
>   stesso binario): si cita solo la media su n grande, mai una riga. ➡️ **Il dimezzamento
> è attribuito alla patch, non ai commit intermedi.**
>
> ➡️ **Quindi (A) era un difetto vero ed è ora chiuso — ma spiegava solo METÀ della
> corruzione.** Nessun caso passa: 0 su 311.
> ✅ **GATE, misurato e non dedotto — due terzi PASS, uno FAIL:**
> 1. ✅ **q8_0 e q6_K non regrediscono su MoE**: 75/75 e 3/3 in entrambe le build.
> 2. ✅ **Il denso resta identico**: `-o MUL_MAT` su entrambe le build dà **915 OK e
>    10 FAIL**, e l'insieme dei casi falliti è **lo stesso** (0 casi falliti solo in
>    una delle due). I 10 FAIL sono tutti `q6_K` denso — il kernel flat già noto come
>    rotto e già dichiarato non-regressione (K2.3 deprioritizzato), non un effetto
>    della patch.
> 3. ❌ **«q4_0 passa» NO**: 0 casi su 311 scendono sotto soglia, l'errore si dimezza
>    e basta.
>
> 🎯 **STATO: ESISTE UNA SECONDA CAUSA, ANCORA IGNOTA.** Colpisce tutti i quant
> stretti, risparmia q8_0 e q6_K, e si manifesta sia a `n=1` (GEMV) sia a `n=16/32`
> (GEMM). **Due ipotesi sono ora MORTE come spiegazione completa:** il load non
> allineato (fixato e misurato: metà) e il layout q4_K/q5_K (provato corretto).
> 🔎 Tre agenti in caccia su angoli disgiunti (data-path / dispatch host / sweep dei
> kernel di calcolo + classe del workaround `printf` Adreno).
> ⚠️ Sospetto già formalizzato e non ancora escluso: i kernel patchati replicano la
> matematica dei densi **senza** il `printf` che il commento di quelli dichiara
> obbligatorio; e il GEMM può usare il blob precompilato opaco
> `gemm_moe_q4_k_f32_ns_ila`, che un fix sorgente non tocca.
>
> 🌙 **NOTTE 18→19/08 — NOVE IPOTESI TESTATE SUL DEVICE, IL CONVERT È ESAURITO.**
> Ogni riga è una build compilata e misurata su S23 (in carica: irrilevante per ERR,
> vietato per tok/s), confronto appaiato per nome del caso contro
> `build-android-opencl-s3base` (stesso commit, senza patch).
>
> | # | esperimento | ERR q4_0 | esito |
> |---|---|---|---|
> | 0 | baseline (stesso commit, no patch) | 0.4080 | — |
> | 1 | **letture byte-wise** (fix allineamento) | **0.1842** | ✅ **tenuto: −55%** |
> | 2 | + `printf` di guardia Adreno | 0.4449 | ❌ peggiora |
> | 3 | shift/OR senza aliasing (`uint qw[4]`) | 0.2206 | ❌ peggiora |
> | 4 | riscrittura GLM (store byte-granulari diretti) | 0.1810 | ➖ invariato |
> | 5 | convert senza fast-math (`GGML_OPENCL_CVT_OPTS`) | 0.1888 | ➖ invariato |
> | 6 | convert `-cl-opt-disable` | — | ⛔ driver: `err=-6` out of host memory |
> | 7 | kernel MoE `-cl-opt-disable` | — | ⛔ 1 kernel non compila |
> | 8 | kernel MoE senza fast-math | 0.1809 | ➖ invariato |
> | 9 | allineamento immagini su subbuffer | — | ❌ **REFUTATA da misura** |
>
> 🔑 **Il fatto che ordina tutto: CINQUE forme diverse del convert danno tutte ~0.18.**
> Il difetto di allineamento (esperimento 1) era reale ed è chiuso; **il residuo non
> dipende più dal convert.** Le opzioni del compilatore non c'entrano né sui convert né
> sui consumer.
>
> ❌ **Ipotesi 9 (mia, elegante e sbagliata): i subbuffer non allineati per le immagini.**
> Il codice upstream porta il dubbio scritto — *"Does this create misaligned subbuffers
> (alignment is 1024) in certain cases ?"* — e `CL_DEVICE_IMAGE_BASE_ADDRESS_ALIGNMENT`
> non è **mai** interrogato, pur creando immagini 1D su subbuffer in 9 punti. Misurato sul
> device: **image align = 64 B contro mem align = 128 B**, quindi i subbuffer sono già
> conformi. Refutata in una query invece che in una notte.
>
> 🛠️ **Strumenti costruiti stanotte, che restano:** due hook a variabile d'ambiente
> (`GGML_OPENCL_CVT_OPTS`, `GGML_OPENCL_MOE_OPTS`) che ricompilano i program con opzioni
> diverse **senza rebuildare il binario**; e un ramo `GGML_OPENCL_HOST_REPACK` che
> costruisce i buffer SoA sulla **CPU**, bypassando il convert — è l'esperimento che
> separa produttore e consumatore in modo definitivo.
>
> ⚠️ **Limite di piattaforma incontrato:** opencode-go ha un tetto di utilizzo a 5 ore;
> DeepSeek/GLM/Kimi tornano disponibili dopo il reset. Grok è su un altro provider.
>
> 🧨 **19/08 09:20 — IL PARADOSSO È SCIOLTO, E RIBALTA LA LETTURA DEL −55%.
> I CONSUMER SONO ROTTI; IL CONVERT ERA IL DIFETTO PIÙ PICCOLO DEI DUE.**
>
> ⚠️ **CORREZIONE ALLA NARRAZIONE DEL COMMIT `9dc1ec0cb`: il −55% NON è «il convert
> riparato». Sono DUE difetti che si compensano a vicenda.** La corruzione del produttore
> compensa parzialmente quella del consumatore; togliendo solo la prima, il risultato
> peggiora. Il guadagno è reale, misurato e riproducibile — ma la spiegazione era sbagliata.
>
> 🔑 **L'esperimento che decide era già agli atti: `GGML_OPENCL_HOST_REPACK=1`** costruisce
> i buffer SoA **sulla CPU**, byte-exact per costruzione, senza alcun convert GPU nel
> percorso. **Fallisce comunque: q4_0 media 0.4497** (GEMV n=1 0.4440, GEMM 0.4508).
> ➡️ Con un produttore fuori dal gioco, l'errore resta: **il difetto vincolante è nei
> kernel di calcolo compilati**, in ENTRAMBI i path.
> 🎯 **La prova più netta sta dentro un singolo run** (hostrepack): q4_0 con buffer
> **perfetto** fallisce a **0.450**, mentre **q4_1 nello stesso run**, con buffer corrotto
> byte-wise e gli stessi identici consumer, fallisce a **0.189**.
>
> 📊 **L'errore end-to-end NON è monotono nella correttezza del buffer** — tre cluster netti:
>
> | buffer q4_0 | mismatch vs oracolo | ERR end-to-end |
> |---|---|---|
> | byte-wise (viola il contratto) | 46% dei word alti | **0.184-0.193** |
> | bitselect / host-repack (byte-exact) | **0%** | 0.438-0.450 |
> | originale `ushort8` non allineato | — | 0.408 |
> | nessun un-shuffle (copia diretta) | — | 0.444 |
>
> ✅ **Cosa è PROVATO (tre derivazioni indipendenti: DeepSeek, Grok, GLM, più la mia):**
> il contratto **`valore k → word ⌊k/8⌋, nibble k%8`**; GEMV e GEMM **concordano**; l'immagine
> `q_img` è creata sullo **stesso `cl_mem`** del buffer; i blob precompilati sono **compilati
> fuori**; il layout CPU (`qs[j]` → valore `j` basso, `j+16` alto); **il reference host è
> corretto e non va toccato**; q6_K 3/3 e q8_0 75/75 passano in ogni run.
> 🔍 **Cosa resta INFERITO:** il trigger `x0 ≥ 0x80` con shift aritmetico (regge su 16/16
> byte e sul 46.1%); la natura cross-lane del difetto consumer.
>
> 🧭 **ORDINE DEGLI ESPERIMENTI RACCOMANDATO (una variabile per volta):**
> 1. **Oracolo LATO CONSUMER — è lo strumento che manca.** Un kernel di debug che legge
>    `extra->q` secondo il contratto e scrive i float dequantizzati usando **verbatim** la
>    macro `dequantize_q4_0` e l'helper `q4_0_to_fp32_packed8`; confronto host contro
>    `dequantize_row_q4_0`. Con `HOST_REPACK=1` prova l'idioma del consumer su input
>    noto-buono, **scollegato da dispatch, riduzioni subgroup e router**.
> 2. Riscrivere la macro `dequantize_q4_0` del GEMM (e l'helper GEMV) a **shift-poi-maschera**
>    con `HOST_REPACK=1` + bitselect. Se l'oracolo passa ma l'end-to-end no, il difetto è
>    nella riduzione o nel path di `dst`.
> 3. Isolare **GEMV n=1** (12 casi, niente router) con host-repack: il check end-to-end
>    più pulito.
> 4. Solo allora riattivare il convert GPU e rifare l'intero set, tenendo q6_K, q8_0 e il
>    denso come controlli di regressione e la disciplina di `compare_runs.py`.
>
> 📌 **Stato dell'albero:** committato `9dc1ec0cb` (llama.cpp) con la variante byte-wise —
> la migliore misurata — più i tre hook diagnostici. Le varianti bitselect / copia-diretta /
> printf **non** sono nell'albero: vivono solo nel registro qui sopra.
>
> ✅ **JELLY — SESSIONI LUNGHE RIPRISTINATE (19/08 09:16). NIENTE ERA STATO PERSO DA GIT.**
> L'archeologia (DeepSeek) dimostra che **nessun meccanismo è mai stato rimosso**: heartbeat,
> pulse nei cooldown e watchdog con rilancio furono **aggiunti** il 17-18/08 per i drop-sweep
> e **mai portati** negli orchestratori KEXP/REAP/TTFT, che sono ancora `ssh` sincrono per
> cella, senza detach né resume. Quello che l'owner ricordava funzionava **lì**.
> 🔑 **La tecnologia che mancava:** sugli altri due telefoni lo schermo si tiene acceso **via
> adb**; da Termux la stessa chiamata è **rifiutata** (`INTERACT_ACROSS_USERS`, documentato in
> `results/dropsweep_jelly/REPORT.md:113`). Sul Jelly non era mai stata applicata perché ci
> si arriva via ssh — **ma il Jelly è collegato in adb** (`JELLYS0000053795`).
> **Applicato:** `settings put system screen_off_timeout 7200000` (era 1800000),
> `svc power stayon true`, `input keyevent KEYCODE_WAKEUP` → `mWakefulness=Awake`.
> **Misura:** heartbeat staccato (`setsid nohup`, battito ogni 15 s) **vivo a 26 min 53 s**
> e ancora in corso, contro i ~20 min oltre i quali finora moriva. ⚠️ Prova preliminare: la
> conferma piena è ≥60 min. ⚠️ Il Jelly era **in carica** (88%): buono per un test di
> sopravvivenza, **inutilizzabile per tok/s**.
>
> 🌅 **MATTINA 19/08 — IL CONTRATTO È CONFERMATO DA DUE DERIVAZIONI INDIPENDENTI,
> E IL GUADAGNO STABILE È −55%.**
>
> | quant | baseline (stesso commit, no patch) | **con la patch** | Δ | n |
> |---|---|---|---|---|
> | q4_0 | 0.4080 | **0.1857** | **−54.5%** | 74 |
> | q4_1 | 0.4297 | **0.1885** | **−56.1%** | 73 |
> | mxfp4 | 0.3525 | **0.1671** | **−52.6%** | 74 |
> | q5_0 / q5_1 | 0.1161 / 0.0880 | 0.0568 / 0.0532 | −51% / −40% | 3+3 |
> | **q4_K / q5_K** *(non toccati — controllo)* | 0.8891 / 0.9140 | 0.9002 / 0.9133 | **+1.2% / −0.1%** | 80+4 |
>
> ✅ **CONTRATTO DI LAYOUT: CONFERMATO.** Due derivazioni indipendenti (DeepSeek e Grok)
> più la mia, tutte dai **consumer** e non dai commenti, concordano: **valore `k` sta nel
> word `k/8`, nibble `k%8`**; `qs[j]` della CPU porta il valore `j` nel nibble basso e
> `j+16` nell'alto; GEMV e GEMM **vogliono lo stesso layout** (il GEMM legge un'immagine
> che aliasa lo stesso buffer). ➡️ Il mio reference host è corretto e **non va toccato**:
> è l'oracolo con cui si giudica ogni esperimento.
>
> 🔬 **MECCANISMO DEL DIFETTO, misurato:** la corruzione avviene **se e solo se il byte
> sorgente è ≥ 0x80** (16 casi su 16), con firma `got = want | 0xF0`. Il compilatore
> esegue uno shift **aritmetico** su un valore mascherato il cui bit 7 è settato, e il
> segno smaglia il nibble adiacente. Una maschera successiva **non salva**: viene rimossa
> come codice morto, perché l'analisi known-bits assume lo shift logico che il bug viola.
> 📌 È lo stesso pattern che distingue i kernel che passano da quelli che falliscono:
> `q6_K` (3/3 OK) usa **shift-poi-maschera**, i quant rotti usavano **maschera-poi-shift**.
>
> ❓ **PARADOSSO ANCORA APERTO, da non nascondere.** Una variante `bitselect` produce un
> buffer **byte per byte identico al reference** (`BUFFER MATCHES HOST REFERENCE`,
> `low wrong=0 | high wrong=0`) e **peggiora** l'end-to-end (0.4378 contro 0.4080 di
> baseline). Con un produttore verificato corretto il risultato peggiora: il buffer non
> può essere l'unica cosa che conta. Ipotesi in coda: **coerenza di memoria** — il
> readback lo fa l'host con `clEnqueueReadBuffer`, il consumer legge un'**immagine**
> costruita sul buffer, e le scritture `vstore4` potrebbero non essere visibili per quel
> percorso. ⚠️ Finché non è spiegato, `bitselect` **non si spedisce**.
>
> 🔻 **Ipotesi morte, tutte con misura:** load non allineato (era vero, −55%, tenuto) ·
> layout q4_K (era già giusto) · `printf` Adreno (peggiora) · aliasing scalare (peggiora) ·
> riscrittura a store byte-granulari (invariata) · opzioni del compilatore su convert e su
> consumer (invariate) · allineamento immagini (image align 64 B < mem align 128 B) ·
> `bitselect` (buffer corretto ma e2e peggiore) · shift-poi-maschera nei consumer
> (ininfluente: q4_0 con consumer fixato misura come q4_1 senza).
>
> 🎯 **Gate:** q8_0 75/75 e q6_K 3/3 **non regrediscono**; il denso resta **915 OK / 10
> FAIL identici**. ❌ Nessun quant scende sotto 5e-4: l'errore si dimezza, non sparisce.
>
> 🔧 Si lavora su **`kalsa/kernel-s3-repack`**, che discende già da
> `opencl-q6k-dispatch-fix` (merge-base 04c5d362a, zero commit esclusivi): la fix
> nuova si impila sulla vecchia, niente due patch parallele — requisito di gualt.
>
> ➡️ **PRIMO PASSO (non è codice):** (a) verificare la copertura op Hexagon per
> l'architettura LFM2.5; (b) produrre il GGUF misto coi soli densi in Q4_0;
> (c) **misurare noi il numero che manca al mondo** — prefill HTP vs CPU vs GPU
> sullo stesso telefono. Se l'NPU non batte la GPU che già abbiamo a 3.2-7×, la
> pista si chiude con una cifra nostra invece che con un'assenza.
> ✅ **Decode invariato: GPU 0.66× (17.5 contro 26.5), gate FAIL.** Stessa
> conclusione qualitativa di prima, con entrambi i lati più veloci del
> report storico.
>
> 🧪 **BRACCIO RANDOM — CODICE PRONTO E RIVISTO (18/08). Grok implementa,
> DeepSeek attacca, io verifico.**
>
> `--drop-policy {cold|weight|random}` + `--drop-seed`, build isolata in
> `build-pc-droppolicy/`. **Binario pinnato verificato intatto da me:**
> sha `7722cb23…d75d52` = `expected_binary_sha256`, mtime ancora 14/08.
>
> ✅ **Il controllo regge:** `cold` è **bit-identico** al codice precedente
> (verificato da me sul diff — è la stessa espressione spostata nel ramo
> `else` — e dal revisore anche empiricamente). Tutti i miei sospetti
> REFUTATI con prove: `kept` del ramo random equivalente (legge `drop_w_`
> pre-drop, array diverso da quello scritto), `drop_res_` stantio **senza
> lettori** sotto Weight, RNG con **un solo** chiamante (niente re-seed a
> metà run), Fisher-Yates uniforme e senza OOB, **conteggio random ==
> conteggio cold verificato su 60.000 casi**.
>
> 🌿 **BRANCH SBAGLIATO — la causa vera del fallimento del primo tentativo
> (18/08). E una mia affermazione allarmista, ritirata.**
>
> Il primo braccio è morto in 11 s con `unknown arg: --no-moe-fused-gemv`,
> che l'harness passa via `--stock-kernel`. Indagando avevo detto a gualt
> che *"l'albero che ha prodotto il binario pinnato non è ricostruibile"*.
> **FALSO, e l'errore è mio: stavo guardando solo `main`.**
>
> **Provenienza del binario PC di campagna, ricostruita:**
> - `build-pc-mellum-ppl/cli/bmoe-cli.exe` sha `7722cb23…`, mtime
>   **14/08 01:58** (`reports/moe-mellum2-f1-s23.md:532`: *"mellum recipe +
>   fused flags forced OFF"*).
> - I flag `--moe-fused-gemv` / `--moe-fused-ffn` nascono in `93d78ab` e
>   `0c54a27`, **13/08 19:01 e 19:59** — cioè poche ore prima della build.
> - Stanno su **`kalsa/kernel-s1-expert-pack`** e
>   **`kalsa/kernel-s2-layer-fuse`**, entrambi con ANCHE la ricetta mellum.
> - **`kalsa/kernel-s2-layer-fuse` = `main` + 3 commit** (`main..s2` = 3,
>   `s2..main` = **0**: main è suo antenato).
> ➡️ **Il binario di campagna viene da `kalsa/kernel-s2-layer-fuse`.**
>
> ❌ **Grok ha applicato `--drop-policy` su `main`**, che è indietro di 3
> commit e non ha i kernel fusi. Da lì il rifiuto del flag.
> ✅ **Rimedio: riapplicare la patch su `kalsa/kernel-s2-layer-fuse` e
> ricompilare.** Così `cold` torna a essere un controllo vero, sulla
> stessa linea del binario di campagna e con gli stessi flag.
>
> 📌 **Nota di metodo, per non ripeterla:** `strings` sull'exe restituisce
> **zero righe** (non estrae dal PE) e mi aveva dato un falso negativo che
> ho quasi usato come prova. Il test valido è stato lanciare il binario
> con il flag e con un flag inventato: accetta il primo, rifiuta il
> secondo. **Verificare lo strumento prima di credere al suo silenzio.**
>
> 🚨 **F1 [CONFERMATO, sev 2] — VINCOLO CHE CAMBIA IL DISEGNO:** nel
> changeset è finito anche uno spostamento del submodule `llama.cpp`
> (`e5605f3` → `8d3c2ea`: due commit di matmul CPU, **lo strato che decide
> gli arrotondamenti**). Codice bit-identico ≠ output bit-identico.
> ➡️ **I numeri di `build-pc-droppolicy` NON sono confrontabili con quelli
> del binario pinnato.** L'esperimento dev'essere autosufficiente: il
> braccio `cold` va girato NEL BINARIO NUOVO come controllo, e **non si
> confronta mai con la curva esistente** (0.6780748 ecc.).
>
> ⚠️ **F2 [plausibile, sev 2]:** `settle_spec()` gira anche sotto Weight,
> quindi quel braccio non azzera tutta la tassa. Il revisore è però equo:
> `query_residency` — la scansione per-slot, la parte dominante — **è
> rimossa davvero**, e `settle_spec` gira in ENTRAMBI i bracci, quindi il
> delta cold-vs-weight isola comunque la query. **Vincolo di scrittura:
> non si potrà dire "la query è il 100% della tassa".**
> 📌 **F3 [sev 4]:** `std::uniform_int_distribution` non è portabile fra
> toolchain — stesso seed su PC e su Android può dare esperti diversi.
> Irrilevante finché si confronta dentro una sola piattaforma; da dire se
> un giorno si riproduce su device un run del PC.
>
> 📊 **DROP-POLICY QUALITY — DUE BRACCI SU QUATTRO CHIUSI (18/08, Marco-Mini
> KEXP, k=6, cache 2000, ppl decode multi5).**
>
> 🏷️ **RISULTATO PRE-REGISTRATO CENTRATO: `cold` ≪ `random`. LA QUERY DI
> RESIDENCY COMPRA QUALITÀ, NON È SOLO COSTO.**
>
> ⚠️ **CORREZIONE DI PROVENIENZA (mia, importante).** Avevo scritto qui e
> detto a gualt che questa cella gira su `build-pc-droppolicy-s2` sha
> `262701dc32a96254` con `--stock-kernel`. **Falso.** I tre `*_multi5.json`
> registrano tutti `build-pc-droppolicy` sha **`59f2762e54ed56af`** (la build
> da `main`) e **nessun** flag `--no-moe-fused-*`. Motivo: l'orchestratore è
> partito alle **08:29:51**, il binario s2 è stato compilato alle **08:52** —
> PowerShell aveva già letto la versione precedente dello script. ✅ **La
> cella resta valida per la sua domanda**: i tre bracci condividono binario,
> flag e modello. ❌ Non è confrontabile con la campagna né con Mellum2/
> CalaQwen. *Lezione: il binario vero si legge dal JSON del run, non dallo
> script — lo script può essere cambiato dopo il lancio.*
>
> ✅ **COMPLETO SU 5 LINGUE (18/08 17:01).** `dp_rand_d10` era morto a 3/5
> (`bmoe: pread failed at 5783089152` durante `it`, rc=1) trascinandosi dietro
> l'orchestratore; `it`/`zh` sono stati rifatti in una cella separata
> (`dp_rand_d10_itzh`, `--langs it,zh`, stesso binario `59f2762e54ed56af`,
> rc=0) perché l'harness non ha resume per-lingua. Le due metà si uniscono:
> ogni lingua è una misura indipendente sullo stesso binario e modello.
>
> | lingua | d0 | cold d=1.0 | random d=1.0 | cold vs d0 | random vs d0 |
> |---|---|---|---|---|---|
> | en | 0.640213 | 0.706213 | 0.745753 | +10.31% | +16.49% |
> | es | 0.705789 | 0.782259 | 0.837969 | +10.83% | +18.73% |
> | fr | 0.756660 | 0.861962 | 0.922563 | +13.92% | +21.93% |
> | it | 0.785352 | 0.879999 | 0.954762 | +12.05% | +21.57% |
> | zh | 0.944656 | 1.077903 | 1.128981 | +14.11% | +19.51% |
> | **MACRO** | **0.766534** | **0.861667** | **0.918006** | **+12.41%** | **+19.76%** |
>
> ➡️ **`random` è peggiore di `cold` di +6.54% bpb (+0.0563 bpb)** — un delta
> che da solo **supera l'intero gate MACRO_PASS di 0.04**. Concorde in **tutte
> e cinque** le lingue. 📌 L'anticipazione fatta sulle prime 3 lingue diceva
> +6.63%: la stima parziale ha retto a 0.1 punti.
> La lettura era dichiarata prima dei numeri: *«cold ≪ random → "scegliere i
> freddi" è un risultato vero da nominare»*. È il ramo che è uscito.
> **Conseguenza: la condizione (b), la query di residency, NON è pura tassa da
> rimuovere sull'asse velocità** — a parità di quanti esperti cadono, sceglie
> molto meglio QUALI. Chi proponeva di eliminarla per recuperare il compute
> della tassa d'armamento stava proponendo di pagare 6.5% di qualità.
>
> | arm | macro bpb (5 lingue) | Δ vs dp_d0 | slot droppati |
> |---|---|---|---|
> | `dp_d0` (macchinario spento) | 0.766534 | — | 0 |
> | `dp_cold_d10` (regola di oggi, d=1.0) | 0.861667 | **+0.0951 / +12.41%** | **32.6%** |
> | `dp_rand_d10` (+ `_itzh`) | 0.918006 | **+0.1515 / +19.76%** | **28.6%** |
> | `dp_weight_d10` | **1.317696** | **+0.5512 / +71.90%** | **61.9%** |
>
> ✅ **CELLA CHIUSA A 4 BRACCI (18/08 18:43 — `OK dp_weight_d10
> macro_bpb=1.31769604986121`, tutte e 5 le lingue rc=0).** Binario, modello,
> thread, ctx, ubatch, cache e `--n-expert-used` sono **identici in tutte e cinque
> le celle**, verificati dai JSON dei run e non dagli script: `59f2762e54ed56af` /
> `2f92195854011538`. L'unica variabile è `--drop-policy`.
>
> 🔴 **RITIRATO — «weight droppa il 63.4% degli slot contro il 46.9% di `cold`».
> IL 46.9% NON ERA MISURATO E NON ESISTE IN NESSUN DATO DEL REPO.** Quei due numeri
> comparivano **solo** in questa riga del PLAN e nella sua copia in
> `docs/ALIVE.md:232`, con la parola «misurato». **Non potevano esserlo:** il path
> `--ppl-decode` stampa unicamente `BMOE_PPL {n_tokens,n_scored,sum_logprob,ppl,
> seconds}` e **nessun** contatore di drop, e gli `harness.err.log` della cella sono
> **0 byte**. Stessa classe dell'errore già a verbale sul commento circolare in
> `run_droppolicy_quality.ps1:44`: una cifra nata in prosa e poi citata come dato.
>
> ✅ **MISURATO ORA (18/08 19:00, `results/droppolicy_quality_marco/droprate/`).**
> Stesso binario `59f2762e54ed56af`, stessa config della cella, 300 token generati,
> una run per policy; il path di generazione stampa
> `moe-drop: N/M routed experts dropped (X%)` (`cli/main.cpp:1079`):
>
> | policy | slot droppati / instradati | frazione |
> |---|---|---|
> | `cold` | 16427 / 50400 | **32.6%** |
> | `weight` | 31217 / 50400 | **61.9%** |
> | `random` | 14395 / 50400 | **28.6%** |
>
> ➡️ **Il rapporto vero è 1.90×, non 1.35×: `weight` droppa quasi il DOPPIO di
> `cold`.** Il 61.9% conferma il vecchio 63.4%; **è il 46.9% attribuito a `cold` a
> essere falso** — il valore reale, 32.6%, è coerente con l'unica altra misura
> indipendente nel repo (`dropsweep_jelly`: `experts_routed=33600
> experts_dropped=9986` → **29.7%**), che il PLAN stesso cita altrove.
> ⚠️ **Workload dichiarato: generazione, non `--ppl-decode`** — gli assoluti non sono
> quelli della cella di qualità; ciò che serve è il **rapporto fra policy a parità di
> setup**, ed è quello misurato.
>
> ➡️ **Conseguenza sulla lettura di `weight`: il suo +71.90% NON dimostra che la query
> di residency batte la soglia di peso.** Ha corso con un handicap quasi doppio. E dal
> codice le due regole non sono alternative ma **inclusive** (`router_hook.cpp:300-306`):
> con `thr = drop_frac/nu` = **1/6**, `weight` droppa ogni non-best sotto soglia, `cold`
> **solo il sottoinsieme** di quelli che sono anche non residenti. **Weight ⊇ Cold per
> costruzione**, quindi un confronto like-for-like fra i due **non è ottenibile a parità
> di `d`**. L'unico confronto a conteggio confrontabile resta **cold-vs-random**, ed è
> quello su cui poggia il risultato della cella.
>
> 🔍 **Anche `random` è like-for-like solo PER-TOKEN, non a run intera.** Il codice pesca
> esattamente `n_cold` slot (`router_hook.cpp:268-274`), ma misurato dà **28.6% contro il
> 32.6% di `cold`**: appena le due run divergono generano testo diverso e riempiono la
> cache in modo diverso, quindi `route_miss` — e con esso `n_cold` — diverge. L'identità
> di conteggio vale **all'istante della decisione**, non sull'aggregato. Non tocca il
> +6.54% (in `--ppl-decode` il testo è imposto dal corpus e non può divergere), ma la
> frase «stesso conteggio» **va detta per-token**, mai come proprietà della cella.
>
> 🚢 **DECISIONE OWNER (18/08, a chiusura cella): SI SPEDISCE `cold`; IL LIVELLO È
> PER-MODELLO. Tre assi da non fondere in una regola sola:**
> 1. **Quale policy → `cold`, e non dipende da nulla.** Batte `random` in **5 lingue su
>    5**; `weight` e `random` esistono solo come strumenti diagnostici, non come config.
> 2. **Quanto droppare → per-modello, sulla QUALITÀ.** Marco a d=1.0 costa **+12.41%** e
>    spedisce quindi **d=0.0**; CalaQwen costa **+3.96%** e spedisce **d=1.0 +
>    `--drop-no-renorm`**. Stesso flag, stesso livello, verdetto opposto.
> 3. ⚠️ **La CONVENIENZA in velocità dipende invece da device e RAM, e resta vero.**
>    Sul Jelly a cache 4000 il drop **fa danno** (+15%) mentre a 1500/2000 rende −25%;
>    sull'S23 non si ribalta mai (−2/−6%). **L'ipotesi «dipende dal modello e non da
>    RAM/processore» è corretta sulla qualità e smentita sulla velocità**: sono due assi
>    distinti e vanno citati separatamente.
>
> 🔧 **CORREZIONE MIA, DA METTERE A VERBALE.** Avevo scritto a gualt che quel
> +12.41% «riproduce esattamente il valore di campagna di Marco a d=1.0 con
> renorm». **Falso: quella corroborazione non esiste nei dati.** L'unica fonte
> del +12.41% pre-esistente è un commento di intestazione che ho scritto io in
> `scripts/run_droppolicy_quality.ps1:44` — citarlo come conferma era
> circolare. In `results/` **non c'è nessuna misura Marco k6 d=1.0** anteriore
> a questa cella. Da correggere anche quel commento (a cella finita: il file
> è in esecuzione).
>
> ✅ **Ciò che regge davvero:** i due numeri sopra sono misurati nella STESSA
> cella sullo STESSO binario, quindi il +12.41% è valido come sta. E la
> premessa di disegno («Marco è dove il drop morde di più») è confermata dai
> dati nuovi, non da una misura precedente: le altre due curve di campagna a
> d=1.0 costano molto meno — **Mellum2 +5.09%** (1.0073390 → 1.0586322,
> `results/mellum2_dropcurve/curve.csv`) e **CalaQwen +3.96%** (0.6780748 →
> 0.7049320). ⚠️ E ricordare che **Mellum2 ≠ Marco**: è il termometro PPL del
> PC (`docs/NAMING.md:31`), un modello diverso — la curva `mellum2_dropcurve`
> non è la curva di Marco.
>
> 🔥 **CACHE × DROP — LA SCOPERTA CHE RIMETTE IN DISCUSSIONE IL DEFAULT
> APPENA DECISO (18/08, round 1 di 3, Marco-Mini su Jelly).**
>
> 📈 **CURVA A TRE PUNTI (Marco-Mini, 3 round per cella, tutte complete) —
> E IL MIGLIOR NUMERO IN ASSOLUTO NON CONTIENE IL DROP.**
>
> | cache | hit a d=0 | **d=0.0** | col drop | vantaggio drop |
> |---|---|---|---|---|
> | 1500 | 39.5% | 0.189-0.194 | 0.142-0.145 | **−25%** |
> | 2000 | 50.2% | 0.163-0.171 | 0.123-0.127 | **−25%** |
> | 4000 | 76.8% | **0.113-0.116** | 0.130-0.131 | **+15%** |
>
> 🏆 **Il minimo assoluto è `0.113` — cache 4000 SENZA drop.** Batte cache
> 2000 col drop (0.124) del 9%, **e costa ZERO qualità** invece del +5.71%
> che il drop costa su Marco. Cioè: **dargli RAM è meglio che togliergli
> esperti**, dove la RAM c'è.
> Il drop resta la leva giusta **solo dove la RAM non c'è** — ed è
> esattamente il segmento in cui sta LFM2.5 (3.3 GB).
>
> ⚠️ **Artefatto ricorrente da mettere a verbale: il braccio col drop ha
> run sporadiche col compute gonfiato**, quello senza drop no. Due casi su
> nove: c4000 r1 (compute 0.194 contro 0.117 delle altre due) e c1500 r3
> (0.143 contro 0.116). Il baseline d=0.0 è invece stabile in tutte e tre
> le celle. **Conseguenza: le medie del braccio drop sono meno affidabili
> di quelle del baseline**, e vanno lette per mediana con i round mostrati
> uno per uno, non aggregate.
>
> **CELLA CACHE 4000, COMPLETA 3/3.**
>
> | | cache 2000 (sempre usata) | **cache 4000** |
> |---|---|---|
> | d=0.0 — s/tok | 0.166 | **0.113 (−32%)** |
> | d=0.0 — hit | 50.2% | **76.8%** |
> | d=0.0 — byte letti | 11803 MiB | **3366 MiB (−71%)** |
> | **d=1.0+nr vs d=0.0** | **−24.9% (più veloce)** | **+15% (più LENTO)** |
>
> ⚠️ **CORREZIONE DI UN MIO NUMERO: il "+87%" era un OUTLIER, non il
> risultato.** Round per round: r1 +87%, **r2 +16%, r3 +15%**. r2 e r3
> coincidono (0.131 / 0.130) e girano a 29-32 °C; r1 girò a 34 °C col
> compute gonfiato (0.194 contro 0.117) ed era la prima run dopo il
> riavvio dell'harness. **Il valore onesto è +15%.** Avevo scritto a gualt
> "un +87% non è rumore": era troppo sicuro su un round singolo, ed è
> esattamente l'errore contro cui esiste il disegno a 3 round.
> **La conclusione qualitativa NON cambia** — a cache 4000 il drop fa
> danno — ma l'oscillazione da −24.9% a +15% è di ~40 punti, non di 110.
>
> **Due risultati, e il secondo ribalta una decisione presa oggi.**
>
> 1. **Alzare la cache da 2000 a 4000 dà −32% di tempo A QUALITÀ IDENTICA.**
>    Non tocca nessun esperto, non cambia un token di output: tiene in RAM
>    ciò che prima rileggeva dalla flash.
>
>    🔧 **CORREZIONE: avevo scritto "non l'avevamo mai guardato". FALSO, e
>    la fonte è dentro il nostro engine.** `BigMoeOnEdge/docs/cache-sizing.md`
>    apre con *«The expert cache budget (`--cache-mb`) is the **dominant
>    throughput lever**»* ed esiste già **`--cache-mb auto`**, che la
>    dimensiona sulla RAM del device una volta al load
>    (`available RAM − cache_floor_mb`, clampata). Quel documento descrive
>    anche una **scogliera misurata il 2026-07-20**: sotto il ciclo di un
>    token l'hit rate non degrada, **va esattamente a 0.0%** — perché la LRU
>    globale sfratta proprio ciò che sta per rileggere.
>    **Quello che è nuovo NON è la leva cache: è la sua INTERAZIONE col
>    drop** — che al variare della cache il drop cambi *segno*. Di questo
>    in `cache-sizing.md` non c'è traccia. Rivendicare il resto sarebbe
>    riscoprire il lavoro di qualcun altro e chiamarlo mio.
>
>    ⚠️ **E una trappola operativa, dal documento stesso:** il pavimento
>    `cache_min_mb = 1500` **non è calcolato sul modello** — è generico. La
>    quantità vera è `token_demand_MiB` (il ciclo di un token), stampato in
>    ogni riga di summary: **Marco = 136.8 MiB**, CalaQwen = 334.5. Quindi
>    per Marco 1500 ha 11× di margine, ma per un modello con k più alto il
>    pavimento può stare SOTTO il ciclo e la protezione smette di
>    proteggere in silenzio. *Quando si sceglie una cache a mano, si
>    confronta con `token_demand_MiB`, non con `cache_min_mb`.*
> 2. **A cache 4000 il drop diventa DANNOSO, non solo inutile: +87%.** La
>    mia predizione dichiarata era "il vantaggio si restringe". **Non si è
>    ristretto: si è invertito.** È il meccanismo di stanotte al suo
>    estremo — con hit al 76.8% non stai più aspettando il disco, quindi la
>    tassa fissa di compute del drop non ha più nulla da ripagare.
>
> ⚠️ **Conseguenza diretta: il default B deciso oggi è l'ottimo a cache
> 2000, e la cache non è una costante di natura — è un budget di RAM.**
> Va rifatto su CalaQwen prima di considerare chiusa la decisione.
>
> ❓ **QUESTIONE APERTA SULLE CELLE S23 (18/08 pomeriggio): SU QUALI CORE
> HANNO GIRATO? NON LO SAPPIAMO, E IL CSV NON PUÒ DIRLO.**
> `run_dropsweep_jelly.sh` non scriveva `nproc`/`affinity_mask` (gate F4.3-bis
> assente: vedi il fix di oggi). Quindi la domanda è **indecidibile a
> posteriori** su queste tre celle.
> ⚠️ **DUE MIE CONCLUSIONI RITIRATE, STESSO IDENTICO ERRORE DUE VOLTE:**
> (1) ho sondato una shell ssh **idle** e concluso sul processo misurato;
> (2) ho sondato col telefono in **`mWakefulness=Dozing`** (schermo spento) e
> concluso sulle celle, che per protocollo di campagna girano **screen-ON**
> (deciso da gualt il 2026-08-13, a verbale più in basso). Entrambe le volte
> ho misurato una condizione e concluso su un'altra. È la stessa trappola del
> **"flagship dimezzato" dello Xiaomi**, che era Doze e non throttle.
> 📌 Fatto misurato che resta valido: col telefono in Doze i processi Termux
> stanno su **tre cpuset diversi contemporaneamente** — `/` (adj −1000),
> `/background` (adj 995), `/moderate` (adj 200, `Cpus_allowed_list 0-2`).
> Il cpuset è **per-processo e per-stato**, non una proprietà dell'app: per
> questo l'unica lettura che conta è quella sul **PID del binario mentre
> gira**, ed è esattamente ciò che la covariata nuova registra.
> 📌 Misurato anche: `termux-wake-lock` **non** promuove il cpuset (sonda in
> tre tempi, sempre `/moderate`) — ma in Doze, quindi non dice nulla sul caso
> screen-on. Conseguenza operativa comunque valida: **il wait-and-retry del
> gate è tempo morto**, la scatola non si apre aspettando.
> ➡️ **Come si chiude:** riaccendere lo schermo nella postura di campagna e
> risondare; e comunque **rifare le tre celle con l'harness nuovo**, che
> scrive la covariata. Stessa verifica sul Jelly appena torna: **stesso
> harness, stesso buco**, e su quelle celle poggia il default spedito.
>
> ✅ **SONDA JELLY FATTA (18/08 22:40, Jelly riacceso, `u0_a225@192.168.1.82:8022`).
> IL JELLY NON HA IL PROBLEMA: `/top-app`, `Cpus_allowed_list 0-7`, `nproc=8`.**
> Sondato **come va sondato** — non sulla shell idle (errore commesso due volte), ma
> sul PID di un processo che **brucia CPU davvero** (`yes > /dev/null`, letto dopo 3 s):
> ```
> shell   : /top-app   Cpus_allowed_list 0-7   nproc=8
> worker  : /top-app   Cpus_allowed_list 0-7
> ```
> ➡️ **Le celle Jelly — quelle su cui poggia il default spedito — NON sono contaminate
> dal cpuset ristretto.** Il rischio che il PLAN teneva aperto su di esse si chiude.
> 🔍 **E spiega l'anomalia S23-vs-Jelly:** su S23 le sessioni Termux stanno in
> `/moderate` (0-2, tre A510), sul Jelly in `/top-app` (0-7). Non è una differenza di
> silicio ma di ROM/OEM — ed è coerente col compute misurato, S23 **0.186 s/tok**
> contro Jelly **0.117** sullo stesso modello: un 8 Gen 2 che perde contro un G99 è
> impossibile a parità di core, normale se ne usa tre piccoli.
> ⚠️ **Limiti dichiarati:** (a) `dumpsys power` non è accessibile da Termux, quindi
> `mWakefulness` non è verificabile per questa via — ma un processo classificato
> `/top-app` implica Termux in foreground, cioè la postura di campagna; (b) è una
> sonda di **oggi**, non una covariata registrata **allora**: assolve il Jelly come
> piattaforma, non certifica retroattivamente le righe di quelle celle. Per quelle
> serve comunque il rerun con l'harness che scrive `nproc`/`affinity_mask`.
> 📌 **Conseguenza operativa per l'S23: i bench si lanciano da `adb shell`** (cpuset `/`,
> 0-7), mai da Termux — già a verbale, e ora con la controprova sul telefono buono.
>
> 🚨 **REPLICA SU S23 (18/08): IL MECCANISMO REPLICA, LA CONSEGUENZA NO.
> LA "REGOLA" QUI SOTTO È SPECIFICA DEL JELLY — non spedirla come regola.**
>
> Stesso binario (copiato dal Jelly, sha `77a94640…` verificato sul device),
> stesso modello (`2f92195854011538`), stessa cella, 3 round:
>
> | cache | Jelly (G99) | **S23 (SD 8 Gen 2)** |
> |---|---|---|
> | 1500 | **−25%** | ≈ **−5%** |
> | 2000 | **−25%** | ≈ **−2%** |
> | 4000 | **+15% (fa danno)** | ≈ **−4% (aiuta ancora)** |
>
> ✅ **Ciò che è device-independent:** hit rate a d=0 **identici** (39.5 /
> 50.2 / 76.8%) e byte e conteggi di drop coincidenti **al decimo di MiB**.
> Il meccanismo — il drop può scartare solo i cache miss, più cache = meno
> da scartare — vale su entrambi i silici.
> ❌ **Ciò che NON lo è: la conseguenza sul tempo.** Sull'S23 il drop non
> raggiunge mai il −25% e **non si ribalta mai**: resta fra −2% e −6% a
> tutte e tre le cache. Il "cache 4000 senza drop è l'ottimo" è vero sul
> Jelly e **falso sull'S23**.
> ➡️ **Quindi la scelta drop/cache va decisa PER DEVICE, e la
> generalizzazione che stavo scrivendo era prematura.** È esattamente
> perché la replica si fa prima di spedire una regola, non dopo.
>
> 🎯 **La lettura che RESTA valida** (punto di gualt, 18/08): 4 GB di cache
> si possono forse concedere su un telefono da 8 GB, ma **su uno da 6 GB
> non esistono** — Android ne trattiene una fetta e le altre app competono.
> Il vincolo di RAM è reale; è la resa in velocità a non essere universale:
>
> **più RAM → cache grande → hit alto → il drop fa danno →
> meno RAM → cache piccola → hit basso → il drop paga, e molto.**
>
> Cioè la config giusta **dipende dal telefono**, non solo dal modello: sono
> lo stesso parametro visto da due lati, perché entrambi decidono quanta
> parte del modello sta in RAM. **E per il segmento 6 GB la risposta non è
> tarare le manopole di un modello da 6 GB: è LFM2.5-8B-A1B (3.3 GB)** —
> che è esattamente perché sta in lineup.
>
> 🔧 **CORREZIONE MIA:** avevo liquidato lo sweep LFM2.5 come "inutile, lì
> il drop non paga mai (hit 93.5%)". **Sbagliato: quel 93.5% è a cache
> 2000.** A cache 1000 — la condizione reale di un 6 GB — l'hit scende e il
> drop può tornare a pagare. È il modello E la condizione che contano per
> quel segmento. Rimesso in coda.
>
> 🚢 **DECISIONE OWNER 2026-08-18 — SI SPEDISCE LA CANDIDATA. `drop 0.65`
> È RITIRATO.**
>
> **Nuovo default CalaQwen:**
> `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
> --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0
> --drop-no-renorm`
>
> Motivo in una riga: **lo 0.65 era dominato** — costava qualità *e* tempo,
> ed è risultato più lento di non droppare affatto in tutti e tre i round.
> L'unico punto che compra velocità è d=1.0, e `--drop-no-renorm` ne toglie
> il 70% del costo di qualità senza cambiare né i byte né la velocità.
> **Contro l'ancora vera: 50% del budget invece del 97%.**
>
> Aggiornati: `Scheda prodotto` (default B), `docs/ALIVE.md` (config b),
> `docs/NAMING.md`. ⚠️ **Le tok/s assolute delle celle S23/Xiaomi sono del
> vecchio default e NON valgono per B** — il segno è noto, gli assoluti per
> device vanno rimisurati.
>
> 📌 **Marco1c resta da decidere separatamente** (sweep device in corso):
> lì d=1.0 costa **+5.71% anche col flag** contro il +1.18% di CalaQwen, e
> manca la sua ancora `k8d0` per sapere se sta nel budget. **Non estendere
> il default B a Marco senza quei due numeri.**
>
> 🔍 **AUDIT OSTILE ESTERNO SULLA STATISTICA (16/08, DeepSeek V4 Flash
> thinking max, tutto ricalcolato da CSV grezzi con scipy).**
> **I DUE P-VALUE SPEDITI REGGONO — attaccati e ricalcolati, esatti.**
> S23: mediana 0.2585→0.1480 (−42.75%), W=0, p = 2/2¹² = 0.000488, HL
> −0.10825, **Cohen dz = 12.6**. Xiaomi: 0.368→0.3145 (−14.54%), W=0,
> p = 2/2¹¹ = 0.000977, HL −0.05625, dz = 2.13. Pairing verificato
> contro i PREREG, floor esatti corretti, spiegazione 11-vs-12 corretta.
> Con dz così la varianza device ±50% non può ribaltare nulla.
> **Altri REFUTED (attaccati e hanno tenuto):** ABBA verificato in tutte
> e 5 le sessioni · pre-registrazione Xiaomi = esemplare di disciplina
> (PREREG 4h prima dello staging, 3 emendamenti tutti prima dei dati,
> kill condition onorate) · kf_ship_jelly e kf_cold_jelly timeline
> pulite · **confronti multipli NON sono una minaccia**: in tutta la
> campagna esistono ~6 test con p-value (4 celle pre-registrate + 2
> esplorativi dichiarati), e Bonferroni li lascia in piedi entrambi
> (servirebbero ≤102 e ≤51 test) · nessuno stopping opzionale, nessun
> outcome switching, nessun endpoint drift · sensibilità post-hoc di
> kf_cold_jelly presentata in modo sicuro · confound di contesa della
> dropcurve reale ma dichiarato e confinato.
>
> ⚠️ **MA CINQUE FINDING CONFERMATI, DA SISTEMARE — e il primo è mio, di
> oggi:**
>
> **(1) [ALTA, ERRORE MIO] `docs/ALIVE.md` attaccava i p-value alla
> config SBAGLIATA.** Verificato al sorgente: entrambe le celle A/B
> hanno testato come braccio B **`-t 2 --n-expert-used 6
> --drop-cold-experts 1.0`** (`run_ship_ab_s23.sh:421`,
> `run_ship_ab_xiaomi.sh:531`), contro A = stock `-t 4 --n-expert-used
> 8`. Io avevo scritto la config di CAMPAGNA CalaQwen (`-t 4 …
> --drop-cold-experts 0.65`, Scheda prodotto del 10/08) e ci avevo
> appeso il −42.7%/−14.5%. **Sono due config diverse su due modelli
> diversi**: quella validata dal p-value è Mellum2 t2/k6/d1.0; quella di
> campagna CalaQwen ha un gate di QUALITÀ (PPL), non un test appaiato.
> ALIVE.md corretto: le due config ora sono separate con l'evidenza di
> ciascuna. **Decisione owner aperta: o si spedisce la config testata,
> o si fa l'A/B di quella spedita.**
>
> **(2) [ALTA] La pre-registrazione S23 non è verificabile da git.**
> `results/kernel_ship_ab_s23/PREREG.md` ha **un solo commit**,
> `da9fa34` del 14/08 23:27:38 — e quel commit contiene GIÀ gli
> emendamenti 1 e 2. Ma la sessione 1 girava alle 17:03-18:25 e la 2 era
> partita alle 18:29. Quindi la frase "registrato PRIMA di ogni run" è
> falsa come affermazione git: il file è entrato nell'albero dopo due
> sessioni. I dati analizzati (v3, 23:28-23:49) sono partiti 55 secondi
> dopo il commit, quindi **la cella analizzata è pulita** — è la
> narrazione che non regge.
>
> **(3) [ALTA] I dati grezzi della sessione 2 non esistono nel repo.**
> `push.log` prova che è partita (18:29:34, batteria 61%), ma nessun
> runs.csv/master log da nessuna parte, e `git log --diff-filter=D` è
> vuoto. Il report spedito dice che il collasso RAM è stato "riprodotto
> 2×": **una sola riproduzione è archiviata**, l'altra è asserita.
>
> **(4) [MEDIA] Il PREREG S23 attribuisce l'esclusione della sessione 1
> a due cause che si escludono a vicenda:** emendamento 1 dice
> "misconfigurata, flag assente" (21.3 s/tok = patologia di default di
> engine); emendamento 2 dice "invalidate dallo stato RAM, **non dalla
> config**" (zram, stesso 21.3 s/tok). L'emendamento 1 non è mai stato
> ritirato e il report spedito sta con il 2.
>
> **(5) [MEDIA] Lo stato dello schermo è dichiarato loggato e non lo è
> mai stato.** Colonna `screen` = `?` su OGNI riga di ENTRAMBE le
> sessioni S23 e su ogni riga delle celle Jelly. Il PREREG S23 dichiara
> "screen state logged every run". Non è un confound differenziale (è
> bilanciato dall'ABBA) ma è un buco protocollo-vs-realtà, e sul Jelly
> contraddice il "wake-lock held" visto che c'è un evento di schermo
> spento documentato a metà cella.
>
> 🔋 **ASSE ENERGIA S23 — l'audit ESAGERA, ma sotto c'è un problema
> vero. Verificato da me riga per riga:** l'auditor sostiene che le
> mediane di energia siano "fisicamente impossibili" citando 0.3367 J
> come sorgente della mediana. **Falso: quelli sono i MINIMI del range.**
> Le mediane vere danno **A = 0.4214 W e B = 0.8227 W**, del tutto
> plausibili — e sono esattamente i numeri che il PLAN riporta da giorni
> (0.42→0.82 W). Quindi la claim "misura rotta" è **REFUTATA**.
> **Ma restano due fatti confermati:** (a) singole righe sono assurde
> (0.280 J su una run da ~52 s = 5 mW), quindi il campionatore fallisce
> a intermittenza e le righe singole non sono citabili anche se la
> mediana regge; (b) **i due bracci emettono un numero di token diverso
> — A 200 (cap), B 144 (EOS)** — e questo ribalta il segno a seconda
> della normalizzazione: **per TOKEN B costa +11.8%, per RISPOSTA B
> costa −19.5%** (17.53 J contro 21.79 J). La campagna ha citato solo il
> per-token come "asse rosso". Entrambi sono veri; va detto quale si
> intende. L'asimmetria 144-vs-200 è dichiarata nel report Xiaomi e
> **non** in quello S23.
>
> 🏁 **M4 CHIUSO A TRE LIVELLI (11:24) — E SUL DEFAULT SPEDITO LA RISPOSTA
> È LA MIGLIORE POSSIBILE.**
>
> | drop | renorm ON | renorm OFF | Δ | costo vs d=0.0 |
> |---|---|---|---|---|
> | 0.50 | 0.6802864 | 0.6791113 | −0.17% | +0.33% → **+0.15%** |
> | **0.65 (spedito)** | **0.6842309** | **0.6794305** | **−0.70%** | **+0.91% → +0.20%** |
> | 1.00 | 0.7049320 | 0.6860923 | −2.67% | +3.96% → **+1.18%** |
>
> **Cambiando UN flag, il costo di qualità della config che spediamo
> scende da +0.91% a +0.20% — il 78% in meno.** Non cambia il livello di
> drop, non cambia quali esperti cadono, non cambia i byte letti, non
> richiede di rifare l'A/B. Il danno cresce in modo monotono col drop
> (0.0012 → 0.0048 → 0.0188), come previsto dal meccanismo.
> *(La mia interpolazione dichiarata in anticipo dava ~+0.32%; misurato
> +0.20%.)*
>
> ✅ **MELLUM2 È Q4_K_M ED È GIUSTO COSÌ — e i p-value non hanno nessun
> problema di portata. (Registrato 17/08; la mia prima stesura di questo
> blocco era gonfiata, vedi in fondo.)**
>
> Mellum2 esiste solo come **Q4_K_M ufficiale JetBrains**; il KEXP su
> Mellum è stato **proiettato e mai costruito**
> (`reports/moe-mellum2-f1-s23.md` §"one honest KEXP projection":
> ~7.5-8.8 t/s stimati contro 4.5-6 del Q4, con la nota esplicita
> "none of those numbers were observed today"). **È una scelta di
> prodotto, non una dimenticanza:** Mellum2 è la SKU coding a pagamento
> e la generazione di codice è la capacità che soffre di più la
> quantizzazione aggressiva — quantizzarlo oltre metterebbe a rischio
> proprio ciò che si vende. *(Razionale di gualt; da oggi scritto qui e
> non più solo a voce.)*
>
> 🔗 **E la catena regge esattamente:**
> A/B braccio B = `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`
> (`run_ship_ab_s23.sh:421`) · config viva di Mellum2 da F1e = **k=6
> drop 1.0, "solo config t2+d1.0"** · modello testato = Q4_K_M ·
> modello spedito = Q4_K_M. **Config, quantizzazione e p-value
> coincidono: i −42.7% / −14.5% validano precisamente ciò che Mellum2
> spedisce.**
>
> ❌ **MIO ERRORE DA NON RIPETERE (17/08 sera):** avevo scritto qui che
> esisteva un "terzo disallineamento" e che citare quei p-value fosse
> "una forzatura di portata". **Falso.** I tre presunti disallineamenti
> (thread, drop, quantizzazione) sono **un solo problema, già trovato e
> già corretto il 16/08**: i p-value erano stati attaccati alla config
> CalaQwen invece che a quella Mellum2, e ALIVE.md era già stato
> sistemato separando le due config. **L'ho ri-derivato da zero e
> presentato come tre scoperte nuove.** Gonfiare un problema risolto
> costa credibilità quanto nasconderne uno vero.
>
> 📌 **Lavoro futuro, non ora (decisione gualt):** un test di coding su
> Mellum2 con la nostra ricetta, per sapere quanto costa davvero il KEXP
> sulla capacità che vendiamo. Fino ad allora Mellum2 resta Q4_K_M.
>
> ✅ **Attenuante misurata, da dire insieme al problema:** la leva
> funziona anche su KEXP — gli sweep device su **Marco-KEXP**
> (`dropsweep_jelly`) e **CalaQwen-KEXP** (`dropsweep_calaqwen_jelly`)
> mostrano il drop che opera e paga. **Il meccanismo trasferisce; è il
> numero con il p-value che resta legato a Q4_K_M.**
>
> 🔧 **CORREZIONE (stessa sera, dopo domanda di gualt): non è una
> dimenticanza, e la mia prima formulazione era troppo severa.**
> Mellum2 è la **SKU coding a pagamento**, un prodotto diverso da
> CalaQwen/Marco, e gualt ricorda una decisione esplicita: *non
> riquantizzarlo oltre perché la capacità di coding crolla*. Il razionale
> è solido — la generazione di codice è la capacità che soffre di più la
> quantizzazione aggressiva.
> **Ma quella decisione NON è scritta da nessuna parte nel repo.** Quello
> che il repo documenta è: Mellum2 esiste solo come **Q4_K_M ufficiale
> JetBrains**; il KEXP su Mellum è stato **proiettato e mai costruito**
> (`reports/moe-mellum2-f1-s23.md` §"one honest KEXP projection":
> ~7.5-8.8 t/s stimati contro 4.5-6 del Q4 vanilla, con la nota che
> "none of those numbers were observed today"); F1b ha streamato **il
> file Q4_K_M** tramite una riga di ricetta `mellum`, non un file
> riquantizzato.
> ➡️ **Da registrare come decisione di prodotto** (con il razionale
> coding), altrimenti è la quarta cosa portante tramandata a voce — ed è
> esattamente il meccanismo che ha generato gli altri tre disallineamenti.
> **Resta vero e non attenuato:** citare i due p-value a sostegno delle
> config **KEXP** che spediamo è comunque una forzatura di portata,
> perché quei test hanno girato su Q4_K_M.
>
> ⚠️ **Nota sulla cella Marco su device:** `runs.csv` sul telefono segna
> **0 righe buone** — il bug del parser di quella notte marcò tutte e 11
> le run `excluded=1`. I numeri citati vengono dal ri-parsing offline dei
> per-token (validi), ma **la cella sul device è inservibile così com'è**
> e **non ha il braccio `no-renorm`**, che ora è la config candidata.
>
> ✅ **CELLA CALAQWEN COMPLETA — 12/12, STATUS=DONE (17/08 23:12).**
> Confronti dentro ogni round:
>
> | | R1 | R2 | **R3 (la più pulita)** | byte vs d0 |
> |---|---|---|---|---|
> | d=0.65 vs d=0.0 | +10.9% | +5.2% | **+1.2%** | −27.3% |
> | d=1.00 vs d=0.0 | −14.1% | −29.4%* | **−11.6%** | −71.4% |
> | d=1.00+nr vs d=0.0 | −13.2% | −24.2%* | **−12.8%** | −71.8% |
>
> \* **Round 2 da scartare sui bracci d=1.0**: la riga mancante è stata
> rifatta ore dopo, a telefono FREDDO (29→32 °C contro i 36-38 degli
> altri), quindi quei due valori sono gonfiati a favore del drop. Il
> **round 3 ha tutti e quattro i bracci a 36-38 °C** ed è il confronto
> termicamente omogeneo: è quello da citare.
>
> **Conclusioni robuste su 3 round:**
> - `d=0.65` **più lento di non droppare in tutti e tre** (+10.9 / +5.2 /
>   +1.2%). Mai una volta più veloce.
> - `d=1.0` **~12-14% più veloce** e legge **−71%** di byte.
> - `d=1.0` con e senza renorm: sui round termicamente confrontabili
>   (R1, R3) la differenza è **+1.1% e −1.3%, segno che si inverte** →
>   **equivalenti in velocità**. Il flag è gratis sul tempo, misurato.
>
> 🎯 **DECISIONE PRONTA PER CALAQWEN (17/08, 11 righe buone su 12).
> `d=0.65` È STRETTAMENTE DOMINATO: COSTA QUALITÀ *E* TEMPO. LA SCELTA
> VERA È `d=0.0` CONTRO `d=1.0 + --drop-no-renorm`.**
>
> Confronti **dentro ogni round** (la deriva termica resta fuori: ogni
> round ha la sua temperatura, e il round-robin dà a ogni braccio la
> stessa posizione in ognuno):
>
> | braccio | R1 | R2 | R3 | byte vs d0 |
> |---|---|---|---|---|
> | d=0.65 vs d=0.0 | **+10.9%** | **+5.2%** | **+1.2%** | −27.3% |
> | d=1.00 vs d=0.0 | −14.1% | *(void)* | −11.6% | −71.4% |
> | d=1.00+nr vs d=0.0 | −13.2% | −24.2% | −12.8% | −71.8% |
>
> **`d=0.65` più lento di non droppare in TUTTI E TRE i round** (segno
> costante, media ~+5.8%). Il finding di Marco-Mini si replica sul
> modello che spediamo. **E `d=1.0` con e senza renorm sono
> indistinguibili in velocità** (−14.1/−11.6 contro −13.2/−12.8, segni
> opposti fra round): **il flag è gratis anche sul tempo — misurato, non
> più dedotto.**
>
> | config | qualità vs d0 | velocità vs d0 |
> |---|---|---|
> | d=0.0 | — | — |
> | **d=0.65 ON — quella spedita** | +0.91% | **+5.8% più LENTA** |
> | d=0.65 OFF | +0.20% | ~+5.8% più lenta |
> | d=1.0 ON | +3.96% | −12.9% |
> | **d=1.0 OFF** | **+1.18%** | **−12.9%** |
>
> ➡️ **Lo 0.65 va abbandonato in qualunque forma**: peggiora entrambi gli
> assi rispetto a non droppare. Se si vuole velocità, l'unico punto che
> la compra è **d=1.0 + `--drop-no-renorm`**: +1.18% di bpb per −12.9% di
> tempo e −71.8% di byte letti.
>
> 🔍 **Dettaglio coerente:** `d=1.0nr` legge un filo MENO byte di `d=1.0`
> (2654.9 vs 2692.2) e droppa un filo di più. La renorm non tocca la
> *decisione* di drop, ma cambia i pesi passati a valle, quindi il
> routing del token successivo diverge: su 200 token le traiettorie si
> separano appena. Non è rumore di misura — i byte sono identici alla
> cifra fra round dello stesso braccio.
>
> ⏳ Manca `r2_d1.0` (escluso). Il resume lo rifà da solo alla prossima
> carica: non cambia il segno, che è già coerente su due round.
>
> 🐞 **LE MORTI DEL JELLY DI STAMATTINA ERANO UN BUG MIO, NON ANDROID —
> e il bug era nel "fix" che avevo scritto stanotte per curarle.**
>
> ```
> run_dropsweep_jelly.sh:109: total: unbound variable
> local total="$1" lbl="$2" left="$total" step=5 since=0
> ```
> **`local` è un comando: TUTTI i suoi argomenti vengono espansi PRIMA che
> venga eseguito**, quindi `"$total"` viene letto quando `total` non è
> ancora assegnato. Con `set -u` è fatale → `cooldown_alive()` moriva al
> primo giro, **sempre e in modo deterministico**. La cella CalaQwen è
> andata avanti solo perché il watchdog la rilanciava e il resume faceva
> un run per rilancio.
>
> ❌ **Come me lo sono lasciato scappare:** ho validato con `bash -n`, che
> controlla la **sintassi** e non il **comportamento**, e non ho mai
> ESEGUITO la funzione. Poi ho costruito una teoria su Android e ho fatto
> controllare a gualt le impostazioni di sistema del telefono — che erano
> già a posto. **Regola: una funzione nuova va eseguita, non compilata.**
> ✅ Ora eseguita in isolamento (12 s esatti, countdown 7→2→0) e verificata
> in campo: `cooldown 120s` 11:54:06 → `COLD_RESET` 11:56:12.
>
> ⚠️ **Attenzione a non estendere troppo la spiegazione:** questo bug
> spiega **solo** le morti di stamattina. `cooldown_alive` non esisteva
> ancora quando sono morte la cella Marco-Mini (16/08 23:34) e la cella
> LFM2.5 (17/08 00:25): **quelle due restano senza causa nota**, e il
> pattern "muore nel cooldown" per esse è ancora solo un pattern.
>
> 🔄 **Round 1 di stamattina ARCHIVIATO, non buttato**
> (`dropsweep_calaqwen_jelly_round1_buggycooldown`, 4 righe). Non si
> mescola col resto: quei run erano separati da un ciclo di rilancio del
> watchdog (sha256 di 13.4 GB + smoke test in mezzo) invece che dai 120 s
> dichiarati — protocollo inter-run diverso da quello scritto.
> ✅ **Controllo di determinismo gratuito:** il re-run pulito di `r1_d0.0`
> dà `read_MiB=9410.3` e `hit=75.5`, **identici alla cifra** all'archivio
> (s/tok 0.651 vs 0.639, differenza solo nel tempo). Le due celle
> misurano la stessa cosa.
>
> 📱 **CALAQWEN SUL JELLY — CELLA PARTITA 10:23, ROUND 1 (17/08).**
> Modello trasferito via USB e **verificato bit per bit**: sha256
> `ac44e20c…721a`, identico alla copia PC. Config **spedita** (`-t 4`,
> `k=6`), 4 bracci × 3 round, scollegato da 100%.
>
> | braccio | s/tok | stall | compute | read_MiB | hit% | droppati/48000 |
> |---|---|---|---|---|---|---|
> | d=0.00 | 0.639 | 0.061 | 0.570 | 9410.3 | 75.5 | 0 |
> | **d=0.65** | **0.693** | 0.052 | 0.629 | 6842.4 | 78.8 | 2761 |
> | d=1.00 | **0.603** | 0.031 | 0.567 | 2692.2 | 84.8 | 8224 |
> | d=1.00+nr | 0.647 | 0.037 | 0.604 | 2654.9 | 84.8 | 8294 |
>
> ❌ **ERRORE MIO, DA CORREGGERE SUBITO: la predizione che avevo scritto
> nel launcher poggiava su un numero falso.** Avevo dichiarato "CalaQwen
> ha hit 11.8%, il più legato al disco di tutti, quindi il drop deve
> rendere più del −27% di Marco-Mini". **Quel 11.8% veniva dallo smoke da
> 5 token, con la cache ancora da riempire.** Su 200 token l'hit vero è
> **75.5%** — cioè CalaQwen è molto MENO I/O-bound di Marco-Mini (50.2%),
> non di più. Lezione: **un hit rate da 5 token non è un hit rate**, è
> il transitorio di riempimento della cache.
>
> ✅ **Cosa REGGE, ed è il punto che conta per la decisione: `d=0.65` è
> più lento di non droppare affatto anche sul modello che spediamo**
> (+8.5%, contro il +10% di Marco-Mini). Il finding non era un'anomalia
> di Marco-Mini.
> ⚠️ **Ma d=1.0 rende molto meno qui: −5.6%, non −27%.** Coerente con
> l'hit rate più alto: meno I/O da risparmiare, stessa tassa di compute.
>
> ⏳ **NON concludo sul braccio no-renorm** (appare +7.3% più lento di
> d=1.0 a parità di byte e di drop): ha girato **ultimo del round a
> 37→38 °C**, e in questo disegno **la posizione nel round è correlata
> col braccio**. È il limite che avevo già dichiarato sulla cella LFM e
> che non ho corretto qui. **Rimedio: round con l'ordine ROVESCIATO**,
> che il resume aggiunge a costo zero — ma la batteria (~4.2%/run, 100%
> → ~50% a fine cella) non ne regge altri 3 su questa carica: vanno
> fatti dopo una ricarica.
>
> 🧊 **IL PC SI SOSPENDE DA SOLO — e per 78 minuti ho creduto di avere un
> watchdog rotto.** M4 finisce alle 07:45:07, il PC resta senza carico ed
> entra in **Modern Standby**; il watchdog del Jelly smette di scrivere
> alle 07:44:36 e riprende da solo alle **09:04:27**. `Get-Process` lo
> dava **vivo** per tutto il tempo. Prova definitiva dal registro
> eventi: `Kernel-Power Id=507 "The system is exiting Modern Standby"`
> alle 07:46:23 e alle 09:01:11 (quando i miei comandi hanno svegliato la
> macchina). **Non era bloccato: era congelato.**
> **Regola operativa:** "processo vivo" non è prova che stia lavorando —
> si confronta l'**mtime del log** con l'ora, e si escludono gli eventi
> Kernel-Power *prima* di accusare il codice. Stavo per riavviare un
> watchdog perfettamente sano. **Conseguenza per le catene: un runner in
> attesa sopravvive solo se qualcos'altro tiene la CPU occupata**; se la
> coda si svuota, il PC dorme e la catena si ferma finché qualcuno non
> tocca la macchina. Stessa forma del problema del Jelly, causa opposta:
> **lì Android UCCIDE, qui Windows SOSPENDE.**
>
> ▶️ **BRACCIO AGGIUNTO (09:02, PC libero): `k6d065_norenorm`.** È il
> livello di drop che spediamo davvero, ed è l'unico che risponde a
> "basta cambiare UN flag per migliorare la config attuale, senza
> toccare il livello di drop?". Il resume ha saltato i due bracci già
> completi e ha lanciato solo il nuovo. Fine attesa ~11:30.
>
> 🏆 **M4 COMPLETO (07:45) — IL RISULTATO PIÙ IMPORTANTE DELLA NOTTE.
> IL 70% DEL COSTO DI QUALITÀ DEL DROP AGGRESSIVO NON VIENE DAL DROP:
> VIENE DA UN DEFAULT.**
>
> | | renorm ON (default) | renorm OFF | Δ |
> |---|---|---|---|
> | **d=0.5** | 0.6802864 (+0.326%) | 0.6791113 (+0.153%) | −0.0011751 (−0.17%) |
> | **d=1.0** | 0.7049320 (**+3.961%**) | **0.6860923 (+1.183%)** | **−0.0188397 (−2.67%)** |
>
> (percentuali contro d=0.0 = 0.6780748, macchinario spento)
>
> ✅ **La predizione che avevo dichiarato PRIMA di vedere il braccio 2 è
> confermata:** il danno cresce con la frazione droppata — **16× più
> grande a d=1.0 che a d=0.5**, per un livello di drop doppio. Il
> meccanismo proposto regge: `total/kept` amplifica i top expert oltre la
> magnitudine per cui sono addestrati, e più droppi più li amplifichi.
> **Tutte e 5 le lingue, in tutti e 2 i bracci, hanno lo stesso segno.**
>
> 🔍 **Il dettaglio che dice di più:** a d=1.0 con renorm ON il costo per
> lingua è irregolare (en **+8.12%**, es +2.88, fr +2.96, it +3.59,
> zh +3.12) — con renorm OFF diventa **uniforme e piccolo** (+1.06,
> +1.15, +1.24, +1.58, +0.91). Il riscalamento non degrada un po'
> ovunque: **massacra l'inglese**, cioè la lingua dove il routing è più
> concentrato e quindi `total/kept` più aggressivo.
>
> ❗ **Il commento nel codice che giustifica il default è empiricamente
> sbagliato.** `router_hook.cpp:278` teme "uno shrink sistematico che il
> modello non vede mai in training". Misurato: **lo shrink è meno
> dannoso del riscalamento, di un fattore ~4 a d=1.0.** Era
> un'assunzione plausibile mai messa alla prova, ed è rimasta il default
> per tutta la campagna.
>
> 🎯 **CONSEGUENZA SULLA DECISIONE — il quadro cambia davvero:**
>
> | config | qualità vs d0 | velocità (Marco-Mini, device) |
> |---|---|---|
> | d=0.65 renorm ON — **quella spedita** | +0.91% | **+10% più LENTA** di d0 |
> | d=1.0 renorm ON — **quella validata dall'A/B** | +3.96% | −27% |
> | **d=1.0 renorm OFF** | **+1.18%** | −27% (stessi drop ⇒ stessi byte) |
>
> **Non è dominanza, è uno scambio molto buono:** d=1.0+OFF costa 0.28
> punti di qualità in più dello 0.65 spedito, e sul device dove abbiamo
> misurato è ~37 punti percentuali più veloce.
>
> ⚠️ **Quattro cautele, tutte da dire:** (1) la qualità è CalaQwen su PC,
> la velocità è Marco-Mini su device — **modelli diversi**; (2) l'A/B fu
> girato con renorm ON, quindi d=1.0+OFF **non è letteralmente la config
> testata**; (3) `--drop-no-renorm` non cambia QUALI esperti cadono (la
> decisione di drop non dipende dalla renorm), quindi byte e conteggi
> restano identici e la velocità dovrebbe trasferirsi — **ma è
> un'inferenza, non una misura**; (4) **`d=0.65 + OFF` non è misurato**
> ed è il braccio ovvio che manca: interpolando il danno, starebbe
> intorno a **+0.32%**, cioè meglio dello 0.65 attuale a parità di
> velocità. Costa ~2.5 h di PC.
>
> 🔬 **M4 — BRACCIO 1 CHIUSO (04:59, d=0.5, 5/5 lingue, rc=0). LA
> RINORMALIZZAZIONE NON GONFIA IL RISULTATO: LO PEGGIORA.**
>
> | | macro bpb | vs d=0.0 |
> |---|---|---|
> | d=0.5 renorm **ON** (default) | 0.6802864 | **+0.326%** |
> | d=0.5 renorm **OFF** | **0.6791113** | **+0.153%** |
>
> Δ = **−0.0011751 (−0.173%)**, e **tutte e cinque le lingue hanno lo
> stesso segno**: en −0.40%, es −0.03%, fr −0.05%, it −0.19%, zh −0.22%.
> **Spegnere la renorm recupera il 53% del costo di qualità del drop.**
> Con rumore run-to-run a 1e-6, un delta di 0.0012 bpb è ~1000× il
> rumore: piccolo ma reale.
>
> ❗ **È il CONTRARIO dell'ipotesi dei due auditor.** Loro dicevano: "il
> miglioramento potrebbe venire dalla rinormalizzazione invece che dal
> togliere rumore" — cioè la renorm faceva il lavoro buono. **Fa il
> lavoro cattivo.** E contraddice anche il commento nel codice
> (`router_hook.cpp:278`), che giustifica la renorm temendo "uno
> shrink sistematico che il modello non vede mai in training":
> empiricamente **lo shrink è meno dannoso del riscalamento**. Lettura
> plausibile: gli esperti droppati hanno peso basso, quindi lo shrink è
> minuscolo, mentre `total/kept` amplifica i top expert oltre la
> magnitudine per cui sono addestrati — perturbazione più grande.
>
> 🎯 **PREDIZIONE DICHIARATA ORA, prima che il braccio 2 finisca
> (partito 04:59):** se il meccanismo è "il riscalamento sovracorregge",
> il danno deve **CRESCERE con la frazione droppata**, perché `total/kept`
> cresce. Quindi mi aspetto **OFF−ON a d=1.0 più negativo di −0.173%**.
> Se invece a d=1.0 il delta si appiattisce o cambia segno, la mia
> spiegazione è sbagliata e il fenomeno è specifico a d=0.5.
>
> ⏳ **M4 — PRIMO SEGNALE (03:15, 1 lingua su 5, NON è un verdetto).**
> `k6d05_norenorm` en: **ON 0.561173 → OFF 0.558919, cioè −0.40%: senza
> rinormalizzazione va MEGLIO.** È il terzo ramo della lettura che avevo
> dichiarato in anticipo ("OFF meglio di ON → il default è sbagliato e
> c'è qualità gratis"), ed è quello che mi aspettavo di meno.
> ✅ **La guardia no-op è superata empiricamente**: i valori DIFFERISCONO,
> quindi `--drop-no-renorm` ha agito davvero. Si somma al controllo da
> sorgente (la CLI esce con rc=1 su argomento sconosciuto,
> `main.cpp:752-756`, e l'engine gira col flag sulla riga di comando).
> ⚠️ **Una lingua su cinque, e l'inglese è la più facile del corpus**
> (bpb 0.56 contro 0.84 dello zh). Aspettare le altre quattro e il
> braccio d=1.0 prima di dire qualunque cosa: se il segno si mantiene su
> tutte, la frase "affilare la mistura" non solo non spiega il
> risultato — è **al contrario**, e va riscritta in PLAN, ALIVE e NAMING.
> 🔎 **Nota di metodo:** il JSON del braccio esisteva già dopo la PRIMA
> lingua, senza `finished`. È esattamente il caso che l'audit aveva
> chiamato F1 e che ho corretto tre ore fa: col vecchio `Test-Path`
> questo braccio sarebbe stato saltabile come "completo".
>
> 🚨 **CURVA CALAQWEN COMPLETA (02:28) — E DUE DELLE SUE TRE COLONNE SONO
> ARTEFATTI. Il difetto è nell'ancora, non nei dati.**
>
> | drop | macro bpb | vs d0 (**valido**) | `gate_vs_k8d0` (**da ignorare**) |
> |---|---|---|---|
> | 0.00 | 0.6780748 | — | ~~PASS~~ |
> | 0.30 | 0.6784793 | +0.06% | ~~PASS~~ |
> | 0.50 | 0.6802864 | +0.33% | ~~PASS~~ |
> | **0.65** | **0.6842309** | **+0.91%** ← il default spedito, misurato | ~~PASS~~ |
> | 0.80 | 0.6889289 | +1.60% | ~~PASS~~ |
> | 1.00 | 0.7049320 | +3.96% | ~~PASS~~ |
>
> ❌ **`GATE_PASS` su questa curva NON VUOL DIRE NIENTE.** `GATE_DIR` è
> hardcoded a `results/mellum2_ppl_gate` (`run_mellum2_dropcurve.py:31`) e
> l'ancora `k8d0` è **Mellum2-12B** (macro 1.020819). Quando `launch.ps1`
> ha riusato lo script per CalaQwen passando solo `--expect-model-sha`,
> **l'ancora è rimasta Mellum2**: quindi `d_macro_vs_k8d0` = CalaQwen
> meno Mellum2 ≈ **−0.34**, contro una soglia `MACRO_PASS = 0.04`. Ogni
> braccio passa con 0.38 bpb di margine **perché CalaQwen è un modello
> migliore di Mellum2**, non perché quel livello di drop sia accettabile.
> Il gate è vero per costruzione e **non porta informazione sul drop**.
>
> ❌ **`DROPCURVE_FLAT(spread=0.0269, noise=0.3537)` è lo stesso artefatto.**
> Il "noise floor" è `|rerun − stored|` con `stored` preso dalla stessa
> cartella Mellum2: `d10_stored_macro = 1.0586` (Mellum2) contro
> `d10_rerun_macro = 0.7049` (CalaQwen) → 0.3537. **Non è rumore
> run-to-run: è la differenza fra due modelli.** Con un floor così, la
> condizione `all_within_noise` è una tautologia e "FLAT" esce sempre.
>
> ✅ **COSA SOPRAVVIVE, ed è la parte che conta:** `macro_bpb` e la
> colonna **vs d0** sono stesso modello, stesso binario, stesso corpus, e
> la PPL in decode è deterministica (la campagna Mellum2 misurò rumore a
> 1e-6). Quindi la curva vera è **monotona crescente e reale**: il costo
> di qualità non è piatto e non è zero, è **+0.91% al default spedito** e
> **+3.96% a d=1.0**. È piccolo, ma è misurato e ordinato.
>
> 🔧 **Da correggere:** ero io ad aver scritto un'ora fa in `docs/ALIVE.md`
> "five points measured, **all GATE_PASS**" — quel PASS è vacuo e va tolto.
> Per un gate CalaQwen vero serve un'ancora **CalaQwen k8 d0**, che non
> esiste (≈1 giorno-PC). Fino ad allora la frase onesta è: *il costo di
> qualità del drop su CalaQwen è misurato e piccolo; non esiste un gate
> superato, perché il gate confrontava un altro modello.*
> **Nota: M4 NON è toccato** — confronta OFF contro ON dentro CalaQwen,
> stesso modello e stesso binario.
>
> ☀️ **COSA SERVE DOMATTINA — la decisione su `d=0.65` è cambiata di
> FORMA, non solo di numeri.** Prima la domanda era "quanto costa in
> qualità lo 0.65". Ora si sa che **il drop paga solo se la quota di
> stall è alta abbastanza da ripagare una tassa fissa di compute**, e
> quella quota dipende dal modello e dal device. Quindi:
>
> 1. **Serve una decisione dell'owner, non una misura:** come portare
>    CalaQwen su un telefono per misurarlo. Sono 13.4 GB e non c'è.
>    (a) trasferirlo sul Jelly **mentre è in carica**, poi caricarlo al
>    100% e fare lo sweep scollegato (il protocollo vuole UNPLUGGED solo
>    durante la misura, non durante il trasferimento); oppure
>    (b) aspettare che l'S23 si liberi dall'altro harness.
>    **Senza uno dei due, la decisione sul default resta bloccata** — e
>    non è aggirabile con l'analisi (vedi sotto: i dati device CalaQwen
>    esistenti non hanno stall/compute e sono su un'altra quantizzazione).
> 2. **Affermazione onesta nel frattempo:** il default 0.65 sta su una
>    parte della curva **dominata sull'unica coppia device+modello dove
>    l'abbiamo misurata**, ed è **non testato sul modello che spediamo**.
>    Non è "sbagliato": è non verificato.
> 3. Quando M4 chiude, si sa anche **se il risultato di qualità è della
>    renorm o del drop** — e questo cambia le PAROLE in PLAN/ALIVE/NAMING,
>    non solo il numero.
>
> 🌙 **NOTTE 16→17/08 — DUE MISURE, POI SI DECIDE (nessuna idea nuova).**
> Ordine deciso con gualt prima che andasse a dormire: si chiude, non si
> apre. Stato alle 00:20.
>
> **PC — la curva qualità CalaQwen è a 5 punti su 6 e sta chiudendo il
> sesto, che è proprio il default spedito:**
>
> | drop | arm | macro bpb | Δ vs d0 | gate |
> |---|---|---|---|---|
> | 0.00 | k6d0 | 0.6780748 | — | GATE_PASS |
> | 0.30 | k6d03 | 0.6784793 | +0.06% | GATE_PASS |
> | 0.50 | k6d05 | 0.6802864 | +0.33% | GATE_PASS |
> | 0.65 | k6d065 | *in corso, fine ~02:40* | — | — |
> | 0.80 | k6d08 | 0.6889289 | +1.60% | GATE_PASS |
> | 1.00 | k6d10 | 0.7049320 | +3.96% | GATE_PASS |
>
> Quando k6d065 chiude, **il costo di qualità dello 0.65 è MISURATO e non
> più interpolato** — la riga più debole della tabella di Pareto del
> REPORT sweep sparisce.
>
> 🔬 **M4 — ABLAZIONE DELLA RINORMALIZZAZIONE, ARMATA (parte da sola
> quando il PC è libero; `scripts/run_m4_renorm_ablation.ps1`, pid 57676).**
> È la misura che due auditor indipendenti hanno messo al primo posto.
> Disegno 2×2 **dichiarato prima di lanciare**:
>
> | | renorm ON (default) | renorm OFF (`--drop-no-renorm`) |
> |---|---|---|
> | **d=0.5** | k6d05 = 0.6802864 ✅ già misurato | `k6d05_norenorm` ← stanotte |
> | **d=1.0** | k6d10 = 0.7049320 ✅ già misurato | `k6d10_norenorm` ← stanotte |
>
> Mancano solo le due celle OFF: **le ON sono già misurate su questo
> identico binario e modello, quindi il contrasto è senza confondenti.**
> d=1.0 c'è perché a 0.5 la correzione di renorm è piccola e un nulla lì
> non direbbe niente; a 1.0 il costo qualità è massimo (+3.96%) ed è dove
> la rinormalizzazione lavora di più.
> **Lettura dichiarata in anticipo:** OFF≈ON a entrambi i livelli → la
> renorm non è il meccanismo e la claim regge com'è scritta; OFF molto
> peggio → **è la rinormalizzazione a portare il risultato**, e allora la
> frase onesta diventa "affilare la mistura costa poco", che è un'altra
> cosa e molto meno nuova (da riscrivere in PLAN, ALIVE e NAMING);
> OFF meglio di ON → il default è sbagliato e c'è qualità gratis.
>
> 📄 **Il verdetto esce da solo:** `scripts/summarize_m4_renorm.py` — scritto
> **prima che i dati esistessero** — legge i quattro bracci, rifiuta i JSON
> senza `finished`, costruisce il 2×2 e applica la regola no-op; il runner
> lo invoca a fine catena e scrive `results/m4_renorm_ablation/VERDICT.md`.
> Così la conclusione non dipende da chi è sveglio. Provato a vuoto: legge
> i due bracci ON e dichiara "Incomplete — no verdict".
>
> ⛔ **Il terzo braccio (drop CASUALE invece che per freddezza) NON si fa
> stanotte, e non è una dimenticanza:** il flag non esiste nell'engine,
> servirebbe una modifica al codice e una ricompilazione — **e un binario
> nuovo romperebbe l'identity pin che rende confrontabili questi bracci.**
> Farlo bene costa anche un braccio di controllo ricompilato. Decisione
> owner, non contrabbandata di notte.
>
> 📱 **JELLY — SECONDO MODELLO PER LA NON-MONOTONICITÀ: NON è CalaQwen, ed
> è una scelta forzata dai numeri, non una scorciatoia.** CalaQwen
> (13.4 GB) **non è sul Jelly** e non c'è nessun 35B sul telefono.
> Trasferirlo costa ~45 min di WiFi + scrittura flash ≈ 20% di batteria,
> partendo da 71% scollegato, con floor di protocollo al 45%: **finirebbe
> la batteria prima della fine dello sweep.** Con l'S23 riservato
> all'altro harness, l'unico altro MoE disponibile è
> **LFM2.5-8B-A1B-KEXP** — e non è un ripiego:
>
> **`lfm2moe`, gating sigmoid, k=4 su 32 esperti, 3.3 GB** contro i
> **k=6 su 256, 6.4 GB** di Marco-Mini. Pre-flight misurato stanotte:
> d=0.0 → `read_MiB=183.0`; d=1.0 → `read_MiB=99.1`,
> `experts_routed=440 experts_dropped=26`. **Cache hit 93.5% contro il
> 50.2% di Marco-Mini**: qui il working set degli esperti STA in cache,
> lì no.
>
> **Lettura dichiarata prima del lancio:** se i byte salgono a d=0.3
> anche qui → l'effetto è a livello di implementazione e il default 0.65
> è sospetto su OGNI modello, CalaQwen compreso; se qui sono monotoni e
> su Marco no → **CONFERMA il meccanismo di località di cache** (serve un
> working set che sfori la cache) e il finding di Marco resta in piedi,
> circoscritto ai modelli con tanti esperti. **Nessuna delle due è un
> fallimento** — ed è per questo che la cella vale la sua batteria.
>
> 🔴 **CORREZIONE MIA, DA SORGENTE + DATI (17/08, round 1 LFM2.5): IL
> MECCANISMO CHE AVEVO SCRITTO IERI È SBAGLIATO. Non è località di
> cache. È il costo di ARMARE il drop, e si paga in COMPUTE.**
>
> | drop | s/tok | stall | **compute** | io | read_MiB | hit% | droppati |
> |---|---|---|---|---|---|---|---|
> | 0.00 | 0.182 | 0.016 | **0.164** | 0.045 | 2245.6 | 93.5 | 0 |
> | 0.30 | 0.214 | 0.014 | **0.199** | 0.037 | 1917.7 | 93.9 | **9** / 17600 |
> | 0.65 | 0.206 | 0.010 | **0.194** | 0.029 | 1414.4 | 94.6 | 296 |
> | 1.00 | 0.238 | 0.006 | **0.231** | 0.015 | 739.6 | 95.5 | 639 |
>
> **Tutto ciò che è I/O migliora in modo monotono** (stall −63%, io −67%,
> byte −67%, hit 93.5→95.5) **e il compute peggiora in modo monotono
> (+41%).** Su questo modello il drop è perdita pura a OGNI livello:
> risparmia byte che non stavamo aspettando (a d=0 l'I/O è l'8.8% del
> tempo, perché il working set STA in cache) e aggiunge compute.
>
> **Il numero che chiude il ragionamento: a d=0.3 sono stati droppati 9
> slot su 17600 — lo 0.05% — e il compute è salito del 21%.** Nove
> esperti non possono costare il 21%. Quindi non è il DROPPARE a costare.
>
> ✅ **Verificato al sorgente:** `RouterHook::drop_armed()`
> (`router_hook.cpp:213-215`) ritorna false se `drop_frac_ <= 0`. A
> d=0.0 vengono saltati per intero `gather_weights`, `settle_spec()`,
> `query_residency()` e il doppio ciclo `nu×nt` con la passata di
> renorm; a d>0 girano su TUTTI gli slot instradati (88/token qui) a
> prescindere da quanti ne cadono. **Quindi `d=0.0` non è "lo stesso
> engine senza drop": è il macchinario spento.** Il confronto d=0.0 vs
> d=0.3 misura quasi solo l'accensione.
>
> 🧪 **Braccio di controllo dichiarato PRIMA di misurarlo: `d=0.001`.**
> La soglia è `thr = drop_frac_/nu`, quindi a 0.001 il macchinario è
> ARMATO ma non droppa (quasi) nulla. Predizione registrata ora:
> **compute(d=0.001) ≈ compute(d=0.3) ≫ compute(d=0.0)**. Se esce così,
> la tassa di accensione è isolata e quantificata; se compute(0.001)
> ≈ compute(0.0), la mia spiegazione è sbagliata di nuovo e il costo
> viene davvero dal droppare. Costa 3 run (~9 min) e il resume lo
> aggiunge senza rifare nulla.
>
> ⚠️ **Cosa NON cambia:** il finding di Marco-Mini resta (d=1.0 lì è
> davvero il più veloce, −27.2%), perché lì lo stall era il 22% del tempo
> e il risparmio di I/O ripaga la tassa. **Cambia la REGOLA generale, che
> ora è prevedibile invece che aneddotica:** *il drop paga solo se
> risparmia abbastanza I/O da coprire una tassa fissa di compute per
> token; il break-even lo fissa la quota di stall, non il livello di
> drop.* Su un modello che sta in cache non paga mai. **E l'aumento di
> +5.0% dei byte a d=0.3 su Marco-Mini resta un'anomalia separata e
> ancora non spiegata** (candidato: `settle_spec()` cambia il
> comportamento del prefetcher) — non la si archivi come "risolta".
>
> 🛡️ **AUDIT OSTILE SUI TRE SCRIPT DELLA NOTTE (DeepSeek V4 Flash thinking
> max, 17/08 00:20-00:35). CINQUE PROBLEMI REALI, TUTTI CORRETTI PRIMA
> CHE PARTISSE M4.** Undici altri attacchi REFUTATI con prove (parser
> awk, collisioni di chiavi, `jfield`, conteggio colonne CSV, escaping
> della here-string, trappola dell'`exec`, heredoc del resume).
>
> **F1 [GRAVITÀ 1 — dato silenziosamente sbagliato, il peggiore]:** usavo
> `Test-Path <arm>_multi5.json` come test di completezza. **Ma quel JSON
> viene scritto dopo OGNI lingua e su OGNI percorso di errore**
> (`run_multi5_ppl_host.py:218,229,258`); solo la scrittura finale
> aggiunge la chiave `finished` (riga 265). Un braccio andato in OOM
> sulla prima lingua sarebbe stato **saltato per sempre come "già
> completo"**, e M4 avrebbe confrontato un braccio OFF parziale contro un
> ON completo — cioè esattamente il risultato-che-sembra-giusto che
> questa cella non può permettersi. **Corretto:** `ArmComplete()` esige
> `finished` E `macro_bpb`, e il runner si FERMA su rc≠0 invece di
> proseguire. Verificato su dati veri: `k6d05` (finito) → True,
> `k6d065` (in corso, JSON già presente) → **False**.
> **F4 [2]:** PID orchestratore hardcoded → dopo la sua uscita Windows
> può riciclare il numero e la catena aspetterebbe uno sconosciuto fino
> al tetto di 24 h. **Corretto:** si verifica che la command line
> contenga `run_mellum2_dropcurve`.
> **F5 [2]:** un engine **bloccato** era invisibile — `kill -0` lo tiene
> "vivo" per sempre e il watchdog non avrebbe mai rilanciato. **Corretto:**
> l'heartbeat diventa segnale di vivacità (età > 900 s ⇒ kill + resume).
> **F3 [3]:** la finestra di ~1-2 s prima dell'`exec` di `launch.sh` non
> era vista dal guard. **Corretto:** il guard ora riconosce entrambi, e
> `ALIVE>1` diventa un allarme che BLOCCA il rilancio.
> **F2 [2]:** ssh morto produceva la stessa riga ogni 5 minuti senza
> escalation. **Corretto:** allarme a 15 min su `logs/JELLY-ALERT.txt`.
>
> 🔬 **Controllo positivo dichiarato PRIMA dei numeri (buco che l'audit
> NON aveva visto e che ho trovato verificando io la sua claim R9):** in
> `--ppl-decode` l'engine stampa solo `drop_cold=0.500 k=6` e **non
> stampa mai `drop_renorm`**; la CSV è `pos,token_id,logprob`. Quindi
> **non esiste una riga di log che provi che `--drop-no-renorm` ha
> agito**, e un nullo sarebbe indistinguibile da un flag ignorato.
> Regola fissata ora: **`macro_bpb`(OFF) identico a piena precisione a
> quello ON ⇒ FLAG NO-OP, non "la renorm non conta"**. È solido perché
> senza renorm i superstiti non vengono riscalati per `total/kept`
> (`router_hook.cpp:278-282`), quindi la PPL non può uscire identica.
>
> 🧩 **MECCANISMO CHIUSO SU DUE MODELLI (rianalisi dei dati grezzi
> Marco-Mini + round 1 LFM2.5, costo zero: i per-token erano già in
> repo).** Il modello che spiega tutto:
>
> **`compute(d) = base + tassa_di_accensione − risparmio(quanti ne cadono
> davvero)`**
>
> | modello | hit% | slot instradati | d=0.3: caduti | Δcompute | d=1.0: caduti | Δcompute |
> |---|---|---|---|---|---|---|
> | Marco-Mini (k6/256) | 50.2 | 33600 | **21** (0.06%) | +6.8% (r1), +13.8% (r2) | **9986** (29.7%) | **−13.7%** |
> | LFM2.5 (k4/32) | 93.5 | 17600 | **9** (0.05%) | **+21.3%** | **639** (3.6%) | **+40.9%** |
>
> A d=0.3 **entrambi i modelli droppano lo 0.05% degli slot e pagano
> comunque compute**: è la prova diretta che il costo è ACCENDERE, non
> droppare. A d=1.0 Marco ne droppa il 29.7% e il risparmio **ripaga con
> gli interessi** (compute sotto il baseline); LFM ne droppa il 3.6% e la
> tassa non viene mai ripagata.
>
> 🔑 **E perché LFM ne droppa così pochi? Il drop può colpire SOLO ciò che
> non è in cache** — `router_hook.cpp:271`: `drop = k != best &&
> drop_res_[idx] == route_miss && drop_w_[idx] < thr`. **Quindi l'hit
> rate mette un TETTO al drop rate**, e i due modelli lo rispettano
> entrambi: Marco hit 50.2% → al più ~49.8% droppabile, osservato 29.7%;
> LFM hit 93.5% → al più ~6.5%, osservato 3.6%. **`--drop-cold-experts`
> è auto-limitante: su un modello che sta in cache non ha niente da
> droppare e resta solo la tassa.**
>
> ❓ **Ho provato a PREDIRE CalaQwen dai dati che già abbiamo, e non si
> può — ed è la ragione per cui quella misura non è sostituibile
> dall'analisi.** La regola nuova ("paga solo se la quota di stall è
> abbastanza alta") richiede stall/compute e hit rate della config
> spedita su device. L'unica cella device CalaQwen è
> `results/adopt_dropcold/` e **non ha la scomposizione**: `conv5.turns.csv`
> ha solo `tok_s` e `cache_hit_pct` (81.5%), niente stall né compute, ed è
> per di più su una quantizzazione diversa (`UD-IQ2_M`, non KEXP) e in
> regime conversazionale con riuso di cache tra turni. **Quindi: nessuna
> predizione onesta possibile.** Serve lo sweep CalaQwen su device.
>
> ❌ **Candidato REFUTATO sui byte:** avevo ipotizzato che l'aumento di
> +5.0% dei byte a d=0.3 su Marco venisse da `settle_spec()`. **Falso:
> `spec_read_MiB=0.0`, `spec_experts=0` in tutte le run — il prefetcher
> speculativo è spento.** Il dato dice altro: a d=0.0 e d=0.3 la domanda
> è IDENTICA (`token_demand_MiB=136.8` in entrambi), ma **evictions
> 16692→17409 (+4.3%) e rereads 12514→13221 (+5.7%)**. Quindi i byte in
> più sono **rilettura da sfratto a domanda invariata**: il percorso
> armato carica in modo diverso (`load_layer` immediato con
> `D.deferred = false`) e frusta la cache. Ipotesi non ancora confermata
> al sorgente — **resta aperta, ma non è più "località di cache" e non è
> speculazione.**
>
> ⚠️ **Limite del disegno, dichiarato:** dentro un round l'ordine è
> sempre 0.0→0.3→0.65→1.0, quindi **la posizione nel round è correlata
> col livello di drop** e nel round 1 la temperatura sale 32→34 °C. Due
> cose lo attenuano: `d0.65` e `d1.0` girano entrambi a 34→34 (stesso
> stato termico) e differiscono 0.206 vs 0.238, e i round 2-3 girano
> tutti a saturazione termica. **Rimedio previsto: round aggiuntivi con
> l'ordine dei drop ROVESCIATO**, che il resume permette a costo zero.
>
> 💀 **JELLY PERSO ALLE ~00:25 — MA STAVOLTA SO PERCHÉ, E NON È IL
> TIMEOUT DELLO SCHERMO.** 4 run buone in cassa (tutto il round 1, i
> numeri qui sopra), poi Termux ucciso. **Il telefono rispondeva al ping
> con 0% di perdita mentre TUTTE le porte erano chiuse** (8022, 22,
> 18022, 2222, 8080): non è la rete e non è doze profondo — è stato
> ucciso l'intero process group dell'app, non solo sshd.
>
> 🔍 **Il pattern che ieri non avevo visto: tutte e due le morti sono nel
> COOLDOWN, non in una run.** 16/08: ultima run finita 23:34:26, morto
> nel cooldown dopo. 17/08: ultima run finita 00:22:02, ultimo battito
> "cooldown before r2_d0.0", sparito entro tre minuti. **E gli intervalli
> dal lancio sono 30 min e 13 min — quindi nessun timeout fisso**, il che
> falsifica la diagnosi "timeout schermo a 30 min" che avevo dato ieri
> (già allora contraddetta dalla cella K-F durata 50 minuti).
> Ipotesi, 2 casi su 2, non confermata: **Android congela l'app quando
> resta inattiva, e un processo fermo in `sleep 120` sembra inattivo.**
>
> 🔧 **Fix applicato (misura invariata):** `cooldown_alive()` spezza il
> cooldown in `sleep 5` con heartbeat a ogni giro e wake-lock riacquisito
> ogni 30 s — stessi secondi totali, stessi flag, stesso gate: cambia
> solo la meccanica di sopravvivenza. E il watchdog ora **rispinge lo
> script via scp e ne verifica lo sha prima di rilanciare**, se no
> rilancerebbe fedelmente la versione che muore.
>
> ⛔ **Limite onesto: senza adb sul Jelly non esiste canale fuori banda**
> (solo l'S23 è su adb ed è riservato all'altro harness). Il watchdog
> ritenta all'infinito e riprende dal run 5 appena sshd torna, ma **fino
> ad allora si è ciechi.** Le 4 run del round 1 sono l'unico dato, e il
> segnale che portano è già forte.
>
> 🔧 **Lo sweep v2 corregge la causa comune dei tre bug di ieri:
> parametrizza invece di riscrivere** (`scripts/run_dropsweep_jelly.sh`).
> **Resume derivato da `runs.csv`** (lo stato È il dato: nessun file di
> resume che possa divergere), **passate di recupero** sui label vuoti,
> **pre-flight smoke da 5 token** che avrebbe intercettato in 20 secondi
> sia il fallimento di link sia il parser che tornava vuoto, e **guardia
> Termux:API** (una batteria illeggibile non deve più essere letta come
> "attaccato alla corrente"). Watchdog lato PC che rilancia solo se
> l'harness è morto **senza** verdetto terminale, con ricontrollo di
> vivacità **sul device** un istante prima di lanciare — perché un
> rilancio a vuoto crea un harness duplicato, che è l'errore già
> commesso oggi. Primo run in cassa: `r1_d0.0 s/tok=0.182
> read_MiB=2245.6 hit=93.5 excluded=0`.
>
> 🚨 **DROP SWEEP JELLY — RISULTATO (16/08, 11 run su 12): IL RISPARMIO DI
> BYTE NON È MONOTONO, E `d=0.65` CHE SPEDIAMO È PIÙ LENTO DI NON
> DROPPARE AFFATTO.**
>
> | drop | s/tok | read_MiB | hit% | tempo vs d0 | byte vs d0 |
> |---|---|---|---|---|---|
> | 0.00 | 0.1703 | 11803.1 | 50.2 | — | — |
> | **0.30** | 0.2000 | 12395.9 | 48.3 | **+17.4% PIÙ LENTO** | **+5.0% PIÙ BYTE** |
> | **0.65** | 0.1873 | 10535.0 | 52.3 | **+10.0% più lento** | −10.7% |
> | **1.00** | 0.1240 | 3712.8 | 67.1 | **−27.2% più veloce** | **−68.5%** |
>
> **Un drop piccolo non è un risparmio piccolo: è una perdita netta.** Il
> meccanismo si vede nella colonna cache: l'hit rate SCENDE (50.2 → 48.3)
> perché ripuntare lo slot droppato sul top expert
> (`router_hook.cpp:267-268`) perturba quali esperti vengono toccati, e a
> frazioni basse questo distrugge più località di quante letture tolga.
> A d=1.0 si ribalta: hit 67.1%, byte a un terzo, throughput **+37%**
> (5.87 → 8.07 tok/s).
>
> ✅ **CONTROLLO INTERNO PASSATO:** d=0.65 senza prefetch riproduce il
> braccio OFF della cella K-F — `read_MiB` = **10535.0 identico in tutti
> e tre i round** (contabilità byte dell'engine esatta e deterministica),
> `/proc read_bytes` 22.17/22.07/22.19 GB contro i 22.1-22.5 di quella
> cella. Il round-robin ha fatto il suo: r3 è gonfiato in blocco (34 °C)
> ma **conserva l'ordinamento**.
>
> 🎯 **INCROCIATO CON LA CURVA QUALITÀ DEL PC: d=0.3 e d=0.65 sono
> STRETTAMENTE DOMINATI** — costano qualità E tempo. La scelta vera è
> **d=0.0 contro d=1.0**: 4% di bpb per +37% di token/s, o niente drop.
> **E spiega per un'altra strada quello che l'audit statistico ha
> trovato:** l'A/B pre-registrato testava il braccio B a
> `--drop-cold-experts 1.0`, NON lo 0.65 di campagna. **L'A/B ha testato
> la config che è davvero veloce; il nostro default sta sulla parte
> dominata della curva.** Due evidenze indipendenti che convergono sullo
> stesso punto: la config spedita e quella validata non coincidono.
> Esplorativo: un device, un modello, d=1.0 ha n=2. **Licenzia un
> riesame del default, non un cambio.**
>
> ⚠️ **TRE BUG, TUTTI MIEI, NESSUNO DEL DEVICE.** (1) il binario non
> linkava — `bmoe-cli` carica le `.so` dalla propria cartella e l'harness
> K-F lo risolve alla riga 42 con `LD_LIBRARY_PATH`: ho riusato il
> binario senza riusare quella riga; (2) `set -e` dopo il `wait`
> accendeva errexit mai voluto (header `-uo pipefail`) e il comando
> successivo uccideva lo sweep in silenzio; (3) **il parser buttava via
> ogni campo di tempo**: le chiavi dell'engine contengono `/` (`s/tok`,
> `tok/s`) e il mio estrattore `sed s///` leggeva la barra come
> delimitatore — i campi con barra tornavano vuoti, quelli senza
> (`read_MiB`, `hit%`) funzionavano, ed è per questo che il guasto era
> invisibile. **I dati si sono salvati solo perché l'engine scrive da sé
> la riga di summary**: la misura era giusta, era rotta l'estrazione.
> **Causa comune: ho scritto un harness nuovo invece di parametrizzare
> quello provato.** Tutti e tre erano già risolti in
> `run_kf_reality_jelly.sh`. results/dropsweep_jelly/REPORT.md.
>
> 🧪 **(design dichiarato prima del lancio:)**
> `--drop-cold-experts` è la leva viva della campagna e il suo costo di
> QUALITÀ è misurato (curva PC: d0.3 +0.06%, d0.8 +1.6%, d1.0 +4.0%
> macro bpb). **Il suo risparmio di BYTE non è MAI stato misurato** — è
> lo scopo dichiarato del flag, citato come se fosse un risultato. La
> cella PC non ha strumentato i byte e i suoi tempi sono confusi da una
> contesa CPU diversa per braccio.
> Questa lo misura sul device dove i byte costano davvero (flash lento,
> stall ~22%), da page cache verificata fredda.
>
> **Dichiarato prima di lanciare:** bracci d ∈ {0.0, 0.3, 0.65, 1.0} ·
> ordine **round-robin ×3 round = 12 run**, così ogni livello è
> campionato presto/medio/tardi e la deriva termica o di batteria non
> può fabbricare un trend monotono · n=200 · **reset a freddo verificato
> prima di OGNI run** (fadv + Cached prima/dopo, COLD-VALID solo se il
> calo ≥ 1000 MB — lo stesso gate che oggi ha beccato tre run tiepide) ·
> cooldown 120 s (dichiarato: il device sta a ~20 °C, ben sotto il
> target 30 °C che usava la cella K-F) · UNPLUGGED, floor 45%.
>
> **CONTROLLO INTERNO, ed è il motivo per cui d=0.65 è nello sweep:**
> d=0.65 senza prefetch È esattamente il braccio OFF della cella K-F a
> freddo — stesso binario, stesso modello, stessi flag. Deve riprodurre
> ~0.192 s/tok e ~22.3 GB. **Se non lo riproduce, la cella sta misurando
> altro ed è nulla.**
>
> **Attesa e kill dichiarati:** i byte devono scendere monotonicamente
> con d. **Se NON scendono, il flag non fa quello che stiamo affermando**
> e "l'expert skipping è la nostra modalità veloce" perde il meccanismo.
> Quell'esito è un risultato, non un fallimento, e va riportato.
> Esplorativa: niente p-value, niente pre-registrazione, niente claim.
> results/dropsweep_jelly/.
> ⚠️ **OPS — PERCHÉ SI È FERMATA A 11/12, E PERCHÉ LA MIA DIAGNOSI ERA
> TROPPO SICURA.** Lanciata staccata (`setsid nohup`), PPID=1 **provato
> da sessione nuova**, ed è sopravvissuta a più cadute di sshd: il
> distacco ha funzionato e sshd NON è la causa. Lancio 23:04:15, ultima
> run completata **23:34:26 = 30 min 11 s** — coincide col timeout
> schermo del device (30 min, la UI non offre "mai";
> `settings put system screen_off_timeout` da Termux è **rifiutato**,
> `INTERACT_ACROSS_USERS`).
> **MA ho dichiarato quella diagnosi con più sicurezza di quanta ne
> reggano i dati: oggi stesso la cella K-F è girata dalle 16:15 alle
> 17:05 = 50 MINUTI**, ben oltre i 30. Quindi il timeout da solo NON
> spiega tutto — la variabile probabile è se il telefono viene toccato
> nel frattempo. Resta un'ipotesi con un controesempio, non un fatto.
> **La conclusione operativa non cambia e non dipende dalla causa: una
> morte deve costare UN BLOCCO, non la corsa.** L'harness K-F sopravvive
> a essere ucciso di continuo perché ha `RESUME_AT` + void-scan; questo
> script non li ha. **Aggiungere il resume è la modifica che rende
> affidabili le celle lunghe su questo telefono**, qualunque sia la causa
> della morte. Nota: sul device ci sono **Termux:Boot e Termux:API**, non
> ancora sfruttati — un boot-script che riprende le celle interrotte è la
> via naturale.
> results/dropsweep_jelly/.
>
> ☠️ **IDEA 2 (k ADATTIVO SULLA CONFIDENZA DEL ROUTER) — MORTA IN UN
> MINUTO, A COSTO ZERO. Era il rank 1 mio E di Qwen.**
> Test dichiarato prima: se i bin ad alta confidenza sono troppo piccoli
> per muovere il k medio, l'idea muore. Eseguito sulle route trace che
> avevamo già (`results/f4.8/traces/long_512.route.tsv`, 26 200 gruppi
> token×layer, il campo `weight` È il peso della gate per slot):
>
> | quantità | p10 | p50 | p90 |
> |---|---|---|---|
> | entropia normalizzata (1 = piatta) | 0.919 | **0.967** | 0.988 |
> | gap top1−top2 (frazione di massa) | 0.007 | **0.044** | 0.138 |
> | peso del top-1 | 0.171 | **0.219** | 0.300 |
>
> **Il router non è quasi MAI confidente.** Quota di posizioni con
> entropia < 0.8 = **0.8%**; sotto 0.5 = **0.0%**. Anche concedendo k=2
> a ogni singola posizione di quel 0.8%, il k medio passerebbe da 6.000
> a 5.968: **niente**. La precondizione dell'idea non esiste.
>
> **E spiega F6 dal di dentro.** Il top-1 porta ~22% della massa routata
> e l'ottavo ~7%: scendere a k=2 conserva ~40% della massa. Ecco perché
> l'accordo argmax a k=2 misurava **0.6905** — non è un caso, è la
> geometria del router. È anche la versione *per-token* di M1 (top-16 =
> 25% della massa sul corpus): il routing è diffuso non solo FRA gli
> esperti, ma anche DENTRO il top-k selezionato.
>
> ⚠️ **Limite dichiarato:** la trace è su `Qwen3.6-35B-A3B-UD-IQ2_M` a
> **k=8**, non su KEXP a k=6. L'entropia è normalizzata sul numero di
> slot quindi il confronto regge, ed è la stessa famiglia — ma la
> conferma sul modello di campagna costa una run tracciata e va fatta
> prima di chiamarla chiusa definitivamente. Il segno però è così netto
> (0.8% contro una soglia che ne vorrebbe ~40%) che un ribaltamento è
> implausibile.
>
> ⚰️ **AUDIT OSTILE SUI KILL (16/08, mimo-v2.5 thinking max): 20 kill su
> 25 corretti, accuratezza 80%. Cinque buchi, e uno è un tesoro sepolto.**
>
> 🏴‍☠️ **(1) IL TESORO: 5.77× di PREFILL GPU misurato e poi RIDOTTO A
> 1.3-1.7× nel nostro stesso sommario.** Verificato al sorgente,
> `reports/moe-gdn-750.md:201-206`, Phase 3, Xiaomi 14 / Adreno 750,
> staccato, llama-bench r=2:
>
> | | pp128 | tg256 |
> |---|---|---|
> | CPU `-ngl 0` | 31.46 | **16.15** |
> | GPU `-ngl 99 -fa off` | **181.65** | 7.07 |
>
> Cioè **prefill GPU 5.77× la CPU**, e il report stesso concludeva
> «GPU-prefill on A7X: **alive and large** — 2.2× (740) to 5.8× (750).
> The TTFT lever is real across the whole A7X installed base».
> **Poi la riga di lane del PLAN l'ha registrato come "prefill GPU
> 1.29-1.7×" e ALIVE.md ha messo la GPU nel cimitero senza distinguere
> decode da prefill.** Una lane dichiarata VIVA dal suo stesso report è
> stata contabilizzata come morta. Ed è su **TTFT**, che questo piano
> chiama «LA priorità user-facing».
> ⚠️ **QUALIFICATORE DECISIVO, che l'audit non mette:** la misura è su
> **Qwen3.5-2B DENSO**, non sul 35B MoE. Per CalaQwen resta la
> Q7-LANDMINE (l'hook expert-ready dello streaming vive solo nel loop CPU
> di `mul_mat_id` → gli esperti del 35B DEVONO stare su CPU). Quindi il
> 5.77× vale per i **densi 2B/4B su Adreno 750-class**, che però sono
> proprio gli slot free-tier/piccoli del listino, e il dolore TTFT
> dell'app è il prefill del prompt di sistema da ~1.4k token — cioè
> esattamente prefill. **Da riaprire come lane TTFT sui densi**, non come
> lane MoE. Cautela: il vecchio claim "1.29× prefill GPU" sul 740 si
> rivelò un artefatto da cold-outlier, quindi il 5.77× va riverificato
> con la stessa severità prima di spenderlo — ma è su un altro device e
> un margine 4× più grande, quindi un artefatto lo spiega male.
>
> ✅ **(2) L'ablazione M4 renorm è il buco più caro, e l'audit ci arriva
> INDIPENDENTEMENTE.** Stesso verdetto già registrato sopra dopo l'audit
> Qwen: `drop_renorm` true di default, mai disattivato in nessun
> `command.txt`, il guadagno di PPL può essere sharpening. L'audit la
> classifica «highest-value missing measurement in the campaign», ~4 ore
> di PC, zero device. Due auditor indipendenti sulla stessa cosa.
>
> ❌ **(3) "Selfspec mai testata sul Jelly" — REFUTATA DA ME, il
> ragionamento è invertito.** L'audit dice: la selfspec è stata uccisa
> sullo Xiaomi dove lo stall è 6%, mentre il Jelly ha 27-30% di stall,
> quindi lì avrebbe «più margine da comprimere». **No: la selfspec non
> comprime i byte, li ESPANDE.** Dato nostro (D1): byte per token emesso
> 174 → 133 → 110 MiB man mano che le migliorie mordono, contro un plain
> a **50-60**. Cioè legge ~2× i byte del plain. Su un device dove i byte
> costano di PIÙ (flash lento), una penale del 2× sui byte fa **più**
> male, non meno. Il Jelly è il device PEGGIORE per la selfspec, non il
> più promettente. La regola "stall alto = più margine" vale per una
> tecnica che nasconde o riduce l'I/O, non per una che ne aggiunge.
>
> 🔧 **(4) Il kernel S2 non è mai stato misurato su silicio SENZA REPACK
> — e costa 5 minuti.** La build S23 ha REPACK ON, e il path fuso di S2
> lo bypassa: è esattamente il motivo per cui perde (restituisce più di
> quanto il taglio di launch compri). Su silicio senza REPACK anche lo
> stock userebbe `vec_dot`, e il taglio 84→28 launch potrebbe vincere.
> **Quel silicio ce l'abbiamo: il PC x86_64.** `results/kernel_s2/` ha la
> correttezza PC PASS ma **nessuna misura di velocità**. Un
> `llama-bench -r 2` ON/OFF chiude la questione. Se vince, il branch (già
> corretto e PR-abile) vale per iPhone Pro / ARM senza REPACK.
>
> 📉 **(5) La componente UX di K-F è stata abbandonata senza decisione.**
> Il kill come tecnica di THROUGHPUT è corretto e pre-registrato. Ma
> p99 −17%, stutter dimezzato e TTFT 12-18 vs 21-22 s a freddo sono
> misurati, e sono stati archiviati come nota fra parentesi invece che
> come decisione. Non serve nessuna misura nuova: i dati sono in
> `results/kf_burst/` e `results/kf_cold_jelly/`. Serve una scelta owner.
>
> **REFUTED (attaccati e hanno tenuto): 20 kill su 25** — F6, GPU decode
> (740 e 750), REAP-50, KEXP-G99, MTP, prefetch cross-layer, politiche di
> cache, taglia cache, ubatch, k<6, drop come leva compute, requant 1c,
> kernel IQ2, typeahead, phase-split, expert-major, predittore di route,
> LFM su G99. Sul drop-come-leva-compute l'audit ha verificato il
> sorgente e conferma: lo slot droppato è ricalcolato con peso zero, il
> matmul non si salta mai.
>
> 🧬 **NOTTE DELL'INVENZIONE (2026-08-15, mandato gualt "trucco mai
> provato"): 10 candidati, 9 kill onesti, UN VINCITORE DI CORSA.**
> Kill: cache-tricks tutti occupati (HOBBIT/DyMoE/SMoE/AdapMoE/
> ExpertFlow/Apple — bibbia related-work in docs/t2-novelty-round1-4);
> similarità e skew morti PER FISICA sui nostri modelli (esperti
> ortogonali cos~0.02; routing ad alta entropia: 96% esperti toccati in
> 300 tok, top-16=25% — LA PERLA: spiega le 45 riletture/tok e valida
> l'architettura hide-latency+weighted-drop); drop-asimmetrico morto
> (XShare: potare in prefill avvelena la KV, MMLU 51→27).
> **🏇 VINCITORE: "DRAFT SENZA STATO" (F)** — selfspec su ibridi con
> draft attention-only e GDN CONGELATO all'ultimo commit: il prefisso
> fantasma sparisce PER COSTRUZIONE, draft più economico, e la
> letteratura 2026 (Component-Aware SSD, arXiv:2605.01106) ha provato
> la POLARITÀ OPPOSTA (draft solo-SSM) fallendo con α=0.038 sui
> sequential hybrid — la loro ablazione predice che la NOSTRA polarità
> vinca. Nessuno l'ha pubblicata. Baseline da battere: 0.038. FRETTA: la
> finestra si chiude in mesi (ReplaySSM giu-2026, C-A mag-2026).
> **E4 IMPLEMENTATA (2026-08-15 pomeriggio, kalsa/selfspec-f1 @
> dc944f5, 11 commit):** spec docs/e4-stateless-draft-spec.md (as-built
> annotata); freeze = skip-write via eval-callback (nop del nodo store
> CPY/DUP, MAI snapshot/restore); catch-up con seq_rm SOLO-attention
> (scoperta review R1-F1: il seq_rm ibrido stock riavvolge R/S dai
> piani snapshot che i draft frozen non scrivono — il veleno rientrava
> dalla finestra); gate S2/S3 bitwise contro riferimenti shape-mirrored
> (R2-F1: batch-vs-serial >1e-3 al 100% su questo engine, tolleranze
> larghe VIETATE); verdetto automatico prima riga SUMMARY
> (GO≥0.60+EL1.5 / MARGINAL / DEAD<0.30 / PRODUCT per k2/k6 /
> BLOCKED). Audit: 3 round ostili + pass finale 3-auditor
> (deepseek/hy3/mimo) + conferma — tutto verde, ctest 11/11.
> Letteratura (RELATED.md nel task dir): SP-MoE, C-A SSD (α=0.038 è
> ALL-TOKEN a k=2 — confronto onesto = alpha_alltok), ReplaySSM (stesso
> primitivo skip-write, uso diverso: I/O non drafting — conferma
> indipendente + urgenza), LayerSkip (early-exit 50% su ibridi
> sequenziali = α 0.000: MAI saltare i GDN, solo congelarne la
> scrittura). RUNNER NOTTURNO ARMATO: results/selfspec_e4/
> run_e4_arms.py (PID in runner.pid.txt) aspetta fine dropcurve →
> A2 G=8 (refs O(B²/G) più economici) → A1 G=4 (headline) → A3 k2
> (prodotto). Poi, se GO: F5 loop reale; cella device su S23 con
> CalaQwen IQ2_M (modello già a bordo, serve build Android).
> **🚨 E4 PRIMO RISULTATO REALE (2026-08-16 01:54, CalaQwen-35B PC,
> rev c977d58, wall 4073s): A2 G=8 →
> `E4_GO_PENDING_G4(alpha1=1.000, EL=3.556)`. Tutti e quattro i gate
> BITWISE VERDI (S1 identity 300/300 dlogit=0 dopo il fix ref-su-ctx_dft;
> S2 leftover 38/38=0; S2 freeze-read 38/38=0; S3 post-catch-up 37/37=0):
> il congelamento NON contamina e il catch-up ricostruisce esattamente.
> Curva accettazione: α_s0 0.974 · **α_s1 1.000** · α_s2 0.789 ·
> α_s3 0.579 · α_s4 0.486 · α_s5 0.541 · α_s6 0.378 · α_s7 0.378 —
> macro 193/300 = 0.643, **E[L] = 3.556 token per verify a G=8**.
> Confronto onesto col paper mirror (Component-Aware SSD, polarità
> opposta, α=0.038 all-token a k=2): il nostro α_s1 = 1.000 e il macro
> 0.643 stanno **oltre un ordine di grandezza sopra**. `alpha_alltok(G=8)
> = 0.000` è atteso (richiede 8/8 token corretti di fila).
> **🏆 A1 G=4 — VERDETTO UFFICIALE (2026-08-16 03:39, wall 6303s):
> `E4_GO(alpha1=0.987, EL=2.995)`. Gate di nuovo tutti bitwise (S1
> 300/300, S2 75/75, S2 freeze-read 75/75, S3 74/74, max|dlogit| = 0).
> α_s0 0.947 · α_s1 0.987 · α_s2 0.733 · α_s3 0.627 → macro 247/300 =
> **0.823**, **E[L] = 2.995 token per verify**. E soprattutto:
> **alpha_alltok(G=4) = 0.413** — QUESTO è il numero confrontabile col
> paper specchio (Component-Aware SSD, α=0.038 all-token): ~11× sopra,
> a parità di k.
> **🏁 A3 PRODOTTO (04:24, wall 2711s): `E4_PRODUCT(alpha1=0.867,
> EL=2.029)` a draft k=2 / verify k=6. Gate di nuovo tutti bitwise.
> α 0.800 · 0.867 · 0.547 · 0.413 → macro 0.657, E[L] 2.029,
> **alpha_alltok = 0.173 — QUESTO è il confronto apples-to-apples col
> paper (0.038 a k=2): 4.6× sopra, stesso budget di draft, polarità
> opposta.** E4_ARMS_DONE, tre bracci su tre.
> **MA: E[L] NON è speedup.** E[L] = Σ prodotti-prefisso = draft
> ACCETTATI per ciclo (session.cpp:2458), +1 dal verify → 3.03 token per
> ciclo a k2γ4. Il loop vince solo se γ·costo(draft k2) + verify-batch +
> catch-up < 3.03 passi a k6, e il termine ignoto è l'overlap di batch:
> la NOSTRA misura di entropia (96% esperti in 300 tok, top-16=25%, 45
> riletture/tok) dice che token consecutivi routano a insiemi quasi
> DISGIUNTI → il batch di verify streamma ~5×, non 1×. Quindi il premio
> non è il batching ma il draft più economico — ed è esattamente perché
> F1 misurò 0.37×. **PREDIZIONE REGISTRATA per F5: estendi γ solo finché
> il prodotto-prefisso supera k_d/k_v (0.33) → γ=3 ottimo a k=2, γ=4 già
> sovra-esteso; a k pari (ratio 1.0) NESSUNO slot qualifica — a1/a2 sono
> bracci scientifici, mai candidati prodotto.**
> **🔥 F5 — L'INVENZIONE FUNZIONA NEL LOOP VERO (2026-08-16, 35B hybrid,
> 256 token, k2/k6 γ=4, `--chatml`): freeze OFF alpha di loop 8.6%
> (51/594), 1.25 token/verify · freeze ON **24.6% (126/512), 1.97
> token/verify**. **2.9× di alpha cambiando SOLO il flag.** Il braccio
> OFF riproduce la baseline pubblicata di F1 (0.117), quindi il
> confronto è pulito. Riprodotto su DUE binari diversi (d31ad8d
> 08d16910 e 2a7f365 524973b8) con conteggi BIT-IDENTICI — greedy
> deterministico, e vale anche da regressione del fix round.
> Meccanismo: senza freeze ogni rifiuto riavvolge lo stato ricorrente
> dai piani snapshot, ed è proprio il restore che E4 aveva dimostrato
> sbagliato (R1-F1); col freeze non c'è riavvolgimento, la riga viva È
> s_t0. L'alpha guadagnato è la rimozione di un difetto di stato, non
> un bonus. RAM: 251.25 MiB risparmiati a γ=4 (misurato).
> **MA sul PC la selfspec PERDE comunque** (5.99 plain vs 1.82
> effettivi) e il prefill quasi raddoppia (19.1→37.0s: il contesto
> draft rifà il prefill del prompt). Il caso velocità vive o muore su
> flash — arm D1. Codice: 3 round di audit ostile, 6+2+? findings
> CONFIRMED, tutti chiusi con test-che-falliva-prima.
> results/selfspec_f5_pc/.**
> **🧪 F5 CHAT MULTI-TURNO (16/08 mattina) — la prova nel caso d'uso
> vero.** Sonda `chat_multiturn.py` via `bmoe-cli --session`, 3 turni,
> `clear_kv:false` dal 2°: **senza freeze l'accettazione decade 3.9×
> lungo la conversazione (0.117 → 0.100 → 0.030); col freeze non
> decade (0.183 → 0.275 → 0.138), al 3° turno 4.6×.** Token emessi
> identici nei due bracci (governa il target). Freeze verificato per
> run dall'allocatore (draft ctx n_rs_seq=0 / 62.81 MiB), non assunto.
> Braccio flag-off BIT-IDENTICO prima e dopo i fix: la feature non
> tocca chi non la usa.
> **AUDIT: 3 round + 3 finali su angoli/modelli diversi → 11 finding
> CONFIRMED, 6 chiusi con test-che-falliva-prima (F5 fix a b3eb60c).
> E TRE spiegazioni alternative proposte dagli auditor SONO CADUTE SUI
> DATI:** (a) "il riuso del grafo vanifica il freeze" → 512 draft/130
> cicli ≈ γ=4 e canary muto; lo skip-write vive nell'ask di compute,
> non nel build; (b) "il guadagno viene da clear+rebuild a ogni
> rifiuto" → un prefill costa 39s e p2 ha fatto 130 cicli in 187s, e
> ha letto 32.8 GiB contro 51.8; (c) "il modello di chat è non-hybrid"
> → l'allocatore nei log stessi dice n_rs_seq=0/62.81 MiB.
> **RITRATTAZIONE ONESTA:** la prima tabella di velocità F5 misurava
> prefill, non decode (le run avevano generato 1 token; nessun gate di
> validità). Ritirata. Ne è uscito però un costo reale: **la selfspec
> quasi raddoppia il prefill (+94%)** perché il contesto draft rifà il
> prefill del prompt — non ammortizzabile su risposte corte.
> results/selfspec_f5_pc/ (REPORT + 5 audit archiviati).
> Report completo: reports/moe-selfspec-e4.md. Spec F5 aggiornata
> (arm D2 = γ ∈ {2,3,4}). **F5 NON lanciato: il classifier ha bloccato
> l'avvio di grok con --always-approve mentre l'owner dorme — prompt
> pronto in scratchpad/agents/f5-impl/prompt.md, serve ok owner.**
> **F5 SPEC SCRITTA (docs/f5-stateless-loop-spec.md) — e rileggendo F1 è
> saltato fuori che il premio grosso non è la velocità ma la RAM: il
> loop F1 deve chiedere `n_rs_seq = draft_max` snapshot ricorrenti sul
> contesto draft = **251.25 MiB di snapshot a γ=4 su questo 35B** (MISURATO
> 2026-08-16: buffer RS 314.06 MiB a n_rs_seq=4 contro 62.81 a 0; la riga viva
> resta). Col congelamento il
> draft non scrive MAI stato ricorrente e il rollback è solo-attention →
> `n_rs_seq = 0`, quei 251.25 MiB non vengono allocati e γ diventa gratis
> in memoria. Su un telefono da 8 GB è un fatto di prodotto anche se la
> velocità non paga. ATTENZIONE ONESTÀ: gli α di E4 sono teacher-forced
> (classe F0 0.6991); il loop vero F1 è crollato a 0.117 — l'α di loop
> lo dà solo F5, non si cita 0.643 come numero di loop.**
> **DROPCURVE VERDETTO (notte 15-16/08): DROPCURVE_OPTIMUM(dstar=0.5,
> dMacro=−0.0150). IL CLAIM VIVE: potare gli esperti freddi MIGLIORA
> la PPL multilingue — minimo reale a d=0.5 (−0.0015 sotto k6d0,
> −0.0150 sotto k8), rumore run-to-run 1e-6 (continuità d065 e d1.0
> riprodotte a 6 e 4+ decimali: protocollo deterministico, corpus
> fisso — la generalizzazione cross-corpus resta il vero margine).
> Curva: d0 −0.0135 · d0.3 −0.0122 · d0.5 −0.0150 · d0.65 −0.0086 ·
> d0.8 +0.0047 · d1.0 +0.0378. Nota prodotto: la certificata d0.65 è
> leggermente OLTRE l'ottimo; d0.5 = +qualità, −risparmio I/O —
> ritocco a discrezione owner. results/mellum2_dropcurve/.**
> 3 survivor ingegneristici senza claim (controller stutter
> ExpertFlow-style, repack lazy hot ×1.27, corazza anti-zram).**
> 📈 **DROPCURVE CALAQWEN (16/08, IN CORSO sul PC) — l'expert skipping è
> la leva viva della campagna, e la qualità a d0.3 è GRATIS.**
> Stesso protocollo della curva Mellum ma sul modello di campagna
> (`Qwen3.6-35B-A3B-KEXP`, sha ac44e20c…), 5 lingue multi5, ~59k token
> per braccio, identity MATCH (modello + binario + 5 DLL).
>
> | drop | macro bpb | vs k6d0 | gate |
> |---|---|---|---|
> | 0.0 | 0.6781 | — | GATE_PASS |
> | **0.3** | 0.6785 | **+0.0004 (+0.06%)** | GATE_PASS |
> | 0.8 | 0.6889 | +0.0109 (+1.6%) | GATE_PASS |
> | 1.0 | in corso (en: bpb 0.6021) | — | — |
>
> **Il costo NON è lineare: piatto fino a 0.3, poi sale piano.** A d0.3 il
> +0.06% è sotto qualunque soglia di rilevanza — qualità gratis. La sonda
> preliminare aveva già deciso di fermarsi a 1.0 (rifiuta d>1.0), quindi
> k6d12/k6d15 non girano.
>
> ⚠️ **I TEMPI DI QUESTA CELLA NON SONO CONFRONTABILI FRA BRACCI — e va
> detto prima che qualcuno ci costruisca sopra.** Ogni braccio ha girato
> con una quantità DIVERSA di contesa CPU da altri job: d0.0 all'8% del
> suo wall, d0.8 al 100% (sonda F6 addosso), d0.3 al 100% (ed è infatti
> il più lento misurato, 4.589 tok/s — contesa pura), d1.0 a contesa
> ZERO (F6 uccisa alle 19:2x, braccio partito alle 19:50). Il d1.0 su en
> misura 8.822 tok/s contro i 5.577 di d0, ma **quel +58% è gonfiato
> dall'avere la macchina da solo**. Le bpb sono deterministiche e salve;
> i tempi no. **La cella che manca è quindi: throughput E BYTE, senza
> contesa, tutti i bracci nelle stesse condizioni** — e i byte non sono
> mai stati strumentati in questa cella (`per_token.csv` ha solo
> pos,token_id,logprob). È il lavoro numero uno appena il PC si libera.
> results/calaqwen_dropcurve/.
> 🧮 **L'INVARIANTE CHE DECIDE TUTTO (16/08, brainstorm con Qwen 3.8
> Max, verificato da me).** Con verifica a batch: byte/token =
> `[γα + (γ+1)β]/L` e `L ≤ γ+1`; con verifica sequenziale early-stop:
> `β + γα/L`. **Se β ≥ 1, byte/token ≥ 1 ANCHE con draft gratis (α=0):
> la speculazione al massimo PAREGGIA, non vince mai.** Quindi l'unica
> via è **β < 1**: la verifica deve leggere meno byte di una
> generazione normale. Conseguenza immediata: la direzione "draft a
> zero byte" (che avevo messo prima) non poteva funzionare da sola —
> ottimizzava il termine da 1.33 lasciando quello da 5.0. E il prefetch
> non tocca i byte per definizione. **L'unica porta aperta: certificare
> costa meno che generare.** Generare vuole l'argmax su tutto il
> vocabolario → tutti i 6 esperti. Certificare un candidato vuole solo
> mostrare che vince → può bastare un bound sul contributo dei mancanti.
> ☠️ **PROBE F6 — DEAD ON BYTES (16/08, chiusa).** Accordo argmax a
> k=2..5 contro k=6, teacher-forced su CalaQwen, EXACT-RESTART, d0,
> 1037 posizioni × 4 set (fact/creative/longfact/code). Break-even
> dichiarato prima: β < 0.56 → meno di ~3.3 esperti medi. **Check
> dell'harness superato in pieno: k=2 = 0.6905, identico a F0 a quattro
> decimali** — quindi il DEAD è un dato, non un bug sospetto.
>
> | j | accordo | n | esperti medi | β |
> |---|---|---|---|---|
> | 2 | 0.6905 | 1037 | 3.24 | 0.540 |
> | 3 | **0.8120** | 1037 | 3.56 | **0.594** |
> | 4 | 0.8640 | 1037 | 4.27 | 0.712 |
> | 5 | 0.8685 | 555 (parziale) | 5.13 | 0.855 |
>
> k=3 cade in pieno nella banda DEAD pre-dichiarata (0.75–0.85) contro
> una soglia GO di ~0.95. **Solo j ≤ 3 poteva funzionare**: a j=4 il
> pavimento è già 4/6 = 0.667 > 0.56, a j=5 è 0.833 — cioè j≥4 fallisce
> per costruzione anche con accordo perfetto. j=3 sbaglia del 6%; j=2 dà
> 0.540, nominalmente sotto soglia del 3.6%, ma **l'accordo argmax è un
> UPPER BOUND sulla certificabilità** (certificare richiede di provare
> il vincitore con un bound sui mancanti, test più stretto del semplice
> "l'argmax ha coinciso"): costruirci sopra vuol dire costruire sulla
> barra d'errore. Split per dominio come in F0: longfact/code 0.85-0.92,
> fact/creative 0.52-0.86 — sopravvive sul testo prevedibile, non sui
> token difficili.
>
> **La ragione vera che ritira la tecnica è che la baseline si è mossa,
> ed era la nota onesta registrata in anticipo.** La drop curve conferma
> il premesso dall'altro lato: droppare gli esperti freddi a 0.8 costa
> **+0.0109 macro bpb (+1.6%)**, GATE_PASS. La qualità non ha bisogno di
> sei esperti. Quindi il confronto giusto per β non è contro il plain
> k=6 ma contro il plain GIÀ alleggerito, che legge molti meno byte e non
> vuole draft, verify, rollback né stato ricorrente congelato.
> (Scope: il +1.6% è una misura di QUALITÀ; il risparmio in byte di
> `--drop-cold-experts` è lo scopo del flag ma non è misurato in quella
> cella — l'argomento regge sulla direzione, non su una magnitudine non
> misurata.)
>
> **Buco dichiarato, non aggirato:** i margini top1-top2 sotto set
> parziali — la quantità che predice davvero il costo di uno schema
> adattivo — **l'engine non sa emetterli** (`engine_top2_logits: false`;
> il `--ppl-csv` dà il logprob del solo token gold). Nessun margine è
> stato inventato. Non cambia il verdetto (il pavimento j≥4 è
> strutturale e j≤3 non ha spazio) ma è l'unica porta lasciata chiusa, e
> aprirla richiede una modifica all'engine.
> Chiusa per decisione owner appena il verdetto è stato determinato:
> k=1 mai partito, k=5 parziale (555/1037), entrambi dichiarati.
> Nessun timing riportato (macchina condivisa con la drop curve; le
> quantità misurate sono deterministiche). ~5 ore di sonda hanno ucciso
> una tecnica che sarebbe costata settimane. results/f6_certify_probe/.
>
> ☠️ **"DRAFT BY DROP" — MORTA IN 2 ORE, PRIMA DI SCRIVERE UNA RIGA
> (16/08, audit Qwen 3.8 Max su docs/qwen-prompt-drop-draft.md).**
> Proposta: usare `--drop-cold-experts 0.8` come DRAFT e il config pieno
> come VERIFY → output bitwise identico al modello pieno, e finalmente
> il "draft 5-10× più economico della stessa famiglia" che avevo
> dichiarato mancante quando ho scartato la coppia densa 2B/4B (rapporto
> 0.755, troppo vicino). **Falsa.**
>
> **L'errore, mio, grave: ho assunto c_draft = 0.2 senza misurarlo.**
> Il nostro stesso dato dice 6.401 vs 5.807 tok/s → il config drop-0.8
> costa **0.91×** il pieno, non 0.2×. Droppare l'80% degli esperti
> FREDDI non è droppare l'80% del LAVORO, e la nostra throughput lo
> dimostrava già. Quindi il draft economico **non esiste**: 1.1×, cioè
> *peggio* del 4B/2B a 0.755 che avevo già scartato per questo motivo.
> Conseguenza aritmetica (γ=4, c_v=1, accettazione PERFETTA):
> `L_max/(4·0.91+1) = 5/4.64 = 1.08×`. Con c_v=2 → **sotto 1**. Morta
> prima ancora di parlare di accettazione. Il numero era nel prompt,
> nella sezione 4, e l'ho contraddetto nella sezione 5.
>
> **Secondo colpo — bpb NON è un proxy dell'accettazione.** La bpb è
> liscia, l'accettazione greedy è una soglia sul margine top1-top2:
> p=[0.501,0.499] vs q=[0.499,0.501] ha cross-entropy quasi identica e
> ribalta l'argmax il 100% delle volte. Pinsker (TV ≤ √(Δ/2)) lega la
> KL all'accettazione **campionata**, non a quella greedy. Quindi il
> ponte "+1.6% bpb → il draft sbaglia poco" è un non sequitur.
> **E c'è di peggio, deducibile dai nostri dati senza misurare nulla:**
> se ~5 dei 6 esperti sono freddi, drop-0.8 ne butta ~4 e ne tiene ~2 —
> cioè un k≈2 scelto per RESIDENZA invece che per rango del router.
> Il top-2 (la scelta MIGLIORE) dà 0.6905 di accordo; una scelta peggiore
> non può fare meglio. **α del draft-by-drop ≲ 0.69, non 0.9.**
>
> **Terzo colpo — osservazione che non era nostra: la cache è un secondo
> stato non riavvolgibile.** Abbiamo congelato il GDN, ma il draft che
> carica/sfratta esperti sporca la expert-cache, e quelle side effect
> **sopravvivono al rigetto**. Se il draft è resident-only non inquina ma
> non scalda nulla di utile; se carica esperti freddi inquina. Nessun
> pasto gratis. In più il draft diventa NON stazionario: dipende da
> LRU e dalla storia di accept/reject, quindi ogni misura teacher-forced
> è strutturalmente cieca su questo.
>
> **Anche il verify batch a costo 1 era ottimistico, e contraddiceva un
> nostro risultato:** con token consecutivi che routano a esperti quasi
> disgiunti (96% toccati in 300 token — la nostra misura), un batch da 5
> tocca ~5× i pesi, non 1×. È esattamente il motivo per cui avevo detto
> che il batching non ammortizza su questo MoE.
>
> **Dove Qwen è pessimista senza che cambi il verdetto:** stima la
> residenza con routing uniforme (2000 MiB/13.4 GB → ~38 esperti su 256
> → ~0.9 hit su un top-6). Il nostro routing è skewed e l'LRU lo sfrutta:
> `hit_pct` misurato nelle celle K-F sta a ~52%, non 15%. Ma non salva
> niente, perché l'ancora decisiva (c_d = 0.91) è **misurata in wall
> clock** ed è indipendente da quel conto.
>
> **Verdetto: la proposta ha una storia di CORRETTEZZA ma non di
> PRESTAZIONI.** In regime I/O-bound l'invariante la uccide (verify
> esatto → β=1). In regime compute-bound è morta sull'aritmetica con
> numeri che avevamo già. Nessuna misura da fare: la sonda argmax che
> avevo pianificato è un gate asimmetrico (male → uccide, bene → non
> salva), quindi non la lanciamo.
> **Cosa sopravvive e va spedito da solo:** `--drop-cold-experts` come
> MODALITÀ VELOCE LOSSY, senza speculazione sopra. Curva qualità:
> d0.3 = **+0.06%** bpb (gratis), d0.8 = +1.6%. Manca la misura che la
> rende spedibile: **throughput E byte, senza contesa** (la cella attuale
> non ha strumentato i byte e i timing sono confusi dalla sonda F6).
>
> 💡 **CINQUE DIREZIONI NUOVE (16/08, generate rileggendo tutta la
> campagna; in audit da Qwen 3.8 Max — `docs/qwen-prompt-5-wild-ideas.md`).**
> Ognuna è ancorata a una NOSTRA misura, non a un'intuizione, e **quattro
> su cinque hanno un test decisivo che costa ZERO tempo device** perché
> gira sulle route trace che abbiamo già. Nessuna è approvata: sono in
> attesa del verdetto "già pubblicata / morta di fisica / test non
> decisivo".
>
> **(1) EXPERT-MAJOR DECODING — l'unica che può riaprire β<1.** I token
> consecutivi routano a esperti disgiunti (M1), ma quello che determina
> il traffico flash non è la SOMMA (6B) bensì l'**UNIONE** degli esperti
> del batch. Riordinare il calcolo per-esperto invece che per-token:
> carichi E una volta, lo applichi a tutti i token del batch che lo
> vogliono. Se `|unione(B)|/B < 6` allora **β < 1** e tutto il caso
> speculazione chiuso da M2/M3 si riapre su un meccanismo diverso.
> Test: calcolare il rapporto di unione per B=2,4,8,16,32 dalle trace
> esistenti. Kill: rapporto piatto a 1.0 (routing troppo entropico).
> Da chiedere: è lo scheduling standard dei MoE server (expert
> parallelism DeepSpeed-style) riletto con un collo di bottiglia nuovo?
>
> **(2) k ADATTIVO SULLA CONFIDENZA DEL ROUTER.** Il router gira sulla
> parte densa, già residente → la sua uscita è disponibile **prima di
> leggere un solo byte di esperto**. Gate top-1 dominante → k=2; gate
> piatta → k=6. E a differenza del drop (M5, solo-I/O), **k taglia byte
> E compute**. Test: binnare le posizioni per entropia del router e
> misurare l'accordo argmax di k=2/k=3 dentro ogni bin. Kill: accordo
> piatto fra i bin (la confidenza del router non predice la stabilità
> dell'argmax) — kill pulito e a costo zero.
>
> **(3) PREDITTORE DI ROUTE DALLO STATO RICORRENTE CONGELATO.** Non
> predire il TOKEN, predire l'INSIEME DI ESPERTI. Sonda lineare dallo
> stato GDN (62.81 MiB, in RAM, che sappiamo leggere bitwise — M6) verso
> 256 punteggi. Predire un insieme è molto più facile che predire un
> argmax, e costa **zero byte di flash** — attacca esattamente il modo in
> cui K-F ha fallito (M7: +14% di byte per nascondere lo stall). Test:
> allenare offline su trace e misurare la recall top-6 a un token di
> anticipo, contro due baseline (K-F 76% e "gli esperti del token
> precedente"). Kill: se la baseline banale pareggia la sonda. Il combo
> ibrido+streaming è dove forse siamo soli.
>
> **(4) MASCHERE DI ESPERTI PER LINGUA, SPEDITE COME METADATA.** Se il
> miglioramento di PPL a drop 0.5 (M4) è perché gli esperti freddi sono
> RUMORE sotto-allenato per il dominio corrente, allora una maschera
> scelta **per lingua** deve battere una scelta per residenza in cache,
> che con la linguistica non c'entra nulla. Istogramma offline per
> lingua → maschera statica → metadata nel GGUF → detect lingua dai primi
> token. Test: multi5 che abbiamo già, confronto **a parità di byte**.
> Kill: nessun vantaggio a parità di byte (e allora M4 resta un mistero
> più profondo, non risolto). **Ho chiesto esplicitamente a Qwen di
> ATTACCARE M4**: un miglioramento di PPL togliendo calcolo è il tipo di
> risultato che di solito è un artefatto, meglio saperlo prima.
>
> **(5) QUANTIZZAZIONE PER TEMPERATURA.** Buttare un esperto è il caso
> estremo di quantizzarlo a zero bit; la versione continua dovrebbe
> dominare quella binaria. Caldi Q5/Q6, tiepidi Q4, coda fredda Q2 — un
> solo GGUF, precisione per-esperto chiavata sulla frequenza di accesso
> **misurata** (non su statistiche dei pesi). È l'unica che taglia byte
> senza policy e senza dirupo di qualità: è un cambio di formato file,
> non una scommessa a runtime. **Kill noto in anticipo, e ci ha già
> fregati due volte (KEXP-G99, REAP): su silicio debole meno byte ≠ più
> decode** — KEXP su G99 era dequant-bound sui 2×A76 (8.83 contro una
> proiezione 14.7). Il test DEVE misurare il decode sul device DEBOLE,
> non i byte sul forte.
>
> ⚖️ **AUDIT QWEN SULLE 5 IDEE (16/08) — ranking, due kill, e un colpo
> al cuore di M4 che ho dovuto verificare al sorgente.**
> Ranking per valore atteso: **(2) k adattivo > (5) quantizzazione per
> temperatura > (4) maschere per lingua > (3) predittore di route >
> (1) expert-major**. Le prime due sopravvivono, le ultime due sono da
> archiviare, la (4) è sospesa in attesa di un'ablazione.
>
> ☠️ **IDEA 1 (expert-major) — MORTA per il nostro regime.** L'aritmetica
> dell'unione con la NOSTRA skew: B=8 → 42/48 = 0.88; B=16 → 0.81;
> B=32 → 0.65. Serve **< 0.56**, cioè B≈64, e su un telefono
> single-user quei 64 token non esistono. Due argomenti che mi ero
> perso: (a) **in una sequenza causale singola non puoi riordinare per
> esperto** perché le route future non le conosci finché non le hai
> calcolate — l'expert-major funziona su item di batch INDIPENDENTI,
> non su un'autoregressione; (b) **se la cache LRU tiene ~38 esperti e
> l'unione di 5 token è ~28, la cache sta GIÀ leggendo l'unione e non
> la somma** — l'expert-major aiuterebbe solo se il nostro chunking
> fosse rotto. E lo scheduling per-esperto è standard nei sistemi MoE
> (DeepSpeed-MoE, Megablocks, Tutel, FasterMoE). Archiviata.
>
> ☠️ **IDEA 3 (predittore di route) — MORTA, e l'errore era retorico.**
> Avevo venduto "legge zero byte di flash". Vero e **irrilevante**: il
> predittore legge zero byte, ma **il prefetch che ne consegue li
> legge**. È esattamente M7 (76% di precisione, +14% byte, −4.3% wall).
> Un predittore migliore deve battere non il caso ma l'ECONOMIA dei
> byte sprecati, e la metrica giusta non è la recall top-6 ma il
> *guadagno wall per byte extra prefetchato*. In più è pubblicata
> (ExpertFlow, MoE-Infinity, Pre-gated MoE); l'unico angolo forse nuovo
> era l'input SSM/GDN, ma la novità dell'input non ripara l'economia.
>
> ✅ **IDEA 2 (k adattivo sulla confidenza del router) — RANK 1, e il
> caveat di Qwen NON ci si applica.** Lui avverte: "se l'output esatto
> a k=6 è un vincolo duro, l'idea muore". **Da noi non lo è**: la
> ricetta certificata SPEDISCE già `--n-expert-used 6` (da k=8) e
> `--drop-cold-experts 0.65`, cioè una config lossy passata da un gate
> PPL. L'idea sta dentro il contratto che abbiamo già. Resta l'obiezione
> teorica seria: **la gate del router misura la preferenza di ROUTING,
> non la decisività dell'OUTPUT** — un esperto con gate piccola può
> comunque ribaltare l'argmax se il margine top1-top2 è sottile.
> Test aggiornato (migliore del mio): non solo accordo per bin, ma anche
> **k medio implicito + bpb su held-out + confronto contro k statico E
> contro drop-cold a parità di byte/compute**. Kill: accordo piatto fra
> i bin, o bin ad alta confidenza troppo piccoli per muovere il k medio.
>
> ✅ **IDEA 5 (quantizzazione per temperatura) — RANK 2, la più
> spedibile e la meno originale** (MoQE, QMoE, HAQ/HAWQ). Sequenziamento
> di Qwen, migliore del mio: **prima il microbenchmark di dequant sui
> formati candidati sul device DEBOLE**, poi si costruisce il GGUF misto.
> Così sai quali formati sono permessi prima di spendere la pipeline.
> Rischio aggiuntivo che non avevo scritto: la frequenza di accesso è
> corpus-dipendente — un esperto freddo nel nostro istogramma può essere
> caldo per una lingua a bassa risorsa, per il codice o per la matematica.
> **La PPL macro nasconde il fallimento sulle route rare** → misurare la
> qualità CONDIZIONATA ai token che routano sugli esperti a bassa
> precisione, non solo la media.
>
> 🔬 **IDEA 4 / M4 — IL COLPO GROSSO, E LA VERIFICA AL SORGENTE.**
> Qwen sostiene che M4 (drop 0.5 MIGLIORA la PPL) ha una spiegazione
> banale: dato che lo slot droppato è ripuntato sul top expert (M5),
> l'intervento non sarebbe "togli l'esperto freddo" ma
> `y' = y − g_j·E_j + g_j·E_top`, cioè **un boost del top expert**.
> **VERIFICATO AL SORGENTE (`router_hook.cpp:267-268`): la formula di
> Qwen è SBAGLIATA.** Il peso viene messo **a zero**, non trasferito:
> `*weight_at(...) = 0.0f; *id_at(...) = best_id;` — e il commento dice
> perché il repoint esiste: far leggere al kernel memoria valida «and
> multiply it by exactly zero». Il dot duplicato contribuisce ZERO.
>
> **MA la sua intuizione si salva su un altro ramo, e questo cambia
> tutto: `drop_renorm` è TRUE di default** (`config.h:175`; si spegne
> con `--drop-no-renorm`), e **la dropcurve NON lo ha mai spento**
> (verificato nei `command.txt`). Quindi il codice che gira è
> `router_hook.cpp:278-282`: i sopravvissuti vengono riscalati per
> `total/kept > 1`. E siccome **il top expert non è mai droppabile**
> (riga 262, `k != best`), la rinormalizzazione concentra massa su un
> insieme superstite top-heavy. **Cioè: è mixture sharpening.**
> Formula vera: `y' = (total/kept) · Σ_{superstiti} g_i·E_i(x)`.
> Quindi il miglioramento di PPL può venire dallo SHARPENING e non dal
> togliere rumore — Qwen ha sbagliato il meccanismo e azzeccato la
> sostanza. **Non si costruiscono maschere per lingua finché M4 non è
> spiegata.**
>
> 🎯 **E L'ESPERIMENTO DECISIVO È UN FLAG CHE ABBIAMO GIÀ.**
> Bracci: (A) d=0.5 renorm ON = comportamento attuale · (B) d=0.5
> **`--drop-no-renorm`** = rimozione pura senza riscalatura ·
> (C) d=0 baseline · (D) controllo di Qwen: drop di esperti **a caso**
> allo stesso conteggio, renorm ON.
> Lettura: **A > B ≈ C → il guadagno è la rinormalizzazione**, l'idea 4
> è costruita sulla sabbia — ma avremmo trovato una **leva di qualità
> gratis che non richiede NESSUN risparmio di byte** (basta sharpare le
> gate). **A ≈ B > C → il rumore degli esperti freddi è reale** e
> l'idea 4 vive. Se anche (D) migliora, è sharpening puro.
>
> ⚠️ **E una nota di onestà che indebolisce M4 già ora:** il
> miglioramento sotto zero è un risultato **MELLUM** (d0.5 = −0.0150).
> Sulla curva CalaQwen il minimo è a d=0 (0.6781) e d0.3 sta
> marginalmente SOPRA (+0.0004) — cioè su CalaQwen il miglioramento
> **non si vede**. Prima di chiamarlo "il nostro risultato più strano"
> va detto che finora è di un modello solo.
>
> **Cosa NON tocca:** quel che resta di F5 è intatto e resta vero —
> l'acceptance quasi raddoppia come meccanismo di CORREZIONE (loop alpha
> 8.6% → 24.6%) e il freeze salva **251.25 MiB** misurati di RAM. Non
> erano claim di throughput in byte. **Il caso BYTE della decodifica
> self-speculative su questa architettura è chiuso.**
> **DENSI (Qwen3.5 2B/4B, misurato su Xiaomi 16/08):** `qwen35` = denso
> MA IBRIDO (24 layer GDN su 32) → il freeze serve anche lì, e stando in
> RAM il batch AMMORTIZZA (prefill/decode = 2.33×), cioè il regime dove
> la speculazione può pagare. **MA il 4B ha 2.24× i pesi del 2B e va
> solo 1.32× più lento** → draft/target = 0.755, troppo vicino: con γ=4
> spendi ~3 passaggi-target per guadagnarne ~2.4. Servirebbe un draft
> 5-10× più economico (un ~0.6B della stessa famiglia), che non abbiamo.
> `--ngram` provato: drafta sul 2.5% dei passi (testo non ripetitivo),
> inutile. **E varianza del device ±50% fra run consecutive (3.99 →
> 8.27 tok/s stesso modello/config): qualunque claim di velocità sui
> densi richiede coppie ABBA, due run back-to-back non provano nulla.**
> ⛔ **F5 ARM D1 SU FLASH (16/08, Xiaomi, ESPLORATIVO): NULL. La
> self-speculation perde anche su telefono.** 12/12 run valide,
> intercalate a/b/c/d × 3, n=200, staccato 70→46%, 28.9→40.1 °C.
> plain **1.654 tok/s** · freeze OFF γ4 0.563 (**0.34×**) · freeze ON γ4
> 0.657 (**0.40×**) · freeze ON **γ3 0.720 (0.44×)**. Il freeze fa il
> suo (alpha 13.9→23.6%, RS 314.06→62.81 MiB) e γ=3 batte γ=4 come
> predetto — ma serve 2.3× e se ne recupera 1.3.
> **IL DATO CHE ORIENTA IL SEGUITO: i byte per token emesso scendono
> 174 → 133 → 110 MiB man mano che le migliorie mordono.** Il plain sta
> a ~50-60. Quindi non è "non funziona": **manca ~2×, e la grandezza su
> cui prenderlo è nota**. La speculazione su questo modello LEGGE PIÙ
> byte di quanti ne risparmi (verify batch senza ammortamento: token
> consecutivi routano a esperti quasi disgiunti — la stessa entropia
> misurata nella notte dell'invenzione). Direzioni aperte (brainstorm
> in corso, anche con Qwen 3.8 Max): (1) draft che leggono ZERO byte
> nuovi (solo esperti già residenti in cache / shared expert); (2) un
> solo contesto con k commutato → via il prefill doppio (+94%) e la KV
> in più; (3) **ribaltare il draft da generatore a PREDITTORE per il
> prefetch**, per nascondere lo stall invece di saltare decodifiche;
> (4) verify più magro sfruttando il drop già certificato.
> results/selfspec_f5_d1_xiaomi/.
> ❄️☠️ **CELLA K-F A FREDDO SUL JELLY — COMPLETA 24/24, VERDETTO NULLO
> CHE PENDE CONTRO. KF_SHIP CHIUSA COME "SOLA CARATTERIZZAZIONE".**
> Endpoint registrato: Wilcoxon esatto two-sided su 12 coppie,
> **W=12 p=0.0635 → non significativo**. Direzione: K-F ON è **+4.3% più
> LENTO** (OFF 0.1919 vs ON 0.2001 s/tok), HL −0.0090, **9 coppie su 11
> non-pari a favore di OFF**. Una coppia è pari esatto → N efficace 11,
> floor 2/2¹¹ = 0.000977. Il −20% esplorativo **NON si riproduce**.
> **La policy di attivazione registrata NON è licenziata: K-F resta OFF.**
>
> **Robustezza (post-hoc, dichiarata, NON l'endpoint):** ogni variante
> peggiora la NOSTRA tecnica, mai il contrario — per questo è sicuro
> pubblicarla. Senza b24: p=0.0996, +2.9%. **Senza b5: p=0.0039, +6.9%.**
> Senza entrambi: p=0.0078, +5.6%. Cioè **b5 è l'unica ragione per cui il
> primario è un nullo invece di un negativo significativo**: è un blocco
> OFF anomalo (0.243 contro mediana OFF ~0.19) e produce l'unica coppia
> che sembra una vittoria K-F. **L'unica vittoria della cella è un
> outlier del braccio OFF, non un successo del braccio ON.** E il +6.9%
> che ne esce sta dentro il rumore del **+7.1% pre-registrato del warm**:
> due regimi indipendenti, due celle, stesso segno e stessa magnitudine.
> b24 dichiarato ma NON escluso (COLD-VALID per la regola registrata:
> fadv_rc=0, drop 2739 MB, letture 12.60 GB sopra il floor 11.14) benché
> abbia letto la metà di ogni altro OFF (22.1-22.5 GB) e abbia l'energia
> rotta (0.0867 J/tok contro ~0.78).
>
> **Il meccanismo funziona e non basta SULLA MEDIA — ma vince sulla
> CODA.** Stall OFF 21.9% → ON 13.4% su OGNI blocco, letture 21.39 →
> 24.41 GB (**+14%**) con precisione del prefetch 76% (un quarto dei byte
> prefetchati non serve mai). Ma con i dati per-token **due gate
> ribaltano a YES**: `KF_ROBUST_WIN ✅` (p99 ON **328** vs OFF **341** ms,
> stutter ON **0.34%** vs OFF **0.55%**) e `KF_THERMAL_WIN ✅` (sag ON
> 0.0423 vs OFF 0.0670, dT 0). Energia NO (ratio 1.070 escludendo il b24
> rotto, 1.162 includendolo), majflt MIXED, TTFT in parità.
> **Quindi la caratterizzazione onesta non è "K-F è inutile" ma "K-F
> scambia throughput medio per fluidità della coda"** — stessa forma
> trovata nella cella burst (p99 −17%, stutter dimezzato). Non licenzia
> una claim di velocità; è un argomento di UX, e come tale va misurato
> con un endpoint suo se mai lo vorremo.
>
> ⚠️ **Due miei errori nel primo giro di report, corretti da un agente
> delegato che ha riscritto il REPORT:** (1) avevo dichiarato gli assi di
> coda MANCANTI — falso, i 27 file per-token erano sul device, non li
> avevo tirati giù, e sono proprio quelli che ribaltano i gate;
> (2) avevo scritto 2 run escluse per tepore fidandomi del contatore
> `excl_warmth.txt` dell'harness, mentre il CSV ne mostra **3**
> (`not_cold_valid`) più 1 esclusa per SIGTERM. Il CSV è ground truth, il
> contatore ne conta una in meno — bug dell'harness, nessuna riga tenuta
> è affetta. Lezione: non fidarsi di un contatore quando il dato grezzo è
> lì accanto.
>
> **Il gate di validità a freddo si è ripagato:** 3 run escluse per
> tepore, 1 blocco (b16) vuoto e rifatto in coda dal void-scan. Erano le
> tre run bruciate dai due harness concorrenti (errore mio, causa radice:
> il wrapper fa `exec` nello script interno → `pgrep` sul nome del
> wrapper torna VUOTO su harness vivo). Senza il gate sarebbero entrate
> come run WARM in una cella pre-registrata, e warm è dove K-F perde del
> 7%: non rumore, **bias a smentire la nostra stessa tesi**.
> results/kf_cold_jelly/REPORT.md.
> (contesto originale della cella:) PREREG committato PRIMA dello staging (01350f1):
> 24 blocchi OFF-ON-ON-OFF ×6, N=12, Wilcoxon esatto two-sided, Marco
> KEXP, un solo binario (il braccio è il flag). Motivo: il regime warm
> ha un NEGATIVO pre-registrato (+7.1% contro, p=0.000977) e l'unico
> positivo (cold −20%) non lo era — asimmetria indifendibile.
> **Meccanismo di integrità specifico del freddo:** `fadv` prima di
> OGNI run, `Cached` registrata prima/dopo, run COLD-VALID solo se il
> calo ≥ 1000 MB E le letture superano il pavimento fissato dal primo
> blocco OFF (11.14 GB, dichiarato in COLD_FLOOR.md prima delle
> coppie). Perché conta: un reset fallito in silenzio produce una run
> WARM, e warm è dove il K-F PERDE del 7% — quindi non aggiunge rumore,
> **spinge sistematicamente a smentire la nostra stessa tesi**.
> Registrata in anticipo anche la POLICY che un pass licenzierebbe:
> K-F ON sse stall misurato alto E cache fredda E nessun allarme
> termico; batteria esplicitamente NON un gate.
> **15 blocchi validi, 7 coppie complete su 12 — SOSPESA al 16/08 19:xx.
> Il −20% NON si riproduce; la tendenza è LEGGERMENTE CONTRO.**
> (Nota di correzione: avevo detto 6 coppie. Sono 7 — il quartetto 4
> salva la coppia b13-b14, solo (b16,b15) è nulla per l'esclusione di b16.)
>
> Il meccanismo funziona ed è solidissimo, su **ogni singolo blocco**:
> stall OFF 21.4-22.8% (media 21.9) → ON 12.1-15.5% (media 13.4), otto
> punti in meno. Ma le letture salgono 22.3 → 24.4 GB di media (+9%:
> **prefetch sprecato**, precisione 76-77%) e il tempo non ne beneficia.
>
> | coppia | OFF | ON | OFF−ON | % |
> |---|---|---|---|---|
> | b1-b2 | 0.189 | 0.200 | −0.011 | −5.8% |
> | b4-b3 | 0.193 | 0.193 | 0.000 | 0.0% |
> | b5-b6 | 0.243 | 0.199 | +0.044 | +18.1% |
> | b8-b7 | 0.192 | 0.195 | −0.003 | −1.6% |
> | b9-b10 | 0.192 | 0.198 | −0.006 | −3.1% |
> | b12-b11 | 0.190 | 0.188 | +0.002 | +1.1% |
> | b13-b14 | 0.192 | 0.195 | −0.003 | −1.6% |
>
> N=7, mediana(OFF−ON) = **−0.0030**, 4 negative / 2 positive / 1 zero.
> **La lettura onesta dei per-blocco smonta l'unico positivo:**
> OFF = 0.189 0.193 **0.243** 0.192 0.192 0.190 0.192 (mediana 0.192,
> range strettissimo tranne b5) · ON = 0.200 0.193 0.199 0.195 0.198
> 0.188 0.195 **0.224** (mediana 0.198). Cioè **b5 è un outlier del
> braccio OFF, non una vittoria del braccio ON**: la coppia +18.1% è un
> blocco OFF anomalamente lento, non un ON veloce. Tolto l'outlier, ON
> sta sistematicamente ~3% SOTTO OFF — **stessa direzione del warm
> (+7.1% contro, pre-registrato), magnitudine minore**.
> Servono N≥10 per la claim confermativa, ma **K-F resta OFF comunque**:
> il warm ha un negativo pre-registrato e il cold non porta un positivo.
>
> **Tre interruzioni dichiarate, tutte da riportare nel REPORT:**
> (1) 14:41 — schermo spento, sshd morto, harness morto con lui perché
> NON era staccato (colpa del mandato che non lo richiedeva, non
> dell'agente): 93 minuti persi, 5 blocchi salvi, RESUME_AT=6.
> (2) ~18:00 — **due harness concorrenti** lasciati vivi nella ripresa
> (colpa mia): due `bmoe-cli` tenevano il modello in mmap, `fadv` tornava
> rc=3 "still has 618912 resident pages" e il blocco 16 ha bruciato 3
> tentativi, TUTTI scartati dal gate (`excl_warmth=2`, drop_mb 0/390/222
> contro la soglia di 1000). **Il gate di validità a freddo ha fatto
> esattamente il suo lavoro**: senza, oggi avrei tre run tiepide
> travestite da fredde dentro una cella pre-registrata, cioè il bias
> verso il negativo che il gate esisteva per impedire.
> (3) 18:15 — `STATUS = STOP_PLUGGED`: l'owner ha messo in carica (su mia
> richiesta) e l'harness **si è fermato da solo** rifiutandosi di
> misurare sotto carica, come impone il PREREG (UNPLUGGED). Non un
> guasto: il guard-rail che funziona. E si è fermato DOPO la morte di
> sshd → **il distacco stavolta ha tenuto, quel problema è chiuso.**
>
> **Per chiudere:** RESUME_AT=17, servono ~9 blocchi (il 16 va ri-fatto
> in coda, la sua coppia è nulla) ≈ 2 ore non presidiate. Da batteria
> piena il floor 45% non si sfiora nemmeno (~2.3%/blocco). Basta
> staccare dalla presa. results/kf_cold_jelly/.
> 📱✅ **CELLA REPLICA XIAOMI (16/08) — REPLICATA.** La config certificata
> vince anche sul secondo device: **W=0, p=0.000977, HL B−A = −0.05625
> s/token, mediana −14.5%**, N=12 coppie, zero esclusioni. Onestà sul
> test: la coppia 3 è un pareggio esatto (0.2940 = 0.2940 alla
> risoluzione a 4 decimali dell'harness) e Wilcoxon scarta le differenze
> nulle → il test gira su **11 coppie effettive**, quindi p = 2/2¹¹ =
> 0.000977 è il floor esatto per N=11, NON il floor N=12 di 0.000488
> (dichiarato perché chi ricalcola da "N=12" troverebbe una discrepanza).
> Tutte e 11 le differenze non nulle favoriscono B.
> **La predizione pre-registrata ha tenuto sulla magnitudine:** effetto
> molto più piccolo del −42.7% del S23, ma NON nullo. L'asse energia
> NON è stato replicato (quantizzazione del coulomb counter).
> Replica pre-registrata della claim di ship su secondo device: stesso
> ELF, stesso modello, stesso prompt, cambia solo il telefono. PREREG committato PRIMA dello
> staging con **predizione registrata: effetto più piccolo o nullo qui**
> (11.4 GB RAM, SD8G3, flash veloce → il braccio stock soffre meno il
> costo I/O che il certificato rimuove; stall a freddo 8.7%). Un nullo è
> SCOPE, non fallimento. **3 emendamenti, tutti prima di qualsiasi
> dato:** (1) l'ELF della claim esisteva SOLO sul S23 — tirato,
> verificato 7/7 file bit-identici, archiviato (models_staging/); (2)
> J/token non riproducibile qui (sysfs negato a uid 2000) → coulomb
> counter, 2 letture per run, meno perturbante del sampler 1 Hz del S23;
> (3) **lo schermo resta acceso** (prassi di questo device contro Doze)
> e questo GONFIA il J/token del braccio lento, cioè favorisce la NOSTRA
> config sull'unico asse dove il S23 era rosso → misurata baseline
> **P₀ = 0.503 W**, energia riportata grezza E corretta. Baseline dello
> stesso ordine di TUTTO il calcolo (S23: 0.42/0.82 W): senza correzione
> il segno del +11.8% si ribalterebbe per artefatto.
> Staging verificato per hash sul device; harness portato a `sh` POSIX
> (23 colonne identiche → analyzer S23 intoccato). Run delegata a grok.
> results/kernel_ship_ab_xiaomi/.
 — aggiornato 2026-08-16 (mattina)

> 🏆🏆 **IL P-VALUE È ARRIVATO (2026-08-15 ~00:30): SHIP CRITERION MET.**
> Cella pre-registrata Mellum2-S23, 12 coppie ABBA da telefono
> dichiarato pulito: **stock 0.2585 → certificata 0.1480 s/token
> (−42.7%, tok/s 3.87 → 6.76, +75%), Wilcoxon W=0 p=0.000488** — tutte
> e 12 le coppie favoriscono la certificata, p al floor del test esatto.
> Assi di contorno: sustained −38% ✅, temp parità ✅, TTFT parità ✅,
> **J/token +11.8% ❌ dichiarato** (la certificata spinge di più i core:
> ~+12% energia per risposta — 4 assi su 5 verdi/neutri). Bonus finding:
> la certificata è ROBUSTA alla pressione RAM reale (lo stock collassa
> 60-100× con zram sporco, riprodotto 2×). Report:
> reports/moe-kernel-ship-ab-s23.md. Primo mattone PRE-REGISTRATO del
> paniere ship; K-F escluso di proposito (fattori isolati).
> **DIRETTIVA gualt (2026-08-15): POLICY DI ATTIVAZIONE del kernel** —
> la promozione finale richiede: (a) completamento burst-cold, (b)
> caratterizzazione eventi stutter/max, (c) policy che limiti l'uso
> aggressivo quando batteria o termica sono vincolanti (es. "spegni"
> la config aggressiva sotto soglia batteria). Ingressi policy: stall%
> (K-F), livello batteria, stato termico. Nota misurata: J/token +11.8%
> e potenza media ~raddoppiata (0.42→0.82 W) MA a schermo spento —
> nell'uso reale lo schermo (~1-2 W) brucia metà tempo a velocità
> doppia: serve la cella "J per risposta a schermo acceso" prima di
> fissare le soglie (il costo potrebbe ribaltarsi in risparmio netto).
> **MISURATO (2026-08-15 notte): ribaltamento CONFERMATO per l'uso
> interattivo.** Sessione screen-on: velocità replica esatta (−41.3%,
> W=0 p=0.000488 — secondo campione indipendente); J/token con display
> attivo inaffidabile (sensore Samsung mescola scale mA/µA) → misura
> %-drop: schermo ≤~0.6W (sotto risoluzione 1%/15min). Aritmetica:
> certificata risparmia 22s schermo/risposta (4-13 J) vs +2.6 J compute
> → A SCHERMO ACCESO LA CONFIG VELOCE RISPARMIA BATTERIA NETTA.
> Policy corretta: gate su TERMICA e task screen-off (lì +12% J/tok è
> reale), NON sul livello batteria in chat interattiva.
> Chiarimento terminologia (per non confondersi mai più): (1) ricetta/
> dispatcher = funziona OVUNQUE (S23 p-value; Xiaomi +158% Marco t4);
> (2) K-F prefetch = solo dove stall%>~20% (Jelly sì, Xiaomi no);
> (3) K-G prefill GPU = lane morta ovunque (artefatto).

> 🚨 **SHIP A/B S23: SOSPESA CON CAUSA TROVATA (2026-08-14 ~21:00).**
> Il braccio A "stock" (k8, no drop) fa 21 s/token — 60× degradato vs le
> celle storiche F1d (2.90) su STESSO binario/telefono/flag — e il fix
> del flag esplicito NON c'entrava (stessa patologia con e senza).
> **Pistola fumante: 1.5 GB di pagine anon in zram** (SwapFree 2.68/4.19
> GB, mm_stat 1.44 GB orig): i pesi densi anon sono swappati compressi;
> il churn page-cache del k8 no-drop (183 MiB/tok) li tiene fuori e ogni
> GEMV paga la decompressione → compute 21.2 s/tok. Il braccio B (d1.0,
> 39 MiB/tok) non pressa abbastanza → normale. Harness fermato pulito
> (STOPPED_FOR_DIAG), 2 coppie valide archiviate nel csv, telefono in
> carica. **PROSSIMO: reboot S23 (serve gualt: riavvio + Termux + sshd)
> → singola run A-config: se compute torna ~0.5 s/tok, causa confermata
> → PREREG emendamento 2 (stato RAM dichiarato post-reboot) → riparte la
> prova. Finding di prodotto: la config certificata è RESILIENTE alla
> pressione RAM reale, lo stock collassa 60× — da misurare e bancare nel
> ship report.**

> **Leggi questa sezione e basta.** Il piano originale del 3 agosto (contesto, ipotesi,
> roadmap F0-F9, rischi, fonti) e i checkpoint fino all'11 agosto vivono in
> `PLAN-archive.md`. Qui: TL;DR lanes, scheda prodotto, tabella aperta, regole operative,
> §8 telemetria/harness, checkpoint recenti. Vista di stato: va aggiornata a ogni fase.

## TL;DR lanes (2026-08-14)

> 🎯 **DIRETTIVA gualt (2026-08-14, aggiornata): "VOGLIO UN NOSTRO KERNEL"
> — CPU per velocità, O RAM, O GPU/SSD per temperatura/calore: la value
> proposition è che lavoreremo sempre su LLM appena uscite** (day-zero
> enablement dove upstream ha solo fallback lenti + streaming-aware paths
> che upstream non farà mai + efficienza termica). Lane vive: (1) KERNEL
> — **K-E MORTA (KE_NULL, 2026-08-14): l'i8mm non gira mai nel motore
> reale — i kernel mmla vivono solo nel path REPACK che gli esperti
> streamati bypassano (`use_extra_bufts=false` portante); decode +1.1%
> cpu, wall −2.4% = rumore, il −6.3% cpu-time era artefatto n_gen; anche
> il sustained confondato dall'ordine termico. Kill criterion rispettato.**
> **K-G MORTA (KG_KILL): il "prefill GPU 1.29×" era un artefatto
> (baseline = media con rep cold-outlier); onesto p512 1.12×, ibrido
> 1.07×; boundary 0.068 ms/tok = non sono il collo. K-F VIVA (KF_GO):
> stall = 37.3% del wall su Marco-Jelly (0.1025/0.2746, identità
> wall=compute+mgmt+stall chiude al ms), derivato dai log esistenti a
> zero minuti device; tetto layer-ahead issue-only ~36% del wall (finestra
> stretta 8-14%); il macchinario route_ahead_submit/collect/issue_for
> ESISTE già nell'engine — **🏆 KF_PROTO_WIN (2026-08-14 sera, Jelly
> Marco1c): wall 0.318→0.210 s/tok (−34.0%), tok/s 3.14→4.77 (+51.8%),
> stall 26.9%→17.2%, precision 68.3%, IDENTITY_D0=PASS (sha identici a
> drop 0); a d0 il win regge (−25.7%) quindi non è artefatto del drop;
> divergenza testo a d065 ATTESA (F2 review). Il −34% satura quasi il
> tetto derivato ~36%: il prefetch elimina anche i page-fault dentro
> "compute" (0.218→0.163). Costi onesti: ~31% byte issued sprecati,
> J/token NON misurato → serve cella energia K-F prima di promuoverlo in
> config default, e N≥10 pre-registrato per qualsiasi claim di ship.
> Branch kalsa/kf-layer-ahead @ c3e8fc4; report
> reports/moe-kernel-kf-proto.md.
> **SCOREBOARD K-F v2 (gualt, 2026-08-14 notte — tassonomia ufficiale,
> missione: tutta verde o quasi):**
> KF_MEDIAN_WIN ✅ · KF_ENERGY_NEUTRAL ✅ (pooled 1.028; mappa width:
> W2 0.976 / W4 1.008 / W6 1.125) · **KF_THERMAL ❌ sotto sustained, ED
> È FISICA** (ON sag 0.32-0.36 vs OFF 0.23: corre più forte presto,
> scalda di più, tutti convergono a ~2.5 tok/s late — K-F è un
> acceleratore di burst, non alza il rate termico; la mediana su 1000
> tok vince comunque +20%) · **KF_MEMORY: gate da RIDEFINIRE** (majflt
> non monotono e invertito vs IO — misura QUALE path legge, non il
> distress; RAM min 3.46GB, zero pressione reale; niente cold-start
> bill nello sweep) · **KF_TAIL: REGIME-SPLIT — sotto sustained la coda
> si RIBALTA: ON batte OFF a ogni width, p99 monotono 638→481 ms
> (W6); la regressione v1 era artefatto del regime tiepido. MA il
> regime prodotto chat = burst corti ≈ v1 dove ON perdeva → decide la
> cella burst (generazioni corte + pause)** · KF_ROBUST → cella
> registrata nel regime prodotto · **PARETO: ginocchio a W4 (+15.6%
> tok/s a energia pari); W6 max speed (+20%) a +12.5% J; W2
> energy-positive (−2.4%)** — candidato default W4 pending burst-test ·
> **KF_GENERAL MISURATO (Xiaomi, finestra offerta da gualt): NON
> universale — sul fast-flash l'OFF caldo VINCE (0.398 vs 0.404-0.406,
> ON −1.5/−2%): lo stall dimezza ma il compute sale uguale (interferenza
> banda DRAM). Legge di scala: il win segue la quota stall (Jelly
> 27-30% → −34%; Xiaomi 19-21% → nullo/negativo; soglia morte ~20%).
> ⇒ K-F è una leva DA DISPATCHER (ON solo dove il probe misura stall%
> alto), non un default universale — ed è la fascia che ne ha più
> bisogno a riceverla. Bonus: prima telemetria lead-time sul campo
> (late 9% con gap 8-14ms = near-miss B; inflight mai oltre width = C
> esclusa qui; W4 conferma il ginocchio anche su secondo device).
> Report: reports/moe-kernel-kf-general.md** ·
> **SONDA S23 (2026-08-15 pomeriggio, esplorativa, 8 blocchi ABBA,
> kf-bin ad104222 pins dichiarati): NULL PULITO = terza conferma della
> legge di scala.** Stall S23 ~11% in config campagna → sotto soglia
> ~20% → wall identico (0.271 vs 0.271 s/tok) con stall dimezzato
> (11%→6%) e zero danni (p99 pari, energia 1.03, sag migliore). Legge
> a 3 device: Jelly 27-30%→−34% · Xiaomi 19-21%→nullo · S23 11%→nullo.
> La regola dispatcher (ON solo con stall%>~20 misurato) è VALIDATA.
> Anomalia archiviata: la sonda gira con compute 2.5× più lento del
> ship arm B (0.24 vs 0.095 s/tok; sospetta affinity thread Termux) —
> a velocità ship lo stall share risalirebbe ~25%: eventuale cella
> futura, non blocca. Dati: results/kf_probe_s23/.
> **CELLA CONFERMATIVA JELLY (prereg 3785392) COMPLETATA 24/24 la sera
> del 15/08: VERDETTO NEGATIVO ONESTO — W=1 p=0.000977 nella DIREZIONE
> OPPOSTA: a cache calda (giornata intera di inferenza) ON = +7.1%
> (0.2056 vs 0.1920), 11/12 coppie contro, p99 423 vs 345, stutter e
> J/tok peggio. Stesso device/binario/config della cella burst-cold
> del mattino che dava −20% ALL GATES YES ⇒ È IL REGIME A DECIDERE,
> non il device. E lo stall OFF stanotte era 21-29% (SOPRA soglia 20%)
> eppure ON ha perso ⇒ lo stall% DA SOLO non basta al dispatcher:
> serve il segnale cache-fredda (majflt-rate primi token /
> time-since-last-inference). Prodotto: K-F = ACCELERATORE COLD-START
> (TTFT 12-18 vs 21-22s, p99 −17% a freddo), auto-OFF a caldo.
> 3 interruzioni Android dichiarate, 12/12 coppie intatte, 0 escluse.
> Report: results/kf_ship_jelly/REPORT.md.** ·
> **SONDA COLD XIAOMI (sera 15/08, esplorativa, fadv-verificata,
> plugged): NULL PULITO CON MECCANISMO — sul flash veloce l'--overlap
> da solo assorbe già l'IO freddo (c01 OFF cold: 0.446 s/tok di
> letture flash → stall residuo 0.048 = 8.7%). Il prefetch funziona
> (precision 78%, late 2%) ma non ha nulla da nascondere. MAPPA K-F
> COMPLETA 3 device × 2 regimi: Jelly cold WIN −20% · Jelly warm LOSS
> +7% · S23 null · Xiaomi warm null · Xiaomi cold null ⇒ K-F =
> acceleratore cold-start SOLO per device a flash lento; altrove
> l'overlap è già tutta la storia. v1 sonda = garbage da flag
> --prompt-file inesistente (usage dump, check di validità debole):
> fix grok con DONE a 3 condizioni. results/kf_cold_xiaomi/.** ·
> POLICY DISPATCHER (formula finale): K-F ON ⟺ stall% misurato alto
> E cache fredda E niente allarme termico — CPU/RAM/modello sono già
> dentro lo stall% misurato; GPU fuori scope; batteria NON è un gate
> (inversione screen-on). ·
> **SONDA CALAQWEN-35B XIAOMI (notte 15/08, esplorativa): l'ipotesi
> "modello grosso → flagship sopra soglia" è SMENTITA — stall cold
> 6.0% (vs 8.7% di Marco: il 35B legge il doppio ma computa più a
> lungo per token, il rapporto resta assorbibile), KF ON −7%. K-F
> resta spento sul fast flash ANCHE col 35B. La mappa K-F è chiusa
> definitivamente. results/kf_calaqwen_xiaomi/.** ·
> **CARD SCREEN-ON XIAOMI RIFATTE (item Doze CHIUSO): CalaQwen 4.677
> vs card 4.75 (−1.5%) · Marco 11.78 vs 10.57 (+11%, vecchio punto
> n=1 dentro lo spread n=3). Nessun collasso Doze, protocollo
> originale ritrovato (xiaomi_t4_round) e replicato con fadv cold +
> wakefulness registrata. results/card_screenon_xiaomi_v2/.** ·
> KF_SHIP ⛔ (per spedire: eventuale cella COLD pre-registrata su
> Jelly con reset fadv tra coppie + policy scritta — decisione owner).
> Report sweep: reports/moe-kernel-kf-sweep.md.
> **CELLA BURST COMPLETA 12/12 (2026-08-15 mattina, blocchi 9-12 a
> telefono freddo 26-29°C = il burst-cold mancante) — TUTTI E 4 I GATE
> YES:** ENERGY ✅ 1.005 · THERMAL ✅ (sag ON 0.069 vs OFF 0.136 — nel
> burst ON degrada METÀ, temp_max identica 43/43) · MEMORY ✅
> (majflt/tok ON 9.2 vs OFF 13.5) · **ROBUST ✅ — p99 ON 467 vs OFF
> 565 ms (−17%), stutter DIMEZZATO (0.25% vs 0.50%), max 869 vs 1142.**
> Nel burst-cold puro (b9-b12): ON 0.205-0.212 vs OFF 0.258-0.262
> s/tok (−20%), TTFT ON 12-18s vs OFF 21-22s — a freddo il prefetch
> vince ANCHE il primo token. I vecchi ❌ TAIL/ROBUST erano artefatti
> del regime corto/tiepido: nel regime prodotto la coda la vince ON.
> Bilanciamento: 4+4 blocchi a caldo (39-43°C sera) + 2+2 a freddo
> (26-29°C mattina), ABBA, arm bilanciati su entrambe le condizioni.
> Nota onestà: b12 v1 ucciso dal phantom-killer Android (screen-off
> senza wake-lock, sshd morto, orfano congelato) → re-run pulito a
> freddo; lezione: SEMPRE termux-wake-lock prima di harness lunghi.
> Dati: results/kf_burst/device_final/, analisi ANALYSIS_FINAL.md.
> **STUTTER CARATTERIZZATI (analisi per-token): tutti e 3 = ingorgo IO
> alla RIPARTENZA del burst (io_ms 2.2-2.5s aggregati nei primi token
> del blocco, stall 350-400ms; worker 1-2ms e majflt ~0 innocenti) —
> causa E (warm-up non integrato) + C locale. Fix candidati: ramp-up
> issue nei primi ~10 token, o warm-start nel prefill.**
>
> **(storico, prima tassonomia — dopo cella REALITY):**
> KF_PROTO_WIN ✅ · KF_PHYSICS_WIN ✅ · KF_SPEED_WIN ✅ ·
> KF_IDENTITY_D0_WIN ✅ · **KF_ENERGY_WIN ✅ (J/tok 0.762 vs 0.770,
> ratio 0.99)** · **KF_THERMAL_WIN ✅ debole (sag 0.054 vs 0.095, ma
> mai oltre 30°C: blocchi morti a EOS ~200 tok — serve v2 sustained
> con --ignore-eos)** · **KF_MEMORY_WIN ❌ (majflt/tok 7.2 vs 0.93 —
> ma dominato dal primo blocco ON: b3=0.15/tok, steady-state ~parità;
> rimisurare in v2)** · **KF_ROBUST_WIN ❌ — LA CODA PERDE: p99 605 ms
> vs 442, worst 1352 vs 666, stutter 1.55% vs 0.45%. La media vince
> (p50 207 vs 313) ma il p99 regredisce: da ingegnerizzare (width 6→4,
> throttle di issue) prima di qualsiasi ROBUST claim** · KF_GENERAL_WIN
> ❓ · KF_SHIP_WIN ⏳. K-F FUORI dai default finché ROBUST + ship cell
> N≥10 non passano. Report: reports/moe-kernel-kf-reality.md.
> **DIAGNOSI CODA/COLD-START (direttiva gualt, 2026-08-14 sera):**
> cold-start = majflt primo blocco ON ⇒ prefetch tardi / pagine non
> residenti al compute / warm-up non integrato / issuing iniziale troppo
> aggressivo — impatta TTFT/avvio reale. Steady-state in parità ⇒ NON è
> cache pollution continua. Metriche richieste: majflt/tok primi-N vs
> post-warmup, majflt/blocco, TTFT, first-block latency, hit rate.
> Cause candidate della coda persa: (A) width troppo alta → sweep
> width 2/3/4/6 con Pareto p50×p99×stutter×J/tok; (B) prefetch late
> vs deadline → strumentare issue_time/completion_time/first_touch_time,
> lead_time=completion−first_touch; (C) over-issuing senza backpressure
> → admission control (gated su evidenza B/C); (D) pollution da
> prefetch sprecati; (E) primo blocco non scaldato → integrare il
> prefetch nel warm-up. Esecuzione: sweep width su Jelly (cella lunga
> anti-EOS) + strumentazione lead-time nell'engine in parallelo.**
> Paniere p-value = dispatcher/config (✅ QUALITY GATE PASSED: PPL
> k6d1.0 dMacro +0.0378 / worst fr +0.0877 → **5.151 t/s È config
> prodotto certificata Mellum2-S23**) + K-F (prototipo) + libreria.
>
> 🏠 **CASA DELL'ENGINE (direttiva gualt, pomeriggio): BigMoeOnEdge È
> FINITO.** `kalsa-engine/` in questo repo = l'engine nostro (tree fuso:
> libreria kernel + split residency + fix, llama.cpp vendored al pin
> locale e5605f3; compila, ctest 13/13) + `kalsa-engine/bundles/` = tutta
> la storia git (ogni branch BigMoeOnEdge + i kalsa/* di llama.cpp come
> delta). PUSHATO su Aspis0/kalsa-moe-experiments dopo riscrittura della
> storia non pushata (5 blob >100MB filtrati in un clone bare, 159
> commit, locale allineato). Cancellazione fisica del checkout
> BigMoeOnEdge: al landing di kf-prototype e F1b (lavorano nei suoi
> worktree), previo refresh bundle.
>
> 📱 **TTFT: PREWARM_UNIVERSAL confermato** (Xiaomi 4B 1.42/2.02 s, riuso
> 98.9%, fix P0 memguard mergiato su ai-chat main b274fb9). **P1
> idle-zombie: saga review completa** — fix v1 REJECT (il probe RSS era
> insano: mmap eviction ≠ morte, falso positivo = leak+OOM), fix v2
> on-contact (ping tokenize 8s, recoverLost scopato, harness 41/41) →
> re-review MERGE_WITH_FIXES(1) (soppressione busy troppo larga) →
> fix3 (always-ping, mark solo su turno utente) → **MERGIATO su ai-chat
> main 47be749: stack TTFT ship-grade** (prewarm + P0 + P1 + breadcrumb).
> Restano: checklist verify on-device (serve HyperOS libero) e UX F4.
>
> 🔮 **SELFSPEC: F1 implementata e corretta (same-k 1.000) ma alpha live
> 0.08 vs 0.70 teacher-forced; speedup 0.22×.** Parere Qwen Max (canale
> chat.qwen.ai, `docs/qwen-max-selfspec-opinion.md`): 45% corruzione
> stato/rollback ("prefisso fantasma"), 30-35% infedeltà verify batchato
> GDN, <10% "k2 debole"; ordine operativo = fixare 2 invarianti prima di
> tunare; bomba aritmetica: iterazione ~4.94 C6 → il verify batch deve
> essere SUBLINEARE (ammortamento flash) o γ=4 è morta a prescindere.
> **F1b ESEGUITA (2026-08-14 sera) — LANE_ALIVE, ENGINE_BUG:** E1
> draft==gold 0.833 (k2 SANO, ipotesi k2-debole morta) · E2 collasso a
> 0.353 con prefisso k6→predict k2 (k-mixing tossico: state-fork gratis
> morto per fisica) · E3 0.983 identico a γ=4 e γ=1 (batching innocente,
> MA ≠1.000 = invariante Qwen violata: impurità costante di runtime,
> verify==gold 0.937 dove doveva essere 1.000). Teacher-forced sano
> (0.83) vs live 0.08 ⇒ la corruzione vive nel ciclo
> accept/reject/rollback + k-switch (il "prefisso fantasma" di Qwen, 45%
> prior → quasi certezza). **G16 (gate restore, spec gualt) ESEGUITO:
> PASS ESATTO su transformer puri** (32/32 rejection forzate
> ripristinate bitwise; purity γ=1 48/48, residuo ~1e-7 = rumore fp,
> non scala-E3). Il ciclo rollback/k-switch è PULITO sull'attenzione
> standard ⇒ **l'indiziato si restringe allo stato ricorrente GDN che
> non si riavvolge col seq_rm** (i fixture tiny non sono ibridi; il
> collasso live era sul 35B ibrido — i due prior di Qwen convergono in
> un meccanismo solo). Commit 673febe. **🎯 RIPRODOTTO SUL 35B
> (ae63c5d): restore FAIL immediato sull'ibrido — |dlogit| 14-23, top8
> 0/99 — CON e SENZA rejection (anche il normale rewind-replay del
> catch-up avvelena!), mentre lo stesso binario è bitwise-esatto sui
> transformer puri. CAUSA: seq_rm riavvolge l'attenzione ma lo stato
> ricorrente GDN NO — ogni ciclo lascia fantasmi che si compongono =
> alpha 0.70→0.08. I due prior Qwen erano UN meccanismo. FIX
> (strutturale, non tentato): checkpoint R/S del draft ctx pre-burst +
> restore al rewind via llama_state_seq_* (API pubblica, third_party
> intatto) o macchinario n_rs_seq già riservato dal design F1. Poi
> re-misura alpha live (target 0.83), POI economia (bomba 4.94·C6 in
> piedi).** Report: reports/moe-selfspec-f1b.md (+addendum).
> (3) **PPL gate Mellum COMPLETO (2026-08-14 sera): k6d065 GATE_PASS con
> dMacro −0.0086 (MEGLIO dell'ancora k8; worst zh +0.0303) → il default
> campagna è quality-certified con margine. k6d1.0 PASS confermato
> (config velocità 5.151). k4d0 GATE_FAIL (dMacro +0.099, fr +0.166) —
> il k4 "coerente a vista" non regge: via di fuga chiusa.** PC libero →
> corsa F1b E1/E2/E3 LANCIATA (longfact, 2396c56).
> **(4) TTFT: PREWARM_UNIVERSAL — Xiaomi 4B post-fix P0: 1a 1.42/2.02 s,
> riuso 1174/1187 (98.9%), prewarm 29-31 s, 1b join 26 s; fix memguard
> mergiato su ai-chat main (b274fb9, harness 27/27); P1 zombie APERTO.** Bug app P0/P1 trovati sul Xiaomi (KNOWN_ISSUES ab3b747):
> fix autorizzato via "sbrigati TTFT" (in volo). Il resto resta congelato.
>
> 📐 **DECISIONI gualt (2026-08-14):**
> **(1) Target velocità:** i MoE grandi (Mellum2/Marco/CalaQwen) su
> S23-class si ACCETTANO a **5-6 tok/s** — l'ambizione 7-9 passa a
> flagship/fasce residenti; unica via di revisione = selfspec (F1b decide).
> Sui Qwen piccoli si spera ancora: 2B = 15.9 misurato su S23, residente
> su qualsiasi RAM.
> **(3) CRITERIO DI SUCCESSO DEL KERNEL (gualt): si spedisce un kernel
> che FUNZIONA e migliora IN GENERALE (non solo velocità: sustained,
> termica, batteria, TTFT) i modelli che spediamo, in modo SIGNIFICATIVO
> — "voglio quel p-value alla fine".** Endpoint pre-registrato: A/B
> appaiato (config stock vs kernel/dispatcher) per device×modello del
> listino, ABBA interleaved N≥10 rep/braccio, metriche primarie dichiarate
> PRIMA (wall mediano, sustained late-rep, J/token, °C, TTFT), test
> appaiato (Wilcoxon) + effect size + p-value nel report finale di ship.
> Dividendi già misurati che entrano nel paniere: dispatcher/config (+37%
> Mellum-S23 t2+d1.0; +158% Marco-Xiaomi t4; dottrina screen), K-E
> termico (screening in corso), K-G TTFT (gated), layer-ahead (gated).
> **(2) Dottrina fasce:** stesso SoC ≠ stessa fascia. La fascia è la
> matrice **compute-class × RAM misurata**: più RAM a pari silicio =
> residenza per i grandi (via il termine flash dal wall: Mellum 5.15 →
> tetto ~6.5-6.75; il 46% di miss di Marco evapora; CalaQwen ammissibile
> residente a 24 GB); meno RAM = hit% e ammissibilità giù. I piccoli
> clusterizzano solo per SoC. Ad assegnare la fascia è il **probe runtime
> del dispatcher al primo avvio** (compute + budget RAM + sustained), non
> la scheda tecnica. Test di falsificazione economico quando capita: S23
> Ultra (stesso 8Gen2, 12 GB) — Marco residente vs 8.82 streamato. (free-tier: si ferma alla scala misurata; celle card
> Xiaomi, FT lane, GPU: freeze — si riaprono solo su parola di gualt).
> Design S3 del coordinatore: `docs/kernel-s3-design.md` (3 meccanismi
> ranked: Phase-D cache-ostile prima del repack; repack-at-cache-insert
> solo gate/up; braccio build i8mm — la build S23 è armv8.2, i core
> supportano armv8.6+i8mm). Selfspec F1 in volo su `kalsa/selfspec-f1`
> (k switchabile draft2/verify6, KV rollback su verify, gate = output
> identico al k6 greedy, PC-first; cella S23 dopo che S3 libera il device).

| lane | stato | numero chiave | prossimo passo |
|---|---|---|---|
| **Lineup 3 telefoni** (CalaQwen + Marco1c shippati) | S23/Jelly done (screen-on); Xiaomi era in Doze → rifare celle card screen-on | Marco1c: S23 **8.82** (t4) · Xiaomi **10.57** (t4 screen-on, sorpasso) · Jelly 3.64 (t2, ranking) · CalaQwen: S23 5.86 · Xiaomi 4.75 | celle card Xiaomi screen-on |
| **TTFT app (Kalsa)** | ✅ **v2 MERGIATO su ai-chat main** | 53.4 s → **1.40 s** (Jelly, cold+90s+send) | QA app; engine-track Q6.c per chat lunghe |
| **Kernel CPU S2/S3** (micro-esperti) | S2 corretto ma PERF_NULL; **S3 Phase 0 (2026-08-14 06:05): S3_NO_HEADROOM al gate d'onestà — REPACK delta token-model −1.5%** (`moe-mellum2-kernel-s3.md`): lo stock NON repacka gli esperti streamati (`use_extra_bufts=false` per il rebind cache) quindi S2-vs-stock era vec_dot-vs-vec_dot; il kernel REPACK sul path ID a t2 PERDE (0.52×, row-split allineato a 8 con 2 thread); i ~10ms del fuso = cache/TLB bounce gate↔up + barrier + wait-all, non REPACK. **S3b i8mm DONE (2026-08-14 mattina): S3_CLOSED_ALL_ANGLES** (§Phase 0b nel report): HAVE_MATMUL_INT8 acceso con armv8.6, kernel `q4_K_8x8` VIVO e ripara il collasso 8x4 (ID t2 949→**389 µs**, ×1.27 sul floor host 495.5) MA token-model **+0.2%÷4.0%** — vale solo su gate/up Q4_K, il down Q8_0/Q5_0 non ne beneficia (Q8_0 ID t2 ancora 0.68×, Q5_0 senza traits). **Tre assi misurati, tre volte sotto il gate 10%: vec_dot/llamafile floor, REPACK 8x4 (perde), i8mm 8x8 (vince la cella, non il token). LANE KERNEL CPU CHIUSA — il floor t2 0.148 compute / 5.151 wall È il silicio.** Eredità: branch S1+S2+fix corretti e PR-abili upstream (matcher difensivo incluso); la velocità ora passa da selfspec | **5.151 t/s k6d10 t2** in attesa solo del PPL gate | lane chiusa; resta PPL |
| **Free-tier G99** | KEXP_REGRESSION + **REAP-50 MORTO** (10.68 resident ≈ 10.60 streamed: REAP dimezza gli stored, non gli active — stesso muro ~11 GB/s); 4B dense = fondo (3.52) | ladder finale: A0 k4 **10.6** / 2B 8.04 / 4B 3.52; target 15-20 irraggiungibile su G99 | gualt: (i) A0 10.6 o (iii) no-LFM — (ii) eliminata coi dati |
| **FT tool-call + IT** (Qwen3.5-2B primo) | tutti i gate chiusi: licenza YELLOW ok, ricette GREEN ×2, Registry **FROZEN** | dataset ~20-30k, 1 epoca, 24 GB bastano | GO spike gualt → PR-0 + PR-2 |
| **Mellum2 coding-SKU** | F0 STRONG 15/20; ceiling compute → dipende dal kernel | k6d1.0 = 4.64 t/s S23; con kernel ~7-9 | PPL gates drop/k (PC, dietro selfspec) |
| **GPU Adreno** | **decode** parcheggiato su A7X (0.41× sul 740, 0.44× sul 750, dispatch-bound) · **prefill RIAPERTO 16/08** | ⚠️ **CORRETTO: prefill GPU = 5.77× sul 750** (pp128 181.65 vs 31.46, `moe-gdn-750.md:201-206`, Qwen3.5-2B **denso**), non "1.29-1.7×" come diceva questa riga. Il 740 fa 2.2×. Leva TTFT sui DENSI (per il 35B resta la Q7-landmine) | riverifica anti-artefatto poi decisione TTFT |
| **Selfspec F0** | ✅ **PASS_LANE_OPEN (2026-08-14 00:50)** — run 3 completo | **alpha pooled 0.6991** (n=1037, gate ≥0.60; k2 draft / k6 verify, entrambi i bracci drop) | F1 prototipo on-device = engine-work (loop speculativo in BigMoeOnEdge); PC LIBERO → coda PPL gates Mellum |

## Scheda prodotto (default B 2026-08-18: KEXP + k=6 + **drop 1.0 + `--drop-no-renorm`**)

> 🔄 **CAMBIO DI DEFAULT — decisione gualt 2026-08-18. Lo 0.65 è RITIRATO.**
> Non è una preferenza: **`drop 0.65` è dominato**, costa qualità *e* tempo.
> Misurato su CalaQwen, sul modello e sulla config che spediamo:
>
> | config | qualità vs d=0.0 | velocità vs d=0.0 (Jelly) | byte |
> |---|---|---|---|
> | d=0.0 (nessun drop) | — | — | — |
> | ~~d=0.65 (vecchio default)~~ | +0.91% | **+5.8% più LENTO** | −27.3% |
> | ~~d=0.65 + no-renorm~~ | +0.20% | ~+5.8% più lento | −27.3% |
> | **d=1.0 + `--drop-no-renorm`** | **+1.18%** | **−12.9%** | **−71.8%** |
>
> `d=0.65` è più lento di non droppare affatto **in tutti e tre i round**
> (+10.9 / +5.2 / +1.2%): non ha mai comprato velocità. L'unico punto che la
> compra è d=1.0, e `--drop-no-renorm` ne taglia il costo di qualità del 70%
> (da +3.96% a +1.18%) **senza cambiare quali esperti cadono, né i byte letti,
> né la velocità** (misurato: +1.1% e −1.3% fra round confrontabili, segno che
> si inverte ⇒ equivalenti).
>
> **Contro l'ancora VERA di CalaQwen** (`k8 d0` = 0.6660114, misurata 17/08):
> il nuovo default sta a **+0.0201, cioè il 50% del budget** `MACRO_PASS=0.04`.
> Il vecchio 0.65 stava a +0.0182 (46%) — quasi pari — mentre **d=1.0 col
> default renorm stava a +0.0389, il 97% del budget: passava per 0.0011.**
> È il flag a rendere d=1.0 spedibile invece che al limite del bocciato.
>
> **Qualità delle risposte verificata, non dedotta** (`results/answer_quality_calaqwen`,
> `results/answer_sanity_calaqwen`): istruzioni con vincoli verificabili
> rispettate; funzione Python **8/8 test eseguiti**; prosa italiana senza
> collasso; **15/16** sulle domande di buon senso (l'unico errore è del
> RIFERIMENTO k=8, non della candidata).

| | valore | note |
|---|---|---|
| **modello** | **KEXP** `Qwen3.6-35B-A3B-KEXP.gguf` (sha `ac44e20c…`) | IQ2_M resta riferimento storico, non cancellato |
| **config di campagna** | `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm` | **DEFAULT B** (gualt 2026-08-18). Sostituisce l'A del 10/08 (`drop 0.65`), ritirato perché dominato |
| ⚠️ **numeri device da rimisurare** | il cambio di default **invalida le tok/s assolute** delle celle S23/Xiaomi, misurate a `drop 0.65` | il segno è noto (−12.9% sul Jelly, byte −71.8%), gli assoluti per device no. **Non citare le vecchie tok/s per la config nuova** |
| **binario** | CAMPAIGN `1ca51420…` = prefault tri-stato + dense2 + fix KV + scorer + drop runtime | pin sha-verificato, `bin_sha256` in `runs.csv` |
| **load cold** | **~10 s** (KEXP ~12.5 GiB; storico IQ2_M 9.37 GiB) | E1 chiuso su IQ2_M; KEXP size-bound |
| **prefill per turno** | **~8-11 s COSTANTI** su 5 turni (T5: 9.34 s, n_common 1387) | prima del fix KV: 165 s al T5. Il TTFT non degrada più |
| **decode** | ⚠️ **da rimisurare col default B.** Storico a `drop 0.65`: med 5.86 tok/s (k6d065 n=200 staccato), ctrl k8d065 5.16, legacy IQ2 drop0.50 ~4.4 | griglia `moe-adopt-kexp.md` parte 3. **Quelle cifre sono del vecchio default e NON valgono per B** |
| traffico | **default B (Jelly, 12/12): read 2654.9 MiB / 200 tok, hit 84.8%** — contro 9410.3 MiB / 75.5% a d=0.0 e 6842.4 / 78.8% al vecchio 0.65 | `results/dropsweep_calaqwen_jelly`; byte identici alla cifra fra round ⇒ contabilità deterministica |
| hit esperti (decode) | **84.8% col default B** (75-83% sulle celle storiche a 0.65) | cache 2000 |
| energia | 1.0-1.4 J/token, ~40k token per carica | F4.7 (pre-KEXP, da rinfrescare se serve) |
| **qualità** | PPL decode **1.852** (k6d065); floor prodotto storico IQ2_M **2.0955** | ⚠ metro campagna ancora su corpus Dante (`corpus_subset_10k`); confronti interni OK. Corpus v2 + re-ancoraggio floor = decision gualt |
| **collo di bottiglia** | **il CALCOLO** (I/O esposto = 20% del decode; freq a regime 41% del picco) | F4.9, F5.2, F5.3-A3. Drop = solo I/O (saturo); k&lt;6 morto su KEXP |

## I 3 capitoli che contavano: TUTTI CHIUSI

1. ✅ **Prefill incrementale** (fork `2c675a5`): history grezza + `preserve_thinking=true`.
   T5 165→9.3 s (−94%). Vincolo permanente: memoria ibrida attention+SSM → niente rollback
   parziale KV (edit/regenerate = ri-prefill completo). Report: `moe-kv-reuse-fix.md`.
2. ✅ **Loader E1**: prefault tri-stato (−51%) + dense2 (memcpy+drop mmap) = 21.05→9.37 GiB.
   Residuo chiuso per esperimento (mincore: il reclaim avviene DURANTE il warm-up).
   Report: `moe-dense2.md`, `moe-adopt-dense2.md`.
3. ✅ **Metro PPL sul decode-path** (`--ppl-decode`, fork `d408e03`, Δ=0 esatto vs prefill
   a ubatch=1) **+ prima leva lossy ADOTTATA**: `--drop-cold-experts 0.50` — poi k6d065
   come default prodotto. Report: `moe-dropcold.md`, `moe-adopt-kexp.md`.

## Chiuso di fresco (2026-08-11/12)

| ramo | verdetto | report |
|---|---|---|
| **LiteRT fail-fast S23 (porta-740)** | **F0/F1 PASS su Gemma E2B** (GPU ~26.8 vs CPU size-matched 9.7, ~2.76×, unplugged) **ma FAIL su Qwen 1.5B** (GPU ~18.7 vs CPU 25.8, 0.73×): il win GPU è **size/stack-dependent**, non universale. Kernel-spike nel fork: solo se ROI prodotto; NON riaprire OpenCL llama vanilla (K2/K5 restano validi) | `moe-litert-f0-f1.md`, `moe-litert-qwen.md` |
| **LiteRT twin classi prodotto 2B/4B (S23, unplugged)** | **GPU non misurabile via Gallery**: 2B BLOCKED (nessun bundle ufficiale ~2B, famiglia Qwen litert = 0.5/0.6/1.5/4B; import non ufficiale rigettato), 4B **NO GPU OPTION** (`qwen3_4b_mixed_int4.litertlm` offre solo CPU; Gallery CPU 5.3-5.7 vs llama-bench 8.38 — llama.cpp CPU vince pure). **Twin CPU misurati**: Qwen3.5-2B Q4 tg256 **18.10**, 4B **8.38**. Curva CPU: 1.5B 25.8 → 2B 18.1 → 3B 9.7 → 4B 8.38 | `moe-litert-product-classes.md` |
| **shortlist velocità C (k=5)** | **DONE_NO_VIVE** — k5d065 PPL 2.456, k5d000 2.307, entrambe > floor 2.0955; speed skip | `moe-shortlist-velocita.md` |
| shortlist A (drop-by-weight) / B (top-p) | **archiviate per meccanismo** (drop non salta matmul; B senza route rows utili) | mandate `shortlist-velocita.md` |
| **italiano Marco prosa moderna** | **MISURATO** (Wikipedia Caffè v2): Marco bpb 0.750 &lt; Qwen 0.769; T2c **PASS** 5/5 | `moe-trial-marco-it-v2.md`, `quality_gates.json` |
| knee drop-cold IQ2 k=8 | **eseguito** (0.65 candidato, 0.80 archived PPL) — pre-KEXP; non riaprire come leva k6 senza fatto nuovo | `moe-knee-dropcold.md` |
| GPU OpenCL Adreno / ik kernels | **chiusi** (ricerca + spike) | `research-adreno-opencl.md`, spike S1 |

## Deciso e CHIUSO (non riaprire senza un fatto nuovo)

| ramo | verdetto | perché |
|---|---|---|
| politiche di cache | **vuoto** | nessuna batte LRU sul carico vero; Belady−LRU = 6.37 pt |
| **taglia cache** | **2000, ottimo misurato** | incorniciata: 1500 −15%, 3000/3500 −62/−68% (thrash → RescueParty) |
| **ubatch** | **512** | 2048: prefill −15.5% E buffer 4× |
| prefetch cross-layer | **morto** | Recall@8 19.2%, extra-fetch 274%; predittore 87-91% varrebbe +3.1% |
| MTP / speculazione | **morto, con letteratura** | 0.00% ammortizzo byte; 3 meccanismi indipendenti. Riapertura solo NPU/GPU verify + acceptance ≥60% |
| **k ridotto (lossy) su KEXP** | **morto (confermato)** | k5d000 +0.45 vs k6d065, sotto floor; k5d065 peggio. Decode CPU: k=6 è il pavimento qualità |
| drop-cold estremi | **morti come leva compute** | drop = solo I/O (remap top expert); I/O già saturo d065→d080 +0.15% speed |
| ri-quantizzazione 1c esperti | **pareggia** | guadagno calcolo ≈ penale byte |
| kernel IQ2 a mano | **rinviato / NO-GO su 8 Gen 2** | ik g_IQ2 0.719 &lt; 1.20 |

## Aperto, e cosa serve per chiuderlo

| domanda | stato | chi sblocca |
|---|---|---|
| **✅ Marco FASE 1: CHIUSA, PASS PIENO** (`results/marco_phase1/VERDICT.md`) | **Qualità full multi5 3/3 PASS**: A1 k8d065 ΔMacro **+0.0040** (drop quasi gratis a k=8); A3 k6d050 **+0.0095**; A2 k6d065 **+0.0182** (peggiore ma in gate; peggior lingua zh +0.033 vs soglia +0.10). **Speed S23 PASS su entrambe le leve**: A2 1.303× decode, −34.4% MiB/tok, hit +3.2pt. **Per PROTOCOL: transfer runtime SUFFICIENTE** → k/drop di campagna adottabili su Marco senza requant. **CONFERMA CROSS-SILICIO (Jelly Mali/G99, Grok#2 gualt, 2026-08-12 notte): A2 1.17× decode, MiB/tok −35.6%, hit +4.3pt — la riduzione byte è IDENTICA all'S23 (−34.4%), il moltiplicatore velocità scala col silicio (1.30× Adreno / 1.17× Mali).** Scelta cella prodotto (gualt): **A2** = speed misurata + qualità peggiore-ma-in-gate; **A3** = metà del costo qualità ma speed device non misurata; A1 = qualità ~gratis, leva solo-I/O. **Fase 2 MarcoKEXP resta l'upgrade di REGIME I/O** (KEXP stesso device: 30.7 MiB/tok e hit 80.7% vs 126.2/36.7 di Marco A2 → batteria e sostenuto) — GO gualt separato. Report di fase in scrittura | gualt: scelta cella + decisione Fase 2 |
| **✅ MarcoKEXP (FASE 2): QUALITÀ PASS + SPEED 1.62× — decisione ship matura** | Qualità (Grok#2): 1c e cons PASS full; la tassa è il requant (~+0.03 bpb it/en), il drop aggiunge ~+0.01. **Speed S23 (ABBA same-session): Marco-1c 8.819 tok/s vs Marco-Q4 5.442 = 1.62×; MiB/tok 126→51.5 (−59%, bar ≤60 PASS); hit 36.7→53.5 (+16.8pt, sotto il +20)**. Non è ancora regime KEXP-35B (31/81) ma **Marco-1c è ora il modello grande più VELOCE del listino** (8.8 vs 5.7 di CalaQwen). **🚢 SHIPPATO (gualt 2026-08-13): lineup grandi = CalaQwen + Marco1c.** Originale Q4KM + cons + sorgente Q8 CANCELLATI (PC −35 GB; device cleanup in corso). Scheda listino 3-telefoni: celle Jelly-Marco1c misurate (Grok#2); **Xiaomi-Marco1c DONE (2026-08-13 notte, staccato 72→68%): t6 med 4.101 t/s / 51.5 MiB/tok / hit 53.5%** — regime I/O IDENTICO a S23/Jelly alla cifra (51.5/53.5); sustained hot 6.84 (nessun collasso stile CalaQwen: il cold paga il DONTNEED, non c'è throttle — temp 33-35°C). **MA t4 = 8.577 t/s (2.1×, compute 0.048 vs 0.116 s/tok): la card rule "cpu_capacity≥50% → t6" STRANGOLA SM8650 su Marco1c** (CalaQwen invece è thread-flat — è un effetto per-modello, Marco è compute-heavy, CalaQwen flash-bound). Round chiuso: **Marco1c t4 screen-ON = 10.574 t/s, sopra l'S23 (8.82)** — il flagship sorpassa il 2023 appena config e schermo sono giusti; ginocchio t4>t5(9.25)>t6 | rebase card t4/screen-on: gualt |
| **⚠⚠ SCHEDA FLAGSHIP CalaQwen (Xiaomi 14): regime IDENTICO, decode DIMEZZATO** (`moe-calaqwen-xiaomi.md`, retry con extm OFF + pin campagna linkato) | **t6 med 2.55 tok/s / 30.4 MiB/tok / hit 80.75%** vs S23 5.86/30.7/80.7. Due fatti enormi: (1) **il regime streaming è INDIPENDENTE dal silicio** (30.4/80.7 ≈ identici) — la macchina KEXP trasferisce perfettamente; (2) **il decode del flagship 2024 è LA METÀ del 2023**: prima cella fredda 4.02 poi crollo a 2.3-2.7 = throttle/scheduler HyperOS sostenuto (majflt ~0: lo swap è morto, confermato — era la Memory Extension). Lezioni prodotto: perf NON prevedibile dalla gen del silicio; serve probe runtime (RAM E sustained-perf). **PERF-MODE HYPEROS: NULL su CalaQwen (2026-08-13 notte)** — speed_mode+screen_game_mode+gb_boosting: med 2.475 vs 2.55 = 0.97× (su Marco1c invece 1.52×, 4.11→6.25 — side observation). **ROUND t4+SCREEN CHIUSO (2026-08-13 notte, §"t4 + screen round" nel report, `results/xiaomi_t4_round/`): VERDETTO SCREEN — il "flagship dimezzato" era un artefatto Doze.** 2×2 fact: CalaQwen t6 screen-ON med **4.750** (vs 2.55 campagna screen-off, +86%), t4 screen-ON 4.580 (~flat vs t6, anche in campagna era flat), t4 sustained REGGE 4.392 (zero collasso; flash I/O stabile ~0.20 s/tok vs il 0.22→0.50 del Doze). Il numero prodotto vero del Xiaomi 14 su CalaQwen è **~4.75, NON 2.55** — sopra il floor S23 non sotto la metà. Su Marco1c invece le leve sono DUE: thread (t6 4.11 → t4 8.58 screen-off, CalaQwen non ne risente) + screen (+23% a t4 → **10.574**, compute 0.041, flash 425 MiB/s = sopra l'S23 8.82, primo sorpasso flagship). Ginocchio t4 > t5 (9.25) > t6. Lezione doppia: (1) mWakefulness in colonna runs.csv d'ora in poi, (2) probe runtime per-SoC su thread. **Question chiusa (gualt 2026-08-13): S23 e Jelly erano SCREEN-ON in campagna** → i listini S23/Jelly sono già in condizione prodotto, nessun rebase; era solo lo Xiaomi in Doze. Confronto apples-to-apples finale: Marco1c Xiaomi 10.57 vs S23 8.82 (1.20×, sorpasso vero); CalaQwen Xiaomi 4.75 vs S23 5.86 = ancora 0.81× (residuo flash-bound da capire, ma non più "dimezzato") | celle card Xiaomi da rifare screen-on (t6 CQ + t4 M1c come product cells) |
| **Free tier G99 a 15-20 tok/s — pista LFM2.5-8B-A1B: ✅ VIVA, misurata** (`moe-g99-freetier.md`) | Jelly staccato `-t 2` n=200: dense 2B **8.04** (come da fisica); **LFM2.5 k=4 10.60, k=3 12.28, k=2 14.38** (−4% dal target). `lfm2moe` supportato dal fork, `--n-expert-used` funziona; RAM ok (RSS ~5 GiB, no thrash). BW effettiva solo 10.8 GB/s su 15-17 → i tagli byte pagano ~lineari. **PROIEZIONE KEXP-experts (2-3 bit): 14.7/16.3/18.3 a k=4/3/2 → target 15-20 raggiungibile.** Pipeline PC: **A0 k4/3/2 DONE, KEXP quantizzato e VERIFICATO** (falso-FAIL del verify riparato — era enum-vs-int; ricetta rispettata al tensore: 44×q2_k gate/up, 22×q3_k down), **PPL KEXP DONE (2026-08-13 sera): tassa KEXP macro +5.7% a k4 (BPB 1.29 vs 1.22) e +5.6% a k3 (1.33 vs 1.26) — MA la tassa NON è uniforme sulle lingue: IT paga +26% PPL già a k4 (29.2→36.8) e +41% a k3 (41.2); k2 COLLASSA in entrambi i bracci (A0 macro 1.48, en 48.0; KEXP en 55.2) → celle restanti k2 ABORTITE per decisione gualt (inutili, PC liberato per selfspec; `KEXP-k2/ABORTED.txt`). DECISIONE: k4 (gualt 2026-08-13)** — k3 solo se l'A/B speed Jelly compra ≥25% E lo smoke IT regge. **RE-TEST JELLY DONE (sera): KEXP_REGRESSION + K4_FINAL — proiezione 14.7/16.3 RIFUTATA** (§KEXP re-test in `moe-g99-freetier.md`): KEXP k4 **8.83** t/s (vs A0 10.60 G99 / 9.76 stessa sessione), k3 10.27 (1.16× — non riapre). Il meccanismo previsto È successo (majflt/tok ~0, file 100% residente in page cache, load 3.9 s vs 7.9, prefill fino a 13.6 vs 8.3 = KEXP paga TTFT/load) MA il decode è **dequant-bound Q2_K/Q3_K sui 2×A76**: cpu-s/tok 0.224 vs 0.198, banda implicita 6.8 GB/s « roofline 10.8 — la proiezione assumeva il roofline Q4, che coi sub-4bit su core deboli non vale. **Lezione: su silicio debole, meno byte ≠ più decode se il dequant costa.** Target 15-20 su G99 NON raggiunto; opzioni gualt: (i) accettare A0 Q4 k4 = 10.6 come cella free-tier Jelly, (ii) candidato REAP-50, (iii) niente LFM su G99-class. **(ii) MORTA COI DATI (2026-08-14 notte, §REAP-50 in report + `results/reap50_jelly/`): pipeline completa in una notte (fetch HF 9.18 GB → primo convert safetensors→GGUF della famiglia → Q4_K_M 2.82 GB → cella Jelly) e verdetto REAP50_LOSES: k4 resident = 10.68 vs A0 streamed 10.60 (+0.8%), k3 12.20, k2 14.23 — curva IDENTICA. Residenza PROVATA (majflt 0.00/tok, 100% page cache, hot=cold) ma il decode non se ne accorge: REAP dimezza gli esperti STORED, non gli ACTIVE — stessi ~1033 MiB attivi/token, stesso muro ~11 GB/s. Il file -42% compra prefill 15.9 vs 10.0, TTFT 8.2/5.7 vs 13.3 s, load 3.36/0.90 s e headroom RAM, NON token/s. Bonus recon: la tag Apache-2.0 del repo konic è SBAGLIATA (parent LFM v1.0, i derivati ereditano); smoke qualità già debolino (tassa prune visibile). La decisione si semplifica: (i) A0 10.6 vs (iii) no-LFM-G99** — nota: REAP-50 come sostituto di A0 a pari decode per TTFT/RAM esisterebbe solo passando un quality gate che lo smoke rende improbabile. **Sfidante Ling 3.0 Tiny: NOT_BETTER** (`research-ling3tiny.md`) — arch `bailingmoe3` non mergiata (PR #26608), think-on 51k tok/task, no IT/ES/FR, proiezione Jelly ~14-16 = stessa banda; watchlist post-merge + smoke think-off, non un secondo SKU | gualt: decisione free-tier (i) 10.6 / (ii) REAP-50 / (iii) no-LFM-G99; se (ii): quality gate REAP |
| **🎯 LANE FT tool-call+IT (idea gualt 2026-08-13 sera; PIVOT gualt post-licenza): PRIMO target Qwen3.5-2B (in-app, Apache 2.0 = zero condizioni sui derivati, ed è dove vive il dolore system-prompt/tool); LFM2.5-8B-A1B SECONDO, solo se il free-tier sopravvive alla decisione (i/ii/iii). Decisione licenze (gualt): UN SOLO LFM in lineup (8B free-tier), 2.6B **NOT_ADOPTED CONFERMATO (recon DONE, `research-lfm25-26b.md`)** — nessuno shock, anzi: (1) prefill vs Qwen3.5-2B NOT_PUBLISHED e l'unico dato ARM indipendente (RK3588, SoC PIÙ forte del G99) fa ~30 tok/s prefill ≈ i nostri 28 — l'ipotesi prefill è morta sui dati; il 2-3× del marketing è vs Qwen3-4B su S25, e il predecessore 2.6B vs Qwen3-1.7B è pari in prefill e PERDE in decode; (2) **always-think non disattivabile** (il `<think>` è nel template) = tassa TTFT per risposta su telefono ~30 tok/s — killer per lo slot chat; (3) stessi problemi conv-state cache/seq_rm di llama.cpp (#16491 #19041) = stessa classe del nostro C3. Sotto-prodotti utili del recon: lista moduli Unsloth confermata per la famiglia; llama.rn 0.13.0-rc.0 (llama.cpp recente) esiste per l'upgrade engine app; IFStruct 85.5 vs 33.15 di Qwen2B (stessa leaderboard) = il tool-following LFM è vero, ma il FT nostro su Qwen copre il bisogno senza condizioni di licenza. La pipeline dati (Registry, inventario variabile, negativi) è model-agnostica: costruita una volta, applicata a Qwen subito, a LFM poi** | Doppio razionale misurato: (1) il prompt system/tool dell'app è ~1.4k token (TTFT verify: 47 s di prefill su G99) — un modello che conosce i tool Kalsa NATIVAMENTE (device_info, calc, calendar, web-search, notes) taglia il prefisso a poche centinaia di token = win TTFT strutturale su ogni telefono, cumulativo col prewarm V2-2; (2) recupero qualità IT contro la tassa KEXP (+26% PPL it a k4). **Recon EPFL DONE (`research-epfl-lfm25.md`): i "37" = PersonaPO, griglia personality Big-Five di UN team studenti CS-552, da BASE, solo EN, zero eval, zero tool-use → NESSUN candidato utile (NOISE/RESEARCH_ONLY), non toccare quei pesi.** MA due regali dall'albero HF: (1) **LLM-OS-Models Terminal-ToolBench full-SFT sul modello REASONING per tool-call JSON con tabella metrica vera (TB2-lite 52.30)** = proof-of-concept che l'SFT tool-call su LFM2.5 reasoning FUNZIONA; (2) TRL/PEFT girano sull'arch (LoRA r=16 attn-only degli studenti = ricetta da NON copiare per tool-call, ma la toolchain è provata); bonus watchlist: konic-labs REAP-50 (prune 5B, interesse RAM), noctrex MXFP4_MOE. Nessun FT IT/FR esiste sull'albero → se vogliamo l'IT migliore, il tune lo facciamo NOI. GATES in ordine: (a) licenza LFM: **YELLOW(conditions) = verde operativo con paperwork (§6 `research-epfl-lfm25.md`)** — derivati+requant permessi (requant = Object form, stessa disciplina), NO copyleft, NO AUP contenuti; condizioni VINCOLANTI: (1) revenue <$10M INCLUSI affiliati (§1 Legal Entity aggregation; sopra = §11 terminazione AUTOMATICA anche dei device già shippati → comprare da sales@liquid.ai PRIMA del cliff), (2) testo licenza lfm1.0 dentro l'app per ogni utente (§4a), (3) notice "derivato modificato di Liquid AI LFM2.5" + notices su tokenizer/config (§4b-c), (4) MAI brandizzare LFM/Liquid come nome prodotto (§7; "based on Liquid AI LFM2.5" ok), (5) MAI rilicenziare i pesi Apache/MIT (la prassi community OTel/Tini è ILLEGALE, non copiarla); (b) ricetta: **GREEN (§7)** — skeleton: base REASONING (mai Base/PersonaPO), template+tool-token NATIVI (`<|tool_call_start|>[name(arg=...)]`, NON il JSON Terminal che fa solo 77% valid), LoRA r16 α32 lr2e-4 su `q/k/v/out_proj + in_proj + w1/w2/w3` (out_proj NON o_proj — il typo è nel cookbook Liquid stesso!), esperti = nn.Parameter → servono `target_parameters` PEFT (LoRA attn-only non li tocca MAI), router MAI, train-on-response-only, **1 epoca e stop** (Terminal 2-ep regredisce), mix ~50/50 IT-chat-replay : tool-traces (anti-forgetting), `<think>` preservato (forzato IT su subset), RLVR solo dopo e solo se serve (+1.7 misurato); proof: ToolBench full-SFT 36.5→52.3 su reasoning model, (c0) **Tool Registry v1 DRAFT PRONTO** (`docs/tool-registry-v1.md`, 564 righe, contract `kalsa.tools.v1`; task report con 4 domande aperte per gualt): **15 tool** = 6 shipped (dall'app REALE: device_info, device_calc, calendar_agenda, web_search, web_fetch, document_chat — memory extract e notes oggi NON sono tool) + 9 roadmap (notes r/w, memory save/forget/recall, reminder create/list/cancel, deep_research); regole chiave: train-bytes==infer-bytes (prefisso congelato nel JSON spec), renderer per famiglia (qwen35 compact lines / lfm List-of-tools nativo / other=Gemma legacy), scritture persistenti = user-confirm, additive-only, stock Qwen INTOCCATO fino al flip atomico coi pesi FT. **Review ostile DeepSeek DONE: APPROVE_WITH_FIXES(6)** — 35 claim verificati sul codice (tutti i behavioral OK), MA 6 CONFIRMED da chiudere prima del freeze: F1 template ES/FR non specificato vs mix 25% ES+FR (due letture → byte diversi), F2 document_chat nothing-matched distinguibile solo sniffando stringa localizzata (vietato dal dispatch — serve discriminatore strutturale), F3 not_available vs permission_denied contraddittori + membership inventario con memory OFF indefinita, F4 ordine inventario mai pinnato (3 ordini diversi nel doc!), F5 inventoryHash indefinito + toolProtocol fuori dall'env-hash (= riuso KV stantio nel flip debug), F6 i 4 messaggi skip/dedup/failed-repeat (LlamaService.ts:294-302) model-visible ma non congelati. **CICLO REVIEW CHIUSO: FREEZE_OK (3 giri)** — fix r2 (F1-F18) → re-review FREEZE_BLOCKED(2) (B1 byte serviti ≠ costanti congelate: wrapper localizzato+use-rule; B2 provenance memory/notes senza meccanismo runtime) → fix r3 (tabella 8 righe caso×locale byte-esatta verificata riga per riga sul codice; `spec.provenance` con firma, in PR-3, stringhe verbatim) → **gate finale FREEZE_OK**: contratto `kalsa.tools.v1` CONGELATO, 2 micro-note in PR-0/PR-3. Otto+ bug train≠infer uccisi prima di entrare nei pesi. Domande aperte gualt — **NB (chiarito 2026-08-13): gatano i PR APP (executor roadmap), NON il training** (il modello vede solo inventario/chiamata/envelope; il dataset non dipende da queste): (1) reminder→oggetto OS, (2) skip extractMemory post memory_save + stop clearCache (=fix TTFT), (3) cap mensile deep_research (costante app). La (4) ES/FR chiusa dal freeze. **RICETTA QWEN3.5 DONE (`research-qwen35-ft-recipe.md`): RECIPE_YELLOW = via libera con 7 vincoli nello script.** Scoperte chiave: (1) il 2B è classe VLM (`Qwen3_5ForConditionalGeneration`, vision tower da FREEZARE); (2) il path nativo `tools=` di 3.5 è XML qwen3_coder, NON Hermes → **mai passare `tools=`** (conferma KD4 del registry: inventario compatto nel prefisso + gold Hermes JSON coi token riservati 248058/9); (3) trappole nomi mappate: `in_proj_qkvz/ba` sono nomi Next CANCELLATI su 3.5 (skip silenzioso), e coesistono `o_proj` (attn) E `out_proj` (GDN) — una lista con uno solo è mezzo-skip; `A_log`/`dt_bias` nn.Parameter irraggiungibili; (4) `convert_lora_to_gguf.py` ROTTO su adapter GDN (llama.cpp #21125) → merge-then-convert obbligatorio + tokenizer dal base; (5) packing OFF (DeltaNet non gestisce i boundary); bf16, NO QLoRA (sconsigliato da Unsloth su tutta la 3.5); (6) VRAM: **una 24 GB basta** (2B LoRA bf16, 5 GB @2k misurati). Skeleton bancato: r16 α32 lr 1e-4 (SWIFT official-adjacent), 1 epoca, response-only, target attn+MLP+5 GDN Linears (o all-linear+freeze vision), think 20% open / 80% empty+ignore_empty_think. **TUTTI I GATE FT CHIUSI (a licenza, b ricetta ×2 famiglie, c0 registry FROZEN)** → GO spike = parola di gualt; critical path reale: PR-0 (JSON freeze) + PR-2 (dump prefisso, app-side, gata PR-4 generatori) → dati → SFT su 24 GB; il tune insegna il FORMATO con inventario variabile per-esempio (chiama SOLO ciò che è nell'inventario runtime) + esempi NEGATIVI (tool noto ma assente → non chiamarlo, capacità non disponibile) — così feature nuove = riga in inventario, zero re-tune, e niente allucinazioni di tool assenti; (c) piano dati: traces tool-call sintetiche sul Registry + chat IT, (d) spike training + eval (multi5 PPL + harness acceptance tool-call, incl. test negativi), (e) KEXP requant sopra i pesi tunati (pipeline esistente). Nessun GO compute finché (a)+(b) non sono verdi | recon EPFL → follow-up ricetta; gualt: lista roadmap tool per Registry v1 + GO spike dopo gates a/b |
| **💪 Mellum2 coding-SKU ("pro a pagamento"): F0 PASS — STRONG 15/20** (`moe-mellum2-f0.md`) | fromdoc 5/5, review 3/3, bugfix 6/8, refactor 1/4 (debole); EN code-explain 7/7, **IT usabile** (il "en only" di HF era pessimista); PC idle 24.2 tok/s. Rischio prodotto: diff no-op dall'aspetto valido → il client deve verificare che il patch cambi codice. Appendice Metal pronta per M1 Max. **F1b S23: STREAMS_OK ma regime PESANTE — 2.944 t/s / 185.0 MiB/tok / hit 76.0%** (2 rep staccato, riga ricetta `mellum` su branch `kalsa/mellum-recipe` @ d987027, build `bmoe-cli-mellum` sha 69a35f5e, pin campagna intoccato; no shared expert, router ffn_gate_inp). La proiezione carta (92 MiB/tok) era SBAGLIATA: attivi pieni ~780 MiB/tok × 24% miss = 185 misurati. **Compute ceiling ~4.5 t/s SOSPETTO** (Marco1c computa ~3B attivi a 8.8 all-in → indiziati: build fresca con REPACK default −33%, cpuset nproc=6). **F1c griglia k (2 rep, staccato): k8 2.94 / k6 3.76 / k4 4.72 / k2 5.68 t/s** (1.93× a k=2, mai compute-bound puro; MiB/tok 185→55.5 ma hit crolla a 68.5 a k=2); **drop 0.65 a k=2: taglia I/O (→47.9) ma PERDE tok/s** (compute 0.119→0.133). Qualità k tagliato NON gatata (k=2 garbage a vista, k=4/6 coerenti). Banda KEXP+k col ceiling attuale: 3.5-8.4. **F1d VERDETTO: CEILING_REAL(mul_mat_id)** — rebuild flag-campagna identico a F1b (2.90 vs 2.94, compute 0.228 vs 0.224: i8mm/REPACK innocenti QUI); **dense 2B sullo stesso binario = 15.9 t/s** (build sana); pin sui big peggiora (oversub); forense 1 Hz: 73.9% dei tick sui LITTLE (WALT classifica i 64 micro-mul_mat_id come lavoro little) ma forzare i big non alza il tetto. **È la geometria: 64 micro-esperti (3×2304×896) ≠ GEMV denso da 2.5B** (Marco1c 8.8 = esperti più grossi e meno numerosi). Banda finale KEXP k=8: **3.5-4.4** (l'85% hit sbatte sul muro compute). **F1e (zona viva trovata): k=6 drop 1.0 = 4.638 t/s (+23.4%), PRIMA cella Mellum COMPUTE-BOUND** (flash 0.115 < compute 0.175, hit 87.6%, MiB/tok 39.2, drop 12.1% routing); k=8 d0.75 +13.7%; d0.75 a k=6 debole (coda sottile 4.5%); **io-two-wave NULL → flag chiuso**. Qualità drop NON gatata (PPL richiesta). **CONVERGENZA COL KERNEL: essendo compute-bound, se K0 conferma ≥50% recuperabile, k6d1.0+KEXP+kernel proietta ~7-9 t/s su S23** (senza kernel: KEXP ~5.2-5.7). SKU: S23-class = tier streaming; target primario iPhone Pro / flagship 12-16GB residente (M1 Max = proxy banco, non target) | K0 spike in corso su S23; gate PPL drop/k dietro selfspec |
| corpus PPL v2 di campagna (sostituire Dante sul metro floor) | in valutazione; ri-ancorare floor ≈ 3 run PPL PC (KEXP F=0, k6d065, IQ2 hist) | gualt design + PC |
| **Integrazione prodotto Kalsa** (llama.rn ↔ BigMoeOnEdge) | design doc esiste; non ricerca | gualt GO Fase 1 |
| energia J/token col drop k6d065 | opzionale F4.7-style | telefono staccato |
| **🔨 CANTIERE GDN-GPU (DECISIONE gualt 2026-08-12; ruoli: Claude design, Grok codice)** | **K0 DONE, RIBALTONE** (`moe-gdn-k0-op-inventory.md`): **i kernel GDN esistono GIÀ nel nostro pin** — upstream ha aggiunto `GATED_DELTA_NET` + `SSM_CONV` OpenCL (8ad8aef44) E i kernel MoE Adreno `MUL_MAT_ID` Q4_K/Q5_K/Q6_K. Il claim K2 del 3/8 ("ops mancanti") è STALE. Verificato dai GGUF (2026-08-12): **S_v=128 su 2B/4B/35B → dentro il gate GPU {16,32,64,128}**; dk=256 → flash-attn OK. Gap residui VERI: G4 GET_ROWS embedding quantizzato → CPU (piccolo); **Q7-LANDMINE: l'expert-ready hook dello streaming è SOLO nel loop CPU di mul_mat_id** → per il 35B gli esperti DEVONO restare su CPU (o engine da rifare); per i dense 2B/4B nessun MoE → grafo interamente GPU-abile OGGI. **K2.1 DIAGNOSI CONFIRMED → K2.2 FIX IN VOLO**. K2 (`moe-gdn-k2-e2e.md`): S23/740 FAIL_CORRECTNESS, GDN 36/36 OK, flash-attn non compila (buco driver K5), MUL_MAT_ID Q4_K rotto (73 FAIL) → esperti 35B su CPU (hook + correttezza). **K2.1 (`moe-gdn-k21-parity.md`): il garbage E2E NON era GDN/attention/stato — era SOLO l'lm_head**: tied `token_embd` Q6_K [2048×248320], il redirect large-M (`use_flat_gemv_for_large_m_q6_K`, ggml-opencl.cpp:6459) lo ruba al GEMV noshuffle Adreno (corretto sul 740) e lo dà al kernel flat (NMSE ~12). Workaround verificato: `-ot token_embd.weight=CPU` → output sano. **K2.2 FATTO** (`moe-gdn-k22-fix.md`, branch `kalsa/opencl-q6k-dispatch-fix` @ a92a51627): redirect large-M spento quando ne1%128==0 → lm_head sul noshuffle corretto; greedy GPU **token-identico** al CPU senza workaround; GDN 100%; regression tests aggiunti. **PRIMO NUMERO ONESTO 740: decode GPU 0.41× CPU (5.06 vs 12.37) = FAIL; prefill 1.29×** → sul 740 il decode GPU perde anche da corretto: lane 740-decode CHIUSA per misura (coerente con LiteRT 1.5B 0.73× e K5). Review ostile del diff IN VOLO (DeepSeek: buco soglie + path non-Adreno). K2.3 (kernel flat) deprioritizzato: con la fix nessun tensore reale dei nostri modelli lo usa più. Review PASSATA + K2.2b chiuso @ 04c5d362a. Recon Google: TECHNIQUES_ONLY (`research-google-gpu-kernels.md`). Recon 750 (`research-adreno750.md`): **750 è A7X, broadcast=false anche lì → gate Xiaomi LIKELY_FAIL; primo silicio col broadcast = 830/8 Elite (non in lab). MA LiteRT vince 1.43× a 3.8B SUL 750 con kernel subgroup-free → il port è L'UNICA via GPU per l'installed base A7X.** **🪦 M1 PORT: FAIL ONESTO, port GEMV ucciso a costo minimo** (`moe-mld-m1.md`): (a) i dequant subgroup-free MISCOMPILANO sul driver E031.41 (NMSE 0.67-0.9; stesso convert + kernel stock = PASS → è il driver, non il codice); (b) il colpo decisivo: **noshuffle è GIÀ al tetto DRAM (34-41 GB/s) sulle shape FFN dominanti** — la leva layout del paper è già spesa nei kernel esistenti; 1.4× richiederebbe 48 GB/s che non esistono. **Diagnosi in regalo**: il gap E2E (GPU 10.25 vs ~26.6 teorici al tetto) è ~60 ms/token di OVERHEAD DISPATCH/GLUE, non kernel → una continuazione seria = fused executor stile ML Drift (mesi), non kernel (settimane). Decisione gualt: parcheggiare GPU-decode su A7X (bancando: GDN-first, prefill GPU 1.3-1.7×, CPU 18.19, fix Q6_K) oppure M2-feasibility SOLO CARTA (conteggio dispatch/token da sched log + ceiling fusioni, 1 giorno) prima di chiudere | gualt: park vs M2-carta |
| **📊 TTFT (LA priorità user-facing): F0 Jelly COMPLETO — i minuti sono il RE-PREFILL (13.8 tok/s), e il riuso KV di sessione è ROTTO** (`moe-ttft-f0-jelly.md` + `kalsa-ttft-audit.md` + mandato fix `mandates/kalsa-ttft-fixes.md`) | C1: alloc KV innocuo (~5 s perfino a `-c 262144`). C2: 0.0725 s/token → finestra app 10-16k = **12-19 min** di re-prefill su G99. **C3: riuso 0%** — prefisso byte-identico riprefillato intero; causa supportata: seq_rm rifiutato su ibrido attn+SSM → wipe; binario Jelly ≠ KVFIX `ede3ac7c`. C4: transcript mutato = 2.5-3 min onesti (6+ osservati col wipe). **P0 app (keepalive/eager/compaction) reggono SENZA C3**. **C3-rerun col KVFIX (A76 fresco): FAIL di nuovo — n_common=0, non era il binario**: commit assistant non byte-fedele (re-render perde esattamente gli 8 token generati) + seq_rm che non tronca su ibrido attn+SSM → wipe. KV-reuse su questo arco = **0% finché l'engine non fixa il commit assistant** (o checkpoint SSM). **VERIFY branch fix @ 56464da su Jelly (2026-08-13, `kalsa-ttft-verify-jelly.md`): FAIL TOTALE — S1 cold 53.4 s = identico al vecchio path.** Anatomia: 6.6 s init (eager MAI partito: `runAfterInteractions` cancellato dai re-render di boot, `engine.eagerInit` mai in logcat) + 47 s prefill del prompt system/tool da ~1.4k tok a 28 tok/s (restore `.kvs` ibrido wippato nativamente: JS ok:true 1635 tok, `loadPrompt:462` n_past=0 = Q6.c, l'88% del numero, FUORI scope app). Keepalive morto su OEM-kill (processo ucciso in <5 min). Compaction default-ON non applicato agli upgrade (chiave "0" residua). ORO nel report: **in-process il prefix-reuse FUNZIONA (1407/1436, 1.8 s)** → la mossa v2 è PREWARM del prefisso system a boot (non serve Q6.c per il messaggio 1). **V2 IMPLEMENTATO E MISURATO SU JELLY (grok gualt, branch `fix/ttft-v2` @ 493336b, 11 commit): 🎯 TTFT 53.4 s → 1.40 s (scenario 1a: cold + 90 s + send, `reusing 1276/1293`).** Matrice: 1b (send immediato) 39.5 s = join sul prewarm in corso (<53 richiesto ✓); swipe-kill→relaunch→90s→send **2.48 s** (il prewarm copre la morte processo — lo scenario che il keepalive non avrebbe MAI coperto; KVDIAG onesto n_past:0); scenario 2 PARTIAL (processo morto a metà misura, ma recovery send riusa 1276/1456). Keepalive correttamente NON shippato (motivazione onesta nei docs). Design: prewarm via stesso `withEngineJob` (FIFO join), `n_predict:0` senza fallback (un token emesso avvelenerebbe il prefix-match), hash-miss→fall-through, `prewarmPrefixHash` protegge il KV chat caldo; 2 fix trovati SUL DEVICE (add_generation_prompt=false + one-char user per il jinja). Numeri PLUGGED (A/B relativo = deliverable). **Review ostile DONE: MERGE_WITH_FIXES(3)** — le racce/leak/jinja/n_predict:0 REGGONO tutti (i 17 token non riusati = coda user-line, bounded, non cresce); i 3 CONFIRMED: (5.1) prewarm su modelli DENSI distrugge il restore vero (seq_rm riesce su Gemma → chat tail cancellata + 40 s sprecati; fix = skip se kvHoldsChatSession && !hybrid), (5.4) chiave bake rematch non persona/whitespace-stabile → BAKE_FORMAT_B no-op silenzioso per utenti con persona, (5.2) **premessa migrazione compaction FALSA**: git log -S prova che l'unico writer della chiave è il toggle → ogni "0" salvato è scelta esplicita utente e la v2 la calpesterebbe (fix = "0" resta OFF, default-ON solo a chiave assente). **✅ MERGIATO SU MAIN (2026-08-13 notte)**: 3 fix landed (e599a0b skip prewarm su dense-restore reale, 601cba3 bake key = stringa persona'd della history via `bakeRematchKey` canonica, 2e6b088 "0" = OFF esplicito default-ON solo a chiave assente) + optionals (foreground gate `AppState==="active"` anti prewarm-storm OEM, telemetria `n_predict_rejected`, hash documentato identity-only). Harness tutti verdi (prefixPrewarm 4 casi dense-restore, memoryFactsTail 20/20 persona+whitespace, compactionParse, eagerKick, sessionSaveGate 24/24); smoke Jelly skippato (device non idle, fix logic-level coperti). Diff auditato dal coordinatore (incl. verifica che il foreground gate non uccida il cold-launch: il prewarm parte a fine init engine, quando AppState è già active). Merge --no-ff su ai-chat main | engine-track: Q6.c resta per cold-restore chat lunghe |
| **🪦🪦 Typeahead CalaQwen + phase-split 2B (test gualt S23 2026-08-13): DUE DEAD, entrambi su buchi ENGINE non di fisica** | **Typeahead DEAD**: prefill incrementale ricalcola tutto (527 tok: 67 s vs 64 s da zero; a pezzi = 3.5× il prefill unico) — riuso KV solo con `--chatml` (`n_common=0` senza) e manca l'API "rimpiazza prompt + prefilla delta". **Split 2B**: soffitto 0.73× (20.6 s vs 28.3 CPU su turno 490+128) SOLO con handover KV in-process; con 2 processi = 1.27× (peggio); tutto-GPU 29.2 s (peggio). Dettagli nel registro checkpoint | riapertura solo su engine-work (API delta-prefill / KV handover) |
| Jelly free-tier baseline (Qwen3.5-4B dense, llama-bench ABBA `-t 2`) | **DONE 2026-08-14** — product **3.52 tok/s** tg128 `-t 2` (median 4 ABBA decode samples; tight 3.52–3.53, one 2.09 drift). **Bottom of the G99 free-tier ladder** (below 2B 8.04 and LFM k4 10.60). UNPLUGGED 100→90%, 30→37 °C, screen Awake. Pin `36b01966` before=after. `reports/moe-jelly-freetier.md` + `results/jelly_4b_baseline/` | closed |
| REAP multilingua F0 | smoke PC PASS; phone path parziale | gualt se priorità |
| **🔧 KERNEL CPU micro-esperti (mul_mat_id batched) — GO SPIKE (gualt 2026-08-13 sera)** | Il caso F1d: Mellum2 computa 0.228 s/tok, scaling dal dense 2B predice ~0.09-0.10 → **~2.5× perso in mul_mat_id** (672 micro-GEMV/token 896-wide, sync per-op, WALT→little 74%, dequant senza pack). Design: GEMV batched per-layer (k esperti fusi), pack SIMD al cache-insert, 1 sync/layer, hint scheduler. Paga: Mellum2-S23 (4.4→6-9), TUTTO il residente (iPhone Pro/flagship = target SKU), LFM2.5-class; NON Marco1c-S23 (tetto flash). Weakness nota upstream → PR-worthy. **Gate: spike profiling 1g** — se ≥50% di 0.228 recuperabile → GO kernel (1-2 sett); se GEMV puro a tetto DRAM → chiuso col numero. **K0 DONE (2026-08-13): GO_KERNEL, recuperabile 72%** (`moe-mellum2-kernel-k0.md`): GEMV puro NON a tetto (fused Q4_K 39 GB/s, floor 0.023 = 10% di 0.228); waterfall = layout 8% + dispatch per-op 43% + tax sync/scheduler t4-vs-t2 21%; dequant <2% (non leva). Sorprese: (a) **`-t 2` batte `-t 4`: 0.181 vs 0.236 — stage 0 GRATIS, zero codice**; (b) down NON è Q4_K (Q8_0×14+Q5_0×14, già a tetto DRAM 53.5 GB/s — non impaccare); (c) mul_mat_id Q4_K = "8 GEMV in fila" (ID 557 µs ≈ 8×single 571). Design a stadi: S0 `-t 2` (5.5 t/s) → S1 pack 8 esperti Q4_K in un MUL_MAT (6.1) → S2 fusione per-layer gate+up+SiLU+down, 84→28 launch (7-9) → S3 placement solo dopo. Soffitto onesto 7-9 t/s compute; 10 t/s richiede anche KEXP/k-cut sul flash. Gate correttezza: NMSE <5e-4 + greedy n=32 token-match vs pin. **GOAL (gualt 2026-08-13): S23 wall ≥9 t/s (stretch; base onesta 7) via S0-S2 + KEXP + k6d1.0; flagship RESIDENTE 15-20 t/s (Xiaomi 14 ~10-14, 8 Elite Gen 5 15-20 — Oryon ~2× + banda ~2× + KEXP ~4.5GB in RAM). Vincolo design: kernel GEOMETRY-PARAMETERIZED (n_expert/k/d_ff/quant letti dal GGUF, zero hardcode Mellum) + autotune on-device (thread count: la U t2-vs-t4 è per-SoC; micro-bench al primo avvio, cache per device). GPU = backend separato scelto da probe, non stesso kernel.** **S1 DONE (2026-08-13, `moe-mellum2-kernel-s1.md`, branch `kalsa/kernel-s1-expert-pack` @ 93d78ab): S1_FAIL(4) MA kernel CORRETTO e al floor** — fused 231.6 µs a t=8 (2.58× vs stock), NMSE 8/8 PC+S23, greedy token-identico, no-regression su qwen3moe 256e. Il fail: on-model t=2 compute 0.182 = baseline 0.181 → **la fetta layout 0.018 del K0 era un artefatto t=8-only** (a t=2 stock=fused=tall=421 µs: 2 thread saturano già la banda del GEMV). Recuperabile rivisto (framing pulito, review esterna Qwen3.8-Max recepita): vs t=4 0.228 = ~64% (dispatch 43% + tax 21%); MA a policy t=2 la tax è già spesa → fetta azionabile = dispatch 0.097 su 0.181 ≈ **54%**; la predizione S1 6.1 t/s è morta, S2 resta la leva vera (84→28 launch, banda onesta post-S2 0.11-0.14 = 7-9). Review S2 al rientro: aggiungere greedy LUNGO n=256 ON/OFF (drift router/cache che n=32 non cattura); post-S2: sanity secondo device (Jelly 2×A76+6×A55 = geometria core diversa, testa anche l'autotune). Respinti coi dati: S1-OFF-default (neutro a t2, +0.027 a t4, substrato S2), prefetch (già rifutato su flash-saturo). S1 NON è codice sprecato: a t=4 mangia 0.027, ed è il substrato per S2 (op grasse → thread di nuovo scalabili: fused a t=8 fa 232 µs). Bonus: k6 d1.0 a t=2 compute 0.159 (vs 0.175 a t=4). Coordinatore ACCETTA FAIL(4) come "kernel buono, slice 2 t=8-only" → S2 GO. **S2 IMPLEMENTATO (2026-08-13 sera, report kernel-s2-impl): fusione backend-level dei 5 nodi MUL_MAT_ID+MUL_MAT_ID+GLU+MUL_MAT_ID+MUL in UN launch CPU** (`ggml_compute_forward_moe_swiglu_id_fused`, stadi A quantize→B tall-GEMV gate+up+SiLU→C quantize→D down+reduce, barrier interni, steal S1) — llama.cpp `74e37a625` + BigMoeOnEdge `0c54a27` su `kalsa/kernel-s2-layer-fuse` (branch VERIFICATI su disco, non pushati); matcher a 15 condizioni (n_tokens==1 only, prefill stock; K-quant gate/up; tail VIEW/ADD/CONT o partial), flag `--moe-fused-ffn` default ON + env `GGML_MOE_FUSED_FFN`; **geometry-parameterized come da vincolo gualt (zero hardcode: tutto dai tensori) + caso qwen3moe 128e nei test**; correttezza PC 7/7 (`MOE_SWIGLU_ID`, NMSE 5e-4, incl. n=2 must-NOT-fuse). **MISURA S23 round 1 (2026-08-14 notte, `reports/moe-mellum2-kernel-s2.md` + `results/kernel_s2/`): STOP onesto a CORRECTNESS_FAIL** — 7/7 backend-ops su device PASS, greedy n=32 PASS, ma **n=256 fuso ON vs OFF diverge al char 677** ("(or" vs "(and") — il check n=256 adottato dalla review esterna ha pagato. Celle gate NON partite (da mandato), pin campagna MATCH, S23 90→87%. Diagnosi da fare: **riordino FP deterministico (fisiologico per kernel fuso: cambia l'ordine di somma, NMSE in tolleranza, logit quasi-pari flippa tardi) vs RACE**; discriminante = ON-vs-ON ripetuto. Celle unofficial n=256 t4 k8: compute 0.204→0.179 (−12%, sopra il gate se fosse il gate — ma non è la griglia). **Triage determinismo + celle gate condizionali IN VOLO** (grok kernel-s2-gate: se ON==ON → DETERMINISTIC_REORDER → griglia k6d065/k6d1.0 × t2/t4/t6 stanotte con caveat "pending numerics policy"; se ON≠ON → RACE → stop e si aspetta la review). **REVIEW ADVERSARIALE DONE (01:10): MERGE_WITH_FIXES(4), ZERO BLOCKER — kernel PULITO** (report kernel-s2-review, ~2h di audit con harness compilato ad hoc): race/barrier/scratch/hook tutti REFUTED con prove (steal-counter cross-fase ok, aliasing F32-down ok, hook wait-all idempotente ok); **per i grafi di produzione l'output fuso è BIT-IDENTICO allo stock (NMSE 0.000e+00, stessa quantize, stesso ordine di somma)**. I 4 fix = buchi del MATCHER su grafi legali mai costruiti da llama.cpp (pesi ne[0]≠1 NMSE 2.07, hidden ne[1]≠1 NMSE 1.09, view duplicate NMSE 0.81, contiguità hidden pre-quantizzato) — one-liner difensivi, fix grok IN VOLO (kernel-s2-fix, non tocca l'aritmetica → i numeri gate di stanotte restano validi). Regressione: MUL_MAT_ID 798/798, MUL_MAT 1140/1140, **full CPU suite 16191/16191**. **Chiave per il drift S23: la bit-exactness è provata sui vec_dot; la build S23 ha REPACK ON → lo stock ARM accumula in ordine diverso (kernel repacked) dal fuso (vec_dot row-wise) = meccanismo che predice ON≠OFF come RIORDINO DETERMINISTICO, non race.** **GATE S23 DONE (01:35, Phase A+B in report kernel-s2-gate): DETERMINISTIC_REORDER CONFERMATO (ON==ON e OFF==OFF byte-identici, ON≠OFF stesso punto) — kernel corretto, zero race. MA il verdetto perf è S2_PERF_NULL nella sostanza (S2_PARTIAL solo per lettera: best fused 0.1585 ≤0.17): il fuso è PIÙ LENTO dello stock in OGNI coppia same-t** (k6d065 t2: OFF 0.163 vs ON 0.1735; k6d10 t2: OFF 0.148 vs ON 0.1585; retry confermati) — il path fuso bypassa i kernel REPACK/i8mm dello stock ARM e perde più del dispatch che risparmia; la fetta "dispatch 43%" del K0 era MAL ATTRIBUITA (già S1 lo suggeriva a t2). t6 = trash termico (0.45). **PEPITA: k6d10 OFF t2 = 5.151 t/s wall (MiB/tok 39.2, hit 87.6%) — NUOVO BEST Mellum2-S23, +11% su F1e 4.638, gratis (solo config t2+d1.0)**; il 7-9 via kernel-CPU è morto coi dati, opzioni: (a) chiudere la lane col numero 5.15 (quality gate d1.0 PPL resta dovuto), (b) S3 = fusione REPACK-aware (rifare il path fuso sui kernel repacked — lavoro serio, solo se gualt ci crede), (c) tenere S1+S2 come substrato corretto per silicio non-REPACK (PC?). **Fix matcher DONE (01:50, commit verificati su disco: b34df7afd + 4a3ae4e5e sopra 74e37a625): 4 predicati richiesti + tutti i minor (atomic flag, env "off", test 7→10 con F32-down/K-quant-down/negativo per-row-weights); le 3 sonde adversariali ora rigettano la fusione → ALL MATCH 0.000e+00; MOE_SWIGLU_ID 10/10 anche -t1/-t3, MUL_MAT_ID 798/798, MUL_MAT 1140/1140. Il branch è pulito e PR-able upstream a prescindere dalla decisione di lane** | gualt: (a) chiudi col 5.15 / (b) S3 repack-aware / (c) archivio (+eventuale PR upstream); PPL d1.0 in coda PC |
| **Esperimento serio sul CALCOLO** | plateau ~5.9 tok/s k6d065 su S23/CPU. **NUOVO (mandato gualt 2026-08-12): pista MoE-GPU scoped Adreno 750+** — sequenza gated (a)-(e) in candidati #1: F-0 Amdahl → riverifica upstream → MarcoKEXP come veicolo → S2 split su Xiaomi 14 → solo dopo il kernel serio (GDN/SSM per CalaQwen) | F-0 = carta; S2 dopo MarcoKEXP |

### Candidati "esperimento serio" (il collo è il calcolo a 1.39 GHz)

1. ~~**GPU Adreno 740 via OpenCL — split eterogeneo**~~ **RITIRATO 2026-08-09 dopo deep
   research** (`research-adreno-opencl.md`). Due killer, entrambi verificati alla fonte
   dal coordinatore: **K2** — `GATED_DELTA_NET` ❌ e `SSM_SCAN` ❌ sul backend OpenCL
   mainline (ops.md), e il nostro modello è ibrido su ~30/40 layer → split/sync per
   layer; **K5** — su un S23 identico al nostro (Adreno 740, driver 0676.73 senza
   subgroup broadcast) il decode OpenCL è **più lento del CPU** già misurato in campo
   (tg128: 5.9 vs 9.8 su Llama-3B, 10.8 vs 14.6 su Qwen-2B GDN, discussion #22791).
   Il +30-50% è ritirato; upper bound onesto ~+15% e solo in scenari futuri.
   Unico VERDE utile: **K1** — i nostri tensori dense sono Q5_K/Q6_K (~1.75 GiB), NON
   i-quants: se mai si riaprisse, il requant non serve. **Criteri di riapertura:**
   GDN+SSM_SCAN upstream su OpenCL **E** driver S23 con subgroup broadcast **E** un
   tg OpenCL>CPU pubblicato su 740. NPU HTP: non candidato (0.67 MiB di pesi caricati).

   **[REVISIONE 2026-08-12 — mandato gualt: MoE-GPU riaperto, scoped Adreno 750+.]**
   Il ritiro sopra resta valido PER IL 740/S23 (il claim di ricerca "35B su 8GB"
   resta CPU-only). La pista nuova è il **tier premium su flagship** (Adreno 750+,
   dove il backend OpenCL è verificato e K5 non si applica), col fatto nuovo LiteRT
   (740 GPU 2.76× con kernel giusti → K5 condanna i kernel llama.cpp, non la GPU).
   Incastro chiave scoperto rileggendo lo spike S0 Xiaomi: **il B1-STOP non era
   "GPU perde", era formato quant** (Marco i1 ha dense attention IQ2_S/IQ3_S che
   l'OpenCL backend non carica). E **Marco è `qwen3moe` NON ibrido → K2
   (GDN/SSM_SCAN) NON si applica a Marco**: con un requant dense Q4-Q8 — cioè
   esattamente **MarcoKEXP** — lo split dense-GPU/esperti-CPU su Xiaomi 14
   (Adreno 750, già in lab) si misura col backend OpenCL VANILLA, zero kernel
   custom. Sequenza gated dichiarata:
   (a) **F-0 Amdahl** (carta, 1 giorno): quota densa vs esperti del tempo decode
       per token → ceiling onesto dello split; STOP se <~1.3×;
   (b) riverifica upstream dei claim OpenCL del 2026-08-03 ("tensori MoE restano
       su CPU", ops mancanti) — hanno 5+ mesi;
   (c) **MarcoKEXP requant** (già prepped, gated su GO gualt) → doppio uso:
       Fase 2 qualità/CPU E veicolo fail-fast GPU-750;
   (d) **S2 su Xiaomi 14**: Marco(KEXP) split resto-GPU/routed-CPU, llama.cpp
       OpenCL al pin, sostenuto staccato + J/token;
   (e) SOLO se (d) vince: il "kernel serio" 750+ — GDN+SSM_SCAN (per portare
       anche KEXP/CalaQwen ibrido su GPU) ed eventuale mul_mat_id esperti —
       sinergico con lo spike F3 dense (stesse fondamenta GEMV).
   Razionale prodotto: chi paga il tier premium ha flagship (RAM 12-16, UFS4,
   750+); il bonus termico è reale (CPU oggi a 1.39 GHz = 41% del picco per
   budget termico; spostare FLOP su motore più efficiente libera anche il CPU).
2. **Integrazione prodotto in Kalsa** (llama.rn ↔ BigMoeOnEdge): non ricerca ma
   ingegneria; porta i numeri della scheda dentro l'app vera. Prerequisito per shippare
   qualunque cosa di questa campagna.
3. ~~**Kernel i-quant CPU**~~ **CHIUSO PER MISURA (2026-08-09, spike S1)**: sul
   nostro S23, ik_llama è **più lento** del nostro mainline sul decode — g_IQ2
   **0.719**, g_IQ3 0.805 (regola g<1.20 → NO-GO). Il 1.42× pubblicato su M2-Max
   si è invertito sull'8 Gen 2; il pp512 3.39× conferma che il setup era vivo
   (ik vince sul GEMM/prefill, non dove serve). Con questo, il plateau decode
   ~4.4-4.7 tok/s è il soffitto onesto del percorso flash+CPU su questo quant.
   Riapertura solo con: numeri TG > mainline pubblicati SU 8 Gen 2 o silicio
   affine, o un product-need prefill (lì ik vince 3.4×, scope port diverso).

## Regole operative imparate a caro prezzo

- **In carica i TEMPI non sono affidabili** (dispersione 25-27%). In carica si misurano
  byte, hit, PPL, output, dimensioni — tutto il deterministico.
- **Prompt byte-identici con checksum** fra fasi confrontabili; **il template chat fa parte
  del contratto** (un template che spoglia il think ha rotto il riuso KV: la re-render deve
  essere byte-identica ai kv_tokens).
- **Prima di progettare, leggere `--help` per intero**: 5 volte una funzionalità già
  presente ha ribaltato una conclusione.
- **Chiedersi su QUALE CARICO si sta misurando prima di quale opzione vince**; vale anche
  per le previsioni (metrica+traccia viaggiano insieme).
- **Mediana pooled ≠ effetto reale**: il pooling di prompt diversi gonfia i Δ (speed
  drop-cold: +6.5% pooled, +2.4-3.9% per-prompt). Dichiarare l'aggregazione prima, ma
  leggere anche la vista per-prompt nel verbale.
- **Il g di un altro silicio non è il tuo g**: ik 1.42× su M2-Max è diventato 0.72×
  (INVERTITO) sull'8 Gen 2. I numeri prior-art motivano lo spike, mai il cantiere:
  solo la misura on-device decide. (Gemello della regola "quale carico": qui è
  "quale silicio".)
- **I guardrail si cambiano per mandato, non a caldo in un retry** — anche quando la
  lettura tecnica è giusta. Firma RescueParty: MemFree ≪100 MiB **E** die 88-92 °C
  sostenuti per minuti (il telefono muore a ~90 sostenuti, non a 98).
- ~~**Budget qualità lossy CUMULATIVO**: ΔPPL ≤0.15 vs baseline originale~~
  **OBSOLETA dal 2026-08-11** (audit shortlist, MAJOR-4): superata dall'adozione
  di k6d065 (Δ+0.327 vs KEXP F=0). La regola operativa vigente è il **floor
  prodotto: PPL ≤ 2.0955** (mai peggio dell'IQ2_M shippato) — regola di gualt,
  `results/kexp_baseline/README.md`. Nei report: ΔPPL riportata sia vs F=0 sia
  vs default corrente.
- **IL DROP NON SALTA MAI IL MATMUL** (fatto di meccanismo, audit 2026-08-11,
  verificato al sorgente `router_hook.cpp:206-216`): lo slot droppato è
  ripuntato sul top expert e ricalcolato (dot duplicato by design). Drop-cold =
  leva **SOLO I/O** (i miss non letti), MAI compute — e il lato I/O è saturo
  (d065→d080: +0.15%). L'unica leva compute fork-legale è **k** (cambia gli
  slot davvero calcolati: k8→k6 = +13.6% misurato). Correzione alla dicitura
  storica "caricati/calcolati" di moe-dropcold.md e alla narrativa del
  coordinatore che per tre giorni ha attribuito al drop risparmi di GEMV.
- **Route-trace INSIEME alla misura** se andrà confrontata con una simulazione.
- **Sapere COSA C'È nel corpus prima di fidarsi del metro** (T2c 2026-08-11): il
  corpus PPL di campagna e la slice multi5 IT erano la Divina Commedia
  (Gutenberg 1012) — testo che il 35B ha MEMORIZZATO (bpb 0.27 vs 0.83 su ZH).
  Spiega i PPL 1.5-2.1 "assurdi". Confronti interni same-model: validi in
  direzione. Confronti cross-model su quella slice: NULLI. Le slice valide
  sono prosa moderna simmetrica (Wikipedia "Caffè" ×4 lingue).
- Un gate che legge da un **comando esterno fallisce aperto**, uno su **sysfs fallisce
  chiuso**.

---


> 📦 **Archivio**: le sezioni storiche del piano V1 (contesto, ruoli, stato dell'arte,
> fisica, ipotesi, roadmap F0-F9, tabella comparativa, criteri, rischi, decision tree,
> fonti) e i checkpoint fino al 2026-08-11 sono in `PLAN-archive.md`. Qui resta la
> vista viva + §8 telemetria/harness + i checkpoint recenti.

## 8. Telemetria, harness e formati (per F0.3)

### 8.1 Cosa si misura, da dove

| Metrica | Fonte | Note |
|---|---|---|
| prompt tok/s, eval tok/s, ttft | output llama.cpp (`llama_perf`/timings) | parsare, non ricopiare a mano |
| majflt, minflt | `/proc/<pid>/stat` campi 12/10 | delta pre/post run; majflt = letture da flash |
| read_bytes | `/proc/<pid>/io` | leggibile per processi propri (stesso UID) |
| RAM processo/sistema | `/proc/<pid>/status` (VmRSS), `/proc/meminfo` | prima/durante(peak)/dopo |
| temperatura | `termux-battery-status` (JSON, campo temperature) | thermal zones = SELinux-blocked, non provarci |
| hit/miss cache esperti | contatori del fork (verificare in F0.4; se assenti → patch) | metrica primaria da F4 in poi |
| stabilità | exit code, dmesg non disponibile → log lmkd indiretto (processo sparito) | annotare kill |

### 8.2 Regole di misura

- 3 run per configurazione, si riporta la mediana; run scartato se temperatura iniziale >32°C.
- Cold = post-riavvio telefono. Warm = run successivo senza riavvio. Pressure = protocollo F5.
- **[2026-08-05] Cold SENZA riavvio — meccanismo primario**: il riavvio on-demand non è
  ottenibile in autonomia (v. §2.3: nessun permesso REBOOT da Termux, adb wireless non
  sopravvive al riavvio). Il cold operativo si ottiene con `~/bin/cold_model.sh MODEL.gguf`,
  che chiama `posix_fadvise(DONTNEED)` sul file del modello (`~/bin/fadv`, sorgente
  `scripts/fadv.c`): evieta **esattamente** le pagine del file sotto test, verifica con
  `mincore` che le residenti siano 0 e **esce non-zero se non lo sono** (un run "cold" non
  può quindi essere riportato per sbaglio come tale). Verificato 2026-08-05: 153856 pagine
  residenti → 0. Rispetto al riavvio è più chirurgico ma non azzera frammentazione/lmkd/
  termica: per questo **ogni riga CSV deve registrare `MemAvailable` a inizio run** come
  covariata (`/proc/meminfo` è leggibile da Termux). Il riavvio vero resta il gold standard
  e si usa quando gualt è presente; in quel caso la nota del run dice `cold=reboot`.
- Cold+warm si misurano ENTRAMBE solo per le configurazioni promosse (la migliore di ogni
  fase → righe B, B2, C2, C3, D, E di §9); gli sweep intermedi (F2.2, F4.3) si misurano solo
  warm. In §9 le celle non misurate si riempiono con "—", mai lasciate vuote.
- Prompt fissi (short/medium/code), `--temp 0` nei run di misura (determinismo), `-n` fisso
  per confronti (64 per il 35B, 128 per i piccoli).
- **[2026-08-04, lezione F2.2] Cooldown tra run**: ≥3 min di idle E temperatura batteria
  ≤30.0°C prima di OGNI rep. La batteria è un proxy LENTO del SoC: run back-to-back
  si auto-throttlano anche con batteria a 30-31°C (misurato: stessa config 8.9 tok/s da
  fresco vs 5.9 back-to-back).
- **[2026-08-04] Sentinella anti-drift**: alla fine di ogni stage di sweep si RIPETE la
  config vincente; se devia >15% dalla sua mediana, lo stage è invalido (ordine/termica)
  e si rifà col cooldown. Nessun "best-so-far" è valido senza sentinella.
- **[2026-08-04, sera] Floor batteria**: nessun rep di misura parte con batteria <40%
  (sotto quota, Android/SoC attivano risparmi che falsano i numeri). Il runner si mette in
  attesa e segnala CHARGE_NEEDED nel log. La ricarica avviene SOLO tra una fase e l'altra
  (mai durante le misure — regola UNPLUGGED invariata); in particolare: **ricaricare a ≥80%
  tra la fine di F2 e l'inizio di F3** (F3 è la fase più energivora della campagna).
- **[2026-08-04] majflt/token si legge INSIEME a tok/s**: run con majflt alto (>50k) =
  page-cache evicted, regime memoria — si annota come tale e NON entra nella mediana di
  baseline (misurato: tok/s correla inversamente con majflt a parità di config). Le mediane
  di baseline si calcolano sui run a majflt basso; il regime alto è un dato di pressione,
  non di prestazione.

### 8.3 Schema `runs.csv`

```
run_id,date,phase,model,quant,file_gb,runtime(mainline|bigmoe|ik|custom),runtime_commit,
flags,threads,n_ctx,kv_type,n_gen,run_type(cold|warm|pressure),
prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,
vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes
```

### 8.4 Template report di fase (`reports/moe-f<N>.md`, in questo repo)

```
# F<N> — <titolo> — <data>
## Cosa è stato fatto (vs piano)
## Numeri chiave (tabella, riferimenti a run_id)
## Deviazioni / sorprese / bug
## Verdetto gate: PASS | PASS-CONDIZIONATO | FAIL | BLOCKED(<motivo>)
## Prossima azione proposta
DONE
```

---

## Registro checkpoint

*(voci ≤ 2026-08-11 in `PLAN-archive.md` → «Registro checkpoint (archivio)»)*

- **2026-08-14 (sera) — 🏆 KF_PROTO_WIN: il primo kernel-candidato che
  VINCE su device.** A/B Jelly Marco1c (config campagna t2 k6 d065,
  ABBA cold 2+2 + hot + coppia identità d0, batt 84→79, pin intoccato):
  **wall −34.0% (0.318→0.210 s/tok), +51.8% tok/s, IDENTITY_D0=PASS**
  (byte identici a drop 0), win presente anche a d0 (−25.7%), stall
  −58%, e il prefetch mangia pure i page-fault dentro compute
  (0.218→0.163) — quasi saturato il tetto teorico ~36%. Divergenza a
  d065 attesa (F2): l'harness corretto l'ha classificata informativa —
  il gate vecchio avrebbe urlato un falso BROKEN. Costi: ~31% issued
  sprecato (precision 68%), J/token non misurato → cella energia prima
  di ogni promozione a default; N≥10 pre-registrato prima di ogni claim
  di ship. Contesto ops: 2 false partenze (CRLF che uccide il bash
  Termux alla riga 5 con push rc=0; Termux:API morta che finge batteria
  scarica) → 2 memorie con contromisure. In parallelo: **ship A/B S23
  partita** (PREREG 12 coppie stock-vs-certified, warm-up ok, RUNNING).
  Report: reports/moe-kernel-kf-proto.md.

- **2026-08-14 (tardo pomeriggio) — 🔧 K-F: PROTOTIPO LANDATO E BLINDATO,
  in attesa solo dello stacco fisico del Jelly.** (1) **Implementazione
  consegnata**: `--kf-prefetch` issue-only su `kalsa/kf-layer-ahead`
  (b737374 feat / 2150b56 test / dfce4e8 docs), ctest 10/10, G15
  byte-identity PASS, G15b non-vacuo (325 speculati, 27% precision host).
  NB: l'orchestratore grok aveva chiuso la sessione "aspettando il coder"
  3 min prima della consegna — staffetta ripresa a mano ~2.5h dopo.
  (2) **Review ostile (DeepSeek via opencode-go; conto deepseek diretto a
  secco, 402)**: strutturalmente sano — 4 claim contrattuali CONFIRMED,
  race/leak/lifecycle REFUTED; 3 fix pre-A/B applicati e verificati
  (b2f3509 F1 telemetria CPU worker kf esposta in RunSummary/CLI/CSV;
  c3e8fc4 F2 caveat drop + F3 changelog Unreleased). **F2 ha salvato
  l'A/B da un falso BROKEN**: con d065 (config campagna!) l'identità
  byte NON regge (residency è input di apply_drop) — harness corretto:
  coppia identità a drop 0 in coda (gate vero), divergenza d065 loggata
  come ATTESA, vecchio gate hard OUTPUT_COMPARE rimosso. (3) **Runner:
  build Android canonica ok, ma BLOCKED_PLUGGED** (Jelly 100% attaccato,
  pre-check onorato, pin mai toccato). Watcher armato: all'unplug parte
  da solo push+ABBA(7 run: 2+2+hot+coppia d0) con follow per-run.
  (4) **F1b committata da coordinatore** (2396c56, 8 file +670/−10,
  protocollo E2 anti graph-reuse col pad token, RAII k-switch); corsa
  E1/E2/E3 sul 35B ACCODATA a fine PPL arms (due 35B streaming insieme
  = thrash RAM/IO). (5) P1 mergiato su ai-chat main (47be749): stack
  TTFT ship-grade (già bancato 926958f).

- **2026-08-14 (pomeriggio) — 🏭 IL GIORNO DEL FUNNEL: sei candidati
  kernel processati, la casa nuova, e il primo bollino qualità.**
  (1) **Kernel funnel**: K-E morta (i8mm non gira mai: mmla vive solo nel
  REPACK che gli esperti streamati bypassano); K-G morta (l'1.29× GPU
  prefill era una media con cold-outlier; onesto 1.12×; boundary
  innocenti 0.068 ms/tok); **K-F VIVA** (stall 37.3% del wall derivato a
  zero minuti device; prototipo issue-only in volo sul macchinario
  route_ahead già esistente); **libreria Kalsa Kernel** costruita,
  review MERGE_WITH_FIXES(7)→10/10 chiusi (geometria CABLATA, flag
  utente vincono, CI mai verde-a-vuoto). (2) **PPL GATE_PASS k6d1.0**
  (dMacro +0.0378, worst fr +0.0877) → 5.151 t/s = config prodotto
  certificata. (3) **TTFT PREWARM_UNIVERSAL** su Xiaomi-4B post fix P0
  (1.42/2.02 s, riuso 98.9%); saga P1: REJECT (probe RSS insano su
  engine mmappato — la review ha salvato da un fix che convertiva zombie
  in crash OOM) → on-contact v2 → MERGE_WITH_FIXES(1) → fix3 in volo.
  (4) **Migrazione: BigMoeOnEdge dismesso** (direttiva gualt) →
  `kalsa-engine/` nostro + bundle storia completa, pushato su
  Aspis0/kalsa-moe-experiments previa riscrittura bare-clone della
  storia (5 blob >100MB filtrati da 159 commit, groks in volo mai
  disturbati). (5) Canale Qwen Max attivato via browser: parere
  selfspec bancato (45% rollback-corruption, bomba aritmetica
  sublinearità verify). Lezione ops: `git add -A` mai più (l'APK in
  history è costata una riscrittura); pre-push scan >90MB nel protocollo.

- **2026-08-14 (mattina) — 🏁 LANE KERNEL CPU: CHIUSA SU OGNI ASSE, il
  floor è il silicio.** Arco completo S0→S3b in ~36 ore: S0 t2 (+37% vs
  t4, gratis) → S1 pack (corretto, nullo a t2) → S2 fusione (corretta,
  bit-exact, adversarial-audited, PERF_NULL: perde dai propri overhead
  cache/barrier, non dal REPACK) → S3 Phase 0 (REPACK 8x4 delta −1.5%,
  e la scoperta che NESSUNO repacka gli esperti streamati) → S3b i8mm
  (8x8 mmla ripara l'8x4: ID t2 389 µs ×1.27 sul floor, ma token-model
  +0.2÷4.0% < gate 10%). **Tre kernel diversi misurati onestamente
  sotto soglia → 0.148 s/tok compute a t2 È il floor fisico del path
  micro-esperti su S23-class.** Il prodotto della lane: config
  **k6d10 t2 = 5.151 t/s wall (+37% dal 3.76 di partenza F1c), zero
  righe di kernel nel binario di campagna**, più un branch S1+S2+fix
  upstreamabile (fusione corretta + matcher difensivo — il perf su
  altri silici resta da vedere upstream). La lane velocità passa a
  selfspec (F1 in volo, α=0.70).

- **2026-08-14 (01:40) — 🪦 REAP-50: LOSES, e la fisica era ovvia col senno
  di poi.** Pipeline intera in una notte (fetch 9.18 GB → PRIMO convert
  safetensors→GGUF della famiglia lfm2moe → Q4_K_M 2.82 GB, sha 2d027f33 →
  cella Jelly staccato 81→78%): k4 resident **10.68** vs A0 streamed
  10.60; k3 12.20 / k2 14.23 = curva A0 identica. Residenza PERFETTA
  (majflt 0.00/tok, 688795 pagine = 100% del file in cache, hot=cold) ma
  irrilevante per il decode: **REAP dimezza gli esperti STORED (32→16),
  non gli ACTIVE (k=4 restano 4 × FFN 1792)** → stessi ~1033 MiB/token →
  stesso muro ~11 GB/s del G99. Il -42% di file compra prefill 15.9 vs
  10.0 t/s, TTFT 8.2/5.7 vs 13.3 s, load 0.90 s hot — non token/s. La
  decisione free-tier si riduce a (i) A0 10.6 vs (iii) no-LFM. Lezione di
  campagna (la seconda dello stesso tipo dopo KEXP-G99): su silicio
  bandwidth-bound contano SOLO i byte attivi per token — né i byte
  totali (REAP), né i byte freddi (KEXP) spostano il decode. Bonus:
  licenza konic taggata Apache-2.0 è FALSA (LFM v1.0 ereditata).

- **2026-08-14 (01:35) — ⚖️ KERNEL S2: CORRETTO ma PERF_NULL — e la pepita
  è nella cella di controllo.** Phase A: DETERMINISTIC_REORDER provato
  (ON==ON, OFF==OFF byte-identici; ON≠OFF stesso char — è il riordino
  REPACK previsto dalla review, zero race). Phase B (gate, S23 staccato
  86→84%): **il fuso perde contro lo stock in OGNI coppia same-t**
  (k6d10 t2: 0.1585 vs 0.148; k6d065 t2: 0.1735 vs 0.163; retry
  confermati) — su ARM il path fuso row-wise bypassa i kernel REPACK/i8mm
  e restituisce più di quanto il taglio launch compri. La fetta "dispatch
  43%" del waterfall K0 era mal attribuita. Verdetto onesto:
  **S2_PERF_NULL** (la lettera direbbe PARTIAL, 0.1585 ≤ 0.17, ma OFF è
  già a 0.148). LA PEPITA: **k6d10 stock t2 = 5.151 t/s wall — nuovo best
  Mellum2-S23** (+11% su F1e 4.638), solo config, zero kernel. Arco
  S0→S2 chiuso ONESTAMENTE: S0 (t2) l'unica leva vera, S1/S2 kernel
  corretti e auditati (full suite 16191/16191) ma perf-nulli su
  ARM-REPACK. Decisione gualt: (a) chiudere col 5.15, (b) S3
  repack-aware, (c) archivio. PPL quality gate d1.0 resta dovuto (coda
  PC). I 4 fix matcher della review in volo — il branch resta PR-able.

- **2026-08-14 (00:50) — 🎯 SELFSPEC F0: PASS_LANE_OPEN, alpha pooled
  0.6991 (n=1037, gate ≥0.60).** Run 3 completo dopo i 3 bug infra della
  serata (EOS creative, --execute, sha pin): draft k=2 / verify k=6 su
  CalaQwen, 4 categorie × 2 bracci drop (d065 + d0). Il 0.5419 visto a
  metà era la sola categoria fact in corso — il pooled chiude a ~0.70.
  Con α=0.70 e γ≤4 l'aspettativa è ~2.7-2.8 token accettati per ciclo di
  verify: la matematica dello speedup dipende dal rapporto costo k2/k6
  on-device (da misurare in F1). F1 = engine-work (loop speculativo in
  BigMoeOnEdge), non carta. PC LIBERO → coda: PPL gates Mellum drop/k
  (k6d1.0 = la config su cui punta il kernel S2), da lanciare quando la
  review adversariale finisce di usare il PC. Artefatti:
  `results/selfspec_f0/acceptance/` (8 file ckpt+csv).

- **2026-08-14 (notte fonda) — 🌙 PRIMA NOTTATA A 4 LANE: S2 STOP onesto al
  n=256, Jelly 4B chiude la scala free-tier.** (1) **Kernel S2 su S23**
  (`moe-mellum2-kernel-s2.md`): 7/7 backend-ops device + greedy n=32 PASS,
  ma il check n=256 (adottato dalla review esterna Qwen3.8-Max) becca
  **fuso ON≠OFF al char 677** — celle gate non partite, da mandato. Il
  discriminante riordino-FP vs race è ON-vs-ON ripetuto: triage + gate
  condizionale in volo (kernel-s2-gate). Unofficial t4 k8: compute
  0.204→0.179 (−12%). Nel frattempo la review DeepSeek è diventata
  EMPIRICA: si è compilata `adversarial_s2.exe` e attacca il kernel in 7
  modalità — convergenza perfetta col drift. (2) **Jelly 4B dense 3.52
  t/s** tg128 `-t 2` (ABBA, staccato 100→90%): fisica rispettata (previsto
  3.59 dal rapporto pesi 2.24×); scala G99: LFM k4 10.6 / 2B 8.04 / 4B
  3.52 — il free-tier resta 2B-classe, MAI 4B dense. Riga BLOCKED chiusa
  dal grok stesso. (3) Ops: DUE falsi-morti del watcher (wrapper pwsh
  orfanato dal self-update di grok; `ps -W` inaffidabile nel bash
  background) → watcher v3 su mtime `updates.jsonl` di sessione; lezioni
  in memoria. Selfspec run 3 ancora in corso (~item 305, 8.5 t/s PC).


- **2026-08-13 (notte, tardi) — 🔍 IL "FLAGSHIP DIMEZZATO" ERA UN ARTEFATTO
  DOZE — round t4+screen Xiaomi chiuso in 25 min** (sospetto di gualt sullo
  schermo → design 2×2 thread×screen, `results/xiaomi_t4_round/`).
  CalaQwen fact: t6 screen-ON **4.750 med** vs 2.55 campagna screen-off
  (+86%), t4 flat (4.580), sustained regge (4.392) — il collasso 4.02→2.3
  era HyperOS Doze che strozza il flash I/O (0.22→0.50 s/tok; sveglio resta
  ~0.20). Marco1c: due leve indipendenti — thread (t6 4.11 → t4 8.58,
  effetto per-modello: Marco è compute-heavy, CalaQwen flash-bound e
  thread-flat) + screen (+23%) = **t4 screen-ON 10.574 t/s, PRIMO SORPASSO
  del flagship sull'S23 (8.82)**; ginocchio t4>t5>t6. Cleanup verificato
  (timeout 60 s, perf-mode 0/0/0, pin MATCH). Da stasera: colonna
  mWakefulness nei runs.csv; question aperta se anche S23/Jelly campagna
  fossero screen-off (listini conservativi ovunque?). Nel mezzo: grok
  measurement S2 scoperto MORTO AL LANCIO dopo 4 h di "in volo" fantasma
  (watcher vede solo il report; lezione bancata in memoria: verificare PID
  a ogni check di board). Kernel S2 IMPLEMENTATO e corretto (7/7 PC,
  geometry-parameterized, branch verificati); misura S23 in attesa di
  carica (46% < 55%); review ostile DeepSeek sul diff in volo.

- **2026-08-13 (notte) — 🚢📱 DOPPIO LANDING: TTFT-v2 MERGIATO su ai-chat main
  + cella Xiaomi-Marco1c con RIBALTONE t4.** (1) **TTFT-v2**: i 3 fix della
  review (dense-restore guard, bakeRematchKey canonica persona'd, compaction
  "0"=OFF esplicito) + optionals landed in 3 commit, harness tutti verdi, diff
  auditato dal coordinatore, merge --no-ff (main c407299 → merge commit). Il
  numero che shippa: cold+90s+send = **1.40 s** (era 53.4). (2) **Xiaomi 14
  Marco1c** (`reports/lineup-card.md` + `moe-calaqwen-xiaomi.md` §perf-mode,
  staccato 72→68%): t6 med **4.101** / 51.5 MiB/tok / hit 53.5% — regime I/O
  identico a S23/Jelly alla cifra; sustained hot 6.84 (NESSUN collasso:
  temp 33-35°C, era il DONTNEED non il termico); perf-mode HyperOS
  **PERF_MODE_NULL** su CalaQwen (0.97×) ma 1.52× su Marco1c. IL DATO che
  riapre tutto: **t4 = 8.577 t/s (2.1× su t6, compute 0.048 vs 0.116)** — a
  un 3% dall'S23 (8.82), con schermo spento. La card rule "cpu_capacity≥50%
  → t6" oversubscrive SM8650. Caveat di metodo scoperto da gualt: TUTTE le
  celle Xiaomi (incluso il baseline CalaQwen 2.55) girate screen-off/Doze,
  mai documentato. Round di chiusura in volo: CalaQwen t4 (mai misurata,
  può uccidere la narrativa "flagship dimezzato"), Marco1c t4 r2, cella
  screen-ON. Lezione: il thread-count di card va autotunato per-SoC — stesso
  principio dell'autotune kernel (U t2-vs-t4 per-SoC del K0).
  layout era t=8-only; il kernel è corretto, al floor, e resta il substrato
  per S2.** (`moe-mellum2-kernel-s1.md`, branch `kalsa/kernel-s1-expert-pack`
  @ 93d78ab, llama.cpp b8a78977d)

  - Costruito il virtual tall GEMV (k esperti = un GEMV logico di k×896
    righe, mappa riga→(slice,offset), ZERO memcpy — overhead 14 µs = 6% vs
    MUL_MAT contiguo). Geometry dal tensore a runtime, fallback stock di
    default, flag `--moe-fused-gemv`.
  - Gates: NMSE 8/8 PC+S23 PASS; fused 231.6 µs a t=8 PASS (stock 598 =
    trenchcoat confermato, 2.58×); greedy n=32 token-identico PASS;
    qwen3moe 256e ON/OFF match PASS. **Gate 4 FAIL: on-model t=2 compute
    0.182 ≈ baseline 0.181.**
  - **La scienza**: a t=2 stock ID = fused = tall MUL_MAT = 421 µs — due
    thread a chunk-stealing saturano già quel GEMV. Il guadagno del pack
    esiste SOLO dove i thread abbondano (t=8). Quindi: recuperabile
    rivisto ~64%; la strada è S2 (84→28 launch = la fetta dispatch 0.097),
    e con op grasse i thread tornano scalabili — lì S1 ripaga (a t=4 già
    mangia 0.027).
  - Bonus dato: k6 d1.0 a t=2 → compute 0.159 (best mai visto su Mellum).
  - Igiene perfetta: pin campagna intatto, bins solo ~/bin/kernel_s1/,
    staccato 54→52%.

- **2026-08-13 — 📊 TTFT VERIFY su Jelly: il branch fix è un FAIL TOTALE
  (S1 cold 53.4 s, identico a prima) — ma il report consegna i colpevoli
  esatti e la mossa vincente.** (`kalsa-ttft-verify-jelly.md`, grok gualt;
  mandato v2: `mandates/kalsa-ttft-fixes-v2.md`)

  - **Bug 1 (eager init MAI partito)**: il kick a boot è dentro
    `runAfterInteractions` chiuso su deps volatili — i re-render di boot
    cancellano l'handle. `engine.eagerInit` mai apparso in logcat. I 6.6 s
    di `initLlama` restano sul tap.
  - **Bug 2 (il muro, 88%)**: restore `.kvs` su modello IBRIDO = JS
    `ok:true, 1635 tok` ma nativo `loadPrompt:462` → `n_past=0`, full
    wipe (Q6.c, stessa classe del C3 engine). 47 s di re-prefill del
    prompt system/tool (~1.4k tok a 28 tok/s su G99). Era dichiarato
    fuori scope nel mandato v1 — ed era quasi tutto il numero.
  - Keepalive: il processo viene ucciso dall'OEM in <5 min — un flag
    AppState non sopravvive alla morte del processo. Non è una fix Jelly.
  - Compaction default-ON: non arriva agli upgrade (chiave "0" residua
    della vecchia install).
  - **L'ORO**: in-process il prefix-match FUNZIONA — turno 2 riusa
    1407/1436 token, prefill 1.8 s. Quindi la v2 non aspetta Q6.c:
    **prewarm a boot del prefisso system statico** (byte-identico al
    render del messaggio 1, join se l'utente manda prima della fine) →
    messaggio 1 = delta-prefill + decode ≈ 2-4 s su Jelly, quasi zero
    su S23-class. Q6.c resta necessario solo per il cold-restore delle
    chat lunghe.

- **2026-08-13 — 🔧 KERNEL K0: GO_KERNEL, il 72% dello 0.228 s/tok è
  RECUPERABILE — e lo stage 0 è gratis (`-t 2`).**
  (`moe-mellum2-kernel-k0.md`, artefatti `results/mellum2_kernel_k0/`)

  **Il gate pre-dichiarato (≥50% recuperabile) è passato con margine.**
  Waterfall dello 0.228 s/tok (k=8, S23 staccato, campaign-flag build):
  - **GEMV puro fused: 0.023 s (10%)** — pack Q4_K a 39 GB/s, SOPRA il
    tetto campagna 25. Il GEMV non è il problema: lo 0.228 è 10× il floor.
  - **Layout/scatter mul_mat_id: 0.018 s (8%)** — ID Q4_K 557 µs ≈ 8 GEMV
    singoli in fila (571): oggi mul_mat_id è "8 GEMV in un trench", zero pack.
  - **Dispatch per-op: 0.097 s (43%)** — 84 launch MoE/token + barriere.
  - **Tax sync/scheduler t=4 vs t=2: 0.047 s (21%)** — la U dei thread:
    t1 0.205 / **t2 0.181 (best)** / t4 0.236. Il 3° e 4° thread PEGGIORANO
    (occupancy 87→72%, cpu-s 0.61→1.05, WALT→little 68.8%).
  - Dequant <2% (fuso nel vec_dot, non è leva). Attn ~0.035 stimata;
    sensibilità: perfino attn 0.050 lascia 65% — il gate non si ribalta.
  - Correzione geometria dal GGUF: down NON è Q4_K (896%256≠0) →
    Q8_0×14 + Q5_0×14, GIÀ a tetto DRAM (53.5 GB/s): non impaccarlo.

  **Design a stadi (numeri attesi, gate correttezza NMSE<5e-4 + greedy match):**
  S0 `-t 2` runtime flag → 5.5 t/s compute; S1 pack 8 esperti Q4_K in un
  MUL_MAT (556→236 µs) → 6.1; S2 UNA launch per layer (84→28) → 7-9;
  S3 placement solo a op grassa. Soffitto onesto **7-9 t/s compute**;
  il wall-clock resta flash-bound finché KEXP/k-cut non paga i 183 MiB/tok.
  Igiene: pin campagna 1ca51420… intatto, tool solo in ~/bin/kernel_k0/,
  staccato 58→55%, F1e atteso finire prima di ogni cella.

- **2026-08-13 (sera tardi) — 🏭 L'ARCO MELLUM2 F1→F1e IN UN GIORNO + la
  decisione KERNEL CPU: il muro è `mul_mat_id` (fattore ~2.5× perso), spike
  di profiling GO (gualt).** (`moe-mellum2-f1-s23.md` §F1-F1e,
  `research-mellum2-paper-tuning.md`)

  **La catena dei fatti (tutti misurati, S23 staccato):**
  - F1: arch `mellum` carica, streaming bloccato da UNA riga ricetta mancante.
  - F1b: riga aggiunta (branch `kalsa/mellum-recipe`), STREAMS_OK —
    **2.944 t/s / 185.0 MiB/tok / hit 76%** a k=8 (proiezione carta 92
    MiB/tok era sbagliata 2×: attivi pieni ~780 MiB/tok × 24% miss).
  - F1c griglia k: 2.94→3.76→4.72→5.68 (k8→k2, 1.93×); drop 0.65 a k=2
    taglia I/O ma PERDE tok/s; k=2 garbage a vista, k=4/6 coerenti.
  - F1d forense: **CEILING_REAL(mul_mat_id)** — rebuild flag-campagna
    identico (i8mm/REPACK innocenti QUI); **dense 2B sullo stesso binario =
    15.9 t/s** (build sana); WALT manda 74% dei tick Mellum sui little; pin
    sui big non alza il tetto. Il muro 4.4 t/s è la GEOMETRIA: 64
    micro-esperti (3×2304×896) = 672 micro-GEMV/token.
  - F1e (drop zona-viva 0.75/1.0 + io-two-wave): IN VOLO.
  - Paper 2605.31268 = **Mellum 2 Technical Report** (JetBrains): non è un
    paper di streaming (H100/vLLM/FP8 non trasferisce); conferma MTP
    assente dai pesi; leva k confermata (loro 1.5× su H100, noi 1.93×
    I/O-bound). Matrice di tuning completa bancata: knob mai testati =
    io-two-wave, drop 0.75/1.0 (0.65 possibile zona morta), ahwb (+17.9%
    dichiarato, leva sustained).

  **LA DECISIONE (assessment Claude, GO gualt): kernel CPU nostro per la
  classe micro-esperti.** Il caso: Mellum2 computa a 0.228 s/tok ma lo
  scaling dal dense 2B (0.063 s/tok per 1.15B attivi) predice ~0.09-0.10
  → **fattore ~2.5× perso in mul_mat_id** (micro-kernel 896-wide, sync
  per-op, WALT→little, dequant senza pack). Il kernel = GEMV batched
  per-layer (8 esperti fusi), pack SIMD al cache-insert, una sync/layer,
  hint scheduler. Paga: Mellum2-S23 (tetto 4.4→6-9), TUTTI i modelli in
  scenario RESIDENTE (iPhone Pro/flagship 12-16GB, dove compute è il collo
  — posizionamento SKU corretto: iPhone-first, NON "Mac-first", M1 Max =
  solo proxy da banco), LFM2.5 e futuri MoE micro-esperti. NON paga: Marco1c
  su S23 (è al tetto flash 453 MiB/s). **Gate pre-dichiarato: spike
  profiling 1 giorno** — spaccare 0.228 in dequant/GEMV-puro/dispatch/sync/
  migrazione; se ≥50% recuperabile → GO kernel (1-2 settimane); se è GEMV
  puro al tetto DRAM → chiuso con un numero. Weakness nota di llama.cpp
  upstream → materiale da PR se funziona.

  **Infra riparata in cascata (stesso pomeriggio):** (1) verify KEXP LFM2.5
  era un FALSO FAIL (libreria gguf restituisce tipi come int, script
  confrontava "13" vs "q5_k") — file KEXP PERFETTO, fix + rilancio, ora
  RUNNING_KEXP-PPL; (2) runner selfspec moriva su flag inesistenti
  (--flash-attn/--ngl sul bmoe-cli PC) mascherati da "timeout BMOE_READY"
  — fix + waiter rilanciato in coda corretta; (3) skip-if-done aggiunto al
  loop A0 della pipeline (mai più 6h di PPL ripagate). Mandato
  ttft-verify-jelly scritto e consegnato a gualt (matrice 6 scenari
  before/after sul branch fix/ttft-load-policy, finito).

- **2026-08-13 (sera) — 🔴 C3-RERUN COL KVFIX: FAIL — non era il binario. Il
  contratto di riuso sessione multi-turn è ROTTO sull'ibrido attn+SSM, con
  meccanismo ora identificato a 8 token di precisione.** (addendum in
  `moe-ttft-f0-jelly.md`, log `results/ttft_f0_jelly/C3_kvfix/`)

  Rebuild fresco del commit KVFIX (2c675a5) per A76 (`armv8.2-a+dotprod+
  fp16`, no i8mm, installato come `bmoe-cli-kvfix` senza toccare il pin):
  T2 `n_common=0` su entrambe le rep (prefill 163.8 s, −13% vs C2). In più
  l'agente ha verificato che il sorgente del binario di campagna aveva GIÀ
  entrambe le hunk KVFIX → l'ipotesi "binario sbagliato" è refutata anche a
  livello sorgente. G-K1 (PASS, S23, prompt corto) aveva copertura
  insufficiente.

  **La firma forense**: re-render T2 = 2033 token = T1(1980) + follow-up(53)
  — mancano ESATTAMENTE gli 8 token della risposta assistant di T1 (attesi
  1988+53=2041). Quindi due guasti impilati: (a) il commit della risposta
  assistant nella history non è byte-fedele ai token generati → il re-render
  diverge a ~1980; (b) su ibrido attn+SSM `seq_rm` non può troncare la coda
  (stato ricorrente non riavvolgibile senza checkpoint) → invece di
  n_common=1980 (~97% comunque salvo!) il motore fa WIPE totale → 0%.

  **Vie di fix (engine, in ordine di costo)**: (1) commit assistant
  byte-fedele nella history di sessione — rimuove il bisogno stesso del
  troncamento, è LA fix del contratto; (2) checkpoint dello stato SSM
  (classe patch llama.rn hybrid-restore) — pesante; (3) intanto loggare
  n_common pre-fallback (oggi il wipe è una black box). Entra nella lista
  engine-work insieme a delta-prefill API e KV handover. I P0 app NON
  aspettano (leva minuti = compaction, già giustificata da C2). Citare
  SEMPRE 0% finché una cella non misura diversamente.

- **2026-08-13 (pomeriggio) — 💪 MELLUM2 F0: STRONG 15/20 — il gate coding-SKU
  è superato, e il "ROSSO multilingua" della recon è RIBALTATO dalla misura.**
  (`moe-mellum2-f0.md`)

  Suite 20 task isolati (greedy, template ufficiale, PC `-t 4` senza pestare
  la PPL LFM2.5): **15/20 = CANDIDATE_STRONG** (gate ≥14). Per famiglia:
  fromdoc **5/5**, review bug piantati **3/3**, bugfix 6/8, refactor **1/4**
  (la famiglia debole). Lingue: EN code-explain **7/7 perfetto** (era il
  kill-gate), IT 9×2+1×1 = usabile (risponde in italiano, non madrelingua),
  ES/FR tutti 2 — il tag HF "en only" era pessimista. Speed PC idle 24.2
  tok/s (i ~10 della suite erano contesi con la PPL, non regressione).
  **Rischio prodotto individuato dai fail: diff "no-op"** (05/06: patch
  dall'aspetto valido che tocca solo il docstring e lascia il bug) — un
  merge-bot cieco la applicherebbe; il client DEVE strippare i fence e
  verificare che il patch cambi codice. Refactor locali deboli = pitch "SE
  assistant", non "agente refactor autonomo" (coerente con JetBrains).
  Appendice Metal pronta da incollare per l'M1 Max di gualt (bench + smoke,
  confronto vs 24.2 PC). Prossimo gate naturale: F1 on-device S23 col
  nostro stack streaming (12B/A2.5B, file 8.07 GB → streaming obbligatorio
  su 8 GB) — GO gualt.

- **2026-08-13 (pomeriggio) — 📉📊 DOPPIO VERDETTO: Ling 3.0 Tiny NOT_BETTER
  (watchlist, non sostituisce LFM2.5) + TTFT-F0 Jelly COMPLETO: i minuti sono
  il re-prefill a 13.8 tok/s, e il riuso KV di sessione è USCITO ROTTO (C3 =
  0% salvato).** (`research-ling3tiny.md`, `moe-ttft-f0-jelly.md`)

  **Ling 3.0 Tiny (`NOT_BETTER`)**: geometria vera da config.json 7.893B/
  ~1.14B attivi decode, 128 esperti k=8, ctx nativo 131k (262k è solo YaRN),
  MIT solo su card. Thinking ibrido SPEGNIBILE (`enable_thinking:false`) MA
  zero eval pubblicate a think-off; think-on = 51k tok/task (57 min a 15
  tok/s = kill UX). **Blocco duro: arch `bailingmoe3` NON mergiata in
  llama.cpp (PR #26608 aperta)** — non entra in fabbrica. Niente IT/ES/FR
  documentate (LFM2.5 le dichiara). Q4 4.82 GB non residente in 2.5-3 GB.
  Proiezione Jelly ~14 t/s Q4 / ~16 KEXP = stessa banda di LFM2.5 misurato
  (10.6/12.3/14.4, KEXP 14.7-18.3), non sopra. Leva KEXP più debole (esperti
  ~43% dei byte attivi vs ~70% LFM). Riapertura solo dopo merge PR + smoke
  think-off (fail-fast: GGUF piccolo su fork bailingmoe3-support). AA 25 vs
  8 NON è confronto pulito (think-on vs stima). LFM2.5 resta il cavallo.

  **TTFT-F0 Jelly (C1-C4 DONE, unplugged 69→53%, mai plugged)**:
  - C1: l'alloc KV NON è i minuti — perfino `-c 262144` (3 GiB KV) carica in
    ~5 s; load 2.35-3.75 s; l'app (16k, KV q8/q4 ~78 MiB) è nella banda 2.4 s.
  - C2: LA curva dei minuti — prefill lineare 13.8 tok/s su 2×A76: 257 tok=
    21 s, 974=73 s, 1980=**147 s**; finestra app 10-16k proiettata **12-19
    min** (l'audit stimava 8-16 con slope ottimista). C2@4000 = overflow
    n_ctx 4096, non cella mancante.
  - **C3 ROTTO: riuso 0%** — T2 con prefisso byte-identico e `--chatml` ha
    riprefillato TUTTI i 2033 token (155-180 s vs ~4-5 s attesi). H1-H4
    (flag/load/harness) REFUTATE dai log; H5 SUPPORTED: re-render non
    byte-identico a kv_tokens → `llama_memory_seq_rm` a metà prefisso può
    RIFIUTARE su questo ibrido attn+SSM → session.cpp fa wipe totale
    (`n_common=0`). Indizio chiave: **il binario Jelly `36b01966` NON è il
    KVFIX `ede3ac7c`** che passò G-K1 (preserve_thinking + empty-think).
    Supera la nota trasversale del checkpoint precedente: C3 usava --chatml,
    quindi NON è il n_common=0 del typeahead — è un guasto diverso, engine.
    **Follow-up obbligatorio: C3 re-run col binario KVFIX** prima di citare
    qualsiasi % di riuso.
  - C4 (prefisso mutato): 4007 tok / 6+ min T2 — ma SOVRASTIMA l'anti-pattern
    di un intero T1 finché C3 è rotto; costo onesto isolato ~2.5-3 min.
  - Impatto fix app: **P0-1/2/3 REGGONO senza C3** (compaction ON è la leva
    dei minuti; eager init toglie i 2-4 s di load dal critical path); la
    vittoria KV-reuse resta NON VERIFICATA su entrambi i path (bmoe-cli E
    llama.rn). C5: REPACK ha branch dotprod-only 8×4 per A76 — knob TTFT
    non gratis, serve A/B ON/OFF.
  Nota infra: i 3 agent morivano ai confini di compattazione della sessione
  (4 ondate) — root cause trovata, protocollo detached a verbale
  (`background-kills-at-compaction`). Bonus: recon privacy Grok CLI
  (`research-grok-privacy.md`) — session registry cross-host per account,
  documentato nei posti sbagliati; lockdown disponibile, non applicato
  (decisione gualt: ok così).

- **2026-08-13 (pomeriggio) — 🪦🪦 DUE IDEE, DUE DEAD (test gualt su S23,
  87→81% sempre staccato, no reboot, 35B-GPU non toccato): typeahead morto
  su un BUCO API del motore; phase-split 2B ha un soffitto carino (0.73×)
  ma irraggiungibile senza handover KV in-process.**

  1. **Typeahead (CalaQwen prefilla mentre l'utente scrive): DEAD su questo
     motore.** L'idea era prefillare solo il delta a ogni pezzo di testo;
     nella realtà ogni passo ha ricalcolato TUTTO: a 527 token
     "incrementale" = 67 s vs controllo da zero 64 s; crescere a pezzi è
     costato 3.5× un prefill unico. Causa: il riuso KV parte solo con
     `--chatml` (senza, `n_common = 0`), e anche col chat template il
     protocollo attuale manderebbe un NUOVO turno, non "sostituisci quello
     che sto scrivendo". Non è fisica: è un buco API — servirebbe un
     "rimpiazza il prompt e prefilla il delta" nel motore. Rifare lo stesso
     test è tempo buttato; riapertura SOLO con quell'API engine-side.
     (Nota trasversale: `n_common=0` senza chat template è anche l'indiziato
     naturale del C3=0% riuso visto su TTFT-F0 Jelly — da verificare nel
     report in scrittura.)
  2. **2B phase-split (prefill GPU + decode CPU): soffitto reale, turno
     reale NO.** Turno onesto 490 tok prompt + 128 decode: tutto-CPU
     28.3 s; tutto-GPU 29.2 s (peggio); GPU-prefill + CPU-decode SE il KV
     si passasse = 20.6 s (0.73×, il soffitto); quello realizzabile oggi
     (due processi) = 36.0 s (1.27×, peggio). Il dividendo esiste solo con
     handover KV dentro UN processo (switch di backend a runtime) — lavoro
     engine, non flag. Lane parcheggiata con la stessa etichetta del resto
     del cantiere GPU-A7X: riapre su engine-work, non su altri run.

- **2026-08-13 (mattina) — ⚖️ K4 CHIUSO: lo split è CORRETTO ma PIÙ LENTO su
  ogni asse sul 740 — N3 FAIL (decode 0.698×, TTFT 0.59×), N4 skippata.
  Il primato resta di meccanica e correttezza, non di velocità.**

  N3 (ABBA 2 prompt, staccato 100%, guardia MemAvailable dopo il false-kill
  MemFree — post-mortem `k4_n3_false_ram_kill.md`): decode mediano split
  2.02 vs CPU 2.90; TTFT 30.4 vs 17.8 s (il load raddoppia: re-upload dei
  dense a ogni cold start); prefill ~pari (9.5 vs 9.9 — il vantaggio
  dense-GPU visto sui densi 2B/4B NON trasferisce al MoE streamato: il
  prefill è dominato dal GEMM esperti su CPU); hit/MiB ~uguali. Gate
  pre-dichiarato FAIL → N4 skip automatico. **Lane velocità split su A7X:
  CHIUSA per misura.** Asset bancati: stack correttezza GDN+split+pin
  router, residency kernel nel parent, flag prodotto `--moe-cpu-experts`,
  e il primato documentato (mai pubblicato da nessuno: 35B MoE streamato
  con tronco GPU su telefono, output byte-identico). Riaperture plausibili:
  830+/subgroup veri, o fused-executor (mesi) — parcheggiate salvo bisogno
  prodotto. Nota metodo: 2 false-kill di guardie in 2 notti (waiter 15s,
  MemFree) — la regola nuova a verbale: le guardie RAM leggono
  MemAvailable, mai MemFree sotto page-cache pressure.

- **2026-08-13 (alba) — 🌍 LA NOTTE DELLO SPLIT: il 35B streamato da flash
  gira con TRONCO SU GPU ed esperti su CPU su un telefono da 8 GB, hook
  vivo, output BYTE-IDENTICO al CPU (dopo il pin del router). Il primo
  sistema del genere che si conosca. Manca solo il verdetto velocità
  (N3/N4 armati sullo stacco).**

  Arco completo (workflow notturno di gualt + 3 task di completamento):
  1. **N0** (workflow gualt): il fork esprime già lo split SENZA patch a
     llama.cpp — esperti Q2/Q3 → `supports_op` false → CPU+hook; pin
     prodotto `--moe-cpu-experts` nel parent (@ 8958cdf). Build Android OK.
  2. **N1 PASS**: KEXP carica con 40 layer su GPU, esperti pinnati CPU,
     82 split, hook vivo — MA solo a **cache 1000 `--force-cache`**
     (ram-guard rifiuta 2000/1500; transiente MemFree 14-90 MiB in alloc
     OpenCL, poi 3-4 GiB dopo anon-drop). Costo regime: hit ~44% vs 80%.
  3. **N2 FAIL → N2b CONFIRMED → PASS col pin**: la divergenza testo era
     il ROUTER MoE su OpenCL (flip di selezione esperti su pareggi ~1e-6);
     `--override-tensor ffn_gate_inp.weight=CPU` → greedy **byte-identico**
     (sha match), hook 43.7 vs 44.0. I dense 2B/4B erano identici perché
     senza router. Patch prodotto 5 righe pronta, non applicata.
     Residuo onesto: l'hidden che entra nel router viene dal trunk GPU
     (softmax può muoversi di epsilon senza flippare il greedy).
  4. **N3/N4 armati** (waiter sullo stacco, batt ≥45%): burst ABBA con pin
     → se ≥1.10× decode o TTFT ≥1.5×, maratona sostenuta automatica.
  Nella stessa notte: curva prefill 750 completa (GPU 5.2×→7.6× che CRESCE
  con la lunghezza, 4B pp2048 86.2 vs 11.3), maratona 4B (CPU sostenuto
  vince 0.80×, legge confermata), Task B CalaQwen-flagship in corso su
  Xiaomi, MarcoKEXP gates + LFM2.5-KEXP pipeline sul PC, pulizia disco
  −82 GB. Report: `moe-k4-split.md` (in completamento con N3/N4).

- **2026-08-12 (notte fonda) — 🔒 750 CHIUSO: decode gate FAIL 0.44× (predizione
  recon CONFERMATA) — ma prefill GPU 5.77×: il dividendo GPU su A7X è il TTFT,
  ed è GRANDE.** (`moe-gdn-750.md` completo)

  Xiaomi 14 staccato, 100%: CPU tg 16.15 / GPU 7.07 (0.44×, muro A7X identico
  al 740); CPU pp 31.5 / **GPU pp 181.7 (5.77×!)** — sul 740 era 2.2×. Il 750
  ha muscolo GEMM ma non banda/dispatch per il decode. Correttezza già tutta
  PASS (incl. flat q6_K: il bug del 740 è del compiler E031.41). **Strategia
  GPU su A7X definitiva: decode morto su entrambe le gen (per misura), prefill
  vivo e grosso su entrambe → la leva prodotto è il TTFT (phase-scheduling /
  K4-split trunk-prefill su GPU)**. Nella stessa notte: maratona 2B (CPU vince
  sostenuto 10.2 vs 8.2, GPU piatta e fredda), maratona 4B in corso, pista G99
  LFM2.5 viva (14.4 a k=2, proiezione KEXP 15-20), Fase 2 requant Marco in
  corso (Grok#2), mandato K4-split notturno consegnato a gualt.

- **2026-08-12 (notte) — 🏆 FASE 1 MARCO: CHIUSA CON PASS PIENO — qualità
  3/3 full multi5 + speed entrambe le leve. Il transfer runtime della
  config di campagna su Marco è UFFICIALE: k/drop funzionano su qwen3moe
  senza requant.**

  | cella | ΔMacro bpb | peggior lingua | gate |
  |---|---|---|---|
  | A1 k8d065 | **+0.0040** | zh +0.008 | PASS |
  | A3 k6d050 | +0.0095 | zh +0.018 | PASS |
  | A2 k6d065 | +0.0182 | zh +0.033 | PASS |

  Letture: (1) il drop 0.65 a k=8 è quasi GRATIS in qualità — la penalità
  vera è del k ridotto, non del drop (coerente con l'audit "il drop non
  salta il matmul": toglie I/O, non calcolo); (2) zh è sempre la lingua
  più sensibile; (3) con lo speed gate di stamattina (A2 1.303×, −34.4%
  MiB/tok) il PROTOCOL dichiara il transfer SUFFICIENTE. Decisioni a
  gualt: cella prodotto (A2 misurata vs A3 conservativa) e GO Fase 2
  MarcoKEXP per il regime I/O (gap 4× MiB/tok e +44pt hit vs KEXP).
  Nota di processo: il run PC è sopravvissuto a uno shutdown notturno
  (resume idempotente) e ha macinato ~19 ore totali su 3 celle × 5 lingue.

- **2026-08-12 (sera) — 🧭 RECON 750: la speranza "sul 750 i subgroup ci
  sono" era FALSA — il 750 è A7X come il 740, broadcast=false anche lì.
  Il primo telefono con la feature è l'Adreno 830 (8 Elite). E LiteRT
  dimostra che si può vincere sul 750 SENZA subgroups: la via è il port
  delle tecniche ML Drift.** (`research-adreno750.md`, fonti primarie)

  1. **Il fatto che ribalta lo scoping**: driver telefonici Adreno 750
     (compiler E031.45.02.16) riportano `vector subgroup broadcast: false`
     — stessa lacuna del 740; flash-attn è declinata su TUTTA la A7X
     (SIGSEGV clBuildProgram, PR #26430); le ottimizzazioni K-quant 2026
     escludono esplicitamente A7X (regredisce, PR #26477). Primo driver
     col broadcast: 830/E031.47 (8 Elite, S25-class — device che NON
     abbiamo in lab).
  2. **Predizione per il nostro gate 750 (Q4_K_M, fork): LIKELY_FAIL** —
     740 misurato 0.56-0.74×; 750 = stessa arch + CPU più veloce; scaling
     generoso → 0.93-1.04×. Il test Xiaomi resta utile come conferma da
     10 min, ma non è più la speranza: è il controllo della predizione.
  3. **Il dato che tiene viva la GPU su A7X**: LiteRT (kernel
     subgroup-FREE) fa **1.43× a 3.8B PROPRIO sul 750** (Phi-4-mini S24U:
     GPU 10.39 vs CPU 7.28) e pareggia a 1.5B. Tradotto: sul silicio A7X
     si vince a 4B-class, ma solo con kernel stile ML Drift — che nel
     fork non esistono. **Il port delle tecniche (paper CC-BY + reference
     Apache) diventa L'UNICA via GPU per l'installed base 740+750**, non
     un'opzione tra due.
  4. **Primato confermato dalla ricerca**: nessun numero pubblicato di
     ibrido GDN corretto su GPU di telefono — il nostro E2E sul 740
     resta, a oggi, il primo conosciuto. (Vicini: Qualcomm su laptop
     X2-90; LiteRT 0.8B CPU-only; MLC su S24U senza numeri e throttled.)
  5. Nota 830: coi subgroups veri e LiteRT Qwen3-4B a 19 t/s su S25+,
     l'8 Elite è il primo TOSS_UP onesto per il path llama.cpp — ma
     richiede hardware che non possediamo (opzione da valutare: device
     830 fisico o remote lab).

- **2026-08-12 (pomeriggio) — 🔧 IL POMERIGGIO DEL FIX: K2.1 → K2.2 →
  review ostile → K2.2b → probe build CPU. Primo E2E ibrido GDN CORRETTO
  su GPU mobile (che si sappia); il 740 perde comunque il decode; e il
  probe CPU trova un tradeoff che tocca l'app Kalsa.**

  1. **K2.1** (`moe-gdn-k21-parity.md`): il garbage GPU non era GDN — era
     il kernel flat Q6_K (NMSE ~12 sul 740) che si rubava l'lm_head tied
     via redirect large-M. Bisezione ngl + isolamento `-ot`: chirurgico.
  2. **K2.2** (`moe-gdn-k22-fix.md`, branch `kalsa/opencl-q6k-dispatch-fix`):
     redirect spento quando noshuffle è legale → greedy GPU token-identico
     al CPU. **Primo numero onesto 740: tg GPU 0.41× → poi 0.56× col build
     CPU giusto. Lane decode-740 chiusa per misura.** Prefill GPU 1.29×.
  3. **Review ostile DeepSeek** (`results/gdn_gpu_k22/review_hostile.md`):
     fix corretto, zero blocker; 3 chiusure → **K2.2b @ 04c5d362a**: path
     n≥32 validato (case n=64 + greedy 62-token identico), commento falso
     corretto, twin Q4_K sistemato. Diagnostica: flat Q4_K NON rotto sul
     740 (solo Q6_K). GDN family sempre zero FAIL.
  4. **Probe build CPU** (`moe-cpu-build-gap.md`): il −46% del nostro build
     era **GGML_CPU_REPACK=ON** (pp ×2 MA tg −33% su questo device) +
     binario non-strippato (-g, 125 MB → tg −16%). Fix: REPACK=OFF + strip
     → tg 18.19 ≈ build-safe. ⚠ **ACTION ITEM prodotto: verificare i flag
     di build di llama.rn nell'app — se ha repack ON, il prodotto perde
     ~33% di decode.** Il GPU è raddoppiato pure lui col build giusto
     (5.06→10.25).
  5. Nota storica: con K2.2 siamo (a quanto risulta) i primi con un ibrido
     Gated DeltaNet end-to-end corretto su GPU mobile — LiteRT è CPU-only
     sugli ibridi, upstream aveva i kernel ma l'E2E era rotto. Sul 740 è
     corretto-ma-lento; il verdetto velocità vero è del 750 (Xiaomi,
     attesa gualt). In volo: recon riusabilità kernel Google (ML Drift).

- **2026-08-12 — ⚗️ K2 E2E: il kernel GDN è CORRETTO perfino sul 740 —
  a rompersi è tutto il resto. S23 = FAIL_CORRECTNESS (flash-attn non
  compila sul driver senza subgroup; -fa off degenerato e 0.27×);
  MUL_MAT_ID Q4_K con 73 FAIL numerici = kernel MoE Adreno del pin
  ROTTO. Xiaomi 750 non in LAN: il verdetto sulla famiglia target è
  rinviato a un'accensione fisica.**

  Report `moe-gdn-k2-e2e.md`, artefatti `results/gdn_gpu_k2/` (build
  manifest con sha, log test per op, bench JSON, battery notes; binari
  Android fuori da git). Fatti chiave: (1) build fork Android OpenCL
  riproducibile (NDK r27b, -j4, zero modifiche sorgente); (2)
  `GATED_DELTA_NET` 36/36 PASS su 740 incl. head 128 — il cuore ibrido
  su GPU È GIUSTO anche dove il driver è peggiore; (3) il muro 740 è
  flash-attn (`sub_group_shuffle_xor` assente) + una parità E2E rotta
  nel path -fa off; (4) `MUL_MAT_ID` Q4_K numericamente sbagliato →
  la regola "esperti 35B su CPU" ora ha DUE ragioni (hook streaming +
  correttezza kernel); (5) Xiaomi assente dal mdns → K2-bis su 750
  quando gualt lo accende. Disciplina: unplugged 90→80%, mai >36°C.

- **2026-08-12 — 🏁 SPEED GATE MARCO FASE 1: PASS SU ENTRAMBE LE LEVE
  (S23, staccato, cold fadvise, ABBA 2 prompt, 16 run; batt 100→92,
  temp max 39.1°C; niente SESSION_SLOW — l'anomalia 3-4× della
  fix-session NON si è ripresentata).**

  | cella | decode med | MiB/tok | hit% | TTFT |
  |---|---|---|---|---|
  | A0 (k8, no drop) | 4.122 | 192.5 | 33.5 | 13.6 |
  | **A2 (k6d065)** | **5.371** | **126.2** | 36.7 | 12.6 |
  | KEXP k6d065 (stessa sessione) | 5.696 | **30.7** | **80.7** | 19.0 |

  Gate pre-dichiarati: decode **1.303×** (≥1.15 PASS) e MiB/tok **−34.4%**
  (≤−20% PASS). Hit solo +3.2 pt: la config di campagna trasferisce su
  Marco come velocità, NON come regime di cache — gli esperti Q4_K di
  Marco (~3× i byte dei Q2/Q3 KEXP) non ci stanno in cache 2000. Il
  confronto stesso-device quantifica il premio della Fase 2 MarcoKEXP:
  4× MiB/tok e +44 pt hit di distanza. Bonus: KEXP 5.70 ≈ scheda 5.86 →
  sessione sana. Con la qualità full multi5 in arrivo dal PC, Fase 1 è
  a un passo dalla chiusura completa. Artefatti:
  `results/marco_phase1/speed_s23/` (CSV 16 righe, note, log per run).

- **2026-08-12 — 🎁 K0 CONSEGNA UN RIBALTONE: i kernel GDN che volevamo
  scrivere ESISTONO GIÀ nel nostro pin. Il cantiere passa da "scrivere
  kernel" a "verificare e integrare". E S_v=128 su tutti e tre i modelli:
  il gate GPU è già aperto.**

  Report: `moe-gdn-k0-op-inventory.md` (DeepSeek sul checkout
  `BigMoeOnEdge/third_party/llama.cpp`, pin 5236140e5 + 3 commit fork;
  ogni claim con file:line). Nota di processo: prima run impiccata a 5 min
  (CLI hung, sessione preservata), recuperata con follow-up sulla stessa
  sessione via opencode-go — zero lavoro perso.

  1. **Upstream ci ha preceduto** (e il claim K2 del 3/8 era stale):
     `GGML_OP_GATED_DELTA_NET` (kernel `gated_delta_net.cl`, S_v gate
     {16,32,64,128}) e `SSM_CONV` sono NEL pin; e ci sono i kernel MoE
     Adreno `gemm/gemv_moe_q4_k/q5_k/q6_k` per `MUL_MAT_ID`. La lezione
     "verifica online prima di agire" colpisce ancora: 5 mesi di upstream
     hanno chiuso il gap che stavamo per scavare a mano.
  2. **Verifica GGUF (coordinatore, 2026-08-12)**: ssm.state_size=128,
     conv_kernel=4, dk/dv=256 su Qwen3.5-2B, 4B e KEXP 35B → G1 e G5
     VERDI. Gap veri residui: GET_ROWS su embedding quantizzato (CPU,
     piccolo) e le euristiche Adreno MoE (nomi tensori, ne01%32).
  3. **La LANDMINE Q7**: l'`expert-ready hook` dello streaming engine
     (commit fork 5236140e5) vive SOLO nel loop CPU di `mul_mat_id` —
     se il MoE andasse su GPU il prefetch/blocking dell'engine è bypassato.
     Design obbligato per il 35B: **esperti su CPU (hook intatto),
     GDN+attn+dense su GPU**; boundary per token = attivazioni FFN
     (~KB-scala) se il GDN resta su GPU, tens-of-MB se cadesse su CPU.
  4. **Dense 2B/4B: nessun MoE → grafo interamente GPU-abile OGGI** col
     backend del fork. K2 diventa: build OpenCL Android + E2E fail-fast
     su S23 (740, dove K5 va ri-testato coi kernel Adreno nuovi del pin)
     e Xiaomi 14 (750). Il gate resta ≥1.15× vs CPU, staccato.

- **2026-08-12 — 🔨 DECISIONE: CANTIERE GDN-GPU APERTO (mandato gualt).
  Niente downgrade a Qwen3 per il free tier ("generazioni indietro, e i 3.8
  sono in arrivo"): i kernel GDN/SSM OpenCL li scriviamo NOI nel fork.
  Ruoli dichiarati: Claude design, Grok codice.**

  Razionale: il muro GDN-su-GPU è cross-stack (recon #61) — quindi
  scriverli nel NOSTRO stack (llama.cpp fork) è l'unica via che tiene i
  pesi Qwen3.5 (e domani 3.8) su GPU, conserva i K-quants e un solo
  engine llama.rn, e sblocca free E CalaQwen insieme. La velocità dei
  free è dichiarata priorità di prodotto (funnel dei pro). Fasi K0-K4
  gated (v. riga Aperto): K0 inventario op dal sorgente (in volo),
  K1 design, K2 kernel+unit test, K3 E2E 2B su S23 gate ≥1.15×,
  K4 4B/750/CalaQwen. Regole ereditate: no-subgroup baseline per il 740
  (recipe adreno-llms, riduzioni in local memory), INT8 non INT4 (HAQA),
  la misura on-device decide ogni promozione di fase.

- **2026-08-12 — 🔎 RECON PORTING LITERT (Grok web, `research-litert-porting.md`):
  il blocco GPU del free tier ha un NOME, ed è lo stesso del 35B — Gated
  DeltaNet. E il "CPU-only" del nostro import 4B era un artefatto rotto,
  non un limite dello stack.**

  1. **Scoperta architetturale**: Qwen3.5-2B/4B NON sono "Qwen3 più addestrato"
     — sono **ibridi GDN + full-attention** (`Qwen3_5ForCausalLM`), stessa
     famiglia del nostro 35B. `export_hf` non li supporta; l'unico ibrido
     first-party (litert-community Qwen3.5-0.8B, litert-lm ≥0.15) è
     **CPU-only: la GPU fallisce la full delegation sugli op GDN**. È il K2
     di LiteRT: il muro GDN-su-GPU è TRASVERSALE agli stack (llama.cpp
     OpenCL E LiteRT). Corollario strategico: chi scrive i kernel GDN una
     volta sblocca free 3.5 dense E CalaQwen ibrido, ovunque.
  2. **Qwen3-4B (non ibrido) è GPU-capable OGGI**: bundle ufficiale
     `mixed_int4` con numeri OpenCL pubblicati (S25-class decode 19.1;
     **Mali G615 10.9** — LiteRT copre anche MediaTek, cosa che il kernel
     nostro Adreno-only non farà mai). Il nostro import "CPU-only" del twin
     era quindi un file rotto/mismatch di runtime (cause tabulari nel
     report; issue #1136: DIY export 16% delegato vs 100% ufficiale).
  3. **Bivio prodotto dichiarato** (decisione gualt): (1) free tier su
     **Qwen3-4B litert** → GPU subito, spike 1 giorno zero-conversioni
     (re-download ufficiale sha-verified, Gallery + litert-lm CLI su S23,
     misura vs CPU 8.38) + quality gate vs 3.5; (2) restare Qwen3.5 →
     llama.rn CPU finché non esistono kernel GDN. RN: LiteRT-LM Kotlin
     stable, wrapper community, MediaPipe legacy; 1-3 settimane + hardening.
  4. Logistica conversioni (se mai servisse la via B): Linux ≥64 GB RAM,
     litert-lm-builder per bundle completi (spiega il nostro storico
     `TF_LITE_PREFILL_DECODE not found` = pack incompleto); qualità: nessun
     bake-off pubblico int4/int8 litert vs K-quants → serve gate nostro.

- **2026-08-12 — 🧱 TWIN CLASSI PRODOTTO (Grok su S23, unplugged, batt 57→53):
  la via zero-fork per il numero GPU 2B/4B è ESAURITA — Gallery non può
  darlo. Twin CPU misurati e curva completata.**

  1. **2B-GPU BLOCKED**: non esiste bundle `.litertlm` ufficiale ~2B Qwen
     (litert-community ha 0.5/0.6/1.5/4B); l'import non ufficiale resta
     rigettato (LTLM magic). Niente rabbit-hole conversioni, da mandato.
  2. **4B-GPU NO GPU OPTION**: `qwen3_4b_mixed_int4.litertlm` (2.7 GB,
     importato) espone SOLO CPU come accelerator in Gallery 1.0.18 — il
     chip GPU proprio non appare. Wall Gallery CPU 5.3-5.7 tok/s; nota a
     margine: llama-bench CPU fa 8.38 → **llama.cpp CPU batte LiteRT CPU
     sul 4B**.
  3. **Twin CPU (llama-bench `-t 4`, tg256, sha verificati)**: Qwen3.5-2B
     Q4_K_M **18.10** (pp128 44.13); Qwen3.5-4B Q4_K_M **8.38** (pp128
     16.91). Curva CPU per taglia: 1.5B 25.8 → 2B 18.1 → 3B-class 9.7 →
     4B 8.38. Conferma dove il CPU crolla: esattamente sulla classe del
     modello prodotto Kalsa.
  4. **Lettura di gate**: il criterio pre-dichiarato (GPU ≥1.15× same-class)
     non è verificabile né falsificabile coi bundle DI CATALOGO. L'evidenza
     pro resta per proxy (Gemma E2B 2.76×; ML Drift 26.8 su Llama-3B vs
     nostro CPU 8.38 sul 4B ≈ 2-3× potenziale). **[CORREZIONE stessa
     giornata, stop di gualt]**: la prima stesura diceva "via zero-fork
     esaurita" — FALSO: resta il **porting in proprio** (conversione
     ai-edge-torch di Qwen3.5-2B/4B + bundling litert-lm GPU-enabled), che
     dà il numero mancante senza scrivere kernel. Direttiva prodotto
     dichiarata: i free (2B/4B) DEVONO essere veloci — sono il funnel dei
     pro. Recon feasibility affidata a Grok (web); F3-fork resta la pista
     alternativa se il porting non è percorribile.
  Artefatti: `results/litert_product/` (bench JSON, dump a11y, battery
  notes), report `moe-litert-product-classes.md`. Disciplina rispettata:
  sempre staccato, mai <30% batt, mai ≥45°C.

