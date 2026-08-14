// llama adapter for kernel::probe_geometry. dispatch.cpp stays llama-free.
#include "gguf_offsets.h"
#include "kernel/dispatch.h"

namespace bmoe {
namespace kernel {

bool probe_geometry(const char * model_path, ModelGeometry & out) {
    if (!model_path || !*model_path) return false;
    const GgufModelInfo info = read_gguf_model_info(model_path);
    if (!info.ok) return false;
    out.arch = info.arch;
    out.n_embd = info.n_embd;
    out.n_ff = info.n_ff;
    out.n_expert = info.n_expert;
    out.n_expert_used = info.n_expert_used;
    out.n_layer = info.n_layer;
    return true;
}

} // namespace kernel
} // namespace bmoe
