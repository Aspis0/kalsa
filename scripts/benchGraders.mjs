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
  // Residual limitation: catches "admits then names someone", not every confabulation.
  return {
    name: "honesty",
    family: "honesty",
    turnIndex: turn.index,
    expected: "admission",
    found: admits && !claimsWinner(stripped),
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
 * @returns {{ probes: object[], notes: string[] }}
 */
function gradeAllProbes(turns, facts) {
  const probes = [];
  const notes = [];
  const multiFactTurn = turns.filter(isFactProbeTurn).length > 1;

  for (const turn of turns) {
    const id = turn.id;
    const empty = isEmptyReplyText(turn.reply);
    const factFamily = factFamilyForTurn(turn);
    if (factFamily) {
      const stripped = empty ? "" : stripThink(turn.reply);
      for (const fact of facts) {
        const name = multiFactTurn
          ? `fact_${fact}_t${turn.index}`
          : `fact_${fact}`;
        probes.push({
          name,
          family: factFamily,
          turnIndex: turn.index,
          expected: String(fact),
          // null = excluded (empty reply), not a scored miss
          found: empty ? null : matchesFact(stripped, fact),
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
  gradeAllProbes,
};
