// scratch probe (not committed): where does the 5-stage word-granule vshuff network put (row, column)?
#include "raw-reader-sim-env.h"

#define NROWS 32

int main(void) {
    static uint32_t in[NROWS][32] __attribute__((aligned(128)));
    static uint32_t out[NROWS][32] __attribute__((aligned(128)));
    for (int n = 0; n < NROWS; n++) {
        for (int c = 0; c < 32; c++) { in[n][c] = (uint32_t) (n * 1000 + c); }
    }
    HVX_Vector v[NROWS];
    for (int n = 0; n < NROWS; n++) { v[n] = hvx_vmem(in[n]); }
    for (int stage = 0; stage < 5; stage++) {
        const int b = 16 >> stage;
        for (int i = 0; i < NROWS; i++) {
            if (i & b) { continue; }
            HVX_VectorPair p = Q6_W_vshuff_VVR(v[i + b], v[i], -4);
            v[i]     = Q6_V_lo_W(p);
            v[i + b] = Q6_V_hi_W(p);
        }
    }
    for (int u = 0; u < NROWS; u++) { hvx_vmem(out[u]) = v[u]; }
    int bad = 0;
    for (int u = 0; u < NROWS; u++) {
        for (int l = 0; l < 32; l++) {
            const uint32_t want = (uint32_t) (l * 1000 + u);   // lane = row, vector = column
            if (out[u][l] != want) { bad++; if (bad < 6) { printf("v[%d] lane %d = row %lu col %lu\n", u, l, (unsigned long) (out[u][l] / 1000), (unsigned long) (out[u][l] % 1000)); } }
        }
    }
    printf("mismatches %d\n", bad);
    return 0;
}
