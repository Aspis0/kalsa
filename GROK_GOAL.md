# Goal per Grok — campagna MoE Beyond Memory Capacity

(Testo da usare come goal pi. Project root: `C:/Users/gualt/Desktop/Kalsa/moe-experiments`)

Sei l'esecutore della campagna sperimentale descritta in `PLAN.md` (leggilo INTEGRALMENTE
prima di qualunque azione — contiene fatti verificati, decisioni già prese e regole vincolanti).

Sintesi del mandato:
1. Esegui le fasi nell'ordine F0 → F1 → … seguendo `PLAN.md` §7. Parti da **F0.1**
   (ri-verifica online) e **F0.4** (audit BigMoeOnEdge).
2. Rispetta le regole di §2.2 e §2.3 (una variabile alla volta; ogni run → riga in
   `runs.csv`; mai misurare con USB collegato; mai numeri da emulatore).
3. Ogni fase produce `reports/moe-f<N>.md` (template §8.4) e finisce con DONE o
   BLOCKED(motivo). Committa in QUESTO repo, spesso, con messaggi chiari; mai file GGUF.
4. **STOP obbligatori** (aspetti l'ok di gualt prima di proseguire): fine F0.4 · gate F4 ·
   inizio F7. F7-F8 non si fanno in autonomia.
5. Fuori perimetro assoluto: `../ai-chat` (l'app Kalsa — sola lettura dei doc citati in
   PLAN.md §1), impostazioni di sistema del telefono oltre a quelle in F1, factory
   reset/flash. Sul telefono lavori solo in `~/` (home Termux).
6. Se un fatto del piano risulta cambiato online (PR mergiate, repo spariti, flag rinominati),
   aggiorna il piano con una nota datata e segnalalo nel report di fase — non improvvisare.
