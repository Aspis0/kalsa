# Where the engine lives (post-consolidation, 2026-08-22)

Decision by owner (gualt): **three repos, three roles** — no more vendored copies.

| Role | Repo | What's there |
|---|---|---|
| App | `Aspis0/kalsa` (local: `Kalsa\ai-chat`) | The product app. Consumes the engine via a committed llama.rn patch (`patches/`), regenerated with patch-package. |
| Engine wrapper | `Aspis0/kalsa-forkbigmoeonedge` (local: `moe-experiments\BigMoeOnEdge`; renamed from `kalsa-engine` on 2026-08-22, GitHub redirects the old name) | BigMoeOnEdge project history (`main`, `kalsa/*` wrapper branches). Its `third_party/llama.cpp` submodule points to **Aspis0/kalsallama**. |
| llama.cpp fork | `Aspis0/kalsallama` (local: `BigMoeOnEdge\third_party\llama.cpp`) | The patched llama.cpp, marked "kalsallama". All lineages live here as real branches. |
| Measurements | `Aspis0/kalsa-moe-experiments` (this repo) | Preregs, results, docs, PLAN/ALIVE, engine **bundles** as belt-and-braces backup (`backups/`). |

## The two engine lineages (both in kalsallama)

- **`kalsa/kernel-s3-repack`** — the Adreno OpenCL MoE kernel line (q2_K/q3_K MUL_MAT_ID,
  the 4+1 E031 miscompile fixes, kalsakernel-v4). Everything GPU stacks on this branch.
- **`kalsa/mmap-prefetch-opt`** — CPU-side line: the **expert-ready hook** for `mul_mat_id`
  (introduced by `5236140e5`, 2026-07-11) + `mmap_prefetch` params (`206a8fe7f`, `e5605f3bd`).
  This is the lineage the app's llama.rn patch mirrors (31 ggml lines, `lm_`-prefixed).
  Note: the branch name `bmoe/expert-ready-hook` cited in early app-patch comments does
  **not exist**; the real branch is this one.

## What was removed

`moe-experiments/kalsa-engine/` (vendored "engine home", commits 81e14c7/aeafd74/a059840)
was deleted on 2026-08-22 after verifying it contained **zero unique content**:
its `third_party/llama.cpp` was byte-identical to fork commit `e5605f3bd`, and its 18
untracked Kotlin example files were hash-identical to `kalsa/drop-policy-s2` in
BigMoeOnEdge. Its `bundles/` moved to `backups/engine-bundles/`.

## Safety rails (unchanged in spirit, updated in scope)

- The fork checkout has a tested `pre-push` hook allowing **only `github.com/Aspis0/*`**;
  pushes to upstream/ggml-org/Helldez are blocked (and the Aspis0 credentials get 403
  on third-party repos anyway — defense in depth).
- `BigMoeOnEdge/.gitmodules` no longer references `Helldez/llama.cpp`, so
  `git submodule sync` can no longer resurrect a third-party remote.
- Bundles in `backups/` remain the offline backup channel, refreshed at every engine bank.
