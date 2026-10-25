// audit harness: compiles the two KALSA env selectors exactly as extracted
// from ggml-opencl.cpp lines 1548-1582 of the audited tip; prints both arms
#include <cstdio>
#include <cstdlib>
#include <cstring>
#define GGML_LOG_ERROR(...) fprintf(stderr, __VA_ARGS__)
#include "selector-fragment.inc"

int main() {
    printf("q6k_dense_f32=%d q8a_scale_f32=%d\n", kalsa_q6k_dense_f32() ? 1 : 0, kalsa_q8a_scale_f32() ? 1 : 0);
    return 0;
}
