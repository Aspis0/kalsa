# Re-verification of the `GOVERNOR-DEVICE-PLAN.md` audit

**Role:** Explorer (READ-ONLY). No edits outside this file. No adb, no network, no commits.

**Working dir:** `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck`

**Target audited:** `analysis/GOVERNOR-DEVICE-PLAN.md` (1054 lines) — header table + Appendix A.

**Method:** each accusation re-read against the on-disk artifact. Commands quoted verbatim.
Verdicts: SUPPORTED / REFUTED (with correct value) / UNVERIFIABLE (grep + result) /
CITATION-DRIFT (number right, path/line wrong) / AUDIT-ITSELF-WRONG.

Status: COMPLETE — all nine requested items re-verified against on-disk artifacts (plus two
cross-checks in the app/engine repos outside the lab worktree).

---

## Finding 1 — `0,992` provenance / which phone

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:496-498`):
> ⛔ **Smentita a verbale.** La parita' di decode "0,992" citata nella memoria
> `kalsa-the-goal-is-a-governor` **non e' dello Xiaomi**: e' della scheda di riferimento QRD8650, che
> ha lo stesso SoC ma non e' il nostro telefono. Sul telefono vero la GPU in decode perde, su due
> misure indipendenti.

**Artifact evidence**

| evidence | file:line | raw value |
|---|---|---|
| device identity | `scratchpad/agents/q16-xiaomi/REPORT.md:4` | `**Device:** Xiaomi 14 ("houji"), Adreno 750, SM8650` |
| device identity (2nd) | `scratchpad/agents/q16-xiaomi/REPORT.md:26` | ``houji` / `23127PN0CG` / platform `pineapple` (SM8650)` |
| the 0.992 cell | `scratchpad/agents/q16-xiaomi/REPORT.md:336` | `**d1 LFM A/C N=5 is the bankable 750 number:** … **A/C = 0.992**. pp A/C = 2.477.` |
| same cell, header row | `scratchpad/agents/q16-xiaomi/REPORT.md:378` | `**A/C tg = 0.992** … **A/C pp = 2.477**` |
| full precision | `scratchpad/agents/q16-xiaomi-audit/REPORT.md:137` | `A/C tg = 0.992469912994216 -> 0.992, and A/C pp = 2.47734231126173 -> 2.477` |
| the memory row | `/Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/kalsa-the-goal-is-a-governor.md:28` | `Adreno 750: decode **0.992** (parity), prefill **2.477×**.` |
| the *other* 0.992 | `scratchpad/agents/qdc-governor-s5/REPORT.md:235` | `B/A=0.9929437564` |
| that run's board | `scratchpad/agents/qdc-governor-s5/REPORT.md:216` | `Run 6 used … QRD8750/8 Elite (Adreno 830, V79), serial 2a38935c … SM8750` |

Commands: `grep -n "A/C = 0.992\|houji" scratchpad/agents/q16-xiaomi/REPORT.md`,
`grep -n "0.992469912994216" scratchpad/agents/q16-xiaomi-audit/REPORT.md`,
`grep -n "0.9929437564\|2a38935c\|QRD8750" scratchpad/agents/qdc-governor-s5/REPORT.md`,
`sed -n '26,30p' /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/kalsa-the-goal-is-a-governor.md`.

**Verdict: SUPPORTED (audit's finding 1 is correct).** The `0.992` (and the paired `2.477`)
belong to the Xiaomi 14 `houji` (Adreno 750 / SM8650) cell, not to a QRD8650 reference board.
The memory row matches that cell on both numbers. The *second* `0.992` in the corpus is the
`0.9929437564` in the qdc-governor-s5 run 6, which is **QRD8750 / 8 Elite / Adreno 830 / SM8750**,
so the plan's named board is wrong on both counts.

**Audit's own imprecision (extra, not in the suspect list):** the audit cites the qdc serial at
`:213`; it is at **`:216`** (line 213 is blank / the Run 6 block begins at `:214`). Minor,
number-right/path-wrong, and it does not affect the finding.

## Finding 2 — Part 3.3 Mali state: gates 3 and 4 already ran, owner parked G57

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:537-548`):
> Cosa non funziona davvero, e sono due cause **nominate e banali**: (a) i kernel quantizzati
> "generici" sono `#ifdef INTEL_GPU` / `#elif ADRENO_GPU` **senza `#else`** … (b) letture dirette di
> `half*` … serve `vload_half`. Stima del gate: **mezza giornata di PC piu' 30 minuti di Jelly**.
>
> Quindi la voce giusta per il Jelly non e' "niente GPU": e' **"GPU bloccata da una lista bianca e da
> due difetti nominati, con una stima"**.

**Artifact evidence**

