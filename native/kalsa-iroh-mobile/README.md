# kalsa-iroh-mobile

The Android face of brain's `kalsa-iroh`: one uniffi object holds the node
identity (the app passes the key file path), one tunnel object carries raw
HTTP/1.1 bytes on the door and desk lanes. Blocking API on purpose: Kotlin
parks one thread per call, every call carries its own timeout, and calls
made from inside an async context answer a typed error instead of panicking.

## Layout

- `src/bridge.rs` — `MobileBridge`: key file path in, `node_id()` out, `connect(node_hex, lane)`.
- `src/stream.rs` — `Tunnel`: `write(bytes, timeout_ms)`, `read(max, timeout_ms)` (empty = EOF), `shutdown()`.
  The read and write halves are independent; `shutdown()` cancels parked calls.
- `src/error.rs` — the typed error enum (`detail`, never `message`: Kotlin's
  `Throwable.message` collides with a uniffi error field of that name).
- `src/runtime.rs` — the shared runtime, the plain-thread rule, the drop guard.
- `tests/` — `key_file` (identity lifecycle), `roundtrip` (both lanes, chunked
  HTTP + SSE), `tunnel_lifecycle` (shutdown/drop/halves/bounds), `support/` (rig).

## Commands

Host tests (no network needed; `test-support` enables the network-free rig):

```
cargo test --features test-support
```

Android `.so`, arm64-v8a. The 16 KB page flag lives in `.cargo/config.toml`;
`cargo ndk` picks it up with no environment variables beyond the NDK:

```
ANDROID_NDK_HOME=<ndk> cargo ndk -t arm64-v8a build --release
```

Release profile: `opt-level = "z"` (measured smaller than `"s"`: 11.16 MB vs
11.55 MB), `strip = "symbols"`, `lto = "thin"`.

Kotlin bindings — generate from the **debug** dylib (the release one is
stripped; bindgen reads its symbols). Not wired into the app yet:

```
cargo build
cargo run --bin uniffi-bindgen -- generate \
  --library target/debug/libkalsa_iroh_mobile.dylib \
  --language kotlin --out-dir bindings/kotlin
```

The generated file compiles standalone against JNA (kotlinc 2.4):

```
kotlinc -cp jna.jar bindings/kotlin/uniffi/kalsa_iroh_mobile/kalsa_iroh_mobile.kt -d out
```

## Semantics worth knowing

- `shutdown()` half-closes the write side and fails parked reads/writes with
  `Closed`; uniffi's own `close()` (AutoCloseable) only drops the object.
- A write that times out closes the tunnel: a half-written stream is not reusable.
- The tunnel holds a shared runtime, so it can outlive its bridge; dropping
  the bridge closes the endpoint and parked calls return typed errors.
- The phone never calls `with_desk` — it dials, it never serves.

## Why the host test needs no network

`RelayChoice::Disabled` plus an in-process `AddressBook` is `kalsa-iroh`'s
own network-free seam — its round-trip test runs the same shape. Both
endpoints resolve each other in-process and bind only local sockets. The
production constructor stays on the n0 road; the seam lives in
`MobileBridge::for_tests` behind the `test-support` feature, outside the
uniffi face, and the test dials through the very same `connect`/`Tunnel`
code the bindings will call.

## Note for the RN module step

`Bridge::start` needs the key file's parent directory to exist, and the
file lands owner-only (`0600`, the unix path in kalsa-iroh `key.rs:96-103`).
The app passes `<Context.filesDir>/iroh-node.key`.

Two known upstream (kalsa-brain) items, not fixed here: the phone's node id
is published to n0 pkarr DNS under `RelayChoice::N0Public`, and brain always
spawns an accept loop even for a dial-only endpoint.
