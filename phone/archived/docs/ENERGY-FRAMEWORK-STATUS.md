# Energy Framework — Status & Recovery

This is the recovery point for the energy work. The framework is on `main` through
merge `16ba535` (`merge: energy framework into main`). The working branch is now
`main`, with `origin/main` at the same commit. Read this file, then
`ENERGY-SCHEMA.md` and
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

## Measurement discipline

The between-run spread of the per-phase metric is **2–7 %**. A sequential A-then-B
design cannot distinguish effects below roughly **5–10 %** (and **25.4 %** for
1.2B/REP once the nested run effect is included), so a comparison needs ABBA
interleaving inside a thermally stable window, a temperature gate, and a
per-session idle floor.

The thermal-collapse result is a throughput result, not an energy-per-token result:
decode time grows **26–52 %** cold-to-warm while joules per token move only
**−6 to +7 %**. This is why the temperature gate and the ordering are part of the
measurement contract.

## Cross-build rule

After a fork change, the arm64 build goes to
`tmp/build-android-phase-stamps/bin/` and never into `tmp/build-android/`.
`scripts/fixtures/energy-counts/README.md` pins the md5 of the pristine binaries
in `tmp/build-android/` (`llama-cli`
`cca1187c7974655a50efe45d3cfd73d8`, `libllama-cli-impl.so`
`4e1eab9cd3d99a65373fe720193e4c24`), exactly as it pins line numbers in
`tmp/kalsallama-pin`.

## Devices and handover

- **Jelly Star** `192.168.1.82:5555` is the device that can be
  energy-measured from the shell using the battery-terminal sampler. Keep every
  campaign unplugged and above the project battery floor; carry the session's
  own idle floor, temperature gate, ordering and coverage state with its results.
- **Galaxy S23** `192.168.1.152:43089` is another session's device. It cannot be
  energy-measured from the shell because Samsung denies the shell user the
  battery sysfs nodes; see `S23-ENERGY-BLOCKER.md`. It may provide timing,
  thermal and clock evidence, but not comparable shell joules.
- **Handover protocol:** do not touch the S23 until the owning session explicitly
  coordinates its release. Agree on the device state before use, confirm it is
  unplugged and above the battery floor, record the starting battery and thermal
  state, and return the device with its state and any interruption reported to
  that session. A campaign on the S23 is not authorized merely because it is
  reachable.

## Slowdown bound (provisional, owner's reading rule)

Owner, 2026-09-15: "accept up to +25 % decode time if J/token drops by ≥15 %" —
and, explicitly, **measure first, then decide**. So this is a reading rule for a
published curve, not a pre-fixed threshold, and F12 of the self-audit is closed on
those terms: sweep the lever, publish the whole J/token-versus-slowdown frontier,
and pick the point afterwards. Publishing the full frontier is what removes the
anti-rationalization problem a fixed threshold was there to solve — there is no
threshold left to move.

## Prior art (checked 2026-09-15, before any mechanism claim)

Tema 1, 2b and 3 all have direct published prior art. Our contribution is not the
mechanism; it is the measurement discipline (battery-terminal ~1 Hz, published
coverage and bias, a retraction trail), the negative results, and the hybrid LFM2.5 /
llama.cpp-fork setting.

- Phase-level energy on mobile: "How Do Prompt Variations Affect Energy Consumption
  in On-Device LLMs?" (arXiv 2609.01798) profiles prefill and decode energy
  separately; 2607.22568; 2605.27435 (stage-level, OPMASK).
- Energy-aware engines and governors: MNN-AECS (2506.19884) — "the first engine-level
  system solution without requiring root access", adaptive low-power core selection
  during decode, 23 % energy cut at no slowdown over 7 devices; CORE (MLSys'26 Oral)
  — unified DVFS governor, "default governors make independent decisions" costing
  23.0–40.4 % latency or 5.0–16.6 % energy; EnerInfer (2606.23001); 2507.02135;
  DVFSLM (2609.13153).
- Speculation plus energy: PELM, AHASD, GELATO, and a battery-aware speculative
  decoding scheduler (ICPP'26).

Release status of the two closest neighbours, as far as it could be checked: MNN-AECS
has no code link on its abstract page, one arXiv version (v1, 2025-06-24), and no
file name or commit in `alibaba/MNN` master implementing it (the single "AECS" commit
match is acoustic echo cancellation, `c3cdf189`). That is *not* proof of absence — the
authors are MNN maintainers and the check covered names and commit messages, not the
whole tree. CORE's actuator is DVFS, so an unprivileged app cannot use it by
construction.

## House rules

- Agents get prompts in English; Italian only with Marco. Code/comments/docs
  English (AGENTS.md at both repo roots).
- DeepSeek audit (pi/opencode-go/deepseek-v4.1-flash, hostile, executed checks)
  before every push; push only with Marco's explicit approval.
- Never benchmark while charging (preflight gates enforce it); timings on
  charge are not comparable.
- Every new mechanism: verify prior art online first, and never state
  provenance/date/absence claims without checking.
