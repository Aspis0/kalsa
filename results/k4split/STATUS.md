# k4split STATUS — 2026-08-13 (N1 PASS, N2 PASS with router pin)

**Milestone: N0 DONE + N1 PASS + N2b ROUTER_SELECTION + N2 PASS with
`--override-tensor ffn_gate_inp.weight=CPU`.** N3/N4 **waiter ARMED**
2026-08-13T06:46:19-04:00 (pid 21569). Starts only UNPLUGGED, batt ≥45 %,
batt temp ≤35 °C. 6 h window then `ARMED_EXPIRED`. Parent residency kernel is on `BigMoeOnEdge`
`main` @ `8958cdf`. Android OpenCL `bmoe-cli` staged + pushed
(`b8b1c732…`). Full write-up: `results/k4split/N1N2_VERDICT.md` +
`results/k4split/n2b/report.md`. Human card: `MORNING.md`.
Do not update `PLAN.md`. Do not git push. Do not apply the parent
patch unless a human asks — the CLI `-ot` is enough for N3.

---

## N1 / N2 (measured 2026-08-13, S23, plugged)

N1 **PASS** at `--cache-mb 1000 --force-cache` (ARM_B). cache 2000 ram-guard
refuse (need 4538 / avail 3856); cache 1500 refuse (4038 / 3844). c512 then
c4096 both generated `OK`. Load ~23 s. `GGML_SCHED_DEBUG=2`: **82 graph
splits**. Placement: 40 layers GPUOpenCL, every `ffn_*_exps` overridden to
CPU, `skipping 1330 MiB already on GPU (no host twin)`, HostAlias copy of
`ffn_moe_topk-0`. Streaming stats print (c512: 38.5% hit, 81.76 MiB/tok).

MemFree spikes to 14–90 MiB for ~15–25 s during OpenCL alloc then recovers
to 3–4 GiB after anon-drop. MemAvailable stayed ≥1 GiB. A 15 s MemFree
watchdog is a false BLOCKED_RAM; 60 s sustained is the working rule. Device
alive.

N2 unpinned **FAIL_CORRECTNESS**. Same binary, temp 0 seed 42 n=32 c=4096,
`p_fact.txt` via `-p`. Hook **alive**: CPU 44.0% / 72.04 MiB/tok vs split
45.0% / 68.89 MiB/tok. A == B == AUTO. CPU diverges after `</think>`:
`distinct neural network "experts"` vs `smaller "expert" networks`.

**N2b ROUTER_SELECTION → N2 PASS** with
`--override-tensor ffn_gate_inp.weight=CPU`. Generated body byte-identical
to CPU (sha `5490BA0D…`). HostAlias silent. Hook 43.7% vs 44.0%. See
`n2b/report.md`.

Config of record: k6d065 + **`--cache-mb 1000 --force-cache`** +
**`-ot ffn_gate_inp.weight=CPU`** on split arms.
`LD_LIBRARY_PATH=$WS/bin:/vendor/lib64`. Speed still requires UNPLUGGED
batt≥45.

Logs: `results/k4split/n1/`, `n2/`, `n2b/`, `s23_logs/`.

---

## Night-close banner (kept)

N0 landed the residency kernel. This was a placement night, not a kernel
night. No ggml-opencl / FLASH_ATTN / `kernel_gemv_*` edits. M1 GEMV is not
in these binaries. Report stub: `reports/moe-k4-split.md`.

---

## Verdict in one paragraph

The fork already expresses the split. Mechanism A is real for KEXP
(Q2_K/Q3_K `MUL_MAT` / `MUL_MAT_ID` → OpenCL `supports_op` false → experts
stay CPU/mmap → CPU `mul_mat_id` fires the expert-ready hook). Mechanism B
is the product pin (`--moe-cpu-experts on|auto` → `LLM_FFN_EXPS_REGEX` on
`tensor_buft_overrides`). Parent wiring was enough; **no llama.cpp patch**.
Local fork branch `kalsa/split-trunk-gpu` exists only so
`add_subdirectory(third_party/llama.cpp)` builds the Q6_K-dispatch tree
(`04c5d362a`) instead of `kalsa/mld-gemv-m1`. The night is **not**
`BLOCKED_ARCH`. It is blocked on an unfinished Android link + a live
device job.

---

## What landed

### Parent engine (`BigMoeOnEdge` `main`)

| sha | subject |
|---|---|
| `e926a5453d47d860500b2b1286d23e9e9410f929` | `feat(engine): GPU trunk / CPU expert residency knobs` |
| `342df14ea93941e16fa80e0550d1541639cdf5ac` | `fix(engine): keep tensor overrides alive and leave expert mmap alone` |
| `8958cdf914a7a5e71ffe7c29889bda4e0ae8fc56` | `fix(engine): copy GPU routing tensors before the streamer reads them` **← HEAD** |

