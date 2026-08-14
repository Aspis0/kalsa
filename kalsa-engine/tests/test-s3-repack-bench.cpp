// S3 Phase-0 microbench: host-buffer vec_dot MUL_MAT / MUL_MAT_ID vs CPU_REPACK extra-buffer
// microkernels on Mellum-class expert shapes.
//
// Answers: how much can interleaved Q4_K (8-row gemv) buy vs plain vec_dot at the same thread
// count, BEFORE writing a fused-path consumer. On S23 (neon+dotprod, no i8mm) the REPACK type
// is Q4_K_8x4. BigMoeOnEdge currently sets use_extra_bufts=false, so neither stock nor fused
// hits this path under --moe-stream; this bench is the ceiling, not a description of today.
//
// Usage: test-s3-repack-bench [-t N] [-n RUNS] [--no-id]
// Prints µs, GB/s, NMSE(host vs repack), and a token-cost estimate.

#include "ggml.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static int g_n_threads = 0;
static int g_n_runs = 0; // 0 = auto
static bool g_do_id = true;

static void die(const char * msg) {
    fprintf(stderr, "fatal: %s\n", msg);
    exit(1);
}

static uint32_t xorshift32(uint32_t & s) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
}

static float urand(uint32_t & s) {
    return (float) (xorshift32(s) & 0xFFFFFF) / (float) 0x1000000 - 0.5f;
}

static ggml_backend_buffer_type_t find_repack_buft(ggml_backend_dev_t cpu_dev) {
    ggml_backend_reg_t cpu_reg = ggml_backend_dev_backend_reg(cpu_dev);
    auto get_extra = (ggml_backend_dev_get_extra_bufts_t) ggml_backend_reg_get_proc_address(
        cpu_reg, "ggml_backend_dev_get_extra_bufts");
    if (!get_extra) {
        return nullptr;
    }
    ggml_backend_buffer_type_t * extra = get_extra(cpu_dev);
    while (extra && *extra) {
        const char * name = ggml_backend_buft_name(*extra);
        if (name && std::strstr(name, "REPACK")) {
            return *extra;
        }
        ++extra;
    }
    return nullptr;
}

static void set_n_threads(ggml_backend_t backend, int nth) {
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(ggml_backend_get_device(backend));
    auto fn = (ggml_backend_set_n_threads_t) ggml_backend_reg_get_proc_address(reg, "ggml_backend_set_n_threads");
    if (fn) {
        fn(backend, nth);
    }
}

static void fill_f32(ggml_tensor * t, uint32_t seed) {
    const int64_t ne = ggml_nelements(t);
    std::vector<float> tmp((size_t) ne);
    uint32_t s = seed;
    for (int64_t i = 0; i < ne; ++i) {
        tmp[(size_t) i] = urand(s);
    }
    ggml_backend_tensor_set(t, tmp.data(), 0, ggml_nbytes(t));
}

static void fill_quant(ggml_tensor * t, uint32_t seed) {
    const int64_t nrows = ggml_nrows(t);
    const int64_t n_per_row = t->ne[0];
    std::vector<float> src((size_t) nrows * (size_t) n_per_row);
    uint32_t s = seed;
    for (size_t i = 0; i < src.size(); ++i) {
        src[i] = urand(s);
    }
    std::vector<uint8_t> dst(ggml_nbytes(t));
    ggml_quantize_chunk(t->type, src.data(), dst.data(), 0, nrows, n_per_row, nullptr);
    ggml_backend_tensor_set(t, dst.data(), 0, ggml_nbytes(t));
}

static void fill_ids(ggml_tensor * t, int n_used, int n_mats) {
    const int64_t ne = ggml_nelements(t);
    std::vector<int32_t> ids((size_t) ne, 0);
    for (int64_t i = 0; i < ne; ++i) {
        ids[(size_t) i] = (int32_t) (i % n_used);
        if (ids[(size_t) i] >= n_mats) {
            ids[(size_t) i] = 0;
        }
    }
    ggml_backend_tensor_set(t, ids.data(), 0, ggml_nbytes(t));
}

static double nmse(const float * a, const float * b, size_t n) {
    double num = 0.0;
    double den = 0.0;
    for (size_t i = 0; i < n; ++i) {
        const double d = (double) a[i] - (double) b[i];
        num += d * d;
        den += (double) a[i] * (double) a[i];
    }
    return den > 0.0 ? num / den : num;
}

