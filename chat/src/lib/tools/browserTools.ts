import type { ToolDefinition } from "./definitions";

/**
 * The five browser tools: three that read, and two that write.
 *
 * **A write is offered, and a write is held.** `browser_click` and
 * `browser_type` can send a request, and the answer they give when one is sent
 * is not the page — it is `awaiting confirm`, an id, and a person deciding. The
 * model has no way to answer that itself, and is told so in the sidecar's own
 * instructions, so the offer is honest rather than a promise it cannot keep.
 *
 * **A phone is offered the reads and not the writes**, and the filter that says
 * so is in `phone/phoneTurn.ts`: `BROWSER_WRITES` is the two tools that can put a
 * request in front of a person, and they are offered to a phone only when the
 * turn names the phone it authenticated as. A turn with no device has nobody who
 * could be shown the card, so a card raised there would be one nobody is ever
 * asked about — better no write than a write nobody answers.
 *
 * The descriptions are short and plain, and say what the answer is rather than
 * how to use the browser: the model reads them in every language this app
 * ships, and a long one is a page of English it has to carry.
 */
export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "browser_open",
      description: "Opens a web page in the browser and shows what is on it.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http or https address to open." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_read",
      description: "Reads the open page as text, one element per line, with a ref for each thing you can act on.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "number", description: "Which page of a long result to read. Omit for the first." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_find",
      description: "Finds text on the open page and reads the part around it.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The words to look for on the page." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description:
        "Clicks one element on the open page. If that sends anything, it is held for the person to allow first: the answer names the request and says it is waiting, and the page does not move until they decide.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "The ref of the element, from a read." },
        },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_type",
      description:
        "Types into one field on the open page. A single-line field that is in no form is finished with Enter, and a search field is finished with Enter even inside a form; any other field inside a form is left alone, so click that form's own submit button once it is filled. If that sends anything, it is held for the person to allow first: the answer names the request and says it is waiting.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "The ref of the field, from a read." },
          text: { type: "string", description: "What to write into the field." },
        },
        required: ["ref", "text"],
      },
    },
  },
];

/** The names of the five above, for the places that ask about them by name. */
export const BROWSER_NAMES: ReadonlySet<string> = new Set(BROWSER_TOOLS.map((tool) => tool.function.name));