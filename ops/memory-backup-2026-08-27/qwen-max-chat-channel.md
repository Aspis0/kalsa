---
# 22/08 notte: quota API free ESAURITA (403 insufficient_quota sul profilo Talk).
# Canale funzionante VERIFICATO: chat.qwen.ai via PASEO BROWSER — gualt fa login,
# l'orchestratore guida: selettore modello su Qwen3.8-Max, browser_type CON ref
# sull'input (fill non innesca React, Enter non invia), click sul bottone Send,
# thinking lungo (minuti) poi risposta. Primo consulto riuscito: NaN-judge +
# ricette Mali (scratchpad/agents/consult-qwen-nan-mali/ANSWER.md).
name: qwen-max-chat-channel
description: Qwen 3.8 Max è consultabile via https://chat.qwen.ai/ su Chrome (plugin browser funzionante) per scambi di opinione diretti
metadata: 
  node_type: memory
  type: reference
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-24T14:13:30.855Z
---

**AGGIORNAMENTO 2026-08-19 — CANALE NUOVO E PREFERITO: profilo Paseo "Talk"**
(`provider pi`, model `qwen-model-studio-sg/qwen3.8-max`, `thinkingOptionId max`,
~1M token GRATIS per pochi giorni dalla data — poi verificare che esista ancora).
Indicazione di gualt: usarlo per **consigli e review ostili discorsive**, MA ha
pochi token: **parlarci, non passargli codice** — catene di evidenza distillate,
non diff né file. Provider diverso da opencode-go: non tocca quel tetto.
Il canale browser sotto resta il fallback gratuito.

**gualt (2026-08-24): nei prompt per Qwen chiedere SEMPRE di rispondere
brevemente** — aggiungere in coda tipo "Answer briefly: ranked list +
one-line rationale each, no preamble" (il thinking lungo resta, ma l'output
va compresso: gualt fa copia-incolla a mano).

gualt (2026-08-14): per scambiare opinioni con Qwen 3.8 Max — l'auditor
esterno usato per le review pesanti (kernel S2, kernel plan v1) — posso
usare https://chat.qwen.ai/ direttamente su Chrome col plugin browser
(claude-in-chrome). Utile per: discutere verdetti di diagnosi (es. F1b
selfspec), seconde opinioni su design prima di un GO, follow-up alle sue
audit. Gli altri canali cheap-agents restano per il lavoro bulk; questo è
per il confronto puntuale con il Max. Vedi anche [[watchers-verify-pid]]
per il protocollo agenti.

**CLI (verificato 2026-08-14):** `@qwen-code/qwen-code` installata
globalmente (v0.21.12) ma il free tier Qwen OAuth è stato DISMESSO il
2026-04-15 — richiede Coding Plan a pagamento o provider terzi
(OpenRouter = bloccato sull'account, Fireworks). NON riprovare la via CLI
gratis. Il browser resta il canale gratuito; niente scroll necessario:
`get_page_text` estrae l'intera chat in una chiamata.
