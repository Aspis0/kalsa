/**
 * The thinking cloud's disclosure survives its row being remounted.
 *
 * Two mechanisms remount the cloud with the same message id: the streaming
 * row settling (the transcript band's context-fed footer becomes an ordinary
 * list cell) and the render window paging past the row and back. Both reduce
 * to unmount-then-mount here, which is exactly what this exercises against
 * the real `ThoughtCloud` (reanimated and native modules mocked to inert
 * stand-ins: nothing here asserts motion).
 */
jest.mock("react-native", () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: object) => styles },
  Text: "Text",
  View: "View",
}));
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

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ThoughtCloud } from "./ThoughtCloud";
import type { ThoughtCloudColors, ThoughtCloudProps } from "./ThoughtCloud";

const COLORS: ThoughtCloudColors = {
  page: "#fff", surface: "#eee", surfaceMuted: "#ddd",
  border: "#ccc", borderStrong: "#bbb",
  ink: "#111", inkSoft: "#333", silence: "#555", accent: "#777",
};

function cloudProps(messageId: string): ThoughtCloudProps {
  return { answered: true, colors: COLORS, messageId, reasoning: "because", working: false };
}

function headOf(renderer: ReactTestRenderer, messageId: string) {
  return renderer.root.findByProps({ testID: `thought-${messageId}-head` });
}

function bodyCount(renderer: ReactTestRenderer, messageId: string): number {
  return renderer.root.findAllByProps({ testID: `thought-${messageId}-body` }).length;
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function mount(messageId: string): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(ThoughtCloud, cloudProps(messageId)));
  });
  return renderer;
}

describe("the disclosure survives a remount of the same message", () => {
  test("opened stays open through unmount and mount again", async () => {
    const renderer = await mount("m1");
    expect(bodyCount(renderer, "m1")).toBe(0);
    await act(async () => {
      headOf(renderer, "m1").props.onPress();
    });
    expect(bodyCount(renderer, "m1")).toBe(1);
    await act(async () => renderer.unmount());

    // The streaming row settling into the list, and the window paging past
    // the row and back, are both exactly this: remount, same id.
    const remounted = await mount("m1");
    expect(bodyCount(remounted, "m1")).toBe(1);
    await act(async () => remounted.unmount());
  });

  test("closed again stays closed, and another message starts closed", async () => {
    const renderer = await mount("m2");
    await act(async () => {
      headOf(renderer, "m2").props.onPress();
    });
    await act(async () => {
      headOf(renderer, "m2").props.onPress();
    });
    await act(async () => renderer.unmount());
    const remounted = await mount("m2");
    expect(bodyCount(remounted, "m2")).toBe(0);

    const other = await mount("m3");
    expect(bodyCount(other, "m3")).toBe(0);
    await act(async () => other.unmount());
  });
});
