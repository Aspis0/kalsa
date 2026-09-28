# v73d raw evidence index

- `device-sha256.md`: artifact, model, fixture, and CPU-base checksums.
- `*-v.log.gz`: complete verbose device logs for P0/P1/Q0/D0/D0b/D1/P2/P3/P4.
- `*-gates-run.log.gz`: per-arm pre/post gate output, process exit, HTP counts, and KLD summary.
- `final-device-gates.txt`: final screen, battery, thermal, tracing, and app state.
- P0/P1 and D0/D1 ubatch-filtered op tables compared identical. D0/D1 ubatch-1 tables differ by two decode matmuls and SWIGLU on HTP.
- D0/D0b hashes: identical (1014 tensors). D0/D1: first mismatch at `ffn_gate-29`, tensor 1007; downstream hashes differ.
- P2/P3/P4 op differences: P2 adds norm ops; P3 adds 176 `SSM_CONV`; P4 prefill table matches P1.
