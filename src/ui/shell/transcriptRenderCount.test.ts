jest.mock("react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    // A structural FlatList: every row through `renderItem`, the streaming row
    // through the footer — enough to count renders, not to window them.
    // `mockSeenData` records each data array the list was rendered with, so a
    // test can hold the list's data identity steady across flushes.
    FlatList: (props: {
      data: readonly unknown[];
      renderItem: (info: { index: number; item: unknown }) => React.ReactElement;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ComponentType;
    }) => {
      mockSeenData.push(props.data as readonly TranscriptMessage[]);
      const rows = props.data.map((item, index) =>
        React.cloneElement(props.renderItem({ index, item }), { key: String(index) }),
      );
      const footer = props.ListFooterComponent
        ? React.createElement(props.ListFooterComponent)
        : null;
      const emptyNode = props.data.length === 0 ? props.ListEmptyComponent : null;
      return React.createElement("FlatList", null, rows, footer, emptyNode);
    },
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    Text: "Text",
    View: "View",
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  };
});

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
import { TRANSCRIPT_WINDOW_TAIL } from "./transcriptWindow";
import { Transcript } from "./Transcript";

const renderCounts = new Map<string, number>();
const mockSeenData: Array<readonly TranscriptMessage[]> = [];
const insets = { top: 0, bottom: 0 };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function props(messages: readonly TranscriptMessage[]): TranscriptProps {
  return { messages, insets, mode: "light", now: 10 };
}

/** Settled turns alternating user and answer, ids `row-0` … `row-(count-1)`. */
function settledRows(count: number): TranscriptMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: `Message ${index}`,
    createdAt: index + 1,
  }));
}

describe("transcript render isolation", () => {
  beforeEach(() => {
    renderCounts.clear();
    mockSeenData.length = 0;
  });

  test("with 50 messages a stream flush re-renders only the streaming row", async () => {
    const settled = settledRows(49);
    const live: TranscriptMessage = {
      id: "live", role: "assistant", text: "a", caret: true, createdAt: 999,
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Transcript, props([...settled, live])));
    });
    // The list holds the tail: the last TRANSCRIPT_WINDOW_TAIL settled rows
    // mount, the rows above them never mount at all, and the streaming row
    // mounts through the footer, outside the list's data.
    expect(renderCounts.size).toBe(TRANSCRIPT_WINDOW_TAIL + 1);
    for (const row of settled) {
      const mounted = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
      expect([row.id, renderCounts.get(row.id) ?? 0]).toEqual([row.id, mounted ? 1 : 0]);
    }
    expect(renderCounts.get("live")).toBe(1);
    expect(mockSeenData).toHaveLength(1);
    expect(mockSeenData[0]).toHaveLength(TRANSCRIPT_WINDOW_TAIL);
    expect(mockSeenData[0]!.some((message) => message.id === "live")).toBe(false);

    const flushes = 5;
    for (let index = 0; index < flushes; index += 1) {
      await act(async () => {
        renderer.update(
          React.createElement(Transcript, props([...settled, { ...live, text: "a".repeat(index + 2) }])),
        );
      });
    }

    // The list's data kept its identity through every flush, and every mounted
    // settled row rendered exactly once — the flush stopped at the streaming row.
    expect(new Set(mockSeenData).size).toBe(1);
    for (const row of settled) {
      const mounted = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
      expect([row.id, renderCounts.get(row.id) ?? 0]).toEqual([row.id, mounted ? 1 : 0]);
    }
    expect(renderCounts.get("live")).toBe(flushes + 1);
    await act(async () => renderer.unmount());
  });

  test("the flush cost does not depend on the conversation's length", async () => {
    // One flush: exactly one more render of the streaming row, none of any
    // settled row — whatever the conversation holds. The mounted count is
    // capped by the window, not by the conversation.
    for (const total of [3, 50, 120]) {
      renderCounts.clear();
      mockSeenData.length = 0;
      const settled = settledRows(total - 1);
      const live: TranscriptMessage = {
        id: "live", role: "assistant", text: "a", caret: true, createdAt: 999,
      };
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(React.createElement(Transcript, props([...settled, live])));
      });
      await act(async () => {
        renderer.update(
          React.createElement(Transcript, props([...settled, { ...live, text: "ab" }])),
        );
      });
      expect(renderCounts.size).toBe(Math.min(TRANSCRIPT_WINDOW_TAIL, total - 1) + 1);
      for (const row of settled) {
        const mounted = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
        expect(renderCounts.get(row.id) ?? 0).toBe(mounted ? 1 : 0);
      }
      expect(renderCounts.get("live")).toBe(2);
      expect(new Set(mockSeenData).size).toBe(1);
      await act(async () => renderer.unmount());
    }
  });

  test("typing renders no transcript rows", async () => {
    const initial: TranscriptMessage = {
      id: "answer-live", role: "assistant", text: "a", caret: true, createdAt: 3,
    };
    const settled = settledRows(2);
    // Mounted with the very object the updates reuse: every update is then
    // elementwise identical and the band's own memo must skip, rendering no
    // row.
    const frozen = { ...initial, text: "abcdef" };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Transcript, props([...settled, frozen])));
    });
    const beforeTyping = new Map(renderCounts);
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        renderer.update(React.createElement(Transcript, props([...settled, frozen])));
      });
    }
    expect([...renderCounts]).toEqual([...beforeTyping]);
    await act(async () => renderer.unmount());
  });

  test("a settled answer becomes a list row and leaves the footer", async () => {
    const settled = settledRows(2);
    const live: TranscriptMessage = {
      id: "live", role: "assistant", text: "a", caret: true, createdAt: 999,
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Transcript, props([...settled, live])));
    });
    await act(async () => {
      renderer.update(
        React.createElement(Transcript, props([...settled, { ...live, caret: undefined, text: "done" }])),
      );
    });
    expect(renderCounts.get("live")).toBe(2);
    // The settled conversation now fills the list's data, one entry per message.
    expect(new Set(mockSeenData).size).toBe(2);
    expect(mockSeenData[mockSeenData.length - 1]).toHaveLength(3);
    expect(mockSeenData[mockSeenData.length - 1]!.some((message) => message.id === "live")).toBe(true);
    await act(async () => renderer.unmount());
  });
});
