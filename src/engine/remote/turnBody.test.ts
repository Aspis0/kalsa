import { toTurnMessages, turnBodyJson } from "./turnBody";

describe("the body of a turn to the computer", () => {
  test("the body is the conversation and nothing else", () => {
    const body = JSON.parse(
      turnBodyJson({
        messages: toTurnMessages([
          { role: "user", content: "quali mail ho?" },
          { role: "assistant", content: "questa", modelEmittedText: "questa" },
        ]),
        language: "it",
      }),
    );
    expect(Object.keys(body).sort()).toEqual(["language", "messages"]);
    expect(body.messages).toHaveLength(2);
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
      JSON.parse(turnBodyJson({ messages: [], replyFor: "105", language: "it" })),
    ).toEqual({ messages: [], reply_for: "105", language: "it" });
    expect(JSON.parse(turnBodyJson({ messages: [] }))).toEqual({ messages: [] });
  });
});