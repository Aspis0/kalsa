# Docs & repo cleanup — inventory and contradiction register

**Agent:** Explorer (read-only). **Working dir:** `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck`
(worktree of `kalsa-moe-experiments`, HEAD `e495dbe5`).
**Method:** every statement below was read off the disk with the command shown; nothing was
repeated from a document's own claim without a disk check. No file was edited, deleted or pruned;
no `adb`, no `git fetch`, no `git pull`, no `git gc`/`prune`.
**All times local (EDT) unless marked UTC.**

> **Moving target, flagged up front.** The audit brief's snapshot of the app repo is one commit
> behind the disk. The brief says *"the app's LOCAL `main` is `e7712de`, 4 behind `origin/main`
> `5429799`, with `scripts/device-ciswire-cache.sh` modified and uncommitted"*. On disk at
> 20/09 08:14 that script **is committed** as `1cac31ff`
> (`git show --stat 1cac31ff` → `scripts/device-ciswire-cache.sh | 30 ++++`), local `main` is
> **`1cac31ff`**, and the working tree is **clean** (`git status --porcelain` → 0 lines). The
> local/remote divergence (ahead 1 / behind 4) is real and is registered in §C.

---

## Summary table — the ten worst contradictions

| # | Where | What it says | Disk truth | Severity |
|---|---|---|---|---|
| 1 | `PLAN.md:1591` (and `:1597`) | the OpenCL MoE fix is on `opencl-moe-masks` only, pin is `e8505ca2` which "porta lo stesso difetto", push "sara' un fast-forward" | the two fix commits `2361be359` + `26c7affb7` are **ancestors of `8537d097c` = `b11010-merge`**, which IS the shipped engine pin. Fix shipped. | **critical** |
| 2 | `MEMORY.md:4` + `MEMORY.md:9` | "il fix OpenCL MoE e' FUORI dal pin sul ramo `opencl-moe-masks`" / "NON e' nel pin" | same as #1 — fix is in the pin | **critical** |
| 3 | `fork-opencl-moe-kernel-does-not-compile.md:157-162` | "STATO AL 20/09 … **NON sono in `b11010-merge`** … il fix NON e' nel motore che spediamo" | same as #1; also the shas it cites as dead (`d92645703`/`634cfaf85`) are correctly dead, but its own replacement claim is false | **critical** |
| 4 | `governor-plan-is-unparked-but-its-numbers-are-not.md:34` | "il fix del kernel OpenCL MoE … **non e' nel pin**" | same as #1 | **critical** |
| 5 | `GOVERNOR-DEVICE-PLAN.md:3` vs `:24-30` | header "**6 REFUTED**" | its own table lists **7** REFUTED rows (`:24-30`, verdicts 1-7) and the appendix has 7 `### N. REFUTED` headings (`:860,873,885,892,899,906,913`) | high |
| 6 | `GOVERNOR-DEVICE-PLAN.md:3` "PARCHEGGIATO" vs `MEMORY.md:9` / `governor-plan-is-unparked-…md` | doc says the governor plan is parked; memory says it is **un-parked** ("SPARCHEGGIATO") | both cannot be current; the park order is `GOVERNOR-DEVICE-PLAN.md:9` (owner, 19/09); the un-park reasoning is in the memory only | high |
| 7 | `MEMORY.md:4` | "**tutti i repo puliti e pushati**" | `kalsa` local main diverged (ahead 1/behind 4, `git status --short --branch`); `llama.rn-kalsa` 2 untracked (`pnpm-lock.yaml`, `pnpm-workspace.yaml`); `kalsallama` 2 untracked (`CMakeUserPresets.json`, `pkg-snapdragon/`) | high |
| 8 | `ARCHITECTURE.md:9-12` | `main` is `0bfe985`, `origin/main` `16ba535`, plus `feat/moe-stream`, `chore/repo-reorg-v2` | `main` `1cac31ff`, `origin/main` `5429799`; neither feature branch exists (`git branch -a`) | high |
| 9 | `REPOS.md:22` | "`kalsa` … Branches: `main` and `remote-brain`" | 26 local branches, 17 remote (`git for-each-ref refs/heads`, `refs/remotes/origin`) | high |
| 10 | app `README.md:17` | links `docs/RESEARCH_CONTEXT_LOSS.md` | file does not exist; it is `archived/docs/RESEARCH_CONTEXT_LOSS.md` | medium |

---

## A. Living docs

Probe used for language (`lang()` in the session log): per-line count of unambiguous Italian
markers (`perche`, `perché`, `più`, `della`, `delle`, `nella`, `sono`, `questo`, `questa`,
`abbiamo`, `misurato`, `verificato`, `giorno`, …). Ratio = marker lines / non-blank lines.

| doc | lines | last commit | language | claims living? |
|---|---|---|---|---|
| lab `PLAN.md` | 3162 | `e495dbe5` 2026-09-20 | **Italian** (867/2678 = 32 %) | yes — `PLAN.md:1` |
| lab `docs/ALIVE.md` | 7773 | `e495dbe5` 2026-09-20 | **English prose + Italian table rows** (1347/6863 = 20 %; head `ALIVE.md:1-25` English, the big cell table e.g. `ALIVE.md:474-493` Italian) | yes — `ALIVE.md:1` |
| lab `analysis/GOVERNOR-DEVICE-PLAN.md` | 1041 | `84bc8288` 2026-09-19 | **Italian** (252/788 = 32 %) | no (referenced as "the device plan" by `PLAN.md:17`) |
| lab `analysis/FORK-VENDOR-MIGRATION.md` | 2288 | `62208468` 2026-09-20 | English (one Italian owner quote at `:3`) | no |
| lab `analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` | 144 | `b85402fb` 2026-09-19 | English | no |
| lab `analysis/README-governor-kv-contract.md` | 269 | `e8fa3f5f` 2026-09-19 | English | no |
| lab `analysis/README-qwen-think-replay.md` | 156 | `8f7816a0` 2026-09-18 | English | no |
| lab `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` | 102 | `e495dbe5` 2026-09-20 | English | no |
| app `AGENTS.md` | 15 | `a53b884` 2026-09-16 | English | names the two living docs |
| app `ARCHITECTURE.md` | 79 | `38b5cf0` 2026-09-18 | English | no |
| app `REPOS.md` | 115 | `38b5cf0` 2026-09-18 | English | names the two living docs |
| app `README.md` | 103 | `0efea91` 2026-09-16 | English | no |
| lab `README.md` | 81 | `71ff0a36` 2026-09-09 | English | points at the two living docs (`README.md:3-9`) |
| app `docs/README.md` | 26 | `59e0e2a` 2026-09-17 | English | says this dir is NOT the living docs |

**Italian docs the owner now wants in English:** `PLAN.md`, `analysis/GOVERNOR-DEVICE-PLAN.md`.
`AGENTS.md:7-9` already mandates English for all docs, so `PLAN.md` and
`GOVERNOR-DEVICE-PLAN.md` violate the project's own rule. `docs/ALIVE.md` is mixed: English
narrative, Italian table rows — I cannot tell whether the owner intends those rows to be
translated; that needs an owner decision.

