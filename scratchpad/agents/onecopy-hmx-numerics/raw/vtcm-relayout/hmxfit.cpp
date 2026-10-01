// scratch: does a raw-Q4_0 HMX matmul whose chunks were solved for pipeline=false still fit once the DSP forces pipeline=true?
#include <initializer_list>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "matmul-ops.h"

int main() {
    const int wtype = HTP_TYPE_Q4_0;
    const int ks[] = {2048, 10752};
    const int ns[] = {512, 2048, 6144, 10752};
    for (int n_threads : {4, 6}) {
        for (size_t budget : {(size_t) 8388608, (size_t) 7340032}) {
            for (int m : {32, 33, 64, 512}) {
                for (int k : ks) {
                    for (int n : ns) {
                        if (k == 10752 && n != 2048) continue;
                        if (k == 2048 && n == 2048 && false) continue;
                        const bool pipe_host = htp_mm_hmx_pipeline(m);
                        size_t mc = 0, nc = 0, vt = 0; int act_threads = 0;
                        const uint32_t at = htp_mm_get_weight_aligned_tile_size(wtype);
                        const bool ok = htp_mm_hmx_solve_2d_params(wtype, k, 0, n, m, m, n_threads, pipe_host, false, at, budget, &mc, &nc, &act_threads, &vt);
                        if (!ok) { printf("thr %d budget %zu m %3d k %5d n %5d: solver FAILED\n", n_threads, budget, m, k, n); continue; }
                        struct htp_mm_hmx_vtcm_layout L;
                        htp_mm_hmx_vtcm_layout_build(&L, HTP_MM_KERNEL_HMX_2D, wtype, k, mc, nc, 1, false, true, act_threads, at);
                        printf("thr %d budget %zu m %3d k %5d n %5d: host pipeline %d mc %4zu nc %5zu vtcm %8zu | forced pipeline vtcm %8zu %s\n",
                               n_threads, budget, m, k, n, (int) pipe_host, mc, nc, vt, (size_t) L.total_bytes, L.total_bytes > budget ? "OVERFLOW" : "fits");
                    }
                }
            }
        }
    }
    return 0;
}
