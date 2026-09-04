# Kalsa MoE experiments

Measurement and design repository for running large MoE (and dense) models on
Android phones: CPU, Adreno/Mali GPU, Hexagon NPU. It holds no product code.
Product code lives in the sibling repos and is referenced here **by SHA or tag,
never by checkout path** (see `docs/NAMING.md`):

| Repo | Role |
| --- | --- |
| `Aspis0/kalsa` | the app (React Native + llama.rn overlay of the fork) |
| `Aspis0/kalsallama` | our llama.cpp fork: OpenCL MoE kernels, repack, governor |
| `Aspis0/kalsa-forkbigmoeonedge` | engine wrapper (submodule `BigMoeOnEdge/`) |
| this repo (private) | plan, evidence, audits, scripts, design docs |

## Where to look first

1. `PLAN.md` — **STATO CORRENTE** (goal, facts, current plan, constraints, live
   rules) followed by the dated diary and the checkpoint register. Read the
   diary from the bottom. Kept under ~500 lines of prose; older chapters are
   moved verbatim to `PLAN-archive.md`.
2. `docs/ALIVE.md` — the live results table (one row per banked cell) plus
   the three-engine map by Snapdragon generation (§8). This is what the owner reads.
3. `docs/PLAN-governor-in-app.md` — the current phase: hosting the per-phase
   governor (prefill on GPU, decode on CPU, NPU lane later) inside the app.
   `docs/GOVERNOR-STATE-2026-09-04.md` digests everything measured, decided and
   implemented on the governor so far.

## Layout

- `scratchpad/agents/<cell>/` — one folder per measurement cell:
  `PREREG.md` (locked before numbers), driver scripts, `raw/`, `REPORT.md`,
  `AUDIT-*.md`. A cell is banked only after PREREG → audit → run → REPORT →
  audit, then it gets an ALIVE row and a PLAN register entry.
- `docs/` — design docs and their hostile audits (`*.AUDIT.md`), state
  digests, upstream research. `docs/archive/` holds superseded material.
- `results/` — raw experiment output of the early campaigns (large logs, CSVs).
- `reports/` — phase reports (`moe-f<N>.md`).
- `scripts/` — Termux/device build, bench and download scripts; `scripts/analysis/`
  log parsing and plots. `analysis/`, `traces/` — cache simulation, expert traces.
- `ops/` — operational runbooks (macOS migration, bootstrap prompt, memory backups).
- `mandates/` — signed owner mandates (what may ship, adoption rules).
- `quality/` — PPL baselines; `corpus/` — evaluation prompts; `prompts/` — bench prompts.
- `backups/` — git bundles of the engine lineage (`backups/README.md`).
- `deps/` — vendored OpenCL/Vulkan Android headers used by device builds.
- `patches/`, `tools/` — small patches and helper tools.
- `logs/` — committed commit-message drafts and small run logs.
- `kalsa-engine/`, `models_staging/` — local build/staging dirs, ignored.

## Method rules

1. Lock the preregistration before collecting numbers; amendments are dated.
2. Writer and auditor are different models; every audit is hostile.
3. One variable at a time; one row per run; never commit GGUF files.
4. Measure on real hardware only: never an emulator, never with USB charging
   (on QDC boards there is no battery, so the thermo source is tagged).
5. Never open upstream issues: we fix it in the fork or we drop it.
6. Every step updates all living docs in the same commit: PLAN diary and
   STATO CORRENTE, ALIVE, the cell REPORT, and the session memory.

## Lab today (September 2026)

The physical phones (S23, Jelly) are out of reach until the owner returns.
All device work runs on Qualcomm Device Cloud (`docs/ALIVE.md` rows 43–47
document the traps: `/data` mode holder, keyguard, session name length, port
6037 tunnel) and Android builds run on CI, never on a laptop.

## Building on a phone (Termux, historical lane)

```bash
bash scripts/build_llama_termux.sh          # GGML_NATIVE=OFF, armv8.2-a+dotprod+i8mm+fp16
bash scripts/preflight_llama_isa.sh --binary <bin> --build-dir <dir>
```

`GGML_NATIVE=ON` is unsafe on the S23 (SVE/SME probe). `run_bench.sh` must run
the ISA preflight for phases F1–F4; `PREFLIGHT_ISA=0` is rejected for
scientific phases.
