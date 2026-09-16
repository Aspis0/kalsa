# Energy Framework — Status & Recovery

Single entry point to resume work. Updated 2026-09-15 after Tema 1 closed on the
Jelly Star, and revised the same day after the Fase-2b self-audit
(`ENERGY-2B-SELF-AUDIT-2026-09-15.md`). Read this, then `ENERGY-PERPHASE-FINDINGS.md`
for the numbers.

## Where the framework stands (5 themes, dependency order)

| Tema | Name | State |
|---|---|---|
| 1 | Per-phase (prefill/decode) J profiler | **DONE on Jelly** (this branch). S23 replication queued. |
| 2 | Energy-objective decision layer | Split into 2a and 2b on 2026-09-15; the two do NOT depend on each other. **2a** = phase stamps that unlock true prefill J. **2b** = an energy-objective policy on the existing governor seam. Both detailed in Next steps. |
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
- Fase-2b planning: `ENERGY-2B-SELF-AUDIT-2026-09-15.md` (repo root) — the
  orchestrator's hostile self-audit of the first 2b experiment proposal. Read it
  before dispatching any 2b work: it retracts three claims made from this doc's
  earlier framing (noise floor, "no code needed", three-arm shape).
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

- **Jelly Star** 192.168.1.82:5555 — ours. 2026-09-15 evening: 89 % and charging
  (AC), so no campaign until unplugged. Harness artefacts: `taskset` is present
  (`/system/bin/taskset`, toybox 0.8.6-android), bare hex masks only (`3f` → cpu0-5,
  `c0` → cpu6-7; `0x3f` is rejected as a bad mask), topology is 6×A55 @2.0 GHz +
  2×A76 @2.2 GHz.
- **Galaxy S23** 192.168.1.152:43089 — ANOTHER SESSION's device. 2026-09-15:
  charging (AC), ~23 %, storage cleaned on the owner's instruction from 94 % to 63 %
  full (39 GB free; record in `~/kalsa-models/s23-cleanup-2026-09-15.md`). Needs:
  > 80 %, unplug, explicit coordination before any campaign. LFM2.5-* are still not
  on it — `/data/local/tmp/llamabench/` does not exist, so provisioning is part of
  the campaign. `com.kalsa.app` holds 15.6 GiB of another session's model set: do not
  touch.

## Next steps (ordered, revised 2026-09-15 after the self-audit)

1. S23 replication of the per-phase campaign. Handover protocol agreed with the
   other session (message of 2026-09-15 late): they will release the S23 explicitly
   by message after their overnight T20C campaign; do NOT assume > 80 % charge on
   handover, because that campaign discharges it materially — plan a recharge first
   (the S23 charged at ~1 %/min from ~23 % at 21:12). No overlap: no S23 action until
   their explicit release.
   Provisioning is cheap, measured: `adb push` runs 17.8 MB/s, so ~2.4 GB of models is
   ~2.5 min, and the G99 campaign itself took 14m44s. Blocked only on: unplugged,
   >80 %, coordination.
2. Fase 2a — phase stamps. It is NOT part of any 2b bus, and two facts found on
   2026-09-15 make this much smaller than this doc's earlier framing:
   - the fork already splits policy from mechanism: `src/llama-governor-policy.{h,cpp}`
     (thermal classification, `admit_prefill`, `select_decode`, hysteresis) with
     `llama_governor` holding it behind `policy_enabled_` (default off = the legacy
     byte-identical path). There is no bus to build.
   - the phase durations are already measured and already reach the CLI: the device
     `llama-cli` is a client of an embedded server, reads `chunk["timings"]`
     (`tools/cli/cli-context.cpp:351-380`) and keeps only two doubles in `cli_timings`
     (`cli-context.h:14-17`), while the server sends `prompt_ms`/`prompt_n`/
     `predicted_ms`/`predicted_n` (`tools/server/server-task.cpp:244-250`).
     `mark_N` (device uptime, same clock base as the CSV `t_s`) is already the anchor,
     so walking back from it with `predicted_ms` and `prompt_ms` yields the
     load/idle, prefill and decode buckets with **no new clock and no engine change**.
     Do not introduce a second clock: `/proc/uptime` is `get_monotonic_boottime()`
     (kernel commit 1d98a5fa), so a CLOCK_MONOTONIC stamp would silently drift from
     the CSV on any device that suspends.
   Re-anchoring means new numbers: schema v3 plus an explicit reconciliation with the
   v2 figures (the v1→v2 lesson).
   Still owed after 2a lands: cross-build arm64 into `tmp/build-android-phase-stamps/bin`,
   NOT into `tmp/build-android/` — `scripts/fixtures/energy-counts/README.md` pins the
   md5 of the pristine binaries there (`llama-cli` cca1187c7974655a50efe45d3cfd73d8,
   `libllama-cli-impl.so` 4e1eab9cd3d99a65373fe720193e4c24), exactly as it pins the
   line numbers in `tmp/kalsallama-pin`.
