# Plan: deadlines from mail, and finding documents on the PC

Owner decisions, 2026-10-14:
- After mail, the next two things are reminders/deadlines read from mail, and search over the PC's documents.
- A calendar connection waits: nobody uses the PC's own calendar. Google (Gmail, Calendar and Drive behind one sign-in) is for the beta.

## 1. Deadlines from mail → notifications in Kalsa

**What the person sees**
- Kalsa checks new mail by itself while it is open (every 30 minutes, read-only). It finds deadlines ("la fattura scade il 25", "rispondere entro venerdì", "appuntamento giovedì alle 15") and lists them in a **Scadenze** list in the app.
- The day before (and the same morning), Kalsa shows a notification on the computer, and on the paired phone if there is one.
- Every deadline has **Apri la mail**, **Fatto** and **Non mi interessa**.
- A mail card with a deadline gets a **Ricordamelo** button. "Ricordami di chiamare il dentista giovedì" in the chat creates one too.

**How**
- The **code** finds the date. It uses the deadline signal already in kalsa-mail, plus a date parser for Italian and English, relative to the mail's arrival time (INTERNALDATE, not the sender's Date header). The calendar lab showed that models get relative dates wrong.
- The model only writes the one-line "what": "Pagare la fattura Studio Ferraro, € 1.240". It never computes the date.
- Suspicious and bulk mail never create a deadline.
- Storage: one local file, holding the mail id, the date, the line and the state. Nothing leaves the PC.
- The notification goes through Tauri's notification plugin. The phone gets it over the existing pairing channel, as a later step.

**Steps**
1. A date parser plus deadline extraction in kalsa-mail. Tested on the lab mailbox and the Gmail run, with numbers only.
2. The background check, the Scadenze list, the notifications, and Ricordamelo on mail cards (MiniMax for the UI).
3. "Ricordami …" in the chat: a Kalsa-side tool where the model proposes a text and a date phrase and the code parses the date.

## 2. Finding documents on the PC

File names mean nothing (`download (3).pdf`, `4534tgtegd.pdf`), so search works on content.

**How**
- Never crawl the disk: use the OS index. On macOS that is Spotlight (`mdfind`, which indexes PDF text). On Windows it is Windows Search; whether PDF text is indexed there depends on the installed filter, so measure it.
- **Hard limits in code:**
  - at most 20 results and 3 s per query;
  - only the person's folders (Documents, Downloads, Desktop);
  - `Library`, `node_modules`, hidden and system folders are always excluded.
- **A document card index**, built slowly in the background (N files per minute, never a burst). For each PDF it stores the type, issuer, period and amount, found by code rules: POD/PDR codes, "Importo da pagare", "Periodo di fornitura", supplier names. Queries hit these cards, not the disk.
- "Quanto ho speso di gas quest'anno": the model reads amounts and periods out of the cards it is given. The **code** sums them and draws the table, with **Apri** and **Mostra nella cartella** on every row.
- Scanned bills (no text layer) need OCR (macOS Vision). That is slow, so it is capped and decided after the lab.

**Steps**
0. **Lab on the owner's Mac.** Read-only, results as numbers only (no file names or contents in any report):
   - how many PDFs are in the person's folders;
   - how many have a text layer;
   - how many the bill rules recognise;
   - Spotlight's speed and recall on 10 test queries.

   The run is bounded (time caps; it never greps the disk).
1. The `kalsa-files` MCP server (search, read a capped number of pages, card index) on the same host as mail.
2. Document cards in the chat, plus the right panel (UI by MiniMax).
3. Windows: Windows Search, measured on the Surface.
