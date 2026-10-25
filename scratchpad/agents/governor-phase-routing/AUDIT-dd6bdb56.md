# AUDIT — design doc `governor-phase-routing/DESIGN.md` @ `f762a82e` (read-only, critique only)

Verificato: engine `kalsallama-wt-oom` @ f25f0c1c5, binding `llama.rn-kalsa` @ 88b2b57e, app `kalsa-wt-iroh` @ 2fe5a12d, più i file di risultato citati. Nessun telefono, nessuna patch.

**Verdetto di sintesi.** Il doc è solido nella citazione delle fonti e onesto sui limiti — cinque riferimenti a linee di log di byte sono esatti al carattere, e le citazioni testuali (politica termica, prezzi di memoria, `"Deferred: v0.2 never selects this lane"`, `"decode engine change requires a full context reload"`) sono **verbatim**. Ma sbaglia dove conta: **due dei tre numeri che finirebbero nell'asset spedito sono errati** (il `tok_s` di decode è repack-assisted; i tre `tok_s` di prefill sono 10× la formula che il doc stesso dichiara), e il **numerone di memoria è la somma con-repack mentre la fonte che il doc cita prezza la lane dell'S23 8 GB a 2998.06 MiB**. Aggiungo che la "missing measurement" proposta non può decidere la domanda di fattibilità, perché è una misura a un contesto e la fattibilità è di una sessione a due.

---

## 1. Claim di codice verificate riga per riga

**CONFERMATI** (numeri di riga quasi tutti esatti):

