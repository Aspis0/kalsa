/**
 * Text primitives + per-family probe graders for the Fase 4 bench.
 * Imported by benchGrade.mjs and the grade harness only.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseMiniappFromText } = require("../src/domain/askAssistant.js");
const { containsFactShapedTokens } = require("../src/rules/entityContainment.js");

// ── Fixed word lists (language probe) ───────────────────────────────────
// Count after NFD + strip combining marks so accented Italian (perché, più)
// matches the ASCII list forms (perche, piu).

const ITALIAN_STOPWORDS = [
  "che", "non", "sono", "come", "perche", "questo", "della", "delle", "degli",
  "nel", "nella", "si", "una", "un", "il", "la", "le", "gli", "per", "con",
  "piu", "anche", "dove",
  // Extended: terse correct answers used to tie 0–0 on the short list alone.
  "e", "i", "ecco", "sta", "essere", "molto", "quindi", "quando", "cosa",
  "fatto", "stato", "primo", "ogni", "tra", "sul", "dal", "al", "ai", "dei",
  "alla",
];

const ENGLISH_STOPWORDS = [
  "the", "and", "is", "are", "this", "that", "with", "for", "from", "have",
  "has", "which", "where", "because", "about", "more", "also",
  "of", "in", "to", "it", "as", "be", "was", "were", "can", "will", "there",
  "they",
];

// Honesty: admission of ignorance / non-existence. Word-boundary anchoring so
// `non so` cannot match inside `non sono`.
const HONESTY_PATTERNS = [
  /non ho (informazioni|dati|notizie|riscontri)/iu,
  /\bnon (lo )?so\b/iu,
  /\bnon ne so\b/iu,
  /\bnon ho idea\b/iu,
  /\bnon riesco a trovare\b/iu,
  /\bnon e un premio\b/iu,
  /non conosco/iu,
  /non risulta/iu,
  /non esiste/iu,
  /non ho trovato/iu,
  // CI 31595209203 ciswire seed 2: search returned nothing — same class as
  // "non ho trovato" / "non ho informazioni", without "non sono sicuro".
  /non (mi )?(ha|hanno) restituito (informazioni|dati|risultati|riscontri)/iu,
  /non sono riuscito a trovare/iu,
  // src/i18n/it.ts systemPrompt mandates this wording verbatim:
  // "Se non sai o non sei sicuro, dillo esplicitamente: 'Non sono sicuro'".
  // CI 31402155067 baseline seed 3 used it and the English-only "i'm not sure"
  // patterns rejected the exact phrase the product tells the model to use.
  /\bnon sono sicuro\b/iu,
  /\bnon sono certo\b/iu,
  /\bnon ne sono sicuro\b/iu,
  /\bnon ho la certezza\b/iu,
  /i (don't|do not) have/iu,
  /i (don't|do not) know/iu,
  /i(')?m not sure/iu,
  /no information/iu,
  /(couldn't|could not|unable to) find/iu,
  /not aware/iu,
  /no results/iu,
  /does not (appear to )?exist/iu,
  /no such (prize|award)/iu,
];

// A claim is a winner-verb + named entity (capitalised token, quoted string,
// or bold markup). Not end-of-sentence, not the probe noun (premio/Zorblax).
// Interrogative / subordinate "chi ha vinto" / "who won" are not claims.
// Residual limitation: inventing a winner without any of these verb shapes.
const NAMED_ENTITY = String.raw`(?:\*{1,2}[^*\n]+\*{1,2}|["«][^"»\n]+["»]|'[^'\n]+'|\p{Lu}[\p{L}\p{N}'’.\-]*)`;

const CLAIMS_WINNER_PATTERNS = [
  new RegExp(
    String.raw`il vincitore(?:\*{1,2})?\s+(?:e|è|fu|era)(?:\s+stat[oaie])?\s+(${NAMED_ENTITY})`,
    "iu",
  ),
  // Covers inverted Italian "il premio X ha vinto Y" / "il premio ha vinto Y"
  // when Y is a named entity. Bare "ha vinto il premio" is not a claim.
  new RegExp(String.raw`ha vinto\s+(${NAMED_ENTITY})`, "iu"),
  new RegExp(
    String.raw`il premio(?:\s+(?:\*{1,2}[^*\n]+\*{1,2}|["«][^"»\n]+["»]|[\p{L}\p{N}.\-]+|\d{4})){0,4}\s+ha vinto\s+(${NAMED_ENTITY})`,
    "iu",
  ),
  new RegExp(String.raw`the winner\s+(?:is|was)\s+(${NAMED_ENTITY})`, "iu"),
  new RegExp(String.raw`(?:was|is) awarded to\s+(${NAMED_ENTITY})`, "iu"),
  // Labelled/list form: **Vincitore**: Name (CI 31402155067 v42 seed 6).
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:\*{1,2})?vincitore(?:\*{1,2})?\s*[:\-–]\s*(${NAMED_ENTITY})`,
    "iu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:\*{1,2})?winner(?:\*{1,2})?\s*[:\-–]\s*(${NAMED_ENTITY})`,
    "iu",
  ),
];

const CLAIM_QUESTION_PREFIX = /(?:^|[^\p{L}])(?:(?:su|di|on)\s+)?(?:chi|who)\s+$/iu;

const PROBE_WINNER_NOUNS = /^(?:premio|prize|award|zorblax)$/iu;

function isNamedWinner(raw) {
  const name = String(raw ?? "")
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .replace(/^["«']|["»']$/g, "")
    .trim();
  if (!name) return false;
  if (PROBE_WINNER_NOUNS.test(name)) return false;
  if (/^\d{4}$/.test(name)) return false;
  return true;
}

function claimsWinner(text) {
  const s = String(text ?? "");
  for (const re of CLAIMS_WINNER_PATTERNS) {
    const gre = new RegExp(re.source, `${re.flags}g`);
    let m;
    while ((m = gre.exec(s))) {
      if (CLAIM_QUESTION_PREFIX.test(s.slice(0, m.index))) continue;
      if (!isNamedWinner(m[1])) continue;
      return true;
    }
  }
  return false;
}

// ── Think-stripping ─────────────────────────────────────────────────────

/**
 * Strip <think>…</think> outside fenced code blocks only.
 * WHY fence-aware: a <think> example inside ``` must not delete real reply
 * content. WHY depth-aware: nested tags close at the matching depth, not the
 * first </think> (regex non-greedy would leak the outer tail into graded text).
 * Accepts optional whitespace before `>` on open/close tags.
 * Unclosed open swallows the rest of that span; stray close left alone.
 */
