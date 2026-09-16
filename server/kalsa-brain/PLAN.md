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

### "Beat the phone" has a second axis: the phone's battery

Owner, 2026-09-14, on the 8 GB tier: *"a 8gb di ram potremmo quasi consigliare
di usare lfm sullo smartphone perche non conviene. (ma la batteria dello
smartphone ringrazia)"*.

That is the honest reading of section 4's table and it fixes what the tier is
for. An 8 GB machine running a 1B-active MoE is roughly a lateral move in
quality — but every token it generates is a token the phone did not generate,
so the phone stays cool and the battery lasts. **The PC can win on capability or
on not burning the phone, and those are different products.**

So:

- The 8 GB tier is offered as **relief, not as an upgrade**, and the app says
  exactly that. Selling a lateral move as a smarter model is the same failure as
  a truncated message with no marker: the user finds out later, on their own.
- Which means the refusal in "there is no courtesy tier" is narrower than it
  read: we refuse a machine that beats the phone on *neither* axis. A machine
  too weak to run a usable model at all is still a refusal.
- It also means the pairing handshake should carry more than the phone's model
  id: whether the phone is on battery is what decides if relief is worth
  anything. A phone on a charger gets no benefit from an 8 GB PC, and the app
  should not pretend otherwise.

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

**But it is a sentinel, not an interlock.** The signal is confounded by context
growth, by other processes, and by throttling that has nothing to do with heat.
So it never reacts to a single sample: fixed-prompt baseline, rolling window,
act only on sustained decay, hysteresis and cooldown, then reduce threads and
batch, and unload if it persists.

Where a platform gives us a real thermal signal for free, we use it as the
primary input and keep throughput decay as the portable fallback:

- **macOS:** `NSProcessInfo.thermalState` — system thermal state, no privileges,
  no helper. Not degrees, which is fine: we need a level, not a number.
- **Windows:** nothing equivalent. The PerfLib `Processor Information` counters
  (frequency, `% of Maximum Frequency`, `Performance Limit Flags`) are readable
  without a driver but none is documented as thermal-only, and
  `MSAcpi_ThermalZoneTemperature` depends on firmware, is sometimes stale, and
  sometimes denied without elevation. **Never use it as a safety interlock.**

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

⚠️ This table is the CPU floor. On a machine with a discrete GPU the index
is VRAM, not RAM — see section 4a.

Floor for the catalog: nothing under 4B parameters. Below that we are not
beating the phone.

| RAM | what it is for |
| --- | --- |
| 8 GB | the entry point — a small MoE, see below; the constraint is the budget, not the speed |
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

### The 8 GB tier exists, and it is a small MoE

The earlier reading — that an 8 GB machine has nothing worth offering, because a
4B dense Q4 is a sideways move from the phone's 2.83 GB model — was wrong. It
compared the wrong axis. A mixture-of-experts separates **total** parameters,
which decide whether it fits, from **active** parameters, which decide how fast
it decodes, and at this size they differ by five to eight times.

Verified 2026-09-14 against the HuggingFace API (`lastModified`, `cardData`) and
the exact byte size of the exact quant file; spot-checked again here by hand:

| model | total / active | verified quant | size | base licence |
| --- | --- | --- | ---: | --- |
| LiquidAI/LFM2.5-8B-A1B | 8.3B / **1.5B** | IQ4_XS | 4.273 GiB | LFM 1.0 — commercial use only below $10M revenue |
| microsoft/Phi-mini-MoE-instruct | 7.6B / 2.4B | Q4_K_S | 4.299 GiB | **MIT** |
| ibm-granite/granite-4.0-h-tiny | 7B / 1B | Q4_K_M | 3.940 GiB | **Apache-2.0** |
| arcee-ai/Trinity-Nano-Preview | 6B / 1B | Q4_K_M | 3.527 GiB | OpenMDW-1.1 (patent-termination clause) |

With 1.5B active parameters a token reads roughly 0.9 GB, so even a tired laptop
sustaining 20 GB/s decodes above 20 tok/s. Speed is not what makes this tier
hard.

**What makes it hard is the budget.** An 8 GB machine has about 5 GiB usable once
the OS is served, and the weights are only one of the four terms in the footprint
formula — KV cache, compute buffers and headroom come out of the same 5 GiB. So
4.27 GiB of weights is not "fits", it is "fits with nothing left for context".
The honest 8 GB pick is nearer 3.5 GiB of weights, which is exactly where Trinity
Nano and Granite H-Tiny sit, and it is why the tier's entry is decided by the
footprint formula and not by comparing a file size to 8.

Two caveats that belong next to the table, not in a footnote:

- **Licence decides more than distribution here.** LFM 1.0 permits commercial use
  only below a revenue threshold, which is a condition on *us*, not on the user,
  and it is the strongest candidate on quality. Phi-mini (MIT) and Granite
  (Apache-2.0) carry no such condition. That is the whole reason the licence
  column exists.
- **"Bigger than the phone" is still unproven for every row.** None of these has a
  published A/B against the model the phone ships. LFM2.5 and Phi-mini have the
  benchmark evidence to make it likely; Granite has an independent report calling
  its quality weak for its size. Section 4's rule stands: the comparison is what
  justifies the tier, so it gets measured on the machine, not assumed from a
  parameter count.

### There is no formula for "is this MoE stronger than that dense model"

Researched 2026-09-14; full report in `RESEARCH-moe-vs-dense-2026-09-14.md`.

The rule of thumb that circulates — effective size ≈ `sqrt(total × active)` — is
**uncited folklore**, most likely a misreading of Clark et al.'s *effective
parameter count*, which is a **fitted, task-dependent** quantity from a loss law
at a specified token budget and not a conversion between two numbers. Every
published MoE scaling law (Krajewski 2024, Ludziejewski 2025, Abnar 2025, Tian
2025) is conditional on training tokens, compute, granularity and routing, and
none of them produces "given total and active, use dense size f(total, active)".

⛔ **So the catalog implements no such formula, and nobody should add one.**

Worse for our smallest tier specifically: Jelassi et al. (*Mixture of Parrots*,
ICLR 2025) find that **below roughly 10B total parameters, at fixed active
parameters, extra experts help memorisation more than reasoning, and a MoE can be
*worse* than a dense model of the same total size** on commonsense and maths.
The 8 GB tier is exactly that regime, which is an argument for humility there
rather than for the bigger-looking file.

What is citable is **the publisher's own same-family comparison**, per row — a
lab comparing its MoE to a dense model it trained on the same recipe. That is
data about that model, not a rule, so it lives in the manifest beside the row:

