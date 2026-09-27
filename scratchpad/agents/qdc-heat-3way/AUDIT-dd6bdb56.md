# Audit ostile delle fix (e532efe2, f8db956f) — solo critica, nessuna patch

Eseguito: dry-run contro l'adb finto (`./dryrun.sh` → **EXIT=0, PASS=155 FAIL=0**) più run manuali del driver contro `dryrun-adb.sh` (nessun telefono, nessun adb vero, nessun QDC). Compone la sezione A del rapporto; la sezione B (cella sorella `spec-dspark-gpu-draft`) è in `scratchpad/agents/spec-dspark-gpu-draft/AUDIT-dd6bdb56.md`.

| cella | ready for the phone |
|---|---|
| **A) qdc-heat-3way** | **NO** |

A fallisce per un blocker già dichiarato e non risolto (le proof sono sotto la verbosity di default: nessun arm può passare), più un poll mancante nelle fasi termicamente più pesanti, più un `pkill` di cui non esiste mai prova sul device.

---

## (1) Stop: possono fallire sul telefono?

**A-1 — CONFIRMED / BLOCKER — al livello di default tutti e tre gli arm voidano, la sessione si ferma a turn 1.**
L'unica evidenza reale sul S23 è in `raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log`, e su quel file `grep -c` dà **0** per `assigned to device`, `HTP0 execute-op`, `Hexagon Arch`, `GGML_OPENCL_LOG_KERNELS`. Il gate CPU `arm.sh:139-141` (`if ! awk '/assigned to device CPU/{n++} END{exit !(n>0)}'`) va in `no_cpu_proof` → `d_run.sh:320-323` scrive `END reason=method_void_no_cpu_proof` ed esce. Il REPORT lo dichiara (§ "Open blocker for run 2") ma il codice è spedito così com'è: la cella, oggi, non produce né una riga OK.
Fix: una riga — introdurre un flag di verbosity nell'`arm_backend_flags` (`arm.sh:48-54`) o riscrivere le proof su linee sempre presenti, prima di toccare il telefono.

**A-2 — PLAUSIBLE / HIGH — la fix ovvia per A-1 è in conflitto diretto con l'env già impostato.**
`arm.sh:58` mette `GGML_HEXAGON_VERBOSE=1` in `arm_env()` per **tutti** gli arm. Le righe `HTP0 execute-op` sono per-op (≈30/layer, soglia 1000 in `arm.sh:38`). Se si aggiunge `-lv 5` per sbloccare le proof, l'arm N scarica decine di migliaia di `fprintf` **dentro la finestra misurata** (decode 126 token) e il suo `eval time` non è più confrontabile con C e G. Il dry-run non può vederlo: il fake scrive un file fisso per arm.
Fix: `-lv 5` solo nella load phase (`arm.sh:74`), mai nel turn misurato.

**A-3 — CONFIRMED / MEDIUM — la load phase è l'unica fase termicamente pesante senza poll.**
`d_run.sh:270` `arm_load "$backend" "$tag"` (page-in, upload pesi, compile OpenCL) → il poll parte solo a `d_run.sh:281` `start_arm_poll`. Il primo `hard_stops` dopo la load è a `d_run.sh:279`. Finestra non sorvegliata: fino ad `ARM_TIMEOUT_S=900` (`d_run.sh:36`); run 1 misurò 32 s sul CPU, ma su G/N la compile+upload è ben oltre.
Fix: `start_arm_poll` prima di `arm_load`, `stop_arm_poll` dopo `hard_stops` di `d_run.sh:279`.

