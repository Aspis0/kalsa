# Kalsa Brain

Desktop app that lets a phone use the computer it already owns as its model.
The user installs one thing and answers no questions: the app measures the
machine, decides what it can usefully run, fetches it, and serves it to the
phone.

The React chat in `chat/` is the desktop frontend, over a set of small crates
that each decide one thing and can be tested without hardware.

The plan behind it is the product spec; this README is only how to build and
test what exists today.

## Layout

```
crates/kalsa-supervisor/   the inference server's lifetime: spawn, readiness,
                           shutdown, and recognising our own orphan instead of
                           killing a stranger that inherited its pid
crates/kalsa-probe/        what this machine can do, measured once: memory
                           bandwidth to a plateau, compute, and which backend
                           will really run. Every number carries the execution
                           path it describes, because one that does not is how
                           a CPU-only figure under-predicted every Mac by 3-4x
crates/kalsa-catalog/      which model this machine should run, and why - pure,
                           no hardware, no I/O, no download
crates/kalsa-download/     getting a model file here once, safely: resumable,
                           digest-verified before it is published under its
                           final name, and refusing rather than filling a disk
crates/kalsa-runtime/      which server build this machine needs, and proving it
                           runs before any weights are fetched
src-tauri/                 the app shell: commands + config, no logic
chat/                      the Vite + React + TypeScript desktop frontend
NOTICE                     what came from Jan (MIT) and what did not
```

## Build and test

```sh
cargo test -p kalsa-supervisor      # the supervisor: fast, no network, no model
cargo check -p kalsa-brain          # the app shell
cargo run -p kalsa-brain            # opens the window
```

Running the app needs a server binary and a model, because model selection and
download are later pages:

```sh
KALSA_BRAIN_MODEL=/path/to/model.gguf \
KALSA_BRAIN_SERVER_BIN=$(command -v llama-server) \
cargo run -p kalsa-brain
```

Without `KALSA_BRAIN_MODEL` the switch reports that no model is selected yet.
`KALSA_BRAIN_SERVER_BIN` is a development override: a shipped build carries
`llama-server` next to its own executable.

## What the supervisor guarantees

- **Readiness is a probe, not a sleep.** `llama-server` has no startup line to
  read, so the supervisor polls `/health` until its deadline. A guessed `sleep`
  is either too short (first request fails) or too slow (the user waits on a
  server that is already up).
- **Stopping is ordered.** Close the child's stdin (the signal a cooperating
  child waits for), then SIGTERM to its process group, then SIGKILL. Always
  reaped, so no zombie survives a stop.
- **The child can die on its own.** `GGML_ASSERT` calls `abort()`, which
  `catch_unwind` does not contain — an inference crash takes down its host. The
  supervisor watches the child and reports the exit, with the last lines of its
  stderr, without taking the app down.
- **Defaults for old hardware.** Half the logical cores (2..8), batch 512,
  ubatch 128, `--sleep-idle-seconds 300`, host `127.0.0.1`. The objective is the
  highest sustainable throughput, not the maximum.

### Force-quit, per platform

| platform | what stops the child when the app is killed |
| --- | --- |
| Windows | job object with `KILL_ON_JOB_CLOSE`: the OS reaps it |
| Linux | `PR_SET_PDEATHSIG`: the kernel signals it when we die |
| macOS | **nothing.** No job object, no `PR_SET_PDEATHSIG` |

On macOS a force-quit can leave an idle `llama-server` behind. It is not
burning CPU — `--sleep-idle-seconds` unloads the model and the KV cache — so it
is handled at the next start, not at the crash:

* the state file is locked for as long as our server runs, and the lock is
  **inherited by the server**, so a held lock means "our server is alive" even
  when the app was killed outright;
* locked and answering → the app reuses it: no second model load;
* locked and silent → it is ours and wedged, so it is closed and replaced;
* unlocked (a crashed run) → the pid inside is *not* trusted and never
  signalled — pids are recycled, and killing a stranger is unacceptable. The
  file is discarded and the port checked instead;
* a port held by anything that is not ours is reported in words and left alone.

Closing the window normally is covered everywhere: the app's exit handler calls
`Supervisor::shutdown`, which stops the child before the process goes.

## The probe: predicting a model before downloading it

`kalsa-probe` measures the machine once, so the catalog can predict any model
before the user waits for gigabytes.

```sh
cargo run --release -p kalsa-probe          # a few seconds
cargo run --release -p kalsa-probe -- --threads 1 --reps 10
```

Two measurements, kept apart on purpose:

* **bandwidth** — streaming reads of a block larger than any cache. Decode is
  bandwidth-bound: one token reads every active weight byte once, so
  `tokens/s ≈ efficiency × bandwidth / active_bytes`. The thread count is not
  assumed: **a ramp** measures 1, 2, 4 … threads and reports the first count that
  reaches the plateau. A datasheet number is fantasy on a single-channel laptop,
  which is why it is measured and not quoted.
* **compute** — a dense f32 matmul, because **prefill is compute-bound** and
  predicting it from the bandwidth figure would be wrong, and wrong in silence.

Every number comes with its spread (`Series`), and the estimator for a capability
measurement is the **best sample**, not the median: competition can only make a
sample slower, so the fastest repetition is the closest we get to the machine.

**A number that does not say which path it measures is how the wrong answer got
out once.** The result carries both facts, as data:

* `measured_on` — the path the numbers came from, `Cpu` today;
* `will_run_on` — what detection says this machine offers: `Metal` on Apple
  Silicon, `DiscreteGpu { vram_bytes }` when a discrete NVIDIA/AMD card is found,
  `Cpu` when there is none, `Unknown` when no cheap honest answer exists;
* `bandwidth_is_lower_bound()` — true when the machine will run on something
  faster than the path measured, so the catalog can branch on it instead of
  parsing a sentence.

On Apple Silicon this matters by 3–4x: the SoC's memory bandwidth (an M1 Max is
specified at 400 GB/s) is reachable from the GPU and not from the CPU, and
llama.cpp decodes through Metal there, so the CPU figure is a floor. On an old
integrated GPU the CPU is the correct answer rather than a fallback, and on a
discrete card the budget is VRAM, not system RAM — which is why one number could
never have been enough.

The probe refuses its own bad measurements: repetitions that disagree, a ramp
that never flattens, a memory reading faster than the cache, or threads that did
not get their cores all make the verdict `unreliable`, and the caller retries
rather than reporting a low number as a fact about the machine. What no
invariant can do is tell "slow machine" from "busy machine" in absolute terms,
and that is why the answer is a verdict instead of a table of what each CPU class
should reach.

The remaining honesty: the formula ignores traffic the model really pays — the KV
cache is re-read every token and grows with context (the largest omission for a
MoE, whose active weights are small), attention costs more as context grows, and a
router adds reads. `EFFICIENCY_BAND` (0.7–0.9) is a prior for that, not a
constant. So the number pre-filters a catalog; it does not promise a figure.
Nothing here has been validated against real inference yet: that needs a real
model benchmarked on the machine.

## The catalog: which model, before downloading anything

`kalsa-catalog` looks at a measured machine, the phone's own model, and the
researched rows, and answers with a model **and a reason**.

```sh
cargo run -p kalsa-catalog -- --ram 32 --bandwidth 85 --gflops 100 --phone-gb 2.64
```

The rules are pure and tested without hardware:

* **two axes, two types.** Total weights decide whether a model fits, active
  weights decide how fast it decodes. On a MoE they differ by up to ten, so
  `TotalParameters` and `ActiveParameters` are separate types and swapping them
  is a compile error rather than a wrong recommendation.
* **licence is a door, not a column.** The chooser only accepts a
  `UsableEntry`, and only `manifest::usable()` produces those, for rows whose
  licence allows what this product needs. The refused rows stay in the catalog
  with their reason: `amd/Instella-MoE-16B-A3B-Think` is research-only, and the
  2025 rows are superseded.
* **the PC must beat the phone.** A candidate needs at least 1.3× the phone
  model's weight, and has to decode at 3 tokens per second or more at the *low*
  end of its predicted range. If nothing clears both bars, the answer is "this
  computer is not worth it", in words — there is no courtesy tier.
* **say why, with the numbers.** Every decision carries a sentence naming the
  model, the decode and prefill ranges, the phone's own measured speed when it
  reports one, and that the cache size is still an assumption. Speeds are always
  ranges: from an approximation, a single figure would be invented precision.

Memory arithmetic (`footprint`): weights + mmproj + compute buffers + KV +
margin ≤ RAM, where the margin is `max(3 GiB, 25%)` — a current OS idles around
3 GiB and a browser adds more, and no fraction of an 8 GiB machine covers that,
while on 64 GiB a quarter is more than the OS will ever want.

## Licence

Apache-2.0 for this shell. Parts of `crates/kalsa-supervisor/src/child.rs` are
derived from Jan's MIT-licensed `tauri-plugin-llamacpp`; see `NOTICE` for
exactly which parts and under what terms.
