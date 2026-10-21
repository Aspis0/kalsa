import type { ToolDefinition } from "./definitions";

/** Authenticated phone turns may drive the browser; the model cannot approve
 * intercepted submissions. Page data requests follow the browser policy. */
export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "browser_open",
      description:
        "Opens a web page in the browser and shows what is on it. Use it when the person asks to see a page: it is the only tool that shows the real page, with its links and its fields. Use an address exactly as printed, including its path and query. To follow a link on the current page, click that link's ref instead of opening it by hand.",
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
      description:
        "Reads the open page as text, one element per line, with a ref for each thing you can act on. A long page comes in parts, one at a time: use browser_find to jump to what you are after rather than reading every part.",
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
      description:
        "Finds text across all parts of the available page snapshot, including parts you have not read, and reads the lines around each match with their refs.",
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
        "Clicks one element on the open page. To open a product from a list of results, click that product's link — do not build its address by hand. If that submits a non-GET form, the request is held for the person to allow first: the answer names the request and says it is waiting, and the page does not move until they decide. Fetch/XHR requests follow normal browser behavior, subject to the typed-secret checks.",
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
        "Types into one field on the open page. A single-line field that is in no form is finished with Enter, and a search field is finished with Enter even inside a form; any other field inside a form is left alone, so click that form's own submit button once it is filled. If that submits a non-GET form, the request is held for the person to allow first: the answer names the request and says it is waiting. Fetch/XHR requests follow normal browser behavior, subject to the typed-secret checks.",
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