struct bench_case {
    const char * name;
    ggml_type type;
    int64_t m;  // rows of A
    int64_t k;  // inner
    int n_mats; // 1 = MUL_MAT, >1 = MUL_MAT_ID
    int n_used;
};

struct bench_result {
    bool ok;
    bool used_repack;
    const char * buft_name;
    double us;
    double gbs;
    double gflops;
    double nmse_vs_host;
};

static bench_result run_one(ggml_backend_t backend,
                            ggml_backend_buffer_type_t weight_buft,
                            const bench_case & bc,
                            int nth,
                            int n_runs,
                            const std::vector<float> * host_ref) {

    bench_result r{};
    r.ok = false;
    r.nmse_vs_host = -1.0;

    set_n_threads(backend, nth);

    const bool is_id = bc.n_mats > 1;

    ggml_init_params ip = {
        /* .mem_size   = */ ggml_tensor_overhead() * 16 + ggml_graph_overhead(),
        /* .mem_base   = */ nullptr,
        /* .no_alloc   = */ true,
    };
    ggml_context * ctx_w = ggml_init(ip);
    ggml_context * ctx = ggml_init(ip);
    if (!ctx_w || !ctx) {
        die("ggml_init failed");
    }

    ggml_tensor * weights = ggml_new_tensor_3d(ctx_w, bc.type, bc.k, bc.m, is_id ? bc.n_mats : 1);
    ggml_set_name(weights, "W");

    ggml_tensor * act = nullptr;
    ggml_tensor * ids = nullptr;
    ggml_tensor * out = nullptr;
    if (is_id) {
        act = ggml_new_tensor_3d(ctx, GGML_TYPE_F32, bc.k, bc.n_used, 1);
        ids = ggml_new_tensor_2d(ctx, GGML_TYPE_I32, bc.n_used, 1);
        ggml_set_name(act, "act");
        ggml_set_name(ids, "ids");
        out = ggml_mul_mat_id(ctx, weights, act, ids);
    } else {
        act = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, bc.k, 1);
        ggml_set_name(act, "act");
        out = ggml_mul_mat(ctx, weights, act);
    }
    ggml_set_name(out, "out");

    if (!ggml_backend_supports_op(backend, out)) {
        fprintf(stderr, "  skip %s: backend does not support op (buft=%s)\n", bc.name,
                ggml_backend_buft_name(weight_buft));
        ggml_free(ctx);
        ggml_free(ctx_w);
        return r;
    }

    ggml_backend_buffer_t buf_w = ggml_backend_alloc_ctx_tensors_from_buft(ctx_w, weight_buft);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, backend);
    if (!buf_w || !buf) {
        fprintf(stderr, "  skip %s: alloc failed\n", bc.name);
        if (buf_w) ggml_backend_buffer_free(buf_w);
        if (buf) ggml_backend_buffer_free(buf);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return r;
    }
    ggml_backend_buffer_set_usage(buf_w, GGML_BACKEND_BUFFER_USAGE_WEIGHTS);

    r.buft_name = ggml_backend_buffer_name(buf_w);
    r.used_repack = r.buft_name && std::strstr(r.buft_name, "REPACK");
    if (r.used_repack && weights->extra == nullptr) {
        // CPU_REPACK buffer but no traits for this type (e.g. Q5_0). set_tensor would NULL-deref.
        ggml_backend_buffer_free(buf);
        ggml_backend_buffer_free(buf_w);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return r;
    }

    fill_quant(weights, 0xC0FFEEu);
    fill_f32(act, 0xBADC0DEu);
    if (ids) {
        fill_ids(ids, bc.n_used, bc.n_mats);
    }

    ggml_cgraph * gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);

    ggml_status st = ggml_backend_graph_compute(backend, gf);
    if (st != GGML_STATUS_SUCCESS) {
        fprintf(stderr, "  skip %s: compute failed (%s)\n", bc.name, ggml_status_to_string(st));
        ggml_backend_buffer_free(buf);
        ggml_backend_buffer_free(buf_w);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return r;
    }

    const int64_t n_out = ggml_nelements(out);
    std::vector<float> got((size_t) n_out);
    ggml_backend_tensor_get(out, got.data(), 0, ggml_nbytes(out));
    if (host_ref && host_ref->size() == got.size()) {
        r.nmse_vs_host = nmse(host_ref->data(), got.data(), got.size());
    }

    // auto run count: ~200 ms wall or at least 8 runs
    int runs = n_runs;
    if (runs <= 0) {
        const int64_t t0 = ggml_time_us();
        ggml_backend_graph_compute(backend, gf);
        const int64_t dt = std::max<int64_t>(ggml_time_us() - t0, 1);
        runs = (int) std::min<int64_t>(64, std::max<int64_t>(8, 200000 / dt));
    }

    const int64_t t0 = ggml_time_us();
    for (int i = 0; i < runs; ++i) {
        ggml_backend_graph_compute(backend, gf);
    }
    const int64_t t1 = ggml_time_us();
    r.us = (double) (t1 - t0) / (double) runs;

    const double bytes_w = (double) ggml_nbytes(weights) * (is_id ? (double) bc.n_used / (double) bc.n_mats : 1.0);
    const double bytes_a = (double) ggml_nbytes(act);
    r.gbs = (bytes_w + bytes_a) / (r.us * 1e-6) / 1e9;

    const double flops = 2.0 * (double) bc.m * (double) bc.k * (is_id ? (double) bc.n_used : 1.0);
    r.gflops = flops / (r.us * 1e-6) / 1e9;
    r.ok = true;

    ggml_backend_buffer_free(buf);
    ggml_backend_buffer_free(buf_w);
    ggml_free(ctx);
    ggml_free(ctx_w);
    return r;
}

