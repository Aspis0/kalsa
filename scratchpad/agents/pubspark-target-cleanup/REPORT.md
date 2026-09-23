# PubSpark target/ cleanup report

Date: cleanup run, Mac disk maintenance session.

Scope note: a sibling task is simultaneously cleaning **system caches**. This task did NOT touch any caches. Only the six `src-tauri/target` directories of the PubSpark worktrees were deleted. Nothing else was modified anywhere.

## Pre-flight

### 1. No live builds or running apps from these trees

```
ps aux | grep -Ei "cargo|rustc|tauri|vite|node" | grep -i pubspark   -> only the grep itself
ps aux | grep -Ei "cargo|rustc|tauri" | grep -v grep                  -> no matches
```

No cargo/rustc/tauri build or PubSpark app was running. Safe to proceed.

### 2. Every `src-tauri/target` is git-ignored and untracked (all six hold)

`git check-ignore -v src-tauri/target` and `git ls-files src-tauri/target | wc -l` for all six worktrees:

| worktree | check-ignore result | tracked files |
|---|---|---|
| pubspark | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |
| pubspark-cloud-sensors | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |
| pubspark-chart-read | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |
| pubspark-e2e | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |
| pubspark-artboard | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |
| pubspark-pre-gate | `.gitignore:3:src-tauri/target src-tauri/target` | 0 |

All six hold: ignored by line 3 of `.gitignore`, zero tracked files. Recorded verbatim evidence for all six (requirement was two).

### 3. Disk before

`df -h /System/Volumes/Data` before:

```
/dev/disk3s1   926Gi   862Gi    41Gi    96%   /System/Volumes/Data
```

## Method

All six worktrees have `src-tauri/Cargo.toml`, so the unambiguously correct tool was used for each:

```
cargo clean --manifest-path /Users/marco/Projects/<worktree>/src-tauri/Cargo.toml
```

All six returned success. No `rm -rf` was needed. Nothing inside `src-tauri` other than `target/` was touched: `src/`, `resources/`, `data/`, `assets/`, `Cargo.toml`, `Cargo.lock`, `gen/`, `build.rs`, `scripts/`, `tests/`, `icons/`, etc. all verified present after the run (main worktree listing: `Cargo.lock Cargo.toml assets build.rs capabilities clippy.toml data examples gen icons llm_bundle.rs resources rust-toolchain.toml rustfmt.toml scripts skills src tauri.conf.json ... tests`).

No commit, no push, no branch/ref deletion, no `git gc`, no cache touched.

## Results: per-directory before/after

| directory | du before | target/ before | du after | reclaimed |
|---|---|---|---|---|
| /Users/marco/Projects/pubspark | 268 G | 211 G | 57 G | ~211 G |
| /Users/marco/Projects/pubspark-cloud-sensors | 34 G | 34 G | 373 M | ~34 G |
| /Users/marco/Projects/pubspark-chart-read | 24 G | 23 G | 227 M | ~23 G |
| /Users/marco/Projects/pubspark-e2e | 21 G | 21 G | 377 M | ~21 G |
| /Users/marco/Projects/pubspark-artboard | 12 G | 11 G | 204 M | ~11 G |
| /Users/marco/Projects/pubspark-pre-gate | 5.6 G | 5.3 G | 229 M | ~5.3 G |
| **total** | **~365 G** | **~305 G** | **~58 G** | **~306 G** |

`find /Users/marco/Projects -maxdepth 3 -type d -path "*/src-tauri/target"` after the run: **no matches**. All six target directories are gone.

Disk after (`df -h /System/Volumes/Data`):

```
/dev/disk3s1   926Gi   542Gi   361Gi    60%   /System/Volumes/Data
```

Used went 862 Gi -> 542 Gi, free 41 Gi -> 361 Gi. Apparent drop in used space is ~320 Gi; the extra over the ~306 G from this task likely includes concurrent cache reclamation by the sibling cache-cleaning task (its work is not attributed to this task, and this task did not touch caches). No deletions failed; nothing was locked.

