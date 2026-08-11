# MANDATO — S23: fix harness `--session` + recupero dei due blocchi non misurati

La sessione scheda (`moe-calaqwen-scheda.md`) ha lasciato due buchi per un bug
del driver NUOVO: **0 BMOE_DONE emessi/parsati in modalità `--session`** → conv5
TTFT e l'intera decomposizione N1 v2 = INSUFFICIENT_DATA. Questo mandato
diagnostica, fixa e recupera. Config e regole = identiche al mandato v2
(`calaqwen-sessione-s23.md`): default A pinnato, KEXP `ac44e20c…`, CAMPAIGN
`1ca51420…`, guardrail device sha-verificati, floor 30%, timing staccato.

## PASSO 1 — diagnosi contro il known-good (PC/in carica, deterministico)

Il protocollo `--session` HA funzionato in passato sullo stesso binario:
- smoke KV di `speed-065` e `requant-1c` (`results/requant1c/run_kv_session_kexp.sh`,
  `results/dropcold/speed065/smoke_kv/`) — n_past=71 parsato correttamente;
- conv5 del giro adozione (`results/adopt_dropcold/conv5/`) — 5 turni con
  prefill/turno letti.

Confrontare RIGA PER RIGA l'invocazione del driver rotto
(`scripts/run_calaqwen_s23.sh`, sezioni session) con gli script known-good:
formato del JSONL di input (campi? newline finali? encoding CRLF da Windows?),
redirezione stdout/stderr (il BMOE_DONE esce su quale stream?), flag mancanti.
**Riprodurre il bug con 1 run di smoke, POI fixare, POI riprovare lo stesso
smoke**: la diagnosi va nel report (una riga: cosa era rotto).

## PASSO 2 — recupero conv5 TTFT (staccato, batteria ≥ 50%)

Protocollo del giro adozione: 5 turni, prompt per turno con sha, `clear_kv`
solo al T1, n=256/turno, fadvise a inizio conversazione. Deliverable: tabella
prefill/turno + n_past/turno (la riga TTFT della scheda che manca).

## PASSO 3 — recupero N1 v2 (staccato, ~45 min)

Protocollo ESATTO del mandato v2 (tutti i fix dell'audit già scritti lì):
- t2 = `'x '*k` letterale, k ∈ {0, 8, 32, 64, 128, 256}, 2 rep;
- **verifica per-cella n_prompt = 14+k (±1)** — fuori specifica = scartata;
- cella controllo one-shot `-p` ~128 token; control t_decode1 in config A;
- fit `t_prefill = F + m·n_prompt` su MISURATO, R² e IC, soglia m ≤ 0.3·t1;
- tabella k / n_prompt / prefill_s / MiB_tok.

| esito | conseguenza |
|---|---|
| F(0) grande, m ≤ 0.3·t1, one-shot ≪ session | dossier riapertura MTP-spec a gualt |
| F cresce con k o m ≈ t1 | epitaffio spec definitivo |

## PASSO 4 — validazione segno energia (in carica + staccato, 10 min)

Il ~0.455 J/token della scheda ha un caveat sul segno dell'idle: misurare
30 s di idle (schermo ON, niente bmoe) STACCATO e 30 s IN CARICA, verificare
segno e grandezza di `current` in entrambi; ricalcolare J/token delle celle
della scheda con la convenzione validata. Se il valore cambia oltre il 15%,
correggere la riga di scheda nel report.

## Deliverable

`reports/moe-calaqwen-fix-session.md`: diagnosi del bug (una riga), tabella
conv5, tabella e fit N1 v2 col verdetto secondo le regole, energia validata.
Artefatti `results/calaqwen_s23/fix/`. **STOP ai gate — la riapertura MTP-spec,
se i numeri la aprono, è decisione di gualt.**
