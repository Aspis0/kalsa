# Fase 4 — compaction-survival: risultati e raccomandazioni per modello

**Data**: 2026-08-11 · **Branch**: `bench/fase4-harness-fix` · **Modelli**: Qwen3.5-2B, Qwen3.5-4B
**Run autoritativi** (build con patch native verificate nel binario):
`31448350810` (2B, 12/12 arm verdi) · `31448369307` (4B, 10/12 arm verdi)

---

## La raccomandazione, in una riga per modello

| modello | `kalsa.context.compaction` | perché |
|---|---|---|
| **Qwen3.5-2B** | **OFF** — e non riaprire senza un redesign | recall peggiore (Δ +0.210, p=0.009 su 33 conversazioni) **e** prefill +72% |
| **Qwen3.5-4B** | **OFF** | recall indistinguibile (Δ +0.050, p=0.393) **e** prefill +58% — nessun beneficio, costo reale |
| **LFM2.5-2.6B** | non misurato | vedi § LFM2.5 |

Il gate che il piano V4.2 si era dato — *"attivazione di default SOLO se il benchmark vince
sulla baseline"* — **non è soddisfatto su nessuno dei due modelli**.

---

## 1. Che cosa è stato confrontato

Due bracci, un'unica variabile: `kalsa.context.compaction` = `"1"` (arm **v42**) contro `"0"`
(arm **baseline**). Tutto il resto tenuto uguale: stesso modello, stessi prompt, stessi seed,
`kalsa.locale=it`, memoria disattivata, `thinking=off` (default di produzione).

Conversazione di 16 turni: 2 turni di piantumazione (8 fatti), 8 filler, 6 probe. I fatti
sono `Leopoldo 4500 Torino PK42 Zaffiro XR9 Brindisi Nebbiolo`, valutati con grep a token
esatto sulla risposta ripulita dal reasoning.

**Il probe dei fatti è posto due volte, e la differenza fra i due è il punto:**

| probe | stato dei fatti | cosa misura |
|---|---|---|
| turno 11 | dentro la finestra dei 20 messaggi del baseline (`LEGACY_MAX_HISTORY`), **fuori** dal boundary di v42 | il modello li ha ancora e li usa? |
| turno 16 | fuori dalla finestra di **entrambi** i bracci | solo il retrieval può fornirli |

Endpoint primario pre-registrato: **media dei due probe, per conversazione** — un numero per
conversazione, unità = conversazione. Test di permutazione a una coda, esatto dove il numero
di assegnazioni lo consente.

## 2. Il meccanismo era attivo — prova, non assunzione

| evidenza | baseline | v42 |
|---|---|---|
| `compactorChars` (stato su disco del compactor, cancellato a inizio arm) | **0** su tutti gli arm | **693–974** su tutti gli arm |
| `boundaryIndex` per turno | assente | avanza 12 → 18 → 24 |
| token del prompt assemblato | 2110 (2B) / 3370 (4B) mediani | 2118 / 2378 |
| binding nativo | `KALSA_KVDIAG0` presente in `librnllama.so` (assert in CI) | idem |

Il turno 1 è escluso dal confronto dei prompt: è assemblato prima che ci sia qualcosa da
compattare ed è identico nei due bracci per costruzione (1153 token, misurato).

## 3. Risultati

### 3.1 Recall dei fatti — endpoint primario

| campagna | baseline | v42 | Δ | p (baseline > v42) |
|---|---|---|---|---|
| 2B, build patchata (6v6) | 0.740 | 0.531 | +0.208 | 0.1028 *(MC 10k)* |
| 2B, tre campagne (17v16) | **0.772** | **0.562** | **+0.210** | **0.0090** *(MC 300k)* |
| 4B, build patchata (5v5) | 0.700 | 0.650 | +0.050 | 0.3929 *(MC 10k)* |

> **Correzione (2026-08-11, seconda revisione).** Le prime due righe di questa tabella
> riportavano «esatto, 924 perm.» e «esatto, 252 perm.». Era **falso**:
> `permutationTestOneSided` in `scripts/bench/benchAggregate.mjs` campionava sempre
> `PERM_ITERATIONS` (default 10 000) estrazioni Monte Carlo e non conteneva alcun ramo di
> enumerazione esatta — la parola *exhaustive* compariva solo nel calcolo del *floor*.
> I valori restano validi come stime (a 10k estrazioni l'errore standard su p≈0.10 è ≈0.003,
> e nessuna conclusione di questo documento si sposta), ma il metodo dichiarato non era
> quello eseguito. L'enumerazione esatta ora esiste davvero per C(nA+nB,nB) ≤ 10 000 e
> l'aggregatore stampa per ogni riga quale metodo ha girato.

L'effetto sul 2B è **stabile in magnitudine** su tre campagne indipendenti (+0.209, +0.208,
+0.210) mentre la significatività di ciascuna oscilla (p = 0.012 / 0.229 / 0.103). Questo dice
due cose: la direzione è reale, e **una singola campagna 6v6 è sotto-dimensionata rispetto al
rumore** di questo carico. Chi rifarà la misura parta da 12 conversazioni per braccio.