| claim del doc | riga letta | esito |
|---|---|---|
| due contesti, KV indipendenti | `llama-governor.cpp:35` `throw … "governor contexts must have independent KV caches"`; `:38`/`:42` `llama_init_from_model(model_prefill/decode, …)` | CONFIRMED (il doc dice :34-36/:38-47) |
| `phase` a `:65`, `prefill_route` a `:68` | `llama-governor.h:65` `enum class phase { None, Prefill, Decode };`, `:68` `enum class prefill_route { Undecided, GPU, CPU };` | CONFIRMED, esatte |
| prefill ⇔ `n_tokens > 1` | `llama-governor.cpp:254` `const bool is_prefill = batch.n_tokens > 1;` | CONFIRMED, esatta |
| selezione del contesto per fase | `llama-governor.cpp:270` `llama_context * target = cpu_prefill ? ctx_decode : (is_prefill ? ctx_prefill : ctx_decode);` | CONFIRMED (la parte "ngl 99 / ngl 0" però è del binding, non di questo file) |
| `commit_side` per cambio fase | `llama-governor.cpp:283-293`; catch-up CPU-route `:303-312` | CONFIRMED |
| termica 43/42.5/44 | `llama-governor-policy.cpp:15-17` `k_warn_c = 43.0f; k_limit_c = k_warn_c - 0.5f; k_kill_c = 44.0f;` | CONFIRMED (esatte) |
| tabella 128/512/1024/2048 e delta 1.9/3.25/3.25/5.15 | `:19-20` `k_table_tokens[]`, `k_cpu_delta_c[]` | CONFIRMED (esatte) |
| "unmeasured defaults (40051f8ae) applied to CPU and GPU prefill alike" | `:262-263` (il doc dice :260-262) | CONFIRMED verbatim |
| admission `now_c + delta ≤ k_limit_c`, floor sotto 43 °C | `:266-271` | CONFIRMED |
| safety→CPU, override CPU, override GPU condizionato a `gpu_fit==Fit` | `:185-188`, `:194-199`, `:200-206` | CONFIRMED (esatte) |
| regola misurata V73/V75/V79 + ALIVE #38 | `:213-219`, citazione ALIVE a `:210-211` | CONFIRMED (start :213, il doc dice :214) |
| **nessun ramo NPU in `prefill_engine`** | `:174-225` intera funzione, nessun `NPU` | CONFIRMED — claim più forte di quanto il doc dica (vedi N-D8) |
| `select_decode` `:322-350` | `:322` firma, `:350` fine; `:337-341` `if (!eligible) { last_decode_engine_ = CPU; return result; }` | CONFIRMED |
| pause = −2 con warn, mai failure | `llama-governor-runtime.cpp:84-88` | CONFIRMED |
| `requires_reload` → −2, stringa citata | `:188-190` `LLAMA_LOG_INFO("%s: decode engine change requires a full context reload\n", __func__); return -2;` | CONFIRMED verbatim |
| `NPU, // Deferred: v0.2 never selects this lane` | `llama-ext.h:193` (il doc dice :194) | CONFIRMED, riga sbagliata di uno |
| route query ibrido→MirrorAndCopy, Direct solo con celle condivise | `llama-kv-commit.cpp:290-313`, `:302-304`, `:305-312` | CONFIRMED |
| `trim_sequence` azzera un lato per intero | `llama-governor.cpp:215-224` | CONFIRMED |
| test: ledger con `npu_lane_enabled`→CPU + cap 512 | `tests/test-governor-v02-router.cpp:49-53` (il doc dice :37-48) | CONFIRMED contenuto, riga sbagliata |
| test: NPU admission stampato | `:50-53` — **con `decision == CPUFallback`** | CONFIRMED, e incompleto (N-D8) |
| LOWBAT→CPU / plugged→GPU | `:61-97` (il doc dice :56-82) | CONFIRMED contenuto |
| "nessun test esercita HTP come context device" | tutto il file: NPU compare solo come engine *richiesto* | CONFIRMED |
| binding: prefill ngl 99 / decode ngl 0, nessuna selezione device per lane | `rn-llama.cpp:77-78`, entrambe da `owner.params` a `:75-76`, `n_parallel = 1` a `:79-80` | CONFIRMED |
| binding: **drop del repack sul decode e ~1.4× sul decode CPU** | `rn-llama.cpp:81-93`, in particolare `:91-93` `if (!load_options.decode_repack) { decode_params.no_extra_bufts = true; }` preceduto dal commento "Only the 8 GB S23 shape needs the second copy dropped … decode then pays the ~1.4x CPU decode cost" | CONFIRMED — e questo è il nocciolo di §2 del doc |
| binding: due `common_init_from_params` | `:112` e `:121` | CONFIRMED |
| app: repack ~1511 MiB | `governorInputs.ts:87-91` | CONFIRMED verbatim |
| app: **"P1 … costs ~1.41x lane decode … 8 GB S23: 4358.70 MiB required with repack vs 2998.06 without"** | `governorInputs.ts:166-169` | CONFIRMED verbatim — e questa riga è la correzione di §2 |
| app: `npu_lane_enabled: false` | `governorInputs.ts:207` | CONFIRMED esatta |
| app: mmproj disabilita il governor | `LlamaService.ts:2439` `!options.mmprojPath &&` | CONFIRMED esatta |
| app: V75 oracle ancora FAIL su R2 | `governorInputs.ts:17-21` | CONFIRMED verbatim |
| skel HTP packaged | `android/build.gradle:19-20` `htpLibSourceDir = bin/arm64-v8a`; 4 `libggml-htp*` presenti | CONFIRMED |
| §2 "Già funzionante: OpenCL prefill + CPU decode" | `rn-llama.cpp:77-78` + `llama-governor.cpp:270` | CONFIRMED |

**Numeri (§2, §3, §5) — tracciati tutti a file di risultato.** `s23-3way-6/results.tsv` contiene esattamente le sei righe citate (19026.97/10389.45 e 21.15/21.12; 7347.20/7326.37 e 11.26/11.10; 1668.22/1558.10 e 13.01/12.91; prompt_n 1010, decode_runs 126; proof `off=0/31`, `62 assigns, 15 kernels, off=31/31`, `htp_ops=1398 arch=v73 off=31/31`) — **CONFIRMED, e i cinque riferimenti di riga nei `*.load.log` sono tutti esatti al carattere** (t1cpu:7028-7029, t3npu:12289-12290, t2gpu:1771-1773, t3npu:10925-10926, t3npu:12609). Somme derivate corrette: 1730.95 vs 1717.36 (+13.6), 548.03 vs 658.04 (−110), 4.4–4.7×, 6–12× — **tutto CONFIRMED**. Anche i numeri DSpark di §5.5 sono tracciati: `spec-dspark-gpu-draft/raw/s23-dspark-5/results.tsv` esiste e le righe `final=matched` danno A0-m1 23.63, A0b-m1 23.50, B4-m1 21.137, C4-m1 9.511 — **CONFIRMED**, con la nota che la riga di probe `A0 24.52 final=superseded` è l'unica che si legge per prima e che i numeri citati sono quelli dei *matched* (il doc ha ragione a citarli così, ma un lettore che prende la prima riga per tag sbaglia).

