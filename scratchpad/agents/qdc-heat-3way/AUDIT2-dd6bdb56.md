# AUDIT 2 — riesame ostile delle fix dd6bdb56 (commit `5ba47a93`), solo critica

Eseguito: `./dryrun.sh` rieseguito da me → **EXIT=0, PASS=213 FAIL=0** (confermato). Lettura di `d_run.sh`, `arm.sh`, `stop_lib.sh`, `restore.sh`, `sampler.sh`, `smp.sh`, `kit.sh`, `dryrun-adb.sh`, `dryrun-lib/core/stops/paths.sh`, `PREREG.md`, `REPORT.md`. Nessun telefono, nessun adb vero, nessun sub-agent, nessuna patch. Compone la sezione A; la sezione B è in `scratchpad/agents/spec-dspark-gpu-draft/AUDIT2-dd6bdb56.md`.

| cella | ready for the phone |
|---|---|
| **A) qdc-heat-3way** | **NO** |

Le 16 finding del round 1 sono **meccanicamente tutte chiuse**. Ma la nuova architettura a due fasi ha introdotto due gate che sul telefono quasi certamente falliscono al primo giro, e il dry-run non li può vedere perché il fake soddisfa i due ingredienti con valori costanti.

---

## 1. Esito delle 16 finding di `AUDIT-dd6bdb56.md`

| # | esito | evidenza |
|---|---|---|
| A-1 | **FIXED (meccanismo)** | la proof è passata alla load phase a `-lv 5` (`arm.sh:81`), i gate girano sul `.load.log` (`d_run.sh:309` `arm_parse_proof`) **prima** del turno misurato, e la soglia CPU è di nuovo falsificabile sul log verbose (`arm.sh:157-170`). Il blocker originale è indirizzato. **Ma i nuovi gate hanno i propri blocker: vedi NEW-1 e NEW-2.** |
| A-2 | **FIXED** | `arm_env` (`arm.sh:66-68`) non esporta più `GGML_HEXAGON_VERBOSE`/`GGML_OPENCL_LOG_KERNELS`; solo `arm_proof_env` (`arm.sh:70-72`) lo fa, e solo `arm_load_cmd` la usa (`arm.sh:81`). Il turno misurato gira a verbosity default pulito. |
| A-3 | **FIXED** | `d_run.sh:285` `start_arm_poll` **prima** di `arm_load`, `d_run.sh:299` `stop_arm_poll` dopo. La load phase è sorvegliata. |
| A-4 | **FIXED (con NEW-4)** | `kill_remote_llama` (`stop_lib.sh:69-82`) pgrep-verifica, marker `kill_unverified` (`stop_lib.sh:79`), `restore.sh:50-54` fallisce forte, `kill_unverified_end` (`d_run.sh:150-154`) e `finish_stop` (`d_run.sh:160-163`) producono `END …kill_unverified` + `exit 3`. Fixture `kill-unverified` con `DRY_PKILL_NOOP=1` (`dryrun-stops.sh:66-78`) e probe `pgrep` registrato. Residuo: NEW-4. |
| A-5 | **FIXED** | `d_run.sh:194` `trap 'on_signal HUP 1' HUP`. |
| A-6 | **FIXED** | `d_run.sh:178-184`: `.restore-state` preesistente viene **consumato** da `restore.sh` prima di proseguire, e un restore fallito blocca con `PRIOR_RESTORE_FAIL` + `exit 3` invece di sovrascrivere. Fixture `prior-restore`. |
| A-7 | **FIXED** | `d_run.sh:190` `[ -n "$SCREEN_OFF_TIMEOUT" ] \|\| SCREEN_OFF_TIMEOUT=null`, simmetrico a `STAYON` (`d_run.sh:191`). |
| A-8 | **FIXED** | `d_run.sh:192-196`: stato scritto (`:187`) → poi i tre trap → poi la prima mutazione (`:198-200`). Il commento ora è vero. |
| A-9 | **FIXED** | `adbT … \|\| SER=""` (`:168`), `SOC=… \|\| { log "ADB_FAIL soc_read"; exit 2; }` (`:185`), idem `timeout_get`/`stayon_get` (`:188-189`). `NO_DEVICE` e `ADB_FAIL` sono raggiungibili. |
| A-10 | **FIXED** | `PREREG.md:72-73` registra il bound (15 s + 2 round trip ≈ 17–20 s) e c'è il fixture `poll-cadence` alla cadenza di produzione. |
| A-11 | **FIXED (con NEW-6)** | `sampler.sh` con `sampler_pause`/`sampler_resume` (`d_run.sh:316-318`), `smp.sh` append-only, `kit.sh:49` pulisce `samples.txt` una volta per sessione. Residuo: NEW-6. |
| A-12 | **FIXED** | `PREREG.md:64` (gate N−1 = `DECODE_N-1`, 126 per `-n 127`) e `:87-88` (il blocco amendment governa su le sezioni sotto). |
| A-13 | **FIXED** | `validate_order` (`d_run.sh:31-42`): lunghezza pari e coppie solo da `{CG,GC,NN}`, altrimenti `exit 2`. |
| A-14 | **FIXED** | `REPORT.md:28` marca la riga A1 come **[SUPERSEDED by Round 3 + Round 4]** con la correzione esplicita; `REPORT.md:216` registra la chiusura. |
| A-15 | **FIXED** | il check "no leak" (`arm.sh:167-170`) gira sul log `-lv 5`, dove le righe device esistono: non è più vacuo. |
| A-16 | ** invariato** | era il mio refutation: `^GGML_OPENCL_LOG_KERNELS:` ancorato è corretto (`arm.sh:200`), sorgente `fprintf` a `ggml-opencl-kalsa-diag.cpp:36-44`. |

