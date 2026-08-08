# MANDATO — sessione di misure DA STACCATO: quanto vale tutto questo in secondi veri

Prerequisito: `adopt-dense2.md` completato (CAMPAIGN = `cab20432…`). **CAVO STACCATO**
per tutta la sessione: qui si misura il tempo, e la regola di campagna è ferrea (timing
solo unplugged; `termux-battery-status` → `UNPLUGGED` verificato prima di ogni cella, se
in carica il run non parte e non entra nel CSV).

**Regole fisse:** non toccare `../ai-chat`; STOP ai gate; mai `complete_goal`; binario
SOLO `bmoe-cli.CAMPAIGN` via pin (niente `ALLOW_UNPINNED` in questa sessione: sono misure
di campagna); `bin_sha256` in ogni riga di `runs.csv`; **flight recorder attivo** per
tutta la sessione; prompt byte-identici con sha256 verificati prima di ogni cella;
preflight per cella: die sotto soglia start, `nproc≥6`, batteria ≥30% (sotto il 30% la
sessione si ferma e si riporta il punto raggiunto).

**Ordine delle celle = priorità.** Se la batteria finisce, le celle in fondo si perdono,
non quelle in cima.

---

## CELLA 1 — il numero del prodotto: conversazione multi-turno vera

La ragione di tutta la campagna KV. Conversazione a 5 turni stile F5.1 (stessi prompt di
F5.1 se archiviati — verificare sha; altrimenti conversazione IT equivalente dichiarata
e archiviata in `prompts/`), `--session`, `clear_kv=false` dai turni 2+, temp 0, config
di campagna.

Misurare per turno: `n_prompt`, `n_common`, `prefill_s`, `decode tok/s`, wall totale.

| attesa dichiarata | fonte |
|---|---|
| turno 5: prefill nell'ordine di ~5-15 s (solo suffisso) | fix KV: `n_common` cresce coi turni |
| storico da battere: **165 s** di prefill al turno 5 | F5.1 |

2 ripetizioni (cache calda fra i turni è parte del fenomeno misurato; fadvise solo a
inizio conversazione, non fra i turni).

## CELLA 2 — cache 3000 e 3500 (il fix del loader la sblocca)

Per C ∈ {2000 (baseline), 3000, 3500}: 2 prompt fissi (short + un f45), 2 ripetizioni,
`n=200`, cache fredda a inizio config. Misurare: decode tok/s, `expert_hit_rate`,
`memfree_min`, VmHWM, eventi lmkd (logcat).

**Decisione:** si adotta C maggiore SOLO se tok/s mediano ≥ **+5%** vs 2000 **e** zero
kill lmkd **e** `memfree_min` > 300 MiB. Altrimenti resta 2000. Se 3000 passa e 3500 no,
si prende 3000.

## CELLA 3 — ubatch 512 vs 2048, velocità di prefill (con la cache vincitrice)

Output già provati byte-identici (F5.4-D1): qui si misura solo il tempo. Prompt lungo
(d1_long, 1318 token), 2 ripetizioni per lato. Misurare: prefill tok/s, `memfree_min`,
lmkd.

**Decisione:** 2048 si adotta SOLO se prefill ≥ **+10%** **e** zero segnali di pressione
(no lmkd, `memfree_min` > 300 MiB). Il costo noto è ~2 GiB di compute buffer contro
~0.5: in dubbio vince 512.

## CELLA 4 — plateau sostenuto (se la batteria regge)

1 run lungo: `n=512`, prompt fisso. Curva tok/s per blocco di 64 insieme al flight
recorder (die °C): dove inizia il throttling da staccato, e a quale tok/s si stabilizza.
Solo misura, nessuna decisione.

---

## Deliverable

`reports/moe-misure-staccato.md`: tabella per cella con mediane e finestre di batteria,
righe `runs.csv` aggiunte (con `bin_sha256`), verdetti Celle 2-3 secondo le regole,
confronto Cella 1 vs storico F5.1 turno per turno, curva Cella 4. Artefatti in
`results/staccato/`. **STOP al report** — le adozioni (cache, ubatch) le decide gualt
sui verdetti.