- Granite 4.0 H-Tiny (7B/1B) sits near IBM's own **H-Micro dense 3B** — above it
  on GSM8K, DeepMind-Math and MBPP, below on BBH and IFEval.
- Phi-mini-MoE (7.6B/2.4B) sits near **Phi-3 mini dense 3.8B** on its own card's
  harness table, and clearly below Phi-3 small 7.4B on knowledge and reasoning.
- LFM2.5-8B-A1B and Trinity Nano publish no same-recipe dense comparison, so they
  carry none.

Both rows we can source land in **the phone's own class** — so the 8 GB tier
being relief rather than an upgrade is now an evidence-backed conclusion instead
of a cautious guess.

Where the numbers point clearly one way and nothing citable settles it — a large
MoE against a small dense phone model — the honest answer is neither claim:
**expected to be stronger, not yet measured**, said in those words, and resolved
by the bake-off in `scripts/quality/` on the user's own machine. That harness,
on the actual pair, is what replaces every proxy in this section.

## 4a. The GPU is not an optimisation: it decides the budget AND the speed

Measured here on 2026-09-14, on the M1 Max, 256 MiB streaming read, best of five
samples (contention can only push these down):

| threads | 1 | 4 | 5 | 8 | 12 |
| --- | --- | --- | --- | --- | --- |
| scalar u64 | 55.8 | 88.0 | 88.6 | **112.2** | 105.1 |
| 128-bit NEON | 56.5 | 87.9 | — | **110.8** | 109.0 |

Two readings, one of which is the important one:

- The first probe reported 83–86 GB/s only because it used `cores / 2` = 5
  threads. Widening the loads to NEON changes nothing, so ~110 GB/s is a real
  plateau, not an artefact of how we read memory.
- **The machine's ~400 GB/s is not reachable from the CPU at all.** It is the SoC
  figure, and on Apple Silicon only the GPU sees it. llama.cpp decodes through
  Metal on macOS by default, so a CPU-only probe under-predicts every Mac by
  3–4x — it would tell a Mac owner their machine is too slow for a model that
  in fact runs well. That is a wrong answer, not an imprecise one.

So **the CPU number is this product's floor, not its default.** The machines we
ship to split three ways, and they do not share a memory budget:

| class | what runs decode | memory budget | bandwidth |
| --- | --- | --- | --- |
| Apple Silicon | Metal, always | system RAM (unified) | SoC bandwidth, ~3–4x the CPU figure |
| Discrete NVIDIA/AMD | CUDA, else Vulkan | **VRAM**, not system RAM | the card's, if the model fits |
| Old iGPU / no GPU | CPU | system RAM | the CPU plateau |

Consequences that change code, not just wording:

- **The tier table in section 4 is indexed by RAM, which is only correct for the
  first and third rows.** On a machine with a discrete GPU the index is VRAM: a
  32 GB PC with a 6 GB card is an 6 GB machine for the purpose of choosing a
  model, and a 16 GB Mac is a 16 GB machine.
- **Partial offload is not a partial win.** When a model does not fit in VRAM,
  llama.cpp leaves some layers on the CPU and decode is dominated by those. The
  prediction needs both bandwidths and the split, and the default choice should
  prefer a smaller model that fits entirely over a larger one that spills.
- **An old integrated GPU is not a GPU for this purpose.** Vulkan frequently
  fails to initialise on Haswell-era parts, and where it works the iGPU reads
  the same system RAM at the same speed, so there is no decode win and sometimes
  a loss. CPU is the correct answer there, not a fallback we are ashamed of.
- **Every bandwidth number must carry the execution path it describes**, as data
  the catalog can branch on — not as a sentence in a printed report. A figure
  with no backend attached is exactly how the first wrong answer got through.
  Where the backend that will run is not the one we measured, the prediction is
  a lower bound and must be labelled one.
- The thermal rule of section 2 applies harder here, not less: a discrete GPU in
  an eight-year-old laptop is the quickest way to cook it. The throughput-decay
  sentinel watches the GPU path too.

## 4b. The install is one install

The user installs one thing. They never meet a second installer, never approve
an administrator prompt for a component they did not ask for, and never learn
that a server exists.

So we **embed the runtime binary in our package** and run it as a child process
on loopback. We do not install a system service, do not touch PATH, and do not
adopt or fight a runtime the user may already have.

⚠️ "One install" is a promise about what the *user* does, not about what fits in
one file. A CUDA build of the runtime is ~541–645 MB against ~18 MB for CPU, so
the GPU backends are fetched after detection by the app itself — see section 4c.
The user still meets one installer and answers no questions.

**The embedded runtime is llama.cpp's `llama-server`** (MIT, single binary).
The reasons are operational, not ideological:

- It is not a daemon. Nothing to conflict with, nothing left running when our
  app is closed, nothing to uninstall separately.
- It exposes the knobs the safety net needs — thread count, batch and ubatch,
  KV cache quantization, idle unload. A runtime that hides those knobs would
  be substituting its defaults for our measurements, on hardware it has not
  measured.
- It reads GGUF directly, so the catalog is ours and not a vendor's registry.

Runtimes that were considered and rejected: a proprietary desktop app cannot
be redistributed inside our package at all; a permissively licensed daemon
could be, but it is a background service with its own model registry and
naming, and it deliberately hides the tuning surface above.

CPU feature variants (AVX2 / AVX-512 / ARM) ship as separate binaries selected
at runtime, which is the same mechanism as the backend blocklist.

MLX on Apple Silicon is a later optional backend, not the first one: it drags
in a Python runtime, and "one install" is worth more than the last few percent
of throughput on one platform.

## 4c. Which backend we ship, and how we learn it actually works

Researched 2026-09-14 against llama.cpp release `b10950` (same day). Every figure
below is a compressed download size measured from the release assets.

| what | backend | download |
| --- | --- | --- |
| macOS arm64 / x64 | Metal + CPU (one archive, Metal is the default build) | ~11 MB |
| Windows x64 | CPU | ~18 MB |
| Windows x64 | Vulkan | ~32 MB |
| Windows x64 | **CUDA 12** (engine 254 MB + CUDA DLLs 391 MB) | **~645 MB** |
| Windows x64 | **CUDA 13** (engine 150 MB + CUDA DLLs 391 MB) | **~541 MB** |
| Windows/Linux x64 | ROCm 10.0 | ~230–256 MB |

