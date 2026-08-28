# Amendment 1 — cool-start gate relaxed for the speed matrix (owner-approved)

Date: 2026-08-28, ~14:5x UTC. Prereg locked at commit ecd3e983.

**Change**: block cool-start gate ≤32.0 °C → **≤36.0 °C**, valid for **ONE block only**
(kexp_tg128_b1, Marco-KEXP tg128, ABBA N=3). After that block the matrix STOPS and the
S23 goes back on AC (owner leaves 28/08→~07/09; nobody can replug it for 10 days).

**Why**: with the phone awake and unplugged the battery temp plateaued at 38.8–39.0 °C
for two hours (block never started); in Doze it cooled only to 35.9 °C by the time the
battery hit 50% (floor 45%). The locked 32 °C gate is unreachable within the remaining
unplugged window. Idle drain measured ~7.5%/h even Dozing.

**Owner approval**: options presented as A (gate ≤36, one block, declared) vs B (park,
correctness-only bank). Owner replied "A" in chat, 2026-08-28.

**Reading caveat (goes into the bank too)**: comparators #18/#20 started cooler; a
~36 °C hot start can depress tg128 via earlier thermal throttling. The number is a
LOWER BOUND on the cool-start unplugged tg128; do not read A-vs-C deltas tighter than
that caveat allows.

Conditions unchanged: unplugged (ac:false), battery floor 45%, q56 watchdog WARN 40 /
KILL 43 / poll 10 s, cpuset gate, s3oracle pinned set, screen ON during the measured
block (owner realism requirement), screen off between runs only for cooling.
