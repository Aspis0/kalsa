# Adversarial re-review: docs cleanup fixes

Scope: LAB `governor-audit-recheck` at `effb6b60`, APP
`/Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup` at `2377a7f`, and the active
memory tree plus `memory.bak-20260920`. This review was read-only apart from creating this
report. Verdicts below use only `RESOLVED`, `NOT RESOLVED`, and `NEW ISSUE` for the requested
fixes. `CONFIRMED` is used only for supporting fact checks.

## Executive result

The two LAB archive blobs remain byte-identical. The pin, ancestry, default-off/sensor gate,
owner pointers, memory counts, APP branch counts, pure-rename property, default-model claim,
and archive destinations are confirmed. The re-review is not clean:

- `PLAN.md:48` still says `1112` tracked Markdown files, but the current branch has `1113`.
- `PLAN.md:165-167` still mischaracterizes the `analysis/` directory as dated session records
  plus only two standing references; the governor plan and vendor-migration document are
  additional non-session documents.
- `PLAN.md:108-112` overstates the governor proof by saying nothing in the shipped configuration
  writes the key; the shipped Settings screen does write it when a user toggles the setting.
- The governor document still has Italian in its title and warning (`analysis/GOVERNOR-DEVICE-PLAN.md:1,5`),
  although the newly added audit status line is English.
- The APP table's `kalsa` tracked-file count at `REPOS.md:15` is stale: `3424` is now `3425`
  because `archived/README.md` is tracked.
- An edited active memory index line remains mixed Italian/English at `MEMORY.md:32`; the
  exact historical quotations added to correction blocks are also Italian. The stated language
  exception covers evidence-report quotations and frozen archive blobs, not active memory files.

## 1. LAB living documents and archive fidelity

### 1.1 Freeze fidelity — CONFIRMED

Both archives are still byte-identical to the pre-move blobs. Therefore no byte or line was lost.

```text
$ shasum -a 256 archived/PLAN-2026-09-full.md
ff612f3ae919ed4099a487204efbf72f2eb7d6c73adaa5bb4b43d098e1633b5a  archived/PLAN-2026-09-full.md
$ git show 6fd5a952^:PLAN.md | shasum -a 256
ff612f3ae919ed4099a487204efbf72f2eb7d6c73adaa5bb4b43d098e1633b5a  -
$ cmp -s archived/PLAN-2026-09-full.md <(git show 6fd5a952^:PLAN.md); echo "PLAN cmp exit=$?"
PLAN cmp exit=0
$ shasum -a 256 archived/ALIVE-2026-09-full.md
984f55c8f428fbb27bdc5f2a2520ff2c6889e93de678d44ab78b375fe40a12c3  archived/ALIVE-2026-09-full.md
$ git show 6fd5a952^:docs/ALIVE.md | shasum -a 256
984f55c8f428fbb27bdc5f2a2520ff2c6889e93de678d44ab78b375fe40a12c3  -
$ cmp -s archived/ALIVE-2026-09-full.md <(git show 6fd5a952^:docs/ALIVE.md); echo "ALIVE cmp exit=$?"
ALIVE cmp exit=0
$ git show 6fd5a952^:PLAN.md | wc -l; wc -l < archived/PLAN-2026-09-full.md
    3162
    3162
$ git show 6fd5a952^:docs/ALIVE.md | wc -l; wc -l < archived/ALIVE-2026-09-full.md
    7773
    7773
```

The byte-fidelity language exception is therefore necessary for these two frozen blobs. I accept
that exception; translating them would violate the confirmed freeze.

### 1.2 Requested PLAN fixes

