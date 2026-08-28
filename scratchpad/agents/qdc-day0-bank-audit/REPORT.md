# AUDIT OSTILE #2 — cella qdc-8elite-cpu-day0

Audit indipendente (modello non-autore). Read-only. Report scritto incrementalmente.
Metodo: ogni claim con verdetto CONFIRMED/PLAUSIBLE/REFUTED e citazione path:riga.

## Scope e metodo

(in corso)
Verifiche eseguite: PREREG.md, REPORT.md, RUN_LOG.md, manifest.json letti integralmente; 45 file in raw/ ispezionati; kit Mac-side verificato (SHA256SUMS, BUILD_NOTE, hash build dir); 12 jsonl riconfrontati campo per campo; ordine reale dei run ricostruito dai campi `test_time`; git status del repo controllato.

## §0 — Sintesi verdetti

| # | Claim auditata | Verdetto |
|---|---|---|
| 1a | MUL_MAT 1144/1144 con `-b CPU` | **CONFIRMED** |
| 1b | MUL_MAT_ID 812/812 con `-b CPU` | **CONFIRMED** |
| 1c | Skip senza `-b` NON contato come PASS | **CONFIRMED** (registrato come skip, mai come pass) |
| 1d | Kit = bin-a0cabca6b, sha ok | **CONFIRMED** per i binari; runtime reale = kit + 7 .so esterni (dichiarato) |
| 2a | Mediane tg128 t8 59.095 / pp512 92.996 / t6 52.504 / 75.514 | **CONFIRMED** (verbatim dai 12 jsonl) |
| 2b | "Trend in discesa r1→r3" | **CONFIRMED** (monotono in 4/4 config; −2.9%…−8.6%) |
| 2c | Aggregatore (mediana delle medie invocazione) pre-reggato | **REFUTED** — scelta ex-post, dichiarata solo nel REPORT |
| 3a | Battery temp 43.0 = stub, non affidabile | **CONFIRMED** (dichiarato; causa reale "UPDATES STOPPED" mai menzionata) |
| 3b | thermalservice CPU 39→55 °C, status 0→1 | **CONFIRMED** e coerente col drift (è LA causa del trend) |
| 3c | Lib .so pushate a parte = deviazione dichiarata | **CONFIRMED** dichiarata; "same-build" inferito non provato in toto |
| 4 | Model size 4213513024 esatta + sha Mac registrato | **CONFIRMED** (3 registrazioni) |
| 5a | Aritmetica manifest | **CONFIRMED** (nessun errore) |
| 5b | Confronto #20: solo numeri, no verdetti | **CONFIRMED** (con caveat di comparabilità incompleto) |
| 6 | Evidenza versionata in git | **REFUTED** — tutto untracked |

## §1 — Correttezza e storia del `-b CPU`

**1a/1b. Conteggi — CONFIRMED.**
`raw/cert_mm_cpu.out:1477` = `1144/1144 tests passed` (con `-b CPU`; .out 159.9 KB, sweep completo). `raw/cert_mmid.out:819` = `812/812 tests passed`. In entrambi: 0 righe FAIL nel grep. Gli `.err` mostrano `ggml_backend_set_n_threads(CPU, 8)` — i test girano su 8 thread, coerente col device a 8 core. I path q2_K/q3_K richiesti dal prereg ("full sweep, includes our q2_K/q3_K repack paths", PREREG.md §1) sono presenti: 26 match di `q2_K|q3_K` in cert_mm_cpu.out. rc di tutti i run = 0 (`raw/cert_mm_cpu.rc`, `raw/cert_mmid.rc`).

