# AUDIT 3 — audit ostile finale prima delle run S23 (read-only, nessuna patch)

Verificato da me: `qdc-heat-3way` a `d7527c92` (`./dryrun.sh` → **EXIT=0, PASS=259 FAIL=0**) e `spec-dspark-gpu-draft` a `df26ebdc` (`./dryrun.sh` → **EXIT=0, pass=182 fail=0**). Due prove empiriche eseguite contro l'adb finto (nessun telefono, nessun adb vero, nessun sub-agent, nessuna modifica alle celle; gli artefatti che ho creato per le prove sono stati rimossi).

| cella | ready for the phone |
|---|---|
| **A) qdc-heat-3way** | **NO** — 2 blocker, entrambi dimostrati |
| **B) spec-dspark-gpu-draft** | **praticamente sì** — nessun blocker, 1 medium + 4 low |

I due blocker di A non sono di sicurezza: sono **verdetti di sessione falsi** che la calibrazione e il marker di kill possono produrre su un run pulito. La sicurezza (angolo 1) è solida.

---

## 0. Esito delle finding del round 2

### A) qdc-heat-3way

| # | esito | riga letta |
|---|---|---|
| NEW-1 soglia execute-op | **CLOSED** | `arm.sh:40` `HTP_FLOOR_PRIOR=0.86`; `arm.sh:245-247` `floor="${HTP_FLOOR_PER_TOKEN:-$HTP_FLOOR_PRIOR}"` … `min_ops=$(awk … (x==int(x)) ? int(x) : int(x)+1)`; token presi dal **proprio** log della proof: `arm.sh:213-216` `if [ "$ARM_PROMPT_N" = na ] … PROOF_TOKENS=$((ARM_PROMPT_N + ARM_RUNS))`. Il blocker del round 2 è risolto: la soglia scala, non è più 1000 fisso. Restano A-N5/A-N6 sulla risoluzione e sulla validazione del pin. |
| NEW-2 fingerprint | **CLOSED** | `arm.sh:130-137`: componenti di **placement** (`buf` da `… <NAME> model buffer size`, `off` da `offloaded n/m layers`, `thr`), non più di intenzione. Verifico la fonte, sotto: il meccanismo `-lv 4` è corretto. |
| NEW-3 backend sbagliato | **CLOSED** | `arm.sh:236-240` check `kernel set failed\|device disabled` **sul log del turno** → `turn_backend_disabled`; più il fingerprint di placement. |
| NEW-4 pgrep fail-closed | **CLOSED (con A-N4)** | `setup.sh:6-24` self-test health/alive/gone con `exit 4` (`setup.sh:70`); `restore.sh:50-57` accetta `GONE` solo con `PROBE=1 && gone_rc=1`. |
| NEW-5 marker/END | **CLOSED (con A-N2)** | `restore.sh:56-58` scrive `kill_unverified`; `d_run.sh:161-170` cleanup dopo restore che possiede END ed `exit 3`. **Ma il marker non è ripulito all'avvio → A-N2.** |
| NEW-6 handshake sampler | **CLOSED (con A-N7)** | `sampler.sh:17-48`: baseline `grep -c 'H sampler_done'` **prima** del marker, poi attesa di `after > before` → `SAMPLER_PAUSE_CONFIRMED`. Handshake reale, esercitata dal fake (`dryrun-adb.sh:223,233,296-297`, `dryrun-core.sh:36`). |
| NEW-7 ordine | **CLOSED** | `d_run.sh:31-42` invariata; registrato in `PREREG.md` amendment 6. |
| NEW-8 costo | **CLOSED** | `PREREG.md` amendment 7-9. |

### B) spec-dspark-gpu-draft

