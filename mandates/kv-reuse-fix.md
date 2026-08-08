# MANDATO — fix del riuso KV: il re-render deve riprodurre byte-per-byte lo stream che la KV ha visto

Segue la diagnosi `reports/moe-kv-reuse-diagnosis.md` (caso 2 confermato). Questo è il
mandato **risolutivo**: un fix piccolo e mirato nel punto giusto, non un refactor.

**Contesto fisso:**
- Repo `BigMoeOnEdge`, branch `main`. **Sequenza obbligata** con
  `mandates/fix-bloccanti-audit.md`: entrambi toccano `session.cpp`, mai in parallelo —
  questo mandato si applica sull'albero risultante dall'altro (o viceversa, ma in serie).
- **Non toccare `../ai-chat`.** STOP ai gate, **mai `complete_goal`**.
- Binario risultante → `bmoe-cli.KVFIX`. **Mai** sovrascrivere `bmoe-cli.PREFAULT`
  (`5c95cb5f…`) né il binario di campagna. L'adozione la decide gualt dopo i gate.

---

## La diagnosi in due righe (verificata, non da rifare)

1. Con `--no-think` il modello emette comunque ` <think>\n\n</think>\n\n ` (4 token); quei
   token entrano in `kv_tokens`, ma la history committa il **content parsato** senza i marker
   (`session.cpp:1533-1539`) → il re-render del turno dopo diverge a posizione 35.
2. Col match parziale (35/71), `llama_memory_seq_rm(0, 35, -1)` **fallisce** su questo
   modello e il fallback (`session.cpp:985-988`) azzera tutto → `n_common = 0` → ri-prefill
   completo (165 s al turno 5 in F5.1).

**Conseguenza**: risolto il punto 1, nel caso append-only della chat il `seq_rm` parziale non
serve più (n_common = tutta la KV, coda vuota). Il fix è **uno solo, nel commit della
history**. Il punto 2 non si fixa qui (solo diagnosi bonus, sotto).

## Il fix (via 1 del report — forma grezza in history)

Requisito, che vale più dell'implementazione:

> `common_chat_templates_apply(chat_history)` del turno N+1 deve produrre un prefisso
> **byte-per-byte identico** alla sequenza che `kv_tokens` ha accumulato al turno N.

Implementazione richiesta, al punto di commit dell'assistant (`session.cpp:1533-1539`):

- **Condizione**: `chat_on && final_parsed && final_msg.reasoning_content` **vuoto** e il
  parse ha comunque alterato i byte (`final_msg.content != gen`) — cioè il parse ha spogliato
  uno span think **vuoto** (o altro markup che il template non re-emetterà).
- **Azione**: committare `assistant.content = gen` (lo stream grezzo, marker inclusi) invece
  del content parsato. Il template chatml inserisce il content verbatim e la tokenizzazione
  del render ha il parsing degli special attivo (i marker ri-tokenizzano come 248068/248069),
  quindi il re-render riproduce lo stream. La UI non cambia: quel che si mostra passa da
  `shown_view`, non dalla history.
- **Fuori scope dichiarato**: `reasoning_content` **non vuoto** (thinking reale) → si
  committa parsato come oggi. Lì lo strip della history è il comportamento raccomandato e il
  riuso non può funzionare senza chirurgia mid-KV (unsound). Kalsa spedisce no-think.
- Il ramo `prefilled_answer` e il ramo non-chat **non si toccano**.
- Nessun cambiamento al calcolo di `n_common` né al fallback di `seq_rm`.

**Commit**: uno solo, sul fork (convenzioni del repo: Conventional Commits, inglese). Il
messaggio deve dichiarare l'invariante (re-render byte-identico alla KV) e lo scope
(empty-reasoning only).

## Diagnosi bonus (2 righe di report, nessun fix)

Nel run di gate, annotare **perché** `seq_rm` parziale fallisce su questo modello: dal log di
load, che tipo di memoria costruisce llama.cpp per Qwen3.6-35B-A3B (unified? ibrida/ricorrente?
SWA?). Una riga di verdetto nel report. Non cambiare codice per questo.

## I gate (dichiarati ora, prima dei numeri)

Setup identico alla diagnosi: stesso prompt (sha256 `a8471e81…5cc9`, verificarlo prima di
lanciare), `temp 0`, config del lampo, t1 `clear_kv=true`, t2 `clear_kv=false`. Telefono in
carica ammesso: i **conteggi** sono citabili, i **secondi** solo indicativi.

**G-K1 — il numero che decide.** Al turno 2:

| esito | conclusione |
|---|---|
| `n_common = 71` (o 70 per la regola "tieni 1 token"), `n_prompt ≈ 37-41` | **PASS** — il riuso funziona |
| `0 < n_common < 70` | PARZIALE — riportare la nuova posizione di divergenza e i token dalle due parti (stderr diagnostico stile KVDIAG ammesso in una build usa-e-getta, non nel commit) |
| `n_common = 0` | **FAIL** — STOP e riportare, non iterare alla cieca |

Prefill t2 atteso nell'ordine del turno 1 (~5 s), non ~12 s — indicativo se in carica.

**G-K2 — il riuso non cambia il testo.** Build di controllo usa-e-getta `bmoe-cli.KVCTRL`:
stesso albero del fix + **una riga** che forza `n_common = 0` dopo il calcolo (ri-prefill
completo con la stessa history fixata). Stesso scenario due-turni su KVFIX e KVCTRL:
l'output del turno 2 deve essere **byte-identico** tra i due (bit-identità a `temp 0` provata
in F5.4-D1: una differenza = difetto). KVCTRL si butta dopo, sha256 nel report.

**G-K3 — non-regressione single-turn.** 8/8 byte-identici contro
`results/f5.5/b/*-k8.gen.txt` (stessi prompt di `prompts/`, `temp 0`, config del gate). Il
single-turn non ha history → attesa dichiarata: identici. Una differenza = STOP.

**Se G-K1 passa ma G-K2 fallisce**: il riuso corrompe il contesto — STOP, riportare i due
output affiancati, non adottare.

## Deliverable

`reports/moe-kv-reuse-fix.md` con:
1. hash del commit e diff (poche righe);
2. G-K1: `n_common`, `n_prompt`, `n_past`, prefill_s dei due turni (tabella come nella
   diagnosi);
3. G-K2: sha256 dei due output t2 (KVFIX vs KVCTRL) + sha256 dei due binari;
4. G-K3: tabella 8/8;
5. verdetto bonus sul tipo di memoria (perché `seq_rm` parziale fallisce);
6. artefatti grezzi in `results/kv_reuse_fix/` (telefono e PC, come per la diagnosi).

**STOP al report.** Niente adozione, niente pin, nessun altro file toccato, mai
`complete_goal`.