**1c. Lo skip vacuo NON è stato contato come PASS — CONFIRMED.**
Il primo tentativo letterale `test -o MUL_MAT` (senza `-b`) è in `raw/cert_mm.out` (93 byte): contiene `"Skipping CPU backend"` (riga 4) e — trappola — anche `1/1 backends passed` + `OK` con **rc=0** (`raw/cert_mm.rc`). Un grepper distratto avrebbe visto un "passed". Come è stato trattato:
- RUN_LOG.md §Correctness: "Skipping CPU backend (CPU is the reference in test mode; CPU-only kit). rc=0, 0 cases. **Not a FAIL, also not a sweep.**" — corretto.
- manifest.json `correctness.MUL_MAT_literal_no_b` = "CPU skipped (test-mode reference)" — registrato come skip, non come pass.
- REPORT.md tabella: prima riga "CPU skipped (test-mode uses CPU as reference)", e il gate PASS è motivato solo dalle due righe `-b CPU`.
Nessun documento conta 0/0 come sweep. **Gestito onestamente.** Nota: il prereg (PREREG.md §1) non menzionava `-b CPU` — la necessità è stata scoperta e documentata in corsa; è un rafforzamento, non un allentamento.

**1d. Kit e .so — CONFIRMED con riserva sul "same-build".**
- Kit: `~/kalsa-qdc/bin-a0cabca6b/SHA256SUMS` contiene esattamente i 3 binari con gli sha riportati in RUN_LOG.md §Kit (llama-bench `62d2fe5e…`, llama-cli `5b17ac8b…`, test-backend-ops `715ff176…`). Kit dir = solo 3 binari + SHA256SUMS + BUILD_NOTE.txt + COMMIT.txt: **nessuna .so nel kit**.
- Il kit "stub" non linka da solo: primo tentativo = CANNOT LINK libllama-common.so (RUN_LOG.md §Kit push — ma **nessun raw artifact di quel fallimento**; il cert_mm.out di 93 B è il run *dopo* il push delle librerie).
- Sono state pushate 7 librerie: 6 da `~/Projects/kalsallama/build-android/bin/` + `libomp.so` dall'NDK r29 Caskroom (path completo in `raw/push_libomp.so.log`). I 7 sha "device" in RUN_LOG.md combaciano **verbatim** con gli sha256 Mac-side dei file sorgente (verificati ora: `libllama.so` 42c26807…, `libggml-cpu.so` 2d63f5f8…, ecc.).
- Claim "byte-identical llama-bench/test-backend-ops SHA" tra kit e build dir: **CONFIRMED Mac-side** — `shasum -a 256` di `build-android/bin/llama-bench` e `test-backend-ops` riproduce esattamente gli sha del kit (62d2fe5e…, 715ff176…). Quindi i binari del kit provengono da quell'albero di build, il che rende plausibile (ma **inferito**, non provato per singola lib) che le .so siano dello stesso build di c750342f. `BUILD_NOTE.txt` attesta "HEAD at build: c750342f = main a0cabca6b + CI yml only", ma non elenca gli sha delle .so.
- **Gap di evidenza**: nessuna verifica sha256 lato device pullata in raw/ per binari né libs; niente push-log per i 3 binari del kit (solo per le 7 .so e il modello). I claim "kit SHA = device SHA" sono Mac-side + byte-count dei push log.

## §2 — Speed: mediane ricalcolate e "trend in discesa"

**2a. Mediane — CONFIRMED.** I 12 `avg_ts` dei jsonl raw (`raw/t*_*.out`, campo `avg_ts`) coincidono **verbatim** con manifest.json `runs[].avg_ts` e `speed_summary`, con RUN_LOG.md §Speed e con la tabella del REPORT (arrotondamenti a 3 decimali tutti corretti: 63.526608→63.527, 92.996480→92.996, ecc.). Campi di identità verificati per ogni file: `n_threads` (8/6), `n_prompt`/`n_gen` (tg128 = 0/128; pp512 = 512/0), `no_repack: false`, `build_commit: c750342f5`, `backends: CPU` — nessun file mislabeled. Le mediane delle 3 invocazioni sono il valore centrale: 59.09534, 92.99648, 52.503774, 75.514431 ✓. Verifica interna aggiuntiva: per ogni run `avg_ts = mean(samples_ts)` e `samples_ts[i] = n/(samples_ns[i])·1e9` (riletto su r1 tg128: 128/1.972805572 = 64.883 ✓; r3 pp512: 512/6.889429910 = 74.317 ✓); `stddev_ts` = stddev campionaria (n−1) dei 3 campioni ✓ (r1 tg128: 1.3027).

