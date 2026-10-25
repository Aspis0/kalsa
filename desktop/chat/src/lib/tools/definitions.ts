/**
 * The tools the assistant can call, in the shape every OpenAI-compatible
 * server expects for function calling. The descriptions are what the model
 * reads when deciding to call one, so they say when the tool is worth calling
 * and what comes back.
 */
import { MINIAPP_TEMPLATE_IDS } from "../miniapp/templates";
import type { Language } from "../../i18n";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * The one local tool: it builds a miniapp here, with no network and no Tauri
 * command, so it is offered whatever the web switch says (see `offeredTools`).
 * Name, description and schema are the phone's `CREATE_MINIAPP_TOOL`.
 */
export const CREATE_MINIAPP_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_miniapp",
    description:
      "Build an interactive on-device miniapp in a single call. Pick one " +
      "template — compare_data (a comparison table), quick_calculator (a " +
      "formula calculator), reading_quiz (a quiz with several questions), or " +
      "checklist (an ordered, tickable list) — and pass its slots. The app " +
      "opens inline in the chat. Use this instead of writing miniapp JSON by " +
      "hand. For quick_calculator, give every number the person might change " +
      "a labelled field (id, label, value) and write the formula from those " +
      "ids — every field must appear in the formula. A number equal to a " +
      "not-yet-used field's value is replaced by that field's id; any other " +
      "number stays in the formula as a constant (amount * 1.22). With no " +
      "fields, a formula of bare numbers is split into editable Number " +
      "fields automatically. Never show the tool's or a template's name " +
      "(create_miniapp, compare_data…) to the person, and never mention " +
      "templates or slots: describe the mini app in plain words, as the thing " +
      "it is — a table, a calculator, a quiz, a list.",
    parameters: {
      type: "object",
      properties: {
        template: {
          type: "string",
          enum: [...MINIAPP_TEMPLATE_IDS],
          description: "Which miniapp template to build.",
        },
        slots: {
          type: "object",
          description:
            "Per-template slots: compare_data (title?, columns[], rows[]), " +
            "quick_calculator (title?, formula, fields[] of {id, label, " +
            "value}), reading_quiz (title?, questions[] of {question, " +
            "options[2..4], answerIndex?, explanation?}), or checklist " +
            "(title?, steps[] or items[]).",
          additionalProperties: true,
        },
      },
      required: ["template"],
    },
  },
};

/**
 * The tools whose work leaves this computer — the owner's switch governs
 * exactly these, and nothing else in the list.
 */
export const WEB_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information: news, facts, prices, events, people — anything the model may not know. Returns the top results with their titles, URLs and a short excerpt, and the answer may also carry the text of the top pages Kalsa read under it. Use web_fetch for any result or link whose text is not already in the answer.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query — describe the page you want, not just keywords.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Open a web address over http or https and read the page's text. Any publicly reachable address can be opened, but addresses on this machine or on a private network are refused before any request is made. Only the beginning of a long page comes back, and a page that is not text or HTML cannot be read.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The http or https address of the page to open.",
          },
        },
        required: ["url"],
      },
    },
  },
];

/** Every tool this build can offer, local first. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [CREATE_MINIAPP_TOOL, ...WEB_TOOLS];

/**
 * The mailbox, as the model sees it: three tools that read it and one that
 * writes nothing. What comes back from the first three is a stranger's text,
 * so it counts as outside content like a web result does.
 */
export const MAIL_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "mail_list",
      description:
        "List mail from the person's mailbox: an id, who sent it, the subject, the time, a short snippet, and whether it looks bulk (a newsletter) or suspicious. Call this first when the person asks what arrived, what is important today, or anything about their mail. It only reads. The app draws the mails that are not newsletters as cards the person can already see, so you do not have to show them; call mail_show only to write your own one line under those cards.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days back to look. Default 1." },
          from: { type: "string", description: "Only mail from this address or name." },
          query: { type: "string", description: "Words to look for in the mail." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mail_read",
      description:
        "Read one mail in full, by an id a previous mail_list returned: the whole text, the other messages in its thread, and the names and sizes of its attachments. Attachments are listed, never opened. Use it to read closely before you answer, not to show the mail — the person opens a mail from its card.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The mail's id, as mail_list gave it." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mail_draft",
      description:
        "Write a reply to one of the person's mails and show it as a draft the person can edit. Nothing is ever sent: the draft stays on this computer and the person sends it themselves. Name the mail to answer by its id and give the words of the reply. The words you write become that card and nothing else, so to change a draft call mail_draft again with the same reply_to_id and the whole new body — never write the new version as your answer text. The reply is the person's mail from their own account: never sign it as Kalsa and never name Kalsa in it. A signature name is the person's own, and only if the mail being answered gives it; otherwise sign nothing.",
      parameters: {
        type: "object",
        properties: {
          reply_to_id: { type: "integer", description: "The id of the mail being answered." },
          body: { type: "string", description: "The words of the reply, as the person would write them." },
        },
        required: ["reply_to_id", "body"],
      },
    },
  },
];

/** Every name the mailbox answers under, `mail_show` among them. It is this
 * app's own drawing rather than an MCP call, so a set built from
 * `MAIL_TOOLS` alone leaves the one tool that puts cards in front of the
 * person still offered. */
export const MAIL_NAMES: ReadonlySet<string> = new Set([
  ...MAIL_TOOLS.map((tool) => tool.function.name),
  "mail_show",
]);

/** A gist is read in the interface's language, which is the mailbox's. */
const GIST_LANGUAGE: Record<Language, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
  fr: "French",
  zh: "Chinese (Simplified)",
};

/**
 * The one tool of ours that draws: the model says which ids matter and gives
 * each a line, and the code looks the rest of the card up in the last list. A
 * model that invents an id gets nothing, and one that calls a mail important
 * still cannot hide that the code flagged it as suspicious.
 */
export function mailShowTool(language: Language): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "mail_show",
      description:
        "Put mail in front of the person as cards, after a mail_list. Give the ids worth showing — the ones that need the person's attention — and for each one a single line, in " +
        GIST_LANGUAGE[language] +
        ", saying what the mail wants from them. Write that line in the language above and in no other, and keep it to one short sentence: it is shown under the subject. An id that is not from the last mail_list is dropped, so only propose ids that list gave you. Do not pass a bulk newsletter, and do not mention this tool to the person.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "The mails to show, in the order the person should read them.",
            items: {
              type: "object",
              properties: {
                id: { type: "integer", description: "The mail's id, exactly as mail_list gave it." },
                gist: { type: "string", description: "One short line about what this mail wants." },
              },
              required: ["id", "gist"],
            },
          },
        },
        required: ["items"],
      },
    },
  };
}
