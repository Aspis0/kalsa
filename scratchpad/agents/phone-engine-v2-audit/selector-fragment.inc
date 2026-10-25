// KALSA_Q6K_DENSE=f32|dp4a: dense q6_K prefill GEMM path, default dp4a.
// f32 = transpose + noshuffle f32 GEMM (no activation quantization);
// dp4a = stock int8 path (kernel_quant_a_q8_1 + q8_1 dp4a GEMM), for A/B.
inline bool kalsa_q6k_dense_f32() {
    static const bool value = [] {
        const char * e = getenv("KALSA_Q6K_DENSE");
        if (e && strcmp(e, "f32") == 0) {
            return true;
        }
        if (e && *e && strcmp(e, "dp4a") != 0) {
            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_Q6K_DENSE='%s' (use f32|dp4a)\n", e);
            exit(1);
        }
        return false;
    }();
    return value;
}

// KALSA_Q8A_SCALE=fp32|fp16: dense q6_K q8_1 activation block scale type, default fp32.
// fp32 = float scale end to end (the fp16 store flushes subnormals to zero on this
// device); fp16 = stock half scale, for A/B in the same binary.
inline bool kalsa_q8a_scale_f32() {
    static const bool value = [] {
        const char * e = getenv("KALSA_Q8A_SCALE");
        if (e && strcmp(e, "fp16") == 0) {
            return false;
        }
        if (e && *e && strcmp(e, "fp32") != 0) {
            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_Q8A_SCALE='%s' (use fp32|fp16)\n", e);
            exit(1);
        }
        return true;
    }();
    return value;
}
