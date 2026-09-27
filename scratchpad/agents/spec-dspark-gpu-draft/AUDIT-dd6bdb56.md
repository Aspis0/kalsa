# Audit ostile delle fix (c46ad934) — solo critica, nessuna patch

Eseguito: dry-run contro l'adb finto (`./dryrun.sh` → **EXIT=0, SUMMARY pass=51 fail=0**) più run manuali del driver contro `fake-adb.sh`, inclusi SIGTERM e SIGKILL a metà arm (nessun telefono, nessun adb vero, nessun QDC). Compone la sezione B del rapporto; la sezione A (cella sorella `qdc-heat-3way`, da cui questa cella sourcia `stop_lib.sh`) è in `scratchpad/agents/qdc-heat-3way/AUDIT-dd6bdb56.md`.

| cella | ready for the phone |
|---|---|
| **B) spec-dspark-gpu-draft** | **NO** |

B fallisce per un kill che non esiste su ogni uscita anomala (provato sperimentalmente), per l'assenza di qualsiasi restore dopo un SIGKILL, e per una sessione "void" che si registra come riuscita.

---

## (1) Stop: possono fallire sul telefono?

**B-1 — CONFIRMED / BLOCKER — su ogni uscita anomala il binario NON viene mai ucciso.** `cleanup` (`d_run.sh:105-114`) chiama solo `restore_screen`; non c'è alcun `pkill`. Provato: SIGTERM a metà arm → `DRIVER EXIT=143`, `END reason=signal_TERM`, `timeout=60000 stayon=1` (restore esatto), **`pkill.log` VUOTO**. Sul telefono `llama-speculative-simple` resta a pieno carico con il poll già morto e lo schermo spento. `stop_lib.sh:59` pkilla `llama-completio[n]`, cioè il binario **sbagliato** per questa cella.
Fix: `pkill -f 'llama-speculative-simpl[e]'` in `cleanup` prima di `restore_screen`, o un `restore.sh` standalone come in A.

**B-2 — CONFIRMED / HIGH — nessun `restore.sh` in questa cella, e dopo un SIGKILL il valore pre-run è perso per sempre.** `ls` della cella: `arm.sh d_run.sh dryrun.sh fake-adb.sh host_calib.sh host_smoke.sh pack_kit.sh` — nessuno script di restore. Provato: SIGKILL → `timeout=1800000 stayon=3`, `pkill.log` vuoto, `.restore-state` lasciato con `SCREEN_OFF_TIMEOUT=60000`; poi una seconda run **completa** cancella quello stato (`d_run.sh:160`) e "ripristina" a `timeout=1800000 stayon=3` loggando `SCREEN_RESTORED`. Il telefono resta con lo schermo sempre acceso per sempre.
Fix: copiare `qdc-heat-3way/restore.sh` (o inline equivalenti) e non cancellare `.restore-state` al setup.

**B-3 — CONFIRMED / HIGH (validità) — un match fallito si registra come sessione riuscita.** `d_run.sh:290-297`: `log "MATCH void n_star=$N_STAR"` → `safety_gate post_session` → `write_end exit_0` → `exit 0`. `PLAN.md` dice il contrario ("else the comparison is VOID"). E il dry-run **codifica** la bug: `dryrun.sh:145-146` asserisce `timeout END = exit_0` e `timeout rows = 5` con 1 arm su 5 VOID. `results.tsv` non ha nessun flag di validità, e `END.txt` dice `exit_0` come in un run perfetto.
Fix: `if [ "$ALL_EQ" -ne 1 ]; then write_end match_void; exit 0; fi` e una colonna `final` in `results.tsv`.

**B-4 — CONFIRMED / HIGH (validità) — nessun cooldown, nessuna temperatura per arm, nessun sampler.** `TAIL_S=10` (`d_run.sh:24`), `safety_gate` solo prima/dopo (`d_run.sh:217,229,238`), header di `results.tsv` (`d_run.sh:196`) senza colonne termiche. I 5 arm corrono di fila con la skin che sale: le righe che il metodo matched-N usa come metrica sono quelle degli **adjustment** (attempt ≥ 2, `d_run.sh:270-284`), cioè le più **calde** della sessione, e le probe (attempt 1) sono le più fredde. Il confronto B-vs-C è confuso dalla temperatura in modo sistematico, non casuale.
Fix: cooldown a `skin ≤ 37` come in A + `skin_before/after` per riga.