## 2. Finding nuove

**NEW-1 — CONFIRMED / BLOCKER — la soglia `MIN_HTP_OPS=1000` è irraggiungibile per una proof run da 4 token: i due arm N si voideranno al turno 3.**
`arm.sh:81` esegue la proof con `-p " " -n 4` → 1 token di prompt eval + 3 eval run = **4 token**, e `arm.sh:40` mantiene `MIN_HTP_OPS=1000`, controllato a `arm.sh:184-185`. La soglia è stata calibrata su un turno da 1018+126 token, non su 4. Con i numeri dello stesso repository:
- evidenza reale più vicina: `q51-f2b-v73-guard/REPORT.md:33-36`, run **pp16/tg8** (24 token) → **484** `execute-op` ≈ **20/token** ⇒ 4 token ≈ **80 righe**;
- priors citati nella cella stessa (`arm.sh:29-33`): q58 n=1024 → 3430 = **3.35/token**; q57 pp512×2rep → 1764 = **1.72/token** ⇒ 4 token ≈ **7–14 righe**.

Nessun prior del repository porta a 1000 con 4 token: manca un fattore 8–12. Conseguenza: `htp_ops_low` su entrambi gli arm N, e `method_void_guard` (`d_run.sh:314`, `d_run.sh:354`) chiude la sessione al primo N. Il dry-run **non può vederlo**: `dryrun-adb.sh:120-124` emette un `${DRY_HTP_OPS:-1200}` costante, identico per la proof da 4 token e per il turno da 127, quindi `six-arms` e `htp-low` (`dryrun-core.sh:20-26, 62-68`) passano su un numero che il device non produrrà.
Fix (una riga): o `arm_load_cmd` da `-n 4` a `-n 64` (≈1300 righe al ritmo di 20/token, ~6 s di decode NPU extra, soglia 1000 conservata), o `MIN_HTP_OPS` riscalata sul token count della proof (≈80) con la soglia di collasso dichiarata esplicitamente.