// run_one cannot return the host output easily; separate helper
static bool run_pair(ggml_backend_t backend,
                     ggml_backend_buffer_type_t host_buft,
                     ggml_backend_buffer_type_t repack_buft,
                     const bench_case & bc,
                     int nth) {

    // host
    set_n_threads(backend, nth);

    ggml_init_params ip = {
        ggml_tensor_overhead() * 16 + ggml_graph_overhead(),
        nullptr,
        true,
    };
    ggml_context * ctx_w = ggml_init(ip);
    ggml_context * ctx = ggml_init(ip);
    const bool is_id = bc.n_mats > 1;
    ggml_tensor * weights = ggml_new_tensor_3d(ctx_w, bc.type, bc.k, bc.m, is_id ? bc.n_mats : 1);
    ggml_tensor * act = nullptr;
    ggml_tensor * ids = nullptr;
    ggml_tensor * out = nullptr;
    if (is_id) {
        act = ggml_new_tensor_3d(ctx, GGML_TYPE_F32, bc.k, bc.n_used, 1);
        ids = ggml_new_tensor_2d(ctx, GGML_TYPE_I32, bc.n_used, 1);
        out = ggml_mul_mat_id(ctx, weights, act, ids);
    } else {
        act = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, bc.k, 1);
        out = ggml_mul_mat(ctx, weights, act);
    }
    if (!ggml_backend_supports_op(backend, out)) {
        printf("  %-28s t=%d  SKIP (op unsupported on host)\n", bc.name, nth);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return false;
    }
    ggml_backend_buffer_t buf_w = ggml_backend_alloc_ctx_tensors_from_buft(ctx_w, host_buft);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, backend);
    if (!buf_w || !buf) {
        printf("  %-28s t=%d  SKIP (host alloc)\n", bc.name, nth);
        if (buf_w) ggml_backend_buffer_free(buf_w);
        if (buf) ggml_backend_buffer_free(buf);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return false;
    }
    fill_quant(weights, 0xC0FFEEu);
    fill_f32(act, 0xBADC0DEu);
    if (ids) fill_ids(ids, bc.n_used, bc.n_mats);

    ggml_cgraph * gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    if (ggml_backend_graph_compute(backend, gf) != GGML_STATUS_SUCCESS) {
        printf("  %-28s t=%d  SKIP (host compute)\n", bc.name, nth);
        ggml_backend_buffer_free(buf);
        ggml_backend_buffer_free(buf_w);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return false;
    }
    std::vector<float> host_out((size_t) ggml_nelements(out));
    ggml_backend_tensor_get(out, host_out.data(), 0, ggml_nbytes(out));

    int runs = g_n_runs;
    if (runs <= 0) {
        const int64_t t0 = ggml_time_us();
        ggml_backend_graph_compute(backend, gf);
        const int64_t dt = std::max<int64_t>(ggml_time_us() - t0, 1);
        runs = (int) std::min<int64_t>(64, std::max<int64_t>(8, 200000 / dt));
    }
    int64_t t0 = ggml_time_us();
    for (int i = 0; i < runs; ++i)
        ggml_backend_graph_compute(backend, gf);
    const double us_host = (double) (ggml_time_us() - t0) / (double) runs;

    const double bytes_w = (double) ggml_nbytes(weights) * (is_id ? (double) bc.n_used / (double) bc.n_mats : 1.0);
    const double bytes_a = (double) ggml_nbytes(act);
    const double gbs_host = (bytes_w + bytes_a) / (us_host * 1e-6) / 1e9;
    const double flops = 2.0 * (double) bc.m * (double) bc.k * (is_id ? (double) bc.n_used : 1.0);
    const double gf_host = flops / (us_host * 1e-6) / 1e9;

    ggml_backend_buffer_free(buf);
    ggml_backend_buffer_free(buf_w);
    ggml_free(ctx);
    ggml_free(ctx_w);

    // REPACK path
    bench_result rp = run_one(backend, repack_buft, bc, nth, runs, &host_out);

    printf("  %-28s t=%-2d  host %8.2f us  %5.1f GB/s  %6.1f GF/s", bc.name, nth, us_host, gbs_host, gf_host);
    if (!rp.ok) {
        printf("  | REPACK  SKIP  (buft=%s)\n", rp.buft_name ? rp.buft_name : "none");
        return false;
    }
    const double speedup = us_host / rp.us;
    printf("  | REPACK %8.2f us  %5.1f GB/s  %6.1f GF/s  x%.3f  nmse=%.3e  %s\n", rp.us, rp.gbs, rp.gflops, speedup,
           rp.nmse_vs_host,
           rp.used_repack ? "CPU_REPACK"
           : rp.buft_name ? rp.buft_name
                          : "?");

    // stash last t=2 Q4_K ID numbers via globals for the token estimate
    return true;
}

