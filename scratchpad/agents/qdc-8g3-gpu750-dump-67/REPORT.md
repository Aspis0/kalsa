# Cell #67 — GPU-leg defect reproduction and node dump on QDC Snapdragon 8 Gen 3 (QRD8650, correctness)

Plugged QDC device: correctness only, speeds indicative.

## Device

- Portal device: Snapdragon® 8 Gen 3, Mobile Reference Design, QRD8650 | Android (SM8650)
- `ro.soc.model`: SM8650 (from `raw/recon_sa881544.txt`)
- `ro.product.model`: Pineapple for arm64
- `ro.build.fingerprint`: qti/pineapple/pineapple:14/UKQ1.240227.001/eng.lnxbui.20240322.021741:userdebug/test-keys
- `/vendor/lib64/libOpenCL.so` and `/vendor/lib64/libcdsprpc.so` present (recon)
- `MemTotal`: 11544332 kB
- Hexagon arch (from arms): v75, DMA64 disabled; OpenCL: Adreno(TM) 750, driver `OpenCL 3.0 QUALCOMM build: commit unknown Compiler E031.45.02.06`
- Battery temperature at every arm header: `batT=250`; no `WATCHDOG:` line in the report
- Kit verify (`raw/kit_verify_sa881544.txt`): `governor-bench: OK`, `libggml-htp-v75.so: OK`, `run-legs.sh: OK`

## Job

- QDC interactive session id: 877475, name `cell67-gpu750-dump` (tunnel host sa881544, adb serial cacfeec9)
- Minutes requested: 45 in "Maximum Minutes Per Device" (field min 10, max 428, step 1; value read back as 45 before Create Session). Mode of operation: Screen mirroring + SSH. SSH key: `kalsa-mac` (the local `~/.ssh/qdc_ed25519`, comment `qdc-kalsa-mac`).
- Timer: at Create Session the Total Minutes Used field read "Pending". Started On 10/08/26 3:16:17 PM. About 10.5 min after start (shortly before End Session) the header showed `34m 29s remaining`, consistent with a 45-minute window.
- Session ended: "Successfully ended session cell67-gpu750-dump". Status Completed. Started On 10/08/26 3:16:17 PM, Ended On 10/08/26 3:26:55 PM. Total Minutes Used read as `0` at the first read after ending (log upload still in progress); at a later read it showed `13m`.
- Legs script (device clock): `== legs start Thu Oct  8 12:19:47 PDT 2026` to `== legs end Thu Oct  8 12:25:48 PDT 2026`
- Tunnel: `ssh -L 6037:sa881544.sa.svc.cluster.local:5037` (PID 6631) killed; no listener on 6037 afterwards.

## Per arm

Arm headers and kld lines copied verbatim from `raw/legs_report_sa881544.txt`.

- `## G exit=0 batT=250`: reference arm, writes `twocopy.gbl`; no kld line.
- `## L-npu exit=0 batT=250`
  - `kld arm=L ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000022 max=0.000434 kld_max=0.010000 status=PASS`
- `## L-gpu exit=1 batT=250`
  - `kld arm=L ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.041334 max=0.978824 kld_max=0.010000 status=FAIL`
- `## L-gpu2 exit=1 batT=250`
  - `kld arm=L ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.038273 max=0.595899 kld_max=0.010000 status=FAIL`
- `## D-gpu1 exit=1 batT=250`
  - `kld arm=L ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=7 diverged=1 mean=0.176283 max=0.827721 kld_max=0.010000 status=FAIL`
  - `dump lines: 8432`
- `## D-gpu2 exit=1 batT=250`
  - `kld arm=L ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=5 diverged=1 mean=0.102176 max=0.367619 kld_max=0.010000 status=FAIL`
  - `dump lines: 8432`
- `## D-agpu exit=0 batT=250`
  - `kld arm=A ref=/data/local/tmp/kalsa67/twocopy.gbl vocab=128000 tokens=128 compared=128 diverged=0 mean=0.000012 max=0.000510 kld_max=0.010000 status=PASS`
  - `dump lines: 8432`

## Errors / aborts

The report contains no `WATCHDOG`, `GGML_ABORT`, `refus`, or `error` line. Non-zero exits are on the four GPU-leg arms, as in the headers above (`exit=1`). `== legs end Thu Oct  8 12:25:48 PDT 2026 batT=250`.

## Compare

Node dumps: `raw/D-gpu1_sa881544.dump`, `raw/D-gpu2_sa881544.dump`, `raw/D-agpu_sa881544.dump` (text, left in place). Committed evidence: `raw/session1-dump-09a496d71.grep` (legs report, both compares, layer-2 attention lines at token 0). The .dump files stay local.

