import { getStrings, type Locale } from "../i18n";
import { saveNote, titleFromNoteBody, type Note } from "../notes/NotesStore";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

export const WRITE_NOTE_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "write_note",
    description:
      "Create a new local-only markdown note from model-composed content, which may include recalled context. " +
      "Pass title and body. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Note title, shown in the Notes list.",
        },
        body: {
          type: "string",
          description: "Markdown content of the note.",
        },
      },
      required: ["title", "body"],
    },
  },
};

type WriteNoteDeps = {
  saveNote?: typeof saveNote;
};

function bodyWithTitle(title: string, body: string): string {
  if (!title) return body;
  const firstLine = body.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
  const comparableFirstLine = firstLine.replace(/^#{1,6}\s+/, "");
  return comparableFirstLine === title ? body : `${title}\n${body}`;
}

function successResult(note: Note, truncated: boolean): EngineToolResult {
  return {
    text: JSON.stringify({
      ok: true,
      id: note.id,
      title: note.title,
      charCount: note.body.length,
      ...(truncated ? { truncated: true } : {}),
    }),
    kind: "write_note",
  };
}

export function makeWriteNoteExecutor(
  locale: Locale,
  deps?: WriteNoteDeps,
): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<EngineToolResult> {
  const write = deps?.saveNote ?? saveNote;

  return async (name, args, signal) => {
    const strings = getStrings(locale);
    if (name !== "write_note") {
      return { text: strings.errors.unknownTool.replace("{name}", name) };
    }

    const raw = args && typeof args === "object" ? args : {};
    const body = typeof raw.body === "string" ? raw.body : "";
    if (!body.replace(/\u0000/g, "").trim()) {
      return {
        text: strings.errors.writeNoteEmptyBody,
        kind: "write_note",
        error: "empty_body",
      };
    }

    const rawTitle = typeof raw.title === "string" ? raw.title : "";
    const title = titleFromNoteBody(rawTitle.replace(/\u0000/g, ""));
    const composedBody = bodyWithTitle(title, body);
    const bodyBeforeSave = composedBody.replace(/\u0000/g, "");

    if (signal?.aborted) {
      return {
        text: strings.errors.writeNoteAborted,
        kind: "write_note",
        error: "aborted",
      };
    }

    try {
      const note = await write(composedBody);
      return successResult(note, note.body.length < bodyBeforeSave.length);
    } catch {
      return {
        text: strings.errors.writeNoteFailed,
        kind: "write_note",
        error: "write_failed",
      };
    }
  };
}
