---
name: pgrep-misses-exec-wrapper
description: "Device harness wrappers exec into the real script, so pgrep on the wrapper name finds nothing on a LIVE harness — check before every launch or you spawn a duplicate that corrupts cold runs"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-16T23:58:03.457Z
---

`run_kf_cold_jelly.sh` is a thin wrapper that ends in
`exec bash "$HERE/run_kf_reality_jelly.sh"`. After the exec the process
cmdline is the INNER script, so `pgrep -f "run_kf_cold_jell[y]"` matches only
for the first ~5 seconds and returns **empty on a perfectly healthy harness**.

On 2026-08-16 I read that empty result as "nothing is running" and launched a
second harness — **twice in one day**. The first time it cost block 16 of the
K-F cold cell: two `bmoe-cli` processes held the model mmap'd, `fadv` returned
rc=3 ("still has 618912 resident pages"), and three retries were all correctly
excluded by the cold-validity gate. The second time I caught it because the
duplicate was still in its 300 s cooldown, so no measured run collided.

**Why it is worse than a wasted process:** two harnesses do not just race for
CPU, they defeat the *cold* reset, and warm is precisely where K-F loses. A
silently warm run does not add noise, it biases the cell toward refuting our own
hypothesis. See [[watchers-verify-pid]] for the inverse failure (watcher can't
see the dead).

**How to apply:** before launching ANY device harness, enumerate with
`ps -o pid,ppid,args | grep -i "<inner-script>\|bmoe"` — never `pgrep` on the
wrapper name alone. Grep the INNER script name and the binary. After launching,
verify PPID=1 from a *fresh* ssh session, and re-check that exactly ONE harness
exists. If two appear, kill the newer one immediately and check the most recent
`COLD_RESET` line for `fadv_rc=0` and `drop_mb` above threshold before trusting
the block.