| # | esito | riga letta |
|---|---|---|
| NEW-0 `-t 5` | **CLOSED** | `arm.sh:61` `-t 5 -ngl 0` nel comando unico (proof **e** misura). |
| NEW-1 restore tiene lo stato | **CLOSED** | `restore.sh:55-61` `if [ "$rc" -eq 0 ]; then rm -f .restore-state; else printf 'restore_failed_keep_state…'` + fixture `restorefail` (che asserisce stato tenuto e device ancora mutato). |
| NEW-2 padre morto | **CLOSED** | `d_run.sh:189-193` `if ! kill -0 "$DRIVER_PID"; then kill_spec_verified "parent_gone" \|\| true; exit 0`. |
| NEW-3 schema 18 colonne | **CLOSED** | `d_run.sh:305-310` `finalize_results` riscrive il campo 18 in place; `d_run.sh:326` `write_row … pending`; header a 18 da `d_run.sh:466`; `cleanup` finalizza se `FINALIZED=0` (`d_run.sh:218-220`). |
| NEW-4 tar sotto poll | **CLOSED** | `d_run.sh:453-459` `start_arm_poll` … `tar -xzf` … `sha256sum -c` … `stop_arm_poll` + check `stop_request`. |
| NEW-5 self-test pgrep | **CLOSED** | `d_run.sh:103-118` (probe assemblato a runtime, `sleep 12`+`345`), `exit 4` **prima** di ogni mutazione (`d_run.sh:411-412`), e health-probe in `kill_spec_verified` (`d_run.sh:130-136`). |
| NEW-6 kill fuori bersaglio | **CLOSED come documentazione** | nota esplicita in `finish_stop` (`d_run.sh:241-245`): il verdetto è `KILL_VERIFY reason=…`, non `KILL_VERIFIED` della libreria. |
| NEW-7 `PROOF_N` | **CLOSED** | `arm.sh:29` `PROOF_N=8`. |
| NEW-8 deadline | **CLOSED (con B-N1)** | `d_run.sh:98-104` `deadline_check` → `END deadline`, `exit 124`; chiamata in `cooldown_wait`/`run_proof`/`run_measure`/match loop. |

---

## 1. Device safety

**Vero, con tre residui.**

- **CONFIRMED** — i due tier di `battery_trust_check` (`setup.sh:66`) + `battery_trust.sh:44-47` (mismatch su due campioni concordi) sono intatti, e la skin ≥ 46 °C resta **aggiuntiva** (`stop_lib.sh:97-99`), mai in sostituzione del tetto a 44 °C (`stop_lib.sh:93-94`).
- **CONFIRMED** — `battery_trust_check` **prima** del gate di setup (`setup.sh:66-67`): la skin-fallback è armata prima del primo carico, non dopo.
- **CONFIRMED** — la calibrazione ha il poll vivo su **entrambe** le fasi: `calibrate.sh:52` `start_arm_poll` → `arm_load` → `arm_run "$b" "$tag" 16` → `calibrate.sh:81` `stop_arm_poll`, con check `stop_request` dopo ciascuna (`calibrate.sh:54`, `calibrate.sh:78`) e `hard_stops || { stop_arm_poll; finish_stop; }` a `calibrate.sh:63`.
- **CONFIRMED** — screen-on: `setup.sh:64-66` wakeup + `svc power stayon true` + `screen_off_timeout=1800000`, con stato salvato **prima** (`setup.sh:62`) e i trap armati **fra stato e prima mutazione** (`setup.sh:63`).
- **REFUTED (N/A)** — **IME**: nessuna delle 15 script delle due celle contiene `IME`/`ime` come token (grep: solo `ARM_TIMEOUT`); la cella CLI non scrive nell'IME e `restore.sh` non ha nulla da ripristinare al riguardo. La restore-and-IME compete alla cella `qdc-heat-per-backend`, non a queste due.
- **CONFIRMED** — un kill non lascia il binario: `stop_lib.sh:69-82` (pkill+pgrep, marker), `restore.sh:50-63`, `cleanup` (`d_run.sh:135-140`) sempre prima di `restore.sh`, `kill_unverified_end` su load-fail (`d_run.sh:299`).

