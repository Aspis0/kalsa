# Audit A6 — Color-coding web sources by provider

**Commit:** `9d8bed46b4e6be1d4c96061fda1eb1c5dec890fe`
**Date:** 2026-09-02 12:51:34 -0400
**Auditor:** Reviewer Doc (automated)
**Claim:** Luna A6

---

## 1. Scope verification

**git show --stat:** 1 file changed — `src/screens/AiChatPage.tsx` (+16, -2). No other files touched.

**MarkdownText.tsx:** Confirmed **intact** — zero diff against parent commit.

**Verdict:** ✅ Scope matches claim. Commit is tightly scoped to AiChatPage.tsx.

---

## 2. Provider map completeness

### Registry source (ground truth)

`src/search/registry.ts:16` defines the closed type:
```ts
export type SearchProviderId = "exa-mcp" | "exa" | "brave" | "tavily";
```

The `PROVIDERS` record at lines 29–52 enumerates exactly those four. `getProvider()` (line 83) returns concrete providers only for those IDs. `isProviderId()` (line 71) validates against only those four strings.

### PROVIDER_COLORS map (AiChatPage.tsx:4765–4770)

```ts
const PROVIDER_COLORS: Record<string, { light: string; dark: string }> = {
  brave: { light: "#9A3412", dark: "#FF6B4A" },
  exa: { light: "#6D28D9", dark: "#A78BFA" },
  "exa-mcp": { light: "#6D28D9", dark: "#A78BFA" },
  tavily: { light: "#0369A1", dark: "#38BDF8" },
};
```

**All 4 SearchProviderId values are covered.**

### Additional provider: `"fetch"`

`src/agent/webFetchTool.ts:889` and `:1123` emit `provider: "fetch"` on page-fetch source cards. These sources flow into `message.sources` via `accumulateToolSources()` in `toolSourceLedger.ts`. The label rendering at `AiChatPage.tsx:5288` has an explicit branch for `"fetch"` (`t("settings.providerFetch")`), but **`"fetch"` is absent from `PROVIDER_COLORS`**.

**Impact:** `"fetch"` cards fall through to the else branch → `getProviderColor` returns `colors.accent` (line 4774). This is the original pre-A6 behavior, so no regression — but it is a **coverage gap** if the intent was "all sources get a provider-specific color."

### Fallback behavior

The else branch at `AiChatPage.tsx:4774`:
```ts
if (!providerColors) return colors.accent;
```
Returns the theme accent color. The ternary at line 5290 falls through to `s.provider` raw (no wrapping in "via"). This is correct — "via X" is the i18n template `errors.sourceVia`, not embedded in data.

**Finding F1 (info):** `"fetch"` provider not color-coded — uses generic `colors.accent` fallback. Non-regressive but potentially incomplete coverage.

---

## 3. WCAG contrast recomputation

### Method
WCAG 2.1 relative luminance per sRGB channel: `L = 0.2126·R' + 0.7152·G' + 0.0722·B'` where `R' = (R/255)^2.2` approx (using exact piecewise formula). Contrast ratio `CR = (L_lighter + 0.05) / (L_darker + 0.05)`.

### Panel backgrounds
- Light panel: `#FFFFFF` → L = 1.0
- Dark panel: `#0B1727` → L ≈ 0.0152

### Results

| Provider   | Theme  | Foreground | Background | CR       | ≥ 4.5:1 |
|------------|--------|------------|------------|----------|---------|
| brave      | light  | #9A3412    | #FFFFFF    | **7.31** | ✅ PASS |
| brave      | dark   | #FF6B4A    | #0B1727    | **6.39** | ✅ PASS |
| exa        | light  | #6D28D9    | #FFFFFF    | **7.10** | ✅ PASS |
| exa        | dark   | #A78BFA    | #0B1727    | **6.62** | ✅ PASS |
| exa-mcp    | light  | #6D28D9    | #FFFFFF    | **7.10** | ✅ PASS |
| exa-mcp    | dark   | #A78BFA    | #0B1727    | **6.62** | ✅ PASS |
| tavily     | light  | #0369A1    | #FFFFFF    | **5.93** | ✅ PASS |
| tavily     | dark   | #38BDF8    | #0B1727    | **8.41** | ✅ PASS |