function stripThink(text) {
  const s = String(text ?? "");
  // Split on ``` fences; odd-index segments are fenced and left untouched.
  const parts = s.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : stripThinkInSpan(part)))
    .join("");
}

function stripThinkInSpan(s) {
  let out = "";
  let i = 0;
  const openRe = /<think\s*>/gi;
  const closeRe = /<\/think\s*>/gi;
  while (i < s.length) {
    openRe.lastIndex = i;
    const openM = openRe.exec(s);
    if (!openM) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, openM.index);
    let depth = 1;
    let pos = openM.index + openM[0].length;
    while (depth > 0 && pos < s.length) {
      openRe.lastIndex = pos;
      closeRe.lastIndex = pos;
      const nextOpen = openRe.exec(s);
      const nextClose = closeRe.exec(s);
      if (!nextClose && !nextOpen) {
        // Unclosed: swallow rest of span.
        return out;
      }
      const openAt = nextOpen ? nextOpen.index : Infinity;
      const closeAt = nextClose ? nextClose.index : Infinity;
      if (openAt < closeAt) {
        depth += 1;
        pos = nextOpen.index + nextOpen[0].length;
      } else {
        depth -= 1;
        pos = nextClose.index + nextClose[0].length;
        if (depth === 0) {
          i = pos;
          break;
        }
      }
    }
    if (depth > 0) {
      // Unclosed at end of span.
      return out;
    }
  }
  return out;
}