**A-N3 — CONFIRMED / HIGH — il sampler on-device di 1 Hz sopravvive a un SIGKILL del driver: è l'unico processo che resta vivo sul telefono senza nessuno che lo fermi.**
`smp.sh:22` `while [ ! -f "$STOP" ]; do … done` con `smp.sh:34` `sleep 1` e **nessun limite di iterazioni/ tempo**, e A non ha il controllo di vivacità del padre che B ha (`d_run.sh:189-193`). Se il driver muore con SIGKILL (o SIGHUP senza restore, o il cavo cade), il loop `dumpsys thermalservice` + sysfs a 1 Hz resta sul telefono **per ore**, consumando batteria e riscaldando la board, finché non arriva una sessione successiva (`kit.sh:49` rimuove `stop`) o un `touch` manuale. Il resto della cella è pulito sui SIGKILL perché lo stato e il kill sono entrambi recuperabili; il sampler no.
Fix (una riga in `smp.sh`): `MAX=$(( $(date +%s) + ${SAMPLER_MAX_S:-14400} ))` e `while [ ! -f "$STOP" ] && [ "$(date +%s)" -lt "$MAX" ]`.

**A-N4 — CONFIRMED / MEDIUM — il self-test di `pgrep` ha una race SIGHUP e, in caso di fallimento, lascia un processo vivo sul telefono.**
`setup.sh:11` lancia il vittima in **una** sessione adb (`sh -c 'sleep 4731 … &'`), `setup.sh:14-16` lo interroga in **un'altra**, `setup.sh:19-22` lo uccide in **una terza**. Quando la sessione adb della riga 11 si chiude, il processo in background può ricevere SIGHUP dal teardown del gruppo di processi: `sleep 4731` muore e la sonda "alive" restituisce 1 → `PGREP_SELFTEST_FAIL` → `setup.sh:70` `exit 4`, cioè **rifiuto disessione su un telefono perfettamente sano** (sicuro, ma rende "ready" dipendente da un comportamento non verificato). E se la sonda "alive" fallisce, il ramo `setup.sh:14-17` ritorna **prima** del `pkill` di `setup.sh:19`: l'orfano `sleep 4731` resta sul telefono. B lo ha risolto bene (`d_run.sh:112`: vittima, sonda e pulizia nella **stessa** invocazione adb, pattern assemblato a runtime) — A no.
Fix (una riga): usare la forma di B, cioè una sola `adbT` con `q=…; "$q" &; sleep 1; pgrep…; pkill…; pgrep…`.

**A-N7 — CONFIRMED / MEDIUM — una pausa non confermata del sampler non lascia traccia nella riga.**
`sampler.sh:39-48`: dopo 6 tentativi senza `H sampler_done` logga `SAMPLER_PAUSE_UNCONFIRMED …` e **procede** (`return 0`), cioè il turno viene misurato con un carico 1 Hz probabilmente ancora attivo. `results.tsv` ha 25 colonne fisse (`d_run.sh:250`) e **nessuna** registra lo stato del sampler: la misura perturbata viene scritta come `OK` indistinguibile da una pulita. Il rischio è di validità, non di sicurezza, ed è l'esatto difetto che NEW-6/A-11 dichiaravano chiuso.
Fix: `SAMPLER_PAUSED_OK=0` in `sampler_pause` e una colonna `sampler` in `results.tsv` (oppure `WARM_START=1` + un flag dedicato), così l'analisi può scartare la finestra.

**LOW (A)** — `restore.sh:44-45` fa `pkill -f "$HEAT_TMP/smp.sh"` **sull'host**: il pattern è il path assoluto del device, che compare nella cmdline di qualunque `adb shell` di un'altra sessione che punta alla stessa directory — kill cross-session possibile se un altro agente usa la stessa cella. `restore.sh:69-72` inoltre scrive `llama=pkill rc=$rc` con un `rc` che ora aggrega *anche* il fallimento della verifica kill (`restore.sh:53`): due cause diverse, un solo numero.

---

## 2. Validità: può una riga (o un pin) essere registrata su un backend non eseguito?

**Il meccanismo `-lv 4` è corretto e l'ho verificato in sorgente — non è il difetto che sembrava.**

