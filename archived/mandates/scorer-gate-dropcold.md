# MANDATO — gate device dello scorer, re-pin, e PRIMO sweep --drop-cold-experts

Il lancio di questo mandato da parte di gualt autorizza il re-pin al PASSO 2 (se i gate
passano). Telefono IN CARICA: perfetto — qui è tutto deterministico (byte-identità,
logprob, conteggi). Nessun timing citabile in questo mandato.

**Regole fisse:** base fork `d408e03`; non toccare `../ai-chat`; STOP ai gate; mai
`complete_goal`; PREFAULT intatto; guardrail attivi comunque (anche in carica).

## PASSO 0 — semantica di `--drop-cold-experts` (dal sorgente, prima dei numeri)

Documentare nel report, leggendo il codice: che parametro prende, cosa fa esattamente
(droppa esperti sotto soglia di peso router? sotto soglia di temperatura cache? quanti?),
dove interviene nel decode. Senza questo, lo sweep non è interpretabile. Se la semantica
è diversa da "riduce gli esperti calcolati/caricati per token" → STOP e riportare prima
di misurare.

## PASSO 1 — rebuild + non-regressione

Build Android da `d408e03` → `bmoe-cli.SCORER`.
**G1**: 8/8 byte-identici sul path `-p` vs `results/f5.5/b/*-k8.gen.txt` (config G-A,
prompt sha verificati). Con scorer spento il decode non deve cambiare di un byte. Una
differenza = STOP. (`ALLOW_UNPINNED=1` annotato: gate.)

## PASSO 2 — gate scorer su device + re-pin

**G2**: `--ppl-decode` sul device, su un sottoinsieme del corpus baseline (~10k token,
posizioni identiche a righe note di `results/f5.5/a/*.per_token.csv`):
- confronto riga-a-riga coi logprob archiviati della baseline (che è prefill-path);
- attesa dichiarata: differenze piccole da percorso/batch (memoria ibrida GDN) —
  tolleranza **|ΔPPL_subset| ≤ 0.02**; riportare il Δ esatto e il max|Δ| per posizione.
- Se ΔPPL > 0.02: STOP — è un bug dello scorer o una scoperta sul path, in entrambi i
  casi va capito prima di misurare leve.

**Se G1+G2 passano**: re-pin `bmoe-cli.CAMPAIGN` = SCORER (procedura solita: chmod, cp,
sha-file; vecchio `cab20432…` → nuovo sha a verbale). Smoke post-pin: il due-turni KV
(`n_common=71`) — 1 run.

## PASSO 3 — sweep `--drop-cold-experts` (il primo esperimento lossy col metro giusto)

Per ogni valore del parametro (3 valori sensati dalla semantica del PASSO 0 — es. blando
/ medio / aggressivo; dichiararli nel report PRIMA di misurare):
1. `--ppl-decode` sullo STESSO sottoinsieme ~10k token del G2 → ΔPPL vs baseline;
2. byte per token (route/io trace, come nelle fasi F5) sullo stesso run o su run gemello;
3. hit rate cache.

**Regole di decisione (soglia di campagna, la stessa che ha ucciso k):**

| esito | conclusione |
|---|---|
| ΔPPL ≤ **0.15** e byte/token ≤ **−10%** | CANDIDATO: guadagno reale a qualità tenuta → si misurerà la velocità da staccato (mandato a parte) |
| ΔPPL ≤ 0.15 ma byte < −10% | qualità ok ma non paga: archiviato |
| ΔPPL > 0.15 | archiviato come k5/k6 — la soglia è la soglia |

Ordine: dal valore più blando; se già il blando sfora 0.15, quelli aggressivi si
misurano comunque solo se costa <10 min l'uno (la curva completa vale per il verbale),
altrimenti si dichiara lo skip.

## Deliverable

`reports/moe-dropcold.md`: semantica flag (PASSO 0), G1 8/8, G2 con Δ esatto, re-pin sha,
tabella sweep (ΔPPL, byte/token, hit per valore), verdetto per valore secondo le regole.
Artefatti in `results/dropcold/`. **STOP al report** — l'eventuale candidato passa da
gualt per il test velocità.
