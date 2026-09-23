# Binding jest "failed to run" 12/12 - root cause: pnpm layout vs RN preset transformIgnorePatterns

Repo: /Users/marco/Projects/llama.rn-kalsa, branch kalsarn-governor-engine,
`git rev-parse --short=9 HEAD` = **5b966218e**. `git status --porcelain` = 2 lines
(`?? pnpm-lock.yaml`, `?? pnpm-workspace.yaml` - untouched, not mine). READ-ONLY run:
no edit, commit, push, or install. Prior context read: binding-audit/REPORT.md section 5,
binding-prep/REPORT.md line 99 (both say 12/12, pre-existing on base, dying in
react-native jest setup.js under node v26.3.0).

## 1. Reproduction - ONE suite

```
cd /Users/marco/Projects/llama.rn-kalsa
npx jest src/__tests__/typedArrays.test.ts > /tmp/binding-jest.log 2>&1; echo $?
1
```

`tail -40` (log kept, 2171 bytes):

```
FAIL src/__tests__/typedArrays.test.ts
  ● Test suite failed to run
    Jest encountered an unexpected token
    ...
    Details:

    /Users/marco/Projects/llama.rn-kalsa/node_modules/.pnpm/@react-native+js-polyfills@0.72.1/node_modules/@react-native/js-polyfills/error-guard.js:14
    type ErrorHandler = (error: mixed, isFatal: boolean) => void;
         ^^^^^^^^^^^^
    SyntaxError: Unexpected identifier 'ErrorHandler'

      at Runtime.createScriptFromCode (node_modules/.pnpm/jest-runtime@28.1.3_supports-color@8.1.1/node_modules/jest-runtime/build/index.js:1796:14)
      at Object.<anonymous> (node_modules/.pnpm/react-native@0.72.3_@babel+core@7.29.7_supports-color@8.1.1__@babel+preset-env@7.29.7_@_157648a6da4af642463107a227ab41c6/node_modules/react-native/jest/setup.js:16:6)
```

The setup.js line it points to - `react-native/jest/setup.js`, line 16 of the file is
(the sed offset printed shows line 7 of the excerpt = file line 16):

```
jest.requireActual('@react-native/js-polyfills/error-guard');
```

i.e. setup.js requires a Flow-typed file that babel never transformed. The failing file
is Flow syntax (`type ErrorHandler = ...`) hit by node's raw script parser.

## 2. Is it the Node version? NO (evidence + one INFERENCE)

Requested checks:

- `which -a node` -> `/opt/homebrew/bin/node` (printed twice)
- `node --version` -> `v26.3.0`
- `ls ~/.nvm/versions/node` -> dir absent; `ls ~/.local/share/fnm` -> absent;
  `ls ~/.volta/tools/image/node` -> absent; `ls ~/.asdf/installs/nodejs` -> absent
- `ls /opt/homebrew/opt | grep -i node` -> `node`, `node.js`, `node@26`, `nodejs`
  (only the v26 formula); `brew list --versions node` -> `node 26.3.0`;
  `ls /opt/homebrew/Cellar | grep node` -> `node` only
- `ls /usr/local/bin/node /usr/local/opt/node@*/bin/node /opt/local/bin/node` -> none

**No Node 20 or 22 binary exists on this machine**, so the same-suite rerun under an
older node could not be performed. Per rules: none installed.