### A1. The OpenCL MoE claim — exact evidence

Disk truth, all verified read-only:

```
cd /Users/marco/Projects/kalsallama
git merge-base --is-ancestor 2361be359 8537d097c   # → exit 0  (2361be359 IS ancestor)
git merge-base --is-ancestor 26c7affb7 8537d097c   # → exit 0  (26c7affb7 IS ancestor)
git reflog show b11010-merge --date=iso | tail -1
# 2361be359 b11010-merge@{2026-09-19 10:54:32 -0400}: branch: Created from HEAD
```
- `8537d097c` = `b11010-merge` HEAD = `origin/b11010-merge` = **the engine pin**.
- `opencl-moe-masks` HEAD = `2361be359`, created 19/09 08:47; `b11010-merge` was branched
  **from that HEAD at 10:54:32** and then merged tag `b11010` (`6b6d4a980`) on top of it.
- Commit dates: `2361be359` 19/09 08:47:25; `6b6d4a980` (merge) 19/09 11:09:54; `8537d097c`
  19/09 17:14:35.

```
cd /Users/marco/Projects/llama.rn-kalsa
git show 0f313bab:vendor/VERSIONS | grep LLAMA_CPP_COMMIT
# LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107
```
- `0f313bab` is `origin/vendor-migration` and is the **pin of `kalsa` `origin/main`**
  (`kalsa` `origin/main:package.json:49` → `github:Aspis0/llama.rn#0f313bab…`).
- `kalsa` local `main` pins `95c3493b` (`package.json:49` at `1cac31ff`), and `95c3493b`'s own
  commit message is *"build(engine): kalsallama 2361be359 — the q4_K MoE OpenCL kernels build
  again"*.
- Vendored kernel files carry the mask-as-arguments form (6-arg call) at **both** shipped pins:
  `git show 0f313bab:vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl`
  → `get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2)` at `:99` and `:219`;
  same in `gemm_moe_q4_k_q8_1_dp4a.cl:142`, `gemm_moe_q4_k_f32_ns.cl:250`. Identical at
  `95c3493b` under `cpp/ggml-opencl/kernels/`.

**How many places say the opposite (fix not in the pin / pin carries the defect):**

| # | place | status |
|---|---|---|
| 1 | `PLAN.md:1591` — "Pin: `package.json:49` punta al fork `e8505ca2` (porta lo stesso difetto) … il push del fix sara' un fast-forward di `kalsa`" | **written as current state (19/09 08:23 status block), now false** |
| 2 | `PLAN.md:1597` — "fork `kalsa` = `origin/kalsa` = `485519fe`, pin app `e8505ca2`" | current-state block (08:36), now false |
| 3 | `docs/ALIVE.md:22` — "`llama.rn@e8505ca2` (kalsallama `237461a98`)" | dated 18/09 section; historically true, never updated |
| 4 | `docs/ALIVE.md:699` — "MUL_MAT_ID Q4_K con 73 FAIL numerici = kernel MoE Adreno del pin **ROTTO**" | dated cell; true for that old pin |
| 5 | `docs/ALIVE.md:7507` — "`step5-bump` (pin `e8505ca2`)" | dated |
| 6-7 | `MEMORY.md:4` (two clauses: "FUORI dal pin", and the pin named `0f313bab`) + `MEMORY.md:9` | memory — see §D |
| 8 | `MEMORY.md:32` (index bullet: "19/09 08:23 fix in kalsallama ramo `opencl-moe-masks` (d92645703, 634cfaf85), audit in corso") | memory; shas dead, state stale |
| 9 | `fork-opencl-moe-kernel-does-not-compile.md:157-162` | memory |
| 10 | `governor-plan-is-unparked-….md:34` | memory |

**Doc count: 5 doc places (2 in `PLAN.md` presented as live, 3 in `ALIVE.md` date-stamped and
stale) + 5 memory places (`MEMORY.md:4` twice, `MEMORY.md:9`, `MEMORY.md:32`,
`fork-opencl-moe-kernel-does-not-compile.md:157-162`, `governor-plan-is-unparked-….md:34`).**
`PLAN.md` never records the pin bump at all: `grep -n "0f313bab"`
and `grep -n "95c3493b"` and `grep -n "vendor-migration"` over `PLAN.md` and `docs/ALIVE.md`
return **zero matches**. The vendor migration that closed on 19/09 night is documented only in
`analysis/FORK-VENDOR-MIGRATION.md` and in memory. `GOVERNOR-DEVICE-PLAN.md:850` cites
`kalsallama@2361be359` — i.e. it used the fix commit correctly — so it is not part of the
false-claim set.

### A2. Other contradictions inside the living docs

- **`GOVERNOR-DEVICE-PLAN.md:3`** — *"PARCHEGGIATO — 19/09/2026 — e sotto audit: 6 REFUTED, 2
  non verificabili, 6 derive di citazione"*. Its own summary table (`:24-30`) has **7** REFUTED
  rows (numbers 1-7), and the appendix has **7** REFUTED headings (`:860, :873, :885, :892,
  :899, :906, :913`). The header undercounts by one.
- **Parked vs un-parked.** `GOVERNOR-DEVICE-PLAN.md:3` and `:9` say the owner suspended the
  governor work ("metti da parte il governor…"). `FORK-VENDOR-MIGRATION.md:7-8` says "The
  governor is parked". `MEMORY.md:9` and `governor-plan-is-unparked-…md:1,12-14` say the
  parking condition has **fallen** ("dal 20/09 quella condizione e' soddisfatta") and the
  governor work "si puo' riprendere". No doc on the disk records the un-park; `PLAN.md:17`
  sits in between ("il piano vive in un file suo … Si segue li'").
- **`PLAN.md:1597`** — "app main = `edc6c2d` = origin/main pulito; lab pushato". True on
  19/09 08:36, false now (local `main` `1cac31ff`, ahead 1/behind 4; see §C).
- **`PLAN.md:168`** — a relative link `../../kalsa-wt-mergetest/src/engine/ModelRegistry.ts`.
  `/Users/marco/kalsa-wt-mergetest` does not exist (`ls -d` → No such file or directory).
  Broken link.
- **`analysis/README-governor-kv-contract.md:3-5, :8`** — *"Line numbers pinned to: Aspis0/kalsa
  @ `c7e3f9c`; Aspis0/llama.rn @ `485519fe` (branch `v0129-on-gate`); kalsallama pin:
  `237461a98…`"* and *"This document is re-pinned whenever either tree moves"*.
  Disk: `v0129-on-gate` is **`95c3493b`** (`git rev-parse v0129-on-gate`), not `485519fe`
  (which is the local `kalsa` branch head); `kalsallama` `main`/`origin/main` is now
  **`2361be359`**, one commit past `237461a98`; `kalsa` has moved on. The re-pin promise is
  unkept.
