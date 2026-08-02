const { formatChatContentFilterMessage } = require("./contentFilter");

/**
 * Contesto Ask AI — generalizzato (niente più bio).
 * L'unica schermata è la chat; i quick actions descrivono le capacità locali.
 */
const DEFAULT_CONTEXT = {
  title: "Ask AI",
  subtitle: "Local assistant — everything stays on this device.",
  quickActions: [
    {
      id: "chat-what-can-i-do",
      label: "What can I do here?",
      response:
        "Chat with a fully local model: explanations, summaries, tables, calculators and HTML mini-apps. Web search is coming — when enabled, sources are cited in chat.",
    },
    {
      id: "chat-privacy",
      label: "Is my data private?",
      response:
        "Yes — the model runs on this device. No account, no cloud upload. A web search only leaves the device when you explicitly run one.",
    },
    {
      id: "chat-miniapp",
      label: "What is a miniapp?",
      response:
        "A miniapp is an interactive block the model can generate: tables, calculators, charts, or full HTML documents. You can export them as CSV or JSON.",
    },
    {
      id: "chat-model",
      label: "Which model am I using?",
      response:
        "The local engine (llama.cpp) runs on this device. Phase 1 ships Qwen3.5-4B by default, with Gemma 4 E2B as an alternative.",
    },
  ],
};

function makeContext(title, subtitle, quickActions, options = {}) {
  return { title, subtitle, quickActions, exactQuickActions: options.exactQuickActions === true };
}

function makeBaselineActions(context) {
  const baseId = context.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const topic = context.title.replace(/\s+help$/i, "");
  return [
    {
      id: `${baseId}-use-page`,
      label: `How do I use ${topic}?`,
      response: `${context.title}: use this page for ${context.subtitle.toLowerCase()} Start with the visible page title, then choose the control that matches your current task.`,
    },
    {
      id: `${baseId}-safe-next-step`,
      label: `Safe next step in ${topic}?`,
      response: `${context.title}: the safe next step is to complete the current page's required review before moving deeper or submitting/exporting anything.`,
    },
    {
      id: `${baseId}-local-data`,
      label: `What stays local in ${topic}?`,
      response: `${context.title}: this help is deterministic and local. It does not send page content to cloud AI; only explicit cloud/export actions leave the device.`,
    },
    {
      id: `${baseId}-page-blockers`,
      label: `What can block actions in ${topic}?`,
      response: `${context.title}: check required fields, account-only actions, privacy guardrails, and visible warning copy before retrying.`,
    },
    {
      id: `${baseId}-review-before-leaving`,
      label: `What should I review before leaving ${topic}?`,
      response: `${context.title}: review unsaved local edits, selected tabs, warnings, and export/login state before leaving this page.`,
    },
    {
      id: `${baseId}-where-to-go-next`,
      label: `Where should I go after ${topic}?`,
      response: `${context.title}: move to the adjacent page that matches the workflow order, or return to the menu/header if the current page is only for review.`,
    },
  ];
}

function withBaselineActions(context) {
  if (context.exactQuickActions) return context;
  const actions = [];
  const seen = new Set();
  for (const action of [...context.quickActions, ...makeBaselineActions(context)]) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    actions.push(action);
  }
  return { ...context, quickActions: actions };
}

function getAskAssistantContext(state = {}) {
  return withBaselineActions({ ...DEFAULT_CONTEXT });
}

function getAskAssistantScreenPath(state = {}) {
  return "chat";
}

function createAskAssistantOpeningMessage(context) {
  return {
    id: `assistant-open-${Date.now()}`,
    role: "assistant",
    text: `${context.title}. Pick a quick action for local help, or ask a question and I will answer with the local engine.`,
  };
}

function appendAskAssistantQuickAction(messages, action) {
  if (!action) return messages;
  const now = Date.now();
  return [
    ...messages,
    {
      id: `user-action-${action.id}-${now}`,
      role: "user",
      text: action.label,
    },
    {
      id: `assistant-action-${action.id}-${now}`,
      role: "assistant",
      text: action.response,
    },
  ];
}

