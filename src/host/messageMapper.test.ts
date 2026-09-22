/**
 * Mapper tests: the `Message → TranscriptMessage` bridge is new, so every
 * rule it carries gets pinned here — sources across, status dropped, the
 * cloud's three phases, the volatile tool rows, and the tool-name branch
 * the old consumer never had (D1 rows 22–24, D2 row 3's spirit: a stale or
 * malformed payload never invents data).
 */
import { en } from "../i18n/en";
import { sanitizeHistoryMessages } from "./historyMessages";
import {
  toolNameFromActionsPayload,
  toTranscriptMessage,
  toTranscriptMessages,
  type MapperOptions,
} from "./messageMapper";
import type { Message } from "./hostMessage";

const THINKING = en.chat.thinkingStatus as string;
const WRITING = en.chat.writingStatus as string;

const opts = (extra?: Partial<MapperOptions>): MapperOptions => ({
  thinkingStatus: THINKING,
  ...extra,
});

const base = (over: Partial<Message>): Message => ({
  id: "m1",
  role: "user",
  text: "hello",
  createdAt: 1_700_000_000_000,
  ...over,
});

describe("toTranscriptMessage", () => {
  test("maps a user turn verbatim with no thinking and no tools", () => {
    const out = toTranscriptMessage(base({ id: "u1" }), opts());
    expect(out).toEqual({
      id: "u1",
      role: "user",
      text: "hello",
      createdAt: 1_700_000_000_000,
    });
  });

  test("maps sources across, keeping the url-less legacy source's title", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        sources: [
          { title: "NIST", url: "https://www.nist.gov/x" },
          { title: "Legacy title" },
        ],
      }),
      opts(),
    );
    expect(out.sources).toEqual([
      { url: "https://www.nist.gov/x", title: "NIST" },
      { url: "", title: "Legacy title" },
    ]);
  });

  test("no sources array on the message → no sources field on the row", () => {
    const out = toTranscriptMessage(base({ role: "assistant" }), opts());
    expect("sources" in out).toBe(false);
  });

  test("live turn in the thinking phase opens the cloud working, even pre-token", () => {
    const out = toTranscriptMessage(
      base({ role: "assistant", text: "", streaming: true, statusLabel: THINKING }),
      opts(),
    );
    expect(out.thinking).toEqual({ reasoning: "", working: true, answered: false });
  });

  test("live thinking phase with arriving reasoning stays working and unanswered", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "",
        streaming: true,
        statusLabel: THINKING,
        thinkingText: "weighing two methods",
      }),
      opts(),
    );
    expect(out.thinking).toEqual({
      reasoning: "weighing two methods",
      working: true,
      answered: false,
    });
  });

  test("live writing phase with reasoning settles the cloud once text arrives", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "The third method",
        streaming: true,
        statusLabel: WRITING,
        thinkingText: "weighing two methods",
      }),
      opts(),
    );
    expect(out.thinking).toEqual({
      reasoning: "weighing two methods",
      working: false,
      answered: true,
    });
  });

  test("live tool round (status not thinking, empty text) keeps the cloud unanswered", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "",
        streaming: true,
        statusLabel: en.chat.searching as string,
        thinkingText: "needs a search",
      }),
      opts(),
    );
    expect(out.thinking).toEqual({
      reasoning: "needs a search",
      working: false,
      answered: false,
    });
  });

  test("a restored message never reports working, whatever status it carries", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "done",
        streaming: false,
        statusLabel: THINKING,
        thinkingText: "thought",
      }),
      opts(),
    );
    expect(out.thinking).toEqual({
      reasoning: "thought",
      working: false,
      answered: true,
    });
  });

  test("no reasoning and not in the thinking phase → no cloud", () => {
    const out = toTranscriptMessage(
      base({ role: "assistant", text: "plain", streaming: false }),
      opts(),
    );
    expect(out.thinking).toBeUndefined();
  });

  test("tools ride only for the assistant id the capture map names", () => {
    const toolsById = new Map([["a1", [{ name: "web_search" }]]]);
    const withTools = toTranscriptMessage(base({ id: "a1", role: "assistant" }), opts({ toolsById }));
    expect(withTools.tools).toEqual([{ name: "web_search" }]);
    const other = toTranscriptMessage(base({ id: "a2", role: "assistant" }), opts({ toolsById }));
    expect("tools" in other).toBe(false);
    const user = toTranscriptMessage(base({ id: "a1" }), opts({ toolsById }));
    expect("tools" in user).toBe(false);
  });

  test("an empty capture entry draws no tool field", () => {
    const toolsById = new Map([["a1", [] as { name: string }[]]]);
    const out = toTranscriptMessage(base({ id: "a1", role: "assistant" }), opts({ toolsById }));
    expect("tools" in out).toBe(false);
  });

  test("toTranscriptMessages preserves order and ids", () => {
    const messages = [base({ id: "u1" }), base({ id: "a2", role: "assistant" })];
    const out = toTranscriptMessages(messages, opts());
    expect(out.map((m) => m.id)).toEqual(["u1", "a2"]);
  });
});

