# AUDIT 2 — riesame ostile delle fix dd6bdb56 (commit `a474dd03`), solo critica

Eseguito: `./dryrun.sh` rieseguito da me → **EXIT=0, SUMMARY pass=147 fail=0** (confermato). Lettura di `d_run.sh`, `arm.sh`, `restore.sh`, `fake-adb.sh`, `dryrun.sh`, `REPORT.md`, `PLAN.md`; confronto con `../qdc-heat-3way/{stop_lib.sh,battery_trust.sh,arm.sh}`. Nessun telefono, nessun adb vero, nessun sub-agent, nessuna patch. Compone la sezione B; la sezione A è in `scratchpad/agents/qdc-heat-3way/AUDIT2-dd6bdb56.md`.

| cella | ready for the phone |
|---|---|
| **B) spec-dspark-gpu-draft** | **NO** — un solo blocco (item 5 del mandato: `-t 8` ancora sugli arm di device), più due residui di robustezza |

Tutte le 12 finding del round 1 sono **meccanicamente chiuse**, incluso il kill su ogni uscita anomala che avevo dimostrato mancante. Restano un item aperto (−`t 5`), due difetti nuovi sulla restore/rigenerazione di `results.tsv` e il buco fail-closed di `pgrep` condiviso con la cella A.

---

## 1. Esito delle finding di `AUDIT-dd6bdb56.md`

| # | esito | evidenza |
|---|---|---|
| B-1 | **FIXED** | `kill_spec_verified` (`d_run.sh:89-115`) con pkill + pgrep a 3 tentativi e verdetto `GONE/ALIVE/PGREP_BROKEN`; chiamato da `cleanup` (`d_run.sh:143-152`), `finish_stop` (`d_run.sh:180-182`), `arm_poll_loop` (`d_run.sh:138-139`), timeout di proof e misura (`d_run.sh:265`, `d_run.sh:296`). Fixture `sigterm` (`dryrun.sh:225-228`, END `signal_TERM` + `KILL_VERIFY … result=gone`) e `killfail` con `DRY_KILL_FAIL=1` (`dryrun.sh:278-282`, `result=ALIVE` registrato). Il mio test manuale di prima round troverebbe oggi `pkill.log` popolato. |
| B-2 | **FIXED (con NEW-1)** | `restore.sh` standalone (61 righe, state default `null` a `:33`); `d_run.sh:339-343` ripara lo stato stale **prima** di ogni setup e si rifiuta di proseguire se il file è ancora lì (`STALE_RESTORE_STILL_PRESENT`, `exit 7`). Fixture `sigkill` + re-run. Residuo: NEW-1. |
| B-3 | **FIXED** | `d_run.sh:433-439`: `finalize_results void ""`, `KILL_NEEDED=1`, `write_end match_void`, **`exit 3`**; sul percorso matched `finalize_results matched "$matched_tags"` (`d_run.sh:429`) e colonna `final` (`d_run.sh:233-250`). Fixture `matchvoid`. |
| B-4 | **FIXED** | `cooldown_wait` (`d_run.sh:207-222`) prima di **ogni** run di device (`d_run.sh:256` in `run_proof`, `d_run.sh:285` in `run_measure`), cap 720 s con `warm_start=1`, e colonne `skin_before/skin_after` per ogni riga (header `d_run.sh:383`). Fixture `cooldown`. |
| B-5 | **FIXED** | `arm_cmd` (`arm.sh:46-59`): `mode=proof` → `-lv 5` + `GGML_OPENCL_LOG_KERNELS=1`; `mode=measure` → default verbosity e **nessuna** env kernel. Il debug non entra più nella finestra misurata e il bias C-vs-B sparisce. |
| B-6 | **FIXED** | `MATCH_MAX=4` (`d_run.sh:26`) e fake con `DRY_JITTER=1` (`o = nmax` invece di `nmax+1`) così che un aggiustamento non basta **per costruzione**; fixture `jitter` (15 righe, `B4-m2`, `MATCH ok n=136`). Il metodo è ora dimostrato su un fake non affine, non su un'identità aritmetica. |
| B-7 | **FIXED (residuo NEW-4)** | il push multi-GB gira sotto il poll (`d_run.sh:368` `start_arm_poll`, `:373` `stop_arm_poll`), con check di `stop_request` (`:374`) e gate `safety_gate after_push` (`:375`). Residuo: `tar -xzf`/`sha256sum -c` (`:376-377`, fino a 120 s) restano fuori dal poll. |
| B-8 | **FIXED** | `source "$CELL/../qdc-heat-3way/battery_trust.sh"` (`d_run.sh:81`) e `battery_trust_check` (`d_run.sh:363`); il log di setup stampa `untrusted=` (`d_run.sh:381`). Quindi la skin ≥ 46 °C **non** è più disarmata alla cieca. Fixture `untrusted`. |
| B-9 | **FIXED** | `d_run.sh:173` `trap 'on_signal HUP 1' HUP`, fixture `sighup`. |
| B-10 | **FIXED** | il subshell del poll ha `trap … TERM INT HUP` che uccide il proprio child adb (`d_run.sh:130`) e controlla `kill -0 "$DRIVER_PID"` (`d_run.sh:134`), con `DRIVER_PID=$$` (`d_run.sh:80`). Fixture `sigkill` asserisce che il poll muore col padre. |
| B-11 | **FIXED** | il fake emette i prefissi `<h>.<mm>.<ss>.<ms> <L> ` su tutte le righe logger (`fake-adb.sh:136, 146, 148, 153, 156`) e lascia `EXIT=` e `GGML_OPENCL_LOG_KERNELS:` senza prefisso, come sul device; il fixture `happy` asserisce entrambe le direzioni (`dryrun.sh`, `REPORT.md:47`). |
| B-12 | **FIXED** | `arm.sh:90-94`: `marker -gt 1` e `pre_place -ge 1`, altrimenti `model_order_unknown` invece di contare il segmento sbagliato. |
| (2) `ARM_TPS` | **FIXED** | `arm.sh:140` `case "$ARM_TPS" in ''\|*[!0-9.]*) ARM_VOID=no_stats; ARM_TPS=na; return 0` — la metrica primaria non può più sparire con `status=OK`. |

