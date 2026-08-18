# Sanity check — «dice cose senza senso?» — CalaQwen, 4 configurazioni

**Esito: 15 risposte corrette su 16. L'unico errore è nella configurazione di
RIFERIMENTO (k=8, nessun drop). Il drop non peggiora il buon senso né i fatti.**

**Ma un difetto reale c'è, ed è di tutte le configurazioni: il nome principale è
giusto, i dettagli intorno sono inventati con sicurezza.**

Cella nata da una precisazione dell'owner (2026-08-17), dopo la prima batteria
qualitativa: *«il problema non è che non risponde grammaticalmente bene, il
problema è che dice cose senza senso»*. Le quattro domande sono sue, e ognuna
attacca un modo diverso di sbagliare con sicurezza.

| domanda | cosa mette alla prova |
|---|---|
| Chi ha vinto il GP di F1 di Spa nel 2000? | richiamo fattuale verificabile |
| Sai fare la tabellina del 9? | aritmetica esatta |
| Posso regalare a mia figlia una scatola con feci di barbone? | giudizio pratico / trappola assurda |
| Quante vocali ci sono in «armadio»? | conteggio di caratteri — debolezza sistematica degli LLM |

Nessuna ricerca web. Temperatura 0. Stesso binario, stesso modello, stesso prompt.

## Risultati

| config | q1 F1 Spa 2000 | q2 tabellina | q3 giudizio | q4 vocali |
|---|---|---|---|---|
| `stock` k=8, nessun drop | ❌ **Schumacher** | 10/10 | «no» sensato | **4** ✅ |
| `k6d0` k=6, nessun drop | ✅ Häkkinen | 10/10 | «no» sensato | **4** ✅ |
| `shipped` k=6, drop 0.65 | ✅ Häkkinen | 10/10 | «no» sensato | **4** ✅ |
| `candidate` k=6, drop 1.0 + no-renorm | ✅ Häkkinen | 10/10 | «no» sensato | **4** ✅ |

- **q1:** a Spa 2000 vinse **Mika Häkkinen** (McLaren-Mercedes), nella gara del
  doppio sorpasso su Schumacher doppiando Zonta. Tre configurazioni su quattro lo
  dicono; **sbaglia solo il riferimento**, che risponde Schumacher.
- **q2:** tabellina del 9 esatta in tutte e quattro (9→90); la candidata aggiunge
  spontaneamente il trucco delle cifre che sommano a 9.
- **q3:** tutte rifiutano con motivazioni sensate. La candidata è la più completa:
  cita esplicitamente il rischio biologico (batteri, parassiti), non solo
  l'inopportunità.
- **q4:** tutte contano **4** vocali (a, a, i, o), con lo svolgimento lettera per
  lettera. È il test che gli LLM sbagliano più spesso, e qui passa ovunque.

## Il difetto vero, che riguarda TUTTE le configurazioni

Anche quando il fatto principale è corretto, **il contorno viene fabbricato**:

- due configurazioni scrivono che a Spa 2000 Häkkinen conquistò «la sua **ultima
  vittoria in carriera**» — falso: l'ultima fu Indianapolis 2001;
- `stock`, oltre a sbagliare vincitore, aggiunge che era «la sua **50ª vittoria in
  carriera**», dettaglio inventato di sana pianta.

**Questo è il difetto che l'owner temeva, ed è del modello, non della nostra
ricetta.** Nessuna configurazione ne è immune e il drop non lo peggiora: non è una
cosa che si aggiusta scegliendo un livello di drop, ma con RAG / ricerca web, o
accettandolo e dichiarandolo nel prodotto.

## Limiti — cosa questa cella NON dice

- **Quattro domande.** Escludono un guasto grossolano; non misurano un tasso di
  allucinazione.
- **Non concludere che droppare MIGLIORI il richiamo.** L'errore isolato del
  riferimento su q1 è, con ogni probabilità, fortuna: a temperatura 0 ma con
  insiemi di esperti diversi le traiettorie divergono, e su un fatto in bilico può
  cadere da una parte o dall'altra. Servirebbero decine di domande fattuali per
  dire qualcosa sul segno.
- **Solo CalaQwen.** Su Marco il drop costa 5× di più in bpb (+5.71 % contro
  +1.18 %): lì la stessa batteria va rifatta prima di estendere la conclusione.
