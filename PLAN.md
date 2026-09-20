> Archived full history: archived/PLAN-2026-09-full.md (3162 lines, Italian, frozen 2026-09-20).

# Kalsa: PLAN (living)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, this PLAN and `docs/ALIVE.md`. Everything older is frozen under `archived/`. This file
replaces the Italian PLAN as the living document;
the full history (the dated decision diary and the register of banked measurements) is in
`archived/PLAN-2026-09-full.md`.

## What Kalsa is

Kalsa is an Android chat app that runs language models on the phone itself, with no server in
the loop. The standing goal (owner; recorded at `archived/PLAN-2026-09-full.md:9`) is a kernel
that uses NPU, GPU and CPU **per phase** according to temperature, battery and device profile,
optimised for Snapdragon and for MediaTek/Jelly where possible. The app already imports the
forked `llama.rn` binding (`src/engine/LlamaService.ts:13`,
`src/engine/EmbeddingService.ts:35`). What is not in use is the per-phase governor, which is off
by default; see "Governor" below.

The app is React Native. The engine is our fork of llama.cpp, consumed through our fork of the
`llama.rn` binding as a git dependency pinned by commit. Device measurements are the arbiter; the
lab repo holds the method, the raw evidence and the audits.

## The four live repos

The authoritative map, with the canonical role and status of each repository, is `REPOS.md` in
the app repo (`Aspis0/kalsa`, file `REPOS.md`). Defer to it; do not restate it here.

The four live checkouts named in the repo map exist on this Mac (checked with `ls -d`):

| repo | local checkout | role |
|---|---|---|
| `Aspis0/kalsa` | `~/Projects/kalsa` | the app |
| `Aspis0/kalsallama` | `~/Projects/kalsallama` | our llama.cpp fork: OpenCL MoE kernels, repack, governor |
| `Aspis0/llama.rn` | `~/Projects/llama.rn-kalsa` | the React Native binding fork, now on the `vendor/` layout |
| `Aspis0/kalsa-moe-experiments` | `~/Projects/kalsa-moe-experiments` | the lab: this repo, measurements and evidence |

One repository is archived read-only: `Aspis0/kalsa-forkbigmoeonedge`, kept as a submodule of
the lab for provenance of the PC campaign binary. `REPOS.md` records that status.

## The two-living-docs rule

`PLAN.md` and `docs/ALIVE.md` are the only two living documents. Two classes of live record sit
outside `archived/` on purpose: the dated findings and contracts under `analysis/`, and the
per-cell evidence under `scratchpad/agents/`. Every other `.md` is frozen, either under
`archived/` or in place where it was produced (the campaign material under `results/`,
`reports/`, `ops/` and `scratchpad/`). The count is whatever this command prints, so it cannot go
stale: `git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l`. Preserved archive
blobs are byte-fidelity copies:
they keep their original language, Italian included, and are not translated. The rule exists
because duplicate living docs have twice cost real time: two files that both claim to be current
always drift, and a reader cannot tell which one is stale.

## Verified state, 2026-09-20

Each item in this section names the command or file that proves it. Run the command to get the
current value; values that move under concurrent work are not restated as if frozen, because a
reader cannot tell how old a copy is.

### The app and its engine pin

- `Aspis0/kalsa` `origin/main` is `5429799`. It pins the binding fork at
  `llama.rn@0f313bab` in `package.json:49`.
- The local `main` in `~/Projects/kalsa` is `745bf82`, one commit ahead of `origin/main` and
  unpushed (`git rev-list --left-right --count origin/main...HEAD` → `0  1`). Its parent is
  `5429799`. The commit adds a `CW_CORPUS` knob to `scripts/device-ciswire-cache.sh` (dense
  default, prose variant) for the char-vs-token device measurement.
- The app repo carries many local and remote branches, not one. The branch list is read with
  `git for-each-ref`; `REPOS.md` is the map.

### The engine fork and the `vendor/` layout

- The binding fork `Aspis0/llama.rn` works on upstream's `vendor/` layout. The engine tree is
  `vendor/llama.cpp/`, and the pin lives in `vendor/VERSIONS`, not in the retired
  `native/kalsallama.pin`.
- At the shipped binding pin `0f313bab`, `vendor/VERSIONS` names
  `LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama` and
  `LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`. That commit is the tip of
  `b11010-merge` in `Aspis0/kalsallama`.
- The migration away from the flattened `cpp/` tree and its symbol-rename scheme is recorded in
  `analysis/FORK-VENDOR-MIGRATION.md`, together with the measured upstream bump and the list of
  app-side consumers repaired with it.

### The q4_K MoE OpenCL fix is in the shipped engine

Earlier records said the fix was only on the `opencl-moe-masks` branch and therefore absent from
the shipped pin. That is wrong.

- The two fix commits are `2361be359` ("pass the get_scale_min_k4 masks as kernel args in the
  q4_K dp4a MoE GEMM") and `26c7affb7` (the same treatment for
  `kernel_gemv_moe_q4_k_f32_ns_wimg`).
- Both are ancestors of `8537d097c`: `git merge-base --is-ancestor 2361be359 8537d097c` exits 0,
  and so does the same command for `26c7affb7`.
