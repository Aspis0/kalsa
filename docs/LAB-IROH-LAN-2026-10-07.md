# Lab — the phone reaches the PC on the home network without the relay (2026-10-07)

Plan step 6 (docs/PLAN-SURFACE-TUNE-2026-10-07.md), owner OK 2026-10-06. Status: code read and
verified; the phone measurement is owed tonight (the owner is away from home with the Jelly).

## What happened (2026-10-05/06 night)
- The Mac app's link to the n0 relay failed from ~06:04Z until at least 08:09Z: `Lost connection to
  relay server: Ping timeout`, `Failed to connect … timeout (>10s)`, `Resolve failed … Request timed
  out` (06:45Z), `tls handshake eof`. In the same window `ping 1.1.1.1` from the Mac answered in 9 ms.
- The Jelly, on the same Wi-Fi, dialed the door node 459c914b and got `aborted` / `deadline` at ~10 s
  (02:52 and 04:08 local). The door itself was up (8131 listening). No door request reached the app.

## What the code does (read 2026-10-07, both repos on iroh 1.2.0)
- Desktop: `crates/kalsa-iroh/src/transport.rs:215` builds the serving endpoint from `presets::N0`:
  n0 relays, Pkarr publisher and resolver, DNS lookup. It binds on all interfaces. No mDNS.
- Phone (`/Users/marco/Projects/kalsa/native/kalsa-iroh-mobile/src/bridge.rs:45-48`): dial-only,
  `RelayChoice::N0Public`, the n0 resolvers without the publisher (`transport.rs:209-213`). No mDNS.
  Whole-dial deadline 10 s (`crates/kalsa-iroh/src/bridge.rs:99-105`).
- The pairing QR carries the node id only (`crates/kalsa-pairing/src/payload.rs:74-81`). The phone
  stores credential, door URL, node, `pairedVia`; no address.

So the phone finds the PC only through n0: the relay, or the direct address the PC published to
n0's Pkarr/DNS. With the Mac unable to reach n0 at all (its DNS timed out too), it could not keep
the relay link or refresh its published record, and the phone had nothing to dial on the LAN.
Inferred, not measured: whether the stale published record held a usable LAN address.

## Fix options (ranked)
1. **mDNS on both ends** (`iroh-mdns-address-lookup`, `MdnsAddressLookup::builder()`, added with
   `Builder::address_lookup`). No pairing or wire change; the relay stays the road away from home.
   Cost: the desktop announces on the LAN (cheap). The phone listens while its bridge runs; the
   Android bridge already stops 30 s after HOME (app main 1b54f533), so discovery runs only in use.
   Not yet in either lockfile. Checked on crates.io 2026-10-07: latest 0.6.0 (2026-09-28) requires
   `iroh ^1.0.0` (so 1.2.0 fits), licence MIT OR Apache-2.0, built on `swarm-discovery ^0.6`.
2. Direct address in the pairing payload: changes the QR format, goes stale when the PC's address
   changes, and puts a LAN address in the QR. Not recommended.
3. Address hints over an already open channel: cannot help the first dial in an outage.

## Tonight's measurement (needs the owner: Jelly on adb + one sudo command)
1. Baseline, relay up: dial from the Jelly, record road and time (`KALSA_ROAD` logcat).
2. Block only the four n0 relays on the Mac (`use1-1`, `usw1-1`, `euc1-1`, `aps1-1`
   `.relay.n0.iroh.link` → 127.0.0.1 in `/etc/hosts`, backup first), restart the app, dial again.
   Expected today: fail at ~10 s.
3. With the mDNS build on both ends: same test, expected direct LAN dial.
4. Restore `/etc/hosts` from the backup; confirm the relay reconnects in the app log.
