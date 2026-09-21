# S23 functional repack check — RECOVERED FROM THE RUN RECORD

> **RECOVERED FROM THE RUN RECORD — NOT RE-MEASURED.** The original `REPORT.md` for this check was
> untracked inside a Paseo worktree that was later archived, and archiving deleted it. Every value
> below is taken from that run's record, not from a new device run. The matching conclusion is
> already committed in `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`, and
> the functional outcome is reviewed in `scratchpad/agents/repack-policy-review/REPORT.md`.

Device: Galaxy S23. Scope: the functional effect of the repack lever on the fit gate.

## Arms

| arm | configuration | outcome |
|---|---|---|
| A | `kalsa.bench.norepack=1` | fit gate passes; Qwen loads; `MemAvailable` falls about 1.31 GiB; weights stay mmap'd/evictable; `no_extra_bufts=1` |
| B | production configuration, no override | refuses; falls back to LFM; `MemAvailable` about 2.15 GiB lower; `no_extra_bufts=0` |

ARM B gate line, verbatim:

```
KALSA_LOAD {"phase":"fitGate","modelId":"qwen3.5-4b","refusedBy":"fit","reasonKey":"model.tightNow"}
```

## Conclusion

The repack COPY (about 3 GB anonymous) is the memory hog, not the model.

## Limitations

- On AC power, so functional only.
- No timing, throughput or energy number.
- The two arms started from slightly different `MemAvailable` values.
- ARM B therefore measured a DIFFERENT model, so the two footprints are not a controlled comparison.

This file is a reconstruction written after the original untracked report was destroyed; a full
timing/thermal A/B on a policy-built APK is separately in progress in
`scratchpad/agents/s23-repack-timing/`.
