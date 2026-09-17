# LOG — diario di lavoro (in italiano)

## Giro 1 — scheletro, token verdi, stato vuoto (2026-09-17)

### Contrasto verificato con script (scripts/palette.mjs, WCAG 2.1, AA >= 4.5)

Accento `#1F5F4E` -> oklch(L=0.4397 C=0.0707 h=3.0047). Stati solo in
chiarezza, stessa tinta: hover `#125545` (L-0.035), pressed `#024B3B`
(L-0.07). Accento scuro `#75B3A0` (stessa tinta, L=0.72).

Chiaro (fondo `#F4F8F3` / bianco / `#E8EAE7`):
ink 15.53 · ink-soft 11.67 · silence 5.97 · silence/bianco 6.41 ·
accento-testo 6.98 · bianco/accento 7.49 · bianco/hover 8.71 ·
bianco/pressed 10.13 · danger `#8A3B32` 7.11/7.63.
Scuro (superfici `#1A211C`/`#232C26`/`#111613`):
ink 14.17 · ink-soft 10.19 · silence 6.40 · silence/muted 5.60 ·
accento-testo `#75B3A0` 6.82 · page/accento 7.59 · danger `#D89C92` 7.11.
22/22 PASS, `palette.mjs` esce 0.

### Giudizio verde (trio: codice + mezzaluna + composer in 02/03)
L'accento resta su manda/focus/link/punto attivo; il codice resta neutro
(inchiostro+bordi). Nessuno scontro: **cambio il nulla**, tengo accento e
codice così. Rosso errori `#8A3B32` desaturato, solo testo+bordo, mai fondo.

### Costruito
Vite+React+TS, store conversazioni isolato in `src/lib/store.ts`
(localStorage write-through), settings+tema in `src/lib/settings.ts`,
client SSE in `src/lib/chat.ts`, `crescentLayout.ts` portato pari pari da
devboule-v2 (stessa matematica, punti in % per larghezze < 880px),
CrescentNav/Composer/Thread+Markdown/CodeBlock/Settings/EmptyState,
tema chiaro+scuro, `aria-live` di stato, mock SSE + driver Playwright.

### Buttato (e perché)
1. **Sniffing del tipo figlio in `<pre>`** (child.type === "code"):
   con react-markdown v9 il figlio è un function component, mai la stringa
   "code" — i blocchi uscivano senza header/copia (visto in screenshot).
   Sostituito con ricetta v9: `pre` sbuccia il wrapper, `code` decide
   blocco vs inline da `className`/newline.
2. **`scroll-behavior: smooth` sul thread**: lottava col pinning per-token —
   gli scroll intermedi marcavano `pinned=false` e il pill "Back to latest"
   restava orfano a stream finito (visto in screenshot). Scroll istantaneo.
