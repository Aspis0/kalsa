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

# ⭐ STATO CORRENTE — vista compatta (2026-09-04 14:30, PIVOT PRODOTTO)

## Il goal (owner, ripetuto 4/09)
Kernel che usa NPU, GPU e CPU **per fase** a seconda di temperatura, batteria e
profilo, ottimizzato su Snapdragon (MediaTek/Jelly se possibile). Il pezzo
mancante non è il motore: è che **l'app non lo usa**. Digest completo di ciò
che è già misurato/deciso/implementato: `docs/GOVERNOR-STATE-2026-09-04.md`
(116 righe, citazioni file:riga verificate dall'orchestratore).

## Dove siamo (fatti, non opinioni)
- **Governor v0.2 nel fork** (`kalsa/governor-v0.2` @1a33da0f6, ~4.3k righe, 8
  step auditati): due contesti (prefill/decode), commit KV per range, input
  host già definiti — generazione (V73/V75/V79), fit GPU/NPU, batteria %,
  temperatura, plugged, T idle, trend (`src/llama-ext.h:198-230`); policy con
  soglie 38/39.5/42/43 °C, floor batteria 25 %, isteresi, budget flip 1 h
  (`src/llama-governor-policy.cpp`); GPU_COOLMODE; NPU lane **deferita**
  (`llama-ext.h:149`). Misurato: 8 Elite #38 (ttft ~10× CPU, decode ≥ CPU,
  vantaggio termico), 8B #41, tabella KEXP #40, VL #42, tier 750/735 #55-58.
- **App oggi**: `deviceTuning.ts:374` → `cpu-only` (`gpu-fit-gate-blind`) su
  ogni Android; `useThermalMonitor.ts` = banner UI, non decide nulla; visione
  CPU su Android (`LlamaService.ts:1499`); fallback `KALSA_GPU_FALLBACK` solo
  per errori di init (lmkd non è catturabile); gate RAM cieco alla memoria GPU
  (§7.18: 3.4 GB invisibili a /proc, lmkd uccide); backend Hexagon NON
  compilato nel plugin; commenti stantii in `engineParams.ts:100-113` e
  `LlamaService.ts:1429-1437,1496-1500` che parlano di GPU "ora attiva".
- **NPU**: v79 prefill 7.2× CPU ma correttezza NON provata (0/301 + 36
  INTERNAL-ERROR); v75 prefill 3.19-4.82×, decode 0.63×; v73 offload parziale
  vive, pieno muore (mapping su OGNI commit incl. pin); la TLBMISS v73 è
  bisezionata: culprit `0a50d9909` = upstream #26049 (#64, ALIVE 47) — si
  fixa nel fork o si lascia, MAI issue upstream.
- **Governor nell'app (fase 1, `docs/PLAN-governor-in-app.md`)**: S1 fatto
  (fork `kalsa/governor-v0.3-on-12f6d9b6d` @8665e9a9f, rebase 28/28, audit GO);
  S2 fatto (app worktree `kalsa-wt-governor`, branch `feat/governor-in-app`:
  414b494→74390c5, governor owner in `rn-governor.{h,cpp}`, accessor
  `active_ctx()`, fallback a stadi, residui del delta audit su disco in
  74390c5); CI native verde su 42ddcf4 (run 33916141291); **S3+S4 in corso**
  (Luna bf40dcfe: modulo Kotlin batteria, JSI thermo/stats,
  `governorInputs.ts`, wiring LlamaService dietro `kalsa.governor.enabled`).
- **Mali G57 (Jelly)**: PARKED per decisione owner 22/08 (ALIVE 405): f32 e
  q8_0 corretti ma GPU < CPU in tutti i 20 casi; si riapre con G610/G615.
- **Strumenti pronti**: APK debuggable A/B (run-as, ALIVE 46), QDC con 8 Gen
  2/3, 8s Gen 3, 8 Elite (~900/866/981/623 min), kit v73 per commit.

## Piano 9 giorni (5/09 → 13/09), in ordine di impatto sul goal
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

> **3/09 notte — DELEGA PIENA OWNER ("fai tutto") + due fatti di contesto
> duri.** (a) Owner via ALTRI 10 giorni (~13/09) e **S23 E JELLY PERSI**:
> lab fisico ZERO, tutto QDC/CI/Mac. (b) Chiarita la regola push: vietati
> solo i repo pubblici DI TERZI; il nostro fork si pusha (incidente
> delete+ripush da fraintendimento, ora in memoria). **Step bancati
> stanotte finora:** (1) `feat/moe-stream` MERGIATO in `main` dell'app
> (c513f00, conflitto assert-native-patch.sh risolto: entrambi i marker
> vivono nelle lib engine; pin llama.rn tenuto a 0.12.8 npm — l'assemblaggio
> device-proven; audit mimo APPLY, un finding refutato alla lettura);
> E2E emulatore in volo sul merge (run 33822638488). (2) **Decisione
> "merge pick" CHIUSA lato fork**: fork-main fast-forward a0cabca6b →
> **12f6d9b6d** (3 pick upstream: fix race FA, fix OOB-read Adreno, opt
> uint A7x — cella #53 zero regressioni), ref-verificato. Il pin dell'app
> resta a0cabca6b: stanotte APK-A (pin attuale) + APK-B (pin 12f6d9b6d)
> per confronto al rientro. In coda: cella #58 (re-run 750 con PREREG che
> prevede lo split → chiude l'Amendment senza sign-off), cella #59 NPU
> replica-morti-v73 su HDK8550 (OLMoE Q4_0 da procurare: Mac e backup
> negativi, ricerca full-disk Lenovo in corso).

> **3/09 notte, 21:05 — #58 BANCATA (riga 41): Amendment 750 CHIUSO.** Re-run
> su QRD8650 sotto PREREG pre-auditato (F15 applicato): i 20 FAIL sono
> byte-identici a #55, MMID 407/407, GPU pp512 291.1 / tg128 23.0 = +2.4%/−1.7%
> vs #55 → dentro ±10%, i numeri 750 sono costanti router (decisione owner n.1
> chiusa senza firma, per la via che l'audit di #55 aveva indicato). 8.7 min
> QDC. Report audit mimo BANK 10/10. Parallelamente: PREREG #59 (replica morti
> v73 su HDK8550) scritto+auditato (F1 dell'auditor refutato dal testo, F2/F3
> applicati; modello allenai Q4_0 sha 361e8d83 — il q55 in-house non è
> recuperabile, census 113/81/1 identico → gate modello PASS, emendamento
> pre-run dichiarato); driver #59 in scrittura (grok→Luna).

> **3/09 notte, 21:45 — E2E EMULATORE VERDE sul merge main (run 33822638488,
> 63 min, inferenza reale, primo E2E verde su main dal 16/08).** Gate
> superato → dispatch APK-A (apk.yml su main, pin a0cabca6b = assemblaggio
> device-proven) e APK-B (branch chore/engine-pin-12f6d9b6d pushato, pin
> 12f6d9b6d con i 3 pick OpenCL; vendor diff verificato = diff upstream
> 87/11/16/41/33/65). Decisione owner n.3 (APK) in esecuzione; n.2 (pick)
> chiusa lato fork + APK-B per il confronto al rientro.

> **3/09 notte, 22:30 — APK-A PRONTO (decisione owner n.3 CHIUSA nella forma
> baseline).** Run 33826825621 su main c513f00 verde in ~35 min: artifact
> `kalsa-apk-arm64-v8a-c513f00…`, app-release.apk 135 593 407 B, **sha256
> e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403**,
> scaricato in ~/kalsa-qdc/apk/apk-A-c513f00/ (APK-A.sha256). È il primo APK
> CI del `main` fuso, assemblaggio device-proven (pin a0cabca6b) — mai
> installato su telefono (lab zero fino ~13/09). APK-B (pin 12f6d9b6d): primo
> run 33826834623 CANCELLATO dal runner a 28 min dentro Gradle senza errore
> di compilazione (unico run sul branch, non è la concurrency) → rilanciato.

> **3/09 notte, 22:40 — CELLA #59 IN VOLO (HDK8550 job 798484, host
> sa802553, 45 min prenotati).** Driver scritto da grok→Luna, doppio audit
> mimo (F1 PULL_FAIL re-entry e F2 gating A2 applicati da grok; nel secondo
> giro: NO_BINARY "mancante" REFUTATO — era la variabile dell'esperimento
> F2b, non la baseline; guard del fallback -n0→-n1 allargato a
> `dspqueue|fastrpc|qurt_exit|0x2e`). Nota device: l'HDK8550 monta Android
> 16 (S23 era 14) — da dichiarare nel REPORT come confound residuo.

> **3/09 notte, 22:50 — #59 ESEGUITA: LA MORTE v73 REPLICA SU HDK8550 (G1).**
> Primo lancio VOID (`--load-mode` non esiste in questo lignaggio → `--mmap
> 0`, emendamento pre-dato). Poi A1 (HOSTBUF unset) e A2 (HOSTBUF=1 +
> --no-host 1) muoiono ENTRAMBI con `dspqueue_read failed: 0x0000002e` dopo
> 48 dispatch esperti — proof 484/48/48 identica all'S23 q48, tombstone
> presi. Build più nuovo, board di riferimento, Android 16, modello allenai:
> la morte è dello stack HTP v73 sotto dispatch MoE, non dell'S23. F6
> confermata su reference hw; dossier #8 ha un repro QDC. 27.8 min fatturati
> (7 di lavoro + ~20 idle: End Session passato solo al secondo ref-click —
> lezione 7 rafforzata: End + Yes via ref, reload, leggere Ended On entro 1 min). REPORT
> scritto, audit in coda. **APK-B PRONTO**: retry run 33829826282 verde,
> app-release.apk 135 593 407 B sha256
> 1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d
> (~/kalsa-qdc/apk/apk-B-09bdfe9/); verifica differenziale sulla lib
> `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`: A 10 750 296 B sha
> 35a15613 vs B 10 756 296 B sha 91e2a1b9, fingerprint dei pick (`q1u`=2,
> `WG_SIZE > FA_SG`=2) presenti SOLO in B; q23k=4 e marker=1 in entrambi →
> i 3 pick sono dentro APK-B e non in APK-A, come voluto.