## 2. Finding nuove

**NEW-0 — CONFIRMED / BLOCCANTE (item 5 del mandato) — gli arm di device corrono ancora `-t 8`.**
`arm.sh:57` contiene `-t 8` nel **comando unico** usato sia per la proof sia per la misura. La regola del proprietario è `-t 5` (preset S23 `sd-8-gen2` decode5/prefill5, `kalsa/src/engine/deviceTuning.ts:217-219`), gli script host della cella sono già stati riallineati a `-t 5` (`host_calib.sh:28`, `host_smoke.sh:29`) e la cella sorella è stata allineata **sul device** in `qdc-heat-3way/arm.sh:71,81` (`-t 5`, owner decision citata in `arm.sh:17`). La giustificazione in `REPORT.md:60` — "Device arms stay `-t 8` … the sister cell's device arms also run `-t 8`" — si appoggia a un premesso che `5ba47a93` ha invalidato: dalla data del commit la cella A **non** usa più `-t 8` sul device. Conseguenze: i numeri di B non sono confrontabili con gli arm della cella A, e si misura con 8 thread invece del preset dell'app che è la base di tutte le previsioni in `PLAN.md`.
Fix: `-t 8` → `-t 5` in `arm.sh:57`, più la riga `REPORT.md:60` e le previsioni di `PLAN.md` se dipendono dai thread.

**NEW-1 — CONFIRMED / MEDIUM — `restore.sh` cancella `.restore-state` anche quando il restore è fallito.**
`restore.sh:55` `rm -f "$CELL/.restore-state"` sta dentro `if [ "$STATE_PRESENT" -eq 1 ]` ma **fuori** da qualsiasi test di `rc`: se una `settings put` fallisce (o `RESTORE_BAD_STAYON`/`RESTORE_BAD_TIMEOUT`, `restore.sh:47,52`) il file con i valori pre-run viene comunque distrutto. Di conseguenza `d_run.sh:341-342` vede il file sparire, non scatta `STALE_RESTORE_STILL_PRESENT`, e la sessione riparte sovrascrivendo con i valori **già mutati** (1800000/3): il fallimento viene silenziosamente accettato. La cella A fa il contrario di proposito (il suo `restore.sh` non cancella mai lo stato, così il restore è ritentabile) — i due restore non sono equivalenti.
Fix (una riga): `rm -f "$CELL/.restore-state"` sotto `if [ "$rc" -eq 0 ]`.

