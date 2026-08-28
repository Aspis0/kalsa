# Telemetry opt-in — Kalsa AI Chat

Status: DESIGN v14 FINAL + diag-addendum (audit chiuso per decisione utente dopo 14 giri; residui documentati in §11). Addendum diagnosability 2026-08-12: enum detail estesi, campo `signal` con pattern allowlist, contesto fase/attempt — per rendere i report utili al debugging senza riaprire il rischio privacy.
Branch target: `feature/documents-tab-v1` → main.

## 1. Obiettivo e non-obiettivi

**Obiettivo.** Raccogliere segnalazioni di errore (crash e fallimenti di funzioni) dagli utenti che
**scelgono esplicitamente** di condividerle, per diagnosticare problemi su device reali senza un
account, senza cloud sync e senza violare il posizionamento privacy dell'app.

**Non-obiettivi.**
- NIENTE analytics d'uso (sessioni, tap, tempi, funzionalità usate).
- NIENTE contenuti chat/documenti/API keys in alcuna forma (né hash).
- NESSUN invio automatico: default **OFF**, attivazione solo via toggle esplicito in Impostazioni.
- NESSUNA raccolta se l'app è in background o il toggle è OFF.
- NESSUNA apertura automatica di issue GitHub: il Worker **bufferizza** per review del maintainer
  (vedi §7) — l'issue è creata da un comando di mantenimento, non da un endpoint pubblico.

## 2. Vincoli derivati (già decisi)

| Vincolo | Dettaglio |
|---|---|
| Solo opt-in | Toggle in Settings, default OFF, persistito (pattern `kalsa.web.enabled`) |
| Mai token client | Il GitHub token vive SOLO nel Cloudflare Worker (server-side, endpoint di flush protetto). **La telemetria automatica** chiama il Worker, mai GitHub direttamente; l'utente può comunque aprire GitHub nel browser per la segnalazione manuale (§6, sotto suo controllo esplicito). Il maintainer può usare `gh`/wrangler con credenziali proprie per il flush: la regola è "mai nel client dell'app", non "mai fuori dal Worker" |
| Nessun contenuto | Chat, documenti, query, API keys: mai raccolti, mai inviati — nemmeno come hash |
| Sanitizer al confine | Ogni errore passa da `sanitizeReport()` STRETTO e testato PRIMA di entrare nel payload; mai `Error` grezzi, mai code nativi, mai testo tool |
| Copia privacy onesta | "Pseudonymous diagnostics" (non "anonymous"): i campi restano quasi-identificanti; dirlo chiaramente |
| Copy privacy | Aggiornare `i18n en+it` in parità profonda — "No telemetry" → "Telemetry off by default, opt-in" |
| Convenzioni | Commit inglesi conventional; chat italiana |

## 3. Architettura

```
┌────────────┐   HTTPS (POST /report)   ┌──────────────────────┐   GET /flush (FLUSH_TOKEN)   ┌─────────────┐
│  Kalsa app │ ───────────────────────► │ Cloudflare Worker    │ ──────── maintainer ───────► │ repo issues │
│ (telemetry │   {payload sanitizzato}  │ (validazione schema, │   (solo maintainer,          │ Aspis0/kalsa│
│  queue)    │ ◄─────────────────────── │  dedupe KV, rate lim,│    DO storage = buffer)      │             │
└────────────┘   {accepted|duplicate}   │  DO TelemetryBuffer) │                              └─────────────┘
                                        └──────────────────────┘
```

- **Client (React Native, JS-only)** — nuovo modulo `src/telemetry/telemetry.ts`:
  - `sanitizeReport()`: unico punto di ingresso; da un errore produce SOLO i campi del payload §4,
    con enumerazione stabile dei motivi (`code`) e **`detail` come enum vincolato per-code** (stesso
    enum applicato dal Worker: i valori ammessi sono fissi, es. `http|dns|timeout|oom|disk|unknown`;
    qualsiasi altra stringa → campo omesso), MAI testo libero grezzo, MAI stack completo (vedi §4),
    MAI docId/URL/path (sostituiti da categoria).
  - **Allowlist, non denylist**: `detail` è accettato SOLO se appartiene all'enum del `code`
    corrispondente (vedi §4/§5 "motivi fissi"); qualsiasi testo tool non riconosciuto viene
    SCARTATO del tutto (campo omesso), mai inoltrato. In particolare il `sanitizeToolErrorMessage`
    di `webFetchTool.ts:1165-1173` PARKA e preserva gli URL http(s) per il modello — NON è
    sicuro per telemetria e non viene riusato al confine telemetry.
  - queue **persistita** su AsyncStorage: UNICO envelope `kalsa.telemetry.state` `{v:1, enabled,
    generation, queue:[...], dead:[...]}` (crash-safe, una sola chiave), scritture serializzate
    (mutex in-process), read-modify-write serializzato, cap 50 con drop-oldest, drain con lock (un
    solo drain attivo), recovery da entry malformate (drop+continua), **purge crash-safe
    dell'envelope alla disattivazione del toggle** (v11). **Schema entry dell'envelope**: ogni
    entry in `queue`/`dead` è `{report, state: "queued"|"sending"|"dropped"|... , generation
    (al momento dell'enqueue), retryCount, nextRetryAt (backoff timestamp), leaseUntil (per
    `sending`), deadExpiresAt, reviewAck}` — la `generation` della entry è quella catturata
    all'enqueue e usata dal finalizer per la regola di precedenza (v11/v12).
  - **Gate AppState**: enqueue e drain SOLO quando l'app è attiva (foreground); in background il
    drain viene cancellato (nessuna raccolta/invio in background — coerente con §1).
  - **Garanzia privacy precisa (non sovrastimata)**: il toggle OFF o il passaggio in background
    garantisce che **nessuna nuova richiesta parta** dopo la transizione. Una richiesta già
    trasmessa prima della transizione PUÒ essere accettata dal Worker (abort() non la ritratta a
    rete avviata) — la copy dell'Alert lo dice esplicitamente ("a report already in transit may
    still arrive"). Nessuna raccolta in background, nessun retry dopo la transizione.
  - dedupe locale best-effort (ultimi N fingerprint in memoria) per non riempire la coda nello
    stesso run.
  - fire-and-forget: try/catch totale, niente await bloccanti nel path UI, mai throw verso il chiamante.
  - **Endpoint**: `TELEMETRY_WORKER_URL` costante in `src/telemetry/config.ts` (override dev via
    `__DEV__` o AsyncStorage `kalsa.telemetry.url` per il mock locale nei test). Il client NON
    conosce mai token/GitHub: parla solo col Worker.