### 3.2 Per famiglia di probe

| famiglia | 2B baseline | 2B v42 | 4B baseline | 4B v42 |
|---|---|---|---|---|
| fact_recall **precoce** (t11) | 0.750 | 0.688 | 1.000 | 0.775 |
| fact_recall **tardivo** (t16) | 0.729 | **0.375** | 0.400 | **0.525** |
| tool_call | 0.833 | 0.500 | 1.000 | 1.000 |
| onestà | 1.000 | 0.833 | 0.800 | 1.000 |
| lingua | 1.000 | 1.000 | 1.000 | 1.000 |
| miniapp | 0.000 | 0.000 | 0.000 | 0.200 |

Le quattro famiglie secondarie **non sono corrette per molteplicità** e vanno lette come
direzione, non come prova.

**Il dato più interessante è la riga tardiva.** Sul 4B la compaction fa *meglio* del baseline
proprio dove dovrebbe (0.525 contro 0.400: i fatti sono usciti dalla finestra e solo il
retrieval può recuperarli), ma perde altrettanto sul probe precoce, dove il baseline ha
ancora i venti messaggi verbatim. Netto ≈ zero. Sul 2B invece perde in entrambi i regimi.

### 3.3 Costo — e qui il design non regge

| | prefill mediano | TTFT mediano | riuso KV | tok/s |
|---|---|---|---|---|
| 2B baseline | 88.1 s | 96 s | 0.63 | 2.45 |
| 2B v42 | **151.4 s** (+72%) | 157 s | 0.52 | 2.51 |
| 4B baseline | 329.9 s | 352 s | 0.55 | 1.51 |
| 4B v42 | **522.6 s** (+58%) | 534 s | 0.49 | 1.58 |

*(turno 1 escluso: è il caricamento a freddo del modello, ~440 s in entrambi i bracci)*

Sul 4B il braccio con compaction elabora un prompt **più corto** (2378 contro 3370 token
mediani) e impiega **più tempo** a fare il prefill. L'unica spiegazione compatibile è che
l'avanzamento del boundary invalidi il prefisso KV, costringendo a ri-elaborare da un punto
più arretrato; la frazione di riuso misurata lo conferma (0.49 contro 0.55).

Questo **contraddice il principio guida di V4.2** («layout cache-friendly … la finestra deve
partire dal boundary di compattazione e CRESCERE append-only … il digest può cambiare ogni
turno *senza* invalidare il prefisso history»). Il decode non è toccato, come previsto.

## 4. Perché la compaction perde: il baratto è sfavorevole

Con compaction **off** il motore riceve gli ultimi 20 messaggi verbatim
(`compactor.ts:436-443`, `LEGACY_MAX_HISTORY = 20`). Con compaction **on** riceve la finestra
ancorata al boundary — misurata a 6–12 messaggi — più un digest BM25 di 693–974 caratteri.

Lo scambio è dunque: **venti messaggi testuali contro sei-dodici più ~800 caratteri di
riassunto estrattivo.** Su questi due modelli, a questa lunghezza di conversazione, è in
perdita.

E il vincolo che dovrebbe giustificarlo non è attivo: il 2B ha `engineCtx: 16384` e al turno
16 il prompt del baseline sta fra 2093 e 4759 token, cioè **13–29% della finestra**. Si sta
comprimendo un contesto pieno per un quarto, pagando il costo senza incassare il beneficio.

## 5. Metà del meccanismo non ha mai girato

`summaryChars = 0` su **tutti** gli arm v42, di tutte le campagne, su 16 turni. Il rolling
summary LLM — il secondo binario del design — non si è mai materializzato. Quello che è stato
misurato è **digest BM25 + finestra ristretta**, non il design completo.

Sospetto documentato ma non dimostrato: il job di summary è dichiarato preemptabile
dall'invio dell'utente, e l'harness manda il turno successivo pochi secondi dopo che la
risposta si è assestata. Non è distinguibile, con i dati raccolti, se il job non venga mai
schedulato o venga sempre abortito. **Serve una riga di log dedicata prima di poterlo dire.**
Se il sospetto regge, è anche un dato di prodotto: su un telefono con un utente che scrive
veloce quel riassunto non si materializza comunque.

**Aggiornamento (seconda revisione).** Il log dedicato ora esiste (`KALSA_SUMMARY`, un evento
per ogni punto di uscita del ciclo di vita), ma prima ancora di raccoglierlo l'aritmetica
chiude la questione per l'ambiente CI:

| costante | valore | fonte |
|---|---|---|
| `SUMMARY_IDLE_DEBOUNCE_MS` | 8 s | `AppShell.tsx` |
| `SUMMARIZE_TIMEOUT_MS` | 30 s | `LlamaService.ts:198` |
| `SUMMARIZE_N_PREDICT` | 400 token | `LlamaService.ts:202` |
| decode misurato, 2B su emulatore | 2.45 tok/s | § 3.3 |