| evidence | file:line | raw value |
|---|---|---|
| Gate 4 status | `scratchpad/agents/q26b-mali-probe/REPORT.md:3` | `**Status:** DONE (Gate 4 — GPU ≤ CPU on green paths; Mali-tuned kernels required)` |
| Gate 3 heading/timebox | `scratchpad/agents/q26b-mali-probe/REPORT.md:172,176,178` | `# Gate 3 — portability patch (quant kernels on Mali)` / `**Timebox:** ~3h` / `Branch: kalsa/mali-probe @ 435eacf36` |
| Gate 4 status | `scratchpad/agents/q26b-mali-probe/REPORT.md:266,268` | `# Gate 4 — op-perf on green paths` / `**Status:** DONE` |
| post-patch failures | `scratchpad/agents/q26b-mali-probe/REPORT.md:218-221` | `q4_0 … SIGILL 132`; `q4_K … err -54 CL_INVALID_WORK_GROUP_SIZE`; `q6_K … SIGILL 132` |
| verdict | `scratchpad/agents/q26b-mali-probe/REPORT.md:252,260` | `Portability patches made class-1 kernels **parse**. They are **not** enough for the ship path.` … `**Dedicated Mali kernels remain justified** for the ship quant path.` |
| owner park + Gate 4 number | `docs/ALIVE.md:445` (main repo working tree, 7773-line full diary) = `archived/ALIVE-2026-09-full.md:445` (worktree) | `Gate 4 (RUN 22/08 night …): GPU < CPU on all 20 green cases, max 0.962× …` **`OWNER DECISION 22/08: PARKED on G57-class.`** |
| commit exists | `git rev-parse --short 8540797` | `85407975` (message: `q26b Mali gate 2: the lane is ALIVE - f32 MUL_MAT 202/202 correct on G57 …`) |

Commands: `sed -n '1,10p;170,180p;216,224p;250,262p' scratchpad/agents/q26b-mali-probe/REPORT.md`;
`grep -n "OWNER DECISION 22/08\|PARKED on G57" archived/ALIVE-2026-09-full.md`;
`grep -rn "mezza giornata" .`; `git rev-parse --short 8540797`.

**Verdict: SUPPORTED (audit's finding 2 is correct), with one audit citation drift.**
Both gates ran and are marked DONE; the portability patches were applied and the diagnosed defects
were shown *not* to be the blocker (`sub_group_shuffle_xor` SIGILL, q4_K WG-size are architectural);
the owner parked G57-class on 22/08. The plan nevertheless reopens the lane under a heading that
presents itself as the *corrective* to the earlier "Mali is unusable" error.

**Audit's own imprecision:** the audit cites the park decision at `docs/ALIVE.md:441`. Two
trees matter. In the **main repo** (`/Users/marco/Projects/kalsa-moe-experiments`) `docs/ALIVE.md`
is still the 7773-line full diary, and the quoted text is at **`:445`** (line 441 is an unrelated
`LANE_MOD` row). In the **worktree** `docs/ALIVE.md` has been rewritten to a 46-line living state
(frozen 2026-09-20) with no G57/PARKED text, and the text lives at
`archived/ALIVE-2026-09-full.md:445`. So the path was right at audit time, but the line is **off by
4** (`:441` → `:445`) and does not resolve in the worktree. Content correct, line wrong →
CITATION-DRIFT (of the audit, not the plan). The audit's `grep -rn "mezza giornata"` claim is
**accurate**: two plan hits (`:545`, `:888`) plus three archived hits
(`archived/ALIVE-2026-09-full.md:7142`, `archived/PLAN-archive.md:3911`,
`archived/PLAN-archive.md:5934`).

## Finding 3 — NPU `ΔT +1,3 °C`: whole-cell rise, not per-engine

**Plan body claims** (two places):
- `analysis/GOVERNOR-DEVICE-PLAN.md:291-292` (§1.4): *"pur essendo — sullo Xiaomi — il motore di
  prefill piu' veloce e piu' freddo che abbiamo misurato (3,19× la CPU, **ΔT +1,3 °C**)."*
- `analysis/GOVERNOR-DEVICE-PLAN.md:494` (§3.1): *"**NPU:** prefill 165,4 vs 51,9 CPU (**3,19×**,
  ΔT +1,3 °C); decode 4,47 vs 11,94 (**0,37×**)."*

**Artifact evidence**

| evidence | file:line | raw value |
|---|---|---|
| whole cell, 5 rows | `results/htp_prefill/xiaomi_v75/cell1/battery_series.csv:2-6` | `htp1_pre … 32.9`; `htp2_pre … 33.3`; `htp3_pre … 33.3`; `cpu_pre … 33.3`; `end … 34.2` |
| same, prose | `results/htp_prefill/xiaomi_v75/cell1/NOTES.txt:7` | `temp C: htp1 32.9  htp2 33.3  htp3 33.3  cpu 33.3  end 34.2` |
| rep ordering | `results/htp_prefill/xiaomi_v75/cell1/AUDIT-CORRECTIONS.md:10-11` | `The CPU rep starts 1s after HTP rep3 — same thermal state`; `:9-10` `"60s cooldowns" applies ONLY between HTP reps (61s/61s measured)` |

Derivation: the only way to get **+1.3** is `end − htp1_pre` = `34.2 − 32.9` — the **entire cell**,
which includes the CPU rep. Per leg: three HTP reps = `32.9 → 33.3` = **+0.4 total**; the single CPU
rep = `cpu_pre 33.3 → end 34.2` = **+0.9**. So 0.4 + 0.9 = 1.3, and the CPU arm supplies 0.9 of the
1.3. No per-engine NPU ΔT exists in the artifact (no per-rep `end` tag; only one `end` row).

Commands: `cat -n results/htp_prefill/xiaomi_v75/cell1/battery_series.csv`;
`cat -n results/htp_prefill/xiaomi_v75/cell1/NOTES.txt`;
`cat -n results/htp_prefill/xiaomi_v75/cell1/AUDIT-CORRECTIONS.md`.

