Two documents only (owner, 2026-09-09): this plan and docs/ALIVE.md. Everything older is under archived/.

# Kalsa — PLAN (long-term)

> Provenance: this file began on 2026-08-03 as the operating brief "Beyond Memory Capacity" (MoE 35B from flash on a
> Galaxy S23 8 GB, orchestrator Claude, code/analysis Grok, hands on the phone gualt). The goal below is the owner's
> current one; the dated decisions table and the practical plan under "Piano" are what is in force. Diary: ALIVE §10.

## Il goal (owner, ripetuto 4/09)
Kernel che usa NPU, GPU e CPU **per fase** a seconda di temperatura, batteria e
profilo, ottimizzato su Snapdragon (MediaTek/Jelly se possibile). Il pezzo
mancante non è il motore: è che **l'app non lo usa**. Digest completo di ciò
che è già misurato/deciso/implementato: `docs/GOVERNOR-STATE-2026-09-04.md`
(116 righe, citazioni file:riga verificate dall'orchestratore).

## Dove siamo

**10/09: G1 chiuso, modello principale LFM2.5-2.6B.** Da qui in poi il piano è la fase "un modello completo" (§3 sessione/cache, §7 suite, §8 termica/memoria/UI, §13 protocollo M1 9/10), anticipata di 5 giorni.
- The practical pivot is now one complete model first, with the current dates and gates in ALIVE §9 and §10.
- G1 closed on 10 September with LFM2.5-2.6B as the main model; MiniCPM5 remains a post-M1 option, not a promoted alternative.
- M1 remains planned for 9 October; the proposal timeline is retained under Piano.
- The app-side work on restore, documents, sharing, and model-independent harness behavior continues in parallel (ALIVE §9).
- The S23 battery reproduction is **PARTIAL**, not a paired model comparison: 9/09 used MiniCPM5 Q4_K_M, while 10/09 used shipped LFM. Five attempts were instrumented; C02's final retry false-settled and only C03-C06 have valid answers. Memory extraction was disabled (`memoryEnabled:0`) in all five turns.
- The lifecycle Kotlin sources omitted from 3ca6145 were restored by 1e02fe3. APK CI e89bd2a, run 34483949398, SHA-256 `a2d08f9df19d179d86d55db1e0407bd4ec77ec9e6d2edb0954083487c27ea5fb`, was installed on the Jelly with an identical installed hash. The native/long lifecycle gate is **PASS**: HOME at 10:34:18.945 saved, unload at 10:35:04.621 (~45.7 s), reopen fit reported `no_active_model` with `availableMb=5789`, load restored 3628 tokens in 62 ms, and continuation prefill was 1489.054 ms. The brief check is **PASS with limits** because shell HOME/reopen markers are missing; this is not blanket lifecycle PASS.
- Separately, the 095466e session/memory verification is **PASS scoped** on the Jelly: APK CI run 34494832409, SHA-256 `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a`, was installed with an identical hash; `assets/app.config` carries `engineBuildId` `kalsa-eng-v1:source:765509c2…3a65`, meta v2 is identical, restore loaded 4517 tokens with prewarm skipped, extraction produced facts 1/1 and 2/2, and the next send produced `aborted_by_send` after 8688 ms with facts 0 and restore 5022. Stop abort plus partial preservation is **PASS scoped** on that same installed APK (evidence `STOP-PARTIAL-JELLY-EVIDENCE-2026-09-10.md`): after visible text a Stop tap left assistant `a-8080264` at 285 chars with `interrupted:true`, UI marker `Generazione interrotta.`, and `extractStopReason:4`; the partial is English chain-of-thought rather than the Italian answer. Edit→Salva is **PASS scoped** (`EDIT-SAVE-JELLY-EVIDENCE-2026-09-10.md`): Salva on the prefilled draft (no typing) re-sent with `edited:true`, session save `messageCount:2`, assistant completed `ciao`. Regenera UI (`c370c98`) and model-switch bounded dispose (`1807aad`) are **PASS scoped** on Jelly APK CI `34539915778` (SHA-256 `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693`, installed hash identical): Rigenera `regen:true` with user `edited` absent and assistant `ciao`; Qwen select after LFM unload in 2 s, header not stuck on checking. MiniCPM5 not used. The same `1807aad` APK is on S23 (`lastUpdateTime` 20:01:55, hash match); `memoryEnabled` restored to 1 after the battery repro. Extract-cancel (`f99fe45`, ancestor of `1807aad`) is **PASS scoped** on S23 APK `34539915778` / `1807aad` (SHA-256 `9c03c710…3693`, hash match, no reinstall): Nuova chat during extract → `stopReason:"aborted_by_send"`, native `util-extractMemory-2` `interrupted:true` (`S23-EXTRACT-CANCEL-1807aad-2026-09-10.md`). Copy sheet on Jelly APK CI `34544351697` / `c906727` (SHA-256 `1a47fff2c5f75dd2c8929cb75ec3e06b9d68f0124642987167c54c13154f4298`, installed hash identical, `lastUpdateTime` 20:32:37) is **PASS scoped**: Altro listed Copia (`COPY-SHEET-JELLY-EVIDENCE-2026-09-10.md`). Decode-EMA withhold on the same Jelly install is **PASS scoped**: first send after force-stop `KALSA_THINKING budget:512 decodeTokPerSec:null` even though that turn decoded at 6.48 tok/s (`EMA-WITHHOLD-JELLY-EVIDENCE-2026-09-11.md`). The engine-change invalidation remains build-time/logic evidence, not a second-APK device proof.
- The exact app fix is commit `095466ec5c88a8cf4588b898b00cce632b1c1508` on app `main`, pushed; experiments commit `76ac60e1` is pushed; CI APK run 34494832409 and E2E emulator run 34494789017 are both **SUCCESS** on that head. The independent identity calculation matches the embedded APK value exactly. The outer turn signal now forwards to the inner extraction abort in app commit `f99fe4506a3072c6d18b625bdaca815615bf7421`, pushed on app `origin/main`: clearChat, conversation switch, background discard, and unmount cancel completion; new-send behavior is unchanged, and handleStop does not overlap extraction. MiMo's re-audit is **SHIP** by code review with 12/12 targeted tests, tsc clean, and coder-reported full Jest 644/644. Automatic E2E run `34526920272` was **cancelled** (not a pass). Extract-cancel is **PASS scoped** on S23 (`1807aad` APK): Nuova chat and HOME/background-discard both `aborted_by_send` with native extract interrupted. Conversation-switch during extract is **unproven** (Jelly harness never changed `activeId`). Model-switch after the 3-second bounded stop/discard is **PASS scoped** on the same Jelly APK (`MODEL-SWITCH-JELLY-EVIDENCE-2026-09-10.md`): LFM→Qwen in 2 s, not frozen on checking. Hung-FIFO timeout copy was not forced. These scoped results do not declare blanket G2 PASS.
- Jelly document chat is functionally 7/7 but remains slow; its measured timings are the baseline for G1 targets (ALIVE §9).
- The shipped catalog and quantization choices remain evidence-bound; MiniCPM5 imatrix variants are measured but not silently promoted (ALIVE §9).
- The governor and corrected Adreno prefill path are measured, but each generation/model path still requires its own correctness evidence (ALIVE §9; diary 7/09).
- NPU, GPU, thermal, memory, session, and tool-loop work remains gated by measured correctness and product behavior (ALIVE §6, §9, and §10).
- Open work is listed at the end of this plan with its numerical evidence pointer in ALIVE §9 or the dated ALIVE diary.

## Decisioni prese

| Date | Decision | Evidence pointer |
|---|---|---|
| 2026-08-12 | Open the GDN-on-GPU workstream under gualt’s mandate. | ALIVE §10, entry dated 2026-08-12 “DECISIONE: CANTIERE GDN-GPU APERTO” |
| 2026-08-13 | Use the project CPU-kernel path for the selected product lane and keep the free tier in the 2B class. | ALIVE §10, entry dated 2026-08-13 “LA DECISIONE” |
| 2026-08-22 | Park the Mali G57 lane; reopen it only with a G610/G615-class device. | ALIVE §10, entry dated 2026-08-22; ALIVE §6 item 10 |
| 2026-08-24 | Keep MoE experts-on-NPU as a v75-class lane; do not certify the v73 menu without a correctness result. | ALIVE §10, entry dated 2026-08-24; ALIVE §6 item 13 |
| 2026-09-03 | The owner delegated the remaining work (“fai tutto”); physical S23 and Jelly access was unavailable for the stated period, so work ran through QDC/CI/Mac. | ALIVE §10, entry dated 3/09 notte |
| 2026-09-03 | Close the merge-pick decision on the fork and prepare APK-A/APK-B for comparison. | ALIVE §10, entries dated 3/09 21:45–23:20 |
| 2026-09-04 | Approve the decisions, especially the debuggable APK path (“approvo tutte le decisioni, soprattutto apk debug”). | ALIVE §10, entry dated 4/09 09:40 |
| 2026-09-04 | Do not open an upstream issue; fix in the fork or abandon the lane (“Non aprire nessuna issue upstream. O fixiamo noi stessi o lasciamo perdere”). | ALIVE §10, entry dated 4/09 11:00; Vincoli |
| 2026-09-04 | Pivot the product effort to the governor-in-app phase, with the phase-1 plan approved. | ALIVE §10, entries dated 4/09 14:30 and 4/09 15:20 |
| 2026-09-05 | Keep the 8635/8550 in-app B path off and keep the 750 allowlist off pending evidence. | ALIVE §10, entry dated 5/09 21:15; ALIVE §9 |
| 2026-09-06 | Execute the three requested tracks in order (“Devi fare tutti e tre :) In ordine se pensi sia difficile”). | ALIVE §10, entry dated 6/09 |
| 2026-09-06 | Allow the logit oracle only with safeguards against promoting an incorrect path (“purché non facciamo passare una cosa sbagliata”). | ALIVE §10, entry dated 6/09 07:55 |
| 2026-09-07 | Move to the governor-in-app phase with the corrected kernel; remaining kernel questions are not on the product critical path. | ALIVE §10, entry dated 7/09 sera |
| 2026-09-07 | Turn on V75 GPU prefill from the measured effect size, while recording the remaining scope limits under R6. | ALIVE §10, entry dated 7/09 sera 20:10; ALIVE §9 |
| 2026-09-08/09 | Make the practical plan the current plan: qualify one main model first, then the second dense model and large MoE work. | PLAN §Piano, “Proposta di ottimizzazione Kalsa: un modello completo, poi gli altri” |
| 2026-09-09 | Continue model-independent app work while G1 is pending (“aspettare il confronto serve a decidere il modello, ma l'app in sé no”). | ALIVE §10, entry dated 9/09 ~07:30 |
| 2026-09-09 | Work on the main branch only (“si mergia tutto, si lavora solo su main”). | ALIVE §10, entry dated 9/09 notte |
| 2026-09-09 | Use the coder-bench route while the other work waits (“usa coder bench (deepseek) intanto, se no aspetti”). | ALIVE §10, entry dated 9/09 notte |
| 2026-09-09 | Treat a clean install as CPU-only until the governor is explicitly enabled; presence, enablement, execution, and benefit remain separate. | ALIVE §10, entry dated 9/09 notte; PLAN §Piano, proposal §14 |
| 2026-09-09 | Choose the main model at G1 on 15 September; complete and bank it at M1 on 9 October, with the proposal’s gates and margins. **Superseded on 2026-09-10:** G1 is closed and LFM2.5-2.6B is the main model; M1 remains 9 October. | PLAN §Piano, proposal §§12–13 |
| 2026-09-09 | Treat thinking budgets as model-specific evidence rather than inheriting 256/512 from the old Qwen setup. | ALIVE §10, entry dated 9/09 ~16:00 |
| 2026-09-09 | Quantize locally and consider fine-tuning only after G1 and only if MiniCPM5 wins (“il quant giusto possiamo farlo noi, e magari dopo un fine tune sui casi dove sbaglia / tool call (Apache 2.0, possiamo farlo nostro)”). | ALIVE §10, entry dated 9/09 ~11:55 |
| 2026-09-23 | Gate G2: complete chat on the CPU path, with relevant governor tests and uncorrupted recovery. | PLAN §Piano, proposal §12 timeline |
| 2026-09-29 | Gate G3: every phone has at least one correct path, and every enabled path passes its tests. | PLAN §Piano, proposal §12 timeline |
| 2026-10-02 | Gate G4: sustained quality/performance and documented consumption or measurement limits. | PLAN §Piano, proposal §12 timeline |
| 2026-10-30 | M2: bank the second dense model only on validated devices and do not force promotion without useful benefit. | PLAN §Piano, proposal §12 “Dopo M1” |
| 2026-11-20 | M3: bank the first large MoE within the declared perimeter; do not promise every MoE or phone automatically. | PLAN §Piano, proposal §12 “Dopo M1” |
| 10/09 | Budget di thinking per modello e per velocità misurata: LFM 1024 dove il decode ≥ 5 tok/s (S23, Xiaomi), 512 sotto (Jelly); prima misura 512. Sostituisce i 256/512 ereditati da Qwen (v2e: 1024 > 256 per LFM, due giudici) | owner |
| 10/09 | **G1 chiuso: il modello principale è LFM2.5-2.6B (Q4_0 QAD).** Evidenza: Mac v2b/v2c/v2d (LFM avanti con due giudici; budget e quant di MiniCPM5 smentiti come cause), Jelly 24×2 (LFM 19/2/1 vs 16/5/1, tool 2/2 vs 0/2, decode 3,4 vs 2,3 tok/s), S23 LFM 24 ok vs MiniCPM5 con timeout e thrash di memoria, Xiaomi LFM 24/24. Chiuso 5 giorni prima della data (15/09) su richiesta di ritmo. MiniCPM5: braccio Xiaomi annullato, S23 fermato; fine tuning (Apache 2.0) resta opzione post-M1 | owner |

## Piano

### Proposta di ottimizzazione Kalsa: un modello completo, poi gli altri

Prima stesura: 8 settembre 2026. **Revisione 2: 9 settembre 2026.** Documento di proposta separato dai piani operativi esistenti; calendario di lavoro proposto dal 9 settembre.

Obiettivo dell'owner: ottenere un'app molto ottimizzata per pochi modelli — due densi e i grandi MoE — e far funzionare i chatbot benissimo nell'uso reale.

Questo documento raccoglie le raccomandazioni discusse in conversazione e le integra con la lettura delle memorie Claude del progetto. Le attività descritte sono proposte, non implementazioni completate né nuovi risultati sperimentali.

**Decisione di impostazione:** qualificare brevemente LFM2.5-2.6B contro MiniCPM5-2B, scegliere un solo modello principale e completarne l'esperienza sui tre telefoni reali. Secondo denso e grandi MoE seguono quel traguardo. Le sezioni tecniche su Qwen e MoE restano nel documento come lavoro successivo, senza competere con la prima consegna.

**Date obiettivo:** scelta del modello il **15 settembre**; primo modello completo e bancato il **9 ottobre**, con margine fino al **16 ottobre**; secondo denso entro il **30 ottobre**; primo grande MoE entro il **20 novembre**, con margine fino al **27 novembre**. Sono stime di pianificazione subordinate ai gate della sezione 12, non risultati garantiti o date di pubblicazione.

#### 1. La modifica principale al piano

Il criterio di successo deve diventare **una conversazione intera che funziona bene, dalla prima apertura alla ripresa del giorno dopo**. I kernel contribuiscono al risultato insieme a caricamento, cache, prompt, strumenti, memoria, termica e interfaccia.

La campagna ha già prodotto molti risultati utili sul motore. Il passo successivo è trasformarli in percorsi completi nell'APK: primo messaggio, turni successivi, conversazione lunga, interruzione, riapertura e cambio modello. Una riduzione del tempo di prefill non basta se alla riapertura si ricalcola tutta la conversazione o se un lavoro accessorio impedisce di inviare il messaggio successivo.

L'ordine proposto è:

1. Baseline ripetibile e confronto circoscritto **LFM contro MiniCPM5**, prima di specializzare altro codice.
2. Congelamento di un solo modello principale, con artefatti, template, strumenti e budget di thinking espliciti.
3. Continuità della chat e qualità completa nell'APK: sessioni, cache, strumenti, memoria, documenti e voce tramite i componenti accessori.
4. Ottimizzazione di quel modello per S23, Jelly Star e Xiaomi 14; CPU/GPU/NPU scelti solo fra percorsi corretti e misurati.
5. Campagna finale su uso prolungato, batteria, inattività e compatibilità; dossier riproducibile di completamento.
6. Secondo denso, poi un grande MoE per volta, riutilizzando infrastruttura e protocolli.

“Un modello che fa tutto” significa **un solo LLM conversazionale principale che orchestra l'esperienza**. LFM2.5-2.6B e MiniCPM5-2B sono testuali: ASR, TTS, embedding e OCR/estrazione documentale possono restare componenti accessori. La comprensione nativa delle immagini richiede un modello/bundle appropriato e viene validata nella fase successiva; un PDF con testo e una fotografia non sono la stessa capacità.

“Chiuso” significa completato sul perimetro dichiarato, non ottimizzato su ogni acceleratore di ogni telefono. Il governor rimane l'obiettivo, ma NPU e GPU non sono obbligatorie dove non portano un beneficio. LFM prepara sessioni, strumenti, UI e misure riusabili; non certifica automaticamente architetture, kernel o streaming degli esperti di altri modelli.

#### 2. Stato di riferimento e vincoli

Le osservazioni sul codice prodotto si riferiscono al repo `kalsa`, ramo `feat/governor-ux`, commit `523f5e333af310ead2a786b60a2af46d4009a8a2`. Il checkout nel quale viene scritto questo documento è invece `feat/moe-stream@9d3db10`. Il riferimento sperimentale della prima stesura era `kalsa-moe-experiments@d6394385ea71f91bd3f97401e39d6df7fce2953a`. Per la revisione 2 sono state rilette le celle ALIVE #60–61, inclusa la correzione dell'inventario dei quant, nel checkout con HEAD `2e7c0392526607dff4a33633c97751b010a236dc` il 9 settembre.

Quattro repo, quattro responsabilità:

| Repo | Responsabilità |
|---|---|
| `kalsa` | App, interfaccia, catalogo, ciclo di vita e bridge nativo |
| `kalsa-forkbigmoeonedge` | Wrapper e ricette di streaming degli esperti |
| `kalsallama` | Fork llama.cpp: kernel, governor e gestione dello stato |
| `kalsa-moe-experiments` | Protocolli, misure, risultati, PLAN e ALIVE |

Le memorie Claude chiariscono vincoli da conservare:

- **Un solo motore e una sola linea di sorgenti.** Le differenze fra dispositivi si risolvono a runtime, senza rami del motore per singolo telefono.
- **Il goal è un governor dinamico per fase**, con modello, capacità hardware, memoria, temperatura e batteria fra gli input. Una tabella statica di backend è solo una parte del sistema.
- **Thinking sempre attivo.** Si può valutare il budget, mantenendo qualità e configurazione del prodotto; spegnere il reasoning non è una scorciatoia consentita per migliorare i tempi.
- **Il prodotto è ancora in sviluppo.** Le memorie escludono una base installata da proteggere: il comportamento attuale non diventa corretto soltanto perché esiste. In questo documento “prodotto” indica il percorso destinato all'app, non una distribuzione pubblica già avvenuta.
- Modello e quantizzazione devono adattarsi al dispositivo. La raccomandazione per fascia e il modello scelto dall'utente sono concetti distinti; non va introdotto un cambio silenzioso durante la conversazione.
- Tool calling funzionante è un requisito di selezione dei modelli.
- Le soglie degli oracoli non si allentano dopo aver visto i dati. Il risultato numerico e una decisione esplicita dell'owner restano registrati separatamente.
- Le modifiche native nascono nel fork o nel wrapper proprietario del codice, poi arrivano nell'app tramite pin e sincronizzazione. Le copie generate non vanno corrette a mano.
- APK dalla CI, provenienza verificabile e misure nella configurazione effettiva dell'app.

Le vecchie memorie sulla selezione esclusiva di LFM e sulla rimozione degli 8B documentano decisioni storiche. Il mandato corrente conserva due modelli compatti e grandi MoE come destinazione, **con un solo modello principale nella prima fase**. La selezione iniziale di LFM è una baseline, non un vincolo che impedisce di scegliere MiniCPM5. Analogamente, la vecchia soglia di 20 tok/s per LFM 8B non va trasferita ai grandi MoE oltre RAM.

L'owner indica ora QDC Qualcomm, Samsung Remote Test Lab e tre telefoni fisici: **Galaxy S23, Jelly Star e Xiaomi 14**. Le note precedenti sull'indisponibilità del laboratorio non descrivono necessariamente lo stato attuale. La timeline assume accesso operativo ai tre telefoni entro il 14 settembre; il 9 settembre si verifica disponibilità, configurazione e quote. Questo aggiornamento del documento non ha prenotato dispositivi né verificato sessioni ADB o crediti live.

#### 3. Priorità uno: continuità della conversazione e cache

**Fatto verificato:** con governor attivo, `LlamaService.ts` disabilita il restore della sessione (`:1720`) e il salvataggio (`:2078`); anche gli snapshot ausiliari sono esclusi (`:3756`). Il piano governor S2 richiedeva già una soluzione per lo stato dei due contesti prima dell'attivazione in produzione.

Fonti: [LlamaService nel ramo prodotto](../../kalsa-wt-mergetest/src/engine/LlamaService.ts), [piano governor, S2](../../kalsa-moe-experiments/docs/PLAN-governor-in-app.md).

##### Intervento proposto

- Definire il contratto di persistenza del governor: stato dei contesti, stato ricorrente, checkpoint necessari, token, posizioni e metadati del routing. Valutare se salvare entrambi integralmente o ricostruire una parte da uno stato autorevole; la scelta deve preservare correttezza e tempi, senza assumere che duplicare ogni salvataggio sia gratuito.
- Legare il salvataggio all'identità esatta del modello, quantizzazione, motore, template e configurazione del contesto.
- Verificare riapertura, cambio conversazione, stop, modifica di un messaggio, rigenerazione e interruzione dell'app.
- Misurare i token realmente riutilizzati alla completion successiva. Un file caricato con successo non dimostra che il riuso sopravviva al rendering del prompt.
- Conservare un prefisso stabile quando semanticamente possibile. Cambi di memoria, strumenti e template devono avere un costo di invalidazione osservabile; la cache non giustifica mantenere istruzioni o fatti superati.
- Coordinare estrazione memoria, traduzione e altri lavori accessori affinché non distruggano lo stato della chat né occupino il motore quando l'utente invia il messaggio successivo.

Nel percorso letto, l'estrazione memoria cerca di isolarsi tramite snapshot e può essere saltata quando questo non è disponibile. Va quindi verificata anche l'interazione funzionale **governor + memoria**, oltre alla sola latenza.

I due modelli già nel catalogo, LFM e Qwen, sono non-MoE ma hanno componenti ibride/ricorrenti: “denso” non significa che basti trattarli come un Transformer con sola KV lineare. MiniCPM5 ha invece un'architettura Transformer standard: il contratto di sessione deve rispettare il modello scelto, senza obbligare tutti ai dettagli dello stato di LFM.

Esiste inoltre una [segnalazione upstream sul restore dei modelli ricorrenti](https://github.com/ggml-org/llama.cpp/issues/25913): il caricamento può apparire riuscito e il turno successivo perdere tutto il riuso per checkpoint mancanti. È un caso utile per progettare i test, non una diagnosi automaticamente applicabile al fork Kalsa.

**Criterio di completamento:** la chat riaperta conserva lo stato corretto e beneficia realmente del riuso; stop, modifica e strumenti non corrompono lo stato; le attività di memoria non spariscono silenziosamente né penalizzano il nuovo invio.

#### 4. Dopo il primo modello: grandi MoE dalla CLI alla chat

Questa fase parte dopo il completamento del primo modello e la successiva fase del secondo denso. Nel frattempo si conservano ricette ed evidenze già raccolte; non si apre una seconda campagna di implementazione MoE.

**Fatti verificati:** il catalogo prodotto contiene Qwen 3.5 4B e LFM2.5 2.6B. Esiste il bridge dello streamer, ma questo rifiuta ancora `n_expert_used != 0`. Avere lo streamer nel sorgente non dimostra quindi la parità con tutte le ricette misurate tramite CLI.

Fonti: [ModelRegistry](../../kalsa-wt-mergetest/src/engine/ModelRegistry.ts), [bridge MoE](../../kalsa-wt-mergetest/native/bmoe/rn/bmoe_stream.cpp).

Per CalaQwen, Marco e Mellum preparare una scheda per ogni artefatto candidato:

| Campo | Cosa fissare o misurare |
|---|---|
| Identità | Architettura, GGUF, revisione, hash, inventario dei tensori |
| Ricetta | Quantizzazione, esperti usati, eventuale dropping e rinormalizzazione |
| Esecuzione | Thread CPU, thread I/O, overlap e configurazione del caricamento |
| Memoria | Cache esperti, KV, stato fisso, buffer, picchi e margine per l'app |
| Contesto | Dimensione realmente allocata e regime validato |
| Qualità | Lingua, strumenti, vincoli, recall e qualità delle risposte |
| Risultato | CLI, APK, conversazione lunga, restore e plateau misurati separatamente |

Portare un grande MoE fino alla conversazione completa nell'APK, poi applicare lo stesso percorso agli altri. Non è sufficiente aggiungere tutte le voci al catalogo e validare soltanto il caricamento.

Prima del confronto, verificare che architettura e parametri della ricetta raggiungano davvero il bridge nativo. Le memorie storiche segnalano anche un possibile buco di registrazione per `mellum`: va ricontrollato sul pin scelto, non presentato come difetto attuale senza verifica.

##### Prefill e decode richiedono domande diverse

- **Decode oltre RAM:** cache degli esperti e traffico da flash hanno già evidenze utili. Misurare hit rate, byte letti, latenza delle letture, tempo di attesa e picchi di memoria; non massimizzare la cache alla cieca.
- **Prefill:** la cella CalaQwen del product streamer ha trovato una componente di calcolo dominante. Non chiudere questa fase dichiarando che qualunque lavoro su un MoE oltre RAM è limitato dalla flash. Prima parità CLI–app, poi eventuale accelerazione della parte misurata come dominante.
- **Expert dropping:** altera il calcolo e deve avere un budget di qualità. Il beneficio dipende anche dal regime della cache; non trasferire un successo o un fallimento a tutti i modelli.
- **Modelli che stanno in RAM:** non imporre loro lo streaming sulla base di risultati ottenuti quando il modello non entra in memoria.

Fonte: [ALIVE, celle #15 e #17](../../kalsa-moe-experiments/docs/ALIVE.md). KEXP è una ricetta di quantizzazione, non un modello; una misura resta legata all'artefatto e al regime in cui è stata ottenuta.

**Criterio di completamento:** stesso artefatto e stessa configurazione spiegano i risultati CLI e APK; il modello sostiene una chat lunga, strumenti, interruzione e ripresa senza collassi non spiegati.

#### 5. Governor per modello, fase e lavoro effettivo

**Fatto verificato:** l'ammissione usa ancora una tabella per generazione; il fit rifiuta globalmente RAM totale ≤8 GiB e KV non nota. Queste protezioni non vanno rimosse senza dati, ma non devono diventare il modello definitivo delle capacità del dispositivo.

Fonte: [governorInputs](../../kalsa-wt-mergetest/src/engine/governorInputs.ts).

Usare pochi profili misurati, con chiave:

`modello/quant + dispositivo/driver + versione motore + fase + contesto`

La policy resta dinamica: considera temperatura, batteria, pressione memoria e stato già residente. I profili sono evidenze e parametri della scelta, non build separate per telefono.

Per il prefill contare soprattutto **i token nuovi dopo il riuso della cache**, non la lunghezza totale della conversazione. La GPU è conveniente sul tempo se:

`risparmio di prefill > trasferimento dello stato + eventuale inizializzazione + margine d'incertezza`

Un turno con 20 token nuovi e uno con 2.000 possono avere una scelta diversa. Anche mantenere due contesti residenti ha un costo: va confrontato con la frequenza con cui l'acceleratore viene effettivamente usato.

CPU decode è un punto di partenza sostenuto da molte misure sui modelli attuali, non una legge per ogni modello e generazione. I confronti devono avere una CPU ben configurata: alcune vecchie celle del governor usavano un solo thread. Il [report 8B/830](../../kalsa-moe-experiments/scratchpad/agents/qdc-8elite-governor-8b/REPORT.md) esplicita questo limite.

La scelta deve anche ammettere un vantaggio termico misurato quando la velocità immediata è inferiore. “Telefono caldo → GPU” non è universale: fit, modello e beneficio termico devono permetterlo. L'half-offload tronco GPU/esperti CPU resta escluso dalle ricette oggetto delle misure che ne mostrano il costo di ping-pong.

**Criterio di completamento:** ogni decisione è osservabile e giustificata dal lavoro reale e dai vincoli; il routing viene confrontato con le alternative statiche valide sull'intera sessione.

#### 6. Dopo il primo modello: Qwen 4B e copertura dei kernel effettivi

Qwen resta il candidato già integrato per la fase del secondo denso e della visione. La sua promozione dipende da un vantaggio concreto per gli utenti rispetto al primo modello, non dalla sola presenza nel catalogo.

La prova con LFM Q4_K nascosto è un buon veicolo diagnostico. Non completa da sola il supporto di Qwen 4B.

**Fatti verificati:** Qwen non ha `kvBytesPerToken`; il governor viene inoltre escluso quando è presente `mmprojPath`. ALIVE #61 ha osservato la conseguenza sul dispositivo: il braccio che doveva usare la GPU ha eseguito CPU, anche con il force del benchmark.

Fonti: [ALIVE #61](../../kalsa-moe-experiments/docs/ALIVE.md), [piano della cella](../../kalsa-moe-experiments/scratchpad/agents/gemm-f32-ship/PLAN.md).

Lavoro proposto:

1. Misurare memoria come pesi + stato ricorrente fisso + KV dipendente dal contesto + workspace + eventuale proiettore e allocazioni driver. Evitare sia KV ignota conteggiata come gratuita sia somme che duplicano la stessa allocazione.
2. Separare la capacità vision dal percorso di una richiesta solo testuale. Non basta cancellare il gate: occorre verificare il contratto del bridge multimodale con il governor.
3. Valutare caricamento del proiettore quando serve, se il ciclo di vita nativo lo permette; misurare anche il costo della prima immagine.
4. Trattare encoding immagine, prefill testuale e decode come fasi distinte. Una fase vision su CPU non implica che tutto il resto debba restare CPU.
5. Validare infine il GGUF Qwen e il bundle effettivamente destinati all'app.

##### Inventario prima di dichiarare la copertura

`Q4_K_M` può mescolare tipi diversi. Il quantizzatore del fork contiene promozioni a Q6_K: l'etichetta del file non prova che venga eseguito un solo kernel Q4_K. Due modelli non implicano due soli kernel da certificare.

**Aggiornamento letto il 9 settembre:** la correzione dell'8 settembre in ALIVE #60 riporta l'inventario degli artefatti reali: Qwen Q4_K_M contiene Q4_K 149, Q6_K 35, Q5_K 24 e Q8_0 1; anche LFM QAD-Q4_0 contiene un tensore Q6_K oltre ai 166 Q4_0. Al pin `67c73d26c`, i kernel `gemm_noshuffle_q5_k/q6_k/q8_0` conservano il prodotto in half. Il rischio non è più soltanto dedotto dal quantizzatore. Restano da tracciare i dispatch effettivi e certificare i percorsi del modello e del profilo scelti.

Questa verifica appartiene già alla prima fase, anche se vince LFM: non si può dichiarare copertura completa soltanto perché è stato corretto il kernel che compare nel nome del GGUF. MiniCPM5 riceve lo stesso inventario prima dell'abilitazione GPU.

Fonte: `kalsallama/src/llama-quant.cpp`, logica `LLAMA_FTYPE_MOSTLY_Q4_K_M`; [file locale ispezionato](../../kalsallama/src/llama-quant.cpp).

**Criterio di completamento:** testo e vision del modello reale funzionano con il routing previsto; memoria e copertura numerica sono verificate sui percorsi eseguiti, non dedotte dal nome del GGUF.

#### 7. Una suite piccola che rappresenti una buona chat

I microbenchmark servono a localizzare i problemi. La promozione nell'app deve includere scenari di prodotto:

| Scenario | Domanda e misure |
|---|---|
| Apertura e prima domanda | Attesa totale, separando caricamento, preparazione del prompt e prefill |
| Chat già aperta | Tempo al primo testo utile e riuso effettivo della cache |
| 20–30 turni | Recall, rispetto dei vincoli, velocità sostenuta e pause lunghe |
| Chiusura e riapertura | Stato corretto e vantaggio reale del restore |
| Stop, modifica e rigenerazione | Latenza dei comandi, assenza di lavoro residuo e coerenza dello stato |
| Documento e strumenti | Qualità delle risposte, corretta chiamata dei tool e continuità della chat |
| Immagine | Tempo dell'encoding, memoria del bundle e routing delle fasi |
| Telefono caldo e sotto pressione | Adattamento sostenibile e nessun collasso non spiegato |
| Inattività | Lavori realmente fermi e consumo attribuito al processo corretto |

Registrare mediana e coda delle latenze, intervalli fra porzioni di testo, memoria di picco, tempi di commit e comportamento dopo il riscaldamento. Il p95 va stimato con abbastanza osservazioni: una o due coppie non lo caratterizzano in modo affidabile.

Distinguere **primo token del reasoning**, **primo testo utile visibile** e **risposta completata**. Il thinking resta attivo. La lunghezza generata va riportata: tok/s di turni con lunghezze diverse non bastano a decidere quale configurazione sia migliore.

Per qualità: conversazioni italiane e inglesi, risposta nella lingua richiesta, vincoli verificabili, richiamo di fatti lontani, uso corretto degli strumenti, risposte fondate sui documenti e gestione degli errori. Usare prompt, template, strumenti e sampler del prodotto; ogni scostamento sperimentale deve essere dichiarato.

Tre livelli di evidenza rimangono distinti:

1. Correttezza del kernel e fedeltà numerica rispetto al riferimento.
2. Qualità della configurazione del modello, compresi quantizzazione, dropping e budget di reasoning.
3. Esperienza end-to-end nell'APK.

Un esito positivo a un livello non certifica gli altri. Il FAIL grezzo dell'oracolo V75 resta tale; la decisione dell'owner sull'effect size è registrata separatamente e non riscrive il protocollo.

##### Regole per spendere bene il tempo di misura

- Prima di prenotare una cella verificare che modello, bundle e condizioni di ammissione rendano raggiungibile il percorso desiderato.
- Separare installazione/bootstrap dalle misure di turno; misurare anche il bootstrap, ma senza ripeterlo inutilmente in ogni osservazione quando il protocollo non lo richiede.
- Confronti appaiati/interleavati, regime termico dichiarato e CPU di riferimento configurata correttamente.
- Plateau su almeno quattro turni per le caratterizzazioni brevi; campagne più lunghe per il prodotto. Un cambio modello può contaminare i turni successivi con lo stato della memoria.
- Controllare backend realmente eseguito, token nuovi, cpuset del processo e provenienza di APK, motore e modello.
- Conservare dati e verdetti delle righe escluse. Non allentare soglie dopo aver visto i risultati.
- Contare major faults insieme a residenza, swap e latenza: un fault anonimo e una rilettura da flash non hanno lo stesso costo.

#### 8. Termica, memoria, interfaccia e lavori accessori

Proposta: un coordinatore delle risorse che dia priorità al messaggio dell'utente e governi anche le attività di contorno. Estrazione memoria, embedding, download e prewarm devono poter aspettare; non devono competere liberamente con inferenza e rendering.

La gestione deve coprire il turno in corso, non soltanto l'istante prima di iniziarlo: aggiornamento dei segnali, transizioni con isteresi, riduzione del lavoro e gestione dello stato in caso di interruzione. Temperatura batteria, skin, sensori interni, stato termico OS e pressione RAM sono segnali diversi.

##### Segnali Android da valutare

Integrare thermal status e **thermal headroom**, mantenendo BatteryManager per i dati della batteria. Android documenta segnali predittivi per ridurre il carico prima del throttling, ma supporto e affidabilità vanno verificati per dispositivo; il polling dell'headroom non deve essere troppo frequente. Fonte: [Thermal API](https://developer.android.com/games/optimize/adpf/thermal).

Dopo una baseline, fare un esperimento limitato con **Performance Hint API** sui gruppi di thread nativi: durata attesa del lavoro e durata realmente osservata vengono comunicate al sistema. È un candidato da misurare su fluidità e consumo, non un guadagno garantito. Fonte: [Performance Hint API](https://source.android.com/docs/core/perf/performance-hint-api).

##### Memoria e interfaccia

- Calibrare picchi e margini per i pochi modelli supportati, a più contesti utili; un gate elegante che non riproduce le misure non è sufficiente.
- Considerare allocazioni driver oltre al processo, buffer temporanei, proiettore, stato dei due contesti e cache esperti.
- Non introdurre un mmap/repack universale sulla base di un esperimento in un solo regime. Le deviazioni dal comportamento corretto devono avere una motivazione misurata.
- Valutare contesti più ampi sui telefoni con margine dopo aver misurato costo KV e qualità su chat lunghe. La quantizzazione KV esiste già: il lavoro è usarla bene, non “attivarla”. Più contesto può comunque costare latenza e stato, quindi il solo fit non ne prova il beneficio.
- Profilare interfaccia, scroll, tastiera e Stop durante l'inferenza. Il codice contiene già coalescing e interventi sul rendering del testo: verificare l'esito prima di aggiungere altra complessità.

##### Batteria e inattività

Misurare energia e autonomia su telefoni reali. Le misure termiche di board QDC non bastano a promettere un risparmio di batteria.

Le memorie riportano un sospetto di consumo a riposo, non ancora attribuito a Kalsa. Inserire una prova comparativa con attribuzione per UID/processo, CPU e wakelock, distinguendo app, Termux, harness e sistema. Non promuovere l'ipotesi a bug accertato senza questa verifica.

**Criterio di completamento:** sessione sostenibile, comandi e interfaccia reattivi, attività accessorie controllate e consumo in inattività spiegato da dati.

#### 9. Scelta iniziale: LFM2.5-2.6B contro MiniCPM5-2B

La scelta di lavorare su un solo modello è confermata. **Prima di congelare LFM, MiniCPM5 merita una qualificazione breve**, perché il costo di cambiare modello cresce dopo le ottimizzazioni specifiche. Il lavoro già investito in LFM non sostituisce il confronto.

Risultati pubblicati da OpenBMB, non misurati da noi sul telefono:

| Benchmark | MiniCPM5-2B | LFM2.5-2.6B |
|---|---:|---:|
| LiveCodeBench v6 | 69,1 | 42,1 |
| AIME 2025 | 86,5 | 41,9 |
| BFCL v4, uso degli strumenti | 66,6 | 61,1 |
| IFEval | 86,7 | 93,4 |
| Multi-IF | 71,8 | 76,8 |

MiniCPM5 ha circa 2,52 miliardi di parametri totali, architettura standard `LlamaForCausalLM` e contesto dichiarato di 131.072 token. Il nome “2B” non implica un modello molto più piccolo di LFM 2.6B; il contesto dichiarato non è il contesto sostenibile sul telefono. Fonte: [model card OpenBMB](https://huggingface.co/openbmb/MiniCPM5-2B).

Anche [Artificial Analysis](https://artificialanalysis.ai/models/minicpm5-2b/) lo colloca, alla verifica dell'8 settembre, primo nel proprio indice tra i modelli a pesi aperti fino a 4B. È un segnale per provarlo; non certifica latenza, qualità in italiano o consumo della versione quantizzata nell'APK.

OpenBMB dichiara codice e pesi Apache 2.0; LFM usa una licenza propria con condizioni commerciali legate al fatturato. Fonti: [licenza MiniCPM](https://github.com/OpenBMB/MiniCPM/blob/main/LICENSE), [licenza LFM](https://huggingface.co/LiquidAI/LFM2.5-2.6B/blob/main/LICENSE). È un elemento della scelta insieme a qualità, prestazioni e costo di integrazione.

##### Qualificazione con un termine e una decisione

- Baseline: LFM QAD-Q4_0 già presente. Candidato iniziale: un [GGUF ufficiale MiniCPM5](https://huggingface.co/openbmb/MiniCPM5-2B-GGUF), partendo da Q4_K_M. Pin di revisione e SHA, inventario dei tensori, verifica del tokenizer e del template, stop token, thinking e parser dei tool. La compatibilità con llama.cpp corrente non certifica il nostro pin.
- Una sola quantizzazione iniziale per candidato. Aggiungere un riferimento a precisione superiore su un sottoinsieme quando serve a distinguere un errore del modello da quantizzazione, template o motore. Nessuna ricerca estesa su decine di quant prima di aver scelto il modello.
- Corpus iniziale di **80 casi**, 40 italiani e 40 inglesi: 20 conversazione, 20 istruzioni/formati, 16 strumenti, 12 documenti e 12 memoria/contesto. Separare 60 casi di sviluppo e 20 tenuti fuori dal tuning, con distribuzione delle categorie. I casi possono comprendere più turni.
- Thinking sempre attivo. Prima passata con il budget breve del prodotto; seconda su 16 casi difficili con il budget esteso. Registrare i valori effettivi, senza importare sampler o budget dell'altro modello alla cieca. I token fra tokenizer diversi non sono un'unità sufficiente per confrontare la qualità per secondo.
- A G1 eseguire i 60 casi di sviluppo su entrambi i modelli in una configurazione di riferimento riproducibile; almeno 24 casi rappresentativi per entrambi nell'APK su ciascuno dei tre telefoni. Ripetere le risposte dubbie o instabili e valutare alla cieca le risposte aperte, con rubrica fissata prima del confronto. I 20 casi riservati vengono aperti solo alla valutazione finale M1: non usarli per scegliere modello, prompt o profilo.
- Misurare tempo alla risposta utile, completamento del compito, token di ragionamento/risposta, RAM, capacità di contesto e comportamento a caldo. Confrontare CPU ben configurate prima di attribuire vantaggi agli acceleratori.
- **G1, 15 settembre:** scegliere un solo modello che soddisfi il perimetro su tutti e tre i telefoni. MiniCPM diventa il principale se il vantaggio di qualità sopravvive ai vincoli di tempo e memoria. In caso di parità sostanziale, pesare licenza e costo di integrazione; un'integrazione ancora non funzionante non dimostra inferiorità del modello.

Se MiniCPM ha un blocco d'integrazione non risolvibile nella finestra, registrarlo e proseguire con LFM come scelta provvisoria esplicita. Non riaprire settimanalmente la selezione per ogni nuova uscita: la revisione successiva avviene dopo M1. Se nessuno dei due soddisfa il minimo sui tre telefoni, il gate fallisce e si rivedono budget e perimetro prima di iniziare la campagna kernel.

All'uscita di G1 fissare gli obiettivi assoluti per telefono: attesa a freddo e a caldo, risposta utile con thinking breve/esteso, Stop, memoria e qualità. I valori nascono dalla baseline e dall'esperienza accettabile, **prima** delle ottimizzazioni; non si modificano a posteriori per promuovere un risultato.

#### 10. Concorrenza: riferimenti da misurare e flussi da studiare

**Google AI Edge Gallery non è limitata ai Tensor.** Il progetto dichiara Android 12+ e iOS 17+, chat, immagini, audio, strumenti e gestione dei modelli; il codice è Apache 2.0. Fonte: [repository Gallery](https://github.com/google-ai-edge/gallery). LiteRT-LM documenta CPU/GPU e percorsi NPU per Tensor, Qualcomm e MediaTek, con artefatti e requisiti specifici per modello/SoC: non è una garanzia di NPU universale nell'app. Fonte: [LiteRT-LM NPU](https://developers.google.com/edge/litert/next/litert_lm_npu).

MiniCPM5 dispone già di un [artefatto LiteRT e istruzioni per l'importazione in Gallery](https://huggingface.co/litert-community/MiniCPM5-2B). Inserire un confronto presto permette di capire se un runtime esistente risolve un'attesa su cui stiamo per investire. GGUF e LiteRT hanno quantizzazioni diverse: registrare un confronto fra configurazioni complete; isolare il motore solo quando pesi, precisione e lavoro sono realmente comparabili. Un eventuale cambio di runtime richiede un beneficio dimostrato e una decisione architetturale; questa proposta non introduce automaticamente un secondo motore nell'app.

**Noema è un riferimento di prodotto nell'ecosistema Apple**, inclusi iPhone, iPad e Mac. Documenta progetti, documenti, strumenti Python e API locale. Fonti: [piattaforme](https://noemaai.com/docs/quick-start), [changelog](https://noemaai.com/changelog). Offre inoltre [Overfit](https://huggingface.co/NoemaAI-labs/Noema-Overfit): pesi non-expert residenti ed esperti caricati su richiesta. Quindi MoE oltre RAM non è, da solo, un elemento distintivo di Kalsa. Gli stessi autori distinguono maggiore capacità eseguibile da velocità interattiva garantita.

Prove da completare entro M1:

1. Gallery sullo stesso S23 o Xiaomi 14: installazione, prima risposta, turni successivi, riapertura, documento e strumenti dove supportati. Versioni e impostazioni registrate; funzionalità assenti segnate come tali.
2. Due confronti distinti: configurazione predefinita di ciascuna app, per l'esperienza utente; stesso modello dove possibile, per una diagnosi più controllata. Evitare di confrontare numeri promozionali di prefill con la latenza completa di Kalsa.
3. Noema: rivedere download, stato del modello, ripresa, documenti, strumenti e messaggi di errore. Se è disponibile un dispositivo Apple compatibile, provare i flussi; altrimenti classificare il confronto come documentale. Non serve acquistare hardware né inventare una comparazione prestazionale iOS–Android.
4. Tradurre il confronto in pochi criteri di accettazione: stato comprensibile, ripresa affidabile, Stop efficace, risposta utile e percorso semplice per documenti/voce. Nessuna espansione di feature durante M1 solo per pareggiare un elenco.

Il vantaggio da dimostrare è una buona conversazione con tempi e consumi prevedibili sul telefono dell'utente. Non abbiamo ancora misurato le due app concorrenti nelle stesse condizioni e non dichiariamo superiorità di Kalsa.

#### 11. Dispositivi, laboratori e impiego del tempo

| Risorsa | Ruolo nel piano | Cosa certifica e cosa resta fuori |
|---|---|---|
| **Galaxy S23 fisico** | Riferimento Snapdragon 8 Gen 2/Adreno 740; chat, One UI, RAM, GPU candidata, ciclo di vita e futura pressione da streaming | Percorso prodotto obbligatorio. CPU è la baseline; V73 GPU/NPU richiede prove proprie. Il lab storico indica S23 128 GB/8 GB con UFS 3.1: riconfermare l'esemplare, senza assumere UFS 4.0 |
| **Jelly Star fisico** | Riferimento CPU su Helio G99, 8 GB RAM, schermo piccolo, autonomia e limiti di calcolo | Percorso prodotto obbligatorio, anche se rimane CPU. Le evidenze Mali precedenti non giustificano riaprire una campagna GPU senza una novità concreta. NPU non promessa |
| **Xiaomi 14 fisico** | Riferimento Snapdragon 8 Gen 3, GPU candidata, HyperOS, memoria e sopravvivenza in background | Percorso prodotto obbligatorio. Replica retail delle conclusioni QDC v75; test del falso rifiuto memoria a modello già caricato. RAM e firmware dell'unità vanno letti, non dedotti dal nome |
| **QDC Qualcomm** | Correttezza nativa e prove mirate su generazioni non coperte; soprattutto v79/8 Elite se disponibile, diagnosi v73/v75 solo quando necessaria | Le misure valgono per quella board/driver/artefatto. Nessuna sostituzione della certificazione batteria e termica retail. Evitare repliche di routine di test già eseguibili su S23/Xiaomi |
| **Samsung Remote Test Lab** | Uno o due Galaxy aggiuntivi con SoC/One UI/Android differenti; installazione, ABI, pagine da 16 KB se disponibili, UI, permessi e resume | Compatibilità su quel firmware. Il marchio Galaxy non identifica il SoC: leggere il chip; su Exynos non applicare la policy Adreno. Streaming remoto e alimentazione non controllata escludono una certificazione di latenza percepita o autonomia |
| **Mac/CI** | Corpus, test TS, harness, analisi, build e controlli degli artefatti; eventuale studio dei flussi Noema su hardware compatibile | I risultati desktop/emulatore non vengono promossi a prestazioni Android |

Specifiche pubbliche: [Jelly Star](https://www.unihertz.com/products/jelly-star), [Xiaomi 14](https://www.mi.com/global/product/xiaomi-14/specs/). La capacità di RAM, l'OS e il driver effettivi di ogni unità entrano nel manifest il primo giorno. Un esemplare per modello consente una qualifica iniziale, non una generalizzazione a ogni telefono con lo stesso SoC.

Per ogni dispositivo registrare: modello e variante, RAM fisica, memoria disponibile, espansione RAM/swap, spazio libero e supporto di storage, Android/build/driver, dimensione pagina, modalità energetica, luminosità/refresh, temperatura iniziale e alimentazione. Non cambiare queste condizioni fra A e B senza dichiararlo. Separare prove riproducibili con impostazioni fissate da prove con le impostazioni normali dell'utente.

##### Quote e prenotazioni

- **Il saldo QDC non è stato verificato live.** Le memorie dell'8 settembre riportavano soltanto 35 minuti sul QRD8650 e 89 sul QRD8750; sono un allarme di pianificazione, non il saldo attuale. Non riusare i vecchi budget di circa 900 minuti come disponibilità presente.
- Per M1 prevedere al massimo **240 minuti QDC di base**: una sessione preparatoria da 60 minuti e due celle mirate fino a 90 minuti, su pool scelti dopo il controllo delle quote. Sono un budget richiesto, non prenotazioni; una cella completa su v79 può esaurire il saldo storico.
- Eventuale studio NPU: **fino a 120 minuti aggiuntivi**, solo con quota disponibile, kit e preflight pronti e una domanda non già risolta. Se il vantaggio non è chiaro, il ramo resta disabilitato e M1 continua sui percorsi validati. Non trasferire una certificazione NPU LFM a MiniCPM.
- Samsung remoto: due sessioni da **60 minuti**, una per compatibilità iniziale e una sul candidato finale, più 60 minuti di riserva. Catalogo, crediti e disponibilità da verificare prima di fissare il modello della prenotazione. Samsung documenta prenotazioni e limiti del servizio, non garantisce che un particolare telefono sia libero: [Remote Test Lab](https://developer.samsung.com/remotetestlab/doc/about-remote-test-lab).
- Preparare APK, modelli, hash, driver e criteri prima della sessione. Pianificare bootstrap e cooldown: l'ultima coppia A/B QDC richiedeva circa **50 minuti**, quindi una prenotazione da 30 minuti non basta per replicarla. Chiudere e verificare lo stato della sessione; controllare il consumo effettivo nel portale. Accesso mobile QDC tramite [ADB su tunnel SSH](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/interact-with-devices/mobile-session).
- Fare una sola cella QDC alla volta. I tre telefoni locali possono eseguire job autonomi contemporaneamente, con raccolta e analisi successive; le prove manuali vengono scaglionate. Nessuna necessità di mantenere tre linee di coding parallele.

##### Batteria e termica sui telefoni fisici

Le prove energetiche finali avvengono senza ricarica e senza registrazione video continua. Preparare i dati prima, eseguire un job locale e raccogliere i log dopo, oppure usare lo stesso collegamento wireless in entrambi i bracci dichiarandone il costo. Mantenere comparabili carica iniziale, ambiente, schermo e carichi di sistema; lasciare raffreddare e ricaricare fra le sessioni secondo protocollo.

Separare tre risultati: temperatura/stato termico OS; consumo osservato della batteria; energia attribuita al processo dove i contatori sono attendibili. Batterystats e contatori disponibili non sono un wattmetro universale. Se la risoluzione non basta, riportare l'incertezza e non pubblicare joule/token inventati o autonomie estrapolate da pochi minuti.

#### 12. Timeline di coding, test e decisioni

##### Ipotesi di capacità e dipendenze

Calendario a **giorni lavorativi**, dal mercoledì 9 settembre 2026. Si assume una linea principale di sviluppo con disponibilità giornaliera, CI utilizzabile e un referente che possa preparare i telefoni ed effettuare circa 30–60 minuti di verifiche manuali nei giorni di campagna. I job automatici possono proseguire mentre si lavora al codice; le attese di laboratorio non sono giornate di coding gratuite. Weekend esclusi dagli impegni manuali, utilizzabili per soak già avviati.

Non si riscrivono UI, motore o harness da zero: si estendono i componenti esistenti. Ogni lavoro nativo segue fork → pin → sync → APK CI. Un blocco architetturale sulla sessione o un cambio di runtime può superare il margine e richiede una nuova stima; non viene nascosto tagliando i test.

Percorso critico: **G0 baseline → G1 modello → G2 chat completa → G3 profili corretti → G4 qualità sostenuta → M1**. QDC v79, Samsung aggiuntivi e NPU non bloccano il completamento sui tre telefoni fisici se il loro supporto rimane esplicitamente fuori dalla qualifica.

##### Primo modello: 9 settembre – 9 ottobre, margine 12–16 ottobre

| Date 2026 | Coding e integrazione | Test e laboratorio | Risultato richiesto / dipendenza |
|---|---|---|---|
| **9 set, mer** | Fissare baseline app/motore; inventario degli harness; manifest degli artefatti e misure mancanti; congelare rubrica del confronto | Verificare accesso ai tre telefoni, firmware, quote QDC/RTL e CI; smoke della baseline. Se i fisici non sono ancora accessibili, preparare corpus e kit | **G0:** baseline riproducibile, matrice reale e slot pianificabili; nessuna prenotazione al buio |
| **10–11 set, gio–ven** | Entry sperimentale MiniCPM; template, thinking, parser tool e diagnostica. Preparare corpus 80 casi, holdout e automazione del confronto | Smoke CPU, correttezza degli input/output e inventario GGUF. Prima passata qualità e prova Gallery dove possibile. QDC soltanto se risponde a un blocco specifico | Due candidati confrontabili; se MiniCPM non parte, causa e costo residuo espliciti |
| **14–15 set, lun–mar** | Correggere i soli difetti che invalidano il confronto; fissare modello, primo artefatto e budget per telefono | Confronto sui tre fisici: 24 casi ciascuno per candidato, chat breve/lunga, pressione memoria; completare i 60 casi di sviluppo e revisione cieca | **G1, 15 set:** scelta del modello; baseline e obiettivi assoluti scritti prima del tuning |
| **16–18 set, mer–ven** | Sessione autorevole e contratto restore; invalidazione cache; stop/edit/regen. Integrare stato ricorrente se il modello lo richiede | Test unitari mirati allo stato e test APK di save/reload, stop e cambio chat; CPU prima, governor solo se il percorso è ammesso | Checkpoint di sessione il 18: recupero corretto e token riutilizzati osservabili. Se il nativo non lo consente, stimare il blocco prima di proseguire |
| **21–23 set, lun–mer** | Completare sessioni, scheduling di memoria/embedding/tool; stato UI coerente; bug memoria HyperOS e idle/ready riproducibili | Suite funzionale sui tre fisici, tool simulati ripetibili più smoke rete reale, voce/documenti e 20–30 turni. Prima sessione Samsung per compatibilità | **G2, 23 set:** chat completa sul percorso CPU; test pertinenti anche sul governor già funzionante; ripresa senza corruzione |
| **24–25 set, gio–ven** | Profilare le attese; calibrare CPU, contesto/KV e fit; introdurre profili identificati da artefatto/driver. Correggere kernel raggiunti solo se necessario | Sweep piccolo e sequenziale su S23/Xiaomi/Jelly; oracoli per i kernel cambiati; prefill corto/lungo e decode separati. QDC v79 solo dopo preflight | Profili candidati con provenienza, costo della cache e alternative statiche misurate |
| **28–29 set, lun–mar** | Routing per fase con isteresi e fallback; copertura dei quant misti; abilitazione pulita soltanto per i profili validati | A/B sui fisici, correttezza del passaggio CPU↔GPU e dei contesti; sessione QDC mirata. Decisione NPU limitata al tempo previsto | **G3, 29 set:** per ogni telefono almeno un percorso corretto; tutti i percorsi abilitati superano i test. NPU senza prova resta fuori |
| **30 set – 2 ott, mer–ven** | Termica durante il turno, priorità delle risorse, lifecycle e difetti UI emersi dal profiling; nessuna nuova feature | Tre sessioni sostenute per telefono/configurazione finale, consumo A/B, inattività e ripresa il giorno dopo; test caldo con protezioni OS attive | **G4, 2 ott:** qualità e prestazioni sostenute; consumi misurati o limiti di misura dichiarati; cause delle regressioni spiegate |
| **5–6 ott, lun–mar** | Correzioni finali e configurazioni predefinite; congelare candidato e manifest | Corpus riservato, 16 cicli lifecycle per telefono, confronto Gallery, seconda sessione Samsung, verifica APK installata pulita | Candidato congelato il 6; nessuna dipendenza da flag debug nascosti |
| **7–8 ott, mer–gio** | Solo fix bloccanti, documentazione delle configurazioni e dossier risultati; review dei call path | Replica mirata del candidato, check release/CI e provenienza; se cambia un kernel o il modello, ripetere tutta la parte invalidata | Dossier M1 con risultati grezzi, limiti e istruzioni di riproduzione |
| **9 ott, ven** | Chiudere il verbale e archiviare APK/configurazioni | Verifica finale dei criteri della sezione 13 | **M1:** primo modello completo e bancato sui tre telefoni, oppure elenco preciso dei gate mancanti |
| **12–16 ott, lun–ven** | Margine per problemi nativi/OEM e relative correzioni; se non usato, osservazione del candidato nell'uso quotidiano | Retest della superficie cambiata; eventuale ripetizione di batteria/soak | **16 ott:** termine di riserva. Se un gate resta rosso si ripianifica, senza promuovere una build incompleta |

La disponibilità fisica entro il 14 settembre è un'ipotesi di calendario, non una conferma di collegamento. Se i telefoni sono già pronti, anticipare la raccolta dati del 14–15; se arrivano dopo, far avanzare codice/corpus/CI ma spostare G1 e i traguardi dipendenti di conseguenza. Una board QDC non sostituisce Jelly né i comportamenti OEM di HyperOS.

##### Dopo M1: secondo denso e primo grande MoE

Queste date hanno maggiore incertezza e vengono riconfermate a M1. Presuppongono che il margine termini entro il 16 ottobre e che non si cambi runtime. Il secondo denso non deve essere automaticamente il perdente del confronto iniziale: deve offrire una capacità o qualità aggiuntiva utile, con Qwen testo/vision come candidato già integrato.

| Date 2026 | Coding | Test e decisione |
|---|---|---|
| **19–20 ott** | Scheda del secondo denso; KV/stato fisso/mmproj, template e inventario dei kernel; qualificare il valore aggiunto | Smoke CPU e qualità sul bundle reale; scegliere i telefoni che lo sostengono. Jelly può rimanere sul modello principale, senza cambio silenzioso |
| **21–23 ott** | Contratto multimodale/governor, eventuale caricamento differito del proiettore, sessioni e memoria per la nuova architettura | Test testo→immagine→testo, fit e picchi, cache e routing delle fasi; baseline sui telefoni ammessi |
| **26–28 ott** | Profili e sole ottimizzazioni richieste dalle misure; fallback quando il bundle non entra | Oracoli, chat lunga, lifecycle, termica e batteria; regressione mirata sul primo modello |
| **29–30 ott** | Fix, pin e dossier | **M2, 30 ott:** secondo denso bancato solo sui dispositivi validati. Se non offre un vantaggio utile, non forzarne la promozione |
| **2–4 nov** | Scegliere un solo grande MoE e una ricetta già misurata; fattibilità RAM/storage e contratto bridge | Verificare disponibilità dell'artefatto, hash e inventario. Misurare la stessa ricetta CLI sui telefoni ammissibili prima del port completo |
| **5–6 nov** | Colmare i parametri mancanti del bridge, cache e I/O, cancellazione e telemetria | Parità CLI–APK; spiegare eventuali differenze. Stop/go al 6 se il bridge richiede una riscrittura o la velocità non è utile |
| **9–13 nov** | Sessione e ricostruzione dello stato del MoE; gestione cache, pressione memoria e UI durante I/O | Decode e prefill distinti, qualità dell'eventuale dropping, sessioni prolungate su S23/Xiaomi solo se fit e spazio lo consentono |
| **16–18 nov** | Ottimizzazione del collo di bottiglia misurato; configurazione finale | Ripetizioni, restore, termica, consumo e regressione dei densi; Jelly soltanto se una ricetta sostiene un'esperienza utile |
| **19–20 nov** | Fix finali e dossier | **M3, 20 nov:** primo grande MoE bancato nel perimetro dichiarato; nessuna promessa automatica per ogni MoE o telefono |
| **23–27 nov** | Margine MoE, con ripianificazione se fallisce la fattibilità | Verifica finale o stop motivato; gli altri MoE ricevono una stima dopo M3, indicativamente 1–2 settimane ciascuno solo a bridge e architettura già supportati |

##### Ritmo di lavoro e controllo delle deviazioni

- Prima parte della giornata: leggere i risultati, scegliere una modifica verificabile, implementare e fare i test locali pertinenti. Parte successiva: CI, installazione e test del cambiamento; i job prolungati partono solo su build già sane.
- Chi sviluppa produce patch, test e manifest; il referente hardware prepara carica/ambiente e i passaggi manuali; la review verifica percorsi reali e criteri. Sono responsabilità da assegnare, non persone o agenti già prenotati.
- Non eseguire test di prestazione mentre lo stesso telefono scarica modelli, fa embedding o installa build, salvo uno scenario esplicitamente dedicato alla contesa. Tenere un unico esperimento attivo per dispositivo.
- Se la quota QDC manca, eseguire sul telefono locale equivalente dove possibile; la generazione senza hardware resta non qualificata. Se manca un Galaxy remoto, M1 resta limitato ai tre fisici: non ritardare il modello principale per aumentare il catalogo dei telefoni.
- Se una nuova ottimizzazione non supera correttezza e beneficio, mantenere il percorso già validato. Un problema su un backend opzionale non deve trasformarsi in un mese aggiuntivo prima della prima app affidabile.
- Per ogni gate registrare esito, evidenze, responsabile, residui e date aggiornate. **Le date possono cambiare; i risultati mancanti non diventano PASS.**

#### 13. Protocollo minimo per chiamare M1 “bancato”

I numeri sotto sono la dimensione della campagna proposta, non dati già raccolti né una dimostrazione statistica universale. Gli obiettivi di latenza/qualità vengono fissati a G1; le soglie degli oracoli esistenti restano quelle dei relativi protocolli.

| Area | Campagna minima e criterio |
|---|---|
| Artefatti | APK CI, pin app/fork/wrapper, SHA modello, template/sampler, profilo contesto e manifest dispositivo; riconoscimento del backend realmente eseguito |
| Correttezza nativa | Test degli operatori toccati e forme/tipi realmente raggiunti; oracolo end-to-end contro il riferimento corretto. Esiti grezzi ed eventuali decisioni esplicite separati; nessuna eredità automatica tra modelli o chip |
| Qualità | Corpus di 80 casi; 20 riservati alla valutazione finale. Casi deterministici valutati automaticamente, risposte aperte con rubrica cieca; regressioni e ripetizioni dichiarate. Ogni telefono riceve anche il sottoinsieme funzionale di 24 casi |
| Sessione/lifecycle | **16 cicli per telefono**: due ripetizioni di stop, modifica, rigenerazione, cambio chat, background breve, chiusura/riapertura, interruzione del processo e ripresa dopo idle. Nessuna perdita di dati confermati, corruzione o stato Ready falso; distinguere recupero della cronologia da riuso della cache |
| Prestazioni | Su ciascun fisico: almeno 5 avvii del processo, 10 turni brevi a sessione calda e confronti appaiati/interleavati tra baseline e profilo candidato. Avvio del processo non significa page cache del sistema fredda; dichiarare separatamente il primo caricamento dopo riavvio |
| Uso sostenuto | **3 sessioni per telefono**, ciascuna con almeno 30 turni e almeno 30 minuti, sulla configurazione finale; baseline con lo stesso protocollo per il confronto. Aggregare per sessione/telefono, senza trattare 90 turni correlati come 90 telefoni indipendenti |
| Memoria/contesto | Misurare 4k, 8k e 16k dove raggiungibili; almeno un contesto completo dichiarato per ciascun telefono. Pressione realistica, spazio ridotto e download interrotto; rifiuto o riduzione controllata quando manca margine, mai RAM virtuale contata come RAM fisica |
| Batteria/termica | 3 blocchi appaiati da almeno 30 minuti per braccio/telefono, integrabili con le sessioni sostenute se il protocollo coincide. Nessuna ricarica, condizioni annotate, OS thermal gate rispettato; non disattivare protezioni per ottenere una misura |
| Inattività | Almeno **2 coppie di finestre da 8 ore per telefono**, app dopo una chat vs controllo senza inferenza, in notti comparabili con ordine alternato. Attribuzione per UID e ripresa il mattino dopo; non assumere che ogni calo di batteria sia causato da Kalsa |
| Esperienza completa | Test manuale per telefono di tastiera, scroll, Stop, testo lungo, errore tool e ripresa; voce e documento end-to-end, inclusi diniego permessi e contenuto non leggibile. Visione nativa esclusa da M1 e dichiarata come fase successiva |
| Configurazione finale | Installazione pulita del candidato e configurazioni normali; nessun force da benchmark necessario. Prove diagnostiche debuggable separate dalla replica finale con le impostazioni destinate al prodotto |

Le prove lunghe iniziano entro il 30 settembre: le notti necessarie all'inattività non entrano tutte nel solo giorno finale. Se il 5–6 ottobre cambia il ciclo di vita, il motore o il profilo termico, ripetere le prove invalidate usando il margine del 12–16; una correzione puramente editoriale non impone di rifare la campagna.

Se i casi riservati fanno emergere un errore da correggere, conservarli come regressione e aggiungere casi indipendenti equivalenti per la nuova verifica finale. Non continuare a chiamare “riservato” un insieme usato per correggere il comportamento.

Pubblicare mediana, dispersione, massimi e numero di osservazioni; riportare p95 soltanto quando il campione e la stratificazione lo sostengono. Un p95 ricavato da 5 avvii o mescolando telefoni/modelli diversi non è un obiettivo verificato.

M1 richiede: tutti e tre i telefoni con un percorso utile e stabile; obiettivi fissati a G1 soddisfatti; nessun blocco noto su invio, cronologia, Stop o recupero; tutti i backend abilitati qualificati; qualità e consumo documentati. Un risultato negativo su una GPU/NPU opzionale può chiudere quella pista, ma non sostituisce un gate del percorso principale.

Output attesi, **ancora da creare durante l'esecuzione**: manifest e corpus versionati, report G1, schede dei tre telefoni, risultati JSONL/CSV con esclusioni motivate, APK e hash, report confronto Gallery/Noema con limiti, dossier M1 e verbale finale. Raccolta sperimentale nel repo `kalsa-moe-experiments`; codice e documentazione delle impostazioni nei rispettivi repo proprietari.

#### 14. Distinguere presenza, abilitazione ed esecuzione

Correzione importante alla prima ricognizione: `GPU_PREFILL_CORRECT.V75 = true` ammette V75 nella tabella, ma **non accende da solo il governor su un'installazione pulita**. `readGovernorEnabled()` legge `kalsa.governor.enabled` e restituisce false se il valore non è impostato.

Fonte: [governorRuntime](../../kalsa-wt-mergetest/src/engine/governorRuntime.ts).

Il piano deve registrare separatamente:

1. **Codice presente** nel ramo e nell'APK.
2. **Funzione abilitata** dalla configurazione e ammissibile per quel modello/dispositivo.
3. **Percorso eseguito**, provato dalla telemetria del turno.
4. **Beneficio misurato** con qualità e condizioni dichiarate.

Lo stesso vale per streamer, memoria, strumenti e restore. “Compila”, “è abilitato” e “funziona bene nell'app” sono risultati diversi.

#### 15. Fonti e rapporto con le memorie

Documenti di riferimento letti:

- [PLAN del repo sperimentale: stato corrente e aggiornamenti recenti](../../kalsa-moe-experiments/PLAN.md).
- [ALIVE, incluse le celle #60 e #61](../../kalsa-moe-experiments/docs/ALIVE.md).
- [Piano governor nell'app](../../kalsa-moe-experiments/docs/PLAN-governor-in-app.md).
- [Piano della cella GEMM f32 nell'app](../../kalsa-moe-experiments/scratchpad/agents/gemm-f32-ship/PLAN.md).
- [Decisione V75](../../kalsa-moe-experiments/scratchpad/agents/gemm-f32-ship/DECISION.md).
- [Stato app KALSA](KALSA.md) e [piano CisWire](PLAN_CISWIRE_FOR_REAL.md), da leggere con le rispettive date e il ramo di riferimento.

Memorie Claude del progetto consultate tramite l'indice `MEMORY.md` in `~/.claude/projects/-Users-marco-Projects-kalsa/memory/`, con lettura delle note pertinenti: `kalsa-product-constraints`, `kalsa-the-goal-is-a-governor`, `kalsa-defaults-must-be-correct-not-current`, `kalsa-one-kernel`, `kalsa-repo-map`, `kalsa-thinking-is-never-off`, `kalsa-measure-the-shipped-config`, `kalsa-measure-the-plateau`, `kalsa-kv-is-the-ctx-lever`, `kalsa-load-policy-per-model`, `kalsa-moe-stream-port`, `kalsa-kexp-is-regime-bound`, `kalsa-idle-drain-hypothesis`, `kalsa-shipping-model`, `governor-off-for-high-tier`, `kalsa-logit-oracle`, `kalsa-read-it-all`, `kalsa-vendor-never-edited-by-hand` e gli ultimi aggiornamenti di `state-2026-09-01`.

Le memorie sono un registro di decisioni e lezioni, con stati storici talvolta superati. Le affermazioni sul codice corrente sono state confrontate con il ramo prodotto indicato; i numeri delle vecchie campagne non diventano misure del prodotto attuale per sola citazione.

I collegamenti ai worktree sono comodi per la revisione su questo Mac. L'identità riproducibile delle osservazioni sul codice è **repo + commit + percorso**, dichiarata nella sezione 2; la posizione del worktree non sostituisce il pin.

### Piano 9 giorni (5/09 → 13/09), superseded

> Superseded by the current practical plan above; retained verbatim for still-open items and historical traceability.

1. **Governor dentro l'app (giorni 1-3).** Pin motore dell'app → ramo governor
   (rebase su main del fork con i pick OpenCL 12f6d9b6d); llama.rn/JSI: sessione
   governor a due contesti al posto del contesto singolo; `LlamaService` popola
   `llama_governor_params` + `llama_governor_thermo_profile` (BatteryManager:
   temp, %, plugged) e logga ogni decisione (`KALSA_GOVERNOR`). Fallback:
   cpu-only come oggi se il governor non parte. Accept: su QRD8650/8 Elite con
   APK debug, TTFT e decode ≥ arm C di oggi, zero kill lmkd, log delle fasi.
2. **Fit GPU + probe capacità (giorni 4-5).** `memoryEstimate.ts` impara il
   termine memoria driver GPU (§7.18) → `gpu_fit`; micro-calibrazione al primo
   avvio → `gpu_prefill_measured`; il gate refusa a voce alta (mai lmkd).
3. **Loop termico/batteria end-to-end (giorni 6-7).** Poll → policy → cool-mode
   GPU e ritorno; verifica su QDC con run sostenuta e gate termico DURANTE
   l'esecuzione (v79 ha superato 60 °C con i pre-gate verdi); ripulire i
   commenti stantii; il thermal hook smette di essere solo banner.
4. **Lane NPU (giorni 8-9).** Backend Hexagon compilato nel plugin dell'app,
   attivo solo per generazione ≥ V75 e solo prefill (`npu_lane_enabled`), dietro
   la prova di correttezza (0/301 va risolto o la lane resta off); v73 off
   finché il fix del mapping/TLBMISS non è nel fork.
5. Mali: fermo (decisione owner). Bisect #64 CHIUSO: culprit = #26049
   (0a50d9909, pipeline L2/DMA/MM/FA); il fix nel fork (revert/patch su
   64a155d24 + retest ngl8/ngl99) è un task a sé, mai issue upstream.


## Vincoli
- Mai half-offload (ALIVE 140-145); full o niente, cool-mode solo con delta misurato.
- Mai issue upstream (owner 4/09). Mai push su repo di terzi.
- Altra sessione Claude sui settings (UX): io tocco `src/engine`, `plugins/`,
  `native/`; nel repo app `git add` solo dei miei path, mai `-A`.
- Deleghe solo Paseo; un audit ostile per step; docs a ogni step.

## Budget QDC
~900 (7xx) / ~866 (8G3) / ~900 (8G2) / 981 (8sG3) / 623 (8E) minuti.

## Regole vive
- End Session: ref-click, conferma, reload, "Ended On" entro un minuto.
- Board QDC: `/data` è 0777 e un demone lo ripristina → holder `chmod 771`;
  keyguard → `locksettings set-disabled true`; nome sessione ≤ 30 caratteri;
  il campo minuti va scritto con eventi reali (altrimenti cap 120).
- Ogni driver NPU include `.farf`; kit sempre ri-pushato per commit.
- mimo: solo audit mono-documento (recon larghi → Luna/deepseek); delta numerici a deepseek.

## Aperti
- **Fine tune MiniCPM5: decisione aperta, gate 12/10 (dopo M1).** Raccomandazione 10/09: nessun branch prima di M1. Si riapre il 12/10 con due input: licenza LFM2.5 e dossier M1 sugli errori reali di LFM. **Licenza (testo letto 10/09, non è una decisione):** LFM Open License v1.0 (https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/LICENSE) §5 — Commercial Use is licensed unless the Legal Entity's annual revenue is ≥ USD 10 million; above that threshold Commercial Use is not licensed. MiniCPM5 (Apache 2.0) remains the fallback if the threshold is a problem. Fino al 12/10 nessuna cella su MiniCPM5. GPU/governor NON sono "dopo M1": stanno in G3 (28-29/09); solo la NPU resta a decisione a tempo.

- **S23 battery reproduction — PARTIAL, model mismatch.** The 9/09 MiniCPM5 Q4_K_M incident remains the pathology baseline: 52% → 28% in 65 minutes, 0.06 tok/s and mlock/swap pressure. The 10/09 3ca6145 run used shipped LFM instead: 89% → 86% across five instrumented attempts, 11.03–13.10 tok/s, no stall/deadline/unload/interruption. C02's final retry false-settled to raw `The`; C03-C06 are the four valid answers, and the earlier C02 `4.35` is excluded. All five turns logged `memoryEnabled:0` / `skipped_no_snapshot`, so memory extraction was not exercised. This does not demonstrate that the MiniCPM5 pathology was fixed; no new MiniCPM5 reproduction is planned under the closed G1.
- ~~Sweep G1~~ **G1 chiuso il 10/09: LFM.** Score: `device/jelly/SCORE.md`, `device/s23/SCORE.md` (braccio MiniCPM5 fermato a 16/24), Xiaomi LFM 24/24. **Tagli dell'owner 10/09 pomeriggio ("test su test"):** nessun giudizio cieco delle righe a rubrica, nessuna cella sul quant Q4_0 di MiniCPM5, confronto Gallery solo al congelamento del candidato (5-6/10); ogni fix spedito riceve UNA verifica su telefono, non una campagna. Jelly lifecycle verification is scoped to a native/long-gate PASS and a brief PASS with limits; it is not a blanket PASS.
- **Lifecycle/background disposal.** `AppShell.tsx` `onAppState("background")` caused immediate disposal; the 0b75254 Jelly check showed that the JS 45 s timer cannot fire while the activity is paused. Sources were restored in `1e02fe3`; `e89bd2a` supplies the UI test IDs. The native/long gate is **PASS** on APK CI run `34483949398` (SHA-256 `a2d08f9df19d179d86d55db1e0407bd4ec77ec9e6d2edb0954083487c27ea5fb`, installed hash identical): save 10:34:18.945 → unload 10:35:04.621 (~45.7 s), reopen fit `no_active_model availableMb=5789`, load `3628 tokens/62 ms`, prewarm `skip kv_holds_chat`, continuation `promptMs=1489.054`. The brief slice is **PASS with limits** (shell HOME/reopen markers missing; only cancellation/no-unload slices), not blanket lifecycle PASS. Stop abort plus partial preservation is **PASS scoped** (`STOP-PARTIAL-JELLY-EVIDENCE-2026-09-10.md`, same `095466e` APK): 285-char assistant `a-8080264` with `interrupted:true`, UI `Generazione interrotta.`, `extractStopReason:4`; partial is English CoT, not the Italian answer. Edit→Salva is **PASS scoped** (`EDIT-SAVE-JELLY-EVIDENCE-2026-09-10.md`): Salva on the prefilled draft re-sent with `edited:true`, session `messageCount:2`, assistant `ciao`. Regenera UI is **PASS scoped** on Jelly APK `34539915778` / `1807aad` (`REGEN-JELLY-EVIDENCE-2026-09-10.md`). Xiaomi HOME on `8be587c` is **PASS scoped** (`XIAOMI-LIFECYCLE-8be587c-2026-09-11.md`): not immediate dispose (`4b29466` was); `model.unload` `graceMs:45000` at ~72 s wall; reopen load 43 ms, `n_common=2171`. S23 HOME on `8be587c` is **PASS (grace only)** (`S23-LIFECYCLE-8be587c-2026-09-11.md`): unload 46 s. Reopen restore is **FAIL** on that APK (`S23-LIFECYCLE-8be587c-RESTORE-2026-09-11.md`): `stale_kv_completed_turn`; `n_common=1829` prewarm. Fix `31495c3` snapshots live chat KV before extract (pooled stem); HOME meta not rewritten. CI APK `34604104890` in flight.
- **Memory extraction (`e455afc`).** **PASS scoped** on the separate APK CI run `34494832409` (SHA-256 `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a`, installed hash identical): meta v2 and restore loaded 4517 tokens with prewarm skipped; completed extraction produced facts 1/1 and 2/2, and the next send produced `aborted_by_send` after 8688 ms with facts 0 and restore 5022. The later app commit `f99fe4506a3072c6d18b625bdaca815615bf7421` forwards the outer turn signal to the inner extraction abort for clearChat, conversation switch, background discard, and unmount; new-send behavior is unchanged, and handleStop does not overlap extraction. MiMo's re-audit is **SHIP** by code review. Automatic E2E run `34526920272` was **cancelled** (not a pass). Extract-cancel is **PASS scoped** on S23 (`1807aad`): Nuova chat (`S23-EXTRACT-CANCEL-1807aad-2026-09-10.md`) and HOME/background-discard (`S23-BG-EXTRACT-CANCEL-1807aad-2026-09-11.md`) both `aborted_by_send` with native extract interrupted. Conversation-switch during extract is **PASS scoped** on S23 `8be587c` (drawer testID landed; `aborted_by_send`) and on Jelly `8be587c` (`JELLY-SWITCH-EXTRACT-8be587c-2026-09-11.md`). Model-switch after the 3-second bounded stop/discard is **PASS scoped** on Jelly (`1807aad` APK `34539915778`).
- **Session identity (`e2e09f5`).** **PASS scoped by code review, CI, and one-device identity/restore evidence** on APK `095466e`. Engine-change invalidation is still not a second-APK device proof (native identity inputs unchanged `095466e`→`c906727`). On Jelly `c906727`, process-kill restore of the active LFM chat is **no_file**: `KALSA_SESSION load ok:false reason:no_file` despite a `save ok:true usedTokens:3305` five minutes earlier in the same conversation; disk has no `lfm2*__conv-g1-m01-*` kvs. S23 `1807aad` did load `ok:true` tokens 1867 / prewarm `kv_holds_chat` skip, but the following turn still evaluated 1890 tokens in 37 s — not yet “token riutilizzati osservabili”. Explorer recon (`SESSION-NO-FILE-RECON-2026-09-11.md`, parent-verified): load hash hardcodes `hasTools=true` (`AppShell.tsx:3792`) while save uses `toolCallingEnabled` (`LlamaService.ts:3118`); `no_file` means `staleDropped===0`; save logs ok after `evictSessionPool`. Hash unify is app `2619db0` (`fix(session): hash load prompt-env the same way as save`). Load uses `computeSessionPromptEnvHash` in `sessionPromptEnv.ts`; save uses the same `promptEnvToolHashFields`. Save logs `evicted` if keepStem is missing after pool evict. Parent Jest 18/18. MiMo re-audit SHIP-WITH-FIXES: `!MEMORY_FACTS_ON_USER_TAIL` branch is dead while the flag is true — kept so load stays symmetric with save if the flag flips. `executeTool?: unknown` matches save's `Boolean(executeTool)`. Device restore on Jelly APK `34552188340` / `2619db0` is **PASS scoped** (`RESTORE-2619db0-JELLY-EVIDENCE-2026-09-11.md`): load `ok:true` 2301 tokens in 43 ms, `KALSA_KVPREFIX n_common=2301` of `embd=2301`, continuation `promptMs=15 s` for 305 new tokens — not a 37 s full wipe. Extract after save still diverges (`n_common=2`, checkpoint 2301 unusable). S23 `1807aad` load `ok:true` then 37 s user-turn is the same hole on long history (cold prefill 1890 tok / 37 s, not decode). KV-reuse is app `b85e775` + parse fix `8be587c`. Parent Jest 24/24. E2E `34559340574` SUCCESS; APK `34559343621` SUCCESS. S23 restore on that APK is **PASS scoped** (`S23-KV-REUSE-8be587c-2026-09-11.md`): SHA `52970eba…` local==installed; load `ok:true` 2801 tokens / 97 ms; user-turn `KALSA_KVPREFIX n_common=2801` of `embd=2801`; `prompt_n=232` ≪ `tokensEvaluated=3033`; `promptMs=8137` not 37 s. Extract `n_common=2` recover `2/248` (expected). First post-install load was `no_file` (new prompt-env stem `71419929`); measurement is save-on-this-APK then force-stop. Jelly restore on the same APK is **PASS scoped** (`JELLY-KV-REUSE-8be587c-2026-09-11.md`): SHA `52970eba…` local==installed; first load `ok:false reason:meta_mismatch:engineBuild`; save `ok:true tokens:2621` then force-stop; load `ok:true` 2621 tokens / 53 ms; user-turn `n_common=2621` of `embd=2621`; `prompt_n=317` ≪ `tokensEvaluated=2938`; `promptMs=16304` (317 new tokens). Extract `n_common=2` recover `2/211` (expected). Thinking 512. Xiaomi force-stop restore is **PASS scoped** on `4b29466` (`XIAOMI-G2-RESTORE-2026-09-11.md`) and again on sideloaded `8be587c` (`XIAOMI-KV-REUSE-8be587c-2026-09-11.md`): SHA `52970eba…` parent-verified on device; load `ok:true` 1956 tokens / 23 ms; user-turn `n_common=1956`; `prompt_n=23`; `promptMs=356`. First load `no_meta` (stem `71419929`). Thinking 512 (EMA withheld). No blanket G2. Conversation-switch during extract is **PASS scoped** on S23 `8be587c` (`S23-SWITCH-EXTRACT-8be587c-2026-09-11.md`): `activeId` `conv-g1-i14-…` → `conv-g1-i12-…` via `drawer-conversation-{id}`; extract `stopReason:"aborted_by_send"` `interrupted:true`. Same path on Jelly `8be587c` is **PASS scoped** (`JELLY-SWITCH-EXTRACT-8be587c-2026-09-11.md`): `activeId` `conv-g1-t11-…` → `conv-g1-m01-…`; `util-extractMemory-4` `interrupted:true`; `stopReason:"aborted_by_send"`. Prior Jelly was HARNESS_MISS. Drawer testID is app `3431db4`. No blanket G2 PASS.
- **Embedding progress telemetry.** The historical Jelly report of 707 chunks without `done` was a force-stop/SIGKILL, not a missing surviving-process exit; every surviving-process exit already logs `done` exactly once. App commit `1edf5c662715a357c7aa74d16b9b2ab787688f6e` adds deterministic progress logs every 50 successful chunks and at the final planned chunk. MiMo audit is **SHIP** with zero corrections; local gates are targeted Jest 6/6, full Jest 646/646, tsc clean, semanticIndexHarness 29/0, and embeddingServiceHarness 22/1 versus pre-existing base 21/1. Automatic E2E run `34528014849` on exact `1edf5c6` is **SUCCESS** (job `e2e` completed). No device or Mac build was performed.
- SEND-PDF dall'harness adb non qualificato (MediaProvider nega l'URI): resta il test manuale Files → Kalsa dell'owner.
- **Altro Copy + decode EMA (`c906727`).** Copy sheet is **PASS scoped** on Jelly APK CI `34544351697` (SHA-256 `1a47fff2c5f75dd2c8929cb75ec3e06b9d68f0124642987167c54c13154f4298`, installed hash identical): Altro listed Copia (`COPY-SHEET-JELLY-EVIDENCE-2026-09-10.md`). Decode-EMA withhold on the same install is **PASS scoped**: first send after force-stop `budget:512 decodeTokPerSec:null` while that turn decoded at 6.48 tok/s (`EMA-WITHHOLD-JELLY-EVIDENCE-2026-09-11.md`). S23 extract-cancel is **PASS scoped** on `1807aad`. Do not cut another APK for this pair.
- **Budget di thinking — DECISO dall'owner 10/09 07:40: alto per l'S23 (e Snapdragon), basso per il MediaTek.** Base: v2e (LFM 1024 > 256 con due giudici, costo ~+60 s/risposta sul Jelly). Implementazione senza rami per telefono: LFM `thinking {short: 512, extended: 1024}`; la modalità di default sceglie `extended` quando il decode misurato del modello (EMA, stessa famiglia di `prefillSpeed.ts`) è ≥ 5 tok/s, altrimenti `short`; prima misura → `short`. Jelly 3,4 tok/s → 512; S23 10-11 → 1024; Xiaomi → 1024. I 256/512 ereditati da Qwen escono.
- GPU/V75/q4_K, altre generazioni, NPU e governor (spento di default, fascia high mai eleggibile per `kvBytesPerToken` assente + mmproj): evidence-gated, fase 24–29/09.
- Chiusi il 9/09 (erano qui come aperti): sessione dopo turno con tool (a36074e, riapertura 32 s vs ~120 s a freddo sul Jelly); `full_context` gated dal budget di prefill (33502b2); prewarm denso scartato per artefatto dei contatori (e168b4a + e6d6aa0); lingua della risposta sui documenti (4b29466).
