# kalsa-iroh (Expo module)

The Android platform bridge for the iroh road: the uniffi face of
`native/kalsa-iroh-mobile` behind an Expo local module. One bridge object
holds the node identity; JS gets numbered tunnels whose byte moves are
base64 at this seam. Every native call blocks on a plain pool thread
bounded by per-call deadlines — never the JS thread.

## Layout

- `android/.../KalsaIrohModule.kt` — the Expo module: `startBridge()`
  (argless — the key path is resolved natively from `context.filesDir`),
  `nodeId()`, `openTunnel(nodeHex, lane)`, `write(id, base64, timeoutMs)`,
  `read(id, max, timeoutMs)` (base64, empty = EOF), `shutdown(id)`.
  Blocking calls run on a bounded fixed pool (8 plain threads).
- `android/.../uniffi/kalsa_iroh_mobile/` — the generated uniffi Kotlin
  bindings, vendored: they change only when the crate's uniffi API changes,
  and vendoring keeps the Gradle build hermetic (no Rust toolchain needed
  to compile Kotlin). Regenerate with the commands in
  `native/kalsa-iroh-mobile/README.md` and copy the file here.
- `android/src/main/jniLibs/arm64-v8a/` — `libkalsa_iroh_mobile.so`,
  built by the APK workflow (never committed; gitignored in place).
- `src/index.ts` — the typed JS API.

## The .so

Built on CI (`apk.yml`) for every ABI in the build's `inputs.abi`
(unsupported ABIs fail the job with a message): rustup + cargo-ndk, NDK
`27.1.12297006` (the RN gradle catalog's pin), `cargo ndk -t <abi> build
--release` with the crate's `.cargo/config.toml` supplying the 16 KB
page-size flags (max and common). Each built `.so` is verified —
`llvm-readelf -lW`: every LOAD segment `Align 0x4000`, else the job
fails — then copied into the module's jniLibs.

## Key path

The node identity lives at `<Context.filesDir>/iroh-node.key`, resolved
by the Kotlin module — a filesystem path is what the crate wants, and
resolving it natively means no `file://` URI is ever parsed in JS.

## JNA

The uniffi Kotlin runtime speaks JNA; the AAR variant is the Android
build. **5.16.0** is the first release with the Android 16 KB page-size
fix (JNA CHANGES.md, issue #1618; a follow-up, #1647, landed in 5.17.0).

Not wired into pairing or chat yet: `src/remote/irohHttp.ts` is the
transport that will ride these tunnels.
