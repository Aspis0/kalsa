# REPOS — which repository holds what

Five repositories carry Kalsa. Three are live, two are archived read-only on GitHub.
This file exists because the constellation is not obvious and guessing has cost real time:
on 15/09 a directory named after one repo grew inside another and the two living documents
quietly became four.

Written 2026-09-16. Every number below was read from the repositories, not remembered.

## The three live ones

| repo | what it is | tracked files | pack |
|---|---|---|---|
| **`Aspis0/kalsa`** (public) | the React Native app — this repository | 4.033 | 15,76 MiB |
| **`Aspis0/kalsallama`** (private) | the engine: our fork of `ggml-org/llama.cpp` | 3.570 | 525 MiB |
| **`Aspis0/kalsa-moe-experiments`** (private) | the lab: the two living docs, measurements, device evidence | 50.869 | 530 MiB |

### `kalsa` — the app

Branches: `main` and `remote-brain`. `remote-brain` is the other session's line of work on
Kalsa Brain (PC↔phone) and is the one branch that is deliberately kept apart.

The app does not vendor the engine, it **pins** it: `native/kalsallama.pin` names the repo, a
branch label and a commit, and `scripts/sync-kalsallama.sh:587` refuses to build unless
`VENDOR_SHA == PIN_COMMIT`. The pin is the commit, not the branch head — moving `kalsallama`'s
`main` does not change what the app builds. Only editing that file does.

### `kalsallama` — the engine

One branch, `main`. It has a live `upstream` remote on `ggml-org/llama.cpp`, and that is the
reason this cannot be folded into a monorepo: upstream's tree owns the repository root
(`ggml/`, `src/`, `tools/`, `tests/`), so every future `git merge upstream/master` would become
a subtree merge. 844 upstream commits were merged on 2026-09-16 with per-file conflict
resolution.

What lives here and nowhere else: the per-phase governor (`src/llama-governor*`,
`src/llama-kv-commit*`, `src/llama-kv-staged*`, `src/llama-memory-hybrid*`,
`tests/test-governor-*`), the Adreno OpenCL kernel fixes, and the Hexagon NPU judge in
`tests/test-backend-ops.cpp`.

The standing check is the seven governor targets, expected exit codes
`0 0 77 77 0 0 0` (77 = skip, no device on the Mac). **That suite says nothing about the rest of
the tree** — `test-backend-ops` was uncompilable on `main` for twelve days and no check noticed,
because it is not one of the seven.

### `kalsa-moe-experiments` — the lab

One branch, `main`. It holds the **two living documents**:

- `PLAN.md` — the long-term plan, plus the product-suite execution track.
- `docs/ALIVE.md` — measured state and the diary.

**There are exactly two, and they are here.** A copy of both grew inside the app repo on 15/09
and diverged for two days; it has been folded back and the path is now in the app's
`.gitignore`. If you are about to edit `PLAN.md` or `ALIVE.md`, check you are in
`~/Projects/kalsa-moe-experiments` and not in a directory that merely imitates its name.

Device evidence lives under `scratchpad/agents/`. Reports, records and harness are tracked;
raw logcat, uiautomator XML and screenshots are ignored — 1810 raw files were 196 MB against
2,2 MB of conclusions. `RKStorage-docs` is ignored for a different reason: it is a SQLite pull
of the app's AsyncStorage and contains real chat transcripts.

## The two archived ones

They are read-only on GitHub, still cloneable, and nothing is lost. Un-archiving is one click.

- **`Aspis0/kalsa-forkbigmoeonedge`** — the *previous* engine fork (BigMoeOnEdge), superseded by
  `kalsallama`. It survives because it is still a submodule of the lab (`BigMoeOnEdge/`), and
  because the PC campaign binary behind every quality number was built from it. Its own
  `third_party/llama.cpp` submodule already points at `kalsallama`: the consolidation was started
  and never finished. Its `main` now *is* the old `kalsa/kernel-s2-layer-fuse` tip, so building
  from `main` gives the `--moe-fused-*` flags the campaign harness passes.
- **`Aspis0/llama.rn`** — an old fork of the React Native binding. Dead: `package.json` uses
  `llama.rn` 0.12.8 from npm, and the only reference to the fork is in an archived audit from
  August.

## Two conventions that make this navigable

**One branch per repository.** The exception is `remote-brain` in the app repo. Every branch that
was deleted on 2026-09-16 survives as a tag `archive/<branch-name>` on its tip, pushed and
verified *before* the delete, so any of them comes back with
`git push origin <sha>:refs/heads/<name>`. Counts: `kalsa` 19, `kalsallama` 21,
`kalsa-forkbigmoeonedge` 10, `llama.rn` 4.

**Never push to third-party remotes.** `kalsallama` has `upstream` → `ggml-org/llama.cpp` and
`kalsa-forkbigmoeonedge` descends from BigMoeOnEdge. We pull from them; we never push, and we
never open issues there.