### D-gpu1 vs D-gpu2

Command, run from `/Users/marco/Projects/kalsallama-gov-loadstep`:
`python3 -I tools/governor-bench/compare-node-dumps.py RAW/D-gpu1_sa881544.dump RAW/D-gpu2_sa881544.dump > /tmp/cmp12.txt 2>&1; echo EXIT=$?`

Exit code: EXIT=1. Output (head -40):

```
input differs at tok=5
tok=0 first divergence: node=kqv-2 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=6.432e-02 rel_sumabs=1.864e-02 rel_sumsq=4.287e-02 rel_first[2]=3.797e-01 rel_first[3]=1.204e+00
tok=1 first divergence: node=kqv-2 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sum,sumabs,sumsq rel_sum=1.892e+00 rel_sumabs=1.380e-02 rel_sumsq=3.300e-02
tok=2 first divergence: node=kqv-2 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sum,sumabs,sumsq rel_sum=4.730e-01 rel_sumabs=6.312e-03 rel_sumsq=2.053e-02
tok=3 first divergence: node=kqv-2 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sum,sumabs,sumsq,first[3] rel_sum=5.287e-01 rel_sumabs=2.345e-02 rel_sumsq=3.791e-02 rel_first[3]=1.072e-01
tok=4 first divergence: node=kqv-2 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sum,sumabs,sumsq rel_sum=4.355e-01 rel_sumabs=1.490e-02 rel_sumsq=3.525e-02
10 largest relative differences (threshold 0.001, abs floor 1e-06):
  tok=0 node=model.layers.{}.conv.in_proj-10 occ=2 leg=A:gpu/B:gpu op=VIEW fields=sum,sumabs,sumsq,first[0],first[1],first[2],first[3] rel_sum=1.696e-01 rel_sumabs=3.711e-02 rel_sumsq=7.469e-02 rel_first[0]=1.999e+00 rel_first[1]=1.400e-01 rel_first[2]=2.197e-01 rel_first[3]=1.640e-01
  tok=0 node=ffn_gate-13 occ=0 leg=A:gpu/B:gpu op=MUL_MAT fields=sumabs,sumsq,first[0],first[1],first[2],first[3] rel_sumabs=2.513e-02 rel_sumsq=4.168e-02 rel_first[0]=1.145e+00 rel_first[1]=4.348e-01 rel_first[2]=1.680e-01 rel_first[3]=1.999e+00
  tok=1 node=node_156 occ=0 leg=A:gpu/B:gpu op=MUL fields=sum,sumabs,sumsq,first[1],first[2],first[3] rel_sum=2.231e-01 rel_sumabs=3.335e-02 rel_sumsq=5.392e-02 rel_first[1]=1.998e+00 rel_first[2]=3.380e-01 rel_first[3]=7.944e-02
  tok=1 node= occ=6 leg=A:gpu/B:gpu op=TRANSPOSE fields=sum,sumabs,sumsq,first[1],first[2],first[3] rel_sum=2.231e-01 rel_sumabs=3.335e-02 rel_sumsq=5.392e-02 rel_first[1]=1.998e+00 rel_first[2]=3.380e-01 rel_first[3]=7.944e-02
  tok=1 node=cache_r_l4 occ=6 leg=A:gpu/B:gpu op=CPY fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.433e-01 rel_sumabs=1.761e-03 rel_sumsq=1.534e-02 rel_first[2]=2.101e-01 rel_first[3]=1.998e+00
  tok=2 node=cache_r_l4 occ=0 leg=A:gpu/B:gpu op=RESHAPE fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.433e-01 rel_sumabs=1.761e-03 rel_sumsq=1.534e-02 rel_first[2]=2.101e-01 rel_first[3]=1.998e+00
  tok=2 node=node_132 occ=0 leg=A:gpu/B:gpu op=GET_ROWS fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.433e-01 rel_sumabs=1.761e-03 rel_sumsq=1.534e-02 rel_first[2]=2.101e-01 rel_first[3]=1.998e+00
  tok=2 node=node_132 occ=1 leg=A:gpu/B:gpu op=RESHAPE fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.433e-01 rel_sumabs=1.761e-03 rel_sumsq=1.534e-02 rel_first[2]=2.101e-01 rel_first[3]=1.998e+00
  tok=2 node=cache_r_l4 occ=5 leg=A:gpu/B:gpu op=VIEW fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.433e-01 rel_sumabs=1.761e-03 rel_sumsq=1.534e-02 rel_first[2]=2.101e-01 rel_first[3]=1.998e+00
  tok=2 node=cache_r_l4 occ=6 leg=A:gpu/B:gpu op=CPY fields=sum,sumabs,sumsq,first[2],first[3] rel_sum=1.543e-01 rel_sumabs=1.802e-02 rel_sumsq=2.663e-02 rel_first[2]=1.998e+00 rel_first[3]=2.164e-01
only in A: 0 node lines
only in B: 0 node lines
summary: compared=5070 divergent=3979 not_compared_skip=200 only_in_A=0 only_in_B=0
```

