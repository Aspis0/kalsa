# Kalsa application architecture

## Repository role and branches

`Aspis0/kalsa` is the React Native application.

| Branch | Reference | Status |
|---|---|---|
| `origin/main` | `eaee200` | True main head; CI engine-pin merge line |
| `main` | `348588b` | Stale local checkout, 101 commits behind `origin/main`; no silent fast-forward |
| `feat/moe-stream` | `74531a8` at verification | Active development |
| `chore/repo-reorg-v2` | `6b6c69c` | Six reorganization commits above `feat/moe-stream`; published as `origin/chore/repo-reorg-v2`; not adopted |

## Engine assembly

The Android engine is assembled from three parts:

1. `llama.rn` `0.12.8` from npm. It is declared in `package.json`.
2. `vendor/kalsallama-cpp/`, a flattened copy of the fork at the commit recorded in
   `native/kalsallama.pin` (`a0cabca6b`). The sync script applies `LM_`/`lm_` symbol
   prefixes and copies the tree with `rsync -a --delete` to
   `node_modules/llama.rn/cpp/`.
3. `patches/llama.rn+0.12.8.patch`, applied by `patch-package`. It touches 13 files
   and 1,064 lines. Its CMake hunk is the load-bearing part: it adds the
   `native/bmoe/` source files, include paths, compatibility header, and
   `BMOE_HAVE_EXPERT_READY_HOOK` to the llama.rn native target.

`package.json` defines the installation order:

```text
scripts/sync-kalsallama.sh overlay && patch-package
```

Overlay first, patch second, is load-bearing. The patch targets the llama.rn tree after
the fork sources have been copied into it.

⛔ `npx patch-package llama.rn` is prohibited. Regenerating the patch absorbs the
23 MB vendor overlay into `patches/llama.rn+0.12.8.patch`.

## Coexisting engine mechanisms

These mechanisms are separate and must not be mixed:

| Line | Engine mechanism | Proof status |
|---|---|---|
| `feat/moe-stream` | Committed `vendor/kalsallama-cpp/` overlay, then the llama.rn patch | Device-proven |
| `main` | Fork pin exercised by the CI engine-pin merge line | CI-proven |

## Entry points

- `docs/KALSA.md`: current application and harness state.
- `docs/HARNESS_FINDINGS.md`: findings register and evidence record.
- `docs/KNOWN_ISSUES.md`: known issues.
- `scripts/campaign/`: on-device measurement campaign harness.

## Evidence read

`package.json:12,49`; `native/kalsallama.pin`; `vendor/kalsallama-cpp/VENDOR_SHA`;
`scripts/sync-kalsallama.sh:530-587`; `patches/llama.rn+0.12.8.patch:1-56`;
`docs/KALSA.md`; `docs/HARNESS_FINDINGS.md`; `docs/KNOWN_ISSUES.md`; the `a5ae74b`
CI engine-pin commit; and the Git history and refs for `main`, `feat/moe-stream`, and
`chore/repo-reorg-v2`.
