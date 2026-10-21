import type { ToolDefinition } from "./definitions";

/** Authenticated phone turns may drive the browser; the model cannot approve
 * intercepted submissions. Page data requests follow the browser policy. */
export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "browser_open",
      description:
        "Opens a web page in the browser and shows what is on it. Use it when the person asks to see a page: it is the only tool that shows the real page, with its links and its fields. Use an address as printed, or the product's own short address when its pieces have been printed in a link you have already read. To follow a link on the current page, click that link's ref instead of opening it by hand.",
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

/**
 * **The picture of the page.** Not one of the five: it is offered only in the
 * turns that may see one — the person armed the browser for that message,
 * the hidden switch is on, and the engine has eyes.
 *
 * **The description is the model's only word about it**, so it says what the
 * picture is: a photograph of the viewport, not the page's text. A model that
 * believes it is reading the page's words will say the page said something it
 * did not.
 */
export const BROWSER_SCREENSHOT: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_screenshot",
    description:
      "Takes one picture of the page you are driving and lets you look at it. The picture is a photograph of the window as it is now — the viewport, not the page's text. Use it to get your bearings on the page, to check what the page's own words do not say (a price, a total, an error message, whether a form is full or half filled), and to see what is on the screen when reading the text is not enough. The picture belongs to the conversation that opened the page: a page that is not yours is refused. Nothing is written and nothing is sent — this is a look, not a step.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

/** The picture's own name, for the places that ask about it by name. */
export const BROWSER_SCREENSHOT_NAME = BROWSER_SCREENSHOT.function.name;

/**
 * The browser's names: the five above and the picture.
 *
 * **The picture is in here, and it has to be.** The places that ask "is this a
 * browser tool" must count it — a phone may not be offered it, a paused
 * browser may not take one, and a call to it belongs to the browser's ledger
 * like any other. The offer is a different question, and it is answered in
 * `registry.ts`: the picture is offered only in the turns that may see one.
 */
export const BROWSER_NAMES: ReadonlySet<string> = new Set([
  ...BROWSER_TOOLS.map((tool) => tool.function.name),
  BROWSER_SCREENSHOT_NAME,
]);

/**
 * **Whether this turn may see the page.** Three things have to hold, and the
 * caller is the only place that knows all three: the person armed the browser
 * for this turn, the hidden switch is on, and the engine has eyes.
 *
 * **The switch is the lever.** It is off by default, so a build nobody asked
 * for this feature never offers a picture — whatever the other two say.
 */
export interface PictureGate {
  /** The person armed the browser for this turn. */
  armed: boolean;
  /** The hidden setting. */
  flag: boolean;
  /** The engine can see. */
  vision: boolean;
}

/** Whether the gate is open. One place, so the offer and the call agree. */
export function picturesAllowed(gate: PictureGate | undefined): boolean {
  return gate !== undefined && gate.armed && gate.flag && gate.vision;
}
