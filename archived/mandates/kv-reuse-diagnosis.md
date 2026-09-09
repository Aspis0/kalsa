# DIAGNOSI — perché `n_common = 0` quando le due sequenze dovrebbero condividere 71 token?

Build **diagnostica usa-e-getta**: non sostituisce il binario di campagna, non si adotta, si
butta dopo aver letto l'output. Un run da cinque minuti.

Repo: `BigMoeOnEdge` (branch `main`, sopra `b0c4e5b`). Non toccare `../ai-chat`.
STOP al gate, mai `complete_goal`.

## Cosa sappiamo già (verificato, non da rifare)

- La macchina del riuso del prefisso **esiste ed è completa**: `session.cpp:963-980` confronta
  `im.kv_tokens` col prompt tokenizzato, calcola `n_common`, taglia la coda divergente e
  prefilla solo il suffisso.
- `im.kv_tokens` **è mantenuto**: i token del prompt alla riga 1100, ogni token generato alla 1355.
- `clear_kv=false` **arriva davvero** al motore (verificato nel JSON dell'harness).
- **Misurato** (mandato lampo): turno 1 `n_prompt=39 n_past=71`; turno 2 `n_prompt=108
  n_past=140`. Siccome `s.n_prompt = n_prompt_render − n_common` (riga 1425), e il render del
  turno 2 è ~108, ne segue **`n_common = 0`**.
- **Eppure dovrebbero condividere 71 token**: dopo il turno 1 la KV contiene i 39 del render più
  i 32 generati, e il render del turno 2 comincia con la stessa conversazione.

**La domanda è una sola: cosa c'è all'inizio delle due sequenze che le fa divergere a
posizione 0?**

## La modifica (temporanea, ~15 righe)

In `session.cpp`, subito **prima** del ciclo di confronto alla riga 969, stampare su `stderr`:

```
KVDIAG n_common_atteso=? kv_tokens=<size> tokens=<size>
KVDIAG kv[0..15]  = id:testo  id:testo  ...
KVDIAG tok[0..15] = id:testo  id:testo  ...
KVDIAG prima divergenza a posizione N: kv=<id:testo> tok=<id:testo>
```

Usare il detokenizer per mostrare **il testo** accanto all'id: senza quello si vedono numeri e
non si capisce cosa il template ha messo davanti. Marcatori speciali inclusi (`<|im_start|>`,
BOS, ecc.) — sono i sospetti principali.

Stampare **a ogni turno**, così si vede anche il turno 1 (dove `kv_tokens` è vuoto e il
confronto è saltato) come riferimento.

**Vincoli:**
- build in un binario **separato**: `bmoe-cli.DIAG`. **Non** sovrascrivere `bmoe-cli.NEW`
  (campagna) né `bmoe-cli.PREFAULT` (via di ritorno).
- solo `fprintf(stderr, …)`: nessun cambiamento al calcolo, nessuna riga rimossa.
- **non committare** questa modifica come feature: è diagnostica. Se poi vorremo un log
  permanente sarà un mandato a parte, con il suo gate.

## Il run

Una sessione, due turni, **stesso prompt** in entrambi, `temp 0`, `clear_kv=false`, config del
gate. È esattamente il setup del mandato lampo, con in più l'output diagnostico.

## Cosa riportare

1. Le due sequenze affiancate, **id e testo**, primi 16 token di ciascuna, per il turno 2.
2. La posizione della prima divergenza e cosa c'è dalle due parti.
3. `n_common` effettivo.

## Regole di decisione (dichiarate ora)

| cosa si vede | conclusione |
|---|---|
| divergenza a **posizione 0** con token diversi in testa | il **template** rende un'intestazione che al turno 1 non c'era (blocco di sistema? BOS?). Fix nel **rendering**: la conversazione va renderizzata in modo che il turno N+1 estenda il turno N invece di riscriverlo |
| le sequenze **combaciano** per un tratto e poi divergono presto | il prefisso comune c'è ma qualcosa lo interrompe: riportare **dove** e **cosa** |
| `kv_tokens` è **vuoto** al turno 2 | non è un problema di rendering: lo stato non sopravvive fra le richieste, ed è un altro bug |
| le sequenze sono **identiche** per 71 token ma `n_common` esce 0 | il difetto è nel **confronto**, non nei dati: guardare `max_common` e le condizioni della riga 970-971 |

Ognuno di questi quattro casi porta a un fix diverso. **Serve sapere quale**, prima di scrivere
una riga di correzione — che è la ragione per cui questo mandato è diagnostico e non risolutivo.

## Valore in gioco

Turno 5 da **165 s a ~10 s** di attesa: −65% di latenza percepita, senza toccare decode,
qualità o modello. È la voce più preziosa rimasta nel piano.
