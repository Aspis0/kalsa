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

module.exports = {
  appendAskAssistantDraft,
  createAskAssistantBlockedDraft,
  appendAskAssistantQuickAction,
  createAskAssistantDraftStream,
  createAskAssistantOpeningMessage,
  createAskAssistantStreamingFrames,
  getAskAssistantContext,
  getAskAssistantScreenPath,
  toggleAskAssistantOpen,
  updateAskAssistantStreamingMessage,
};
