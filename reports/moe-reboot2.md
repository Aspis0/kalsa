# Reboot2 — indagine riavvio #2 + code pendenti + guardrail — 2026-08-09

## Cosa è stato fatto (vs piano)

Mandato `mandates/indagine-riavvio-2.md`. **Nessuna misura di campagna.**

1. **PASSO 1 — evidenze** via adb wireless S23 (`R3CW406P8CV` / mDNS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; **non** 192.168.1.193 = altro device). Artefatti in `results/reboot2/` (host + mirror parziale su telefono `~/experiments/results/reboot2/`).
2. **PASSO 2 — code pendenti parte 2:** ripristino `screen_off_timeout`; pull completo `~/experiments/results/staccato2/` → `results/staccato2/phone/`.
3. **PASSO 3 — guardrail** in lib comune harness + wiring in `run_staccato2.sh` / `run_staccato.sh`; push script su telefono.

Non toccati: `PLAN.md`, `../ai-chat`, binario `bmoe-cli.CAMPAIGN` / `PREFAULT`.

---

## 1. Evidenze grezze riavvio #2

### Boot / uptime

| fonte | grezzo |
|---|---|
| uptime adb/ssh | ~3h18 al momento indagine → boot **2026-08-08 20:51:08 EDT** |
| `persist.sys.boot.reason.history` **integrale** | `reboot,rescueparty,1786236677` / `reboot,1786216857` / `reboot,1786126642` / `reboot,shell,1786007813` |
| ts `1786236677` | **2026-08-08 20:51:17 EDT** (= riavvio #2) |
| ts `1786216857` | **2026-08-08 15:20:57 EDT** (= riavvio #1, G-K3) |
| `sys.boot.reason` / `.last` / `persist.sys.boot.reason` / `ro.boot.bootreason` | **`reboot,rescueparty`** |

### Dropbox (finestra 20:30–20:52)

| ora EDT | tag | note grezze |
|---|---|---|
| 20:34:06 | `system_app_anr` | `com.android.phone` startup fail; psi memory some avg10≈**78%**; CPU: **bmoe-cli.CAMPAIGN 136%**, system_server 118%, **kswapd0 90%**, lmkd attivo; major faults bmoe ~379k |
| 20:34:23 | `system_app_anr` | `com.android.systemui` startup fail; stessa firma thrash (bmoe 160%, kswapd0 90%) |
| 20:34:33 | `system_server_crash` | `IllegalStateException: Lost network stack` — testo esplicito: *side effect of a crash that happened earlier* |
| 20:35:41 | `SYSTEM_RESTART` | 1° restart framework |
| 20:45:00 | `SYSTEM_RESTART` | 2° restart (escalation RescueParty) |
| 20:51:31 | `SYSTEM_BOOT` | boot post-reboot |
| 20:51:31 | `SYSTEM_LAST_KMSG_0_20260808_205131_**RP**` | suffisso **RP** (non KP); payload XBL/ABL; `Last boot reason: **reboot,rescueparty**`; `reboot_reason = **0x7**` |

Confronto #1 (15:21): `SYSTEM_LAST_KMSG_…_**KP**`, reason nudo `reboot`, `reboot_reason=0x4` — **firma dropbox diversa**.

### logcat lmk pre-boot

`logcat -b events` **non** conserva am_kill di bmoe alle ~20:50 (buffer post-boot only). Annotato in `results/reboot2/logcat_events_lmk.txt`.

### Flight recorder (documento chiave C3500)

File: `results/staccato2/phone/flight.log` (67 sample, 20:39:14 → 20:50:46).

| metrica C3500 (~20:41–20:50) | valore |
|---|---|
| die max | **92.8 °C** |
| sample die>88 | **28** (span ~9 min, con intermittenza) |
| MemFree min | **14.0 MiB** (18 sample <100 MiB) |
| collasso 20:50:46 | die 89.1→**71.7 °C**, memfree 14 MiB→**4.8 GiB** (bmoe morto/ucciso) |
| boot successivo | 20:51:17 reason history / 20:51:31 SYSTEM_BOOT |

Sampler C3500 (`cella2/C3500_*.sampler.csv`): die sostenuto 88–92 °C, VmHWM ~4.4–5.1 GiB, MemFree a 13–20 MiB.

File grezzi: `results/reboot2/*` (boot props, dropbox list/print estratti, LAST_KMSG #1/#2, ANR, system_server_crash, CLASSIFICATION_NOTES).

---

## 2. Classificazione

| evidenza | classe tabella §riavvio#1 |
|---|---|
| reason = `reboot,rescueparty` (non `thermal` / non `shell` / non panic text) | non THERMAL dichiarato; non PANIC dimostrabile; non WATCHDOG |
| LAST_KMSG solo ABL del **nuovo** boot, no stack panic | non PANIC |
| catena ANR system + system_server_crash + 2× SYSTEM_RESTART + RescueParty | **SOFTWARE** (framework recovery), innescato da thrash |
| firma operativa comune a #1: die ~90 °C sostenuti + OOM/MemFree a due cifre MiB sotto C3500 | **RIPRODUCIBILE** |

**Verdetto:** non più “inspiegato UMANO”.  
- **Classe formale bootloader:** `reboot,rescueparty` → software/framework (RescueParty), non panic kernel stampabile.  
- **Classe operativa campagna:** **RIPRODUCIBILE** sotto firma **die ≈ 88–92 °C sostenuti + MemFree ≪ 100 MiB** durante thrashing MoE.  
- Causa kernel esatta (panic silenzioso vs PMIC vs watchdog) resta aperta; **la mitigazione non dipende da quale delle tre**: non restare in quel regime.

Riavvio #1 resta reason nudo `reboot`+_KP (classificato UMANO/SOFTWARE in `moe-kv-close.md`); #2 è **escalation RescueParty** dopo crash system_server. Firma termica/memoria **condivisa**.

---

## 3. Code pendenti parte 2

### screen_off_timeout

| | valore |
|---|---|
| originale documentato | **1800000** (30 min) in `results/staccato2/screen_off_timeout.orig` |
| pre-ripristino | 7200000 (era stato alzato in sessione) |
| post `settings put system screen_off_timeout 1800000` | **1800000** (verificato `get`) |
| status | `RESTORE_OK value=1800000` |

### Pull staccato2

`results/staccato2/phone/` include:

- `STACCATO2.master.log`, `flight.log` (integrale), `cells.csv`, `runs_added.csv`, `STATUS.txt`, `SKIPPED.txt`
- `cella2/*` (C2000/C3000/C3500 short+f45, sampler/summary/stdout/stderr; `partial/C3000_short_r1.KILL.txt`)
- nohup_*, prompts/, batt_start.json

Celle 3–4: directory vuote (non avviate / skip).

---

## 4. Guardrail ricalibrati (harness, non binario)

### File nuovo

`scripts/lib_guardrails.sh`

| soglia | azione | log |
|---|---|---|
| die > **88 °C** sostenuto **60 s** | `PAUSE_THERMAL`: kill bmoe, attesa die ≤ **80 °C** (timeout 600 s), STATUS + STOP_REASON | `GUARDRAIL,…,THERMAL_PAUSE*` su **flight.log** + master |
| MemFree < **100 MiB** sostenuto **10 s** | `ABORT_MEM` cella, STATUS esplicito, STOP_REASON | `GUARDRAIL,…,ABORT_MEM` su flight.log |
| die > **98 °C** | HARD_STOP legacy `DIE_98` | invariato |

Soglie: `DIE_PAUSE_MC=88000`, `DIE_RESUME_MC=80000`, `DIE_PAUSE_HOLD_S=60`, `MEM_ABORT_KB=102400`, `MEM_ABORT_HOLD_S=10` (righe ~24–29 lib).

### Wiring

- `scripts/run_staccato2.sh`: source lib (~68–81); sampler `run_single` (~621–647) chiama `guardrail_tick` / `guardrail_apply_to_pid`; post-wait rc 96/97/99 (~661–689); cella4 sampler (~1060+).
- `scripts/run_staccato.sh`: stesso source + sampler `run_single`.
- Push telefono: `~/experiments/scripts/{lib_guardrails,run_staccato,run_staccato2}.sh` — `bash -n` OK.

Sostituisce il vecchio MEM_ABORT solo a cache≥3000 e MemFree<25 MiB ×4 sample: troppo tardi (il telefono muore già a ~14–20 MiB con die~90).

---

## Verdetto gate

**PASS (indagine chiusa a livello mandato).**  
Campagna celle 3–4: **STOP** finché gualt non decide ripresa **con** guardrail attivi.

## Prossima azione proposta

1. gualt legge questo report.  
2. Se ripresa: celle 3–4 su CAMPAIGN pin intatto, harness con lib_guardrails, preferire non spingere C3500 senza headroom termico/memoria.  
3. Opzionale: abbassare ancora DIE_PAUSE o allungare cool-down se i PAUSE sono troppo frequenti.

DONE
