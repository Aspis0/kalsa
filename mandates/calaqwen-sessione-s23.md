# MANDATO — sessione S23: scheda CalaQwen + decomposizione N1 + cache re-bracket

Il Samsung è libero. Tre blocchi in ordine di priorità (un'interruzione lascia i
più importanti chiusi). Modello = KEXP, default A (k=6, drop 0.65), binario
CAMPAIGN `1ca51420…` (sha check). Guardrail `74bbb4d` + flight; floor 30%;
timing solo STACCATO; deterministico in carica OK; screen ripristinato;
non toccare fork/`../ai-chat`; STOP ai gate.

## BLOCCO 1 — scheda prodotto CalaQwen definitiva (staccato, batteria ≥ 50%)

1. **Sostenuto LUNGO** (chiude il flag "monco a 199"): prompt f45_1, n=512 con
   `--ignore-eos` se il flag esiste (verificare in --help; altrimenti prompt
   lungo che non satura EOS), 2 rep, cold. Metriche: eval tok/s, die curva
   (mediana/p90/max), hit, MiB/tok.
2. **Conversazione 5 turni KV** (gk1 5 turni): prefill per turno + n_past —
   la riga TTFT della scheda col default nuovo.
3. **Load cold** 2 rep (atteso ~10 s, invariante).
4. **Energia**: 1 run lungo (n=512) con batt% e (se leggibile)
   `/sys/class/power_supply/battery/{current_now,voltage_now}` campionati dal
   flight → **J/token stimati** + "token per carica" aggiornato (la riga è ferma
   a F4.7, pre-drop pre-k6: attesa migliorata).
Deliverable: tabella scheda completa in `reports/moe-calaqwen-scheda.md`.

## BLOCCO 2 — decomposizione N1 (l'autopsia dell'anomalia; staccato, ~40 min)

Protocollo identico all'N1 (via `--session`, turno 2 aggiunge k token), ma
k ∈ {8, 32, 64, 128, 256}, 2 rep, cold a inizio serie. Fit dichiarato:
`t_prefill(k) = F + m·k`.

| esito | lettura |
|---|---|
| F ≈ 1.5-2 s stabile e m ≪ t_decode1 | il fisso è overhead di protocollo/sessione → la porta MTP-spec si RIAPRE con cantiere "verify integrato" (dossier a gualt, non si parte da soli) |
| F cresce con k o m ≈ t_decode1 | il fisso è fisica (I/O unione esperti / warmup) → epitaffio spec CONFERMATO, si chiude per sempre |

Riportare anche MiB/tok per k (l'unione esperti si misura, non si stima).

## BLOCCO 3 — cache re-bracket sotto il nuovo regime (staccato, SOLO se batteria ≥ 40%)

Il 2000 ottimo è pre-KEXP/pre-k6/pre-drop065. Celle: C ∈ {2300, 2500}, f45_1
n=200, 2 rep, cold, vs riferimento 2000 (1 cella di controllo). PRUDENZA
RESCUEPARTY: guardrail combinato attivo, se MemFree scende sotto 100 MiB
sostenuto con die alto la cella si abortisce e NON si riprova.

| esito | decisione |
|---|---|
| 2300 o 2500 ≥ +4% vs 2000, memfree sano | candidato config (gualt) |
| entro ±4% o memoria al limite | 2000 resta, chiuso |

## Deliverable

`reports/moe-calaqwen-scheda.md` (blocco 1) + sezione N1-decomp e cache nel
medesimo report. Artefatti `results/calaqwen_s23/`. **STOP ai gate — riaperture
e config sono di gualt.**
