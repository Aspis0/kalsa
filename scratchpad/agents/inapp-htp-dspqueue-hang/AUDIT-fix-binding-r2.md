# Binding HTP skew fix: hostile audit r2

**Verdict: FIX FIRST.** The new stamp gate can be made to accept stale DSP code, it does not bind the skels to the actual vendored source bytes, and one workflow that produces the release example APK never invokes the gate. The app checkout still pins the pre-fix binding revision.

Scope: `llama.rn-kalsa-gov-platform`, branch `feat/governor-platform-status`, diff `1a47c48f..fa8d83ef`; engine source read at pin `61c9094811cb200fd475491f18f594fbde77634b`. I made all mutations in detached worktree `/tmp/audit-binding-htp`, restored them, and removed that worktree. No source checkout was edited. I did not commit, push, run a full suite, build an APK, or use a device.

## 1. Gate soundness and APK paths

### F1 — CONFIRMED BLOCKER: the identity is a claimed upstream pin, not a fingerprint of the inputs used by host and DSP builds

> `scripts/build-htp-skels.sh:24`: `ENGINE_SHA="$(sed -n 's/^LLAMA_CPP_COMMIT=//p' "$ROOT_DIR/vendor/VERSIONS")"`
>
> `scripts/build-htp-skels.sh:73`: `git -C "$ROOT_DIR" archive HEAD -- "${ARCHIVE_PATHS[@]}" > "$WORK/src.tar"`
>
> `scripts/htp-skels-container.sh:36`: `const char kalsa_htp_engine_stamp[] __attribute__((used)) =` / `"KALSA_HTP_ENGINE=%s";`
>
> `scripts/assert-htp-skels.sh:65`: `if [ "$manifest_engine" != "$pin_engine" ]; then`
>
> `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/htp-ops.h:107`: `HTP_OP_FENCE,`

The build labels the skel with `vendor/VERSIONS`; the gate checks that label against the same file. It never fingerprints the vendored HTP/host protocol inputs or proves the host was built from the exact same content. In the throwaway tree I changed the shared enum line to `HTP_OP_FENCE = 1000,` and left the pin, manifest, and binaries untouched. The gate still returned **0**. A committed vendor patch or source edit under the same upstream SHA can therefore change the host/DSP protocol while old skels pass. This defeats the stated guarantee.

### F2 — CONFIRMED BLOCKER: a stale skel passes when the stamp is copied into its bytes

> `scripts/assert-htp-skels.sh:102`: checks the first 20 bytes for ELF magic, 32-bit little-endian, and e_machine 164.
>
> `scripts/assert-htp-skels.sh:103`: uses a 256 KiB size floor.
>
> `scripts/assert-htp-skels.sh:123`: `stamps="$(grep -aoE 'KALSA_HTP_ENGINE=[0-9a-f]{40}' "$file" || true)"`
>
> `scripts/assert-htp-skels.sh:130-132`: `skel_engine="${stamps#KALSA_HTP_ENGINE=}"` then compare with `pin_engine`.

This is a raw-byte substring test, not a stamp-symbol or loadable-section test. In `/tmp`, I took the old c847 v79 skel (730,376 bytes), appended the current pin string after its original section and segment bounds, updated the manifest digest, and ran the gate: **0**. A second mutation used a 300 KiB zero-filled file with only an ELF-looking first 20 bytes plus the stamp; after updating its digest the gate also returned **0**. The digest only proves the manifest matches the current file, not that the file was built from the claimed source. The comment at `scripts/assert-htp-skels.sh:25-26` (“only a rebuild ... can satisfy this leg”) is false.

### F3 — CONFIRMED GAP: the gate accepts a partial supported DSP set

> `scripts/build-htp-skels.sh:22`: `DSP_VERSIONS="v73 v75 v79 v81"`
>
> `scripts/assert-htp-skels.sh:72-73`: discover shipped files; fail only if there are no `libggml-htp-*.so` files.
>
> `scripts/assert-htp-skels.sh:79-85`: compare shipped filenames with manifest filenames.

