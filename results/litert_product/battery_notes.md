# Battery / power notes — litert product twin (S23)

All measurements **UNPLUGGED** (AC/USB/Wireless powered = false).

| block | level before | level after | temp before (°C) | temp after (°C) | notes |
|-------|-------------:|------------:|-----------------:|----------------:|-------|
| session start | 57 | — | 27.7 | — | baseline |
| Gallery 4B (2 reps, CPU-only path) | 56 | 55 | 28.1 | 30.5 | model load + 2 gens |
| llama-bench 4B | 55 | 54 | 31.2 | 36.2 | segfault teardown exit 139 (numbers valid) |
| llama-bench 2B | 53 | 53 | 34.5 | 36.8 | segfault teardown exit 139 (numbers valid) |

- Never below 30% abort threshold.
- Never sustained ≥45.0°C (450 tenths) thermal pause threshold.
- Max temp observed ~36.8°C.
