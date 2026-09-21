# The governor must know which phone it is on

> **Status.** Plan written 2026-09-19. Audited the same day (deepseek v4.1); the audit's
> accusations were re-read on the artefacts on 2026-09-20. The audited Italian body is archived
> byte-for-byte at `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`. Per-item verdicts are in
> "Verification status" at the end; the full re-verification is
> `scratchpad/agents/governor-audit-recheck/REPORT.md`.
>
> **Park status: open owner decision.** The 19/09 owner order set the governor aside so the fork
> could be rebased on llama.rn's `vendor/` layout. A memory dated 20/09 claims the condition for
> that order has fallen, but no document on disk records an un-park. Whether the governor resumes
> is the owner's to decide; this document does not assert it.
>
> **Sourcing rule.** Every quantitative input below either cites an artefact as `file:line`, or is
> labelled **UNSOURCED** with what would settle it. A number with neither does not belong here.

Owner order, 2026-09-19 (quote preserved in the archived copy): (1) CPU, GPU, RAM and NPU must
give information to the governor; (2) on that basis the governor knows whether it can move to GPU,
to NPU, or to nothing; (3) start from the three phones we have and decide what to do when they
heat up.

## Scope

**In: Android.** Three phones (Xiaomi 14, Galaxy S23, Jelly Star), three engines (CPU, GPU, NPU),
two phases (prefill, decode): 3 x 3 x 2 = 18 cells today, counted over the sets named here (a
definition of the design space, not a measurement). The count grows, which is the reason for
Part 2b.

**In as a shape constraint, even with no device in hand: non-Qualcomm vendors.** The capability
record must be able to describe a MediaTek or an Exynos without inventing a Qualcomm identity for
it. Today it cannot: the field that decides everything is `generation`, whose values are
`V73 | V75 | V79 | Unknown` (`src/engine/governorInputs.ts:14-27`; native enum
`src/llama-ext.h:197`), i.e. Hexagon versions. A Dimensity or an Exynos falls into `Unknown` and
from there into `NoFit`. That is the strongest argument for Rule 1.

- **MediaTek:** we own one (Jelly Star, Helio G99, Mali-G57 MC2), treated in Part 3.3. Its GPU
  lane was closed by an allow-list and then by owner decision, not by the hardware.
- **Exynos:** no device, no measurement, no line of code. Named only so the record can express one
  the day it arrives; anything written about its performance today would be invented.

**Out: Apple and Metal, owner decision, 2026-09-19** (quote in the archived copy). Four structural
reasons:

1. Unified memory breaks the central premise. The fit gate (`gpuFit()`) assumes GPU memory is
   separate and must be reserved: `gpuReserveMiB = 800 + 1.05 * offloadedBytes / MiB`. On Apple
   there is nothing to reserve, and the computation is not merely useless but wrong.
2. Metal is not mobile OpenCL. Half the work here is discovering whether our kernels compile on a
   given driver (Part 1.2); on Apple the Metal backend is first-class upstream.
3. The NPU lane is a different thing. We drive Hexagon ourselves over HTP; the Apple Neural Engine
   is not reachable from the engine.
4. The trees are already separate: Android runs our fork's kernels, iOS the prebuilt llama.rn
   xcframework with upstream Metal. One document would describe two different engines.

iOS remains the platform after Android and will have its own document. What must survive from here
to there is Rule 1: if decisions contain no device identity, the selector holds when the engines
underneath change.

## Design shape (kept from the audited plan)

**Rule 1. Device identity never enters a decision.** No `if (generation == ...)` inside the
policy. The policy sees only measured capabilities: this engine is available, it costs this much
per token, it heats this much per thousand tokens. The phone's name selects a data row, not a code
branch. `generation` survives as a diagnostic label in logs and nowhere else.
*Mechanical check:* `grep` for `generation` in the policy files returns zero hits outside
telemetry.

**Rule 2. The matrix is data, not control flow.**

```
for (phase, thermal_state):
    candidates = engines with proven capability
    drop those that do not fit in memory
    drop those that are not correct on this driver
    order by measured heat-per-token on THIS device
    take the first that meets the speed floor
```

Adding an engine is adding a list element; adding a phase is adding a key; adding a phone does not
touch decision code at all, provided the probes cover it.

**Rule 3. The two phases are one selector with a different parameter.** Today they are two
functions, `admit_prefill` (`src/llama-governor-policy.cpp:184-226`) and `select_decode`
(`:228-256`), which duplicate the structure and have *different* defects: the first aborts at
CRITICAL while the second waits; the first ignores LOWBAT in admission while `prefill_engine()`
(`:152`) consults it; the 45% battery threshold appears in two places with two effects. One
selector parameterised by phase closes all three at once.

**Probes fail closed.** A missing or failing probe means the capability does not exist, so we stay
on CPU. Never the reverse. Each probe is cached for `socModel + GPU driver version + app
versionCode` and invalidated when any of the three changes, because a system update can change the
driver underneath us and the driver decides whether the kernels compile.

**Acceptance criterion (verifiable).** Adding a fourth phone must touch exactly one data file and
zero decision files. Adding a fourth engine must touch the engine list and zero conditional
branches. The test: add a fake device to the data file, assert the selector produces the expected
policy for every (phase x thermal state) combination, and assert with a diff that no policy file
was touched. If passing the test requires an `if`, the refactor failed and the test says so first.
The test is written *with* the refactor, not after.

## Part 0: What exists today, line by line

### 0.1 The "detection" is a regex on a string

`src/engine/governorInputs.ts:62-75`, `generationFor()`, takes `profile.socModel`, uppercases it and
tests it with **six** regexes (three on `socModel`, three on a `modelName / modelId / manufacturer`
fallback), for example:

```ts
if (/(SM8550|KALAMA|SM7675|SM8635)/.test(soc)) return "V73";
if (/(SM8650|PINEAPPLE)/.test(soc))            return "V75";
if (/(SM8750|SUN)/.test(soc))                  return "V79";
...
return "Unknown";
```

