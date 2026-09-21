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

- The binding fork `Aspis0/kalsa.rn` (recorded as `Aspis0/llama.rn` in older notes) works on
  upstream's `vendor/` layout. The engine tree is
  `vendor/llama.cpp/`, and the pin lives in `vendor/VERSIONS`, not in the retired
  `native/kalsallama.pin`.
- At the shipped binding pin `0f313bab`, `vendor/VERSIONS` names
  `LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama` and
  `LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`. That commit was the tip of
  `b11010-merge` at that pin; the branch has since moved past it. The engine release tag points at
  `4ccef2f8`, and the current `origin/b11010-merge` tip is `916b8f0bcfcb829011f129b4dff8acfd01ab7814`
  (see "Engine release: current position and next steps").
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
- The rewritten plan states its own sourcing rule and applies it: every number carries an artefact
  citation or an explicit UNSOURCED label with what would settle it. The design
  shape (Rule 1: decisions contain no device identity; Rule 2: matrix as data; Rule 3: one
  selector; probes fail closed) survived the audit unchanged.

## Gates and dates (recovered 2026-09-21)

The concise rewrite of this file dropped the dated register. It is recovered here from
`archived/PLAN-2026-09-full.md:408-431` ("Primo modello: 9 settembre – 9 ottobre", its table) and
the timeline rows at `:69-71`. The dates are 2026 and were planning estimates subordinate to the
gates, not publication promises.

Critical path: **G0 baseline → G1 model → G2 complete chat → G3 correct profiles → G4 sustained
quality → M1**.

| date | gate or step | what it requires |
|---|---|---|
| 9 Sep, Wed | **G0** | a reproducible baseline, the real device matrix, schedulable slots; no booking in the dark |
| 10–11 Sep | — | MiniCPM entry; two comparable candidates |
| 14–15 Sep | **G1**, 15 Sep | the model chosen, and the baseline with absolute per-phone targets written BEFORE tuning |
| 16–18 Sep | — | authoritative session and restore contract; checkpoint on the 18th (correct recovery, observable reused tokens) |
| 21–23 Sep | **G2**, 23 Sep | complete chat on the CPU path, governor tests where the path is admitted, recovery without corruption |
| 24–25 Sep | — | profiles identified by artefact/driver, cache cost, measured static alternatives |
| 28–29 Sep | **G3**, 29 Sep | every phone has at least one correct path, and every ENABLED path passes its tests; NPU without evidence stays out |
| 30 Sep – 2 Oct | **G4**, 2 Oct | sustained quality and performance; consumption measured or measurement limits declared; regression causes explained |
| 5–6 Oct | — | candidate frozen on the 6th; no dependency on hidden debug flags |
| 7–8 Oct | — | M1 dossier with raw results, limits and reproduction instructions |
| 9 Oct, Fri | **M1** | the first model complete and banked on the three phones, or a precise list of the missing gates |
| 12–16 Oct | reserve | if a gate stays red, replan; never promote an incomplete build |

After M1: **M2** 30 Oct (the second dense model, on validated devices only, and it must add useful
capability rather than being the automatic loser of the first comparison), **M3** 20 Nov (the first
large MoE within the declared perimeter), reserve to 27 Nov. A separate gate on 12 Oct reopens the
MiniCPM5 fine-tuning decision, with the LFM licence revenue threshold as one input.

Two riders carried with the same table, because both were later misread:

- GPU/V75/q4_K, the other generations, the NPU and the governor are evidence-gated in the
  **24–29 Sep** window and are explicitly NOT "after M1" (`archived/PLAN-2026-09-full.md:1813`,
  `:1825`). Only the NPU was left as a time-boxed decision.
- Physical-device availability inside 14 Sep was a CALENDAR ASSUMPTION, not a confirmed
  connection: if the phones arrive late, code, corpus and CI advance while G1 and its dependent
  milestones move with them (`:431`).

### Where the schedule stands on 2026-09-21

- **G1 closed early, on 10 Sep**, with LFM2.5-2.6B (Q4_0 QAD) as the single main model; the
  MiniCPM5 arm was stopped (Xiaomi arm cancelled, S23 stopped at 16/24).
- **M1 is NOT done.** It is due **9 Oct** with a 16 Oct reserve, and it sits behind G2 (23 Sep),
  G3 (29 Sep) and G4 (2 Oct). Today is the first day of the G2 window.
- **G2 is not claimed.** The record that carries the G1 closure and the device sessions through
  mid-September ends with "G2 not claimed" (`archived/PLAN-2026-09-full.md:1965`, `:2003`,
  `:2045`, `:2488`) and the archived diary stops at 2026-09-20. No document records a G2 claim
  after that, so the answer to "is M1 finished?" is no by the gate it depends on.

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

## Engine release: current position and next steps

The engine binary ships inside the desktop app. The operational procedure and the manifest contract
are in `docs/ALIVE.md`, "Engine release pipeline". This section records where the path stands and
what is left.

### Position, 2026-09-21

