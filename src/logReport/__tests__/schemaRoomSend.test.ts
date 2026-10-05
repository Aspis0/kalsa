import { formatRecord } from "../schema";
import { mintLocalId } from "../../pairing/pairingMap";

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
    expect(formatRecord("KALSA_ROOM_SEND", {
      op: "announce_fail",
      code: "storage_error",
      localId8: "abcdefgh",
      clientId8: "12345678",
      ms: 1,
    })).toContain('"op":"announce_fail"');
  });

  it("accepts the real local id prefix minted by the pairing map", () => {
    const localId = mintLocalId({ active: null, records: [] });
    const localId8 = localId.slice(0, 8);

    expect(localId).toMatch(/^p[a-z0-9]+-[a-z0-9]+$/);
    expect(formatRecord("KALSA_ROOM_SEND", {
      op: "enqueue",
      localId8,
      clientId8: "0123abcd",
      ms: 0,
    })).toContain(`"localId8":"${localId8}"`);
  });
});