## 2. Il claim di memoria — CONFIRMED che è la somma sbagliata, la conclusione giusta

Il doc scrive che la sessione HTP-prefill "stays near the existing **~4.4–4.7 GiB** two-copy footprint (simple sum of the buffers above; not a device measurement)" e mette nel §2 la citazione `governorInputs.ts:168-169` sulla stessa pagina. Sono due numeri incompatibili e il doc non li riconcilia.

La mia ricostruzione, con la stessa fonte:
- la somma del doc è **with-repack**: 1717.27 (modello CPU dal `t1cpu.load.log`) + 1730.95 (modello HTP dal `t3npu.load.log`) = 3448.22 MiB di pesi, più 1076.06 di compute e 64 di KV ⇒ ~4.48 GiB;
- ma sull'S23 8 GB la lane **perde** la copia di repack del modello decode (`rn-llama.cpp:91-93`, `governorInputs.ts:166-169`), e l'app prezza quella lane a **2998.06 MiB**;
- rifacendo la somma senza repack: pesi 206.07 (decode) + 1730.95 (prefill HTP) = 1938.01, compute 1076.06, KV 64 ⇒ **≈3078 MiB**; la lane OpenCL senza repack: 206.07 + 1717.36 = 1923.43 + 1140.04 ⇒ **≈3063 MiB**.

Quindi: **"memory-neutral" CONFIRMED e quantificato (+15 MiB), ma il numero del doc è ~1.5× troppo alto e descrive una configurazione che l'S23 8 GB non usa.**

**N-D1 — CONFIRMED / HIGH — il `tok_s` di decode nella tabella proposta è il numero repack-assisted.**
La tabella del §4 mette `"decode": {"rank": ["CPU"], "entries": [{ "engine": "CPU", "tok_s": 21.1, …}]}`. I 21.15/21.12 tok/s vengono dal **braccio CPU del CLI**, e la sua stessa fingerprint lo dichiara: `results.tsv` riga 1 `fp=buf=CPU,CPU_REPACK` — cioè il modello **aveva** la copia di repack (1511.20 MiB, `t1cpu.load.log:7029`). Nella lane governor sull'S23 8 GB quella copia non c'è, e le due fonti che il doc cita dicono entrambe quanto costa: "~1.4x CPU decode cost" (`rn-llama.cpp:85-86`) e "costs ~1.41x lane decode" (`governorInputs.ts:167`). ⇒ **21.1 / 1.41 ≈ 15.0 tok/s**, non 21.1. La *direzione* del design sopravvive (15.0 > HTP 13.0 > OpenCL 11.3), ma il numero che verrebbe persistito è quello di una configurazione che la lane non usa — ed è l'unico numero di decode nella tabella, cioè quello su cui la selezione deciderebbe.

**N-D2 — CONFIRMED / HIGH — i tre `tok_s` di prefill nella tabella sono 10× la normalizzazione che il doc stesso dichiara.**
Il doc scrive "`tok_s` normalized per phase (prefill = 1000/prefill_ms)" e poi mette `HTP0: 6.0`, `GPUOpenCL: 1.4`, `CPU: 0.05`. Dai numeri della tabella §2: 1000/1668.22 = **0.5995**, 1000/7347.20 = **0.1361**, 1000/19026.97 = **0.0526**. Le tre voci sono esattamente 10× la formula dichiarata (0.05 è 0.0526 troncato, quindi anche il CPU è 10×). Il **ranking** è indenne (errore uniforme), ma sono valori assoluti sbagliati in un asset progettato per essere spedito e letto da un selettore: un future refactor che confronti un `tok_s` assoluto contro una soglia (es. "speed floor accettabile all'utente", `GOVERNOR-DEVICE-PLAN.md:322-325`) ordinerebbe gli engine con un errore di 10×.

