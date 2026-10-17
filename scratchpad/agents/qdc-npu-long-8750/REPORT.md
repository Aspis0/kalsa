# REPORT — NPU long-prompt drift on Snapdragon 8 Elite (QRD8750 / SM8750, Hexagon v79), QDC

Cell: `qdc-npu-long-8750`. Date 2026-10-17 (EDT). Question: is the 8 Elite affected by the NPU prefill drift
that the S23 (Hexagon v73) shows past ~1030 positions (`s23-oracle-m5` §10–§13: 21/32 top-1 disagreements at 2175 positions)?

## VERDICT

**v79 is not affected the way S23 is: at 2005 positions the NPU prefill flipped 0 of 32 top-1 tokens against the
same-board CPU reference. Its logits still breach the R2 band (max dlogp 1.44, max dp1 0.067), so it is not clean either.
One pair, one prompt; this does not settle the ≤1030 side.**

- The R5 cell's CPU reference could not be reused across boards (see below); the verdict uses the same-board control C2long.
- Oracle lines verbatim (unmodified `oracle_logit.py`, TF, thresholds 0.03 / 0.02 / 0.10):

```
oracle=FAIL rule=R2 steps=32 max_dlogp=1.4396 max_dp1=0.0674 divergences=0 first_div=-1     (pair 1: C2long vs N1long, same board — the valid pair)
oracle=FAIL rule=R2 steps=32 max_dlogp=1.3735 max_dp1=0.0832 divergences=0 first_div=-1     (pair 2: A2long vs N1long, cross-board reference — not valid for the verdict)
oracle=FAIL rule=R2 steps=32 max_dlogp=0.6098 max_dp1=0.0330 divergences=0 first_div=-1     (control: A2long vs C2long, CPU vs CPU on different boards)
```

## TABLE (enc-long, 2005 positions, teacher-forced to A2long's 32 ids, steps 0–31)

| pair | reference | comparable steps | top-1 disagree | max \|Δlogp\| CPU top-1 | max dp1 | R1 steps | oracle verdict |
|---|---|---|---|---|---|---|---|
| N1long vs C2long (**valid**) | C2long: CPU, same board, governor off | 32 | **0 / 32** | 1.440 | 0.067 | none | see line 1 above |
| N1long vs A2long | A2long: R5 CPU, other board | 32 | 0 / 32 | 1.373 | 0.083 | none | see line 2 above |
| C2long vs A2long (control) | CPU vs CPU, two boards | 32 | 0 / 32 | 0.610 | 0.033 | none | see line 3 above |
| S23 reference (for scale) | `s23-oracle-m5` §13 `h0` | 32 | 21 / 32 | 6.664 | 0.784 | — | `FAIL … max_dlogp=6.6642` |

Per-step tables: `raw/sa903672/steps-C2long-vs-N1long.txt`, `steps-A2long-vs-N1long.txt`, `steps-A2long-vs-C2long.txt`.
Top-1 counts were taken from the table fields `A1=`/`B1=` by parsing each field (`top1_disagree` 0 in both).

## ROUTE — NPU PREFILL CONFIRMED

Arm N1long, the default governor, no `governor_force`, no `npu_lane`, no `route`, no `thermo` (S23 kind H recipe):

```
KALSA_GOVERNOR {"engine_prefill":"NPU","engine_decode":"CPU", … "prefill_chunks":"128+128+128+126+512+512+128+128+128+84+3","prefill_ctx_ngl":99,"forced":false, … "thermo_source":"battery","fit":"Fit","npu_device":"HTP0","npu_fallback":null, … "route_requested":"auto","route_mode":"auto","route_push":"applied" …}
KALSA_GOVERNOR_PLAN {… "npu_device":"HTP0","npu_fallback":null,"npu_lane":"auto","npu_fit":"Fit", … "npu_price":"with_gpu","gpu_leg":true}
KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}
fastrpc: Successfully opened file …/app_rnllama-htp/./libggml-htp-v79.so   (remote handle64_open ok)
```

Prefill chunks sum to 2005 (= `prompt_n`). Decode ran on CPU (`decode_tokens_cpu:32`). **Prefill ran on the HTP (v79).**

## WHY THE CPU REFERENCE WAS NOT REUSED

The user brief allowed reusing R5 `A2long`, provided the APK, model and prompt were identical. They are identical
(APK `1e27ba67…`, model `a247afd6…`, `enc-long.txt` `81d91081…`, also the same as S23). But the board is not:
R5 ran on `sa903081`, this run on `sa903672`. The control C2long (CPU, same board) vs A2long gives
`FAIL R2`, max dlogp 0.61, max dp1 0.033, with 0/32 top-1 disagreements. So a CPU reference from another
board differs by about half the NPU's logit drift. R5's CPU-vs-CPU was bit-identical **on one board**; cross-board is not.
Therefore the verdict is taken against C2long, and A2long is shown for transparency only.

