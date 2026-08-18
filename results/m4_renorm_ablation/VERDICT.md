# M4 — renormalisation ablation on CalaQwen: does the drop's quality
# result come from removing experts, or from rescaling the survivors?

Reference, machinery not armed: **d=0.0 macro bpb = 0.6780748**

| drop | renorm ON | renorm OFF | OFF - ON | reading |
|---|---|---|---|---|
| 0.5 | 0.6802864 | 0.6791113 | -0.0011751 | OFF better by -0.17% — the default is costing quality |
| 0.65 | 0.6842309 | 0.6794305 | -0.0048004 | OFF better by -0.70% — the default is costing quality |
| 1.0 | 0.7049320 | 0.6860923 | -0.0188397 | OFF better by -2.67% — the default is costing quality |

## Verdict

**The default is wrong and there is free quality on the table:** turning
renormalisation off measured *better* at every level tested.

Arms compared byte-for-byte on the same pinned binary and model; the only
difference between an ON and an OFF cell is `--extra=--drop-no-renorm`.

