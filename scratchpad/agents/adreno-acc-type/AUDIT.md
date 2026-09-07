# AUDIT — cella `adreno-acc-type`
Ogni voce dice chi ha trovato cosa e come è stata verificata. Un verdetto di un delegato non è una prova finché non è
riletto sul file.

## #1 — parser delle metriche che non aggancia l'output reale (trovato dall'orchestratore, non da un auditor)
**CONFIRMED.** `d_run.sh` cercava le etichette con `index($0, label ":")`, cioè le stringhe letterali `Mean KLD:`,
`Median KLD:`, `Mean PPL(Q)-PPL(base):`. L'output vero di `llama-perplexity`, letto nel log archiviato della cella
precedente `adreno-precision-bisect/raw/sa812121-faoff/gpu-kld.log`, è:
```
31:Mean PPL(Q)-PPL(base)         :   8.400806 ±   1.140076
34:Mean    KLD:   0.638627 ±   0.016709
40:Median  KLD:   0.453822
63:Same top p: 62.823 ± 1.146 %
```
Spazi multipli dentro l'etichetta e spazi PRIMA dei due punti: tre metriche su quattro non potevano agganciare, e la
regola di VOID del driver avrebbe marcato `summary_missing` **ogni** variante, bruciando l'intera sessione QDC senza
produrre un numero. Trovato eseguendo il parser contro dati archiviati veri, non leggendolo.
È la stessa classe di errore di `compare_dump.py` nella cella precedente (parsava il prefisso del README upstream
invece del nostro): un parser che non ha mai visto l'output vero non è verificato. Rimedio richiesto: matcher ancorato
a inizio riga e tollerante agli spazi, che però non possa confondere `Maximum KLD`, `99.9% KLD`, `95.0% KLD`,
`Minimum KLD` o la riga di intestazione con `Mean`/`Median`; più un `--self-test` senza device che riproduce i valori
esatti di due log archiviati e verifica anche il caso negativo.

## #2 — il kernel binario precompilato NON può scavalcare la variante (verificato dall'orchestratore)
**REFUTED come rischio.** Era il modo peggiore in cui la cella poteva mentire: se il GEMM Q4_0 arrivasse da un kernel
binario precompilato, `-DKALSA_GEMM_PREC` verrebbe ignorato e tutte le varianti misurerebbero la stessa cosa.
`kernel_gemm_noshuffle_q4_0_f32` è creato in un solo punto, `ggml-opencl.cpp:3827`, dal programma costruito dal
sorgente, ed è usato in un solo punto, `:17230`. Il percorso `get_adreno_bin_kernel` serve `gemm_noshuffle_q8_0_f32_ila`
e i GEMM MoE (`:4005`, `:4139`, `:4223`, `:4393`, `:4581`), non questo kernel.

## #3 — `compile_opts` integro al blocco del GEMM (verificato dall'orchestratore)
**CONFIRMED come sano.** L'unica mutazione della stringa generale è `:1580` `compile_opts += " -qcom-enable-large-buffer ";`,
prima di ogni uso. La dichiarazione omonima a `:2993` (`std::string compile_opts = ... " -cl-mad-enable -cl-finite-math-only ";`)
è locale al blocco `div` aperto a `:2985` e non è in vista alla riga 3788. Nota laterale utile alla lettura dei
risultati: i flag matematici già variano da kernel a kernel in questo file, quindi "strict" non è un'invenzione nostra
ma una configurazione che il file usa già altrove.

## #4 — gate di sintassi offline, eseguito dall'orchestratore
Le quattro varianti passano `-fsyntax-only` con il clang dell'NDK: `PREC=0 rc=0`, `PREC=1 rc=0`, `PREC=2 rc=0`,
`PREC=3 rc=0`, un solo warning atteso su `cl_qcom_reqd_sub_group_size`. Il gate ha già dimostrato il suo valore
rifiutando la modifica ingenua di una riga sola.

## #5 — audit del cambiamento (deepseek-v4-flash, modello diverso dallo scrittore Luna)
13 voci, di cui verifico qui le due che cambiano il piano e le tre che potevano affondarlo.
- **Il braccio stock è un controllo vero — CONFIRMED, e riverificato da me.** L'auditor ha preprocessato base e
  patch con `clang -E` ottenendo diff vuoto; ho rifatto la prova: `/tmp/base.pp.cl` e `/tmp/new0.pp.cl`, 167 righe
  ciascuno, `diff` rc=0. Senza `-D` il kernel patchato **è** il kernel base.
