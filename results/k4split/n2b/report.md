# N2b — divergence root cause

**Verdict: ROUTER_SELECTION.** N2 **PASS** with the pin below.
Device: S23, **PLUGGED_AC**, 77% → 89%, batt temp 33–35 °C. No Xiaomi/Jelly/PC jobs.

Exact pin (config of record, CLI, no rebuild):

```
--override-tensor ffn_gate_inp.weight=CPU
```

Applied on top of k6d065 + `--cache-mb 1000 --force-cache` + `-ngl 99 --flash-attn off --moe-cpu-experts on --dense-weights anon`.

---

## What forked

N2 (`N1N2_VERDICT.md`) already showed placement is not the bug: A == B == AUTO
byte-identical, hook alive, CPU diverges at the first contentful token after
`</think>` (`distinct` vs `smaller`).

N1 sched (`n1_sched_B_c1000.err`) puts the **entire router** on OpenCL:

```
node #61 MUL_MAT    ffn_moe_logits-0  [OpenCL]  blk.0.ffn_gate_inp.w [OpenCL]
node #62 SOFT_MAX   ffn_moe_probs-0   [OpenCL]
node #64 ARGSORT    ffn_moe_argsort-0 [OpenCL]
node #66 GET_ROWS   ffn_moe_weights-0 [OpenCL]
## SPLIT: CPU inputs include ffn_moe_topk-0   ← HostAlias copy
```

KEXP has **no** `exp_probs_b` / `ffn_exp_probs_b`. Router weight is only
`blk.N.ffn_gate_inp.weight` (F32, 2 MiB × 40). Shared-expert gate
`ffn_gate_inp_shexp` is a different tensor (sigmoid, not top-k) and was
**not** pinned.

256-way F32 softmax + argsort on Adreno vs CPU is the near-tie flip the
hypothesis named. 2B/4B dense models have no router, so they stayed
token-identical; 35B does not.

---

## Experiment 1 — router-to-CPU (one variable)

Cell `e1_router_cpu`: ARM_B flags + `-ot ffn_gate_inp.weight=CPU`.
Greedy `--temp 0 --seed 42 -n 32 -c 4096`, same `p_fact.txt` via `-p`.

| check | result |
|---|---|
| pin landed | `extra_ot=1`; **40**/40 `ffn_gate_inp.weight` overridden to CPU; **0** shexp pins |
| HostAlias | **did not fire** — topk is host-backed (router ran on CPU) |
| anon | skip 1250 MiB GPU (was 1330) + 413 MiB host / 41 buffers (was 333 / 1). +80 MiB = 40 × 2 MiB routers |
| generated text | **byte-identical to CPU** |

Extracted continuation after `</think>` (sha256 of the 131-byte slice
`5490BA0D0F5D3A2421661B2B72E8B63E4B370CE46B49C0A594BD490807813E8D`):

```
CPU / pin: A Mixture-of-Experts (MoE) model consists of multiple distinct neural network "experts" that are selectively activated for each
N2 B:      A Mixture-of-Experts (MoE) model consists of multiple smaller "expert" networks that are selectively activated for each input token
```

`N2CPU == e1bCPU == e1PIN` (`True`). `e1PIN == N2B` (`False`).

N2 re-gate CPU (`e1b_n2gate_cpu`, no `-ot`, no `--route-trace`) reproduced
the original N2 CPU text **and** the cache fingerprint (2305.3 MiB,
72.04 MiB/tok, 44.0% hit, 4978 evictions / 1748 re-reads, 946/7680 dropped).
Deterministic.

Hook on the pin arm: 43.7% hit / 72.76 MiB/tok vs CPU 44.0% / 72.04 — inside
the ±10 pt / same-ballpark rule. Stall 0.049 s/tok (hook waited).

---

## Experiments 2 and 3

**ngl bisect: not run.** Exp 1 restored identity; first-layer search is
unnecessary.

**Route-trace: not used for the identity claim.** `--route-trace` exists
and works (`e3_routes_cpu.routes.jsonl`, 808 KiB, header
`n_layer=40 n_expert=256 n_expert_used=6`). It is **not a faithful
observer**: the same CPU flags + `--route-trace` emitted a *different*
continuation (`distinct "expert" neural networks that are activated
selectively` — still the `distinct` family, not `smaller`). Do not compare
routes across a flag that changes tokens. Classification does not need it:
pinning only the router weight flipped `smaller` → `distinct`.

---

## Residual (honest)

Pin-arm drop-cold is 952/7680 vs CPU 946/7680, and cache evictions 5012 vs
4978. The hidden state feeding the now-CPU router still comes from the GPU
trunk (`attn_post_norm`), so softmax *weights* can drift a hair and
drop-cold can nibble the margin without flipping the n=32 greedy tokens.
That is not the N2 fail. The fail was expert **selection** on GPU
SOFT_MAX/ARGSORT.

This KEXP has no `exp_probs_b`. If a later file adds it, pin that too
(`-ot exp_probs_b=CPU`) — it sits on the same ADD-before-topk path.

---

## Fix

**Today (no rebuild):** add to every split arm

```
--override-tensor ffn_gate_inp.weight=CPU
```

(`-ot ffn_gate_inp.weight` is equivalent; bare regex = CPU.)

**Product (not applied, not committed):**
`results/k4split/n2b/pin_router_gate_inp.patch` — when Mechanism B/Auto
pins `ffn_*_exps`, also pin `ffn_gate_inp\.weight`. Five lines in
`BigMoeOnEdge/core/src/engine/session.cpp` next to the existing
`LLM_FFN_EXPS_REGEX` push. Do not commit from this task.

N2 with the CLI pin is **PASS** (token-identical generated body, hook
alive). N3/N4 are unblocked **only** UNPLUGGED, batt ≥45 %, same cache
1000 + `--force-cache`, and the pin in the config of record.

---

## File map

| file | what |
|---|---|
| `e1_router_cpu.{out,err,rc,summary.txt}` | split + router pin |
| `e1b_n2gate_cpu.{out,err}` | N2 re-gate CPU (no pin, no route-trace) |
| `e3_routes_cpu.{out,err,routes.jsonl}` | CPU + `--route-trace` (text perturbed; ignore for identity) |
| `gen_n2_cpu.txt` / `gen_e1b_cpu.txt` / `gen_e1_pin.txt` | 131-byte identical gens |
| `gen_n2_B.txt` | 135-byte unpinned split (`smaller`) |
| `memfree_*.csv` / `*_batt_*.json` | RAM + battery |
| `run_cell.sh` | on-device runner (45 min kill-gate, 60 s MemFree abort) |
| `pin_router_gate_inp.patch` | parent product pin, not applied |

DONE
