# scratchpad/agents/governor-desktop-net - REPORT

Coder role: tests and audit only. No behaviour change shipped, no push, no tag, no upstream.
Nothing archived, nothing destructive: this cell only ADDED this file, and edited one test file
inside a private worktree. No phone was touched; every command below ran on this disk.

## 0. Both corrections are recorded here, not erased

The brief arrived with a mechanism (a dead desktop thermal baseline explains the 16x prefill gap,
closed by `a7d2cec79`). That mechanism was then refuted by its own author with three commands.
I re-ran all three myself before doing anything else:

1. `git grep -c governor a7d2cec79 -- tools/server/` -> exit 1, **0 files**. The governor is a
   library its callers instantiate; the server never reads a thermal profile. Confirmed.
2. `kalsallama/build/CMakeCache.txt` -> `GGML_METAL:BOOL=OFF`, `GGML_OPENCL:BOOL=OFF`,
   `GGML_VULKAN:BOOL=OFF`, `GGML_CUDA:BOOL=OFF`; `otool -L build/bin/libllama-server-impl.dylib`
   -> **0** Metal references (artifact mtime Sep 21 15:23). The release artefact
   (`.../kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.0/libllama-server-impl.dylib`)
   -> **1** Metal reference (`@rpath/libggml-metal.0.dylib`). Confirmed.
3. The single-binary control (0.488 vs 9.860 ms/token, one flag, one engine) is quoted from
   `scratchpad/COORDINATOR-STATE.md:116`; no raw A/B log for it exists anywhere under
   `scratchpad/` (grep for `7.853`/`14.552`/`9.860` returns only the coordinator line).

So the 16x was **CPU against GPU**, not the governor. Task A survives as a **latent hole** (if the
governor ever runs on a desktop, a dead `t_idle_c` of 0.0 must make the profile invalid and must
not ration the prefill). Task B changed axis: not "does the number precede the fix" but **"was the
build CPU-only or GPU-capable"**, with three verdict words that must not share a meaning:
**GPU-capable / CPU-only / NOT ATTRIBUTABLE**, plus the old commit-axis note where evidence allows.
Reconstruction from dates or from today's tree was not used anywhere below.

## 1. Worktree: which line, and why

- **Used: the release line, detached at `a7d2cec79`** at
  `/Users/marco/Projects/kalsallama-wt-gov-desktop-net`.
- Why not the phone line `1577495b9`: `a7d2cec79` is the exact fix commit; the delta above the
  fork head `833cde99b` is only `e3088932c` + `a7d2cec79` (gate + sole-decider pin), so nothing
  else can confound the matrix. `1577495b9` adds six OpenCL commits on top
  (`cd213fff7..1577495b9`), all unrelated to the gate, and the defect class under test is the
  desktop/release lane. Both lines contain the fix; the shorter path was chosen.
- The `main` worktree at `/Users/marco/Projects/kalsallama` was NOT used and NOT touched beyond
  reads: its HEAD is `833cde99b` (pre-fix) and its tracked tree does not match its commit
  (see section 3, row 4).

```
$ cd /Users/marco/Projects/kalsallama && git worktree add --detach \
    /Users/marco/Projects/kalsallama-wt-gov-desktop-net a7d2cec79
HEAD is now at a7d2cec79 governor : refuse a plugged baseline of 0 C or colder in the engine gate
$ git rev-parse HEAD
a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1
$ grep -n "t_idle_c > 0.0f" src/llama-governor-policy.cpp
65: ... profile.t_idle_c > 0.0f && ...
```

## 2. Task A - the validity-gate matrix

### 2.1 What was added, and where

One new function, `test_profile_validity_matrix()`, inside the existing
`tests/test-governor-v02-router.cpp` (the file the fix commit itself touches). No new file under
`tests/` (house rule: no new test file without maintainer approval; reusing the existing router
target keeps CI cost at zero new binaries). Every row asserts the **consequence**, not only the
predicate: validity (`update_thermal` return), identity of the state, the lane
(`prefill_engine()`), and what happens to a prefill (`admit_prefill` decision). The probe prompt
is 1900 tokens, the same size as the A/B prefill.

Profiles are built by one helper that models the contamination premise exactly: plugged,
sensor valid, **`t_idle_valid` forced true** (the dead reading arrives flagged valid), realistic
current temperature.

### 2.2 The matrix (all values below are the behaviour actually pinned and passing at `a7d2cec79`)