function appendAskAssistantDraft(messages, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return messages;
  const now = Date.now();
  return [
    ...messages,
    {
      id: `user-draft-${now}`,
      role: "user",
      text: trimmed,
    },
    {
      id: `assistant-draft-${now}`,
      role: "assistant",
      text: "Local answer unavailable; quick actions still work for deterministic help.",
    },
  ];
}

const ASK_ASSISTANT_THINKING_TEXT = "I'm thinking...";
const ASK_ASSISTANT_LOCAL_DRAFT_RESPONSE =
  "Local answer unavailable; quick actions still work. Ask again once the local engine is ready.";

function generateDraftId(prefix) {
  const uid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uid}`;
}

function createAskAssistantDraftStream(messages, text, now = Date.now()) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return {
      assistantMessageId: "",
      finalText: "",
      messages,
    };
  }
  const assistantMessageId = generateDraftId("assistant-draft");
  return {
    assistantMessageId,
    finalText: ASK_ASSISTANT_LOCAL_DRAFT_RESPONSE,
    messages: [
      ...messages,
      {
        id: generateDraftId("user-draft"),
        role: "user",
        text: trimmed,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text: ASK_ASSISTANT_THINKING_TEXT,
      },
    ],
  };
}

function createAskAssistantBlockedDraft(messages, text, filterResult, now = Date.now()) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return messages;
  return [
    ...messages,
    {
      id: generateDraftId("user-blocked"),
      role: "user",
      text: trimmed,
    },
    {
      id: generateDraftId("assistant-blocked"),
      role: "assistant",
      status: "done",
      text: formatChatContentFilterMessage(filterResult),
    },
  ];
}

function createAskAssistantStreamingFrames(text, frameSize = 18) {
  const full = String(text || "");
  const size = Math.max(1, Number(frameSize) || 1);
  const frames = [];
  for (let index = size; index < full.length; index += size) {
    frames.push(full.slice(0, index));
  }
  if (full) frames.push(full);
  return frames;
}

function updateAskAssistantStreamingMessage(messages, assistantMessageId, text, status = "streaming", extras = {}) {
  return messages.map((message) =>
    message.id === assistantMessageId
      ? {
          ...message,
          ...(extras.miniapp && typeof extras.miniapp === "object" ? { miniapp: extras.miniapp } : {}),
          ...(Array.isArray(extras.sources) ? { sources: extras.sources } : {}),
          status,
          text,
        }
      : message,
  );
}

function toggleAskAssistantOpen(state) {
  return {
    ...state,
    open: !state.open,
  };
}

// ── miniapp_v1: soft parse / normalize (client-side) ─────────────────────────
// Tolerant by design: missing optional fields get safe defaults; unknown block
// types pass through and the renderer shows UnsupportedBlock.
// answerIndex is NEVER defaulted to 0: invalid/missing → null (grading disabled).

const MAX_MINIAPP_BLOCKS = 24;
const MAX_MINIAPP_ACTIONS = 24;
const MAX_QUIZ_OPTIONS = 4;
const MAX_STRING = 2000;
const MAX_TITLE = 200;
const MAX_KIND = 100;
const MAX_QUESTION = 500;
const MAX_OPTION = 200;
const MAX_EXPLANATION = 1000;
/** Hard cap on serialized block size (unknown / oversized → { type: "unknown" }). */
const MAX_BLOCK_JSON_BYTES = 64 * 1024;

function clipString(value, max = MAX_STRING, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** True only for an explicit integer in 0..3. Missing/NaN/out-of-range → null (no grading). */
function parseAnswerIndex(raw) {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  // Reject non-integer strings like "1.5" / "01" / "1e0" — require exact integer form.
  if (typeof raw === "string" && !/^\s*-?\d+\s*$/.test(raw)) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3) return null;
  return n;
}

/**
 * Normalize a quiz block.
 * answerIndex is null when missing/invalid so the UI disables grading instead of
 * falsely marking option 0 as correct.
 */
function normalizeQuizBlock(block) {
  const rawOptions = Array.isArray(block.options) ? block.options : [];
  const options = rawOptions
    .slice(0, MAX_QUIZ_OPTIONS)
    .map((entry, index) => clipString(entry, MAX_OPTION, `Option ${index + 1}`));
  while (options.length < MAX_QUIZ_OPTIONS) {
    options.push(`Option ${options.length + 1}`);
  }
  const answerIndex = parseAnswerIndex(block.answerIndex);
  const question = clipString(block.question ?? block.title, MAX_QUESTION, "Question");
  const explanation = clipString(block.explanation, MAX_EXPLANATION, "");
  const title = clipString(block.title, MAX_TITLE, "");
  return {
    type: "quiz",
    question,
    options,
    answerIndex,
    ...(explanation ? { explanation } : {}),
    ...(title ? { title } : {}),
  };
}

/** Soft-normalize one block. Oversized / non-objects become { type: "unknown" }. */
function normalizeMiniappBlock(block) {
  if (!isPlainObject(block)) return { type: "unknown" };
  // Cap unknown/any block payload size so history/render cannot hang on huge blobs.
  try {
    const serialized = JSON.stringify(block);
    if (typeof serialized === "string" && serialized.length > MAX_BLOCK_JSON_BYTES) {
      return { type: "unknown" };
    }
  } catch {
    return { type: "unknown" };
  }
  const type = clipString(block.type, 64, "unknown");
  if (type === "quiz") return normalizeQuizBlock(block);
  // Apply common string caps even to unknown types (title/question/option/explanation).
  const out = { ...block, type };
  if ("title" in out) out.title = clipString(out.title, MAX_TITLE, "");
  if ("question" in out) out.question = clipString(out.question, MAX_QUESTION, "");
  if ("explanation" in out) out.explanation = clipString(out.explanation, MAX_EXPLANATION, "");
  if (Array.isArray(out.options)) {
    out.options = out.options
      .slice(0, MAX_QUIZ_OPTIONS)
      .map((entry, index) => clipString(entry, MAX_OPTION, `Option ${index + 1}`));
  }
  return out;
}

/**
 * Normalize a miniapp object into miniapp_v1 shape, or null if unusable.
 * Accepts schema "miniapp_v1" | "aspis_miniapp_v1", or kind+title+blocks without schema.
 */
function normalizeMiniapp(raw) {
  if (!isPlainObject(raw)) return null;
  const hasSchema =
    raw.schema === "miniapp_v1" || raw.schema === "aspis_miniapp_v1";
  const hasEnvelope =
    typeof raw.kind === "string" &&
    typeof raw.title === "string" &&
    Array.isArray(raw.blocks);
  if (!hasSchema && !hasEnvelope) return null;
  if (!hasEnvelope) return null;

  const blocks = raw.blocks
    .slice(0, MAX_MINIAPP_BLOCKS)
    .map(normalizeMiniappBlock)
    .filter(Boolean);

  const miniapp = {
    schema: "miniapp_v1",
    kind: clipString(raw.kind, MAX_KIND, "miniapp"),
    title: clipString(raw.title, MAX_TITLE, "Miniapp"),
    blocks,
  };

  if (Array.isArray(raw.actions)) {
    miniapp.actions = raw.actions.slice(0, MAX_MINIAPP_ACTIONS);
  }
  if (isPlainObject(raw.computed)) miniapp.computed = raw.computed;
  if (isPlainObject(raw.state)) miniapp.state = raw.state;
  if (isPlainObject(raw.navigation)) miniapp.navigation = raw.navigation;
  if (isPlainObject(raw.interaction)) miniapp.interaction = raw.interaction;

  return miniapp;
}

function tryParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True if object looks like a miniapp envelope (before full normalize). */
function looksLikeMiniapp(value) {
  if (!isPlainObject(value)) return false;
  if (value.schema === "miniapp_v1" || value.schema === "aspis_miniapp_v1") {
    return Array.isArray(value.blocks);
  }
  return (
    typeof value.kind === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks)
  );
}

/**
 * Scan `source` starting at `start` for the first balanced `{...}` object.
 * Respects JSON string literals (handles `\"` escapes) so braces inside strings
 * do not affect the depth counter. Returns { start, end, text } or null.
 *
 * Why not firstBrace..lastBrace: that fails when prose has `{` before the JSON,
 * when an invalid object is followed by a valid one, or when `}` appears in a string.
 */
