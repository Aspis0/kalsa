---
name: s23-debuggable-apks-policy
description: "Policy gualt (27/08): S23 = telefono di SVILUPPO, si installano SOLO APK debuggabili (variant release-ottimizzato + flag debuggable) — run-as sempre disponibile; l'APK release pulito resta solo artifact CI / candidato ship"
metadata:
  type: feedback
---

2026-08-27, gualt: "ma sti cazzi dell'apk release. e' un telefono di sviluppo, io metterei solo
apk debuggabili".

**Why:** senza debuggable niente `run-as` → la dir privata dell'app (files/models/) e' inaccessibile
da adb su device reale non-rootato: test come lo swap del gguf (C1 in-app) diventano impossibili, e
q66/q68 perdono introspezione (heap dump, ProfilingManager, oom_adj comodo).

**How to apply:** build per S23 = buildType release + `debuggable true` (JS di produzione, native
identico, run-as attivo) — MAI il variant debug puro (JS dev-mode, numeri falsati). L'APK release
pulito vive come artifact del workflow CI (regola [[builds-on-ci-not-pc]]) per ship/store. Modello
di catalogo sostituito nei test va sempre backuppato (.orig) e ripristinato.
