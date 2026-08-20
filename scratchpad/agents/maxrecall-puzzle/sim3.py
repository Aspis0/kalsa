#!/usr/bin/env python3
"""Unified two-defect model.
Producer (convert) defect  P: odd-qs pos poisoned iff want value < 0x80 (bit7=0)
Restore (old) defect      R: odd-qs pos poisoned iff block index even
Predict: cell2b = P (fixed restore) 65536/8192/first39
         cell7  = R (hostrepack, old restore) 61440/7680/first3
         cell1a = P u R (both broken) 94208/11776/first3
         hostrepack+fixed = 0
Verify union arithmetic and produce full aggregate set.
"""
NB=16384; BS=18; QS=2
def val(b,qj): return ((b*BS+QS+qj)*131+17)&0xFF
def P(b,qj): return val(b,qj) < 0x80
def R(b,qj): return b%2==0

def run(sel, label):
    events=invisible=visible=0; per={}; first=None
    for b in range(NB):
        for qj in range(1,16,2):
            j=QS+qj
            if sel(b,qj):
                v=val(b,qj)
                events+=1
                if (v&0xF0)==0xF0: invisible+=1
                else:
                    visible+=1; per[j]=per.get(j,0)+1
                    if first is None: first=b*BS+j
    print(f"{label:12s} events={events:6d} invisible={invisible:5d} visible={visible:6d} "
          f"first={first} per_off={sorted(set(per.values()))}")
    return events,invisible,visible

def union(A,B):
    return lambda b,qj: A(b,qj) or B(b,qj)

print("== unified model ==")
run(P, "P want<0x80")
run(R, "R block-even")
run(union(P,R), "P u R")
run(lambda b,qj: False, "none")

print()
print("expected: cell2b=65536/8192(full, all)=8192 per-off first=39")
print("          cell7 =61440/7680/7680 first=3")
print("          cell1a=94208/11776/11776 first=3")
