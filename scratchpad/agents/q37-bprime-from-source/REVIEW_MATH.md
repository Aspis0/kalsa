# REVIEW_MATH — q37 REPORT numeric claims

Script: `_math_check.py` → `_math_check.txt`. Inputs = `verify/*/verify_variants.txt` integers.

| claim | computed | verdict |
|---|---|---|
| Marco Q8_0 +124 403 712 / +1.948 % | 6509642624−6385238912=124403712; 100×124403712/6385238912=1.948 % | **CONFIRMED** |
| Marco IQ4_NL/Q4_0 −41 467 904 / −0.649 % | 6343771008−6385238912=−41467904; −0.649 %; iq==q4 | **CONFIRMED** |
| Marco trunk share 3.57 % | 100×228073472/6385238912=3.57 % | **CONFIRMED** |
| Marco control vs shipped +64 B | 6385238912−6385238848=64 | **CONFIRMED** |
| Marco Q8/IQ vs q36 files +64 B | 6509642624−6509642560=64; 6343771008−6343770944=64 | **CONFIRMED** |
| OLMoE Q8_0 +177 930 240 / +6.667 % | 2846872032−2668941792=177930240; 6.667 % | **CONFIRMED** |
| OLMoE IQ4_NL −59 310 080 / −2.222 % | 2609631712−2668941792=−59310080; −2.222 %; iq==q4 | **CONFIRMED** |
| OLMoE trunk share 12.22 % | 100×326205440/2668941792=12.22 % | **CONFIRMED** |
| LFM Q8_0 +254 246 912 / +7.644 % | 3580407296−3326160384=254246912; 7.644 % | **CONFIRMED** |
| LFM IQ4_NL −103 317 504 / −3.106 % | 3222842880−3326160384=−103317504; −3.106 %; iq==q4 | **CONFIRMED** |
| LFM trunk share 15.20 % | 100×505577472/3326160384=15.20 % | **CONFIRMED** |
| LFM control == shipped KEXP bytes | 3326160384−3326160384=0 | **CONFIRMED** |
| Cleanup Marco 35.05 GB | 37635187296/(1024**3)=35.049 | **CONFIRMED** (report rounds 35.05) |
| Cleanup OLMoE 14.37 GB | 15426078592/(1024**3)=14.366 | **CONFIRMED** |
| Cleanup LFM 17.73 GB | 19036288736/(1024**3)=17.726 | **CONFIRMED** |
| Disk nadir ≥ 40 GB | DISK_LOG min 129236271104 B = 120.36 GB | **CONFIRMED** |
| Marco expert sha = q36 shipped | `d84c4b43…c74d` both | **CONFIRMED** (string match vs q36 REPORT) |

**0 REFUTED.** "228 MB" in the rec line is 228073472 decimal MB (228.07×10^6), same convention as q36, not 217.51 MiB. Do not mix.

UNTRACEABLE: none of the live `Get-PSDrive` figures used as evidence except rows in `DISK_LOG.md`.