**N-D3 — CONFIRMED / MEDIUM — la riap-derivazione `htp_ops=1398` su 5 token non è annotata, ed è un regime di dispatch diverso da tutti i priori del repo.**
`results.tsv` riga 3: `htp_ops=1398`, `min=699`, `tokens=5` ⇒ **279.6 ops/token**, contro il prior più alto mai osservato (20.2, `q51-f2b-v73-guard/REPORT.md:33-36`) e contro la soglia A6 della cella 3-way costruita su "≈30 per layer". Il pin di calibrazione conferma: `COORDINATOR-STATE.md:132` "Calib pin 139.8 ops/tok (raw proof)" — quasi al fondo della banda [0.5, 25] sul floor. Il doc riproduce `htp_ops=1398` come prova senza dire che la board è 14× sopra i priori: chi erediterà la soglia deve saperlo.

## 3. Le altre claim di codice da correggere

**N-D4 — CONFIRMED / MEDIUM — REFUTED: "The app confirms the shape: `nGpuLayers: { prefill: 99, decode: 0 }` (`src/engine/LlamaService.ts:2692-2700`)".**
Le righe 2692-2700 di `LlamaService.ts` contengono il logging di `KALSA_NATIVE_VARIANT` (quale `.so` è stato caricato, `_opencl` incluso) — non quella struttura. E nel repo **non esiste** un oggetto per-lane: `grep nGpuLayers src/` nell'app dà solo `benchConfig.ts:35,144,148,158,299`, uno **scalare** opzionale per gli A/B di bench (`kalsa.bench.engine`), non `{prefill, decode}`. Lo split per lane è **solo** del binding (`rn-llama.cpp:77-78`). L'evidenza che il doc usa è quindi sbagliata, e la lacuna reale è *più grande* di quanto dica: l'app non ha alcuna superficie di controllo per-lane.

**N-D5 — CONFIRMED / MEDIUM — REFUTED: "the engine's `llama_governor_params` gains the per-phase engine rank/deltas already implied by its schema (generation/model_kind/gpu_fit/npu_fit fields, `src/llama-ext.h:234-253`)" (e la riga è anche sbagliata: lo struct è a `:242-255`).**
Quei campi descrivono **dispositivo e modello** (`generation`, `model_kind`, `gpu_fit`, `npu_fit`, `htp_trunk_readable`, `npu_lane_enabled`…); nel struct **non c'è** nessun campo per un rank per fase né per i delta di admission, che oggi sono una tabella compilata nel policy (`k_cpu_delta_c`). Aggiungerli è un **`schema_version` bump** (oggi 3 / capability 2) e uno spostamento di **autorità**: le delta di admission cessano di essere invarianti del policy e diventano dato applicativo. Non è "plumbing". Aggiungo che il *mechanical check* del device plan che il doc adotta come fondamento di §4 ("`grep` for `generation` in the policy files returns zero hits outside telemetry", `GOVERNOR-DEVICE-PLAN.md:64-66`) **oggi fallisce**: il policy ha cinque siti `params_.generation` (`:213-215`, `:220`, `:334-335`) più la lista duplicata in app (`governorInputs.ts:203-205`). Il doc elenca i tre cambi *nuovi* e non le cinque violazioni Rule 1 già esistenti, che sono il lavoro più grosso della migrazione.

**N-D6 — CONFIRMED / MEDIUM — il verdetto di fattibilità omette la via di fallenza dura.**
`llama-governor.cpp:48-56`: il costruttore chiama `llama_kv_route_query(ctx_decode, ctx_prefill)` e **su `Reject` libera entrambi i contesti e li porta a nullptr**. Quindi una cache non instradabile non è un fallback: è il governor che non si costruisce. Il doc dice (§2 KV handoff) che "compatibility has never been exercised with an HTP side" ma non che la conseguenza è un fallimento di costruzione. Nota: `llama_kv_commit_access::compatible` (`llama-kv-commit.cpp:12-25`) è **molto più severo** di "mismatched memory kinds" — richiede `cache_type_k/v`, size, `n_seq_max`, `n_stream`, `n_pad`, `n_swa`, `swa_type`, `v_trans`, `n_layer_all`, `layers.size` e **per ogni layer** `il` e le shape di K/V. Questo **rafforza** l'INFERRED del doc su `-nkvo` (con l'attenzione su host, tipi e shape coincidono) ma per una via tracciabile invece che per un "non l'ho tracciato" — esattamente il tipo di sostituzione che il doc chiede a se stesso nelle citazioni.

