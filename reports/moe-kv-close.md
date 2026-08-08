# Chiusura campagna KV — 2026-08-08

## Cosa è stato fatto (vs piano)

Mandato `mandates/close-kv-campaign.md`, 4 passi in ordine obbligato:

1. Indagine riavvio mid-G-K3 (~15:21) **prima** di toccare lo stato.
2. Ripristino cpuset/nproc top-app.
3. G-K3 8/8 su path `-p` con `bmoe-cli.KVFIX` vs ref F5.5-B.
4. Re-pin CAMPAIGN + smoke due-turni + rimozione binari usa-e-getta.

**Non toccati:** `../ai-chat`, `PLAN.md`, `bmoe-cli.PREFAULT`, sorgente fork.

---

## 1. Indagine riavvio (evidenze grezze)

| fonte | risultato grezzo |
|---|---|
| `getprop sys.boot.reason` (adb) | `reboot` |
| `getprop sys.boot.reason.last` | `reboot` |
| `getprop ro.boot.bootreason` | `reboot` |
| `getprop persist.sys.boot.reason.history` | `reboot,1786216857` / `reboot,1786126642` / `reboot,shell,1786007813` / `reboot,shell,1785979940` |
| timestamp `1786216857` | **2026-08-08 15:20:57** (locale EDT) — coincide col mid-suite G-K3 |
| dropbox | `2026-08-08 15:21:13 SYSTEM_BOOT`; `SYSTEM_LAST_KMSG_7_20260808_152113_KP` (compressed text, 14033 B); `SYSTEM_AUDIT` |
| contenuto LAST_KMSG_…_KP | solo log XBL/ABL del **nuovo** boot; `Last boot reason: reboot`; `reboot_reason = 0x4`; **nessun** testo `Kernel panic` / `Oops` / `thermal` / `watchdog` / stack dump del kernel precedente |
| `logcat -L -b kernel,crash` (ssh Termux) | vuoto / non disponibile |
| `/sys/fs/pstore/` | `Permission denied` (no root) |
| `/proc/last_kmsg` | `Permission denied` |
| tombstone 15:00–15:30 | nessuno legato al reboot (tombstone a 14:26–14:40 pre-reboot; uno a 17:14 post) |

**Classificazione (tabella mandato):**

| evidenza | classe |
|---|---|
| reason dichiarato = `reboot` (non `thermal` / non `userrequested` / non `shell` per questo evento; non panic text recuperabile) | **UMANO/SOFTWARE** |

Note:
- Il tag dropbox ha suffisso `_KP` (convenzione Samsung spesso = Kernel Panic), ma il payload stampabile non contiene stack panic: non basta per classificare **PANIC**.
- Non è `thermal` / `thermal_shutdown` → non THERMAL.
- Non è `watchdog` → non WATCHDOG.
- History: i due reboot precedenti con suffisso `shell` sono esplicitamente shell-initiated; **questo** (15:20:57) è solo `reboot` senza `shell`/`userrequested`.
- **Azione per gualt:** confermare se ha riavviato lui a ~15:21. Se no, il prossimo riavvio inspiegato va trattato come indagine seria (UNKNOWN escalate), non come rumore.

---

## 2. Ripristino cpuset / nproc

| voce | valore |
|---|---|
| pre | `nproc=3`, cpuset confinato post-boot (CPU online 0–7, processo in background) |
| procedura | adb: `KEYCODE_WAKEUP` + `monkey -p com.termux 1` + `am start -n com.termux/.HomeActivity`; ssh: `termux-wake-lock`; screen_off_timeout 30 min |
| post (shell dei run) | **`nproc=7–8`**, `cpuset=/top-app`, affinity mask `df`/`ff` |
| preflight G-K3 | ogni cella: die ≤80 °C start, nproc≥6, HARD STOP 98 °C, batteria FULL PLUGGED_AC |

---

## 3. G-K3 — path `-p` — **8/8 PASS**

- Binario: `bmoe-cli.KVFIX` sha256 `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178`
- Config G-A: `-t 4 -c 4096 -n 200|256 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8` + **`-p "$(cat prompt)"`** (non `--session`)
- Prompt sha: tutti match `results/f5.5/b/prompt_sha256.txt` prima del run
- Confronto: `cmp -s` byte-identico vs `results/f5.5/b/*-k8.gen.txt`
- Artefatti telefono: `~/experiments/results/kv_close/g3/`
- Harness: `scripts/run_gk3_close.sh` (solo k=8, stop al primo mismatch)