**2b. Trend in discesa r1→r3 — CONFIRMED e quantificato.**
Monotono decrescente in tutte e 4 le configurazioni (r1>r2>r3):

| config | r1→r2 | r2→r3 | **r1→r3** |
|---|---:|---:|---:|
| t8 tg128 | −6.98% | −1.69% | **−8.55%** (63.527→58.095) |
| t8 pp512 | −5.51% | −2.69% | **−8.06%** (98.423→90.491) |
| t6 tg128 | −4.08% | −1.90% | **−5.90%** (54.736→51.505) |
| t6 pp512 | −1.38% | −1.59% | **−2.94%** (76.573→74.318) |

L'ordine temporale reale (dal campo `test_time` dei jsonl) è: t8 tg128 r1→pp512 r1→tg128 r2→pp512 r2→tg128 r3→pp512 r3 (16:32:32Z→16:33:49Z), poi t6 nello stesso schema (16:34:26Z→16:35:57Z) — cioè **interleaving tg128/pp512 vero** come da RUN_LOG e prereg ("bench-rebench, not one long run"), e il drift r1→r3 per config coincide con il trascorrere del tempo ✓. Il trend è quindi non solo vero nei numeri ma temporalmente onesto.

**2c. L'aggregatore non era nel prereg — REFUTED come "pre-reggato".**
PREREG.md §2 specifica `-r 3` e "N=3 invocations per config interleaved" ma **non definisce l'aggregatore**. La scelta "mediana delle medie di invocazione" è dichiarata ex-post nel REPORT ("Median of the three invocation avg_ts"). Sensibilità: la mediana su tutti i 9 campioni interni darebbe t8 tg128 = **60.190** (+1.9% vs 59.095), t8 pp512 = 92.769 (−0.25%), t6 tg128 = 52.587 (+0.16%), t6 pp512 = 75.379 (−0.18%). Il bankable tg128 t8 dipende quindi dalla convenzione (fortunatamente nel senso conservativo: la scelta fatta dà il numero più basso). Da fissare per le prossime celle QDC.

