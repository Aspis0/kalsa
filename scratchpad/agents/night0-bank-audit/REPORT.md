# AUDIT OSTILE PRE-BANK — cella s23-unplugged-baseline-night0

Audit in corso. Verdetto finale in coda.

---

## Scope e metodo

Audit read-only dei file: `PREREG.md` (commit **ecd3e983** — verificato via `git show`: 44 righe, un file), `AMENDMENT-1.md` (commit **f90a1d5e** — verificato: 24 righe, un file), `REPORT.md`, `RUN_LOG.md`, `manifest.json`, e i 45 file di `raw/`. Ogni verdict cita `path:riga`. Timezone host = UTC−4 (verificato `date +%z` → `-0400`): le ore del RUN_LOG sono EDT.

Cella: `s23-unplugged-baseline-night0`. Esito dichiarato: correctness PASS unplugged, speed matrix **zero** celle (2 tentativi A-arm, entrambi morti per ADB loss).

## §0 — Sintesi verdetti

| # | Claim auditato | Verdetto |
|---|---|---|
| 1a | MUL_MAT_ID 407/407 unplugged | **CONFIRMED** |
| 1b | MUL_MAT 925/925 unplugged | **CONFIRMED** |
| 1c | Pin set s3oracle 11-file = prereg | **CONFIRMED** (con caveat MISMATCH vs archivio) |
| 1d | Device/serial + ac:false *provati* nei raw | ac:false **CONFIRMED**; identità S23 **REFUTED come "provata"** (solo asserita) |
| 2 | Coerenza aritmetica manifest.json | **CONFIRMED** (nessun errore); 3 anomalie minori fuori dal manifest |
| 3 | "Nessun t/s valido" (claim negativa) | **PLAUSIBLE** — vero lato host; output orphan su-device non cercati/dichiarati |
| 4a | Gate ≤36.0 rispettato | **CONFIRMED** (borderline a zero margine, non dichiarato) |
| 4b | Floor 45% mai violato | **CONFIRMED** (quanto osservabile) |
| 4c | Un solo blocco tentato | **CONFIRMED** post-amendment; 2 tentativi totali, entrambi dichiarati invalidi |
| 4d | Provenance cambio porta 36329→37687 | **REFUTED come "dichiarata"** — gap non spiegato in nessun documento |
| 4e | "Idle drain ~7.5%/h" (premessa AMENDMENT-1) | **REFUTED** dai dati grezzi della stessa cella (13–15 %/h) |
| 5 | Divisioni A/C #18 (0.812) e #20 (0.724) | **CONFIRMED** corrette |

## §1 — Claim bankable: correctness unplugged

**1a. MUL_MAT_ID 407/407 — CONFIRMED.**
Il conteggio è nel raw: `raw/cert_mmid.out:815` = `407/407 tests passed`, con le righe di test MUL_MAT_ID(q4_K,f32) tutte OK immediatamente sopra (`raw/cert_mmid.out:812-814`). `raw/cert_mmid.workload_rc` contiene `0`. La riga manifest corrispondente (tag `cert_mmid`, manifest.json:3) dichiara `expect` "407/407 tests passed" e `pass: true`. Conteggio verifica: i subtotali MUL_MAT_ID nel .out (test per type_a=q4_K) sono coerenti con un set MoE Q4_K_M. **Il conteggio torna.**

**1b. MUL_MAT 925/925 — CONFIRMED.**
`raw/cert_mm.out:1473` = `925/925 tests passed` con test MUL_MAT (bf16/f32) OK sopra (`raw/cert_mm.out:1470-1472`). `raw/cert_mm.workload_rc` = `0`. Manifest row `cert_mm` (manifest.json:71) coerente.