- `b11010-merge` was created from `2361be359` on 2026-09-19 10:54:32 EDT and then had the
  `b11010` tag merged on top of it. The reflog records it:
  `2361be359 b11010-merge@{2026-09-19 10:54:32 -0400}: branch: Created from HEAD`.
- The vendored kernels in the shipped pin carry the mask-as-arguments form. At `0f313bab`,
  `vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl` calls
  `get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2)` at `:99` and `:219`; the same
  form appears in `gemm_moe_q4_k_q8_1_dp4a.cl` and `gemm_moe_q4_k_f32_ns.cl`.

Consequence: a standing claim that GPU+MoE with the governor dies at load on the shipped engine
is not supported by the shipped pin. Whether the governor path needs more than this kernel fix is
a separate question, and the governor numbers are under re-verification below.

### Governor

- The governor is off by default. `readGovernorEnabled()` reads the `kalsa.governor.enabled` key
  from `AsyncStorage` (`src/engine/governorRuntime.ts:15-21`) and returns false while the key is
  absent. The key is written only when the user flips the Settings toggle: `writeGovernorEnabled()`
  persists it with `AsyncStorage.setItem(GOVERNOR_ENABLED_KEY, …)` (`src/engine/governorRuntime.ts:27`),
  and `handleToggleGovernor` in the shipped Settings screen calls it
  (`src/screens/SettingsScreen.tsx:501`). A clean install is therefore off and stays off unless the
  toggle writes the key. The load path additionally requires `sensor_valid` before the governor is
  used (`src/engine/LlamaService.ts:2314`). Both facts are read from `origin/main` of the app.
- The device plan is `analysis/GOVERNOR-DEVICE-PLAN.md`, in English. The 2026-09-19 audit of the
  earlier Italian plan was re-read on the artefacts on 2026-09-20 and the plan was rewritten; the
  audited Italian body is archived byte-for-byte at
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`, and the re-verification is
  `scratchpad/agents/governor-audit-recheck/REPORT.md`. The plan is parked per the owner order
  quoted in the archived copy; no document on disk records an un-park, so re-opening it is an open
  owner decision.
- Every number in the rewritten plan cites an artefact or is marked UNSOURCED. The plan's design
  shape (Rule 1: decisions contain no device identity; Rule 2: matrix as data; Rule 3: one
  selector; probes fail closed) survived the audit unchanged.

## Roadmap and next steps

The order is the owner's to set. The committed near-term work is:

1. Finish the device measurement of ciswire recall-after-eviction on Qwen (Xiaomi), using the
   `CW_CORPUS=prose` variant committed in `745bf82`. The dense filler trips the char-vs-token
   overflow and never reaches the slide point.
2. Governor plan: the numbers were re-verified against the artefacts on 2026-09-20 and the plan
   was rewritten in English; the rewritten plan is the reference for any governor code built from
   it.
3. Publish or drop the app's local `main` commit. `~/Projects/kalsa` `main` is `745bf82`, one
   commit ahead of `origin/main` (`5429799`) and unpushed; the commit is the `CW_CORPUS` knob and
   was rebased onto `origin/main` at 2026-09-20 08:23:03 EDT (`git reflog show main --date=iso`),
   so a push is a fast-forward. Whether to push it is the owner's.
4. Update the living docs and the record of each measurement in the same commit as the
   measurement.

## Open decisions

### Owner-suspended

These are owner-scope. No agent should act on them without a new owner decision:

- **Vision lazy loading.** The app loads the vision `mmproj` eagerly and mandatorily even for
  text chat, which can refuse a load on mid-RAM devices. The direction is lazy loading. Record:
  `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`.
- **Ciswire window counted in characters, not tokens.** The window budget projects tokens as
  `chars/3`, so dense content overflows `n_ctx` without sliding. The direction is real token
  counting in the slide predicate. Same record as above.
- **Catalog gate threshold.** The prefill-cost admission threshold for the catalog is deferred
  (owner, 17/09). Record: memory `catalog-gate-threshold-deferred.md`; also
  `archived/PLAN-2026-09-full.md:682`, `:1660`, `:2634`.
- **S23 cable.** The owner was asked to unplug the S23 and keep it off the charger for the
  thermal runs (`archived/PLAN-2026-09-full.md:1659`). Owner-stated; no separate decision
  document exists on disk.

### Agent work

- The governor number re-verification cell, `scratchpad/agents/governor-audit-recheck/` (complete
  2026-09-20; all seven audit findings held, with one correction to the audit itself).
- The Qwen ciswire recall measurement on the Xiaomi.
- Corrections to these two living docs, to the `analysis/` records and to the affected memories
  whenever a disk check contradicts them.

## Where the record lives

- `analysis/`: six documents by kind. Dated session records:
  `CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` (S23/Jelly) and
  `XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` (Xiaomi/Qwen). Migration record:
  `FORK-VENDOR-MIGRATION.md`. Plan/audit document: `GOVERNOR-DEVICE-PLAN.md`. Standing references:
  `README-governor-kv-contract.md` (contract) and `README-qwen-think-replay.md` (procedure).
- `scratchpad/agents/<cell>/`: one folder per measurement cell, `PREREG.md` where relevant,
  driver scripts, `raw/`, `REPORT.md`.
- `archived/PLAN-2026-09-full.md`: the full Italian history to 2026-09-20.
- `docs/ALIVE.md`: the living measured state, with a pointer to the archived diary.
