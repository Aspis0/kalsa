# P5 device evidence

- `device-sha256.md`: on-device hashes verified before P5.
- `p5-small-htp-kld.log.gz`: exact command from the report, `EXIT=0`, mean KLD 0.002750 ± 0.000165, maximum 0.031080, same-top 97.059%.
- `p5-small-htp-kld-v.log.gz`: same arm with `-lv 5` so debug execute-op messages are visible; `EXIT=0`, HTP0:0 `MUL_MAT` count 1080, identical KLD output.
- `opset.sh` at ubatch 128: after removing Q0's `MUL_MAT result_output` (4 lm-head matmuls), `diff` returned 0. `ADD l_out` count is 236 in both Q0 and P5.
- Verbose trace shows HTP0:0 executing `MUL` for `attn_norm`, `SSM_CONV` with `shortconv.conv.weight`, and flat Q4_0 `MUL_MAT` reading `HTP0:0-HOST` weights.
- Both runs: screen Awake before/after, AC powered, battery 100%, thermal status 0, traced 0, app force-stopped. Temperature was 31.8 °C at preflight and 35.4 °C after the verbose run. No DSP error, NO-SUPPORT, or abort.
