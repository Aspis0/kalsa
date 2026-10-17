// Per-node Metal profiler for LFM2.5-2.6B prefill, built against the EXACT
// vendored llama.cpp the Kalsa app ships (fork @ efd35d40).
//
// Uses llama_context_params.cb_eval. The ggml scheduler synchronizes the GPU
// after each *instrumented* node group, and non-matching nodes are batched into
// one graph view (callback returns need=false), so filtering keeps the
// perturbation small.
//
// Build: see scripts/03-build-profiler.sh
#include "llama.h"
#include "ggml.h"
#include "ggml-backend.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <algorithm>

struct agg {
    double   us   = 0.0;   // total wall us
    int64_t  n    = 0;     // node count
    double   us_max = 0.0;
    std::string sig;       // representative shape/type signature
};

struct profiler {
    std::map<std::string, agg> by_op;      // op name
    std::map<std::string, agg> by_node;    // normalized node name
    std::map<std::string, agg> by_sig;     // op + shape + src-type signature
    std::vector<std::string> filter;       // instrument only these ops (empty = all)
    int64_t t_start = 0;
    bool    asking  = false;
    std::string cur_name, cur_op, cur_sig;
    double  overhead_us = 0.0;
    int64_t n_syncs = 0;

    bool match(const std::string & op) const {
        if (filter.empty()) return true;
        for (const auto & f : filter) if (op.find(f) != std::string::npos) return true;
        return false;
    }
};

static std::string norm_name(const char * raw) {
    std::string s = raw ? raw : "?";
    // blk.12. -> blk.N. so layers aggregate together
    size_t p;
    while ((p = s.find('.')) != std::string::npos) {
        size_t start = p + 1, end = start;
        while (end < s.size() && isdigit((unsigned char) s[end])) end++;
        if (end > start) s.replace(start, end - start, "N");
        else break;
    }
    return s;
}

static std::string shape_sig(ggml_tensor * t) {
    char buf[512];
    int n = snprintf(buf, sizeof(buf), "%s ne=[", ggml_op_name(t->op));
    for (int i = 0; i < GGML_MAX_DIMS; i++) {
        n += snprintf(buf + n, sizeof(buf) - n, "%s%lld", i ? "," : "", (long long) t->ne[i]);
        if (t->ne[i] <= 1) break;
    }
    n += snprintf(buf + n, sizeof(buf) - n, "] dt=%s", ggml_type_name(t->type));
    if (t->src[0]) {
        n += snprintf(buf + n, sizeof(buf) - n, " s0=%s", ggml_type_name(t->src[0]->type));
    }
    if (t->src[1] && t->op == GGML_OP_MUL_MAT) {
        n += snprintf(buf + n, sizeof(buf) - n, " s1=%s", ggml_type_name(t->src[1]->type));
    }
    if (t->src[2] && t->op == GGML_OP_MUL_MAT) {
        n += snprintf(buf + n, sizeof(buf) - n, " s2=%s", ggml_type_name(t->src[2]->type));
    }
    return std::string(buf, n);
}

static ggml_type parse_type(const char * s) {
    if (!s || !*s || strcmp(s, "f16") == 0) return GGML_TYPE_F16;
    if (strcmp(s, "f32") == 0) return GGML_TYPE_F32;
    if (strcmp(s, "q8_0") == 0) return GGML_TYPE_Q8_0;
    if (strcmp(s, "q8_1") == 0) return GGML_TYPE_Q8_1;
    if (strcmp(s, "q5_0") == 0) return GGML_TYPE_Q5_0;
    if (strcmp(s, "q5_1") == 0) return GGML_TYPE_Q5_1;
    if (strcmp(s, "q4_0") == 0) return GGML_TYPE_Q4_0;
    fprintf(stderr, "unknown type '%s'\n", s);
    exit(1);
}

static bool eval_cb(ggml_tensor * t, bool ask, void * ud) {
    profiler * p = (profiler *) ud;
    if (ask) {
        const char * op = ggml_op_name(t->op);
        if (!p->match(op)) return false;         // batch this node with its neighbours
        p->cur_op   = op;
        p->cur_name = norm_name(ggml_get_name(t));
        p->cur_sig  = shape_sig(t);
        p->t_start  = ggml_time_us();
        p->asking   = true;
        return true;
    }
    if (!p->asking) return false;
    p->asking = false;
    const double us = (double) (ggml_time_us() - p->t_start);
    p->n_syncs++;

    auto add = [](agg & a, double v) {
        a.us += v; a.n += 1; a.us_max = std::max(a.us_max, v);
    };
    agg & ao = p->by_op[p->cur_op];    if (ao.sig.empty()) ao.sig = p->cur_sig; add(ao, us);
    agg & an = p->by_node[p->cur_name]; if (an.sig.empty()) an.sig = p->cur_sig; add(an, us);
    agg & as = p->by_sig[p->cur_op + " | " + p->cur_sig]; add(as, us);
    return true;
}

