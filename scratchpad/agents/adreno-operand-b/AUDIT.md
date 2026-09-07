# AUDIT — cella `adreno-operand-b`

## #1 — implementazione della variante B=float (deepseek-v4-flash, modello diverso dallo scrittore Luna)
Verifiche mie sul disco, prima di leggere l'audit: il default preprocessa **identico** al file base 2f3b24dee
(`clang -E -P`, diff vuoto); il gate di sintassi passa su sei combinazioni (`PREC=0..3`, più `PREC=2` e `PREC=3` con
`-DKALSA_GEMM_B_FLOAT=1`); `transpose.cl` ha **30 aggiunte e 0 rimozioni**, quindi il kernel condiviso dai dieci
percorsi quantizzati non è stato toccato. L'audit ha riverificato tutte e tre e le conferma.

### Il rilievo che conta — PLAUSIBLE, e va chiuso prima di misurare
I kernel sono **embeddati** (`ggml/CMakeLists.txt:265`, `GGML_OPENCL_EMBED_KERNELS` ON di default): il `.cl` diventa
un header generato che finisce nel binario. Se una build riusasse un header **stantio**, il kernel verrebbe compilato
**senza** `-DKALSA_GEMM_B_FLOAT` mentre l'host crea comunque l'immagine `CL_FLOAT` (`ggml-opencl.cpp:17212`) e lancia
il kernel di trasposizione f32: si otterrebbe `read_imageh` su dati f32, cioè **spazzatura silenziosa con la riga di
provenienza che dichiara `b=float`**. CMake rigenera l'header via `add_custom_command(... DEPENDS ${KERN_SRC} ...)`
(`CMakeLists.txt:38-41`), quindi una build pulita è corretta — ma dall'albero non è verificabile, va verificato **nel
kit**. Rimedio adottato: `build-kit.sh` deve asserire che la `libggml-opencl.so` costruita contenga le stringhe del
nuovo blocco di macro; è lo stesso controllo che ha già dimostrato il suo valore nella cella precedente
(`KALSA_GEMM_ACCUMULATE`, `prec=%s math=%s` trovate nel `.so` prima di spendere device).

### Le due paure grosse, REFUTATE con il codice in mano
- **Crescita dello scratch condiviso.** `prealloc_act_trans` è usato da venti percorsi (dieci quantizzati + dieci MoE).
  L'audit dimostra che ogni consumatore chiama `allocate()` **immediatamente prima** di creare il proprio sub-buffer e
  la propria immagine, che tutti i figli sono locali alla chiamata e rilasciati alla fine (`:17287-17291`), che
  l'allocatore è **monotono** (`:341-352`, `if (new_size > size)`) e che nessuno mette in cache un figlio fra
  chiamate. Un braccio `half` dopo la crescita crea il suo sub-buffer dal parent più grande con la sua region più
  piccola: ci sta sempre. Nota: la crescita di quel buffer **esisteva già** (il percorso MoE `:22434` lo fa), il
  nostro diff aggiunge solo una seconda sorgente.
- **Larghezza dell'immagine.** Fit esatto in entrambi i bracci: `image_width` è in texel RGBA (5.636.096, identica nei
  due casi perché lo spazio texel è indipendente dal formato), e `region.size` è in byte — 8 byte/texel in half
  (45.088.768) contro 16 in float (90.177.536). Nessun accesso fuori dai limiti.

### Confermati
Il nuovo `kernel_transpose_32_32` è **token-identico** al `32_16` a meno del tipo (stessi indici, stesse guardie
`if((j_2+0)*cols+i*4+3 < rows*cols*16)`, stesso zero-padding perché i registri sono pre-azzerati e le scritture
incondizionate) → i due bracci sono confrontabili. La guardia di compatibilità legge il nome **risolto** di `prec`
(non la stringa d'ambiente) e l'ordine dei tre blocchi lo rende possibile. Espandendo le macro a mano: con
`KALSA_GEMM_B_FLOAT` il `convert_float8(B)` diventa identità e prodotto e accumulo sono entrambi f32 — è esattamente
il braccio voluto. La riga di log stampa `b=` **prima** della build e stampa la stringa realmente passata.
Nessun handle non inizializzato (`CL_CHECK` sul nuovo kernel), nessuna perdita (stessi cinque oggetti creati e
rilasciati), e il flag non può filtrare negli altri kernel quantizzati perché ognuno ha il suo blocco di opzioni.

### Aperti, dichiarati
`CL_DEVICE_IMAGE_MAX_BUFFER_SIZE` e `max_alloc_size` contro un'immagine da 90 MB: il conteggio dei texel è **identico**
a quello del braccio half che già funziona, e il contesto alloca già 311 MB altrove, quindi il rischio è basso e un
eventuale superamento fallirebbe **rumorosamente** (`CL_CHECK`). Non misurato.
