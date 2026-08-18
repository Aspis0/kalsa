# Qualità delle risposte — CalaQwen, 4 configurazioni, 6 domande

**Esito: nessuna configurazione è degradata in modo visibile. La candidata
aggressiva (`k=6, drop 1.0, --drop-no-renorm`) segue le istruzioni alla lettera,
scrive codice che passa 8 test su 8, e produce italiano fluente senza ripetizioni.**

Questa cella nasce da una domanda dell'owner (2026-08-17): *«dovremo fare dei test
veri da chatbot, non voglio finire come Emma che non sapeva rispondere a niente
perché nessuno l'aveva testata»*. Fino a quel momento la campagna aveva misurato
solo velocità (tok/s, byte) e **bpb** — quanto bene il modello predice testo — mai
se il modello **risponde** ancora bene. Sono domande diverse: droppare esperti
toglie capacità in modo disuguale, e una media di perplexity su cinque lingue è
esattamente il tipo di metrica che nasconde una capacità persa.

## Configurazioni

| id | configurazione |
|---|---|
| `stock` | k=8, nessun drop — riferimento |
| `k6d0` | k=6, nessun drop — isola "meno esperti" da "droppare" |
| `shipped` | k=6, drop 0.65 — quella spedita oggi |
| `candidate` | k=6, drop 1.0 + `--drop-no-renorm` — la proposta |

Temperatura 0 (deterministico: ogni differenza è causata dalla configurazione, non
dal campionamento), 420 token, stesso prompt, stesso binario, stesso modello.

## Risultati

### Istruzioni con vincoli verificabili (`f45_3_istruzioni`)
Il prompt chiede **esattamente tre frasi**, poi **esattamente due domande**, niente
titoli né elenchi, in italiano. **Tutte e quattro le configurazioni rispettano ogni
vincolo.** Nessuna aggiunge preamboli, nessuna sfora, nessuna scivola in inglese.

### Codice (`f45_4_codice`) — la prova oggettiva
Il prompt chiede una funzione `median_eval_tok_s(rows)` con semantica precisa
(filtra `nproc >= 6`, ignora `eval_tok_s` mancanti, mediana, `None` se vuoto). Le
quattro funzioni sono state **estratte ed eseguite** contro 8 casi (dispari, pari,
filtro, `None` in entrambi i campi, lista vuota, nessun valido, chiavi mancanti):

| config | test superati |
|---|---|
| stock | **8/8** |
| k6d0 | **8/8** |
| shipped | **8/8** |
| candidate | **8/8** |

Nessuna differenza. Le implementazioni sono quasi identiche fra loro.

### Prosa lunga in italiano (`long_conversational_it`) — dove crolla di solito
È il test che scopre collasso in ripetizioni e deriva fuori lingua, i guasti che un
numero di perplexity su fette corte non mostra. Misurato su tutte e 6 le risposte
per configurazione:

| config | parole | parole uniche | 5-grammi ripetuti |
|---|---|---|---|
| stock | 988 | 64.8 % | 7 |
| k6d0 | 988 | 63.5 % | 9 |
| shipped | 1018 | 62.5 % | 8 |
| candidate | 970 | 62.9 % | 10 |

**Equivalenti.** Nessun collasso, nessuna deriva, ricchezza lessicale comparabile
(il conteggio di parole esclusive di ciascuna configurazione va da 111 a 143 —
stesso ordine).

## Le due sole stranezze trovate, entrambe nella candidata

1. **`caricicamento`** — parola malformata (in `f45_3_istruzioni`), e la domanda che
   la contiene non ha molto senso: *«tempo di caricicamento dello schermo»*.
2. **«un nastro di Perseus che si srotola»** — metafora che non sta in piedi
   (`long_conversational_it`).

Una parola malformata su ~970 e una metafora storta **sono dentro il rumore** per un
campione di sei prompt: nessuna delle due, da sola, è prova di degrado. Ma sono
entrambe nella stessa configurazione, e questo è il tipo di dettaglio da tenere
d'occhio se il campione cresce.

## Limiti — cosa questa cella NON dice

- **Sei prompt sono pochi.** Questo esclude un guasto grossolano, non dimostra
  equivalenza. Una differenza del 2-3 % nella qualità delle risposte non sarebbe
  visibile qui.
- **Nessun giudice cieco.** Le risposte sono state lette, non punteggiate alla
  cieca da valutatori indipendenti. Per un claim di prodotto servirebbe quello.
- **Solo CalaQwen.** Su Marco il drop costa molto di più in bpb (+5.71 % contro
  +1.18 %), quindi il test va rifatto lì prima di estendere la conclusione.
- **Nessun test di tool-call**, che è la capacità su cui l'app si gioca la lane FT.

## Nota tecnica che ha quasi invalidato la cella

Il primo tentativo passava i prompt da riga di comando (`-p "…"`). **Su Windows
questo corrompe le accentate**: chiedendo al modello di ripetere «perché città» ha
restituito U+FFFD (il carattere «sconosciuto») al posto di entrambe. Windows
converte la riga di comando nella codepage ANSI, quindi `é` arriva come il byte
singolo `0xE9`, che non è UTF-8 valido e raggiunge il tokenizer come byte di
fallback. Ogni prompt italiano della suite era colpito.

La cella usa quindi la modalità `--session` del motore: richieste JSON su **stdin**,
che è un flusso di byte e non viene ri-codificato. Verificato sui byte: l'output
contiene `c3a8` (UTF-8 corretto) e non `e9`. Le generazioni della campagna in
`results/dense2` sono pulite perché furono prodotte sul device, dove il locale è
UTF-8 — su PC il problema non era mai emerso perché nessuno aveva mai generato
testo italiano da riga di comando su Windows.

**Da leggere:** `ANSWERS.md` in questa cartella, con le quattro risposte affiancate
per ogni domanda.
