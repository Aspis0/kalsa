# MANDATO — test velocità da STACCATO del candidato `--drop-cold-experts 0.50`

F=0.50 ha passato il metro qualità (ΔPPL +0.051 ≤ 0.15, byte/token −15.9%,
`reports/moe-dropcold.md`). Resta l'ultima domanda: **i byte risparmiati diventano
tok/s?** Se sì quanto — e se no, il candidato muore qui (la qualità non si paga gratis).

**Precondizioni dure (verificare PRIMA di partire, altrimenti STOP e riportare):**
- telefono **UNPLUGGED** (unico modo per timing citabili) e batteria **≥ 45%**;
- floor batteria **30%** = fine sessione (STOP, non "ancora un run");
- `bmoe-cli.CAMPAIGN` = `1ca51420…` (verificare sha contro `CAMPAIGN.sha256` — il flag
  è runtime, NESSUN rebuild in questo mandato);
- guardrail `lib_guardrails.sh` attivi, flight recorder attivo, `screen_off_timeout`
  alzato e RIPRISTINATO a fine (1800000);
- non toccare `../ai-chat`; STOP ai gate; mai `complete_goal`; PREFAULT intatto.

## Disegno A/B (dichiarato prima dei numeri)

Due bracci sullo stesso binario pinnato, config di campagna (cache 2000, ubatch 512,
k=8, dense anon, overlap, io-threads 4):
- **A** = F=0 (flag assente) — baseline;
- **B** = `--drop-cold-experts 0.50`.

**Celle:** 2 prompt fissi (short + f45_1, sha verificati contro i valori a verbale)
× 2 rep × 2 bracci, `n=200`. **Ordine ABBA per prompt** (A,B,B,A) per neutralizzare
la deriva termica; **fadvise cold prima di OGNI run** così i due bracci partono dalla
stessa cache-page state (il drop-cold è cache-dependent: run warm favorirebbero B in
modo non riproducibile).

Metriche per run: decode tok/s (eval), prefill tok/s, `expert_hit_rate`, MiB/tok
(route/io trace), drop%, memfree_min, die max, VmHWM, bin_sha256 in `runs.csv`.

**Smoke KV con flag ON** (1 run, due turni `--session`, n=32): atteso `n_common=71`
identico — il drop è decode-only e non deve toccare il prefill della history. Se
n_common cambia → STOP, è una scoperta.

**Opzionale se batteria ≥ 38% a celle chiuse:** 1 run sostenuto n=512 con B (gemello
della Cella 4) per die/plateau con drop attivo. Se batteria non basta: SKIPPED, scritto.

## Regole di decisione (soglia dichiarata ORA)

Confronto: **mediana decode tok/s dei 4 run B vs 4 run A** (stessa aggregazione per
prefill, riportato ma non decisivo).

| esito | conclusione |
|---|---|
| B ≥ **+5%** vs A, lmkd 0, guardrail 0 | **CANDIDATO ADOZIONE** — proposta a gualt (che decide), con ΔPPL +0.051 a verbale come costo |
| B tra 0 e +5% | non paga: +0.051 di PPL per meno del 5% non si compra. Archiviato, salvo diversa decisione di gualt |
| B < A | archiviato secco: i byte risparmiati non arrivavano al collo di bottiglia |
| hit/drop% device incoerenti col report qualità (drop% ≫ 2.2 o ≪) | STOP e riportare prima di concludere |

## Deliverable

`reports/moe-speed-dropcold.md`: tabella A/B completa (run per run + mediane), Δ%,
smoke KV, eventuale sostenuto, batteria inizio/fine, guardrail scattati, verdetto
secondo le regole. Artefatti in `results/dropcold/speed/` (+ mirror leggero su PC).
**STOP al report — l'adozione è di gualt.**
