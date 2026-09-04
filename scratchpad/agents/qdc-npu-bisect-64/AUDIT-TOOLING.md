# Audit: qdc-npu-bisect-64 tooling

Date: 2026-09-04. Container `kalsa-bisect-022458a` running (step 03 host build, ~380/445). NOT TOUCHED.

---

## Angle 1 — CONTRACT (driver ↔ kit)

| # | Finding | Verdict |
|---|---------|---------|
| C1 | **Kit layout matches driver expectations.** Driver (`d_run.sh:70`) lists `$D/bin $D/lib-fix`. Kit produces `bin/`, `lib/`, `lib-fix/`, `SHA256SUMS`. Tarball is self-contained. | CONFIRMED |
| C2 | **SHA256SUMS format is `sha256sum -c` compatible.** `build-kit.sh` uses `shasum -a 256 "bin/llama-bench"` → `<hash>  bin/llama-bench` (two spaces). Android `sha256sum -c` expects the same. Reference kit-upstream `SHA256SUMS` uses identical format. | CONFIRMED |
| C3 | **SHA256SUMS count is 39.** 5 binaries + 17 lib-fix + 17 lib = 39. Script asserts `[ "$(wc -l < SHA256SUMS …)" -eq 39 ]`. Reference kit-upstream has same layout (minus v75/v79/v81 skels). | CONFIRMED |
| C4 | **Missing v75/v79/v81 skels do not break the driver.** Driver `LD_LIBRARY_PATH`, `ADSP_LIBRARY_PATH`, `CDSP_LIBRARY_PATH` all point to `$D/lib-fix` only (`d_run.sh:130`). SHA256SUMS is self-consistent (only lists v73). The binary's dlopen picks up whatever HTP version is available. | CONFIRMED |
| C5 | **lib-fix/ vs lib/ question.** Driver uses `lib-fix` exclusively for all library paths. Kit puts identical copies in both `lib/` and `lib-fix/`. `lib/` is redundant but harmless; SHA256SUMS covers both. | CONFIRMED |
| C6 | **`.farf` file.** Driver creates `$D/lib-fix/llama-bench.farf` at runtime (`d_run.sh:98`). Kit does not need to pre-create it. | CONFIRMED |
| C7 | **Kit tarball path mismatch (practical, not contract).** Driver has `KIT="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-62-upstream.tgz"` (`d_run.sh:11`). Bisect produces `npu-kit-bisect-<sha7>.tgz`. User must override `KIT` variable per run. Not a format issue. | PLAUSIBLE (user operational burden) |

---

## Angle 2 — BUILD CORRECTNESS

| # | Finding | Verdict |
|---|---------|---------|
| B1 | **GGML_HEXAGON=ON is in the preset.** `CMakeUserPresets.json` → `arm64-android-snapdragon` → `GGML_HEXAGON=ON`. Configured preset `arm64-android-snapdragon-release` inherits this. CMake configure log confirms `Including Hexagon backend`. | CONFIRMED |
| B2 | **Host targets include llama-bench and ggml-hexagon.** `HOST_TARGETS` array includes `ggml-hexagon`, `llama-bench`, and all driver-needed libs. Host build log shows `[162/445] Linking CXX shared library bin/libggml-hexagon.so`. | CONFIRMED |
| B3 | **`test-backend-ops-153f` is NOT built from source.** Copied from `$V6_ROOT/bin/test-backend-ops-153f` (`build-kit.sh:100`). Per BUILD.md: "copied from kit-v6 (historical; not rebuilt)." Driver does not execute this binary. It is in SHA256SUMS but is a fixed reference artifact. | CONFIRMED (benign) |
| B4 | **⚠️ STALE BUILD DIR — `build-snapdragon` is NOT cleaned between commits.** `build-kit.sh` never runs `rm -rf build-snapdragon`. For the next midpoint, cmake re-runs `--preset` which regenerates `build.ninja`. Ninja detects source content changes via hashing. However: (a) if a `.cpp` file is removed from `CMakeLists.txt` between commits, the old `.o` stays on disk but is not linked (ninja rule removed). (b) if only headers change in a translation unit, ninja's hash detects it. (c) cmake's `--preset` reconfiguration is the safety net. **Risk is LOW for this specific range** (most commits add/modify hexagon `.c` files, not remove them), but a clean build per commit would be correct. **For a bisect tool, this is a latent defect.** | PLAUSIBLE (bisect-corrupting risk, low probability for this range) |
| B5 | **Host build step 03 currently running, no exit file yet.** `03-host-build.log` at ~380/445. `on_exit` trap will record when it finishes. First runner attempt failed exit=1 (142s, likely transient embed race per BUILD.md). | CONFIRMED (expected in-progress state) |

---

## Angle 3 — EXIT-CODE HONESTY

