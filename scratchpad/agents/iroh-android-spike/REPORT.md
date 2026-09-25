# Can the Kalsa app dial the desktop over iroh? — research report (2026-09-25)

Research only; no code touched. Desktop facts read from `kalsa-brain/crates/kalsa-iroh`
(note: there is **no `road.rs`** — the config lives in `transport.rs`/`bridge.rs`).

## Desktop side (read from disk; note: there is **no `road.rs`** — config lives in `transport.rs`/`bridge.rs`)
- `Cargo.toml:11`: `iroh = "=1.2.0"` (exact pin, as assumed). `transport.rs:43`:
  `const ALPN: &[u8] = b"kalsa/door-tunnel/1";`
- `transport.rs:204`: `Endpoint::builder(presets::N0)` when `RelayChoice::N0Public`
  (`bridge.rs:41`: "Address lookup stays on the n0 DNS road.") — n0 relays + n0 DNS discovery.
- `transport.rs:280-288`: `endpoint.connect(remote, ALPN)` then `connection.open_bi()` —
  **one bidirectional QUIC stream**, wrapped as tokio `AsyncRead + AsyncWrite` (`TunnelStream`).
  Raw bytes both ways ⇒ HTTP/1.1 + chunked SSE flows unchanged.

## 1. n0-computer/iroh-ffi
- Latest release **v1.1.0, 2026-07-16** (v1.0.0 2026-06-15). Maintained: 233 commits, open
  issues/PRs, releases 2 months old. https://github.com/n0-computer/iroh-ffi
- Wraps **`iroh = { version = "1.0.0" }`** (`Cargo.toml` on main) — a caret req, but the shipped
  artifacts predate iroh 1.1.0 (2026-08-25), so they effectively wrap **1.0.x, not our 1.2.0**.
- Kotlin/Android artifacts on Maven Central, group `computer.iroh`: `iroh` (JVM, UniFFI-over-JNA)
  and **`iroh-android:1.1.0`** (AAR, published **2026-07-17**). 4 ABIs (arm64-v8a, armeabi-v7a,
  x86, x86_64), NDK API 29. Measured earlier (memory `iroh-on-android-costs`): AAR 24.56 MB
  compressed / **arm64 .so = 13.35 MiB uncompressed**.
- API (from `src/endpoint.rs`): `EndpointBuilder` + `preset_n0()` ("relays + discovery + crypto
  provider"), `secret_key`, `alpns`, `bind()`; **`connect(addr, alpn)`**; **`open_bi()` →
  BiStream** — SendStream `write/write_all/finish/reset`, RecvStream `read/read_exact/read_to_end`:
  **raw read/write on streams, yes**; plus `watch_network_change`.
- ⚠️ **Open issue #285 "Please publish android patch"**; closed **#279**: "Android AAR:
  libiroh_ffi.so is 4 KB ELF-aligned, failing Google Play's 16 KB page-size requirement" — the
  **published AAR still lacks the 16-KiB alignment patch** (Android 15+/Play need it; Jelly
  Star/S23 are fine for a sideloaded spike).
- ⚠️ **Android bind-hang report**: iroh-kmp (klibs.io): "The published `computer.iroh:iroh`
  Maven artifact is UniFFI-over-JNA, and its async calls never complete on Android
  (`Endpoint.bind` hangs, id stays null)" — 0.x-era artifact; **re-verify on 1.1.0**.
- Wire compatibility: iroh blog "The road to iroh 1.0" (2026-07-09): **"Iroh 1.0 just means that
  the wire format and API are stable"** + "various extension points both in the wire format and
  in the API". Changelog 1.1.0/1.2.0: no wire-protocol breaks (only a `CustomAddr` serialization
  fix affecting custom transports). **1.0.0 ↔ 1.2.0 interop: expected yes** (ALPN is ours; QUIC +
  relay protocol unchanged) — but unverified peer-to-peer; the spike must prove it at the door.