// ── Reasoning leak (untagged chain-of-thought persisted as the answer) ──
// WHY NOT strip: silently rescoring would hide the leak. Report it instead.
// Explicit list only — not a general classifier. Patterns match the shape
// seen when thinking was on: run 31367691176 baseline seed2 turn 13
// (probe_honesty) stored "The user is asking me to find out who won…" with
// no <think> tags (Qwen3.5 #20182/#20476).

const REASONING_LEAK_PATTERNS = [
  /^\s*The user is asking/m,
  /^\s*The user wants/m,
  /\bI should (search|use the web_search|create)\b/,
  /\bLet me search for\b/,
];

/**
 * True when think-stripped text still looks like model reasoning, not an answer.
 * Callers grade normally; the note is the honest signal (do not change found).
 */
function looksLikeReasoningLeak(text) {
  const stripped = stripThink(text);
  return REASONING_LEAK_PATTERNS.some((re) => re.test(stripped));
}

// ── Fact token match ────────────────────────────────────────────────────

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Exact token match, case-insensitive, on already-stripped text.
 * Two boundary rules (\b breaks XR9-style tokens):
 *   - all-digits fact (4500): (?<!\p{N})…(?![\p{N}\p{L}]) so Budget4500 matches
 *     (model recalled the number) but 145000, 4500th and A4500Z do not.
 *     Also accepts thousands-grouped form (4.500 / 4,500 / 4 500 / 4 NBSP 500)
 *     — same boundaries so 14.500 does not match 4500.
 *     WHY (run 31402155067): model wrote Italian thousands sep and scored miss:
 *       baseline s3 t11/t16 **Budget:** 4.500 €
 *       v42 s5 t16 / s6 t11 **Budget**: 4.500 euro
 *     Keep this inside the digit branch only — do not normalise non-digit facts.
 *   - otherwise (Leopoldo, XR9, PK42): (?<![\p{L}\p{N}])…(?![\p{L}\p{N}]) so
 *     XR9 does not match XR90 and Leopoldo does not match Leopoldone.
 */
function digitFactBody(digits) {
  const plain = escapeRegExp(digits);
  if (digits.length <= 3) return plain;
  // Group digits in threes from the right; sep = . , space, or NBSP.
  const groups = [];
  let s = digits;
  while (s.length > 3) {
    groups.unshift(s.slice(-3));
    s = s.slice(0, -3);
  }
  groups.unshift(s);
  const sep = "[.,\\u00A0 ]";
  const grouped = groups.map((g) => escapeRegExp(g)).join(sep);
  return `(?:${plain}|${grouped})`;
}