I removed `libggml-htp-v81.so` and its manifest line in `/tmp`; the gate returned **0** and reported three skels. It validates agreement between the files that happen to exist and the manifest, but not the required four-version set. The example Gradle task separately lists all four (`example/android/app/build.gradle:29-35`), but the standalone gate and release artifact gate do not.

### F4 — CONFIRMED BLOCKER: a real APK-producing workflow skips the gate

> `.github/workflows/build-example-android.yml:79-84`: `Build Android release` runs `./gradlew assembleRelease`.
>
> `.github/workflows/build-example-android.yml:86-105`: prepares and uploads the resulting `example-app-release.apk`; there is no `assert-htp-skels.sh` step in this workflow.
>
> `example/android/app/build.gradle:41-52`: `prepareHTP` only checks that listed artifacts `.exists()`.
>
> `example/android/app/build.gradle:55-57`: `preBuild` depends on `prepareHTP`.
>
> `android/build.gradle:63-66`: the package only depends on `prepareHTP` if the consuming app defines that task.
>
> `android/build.gradle:56-60`: HTP libraries are copied by the `libggml-htp-*.so` glob.

This downstream release APK path relies on presence checks, not stamp, digest, or protocol validation. By contrast, `.github/workflows/release.yml:54-55` gates before the library artifact package, and `.github/workflows/ci.yml:211-212` gates after one Android build. Those do not close the missing gate in `build-example-android.yml`.

The consumer app is also stale:

> `/Users/marco/Projects/kalsa/package.json:52`: `"llama.rn": "github:Aspis0/kalsa.rn#c84714498782bf1176a339ea8c873460f56049b1"`
>
> `/Users/marco/Projects/kalsa/package-lock.json:10071`: same `c847144...` resolved revision.
>
> `/Users/marco/Projects/kalsa/native/kalsallama.pin:1`: `d07d0181b3249189c6132e0c9d669ec7164de6cc`
>
> `/Users/marco/Projects/kalsa/package.json:7`: `"android": "expo run:android"`
>
> `/Users/marco/Projects/kalsa/android/gradle.properties:65`: `rnllamaBuildFromSource=true`
>
> `/Users/marco/Projects/kalsa/scripts/assert-engine-provenance.sh:10`: `It is a manual gate`.

The app resolves the pre-fix c847 binding, whose embedded engine pin is d07, and has no HTP-skew gate in its normal `expo run:android` path. The five reviewed commits cannot protect that app until its npm dependency/lockfile and engine pin move to a fixed revision and the consumer build invokes an HTP gate.

### F5 — CONFIRMED CI coverage hole: “every branch” is not true

> `.github/workflows/ci.yml:3-10`: pushes are limited to `main` and `kalsa`; pull requests target only `main`; manual dispatch is separate.
>
> `.github/workflows/ci.yml:18-20`: comment says the vendor gate “always runs” and “on every branch”.
>
> `lefthook.yml:1-16`: pre-commit runs lint/types and commit-msg runs commitlint; no HTP gate.
>
> `scripts/assert-htp-skels.sh:12`: says the gate runs “at commit time and in CI.”

A direct push to `feat/governor-platform-status` does not trigger this workflow, and no local commit hook runs the HTP gate. A PR to `main` does. The current branch’s stated coverage is overstated.

### F6 — REFUTED: CI/Gradle rebuild or overwrite `bin/`

> `scripts/build-htp-skels.sh:88-96`: the manual recipe copies outputs into `bin/` and refreshes the QAIC stub.
>
> `package.json:55`: `build:android-libs` runs only `build-opencl.sh` and `build-android.sh`.
>
> `example/android/app/build.gradle:38-40`: says the task only verifies committed inputs.

Search of CI, Gradle, package scripts, and workflows found no call to `build-htp-skels.sh` except its own usage/error references. The reviewed CI/release build paths do not regenerate skels. This is one change that works as intended.

