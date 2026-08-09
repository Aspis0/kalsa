# CPU affinity does not exist on Android (and llama.rn pins into the void)

Measured and confirmed 2026-08-09. Read this before touching anything that talks
about "pinning threads to the fast cores" — that mechanism has never been active
in this app, on any phone.

## What ggml actually does

`ggml/src/ggml-cpu/ggml-cpu.c` picks the affinity implementation like this:

```c
#if   defined(_WIN32)          // real implementation
#elif defined(__APPLE__)       // no-op (documented: not supported on Apple)
#elif defined(__gnu_linux__)   // real implementation (sched/pthread affinity)
#else // unsupported platforms
static bool ggml_thread_apply_affinity(const bool * mask) { UNUSED(mask); return true; }
static bool ggml_thread_apply_priority(int32_t prio)      { UNUSED(prio); return true; }
#endif
```

`__gnu_linux__` is a **glibc** macro. Android is **Bionic**, so the NDK target
lands in the `#else` branch: affinity *and* thread priority are no-ops that
**return `true`** — they fail while reporting success, which is why nobody noticed.

## What that means for Kalsa

`node_modules/llama.rn/cpp/jsi/JSIParams.cpp:25-62` (`set_best_cores`) reads
`cpuinfo_max_freq` for every core, sorts by frequency, fills `params.cpumask`,
and sets `params.strict_cpu = true` / `params.mask_valid = true`.

All of that is discarded. **The only thing that survives is `params.n_threads`.**

So when reasoning about thread-count performance, there is exactly one lever —
*how many* threads — and none at all for *which cores*. Any explanation of the
form "the ggml barrier waits for the slow little core we pinned into the pool" is
describing something that does not happen.

## Three independent proofs

1. **Empirical.** On a Helio G99 (`cpu0-5` Cortex-A55, `cpu6-7` Cortex-A76), one
   thread masked to an A55 gives 11.30 tok/s prefill and one masked to an A76
   gives 11.38. Identical, while `/sys/devices/system/cpu/cpuN/cpu_capacity`
   reports 348 vs 1024 — roughly 3x. Impossible if the mask were applied.
2. **Preprocessor.** `clang --target=aarch64-linux-android33 -dM -E` defines
   `__linux__` and `__ANDROID__`, and does **not** define `__gnu_linux__`.
3. **Binary.** `llvm-readelf --dyn-syms` on an arm64 `llama-bench` built from the
   pinned checkout finds no `sched_setaffinity` and no `pthread_setaffinity_np`,
   while other pthread symbols are present — the affinity code was never compiled.

The same applies to `llama-bench`'s `-C/--cpu-mask` and `--cpu-strict` on Android:
the argument parsing and the threadpool wiring are correct, and it still does
nothing, because it dies in ggml. Do not label a benchmark arm "on the big cores"
without running the one-thread discriminator first.

## How this was caught, and the general rule

Every arm of a core-placement experiment returned the same number (~21 tok/s
prefill) no matter which cores were "selected". There was a tidy story available —
"the workload is memory-bandwidth bound, so the cores do not matter" — which is
plausible, sellable, and would have been wrong.

**Before believing a null result, prove the instrument responds.** The cheapest
discriminator (one thread on the weakest core vs one thread on the strongest)
takes a minute and would have prevented six published tables with an invented
column.

## Consequences still open

- The measured Snapdragon 8 Gen 3 result (6 threads beating 4 by 26–32%) is a
  **thread-count** effect, not a placement effect, and should be re-measured with
  the standalone binary rather than through the app.
- The 8-thread collapse on that device (78 → 10.8 tok/s prefill, 0.06 tok/s
  decode) has **no accepted explanation**. The straggler theory is dead: on the
  Helio G99, eight threads including six slow cores give the *fastest* prefill.
  Current hypothesis, untested: with neither affinity nor priority control, eight
  compute threads on eight cores leave nothing for `system_server` or the app's
  UI/JS thread, so 0.06 tok/s is a starvation signature rather than a barrier
  signature. The decisive experiment is to run the standalone binary at `-t 8` on
  that phone: if the binary is fine while the app collapses, the cause is system
  CPU starvation, not ggml.
- Whether real pinning would help at all is unknown. On the Helio G99 the kernel's
  EAS scheduler already places two threads on the big cores by itself. We build
  llama.rn from source (`KALSA_LLAMA_FROM_SOURCE=1`, with a binary assertion in
  CI), so extending the guard to `__linux__` is a patch we can make — but only
  after measuring that it buys something.