`PLAN.md:15-19` rewords the claim correctly — RESOLVED. The app imports the forked binding and
the missing component is the per-phase governor:

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup show origin/main:package.json | nl -ba | sed -n '47,51p'
    49    "llama.rn": "github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e",
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup grep -n 'from "llama\.rn"' origin/main -- src/engine | head -2
origin/main:src/engine/EmbeddingService.ts:35:import { initLlama } from "llama.rn";
origin/main:src/engine/LlamaService.ts:13:} from "llama.rn";
```

The narrowed two-document rule and archive-language exception at `PLAN.md:44-50` — RESOLVED
semantically. It now explicitly permits `analysis/`, per-cell scratch evidence, and in-place
campaign records. However, the literal count inside that fix is a NEW ISSUE:

```text
$ nl -ba PLAN.md | sed -n '44,50p'
    44  `PLAN.md` and `docs/ALIVE.md` are the only two living documents. Two classes of live record sit
    45  outside `archived/` on purpose: the dated findings and contracts under `analysis/`, and the
    46  per-cell evidence under `scratchpad/agents/`. Every other `.md` is frozen, either under
    47  `archived/` or in place where it was produced (the campaign material under `results/`,
    48  `reports/`, `ops/` and `scratchpad/`). At 2026-09-20 that is 1112 tracked `.md` files outside
    49  `archived/`, `PLAN.md` and `docs/ALIVE.md`.
$ git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l
    1113