## 2. Recipe and binary provenance

### F7 — CONFIRMED reproducibility weakness: mutable image tag, no version enforcement

> `scripts/build-htp-skels.sh:19`: `IMAGE="ghcr.io/snapdragon-toolchain/arm64-android:v0.7"`
>
> `scripts/build-htp-skels.sh:46-49`: pull only when `docker image inspect "$IMAGE"` fails.
>
> `scripts/htp-skels-container.sh:42-43`: checks that SDK/tool roots exist, not their versions.
>
> `scripts/htp-skels-container.sh:98-100`: prints SDK path and compiler version but does not compare them to expected values.
>
> `bin/arm64-v8a/HTP_SKELS:24-26`: records the `v0.7` image tag and SDK/tools versions as provenance.

No immutable image digest is pinned. An existing local tag is accepted without refresh; provenance text is informational. **PLAUSIBLE** outcome: tag contents or local image drift can change future builds without a recipe diff.

There is also a concrete toolchain split:

> `bin/arm64-v8a/HTP_SKELS:32-34`: skels claim SDK 6.6.0.0 / Tools 19.0.07.
>
> `.github/workflows/ci.yml:194-203`: Android host build uses SDK 6.4.0.2 / Tools 19.0.04.

This does not prove incompatibility, but no Android build was run to establish that the 6.6-generated QAIC stub and host backend built with 6.4 are compatible: **PLAUSIBLE integration risk**.

### F8 — PLAUSIBLE recipe drift: the container script is mounted from the live worktree

> `scripts/build-htp-skels.sh:37-42`: claims source is `git archive HEAD`; the cleanliness check covers only `vendor/llama.cpp`.
>
> `scripts/build-htp-skels.sh:78`: mounts `$ROOT_DIR/scripts/htp-skels-container.sh` directly into the container.

The source archive is committed content, but a dirty, uncommitted container recipe can still produce committed binaries; the recipe file is not archived or included in the clean-tree check. The recorded recipe is therefore not necessarily the recipe used for a local build.

### F9 — CONFIRMED dead retry/error bookkeeping in the recipe

> `scripts/htp-skels-container.sh:1`: `#!/bin/bash -e`
>
> `scripts/htp-skels-container.sh:16`: `set -euo pipefail`
>
> `scripts/htp-skels-container.sh:51`: runs `cmake` configure as a simple command before `conf_rc=$?` at line 61.
>
> `scripts/htp-skels-container.sh:73`: runs `cmake --build .` as a simple command before `build_rc=$?` at line 74 and the retry loop at lines 71-80.
>
> `scripts/htp-skels-container.sh:83`: runs `cmake --install .` as a simple command.

With errexit active, a nonzero configure/build/install command exits the shell before the following status assignment, retry, or install diagnostic can run. The advertised three build attempts (`scripts/htp-skels-container.sh:68-76`) therefore do not happen after a failed build. The outer Docker command also exits nonzero, so I retract the suspected false-success path: the container failure does not get ignored by the driver.

### F10 — REFUTED secret/host-path leak; PLAUSIBLE unverified loader compatibility

> `bin/arm64-v8a/HTP_SKELS:25`: archive extraction path is the fixed `/tmp/kalsa-htp/src`.
>
> `scripts/htp-skels-container.sh:36-37`: adds a constant data TU with the engine stamp.

`nm -a bin/arm64-v8a/libggml-htp-v73.so | grep kalsa_htp_engine_stamp > /tmp/audit-binding-htp-nm.log 2>&1; echo $?` → **0**, output `000d2d00 R kalsa_htp_engine_stamp`. `strings bin/arm64-v8a/libggml-htp-v73.so | grep '/tmp/kalsa-htp' > /tmp/audit-binding-htp-fixed-path.log 2>&1; echo $?` → **0**. `strings bin/arm64-v8a/libggml-htp-v73.so | grep '/Users/' > /tmp/audit-binding-htp-host-path.log 2>&1; echo $?` → **1** (no match). The TU adds a symbol/string, not executable behavior or a constructor. Binaries contain deterministic `/tmp/kalsa-htp/...` paths and no local checkout paths, tokens, or secrets. I found no evidence the loader rejects the new symbol, but no device/runtime load was performed: that residual is **PLAUSIBLE**, not established.

