# kalsa-iroh (Expo module)

The Android platform bridge for the iroh road: the uniffi face of
`native/kalsa-iroh-mobile` behind an Expo local module. One bridge object
holds the node identity; JS gets numbered tunnels whose byte moves are
base64 at this seam. Every native call blocks on a plain pool thread
bounded by per-call deadlines — never the JS thread.

## Layout

- `android/.../KalsaIrohModule.kt` — the Expo module: `startBridge(keyPath)`,
  `nodeId()`, `openTunnel(nodeHex, lane)`, `write(id, base64, timeoutMs)`,
  `read(id, max, timeoutMs)` (base64, empty = EOF), `shutdown(id)`.
- `android/.../uniffi/kalsa_iroh_mobile/` — the generated uniffi Kotlin
  bindings, vendored: they change only when the crate's uniffi API changes,
  and vendoring keeps the Gradle build hermetic (no Rust toolchain needed
  to compile Kotlin). Regenerate with the commands in
  `native/kalsa-iroh-mobile/README.md` and copy the file here.
- `android/src/main/jniLibs/arm64-v8a/` — `libkalsa_iroh_mobile.so`,
  built by the APK workflow (never committed; gitignored in place).
- `src/index.ts` — the typed JS API.

## The .so

Built on CI (`apk.yml`): rustup + cargo-ndk, NDK `27.1.12297006` (the RN
gradle catalog's pin), `cargo ndk -t arm64-v8a build --release` with the
crate's `.cargo/config.toml` supplying the 16 KB page-size flag. A failed
build fails the job before Gradle runs.

## Key path

The node identity lives at `<FileSystem.documentDirectory>/iroh-node.key`
(Android's filesDir); the key file is created owner-only by the crate.

## JNA

The uniffi Kotlin runtime speaks JNA; the AAR variant
(`net.java.dev.jna:jna:5.15.0@aar`) is the Android build of it.

Not wired into pairing or chat yet: `src/remote/irohHttp.ts` is the
transport that will ride these tunnels.