**1c. Pin set — CONFIRMED, con caveat hostille.**
Gli 11 SHA-256 del device nel RUN_LOG (sezione "s3oracle 11-file device SHA-256 vs PINNED_SET.md", RUN_LOG.md:27-49) combaciano **verbatim** con la colonna "device SHA-256" di PINNED_SET.md:9-19, e i due SHA modello (OLMoE `3bd9ec48…`, KEXP `2f921958…`, PREREG.md:10-11) tornano con il manifest (campo `pinned_sha`). **Però**: PINNED_SET.md:12, :14 e :17 marcano `libggml-opencl.so`, `libggml-base.so` e `libllama-common.so` come **MISMATCH** vs l'archivio/PC di riferimento. RUN_LOG.md:29 dice "All 11 MATCH (device sha authoritative)" — vero solo sotto la convenzione prereg "device sha authoritative per CERT_DAY0.md" (PREREG.md:9). Quindi: il set usato È quello del prereg, ma 3 file su 11 divergono dal lineage binario archiviato — e i comparatori #18/#20 sono dichiaratamente "earlier binary lineage" (PREREG.md:41). Confrontabilità cross-cell già debole *by design*, va tenuto nel bank.

**1d. Device/serial e ac:false — spaccato.**
- **ac:false PROVATO**: `raw/cert_mmid.battery.pre.txt:2-5` (AC/USB/Wireless/Dock powered: false), idem `raw/cert_mm.battery.pre.txt:2-5` e `raw/kexp_tg128_b1_1_A.battery.pre.txt:2-5`. Bonus: lo stesso file mostra lo storico `ACTION_BATTERY_CHANGED` con `ac:true` fino alle 08-27 20:47 device-time (cert_mmid.battery.pre.txt:86-92), coerente con l'unplug dichiarato a ~00:10. Manifest: `ac_powered: false` a manifest.json:15 e :83. **Provato.**
- **Identità S23 NON provata nei raw**: `grep SM_S911U|dm1qsqw` su tutto raw/ → **zero match**. L'unica evidenza del modello è in prosa: `RUN_LOG.md:10` ("model:SM_S911U"). PINNED_SET.md:3 nomina il device come `adb-R3CW406P8CV-…_adb-tls-connect._tcp`, ma **nessun file in raw/ lega l'endpoint `192.168.1.152:*` al serial R3CW406P8CV**. La catena "S23 → :36329 → cert cells" riposa interamente sulla prosa del RUN_LOG (plausibile: Jelly Star sta su un IP diverso, 192.168.1.82:34037, e non è stato toccato — RUN_LOG.md:80-81 — ma non è *prova da artefatto*).
- **Serial**: le righe cert portano `192.168.1.152:36329` (manifest.json:4, :72), che coincide con il transport dichiarato nel prereg (PREREG.md:23-24). Coerente. Il mattino la porta cambia (vedi §4d).

## §2 — Coerenza aritmetica di manifest.json

**Nessun errore aritmetico trovato nel manifest.** Verifiche fatte:

- **Unità temperature (0.1 °C)**: tutte le conversioni `temperature_tenths` → °C sono corrette: cert_mmid pre 286→28.6 °C (manifest.json:13) = poll "temp=28.6C" RUN_LOG (00:40:31); cert_mm pre 312→31.2 °C (manifest.json:81) e post 334→33.4 °C (manifest.json:92) = poll 00:45:39 e primo poll pp512; tg128 359→35.9 °C (manifest.json:170) = `raw/kexp_tg128_b1_1_A.battery.samples.log` (righe `,359,46,False`). Nessun off-by-one sistematico.
- **Catena livelli batteria**: 100→99 (cert_mmid, manifest.json:12/23) → 98 (cert_mm, :80/:91) → 98 nei poll pp512 (00:52–00:54) → 89 al RESUME (RUN_LOG.md:88-90) → 63 allo STOP (RUN_LOG.md:563) → 60 a cool_watch (10:01) → 50 (10:41) → 46 preflight (RUN_LOG.md:565) → 46 ultimo sample vivo (tg128 samples, ~10:59:37). Tutto riproducibile da raw. Coerente.
- **wall_s vs log**: cert_mmid wall_s=303.727 (manifest.json:39) vs delta log 00:40:31→00:45:39 = 308 s; cert_mm wall_s=395.245 (manifest.json:107) vs 00:45:39→00:52:20 = 401 s. Differenze di 4-6 s compatibili con timing workload-only (launch→end), non un errore.
- **Conteggi righe manifest**: 4 righe (2 correctness + 2 speed invalid). RUN_LOG.md:88 "loaded_manifest_rows=3" al resume 07:48 = cert_mmid + cert_mm + pp512: coerente (tg128 aggiunta dopo).
- **Epoch dei samples**: 1787892852 → 00:54:12 EDT (START pp512 00:54:07 ✓); 1787929155 → 10:59:15 EDT (START tg128 10:59:12 ✓). Timestamp interni coerenti.
- **guard_rc cert_mm**: manifest dice `null` (manifest.json:74) ma `raw/cert_mm.guard_rc` contiene `0`. Discrepanza **dichiarata e spiegata** come read-race in RUN_LOG.md:83. Va in errata-bank ma non è un errore nascosto.