There is no probe. If the SoC is not on that Qualcomm allow-list, the phone is `Unknown`. The Jelly
(Helio G99) is `Unknown` by construction, as would be any Exynos, Dimensity or Tensor.

### 0.2 One key is a proxy for four subsystems

`GPU_PREFILL_CORRECT` (`governorInputs.ts:14-27`):

```ts
const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
  V79: true, V75: true, V73: false, Unknown: false,
};
```

with `const enabled = force || GPU_PREFILL_CORRECT[generation];` at `:130`. The **Hexagon** version
(which is the NPU) decides whether the **GPU** may be used: two different subsystems. Practical
consequence: on the S23 the governor is off **by table, not by measurement**, and on the Xiaomi it
is on with nothing verified at runtime.

### 0.3 The ten fields that reach the native code

`buildGovernorParams()` (`governorInputs.ts:123-144`) emits **ten** keys, not nine: the nine fixed
keys plus `...(enabled ? {} : { reason: \`gpu-prefill-incorrect-${generation}\` })` at `:142`. Every
device this plan cares about is disabled, so `reason` is always present.

| field | how it is computed today | verdict |
|---|---|---|
| `enabled` | `force \|\| GPU_PREFILL_CORRECT[gen]` (`:130`) | table |
| `generation` | regex on the SoC (`:62-75`) | table |
| `model_kind` | `Dense \| MoE \| Hybrid` from the registry | ok |
| `gpu_fit` | real computation, see 0.4 | the only measured field |
| `gpu_prefill_measured` | `gen === "V75" \|\| gen === "V79"` (`:137`) | another table dressed as a measurement |
| `bench_force_gpu_prefill` | bench flag | ok |
| `npu_lane_enabled` | `false`, fixed (`:139`) | the NPU does not exist for the governor |
| `reload_budget_available` | `false`, fixed (`:140`) | kills the decode cool lane |
| `forced` | bench flag | ok |
| `reason` | added only when `enabled` is false (`:142`) | present on every device we care about |

The name `gpu_prefill_measured` is the worst case: it promises a measurement and returns set
membership.

### 0.4 `gpu_fit`: the only thing that looks at the phone today

`governorInputs.ts:84-121`. It rejects with `NoFit` if the model lacks `kvBytesPerToken`, if total
RAM is `<= 8 GiB`, if `generation` is `Unknown`, or if the memory fit fails. Then it computes a
two-context budget:

```ts
const gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB;
const requiredMiB = estimate.nonEvictableMiB + gpuReserveMiB + estimate.computeMiB + estimate.kvMiB;
```

This is the best-written part of the file. Two notes:

- `<= 8 GiB` excludes the Jelly regardless of anything else.
- The 4B model now declares `kvBytesPerToken` (`src/engine/ModelRegistry.ts:232` = 13312; LFM at
  `:262` = 6656, read in the committed tree), so it became *fittable* only recently and no one has
  watched it happen in-app.

### 0.5 The thermal constant is another phone's

```c
constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };   // llama-governor-policy.cpp:15
constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };    // :14
```

Provenance traced with `git log -S`: commit `c1bb48d32` and the sweep
`scratchpad/agents/q58-s23-npu-spike-sweep`. The four row values are at
`scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md:29, :31, :33, :35` (rows 128 / 512 / 1024 /
2048), and `RUN_LOG.md:5` declares `device=Galaxy S23 / Hexagon v73`. They are **whole-process** ΔT
(including the model mmap), n=2 per cell, from an **NPU** sweep, used to price a chunk on V75 and
V79; and the array applies to whichever engine is `requested` (`admit_prefill`,
`llama-governor-policy.cpp:200,205`), not specifically to the GPU. There is no per-device branch.

Also `k_warn_c = 40.0` and `k_kill_c = 43.0` (`:10, :12`) are the harness guard's thresholds
(`--warn-tenths 400 --kill-tenths 430`), promoted to product ceilings.

## Part 1: What the phone must tell the governor

Four probes, each producing a **measurement** rather than a table entry, and each failing closed.

### 1.1 CPU probe

| datum | path | note |
|---|---|---|
| core count and clusters | `/sys/devices/system/cpu/cpu*/topology/physical_package_id` + `cpufreq/related_cpus` | groups cores into clusters |
| hardware max frequency per cluster | `/sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_max_freq` | constant |
| **current max frequency** | `/sys/devices/system/cpu/cpuN/cpufreq/scaling_max_freq` | **changes under throttling** |
| DVFS governor | `cpufreq/scaling_governor` | diagnostic |

**Why this is the most important probe.** On the Xiaomi, `scaling_max_freq` is the only place
throttling is visible. `dumpsys thermalservice` is **not** a reliable signal. The 2026-09-20
re-verification recorded a tracked-file census of **1252 samples reading `Thermal Status: 0`, 6
reading `1`, 4 reading `2` and 29 reading `3`**
(`scratchpad/agents/governor-audit-recheck/REPORT.md:146,150`; scope as recorded there: `git grep`
over tracked `*.md *.txt *.log *.csv` in the lab repo at that time, excluding the plan's own
self-quoting census lines, taken before the rewritten plan, the frozen archive and the review
reports existed). It is a **dated census, not a reproducible current command**: a re-run now also
matches the documents that quote it, so the ones/twos/threes split moves. The audit's
`1263 / 28 / 11 / 9` reproduces only from the main working tree including gitignored files
(`REPORT.md:146-150`, Finding 4). What matters here is only that `Thermal Status: 3` is not rare;
what would settle the exact current split is a scoped re-count over tracked measurement artifacts
with the plan, the archive and the review reports excluded.

The Xiaomi frequency the earlier draft used, `cpu7 scaling_max 1824000` against `hw_max 3302400`, is
recorded in the diary (`archived/PLAN-2026-09-full.md:1573`), **narratively sourced, not
raw-sourced**; no raw sysfs capture of it is on disk. What would settle it: one archived
`cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_max_freq` and `cpuinfo_max_freq` on the Xiaomi,
taken at the same moment as a thermal sample.

