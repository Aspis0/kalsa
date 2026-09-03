# PREREG — Cell #52: Snapdragon 7+ Gen 3 (QRD7675) first contact — CPU/GPU bench of the ship config

Date: 2026-09-03. Owner away for the day; directive in chat this morning:
"utilizzi qdc di Qualcomm per testare altri processori? Soprattutto il 7xx che
non abbiamo mai testato". This cell is the 7xx first datapoint for the
tri-engine router decision table (spec docs/ROUTER-SPEC-V0.2.md §3.5 needs
per-tier CPU/GPU crossover data; the 740-only warning in memory forbids
generalising S23 numbers to other tiers).

## Question

On a Snapdragon 7+ Gen 3 (Adreno 732 class, never measured by us):

- Q1 — do the fork's OpenCL kernels PASS correctness (test-backend-ops,
  backend `GPUOpenCL`) on this GPU class?
- Q2 — with the SHIPPED model+quant (LFM2.5-2.6B QAD-Q4_0, HF revision
  f4a289c8a200a5ca71005ba7abc2dad33058a450, the exact URL the app downloads),
  what are CPU pp512/tg128 and GPU(-ngl 99) pp512/tg128?

## Binding interpretation grid (written before any run)

- G1: Q1 all-PASS AND GPU pp512 > CPU pp512 → 7xx behaves like the 750-class
  ("GPU flies"): router prefill lane GPU is admissible on this tier.
- G2: Q1 all-PASS AND GPU pp512 ≤ CPU pp512 → 7xx behaves like the 740-class:
  GPU is cool-mode only; router must not route prefill to GPU for speed.
- G3: any Q1 FAIL/NaN → the OpenCL lane is NOT certifiable on this tier with
  these kernels; record failing ops; GPU numbers (if any) are quarantined.
- G4: model fails to load (RAM/other) → abort bench arms, keep recon +
  correctness; cell still banks Q1.
- Decode (tg128) is recorded but NOT gridded: single-cell decode on an
  untouched tier is a first estimate, not a router commitment.

## Fixed materials (pinned before session)

- Kit: `~/kalsa-qdc/gov-kit-5c3979438.tgz`, sha256 head `419bef91a260badb`.
  Source commit 5c397943820138a57018a615039a05827d9ea177 (kalsa/governor-v0),
  OpenCL ON, Adreno kernels ON, binary kernels OFF (see BUILD_NOTE.txt in kit).
  Payload shas in kit SHA256SUMS; llama-bench `38a4cca3…`, test-backend-ops
  `36ddd5ae…`, llama-cli `5e96493f…`.
- Model: `~/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1,593,894,944 bytes,
  sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`,
  downloaded 3/09 from the app-pinned HF revision (ModelDownloader.test.ts:45).
- Thermal gate: `~/kalsa-qdc/kexp-speed-cell/thermal_gate.sh` (cell #38
  AMENDMENT-1 semantics: live HAL group, ≤60.0 °C, status ≤1).

## Procedure (d_run.sh in this folder is the executable form)

1. QDC Interactive Session on QRD7675 (Android U), SSH+device mirror,
   kalsa-mac key; tunnel via connect.sh on port 6037 (NEVER 5037).
2. Recon (no grid): getprop soc/platform/fingerprint, cpuinfo_max_freq for
   every core, /vendor/lib64/libOpenCL.so presence, MemTotal, baseline
   thermal. The 4 highest-max-freq cores define CPU_MASK for all bench runs
   (mask + nproc recorded in every bench file — cpuset gate rule).
3. Push kit + model, sha256-verify ON DEVICE against the pinned values above;
   mismatch = abort (exit 5).
4. R1 correctness: `test-backend-ops test -b GPUOpenCL -o MUL_MAT` then
   `-o MUL_MAT_ID` (caps: 20 min each). PASS/FAIL counts banked for Q1.
5. R2 CPU bench: `taskset CPU_MASK llama-bench -m model -t 4 -p 512 -n 128
   -r 3 -o md` (cap 25 min).
6. R3 GPU bench: same + `-ngl 99` (cap 25 min).
7. Thermal gate PRE each of R1/R2/R3: on GATE_FAIL wait 60 s, retry ×3, then
   abort remaining arms (partial cell banks what ran). Thermal snapshot POST
   each arm recorded (not gating).
8. Pull all raw outputs to raw/; End Session in portal.

## Cost estimate

Push ~1.6 GB over tunnel + 3 arms ≈ 45–70 min of the 1000 free 7+ Gen 3
minutes. One QDC job at a time (no other session concurrent).

## Non-goals

- No NPU/Hexagon arm: the kit has no HTP stage for this SoC and the v79 skels
  are 8-Elite-only. NPU on 7xx is a separate future cell.
- No APK/app install; native CLI only.
- No thermal-throttling endurance measurement; single-shot bench only.
