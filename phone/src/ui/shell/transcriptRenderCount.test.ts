/**
 * What a streaming flush costs in React work, and what it does not touch.
 *
 * The FlatList mock here is STRUCTURAL: it calls `renderItem` for every entry
 * of the data array the band hands it. That proves the band-level contract —
 * the flush never reaches the list's data, never re-renders a settled row,
 * and the duplicate scan and split recompute do not run per token — but it
 * does NOT prove the native list's own windowing; that is React Native's
 * `VirtualizedList` behavior, exercised only on a device. Rows outside the
 * band's slice are therefore "never handed to the list", not "never mounted".
 */
jest.mock("react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
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
  duplicateMessageIds: jest.fn(() => []),
  duplicateIdSignature: jest.fn((ids: readonly string[]) => ids.join(", ")),
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

import { splitRecomputes } from "./TranscriptStreamRow";
import type { TranscriptMessage, TranscriptProps } from "./transcriptTypes";
import { TRANSCRIPT_WINDOW_TAIL } from "./transcriptWindow";
import { Transcript } from "./Transcript";
import { duplicateMessageIds } from "./transcriptScroll";

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

function liveRow(id: string, text: string): TranscriptMessage {
  return { id, role: "assistant", text, caret: true, createdAt: 999 };
}

async function mountWith(messages: readonly TranscriptMessage[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Transcript, props(messages)));
  });
  return renderer;
}

async function updateWith(
  renderer: ReactTestRenderer,
  messages: readonly TranscriptMessage[],
): Promise<void> {
  await act(async () => {
    renderer.update(React.createElement(Transcript, props(messages)));
  });
}

