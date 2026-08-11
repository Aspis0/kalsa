# MANDATO — sessione S23: scheda CalaQwen + decomposizione N1 + cache bracket (v2 POST-AUDIT)

> v2 dopo audit ostile DeepSeek (2 BLOCKER + 10 MAJOR, tutti recepiti): il
> sostenuto è "fino a EOS" (il flag --ignore-eos NON esiste nel binario pinnato),
> il protocollo N1 è riscritto senza il bug di calibrazione (n_prompt verificato
> per cella), l'energia ha una metodologia difendibile, la cache si testa in
> ENTRAMBE le direzioni con attese dichiarate.

**Config pinnata per TUTTA la sessione** (default A): modello KEXP sha `ac44e20c…`
(verificare vs `results/requant1c/kexp.sha256`), binario CAMPAIGN `1ca51420…`,
`-t 4 -c 4096 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000
--dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6
--drop-cold-experts 0.65`. Prompt sha: f45_1 `bc5c1e58…`, short `a8471e81…`.
**Verificare sul TELEFONO che `lib_guardrails.sh` == versione `74bbb4d`**
(sha della copia device, non fidarsi del repo PC). Floor 30%; timing staccato;
screen ripristinato; STOP ai gate.

## HARNESS (nuovo driver, vincoli minimi dall'audit E1)

Driver nuovo in `~/experiments/scripts/` (l'N1 driver è VIETATO: bug calibrate).
Requisiti: source lib_guardrails + `guardrail_tick` a 0.5 s nel sampler; rc
96/97/99 gestiti; preflight per cella (UNPLUGGED, nproc≥6, die≤80, batt≥floor);
**flight ESTESO**: colonne `current_uA,voltage_mV` da `termux-battery-status`
(provato funzionante su questo device), periodo **1 s**, probe di leggibilità in
preflight; righe con batt_pct=-1 (stallo sotto thrash) scartate e contate.
**Checkpoint batteria**: se < 45% dopo il BLOCCO 1 → BLOCCO 2 a 1 rep.

## BLOCCO 1 — scheda prodotto (staccato, batteria ≥ 50%)

1. **Decode sostenuto FINO A EOS** (B1: n=512 non è raggiungibile — la EOS greedy
   arriva ~200-280 e non c'è knob): `n_predict 512`, riportare **n_gen reale**,
   curva die (mediana/p90/max) sulla finestra realizzata (l'equilibrio termico
   arriva in ~20-30 s: basta). 2 rep, cold. In più **1 cella dedicata di decode
   lungo** con prompt di continuazione degenerato (dichiarato come tale, es.
   elenco infinito) per una finestra ≥400 token — solo per la curva termica.
2. **Conversazione 5 turni KV** (pin: 5 turni = protocollo del giro adozione
   dropcold, prompt per turno con sha, `clear_kv` solo al T1, n=256/turno):
   prefill/turno + n_past — la riga TTFT della scheda.
3. **Load cold** 2 rep.
4. **Energia (metodologia D dell'audit)**: accoppiata alle 2 rep del punto 1 +
   la cella lunga (≥3 finestre): baseline idle 30 s prima/dopo (schermo ON,
   niente bmoe), E = Σ(I−I_idle)·V·Δt dal flight a 1 s, **J/token =
   mediana+range, denominatore n_gen dal BMOE_DONE**. Se current non leggibile
   da nessuna fonte → riga "NON MISURABILE (motivo)", MAI stima da Δbatt% di
   una run corta (rumore: risoluzione 1% ≈ la run intera). Sanity atteso
   dichiarato: ~0.75-0.95 J/token (F4.7 dava 1.0-1.4 a 4.4 tok/s).

## BLOCCO 2 — decomposizione N1 v2 (staccato, ~45 min)

**Deviazione dichiarata dall'N1 storico**: config = default A (k=6, drop 0.65 —
l'N1 corse a k=8), quindi t_decode1 di controllo va RIMISURATO qui (1 cella).

Protocollo (A1 fix — niente calibrate):
- via `--session` due turni; **t2 = `'x '*k` LETTERALE**, k ∈ **{0, 8, 32, 64,
  128, 256}** (k=0 = solo template: la baseline del costo fisso);
- **verifica per-cella: n_prompt misurato atteso = 14+k (±1)** — cella fuori
  specifica = SCARTATA e marcata, mai fittata;
- 2 rep per k, cold a inizio serie, die≤80 al preflight di ogni cella;
- **controllo one-shot**: 1 cella `-p` con ~128 token di prompt (stesso
  contenuto) — separa il costo sessione dal costo engine;
- fit `t_prefill = F + m·n_prompt` su **n_prompt MISURATO**, riportare R² e IC
  di F e m; soglia numerica: "ammortizza" ⇔ **m ≤ 0.3·t_decode1**;
- deliverable: tabella k / n_prompt / prefill_s / MiB_tok per cella.

| esito | lettura |
|---|---|
| F(k=0) grande e stabile, m ≤ 0.3·t1, one-shot ≪ session | fisso = protocollo sessione → porta MTP-spec RIAPRIBILE (dossier a gualt) |
| F cresce con k o m ≈ t1 | fisica (grafo/unione esperti — CONFOUND dichiarato: il build del grafo scala con n_prompt) → epitaffio spec confermato |

## BLOCCO 3 — cache bracket BIDIREZIONALE (staccato, batteria ≥ 40%)

**Attese dichiarate PRIMA (C1)**: 2300 = abort probabile (a 2000 la resident è
budget-bound a 1999.2 MiB con memfree 13-64; +300 → MemFree≈0 in decode →
ABORT_MEM_COMBINED o lmkd). La direzione fisicamente interessante è GIÙ
(k=6 usa il 25% di slot in meno): **celle C1500, C1750, C2300** (niente 2500),
control C2000, **disegno interleaved**: 2000→1500→2000→1750→2000→2300.
f45_1 n=200, 2 rep dove possibile.

Regole (C3-C6):
- citabilità: **n_gen ≥ 100**, altrimenti cella = NO_DATA;
- control C2000 abortito → 1 retry dopo cooldown die≤70; se riabortisce →
  blocco chiuso "memoria al limite, 2000 resta";
- celle ≥2300: NO retry; rc≠0 senza azione guardrail = `OOM_LOAD`, no retry;
- "memfree sano" = mediana decode >150 MiB ∧ min >50 ∧ lmkd 0 ∧ nessuno streak
  MEM_LOW >10 s;
- soglia: candidato solo se **≥6%** (il ±3.4% è rumore misurato tra rep);
  esito atteso a verbale: "tutto entro ±6% → 2000 resta; 1500/1750 interessanti
  anche a −5% se liberano 250-500 MiB per l'app (valore di prodotto: dossier)".

## Deliverable

`reports/moe-calaqwen-scheda.md`: scheda (con n_gen reali e J/token
mediana+range o NON MISURABILE), tabella N1 v2 con fit e verdetto, tabella cache
con MemFree/esiti per cella. Artefatti `results/calaqwen_s23/`. **STOP ai gate.**
