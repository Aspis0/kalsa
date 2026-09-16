# Energy Framework — Status & Recovery

Single entry point to resume work. Updated 2026-09-15 after Tema 1 closed on the
Jelly Star. Read this, then `ENERGY-PERPHASE-FINDINGS.md` for the numbers.

## Where the framework stands (5 themes, dependency order)

| Tema | Name | State |
|---|---|---|
| 1 | Per-phase (prefill/decode) J profiler | **DONE on Jelly** (this branch). S23 replication queued. |
| 2 | Modular policy/actuator bus (fork C++) | Not started. Branch `kalsa/energy-bus` off the fork pin. Include an in-engine phase timestamp (prompt-eval-only J is not resolvable at 1 Hz with load in-window — see findings doc). |
| 3 | Acceptance+energy-gated speculation (DFlash) | Not started. Baseline ready: decode J/tok 1.2B vs 2.6B = 2.20-2.21x (REP-vs-REP only). |
| 4 | J-driven MoE expert residency | Blocked on HTP/NPU lane. |
| 5 | Homeostatic multi-effector loop | Capstone; needs 2-4. |

## Where everything lives (worktree /Users/marco/Projects/kalsa-ngram-spec, branch energy-framework)

- Code: `scripts/energySchema.mjs` (shared parser/integrator + CodeCarbon-MIT
  emissions export), `scripts/energyAggregate.mjs` (+`--emissions`),
  `scripts/energyPhaseSplit.mjs` (per-rep prefill/decode split, schema
  kalsa-energy-rep-v2), `scripts/energy-sample.sh` (on-device 1 Hz sampler),
  `scripts/device-ngram-spec.sh` (campaign harness, self-provisioning).
- Tests: `scripts/energySchemaHarness.mjs` (77 checks), `scripts/energyPhaseSplitHarness.mjs`
  (74 checks). Both wired into CI (bench/apk workflows).
- Data: `device-ngram-spec-out/` (G99 baseline campaign: 2 models x PURE/REP x
  3 reps, arms=none + `*.phases.csv` sidecars), `device-ngram-spec-out-ngram-2026-09/`
  (archived n-gram A/B, verdict NO for the app), `device-counts-out/` (exact
  token-count runs), `scripts/fixtures/energy-counts/` (tracked manifest + raw
  counts + method README).
- Docs: `ENERGY-SCHEMA.md` (schemas v1 frozen / rep-v2 + CodeCarbon mapping),
  `ENERGY-PERPHASE-FINDINGS.md` (the G99 baseline results + usage contract),
  `NGRAM-SPEC-FINDINGS.md` (n-gram verdict: NO).
- Audit reports (repo root): `ENERGY-SCHEMA-AUDIT-2026-09-15.md` (SHIP after F1-F13),
  `ENERGY-PHASE-AUDIT-2026-09-15.md` (NO-SHIP: bucket semantics),
  `ENERGY-PHASE-AUDIT-R3-2026-09-15.md` (NO-SHIP narrow: coverage honesty),
  `ENERGY-PHASE-AUDIT-R4-2026-09-15.md` (SHIP, notes N1-N6 fixed in f88a961).

## Headline results (G99, LFM2.5 Q4_K_M, --temp 0)

- Decode energy: 2.6B costs **2.20-2.21x** per token vs 1.2B (REP-vs-REP, the
  only sanctioned cross-stem read). PURE stems are low-resolution buckets
  (flagged in the sidecar `warnings` column; coverage 62-99% published).
- Exact token counts (from the embedded server's SSE `timings`, which the CLI
  client used to discard): 1.2B PURE 51/30 (EOS-truncated), 1.2B REP 72/256,
  2.6B PURE 52/204, 2.6B REP 73/256.
- v1 phase numbers were RETRACTED (prefill bucket was idle+load). The audit
  trail tells the story; trust only the v2 sidecars.

## Devices

- **Jelly Star** 192.168.1.82:5555 — ours. Battery 51% last seen, cool.
- **Galaxy S23** 192.168.1.152:43089 — ANOTHER SESSION's device. Last probe:
  charging (AC), 10%. Needs: charge > 80%, unplug, explicit coordination
  before any campaign. Models LFM2.5-* not verified on it yet.

## Next steps (ordered)

1. S23 replication of the per-phase campaign (same protocol; arm64 binaries in
   `tmp/build-android/bin` should run on both devices — verify with the harness
   smoke step). Coordinates with the other session.
2. Fase 2: fork worktree, branch `kalsa/energy-bus` off the pin; EnergyPolicy /
   Actuator interface split of the governor (default behavior byte-identical,
   gated); in-engine phase timestamps to unlock true prefill J.
3. Fase 3: DFlash acceptance+energy gating on S23 (Qwen3.5-4B), Jelly cross-check.
4. Fase 4: ADPF actuator (probe PerformanceHintManager on both devices;
   Fixed Performance Mode for calibration runs; Power Efficiency Mode API 35+).

## House rules

- Agents get prompts in English; Italian only with Marco. Code/comments/docs
  English (AGENTS.md at both repo roots).
- DeepSeek audit (pi/opencode-go/deepseek-v4.1-flash, hostile, executed checks)
  before every push; push only with Marco's explicit approval.
- Never benchmark while charging (preflight gates enforce it); timings on
  charge are not comparable.
- Every new mechanism: verify prior art online first, and never state
  provenance/date/absence claims without checking.
