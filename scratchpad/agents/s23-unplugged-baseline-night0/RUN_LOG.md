# RUN_LOG — s23-unplugged-baseline-night0

Protocol: PREREG.md (locked). Base: ../s23-plugged-baseline/{PREREG,PINNED_SET,CERT_DAY0}.md.
Transport: `adb -s 192.168.1.152:36329` only. Jelly (192.168.1.82:34037) not addressed.
Guard: q56 thermal_guard.sh WARN 40 / KILL 43 / poll 10 s. Reconnect: same IP:port only.

## Preflight (before first cell)

`adb devices -l`:
- `192.168.1.152:36329 device product:dm1qsqw model:SM_S911U` ONLINE
- `192.168.1.82:34037` present (Jelly); not touched

dumpsys battery (preflight):
- AC powered: false
- USB powered: false
- Wireless powered: false
- Dock powered: false
- status: 3
- level: 100
- temperature: 289 (28.9 °C)
- voltage: 4339

Screen: mWakefulness=Dozing

Idle temp 28.9 °C ≤ 32 °C → cool_start_class=cool. Battery 100% ≥ 45%. Unplugged declared.

### s3oracle 11-file device SHA-256 vs PINNED_SET.md

All 11 MATCH (device sha authoritative):

| file | bytes | sha256 |
|---|---:|---|
| test-backend-ops | 10182432 | 9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc |
| llama-bench | 7600 | b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c |
| libllama-bench-impl.so | 4253160 | 8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807 |
| libggml-opencl.so | 8376320 | f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d |
| libggml.so | 536880 | 3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27 |
| libggml-base.so | 6103496 | ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c |
| libggml-cpu.so | 5165056 | fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da |
| libllama.so | 39807624 | f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d |
| libllama-common.so | 78377240 | e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200 |
| libc++_shared.so | 1794776 | e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6 |
| libomp.so | 1229304 | ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0 |

### Models

| file | bytes | sha256 |
|---|---:|---|
| /data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf | 4213513024 | 3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe |
| /data/local/tmp/Marco-Mini-Instruct-KEXP.gguf | 6385238848 | 2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777 |

adb-shell cpuset preflight: nproc=7, Cpus_allowed_list=0-7, cpuset=/, online=0-7. Gate threshold nproc>=6 / bits>=6.

Note: `llama-bench -h` (flag check) initialized OpenCL Adreno 740; not a speed cell.

## Execution

Wall start follows. Guard on every invocation. ABBA = A,C,C,A. Cool-start ≤32 °C per block.

2026-08-28T00:40:31 cool-start wait for cert_mmid (gate <=32C)
2026-08-28T00:40:31   poll level=100 temp=28.6C
2026-08-28T00:40:31 START cert_mmid MUL_MAT_ID
2026-08-28T00:45:39 END cert_mmid pass=True rc=0 guard=0 abort=
2026-08-28T00:45:39 cool-start wait for cert_mm (gate <=32C)
2026-08-28T00:45:39   poll level=99 temp=31.2C
2026-08-28T00:45:39 START cert_mm MUL_MAT
2026-08-28T00:52:20 END cert_mm pass=True rc=0 guard=None abort=
2026-08-28T00:52:20 cool-start wait for kexp_pp512_b1 (gate <=32C)
2026-08-28T00:52:20   poll level=98 temp=33.4C
2026-08-28T00:52:35   poll level=98 temp=33.1C
2026-08-28T00:52:50   poll level=98 temp=32.8C
2026-08-28T00:53:06   poll level=98 temp=32.6C
2026-08-28T00:53:22   poll level=98 temp=32.4C
2026-08-28T00:53:37   poll level=98 temp=32.2C
2026-08-28T00:53:52   poll level=98 temp=32.1C
2026-08-28T00:54:07   poll level=98 temp=31.9C
2026-08-28T00:54:07 START kexp_pp512_b1_1_A ngl=99 pp512
2026-08-28T00:54:07 FAIL (host) uncaught subprocess.TimeoutExpired on `adb connect 192.168.1.152:36329` (20 s) inside launch_one.ensure_transport during first poll of the speed cell. Python session rc=1. No llama-bench jsonl. Cell invalid.
2026-08-28T00:54:xx dumpsys/get-state: `error: device offline`. Device still listed `192.168.1.152:36329 offline`. Jelly still `device` — not touched.
2026-08-28 reconnect budget: 40× `adb connect 192.168.1.152:36329` over 600 s, every attempt `Connection refused`. No pair, no kill-server, no other serial, no other port.
2026-08-28 after 10 min: S23 gone from `adb devices -l`; only Jelly remains. STOP BLOCKED (ADB loss). Correctness 407/407 and 925/925 stand. Speed matrix: 0 completed ABBA blocks.

Note: cert_mm live guard_rc read was None; pulled `raw/cert_mm.guard_rc` is `0` and guard log has MAX (no WARN/KILL). Host/read race, not a guard kill.

