import { formatRecord } from "../schema";

describe("room send diagnostics privacy", () => {
  it("keeps bounded send steps and drops message text, credentials, and full ids", () => {
    const line = formatRecord("KALSA_ROOM_SEND", {
      op: "post",
      code: "unreachable",
      localId8: "p-lid-ab",
      clientId8: "0123abcd",
      ms: 14,
      text: "private message",
      token: "private credential",
      clientMsgId: "0123abcd0123abcd0123abcd0123abcd",
    });

    expect(line).toBe(
      'KALSA_ROOM_SEND {"op":"post","code":"unreachable","localId8":"p-lid-ab","clientId8":"0123abcd","ms":14}',
    );
    expect(line).not.toContain("private");
    expect(line).not.toContain("0123abcd0123abcd");
  });

  it("rejects unsafe identifier prefixes and unknown step names", () => {
    expect(formatRecord("KALSA_ROOM_SEND", {
      op: "post",
      localId8: "secret token",
      clientId8: "12345678",
      ms: 1,
    })).toBe('KALSA_ROOM_SEND {"op":"post","clientId8":"12345678","ms":1}');
    expect(formatRecord("KALSA_ROOM_SEND", {
      op: "send_text",
      localId8: "abcdefgh",
      clientId8: "12345678",
      ms: 1,
    })).toBe('KALSA_ROOM_SEND {"localId8":"abcdefgh","clientId8":"12345678","ms":1}');
  });
});