3. **Cleanup mock su `req.on("close")**: scatta anche a fine body normale e
   uccideva l'intervallo prima del primo tick — stream mai partito, 0 byte.
   Spostato su `res.on("close")` + flag `finished`.
4. **`document.documentElement` negli init script di seeding**: a quel punto
   è `null`, il throw abortiva il seed e i settings risultavano null (il
   driver apriva i Settings all'invio). Ora con guardia.
5. **`getByLabel("Message")` nel driver**: matcha per sottostringa anche il
   bottone "Send message" (strict violation). Ora `getByRole("textbox")`.
6. **Terracotta**: scartata per correzione brief — struttura token di
   devboule sì, colori no. Scala verde derivata in oklch (script sopra).

### Dipendenze aggiunte (motivo + licenza)
- `react-markdown` (MIT) + `remark-gfm` (MIT): rendering Markdown/GFM
  dell'assistente — tabelle, task list, strikethrough inclusi.
- `@playwright/test` (Apache-2.0, solo dev): driver screenshot reali.
  Nient'altro: niente highlight.js (blocchi stilati a mano), niente
  virtual-list (per ora `content-visibility: auto`).

### Voti onesti, giro 1
leggibilità 4 · gerarchia 4 · spaziatura 4 · movimento 3 (pin ok, arco in
movimento ancora da giudicare) · stato d'errore 4 (rete visto e buono;
401/stop ancora da vedere) · coerenza token 5.

### Regola operativa (imparata a spese mie)
Comandi rete sempre limitati: `curl --max-time` + `| head`, mai client che
aspettano `end` su SSE. In node, autodistruzione con `setTimeout` come prima
riga. Il tool-bash non uccide i foreground appesi.

## Giro 2 — 401, stop, markdown pesante (2026-09-17)

Nessuna modifica all'app: i tre stati erano già a posto e gli screenshot
lo confermano (04-heavy, 05-denied, 06-stopped).

- 04: titoli Georgia, liste annidate, tabella con header muto, citazione con
  filetto, link in accento sottolineato, `inline code` a chip. L'accento
  accanto al mono non stride — secondo sì al giudizio verde del giro 1.
- 05: 401 in italiano tecnico-umano, niente trace, due azioni
  (Riprova / Apri impostazioni). Titolo conversazione derivato dal primo
  messaggio anche a fallimento — tenuto, è corretto.
- 06: stop dopo ~2s, testo parziale troncato a metà parola, nota onesta
  "Stopped early", composer tornato a invio. Specifica rispettata.
- Nota per più avanti: dopo uno stop non c'è "riprendi da qui", solo
  riscrivere. Accettato per ora, non è fra i 12 stati.

Voti: heavy 5/5/5 · 401 (stato d'errore) 5 · stop 5. Lo stato d'errore sale a 5.

## Giro 3 — mezzaluna ×20, 200 messaggi, 700/1800px, thread scuro (2026-09-17)

- 07: venti conversazioni sull'arco, paginazione ‹ ›, titoli lunghi con
  ellissi. Trovata collisione fra label a 100px (ereditati da devboule,
  dove i nomi sono corti): con sei punti su ~460px i 100px si toccano.
  **Fix**: `CONVERSATION_LABEL_MAX_WIDTH = 78` nel componente, geometria
  dell'arco intatta. Riverificato in screenshot: tutto chiaro, frecce
  libere.
- Tastiera verificata con driver: ArrowRight pagina (label 1→2), Escape
  chiude (0 nodi aperti). Focus va alle frecce/punti come in Shell.tsx.
- 08: 200 messaggi, apertura in coda, ritmo regolare, `content-visibility`
  al suo posto. Niente virtual-list vera per ora — da rivalutare se il
  driver mostrerà lentezza (fin qui no).
- 09/10: 700px tiene (topbar affollata ma intera, codebox dentro), 1800px
  resta a misura, mai full-bleed. Nessun fix.
- 11: thread scuro curato quanto il chiaro — link, code, tabella, bolla.
  Il danger scuro resta solo da numeri (7.11): 401 in dark da vedere.

Voti: mezzaluna 5 · lunga 4 · stretta 4 · larga 5 · scuro 5. Movimento sale a 4.

## Giro 4 — attesa primo token, 401 scuro, copia, incollone, reduced-motion (2026-09-17)

Mock esteso con scenario `patient` (primo token dopo 1.5s) per rendere
osservabile l'attesa — senza, i 45ms dello slow la nascondevano.

- 12: tre puntini quieti + stop armato, niente spinner. Specifica tempi ok.
- 13: 401 scuro — il rosso desaturato convive col verde, niente semaforo.
  Danger scuro promosso da numeri a screenshot.
- 14: bottone copia conferma "Copied" in accento, 1.6s.
- 15: 5000 righe incollate, composer tappato a 200px con scroll interno,
  layout fermo, invio attivo. Nessun salto.
- 16: `prefers-reduced-motion: reduce` — lo stream resta leggibile, le
  transizioni congelate non rompono nulla (regola globale in base.css).
- Buttato: niente da buttare in questo giro — tutto verificato al primo colpo.

Voti: attesa 5 · 401-scuro 5 · copia 5 · incollone 5 · reduced 5.
Tutti i 12 stati + extra stanno a 4-5: dal prossimo giro si alza il metro.

## Giro 6 — flussi veri: recovery dopo 401, cambio chat in streaming (2026-09-18)

- 21: 401 -> "Open settings" -> endpoint corretto -> Save -> "Try again"
  -> risposta in codice completa. Il giro dell'errore si chiude.
- 22: cambio conversazione mentre l'altra genera — thread sostituito,
  stop globale ancora armato, nessuno stato corrotto. Il flusso in
  background continua sullo store e ritrova la sua chat al ritorno.
- Buttato: niente.

Voti: recovery 5 · switch 5.

## Giro 7 — mezzaluna: pochi punti, punto attivo, finestra stretta (2026-09-18)

- 23: tre punti sull'arco intero — arioso, voluto, non perso. La matematica
  di devboule resta intatta: guardato, tenuto.
- 24: punto attivo in accento fra punti bianchi + thread dimmato dietro.
  Il giudizio accento-su-arco: promosso, niente da cambiare.
- 25: a 700px c'era overflow orizzontale di 60px (body scrollWidth 760 su
  700): il `.crescent-glow` sborda di 60px per lato by design e allargava
  l'area scrollabile. **Fix**: `overflow-x: clip` su `.shell` (il glow è
  decorativo). Riverificato: tutto dentro, freccia › intera.
  Misurato, non indovinato: probe con getBoundingClientRect prima/dopo.

Voti: pochi 5 · attiva 5 · stretta-aperta 5 (dopo fix).

## Giro 8 — a11y funzionale, Tauri, regressione totale (2026-09-18)

- Live region verificata via driver, non solo a codice: durante l'attesa
  dice "Responding. Waiting for the first word.", ai token "Responding.",
  a fine "Response complete.".
- Tauri: CLI 2.0.0 provata funzionante (`npx @tauri-apps/cli --version`, via
  background+poll con kill esplicito). Lo scaffold Rust completo
  (`tauri init`: icone, Cargo project) NON fatto di proposito: il frontend
  rispetta già tutti i vincoli (base relativa, niente API Node, solo
  fetch) e `@tauri-apps/api` resterebbe una dipendenza inutilizzata.
  Quando Marco vorrà il bundle, `tauri init` + build è il passo.
- Regressione: tutti i 27 screenshot rigenerati dopo `overflow-x: clip` —
  dialog fixed intatto, nessuno scostamento altrove (verificati a vista
  settings + streaming, gli altri per assenza di errori driver).

Voti: a11y 5 · tauri-readiness 4 (frontend pronto, bundle da fare) ·
regressione verde.

## Giro 9 — coda vuota dopo reload + timestamp invisibili (2026-09-18)

- Bug vero, trovato leggendo: risposta fallita + reload = riga assistente
  vuota senza retry (lo stato d'errore è effimero, il messaggio resta).
  **Fix**: `effectiveFailed` derivato in App — coda assistente vuota senza
  stream = riprovabile, causa originale ignorata (il retry riesegue tutto,
  una causa vecchia mentirebbe). 26-missing + click "Try again" -> stream
  vero ("STREAMED OK" dal driver).
- Timestamp dei messaggi in `title` (hover nativo, zero UI, zero bottoni).
- Buttato: l'idea di persistere il `kind` d'errore — una riga in più sullo
  store per un dato che il retry rende inutile.

## Giro 10 — maniglia della mezzaluna trovabile (2026-09-18)

- Problema: da chiusa, la mezzaluna è un trattino grigio con 0 come con 20
  conversazioni — per la persona non tecnica è invisibile.
  **Fix**: con conversazioni esistenti il trattino prende un filo d'accento
  (0.55) + `aria-label` con conteggio ("Show 12 conversations"). Resta un
  trattino: aprire resta un gesto deliberato. 27-sliver.
- Il cambio ha rotto il driver due volte (label esatta -> regex, poi
  singolare/plurale): ora `/Show.*conversation/`. Quarta istanza della
  stessa lezione sui selettori — da qui in poi solo regex/exact.

## Giro 11 — mezzaluna scura aperta (2026-09-18)

Mai fotografata prima. 28-dark-nav: punti leggibili, attiva in accento
schiarito con glifo scuro, label chiare, glow verde-notte coerente.
Nessun fix — il tema scuro resta curato quanto il chiaro.

## Giro 12 — movimento campionato, 200 messaggi misurati (2026-09-18)

Gli still non mostrano il moto: campionato via JS invece che a occhio.
- Apertura mezzaluna: opacity 0.10→0.71→0.95→1, y −31→−6.5→−1.4→0px a
  60/150/250/500ms. Glide reale su proprietà da compositor (stessa easing
  di devboule). I tre PNG 29-motion-* da soli non lo provavano — i numeri sì.
- Thread 200 messaggi (dev mode, quindi pessimistico): mount+apertura
  1942ms, salto cima↔fondo 0ms, 200 righe rese. `content-visibility` basta:
  niente virtual-list, niente dipendenze. Da ricontrollare in build prod.

Voti: movimento 5 (con misura) · lunga 5 (con numeri).

## Giro 13 — prod perf + icone Tauri (2026-09-18)

- 200 messaggi in build prod (`vite preview`): mount+apertura 1703ms vs
  1942 in dev — il costo è DOM/markdown, non React dev. Accettato: costo
  una tantum all'apertura di un caso estremo, scroll poi a 0ms.
  Niente virtual-list (confermato due volte, numeri alla mano).
- Icone `src-tauri/icons/` generate via screenshot Playwright di un SVG
  inline (stessa marca del CSS: cerchio quasi pieno + flat in basso a
  sx, ruotato −12°, su squircle `#F4F8F3`). 32/128/256px esatti.