## NOT RUN (per brief)

- Short control (595 tokens, NPU vs CPU): **not run**. The brief's condition was "only if NPU is broken". The NPU
  flipped no top-1 tokens, so it was not treated as broken. This is the next thing to run if the ≤1030 question matters.
- Replicate of N1long: not run. n = 1 NPU pair. Determinism of the NPU route is unknown.

## SESSION / BOARD

| field | value |
|---|---|
| portal | qdc.qualcomm.com, already logged in, no credential or 2FA prompt |
| session | **899603** `oracle-npu-long-8elite`, Snapdragon 8 Elite / QRD8750 Mobile Reference Design, Android 16, SSH only, Screen Always On, max 90 min |
| queue | Submitted 4:21:41, Setup, then **Running at 4:23:17** (device assigned by the portal, no wait beyond ~2 min) |
| device | serial `57dd7911`, `ro.soc.model=SM8750`, `ro.product.device=sun`, device host `sa903672.sa.svc.cluster.local:5037` |
| tunnel | `ssh -o BatchMode=yes -i ~/.ssh/qdc_ed25519 -L 6037:sa903672.sa.svc.cluster.local:5037 -N sshtunnel@ssh.qdc.qualcomm.com`, listener on 6037 |
| prior 6037 holder | stray local adb server, pid 84740, killed by the owner before the tunnel |
| install | APK `1e27ba67…` (sha verified on the Mac before install), `Success`, `DEBUGGABLE` |
| model on device | `a247afd6…`, sha OK on device, size 1593894944 = expected |
| battery | faked unplugged 30.0 C for the run (as R5), read back, `dumpsys battery reset` after the run |
| skin | live HAL entry #2 (`skin-index.txt`). Peak skin: N1long 33.0 C, C2long 36.8 C. Stop line 48.0 C never reached. Watchdog KILL 0 in both |
| crashes | 0 (`N1long-crash.txt`, `C2long-crash.txt`). LMK lines are unrelated system kills (`devicelockcontroller`, lmkd), none for `com.kalsa.app` |

## ARMS RUN

| label | kind | keys | prompt | probs rows | ids | wall |
|---|---|---|---|---|---|---|
| N1long | NPU (S23 kind H) | governor on, `force_ids`=A2long ids; no `governor_force`, `npu_lane`, `route`, `thermo` | long, 2005 | 33 | 32 (tokens-line) | 45 s send→telemetry |
| C2long | CTRL CPU | governor off, `force_ids`=A2long ids | long, 2005 | 33 | 32 (tokens-line) | 50 s |
| A2long | reused R5 CPU | — (R5 `raw/sa903081`, copied as-is) | long, 2005 | 661 | 32 | — |

Both turns' ids match A2long's 32 ids (`cmp` identical for N1long). `arm_exit=0` for both.

## CLEANUP

- 12 bench and app keys deleted, each read back `ABSENT` (`cleanup-keys.txt`, `kmulti.sh` exit 0).
- `dumpsys battery reset`, `svc power stayon false` (`battery-reset.txt`). Real battery temperature read 450 after reset.
- Session 899603: ended in the portal via End Session → Yes (the "Create Snapshot" option was not used). Status
  **Completed**, Ended On 10/17/26 4:41:01 AM. The portal's "Total Minutes Used" reads **0**; the session ran ~18 min
  (4:23:17 → 4:41:01). Taken as displayed, not verified against billing.
- SSH tunnel: killed (pid 44188, verified as the `ssh -L 6037:sa903672…` process before the kill). `lsof` on 6037 is empty.

## FILES

- Scripts (copied from the R5 cell, `oracle_logit.py` unmodified, sha `685c7a08…`): `setup.sh`, `arm.sh`, `turn.sh`, `kmulti.sh`, `kset.sh`, `oparse.sh`, `oracle.sh`, `steps.py`, `skin-id.sh`, `wipe-chats.sh`, `env.sh` (`LAB` repointed to this cell only).
- Raw: `raw/sa903672/` (per-turn `*-kalsa.txt`, `*-probs.jsonl`, `*-ids.txt`, `*-watchdog.txt`, `*-hexlog.txt`, oracle and steps output, `setup-run.log`, `recon.txt`, `install.txt`, `pkg.txt`, `skin-samples.txt`, `cleanup-keys.txt`, `battery-reset.txt`).
- Reused R5 CPU files: `raw/sa903672/A2long-*` (copy of `qdc-oracle-r5-8750/raw/sa903081/A2long-*`).
