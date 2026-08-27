---
name: background-kills-at-compaction
description: Session-tracked background tasks get killed at context-compaction boundaries; launch long externals detached via Start-Process
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-13T17:24:34.034Z
---

Four separate waves of "Background command was stopped" kills (2026-08-11..13) all
landed EXACTLY at context-exhaustion/compaction boundaries of the Claude session
(evidence 2026-08-13: three agents' out.log all died 13:13:38-13:13:58, continuation
session shell started 13:18). The user never stopped anything ("nono non ho fatto
niente"). Harness-tracked background shells (Bash run_in_background) die WITH their
child process tree; detached processes survive (LFM2.5 pipeline pwsh launched via
Start-Process survived every wave).

**Why:** when the conversation runs out of context and is compacted/continued, the
session's tracked background tasks are stopped by the harness. Kills repeatedly hit
agents at ~90% completion, right before report-writing.

**How to apply:** any external agent or job expected to run >10 min must be launched
DETACHED: `Start-Process pwsh -WindowStyle Hidden -ArgumentList '-NoProfile','-Command', "& '<grok/pi>' ... *> '<log>'"`
(record the pid to a file). For notifications, arm a separate lightweight TRACKED
Bash watcher polling for report.md — if compaction kills the watcher, nothing is
lost; re-arm it in the continuation. Short jobs (<10 min) can stay tracked. Killed
grok work is salvageable: sessions persist (`grok -c` in same cwd) and partial
artifacts stay on disk — write a RESUME followup with the known-state baked in.
See [[moe-exp-recovery]].