- Buttato due volte: l'arco SVG con flag sbagliati disegnava prima un
  Pac-Man (endpoint fuori cerchio -> auto-scale), poi il cerchio specchio
  (centro sbagliato). Lezione: con `A r r 0 large sweep` e due centri
  possibili, il rendering batte il ragionamento — screenshot ogni volta.
  Terza istanza di "verifica con gli occhi, non con la testa".

## Giro 14 — chiusura: tutti gli stati coperti, cosa resta a Marco (2026-09-18)

Verificati su disco i 13 file dei 12 stati del brief (+16 extra). Build
verde, tree pulito, 13 commit locali, nessun push.

Voti finali — leggibilità 5 · gerarchia 5 · spaziatura 5 · movimento 5 ·
stato d'errore 5 · coerenza token 5 (numeri AA in testa al LOG).

Bloccato, da decidere da Marco (non da me):
1. Endpoint reale: indirizzo, token e modello veri per una prova fuori dal
   mock — io ho girato tutto contro `scripts/mock-server.mjs`.
2. Bundle Tauri: `tauri init` + prima `cargo build` + firma Apple per
   distribuire (serve account/identità di firma). Il frontend è pronto
   (base relativa, niente API Node, icone presenti).
3. Push: mai fatto senza approvazione esplicita (regola standing).

