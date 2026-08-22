# Qualcomm Device Cloud (QDC) reconnaissance

**Scope:** public documentation and public web pages only; no sign-in, credentials, or private tenant access.

**Date checked:** 2026-08-22

## Executive result

**QDC is a viable fit for one-off and small-batch Android native-binary validation.** Its public docs explicitly describe Mobile Interactive Sessions over an SSH tunnel with real ADB (`adb shell`, `adb push`, `adb pull`, `adb logcat`). QDC also documents running a pushed, chmod'ed `lldb-server` from `/data/local/tmp`, which is strong evidence that an APK-only workflow is not required for Interactive Sessions.

The hard limits are operational rather than basic execution: the public catalog is a screenshot rather than a complete machine-readable list; it visibly includes Snapdragon 8 Elite/SM8750 and Snapdragon 8 Gen 3/SM8650-class reference designs, but does not publicly confirm an 8 Elite Gen 5/SM8850 device; QDC does not publish a root/SELinux guarantee for arbitrary unsigned ELF files; and public pricing/paid-tier details are absent. Use a smoke session before committing a broad matrix.

## Use-case fit (provisional)

| Intended use | Status | Concrete blocker / evidence |
|---|---|---|
| (a) 8xx correctness validation: `test-backend-ops` `MUL_MAT_ID` sweep | **GO for 8 Elite/SM8750; conditional for 8 Elite Gen 5** | ADB/native execution is documented and the public catalog shows Snapdragon 8 Elite (ORD8750, early access). SM8850/Adreno 840 is present in public llama.cpp CI/docs but not confirmed in the public QDC catalog snapshot. |
| (b) Hexagon v75+ NPU gates | **GO for v75/v79; conditional for v81** | Publicly visible QDC targets map to 8 Gen 3/v75 and 8 Elite/v79. v81 requires an SM8850 target that QDC's public catalog does not confirm. Root/HTP-driver/SELinux behavior is not promised publicly. |
| (c) E031 compiler-matrix sweep for the dossier | **NO-GO as an unattended Android sweep; GO for bounded interactive runs** | Mobile automated jobs document APK/Appium/Monkey-style packages, not arbitrary shell scripts. Interactive sessions can run the binaries, but each target needs a session and the public docs give no queue SLA, paid price, or complete target inventory. |

## 1. Session types and execution model