**Verdict: SUPPORTED (audit's finding 3 is correct).** The `+1,3 °C` is the whole cell's rise. The
plan uses it to call the NPU the "coldest" prefill engine while the artifact attributes 0.9 of the
1.3 to the CPU rep.

**Audit's own imprecision:** the audit cites `AUDIT-CORRECTIONS.md:11-13` for "The CPU rep starts
**1s** after HTP rep3"; that sentence is at **`:10`** (the correction block runs `:9-11`, with
`:11` reading `(arguably fairer), but the NOTES wording is inaccurate.`). Minor, content-right /
line-approximate.

## Finding 4 — the `Thermal Status 0 in ogni campione` census

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:221-224`):
> `dumpsys thermalservice` riporta `Thermal Status 0` in *ogni* campione
> dell'archivio: 12/12 nel cooldown del 19/09, 15/15 nei file product-suite, tutti gli
> `results/htp_*`. Nel frattempo cpu7 gira a **1824000** su **3302400** di hw max — il 55%.

**Audit claim** (verbatim in the plan, `analysis/GOVERNOR-DEVICE-PLAN.md:909`):
> Line census over the repo: `1263× "Thermal Status: 0"`, **`28× "Thermal Status: 3"`, `11× "1"`, `9× "2"`**. `product-suite/thermal*.txt` = **23 files**, 21 zeros, one `1` (`S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11/thermal-retry.txt:10`), one **`3`** (`JELLY-PREWARM-2026-09-09/minicpm5/turn/thermal-mid-turn.txt:10`). … All four `results/` hits are `0`.

**Artifact evidence**

| check | command (cwd) | result |
|---|---|---|
| worktree census | `grep -rn "Thermal Status: N" .` in the worktree | `0=1252`, `1=6`, `2=4`, `3=29` |
| **main-repo** census | `grep -rn "Thermal Status: N" .` in `/Users/marco/Projects/kalsa-moe-experiments` | `0=1264`, `1=11`, `2=9`, `3=29` |
| main repo, plan excluded | `grep -rn … \| grep -v '^./analysis/GOVERNOR-DEVICE-PLAN.md'` | **`0=1263`, `1=11`, `2=9`, `3=28`** — exactly the audit's four numbers |
| plan self-matches | `grep -o "Thermal Status: [0-9]" analysis/GOVERNOR-DEVICE-PLAN.md \| sort \| uniq -c` | `1× 0`, `1× 3` (the census sentence quotes itself) |
| tracked-only census (worktree, both trees) | `git grep -I -h "Thermal Status: N"` | `0=1252`, `1=6`, `2=4`, `3=29` |
| product-suite, audit's glob | `find scratchpad/agents/product-suite -type f -name 'thermal*.txt'` (main repo) | **23 files**; breakdown `21× "Thermal Status: 0"`, `1× "1"`, `1× "3"` |
| product-suite, *tracked* | `git ls-files 'scratchpad/agents/product-suite/**thermal*'` | **20 files** (16 zeros, 1 three, 3 with no status line) |
| the `1` file | `cat -n …/S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11/thermal-retry.txt` (main repo) | line **6** = `Thermal Status: 1` (file is 6 lines total) |
| the `3` file | `sed -n '10p' …/JELLY-PREWARM-2026-09-09/minicpm5/turn/thermal-mid-turn.txt` | line **10** = `Thermal Status: 3` ✓ |
| `results/` | `grep -rn "Thermal Status: [0-9]" results/` | 4 files, all `0` (`results/mali_gate_jelly/raw2,raw4`) ✓ |
| plan's "results/htp_*" | `grep -rn "Thermal Status" results/htp_*` | **no match at all** — those files carry no `Thermal Status` line |
| 19/09 cooldown | `find . -iname '*cooldown*' \| grep -i "09-19\|1909"` | no result; no `*cooldown*` file postdates 2026-09-18 |

**Verdict: SUPPORTED (audit's core accusation is correct), with two precision caveats on the audit.**
The plan's archive-wide "*in ogni campione*" is false: 28 archived lines read `Thermal Status: 3`
(plus 11 ones and 9 twos). The audit's four census numbers **reproduce exactly**, but only from the
**main repo working tree**, which contains gitignored artifacts (XIAOMI-G2-RESTORE,
XIAOMI-KV-REUSE, `S23-SWITCH-EXTRACT-CANCEL/thermal-retry.txt`) that a fresh worktree does not
check out. Against the worktree — and against tracked files in either tree — the census is
`1252 / 6 / 4 / 29`, not `1263 / 28 / 11 / 9`. The audit wrote "over the repo" without saying
which tree or that gitignored files were included.

Likewise the audit's `product-suite/thermal*.txt = 23 files` is exact for the filesystem glob
`-name 'thermal*.txt'` (23, 21 zeros, one `1`, one `3`), but the *tracked* set is **20** files
(`**thermal*`), and 3 of those carry no status line at all. So the task's note "20 tracked, not 23"
is the correct caveat on the audit's denominator, not a refutation of its count.

**Audit's own imprecision:** the audit cites `…/thermal-retry.txt:10`. In the main repo that file
has 6 lines and `Thermal Status: 1` is at **line 6**. `:10` does not exist → line drift. Its other
sub-citation, `thermal-mid-turn.txt:10`, is exact.

**Extra plan errors the audit did not enumerate:**
- "15/15 nei file product-suite" is wrong under every glob: the status-bearing product-suite files
  are 23 (21 zeros + one `1` + one `3`), or 17 with a status line out of the 20 tracked.
- "tutti gli `results/htp_*`" is wrong: `results/htp_*` contains **no** `Thermal Status` line.
- "12/12 nel cooldown del 19/09" is UNVERIFIABLE: `find . -iname '*cooldown*'` finds no 19/09
  artifact, and no `*cooldown*` file postdates 2026-09-18.
- The plan's own §3.3 (`analysis/GOVERNOR-DEVICE-PLAN.md:559`) says `` `Thermal Status 3` (SEVERE) in
  **9 minuti** da freddo`` — a direct self-contradiction with "in ogni campione".

## Finding 5 — 4B thermal deltas: wrong artifact, contaminated source, wrong night

**Plan body claims** (`analysis/GOVERNOR-DEVICE-PLAN.md:468-469` and `:483`):
> **Termica, coppie appaiate della stessa sera, staccato** —
> `results/xiaomi_ab/task_a/battery_notes.txt`, riletto dall'orchestratore:
> … Il 4B da' lo stesso verso: CPU +2,4/+3,5/+1,7 a pp512/1024/2048 contro GPU +0,4/−0,7/−0,3.

**Artifact evidence**

| evidence | file:line | raw value |
|---|---|---|
| where the six values are | `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt:1,17,26,35,44,53,62,71,80,89,98,107,116` | run starts `2026-08-13T05:32:25`; CPU pp512 `289→313` (+2.4); GPU pp512 `313→317` (+0.4); CPU pp1024 `317→352` (+3.5); GPU pp1024 `354→347` (−0.7); CPU pp2048 `351→368` (+1.7); GPU pp2048 `368→365` (−0.3) |
| the cited file's 4B block | `results/xiaomi_ab/task_a/battery_notes.txt:199-287` | `start_4b 2026-08-13T00:00:10`; CPU pp512 `328→351` (+2.3); GPU pp512 `363→364` (+0.1); CPU pp2048 `364→380` (+1.6); GPU pp2048 `380→365` (−1.5); **no pp1024 cell** |
| contamination notice | `results/xiaomi_ab/task_a/CONTAMINATED_4B.md:3-5,15,17-22` | `measured while the owner was using the phone … They are **not** product numbers`; lists `4B sections of battery_notes.txt`; `Missing from that attempt … pp1024`; `Clean redo lives in results/xiaomi_ab/task_a_4b_clean/ … started 2026-08-13T05:32 UNPLUGGED` |

Commands: `cat -n results/xiaomi_ab/task_a_4b_clean/battery_notes.txt`;
`grep -n "4b\|temperature" results/xiaomi_ab/task_a/battery_notes.txt`;
`cat -n results/xiaomi_ab/task_a/CONTAMINATED_4B.md`.

**Verdict: SUPPORTED (audit's finding 5 is correct).** All six values (+2.4/+3.5/+1.7 CPU,
+0.4/−0.7/−0.3 GPU) are exact from `task_a_4b_clean/battery_notes.txt`, a run that began
`2026-08-13T05:32:25` — the next morning, not "la stessa sera". The cited file
(`task_a/battery_notes.txt`) has **no 4B pp1024 cell at all**, and its whole 4B block is marked
`CONTAMINATED`. The plan's 2B table above the 4B sentence *is* correctly served by the cited file
(the 2B pairs there are `279→290`, `290→290`, `290→318`, `322→319`, `319→355`, `355→356`), so the
drift is confined to the 4B sentence.

**Audit's own imprecision (minor):** the audit writes "its 4B deltas are +2.3/+0.1/−1.5". That
picks CPU pp512 (+2.3), GPU pp512 (+0.1) and GPU pp2048 (−1.5) and omits the contaminated CPU
pp2048 leg (`364→380` = +1.6). The three quoted values are correct; the list is selective, not a
full census.

## Finding 6 — the 18/08 rerun: "10 ripetizioni per verso" on decode

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:490-492`):
> Il rerun interlacciato del 18/08 (10 ripetizioni per verso, entrambi gli ordini) conferma il verso
> del decode — GPU 17,46 vs CPU 26,50 — e **ridimensiona il prefill a 3,18×** con una baseline CPU
> migliore.