- **`analysis/FORK-VENDOR-MIGRATION.md:1291`** — "The app today runs `kalsallama@2361be35`".
  True for the local `main` pin `95c3493b`; false for `origin/main` pin `0f313bab` =
  `8537d097c`. Pedantically true, practically ambiguous; flag for a dated fix.
- **`ARCHITECTURE.md:9-12` and `:19-20`**: branch table stale (see summary #8), and the "Engine
  assembly" section still describes the **flatten** method (`cpp/` = kalsallama flattened,
  `${RNLLAMA_LIB_DIR}/../../../native/bmoe`, `scripts/sync-kalsallama.sh … pin/bump/verify`).
  Disk at the fork's `origin/vendor-migration` (`0f313bab`) uses the **`vendor/` layout**
  (`vendor/VERSIONS`, `vendor/llama.cpp/…`) and `kalsa` `origin/main` deleted `native/bmoe/`
  (`git ls-tree --name-only origin/main native/` → `native/GovernorBatteryModule.kt` only).
  `FORK-VENDOR-MIGRATION.md:26` states the layout change explicitly.
- **`ARCHITECTURE.md:68-70`** lists `docs/KALSA.md`, `docs/HARNESS_FINDINGS.md`,
  `docs/KNOWN_ISSUES.md` as **current** entry points. `ls docs/` → none of the three exist;
  all three are under `archived/docs/`.
- **App `README.md:12,25`** — "**Qwen 3.5 4B** (default)" and Gemma 4 E2B in the model list.
  Disk: `src/engine/ModelRegistry.ts:273` sets `default: true` on `lfm2.5-2.6b`
  (`src/engine/ModelRegistry.ts:241`); the only two registry LLMs are `qwen3.5-4b` (`:183`)
  and `lfm2.5-2.6b` (`:241`). **No Gemma entry.** `README.md:17` links
  `docs/RESEARCH_CONTEXT_LOSS.md`, which does not exist (it is archived).