**B-5 — CONFIRMED / HIGH (impatto) — `-lv 5` sta dentro il turno misurato.** `arm.sh:54` finisce con `-ngl 0 -lv 5`, e serve solo per le righe di placement (load-time, contate dopo il marker, `arm.sh:117-121`). Tutto il debug va su stderr → stesso file di log **durante encode+decode**. Gli arm C4/C8 (drafter su OpenCL) generano più righe degli arm A/B: l'overhead di log colpisce esattamente il contrasto B-vs-C che `PLAN.md` prevede.
Fix: `-lv 5` solo in un passo di load/preflight separato, poi `-lv 0` per il turno.

**B-6 — CONFIRMED / MEDIUM-HIGH (circolarità) — la convergenza del matched-N è dimostrata solo da un'identità aritmetica del fake.** `fake-adb.sh:95-97`: `o=1; [ "$nmax" -eq 0 ] || o=$((nmax+1)); n_predict=$((limit + o))`. Il fake risponde con una formula chiusa, quindi il secondo giro restituisce per costruzione ciò che `d_run.sh:277` `LIMIT_OF[$j]=$(( LIMIT_OF[$j] + N_STAR - cur ))` prevede. Il reale è content-dependent: `PLAN.md` stesso registra overshoot **+1/+5/+9 a `-n 127` e +3 a `-n 63`** ("NOT constant"). Sul device l'acceptance oscilla, `MATCH_MAX=2` non converge, e si cade nel B-3.
Fix: fixture con `DRY_N_PREDICT_OVERRIDE` non deterministico (rumore ±) e `MATCH_MAX` ≥ 4, oppure `--ignore-eos`/n fisso con `-n` riscalato da un ratio misurato.

**B-7 — CONFIRMED / MEDIUM — la finestra di push da 3 GB non è sorvegliata.** `d_run.sh:186-192` (`ensure_file` con `adbT 900` per kit+2 modelli, poi `tar -xzf` con 120 s): l'unico gate è **prima** (`d_run.sh:184` "an already-hot phone never gets loaded"), il successivo è a `d_run.sh:194`. Fino a ~15 minuti senza poll.
Fix: un poll durante il push, o un gate `safety_gate` tra push e unpack.

**B-8 — CONFIRMED / MEDIUM — `BATTERY_UNTRUSTED=0` hard-coded (`d_run.sh:72`) e nessun harness di fiducia.** La skin ≥ 46 °C è **permanentemente disarmata** in B; l'unico soffitto è la `temperature` di `dumpsys battery`, mai validata contro la skin su questa cella (su A, run 1: skin 28.2→30.8 con batt 26.9→29.1; la cella sorella ha trovato stub fissi a 25.0 °C su due QRD).
Fix: riusare `battery_trust.sh` di A, o motivare per iscritto con una misura skin-vs-batt su S23.

**B-9 — CONFIRMED / MEDIUM — SIGHUP non intrappato** (`d_run.sh:120-122`, solo INT/TERM/EXIT): stesso effetto di A-5, e qui peggio perché manca anche il pkill.
Fix: `trap 'on_signal HUP 1' HUP`.

**B-10 — CONFIRMED / LOW-MED — chiamate `adbT` non protette** (`d_run.sh:163,167,171,172`), stesso meccanismo di A-9: con `set -euo pipefail` un errore adb uccide il driver con il codice grezzo, senza log. In più `d_run.sh:67` usa `$CURRENT_CHILD_PID` che nel subshell del poll è una copia: un SIGTERM durante l'`adbT` del poll lascia l'adb client vivo (orfano lato host, non device).
Fix: proteggere le quattro chiamate con `|| { log "ADB_FAIL at <step>"; exit 2; }`.

**B-11 — CONFIRMED / LOW — il fake B non emette nessun prefisso `<ts> <level> `.** `fake-adb.sh:110-137` scrive tutto nudo, mentre il device prefissa ogni riga del logger (prova irrevocabile: il log S23 committato nella cella A, `qdc-heat-3way/raw/s23-cli-heat-20260926/…t1cpu.log`). Oggi i parser di B sono agnostici al prefisso, quindi non rompe nulla; ma il prossimo regex ancorato passerà il dry-run e fallirà sul telefono. Il fake di A è stato invece corretto su questo (`qdc-heat-3way/dryrun-adb.sh:149-155`).
Fix: rigenerare il fake B con i prefissi presi dal log committato di A.

**B-12 — CONFIRMED / LOW-MED — lo split "post-marker" presume che il drafter sia caricato per secondo.** `arm.sh:117-118` (`marker`, `post=tail -n +marker+1`). L'unico supporto è un commento; su host il marker è a riga 7 di 40 (`raw/host_smoke.log:7`) e le righe di placement del target non compaiono (verbosity default). Se sul device l'ordine invertisse, i check CPU (`arm.sh:130` `gpu_assign>0 → draft_not_on_cpu`) misurerebbero il segmento sbagliato.
Fix: marcare entrambi i modelli (target e drafter) e asserire l'ordine prima di contare.