static void dump(const char * tag, std::map<std::string, agg> & m, double total_us, int limit) {
    std::vector<std::pair<std::string, agg *>> v;
    double sum = 0;
    for (auto & kv : m) { v.push_back({kv.first, &kv.second}); sum += kv.second.us; }
    std::sort(v.begin(), v.end(), [](auto & a, auto & b) { return a.second->us > b.second->us; });
    printf("\n### %s  (total %.2f ms across nodes, %.2f ms wall)\n", tag, sum / 1000.0, total_us / 1000.0);
    printf("%-42s %10s %8s %9s %7s  %s\n", "key", "ms", "%tot", "max_us", "count", "sig");
    int i = 0;
    for (auto & kv : v) {
        if (limit > 0 && i++ >= limit) { printf("... (%zu more)\n", v.size() - limit); break; }
        printf("%-42s %10.3f %7.2f%% %9.1f %7lld  %s\n", kv.first.c_str(),
               kv.second->us / 1000.0, total_us > 0 ? 100.0 * kv.second->us / total_us : 0.0,
               kv.second->us_max, (long long) kv.second->n, kv.second->sig.c_str());
    }
}

int main(int argc, char ** argv) {
    const char * model_path = nullptr;
    int n_tokens = 2048, ngl = 99, n_batch = 512, n_ubatch = 256, n_threads = 4, reps = 1;
    enum ggml_type ctk = GGML_TYPE_Q8_0, ctv = GGML_TYPE_Q8_0;
    enum llama_flash_attn_type fa = LLAMA_FLASH_ATTN_TYPE_AUTO;
    const char * filter_csv = "";   // e.g. "MUL_MAT,FLASH_ATTN_EXT,SSM_CONV"
    const char * out_prefix = nullptr;

    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { return argv[++i]; };
        if      (a == "-m") model_path = next();
        else if (a == "-n") n_tokens  = atoi(next());
        else if (a == "-ngl") ngl     = atoi(next());
        else if (a == "-b") n_batch   = atoi(next());
        else if (a == "-ub") n_ubatch = atoi(next());
        else if (a == "-t") n_threads = atoi(next());
        else if (a == "-r") reps      = atoi(next());
        else if (a == "-ctk") { std::string s = next(); ctk = parse_type(s.c_str()); }
        else if (a == "-ctv") { std::string s = next(); ctv = parse_type(s.c_str()); }
        else if (a == "-fa") { std::string s = next(); fa = (s=="on") ? LLAMA_FLASH_ATTN_TYPE_ENABLED : (s=="off" ? LLAMA_FLASH_ATTN_TYPE_DISABLED : LLAMA_FLASH_ATTN_TYPE_AUTO); }
        else if (a == "--filter") filter_csv = next();
        else if (a == "-o") out_prefix = next();
        else { fprintf(stderr, "unknown arg %s\n", a.c_str()); return 1; }
    }
    if (!model_path) { fprintf(stderr, "need -m\n"); return 1; }

    ggml_backend_load_all();
    ggml_time_init();

    llama_backend_init();
    llama_numa_init(GGML_NUMA_STRATEGY_DISABLED);

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = ngl;
    mparams.mmap_prefetch = 1;

    llama_model * model = llama_load_model_from_file(model_path, mparams);
    if (!model) { fprintf(stderr, "load failed\n"); return 1; }

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx            = 8192;
    cparams.n_batch          = n_batch;
    cparams.n_ubatch         = n_ubatch;
    cparams.n_threads        = n_threads;
    cparams.n_threads_batch  = n_threads;
    cparams.type_k           = ctk;
    cparams.type_v           = ctv;
    cparams.flash_attn_type  = fa;
    cparams.no_perf          = false;

    profiler prof;
    {
        std::string f(filter_csv);
        size_t p = 0;
        while (p < f.size()) {
            size_t c = f.find(',', p);
            if (c == std::string::npos) c = f.size();
            if (c > p) prof.filter.push_back(f.substr(p, c - p));
            p = c + 1;
        }
    }
    cparams.cb_eval         = eval_cb;
    cparams.cb_eval_user_data = &prof;

    llama_context * ctx = llama_init_from_model(model, cparams);
    if (!ctx) { fprintf(stderr, "ctx failed\n"); return 1; }

    // batch of real (token id 1) tokens
    llama_batch batch = llama_batch_init(n_tokens, 0, 1);
    batch.n_tokens = n_tokens;
    for (int i = 0; i < n_tokens; i++) {
        batch.token[i]   = 1 + (i % 1000);
        batch.pos[i]     = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i]  = (i == n_tokens - 1);
    }

    // llama_decode() takes at most n_batch tokens; llama-bench splits the prompt
    // the same way. Chunk here so the profile matches llama-bench exactly.
    auto decode_chunked = [&](llama_context * cx) -> int {
        for (int off = 0; off < n_tokens; off += n_batch) {
            int cnt = std::min(n_batch, n_tokens - off);
            llama_batch b = batch;
            b.n_tokens = cnt;
            for (int i = 0; i < cnt; i++) b.pos[i] = off + i;
            int rc = llama_decode(cx, b);
            if (rc != 0) return rc;
        }
        return 0;
    };

    // warmup: builds the graph, compiles Metal shaders
    for (int w = 0; w < 2; w++) {
        llama_memory_clear(llama_get_memory(ctx), true);
        if (decode_chunked(ctx) != 0) { fprintf(stderr, "warmup decode failed\n"); return 1; }
    }

    double wall_total = 0.0;
    for (int r = 0; r < reps; r++) {
        llama_memory_clear(llama_get_memory(ctx), true);
        int64_t t0 = ggml_time_us();
        int rc = decode_chunked(ctx);
        double dt = (double)(ggml_time_us() - t0);
        if (rc != 0) { fprintf(stderr, "decode rc=%d\n", rc); return 1; }
        wall_total += dt;
        printf("rep %d: %.3f ms  (%.1f tok/s prefill, instrumented)\n", r, dt / 1000.0, n_tokens / (dt / 1e6));
    }

    // clean (uninstrumented) timing for comparison
    {
        llama_context_params cp2 = llama_context_default_params();
        cp2.n_ctx = 8192; cp2.n_batch = n_batch; cp2.n_ubatch = n_ubatch;
        cp2.n_threads = n_threads; cp2.n_threads_batch = n_threads;
        cp2.type_k = ctk; cp2.type_v = ctv; cp2.flash_attn_type = fa;
        llama_context * c2 = llama_init_from_model(model, cp2);
        if (c2) {
            for (int w = 0; w < 2; w++) { llama_memory_clear(llama_get_memory(c2), true); decode_chunked(c2); }
            double best = 1e18;
            for (int r = 0; r < reps; r++) {
                llama_memory_clear(llama_get_memory(c2), true);
                int64_t t0 = ggml_time_us();
                decode_chunked(c2);
                best = std::min(best, (double)(ggml_time_us() - t0));
            }
            printf("\n=== CLEAN (no callback) best prefill: %.3f ms  => %.1f tok/s\n",
                   best / 1000.0, n_tokens / (best / 1e6));
            printf("instrumented overhead: %.1f%% (%lld syncs)\n",
                   100.0 * (wall_total / reps - best) / best, (long long) prof.n_syncs);
            llama_free(c2);
        }
    }

    printf("\n=== config: n=%d ng=%d b=%d ub=%d t=%d ctk=%s ctv=%s fa=%d filter=%s\n",
           n_tokens, ngl, n_batch, n_ubatch, n_threads,
           ggml_type_name(ctk), ggml_type_name(ctv), (int) fa, filter_csv[0] ? filter_csv : "(all)");
    dump("PER OP", prof.by_op, wall_total, 0);
    dump("PER NODE NAME", prof.by_node, wall_total, 40);
    dump("PER OP+SHAPE (top time consumers)", prof.by_sig, wall_total, 45);

    if (out_prefix) {
        std::string fn = std::string(out_prefix) + ".txt";
        FILE * f = fopen(fn.c_str(), "w");
        if (f) {
            fprintf(f, "config n=%d ng=%d b=%d ub=%d t=%d ctk=%s ctv=%s fa=%d filter=%s wall_ms=%.3f\n",
                    n_tokens, ngl, n_batch, n_ubatch, n_threads, ggml_type_name(ctk),
                    ggml_type_name(ctv), (int) fa, filter_csv[0] ? filter_csv : "(all)",
                    wall_total / reps / 1000.0);
            for (auto & kv : prof.by_sig) fprintf(f, "SIG\t%s\t%.3f\t%lld\n", kv.first.c_str(), kv.second.us / 1000.0, (long long) kv.second.n);
            for (auto & kv : prof.by_op)  fprintf(f, "OP\t%s\t%.3f\t%lld\n", kv.first.c_str(), kv.second.us / 1000.0, (long long) kv.second.n);
            for (auto & kv : prof.by_node)fprintf(f, "NODE\t%s\t%.3f\t%lld\n", kv.first.c_str(), kv.second.us / 1000.0, (long long) kv.second.n);
            fclose(f);
            printf("wrote %s\n", fn.c_str());
        }
    }

    llama_batch_free(batch);
    llama_free(ctx);
    llama_model_free(model);
    llama_backend_free();
    return 0;
}