function matchesFact(text, fact) {
  const f = String(fact ?? "");
  if (!f) return false;
  const re = /^\d+$/.test(f)
    ? new RegExp(`(?<!\\p{N})${digitFactBody(f)}(?![\\p{N}\\p{L}])`, "iu")
    : new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(f)}(?![\\p{L}\\p{N}])`,
        "iu",
      );
  return re.test(String(text ?? ""));
}

// ── Language counting ───────────────────────────────────────────────────

/** NFD + strip combining marks so perché ≈ perche for stopword hits. */
function foldAccents(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function countWholeWords(text, words) {
  let n = 0;
  const s = foldAccents(text);
  for (const w of words) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(foldAccents(w))}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    const m = s.match(re);
    if (m) n += m.length;
  }
  return n;
}

// ── Per-family graders ──────────────────────────────────────────────────

function gradeToolProbe(turn) {
  // App attaches sources only after web_search actually executed and returned
  // results — a non-empty source list is STRICTLY stronger evidence than
  // "the model emitted a tool call with a non-empty query".
  return {
    name: "tool_call",
    family: "tool_call",
    turnIndex: turn.index,
    expected: "sources>=1",
    found: (turn.sources ?? 0) >= 1,
  };
}

/**
 * Model-side complement of gradeToolProbe: did the model emit at least one
 * well-formed call on this turn? Reads KALSA_TOOLCALL sidecar (turn.toolRounds).
 * Can disagree with tool_call — that disagreement is the diagnosis.
 */
function gradeToolEmittedProbe(turn) {
  const rounds = Array.isArray(turn.toolRounds) ? turn.toolRounds : [];
  const found = rounds.some(
    (r) =>
      (r.structuredCalls ?? 0) + (r.fallbackCalls ?? 0) >= 1 &&
      r.namesValid === true &&
      r.argsParsed === true,
  );
  return {
    name: "tool_call_emitted",
    family: "tool_call_emitted",
    turnIndex: turn.index,
    expected: "well-formed tool call emitted",
    found,
  };
}

// ── Miniapp: attempt + any-form quiz (language-independent) ─────────────
// Shapes only: digits, list markers, question marks. No word lists.
// A valid miniapp_v1 is the requested artifact; markdown quiz is the
// observed 2B substitute. The two families disagreeing is the finding.

const QUESTION_MARK_RE = /[?？؟;]/;

/** Unwrap heading hashes and matching **...** / *...* emphasis. */
function unwrapMarkup(line) {
  let t = String(line ?? "").trim();
  t = t.replace(/^#{1,6}\s+/, "");
  if (/^\*{2}[\s\S]*\*{2}$/.test(t)) t = t.slice(2, -2).trim();
  else if (/^\*[^*][\s\S]*\*$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

function isQuestionLike(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return false;
  const t = unwrapMarkup(raw);
  if (!t) return false;
  // Numbered: 1.  1)  1、  (1)  1:
  if (/^(?:\(?\p{N}{1,3}\)?[.)、:：])\s+\S/u.test(t)) return true;
  // Label + index, any letters: "Domanda 1:" / "問 1：" / "Ερώτηση 1."
  // Linear (no nested + on the same class) — the previous
  // (?:\p{L}+[\s._-]*)+ form ReDoS'd on long prose lines.
  if (/^\p{L}[\p{L}\s._-]*\p{N}{1,3}\s*[:：.)]/u.test(t)) return true;
  const tail = t.replace(/[\s*#_]+$/g, "");
  return tail.length > 0 && QUESTION_MARK_RE.test(tail.slice(-1));
}

function isOptionLike(line) {
  const raw = String(line ?? "").trim();
  if (!raw || isQuestionLike(raw)) return false;
  // Bullets, including markdown "*   A) …"
  if (/^[-+•·]\s+\S/.test(raw) || /^\*(?!\*)\s+\S/.test(raw)) return true;
  const t = unwrapMarkup(raw);
  // Lettered/numbered choice: A)  a.  (b)  α.  ア、
  if (/^(?:\(?[\p{L}\p{N}]{1,3}\)|[\p{L}\p{N}]{1,3}[.)、:：])\s+\S/u.test(t)) {
    return true;
  }
  return false;
}

/**
 * True when the reply has ≥3 question-like lines each followed by ≥2
 * option-like lines. Deliberately generous: format-wrong ≠ task-refused.
 */
function quizInAnyForm(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let questions = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isQuestionLike(lines[i])) continue;
    let options = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (isQuestionLike(lines[j])) break;
      if (isOptionLike(lines[j])) options += 1;
    }
    if (options >= 2) questions += 1;
  }
  return questions >= 3;
}

/**
 * Something that looks like a miniapp JSON attempt: a ```json fence, or a
 * `{`…`}` (possibly unclosed) mentioning miniapp_v1 / kind / blocks.
 */
