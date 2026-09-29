# S23 backend hopping heat - result (2026-09-28, unplugged)

Device run by luna `4f4a780a` against `PREREG.md`; engine kit f25f0c1c5, LFM2.5-2.6B ship model,
unplugged, Awake, screen ON, traced 0, app force-stopped, tools off, no `kalsa.bench.thermo`.
Coordinator re-read the decode `tg256` lines in the raw bench logs. Summaries, amendments and the
luna handoff: `raw/run-2026-09-28/` (raw device logs stay in `/tmp/s23-heat-abc/`, not in the lab).

## Decode (question 2): fast-sampled 9-arm repeat, order CPU,GPU,HTP,GPU,HTP,CPU,HTP,CPU,GPU, no cooldown

| backend | tg256 tok/s (rep 1/2/3) | battery C·s/token median (range) | skin C·s/token median (range) | zone peak |
|---|---|---|---|---|
| CPU (`-dev none -ngl 0`) | 22.89 / 22.13 / 22.02 | 0.2018 (0.1278-0.2905) | 0.2474 (0.2413-0.3785) | CPU 90-92 C |
| OpenCL (`GPUOpenCL -ngl 99`) | 14.15 / 14.03 / 13.53 | 0.4298 (0.3526-0.4579) | 0.5253 (0.4358-0.5293) | GPU 77-79 C |
| HTP v73 (`HTP0 -ngl 99`) | 22.25 / 22.03 / 22.09 | 0.1404 (0.1265-0.1659) | 0.1708 (0.1135-0.1885) | NSP 84-86 C |

All exit 0, Android thermal status 0 throughout. Reading: HTP decode matches CPU speed with the
lowest heat per token; OpenCL decode is ~37 % slower and about twice the heat per token. Runs are
short (256 tokens, ~12 s): the CPU and HTP heat ranges overlap, so "HTP cooler than CPU" is a
direction, not a proven gap. Note HTP decode 22 tok/s here vs 13.0 in the 3-way run (`llama-completion`,
1010-token prompt): different tool and context; not reconciled.

## Prefill blocks (question 1): 12 x 962-token prompt

The preregistered HTP block was VOID (hot gate, before the no-cool-start amendment). A fresh
no-cool HTP x12 block ran later: skin +5.5 C over 12 units, NSP local peak 93.5 C. The archival
GPU x12 block: skin +6.5 C. No crossover observed, but the blocks differ in start and order, so
this is descriptive only, not the matched crossover the PREREG asked for.

## App visibility (question 3)

95 thermal zones, 86 readable from shell. `run-as` (domain `runas_app`) read all 30 CPU/GPU/NSP
zones; that does not prove access for a normal `untrusted_app` process. `getThermalHeadroom` is a
single skin-tracking scalar: it cannot say which accelerator is hot.

## Open

- Matched crossover (CPU->HTP->GPU same session) not obtained.
- untrusted_app sysfs access needs an in-app probe (debuggable APK).
