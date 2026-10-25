# The bridge on the mobile network, measured on the road

2026-09-17. The one thing we had never tested: the phone away from the house, on
its SIM, with WiFi off. Until today the bridge was only ever proven indoors, which
proves the easy half — the half where both ends sit behind the same router.

Method: a 3-second `tailscale ping` loop on the Mac against the phone, running
unattended for twenty minutes while the owner turned WiFi off, pocketed the phone
with the screen locked, and walked out. Both ends on Tailscale, nothing else
touched. 400 samples.

## What happened

| time | path | what it means |
|---|---|---|
| 10:18 | `192.168.1.193` | home WiFi, LAN-local |
| 10:28 | home public address, same port | leaving: the same UDP mapping, now seen from outside |
| 10:30 | `172.56.x.x:48608` | the carrier's CGNAT address — **direct** |

The address changed again during the walk (a different carrier IP *and* port from the
first cellular reading half an hour earlier): a new CGNAT binding after a cell change.
Tailscale re-punched it without help each time.

## Numbers

- **Relay hops: zero.** Not one sample came back through DERP; `tailscale status`
  read `direct` for the whole run.
- **Round trip on the SIM (n=120): min 24 ms, median 55, p90 159, max 318.**
  Indoors on the same SIM the median was worse (~84 ms) — that was the indoor
  signal, not the network.
- **Unreachable: 5 short runs, the longest ~10 seconds** — the WiFi→cellular
  handover, and the cell changes.

## What this settles, and what it does not

Settled: the carrier does **not** use symmetric NAT. A direct UDP path was opened,
lost to a cell change, and opened again, from a phone with the screen off. So
"your computer at home answers your phone when you are out" is true, it costs about
50 ms, and it does not need a relay in the middle — which also means it does not
need anyone's paid relay tier.

Not settled: **iroh on the mobile network is still unmeasured**, and iroh is the
transport we would actually ship (MIT/Apache, relays we host ourselves). What today
buys iroh is the precondition, not the proof: hole punching is possible through this
carrier, and iroh punches the same way (QUIC plus STUN-style discovery). But
`crates/kalsa-iroh/tests/roundtrip.rs` runs both endpoints in one process over
loopback with relays disabled — by design, to test the tunnel and the door — so it
says nothing about NAT. There is no harness that puts two real endpoints on two real
networks, and adb cannot raise the phone app's iroh endpoint to get its node id.
Building that harness is the next transport task, and it is half an hour of work,
not two minutes.

Also still open: a 10-second hole is nothing for a chat that is idle, and everything
for a chat that is mid-answer. Nobody has decided what the client does when the
route dies with a stream in flight.