describe("transcript render isolation", () => {
  beforeEach(() => {
    renderCounts.clear();
    mockSeenData.length = 0;
    splitRecomputes.count = 0;
    (duplicateMessageIds as jest.Mock).mockClear();
  });

  test("with 50 messages a stream flush re-renders only the streaming row", async () => {
    const settled = settledRows(49);
    const live = liveRow("live", "a");
    const renderer = await mountWith([...settled, live]);
    // The list holds the tail: the last TRANSCRIPT_WINDOW_TAIL settled rows
    // are handed to the list, the rows above them never enter its data, and
    // the streaming row rides the footer, outside it.
    expect(renderCounts.size).toBe(TRANSCRIPT_WINDOW_TAIL + 1);
    for (const row of settled) {
      const handed = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
      expect([row.id, renderCounts.get(row.id) ?? 0]).toEqual([row.id, handed ? 1 : 0]);
    }
    expect(renderCounts.get("live")).toBe(1);
    expect(mockSeenData).toHaveLength(1);
    expect(mockSeenData[0]).toHaveLength(TRANSCRIPT_WINDOW_TAIL);
    expect(mockSeenData[0]!.some((message) => message.id === "live")).toBe(false);

    const flushes = 5;
    for (let index = 0; index < flushes; index += 1) {
      await updateWith(renderer, [...settled, liveRow("live", "a".repeat(index + 2))]);
    }

    // The list's data kept its identity through every flush, and every settled
    // row rendered exactly once — the flush stopped at the streaming row.
    expect(new Set(mockSeenData).size).toBe(1);
    for (const row of settled) {
      const handed = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
      expect([row.id, renderCounts.get(row.id) ?? 0]).toEqual([row.id, handed ? 1 : 0]);
    }
    expect(renderCounts.get("live")).toBe(flushes + 1);
    await act(async () => renderer.unmount());
  });

  test("a flush's work does not grow with the conversation's length", async () => {
    // Per flush: no split recompute (the O(1) prefix reuse in
    // `useStreamingSplit`), no duplicate scan, no new data array handed to
    // the list — the work counted here is flat in N, because each of it is
    // zero. (Data arrays are counted by identity: the list element itself
    // re-renders per flush, but must be handed the SAME array.)
    const work = { duplicateCalls: 0, recomputes: 0, dataArrays: 0 };
    const flatPerFlush = async (total: number) => {
      const settled = settledRows(total - 1);
      const renderer = await mountWith([...settled, liveRow("live", "a")]);
      const firstIndex = mockSeenData.length;
      const duplicatesBefore = (duplicateMessageIds as jest.Mock).mock.calls.length;
      const recomputesBefore = splitRecomputes.count;
      for (let index = 0; index < 5; index += 1) {
        await updateWith(renderer, [...settled, liveRow("live", "a".repeat(index + 2))]);
      }
      const result = {
        duplicateCalls: (duplicateMessageIds as jest.Mock).mock.calls.length - duplicatesBefore,
        recomputes: splitRecomputes.count - recomputesBefore,
        dataArrays: new Set(mockSeenData.slice(firstIndex)).size - 1,
      };
      await act(async () => renderer.unmount());
      return result;
    };
    expect(await flatPerFlush(50)).toEqual(work);
    expect(await flatPerFlush(500)).toEqual(work);
  });

  test("the flush cost does not depend on the conversation's length", async () => {
    // One flush: exactly one more render of the streaming row, none of any
    // settled row — whatever the conversation holds. The handed count is
    // capped by the window, not by the conversation.
    for (const total of [3, 50, 120]) {
      renderCounts.clear();
      mockSeenData.length = 0;
      const settled = settledRows(total - 1);
      const renderer = await mountWith([...settled, liveRow("live", "a")]);
      await updateWith(renderer, [...settled, liveRow("live", "ab")]);
      expect(renderCounts.size).toBe(Math.min(TRANSCRIPT_WINDOW_TAIL, total - 1) + 1);
      for (const row of settled) {
        const handed = settled.indexOf(row) >= settled.length - TRANSCRIPT_WINDOW_TAIL;
        expect(renderCounts.get(row.id) ?? 0).toBe(handed ? 1 : 0);
      }
      expect(renderCounts.get("live")).toBe(2);
      expect(new Set(mockSeenData).size).toBe(1);
      await act(async () => renderer.unmount());
    }
  });

  test("a settled answer becomes a list row and leaves the footer", async () => {
    const settled = settledRows(2);
    const live = liveRow("live", "a");
    const renderer = await mountWith([...settled, live]);
    await updateWith(renderer, [...settled, { ...live, caret: undefined, text: "done" }]);
    expect(renderCounts.get("live")).toBe(2);
    // The settled conversation now fills the list's data, one entry per message.
    expect(new Set(mockSeenData).size).toBe(2);
    expect(mockSeenData[mockSeenData.length - 1]).toHaveLength(3);
    expect(mockSeenData[mockSeenData.length - 1]!.some((message) => message.id === "live")).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("turns landing while pinned keep the slice at the tail", async () => {
    // `transcriptScroll` is mocked to always answer pinned, so the reader
    // rides the bottom here: each settled turn re-arms the window at the
    // tail and the handed slice never grows past TRANSCRIPT_WINDOW_TAIL.
    const settled = settledRows(120);
    const renderer = await mountWith([...settled, liveRow("live", "a")]);
    await updateWith(renderer, [...settled, { ...liveRow("live", "a"), caret: undefined }]);
    for (let appended = 1; appended <= 10; appended += 1) {
      const grown = [...settled, ...settledRows(appended).map((row) => ({ ...row, id: `more-${row.id}` }))];
      await updateWith(renderer, grown);
    }
    for (const data of mockSeenData.slice(1)) {
      expect(data.length).toBeLessThanOrEqual(TRANSCRIPT_WINDOW_TAIL);
    }
    expect(mockSeenData[mockSeenData.length - 1]).toHaveLength(TRANSCRIPT_WINDOW_TAIL);
    await act(async () => renderer.unmount());
  });

  test("typing renders no transcript rows", async () => {
    const initial = liveRow("answer-live", "a");
    const settled = settledRows(2);
    // Mounted with the very object the updates reuse: every update is then
    // elementwise identical and the band's own memo must skip, rendering no
    // row.
    const frozen = { ...initial, text: "abcdef" };
    const renderer = await mountWith([...settled, frozen]);
    const beforeTyping = new Map(renderCounts);
    for (let index = 0; index < 5; index += 1) {
      await updateWith(renderer, [...settled, frozen]);
    }
    expect([...renderCounts]).toEqual([...beforeTyping]);
    await act(async () => renderer.unmount());
  });

  test("a duplicate id is reported once, not on every settled change", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const duplicated = duplicateMessageIds as jest.Mock;
    duplicated.mockImplementation(() => ["row-0"]);

    const renderer = await mountWith(settledRows(4));
    expect(warn).toHaveBeenCalledTimes(1);
    // The same duplicate set across new settled lists: still one line.
    await updateWith(renderer, settledRows(5));
    await updateWith(renderer, settledRows(6));
    expect(warn).toHaveBeenCalledTimes(1);
    // Clean list, then the same id duplicated again: a new event, one line.
    duplicated.mockImplementation(() => []);
    await updateWith(renderer, settledRows(7));
    duplicated.mockImplementation(() => ["row-0"]);
    await updateWith(renderer, settledRows(8));
    expect(warn).toHaveBeenCalledTimes(2);

    duplicated.mockImplementation(() => []);
    warn.mockRestore();
    await act(async () => renderer.unmount());
  });
});
