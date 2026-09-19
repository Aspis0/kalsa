/**
 * The two tools the assistant can call, in the shape every OpenAI-compatible
 * server expects for function calling. The descriptions are what the model
 * reads when deciding to call one, so they say when the tool is worth calling
 * and what comes back.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