**N-D7 — CONFIRMED / MEDIUM — la "missing measurement" non può decidere la domanda di fattibilità.**
Il loop proposto (`DESIGN.md` §3, "Minimal next measurement") gira i *bracci CLI* della cella 3-way: un contesto per run, 1010 token di prompt + 126 decode forzati. Quindi:
- **non esercita mai `commit_side`**: il costo di handoff KV HTP↔CPU, che il doc stesso chiama "load-bearing" e "never run", è per definizione assente da un protocollo a un solo contesto. Il deliverable (`heat_per_1k_c` + `tok_s_at_steady`) riempirà la riga heat della tabella — che è la *terza* domanda, non la prima;
- il carico è **89% prefill** (1010 su 1136 token): la riga `decode` verrebbe riempita da un workload in cui il decode è l'11% del lavoro, che non è un turno di chat;
- la **correttezza al livello dei logit** resta fuori (nessun logit nel protocollo) — il doc lo ammette in §5.1, ma allora la tabella può comunque dire `"engine": "HTP0", "correct": "bench"`: il campo `correct` **non è un input che il policy legge** (`llama_governor_params` non ha un campo di correttezza), quindi il fail-safe della correttezza è oggi implicito (l'asset non esiste ⇒ CPU) e dopo la migrazione va reso esplicito come un gate, non come un campo decorativo;
- "l'app oggi non gira mai HTP" è **CONFIRMED** e stronger di quanto scritto: non esiste alcuna run in-app con `-dev HTP0` (nessun `s2*/` con `HTP0` in `qdc-8elite-newapk/raw/`), quindi tutta l'evidenza HTP è **CLI** — e vedi N-D10 sul tasso di attenuazione.

**N-D8 — CONFIRMED / LOW — due gloss sulla select_decode e sull'NPU.**
(i) "a V73+MoE COOLMODE lane passes six gates" : in `select_decode` **non esiste alcuna condizione `model_kind == MoE`** (MoE compare solo in `prefill_engine:220`), e l'espressione `eligible` ha **nove** condizioni (`policy:334-336`), non sei.
(ii) Il punto (b) della fattibilità ("the policy's NPU lane must be reachable") sottostima: `admit_prefill` stampa l'engine richiesto (`policy:308-309`) ma **forza `decision = CPUFallback` per ogni engine non-CPU** (`policy:277-278`, e il test lo asserisce: `admission.decision == CPUFallback`), e il runtime instrada sul *decision* (`runtime:109`). Servono quindi due siti, non uno.

**N-D9 — CONFIRMED / LOW — drift dei numeri di riga (circa 6 su ~35).** `llama-ext.h:194`→:193; `llama-ext.h:234-253`→:242-255; `policy:337-339`→:337-341; `tests:85-97`→ il test decode parte a `:99`; `tests:37-48`→ le asserzioni sono `:49-53`; `governorInputs.ts:191`→ `enabled` a `:190`; `GOVERNOR-DEVICE-PLAN.md:81-83` → **quel range è "Rule 3"**, la probe cache key è a **`:89-90`** (`cached for socModel + GPU driver version + app versionCode`). Tutti gli altri, **inclusi i cinque riferimenti nei `*.load.log` e i numeri di `results.tsv`**, sono esatti: è drift, non fabbricazione.

**N-D10 — CONFIRMED / LOW — il doc non riconcilia mai i rapporti CLI con quelli in-app, e il divario è di un ordine di grandezza.**
L'intera proposta è "muovi il prefill su un engine più veloce", e la sua evidenza è il rapporto CLI HTP-vs-OpenCL 4.4–4.7× (e OpenCL-vs-CPU 7347/19027 = 2.6×). Ma l'app ha misurato sul S23 **in-app** un guadagno di prefill OpenCL di **1.242×** sul CPU (`governorInputs.ts:18-19`, "GPU prefill is 1.242× vs CPU", n=1 su una board, oracle ancora FAIL su R2). Se l'attenuazione CLI→app vale per HTP, il caso si indebolisce di molto. Il doc non lo menziona da nessuna parte, pur essendo la sua stessa fonte.

**N-D11 — CONFIRMED / LOW — un input del fail-safe documentato a metà.** `buildGovernorParams` restituisce anche `reload_budget_available: false` (`governorInputs.ts:208`), e `select_decode` lo richiede (`policy:335`): la lane COOLMODE di decode è oggi **strutturalmente irraggiungibile** per un hard-coded app-side, non perché i gate "non passano". Il doc descrive i sei gate del decode come se fossero una condizione; il fatto che uno di essi sia spento a monte è più informativo.

## 4. Il claim fail-safe: i tre gate, verificati

**CONFIRMED tutti e tre**, con una precisazione.
1. "unknown generation → governor disabled (`governorInputs.ts:25, 191`)": `GPU_PREFILL_CORRECT[Unknown] = false` a `:25` ✓, e `enabled = force || GPU_PREFILL_CORRECT[generation]` a `:190` (non `:191`).
2. "invalid schema or profile → CPU ('safety preempts', `policy:185-188`)": `if (!valid_schema(params_) || !profile_valid_ || !have_profile_ || CRITICAL || Invalid || LOWBAT) return CPU; // safety preempts` ✓ — incluso il fatto che **preempts anche l'override di bench**, che il doc non dice ma che è la parte forte della sicurezza.
3. "decode → CPU unless every cool-lane gate passes (`:337-339`)": `if (!eligible) { last_decode_engine_ = CPU; return result; }` ✓ (`:337-341`).
4. "Probes fail closed (`GOVERNOR-DEVICE-PLAN.md:83-84`)": quel range è Rule 3, non i probe (che sono a `:89-90`) — **stesso drift di N-D9**.

Precisazione che il doc non fa: il fail-safe "missing row ⇒ CPU-only" è vero oggi **perché il motore è fail-closed**, non perché la tabella proposta lo produca — `prefill_engine` non legge nessun rank dall'asset, e il percorso di abilitazione passa da `enabled`/`gpu_fit`/`gpu_prefill_measured` app-side. Il doc dice giustamente che `null` ⇒ "excluded from ranking", ma non specifica il comportamento del *selettore* rispetto a `heat_per_1k_c: null` (che è la chiave che il selector dovrebbe usare): senza una riga, il selector non ha nulla su cui minimizzare il calore, e il default deve essere esplicito.

## 5. Cosa chiederei di correggere, in ordine

1. **`decode.tok_s` 21.1 → ≈15.0** (repack drop + 1.4–1.41×), con la fonte binding/app citata accanto al numero. Le due fonti che il doc già cita contengono il fattore: non applicarlo è l'errore più costoso del doc, perché è l'unico numero di decode che la tabella userebbe.
2. **I tre `tok_s` di prefill vanno divisi per 10** (0.5995 / 0.1361 / 0.0526) o la formula dichiarata va cambiata — non lasciare un asset con due normalizzazioni in conflitto.
3. **`~4.4–4.7 GiB` → ≈3.08 GiB** (senza repack, allineato al 2998.06 MiB dell'app), mantenendo "memory-neutral" con il confronto ≈3078 vs ≈3063 MiB: la conclusione è giusta e merita di essere difesa col numero giusto.
4. Aggiungere al verdetto di fattibilità il fallimento di costruttura (`llama-governor.cpp:48-56`) e la severità reale di `compatible()` (`llama-kv-commit.cpp:12-25`), che trasformano l'INFERRED sul `-nkvo` in un fatto tracciato.
5. Dire che la missing measurement **non** decide la fattibilità (nessun `commit_side` in un protocollo a un contesto, decode all'11% del carico) e nominare la lista delle cinque violazioni Rule 1 già presenti nel policy come parte del lavoro di §4.
