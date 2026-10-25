// The tool list the model is offered (one responsibility: the five browser
// tools, few and simple on purpose — small models lose the thread when the
// choice list is wide, so there is no scroll, no back and no evaluate.
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Open a url in the browser and see the page.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute url, including https://" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_snapshot",
      description:
        "Read the current page as a list of elements. Every line is one element; " +
        "the [e12] in front of it is its ref, and that ref is what the other tools take. " +
        "A long page arrives in parts: if the last line says so, call this again with page 2, and so on.",
      parameters: {
        type: "object",
        properties: { page: { type: "integer", description: "Which part to read, counting from 1" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_find",
      description:
        "Search the current page for some text and get back the matching lines, " +
        "with a line either side. Use it to find something on a page too long to read in one snapshot.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The words to look for, e.g. Saturday" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click the element with this ref.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string", description: "An element ref from the last snapshot, e.g. e12" } },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_type",
      description:
        "Type text into the element with this ref. Enter follows on its own for a " +
        "one-line field; there is no submit argument.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref of a textbox, e.g. e8" },
          text: { type: "string", description: "The text to type" },
        },
        required: ["ref", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_select",
      description: "Choose a value in a dropdown.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref of a combobox, e.g. e4" },
          value: { type: "string", description: "Value or visible label of the option" },
        },
        required: ["ref", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Give the final answer to the user and stop. Call this when the task is done.",
      parameters: {
        type: "object",
        properties: { answer: { type: "string", description: "The answer to the user's question, in their language" } },
        required: ["answer"],
      },
    },
  },
];

/** The tool names, for telling an invented call from a real one. */
export const TOOL_NAMES = TOOLS.map((t) => t.function.name);