> **3/09 notte, 23:20 — NOTTE CHIUSA: LE QUATTRO DECISIONI SONO CHIUSE.**
> (1) Amendment 750 → #58 (riga 41). (2) Merge pick → fork-main @12f6d9b6d
> + APK-B. (3) APK → APK-A e0d56a39… (pin proven) + APK-B 1e2709e5… (pin
> pick), entrambi in ~/kalsa-qdc/apk/, mai installati su telefono. (4) Cella
> NPU → #59 (riga 42): morte v73 replicata su HDK8550, F6 confermata
> stack-bound (audit: non dire 'arch-bound'). Lato app: feat/moe-stream
> mergiato in main (c513f00, E2E verde 63 min). Budget QDC ≈ 912(7xx) +
> 946(8G2) + 970(8G3) + 981(8sG3) + 623(8E). Prossimi (al risveglio owner):
> cella discriminante host-vs-DSP per lo 0x2e (rebuild alla base S23-era o
> strace del flush path), dossier #8 upstream con il repro QDC (solo LETTURA
> del repo terzo, nessun push), test APK-A/B su QDC via installazione APK.

> **4/09 mattina presto, 01:30 — #60 STEP 0 CHIUSO A COSTO QDC ZERO: LO 0x2e È
> UN SINTOMO, IL FAULT È `htp/main.c:729` (mmap_buf → HAP_mmap = -1 su v73).**
> Il logcat della #59 conteneva già il crash report cDSP (`abort()` da
> `libggml-htp-v73.so htp_iface_start+0x1348`, PD morto → status 3 →
> `dspsignal_wait` 0x2e sul host). Disassembly del medesimo skel con
> hexagon-llvm-objdump (container Docker snapdragon-toolchain, HEXAGON_Tools
> 19.0.07): 0x3E58 = ritorno dalla `call abort` a 0x3E54 con `r2=#0x2d9`=729
> e la stringa "mmap failed : va %p fd %u size %u" — v73 usa `HAP_mmap`
> (len int) senza fallback, v75+ `HAP_mmap2`. #59 mappava 3.57 GiB in 8
> buffer (3×~1 GiB; MBUF default 1 GiB). Non è quindi né "host flush path"
> né (per ora) firmware: è lo skel che abortisce quando una mappatura pesi
> fallisce. Cella #60 (qdc-8g2-npu-mmapbudget-60, PREREG+DISASM scritti):
> B1 `-ngl 8` vs B2 `-ngl 99 MBUF=512` discriminano budget VA cumulativo (H1)
> da limite per-mappatura (H2); B3 `-ngl 12` bracketa, B4 tg128. Driver da
> Luna, audit mimo, HDK8550 30 min. Dossier #8 = aggiornare
> docs/upstream-v73-hexagon-report.md (esiste, 3 firme S23), non un file nuovo.

> **4/09, 06:15 — #60 ESEGUITA (HDK8550 job 798892, 8.5 min): LA MORTE v73 È UN
> FALLIMENTO DI ALLOCAZIONE VA SUL DSP, E L'OFFLOAD PARZIALE VIVE (ANCHE IL DECODE).**
> Sei arm: `-ngl 8` VIVE (proof 189), `-ngl 12` VIVE (297, 2.48 GiB mappati),
> `-ngl 8 tg128` VIVE (2688 dispatch: primo decode NPU v73 mai registrato);
> `-ngl 99` con MBUF=512 MUORE, con VMEM=1800 MUORE (entrambi :729, proof 48);
> VMEM=0 misura 3 GiB ma poi non carica più (probe distruttiva). Il file
> `llama-bench.farf`=0x1F ha FUNZIONATO: logcat `adsprpc` mostra la catena
> `qurt_vtlb_mmap: unable to get virtual address` → `Error 0x80000483
> fastrpc_mmap failed` → `HAP_mmap2 failed for fd 27 length 698355712` →
> `mmap failed : va FFFFFFFF` → abort. Con ~0.53 GB (B2) e ~1.08 GB (B5) vivi
> al fallimento, dopo cicli map/unmap: FRAMMENTAZIONE VA del PD a 32 bit, non
> solo budget (upstream #26501/#28202 del 27/08-2/09 toccano proprio questo,
> non nel nostro kit). Websearch: issue upstream #26123 (aperta, luglio) =
> stessa classe su 8 Gen 2; Qualcomm fastrpc #137: VA cDSP 2 GB vecchi/3 GB
> 8gen3. Grid: G1b. F6 da RIFORMULARE (v73 ok sotto ~2.5 GiB residenti, muore
> a 3.6 GiB in questo build). REPORT scritto, audit mimo in corso; #61
> candidata = stesso driver su kit con #26501+#28202. Sessione chiusa al primo
> ref-click (Ended On 06:11:27).

> **4/09, 07:10 — #60 BANCATA (ALIVE riga 43).** Audit 1 (mimo): tre BLOCKER,
> tutti refutati sui raw con timestamp (fd24 distrutta a 49.691 prima di fd26;
> 8 destroy di B3 al teardown; 3221225472 B = 3.00 GiB); mimo poi morto in
> loop aritmetico nel delta → delta rifatto da deepseek (Reviewer bench):
> refutazioni CONFERMATE, BANK-WITH-FIXES (citazione objdump trascritta in
> DISASM, wording). F6 riformulata (v73 viabile ≤ ~2.5 GiB residenti, senza
> churn). Prossimi: dossier #8 aggiornato con il meccanismo; #61 APK smoke su
> QRD8650 (PREREG scritto, driver Luna 257 righe, audit mimo in corso);
> #61-NPU kit con upstream #26501+#28202 da costruire (CI/Docker).

> **4/09, 08:05 — #61 ESEGUITA: LA APP FUSA GIRA SU HARDWARE REALE (QRD8650,
> Adreno 750). APK-A e APK-B installano, caricano il gguf ship sideloadato
> (1 593 894 944 B, riconosciuto senza download), rispondono a un prompt:
> A 129 token a 26.4 tok/s, B 196 token a 26.0 tok/s (CPU: `offloaded 0/31
> layers to GPU` — la nota assenza dell'implementazione GPU nell'app, ora vista
> su hardware). Screenshot headless raw/A_sa803030.png: header "LFM2.5 2.6B ·
> QAD-Q4_0 · Ready · local" + risposta coerente. Prima app fusa su telefono.**
> Costo: 2 sessioni (23 + 31 min): 1° tentativo morto su `run-as: package not
> debuggable` (gli APK release di CI NON sono debuggabili → percorso root, la
> board è userdebug con adbd root) + bug set -u; 2° tentativo: schermo spento
> (Dozing) → nessun DB → wake+dismiss-keyguard nel driver. Il segnale S4 del
> PREREG (`KALSA_SESSION op:load`) era il restore della sessione KV, non il
> load del modello (errore della recon): il ledger dice S4 fail, il REPORT
> lo rilegge sui raw (llama_model_loader + PREWARM 1319 token in 9.4 s).
> Artefatto app: `promptMs` 411 s con 15 token nuovi (timer partito al prewarm).
> Dossier #8 aggiornato e auditato ACCEPT (commit 0b517d07, nessuna issue).
> Kit mmapfix: cherry-pick di #26501/#28202 IMPOSSIBILE (conflitti) → build
> puro da upstream/master in corso (npu-kit-62-upstream). REPORT #61 in audit.

> **4/09, 08:30 — #61 BANCATA (ALIVE riga 44, G1-AMENDED: l'owner ratifica
> l'emendamento del criterio S4/banner).** Audit mimo DO-NOT-BANK → 5 fix
> applicati (verdict rietichettata, alternative per promptMs, inferenza .so
> dichiarata non supportata, log driver in raw) → delta BANK-WITH-FIXES.
> Tre lavori del mini-prompt CHIUSI: #60 (riga 43), dossier #8 (0b517d07),
> #61 (riga 44). In volo: kit puro upstream (container 11a6…, grok su docker
> wait); container zombie `clever_brown` del 2/09 (bash appeso, 0% CPU) da
> pulire a mano. Budget QDC ≈ 912(7xx)/935(8G2)/913(8G3)/981(8sG3)/623(8E).

