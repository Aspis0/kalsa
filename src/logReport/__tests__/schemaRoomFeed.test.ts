import { formatRecord } from "../schema";

describe("room feed diagnostics privacy", () => {
  it("keeps feed shape and drops message content and names", () => {
    const line = formatRecord("KALSA_ROOM_FEED", {
      op: "entry",
      entries: 4,
      epoch8: "0123abcd",
      status: "ready",
      text: "private message",
      name: "Marco",
    });

    expect(line).toBe(
      'KALSA_ROOM_FEED {"op":"entry","entries":4,"epoch8":"0123abcd","status":"ready"}',
    );
    expect(line).not.toContain("private message");
    expect(line).not.toContain("Marco");
  });

  it("drops unknown operation and non-prefix epoch values", () => {
    expect(formatRecord("KALSA_ROOM_FEED", {
      op: "message_text",
      entries: 1,
      epoch8: "secret epoch",
      status: "ready",
    })).toBe('KALSA_ROOM_FEED {"entries":1,"status":"ready"}');
  });
});