Nota hostille sul drift: con N=3 lanci a ~30-40 s l'uno dall'altro durante una rampa termica, la mediana (r2) è un numero **a metà rampa**, non steady-state; r1 è cold-ish (i 3 campioni interni di r1 tg128 decrescono anch'essi: 64.88→63.41→62.28). Il REPORT dichiara il drift ma non quantifica né avvisa che i numeri sono ramp-contaminati. (Questo audit quantifica: tabella sopra.)

## §3 — Deviazioni dichiarate: stub batteria, thermalservice, libs

**3a. Battery temp fissa 43.0 = stub — CONFIRMED (dichiarato, ma causa reale non nominata).**
Tutti i sample registrano 430 tenths: 25 righe di `raw/thermal_watch.csv` (verificato: 25 righe, level=100×25, ac=false×25) + 24 pre/post + battery.final. REPORT.md §Temp: "Looks like a stub; do not treat as a live sensor" — onesto. **Però** la causa è visibile in raw e mai menzionata: `raw/battery.final.txt:2` = `(UPDATES STOPPED -- use 'reset' to restart)` — il servizio batteria del device è **fermo**, quindi tutto il canale dumpsys battery (temp, level, e **anche gli stati AC/USB/Wireless**) è un'immagine congelata. Conseguenza non banale: il "plugged declared" non è verificabile via dumpsys (AC=false congelato); resta una dichiarazione del prereg ("rack power path not shown as AC", RUN_LOG.md §Device snapshot — dichiarata come dichiarazione ✓). La telemetria batteria di questa cella va considerata **interamente decorativa**.

**3b. thermalservice CPU 39→55 °C, status 0→1 — CONFIRMED e coerente col drift (ne è la causa).**
Attenzione ai file: `raw/thermalservice.pre.txt` e `.post.txt` contengono DUE sezioni. La sezione "Cached temperatures" (righe 13-28) è **identica** pre/post (CPU0 63.8, CPU6 79.2 — cache stantizia del device). La sezione HAL corrente (righe 44-73) è quella che cambia: pre CPU0 39.6 / CPU1 41.1 / CPU5 40.7 / CPU7 39.2 / skin 32.629 / **Thermal Status: 0** (pre.txt:44-66, :10); post CPU0 53.8 / CPU1 54.9 / CPU5 54.9 / CPU7 53.4 / skin 48.007 status=1 / **Thermal Status: 1** (post.txt:44-66, :10, :37); `CoolingDevice battery 0→12` (pre:73 / post:73) = mitigazione termica attivata. I numeri "39→55" e "32.6→47.6" del REPORT sono quindi supportati dal raw ✓. **Coerenza col trend: CONFIRMED** — il drift in discesa (−2.9%…−8.6%) è la firma della rampa termica +14 °C su CPU e +15.4 °C su skin in ~4 minuti di matrice; il drift maggiore è su t8 (che corre nella parte più ripida della rampa), il minore su t6 pp512 (quando la rampa è già appiattita e status=1 già verosimilmente attivo). RUN_LOG.md lo registra ("status 0 → 1") senza collegarlo esplicitamente al drift; la coerenza è reale ma implicita.

**3c. Lib .so pushate a parte — deviazione dichiarata, CONFIRMED come dichiarazione.**
Il prereg pinnava "Binaries: ~/kalsa-qdc/bin-a0cabca6b/" (PREREG.md §Environment): il runtime effettivo è kit stubs + 6 .so da build-android/bin + libomp NDK r29 — cioè **il kit così com'è non eseguibile**. REPORT.md §Correctness note e RUN_LOG.md §Kit push lo dichiarano con gli sha. Mitigazione forte: i binari kit sono byte-identici a quelli della build dir (verificato Mac-side, §1d), il che rende le .so provenienti dal medesimo albero di build. Residuo: "same-build" per le singole .so resta un'inferenza; nessuna verifica sha lato device in raw/.

## §4 — Modello

- **Size on-device 4213513024 esatta — CONFIRMED.** `raw/model_push.log` (anche se la seconda metà è mojibake/encoding corrotto, il contenuto è recuperabile): adb push "(4213513024 bytes in 170.635s)" + ls on-device `4213513024 … /data/local/tmp/kalsa/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`. manifest.json `model.bytes = model.device_size = 4213513024` ✓, RUN_LOG.md §Model ✓. Coincide con il prereg (PREREG.md: "4 213 513 024 B"). Nota di precisione: il jsonl di llama-bench riporta `model_size: 4211730432` — è la size **GGUF-metadata** (tensor data), ~1.78 MB sotto la size file: normale, nessun documento della cella la confonde con la size file.
- **Sha Mac 3bd9ec48… registrata in 3 posti — CONFIRMED**: `raw/model_mac.sha256` (= `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe  4213513024`, con byte-size ✓), manifest.json `model.mac_sha256`, RUN_LOG.md §Model. Il prereg richiedeva "sha256 to be recorded in manifest before first bench run" ✓ (push 12:28, bench da 16:32Z=12:32 EDT).

## §5 — Manifest e comparatore #20

**5a. Aritmetica manifest — CONFIRMED, nessun errore.** `speed_summary` = runs[] (12/12 valori verbatim, §2a); mediane = valori centrali ✓; min/max corretti (t8_tg128 min 58.095086 max 63.526608 ✓, pattern identico sulle altre 3); n=3 ×4 ✓; `correctness` registra lo skip come skip (§1c); kit_sha = SHA256SUMS ✓; model block ✓; `comparator_read_only.s23_olmoe_tg128_cpu_20 = 27.685` ✓ = prereg. REPORT §Time (~20 min wall, cap 90) coerente: test_time span totale 16:32:32Z→16:35:57Z = 3 min 25 s di bench + push 170.6 s + correctness ~3 min (mtime 12:28→12:31) + overhead ≈ 20 min ✓. Piccole s approssimazioni non-materiali: REPORT "~1.7 min" per il matrix t8 vs 77 s di solo test_time (senza load time); "Correctness ~2 min" vs ~3 min da mtimes.

**5b. Comparatore #20: solo numeri, nessun verdetto — CONFIRMED.** Il prereg (§Comparators) definisce #20 read-only e impone solo di dichiarare il caveat plugged-vs-unplugged. REPORT.md: "Read-only comparator (not a verdict): #20 … 27.685 t/s (unplugged). This cell is plugged, Oryon, same GGUF bytes." — nessun ratio calcolato (59.095/27.685 = 2.13× esiste ma non è affermato come verdetto), nessun aggettivo. ✓ conforme. **Due lacune di comparabilità non dichiarate**: (1) il comparator #20 del S23 era stato misurato con `-nr -fa off` (no_repack=true; cf. audit #1) mentre questa cella gira `no_repack: false` (jsonl) — differenza di flag non citata nel caveat; (2) il prereg QDC definisce #20 come "same-source binaries", ma i binari S23 #20 sono di un commit precedente (lineage più vecchio, cf. audit #1) — "same-source" è generoso. Il REPORT non ripete il claim, ma il caveat di comparabilità resta incompleto per chi userà il bank.

## §6 — Finding extra

1. **Git: tutto untracked — REFUTED come "evidenza versionata".** `git status`: REPORT.md, RUN_LOG.md, manifest.json, raw/ tutti `??`. Il prereg è lockato (f72b1b20), i dati no. REPORT.md termina con "No commit." — almeno è dichiarato.
2. **Nessun artifact raw del primo fallimento CANNOT LINK** (RUN_LOG.md §Kit push) né push-log per i 3 binari del kit: il racconto "primo link fallito → push libs → skip → gate vero" è ricostruibile ma il primo evento è inevidenziato.
3. **"UPDATES STOPPED" del battery service mai menzionato** nei documenti (visibile solo leggendo battery.final.txt:2): v. §3a.
4. **Cache termica stantizia**: le "Cached temperatures" di thermalservice (CPU6 a 79.2 °C identiche pre e post) sono rumore del device; chi rilegge i raw deve sapere che solo la seconda sezione HAL è significativa. Non segnalato nei documenti.

---

## VERDETTO FINALE: **BANK-WITH-ERRATA**

**Bankabile**: la CPU slice QDC è misurata pulito. Gate correttezza vero (1144/1144 e 812/812 con `-b CPU`, skip vacuo scartato correttamente), 12/12 numeri speed riproducibili verbatim dai jsonl, mediane corrette, drift reale-monotono-temporalmente onesto e spiegato termicamente, telemetria debole dichiarata come tale, comparatore #20 usato in sola lettura. Nessun numero inventato o gonfiato trovato; l'unico numero "fortunato" (59.095 vs 60.190 mediana-9) è nel senso conservativo.

**Errata da allegare al bank:**

1. **Aggregatore non pre-reggato** (§2c): il bank tg128 t8 = 59.095 vale *sotto la convenzione* "mediana delle medie di invocazione"; la mediana sui 9 campioni darebbe 60.190 (+1.9%). Fissare la convenzione nel prereg della prossima cella QDC (o errata-note permanente).
2. **I numeri tg128/pp512 sono ramp-contaminati**: drift −2.9%…−8.6% con status termico 0→1 in corsa; la mediana è mid-ramp. Per confronti futuri (incl. Oryon-vs-S23) trattare questi numeri come "first-look hot ramp", non steady-state.
3. **Telemetria batteria tutta congelata** ("UPDATES STOPPED", battery.final.txt:2): 43.0 °C/level 100/AC=false sono valori stup; il plugged-declared resta una dichiarazione del prereg, non una misura.
4. **Runtime = kit stubs + 7 .so esterne**: "same-build" è inferito dal byte-identity dei binari kit↔build dir (verificato Mac-side), non provato per ogni .so; nessuna verifica sha lato device in raw/ (né per binari né per libs).
5. **Caveat #20 incompleto**: aggiungere la differenza no_repack (false qui vs true su S23 #20) e il lineage binario più vecchio del S23.
6. **Committare** REPORT.md, RUN_LOG.md, manifest.json, raw/ (stesso problema dell'audit #1).
7. Minori: "CANNOT LINK" iniziale senza raw; cache termica stantizia (CPU6 79.2 °C) da ignorare in eventuali ri-letture; s approssimazioni §Time.

*Fine audit. Read-only rispettato (solo questo REPORT scritto).*
