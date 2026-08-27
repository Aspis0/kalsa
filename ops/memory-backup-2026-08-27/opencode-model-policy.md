---
name: opencode-model-policy
description: "Su pi/opencode-go usare solo mimo-2.5 (explorer), deepseek-v4-flash (default) e v4-pro raro; GLM 5.3 vietato perché brucia quota"
metadata:
  type: feedback
---

**Regola dell'owner (2026-08-19): su `pi --provider opencode-go` NON usare più
`glm-5.3` — consuma una quantità sproporzionata di quota.**

Roster consentito, in ordine di uso:
- **`mimo-2.5`** (la versione NON pro) → ruolo **explorer**: ricognizione, ricerca nel
  codice, mappature, censimenti.
- **`deepseek-v4-flash`** → il **default** per review, analisi, diagnosi. È anche il più
  affidabile a consegnare.
- **DeepSeek V4 **Pro**** → **raramente**, solo quando serve davvero la potenza in più.

⚠️ Questo aggiorna il roster della skill `cheap-agents`, che elencava
`deepseek-v4-flash / luna-5.6-pro / hy3 / mimo-v2.5-pro`: **luna e hy3 non sono più la
via di escalation, e mimo va usato nella variante non-pro.**

**Il tetto è per provider, non per modello.** opencode-go ha un limite a **5 ore**: quando
scatta, TUTTI i modelli lì rispondono `429 GoUsageLimitError` e gli agenti muoiono senza
consegnare (successo il 2026-08-18: due agenti persi, log di 330 byte col solo banner).
Il messaggio dice quanto manca al reset. Grok sta su un provider diverso e non è toccato.

**Why:** la quota è una risorsa condivisa fra tutti gli agenti della sessione; sprecarla
con un modello costoso significa restare senza proprio quando serve una diagnosi.
**How to apply:** scegliere il modello per ruolo, non per "il più forte disponibile"; e
prima di lanciare una batteria di agenti, considerare che condividono lo stesso tetto.
Vedi [[cheap-agents-roster]] se esiste, e la skill `cheap-agents`.