- **Rischio più alto, PLAUSIBLE: i flag rilassati potrebbero collassare le varianti.** `-cl-fast-relaxed-math` e
  `-cl-unsafe-math-optimizations` (`:1577-1578`) autorizzano riassociazione e allargamento: PREC 0/1/2 potrebbero
  compilare nello stesso binario. Non dimostrabile dall'albero. Risposta: Amendment 5, ogni precisione si misura anche
  con `MATH=strict`.
- **Secondo rischio, branch CONFIRMED: il percorso `ne1 == 1` (`:17087`) non passa dal kernel modificato**, e
  `use_adreno_kernels` (`:7227-7231`) esclude forme piccole e tensori non 2D. Risposta: Amendment 6.
- **REFUTED il crash da `erase(npos)`**: `compile_opts` è costruito incondizionatamente a `:1575-1578` e mutato solo a
  `:1580`; fra `:1580` e `:3791` ogni uso è in sola lettura. I tre flag ci sono sempre.
- **`exit(1)` non è un'anomalia in questo file**: l'auditor cita `:1147, 1173, 1193, 1204, 3468, 5730, 5748, 5759,
  5772, 25597`, oltre a `GGML_ABORT` altrove; e `ggml.c:316-317` fa `fflush(stderr)`, quindi il messaggio d'errore
  esce prima della morte del processo. Nessuna modifica richiesta.
- Registrati come note di lettura, non difetti: gli accumulatori float quadruplicano i registri di accumulo con
  subgroup a 128 corsie (effetto sulla velocità, che è proprio ciò che misuriamo) e la cache del compilatore del driver
  è indicizzata su sorgente+opzioni, che differiscono per variante.

## #6 — `local` che si riferisce a se stesso, trovato eseguendo il build (non leggendolo)
**CONFIRMED.** Il primo lancio di `build-kit.sh` è morto dopo aver superato tutte le guardie:
```
source_dirty=0
fault_define_occurrences=0
./build-kit.sh: line 101: name: unbound variable
```
`local` è un builtin: bash espande **tutti** i suoi argomenti prima di assegnarne uno, quindi in
`local name="$1" log="$LOG_DIR/${name}.log"` la `${name}` viene espansa mentre `name` è ancora non definita e `set -u`
uccide lo script. Lo stesso costrutto è in `d_run.sh:355` e `:422`
(`local variant="$1" math="${variant%%:*}" prec="${variant#*:}" key="${variant/:/-}"`) dove è **peggio**: lì una
variabile con quel nome esiste nello scope dinamico del chiamante, quindi invece di fallire può espandere in silenzio
il valore del chiamante — una riga di misura etichettata con la variante sbagliata.
È la stessa trappola già pagata il 5/09 (S5 run 1). Lezione da aggiungere: il "dry run con `set -u`" richiesto nel
brief non basta se copre solo la validazione degli argomenti; deve **raggiungere le funzioni che girano per ogni
variante**. Rimedio richiesto: dichiarazioni separate, più un self-test che chiama davvero quel percorso e una
scansione, eseguita e incollata, di ogni `local` che si riferisce a un nome assegnato nella stessa istruzione.

## #7 — quello che le misure hanno insegnato sull'audit stesso
- **Il rischio #2 dell'audit (i flag rilassati collassano le varianti) è REFUTATO dai dati**: `acc`, `mul` e `deq`
  hanno KLD e velocità diverse fra loro, quindi i `-D` producono binari diversi; e `stock` contro `strict` è identico
  alla sesta cifra, quindi quei flag non cambiano nulla in questo kernel. Era giusto pretenderlo prima di misurare.
- **Il rischio #1 (il percorso `ne1 == 1` non passa dal kernel modificato) resta in piedi** e limita l'interpretazione
  del valore assoluto, non i confronti fra varianti. Sta nel REPORT sotto "cosa NON dimostra".
