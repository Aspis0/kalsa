# Dependency reconnaissance — iOS readiness

Read-only inspection of `~/Projects/kalsa-expo-bump`, current main `7ddf39ad`; node_modules present. No package or lockfile edits. `llama.rn` is intentionally out of scope.

## Expo checks

- `npx expo install --check`: flags `react-native` 0.86.2 → expected 0.86.3; `@types/jest` 30.0.0 → 29.5.14; `jest` 30.4.2 → ~29.7.0.
- `npx expo-doctor`: 18/20 checks pass. In addition to those three version mismatches, React Native Directory marks `react-native-fs` unmaintained and untested on New Architecture; metadata is missing for `kalsa-iroh`, `kalsa-lifecycle`, `kalsa-thermal`, `@fugood/react-native-audio-pcm-stream`, and `whisper.rn`.
- App config explicitly enables New Architecture (`newArchEnabled: true`). Reanimated 4 / Worklets 0.10 are compatible with that setting; Reanimated 4 requires New Architecture. [Reanimated compatibility](https://github.com/software-mansion/react-native-reanimated#compatibility)
- SDK 58 Beta was announced Sep 15, 2026; it is explicitly built for iOS 27/Xcode 27 and currently includes React Native 0.88 RC. SDK 57 stable was released Jun 30, 2026 and targets RN 0.86. SDK 58 beta is the relevant iOS 27 track; no SDK 58 stable release was listed on the Expo SDK/changelog pages at research time. [SDK 58 Beta, Sep 15](https://expo.dev/changelog/sdk-58-beta) · [SDK 57, Jun 30](https://expo.dev/changelog/sdk-57) · [Expo SDK index](https://expo.dev/sdk)

## Direct dependency updates (`npm outdated --long`)

The command reports packages with a version available outside the installed version; all other direct dependencies were not emitted. Current / wanted / latest and dependency type:

| Package | Current | Wanted | Latest | Type |
|---|---:|---:|---:|---|
| @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 | 3.1.1 | dep |
| @types/node | 24.13.3 | 24.19.1 | 26.6.4 | devDep |
| @types/react | 19.2.18 | 19.3.0 | 19.3.0 | devDep |
| expo-doctor | 1.20.1 | 1.20.4 | 1.20.4 | devDep |
| jest | 30.4.2 | 30.5.2 | 30.5.2 | devDep |
| lucide-react-native | 1.28.0 | 1.49.0 | 1.49.0 | dep |
| pdfjs-dist | 3.11.174 | 3.11.174 | 6.3.289 | devDep |
| react | 19.2.3 | 19.2.3 | 19.3.0 | dep |
| react-dom | 19.2.3 | 19.2.3 | 19.3.0 | dep |
| react-native | 0.86.2 | 0.86.2 | 0.87.1 | dep |
| react-native-gesture-handler | 2.32.0 | 2.32.0 | 3.3.0 | dep |
| react-native-keyboard-controller | 1.21.9 | 1.21.9 | 1.22.6 | dep |
| react-native-reanimated | 4.5.1 | 4.5.1 | 4.7.0 | dep |
| react-native-safe-area-context | 5.7.0 | 5.7.0 | 5.10.1 | dep |
| react-native-svg | 15.15.4 | 15.15.4 | 15.15.5 | dep |
| react-native-view-shot | 5.1.0 | 5.1.0 | 6.1.0 | dep |
| react-native-web | 0.21.2 | 0.21.3 | 0.21.3 | dep |
| react-native-webview | 13.16.1 | 13.16.1 | 14.0.1 | dep |
| react-native-worklets | 0.10.1 | 0.10.1 | 0.13.0 | dep |
| react-test-renderer | 19.2.3 | 19.2.3 | 19.3.0 | devDep |
| ts-jest | 29.4.12 | 29.4.14 | 29.4.14 | devDep |
| typescript | 6.0.3 | 6.0.3 | 7.0.2 | devDep |
| whisper.rn | 0.7.2 | 0.7.4 | 0.7.4 | dep |

Expo-pinned and other dependencies not emitted by `npm outdated`: `@expo-google-fonts/{bricolage-grotesque,fraunces,ibm-plex-mono,inter,source-serif-4}`, `@expo/vector-icons`, `@fugood/react-native-audio-pcm-stream`, `buffer`, `expo`, all installed `expo-*` modules, `fflate`, `llama.rn` (excluded), `react-native-draggable-flatlist`, `react-native-fs`, `react-native-safe-area-context` is listed above, and `react-native-svg` is listed above. No `@react-navigation/*` or `react-native-screens` dependency is installed or present in the lockfile.

## Expo SDK 57 expected native versions vs installed / registry latest

Expo's installed `node_modules/expo/bundledNativeModules.json` reports:

| Package | Installed | SDK 57 expected | Registry latest from `npm outdated` |
|---|---:|---:|---:|
| react | 19.2.3 | 19.2.3 | 19.3.0 |
| react-native | 0.86.2 | 0.86.3 | 0.87.1 |
| react-native-reanimated | 4.5.1 | 4.5.1 | 4.7.0 |
| react-native-worklets | 0.10.1 | 0.10.1 | 0.13.0 |
| react-native-gesture-handler | 2.32.0 | ~2.32.0 | 3.3.0 |
| react-native-screens | not installed | ~4.26.0 | not applicable |
| react-native-safe-area-context | 5.7.0 | ~5.7.0 | 5.10.1 |
| react-native-svg | 15.15.4 | 15.15.4 | 15.15.5 |
| @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 | 3.1.1 |

No navigation library is installed. Expo does not include React Navigation packages in `bundledNativeModules.json`; do not add them just to match a template. SDK 57 announced its animation/gesture versions as Reanimated 4.5, Worklets 0.10, Gesture Handler 2.32. [SDK 57 changelog](https://expo.dev/changelog/sdk-57)

## Tooling and Node

| Tool | Installed | Latest observed | Notes |
|---|---:|---:|---|
| TypeScript | 6.0.3 | 7.0.2 | TS 7 is a major; no SDK/iOS need. |
| Jest | 30.4.2 | 30.5.2 | Expo expects ~29.7.0; use SDK-supported 29.7.0 if correcting the doctor warning, despite Jest 30 being newer. |
| Babel core | 7.29.7 | 8.0.6 | Transitive; Babel 8 is major. |
| Metro / metro-config | 0.84.4 | 0.87.1 | Transitive and Expo/RN coupled; let the SDK choose. |
| ESLint | not installed | 10.11.0 | No project ESLint dependency/config found; no action. |

Local runtime was Node 26.3. CI uses Node 20, which reached EOL on Mar 24, 2026. SDK 58 tooling requires Node 22.13+ on Node 22, 24.3+ on Node 24, or Node 26+; Node 20 therefore blocks the SDK 58 path and is already EOL. Move CI to Node 24 LTS (or 26 if CI image support is confirmed) with the SDK upgrade. [Node EOL schedule](https://nodejs.org/en/about/eol) · [SDK 58 tool version bumps](https://expo.dev/changelog/sdk-58-beta)

## Audit findings

`npm audit --omit=dev`: 14 vulnerabilities (9 moderate, 5 high). `npm audit`: 19 (9 moderate, 9 high, 1 critical). No `npm audit fix` was run.

| Severity | Advisory / affected package | Dependency path in audit | Fix reach without major |
|---|---|---|---|
| High | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr): `image-size` parser DoS | `node_modules/image-size` (production tree) | `npm audit` says ordinary `npm audit fix`; reachable without forced major. |
| High | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): `node-forge` RSA verification | `node-forge` → `@expo/code-signing-certificates` and Expo CLI/config chain → `expo` (production tree) | Not reachable via ordinary audit fix in this lock. `--force` misleadingly proposes downgrading Expo to 44.0.6; resolve only through a compatible Expo patch/SDK dependency update or a reviewed override. |
| Moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq): `uuid` bounds check | `uuid` → `xcode` → `@expo/config-plugins` → Expo config/CLI and `expo-sharing` (production tree) | Not reachable via ordinary audit fix in this lock. `--force` proposes `expo-sharing@14.0.8`, a breaking SDK mismatch; resolve through compatible Expo chain update or reviewed override. |
| High | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p): `brace-expansion` CPU/stack DoS | `@jest/reporters`, `jest-config`, `jest-runtime`, `rimraf`, `test-exclude` nested copies (dev only) | Ordinary `npm audit fix` reports a fix; reachable without a forced major. |
| High | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh): `js-yaml` CPU DoS | `@istanbuljs/load-nyc-config/node_modules/js-yaml` (dev only) | Ordinary `npm audit fix` reports a fix; reachable without a forced major. |
| High | [GHSA-wgrm-67xf-hhpq](https://github.com/advisories/GHSA-wgrm-67xf-hhpq): PDF.js arbitrary JS execution on malicious PDF | direct devDependency `pdfjs-dist@3.11.174` | Fix requires `pdfjs-dist@6.3.289` per npm (major); assess whether dev tooling opens untrusted PDFs, then schedule explicit major migration. |
| Critical | [GHSA-34x7-hfp2-rc4v](https://github.com/advisories/GHSA-34x7-hfp2-rc4v), [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97), [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx), [GHSA-qffp-2rhf-9h96](https://github.com/advisories/GHSA-qffp-2rhf-9h96), [GHSA-9ppj-qmqm-q256](https://github.com/advisories/GHSA-9ppj-qmqm-q256), [GHSA-r6q2-hw4h-h46w](https://github.com/advisories/GHSA-r6q2-hw4h-h46w), [GHSA-vmf3-w455-68vh](https://github.com/advisories/GHSA-vmf3-w455-68vh), [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp), [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw), [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w), [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j), [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m): `tar` path traversal, overwrite, parser DoS | `tar` → `@mapbox/node-pre-gyp` (dev only) | Ordinary `npm audit fix` reports a fix; reachable without a forced major. |

Advisory IDs link to npm’s detailed affected-range/fix record; the exact dependency paths and fix proposals above are from this worktree’s audit output.

## Non-Expo native modules: maintenance, iOS 27/Xcode 27, 16 KB Android

“Not found” means a GitHub search of the package’s issues did not surface a matching report; it is not proof of compatibility. New Architecture is enabled in this app.

| Package (installed) | Native footprint / upstream state | iOS 27 / Xcode 27 report | Android 16 KB |
|---|---|---|---|
| `@fugood/react-native-audio-pcm-stream` 1.1.4 | Android + iOS sources; no GitHub releases surfaced; React Native Directory has no metadata. [Repo](https://github.com/mybigday/react-native-audio-pcm-stream) | No matching report found. | No shipped native `.so` indicated by package layout; no known page-size blocker found. |
| `@react-native-async-storage/async-storage` 2.2.0 | Android + iOS. 2.2.0 released Jun 5; actively releasing. [Releases](https://github.com/react-native-async-storage/async-storage/releases) | No matching Xcode 27 report found. | Open issue #1327 on latest 3.1.1 reports Play warning/crash risk from `libsqliteJni.so` built with old NDK; no fix listed. A major bump alone is not evidence of resolution. [Issue #1327](https://github.com/react-native-async-storage/async-storage/issues/1327) |
| `react-native-fs` 2.20.0 | Android + iOS. Expo Doctor says unmaintained and not New Architecture tested; upstream latest GitHub release is 2.20.0 (May 4; release page has no year in rendered record). [Releases](https://github.com/itinance/react-native-fs/releases) | No matching report found. | No native `.so` in package; page alignment not applicable to its Java/Obj-C sources. |
| `react-native-gesture-handler` 2.32.0 | Android + iOS native code; active. 2.33 is latest 2.x and supports RN through 0.87; 3.x is current latest major. [Releases](https://github.com/software-mansion/react-native-gesture-handler/releases) · [compatibility](https://github.com/software-mansion/react-native-gesture-handler#react-native-support) | No Xcode 27 build blocker found. | No outstanding package page-size issue found; native code is built in app. |
| `react-native-keyboard-controller` 1.21.9 | Android + iOS native code; active (1.22 releases in July 2026). [Repo/commits](https://github.com/kirillzyusko/react-native-keyboard-controller/commits) | Xcode 26.2 Swift concurrency build report against 1.20.6; maintainer replied their Xcode 26 build succeeds. No specific Xcode 27 issue found. [Issue #1302](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1302) | No prebuilt `.so`; built from Android native sources, no package-specific page-size issue found. |
| `react-native-reanimated` 4.5.1 + `react-native-worklets` 0.10.1 | Android + iOS/C++; active. Latest Reanimated 4.7 / Worklets 0.13 changes default layout animation engine and pairs with RN 0.86–0.88. [Releases](https://github.com/software-mansion/react-native-reanimated/releases) | Xcode 26.4 libc++ build issue reported for earlier Worklets 0.8.3; no matching Xcode 27 issue found. [Issue #9345](https://github.com/software-mansion/react-native-reanimated/issues/9345) | Reanimated 3.17+/4 supports 16 KB alignment; current Reanimated 4 is above that threshold. [Upstream confirmation](https://github.com/software-mansion/react-native-screens/issues/2277) |
| `react-native-safe-area-context` 5.7.0 | Android + iOS; active, latest 5.10.1 per npm. [Repo](https://github.com/AppAndFlow/react-native-safe-area-context) | No package-specific Xcode 27 report found. | No prebuilt `.so`; no package-specific page-size issue found. |
| `react-native-svg` 15.15.4 | Android + iOS; active, 15.15.5 latest on npm. [Releases](https://github.com/software-mansion/react-native-svg/releases) | **Confirmed blocker:** same 15.15.4 + Expo SDK 57 + Xcode 27 repro; resource bundle uses iOS 12.4 below Xcode 27 supported minimum. Fix PR #3022 raises podspec minimum to 15.1, but check for a released version containing it; 15.15.5 alone did not fix the issue when reported. [Issue #2992](https://github.com/software-mansion/react-native-svg/issues/2992) | Upstream release notes say 16 KB CMake support was added. [Release history](https://github.com/software-mansion/react-native-svg/releases) |
| `react-native-view-shot` 5.1.0 | Android + iOS; 5.1.1 released Jun 20, active. New Architecture supported since 4.0; tested up through RN 0.84. [Releases](https://github.com/gre/react-native-view-shot/releases) · [repo requirements](https://github.com/gre/react-native-view-shot) | No Xcode 27-specific issue found; recent iOS changes support RN 0.84. | No prebuilt `.so`; no page-size blocker found. |
| `react-native-webview` 13.16.1 | Android + iOS; active; npm latest 14.0.1 is a major. [Releases](https://github.com/react-native-webview/react-native-webview/releases) | No package-specific Xcode 27 build issue found. | No prebuilt `.so`; no package-specific page-size blocker found. |
| `whisper.rn` 0.7.2 | Android + iOS/C++; active and has bundled native artifacts; React Native Directory metadata missing. [Repo](https://github.com/mybigday/whisper.rn) | No matching Xcode 27 issue found. | Upstream states Android 15+ 16 KB support; native artifacts are downloaded from release during postinstall. [Upstream build notes](https://github.com/mybigday/whisper.rn/blob/main/AGENTS.md) |

`react-native-draggable-flatlist` has JS/TS source only in the installed package, not its own Android/iOS native implementation. `react-native-screens` is absent. Expo-owned native packages are out of this third-party list. `llama.rn` is excluded per request.

## Recommendation table

| Package | Current → target | Why | Android risk | Timing |
|---|---|---|---|---|
| Expo SDK + React Native + React | Expo 57 / React 19.2.3 / RN 0.86.2 → SDK 58 after beta validation (React/RN versions selected by Expo; beta currently React Native 0.88 RC) | iOS 27/Xcode 27 is the reason to move; SDK 58 is explicitly built for it. Do not independently bump React or RN. [SDK 58 beta](https://expo.dev/changelog/sdk-58-beta) | High: SDK/RN native toolchain and Android build behavior change together. Android ships from CI; keep the SDK 57 line as baseline and validate Android CI on the upgrade. | Batch with next SDK; evaluate SDK 58 beta now for iOS bring-up |
| `react-native-svg` | 15.15.4 → first released version containing upstream fix #3022; 15.15.5 alone is insufficient per issue report | Concrete Xcode 27 pod deployment-target build failure on the installed version. [Issue #2992](https://github.com/software-mansion/react-native-svg/issues/2992) | Low-to-medium: native Android/iOS drawing code; patch is podspec target floor, but Android build/regression still needs CI. | Do now for iOS 27 path; verify release contains fix |
| `react-native` | 0.86.2 → 0.86.3 if staying on SDK 57 | Expo doctor/install check expected patch. No standalone RN latest bump. [SDK 57 changelog](https://expo.dev/changelog/sdk-57) | Low patch risk, but native core patch still gets CI build. | Do now only if retaining SDK 57; otherwise batch with SDK 58 |
| `jest`, `@types/jest` | 30.4.2 / 30.0.0 → ~29.7.0 / 29.5.14 | Expo SDK 57 explicitly expects these; current pair works only insofar as checks run, but is outside Expo’s tested pairing. | None at runtime; dev test behavior/API changes possible. | Do now on SDK 57 line |
| CI Node | 20 → 24 LTS | Node 20 EOL Mar 24, 2026 and SDK 58 requires 22.13+, 24.3+, or 26+. [Node EOL](https://nodejs.org/en/about/eol) · [SDK 58](https://expo.dev/changelog/sdk-58-beta) | Build-tool/environment only; verify Android CI image and native toolchain under Node 24. | Do before SDK 58 |
| Audit: `brace-expansion`, `js-yaml`, `tar`, `image-size` | current vulnerable transitives → npm audit-compatible fixed transitives | High/critical advisories; ordinary `npm audit fix` reports reachable non-major fixes. | No native runtime change; affects tooling/dependency tree. | Do now in a separate dependency/security change |
| Audit: Expo `node-forge`, `uuid` chain | current → compatible Expo SDK/patch versions or narrowly reviewed override | Production audit high/moderate; `npm audit fix --force` proposes incompatible Expo 44 / `expo-sharing` 14.0.8. Do not run force. | Expo native config/build tooling change; Android build risk if overrides break Expo config plugins. | Resolve with SDK-aligned security review |
| `pdfjs-dist` (devDependency) | 3.11.174 → 6.3.289 only after migration review | High malicious-PDF JS execution advisory; fixed version is a major. Dev-only exposure; impact depends on whether tooling opens untrusted PDFs. [Advisory](https://github.com/advisories/GHSA-wgrm-67xf-hhpq) | None to shipped app; tooling/test changes possible. | Schedule explicit major, not as an incidental SDK bump |
| Async Storage | 2.2.0 → stay 2.2.0 pending resolution of 16 KB issue | SDK 57 expected 2.2.0; latest 3.1.1 has an open `libsqliteJni.so` 16 KB warning. [Issue #1327](https://github.com/react-native-async-storage/async-storage/issues/1327) | High if affected: native storage library, potential Android crash on 16 KB devices. | Skip bump; track upstream fix and validate packaged AAB |
| Reanimated / Worklets / Gesture Handler | 4.5.1 / 0.10.1 / 2.32.0 → SDK 58-selected set | Installed versions match SDK 57. Latest changes include Reanimated layout-animation default change, Worklets pairing shift, and Gesture Handler major 3; no specific iOS 27 blocker found. [Reanimated 4.7 notes](https://github.com/software-mansion/react-native-reanimated/releases) | High: native animation/gesture behavior can affect shipped Android interactions. | Batch with next SDK |
| `react-native-fs` | 2.20.0 → no target; plan replacement/maintenance decision | Expo Doctor flags unmaintained and New Architecture untested. No evidence that a blind version bump addresses that. [Expo Doctor advice](https://reactnative.directory/) | High if replacing: filesystem semantics and native storage paths. | Plan separately; do not opportunistically bump |
| Other libraries with newer npm versions (keyboard controller, safe-area, view-shot, webview, SVG minor after fix, lucide, fonts, web, TypeScript, PDF, whisper) | keep current unless SDK alignment or an app-specific bug requires a change | “Latest” alone provides no SDK/iOS 27/security justification; SDK 58 should select native-compatible versions. View-shot 5.1.1 is a small available fix candidate but no relevant blocker was found. | Native packages have behavior/build risk; JS-only packages lower risk. | Skip incidental updates; batch Expo-coupled native versions with next SDK |

## Correction (coordinator, 2026-10-02)

REFUTED: "pdfjs-dist: none to shipped app". `pdfjs-dist` is a devDependency, but its 3.11.174 build is vendored as
`assets/pdfjs/pdf.min.js.txt` + `pdf.worker.min.js.txt` and executed by `src/components/PdfToImages.tsx` in a WebView
on user-imported PDFs, with no `isEvalSupported: false` in either `getDocument` call (:698, :777). CVE-2024-4367
(GHSA-wgrm-67xf-hhpq, arbitrary JS from a malicious PDF) applies to the shipped app. Mitigation dispatched (GLM
982ca852); the pdf.js >= 4.2.67 upgrade remains the real fix.