## 3. Runtime fallback

### F11 — CONFIRMED: tested predicate matches the pinned engine’s prefill and HTP-timeout path

> `cpp/rn-governor-params.cpp:195-202`: requires `n_tokens > 1`, `prefill_engine == NPU`, `rc == -3`, and reason prefix `llama_decode failed with rc=`.
>
> `vendor/llama.cpp/src/llama-governor.cpp:259`: `const bool is_prefill = batch.n_tokens > 1;`
>
> `vendor/llama.cpp/src/llama-governor.cpp:321-329`: failed `llama_decode` logs and stores the exact `llama_decode failed with rc=%d` prefix.
>
> `vendor/llama.cpp/src/llama-governor-runtime.cpp:109-110`: stores `admission.engine` into `stats_.prefill_engine`.
>
> `vendor/llama.cpp/src/llama-context.cpp:1933`: `GGML_STATUS_ABORTED` returns `2`.
>
> `vendor/llama.cpp/src/llama-context.cpp:1934`: `GGML_STATUS_ALLOC_FAILED` returns `-2`.
>
> `vendor/llama.cpp/src/llama-context.cpp:1935`: `GGML_STATUS_FAILED` returns `-3`.
>
> `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3629-3639`: waits for a batch response until a deadline and sets a timeout error.
>
> `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7058-7062`: HTP session error returns `GGML_STATUS_FAILED`.
>
> `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:118`: default response timeout is `30000` ms.

Thus the known missed-response timeout becomes -3 and is caught on an NPU-routed prefill. It may still block for 30 seconds before the failure is visible.

### F12 — PLAUSIBLE false positive: -3 does not identify which backend failed

> `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7058-7060`: HTP errors become generic `GGML_STATUS_FAILED`.
>
> `vendor/llama.cpp/src/llama-context.cpp:355-360`: the backend set always includes CPU.
>
> `vendor/llama.cpp/src/llama-context.cpp:2614-2617`: scheduler graph errors are logged as a generic status.
>
> `cpp/rn-governor-params.cpp:198`: helper accepts any -3 on an NPU-prefill route.

The prefill route was admitted as NPU, but the returned status contains no failing-backend identity. If CPU work in that scheduled graph fails while the route statistic remains NPU, this predicate can disable the HTP lane for a non-HTP cause. No such failure was reproduced; this is a plausible attribution gap.

### F13 — PLAUSIBLE false negative / latency limit: only returned -3 failures are caught

> `cpp/rn-governor-params.cpp:198-202`: all other rc values and non-prefill batches return false.
>
> `vendor/llama.cpp/src/llama-context.cpp:1932-1935`: allocation failure is -2 and abort is 2, distinct from -3.
>
> `vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:118`: timeout is 30 seconds.

The known HTP RPC timeout is covered. A DSP problem that aborts with another status, or wedges below/outside the response-poll loop so it never returns, will not set the sticky fallback. I found no evidence that the tested RPC timeout takes another rc; the wider hang/other-status cases remain **PLAUSIBLE**, not confirmed failures. Decode is not an HTP route in the pinned policy: `llama-governor-policy.cpp:418-423` chooses CPU or GPU_COOLMODE for decode, so the `n_tokens > 1` guard does not appear to miss an NPU decode path.

### F14 — CONFIRMED data race on fallback state

