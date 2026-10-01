// scratch (not committed): the df538c50c dot (renamed copy of its headers) against the paired and the
// per-row dot of this tree, on the same raw rows and the same arranged activations: bits must agree.
#include "raw-mv-fixture.h"
#include "old-q4_0-raw-mv-hvx.h"

int main(void) {
    setbuf(stdout, NULL);
    static const int shapes[] = { 8, 9, 13, 63, 64, 65, 71, 336 }, rows[] = { 32, 31, 17, 5, 1 };
    int failed = 0, cases = 0;
    for (size_t a = 0; a < sizeof(shapes) / sizeof(shapes[0]); a++) {
        for (size_t b = 0; b < sizeof(rows) / sizeof(rows[0]); b++) {
            for (int mode = 0; mode < 3; mode++) {   // random, d=1, edge
                const int n_k = shapes[a], n_rows = rows[b], k = n_k * 32, n_win = (int) raw_mv_n_windows(n_k);
                uint8_t * raw = aligned_alloc(128, ((size_t) 32 * n_k * 18 + 127) & ~127UL);
                float * x = aligned_alloc(128, (size_t) (k + 127) / 128 * 128 * sizeof(float));
                uint8_t * act = aligned_alloc(128, htp_mm_raw_mv_act_bytes(n_k));
                float * tmp = aligned_alloc(128, QK_Q8_0_TILED * sizeof(float));
                float o_old[32] __attribute__((aligned(128))), o_new[32] __attribute__((aligned(128))), o_row[32] __attribute__((aligned(128)));
                fixture_raw(raw, n_rows, n_k, mode);
                fixture_act(x, k, mode);
                q4_0_raw_act_windows(act, x, tmp, k, 0, n_win);
                q4_0_old_raw_mv_32x1(k, o_old, raw, act, n_rows, NULL);
                q4_0_raw_mv_32x1(k, o_new, raw, act, n_rows, NULL);
                q4_0_raw_mv_32x1_per_row(k, o_row, raw, act, n_rows, NULL);
                const int bad = memcmp(o_old, o_new, n_rows * sizeof(float)) || memcmp(o_old, o_row, n_rows * sizeof(float));
                failed |= bad;
                cases++;
                if (bad) { printf("FAIL n_k %d rows %d mode %d\n", n_k, n_rows, mode); }
                free(raw); free(x); free(act); free(tmp);
            }
        }
    }
    printf("%d cases, df538c50c dot vs paired vs per-row: %s\n", cases, failed ? "DIFFER" : "bit-identical");
    return failed;
}
