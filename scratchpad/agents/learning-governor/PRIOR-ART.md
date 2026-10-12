# Learning governor - prior art (web research, 2026-10-12)

Delegate: Paseo Explorer&WebSearch (claude-haiku-5-5), agent e1bc0758. "Opened" = the delegate fetched the abstract or
page; "snippet" = search result only, unverified. Not re-verified by the coordinator beyond reading this report.

## Sources, ranked by applicability

1. **Android Thermal API (PowerManager / ADPF)**, Android 11+ (opened:
   https://developer.android.com/games/optimize/adpf/thermal). `getThermalHeadroom(seconds)` 0.0 -> 1.0 (SEVERE),
   forecasting N seconds ahead; `getCurrentThermalStatus()`. Caveats on the page: the forecast is less accurate than
   the current status; NaN if no thermal hardware or polled more often than ~once per 10 s; status may read NONE
   regardless of real throttling on some devices. Use: the hard guard under a learned model; gives no per-leg heat.
2. **Conservative Bandits**, Wu, Shariff, Lattimore, Szepesvari, ICML 2016, arXiv:1602.04282 (opened). Reward must
   stay above a baseline uniformly over time; play the known-safe default arm unless the UCB action keeps the
   constraint. Maps to "coolest proven leg is the default arm". Limit: stationary arms, not an evolving thermal state.
3. **SafeOpt**, Sui, Gotovos, Burdick, Krause, ICML 2015 (snippet). GP model of the constraint, evaluates only
   provably safe points, grows the safe set. Limit: Lipschitz constant, GP cost on a phone.
4. **Thermal-Aware Scheduling for DL on Mobile Devices with NPU**, Tan & Cao, IEEE TMC 23(12), 2024 (opened:
   https://pure.psu.edu/en/publications/thermal-aware-scheduling-for-deep-learning-on-mobile-devices-with/). GPU vs NPU
   scheduled against heat; greedy "ignores future impacts", so a deep-RL scheduler. Closest problem; their NPU trades
   accuracy (ours does not); deep RL too heavy for v0.
5. **CORE: Rethinking DVFS for Mobile LLMs**, Zhang et al., MLSys 2026 (opened). Joint CPU/GPU/memory frequency for
   LLM inference; default governors 23-40 % slower than the optimum; TTFT -8.5-17.7 %, TPOT -27.8-39.6 %. No thermal
   limits in the abstract. Predecessor FUSE arXiv:2507.02135 (snippet).
6. **LLM Inference at the Edge ... Under Sustained Load**, Tummalapalli et al., arXiv:2603.23640, 2026 (opened).
   "Thermal management supersedes peak compute"; iPhone 16 Pro loses ~half its throughput within two iterations; on a
   Galaxy S24 Ultra an OS-enforced GPU frequency floor terminates inference. Not a scheduler.
7. **When NPUs Are Not Always Faster**, Li, Qi, Chen, arXiv:2605.27435, 2026 (opened). CPU beats NPU in prefill by up
   to 1.6x on their SoC; NPU only 1.05-1.2x in decode; fallback overhead erodes NPU gains. Device not named in the
   abstract (not Snapdragon data). Supports (leg, phase) keying.
8. **llm.npu**, Xu et al., ASPLOS 2025, arXiv:2407.05858 (snippet). Chunked prompts on the NPU, outliers on CPU/GPU.
   Not thermal-aware.
9. **HeteroLLM / HeteroInfer**, arXiv:2501.14794 (snippet). Per-phase tensor partition chosen by profiler + solver.
   Speed, not heat.
10. **Online thermal model identification**, UCSD SEELab slides 2014 (snippet). LTI phone thermal model identified
    online, mean error 0.3 C, max 1.5 C.
11. **Skin-temperature-aware DVFS**, Northwestern (snippet). Skin estimated from sensors + counters. Unverified.
12. **PELM**, arXiv:2609.09662 (opened, abstract only). Speculative decoding + DVFS under thermal limits; Jetson class.

## Gaps

- No peer-reviewed bandit/RL governor for phone thermals that learns per device online (only patents).
- No source for time-to-throttle prediction from an online-identified RC model on a phone.
- No MPC-on-Android paper found (a 2015 DATE paper on predictive DTPM not opened).

## Delegate's synthesis: simplest v0 the sources support

1. Hard guard: Android headroom forecast + status; never let the forecast run below a margin before SEVERE.
2. Thermal model: first-order per device, T' = a(T_amb - T) + b*P, a and b fitted online by least squares; predict
   tokens-to-limit.
3. Per (leg, phase): EWMA of tok/s and C per token with a sample count, seeded from the lab prior, persisted.
4. Default arm: coolest leg proven on this device; leave it only when the predicted headroom after the planned tokens
   clears the margin.
5. Exploration: a bounded token budget on a hot leg, aborted before the margin by the existing pause arm.
6. Decision: maximise predicted speed subject to predicted temperature at the horizon under limit - margin; else the
   coolest leg.
7. Rule + estimator, not deep RL; greedy one-step lookahead first.
8. Pitfalls: skin lags minutes (a one-step model overshoots); the forecast is less accurate than the status; GPU
   clock floors mean a probe cannot always be undone; priors per phase; no learning from a charging phone.
9. Pitfall: stale state after firmware/ambient change -> store a device + build fingerprint and reset on mismatch.
10. Pitfall: check the leg choice does not silently change output quality (oracle) or the other clocks.