**So "one installer with every backend inside" is not a thing we can ship.** CUDA
alone is thirty times the CPU build. The install stays small — CPU always, plus
Vulkan on Windows — and the heavy backend is fetched **after** detection, only on
a machine that has the card to justify it, through the same resumable, verified
downloader that fetches the weights. The user still does nothing; they just are
not made to pay half a gigabyte for a GPU they do not own.

### Support is a capability, never an age

- **Vulkan's real floor in llama.cpp is Vulkan 1.2 plus `storageBuffer16BitAccess`**,
  checked at device initialisation; below it the backend refuses with
  "Unsupported device". An upstream report has Haswell HD 4400 failing exactly
  there. So the Haswell-era iGPU exclusion in section 4a is now a *tested
  capability*, not a guess about old hardware — and the same test admits a
  Skylake part that passes.
- **CUDA excludes by compute capability**: the CUDA 12 build starts at `sm_50`,
  the CUDA 13 build at `sm_75` — which rules out the entire GTX 10 series on a
  CUDA 13 artifact. It also needs a driver floor (≥551.61 on Windows for the
  bundled 12.4 runtime, ≥580 for 13.x). A machine below either is a CPU machine,
  and telling it so quickly is better than a crash.
- **A failing GPU backend does not always fail cleanly.** llama.cpp's CUDA error
  path calls `GGML_ABORT`, and a missing DLL kills the process before the server
  starts. This is the same reason inference is out-of-process here in the first
  place: the only honest support test is **launching the candidate backend in a
  disposable child with a tiny model and a timeout**, and falling back to CPU on
  a non-zero exit, a hang, or wrong output. Detection narrows the candidates; the
  child process decides.

### Partial offload can be slower than no offload at all

The strongest recent upstream measurement: 18.49 tok/s fully on Vulkan, 12.19
tok/s on CPU, and **5.68 tok/s split across both** — the split being 2.15x slower
than plain CPU. No public controlled `-ngl` sweep exists to turn that into a
formula. This settles the rule in section 4a: when a model does not fit the GPU's
memory, we do not offer it partially offloaded, we offer the model that fits.

### Reading the memory budget

- **Windows**: DXGI (`IDXGIFactory1::EnumAdapters1`, `DXGI_ADAPTER_DESC1`) is the
  smallest reliable discovery path — vendor, device, `DedicatedVideoMemory`. What
  it gets wrong: that field is a capacity classification, not free memory, and
  integrated GPUs report almost none of it because they live in system RAM. The
  process-visible budget needs `IDXGIAdapter3::QueryVideoMemoryInfo`, and even
  that moves under us. WMI `Win32_VideoController.AdapterRAM` is a 32-bit field
  Microsoft itself warns is inaccurate on WDDM — usable only for names.
- **macOS**: `MTLDevice.recommendedMaxWorkingSetSize` and `hasUnifiedMemory`. On
  Apple Silicon that is a recommended working set over unified memory, not VRAM.
- Intel Macs with AMD GPUs enumerate under Metal but have reproducible
  command-buffer failures upstream; they are a probe cohort, not an assumption.

## 4d. A runtime already on the machine: reuse the weights, not the process

Some users already have ollama, LM Studio or MLX installed. The tempting move
is to drive whatever is there. We do not.

**Never adopt someone else's running process as our engine.** Two reasons, both
load-bearing:

- The tuning surface is how the safety net acts. A runtime that hides thread
  count, batch size and KV quantization leaves us able to *detect* throughput
  decay and unable to *do* anything about it. "I will not damage your PC" is
  not a promise we can keep through a process we do not control.
- Our baseline is measured under our settings. The moment their runtime updates
  or their config changes, every number we stored silently becomes wrong — and
  nothing tells us.

There is also the plain courtesy argument: if we adopt their service and then
reconfigure it, we broke something that was working.

**Model files are a different matter.** GGUF blobs already on disk are just
files, and our own `llama-server` can read them. Reusing them saves the user a
multi-gigabyte download and costs us nothing in control. Rules: read-only,
never move or rewrite them, and treat the on-disk layout as an internal format
that may change — an optimization allowed to fail, never a dependency.

MLX weights are a different format that llama.cpp does not read, so there is
nothing to reuse there.

**The advanced escape hatch** — "use the server I already run" — is legitimate
and explicitly opt-in. When it is chosen, we say plainly that automatic tuning
and the thermal safety net are off, because that process is not ours. Silent
degradation of a safety promise is the same defect as a silent truncation.

Independently of all this, we must **detect what is already listening** before
we bind a port. Not to use it: to avoid fighting it.

## 4e. Zero-touch: what happens after the user clicks install

1. **Read the machine.** RAM, CPU features, core count, whether a usable GPU
   exists. No privileges required for any of it.
2. **Ask the phone what it runs.** The pairing handshake carries the phone's
   model, because the whole question is "can this PC beat that".
3. **Shortlist** from the catalog: what fits the measured RAM, is licence-clean,
   is fresh, and is stronger than the phone's model.
4. **Measure, do not guess.** Download the leading candidate and run a short
   benchmark on this machine — prefill and decode, at the settings we would
   actually ship. Published figures for old CPUs do not exist; the machine in
   front of us is the only source of truth.
5. **Establish the baseline** from that run. It is what throughput decay is
   later compared against, so it must come from the same machine, not a table.
6. **Pick, and say why** in one sentence a human can check: what it chose, and
   how it compares to the phone.

If step 3 comes back empty, the app says the machine is not worth using and
stops. That is a feature. A courtesy recommendation that loses to the phone
costs the user a download, a fan, and their trust.

## 4f. Pairing: the phone scans, nobody types

The third page has nothing behind it yet. What it must never become is a box
where the user types an address — that is the developer default that made the
first shipped build useless on a real phone.

**The PC shows a QR code; the phone scans it.** That is the whole interaction.
It works over any transport, because the code carries the endpoint the PC is
actually reachable at — loopback, tailnet, or a tunnel — so the same flow
survives the move from Tailscale to Cloudflare without the user learning
anything new.

- The code carries the **endpoint and a one-time secret** with a short life. The
  phone spends the secret once for a long-lived token bound to that phone, and
  the secret dies. A code photographed over someone's shoulder an hour later is
  worth nothing.
- **No automatic pairing on the local network.** A device that joins your
  assistant because it was on the same WiFi is a device you did not agree to.
  Discovery by mDNS is also unreliable on real home networks — AP isolation and
  blocked multicast are common — so it would be both unsafe and flaky.
- The token is bound to **the computer's identity, not its address**. The address
  changes when the transport does; re-showing the code refreshes the address
  without re-establishing trust.

### What the handshake carries