400 token a 2.45 tok/s sono **~163 s** contro un timeout di 30 s: sull'emulatore CI il rolling
summary **non può completare**, qualunque sia l'intervallo fra i turni. Non è un problema di
debounce e non si corregge allungando l'attesa. Di conseguenza:

- l'harness fissa `INTER_TURN_DELAY_S = 40` (8 s di debounce + 30 s di timeout + margine) non
  per farlo riuscire ma per rendere il fallimento **osservabile**: `llm-start` seguito da un
  timeout registrato, invece di un abort ambiguo;
- il rolling summary resta **fuori portata su CI** e va misurato su device reale, dove il
  decode è di un altro ordine di grandezza;
- il braccio `ciswire` non ne dipende: misura il digest additivo, cioè il retrieval.

## 6. Cosa attivare e cosa no

### Qwen3.5-2B (fascia RAM bassa)
- `kalsa.context.compaction` → **OFF**. Peggiora il recall (p=0.009) e costa +72% di prefill.
- Regole miniapp nel system prompt → **candidate alla rimozione**. 0 miniapp valide su 11 arm,
  in entrambi i bracci: il modello non emette mai JSON `miniapp_v1`, scrive quiz in markdown.
  Sono 639 caratteri (~159 token, 23% del system prompt) spesi in un'istruzione mai seguita.
  Da verificare con un A/B dedicato prima di rimuoverle, non a intuito.
- `thinking` → **off**, che è già il default di produzione. Con `budget256` il reasoning viene
  persistito come risposta e rende non misurabili onestà, lingua e miniapp (misurato).

### Qwen3.5-4B (default di prodotto)
- `kalsa.context.compaction` → **OFF**. Nessun guadagno di recall misurabile, +58% di prefill.
- Vale la pena riaprire **solo** su conversazioni molto più lunghe di 16 turni, dove il probe
  tardivo (l'unico regime in cui qui la compaction vince) diventa dominante e la finestra si
  riempie davvero.

### Applicabile a entrambi
- Il **blocco operativo** aggiunge quattro istruzioni (lingua, web_search, onestà, miniapp)
  che il braccio baseline non riceve mai. Poiché sono duplicati di regole già presenti nel
  system prompt, e poiché il modello le viola comunque, sono verbosità: coerente con
  2602.15228 citato nel piano.
- **Privacy**: su 33 turni di sola memoria, 11 hanno fatto partire una ricerca web reale
  (baseline 7/18, v42 4/15), in un caso con i dati dell'utente nella query. La regola esiste
  nel system prompt di entrambi i bracci ma **non è applicata da codice**: non c'è alcun
  filtro sulle query in `src/tools/` o `src/engine/`. È il candidato numero uno per un
  meccanismo di tipo CisWire (`no-secrets-in-args` → block/rewrite).

## 7. LFM2.5-2.6B — perché non è nella tabella

GGUF verificato esistente (`LiquidAI/LFM2.5-2.6B-GGUF`, rev `b421ad1d549a…`, text-only,
1.67 GB) e architettura supportata dal llama.cpp incluso in llama.rn 0.12.8
(`LLM_ARCH_LFM2`). Ma due limiti strutturali, verificati leggendo il codice:

1. **Le tool call non sarebbero lette.** Il modello emette
   `<|tool_call_start|>[…]<|tool_call_end|>`; quei token non compaiono nel cpp bundlato e
   `toolCallParser.ts` gestisce solo il dialetto `<tool_call>` di Qwen più l'array OpenAI.
2. **Il thinking non ha un off.** È un reasoning model always-on: nel template esiste solo
   `preserve_thinking`. L'asse thinking del bench non ha una posizione valida.

Conseguenza: su LFM2.5 sarebbe onesto misurare **solo** il recall dei fatti, dichiarando non
applicabili le altre quattro famiglie. Aggiungerlo al registro è modifica di prodotto.

## 8. Limiti di questo risultato

- **Emulatore, non device.** 4 vCPU, x86_64. I tempi assoluti non sono trasferibili a un
  telefono; i rapporti fra bracci lo sono più plausibilmente.
- **16 turni.** Nessuna conclusione oltre questa lunghezza; § 4 spiega perché è proprio il
  regime in cui la compaction ha meno da offrire.
- **Metà meccanismo** (§ 5).
- **n piccolo.** 6 conversazioni per braccio per campagna; l'effetto sul 2B regge solo
  aggregando tre campagne.
- **Aggregazione fra build.** Il pooling del 2B unisce due campagne su binding non patchato e
  una su patchato. L'effetto misurato è identico nelle due condizioni (+0.209 contro +0.208),
  il che era la previsione dichiarata prima di misurarlo.
- Le famiglie secondarie non sono corrette per molteplicità.
