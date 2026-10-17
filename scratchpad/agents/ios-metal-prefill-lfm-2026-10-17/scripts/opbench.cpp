// Per-op microbenchmark for the ops LFM2.5-2.6B uses, on the FORK's ggml-metal
// (the kernels the Kalsa app ships). Each case runs REPS times and is timed with
// ONE sync at the end, so measurement overhead is amortised -> unlike per-node
// cb_eval (which pays a ~0.5 ms Metal wait per node on this machine).
#include "ggml.h"
#include "ggml-metal.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <random>
#include <functional>

static std::vector<uint8_t> make_data(ggml_type t, size_t nbytes, uint32_t seed) {
    std::vector<uint8_t> v(nbytes);
    std::mt19937 rng(seed);
    if (t == GGML_TYPE_F32 || t == GGML_TYPE_F16) {
        size_t nf = nbytes / (t == GGML_TYPE_F32 ? 4 : 2);
        std::normal_distribution<float> d(0.f, 1.f);
        for (size_t i = 0; i < nf; i++) {
            float x = d(rng) * 0.05f;
            if (t == GGML_TYPE_F32) memcpy(&v[i * 4], &x, 4);
            else { ggml_fp16_t h = ggml_fp32_to_fp16(x); memcpy(&v[i * 2], &h, 2); }
        }
    } else {
        const int bs = (t == GGML_TYPE_Q4_0) ? 18 : (t == GGML_TYPE_Q6_K ? 210 : 32);
        for (size_t o = 0; o + bs <= nbytes; o += bs) {
            memset(&v[o], 0, bs);
            if (t == GGML_TYPE_Q4_0) {
                ggml_fp16_t h = ggml_fp32_to_fp16(0.05f); memcpy(&v[o], &h, 2);
                int8_t dd = 1; memcpy(&v[o + 16], &dd, 1);
            } else if (t == GGML_TYPE_Q6_K) {
                int8_t ql[128]; memset(ql, 1, sizeof(ql)); memcpy(&v[o + 2], ql, 128);
                int8_t qh[64];  memset(qh, 0, sizeof(qh));  memcpy(&v[o + 130], qh, 64);
                ggml_fp16_t sc = ggml_fp32_to_fp16(0.05f); memcpy(&v[o + 194], &sc, 2);
                ggml_fp16_t m  = ggml_fp32_to_fp16(0.0f);   memcpy(&v[o + 196], &m, 2);
            }
        }
    }
    return v;
}

static ggml_backend_t g_backend = nullptr;
static int           g_reps    = 30;
static const char *  g_only    = nullptr;

// build(ctx, inputs_out) -> output tensor
static void run_case(const std::string & tag,
                     std::function<ggml_tensor *(ggml_context *, std::vector<ggml_tensor *> &)> build) {
    if (g_only && tag.find(g_only) == std::string::npos) return;

    struct ggml_init_params ip = { ggml_tensor_overhead() * 512 + ggml_graph_overhead_custom(2048, false), nullptr, true };
    struct ggml_context * ctx = ggml_init(ip);

    std::vector<ggml_tensor *> ins;
    ggml_tensor * out = build(ctx, ins);

    struct ggml_cgraph * gf = ggml_new_graph_custom(ctx, 2048, false);
    ggml_build_forward_expand(gf, out);

    if (!ggml_backend_supports_op(g_backend, out)) {
        printf("%-62s SKIP (unsupported by %s)\n", tag.c_str(), ggml_backend_name(g_backend));
        fflush(stdout);
        ggml_free(ctx);
        return;
    }

    ggml_gallocr_t galloc = ggml_gallocr_new(ggml_backend_get_default_buffer_type(g_backend));
    if (!ggml_gallocr_alloc_graph(galloc, gf)) {
        printf("%-62s ALLOC FAILED\n", tag.c_str());
        ggml_gallocr_free(galloc);
        ggml_free(ctx);
        return;
    }

    for (size_t k = 0; k < ins.size(); k++) {
        if (!ins[k]) continue;
        auto d = make_data(ins[k]->type, ggml_nbytes(ins[k]), 1234u + (uint32_t) k * 7u);
        ggml_backend_tensor_set(ins[k], d.data(), 0, ggml_nbytes(ins[k]));
    }

    for (int w = 0; w < 3; w++) { ggml_backend_graph_compute(g_backend, gf); }
    ggml_backend_synchronize(g_backend);

    int64_t t0 = ggml_time_us();
    for (int i = 0; i < g_reps; i++) ggml_backend_graph_compute(g_backend, gf);
    ggml_backend_synchronize(g_backend);
    int64_t dt = ggml_time_us() - t0;

    printf("%-62s reps=%3d  %9.3f ms  %9.4f ms/op  %9.1f us/op\n",
           tag.c_str(), g_reps, dt / 1000.0, dt / 1000.0 / g_reps, (double) dt / g_reps);
    fflush(stdout);

    ggml_gallocr_free(galloc);
    ggml_free(ctx);
}

