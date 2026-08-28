# Ricerca: perdita di contesto multi-turn + fix per Kalsa (2026-08-02, v2)

## Il problema
Chatbot locali: dopo 3-4 turni perdono contesto, istruzioni, coerenza delle tool call.

## Evidenze (deep research, 2 round)

### 1. "When Attention Closes" — arXiv 2605.12922 (13 mag 2026, Dongre et al.)
- Channel-transition: i token-obiettivo diventano inaccessibili via attenzione col progredire dei turni (l'informazione sopravvive nei residual stream — probe AUC 0.99).
- Ablazione causale Mistral-7B: chiusura del canale → recall da ~100% a 11%.
- **Appendice H (letta)**: re-iniezione PERIODICA (ogni K) user-role del goal verbatim → **fallita** (SW=4096, lag +4..+9). "Late textual access alone is insufficient **in this intervention format**" — periodica + verbatim + user-role.

### 2. CisWire (Aspis0/CisWire, privato) — il pattern vincente, misurato
- Organello A: facts su disco → **re-iniettati a OGNI turno** (non periodici), blocco **frozen**, **sub-budget con deferral deterministico** (mai truncation a metà), GC datato.
- Benchmark compaction-survival: gemma-e4b locale **30.5% → 88.3% (+57.8, p=0.003)**; deepseek 70.7%→99.6%.
- Codice pi-specifico (fs, ExtensionContext) ma selezione/budget/freeze dichiarati **portabili**.

### 3. MemGPT (arXiv 2310.08560)
- Virtual context management: paging tra memoria core/archival/recall; self-editing memory. Il riassunto ricorsivo è il caso a 1 livello di MemGPT. Riferimento concettuale obbligatorio per il design.

### 4. Posizione del system prompt — "Position is Power" (arXiv 2505.21091)
- La POSIZIONE del system prompt è essa stessa un meccanismo di bias/effetto: non è neutra. Conferma che *dove* mettiamo le istruzioni cambia il comportamento.
- "An Empirical Study on the Effects of System Prompts" (2602.15228, feb 2026, 360 config): **aumentare la specificità dei vincoli non migliora monotonamente** — la verbosità può danneggiare. → prompt operativo MINIMALE, non duplicare tutto.
- "A Closer Look at System Prompt Robustness" (2502.12197): robustness variabile.

### 5. Tool calling
- **LongFuncEval** (2505.10570): tool calling degrada **13% e 40%** con conversazioni più lunghe; nessuno studio sulla posizione per tool calling.
- **LLMs Get Lost In Multi-Turn** (2505.06120); IHEval (2025): gerarchia system > user > history > tool fragile sotto conflitto.

### 6. Meccanismo
- **Context Rot** (Chroma 2025; Veseli 2025): degrada per distanza dalla fine (i recenti dominano). **Lost in the Middle** (2023): gli estremi privilegiati → la FINE è la posizione migliore.
- **Entangled Instructions** (2503.13222); **GraphIF** (2511.10051); **Recursively Summarizing** (2308.15022) — riassunti ricorsivi funzionano.
- **InstABoost** (2506.13734) / **V-Steer** (2607.26228): steering a inferenza, con rischio jailbreak (fuori scope).
- **ChatML/Qwen**: il template serializza system multipli correttamente, MA i modelli Qwen sono addestrati con system solo in prima posizione → system in coda = token fuori distribuzione → **rischio** (da testare, non assumere).

## AUTOCRITICA del piano V4 v1 (difetti trovati)
1. **Formato/posizione del blocco finale ASSUNTO, non verificato** — system-role in coda è fuori distribuzione per Qwen (ChatML ≠ trained positions); user-role è il formato che l'appendice H ha visto fallire (con differenze: cadenza/compattezza). → Serve un **A/B empirico** prima di tutto.
2. **Il riassunto cambia il prompt a ogni aggiornamento** — conflitto col principio frozen di CisWire; può confondere il modello (riassunto vs history). → Aggiornare ogni K turni con delta, marcatura chiara.
3. **Costo del riassunto su device** (2B/4B: 10-30s di completion) — fatto dopo ogni turno degrada la UX. → Soglie alte, background, budget, fallback deterministico.
4. **Benchmark proposto debole** (n=1, variabili non controllate). → 5 run/braccio, 3 seed, metriche oggettive (grep token esatti, stile ciswire), baseline = codice attuale.
5. **Verbosity risk** (2602.15228): duplicare le regole nel blocco finale può DANNIARE. → Blocco minimale: solo 2-3 regole critiche (tool, lingua), non il prompt intero.
6. **MemGPT assente dal design** — manca il framing: riassunto ricorsivo = working memory; facts = core memory. Il design deve distinguere i due livelli e i loro budget.
7. **"Frozen = cache warm" sovravenduto**: llama.rn non riusa la KV cache tra turni → il freeze dà solo stabilità d'attenzione, non velocità.
8. **Tool loop: il blocco finale si allontana dopo il round tool** (il tool_result viene dopo) — nel round 2 la regola deve essere nel tool_result stesso (1 riga), non nel blocco.
9. **Niente training**: la fix è runtime; GAtt/training resta la soluzione di fondo (fuori scope; da citare come roadmap).

## PIANO V4.1 (migliorato)

### Fase 0 — A/B posizionamento + thinking (obbligatoria, prima di tutto)
Tre formati per il blocco operativo + 3 settaggi thinking, benchmark mini su emulatore (6 turni filler + probe fatto + probe tool call + probe lingua, 3 run/formato):
- Formati: A: system-role in coda (rischio distribuzione Qwen) · B: prefisso del messaggio user corrente (user-role, ogni turno, compatto) · C: messaggio user sintetico marcato [SYSTEM NOTE]
- **Thinking**: `enable_thinking:false` vs `thinking_budget_tokens:256` vs 512 (bug aperti #20182/#20476 su Qwen3.5 → testare; parametri instruct: repeat-penalty 1.0, presence-penalty 1.5) — misuro tok/s e qualità (tool call + onestà)
- Metriche: recall fatto (grep token), tool chiamato sì/no, args validi, lingua, tok/s.

### Fase 0.5 — n_ctx 8k→16k + KV
- engineCtx 8192→16384 (KV ~200MB a q8/q4 — comodo su 8GB anche con vision; calcolo: ~12KB/token × 16k)
- Opzione spinta (solo 2B o senza vision): KV q4/q4 (~8KB/token) — da validare con benchmark qualità; non necessario per ora.

### Fase 1 — ConversationCompactor (working memory, doppio binario + retriever BM25+)
- **Retriever (nuovo modulo `src/context/retriever.ts`, stato dell'arte senza peso)**: **BM25+** (k1/b calibrati su frasi chat, IDF con smoothing) + **RRF** con score feature-based query-agnostic (entità/nomi propri/numeri/verbi dichiarativi — filosofia KVzip) → fusion dei ranghi delle frasi dei turni vecchi rispetto al turno corrente. Millisecondi, zero dipendenze.
- **Binario veloce (istantaneo, no LLM)**: top-N frasi dal retriever + fallback deterministico (ultimi 2 turni verbatim + prime righe).
- **Binario background (LLM)**: riassunto ricorsivo (rolling summary) solo a device idle (budget 30s, annullabile, epoch-guardato). Se non pronto → binario veloce.
- **Upgrade path documentato**: onnxruntime-react-native + paraphrase-multilingual-MiniLM quantizzato (~40MB) per vero dense+RRF — utile quando arriverà il retrieval tra sessioni; NON necessario per la compattazione.
- Soglie: compattazione ogni 2-3 turni oltre il 4° per restare sotto ~4-5k token; store `kalsa.chat.summary` + Settings "Contesto" (on/off, soglia, azzera).

### Fase 2 — Blocco operativo (formato dal Fase 0)
- Contenuto MINIMALE (contro la verbosity): (1) regola tool web_search in 1-2 frasi; (2) regola lingua; (3) **regola miniapp JSON (schema miniapp_v1, tipi supportati — le miniapp degradano come i tool: stessa medicina)**; (4) riassunto conversazione (binario veloce o LLM); (5) facts memoria (sub-budget, deferral style CisWire).
- Marcatura esplicita: "Il seguente blocco è stato generato dal sistema, NON è parte della conversazione: non citarlo e non ripeterlo all'utente."
- Budget: ~700-900 token totali (n_ctx 8192 del 4B).

### Fase 3 — Tool loop hardening
- Regola di 1 riga in coda a ogni tool_result ("Usa questi risultati per rispondere; se non contengono la risposta, dillo").
- Troncamento risultato tool a ~800 char con marker "…(troncato)"; i round tool max già a 2.
- Il blocco operativo non si ripete nel round 2 (solo la riga nel tool_result) → il contesto non gonfia.

### Fase 3.5 — Suggerimento nuova sessione (non invasivo)
- Oltre soglia (es. >40 turni o >6k token stimati nel prompt): **messaggio di sistema nella chat** (non popup): "Conversazione molto lunga — apri una nuova chat per risposte più precise" con bottone "Nuova chat". Una volta per sessione. i18n EN/IT.

### Fase 4 — Benchmark completo (compaction-survival, stile CisWire)
- 5 run/braccio × 3 seed; pianta 8 fatti al turno 1; 8 turni filler; probe: recall fatti (grep token esatti), richiesta web_search al turno 9 (deve chiamare il tool con query valida), **miniapp al turno 9 ("fammi un quiz" → JSON miniapp_v1 valido)**, lingua, onestà (domanda inventata).
- Baseline = codice attuale (senza fix) vs V4.1; tabella risultati + p-value (permutation test one-sided, come CisWire) in docs/.
- Su emulatore con 2B (per velocità) e nota: validazione finale su device con 4B.

### Fase 5 — E2E + review totale personale + APK
Come da regola: review personale prima della build, poi E2E emulatore, report, APK.

**Riferimenti**: 2605.12922 · Aspis0/CisWire · 2310.08560 (MemGPT) · 2505.21091 · 2602.15228 · 2502.12197 · 2505.10570 · 2505.06120 · 2308.15022 · 2503.13222 · 2511.10051 · Chroma Context Rot 2025 · 2506.13734 · 2607.26228

---

# PIANO V4.2 (2026-08-03 — review ostile personale + verifica online)

## Fatti nuovi verificati (fonti: llama.rn/rn-completion.cpp, llama.cpp, template Gemma 4, HF Qwen3.5-4B)

1. **llama.rn RIUSA la KV cache tra turni** (smentisce l'autocritica #7 di V4.1): `loadPrompt()` calcola il prefisso comune di token col turno precedente e ridecodifica SOLO la coda; per i modelli ibridi (Qwen3.5 = Gated DeltaNet + Gated Attention) usa snapshot di stato ai confini dei messaggi. Conseguenza: **un prefisso frozen byte-identico = prefill quasi gratis**. Qualsiasi cosa cambi all'inizio del prompt (summary aggiornato, finestra che scorre, blocco in coda) invalida il cache dal punto di divergenza in poi.
2. **Formato A (system-role in coda) è MORTO**: per Gemma 4 il template tratta solo `messages[0]` come system block — un system in coda è un turno `system` anomalo, out-of-distribution; e comunque romperebbe il prefix cache. L'A/B testa solo **B** (prefisso del messaggio user corrente) vs **C** ([SYSTEM NOTE] user sintetico) vs baseline none.
3. **Bug thinking Qwen3.5 ancora aperti** (#20182/#20476, luglio 2026): usare SEMPRE la doppia cintura `enable_thinking:false` **e** `thinking_budget_tokens:0`, e ritestare a ogni bump di llama.rn.
4. **KV math corretta per Qwen3.5-4B ibrido**: solo 8 layer di full attention (KV heads 4, head_dim 256) → ~16KB/token a q8 → **~256MB a 16k** (+ stato ibrido). La stima "12KB/token" di V4.1 usava l'architettura densa sbagliata. Il buffer è riservato a init per l'intero n_ctx.
5. **BM25 su italiano**: whitespace-token nudo degrada (flessioni); mitigazione consolidata in letteratura = lowercase + fold accenti + **char n-grams 3-4** (eventualmente fusion word+char). Meglio dello stemming Snowball per chat corta con refusi.
6. **Budget summary 30s**: realistico su fascia media SOLO con thinking off, output ≤400 token e prefix cache attivo; su low-end può sforare — budget soft, non hard.

## Correzioni al design (dalla review ostile)

- **Layout del prompt cache-friendly (nuovo principio guida, CORRETTO post-audit 1b; digest query-time dal 2026-08-03)**: `[system fisso] + [finestra recente CRESCENTE, append-only] + [blocco operativo (digest query-time + summary frozen-K) nel prefisso dell'ultimo user (formato B/C)]`. ATTENZIONE (verità di design emersa in audit): una finestra recente che *scorre* (`slice(-R)`) fa divergere i token subito dopo il system prompt A OGNI turno → il prefix cache non guadagna nulla oltre la legacy. La finestra deve invece partire dal **boundary di compattazione** (fisso per K turni) e CRESCERE append-only tra un rebuild e l'altro (da ~R a ~R+2K messaggi); al rebuild il boundary avanza e si paga UN re-prefill. Il blocco operativo sta in coda (attention-friendly per Context Rot): il digest può cambiare ogni turno **senza** invalidare il prefisso history. Il benchmark Fase 0/4 deve misurare ANCHE il prefill (tempo al primo token), non solo il recall — è lì che si verifica il claim. `clearCache()` al cambio conversazione.
- **Fast-track retriever**: in V4.2 era **congelato per K turni** (stessa medicina del summary). **REVOCATO 2026-08-03** — vedi sezione "Query-time BM25 digest" sotto: il freeze non salva prefill in posizione user-prefix e costa recall. Resta frozen solo il rolling summary LLM; il digest BM25 è query-time ogni turno.
- **Retriever** (`src/context/retriever.ts`): BM25+ su **char 3-4 grams** con lowercase+fold accenti; unità = frase con ruolo + vicinato (frase±1), dedup; RRF con salience query-agnostic (entità/numeri/verbi dichiarativi). Zero dipendenze, millisecondi.
- **n_ctx ADATTIVO, non 16k fisso** (fonde il leftover "auto-profilo RAM"): il `engineCtx` di catalogo è autoritativo (mai downgrade — il 2B resta a 16k ovunque); il gate RAM fa solo UPGRADE del 4B a 16k su device ≥ ~8GB reali (7.5e9 — sulla classe 6GB il +130MB di KV con mmproj residente è rischio OOM). V-cache: baseline q4_0 (revisit dopo il bench qualità Fase 4). Budget finestra: rebuild anticipato oltre ~16k char (~4k token) + rebuild forzato su `context_full`.
- **Note di design accettate (audit finale 2026-08-03)**: (1) il summary in background gira solo sul turno K-1, così il suo clearCache è assorbito dal re-prefill inevitabile del turno di rebuild; (2) il summary resta indietro di un rebuild rispetto al boundary (il chunk intermedio è coperto solo dal digest) — rivalutare dopo il bench; (3) il flip del cap caratteri con immagini rompe il prefisso KV per quel turno (stessa classe della legacy); (4) una risposta che INIZIA con un `<think>` letterale mai chiuso viene soppressa (trade-off contro il leak del reasoning troncato — caso raro, accettato); (5) il nudge "nuova chat" usa la history UI, non il prompt engine: con compaction ON può suonare prima del necessario — copy da rivedere dopo il bench.
- **Tool result: troncare a ~2500 char** (non 800 di V4.1 né 6000 attuali) + 1 riga di regola in coda al tool_result. Da validare in Fase 4.
- **Summary in background PREEMPTABILE**: l'invio utente aborta il job di summary (non solo epoch-guard) — l'engine FIFO non deve mai far attendere un turno utente dietro un summarize. Output ≤400 token, thinking off.
- **Multi-chat**: chiave summary per conversazione (`kalsa.chat.summary.<chatId>`; oggi chatId="default").
- **Vision nel budget**: le immagini contano nel budget di compattazione (stima conservativa per immagine; con allegati la finestra si dimezza già oggi — il compactor mantiene almeno quella riduzione).
- **Benchmark**: qualità/recall su emulatore ok, **velocità solo su device reale**; probe recall anche a risposta chiusa (multiple choice, grep-abile) oltre al grep esatto; 5 run/braccio × 3 seed.
- **Infra bench (VERIFICATO EMPIRICAMENTE 2026-08-03)**: RunPod è **fuori gioco** per l'emulatore — probe SSH su pod CPU (US-KS-2, kernel 6.17) e GPU RTX4090 (US-NC-1, kernel 6.8): dentro il container NIENTE `/dev/kvm`, niente binder/ashmem → né redroid né emulatore accelerato (l'immagine redroid infatti crash-loopa). Scala di fallback:
  1. **Emulatore locale con settaggi conservativi** (primo tentativo: cold boot, `-no-snapshot`, `-memory 2048`, `-gpu swiftshader_indirect`, un solo AVD) — gratis, rischio crash PC noto.
  2. **GitHub Actions** per i bench SCRIPTATI (A/B + compaction-survival): i runner Linux hosted espongono `/dev/kvm` → `reactivecircus/android-emulator-runner` + script adb, risultati come artifact. Robusto, non tocca il PC, gratis entro la quota del repo.
  3. **Cloud Android interattivo** (Genymotion SaaS o AWS Device Farm remote access) per l'E2E pilotato se il locale crasha — richiede account/spesa: decisione utente.
  4. Device fisico quando disponibile (validazione finale velocità, come da piano).

## Ordine di implementazione V4.2

1. **Fase 1a** — `src/context/retriever.ts` (BM25+ char-ngrams + RRF) + unit harness Node con corpus IT/EN (puro TS, zero device).
2. **Fase 1b** — ConversationCompactor: binario veloce (retriever BM25 **query-time ogni turno**, warm index per chat) + summary frozen ogni K turni + boundary append-only; store per-chat; Settings "Contesto" on/off; layout prompt cache-friendly in AppShell/LlamaService. (Digest freeze revocato 2026-08-03.)
3. **Fase 2b** — hookup `summary` nel blocco operativo (già predisposto, oggi null) nel formato B di default (pending A/B).
4. **Fase 0.5** — n_ctx adattivo per RAM + cache_type q8_0.
5. **Fase 3** — tool hardening (2500 char + riga regola nel tool_result).
6. **Fase 3.5** — nudge "nuova chat" oltre soglia.
7. **Fase 0/4 (bench, OBBLIGATORIA prima di attivare di default)** — emulatore locale o RunPod: A/B formati B/C/none × thinking (false+budget0 vs budget256) col harness `/bench` esistente, poi compaction-survival (baseline sliding-window attuale vs V4.2, 5 run × 3 seed, permutation test). Attivazione di default SOLO se il benchmark vince sulla baseline.
8. **Fase 5** — E2E + APK (già in coda).

**Nota (2026-08-03)**: il default di produzione del thinking (`"default"` = off, doppia cintura) resta **PROVVISORIO** finché la Fase 0 (bench A/B) non lo conferma o lo cambia. Nel frattempo l'utente può cambiarlo a mano da Settings → Thinking (Off / Short=budget256 / Extended=budget512), persistito sulla stessa chiave `kalsa.bench.thinking` usata dal comando `/bench thinking` — un'unica fonte di verità, letta fresh a ogni turno in `streamAssistantTurn`.

---

# Query-time BM25 digest (2026-08-03) — revoca del freeze

## Benchmark esterno (forza la decisione)

3 run/braccio, tutti validi, modello **deepseek-v4-flash**, 16 fatti piantati, grading exact-token:

| arm | recall |
|---|---|
| CisWire (facts re-injected every turn) | 100% |
| bare agent | 97.9% |
| **Kalsa (frozen BM25 digest)** | **33.3%** |
| Kalsa, compaction off (legacy sliding window) | 2.1% |

### Diagnostica per-probe
- **Probe 1**: il digest congelato — keyed sull'ultima query FILLER — conteneva **0/16** fatti piantati → i probe precoci falliscono.
- **Probe 3**: un rebuild scatta usando il probe stesso come query → il digest sale a 3 fatti; da probe 6 in poi ~8 fatti. I pass tracciano **esattamente** il contenuto del digest.

**Conclusione**: il retrieval BM25 funziona; è il **FREEZE** a costare recall — a domanda N rispondi con un digest keyed sul topic della domanda N−2.

## Perché il freeze era inutile (insight meccanico)

Il digest era stato congelato per proteggere il **KV prefix cache** di llama.rn. Ma nel layout shippato il blocco operativo (digest + summary) è spillato sull'**ultimo messaggio user** (`user-prefix` / formato B — vedi `applyOperativeBlockFormat` in `LlamaService.ts`: "digest/summary ride on the last user message").

Tutto ciò che sta **dopo l'ultimo token stabile** viene ri-encodato **ogni turno** comunque. Quindi congelare il digest **in quella posizione**:
- **salva zero prefill**
- **costa solo recall**

> **CORREZIONE 2026-08-19 (§7.10 di HARNESS_FINDINGS.md).** La conclusione qui sopra è giusta ed è
> stata misurata; il *motivo* no, e il motivo sbagliato è finito anche nell'header di
> `compactor.ts`. Il blocco è in coda **solo per il turno che lo porta**. Al turno dopo quel
> messaggio user è history e viene ri-renderizzato *senza* blocco
> (`promptContentForHistoryMessage` rigioca il testo emesso solo per l'assistant), quindi
> l'ultimo token stabile **arretra** oltre il blocco, oltre quel turno user e oltre **la risposta
> generata dopo di lui**. La regione ri-encodata non è "la coda": è uno scambio intero. Il costo si
> paga per **iniezione**, non per cambio di contenuto — ed è esattamente per questo che il freeze,
> che teneva fermo il contenuto e continuava a iniettare ogni turno, non poteva che misurare zero.
> Misurato: bracci con digest riusano 0.564 contro 0.704 bare. **Non misurato**: iniettare ogni K
> turni. Knob `kalsa.bench.digestcadence`, default = ogni turno (produzione invariata).

Il pezzo che *davvero* protegge il prefisso è la **finestra verbatim append-only** ancorata al `boundaryIndex` (fisso per K turni). Quella non si tocca.

## Design nuovo (inverso rispetto a V4.2 freeze)

| pezzo | cadenza | note |
|---|---|---|
| **BM25 digest** | **ogni turno user**, query = messaggio corrente | corpus = lato "older" (pre-boundary); deterministico, ~ms |
| **Rolling LLM summary** | frozen ogni **K** user turns | costoso da rigenerare; non query-dependent |
| **Boundary / finestra verbatim** | avanza ogni **K** user turns (o early size / `context_full`) | append-only tra rebuild → KV prefix intatto |
| **Warm `RetrieverIndex` per chat** | append messaggi "older" al advance del boundary; query ogni turno; reset su clearChat / stale | throwaway index: ~26 ms @ 200 turni, ~1.3 s @ 5000; query warm ~3 ms |

### API (`src/context/compactor.ts`)
- `refreshQueryDigest` — ogni turno
- `advanceCompactionBoundary` — solo cadenza K / size / force
- `shouldRebuild` — garda **solo** boundary/summary, non il digest
- campo stato `frozenDigest` **tenuto per wire AsyncStorage** ma semanticamente è "last query-time digest"

### Razionale esplicita
Questa sezione **revoca** la decisione V4.2 "Fast-track retriever CONGELATO per K turni". Il freeze era coerente se il digest fosse stato nel prefisso stabile; con formato B in coda all'user non lo è. Il summary resta frozen perché (1) è query-agnostic e (2) rigenerarlo ogni turno costa decine di secondi on-device.


## Web fetch (2026-08-05)

The tool-round budget was raised from 2 to 3 so a turn can do search → fetch → answer.
That bump and the new per-turn execution cap (`MAX_TOOL_EXECUTIONS_PER_TURN = 3`) are
**not yet benchmarked**. The V4.2 rule (do not raise tool budgets without re-bench) is
**deferred, not waived**.

**Existing Fase 0/4 arms cannot track this change** — they do not exercise tool rounds.
NEW bench arms must be written (varying tool rounds 1/2/3, measuring per-round prefill
and end-to-end turn latency) before 3 rounds is considered settled. Do not treat a
green Fase 0/4 run as evidence that the tool-round bump is safe.

What those new arms must measure:
- prefill cost and tokens/s per tool round (1 vs 2 vs 3)
- end-to-end turn latency with search-only (≤2 rounds) vs search+fetch (3 rounds)
- tool-result transcript growth under the 2500-char tool-result cap
- any regression in blank-bubble / final-round `tool_choice: "none"` completion rates

Other production notes:
- Indexing is capped at **120k characters** of extracted page text (HTML and text/plain);
  content beyond that is not searched (bounds JS-thread work inside the engine FIFO).
- Redirects may land on another path/port of the **same host** (or an already-allowlisted
  URL); they must not widen the allowlist to a new host.
- On React Native the transport buffers the full body before JS sees it — Content-Length
  is an early exit only, not an OOM bound.

---

# Fase 4 — ESEGUITA (2026-08-11): il gate non è soddisfatto

Risultati completi e raccomandazioni per modello: **`docs/archive/BENCH_FASE4_RECOMMENDATIONS_2026-08-11.md`**.
Run autoritativi: `31448350810` (2B, 12/12 arm) · `31448369307` (4B, 10/12), build con patch
native verificate nel binario (`assert-native-patch.sh`).

| modello | baseline | v42 | Δ | p (baseline > v42) | verdetto |
|---|---|---|---|---|---|
| Qwen3.5-2B (17v16 conversazioni, 3 campagne) | 0.772 | 0.562 | +0.210 | **0.0090** | compaction PEGGIORA |
| Qwen3.5-4B (5v5) | 0.700 | 0.650 | +0.050 | 0.3929 | nessuna differenza |

Endpoint primario: recall dei fatti, unità = conversazione, media di un probe a finestra
piena (turno 11) e uno a fatti sfrattati (turno 16). Permutazione a una coda, esatta dove
possibile.

**Il gate V4.2 — «attivazione di default SOLO se il benchmark vince sulla baseline» — non è
soddisfatto su nessuno dei due modelli. `kalsa.context.compaction` resta OFF.**

Tre correzioni al piano, tutte misurate:

1. **Il layout non è cache-friendly.** Il prefill del braccio con compaction è +72% (2B) e
   +58% (4B) rispetto al baseline, con frazione di riuso KV più bassa (0.52 contro 0.63;
   0.49 contro 0.55). Sul 4B v42 elabora un prompt più corto in più tempo: l'avanzamento del
   boundary invalida il prefisso. Contraddice il principio guida della sezione V4.2.
2. **Il baratto è sfavorevole a questa lunghezza.** Compaction off = ultimi 20 messaggi
   verbatim; on = 6–12 messaggi più ~800 caratteri di digest. E il vincolo che lo
   giustificherebbe non è attivo: al turno 16 il prompt occupa il 13–29% dei 16k del 2B.
3. **Il rolling summary non è mai girato** (`summaryChars = 0` ovunque). Quanto sopra misura
   digest BM25 + finestra ristretta, non il design completo. Vedi § 5 del report.

La lezione CisWire registrata sopra — *«BM25 retrieval works; it is the FREEZE that costs
recall»* — resta valida ma **non è ciò che Kalsa implementa**: CisWire re-inietta i fatti *in
aggiunta* al contesto, Kalsa *sostituisce* contesto verbatim con un digest. Il confronto
utile che nessuno ha ancora fatto è digest **additivo** a finestra invariata.