function findBalancedJsonObject(source, start = 0) {
  const len = source.length;
  let i = start;
  while (i < len) {
    const open = source.indexOf("{", i);
    if (open < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = open; j < len; j += 1) {
      const ch = source[j];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return { start: open, end: j + 1, text: source.slice(open, j + 1) };
        }
        if (depth < 0) break;
      }
    }
    // Unbalanced from this `{` — try the next one.
    i = open + 1;
  }
  return null;
}

/**
 * Walk the whole source, collect every balanced `{...}` that parses as a miniapp,
 * and return the FIRST valid one plus the list of all matched spans to strip.
 */
function findAllMiniappSpans(source) {
  const spans = [];
  let cursor = 0;
  while (cursor < source.length) {
    const found = findBalancedJsonObject(source, cursor);
    if (!found) break;
    const candidate = tryParseJsonObject(found.text);
    if (candidate && looksLikeMiniapp(candidate)) {
      const miniapp = normalizeMiniapp(candidate);
      if (miniapp) {
        spans.push({ start: found.start, end: found.end, miniapp });
      }
    }
    cursor = found.end;
  }
  return spans;
}

/**
 * Extract the first valid miniapp JSON from assistant text.
 *
 * Strategy:
 *  1) Prefer fenced ```json / ```miniapp / ``` blocks that parse as miniapp.
 *  2) Otherwise scan for balanced `{...}` objects (string-aware) and take the
 *     first that normalizes to a miniapp.
 *  3) When a miniapp is found, strip ALL fenced miniapp blocks AND all balanced
 *     miniapp JSON spans from the remaining prose (not just the first).
 *
 * Returns { miniapp, text } where text is the prose with miniapp JSON removed.
 */