- **CONFIRMED (in-tree)** — `common/log.h:24-32`: `LOG_LEVEL_DEBUG 5 / TRACE 4 / INFO 3 / WARN 2 / ERROR 1`, `LOG_DEFAULT_LLAMA LOG_LEVEL_INFO` (=3). `common/log.cpp:30` `int common_log_verbosity_thold = LOG_DEFAULT_LLAMA;` e `common/log.cpp:532` `case GGML_LOG_LEVEL_INFO: return LOG_LEVEL_TRACE;` (4). Quindi una `LLAMA_LOG_INFO` di `src/` ha verbosity 4 > 3 al default → **nascosta**, e `common/arg.cpp:3946-3947` `-lv 4` → `common_log_set_verbosity_thold(4)` → `4 <= 4` → **visibile**. È esattamente il meccanismo che `arm.sh:20-27` dichiara, e spiega perché il log run-1 contenga `common_perf_print:`/`system_info:` (macro `LOG_INF` lato tool, soglia 3) ma non `model buffer size` (INFO di `src/`, soglia 4). Il grep `raw/s23-cli-heat-20260926/*.log` che il REPORT usa come prova è quindi coerente.
- **REFUTED** — la mia ipotesi di blocker "la riga `offloaded` non esiste per il CPU arm": **falsa**. `src/llama-model.cpp:1834` la guardia è `if (llama_supports_gpu_offload())`, non `n_gpu_layers > 0`, e `src/llama.cpp:102-108` `llama_supports_gpu_offload()` è vero se esiste un device GPU/IGPU — cioè su questo kit, dove `-ngl 99 -dev GPUOpenCL/HTP0` offloada. Quindi `off` esiste su tutti e tre gli arm (`0/34` sul CPU, `33/34` su G e N) e **non** si cade in `no_fingerprint`.
- **REFUTED** — "`-lv 4` inquinerebbe la finestra misurata" (l'equivalente del mio A-2 del round 1): `-lv 4` ammette INFO/TRACE ma **non** DEBUG (5 > 4), quindi `assigned to device`, `execute-op` e il dispatch OpenCL restano fuori; l'unico volume nuovo sono le righe INFO di `src/`, tutte **a load time**, fuori da `eval time`. Non è una regressione.
- **CONFIRMED** — il fake non inventa più la forma: `dryrun-adb.sh:173` `printf 'load_tensors: %12s model buffer size = %8.2f MiB'` e `:175-176` `offloaded 0/33 layers to GPU` / `offloaded 33/33 layers to GPU` riproducono **alla lettera** i format reali (`src/llama-model.cpp:1852` `"%s: %12s model buffer size = %8.2f MiB\n"`, `:1845` `"%s: offloaded %d/%d layers to GPU\n"`).

**A-N8 — CONFIRMED / MEDIUM — `off` non distingue G da N: il format contiene la stringa letterale "GPU" anche per l'HTP.**
`src/llama-model.cpp:1845` `LLAMA_LOG_INFO("%s: offloaded %d/%d layers to GPU\n", …)`: con `-dev HTP0 -ngl 99` la riga dice ancora "to GPU" e `33/34`. Quindi l'unico discriminante G↔N è `buf`, cioè `ggml_backend_buffer_name()` (`src/llama-model.cpp:1852`), una **stringa che nessun evidence committed pinning** (il fake la inventa: `dryrun-adb.sh` con `buf_name`). L'impatto reale è limitato — il confronto è proof↔turn **dello stesso arm**, e l'identità del backend la danno le threshold sul log `-lv 5` (`arm.sh:222-242`: 33 `assigned to device GPUOpenCL` + 8 kernel per G; `execute-op` + `Hexagon Arch version` per N) — quindi nessun false-OK, ma la documentazione di `arm.sh:120-127` presenta `off` come componente che "dice DOVE vive il lavoro", mentre è solo un conteggio di layer che per due backend diversi dà lo stesso valore. La riga di calibrazione `cand=buf|` (`calibrate.sh:26`, `calibrate.sh:98-99`) è lo strumento giusto per scoprirlo sul device — ma oggi non fallisce se la stringa è degenere.
Fix: una riga nel report di calibrazione che stampi `buf` per G e N e li confronti tra loro (`test "$b_g" != "$b_n" || CALIB_FAIL buf_collision`), così la pre-flight verifica ciò che il fingerprint presume.

**A-N9 — CONFIRMED / HIGH — la calibrazione riporta SUCCESSO anche quando una proof è VOID, e in quel caso pinna comunque il floor di produzione. Dimostrato.**
`calibrate.sh:65` chiama `arm_parse_proof "$tag" "$b"` con il commento "stats only: calibration reports gates, it does not apply them" — e infatti non lo applica, **ma non controlla nemmeno `ARM_STATUS`**: il ciclo prosegue, `calibrate.sh:66-68` scrive la riga di report, e `calibrate.sh:111-112` finisce sempre con `write_end calibrated; exit 0`. E `npu_ops` (`calibrate.sh:70-72`) viene estratto da `ARM_PROOF` anche sui rami `htp_ops_low`/`no_htp_proof`, quindi il pin (`calibrate.sh:104-109`) scrive lo stesso. Prove eseguite contro il fake:
```
CALIBRATE=1 DRY_NO_CPU_PROOF=1  ->  rc=0
END.txt:  END reason=calibrated
report:   CALIB backend=cpu phase=proof status=VOID void=no_cpu_proof tokens=4 …
calib.ok: htp_ops_floor_per_tok=150.0000 measured_npu_ops=1200 measured_npu_tokens=4
```
Questo è esattamente la condizione dei round 1-2 (`assigned to device CPU` assente a `-lv 5` sul device reale): la calibrazione la rileva, la scrive nel report, e **dice successo**. L'operatore parte con la run di calore e perde ~10 minuti per un `method_void_no_cpu_proof` al turno 1 — cioè la pre-flight che il owner ha chiesto non impedisce nulla.
Fix (una riga): `if [ "$b" = npu ] && [ "$ARM_STATUS" != OK ]; then log "CALIB_FAIL backend=$b proof_void=$ARM_VOID"; write_end "calib_fail_proof_$b"; exit 3; fi` (e lo stesso per cpu/gpu, così `END=calibrated` significa "tutti e tre i backend provati").

**A-N2 — CONFIRMED / HIGH — un `kill_unverified` residuo di una run precedente con lo stesso job id avvelena una run perfettamente riuscita. Dimostrato.**
`d_run.sh:74` ripulisce solo `rm -f "$RAW/stop_request" "$END_MARKER"` — **`kill_unverified` non è nella lista** — mentre `d_run.sh:161` (`cleanup`), `d_run.sh:186` (`kill_unverified_end`) e `d_run.sh:195` (`finish_stop`) lo leggono. Il fixture `stale` (`dryrun-lib.sh:5-11`) semina solo `stop_request` ed `END.txt`, quindi il caso è invisibile alla matrice. Prova eseguita (marker seminato, tutto il resto pulito):
```
bash d_run.sh hostile3a CG 20  ->  rc=3
driver.log: DONE order=CG rows=2 ok=2
driver.log: KILL_UNVERIFIED_END (restore found the remote llama-completion still alive)
END.txt:    END reason=kill_unverified
```
Il messaggio mente (non c'era nessun processo; il pgrep del fake rispose GONE) e il codice di uscita 3 fa credere che il kill sia fallito. Sui job id che il protocollo riusa (è il caso dei retry dopo uno stop) questo **insegna all'operatore a ignorare `kill_unverified`**, cioè annulla il meccanismo fail-loud che tre round di audit hanno costruito. B ha già la forma giusta: `df26ebdc` aggiunge `"$RAW/PGREP_VERIFY_FAIL"`-equivalente (`d_run.sh:60` `rm -f … "$RAW/KILL_VERIFY_FAIL" "$RAW/PGREP_SELFTEST_FAIL"`).
Fix (una riga): `d_run.sh:74` → `rm -f "$RAW/stop_request" "$END_MARKER" "$RAW/kill_unverified"`, più il marker in `seed_stale` così il fixture lo copre.

**A-N6 — CONFIRMED / HIGH — `calib.ok` non è legato a board/kit/modello né è tracciato, e governa ogni run futura.**
`d_run.sh:105-113` legge **una sola chiave** (`htp_ops_floor_per_tok`) e ignora `job=`, `calibrated_utc=`, `measured_npu_ops/tokens` che `calibrate.sh:106-108` scrive. Nessun confronto con `MODEL_SHA`/`KIT_SHA`, nessuna scadenza. Se una calibrazione produce un tasso anomalo basso (o se in futuro cambia kit/modello), il floortoo basso disabilita di fatto la proof N per tutte le sessioni successive **senza che nulla lo segnali**: il log dirà `source=calib.ok` e sembrerà autorizzato. Inoltre `calib.ok` non è in `.gitignore` né tracciato (0 file in `git ls-files`), quindi un `git add -A` finirebbe per committare un pin device-specifico che verrebbe letto da qualunque clone.
Fix: in `d_run.sh:105-113` leggere anche `model_sha=`/`kit_sha=` dal file e rifiutare il pin se non combaciano con `MODEL_SHA`/`KIT_SHA`; aggiungere `calib.ok` a `.gitignore`.

**A-N5 — CONFIRMED / MEDIUM — il floor non ha risoluzione utile a 4 token, e la matrice annuncia un numero fisicamente impossibile.**
`PROOF_TOKENS` per `-p " " -n 4` è 4 (`arm.sh:216`; il fixture `dryrun-core.sh:151` asserisce `tokens=4`). Con `ceil(f × 4)` la risoluzione è ±1 operazione: qualunque tasso misurato fra ~0.5 e ~2 ops/token dà `min_ops` 4-8, e il gate non distingue più un dispatch parziale (una sola riga su 33 layer offloadata) da un dispatch completo. I priori stessi coprono un fattore 12 (`arm.sh:37-39`: q57 1.72, q58 3.35, q51 20.2 ops/token) e il riferimento scelto è il **minimo** ×0.5. Sul lato test: `dryrun-adb.sh:120` emette un `${DRY_HTP_OPS:-1200}` **costante**, scollegato dai token effettivi della proof, e il fixture di calibrazione asserisce `htp_ops_floor_per_tok=150.0000` (`dryrun-core.sh:157`) — **7.4× il tasso reale più alto mai osservato in questo repository**. L'aritmetica è corretta; l'evidenza è assurda, e chi legge `raw/dry-calibrate/calib/report.txt` + `calib.ok` conclude che l'S23 fa 150 ops/token.
Fix: due righe — (a) bound di sanità sul pin (rifiuta `calib.ok` se il tasso esce da [0.5, 25] ops/token, o se `measured_npu_tokens < 16`, o con un secondo campione), (b) far dipendere il fake dai token della proof (`DRY_HTP_OPS` default `tokens × 20`) così l'artefatto committato resta fisicamente possibile.

**A-N10 — CONFIRMED / LOW — due incongruenze cosmetiche del report di calibrazione.** `calibrate.sh:44` scrive sempre `htp_floor_prior_per_tok=$HTP_FLOOR_PRIOR` anche quando il floor in vigore è il pin (il caso normale dopo la calibrazione), e `arm.sh:119-126` presenta `off` come componente che "dice DOVE vive il lavoro" quando è un conteggio (`A-N8`). Fix: una riga ciascuno.

---

## 3. Race, trap, ordine cleanup/restore/END, codici di uscita, `set -u`/`pipefail`

- **CONFIRMED** — l'ordine di `cleanup` in A è corretto: `stop_arm_poll` → `stop_sampler` → `restore.sh` → marker → `write_end` (`d_run.sh:128-172`), cioè **restore prima dell'END** e l'END posseduto da cleanup (`d_run.sh:169-170`), con `exit 3`/`exit $rc` per il caso kill non verificato. Stessa forma in B (`d_run.sh:207-224`: kill → restore → `finalize_results` → `write_end`).
- **CONFIRMED** — la guardia anti-doppia-restore c'è in entrambe (`CLEANED`, `d_run.sh:131-132`; `d_run.sh:210-211`) e `exit` dentro un trap EXIT non ri-entra il trap.
- **CONFIRMED** — `arm_run`/`arm_load` coprono `set +e` intorno all'`adbT` (`arm.sh:119-121`, `arm.sh:136-138`) e `arm_kill_orphan` gira su `rc >= 124` prima di qualunque altra cosa (`arm.sh:122`, `arm.sh:139`).
- **CONFIRMED** — nessuna regressione sulle trappole delle due round precedenti: nessun `| grep -q` non protetto, nessun `local x=$(cmd)` mascherante (`arm.sh:206-208`, `arm.sh:211`), nessuna `die` in `$()`; `read -r … <<< "$(…)"` con output vuoto resta innocuo (newline dell'herestring).
- **CONFIRMED** — `PROOF_TOKENS=na` non può azzerare il floor: `arm.sh:213-215` ritorna prima del ramo npu, quindi `arm.sh:245-247` riceve sempre un intero. Se quella guardia regredisse, `awk` calcolerebbe `f*na = 0` → `min_ops=0` → gate **sempre passato** silenziosamente. È il punto più fragile del file, ed è a tre righe dalla soglia.
- **B-N1 — CONFIRMED / MEDIUM — il deadline di B è fuori dal loop di cooldown.** `d_run.sh:275-276` chiama `deadline_check` una volta **prima** di `while :;` in `cooldown_wait` (`d_run.sh:277-291`), mentre A lo chiama **dentro** il loop (`d_run.sh:197`). Con `COOL_MAX_S=720` una B può sforare il budget di deadline fino a 12 minuti per cooldown, proprio nel caso (board calda) in cui il deadline dovrebbe mordere. Fix: spostare la chiamata dentro il `while`.

## 4. Aritmetica

- **CONFIRMED** — i priori sono ricalcolati e citati correttamente in `arm.sh:37-39`: q57 `pp512×2 = 1764/1024 = 1.72`, q58 `n=1024 = 3430/1024 = 3.35`, q51 `pp16+tg8 = 484/24 = 20.2`; il pavimento è il **minimo**/2 = 0.86 e la soglia è `ceil(0.86 × 4) = 4` (asserto da `dryrun-core.sh:27,70`). L'aritmetica è corretta.
- **A-N5** (sopra) copre la risoluzione, il fattore 12 e l'assenza di bound.
- **CONFIRMED** — il `ceil` di `arm.sh:247` è implementato bene (`x==int(x) ? int(x) : int(x)+1`) e non ha il bug classico del floor-inteiro per valori negativi/zero; con `tokens=0` darebbe 0, ma `PROOF_TOKENS ≥ 1` è garantito da `arm.sh:216` quando `ARM_RUNS ≥ 0` e `ARM_PROMPT_N ≥ 1` (una proof senza token già è `proof_run_fail`).

## 5. Igiene dei test: un fixture può passare col percorso reale rotto?

Sì, in tre modi, e uno è una falsa-vera rottura dimostrata.

1. **A-N2 — il fixture `stale` non semina `kill_unverified`** (`dryrun-lib.sh:5-11`), quindi la matrice verde non copre il caso che ho dimostrato rotto. È l'unico caso in cui un fixture *avrebbe potuto* chiudere un blocker e non lo fa.
2. **A-N5 — il fake non scala le `execute-op` con i token** (`dryrun-adb.sh:120`): le tre regole di floor (prior 2→min 4, pin 500→min 600, calibrazione 1200/4→150) sono esercitate **solo come aritmetica**, mai contro un conteggio proporzionale ai token della proof, che è l'unica cosa che il device farà. Nessun fixture può distinguere "floor corretto" da "floor applicato a un numero che il device non produce".
3. **A-N9 — il fixture `calibrate` asserisce `assert_end cal calibrated`** (`dryrun-core.sh:147`) su un percorso in cui le proof **non sono applicate**: quindi la matrice *incoraggia* esattamente il difetto che ho dimostrato (successo a proof VOID). Il test verifica il codice di uscita ma non la precondizione che dovrebbe proteggerlo.
4. **Confermato come NON circolare** (miglioramento reale): il fingerprint è esercitato nelle due fasi con forme **letteralmente** uguali a `src/llama-model.cpp:1845,1852` (`dryrun-adb.sh:173-176`), l'handshake del sampler è un protocollo vero (`H sampler_start/done` + `grep -c`, `dryrun-adb.sh:219-233,296-297`), e il self-test di `pgrep` è modellato con un victim's存活 e un kill reale (`pgrep-broken` asserisce anche "nessun load, nessun turno"). Resta una classe di circolarità non evitabile da un fake: **se `-lv 4` non ammettesse davvero le righe INFO, il fake le emetterebbe lo stesso** — l'unica evidenza non circolare su questo punto è la verifica in sorgente che ho fatto io, che è positiva.
5. **CONFIRMED** — il `calib.ok` prodotto dal dry-run **non** è una trappola persistente: `dryrun-lib.sh:44` lo rimuove tra un fixture e l'altro e dopo la mia run non esiste più. Resta il caso di un dry-run interrotto a metà, che lascerebbe in giro il pin finto (da qui A-N6).

## 6. Codice morto (ultimo, come chiesto)

- **A — nessun dead code bloccante.** `HTP_FLOOR_SOURCE` (`d_run.sh:105-113`) è usato solo nella riga di log `d_run.sh:99`: strumentazione, non morto. `calib_candidates` (`calibrate.sh:26-37`) emette anche le famiglie `fit|` e `htpwarn|`, che **nessun gate consuma** (il fit è esplicitamente escluso dal fingerprint, `arm.sh:126-127`): è diagnostica trattenuta di proposito, ma presentata come "candidates" accanto a quelle che il gate usa — una riga di etichetta (`# informational only`) evita che un operatore legga `cand=fit|` come un input di gate.
- **A — residui fragili**: `arm.sh:69` `n="${3:-$DECODE_N}"` non valida il parametro (un `n` non numerico passerebbe `%d` → 0); `sampler.sh:32-40` `stop_sampler` non resetta `SAMPLER_PAUSED`, quindi un `sampler_resume` post-stop (non raggiungibile oggi) rilnaccherebbe il sampler.
- **B — nessun dead code bloccante.** `FINALIZED` è impostato a 1 **prima** del controllo `[ -f "$RESULTS" ]` e prima dell'`&& mv` (`d_run.sh:305-307`): se l'`awk` fallisce, il file resta non finalizzato ma il flag dice "fatto" e `cleanup` non ritenta (**B-N2, LOW**). Fix: impostare `FINALIZED=1` dopo il `mv`.
- **B — portato dal round 1, ancora aperto, LOW**: `arm_parse_measure` non confronta le due copie del conteggio (`decoded <N> tokens` e `n_predict = <N>`) presenti nella stessa riga del log reale; una riga di formato diverso passerebbe con un N solo.

---

## 7. Riepilogo per cella

**A) qdc-heat-3way — ready: NO.** Meccanica e sicurezza sono solide (16+8 finding chiuse, nessuna regressione, il fingerprint è verificato in sorgente e il mio sospetto di blocker su `off` era infondato). Ma due percorsi producono **verdetti di sessione falsi**: la calibrazione dichiara `calibrated`/`rc=0` anche con una proof VOID (A-N9, dimostrato) e un marker `kill_unverified` residuo fa terminare una run pulita con `END reason=kill_unverified`/`rc=3` (A-N2, dimostrato). Entrambi sono di una riga. Aggiungere A-N3 (il sampler 1 Hz sopravvive al SIGKILL) e A-N6 (pin non legato al board) per completezza.

**B) spec-dspark-gpu-draft — ready: sì, con riserve.** Tutte le 8 finding del round 2 sono chiuse con codice corretto e fixture dedicate; `-t 5` è applicato a proof e misura; il kill è verificato e verificabile su ogni uscita, compresa la morte del padre; lo schema a 18 colonne è stabile su ogni percorso; il restore non perde i valori pre-run. Unico medium: il deadline non è controllato dentro il cooldown (B-N1). Low: `FINALIZED` prematuramente a 1, `DEADLINE_S` bypassa il range 20..110, nessuna pre-flight tipo calibrazione per le righe di placement a `-lv 5` (la prima run B è la scoperta, mentre A ha `CALIBRATE=1` per lo stesso motivo), e il cross-check mancante su `decoded N` vs `n_predict = N`.