**A-4 — CONFIRMED / HIGH (impatto) — il `pkill` non è mai verificato, e il suo rc è buttato ovunque.**
`stop_lib.sh:59` e `restore.sh:48` fanno `... 2>&1 || true`; il fake risponde sempre `exit 0` (`dryrun-adb.sh:183-184` `*pkill*) ...; exit 0`). L'unica prova reale del pattern è `raw/s23-app-stutter-20260926/commands.log:34`, dove il **primo** `pkill -INT -f "llama-completio[n]"` ritorna `EXIT=1` (= nessun match in toybox) e subito dopo tutti i comandi adb successivi danno `EXIT=1` (link adb-tls caduto). Se `-f` non è supportato o il pattern non aggancia, il binario continua a pieno carico HTP senza più poll e **nessuno se ne accorge**.
Fix: non scartare il rc — `out=$(adbT 15 … ); case "$out" in *llama*) …` e fallire il gate se `pkill` non ha matchato.

**A-5 — CONFIRMED / HIGH — nessun trap su SIGHUP: la disconnessione SSH lascia il telefono a pieno carico, senza restore.**
`d_run.sh:143-145` intrappa solo `INT`, `TERM`, `EXIT`. Con SIGHUP la shell muore e **i trap EXIT non girano**: niente `stop_arm_poll`, niente `stop_sampler`, niente `restore.sh`, niente `pkill`. Il telefono resta con `screen_off_timeout=1800000` e `stay_on_while_plugged_in=3`.
Fix: `trap 'on_signal HUP 1' HUP` in `d_run.sh:143`.

**A-6 — CONFIRMED / MEDIUM — `rm -f .restore-state` distrugge la prova del restore dopo un SIGKILL.**
`d_run.sh:176` cancella lo stato all'inizio; dopo un SIGKILL il restore manuale (`restore.sh`) è ancora possibile **solo se nessuno rilancia la cella**. Al rilancio, `d_run.sh:184` salva il valore già mutato e `restore.sh:57` rimette 1800000. Verificato in B (stesso identico pattern), per A il meccanismo è lo stesso e `restore.sh` non viene chiamato da nessuno.
Fix: non cancellare lo stato; sovrascriverlo solo dopo un restore riuscito.

**A-7 — CONFIRMED / MEDIUM-LOW — `screen_off_timeout` vuoto ⇒ restore saltato, telefono lasciato a 1800000.**
`d_run.sh:184` non ha il default `null` che invece ha `STAYON` a `d_run.sh:186`. Provato: con `settings get` che risponde riga vuota, `.restore-state` prende `SCREEN_OFF_TIMEOUT=` e `restore.sh:59-62` cade in `''|*[!0-9]*)` → `RESTORE_BAD_TIMEOUT`, `rc=1`, e `d_run.sh:128` logga solo `RESTORE_FAIL` in `restore_run.log`. Il S23 risponde `null` (run 1: `timeout_saved=null`), quindi è latente, non vivo.
Fix: `d_run.sh:184` `[ -n "$SCREEN_OFF_TIMEOUT" ] || SCREEN_OFF_TIMEOUT=null`.

**A-8 — CONFIRMED / LOW-MED — l'ordine del commente è falso: il `rm` di `.restore-state` avviene DOPO l'arming del trap.**
`d_run.sh:173-175` dice "Drop any stale .restore-state … BEFORE this run may fail again after arming the trap", ma i trap sono a `143-145` e il `rm` a `176`. Un fallimento fra `165` (`wait-for-device`) e `176` fa girare `cleanup` → `restore.sh:29-31` sourcia lo **stale** `.restore-state` e usa **quel** `SER`.
Fix: spostare `rm -f` e la lettura di SOC prima di `trap`, o far validare a `restore.sh` che `JOB` è coerente.

**A-9 — CONFIRMED / LOW-MED — chiamate `adbT` non protette: con `set -euo pipefail` un errore adb uccide il driver con il codice grezzo, senza log.**
`d_run.sh:165` (`SER=…adbT 60 devices | awk | tr`), `:177` (`SOC=…`), `:184`, `:185`. Verificato in bash: `set -euo pipefail; w(){ (exit 7) & wait $!; echo after; }` → la shell esce con `rc=7`, `echo after` non gira mai. Effetto: `log "NO_DEVICE"` e `UNSUPPORTED_SOC` sono irraggiungibili in quel caso, e `cleanup` lancia `restore.sh` che tocca `stop` e pkilla `llama-completion` su un device dove la sessione non è mai partita (kill cross-session).
Fix: `… || { log "ADB_FAIL at <step>"; exit 2; }` con `|| got=""` come già fatto in `kit.sh:11-13`.

