# Energy Framework — Status & Recovery

This is the recovery point for the energy work. The framework is on `main` through
merge `16ba535` (`merge: energy framework into main`). This checkout is the
follow-up branch `kalsa/energy-merge` at that merge, with `origin/main` at the
same commit. Read this file, then `ENERGY-SCHEMA.md` and
`ENERGY-PERPHASE-FINDINGS.md`.

## Current state

| Area | State |
|---|---|
| Measurement framework | **DONE.** Jelly battery-terminal sampling, v2 fallback, engine-stamped v3 phase boundaries, coverage and bias reporting, counts provenance, and hostile-audit trail are merged. `energySchemaHarness` is 77/0 and `energyPhaseSplitHarness` is 94/0. |
| Core placement | **CLOSED NEGATIVE.** A55-only decode costs about 5x the A76 control's time. The pilot's energy rows were correctly invalidated by doze and sampler-cadence warnings, so no energy policy should be built on the little-cluster lever. |
| Engine axis | **OPEN.** CPU versus GPU versus NPU is the governor's actual decision space now that core placement is closed. |
| S23 energy | **BLOCKED from the shell.** Samsung denies the shell user the battery sysfs current, voltage, temperature and status nodes. The current protocol can collect timing, thermal and clock evidence there, but not comparable joules. |
| ADPF | **PLATFORM LEVER.** The Jelly exposes `IHintManager` and `IThermalService`, but a hint session takes the caller's own thread IDs. Inference must run inside the app before an app-side ADPF session can control it. |

## Where the evidence lives

- `scripts/energySchema.mjs` and `scripts/energyAggregate.mjs`: shared parsing,
  integration and CodeCarbon-compatible export.
- `scripts/energyPhaseSplit.mjs`: v2 unstamped arithmetic and v3 stamped
  load+idle, prefill and decode buckets.
- `scripts/energy-sample.sh`: the on-device sampler, with `t_s` from
  `/proc/uptime`.
- `scripts/device-ngram-spec.sh`: the original campaign harness.
- `scripts/device-energy-sweep.sh`: the audited ABBA placement/engine sweep;
  `40ca30d` holds the device awake during each arm and marks dozed blocks
  uninterpretable.
- `device-ngram-spec-out/`: the tracked G99 v2 reference sidecars and campaign
  outputs; `device-v3-out/`: the stamped Jelly campaign and report.
- `docs/ENERGY-SCHEMA.md`: the contract. `docs/ENERGY-PERPHASE-FINDINGS.md`:
  the G99 baseline and its usage rules. The hostile audits are the `ENERGY-*.md`
  files at the repository root.

## Ordered next steps

1. **Framework complete.** Treat the v2 sidecars and the stamped v3 campaign as
   reference evidence, with coverage, thermal state and session idle floor
   attached. Do not carry v2 numbers over as v3 numbers.
2. **Run the engine-axis experiment on the Jelly.** Use
   `scripts/device-energy-sweep.sh` with temperature-gated ABBA ordering and its
   audited placement proof. The instrument has been validated on device; it now
   holds the device awake and gates a block when doze is observed. Compare CPU,
   GPU and NPU execution only within a session with its own idle floor.
3. **Evaluate ADPF from inside the app.** Use the Jelly's `IHintManager` and
   `IThermalService` through an app-owned inference session; the shell CLI cannot
   provide the thread IDs that a hint session requires.
4. **Revisit the S23 only with app-side sampling.** Until a high-rate battery
   current path is implemented in the app or framework, use the S23 for timing,
   thermal and clock replication only. Coordinate before touching it, run
   unplugged above the project battery floor, and measure that session's own
   floor.

## Closed findings and rules

- N-gram self-speculation is not an app knob: the favorable tuned cases do not
  provide a reliable latency-and-energy win, and `ngram-cache` also fails the
  greedy-transparency gate on the hybrid KV path.
- Core placement is not a policy target: the measured latency cost is far outside
  the owner's +25% reading bound, while the pilot's energy comparison is invalid
  once doze and cadence are accounted for.
- Never benchmark while charging. The campaign preflight and mid-run checks are
  safety gates, not substitutes for the sampler's recorded status column.
- Absolute joules are session-relative. Compare within-session deltas and ratios
  only after the session floor, temperature gate, ordering and coverage are
  recorded.