| prompt | n_prompt | tokens | gen_sha (full) | vs ref | esito |
|---|---:|---:|---|---|---|
| short | 114 | 200 | `9a3f4175a08474fa9bf4339fac11b085449e3787cc23ed8ab848775d0cb3a008` | ≡ | **PASS** |
| f45_1_esplicativo | 121 | 200 | `2424179fe22e5cfed996029c1b3646795af28950bed80c963a2240dca5915675` | ≡ | **PASS** |
| f45_2_scrittura | 133 | 139 | `71216127365912c87c03f8908cee38d794b5f262e60092d6083fa6bf5616be13` | ≡ | **PASS** |
| f45_3_istruzioni | 114 | 135 | `baadf7b31955c23a4bdc69058eccb23e662b595abfaeed08c34fbb727caaceb0` | ≡ | **PASS** |
| f45_4_codice | 148 | 200 | `d9c57c56fa8af23b126b5e0e36f6b61a7f07895f1a250cae46ed0b9b0b621376` | ≡ | **PASS** |
| f45_5_ragionamento | 164 | 165 | `9397d763d446894d37b46be3a6d26b8b8bd8c515d018fdbc7779d2d673e71741` | ≡ | **PASS** |
| long_conversational_it | 143 | 256 | `64f6f2bd655ca0f5e50b51259fd67a4e0dca80569db1b09b8a4ef539be1f2d41` | ≡ | **PASS** |
| d1_long | 1318 | 256 | `50b17f329c6c19fcb269ead312504c25a18e9b5bbde5d7ae477855b0d93c21c6` | ≡ | **PASS** |

**PASS=8 FAIL=0.** n_prompt stile F5.5-B (es. f45_1=121, non 124 del path `--session`). Sul path `-p` il codice multi-turno non gira (history vuota, primo turno): 8/8 attesi e ottenuti → nessuna regressione single-turn del fix KV.

---

## 4. Re-pin CAMPAIGN + smoke

### Pin

| | sha256 |
|---|---|
| **VECCHIO** CAMPAIGN | `ad058660f42e7c4029cfe76979d891d38db341c631720237bb45e4b40e97cb17` |
| **NUOVO** CAMPAIGN (= KVFIX) | `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178` |
| PREFAULT (intatto) | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` |

**Motivazione:** adozione fix KV dopo G-K1/G-K2 PASS e G-K3 8/8 su path `-p`.

Procedura: `chmod u+w` → `cp bmoe-cli.KVFIX → bmoe-cli.CAMPAIGN` → `chmod a-w` → aggiornato `CAMPAIGN.sha256`.  
KVFIX resta come copia nominata. Rimosso: `bmoe-cli.KVCTRL`, `bmoe-cli.DIAG`. PREFAULT non toccato.

### Smoke post-pin (due-turni diagnosi, binario CAMPAIGN appena pinnato)

Config lampo: `-t 4 -c 2048 -n 32 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session`  
Input: `gk1_in.jsonl` (stesso prompt sha `a8471e81…5cc9`, t1 clear_kv=true, t2 clear_kv=false).

| turno | clear_kv | n_prompt | n_past | tokens | prefill_s | n_common |
|------:|----------|---------:|-------:|-------:|----------:|---------:|
| 1 | true | 39 | 71 | 32 | 4.310 | 0 (atteso) |
| 2 | false | **41** | 144 | 32 | 4.213 | **71** (= 144−41−32) |

**PASS.** Testo t1=t2 (temp 0). Conferma: il binario pinnato è quello col fix.

Artefatti: `~/experiments/results/kv_close/smoke_postpin/` (telefono), `results/kv_close/` (repo).

---

## 5. ALLOW_UNPINNED

| dove | valore | perché |
|---|---|---|
| `scripts/run_gk3_close.sh` / suite G-K3 | `ALLOW_UNPINNED=1` | gate pin campagna rifiuta binari non-`*.CAMPAIGN`; G-K3 doveva girare su **KVFIX** pre-pin (misura di non-regressione, non di campagna) |
| smoke post-pin | **non** usato | binario = `bmoe-cli.CAMPAIGN` pinnato |

Annotato in master log e in ogni `*-k8.meta`.

---

## Numeri chiave

| gate | esito |
|---|---|
| G-K1 (precedente) | PASS n_common=71 |
| G-K2 (precedente) | PASS testo t2 KVFIX≡KVCTRL |
| G-K3 path `-p` (questo mandato) | **8/8 PASS** |
| smoke post-pin | **PASS** n_common=71, n_prompt(t2)=41 |
| re-pin | ad058660… → ede3ac7c… |

## Deviazioni / sorprese / bug

- Riavvio mid-suite precedente classificato UMANO/SOFTWARE (reason=`reboot`); payload LAST_KMSG_KP senza stack — non PANIC dimostrabile.
- G-K3 precedente (path `--session`) era PARZIALE per reboot + delta 3 token session vs `-p` (pre-esistente su CAMPAIGN). Chiusura sul path corretto (`-p`) risolve.

## Verdetto gate: **PASS**

Parte “righello + fix di prodotto” chiusa. CAMPAIGN = fix KV. Coordinatore aggiorna PLAN.

## Prossima azione proposta

Fase di spinta (coordinatore): riprendere misure di campagna sul pin nuovo; se gualt non ha riavviato a 15:21, documentare protocollo indagine riavvio #2.

DONE