3. Step 0 and the Jelly v3 campaign are ONE device session, decided 2026-09-15. A run
   with stamps ON can be read both ways (v3 with them, v2-style by ignoring them via the
   tool's fallback), but a stamps-free run can never be upgraded to v3 — so a separate
   v2 repeatability session would be work to redo. Therefore: **three back-to-back runs
   of the v3 protocol on the Jelly**, which yields all three of
   (a) the v3 numbers, and the reference the S23 replicates;
   (b) step 0: within-run and between-run spread = the minimum detectable effect that
       the self-audit's F1 says does not exist (2.6B/PURE spreads 10.06 % across three
       reps while passing every published gate, against 0.68 % on 1.2B/REP);
   (c) the v2→v3 delta measured on identical runs, with no device difference in it.
   Read it with `node scripts/energyPhaseSplit.mjs <dir> --counts-manifest
   scripts/fixtures/energy-counts/manifest.csv`. Until (b) exists, any A/B on this
   metric is unfalsifiable.
4. Fase 2b — an energy-objective policy on that seam, after step 0 clears. Two
   corrections to this doc's earlier framing, both from the 2026-09-15 recon:
   - the lever is **not** mechanism design. ggml's affinity apply is compiled out by the
     glibc-only guard `#elif defined(__gnu_linux__)` (`ggml-cpu.c:2907`), with an Android
     implementation dead inside it at `:2923-2924`, while NDK r27 declares
     `sched_setaffinity` with no API gate. The app already fills a best-cores mask with
     `strict_cpu = true` (`node_modules/llama.rn/cpp/jsi/JSIParams.cpp:25`, `:60-61`,
     used at `:333`) and pins into the void, so `-C`, `-Cr`, `--prio`, `--poll` and
     `--numa` are all inert. The repo already measured the fix on the G99:
     `archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md` (+26 % prefill pinned at 8
     threads, 28.48 vs 21.48; decode prefers the two big cores, 6.39 vs 6.07). F3 of
     the self-audit therefore becomes **port-and-gate**, with one trap kept: a bare
     guard flip is NOT default-off, because the mask is always filled — the gate has to
     suppress mask-filling unless a mask is requested.
   - F7 is unchanged: that lever is MNN-AECS's lever one engine away, so a positive
     result is a transfer/validation, not novelty. Our own candidate-novel object stays
     the split-context prefill/decode handoff as a schedulable boundary.
5. Fase 3: DFlash acceptance+energy gating on S23 (Qwen3.5-4B), Jelly cross-check.
   Prior art is direct (PELM 10.1145/3774906.3802783, AHASD 2604.25326, GELATO
   2605.10124) — position differentially or drop.
6. Fase 4: ADPF actuator. Verified from the official docs on 2026-09-15:
   `PowerManager.getThermalHeadroom` is API 30 (NDK `AThermal_getThermalHeadroom`
   API 31) → **available on the Jelly (SDK 33)**; `Session.setPreferPowerEfficiency`
   is Android 15 = API 35 → **S23 only (SDK 36)**. So Fase 4 runs at two different
   depths on the two devices.

## Slowdown bound (provisional, owner's reading rule)

Owner, 2026-09-15: "accept up to +25 % decode time if J/token drops by ≥15 %" — and,
explicitly, **measure first, then decide**. So this is a reading rule for a published
curve, not a pre-fixed threshold, and F12 of the self-audit is closed on those terms:
sweep the lever, publish the whole J/token-versus-slowdown frontier, and pick the point
afterwards. Publishing the full frontier is what removes the anti-rationalization
problem a fixed threshold was there to solve — there is no threshold left to move.

## Prior art (checked 2026-09-15, before any mechanism claim)

Temi 1, 2b and 3 all have direct published prior art. Our contribution is not the
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