**Verificato e CORRETTO.** Il parse di B è solido sul formato reale: `raw/calib_armA127.log:20` `decoded  128 tokens in …  speed:   40.101 t/s` e `:23` `n_predict = 128` (con `:22` `n_draft   = 0`, `:24` `n_drafted = 0`, `:26` `accept    = nan%`): `awk '/ decoded .* tokens in .* speed: /'` prende la riga giusta (`encoded` non la regge, `tail -1` sceglie la decode), `/accept    = /` a 4 spazi non collide con `n_accept  =`, e `n_predict` prende l'ultima occorrenza (il blocco stats, non l'eco di `generate:` che questo tool non stampa) — **REFUTED** il mio sospetto di fallback sul valore richiesto. Il controllo "stesso binario per il no-draft" è corretto: `-md draft.gguf` è incondizionato (`arm.sh:54`) e l'unica differenza dell'arm A è `--spec-draft-n-max 0` con `n_drafted=0` verificato su host. Le fix B1-B7 sulla prova GPU (soglia 5 layer + 4 kernel, contati dopo il marker) e sul `-lv 5` obbligatorio sono dunque corrette nel merito — con la riserva B-5 sul dove il `-lv 5` va applicato.

## (2) Validità di misura

Il metodo matched-N è concettualmente quello giusto per un decoder speculativo (confrontare t/s a parità di token **accettati**, non di `-n`), e l'ordine di aggiustamento è dichiarato. I problemi sono due, entrambi coperti sopra: **B-4** (le righe di metrica sono quelle tardive e calde, le probe sono fredde e inutilizzate) e **B-6** (la convergenza è un artefatto del fake). Manca inoltre un controllo di sanità su `ARM_TPS`: `arm_parse` non verifica mai che `speed` sia numerico, quindi una riga di formato diverso da `raw/calib_armA127.log:20` produrrebbe `tps` **vuoto** con `status=OK` — la metrica primaria della cella può sparire senza invalidare la riga. Fix: `case "$ARM_TPS" in ''|*[!0-9.]*) ARM_VOID=no_stats; return 0;; esac`.

## (3) Trappole bash

Nessun `| grep -q` non protetto (l'unico è in `fake-adb.sh:114`, in condizione `if`); nessun `local x=$(cmd)` mascherante (`arm_parse` separa i `local`, `d_run.sh:76-79`); nessuna `die` dentro `$()`. Il sospetto su `match_state` (`[ "$cur" -le "$N_STAR" ]` con `cur` non numerico → errore di `[` → `set -e`) è **REFUTED**: `PARSED_N` è valorizzato solo con `ARM_STATUS=OK` e `ARM_N` è sanificato a `na`→VOID in `arm.sh:113`. Il punto reale resta B-10 (`wait` + `set -e`).

## (4) I dry-run sono circolari?

Sì, sulla parte che conta, per due motivi distinti. Primo: `fake-adb.sh:95-97` fa del matched-N un'identità chiusa, quindi il fixture `happy` ("8 rows", "matched N = 136 136 136") dimostra una convergenza costruita (B-6). Secondo: il fake non modella nessun volume di logging, quindi `-lv 5` (B-5) è invisibile. Terzo: nessun prefisso di timestamp (B-11), quindi la fedeltà di formato non è mai esercitata. Cosa il dry-run fa bene: i cinque stop di `stop_lib.sh` sono realmente iniettati e provati uno a uno, il `sha256sum` push-skip/push è modellato, e il restore è verificato sullo stato del fake. Cosa non prova: nulla del mondo `dumpsys` reale, nulla della volatilità dell'acceptance, nulla del poll sotto carico.

---

## Sintesi delle priorità (B)

1. **B-1** (nessun kill su uscita anomala) e **B-2** (nessun restore path) — verificati sperimentalmente, rompono il telefono.
2. **B-3** (void = successo) e **B-4** (nessun controllo termico) — B produrrebbe numeri non confrontabili e li etichetterebbe come validi.
3. **B-5** (verbosity dentro la finestra misurata) — bias sistematico sulla sola coppia di arm che si vuole confrontare.
4. **B-6, B-7** — metodo di convergenza non dimostrato, finestra di push non sorvegliata.
5. **B-8, B-9, B-10, B-11, B-12** e il controllo mancante su `ARM_TPS` — stop disarmato, SIGHUP, trappole, fedeltà del fake, split post-marker.