Note: binary cpuset on both cert cells was `0-5,7` (bits=7, cpuset=/). Gate ≥6 PASS. Harness was `0-7`.

No deletions on device. Tiny helpers pushed under `/data/local/tmp/s23_unplugged_night0/` (LF). Leftover on-device supervisor for `kexp_pp512_b1_1_A` (if any) could not be reaped — transport already dead.
2026-08-28T07:48:02 RESUME serial=192.168.1.152:37687 loaded_manifest_rows=3; skip correctness (already PASS)
2026-08-28T07:48:02 cool-start wait for kexp_tg128_b1 (gate <=32C)
2026-08-28T07:48:03   poll level=89 temp=33.5C
2026-08-28T07:48:18   poll level=89 temp=33.5C
2026-08-28T07:48:33   poll level=88 temp=33.7C
2026-08-28T07:48:48   poll level=88 temp=33.7C
2026-08-28T07:49:03   poll level=88 temp=33.9C
2026-08-28T07:49:18   poll level=88 temp=33.9C
2026-08-28T07:49:33   poll level=88 temp=34.1C
2026-08-28T07:49:49   poll level=88 temp=34.1C
2026-08-28T07:50:04   poll level=88 temp=34.3C
2026-08-28T07:50:19   poll level=88 temp=34.3C
2026-08-28T07:50:34   poll level=88 temp=34.5C
2026-08-28T07:50:49   poll level=88 temp=34.5C
2026-08-28T07:51:04   poll level=88 temp=34.7C
2026-08-28T07:51:20   poll level=88 temp=34.7C
2026-08-28T07:51:35   poll level=88 temp=34.9C
2026-08-28T07:51:50   poll level=88 temp=34.9C
2026-08-28T07:52:05   poll level=88 temp=35.0C
2026-08-28T07:52:20   poll level=88 temp=35.0C
2026-08-28T07:52:35   poll level=87 temp=35.2C
2026-08-28T07:52:50   poll level=87 temp=35.2C
2026-08-28T07:53:06   poll level=87 temp=35.4C
2026-08-28T07:53:21   poll level=87 temp=35.4C
2026-08-28T07:53:36   poll level=87 temp=35.5C
2026-08-28T07:53:51   poll level=87 temp=35.5C
2026-08-28T07:54:06   poll level=87 temp=35.7C
2026-08-28T07:54:21   poll level=87 temp=35.7C
2026-08-28T07:54:36   poll level=87 temp=35.9C
2026-08-28T07:54:52   poll level=87 temp=35.9C
2026-08-28T07:55:07   poll level=87 temp=36.0C
2026-08-28T07:55:22   poll level=87 temp=36.2C
2026-08-28T07:55:37   poll level=87 temp=36.2C
2026-08-28T07:55:52   poll level=87 temp=36.3C
2026-08-28T07:56:07   poll level=87 temp=36.3C
2026-08-28T07:56:23   poll level=86 temp=36.4C
2026-08-28T07:56:38   poll level=86 temp=36.4C
2026-08-28T07:56:53   poll level=86 temp=36.5C
2026-08-28T07:57:08   poll level=86 temp=36.5C
2026-08-28T07:57:23   poll level=86 temp=36.6C
2026-08-28T07:57:38   poll level=86 temp=36.6C
2026-08-28T07:57:53   poll level=86 temp=36.7C
2026-08-28T07:58:09   poll level=86 temp=36.7C
2026-08-28T07:58:24   poll level=86 temp=36.8C
2026-08-28T07:58:39   poll level=86 temp=36.8C
2026-08-28T07:58:54   poll level=86 temp=36.8C
2026-08-28T07:59:09   poll level=86 temp=36.8C
2026-08-28T07:59:24   poll level=86 temp=36.9C
2026-08-28T07:59:39   poll level=86 temp=36.9C
2026-08-28T07:59:54   poll level=86 temp=37.0C
2026-08-28T08:00:10   poll level=86 temp=37.0C
2026-08-28T08:00:25   poll level=85 temp=37.0C
2026-08-28T08:00:40   poll level=85 temp=37.0C
2026-08-28T08:00:55   poll level=85 temp=37.1C
2026-08-28T08:01:10   poll level=85 temp=37.1C
2026-08-28T08:01:25   poll level=85 temp=37.2C
2026-08-28T08:01:41   poll level=85 temp=37.2C
2026-08-28T08:01:56   poll level=85 temp=37.2C
2026-08-28T08:02:11   poll level=85 temp=37.2C
2026-08-28T08:02:26   poll level=85 temp=37.3C
2026-08-28T08:02:41   poll level=85 temp=37.3C
2026-08-28T08:02:56   poll level=85 temp=37.4C
2026-08-28T08:03:11   poll level=85 temp=37.4C
2026-08-28T08:03:27   poll level=85 temp=37.5C
2026-08-28T08:03:42   poll level=85 temp=37.5C
2026-08-28T08:03:57   poll level=85 temp=37.5C
2026-08-28T08:04:12   poll level=85 temp=37.5C
2026-08-28T08:04:27   poll level=85 temp=37.6C
2026-08-28T08:04:42   poll level=85 temp=37.6C
2026-08-28T08:04:57   poll level=84 temp=37.6C
2026-08-28T08:05:13   poll level=84 temp=37.6C
2026-08-28T08:05:28   poll level=84 temp=37.7C
2026-08-28T08:05:43   poll level=84 temp=37.7C
2026-08-28T08:05:58   poll level=84 temp=37.8C
2026-08-28T08:06:13   poll level=84 temp=37.8C
2026-08-28T08:06:28   poll level=84 temp=37.8C
2026-08-28T08:06:44   poll level=84 temp=37.8C
2026-08-28T08:06:59   poll level=84 temp=37.9C
2026-08-28T08:07:14   poll level=84 temp=37.9C
2026-08-28T08:07:29   poll level=84 temp=37.9C
2026-08-28T08:07:44   poll level=84 temp=37.9C
2026-08-28T08:07:59   poll level=84 temp=38.0C
2026-08-28T08:08:14   poll level=84 temp=38.0C
2026-08-28T08:08:30   poll level=84 temp=38.1C
2026-08-28T08:08:45   poll level=84 temp=38.1C
2026-08-28T08:09:00   poll level=84 temp=38.1C
2026-08-28T08:09:15   poll level=84 temp=38.1C
2026-08-28T08:09:30   poll level=83 temp=38.2C
2026-08-28T08:09:45   poll level=83 temp=38.2C
2026-08-28T08:10:01   poll level=83 temp=38.2C
2026-08-28T08:10:16   poll level=83 temp=38.2C
2026-08-28T08:10:31   poll level=83 temp=38.3C
2026-08-28T08:10:46   poll level=83 temp=38.3C
2026-08-28T08:11:01   poll level=83 temp=38.3C
2026-08-28T08:11:16   poll level=83 temp=38.3C
2026-08-28T08:11:31   poll level=83 temp=38.3C
2026-08-28T08:11:47   poll level=83 temp=38.3C
2026-08-28T08:12:02   poll level=83 temp=38.3C
2026-08-28T08:12:17   poll level=83 temp=38.3C
2026-08-28T08:12:32   poll level=83 temp=38.4C
2026-08-28T08:12:47   poll level=83 temp=38.4C
2026-08-28T08:13:02   poll level=83 temp=38.5C
2026-08-28T08:13:18   poll level=83 temp=38.5C
2026-08-28T08:13:33   poll level=83 temp=38.6C
2026-08-28T08:13:48   poll level=83 temp=38.6C
2026-08-28T08:14:03   poll level=82 temp=38.8C
2026-08-28T08:14:18   poll level=82 temp=38.8C
2026-08-28T08:14:33   poll level=82 temp=38.9C
2026-08-28T08:14:48   poll level=82 temp=38.9C
2026-08-28T08:15:04   poll level=82 temp=38.9C
2026-08-28T08:15:19   poll level=82 temp=38.9C
2026-08-28T08:15:34   poll level=82 temp=38.9C
2026-08-28T08:15:49   poll level=82 temp=38.9C
2026-08-28T08:16:04   poll level=82 temp=38.9C
2026-08-28T08:16:19   poll level=82 temp=38.9C
2026-08-28T08:16:35   poll level=82 temp=38.9C
2026-08-28T08:16:50   poll level=82 temp=38.9C
2026-08-28T08:17:05   poll level=82 temp=38.9C
2026-08-28T08:17:20   poll level=82 temp=38.9C
2026-08-28T08:17:35   poll level=82 temp=38.9C
2026-08-28T08:17:50   poll level=82 temp=38.9C
2026-08-28T08:18:06   poll level=82 temp=38.9C
2026-08-28T08:18:21   poll level=82 temp=38.9C
2026-08-28T08:18:36   poll level=81 temp=38.9C
2026-08-28T08:18:51   poll level=81 temp=38.9C
2026-08-28T08:19:06   poll level=81 temp=38.9C
2026-08-28T08:19:21   poll level=81 temp=38.9C
2026-08-28T08:19:37   poll level=81 temp=38.8C
2026-08-28T08:19:52   poll level=81 temp=38.8C
2026-08-28T08:20:07   poll level=81 temp=38.8C
2026-08-28T08:20:22   poll level=81 temp=38.8C
2026-08-28T08:20:37   poll level=81 temp=38.8C
2026-08-28T08:20:52   poll level=81 temp=38.8C
2026-08-28T08:21:07   poll level=81 temp=38.8C
2026-08-28T08:21:23   poll level=81 temp=38.8C
2026-08-28T08:21:38   poll level=81 temp=38.8C
2026-08-28T08:21:53   poll level=81 temp=38.8C
2026-08-28T08:22:08   poll level=81 temp=38.8C
2026-08-28T08:22:23   poll level=81 temp=38.8C
2026-08-28T08:22:38   poll level=81 temp=38.8C
2026-08-28T08:22:54   poll level=81 temp=38.8C
2026-08-28T08:23:09   poll level=80 temp=38.8C
2026-08-28T08:23:24   poll level=80 temp=38.8C
2026-08-28T08:23:39   poll level=80 temp=38.8C
2026-08-28T08:23:54   poll level=80 temp=38.8C
2026-08-28T08:24:09   poll level=80 temp=38.8C
2026-08-28T08:24:24   poll level=80 temp=38.8C
2026-08-28T08:24:40   poll level=80 temp=38.8C
2026-08-28T08:24:55   poll level=80 temp=38.8C
2026-08-28T08:25:10   poll level=80 temp=38.8C
2026-08-28T08:25:25   poll level=80 temp=38.8C
2026-08-28T08:25:40   poll level=80 temp=38.8C
2026-08-28T08:25:55   poll level=80 temp=38.9C
2026-08-28T08:26:11   poll level=80 temp=38.9C
2026-08-28T08:26:26   poll level=80 temp=38.9C
2026-08-28T08:26:41   poll level=80 temp=38.9C
2026-08-28T08:26:56   poll level=80 temp=38.9C
2026-08-28T08:27:11   poll level=80 temp=38.9C
2026-08-28T08:27:26   poll level=79 temp=38.9C
2026-08-28T08:27:41   poll level=79 temp=38.9C
2026-08-28T08:27:57   poll level=79 temp=39.0C
2026-08-28T08:28:14   poll level=79 temp=39.0C
2026-08-28T08:29:11   poll level=79 temp=39.0C
2026-08-28T08:29:26   poll level=79 temp=39.0C
2026-08-28T08:29:41   poll level=79 temp=39.0C
2026-08-28T08:29:56   poll level=79 temp=39.0C
2026-08-28T08:30:12   poll level=79 temp=39.0C
2026-08-28T08:30:27   poll level=79 temp=39.0C
2026-08-28T08:30:42   poll level=79 temp=39.0C
2026-08-28T08:30:57   poll level=79 temp=39.0C
2026-08-28T08:31:12   poll level=79 temp=39.0C
2026-08-28T08:31:27   poll level=79 temp=38.9C
2026-08-28T08:31:42   poll level=79 temp=38.9C
2026-08-28T08:31:58   poll level=79 temp=38.9C
2026-08-28T08:32:13   poll level=79 temp=38.9C
2026-08-28T08:32:28   poll level=78 temp=38.9C
2026-08-28T08:32:43   poll level=78 temp=38.9C
2026-08-28T08:32:58   poll level=78 temp=38.9C
2026-08-28T08:33:13   poll level=78 temp=38.9C
2026-08-28T08:33:28   poll level=78 temp=38.9C
2026-08-28T08:33:44   poll level=78 temp=38.9C
2026-08-28T08:33:59   poll level=78 temp=38.9C
2026-08-28T08:34:14   poll level=78 temp=38.9C
2026-08-28T08:34:29   poll level=78 temp=38.9C
2026-08-28T08:34:44   poll level=78 temp=38.9C
2026-08-28T08:34:59   poll level=78 temp=38.9C
2026-08-28T08:35:15   poll level=78 temp=38.9C
2026-08-28T08:35:30   poll level=78 temp=39.0C
2026-08-28T08:35:45   poll level=78 temp=39.0C
2026-08-28T08:36:00   poll level=78 temp=39.0C
2026-08-28T08:36:15   poll level=78 temp=39.0C
2026-08-28T08:36:30   poll level=78 temp=38.9C
2026-08-28T08:36:45   poll level=78 temp=38.9C
2026-08-28T08:37:00   poll level=78 temp=38.9C
2026-08-28T08:37:16   poll level=78 temp=38.9C
2026-08-28T08:37:31   poll level=78 temp=38.9C
2026-08-28T08:37:46   poll level=78 temp=38.9C
2026-08-28T08:38:01   poll level=77 temp=38.9C
2026-08-28T08:38:16   poll level=77 temp=38.9C
2026-08-28T08:38:31   poll level=77 temp=39.0C
2026-08-28T08:38:46   poll level=77 temp=39.0C
2026-08-28T08:39:02   poll level=77 temp=39.0C
2026-08-28T08:39:17   poll level=77 temp=39.0C
2026-08-28T08:39:32   poll level=77 temp=39.0C
2026-08-28T08:39:47   poll level=77 temp=39.0C
2026-08-28T08:40:02   poll level=77 temp=38.9C
2026-08-28T08:40:17   poll level=77 temp=38.9C
2026-08-28T08:40:33   poll level=77 temp=38.9C
2026-08-28T08:40:48   poll level=77 temp=38.9C
2026-08-28T08:41:03   poll level=77 temp=38.9C
2026-08-28T08:41:18   poll level=77 temp=38.9C
2026-08-28T08:41:33   poll level=77 temp=38.9C
2026-08-28T08:41:48   poll level=77 temp=38.9C
2026-08-28T08:42:03   poll level=77 temp=39.0C
2026-08-28T08:42:19   poll level=77 temp=39.0C
2026-08-28T08:42:34   poll level=76 temp=39.0C
2026-08-28T08:42:49   poll level=76 temp=39.0C
2026-08-28T08:43:04   poll level=76 temp=39.0C
2026-08-28T08:43:19   poll level=76 temp=39.0C
2026-08-28T08:43:34   poll level=76 temp=39.0C
2026-08-28T08:43:49   poll level=76 temp=39.0C
2026-08-28T08:44:05   poll level=76 temp=38.9C
2026-08-28T08:44:20   poll level=76 temp=38.9C
2026-08-28T08:44:35   poll level=76 temp=39.0C
2026-08-28T08:44:50   poll level=76 temp=39.0C
2026-08-28T08:45:05   poll level=76 temp=39.0C
2026-08-28T08:45:20   poll level=76 temp=39.0C
2026-08-28T08:45:35   poll level=76 temp=38.9C
2026-08-28T08:45:51   poll level=76 temp=38.9C
2026-08-28T08:46:06   poll level=76 temp=38.9C
2026-08-28T08:46:21   poll level=76 temp=38.9C
2026-08-28T08:46:36   poll level=76 temp=39.0C
2026-08-28T08:46:51   poll level=76 temp=39.0C
2026-08-28T08:47:06   poll level=76 temp=39.0C
2026-08-28T08:47:22   poll level=76 temp=39.0C
2026-08-28T08:47:37   poll level=75 temp=39.0C
2026-08-28T08:47:52   poll level=75 temp=39.0C
2026-08-28T08:48:07   poll level=75 temp=39.0C
2026-08-28T08:48:22   poll level=75 temp=39.0C
2026-08-28T08:48:37   poll level=75 temp=39.0C
2026-08-28T08:48:52   poll level=75 temp=39.0C
2026-08-28T08:49:08   poll level=75 temp=39.0C
2026-08-28T08:49:23   poll level=75 temp=39.0C
2026-08-28T08:49:38   poll level=75 temp=39.0C
2026-08-28T08:49:53   poll level=75 temp=39.0C
2026-08-28T08:50:08   poll level=75 temp=39.0C
2026-08-28T08:50:23   poll level=75 temp=39.0C
2026-08-28T08:50:38   poll level=75 temp=39.0C
2026-08-28T08:50:53   poll level=75 temp=39.0C
2026-08-28T08:51:09   poll level=75 temp=38.9C
2026-08-28T08:51:24   poll level=75 temp=38.9C
2026-08-28T08:51:39   poll level=75 temp=38.9C
2026-08-28T08:51:54   poll level=75 temp=38.9C
2026-08-28T08:52:09   poll level=75 temp=38.9C
2026-08-28T08:52:24   poll level=75 temp=38.9C
2026-08-28T08:52:40   poll level=74 temp=38.9C
2026-08-28T08:52:55   poll level=74 temp=38.9C
2026-08-28T08:53:10   poll level=74 temp=38.9C
2026-08-28T08:53:25   poll level=74 temp=38.9C
2026-08-28T08:53:40   poll level=74 temp=39.0C
2026-08-28T08:53:55   poll level=74 temp=39.0C
2026-08-28T08:54:10   poll level=74 temp=39.1C
2026-08-28T08:54:25   poll level=74 temp=39.1C
2026-08-28T08:54:41   poll level=74 temp=39.0C
2026-08-28T08:54:56   poll level=74 temp=39.0C
2026-08-28T08:55:11   poll level=74 temp=39.0C
2026-08-28T08:55:26   poll level=74 temp=39.0C
2026-08-28T08:55:41   poll level=74 temp=38.9C
2026-08-28T08:55:56   poll level=74 temp=38.9C
2026-08-28T08:56:11   poll level=74 temp=38.9C
2026-08-28T08:56:27   poll level=74 temp=38.9C
2026-08-28T08:56:42   poll level=74 temp=39.0C
2026-08-28T08:56:57   poll level=74 temp=39.0C
2026-08-28T08:57:12   poll level=74 temp=38.9C
2026-08-28T08:57:27   poll level=74 temp=38.9C
2026-08-28T08:57:42   poll level=73 temp=38.9C
2026-08-28T08:57:57   poll level=73 temp=38.9C
2026-08-28T08:58:12   poll level=73 temp=38.9C
2026-08-28T08:58:28   poll level=73 temp=38.9C
2026-08-28T08:58:43   poll level=73 temp=38.8C
2026-08-28T08:58:58   poll level=73 temp=38.8C
2026-08-28T08:59:13   poll level=73 temp=38.8C
2026-08-28T08:59:28   poll level=73 temp=38.8C
2026-08-28T08:59:43   poll level=73 temp=38.8C
2026-08-28T08:59:59   poll level=73 temp=38.8C
2026-08-28T09:00:14   poll level=73 temp=38.8C
2026-08-28T09:00:29   poll level=73 temp=38.8C
2026-08-28T09:00:44   poll level=73 temp=38.8C
2026-08-28T09:00:59   poll level=73 temp=38.8C
2026-08-28T09:01:14   poll level=73 temp=38.8C
2026-08-28T09:01:29   poll level=73 temp=38.8C
2026-08-28T09:01:45   poll level=73 temp=38.8C
2026-08-28T09:02:00   poll level=73 temp=38.8C
2026-08-28T09:02:15   poll level=73 temp=38.8C
2026-08-28T09:02:30   poll level=73 temp=38.8C
2026-08-28T09:02:45   poll level=72 temp=38.8C
2026-08-28T09:03:00   poll level=72 temp=38.8C
2026-08-28T09:03:15   poll level=72 temp=38.9C
2026-08-28T09:03:31   poll level=72 temp=38.9C
2026-08-28T09:03:46   poll level=72 temp=38.9C
2026-08-28T09:04:01   poll level=72 temp=38.9C
2026-08-28T09:04:16   poll level=72 temp=38.9C
2026-08-28T09:04:31   poll level=72 temp=38.9C
2026-08-28T09:04:46   poll level=72 temp=38.9C
2026-08-28T09:05:02   poll level=72 temp=38.9C
2026-08-28T09:05:17   poll level=72 temp=39.0C
2026-08-28T09:05:32   poll level=72 temp=39.0C
2026-08-28T09:05:47   poll level=72 temp=39.0C
2026-08-28T09:06:02   poll level=72 temp=39.0C
2026-08-28T09:06:17   poll level=72 temp=39.0C
2026-08-28T09:06:32   poll level=72 temp=39.0C
2026-08-28T09:06:48   poll level=71 temp=39.0C
2026-08-28T09:07:03   poll level=71 temp=39.0C
2026-08-28T09:07:18   poll level=71 temp=39.0C
2026-08-28T09:07:33   poll level=71 temp=39.0C
2026-08-28T09:07:48   poll level=71 temp=39.0C
2026-08-28T09:08:03   poll level=71 temp=39.0C
2026-08-28T09:08:18   poll level=71 temp=39.0C
2026-08-28T09:08:34   poll level=71 temp=39.0C
2026-08-28T09:08:49   poll level=71 temp=39.0C
2026-08-28T09:09:04   poll level=71 temp=39.0C
2026-08-28T09:09:19   poll level=71 temp=39.0C
2026-08-28T09:09:34   poll level=71 temp=39.0C
2026-08-28T09:09:49   poll level=71 temp=38.9C
2026-08-28T09:10:05   poll level=71 temp=38.9C
2026-08-28T09:10:20   poll level=71 temp=39.0C
2026-08-28T09:10:35   poll level=71 temp=39.0C
2026-08-28T09:10:50   poll level=71 temp=38.9C
2026-08-28T09:11:05   poll level=71 temp=38.9C
2026-08-28T09:11:20   poll level=71 temp=39.0C
2026-08-28T09:11:35   poll level=71 temp=39.0C
2026-08-28T09:11:51   poll level=70 temp=39.0C
2026-08-28T09:12:06   poll level=70 temp=39.0C
2026-08-28T09:12:21   poll level=70 temp=39.0C
2026-08-28T09:12:36   poll level=70 temp=39.0C
2026-08-28T09:12:51   poll level=70 temp=39.0C
2026-08-28T09:13:06   poll level=70 temp=39.0C
2026-08-28T09:13:22   poll level=70 temp=39.0C
2026-08-28T09:13:37   poll level=70 temp=39.0C
2026-08-28T09:13:52   poll level=70 temp=39.0C
2026-08-28T09:14:07   poll level=70 temp=39.0C
2026-08-28T09:14:22   poll level=70 temp=38.9C
2026-08-28T09:14:37   poll level=70 temp=38.9C
2026-08-28T09:14:53   poll level=70 temp=39.0C
2026-08-28T09:15:08   poll level=70 temp=39.0C
2026-08-28T09:15:23   poll level=70 temp=38.9C
2026-08-28T09:15:38   poll level=70 temp=38.9C
2026-08-28T09:15:53   poll level=70 temp=39.0C
2026-08-28T09:16:08   poll level=70 temp=39.0C
2026-08-28T09:16:23   poll level=70 temp=39.0C
2026-08-28T09:16:39   poll level=70 temp=39.0C
2026-08-28T09:16:54   poll level=69 temp=38.9C
2026-08-28T09:17:09   poll level=69 temp=38.9C
2026-08-28T09:17:24   poll level=69 temp=39.0C
2026-08-28T09:17:39   poll level=69 temp=39.0C
2026-08-28T09:17:54   poll level=69 temp=39.1C
2026-08-28T09:18:09   poll level=69 temp=39.1C
2026-08-28T09:18:25   poll level=69 temp=39.0C
2026-08-28T09:18:40   poll level=69 temp=39.0C
2026-08-28T09:18:55   poll level=69 temp=39.0C
2026-08-28T09:19:10   poll level=69 temp=39.0C
2026-08-28T09:19:25   poll level=69 temp=39.0C
2026-08-28T09:19:40   poll level=69 temp=39.0C
2026-08-28T09:19:56   poll level=69 temp=39.0C
2026-08-28T09:20:11   poll level=69 temp=39.0C
2026-08-28T09:20:26   poll level=69 temp=38.9C
2026-08-28T09:20:41   poll level=69 temp=38.9C
2026-08-28T09:20:56   poll level=69 temp=39.0C
2026-08-28T09:21:11   poll level=69 temp=39.0C
2026-08-28T09:21:26   poll level=69 temp=39.0C
2026-08-28T09:21:42   poll level=69 temp=39.0C
2026-08-28T09:21:57   poll level=69 temp=39.0C
2026-08-28T09:22:12   poll level=69 temp=39.0C
2026-08-28T09:22:27   poll level=68 temp=39.0C
2026-08-28T09:22:42   poll level=68 temp=39.0C
2026-08-28T09:22:57   poll level=68 temp=38.9C
2026-08-28T09:23:12   poll level=68 temp=38.9C
2026-08-28T09:23:28   poll level=68 temp=38.9C
2026-08-28T09:23:43   poll level=68 temp=38.9C
2026-08-28T09:23:58   poll level=68 temp=39.0C
2026-08-28T09:24:13   poll level=68 temp=39.0C
2026-08-28T09:24:28   poll level=68 temp=39.0C
2026-08-28T09:24:43   poll level=68 temp=39.0C
2026-08-28T09:24:58   poll level=68 temp=39.0C
2026-08-28T09:25:14   poll level=68 temp=39.0C
2026-08-28T09:25:29   poll level=68 temp=39.0C
2026-08-28T09:25:44   poll level=68 temp=39.0C
2026-08-28T09:25:59   poll level=68 temp=39.0C
2026-08-28T09:26:14   poll level=68 temp=39.0C
2026-08-28T09:26:29   poll level=67 temp=39.0C
2026-08-28T09:26:44   poll level=67 temp=39.0C
2026-08-28T09:27:00   poll level=67 temp=38.9C
2026-08-28T09:27:15   poll level=67 temp=38.9C
2026-08-28T09:27:30   poll level=67 temp=38.9C
2026-08-28T09:27:45   poll level=67 temp=38.9C
2026-08-28T09:28:00   poll level=67 temp=38.9C
2026-08-28T09:28:15   poll level=67 temp=38.9C
2026-08-28T09:28:30   poll level=67 temp=38.9C
2026-08-28T09:28:46   poll level=67 temp=38.9C
2026-08-28T09:29:01   poll level=67 temp=38.9C
2026-08-28T09:29:16   poll level=67 temp=38.8C
2026-08-28T09:29:31   poll level=67 temp=38.8C
2026-08-28T09:29:46   poll level=67 temp=38.8C
2026-08-28T09:30:01   poll level=67 temp=38.8C
2026-08-28T09:30:17   poll level=67 temp=38.8C
2026-08-28T09:30:32   poll level=67 temp=38.8C
2026-08-28T09:30:47   poll level=66 temp=38.8C
2026-08-28T09:31:02   poll level=66 temp=38.8C
2026-08-28T09:31:17   poll level=66 temp=38.9C
2026-08-28T09:31:32   poll level=66 temp=38.9C
2026-08-28T09:31:47   poll level=66 temp=38.9C
2026-08-28T09:32:02   poll level=66 temp=38.9C
2026-08-28T09:32:18   poll level=66 temp=38.9C
2026-08-28T09:32:33   poll level=66 temp=38.9C
2026-08-28T09:32:48   poll level=66 temp=39.0C
2026-08-28T09:33:03   poll level=66 temp=39.0C
2026-08-28T09:33:18   poll level=66 temp=39.0C
2026-08-28T09:33:33   poll level=66 temp=39.0C
2026-08-28T09:33:49   poll level=66 temp=39.0C
2026-08-28T09:34:04   poll level=66 temp=39.0C
2026-08-28T09:34:19   poll level=66 temp=39.0C
2026-08-28T09:34:34   poll level=66 temp=39.0C
2026-08-28T09:34:49   poll level=66 temp=39.0C
2026-08-28T09:35:04   poll level=66 temp=39.0C
2026-08-28T09:35:19   poll level=65 temp=39.0C
2026-08-28T09:35:35   poll level=65 temp=39.0C
2026-08-28T09:35:50   poll level=65 temp=39.0C
2026-08-28T09:36:05   poll level=65 temp=39.0C
2026-08-28T09:36:20   poll level=65 temp=39.0C
2026-08-28T09:36:35   poll level=65 temp=39.0C
2026-08-28T09:36:50   poll level=65 temp=38.9C
2026-08-28T09:37:05   poll level=65 temp=38.9C
2026-08-28T09:37:21   poll level=65 temp=38.9C
2026-08-28T09:37:36   poll level=65 temp=38.9C
2026-08-28T09:37:51   poll level=65 temp=39.0C
2026-08-28T09:38:06   poll level=65 temp=39.0C
2026-08-28T09:38:21   poll level=65 temp=39.0C
2026-08-28T09:38:36   poll level=65 temp=39.0C
2026-08-28T09:38:52   poll level=65 temp=39.0C
2026-08-28T09:39:07   poll level=65 temp=39.0C
2026-08-28T09:39:22   poll level=65 temp=39.0C
2026-08-28T09:39:37   poll level=65 temp=39.0C
2026-08-28T09:39:52   poll level=65 temp=39.0C
2026-08-28T09:40:07   poll level=65 temp=39.0C
2026-08-28T09:40:22   poll level=64 temp=39.0C
2026-08-28T09:40:38   poll level=64 temp=39.0C
2026-08-28T09:40:53   poll level=64 temp=39.0C
2026-08-28T09:41:08   poll level=64 temp=39.0C
2026-08-28T09:41:23   poll level=64 temp=39.0C
2026-08-28T09:41:38   poll level=64 temp=39.0C
2026-08-28T09:41:53   poll level=64 temp=39.0C
2026-08-28T09:42:09   poll level=64 temp=39.0C
2026-08-28T09:42:24   poll level=64 temp=38.9C
2026-08-28T09:42:39   poll level=64 temp=38.9C
2026-08-28T09:42:54   poll level=64 temp=39.0C
2026-08-28T09:43:09   poll level=64 temp=39.0C
2026-08-28T09:43:24   poll level=64 temp=39.0C
2026-08-28T09:43:39   poll level=64 temp=39.0C
2026-08-28T09:43:55   poll level=64 temp=38.9C
2026-08-28T09:44:10   poll level=64 temp=38.9C
2026-08-28T09:44:25   poll level=64 temp=39.0C
2026-08-28T09:44:40   poll level=64 temp=39.0C
2026-08-28T09:44:55   poll level=64 temp=39.0C
2026-08-28T09:45:10   poll level=64 temp=39.0C
2026-08-28T09:45:26   poll level=63 temp=39.0C
2026-08-28T09:45:41   poll level=63 temp=39.0C
2026-08-28T09:45:56   poll level=63 temp=39.0C
2026-08-28T09:46:11   poll level=63 temp=39.0C
2026-08-28T09:46:26   poll level=63 temp=39.0C
2026-08-28T09:46:42   poll level=63 temp=39.0C
2026-08-28T09:46:57   poll level=63 temp=39.0C
2026-08-28T09:47:12   poll level=63 temp=39.0C
2026-08-28T09:47:27   poll level=63 temp=39.0C
2026-08-28T09:47:42   poll level=63 temp=39.0C
2026-08-28T09:47:57   poll level=63 temp=39.0C
2026-08-28T09:48:12 WALL: 2h cap during cool-start
2026-08-28T09:48:12 STOP. Zero speed cells. Zero completed ABBA blocks. Cool-start never reached ≤32 °C (plateau 38.8–39.0 °C after Awake heat-up; Dozing did not cool). Battery 63% still above floor. Unplugged throughout. Correctness 407/407 and 925/925 from night-0 remain the only valid results. Serial 192.168.1.152:37687. Jelly not touched. No hunt for other ports.
2026-08-28T10:59:10 B1 preflight serial=192.168.1.152:37687 level=46 temp=36.0C ac=False usb=False screen=Dozing amendment1_gate_C=36.0
2026-08-28T10:59:12 START kexp_tg128_b1_1_A ngl=99 tg128 screen=Awake
2026-08-28T10:59:12 launch() battery.pre: level=46 temp=35.9C ac=false (raw/kexp_tg128_b1_1_A.battery.pre.txt). Samples 35.9C/46%/ac:false for ~20s then dumpsys None (transport dying).
2026-08-28T11:09 BLOCKED: adb transport lost for 10 min on 192.168.1.152:37687 (Connection refused). No hunt for other ports. Jelly still device, not touched. No llama-bench jsonl. kexp_tg128_b1 INVALID (partial). rc=1.
2026-08-28T11:09 STOP totale. Zero completed ABBA cells. Amendment-1 cool-start was met (35.9–36.0 °C) and screen was Awake at start of A. No t/s. Owner should replug.
