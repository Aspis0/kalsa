// Kernel contract #1: streamed expert mul_mat_id.
//
// This is the ABI surface for the first Kalsa Kernel primitive. It does not
// implement a kernel. Today's champion behind the contract is the stock
// llama.cpp vec_dot path (S1, S2, REPACK 8x4 lost; i8mm 8x8 won the op
// (1.27x) and the token budget (+0.2-4%) but did not clear the 10%
// adoption gate). Alternative impls may be selected by the dispatcher on
// other silicon; they live behind the same oracle.
//
// Numbers below are MEASURED. Do not invent a tighter floor. Sources:
//   reports/moe-mellum2-kernel-s2.md, s3.md, k0.md
//   reports/lineup-card.md, moe-calaqwen-xiaomi.md, moe-g99-freetier.md
//   docs/kernel-plan-v2.md §1
#pragma once

#include <cstddef>
#include <cstdint>

namespace bmoe {
namespace kernel {

// ── oracle ──────────────────────────────────────────────────────────────────

// NMSE vs the use_ref / stock graph. Same bound as the K0 / S2 backend-ops
// gate (test-backend-ops, CPU, MOE_SWIGLU_ID / MUL_MAT_ID). A candidate that
// exceeds this does not ship.
constexpr double kMulMatIdNmseLimit = 5e-4;

// Greedy determinism policy.
//
//   OFF==OFF and ON==ON  (byte-identical back-to-back greedy runs) is required.
//   ON==OFF              is NOT required.
//
// S2 fused ON vs stock OFF is a documented DETERMINISTIC_REORDER class: NMSE
// stays in budget, but a near-tie greedy argmax can flip (first divergence at
// generation word 110 / character 677 on Mellum2 n=256). Treat ON and OFF
// transcripts as non-interchangeable at long n. Adoption of a reorder-class
// impl additionally needs a PPL/quality gate; the NMSE oracle alone is not
// enough. A race (ON!=ON) is a ship-blocker, not a reorder.
enum class DeterminismClass {
    BitIdenticalToStock,  // ON==OFF at n>=256 greedy
    DeterministicReorder, // ON==ON, OFF==OFF, ON!=OFF allowed under the NMSE cap
    Nondeterministic,     // rejected
};

// ── fallback ────────────────────────────────────────────────────────────────

// Always-legal path: stock ggml CPU vec_dot MUL_MAT_ID (use_extra_bufts=false,
// the layout streamed experts actually have). The dispatcher must be able to
// return this impl for every supported shape. There is no "no kernel" hole.
enum class MulMatIdImpl : uint8_t {
    StockVecDot = 0, // champion; default
    FusedS1 = 1,     // virtual tall GEMV; 2.58x at t8 microbench, NULL at t2 on-model
    FusedS2 = 2,     // 5-node SwiGLU fuse; loses ~7% to stock at every same-t pair
    Repack8x4 = 3,   // S3 closed: ID path loses 0.52x at t2
    I8mm8x8 = 4,     // wins the op 1.27x; token-model +0.2..4% (under the 10% gate)
};

constexpr MulMatIdImpl kMulMatIdChampion = MulMatIdImpl::StockVecDot;

// ── supported shapes / quants (S2 matcher predicate list) ───────────────────
//
// The S2 fused matcher is the completeness reference for "what a streamed
// expert FFN looks like". Stock vec_dot is a strict superset (any MUL_MAT_ID
// the backend supports). A new impl must declare which of these it covers.
//
// Core 5-node sequence (production build_moe_ffn, single token):
//   MUL_MAT_ID  MUL_MAT_ID  GLU(SWIGLU, not swapped)  MUL_MAT_ID  MUL
//   all five COMPUTE-flagged
//   gate/up share hidden + ids; down.src[1] is the GLU; down shares ids
//   MUL weights are F32 with shape (1, k, 1)
//   ids->ne[1] == 1          (prefill / n_tokens!=1 stays stock)
//   ids->ne[0] >= 1          (k)
//   gate/up: K-quant, same vec_dot_type
//   down: any type with a vec_dot
//   hidden is vec_dot_type or F32 with from_float
//   workspace fits one quantized hidden + k*n_ff scratch + quantized hidden_ff
//
// Optional reduce tail (the "+4"): VIEW columns of the MUL, ADD-reduce, and
// for k==1 a CONT. Interleaved VIEW/ADD ok. External uses of the fused span
// reject the match.
//
// Quants exercised by the S2 7/7 device gate:
//   gate/up Q4_K, down Q8_0 or Q5_0
//   k in {1, 6, 8}
//   n_tokens == 1 fuses; n_tokens == 2 must NOT
//
// Geometry classes used as contract test vectors (not hardcoded in the
// runtime matcher — it reads tensors):

struct MulMatIdShape {
    const char * name;
    int n_expert;
    int n_expert_used; // k
    int n_tokens;      // 1 = decode (in contract); 2 = must not take a fused impl
    int n_embd;        // gate/up ne[0]
    int n_ff;          // gate/up ne[1]
    const char * gate_up_quant;
    const char * down_quant;
    bool fused_legal; // false => stock only
};

constexpr MulMatIdShape kMulMatIdContractShapes[] = {
    {"mellum-q4k-q8", 64, 8, 1, 2304, 896, "Q4_K", "Q8_0", true},
    {"mellum-q4k-q5", 64, 8, 1, 2304, 896, "Q4_K", "Q5_0", true},
    {"mellum-k1", 64, 1, 1, 2304, 896, "Q4_K", "Q8_0", true},
    {"mellum-k6", 64, 6, 1, 2304, 896, "Q4_K", "Q8_0", true},
    {"mellum-prefill-n2", 64, 8, 2, 2304, 896, "Q4_K", "Q8_0", false},
    {"qwen3moe-class", 128, 8, 1, 2048, 768, "Q4_K", "Q8_0", true},
    {"cheap-edge", 32, 4, 1, 256, 256, "Q4_K", "Q8_0", true},
};

constexpr std::size_t kMulMatIdContractShapeCount =
    sizeof(kMulMatIdContractShapes) / sizeof(kMulMatIdContractShapes[0]);

// ── perf budget per device class ────────────────────────────────────────────
//
// The budget is a FLOOR to defend, not a target to beat. Champion = stock
// vec_dot. Screen doctrine: quote only mWakefulness=Awake cells for product
// numbers; Dozing understates wall (SM8650 Marco t4 8.58 Dozing vs 10.57 Awake).

struct MulMatIdPerfBudget {
    const char * device_class; // SoC, not a marketing name
    const char * geometry;     // which model class the number was measured on
    int threads;
    int n_expert_used;
    float drop_cold_frac;     // 0 = off; 1.0 = uniform-share drop
    double compute_s_per_tok; // decode compute, not wall
    double wall_tok_s;        // decode tok/s; 0 if not a product cell
    const char * screen;      // Awake / Dozing / ranking-only / n/a
    const char * note;
};

// clang-format off
constexpr MulMatIdPerfBudget kMulMatIdPerfBudgets[] = {
    // S23 / SD8 Gen2 / SM8550 — Mellum2 Q4_K_M, k6d10, fused OFF (stock).
    // S2 Phase B, UNPLUGGED, screen Awake. This is the contract floor.
    {"sd8gen2", "mellum-k6d10", 2, 6, 1.0f, 0.148, 5.151, "Awake",
     "stock vec_dot; three kernel families measured; no >10% upside in this regime"},

    // Same silicon, k6d065 stock (drop 0.65). Compute is worse because more
    // experts run; listed so a dispatcher row is not compared to the wrong cell.
    {"sd8gen2", "mellum-k6d065", 2, 6, 0.65f, 0.163, 3.837, "Awake",
     "stock vec_dot; not the floor — more active bytes than d1.0"},

    // Product lineup, k6d065, historical t4 (cpu_capacity rule). U-curve for
    // this SoC is t2; these are shipped-card numbers, not the kernel floor.
    {"sd8gen2", "marco1c-k6d065", 4, 6, 0.65f, 0.0, 8.819, "Awake",
     "lineup card; thread U-curve on this SoC is t2"},
    {"sd8gen2", "calaqwen-k6d065", 4, 6, 0.65f, 0.0, 5.696, "Awake",
     "lineup card; I/O ~30.7 MiB/tok hit 80.7%"},

    // Xiaomi 14 / SM8650. Thread U-curve: t4 > t5 > t6. t6 oversubscribes.
    {"sm8650", "marco1c-k6d065", 4, 6, 0.65f, 0.041, 10.574, "Awake",
     "t4 screen-ON; Dozing t4 is 8.577 — do not quote Dozing as product"},
    {"sm8650", "marco1c-k6d065", 6, 6, 0.65f, 0.0, 4.101, "Awake",
     "card cell at cpu_capacity>=50% (t6); not the U-curve winner"},
    {"sm8650", "calaqwen-k6d065", 6, 6, 0.65f, 0.0, 2.55, "Awake",
     "sustained throttle; first cold cell 4.02 — do not quote 4.02"},

    // Jelly Star / Helio G99. Ranking-only for big streamed MoEs. Resident
    // LFM2.5 is the clean G99 compute number.
    {"g99", "lfm25-q4km-resident", 2, 4, 0.0f, 0.0, 10.60, "n/a",
     "mmap resident, default k=4; implied ~11.0 GB/s; REAP k4 zero-fault resident 10.68"},
    {"g99", "lfm25-q4km-k2", 2, 2, 0.0f, 0.0, 14.38, "n/a",
     "still under the 15 floor; quality unmeasured"},
    {"g99", "marco1c-k6d065", 2, 6, 0.65f, 0.0, 3.642, "ranking-only",
     "I/O matches S23/Xiaomi 51.5/53.5; do not cite 3.64 as product fps"},
    {"g99", "calaqwen-k6d065", 2, 6, 0.65f, 0.0, 1.63, "ranking-only",
     "T3 prompts, not campaign p_fact/p_creative"},

    // Dense control on the same S23 binary: the tax is the 64-micro-expert
    // geometry, not the build.
    {"sd8gen2", "dense-2b", 4, 0, 0.0f, 0.0, 15.9, "n/a",
     "same binary -t 4; shows the MoE geometry tax"},
};
// clang-format on

constexpr std::size_t kMulMatIdPerfBudgetCount = sizeof(kMulMatIdPerfBudgets) / sizeof(kMulMatIdPerfBudgets[0]);

inline const char * mul_mat_id_impl_name(MulMatIdImpl impl) {
    switch (impl) {
    case MulMatIdImpl::StockVecDot:
        return "stock_vec_dot";
    case MulMatIdImpl::FusedS1:
        return "fused_s1";
    case MulMatIdImpl::FusedS2:
        return "fused_s2";
    case MulMatIdImpl::Repack8x4:
        return "repack_8x4";
    case MulMatIdImpl::I8mm8x8:
        return "i8mm_8x8";
    }
    return "unknown";
}

} // namespace kernel
} // namespace bmoe
