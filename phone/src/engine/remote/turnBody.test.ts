import { TURN_CAPABILITIES, toTurnMessages, turnBodyJson } from "./turnBody";

describe("the body of a turn to the computer", () => {
  test("the body is the conversation, the phone's language and what it can draw", () => {
    const body = JSON.parse(
      turnBodyJson({
        messages: toTurnMessages([
          { role: "user", content: "quali mail ho?" },
          { role: "assistant", content: "questa", modelEmittedText: "questa" },
        ]),
        language: "it",
        capabilities: TURN_CAPABILITIES,
      }),
    );
    expect(Object.keys(body).sort()).toEqual(["capabilities", "language", "messages"]);
    expect(body.messages).toHaveLength(2);
    // The computer reads this to know a card it holds may be drawn on this phone.
    expect(body.capabilities).toEqual(["browser_card"]);
  });

  test("an answer is sent as the model wrote it, not as it was cleaned", () => {
    const mapped = toTurnMessages([
      { role: "user", content: "ciao" },
      { role: "assistant", content: " <answer>ciao</answer>", modelEmittedText: "ciao" },
    ]);
    expect(mapped).toEqual([
      { role: "user", content: "ciao" },
      { role: "assistant", content: "ciao" },
    ]);
  });

  test("a message with nothing to say is left off the wire", () => {
    expect(
      toTurnMessages([
        { role: "user", content: "   " },
        { role: "assistant", content: "" },
        { role: "user", content: "davvero" },
      ]),
    ).toEqual([{ role: "user", content: "davvero" }]);
  });

  test("the mail a reply is for and the phone's language ride only when set", () => {
    expect(
      JSON.parse(
        turnBodyJson({ messages: [], replyFor: "105", language: "it", capabilities: TURN_CAPABILITIES }),
      ),
    ).toEqual({ messages: [], reply_for: "105", language: "it", capabilities: ["browser_card"] });
    expect(
      JSON.parse(turnBodyJson({ messages: [], capabilities: TURN_CAPABILITIES })),
    ).toEqual({ messages: [], capabilities: ["browser_card"] });
  });
});