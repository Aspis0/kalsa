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
## It was measured: fixing the guard buys +26% prefill

Changing `#elif defined(__gnu_linux__)` to `#elif defined(__linux__)` (one line;
the branch already contains an `#ifdef __ANDROID__` path calling
`sched_setaffinity`, written for Android and never compiled) makes affinity real.
`llvm-readelf --dyn-syms` then gains `sched_setaffinity@LIBC` and
`pthread_setschedparam@LIBC`, and the discriminator finally responds: one thread
on an A55 reads 3.95 tok/s against 11.43 on an A76 — a 2.89x ratio against the
2.94x that `cpu_capacity` predicts.

Controlled A/B on the Helio G99, same patched binary, one session, forward then
reverse, so affinity is the only variable (Qwen3.5-2B Q4_K_M, pp512/tg32):

| threads | pinned | unpinned | delta |
|---|---|---|---|
| 8 (`0xFF`) | 28.48 / 28.47 | 21.48 / 22.54 | **+26%** |
| 6 (`0xCF`) | 24.71 / 24.60 | 21.87 / 21.87 | **+12.5%** |

Temperature is excluded: the pinned 8-thread arm reads 28.48 at 27.0 °C and 28.47
at 32.0 °C, flat across the same drift that spans both unpinned arms.

Two consequences that cut against what this file's own thread rule assumed:

- **All cores is the best prefill configuration** on this SoC once pinning works
  (28.5 at 8 threads > 24.7 at 6 > 21.2 at 2). "Never use all cores, leave the
  little cluster out" was a rule about a mechanism that was not running.
- **Prefill and decode want opposite configurations**: prefill wants all eight
  pinned, decode wants the two big cores alone (6.39 vs 6.07). llama.cpp already
  separates `n_threads` from `n_threads_batch`; the app currently sets them equal,
  which cannot be right for both.

The patch lives in the lab repo (`lab/llamabench/patches/ggml-android-affinity.patch`)
and is **not** ported into the product yet. We build llama.rn from source
(`KALSA_LLAMA_FROM_SOURCE=1`, with a CI assertion on the shipped binary), so
porting it is straightforward — but one SoC and one model is not enough to change a
default, and strictly pinning 8 of 8 cores in a process that also runs a UI and a
JS thread is exactly the configuration suspected in the unexplained collapse above.
Measure on the Snapdragon first.
