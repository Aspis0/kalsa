# Cold-read floor — declared before remaining pairs

Pinned 2026-08-16T14:22:15-0400 from the first COLD-VALID OFF block
(`b1_OFF_try1`), **before block 2 started**.

| pin | value |
|---|---|
| first OFF `read_bytes` | 22,288,732,160 (22.288732 GB) |
| **COLD_READ_FLOOR** | **11,144,366,080 bytes** (50% of first OFF) |
| first OFF Cached drop | 3884 MB (`5718360 → 1740540` KiB) |
| fadv | `resident_before=994524 resident_after=0 pages fadvise_rc=0` |
| first OFF wall_s_tok | 0.189 (n=200, stall 22.8%, 29 °C, batt 96→95) |

A later run is COLD-VALID only if Cached drop ≥ 1000 MB **and**
`read_bytes ≥ 11144366080`.
