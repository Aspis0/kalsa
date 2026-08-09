# MANDATO — indagine riavvio #2 (STOP campagna finché non chiude)

Secondo riavvio inspiegato in 6 ore (ieri ~20:52, durante C3500 in thrashing). Regola
dichiarata dopo il primo: si ferma tutto e si indaga. Questo mandato È l'indagine, più le
due code pendenti della parte 2, più i guardrail. **Nessuna misura di campagna finché non
è chiuso.**

**Già noto (non rifare):** boot ~20:52 verificato (uptime); flight recorder ultimo minuto:
die 88-90 °C sostenuti, memfree 14-18 MiB, poi alle 20:50:46 die 90→72 °C e memfree
14 MiB→4.8 GiB (il processo bmoe è morto o è stato ucciso), sistema giù entro ~1 min.
Firma comune col riavvio #1 (15:21): ~90 °C + pressione memoria. ssh non può leggere i
getprop di boot (permessi): serve adb.

## PASSO 1 — evidenze (via adb wireless; se giù, riattivarlo col telefono in mano)

1. `getprop persist.sys.boot.reason.history` — ora contiene ENTRAMBI gli eventi (15:21 e
   20:52): salvarla integrale.
2. `dumpsys dropbox` — entry 20:45–21:00 di ieri; `--print` di SYSTEM_BOOT,
   SYSTEM_LAST_KMSG*, tombstone, watchdog. Cercare anche l'evento lmkd/OOM di bmoe alle
   ~20:50 (`logcat -b events -d | grep -i "am_kill\|lowmemorykiller"` se il buffer
   sopravvive; probabilmente no — annotare).
3. Salvare tutto in `results/reboot2/` (telefono + copia host).

**Classificazione (stesse regole del riavvio #1)** — con una lettura in più: se anche
questo è `reboot` nudo con `_KP`, due eventi identici sotto la stessa firma non sono più
"inspiegati": sono **riproducibili** — il telefono si riavvia sotto die ~90 °C sostenuti
+ OOM storm. La causa precisa (panic kernel vs PMIC vs watchdog silenzioso) resta aperta,
ma la mitigazione non dipende da quale delle tre è.

## PASSO 2 — code pendenti della parte 2

1. `settings put system screen_off_timeout 1800000` (ripristino; verificare con `get`).
2. Pull completo di `~/experiments/results/staccato2/` → `results/staccato2/phone/` nel
   repo (STACCATO2.master.log, flight.log completo, cells.csv, runs_added.csv,
   cella2/*). Il flight.log integrale è il documento chiave: la curva die/memfree
   dell'intera C3500.

## PASSO 3 — guardrail ricalibrati (harness, non binario)

In `lib` comune dell'harness (usata da ogni cella futura):
- **Termico**: die > **88 °C** sostenuto per 60 s → PAUSA (stop generazione, attesa
  < 80 °C, resume o abort dichiarato). L'HARD STOP a 98 non è mai scattato: il telefono
  muore a ~90. Il limite operativo è 88.
- **Memoria**: `MemFree` < **100 MiB** sostenuto per 10 s → **ABORT_MEM** della cella,
  esplicito nello STATUS. Un run in quel regime produce numeri spazzatura E rischia il
  reboot: non va "tenuto duro", va abortito.
- I due guardrail loggano nel flight.log quando scattano.

## Deliverable

`reports/moe-reboot2.md`: evidenze grezze, classificazione, conferma ripristino timeout,
conferma pull, diff dei guardrail. **STOP al report.** La ripresa della campagna
(celle 3-4 con guardrail attivi) la decide gualt dopo averlo letto.
