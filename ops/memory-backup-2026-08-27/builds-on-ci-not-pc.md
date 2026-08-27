---
name: builds-on-ci-not-pc
description: "Regola gualt (27/08): le build pesanti (APK, NDK) si fanno sulla CI GitHub — gratis e illimitata sui repo pubblici Aspis0 — NON sul PC, che serve alle celle di misura"
metadata:
  type: feedback
---

2026-08-27, dopo la giornata di build APK locali (5 tentativi, linker da 10 GiB, floor RAM
raggiunto, stop di sicurezza): gualt — "dato che kalsa e' pubblica, non puoi usare CI?" +
"Salvatelo in memoria".

**Why:** i repo Aspis0 (kalsa/ai-chat, kalsallama, llama.rn fork) sono pubblici → runner GitHub
Actions gratis e illimitati, su Linux dove la pipeline llama.rn/NDK e' gia' verde (i workflow
from-source esistono in ai-chat: dflash-ab.yml, e2e-emulator.yml). Il PC e' la risorsa scarsa
della campagna ([[pc-stability-over-throughput]]): un freeze costa 10 giorni, un runner CI costa
zero.

**How to apply:** ogni build pesante e ripetibile (APK, engine NDK multi-variant, matrici di
build) → workflow nel branch che produce l'artifact + sha256 scaricabile; il PC si usa solo per
smoke rapidi, quantizzazioni/PPL (che sono celle, non build) e cio' che richiede i device locali.
Ricordare il fix link-pool (JOB_POOLS link=1) che vale anche sui runner. Primo workflow da creare:
build APK arm64 kalsallama sul branch `engine-pin-kalsallama` di ai-chat.
