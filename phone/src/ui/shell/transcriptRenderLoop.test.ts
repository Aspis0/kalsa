/**
 * The real TranscriptContent against the scenarios that once looped it.
 *
 * `transcriptRenderCount.test.ts` mocks the band's internals, so it cannot
 * see a render-phase state loop; this file is the opposite pole: the whole
 * band renders for real (hooks, split, window, scroll machine, rows), and
 * only the modules jest cannot load are mocked inert — react-native,
 * reanimated, the gradient, icons, storage. The FlatList stand-in is still
 * structural (every data row through `renderItem`, footer and empty state
 * mounted), and it hands back the list's forwarded props so the test can
 * drive the same events the native list would: content size, layout, scroll.
 *
 * The scenarios are the ones from the field report: open (empty, welcome),
 * a loaded conversation, a wholesale conversation switch, a streaming flush
 * sequence with its settle, and the pin leaving and returning. The band must
 * render them all without throwing, and the list's render count must stay
 * bounded — the failure this guards against renders forever.
 */
jest.mock("react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => undefined }),
    },
    ActivityIndicator: "ActivityIndicator",
    Animated: {
      Value: class {
        setValue(_value: number) {}
      },
      createAnimatedComponent: (component: unknown) => `Animated${String(component)}`,
      loop: (animation: unknown) => ({ start: () => undefined, stop: () => undefined }),
      sequence: (steps: unknown[]) => steps,
      timing: () => ({
        start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }),
      }),
    },
    Easing: { linear: {}, bezier: () => ({}) },
    FlatList: (props: {
      data: readonly unknown[];
      renderItem: (info: { index: number; item: unknown }) => React.ReactElement;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ComponentType;
      onContentSizeChange: (width: number, height: number) => void;
      onLayout: (event: never) => void;
      onScroll: (event: never) => void;
    }) => {
      mockListRenders += 1;
      mockListProps = props as unknown as ListProps;
      const rows = props.data.map((item, index) =>
        React.cloneElement(props.renderItem({ index, item }), { key: String(index) }),
      );
      const footer = props.ListFooterComponent
        ? React.createElement(props.ListFooterComponent)
        : null;
      const empty = props.data.length === 0 ? props.ListEmptyComponent : null;
      return React.createElement("FlatList", null, rows, footer, empty);
    },
    Image: "Image",
    Linking: { openURL: async () => undefined },
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    StyleSheet: { create: (styles: object) => styles },
    Text: "Text",
    View: "View",
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  };
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => "Icon" }), { virtual: false });
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  Easing: { bezier: () => "easing" },
  cancelAnimation: () => undefined,
  default: { View: "AnimatedView" },
  useAnimatedStyle: () => ({}),
  useFrameCallback: () => ({ setActive: () => undefined }),
  useSharedValue: (initial: unknown) => ({ value: initial }),
  withDelay: (_delay: number, value: unknown) => value,
  withRepeat: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined },
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Transcript } from "./Transcript";
import type { TranscriptMessage } from "./transcriptTypes";

type ListProps = {
  data: readonly TranscriptMessage[];
  onContentSizeChange: (width: number, height: number) => void;
  onLayout: (event: { nativeEvent: { layout: { height: number; width: number } } }) => void;
  onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
};

let mockListRenders = 0;
let mockListProps: ListProps;
const insets = { top: 0, bottom: 0 };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/** A controllable clock: the scroll machine's grace window reads the wall. */
let clockMs = 1_000_000;
jest.spyOn(Date, "now").mockImplementation(() => clockMs);

function rows(count: number, prefix = "row"): TranscriptMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: `Message ${index}`,
    createdAt: index + 1,
  }));
}

async function mount(messages: readonly TranscriptMessage[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Transcript, { insets, messages, mode: "light", now: 10 }));
  });
  return renderer;
}

async function update(renderer: ReactTestRenderer, messages: readonly TranscriptMessage[]) {
  await act(async () => {
    renderer.update(
      React.createElement(Transcript, { insets, messages, mode: "light", now: 10 }),
    );
  });
}

const scroll = (y: number) => ({
  nativeEvent: { contentOffset: { y } },
});

/** The list's events, as the native list would deliver them. */
async function contentSize(height: number) {
  await act(async () => {
    mockListProps.onContentSizeChange(400, height);
  });
}

async function laidOut() {
  await act(async () => {
    mockListProps.onLayout({ nativeEvent: { layout: { height: 600, width: 400 } } });
  });
}

async function scrolled(y: number) {
  await act(async () => {
    mockListProps.onScroll(scroll(y));
  });
}

const jumpPill = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByProps({ testID: "transcript.jumpToEnd" }).length;

/** Enough renders to prove convergence, few enough that a loop cannot pass. */
const RENDER_BOUND = 60;

describe("the real band renders the opening scenarios without looping", () => {
  test("welcome, load, stream, settle, switch, and the pin leaving and returning", async () => {
    // (open) The empty conversation is the welcome block — the state whose
    // window is armed at no anchor at all.
    const renderer = await mount([]);
    expect(mockListRenders).toBeLessThan(RENDER_BOUND);

    // (a) An existing conversation of 50 settled messages loads.
    const fifty = rows(50);
    await update(renderer, fifty);
    await contentSize(2400);
    await laidOut();
    clockMs += 500; // past the programmatic-scroll grace window
    await scrolled(1800); // the end: 2400 - 600
    expect(mockListRenders).toBeLessThan(RENDER_BOUND);

    // (c) A streaming answer: caret row, flushes, settle.
    const live = { id: "live", role: "assistant" as const, text: "a", caret: true, createdAt: 999 };
    await update(renderer, [...fifty, live]);
    for (let index = 0; index < 5; index += 1) {
      await update(renderer, [...fifty, { ...live, text: "a".repeat(index + 2) }]);
      await contentSize(2400 + index);
      clockMs += 500;
      await scrolled(1800 + index);
    }
    await update(renderer, [...fifty, { ...live, caret: undefined, text: "done" }]);
    expect(mockListRenders).toBeLessThan(RENDER_BOUND);

    // (d) The pin leaves: the reader scrolls into history, the jump pill
    // appears, turns keep landing without moving them, and the pin returns.
    await contentSize(2500);
    clockMs += 500;
    await scrolled(300);
    const rendersWhileUnpinned = mockListRenders;
    const fiftyTwo = [...fifty, rows(1, "more"), rows(1, "later")].flat();
    await update(renderer, fiftyTwo);
    expect(jumpPill(renderer)).toBe(1);
    clockMs += 500;
    await scrolled(1900); // back at the end: 2500 - 600
    expect(jumpPill(renderer)).toBe(0);
    expect(mockListRenders - rendersWhileUnpinned).toBeLessThan(RENDER_BOUND);
    expect(mockListRenders).toBeLessThan(RENDER_BOUND);

    // (b) A wholesale conversation switch: every id replaced at once.
    await update(renderer, rows(120, "other"));
    await contentSize(5000);
    clockMs += 500;
    await scrolled(4400);
    expect(mockListRenders).toBeLessThan(RENDER_BOUND);
    await act(async () => renderer.unmount());
  });
});
