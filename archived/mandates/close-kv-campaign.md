# MANDATO — chiusura campagna KV: indagine riavvio, ripristino, G-K3 su path `-p`, re-pin

Quattro passi in **ordine obbligato**: (1) indagine sul riavvio **prima** di toccare lo
stato, (2) ripristino del setup standard, (3) chiusura G-K3 sul path dei riferimenti,
(4) re-pin di CAMPAIGN. Alla fine di questo mandato la parte "righello + fix di prodotto"
è chiusa e si passa alla fase di spinta.

**Contesto fisso:**
- Repo `BigMoeOnEdge` @ `2c675a5` (fix KV già committato). **Non toccare `../ai-chat`.**
  STOP ai gate, **mai `complete_goal`**.
- Stato telefono già verificato dal coordinatore via ssh (17:05, non rifare):
  ssh vivo (Termux:Boot ok), boot ≈ 15:21, CPU online `0-7` ma shell `nproc=3` (cpuset
  confinato), `bmoe-cli.CAMPAIGN` intatto (`ad058660…`, read-only, sha file presente),
  `bmoe-cli.KVFIX` presente (`ede3ac7c…`, build 15:12), batteria FULL su AC.
- Questo mandato è **tutto deterministico** (conteggi e byte-identità): telefono in carica
  ammesso ovunque. Nessun timing citabile.

---

## PASSO 1 — indagine sul riavvio (PRIMA di toccare qualunque stato)

Il telefono si è riavviato da solo a metà della suite G-K3 (~15:21, durante `f45_2`).
Raccogliere le evidenze **in quest'ordine** (dalla più affidabile):

1. `getprop sys.boot.reason` e `getprop persist.sys.boot.reason.history` — il motivo
   dichiarato dal bootloader/kernel, con storia timestampata. È la fonte primaria.
2. Via adb (wireless debug dovrebbe essere su per l'helper; altrimenti solo ssh e si salta):
   `dumpsys dropbox` — elencare le entry tra 15:00 e 15:30; stampare con
   `dumpsys dropbox --print <tag>` le rilevanti (`SYSTEM_BOOT`, `SYSTEM_RESTART`,
   `system_server_watchdog`, `SYSTEM_LAST_KMSG`, tombstone).
3. `logcat -L -b kernel,crash 2>/dev/null | tail -100` (log dell'ultimo boot, se il
   firmware lo supporta) e `ls /sys/fs/pstore/` (probabile EPERM senza root: annotare e
   passare oltre).

**Classificazione (regole dichiarate ora):**

| evidenza | classe | conseguenza per la campagna |
|---|---|---|
| `thermal` / `thermal_shutdown` in boot.reason o kmsg | **THERMAL** | il picco a ~90-92 °C durante il load è un pericolo reale, non solo rumore: proporre (non implementare) un gate termico anche sul load, non solo sul decode |
| `kernel_panic` / oops in LAST_KMSG | **PANIC** | annotare stack; se cita storage/UFS o mm, collegarlo al carico I/O del load |
| `watchdog` | **WATCHDOG** | sistema saturato: annotare cosa girava |
| `reboot` / `userrequested` | **UMANO/SOFTWARE** | chiedere a gualt se ha riavviato lui; se no, cercare chi |
| nulla di conclusivo | **UNKNOWN** | annotare le fonti vuote; non bloccare la campagna, ma il prossimo riavvio inspiegato fa scattare un'indagine seria |

Riportare le evidenze grezze (non solo la classe) nel report.

## PASSO 2 — ripristino del setup standard

- Riportare la shell dei run a **`nproc ≥ 6`** con la procedura consolidata
  (wake-lock/foreground Termux; le CPU sono già tutte online, è il cpuset del processo a
  essere confinato). Verificare `nproc` **nella stessa shell** che lancerà i run.
- Preflight standard: die sotto soglia di start, HARD STOP invariato.
- Non serve toccare ssh/adb: già su.

## PASSO 3 — G-K3, chiusura sul path dei riferimenti

Gli 8/8 vanno rilanciati **sul path `-p`** (quello con cui i riferimenti F5.5-B sono nati,
`n_prompt=121-style`), NON sul path `--session` (che aggiunge 3 token, differenza
pre-esistente documentata in `reports/moe-kv-reuse-fix.md`).

- Binario: `bmoe-cli.KVFIX` (`ede3ac7c…`). Se l'harness pinnato blocca il binario non-CAMPAIGN,
  usare `ALLOW_UNPINNED=1` **esplicito e annotato nel report** — è un gate, non una misura
  di campagna.
- Config esatta G-A: `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream
  --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
  --n-expert-used 8`.
- Prompt di `prompts/`, sha256 verificati contro `results/f5.5/b/prompt_sha256.txt`
  **prima** di lanciare.
- Confronto byte-identico contro `results/f5.5/b/*-k8.gen.txt`.

**Regola (dichiarata ora):** sul path `-p` il codice nuovo non esegue nemmeno (primo turno,
history vuota) → attesa **8/8 identici**. Una sola differenza = **vera regressione o build
sporca**: STOP, riportare, NON procedere al passo 4.

## PASSO 4 — re-pin di CAMPAIGN (solo se 8/8)

1. Sbloccare il pin attuale (`chmod u+w`), copiare `bmoe-cli.KVFIX` → `bmoe-cli.CAMPAIGN`,
   `chmod a-w`, aggiornare `CAMPAIGN.sha256`.
2. Nel report: sha **vecchio** (`ad058660…`) e **nuovo** (`ede3ac7c…`) affiancati, con la
   riga di motivazione ("adozione fix KV dopo G-K1/G-K2 PASS e G-K3 8/8 su path -p").
3. **Smoke post-pin** (1 run): scenario due-turni della diagnosi col binario CAMPAIGN
   appena pinnato → attesi `n_common=71`, `n_prompt(t2)=41`. Conferma che il binario
   pinnato è davvero quello col fix.
4. `bmoe-cli.KVCTRL` e `bmoe-cli.DIAG` si possono rimuovere (usa-e-getta, sha già a
   verbale). `KVFIX` resta come copia nominata. `PREFAULT` non si tocca (riferimento
   storico).

## Deliverable

`reports/moe-kv-close.md` con:
1. evidenze grezze del riavvio + classificazione secondo la tabella;
2. come è stato ripristinato il cpuset e `nproc` finale nella shell dei run;
3. tabella 8/8 (sha per prompt);
4. re-pin: sha vecchio/nuovo, esito smoke due-turni;
5. eventuali `ALLOW_UNPINNED=1` usati, dove e perché.

**STOP al report.** Il PLAN lo aggiorna il coordinatore. Mai `complete_goal`.
