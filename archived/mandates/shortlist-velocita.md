# MANDATO — shortlist velocità v2 POST-AUDIT: solo k=5 (A e B archiviate per meccanismo)

> v2 dopo audit DeepSeek (2 BLOCKER). **Scoperta di meccanismo, verificata al
> sorgente dal coordinatore** (`router_hook.cpp:206-216`): il drop NON salta mai
> il matmul — lo slot droppato viene ripuntato sul top expert e `mul_mat_id` lo
> ricalcola comunque (dot duplicato, by design). Il drop è una leva **SOLO
> I/O**, e quel lato è SATURO (prova empirica già in casa: d065→d080 = drop%
> raddoppiato, +0.15% velocità). Quindi:
> - **A (drop-by-weight): ARCHIVIATA senza costruirla** — droppare i residenti
>   risparmia zero I/O e zero compute, paga solo PPL. La patch era corretta e
>   inutile. Risparmiati: patch+G1+re-pin+~3h device.
> - **B (top-p): CHIUSA per saturazione attesa** (+0-1%); riapribile SOLO con
>   una trace KEXP vera (le uniche trace in repo sono IQ2_M k=8 — modello
>   sbagliato) e aspettative riallineate.
> - **C (k=5) è l'unica leva con meccanismo**: k cambia `nu` = il numero di
>   slot davvero calcolati. k8→k6 misurato +13.6% ne è la prova.

**Regola qualità (chiarita, MAJOR-4):** vige il **floor prodotto ≤ 2.0955**
(regola gualt). La vecchia regola "Δ≤0.15 cumulativo" è OBSOLETA (già superata
dall'adozione di k6d065) — marcata tale in PLAN.

## C — k=5 (binario attuale, zero patch)

**Pin completi:** modello KEXP `ac44e20c…`, bin CAMPAIGN `1ca51420…`
(`assert_campaign_pin`), corpus `corpus_subset_10k.txt` sha `46efe834…`,
prompt short/f45_1 sha noti. Config campagna con `--n-expert-used 5`;
**dichiarare il thr effettivo per cella** (0.65/5 = 0.13 ≠ 0.108 di k6: la
cella droppa più miss — va a verbale, non è "stesso drop").

1. **PPL (in carica):** k5d065 e k5d000 sul subset 10k. Vive se ≤ 2.0955.
   **Durante la run k5d065 catturare `--route-trace`** (costo ~0): è la trace
   KEXP che oggi non esiste — servirà a decidere se B merita mai riapertura.
2. **Speed (staccato, batteria ≥ 45%):** solo le vive. **3 rep** per cella
   (regola PLAN §2.2.4), control k6d065 interleaved (C2000-style:
   ctrl→k5→ctrl→k5→ctrl→k5). **Gate sul RATIO paired mediano vs control della
   STESSA sessione: ≥ 1.05** — niente soglie assolute (il control galleggia
   ±5-8% tra sessioni). Se sem dei ratio > 2% → ripetere il blocco.
3. **Pareto operativizzata:** "domina" = ratio ≥1.02 E PPL ≤ control−0.01;
   "entro 2% → vince PPL migliore"; banda 1.02-1.05 = dossier a gualt con
   entrambe le viste, non auto-adozione.

**Aspettativa onesta a verbale:** k=5 ≈ **+7%** (Amdahl f=0.4, coerente col
+13.6% di k8→k6). Rischio: PPL — su IQ2_M k=5 era morto (+2.56); sul KEXP col
tesoretto è la scommessa. Se PPL muore, la shortlist si chiude e il default
resta k6d065: **il decode CPU ha dato tutto quello che aveva**.

## Deliverable

`reports/moe-shortlist-velocita.md`: PPL k5 (con ΔPPL vs F=0 1.5249 E vs
k6d065 1.852), tabella speed run-per-run con ratio paired, trace KEXP
archiviata (path+sha), verdetto pareto. Il costo-PPL puro del resident-drop
(ex-A) NON si misura: il meccanismo basta. **STOP — default a gualt.**