Phone → PC, once: which model it runs, as **total and active parameters and
whether it is dense or a mixture of experts** — the catalog needs exactly those
to make an honest comparison, and a weight in bytes cannot substitute for them.

PC → phone, once: its own display name and what it chose, so the phone can say
where the answer came from rather than showing a bare address.

⚠️ **Battery is two different questions, and conflating them produces an absurd
refusal.** Section 1 says relief is only worth something to a phone on battery,
and the catalog took that literally: a phone plugged in during setup gets no
relief recommendation. But a phone charging at the moment of pairing will be on
battery an hour later — refusing to set up an 8 GB machine because of where the
user happened to be standing is not honesty, it is a bug.

So separate them:

- **For choosing the model**, the question is "does this device run on battery at
  all". For a phone that is always yes. It is a property of the device, decided
  once.
- **For routing an individual request**, the question is "is it on battery right
  now", and that rides with the request, cheaply, because it changes constantly.

## 4g. The catalog is a starting point, not the shipping list

Owner, 2026-09-14, on the first three tiers coming out of the chooser: the
Qwen 3.6 row is a base model and **community fine-tunes of it are better as
chatbots**, and Gemma 4 12B **has competition** at its size.

Both are true and neither changes the machinery, which is the point: the rows
are data, the decision is code, and replacing a row is a manifest edit. What it
does change is the order of a later job — before any of this ships, the rows get
re-picked on quality with the bake-off, including fine-tunes, not just base
models from the vendors. Recorded here so it is not discovered as a surprise
when someone reads the tier output and assumes it was the final answer.

## 5. Backend-agnostic from the first line

The runtime is one of N: llama.cpp server, ollama, MLX on Apple Silicon.
Nothing above the transport may assume which one is running.

The phone already speaks OpenAI-compatible HTTP, so the surface exists. What
must not happen is a second hardcoding of one vendor — the mistake we already
made once by shipping `http://127.0.0.1:8000` as a default, a developer's
address with `adb reverse`, useless on a real phone.

## 5bis. Where the work runs: the PC is a capability, not a second chatbot

Owner, 2026-09-14: *"secondo te ha senso creare una specie di 'connessione'
smartphone pc? Websearch, documents, tutta la parte esosa di risorse sul pc, e
la parte chatbot su telefono... Stesso harness, due ai diverse in due punti
diversi che si aiutano per risparmiare batteria"*.

Yes — but the useful version is not two models helping each other. **The
decomposition is by cost asymmetry, not by intelligence.**

Move work whose **input is large and output is small**. Keep work whose **output
is what the user reads**.

| work | input | output | where |
| --- | --- | --- | --- |
| embedding a document's chunks | megabytes | vectors | **PC** |
| ingesting a PDF and building its index | megabytes | an index | **PC** |
| fetching a web page and extracting what matters | a whole page | a few hundred tokens | **PC** |
| reranking candidates against a query | many passages | an ordering | **PC** |
| the conversation itself | the turn | the text the user reads | **phone** |

That table is the whole design. A 40-page PDF is minutes of prefill on a phone
SoC — watts, sustained, with the throttling that follows. The same job is a
request of a few kilobytes and a reply of a few kilobytes if something else does
it. Prefill is precisely the part of inference that is expensive on the phone and
cheap to relocate, because nobody is watching it stream.

### Why not two chatbots

Because the conversation has **state** and the expensive jobs do not. A remote
chat turn means shipping the whole context across on every turn, which destroys
the saving it was supposed to buy, and produces answers in a second model's voice
inside a conversation the first model owns. Embeddings, extraction and reranking
are stateless, deterministic-ish, and their results are small. They relocate
cleanly; a conversation does not.

### Three constraints that decide whether this works

1. **The PC is asleep most of the time.** An old laptop is closed. So every
   remote capability needs a local path that still works, and the PC is an
   accelerator, never a dependency. A feature that breaks when the PC is off is
   a feature we did not ship.
2. **There is a crossover, and it is not near zero.** Waking the radio and paying
   a round trip is worth it against fifty thousand tokens of prefill and absurd
   against a hundred tokens of reply. The routing decision needs the size of the
   job, not a preference toggle — and it should also know whether the phone is on
   battery at all, per section 1.
3. **What comes back must be structured data, not prose.** If the PC returns a
   summary written by a different model and the phone pastes it into the
   conversation, the user reads two voices. Vectors, extracted text, an ordering
   and spans are safe; generated prose is where the seam shows.

### What the measurements say, including where this section was wrong

Prior art and energy figures researched 2026-09-14; full report in
`RESEARCH-split-phone-pc-2026-09-14.md`.

⚠️ **Correction to the paragraph above.** It claimed prefill is "precisely the
part of inference that is expensive on the phone". That is only true when the
input is large. For ordinary conversation the measured balance is the opposite:
MNN-AECS reports **decode energy 16–26x higher than prefill** across its
conversational workloads (Xiaomi 15 Pro: prefill ~32–282 J against decode
~498–4,617 J per run). So:

- **For ordinary chat, moving the whole conversation to the PC is already the
  bigger battery win** — which is the remote-brain feature we are building, and
  this reframes it: it was designed as a capability play and it is also, by the
  numbers, the main energy play.
- **The capability split earns its keep on large-input work** — documents, web
  pages — where the input dwarfs the output and prefill grows to dominate.

That the phone's battery genuinely suffers is not in doubt: the same study
measures a 4-bit 1.5B model burning **6,031 J at 9.9 W over 20 conversations on
a Xiaomi 15 Pro, 6–25% of the battery in under fifteen minutes**. And a 2026
sustained-load study finds thermal management, not peak compute, decides the
outcome: an iPhone 16 Pro's throughput nearly halved within two iterations, and a
Galaxy S24 Ultra had inference terminated by the OS dropping the GPU frequency
floor. Relief is a real product, not a consolation prize.

The other side of the trade is cheap when the radio is already up: WiFi is around
868 mW associated and 1,450 mW downloading, and the only direct per-kilobyte
measurement found (2010 handsets, so treat as an order of magnitude) puts a few
kilobytes at well under a joule — against thousands of joules of local inference.
The cost that is *not* negligible is association: 1.5–6 J to bring the link up.
So the routing decision has a fixed cost to amortise, not just a per-byte one.

⭐ **Rule that follows directly: the PC returns compressed evidence, never the
raw material.** Shipping the document back to the phone to be prefilled there
forfeits exactly the saving the offload was for. Spans, vectors, an ordering, a
short extraction — that is the payload.

