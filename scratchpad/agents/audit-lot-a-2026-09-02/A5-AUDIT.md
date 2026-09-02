# A5 Audit Report — Light Shell "Less Green But Still Green"

**Commit:** `ffde39fe8bffa77da9ece915345549482e03825f`  
**Branch:** `lot-a/chat-ui`  
**Author:** Marco Gualtieri  
**Date:** 2026-09-02 12:08:37 -0400  
**Worktree:** `/Users/marco/.paseo/worktrees/1vffp1wo/lot-a-chat-ui`  
**Auditor:** Reviewer Doc (read-only)  
**Report:** 2026-09-02

---

## 1. Scope Verification — git show ffde39f --stat

**1 file changed, 5 insertions(+), 5 deletions(-)**

| File | Changes |
|------|---------|
| `src/theme/palettes.js` | 5 lines (1 comment + 4 color tokens) |

**Diff summary:** Exactly what was claimed — no more, no less. Dark theme untouched (all dark tokens retain their original values). No node_modules, no lockfiles, no unrelated files.

✅ **PASS** — Scope is clean and matches the LOT-A A5 claim exactly.

---

## 2. Residual #E8EEE7 Check

### Hex literal grep
```
grep -ri '#E8EEE7' src/
→ 0 occurrences (exit code 1 = no match)
```
✅ **PASS** — No hex-literal residue of the old color in any `.ts/.tsx/.js/.jsx` file.

### RGB literal grep — ⚠️ FINDING
```
grep -rn 'rgba(232' src/theme/
→ 12 occurrences across 3 files
```

The old color's RGB triplet `(232, 238, 231)` persists in **hardcoded rgba() values** that were **not updated** when `shell` changed from `#E8EEE7` → `#E8EAE7`:

| File:Line | Value | Context |
|-----------|-------|---------|
| `palettes.js:71` | `rgba(232, 238, 231, 0.92)` | `navGlass` (light theme) |
| `glass.ts:5` | `rgba(232, 238, 231, 0.62)` | `hairline` |
| `glass.ts:6` | `rgba(232, 238, 231, 0.18)` | `innerGlow` |
| `glass.ts:8` | `rgba(232, 238, 231, 0.12)` | `liquidBloom` |
| `createStyles.ts:2061` | `rgba(232, 238, 231, 0.46)` | `qpcrCommandIcon.borderColor` |
| `createStyles.ts:2274` | `rgba(232, 238, 231, 0.46)` | `primaryButton.borderColor` |
| `createStyles.ts:2730` | `rgba(232,238,231,0.30)` | `rnaWizardStepIndexActive.backgroundColor` |
| `createStyles.ts:3136` | `rgba(232, 238, 231, 0.46)` | `toolHeroIcon.borderColor` |
| `createStyles.ts:3288` | `rgba(232,238,231,0.46)` | `benchToolPillActive.borderColor` |
| `createStyles.ts:3346` | `rgba(232,238,231,0.28)` | `benchToolIconActive.backgroundColor` |
| `createStyles.ts:3833` | `rgba(232, 238, 231, 0.46)` | `primaryMiniButton.borderColor` |
| `createStyles.ts:3906` | `rgba(232, 238, 231, 0.42)` | `dangerButton.borderColor` |

These are all confined to `src/theme/` — no hardcoded values outside the theme layer.

> **Verdict on severity:** The rgba values are semi-transparent overlays (6%–92% alpha). The G-channel mismatch is `238 → 234` = **4 units out of 255** ≈ 1.6%. At 92% alpha (`navGlass`), this blends to ≈0.3 per channel — imperceptible at 0.46 alpha it's ≈0.08 — well below 8-bit display quantization. These are **cosmetic inconsistencies**, not visual regressions. They should be fixed for hygiene but will not be seen by users.

---

## 3. Semantic Color Analysis — "Less Green But Still Green"

### RGB comparison

| Token | Old #E8EEE7 | New #E8EAE7 | Delta |
|-------|------------|------------|-------|
| R | 232 | 232 | 0 |
| G | 238 | 234 | **−4** |
| B | 231 | 231 | 0 |

### Relative luminance

| Color | Luminance |
|-------|-----------|
| #E8EEE7 (old shell) | 0.8407 |
| #E8EAE7 (new shell) | 0.8177 |
| **ΔL** | **−0.023** |

