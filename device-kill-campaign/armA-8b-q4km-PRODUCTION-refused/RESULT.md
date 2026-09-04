# Arm A, production config: the app REFUSED to load, and was right to

Not a kill. Not an engine failure. `modelGateVerdict` returned `blocked_ram` and the
app said so in Italian: "Memoria libera insufficiente per eseguirlo".

Measured at the moment of the refusal (sysprobe, turn 1):
- MemAvailable = 4118896 kB = 4022 MiB
- RssAnon = 128604 kB — the model never began allocating
- battery_level_pct = 61, battery_charge_uah = 2321250, battery_deci_c = 345

The arithmetic (deviceProfile.ts:188, memoryEstimate.ts:112):
- weights 5155564768 B = 4916.6 MiB
- REPACK_FRACTION = (1333-249)/1211 = 0.8951
- repackMiB = 4401 MiB  >  4022 MiB available  ->  blocked_ram

The refusal fires on the repack term ALONE, before compute or KV are added.

## Why this arm ran at all in earlier sessions

`repack` reaches the gate from one place: `AppShell.tsx:2715`,
`{ repack: !(await getBenchNoRepack()) }`. With `kalsa.bench.norepack=1` set,
repackMiB is 0, the estimate falls to ~249 MiB, and the gate admits the model.
That pref was found set on this S23 at the start of the session, left over from an
earlier run. Clearing it (production config) is what produced this refusal.

Whether §7.27's "killed at turn 8" was measured with that pref set is an INFERENCE,
not a fact: what is verified is that the pref was set, and what it does to the gate.

## Consequence for arm E, which is the sharp part

`kalsa::MoeStream::arm()` forces `params.no_extra_bufts = true` — streaming DISABLES
repack, because repack would change the byte layout the file offsets describe. The
gate cannot see that: it reads the `norepack` pref, not `moeStream`. So the gate
refuses the 8B for a 4.4 GB repack cost that streaming would have removed.

That is the "no streaming awareness in the gate" gap, with a number on it.
