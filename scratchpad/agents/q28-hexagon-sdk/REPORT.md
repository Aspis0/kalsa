# q28 — Qualcomm Hexagon SDK + llama.cpp ggml-hexagon (Android)

Status: BLOCKED on Qualcomm account for Hexagon SDK 6.6.0.0. Clone+script ready. No device deploy. No accounts created.
Started: 2026-08-22
Owner constraint: official Qualcomm only; STOP at first login/account wall; no accounts, no bypass, no unofficial mirrors.
Device: NONE this task (PC-side toolchain only).
Do-not-touch: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge` and its `third_party/llama.cpp`.

## Summary (update every step)

- Step 1 Hexagon SDK: STOPPED — QSC/QIK **manager** installed without login; **Hexagon SDK 6.6.0.0 package requires Qualcomm account**. No SDK on disk. No accounts created.
- Step 2 upstream clone + build: PARTIAL — clone pinned, push disabled, recon done, ready-to-run script written. **Build not executed** (no HEXAGON_SDK_ROOT). Dry-run exits 1 with the owner-unblock text.
- Step 3 model prep: INVENTORY ONLY (no downloads). No Qwen3.5-2B Q4_0 / IQ4 on disk. Closest: `models\draft\Qwen3.5-2B-Q4_K_M.gguf` and `models\draft\Qwen3.5-4B-Q4_0.gguf`.

Local env:
- `C:\Qualcomm`: still ABSENT (no Hexagon_SDK tree)
- NDK: `27.1.12297006` at `C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006`
- CMake: `3.22.1` at `C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1`

## Environment (as given)

- NDK: `C:\Users\gualt\AppData\Local\Android\Sdk\ndk\` (newest installed: 27.1.12297006)
- CMake: `C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin`
- Hexagon install target: `C:\Qualcomm\Hexagon_SDK\<ver>` (or QPM default)
- Upstream clone: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\upstream-hexagon\llama.cpp`
- Build dir: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-hexagon`

## Step 1 — Hexagon SDK Community Edition >= 6.6

### What worked without login

Owner URL is official and reachable. The **Qualcomm Software Center (QSC) installer** is a public blob:

| Item | Value |
|---|---|
| URL | `https://softwarecenter.qualcomm.com/api/download/software/qsc/windows/latest.exe` |
| Redirect | `https://apigwx-aws.qualcomm.com/qsc/public/v1/api/download/software/qsc/windows/latest.exe` |
| Size | 256917080 bytes |
| Magic | MZ / `application/x-msdownload` |
| Last-Modified | 2025-02-05 |
| FileVersion | QIK 1.0.161.0 (`QIKTool.exe`) |
| Saved copy | `scratchpad/agents/q28-hexagon-sdk/downloads/qsc-windows-latest.exe` |

Linux twin also public: `.../qsc/linux/latest.deb` (205704744 bytes, `!<arch>` debian). Not installed (this host is Windows).

Launching that exe (self-extractable QIK v2) **silently installed** the manager stack without credentials (log: `No credentials found, user must login` then it still installed the **manager**, not Hexagon SDK):

| Component | Path | Version |
|---|---|---|
| QIK | `C:\Program Files (x86)\Qualcomm\QIKTool\1.0.162.1\QIK.exe` | 1.0.162.1 |
| QIK v3 | `C:\Program Files (x86)\Qualcomm\QIKToolV3\3.0.38.1\qikv3.exe` | 3.0.38.1 |
| QPM-CLI | `C:\Program Files (x86)\Qualcomm\QPM-CLI\1.0.118.3\qpm-cli.exe` | 1.0.118.3 (broken: "QPM3 was not installed properly") |
| QSC GUI | `C:\Program Files (x86)\Qualcomm\Qualcomm_Software_Center\softwarecenter.exe` | 32.2.8 |
| qsc-cli | `C:\Program Files (x86)\Qualcomm\Qualcomm_Software_Center\qsc-cli.exe` | 1.11.0 |

Installer is CLI (`QIK COMMAND ...`), not GUI-only. Silent flag exists: `-Silent`.

### The login wall (Hexagon SDK package)

llama.cpp `docs/backend/snapdragon/windows.md` names the official package as:

- URL: `https://softwarecenter.qualcomm.com/catalog/item/Hexagon_SDK?version=6.6.0.0`
- Unpack target: `C:\Qualcomm\Hexagon_SDK\6.6.0.0`
- Tools: `C:\Qualcomm\Hexagon_SDK\6.6.0.0\tools\HEXAGON_Tools\19.0.07`

That catalog item is an **Electron SPA shell** (HTTP 200 HTML, no binary). Guessed public download keys all return S3 `NoSuchKey` (404), unlike the QSC installer which is in the public bucket.

Actual fetch goes through QIK catalog, which **requires a Qualcomm token**:

```
QIK INFO Hexagon_SDK
→ stdout: Error Reading Product Catalog.
→ exit 204 (CatalogReadError)
→ log: Cannot read token file C:\ProgramData\Qualcomm\Token\StardustApigeeToken.txt
→ log: "Are you logged in ?"
```

```
qsc-cli info product
→ "This operation requires users to be logged in. Please try login using the below command and try again.
    qsc-cli login -u <username>"
```

**STOPPED HERE.** Did not run `LOGIN` with real credentials. Did not create an account. Did not use unofficial mirrors.

Observed (NOT issued by this agent): `qik.exe login foo` at 16:36:31 in `QIKTool_20260822_163631.log` → 401 Invalid Credentials. Unknown origin (possibly another process during QSC bootstrap). Failed. Not retried.

### URLs tried (every official channel)

| URL | Result |
|---|---|
| `https://softwarecenter.qualcomm.com/catalog/item/Hexagon_SDK` | 200 SPA HTML (skeleton catalog; Okta login chrome in JS) |
| `https://softwarecenter.qualcomm.com/catalog/item/Hexagon_SDK?version=6.6.0.0` | 200 same SPA HTML |
| `https://softwarecenter.qualcomm.com/catalog/catalog-suite/Qualcomm%20Hexagon%20SDK` | 200 SPA HTML + "Installation Configuration" dialog chrome |
| `https://softwarecenter.qualcomm.com/api/download/software/qsc/windows/latest.exe` | **PUBLIC** 206/200 PE 245 MiB (QSC/QIK manager) |
| `https://softwarecenter.qualcomm.com/api/download/software/qsc/linux/latest.deb` | **PUBLIC** 206/200 deb 196 MiB |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/windows/6.6` | 404 NoSuchKey |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/windows/6.6.0.0` | 404 NoSuchKey |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/windows/6.6.0.0.zip` | 404 NoSuchKey |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/windows/6.6.0.0.exe` | 404 NoSuchKey |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/windows/latest` | 404 NoSuchKey |
| `https://softwarecenter.qualcomm.com/api/download/software/Hexagon_SDK/6.6.0.0/windows` | 404 NoSuchKey |
| `https://apigwx-aws.qualcomm.com/qsc/public/v1/api/catalog/item/Hexagon_SDK` | 404 empty |
| `https://apigwx-aws.qualcomm.com/qsc/public/v1/api/catalog` | 404 empty |
| `https://qpm.qualcomm.com/` | 200 QPM SPA HTML |
| `https://qpm.qualcomm.com/qpm/qpm-win64.exe` | 404 |
| `https://developer.qualcomm.com/software/hexagon-dsp-sdk` | 301 → `https://www.qualcomm.com/developer/software/hexagon-npu-sdk?redirect=qdn` (marketing page) |
| `https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v6.6.0.0/hexagon-sdk-v6.6.0.0-arm64-wos.tar.xz` | EXISTS (xz, llama.cpp CI trimmed, **arm64-wos host**). **NOT downloaded** (not Qualcomm Software Center; wrong host arch for this x64 PC Android cross-build). |

HEAD on the public download API returns CloudFront 403; GET/Range GET succeeds. Irrelevant to the Hexagon wall.

### Installed (if any)

- SDK version: **NOT INSTALLED**
- Install path: n/a (expected `C:\Qualcomm\Hexagon_SDK\6.6.0.0`)
- HEXAGON_SDK_ROOT: **UNSET / missing**
- HEXAGON_TOOLS_ROOT: **UNSET / missing** (llama.cpp docs: `...\6.6.0.0\tools\HEXAGON_Tools\19.0.07`)

### Owner unblock (login wall)

Hexagon SDK 6.x Community Edition is **not** a public blob. The manager is. Owner must:

1. Create/use a Qualcomm Developer account (Okta). Signup is the Qualcomm identity used by Software Center / QSC. CLI will prompt:
   - `qsc-cli login -u <username>`
   - or `QIK.exe LOGIN <username> <password>`
   - or GUI: `C:\Program Files (x86)\Qualcomm\Qualcomm_Software_Center\softwarecenter.exe`
2. After login, install **package name `Hexagon_SDK` version `6.6.0.0`** (llama.cpp name: "Hexagon SDK 6.x Community Edition"):
   ```
   QIK.exe INSTALL Hexagon_SDK -version 6.6.0.0 -Silent
   ```
   Catalog page: https://softwarecenter.qualcomm.com/catalog/item/Hexagon_SDK?version=6.6.0.0
3. Confirm tree:
   - `HEXAGON_SDK_ROOT=C:\Qualcomm\Hexagon_SDK\6.6.0.0`
   - `HEXAGON_TOOLS_ROOT=C:\Qualcomm\Hexagon_SDK\6.6.0.0\tools\HEXAGON_Tools\19.0.07`
   - Hexagon Tools must be inside the SDK (hexagon-clang, etc.). If Tools are a separate QIK package, install that too.
4. Re-run the Android build script produced in Step 2.

Optional (not used, documented only): llama.cpp's recommended Android path is Docker `ghcr.io/snapdragon-toolchain/arm64-android:v0.7` which already contains Hexagon SDK at `/opt/hexagon/6.6.0.0`. That avoids the Qualcomm login on this PC but is a different channel than Software Center.

## Step 2 — upstream clone + Android hexagon build

### Clone (read-only)

| Field | Value |
|---|---|
| Path | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\upstream-hexagon\llama.cpp` |
| Origin | `https://github.com/ggml-org/llama.cpp.git` (master) |
| SHA | `3f545beccee69d9975f466ec7e45fd9aacd8ba90` |
| Date | 2026-08-22 14:42:20 -0500 |
| Subject | `vulkan : added the PAD_REFLECT_1D operation (#26586)` |
| `remote.origin.pushurl` | `DISABLED` (set immediately after clone) |

BigMoeOnEdge remotes unchanged (`origin` → `Aspis0/kalsa-forkbigmoeonedge.git` fetch+push). No remotes added there. No push attempted anywhere.

### Docs recon (in the clone)

- `docs/backend/snapdragon/README.md` — Android recipe is **Docker** `ghcr.io/snapdragon-toolchain/arm64-android:v0.7` with `HEXAGON_SDK_ROOT=/opt/hexagon/6.6.0.0`, NDK r28b inside the image. Native Windows recipe is WoS (arm64 host), not this x64 PC.
- `docs/backend/snapdragon/windows.md` — official SDK: catalog item `Hexagon_SDK?version=6.6.0.0` → `C:\Qualcomm\Hexagon_SDK\6.6.0.0`, tools `...\HEXAGON_Tools\19.0.07`.
- `docs/backend/snapdragon/developer.md` — runtime needs `libggml-hexagon.so` + versioned `libggml-htp-vNN.so` (v73/v75/v79/v81).
- `docs/backend/snapdragon/CMakeUserPresets.json` — schema **version 5**. Android SDK cmake is **3.22.1** (presets v5 needs cmake ≥ 3.24). **Cannot use `--preset`**. Equivalent `-D` flags are in the build script.
- `ggml/src/ggml-hexagon/CMakeLists.txt` — `FATAL_ERROR` if `HEXAGON_SDK_ROOT` is not a directory; tools can be inferred from `hexagon_sdk.json`. Builds **htp-v73, v75, v79, v81** via ExternalProject + Hexagon clang (`toolv19_${V}`).

### Toolchain on this PC

| Tool | Path / version | Verdict |
|---|---|---|
| CMake | `...\Android\Sdk\cmake\3.22.1\bin\cmake.exe` **3.22.1-g37088a8-dirty** | OK for llama.cpp `cmake_minimum_required(3.14...3.28)`. Too old for preset schema v5. |
| Ninja | same dir, **1.10.2** | OK (same as `build-android-opencl-s3oracle`) |
| NDK | `...\ndk\27.1.12297006` | Only NDK installed. Docker recipe uses **r28b**. Script uses 27.1. |
| Hexagon SDK | missing | blocks configure |

### Ready-to-run script

`C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q28-hexagon-sdk\build-android-hexagon.ps1`

