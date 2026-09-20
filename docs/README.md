# docs

Notes, measurements and decisions that shaped the app. One line each, so the
list alone says which file to open.

- **BRIDGE-ON-THE-MOBILE-NETWORK.md** — does the phone's road to this computer survive away from the house? Measured on cellular: direct, no relay, about 50 ms.
- **COMPUTE-BUFFERS-DENSE.md** — can llama.cpp's own fit facility replace the 512 MiB compute-buffer forfait in the catalog's memory arithmetic?
- **DESKTOP-CHAT-DECISION.md** — how the desktop chat became this app's frontend, and what was verified about it the night it moved in.
- **DESKTOP-FEATURES-ALREADY-OURS.md** — which features the phone's code already owns (websearch, attachments, previews) and how portable each one is, counted line by line.
- **HOUSEHOLD-RULES.md** — the owner's four hard requirements for a multi-device household; no design that breaks one is eligible.
- **MULTI-DEVICE-SHAPE.md** — which llama-server parallelism shape a household should run, measured: TTFT, queueing, and the kv_unified mechanism behind the difference.
- **NIGHT-RUN-2026-09-18.md** — the night's audit: what was asked, what was measured, what was fixed that night, and what was left open.
- **PRIOR-ART-CHAT-UIS.md** — what the open-source chat UIs already solved, which are legally usable (licences read, not guessed), and what is worth copying.
- **SETTING-EXPLANATIONS.md** — what every Advanced setting means, its default in the shipped build, and the evidence behind the usual values.
- **THE-BRAIN-IS-THE-HOME.md** — why the brain page is the home and the chat lives inside it rather than in a tab beside it; declares it supersedes §6 of DESKTOP-CHAT-DECISION.md.
- **WHAT-IS-MISSING.md** — what stands between here and the product, ordered by what blocks it; each item it closes names the commit that closed it.