## Inspected but NOT touched (as instructed)

### pubspark/training (18 G) - DATA, left alone

Top two levels: `README.md`, `domain/` (assemble_train.py, data/, runpod/), `domain_swift/` (Modelfile.* variants, assemble_v3/v4.py, data/, eval/, audit/, serving/, runpod/), `router/` (Modelfile, adapters/, lora_config.yaml, train.log, train_mac.sh).

One line: it holds model-training assets - fine-tune data assembly scripts, LoRA/router configs, Modelfile variants and training logs for the domain-swift training pipeline; bulk sits in `training/domain_swift` (16 G).

### pubspark/eval (19 G) - DATA, left alone

Top two levels: `README.md`, `annotator-harness/` (dozens of Python scripts: annotate_panel_bbox_minimax.py, build_*_gold*.py, exports/, drs/, docs/), `north-star/` (gualtieri-fig1/, validate_fixture.py), `ratex_bench/` (Cargo.toml, cases.json, out/, src/, target/).

One line: it holds evaluation corpora and annotation harness code - gold-question/pointing-audit builders and export data for the annotator harness; bulk sits in `eval/annotator-harness` (19 G).

Note: `eval/ratex_bench/target` exists but is OUTSIDE the six authorized directories and was not touched.

### src-tauri/resources - inspected, PROPOSAL only, not deleted

Sizes: 785 M in the main worktree (dinov2 84M, layout 130M, lib 24M, nemotron 311M, panels 129M, scalebar 77M, sidecars 29M, oarocr 4K); 173 M each in pubspark-cloud-sensors, pubspark-chart-read, pubspark-e2e, pubspark-pre-gate; 24 K in pubspark-artboard.

Tracked or fetched: **mostly fetched, not tracked**. Only placeholder/metadata files are tracked (6 in main, 5-7 in the others - all `README.md` and `.gitkeep`). The weight files themselves are "Not committed to git (see root `.gitignore`)" per `resources/nemotron/README.md`; they are synced into the tree from an external source (README documents provenance for the Nemotron detector: `resources/nemotron/detector.onnx`, "Only the detector is synced, packaged, and loaded").

Regenerable: yes in principle - re-syncable from the documented provenance/source, but the sync step must be known and repeatable before deleting. Proposal (do not execute without owner sign-off): delete `resources/` weight contents in the four 173 M worktrees (keep main's 785 M copy), reclaiming ~692 M; or, if a fetch/sync script is confirmed working, delete all copies (~1.3 G total) and re-fetch in the main worktree.

### node_modules in PubSpark worktrees - PROPOSAL only, not deleted

- /Users/marco/Projects/pubspark/node_modules = 149 M
- /Users/marco/Projects/pubspark-e2e/node_modules = 149 M
- /Users/marco/Projects/pubspark-artboard/node_modules = 149 M
- /Users/marco/Projects/pubspark-cloud-sensors/node_modules = 146 M
- /Users/marco/Projects/pubspark-chart-read/node_modules = 0 B (empty)

Regenerable with `npm install` / `pnpm install`, but small (~444 M total). Listed as a proposal only; not deleted.

### Explicitly out of scope and untouched

- Every `target/` outside the six authorized directories: `/Users/marco/Projects/road-probe/{target,http-probe/target,vm/target}`, `/Users/marco/Projects/kalsa-brain/target`, `/Users/marco/Projects/vendor/tauri-plugin-pilot/target`, `/Users/marco/Projects/pubspark/eval/ratex_bench/target` - not touched.
- Anything inside any `.git` directory (including the six worktrees' git dirs) - not touched.
- System caches - not touched (sibling task owns that).
- No commits, no pushes, no branch/ref deletion, no `git gc`.

## Summary

Six `src-tauri/target` directories removed via `cargo clean`, ~306 GB reclaimed from the six worktrees (disk used: 862 Gi -> 542 Gi, free: 41 Gi -> 361 Gi). Zero failures. Everything else left in place or recorded as proposal.
