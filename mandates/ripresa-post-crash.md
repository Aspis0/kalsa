# MANDATO — ripresa post-crash PC (1c + scala speculazione)

Il PC è crashato ~11:32 del 2026-08-10 con 1c e scala in volo. Stato verificato dal
coordinatore sul disco (commit repo intatto a `6b90743`, nulla di Grok era committato):

| item | stato |
|---|---|
| imatrix (192 223 904 B) | ✅ completa, sha registrato (`results/requant1c/imatrix.sha256`) |
| Q8_0 download | **parziale: 13 962 309 632 / 36 903 140 320 B (~38%)** — resumabile |
| quantize | ⚠️ partita PREMATURAMENTE sul file incompleto (waiter buggato), EXIT=1 pulito al tensore 80/733; **nessun KEXP.gguf su disco** — niente da pulire |
| recipe + verify + fasi B/C | ✅ pronti (`tensor_types.txt`, `verify_kexp.py`, `run_phase_{b,c}*.sh`) |
| scala N2 | script + download draft/MTP parziali + build llama in corso al momento del crash — tutto resumabile |
| scala N1 | driver pronto (`results/spec_ladder/n1/`), mai eseguito su device |
| disco | 239 GB liberi — NON è la causa del crash |
| telefono | non coinvolto (il crash è solo PC) |

## Regole di ripresa (correzioni obbligatorie rispetto al primo giro)

1. **Resume, non restart**: Q8_0 con `curl --continue-at -` sullo stesso file.
2. **Gate duro prima della quantize** (il bug da correggere): la quantize parte SOLO
   se `size == 36903140320` **E** sha256 == valore atteso in
   `results/requant1c/q8.sha256`. Niente waiter a tempo: check espliciti.
   Se lo sha del file resumato non torna → si butta e si riscarica da zero.
3. **Serializzare i carichi pesanti**: causa del crash ignota → non correre
   download 37 GB + quantize + build llama + pip in parallelo come al primo giro.
   Ordine: (a) finire il download Q8; (b) quantize da sola; (c) N2 build/misure.
   Gli step leggeri di N2 (script, verifiche flag) possono andare nel mentre.
4. A ogni blocco completato: commit (così un secondo crash non azzera il verbale).
5. Tutto il resto dei mandati (`requant-esperti-1c.md`, `scala-speculazione.md` +
   `scala-speculazione-addendum.md`) resta valido invariato, gate compresi.
6. **Non cancellare nulla** senza ok di gualt. Candidati rifiuti da segnalare a
   fine report (decisione sua): `models/Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` (12.3 GB,
   1b chiuso: inutile) e `models/LFM2-8B-A1B-Q4_K_M.gguf.BADSIZE` (5.4 GB).

## Causa del crash — CHIUSA (indagine coordinatore, event log)

**Bugcheck `0x19C` = WIN32K_POWER_WATCHDOG_TIMEOUT** (win32k non ha riacceso il
monitor in tempo): crash di power-management/driver display, non di carico.
La quantize è ASSOLTA dalla timeline: uscita pulita loggata 11:23:11, file scritti
fino alle 11:32:46 (macchina viva 9+ min dopo), ultimo evento = ingresso in Modern
Standby 11:33:11, crash nella finestra di standby (l'"11:23:15" del 6008 è il
checkpoint stantio del dirty-shutdown, notorio). Zero record WHEA (no hardware).
L'event log mostra churn ripetuto di Modern Standby (ScreenOffTimeout→wake ogni
pochi minuti) prima del botto.

**Mitigazione obbligatoria per la ripresa**: il PC non deve entrare in standby
durante i lavori lunghi non presidiati — `powercfg /change standby-timeout-ac 0`
(e annotare il valore originale per ripristinarlo a fine campagna), o equivalente
keep-awake. È la versione PC dello screen_off_timeout del telefono: stessa
lezione, stesso protocollo (alzare, lavorare, RIPRISTINARE).

## Deliverable

Gli stessi dei mandati originali, più una riga nel report su cosa si è perso nel
crash (atteso: nulla di misurato, solo tempo di download/build).