**NEW-2 — CONFIRMED / HIGH — il fingerprint a 3 componenti non ha evidenza device per 2 componenti e per 2 dei 3 backend: il gate fail-closed può voiare 4 arm su 6 al primo giro.**
`arm_fingerprint` (`arm.sh:130-137`) pretende tre righe: fit line `n_gpu_layers already set by user to N` (`:133`), warning `device HTP0 did not report memory` (`:135`), `system_info: n_threads` (`:134`). L'unico log reale S23 committed contiene le tre **solo per l'arm CPU a `-t 8`**: `raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:5` (fit, `to 0`), `:4` (HTP0 warning), `:18` (`n_threads = 8`). Nessuna evidenza che:
- la fit line venga emessa con `-ngl 99` (G e N) — cioè `ngl` potrebbe non esistere → `?` → `no_fingerprint`;
- il warning HTP0 sia **assente** per `-dev GPUOpenCL` (è un'assunzione, `arm.sh:132`; il fake la codifica: `dryrun-adb.sh:164` la stampa per tutto tranne `gpu`);
- `system_info` venga stampato con `-t 5` e con `--simple-io` (nel log run 1 è `-t 8` e senza evidence sul flag).

Il gate è fail-closed su ambo i lati (`arm.sh:154`, `arm.sh:244`), quindi una riga mancante = VOID `no_fingerprint`, cioè un fallimento di gate presentato come problema di backend. Il fake (`dryrun-adb.sh:162-166`) stampa le tre righe incondizionatamente per ogni backend, e i fixture `six-*`/`backend-mismatch`/`no-fingerprint` asseriscono quindi un contratto che nessun device ha mai mostrato.
Fix (una riga): un preflight di sessione — prima del loop, un solo `arm_load cpu` e assert esplicito della presenza delle tre righe con `-t 5` e con `-ngl 99`, uscita con codice dedicato (`FP_PREFLIGHT_FAIL`) così da distinguere "riga assente" da "backend sbagliato".

**NEW-3 — CONFIRMED / MEDIUM — il fingerprint può passare sul backend sbagliato: la fit line riporta il valore richiesto, non il piazzamento.**
`arm.sh:133` estrae `n_gpu_layers already set by user to N`: è l'intestazione dell'utente (`common_fit_params` aborta *perché* l'utente l'ha impostata), non ciò che è stato effettivamente offloadato. Con `-dev GPUOpenCL -ngl 99`, un turno in cui l'inizializzazione OpenCL fallisce e llama.cpp ripiega sul CPU stampa **le stesse due righe** (`fit … to 99`, e HTP0 non viene interrogato con `-dev` ⇒ `htp=0`) ⇒ fingerprint identico a quello della proof ⇒ `arm.sh:246-250` non vede nulla e la riga viene registrata come GPU con numeri CPU. Il controllo negativo che esiste (`kernel set failed … device disabled`, `arm.sh:174-177`) gira **solo sul log della proof**, mai su quello del turno, e quelle righe sono ERROR/WARN quindi presenti a verbosity default.
Fix (una riga): ripetere il check negativo sul log del turno prima di `ARM_STATUS=OK` in `arm_parse_turn` (`arm.sh:240-252`), così un device OpenCL disabilitato nel turno vioda invece di essere etichettato GPU.

**NEW-4 — CONFIRMED / MEDIUM (entrambe le celle) — il fail-closed su `pgrep -f` ha un buco: un pgrep "rotto" che risponde 1 viene letto come "processo sparito".**
`stop_lib.sh:72-82` accetta come "verified" **solo** `PGREP_RC=1`, e `restore.sh:50-54` lo stesso. Se il `pgrep` del device non supporta `-f`, la rc dipende dall'implementazione: toybox esce 126 (→ marcato non-verificato, corretto), ma un pgrep stile busybox esce **1** su errore di uso ⇒ il codice legge `KILL_VERIFIED` mentre il binario è ancora vivo — esattamente il fallimento che A-4 chiedeva di eliminare. La variante B (`d_run.sh:89-115`, con `PGREP_BROKEN` esplicito e 3 tentativi) è più robusta ma ha la stessa classe-1.
Fix (una riga, in entrambe le celle): prima del verdetto, un probe di salute — `pgrep -f zzz_no_such_proc_zzz; echo PROBE=$?` — e `GONE` è accettato **solo** se `PROBE=1`; qualunque altro valore è `PGREP_BROKEN`.

**NEW-5 — CONFIRMED / LOW — `restore.sh` fallisce forte ma non lascia il marker, quindi la fine può sembrare riuscita.**
`restore.sh:51-54` imposta `rc=1` e stampa `RESTORE_LLAMA_STILL_RUNNING`, ma non scrive `$RAW/kill_unverified` (che invece nasce in `stop_lib.sh:79`). Sul percorso normale/signal `cleanup` (`d_run.sh:128-140`) logga `RESTORE_FAIL` e scrive comunque `END reason=exit_0` / `signal_*`: la fine non riflette il kill non verificato. Fix: `: > "$RAW/kill_unverified"` in quel ramo di `restore.sh`.

**NEW-6 — CONFIRMED / LOW-MED — la pausa del sampler non è sincronizzata con l'uscita del processo sul device: il carico 1 Hz può entrare nel primo secondo della finestra misurata.**
`sampler.sh:19-22` tocca il marker e uccide **solo il client adb host**; il loop on-device (`smp.sh:26-33`) può essere ancora dentro la sua `dumpsys thermalservice` (binder call) e nel `sleep 1`. `d_run.sh:316` pausa subito prima di `arm_run`, quindi la prima perturbazione che A-11 voleva eliminare può cadere dentro il turno. Fix: spostare `sampler_pause` (`d_run.sh:316`) prima del `sleep "$TAIL_S"` di 60 s: il device ha un minuto per uscire e la pausa è comunque fuori dalla finestra.

**NEW-7 — CONFIRMED / LOW — la validazione delle coppie ora vieta il design registrato alternativo e ogni ri-esecuzione di un singolo backend.**
`d_run.sh:33-42` accetta solo coppie `{CG,GC,NN}`: `CC` (ri-eseguire solo CPU) e l'ordine palindromo alternativo `CGNGCN` registrato in `PREREG.md` come alternativa di A9 sono ora rifiutati. Non è un bug, ma la restrizione non è registrata da nessuna parte. Fix: una riga in `PREREG.md` § Order bias.

**NEW-8 — CONFIRMED / LOW — costo di sessione non registrato: un model load in più per arm.**
La proof run è un `llama-completion` a pieno carico per ogni arm (6 load extra da ~1.6 GB oltre ai 6 già esistenti), più 3-4 token di lavoro. Con `COOL_MAX_S=720` e `DEADLINE_MINUTES` default 100 (`d_run.sh:41`) la somma 6×(cooldown+load+turn) può toccare il deadline. Fix: una riga in `PREREG.md` con la durata attesa e il margine sul deadline.

## 3. Le cinque domande, risposte per questa cella

1. **`request_stop` pkilla solo `llama-completion`** → in A è **corretto**: il binario di A *è* `llama-completion`, e `stop_lib.sh:69-82` lo verifica con pgrep. Per B vedi la sezione B.
2. **Il fingerprint può passare sul backend sbagliato?** **Sì** (NEW-3): la fit line è un'intenzione, non un piazzamento; e in più due delle tre componenti non sono verificate sul device per G/N (NEW-2).
3. **`pgrep`/`pkill` fail-closed?** Quasi: c'è un buco classe-1 su `pgrep` rotto che risponde 1 (NEW-4). Per il resto è fail-closed con marker, END dedicato ed `exit 3`.
4. **Restore esatto dopo SIGKILL?** **Sì**: `d_run.sh:178-184` ripara prima di ripartire e si rifiuta di proseguire se il restore fallisce; `restore.sh` **non** cancella mai `.restore-state`, quindi la registrazione dei valori pre-run sopravvive a un restore fallito e a un secondo tentativo. Residuo minore NEW-5.
5. **`-t 5` su ogni arm?** **Sì**: `arm.sh:71` (turno) e `arm.sh:81` (proof), entrambe `-t 5`, coerente con `PREREG.md:88` e con `deviceTuning.ts:217-219`. Nota: `PREREG.md:113` mostra ancora la riga di protocollo con `-t 8`, ma il blocco amendment (`:87-88`) dichiara esplicitamente la precedenza → accettabile.

## 4. Priorità

**Blocanti:** NEW-1 (soglia execute-op vs 4 token: 2 arm N morti al primo giro), NEW-2 (fingerprint non verificato: 4 arm su 6 a rischio di `no_fingerprint` al primo giro).
**Da chiudere prima del device:** NEW-3 (turno senza check negativo OpenCL), NEW-4 (probe di salute di `pgrep`, una riga in `stop_lib.sh` + `restore.sh`).
**Minori:** NEW-5, NEW-6, NEW-7, NEW-8.
