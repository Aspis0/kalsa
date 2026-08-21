
## KEXP #14 (exploratory, NOT ship, NOT in the OLMoE N>=5 median)

Protocol: ABBA x 3, tg512, -fa off -t 4. Arm A = `-ngl 99` (experts GPU). Arm B = `-ngl 99 -ncmoe 99` (experts CPU). OpenCL `b9d99fa8…`. noextra impl `d2030f23…`. Same .so both arms.

**Complete blocks:** 2 / 3
**Exploratory median tg512 A:** 13.740  **B:** 7.582  **ratio:** 1.812

| block | status | temp_c_block_start | warm_start | level_pre | tg512 | governor |
|---:|---|---:|---|---:|---|---|
| 1 | COMPLETE | 30.3 | False | 44 | A:15.962636 B:7.594689 B:7.569378 A:12.278213 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 2 | COMPLETE | 34.9 | False | 40 | A:15.202009 B:7.683361 B:7.314020 A:11.567954 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |

Raw: `results/kexp_speed_s23/runs.csv`