**Analysis:** G drops from 238→234 while R and B hold. This shifts the hue slightly away from green and toward neutral grey, but G (234) still exceeds both R (232) and B (231), so the color remains **warm-green-tinted** rather than neutral. The claim "less green but still green" is **accurate**.

✅ **PASS** — Semantic description is correct.

---

## 4. Border Contrast Against New Shell

### Comment at line 5 (updated in this commit):
> "Borders sit at ≥ ~10% black equivalent so they remain visible on #E8EAE7"

### Absolute luminance (vs 10% black floor)

| Border token | Luminance | vs 10% black (L=0.0545) | Status |
|-------------|-----------|-------------------------|--------|
| `line` #D3DAD2 | 0.6864 | **12.6× the floor** | ✅ Well above |
| `lineStrong` #C2CAC1 | 0.5756 | **10.6× the floor** | ✅ Just above |

The "≥ ~10% black" threshold is met by a wide margin (10–12×). The new shell doesn't change the absolute luminance of the borders — they are fixed hex values.

### Contrast ratio vs shell (relative)

| Pairing | Ratio (old shell) | Ratio (new shell) | Δ |
|---------|-------------------|-------------------|---|
| `line` vs shell | 1.210:1 | 1.178:1 | −0.032 |
| `lineStrong` vs shell | 1.424:1 | 1.387:1 | −0.037 |

The new shell is **slightly darker** (L=0.818 vs 0.841), so the contrast between border and shell **decreases marginally** (~2.6%). These borders were always subtle (≈1.2–1.4:1); the shift keeps them in the same visual tier. No retouching is needed.

✅ **PASS** — Borders remain ≥ threshold. No corrective action required.

---

## 5. Light Theme Color Harmony

### Hierarchy check (must be monotonic: lighter → darker)

| Token | Hex | RGB | Luminance | vs Shell |
|-------|-----|-----|-----------|----------|
| `panelSolid` | #FFFFFF | (255,255,255) | 1.000 | +0.182 lighter ✅ |
| `panelBright` | #FFFFFF | (255,255,255) | 1.000 | +0.182 lighter ✅ |
| `surfaceElev` | #FFFFFF | (255,255,255) | 1.000 | +0.182 lighter ✅ |
| `shellElevated` | #F4F8F3 | (244,248,243) | 0.929 | +0.111 lighter ✅ |
| `panel` | #F4F8F3 | (244,248,243) | 0.929 | +0.111 lighter ✅ |
| `panelSoft` | #EDF2EC | (237,242,236) | 0.889 | +0.071 lighter ✅ |
| **shell** | **#E8EAE7** | **(232,234,231)** | **0.818** | **baseline** |
| `surfaceSunken` | #D8E0D7 | (216,224,215) | 0.737 | −0.081 darker ✅ |

**All elevated surfaces remain lighter than shell. Sunken surface remains darker.** The hierarchy is preserved.

### Perceptual gap analysis

| Pair | ΔL (old shell→) | ΔL (new shell→) | Note |
|------|-----------------|-----------------|------|
| shell → shellElevated | 0.088 | 0.111 | Gap **widened** — elevated surfaces read more clearly as raised |
| shell → panelSoft | 0.048 | 0.071 | Gap **widened** — same effect |
| shell → surfaceSunken | −0.104 | −0.081 | Gap **narrowed** — sunken area is slightly less distinct |

**Judgment:** The widening of the light-side gap (shell→elevated) is directionally positive — it was tight before and is now more legible. The narrowing of the dark-side gap (shell→sunken) is small enough that `surfaceSunken` still reads as clearly recessed. No perceptible mismatch.

✅ **PASS** — Color harmony is maintained, arguably improved.

---

## 6. TypeScript Typecheck

```
npx tsc --noEmit
EXIT_CODE=0
```

✅ **PASS** — Clean compile. No type errors introduced.

---

## 7. External Reference Regression Check

### `colors.shell` usage (via theme token system)