**NEW-2 — CONFIRMED / MEDIUM — dopo un SIGKILL del driver il binario continua a girare senza supervisione: il poll esce senza killare.**
`d_run.sh:134` `kill -0 "$DRIVER_PID" 2>/dev/null || exit 0`: il poll riconosce la morte del padre e **usce pulito**, senza toccare il processo remoto. Sul telefono `llama-speculative-simple` resta a pieno carico (target + drafter) per tutto il tempo che manca al turno, con `screen_off_timeout` e `stay_on` già mutati e nessun `stop_request`. L'unicapulizia è il `pkill` non verificato del `restore.sh` successivo (`restore.sh:43`) o manuale.
Fix (una riga): `kill_spec_verified "parent_gone" || true` prima di quell'`exit 0`.

**NEW-3 — CONFIRMED / MEDIUM — `results.tsv` ha 17 colonne sui percorsi che escono prima di `finalize_results` e 18 sui due percorsi finali.**
L'header nasce a 17 colonne (`d_run.sh:383`) e la colonna `final` viene **appesa** da `finalize_results` (`d_run.sh:233-250`, `NR == 1 { print $0, "final" }`). Ma `finalize_results` è chiamata solo sui due percorsi finali (`d_run.sh:429`, `:433`): `finish_stop` (`d_run.sh:176-183`) e tutti gli `exit 5/6/7` successivi all'header (`d_run.sh:342, 348, 357-370`) escono con il file a 17 colonne e senza `final`. Un'analisi che fissa `final=matched|void_match` va in crash proprio sulle sessioni **interessanti** (stop a metà).
Fix: scrivere l'header a 18 colonne includendo `final`, e far riscrivere a `finalize_results` solo il valore dell'ultimo campo invece di appenderlo.

**NEW-4 — CONFIRMED / LOW-MED — residuo di B-7: `tar -xzf` e `sha256sum -c` fuori dal poll.**
`d_run.sh:368-373` copre il push, ma `d_run.sh:376-377` (`adbT 120 … tar -xzf`, poi la verifica dei sum) gira senza `start_arm_poll`; il gate successivo è `safety_gate setup` (`d_run.sh:379`). Finestra non sorvegliata fino a ~2 minuti, proprio mentre il kit viene scritto su `/data/local/tmp`. Fix: spostare `start_arm_poll`/`stop_arm_poll` attorno a `:376-377` (stesso pattern di `:368-373`).

**NEW-5 — CONFIRMED / LOW — il buco fail-closed di `pgrep -f`, variante B.**
`d_run.sh:97-105` è ben più robusto di A (verdetto esplicito `PGREP_BROKEN` quando la rc ∉ {0,1}, 3 tentativi, marker `KILL_VERIFY_FAIL`), ma resta lo stesso buco: se il `pgrep` del device rifiuta `-f` **restituendo 1** (comportamento busybox) invece di 126 (toybox), il ramo `GONE` scatta e il kill viene dichiarato verificato a false. Su S23/Android 13 è toybox, quindi il rischio è basso, ma è lo stesso errore di classe che A-4 chiedeva di chiudere.
Fix (una riga): `pgrep -f zzz_no_such_proc_zzz; echo PROBE=$?` e `GONE` accettato solo con `PROBE=1`.

