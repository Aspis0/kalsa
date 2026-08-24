# q46 SESSION_LOG — S23 LFM2.5-8B-A1B B-prime Q8_0-trunk HTP v73 smoke

Protocol: REGISTRA+DICHIARA (declared conditions, dispatch proof; all t/s exploratory).
Device serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (always `-s` this; never Jelly Star / houji).
adb: `C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe`
Binary: `/data/local/tmp/kalsahtp` (same pins as `results/htp_smoke/s23_v73_bprime/`).
Env (HTP cells): `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_VERBOSE=1`, `GGML_HEXAGON_HOSTBUF` **unset**.
Driver: `scratchpad/agents/q46-lfm-bprime-smoke/phase2_driver.sh` (LF-only, CR=0), detached `setsid nohup` via `phase2_launch.sh`.
No git add/commit/push. Did not touch `BigMoeOnEdge/`. Deleted nothing on device or PC.

All timestamps UTC unless noted.

## 2026-08-24T12:36Z — cook complete (PC)

- `logs/lfm-bprime-cook.rc.txt` = `0`. `COOK_LFM_STATUS.txt` = `OK`.
- Detached cook PID 37404 (pwsh, started 08:28 local). Source download verified then `cook_model.py lfm q8_0`.
- Output: `scratchpad/agents/q37-bprime-from-source/gguf/lfm/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` **3580407296 B** (LastWriteTime 08:36:07).
- PC sha256 (Python hashlib, 8 MiB chunks): `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a`

## 2026-08-24T12:37Z — PC sanity (q8_0 vs control)

Full `verify_variants.py lfm` would FAIL because iq4_nl/q4_0 arms are no longer on disk. Equivalent check: `verify_q8_vs_control.py` (imports `load()` from q37).

- `ok=True`
- control bytes=3326160384 types=`Q5_K:47 F32:123 Q6_K:20 Q3_K:22 Q2_K:44`
- q8_0 bytes=3580407296 types=`Q8_0:67 F32:123 Q3_K:22 Q2_K:44`
- trunk_type_bad=0 leftover_kquant_on_trunk=0
- expert_sha256 match: `00ef935a4653e9e5086f8ff6d806ad7bae7b89f0148f95834c995df92198a946`
- expert tensors Q2_K/Q3_K, byte-identical to control. Cook accepted.

## 2026-08-24T12:40Z — device probe (no llama, gates)

- `adb devices -l`: S23 `SM_S911U` / `dm1q` on the TLS serial. Jelly Star and houji also attached — ignored.
- No `llama` process.
- Battery: level=83 then 82 at launch, temperature=252–275 (25.2–27.5 °C), AC/USB/Wireless/Dock powered=false. Unplugged declared.
- Gates: batt >= 40 %, start temp <= 35.0 °C — PASS.
- `/data` avail 16G before push, 12G after. MemTotal **7243744 kB = 7074 MiB**.
- Pre-existing (left untouched): Marco B-prime 6509642624 B, shipped LFM KEXP 3326160384 B, Marco i1-Q4_K_M ~10G.

## 2026-08-24T12:43Z — push + on-device sha

- `adb push --sync` 3580407296 B in 309.467 s (11.0 MB/s) → `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf`
- On-device `sha256sum`: `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` **MATCH** pin.
- Marco B-prime still present (6509642624 B).

## 2026-08-24T12:48:26Z — launch

- Scripts pushed, `tr -d '\r'`, CR_driver=0 CR_launch=0, chmod 755.
- Launch pid **22999** (`setsid nohup sh phase2_driver.sh`).
- Log grew immediately. STATUS `STARTING`. Model sha re-verified on device.
- Header battery: level=82, temperature=275 (27.5 °C), unplugged.
- Binary pins MATCH v73 (`stub=5db18906…`, `hexagon=f06aa309…`, `htp_v73=c8f9d14a…`).

### (a) pp16/tg8 -v HTP0 — PASS

- Cool-start PASS temp10=272. Launch 12:48:32Z. rc=0 at 12:48:39Z.
- jsonl non-garbage: 2 `avg_ts` rows. backends=`HTP`, devices=`HTP0`, `n_gpu_layers=99`, `flash_attn=1`, model_type=`lfm2moe 8B.A1B Q8_0`.
- Exploratory: pp16 **42.61 t/s**; tg8 **5.93 t/s**.
- **execute-op proof**: n_htp=4633, n_attn=228, n_shortconv=486.
  Sample: `ggml-hex: HTP0 execute-op MUL_MAT|blk.2.attn_q.weight … |q8_0 x f32 -> f32| … |HTP0-REPACK x HTP0 -> HTP0|hmx-tiled`. Same for `attn_k`/`attn_v`/`attn_output` on attn layers 2,6,10,14,18,22 (hybrid 6 attn / 18 shortconv).
- Zero HTP `execute-op` on `ffn_gate_exps` / `ffn_up_exps` / `ffn_down_exps` (experts stay CPU). Router `ffn_moe_*` + `ffn_gate_inp` **do** run on HTP0.
- Load-time buffer split (`load_tensors`):

| buft | MiB |
|---|---:|
| CPU | 2941.38 |
| CPU_REPACK | 265.62 |
| HTP0 | 6.31 |
| HTP0-REPACK | 459.00 |
| **sum** | **3672.31** |

- `offloaded 25/25 layers to GPU`. Fit **yes** vs MemTotal 7074 MiB (Marco B-prime was CPU 5995.65 + HTP0-REPACK 178.50 and never generated).
- llama-bench RSS during later cells ~3.3–3.8 GiB.

### (b) pp512 + tg128, 2 reps, HTP — PASS (exploratory)

- Cool-start PASS level=82 temp10=272. Launch 12:48:40Z. rc=0 at 12:49:35Z.
- jsonl: pp512 **58.43 t/s** (57.02 / 59.85); tg128 **10.63 t/s** (10.21 / 11.05). backends=`HTP`, devices=`HTP0`, `n_gpu_layers=99`.
- No `-v` on this cell → empty `b_buffer_split.txt`. Split recorded from (a).

### (c) same-harness CPU-only (`-ngl 0`) — PASS (exploratory)

- Cool-start PASS level=81 temp10=319 (31.9 °C). Launch 12:49:35Z. rc=0 at 12:50:43Z.
- Same `kalsahtp/llama-bench`, `--load-mode none -fa on --ubatch-size 1024`, HEXAGON_NDEV unset.
- jsonl: `n_gpu_layers=0`, `devices=auto`. Still `gpu_info=Hexagon` / `backends=HTP` because this stub always enumerates Hexagon; c_stderr shows `HTP0 allocating new session` even at ngl 0. Layers were **not** offloaded. Same-harness convention, declared.
- Exploratory: pp512 **51.08 t/s** (51.75 / 50.40); tg128 **16.97 t/s** (17.51 / 16.43).

## 2026-08-24T12:50:43Z — session end

- STATUS `DONE a_rc=0 b_rc=0 c_rc=0 n_htp=4633 n_attn=228`
- No leftover llama.
- Battery end: level=80, temperature=344 (34.4 °C), unplugged. Drain 82→80.
- Pull 50 files (8514169 B) → `results/htp_smoke/s23_v73_lfm_bprime/device/kalsa_q46/`.
- GGUF left on device. Marco B-prime left on device. No deletions.