| # | `t_idle_c` | temp | profile valid? | state | what the policy does with the prefill |
|---|---|---|---|---|---|
| 1 | `0.0` (dead reading, the desktop case) | 35.0 C | **no** (gate: `0 > 0` fails) | `Invalid` | lane closed to CPU; `admit(CPU,1024)` = **Abort** (never rationed) |
| 2 | `0.0` at a cool 25.5 C | 25.5 C | **no** | `Invalid` | refusal does not depend on current temperature |
| 3 | `-5.0` | 35.0 C | **no** | `Invalid` | **Abort** |
| 4 | `NaN` | 35.0 C | **no** (`isfinite` fails) | `Invalid` | **Abort** |
| 5 | `+inf` | 35.0 C | **no** (`isfinite` fails) | `Invalid` | **Abort** |
| 6 | `25.0` (room temperature, valid band) | 25.5 C | **yes** | `FAST` | lane **left alone** (GPU); `admit(GPU,1900)` = **Chunk to 1024** (rationed to the table); `admit(CPU,1024)` = **Admit** (untouched) |
| 7 | `40.0` (largest whole degree the gate accepts; all three derived thresholds clamp to 42.0) | 41.9 C | **yes** | `FAST` | lane GPU, but `admit` at 41.9 = **Wait** (no chunk fits the ceiling: pause, not abort) |
| 8 | `40.0` at the clamp | 42.0 C | **yes** | `CRITICAL` | lane CPU; **Abort** (clamped `critical_enter` trips at exactly 42.0) |
| 9 | `36.0` (clamp proof: unclamped `idle+7` would be 43.0, so only `min(idle+7,42)` makes 42.0 C critical) | 42.0 C | **yes** | `CRITICAL` | pins `min(idle+7, 42)` |
| 10 | `41.0` (gate boundary: `41+1 = 42`, not `< 42`) | 35.0 C | **no** | `Invalid` | **Abort** |
| 11 | recovery: `0.0` refused, then a real `25.0` | 35.0 -> 25.5 C | **yes on the second poll** (the dead reading never latches the plugged reference, so the 1.5 C drift check does not fire) | `FAST` | `admit(CPU,1024)` = **Admit**: prefill resumes |

### 2.3 Run results and counts

```
$ wc -l tests/test-governor-v02-router.cpp
451 tests/test-governor-v02-router.cpp          (320 at a7d2cec79, +131)
$ grep -c "^\s*check(\| check(" tests/test-governor-v02-router.cpp
100                                              (63 at a7d2cec79, +37 check call sites)
$ ./build/bin/test-governor-v02-router
router_v02_golden=PASS
router_v02_metrics=PASS
$ ctest -R test-governor-v02-router --output-on-failure
100% tests passed, 0 tests failed out of 1
```

Suite runs: final state **green** (binary exit 0, ctest 1/1).

### 2.4 The regression trial - the net proven red for the right reason

The gate line `profile.t_idle_c > 0.0f` was removed from `src/llama-governor-policy.cpp` in this
worktree (reproducing the pre-fix class of mistake), the target rebuilt, the suite run, then the
file restored with `git checkout --`, rebuilt and re-run green. Source diff in the worktree after
the trial: only `M tests/test-governor-v02-router.cpp`.

```
router-v02: FAIL engine rule refuses a zero plugged baseline            (pre-existing pin)
router-v02: FAIL engine rule refuses a negative plugged baseline        (pre-existing pin)
router-v02: FAIL refused baseline leaves the state Invalid              (pre-existing pin)
router-v02: FAIL zero dead baseline is refused                          (new)
router-v02: FAIL zero dead baseline is Invalid, not a derived CRITICAL  (new)
router-v02: FAIL refusal does not depend on current temperature         (new)
router-v02: FAIL cool dead baseline is Invalid too                      (new)
router-v02: FAIL negative dead baseline is refused                      (new)
router-v02: FAIL negative dead baseline is Invalid                      (new)
router-v02: FAIL dead reading refused first                             (new)
router-v02: FAIL real baseline after refusal is accepted                (new)
router-v02: FAIL real baseline after refusal classifies FAST            (new)
router-v02: FAIL prefill resumes after a refused dead reading           (new)
REGRESSION-TRIAL exit=1        -> 13 FAIL (10 from the new matrix, 3 from the fix's own pins)
```

### 2.5 Surprises (reported, not adjusted away)

1. **"Invalid" does not mean "prefill runs free".** A refused profile closes accelerator
   admission entirely: `Abort` at policy level, and at runtime
   `llama_governor::admit_prefill` maps Abort to a permanent `fail()` (`set_thermo_profile`
   logs "accelerator admission is closed"). On a hypothetical desktop governor the dead reading
   yields abort/pause, never table-rationed prefill - the latent hole is closed by refusal, and
   the fast lane only exists because the caller stops feeding a dead reading.
2. **At realistic temperatures the pre-fix and post-fix admission outcomes coincide** (pre-fix:
   valid + derived `critical_enter = 7.0` -> `CRITICAL` -> `Abort`; post-fix: `Invalid` ->
   `Abort`). So the Abort assertions alone would NOT catch a regression; the teeth are the
   validity return, the `Invalid`-vs-`CRITICAL` identity, and row 11. The regression trial
   confirmed exactly this split: the Abort checks stayed green under sabotage, those three
   classes went red.
