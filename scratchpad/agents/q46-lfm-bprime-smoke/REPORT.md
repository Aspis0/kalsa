# q46 REPORT — LFM2.5-8B-A1B B-prime HTP v73 smoke on S23

REGISTRA+DICHIARA. All t/s exploratory. Raw: `results/htp_smoke/s23_v73_lfm_bprime/`.

## Verdict

**Fit: yes.** First KEXP-class B-prime that actually generates on the S23 NPU path. (a)(b)(c) all rc=0. HTP0 execute-op proof on Q8_0 attn matmuls. Marco B-prime (6.5 GiB) previously died in `load_all_data` with 0 execute-op.

## Pins

- Model `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` 3580407296 B, sha256 `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` (PC hashlib = on-device sha256sum).
- Experts byte-identical to control (`expert_sha256=00ef935a4653e9e5086f8ff6d806ad7bae7b89f0148f95834c995df92198a946`). Trunk Q8_0 (67 tensors), experts Q2_K/Q3_K.
- kalsahtp v73 pins unchanged: stub `5db18906…` / hexagon `f06aa309…` / htp-v73 `c8f9d14a…`.
- Env: NDEV=1 VERBOSE=1 HOSTBUF unset (llama-bench path). Serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.

## Buffer split (load-time, from (a) `-v`)

offloaded 25/25. MemTotal 7074 MiB.

| buft | MiB |
|---|---:|
| CPU | 2941.38 |
| CPU_REPACK | 265.62 |
| HTP0 | 6.31 |
| HTP0-REPACK | 459.00 |
| sum | 3672.31 |

Experts on CPU (~2.9 GiB) + trunk on HTP0-REPACK (459 MiB), as expected for hybrid LFM (6 attn + 18 shortconv).

## execute-op proof (a)

- HTP0 execute-op lines: **4633**
- attn Q/K/V/O name match: **228** — e.g. `HTP0 execute-op MUL_MAT|blk.2.attn_q.weight … q8_0 … HTP0-REPACK x HTP0 -> HTP0|hmx-tiled` (layers 2/6/10/14/18/22).
- shortconv: 486 (desk-eligible; observed on HTP).
- `ffn_*_exps` expert weights: **0** HTP execute-op (CPU). Router `ffn_moe_*` runs on HTP0.

## Exploratory t/s (same harness, kalsahtp llama-bench)

| cell | pp512 | tg128 |
|---|---:|---:|
| (b) HTP `-ngl 99 -dev HTP0` -r 2 | 58.43 | 10.63 |
| (c) CPU `-ngl 0` -r 2 | 51.08 | 16.97 |

(a) sanity: pp16 42.61 / tg8 5.93 (1 rep, no warmup).

HTP wins prefill; CPU wins tg in this cell. Not a ship number.

## Battery

Unplugged throughout. Start 82 % / 27.5 °C; after (b) 81 % / 31.9 °C; end 80 % / 34.4 °C. Gates held.

## Anomalies / declarations

1. **(c) is `-ngl 0` on the HTP-linked stub**, not a CPU-only build. Hexagon still opens an HTP0 session (`HTP0 allocating new session`); jsonl still reports `backends=HTP`. `n_gpu_layers=0` is the offload proof.
2. (b)/(c) had no `-v`, so buffer split is from (a) only.
3. Device still holds Marco B-prime 6.5 GiB and shipped LFM KEXP 3.1 GiB — not deleted.
4. iq4_nl/q4_0 LFM arms were already gone from the cook dir; sanity was q8_0 vs control only.

No leftover llama. No git. No BigMoeOnEdge touch.
