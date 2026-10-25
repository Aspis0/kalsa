# APP-PIN — governor chain bump (app side)

Worktree `~/Projects/kalsa-wt-bench-apk`, detached at `cff955da8defa49a20187d83fad9f1b1099745ed`,
clean at start (`git status --porcelain | wc -l` = 0).

- Binding `Aspis0/kalsa.rn` @ **`42087667fcf7fd34a7ac7bc37aea31fea738b610`**
  (branch `kalsarn-governor-engine`, pushed and verified with `git ls-remote` by Marco).
- Engine vendored INSIDE that binding: `Aspis0/kalsallama` @
  **`56f79e6cb81ed8a802a069ded6c63922a3dc9e06`** — read from the binding's
  `vendor/VERSIONS` (`LLAMA_CPP_REF`/`LLAMA_CPP_COMMIT`, both 56f79e6c…) at the pinned binding
  sha via `raw.githubusercontent.com/Aspis0/kalsa.rn/4208766…/vendor/VERSIONS`.
  The branch `kalsa-phone-v1-1-3` tip `e6200cc0…` CONTAINS that commit (tests-only delta beyond
  it); per APP-PIN.md (cok-ship) the pin follows the vendored commit, not the branch tip — so
  `native/kalsallama.pin` = 56f79e6c…, matching what the gate compares.

Follows `cok-ship/APP-PIN.md` procedure (3 files, same shape as `ca2dcc0b`):

1. `package.json:49` → `github:Aspis0/kalsa.rn#42087667fcf7fd34a7ac7bc37aea31fea738b610`
2. `package-lock.json` → refreshed via `npm install` (exit 0); diff = **3/3 lines, llama.rn entry
   only** (root spec + `resolved` #sha + `integrity`), no unrelated churn
3. `native/kalsallama.pin` → `56f79e6cb81ed8a802a069ded6c63922a3dc9e06` (trailing newline kept)

`node_modules` reinstalled from the new lockfile with **`npm ci`** (exit 0); `node_modules/llama.rn`
is a real directory (`[ -L ]` false, `[ -d ]` true), never a symlink. Its installed
`vendor/VERSIONS` = `LLAMA_CPP_COMMIT=56f79e6cb81ed8a802a069ded6c63922a3dc9e06` — identical to
the pin file.

## Exit codes (real, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30`)

| Command | Exit | Result |
|---|---|---|
| `npm install > /tmp/pin-npm.log` | **0** | allow-scripts warnings only; `git diff --numstat package-lock.json` = `3 3 package-lock.json` |
| `npm ci > /tmp/pin-ci.log` | **0** | real dir, not symlink; installed VERSIONS = 56f79e6c… |
| `bash scripts/assert-engine-provenance.sh > /tmp/pin-prov.log` | **0** | `lockfile pins Aspis0/kalsa.rn@42087667fcf7` / `OK: 1119 files match Aspis0/kalsa.rn@42087667fcf7` / `engine inside it: kalsallama@56f79e6cb81e == native/kalsallama.pin` |
| `npm run typecheck` | **0** | clean |
| `npx jest` (one full run) | **0** | `116 suites / 1455 tests passed` |
| apk.yml logic harnesses (59 `node scripts/*.mjs`) | — | **59 passed, 0 failed** |
| stale-sha grep (`e437b1af` in package.json/lockfile/native/) | 0 | no hits |

## Not verified

- The lockfile `integrity` was NOT independently re-derived as an `npm pack` sha512 of the codeload
  tree (the cok-ship audit did that for the previous entry); npm computed it from the pushed commit
  and the provenance gate matched all 1119 installed files against the codeload tarball at
  4208766…, which is the stronger statement about what is installed.
- No APK build/device run this session; `assert-native-patch.sh` (marker-based, post-build) not run.
- Marco pushes; nothing was pushed here. No tag, no branch.
