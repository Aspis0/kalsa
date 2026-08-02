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