**Anomalie minori FUORI dal manifest (dichiarate qui come finding):**

1. **PREREG.md:22 cita "idle 28.7 °C at lock"** — quel valore non esiste in nessun raw: raw cert_mmid pre = 28.6 °C, preflight RUN_LOG.md:20 = 28.9 °C (289 tenths). Il 28.7 dell'unplug (00:10:55) non ha dumpsys di appoggio in raw/.
2. **cool_watch.log:1 vs :2** — stessa istanza (10:01:56): header dice `temp=39.0C`, la riga sotto `temp=389 tenths` (=38.9). Off-by-one sullo stesso campione.
3. **cool_watch.log:5→6** — salto termico 390→372 tenths (39.0→37.2 °C) in 4 minuti (10:17:57→10:21:57), dopo 20+ minuti di plateau a 39.0. Anomalo (sensore lag o evento non registrato); nessun commento nel RUN_LOG.
4. **Schema inconsistente**: le righe speed (manifest.json:139-152, :155-172) mancano di `cool_start_class`, `cpuset` e guard fields presenti nelle righe cert; la riga pp512 non ha nemmeno `screen_start`. Minor.

## §3 — La claim negativa: "nessun t/s valido"

**Lato host: CONFIRMED.** Grep su tutto raw/ di pattern throughput (`t/s`, `tok`, `eval`, `llama_perf`, decimali da tabella llama-bench) su `session.stdout.log` (28 KB): **zero match**. Nessun `*.jsonl` in raw/. I `.out` cert sono test di operatori, senza throughput. Nessun numero di velocità scartato o dimenticato *nei file della cella*.

**Ma la claim è più forte di quanto i raw provino. Due finding:**

1. **Output orphan su-device — meccanismo provato dal codice della cella.** `run_guarded.sh:22` definisce `STDOUT=$DIR/${TAG}.out` e `run_guarded.sh:94` esegue `exec sh "$CMDFILE" > "$STDOUT"` — lo stdout jsonl di llama-bench finisce **in un file sul device**. Il supervisor viene lanciato detached: `launch_one.py:190` (`nohup setsid sh … </dev/null >/dev/null 2>&1 &`). Quando il transport muore, il processo su-device **non** viene ucciso. Per il tentativo notturno pp512 il RUN_LOG lo ammette: RUN_LOG.md:87 ("Leftover on-device supervisor for `kexp_pp512_b1_1_A` (if any) could not be reaped"). Per il tentativo mattutino tg128 il workload era stato lanciato (REPORT.md:22 "Guard/workload were launched", START 10:59:12 RUN_LOG.md:566) e il transport muore ~11:00 (ultimo sample vivo 10:59:37; RUN_LOG.md:568) — **mentre llama-bench era verosimilmente in model-load**. Un `kexp_tg128_b1_1_A.out` con un jsonl (eventualmente completo: load ~minuti + tg128) può **esistere adesso** su `/data/local/tmp/s23_unplugged_night0/`. Nessun documento dichiara questo rischio per tg128; nessuno sweep del dir remoto è stato tentato prima di "FINITA — riattaccare il telefono" (REPORT.md:3). **Il numero tg128-A hot-start che l'amendment voleva misurare può essere letteralmente seduto sul device, non dichiarato e abbandonato.** Verdetto sul meccanismo: CONFIRMED (dal codice); sull'esistenza del dato: PLAUSIBLE (non verificabile col transport morto).
2. **Formulazione assolutistica fuorviante**: RUN_LOG.md:78 e :568 dicono "No llama-bench jsonl" — corretto solo come "non *recuperato* lato host", non come "non esiste". REPORT.md:24 ("No stdout jsonl. No avg_ts.") stesso problema.