// last measured host/repack µs for the token model (filled by main)
static double g_host_q4k_id_t2 = 0;
static double g_rep_q4k_id_t2 = 0;
static double g_host_q4k_gv_t2 = 0;
static double g_rep_q4k_gv_t2 = 0;
static double g_host_q80_gv_t2 = 0;
static double g_rep_q80_gv_t2 = 0;
static double g_host_q50_gv_t2 = 0;
static double g_rep_q50_gv_t2 = 0;

// re-run the pair but capture numbers into the globals for specific cases
static void run_pair_capture(ggml_backend_t backend,
                             ggml_backend_buffer_type_t host_buft,
                             ggml_backend_buffer_type_t repack_buft,
                             const bench_case & bc,
                             int nth,
                             double * host_us,
                             double * rep_us) {

    set_n_threads(backend, nth);
    ggml_init_params ip = {ggml_tensor_overhead() * 16 + ggml_graph_overhead(), nullptr, true};
    ggml_context * ctx_w = ggml_init(ip);
    ggml_context * ctx = ggml_init(ip);
    const bool is_id = bc.n_mats > 1;
    ggml_tensor * weights = ggml_new_tensor_3d(ctx_w, bc.type, bc.k, bc.m, is_id ? bc.n_mats : 1);
    ggml_tensor * act = is_id ? ggml_new_tensor_3d(ctx, GGML_TYPE_F32, bc.k, bc.n_used, 1)
                              : ggml_new_tensor_2d(ctx, GGML_TYPE_F32, bc.k, 1);
    ggml_tensor * ids = is_id ? ggml_new_tensor_2d(ctx, GGML_TYPE_I32, bc.n_used, 1) : nullptr;
    ggml_tensor * out = is_id ? ggml_mul_mat_id(ctx, weights, act, ids) : ggml_mul_mat(ctx, weights, act);
    if (!ggml_backend_supports_op(backend, out)) {
        ggml_free(ctx);
        ggml_free(ctx_w);
        return;
    }
    ggml_backend_buffer_t buf_w = ggml_backend_alloc_ctx_tensors_from_buft(ctx_w, host_buft);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, backend);
    if (!buf_w || !buf) {
        if (buf_w) ggml_backend_buffer_free(buf_w);
        if (buf) ggml_backend_buffer_free(buf);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return;
    }
    fill_quant(weights, 0xC0FFEEu);
    fill_f32(act, 0xBADC0DEu);
    if (ids) fill_ids(ids, bc.n_used, bc.n_mats);
    ggml_cgraph * gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    if (ggml_backend_graph_compute(backend, gf) != GGML_STATUS_SUCCESS) {
        ggml_backend_buffer_free(buf);
        ggml_backend_buffer_free(buf_w);
        ggml_free(ctx);
        ggml_free(ctx_w);
        return;
    }
    std::vector<float> host_out((size_t) ggml_nelements(out));
    ggml_backend_tensor_get(out, host_out.data(), 0, ggml_nbytes(out));
    int runs = g_n_runs;
    if (runs <= 0) {
        const int64_t t0 = ggml_time_us();
        ggml_backend_graph_compute(backend, gf);
        const int64_t dt = std::max<int64_t>(ggml_time_us() - t0, 1);
        runs = (int) std::min<int64_t>(64, std::max<int64_t>(8, 200000 / dt));
    }
    int64_t t0 = ggml_time_us();
    for (int i = 0; i < runs; ++i)
        ggml_backend_graph_compute(backend, gf);
    *host_us = (double) (ggml_time_us() - t0) / (double) runs;
    ggml_backend_buffer_free(buf);
    ggml_backend_buffer_free(buf_w);
    ggml_free(ctx);
    ggml_free(ctx_w);

    bench_result rp = run_one(backend, repack_buft, bc, nth, runs, &host_out);
    *rep_us = rp.ok ? rp.us : 0.0;
}

