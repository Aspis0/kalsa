// Column dot of the raw-row matvec: the same raw Q4_0 rows and arranged activations as
// q4_0-raw-mv-hvx.h, but the 32 rows of a group are transposed in registers first, so a vector holds
// one 4-byte word of the 7-block window of ALL rows (lane = row) instead of one row's window.
//
// Why: in the per-lane dot every lane carries 4 bytes of one block, so each row-window pays its
// block-scale and float work (a vdelta, a half x half multiply, two conversions, a multiply, an add)
// for ~7 blocks. Here a block's 32 weights sit in 4 or 5 columns whose lanes are all one row, so the
// integer sum of a block ends up in ONE lane and the float work is paid once per block per 32 rows,
// as in the tiled dot (the tiled dot's 32x32 tiles are what the old conversion built, at ~105
// pcycles per tile; the transpose here is the 80 vshuff of that conversion and nothing else).
//   1. 32 unaligned loads (row r's window at its byte phase) and five word-granule vshuff stages
//      (q4_0-raw-window.h): col[u] = word u of the window, lane = row;
//   2. per block j, the integer sum of (q - 8) * x over its columns: the nibble planes of col[u]
//      against the scalar words xlo[u], xhi[u] of the arranged window (q4_0-raw-mv-act.h), starting
//      from the block's -8 * sum(x) offset; the zeros under the scale bytes make them vanish;
//   3. the block's scale: the column holding it carries the fp16 scale in its low (even block) or high
//      (odd block) halfword; one half x half multiply by the activation scale gives it per row;
//   4. acc += float(sum) * scale, in qf32, one block after the other.
// The integer sums are exact. The float tail rounds per block and row, so the result differs from the
// per-lane dot (which rounds per lane and reduces lanes at the end) in the last bits.
//
// Needs the includes of q4_0-raw-mv-act.h.
#ifndef Q4_0_RAW_COLS_HVX_H
#define Q4_0_RAW_COLS_HVX_H

#include "q4_0-raw-mv-act.h"
#include "q4_0-raw-window.h"

// 32 rows of raw Q4_0 (packed, n / 32 blocks apiece, n >= HTP_MM_RAW_MV_MIN_K) against the arranged
// activations: writes the first valid_rows dot products to s. Same signature as q4_0_raw_mv_32x1
// (sz is not used).
static void q4_0_raw_cols_32x1(const uint32_t n, float * restrict s, const void * restrict vx, const void * restrict vy,
                               uint32_t valid_rows, const float * restrict sz) {
    (void) sz;
    const uint32_t n_k = n / 32;
    const uint32_t n_win = raw_mv_n_windows(n_k);
    const size_t row_bytes = (size_t) n_k * sizeof(block_q4_0);
    const HVX_Vector mask_lo = Q6_Vb_vsplat_R(0x0F);
    HVX_Vector acc = Q6_V_vzero();

    for (uint32_t w = 0; w < n_win; w++) {
        const uint32_t start = raw_mv_window_start(w, n_k);
        const uint32_t skip = RAW_MV_WINDOW_BLOCKS * w - start;   // blocks of the window before's last that this one repeats
        const size_t off = (size_t) start * sizeof(block_q4_0);

        HVX_Vector col[RAW_READER_ROWS];
        #pragma clang loop unroll(full)
        for (uint32_t r = 0; r < RAW_READER_ROWS; r++) {
            // rows past the group's last are duplicates of it: transposed and dropped, never read past the payload
            const uint8_t * row = (const uint8_t *) vx + MIN(r, valid_rows - 1) * row_bytes;
            col[r] = w + 1 == n_win ? raw_mv_load_last(row + row_bytes, r + 1 >= valid_rows) : hvx_vmemu(row + off);
        }
#ifndef COLS_NO_TRANSPOSE
        raw_reader_transpose_granule(col, RAW_READER_SHUFF_WORD);
#endif
#ifdef COLS_NO_DOT
        acc = Q6_Vqf32_vadd_Vqf32Vqf32(acc, col[(w * 7) & 31]); continue;
#endif

        const uint8_t * win = (const uint8_t *) vy + (size_t) w * RAW_MV_ACT_WINDOW_BYTES;
        const int32_t * xlo = (const int32_t *) win;
        const int32_t * xhi = (const int32_t *) (win + VLEN);
        const struct raw_mv_blocks * blocks = (const struct raw_mv_blocks *) (win + 4 * VLEN);

        #pragma clang loop unroll(full)
        for (uint32_t j = 0; j < RAW_MV_WINDOW_BLOCKS; j++) {
            if (j < skip) { continue; }
            HVX_Vector sum = Q6_V_vsplat_R(blocks->corr[j]);
            #pragma clang loop unroll(full)
            for (uint32_t c = 0; c < raw_mv_block_cols[j]; c++) {
                const uint32_t u = raw_mv_block_first[j] + c;
                sum = Q6_Vw_vrmpyacc_VwVubRb(sum, Q6_V_vand_VV(col[u], mask_lo), xlo[u]);
                sum = Q6_Vw_vrmpyacc_VwVubRb(sum, Q6_Vub_vlsr_VubR(col[u], 4), xhi[u]);
            }
            const HVX_VectorPair scales = Q6_Wqf32_vmpy_VhfVhf(col[raw_mv_block_first[j] - (j & 1)], Q6_V_vsplat_R(blocks->ascale[j]));
            const HVX_Vector scale = Q6_Vsf_equals_Vqf32((j & 1) ? Q6_V_hi_W(scales) : Q6_V_lo_W(scales));
            acc = Q6_Vqf32_vadd_Vqf32Vqf32(acc, Q6_Vqf32_vmpy_VsfVsf(Q6_Vsf_equals_Vw(sum), scale));
        }
    }
    hvx_vec_store_u(s, valid_rows * sizeof(float), Q6_Vsf_equals_Vqf32(acc));
}

#endif // Q4_0_RAW_COLS_HVX_H
