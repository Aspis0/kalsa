#!/usr/bin/env python3
"""Byte-exact model of the trans4_q4_0 round-trip (harness data = fill_pattern).

Harness: tests/test-opencl-moe-roundtrip.cpp
  want[i] = (uint8_t)((i*131 + 17) & 0xFF)      # deterministic LCG, period 256
  q4_0 "as" ne=256x512x4 -> nbytes=294912 = 16384 blocks * 18B
  block layout {18, 2, 16} : qs at offsets 2..17 (16 bytes), d at 0..1
  odd-qs candidate = qj odd  -> 8 per block -> 131072 total

Contract (cvt.cl kernel_convert_block_q4_0_trans4_ns):
  word0/word1 (lo) bytes j: lo[j]   = (qs[2i]&0x0F) | ((qs[2i+1]&0x0F)<<4)
  word2/word3 (hi) bytes j: hi[j]   = ((qs[2i]&0xF0)>>4) | (qs[2i+1]&0xF0)
Fixed restore (kernel_restore_block_q4_0_trans4_ns) is the exact inverse.

A defect ABN is modeled at the observable level: chosen odd-qs positions have
their HIGH NIBBLE forced to 0xF (got = (want&0x0F)|0xF0). Variants:
  - 'producer' (fixed restore): the stored hi-word byte high nibble was F; the
    fixed restore faithfully passes it through to qs[2i+1] high nibble.
  - 'restore' (old broken restore): the restore itself forces qs[2i+1] hi=0xF.
Both have identical byte-level observable: odd qs high nibble -> F.
"""

WANT_TARGET = {
    'cell2b_fixed_producer': dict(visible=65536, per_off=8192,  first=39, blk01='clean'),
    'cell7_broken_restore':  dict(visible=61440, per_off=7680,  first=3,  blk01='block0_poisoned'),
    'cell1a_both':           dict(visible=94208, per_off=11776, first=3,  blk01='block0_poisoned'),
}

NB_BLOCK = 16384
BS = 18
QS_OFF = 2

def want_block(nb=NB_BLOCK):
    """want[b][j] for b in 0..nb-1, j in 0..17"""
    return [[(( (b*BS + j) * 131 + 17) & 0xFF) for j in range(BS)] for b in range(nb)]

def odd_qs_positions(nb=NB_BLOCK):
    """list of (b, j) with j in qs region and (j-QS_OFF) odd"""
    out = []
    for b in range(nb):
        for qj in range(1, 16, 2):          # odd qj
            out.append((b, QS_OFF + qj))
    return out

def poison(want, sel, verbose=False):
    """apply 'high nibble -> 0xF' to odd-qs positions selected by sel(block b, qj).
       sel returns True to poison. Returns (visible, events, invisible, first, per_off)"""
    nb = len(want)
    per_off = {}
    events = invisible = visible = 0
    first = None
    for b in range(nb):
        for qj in range(1, 16, 2):
            j = QS_OFF + qj
            if sel(b, qj):
                events += 1
                v = want[b][j]
                if (v & 0xF0) == 0xF0:
                    invisible += 1
                else:
                    visible += 1
                    per_off[j] = per_off.get(j, 0) + 1
                    if first is None:
                        first = b*BS + j
    return dict(visible=visible, events=events, invisible=invisible, first=first,
                per_off=per_off)

def dump_block(want, poisoned, b):
    """want and got hex for block b (18 bytes) as printed by harness"""
    w = want[b]
    g = [w[j] if not (QS_OFF <= j < QS_OFF+16 and (j-QS_OFF) & 1 and poisoned(b, j)) else w[j] for j in range(BS)]
    return w, g

# ----------------------------------------------------------------------------
# candidates
# ----------------------------------------------------------------------------
def cand_block_parity(mod, kset):
    return lambda b, qj: b % mod in kset

def cand_value_lt(vmax):
    return lambda b, qj: ((b*BS + QS_OFF + qj) * 131 + 17) & 0xFF < vmax

def cand_value_bit(bit):
    return lambda b, qj: (((b*BS + QS_OFF + qj) * 131 + 17) & 0xFF) & (1 << bit) != 0

def cand_index_half():
    return lambda b, qj: b < NB_BLOCK//2

def cand_posn_mod(m, kset):
    return lambda b, qj: ((b*BS + QS_OFF + qj) % m) in kset

def cand_low_nib(half_range):
    # poison if value's LOW nibble in the given set (data correlated)
    return lambda b, qj: ((((b*BS + QS_OFF + qj) * 131 + 17) & 0xFF) & 0x0F) in half_range

def cand_hi_nib(halset):
    return lambda b, qj: ((((b*BS + QS_OFF + qj) * 131 + 17) & 0xFF) >> 4) in halset

def main():
    want = want_block()
    # sanity: odd-want-hi-F count should be 8192
    fcount = sum(1 for b in range(NB_BLOCK) for qj in range(1,16,2)
                 if (want[b][QS_OFF+qj] & 0xF0) == 0xF0)
    print("odd_want_hi_f (expect 8192):", fcount)
    # sanity: value histogram over odd-qs positions
    from collections import Counter
    hist = Counter(want[b][QS_OFF+qj] for b in range(NB_BLOCK) for qj in range(1,16,2))
    even_vals = sorted(v for v in hist)
    print("distinct values:", len(hist), "all even:", all(v % 2 == 0 for v in even_vals))
    print("counter spread:", all(c == 1024 for c in hist.values()))

    print("\n=== candidate poison selectors (fixed restore, i.e. producer defect) ===")
    print("target cell2b: visible=65536 per_off=8192 first=39 blk0,1 clean")
    names = {
        'value<0x80':       cand_value_lt(0x80),
        'value>=0x80':      lambda b,qj: cand_value_lt(0x80)(b,qj) ^ True,
        'value bit7':       cand_value_bit(7),
        'value bit6':       cand_value_bit(6),
        'value bit3':       cand_value_bit(3),
        'value bit0':       cand_value_bit(0),
        'block b odd':      cand_block_parity(2, {1}),
        'block b even':     cand_block_parity(2, {0}),
        'b%4 in {2,3}':     cand_block_parity(4, {2,3}),
        'b%4 in {0,1}':     cand_block_parity(4, {0,1}),
        'b%8 in {2,3,4,5}': cand_block_parity(8, {2,3,4,5}),
        'b<8192':           cand_index_half(),
        'low nib <8':       cand_low_nib(set(range(8))),
        'low nib even':     cand_low_nib({0,2,4,6,8,10,12,14}),
        'hi nib <8':        cand_hi_nib(set(range(8))),
        'posn%2 odd':       cand_posn_mod(2, {1}),
    }
    for name, fn in names.items():
        r = poison(want, fn)
        po = r['per_off']
        print(f"{name:22s} events={r['events']:6d} invisible={r['invisible']:5d} "
              f"visible={r['visible']:6d} first={r['first']} per_off_ok={sorted(set(po.values()))}")

if __name__ == '__main__':
    main()