## 2. Own thin crate (fallback, and my production pick)
Proven pattern: n0's own README.kotlin (uniffi + NDK, four ABIs) and gordo-labs'
`iroh-react-native-bridge` (uniffi-bindgen-react-native). Recipe: crate pinned `iroh = "=1.2.0"`
(parity with desktop `transport.rs`), uniffi 0.31 or Gobley JNI, `cargo-ndk`. Known pitfalls:
- **JNA on Android** is the flaky link (hang claim above); Gobley generates plain JNI and avoids
  it — or pin JNA ≥ 5.16 (`net.java.dev.jna:jna:5.18.x@aar`). **16-KiB pages**: add
  `-C link-arg=-Wl,-z,max-page-size=16384` to every Android target.
- **DNS**: no `/etc/resolv.conf` on Android; iroh's hickory resolver needs nameservers — 1.2.0's
  "configurable fallback nameservers" takes carrier DNS or `8.8.8.8`, then n0 discovery resolves.
- **Network change**: netwatch reads netlink and works on Android; drive reconnects from the
  `watch_network_change` / Android CONNECTIVITY events. **Doze**: the accept loop freezes in
  background — needs a foreground service (dsh-tether and iroh-ssh-android both need one).
  **Battery**: QUIC ≈ +34% vs UDP under continuous load (TU Delft, via memory note);
  relay-keepalive cost on cellular is unmeasured.
- **APK size**: ≈ the AAR's 13.4 MiB/arm64 (iroh dominates; bindings add ~1 MiB). Kalsa ships
  4 ABIs today → up to ~25 MB APK delta unless this path is arm64-only.

## 3. Prior art
- `gordo-labs/iroh-react-native-bridge` (npm `@gordo-labs/react-native-iroh` v0.2.0, beta, MIT):
  RN >= 0.81 TurboModule, iroh 1.x, RelayMode::Default, device-tested vs n0 relays — but
  **framed** streams only, no raw duplex, no discovery control; 4 stars/35 commits: existence
  proof, not a dependency. No n0-official RN module exists.
- Android apps shipping iroh: **dsh-tether** (arm64 APK releases; documents Doze limits) and
  **iroh-ssh-android** (foreground service) — see memory `iroh-on-android-costs`.

## 4. Licences
iroh-ffi: **Apache-2.0 OR MIT** (repo statement). iroh: MIT OR Apache-2.0. Compatible with kalsa.

## Recommendation
**Own thin Rust crate, uniffi/Gobley + cargo-ndk, `iroh = "=1.2.0"`** mirroring `transport.rs`.
Why: exact version parity with the desktop pin (iroh-ffi would put 1.0.0 on the phone vs 1.2.0
on the Mac — expected-compatible but unproven and unpinnable); the published AAR still fails
16-KiB alignment (#285 open); the JNA bind-hang report is unrefuted; and we already own the
"iroh boundary file" discipline, so the marginal cost is FFI scaffolding, not protocol code.
**Cheap de-risk first** (hours, zero kalsa code): install the `iroh-android:1.1.0` AAR in a
throwaway Expo module or run `dsh-tether` — (a) prove `bind()` doesn't hang on Android,
(b) measure phone-cellular → home-desktop path (direct vs relay, the one number still missing).
If (a) fails or n0 ships the alignment patch + a 1.2-tracking release, revisit iroh-ffi.
**Risks (own crate)**: we own uniffi/JNI scaffolding and iroh bumps; Doze forces a foreground
service; Android DNS config; relay-keepalive battery on cellular unmeasured; ~13.4 MiB/arm64.
## Decision (coordinator, 2026-09-25, on kalsa-brain's suggestion)
The phone crate depends on brain's `crates/kalsa-iroh` as a git dependency pinned to a brain commit and
wraps only `Bridge::connect` + `TunnelStream` with uniffi. One source for ALPN, key format and relay
choice, so the two ends cannot skew. Android blockers found inside it (e.g. the key file path or its
permissions in `key.rs`) go back to kalsa-brain to be fixed on the desktop side.
