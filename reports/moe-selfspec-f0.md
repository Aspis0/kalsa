# moe-selfspec-f0

**Mandate:** `mandates/selfspec-f0-acceptance.md`
**Method:** `results/selfspec_f0/METHOD_PLAN.md` (EXACT-RESTART, WINDOWED-W16 fallback)
**Host:** PC only. No phones.
**STATUS:** see `results/selfspec_f0/STATUS.txt`
**VERDICT:** `PASS_LANE_OPEN`

## Gate

Primary: pooled teacher-forced token acceptance k=2 drop 0.65 >= 0.60 (`mandates/selfspec-f0-acceptance.md:29-30`).
Measured primary alpha = 0.6991321118611379 over n=1037 eligible positions.
MTP-style accept_rate at gamma=4 (empirical) = 0.49299855142443266.

## Assets

- binary: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc\cli\bmoe-cli.exe` sha256=42cd907c38fb223d1b04c7070a0c9a6e3b200e186afc19439189651dcac74f69
- model: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf` size=13416430592 published_sha=ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a (quality/ppl_baseline.json:111)
- threads: -t 8 (PC idle; METHOD_PLAN.md used -t 4 only while LFM held -t 8)
- flags: `-t 8 -c 4096 --ubatch 512 --temp 0 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --progress --session`

## Pooled acceptance

```json
{
  "k2_d0": {
    "n_positions": 1037,
    "n_accepted": 716,
    "alpha": 0.6904532304725168,
    "methods": [
      "EXACT-RESTART"
    ],
    "vs_position": [
      {
        "lo": 0,
        "hi": 49,
        "n": 200,
        "accepted": 131,
        "rate": 0.655
      },
      {
        "lo": 50,
        "hi": 99,
        "n": 200,
        "accepted": 124,
        "rate": 0.62
      },
      {
        "lo": 100,
        "hi": 149,
        "n": 200,
        "accepted": 125,
        "rate": 0.625
      },
      {
        "lo": 150,
        "hi": 199,
        "n": 200,
        "accepted": 141,
        "rate": 0.705
      },
      {
        "lo": 200,
        "hi": 249,
        "n": 137,
        "accepted": 111,
        "rate": 0.8102189781021898
      },
      {
        "lo": 250,
        "hi": 299,
        "n": 100,
        "accepted": 84,
        "rate": 0.84
      }
    ],
    "gamma": {
      "2": {
        "gamma": 2,
        "n_starts": 1037,
        "n_full_starts": 1036,
        "n_drafted": 2073,
        "n_accepted": 1229,
        "accept_rate": 0.5928605885190545,
        "full_window_rate": 0.4951737451737452,
        "mean_accepted_prefix": 1.185149469623915,
        "mean_accepted_prefix_fullstarts": 1.1853281853281854,
        "e_tokens_per_step_independence": 2.1671788939424514,
        "mtp_style_rate_independence": 0.5835894469712257
      },
      "3": {
        "gamma": 3,
        "n_starts": 1037,
        "n_full_starts": 1035,
        "n_drafted": 3108,
        "n_accepted": 1620,
        "accept_rate": 0.5212355212355212,
        "full_window_rate": 0.37777777777777777,
        "mean_accepted_prefix": 1.562198649951784,
        "mean_accepted_prefix_fullstarts": 1.5642512077294686,
        "e_tokens_per_step_independence": 2.4963356683344213,
        "mtp_style_rate_independence": 0.49877855611147387
      },
      "4": {
        "gamma": 4,
        "n_starts": 1037,
        "n_full_starts": 1034,
        "n_drafted": 4142,
        "n_accepted": 1929,
        "accept_rate": 0.4657170449058426,
        "full_window_rate": 0.2988394584139265,
        "mean_accepted_prefix": 1.8601735776277724,
        "mean_accepted_prefix_fullstarts": 1.8636363636363635,
        "e_tokens_per_step_independence": 2.7236030265452706,
        "mtp_style_rate_independence": 0.4309007566363176
      },
      "5": {
        "gamma": 5,
        "n_starts": 1037,
        "n_full_starts": 1033,
        "n_drafted": 5175,
        "n_accepted": 2174,
        "accept_rate": 0.4200966183574879,
        "full_window_rate": 0.2371732817037754,
        "mean_accepted_prefix": 2.0964320154291225,
        "mean_accepted_prefix_fullstarts": 2.100677637947725,
        "e_tokens_per_step_independence": 2.880520508202906,
        "mtp_style_rate_independence": 0.37610410164058117
      },
      "6": {
        "gamma": 6,
        "n_starts": 1037,
        "n_full_starts": 1032,
        "n_drafted": 6207,
        "n_accepted": 2372,
        "accept_rate": 0.3821491864024488,
        "full_window_rate": 0.19186046511627908,
        "mean_accepted_prefix": 2.287367405978785,
        "mean_accepted_prefix_fullstarts": 2.294573643410853,
        "e_tokens_per_step_independence": 2.9888646903310323,
        "mtp_style_rate_independence": 0.3314774483885054
      }
    }
  },
  "k2_d0.65": {
    "n_positions": 1037,
    "n_accepted": 725,
    "alpha": 0.6991321118611379,
    "methods": [
      "EXACT-RESTART"
    ],
    "vs_position": [
      {
        "lo": 0,
        "hi": 49,
        "n": 200,
        "accepted": 130,
        "rate": 0.65
      },
      {
        "lo": 50,
        "hi": 99,
        "n": 200,
        "accepted": 121,
        "rate": 0.605
      },
      {
        "lo": 100,
        "hi": 149,
        "n": 200,
        "accepted": 127,
        "rate": 0.635
      },
      {
        "lo": 150,
        "hi": 199,
        "n": 200,
        "accepted": 144,
        "rate": 0.72
      },
      {
        "lo": 200,
        "hi": 249,
        "n": 137,
        "accepted": 113,
        "rate": 0.8248175182481752
      },
      {
        "lo": 250,
        "hi": 299,
        "n": 100,
        "accepted": 90,
        "rate": 0.9
      }
    ],
    "gamma": {
      "2": {
        "gamma": 2,
        "n_starts": 1037,
        "n_full_starts": 1036,
        "n_drafted": 2073,
        "n_accepted": 1263,
        "accept_rate": 0.6092619392185239,
        "full_window_rate": 0.5193050193050193,
        "mean_accepted_prefix": 1.2179363548698168,
        "mean_accepted_prefix_fullstarts": 1.218146718146718,
        "e_tokens_per_step_independence": 2.1879178216965522,
        "mtp_style_rate_independence": 0.5939589108482761
      },
      "3": {
        "gamma": 3,
        "n_starts": 1037,
        "n_full_starts": 1035,
        "n_drafted": 3108,
        "n_accepted": 1690,
        "accept_rate": 0.5437580437580437,
        "full_window_rate": 0.41256038647342996,
        "mean_accepted_prefix": 1.6297010607521698,
        "mean_accepted_prefix_fullstarts": 1.6318840579710145,
        "e_tokens_per_step_independence": 2.529643607261331,
        "mtp_style_rate_independence": 0.5098812024204437
      },
      "4": {
        "gamma": 4,
        "n_starts": 1037,
        "n_full_starts": 1034,
        "n_drafted": 4142,
        "n_accepted": 2042,
        "accept_rate": 0.49299855142443266,
        "full_window_rate": 0.3404255319148936,
        "mean_accepted_prefix": 1.9691417550626809,
        "mean_accepted_prefix_fullstarts": 1.9729206963249517,
        "e_tokens_per_step_independence": 2.7685550774006416,
        "mtp_style_rate_independence": 0.44213876935016033
      },
      "5": {
        "gamma": 5,
        "n_starts": 1037,
        "n_full_starts": 1033,
        "n_drafted": 5175,
        "n_accepted": 2336,
        "accept_rate": 0.4514009661835749,
        "full_window_rate": 0.2846079380445305,
        "mean_accepted_prefix": 2.2526518804243008,
        "mean_accepted_prefix_fullstarts": 2.2575024201355274,
        "e_tokens_per_step_independence": 2.935585758066986,
        "mtp_style_rate_independence": 0.38711715161339727
      },
      "6": {
        "gamma": 6,
        "n_starts": 1037,
        "n_full_starts": 1032,
        "n_drafted": 6207,
        "n_accepted": 2584,
        "accept_rate": 0.41630417270823267,
        "full_window_rate": 0.24031007751937986,
        "mean_accepted_prefix": 2.4918032786885247,
        "mean_accepted_prefix_fullstarts": 2.5,
        "e_tokens_per_step_independence": 3.0523622705868516,
        "mtp_style_rate_independence": 0.34206037843114195
      }
    }
  }
}
```