- Source of truth: `Aspis0/kalsallama` (private), integration branch `b11010-merge`, tip
  `2a290390d67311b580ef398fd545e6d060b39897` (`ci : drop the Metal packaging work from the
  kalsa-server release path`).
- CURRENT release `kalsa-server-v1.1.0`, annotated, tag object
  `c105c218236799f2f651517f5a0aeabcf4a8d8a1`, pointing at `2a290390d`. Published by run
  `35565687271` (`push on a tag`) and verified consumer-side from the CDN. It carries the
  `X-Kalsa-Slot` inlet. Immutable; never moved.
- PREVIOUS release `kalsa-server-v1.0.0` stays published and unchanged (tag object
  `d30c8d475d5eb47a544304ba592138d066bbc2e3`, commit `4ccef2f85dbc27e095e11ffcbad4628be9961790`,
  run `35549848243`).
- Distribution is on Cloudflare R2 (`dl.kalsa.io`); the GitHub-release path is gone. Published
  state, the manifest contract, the cache caveats and the two measured consumer traps
  (`exe_sha256` is the launcher and is version-invariant; the port header literal in the binary is
  lowercase) are in `docs/ALIVE.md`, "Engine release pipeline".
- The tagged commit's workflow is byte-identical (blob `26ce5d05a`) to the one that produced the
  published v1.0.0, which is why this tag's release path needed no new validation: it is the path
  already proven in production, plus the slot code in `tools/server/`.

### Position, 2026-09-20 (history)

- `origin/b11010-merge` tip was `916b8f0bcfcb829011f129b4dff8acfd01ab7814` and the only release was
  `kalsa-server-v1.0.0`, published by run `35549848243`.

### The Metal packaging half is OUT of v1.1.0, and why

The precompiled-metallib work (`c71977809` plus the Metal hunk of `ac9a09dc6`) is NOT part of the
v1.1.0 tag. It stays in the branch history and returns in its own tag.

What decided it was the first run of that work on a REAL macOS runner (run `35560962409`), not an
opinion: the METAL BUILD SUCCEEDED - the metallib was produced, the server loaded the model on the
MTL0 device and listened on its port - and the failure was in the new fail-closed health probe,
which could not classify the loader's real message and exited 1. Two defects must be fixed before
that half can be tagged:

1. The probe must classify the loader's ACTUAL message rather than an expected one, and on an
   unclassified message it must fail closed AND print the child's stderr tail, so the next person
   is not left with the same puzzle.
2. The probe model must be a committed fixture in the engine repo, not a Hugging Face fetch on the
   release path. Owner of the fixture: the engine repo (decided with the desktop on 2026-09-21),
   carried in the tar at a fixed relative path, named in the tar list the desktop receives; the
   desktop bundler FAILS ITS BUILD if the tag's tar does not contain it, and disables the runtime
   asset fetch for the probe model on the bundled path.

Splitting cost nothing in capability: v1.0.0 and v1.1.0 both ship Metal with the metallib embedded
in `libggml-metal`, and the archive keeps the v1.0.0 shape, so no consumer learns a new shape. The
reverted commit is `2a290390d`, a workflow-only revert (+4/-179, `tools/` untouched), audited
PUSH-SAFE 9/9 before it was pushed.

### Decisions

| decision | reason |
|---|---|
| Bundle the engine INSIDE the desktop app, exactly as the phone already bundles it in the APK | The app and the engine are coupled: `X-Kalsa-Cache-Salt` is a header the app must send and the engine must accept, so a runtime engine download creates a silent version-skew failure mode. Users download ONE app that contains the tested pair. For macOS, R2 is a BUILD-TIME source of the binary (fetch, verify size/sha256/exe_sha256, embed in the bundle), not a runtime download. |
| Keep the R2 runtime download for Windows/x64 and future backends | One executable cannot cover CUDA/Vulkan/CPU; the `assets.rs` rows still point at `dl.kalsa.io`. |
| Distribution on Cloudflare R2; the AI MODELS stay on Hugging Face | Models are gigabytes. |

The first-launch capability probe stays even for a bundled binary, because it decides whether the
engine can actually run on that machine.

### Cloudflare inventory

