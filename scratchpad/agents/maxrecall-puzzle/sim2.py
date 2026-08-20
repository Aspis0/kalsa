#!/usr/bin/env python3
"""Correlation analysis: is the want<0x80 trigger a clean positional rule?"""
from collections import Counter, defaultdict

NB=16384; BS=18; QS=2
def val(b,qj): return ((b*BS+QS+qj)*131+17)&0xFF

# 1) by block parity / mod
for m in (2,4,8,16):
    cnt=Counter()
    for b in range(NB):
        for qj in range(1,16,2):
            k=b%m
            cnt[(k, val(b,qj)<0x80)] += 1
    print(f"b%{m}: (residue, <0x80) counts:", dict(sorted(cnt.items())))

print()
# 2) by qj only
qjcnt=Counter()
for b in range(NB):
    for qj in range(1,16,2):
        qjcnt[(qj, val(b,qj)<0x80)] += 1
print("by qj:", dict(sorted(qjcnt.items())))

print()
# 3) are all 8 odd positions of a given block under the SAME <0x80 status? (block-discrete?)
blockstat=Counter()
for b in range(NB):
    s=[val(b,qj)<0x80 for qj in range(1,16,2)]
    blockstat[sum(s)]+=1
print("blocks by #poisonable-positions (<0x80 among 8 odd qs):", dict(sorted(blockstat.items())))

print()
# 4) correlation w/ (b mod 256) block-start offset d=18b mod 256
#    and with value of block's d-byte = want[b][0] (fp16 scale low byte)
import math
res=defaultdict(Counter)
for b in range(NB):
    d0=(b*BS+0)*131+17 & 0xFF
    n=sum(1 for qj in range(1,16,2) if val(b,qj)<0x80)
    res[d0][n]+=1
print("block first-byte value -> #poisoned (0..8) histogram head:")
for dv in sorted(res)[:6]:
    print(f"  dbyte={dv:02x}: {dict(res[dv])}")

print()
# 5) exact match test: does want<0x80 equal any simple positional rule?
rules={
 'b even': lambda b,qj: b%2==0,
 'b odd': lambda b,qj: b%2==1,
 'b%4==0': lambda b,qj: b%4==0,
 'b%4==1': lambda b,qj: b%4==1,
 'b%4==2': lambda b,qj: b%4==2,
 'b%4==3': lambda b,qj: b%4==3,
 'b%2 and qj<=9': lambda b,qj: b%2==0 and QS+qj<=9,
 'qj in {1,3,5}': lambda b,qj: qj in (1,3,5),
 'low nib of i': lambda b,qj: (b*BS+QS+qj)%16 < 8,
 'byte pos (i%256) <128': lambda b,qj: (b*BS+QS+qj)%256 < 128,
}
for name,r in rules.items():
    same = all((val(b,qj)<0x80)==r(b,qj) for b in range(NB) for qj in range(1,16,2))
    print(f"exact==want<0x80? {name}: {same}")
