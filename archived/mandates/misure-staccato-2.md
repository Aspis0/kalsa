# MANDATO — misure-staccato parte 2: SOLO celle 2-3-4, con lo schermo sotto controllo

La Cella 1 è completa e a verbale (turno 5: 165→~9 s, −94%). Le celle 2-3-4 sono saltate
perché il **timeout schermo (30 min) è scaduto alle 19:33** → Termux declassato dal
cpuset top-app → `nproc=3` → FATAL. Questa parte 2 rifà solo quelle, con tre correzioni.

**Regole identiche a `misure-staccato.md`** (cavo staccato, pin CAMPAIGN `cab20432…`
senza override, `bin_sha256` per riga, flight recorder, prompt sha verificati, batteria
≥30%, preflight die/nproc). Non toccare `../ai-chat`; STOP al report; mai `complete_goal`.

## Le tre correzioni (prima di lanciare)

1. **Schermo**: la sessione dura più di 30 min. Prima del lancio, via adb (wireless):
   `settings put system screen_off_timeout 7200000` (2 h) — e **ripristinare il valore
   originale a fine sessione** (leggerlo e salvarlo PRIMA di cambiarlo). In alternativa
   documentata: tap periodico via `input keyevent` da adb. Verificare l'effetto: `nproc`
   nella shell dei run deve restare ≥6 a schermo... acceso da >30 min.
2. **Preflight che aspetta, non salta**: se `nproc<6`, il preflight ri-promuove Termux
   (wake-lock + `am start` activity via adb) e riprova ogni 30 s per max 10 min; FATAL
   solo dopo. Una cella persa per un transitorio è uno spreco di batteria già spesa.
3. **STATUS onesto**: una cella saltata produce `SKIPPED <cella> <motivo>` e `final_rc≠0`.
   MAI un "winner" di default per una cella senza dati — lo STATUS della parte 1
   (`winner_cache=2000 rc=0` senza aver misurato) è esattamente il bug da non ripetere.

## Le celle (identiche al mandato originale)

- **CELLA 2** — cache 2000/3000/3500: 2 prompt fissi × 2 rep, decode tok/s,
  `expert_hit_rate`, `memfree_min`, VmHWM, lmkd. Adozione C>2000 solo con tok/s ≥+5% e
  zero lmkd e `memfree_min`>300 MiB.
- **CELLA 3** — ubatch 512 vs 2048 con la cache vincitrice, prompt d1_long × 2 rep.
  2048 solo con prefill ≥+10% e zero pressione.
- **CELLA 4** — plateau sostenuto: n=512, curva tok/s per blocchi di 64 + die °C.

## Deliverable

`reports/moe-misure-staccato-2.md`: tabelle e verdetti come da mandato originale +
conferma del ripristino di `screen_off_timeout` + righe `runs.csv`. Artefatti in
`results/staccato2/`. **STOP al report** — adozioni decise da gualt.