Numeri non dichiarati trovati altrove: nessuno (i samples log contengono solo temp/level/ac; cool_watch idem).

## §4 — Catena prereg → amendment → esecuzione

**4a. Gate ≤36.0 rispettato — CONFIRMED, ma borderline a margine zero.**
Preflight 10:59:10 = `level=46 temp=36.0C … amendment1_gate_C=36.0` (RUN_LOG.md:565); launch battery.pre 5 s dopo = 35.9 °C (manifest.json:170). `36.0 ≤ 36.0` passa per inclusione. Il REPORT dichiara "met" (REPORT.md:16) **senza dichiarare che il preflight era esattamente sul gate** (margine 0.0 °C, poi 0.1 °C). In difesa: la temperatura era in *caduta* (plateau 39.0 °C a 09:48 → 36.0 a 10:59), quindi nessuna ri-violazione immediata, e l'amendment stessa prevede il caso "~36 °C hot start" nel caveat (AMENDMENT-1.md:19-21). Minore, ma la borderline andava dichiarata.

**4b. Floor 45% mai violato — CONFIRMED (quanto osservabile).**
Il check esiste nel codice pre-launch: `launch_one.py:174` (`BATTERY_FLOOR`) e post-run `:216` (`BATTERY_FLOOR_AFTER_RUN`). Ultimo sample vivo 46% (tg128 samples log) > 45%. REPORT.md:38 "Floor 45 % not hit" — vero fino alla morte del transport; dopodiché non osservabile (a ~14 %/h idle, il floor cade ~11:05, ma senza workload attivo: non è violazione *di misura*).

**4c. Un solo blocco tentato — CONFIRMED con nuances.**
Post-amendment: solo `kexp_tg128_b1` (RUN_LOG.md:565-569), come autorizzato (AMENDMENT-1.md:5-8). Celli rimanenti (C,C,A) mai startati (REPORT.md:24). **Però nell'intera cella il blocco tentato è DUE**: pp512 b1 A (notte, RUN_LOG.md:77) e tg128 b1 A (mattino). Entrambi dichiarati invalidi esplicitamente (REPORT.md:44). Anche il gate ≤32 notturno per pp512 fu rispettato per un capello: start a 31.9 °C (RUN_LOG.md:76, START 00:54:07) con margine 0.1 °C — e i samples mostrano la temp che sale a 32.3 °C entro 50 s (kexp_pp512_b1_1_A.battery.samples.log). Legale, ma "cool" di slittamento.

**4d. Cambio porta 36329 → 37687 — provenance NON dichiarata (REFUTED come "dichiarata").**
Notte: prereg vincola "existing wireless-adb transport 192.168.1.152:36329 … no reconnect attempts beyond `adb connect` to the same IP:port" (PREREG.md:23-25); stesso vincolo nell'header del RUN_LOG ("Reconnect: same IP:port only", RUN_LOG.md:5). Alle ~01:05 il S23 scompare da adb (RUN_LOG.md:81). Al RESUME 07:48 si lavora su **:37687** (RUN_LOG.md:88) senza che NESSUN documento registri chi/cosa/come ha stabilito quel transport. RUN_LOG.md:564 e REPORT.md:22 dicono "No hunt for other ports" / "No new ports hunted" — ma un **nuovo port è stato effettivamente usato**: "nessuna caccia" ≠ "nessuna nuova porta usata". O il device si è ri-registrato via mDNS in autonomia (da dichiarare), o qualcuno ha fatto un adb connect a una porta nuova (violazione del prereg). In entrambi i casi: gap non spiegato. Aggravante: per il mattino non esiste nemmeno il raw del retry (l'unico reconnect log in raw/ è `adb_reconnect_10min.log`, notturno, su :36329 — 40 try ✓ coerente con RUN_LOG.md:80); il "10 min connect Connection refused" su :37687 (REPORT.md:22, RUN_LOG.md:568) **non ha artefatto raw di supporto**.