**The derived value the governor needs:** `headroom_cpu = scaling_max_freq / cpuinfo_max_freq` for
the big cluster. It is a number in [0, 1], read in microseconds, and it says how much the vendor is
already throttling before we do anything.

**Sampling caution:** never read during a turn (it contaminates the subject). Read before load and
between turns.

### 1.2 GPU probe

**The right question is not "is there a GPU" but "does our kernel set compile on this driver".**
The lesson of the kernel incident: the failure was not a hardware-capacity problem. In the pre-fix
blob, `kernel_gemv_moe_q4_k_f32_ns_wimg` (in
`26c7affb7^:ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl:216`) called the shared
7-parameter `get_scale_min_k4` with 4 arguments, so the OpenCL program failed to build and
`build_program_from_source_ex` called `exit(1)`. The fix is `26c7affb7` (that kernel) and
`2361be359` (the int8 dp4a sibling); the current file has the 7-argument call at `:219`. The E031
miscompile that forced the masks to become kernel arguments depends on the **driver version**
(`E031.41.03.62`, Adreno 740), not on the chip model.

| datum | source |
|---|---|
| vendor / renderer / driver version | `clGetDeviceInfo` (`CL_DEVICE_VENDOR`, `CL_DEVICE_NAME`, `CL_DRIVER_VERSION`) |
| OpenCL presence | loading `libOpenCL.so` |
| device global memory | `CL_DEVICE_GLOBAL_MEM_SIZE` |
| int8 dot-product support | `cl_khr_integer_dot_product` |
| **kernel-set compilation outcome** | a real program build, outcome recorded |

**Behaviour.** On first run on a new `(device, driver)`: build the set, time it, record `ok | fail`
with the error log, cache it. Later runs read the cache. On `fail`, the GPU does not exist for the
governor and we do not retry until the driver changes.

**Absolute constraint:** a kernel compilation error **must not call `exit(1)`** inside the app.
Today it does (`ggml-opencl.cpp:1298-1300`), and setting `fatal=false` alone is not enough: the
return becomes `nullptr`, then `clCreateKernel(nullptr, ...)` goes through `CL_CHECK`, which is
`GGML_ASSERT(0)` → `abort()`. Same SIGABRT one line later. Three pieces are needed: a non-fatal
build, explicit skipping of `clCreateKernel`, and a dispatch guard (or `supports_op` returning
`false`). The pattern already exists in-tree: the flash-attention variants use `fatal=false` with
`if (!prog) return false;` (`ggml-opencl.cpp:5807-5811`, `:6291-6295`).

### 1.3 RAM probe

**What it reads:** total, available, and the device class (`ActivityManager.isLowRamDevice`).

**The already-paid constraint no probe removes:** the fit gate is **structurally blind to GPU
memory**. The input to `estimateMemory` has no backend field, and the test treats weights as
file-backed evictable pages, which GPU offload inverts. `lmkd` kills the app instead of throwing,
so no fallback fires.
**UNSOURCED:** the earlier draft's "a 6.4 GB model at full GPU restarted the kernel" has no artefact
located in the re-check; what would settle it is the tombstone or kernel-log capture from that run.

`gpuFit()` (0.4) is the stopgap: it adds a GPU reserve of `800 MiB + 1.05 * offloaded bytes` by
hand. Keep it until the estimator input has a backend field, and **measure it at least once per
phone** instead of estimating it.

### 1.4 NPU probe

**What it reads:** Hexagon version (from the SoC and the presence of
`libggml-htp-v73|v75|v79|v81.so` in `assets/ggml-hexagon`), HTP backend initialisation, and
architecture support for the loaded model.

**State today:** `npu_lane_enabled: false` fixed (`governorInputs.ts:139`), and in the native
parsing layer `cpp/rn-governor-params.cpp:150-151` throws
`std::invalid_argument("Governor NPU lane is not supported")` if anyone turns it on. The NPU is
**out of the governor by construction**.

**Corrected numbers.** On the Xiaomi, the HTP prefill cell gives HTP pp512 median **165.42 t/s**
(`results/htp_prefill/xiaomi_v75/cell1/NOTES.txt:35,:36`) against CPU **51.90 t/s** (`:44`) =
**3.19×** (`:45`), unplugged. The thermal delta in that cell is **not** per-engine:
`results/htp_prefill/xiaomi_v75/cell1/battery_series.csv:2-6` gives `htp1_pre 32.9`,
`htp2_pre 33.3`, `htp3_pre 33.3`, `cpu_pre 33.3`, `end 34.2`, so the whole cell rose **+1.3 °C**, of
which the three HTP reps account for **+0.4** and the single CPU rep for **+0.9**. The earlier draft
attributed the whole +1.3 °C to the NPU; that was wrong.
**UNSOURCED:** the earlier draft's NPU decode figures (4.47 vs 11.94 t/s) have no artefact located
in the re-check; what would settle them is a decode cell on the same harness.

**Architecture note:** on the hybrid 4B the NPU carries only the non-recurrent part; GDN/SSM stay
on CPU. The probe must say so per model, not per device.

### 1.5 The record that comes out

One object, serialised to the native side in place of today's ten fields. Minimum shape,
no fields nobody constructs:

```
DeviceCapabilities {
  cpu:  { clusters: [{ cpus, max_khz, cur_max_khz }], headroom }
  gpu:  { present, vendor, driver, kernels_compile: ok|fail, global_mem_bytes, int8_dot }
  ram:  { total_bytes, available_bytes, low_ram_device }
  npu:  { hexagon: "v73"|"v75"|"v79"|null, htp_libs_present, arch_supported }
  probe_version, cached_for: { soc, gpu_driver, app_version }
}
```

`generation` survives only as a diagnostic label, never as a gate.

## Part 2: How the governor decides

### 2.1 The rule

Not "GPU if cool, CPU if hot". It is: **choose, per phase, the engine that minimises heat per
token, under a speed floor acceptable to the user.** Three inputs the code does not have today:

