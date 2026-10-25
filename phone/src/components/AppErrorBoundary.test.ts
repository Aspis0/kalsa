/**
 * The root render-error boundary, driven through the rendered tree: a thrown
 * render (of a child OR of a provider below the root) shows the plain fallback
 * instead of an empty window, the throw is recorded through the js_error path,
 * and "Reload" mounts the subtree again rather than leaving the crashed one in
 * place. The catalogs are the real ones; only storage and the host components
 * are mocked.
 */
jest.mock("../logReport/collector", () => ({ recordJsError: jest.fn() }));

jest.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host =
    (name: string) =>
    (props: Record<string, unknown>): unknown =>
      react.createElement(name, props, props.children as React.ReactNode);
  return {
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
    useColorScheme: () => "light",
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

import { AppErrorBoundary } from "./AppErrorBoundary";
import { recordJsError } from "../logReport/collector";

const record = recordJsError as jest.Mock;

/** The stored locale is unset in this test, so the fallback speaks English. */
const FALLBACK_TEXTS = [
  "Something went wrong",
  "Kalsa could not draw this screen. Reload to try again.",
  "Reload",
];
/** The subtree's poison for the recovery case: the mount AFTER the crash has
 *  to render, while every render attempt of the crashed mount threw. */
let poisoned = false;

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  poisoned = false;
  // React prints every caught render error; the record under test is ours.
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

function texts(renderer: ReactTestRenderer): string[] {
  return [
    ...new Set(
      renderer.root
        .findAll((node) => typeof node.props.children === "string")
        .map((node) => node.props.children as string),
    ),
  ];
}

/** Throws while `poisoned` is set — i.e. through React's dev retry as well. */
function Boom(): React.ReactElement {
  if (poisoned) throw new Error("render exploded");
  return React.createElement(Text, null, "recovered");
}

async function render(child: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AppErrorBoundary, null, child));
  });
  return renderer;
}

async function pressReload(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.root
      .find((node) => node.props.testID === "errorBoundary.reload")
      .props.onPress();
  });
}

describe("the root render-error boundary", () => {
  it("renders children untouched while nothing throws", async () => {
    const renderer = await render(React.createElement(Boom));

    expect(texts(renderer)).toEqual(["recovered"]);
    expect(record).not.toHaveBeenCalled();
  });

  it("shows the fallback and records the throw when a child fails to render", async () => {
    poisoned = true;
    const renderer = await render(React.createElement(Boom));

    expect(texts(renderer)).toEqual(FALLBACK_TEXTS);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("catches a throw from a provider below the root, not just from a leaf", async () => {
    function BrokenProvider(): React.ReactElement {
      throw new Error("provider blew up");
    }
    const renderer = await render(
      React.createElement(
        BrokenProvider,
        null,
        React.createElement(Text, null, "never rendered"),
      ),
    );

    expect(texts(renderer)).toEqual(FALLBACK_TEXTS);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("mounts the subtree again after Reload, once the crash cause is gone", async () => {
    poisoned = true;
    const renderer = await render(React.createElement(Boom));
    expect(texts(renderer)).toEqual(FALLBACK_TEXTS);

    poisoned = false;
    await pressReload(renderer);

    expect(texts(renderer)).toEqual(["recovered"]);
  });
});