| item | identifier |
|---|---|
| Account id | `8a991014729a52a958cef2c5cbf0de50` |
| Zone `kalsa.io` | `3dbf75d1d2cf42e2e8c2dba0d950f3fa` |
| Bucket `kalsa-downloads` | public, served on custom domain `dl.kalsa.io`; the `r2.dev` URL is for testing only |
| R2 API token | scoped to that single bucket only (object read/head plus write, plus listing for the advisory check); NO repository permission; stored in the engine repo as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` |
| Telemetry Worker `kalsa-telemetry` | Durable Object `TelemetryBuffer` + KV `DEDUPE_KV`, served on `telemetry.kalsa.io`; its `workers_dev` host is DISABLED because no released build ever used it |

Telemetry is ERROR/CRASH diagnostics only, explicitly OPT-IN with default OFF, no analytics, and
per its design document no chat or document content and no API keys in any form, not even hashed.
Nothing leaves the device unless the user opted in. The app's telemetry constant lives in
`src/telemetry/config.ts` in `Aspis0/kalsa`; the repo-side change is branch `telemetry-kalsa-io`,
commit `213850e1b617831586e9b9c18b0144ea74664efb` (pushed).

### Dead ends, so nobody repeats them

- A GitHub Release in the PRIVATE engine repo is unreachable for an unauthenticated client: the
  asset URL answers `404`. That is what forced distribution off GitHub.
- The account's Actions artifact storage quota (private repos, ~500 MB, enforced from usage GitHub
  RECALCULATES every 6-12 hours) blocked CI twice. About 4.8 GiB was freed by deleting 11 stale
  `pubvia-macos` artifacts (2.45 GiB) in the `PubVia` repo and 8 upstream CI caches in
  `kalsallama` (2.33 GiB). Enforcement stayed "full" until the recalculation: freeing space is not
  an immediate fix.
- The upstream reusable UI workflow hardcodes `runs-on: ubuntu-slim`, a HARD 15-minute job limit,
  and does not cache npm. One attempt spent 12m53s in the build step and was cancelled, which
  killed the whole pipeline because the macOS job depended on it. Building the UI inside the macOS
  job removed both the 15-minute ceiling and the artifact hand-off.
- `--clobber` on release assets was rejected outright: an immutable tag must never have its bytes
  replaced. The GitHub-release publishing path was removed entirely rather than patched.
- A `workflow_dispatch` input reaches shell and CLI arguments, so a tag beginning with a dash could
  act as an option (`--help`) instead of a value. Closed with a namespace allowlist
  `^kalsa-server-[A-Za-z0-9._-]+$` at read time AND immediately before use, plus an option
  terminator `--` before positional arguments.
- Three AWS/R2 traps, all encoded in the step as comments and guards: `aws s3 ls` exits NONZERO on
  an empty prefix (aws/aws-cli#5544), so with "any nonzero is fatal" it would block the first
  publish of every new version; a JMESPath `Contents[]` projection prints the literal string `None`
  for an empty result, which made an empty prefix look non-empty; and Cloudflare R2's `ListObjectsV2`
  omits `KeyCount`, unlike AWS. List-based existence checks are unusable here, so the decision comes
  from three `head-object` calls on the exact keys. The `None` trap is the bug that failed run
  `35544933700`, before any upload, leaving the bucket empty. Detail: `docs/ALIVE.md`, "Engine
  release pipeline".

### Open items and debts

Ordered next steps:

1. `kalsa-server-v1.1.0` is published and LIVE (run `35565687271`): slot inlet included, archive
   shape identical to v1.0.0, consumer verification in `docs/ALIVE.md`, "Published state". v1.0.0
   stays available. Remaining for this tag: nothing.
1b. Metal packaging (the item above): fix the probe classifier and move the probe model into the
   repo as a fixture, then cut its own tag. Until then the Metal upgrade is not shippable - the
   embedded metallib of v1.0.0/v1.1.0 is what users run.
2. Bundle the engine into a signed, notarised macOS `.app`. This reintroduces the codesign
   obligation for the engine's dylibs (56 Mach-O in this build), same team and hardened runtime,
   with `@rpath` resolving inside the bundle. The runtime download was dodging that; if nothing is
   signed today it is a recorded debt.
3. Exercise the declared engine ship gates (none exercised yet): the full preset-backed
   `test_slot_save.py` (multimodal, legacy token list, erase, oversized media, no-mmproj);
   real-model recurrent/SWA and speculative save/restore; write fault-injection (short write,
   flush/close, file_size, rename, prior-file preservation); `fsync`/directory durability;
   cross-backend restore; the residual TOCTOU between the exclusive create and the core save
   reopening the temp; 32-bit portability of the `ckpt_read_buf` length conversion.
4. Phone: the fork `Aspis0/kalsa.rn` was bumped to
   `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` (only version files changed, no C++), and the app pin
   bump to that commit is prepared and awaiting review. The S23 repack timing run still waits for
   the device to be unplugged.

Cache caveats, standing (source of truth is the Cloudflare docs, not folklore):

- Cloudflare's cache stores HTTP 404 responses automatically for a domain with caching enabled, and
  an overwritten object keeps being served in its OLD form until TTL expiry or an explicit purge
  (`https://developers.cloudflare.com/r2/reference/consistency/`).
- Measured on `dl.kalsa.io`: a request to a not-yet-published path returns `cf-cache-status:
  DYNAMIC`, so the 404 is NOT cached and no path is poisoned today. The publish step checks the
  bucket through the S3 API, which bypasses the cache entirely; a client-side 404 must be
  re-checked with a cache-busting query before it is believed.

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
  2026-09-20; nine entries: the seven audit findings plus the two formerly-unsourced values. All
  seven findings held, and the audit's own `cpu7 1824000` claim was refuted: the value has an
  archived narrative source).
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
