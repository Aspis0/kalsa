# S23 in-app decode hop v1 by thermal headroom (2026-10-04)

Build: app `57e4d979` (debuggable, CI run 37187488307), kalsa.rn `7c26e272`, kalsallama `bc5f0207c`.
Rule v1 (engine `select_decode` rule 4): per leg, headroom = min over its zones of (lowest passive trip - temp);
every 32-token window, NPU first, move only when the other leg leads by >= 4 C; no zones -> fixed alternation.
S23 legs found in-app: `governor: decode hop thermal legs cpu=18 npu=4 zones` (cpu trips 108/115 C, nsp 95 C).

Protocol: same harness as `s23-decode-hop-3238e1bb` (in-app turn, decode prompt, production defaults with
npu_lane/route keys deleted then restored - `raw/keys-found.txt` == `raw/keys-restored.txt`), arms CPU-only vs
`kalsa.bench.decode_hop=32`, ABABAB planned. S23 unplugged, 41 % at start, traced 0. No cool-start gate.

## Result

| turn | arm | tok | tok/s | hops | CPU tok | NPU tok | headroom windows | battery start C | peak CPU / NSP C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| smoke | auto | 553 | 12.95 | 17 | 266 | 288 | 18 | ~29 | - |
| cpu-1 | CPU | 1284 | 10.16 | 0 | 1285 | 0 | 0 | 33.0 | 91.6 / 94.3 |
| hop-1 | auto | 1163 | 9.01 | 15 | 908 | 256 | 37 | 38.1 | 91.2 / 92.7 |
| cpu-2 | CPU | - | - | - | - | - | - | 41.9 | killed: watchdog 43 C, thermal status 3 |

Session stopped at cpu-2 (watchdog, as designed). n=1 per arm.

Compare the fixed alternation of 2026-10-03 (`s23-decode-hop-3238e1bb`, same harness): hop-1 at 36.9 C start ran
**11.47 tok/s, 670 CPU / 640 NPU tokens, 40 hops**; hop-2 at 40.8 C ran 11.30.

## Reading

- **The rule runs on the real phone**: every window was decided by headroom (37/37), hops cost 12.4 ms of KV
  commit per turn.
- **Cool phone: it alternates almost every window** (smoke: 17 hops in 18 windows) - the active leg loses more
  than 4 C of headroom inside one 32-token window (~2.5 s) and the idle one recovers.
- **Warm phone: it leans on the CPU** (78 % of tokens): the NSP runs closer to its 95 C trip than the CPU to its
  108 C one, so CPU headroom wins. But CPU decode is the backend with twice the heat per token
  (`s23-decode-heat-sustained`: 0.302 vs NPU 0.148 battery C*s/token), and the S23 is stopped by skin/battery
  heat (Samsung thermal status, our 43 C watchdog), not by the block trips - peaks stayed at 91-93 C, under both
  trips. The result was 9.0 tok/s against 11.3-11.5 for yesterday's fixed 50/50 alternation at similar starts.
- **Direction, not proof**: n=1, different days, start temperatures 38.1 vs 36.9/40.8 C. But the mechanism is
  visible in the token split, and it points one way: **block headroom to the passive trip is the wrong objective
  on the S23**; it optimises the margin of a limit that never binds and spends the heat budget that does.

## Next (owner decision)

A v2 that keeps the per-component reading but optimises the binding limit: NPU first (cheapest heat per token),
CPU only as relief when the NSP nears its own trip, back with hysteresis - or the fixed alternation, which measured
better. Battery at 32 % after the session: another session needs a charge first (never benchmark while charging).
