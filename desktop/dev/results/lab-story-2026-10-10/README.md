# LFM refuses to write when tools are offered (Surface lab, 2026-10-10)

Model: LFM2.5-VL-3B-Q8_0 on the Surface, engine called directly with the app's
exact body (system prompt, tools create_miniapp/web_search/web_fetch, "Sent on"
date suffix, no sampling fields; server defaults temp 0.2, top_k 50). 5 runs per
cell. Prompts: P1 "Write me a short story about a lighthouse keeper.", P2 "Write
a short poem about autumn.", P3 "Scrivi una breve storia su un gatto.".

| variant | P1 EN | P2 EN | P3 IT |
|---|---|---|---|
| A prompt at ea05d221 | 0/5 | 0/5 | 1/5 |
| C "You can write…" right after the identity sentence | 0/5 | 0/5 | 5/5 |
| D no web tools | 1/5 | 0/5 | 5/5 |
| F no date suffix | 0/5 (web_search) | 0/5 (web_search) | 1/5 |
| J C, no tools at all | 5/5 | 5/5 | 5/5 |
| M no system prompt, no tools | 5/5 | 5/5 | 5/5 |
| N C + web tools "not for writing" | 0/5 (refuses) | 0/5 | 5/5 |

Every prompt wording, sentence position, tool description and order failed in
English; only removing the tools works. Owner chose: re-ask once without tools on
a detected refusal (shipped in da6c7ffd / ffb9eb2b, detector
chat/src/lib/refusal.ts). Retry flow (run5): P1 5/5, P2 3/5 before the
"I don't have a tool" marker was added. Detector on 256 labelled replies
(eval-rows.json): 90 TP, 0 FP, 0 FN.

Files: score*-summary.txt (per-run scoring of rounds 1–4), detector.mjs (the lab
detector the app's one was ported from), eval-rows.json (labelled replies),
run5-retry-results.json (retry flow). Bodies and raw replies stayed on the lab
machine (/tmp/kalsa-installer/lab-story).