> `cpp/rn-llama.cpp:845`: writer assigns `governor_npu_fallback` as a plain pointer.
>
> `cpp/jsi/RNLlamaJSI.cpp:896`: stats task gets `ctx->governorStats()`.
>
> `cpp/jsi/RNLlamaJSI.cpp:901`: stats task reads `ctx->governor_npu_fallback`.
>
> `cpp/jsi/RNLlamaJSI.cpp:902`: stats task copies bytes through that pointer.
>
> `cpp/jsi/RNLlamaJSI.cpp:1261`: completion checks `throwIfContextBusy(ctx)`; the stats task at lines 893-902 has no such guard.
>
> `cpp/jsi/JSIUtils.cpp:69`: `createPromiseTask` enqueues worker work.
>
> `cpp/jsi/ThreadPool.h:13`: `std::vector<std::thread> workers;`
>
> `cpp/jsi/ThreadPool.h:43`: default worker count is `std::thread::hardware_concurrency()`.
>
> `cpp/jsi/ThreadPool.cpp:18`: starts one thread per worker.
>
> `cpp/jsi/ThreadPool.cpp:34`: each worker executes `task();`.

A stats request can overlap a failing decode. The unsynchronized pointer read/write is a C++ data race; make the state atomic/locked or snapshot it under a lock. The owned storage fixes the earlier dangling-`getenv` pointer, but it does not make this access synchronized.

### F15 — CONFIRMED retry sequencing; PLAUSIBLE global-environment concurrency

> `cpp/rn-llama.cpp:856`: sets `KALSA_HTP_FALLBACK=htp-runtime-error`.
>
> `cpp/rn-llama.cpp:113-116`: each later load reads the environment and resolves the route.
>
> `cpp/jsi/RNLlamaJSI.cpp:1361-1365`: sticky failed context throws to caller.
>
> `cpp/rn-llama.cpp:846-855`: documents that the app retry is a governor-off reload and the env controls later governor loads.
>
> `/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2231`: marks a runtime retry as `fallback-consumed`.
>
> `/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2611`: sets `enabled: !governorRuntimeOff` for the retry.

The failed context is not retried in place; the throw lets the app recreate it, and a later governor-enabled load reads the env and keeps NPU disabled. The env set does not disable the app’s immediate governor-off retry. This sequence is coherent. `setenv`/`getenv` are process-global and may race with concurrent model loads or other environment access; no synchronization is shown, so that narrower case is **PLAUSIBLE**. If `setenv` itself fails, line 860 says the next load keeps HTP; that failure is logged but not otherwise repaired.

## 4. Log line and parser compatibility

### F16 — REFUTED parser break and new prompt-text leak

> `cpp/rn-llama.cpp:767`: new field is `npu_fallback:"%s"` on `KALSA_GOVERNOR_FALLBACK`.
>
> `/Users/marco/Projects/kalsa/src/engine/governorRuntime.ts:42`: app detection tests for the marker substring.
>
> `/Users/marco/Projects/kalsa/scripts/campaign/config.mjs:24`: lab telemetry matches the line by prefix.
>
> `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh:284`: campaign counts the marker by substring.
>
> `vendor/llama.cpp/src/llama-governor.cpp:322-327`: runtime failure reason is the fixed `llama_decode failed with rc=%d` text.

The parsers found do not require a fixed field count/order, so the added field does not break them. The new value is a fixed reason string; it does not contain model prompt text. Other failure reasons can be separately supplied by engine code, but this addition does not introduce model text.

## 5. Tests, CI, and vendor sync

### F17 — CONFIRMED LFS-enabled CI checkout; PLAUSIBLE free-quota risk

> `tests/.gitattributes:1`: `tiny-random-llama.gguf filter=lfs ...`
>
> `.github/workflows/ci.yml:53-56`: only the test job’s checkout sets `lfs: true`.
>
> `tests/parallel_decoding_test.cpp:209-214`: model load failure returns FAIL, not SKIP.

> `tests/tiny-random-llama.gguf:3`: `size 65973792`