**NEW-6 — CONFIRMED / LOW — `request_stop` della libreria condivisa logga una verifica di kill per un binario che questa cella non usa mai.**
`stop_lib.sh:69-82` (sourced) esegue e verifica `pkill/pgrep` su `llama-completio[n]`: su ogni stop di B finisce con `KILL_VERIFIED ctx=stop_…` per un binario **mai targettato** (l'unico `llama-speculative-simple` in gioco è quello del driver, in un altro processo). Il verdetto vero è la riga `KILL_VERIFY` di `kill_spec_verified`, ma due messaggi con lo stesso significato contrario in un solo log sono un'`indicazione` falsa. Fix: rendere il pattern una variabile (`KILL_PATTERN`) dichiarata dal caller, o rinominare la riga della libreria in `KILL_PROBE`.

**NEW-7 — PLAUSIBLE / LOW — la soglia "≥4 kernel distinti" per i bracci C è ora valutata su una proof da 4 token.**
`arm.sh:26` `PROOF_N=4` e `arm.sh:96` conta le righe `GGML_OPENCL_LOG_KERNELS:` nel blocco post-marker. Le righe kernel sono `fprintf` una volta per kernel unico, e il path di caricamento (convert/restore trans4) ne produce già diverse, quindi 4 dovrebbe passare — ma è una soglia pensata per "any drafter step" e ora valutata su 3 token, senza evidenza. Il fake emette sempre 6. Fix: abbassare la soglia a 3 o registrare la prova su un `-n` della proof più lungo.

**NEW-8 — CONFIRMED / LOW — nessun deadline in B.**
La cella A ha `deadline_check` nel loop e nel cooldown (`d_run.sh:104-107`); B non ha alcun limite di tempo, e con 5 proof + 5 probe + fino a 4×5 aggiustamenti = **30 run di device**, ognuno con un model load completo da ~1.6 GB, la sessione può superare ampiamente il budget tipico di una finestra di misura. Fix: `deadline_check` come in A dentro `run_proof`/`run_measure` e nel `cooldown_wait`.

## 3. Le cinque domande, risposte per questa cella

1. **Ogni percorso di stop di DSpark è coperto?** **Sì, tutti e sette.** Li ho enumerati uno a uno: `safety_gate before_setup` (`d_run.sh:362`), `cooldown_wait` (`:213`), `arm_poll_loop` (`:138-139`), timeout di proof (`:265`) e di misura (`:296`), `stop_request` in `run_proof`/`run_measure` (`:255`, `:284`), `finish_stop` (`:180-182`), `cleanup` su qualunque rc ≠ 0 / signal / `KILL_NEEDED` (`:148-151`), più la finestra di push sotto poll (`:368-374`). Ogni ramo arriva a `kill_spec_verified`, che verifica con `pgrep` e registra `KILL_VERIFY_FAIL` se non può. L'unico buco **non** è un percorso di stop ma la supervisione: dopo un SIGKILL del padre il poll esce senza killare (NEW-2). Nota minore: la libreria condivisa continua a loggare una verifica per il binario sbagliato (NEW-6).
2. **Il fingerprint backend (cella A) può passare sul backend sbagliato?** Vedi `AUDIT2` sezione A, NEW-2 e NEW-3: sì, due componenti su tre non hanno evidenza device per G/N e la fit line riporta il valore richiesto, non il piazzamento. B non ha ancora un fingerprint: la sua prova è solo sulla proof run a `-lv 5` (`arm.sh:76-113`), quindi **non** ha il buco, ma nemmeno la protezione — se la proof e il turno divergessero sul device, B non se ne accorgerebbe. Fix suggerito se si vuole parità: un `-lv`-free check di default-level sul turno (es. presenza/assenza delle righe di discovery) confrontato con la proof.
3. **`pgrep`/`pkill` fail-closed su un phone senza `pgrep -f`?** B: sì con `PGREP_BROKEN` esplicito e marker, con il residuo NEW-5 (rc 1 su errore d'uso). A: sì con `PGREP_RC=1` come unico pass, con lo stesso residuo.
4. **Restore esatto dopo SIGKILL?** Il percorso è corretto (`restore.sh` standalone, stato stale riparato e mai sovrascritto, fixture dedicate), ma **NEW-1** rompe la garanzia nel caso in cui il restore stesso fallisca: lo stato viene cancellato e la sessione successiva accetta il silenzio. Finché `rm -f` è incondizionato, "restore esatto" è vero solo nel caso felice.
5. **`-t 5` su ogni arm?** **No**: `arm.sh:57` è ancora `-t 8` per proof e misura (NEW-0). Gli script host sono `-t 5` ✓, la cella sorella è `-t 5` sul device ✓.

## 4. Priorità

**Bloccante:** NEW-0 (`-t 8` → `-t 5`, una riga in `arm.sh:57` + la giustificazione `REPORT.md:60` da aggiornare).
**Da chiudere prima del device:** NEW-1 (`rm` condizionata a `rc=0`), NEW-2 (kill sul padre morto), NEW-3 (header a 18 colonne), NEW-5 (probe di salute di `pgrep`).
**Minori:** NEW-4 (poll attorno a `tar`), NEW-6 (verifica di kill fuorviante), NEW-7 (soglia kernel su 4 token), NEW-8 (nessun deadline).
