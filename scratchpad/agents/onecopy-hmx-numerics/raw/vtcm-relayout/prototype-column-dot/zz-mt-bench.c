// scratch (not committed): the dots run on several hardware threads at once under hexagon-sim, to see
// whether shared vector units (which one thread alone cannot show) change their relative cost.
//   zz-mt-bench <impl 0 tiled | 1 per-lane | 4 column> <n_k> <reps> <threads>
#include <hexagon_standalone.h>

#include "raw-mv-fixture.h"
#include "q4_0-raw-cols-hvx.h"

#define MAX_THREADS 6
#define STACK_BYTES (64 * 1024)

struct job {
    uint8_t * raw, * tiles, * y, * act;
    int impl, k, reps;
    float out[32] __attribute__((aligned(128)));
};

static void worker(void * p) {
    struct job * j = p;
    for (int r = 0; r < j->reps; r++) {
        if (j->impl == 0) {
            tiled_vec_dot_q4_0_32x1(j->k, j->out, j->tiles, j->y, 32, NULL);
        } else if (j->impl == 1) {
            q4_0_raw_mv_32x1(j->k, j->out, j->raw, j->act, 32, NULL);
        } else {
            q4_0_raw_cols_32x1(j->k, j->out, j->raw, j->act, 32, NULL);
        }
    }
}

static void thread_main(void * p) {
    SIM_ACQUIRE_HVX;
    worker(p);
    SIM_RELEASE_HVX;
}

int main(int argc, char ** argv) {
    setbuf(stdout, NULL);
    if (argc != 5) { printf("usage\n"); return 2; }
    const int impl = atoi(argv[1]), n_k = atoi(argv[2]), reps = atoi(argv[3]), nth = atoi(argv[4]);
    const int k = n_k * 32, n_win = (int) raw_mv_n_windows(n_k);
    static struct job jobs[MAX_THREADS];
    float * x = aligned_alloc(128, (size_t) (k + 127) / 128 * 128 * sizeof(float));
    float * tmp = aligned_alloc(128, QK_Q8_0_TILED * sizeof(float));
    fixture_act(x, k, 0);
    for (int t = 0; t < nth; t++) {
        struct job * j = &jobs[t];
        j->impl = impl; j->k = k; j->reps = reps;
        j->raw   = aligned_alloc(128, ((size_t) 32 * n_k * 18 + 127) & ~127UL);
        j->tiles = aligned_alloc(128, (size_t) n_k * TILE_STRIDE);
        j->y     = aligned_alloc(128, (size_t) ((k + 127) / 128) * 4 * TILED_KT_BYTES);
        j->act   = aligned_alloc(128, htp_mm_raw_mv_act_bytes(n_k));
        fixture_raw(j->raw, 32, n_k, 0);
        quantize_row_f32_q8_0_tiled(x, j->y, k);
        q4_0_raw_rows_to_tiles(j->tiles, TILE_STRIDE, (const block_q4_0 *) j->raw, n_k, 32);
        q4_0_raw_act_windows(j->act, x, tmp, k, 0, n_win);
    }
    int mask = 0;
    for (int t = 1; t < nth; t++) {
        uint8_t * stack = aligned_alloc(128, STACK_BYTES);
        thread_create(thread_main, stack + STACK_BYTES - 128, t, &jobs[t]);
        mask |= 1 << t;
    }
    worker(&jobs[0]);
    if (mask) { thread_join(mask); }
    float sum = 0;
    for (int t = 0; t < nth; t++) { for (int i = 0; i < 32; i++) { sum += jobs[t].out[i]; } }
    printf("MT impl %d n_k %d reps %d threads %d sum %f\n", impl, n_k, reps, nth, (double) sum);
    return 0;
}
