#!/usr/bin/env python3
"""Corrected two-defect model (defectP experiment, PARTNER BIT7 = even-qs byte).

P' (convert write-side): the stored hi-word byte's HIGH nibble is flooded to 0xF
  iff bit7 of the EVEN qs source byte of the same pair (x0) is SET. Root cause:
  `(x0 & 0xF0) >> 4` compiles as a signed (arithmetic) shift on a miscompiling
  backend -> sign-fill floods into the OR result's high nibble.
  Observable: odd qs byte qs[2k+1] high nibble -> 0xF iff bit7(want[2k]) set.
R  (old restore): block-even poison (value-independent), as before.

Fills: lcg(mult), const(val). Validate against six datapoints:
  lcg131  : 65536, per-off 8192, first 39, bit7clear=63488, clean_set=63488
  const40 : 0
  constC0 : 131072 (got 0xF0)
  lcg29   : 57344, bit7clear=15360, clean_set=23552, first 5
  cell7   : 61440 (R alone, HOST_REPACK -> no P)
  cell1a  : 94208 (P u R @ lcg131)
"""
import sys

NB = 16384
BS = 18
QS = 2

def make_fill(kind, arg):
    if kind == 'lcg':
        mult = arg
        return lambda i: ((i*mult + 17) & 0xFF)
    if kind == 'const':
        return lambda i: arg

def want_bytes(fill):
    return [[fill(b*BS + j) for j in range(BS)] for b in range(NB)]

def run_P(want, partner_select):
    """partner_select(b, k) -> trigger for odd byte qs[2k+1] (k=0..7)."""
    events = visible = invisible = 0
    per = {}
    first = None
    mbit7cl = 0      # mismatches with want odd byte bit7 clear
    cbit7set = 0     # clean odd candidates with want bit7 set
    for b in range(NB):
        for k in range(8):
            jodd = QS + 2*k + 1
            ow = want[b][jodd]
            fired = partner_select(b, k)
            is_vis = fired and (ow & 0xF0) != 0xF0
            if fired:
                events += 1
            if is_vis:
                visible += 1
                per[jodd] = per.get(jodd, 0) + 1
                if first is None: first = b*BS + jodd
                if (ow & 0x80) == 0: mbit7cl += 1
            if not is_vis and (ow & 0x80) != 0:
                # clean (including fired-but-invisible) with want bit7 set
                cbit7set += 1
            if fired and (ow & 0xF0) == 0xF0:
                invisible += 1
    return dict(events=events, invisible=invisible, visible=visible,
                per=per, first=first, mbit7cl=mbit7cl, cbit7set=cbit7set)

def run_R(want, sel):
    events = visible = invisible = 0
    per = {}
    first = None
    for b in range(NB):
        for k in range(8):
            jodd = QS + 2*k + 1
            if sel(b):
                events += 1
                if (want[b][jodd] & 0xF0) == 0xF0:
                    invisible += 1
                else:
                    visible += 1
                    per[jodd] = per.get(jodd, 0) + 1
                    if first is None: first = b*BS + jodd
    return dict(events=events, invisible=invisible, visible=visible,
                per=per, first=first)

def show(tag, r, total=NB*8):
    po = sorted(set(r['per'].values())) if r['per'] else [0]
    print(f"{tag:16s} visible={r['visible']:6d} events={r['events']:6d} "
          f"invis={r['invisible']:5d} first={r['first']} per_off={po}")

def main():
    print("=== corrected P : trigger = bit7 of EVEN partner qs[2k] ===")
    for name, (kind, arg) in {
        'lcg131': ('lcg', 131), 'const40': ('const', 0x40),
        'constC0': ('const', 0xC0), 'lcg29': ('lcg', 29),
    }.items():
        w = want_bytes(make_fill(kind, arg))
        trig = lambda b, k, w=w: (w[b][QS+2*k] & 0x80) != 0
        r = run_P(w, trig)
        show(f"P {name}", r)
        total = NB*8
        deficit = total - (r['mbit7cl'] + r['cbit7set'])
        print(f"    bit7cross: mbit7clear={r['mbit7cl']:6d} clean_set={r['cbit7set']:6d} "
              f"sum={r['mbit7cl']+r['cbit7set']:6d} deficit={deficit:6d}  "
              f"(mbit7set = {r['visible']-r['mbit7cl']})")
    print()
    print("=== R (old restore, block-even) ===")
    w = want_bytes(make_fill('lcg', 131))
    rR = run_R(w, lambda b: b % 2 == 0)
    show("R lcg131", rR)
    print()
    print("=== P u R @ lcg131 (cell1a) ===")
    w = want_bytes(make_fill('lcg', 131))
    trig = lambda b, k, w=w: ((w[b][QS+2*k] & 0x80) != 0) or (b % 2 == 0)
    r = run_P(w, trig)
    show("P u R", r)

if __name__ == '__main__':
    main()