**Artifact evidence** (`results/gpu_prefill_recheck_xiaomi/report.md`)

| evidence | line | raw value |
|---|---|---|
| the 10-rep / two-order design | `:20-32` | four cells of 5 reps each in Orders A/B, `All 10 interleaved CPU: mean 58.676`, `All 10 interleaved GPU: mean 186.567`, `Speedup tonight: 186.567 / 58.676 = 3.18×` — all under the **pp128 prefill** section |
| decode heading | `:42` | `### Decode (not disputed; 2 interleaved pairs)` |
| decode rows (4) | `:48-51` | CPU rep1 `tg256 26.968`; GPU rep1 `17.413`; GPU rep2 `17.514`; CPU rep2 `26.039` |
| decode ratio | `:53` | `Decode GPU/CPU = 17.46 / 26.50 = **0.66×**` |

Commands: `sed -n '20,60p' results/gpu_prefill_recheck_xiaomi/report.md`;
`grep -n "10\|2 interleaved\|3.18" results/gpu_prefill_recheck_xiaomi/report.md`.

**Verdict: SUPPORTED (audit's finding 6 is correct).** The "10 ripetizioni per verso, entrambi gli
ordini" design belongs to the **pp128 prefill** cell. Decode has only **2 interleaved pairs** (CPU
`26.968 / 26.039`, GPU `17.413 / 17.514`), i.e. n=2 per arm, not n=10. The numbers the plan quotes
from it (`17,46`, `26,50`, `3,18×`) are otherwise correct: means 17.4635 / 26.5035 and
186.567/58.676 = 3.1796. The defect is the descriptor inflating n in the same paragraph that argues
which number is "meglio controllato".

