---
name: paseo-ops-lessons
description: "Lezioni operative Paseo (21/08): agenti muoiono silenziosi (idle senza notifica) — list_agents quando il silenzio è lungo; risposte troncate → get_agent_activity limit=1; 'resto in ascolto' non sopravvive allo stop; profili cambiano in corsa"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e5e48cb-1b53-436f-a35a-c661b00ea052
  modified: 2026-08-24T12:51:41.142Z
---

Lezioni operative sull'orchestrazione via Paseo (accumulate 21/08, campagna kernel):

1. **Morte silenziosa**: un run agente può morire per stream-death del provider
   SENZA notifica di errore — l'agente risulta semplicemente `idle` con l'ultima
   attività a metà lavoro. Se un agente tace troppo a lungo, `list_agents` e
   confronto `updatedAt` vs `lastUserMessageAt`; se idle a metà task, re-prompt
   (il contesto di sessione SOPRAVVIVE — non si riparte da zero, ma i file non
   scritti sono persi → sempre imporre scrittura incrementale).
2. **Risposte troncate**: le notifiche `<agent-response>` troncano oltre ~10KB;
   il testo completo si recupera con `get_agent_activity(agentId, limit=1)`.
3. **"Resto in ascolto" è una bugia strutturale**: quando il run finisce,
   l'agente NON ascolta nulla (né bus adb né altro) — serve sempre un
   send_agent_prompt per riattivarlo.
4. **Il runtime codex può crashare a metà consolidamento** (app-server exit,
   sandbox CreateProcessAsUserW denied): il verdetto sostanziale pre-crash può
   essere valido ma il formale va rifatto — su istanza fresca o altro profilo.
5. **I profili cambiano in corsa** (gualt li aggiorna anche a metà sessione):
   `list_profiles` va riletto A OGNI giro di delega, mai fidarsi della
   fotografia di inizio sessione (errore fatto con deepseek→Luna su Reviewer
   Math, 3 lanci falliti per max_tokens).
6. **Free coder (openrouter/free)**: verdetti a volte incoerenti (FIX-THEN-RUN
   in testa e RUN-AS-IS in coda) — i finding vanno arbitrati singolarmente, il
   verdetto sintetico non è affidabile; per verifiche formali delimitate invece
   funziona bene.
7. **(24/08) Il tool async del Free coder (pi/ox-alpha) è ROTTO su Windows**:
   i suoi job detached passano per cmd.exe con sintassi bash (`cd && ./…`,
   quoting) e muoiono in 50 ms con "Illegal characters in path" / "syntax
   incorrect" — MA l'agente li crede partiti e va idle "in attesa". In più le
   notifiche di fine turno possono ripetere lo STESSO messaggio stale 3+ volte.
   Regola: su questa macchina mai affidargli lanci detached/lunghi (download,
   quantize) — quelli li esegue l'orchestratore direttamente; al Free coder solo
   Read + chiamate python/shell sincrone brevi. Se si incaglia (prompt ricevuti,
   zero attività nuova), chiudere e finire inline: tre recuperi = troppi.

**Why:** questi pattern hanno bruciato tempo reale (3 lanci morti, un'ora di
lavoro grok non scritta su disco, un verdetto perso nel crash).
**How to apply:** vedi punti; regola d'oro = report incrementali obbligatori
nei prompt di delega + rileggere i profili + mai aspettare passivamente.

Vedi [[profile-list-is-law]], [[background-kills-at-compaction]],
[[watchers-verify-pid]].