The checked-in LFS pointer says the payload is 65,973,792 bytes (about 62.9 MiB). GitHub documents 10 GiB monthly free LFS bandwidth for GitHub Free and says bandwidth is blocked after quota when no spending limit/payment method covers overage; `actions/checkout` documents `lfs: true` as downloading LFS files. At that size, 162 full downloads fit below 10 GiB; the 163rd exceeds it before accounting for any other downloads. CI is configured to fetch the payload when the account has available bandwidth; no GitHub Actions run was triggered in this audit. Whether this repository is near quota is unknown, so outage is **PLAUSIBLE**, not confirmed. Sources: [GitHub LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs), [actions/checkout](https://github.com/actions/checkout).

### F18 — REFUTED patch fuzz; targeted verification results

> `scripts/sync-vendor.sh:303-305`: `patch -p1 --fuzz=0` is intentional.

In the throwaway worktree:

- `npm run sync:vendor > /tmp/audit-binding-htp-sync.log 2>&1; echo $?` → **0**. `git diff --quiet HEAD -- vendor/llama.cpp; echo $?` → **0**; patches applied without tracked vendor drift or fuzz/offset warnings.
- `tail -5 /tmp/audit-binding-htp-sync.log` ended with `==> Done. Review with: git status vendor src/version.ts`.
- `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-baseline.log 2>&1; echo $?` → **0**.
- `env PATH=/usr/bin:/bin ./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-macos-shasum.log 2>&1; echo $?` → **0** on macOS Bash 3.2 using the `shasum` fallback.
- Ubuntu 24.04 container copy: `tar -C /tmp/audit-binding-htp -cf - . | docker run --rm -i --platform linux/amd64 ubuntu:24.04 bash -c 'mkdir /repo && tar -xf - -C /repo && cd /repo && ./scripts/assert-htp-skels.sh' > /tmp/audit-binding-htp-ubuntu-copy.log 2>&1; echo $?` → **0**.
- Pin mismatch: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-pin.log 2>&1; echo $?` → **1**. Seven-character pin: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-prefix.log 2>&1; echo $?` → **1**.
- Seven-character manifest SHA: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-manifest-prefix.log 2>&1; echo $?` → **1**. Seven-character binary stamp: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-stamp-prefix.log 2>&1; echo $?` → **1**.
- Unstamped old v79: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-old.log 2>&1; echo $?` → **1**. Two stamps: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-duplicate.log 2>&1; echo $?` → **1**.
- Old c847 v79 with the current stamp appended after original section/segment bounds and the manifest digest updated: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-old-restamped.log 2>&1; echo $?` → **0**. Original file size was 730,376 bytes; its highest section end was 729,347 and highest segment end 693,672.
- Existing stamp in a valid skel zeroed in place, same stamp appended at EOF, manifest digest updated: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-trailer.log 2>&1; echo $?` → **0**. A 300 KiB fake file with an ELF-looking first 20 bytes plus current stamp at offset 100 and updated digest: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-fake.log 2>&1; echo $?` → **0**.
- Missing v81 binary and manifest line: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-missing.log 2>&1; echo $?` → **0**. Extra unlisted v99 skel: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-extra.log 2>&1; echo $?` → **1**.
- Shared HTP protocol enum edit only: `./scripts/assert-htp-skels.sh > /tmp/audit-binding-htp-protocol.log 2>&1; echo $?` → **0**.

These are targeted gate/sync checks, not a full suite or an Android build. I found no evidence of another CI test failure unrelated to an actual model-fetch/runtime defect; the CI test’s LFS failure mode is described above.

## 6. Clean-code notes

### F19 — CONFIRMED misleading comments; no dead helper/API found in the reviewed change

> `scripts/assert-htp-skels.sh:12`: claims “at commit time and in CI”; `lefthook.yml:1-16` has no such hook.
>
> `scripts/build-htp-skels.sh:4`: calls this the “ONLY supported way,” although the gate can be passed by appending a stamp to old bytes (F2).

The QAIC generated outputs are 273 lines (`vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73/htp_iface.h`) and 415 lines (`.../htp_iface_stub.c`); they are generated checked-in outputs, not hand-written logic. I found no newly added dead helper or unused public API in the reviewed changes.