## Finding 7 — Mali-G57 MC2 confirmed, `1100 MHz` wrong

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:568-569`):
> **GPU: disabilitata per default, ma non perche' non esista.** Il Mali e' un **G57 MC2** (non G52),
> 2 CU a 1100 MHz, driver OpenCL ARM presente e Vulkan 1.1.177.

**Artifact evidence (local, on disk)**

| evidence | file:line | raw value |
|---|---|---|
| MC2 identity | `scratchpad/agents/q26-mali-gate/REPORT.md:5` | `Jelly Star (Mali-G57 MC2, Helio G99 / mt6789, 8 GB)` |
| MC2 from the driver | `scratchpad/agents/q26-mali-gate/REPORT.md:69` | `ggml_vulkan: 0 = Mali-G57 MC2 (Mali-G57 MC2) \| uma: 1 \| fp16: 1 … warp size: 16` |
| MC2 identity | `scratchpad/agents/q26b-mali-probe/REPORT.md:5` | `Unihertz Jelly Star, Mali-G57 MC2` |
| **clock** | `scratchpad/agents/q26b-mali-probe/REPORT.md:307` | `Helio G99 published GPU clock \| **1.0e9 assumed max** \| nanoreview / Oppo Reno 8T specs; notebookcheck range 680–1100 MHz` |
| clock used in planning | `scratchpad/agents/q26e-mali-generation-research/REPORT.md:30` | `Helio G99; Jelly Star baseline … G57 MC2 ~1.0 GHz` |
| only local hit for "1100" near Mali/G99 | `grep -rn "1100" --include='*.md' scratchpad/agents/ \| grep -i "mali\|g99\|gpu"` | the single line `q26b-mali-probe/REPORT.md:307` (a NotebookCheck **range** top, not a G99 figure) |

**Verdict: SUPPORTED on local evidence; the audit's external URLs are UNVERIFIABLE offline.**
G57 MC2 is confirmed by the on-device driver string and multiple reports. `1100 MHz` is not the G99
clock in any local artifact: the corpus records **`1.0e9 assumed max`** for the G99 and
`notebookcheck range 680–1100 MHz`, i.e. 1100 MHz is the **top of a range**. The plan flattens that
range maximum into a single-spec figure.

**Offline limitation (exact check):** the audit's finding rests on three external URLs. With no
network I cannot re-fetch them, so the audit's specific attribution — "MediaTek does not publish
the G99 GPU clock", "third-party G99 pages say 1000 MHz", "1100 MHz is the generic Mali-G57 MP2 row
maximum under UNISOC T9300/T7300" — is **UNVERIFIABLE** here. The audit's own verdict for this
finding is already hedged ("PLAUSIBLE-to-REFUTED (external)"), which is the correct epistemic level
given it is the one finding whose support is not on disk.

## Finding 8 — the two "NON VERIFICABILI": `cpu7 a 1824000` and `gpubusy ~7,5%`

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:224`):
> Nel frattempo cpu7 gira a **1824000** su **3302400** di hw max — il 55%.

**Plan body claim** (`analysis/GOVERNOR-DEVICE-PLAN.md:708`, §6.1):
> `/sys/class/kgsl/kgsl-3d0/gpubusy` … Linea di base misurata **~7,5%** a schermo acceso e app ferma

**Audit claims** (header table `:44`; Appendix A `:1041-1042`):
> `cpu7 a 1824000` e la baseline `gpubusy ~7,5%` non esistono in nessun artefatto: compaiono **solo in questo piano**
> `grep -rn 1824000` over the whole repo returns **only the plan**. Denominator `3302400` is real (`results/gpu_xiaomi/device_snapshot.txt:24`) …
> `gpubusy` baseline `~7,5%` … Appears **only in the plan**; the corpus's only archived gpubusy value is `49` …

### 8a — `cpu7 a 1824000`: the audit is wrong

**Exact grep and result** (worktree):

```
grep -rn "1824000" . | wc -l                                   -> 105
grep -c "1824000" analysis/GOVERNOR-DEVICE-PLAN.md             -> 4      (plan self-text)
grep -c "1824000" scratchpad/agents/governor-audit-recheck/REPORT.md -> 1 (this report, excluded below)
… remaining non-plan lines                                    -> 100
  scratchpad  -> 94   (all inside `CPU freqs: …1824000…` lists)
  results     ->  4   (tombstone memory maps, `c1824000-c1824fff`, coincidental)
  archived    ->  2
```

The 94 raw-list hits are Qualcomm reference-board `CPU freqs:` tables (QRD8650/QRD8750, `qdc-governor-s5/raw/sa803*`, `qdc-governor-s5b/raw/sa8125*`, `qdc-apk-smoke-6*/raw/`) — not the Xiaomi. But the two **archived** hits are decisive:

| evidence | file:line | raw value |
|---|---|---|
| the Xiaomi `cpu7` value, with the same `hw_max 3302400` the plan uses | `archived/PLAN-2026-09-full.md:1573` | `Decode 1,11 → 0,32 tok/s con `cpu7 scaling_max` 1824000→1708800 (hw_max 3302400) e Thermal Status 0` |
| the 19/09 Xiaomi cooldown | `archived/PLAN-2026-09-full.md:1599` | `curva di raffreddamento staccato (`xiaomi-cooldown-20260919.txt`, un campione/150 s): 38,5 °C cap 1824000 → 32,1 °C 2169600 → 31,9 °C 2630400 → 30,6 °C 2630400 stabile` |