- Source: the upstream clone above (never BigMoeOnEdge).
- Build dir: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-hexagon`
- Generator: Ninja + Android NDK toolchain, `ANDROID_ABI=arm64-v8a`, `ANDROID_PLATFORM=android-31`, `GGML_HEXAGON=ON`, OpenCL OFF unless `OPENCL_SDK_ROOT` is set.
- Targets: `llama-bench`, `test-backend-ops`, `llama-cli`, `ggml-hexagon` (pulls `libggml-hexagon` + HTP skels v73/v75/v79/v81).
- On success: `certutil` SHA256 of artifacts → `build-android-hexagon\MANIFEST.txt`. No adb/device.

Dry-run (SDK absent), exit 1:

```
ERROR: HEXAGON_SDK_ROOT not found: C:\Qualcomm\Hexagon_SDK\6.6.0.0
```

Placeholder: `build-android-hexagon\STATUS.txt`.

## Step 3 — model prep

No downloads. Inventory of `*.gguf` under `moe-experiments\models`, `models_staging`, and `~\.cache\huggingface`:

| Needed for hexagon smoke | Status |
|---|---|
| Qwen3.5-2B **Q4_0** | **MISSING** |
| any **IQ4** / IQ4_NL 2B-class | **MISSING** (zero `*iq4*` gguf) |
| Llama-3.2-1B-Instruct-Q4_0 (llama.cpp README example) | **MISSING** |

Closest existing:

| File | Size | Note |
|---|---|---|
| `models\draft\Qwen3.5-2B-Q4_K_M.gguf` | 1221.5 MiB | 2B-class but **Q4_K_M**, not Q4_0 / IQ4_NL |
| `models\draft\Qwen3.5-4B-Q4_0.gguf` | 2463.6 MiB | **Q4_0** but 4B, not 2B |
| `models\draft\Qwen3.5-4B-Q4_K_M.gguf` | 2614.0 MiB | 4B Q4_K_M |

Other ggufs on disk are 8B–35B KEXP / Q4_K_M / Q2_K — too big / wrong quant for the requested 2B Q4_0 smoke.

## Walls / mismatches / owner actions

1. **HARD WALL — Qualcomm account required to fetch Hexagon SDK 6.6.0.0.** QSC/QIK manager is public; the SDK catalog is not. Owner action:
   ```
   & 'C:\Program Files (x86)\Qualcomm\Qualcomm_Software_Center\qsc-cli.exe' login -u <username>
   & 'C:\Program Files (x86)\Qualcomm\QIKTool\1.0.162.1\QIK.exe' INSTALL Hexagon_SDK -version 6.6.0.0 -Silent
   ```
   Then confirm `C:\Qualcomm\Hexagon_SDK\6.6.0.0` and `...\tools\HEXAGON_Tools\19.0.07`, then re-run `build-android-hexagon.ps1`.
2. QPM3 CLI reports "QPM3 was not installed properly" — ignore; Hexagon 6.x is QSC/QIK.
3. NDK **r27.1** vs Docker **r28b**. CMake **3.22.1** vs preset schema v5 (need ≥ 3.24 for `--preset`). Script already avoids `--preset`.
4. Do not use GitHub `snapdragon-toolchain/hexagon-sdk` arm64-wos tarball on this x64 host.
5. Smoke GGUF: no Q4_0/IQ4 2B on disk. After SDK+build, either quantize `Qwen3.5-2B` to Q4_0 or accept `Qwen3.5-2B-Q4_K_M` / `Qwen3.5-4B-Q4_0` as a weaker stand-in. Do not download until owner says so.

## Changelog

- 2026-08-22: skeleton created
- 2026-08-22: env probe — no Qualcomm SDK, NDK 27.1, cmake 3.22.1
- 2026-08-22: QSC Windows installer downloaded (public, no login) and self-installed QIK/QSC/qsc-cli
- 2026-08-22: STOP — `QIK INFO Hexagon_SDK` CatalogReadError 204; `qsc-cli info product` requires login
- 2026-08-22: cloned ggml-org/llama.cpp @ 3f545bec, pushurl DISABLED
- 2026-08-22: wrote `build-android-hexagon.ps1`; dry-run fail-fast on missing SDK
- 2026-08-22: model inventory — no 2B Q4_0 / IQ4