3. **`NaN` and `+inf` rows stayed green in the regression trial** - `isfinite` predates the fix.
   They are kept as matrix completeness, not as regression detectors for this class.
4. **Two different refusals exist one boundary apart**: valid-but-41.9 C -> `Wait` (pause,
   recoverable), `CRITICAL` at 42.0 or any invalid profile -> `Abort` (latching at runtime).

## 3. Task B - provenance audit of desktop speed / prefill numbers

### 3.1 Sweep method and counts

- `find scratchpad -name REPORT.md` -> **228** files; grep for
  `ms/token|[0-9] t/s|tok/s|tokens/s` in those -> **87** files (304 lines).
- Classified every one by name and by reading its speed lines: **4** carry desktop numbers,
  **83** are device (Adreno / HTP / Mali / Mellum / Xiaomi / Jelly / S23) or third-party quotes.
- `analysis/*.md`: only device numbers (`GOVERNOR-DEVICE-PLAN.md`, `XIAOMI-...md`); no desktop
  speed figures. `PLAN.md` / `docs/ALIVE.md`: device t/s lines (S23/Adreno) plus the desktop
  panel rows below. `scratchpad/COORDINATOR-STATE.md` (root, not a REPORT.md): tonight's A/B,
  the only `ms/token` figures in the lab.
- `build/bin/llama-server` is cited in one REPORT (`engine-checkpoint-salt-review`) with no
  speed figure. `BigMoeOnEdge/docs/bench-data/` holds desktop CSVs, cited by **no** in-scope
  REPORT.md (grep for `bench-data` -> no hits), so they are outside the published record.

### 3.2 The table