Commands: `grep -rn "1824000" .`; `grep -rn "1824000" archived/ | grep -v "CPU freqs:"`;
`grep -rln "scaling_max_freq" . | xargs grep -ln "1824000"`.

**Verdict on 8a: REFUTED → AUDIT-ITSELF-WRONG.** The audit's literal claim ("`grep -rn 1824000`
over the whole repo returns only the plan") is false: `grep` returns **105** lines, **100** of them
outside the plan, and `archived/PLAN-2026-09-full.md:1573` records exactly the plan's pairing —
`cpu7 scaling_max 1824000 … hw_max 3302400`. What the corpus still lacks is a **raw sysfs capture**
(`cat /sys/…/cpu7/cpufreq/scaling_max_freq`); the provenance is a diary narrative, not a device
artifact. So the correct status is "narratively sourced, not raw-sourced", not "appears only in the
plan".

**On the task's stated suspect** ("no artifact records it as cpu7 `scaling_max_freq`"): that is also
imprecise — the archived diary line *does* record it as cpu7 `scaling_max` (prose). The precise
statement: no **raw** device artifact records it; a narrative does; and the raw `CPU freqs:` lists
are Qualcomm boards, not the Xiaomi.

### 8b — `gpubusy ~7,5%`: the audit is right

**Exact grep and result:**

```
grep -rn "gpubusy" --include='*.md' --include='*.txt' --include='*.log' --include='*.csv' … .  -> 8 files
grep -rn "gpubusy" . | grep -i "7.5\|7,5"  ->  only analysis/GOVERNOR-DEVICE-PLAN.md:44,708,722,1042
```

The only corpus `gpubusy` value is `~49%` (`scratchpad/agents/n10-kexp-session/REPORT.md:57`),
hand-transcribed, and `scratchpad/agents/n10-kexp-audit/REPORT.md:42,79` marks it
`PLAUSIBLE (unevidenced)` (raw probe output not archived).

**Verdict on 8b: SUPPORTED.** No artifact records a `~7,5%` gpubusy baseline; the value appears only
in the plan. The audit's cross-reference to `n10-kexp-audit/REPORT.md:79` is correct.

**Net for item 8:** one half of the "NON VERIFICABILI" pair is a genuine audit error (the `cpu7`
number has an archived narrative source and 94 raw-list hits, so the audit's "only in the plan" is
flatly wrong); the other half (`gpubusy 7,5%`) stands.

## Finding 9 — the citation drifts in Appendix A finding 9

**Source of record for this item.** The cited sources are not in the lab worktree; they are the app
and engine repos on disk:
`/Users/marco/Projects/kalsa` (`src/engine/governorInputs.ts`, HEAD `745bf82`),
`/Users/marco/Projects/kalsallama` (`src/llama-governor-policy.cpp`, `src/llama-governor-runtime.cpp`,
`src/llama-governor.cpp`, HEAD `8537d097c`), and
`/Users/marco/Projects/llama.rn-kalsa/cpp/rn-llama.cpp` (HEAD `0f313bab`).
Commands: `grep -n "function generationFor\|function gpuFit\|function buildGovernorParams" src/engine/governorInputs.ts`;
`cat -n src/engine/governorInputs.ts | sed -n '58,150p'`;
`grep -n "admit_prefill\|select_decode" src/llama-governor-policy.cpp`;
`grep -rn "prefill_params.n_gpu_layers" $(find /Users/marco/Projects -name rn-llama.cpp)`.

### The six `file:riga` drifts

| # | plan claim | actual (on disk) | audit's correction | verdict |
|---|---|---|---|---|
| 1 | `kalsa/src/engine/governorInputs.ts:60-75` (`analysis/…:113`, `:386`) | `generationFor` is **62-75**; lines 60-61 close `GovernorModel` | 62-75 | SUPPORTED |
| 2 | `governorInputs.ts:78-118` (`:166`) | `gpuFit` is **84-121** (78 is `modelKind`) | 84-121 | SUPPORTED |
| 3 | `governorInputs.ts:120-145` (`:147`) | `buildGovernorParams` is **123-144** | 123-144 | SUPPORTED |
| 4 | `admit_prefill (:180-225)` / `select_decode (:227-252)` (`:430`) | **184-226** / **228-256** | 184-226 / 228-256 | SUPPORTED |
| 5 | `rn-llama.cpp:69` = `n_gpu_layers = 99` (`:348`) | line 69 is not that assignment | 72 / 73 | SUPPORTED with a caveat (below) |
| 6 | `REPORT.md:31-35` "esattamente quei quattro valori" (`:190`) | the four CPU ΔT rows are `:29 (1.900)`, `:31 (3.250)`, `:33 (3.250)`, `:35 (5.150)`; `:32`/`:34` are NPU (1.100 / 2.200) | 29/31/33/35 | SUPPORTED |

Extra confirmations: the prose "lo confronta con **tre** regex" (`:114`) is wrong — `generationFor`
has **six** `.test()` calls (`:64,65,66` on `socModel`; `:71,72,73` on the `modelName/modelId/manufacturer`
fallback). `buildGovernorParams` emits **ten** keys, not the nine of §0.3: the nine fixed keys plus
`...(enabled ? {} : { reason: \`gpu-prefill-incorrect-${generation}\` })` at `:142` — and every device
the plan cares about is disabled, so `reason` is always present.

