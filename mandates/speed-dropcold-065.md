# MANDATO — velocità da STACCATO: F=0.65 vs default 0.50 (gate di SOSTITUZIONE)

F=0.65 è CANDIDATO SOSTITUZIONE (`moe-knee-dropcold.md`: ΔPPL +0.104 ≤ 0.15,
byte −41.7% ≤ −25%). Qui il metro è diverso dall'adozione di 0.50: **la campagna è
"banda per token" — il −42% di byte È il premio; la velocità deve solo NON
regredire.** Il costo vero della sostituzione è il budget PPL (0.104 spesi su 0.15):
quello lo pesa gualt, non questo mandato.

**Precondizioni dure:** UNPLUGGED, batteria **≥ 45%** (ora è ~29%: caricare prima);
floor 30% = STOP; binario CAMPAIGN `1ca51420…` (sha check, NESSUN rebuild);
guardrail com lib aggiornata (`74bbb4d`, ABORT_MEM combinato); flight recorder;
`screen_off_timeout` ripristinato a fine; non toccare `../ai-chat`; STOP ai gate;
mai `complete_goal`.

## Disegno A/B

- **A** = `--drop-cold-experts 0.50` (default attuale — è nel config harness);
- **B** = `--drop-cold-experts 0.65` (override esplicito).

2 prompt (short + f45_1, sha verificati) × 2 rep × 2 bracci, n=200, config di
campagna, **ordine ABBA per prompt**, fadvise cold prima di OGNI run.
Metriche per run: eval tok/s, prefill tok/s, hit%, drop%, MiB/tok, memfree_min,
die max, VmHWM, batt%, bin_sha256, lmkd.

**Consistenza attesa** (dal knee, twin f45): B → MiB/tok ≈ 28.6, hit ≈ 82.4,
drop ≈ 6.1%. Se il device dà numeri incoerenti con la banda knee → STOP e riportare.

**Smoke KV con B** (due turni `--session`, n=32): n_past=71 atteso invariato.

**Sostenuto n=512 con B** (1 run, se batteria ≥ 38% a celle chiuse): eval, die
curve. Con −42% di I/O l'ipotesi è che scaldi MENO: annotare die mediano in decode
(confronto col ~68 °C storico di Cella 4 e col 79.8 del giro finale).

## Regole di decisione (dichiarate ORA — gate di NON-REGRESSIONE)

Confronto su mediane pooled dei 4 run per braccio, MA a verbale anche la vista
per-prompt (lezione dell'A/B precedente: il pooling gonfia i Δ).

| esito decode B vs A | conclusione |
|---|---|
| B ≥ A − **2%** | **SOSTITUZIONE RACCOMANDATA**: il traffico −31% incrementale è gratis o quasi in velocità — la decisione finale (budget PPL) resta a gualt |
| B > A + 3% | idem, con velocità in più a verbale (annotare per-prompt) |
| B < A − 2% | **si tiene 0.50**: la regressione velocità si somma al costo budget — non paga |
| incoerenza banda (MiB/tok B ≉ 28.6 ± 10%) | STOP prima di concludere |

## Deliverable

`reports/moe-speed-dropcold-065.md`: tabella run per run + mediane pooled e
per-prompt, Δ%, smoke KV, sostenuto con confronto termico, batteria, guardrail
(incluso: il combinato ha taciuto sui memfree bassi normali?), verdetto per le
regole. Artefatti `results/dropcold/speed065/` (+ mirror PC). **STOP al report —
la sostituzione è di gualt.**
