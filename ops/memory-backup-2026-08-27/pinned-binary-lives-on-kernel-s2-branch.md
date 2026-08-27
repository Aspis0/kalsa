---
name: pinned-binary-lives-on-kernel-s2-branch
description: Il binario PC di campagna viene da kalsa/kernel-s2-layer-fuse, non da main — main non ha i flag --moe-fused-*
metadata:
  type: project
---

`build-pc-mellum-ppl/cli/bmoe-cli.exe` (sha `7722cb23…d75d52`, build 2026-08-14
01:58) — il binario dietro **ogni numero di qualità** della campagna — è compilato
da **`kalsa/kernel-s2-layer-fuse`**, NON da `main`.

**Come si riconosce:** l'harness `run_multi5_ppl_host.py --stock-kernel` passa
`--no-moe-fused-gemv --no-moe-fused-ffn` a ogni braccio. Il binario pinnato li
accetta; uno compilato da `main` li **rifiuta** (`unknown arg`, exit 1) — è così
che il 2026-08-18 è morto in 11 secondi un braccio dell'esperimento drop-policy.

Struttura dei branch (misurata): è una **catena**, non un groviglio —
`main → kalsa/mellum-recipe → kalsa/kernel-s1-expert-pack → kalsa/kernel-s2-layer-fuse`.
`kernel-s2` contiene gli altri tre ed è `main` **+3 commit, 0 indietro** (main è
suo antenato), quindi fonderlo in main sarebbe un fast-forward senza conflitti.
Divergono davvero solo `kalsa/kf-layer-ahead` (7 avanti / 12 indietro) e
`kalsa/selfspec-f1` (22 / 12 — e lì c'è il build E4 pinnato da non toccare).

**How to apply:** prima di compilare qualsiasi cosa da confrontare con la
campagna, `git -C BigMoeOnEdge branch --show-current` e assicurarsi di essere su
`kalsa/kernel-s2-layer-fuse` (o un branch che ne discende). Build in una cartella
NUOVA: `build-pc-mellum-ppl/` non si tocca mai.

**Trappola di metodo:** `strings` sull'exe restituisce **zero righe** (non estrae
dal PE) e dà falsi negativi convincenti. Per sapere se un binario conosce un flag,
lanciarlo con quel flag **e** con uno inventato: deve accettare il primo e
rifiutare il secondo. Vedi [[never-push-to-upstream-bigmoe]].
