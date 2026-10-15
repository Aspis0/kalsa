import { humanContractFailure, isContractFailureCode } from "./phoneChatFailures";
import { en, makeT } from "../../i18n";

const t = makeT("en");

describe("a failure code the phone has words for", () => {
  it("each code the contract names says its own sentence", () => {
    expect(humanContractFailure("busy", t)).toBe(en.chat.mail.failBusy);
    expect(humanContractFailure("no_runner", t)).toBe(en.chat.mail.failNoRunner);
    expect(humanContractFailure("mail.invalid_account", t)).toBe(en.chat.mail.failInvalidAccount);
    expect(humanContractFailure("draft_unknown", t)).toBe(en.chat.mail.failDraftExpired);
    // A cancellation is the turn's own interrupted copy.
    expect(humanContractFailure("cancelled", t)).toBe(en.chat.interrupted);
  });

  it("the door's own codes say what they already said", () => {
    expect(humanContractFailure("remote_brain_network", t)).toBe(en.settings.remoteBrainFailNetwork);
    expect(humanContractFailure("remote_brain_http_401", t)).toBe(
      en.settings.remoteBrainFailUnpaired,
    );
  });

  it("an unknown, malformed or absent code says the generic sentence", () => {
    expect(humanContractFailure("mail.newflag", t)).toBe(en.chat.mail.failGeneric);
    expect(humanContractFailure("stream_malformed", t)).toBe(en.chat.mail.failGeneric);
    expect(humanContractFailure("not a code at all", t)).toBe(en.chat.mail.failGeneric);
    expect(humanContractFailure(undefined, t)).toBe(en.chat.mail.failGeneric);
  });

  it("a code off the wire cannot reach an inherited member", () => {
    expect(isContractFailureCode("constructor")).toBe(false);
    expect(isContractFailureCode("__proto__")).toBe(false);
    expect(isContractFailureCode("toString")).toBe(false);
    expect(humanContractFailure("constructor", t)).toBe(en.chat.mail.failGeneric);
    expect(isContractFailureCode("busy")).toBe(true);
  });
});