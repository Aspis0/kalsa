# GPU sustained marathon — session report

**Device:** S23 SM-S911U via ssh `:8022`  
**Binary:** `~/gdn_k2/bin_cpufix/llama-cli` sha256 `4986ff3…dd80` (cpufix, repack OFF, stripped)  
**Model:** `~/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf`  
**PC PPL job:** not touched.

## What happened

Preflight ran. The phone is **UNPLUGGED, 56%, 28.7–29.9 °C**. Protocol start gate is **≥60%**. The runner refused (`REFUSE_BATT`). No decode arm started. No numbers were invented.

`dumpsys battery` is not exported to this Termux UID (`Can't find service: battery`). Sampler uses `termux-battery-status` (campaign standard). Temperature is already °C at 0.1 resolution.

## Hypothesis (still untested)

Cold burst on this binary: CPU 18.19 t/s, GPU faoff 10.25 t/s. Campaign fact: S23 sustained clocks ~41% of peak → CPU could sag to ~7.5 t/s and lose a 15-minute marathon to GPU. **Not measured this session.**

## On disk

| path | what |
|---|---|
| `results/gpu_sustained/prompt.txt` | exact prompt (sha256 `55427c84…82e5`) |
| `results/gpu_sustained/run_marathon.sh` | CPU → cooldown T0±1 °C → GPU, 60 s batt, 48 °C / 2 min abort |
| `results/gpu_sustained/wait_and_run.sh` | 6 h waiter, starts `all` only if UNPLUGGED ≥60% and temp settled |
| `results/gpu_sustained/analyze_marathon.py` | first/final-third means + declared J/token proxy |
| `results/gpu_sustained/batt_preflight.json` | 56% UNPLUGGED 29.9 °C |
| `results/gpu_sustained/STATUS.txt` | last known: `WAITER_ARMED` |
| `reports/moe-gpu-sustained.md` | formal report (empty headline table) |

On device: `~/gdn_k2/gpu_sustained/` only.

## Waiter

Pid 16606 on the phone, 6 h cap. It will **not** start while charging and will not start below 60%. After a charge+unplug it waits for temp ≤32 °C (hard 36 °C) then execs the marathon.

Manual start after you charge and unplug:

```bash
ssh -p 8022 -i %USERPROFILE%\.ssh\moe_s23 u0_a344@192.168.1.152
bash ~/gdn_k2/gpu_sustained/run_marathon.sh all
```

If only the CPU arm can finish, that is a declared partial: recharge, same T0 cooldown, then `run_marathon.sh gpu`.

## Headline numbers

CPU first-third / CPU final-third / GPU first-third / GPU final-third: **n/a, n/a, n/a, n/a**.  
Sustained winner: **not scored**. Energy winner: **not scored**.

DONE
