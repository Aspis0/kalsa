---
name: search-online-first
description: "Regola gualt (27/08, detta a tutti i Claude): davanti a un problema che sembra tosto, cercare PRIMA online — qualcuno ci e' gia' sbattuto e ha la soluzione"
metadata:
  type: feedback
---

2026-08-27, gualt: "se si incontra un problema che sembra tosto, si cerca sempre prima online se
qualcuno ha la soluzione perche ci e' sbattuto gia". Detto a tutte le sessioni Claude.

**Why:** ore bruciate oggi a riscoprire per tentativi la pipeline llama.rn/engine (MAX_PATH,
vendored half-and-half, ordine patch/bootstrap) quando issue/docs upstream probabilmente
documentano tutto; il costo di una websearch e' minuti, il costo del whack-a-mole e' ore.

**How to apply:** al PRIMO fallimento non banale (build che rompe su API/versioni, tool che si
comporta strano, integrazione tra progetti), spawnare SUBITO l'agente Websearch (profilo
codex/gpt-5.6-luna) con la query del sintomo esatto + nomi progetto/versione, in parallelo alla
diagnosi locale — non dopo il terzo tentativo. Vale anche per design: "come fanno gli altri a X"
prima di inventare. Vedi [[profile-list-is-law]] per il profilo.
