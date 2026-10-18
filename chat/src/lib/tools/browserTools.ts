import type { ToolDefinition } from "./definitions";

/**
 * The three read tools the chat offers in this step, and the two it does not.
 *
 * **Open, read and find only.** `browser_click` and `browser_type` exist on the
 * sidecar and are pinned in `tool_pins.json` because they are there, not
 * because they are offered: writing to a site is step 4 and comes with the
 * confirms that guard it. They are listed here so that a call to one is a
 * refusal with a sentence rather than "there is no tool called that", which
 * would leave the model inventing one.
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
];

/** The names of the three above, for the places that ask about them by name. */
export const BROWSER_NAMES: ReadonlySet<string> = new Set(BROWSER_TOOLS.map((tool) => tool.function.name));

/** The two that exist on the sidecar and are not offered yet. */
export const WITHHELD: Record<string, string> = {
  browser_click: "Not run: this build does not let Kalsa click. Answer from what the page says.",
  browser_type: "Not run: this build does not let Kalsa type. Answer from what the page says.",
};

/** The sentence for a tool the sidecar has and this build does not offer. */
export function withheld(name: string): string | null {
  return WITHHELD[name] ?? null;
}