**4e. La premessa quantitativa dell'AMENDMENT-1 è falsata dai suoi stessi raw — REFUTED.**
AMENDMENT-1.md:12: "Idle drain measured ~7.5%/h even Dozing". Dati della cella: (a) attesa cool-start 07:48:03→09:48:12: 89%→63% = **13.0 %/h** (RUN_LOG.md:89→563); (b) cool_watch 10:01:56→10:41:58, screen=Dozing esplicito (cool_watch.log:1): 60%→50% = **15.0 %/h**; (c) 10:41:58→10:59:10: 50%→46% = 13.9 %/h. **Nessuna finestra osservata scende sotto ~13 %/h.** Il 7.5 %/h non è supportato da nulla in raw/. Conseguenza pesante: con drain reale ~14-15 %/h, il margine 46%→floor 45% = **~4 minuti**; un blocco ABBA tg128 (4 run + load) costa ~4-6% ≈ 20-30 min. **L'amendment ha autorizzato un blocco che, per aritmetica sua e del RUN_LOG, non poteva concludersi sopra il floor** (stop rule PREREG.md:18-19 l'avrebbe troncato → di nuovo partial → no median). Anche col 7.5 %/h dichiarato il margine era ~8 min. Piano pre-condannato; per fortuna (o per sfortuna) l'ADB ha deciso prima.

**4f. Wall 2h.** Il wall viene bruciato *interamente in attesa di cooling* col gate locked (RUN_LOG.md:563 "WALL: 2h cap during cool-start"), poi l'amendment apre una terza sessione a 10:59 senza dire se il budget wall riparte da zero. Ambiguità non risolta nel testo dell'amendment. PLAUSIBLE.

