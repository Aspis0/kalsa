---
name: play-memory-mandate-2027
description: "Google Play feb-2027: soglie su memoria ANON (RSS+swap) per stato app e tier RAM + Android 17 MemoryLimiter (zRAM throttle poi KILL 'MemoryLimiter:AnonSwap') — minaccia il path NPU all-anon e la cache streaming, PREMIA mmap/repack #29; q66/q68/governor = lavoro di compliance"
metadata:
  type: reference
---

Fonti (26/08/2026): https://android-developers.googleblog.com/2026/08/app-quality-memory-optimization-secure-onboarding.html
e .../app-broader-memory-limits.html (+ 9to5google.com/2026/08/26/google-play-app-memory/).

**Play, da feb 2027** (enforcement: visibilità/publishing ridotti): (1) memoria dinamica = **ANON RSS +
swap** per stato app (foreground/background/cached) e tier RAM device — numeri nelle doc Play Console,
NON nel blog; (2) bitmap non persistenti in background; (3) DEX ≥25% R8 (banale). **Apr 2027**: Zero-Tap
Sign-In (Restore Credentials API), giochi esenti per ora.

**Android 17 MemoryLimiter** (Pixel prima, altri OEM in arrivo): limite per-app su anon+swap → prima
zRAM (jank), poi **kill** con exit reason `REASON_OTHER` + "MemoryLimiter:AnonSwap". Nessuna esenzione
dichiarata per foreground/AI.

**Lettura Kalsa**: il metrico conta SOLO l'anonima → i pesi **mmap/file-backed NON contano** = il repack
#29 + residenza elastica CPU è compliant by design (vantaggio competitivo). ESPOSTI: path NPU (load
all-anon, [[adreno-moe-two-defects]] — serve npu_fit), cache esperti streaming (3.4 GB anon, q64) che va
DROPPATA in background (onTrimMemory — era già la product action di q66-B), KV/heap. q66 (lifecycle) e
q68 (dirty-phone load) diventano evidenza di compliance; il governor (#24) guadagna una corsia memoria
(budget anon per stato). App-side TODO: Android vitals monitoring, exit-reason logging (kill del limiter
distinguibile da LMK), Restore Credentials (S). Watch: soglie numeriche per tier + eventuale categoria
"AI apps".
