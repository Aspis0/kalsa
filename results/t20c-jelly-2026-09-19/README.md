# T20C on the Jelly — 2026-09-19, one turn

Recovered from an uncommitted worktree on the Mac after the session that ran
it ended. Curated, not copied whole: the raw capture was 776 KB of which 473 KB
was logcat, and almost all of that was MediaTek thermal-HAL noise
(`fill_thresholds: … not support`) plus 1173 `KALSA_NATIVE` lines. What is
here is the measurement and the evidence for it.

| file | what it is |
|---|---|
| `c1-V1.jsonl` | the one completed turn: arm T20C, variant V1, conversation c1-V1 |
| `kalsa-markers.txt` | the 38 structured `KALSA_*` lines of the run, logcat prefix stripped |
| `checkpoint.json` | where the harness stopped: turn 1, `2026-09-19T05:43:43.524Z` |

## What it measured

One turn, three rounds (the model called `web_search` twice), on battery
(`charging: false`, so the timings are valid):

| round | prompt tokens | prompt ms | predicted | tok/s |
|---|---|---|---|---|
| 0 | 2430 | 94597 | 258 | 6.28 |
| 1 | 116 (tool) | 6922 | 168 | 5.92 |
| 2 | 231 (tool) | 12653 | 429 | 5.77 |

**94.6 seconds of prefill for the first round** is the number that matters:
2430 tokens, and the decode that follows runs at ~6 tok/s and decays slightly
round over round. The turn cost roughly 258 s of compute in total.

`assistant` in the record is **1 character long**: the turn produced telemetry
and tool rounds but effectively no final text. Recorded as found, not
explained.

## What is NOT here

The lab notes for this run say the Jelly reached thermal status 3 in about
nine minutes at 51% battery. **These files do not evidence that**: the capture
contains no samples from our thermal watchdog, only the vendor HAL's
unsupported-sensor spam. The thermal claim rests on the session's own
observation, not on this artifact.

The raw `logcat.txt`, the `.slice`/`.engine*` intermediates and the harness
inputs (`.messages.json`, `.turn*.json`) were left on the machine: they are
reproducible from the harness and carry nothing the three files above lack.
