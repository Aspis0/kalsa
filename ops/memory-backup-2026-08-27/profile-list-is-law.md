---
name: profile-list-is-law
description: "gualt cura la lista profili Paseo per gestire i COSTI: mai scegliere un modello fuori lista (es. Sol invece di Luna) senza chiedere prima — 19/08 errore che ha bruciato token"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0e5e48cb-1b53-436f-a35a-c661b00ea052
  modified: 2026-08-26T20:18:02.421Z
---

2026-08-19: con tutti i coder configurati morti (quota qwen esaurita, grok senza
crediti), ho lanciato l'implementazione del restore-fix su **codex/gpt-5.6-sol**
("frontier") invece del Luna configurato nel profilo Websearch. gualt: "Perché sol
e non luna? Mi distruggi i token così. Non hai neanche chiesto. [...] ti ho messo
una lista di agenti per un motivo".

**Why:** la lista profili Paseo non è un suggerimento, è la policy di COSTO del
proprietario. "Più capace" non è mai una giustificazione autonoma per un modello
più caro: i token sono suoi. Sol costa molto più di Luna sullo stesso piano codex.

**How to apply:** delegare SOLO con provider/model presi verbatim da un profilo
della lista (`list_profiles`). Se nessun profilo vivo copre il task, chiedere a
gualt PRIMA di ripiegare su un modello fuori lista — anche se sembra ovviamente
migliore, anche se c'è urgenza. In caso di quota esaurita, la prima mossa è
segnalarlo: lui aggiorna la lista in fretta (l'ha fatto con GLM 5.2 in minuti).

**2026-08-21 — anche gli AUDIT sono delegati, mai fatti dal main loop.** gualt:
"no tu non auditi niente, devi farlo passare sotto reviewer math oppure dato che
mimo ha finito i token, usa il nuovo coder free come audit". L'orchestratore non
si auto-certifica design/report: ogni audit passa da un agente reviewer della
lista. Rotazione auditor (aggiornata 21/08 pomeriggio, gualt): **Free coder
(pi/openrouter/free) è la PRIMA scelta quando basta** ("puoi rimanere col free
agent se possibile" — costo zero); mimo (Explorer/Reviewer) è tornato coi token
e fa da riserva per gli audit profondi; Reviewer Math = **codex/gpt-5.6-luna**
(auto-review, thinking max — non più deepseek). La lista va riletta a ogni giro
perché gualt la aggiorna in corsa.

Vedi [[opencode-model-policy]], [[qwen-max-chat-channel]].

**AGGIORNAMENTO 24/08 (da gualt): NON usare solo grok — finisce i token.**
Routing coder da oggi: **Luna (profilo "Coder", codex/gpt-5.6-luna) è il
default per il coding PC-side** — implementazioni, patch con spec chiara,
build, harness/script, test (ottimo coder, 1M ctx; gap noto: buchi nei test
di error-handling → far validare i test da un Reviewer). **grok (Skill coder)
SOLO dove è insostituibile**: sessioni device autonome lunghe (adb/harness
detached multi-step, recovery in corsa) e debugging cross-layer a loop stretto
col device. Se un task ha una parte build/PC e una parte device, valutare lo
split: Luna prepara, grok esegue sul device. Mechanic/Free coder per il
meccanico puro (Free coder: SOLO chiamate sincrone, il suo tool async è rotto
— vedi [[paseo-ops-lessons]]).

**AGGIORNAMENTO 26/08 sera (da gualt): nuovo profilo "Strong Cheap coder"** = pi /
`openrouter/z-ai/glm-5.3-flash`, thinking max — "più forte di Luna, ma FUORI abbonamento →
usare con parsimonia". Routing: Luna resta il workhorse PC-side (in abbonamento); Strong Cheap
coder per i task dove il gap di Luna morde (kernel/ottimizzazioni delicate, harness device
complessi, error-handling nei test) o quando Luna fallisce due volte. Il profilo "Free coder"
(openrouter/free) NON c'è più nella lista. La vecchia nota "mai GLM 5.3" di
[[opencode-model-policy]] riguardava il provider opencode-go: via openrouter è ora autorizzato
dal profilo.

**Limite visto il 26/08 sera**: GLM-5.3-flash via openrouter è caduto DUE volte con "Upstream idle
timeout exceeded" mentre scriveva un documento lungo (~400 righe) in un passaggio; il primo draft
(208 righe) era passato. Usarlo per output brevi/medi o spezzati in più prompt; riscritture lunghe
in un colpo solo → Luna.

**AGGIORNAMENTO 23/08 (da gualt, in sessione):** Reviewer Math NON è più Luna —
è il profilo Paseo "Reviewer Math" = **pi / opencode-go/deepseek-v4-flash,
thinking max** (AIME 98.3%). Va usato per ogni audit che coinvolge aritmetica,
formule, conversioni, overflow, off-by-one numerici. Il Reviewer documentale
(mimo) resta per struttura/coerenza/citazioni ma è dichiarato debole in
matematica — mai lasciargli l'ultima parola sui numeri.

**AGGIORNAMENTO 27/08 (da gualt): per i lavori di MAPPAGGIO usare TANTI mimo in parallelo** ('fanno miglior lavoro in meno tempo'): ricognizioni strutturali, inventari di file/simboli, diff di superfici API → spezzare in scope disgiunti, un mimo Explorer per scope, output su file separati, un integratore (Luna) che li consuma. Non riservare mimo al solo audit doc: il mappaggio parallelo e' il suo terreno. Prima applicazione: GAP_JSI.md + GAP_MTMD_CMAKE.md (pin kalsallama in llama.rn, opzione C).

**27/08 pomeriggio: quota settimanale opencode-go/mimo ESAURITA (reset ~30/08).** Ordine gualt: 'Usa strong cheap glm' — per l'outage, i lavori da mimo (mappaggio, e all'occorrenza audit doc) passano a Strong Cheap (pi / openrouter/z-ai/glm-5.3-flash, thinking max), con la mitigazione output-lunghi: scrivere i file INCREMENTALMENTE + marker COMPLETE finale. DeepSeek (stessa famiglia opencode-go) girava ancora stamattina: se muore pure, segnalare subito.

**27/08 sera (da gualt): grok DISPONIBILE per tutta la settimana** (fino ~03/09). Torna la routing map originale per la finestra: grok (Skill coder) per sessioni device autonome lunghe (adb/harness multi-step, recovery in corsa) e debugging cross-layer a loop stretto col device — cioe' esattamente le celle S23 dei 10 giorni (q66 lifecycle, q68, baseline plugged, kernel-opt device-side). Luna resta il default PC-side e mantiene i task gia' in corso (engine-pin). Attenzione invariata: token grok finiscono — non usarlo per lavoro PC-side che Luna copre. Nota: [[grok-autolaunch-blocked]] riguardava --always-approve via CLI; via Paseo profilo ok.
