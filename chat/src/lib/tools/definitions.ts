/**
 * The three tools the assistant can call, in the shape every OpenAI-compatible
 * server expects for function calling. The descriptions are what the model
 * reads when deciding to call one, so they say when the tool is worth calling
 * and what comes back.
 */
import { MINIAPP_TEMPLATE_IDS } from "../miniapp/templates";

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
        "Search the web for current information: news, facts, prices, events, people — anything the model may not know. Returns the top results with their titles, URLs and a short excerpt. Use web_fetch to actually read a result.",
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
