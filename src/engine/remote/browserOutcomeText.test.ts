/**
 * Every code PHONE-CHAT-PROTOCOL §3.1 names has its own sentence, and no code
 * that arrives without being named gets a sentence invented for it.
 *
 * The assertions here are about the KEYS, not the wording: the phone's languages
 * live in `i18n`, and what must not drift is which code is allowed to say what.
 */
import {
  answerLeftNothingSent,
  humanBrowserAnswerFailure,
  humanBrowserOutcome,
} from "./browserOutcomeText";

const t = (key: string, vars?: Record<string, string>) =>
  vars === undefined ? key : `${key}:${JSON.stringify(vars)}`;

describe("the six outcomes a card can end in", () => {
  it("each has a sentence of its own", () => {
    const keys = ["sent", "declined", "expired", "gone", "unsendable", "unclear"].map((code) =>
      humanBrowserOutcome(code, "", t),
    );
    expect(new Set(keys).size).toBe(6);
    expect(keys.every((key) => !key.includes("unknown"))).toBe(true);
  });

  it("only the request that went names a place", () => {
    expect(humanBrowserOutcome("sent", "shop.example", t)).toBe(
      'chat.browser.sentTo:{"to":"shop.example"}',
    );
    for (const code of ["declined", "expired", "gone", "unsendable", "unclear"]) {
      expect(humanBrowserOutcome(code, "shop.example", t)).not.toContain("shop.example");
    }
  });

  it("a code the contract does not name gets the plain sentence, not a guess", () => {
    expect(humanBrowserOutcome("constructor", "", t)).toBe("chat.browser.unknown");
    expect(humanBrowserOutcome("posted", "", t)).toBe("chat.browser.unknown");
  });
});

describe("the four refusals an answer can meet", () => {
  it("each has a sentence of its own", () => {
    const keys = ["card_unknown", "card_expired", "cancelled", "busy"].map((code) =>
      humanBrowserAnswerFailure(code, t),
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys.every((key) => !key.includes("Generic"))).toBe(true);
  });

  it("cancelled means no window could take it — not an unreachable computer", () => {
    // The door answered this one, so the road's own sentence would be a lie.
    expect(humanBrowserAnswerFailure("cancelled", t)).toBe("chat.browser.failCancelled");
    expect(humanBrowserAnswerFailure("cancelled", t)).not.toBe(
      humanBrowserAnswerFailure("remote_brain_network", t),
    );
  });

  it("a dead road is the road's sentence, in both families", () => {
    expect(humanBrowserOutcome("remote_brain_network", "", t)).toBe(
      "settings.remoteBrainFailNetwork",
    );
    expect(humanBrowserAnswerFailure("remote_brain_network", t)).toBe(
      "settings.remoteBrainFailNetwork",
    );
  });

  it("an unknown refusal never echoes itself, and never claims nothing was sent", () => {
    expect(humanBrowserAnswerFailure("card_unknown2", t)).toBe("chat.browser.failUncertain");
  });

  it("only the two refusals that PROVE it may say nothing was sent", () => {
    expect(answerLeftNothingSent("card_expired")).toBe(true);
    expect(answerLeftNothingSent("card_unknown")).toBe(true);
    // Silence about a request that may already have gone to a stranger.
    for (const code of ["remote_brain_network", "browser_unreadable", "busy", "cancelled", ""]) {
      expect(answerLeftNothingSent(code)).toBe(false);
    }
  });
});