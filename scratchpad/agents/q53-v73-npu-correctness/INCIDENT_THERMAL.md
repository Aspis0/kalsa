# INCIDENT — Galaxy S23 thermal shutdown during v73 HTP perplexity (2026-08-25)

**Status: DEVICE DOWN.** Owner report 25/08 ~04:00 UTC: S23 "bollente, si è
spento e non si riaccende più". ALL S23 device work HALTED.

## Timeline (UTC, from RUN_LOG/raw)
- 24/08 16:34 → 21:00 session 1 (unplugged 72% → 21%): lane-1 HTP PPL abort
  (dspqueue_write 0x1, 13:06 local), CPU-ref 32 chunks, lane-2 HTP probe rc=0,
  lane-2 HTP PPL interrupted at 8/32 — "adb disconnect", last recorded temp
  33.8 °C (post-probe capture, NOT during the PPL run).
- Owner recharged the phone (21% → 95%); reconnected 23:02 local, 30.1 °C.
- 25/08 session 2 (unplugged 95%): q53b b512 arm — 9 chunks then
  dspqueue_write 0x1 (rc=134). Then lane-2 HTP PPL (Qwen3.5-4B-Q4_0, full
  model on HTP0, -b 2048 -ub 1024): 4/32 chunks, then `device offline` at
  03:46:11Z; reconnect actively refused (10061) while mDNS still advertised.
- Owner finds the device very hot, powered off, not booting.

## Reading (correlation, causation not proven)
Both "adb offline" events happened DURING the lane-2 HTP PPL of the hybrid
model — the only workload that puts the whole 4B graph on the NPU for tens of
minutes without pause. Session-1 drop = most likely a first thermal shutdown
that the phone recovered from (it booted after the owner charged it).
Session-2 drop = second thermal shutdown, this time not recovering
(battery-protection / thermal cutoff, or hardware damage — unknown).
Possible contributor: v73 DSP state after a PD death/`dspqueue` failure
(q53b died 30 min earlier in the same session) leaving the NPU in a
high-power state outside the OS thermal governor — hypothesis only.

## Harness gap (ours)
Battery temperature was captured PRE and POST each arm and used only as a
cool-start (≤35 °C) gate. There was NO intra-run thermal watchdog: a 40-min
HTP run had no abort threshold. Cooldowns existed only BETWEEN arms.

## Rule from now on (all devices)
1. Every sustained device run (> 2 min) runs under a thermal watchdog on the
   device: poll `dumpsys battery` temperature every 10 s; **kill the binary
   at ≥ 43 °C** (hard), log a WARN at 40 °C; record the max temp per run.
2. NPU/HTP sustained runs on v73-class: OFF until the owner decides; if ever
   resumed, 10-min run cap + watchdog + plugged-in disallowed (charging adds
   heat).
3. Perplexity-class workloads (long, no idle gaps) get the watchdog even on
   CPU-only arms.

## Consequences
- q53 lane 2: CLOSED-INCOMPLETE (4/32 + 8/32), never to be resumed on this
  device in this form.
- Router ledger: R6 (v73 dense/hybrid NPU) → **hard OFF, thermal-shutdown
  incident**; R7 already hard OFF (q53/q53b).
- Upstream report: add the observation as a qualified note (two shutdown
  events during sustained HTP load, device not recovered), not as a claim.