## Per prompt

```json
{
  "fact": {
    "k2_d0": {
      "n_positions": 203,
      "n_accepted": 114,
      "alpha": 0.5615763546798029,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 36,
          "rate": 0.72
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 24,
          "rate": 0.48
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 24,
          "rate": 0.48
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 29,
          "rate": 0.58
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 3,
          "accepted": 1,
          "rate": 0.3333333333333333
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 203,
          "n_full_starts": 202,
          "n_drafted": 405,
          "n_accepted": 179,
          "accept_rate": 0.4419753086419753,
          "full_window_rate": 0.3217821782178218,
          "mean_accepted_prefix": 0.8817733990147784,
          "mean_accepted_prefix_fullstarts": 0.8811881188118812,
          "e_tokens_per_step_independence": 1.8769443568152588,
          "mtp_style_rate_independence": 0.4384721784076293
        },
        "3": {
          "gamma": 3,
          "n_starts": 203,
          "n_full_starts": 201,
          "n_drafted": 606,
          "n_accepted": 216,
          "accept_rate": 0.3564356435643564,
          "full_window_rate": 0.18407960199004975,
          "mean_accepted_prefix": 1.064039408866995,
          "mean_accepted_prefix_fullstarts": 1.0696517412935322,
          "e_tokens_per_step_independence": 2.0540475698371403,
          "mtp_style_rate_independence": 0.35134918994571346
        },
        "4": {
          "gamma": 4,
          "n_starts": 203,
          "n_full_starts": 200,
          "n_drafted": 806,
          "n_accepted": 241,
          "accept_rate": 0.2990074441687345,
          "full_window_rate": 0.125,
          "mean_accepted_prefix": 1.187192118226601,
          "mean_accepted_prefix_fullstarts": 1.2,
          "e_tokens_per_step_independence": 2.1535045466080494,
          "mtp_style_rate_independence": 0.28837613665201234
        },
        "5": {
          "gamma": 5,
          "n_starts": 203,
          "n_full_starts": 199,
          "n_drafted": 1005,
          "n_accepted": 258,
          "accept_rate": 0.25671641791044775,
          "full_window_rate": 0.08542713567839195,
          "mean_accepted_prefix": 1.270935960591133,
          "mean_accepted_prefix_fullstarts": 1.2864321608040201,
          "e_tokens_per_step_independence": 2.20935723307053,
          "mtp_style_rate_independence": 0.241871446614106
        },
        "6": {
          "gamma": 6,
          "n_starts": 203,
          "n_full_starts": 198,
          "n_drafted": 1203,
          "n_accepted": 268,
          "accept_rate": 0.2227763923524522,
          "full_window_rate": 0.050505050505050504,
          "mean_accepted_prefix": 1.3201970443349753,
          "mean_accepted_prefix_fullstarts": 1.3434343434343434,
          "e_tokens_per_step_independence": 2.2407227811332042,
          "mtp_style_rate_independence": 0.20678713018886732
        }
      }
    },
    "k2_d0.65": {
      "n_positions": 203,
      "n_accepted": 110,
      "alpha": 0.541871921182266,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 34,
          "rate": 0.68
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 23,
          "rate": 0.46
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 26,
          "rate": 0.52
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 26,
          "rate": 0.52
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 3,
          "accepted": 1,
          "rate": 0.3333333333333333
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 203,
          "n_full_starts": 202,
          "n_drafted": 405,
          "n_accepted": 172,
          "accept_rate": 0.4246913580246914,
          "full_window_rate": 0.3069306930693069,
          "mean_accepted_prefix": 0.8472906403940886,
          "mean_accepted_prefix_fullstarts": 0.8465346534653465,
          "e_tokens_per_step_independence": 1.8354971001480258,
          "mtp_style_rate_independence": 0.417748550074013
        },
        "3": {
          "gamma": 3,
          "n_starts": 203,
          "n_full_starts": 201,
          "n_drafted": 606,
          "n_accepted": 206,
          "accept_rate": 0.33993399339933994,
          "full_window_rate": 0.1691542288557214,
          "mean_accepted_prefix": 1.0147783251231528,
          "mean_accepted_prefix_fullstarts": 1.0199004975124377,
          "e_tokens_per_step_independence": 1.9946043399816888,
          "mtp_style_rate_independence": 0.3315347799938963
        },
        "4": {
          "gamma": 4,
          "n_starts": 203,
          "n_full_starts": 200,
          "n_drafted": 806,
          "n_accepted": 226,
          "accept_rate": 0.2803970223325062,
          "full_window_rate": 0.1,
          "mean_accepted_prefix": 1.1133004926108374,
          "mean_accepted_prefix_fullstarts": 1.125,
          "e_tokens_per_step_independence": 2.0808200857043637,
          "mtp_style_rate_independence": 0.2702050214260909
        },
        "5": {
          "gamma": 5,
          "n_starts": 203,
          "n_full_starts": 199,
          "n_drafted": 1005,
          "n_accepted": 237,
          "accept_rate": 0.23582089552238805,
          "full_window_rate": 0.05527638190954774,
          "mean_accepted_prefix": 1.167487684729064,
          "mean_accepted_prefix_fullstarts": 1.1809045226130652,
          "e_tokens_per_step_independence": 2.1275379774752707,
          "mtp_style_rate_independence": 0.2255075954950542
        },
        "6": {
          "gamma": 6,
          "n_starts": 203,
          "n_full_starts": 198,
          "n_drafted": 1203,
          "n_accepted": 242,
          "accept_rate": 0.20116375727348296,
          "full_window_rate": 0.025252525252525252,
          "mean_accepted_prefix": 1.1921182266009853,
          "mean_accepted_prefix_fullstarts": 1.2121212121212122,
          "e_tokens_per_step_independence": 2.1528530912427577,
          "mtp_style_rate_independence": 0.19214218187379295
        }
      }
    }
  },
  "creative": {
    "k2_d0": {
      "n_positions": 234,
      "n_accepted": 123,
      "alpha": 0.5256410256410257,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 27,
          "rate": 0.54
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 28,
          "rate": 0.56
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 24,
          "rate": 0.48
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 25,
          "rate": 0.5
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 34,
          "accepted": 19,
          "rate": 0.5588235294117647
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 234,
          "n_full_starts": 233,
          "n_drafted": 467,
          "n_accepted": 184,
          "accept_rate": 0.39400428265524623,
          "full_window_rate": 0.26180257510729615,
          "mean_accepted_prefix": 0.7863247863247863,
          "mean_accepted_prefix_fullstarts": 0.7896995708154506,
          "e_tokens_per_step_independence": 1.801939513477975,
          "mtp_style_rate_independence": 0.40096975673898755
        },
        "3": {
          "gamma": 3,
          "n_starts": 234,
          "n_full_starts": 232,
          "n_drafted": 699,
          "n_accepted": 215,
          "accept_rate": 0.30758226037195996,
          "full_window_rate": 0.1336206896551724,
          "mean_accepted_prefix": 0.9188034188034188,
          "mean_accepted_prefix_fullstarts": 0.9267241379310345,
          "e_tokens_per_step_independence": 1.9471733340076536,
          "mtp_style_rate_independence": 0.31572444466921784
        },
        "4": {
          "gamma": 4,
          "n_starts": 234,
          "n_full_starts": 231,
          "n_drafted": 930,
          "n_accepted": 231,
          "accept_rate": 0.24838709677419354,
          "full_window_rate": 0.06926406926406926,
          "mean_accepted_prefix": 0.9871794871794872,
          "mean_accepted_prefix_fullstarts": 1.0,
          "e_tokens_per_step_independence": 2.0235141883886385,
          "mtp_style_rate_independence": 0.2558785470971596
        },
        "5": {
          "gamma": 5,
          "n_starts": 234,
          "n_full_starts": 230,
          "n_drafted": 1160,
          "n_accepted": 238,
          "accept_rate": 0.20517241379310344,
          "full_window_rate": 0.030434782608695653,
          "mean_accepted_prefix": 1.017094017094017,
          "mean_accepted_prefix_fullstarts": 1.0347826086956522,
          "e_tokens_per_step_independence": 2.0636420733837713,
          "mtp_style_rate_independence": 0.2127284146767543
        },
        "6": {
          "gamma": 6,
          "n_starts": 234,
          "n_full_starts": 229,
          "n_drafted": 1389,
          "n_accepted": 242,
          "accept_rate": 0.1742260619150468,
          "full_window_rate": 0.017467248908296942,
          "mean_accepted_prefix": 1.0341880341880343,
          "mean_accepted_prefix_fullstarts": 1.056768558951965,
          "e_tokens_per_step_independence": 2.0847349360094185,
          "mtp_style_rate_independence": 0.18078915600156972
        }
      }
    },
    "k2_d0.65": {
      "n_positions": 234,
      "n_accepted": 122,
      "alpha": 0.5213675213675214,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 27,
          "rate": 0.54
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 26,
          "rate": 0.52
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 22,
          "rate": 0.44
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 26,
          "rate": 0.52
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 34,
          "accepted": 21,
          "rate": 0.6176470588235294
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 234,
          "n_full_starts": 233,
          "n_drafted": 467,
          "n_accepted": 184,
          "accept_rate": 0.39400428265524623,
          "full_window_rate": 0.26609442060085836,
          "mean_accepted_prefix": 0.7863247863247863,
          "mean_accepted_prefix_fullstarts": 0.7896995708154506,
          "e_tokens_per_step_independence": 1.7931916137044344,
          "mtp_style_rate_independence": 0.3965958068522172
        },
        "3": {
          "gamma": 3,
          "n_starts": 234,
          "n_full_starts": 232,
          "n_drafted": 699,
          "n_accepted": 217,
          "accept_rate": 0.3104434907010014,
          "full_window_rate": 0.14224137931034483,
          "mean_accepted_prefix": 0.9273504273504274,
          "mean_accepted_prefix_fullstarts": 0.9353448275862069,
          "e_tokens_per_step_independence": 1.934911866974107,
          "mtp_style_rate_independence": 0.31163728899136894
        },
        "4": {
          "gamma": 4,
          "n_starts": 234,
          "n_full_starts": 231,
          "n_drafted": 930,
          "n_accepted": 236,
          "accept_rate": 0.2537634408602151,
          "full_window_rate": 0.08225108225108226,
          "mean_accepted_prefix": 1.0085470085470085,
          "mean_accepted_prefix_fullstarts": 1.0216450216450217,
          "e_tokens_per_step_independence": 2.0088002041488933,
          "mtp_style_rate_independence": 0.25220005103722337
        },
        "5": {
          "gamma": 5,
          "n_starts": 234,
          "n_full_starts": 230,
          "n_drafted": 1160,
          "n_accepted": 248,
          "accept_rate": 0.21379310344827587,
          "full_window_rate": 0.05217391304347826,
          "mean_accepted_prefix": 1.0598290598290598,
          "mean_accepted_prefix_fullstarts": 1.0782608695652174,
          "e_tokens_per_step_independence": 2.0473231833596794,
          "mtp_style_rate_independence": 0.20946463667193588
        },
        "6": {
          "gamma": 6,
          "n_starts": 234,
          "n_full_starts": 229,
          "n_drafted": 1389,
          "n_accepted": 256,
          "accept_rate": 0.18430525557955363,
          "full_window_rate": 0.034934497816593885,
          "mean_accepted_prefix": 1.0940170940170941,
          "mean_accepted_prefix_fullstarts": 1.1179039301310043,
          "e_tokens_per_step_independence": 2.0674078135464997,
          "mtp_style_rate_independence": 0.17790130225774992
        }
      }
    }
  },
  "longfact": {
    "k2_d0": {
      "n_positions": 300,
      "n_accepted": 251,
      "alpha": 0.8366666666666667,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 41,
          "rate": 0.82
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 39,
          "rate": 0.78
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 41,
          "rate": 0.82
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 41,
          "rate": 0.82
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 50,
          "accepted": 44,
          "rate": 0.88
        },
        {
          "lo": 250,
          "hi": 299,
          "n": 50,
          "accepted": 45,
          "rate": 0.9
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 300,
          "n_full_starts": 299,
          "n_drafted": 599,
          "n_accepted": 462,
          "accept_rate": 0.7712854757929883,
          "full_window_rate": 0.705685618729097,
          "mean_accepted_prefix": 1.54,
          "mean_accepted_prefix_fullstarts": 1.5418060200668897,
          "e_tokens_per_step_independence": 2.536677777777778,
          "mtp_style_rate_independence": 0.7683388888888889
        },
        "3": {
          "gamma": 3,
          "n_starts": 300,
          "n_full_starts": 298,
          "n_drafted": 897,
          "n_accepted": 640,
          "accept_rate": 0.7134894091415831,
          "full_window_rate": 0.5973154362416108,
          "mean_accepted_prefix": 2.1333333333333333,
          "mean_accepted_prefix_fullstarts": 2.1375838926174495,
          "e_tokens_per_step_independence": 3.1223537407407407,
          "mtp_style_rate_independence": 0.7074512469135802
        },
        "4": {
          "gamma": 4,
          "n_starts": 300,
          "n_full_starts": 297,
          "n_drafted": 1194,
          "n_accepted": 787,
          "accept_rate": 0.6591289782244556,
          "full_window_rate": 0.494949494949495,
          "mean_accepted_prefix": 2.6233333333333335,
          "mean_accepted_prefix_fullstarts": 2.6296296296296298,
          "e_tokens_per_step_independence": 3.6123692964197534,
          "mtp_style_rate_independence": 0.6530923241049383
        },
        "5": {
          "gamma": 5,
          "n_starts": 300,
          "n_full_starts": 296,
          "n_drafted": 1490,
          "n_accepted": 905,
          "accept_rate": 0.6073825503355704,
          "full_window_rate": 0.39864864864864863,
          "mean_accepted_prefix": 3.0166666666666666,
          "mean_accepted_prefix_fullstarts": 3.0236486486486487,
          "e_tokens_per_step_independence": 4.022348978004526,
          "mtp_style_rate_independence": 0.6044697956009054
        },
        "6": {
          "gamma": 6,
          "n_starts": 300,
          "n_full_starts": 295,
          "n_drafted": 1785,
          "n_accepted": 999,
          "accept_rate": 0.5596638655462185,
          "full_window_rate": 0.31864406779661014,
          "mean_accepted_prefix": 3.33,
          "mean_accepted_prefix_fullstarts": 3.335593220338983,
          "e_tokens_per_step_independence": 4.36536531159712,
          "mtp_style_rate_independence": 0.5608942185995202
        }
      }
    },
    "k2_d0.65": {
      "n_positions": 300,
      "n_accepted": 258,
      "alpha": 0.86,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 39,
          "rate": 0.78
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 38,
          "rate": 0.76
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 43,
          "rate": 0.86
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 46,
          "rate": 0.92
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 50,
          "accepted": 44,
          "rate": 0.88
        },
        {
          "lo": 250,
          "hi": 299,
          "n": 50,
          "accepted": 48,
          "rate": 0.96
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 300,
          "n_full_starts": 299,
          "n_drafted": 599,
          "n_accepted": 482,
          "accept_rate": 0.8046744574290484,
          "full_window_rate": 0.7491638795986622,
          "mean_accepted_prefix": 1.6066666666666667,
          "mean_accepted_prefix_fullstarts": 1.608695652173913,
          "e_tokens_per_step_independence": 2.5996,
          "mtp_style_rate_independence": 0.7998000000000002
        },
        "3": {
          "gamma": 3,
          "n_starts": 300,
          "n_full_starts": 298,
          "n_drafted": 897,
          "n_accepted": 679,
          "accept_rate": 0.7569676700111483,
          "full_window_rate": 0.6610738255033557,
          "mean_accepted_prefix": 2.263333333333333,
          "mean_accepted_prefix_fullstarts": 2.2684563758389262,
          "e_tokens_per_step_independence": 3.235656,
          "mtp_style_rate_independence": 0.7452186666666667
        },
        "4": {
          "gamma": 4,
          "n_starts": 300,
          "n_full_starts": 297,
          "n_drafted": 1194,
          "n_accepted": 852,
          "accept_rate": 0.7135678391959799,
          "full_window_rate": 0.5824915824915825,
          "mean_accepted_prefix": 2.84,
          "mean_accepted_prefix_fullstarts": 2.8484848484848486,
          "e_tokens_per_step_independence": 3.78266416,
          "mtp_style_rate_independence": 0.69566604
        },
        "5": {
          "gamma": 5,
          "n_starts": 300,
          "n_full_starts": 296,
          "n_drafted": 1490,
          "n_accepted": 1004,
          "accept_rate": 0.6738255033557047,
          "full_window_rate": 0.5135135135135135,
          "mean_accepted_prefix": 3.3466666666666667,
          "mean_accepted_prefix_fullstarts": 3.358108108108108,
          "e_tokens_per_step_independence": 4.2530911776,
          "mtp_style_rate_independence": 0.65061823552
        },
        "6": {
          "gamma": 6,
          "n_starts": 300,
          "n_full_starts": 295,
          "n_drafted": 1785,
          "n_accepted": 1137,
          "accept_rate": 0.6369747899159663,
          "full_window_rate": 0.45084745762711864,
          "mean_accepted_prefix": 3.79,
          "mean_accepted_prefix_fullstarts": 3.8033898305084746,
          "e_tokens_per_step_independence": 4.657658412736,
          "mtp_style_rate_independence": 0.6096097354560001
        }
      }
    }
  },
  "code": {
    "k2_d0": {
      "n_positions": 300,
      "n_accepted": 228,
      "alpha": 0.76,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 27,
          "rate": 0.54
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 33,
          "rate": 0.66
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 36,
          "rate": 0.72
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 46,
          "rate": 0.92
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 50,
          "accepted": 47,
          "rate": 0.94
        },
        {
          "lo": 250,
          "hi": 299,
          "n": 50,
          "accepted": 39,
          "rate": 0.78
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 300,
          "n_full_starts": 299,
          "n_drafted": 599,
          "n_accepted": 404,
          "accept_rate": 0.674457429048414,
          "full_window_rate": 0.5886287625418061,
          "mean_accepted_prefix": 1.3466666666666667,
          "mean_accepted_prefix_fullstarts": 1.3478260869565217,
          "e_tokens_per_step_independence": 2.3376,
          "mtp_style_rate_independence": 0.6688
        },
        "3": {
          "gamma": 3,
          "n_starts": 300,
          "n_full_starts": 298,
          "n_drafted": 897,
          "n_accepted": 549,
          "accept_rate": 0.6120401337792643,
          "full_window_rate": 0.4865771812080537,
          "mean_accepted_prefix": 1.83,
          "mean_accepted_prefix_fullstarts": 1.8389261744966443,
          "e_tokens_per_step_independence": 2.776576,
          "mtp_style_rate_independence": 0.5921919999999999
        },
        "4": {
          "gamma": 4,
          "n_starts": 300,
          "n_full_starts": 297,
          "n_drafted": 1194,
          "n_accepted": 670,
          "accept_rate": 0.5611390284757118,
          "full_window_rate": 0.4074074074074074,
          "mean_accepted_prefix": 2.2333333333333334,
          "mean_accepted_prefix_fullstarts": 2.249158249158249,
          "e_tokens_per_step_independence": 3.1101977599999997,
          "mtp_style_rate_independence": 0.52754944
        },
        "5": {
          "gamma": 5,
          "n_starts": 300,
          "n_full_starts": 296,
          "n_drafted": 1490,
          "n_accepted": 773,
          "accept_rate": 0.5187919463087248,
          "full_window_rate": 0.34797297297297297,
          "mean_accepted_prefix": 2.5766666666666667,
          "mean_accepted_prefix_fullstarts": 2.597972972972973,
          "e_tokens_per_step_independence": 3.3637502975999998,
          "mtp_style_rate_independence": 0.47275005951999993
        },
        "6": {
          "gamma": 6,
          "n_starts": 300,
          "n_full_starts": 295,
          "n_drafted": 1785,
          "n_accepted": 863,
          "accept_rate": 0.4834733893557423,
          "full_window_rate": 0.3050847457627119,
          "mean_accepted_prefix": 2.8766666666666665,
          "mean_accepted_prefix_fullstarts": 2.911864406779661,
          "e_tokens_per_step_independence": 3.556450226176,
          "mtp_style_rate_independence": 0.426075037696
        }
      }
    },
    "k2_d0.65": {
      "n_positions": 300,
      "n_accepted": 235,
      "alpha": 0.7833333333333333,
      "methods": [
        "EXACT-RESTART"
      ],
      "vs_position": [
        {
          "lo": 0,
          "hi": 49,
          "n": 50,
          "accepted": 30,
          "rate": 0.6
        },
        {
          "lo": 50,
          "hi": 99,
          "n": 50,
          "accepted": 34,
          "rate": 0.68
        },
        {
          "lo": 100,
          "hi": 149,
          "n": 50,
          "accepted": 36,
          "rate": 0.72
        },
        {
          "lo": 150,
          "hi": 199,
          "n": 50,
          "accepted": 46,
          "rate": 0.92
        },
        {
          "lo": 200,
          "hi": 249,
          "n": 50,
          "accepted": 47,
          "rate": 0.94
        },
        {
          "lo": 250,
          "hi": 299,
          "n": 50,
          "accepted": 42,
          "rate": 0.84
        }
      ],
      "gamma": {
        "2": {
          "gamma": 2,
          "n_starts": 300,
          "n_full_starts": 299,
          "n_drafted": 599,
          "n_accepted": 425,
          "accept_rate": 0.7095158597662772,
          "full_window_rate": 0.6354515050167224,
          "mean_accepted_prefix": 1.4166666666666667,
          "mean_accepted_prefix_fullstarts": 1.4180602006688963,
          "e_tokens_per_step_independence": 2.3969444444444443,
          "mtp_style_rate_independence": 0.6984722222222222
        },
        "3": {
          "gamma": 3,
          "n_starts": 300,
          "n_full_starts": 298,
          "n_drafted": 897,
          "n_accepted": 588,
          "accept_rate": 0.6555183946488294,
          "full_window_rate": 0.5469798657718121,
          "mean_accepted_prefix": 1.96,
          "mean_accepted_prefix_fullstarts": 1.9697986577181208,
          "e_tokens_per_step_independence": 2.8776064814814815,
          "mtp_style_rate_independence": 0.6258688271604937
        },
        "4": {
          "gamma": 4,
          "n_starts": 300,
          "n_full_starts": 297,
          "n_drafted": 1194,
          "n_accepted": 728,
          "accept_rate": 0.609715242881072,
          "full_window_rate": 0.4713804713804714,
          "mean_accepted_prefix": 2.4266666666666667,
          "mean_accepted_prefix_fullstarts": 2.4444444444444446,
          "e_tokens_per_step_independence": 3.2541250771604937,
          "mtp_style_rate_independence": 0.5635312692901234
        },
        "5": {
          "gamma": 5,
          "n_starts": 300,
          "n_full_starts": 296,
          "n_drafted": 1490,
          "n_accepted": 847,
          "accept_rate": 0.5684563758389262,
          "full_window_rate": 0.40202702702702703,
          "mean_accepted_prefix": 2.8233333333333333,
          "mean_accepted_prefix_fullstarts": 2.847972972972973,
          "e_tokens_per_step_independence": 3.54906464377572,
          "mtp_style_rate_independence": 0.509812928755144
        },
        "6": {
          "gamma": 6,
          "n_starts": 300,
          "n_full_starts": 295,
          "n_drafted": 1785,
          "n_accepted": 949,
          "accept_rate": 0.5316526610644258,
          "full_window_rate": 0.34576271186440677,
          "mean_accepted_prefix": 3.1633333333333336,
          "mean_accepted_prefix_fullstarts": 3.2033898305084745,
          "e_tokens_per_step_independence": 3.7801006376243143,
          "mtp_style_rate_independence": 0.46335010627071904
        }
      }
    }
  }
}
```