The failure is not node-governed: it is a regex-vs-path decision (does
`transformIgnorePatterns` match the file's path?) made by jest config before any node
API is involved. Measured with the RN preset's own regex against the two path shapes:

```
preset regex = node_modules\/(?!((jest-)?react-native|@react-native(-community)?)\/)
pnpm @react-native path ignored(transformIgnore matches)? true   <- NOT babel-transformed -> Flow parse error
npm   @react-native path ignored? false                          <- transformed -> OK
pnpm lodash path ignored? true
```

INFERENCE: node v26.3.0 is a bystander; the same pnpm tree would fail identically on
node 20. (Cannot be executed here - no second node binary; the CI evidence in §3 shows
the suite is run under node 20.x with an npm layout.)

## 3. Node version this repo expects

- `package.json:116-118`:
  ```
  "engines": {
    "node": ">= 16.0.0"
  },
  ```
- `example/package.json:63`: `"node": ">=20"`
- `.nvmrc` / `.node-version`: **absent** (both `cat` empty)
- No `setup-node`/`node-version` in `.github/workflows/*.yml` themselves
  (`grep -rn 'setup-node|node-version' .github/workflows/` -> exit 1); the workflows use
  a local composite action, `.github/actions/setup/action.yml`:
  ```
  10:        node-version: 20.x
  ```
  and the same file, install step:
  ```
  26:        npm ci --prefix example
  27:        npm ci
  ```
CI expectation: **Node 20.x, npm ci from the tracked lockfile.**

## 4. node_modules vs the tracked lockfile

Tracked lockfile: `git ls-files | grep -x 'package-lock.json|yarn.lock|pnpm-lock.yaml'`
-> **`package-lock.json` only** (root; plus `example/package-lock.json`).
`yarn.lock`: does not exist. `pnpm-lock.yaml` / `pnpm-workspace.yaml`: untracked (the
two files that are not mine).

node_modules was built by **pnpm**:

- layout: `node_modules/react-native -> .pnpm/react-native@0.72.3_@babel+core@7.29.7.../node_modules/react-native` (symlink)
- `stat`: `node_modules` mtime `Sep 18 11:30:26 2026` == `pnpm-lock.yaml` mtime
  `Sep 18 11:30:26 2026`; `package-lock.json` `Sep 19 13:11:27 2026` and byte-identical
  to HEAD (git status clean apart from the 2 pnpm files)

**Yes - pnpm-vs-npm is the cause.** The jest config (`package.json:119-131`) declares no
`transformIgnorePatterns`, so the react-native preset supplies it
(`node_modules/react-native/jest-preset.js`):

```js
transformIgnorePatterns: [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?)/)',
],
transform: { '^.+\\.(js|ts|tsx)$': 'babel-jest', ... },
setupFiles: [require.resolve('./jest/setup.js')],
```

That regex assumes a hoisted layout: it must see `node_modules/@react-native/...`
directly. Under pnpm the path is `node_modules/.pnpm/@react-native+js-polyfills@0.72.1/...`
- right after `node_modules/` sits `.pnpm/`, which matches nothing in the allow-list, so
the negative lookahead passes, the pattern MATCHES, and jest skips babel for the file
(proven in §2: pnpm path -> `true`, npm path -> `false`). Flow syntax then reaches the
parser raw. The `.pnpm` layout breaks the preset's `transformIgnorePatterns`; node
version and repo code are not implicated.

## 5. Minimal fix - ENVIRONMENT (primary), CODE (alternative)

**Classification: ENVIRONMENT - reinstall with the tracked package manager (npm), which
restores the hoisted layout the unmodified preset expects.** The repo tracks
`package-lock.json`, CI installs with `npm ci` (setup/action.yml:26-27) on Node 20.x
(setup/action.yml:10). Node pinning is not required by any evidence (§2); matching CI's
20.x is optional belt-and-braces only. NOT applied - commands for whoever runs it:

```sh
cd /Users/marco/Projects/llama.rn-kalsa
rm -rf node_modules                 # untracked; the two untracked pnpm*.yaml files stay untouched
npm ci                              # tracked package-lock.json (lockfileVersion 3)
npx jest src/__tests__/typedArrays.test.ts   # expect exit 0
```

**Alternative CODE fix** if the pnpm install must be kept (do NOT apply) - add to
`package.json` inside the `"jest"` key:

```diff
   "jest": {
     "preset": "react-native",
+    "transformIgnorePatterns": [
+      "node_modules/(?!(\\.pnpm/)?((jest-)?react-native|@react-native(-community)?)[+@/])"
+    ],
     "modulePathIgnorePatterns": [
```

(verified here via `npx jest --config '<inline json>'` only, no file written).

**Second failures, observed and named:**

1. First, narrower pnpm pattern attempt
   `node_modules/(?!(\\.pnpm/)?((jest-)?react-native|@react-native(-community)?)[+/])`
   cleared the reported failure (setup.js:16) but the SAME suite then died one call
   deeper - log `/tmp/binding-jest-fixed.log`:
   ```
   .../react-native/Libraries/vendor/core/ErrorUtils.js:11
   import type {ErrorUtilsT} from '@react-native/js-polyfills/error-guard';
   SyntaxError: Cannot use import statement outside a module
     at Object.<anonymous> (.../react-native/jest/setup.js:37:3)
   ```
   Cause: pnpm dirs are `name@version` (e.g. `react-native@0.72.3_...`), not `name/` - the
   allow-list must accept `[+@/]` after the package name, which is why the diff above
   uses `[+@/]`.
2. With the `[+@/]` pattern: three single suites run green - `src/__tests__/typedArrays.test.ts`
   (exit 0, 4 passed), `example/src/__tests__/chatHelpers.test.ts` (exit 0, 2 passed),
   `src/__tests__/index.test.ts` (exit 0). The remaining 9 suites were NOT run (full-suite
   run forbidden in this session). INFERENCE: no further failures expected, since this is
   upstream llama.rn's config that CI runs under node 20.x + `npm ci` - unverified here.

## Files kept (all outside the repos)

`/tmp/binding-jest.log` (repro), `/tmp/binding-jest-fixed.log` (pattern attempt 1,
second failure), `/tmp/binding-jest-fixed2.log` (pattern 2, pass),
`/tmp/binding-jest-example.log` / `-example-fixed.log`, `/tmp/binding-jest-index-fixed.log`,
`/tmp/recheck.js`, `/tmp/recheck2.js` (regex proofs).

## Environment fix (applied)

Session run in-place (no sub-agents, no source changes, no commits/pushes). Repo
`/Users/marco/Projects/llama.rn-kalsa`, branch `kalsarn-governor-engine`.
Pre-check: `git rev-parse --short=9 HEAD` -> **5b966218e** (exit 0), branch confirmed.

### Steps and exit codes

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `git status --porcelain` (baseline) | 0 | exactly 2 lines: `?? pnpm-lock.yaml`, `?? pnpm-workspace.yaml` (both pre-existing, untouched) |
| 1 | `du -sh node_modules` | 0 | **1.0G** |
| 2 | `mv node_modules node_modules.pnpm-2026-09-18` | 0 | backup dir present, `node_modules` gone (rollback = reverse mv) |
| 3 | `npm ci > /tmp/binding-npm-ci.log 2>&1` | **0** | only `npm audit` / `allow-scripts` warnings in `tail -15`; log kept at `/tmp/binding-npm-ci.log` |
| 4 | `git status --porcelain` (after) | 0 | see before/after below |
| 4 | `git diff HEAD -- package-lock.json` | **0** | lockfile byte-identical to HEAD - npm ci did NOT rewrite it |
| 5 | `npx jest > /tmp/binding-jest.log 2>&1` | **1** | see analysis below; log kept at `/tmp/binding-jest.log` |
| 6 | `node --version` | 0 | **v26.3.0** (machine has only Node 26; CI uses 20.x) |

### Before/after `git status --porcelain`

Before:
```
?? pnpm-lock.yaml
?? pnpm-workspace.yaml
```
After:
```
?? node_modules.pnpm-2026-09-18/
?? pnpm-lock.yaml
?? pnpm-workspace.yaml
```
The only delta is the backup directory I created at step 2 (`node_modules.pnpm-2026-09-18/`
is not covered by `.gitignore`, which only matches `node_modules/`). **No tracked file
changed.** The two foreign pnpm yaml lines are intact and were not touched.

New tree: `node_modules` = **464M**, hoisted npm layout, `node_modules/.pnpm` absent
(verified `ls: no such file or directory`). Backup `node_modules.pnpm-2026-09-18/` =
**1.0G**, kept in place - coordinator decides its fate.

### Jest result (full suite, run ONCE)

```
Test Suites: 130 failed, 59 passed, 189 total
Tests:       17 failed, 881 passed, 898 total
Snapshots:   1 failed, 5 passed, 6 total
Time:        4.087 s
jest exit code: 1
```

**But 189 != the expected 12 suites - the backup dir contaminated the scan.**
Jest's `testPathIgnorePatterns` in `package.json:127-130` is `["/node_modules/",
"<rootDir>/vendor/"]`, which does NOT match `/node_modules.pnpm-2026-09-18/`, so jest
discovered 177 dependency test suites inside the 1.0G backup (eslint-plugin-jsx-a11y,
@sinonjs/commons, tsconfig-paths, react-native template, etc.) and ran them against the
new tree.

Breakdown:

- **Repo suites: 12/12 PASS, 0 FAIL.** Exact list: `example/src/__tests__/`
  multimodalHelpers, chatHelpers, parallelHelpers, screenRegistry,
  textCompletionHelpers, stressTestHelpers, embeddingHelpers, modelInfoHelpers (8) +
  `src/__tests__/` typedArrays, formattedChat, ttsSpeaker, index (4). Zero PASS/FAIL
  lines came from inside the npm `node_modules/` (correctly ignored by the preset).
- **Distinct FAIL suites outside the backup dir: 0.**
- **The old transform failure is GONE**: `grep -c "Unexpected identifier 'ErrorHandler'"`
  on the log -> **0**. The diagnosis in this report is confirmed fixed by the npm layout.
- All 130 failing suites are inside `node_modules.pnpm-2026-09-18/`.

First failing suite, first error (verbatim):
```
FAIL node_modules.pnpm-2026-09-18/bl/test/test.js
  ● Test suite failed to run

    Cannot find module 'tape' from 'node_modules.pnpm-2026-09-18/bl/test/test.js'
```
**Classification: NEITHER of the two expected classes.** Not the old transform failure
(no Flow SyntaxError anywhere in the log), and not a real test failure of this repo -
it is an environment artifact: dependency suites discovered inside the renamed backup
dir that jest's ignore pattern was never meant to see (module-resolution failures there
stem from pnpm-layout packages resolving through the new npm tree; the one snapshot
failure is in `@fugood/eslint-config-base/test.js`, also inside the backup). They would
disappear if the backup dir were moved outside the repo root or removed (coordinator's
call - NOT deleted here). INFERENCE: no Node-version link to any failure; the only
node-26-vs-20 signal is CI's `node-version: 20.x` in `.github/actions/setup/action.yml`,
and nothing in the log implicates a node API.

### Verdict

Environment repair **applied and successful**: `npm ci` exit 0 from the tracked
`package-lock.json`, no tracked file modified, and the repo's full 12-suite jest run is
**ALIVE (12/12, 0 failures)** - the dead-12/12 diagnosis (pnpm layout vs RN preset
`transformIgnorePatterns`) is resolved. Residual: overall `npx jest` exit code is 1 only
because of the kept-backup-dir scan artifact documented above.