int main(int argc, char ** argv) {
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "-r") g_reps = atoi(argv[++i]);
        else if (a == "-o") g_only = argv[++i];
    }

    ggml_backend_load_all();
    ggml_time_init();
    g_backend = ggml_backend_init_by_type(GGML_BACKEND_DEVICE_TYPE_GPU, nullptr);
    if (!g_backend) { fprintf(stderr, "no GPU backend\n"); return 1; }
    printf("# backend: %s  reps=%d\n", ggml_backend_name(g_backend), g_reps);

    // ---------------- FLOOR: harness/dispatch overhead reference ----------------
    run_case("FLOOR MUL f32[2048x256] x f32[2048x256] (elementwise, measures dispatch floor)",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * a = ggml_new_tensor_2d(c, GGML_TYPE_F32, 2048, 256);
            ggml_tensor * b = ggml_new_tensor_2d(c, GGML_TYPE_F32, 2048, 256);
            in = { a, b };
            return ggml_mul(c, a, b);
        });
    run_case("FLOOR MUL f32[8x8] x f32[8x8] (near-zero work)",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * a = ggml_new_tensor_2d(c, GGML_TYPE_F32, 8, 8);
            ggml_tensor * b = ggml_new_tensor_2d(c, GGML_TYPE_F32, 8, 8);
            in = { a, b };
            return ggml_mul(c, a, b);
        });

    const int N = 256;   // the app's n_ubatch

    // ---------------- MUL_MAT (weight x activations) ----------------
    auto mm = [&](ggml_type wt, int K_in, int K_out, int ntok, const char * label) {
        run_case(std::string("MUL_MAT ") + label,
            [=](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
                ggml_tensor * a = ggml_new_tensor_2d(c, wt, K_in, K_out);
                ggml_tensor * b = ggml_new_tensor_2d(c, GGML_TYPE_F32, K_in, ntok);
                ggml_tensor * o = ggml_mul_mat(c, a, b);
                in = { a, b };
                return o;
            });
    };
    mm(GGML_TYPE_Q4_0, 2048, 10752,  N, "ffn_gate/up  q4_0[2048x10752] x f32[2048,256]");
    mm(GGML_TYPE_Q4_0, 10752, 2048,  N, "ffn_down    q4_0[10752x2048] x f32[10752,256]");
    mm(GGML_TYPE_Q4_0, 2048, 6144,   N, "conv.in_proj q4_0[2048x6144]  x f32[2048,256]");
    mm(GGML_TYPE_Q4_0, 2048, 2048,   N, "sq/o_proj   q4_0[2048x2048]  x f32[2048,256]");
    mm(GGML_TYPE_Q4_0, 2048, 512,    N, "attn_k/v    q4_0[2048x512]   x f32[2048,256]");
    mm(GGML_TYPE_Q6_K, 2048, 128000, 1, "output     q6_K[2048x128000] x f32[2048,1]  (n=1)");
    mm(GGML_TYPE_Q4_0, 2048, 10752,  1, "ffn_gate/up q4_0[2048x10752] x f32[2048,1]   (decode)");
    mm(GGML_TYPE_Q4_0, 10752, 2048,  1, "ffn_down   q4_0[10752x2048] x f32[10752,1]   (decode)");
    mm(GGML_TYPE_Q4_0, 2048, 2048,   1, "sq/o_proj  q4_0[2048x2048]  x f32[2048,1]   (decode)");

    // ---------------- SSM_CONV (short conv, 22 layers) ----------------
    run_case("SSM_CONV  f32[258x2048] k[3x2048]  (n=256 tok + 2 state)",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * kern = ggml_new_tensor_2d(c, GGML_TYPE_F32, 3, 2048);
            ggml_tensor * x    = ggml_new_tensor_2d(c, GGML_TYPE_F32, 256 + 2, 2048);
            in = { kern, x };
            return ggml_ssm_conv(c, x, kern);
        });

    // ---------------- RMS_NORM ----------------
    run_case("RMS_NORM  f32[2048x256]",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * a = ggml_new_tensor_2d(c, GGML_TYPE_F32, 2048, 256);
            in = { a };
            return ggml_rms_norm(c, a, 1e-5f);
        });

    // ---------------- ROPE ----------------
    run_case("ROPE      f32[64x256x32] (32 heads)",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * a = ggml_new_tensor_3d(c, GGML_TYPE_F32, 64, 256, 32);
            ggml_tensor * p = ggml_new_tensor_1d(c, GGML_TYPE_I32, 256);
            in = { a, p };
            return ggml_rope_ext(c, a, p, nullptr, 64, GGML_ROPE_TYPE_NEOX, 8192, 1e7f, 1.0f, 0.0f, 1.0f, 0.0f, 0.0f);
        });

    // ---------------- FLASH_ATTN_EXT: K/V dtype sensitivity ----------------
    auto fa_case = [&](int n_kv, ggml_type kvt, const char * vt) {
        run_case("FLASH_ATTN_EXT n_kv=" + std::to_string(n_kv) + " K=f32 V=" + vt,
            [=](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
                const int hd = 64, nh = 32, nkh = 8;
                ggml_tensor * q = ggml_new_tensor_3d(c, GGML_TYPE_F32, hd, 256, nh);
                ggml_tensor * k = ggml_new_tensor_3d(c, GGML_TYPE_F32, hd, n_kv, nkh);
                ggml_tensor * v = ggml_new_tensor_3d(c, kvt,        hd, n_kv, nkh);
                ggml_tensor * m = ggml_new_tensor_4d(c, GGML_TYPE_F16, n_kv, 256, 1, 1);
                in = { q, k, v, m };
                return ggml_flash_attn_ext(c, q, k, v, m, 0.125f, 0.0f, 0.0f);
            });
    };
    for (int nkv : { 256, 1024, 2048 }) {
        fa_case(nkv, GGML_TYPE_F32,  "f32");
        fa_case(nkv, GGML_TYPE_F16,  "f16");
        fa_case(nkv, GGML_TYPE_Q8_0, "q8_0");
    }

    // ---------------- non-FA attention path (q@k^T, softmax, @v) ----------------
    run_case("MUL_MAT+SOFT_MAX+MUL_MAT non-FA attn n_kv=1024 (q@k^T)",
        [](ggml_context * c, std::vector<ggml_tensor *> & in) -> ggml_tensor * {
            ggml_tensor * q = ggml_new_tensor_3d(c, GGML_TYPE_F32, 1024, 256, 32);
            ggml_tensor * k = ggml_new_tensor_3d(c, GGML_TYPE_F32, 1024, 1024, 8);
            in = { q, k };
            return ggml_mul_mat(c, k, q);
        });

    ggml_backend_free(g_backend);
    return 0;
}