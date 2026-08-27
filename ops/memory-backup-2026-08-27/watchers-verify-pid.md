---
name: watchers-verify-pid
description: "File-watchers can't detect dead agents — verify the launcher PID at every board check; a 0-byte out.log + dead pid = died at launch"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-14T04:20:43.086Z
---

A report-file watcher only sees the report appear; it cannot distinguish a
slow agent from a dead one. On 2026-08-13 the kernel-S2 measurement grok
died AT LAUNCH (out.log 0 bytes, pid gone) and sat undetected for ~4 hours
while the board said "in volo" — the user caught the inconsistency, not me.

**Why:** detached Start-Process groks (see [[background-kills-at-compaction]])
have no harness tracking; the watcher is the only signal and it's
one-directional (fires on success only, never on death).

**How to apply:** every time the board is summarized or a "is X still
running?" question comes in, verify ground truth: `Get-Process -Id (cat
pid.txt)` + out.log size/mtime. Consider a dead-man leg in watchers: fire
also when the pid disappears without a report.

**Caveat (2026-08-14):** the Start-Process pwsh WRAPPER pid is unreliable —
when grok self-updates at launch it re-execs and orphans from the wrapper
(wrapper exits, out.log stays 0 bytes forever, work continues). False
"dead" alarm. Ground truth for grok = `Get-Process grok` (grok.exe runs as
its own process, StartTime matches the launch) + the session's
`updates.jsonl` mtime under `~/.grok/sessions/<cwd-encoded>/`. After every
launch, re-resolve the REAL grok pid and store that in pid.txt. For pi:
report.md existence + child node CPU burn (it buffers stdout to the end;
0-byte log means nothing).

**Caveat 2 (2026-08-14, same night):** `ps -W | awk '{print $1}'` pid
checks inside a BACKGROUND bash watcher fired false DEAD twice at the
first tick while the process was alive per Get-Process. Don't put pid
checks in bash watchers at all — the reliable watcher-side liveness signal
for grok is the mtime of the session's `updates.jsonl` (grok streams
thought/tool events continuously; >20 min silent + no report = really
dead/hung). Pid checks stay in interactive PowerShell only.
