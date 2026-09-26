# kalsa-iroh-mobile

The Android face of brain's `kalsa-iroh`: one uniffi object holds the node
identity (the app passes the key file path), one tunnel object carries raw
HTTP/1.1 bytes on the door and desk lanes. Blocking API on purpose: every
wait is already bounded in `kalsa-iroh` (10 s dial deadline, 30 s idle
deadline), so Kotlin parks one dispatcher thread instead of driving a
foreign executor across JNI.

## Layout

- `src/bridge.rs` — `MobileBridge`: key file in, `node_id()` out, `connect(node_hex, lane)`.
- `src/stream.rs` — `Tunnel`: `write(bytes)`, `read(max)` (empty = EOF), `close()`.
- `src/error.rs` — the typed error enum; nothing panics across the FFI.
- `src/bin/uniffi-bindgen.rs` — bindings generator entry point.
- `tests/key_file.rs` — identity file lifecycle (create, `0600`, reload, refuse corrupt).
- `tests/roundtrip.rs` — both lanes, real chunked HTTP and chunked SSE through the tunnel.

## Commands

Host tests (no network needed):

```
cargo test
```

Android `.so`, arm64-v8a, 16 KB page alignment:

```
RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384" \
ANDROID_NDK_HOME=$NDK cargo ndk -t arm64-v8a build --release
```

Kotlin bindings (not wired into the app yet):

```
cargo run --release --bin uniffi-bindgen -- generate \
  --library target/release/libkalsa_iroh_mobile.dylib \
  --language kotlin --out-dir bindings/kotlin
```

## Why the host test needs no network

`RelayChoice::Disabled` plus an in-process `AddressBook` is `kalsa-iroh`'s
own network-free seam — its round-trip test runs the same shape. Both
endpoints resolve each other in-process and bind only local sockets. The
production constructor stays on the n0 road; the seam lives in
`MobileBridge::for_tests`, outside the uniffi face, and the test dials
through the very same `connect`/`Tunnel` code the bindings will call.

## Note for the RN module step

`Bridge::start` needs the key file's parent directory to exist, and the
file lands owner-only (`0600`, the unix path in kalsa-iroh `key.rs:96-103`).
The app passes `<Context.filesDir>/iroh-node.key`. The phone must never
call `with_desk` — it dials, it never serves.