- **Cloudflare Worker** (`workers/telemetry/`, deploy separato, NON nel bundle RN):
  - `POST /report` → validazione schema STRETTA (tabella §7, campo per campo, 400 deterministico)
    → rate limit per IP (10/h) → inoltro al **Durable Object `TelemetryBuffer`** che fa in un'unica
    transazione: check-then-act dedupe, quota globale, append durevole → risponde
    `{accepted:true}` / `{accepted:false, reason:"duplicate"|"quota"}` (accepted SOLO dopo append
    durevole; nessuna firma KV pre-append che possa sopprimere per 180 gg — vedi §7).
  - **NON crea issue automaticamente.** L'issue è creata dal maintainer via `GET /flush`
    (FLUSH_TOKEN) o `gh`/script che legge il buffer dal DO, applica la dedupe finale e apre le
    issue con label `telemetry`.
  - variabili d'ambiente: `GITHUB_TOKEN` (fine-grained, permesso issues), `GITHUB_REPO`,
    `FLUSH_TOKEN`, `AUTO_OPEN_ISSUES` (flag SOLO del flush: `false` = bufferizza e basta, `true`
    = crea anche le issue — mai usato da `/report`), binding DO `TelemetryBuffer` + KV (solo dedupe).
  - NESSUN log del payload (solo firma+count); il client NON può leggere i report altrui.

## 4. Schema payload (cosa SI invia)

```ts
type TelemetryReport = {
  v: 1;                      // schema version
  app: "kalsa";
  appVersion: string;        // "0.1.0" (unica sorgente: versionName gradle, iniettata a build)
  platform: "android";
  deviceBucket: string;      // mappatura deterministica da ramTier (deviceProfile.ts): low|mid|high — MAI modello esatto
  osMajor: string;           // es. "13" (solo major)
  error: {
    code: string;            // enum allowlist: "engine.init" | "chat.generation" | "embed.native" | "web.fetch" | "web.search" | "unknown"
    detail?: string;         // ENUM VINCOLATO PER CODE (esteso, addendum diagnosability — vedi sotto):
                             //   web.fetch/web.search → "http_403"|"http_404"|"http_5xx"|"dns"|"tls"|"timeout"|"oom"|"payload_too_large"|"unknown"
                             //   engine.init → "oom"|"disk_full"|"model_corrupt"|"model_missing"|"init_timeout"|"native_crash"|"unknown"
                             //   chat.generation → "oom"|"native_crash"|"ctx_overflow"|"stop_aborted"|"unknown"
                             //   embed.native → "oom"|"model_corrupt"|"native_crash"|"gate_aborted"|"unknown"
                             // qualsiasi altra stringa → campo omesso (client E Worker)
    signal?: string;         // ADDENDUM: token di errore NORMALIZZATO via pattern allowlist — MAI testo libero.
                             // Dal messaggio reale si estraggono SOLO token noti e sicuri (regex allowlist:
                             // ENOSPC, EACCES, ENOENT, "segmentation fault", "out of memory", "file not found",
                             // "Unable to map", "ggml_*", "CUDA error", "init failed", ...). Se il messaggio
                             // NON matcha nessun pattern predefinito → campo OMESSO. Charset [A-Za-z0-9_ .-],
                             // max 80 char. Mai path/URL/nomi file/parole utente.
  };
  context: {                 // minimale, categorie, MAI contenuti
    modelCategory?: string;  // "dense.2b" | "dense.4b" | "moe" | "unknown" — MAI id completo
    memoryClass?: string;    // derivata da ramTier (deviceProfile.getRamTier): es. "lt-4gb" | "4-6gb" | "ge-6gb" — bucket fisso, testato
    hadWebTools?: boolean;   // booleano, non configurazione
    phase?: string;          // ADDENDUM: "download"|"load"|"turn"|"embed"|"flush" — dove è fallito nel flusso
    attempt?: number;        // ADDENDUM: 1-5, tentativo di invio (client) — non identificativo
    chunks?: number;         // ADDENDUM: solo per embed.native — n. chunk processati al fallimento
  };
  context: {                 // minimale, categorie, MAI contenuti
    modelCategory?: string;  // "dense.2b" | "dense.4b" | "moe" | "unknown" — MAI id completo
    memoryClass?: string;    // derivata da ramTier (deviceProfile.getRamTier): es. "lt-4gb" | "4-6gb" | "ge-6gb" — bucket fisso, testato
    hadWebTools?: boolean;   // booleano, non configurazione
  };
  dateBucket: string;        // "YYYY-MM-DD" — niente timestamp esatto
  manual: boolean;           // true = segnalazione utente esplicita
};
```

**Rimosso rispetto a v1 (quasi-identificatori):** deviceModel esatto, reportedAt esatto, uptimeSec,
hadDocs, stack trace completo, modelId esatto. Questa è la lezione dell'audit: i campi esatti sono
quasi-identificanti (hardware raro come Jelly Star è linkabile); restano solo bucket grezzi.

