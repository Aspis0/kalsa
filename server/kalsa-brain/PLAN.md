# Kalsa Brain — desktop server for the phone

Turn a PC the user already owns into the model behind Kalsa on their phone.
Windows and macOS. Three pages. No terminal, no config file, no vocabulary.

The user we are building for does not know what a quantization is, has never
heard of a KV cache, and will not read documentation. They have an old laptop
in a drawer and a phone in their hand.

## 1. The one rule that orders every other decision

**The PC must beat the phone, or it should not be offered at all.**

Kalsa already ships a model on the phone (2.83 GB, `ModelRegistry.ts:187`).
A PC that runs something equivalent is not an upgrade — it is a second copy of
the same answer, bought with a fan spinning in another room. So the catalog is
not sorted by "what fits in RAM". It is sorted by "what is stronger than what
this person already has for free".

Consequences:

- The desktop app must **know which model the phone runs**. The pairing
  handshake carries it.
- **There is no courtesy tier.** If the machine cannot beat the phone, the
  honest answer is "this computer is not worth it", and we say so.
- Two independent axes in the catalog: **total weights** decide whether it
  fits, **active weights** decide how fast it runs. On a MoE these differ by
  up to 10x, and conflating them is how you promise speed you cannot deliver.

## 2. The second rule: do not damage the machine

The target is old hardware — the floor is Haswell (2013), below which there is
no AVX2 and llama.cpp is not worth running. Those machines may have dried
thermal paste, clogged fans, and a battery that no longer buffers current.

So the objective function is **not** maximum tokens per second. It is the
**highest throughput that is sustainable** on a machine we cannot inspect.
A default tuned for a healthy desktop is not a bad review on an old laptop,
it is a dead laptop.

This is why every default is chosen for the worst case, and why the server
sits idle almost all the time: load on demand, unload after inactivity.

### Thermal safety without a kernel driver

Reading CPU temperature on Windows requires a kernel-mode driver. That path
is closed for us: licensing and signing both make it unshippable.

So we do not measure the cause, we measure the **symptom**: throughput decay.
If the same work produces meaningfully fewer tokens per second than the
machine's own measured baseline, the machine is throttling — and it does not
matter whether the cause is heat, power limits, a background update, or a
failing fan. We reduce thread count or batch size and keep going.

This has a property temperature does not: it is readable on every OS, with no
privileges, and it degrades gracefully on hardware we have never seen.

**It must say so out loud.** A silent downgrade is the same defect class as a
truncated message with no marker: the user is left with a worse result and no
way to know why.

## 3. The three pages

**Page 1 — Status.** Is it on, is the phone connected, what is it running.
One switch. The Tailscale model: the interesting page is the boring one.

**Page 2 — Model.** What we chose, why, and how it compares to the phone.
One honest sentence, not a specification sheet. An "advanced" disclosure for
people who want the numbers, closed by default.

**Page 3 — Pairing.** How the phone finds this computer.

Nothing else ships. Every fourth page is a feature we did not have the
courage to decide for the user.

## 4. Choosing the model

The footprint math already exists in the phone app (`src/engine/memoryEstimate.ts`)
and is the same physics on a PC:

```
weights + compute buffers + KV cache + headroom <= usable RAM
```

Two things that formula gets right and a naive one does not:

- Compute buffers scale with ubatch, not with model size.
- **KV per token must be measured, not derived.** Hybrid and recurrent models
  filter layers out of the cache, so `n_layer x n_ctx x n_embd` overestimates.
  We measure once per model and store it in the manifest.

Then: **benchmark on the actual machine.** Published tok/s figures for these
models on old CPUs essentially do not exist — the catalog research found one
public measurement across the entire shortlist. That absence is not a gap in
our research, it is the opportunity: nobody can tell this user what their
2014 laptop will do, and we can, in a few seconds, on their machine.

### Tiers (RAM of the machine, CPU-only baseline)

Floor for the catalog: nothing under 4B parameters. Below that we are not
beating the phone.

| RAM | what it is for |
| --- | --- |
| 8 GB | the entry point — meaningfully bigger than the phone, tight but real |
| 16 GB | comfortable dense models, room for context |
| 32 GB | the first real jump: MoE with few active parameters |
| 64 GB | large MoE |

Candidates are re-verified for **freshness and licence** before shipping —
`lastModified` and `cardData.license` from the HuggingFace API, never from
memory. A model older than ~6 months must be justified, not defaulted to.

Licence sits next to every entry from day one, because it decides whether a
paid fine-tune of that base will ever be possible. A recent MoE that fits a
16 GB machine exists, but its licence is research-only — which is exactly why
the column is not optional.

## 5. Backend-agnostic from the first line

The runtime is one of N: llama.cpp server, ollama, MLX on Apple Silicon.
Nothing above the transport may assume which one is running.

The phone already speaks OpenAI-compatible HTTP, so the surface exists. What
must not happen is a second hardcoding of one vendor — the mistake we already
made once by shipping `http://127.0.0.1:8000` as a default, a developer's
address with `adb reverse`, useless on a real phone.

## 6. Licence split

**Open (Apache-2.0):** the shell, the UI, process lifecycle, the llama.cpp
integration, upstream contributions. This is most of the work.

**Closed:** model selection logic, the manifest with measured `kvBytesPerToken`,
the driver/backend blocklist, the benchmark method and its results, the
footprint formula. This is the hard part and it is what makes paid fine-tunes
possible later.

The boundary runs through **prompts**, not files: a brief that explains our
selection criteria while asking for a change to a public file gives the secret
away regardless of which repository it touches.

## 7. What we are not building

No chat UI on the desktop — the phone is the client.
No account, no cloud, no telemetry by default.
No GPU-first design: the baseline is CPU, and a GPU is a bonus we detect.
No "expert mode" that is really an excuse for not making a decision.