1. **measured ΔT per 1000 tokens, per engine and per device** (today: one S23 constant for all);
2. **tok/s per phase, per engine, per device** (today: nothing, only the `gpu_prefill_measured`
   table);
3. **the live frequency cap** (today: nothing; the OS thermal state is read instead and is
   uninformative on the Xiaomi).

### 2.2 What it does today, and it is backwards

Above the thermal threshold no table entry passes, the decision is `Wait`, and the runtime routes
the whole turn to CPU, unsplit (`llama-governor-runtime.cpp:55-63`). The fallback for "the CPU
would heat too much" is the hottest engine.
**UNSOURCED:** the earlier draft's "+19.3 °C SoC zone against +1.4 °C on GPU" for that comparison
has no artefact located in the re-check (the cited `results/xiaomi_ab/task_a/battery_notes.txt`
holds battery temperature, not SoC-zone temperature); what would settle it is the SoC-zone series
from that run.

The battery floor is **inverted**: with `requested == CPU` (battery < 45%, LOWBAT) admission is
`Admit`, which falls into `prefill_route_ = GPU` (`llama-governor-runtime.cpp:65-68`) and sends the
batch to `ctx_prefill`, i.e. `n_gpu_layers = 99` (binding fork `Aspis0/llama.rn`,
`cpp/rn-llama.cpp:76`; the line number is snapshot-dependent). Below 45% battery the prefill runs on
**GPU** while the telemetry says "CPU".

### 2.3 The ordered decision scale

```
per phase (prefill, decode):
  candidates = engines with capability proven by the probes
  filter by memory fit (with the measured GPU reserve)
  filter by correctness (kernels compile; oracle not worse)
  order by measured heat-per-token on THIS device
  take the first that meets the speed floor
  if none does: the fastest one under the thermal ceiling
  if none is under the ceiling: reduce TOKENS per chunk, do not change engine
  if the ceiling is still exceeded: a declared pause to the user, never a silent abort
```

The last line is where today's governor latches `failed` and every later completion throws.

## Part 2b: Code shape: adding a phone must cost one data row

Owner constraint, 2026-09-19 (quote in the archived copy): the code must be written properly from
the start, with three phones, two conditions and three structures that will grow.

There are 3 x 2 x 3 = 18 cells today, and the enumeration is **wired into control flow** instead of
living in data, so every new cell is paid for in `if`.

### 2b.1 What adding a phone costs today: counted, not estimated

| # | place | file | what |
|---|---|---|---|
| 1 | `generationFor()` | `governorInputs.ts:62-75` | a new SoC regex |
| 2 | `GPU_PREFILL_CORRECT` | `governorInputs.ts:14-27` | a row |
| 3 | `gpu_prefill_measured` | `governorInputs.ts:137` | the expression `gen === "V75" \|\| gen === "V79"` |
| 4 | `llama_governor_generation` | `src/llama-ext.h:197` | a value in the native enum |
| 5 | `prefill_engine()` | `llama-governor-policy.cpp:152` | a branch |
| 6 | `select_decode()` | `llama-governor-policy.cpp:228-256` | the `generation == V73` clause |
| 7 | `k_cpu_delta_c[]` | `llama-governor-policy.cpp:15` | not even indexable per device |

Seven places, three files, two languages, and the seventh has nowhere to put the value. A
non-Qualcomm phone has no "Hexagon generation" to declare, so points 1-4 ask it to fake an identity
it does not have.

### 2b.2 What NOT to build

No types or APIs nobody constructs. So: **no** plugin system, **no** abstract engine-provider
hierarchy, **no** configuration DSL, **no** runtime-extensible registry. This is not adding
abstraction; it is *removing* a wired-in enumeration that already exists and already costs us. A
list of four-field records and one sort function are fewer lines than what exists today. If the
refactor produces more lines than it replaces, it has slipped into speculative abstraction.

## Part 3: The three phones

### 3.1 Xiaomi 14: `houji`, SM8650, Adreno 750, Hexagon v75

**Thermal, paired unplugged pairs**: `results/xiaomi_ab/task_a/battery_notes.txt` (2B cells only;
values are the `temperature:` lines, in tenths of a degree):

| load | engine | battery temperature | lines |
|---|---|---|---|
| 2B pp512 | CPU | 279 → 290 (+1.1 °C) | :17, :26 |
| 2B pp512 | GPU | 290 → 290 (0.0) | :35, :44 |
| 2B pp1024 | CPU | 290 → 318 (+2.8) | :53, :62 |
| 2B pp1024 | GPU | 322 → 319 (−0.3) | :71, :80 |
| 2B pp2048 | CPU | 319 → 355 (+3.6) | :89, :98 |
| 2B pp2048 | GPU | 355 → 356 (+0.1) | :107, :116 |

(Sources are tenths of a degree; converted to °C in the last column.) SoC-zone peak for the same
cells: **UNSOURCED**, not in the cited file; needs the SoC-zone series from that run.

**4B thermal deltas**: `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt` (clean run, start
recorded at `:1`): CPU **+2.4 / +3.5 / +1.7 °C** at pp512 / 1024 / 2048, GPU **+0.4 / −0.7 /
−0.3 °C**, from the `temperature:` lines `289→313` (`:17, :26`), `313→317` (`:35, :44`),
`317→352` (`:53, :62`), `354→347` (`:71, :80`), `351→368` (`:89, :98`), `368→365` (`:107, :116`).
The file the earlier draft cited, `results/xiaomi_ab/task_a/battery_notes.txt`, has no 4B pp1024
cell at all and its whole 4B block is marked contaminated
(`results/xiaomi_ab/task_a/CONTAMINATED_4B.md`).

**Speed**: `results/xiaomi_ab/phase3_baseline/bench_{cpu,gpu_faoff}.json`, Qwen3.5-2B Q4_K_M, read
from the `avg_ts` fields:

| phase | CPU | GPU | ratio | lines (CPU / GPU) |
|---|---|---|---|---|
| prefill pp128 | 31.459 | 181.652 | GPU 5.77× faster | `bench_cpu.json:42` / `bench_gpu_faoff.json:42` |
| decode tg256 | 16.149 | 7.066 | GPU 2.3× slower | `bench_cpu.json:87` / `bench_gpu_faoff.json:87` |

The interleaved re-run of 18/08 (`results/gpu_prefill_recheck_xiaomi/report.md`) confirms the
decode direction and **revises the prefill to 3.18×** on a better CPU baseline: all ten interleaved
CPU reps mean `58.676`, all ten GPU reps mean `186.567`, and `186.567 / 58.676 = 3.18×`
(`:20-32`). The 5.77× came from a weak, real but non-typical CPU baseline (that report's original
CPU samples were `31.763`, `31.156`).

**Decode, corrected descriptor.** The "10 repetitions per direction, both orders" design belongs to
the **pp128 prefill** cell. Decode has **2 interleaved pairs** (`report.md:42`; rows `:48-51`: CPU
`26.968 / 26.039`, GPU `17.413 / 17.514`), so the decode ratio is `17.46 / 26.50 = 0.66×` (`:53`),
n=2 per arm, not n=10.

**NPU:** prefill `165.42` vs CPU `51.90` = **3.19×**
(`results/htp_prefill/xiaomi_v75/cell1/NOTES.txt`); whole-cell ΔT **+1.3 °C**, made of HTP **+0.4**
plus CPU **+0.9** (`results/htp_prefill/xiaomi_v75/cell1/battery_series.csv:2-6`). The earlier
draft called the +1.3 the NPU's own; it was the whole cell's.

**The `0.992`, corrected.** The earlier draft's "retraction" was itself wrong. The decode parity
`0.992` (with paired prefill `2.477×`) **is** the Xiaomi 14 `houji` (Adreno 750, SM8650) cell:
`scratchpad/agents/q16-xiaomi/REPORT.md:4, :26, :336, :378` (device `houji` / `23127PN0CG` /
SM8650; `A/C = 0.992`, `pp A/C = 2.477`), full precision `0.992469912994216` in
`scratchpad/agents/q16-xiaomi-audit/REPORT.md:137`. The memory row matches it on both numbers
(`kalsa-the-goal-is-a-governor.md:28`). The *other* `0.992` in the corpus is `0.9929437564` in
`scratchpad/agents/qdc-governor-s5/REPORT.md:235`, and that run is **QRD8750 / 8 Elite / Adreno 830
/ SM8750** (`:216`), not a QRD8650. The number is ours, and the board named in the old retraction
was wrong on both counts.

**Target policy**

| state | prefill | decode | lever when hot |
|---|---|---|---|
| cold | NPU if the model supports it, else GPU | CPU | — |
| warm | GPU (it is the **cool** path) | CPU | reduce tokens per chunk |
| very hot | GPU with small chunks | CPU | declared pause |
| critical | none | none | stop and say so |

**The point the current code gets wrong:** when it heats up, move the **prefill**, not the decode,
and move it **toward** the GPU, not away.

### 3.2 Galaxy S23: SM8550, Adreno 740, Hexagon v73

GPU decode is a cool-mode trade-off: in the archived KEXP cell, all-GPU is −19% speed for −2.75 °C
peak (`archived/ALIVE-2026-09-full.md:154`), against all-CPU `17.55` and `27.69` tok/s (`:153`).
**UNSOURCED:** the earlier draft's "CPU throttles 14-16% while the GPU stays flat 0-5%" and "a
decode that starts at 17.5 and falls to 14.8 is worse than 14.2 stable" have no artefact located in
the re-check; what would settle them is the frequency series and the decode curve from that run.

**UNSOURCED:** GPU prefill on the 740 has never been measured in-app; the f16 defect
(`adreno-f16-gemm-is-the-culprit`) is the known risk. Until measured it is **unproven** and must be
treated as such.

**Contaminant to subtract from every S23 number:** `adsprpcd` / `cdsprpcd` spin at ~100% of a core
each with the app closed, 33 h of CPU each over 4 days of uptime (memory
`s23-dsp-daemons-spin-at-100-percent.md:3`, with the 99.6% sample at `:12`). Every thermal number on
this phone carries that background.

**Today:** governor off by table (`V73: false`), not by measurement.

### 3.3 Jelly Star: Helio G99, Mali-G57 MC2

