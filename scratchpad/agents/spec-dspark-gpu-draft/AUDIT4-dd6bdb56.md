# AUDIT 4 — riesame ostile delle fix di AUDIT3, cella B `spec-dspark-gpu-draft` a `1eb93681` (read-only)

Verificato da me: `./dryrun.sh` rieseguito → **EXIT=0, pass=209 fail=0** (confermato). `bash -n` pulito su tutte le 8 script. Prove empiriche eseguite contro `fake-adb.sh` con `ADB_BIN` inesistente (nessun telefono, nessun adb vero, nessun sub-agent, nessuna patch; artefatti rimossi). Cella A non toccata.

| cella | ready for the phone |
|---|---|
| **B) spec-dspark-gpu-draft** | **NO — 1 blocker di validità** (una riga), nessun blocker di sicurezza |

I tre fix di round 3 sono chiusi e bene coperti; il quarto (mio) è chiuso solo per metà. Il blocker non è nuovo: è il buco di evidenza lato-turno che avevo segnalato al round 2 e che questa cella non ha mai adottato, e che diventa visibile solo ora che le altre finding sono chiuse.

---

## 1. Esito delle finding AUDIT3 (B)

| # | esito | riga letta |
|---|---|---|
| **B-N1** deadline fuori dal loop di cooldown | **CLOSED** | `d_run.sh:281-285` `while :; do` → `deadline_check` **prima** di ogni `live_readings`, con il commento "checked on EVERY iteration … a cold board can spin here for COOL_MAX_S=720". L'overshoot è ora limitato a **un** `COOL_POLL_S` (15 s) + un round trip, non a 12 minuti. Fixture `deadlinecool` (`dryrun.sh:344-356`: `DEADLINE_S=8 COOL_MAX_S=30 DRY_SKIN_AFTER=38.5` → `rc 124`, `END deadline`, `rows 0`, nessun `COOLDOWN_CAP`, ≥4 letture di sicurezza, kill verificato, restore eseguito) **con negative control eseguito**: il commit riporta che ri-patchando il check pre-loop il fixture fallisce (`rows 1`, cap prima) e la matrice esce 1. È l'evidenza di igiene più forte presente in una delle due celle. |
| **B-N2** `FINALIZED` impostato prima della riscrittura | **CLOSED** | `d_run.sh:310-330`: `[ -f "$RESULTS" ] \|\| { FINALIZED=1; return 0; }` (file assente = nulla da finalizzare) e poi `if awk … > "$tmp" && mv "$tmp" "$RESULTS"; then FINALIZED=1; else rm -f "$tmp" 2>/dev/null || true; fi; return 0`. Il flag è ora posto **solo** dopo `awk`+`mv` riusciti; un fallimento mantiene 0 e ripulisce il temp. Nessun fixture (dichiarato: serve un fault del filesystem iniettabile) — accettabile perché lo stato di fallimento è **fail-safe** (vedi N-B6). |
| **B-N3** nessuna evidenza di backend **lato turno** | **STILL OPEN** | `arm.sh:108` è l'unico check `kernel set failed to build\|device disabled` ed è dentro `arm_parse_proof`, sul log `-lv 5`; `arm_parse_measure` (la funzione che valida la riga **misurata**) non ha nessun check negativo, e il comando misurato è a verbosity default senza env kernel (`arm.sh:52-57` `measure) : ;;` → `lv=""` `envk=""`). Dettaglio e conseguenza in **N-B2** sotto. |
| **B-N4** nessun cross-check `decoded N` vs `n_predict = N` | **CLOSED** | `arm.sh:145-156`: `n_dec=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="decoded") print $(i+1)}' …)`; `case "$n_dec" in ''\|*[!0-9]*) ARM_VOID=count_mismatch …` e `if [ "$n_dec" != "$ARM_N" ] …`. Verificato sul formato reale `raw/calib_armA127.log:20` `decoded  128 tokens in  3.192 seconds, speed:  40.101 t/s` → il campo `decoded` è il 4°, `$(i+1)`=`128` ✓, e la riga `encoded   77 tokens` **non** può essere scelta (serve uno spazio prima di `decoded`, in `encoded` c'è `n`). Fixture `countmismatch` (`DRY_N_DECODED_MISMATCH=1` → `decoded=n_predict+7`): 5 probe void, `END match_void`, `rc 3`, 10 righe, `final` 5 proof / 5 void / 0 matched ✓. |
| **B-N5** `DEADLINE_S` bypassava la validazione 20..110 | **CLOSED per il path di default, STILL OPEN come meccanismo** | `d_run.sh:33-37` `if [ -n "${DEADLINE_S:-}" ] && [ "$ADB_BIN" = "/opt/homebrew/bin/adb" ]; then … exit 2; fi`, dichiarato "dry-run hook only, so it is refused with the real adb". Fixture `deadlines-guard` con `env -u ADB_BIN DEADLINE_S=1` → `rc 2`, messaggio, e asserisce **che nessun RAW e nessun `.restore-state` siano stati creati** ✓ (la posizione della guardia è corretta, l'ho verificata anche a mano: guardia a :33, `mkdir -p "$RAW"` a :57). Ma è una guardia **per stringa di path**: vedi **N-B1**, dimostrato. |

### La rejection di mimo (pre-flight CALIBRATE-style per B) — d'accordo, con una riserva

Le ragioni addotte ("the proof pass already voids the session fail-closed before any measured arm") **sono corrette sul merito**: il pass di proof gira su tutti e cinque gli arm **prima** di qualunque run misurato (`d_run.sh` proof loop → probe loop), `arm_parse_proof` fallito porta a `DEAD[$i]=1` → l'arm non viene misurato → `match_state` vede un N vuoto → `ALL_EQ=0` → dopo `MATCH_MAX` round `finalize_results void` + `END match_void` + `exit 3`. Quindi **nessuna riga misurata può essere attribuita a un backend non provato**, che era la mia preoccupazione: una modalità calibrazione aggiungerebbe principalmente un report e un risparmio di tempo, non sicurezza.

La riserva: l'assunzione che le righe di placement a `-lv 5` **esistano** sull'S23 resta non verificata (è la stessa incognita che ha bloccato la cella A ai round 1-2). Senza pre-flight, la prima run B è anche il test, e il costo di essere sbagliati è **una sessione persa**, non una misura sbagliata — e la diagnosta è già nella colonna `proof` (`draft_gpu_assign=0/5 kernels=0/4`, `pre_place=…`). Quindi: rejection accettata; se un giorno la run B fallisce con `no_gpu_proof` su C4/C8, il fix non è un CALIBRATE mode ma una riga di `-lv` o un threshold diverso.

---

## 2. N-B2 — CONFIRMED / HIGH / BLOCCER: una riga misurata può essere registrata su un backend che nel turno non era quello provato

**Meccanismo.** La prova del backend di B è tutta sul **proof run** a `-lv 5` (`arm.sh:53` `proof) lv=" -lv 5"`, `arm.sh:82-113` placement + dispatch + ordine dei modelli). Il **turno misurato** gira invece a verbosity default e senza env kernel (`arm.sh:55-56`), quindi nel suo log non compaiono né le righe di placement (`LLAMA_LOG_DEBUG`, `src/llama-model.cpp:1526`, nascoste sotto la soglia di default) né i `GGML_OPENCL_LOG_KERNELS:` (env assente) né — soprattutto — **nessun check di fallimento**. `arm_parse_measure` (`arm.sh:131-165`) valida solo: file presente, `EXIT=0`, `n_predict` numerico, `tps` numerico, `decoded`==`n_predict`, e per l'arm A che `n_drafted==0`. **Niente lega il turno alla prova.**

**Il buco concreto per gli arm C4/C8.** Con `--spec-draft-n-max 4 -devd GPUOpenCL -ngld 99` (`arm.sh:41-42`), se il contesto OpenCL si perde *fra* la proof e il turno (context loss, driver reset, throttling termico prolungato), llama.cpp non è obbligato ad abortire: l'inizializzazione speculativa può proseguire con il drafter su CPU. Il run termina con `EXIT=0`, la riga `decoded … speed:` è prodotta, e la riga viene scritta come `C4 … OK` con un t/s **da drafter CPU**. Il check che avrebbe colpito, `kernel set failed to build|device disabled` (`arm.sh:108`), è **solo** sul log della proof, e il check che la cella A ha adottato per lo stesso caso (`qdc-heat-3way/arm.sh:236-240`, dentro `arm_parse_turn`, `turn_backend_disabled`) qui non esiste. Nessun'altra riga di `results.tsv` (`skin_before/after`, `cooldown_s`, `wall_s`) distingue un drafter GPU da uno CPU: il `pre_place` e `kernels` provano la proof, non il turno.

**Perché è un blocker e non un low.** L'output della cella è *una tabella di 5 t/s* in cui la riga C4/C8 è "drafter su Adreno". Senza evidenza lato-turno, quel numero è auto-attestato dalla prova di un *processo diverso*. La probabilità è bassa (serve un fallimento OpenCL in mezzo), ma la classe di fallimento è esattamente quella che tre round di audit sulla cella A hanno exists insegnato a non accettare, e qui la difesa è **una riga**.

**Fix (una riga, lo stesso pattern della cella A).** In `arm_parse_measure`, prima di `ARM_STATUS=OK`:
```bash
if awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}' "$logf"; then
  ARM_VOID=turn_backend_disabled; return 0
fi
```
Se si vuole il paragone completo con A, l'estensione naturale è un fingerprint di placement sul turno (l'equivalent di `buf`/`off`/`thr`) confrontato con la proof — ma anche il solo check negativo chiude il caso silenzioso più pericoloso.

## 3. N-B1 — CONFIRMED / MEDIUM: la guardia `DEADLINE_S` è per path, quindi il bypass sopravvive con qualunque altro adb reale

`d_run.sh:34` confronta `$ADB_BIN` con la **stringa** `/opt/homebrew/bin/adb`. Con qualunque altro percorso reale — `/usr/local/bin/adb`, il path dell'SDK, o semplicemente `adb` (risolto dal PATH) — la guardia **non scatta** e `DEADLINE_S` viene onorato anche in una run vera. Dimostrato (nessun device toccato, adb inesistente sul path):
```
A) env -u ADB_BIN DEADLINE_S=1        -> rc=2  "DEADLINE_S is dry-run-only"   RAW=none
B) ADB_BIN=/nonexistent/…/adb DEADLINE_S=1
                                     -> rc=2  RAW=CREATED   log: NO_DEVICE
```
Il caso B mostra che la guardia non è scattata e che lo script è arrivato alla detection del device: con un adb reale e un telefono collegato, la sessione farebbe `wakeup`/`stayon`/`screen_off_timeout=1800000` e partirebbe il push multi-GB **sotto un budget di 1 secondo**, per poi morire al primo `deadline_check` dentro `cooldown_wait`. Il restore c'è (stato e trap sono già armati a quel punto) e la cleanup uccide+verifica (`cleanup` `d_run.sh:216-220`), quindi **nessun danno permanente** — ma la guardia non è quello che il commit dichiara ("no unvalidated range bypass"). Fix (una riga): onorare `DEADLINE_S` solo quando il dry-run è davvero in corso, cioè su una capacità e non su un path — `if [ -n "${DEADLINE_S:-}" ] && [ -z "${FAKE_ADB_STATE:-}" ]; then exit 2; fi` (il dry-run imposta sempre `FAKE_ADB_STATE`, vedi `dryrun.sh` `env … FAKE_ADB_STATE="$STATE"`).

## 4. Altre finding nuove (nessuna di sicurezza)

**N-B3 — CONFIRMED / LOW — la cleanup di B non escala l'end quando il kill non è verificabile.** `d_run.sh:213-220`: `kill_spec_verified … || true`, poi restore, poi `finalize_results`, poi `write_end exit_$rc`. Quindi una fine per deadline o signal con kill non verificato scrive `END=deadline` (o `signal_TERM`) e conserva `rc=124`/`143`, e l'unica traccia è `KILL_VERIFY_FAIL` (`kill_spec_verified`) più la riga di log `KILL_VERIFY … result=ALIVE`. La cella A scala invece a `END kill_unverified`/`exit 3` (`qdc-heat-3way/d_run.sh:161-170`) mantenendo il rc originale. È fail-safe (l'informazione c'è) ma un lettore del solo `END.txt` non vede il kill fallito. Fix: una riga che appenda il suffisso, come in A.

**N-B4 — CONFIRMED / LOW — `d_run.sh` accetta qualunque `ADB_PORT`, il suo `restore.sh` no.** `d_run.sh:22-23` `ADB_PORT="${ADB_PORT:-5037}"` senza `case`; `restore.sh:21` `case "$ADB_PORT" in 5037|6037|6039) ;; *) exit 2`. Una run lanciata con una porta non ammessa (es. 5038) muterebbe il device e alla fine `restore.sh` **rifiuterebbe di eseguire** (`exit 2` prima di toccare qualsiasi cosa) lasciando `screen_off_timeout=1800000` e `stayon=3` sulla board. La cella A valida la porta nel driver (`qdc-heat-3way/d_run.sh:46-47`) ed è la ragione per cui lì il restore non può essere rifiutato. Fix: copiare il `case` di A in `d_run.sh`.

**N-B5 — CONFIRMED / LOW — l'uguaglianza `decoded == n_predict` che il nuovo check assume è verificata solo su log host.** `raw/calib_armA127.log:20,23` mostra `decoded  128 tokens` e `n_predict = 128` su M-series, cioè l'ipotesi è solida e lo stesso engine gira sul device; ma se la build S23 dissentisse, **tutte e cinque** le probe diventerebbero `count_mismatch` → `END match_void`, `rc 3`, zero dati. Rischio sicuro (void, non misura falsa) e già diagnosticabile: la colonna `proof` della riga riporta `decoded=… n_predict=…` (`arm.sh:148,153`). È un nuovo modo in cui una prima run può produrre nulla; va detto nel REPORT accanto alla rejection del pre-flight.

**N-B6 — CONFIRMED / LOW — `final=pending` è uno stato "sconosciuto" che nessuno asserisce.** Se `awk`/`mv` fallisce in `finalize_results`, `FINALIZED` resta 0 ma `cleanup` finalizza **una sola volta** (`d_run.sh:226`): il file resta a 18 colonne con `final=pending` ovunque e l'END marker è normale (`exit_0`/`signal_*`). Il fallimento è fail-safe (`pending` non è un valore di validità che `finalize_results` produca mai — i suoi valori sono `void|proof|matched|superseded|void_match`), ma nessuna riga del REPORT dice al consumatore che `pending` è da scartare. Fix: una riga nella sezione di consumo del REPORT.

**N-B7 — PLAUSIBLE / LOW — il kill `parent_gone` del poll può fallire proprio quando serve.** `d_run.sh:190-194`: se il driver è SIGKILLato, il poll esegue `kill_spec_verified "parent_gone"` fino a 3 tentativi con `sleep 1` e due adb da 15 s ciascuno: se il device è irraggiungibile in quel momento (cavo caduto, WiFi perso — lo stesso evento che ha ucciso il driver), il probe `PROBE` non è `1` → `KILL_VERIFY_FAIL … pgrep_broken` e l'orfano sopravvive fino alla fine dell'arm. Ora è **tentato e registrato** (round 3 lo aveva lasciato non tentato), quindi è un miglioramento netto; resta la finestra di esposizione, ed è quella che il self-test `pgrep` non può coprire perché dipende dalla raggiungibilità, non dal tool.

## 5. Cosa ho controllato e non è un difetto (REFUTED)

- **REFUTED** — nessuna regressione nel core di sicurezza: il diff di `1eb93681` tocca `arm.sh` (un check in più), `d_run.sh` ( guardia deadline, ordine dei source, `deadline_check` nel loop, `finalize_results`), `fake-adb.sh`, `dryrun.sh`. **Non tocca** `stop_lib.sh`, `kill_spec_verified`, `arm_poll_loop`, i check di `stop_request` in `run_proof`/`run_measure`, né `restore.sh`. I sette path di stop che avevo enumerato al round 2 sono invariati e arrivano tutti a `kill_spec_verified`.
- **CONFIRMED** — la guardia `DEADLINE_S` è prima di `mkdir -p "$RAW"` (`d_run.sh:33` vs `:57`) e prima di qualunque chiamata adb, quindi la *posizione* è corretta (il difetto è il predicato, N-B1).
- **CONFIRMED** — `finalize_results` con file assente marca `FINALIZED=1` (`d_run.sh:311`): semanticamente corretto ("nothing to finalize") e non può mascherare nulla, perché in quel caso `cleanup` non ha nulla da scrivere.
- **CONFIRMED** — `count_mismatch` non può essere innescato da una riga malformata senza la parola `decoded`: il gate `ARM_TPS` (`:144`) precede, quindi un log senza tps resta `no_stats` (il void più informativo) e non viene ri-classificato.
- **CONFIRMED** — `deadline_check` dentro il loop non può trovarsi con un poll attivo: `cooldown_wait` è chiamata prima di `start_arm_poll` sia in `run_proof` sia in `run_measure`, e il check del match loop è fra round, quindi `stop_arm_poll` nella cleanup è un no-op e il kill+verify del cleanup copre comunque (`rc=124`).
- **CONFIRMED** — `bash -n` pulito su 8 script; la matrice è 209/0 e i tre fixture nuovi (`deadlinecool` con negative control, `countmismatch`, `deadlines-guard` con asserzione "no RAW, no state") sono non circolari: il primo dimostra la regressione reintroducendola, gli altri due fallirebbero con il codice pre-fix.

## 6. Conclusione

Le finding di round 3 sono state chiuse bene, e la `deadlinecool` con negative control è il pezzo di verifica più rigoroso che ho visto nelle due celle. Restano due cose: **N-B2**, l'unico blocker — una riga, la stessa che la cella A ha già (`turn_backend_disabled`), senza la quale una riga C4/C8 può essere auto-attestata da una prova che riguarda un altro processo; e **N-B1**, una guardia che protegge solo un path di adb. Nessun blocker di sicurezza: stop, kill, restore e il percorso after-SIGKILL sono solidi e invariati.
