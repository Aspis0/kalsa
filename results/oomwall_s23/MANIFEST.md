# oomwall_s23 — banked 2026-08-21

S23 Adreno 740. USB `R3CW406P8CV`. NOT Jelly. llama.cpp `c8f4fc05e` on `kalsa/kernel-s3-repack` (LOG_ALLOC on `c1bb48d32` / kalsakernel-v3).

**Verdict:** the power-off wall is llama-bench default ARM `CPU_REPACK` (`use_extra_bufts=true`) at Q4_K_M scale. GPU innocent. Production immune. Proof: W4↔W4c. Report: `scratchpad/agents/oomwall/REPORT.md`.

## Device / model pins

| artifact | bytes | sha256 |
|---|---:|---|
| `libggml-opencl.so` (LOG_ALLOC) | 8044464 | `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `llama-bench` stub | 7600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| Mellum2 Q4_K_M.gguf | 8071293600 | `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` |
| LFM2.5-KEXP.gguf | 3326160384 | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |
| OLMoE Q4_K_M.gguf (W5 instrument, PC) | 4213513024 | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |

GGUFs are **not** in this git tree.

## llama-bench extra_bufts variants

Payload is `libllama-bench-impl.so`. Stub and `libllama.so` are byte-identical across variants.

| variant | path | bytes | sha256 |
|---|---|---:|---|
| stock (W1/W2/W4) | `staging/stock/libllama-bench-impl.so` | 4240544 | `bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171` |
| **noextra (W4c / W5)** | `staging/noextra/libllama-bench-impl.so` | 4240160 | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` |
| stub (both) | `staging/*/llama-bench` | 7600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |

Dodge (reverted, **not** a fork commit): `llama-bench-noextra.diff` sha `ab6cbaa5b10614e1752339837ec679fd469d408fb9216d975ba3b31e987d49b5`.

`staging/*/libllama.so` (39 MiB, sha `f8b11fc3…`) kept on disk, **not** committed (identical to device `libllama.so`).

CMake re-run drift — **do not push from build dir:** `libggml-base.so` stock `9f7081a2…` now `3d308036…`; `libllama-common.so` stock `a1c034b0…` now `cc515fae…`.

## Runs

| run | result | artifacts |
|---|---|---|
| W1 Mellum2 ngl=2 ncmoe 99 stock | POWER OFF, cliff 5.01→0.45 GB | `w1.adb.log` `w1.mem_poll` `w1.pre` `w1.sh` |
| W2 LFM2.5 ngl=99 stock | load OK, abort 134 FA | `w2.adb.log` `w2.mem_poll` `w2.pre` `w2.sh` |
| W4 Mellum2 ngl=0 stock | POWER OFF + auto-reboot; 9 s pre-crater | `w4.adb.log` `w4.mem_poll` `w4.pre` `w4.sh` `w4.health.txt` `w4.logcat` |
| W4c Mellum2 ngl=2 ncmoe 99 noextra | LOAD LIVES, abort 134 FA | `w4c.adb.log` `w4c.mem_poll` `w4c.pre` `w4c.sh` `w4c.health.txt` |

## File sha256 (in-tree unless noted)

```
acfc018b2bb4ffca146a98a50d402196d5594f664111aadadfd8b266e13a0859  _dump_gguf_meta.py
506c01999b4969e00e6b4da4da826df62d2c0fa0947dcd5d3d9a27aedc8c9f90  _LFM2.5-8B-A1B-KEXP_tensors.txt
c0bf10161cebf920b9abf30543302a3b2a2ee4f5e92378fb5e3a5afba9db2f81  _Mellum2-12B-A2.5B-Instruct-Q4_K_M_tensors.txt
3aa6b43b8062d17737d3e07fe9bd8ead452d95f395d50c8d7a2f6596bdd62e08  w1.adb.log / _w1_adb_log.txt
4381680f85eaa9528e03cb5f689ca0ad27bae6df1b19c88996aa4854addc5612  _w1_mem_poll.txt
f3b8a3ef05e6bde38b6e19f6ae4ed07cdeaf88653cba76dba87329df93eb3269  w1.pre
5161c23d013dd02dde4c972c8fac4373395a9add1fc33e671d0fe2a0a41f2e3b  w2.adb.log
15c0124a986ec6f2c7aaf6ef63c5a36a7b6253107fd94749791e0a8e914cc9fb  w2.mem_poll
4de2559014b6b53f9a1acb455bd684e5c662e45152050fcc54d71bac829433cb  w2.pre
e41550da732fb98bc0e3a3bd1732788dcc5c5fbbdf6586db7930b08db36b7649  _w4_mem_poll.txt
c770dfe84980f9eb2c037c9321f308b3e9d46a7dae3b19e538ff57832a0d3f12  w4.pre
817a48ba9a8e8b09fc81fa85d137b0f6e9cb545f01efcb21e23566614016d2b9  w4c.mem_poll
ab6cbaa5b10614e1752339837ec679fd469d408fb9216d975ba3b31e987d49b5  llama-bench-noextra.diff
7395128910e21e1edfa0c3e61d690a2769e1cc76ce6616f4e62353d1a0167f96  olmoe_q4km_tensors.txt
c934d893b9799a81cddde000ed1d5a93e2c54214a6aca995ae36503034d4f8f1  run_w4.ps1
bc8b7ad7c6304839e81be529bcf0b54702da97b608c042c14ab659ac5345776b  run_w4c.ps1
d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346  staging/noextra/libllama-bench-impl.so
b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c  staging/noextra/llama-bench
7f90a9409cb1a423ac9b17a060108036d126ffe1ef22a9d41de9e86f3303e9ae  staging/SHA256.txt
bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171  staging/stock/libllama-bench-impl.so
515342a2131c7f7f2765a2e2106d2e39aa4f9a71e2331d45ade8c521076525e2  w1.mem_poll
f35a276a820189bcbcfa66704fac6b13cee6c78b3d011fbca2615adcbe4766b9  w1.sh
24845e7c01ed47bbef051c76a8fc480c7c25e3013d4537daa07b8d0cf9d9142c  w2.sh
880f42ff30b66544b9dc60bcf780fd59be1a3d9c5d4fac7df0ba4f5a3fab7bb7  w4.adb.log
364376b83adb9183ec5d9f05a9aeb0bb8ba97fc9bfcf49f44420c79d0e8d9cdc  w4.health.txt
7f808426a7116b272a5907c09c5fcebf2af2c102ccfb3ca1148e3f4021863143  w4.mem_poll
66b1354a7fd9b7c548fc52b9fd4f7d13a8917426805aa8ab9df8c02719bb453a  w4.sh
81990744a345e4eab54baa70b74acda595674e3eb04ea3e4f1659acfcd478521  w4c.adb.log
137b0a414ad6694798f52cf3a395aac41beba9ea39a8c6c1eb9bfc84be084a27  w4c.health.txt
d4e49fc8a11ad5b8b9f1f12d65146232cf6eafe879ac73619049c904a59dcb3d  w4c.pre
c5e72584703dcf2afd13a78c0e586daf4a2edb02e20187f20271d80e161ecaad  w4c.sh
```

**Not committed (size / duplicate):** `w4.logcat` 48656384 B sha `e1174881f71a954dd2c0ee927cad9872baf73821c1a2079caade5ba21b96daad`; `staging/*/libllama.so` 39807624 B sha `f8b11fc3…`; on-disk copy `libggml-opencl.2ed2e48a.so` (same pin as device).