QDC exposes both **Automated Testing** and **Interactive Sessions**. The public guide describes Interactive Sessions as live access to an application/device, separate from automated jobs: [QDC overview](https://qdc.qualcomm.com/support/user-guide/overview) (accessed 2026-08-22).

For Android Mobile devices, the documented connection is:

1. Create an Interactive Session with SSH enabled and an imported/generated public key.
2. Run the QDC-provided SSH tunnel to the bastion, forwarding the device's ADB server.
3. Use the local ADB client against the remote device.

The [Mobile Session guide](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/interact-with-devices/mobile-session) (current QDC page, accessed 2026-08-22) explicitly lists `adb shell`, `adb push`/`adb pull`, `adb install`, and `adb logcat`. The [ADB Commands reference](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/interact-with-devices/adb-commands) also documents `adb shell`, file push/pull, and says the commands apply to Mobile, Automotive, and IoT sessions.

This is not a browser-only web-ADB bridge. The browser has an embedded ADB console and a Connect dialog, but the supported remote workflow is a local `adb` client over the QDC SSH tunnel. QDC's [FAQ](https://qdc.qualcomm.com/support/faq) says Mobile/IoT users can run ADB commands or other scripts/applications that use ADB (accessed 2026-08-22).

### Fit for custom native binaries

The workflow is compatible with `adb push <payload> /data/local/tmp`, `chmod`, `sha256sum`, execution, and `adb pull` in an Interactive Session. QDC's own [LLDB Setup Guide](https://qdc.qualcomm.com/support/user-guide/lldb-setup-guide) demonstrates exactly this pattern: push `lldb-server` to `/data/local/tmp`, `chmod 744`, and execute it (current page, accessed 2026-08-22). Its [interactive AI-model guide](https://qdc.qualcomm.com/support/user-guide/ai-models/ai-interactive-sessions) likewise runs an Android native `snpe-net-run` binary from `/data/local/tmp` with a custom `LD_LIBRARY_PATH`.

**Unsigned binaries:** no public QDC page found in this recon states that arbitrary unsigned ELF files are blocked or allowed as a policy. The examples show pushed native executables, but they are Qualcomm/NDK tools, not an arbitrary user binary. The practical constraint is therefore Android device state (ABI, dynamic linker dependencies, SELinux/domain policy, and any vendor restrictions), not an APK-signing requirement documented by QDC. Treat this as high-confidence but smoke-test-required.

Interactive Mobile sessions accept an optional APK test package; the [Mobile Session API sample](https://qdc.qualcomm.com/support/api/using-qualcomm-device-cloud-sdk/interactive-sessions-api-guide/sample-mobile-session) says the test package is optional and uses `.apk` only if supplied. That package constraint does not remove the separate ADB path.

## 2. Public device catalog

The public [Devices page](https://qdc.qualcomm.com/support/user-guide/getting-started/devices) says it includes early-access devices, but renders the catalog as an image rather than a text/API table. The catalog image visible on 2026-08-22 showed these exact cards (availability/minute counts are volatile and are not treated as a guarantee):

| Public card name | Type / identifier shown | Relevance |
|---|---|---|
| Snapdragon 8 Elite | Mobile Reference Design; `ORD8750`; Android U; Early Access | Adreno 830 class; Hexagon v79 / SM8750 mapping. Best current QDC fit for 8xx and v79 probes. |
| Snapdragon 8 Gen 3 | Mobile Reference Design; `ORD8650`; Android U | Adreno 750; Hexagon v75 mapping. Best v75 cross-check. |
| Qualcomm RB3 Gen 2 | Development Kit; `QCS6490`; Linux | Adreno 643; older Hexagon platform, not a v75+ Android-phone target. |
| Qualcomm QCS8550 | IoT/device target | Qualcomm's public QCS8550 brief lists Adreno 740 and Hexagon V73M; useful as an Adreno 740-class IoT cross-check, but not a v75+ target. |
| Qualcomm RB3 Gen 2 Lite (Core Kit) | IoT/device target | Not a phone; not a requested Adreno 7xx/8xx cross-check. |
| Snapdragon X Elite | Compute Reference Design; `CRD8380X1`; Multiple | Windows/compute, not Android Mobile. |
| Snapdragon X Plus 8-core | Compute reference card | Windows/compute, not Android Mobile. |
| IQ-9100 Beta | Compute/device card | Public card name only; not enough detail for the Android target use case. |

The QDC Python sample separately uses `SM8750` as a valid Mobile target name and says Mobile sessions have no chipset restrictions in the API schema; see [Sample - Mobile Session](https://qdc.qualcomm.com/support/api/using-qualcomm-device-cloud-sdk/interactive-sessions-api-guide/sample-mobile-session) (accessed 2026-08-22). The target list itself is obtained through an authenticated `GET /targets`/SDK call, so this recon did not query it.

### Requested accelerator cross-checks

* **Adreno 8xx:** QDC's public catalog visibly lists Snapdragon 8 Elite (`ORD8750`/SM8750), which is the Adreno 830 target. No 8 Elite Gen 5 card was visible in the public catalog image. Upstream llama.cpp's [OpenCL backend documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md) lists Adreno 830 for 8 Elite and Adreno 840 for 8 Elite Gen 5 (accessed 2026-08-22), but that is a software support list, not proof of QDC inventory.
* **Adreno 750/740-class:** QDC visibly lists Snapdragon 8 Gen 3 (`ORD8650`), corresponding to Adreno 750. The same public catalog image lists QCS8550; Qualcomm's [QCS8550 product brief](https://docs.qualcomm.com/bundle/publicresource/87-61717-1_REV_B_Qualcomm_QCS8550_QCM8550_Processors_Product_Brief.pdf) (2025 revision, accessed 2026-08-22) identifies its GPU as Adreno 740 and its compute DSP as V73, so QCS8550 is the available Adreno 740-class cross-check, albeit an IoT target rather than an Android phone.
* **Hexagon v75/v79/v81:** the practical mapping used by current Qualcomm/llama.cpp ecosystem docs is 8 Gen 3 → v75, 8 Elite/SM8750 → v79, and 8 Elite Gen 5/SM8850 → v81. Upstream llama.cpp documents building `libggml-htp-v75.so`, `v79.so`, and `v81.so`; its QDC CI matrix includes `SM8750`, `SM8650`, and `SM8850`, but the workflow is conditional on a private `QDC_API_KEY` and therefore proves integration intent rather than public inventory. See [llama.cpp Snapdragon backend](https://android.googlesource.com/platform/external/ggml-org/llama.cpp/+/refs/tags/studio-2026.1.1/docs/backend/snapdragon/README.md) and [QDC CI workflow](https://github.com/ggml-org/llama.cpp/actions/runs/24845777515/workflow?pr=21051) (accessed 2026-08-22).

## 3. Free tier and paid access

Public QDC FAQ facts:

* QDC says it is free to use, but new-user free minutes are provisioned by user/organization and are subject to device-specific allocation.
* The current FAQ says new users are being promoted with pre-provisioned minutes on **Snapdragon X Elite** for a limited time; it does not state a universal number.
* Qualcomm's official developer project [Ollama with Windows on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos), dated **2025-05-14**, says the X Elite flow unlocks **1,000 free minutes** and that users can request additional free minutes afterward. That is the clearest public numeric offer found, but it is specifically an X Elite promotion and should not be generalized to Mobile 8 Elite/8 Gen 3.
* Minutes start when execution begins; setup and waiting for an available device are not counted.
* Interactive sessions cannot be created when the selected device is busy/unavailable. Automated jobs can queue. QDC says a normally available job should start in “a couple of minutes,” but it publishes no numeric queue SLA.
* The user supplies a maximum minutes-per-device value; the session times out at that limit and can be extended. Public SDK samples use 600 minutes and show a two-hour extension, but those are examples, not a universal cap.
* Two Qualcomm developer walkthroughs expose different UI examples: the 2025 [Ollama/QDC walkthrough](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) shows a 420-minute (7-hour) maximum, while the 2025 [NPU-chatbot walkthrough](https://www.qualcomm.com/developer/project/build-a-simple-npu-chatbot) shows 720 minutes (12 hours). Because these are different project pages and conflict, treat them as account/device/session-policy examples, not a reliable Mobile cap.
* No public QDC price sheet, paid per-minute rate, subscription tier, or Mobile-specific free-minute quota was found. Additional minutes are requested through the Devices page/support review, not self-service documented payment.

Sources: [QDC FAQ](https://qdc.qualcomm.com/support/faq), [Create Session](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/create-session), [View Session](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/view-session), and the dated Qualcomm project above (all accessed 2026-08-22).

## 4. Tooling, thermal/battery access, and privilege model

**Qualcomm Profiler:** QDC publishes a Mobile/Android profiling procedure. It requires an Interactive Session, an SSH tunnel with port 8900, installing the Qualcomm Profiler agent via `InstallerLA.exe -d <device>`, and starting `qprof` on the device. See [Profiling Devices](https://qdc.qualcomm.com/support/user-guide/profiling-devices) (accessed 2026-08-22). Automated jobs also have a “Profiling Enabled” toggle, and profiling output is returned under `TestLogs -> ProfilingMetrics` in the session/job report.

**Raw probes:** QDC documents a general ADB shell and says users can run other scripts/applications through ADB. That supports attempting:

```text
adb shell dumpsys battery
adb shell cat /sys/class/thermal/thermal_zone*/temp
adb shell sha256sum /data/local/tmp/<file>
```

However, QDC does not promise these exact paths, sensor names, or permissions. Public profiling docs contain no `thermal`, `battery`, or root guarantee. `dumpsys battery` and readable thermal sysfs nodes are reasonable unprivileged probes; writes, `adb root`, `adb remount`, changing governors, or reading vendor-restricted nodes should be considered unsupported until a smoke session proves otherwise.

**Root/unrooted:** the public QDC Mobile instructions never require `adb root`, `adb remount`, or SELinux permissive mode. They demonstrate normal ADB shell usage and running tools from `/data/local/tmp`. Therefore plan for an unrooted shell and do not make root-dependent gates a QDC prerequisite. QDC cleans devices after each job/session; dedicated devices are the exception and require a support request.

## 5. Launch, file transfer, outputs, and artifacts

**Launch paths:**

* Web UI: `+ New Session` → Mobile → device → maximum minutes → SSH-enabled mode → optional APK → submit.
* Python SDK: QDC documents `submit_session`, status polling, extension, and `complete_session`; the sample target is `SM8750`, with `timeout=600`.
* REST API: public docs expose session/job/artifact/target endpoints. Authentication uses a QDC API key from User Settings; SSH access uses an SSH public key. No credential was used in this recon.

**Recommended native workflow:** start the session, establish the tunnel, `adb devices`, `adb push` the `test-backend-ops`, `llama-bench`, `.so` files and model/input files to `/data/local/tmp`, run `sha256sum` and the probes, execute tests, copy results to `/qdc/logs/`, optionally `adb pull` results during the live session, then complete the session.

**Results/artifacts:** QDC's [FAQ](https://qdc.qualcomm.com/support/faq) says Mobile logs include Android/kernel/logcat logs, screen recording, profiling output when enabled, and **all files under `/qdc/logs/`**. The [interactive AI guide](https://qdc.qualcomm.com/support/user-guide/ai-models/ai-interactive-sessions) uses `cp -r output /data/local/tmp/QDC_logs/` for returned job output, while the FAQ's current canonical Mobile location is `/qdc/logs/`; use `/qdc/logs/` for custom JSONL/log artifacts. The session-results UI exposes screen recording and logs, including a downloadable Whole Host Log. Direct `adb pull` is also documented.

QDC resets ordinary devices at session end, so do not depend on `/data/local/tmp` persistence. Dedicated devices preserve data across sessions but are support-managed and erased when released.

## 6. Published llama.cpp / AI-benchmarking usage

The most directly reusable public pattern is upstream llama.cpp's QDC CI workflow:

* Build an Android arm64 Snapdragon package containing `llama-bench`, `llama-cli`, `libggml-opencl.so`, `libggml-htp-v75.so`, `libggml-htp-v79.so`, and `libggml-htp-v81.so`.
* Install the Qualcomm Device Cloud SDK wheel.
* Run `scripts/snapdragon/qdc/run_qdc_jobs.py --test all --pkg-dir ... --model-url ... --device SM8750|SM8650|SM8850`.
* Gate the workflow on `QDC_API_KEY` and collect results in CI.

See the public [llama.cpp QDC workflow](https://github.com/ggml-org/llama.cpp/actions/runs/24845777515/workflow?pr=21051) (accessed 2026-08-22). It is close to the requested packaging model, although it uses automated QDC jobs and therefore depends on QDC's job wrapper rather than a documented arbitrary mobile shell-script job.

Also useful:

* [llama.cpp Snapdragon backend documentation](https://android.googlesource.com/platform/external/ggml-org/llama.cpp/+/refs/tags/studio-2026.1.1/docs/backend/snapdragon/README.md) shows the exact `adb push ... /data/local/tmp/` deployment pattern, HTP v79/v81 runs, and `run-bench.sh` examples (accessed 2026-08-22).
* Qualcomm's official **2026-04** [Qualcomm Matrix Extension / Llama benchmarking post](https://www.qualcomm.com/developer/blog/2026/04/llama-models-acceleration-on-cpu-qmx) benchmarks quantized Llama/Gemma models on Snapdragon 8 Elite Gen 5, with 128-token prefill/decode and fixed thread counts. It is CPU/QMX-focused, not QDC/ADB-focused, but useful for benchmark methodology.
* Qualcomm's official **2025-05-14** [Ollama with Windows on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) demonstrates QDC-based remote Snapdragon testing and reports the X Elite free-minute onboarding flow.
* QDC's own [AI Models in Interactive Sessions](https://qdc.qualcomm.com/support/user-guide/ai-models/ai-interactive-sessions) documents command-line native inference, custom `LD_LIBRARY_PATH`, and copying output/logs back to the QDC report.

## Evidence log

| Date | Source | Finding |
|---|---|---|
| 2026-08-22 | [QDC Mobile Session](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/interact-with-devices/mobile-session) / [ADB Commands](https://qdc.qualcomm.com/support/user-guide/interactive-sessions/interact-with-devices/adb-commands) | Interactive Mobile sessions use ADB over an SSH tunnel; shell, push/pull, install, and logcat are documented. |
| 2026-08-22 | [QDC LLDB Setup](https://qdc.qualcomm.com/support/user-guide/lldb-setup-guide) | QDC documents pushing, chmod'ing, and executing `lldb-server` from `/data/local/tmp`. |
| 2026-08-22 | [QDC FAQ](https://qdc.qualcomm.com/support/faq) | Free-minute allocation is user/org based; X Elite promotion; no queue for interactive when busy; typical available start is a couple minutes; logs under `/qdc/logs/`; devices reset after use. |
| 2026-08-22 | [QDC Devices](https://qdc.qualcomm.com/support/user-guide/getting-started/devices) + [QCS8550 product brief](https://docs.qualcomm.com/bundle/publicresource/87-61717-1_REV_B_Qualcomm_QCS8550_QCM8550_Processors_Product_Brief.pdf) | Public catalog is an image; visible cards include Snapdragon 8 Elite/ORD8750, Snapdragon 8 Gen 3/ORD8650, RB3 Gen 2/QCS6490, QCS8550, and other compute/IoT cards. Qualcomm's 2025 QCS8550 brief maps QCS8550 to Adreno 740 / Hexagon V73M. |
| 2026-08-22 | [Qualcomm Ollama project](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos), 2025-05-14 | Public numeric offer found: 1,000 free X Elite minutes; additional free minutes can be requested. |
| 2026-08-22 | [llama.cpp QDC workflow](https://github.com/ggml-org/llama.cpp/actions/runs/24845777515/workflow?pr=21051) | Public CI integration targets SM8750, SM8650, and SM8850, conditional on a private QDC API key. |

## Bottom line

Proceed with a **bounded QDC smoke session** on the visible Snapdragon 8 Elite target: verify `adb shell`, push/execute a tiny unsigned ELF and the actual `test-backend-ops`/`llama-bench` bundle, run on-device SHA-256, read `dumpsys battery` and thermal nodes, and pull a JSONL result through `/qdc/logs/`. If that passes, QDC is suitable for 8 Elite correctness and v75/v79 gates. Do not claim v81/SM8850 coverage or an unattended multi-compiler Android matrix until QDC support confirms that target in the authenticated catalog and the smoke test confirms the required runtime/permissions.