```

This count became stale when the prior review report was tracked by `effb6b60`. A literal count
will become stale again when this report is later tracked; the durable fix should be to source the
count with the command or omit it, not simply replace `1112` with `1113`.

The catalog and S23 source pointers at current `PLAN.md:149-154` — RESOLVED. The records exist
and support the narrower wording now used:

```text
$ test -f analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md; echo $?
0
$ nl -ba /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/catalog-gate-threshold-deferred.md | sed -n '8,9p;11p;14,15p'
     8  Owner, 17/09/2026 mattina: *"Soglia modello catalogo salvatelo in memoria ci penseremo un'altra
     9  volta."* Detto dopo una notte di misure che avevano prodotto tutti i dati per costruirla.
    11  **Non implementare il gate di iniziativa.** I numeri esistono e sono nel PLAN del lab (n_ctx deciso
    14  solo la riga di prodotto: quale asse puo' negare un modello e sotto quale soglia d'attesa umana. Quella
    15  riga la scrive l'owner.
$ nl -ba archived/PLAN-2026-09-full.md | sed -n '1659,1660p;2632p;2634p'
  1659  **Serve all'owner:** staccare il cavo dell'S23 (batteria 40 °C a riposo, status 2) e tenerlo scollegato
  1660  e freddo per le campagne; il Jelly sul bus; la soglia di catalogo (8 GB+ su 7 GB) e le notti idle.
  2632  **Da decidere dall'owner (nessuna di queste e' stata toccata):**
  2634  - La soglia di ammissione del catalogo (rinviata dall'owner il 17/09).
```

The S23 source supports an owner request to unplug and cool the phone; it does not independently
prove a broader “blocked measurement lane.” The current PLAN no longer makes that broader claim
and explicitly says no separate decision document exists.

The `PLAN.md:165-167` characterization of `analysis/` — NOT RESOLVED. The disk contains six
files, not four dated-session records plus two standing references:

```text
$ find analysis -maxdepth 1 -type f -name '*.md' -print | sort
analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md
analysis/FORK-VENDOR-MIGRATION.md
analysis/GOVERNOR-DEVICE-PLAN.md
analysis/README-governor-kv-contract.md
analysis/README-qwen-think-replay.md
analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md
$ nl -ba PLAN.md | sed -n '163p;165,167p'
   163  ## Where the record lives
   165  - `analysis/*.md`: dated session records with provenance and verdicts, plus two standing
   166    reference documents, `README-governor-kv-contract.md` (contract) and
   167    `README-qwen-think-replay.md` (procedure).
```

`FORK-VENDOR-MIGRATION.md` is a migration record with an explicit evidence classification, and
`GOVERNOR-DEVICE-PLAN.md` is a plan/audit document. Neither fits the stated “dated session
record” category. The text needs a category for these documents or a file-specific list.

The owner/date pointers at current `PLAN.md:5,14` and `docs/ALIVE.md:5` — RESOLVED. Each points
to `archived/PLAN-2026-09-full.md:1` or `:9`, where the dated owner decision and goal are present.
The provenance-timing rewrite at `PLAN.md:56-58` — RESOLVED: it now requires a command or file
pointer and avoids the former historical assertion that every value was read at a particular time.

```text
$ nl -ba archived/PLAN-2026-09-full.md | sed -n '1p;9p'
     1  Two documents only (owner, 2026-09-09): this plan and docs/ALIVE.md. Everything older is under archived/.
     9  ## Il goal (owner, ripetuto 4/09)
$ rg -n 'Owner decision 2026-09-09' PLAN.md docs/ALIVE.md
PLAN.md:5:Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
docs/ALIVE.md:5:Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
```

The pin and ancestry facts — RESOLVED — are confirmed again:

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup rev-parse origin/main
54297994aa1f8a68f8d6058b8ea705cb1e862d32
$ git -C /Users/marco/Projects/llama.rn-kalsa show 0f313bab:vendor/VERSIONS | rg 'LLAMA_CPP_COMMIT'
LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107
$ git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor 2361be359 8537d097c; echo $?
0
$ git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor 26c7affb7 8537d097c; echo $?
0
$ git -C /Users/marco/Projects/kalsallama reflog show b11010-merge --date=iso | rg 'Created from HEAD|Merge tag' | tail -2
6b6d4a980 b11010-merge@{2026-09-19 11:09:54 -0400}: commit (merge): Merge tag 'b11010' into b11010-merge
2361be359 b11010-merge@{2026-09-19 10:54:32 -0400}: branch: Created from HEAD
```

The governor default-off and `sensor_valid` gate are CONFIRMED, but one sentence over-claims and
is a NEW ISSUE. The key is read as false when absent and the load path requires `sensor_valid`,
but the shipped Settings screen can write the key:

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup grep -n -E 'GOVERNOR_ENABLED_KEY|AsyncStorage\.setItem|sensor_valid|writeGovernorEnabled' origin/main -- src/engine/governorRuntime.ts src/engine/LlamaService.ts src/screens/SettingsScreen.tsx
origin/main:src/engine/governorRuntime.ts:3:export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";
origin/main:src/engine/governorRuntime.ts:17:    const value = await AsyncStorage.getItem(GOVERNOR_ENABLED_KEY);
origin/main:src/engine/governorRuntime.ts:27:    await AsyncStorage.setItem(GOVERNOR_ENABLED_KEY, enabled ? "1" : "0");
origin/main:src/engine/LlamaService.ts:2314:      governorThermo.sensor_valid &&
origin/main:src/screens/SettingsScreen.tsx:60:import { readGovernorEnabled, writeGovernorEnabled } from "../engine/governorRuntime";
origin/main:src/screens/SettingsScreen.tsx:500:    setGovernorEnabled(next);
```

Thus `PLAN.md:108-112` should say “absent by default until the Settings toggle writes it,” or
otherwise scope “configuration” precisely. The default-off conclusion itself is not refuted.

The governor-header fix — NOT RESOLVED as an English-only header. The audit status line at
`:3` is English, but the title and warning remain Italian, and the document itself declares that
its body remains Italian:

```text
$ nl -ba analysis/GOVERNOR-DEVICE-PLAN.md | sed -n '1,5p;17,20p'
     1  # Il governor deve sapere in che telefono sta — piano
     3  > ## UNDER AUDIT — 19/09/2026 — 7 REFUTED, 2 unverifiable, 6 citation drifts
     5  > **Non usare questo documento come fonte senza leggere prima l'[Appendice A](#appendice-a--audit-puntiglioso-del-19092026-deepseek-v41-verbatim).**
    17  > **Body language.** The body of this document is still Italian and is left as-is pending the
    18  > re-verification rewrite by agent `719eb904`; only the header above has been corrected to English.
    20  > Due cose sono successe il 19/09.
```

## 2. Claude memories

### 2.1 Counts, additivity, and corrected facts

The worktree count fix at `kalsa-main-only-since-2026-09-09.md:13-15` — RESOLVED:

```text
$ nl -ba /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/kalsa-main-only-since-2026-09-09.md | sed -n '11,16p'
    13  > On 2026-09-20 `git for-each-ref refs/heads` returns 27 local branches, and
    14  > `git for-each-ref refs/remotes/origin` returns 16 remote branches plus `origin/HEAD`; the repo
    15  > also has 16 registered worktrees.
$ git -C /Users/marco/Projects/kalsa worktree list --porcelain | rg '^worktree ' | wc -l
     16
```

The additive correction and backup requirements — RESOLVED:

```text
$ find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory -maxdepth 1 -type f -name '*.md' | wc -l
    187
$ find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920 -maxdepth 1 -type f -name '*.md' | wc -l
    187
$ rg -l '^## CORRECTION 2026-09-20$' /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory | wc -l
      8
$ comm -3 <(find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory -maxdepth 1 -type f -exec basename {} \; | sort) <(find /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920 -maxdepth 1 -type f -exec basename {} \; | sort)
[no output]
```

The eight changed files are exactly the eight files with the dated correction marker. Their
correction sections say the old text is quoted verbatim, and `MEMORY.md:69-78` visibly contains
the preserved original line. This is additive in the required logical sense: the active claim is
corrected and the replaced text remains in the active correction section; the complete backup is
also still present.

The corrected pin, branch, and lab claims — RESOLVED, with no new false statement found in the
requested corrections:

```text
$ git -C /Users/marco/Projects/kalsa rev-parse origin/main; git -C /Users/marco/Projects/kalsa rev-parse main
54297994aa1f8a68f8d6058b8ea705cb1e862d32
745bf82a056b117718a3f15f0635079188b12c71
$ git -C /Users/marco/Projects/kalsallama rev-parse b11010-merge
8537d097c32e7307d82540b6da8eb448d7e07107
$ git -C /Users/marco/Projects/kalsa-moe-experiments rev-parse main
e495dbe556842d292c0534469c1d3ffe953d5d2e
```

### 2.2 Memory language — NOT RESOLVED

The edited active index still contains Italian prose at `MEMORY.md:32`; this is not merely a
verbatim quote in a correction block. The backup and active lines differ, and the active line
still contains Italian narrative around the corrected commit facts:

```text
$ rg -n -o "non compila|non dimostrabile|leggere l'errore" /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/MEMORY.md
32:non compila
32:non dimostrabile
32:leggere l'errore
$ cmp -s /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory/MEMORY.md /Users/marco/.claude/projects/-Users-marco-Projects-kalsa/memory.bak-20260920/MEMORY.md; echo $?
1
```

The correction blocks also deliberately quote original Italian. I do not treat those active-memory
quotations as covered by the exception stated in the request, because that exception names
evidence reports and frozen archive blobs only. Either the exception must explicitly include
historical quotation blocks in active memories, or those quoted blocks and the edited index prose
must be translated while retaining the original in the backup.

## 3. APP repository

### 3.1 Renames, body preservation, and references

The 16 moves remain pure renames — RESOLVED:

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup diff --name-status -M 5429799..2377a7f | rg '^R100' | wc -l
16
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup diff --name-status 2377a7f^ 2377a7f -- archived
A       archived/README.md
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup diff --numstat 2377a7f^ 2377a7f -- archived ':!archived/README.md'
[no output]
```

I also compared every moved source blob at `5429799` with its destination at `2377a7f`; the
verification produced `hash mismatches: none`. The latest commit added only the archive guide
under `archived/`; it did not rewrite a frozen body.

The moved-file reference fix — RESOLVED. A basename search finds expected references in frozen
documents and the explicit mapping in `archived/README.md`; no live document contains a stale
`docs/<moved-file>` path. The live references point to `archived/...`, and the old paths are
absent:

```text
$ for p in docs/ENERGY-FRAMEWORK-STATUS.md docs/ENERGY-PERPHASE-FINDINGS.md docs/NGRAM-SPEC-FINDINGS.md docs/CORE-PLACEMENT-PILOT-2026-09-16.md docs/S23-ENERGY-BLOCKER.md; do test -e "/Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup/$p" && echo "$p: EXISTS" || echo "$p: MISSING"; done
docs/ENERGY-FRAMEWORK-STATUS.md: MISSING
docs/ENERGY-PERPHASE-FINDINGS.md: MISSING
docs/NGRAM-SPEC-FINDINGS.md: MISSING
docs/CORE-PLACEMENT-PILOT-2026-09-16.md: MISSING
docs/S23-ENERGY-BLOCKER.md: MISSING
$ nl -ba /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup/archived/README.md | sed -n '15,23p'
    15  Documents here therefore reference pre-move paths. When a path in this directory does not
    16  resolve, prefix it with `archived/`: a `docs/X.md` is now `archived/docs/X.md`, and a root
    17  `ENERGY-*.md` is now `archived/ENERGY-*.md`.
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup grep -n -E 'docs/(ENERGY-FRAMEWORK-STATUS|ENERGY-PERPHASE-FINDINGS|NGRAM-SPEC-FINDINGS|CORE-PLACEMENT-PILOT-2026-09-16|S23-ENERGY-BLOCKER)\.md' HEAD -- ':!archived/**'
HEAD:README.md:59:See [`archived/docs/ENERGY-FRAMEWORK-STATUS.md`](archived/docs/ENERGY-FRAMEWORK-STATUS.md).
HEAD:docs/KV-WINDOW-AND-THERMAL-2026-09-17.md:184:`archived/docs/CORE-PLACEMENT-PILOT-2026-09-16.md` measured core placement on the Jelly
```

The frozen-body references are intentional historical paths and are now documented by the new
archive guide; they are not a silent content rewrite.

### 3.2 APP facts

The `REPOS.md:11` four-live correction — RESOLVED. The table lists four live repositories and
one archived repository. The branch count at `REPOS.md:22-25` — RESOLVED:

```text
$ nl -ba /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup/REPOS.md | sed -n '3p;11p;15,18p'
     3  Five repositories carry Kalsa. **Four** are live as of 17/09 — `Aspis0/llama.rn` came back —
    11  ## The four live ones
    15  | **`Aspis0/kalsa`** (public) | the React Native app — this repository | 3.424 | 15,76 MiB |
    16  | **`Aspis0/kalsallama`** (private) | the engine: our fork of `ggml-org/llama.cpp` | 3.664 | 525 MiB |
    17  | **`Aspis0/kalsa-moe-experiments`** (private) | the lab: the two living docs, measurements, device evidence | 50.900 | 530 MiB |
    18  | **`Aspis0/llama.rn`** (public) | the React Native binding fork — read its section before assuming it is dead | — | — |
```

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup for-each-ref --format='%(refname)' refs/heads | wc -l
27
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup for-each-ref --format='%(refname)' refs/remotes/origin | rg -v '/HEAD$' | wc -l
16
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup for-each-ref --format='%(refname)' refs/remotes/origin | wc -l
17
```

The default model correction — RESOLVED. The registry marks LFM2.5 2.6B as the sole default and
the user-facing answer names it, with Qwen 3.5 4B as the alternative.

```text
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup show HEAD:src/engine/ModelRegistry.ts | nl -ba | sed -n '270p;273p'
   270      // Registry default: every boot-loop fallback lands here, and a fallback a
   273      default: true,
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup show HEAD:src/domain/askAssistant.js | nl -ba | sed -n '30p;33p'
    30      id: "chat-model",
    33        "The local engine (llama.cpp) runs on this device. Phase 1 ships LFM2.5 2.6B by default, with Qwen 3.5 4B as an alternative.",
```

The file-count part of the corrected facts is a NEW ISSUE:

```text
$ nl -ba /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup/REPOS.md | sed -n '13,18p'
    13  | repo | what it is | tracked files | pack |
    15  | **`Aspis0/kalsa`** (public) | ... | 3.424 | 15,76 MiB |
$ git -C /Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup ls-files | wc -l
    3425
$ git -C /Users/marco/Projects/kalsallama ls-files | wc -l
    3664
$ git -C /Users/marco/Projects/kalsa-moe-experiments ls-files | wc -l
   50900
```

The `kalsallama` and lab figures match. The APP figure does not: `archived/README.md` added one
tracked file after the prior `3424` check. The archive targets themselves exist and are the
correct destinations:

```text
$ for p in archived/ENERGY-2B-SELF-AUDIT-2026-09-15.md archived/ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md archived/docs/ENERGY-FRAMEWORK-STATUS.md archived/docs/ENERGY-PERPHASE-FINDINGS.md archived/docs/NGRAM-SPEC-FINDINGS.md archived/docs/CORE-PLACEMENT-PILOT-2026-09-16.md archived/docs/S23-ENERGY-BLOCKER.md; do test -f "/Users/marco/.paseo/worktrees/1vffp1wo/app-docs-cleanup/$p" && echo "$p: yes" || echo "$p: NO"; done
archived/ENERGY-2B-SELF-AUDIT-2026-09-15.md: yes
archived/ENERGY-V3-CAMPAIGN-AUDIT-2026-09-16.md: yes
archived/docs/ENERGY-FRAMEWORK-STATUS.md: yes
archived/docs/ENERGY-PERPHASE-FINDINGS.md: yes
archived/docs/NGRAM-SPEC-FINDINGS.md: yes
archived/docs/CORE-PLACEMENT-PILOT-2026-09-16.md: yes
archived/docs/S23-ENERGY-BLOCKER.md: yes
```

## 4. Language rule

The governing rule is `/Users/marco/Projects/kalsa/AGENTS.md:7-9`: documentation and agent
artifacts must be English; Italian is reserved for direct conversation.

I accept the requested exception for verbatim historical quotations in evidence reports and for
the two byte-frozen archive blobs. The inventory report explicitly labels its Italian as verbatim
historical quotation, and its surrounding narrative is English. I do not extend that exception to
ordinary narrative in an edited plan or to active-memory correction prose without an explicit
scope change.

The new `PLAN.md` and `docs/ALIVE.md` narrative is English — RESOLVED. Their only language
mentions are metadata describing the frozen archive language. The inventory report is also
RESOLVED under the stated evidence-quotation exception.

The governor document is NOT RESOLVED: `analysis/GOVERNOR-DEVICE-PLAN.md:1,5,17-20` retains
Italian title/warning/body in an edited document, despite the English status line at `:3`. The
body is not a frozen archive blob and is not only a quotation.

The active-memory language fix is NOT RESOLVED under the exception as written: the edited
`MEMORY.md:32` is mixed-language narrative, and the additive correction blocks contain Italian
historical text. See §2.2.

## 5. Ordered required fixes

1. Remove or command-source `PLAN.md:48`; the current count is `1113`, and committing this
   report would change it again.
2. Rewrite `PLAN.md:165-167` to classify all six `analysis/` documents accurately.
3. Narrow `PLAN.md:108-112` so it says the governor is false by default but can be enabled and
   persisted by the Settings toggle; retain the `sensor_valid` gate.
4. Make the entire edited governor header English, including its title and Appendix warning, or
   explicitly freeze/reclassify the document before relying on an archive-language exception.
5. Update `REPOS.md:15` from `3.424` to the current `3425` value, or make the file-count source
   explicit and deliberately snapshot it.
6. Translate the edited active-memory narrative at `MEMORY.md:32`, and either translate the
   Italian text in additive correction blocks or explicitly extend the quotation exception to
   active memories while keeping the original text preserved.