**Caveat on drift 5:** the audit's replacement lines (`:72` prefill, `:73` decode) match
`/Users/marco/Projects/llama.rn-gate/cpp/rn-llama.cpp:72-73` and
`/Users/marco/Projects/kalsa-fork-switch/node_modules/llama.rn/cpp/rn-llama.cpp:72-73`. The
**pinned engine** in `docs/ALIVE.md:22` (`llama.rn@0f313bab`) sits at
`/Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-llama.cpp` and
`/Users/marco/Projects/llama.rn-kalsa/cpp/rn-llama.cpp`, where the two assignments are at
**`:76` / `:77`** and line 69 is `}`. So the drift is real under every snapshot (plan's `:69` is
never the assignment), but the correct line number is snapshot-dependent.

**On the task's stated suspect** ("the q58 report is
`scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md`, not `q58/REPORT.md`"): the **plan** actually
gives the full path (`analysis/…:189-190`). "`q58 REPORT.md`" is the **audit's** shorthand in
finding 9; it is not a plan error, though it is loose enough to mis-resolve if taken literally.

### The two "supports less than the claim"

- **§0.5, plan `:191-192`** — "usati per prezzare un chunk **GPU** su V75 e V79". The array is
  literally `k_cpu_delta_c` and is indexed at `llama-governor-policy.cpp:200`, `:205` inside
  `admit_prefill`, applying to whichever engine is `requested`; `prefill_engine()` (`:152-173`) picks
  the engine on other grounds. Calling it the price of a *GPU* chunk is imprecise. **Audit correct
  (semantic).**
- **§5.6, plan `:692`** — "il recupero a `llama-governor-policy.cpp:118-121` e' irraggiungibile".
  Lines 118-121 are the CRITICAL→FAST recovery inside the policy, and the policy runs from
  `llama_governor::update_thermal` (`llama-governor-runtime.cpp:189`) each poll, so the path is
  reachable *as policy*. What is unreachable is any *useful* recovery: `fail()` sets
  `failed = true` (`llama-governor.cpp:151-152`) and every later call short-circuits at
  `if (failed) return fail("governor is failed");` (`:163-164`). Also, "il primo **decode**"
  understates: under CRITICAL `admit_prefill` returns `Abort` (`llama-governor-policy.cpp:188-192`),
  so the first *prefill* aborts identically (`llama-governor-runtime.cpp:50-51`). **Audit correct;
  two over-claims in the same paragraph, the fix unaffected.**

**Verdict for finding 9: SUPPORTED.** All six `file:riga` drifts are real and the audit's
replacements are correct (with drift 5 snapshot-dependent); the two prose over-claims are correctly
identified. This is the one appendix finding whose verification required repos outside the lab
worktree.

---

# Summary table

The audited document is `analysis/GOVERNOR-DEVICE-PLAN.md`. "Verdict" = whether the audit's
accusation in the header table / Appendix A survives re-reading against the artifact on disk.

| # | item | audit's accusation | verdict | one-line reconciliation |
|---|---|---|---|---|
| 1 | `0,992` provenance | the "Smentita a verbale" is itself the error; the value **is** the Xiaomi; the named board is wrong too | **SUPPORTED** | `q16-xiaomi/REPORT.md:4,336,378` fixes `0.992` on `houji`/SM8650; the other `0.992` (`qdc-governor-s5/REPORT.md:235`) is QRD8750/Adreno 830. Audit sub-cite of the serial is `:216`, not `:213`. |
| 2 | Part 3.3 Mali state | gates 3 and 4 already ran; owner parked G57; the plan's "half a day" reopens a closed lane | **SUPPORTED** | `q26b-mali-probe/REPORT.md:3,174,268` both gates DONE; `:218-221` post-patch SIGILL/-54; owner park at `docs/ALIVE.md:445` (main) = `archived/ALIVE-2026-09-full.md:445`. Audit cited `:441` → −4. |
| 3 | NPU `ΔT +1,3 °C` | whole-cell rise, not per-engine | **SUPPORTED** | `battery_series.csv:2-6`: `34.2 − 32.9 = +1.3`; HTP reps `32.9→33.3` (+0.4), CPU rep `33.3→34.2` (+0.9). |
| 4 | `Thermal Status 0 in ogni campione` | the census is false: 28 samples read `3` | **SUPPORTED** | Plan `:221-224` is false. Audit's `1263/28/11/9` reproduces only in the **main repo** working tree incl. gitignored files (plan-excluded `grep -rn`); worktree/tracked = `1252/6/4/29`. product-suite `23` = filesystem `-name 'thermal*.txt'`; **tracked = 20**. Audit sub-cite `thermal-retry.txt:10` → `:6`. |
| 5 | 4B thermal deltas | wrong artifact, contaminated source, wrong night | **SUPPORTED** | Six values exact from `task_a_4b_clean/battery_notes.txt` (start `2026-08-13T05:32:25`); cited `task_a/battery_notes.txt` has no 4B pp1024 and its 4B block is `CONTAMINATED_4B.md`. |
| 6 | 18/08 rerun | "10 ripetizioni per verso" is the prefill design, not decode | **SUPPORTED** | `results/gpu_prefill_recheck_xiaomi/report.md:20-32` = pp128 10-rep; `:42` `Decode … 2 interleaved pairs` (`:48-51`). |
| 7 | Mali-G57 `1100 MHz` | MC2 ✓, `1100 MHz` is the wrong number | **SUPPORTED (local) / external UNVERIFIABLE** | MC2 confirmed (`q26-mali-gate:5,69`); local corpus uses `1.0e9 assumed max` and `notebookcheck range 680–1100 MHz` (`q26b:307`). Audit's external URLs not re-fetchable offline. |
| 8a | `cpu7 a 1824000` | "appears **only in this plan**" | **REFUTED → AUDIT-ITSELF-WRONG** | `grep -rn 1824000` = **105** lines, **100** outside the plan (94 raw `CPU freqs:` lists, 4 tombstone addresses, **2 archived diary lines**); `archived/PLAN-2026-09-full.md:1573` records `cpu7 scaling_max 1824000→1708800 (hw_max 3302400)`. What is missing is a **raw** sysfs capture, not the number. |
| 8b | `gpubusy ~7,5%` | appears only in the plan | **SUPPORTED** | `grep -rn "gpubusy"` = 8 files; `7,5%` only at plan `:44,708,722,1042`; corpus's only value is `~49%`, hand-transcribed and already flagged `PLAUSIBLE (unevidenced)` (`n10-kexp-audit/REPORT.md:42,79`). |
| 9 | six citation drifts | `file:riga` off by a few lines; two prose over-claims | **SUPPORTED** | All six drifts real against `/Users/marco/Projects/kalsa` + `/Users/marco/Projects/kalsallama`: `generationFor` 62-75, `gpuFit` 84-121, `buildGovernorParams` 123-144, `admit_prefill` 184-226 / `select_decode` 228-256, CPU ΔT rows 29/31/33/35, `rn-llama.cpp` lines. Drift 5 is snapshot-dependent (pinned engine has 76/77). |

