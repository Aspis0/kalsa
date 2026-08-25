# q54 — Engine Router v0.1 (SPEC)

Status: DRAFT v0.2 (2026-08-24). Revision of v0 after hostile audit
(`REVIEW_SPEC.md`, 12 findings, 0 logic bugs — all 6 traced device/model
combos produce the correct engine) and two owner requirements: explicit
generation recognition, and harness-style modularity (any part updatable
without breaking the rest). Source of truth for every number: `docs/ALIVE.md`
§8 + lanes 9–13. This spec codifies MEASURED verdicts only.

## 1. What it is (and is not)

A **static, init-time decision function**: given a device probe and a model's
gguf metadata, emit ONE launch configuration (which engine runs trunk, experts,
prefill, decode; ngl; threads). Decided once at model load.

Non-goals (v0, deliberately): no runtime engine migration, no autotuning, no
on-line benchmarking, no per-request switching, no scheduler, **no plugin
kernel / service bus / dynamic loading** (modularity is achieved by data/logic
separation, §2 — a plugin runtime on a phone's model-load path is surface for
breakage, not less). The map showed verdicts are per-GENERATION and stable — a
lookup table is the right size.

## 2. Modularity model (owner requirement, 24/08)

Four modules with FROZEN interfaces. "Update any part without breaking
anything" is delivered by keeping everything that changes in versioned DATA
and everything stable in a tiny pure function, with contract tests at the
seams.

| module | kind | changes when | update touches code? |
|---|---|---|---|
| **DeviceProbe** | code + SoC id table (data) | new SoC ships | table row only |
| **Capability tables** | versioned JSON data (per-generation verdict columns, quant compat, fit constants) | new generation measured; a constant re-measured | no |
| **Certification ledger** | versioned JSON data (lane → ON/OFF + evidence cell id) | a gate passes/fails | no — one ledger edit |
| **Rule engine + fit-gates** | pure function; fit-gates are swappable functions referenced BY NAME from the tables | a fit model is replaced (e.g. npu_fit placeholder → measured sweep) | one function, behind a stable signature |

Guarantees:
- Tables and ledger carry a `schema_version`; the engine refuses a version it
  doesn't know (fail → CPU, log). A fit-gate NAME referenced by a table that
  resolves to no registered function is the same failure class: that gate
  evaluates false → CPU, log `fit_gate_unresolved` (re-audit F13).
- CPU is **ledger-exempt**: it has no ledger entry and cannot be switched OFF
  — R9 must always have a landing spot (re-audit F14).
- **Golden contract tests** pin every (device, model) combo in §4's trace
  table plus every OFF lane in §6; any edit that changes an un-flipped verdict
  fails CI. This is the cheap, sufficient equivalent of harness replay.