**No published crossover exists.** Nobody has measured, for a phone and a
personal computer on the same LAN, the point where the round trip stops paying.
We can: the lab is three phones and this Mac, and the figure is worth having
because it is the number the routing decision needs.

### Prior art: the escalation pattern is everywhere, this split is not

- **Moving the whole model to a PC** is a crowded field — ollama, LM Studio, Open
  WebUI, Enchanted, and phone clients pointed at them. Not what this is.
- **Escalating by difficulty** is the shipped state of the art: Apple
  Intelligence / Private Cloud Compute escalates on task complexity and context
  size; Firebase's hybrid inference exposes on-device/in-cloud preference.
  **Neither documents battery or thermal headroom as the routing criterion** —
  Google names battery only as a signal an application may add itself. Research
  goes further (CR² puts energy in the routing utility alongside latency and
  accuracy), but it is still escalation of the *model*, not relocation of tools.
- **The split we want is nearly unoccupied.** The closest things found are
  Pocket-RAG (a React Native app running a small model on-device that calls a
  configurable HTTP RAG endpoint, which may be on the same network) and mobileLLM
  (local model and agent runtime, remote MCP endpoints the user configures).
  Neither packages PC-side ingestion, embedding, reranking and page extraction
  behind a phone-local conversation. One project does the exact inverse —
  OnDevice-RAG-Android keeps splitting, embedding and the vector store on the
  phone.