---

# Audit ostile — giri di riparazione (seconda parte)

## Giro 18 — correzione di prodotto: superfici sull'arco, sidebar (2026-09-18)

- A: la mezzaluna porta sei superfici fisse (Chat Models Server Devices
  Advanced Settings) — paginazione cancellata del tutto (niente frecce,
  offset, label larghe: tornata la costante 100 di devboule). Le altre
  quattro sono segnaposto onesti (titolo + una riga, zero controlli finti);
  Settings è la form vera spostata dal dialog (dialog cancellato).
- Conversazioni in sidebar: gruppi Oggi/Ieri/Settimana/Prima, ricerca ⌘K,
  rename inline, delete in due passi, pallino live sulla riga che genera.
  Drawer sotto 900px con backdrop ed Esc. Preview senza sintassi markdown.
- A3 (velo): deciso — dim solo quando NESSUNO streamma (`:not(.is-streaming)`);
  con risposta in arrivo l'arco galleggia senza velo, leggibilità intatta.
- B2: `img` remoto mai renderizzato (notice + apri-indirizzo https only),
  `javascript:` già neutro in v9 (assert), zero richieste esterne misurate,
  CSP meta in index.html (script inline permessi: li vuole Vite dev).
- store.rename index-only (search = "titolo\ncorpo", il corpo sopravvive
  senza payload). Sidebar filtra l'indice in memoria: 1000 voci -> una in
  36ms, zero chiavi payload su disco (assert).
- D: `shot()` non ingoia più niente (via il catch); `must()` fail-loud;
  storage riletto dopo le scritture; deletecrescent20/few/activenav/narrownav/
  sliver/darknav cancellati col prodotto che li conteneva — buttati, e va
  bene così.
- Nuovi shot visti uno a uno: 40-sidebar, 44-drawer, 43-settings-surface,
  45-imgblocked, 46-surfaces, 47-groups. Tutti promossi; unico fix nato
  dalla vista: preview con URL markdown grezzi -> strip in `describe()`.
- Suite intere verdi dopo la riscrittura: shots 28/28, verify 44 assert,
  contrast-dom 56 coppie (incluse 6 nuove sidebar/blocked).

## Giro 15 — B1 token fantasma + contrasto dal DOM + B8 (2026-09-18)

- B1: i due `var(--white)` (token mai definito) diventano `var(--accent-ink`)
  — la coppia per cui era nato. L'audit aveva ragione su tutta la riga, e
  aveva ragione anche sul LOG: il giro 7 promuoveva a "scelta di design"
  quello che era un token mancante ("glifo scuro"). Correggo qui, non
  cancello: resta scritto sopra, sbagliato, e qui la smentita.
- Verifica rifatta come chiede l'audit: `scripts/contrast-dom.mjs` legge
  `getComputedStyle` su pagina vera (chiaro+scuro), foreground dall'elemento
  e fondo dal primo antenato opaco. 22 coppie × 2 temi = 44/44 PASS, inclusi
  punto attivo (7.49 chiaro, 7.59 scuro), bolla utente, manda, link, code,
  errori, composer, settings, empty, nav. `palette.mjs` resta come derivazione
  oklch, ma non è più citato come verifica.
