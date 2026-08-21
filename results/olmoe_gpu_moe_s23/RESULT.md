# W5 OLMoE GPU-MoE S23 — not run

Staged 2026-08-21. Waiting for unplug green light.

- Binary: noextra impl `d2030f23` on **both** arms (stock extra_bufts would anonymous-repack ~3.5 GiB Q4_K and re-risk the oomwall).
- `-fa off`, `LOG_ALLOC` off.
- Probe `-ngl 4` first; do not jump to full offload.
- ABBA ×2 at the surviving ngl, then optional sustain tg512 ×4/arm.

Fill this file after the cell: tok/s A vs B, temp sag, MemAvailable, any power-off.
