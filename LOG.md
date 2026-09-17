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
