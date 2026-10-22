# Piano: digest BM25 additivo del contesto (desktop)

Data: 2026-10-22. Proprietario: convinto («usavo pi dev con compattazione BM25,
era una bomba, fatta in ms»). Questo piano fissa la forma prima di scriverne
codice.

## Il problema, misurato in diretta il 22-10

La chat desktop poda turni interi quando il filo non sta in `nctx`
(`chat/src/lib/attachments.ts` `buildPinnedContext`, shed di turni dal più
vecchio). Il podio è **silenzioso** (P2 aperto in `docs/BACKLOG.md`:103:
*«a successful prune is silent while the full thread stays visible»*). Caso
vivo: conversazione Amazon passata da 44 569 a 22 380 token al turno
successivo, senza che nessuno dicesse niente — i fatti grezzi delle pagine
lette sono spariti; sono sopravvissute solo le conclusioni dell'ultimo turno.

## Cosa NON fare (già misurato, ha perso)

Il telefono ha già benchmarcato la forma «digest BM25 al POSTO del contesto +
finestra di 2-3 turni» (braccio v42, `archived/docs/RESEARCH_CONTEXT_LOSS.md`
nel repo kalsa): recall **0,562 vs 0,772** baseline su Qwen 2B (p=0,009),
prefill **+72%** (il boundary che avanza invalida il prefisso). Gate fallito,
spento. Lezione registrata: *«BM25 retrieval works; it is the FREEZE that
costs recall»* e il confronto mai fatto è il **digest additivo a finestra
invariata**.

## Il design (additivo, coda, verbatim, timbrato)

1. **Finestra recente in token, non in turni** (un turno browser vale 30-40k
   token: «2-3 turni» riempirebbe tutto). Partenza: ~75% di `nctx` per la
   storia, il resto per strumenti, risposta e digest. Verbatim, **append-only**
   tra un rebuild e l'altro: il prefisso non cambia mai a fine digest.
2. **Blocco digest in CODA al wire** (dentro il prefisso dell'ultimo user,
   dopo la storia, prima del messaggio corrente): «fatti usciti dalla
   finestra che matchano questo turno». **Mai in testa**: un blocco che cambia
   prima della storia invaliderebbe tutta la KV.
3. **BM25+ query-time, ogni turno** (no freeze — costa recall): char 3-4
   grams + lowercase + fold accenti (italiano), RRF con salience query-agnostic
   (numeri, entità, verbi dichiarativi); unità = frase ±1 vicina col ruolo;
   dedup. Zero dipendenze, millisecondi (verificato su pi dev dal proprietario
   e sui numeri CisWire).
4. **Frammenti verbatim e timbrati**: ogni pezzo porta turno d'origine, ruolo,
   e host se arriva da un run browser. Niente generazione, niente merge — un
   prezzo ripescato senza la sua frase di provenienza sembrerebbe verificato.
5. **Budget del digest**: cap in token (~300-800; il telefono misurava
   ~800 caratteri). Sforamenti → si tagliano i frammenti a score più basso.
6. **La riga BUG-5, comunque e subito**: il contatore `dropped` già calcolato
   viene detto in chat («per far spazio ho lasciato indietro i primi N
   scambi»), in 5 lingue. Costa una riga ed è onestà indipendente dal digest.
7. **Flag spento di default** (nascosto, come `browserVision`). Default ON
   solo se il benchmark vince — stesso gate del telefono.
8. **Gate di misura, prima del default**: celle A/B su conversazione lunga
   (stessa richiesta, braccio prune-only vs prune+digest): recall dei fatti
   sfrattati E tempo al primo token (il +72% di prefill è il modo in cui il
   v42 ha perso la seconda volta). **Il prefill si misura con il blocco
   dentro**, non con la storia da sola: il blocco entra nel prefill di ogni
   turno (vedi sotto).

## Effetto sulla KV cache (la domanda del proprietario)

- **Stato regolare: la storia resta byte-identica, la KV no.** Il blocco non
  viene mai persistito: al turno N+1 il messaggio utente precedente viene
  ricostruito **senza** il blocco, quindi il prefisso condiviso finisce prima
  di quel messaggio. Il costo extra di un turno è dunque il messaggio utente
  precedente più il blocco, non zero. Resta vero che la storia memorizzata è
  byte-identica (append-only) e che il blocco viaggia in coda: i suoi token si
  prefillano una volta per turno. Con i numeri di oggi (~170-185 tok/s di
  prefill su Qwen 3.6 Metal), un digest da 300 token ≈ **1,6-1,8 s** a turno.
- **Quando la finestra avanza** (come già oggi col prune): un re-prefill della
  storia che segue il boundary — lo stesso costo che il prune di oggi paga
  già, non uno in più. Mitigato da `--ctx-checkpoints` (v1.1.6): il prefisso
  fino al boundary viene ripristinato dal checkpoint invece che riletto.

## Un limite noto: le pagine muoiono al reload

`forDisk` svuota il `result` di ogni run del browser
(`chat/src/lib/store.ts:414-425`) e il digest legge proprio `run.result`: dopo
un riavvio dell'app una conversazione non porta più fatti di pagina nel
digest. È coerente con il wire — che è vuoto per lo stesso motivo — ma il
piano non deve venderlo come se non valesse: il digest porta i fatti delle
pagine **fino alla fine della sessione**, non oltre.

## Fette

1. **BUG-5**: la riga del `dropped` (avviso in chat, i18n) — spedisce da sola.
2. **Digest MVP dietro flag**: retriever + blocco di coda + timbri; finestra a
   budget in token.
3. **Celle A/B** (protocollo celle, conversazione lunga costruita apposta) +
   una review n2.
4. Default: decisione del proprietario coi numeri in mano.

## Ancoraggi nel codice

- `chat/src/lib/attachments.ts` — `buildPinnedContext`: la finestra resta;
   il digest si compone in coda; il `dropped` si ritorna già (`:842`).
- `chat/src/lib/toolLoop.ts` — composizione del wire di round0; non toccare i
   tetti di round/chiamate.
- Nuovo modulo retriever (TypeScript, zero dipendenze) + test unit con
   conversazioni italiane miste (nomi, prezzi, accenti).
- i18n: 5 lingue per l'avviso BUG-5.
- Motore: **nulla** — il digest sono token normali.