**4g. Screen Awake a START A — asserto, non provato.**
Il percorso codice esiste (`run_kexp_tg128_b1.py:18-21`, `input keyevent 224` + verifica stato) e RUN_LOG.md:566 registra "screen=Awake", ma **nessun raw/dumpsys wakefulness in raw/** documenta lo stato Awake; "KEYCODE_WAKEUP" (REPORT.md:15) è codice-backed, non artifact-backed. PLAUSIBLE.

## §5 — Caveat #18/#20 (divisioni)

Ricalcolo dalle cifre citate in PREREG.md:40-41 e REPORT.md:32:

- **#18 KEXP**: 14.252 / 17.553 = **0.81194** ≈ 0.812 ✓
- **#20 OLMoE**: 20.034 / 27.685 = **0.72364** ≈ 0.724 ✓

**CONFIRMED**: entrambe le divisioni sono corrette. Il REPORT.md:32-33 usa questi numeri solo come caveat ("no datum", "no comparison and no adjudication") — coerente con l'assenza totale di t/s prodotti. Nessuna violazione: il caveat dichiara correttamente che nessun confronto è stato fatto.

Nota hostille di contesto: i comparatori sono "same device, earlier binary lineage" (PREREG.md:41) e il pin set contiene 3 MISMATCH vs l'archivio (§1c) — la frase "same device" è prose-only (§1d). Il caveat del REPORT non può essere ricalcolato (non c'è dato), quindi qui non c'è nulla da adjudicare. OK.

## §6 — Finding aggiuntivi non richiesti

1. **Evidenza non committata in git (il più serio a livello process).** `git status` sul repo: `REPORT.md`, `RUN_LOG.md`, `manifest.json`, `raw/`, `launch_one.py`, `run_guarded.sh`, `run_kexp_tg128_b1.py`, `run_session.py` sono **tutti untracked (`??`)**. Solo PREREG.md (ecd3e983) e AMENDMENT-1.md (f90a1d5e) sono versionati. Il "LOCK = the commit" del prereg protegge le *regole*, ma **tutti i dati** che sostengono la claim bankable sono fuori controllo di versione al momento del pre-bank.
2. **Timestamp AMENDMENT-1 impreciso**: "Date: 2026-08-28, ~14:5x UTC" (AMENDMENT-1.md:3) vs mtime file 10:43 EDT = 14:43 UTC. ~7-16 min di scarto. Con host a UTC−4 la catena temporale è comunque coerente (STOP 09:48 EDT = 13:48 UTC; restart 10:59 EDT = 14:59 UTC), quindi solo sloppiness, non falsificazione.
3. **Retry mattutino senza raw**: v. §4d — il "10 min" su :37687 non ha log di tentativi (il night retry ha il suo log con 40 try; il mattino no).
4. **cert_mm guard_rc null nel manifest vs 0 nel raw**: dichiarato (RUN_LOG.md:83), va in errata comunque perché il manifest è il documento "pulito" per il bank.

---

## VERDETTO FINALE: **BANK-WITH-ERRATA**

**Bankabile**: la sola claim *correctness unplugged* — MUL_MAT_ID 407/407 (raw/cert_mmid.out:815) e MUL_MAT 925/925 (raw/cert_mm.out:1473), ac:false provato nei battery pre-txt di tutti e tre i run registrati, pin set s3oracle = prereg (11/11 device-SHA verbatim). Zero numeri di speed in bank (correttamente: non ne esistono lato host). La catena prereg→amendment→esecuzione è ricostruibile e i gate attivi sono stati rispettati nei limiti dell'osservabile.

**Errata obbligatori prima del bank** (nessuno invalida la correctness, tutti vanno fissati):

1. **ERRATA su AMENDMENT-1.md:12**: "idle drain ~7.5%/h" → i dati della cella misurano **13–15 %/h** (RUN_LOG.md:89-563; cool_watch.log). Ogni lettura futura di feasibility dell'ultima ora unplugged deve usare ~15 %/h.
2. **ERRATA su "No stdout jsonl / No avg_ts"** (REPORT.md:24, RUN_LOG.md:78,568): vale solo lato host. Per effetto di run_guarded.sh:22,94 + launch_one.py:190 esistono (o possono esistere) `kexp_pp512_b1_1_A.out` e `kexp_tg128_b1_1_A.out` su-device sotto `/data/local/tmp/s23_unplugged_night0/`; il tg128 non è nemmeno menzionato tra i leftover (RUN_LOG.md:87). Se il transport dovesse mai tornare: **prima operazione = sweep di quel dir**, prima di qualsiasi altra cosa. Se non torna: la claim negativa va riscritta come "no t/s *retrieved*; on-device orphan outputs possible and unexamined".
3. **Dichiarare la migrazione di transport :36329→:37687** (chi ha stabilito la nuova porta; mDNS auto-reconnect vs adb connect manuale) e produrre/menzionare l'assenza di raw log per il retry mattutino. "No new ports hunted" (REPORT.md:22) va corretto: nessuna nuova porta *usata attivamente oltre la connessione*, ma una nuova porta è stata usata.
4. **Identità device**: aggiungere evidenza raw del legame endpoint↔serial R3CW406P8CV↔SM_S911U (getprop ro.product.model + ro.serialno) appena possibile; fino ad allora ogni lettura del bank porta il caveat "device identity per RUN_LOG prose only".
5. **Committare** REPORT.md, RUN_LOG.md, manifest.json, raw/ (e gli script harness) — altrimenti il "LOCK" copre 2 markdown e nessun dato.
6. Nota a margine nel bank: preflight tg128 esattamente al gate (36.0 = 36.0, margine zero); unplug-time 28.7 °C del prereg senza raw di supporto (raw: 28.6/28.9).

**NO-BANK per**: qualsiasi numero di throughput, ogni lettura di #18/#20, e ogni uso della figura 7.5%/h.

*Fine audit. Contatori: ~15 file letti in raw/, 3 grep mirati su session.stdout.log, zero file modificati fuori da questo REPORT.*
