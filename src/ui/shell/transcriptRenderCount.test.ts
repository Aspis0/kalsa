jest.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));

jest.mock("lucide-react-native", () => ({ ArrowDown: "ArrowDown" }));
jest.mock("../../i18n", () => {
  const t = (key: string) => key;
  return { useLocale: () => ({ t }) };
});
jest.mock("../../theme/design", () => ({
  modes: { light: { ink: "#111", ink2: "#222", accent: "#333" } },
}));
jest.mock("./TranscriptEdgeFade", () => ({ TranscriptEdgeFade: () => null }));
jest.mock("./TranscriptParts", () => ({
  createTranscriptStyles: () => ({
    root: {}, content: {}, scroll: {}, dayMarker: {}, hairline: {}, dayLabel: {},
    jumpBox: {}, jump: {}, jumpLabel: {},
  }),
}));
jest.mock("./TranscriptTurns", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    Answer: ({ id }: { id: string }) => {
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
      return React.createElement("Answer", { id });
    },
    UserTurn: ({ id }: { id: string }) => {
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
      return React.createElement("UserTurn", { id });
    },
  };
});
jest.mock("./transcriptScroll", () => ({
  PROGRAMMATIC_SCROLL_GRACE_MS: 100,
  duplicateMessageIds: () => [],
  transcriptScroll: () => ({ pinned: true, scrollTo: null }),
}));
jest.mock("./transcriptLayout", () => ({
  isSameDay: () => true,
  rhythmGap: () => 0,
  shouldShowDayMarker: () => false,
  transcriptLayout: () => ({ availableHeight: 600, readingMeasure: 320, capsuleMaxWidth: 300 }),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { TranscriptMessage, TranscriptProps } from "./transcriptTypes";
import { Transcript } from "./Transcript";

const renderCounts = new Map<string, number>();
const insets = { top: 0, bottom: 0 };
const completedUser: TranscriptMessage = {
  id: "user-1", role: "user", text: "Question", createdAt: 1,
};
const completedAnswer: TranscriptMessage = {
  id: "answer-1", role: "assistant", text: "Earlier answer", createdAt: 2,
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function props(messages: readonly TranscriptMessage[]): TranscriptProps {
  return { messages, insets, mode: "light", now: 10 };
}

describe("transcript render isolation", () => {
  beforeEach(() => renderCounts.clear());

  test("stream flushes render only the changed answer; typing renders no transcript rows", async () => {
    const initial: TranscriptMessage = {
      id: "answer-live", role: "assistant", text: "a", caret: true, createdAt: 3,
    };
    const messages = [completedUser, completedAnswer, initial];
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Transcript, props(messages))); });
    expect([...renderCounts]).toEqual([["user-1", 1], ["answer-1", 1], ["answer-live", 1]]);

    const flushes = 5;
    let current = initial;
    for (let index = 0; index < flushes; index += 1) {
      current = {
        ...initial,
        text: `${"a".repeat(index + 2)}`,
      };
      await act(async () => {
        renderer.update(React.createElement(Transcript, props([completedUser, completedAnswer, current])));
      });
    }

    expect(renderCounts.get("user-1")).toBe(1);
    expect(renderCounts.get("answer-1")).toBe(1);
    expect(renderCounts.get("answer-live")).toBe(flushes + 1);

    const beforeTyping = new Map(renderCounts);
    for (let index = 0; index < flushes; index += 1) {
      await act(async () => {
        renderer.update(React.createElement(Transcript, props([completedUser, completedAnswer, current])));
      });
    }
    expect([...renderCounts]).toEqual([...beforeTyping]);
    await act(async () => renderer.unmount());
  });
});