Flags (CLI default `--ngl 0` keeps today's CPU campaign path):

```
--ngl / --n-gpu-layers / --gpu-layers / -ngl N
--flash-attn / --fa off|on          # default off (A7X FLASH_ATTN is dead)
--moe-cpu-experts off|on|auto       # omitted + --moe-stream → Auto
--override-tensor / -ot PAT[=BT]
--dense-weights mmap|warm|anon|ahwb|anon-gpu
```

| mode | pin `ffn_*_exps` to CPU |
|---|---|
| Off | no — Mechanism A only |
| On | always (Mechanism B) |
| Auto | when `n_gpu_layers != 0` |

Also: `ram_guard_allows_gpu` (300 MiB slack, refuse open rather than lie),
AnonGpu skips non-host tensors and still `MADV_DONTNEED` leftover mmap,
dense list + `drop_mmap_copies` refuse routed `ffn_*_exps`, cache-auto
deducts host-pending dense only, `HostAlias` copies GPU topk/weights
through `ggml_backend_tensor_get`/`set`.

File:line as-built is in `reports/moe-k4-split.md` and `IMPL_NOTES.md`.
Recon (no `N0_DESIGN_NOTES.md` was written): `recon_a_supports_op.md`,
`recon_b_session.md`, `recon_dense_ram.md`, `recon_hook.md`, `recon_build.md`.

### Fork

- Branch: `kalsa/split-trunk-gpu`
- HEAD: `04c5d362afb4ae3cf7762a81e204f6cba15c5480`
  (= `kalsa/opencl-q6k-dispatch-fix`, Q6_K dispatch fix; **zero extra commits**)
- Working tree was switched off `kalsa/mld-gemv-m1` @ `7670428d6` so the
  parent OpenCL build does not pick up M1 GEMV objects.
- Hook symbol present: `ggml_cpu_set_expert_ready_hook` (`ggml-cpu.h` /
  `ggml-cpu.c:1666`).

### PC binary (flag / link check only — no Adreno ICD)

Out-of-tree `build-pc-k4split/` (`GGML_OPENCL=OFF`). Existing `build-pc/`
left untouched (MarcoKEXP PPL was holding `build-pc/cli/bmoe-cli.exe`).
`--help` lists `--ngl` / `--flash-attn` / `--moe-cpu-experts` /
`--override-tensor` / `anon-gpu` (`bmoe_cli_pc_help.txt`).
`bmoe_config_test` placement cases passed (existing `build-pc` objects).

| file | size (B) | sha256 |
|---|---:|---|
| `results/k4split/bin/bmoe-cli-pc.exe` | 347136 | `d2672584ddd8ac6453101850c19fde3eedf15df5390e18dad5efb16f2fa477a0` |
| `llama.dll` | 2225152 | `6e9835964b61b9465a7b023c190a6411d105220da62623c808704cfca11c20c7` |
| `llama-common.dll` | 9255936 | `5028afa6b3501bc11242b25988380a6bad405c6619894b5998d0c59c78f588a2` |
| `ggml.dll` | 67072 | `55ecdff50d65f585d311300a2a2a37a4af359e86fd9ef525e7fad39d36730d9b` |
| `ggml-base.dll` | 643072 | `c0ed71fde0f1687a3ce559a2dbc19109e2db382b449e8541c74795ac09477b4a` |
| `ggml-cpu.dll` | 894976 | `265b4cd6217bc4ce9439792c3d83ec4aed45c5bff9eaa8f5d58b87c0f275e683` |

Source of hashes: `results/k4split/SHA256SUMS_pc.txt`.

### Android binary (OpenCL + Adreno + hook) — **READY**

Out-of-tree `build-android-opencl-k4split/` (new; product
`scripts/build-android.ps1` still `GGML_OPENCL=OFF`, not edited).
Configure succeeded (`build_android_configure.log`): OpenCL 2.2, Adreno
kernels, `gated_delta_net` + `ssm_conv` embedded, hook present,
`ggml commit: 04c5d362a`, `BUILD_SHARED_LIBS=OFF`.

Compile finished `[402/402] Linking CXX executable cli\bmoe-cli` (monitor
exit 0). Pack wrote this file against a stale `[296/402]` flush. Staged
2026-08-13 via `stage_android.ps1` → `SHA256SUMS_android.txt`.

| file | size (B) | sha256 |
|---|---:|---|
| `results/k4split/bin/bmoe-cli` | 108997408 | `b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab` |
| `results/k4split/bin/libc++_shared.so` | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` (matches K2) |

DT_NEEDED: `libm.so` `libdl.so` `libOpenCL.so` `libandroid.so` `libc++_shared.so` `libc.so`.

Fallback `llama-cli` OpenCL @ `04c5d362a`
(`results/gdn_gpu_k22b/bin/`, sha
`0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da`)
**must not** be used for N1–N4: no `--moe-stream`, hook does not compose.

---

## What did not land

- N3 speed (UNPLUGGED, batt ≥45%) — **now allowed**; pin required
- N4 sustained
- `N0_DESIGN_NOTES.md` (recon notes + `IMPL_NOTES.md` stand in)
- PLAN.md (forbidden)
- git push (forbidden)
- Any Xiaomi / Jelly SSH
- Any ggml-opencl / FLASH_ATTN / GEMV edit
- Token-identical CPU vs **unpinned** split (N2 fail; N2b pin restores it)

---

## Open CONFIRMED bugs

Code bugs found during the night **and fixed** (do not re-litigate as open):

| id | verdict | fix |
|---|---|---|
| dangling `tensor_buft_overrides` (function-local `vector<string>` + `.c_str()`) | CONFIRMED | `Session::Impl` `std::list<std::string>` (`342df14`, `session.cpp:350-355, 556-596`) |
| AnonGpu rebind / `MADV_DONTNEED` of live routed `ffn_*_exps` | CONFIRMED | name skip + live-mmap guard (`342df14`, `dense_weights.cpp:23-29, 75, 202, 314-318`) |
| GPU `ffn_moe_topk` / weights `t->data` is OpenCL dummy; streamer would read garbage | CONFIRMED | `HostAlias` get/set (`8958cdf`, `router_hook.cpp:154-189`) |

Still open (CONFIRMED operational, not a logic bug):

| id | evidence |
|---|---|
| **N2 token mismatch (unpinned)** | CONFIRMED ROUTER_SELECTION. GPU `SOFT_MAX`/`ARGSORT` on `ffn_gate_inp`. Fixed by `-ot ffn_gate_inp.weight=CPU`. See `n2b/report.md`. |
| **N3/N4 unmeasured** | N2b cleared correctness; still need UNPLUGGED batt≥45 + the pin |

Residual risks now **measured** (N1/N2):

- ARM_A Mechanism A **works on this KEXP**: A == B == AUTO, hook alive.
  Future OpenCL Q2_K/Q3_K `MUL_MAT_ID` would still steal experts — product
  path remains ARM_B / ARM_AUTO.
- OpenCL convert workspace **is** transient: MemFree 14–90 MiB for ~20 s,
  then 3–4 GiB after anon-drop. Persistent GPU dense 1330 + host 333 = 1663.
- `token_embd` stays CPU (333 MiB host_dense) even at `-ngl 99`.
- `--cache-mb 2000`/`1500` **ram-guard refuse**; 1000 needs `--force-cache`.
- `predict` / `route-ahead` still off on k6d065.
- PC `bmoe-cli` cannot run the split (OpenCL OFF by design).
- **N2b CONFIRMED**: unpinned GPU *router* (not the trunk) is not
  token-identical. Pin `ffn_gate_inp.weight=CPU` restores n=32 greedy.

---

## RAM budget (paper, not a device measurement)

KEXP measured on the CPU campaign path
(`results/calaqwen_s23/fix/smoke/fixed.combo.txt`):

| item | MiB | notes |
|---|---:|---|
| dense trunk | 1664 | 613 anon buffers; this becomes the CL copy under `-ngl` |
| leftover mmap of GPU-copied dense | 0 after AnonGpu / anon skip + DONTNEED | llama unmap does **not** drop pages between CPU experts |
| `--cache-mb` | 2000 | k6d065; drop to 1500 then 1000+`--force-cache` if N1 ABORT |
| KV @ c=4096 f16 | 80 | 10 full-attn layers |
| recurrent state | 63 | F32, does not scale with n_ctx |
| compute @ `--ubatch 512` | 501 | CPU figure; GPU compute may differ |
| ram-guard slack | 300 | refuse `open()` if `MemAvailable` < estimate |
| **steady-state (no double copy)** | **~4600** | should fit 8 GB |
| **if anon twins the GPU trunk** | **~6260+** | RescueParty zone — this is the killer |

N1 abort: **MemFree < 300 MiB sustained** (stricter than campaign
`lib_guardrails.sh`, which is MemFree<100 **and** die>85 °C).

---

## Morning order

1. Binary + workspace already staged (`~/gdn_k2/k4split/`).
2. N1/N2/N2b are done. Next is **N3 UNPLUGGED batt ≥45 %** with
   `--override-tensor ffn_gate_inp.weight=CPU` on every split arm.
3. Do not apply `n2b/pin_router_gate_inp.patch` unless a human asks.

Campaign pin (CPU reference only; N2 A/B uses **our** binary both sides):
`~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN` sha
`1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`.

---

## Chronology (earlier bullets, compressed)

- 2026-08-12 N0 recon A/B/hook/dense-RAM/build: not BLOCKED_ARCH.
  Parent had `n_gpu_layers=0` hardcoded; no CLI GPU surface; campaign
  Android `bmoe-cli` is `GGML_OPENCL=OFF`; `anon` would rebind a GPU trunk.
- 2026-08-13 residency kernel + two audit fixes (see table above).
- 2026-08-13 PC OpenCL-OFF build in `build-pc-k4split/`; Android
  parent+OpenCL configure + compile started, **not finished**.

See `BUILD_MANIFEST.md` for the exact cmake lines.