| # | Finding | Verdict |
|---|---------|---------|
| E1 | **`run_step` correctly captures exit codes.** Each step: `"$@" >> "$log" 2>&1; rc=$?; printf '%s\n' "$rc" > "$exit_file"`. No pipes masking failures. `run_step` returns the captured `rc`. | CONFIRMED |
| E2 | **`on_exit` trap records final exit to BUILDS.txt.** `trap on_exit EXIT` fires on any exit. `record_build` writes `$SHA7 $rc $tgz_sha $duration`. Dedup check prevents exact-duplicate lines. | CONFIRMED |
| E3 | **BUILDS.txt has stale entries.** Two lines for `022458a`: exit 127 (269s, from an earlier attempt) and exit 1 (142s, from first runner). Neither is from the current in-progress build. Different exit codes produce different lines (dedup only prevents exact matches). Confusing but not incorrect. | PLAUSIBLE (noise, not a bug) |
| E4 | **`assemble_kit` subshell exit is propagated.** `( cd … || exit 1; … ) || { rm -rf …; return 1; }`. `run_step 05-assemble-kit assemble_kit || exit $?` catches it. | CONFIRMED |

---

## Angle 4 — CONCURRENCY / DETACHED RUNNER

| # | Finding | Verdict |
|---|---------|---------|
| F1 | **Concurrency guard works.** `busy_container_check` (`build-kit.sh:55-68`) lists `docker ps` for `kalsa-bisect-*` names. Runs before each docker step. Currently one container (`kalsa-bisect-022458a`) is running; a second build-kit.sh invocation would exit 75. | CONFIRMED |
| F2 | **⚠️ No `nohup` / process-group protection on runner.** `run-midpoints.sh` is running with `ppid=1` (detached from original terminal), but was not launched with `nohup` or `setsid`. No `trap` for `SIGHUP`. If the session leader is killed (terminal close, logout), processes may receive `SIGHUP` and die mid-build. `ps` shows `??` TTY (no controlling terminal), so current state is detached, but this is fragile. | PLAUSIBLE (survivability risk) |
| F3 | **Step 0 failure handling.** `run-midpoints.sh:13-17`: if good endpoint fails, logs and exits without starting midpoint. Correct. | CONFIRMED |

---

## Angle 5 — BISECT.md COMMIT ORDER

| # | Finding | Verdict |
|---|---------|---------|
| O1 | **23 commits, chronological oldest-first.** `git log --reverse --oneline 022458a28..64a155d24 -- ggml/src/ggml-hexagon` produces exactly 23 entries. Table matches 1:1. | CONFIRMED |
| O2 | **Index 12 = `990e3bf`.** Git log line 12: `990e3bfee hexagon: fix FA HMX queue ordering and pack the rescale D matrices (#27042)`. Table: `12 | 990e3bf | hexagon: fix FA HMX queue ordering …`. sha7 matches. | CONFIRMED |
| O3 | **Good endpoint `022458a28` is the exclusive lower bound, NOT in the table.** Correct per `git log A..B` semantics. | CONFIRMED |

---

## Angle 6 — `set -u` / PATH QUOTING / DOCKER MOUNTS

| # | Finding | Verdict |
|---|---------|---------|
| P1 | **Both scripts use `set -u`.** `build-kit.sh:5`, `run-midpoints.sh:3`. | CONFIRMED |
| P2 | **`$HOME` in docker mounts, no unquoted `~`.** `--volume "$WORKTREE:/workspace"` where `WORKTREE="/Users/marco/Projects/kalsallama-wt-bisect-$SHA7"`. Docker Desktop on macOS shares `$HOME` paths. No bare `~` anywhere. | CONFIRMED |
| P3 | **No `local a=$1 b=$a` anti-pattern.** Variables are assigned directly. `set -u` would catch unset vars. | CONFIRMED |

---

## SUMMARY

| Severity | Count | Items |
|----------|-------|-------|
| CONFIRMED (correct) | 18 | C1–C6, B1–B3, E1–E2, E4, F1, F3, O1–O3, P1–P3 |
| PLAUSIBLE (latent risk) | 4 | B4 (stale build dir), E3 (stale BUILDS.txt lines), F2 (no nohup), C7 (tarball path mismatch) |
| REFUTED | 0 | — |

### Overall: **GO-WITH-FIXES**

The tooling is functionally correct for the current bisect run. The kit format, SHA256SUMS, exit-code tracking, commit ordering, and concurrency guard all check out. Two items should be fixed before the next commit is built:

1. **B4 (stale build dir)**: Add `rm -rf build-snapdragon` before cmake configure in `build-kit.sh`, or at minimum document that this is acceptable for this range. For a general-purpose bisect tool this is a correctness hazard.

2. **F2 (nohup)**: Launch `run-midpoints.sh` under `nohup` or `setsid` so the build survives terminal logout. Currently relies on `ppid=1` which is accidental, not deliberate.

## Orchestrator response (4/09 11:55)

- **B4 REFUTED.** The build dir is per-commit by construction: `build-kit.sh:203` `WORKTREE="/Users/marco/Projects/kalsallama-wt-bisect-$SHA7"` and `:224` `git worktree add --detach "$WORKTREE" "$FULL_COMMIT"`; `build-snapdragon` (`:233`) is relative to that worktree. Two commits never share a build tree; reuse only happens for a re-run of the SAME commit, which is safe.
- **F2 accepted, no action on the running build.** Runner pid 68323 has pgid 68323 and ppid 1 (verified with `ps -o pid,pgid`); future launches go through `nohup setsid`.
- **C7 accepted:** the #62 driver's `KIT` path will be overridden per run (see the #64 PREREG).
- **E3 accepted:** the two stale BUILDS.txt lines (exit 127, exit 1) are the honest record of the two failed launches; kept.