## PC speed (one prompt, same n)

prompt=longfact n=128 k2=6.77 tok/s  k6=5.326 tok/s  ratio=1.2711227938415322

Device k6 numbers are **not** PC measurements:
- 5.861 tok/s S23 CPU k6d065 cache-2000 (`reports/moe-adopt-kexp.md:59`)
- 2.901 tok/s S23 CPU k6 cache-1000 (`reports/moe-k4-split.md:311`)
- 2.025 tok/s S23 GPU-split k6 cache-1000 (`reports/moe-k4-split.md:311`)

Speedup arithmetic is STAND-IN (no batched verify): `t_step = gamma*t_k2 + (gamma+1)*t_k6`. Device k2 estimated from the PC ratio; device ratios will differ (`mandates/selfspec-f0-acceptance.md:28`).

```json
{
  "pc": {
    "stand_in": true,
    "pc_k2_toks": 6.77,
    "pc_k6_toks": 5.326,
    "pc_k2_over_k6": 1.2711227938415322,
    "n": 128,
    "prompt": "longfact",
    "by_gamma": {
      "2": {
        "E_tokens_per_step": 2.1879178216965522,
        "t_step_s": 0.8586954773300733,
        "E_tok_s": 2.54795545039949,
        "speedup_vs_k6": 0.4783994461884135
      },
      "3": {
        "E_tokens_per_step": 2.529643607261331,
        "t_step_s": 1.1941641322549672,
        "E_tok_s": 2.1183382911397177,
        "speedup_vs_k6": 0.3977353156477127
      },
      "4": {
        "E_tokens_per_step": 2.7685550774006416,
        "t_step_s": 1.5296327871798612,
        "E_tok_s": 1.8099475250559611,
        "speedup_vs_k6": 0.33983243053998524
      },
      "5": {
        "E_tokens_per_step": 2.935585758066986,
        "t_step_s": 1.8651014421047551,
        "E_tok_s": 1.573955009521732,
        "speedup_vs_k6": 0.29552290828421557
      },
      "6": {
        "E_tokens_per_step": 3.0523622705868516,
        "t_step_s": 2.200570097029649,
        "E_tok_s": 1.3870779552566672,
        "speedup_vs_k6": 0.26043521503129313
      }
    }
  },
  "device_cpu_k6_cache2000": {
    "label": "S23 CPU k6d065 cache-2000 (reports/moe-adopt-kexp.md:59)",
    "device_k6_toks": 5.861,
    "stand_in": true,
    "note": "t_verify is (gamma+1)*t_k6 and t_draft is gamma*t_k2; no batched verify exists yet. Device k2 uses PC k2/k6 ratio; device ratios will differ (mandates/selfspec-f0-acceptance.md:27-28).",
    "by_gamma": {
      "2": {
        "E_tokens_per_step": 2.1879178216965522,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 0.7803125937996879,
        "E_tok_s": 2.8038991541102916,
        "baseline_k6_tok_s": 5.861,
        "speedup_vs_k6": 0.4783994461884135
      },
      "3": {
        "E_tokens_per_step": 2.529643607261331,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 1.085159216582487,
        "E_tok_s": 2.3311266850112435,
        "baseline_k6_tok_s": 5.861,
        "speedup_vs_k6": 0.39773531564771264
      },
      "4": {
        "E_tokens_per_step": 2.7685550774006416,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 1.390005839365286,
        "E_tok_s": 1.991757875394853,
        "baseline_k6_tok_s": 5.861,
        "speedup_vs_k6": 0.3398324305399852
      },
      "5": {
        "E_tokens_per_step": 2.935585758066986,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 1.6948524621480852,
        "E_tok_s": 1.7320597654537873,
        "baseline_k6_tok_s": 5.861,
        "speedup_vs_k6": 0.29552290828421557
      },
      "6": {
        "E_tokens_per_step": 3.0523622705868516,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 1.999699084930884,
        "E_tok_s": 1.5264107952984092,
        "baseline_k6_tok_s": 5.861,
        "speedup_vs_k6": 0.2604352150312932
      }
    },
    "device_k2_toks_from_pc_ratio": 7.45005069470522
  },
  "device_cpu_k6_cache1000": {
    "label": "S23 CPU k6 cache-1000 (reports/moe-k4-split.md:311)",
    "device_k6_toks": 2.901,
    "stand_in": true,
    "note": "t_verify is (gamma+1)*t_k6 and t_draft is gamma*t_k2; no batched verify exists yet. Device k2 uses PC k2/k6 ratio; device ratios will differ (mandates/selfspec-f0-acceptance.md:27-28).",
    "by_gamma": {
      "2": {
        "E_tokens_per_step": 2.1879178216965522,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 1.5764950404205345,
        "E_tok_s": 1.3878367933925875,
        "baseline_k6_tok_s": 2.901,
        "speedup_vs_k6": 0.4783994461884135
      },
      "3": {
        "E_tokens_per_step": 2.529643607261331,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 2.1923882000654795,
        "E_tok_s": 1.1538301506940143,
        "baseline_k6_tok_s": 2.901,
        "speedup_vs_k6": 0.39773531564771264
      },
      "4": {
        "E_tokens_per_step": 2.7685550774006416,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 2.808281359710424,
        "E_tok_s": 0.9858538809964971,
        "baseline_k6_tok_s": 2.901,
        "speedup_vs_k6": 0.33983243053998524
      },
      "5": {
        "E_tokens_per_step": 2.935585758066986,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 3.424174519355369,
        "E_tok_s": 0.8573119569325094,
        "baseline_k6_tok_s": 2.901,
        "speedup_vs_k6": 0.2955229082842156
      },
      "6": {
        "E_tokens_per_step": 3.0523622705868516,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 4.040067679000314,
        "E_tok_s": 0.7555225588057813,
        "baseline_k6_tok_s": 2.901,
        "speedup_vs_k6": 0.26043521503129313
      }
    },
    "device_k2_toks_from_pc_ratio": 3.6875272249342843
  },
  "device_gpu_split_k6": {
    "label": "S23 GPU-split k6 cache-1000 (reports/moe-k4-split.md:311)",
    "device_k6_toks": 2.025,
    "stand_in": true,
    "note": "t_verify is (gamma+1)*t_k6 and t_draft is gamma*t_k2; no batched verify exists yet. Device k2 uses PC k2/k6 ratio; device ratios will differ (mandates/selfspec-f0-acceptance.md:27-28).",
    "by_gamma": {
      "2": {
        "E_tokens_per_step": 2.1879178216965522,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 2.2584751171654176,
        "E_tok_s": 0.9687588785315373,
        "baseline_k6_tok_s": 2.025,
        "speedup_vs_k6": 0.4783994461884135
      },
      "3": {
        "E_tokens_per_step": 2.529643607261331,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 3.1407990955012126,
        "E_tok_s": 0.8054140141866182,
        "baseline_k6_tok_s": 2.025,
        "speedup_vs_k6": 0.3977353156477127
      },
      "4": {
        "E_tokens_per_step": 2.7685550774006416,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 4.023123073837008,
        "E_tok_s": 0.6881606718434701,
        "baseline_k6_tok_s": 2.025,
        "speedup_vs_k6": 0.33983243053998524
      },
      "5": {
        "E_tokens_per_step": 2.935585758066986,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 4.9054470521728035,
        "E_tok_s": 0.5984338892755364,
        "baseline_k6_tok_s": 2.025,
        "speedup_vs_k6": 0.2955229082842155
      },
      "6": {
        "E_tokens_per_step": 3.0523622705868516,
        "formula": "(1-alpha**(gamma+1))/(1-alpha)",
        "t_step_s": 5.7877710305085985,
        "E_tok_s": 0.5273813104383686,
        "baseline_k6_tok_s": 2.025,
        "speedup_vs_k6": 0.26043521503129313
      }
    },
    "device_k2_toks_from_pc_ratio": 2.5740236575291027
  }
}
```