describe("sanitize → mapper round trip", () => {
  test("sources persist, status is volatile, interrupted partial comes back marked", () => {
    const raw = [
      {
        id: "u1",
        role: "user",
        text: "q",
        createdAt: 5,
      },
      {
        id: "a1",
        role: "assistant",
        text: "partial",
        createdAt: 6,
        streaming: true,
        statusLabel: "Writing",
        statusHistory: ["Writing"],
        interrupted: true,
        thinkingText: "hmm",
        sources: [{ title: "T", url: "https://example.com" }],
      },
    ];
    const restored = sanitizeHistoryMessages(raw, "en");
    expect(restored[1].statusLabel).toBeUndefined();
    expect(restored[1].statusHistory).toBeUndefined();
    expect(restored[1].streaming).toBeUndefined();
    expect(restored[1].interrupted).toBe(true);
    expect(restored[1].sources).toHaveLength(1);
    const out = toTranscriptMessages(restored, opts());
    expect(out[1].sources).toEqual([{ url: "https://example.com", title: "T" }]);
    // Interrupted partial is a settled cloud + plain text: the marker itself
    // has no transcript representation yet (PARITY row 25, reported).
    expect(out[1].thinking).toEqual({ reasoning: "hmm", working: false, answered: true });
    expect(out[1].text).toBe("partial");
  });

  test("an interrupted marker with empty text is dropped by sanitize and grows no cloud", () => {
    const restored = sanitizeHistoryMessages(
      [{ id: "a1", role: "assistant", text: "   ", createdAt: 1, interrupted: true }],
      "en",
    );
    expect(restored[0].interrupted).toBeUndefined();
    const out = toTranscriptMessage(restored[0], opts());
    expect(out.thinking).toBeUndefined();
  });
});

describe("toolNameFromActionsPayload", () => {
  test("extracts the name from the bridge's tool payload", () => {
    expect(
      toolNameFromActionsPayload({ kind: "tool", tool: { name: "web_search", arguments: {} } }),
    ).toBe("web_search");
  });

  test("a proposed_actions payload yields null (the old consumer's shape)", () => {
    expect(toolNameFromActionsPayload({ proposed_actions: [{ executable: true }] })).toBeNull();
  });

  test("malformed payloads never invent a name", () => {
    expect(toolNameFromActionsPayload(null)).toBeNull();
    expect(toolNameFromActionsPayload("tool")).toBeNull();
    expect(toolNameFromActionsPayload({ kind: "tool" })).toBeNull();
    expect(toolNameFromActionsPayload({ kind: "tool", tool: {} })).toBeNull();
    expect(toolNameFromActionsPayload({ kind: "tool", tool: { name: "" } })).toBeNull();
    expect(toolNameFromActionsPayload({ kind: "other", tool: { name: "x" } })).toBeNull();
  });
});
