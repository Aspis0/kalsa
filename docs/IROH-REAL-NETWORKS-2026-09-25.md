# iroh across two real networks — 2026-09-25

First road test with the two ends on different real networks. The Mac at the
owner's home ran the actual app with the internet road open; the Surface at
the owner's workplace dialed it by node id alone with
`crates/kalsa-iroh/examples/dial.rs` (`Bridge::connect`,
`RelayChoice::N0Public` — the production shape). No credential was used,
moved, or stored anywhere in this job: every round trip is `GET /v1/models`
with no Authorization header, and the door's empty 401 is the proof a full
round trip happened. Everything below is measured output unless marked
INFERRED.

## Setup

- Mac (home): the app from this tree (HEAD `1dd372b6` plus this job's
  uncommitted dial tool), dev build, brain Running with a pinned development
  model (`KALSA_BRAIN_MODEL` → a local gguf). The door answers on
  `127.0.0.1:8131`; it only raises while the brain is Running, so the model
  pin was for the door's sake — the 401 test itself needs no model loaded.
  Internet road turned on through the Advanced panel; the app announced node
  id `79c76dac9ab45e137f741121be045b4a9a597d231f739d8d53017498f6840198`.
- Surface (workplace): Windows 11, corporate-managed (Palo Alto agents
  present on the network). Source synced by `git archive HEAD` + overlay of
  the three uncommitted files; `cargo build --release -p kalsa-iroh
  --example dial` finished in 3m 43s, exit 0 (rustc 1.98.1 msvc).
- Networks, as asked: "home ISP" (residential, IPv6 present, LAN
  192.168.1.0/24) and "corporate". Tailscale runs on both machines but is
  NOT part of the road; see the Tailscale finding.

## Run A — sanity, Mac dialing itself over the n0 road

- First connected stream: 283 ms. Paths right after: relay only.
- 20 sequential round trips: 20 OK, 0 failed — min 5 ms, median 6 ms,
  p95 55 ms. The first two rode the relay (55–62 ms), the rest direct.
- 120 s hold, sampled every 10 s: all 401, 8–12 ms. Active paths rotated
  among `ip:192.168.1.50` (home LAN), `ip:100.74.116.126` (the Mac's own
  Tailscale address), two global IPv6 addresses, with the relay session
  kept active throughout.
- Reading: the hole punch settles within a round trip or two, and iroh
  probes several direct candidates at once.

## Run B — corporate → home, Tailscale up on both machines

- First connected stream: 358 ms. Paths right after: relay only.
- 20 sequential round trips: 20 OK, 0 failed — min 65 ms, median 78 ms,
  p95 85 ms, all relay-carried.
- 120 s hold: relay active on every sample (84–93 ms), one 637 ms spike at
  +110 s (single sample, cause unknown — INFERRED: relay congestion). At
  +121 s `active ip:100.74.116.126` appeared: a direct path — and it is the
  Mac's Tailscale address. From that moment some traffic may have shifted
  onto the tailnet (INFERRED; the sample latencies did not change).
- **Tailscale finding:** the Mac's endpoint advertises its Tailscale 100.x
  address as a direct candidate, and on a network where tailnet UDP flows,
  iroh will take it. The brief's rule says the road must not ride Tailscale,
  so the clean rerun below was made. The API cannot exclude one address:
  `AddrFilter` (iroh-dns 1.3.0 `endpoint_info`) offers only
  `unfiltered` / `relay_only` / `ip_only` — no per-address or per-range ban.

## Run C — corporate → home, Tailscale down on the Mac

Mac Tailscale brought down by CLI before the dial and restored after; the
Surface launched the dial through a detached scheduled task, so no part of
the measurement touched Tailscale (no 100.x path existed at the network
layer while it ran).

- First connected stream: 315 ms. Paths right after: relay only.
- 20 sequential round trips: 20 OK, 0 failed — min 74 ms, median 85 ms,
  p95 94 ms.
- 120 s hold: relay active on EVERY sample (85–92 ms). No direct path ever
  went active. No Tailscale address anywhere.
- **Corporate finding:** no direct UDP path from the corporate network to
  the home network succeeded. The road worked anyway — the relay of last
  resort carried all of it, 0 failures across 20 round trips and 12 hold
  samples. Whether the corporate edge blocks outbound UDP entirely or only
  this pair was not testable from here.

## Windows key DACL

`crates/kalsa-iroh/Cargo.toml` and `key.rs` call the Windows DACL path
declared-not-proven ("never compiles on this machine"). The Surface build is
its first compile: it compiled clean, exit 0, no fix needed. Runtime is
still unproven: the dial example mints its key in memory
(`NodeKey::generate`) and never calls `load_or_create`/`store`, so the DACL
code compiled but executed zero times.

## Not verified

- Which transport carried the relay traffic inside the corporate edge (the
  n0 relay is reached on 443; that it was reachable while direct UDP was not
  is measured — the inner protocol was not packet-verified).
- Direct UDP from corporate: blocked for this pair on this day; broader
  claims would need more networks.
- The DACL's runtime effect (above).