function parseMiniappFromText(text) {
  const source = String(text || "");
  if (!source.trim()) return { miniapp: null, text: source };

  let firstMiniapp = null;
  const removeRanges = [];

  // 1) Fenced code blocks (```json ... ``` / ```miniapp ... ``` / ``` ... ```)
  const fenceRe = /```(?:json|miniapp)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRe.exec(source)) !== null) {
    const candidate = tryParseJsonObject(match[1].trim());
    if (candidate && looksLikeMiniapp(candidate)) {
      const miniapp = normalizeMiniapp(candidate);
      if (miniapp) {
        if (!firstMiniapp) firstMiniapp = miniapp;
        removeRanges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }

  // 2) Balanced raw objects (first-valid wins for content; all valid spans stripped).
  //    Skip spans already covered by a fence removal to avoid double-strip mess.
  const spans = findAllMiniappSpans(source);
  for (const span of spans) {
    const covered = removeRanges.some((r) => span.start >= r.start && span.end <= r.end);
    if (covered) continue;
    if (!firstMiniapp) firstMiniapp = span.miniapp;
    removeRanges.push({ start: span.start, end: span.end });
  }

  if (!firstMiniapp) return { miniapp: null, text: source };

  // Remove ranges from the end so earlier indices stay valid.
  removeRanges.sort((a, b) => b.start - a.start);
  let cleaned = source;
  for (const range of removeRanges) {
    cleaned = cleaned.slice(0, range.start) + cleaned.slice(range.end);
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { miniapp: firstMiniapp, text: cleaned };
}

module.exports = {
  appendAskAssistantDraft,
  createAskAssistantBlockedDraft,
  appendAskAssistantQuickAction,
  createAskAssistantDraftStream,
  createAskAssistantOpeningMessage,
  createAskAssistantStreamingFrames,
  getAskAssistantContext,
  getAskAssistantScreenPath,
  normalizeMiniapp,
  normalizeMiniappBlock,
  normalizeQuizBlock,
  parseMiniappFromText,
  toggleAskAssistantOpen,
  updateAskAssistantStreamingMessage,
};