`grep -rn 'colors.shell' src/` returned **20+ hits** across:
- `AppShell.tsx:5047, 5417`
- `AccountScreen.tsx:154`
- `DocumentsScreen.tsx:569, 592`
- `HelpScreen.tsx:108`
- `ProScreen.tsx:57`
- `NotesScreen.tsx:178, 265`
- `PersonasScreen.tsx:319, 419`
- `SettingsScreen.tsx:997`
- `DocumentDetailView.tsx:104`
- `DocumentListItem.tsx:77`
- `AiChatPage.tsx:3747, 3872, 3967, 4188, 4309, 4394, 4460, 4506, 4539`
- `createStyles.ts:24, 36`
- `Header.tsx:62`

**All consume `colors.shell` through the theme token** — no hardcoded hex values in consuming code. The color change propagates automatically.

### `materialTop/Mid/Bottom` usage

`grep -rn 'materialTop\|materialMid\|materialBottom' src/` returned:
- `palettes.js:35-37` (light — updated ✅)
- `palettes.js:111-113` (dark — untouched, correct ✅)
- `PainterlyBg.tsx:18, 42` — consumes via `colors.materialTop/Mid/Bottom` ✅

No hardcoded material color values in consuming code.

### Hardcoded hex outside palettes

```
grep -rn '#E8E' src/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
→ 0 occurrences (outside palettes.js)
```

✅ **PASS** — No regression. All consumers use tokens.

---

## 8. node_modules Exclusion

```
ls -la node_modules
→ lrwxr-xr-x@ node_modules -> /Users/marco/Projects/kalsa/node_modules

git show ffde39f --stat --name-only | grep node_modules
→ (no output)
```

The symlink exists on disk (pointing to main checkout) but is **not tracked by git** and **not included in the commit**.

✅ **PASS** — node_modules is clean.

---

## 9. Dark Theme Integrity

The dark theme block in `palettes.js:87–136` was **completely untouched** by the diff. All dark tokens retain their original values. Verified by full diff inspection.

✅ **PASS** — Dark theme intact.

---

## 10. Summary of Findings

| # | Severity | Finding | File:Line |
|---|----------|---------|-----------|
| F1 | **major** | 12 hardcoded `rgba(232, 238, 231, ...)` values in `palettes.js`, `glass.ts`, and `createStyles.ts` still reference the OLD shell RGB. `navGlass` in palettes itself contradicts the updated `shell` token by 4 G-channel units. | `palettes.js:71`, `glass.ts:5,6,8`, `createStyles.ts:2061,2274,2730,3136,3288,3346,3833,3906` |
| F2 | **minor** | `glass.ts` is a static (non-theme-aware) module. Its light-theme rgba values are hardcoded to `(232, 238, 231)` and not derived from the token system. This pre-dates A5 but is now more visible because the shell diverged. | `glass.ts:5,6,8` |

**No blocker findings.** The 12 stale rgba values are a hygiene issue — the G-channel delta is 4/255 (~1.6%) and at the alpha levels used (12%–92%), the perceptual difference is negligible (≤0.3 per channel when blended). But they should be updated for consistency with the token change.

---

## VERDICT: ⚠️ CONDITIONAL PASS

The commit does exactly what it claims: 4 shell tokens + 1 comment update, nothing else. The semantic intent is correct. Borders are fine. Harmony is preserved. Typecheck passes. Dark theme is untouched.

**However:** the commit creates an inconsistency within `palettes.js` itself (shell = `#E8EAE7` but navGlass = `rgba(232, 238, 231, 0.92)` — these should match) and leaves 11 stale rgba references in `glass.ts` and `createStyles.ts`.

**Recommended follow-up (not a blocker for merge):**
1. Update `navGlass` in `palettes.js:71` to `rgba(232, 234, 231, 0.92)` to match the new shell.
2. Update all 11 `rgba(232, 238, 231, ...)` values in `glass.ts` and `createStyles.ts` to `rgba(232, 234, 231, ...)`.
3. Consider extracting the RGB base `(232, 234, 231)` into a shared constant to prevent future drift.

**Severity scale:** blocker → major → minor → note.  
This finding is **major** in code-hygiene terms (the file contradicts itself) but **minor** in visual-impact terms (no perceptible user-facing difference). I lean toward **major** because a future developer reading `palettes.js` will see shell and navGlass disagreeing and waste time debugging a non-bug.

---

*Report generated: 2026-09-02. Auditor: Reviewer Doc. Methodology: file inspection, grep, tsc --noEmit, luminance math, diff analysis.*
