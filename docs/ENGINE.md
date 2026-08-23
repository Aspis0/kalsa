# Where the engine lives (post-consolidation, 2026-08-22)

Decision by owner (gualt): **three repos, three roles** — no more vendored copies.

| Role | Repo | What's there |
|---|---|---|
| App | `Aspis0/kalsa` (local: `Kalsa\ai-chat`) | The product app. Consumes the engine via a committed llama.rn patch (`patches/`), regenerated with patch-package. |
| Engine wrapper | `Aspis0/kalsa-forkbigmoeonedge` (local: `moe-experiments\BigMoeOnEdge`; renamed from `kalsa-engine` on 2026-08-22, GitHub redirects the old name) | BigMoeOnEdge project history (`main`, `kalsa/*` wrapper branches). Its `third_party/llama.cpp` submodule points to **Aspis0/kalsallama**. |
| llama.cpp fork | `Aspis0/kalsallama` (local: `BigMoeOnEdge\third_party\llama.cpp`) | The patched llama.cpp, marked "kalsallama". All lineages live here as real branches. |
| Measurements | `Aspis0/kalsa-moe-experiments` (this repo) | Preregs, results, docs, PLAN/ALIVE, engine **bundles** as belt-and-braces backup (`backups/`). |

## ONE kernel, ONE branch: `main` (consolidated 2026-08-23, owner order)

**`main` @ `9890d1054` is THE kernel.** Git proved the "two lineages" were in fact one
linear chain — every historical branch tip was an ancestor of the same line:

```
mmap-prefetch-opt (expert-ready hook e5605f3bd, mirrored by the app's llama.rn patch)
  → kernel-s1-expert-pack (CPU tall-GEMV fuse b8a78977d)
  → kernel-s2-layer-fuse
  → kernel-s3-repack (Adreno OpenCL q2_K/q3_K MoE kernels f700bf30c, 4+1 E031 fixes,
    kalsakernel-v4) @ 1882bf8cd
  → CPU repack q2_K/q3_K v1 (M0–M5, audited) @ 9890d1054 = main
```

The six redundant branch pointers (`kernel-s1/s2/s3`, `mmap-prefetch-opt`,
`opencl-q6k-dispatch-fix`, `split-trunk-gpu`, plus the working branch `repack-q23k`)
were **deleted** — all their commits remain reachable from `main`, zero loss.
GitHub default branch is `main`.

**Surviving branches:** `main` (the kernel — submodules point HERE), `master`
(upstream mirror), `kalsa/mali-probe` (Mali probe, **never merge**),
`kalsa/mld-gemv-m1` (unique content not in main — owner to decide keep/delete).

Note: the branch name `bmoe/expert-ready-hook` cited in early app-patch comments never
existed; the hook commits (`5236140e5`, `206a8fe7f`, `e5605f3bd`) are in `main`.

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