- B8: validazione per messaggio in lettura (id/ruolo/contenuto richiesti,
  resto con default; conversazioni senza id scartate) + `ErrorBoundary` con
  fallback statico e due vie d'uscita (reload / cancella dati e riparti).
- `scripts/verify.mjs`: asserzioni funzionali (exit 1 al primo fallimento).
  Primo test `corrupt`: `[null, content:42, valido, coda vuota]` -> il valido
  si vede, niente boundary, niente finestra bianca (30-corrupt-data.png).
- Nota onesta: il fallback del boundary non ha screenshot — nessuna via
  pubblica lo raggiunge senza hook di test, che mi rifiuto di spedire.
  Rivisto a codice, coperto da validazione prima.

## Giro 16 — store v2: indice + payload, migrazione, quota, due finestre (2026-09-18)

- C: `crescent-chat.index.v2` (id/titolo/date/preview/search 500capped/
  hasMessages) + `crescent-chat.msgs.<id>.v2` per conversazione. Lista e
  ricerca non toccano mai un payload. Deviazione documentata nel commento:
  `list()` rende `ConversationMeta[]`, non `Conversation[]` — l'alternativa
  (payload pieni in lista) annullerebbe lo split. Nomi e regola del seam
  invariati; `rename`/`search` arrivano con la sidebar al giro 18.
- Migrazione v1->v2: una volta sola (flag), verifica rilettura, rimuove la
  vecchia chiave solo dopo. Mai persa, mai ripetuta (7 assert).
- B9: `storage` listener — seconda finestra vede senza reload (assert).
- B7: errori di scrittura in un canale (`getWriteError`) + banner che lo
  dice chiaro, sessione coerente in memoria (31-quota.png). Il test quota
  riempie fino al bordo PROVATO: top-up a granularità 256B dopo il break a
  1MB (la quota ha slack: un conteggio fisso in MB è flaky, misurato).
- `verify.mjs`: 16 assert verdi (migrate 7, roundtrip 2, multiwindow 2,
  quota 3, corrupt 3). Lo storage si rilegge dopo ogni scrittura (D).

## Giro 17 — chat.ts onesto: URL, non-SSE, tagli, timeout, B6 (2026-09-18)

- B4: `completionsUrl` non raddoppia più `/v1` (/v1 finale -> +chat only) e
  ogni errore mostra `Called:` con l'URL davvero chiamato (4 assert badurl).
- B3: content-type guardato; 200 non-SSE letto come completion JSON prima
  di arrendersi; 200 vuoto e 200-HTML diventano bad-response, mai bolla
  vuota con diagnosi sbagliata (json/html/emptycut assert + 32-html.png).
- B5: fine senza `[DONE]` = truncated (testo parziale tenuto) o bad-response
  (zero token); mai più "complete". Read spezzato a metà stream = truncated
  (cut assert). Live region distinta per truncated.
- 403 con copia sua (non più "401", assert forbidden403).
- Minori: drain dell'ultimo frame senza `\n`; idle timeout 60s con controller
  collegato (silent assert, 65s veri); 200 vuoto = bad-response non http;
  copy dice "Copied" solo se riuscito ("Copy failed" altrimenti) + cleanup
  timer; tema che segue il sistema finché non scegli (themeChoiceMade).
- B6: streaming per conversazione (`streamingByConv` + mappa controller).
  Stop e delete abortiscono solo la visibile; invio in B non tocca A.
  twostream assert: A 555->1056 dopo lo stop di B, B "Stopped early".
- Buttato per strada e ripreso: il mio primo `poke()` leakava timer (falsi
  timeout) — handle tracciato; il dispatch mock `cut-demo` mangiava
  `emptycut-demo` (sottostringa, ordine) — emptycut prima; il mio split-test
  era oltre-spec (due eventi su una riga: nessun parser può) — riscritto
  legittimo (frame spezzati + coda senza newline + niente DONE).
- 05-denied.png rigenerato con la riga Called: promosso a vista.

## Giro 5 — angoli mai fotografati: settings, validazione, delete, focus (2026-09-17)

- 17: dialog impostazioni calmo, una frase, tre campi, tutto resta locale.
- 18: URL sbagliato -> errore in chiaro, niente gergo da regex.
- 19: delete in due passi sul posto, niente modale.
- 20: Tab fino a Invia — anello di focus visibile sul bottone verde.
- Buttato: niente. Nota driver: `getByRole(name: "Settings")` matcha per
  sottostringa anche "Open settings" — ora `exact: true` (terza istanza
  della stessa lezione: nei selettori Playwright, sempre exact o regex).