## Notes

```json
{
  "started": "2026-08-13T20:37:46",
  "bin_sha256": "42cd907c38fb223d1b04c7070a0c9a6e3b200e186afc19439189651dcac74f69",
  "bin_version_expected": "0.19.0",
  "model_bytes": 13416430592,
  "model_published_sha256": "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a",
  "model_published_sha_source": "quality/ppl_baseline.json:111",
  "model_hashed_this_run": false,
  "threads": 8,
  "n_target": 300,
  "n_speed": 128,
  "method": "EXACT-RESTART with WINDOWED-W16 fallback",
  "method_plan": "results/selfspec_f0/METHOD_PLAN.md",
  "chatml": false,
  "flag_line": "-t 8 -c 4096 --ubatch 512 --temp 0 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --progress --session",
  "thread_note": "METHOD_PLAN.md:103 used -t 4 while LFM PPL held -t 8. This execute uses -t 8 as specified for idle PC (mandates/selfspec-f0-acceptance.md campaign flags this turn).",
  "target_ready": {
    "load_s": 3.182,
    "arch": "qwen35moe",
    "n_ctx": 4096,
    "think_ctl": "template",
    "n_expert_used": 6
  },
  "targets": {
    "fact": {
      "skipped": true,
      "n_pieces": 203,
      "n_prompt": 75
    },
    "creative": {
      "skipped": false,
      "n_pieces": 234,
      "n_prompt": 71,
      "tok_s": 7.357,
      "tokens": 234
    },
    "longfact": {
      "skipped": true,
      "n_pieces": 300,
      "n_prompt": 293
    },
    "code": {
      "skipped": true,
      "n_pieces": 300,
      "n_prompt": 399
    }
  },
  "speed_k6": {
    "k": 6,
    "n_predict": 128,
    "prompt": "longfact",
    "tok_s": 5.326,
    "tokens": 128,
    "prefill_s": 16.473,
    "n_prompt": 293
  },
  "draft_k2_d065_ready": {
    "load_s": 3.141,
    "arch": "qwen35moe",
    "n_ctx": 4096,
    "think_ctl": "template",
    "n_expert_used": 2
  },
  "speed_k2": {
    "k": 2,
    "n_predict": 128,
    "prompt": "longfact",
    "tok_s": 6.77,
    "tokens": 2,
    "prefill_s": 13.337,
    "n_prompt": 293
  },
  "k2_d065_after_primary": {
    "n": 1037,
    "alpha": 0.6991321118611379
  },
  "draft_k2_d0_ready": {
    "load_s": 3.065,
    "arch": "qwen35moe",
    "n_ctx": 4096,
    "think_ctl": "template",
    "n_expert_used": 2
  },
  "k2_d065_pooled": {
    "n": 1037,
    "alpha": 0.6991321118611379
  },
  "finished": "2026-08-14T00:50:10"
}
```