> **4/09, 08:50 — #62 ESEGUITA (HDK8550 job 798985, 7.9 min): IL KIT PURO
> UPSTREAM (64a155d24, con #26501+#28202) MUORE SU v73 A QUALSIASI TAGLIA —
> `-ngl 8` e `-ngl 99`, MBUF=512 e VMEM=1800 — con TLBMISS RW in
> `op_binary+0x50E4` (`binary_job_vector_same_shape`, loop vadd f32), thread
> `work-queue:N`, ZERO righe FARF di mmap: non è la morte di mapping, è la
> SIGNATURE 1 dell'S23 (q50, TLBMISS in op_binary) che riappare su board di
> riferimento con upstream master. Il nostro kit (022458a28 + commit kalsa)
> NON la mostra (#60: ngl 8/12 vivi). Per il PREREG: U1 morto → METHOD-VOID
> sulla domanda del mapping fix + H4 nuovo finding. Conseguenze: (1) bisect
> 022458a28..64a155d24 o kit ibrido per rispondere al mapping; (2) dossier #8:
> fatto upstream-facing forte (repro pubblico: upstream master + HDK8550 +
> OLMoE Q4_0 → crash a ogni -ngl). Kit rebuild: cherry-pick impossibile
> (23/7 file in conflitto); preset upstream android-34. REPORT in audit.

> **4/09, 09:05 — #62 BANCATA (ALIVE riga 45).** Audit BANK-WITH-FIXES: FIX-1
> applicato (righe ANON benigne), FIX-2 REFUTATO dai raw (`Bad VA 0x0` +
> `Error code 0x7003` identici a q50 → stesso modo NULL-deref). Prossimi:
> addendum dossier #8 con il repro upstream-master; bisect o kit ibrido per
> la domanda del mapping. Budget QDC ≈ 912/926/913/981/623.

> **4/09, 09:40 — OWNER: "approvo tutte le decisioni, soprattutto apk debug".**
> Ratifiche registrate in STATO CORRENTE; priorità: APK debuggable (apk.yml
> variante debug-release, sha, smoke #61-bis su QDC via run-as). Regola:
> aggiornare sempre tutti i docs.

> **4/09, 11:00 — OWNER: "Non aprire nessuna issue upstream. O fixiamo noi
> stessi o lasciamo perdere".** Decisione 4 riscritta: il dossier #8 è solo
> interno; per la TLBMISS/mapping v73 la strada è il bisect + fix nel fork
> (cella #63+) oppure l'abbandono. Ordine di lavoro confermato: (1) APK
> debuggable, (2) #61-bis run-as su QRD8650, (3) bisect 022458a28..64a155d24.

> **4/09, 11:15 — JOB 1 (APK debuggable): NIENTE DA IMPLEMENTARE.** La
> variante esiste già in `.github/workflows/apk.yml` (identico su main
> c513f00 e su chore/engine-pin-12f6d9b6d 09bdfe9): input `debuggable=true`
> → sed `debuggable true` nel blocco release del build.gradle generato dal
> prebuild, poi verifica `aapt2 dump badging` del token
> `application-debuggable`, artifact `kalsa-apk-<abi>-debuggable-<sha>`. Gli
> APK di #61 erano il default `false`. Dispatch fatti: main → run
> 33886959263, chore → run 33886967732 (~35-45 min l'uno, in parallelo);
> watcher scarica in ~/kalsa-qdc/apk/apk-{A,B}-debug-<sha>/ con sha256 e
> controllo badging. Luna prepara PREREG+driver #63 (run-as, no root nel data
> path). Pulizia fatta: container `clever_brown` rimosso (0% CPU), worktree
> kalsallama-wt-mmapfix + branch locale rimossi (nessun commit proprio).

> **4/09, 11:40 — #63 PRONTA (audit GO), #64 TOOLING PRONTO, build step 0 in
> corso.** #63 (scratchpad/agents/qdc-apk-smoke-63): PREREG + driver run-as
> (20 `run-as`, zero chown/restorecon/su nel data path), S0 = flag DEBUGGABLE
> da `dumpsys package`, S4 = `llama_model_loader: loaded meta data … from
> …/files/models/lfm2.5-2.6b/…gguf` + `KALSA_PREWARM "op":"done"` (righe
> #61 raw A:4802/5800, B:5198/6193). Audit mimo GO, 0 blocker; la sua nota
> "flags_rc mai controllato" è FALSA (d_run.sh:214). Aspetta gli APK
> debuggable dalla CI. #64 (scratchpad/agents/qdc-npu-bisect-64): build-kit.sh
> = kit SOLO v73 per commit (~10 min, non 40: configure 0.5 + skel 4 + host
> 2.5), BISECT.md con i 23 commit hexagon (index 12 = 990e3bfee #27042);
> step 0 = upstream PURO 022458a28 (mai provato: il nostro kit ha patch
> kalsa) in build ora (container kalsa-bisect-022458a, runner pid 68323),
> poi il midpoint. Audit tooling in corso. aapt2 installato sul Mac
> (openjdk@17 formula + build-tools 35 via sdkmanager, niente sudo).

> **4/09, 12:00 — #64 PREREG + DRIVER PRONTI (audit NO-GO → fix → GO).**
> PREREG: step 0 = upstream puro 022458a28 a `-ngl 8` come gate del range
> (BAD → range invalido, si studia il diff delle patch kalsa); poi bisect
> binario sui 23 commit hexagon (index 12 = 990e3bfee), verdetto per commit
> dal solo `up_ngl8`: BAD = famiglia TLBMISS/Bad VA/0x7003, GOOD = exit 0 con
> n_exps_htp0=24, OTHER = stop; `up_ngl99` registrato per la domanda mapping.
> Cap 6 sessioni HDK8550 (~60 min). Driver = #62 parametrizzato per sha7
> (kit npu-kit-bisect-<sha7>.tgz, raw/<sha7>/, D=kalsa64). Audit mimo:
> NO-GO perché exit 0 senza prova HTP tornava GOOD → fix (rc 11 + un re-run,
> poi METHOD-VOID), delta audit GO. Audit tooling: GO-WITH-FIXES; la "build
> dir stale fra commit" è REFUTATA (worktree per sha7). Build step 0 in corso
> (host 442/445 alle 11:42): la stima "10 min" era ottimista, sono ~25.

> **4/09, 11:52 — APK DEBUGGABLE A/B PRONTI; KIT STEP 0 PRONTO; sessione #63
> creata.** CI: A run 33886959263 → `apk-A-debug-c513f00/…/app-release.apk`
> sha256 c645f691a9d16a896415a25d90bd3e179c7d9743c9bcdbde17603017112b0adc;
> B run 33886967732 → `apk-B-debug-09bdfe9/…/app-release.apk` sha256
> 1b8e2793a63d182a1fe422a50519e246d8d4d4e4ce510ed2660c6cbbf8370a46; entrambi
> 142 033 466 B, `aapt2 dump badging` sul Mac: `application-debuggable`
> PRESENTE (la release di #61: assente). Kit bisect step 0
> `npu-kit-bisect-022458a.tgz` sha e8f5cfd1…, 39 voci, skel v73 711 880 B.
> Tre fallimenti onesti prima del kit: (1) Luna ha editato build-kit.sh 2 min
> DOPO il lancio del runner → bash legge lo script a pezzi → "unexpected end
> of file" (lezione: mai editare uno script in esecuzione); (2) `cmake
> --install` esige tutte e 4 le skel HTP; (3) e tutti i test binari → install
> eliminato, il kit si assembla dal build tree (`build-snapdragon/bin` + skel
> v73). macOS non ha `setsid`. Build midpoint 990e3bfee in corso (container
> kalsa-bisect-990e3bf). Sessione QDC 799128 `kalsa63-apkdebug-runas-qrd8650`
> (SSH only, 45 min) submitted 11:51.

> **4/09, 12:55 — #63 BANCATA (ALIVE riga 46): l'APK debuggable passa TUTTO
> via run-as su QRD8650, G1.** Sessione 799128 (45 min, cap raggiunto), 5
> tentativi: 1) `run-as: /data readable or writable by others: 40777` — la
> board QDC ha `/data` 0777; 2) dopo `chmod 771 /data`: S0-S4 ok su A e B,
> S5 void per keyguard (board NON USB-powered → `svc power stayon` no-op);
> 3) `/data` tornato 0777 da solo (demone QDC) → run-as rotto a metà run;
> 4) holder `chmod 771 /data` ogni 2 s: B passa tutto (223 tok, 23.5 tok/s),
> A void a S5 (schermo caduto tra type e Send); 5) A e B S0-S7 (A 90 tok
> 23.6 tok/s, B 65 tok 23.8 tok/s). Tre emendamenti pre-dato nel PREREG,
> tutti interventi sullo stato della board fuori da /data/data. REPORT (Luna)
> audit mimo BANK-WITH-FIXES (2 fix applicati). Lezioni QDC: `/data` va
> tenuto a 0771 con un holder; keyguard via `locksettings set-disabled true`;
> il nome sessione ha max 30 caratteri (form Angular resta invalido in
> silenzio). Budget 8G3: 911 → ~866.
>
> **4/09, 12:50 — #64 STEP 0 (sessione 799155, HDK8550 Android 14, job
> sa803224): upstream PURO 022458a28 a `-ngl 8` è GOOD** (exit 0,
> n_exps_htp0=189 come le B-arm di #60) **e a `-ngl 99` muore con
> `dspqueue_read 0x2e`** (la morte di mapping del nostro kit, non la
> TLBMISS). Range del bisect VALIDO: la TLBMISS entra dopo 022458a28.
> Midpoint 990e3bfee (index 12) lanciato nella stessa sessione.

> **4/09, 13:00 — #64 STEP 1: index 12 (990e3bfee, #27042) è BAD** — a
> `-ngl 8` muore dopo 21 op con `crashed in thread "work-queue:0" due to
> TLBMISS RW`, Fault PC `op_binary+0x5B9C`: la firma di #62/S23. Culprit fra
> gli index 1..12; prossimo index 6 (`0278d83`, #25974 "activation ops
> update"), kit in build (~30 min). Un run VOID onesto: il primo "990e3bf"
> aveva ereditato il kit di step 0 (resume guard del driver #62 saltava anche
> il push del kit) → driver corretto (kit sempre rimosso e ri-pushato, sha
> tgz nel log), raw quarantenato. Sessione 799155 chiusa a mano (~10 min).
> BISECT-LOG.md nel cell dir tiene la tabella dei verdetti.

> **4/09, 13:35 — #64 STEP 2: index 6 (0278d83, #25974 "activation ops
> update") è GOOD** (sessione 799162, ~6 min: `-ngl 8` exit 0 con 189 exps;
> `-ngl 99` la solita morte di mapping 0x2e). Culprit ∈ index 7..12:
> 7 c0bc859 (op_poll Windows fix), 8 0a50d99 (pipeline L2/DMA/MM/FA #26049),
> 9 355303e (im2col), 10 153d324 (load-mode auto), 11 fe8156f (rope offset),
> 12 990e3bf (BAD). Index 9 in build (~14:05), poi 8 e 11 in coda
> speculativa. Lezione: `pkill -f` col nome dello script ha ucciso anche il
> runner sequenziale → usare i PID. Sessioni oggi: 799128 (45), 799155 (~10),
> 799162 (~6). Budget 8G2 ≈ 923 → ~905.

> **4/09, 14:10 — #64 STEP 3: index 9 (355303e, im2col #26007) è BAD**
> (sessione 799168, ~7 min; TLBMISS in `work-queue:2`, Fault PC 0x20089EEC).
> Culprit ∈ {7, 8, 9}: 8 = #26049 "further improved pipeline (L2, DMA, MM,
> FA)" è il sospetto principale, kit in build (~14:35); 7 (#26029, fix
> Windows op_poll) solo se 8 è BAD. Al massimo 2 sessioni ancora.

> **4/09, 14:30 — PIVOT PRODOTTO.** Owner: "a che punto siamo del goal?" →
> risposta onesta: motore avanti, app ferma (cpu-only statico, niente
> governor, niente NPU, termico solo banner). Owner: "rileggiti tutto". Fatto:
> memorie app-side, HARNESS_FINDINGS §7.33/§7.7g-i, governor-v0/PLAN, e digest
> Luna `docs/GOVERNOR-STATE-2026-09-04.md` (mimo aveva allucinato un intero
> report: escluso dai recon larghi). Righe portanti verificate su disco:
> contratto v0.2 ha GIÀ input batteria/temperatura/plugged/trend e soglie
> termiche; l'app non li alimenta. STATO CORRENTE riscritto sul piano a 9
> giorni: governor nell'app → fit GPU → loop termico → lane NPU. Bisect #64
> resta in background.

> **4/09, 14:50 — #64 STEP 4: index 8 (0a50d9909, #26049 "further improved
> pipeline of the core bits (L2, DMA, MM, FA)") è BAD** (sessione 799176,
> ~8 min, coda 9 min; TLBMISS `work-queue:1`, Fault PC 0x20089ECC). Culprit
> ∈ {7, 8}; index 7 (#26029, fix Windows op_poll, minuscolo) in build: se
> GOOD, il colpevole è #26049. Ultima sessione del bisect a seguire.

> **4/09, 15:05 — #64 CHIUSO: CULPRIT = 0a50d9909 (upstream #26049
> "hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)").**
> Index 7 (c0bc859) GOOD nella stessa sessione 799176 (modello riusato, kit
> ri-pushato): tabella monotona GOOD {pin, 6, 7} / BAD {8, 9, 12}, sei
> sessioni, ~44 min del pool 8 Gen 2. Il commit tocca L2 dirty-range flush,
> HVX reduce_max, MM bias in VTCM, mmid row-mapping, HMX tiling, FA DMA.
> Confound dichiarato: solo i commit hexagon erano candidati. Aperto: la
> morte di mapping a `-ngl 99` (0x2e) c'è su OGNI commit del range, pin
> incluso → #26501/#28202 (fuori range) restano da provare con #26049
> revertato/patchato. REPORT in scrittura (Luna) → audit → ALIVE 47.

> **4/09, 15:20 — FASE 1 GOVERNOR: piano APPROVATO.** `docs/PLAN-governor-in-app.md`
> (Luna) → audit deepseek APPROVE-WITH-FIXES (11 refutazioni/lacune: path
> CMake, pin 3 commit/6 file, oracolo di correttezza greedy prima della
> velocità, fallback dopo il doppio load con `KALSA_GOVERNOR_FALLBACK`,
> BatteryManager nativo, test Reject→CPU, n_ubatch 256 di produzione con
> bound 3.46-3.94 GiB per due contesti del 2.6B) → fix → delta APPROVE.
> Emendamento mio: le board QDC non hanno temperatura batteria → override
> di bench `kalsa.bench.thermo` da `dumpsys thermalservice` (skin), marcato
> `thermo_source: bench-skin`; in produzione solo BatteryManager, mai profili
> sintetici. S1 (rebase governor su 12f6d9b6d + build/test macOS) in corso
> su grok, worktree kalsallama-wt-governor-v03.

> **4/09, 15:40 — S1 FATTO (grok) + audit Luna GO-WITH-FIXES.** Ramo
> `kalsa/governor-v0.3-on-12f6d9b6d` @8665e9a9f in kalsallama-wt-governor-v03:
> rebase 28/28 identico (range-diff tutto "="), OpenCL byte-identico, build
> macOS ok, `router_v02_golden/metrics=PASS`, bench C 3×3 su LFM2.5-2.6B:
> ttft 10087 ms / decode 19.6 t/s (Mac CPU, riferimento), G fail-fast senza
> acceleratore (atteso). Fix richiesti = lavoro di S2: l'overlay dell'app
> (`scripts/sync-kalsallama.sh`) non copia i 14 file governor/kv-commit/
> hybrid-commit; S1 non prova nulla su Android. S2 parte ora (Luna) in un
> worktree dedicato dell'app (`kalsa-wt-governor`, branch
> `feat/governor-in-app` da main) per non pestare la sessione UI.

> **4/09, 16:00 — S2 CONSEGNATO (Luna), audit grok in corso, CI in volo.**
> Worktree app `/Users/marco/Projects/kalsa-wt-governor`, branch
> `feat/governor-in-app` (pushato su Aspis0/kalsa, MAI il fork): 414b494 pin
> → 8665e9a9f + overlay dei 13 file governor/kv-commit/hybrid-commit nel
> vendor; 67c9f7f patch llama.rn con `rn-governor.{h,cpp}` (owner a due
> modelli + `llama_governor_init` come il bench di riferimento), accessor
> `active_ctx()`/`decode()` su tutti i siti decode/ctx (completion, slots,
> MTP, JSI), sessioni rifiutate in governor mode, `KALSA_GOVERNOR_FALLBACK`.
> Patch 2747 righe (sana). `clang++ -fsyntax-only` ok su tutti i file; CI APK
> debug run 33916141291 sul branch. Non ancora provato con un modello vero.

> **4/09, 16:20 — AUDIT S2 (grok): NO-GO.** Blocker vero: in governor mode
> `loadModel` ritorna dopo `load_governor_models` (rn-llama.cpp:604-606)
> saltando templates/n_ctx/completion (667-687) → primo completion su
> nullptr e n_ctx=0. Altri: FALLBACK non emesso sui fallimenti di load dei
> due modelli, thermo non impostato prima del primo decode, usi raw di ctx
> (clearCache/LoRA/mmproj) in governor mode, `reload_budget_available`
> permissivo, zero test. Fix in corso (Luna) → re-audit → CI.

> **4/09, 16:40 — #64 BANCATA (ALIVE riga 47).** REPORT (Luna) → audit
> deepseek BANK-WITH-FIXES (righe di BISECT.md sfalsate di −6, conteggio
> sessioni: 6 run in 4 sessioni ≈ 46 min, path degli script, clausola pkill
> non supportata) → fix applicati e ricontrollati. Primo audit deepseek
> bloccato da path relativi con cwd nel repo app (`find` sulla home):
> path assoluti sempre. Worktree del bisect rimossi (kit tgz conservati).

> **4/09, 16:50 — CI APK debug del branch `feat/governor-in-app` (run
> 33916141291, commit 67c9f7f pre-fix) VERDE:** overlay dei 13 file governor
> + patch llama.rn con rn-governor compilano su Android (NDK, arm64), assert
> del marker nativo passato. Non dice nulla sul runtime (il NO-GO resta).

> **4/09, 17:05 — S2 v2 (Luna): 7/7 finding del NO-GO chiusi** — commit
> b3a6137/1766cd3/42ddcf4: load governor converge su templates/n_ctx (da
> `active_ctx()`)/metadata/n_seq_max/completion/ctx_shift (rn-llama.cpp
> 629-784); `KALSA_GOVERNOR_FALLBACK` a ogni stadio (load acceleratore, load
> CPU, init, Reject) con {stage, models_loaded, reason, gpu_fit,
> profile_valid}; thermo parsato al load e impostato prima del primo decode,
> profilo invalido → throw `governor: thermo profile invalid` prima di ogni
> load; LoRA/mmproj/parallel/MTP/sessioni/clearCache rifiutati a voce alta;
> `reload_budget_available=false` di default; test C++ del parser
> (`scripts/governor-params-test.cpp`, PASS). Patch 3174 righe. Delta audit
> grok in corso; CI run 33922285427 in volo. Il retry CPU resta in S4.

> **4/09, 17:20 — DELTA AUDIT S2 (grok): GO-WITH-FIXES.** Crash chiuso;
> residui: una sola riga FALLBACK sul Reject di init (stage route_reject),
> `moe_stream.reset()` al reload CPU↔governor, test del parser compilato
> con exit code. Accorpati al brief S3+S4 (Luna): modulo Kotlin
> `GovernorBatteryModule` (BatteryManager: temp decimi, %, plugged,
> sensorValid), JSI `setGovernorThermo`/`getGovernorStats`,
> `src/engine/governorInputs.ts` (generation da SoC, model_kind dal
> registry, gpu_fit con termine §7.18, override `kalsa.bench.thermo`),
> wiring LlamaService dietro flag `kalsa.governor.enabled` (default OFF)
> con retry CPU unico su FALLBACK e riga `KALSA_GOVERNOR` per turno; jest
> sui moduli nuovi; CI a fine step. Solo `src/engine`, mai UI.

> **4/09 sera (18:00 → 5/09 00:30) — S2 residui su disco, S3 in corso, repo
> riordinato.** Luna (bf40dcfe) ha committato i 3 residui del delta audit S2 in
> `74390c5` (verificati da me nel patch: stage `route_reject` con UNA riga
> `KALSA_GOVERNOR_FALLBACK`, `moe_stream.reset()` al reload CPU↔governor,
> `scripts/governor-params-test.sh` con exit code registrato + script
> `test:governor-params` in package.json) e sta costruendo S3 (Kotlin
> `GovernorBatteryModule`, JSI `setGovernorThermo`/`getGovernorStats`). CI
> 33922285427 su 42ddcf4 **VERDE** (native compila con fallback a stadi + convergenza post-load). Memoria compattata per l'owner
> (state-2026-09-01.md → "PUNTO FINALE 4/09 SERA"). **Riordino repo (owner):**
> PLAN.md 2433→~1460 righe (990 righe di capitoli chiusi di agosto spostate
> verbatim in PLAN-archive.md), README riscritto (era falso: "nessuna
> dipendenza dall'app"; ora mappa dei 4 repo, layout, regole, lab QDC), i due
> .txt con spazi nel nome in `docs/archive/`. Nel repo ci sono file NON miei
> (`scratchpad/design/leaf-fold-v9.html`, `audit-lot-a-2026-09-02/A1-LEAF-*`,
> `mimo-lot-b-map-2026-09-04/`) dell'altra sessione Claude sull'app: lasciati
> fuori dal commit.

> **5/09 ~01:00 — S3+S4 CONSEGNATI da Luna (bf40dcfe), audit ostile in
> volo.** Commit su `feat/governor-in-app` (pushato su Aspis0/kalsa):
> `05ad253` (Kotlin `native/GovernorBatteryModule.kt` 57 righe + plugin Expo
> `plugins/withGovernorBattery.js` + JSI `llamaSetGovernorThermo` /
> `llamaGetGovernorStats` nel patch, ora 3462 righe) e `81bcaf2`
> (`src/engine/governorInputs.ts` 168 righe + test, `governorRuntime.ts` 53
> righe + test, wiring LlamaService +164 righe: flag `kalsa.governor.enabled`,
> retry CPU unico con `KALSA_GOVERNOR_FALLBACK_RETRY`, thermo per turno,
> riga `KALSA_GOVERNOR {...}` via JSON). **Verificato da me su disco:** jest
> 7/7 (exit 0), `test:governor-params` PASS (exit 0), il patch tocca solo 24
> file di glue llama.rn (nessun sorgente ggml/llama). CI APK 33927024200 su
> 81bcaf2 in volo. Audit ostile S3+S4 → grok (agente 2f3f58ef), report atteso
> in `docs/AUDIT-S3S4-governor-app.md`.

> **5/09 ~02:00 — Audit S3+S4 (grok, `docs/AUDIT-S3S4-governor-app.md`):
> NO-GO, 2 blocker + 9 major + 5 minori, tutte le righe citate verificate da
> me.** B1: LFM2.5-2.6B non ha `kvBytesPerToken` nel registry → `gpu_fit`
> sempre NoFit → il governor non si sarebbe MAI acceso sul modello ship (S5
> sarebbe stata CPU vs CPU). B2: la validità thermo in JS pretende
> `!plugged || idle calibrato`; l'esempio del piano (plugged:true, senza
> t_idle) era invalido su board USB → piano emendato (plugged:false +
> t_idle_valid/t_idle_c). M1: probe generazione su `Build.MODEL` = "Pineapple
> for arm64" su QDC → Unknown, e Unknown non forzava NoFit → si legge
> `Build.SOC_MODEL`. M2: FALLBACK stantio nel tail dei log riclassifica errori
> qualsiasi come governor. M3: riga `KALSA_GOVERNOR` per ogni round tool /
> prewarm / extract, enum come interi. M4: `sensorValid` senza EXTRA_PRESENT.
> M5: fit a due contesti conta UN compute e UN KV. M6/M7: rifiuto
> speculative/MTP senza FALLBACK; thermo invalido = throw del turno. M8: CI
> 33927024200 ROSSA (timeout Maven, non codice) → non è prova di build. M9:
> mock non resettati, casi d'errore scoperti. Puliti: sicurezza/privacy,
> unità e nomi campo Kotlin→JS→native, patch solo glue. Fix mandati a Luna
> (bf40dcfe) con decisioni prese (kv LFM dai log #63, non inventato; Unknown ⇒
> NoFit; una riga per turno a fine completeChat; enum come nomi; JSI thermo
> ritorna false, mai throw); poi delta audit grok. PREREG S5 in bozza su
> Luna (5fcd34c9) in `scratchpad/agents/qdc-governor-s5/`.

> **5/09 ~02:30 — PREREG S5 in bozza (Luna 5fcd34c9,
> `scratchpad/agents/qdc-governor-s5/`: PREREG 111 righe, d_run.sh 249,
> README-run 15).** Disegno: stessa board/APK/modello, ABABABAB, plateau turni
> 2-4; endpoint 1 = oracolo greedy (32 token ID identici A vs B), endpoint 2 =
> TTFT B/A ≤ 1/3 e decode B ≥ A da `KALSA_TELEMETRY`; secondari: riga
> `KALSA_GOVERNOR` (GPU/CPU, bench-skin), 0 FALLBACK, 0 lmkd, skin pre/post
> turno; thermo bench `plugged:false` + `t_idle_*` dal primo skin (B2).
> **PREREQUISITO APERTO:** l'app non ha una chiave bench per il sampling greedy
> né output dei token ID (`LlamaService.ts:3985` `top_k: 20,` fisso) → serve
> `kalsa.bench.sampling` (src/engine, piccolo) prima del lock; il driver esce 3
> finché non c'è. Da riempire al lock: sha APK, host QDC. Audit pre-run → deepseek.

> **5/09 ~03:00 — Audit pre-run S5 (deepseek, `qdc-governor-s5/AUDIT-PRERUN.md`):
> NO-GO, 2 blocker + 2 major + 6 minori.** B1: il driver non ha il macchinario
> dell'oracolo (atteso: prerequisito aperto) → **contratto definito da me**
> e scritto nel piano (Amendment 5/09): `kalsa.bench.sampling="greedy"` +
> riga `KALSA_BENCH_TOKENS {turnId,n,ids[32]}` per turno; il driver confronta
> le coppie A/B adiacenti, `n<32` ⇒ VOID. B2: `logcat -c` NON svuota il
> buffer `events` (provato nei raw #63: `am_kill` di 5 mesi prima) → ogni
> turno avrebbe contato ≥1 kill e abortito → `-b all -c` + ancora temporale +
> filtro sul pacchetto. M1: `pm uninstall || true` → install -r sopra dati
> vecchi. M2: `mWakefulness` mai letto. Budget: 25 min stimati su 45, zero
> slack → deadline interna 40 min. Fix mandati a Luna 5fcd34c9. L'app
> (`kalsa.bench.sampling`) si fa su una Luna fresca appena bf40dcfe finisce i
> fix S3+S4 (stesso LlamaService.ts, niente edit concorrenti).

> **5/09 ~03:40 — Fix S3+S4 consegnati da Luna (bf40dcfe) e verificati su
> disco.** Commit su `feat/governor-in-app`: `1c4b142` (probe SoC via
> `Build.SOC_MODEL` + `readSoc()`, Unknown ⇒ NoFit, **kv LFM misurato dai log
> #63: 104.00 MiB @ n_ctx 16384 = 6656 B/token** in `ModelRegistry.ts:311`,
> `sensor_valid` passa dalla sorgente, EXTRA_PRESENT, fit a due contesti con
> secondo compute+KV, test 12 GB Fit / 8 GB NoFit), `4df562d` (classificatore
> fallback per epoca di load, tail svuotato al dispose, UNA riga
> `KALSA_GOVERNOR` a fine completeChat, guard `engine === context` dopo
> l'await, `KALSA_NATIVE_VARIANT` con ngl per contesto), `2646e77` (JSI enum
> come nomi, `setGovernorThermo` ritorna false, FALLBACK stage params sul
> rifiuto speculative/MTP, profile_valid reale). Verificato da me: righe
> citate presenti, aritmetica kv corretta, patch 3491 righe solo glue. Jest
> 10/10, tsc 0, npm ci 0, clang syntax 0 (dichiarati da Luna). CI APK
> 33930036540 in volo. **Prerequisito S5 in corso** su Luna fresca (ee4741e9):
> `kalsa.bench.sampling` + `KALSA_BENCH_TOKENS`, in `src/engine` +
> eventuale estensione minima del patch per i token id. Poi UN delta audit
> grok su fix + contratto, poi APK e lock PREREG.

> **5/09 ~04:00 — Driver S5 corretto (Luna 5fcd34c9, commit 874e326b:
> PREREG 125 / d_run.sh 299 / README 16 righe)**: `logcat -b all -c` + ancora
> epoch dal device e conteggi solo dopo l'ancora (`-v epoch` verificato da
> me), lmkd filtrato su pacchetto/pid, oracolo per coppie A/B adiacenti con
> `ids_sha` e colonna `oracle` (PASS/FAIL/VOID), prerequisito verificato a
> runtime (riga `KALSA_BENCH_TOKENS` al turno 1, altrimenti exit 3),
> uninstall gated su `pm list packages`, `mWakefulness` letto e re-wake,
> deadline interna 40 min (exit 124), solo ABABABAB, `kalsa.bench.sampling`
> iniettato in entrambi i bracci. Delta audit → deepseek (706f8d2f, appende
> in AUDIT-PRERUN.md). CI APK 33930036540 (2646e77): completed failure.

> **5/09 ~04:20 — CI 33930036540 (2646e77) ROSSA per CODICE, non Maven.**
> (1) C++: `llama-governor-runtime.cpp:196` chiama il costruttore privato di
> `llama_governor` — la `friend` nel .h dichiara `llama_governor_init_with_params`,
> il chiamante è `..._internal`. Causa radice: Luna ha modificato i file
> governor DIRETTAMENTE nel vendor dell'app (b3a6137, 74390c5) invece che nel
> fork → `vendor/kalsallama-cpp/llama-governor.{h,cpp}` e `-runtime.cpp`
> DIVERGONO dal fork @8665e9a9f (verificato con diff -q). Il syntax check su
> Mac dichiarato da Luna non copriva questi file. **Regola (memoria):** il
> vendor non si edita mai a mano; si fixa nel fork, si bumpa il pin e si
> rigenera con `scripts/sync-kalsallama.sh`. (2) Kotlin:
> `GovernorBatteryModule.kt` importa `com.facebook.react.bridge.ReactPackage`
> (non esiste: è `com.facebook.react.ReactPackage`) → "overrides nothing" +
> mismatch in MainApplication; la CI precedente era morta su Maven prima di
> compilare Kotlin, quindi mai visto. Fix fork → Luna fresca nel worktree
> v03 (un commit sopra 8665e9a9f, build Mac + syntax); poi nell'app: pin bump
> + sync vendor + import Kotlin, dopo che ee4741e9 (sampling) ha finito.

> **5/09 ~04:45 — Delta audit driver S5 (deepseek): GO-WITH-FIXES, 0 blocker,
> 1 major, 4 minori.** B1/B2/M1/M2/budget/m1-m6 tutti FIXED o PARTIAL
> verificati riga per riga. Nuovo D1 (major): il poll telemetria esige n≥32
> token → una risposta greedy corta per EOS farebbe scadere i 600 s e
> abortire la sessione, mentre il contratto la vuole VOID-e-continua → poll
> su tokensPredicted≥1, n≥32 solo nell'oracolo. D2: dump logcat extra dopo il
> match telemetria (KALSA_BENCH_TOKENS arriva ms dopo). D3: `list_rc` sempre
> 0. D5: `governor_count==1` conterebbe anche il prewarm → seconda ancora al
> Send. Fix a Luna 5fcd34c9. Puliti: parse_tokens, quoting, 13 colonne TSV,
> evidenze prima di ogni exit.

> **5/09 ~05:00 — Fix nel fork consegnato (Luna a51f22b6): `e131345b7`
> "governor: expose init failure reason, fix friend/ctor access" sopra
> 8665e9a9f, un commit.** `llama_governor::failure_reason()`, friend corretta
> su `llama_governor_init_with_params_internal(..., std::string*)`
> (`src/llama-governor.h:29-34`, verificate da me). Build Mac 0, router test
> 0, syntax check Android 0. Branch `kalsa/governor-v0.3-on-12f6d9b6d`
> pushato su Aspis0/kalsallama (backup; la CI app compila dal vendor). Nota:
> le "174 differenze" vendor/fork sono la rinomina `lm_ggml_` del sync
> script, non divergenze; quelle vere erano i 3 file governor. Prossimo, nel
> worktree app appena ee4741e9 committa: pin → e131345b7, `sync-kalsallama.sh`,
> import `com.facebook.react.ReactPackage`, CI.

> **5/09 ~05:30 — Contratto sampling nell'app consegnato (Luna ee4741e9,
> `826fe50`, pushato)**: `src/engine/benchSampling.ts` 50 righe + test 69,
> riga `KALSA_BENCH_TOKENS {turnId,n,ids}` alle due uscite di completeChat
> (`LlamaService.ts:3250,3561`, verificato), id raccolti in greedy via
> `n_probs:1` e `generated_token_ids` (primi 32) esposti dal JSI nel patch
> (ora 3538 righe). Jest 5/5, tsc 0, npm ci 0, syntax 0 (dichiarati).
> Driver S5 D1-D5 fixati (7fe207ca): poll su tokensPredicted≥1, n≥32 solo
> nell'oracolo (VOID-e-continua), dump extra +2 s, `list_rc` reale, seconda
> ancora al Send. **In corso su ee4741e9:** pin → e131345b7 + sync vendor
> (prova: righe `failure_reason`/friend nel vendor, diff solo sui 3 file
> governor) + import `com.facebook.react.ReactPackage` + CI APK debug. Poi
> delta audit grok unico (fix S3+S4, contratto, vendor, Kotlin), poi lock
> PREREG con lo sha dell'artifact.

> **5/09 ~06:00 — Pin bump + Kotlin consegnati (ee4741e9): `04ba9a9` pin →
> e131345b7 con vendor rigenerato dal sync (diff: pin, VENDOR_SHA, build-info,
> llama-ext.h, llama-governor.h — runtime.cpp/governor.cpp del vendor già
> uguali al fork), `c5c55a4` import `com.facebook.react.ReactPackage`.**
> Verificato da me: pin, righe h nel vendor, import, origin = c5c55a4. Jest
> 15/15, tsc 0, npm ci 0, prebuild 0 (dichiarati). CI APK debug
> 33932740946 su c5c55a4 in volo. **Delta audit grok** (2f3f58ef) lanciato su
> tutto il delta: 16 finding S3+S4, contratto sampling (n_probs:1, ids,
> path non-greedy intatto), purezza del vendor vs fork e131345b7, Kotlin,
> CI. Appende in `docs/AUDIT-S3S4-governor-app.md`.

> **5/09 ~06:30 — Delta audit grok (appeso a `docs/AUDIT-S3S4-governor-app.md`):
> GO-WITH-FIXES, 0 blocker.** 16 finding: 12 FIXED, B2/M9/m1 PARTIAL, M8 (CI)
> e m5 NOT FIXED. B1 ricalcolato dall'auditor (104 MiB/16384 = 6656 ✓). Vendor
> = sync puro del fork e131345b7 (diff vuoto dopo rinomina lm_ggml_). Contratto
> sampling: path non-greedy byte-identico, riga solo dietro la chiave,
> `n_probs` letto DOPO il sampling (non cambia il token); **gli ids omettono
> l'EOS** (simmetrico, annotato nel PREREG). Residui accettati: commento
> stantio `LlamaService.ts:1608` "deviceTuning selects gpu-opencl" e
> `temperature > 0` in Kotlin (0.0 °C = invalido) → da piegare nel prossimo
> commit app, non bloccanti. Header fork `reload_budget_available=true` di
> default, JS manda false: coerente col piano. Gate per S5: CI 33932740946
> verde + JSON bench con t_idle_* (già nel driver). PREREG emendato pre-lock.

> **5/09 — CI 33932740946 su c5c55a4 VERDE: primo APK con governor + contratto
> bench compilato.** Artifact in `~/kalsa-qdc/apk/apk-gov-c5c55a4/`, sha
> `12ecb73145ca…3284`, 142,751,510 byte, `application-debuggable` ✓. **PREREG S5
> LOCKED** con identità APK; host QDC per sessione nei raw. Prossimo: sessione
> QDC `S5-QRD8650` (45 min), tunnel 6037, `d_run.sh <job> <apk> ABABABAB`.

> **5/09 (21:10 ora Mac) — S5 IN CORSO su QDC: sessione 799218 `S5-QRD8650`
> (45 min, SSH only, chiave kalsa-mac; il form richiede la SSH key, NON il
> pacchetto), job sa803287, tunnel 6037 pid in `~/kalsa-qdc/tunnel-799218.pid`,
> serial a652109b, skin 28.9 °C.** Primo lancio del driver morto al secondo:
> `line 90: name: unbound variable` — con `set -u`, `local a="$1" b="${a}"`
> espande `${a}` PRIMA dell'assegnazione (bash espande gli argomenti del
> builtin). Stesso pattern alla riga 272 (`prefix`/`logcat`). Fixati da me
> spezzando le `local` (urgenza: sessione a tempo; `bash -n` ok, raw del crash
> in `raw/sa803287-VOID-crash-line90/`); rilanciato 21:13. Lezione da memoria:
> `bash -n` non vede gli unbound di `set -u`; una prova a secco con `set -u` su
> funzioni con `local` multiple andava fatta nel pre-run audit.

> **5/09 (21:26 Mac) — S5 run 1 su sa803287: A1 OK, B1 FALLITO → sessione
> chiusa a ~17 min per non bruciare minuti.** A1: TTFT 42.7 s (include il
> prefill del system prompt), decode 24.3 tok/s, `KALSA_BENCH_TOKENS`
> presente (prerequisito verificato a runtime), 0 fallback, 0 lmkd. B1: il
> governor SI È ACCESO (due `loaded meta data`, `KALSA_NATIVE_VARIANT
> nGpuLayers {prefill:99, decode:0}`) ma il prewarm e ogni completion falliscono:
> `"Governor mode does not support MTP or speculative decoding"`. **Causa
> radice trovata:** `rn-completion.cpp:719-721 shouldUseMTP()` (e
> `rn-slot.cpp:335`) LANCIANO appena `hasGovernor()` è vero, a prescindere che
> MTP/speculative sia richiesto; viene chiamata a ogni completion → il
> governor non può mai generare. Bug introdotto in S2 (patch riga 1520),
> sfuggito a tre audit (nessuno ha tracciato il call-path). Fix: in modalità
> governor `shouldUseMTP()` ritorna false; il rifiuto resta solo all'init
> se speculative è richiesto esplicitamente. Nota a margine: al caricamento
> del secondo modello lmkd è andato in "critical pressure" e ha ucciso un
> servizio di sistema (non kalsa) → la modalità a due contesti su questa board
> è vicina al limite di RAM: da misurare nel run 2 (MemAvailable pre/post).
> Run 1 = VOID per la velocità, ma diagnosi bancabile. Raw in
> `raw/sa803287/`, crash del driver in `raw/sa803287-VOID-crash-line90/`.

> Sessione 799218 chiusa e verificata: "Completed", Ended On 09/04/26 9:27:07 PM
> (17 min). Tunnel chiuso. Fix `shouldUseMTP()` → Luna ee4741e9 (poi CI, poi
> run 2 su QRD8650 con MemAvailable pre/post per il dubbio lmkd). Lezione in
> memoria `audit-must-trace-call-paths-and-set-u`: ogni brief d'audit deve
> chiedere il call-path di ogni throw; ogni driver una prova a secco con set -u.

> **5/09 — Fix `shouldUseMTP()` consegnato (ee4741e9, `db1606c`, pushato):**
> `rn-completion.cpp:721` e `rn-slot.cpp:335` ora `return false` in modalità
> governor (verificato da me); i chiamanti prendono il decode semplice. Tabella
> dei throw gated da `hasGovernor()` rimasti: rn-llama.cpp 788 (draft MTP,
> init), 921/953 (LoRA), 972 (multimodal init), **1117 (`clearCache`, che
> l'app chiama a `LlamaService.ts:848` su hash-miss del prewarm da idle →
> potenziale throw in sessione normale)**, JSI 834. → Delta audit 2 a grok con
> tracciamento obbligatorio dei call-path fino all'app. CI 33936537090 in volo
> (waiter scarica l'APK in `~/kalsa-qdc/apk/apk-gov-db1606c/`). Driver: Luna
> 5fcd34c9 su `local`/set -u dry-run + MemAvailable + lmkd globali.

> **5/09 — Delta audit 2 (grok, db1606c): GO-WITH-FIXES per il run 2.** Fix
> MTP confermato con call-path completo: `createMTPDraftContext` è raggiungibile
> solo via `shouldUseMTP()`/`should_use_mtp()` (ora false) → irraggiungibile.
> Tabella dei 9 throw `hasGovernor()`: 7 UNREACHABLE (LoRA, multimodal
> mutuamente esclusivo con `governorLoad`, parallel, thermo inverso, session
> load su fresh install); **2 REACHABLE ma inghiottiti**: `clearCache`
> (hash-miss settings `:848`, translate `:3922`, completeOnce `:4034` — throw
> catturato, ma i KV NON vengono puliti: no-op silenzioso) e session save
> (`:2115`, persist in background dopo il turno, catch `:2234`). Nessuno dei
> due tocca il flusso S5 (fresh install → prewarm → un turno). **Follow-up
> obbligatorio dopo il run 2:** clearCache in governor = pulizia di ENTRAMBI i
> KV o reload CPU + riga FALLBACK; session save in governor = skip esplicito
> loggato. Una riga `KALSA_GOVERNOR` + una `KALSA_BENCH_TOKENS` per turno
> confermate (`:3247-3249`).

> **5/09 (22:18 Mac) — CI 33936537090 VERDE (45 min di build): APK db1606c in
> `~/kalsa-qdc/apk/apk-gov-db1606c/`, sha `dd77516a…2b6a`, debuggable ✓.**
> PREREG emendato pre-dati (run 1 VOID, identità APK run 2, driver 6bbb67b6).
> Apro la sessione QDC `S5-QRD8650-r2`.

> **5/09 (22:24 Mac) — S5 RUN 2 IN CORSO: sessione 799235 `S5-QRD8650-r2`
> (45 min, SSH only), job sa803304, tunnel 6037 (`~/kalsa-qdc/tunnel-799235.pid`),
> serial 7b5f6c52, APK db1606c, driver 6bbb67b6 (pid in
> `raw/driver-sa803304.pid`).** Watcher attivo; a fine run: End Session
> verificato, REPORT (Luna) → audit (deepseek) → ALIVE 48.

> 22:26 — Primo lancio run 2 morto in 30 s: board FRESCA senza app →
> `pm uninstall` = DELETE_FAILED_INTERNAL_ERROR (normale) e `grep -c` esce 1
> con zero match; il gate D3 di Luna esigeva `list_rc==0` e `uninstall_rc==0`
> → abort sul caso PULITO, e a cascata il check prerequisito scattava senza
> telemetria (exit 3 falso). Fix miei: gate = adb ok AND `package_count==0`;
> prerequisito solo se `telemetry_rc==0`; guardie `${var:-0}` sui conteggi.
> Raw del falso avvio in `raw/sa803304-VOID-gate-freshboard/`. Rilanciato 22:27.
> (Il dry-run di Luna non poteva vederlo: stubbava `pm list packages` con rc 0.)

> **5/09 (22:44 Mac) — S5 run 2 (sa803304): A1 OK (TTFT 45.9 s, 24.9 tok/s,
> `ids_sha` IDENTICO al run 1 → greedy deterministico tra sessioni), B1 =
> PRIMO TURNO GENERATO DAL GOVERNOR, e dice tre cose sbagliate:**
> `KALSA_GOVERNOR {engine_prefill:"CPU", engine_decode:"CPU", commit_bytes:0,
> commit_ms:0, thermal_state:"FAST", thermo_source:"bench-skin", fit:"Fit"}`;
> `KALSA_TELEMETRY tokensEvaluated 1329, promptMs 45154 (= CPU), tokensPredicted
> 0`; `KALSA_BENCH_TOKENS n=0`. Cioè: modello GPU caricato (OpenCL Adreno 750,
> 4612 MiB free, layer 0-26 su GPU, mlock fallito 223 MB = warning), ma il
> prefill è stato instradato sulla CPU con stato FAST e fit ok, nessun commit
> KV, e il decode ha prodotto zero token. Prewarm `done` con promptMs 0
> (sospetto: non ha valutato). RAM: MemAvailable 8.7 → 4.5 GB a due contesti
> (A: 8.8 → 6.4), nessun kill lmkd. Sessione 799235 chiusa (~24 min) per non
> bruciare minuti. Raw in `raw/sa803304/`. Diagnosi → Luna ee4741e9 (ha scritto
> il codice): tracciare la decisione di route del governor, il path del commit
> e perché la generazione termina a 0 token; poi audit grok.

> La cronaca integrale è in **PLAN-archive.md** (spostata verbatim il 20/08,
> niente è andato perso). Regola invariata: ogni verdetto nuovo si appende QUI;
> quando questa vista supera ~300 righe, si archivia di nuovo.

> I capitoli chiusi di agosto (fix Adreno "trans4", K2, qk23, sessioni #16/#18/#20,
> "LA SPIEGAZIONE SEMPLICE", TL;DR lanes 14/08, scheda prodotto, regole operative,
> telemetria §8) sono in **PLAN-archive.md → «Vista PLAN.md agosto (spostata 5/09)»**.


## Registro checkpoint

*(voci ≤ 2026-08-11 in `PLAN-archive.md` → «Registro checkpoint (archivio)»)*

- **2026-08-30 — #40 qdc-8elite-speed-kexp: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — decision table KEXP su Adreno 830 completa la serie
  generazionale.** Prereg `3af32c18` (locked pre-numeri). Sessione 792790,
  QRD8750/8 Elite (unit `41c5710f`, arch sun/SM8750, Android 16), modello
  Marco-Mini-Instruct-KEXP (qwen3moe 17.25B Q4_K 5.94GiB, sha verificato
  local==device), ABBA 4/4 exit 0, gate termico HAL vivo (≤44°C, status 0) su
  ogni invocazione. Mediane dei blocchi: **A(GPU ngl99) pp512 274.5, tg128 48.9;
  C(CPU ngl0) pp512 107.4, tg128 60.7**. Regola pre-scritta (mediana dei blocchi,
  soglia 5%): **GPU vince il prefill 2.56×, CPU vince il decode 1.24×** — entrambi
  ben oltre soglia. Serie ora completa e OGNI generazione dà verdetto diverso:
  740 CPU-sempre → 750 GPU-2.21×-prefill/pari-decode → 830 GPU-2.56×-prefill/
  CPU-1.24×-decode; ri-misurata per generazione, mai trasferita. È esattamente lo
  split per-fase che il governor (#38) sfrutta — tesi confermata anche sulla
  ricetta KEXP, non solo sull'LFM2.5 di ship. Onestà bancata: sessione 792778
  VOID (`/vendor/lib64` nel LD_LIBRARY_PATH bypassa il namespace sphal → driver
  Adreno fallisce il dlopen di libCB.so → fallback CPU SILENZIOSO etichettato
  OpenCL ngl99 con exit 0; numeri farlocchi = arm C vero, verificato) tenuta come
  exhibit; diagnosi iniziale sbagliata ("unità rotta") corretta a verbale.
  Evidenze scratchpad/agents/qdc-8elite-speed-kexp/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #41 qdc-8elite-governor-8b: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — il governor scala al modello 3× e il commit-tax SCENDE.**
  Prereg `166f9ccf` (locked pre-numeri). Sessione 793164, QRD8750/8 Elite (unit
  `b4bd0901` da adb devices, props sun/SM8750/Android 16), modello LFM2.5-8B-A1B
  Q4_K_M (arch lfm2moe, 5.15 GB, sha local==device), governor-bench 5c3979438
  (fail-fast anti-fallback), ordine A C C A G G, 6/6 exit 0, gate termico HAL
  vivo pre-invocazione tutti PASS (max 50.5°C/status 1), due cooldown da 1 min
  dopo eccursioni post-run a status 2 (47.1/47.5 al re-probe, archiviati).
  Mediane: **A ttft 2517.7/2518.8 ms decode 28.20/28.37 t/s; C ttft
  25122.6/26134.1 decode 13.95/13.46; G ttft 2495.8/2496.1 decode 13.32/13.33,
  commit 22.15/20.77 ms = 0.89%/0.83% del prefill** (banda pre-scritta "≤3%:
  scales cleanly"; riferimento #38 ~1.9% sul 2.6B → il commit cresce PIÙ LENTO
  del prefill: solo 6/24 blocchi attention, ~8.06 MiB/commit, primo turn
  staged-only 6.28 MiB). **G = WIN per la regola pre-scritta** (prefill: sotto
  entrambe le barre, perfino più veloce di A; decode ≥0.95×C in tutti i
  pairing, il più stretto 0.955). Co-headline vincolante: l'arm migliore in
  ASSOLUTO qui è A (decode 2.0–2.1× vs CPU a n_threads=1, caveat dichiarato) —
  con #38 (2.6B: G batte entrambi) e #40 (KEXP: CPU vince il decode) è la prova
  a tre punte che il routing va deciso per-device E per-modello; uno split
  fisso GPU-prefill/CPU-decode è sbagliato su questo 8B, e il meccanismo v0
  (commit sub-1%) è abbastanza economico da permettere QUALUNQUE scelta del
  router. Onestà bancata: citazione serial corretta dall'audit (non era nel
  getprop), rate upload 24.9 MB/s (non 23.8 decimali), re-probe termici e
  SHA256SUMS archiviati post-hoc con etichetta, "46.9" del primo draft era una
  trascrizione sbagliata (47.5 reale). governor-bench inghiotte il banner
  OpenCL → evidenza GPU via fail-fast strutturale + probe llama-bench dedicato
  (selected platform QUALCOMM/Adreno 830) + split 10× dei numeri. Evidenze
  scratchpad/agents/qdc-8elite-governor-8b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #42 qdc-8elite-vl3b: BANCATA (audit GLM fresco FIX → APPLY
  al re-audit) — il primo VLM della campagna, e la decision table guadagna la
  terza fase.** Prereg `6642824d` + AMENDMENT-1 pre-misura `20f2a259` (kit
  556118a08 = 5c3979438 + patch timing mtmd-cli; --ignore-eos; metriche
  esatte). Sessione 793229, unit `eb49fb9d` (serial NEL provenance — lezione
  #41), LFM2.5-VL-3B ufficiale LiquidAI (backbone = LFM2.5-2.6B di ship +
  SigLIP2 NaFlex 400M; gguf Q4_K_M + mmproj Q8_0, sha local==device==
  pubblicati), immagine sintetica deterministica sha 55e455a2. Ordine
  C A M / M A C / A M C, 9/9 exit 0, gate termico HAL 18/18 PASS (max 46.5°C
  status 0 — il VLM single-turn è termicamente mite). Mediane: **C enc 3915 ms
  / prefill 5752.8 / 29.07 t/s; A enc 6549 / 1445.6 / 22.64; M enc 3927 /
  1436.2 / 22.68**. Regola pre-scritta (mediane di 3, ≥5%): **encode → CPU
  (tie C/M 0.31%; la GPU perde 1.67× — il warmup elenca le op CLIP che
  OpenCL non supporta: UPSCALE/SOFT_MAX/CONT/PERMUTE/RESHAPE/MUL_MAT f32,
  bersaglio kernel concreto se mai servirà la visione GPU); prefill → GPU
  4.0× (tie A/M 0.65%); decode → CPU 1.28×**. End-to-end (REPORT-only):
  M miglior arm statico 11008 ms; composizione per-fase ipotetica
  CPU-enc+GPU-prefill+CPU-dec = 9755 ms = 1.13× sul migliore, 1.40×/1.44×
  sui puri — nessun arm statico può eseguirla: è la tesi del governor estesa
  alla terza fase, QUARTO punto dati del routing per-device/per-modello/
  per-fase (#38 G vince sul 2.6B; #40 KEXP split; #41 8B tutto-GPU; #42 VL
  three-way). Determinismo: 9/9 byte-identici intra-arm (regola di estrazione
  archiviata, hash riprodotti indipendentemente dall'auditor). Onestà bancata:
  il banner OpenCL richiesto dal prereg è filtrato dal logger di mtmd-cli
  (stesso meccanismo #41) → deviazione dichiarata, evidenza sostitutiva:
  A = 45 righe warmup backend=OpenCL in-run (prova diretta), M = SOLO
  comportamentale+probe (il primo draft diceva "A/M" — falso, beccato
  dall'audit e corretto); hash del primo draft non riproducibili → regola
  archiviata e rigenerati; A NON rilabellata "degraded" con motivazione a
  verbale (fallback op-level gridato ≠ fallback silenzioso totale della
  clausola). Actionable di prodotto: sul VL il decode CPU (29 t/s) supera il
  20 t/s di riferimento Liquid su SM8850. Evidenze
  scratchpad/agents/qdc-8elite-vl3b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-31 — #43 qdc-8elite-npu-v79: BANCATA (audit GLM fresco #8 FIX →
  APPLY al re-audit) — NPU v79 day-0: il lane esiste, e sul modello di ship
  il prefill NPU è 7.2× la CPU.** Prereg `5606d929` (lock 12h prima della
  prima misura, verificato via git dall'auditor). Sessione 793389 (coda
  11.5h su pool Unavailable — record; il login web QDC del browser headless
  si è rotto per tutta la mattina: host Connect relayato dall'owner, ops
  note). Unit `2a38935c` (sun/SM8750/Android 16 userdebug). Kit
  npu-kit-556118a08 buildato NEL CONTAINER UFFICIALE (ghcr.io/
  snapdragon-toolchain, NDK r28b + Hexagon SDK 6.6.0.0, niente login/PC —
  via indicata dall'owner; race dei 4 skel paralleli aggirata con build
  seriale). **Q1 INIT-OK**: `Hexagon Arch version v79`, sessione cDSP
  unsigned-PD, hwinfo 6 HVX + HMX + 8MB VTCM — skel nostro servito al primo
  colpo. **Q2 = "v79 defect list started"** (regola prereg applicata alla
  lettera): MUL_MAT 472/542 (70 FAIL), MUL_MAT_ID 0/301; MA il censimento
  COMPLETO dell'auditor (362/362 righe diagnostiche, zero inversioni) mostra
  HTP0 sempre finito e giudice CPU sempre nan/±inf, e il control GPUOpenCL
  contro lo STESSO giudice passa 407/407 → giudice avvelenato SOLO in
  accoppiata HTP (classe del NaN-judge Adreno già bancato); restano VERI:
  36 dspcall INTERNAL-ERROR (29 su m=16 n=4..8, 7 fuori incluso
  m=576×512×576) e 7 FAIL senza diagnostico (incluso q4_0 m=1,n=2048) non
  caratterizzati. **Q3 esplorativo, N C C N 4/4 exit 0, modello di ship**:
  N pp512 1500.4/1524.1 tg 22.6/24.3; C pp512 212.0/210.2 tg 38.6/38.4 →
  mediane N 1512.2/23.47, C 211.1/38.49 = **prefill NPU 7.2×, decode CPU
  1.64×** (flag della ricetta upstream, dichiarati NON comparabili con
  #38/#41; nessun verdetto di routing — semina la colonna NPU della
  decision table 2.6B/830). Q4: smoke reasoning-trace-only (NESSUN braccio
  ha emesso risposta finale a -n 64 — relabel imposto dall'audit), lingua
  coerente e lista pianeti corretta nel thinking N. Onestà bancata:
  deviazione binding sul gate termico CLI (gate stantio 10 min, nessun gate
  pre-C, mitigante post 48°C); "well under gate" ritrattato (pre_N2 57.6;
  post-C 61.5/63.0 = SOPRA soglia IN esecuzione — il braccio CPU si
  autoscalda oltre il gate anche qui); SHA256SUMS self-hash provato
  matematicamente (voce = sha256 della stringa vuota); primo commit di fix
  errato (solo artefatti) dichiarato e amendato. Evidenze
  scratchpad/agents/qdc-8elite-npu-v79/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #39 qdc-8elite-opencl-e031: BANCATA (audit GLM ostile FIX →
  APPLY al re-audit) — i kernel MoE q2/q3 sono CORRETTI su Adreno 830, terza
  generazione GPU/compiler, al primo run.** Prereg `e14b7fe1` (locked pre-numeri:
  commit 14:44, raw mtimes 17:16-17:22; la riga "locked at e68414a9" del prereg
  nomina il commit BASE). Kit bin-gov-5c3979438-stripped su QRD8750, Android 16,
  driver OpenCL 0800.70 Compiler E031.47.18.47. test-backend-ops: **MUL_MAT
  925/925 eseguiti OK, 0 FAIL, 545 skip** (925+545=1470 righe per-caso);
  **MUL_MAT_ID 407/407 eseguiti OK, 0 FAIL, 405 skip** (407+405=812) — conteggi
  riprodotti indipendentemente dall'auditor. Claim RISTRETTA dall'audit: i
  q2_K/q3_K su MUL_MAT semplice NON sono MAI stati eseguiti (26/26 "not
  supported" — il backend li declina per capability); sul path MoE (MUL_MAT_ID,
  i nostri kernel 8x4) 10/14 casi eseguiti e TUTTI OK — tutte le shape
  realistiche (m=64/96/512, n_mats=4, n=1..32); i 4 skip sono shape piccole
  dichiarate non supportate (m=8 n_mats=3, m=16 n_mats=5). La claim bancabile:
  corretti sull'830 per ogni shape che accettano. Onestà bancata: primo
  tentativo VACUO con `-b OpenCL` (il backend si registra come **GPUOpenCL**;
  12 righe di Skipping + OK verde) tenuto in raw/ come negative exhibit per
  ENTRAMBI gli op; il "pre 37.3/32.4 °C" di una bozza è RITRATTATO
  (mis-trascrizione, nessun artefatto lo contiene); snapshot termici pre-run
  non catturati (deviazione procedurale dichiarata — correttezza non
  clock-sensitive, Thermal Status 0 a verbale in entrambi i post); exit code
  non preservati come artefatti (evidenza di completamento = firma completa
  per-caso + summary + backend OK). Evidenze
  scratchpad/agents/qdc-8elite-opencl-e031/ (PREREG/REPORT/AUDIT/raw).
- **2026-08-29 — #38 qdc-8elite-governor-crossbackend: BANCATA — il governor v0
  VINCE su 8 Elite.** Prereg `ddddf077` (locked pre-numeri) + AMENDMENT-1 `28a6c934`
  (scritto PRIMA della riesecuzione: il gate termico del run 1 leggeva il gruppo
  sensori `Cached` CONGELATO di dumpsys thermalservice — run 1 VOID per i tempi, la
  correttezza resta; il gruppo vivo è `Current temperatures from HAL:` + `Thermal
  Status`). Esecuzione orchestratore, sessione 788862 (QRD8750/Adreno 830, ~75 min),
  engine `kalsa/governor-v0` @ 5c3979438, modello di SHIP LFM2.5-2.6B QAD-Q4_0,
  ABBA 2 blocchi, r=3, cooldown ≤60 °C + status ≤1 prima di OGNI run. Mediane:
  A(GPU) ttft 1395/1394 ms, dec 23.7/23.8; C(CPU) ttft 16476/14412 ms, dec
  21.6/23.3; **G ttft 1434/1470 ms, dec 25.3/24.2, commit 26/29 ms = 1.80%/1.98%
  del prefill**. Regola pre-scritta: G PASSA tutte e tre le condizioni in ENTRAMBI
  i blocchi (TTFT ~10× meglio di C e entro 3-5% di A; decode ≥ C; commit <2%).
  Onestà bancata: il 2% passa per 0.02 punti nel blocco 2 ed è prompt-length-
  dependent (costo commit quasi fisso 11.2 MB/turno); parte del vantaggio decode di
  G è TERMICO (C si scalda da solo a 90-93 °C col proprio prefill CPU, G arriva al
  decode più fresco — effetto reale del design ma non velocità kernel); r=3, un
  device, niente 740/battery/app/KEXP. Correttezza cross-backend: test-governor-
  v0-devices PASS su GPU+CPU reali (prefill_splits=2, naive+staged entrambi
  esercitati). Evidence `scratchpad/agents/qdc-8elite-governor-crossbackend/`.

- **2026-08-28 (sera) — #37 qdc-8elite-cpu-day0: BANK-WITH-ERRATA — prima cella
  QDC, primo dato 8xx.** Prereg `f72b1b20` (locked pre-numeri), esecuzione grok su
  sessione interattiva QDC (8 Elite QRD8750 "Sun"/Oryon, Android 16, adb via tunnel
  SSH porta locale 6037 — server adb locale/Jelly mai toccato), audit ostile GLM
  `qdc-day0-bank-audit/REPORT.md`, spot-check orchestratore (righe cert, mediana t8
  tg128 ri-derivata dai 3 avg_ts, skip-record, battery stub). BANCATO: (a)
  correttezza CPU kit `a0cabca6b`: **MUL_MAT 1144/1144** (cert_mm_cpu.out:1477) +
  **MUL_MAT_ID 812/812** (cert_mmid.out:819) con `-b CPU` — il tentativo senza `-b`
  era uno skip vacuo e NON è stato contato (gestione onesta, audit-CONFIRMED); (b)
  speed OLMoE Q4_K_M (4213513024 B, sha verificata): tg128 -t8 **59.095**, pp512
  **92.996**, -t6 **52.504 / 75.514** (mediane per-invocazione, aggregatore
  conservativo ma non pre-reggato — erratum 1). PLUGGED DECLARED (e il battery
  service del rack è CONGELATO: stub 43.0 °C — erratum 3; termica vera da
  thermalservice HAL: CPU 39.6→53.8 °C, status 0→1, drift monotono −8.6% worst =
  numeri mid-ramp, erratum 2). Comparator #20 (S23 CPU tg128 27.685 unplugged,
  no_repack diverso): **~2.1× device-class**, non A/B controllato (erratum 5).
  Costo 20 min / 996. Conseguenza piano: il dato-CPU degli 8xx alza l'asticella di
  ogni investimento kernel HVX/GPU su quella classe; in coda Marco-KEXP (#18) e
  kit GGML_OPENCL=ON per la colonna E031 su Adreno 830. Evidenza
  `scratchpad/agents/qdc-8elite-cpu-day0/` + `qdc-day0-bank-audit/`.

- **2026-08-28 — #36 s23-unplugged-baseline-night0: BANK-WITH-ERRATA
  (correttezza-only).** Prereg `ecd3e983`, Amendment-1 `f90a1d5e`, audit ostile
  GLM `night0-bank-audit/REPORT.md`, verifiche orchestratore su disco. BANCATO:
  correttezza s3oracle su S23 **UNPLUGGED** — MUL_MAT_ID 407/407
  (`raw/cert_mmid.out:815`), MUL_MAT 925/925 (`raw/cert_mm.out:1473`), pin set
  11/11 verbatim, ac:false provato nei battery.pre. **NESSUN numero di velocità**:
  tre tentativi, tre morti diverse — (1) plateau 38.8–39.0 °C ×2h da sveglio
  (gate 32 irraggiungibile), (2) drain reale 13–15 %/h ≫ premessa 7.5 dell'
  Amendment-1 (blocco aritmeticamente infinibile dal 46 %), (3) transport adb
  morto ~20 s dentro la run A (refused, 10 min di retry). ERRATA (6 voci in
  `ERRATA.md`): premessa drain REFUTED, possibile jsonl orfano ON-DEVICE da
  tirare giù al replug (TODO), migrazione porta :36329→:37687 non coperta dal
  prereg, identità device asserita nei raw, gate 36.0 a margine zero, evidenza
  committata solo al bank (questo commit). Conseguenza: matrice speed unplugged
  MORTA per la trasferta → QDC 8 Elite (operativo da oggi: 1000 min su QRD8750,
  adb-via-SSH + exec binari PASS) e/o S23 plugged/USB. Bonus piattaforma:
  kalsallama su macOS/aarch64 10/10 test (incl. 6× test-repack-q23k) — prima
  piattaforma kernel-test fuori da Windows. Evidenza
  `scratchpad/agents/s23-unplugged-baseline-night0/` + `night0-bank-audit/`.

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