**Verdict:** ✅ All 6 unique combinations ≥ 4.5:1. Luna's claim confirmed.

---

## 4. "via X" rendering — unknown provider fallback

The `s.provider` value is the raw string from the source object (set by `mapSearchSourcesToChat` at `webSearchTool.ts:160` or by `webFetchTool.ts:889`). It flows through `provider.slice(0, 40)` at `AiChatPage.tsx:673`.

The ternary at lines 5279–5290:
```ts
s.provider === "exa-mcp" ? t("settings.providerExaMcp")
: s.provider === "exa"   ? t("settings.providerExa")
: s.provider === "brave" ? t("settings.providerBrave")
: s.provider === "tavily"? t("settings.providerTavily")
: s.provider === "fetch" ? t("settings.providerFetch")
: s.provider   // ← unknown: raw string, no "via" wrapping
```

"via X" is the i18n template `errors.sourceVia: "via {provider}"` (en.ts:803, it.ts:777). The word "via" is **only in the rendering template**, never in the data. An unknown provider renders as `via <raw_string>`, which is correct.

**Verdict:** ✅ "via" is rendering-only, not data.

---

## 5. Card body invariance

The card `<Pressable>` style at lines 5240–5256:
- `backgroundColor: colors.panelSolid` — **unchanged**
- `borderWidth: 1` — **unchanged**
- `borderColor: colors.line` — **unchanged**
- `padding`, `borderRadius`, `maxWidth` — **unchanged**

Only two properties changed:
1. Badge number `color` → `providerColor` (was `colors.accent`)
2. Provider label `color` → `providerColor` (was `colors.muted`)

The title text at line 5295 uses `colors.ink` — **unchanged**.

**Verdict:** ✅ Only badge bg/text and provider label color changed. Card body, border, title invariant.

---

## 6. Theme color consistency (hue families)

| Provider   | Light (on white) | Dark (on #0B1727) | Same hue family? |
|------------|------------------|--------------------|------------------|
| brave      | #9A3412 (warm brown, H≈16°) | #FF6B4A (salmon/orange, H≈12°) | ✅ Yes — orange/brown family |
| exa        | #6D28D9 (purple, H≈264°) | #A78BFA (lavender, H≈255°) | ✅ Yes — purple family |
| tavily     | #0369A1 (blue, H≈203°) | #38BDF8 (sky blue, H≈201°) | ✅ Yes — blue family |

Dark variants are lighter/more saturated versions of the same hue, consistent with WCAG best practices (brighter foreground on dark background). No hue jumps detected.

**Verdict:** ✅ Coherent theme pairs per provider.

---

## 7. TypeScript compilation

```
$ npx tsc --noEmit
EXIT: 0
```

**Verdict:** ✅ Clean compilation.

---

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | Scope: only AiChatPage.tsx? MarkdownText.tsx intact? | ✅ PASS |
| 2 | All SearchProviderId values in map? | ✅ PASS (4/4 covered) |
| 3 | WCAG contrast ≥ 4.5:1 (all 6 combos)? | ✅ PASS (5.93–8.41) |
| 4 | Fallback: "via" is rendering-only? | ✅ PASS |
| 5 | Card body invariance? | ✅ PASS |
| 6 | Theme hue consistency? | ✅ PASS |
| 7 | tsc --noEmit clean? | ✅ PASS |

### Findings

| ID | Severity | Description |
|----|----------|-------------|
| F1 | **info** | `"fetch"` provider (webFetchTool.ts) is not in PROVIDER_COLORS — falls back to `colors.accent`. Non-regressive (original behavior preserved) but coverage gap if intent was all-source color-coding. |
| F2 | **info** | File paths in Luna's claim (`src/lib/ai/registry.ts`, `src/lib/ai/index.ts`, `src/tools/webSearchTool.ts`) are incorrect. Actual paths: `src/search/registry.ts`, `src/search/index.ts`, `src/agent/webSearchTool.ts`. Line numbers in the claim reference the correct content despite wrong paths. |

---

## VERDICT: **PASS**

No blocking findings. Two informational notes (F1, F2) on path accuracy and fetch-provider coverage.