**A-10 — CONFIRMED / MEDIUM — la cadenza reale del poll (15 s) non è mai testata e non è registrata.**
Produzione `POLL_S=15` (`d_run.sh:35`); il dry-run lo abbassa a `1` (`dryrun.sh:38`). Latenza reale di rilevamento = 15 s + 2 round-trip adb sotto carico HTP pieno ≈ 17-20 s di calcolo a pieno regime dopo il superamento della soglia. Nessun fixture, nessuna riga nel PREREG.
Fix: un fixture con `POLL_S` al valore di produzione che misuri la latenza, e una riga di PREREG sul bound.

**A-11 — CONFIRMED / MEDIUM — il confound del sampler 1 Hz dentro la finestra misurata non è registrato.**
`smp.sh:26` esegue `dumpsys thermalservice` **ogni secondo** per tutta la sessione, quindi anche durante `arm_run`. È un binder call + loop di shell a 1 Hz sullo stesso SoC che l'arm CPU misura. `PREREG.md:119` registra il sampler come *misura*, non come perturbazione.
Fix: fermare il sampler durante `arm_run` (o campionare solo in load/cooldown) e registrarlo nel PREREG.

**A-12 — CONFIRMED / MEDIUM (validità) — `PREREG.md:85` dice ancora "must be 127" mentre il codice richiede 126.**
`d_run.sh:78` `DECODE_EXPECT=$((DECODE_N - 1))` e `d_run.sh:306` lo applica. La deviazione dal criterio preregistrato sta solo in `REPORT.md` (§ Round 3, "PREREG.md is locked (post-run)"). Un artefatto di pre-registrazione che dice 127 renderebbe void ogni arm reale (126 run).
Fix: una riga di amendment datata dentro `PREREG.md`, non solo nel REPORT.

**A-13 — CONFIRMED / LOW — `pair` è decorativo.** `d_run.sh:255` `PAIR=$(( (TURN + 1) / 2 ))` non è mai controllato, e `d_run.sh:22` accetta qualunque sequenza di C/G/N: `CGN` produce 3 righe con etichette `1 1 2` e nessun codice se ne accorge.
Fix: validare lunghezza pari e presenza di entrambi i membri per ogni pair.

**A-14 — CONFIRMED / LOW — il ledger delle fix è autocontradittorio.** `REPORT.md` riga A1 (Round 2) dice ancora "no log prefix (`common/log.cpp:174`)", "field indices $6/$9" e la tabella dry-run dice "runs 127"; la sezione Round 3 smentisce tutti e tre. Chi legge solo la tabella delle fix conclude il contrario del codice.
Fix: correggere la riga A1 e la riga "six-arms" o rimandare al Round 3.

**A-15 — CONFIRMED / MEDIUM (validità) — la proof CPU, rilassata, diventa non falsificabile.** `arm.sh:143-147`: il check "no leak" è `awk '/assigned to device (GPUOpenCL|HTP0)/ …{n++} END{exit !(n>0)}'` — su un log senza righe device passa **trivialmente**. L'unico modo per far girare A oggi è allentare il check positivo, e il risultato è un arm CPU che non può mai rilevare un offload.
Fix: proof CPU su righe sempre presenti a verbosity default (es. conteggio tensor offloaded dal modello loader), non su righe DEBUG.

## (2) Validità di misura

