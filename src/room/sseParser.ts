/**
 * The SSE wire, parsed: `field: value` lines into one message per blank
 * line, multi-line `data` joined with newlines, comments (the door's
 * `: ping`) recognised and dropped, and the spec's persistence — the
 * `event` type resets to "message" after every dispatch while `id`
 * carries over until the next `id:` line. Feed it whatever slices the
 * transport delivers; a message is returned only when its final blank
 * line has arrived whole.
 */

export type SseMessage = { id: string | null; event: string; data: string };

export type SseParser = {
  /** Bytes as they arrive; returns every message completed by them. */
  push(chunk: string): SseMessage[];
};

export function createSseParser(): SseParser {
  let lineBuffer = "";
  let id: string | null = null;
  let event = "";
  let dataLines: string[] = [];
  let firstPush = true;

  const dispatch = (): SseMessage | null => {
    if (dataLines.length === 0) {
      // The spec dispatches nothing without data; event and id persist.
      event = "";
      return null;
    }
    const message: SseMessage = { id, event: event === "" ? "message" : event, data: dataLines.join("\n") };
    event = "";
    dataLines = [];
    return message;
  };

  const consumeLine = (line: string): SseMessage | null => {
    if (line === "") return dispatch();
    if (line.charCodeAt(0) === 0x3a) return null; // ":" comment, ping among them
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.charCodeAt(0) === 0x20) value = value.slice(1); // one leading space only
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
    return null; // "retry" and unknown fields are the protocol's to grow
  };

  return {
    push(chunk: string): SseMessage[] {
      let text = chunk;
      if (firstPush) {
        firstPush = false;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // the BOM belongs to the stream, not the first field
      }
      const messages: SseMessage[] = [];
      let start = 0;
      for (;;) {
        const newline = text.indexOf("\n", start);
        if (newline === -1) break;
        // The door's frames end in \n; a trailing \r is tolerated for the
        // CRLF case, including one split across two pushes.
        let line = lineBuffer + text.slice(start, newline);
        lineBuffer = "";
        if (line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1);
        const message = consumeLine(line);
        if (message !== null) messages.push(message);
        start = newline + 1;
      }
      lineBuffer += text.slice(start);
      return messages;
    },
  };
}