**Corrected: the Mali lane is closed, by measurement and by owner decision.** The earlier draft
reopened it under a heading that presented itself as a correction. On disk: the portability gates
ran and are marked DONE (`scratchpad/agents/q26b-mali-probe/REPORT.md:3, :174, :268`; Gate 3
"portability patch (quant kernels on Mali)", Gate 4 "op-perf on green paths"). After the patches,
dense quant kernels still fail on architecture gaps: `q4_0` SIGILL 132, `q4_K`
`CL_INVALID_WORK_GROUP_SIZE` (−54), `q6_K` SIGILL 132 (`:218-221`); the patch made class-1 kernels
*parse* but is not enough for the ship path (`:252, :260`). The owner **parked G57-class on
2026-08-22** (`archived/ALIVE-2026-09-full.md:445`: "OWNER DECISION 22/08: PARKED on G57-class …
Reopen when a G610/G615 MC6 device is in hand"). The "half a day of PC plus 30 minutes of Jelly"
estimate for finishing the lane is therefore **superseded**: it was written before the
architecture-gap result and it reopens a lane the owner closed.

What survives from the lane: the allow-list was the first blocker (`GGML_OPENCL_ALLOW_UNKNOWN_GPU`;
branch `kalsa/mali-probe`, never to be merged), and f32 MUL_MAT passes 202/202 against the CPU
reference (`archived/ALIVE-2026-09-full.md:445`).

**Identity, corrected.** The Mali is a **G57 MC2** (`scratchpad/agents/q26-mali-gate/REPORT.md:5, :69`,
on-device driver string), 2 CU. **The `1100 MHz` figure is wrong**: no local artefact records it as
the G99 clock; the corpus records `1.0e9 assumed max` for the G99 and a NotebookCheck *range*
`680–1100 MHz` (`scratchpad/agents/q26b-mali-probe/REPORT.md:307`), so 1100 MHz is the top of a
range flattened into a spec. (The audit's three external URLs are not re-fetchable offline; the
local artefacts decide the point.)

**No tok/s exists on this lane.** `llama-bench` was not run, there is no f32 GGUF on the phone, and
the quantised path aborts. Do not cite a Mali prefill number: none exists.

**Today**, with the shipped APK, the Jelly has no accelerator: 8 GB total trips `total <= EIGHT_GIB`
⇒ `NoFit`, and `Unknown` generation turns the governor off first.

**Measured:** `Thermal Status 3` (SEVERE) in **9 minutes** from cold, battery still at 51%, drain
about **40 points/hour** under load (`archived/PLAN-2026-09-full.md:1603`). The limit is thermal,
not charge.

**The only lever is the CPU itself:** fewer threads, small cores only, a frequency cap, or
intermittent work.

**Online research, 2026-09-19: outcome.** The GPU is disabled by default but not because it does
not exist (above). **UNSOURCED (external, plan-only):** the published Vulkan Mali-G57 figures
`0.79 / 0.86` against `2.44 / 2.29` tok/s; the "91% after 15 min / 95% after 30 min / 99.4–99.5% on
Wild Life" retention on normal-size G99 phones; and the Snapdragon 730G thread sweep
`1.05 / 4.41 / 6.81 / 5.26` and `18.0 → 13.7 tok/s`. The audit recorded them from URLs that are not
archived locally and the re-check could not re-fetch them; what would settle them is archiving the
pages or re-running the measurement. The *conclusion* they supported (for decode, fewer and bigger
cores win because decode is memory-bandwidth-bound) is already implemented:
`src/engine/deviceTuning.ts:208` sets `decodeThreads: 2, prefillThreads: 8` for `helio-g99`, and the
preset is selected by a `cpu_capacity` signature, not by brand name, which is the Rule 1 pattern.

**Trap that stands:** slower is not automatically cooler. The criterion is **°C per 1000 tokens**,
never °C per minute.

**Recommendation for the Jelly (medium-low confidence, declared):** GPU off by default; decode on
the A76 pair (already so); the thread and frequency policy decided by our own fixed-token test, not
by the literature; read thermal severity **and** the live frequency cap together; use real cooldowns
instead of micro-intermittency.

## Part 4: Thermal calibration per device

The hardest problem, because the numbers needed are not on a table and cannot be asked of the OS.
Three roads, with their price:

**(a) Shipped table, one row per known device, conservative default for the rest.** Simple, zero
runtime cost. It covers only the phones we hold; the conservative default means "CPU only" for the
rest of the world.

**(b) First-run calibration.** A short prefill per engine, measure ΔT, save. **UNSOURCED** cost
estimate: "tens of seconds and some heat" has no timing cell; what would settle it is measuring one
calibration run per engine on the Xiaomi. Risk: measured in one condition, used in all of them.

**(c) Continuous learning.** Every real turn is a measurement: tokens, engine, ΔT; update a moving
average per `(device, engine, phase)`. Near-zero cost, and the only road that survives a system
update changing the DVFS curves underneath us. Risk: the first turns run on an unknown value, so a
prudent initial value is required.

**Recommendation: (c) with (a) as the initial value.** What must be measured in every case is **°C
per 1000 tokens**: never °C per minute, and never a whole-process ΔT that includes model loading,
which is the error that produced the q58 values used today.

## Part 5: Defects to fix before measuring

Owner, 2026-09-19: testing a broken governor is pointless. Each defect is a code fact with a line
citation re-checked against the current trees.

**5.1 The CPU fallback above the threshold.** `llama-governor-runtime.cpp:55-63`: the table refuses
for heat and the fallback is the hottest engine, unsplit. **Fix:** refusal must reduce tokens, not
change engine; if no safe chunk exists, declare the pause.

**5.2 The charger poisons the governor.** `GovernorBatteryModule.kt:62-66` sends `plugged` and
`sensorValid` but not `t_idle_valid`; the parser defaults it to `false`
(binding fork `Aspis0/llama.rn`, `cpp/rn-governor-params.cpp:86`); `profile_is_valid` requires
it when `plugged` (`llama-governor-policy.cpp:59-63`). So `plugged = true` ⇒ profile `Invalid` ⇒
`Abort` ⇒ `failed = true` (`llama-governor.cpp:152`), which is sticky, so every later completion
throws (`:164`). **Fix:** either send real `t_idle_c` / `t_idle_valid`, or stop requiring them on
the `plugged` branch; and `failed` must not be terminal for a transient condition such as a plugged
cable.

**5.3 The battery floor inverts the route.** `llama-governor-runtime.cpp:65-68`:
`requested == CPU` produces `Admit`, which lands on `prefill_route_ = GPU`. The floor changes a
telemetry string and nothing else.

**5.4 Unreachable lanes.** `select_decode` requires thirteen simultaneous clauses
(`llama-governor-policy.cpp:228-256`), including `generation == V73` (while the app enables only
V75 and V79), plus `cool_delta_measured`, `kexp_cool_scope` (never serialised) and
`reload_budget_available` written `false` by hand. The "hot → move decode to GPU to cool down" lane
is unreachable on every phone. The same holds for `GPU_COOLMODE` in prefill and for the NPU lane
(the parser throws).

**5.5 A prompt of 129, 257 or 385 tokens truncates the answer.** The chunking algorithm leaves a
remainder of 1 token; a remainder of 1 returns `-2` (`llama-governor-runtime.cpp:96-99`), which is
not classified as a governor failure, and generation stops. The user sees the answer truncate with
no error.

**5.6 CRITICAL has no exit.** After entering CRITICAL, the first decode latches `failed`; the
recovery branch at `llama-governor-policy.cpp:118-121` is reachable *as policy* but useless once
`fail()` sets `failed = true` (`llama-governor.cpp:152, :164`). The first **prefill** aborts
identically, since under CRITICAL `admit_prefill` returns `Abort` (`llama-governor-policy.cpp:188-192`).
Also `critical_exit = 34.0 °C` is **colder** than `warm_exit = 36.0` in the unplugged threshold
tuple (`src/llama-governor-policy.cpp:42-49`; `k_warn_c` / `k_limit_c` / `k_kill_c` at `:10-12`):
leaving the worst state requires a colder phone than leaving the mild one; `k_kill_c = 43.0` is dead
by construction.

## Part 6: The measurement plan

Criteria deposited before measuring, per lab rule.

### 6.1 Instruments, and why these

| instrument | what it proves | declared limit |
|---|---|---|
| `/sys/class/kgsl/kgsl-3d0/gpubusy` | that the GPU really works | global, not per-process: attribution by time correlation. Baseline **UNSOURCED** (Part 7) |
| `scaling_max_freq` per cluster | real throttling | do not sample during a turn |
| `dumpsys battery temperature` | slow thermal | tenths of a degree, high inertia |
| skin from logcat (`AurogonBandwidthController`) | fast thermal | HyperOS only |
| engine native log (`graph splits`, buft) | where the tensors are | the engine describes itself |
| `KALSA_GOVERNOR` | *why* it decided that | the app talking about itself: the weakest evidence |

**`dumpsys thermalservice` is not an instrument on these phones:** the 2026-09-20 census records 29
tracked samples reading `Thermal Status: 3` (`scratchpad/agents/governor-audit-recheck/REPORT.md:146,150`)
while the earlier draft claimed zero (scope and reproducibility caveat in Part 1.1).

### 6.2 The cells, in order

1. **Xiaomi, governor probe with the repaired APK.** Goal: *does the governor engage, yes or no.*
   Success: at least one `KALSA_GOVERNOR` line without `fallback_reason`, and `gpubusy` leaving the
   baseline inside the prefill window. If `gpubusy` stays flat while telemetry says "governor
   active", the conclusion is "it engages but does not use the GPU", a different result to write
   differently.
2. **Xiaomi, ΔT per isolated cell** at 128 / 512 / 1024 / 2048 tokens (the engine's table sizes,
   `src/llama-governor-policy.cpp:14`), per engine, each starting from the same idle temperature.
   This is the missing measurement that must replace the S23 constant.
3. **Xiaomi, paired plugged / unplugged at equal work.** Never done on any phone.
4. **S23, GPU prefill on the 740**, with the `adsprpcd` background declared alongside.
5. **Jelly**, only after the research: do not burn battery rediscovering something known.

### 6.3 Stop rules, unchanged

Thermal status >= 3, or battery >= 43 °C unplugged, or level < 25% (lab stop rules, recorded in
`archived/PLAN-2026-09-full.md:1273` for the 43 °C / status line and `:1319` for the 25% level). On
the Xiaomi: never turn the screen off (it has a password), never reboot, stop if
`mWakefulness=Asleep`.

## Part 7: The empty boxes, said before filling them

- **No in-app GPU measurement on the Xiaomi**, prefill or decode: all GPU numbers come from
  `llama-bench` on the command line. The governor is the only road to an in-app number, and until
  recently it aborted.
- **No paired plugged / unplugged at equal work**, on any phone.
- **No per-cell isolated ΔT** at 128 / 512 / 1024 / 2048 on the Xiaomi.
- The Xiaomi `2630400` cap: whether it is the vendor's idle or still cooling is unknown.
- **"GPU prefill 5.77×"** is contradicted by the better-controlled rerun that gives **3.18×**. Both
  measured; use 3.18×.
- GPU prefill on the **S23 / Adreno 740** has never been measured in-app.
- The **NPU** has never been exercised inside the app on any phone.
- **Baseline `gpubusy ~7,5%`: UNSOURCED.** it appears only in the plan; the corpus's only
  `gpubusy` value is `~49%`, hand-transcribed and already flagged `PLAUSIBLE (unevidenced)`
  (`scratchpad/agents/n10-kexp-audit/REPORT.md:42, :79`). What would settle it: a 60-sample
  `cat /sys/class/kgsl/kgsl-3d0/gpubusy` trace, screen on, app idle, archived.
- **`cpu7 scaling_max 1824000`**: narratively sourced (`archived/PLAN-2026-09-full.md:1573`), not
  raw-sourced; what would settle it is one archived raw sysfs capture (Part 1.1).

## Part 8: Open questions for the owner

1. **The speed floor.** Below how many tok/s in decode is an answer unacceptable? It is the
   constraint that decides when the governor may choose the cool engine over the fast one.
2. **What the user sees when the phone is too hot.** Today: an exception. Alternatives: a slower
   answer without saying so, or an honest line ("slowing down, the phone is hot").
3. **Calibration (Part 4):** shipped table, first run, or continuous learning.
4. **Does the NPU come back in M1 or M2?** On the Xiaomi it is the fastest prefill engine we have
   measured, and today it is disabled by construction in two places.
5. **Is the Jelly a target or a corner case?** If a target, the CPU-only intermittent policy must be
   designed; if a corner case, the governor turns off and says so.

## Part 9: Order of work

| # | what | depends on | outcome |
|---|---|---|---|
| 1 | Fix 5.1, 5.2, 5.3 | — | the governor stops doing the opposite of itself |
| 2 | GPU probe = real compilation + clean degradation | 1 | no more `exit(1)` in-app |
| 3 | Runtime probe on the Xiaomi (M1.3) with `gpubusy` | 1, 2 | **we know whether the governor engages** |
| 4 | Per-cell ΔT on the Xiaomi | 3 | the numbers to replace the S23 constant |
| 5 | The other three probes + the capability record | 3 | the governor stops reading tables |
| 6 | Per-device calibration | 4, 5 | the policy becomes per phone |
| 7 | **Shape refactor (Part 2b)**: one selector, matrix as data, identity out of decisions | 3 | adding a phone costs one data row again |
| 8 | 5.4, 5.5, 5.6 (dead lanes, 1-token chunk, CRITICAL) | 7 | **absorbed by the refactor**, not patched separately |
| 9 | S23 and Jelly | 7, Jelly research | the two phones currently excluded by table |

Steps 1-3 are M1. From 4 on we enter what the owner calls "the governor knows which phone it is on".

**Why the refactor is at 7 and not at 1:** 5.1 / 5.2 / 5.3 are three surgical fixes on lines the
refactor would rewrite anyway, and without them **M1.3 cannot even be attempted**: the governor
aborts the moment the cable is plugged in. Doing them first costs few lines and unblocks the
measurement. The boundary is sharp: **the refactor must land before the fourth phone and before the
NPU lane**, otherwise we pay the seven places every time; and 5.4 / 5.5 / 5.6 are symptoms of the
shape, not separate bugs to patch by hand.

## Verification status

The 2026-09-19 audit's accusations were re-read on the artefacts on 2026-09-20. Full record:
`scratchpad/agents/governor-audit-recheck/REPORT.md`.

| # | accusation | verdict | reconciliation |
|---|---|---|---|
| 1 | the `0,992` "retraction" is itself the error; the value is ours | **SUPPORTED** | `q16-xiaomi/REPORT.md:4, :336, :378`; corrected in Part 3.1 |
| 2 | Part 3.3's Mali state is superseded: gates 3 and 4 ran; owner parked G57 | **SUPPORTED** | `q26b-mali-probe/REPORT.md:3, :174, :268, :218-221`; park at `archived/ALIVE-2026-09-full.md:445`; corrected in Part 3.3 |
| 3 | the NPU `+1,3 °C` is the whole cell's rise (HTP +0.4, CPU +0.9) | **SUPPORTED** | `results/htp_prefill/xiaomi_v75/cell1/battery_series.csv:2-6`; corrected in Part 1.4 / 3.1 |
| 4 | the `Thermal Status 0 in every sample` census is false | **SUPPORTED**, with a precision caveat | tracked census `1252 / 6 / 4 / 29`; the audit's `1263 / 28 / 11 / 9` is the main working tree including gitignored files; corrected in Part 1.1 |
| 5 | the 4B thermal deltas cite a contaminated source and the wrong night | **SUPPORTED** | `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt`; `results/xiaomi_ab/task_a/CONTAMINATED_4B.md`; corrected in Part 3.1 |
| 6 | the 18/08 "10 reps per direction" is the prefill design, not decode | **SUPPORTED** | `results/gpu_prefill_recheck_xiaomi/report.md:20-32, :42, :48-53`; corrected in Part 3.1 |
| 7 | Mali-G57 MC2 is right; `1100 MHz` is wrong | **SUPPORTED locally** | `q26-mali-gate/REPORT.md:5, :69`; `q26b-mali-probe/REPORT.md:307`; the audit's external URLs are unverifiable offline; corrected in Part 3.3 |
| 8a | `cpu7 1824000` appears only in the plan | **REFUTED, the audit was wrong** | `archived/PLAN-2026-09-full.md:1573` records it (narratively); the value is out of the unsourced pair and into Part 1.1 as narrative-sourced |
| 8b | `gpubusy ~7,5%` appears only in the plan | **SUPPORTED** | kept as **UNSOURCED** in Part 7 |
| 9 | six `file:line` drifts and two prose over-claims | **SUPPORTED** | line numbers corrected throughout: `generationFor` 62-75 (six tests, not three), `gpuFit` 84-121, `buildGovernorParams` 123-144 (ten keys, not nine), `admit_prefill` 184-226, `select_decode` 228-256, q58 rows 29 / 31 / 33 / 35, `rn-llama.cpp` 76 (snapshot-dependent) |

### Numbers corrected or deleted by the re-verification

| old claim in the audited draft | status now |
|---|---|
| NPU prefill `ΔT +1,3 °C` | corrected: whole cell +1.3 °C = HTP +0.4 + CPU +0.9 |
| "Thermal Status 0 in every sample", `12/12`, `15/15`, `results/htp_*` | deleted; replaced by the tracked census `1252 / 6 / 4 / 29` |
| 4B deltas from `task_a/battery_notes.txt` | moved to `task_a_4b_clean/battery_notes.txt`; values +2.4 / +3.5 / +1.7 (CPU) and +0.4 / −0.7 / −0.3 (GPU) |
| 18/08 decode "10 repetitions per direction" | corrected to 2 interleaved pairs; ratio 0.66× (n=2) |
| Mali `1100 MHz` | deleted; local corpus says `1.0e9 assumed max`, NotebookCheck range 680–1100 MHz |
| `0,992` not ours / named board QRD8650 | corrected: it **is** the Xiaomi `houji`; the other 0.992 is QRD8750 / Adreno 830 |
| Part 3.3 "two named defects, half a day of PC" | corrected: gates 3 and 4 DONE, architecture gaps remain, owner parked G57 on 22/08 |
| `cpu7 1824000` marked unsourced | corrected: narratively sourced at `archived/PLAN-2026-09-full.md:1573`; raw sysfs capture still missing |
| `gpubusy ~7,5%` | kept, explicitly **UNSOURCED** |
| `governorInputs.ts` 60-75 / 78-118 / 120-145 | corrected to 62-75 / 84-121 / 123-144 |
| `admit_prefill` 180-225, `select_decode` 227-252 | corrected to 184-226 / 228-256 |
| q58 rows cited as `REPORT.md:31-35` | corrected to `:29, :31, :33, :35` |
| `rn-llama.cpp:69` for `n_gpu_layers = 99` | corrected to `:76` (snapshot-dependent) |
| "nine fields" | corrected to ten (including `reason`) |
| "three regexes" | corrected to six `.test()` calls |
| `RNLlamaJSI.cpp:43-44` for the `t_idle_valid` default | corrected to fork `Aspis0/llama.rn`, `cpp/rn-governor-params.cpp:86` |
| `ModelRegistry.ts:229 / :259` | corrected to `:232` (13312) and `:262` (6656) |
