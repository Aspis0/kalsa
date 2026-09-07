# REPORT — cella `adreno-operand-b`
Board QRD8650 (SM8650/pineapple, Adreno 750), sessione QDC **808395**, host `sa812464`, serial `45207755`, 7/09/2026.
Kit `kit-eefa27e30….tgz` sha `0eebee77e6f8ff16ea48b2946c82deaac78ed22339663089e96401165ca2d6cd` da
`kalsallama-wt-accprobe` @`eefa27e30` (tre file diversi dal pinnato 2f3b24dee). Stessa configurazione delle celle
precedenti: modello spedito Q4_0 sha `a247afd6…`, corpus 3079 parole, `-s 42 -c 256 -b 256 -fa off --temp 0`, base CPU
generata una volta e condivisa. **Tutte e quattro le righe sono OK**: la sonda di provenienza per variante
(`llama-bench -v` prima di ogni run) funziona, e i VOID della cella precedente non si ripetono.

## Le quattro misure
| variante | prec | b | Median KLD | Same top p | PPL delta |
|---|---|---|---|---|---|
| `stock:half:half` (controllo) | half | half | **0,453822** | **62,823 %** | **8,400806** |
| `stock:mul:half` (controllo del braccio bancato) | mul | half | **0,004736** | **94,826 %** | **0,349474** |
| `stock:mul:float` (**il braccio in esame**) | mul | float | 0,004641 | 94,319 % | 0,386119 |
| `stock:deq:float` | deq | float | 0,004635 | 94,432 % | 0,395435 |

**I due controlli passano alla sesta cifra decimale.** `stock:half:half` riproduce 0,453822 / 62,823 / 8,400806 per la
terza volta, ora con il **terzo** kit; `stock:mul:half` riproduce 0,004736 / 94,826 / 0,349474 identico al valore
bancato in ALIVE 57, nonostante il kit nuovo differisca dal pinnato per tre file invece di due. Il kit non è sospetto.

## La lettura, che è un NO
**Lettura 3 del PREREG applicata: l'operando come è memorizzato NON è il residuo.** La soglia era "mediana entro il
20 % di 0,004736"; il risultato è 0,004641, cioè **entro il 2 %** — e il same-top **peggiora** leggermente
(94,319 % contro 94,826 %). Tenere le attivazioni in f32 fino dentro il GEMM, con un kernel di trasposizione f32 che
scrive un'immagine `CL_FLOAT` invece di restringere a f16, **non cambia nulla di misurabile**. La variante `deq:float`
conferma: 0,004635, stesso posto.
Quindi la catena di refutazioni della campagna si allunga: **attenzione** (ALIVE 56), **flag del compilatore**,
**accumulatore f16**, **dequantizzazione** (ALIVE 57) e ora **precisione dell'operando in memoria**. L'unica cosa che
ha mai spostato la KLD è il **prodotto** — di un fattore 95,8×.

## Il residuo, e cosa resta in piedi
Fra `mul` (0,004736) e il percorso GEMV in batch 1 (0,000962) resta un fattore ~5, e questa cella dimostra che **non**
è la precisione dei dati. I sospetti nominati nel PREREG e non ancora testati restano due, entrambi strutturali:
la **geometria del tile** (il GEMM gira con due forme di workgroup, `{1,128,1}` e `{2,64,1}`, e dichiara
`qcom_reqd_sub_group_size("full")`) e l'**ordine di somma** — nel GEMM ogni fiber accumula 8×4 uscite lungo K in un
ordine diverso da quello del GEMV. Nessuno dei due è una questione di bit di mantissa.

## Velocità: il debito NON è formalmente chiuso, ma tre stime indipendenti concordano
Protocollo nuovo: cooldown 180 s fra i passi, **ordine randomizzato** con seed 42, temperatura della pelle letta prima
e dopo ogni passo.
| variante | ordine reale | T prima | T dopo | pp512 |
|---|---|---|---|---|
| `stock:half:half` | 1 | **40,971** | 41,709 | 288,62 ± 1,07 |
| `stock:deq:float` | 2 | 36,931 | 37,610 | 168,66 ± 0,13 |
| `stock:mul:float` | 3 | 35,778 | 36,699 | 147,05 ± 0,67 |
| `stock:mul:half` | 4 | 35,261 | 35,986 | 190,25 ± 0,49 |

⚠️ **La lettura di validità pre-registrata FALLISCE**: le temperature di inizio vanno da 35,261 a 40,971, cioè
**5,71 °C** di escursione contro i 2 °C ammessi. Per l'Amendment 1 il confronto è **dichiarato degradato** e i rapporti
restano indicativi. Non allargo la banda a posteriori.
Detto questo, il numero è robusto per un'altra ragione, e va detta separatamente perché non sostituisce la lettura
fallita: `mul:half` / `half` = 190,25/288,62 = **0,659×**, e contro il riferimento pre-registrato 289,98 = **0,656×**.
Sono tre stime prese in condizioni termiche diverse — 0,663× a caldo nella sessione precedente, 0,654× contro il
riferimento freddo, 0,656× qui — che **concordano entro l'1 %**. Si noti anche che il braccio più caldo (40,97 °C) è
stato il **più veloce**, il contrario di quanto farebbe una degradazione termica: la deriva, se c'è, non spiega
l'ordine.
**L'operando f32 costa e non rende**: `mul:float` gira a 147,05 t/s = **0,509×** dello stock, cioè paga il raddoppio
della banda sulla gamba trasposta senza comprare fedeltà. È una variante da scartare, non da ottimizzare.

## Difetto del nostro harness, trovato dal protocollo nuovo
Il cooldown si applica **fra** i passi di bench ma **non prima del primo**, che eredita il calore della fase KLD
appena conclusa: 40,971 °C contro i 35-37 di tutti gli altri. È l'unica ragione per cui la banda dei 2 °C è saltata.
Correzione per la prossima cella: cooldown anche **prima** del primo passo, e la lettura di validità va calcolata sui
passi effettivamente confrontati.

## Cosa questa cella NON dimostra
- Nulla su 732/735/8 Elite, né sugli altri nove `gemm_noshuffle_*`, né sui dieci percorsi che condividono il kernel
  di trasposizione (che non è stato toccato: il nostro è un kernel nuovo affiancato).
- Nulla sul decode (GEMV, non toccato dalla patch — fatto di codice, verificato nel diff).
- Non dimostra che il residuo sia geometria o ordine di somma: li lascia come unici sospetti in piedi, non li misura.
