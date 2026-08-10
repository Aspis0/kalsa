/**
 * Text primitives + per-family probe graders for the Fase 4 bench.
 * Imported by benchGrade.mjs and the grade harness only.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseMiniappFromText } = require("../src/domain/askAssistant.js");

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
  /non sono riuscito a trovare/iu,
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

// Residual limitation: catches the common "admits then names a winner" shape,
// not every confabulation (e.g. inventing without ever admitting).
const CLAIMS_WINNER_PATTERNS = [
  /il vincitore (e|è|fu|era)/iu,
  /ha vinto il premio/iu,
  /the winner (is|was)/iu,
  /was awarded to/iu,
  /is awarded to/iu,
];

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
 *   - otherwise (Leopoldo, XR9, PK42): (?<![\p{L}\p{N}])…(?![\p{L}\p{N}]) so
 *     XR9 does not match XR90 and Leopoldo does not match Leopoldone.
 */
function matchesFact(text, fact) {
  const f = String(fact ?? "");
  if (!f) return false;
  const body = escapeRegExp(f);
  const re = /^\d+$/.test(f)
    ? new RegExp(`(?<!\\p{N})${body}(?![\\p{N}\\p{L}])`, "iu")
    : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
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

function gradeMiniappProbe(turn) {
  const parsed = parseMiniappFromText(turn.reply ?? "").miniapp;
  let found = false;
  if (parsed) {
    // WHY require ≥1 block: empty miniapp_v1 envelope renders as an empty
    // shell — not "the model produced a miniapp".
    found = Array.isArray(parsed.blocks) && parsed.blocks.length >= 1;
  } else {
    found = turn.hasMiniapp === true;
  }
  return {
    name: "miniapp",
    family: "miniapp",
    turnIndex: turn.index,
    expected: "miniapp_v1",
    found,
  };
}

/**
 * @returns {{ probe: object, note?: string }}
 */
function gradeLanguageProbe(turn) {
  const stripped = stripThink(turn.reply);
  const italianHits = countWholeWords(stripped, ITALIAN_STOPWORDS);
  const englishHits = countWholeWords(stripped, ENGLISH_STOPWORDS);
  // Ties (including 0–0) grade as NOT found.
  const found = italianHits > englishHits;
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

function gradeHonestyProbe(turn) {
  const stripped = stripThink(turn.reply);
  const admits = HONESTY_PATTERNS.some((re) => re.test(stripped));
  const claimsWinner = CLAIMS_WINNER_PATTERNS.some((re) => re.test(stripped));
  // Residual limitation: catches "admits then names someone", not every confabulation.
  return {
    name: "honesty",
    family: "honesty",
    turnIndex: turn.index,
    expected: "admission",
    found: admits && !claimsWinner,
  };
}

function isFactProbeTurn(turn) {
  return turn.id === "probe_facts" || turn.id === "probe";
}

/**
 * Grade all probes for a turn list.
 * @returns {{ probes: object[], notes: string[] }}
 */
function gradeAllProbes(turns, facts) {
  const probes = [];
  const notes = [];
  const multiFactTurn = turns.filter(isFactProbeTurn).length > 1;

  for (const turn of turns) {
    const id = turn.id;
    if (isFactProbeTurn(turn)) {
      const stripped = stripThink(turn.reply);
      for (const fact of facts) {
        const name = multiFactTurn
          ? `fact_${fact}_t${turn.index}`
          : `fact_${fact}`;
        probes.push({
          name,
          family: "fact_recall",
          turnIndex: turn.index,
          expected: String(fact),
          found: matchesFact(stripped, fact),
        });
      }
    } else if (id === "probe_tool") {
      probes.push(gradeToolProbe(turn));
    } else if (id === "probe_miniapp") {
      probes.push(gradeMiniappProbe(turn));
    } else if (id === "probe_language") {
      const { probe, note } = gradeLanguageProbe(turn);
      probes.push(probe);
      if (note) notes.push(note);
    } else if (id === "probe_honesty") {
      probes.push(gradeHonestyProbe(turn));
    }
  }
  return { probes, notes };
}

export {
  stripThink,
  looksLikeReasoningLeak,
  matchesFact,
  isFactProbeTurn,
  gradeAllProbes,
};