**Mai nel payload:** testo chat, query, nomi documenti, contenuti, API keys, docId, IP utente (il
Worker vede l'IP solo per rate-limit, non lo persiste), seriali, timestamp esatti, stack con path.

### Sanitizer al confine (`sanitizeReport`)
- Input: oggetto `{code: ReasonCode, detail?: string}` — MAI un `Error`,
  MAI un tail nativo, MAI testo tool. `detail` proviene SOLO da template fissi o allowlist.
- `detail`: ACCETTA solo valori da motivi fissi (es. `"http"`, `"dns"`, `"timeout"`, `"oom"`,
  `"disk"`); qualsiasi altra stringa (incluso il raw di `sanitizeToolErrorMessage`) viene
  scartata. Se per diagnosi serve più granularità si estende l'enum dei motivi, mai il testo.
- Nessun identificatore di sorgente o di file utente è mai incluso nel payload: i `code` enum sono
  già sufficienti per il triage; eventuale granularità aggiuntiva si aggiunge all'enum, mai al testo.
- Mappature deterministiche: `deviceBucket`/`memoryClass` da `ramTier` (deviceProfile.ts),
  `modelCategory` da ModelInfo (dense size / moe flag) — entrambe con harness dedicata.
- **Pattern allowlist `signal` (addendum diagnosability)**: dal messaggio d'errore REALE si
  estraggono solo token noti tramite regex allowlist predefinita (es. `/ENOSPC|EACCES|ENOENT|segmentation
  fault|out of memory|file not found|Unable to map|ggml_[A-Za-z0-9_]+|CUDA error|init failed/i`);
  il messaggio NON viene mai inviato, solo il token matchato. Nessun match → campo omesso.
  La allowlist cresce solo con pattern sicuri (nessun pattern che catturi path/URL/nomi).
- Harness dedicata `telemetryHarness.mjs` con casi: URL con query string, email, JWT/base64,
  path, key=, porta, hash, user-text arbitrario, lunghezza, unicode, body malformato, e
  **un caso che attesta che `sanitizeToolErrorMessage`-style testo (URL preservati) NON passa**;
  casi `signal`: "No space left on device (ENOSPC)" → `ENOSPC`; "ggml_opencl: error" → `ggml_*`;
  testo arbitrario senza token noti → campo omesso; "segmentation fault (core dumped)" →
  `segmentation fault`; URL/path dentro un messaggio → nessun token, campo omesso.

## 5. Hook points (reali, verificati a file:line)

| Codice | Punto reale | Note |
|---|---|---|
| `engine.init` | `initLlama` failure — `src/engine/LlamaService.ts:817-819` | il fallimento reale del load. NON `model.fit` (log informativo) |
| `chat.generation` | `callbacks.onError` — `src/engine/LlamaService.ts:2035` | il vero confine errore generazione; `turnTelemetry` NON ha esito errore oggi (solo contatori/timing) |
| `embed.native` | `[embed] done reason:"failed"` — emesso da `AppShell.tsx:1270-1279` | SOLO failure native vere. MAI cancellazione utente, delete, RAM-gating, cap-partial: non sono errori da reportare. Evento tipizzato `{code, reason}` SENZA docId |
| `web.fetch` / `web.search` | `src/agent/webFetchTool.ts:666-672` / `webSearchTool.ts` | solo fallimenti di rete/HTTP; **detail = motivo fisso** (`http`/`dns`/`timeout`/`unknown`), MAI il testo del tool (che preserva gli URL per il modello) |
| `unknown` | catch generici non categorizzati | mai con dettagli non sanitizzati |

**Esclusi deliberatamente:** `model.unload`/release failures (spesso swallowed a LlamaService.ts:902+,
non diagnostici per l'utente), `[embed] partial` (by design), `[embed] aborted` (cancellazione),
docOpGate, persistence failures (già gestiti localmente con Alert).

**Hook `embed.native` è da CREARE, non esiste:** oggi AppShell.tsx:1276-1279 emette un console
log `[embed] done {docId,…}` con docId — non è un evento tipizzato. Il coder deve sostituire quel
punto con l'emissione di un evento `{code:"embed.native", reason}` (senza docId) SOLO sui branch
di failure nativa (reason `failed` da init/model non riproducibile; NON `partial`/`aborted`),
consistente con la state machine EmbeddingService.

## 6. Flusso manuale (segnalazione utente) — v2, senza leak URL

Settings → "Segnala un problema" → **dialog locale** che mostra l'anteprima del report generato
(campi §4, già sanitizzati) + testo libero per l'utente → bottoni:
- **"Copy"**: copia il report formattato negli appunti (l'utente decide se incollarlo dove vuole);
- **"Open GitHub"**: apre `https://github.com/Aspis0/kalsa/issues/new/choose` (Issue Form) **VUOTA,
  senza parametri query** — niente payload nell'URL, niente leak in history/referrer/logs.

L'utente incolla il contenuto copiato nel form e lo invia lui stesso. Nessun dato lascia il device
prima del submit esplicito su GitHub. La form `telemetry_bug_report.yml` documenta i campi attesi.

## 7. Dedupe, rate limiting, buffer (Worker)

- **Firma**: SHA-256 server-side (Web Crypto, canonical JSON: `JSON.stringify` ordinato dei campi
  `code`, `detail`, `appVersion`, `deviceBucket`, `modelCategory`, `dateBucket`) → `dedupe:{sig}`,
  TTL 180 gg. Niente FNV per la firma (non crittografico, hash UTF-16): FNV-1a resta SOLO per la
  soppressione locale best-effort nel client.
- **Atomicità (KV paginato NON basta)**: due richieste concorrenti possono selezionare/aggiornare
  la stessa pagina e perdere report, e il contatore di quota globale può essere superato. Il lock
  client non risolve le race server-side. → **Durable Object `TelemetryBuffer` (scelta definitiva)**:
  unico punto di append atomico; ogni report riceve un `reportId` univoco, la quota globale è
  contata nel DO con semantica `storage.transaction()` (quota+append in UNA transazione, non solo
  blockConcurrencyWhile), la sequenza è garantita. **Storage del DO = buffer canonico** (non KV):
  KV resta solo come cache di lettura per la dedupe (TTL 180 gg); la fonte di verità è lo storage
  del DO (DO-only dedupe è più semplice: si valuta in implementazione se il KV serve).
  Cloudflare Queue è SCARTATA: non può fornire rifiuto di quota sincrono né letture arbitrarie
  del buffer per il flush. Il DO usa un **ID singleton stabile** (non random) così la "quota
  globale" è davvero globale e il flush legge UN buffer.
- **Dedupe e append atomici nel DO (niente KV pre-append)**: la firma è calcolata dal Worker, ma
  il check-then-act (dedupe → quota → append) avviene in UN'UNICA transazione `storage.transaction()`
  dentro il DO. Il KV `dedupe:{sig}` (TTL 180 gg) è solo una cache di lettura veloce per
  rispondere `duplicate` senza toccare il DO; la fonte di verità è lo storage del DO. Niente
  firma scritta prima dell'append: un fallimento append NON può sopprimere un report per 180 gg.
- **Flush crash-tollerante (best-effort, non "mai duplicati")**: ogni report nel DO ha stato
  `pending` → `creating` (lease con timeout, es. 5 min, rinnovabile con fencing token: token
  monotonico + CAS — solo il possessore del lease corrente può rinnovarla o scrivere `created`;
  mutazioni con token stantio rifiutate) → `created`.
  Il flush: (1) marca `pending→creating` con lease, (2) cerca un'issue esistente con marker
  `Telemetry signature: <sig>` nel corpo (ricerca GitHub eventualmente consistente: se fallisce
  o dà timeout, NON crea subito — rilascia la lease e riprova al giro successivo), (3) se non
  trovata, crea la issue e marca `created`. Crash tra creazione e risposta / indice non ancora
  aggiornato → il retry con lease scaduta può creare un DUPLICATO occasionale: accettato come
  best-effort (volume 50/h, raro, non bloccante) e documentato. Se in futuro serve "mai
  duplicati" assoluto, serve un meccanismo di creazione veramente idempotente (idempotency-key
  GitHub) — fuori scope ora.
- **Quota**: rate limit per IP (10/h, best-effort) + **quota globale nel DO** (es. 50 report/h) —
  oltre → `429` e il client riprova al drain successivo (backoff). L'IP non è autenticazione: su
  NAT carrier penalizza utenti innocenti, quindi la quota globale nel DO è il vero freno.
- **Flush**: endpoint protetto **`GET /flush`** sul Worker, auth con header
  **`Authorization: Bearer <FLUSH_TOKEN>`** (MAI token in query string), maintainer-only.
  **Fail-closed**: se `FLUSH_TOKEN` non è configurato, `/flush` risponde `503` (mai accettare
  token assente/undefined); il deploy senza token è un errore documentato nel README.
  **`AUTO_OPEN_ISSUES` (flag SOLO flush, mai `/report`) — transizioni esatte**:
  - `false` (default): il flush marca i report con **`reviewAck=true`** (nessuna ricerca/creazione
    issue, nessuna chiamata GitHub) e risponde `{reviewed:N}`. Lo stato di eleggibilità `pending`
    è PRESERVATO (modello unico: `pending` è l'unico stato di eleggibilità; `reviewAck` è un
    flag di revisione separato, non uno stato). Se il flag viene poi portato a `true`, i report
    con `reviewAck=true` tornano eleggibili: il flush `true` ignora/azzera solo l'ack e procede
    con l'algoritmo completo. Nessuna transizione di stato può rendere un report permanentemente
    non eleggibile.
  - `true`: il flush esegue l'algoritmo completo (lease → cerca per firma → crea → `created`,
    con politica index-lag sotto).
  Alternativa per il maintainer: `wrangler` con credenziali CF + `gh issue create` (token nel
  terminale del maintainer, MAI nel client).
  **Politica index-lag GitHub (conflitto "cerca-non-trova → crea" vs "indice non aggiornato")**:
  l'index-lag è indistinguibile dall'assenza. → su ricerca con esito "nessuna issue", il flush
  NON crea subito: marca `pending→creating` con lease e ripete la ricerca UNA seconda volta dopo
  un breve ritardo (es. 2 s); se anche la seconda non trova, crea la issue. Duplicati rari da
  index-lag estremo → accettati come best-effort e documentati (vedi §7 flush crash-tollerante).
  **URL di produzione**: documentato nel README (wrangler custom domain/routes, workers_dev OFF);
  client con `TELEMETRY_WORKER_URL` non configurato (unset) → telemetria disabilitata
  silenziosamente (nessun fallback a endpoint sconosciuti).
- **Validazione Worker (tabella esatta, 400 deterministico)**:

  | Campo | Regola | Lunghezza max |
  |---|---|---|
  | `v` | ==1 | — |
  | `app` | =="kalsa" | — |
  | `platform` | =="android" | — |
  | `appVersion` | stringa | 32 |
  | `deviceBucket` | enum `low\|mid\|high` | — |
  | `osMajor` | `^\d+$` | 8 |
  | `error` (oggetto) | richiesto, non null | — |
  | `error.code` | enum §4, richiesto | — |
  | `error.detail` | enum per-code §4: il CLIENT lo OMETTE se non ammesso; se PRESENTE con valore
  non valido nel body, il WORKER risponde `400` | — |
  | `error.signal` | pattern allowlist §4 (regex predefinita), opzionale — il CLIENT OMETTE se
  non matcha; il WORKER rifiuta `400` se presente ma non conforme | 80 |
  | `context` (oggetto) | richiesto, non null | — |
  | `context.modelCategory` | enum §4, opzionale | — |
  | `context.memoryClass` | enum `lt-4gb\|4-6gb\|ge-6gb\|unknown`, opzionale | — |
  | `context.hadWebTools` | boolean, opzionale | — |
  | `context.phase` | enum `download\|load\|turn\|embed\|flush`, opzionale | — |
  | `context.attempt` | intero 1-5, opzionale | — |
  | `context.chunks` | intero 0-100000, opzionale (solo embed.native) | — |
  | `dateBucket` | `^\d{4}-\d{2}-\d{2}$` + data di calendario valida | 10 |
  | `manual` | boolean, richiesto | — |

  Ogni campo non valido, chiave sconosciuta (anche annidata), o campo richiesto mancante →
  **`400` deterministico senza side-effect**. **Limite body raw: 4 KB (oltre → 413)**.
  Il client scarta i payload 400 e NON li riprova. Il client sanitizer non è confine di fiducia.
- **Abuso**: body non validi → 400 senza side-effect; firme identiche → dedupe; oltre quota → 429.
  Spoofing di payload (chiunque può POSTare) resta possibile ma senza conseguenza: al massimo un
  report finto nel buffer che il maintainer filtra. Nessuna issue automatica pubblica = niente spam.

## 8. Privacy UX e i18n

- Settings, sezione Privacy: riga **"Telemetry"** con `Switch` (pattern Web toggle, default OFF):
  - OFF: "Off by default. **No telemetry leaves this device.**"
  - ON: "Pseudonymous error reports are sent to help fix bugs. Chats, documents and keys never leave this device."
- Alert al primo opt-in: elenca cosa viene inviato (categorie §4) e cosa NO (chat/docs/keys mai,
  niente dati esatti del device).
- **Disattivazione = purge crash-safe**: il toggle OFF cancella immediatamente i dati locali
  (coda + dead-letter + toggle + generation). **Envelope unico + journal a due slot (v13/v14)**: lo
  stato vive in UN UNICO envelope `kalsa.telemetry.state` `{v:1, enabled, generation,
  queue:[...], dead:[...], transitionEpoch, integrity}` con **marker d'integrità** (hash FNV-1a
  del contenuto) e scrittura **journal a due slot**: TRE chiavi fisiche —
  `kalsa.telemetry.state.A`, `kalsa.telemetry.state.B` (slot con envelope completo + hash +
  `seq` monotona) e `kalsa.telemetry.state.pointer` (ultimo slot attivo). Ogni write: scrive lo
  slot inattivo (seq+1), poi aggiorna il pointer. **Selezione al load (regola semplice)**: si
  sceglie SEMPRE lo slot con `seq` maggiore tra quelli con hash valido (il pointer è solo un
  hint di lettura veloce, mai autoritativo — chiude il caso "pointer valido ma vecchio dopo
  crash tra slot e pointer write"); se entrambi corrotti → **reset totale fail-closed**
  (telemetria OFF, coda vuota, generation++, MAI inviare dati parziali). `transitionEpoch` è
  dentro l'envelope hashed (coperto dall'integrity). **Tombstone opt-out durevole**: alla
  disattivazione, oltre al purge, si scrive `kalsa.telemetry.optedOut` (con timestamp + marker
  di integrità, journal come l'envelope) PRIMA di qualsiasi altra operazione; a ogni avvio, se
  il tombstone esiste (valido), la telemetria parte OFF e ogni envelope residuo viene scartato
  — un failed-OFF (crash a metà) non può lasciare un envelope `enabled:true` inviabile al
  restart. Una scrittura tombstone incerta/fallita/parziale (torn) → trattata come
  **fail-closed**: telemetria OFF (mai inviare senza tombstone valido in stato di incertezza).
  **Lifecycle tombstone + ordinamento ON (v14)**: il tombstone NON viene mai cancellato da solo;
  la ri-abilitazione segue l'ordine: (1) scrivere durevolmente l'envelope `enabled:true`
  (journal, hash ok), (2) SOLO DOPO, cancellare il tombstone. **Gate in-memory (v14 FINAL)**: le
  operazioni (1) e (2) avvengono sotto lo STESSO mutex e con un gate in-memory `tombstoneGate`
  che resta attivo finché (2) non è completo: enqueue e drain verificano il gate — nessun invio
  tra (1) e (2). Il tombstone vince SEMPRE al load: se presente → OFF + scarto envelope, anche
  se l'envelope dice `enabled:true`. Se il clear del tombstone fallisce → la ri-abilitazione
  NON è committata (l'envelope scritto al passo (1) viene ripristinato a OFF; fail-closed verso
  la privacy, mai inviare dati con tombstone presente). Test crash per entrambi i passi (kill
  dopo (1) prima di (2); clear fallito). Test aggiuntivi: iniezione failure a metà write (mock
  setItem che scrive parziale poi lancia) → slot corrotto rilevato dall'hash → altro slot o
  reset; failed-OFF restart → tombstone presente → OFF + scarto envelope; envelope valido-ma-
  misto → si usa lo slot con seq maggiore valido, mai un mix; tombstone torn → OFF fail-closed;
  gate: nessun invio tra (1) e (2).
- **Precedenza normativa finalizer (chiarimento v11)**: QUALSIASI generation mismatch (toggle
  cambiato tra invio e risposta, a prescindere dallo stato corrente) → drop terminale di OGNI
  esito (riuscito/fallito) e MAI scrittura in coda o dead-letter. Solo finalizzazioni con
  generation corrente possono riaccodare/dead-letterare. Questa regola SOSTITUISCE ogni
  formulazione precedente tipo "drop/riaccoda secondo lo stato al momento della risposta".
- **Race toggle OFF vs drain/enqueue in-flight**: stato toggle, generation, enqueue e purge sono
  serializzati sotto lo STESSO mutex. Un enqueue con generation stantia (catturata prima di un
  toggle OFF) viene RIFIUTATO e il payload eliminato, anche se il toggle torna ON dopo (nessun
  payload sopravvissuto al purge può essere inviato dopo un ri-abilitazione). **Il mutex NON è
  tenuto attraverso il `fetch()`**: il drain (1) acquisisce il mutex, (2) **crea PRIMA
  l'`AbortController`**, (3) in un'unica sezione atomica sotto mutex fa gate (toggle ancora ON +
  generation corrente) → registra il controller nel registro globale di cancellazione → rimuove
  l'item dalla coda e lo marca `sending` (lease persistita, es. 60 s), (4) rilascia il mutex e
  subito dopo invoca `fetch()` con timeout (10 s). Un toggle OFF o il passaggio in background
  chiama `abort()` sul registro: se il fetch non è ancora partito, la richiesta non parte MAI;
  se è in-flight, viene abortita (nessuna nuova richiesta, nessun retry).
  **Loss-less su fallimenti ordinari**: solo le cancellazioni da **transizione utente/background
  (abort con causa `transition`)** sono drop intenzionali: l'item `sending` viene marcato
  `dropped` (drop TERMINALE persistito, non riaccodabile — mai contraddire "nessun retry dopo la
  transizione"). **Classificazione risposte COMPLETA**: `400`/`413` e OGNI altro `4xx` non-`429`
  (401/403/404/…) → drop definitivo (non ritentabile); `429` → backoff e ritentabile; `5xx`/
  timeout/`rete assente` → l'item viene RIACCODATO (lease `sending` scaduta o requeue esplicito)
  e ritentato al drain successivo con **backoff esponenziale + jitter** (30s × 2^n, cap 1h) e
  **retry ceiling ESATTAMENTE 5 tentativi** per ogni payload ritentabile (incluso `429`): oltre
  → dead-letter locale (dentro l'envelope `kalsa.telemetry.state`), con contatore per payload,
  **cap 100 entry,
  TTL 30 giorni e TTL enforcement su load/write/drain** (le entry scadute vengono espunte a ogni
  accesso agli store; oltre il cap → drop). Crash del processo dopo il dequeue ma prima della
  risposta → al riavvio la lease `sending` è scaduta e l'item torna in coda (riprova; dedupe lato
  Worker protegge dai duplicati).
  **Abort/background crash-atomic (v14)**: `abort(transition)` + persistenza di `dropped` non è
  atomica — un kill dopo l'abort ma prima del persist può lasciare una lease `sending` scaduta
  che al restart verrebbe riaccodata (violando "no retry dopo background"). →
  **transition-intent/epoch barrier (v14)**: PRIMA di abortire QUALSIASI fetch, si persiste
  durevolmente `transitionEpoch+1` (barrier commit via journal); SOLO dopo il commit della
  barrier si eseguono gli abort e si marcano gli item con l'epoch nuova. Un kill in qualsiasi
  punto → al restart: se la barrier è committata, l'epoch è nuova e ogni item `sending` con
  epoch vecchia → drop terminale (mai requeue); se il kill avviene PRIMA della barrier, nessun
  abort è ancora avvenuto → gli item `sending` sono legittimi e tornano in coda (requeue
  normale, coerente: la transizione non era iniziata). La barrier è parte dell'envelope hashed
  (journal a due slot, stesso protocollo di recovery). **Per-item transitionEpoch (v14 FINAL)**: ogni
  entry dell'envelope porta `transitionEpoch` (oltre a `generation`); il finalizer controlla
  l'epoch della entry PRIMA di processare qualsiasi risposta: entry con epoch ≠ epoch corrente
  → drop terminale, prima ancora del controllo generation. Test: kill prima/dopo ogni boundary
  di persistenza (prima della barrier, tra barrier e abort, tra abort e persist item).
  **Retry ceiling semantics**: `retryCount` parte a `0` al primo invio; `retryCount++` a ogni
  esito ritentabile (`5xx`/timeout/`429`); si ritenta finché `retryCount < 5` (il primo invio
  conta come tentativo 0, quindi al massimo 5 invii totali); a `retryCount == 5` → dead-letter.
  **Crash-proof ceiling (v14 FINAL)**: `retryCount` viene persistito (nell'envelope) quando
  l'item passa a `sending` (prima del dispatch), così i crash dopo il dequeue contano verso il
  ceiling e ripetuti crash non possono superare i 5 invii.
  **Rilascio mutex e pulizia in `finally`**: il mutex viene sempre rilasciato in `finally`, e il
  `AbortController` viene rimosso dal registro di cancellazione in `finally` dopo la risposta.
  **Precedenza finalizer**: QUALSIASI generation mismatch (toggle cambiato tra invio e risposta,
  a prescindere dallo stato corrente) → drop terminale di OGNI esito (riuscito/fallito) e MAI
  scrittura in coda o dead-letter (regola normativa, vale anche per OFF→ON durante `5xx`/timeout:
  nessuna scrittura in queue o dead-letter di dati pre-opt-out). Solo finalizzazioni con
  generation corrente possono riaccodare/dead-letterare.
  Test: OFF durante enqueue → ON di nuovo → nessun vecchio payload inviato; fetch appeso → timeout
  e requeue; 5xx persistente → backoff poi dead-letter; 400/413/401/403 → drop definitivo;
  `429` oltre il ceiling → dead-letter; crash post-dequeue → riavvio riaccoda; background durante
  fetch → abort `transition` e drop terminale.
- **Nessuna revoca server-side**: un report già accettato dal Worker non può essere richiamato
  dopo l'opt-out (nessuna API di delete). La copy dell'Alert lo dice esplicitamente. Il purge
  locale è l'unico controllo.
- **Copy manuale qualificata**: la garanzia "chat/documenti/chiavi non lasciano mai il device"
  vale per la telemetria AUTOMATICA. Il flusso manuale (§6) è sotto il controllo esplicito
  dell'utente: il dialog avverte "non incollare contenuti sensibili — questo testo va su GitHub
  pubblico" prima del Copy/Open. La copy dell'Alert opt-in lo specifica.
- **Disclosure provider/IP**: il Worker non persiste l'IP, ma Cloudflare (infrastruttura di rete)
  mantiene i propri log di richiesta (indirizzo IP, timestamp) secondo le sue policy di retention
  — fuori dal nostro controllo. La copy dell'Alert include una riga: "network provider logs
  (Cloudflare) may briefly record connection metadata; we don't store your IP in the report".
  In DoD: verificare che la copy contenga questa riga.
- Aggiornare `privacyBody` en+it (esistente: "There is no account and no cloud sync." → aggiungere
  "Telemetry is off by default and opt-in.") — parità profonda en/it (typeof + key-set runtime check
  nell'harness i18n, NON solo TypeScript).
- Nuove chiavi en+it: `settings.telemetry`, `settings.telemetryBody`, `settings.telemetryOptInTitle/Body`,
  `settings.reportProblem`, `settings.reportProblemBody`, `settings.reportCopied`.

## 9. Implementazione (file)

| File | Contenuto |
|---|---|
| `src/telemetry/telemetry.ts` | `sanitizeReport()`, envelope unico `kalsa.telemetry.state` (queue+dead+toggle+generation, crash-safe), `reportTelemetry()` fire-and-forget, drain con lock, purge su OFF, cap 50, FNV locale best-effort |
| `src/telemetry/config.ts` | `TELEMETRY_WORKER_URL` (override dev `kalsa.telemetry.url`) |
| `scripts/harnesses/telemetryHarness.mjs` | sanitizer (URL/path/key/porta/hash/unicode/lunghezza), queue (cap, purge, malformed, concurrent drain), toggle persist, never-throw |
| `src/app/AppShell.tsx` | hook toggle (pattern `WEB_TOOLS_ENABLED_KEY`), wiring hook points §5 → `reportTelemetry` con evento tipizzato (no docId) |
| `src/screens/SettingsScreen.tsx` | riga Telemetry + Switch + Alert opt-in + "Segnala un problema" (dialog locale §6) |
| `src/engine/LlamaService.ts` | `initLlama` failure + `onError` → report (solo categorie) |
| `src/agent/webFetchTool.ts` / `webSearchTool.ts` | failure rete → report (detail già sanitizzato) |
| `src/i18n/en.ts` `it.ts` | chiavi §8 + privacyBody aggiornato, parità profonda |
| `scripts/harnesses/i18nParityHarness.mjs` | **aggiungere** deep parity runtime (recursive key-set en↔it sull'intero catalogo, non solo sottogruppi come oggi) |
| `src/engine/deviceProfile.ts` | (riuso, senza modifiche se possibile) `ramTier`/`getRamTier` come fonte per `deviceBucket`/`memoryClass` |
| `workers/telemetry/index.ts` | CF Worker: POST /report (validazione STRETTA a schema completo, enum code/detail/bucket, regex, 400 deterministico), dedupe KV SHA-256, rate IP + quota globale; **Durable Object `TelemetryBuffer`** (ID singleton stabile) come buffer canonico; GET /flush protetto (FLUSH_TOKEN) → issue GitHub idempotenti; `/report` non crea mai issue |
| `workers/telemetry/flush.mjs` | script maintainer (alternativa): `wrangler` + `gh issue create`, dedupe finale con firme persistite, label `telemetry` |
| `workers/telemetry/wrangler.toml` | KV binding (solo cache dedupe), **DO binding + migrazione class `TelemetryBuffer`**, env vars (`GITHUB_TOKEN`, `GITHUB_REPO`, `FLUSH_TOKEN`, `AUTO_OPEN_ISSUES`) |
| `package.json` | script `telemetry:flush` (chiama `GET /flush` con FLUSH_TOKEN, oppure flush.mjs) |
| `workers/telemetry/README.md` | deploy, DO/KV namespace, token fine-grained, staging, `TELEMETRY_WORKER_URL` da usare nel client |
| `.github/ISSUE_TEMPLATE/telemetry_bug_report.yml` | Issue Form (vuota, documenta i campi) |
| `docs/TELEMETRY_OPTIN.md` | questo documento |

## 10. Test plan (Jelly)

1. Typecheck + harnesses (telemetry + i18n parity profonda + tutti esistenti).
2. Build release APK (versione unica da gradle, verificata nel payload), install su Jelly.
3. **Toggle**: default OFF → nessuna chiamata di rete al Worker (monitor logcat).
4. **Opt-in**: ON → Alert copy (incluso: "reports già inviati non possono essere richiamati") → conferma.
5. **Errore simulato**: fetch URL non valido (web.fetch) + un errore embed nativo se riproducibile →
   payload sanitizzato inviato. **Ispezione payload**: proxy/mock locale (NON logcat — il payload
   non va loggato in chiaro): verificare che i campi siano solo §4, senza URL/path/chat/doc;
   in particolare che il detail web.fetch sia il motivo fisso (`http`) e NON l'URL.
5b. **Race OFF in-flight**: coda piena, toggle OFF mentre un drain/enqueue è in corso → nessun POST
   dopo il purge, anche se il toggle torna ON (mutex + stale-generation + AbortController; test in
   harness + device). OFF→ON durante risposta `5xx`/timeout → drop terminale (mai requeue/
   dead-letter di dati pre-opt-out); purge atomico di queue E dead-letter. Background: app in
   background a metà drain → nessun invio (gate AppState).
5c. **Tool-detail redaction**: harness `sanitizeReport` con testo stile `sanitizeToolErrorMessage`
   (URL preservati) → campo `detail` omesso. Worker: POST con detail non-enum O chiave sconosciuta
   O bucket non valido → 400 deterministico senza side-effect.
5d. **Idempotenza e crash**: worker con append che fallisce → `accepted` NON risposto, nessuna
   firma KV pre-append, client riprova; flush con crash tra lease e creazione issue → retry adotta
   l'issue esistente per firma, duplicati occasionali accettati come best-effort, mai report persi.
5e. **Classificazione risposte client**: `400`/`413`/ogni `4xx` non-`429` → drop definitivo;
   `429` → backoff (soggetto al ceiling); `5xx`/timeout → requeue con backoff esponenziale;
   ceiling ESATTAMENTE 5 tentativi → dead-letter (in envelope, cap 100, TTL 30 gg,
   expunge su load/write/drain). OFF→ON durante una risposta `5xx` → drop terminale, niente
   requeue/dead-letter di dati pre-opt-out. OFF purga anche il dead-letter.
5f. **Client crash dopo dequeue**: kill processo dopo la rimozione dalla coda → al riavvio lease
   `sending` scaduta → item riaccodato e ritentato (dedupe Worker protegge).
6. **Dedupe**: stesso errore due volte → secondo `{accepted:false, reason:"duplicate"}`; il client
   scarta e NON riprova.
7. **Offline**: rete OFF → payload in coda; rete ON → drain (una volta sola, lock).
8. **Purge**: toggle OFF con coda piena → coda svuotata (verificare AsyncStorage).
9. **Manuale**: Settings → Segnala un problema → dialog con anteprima → Copy + Open GitHub →
   form VUOTA, niente payload nell'URL (ispezionabile).
10. **Worker (staging)**: deploy su repo/account di test con prerequisiti documentati (Worker URL,
    DO ID/binding, FLUSH_TOKEN, KV namespace) → body malformato/detail non-enum/chiave sconosciuta/
    `error` o `context` non-oggetto o null/data di calendario invalida → 400 senza side-effect;
    body > 4 KB → 413; quota globale → 429; `/flush` senza FLUSH_TOKEN → 503; **append
    concorrenti** (N POST paralleli) → nessun report perso (DO atomico); `GET /flush` con
    FLUSH_TOKEN → issue deduplicata con label `telemetry`; `/report` NON crea mai issue nemmeno
    con `AUTO_OPEN_ISSUES=true` (flag solo flush); ricerca GitHub timeout/index-lag → lease
    rilasciata, nessuna issue creata, retry al giro successivo.
11. **Issue reale (passo di accettazione maintainer, NON parte del test automatizzato)**: il
    maintainer esegue il flush sul repo Aspis0/kalsa da un report di test → verifica manuale che
    compaia una sola issue per firma con label `telemetry`.

## 11. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Spoofing endpoint (POST finti) | nessuna issue automatica pubblica (buffer+maintainer); rate IP + quota globale; body validazione stretta |
| Dati sensibili in detail | sanitizer al confine con harness; SOLO enum code + detail ripulito; niente stack/path/URL |
| Queue cresce senza rete | cap 50 drop-oldest + drain con lock + purge su OFF |
| Quasi-identificazione (Jelly raro) | bucket grezzi (deviceBucket, memoryClass, dateBucket), niente timestamp/modello esatti; copy "pseudonymous" |
| Firma collisioni/soppressione cross-modello | SHA-256 canonico con `modelCategory` nella firma; soppressione cross-model accettata e documentata |
| KV eventual consistency | duplicati rari → dedupe finale nel flush |
| Perf UI | fire-and-forget, niente await nel path UI, try/catch totale |
| NAT carrier penalizza IP | quota globale come freno vero + backoff client |
| DoD richiede deploy Worker | staging repo + flag `AUTO_OPEN_ISSUES`; il flush finale è un passo eseguibile a mano |
| **Residui accettati (audit chiuso v14, decisione utente)** | duplicati issue rari da index-lag estremo (best-effort); ri-abilitazione con clear tombstone fallito resta OFF (fail-closed, l'utente riprova); ceiling crash-proof conta i crash verso i 5 invii (niente invii infiniti, ma un payload molto sfortunato può finire in dead-letter più in fretta) |
| **Diagnosability (addendum 2026-08-12)** | la granularità arriva da enum detail estesi + `signal` allowlist + `phase`/`attempt`/`chunks` — se un bug non è coperto da un pattern noto, il report è comunque utile a livello di categoria (code+detail+bucket) e si estende la allowlist/enum nel prossimo rilascio |

## 12. Fuori scope (follow-up)

- Telemetria iOS (solo Android ora).
- Analytics d'uso (mai — escluso per decisione).
- Invio manuale via Worker (solo Issue Form + Copy, come da §6).
- Dashboard/metriche sul Worker.
- Autenticazione client (HMAC/device registration): costo alto, beneficio basso dato il buffer
  maintainer — riconsiderare solo se il volume di spoofing diventa reale.

## 13. Definition of done

- Toggle telemetria in Settings (en+it parità profonda), default OFF, persistito, Alert opt-in con
  copy onesto ("pseudonymous" + disclosure Cloudflare + avviso manuale), **purge crash-safe
  dell'envelope unico (queue+dead+toggle+generation, journal a due slot + tombstone) alla
  disattivazione, con test di recovery**.
- `sanitizeReport()` con harness verde: nessun URL/path/key/porta/hash/chat/doc/identificatore
  sorgente supera il confine; `signal` produce SOLO token allowlist (mai testo libero); enum
  detail estesi per-code; contesto `phase`/`attempt`/`chunks` presente nei report rilevanti.
- Errori automatici → POST Worker → buffer nel DO (dimostrato su Jelly con errore simulato e mock
  locale per ispezione payload senza log).
- `telemetry:flush` su staging crea issue deduplicata (label `telemetry`); DoD finale: una issue
  reale su Aspis0/kalsa da report di test.
- Segnalazione manuale → dialog locale + Copy + Open GitHub form VUOTA (nessun payload nell'URL).
- Copy Alert completa: cosa viene inviato, cosa NO, "a report already in transit may still arrive",
  riga disclosure Cloudflare (provider log). Verificata in en+it.
- Typecheck + harnesses verdi; APK release installato e testato.