### D-gpu1 vs D-agpu

Command, run from `/Users/marco/Projects/kalsallama-gov-loadstep`:
`python3 -I tools/governor-bench/compare-node-dumps.py RAW/D-gpu1_sa881544.dump RAW/D-agpu_sa881544.dump > /tmp/cmp1a.txt 2>&1; echo EXIT=$?`

Exit code: EXIT=1. Output (head -40):

```
input differs at tok=7
tok=0 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=sumsq,first[0],first[1],first[2],first[3] rel_sumsq=1.753e-03 rel_first[0]=1.807e-02 rel_first[1]=3.588e-03 rel_first[2]=1.229e-03 rel_first[3]=1.217e-03
tok=1 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=sumsq,first[0],first[2] rel_sumsq=1.137e-03 rel_first[0]=3.588e-03 rel_first[2]=1.217e-03
tok=2 first divergence: node=model.layers.{}.conv.in_proj-0 occ=0 leg=A:gpu/B:single op=MUL_MAT fields=first[1] rel_first[1]=1.365e-03
tok=3 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=first[3] rel_first[3]=1.336e-03
tok=4 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=first[2],first[3] rel_first[2]=1.336e-03 rel_first[3]=3.058e-02
tok=5 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=first[2] rel_first[2]=3.058e-02
tok=6 first divergence: node=cache_r_l0 occ=0 leg=A:gpu/B:single op=RESHAPE fields=first[1],first[3] rel_first[1]=1.411e-03 rel_first[3]=1.858e-03
10 largest relative differences (threshold 0.001, abs floor 1e-06):
  tok=0 node=cache_k_l2 occ=0 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l2 occ=0 leg=A:gpu/B:single op=RESHAPE fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l2 occ=1 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_k_l5 occ=0 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l5 occ=0 leg=A:gpu/B:single op=RESHAPE fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l5 occ=1 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_k_l9 occ=0 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l9 occ=0 leg=A:gpu/B:single op=RESHAPE fields=shape/type rel_shape/type=inf
  tok=0 node=cache_v_l9 occ=1 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
  tok=0 node=cache_k_l13 occ=0 leg=A:gpu/B:single op=SET_ROWS fields=shape/type rel_shape/type=inf
only in A: 0 node lines
only in B: 0 node lines
summary: compared=7042 divergent=6027 not_compared_skip=336 only_in_A=0 only_in_B=0
```

## Reading (coordinator, verified against the dumps)

- The defect reproduces on the QRD8650: the one-copy GPU leg fails 4/4 (KL mean 0.04-0.18), the NPU leg and the plain
  two-copy OpenCL load pass. So it is the Adreno 750 + this code path, not the Xiaomi unit.
- First nondeterministic node: `kqv-2` (MUL_MAT, f16 V x f32 softmax, ne=64,1,32) at token 0, the first attention layer.
  Its inputs are bit-identical across D-gpu1/D-gpu2 (`kq_soft_max-2`, `cache_v_l2` permute: same sum/sumsq/first);
  outputs agree on first[0..1] and differ on first[2..3]. D-gpu2's values match D-agpu's (the correct path).
- Why only the one-copy leg: its KV size is 768 == n_kv, so the permuted V view is contiguous (the dump has a sum for
  it; D-agpu, KV 2048, reports `skip=noncontiguous`). The Adreno kq/kqv arm requires `!ggml_is_contiguous(src0)`, so
  the op falls to the generic f16 decode branch: lane split, `ne00 = 768 > 256` -> `can_multi_out` ->
  `kernel_mul_mat_f16_f32_l4_y8` (ggml-opencl.cpp ~27150, kernels/mul_mv_f16_f32_l4.cl:476). Hypothesis, tested by
  cell #70: `GGML_OPENCL_MM_F16_FORCE_L4=1` (routes the op to `l4_dr`) passes.
- D-gpu1 vs D-agpu differ only at ~1e-3 relative (layer-0 conv, different KV size/path): fp noise, not the defect.
