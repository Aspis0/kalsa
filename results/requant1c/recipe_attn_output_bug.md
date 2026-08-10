# Recipe bug (2026-08-10)

--tensor-type-file uses std::regex_search (substring). First match wins.

Line 1 was `output.weight=q4_k` which matches `blk.N.attn_output.weight` as substring
(…attn_OUTPUT.WEIGHT). Result: 10 attn_output tensors became Q4_K instead of recipe Q5_K.

Fix: `^output\.weight$=q4_k` (anchored exact name).

First quantize produced KEXP 13405944832 B, experts OK (120/0 Q2_K/Q3_K), dense 603 ok / 10 bad.
Re-quantize after fix.