| # | Value | Where recorded | Build id / commit | Tree state at build time | Backend evidence | Verdict | Load recorded? |
|---|---|---|---|---|---|---|---|
| 1 | **1495.0 tok/s** prompt (14,111 tok / 9438.734 ms) and **71.33 tok/s** decode (2000 / 28026.361 ms); repeated as cold reference `1495 tok/s` at `:174` | `scratchpad/agents/slot-save-restore-measure/REPORT.md:69,174` | in-binary `--version`: build 11187, commit `2a290390d`, AppleClang Darwin arm64 | **not recorded** (no manifest line in the cell; only the binary path) | binary path `.../kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.0/kalsa-server`; I ran `otool -L` on that exact dylib: **1 Metal ref** -> GPU-capable. The run's `--n-gpu-layers` flag is **absent** from the exact command line the report quotes -> which lane ran is **not attributable** | **GPU-capable** (lane flag not recorded). Commit-axis note: `2a290390d` (Sep 21 00:47) **precedes the fix** (`git merge-base --is-ancestor a7d2cec79 2a290390d` -> false), which is irrelevant to server behaviour per refutation 1 | No load condition -> signature not applicable |
| 2 | Panel: **69.17 t/s** alone / **52.20 each**, aggregate **1.5093** (run 1), **1.4604** (run 2), **1.4672** (run 3 = panel row), per-device 0.73-0.75 | `PLAN.md:354-359`, `docs/ALIVE.md:247-253`, registered in `scratchpad/agents/docs-refresh/REPORT.md:69,117,133-138`; primary artefact `kalsa-brain/dev/results/concurrency-two-devices/results.json` (current file = run 3; run 1 survives only at kalsa-brain commit `5b9b98f`) | kalsa-server **v1.1.1** = kalsallama commit **`a7d2cec79`**, tag object `0f1b3bec`, GitHub Actions run 35762258094, built 2026-09-22T17:50:26Z, in-binary build 11195; harness commits per run: `5b9b98f` / `fe14e78` / `34de14f` (kalsa-brain) | **recorded**: `/tmp/k111/manifest.json` ties tag -> commit -> `exe_sha256 327fb363...`, `release.status = matched`, match basis "exe_sha256 of the executed binary ... never a path, never a directory name"; CI checkout ("push on a tag", `reproducible: true`) | manifest: `"platform": "macos-arm64", "backend": "metal"`; harness `argv` includes `--n-gpu-layers all`; artefact still on disk at `/tmp/k111/` (tar + manifest + run logs) | **GPU-capable, fully attributable; CONTAINS THE FIX** (commit is `a7d2cec79` itself) | Yes: per-run load floor (~4-6 / ~2 / 4.08) and `max_load: 6.0`. These are decode-concurrency numbers, so the prefill ms/token load-follows signature does not apply |
| 3a | **7.853 -> 14.552 ms/token** at load 16 (fork arm) | `scratchpad/COORDINATOR-STATE.md:108` (no raw log exists under `scratchpad/`) | `833cde99b` (recorded) | development `build/bin/llama-server`: binary mtime Sep 21 **15:23**, HEAD commit 15:23:38, dirty edits at 15:24 / 15:27 / 15:29 -> the binary **predates** the dirty content, so it matches its commit **by luck, not by construction** (the coordinator's own phrase). A NEW build from that dir would not be attributable: today's tracked tree is +465/-13 over HEAD and byte-identical to `1068eb03d` (`git diff 1068eb03d --stat` empty) | `CMakeCache.txt` (mtime 10:34) all four backends OFF; `otool -L` on that dylib: **0 Metal refs** (both run by me today) | **CPU-only build** - label it as such wherever it is quoted; it is a legitimate measurement of a configuration we use for correctness, of the fork arm of an A/B | Yes: rest vs load 16. Signature applies and was the observation that started this |
| 3b | **0.490 -> 0.504 -> 0.501 ms/token** at loads 11.4-39.7, and the control **0.488 (`--n-gpu-layers all`) vs 9.860 (`--n-gpu-layers 0`)** | `scratchpad/COORDINATOR-STATE.md:108,116` | `a7d2cec79` (recorded) | binary path and tree state **not recorded**; `/tmp/k111/` holds a metal artefact of exactly this commit, but no record ties the A/B to it - not asserted | the control itself is the evidence: a CPU-only build cannot produce a 20x response to one flag | **GPU-capable (self-evidenced), artefact path/tree NOT ATTRIBUTABLE.** What would fix that: a raw A/B log carrying binary path + `exe_sha256` - the provenance block in `measure-concurrency.py` already is that pattern | Yes: loads 11.4-39.7 + the control |
| 4 | **0.94 vs 0.61 tok/s** decode (+56%), 1.22 -> 0.60 s/tok, on a "16 GB Apple-silicon Mac" | `scratchpad/agents/bigmoe-upstream-recon/REPORT.md:152` | quoted from upstream commit **`e02b477`**'s message (section 4 of the 31-commit recon; the surrounding file paths are theirs) | not ours to record | not ours to check | **NOT ATTRIBUTABLE - third-party number**, ours neither to label nor to withdraw; evidence that would help lives in the upstream repo, not ours | not recorded |
| 5 | 71.33 tok/s (reference to row 1) | `scratchpad/agents/disk-chat-engine-recon/REPORT.md:1129` | same as row 1 | same as row 1 | same as row 1 | reference, not a separate measurement | same as row 1 |

### 3.3 The load-follows signature

It can be applied retroactively in exactly two places: the A/B (row 3, explicit loads) and the
panel runs (row 2, load floors - but decode-concurrency, not prefill ms/token). For the
single-stream desktop timings (row 1 and everything quoted from them) **our numbers do not
record the load condition, so this signature cannot be applied retroactively** - that is a
finding about our own records: future desktop timings should carry load alongside the time.

### 3.4 Verdict (one sentence)

**Under the corrected criterion none of our published desktop numbers except the A/B fork arm
(7.853 / 14.552) was measured on a CPU-only build, and that pair already sits in the only record
that explains it, so it needs a CPU-only label rather than withdrawal; everything else in scope
is GPU-capable, fully attributable where `manifest.json`/`exe_sha256` carries it, with two items
deliberately written NOT ATTRIBUTABLE (the A/B release artefact's path and tree, and the
upstream-quoted Mac number) rather than guessed.**

## 4. Discipline quotes

```
$ ls -la /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-desktop-net/
total 40
drwxr-xr-x   3 marco  staff   96 Sep 23 02:25 .
drwxr-xr-x@ 261 marco  staff 8352 Sep 23 02:25 ..
-rw-r--r--   1 marco  staff 17218 Sep 23 02:25 REPORT.md

$ wc -l .../governor-desktop-net/REPORT.md .../tests/test-governor-v02-router.cpp
  209 .../scratchpad/agents/governor-desktop-net/REPORT.md
  451 .../kalsallama-wt-gov-desktop-net/tests/test-governor-v02-router.cpp
  660 total

$ git -C kalsallama-wt-gov-desktop-net status --porcelain
 M tests/test-governor-v02-router.cpp
$ git -C kalsallama-wt-gov-desktop-net rev-parse HEAD
a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1
$ git -C /Users/marco/Projects/kalsallama status --porcelain | wc -l
12                      (pre-existing dirty state of main, untouched by this cell)
```

Counts to carry: **37** new check call sites, **13** red in the regression trial, **1/1** ctest
pass in the final state, **87** speed-bearing REPORT.md of 228, **4** desktop, **83**
device/third-party, **0** phone runs, **0** lab files modified or archived.

## 5. Closing

A flag is a hypothesis, not a finding.