int main(int argc, char ** argv) {
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "-t") && i + 1 < argc) {
            g_n_threads = std::atoi(argv[++i]);
        } else if (!std::strcmp(argv[i], "-n") && i + 1 < argc) {
            g_n_runs = std::atoi(argv[++i]);
        } else if (!std::strcmp(argv[i], "--no-id")) {
            g_do_id = false;
        } else if (!std::strcmp(argv[i], "-h") || !std::strcmp(argv[i], "--help")) {
            printf("usage: %s [-t N] [-n RUNS] [--no-id]\n", argv[0]);
            return 0;
        }
    }

    ggml_time_init();
    ggml_backend_load_all();

    ggml_backend_dev_t cpu_dev = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU);
    if (!cpu_dev) die("no CPU backend");
    ggml_backend_t backend = ggml_backend_dev_init(cpu_dev, nullptr);
    if (!backend) die("cpu init failed");

    ggml_backend_buffer_type_t host_buft = ggml_backend_get_default_buffer_type(backend);
    ggml_backend_buffer_type_t repack_buft = find_repack_buft(cpu_dev);

    printf("S3 REPACK microbench\n");
    printf("  neon=%d  dotprod=%d  i8mm=%d  avx2=%d  llamafile=%d\n", ggml_cpu_has_neon(), ggml_cpu_has_dotprod(),
           ggml_cpu_has_matmul_int8(), ggml_cpu_has_avx2(), ggml_cpu_has_llamafile());
    printf("  host_buft=%s  repack_buft=%s\n", ggml_backend_buft_name(host_buft),
           repack_buft ? ggml_backend_buft_name(repack_buft) : "NONE");
    {
        ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(cpu_dev);
        auto get_feat =
            (ggml_backend_get_features_t) ggml_backend_reg_get_proc_address(reg, "ggml_backend_get_features");
        if (get_feat) {
            auto * f = get_feat(reg);
            printf("  features:");
            for (; f && f->name; ++f) {
                printf(" %s=%s", f->name, f->value ? f->value : "");
            }
            printf("\n");
        }
    }
    if (!repack_buft) {
        fprintf(stderr, "CPU_REPACK extra buffer type not registered. GGML_USE_CPU_REPACK off?\n");
        ggml_backend_free(backend);
        return 2;
    }

    std::vector<int> nth_list;
    if (g_n_threads > 0) {
        nth_list.push_back(g_n_threads);
    } else {
        nth_list = {1, 2, 8};
    }

    // Mellum-class shapes. type / m / k / n_mats / n_used
    const bench_case cases[] = {
        {"Q4_K gemv 896x2304", GGML_TYPE_Q4_K, 896, 2304, 1, 1},
        {"Q4_K gemv 8x2304", GGML_TYPE_Q4_K, 8, 2304, 1, 1},
        {"Q4_K tall 7168x2304", GGML_TYPE_Q4_K, 7168, 2304, 1, 1},
        {"Q8_0 gemv 2304x896", GGML_TYPE_Q8_0, 2304, 896, 1, 1},
        {"Q5_0 gemv 2304x896", GGML_TYPE_Q5_0, 2304, 896, 1, 1},
        {"Q4_K id 64/8 896x2304", GGML_TYPE_Q4_K, 896, 2304, 64, 8},
        {"Q4_K id 64/6 896x2304", GGML_TYPE_Q4_K, 896, 2304, 64, 6},
        {"Q8_0 id 64/8 2304x896", GGML_TYPE_Q8_0, 2304, 896, 64, 8},
        {"Q5_0 id 64/8 2304x896", GGML_TYPE_Q5_0, 2304, 896, 64, 8},
    };

    printf("\n%-30s      host                              | REPACK\n", "case");

    for (int nth : nth_list) {
        for (const bench_case & bc : cases) {
            if (!g_do_id && bc.n_mats > 1) continue;
            run_pair(backend, host_buft, repack_buft, bc, nth);
        }
        printf("\n");
    }

    // Capture t=2 (or the requested t) numbers for the token model.
    const int t_model = g_n_threads > 0 ? g_n_threads : 2;
    {
        const bench_case c_id = {"cap", GGML_TYPE_Q4_K, 896, 2304, 64, 6};
        const bench_case c_gv = {"cap", GGML_TYPE_Q4_K, 896, 2304, 1, 1};
        const bench_case c_q80 = {"cap", GGML_TYPE_Q8_0, 2304, 896, 1, 1};
        const bench_case c_q50 = {"cap", GGML_TYPE_Q5_0, 2304, 896, 1, 1};
        run_pair_capture(backend, host_buft, repack_buft, c_id, t_model, &g_host_q4k_id_t2, &g_rep_q4k_id_t2);
        run_pair_capture(backend, host_buft, repack_buft, c_gv, t_model, &g_host_q4k_gv_t2, &g_rep_q4k_gv_t2);
        run_pair_capture(backend, host_buft, repack_buft, c_q80, t_model, &g_host_q80_gv_t2, &g_rep_q80_gv_t2);
        run_pair_capture(backend, host_buft, repack_buft, c_q50, t_model, &g_host_q50_gv_t2, &g_rep_q50_gv_t2);
    }

    // Token model: 28 layers, k=6, one Q4_K gate + one Q4_K up + half Q8_0 / half Q5_0 down.
    // ID numbers already include k=6. GEMV numbers are one expert — scale by 6.
    const double layers = 28.0;
    const double k_used = 6.0;
    const double host_gateup = g_host_q4k_id_t2 > 0 ? 2.0 * g_host_q4k_id_t2 : 2.0 * k_used * g_host_q4k_gv_t2;
    const double rep_gateup = g_rep_q4k_id_t2 > 0 ? 2.0 * g_rep_q4k_id_t2 : 2.0 * k_used * g_rep_q4k_gv_t2;
    const double host_down = k_used * 0.5 * (g_host_q80_gv_t2 + g_host_q50_gv_t2);
    const double rep_down = k_used * 0.5 *
                            ((g_rep_q80_gv_t2 > 0 ? g_rep_q80_gv_t2 : g_host_q80_gv_t2) +
                             (g_rep_q50_gv_t2 > 0 ? g_rep_q50_gv_t2 : g_host_q50_gv_t2));

    const double host_s = layers * (host_gateup + host_down) * 1e-6;
    const double rep_s = layers * (rep_gateup + rep_down) * 1e-6;
    const double delta = host_s - rep_s;
    const double compute_t2 = 0.148; // S2 stock k6d10 t2
    const double frac = compute_t2 > 0 ? delta / compute_t2 : 0;

    printf("=== token model (28 layers, k=6, t=%d) ===\n", t_model);
    printf("  host  gate+up ID  %8.1f us   down %8.1f us   token %8.4f s\n", host_gateup, host_down, host_s);
    printf("  REPACK gate+up    %8.1f us   down %8.1f us   token %8.4f s\n", rep_gateup, rep_down, rep_s);
    printf("  delta             %8.4f s/tok  = %5.1f%% of S2 stock compute 0.148\n", delta, 100.0 * frac);
    printf("  Q4_K single gemv  host %.1f us  REPACK %.1f us\n", g_host_q4k_gv_t2, g_rep_q4k_gv_t2);
    printf("  honesty: %s  (need >= ~10%% of compute = 0.0148 s/tok to justify S3)\n",
           frac >= 0.10 ? "HEADROOM" : "NO_HEADROOM");

    ggml_quantize_free();
    ggml_backend_free(backend);
    return 0;
}