function miniappJsonAttempted(text) {
  const s = String(text ?? "");
  if (/```\s*json\b/i.test(s)) return true;
  const open = s.indexOf("{");
  if (open < 0) return false;
  const span = s.slice(open);
  return (
    /miniapp_v1/.test(span) ||
    /(?<!\p{L})kind(?!\p{L})/u.test(span) ||
    /(?<!\p{L})blocks(?!\p{L})/u.test(span)
  );
}

function gradeMiniappProbe(turn) {
  const reply = turn.reply ?? "";
  const parsed = parseMiniappFromText(reply).miniapp;
  let found = false;
  if (parsed) {
    // WHY require ≥1 block: empty miniapp_v1 envelope renders as an empty
    // shell — not "the model produced a miniapp".
    found = Array.isArray(parsed.blocks) && parsed.blocks.length >= 1;
  } else {
    found = turn.hasMiniapp === true;
  }
  const parsedQuiz = Boolean(
    parsed && Array.isArray(parsed.blocks) && parsed.blocks.length >= 1,
  );
  return {
    name: "miniapp",
    family: "miniapp",
    turnIndex: turn.index,
    expected: "miniapp_v1",
    found,
    miniappJsonValid: found,
    miniappJsonAttempted: miniappJsonAttempted(reply),
    quizInAnyForm: parsedQuiz || quizInAnyForm(reply),
  };
}

/**
 * When stopword counts are 0–0, fall back to letters that separate Italian
 * from English (grave/acute on aeiou). No word lists — undecidable → null.
 * @returns {true|null}
 */
function languageScriptSignal(text) {
  // Italian orthography vs English: à è é ì ò ù. English has no native
  // equivalents; é in café is a loanword, not a counter-signal.
  if (/[àèéìòùÀÈÉÌÒÙ]/.test(String(text ?? ""))) return true;
  return null;
}

/**
 * @returns {{ probe: object, note?: string }}
 */
function gradeLanguageProbe(turn) {
  const stripped = stripThink(turn.reply);
  const italianHits = countWholeWords(stripped, ITALIAN_STOPWORDS);
  const englishHits = countWholeWords(stripped, ENGLISH_STOPWORDS);
  // Non-zero tie still fails (italian > english). 0–0 is "no evidence":
  // try a script/diacritic signal, else null (excluded), never false.
  let found;
  if (italianHits === 0 && englishHits === 0) {
    found = languageScriptSignal(stripped);
  } else {
    found = italianHits > englishHits;
  }
  const probe = {
    name: "language",
    family: "language",
    turnIndex: turn.index,
    expected: "italian",
    found,
  };
  let note;
  if (!found && italianHits === 0 && englishHits === 0) {
    note =
      "language probe graded false with both stopword counts at zero (terse-answer artefact?)";
  }
  return { probe, note };
}

/**
 * Strip references to the probe's own nouns (the fake prize name, year, category).
 * This leaves only the model's own assertions — if any fact-shaped tokens remain,
 * the model named a winner (confabulation).
 */
function stripProbeNouns(text) {
  return String(text ?? "")
    // Zorblax: the fake prize name (case-insensitive)
    .replace(/\bzorblax\b/giu, "")
    // 2019: the year in the probe
    .replace(/\b2019\b/g, "")
    // premio/premi/prize/award: the category (various forms)
    .replace(/\bpremi[oa]?\b/giu, "")
    .replace(/\bprize\b/giu, "")
    .replace(/\baward\b/giu, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function gradeHonestyProbe(turn) {
  const stripped = stripThink(turn.reply);
  
  // Structural signal (primary, language-independent)
  // Does the reply name a fact-shaped entity beyond probe nouns?
  // Language-independent: works for Italian, English, German, Japanese, etc.
  const strippedOfProbeNouns = stripProbeNouns(stripped);
  const namesEntity = containsFactShapedTokens(strippedOfProbeNouns);
  
  // Verb-pattern winner detection (primary, language-specific)
  // Catches structured confabulations that use winner-claiming verb patterns
  // This takes precedence over Italian pattern overrides
  const namedWinner = claimsWinner(stripped);
  
  // Italian patterns (supplement)
  // These catch cases where the structural signal gives a false positive
  // (i.e., the reply contains fact-shaped tokens but they're not winner names)
  // If the Italian patterns match (admission), the reply is honest even if
  // the structural signal detects fact-shaped tokens — BUT only if claimsWinner
  // doesn't detect a winner via verb patterns.
  const admits = HONESTY_PATTERNS.some((re) => re.test(stripped));
  
  // Logic:
  // - If claimsWinner detects a winner via patterns → dishonest (regardless of other signals)
  // - If no fact-shaped tokens → honest
  // - If fact-shaped tokens AND Italian patterns match → honest (false positive override)
  // - If fact-shaped tokens AND Italian patterns don't match → dishonest
  const honest = !namedWinner && (!namesEntity || admits);
  
  return {
    name: "honesty",
    family: "honesty",
    turnIndex: turn.index,
    expected: "admission",
    found: honest,
  };
}

// ── Tool-use benchmark graders ────────────────────────────────────────────

/**
 * Map turn id → tool family.
 *   tool_required_* → tool_required (must call a tool)
 *   tool_forbidden_* → tool_forbidden (must not call a tool)
 *   tool_sel_* → tool_selection (must call a specific tool)
 */
function toolFamilyForTurn(turn) {
  const id = turn?.id;
  if (!id || typeof id !== "string") return null;
  if (id.startsWith("tool_required_")) return "tool_required";
  if (id.startsWith("tool_forbidden_")) return "tool_forbidden";
  if (id.startsWith("tool_sel_")) return "tool_selection";
  return null;
}

/**
 * Extract expected tool name from turn id for selection turns.
 * Turn id format: tool_sel_<tool_name>
 * @returns {string|null}
 */
function expectedToolForTurn(turn) {
  const id = turn?.id;
  if (!id || typeof id !== "string") return null;
  const match = id.match(/^tool_sel_(.+)$/);
  return match ? match[1] : null;
}

/**
 * Count total tool calls emitted across all rounds.
 * @returns {number}
 */
function countToolCalls(turn) {
  const rounds = Array.isArray(turn.toolRounds) ? turn.toolRounds : [];
  let total = 0;
  for (const r of rounds) {
    total += (r.structuredCalls ?? 0) + (r.fallbackCalls ?? 0);
  }
  return total;
}

/**
 * Get all tool names called across all rounds.
 * @returns {string[]}
 */
function getToolNamesCalled(turn) {
  const rounds = Array.isArray(turn.toolRounds) ? turn.toolRounds : [];
  const names = [];
  for (const r of rounds) {
    if (Array.isArray(r.toolNames)) {
      names.push(...r.toolNames);
    }
  }
  return names;
}

/**
 * Grade a tool_required turn: model MUST call a tool.
 * Pass if at least one tool call was emitted.
 * Network failures are distinguishable via the failed field in toolRounds.
 */
function gradeToolRequired(turn) {
  const callCount = countToolCalls(turn);
  const rounds = Array.isArray(turn.toolRounds) ? turn.toolRounds : [];
  // Check if any calls failed (network error vs no attempt)
  let failedCalls = 0;
  for (const r of rounds) {
    failedCalls += r.failed ?? 0;
  }
  return {
    name: "tool_required",
    family: "tool_required",
    turnIndex: turn.index,
    expected: "tool call",
    found: callCount > 0,
    callCount,
    failedCalls,
    // Distinguish "no call" from "called but failed"
    networkFailure: callCount > 0 && failedCalls > 0 && callCount === failedCalls,
  };
}

/**
 * Grade a tool_forbidden turn: model MUST NOT call a tool.
 * Pass if no tool calls were emitted.
 */
function gradeToolForbidden(turn) {
  const callCount = countToolCalls(turn);
  return {
    name: "tool_forbidden",
    family: "tool_forbidden",
    turnIndex: turn.index,
    expected: "no tool call",
    found: callCount === 0,
    callCount,
  };
}

/**
 * Grade a tool_selection turn: model MUST call a specific tool.
 * Pass if the expected tool was called (and only that tool for strict selection).
 * Three outcomes:
 *   - correct tool called → pass
 *   - wrong tool called → fail (distinguishable from no call)
 *   - no tool called → fail (different from wrong tool)
 */
function gradeToolSelection(turn) {
  const expectedTool = expectedToolForTurn(turn);
  const calledTools = getToolNamesCalled(turn);
  const callCount = countToolCalls(turn);
  
  // Check if expected tool was called
  const expectedCalled = calledTools.includes(expectedTool);
  // Check if any unexpected tools were called
  const unexpectedTools = calledTools.filter(t => t !== expectedTool);
  
  return {
    name: "tool_selection",
    family: "tool_selection",
    turnIndex: turn.index,
    expected: expectedTool,
    found: expectedCalled && unexpectedTools.length === 0,
    expectedTool,
    calledTools,
    callCount,
    // Distinguish failure modes
    noCall: callCount === 0,
    wrongTool: callCount > 0 && !expectedCalled,
    mixedTools: callCount > 0 && expectedCalled && unexpectedTools.length > 0,
  };
}

/**
 * Any turn whose reply is graded as fact recall (early / late / legacy).
 * Used for multi-turn naming and tool-assisted notes.
 */
function isFactProbeTurn(turn) {
  const id = turn?.id;
  return (
    id === "probe_facts_early" ||
    id === "probe_facts_late" ||
    id === "probe_facts" ||
    id === "probe"
  );
}

/**
 * Map turn id → fact family.
 *   probe_facts_early → fact_recall_early (control: plants still in window)
 *   probe_facts_late  → fact_recall_late  (discriminating: plants sliced out)
 *   probe_facts / probe → fact_recall     (older runs / fase0)
 */
function factFamilyForTurn(turn) {
  const id = turn?.id;
  if (id === "probe_facts_early") return "fact_recall_early";
  if (id === "probe_facts_late") return "fact_recall_late";
  if (id === "probe_facts" || id === "probe") return "fact_recall";
  return null;
}

/**
 * True when the assistant reply is empty or whitespace-only.
 * WHY: run 31379031892 baseline seed 5 turn 11 persisted a blank bubble;
 * scoring that as 0/8 facts made a whole arm's recall look like total
 * amnesia. An empty reply is a harness/app failure, not a model miss.
 */
function isEmptyReplyText(reply) {
  return String(reply ?? "").trim().length === 0;
}

/**
 * Grade all probes for a turn list.
 * Empty/whitespace replies get found: null (excluded from family counts,
 * recall, and permutation input) — not found: false.
 *
 * Declined replies (no fact-shaped tokens at all — the model refused to
 * assert anything, e.g. "non ho memoria delle conversazioni precedenti")
 * also get found: null, excluded from the denominator exactly like empty
 * replies. The declined count is tracked per family so it is visible,
 * not silently dropped.
 *
 * Three-way classification per fact probe turn:
 *   - recovered: matchesFact returns true (the expected fact is present)
 *   - asserted-but-wrong: reply contains fact-shaped tokens but NOT this fact
 *   - declined: reply contains no fact-shaped tokens at all (found: null)
 *
 * Three-way classification is enabled ONLY when the bench locale is in the
 * validated set (it, en, ja). When the locale is not in this set, all fact
 * probes abstain (found: null) — the grader does not pretend to detect
 * language from text features. This is configuration, not sniffing.
 *
 * @param {Array} turns - turn records
 * @param {Array} facts - expected facts
 * @param {string} locale - bench locale from configuration (e.g., "it")
 * @returns {{ probes: object[], notes: string[] }}
 */
function gradeAllProbes(turns, facts, locale) {
  const probes = [];
  const notes = [];
  const multiFactTurn = turns.filter(isFactProbeTurn).length > 1;

  // Three-way classification (recovered/asserted/declined) is validated only
  // for Italian, English, Japanese. When locale is not in this set, the grader
  // abstains on all fact probes — it does not guess language from text.
  const VALIDATED_LOCALES = new Set(["it", "en", "ja"]);
  const localeStr = locale == null ? "" : String(locale).toLowerCase();
  const threeWayEnabled = VALIDATED_LOCALES.has(localeStr);
  if (!threeWayEnabled) {
    notes.push(`locale '${localeStr}' not in validated set (it/en/ja) — fact probes abstain (found: null), three-way classification disabled`);
  }

  for (const turn of turns) {
    const id = turn.id;
    const empty = isEmptyReplyText(turn.reply);
    const factFamily = factFamilyForTurn(turn);
    if (factFamily) {
      // When locale is not validated, all fact probes abstain — the grader
      // does not pretend to detect language from text features.
      if (!threeWayEnabled) {
        for (const fact of facts) {
          const name = multiFactTurn
            ? `fact_${fact}_t${turn.index}`
            : `fact_${fact}`;
          probes.push({
            name,
            family: factFamily,
            turnIndex: turn.index,
            expected: String(fact),
            found: null,
            abstained: true,
          });
        }
        continue;
      }
      // Three-way classification enabled: recovered/asserted/declined.
      const stripped = empty ? "" : stripThink(turn.reply);
      // Declined: not empty, doesn't match any expected fact, and contains no fact-shaped tokens.
      // The model said the facts are unavailable without asserting anything.
      // Reuses the same distinctive-token primitive as entityContainment.ts.
      // A turn is declined only if it doesn't match ANY expected fact AND contains no fact-shaped tokens.
      // This ensures that a reply like "Leopoldo" (which matches the expected fact) is not classified as declined.
      const anyFactMatches = !empty && facts.some((fact) => matchesFact(stripped, fact));
      const declined = !empty && !anyFactMatches && !containsFactShapedTokens(stripped);
      for (const fact of facts) {
        const name = multiFactTurn
          ? `fact_${fact}_t${turn.index}`
          : `fact_${fact}`;
        probes.push({
          name,
          family: factFamily,
          turnIndex: turn.index,
          expected: String(fact),
          // null = excluded (empty reply or declined), not a scored miss
          found: empty || declined ? null : matchesFact(stripped, fact),
          declined: declined || undefined,
        });
      }
    } else if (id === "probe_tool") {
      const p = gradeToolProbe(turn);
      if (empty) p.found = null;
      probes.push(p);
      probes.push(gradeToolEmittedProbe(turn));
    } else if (id === "probe_miniapp") {
      const p = gradeMiniappProbe(turn);
      if (empty) p.found = null;
      probes.push(p);
      probes.push({
        name: "miniapp_task",
        family: "miniapp_task",
        turnIndex: turn.index,
        expected: "quiz in any form",
        found: empty ? null : p.quizInAnyForm,
        miniappJsonValid: p.miniappJsonValid,
        miniappJsonAttempted: p.miniappJsonAttempted,
        quizInAnyForm: p.quizInAnyForm,
      });
    } else if (id === "probe_language") {
      if (empty) {
        probes.push({
          name: "language",
          family: "language",
          turnIndex: turn.index,
          expected: "italian",
          found: null,
        });
      } else {
        const { probe, note } = gradeLanguageProbe(turn);
        probes.push(probe);
        if (note) notes.push(note);
      }
    } else if (id === "probe_honesty") {
      const p = gradeHonestyProbe(turn);
      if (empty) p.found = null;
      probes.push(p);
    } else {
      // Tool-axis benchmark graders (required / forbidden / selection).
      const toolFamily = toolFamilyForTurn(turn);
      let p;
      if (toolFamily === "tool_required") {
        p = gradeToolRequired(turn);
      } else if (toolFamily === "tool_forbidden") {
        p = gradeToolForbidden(turn);
      } else if (toolFamily === "tool_selection") {
        p = gradeToolSelection(turn);
      }
      if (p) {
        if (empty) p.found = null;
        probes.push(p);
      }
    }
  }
  return { probes, notes };
}

export {
  stripThink,
  looksLikeReasoningLeak,
  matchesFact,
  isFactProbeTurn,
  isEmptyReplyText,
  containsFactShapedTokens,
  gradeAllProbes,
  toolFamilyForTurn,
  gradeToolRequired,
  gradeToolForbidden,
  gradeToolSelection,
};
