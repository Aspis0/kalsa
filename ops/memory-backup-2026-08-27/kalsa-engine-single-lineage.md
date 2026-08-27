---
name: kalsa-engine-single-lineage
description: "Topologia repo consolidata 22/08 (decisione gualt 'A'): fork llama.cpp = Aspis0/kalsallama con DUE lignaggi legittimi (kernel-s3-repack GPU, mmap-prefetch-opt hook CPU); vendored copies eliminate; mai patchare fuori linea; banner 'kalsallama' da introdurre"
metadata: 
  node_type: memory
  type: project
  originSessionId: cbe9d83a-a5b8-43e7-ae45-f5e24f47293c
  modified: 2026-08-22T19:40:38.208Z
---

**Topologia consolidata (22/08, decisione gualt "opzione A")** — tre repo, tre ruoli:
`Aspis0/kalsa` = app (locale `Kalsa\ai-chat`) · `Aspis0/kalsa-forkbigmoeonedge` =
BigMoeOnEdge wrapper (locale `moe-experiments\BigMoeOnEdge`; rinominato da
`kalsa-engine` il 22/08 su direttiva gualt, redirect GitHub attivi) ·
**`Aspis0/kalsallama`** (privato) =
fork llama.cpp (locale `BigMoeOnEdge\third_party\llama.cpp`, origin=kalsallama,
pre-push allow-list solo Aspis0). Mappa completa: `docs/ENGINE.md` in moe-experiments.

**DUE lignaggi engine legittimi, entrambi branch veri su kalsallama:**
1. `kalsa/kernel-s3-repack` — kernel Adreno OpenCL (campagna 4+1 difetti, q2/q3).
   Ogni fix GPU si impila QUI, mai su main/upstream.
2. `kalsa/mmap-prefetch-opt` — hook CPU expert-ready (`5236140e5`, 11/07) +
   mmap_prefetch. È il lignaggio che la patch llama.rn dell'app rispecchia
   (31 righe ggml, prefisso `lm_`). Il nome "bmoe/expert-ready-hook" citato nei
   commenti dell'app NON è mai esistito come branch.

**Paura originaria di gualt (19/08)**: due kernel patchati in modo divergente. La
risposta è: copie vendored VIETATE (quella in `moe-experiments/kalsa-engine/` fu
eliminata il 22/08 dopo prova di zero contenuto unico — byte-identica a `e5605f3bd`);
la patch app si RI-DERIVA con un diff dal branch di kalsallama, mai editata a mano.

**Ancora da fare**: banner "kalsallama <branch> <sha>" nel version string (proposta
gualt) — NON rinominare simboli/file (avvelena i diff upstream).

Vedi [[never-push-to-upstream-bigmoe]], [[pinned-binary-lives-on-kernel-s2-branch]],
[[adreno-moe-two-defects]].

**CONSOLIDAMENTO FINALE 23/08 notte (ordine owner: "UN SOLO KERNEL SUL MAIN"):**
i "due lignaggi" erano in realtà UNA catena lineare (git l'ha provato:
mmap-prefetch-opt → s1 → s2 → s3-repack → repack-q23k, ogni tip antenato del
successivo). Creato **`main` @ 9890d1054 = IL kernel** (hook mmap + fuse S1 +
kernel Adreno q2/q3 + CPU repack v1), default branch su GitHub. CANCELLATI i 7
puntatori ridondanti (s1, s2, s3, mmap-prefetch-opt, opencl-q6k-dispatch-fix,
split-trunk-gpu, repack-q23k) — commit tutti raggiungibili da main, zero perdita.
Sopravvivono: main, master (specchio upstream), kalsa/mali-probe (never merge),
kalsa/mld-gemv-m1 (contenuto unico, decisione owner). I submodule (app e
BigMoeOnEdge) devono puntare a kalsallama MAIN — l'app compilava il vendorizzato
con un pin vecchio su un ramo senza i kernel GPU: tre livelli di disallineamento,
tutti risolti puntando a main. Il worktree locale worktree-repack-q23k ora è su
main. NOTA per il futuro: lavoro nuovo = branch da main, merge in main a fine
progetto — mai più rami-lignaggio paralleli.

**DECISIONE OWNER 27/08 — opzione C, 'la piu pulita', da mettere su ai-chat main**: kalsallama diventa L'engine dell'app via checkout PINNATO (submodule third_party/kalsallama + sync script engine→cpp/ di llama.rn al prebuild); il wrapper JSI pristine si fa compilare backportando in kalsallama le piccole feature upstream mancanti (load_mode, reasoning_budget*, thinking_end_tags, gap mtmd/clip) invece di forkare llama.rn; upstream entra SOLO via cherry-pick in kalsallama (stessa disciplina '≤3 picks' del piano 10 giorni), poi si sposta il pin. NIENTE delta-su-vendored (bocciato: terzo lignaggio, drift). Percorso: branch su ai-chat → build verde+assert → merge main (ok owner esplicito, avvisare sessione app via gualt). Fasi in scratchpad/agents/q66-app-lifecycle-s23/ENGINE_PIN_GAP.md (Luna 9cf8103b). APK CI-parity = solo fallback documentato.
