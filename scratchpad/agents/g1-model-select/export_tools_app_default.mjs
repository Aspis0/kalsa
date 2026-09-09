import { writeFileSync } from "node:fs";
import path from "node:path";

// Verbatim from toolRegistry.ts:85-142 and the definitions at:
// webSearchTool.ts:20-41, webFetchTool.ts:148-170,
// documentChatTool.ts:222-249, writeNoteTool.ts:5-27,
// deviceTools.ts:7-37, createMiniappTool.ts:18-52.
const tools = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information: news, facts, prices, events, people — anything the local model may not know. Returns top results with title, url and highlights. Results without preview text are worth opening with web_fetch.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — describe the ideal page, not just keywords." },
          numResults: { type: "number", description: "Number of results to return (default 4, max 5)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a web page or a PDF the model has seen in search results (or that the user pasted) and extract the passages relevant to a query. PDF text is extracted per page; passages are labeled with their page number. A scanned PDF with no text layer cannot be read (the tool says so). Only the first ~120k characters of page text are searched.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Web page or PDF URL to fetch — must be a search result or a link the user provided." },
          query: { type: "string", description: "What you want to find in the page — a specific question or topic, not a bare keyword dump." },
        },
        required: ["url", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_chat",
      description: "Query a local PDF or TXT document from the user's library. Pass a specific question as query. Optionally pass docId of a library document (or omit when only one document is in the library / one is attached). Returns relevant passages with page citations, or the full text for small documents. Scanned PDFs with no text layer return a vision-fallback marker.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you want to find in the document — a specific question or topic." },
          docId: { type: "string", description: "Library document id. Optional when the library has exactly one document." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_note",
      description: "Create a new local-only markdown note from model-composed content, which may include recalled context. Pass title and body. Do not pass this output to web_search.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title, shown in the Notes list." },
          body: { type: "string", description: "Markdown content of the note." },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "device_info",
      description: "Local device clock, UI locale, and battery percent if available. Do not pass this output to web_search.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "device_calc",
      description: "Evaluate a local arithmetic expression with + - * / and parentheses. Integers and decimals only. Do not pass this output to web_search.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Arithmetic expression, e.g. (3+4)*2" },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_miniapp",
      description: "Build an interactive on-device miniapp in a single call. Pick one template — compare_data (a comparison table), quick_calculator (a formula calculator), reading_quiz (a quiz with several questions), kpi_strip (key metrics), checklist (ordered steps), or pros_cons (pros vs cons) — and pass its slots. The app opens inline in the chat. Use this instead of writing miniapp JSON by hand.",
      parameters: {
        type: "object",
        properties: {
          template: { type: "string", enum: ["compare_data", "quick_calculator", "reading_quiz", "kpi_strip", "checklist", "pros_cons"], description: "Which miniapp template to build." },
          slots: { type: "object", description: "Per-template slots: compare_data (title?, columns[], rows[]), quick_calculator (title?, formula, fields[]), reading_quiz (title?, questions[] of {question, options[2..4], answerIndex?, explanation?}), kpi_strip (title?, metrics[] of {label, value, unit?, tone?}), checklist (title?, steps[] or items[]), or pros_cons (title?, rows[] of {pro?, con?}).", additionalProperties: true },
        },
        required: ["template"],
      },
    },
  },
];

const out = path.join(import.meta.dirname, "tools-app-default.json");
writeFileSync(out, `${JSON.stringify(tools, null, 2)}\n`);
console.log(`wrote=${out} tools=${tools.length}`);
