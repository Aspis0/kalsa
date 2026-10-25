# APP-PIN — `_cok` GPU tail fix (app side of the delivery chain)

Worktree `~/Projects/kalsa-wt-bench-apk`, detached at `d69b4ce` (= origin/main), clean at start.

- **sha: `ca2dcc0b4907ce443148c9d772098775b3b6dbf5`** (on top of `d69b4ce`, no push)
- message: `deps : pin llama.rn to binding e437b1af, engine pin to 319b539 (_cok f32 accumulator)`
- shape mirrors `e206a945b`: **3 files changed, 5 insertions(+), 5 deletions(-)** —
  `package.json` (llama.rn spec), `package-lock.json` (root spec + `resolved` #sha + `integrity`,
  3 lines, **llama.rn entry only** — no unrelated churn), `native/kalsallama.pin`.

Changed:
1. `package.json:49` → `github:Aspis0/kalsa.rn#e437b1af3de7af563526f5777dbf25d86f9b3215`
2. `package-lock.json` → refreshed via `npm install` (exit 0); diff limited to the llama.rn entry
3. `native/kalsallama.pin` → `319b539377605f6c572e234b28678b74bd78deb5`

## Exit codes (real, `cmd > log 2>&1; echo $?`, then `tail -5`)

| # | Command | Exit | Result (tail / check) |
|---|---|---|---|
| 1 | `git status --porcelain \| wc -l` (preflight) | 0 | `0`; `git rev-parse HEAD` → `d69b4ceffbd4883f935a7451e8d89d4ab023ca5d` |
| 2 | `npm install > /tmp/pin-npm.log 2>&1` | **0** | allow-scripts warnings only; `git diff package-lock.json` = **3/3 lines, llama.rn entry only** |
| 3 | `bash scripts/assert-engine-provenance.sh > /tmp/pin-prov.log 2>&1` | **0** | `lockfile pins Aspis0/kalsa.rn@e437b1af3de7` / `OK: 1119 files match Aspis0/kalsa.rn@e437b1af3de7` / `engine inside it: kalsallama@319b53937760 == native/kalsallama.pin` (log names `kalsa.rn@e437b1af` ✓ and `kalsallama@319b539` ✓) |
| 4 | `npx tsc --noEmit > /tmp/pin-tsc.log 2>&1` | **0** | 0-byte log |
| 5 | `npx jest --maxWorkers=3 > /tmp/pin-jest.log 2>&1` (full suite, release gate) | **0** | `Test Suites: 115 passed, 115 total` / `Tests: 1436 passed, 1436 total` |
| 6 | `node_modules/llama.rn` real dir check | 0 | `-drwxr-xr-x`, `[ ! -L ]` true → **real directory, not a symlink** |
| 7 | `vendor/VERSIONS` engine check | 0 | `LLAMA_CPP_REF`/`LLAMA_CPP_COMMIT` = `319b539377605f6c572e234b28678b74bd78deb5` (2 matches) |
| 8 | `git commit …` | **0** | sha `ca2dcc0b4907ce443148c9d772098775b3b6dbf5` |
| 9 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Engine `Aspis0/kalsallama@319b539` (branch `kalsa-phone-v1-1-2`) ·
Binding `Aspis0/kalsa.rn@e437b1af` (branch `kalsarn-governor-engine`, its `vendor/VERSIONS` pins 319b539 ✓).
No push.