- **`REPOS.md`** — multiple stale facts, all verified:
  - `:22` "Branches: `main` and `remote-brain`" → 26 local / 17 remote (see §C).
  - `:27` "the fork's `cpp/` is `kalsallama` flattened" → superseded by `vendor/`
    (`FORK-VENDOR-MIGRATION.md:26`).
  - `:34` "`kalsallama` … One branch, `main`" → 5 local branches incl. `b11010-merge`
    (`git branch`); `main` is `2361be359` but HEAD is `8537d097c` on `b11010-merge`, 210 ahead.
  - `:81-82` "`llama.rn` … Remote branches: `kalsa`, `kalsa-step1`, `main`" → also
    `origin/vendor-migration`; `origin/kalsa` = `0f313bab`, not the old `kalsa@485519fe`.
  - `:88` "the fork's own `scripts/sync-kalsallama.sh` is where the engine is re-flattened
    now" → the vendor migration retired the flatten (`FORK-VENDOR-MIGRATION.md`; commit
    `0a9b9379 build(engine): pin 8537d09 …`, `2f1996d4 feat(vendor): re-point the engine pin at
    the kalsallama fork`).
  - `:93` "`Aspis0/kalsa` carries six: `main`, `remote-brain`, `brain`, `chat`, `llama-rn-fork`,
    `baseline-67c73d26c`" → `origin` also carries `kv-hold-budget`, `kv-hold-protocol`,
    `kv-land`, `kv-marker-migration`, `kv-residuals`, `pin-bump-vendor-migration`,
    `protocol-abc`, `qwen-think-in-history`, `step5-bump`, `wip/ciswire-corpus`.
  - `:13-18` file/pack counts: kalsa 4.033 → `git ls-files | wc -l` = **3449**; kalsallama
    3.570 → **3664**; lab 50.869 → **50900**. (`REPOS.md:9` itself says "Every number below
    was read from the repositories" — they are stale.)
  - Counts that still hold: archive tags kalsa **19**, kalsallama **21**, forkbigmoeonedge
    **10**, llama.rn **4** (`git tag -l 'archive/*' | wc -l` in each).
  - `:96-105` "three local clones point at `Aspis0/kalsa` and all call their branch `main`" —
    **verified true**: `crescent-chat` → `origin/chat`, `kalsa-brain` → `origin/brain`, both
    `git remote -v` → `https://github.com/Aspis0/kalsa.git`.

---

## B. Frozen / stray docs

Project rule (`PLAN.md:1`, `ALIVE.md:1`, `AGENTS.md:3-6`, `docs/README.md:3-11`): exactly two
living docs (`PLAN.md`, `docs/ALIVE.md`), every other `.md` frozen under `archived/`.

### B1. Lab repo (`kalsa-moe-experiments`)

| item | count | disposition | note |
|---|---|---|---|
| `docs/ALIVE.md` | 1 | **KEEP (living)** | §A |
| `PLAN.md` | 1 | **KEEP (living)** | §A |
| `README.md` | 1 | KEEP | points at the two living docs |
| `analysis/*.md` | 6 | mixed → see below | |
| `analysis/*.py` | 3 | KEEP | `f56_analyze.py`, `gguf_dump_analyze.py`, `qwen_think_replay_probe.py` — tooling, not docs |
| `archived/PLAN-archive.md` | 9610 lines | ARCHIVE | frozen diary |
| `archived/docs/` | 41 entries (38 `.md`, 3 subdirs: `archive/`, `handoff/`, `repo-audit-2026-08-28/`) | ARCHIVE | frozen, last touched `71ff0a36` 2026-09-09 |
| `archived/mandates/` | 42 `.md` | ARCHIVE | frozen mandate briefs |

`analysis/*.md` dispositions:
- `FORK-VENDOR-MIGRATION.md` — **KEEP** (current; the authoritative record of the vendor
  migration, updated 20/09).
- `CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` — **KEEP** (dated one-doc record, referenced
  from `PLAN.md:20` / `ALIVE.md`).
- `XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` — **KEEP** (same pattern).
- `README-qwen-think-replay.md` — **KEEP** (how to run the probe; still the only doc for it).
- `README-governor-kv-contract.md` — **UPDATE or ARCHIVE**: current as a contract, but its
  pinned line numbers are stale (§A2). If the governor is un-parked it should be re-pinned; if
  not, ARCHIVE.
- `GOVERNOR-DEVICE-PLAN.md` — **UPDATE or ARCHIVE**: header self-declares the body unusable
  (`:3, :14-16`), the audit count is wrong, and the park/un-park conflict is unresolved. Do
  not leave it as a silent "KEEP".

### B2. App repo (`kalsa`)

| item | count | disposition | note |
|---|---|---|---|
| root `ENERGY-*.md` | **11** (brief says 13 — corrected) | ARCHIVE | all 11 are dated audits 11-16/09, last commit `5221650`/`c45fd1f` etc.; none referenced by the product |
| root `KV-REUSE-PATCH-AUDIT-2026-09-11.md`, `P0-P1-KV-EMA-AUDIT-2026-09-11.md` | 2 | ARCHIVE | stray dated audits at root, no index entry |
| `docs/*.md` | 8 | mixed → below | |
| `archived/` | `FINAL_REPORT.md`, `FINAL_SUMMARY.md`, `HYBRID_RANKING_REPORT.md`, `docs/` (43 entries) | ARCHIVE | frozen `f5da438` 2026-09-09 |
| `AGENTS.md` | 1 | **KEEP** | agent rules, current |
| `ARCHITECTURE.md` | 1 | **UPDATE** | engine/CI sections superseded by the vendor layout (§A2) |
| `REPOS.md` | 1 | **UPDATE** | several stale counts/branches (§A2) |
| `README.md` | 1 | **UPDATE** | wrong default model, dead doc link, Gemma entry (§A2) |

App `docs/*.md` dispositions (all eight are English):
- `README.md` — **KEEP** (index; correctly says this dir is not the living docs).
- `ENERGY-SCHEMA.md` — **KEEP** (metric contract, still cited by the energy scripts).
- `ENERGY-FRAMEWORK-STATUS.md` — **UPDATE or ARCHIVE** (calls itself "the recovery point for the
  energy work", `:1`; its "working branch is now main, `origin/main` at the same commit" is a
  16/09 snapshot). Under the two-doc rule it is a dated finding → ARCHIVE unless the energy
  work is still live.
- `ENERGY-PERPHASE-FINDINGS.md`, `S23-ENERGY-BLOCKER.md`, `CORE-PLACEMENT-PILOT-2026-09-16.md`,
  `NGRAM-SPEC-FINDINGS.md` — **ARCHIVE** (dated findings, frozen; the index already calls them
  findings).
- `KV-WINDOW-AND-THERMAL-2026-09-17.md` — **KEEP or ARCHIVE**: dated finding, but it records the
  LFM2 conclusion that the memory index still cites (`MEMORY.md:32` line on slide cost).

**Note:** under the stated rule ("every other `.md` is frozen under `archived/`") the app's
`ENERGY-*.md` (11) at root, `KV-REUSE-PATCH-AUDIT-*`, `P0-P1-KV-EMA-AUDIT-*` and most of
`docs/*.md` are **rule violations by location**, not by age. Moving them is a destructive-ish
`git mv` — owner approval needed (§E).

---

## C. Repo state

### C1. Four repos, HEAD vs origin, dirt, branches

| repo | HEAD | branch | `origin/main` | ahead/behind | dirty/untracked |
|---|---|---|---|---|---|
| `~/Projects/kalsa` | `1cac31ff0a8162f26f5ef814fe42c33d525b79fd` | `main` | `54297994aa1f8a68f8d6058b8ea705cb1e862d32` | **behind 4, ahead 1** (diverged) | **none** (`git status --porcelain` = 0) |
| `~/Projects/kalsallama` | `8537d097c32e7307d82540b6da8eb448d7e07107` | `b11010-merge` | `2361be35970dfd3cf5f83f5c11381cc00bb491b1` | behind 0, **ahead 210** | 2 untracked: `CMakeUserPresets.json`, `pkg-snapdragon/` |
| `~/Projects/llama.rn-kalsa` | `0f313bab464ef28a58a8b4b2a37a5d4c1968b54e` | `vendor-migration` | `baf1f3d1d33b447d35b1783cc98b1f7768fe0740` | behind 0, **ahead 81** | 2 untracked: `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| `~/Projects/kalsa-moe-experiments` | `e495dbe556842d292c0534469c1d3ffe953d5d2e` | `main` | `e495dbe5…` | 0/0 (clean, pushed) | none |

Remote tip cross-checks:
- `kalsallama`: `origin/b11010-merge` = `8537d097c` (pushed); `origin/opencl-moe-masks` does
  **not** exist — that branch is local only, but its tip `2361be359` = `origin/main`.
  Local `main` = `origin/main` = `2361be359` (0/0).
- `llama.rn-kalsa`: `origin/vendor-migration` = `0f313bab` (pushed); `origin/kalsa` =
  `0f313bab` too; `origin/main` = `baf1f3d1`, 81 behind `vendor-migration`.
  Local `kalsa` = `485519fe` — a **stale** branch pointer (behind `origin/kalsa` by 81).
- App local branches NOT in `origin/main`, not pushed: `protocol-abc` (`870b9d7`, but
  `origin/protocol-abc` = same sha → pushed), `remote-brain` (`ce71e78`, pushed),
  `kv-hold-budget`/`kv-hold-protocol`/`kv-land`/`kv-residuals`/`qwen-think-in-history`/
  `baseline-67c73d26c` (all pushed under the same name), plus local-only
  `anchored-floor`, `evict-marker`, `gate-ndk-app`, `governor-kv-contract`,
  `kv-land-rebase-trial`, `llama-rn-fork`, `log-privacy`, `persist-guard`,
  `qwen-think-older-turns`, `save-wiring-coverage`, `t20c-jelly`, `t20c-thermal-aware` —
  every one of these is **already an ancestor of `origin/main`** (`git merge-base
  --is-ancestor <b> origin/main` → yes), i.e. merged stale pointers, safe to delete after
  approval.
- App branches **not merged into `origin/main`**: `main` (`1cac31ff`, diverged),
  `baseline-67c73d26c` (`3ce0992`), `kv-hold-budget` (`a5389d2`), `kv-hold-protocol`
  (`9a2cd9c`), `kv-land` (`6db7263`), `kv-residuals` (`9a2cd9c`), `qwen-think-in-history`
  (`346debd`), `protocol-abc` (`870b9d7`), `remote-brain` (`ce71e78`).
- `kalsallama` local branches not merged into `b11010-merge`: `mtp-ctx-other` (`284ea0f08`),
  `bump-rehearsal-tmp` (`50a00c78e`).

**The app's local `main` is a divergent line of history.** `e7712de` (local) and `50b8196`
(origin) forked; local `main` carries `1cac31ff` on top of the *old* single-tree layout
(`native/bmoe/` still present, `git merge-base --is-ancestor e7712de HEAD` → true), while
`origin/main` went to the vendored layout with pin `0f313bab` (`5429799`). A plain
`git pull` would merge/collide; do not touch it (brief's instruction), but the owner must
decide whether to `git rebase`/reset local `main` onto `origin/main` or keep `1cac31ff` as a
patch to be re-applied.

### C2. Worktree inventory

**`kalsa` (integration branch = `origin/main` = `5429799`):**

| path | branch/detached | in `origin/main`? | note |
|---|---|---|---|
| `/Users/marco/Projects/kalsa` | `main` `1cac31ff` | **no** (diverged) | the app checkout |
| `/private/tmp/blb-rebase-trial` | detached `fe3a474` | **no** | dir exists; a trial checkout |
| `/private/tmp/kv-rebase-trial` | `kv-land-rebase-trial` `87b36f8` | yes | dir exists; merged |
| `/Users/marco/.paseo/worktrees/1vffp1wo/remote-brain` | `remote-brain` `ce71e78` | **no** | live Paseo worktree |
| `kalsa-anchored-audit` | `anchored-floor` `bf9156c` | yes | merged |
| `kalsa-evict-marker` | `evict-marker` `429cd92` | yes | merged |
| `kalsa-fork-switch` | `gate-ndk-app` `3cabcf1` | yes | merged |
| `kalsa-governor-kv` | `governor-kv-contract` `c7e3f9c` | yes | merged |
| `kalsa-log-privacy` | `log-privacy` `9b08ae0` | yes | merged |
| `kalsa-persist-guard` | `persist-guard` `c45f044` | yes | merged |
| `kalsa-protocol-abc` | `protocol-abc` `870b9d7` | **no** | WIP branch per `PLAN.md:1595` |
| `kalsa-qwen-older` | `qwen-think-older-turns` `9f96a45` | yes | merged |
| `kalsa-save-wiring` | `save-wiring-coverage` `c7e3f9c` | yes | merged |
| `kalsa-t20c` | `t20c-thermal-aware` `7d607c8` | yes | merged |
| `kalsa-t20c-jelly` | `t20c-jelly` `edc6c2d` | yes | merged |

`git worktree list` for `kalsa` reports exactly these 15; none is marked `prunable`.

**`kalsallama` (integration branch = `origin/main` = `2361be359`, or the newer
`b11010-merge` = `8537d097c`):**

| path | HEAD | merged into `b11010-merge`? | note |
|---|---|---|---|
| `/Users/marco/Projects/kalsallama` | `8537d097c` (`b11010-merge`) | — | engine checkout |
| `/private/tmp/upmerge` | `3f3558b3b` detached | yes | **`prunable`** — the directory does **not** exist (`ls -d` → No such file or directory) |
| `/Users/marco/kalsa-mac/kalsallama-67c73d26c` | `67c73d26c` detached | yes | |
| `kalsallama-wt-750kit-12f6d9b` | `12f6d9b6d` detached | yes | |
| `kalsallama-wt-750kit-2f3b24d` | `2f3b24dee` detached | yes | |
| `kalsallama-wt-accprobe` | `eefa27e30` detached | **no** | orphan branch point |
| `kalsallama-wt-f32mul` | `33c3817c4` detached | yes | |
| `kalsallama-wt-f32mul-gov` | `513bf4cea` detached | yes | |
| `kalsallama-wt-f32mul-q4k` | `67c73d26c` detached | yes | |
| `kalsallama-wt-governor` | `1a33da0f6` detached | **no** | |
| `kalsallama-wt-governor-v03` | `5f0701dac` detached | **no** | |
| `kalsallama-wt-kvpressure` | `32282997e` detached | yes | |
| `kalsallama-wt-oclbase` | `a0cabca6b` detached | yes | |
| `kalsallama-wt-oclpicks-25910` | `2f3b24dee` detached | yes | |
| `kalsallama-wt-opencl` | `12f6d9b6d` detached | yes | |
| `kalsallama-wt-phase-stamps` | `2998ad5d6` detached | yes | |
| `kalsallama-wt-upstream` | `64a155d24` detached | yes (also in `origin/main`) | upstream master for bisect |

Count in `~/Projects`: 14 `kalsallama-wt-*` dirs (all from the list above except
`kalsa-mac/kalsallama-67c73d26c`), all of them detached HEADs.

**`llama.rn-kalsa` (integration branch = `origin/vendor-migration` = `0f313bab`):**

| path | branch | in `origin/vendor-migration`? | note |
|---|---|---|---|
| `/Users/marco/Projects/llama.rn-kalsa` | `vendor-migration` `0f313bab` | yes | |
| `/private/tmp/lrn-step1` | `kalsa-step1` `4b823e95` | **no** | **`prunable`** — directory does **not** exist |
| `/Users/marco/Projects/llama.rn-gate` | `gate-ndk` `91bdb5d0` | yes | |

**`kalsa-moe-experiments`:** 2 worktrees (`main` `e495dbe5`; this audit
`governor-audit-recheck` `e495dbe5`), both at the same sha, nothing prunable.

### C3. Flagged dirs, retired paths, submodules

- `/private/tmp/blb-rebase-trial` — **exists**, registered worktree, detached `fe3a474`,
  neither in `origin/main` nor in local `main`.
- `/private/tmp/kv-rebase-trial` — **exists**, `kv-land-rebase-trial` `87b36f8`, merged.
- `/private/tmp/upmerge` — registered worktree of `kalsallama`, **`prunable`**, directory
  missing (already gone; only the registration is stale).
- `/private/tmp/lrn-step1` — registered worktree of `llama.rn-kalsa`, **`prunable`**,
  directory missing.
- `kalsallama-wt-*` (14 dirs) — all pre-existing scratch checkouts; 11 fully reachable from
  `b11010-merge`, 3 orphaned branch points (`accprobe`, `governor`, `governor-v03`).
- `kalsa-*` in `~/Projects` — 14 dirs; 11 are registered worktrees of `kalsa`
  (`kalsa-anchored-audit`, `kalsa-evict-marker`, `kalsa-fork-switch`, `kalsa-governor-kv`,
  `kalsa-log-privacy`, `kalsa-persist-guard`, `kalsa-protocol-abc`, `kalsa-qwen-older`,
  `kalsa-save-wiring`, `kalsa-t20c`, `kalsa-t20c-jelly`);
  `kalsa-brain` and `kalsa-device-build` are **separate repos/clones**, and
  `kalsa-moe-experiments` is the lab repo itself, not a worktree.
- **Retired `kalsa-engine/`** — untracked build turd in the lab repo, 0 tracked files
  (`git ls-files kalsa-engine` → 0), content is only `kalsa-engine/build-android/…`, ignored
  by `build-*/` in the lab `.gitignore:18`. `git status --porcelain --ignored` →
  `!! kalsa-engine/`. Safe candidate to delete, but it is a working tree of the retired
  BigMoeOnEdge engine build; **needs owner approval**.
- **Retired `BigMoeOnEdge/`** — still a **tracked gitlink** in the lab repo
  (`git ls-files -s BigMoeOnEdge` → `160000 e1123289b40134562beee99018cc554daff24d2d`),
  declared in `.gitmodules:1-3` with url
  `https://github.com/Aspis0/kalsa-forkbigmoeonedge.git`; `.git` is
  `gitdir: ../.git/modules/BigMoeOnEdge`. It carries 44 tags, 10 `archive/*`. Removing or
  de-initialising it is destructive for provenance (`REPOS.md:71-73` says the PC campaign
  binary came from it) — **owner approval only**.
- **`deps/opencl-android/OpenCL-Headers`** — a nested checkout with **no submodule mapping**;
  `git submodule status` in the lab repo exits 128 with
  `fatal: no submodule mapping found in .gitmodules for path 'deps/opencl-android/OpenCL-Headers'`.
  `.gitmodules` only declares `BigMoeOnEdge`. This breaks `git submodule status`/`foreach` for
  the whole lab repo — a real, fixable papercut (`deps/vulkan-android` is similarly present).

---

## D. Claude memories

Root: `/Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/` — **187 files, all
`.md`** (`ls | wc -l` = 187; `~/Projects/kalsa-moe-experiments` lab repo has no copy).
Times below are file mtimes; the two memory files at the centre of this audit were both
written/modified **20/09 07:06** (`ls -lt`).

### D1. Duplicate / superseded set

| group | files | relation |
|---|---|---|
| **git-status snapshot** | `context-git-status-snapshot-goes-stale.md` (105 lines, 19/09) ⊃ `context-snapshots-go-stale.md` (30 lines, 16/09) | The 16/09 file is a strict subset of the 19/09 one (same 16/09 `patches/llama.rn+0.12.8.patch` anecdote; the 19/09 file adds the remote, writer and reader forms). **`context-snapshots-go-stale.md` is superseded → DELETE-CANDIDATE; keep the 19/09 file, update its dead `patch-package` example.** |
| **dated state** | `state-2026-09-01.md`, `state-2026-09-09.md`, `state-2026-09-14.md`, `state-2026-09-16.md` | Each is a compressed status snapshot superseded by the next; `state-2026-09-09.md:3` says so itself ("superato da state-2026-09-14"). `state-2026-09-16.md:3,:11` claims "LEGGERE PRIMO" but describes T20C as "not yet launched", which happened on 19/09 (`PLAN.md:1603`). **Archival: keep only if `state-2026-09-14` + `state-2026-09-16` are marked ARCHIVE and removed from the "Stato (leggere prima)" list in `MEMORY.md:6`.** |
| **repo map** | `kalsa-repo-map.md` vs app `REPOS.md` | `kalsa-repo-map.md:3` itself says the canonical map is `REPOS.md`. The memory still carries the **old paths** `Kalsa/ai-chat`, `moe-experiments/BigMoeOnEdge`, `BigMoeOnEdge/third_party/llama.cpp` (`:30-33`) and "l'app ne ha sei" (`:15`). **UPDATE (strip the stale table; point at `REPOS.md`) — and `REPOS.md` itself needs updating (§A2).** |
| **engine migration** | `kalsa-kalsallama-migration-state.md` | Already marked `SUPERSEDED 18/09` at `:11`; still cites `native/kalsallama.pin` and `vendor/kalsallama-cpp` (`:31`) which no longer exist. **KEEP as history (already flagged), or DELETE-CANDIDATE.** |
| **MoE port** | `kalsa-moe-stream-port.md` | Already marked `SUPERSEDED 18/09` at `:11-14`; still says `native/bmoe/` "resta valido" (`:14`), and `native/bmoe` is retired in the vendor layout. **UPDATE the residual clause.** |
| **legacy dir** | `legacy-memory-kalsa-dir.md` | Points at `C:\Users\gualt\Desktop\Kalsa` / `C:\Users\gualt\.claude\...` (`:11-12`). On this Mac there is **no** such directory; the project path prefix is `~/.claude/projects/-Users-marco-Projects-kalsa` (`ls -d ~/.claude/projects/*kalsa*`). **Contradicted by disk → UPDATE or ARCHIVE.** |
| **fork migration** | `llama-rn-fork-migration-state.md` | Current, but one bump stale (§D2). **UPDATE.** |

### D2. Memories whose factual claim is contradicted by disk

**(a) The OpenCL MoE fix is in the pin — two memories + the index.**

`fork-opencl-moe-kernel-does-not-compile.md:157-162`, verbatim:

> **STATO AL 20/09, verificato sul disco (non dalla memoria):** il fix esiste nel fork
> `kalsallama` sul ramo **`opencl-moe-masks`** — `2361be359` … e `26c7affb7` …
> **NON sono in `b11010-merge`**, e il pin dell'app e' `LLAMA_CPP_COMMIT=8537d097c` = proprio
> `b11010-merge`: quindi **il fix NON e' nel motore che spediamo**.

Disk truth (commands in §A1): `2361be359` and `26c7affb7` **are** ancestors of `8537d097c`;
`b11010-merge` was **created from `2361be359`** at 19/09 10:54:32; `vendor/VERSIONS@0f313bab`
names `8537d097c`; the vendored kernels carry the mask-as-arguments form. The
"verificato sul disco" label is false.

`governor-plan-is-unparked-but-its-numbers-are-not.md:33-35`, verbatim:

> Il blocco hardware vero, misurato il 20/09: il fix del kernel OpenCL MoE q4_K sta sul ramo
> `opencl-moe-masks` di kalsallama e **non e' nel pin**

Same disk truth. Weaker form (the parenthetical does not name a pin state) but still wrong.

`MEMORY.md`, two places:
- `MEMORY.md:4`: "… e il fix OpenCL MoE e' **FUORI dal pin** sul ramo `opencl-moe-masks`".
- `MEMORY.md:9`: "… e il fix del kernel OpenCL MoE **NON e' nel pin** (ramo `opencl-moe-masks`),
  quindi GPU+MoE col governor muore ancora al load".
- `MEMORY.md:32`: "19/09 08:23 fix in kalsallama ramo `opencl-moe-masks` (d92645703, 634cfaf85),
  audit in corso" — both shas are dead (rewritten 19/09 08:47, see the file's own `:162`).

All four statements now contradict the disk.

**(b) Governor plan: parked vs un-parked, and 6 vs 7 REFUTED.**

`governor-plan-is-unparked-but-its-numbers-are-not.md:2-3` (description) and `:12-14`
("Quella condizione e' caduta il 20/09 … Il governor si puo' riprendere") say the plan is
un-parked. `GOVERNOR-DEVICE-PLAN.md:3` says `PARCHEGGIATO` and `:9` quotes the suspend order.
The memory's "**6 REFUTED**" (`:3, :18, :29`) is copied from the doc's own wrong header; disk
(`:24-30`, `:860-913`) shows **7**. So the memory is *doubly* wrong: it repeats the mis-count
and it asserts an un-park that no doc records.

**(c) "tutti i repo puliti e pushati".**

`MEMORY.md:4`: *"…strumento KV riparato, **tutti i repo puliti e pushati**"*. Disk: three of
four repos are not clean/pushed (§C1). Also `MEMORY.md:4` says "**kalsa main `5429799`**",
which is `origin/main`; the local checkout's `main` is `1cac31ff`.

**(d) `kalsa-repo-map.md` old paths.** `:30-33` table: `Kalsa/ai-chat`,
`moe-experiments/BigMoeOnEdge`, `BigMoeOnEdge/third_party/llama.cpp`. Disk: those paths do not
exist; the app is `~/Projects/kalsa`, the lab `~/Projects/kalsa-moe-experiments`, the engine
`~/Projects/kalsallama` (the memory says so itself at `:20`). Also `:15` "l'app ne ha sei" —
17 remote/tracked branches now.

**(e) `kalsa-main-only-since-2026-09-09.md`.** `:3` "the app repo has **ONE branch, main**";
`:13` table `kalsa | main, remote-brain | 19`; `:29` "All `kalsa-wt-*` worktrees removed".
Disk: 26 local / 17 remote branches; 15 registered worktrees. `:13` says `kalsallama | main`
— disk has 5 local branches. The memory is flatly contradicted.

**(f) `llama-rn-fork-migration-state.md:25,27`.** ":25 `kalsa/native/bmoe/` e' CANCELLATO" and
":27 `kalsa` main **50b8196**". Disk: on `origin/main` `native/bmoe/` is indeed gone
(`git ls-tree --name-only origin/main native/` → only `GovernorBatteryModule.kt`) and `50b8196`
is in `origin/main`; but the **working checkout** at `~/Projects/kalsa` still has
`native/bmoe/` (`ls native/` → `GovernorBatteryModule.kt  bmoe`; `native/bmoe/rn/bmoe_stream.cpp`
exists) because local `main` is the diverged old-layout line. So the memory is right about
`origin` and wrong about the tree an agent will actually open. `:27` "kalsa main 50b8196" is
now `5429799` on `origin` and `1cac31ff` locally.

**(g) `kalsa-kalsallama-migration-state.md:31`** — pin `a0cabca6b`, `native/kalsallama.pin`,
`vendor/kalsallama-cpp`. The file already says SUPERSEDED (`:11`), so this is a flagged
historical record, not a live claim. Noted for completeness.

**(h) `a-log-line-is-an-api-when-instruments-parse-it.md`**, `:1`… "CHIUSA su main `5429799`".
`5429799` is `origin/main` — still true. No contradiction.

**(i) Self-labelled stale snapshots**: `state-2026-09-16.md:3,:11` "LEGGERE PRIMO" + the claim
T20C was not launched (disk: launched and stopped 19/09, `PLAN.md:1603`) and its
"File non committati" list (disk: those files are committed). Stale, but explicitly a
snapshot — the fix is to demote it from the index, not to rewrite it.

**(j) Not verifiable / out of scope**: device, adb, QDC, channel, and Mac-sleep memories
(`adb-*`, `jelly-*`, `qdc-*`, `s23-*`, `opencl*`, `mac-must-never-sleep`, `lenovo-remote-access`,
…) make no claim I can check from this machine without touching the phone or the network;
the brief forbids `adb`. I did not attempt to verify them. Command that would be needed, e.g.:
`adb -s 192.168.1.152:43089 shell getprop ro.product.model` — **not run**.

---

## E. Proposed disposition

Legend: **KEEP** (leave), **UPDATE** (correct text), **ARCHIVE** (`git mv` under `archived/`),
**DELETE-CANDIDATE** (propose only, never execute). "Risk" = what breaks if wrong.

### E1. Docs — safe (no history lost; `git mv`/text edits only)

| item | disposition | one-line rationale | risk |
|---|---|---|---|
| lab `PLAN.md` | **UPDATE** | remove/correct `:1591,:1597` pin claims, add the vendor-migration line, decide Italian→English | low; it is the authoritative doc, so wrong text propagates |
| lab `docs/ALIVE.md` | **UPDATE** | add a 19-20/09 pin/vendor entry; decide fate of the Italian table rows | low |
| lab `analysis/GOVERNOR-DEVICE-PLAN.md` | **UPDATE** (header `6`→`7`, park status) or **ARCHIVE** | self-declared unusable body; parked/un-parked unresolved | medium if ARCHIVEd while the governor is live |
| lab `analysis/README-governor-kv-contract.md` | **UPDATE** (re-pin) or ARCHIVE | re-pin promise violated | medium |
| lab `analysis/FORK-VENDOR-MIGRATION.md` | **KEEP** | the only complete record of the current layout; `:1291` sentence worth a dated note | low |
| lab `analysis/CISWIRE-*.md`, `XIAOMI-*.md`, `README-qwen-think-replay.md` | **KEEP** | current dated records referenced by PLAN/ALIVE | low |
| lab `archived/**` (41 + 42 + `PLAN-archive.md`) | **KEEP frozen** | already archived; rule satisfied | none |
| app `AGENTS.md` | **KEEP** | current, and it is the English-language rule | low |
| app `ARCHITECTURE.md` | **UPDATE** | branch table + flatten→vendor + dead entry-point docs | medium — agents route by it |
| app `REPOS.md` | **UPDATE** | branch counts, file counts, flatten→vendor; keep the archive-tag counts | medium |
| app `README.md` | **UPDATE** | default model LFM2.5-2.6B; drop Gemma; fix dead `RESEARCH_CONTEXT_LOSS.md` link | high-visibility (public repo) |
| app `docs/README.md` | **KEEP** | correct index | low |
| app `docs/ENERGY-SCHEMA.md` | **KEEP** | live contract, cited by scripts | medium if archived |
| app `docs/ENERGY-FRAMEWORK-STATUS.md` | **ARCHIVE** (or UPDATE if energy work is live) | dated "recovery point", self-contradicting "working branch" line | medium |
| app `docs/{ENERGY-PERPHASE-FINDINGS,NGRAM-SPEC-FINDINGS,CORE-PLACEMENT-PILOT-*,S23-ENERGY-BLOCKER}.md` | **ARCHIVE** | dated findings; rule says frozen | low |
| app `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md` | **KEEP** (or ARCHIVE) | still cited by memory as the LFM2 slide result | low |
| app root `ENERGY-*.md` (11) + `KV-REUSE-PATCH-AUDIT-*`, `P0-P1-KV-EMA-AUDIT-*` | **ARCHIVE** (`git mv` to `archived/`) | violate the two-doc rule by location, not by age | low |
| app `archived/**` | **KEEP frozen** | already archived | none |

### E2. Repo / branch / worktree — **destructive, owner approval required**

| item | disposition | rationale | risk |
|---|---|---|---|
| app local `main` `1cac31ff` (ahead 1 / behind 4) | **KEEP as-is, decide later** | it is a divergent line on the retired layout; the `1cac31ff` patch (`CW_CORPUS`) may still be wanted; `scripts/device-ciswire-cache.sh` is now committed, so nothing is lost by waiting | high if reset carelessly — `reflog` is the only safety net |
| app merged stale branches (12: `anchored-floor`, `evict-marker`, `gate-ndk-app`, `governor-kv-contract`, `kv-land-rebase-trial`, `llama-rn-fork`, `log-privacy`, `persist-guard`, `qwen-think-older-turns`, `save-wiring-coverage`, `t20c-jelly`, `t20c-thermal-aware`) | **DELETE-CANDIDATE** | every tip is an ancestor of `origin/main`; no commit unique | low, but unrecoverable without reflog if a tip is wrongly judged merged |
| app unmerged branches (`baseline-67c73d26c`, `kv-hold-budget`, `kv-hold-protocol`, `kv-land`, `kv-residuals`, `qwen-think-in-history`, `protocol-abc`, `remote-brain`) | **KEEP** | each carries commits not in `origin/main`; all are pushed | high if deleted |
| `llama.rn-kalsa` local `kalsa` `485519fe` | **DELETE-CANDIDATE** | stale pointer; `origin/kalsa` = `0f313bab` | low |
| `kalsallama` `mtp-ctx-other`, `bump-rehearsal-tmp` | **KEEP pending review** | not merged into `b11010-merge`; pushed, so recoverable | medium |
| `kalsallama` `opencl-moe-masks`, `main` | **KEEP** | `opencl-moe-masks` == `origin/main`; `main` == `origin/main` | low |
| `/private/tmp/upmerge` worktree registration | **PRUNE-CANDIDATE** (`git worktree prune`) | directory already gone; registration stale | low — but brief forbids pruning; owner must run it |
| `/private/tmp/lrn-step1` worktree registration | **PRUNE-CANDIDATE** | directory already gone | low |
| `/private/tmp/blb-rebase-trial` (detached `fe3a474`) | **KEEP pending review** | unique commit not in `origin/main`; owner may still want it | medium |
| `/private/tmp/kv-rebase-trial` (`kv-land-rebase-trial` `87b36f8`) | **DELETE-CANDIDATE** | merged into both `origin/main` and local `main` | low |
| 3 orphaned `kalsallama-wt-*` (`accprobe`, `governor`, `governor-v03`) | **KEEP pending review** | commits not reachable from `b11010-merge` | medium |
| 11 merged `kalsallama-wt-*` + `kalsa-mac/kalsallama-67c73d26c` + `kalsallama-wt-upstream` | **DELETE-CANDIDATE** (worktree removal + dir) | all reachable from `b11010-merge`; pure scratch | low |
| app worktree dirs `kalsa-{anchored-audit,evict-marker,fork-switch,governor-kv,log-privacy,persist-guard,qwen-older,save-wiring,t20c,t20c-jelly}` | **DELETE-CANDIDATE** | branches merged into `origin/main` | low |
| `kalsa-protocol-abc`, paseo `remote-brain` worktrees | **KEEP** | unmerged branches | high if removed |
| lab `kalsa-engine/` | **DELETE-CANDIDATE** | untracked, all contents gitignored (`build-*/`), 0 tracked files | low (build tree only) |
| lab `BigMoeOnEdge/` submodule (gitlink `e1123289b`, `.gitmodules:1-3`) | **KEEP** | tracked provenance for the campaign binary; removing needs a plan | high |
| lab `deps/opencl-android/OpenCL-Headers` nested checkout | **FIX `.gitmodules`** (add mapping or `git rm --cached`) | breaks `git submodule status` for the whole repo | medium |
| app `native/bmoe/` (present only on the diverged local `main`) | **KEEP** | it is what local `main` compiles; disappears when local `main` is reconciled | high if deleted while local `main` is checked out |

### E3. Memory — correction, not deletion

| item | disposition | rationale |
|---|---|---|
| `fork-opencl-moe-kernel-does-not-compile.md` `:157-162` | **CORRECT** | replace the closing paragraph with the disk truth (ancestry proof in §A1); keep the kernel analysis, which is correct |
| `governor-plan-is-unparked-but-its-numbers-are-not.md` `:2,3,18,29,34` | **CORRECT** | `6`→`7` REFUTED; fix the "not in the pin" sentence; mark the un-park as an owner-level question, not a fact |
| `MEMORY.md` `:4`, `:9`, `:32` | **CORRECT** | the index repeats the wrong claim twice and carries dead shas; also fix "tutti i repo puliti e pushati" and "kalsa main `5429799`" (say `origin/main`) |
| `kalsa-repo-map.md` `:15,30-33` | **CORRECT** | drop the old-path table, point at `REPOS.md` |
| `kalsa-main-only-since-2026-09-09.md` `:3,13,29` | **CORRECT** | the "ONE branch" claim is false; either mark the whole file ARCHIVE/HISTORY or update |
| `llama-rn-fork-migration-state.md` `:27` | **CORRECT** | `kalsa` main is `origin/main 5429799` / local `1cac31ff`; keep `:25` but scope it to `origin` |
| `context-snapshots-go-stale.md` | **DELETE-CANDIDATE** | strict subset of `context-git-status-snapshot-goes-stale.md` |
| `context-git-status-snapshot-goes-stale.md` | **CORRECT** | still the right lesson; its `patch-package`/`patches/llama.rn+0.12.8.patch` example is dead (app uses the git-dep; `patches/` does not exist) |
| `kalsa-kalsallama-migration-state.md`, `kalsa-moe-stream-port.md` | **CORRECT residual clause** (or DELETE-CANDIDATE) | already flagged SUPERSEDED; only `kalsa-moe-stream-port.md:14` ("`native/bmoe/` resta valido") is a live-sounding stale clause |
| `legacy-memory-kalsa-dir.md` | **CORRECT or ARCHIVE** | Windows paths; no such dir on this Mac |
| `state-2026-09-14.md`, `state-2026-09-16.md` (and `-09-01`, `-09-09`) | **ARCHIVE the 09-14/09-16 pair; keep the older two as history** | remove them from `MEMORY.md:6`'s "leggere prima" list |
| everything else (device, QDC, Mac, channel memories) | **KEEP** | not verifiable from here; no contradiction found in the greps above |

---

## Appendix — commands that produced the key numbers

```
# ancestry of the OpenCL fix
cd ~/Projects/kalsallama
git merge-base --is-ancestor 2361be359 8537d097c    # 0
git merge-base --is-ancestor 26c7affb7 8537d097c    # 0
git reflog show b11010-merge --date=iso | tail -1
git log -1 --format='%H %ad %s' --date=iso 8537d097c 2361be359

# shipped pins and vendored kernel form
cd ~/Projects/llama.rn-kalsa && git show 0f313bab:vendor/VERSIONS | grep LLAMA_CPP_COMMIT
git show 0f313bab:vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl | grep -n get_scale_min_k4
git show 95c3493b:cpp/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl | grep -n get_scale_min_k4
cd ~/Projects/kalsa && git show origin/main:package.json | grep llama.rn && git show HEAD:package.json | grep llama.rn

# repo state / divergence
for r in kalsa kalsallama llama.rn-kalsa kalsa-moe-experiments; do (cd ~/Projects/$r && git rev-parse HEAD && git status --short --branch && git worktree list); done
git rev-list --left-right --count origin/main...HEAD     # per repo

# worktree merge test
cd ~/Projects/kalsa && git worktree list --porcelain | awk '/^worktree /{p=$2} /^HEAD /{h=$2} ...'
# for each worktree sha: git merge-base --is-ancestor "$h" origin/main

# memory greps
d=~/.claude/projects/-Users-marco-Projects-kalsa/memory
ls "$d" | wc -l                                    # 187
grep -rn -iE "puliti e pushati|FUORI dal pin|NON e' nel pin" "$d"
grep -n -E "STATO AL 20/09|NON sono in" "$d/fork-opencl-moe-kernel-does-not-compile.md"
grep -n -E "6 REFUTED|non e' nel pin" "$d/governor-plan-is-unparked-but-its-numbers-are-not.md"
```

**Not verified (and why):** anything device- or network-side — `adb`, QDC sessions, GitHub
archive status of `kalsa-forkbigmoeonedge`, package/pack sizes on GitHub. The brief forbids
`adb`; the rest would need network calls I did not make. Where a claim needed one of those, the
report says so rather than guessing.
