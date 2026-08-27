---
name: monitor-tail-locks-logs
description: "On Windows, a Monitor tail -f on a log file blocks the producer's Add-Content — never tail a file a running script appends to"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-16T12:00:37.051Z
---

Arming a Monitor with `tail -n 0 -f STATUS.txt` (Git-bash) on Windows **locks the
file against the PowerShell runner that appends to it**. The runner's
`Add-Content` throws `IOException: GetContentWriterIOError`, and with
`$ErrorActionPreference = "Stop"` that kills the whole measurement run.

Observed 2026-08-16: cost two F5 measurement runs (~9 min each) before the cause
was found. The tail looks harmless because it opens for reading; Windows share
flags make it not harmless.

**How to apply:**
- Do not `tail -f` a file that a running Windows process appends to. Watch a
  *different* signal instead: the per-arm output files, a sentinel file the
  runner touches on completion, or just the background task's own completion
  notification.
- Make runner logging tolerant anyway (retry then fall back to stdout) so a stray
  reader can never kill a long measurement — the per-arm logs written by
  `Start-Process -RedirectStandardOutput` are separate files and survive.
- Related trap from the same session: launching with `&` inside a
  `run_in_background` Bash task orphans the child, which the harness later kills.
  Launch the script directly as the background command. See
  [[background-kills-at-compaction]] and [[watchers-verify-pid]].
