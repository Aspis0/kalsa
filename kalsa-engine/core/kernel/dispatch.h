// Per-SoC dispatcher: (SoC class, RAM budget, model geometry) → {threads, k, drop, impl}.
//
// This is the autotune layer inside the kernel library (plan v2 §1, ex-K-A). The
// static table is seeded with measured U-curves. A first-launch micro-bench hook
// exists as an interface + stub; it is not wired into resolve() yet.
//
// ram_mb is detected and logged but resolve_dispatch does not consult it. The
// table cannot express RAM tiers until the first-launch probe exists; until
// then the static U-curve row wins (including sd8gen2/mellum). A probe that
// soaks RAM will assign the tier — do not invent a ram_mb cutoff here.
//
// Pure policy (except probe_geometry, the llama adapter): no llama.cpp, no
// getenv. The CLI passes a cache path if it wants one. detect_device() reads
// /proc or the Win32 memory/CPU APIs.
#pragma once

#include "contract_mul_mat_id.h"

#include <string>

namespace bmoe {
namespace kernel {

enum class SocClass {
    Unknown = 0,
    Host,     // desktop / CI — keep engine defaults (t=4, k=0, drop=0)
    Sd8Gen2,  // SM8550, S23-class. U-curve winner: t=2
    Sm8650,   // 8 Gen 3, Xiaomi 14-class. U-curve winner: t=4 (t4>t5>t6)
    HelioG99, // MT6789, Jelly-class. U-curve winner: t=2
};

enum class GeometryClass {
    Unknown = 0,
    Mellum,   // 2304×896, 64 experts (Mellum2)
    Qwen3Moe, // ~2048 embd, 128 experts
    Lfm2Moe,  // 2048 embd, 32 experts, default k=4
};

struct DeviceProfile {
    SocClass soc = SocClass::Unknown;
    int ram_mb = 0;          // 0 = unknown
    std::string soc_raw;     // "SM8550" / "MT6789" / "x86_64" / ...
    std::string detect_note; // how we decided
};

struct ModelGeometry {
    int n_embd = 0;
    int n_ff = 0;
    int n_expert = 0;
    int n_expert_used = 0; // model default top-k; 0 = unknown
    int n_layer = 0;
    std::string arch; // gguf general.architecture, may be empty
};

struct DispatchDecision {
    int n_threads = 4;
    int n_expert_used = 0; // 0 = do not override the model's default
    float drop_cold_frac = 0.0f;
    MulMatIdImpl impl = kMulMatIdChampion;
    SocClass soc = SocClass::Unknown;
    GeometryClass geo = GeometryClass::Unknown;
    const char * table_key = "";
    const char * reason = "";
};

// Classify a SoC from raw identifiers (cpuinfo Hardware, soc0, compile-time).
SocClass classify_soc(const char * raw);

// Classify geometry from tensor dims / arch string. Unknown if nothing matches.
GeometryClass classify_geometry(const ModelGeometry & geo);

// Probe the running machine. Never reads environment variables.
DeviceProfile detect_device();

// Table lookup. Host / unknown SoC resolve to the engine defaults so a PC
// `--kernel-dispatch` run is config-equivalent to dispatch off.
DispatchDecision resolve_dispatch(const DeviceProfile & dev, const ModelGeometry & geo);

// Apply a table row onto the caller's current knobs. User/env-owned fields
// are left untouched — the table never clobbers an explicit flag. k/drop
// sentinels (0) mean "do not override" even when the user said nothing.
struct DispatchApplyFlags {
    bool user_set_threads = false;
    bool user_set_expert_used = false;
    bool user_set_drop = false;
};

struct DispatchApplied {
    int n_threads = 4;
    int n_expert_used = 0;
    float drop_cold_frac = 0.0f;
    bool applied_threads = false;
    bool applied_expert_used = false;
    bool applied_drop = false;
    bool output_changing_row = false; // row has k>0 or drop>0
};

DispatchApplied apply_dispatch(
    const DispatchDecision & row, int cur_threads, int cur_expert_used, float cur_drop, DispatchApplyFlags flags);

// Peek GGUF metadata (no tensor bytes) into ModelGeometry. Returns false if
// the file cannot be opened. Implemented in the llama adapter; the table
// itself stays llama-free.
bool probe_geometry(const char * model_path, ModelGeometry & out);

const char * soc_class_name(SocClass s);
const char * geometry_class_name(GeometryClass g);

// ── first-launch micro-bench hook (stub) ────────────────────────────────────
//
// Design, not an implementation:
//
//   Cache file (CLI chooses the directory — core never getenv's):
//     <cache_dir>/kalsa-kernel/dispatch-v1.json
//
//   Record key: (soc_class, ram_bucket_gb, geometry_class, model_sha256,
//                engine_commit, impl_id). ram_bucket is floor(ram_mb/1024)
//                so a 200 MB delta does not bust the cache.
//
//   Record value: {n_threads, n_expert_used, drop_cold_frac, impl,
//                  compute_s_tok, wall_tok_s, probed_unix, commit}.
//
//   Probe (TODO): when no record matches, run a 4-cell thread sweep
//   {2,4,6,8} at the table's k/drop (or model default), n=32 greedy, pick
//   the median-compute winner, write the record. Never probe when a
//   record exists. The static table is the seed and the fallback if the
//   probe is skipped or fails.
//
//   Do NOT call this from resolve_dispatch today.

struct AutobenchRequest {
    DeviceProfile device;
    ModelGeometry geometry;
    std::string cache_path; // empty = "no cache, do not probe"
    std::string model_sha;  // optional, hex
    std::string commit;     // optional
};

struct AutobenchResult {
    bool ran = false;
    bool cache_hit = false;
    DispatchDecision decision{};
    const char * note = "TODO: first-launch micro-bench not implemented";
};

// Stub: always returns ran=false, cache_hit=false, and leaves decision
// default-initialized. Callers must keep using resolve_dispatch (once).
AutobenchResult run_autobench_stub(const AutobenchRequest & req);

// Relative path the CLI should append to its cache directory.
inline const char * autobench_cache_relpath() {
    return "kalsa-kernel/dispatch-v1.json";
}

} // namespace kernel
} // namespace bmoe