- **Splitting one model across devices** (llama.cpp's RPC backend, Petals) is a
  different thing and, in llama.cpp's own README, "proof-of-concept, fragile and
  insecure".

So the honest position: the *architecture* is not novel in its parts, but **the
combination — conversation on the phone, tools on the user's own PC, with
battery and thermal budget as the routing criterion — is not something anyone
appears to have shipped.** That is a reason to design it carefully, not a reason
to hurry.

### Privacy is a separate act of consent

Sending a document to the PC for indexing is **uploading the user's content**,
even when the PC is their own machine on their own network. The existing rule
holds: a setting that means "where do I send traffic" must never silently also
mean "you may upload my files". Document offload asks for itself, in its own
words, and the answer is remembered separately from the remote-brain switch.

### What this changes today, before any of it is built

The server we are building right now is an OpenAI-compatible **chat** endpoint.
If the PC's real job is capabilities, the surface is wider than
`/v1/chat/completions` — embeddings and document ingestion at minimum — and
discovering that after the client is written means rewriting the client. So the
decision gets locked now and built later: **the desktop app is a provider of
capabilities that happens to also serve chat**, not a chat server we will one day
bolt tools onto.

⚠️ Honest risk, recorded so it is not rediscovered as a surprise: this doubles
the surface of a product whose first version has not shipped. Nothing here is
built before the chat path works end to end on a real phone and a real PC.

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

## 7. Starting point and the flags that matter

**Base: a new Tauri shell. We do not fork Jan** — we take one piece of it.

Reading the repository changed the answer. Jan is 308k lines, ~95% of which we
would delete, and its licence is not uniform: the root is Apache-2.0 and the
Rust is MIT, but the TypeScript packages declare **AGPL-3.0** — including the
preset builder and the download manager, which are precisely the parts we would
have wanted. Those get rewritten, not copied.

What is worth taking is the **process supervision**, which is MIT and about
1,500 lines: a Windows Job Object with `KILL_ON_JOB_CLOSE` so the OS reaps the
child even on a force-quit, shutdown by closing the child's stdin rather than
by signal, a startup handshake with a timeout, and cleanup wired to the app's
exit event. That is hard-won code and there is no reason to rediscover it.

One thing they learned that changes our reasoning: they moved inference out of
the main process because **`GGML_ASSERT` calls `abort()`**, which `catch_unwind`
does not contain. So a crash in inference takes down whatever process hosts it.
Our child-process design was chosen for clean installation; crash isolation is
the stronger reason, and it means the supervisor must expect the child to die
abruptly and recover without losing the app.

Second choice for a base was Lemonade (Apache-2.0 throughout, embeddable,
actively released) but its focus is AMD hardware, the wrong bias for old Intel
laptops.

**Shell: Tauri.** It uses the system WebView, so the download stays small on
machines with slow disks and slow links. The cost is real and must be planned
for: **WebView2 is not guaranteed on old or LTSC Windows 10**, so we ship the
Evergreen bootstrapper. Signing is not cheaper than Electron on either OS —
Developer ID plus notarization on macOS, certificate plus SmartScreen on
Windows.

**Idle unload, verified flag names:**

- `llama-server --sleep-idle-seconds N` — unloads the model *and the KV cache*
  after N seconds with no work. `/health`, `/props` and `/models` do not count
  as work and do not reset the timer, which is exactly the behaviour we want
  from a phone that polls.
- `OLLAMA_KEEP_ALIVE` (default 5m) is the equivalent if we ever drive ollama.

**Transport: a tunnel, always. Not the LAN.**

A LAN-only design only works while the phone is on the same wifi. Walk out of
the house and the PC disappears. That is not the product, so plain-HTTP LAN
access is not worth building: the tunnel is mandatory, and a tunnel gives us
TLS for free — which removes the cleartext question entirely.

Who provides the tunnel is tiered:

| tier | tunnel | why |
| --- | --- | --- |
| advanced users, and us in dev | Tailscale | zero servers, zero cost, end-to-end WireGuard. Costs the user an account and a second install. |
| paying users | Cloudflare Tunnel | outbound only, no ports to open, works anywhere. We run the domain. |
| later | our own relay | full control and real end-to-end privacy, once it is worth paying to operate |

⚠️ **Cloudflare is not privacy-equivalent to Tailscale** and we must not present
it as merely a different transport. Tailscale is end-to-end WireGuard: nobody in
the middle can read the conversation. A Cloudflare Tunnel terminates TLS on
their edge, so conversations are in the clear inside their infrastructure. The
PC still belongs to the user; the traffic no longer only touches their devices.
That difference belongs in the copy for the paid tier, not in a footnote.

**Discovery: mDNS/DNS-SD** (`_llm._tcp.local`), with an embedded user-space
responder rather than asking anyone to install Bonjour — it is not guaranteed
on Windows. QR code as the fallback for guest networks and blocked multicast,
carrying host, port and token. Tailscale makes discovery moot when both ends
have it, but we cannot assume it.

**Open risk, stated plainly:** an OpenAI-compatible endpoint on the LAN with no
authentication is free access to the user's CPU and models. Pairing must mint a
credential, and the server must actually check it.

## 7bis. What we are not building

No chat UI on the desktop — the phone is the client.
No account, no cloud, no telemetry by default.
No CPU-only design either: section 4a settled this the other way round.
Where a GPU exists it decides both the budget and the speed, and the
installed build follows the hardware. What we are not building is a
*requirement* for a GPU: a machine without one is still offered a model,
or honestly refused.
No "expert mode" that is really an excuse for not making a decision.


## 8. What is built, and what the building taught us

Written 2026-09-14. Everything below was verified by running it, not by
reading a report. Seven crates, `cargo check --workspace --all-targets` clean
with zero warnings.

| Crate | What it decides |
|---|---|
| `kalsa-probe` | What this machine can do, and **on which execution path** |
| `kalsa-catalog` | Which model, and whether it is worth offering at all |
| `kalsa-download` | Getting a file here, once, provably intact |
| `kalsa-runtime` | Which `llama-server` build this machine runs, proven by running it |
| `kalsa-supervisor` | Keeping that server alive, and naming each way it dies |
| `kalsa-sentinel` | Backing off before the machine cooks |
| `kalsa-pairing` | The QR ceremony: a one-time code, a binding, the phone's own description |

### Corrections the build forced on this plan

**Asset names cannot be researched, they must be read.** The b10950 table was
first written from a research summary and two rows did not exist: llama.cpp
publishes the macOS builds as **`.tar.gz`**, not `.zip`, and the CUDA 13 build
is **13.3**, not 13.0. The sizes in the research held (645 MB for CUDA 12.4
with its runtime archive, 541 MB for 13.3, 18.4 MB Windows CPU, 31.7 MB
Vulkan, 11.1 MB macOS arm64). The lesson is narrow and worth keeping: a
plausible file name is not a file name.

**A build we cannot open is a build we cannot run.** Filling in the real
digests exposed an extractor that only understood zip — on the one platform
this is developed on. An archive's format is now a fact on the row, not
something sniffed from a file extension at the far end.

**The verdict is fingerprinted by the archive's digests, not the release
string.** A release tag only invalidates a proven backend if rows are never
corrected in place — and correcting two rows in place is exactly what
happened. The digests are the honest identity of a build.

**The capability probe needs a model, and we do not host one.**
`/health` answers only once a model is loaded, so proving a backend works
needs weights. `stories260K.gguf` from `ggml-org/tiny-llamas`, URL pinned to a
commit, 1_185_376 bytes, sha256 `047bf464…12c04b`, **GGUF v3** — the version
matters, because b10950 will not load v1/v2 and a rejected probe model would
make every backend look broken. Downloaded and hashed before being written
down. Not yet proven against a real server: stated as a limit, in the code,
where the row is.

**Pairing had a dead end nobody would escape.** `persist` refused to overwrite
a credential — correct, since a silently replaced credential is how a
photographed QR evicts the real phone — but nothing else could write one
either. The second pairing a machine was ever asked to perform failed forever:
a new phone, a reinstall, one bad attempt. Replacing a credential is now a
deliberate act (`forget`), it does not require the file to be readable (so a
corrupt credential clears too), and "already paired" has its own type so the
shell can say the true sentence instead of showing a disk error.

**Dark mode is gone, on purpose.** One palette we check beats two where one is
decoration. The trap it left behind was not a colour but `color-scheme: light
dark`, which would have drawn dark scrollbars on a permanently light page.

### The method that found the defects

Neither of the two worst bugs of the day came out of a green test suite. Both
came from mutating the code and watching whether anything complained:

- A "no dead ends" check on the desktop shell counted a **button with no
  label** as a way out. Removing the "Turn on" button from the Off screen left
  a user reading *"this computer is not helping your phone"* under a blank
  rectangle — and the check passed.
- A test that had pinned "the asset table is empty" kept passing as
  documentation of a temporary state long after that state was the thing being
  changed.

The rule this earns: **a test is only worth what its mutation says it is
worth.** And verify the mutation actually landed — one of the day's mutations
hit a line number that a refactor had moved, so the green meant nothing.

### The security round, and what it was all one bug

A hostile audit on a different model than the writers found that
`kalsa-runtime` **trusted its own cache**. Four findings, one mistake: a build
already on disk was executed before the digest gate; the `.sha256` stamp
compared a length rather than the bytes (with a test asserting that was
correct); the zip path — the Windows path — let the library create symlinks
while the tar path refused them; and a stale or half-extracted build outlived
the archive it came from. Trust is now re-earned from bytes on every start,
and a build is complete or absent.

Its fix then shipped a defect of its own that would have cost **645 MB on
every launch**: the marker comparison sorted one side and not the other, so a
CUDA build could not validate against the marker it had just written. Found by
running a two-asset fixture; the whole suite was one-asset, and with one
element "compares the set" and "compares the sequence" look identical.

`kalsa-download` had the same family: the digest was computed over the open
handle and the file was published by **path**. Now Windows and Linux publish
by descriptor; macOS cannot — no `AT_EMPTY_PATH`, no procfs — so it compares
identity on both sides of the rename and fails loudly. Each platform's
guarantee is written down, including the one we do not get.

### The measurement that reopened a row

The catalog's KV constant (96 KiB/token) admitted in its own comment that it
under-counted the largest row. Read out of an Apertus 70B GGUF header —
`block_count 80`, `head_count_kv 8`, head_dim 128 — the true figure is
`80 × 8 × 256 = 163,840` bytes at q8_0: **1.7× the assumption**, and the
oversubscription would have surfaced *after* a 40 GB download. The row went
dark, then reopened with the measured figure, and its "memory is an estimate"
caveat disappeared because it no longer is one.

Two decisions came out of it. The q8_0 pin is now load-bearing across a crate
boundary and documented on both sides: changing `KV_CACHE_TYPE` does not
retune a crate, it invalidates every row's memory arithmetic. And a prediction
built on a lower-bound measurement is a **floor**, which may keep a candidate
but may never refuse one — a CPU-path number was refusing models a Mac can
run, with a precise wrong figure given as the reason.

### The night it ran for real

Everything above was proved against fixtures: an archive we built, a server we
faked, a digest we chose. Two hundred and seventy-three tests were green. Then
the release was downloaded from GitHub, extracted, and executed on this Mac,
and the first thing the real binary said was:

> error while handling argument "--flash-attn": error: unknown value for
> --flash-attn: '--cache-type-k'

In b10950 `--flash-attn` takes a value. A bare flag eats the next argument, so
the server exits before it starts. The launcher's nine tests all passed —
they asserted strings that nothing had ever been asked to accept. The same
reading of `--help` corrected a second one: `--n-gpu-layers` spells "every
layer" as `all`, and its default is `auto`, which is the server guessing.
Leaving the flag out was never neutral.

Worse than either: **nothing called the launcher at all.** A grep for it
across the workspace returned nothing — it was not in any crate's
dependencies. What actually started was the supervisor's own argument list,
which passes no flash attention, no cache type and no offload decision, on a
context nobody budgeted. Every memory number in this plan was, at runtime,
fiction. There is one renderer now, and the supervisor's second one is
deleted rather than deprecated.

Then it served. The real engine, a real model, a real question, and the answer
came back at 107 tok/s — and the phone got it: an `adb reverse` for the
tunnel, the request sent from the Jelly itself, and the generated text read
off the phone's screen. That is the product's whole claim, once, end to end.

Two facts the run also settled. None of the four catalog rows with an
identified GGUF is on this machine, so a first start really does download
several gigabytes, and that download had until now never been executed by
anyone. And the q8_0 cache needs a head dimension divisible by 32 — the tiny
probe model has 8, so the probe cannot run under the cache the product ships,
which is fine and worth knowing before someone "fixes" the probe to match.

The lesson is the same one as the security round, one level up. A test that
builds its own subject cannot see the subject's defects; a suite that never
executes the thing it configures cannot see that the configuration is refused.

### Built, and attached to nothing

The flag that would not start the server turned out to be the small version of
a bigger habit, so the whole workspace was swept for it — every public entry
point, against every caller, tests excluded. Four finished pieces were wired to
nothing at all.

The launcher was not in any crate's dependencies; what started the server was
the supervisor's own argument list. The thermal guard's two entry points were
called only by its own tests: nothing ever handed it a sample. The progress
event was emitted by the shell and listened to by nobody, so a 3.5 GB download
ran with the screen showing "Off". And the ceremony had no transport.

The fourth one is the one that mattered. The Pairing page invoked four
commands — `brain_pairing`, `brain_pairing_retry`, `brain_pairing_replace`,
`brain_pairing_keep` — and **none of the four existed in Rust**. Nothing ever
called `store::persist`, so the file the shell reads on startup was never
written by anything, so `phone()` answered `None` every single time. Which
means the sentence this product is built on — *run a model that knows more
than the one on your phone* — has never once been evaluated against a phone.
Every choice ever made here took the no-phone branch.

So the two questions a crate must answer before it counts as done are now
part of the method, next to the mutation:

1. `grep` the crate's name across every `Cargo.toml` but its own. Empty means
   dead, and that is the headline, not a footnote.
2. Every `emit` needs a `listen` with the same string, and every `invoke` needs
   a command that exists. Both directions: a page calling something that was
   never written fails silently for as long as nobody looks.

### The hostile round, and the two regressions it caught

The pairing proof and the launcher wiring went to an adversarial read by a
different model, which returned twenty-eight findings. Several of the crate's
defences held and are worth recording as held: no secret in any `Debug`, error
string or panic; the two MAC domains genuinely disjoint, neither a prefix of
the other; a zero nonce is a value and not a sentinel; a malformed MAC
allocates nothing. The QR test, once burned for building its own quiet zone,
now checks all four sides.

Two findings were regressions introduced by the fix that preceded them, which
is the argument for auditing every step rather than every release:

* **The budget followed the wrong card.** The build that wins is decided
  before the model is chosen, but the memory budget was still derived from the
  *detected* backend. On a machine where the GPU build fails and the CPU build
  wins, the model was sized against VRAM and would then decode out of system
  RAM. Two different type families — the probe's backend and the server's —
  which is exactly why nobody saw it.
* **Loopback stopped being structural.** Collapsing the two argument renderers
  into one left the supervisor taking an argv it never reads, so nothing
  prevented `--host 0.0.0.0` while the health check still asked `127.0.0.1`. A
  guarantee had quietly become a convention. The supervisor now refuses to
  spawn an argv that does not bind loopback on exactly the port it supervises.

And one the crate had claimed was closed and was not: the ceremony answered
*two different refusals* — one for a wrong proof, another for no live
ceremony — which tells a prober whether a square is on a screen it cannot see.
Its own test froze that as the specification. One refusal now, for everything.

The rest came in: the store writes through a temp file and a rename, so a
crash cannot leave a credential half-written and lock the owner out; the
protocol has known-answer vectors, including RFC 4231's, instead of tests that
recompute the MAC with the function under test; an absurd window is an error
rather than a panic; the recorded server digest now belongs to the executable,
so a binary swapped after extraction is refused rather than silently repaired
by a re-download; a recycled pid is never signalled; and the second unload
clock is deleted, because the server's own `--sleep-idle-seconds` was already
the only one that could fire.

Two mistakes of ours are on the record too. A crate committed by path added a
field to a shared type and broke another crate, because per-crate test runs
cannot see across the boundary — a workspace check now precedes any change to
a public type. And a commit made by path silently left out its two new files,
because `git commit -- <path>` does not add what git has never tracked.

### Where the moat actually is

A market read, commissioned separately, lands on one sentence: the thing
nobody offers is a PC→phone bridge an ordinary person can set up, because
today it means Tailscale or WireGuard by hand. Local inference itself is not
the moat — the phone's own OS gives it away free, and the desktop tools give
it away to anyone comfortable with a terminal.

That is worth stating against what is actually built. Everything proved
tonight — the engine, the weights, the choice, the arguments, the supervision
— is the part that is already free elsewhere. The part that is ours is the one
step still missing: the phone reached this Mac through `adb reverse`, which is
a cable trick for developers, not a product.

It also puts a question in front of the transport rather than behind it. A
tunnel through an intermediary is the easy build and the cheap bill, and it
puts a third party in the path of a product whose whole pitch is that nothing
leaves the house. Peer-to-peer keeps the promise and costs more work. That is
a product decision, not an implementation detail, and the code should not be
written until it is made — which is why the listener built today binds
loopback and says plainly that something else has to carry the phone to it.

### The bridge: decided

The transport question from the section above is answered, and the answer is
two transports for one door.

**Cloudflare Zero Trust is out.** The tunnel became free in July 2026, but it
terminates TLS at the edge: every question and every answer would pass through
a third party in cleartext. A product whose whole claim is that nothing leaves
the house cannot have that in the path, at any price. It also cannot carry raw
TCP at all.

**Tailscale is the free tier, not the product.** Its Personal plan is free and
explicitly non-commercial, which is fine — the *owner* runs it on their own
machines and we redistribute nothing. What we must never do is put Tailscale
in our own cost structure: commercial seats are $8/user/month, which is more
than the whole product is worth per user. So Tailscale is what an advanced
owner already has, and we meet them there.

**iroh is the paid tier.** Rust, like everything else here; direct QUIC
between the two devices with hole punching, reported to land directly around
nine times in ten, and a relay fallback that forwards ciphertext only —
"authenticated and encrypted end-to-end using the QUIC protocol" — so the
relay is not a Cloudflare. Dual MIT/Apache-2.0, no commercial restriction.
n0's public relays are free but documented as unsuitable for production, with
no SLA and visible metadata; the relay is open source and self-hosting is free
forever, so we run our own. The managed option exists at $199/month per relay
and is a problem for a later scale, not a launch cost. It addresses nodes by
key rather than by IP, which is what our square already carries: pairing
becomes the network identity exchange too, with nothing added.

The product split follows the axis the market read pointed at. The free tier
serves the owner who can already build the bridge themselves — the same
audience that is the cheapest launch channel — and the paid tier sells the one
thing nobody offers: that the owner does nothing.

#### What this changes in the code

Loopback was made a structural guarantee today: the supervisor refuses to
spawn an argv that does not bind `127.0.0.1` on exactly the port it
supervises, and the pairing listener binds loopback and nothing else. A
tailnet address is not the LAN — it is an authenticated WireGuard interface —
but it is not loopback either, and the guarantee must not be quietly widened
to let it in.

So the inference server keeps binding loopback and is never the thing a phone
talks to. In front of it goes one small authenticated door, and the two
transports are just two roads to it: iroh delivers a stream to it, and on the
Tailscale path it is what listens on the tailnet interface. Every request
carries the credential minted by the pairing ceremony, which is the same
credential in both cases. One door, one authentication, two ways in — rather
than two products that drift apart, and rather than widening the one guarantee
that is currently structural.

#### What the spike measured, and what it did not

A standalone spike carried a plain TCP stream between two iroh endpoints and
forwarded it into a loopback HTTP server. Measured, not quoted:

| path | connect | first byte | 100-byte round trip (p50) | bulk |
|---|---|---|---|---|
| direct | 7.5 ms | 3.3 ms | 0.8 ms | 75 Mbit/s |
| n0's public relay | 34.9 ms | 28.1 ms | 25.0 ms | 11 Mbit/s |
| our own relay | 8.6 ms | 2.3 ms | 1.7 ms | 81 Mbit/s |

The relay's cost is one extra hop of latency, paid once, not a tax per token:
a decode pushes tokens outward and the phone does not acknowledge each one, so
25 ms lands on the first token and the rest stream behind it. Our own relay's
1.7 ms is not a result — it ran on the same machine. The honest figure for a
hosted relay is the round trip to wherever it is hosted.

Four facts that shape the build. **The key alone is enough to dial**: 32
bytes, resolved through iroh's own discovery, so the square grows by 32 bytes
and needs no address hints. **Running our own relay is one command** —
`cargo install iroh-relay --features server`, then both endpoints pointed at
it — with a certificate and ports 80/443/7842 in production. **It is heavy**:
a release client is 15.2 MiB and pulls 361 crates, which is nothing on a
desktop and something to weigh on a phone. And **it hangs rather than fails**:
dialling a node that is published but offline blocks for at least 25 seconds
with no error, and killing the far side mid-stream leaves later requests
waiting at least 12 seconds in silence. Every dial and every read needs our
own deadline; iroh will not supply one.

**What the spike did not test, and it is the load-bearing claim.** Both
endpoints were on this LAN — the path iroh reported as "direct" was a private
address on this network, not a hole punched between two different ones. The reported figure of roughly nine
connections in ten going direct is n0's, not ours. The first honest test of it
is the phone on mobile data against this machine behind its home router, and
until that runs, the relay is not the fallback for a minority: it is the path
we have actually seen work between two networks, which is zero of them so far.

### Four fixes, four mutations, and the one that survived

The pairing round closed seven findings from a hostile audit. A report is not
evidence, so each fix was checked the same way: break it on purpose, watch the
suite go red, restore it, watch it go green. Three of the four load-bearing
ones died as they should.

* Hand the saved seal to a phone that did not earn it — deleting the delivery
  token check — and `a_different_attempt_cannot_collect_a_saved_seal` fails.
* Remove the body ceiling and the server stops refusing an oversized
  `Content-Length`: it sits and waits for a body that never comes, and the test
  that was written for exactly that fails on the read timeout.
* Remove the admission bound and the listener stops answering when it is full.

The fourth survived, and it is worth recording because the suite had nothing to
say about it. The listener treats a transient `accept()` failure — the process
out of file descriptors, the machine out of them, a connection aborted between
the queue and the call — as something to sleep on and retry, instead of a
reason to die. Delete that branch and the transport goes back to being killed
permanently by a temporary condition, which is the defect the round was
supposed to close. The suite answered: forty-six passed, nothing failed, not
even a warning about unused code.

The reason is that the test asserts the *classifier* classifies — hand
`accept_error_is_transient` an `EMFILE` and it says yes — and never asks
whether the accept loop consults it. It also keeps the function alive, so the
compiler stays quiet too. That is the night's defect class wearing a lab coat:
correct code, a green test above it, and nothing joining the two.

The fix is not a better test. Where a decision has a small closed set of
outcomes, it should return an enum and its caller should be an exhaustive
match, so that deleting the retry arm is a compile error rather than a passing
suite. A type-level proof cannot be satisfied by a test looking somewhere else.
And the acceptance bar for a repair belongs in the brief, literally: *after
your change, deleting that branch must break the build or fail a test.*

### Not built yet

"Turn on" is wired end to end and has been run end to end on a real machine.
Pairing is wired too: the page's four commands exist, the ceremony has a
loopback transport, the credential is written, and the catalog is finally
handed a phone. The phone's own side of the protocol ships in the same crate,
because a MAC that covers exact serialized bytes cannot be reimplemented from
a description.

What is open, in the order it matters:

* **The bridge**, now decided and not yet built: the authenticated door in
  front of the loopback server, then iroh for the paid tier and the tailnet
  interface for the free one. Everything else assumes the phone can reach this
  computer, and today that assumption is a developer's USB cable.
* **The capability split** of section 5bis: the web and documents on the PC,
  the conversation on the phone.
* **Nine catalog rows with no identified GGUF**, which is the bake-off's job
  and not a coding task.
* **The phone has no name.** The declaration carries capability and nothing a
  person would call a name, so the screen says "your phone". True today; worth
  a protocol field the day a second phone exists.