- Adding a generation (e.g. v79/8-Elite) = new measured column + new golden
  rows. Never extrapolated (#16's lesson, encoded as data shape).

## 3. Where it lives

App-side (`ai-chat`), at model-load, next to the existing GPU fit-gate
(`memoryEstimate.ts`) — the app already owns the "what do I launch" decision
and the memory probe. kalsallama stays mechanism (backends, kernels), never
policy. v0 is a pure-function refactor of choices currently hardcoded.

## 4. Inputs, generation recognition, output

```
DeviceProbe {
  soc_generation:   '740-class-v73' | '750-class-v75' | 'no-htp' | 'unknown'
  hexagon_arch:     73 | 75 | none | unknown
  mem_available_mb: number          // probed at load, not cached
}
ModelProfile {                       // all from gguf metadata, no file scan
  arch_class:      'dense' | 'hybrid' | 'moe'
  trunk_quants:    Set<ggml_type>   // attn/trunk tensors
  expert_quants:   Set<ggml_type>   // ffn_*_exps tensors (moe only)
  total_bytes:     number
  trunk_bytes:     number
}
Mode { thermal_priority: boolean }
```

Generation recognition rules:
- SoC id → generation via the DeviceProbe table. **`unknown` → CPU, always**
  (a lane is never guessed on an unmeasured generation).
- `mem_available_mb` is sanity-clamped against device total RAM; an
  implausible probe (≤0 or > total) fails ALL fit-gates → CPU (audit E2: a
  garbage-high probe would otherwise send the NPU path — which materializes
  everything anon, no graceful fallback — into an LMK kill).
- **Post-launch lane verification** (part of the router contract, not a
  scheduler): after load, the app checks the chosen lane actually engaged —
  offloaded-layer count for GPU/NPU, execute-op evidence for NPU — because
  lanes fall back to CPU silently and binaries lie. Verification failure ⇒
  log `lane_fallback` with the rule id; the run continues on CPU. No retry
  logic in v0.

```
LaunchConfig {
  prefill_engine: 'cpu'|'gpu'|'npu-full'|'npu-trunk'
  decode_engine:  'cpu'             // constant in v0, by law 1
  ngl: number, threads: number,
  reason: string   // rule id that fired, e.g. "R7 (lane ON per q53)" —
                   // logged at every model load, auditable against this table
}
```

`HTP_READABLE = {Q4_0, Q4_1, Q8_0, IQ4_NL, MXFP4}` (backend contract).
`npu_ok(quants) = quants ⊆ HTP_READABLE`.

## 5. The decision table (from ALIVE §8 + lanes 9–13; cell/lane cited per row)

Law 1 first: **decode → CPU, always, every generation** [q48, #16]. The router
never assigns decode elsewhere. Everything below is PREFILL placement and
weight residency. Informational, NOT used by any rule: the 0.86× J/token
energy datum is single-replica and pending #24 — v0 ignores energy entirely.

| # | Condition (first match wins) | Prefill engine | Basis |
|---|---|---|---|
| R1 | `no-htp` device (Jelly-class) | CPU (+ #29 repack residency, K-F prefetch) | G57 GPU 0.24–0.96×, parked |
| R2 | v75 ∧ moe ∧ npu_ok(expert_quants ∪ trunk_quants) ∧ npu_fit | NPU full graph (every tensor HTP-readable ⇒ all weights land NPU-side) | 4.82× [q48, OLMoE all-Q4_0] |
| R3 | v75 ∧ (dense∨hybrid) ∧ npu_ok(trunk_quants) ∧ npu_fit | NPU full model | 3.19× [ALIVE lane 9] |
| R4 | v75 ∧ moe ∧ npu_ok(trunk_quants) ∧ npu_fit | NPU trunk, experts CPU (B′ lane) | 1.46× pp, single replica [ALIVE lane 11 houji] |
| R5 | v75 ∧ gpu_fit | GPU, FULL offload only (ngl per fit-gate; partial splits prohibited, see below) | 2.48× prefill, decode parity [750 campaign] |
| R6 | v73 ∧ (dense∨hybrid) ∧ npu_ok(trunk_quants) ∧ npu_fit | NPU full model | 3.5× on 4B Q4_0 [ALIVE §8] |
| R7 | v73 ∧ moe ∧ npu_ok(trunk_quants) ∧ npu_fit | NPU trunk, experts CPU (B′ lane) | pp512 1.14× [ALIVE lane 11, from q46 raw 58.43/51.08] |
| R8 | v73 ∧ moe ∧ thermal_priority ∧ gpu_fit | GPU cool-mode | −19% t/s, −2.75 °C — measured on KEXP ONLY, see note |
| R9 | otherwise | CPU | fastest-or-safest everywhere else |

R8 note (audit F3/F4): by ordering, R8 is reachable only when the NPU lanes
declined — i.e. for v73 MoE whose trunk is NOT HTP-readable (KEXP Q5_K/Q6_K:
exactly the measured case) or that fails npu_fit. It is the **thermal
fallback for the NPU-incompatible subset**, not a general cool-mode rule. The
−19%/−2.75 °C numbers exist for KEXP only; if a different NPU-incompatible
v73 MoE ever reaches R8, the `reason` string must carry
`cool-mode-untested-model` (golden test pins this). ACCEPTED RISK for v0
(re-audit F3-open): the predicate itself cannot check model identity —
ModelProfile deliberately carries no model name — so the sentinel + golden
test are the enforcement until a measured second model justifies a real
predicate field.

Never allowed, hardcoded:
- Experts-on-NPU on v73: F6 — two characterized skel firmware defects
  (NULL-deref op_binary + qurt_exit iface [q48/q50/q51]), not a fit problem.
  Structurally unreachable (no v73 rule reads expert_quants) — kept here as a
  ledger entry so the invariant survives table edits.
- Partial GPU offload splits: **performance ban, not a technical
  impossibility** (audit O4) — the B-arm (trunk-GPU/experts-CPU) measured
  WORST on both generations (A/C 0.812 KEXP, 0.724 OLMoE); policy choice:
  full offload or none.
- Vulkan on K-quants (backend dead).

Fit predicates (law 4 — memory decides before speed):
- `gpu_fit`: q44 affine gate — `mem_available ≥ 800 MiB + 1.05 × offloaded_bytes`
  (driver cost invisible to RSS; never trust RssAnon).
- `npu_fit`: NPU materializes ALL weights anon (no mmap). No q44-equivalent
  sweep exists for HTP yet (open item §7) ⇒ v0 is table-driven on the
  q46/q48 observed footprints of KNOWN models. **Unknown model ⇒ npu_fit =
  false ⇒ CPU** (explicit conservative fallback, audit E1). Swapping this
  placeholder for a measured model is a fit-gate module swap (§2), no table
  or engine change.
- CPU is the only engine allowed to rely on mmap elasticity (#29 kernel).

## 6. Certification ladder (what the router may actually enable today)

A rule fires ONLY if its lane is ON in the ledger. v0 ships with:

| lane | speed | correctness | router status |
|---|---|---|---|
| CPU (all) | banked | production | **ON** |
| GPU 750 prefill | banked | 407/407 kernel suite | ON |
| GPU 740 cool-mode (R8) | banked (KEXP) | 407/407 | **OFF until #24 sustained** |
| v73 trunk-NPU (R7) | banked | **q53 FAIL (24/08): HTP arm dies under perplexity batch-2048 load — third v73 death signature (`dspqueue_write 0x1`), r=NaN.** Lane not certifiable; q53b: dies identically at -b 512 (9/32 chunks) → not batch-bound. Also owes the q52 loop gate | **OFF — hard, until a v73 lane survives a correctness cell** |
| v73 dense-NPU (R6) — **hard OFF, thermal-shutdown incident** | banked | **THERMAL INCIDENT 25/08**: the sustained full-on-NPU hybrid PPL (q53 lane 2) coincided with two adb drops and the S23 shutting down hot and not rebooting — lane CLOSED-INCOMPLETE; never resume in this form; any future v73 NPU run needs the intra-run thermal watchdog (kill ≥43 °C) and a 10-min cap | OFF |
| v75 experts-NPU (R2) | banked (4.82×) | **NO correctness test designed yet** — q48 was liveness+dispatch only; needs its own cell (q55 candidate, Xiaomi window) | OFF |
| v75 dense/trunk NPU (R3/R4) | banked (R4 single-replica) | uncertified, no cell designed; R4 additionally owes the q52-class loop gate (trunk-B′ lane) | OFF |

(Audit O2 applied: "uncertified" spelled out per lane — OFF is not "test in
flight" unless a cell id says so.)

v0 at launch = today's behavior (CPU/GPU) + auditable reasons + lanes that
flip ON as gates pass. The router is the ledger of what is proven, not a bet.

## 7. Open items (each maps to a queued cell)

1. q53 verdict → R7 (and possibly R6) ledger flip.
2. Xiaomi window: q55 (to be designed) — correctness gate for the 4.82×
   experts lane → R2 flip; #24 sustained → R8 flag; R3/R4 correctness.
3. HTP memory model (q44-equivalent for NPU) → replace the npu_fit
   placeholder module.
4. HOSTBUF clean retry (ALIVE §8 note) — does not block v0.
5. Decode-bandwidth check Marco-B′ — could refine R4's decode story; v0
   keeps decode=CPU unconditionally.

## 8. v0 acceptance (when implemented)

Pure function + tables + ledger, unit-tested against every row of §5's trace
(the six combos in REVIEW_SPEC.md §"Rule Ordering Exhaustive Trace" become
the golden set) and every OFF state of §6; zero behavior change on today's
devices with today's lanes (S23 KEXP → CPU; S23 KEXP + thermal_priority →
CPU while R8 is OFF); `reason` logged at every model load; schema_version
check refuses unknown table versions (→ CPU).
