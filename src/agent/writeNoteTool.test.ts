import { getStrings } from "../i18n";
import { NOTE_BODY_CAP, titleFromNoteBody } from "../notes/NotesStore";
import { makeWriteNoteExecutor, WRITE_NOTE_TOOL } from "./writeNoteTool";

function savedNote(body: string, title = "Saved title") {
  return {
    id: "note-1",
    title,
    updatedAt: 123,
    body,
  };
}

describe("write_note tool", () => {
  test("rejects an empty body", async () => {
    const saveNote = jest.fn();
    const execute = makeWriteNoteExecutor("en", { saveNote });

    const result = await execute("write_note", { title: "Title", body: " \n" });

    expect(result).toEqual({
      text: getStrings("en").errors.writeNoteEmptyBody,
      kind: "write_note",
      error: "empty_body",
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  test("rejects a NUL-only body", async () => {
    const saveNote = jest.fn();
    const execute = makeWriteNoteExecutor("en", { saveNote });

    const result = await execute("write_note", { body: "\u0000\u0000" });

    expect(result).toEqual({
      text: getStrings("en").errors.writeNoteEmptyBody,
      kind: "write_note",
      error: "empty_body",
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  test("prepends a clipped title and returns compact metadata", async () => {
    const title = "A".repeat(60);
    const clippedTitle = titleFromNoteBody(title);
    const saveNote = jest
      .fn()
      .mockResolvedValue(savedNote(`${clippedTitle}\nBody`, clippedTitle));
    const execute = makeWriteNoteExecutor("en", { saveNote });

    const result = await execute("write_note", { title, body: "Body" });

    expect(saveNote).toHaveBeenCalledWith(`${clippedTitle}\nBody`);
    expect(JSON.parse(result.text)).toEqual({
      ok: true,
      id: "note-1",
      title: clippedTitle,
      charCount: clippedTitle.length + 5,
    });
    expect(result.kind).toBe("write_note");
  });

  test("does not double-prepend an existing first-line title", async () => {
    const saveNote = jest.fn().mockResolvedValue(savedNote("Title\nBody", "Title"));
    const execute = makeWriteNoteExecutor("en", { saveNote });

    await execute("write_note", { title: "Title", body: "Title\nBody" });

    expect(saveNote).toHaveBeenCalledWith("Title\nBody");
  });

  test("does not double-prepend an ATX heading title", async () => {
    const saveNote = jest.fn().mockResolvedValue(savedNote("# Foo\nrest", "Foo"));
    const execute = makeWriteNoteExecutor("en", { saveNote });

    await execute("write_note", { title: "Foo", body: "# Foo\nrest" });

    expect(saveNote).toHaveBeenCalledWith("# Foo\nrest");
  });

  test("preserves the body when the title is empty", async () => {
    const saveNote = jest.fn().mockResolvedValue(savedNote("Body", "Body"));
    const execute = makeWriteNoteExecutor("en", { saveNote });

    await execute("write_note", { title: " \n ", body: "Body" });

    expect(saveNote).toHaveBeenCalledWith("Body");
  });

  test("returns an i18n failure when saveNote rejects", async () => {
    const saveNote = jest.fn().mockRejectedValue(new Error("disk full"));
    const execute = makeWriteNoteExecutor("it", { saveNote });

    const result = await execute("write_note", { body: "Body" });

    expect(result).toEqual({
      text: getStrings("it").errors.writeNoteFailed,
      kind: "write_note",
      error: "write_failed",
    });
    expect(saveNote).toHaveBeenCalledWith("Body");
  });

  test("reports truncation when NotesStore shortens the body", async () => {
    const input = "x".repeat(NOTE_BODY_CAP + 1);
    const saveNote = jest
      .fn()
      .mockResolvedValue(savedNote(input.slice(0, NOTE_BODY_CAP), "x"));
    const execute = makeWriteNoteExecutor("en", { saveNote });

    const result = await execute("write_note", { body: input });

    expect(JSON.parse(result.text)).toMatchObject({
      ok: true,
      charCount: NOTE_BODY_CAP,
      truncated: true,
    });
  });

  test("does not write after the signal is aborted", async () => {
    const saveNote = jest.fn();
    const execute = makeWriteNoteExecutor("en", { saveNote });
    const controller = new AbortController();
    controller.abort();

    const result = await execute("write_note", { body: "Body" }, controller.signal);

    expect(result).toEqual({
      text: getStrings("en").errors.writeNoteAborted,
      kind: "write_note",
      error: "aborted",
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  test("rejects missing and non-string bodies", async () => {
    const saveNote = jest.fn();
    const execute = makeWriteNoteExecutor("en", { saveNote });

    await expect(execute("write_note", {})).resolves.toMatchObject({
      error: "empty_body",
    });
    await expect(execute("write_note", { body: 42 })).resolves.toMatchObject({
      error: "empty_body",
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  test("does not expose filesystem path arguments", () => {
    const parameters = WRITE_NOTE_TOOL.function.parameters;
    const properties = parameters.properties as Record<string, unknown>;

    expect(Object.keys(properties)).toEqual(["title", "body"]);
    expect(properties).not.toHaveProperty("path");
    expect(properties).not.toHaveProperty("filePath");
  });
});
