/**
 * The adapter hands the engine half the send's date line in its options
 * argument, so the stamp reaches assembly and the research question alike.
 */
jest.mock("./engineTurn", () => ({ handleSendStream: jest.fn(async () => undefined) }));

import { handleSendStream } from "./engineTurn";
import { createSendEngine } from "./sendEngineAdapter";

const STAMP = "Sent on Thursday, 8 October 2026.";

const emit = { onDelta: jest.fn() };

function adapter() {
  return createSendEngine({
    engineDeps: {} as never,
    rich: { callbacks: {} } as never,
    attachments: [],
    isTurnOwner: () => true,
  });
}

describe("the send adapter carries the date line to the engine half", () => {
  beforeEach(() => jest.mocked(handleSendStream).mockClear());

  test("a stamped send passes its sentOn in the options argument", async () => {
    await adapter()({ text: "hi", sentOn: STAMP }, emit, new AbortController().signal);
    const sendOpts = jest.mocked(handleSendStream).mock.calls[0][7];
    expect(sendOpts?.sentOn).toBe(STAMP);
  });
});