**Verificato e CORRETTO (non è un difetto).** Indici di campo calcolati sulla riga reale `raw/s23-cli-heat-20260926/…t1cpu.log:48` `1.17.377.184 I common_perf_print: prompt eval time = 10947.50 ms / 1018 tokens`: label al campo 3 → `ms` = 3+5 = 8 ✓, `tokens` = 3+8 = 11 ✓; `eval` a +4/+7 ✓ (riga 49), `load` a +4 ✓ (riga 47). La regola N−1 è corroborata dalla stessa riga: `:49` `126 runs`, `:50` `total time = … / 1144 tokens` = 1018+126 ✓. `-nkvo` (KV su CPU per l'arm N) è dichiarato in `PREREG.md:74,218-219`. La fix A1 e la fix A7 (gate N−1 derivato da `DECODE_N`) sono dunque corrette nel merito.

**A-16 — CONFIRMED / LOW — `GGML_OPENCL_LOG_KERNELS: *` ancorato a `^` è corretto** (`arm.sh:200`): la sorgente è `fprintf(stderr, …); fflush(stderr)` dentro `enqueue_ndrange_kernel` (`ggml/src/ggml-opencl/ggml-opencl-kalsa-diag.cpp:36-44` a f25f0c1c5), **non** il logger, quindi senza prefisso `<ts> <level> `. Avevo sospettato qui: **REFUTED**.

Il resto della validità è solido: stesso prompt sha-verificato letto con `-f` (`arm.sh:68`, `kit.sh:59`), `--ignore-eos --temp 0` per work uguale, `-c 2048 -b 2048 -ub 1024 -t 8 -fa 1` identici su tutti e tre gli arm (`arm.sh:68`), `-ngl 0` / `-dev GPUOpenCL -ngl 99` / `-dev HTP0 -ngl 99 -nkvo` (`arm.sh:50-52`), ordine palindromo `CGNNGC` con posizione media 3.5 per tutti (`d_run.sh:17`, `PREREG.md` "Order bias"), e metrica unica `eval time` su 126 run uguali per arm.

## (3) Trappole bash

Nessun `| grep -q` non protetto (l'unico è `stop_lib.sh:39`, in condizione `if`); nessun `local x=$(cmd)` mascherante (`arm.sh:133-135` separa i `local` per l'`-u`); nessuna `die` dentro `$()`; `read -r … <<< "$(…)"` con output vuoto restituisce 0 (newline dell'herestring) e non uccide `arm_parse` — **REFUTED**. Il punto reale resta A-9 (`wait` + `set -e`).

## (4) I dry-run sono circolari?

Sì, sulla parte che conta. `dryrun-adb.sh:95-127` **fabrica** le righe di proof (`load_tensors: … assigned to device`, `HTP0 execute-op`, `GGML_OPENCL_LOG_KERNELS:`) che l'unico log reale non contiene (0 occorrenze). Il fixture `six-arms` asserisce "6 rows, all OK" su un telefono che non esiste; il fixture `no-cpu` (`dryrun.sh:254`) documenta il comportamento reale — ed è un VOID. Le due realtà convivono nel harness e il harness passa. Le iniezioni `AT=n` sono indici di chiamata, non tempi: la semantica temporale del poll non è mai esercitata (A-10).

Cosa il dry-run fa bene: rigenera i prefissi `1.17.377.180 I ` copiati dal log reale committato (`dryrun-adb.sh:149-155`), ed è l'unico motivo per cui la fix A1 è stata scoperta. Le iniezioni di lettura, il `brackets` del pkill e il restore esatto sono invece provati solo contro il fake.

---

## Sintesi delle priorità (A)

1. **A-1** (proof sotto la verbosity di default) — la cella A non può produrre dati oggi.
2. **A-2** (verbosity dentro la finestra misurata) — bias sistematico sul solo arm N.
3. **A-5, A-4** (SIGHUP, `pkill` non verificato) — rischio di telefono lasciato a pieno carico.
4. **A-3, A-11, A-12** — finestra senza poll, sampler 1 Hz, PREREG incoerente col codice.
5. **A-6, A-7, A-8, A-9, A-10, A-13, A-14, A-15** — restore, trappole, documentazione, validità della proof CPU.