## Known-suspect checks (explicit)

1. **`grep -rn 1824000`** — yes, it matches raw `CPU freqs:` lists under
   `scratchpad/agents/qdc-governor-s5/raw/` (and `qdc-governor-s5b/raw/`,
   `qdc-apk-smoke-6*/raw/`): **94** such lines. It also matches **two archived diary lines** that
   record the Xiaomi `cpu7 scaling_max` value itself, so the task's parenthetical ("no artifact
   records it as cpu7 `scaling_max_freq`") is too strong: no *raw* artifact does, a narrative does.
2. **Thermal Status census vs tracked-files count** — confirmed different. Audit `1263/28/11/9` is a
   full-working-tree count (includes gitignored artifacts) in the main repo, after removing the
   plan's own self-quoting census line; tracked = `1252/6/4/29`; worktree = `1252/6/4/29`.
3. **`product-suite` thermal files** — **20 tracked** (`git ls-files '…/**thermal*'`), **23** on the
   filesystem by `-name 'thermal*.txt'` (the audit's glob). The audit's breakdown
   (21 zeros / one `1` / one `3`) is exact for the 23, not for the 20.
4. **q58 report path** — the **plan** gives `scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md`
   (`analysis/…:189-190`), which is correct; the short form `q58 REPORT.md` is the **audit's**
   shorthand in finding 9 and is not a plan error.

## Scope note

Items 10 and 11 of the appendix ("CONFIRMED — all Part C arithmetic" and "CONFIRMED — the S23
cell") were **not** re-verified in full, as they are outside the nine requested items. The Part C
arithmetic that overlaps item 5/6 was incidentally reproduced and holds (2B deltas `279→290`,
`290→290`, `290→318`, `322→319`, `319→355`, `355→356`; `186.567/58.676 = 3.1796`).

## Files read (paths relative to the worktree unless absolute)

- `analysis/GOVERNOR-DEVICE-PLAN.md`
- `scratchpad/agents/q16-xiaomi/REPORT.md`, `scratchpad/agents/q16-xiaomi-audit/REPORT.md`
- `scratchpad/agents/qdc-governor-s5/REPORT.md`
- `scratchpad/agents/q26-mali-gate/REPORT.md`, `scratchpad/agents/q26b-mali-probe/REPORT.md`,
  `scratchpad/agents/q26e-mali-generation-research/REPORT.md`
- `scratchpad/agents/q58-s23-npu-spike-sweep/REPORT.md`
- `scratchpad/agents/product-suite/**` (thermal artifacts), `scratchpad/agents/n10-kexp-*/REPORT.md`
- `results/htp_prefill/xiaomi_v75/cell1/{battery_series.csv,NOTES.txt,AUDIT-CORRECTIONS.md}`
- `results/xiaomi_ab/task_a/{battery_notes.txt,CONTAMINATED_4B.md}`,
  `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt`
- `results/gpu_prefill_recheck_xiaomi/report.md`
- `docs/ALIVE.md` (worktree), `archived/ALIVE-2026-09-full.md`, `archived/PLAN-2026-09-full.md`
- `/Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/kalsa-the-goal-is-a-governor.md`
- `/Users/marco/Projects/kalsa/src/engine/governorInputs.ts`
- `/Users/marco/Projects/kalsallama/src/{llama-governor-policy.cpp,llama-governor-runtime.cpp,llama-governor.cpp}`
- `/Users/marco/Projects/llama.rn-kalsa/cpp/rn-llama.cpp` (and the `llama.rn-gate` /
  `kalsa-fork-switch` copies)