- **Nuovo difetto scoperto solo dai dati veri**: la riga di provenienza non compare nei log di `llama-perplexity`.
  Nessuno dei controlli offline poteva vederlo — il gate di sintassi, il preprocessore e l'audit del codice guardavano
  tutti il posto giusto. Solo la run vera lo mostra. Regola per la prossima cella: la sonda di provenienza va
  **eseguita e verificata su device** prima di considerare pronto un driver, esattamente come il parser delle metriche
  va provato contro un log archiviato.

## #8 — audit del REPORT (GLM Reviewer Math, modello diverso da chi ha scritto): BANK-WITH-FIXES
⚠️ **L'agente è morto prima di emettere il messaggio finale**: l'ultimo blocco della sua sessione contiene solo il
ragionamento, non il report. I verdetti sono stati recuperati dal file di sessione
(`~/.pi/agent/sessions/…01a07b25….jsonl`) e **ognuno è stato riverificato sul disco dall'orchestratore prima di
applicarlo** — quello che segue è ciò che ho confermato io, non ciò che ha detto lui.
- **Tutte le 32 cifre della tabella corrispondono al raw.** Nessun numero inventato.
- **Verificato e CORRETTO: la lettura 7 non era mai stata riportata.** Era il controllo di sanità obbligatorio del
  PREREG. Risultato: `Final estimate: PPL = 22.9415 +/- 1.68463` **identica cifra per cifra** nelle due invocazioni di
  questa cella e in `adreno-precision-bisect/raw/sa812121-faoff/cpu-kld.log`. Passa, e passa più forte di quanto
  chiedesse ("entro l'incertezza"). Aggiunta al REPORT come sezione propria.
- **Verificato e CORRETTO: la prova termica era descritta male.** Il REPORT diceva "rieseguendo la stessa identica
  configurazione": falso. È una `llama-bench -p 512 -n 128` (con in più il carico `tg128`), lanciata a mano fuori dal
  driver, senza timestamp proprio, ~12 minuti dopo `bench-stock-half` (`08:54:33Z`) e dopo la chiusura dell'ultimo
  passo del driver (`09:04:28Z`) — non "~20 minuti dopo". Il carico `pp512` è lo stesso, l'invocazione no. Riscritto,
  e declassato da "prova" a "spiegazione più probabile con n=1 e senza telemetria termica".
- **Verificato e CORRETTO: sostituzione del denominatore.** Il PREREG fissava il confronto di velocità contro
  289,98 ± 1,28; il REPORT usava 286,30 dello stesso batch. Ora ci sono entrambi (0,663× e 0,654×) e si dice che la
  soglia 0,50× non scatta con nessuno dei due.
- **Verificato e CORRETTO: soglia congiuntiva.** L'Amendment 4 chiedeva mediana ≤ 0,005 **e** same-top ≥ 95 %.
  Scrivere che `mul` sta "dentro la soglia più severa" era falso: la mediana passa, il same-top no.
- **Verificato e CORRETTO: copertura delle sonde di provenienza.** Quattro combinazioni su otto, non tutte:
  half/stock, mul/stock, deq/stock, acc/strict. L'asse MATH è verificato una volta per valore.
- **Verificato e CORRETTO: `raw/sa812265/kit-device-sha.txt` contiene `MISSING`** — solo il secondo batch conserva la
  sha del kit sul device (e corrisponde al tarball). Dichiarato.
- Corretti anche: `96×` → `95,8×` (95,82), il blocco marcato "verbatim" che conteneva un'ellissi (ora copiato per
  intero dal file), la formula "una sola volta per invocazione" (le invocazioni sono due, con basi identiche), e la
  provenienza dei numeri di riga citati (albero `kalsallama-wt-accprobe` @7ef9389bc).
- **Sostenuta dall'audit, non corretta**: l'attribuzione causale. I tre punti `half/half` = 0,4538, `float/half` =
  0,4610, `float/float` = 0,004736 formano una griglia fattoriale in cui solo il passaggio del **prodotto** a float
  fa crollare la KLD; l'ambiguità residua è interna allo stadio del prodotto (mantissa contro range), non fra
  accumulatore e prodotto. E `gemv_noshuffle_q4_0_f32.cl` è intatto nel diff, quindi la neutralità sul decode è un
  fatto di codice.
