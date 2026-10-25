/**
 * Where the Room PAINTS, and where its words get their height.
 *
 * The exclusive overlays are rendered by `HostOverlays` as siblings of the
 * shell's own flex column, so every one of them has to paint OVER the shell
 * — the absolute frame `AccountScreen` and the Settings-shaped screens share
 * — and the Room is one of them. A `flex: 1` root took part in that column
 * instead: on the Jelly Star (release APK of cc4ede9b) the room got the
 * window's lower half and its message list, which only ever takes what the
 * column leaves, got no height at all.
 *
 * The frame is compared against `AccountScreen`, a real sibling overlay,
 * rather than against a copy of the numbers: "mounted like the others" is
 * the invariant, so changing the frame has to be a decision in both places.
 */
import React from "react";

import { space } from "../theme/design";
import { RoomPeople } from "./room/RoomPeople";
import { RoomTranscript } from "./room/RoomTranscript";
import type { RoomFeed, RoomRow } from "../room/roomFeed";
import type { RoomView } from "../room/useRoom";

let mockRoom: RoomView;
let mockKeyboardHeight = 0;
const mockInsets = { top: 24, right: 0, bottom: 12, left: 0 };
/** The effects the stubbed hook deferred, and what they returned: the
 *  renderer's mount and unmount, made explicit. */
let mockEffects: Array<() => undefined | (() => void)> = [];
let mockCleanups: Array<() => void> = [];
/** Every back listener the room registered, and how many were removed. */
let mockBackListeners: Array<() => boolean | undefined> = [];
let mockBackRemoved = 0;

// The screens are invoked as plain functions: the hooks they run are stubbed
// to dispatcher-free equivalents, and the room's own state (the feed, the
// keyboard) is the fixture, not a renderer's.
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => undefined | (() => void)) => {
    mockEffects.push(effect);
  },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}));
jest.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  BackHandler: {
    addEventListener: (_event: string, listener: () => boolean | undefined) => {
      mockBackListeners.push(listener);
      return { remove: () => { mockBackRemoved += 1; } };
    },
  },
  FlatList: "FlatList",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock("../ui/shell/useKeyboardHeight", () => ({ useKeyboardHeight: () => mockKeyboardHeight }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en" }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../room/useRoom", () => ({ useRoom: () => mockRoom }));
jest.mock("../account/useAccount", () => ({
  InvalidEmailError: class InvalidEmailError extends Error {},
  useAccount: () => ({
    email: null,
    isSignedIn: false,
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));
jest.mock("../account/storeSource", () => ({ detectStoreSource: jest.fn(async () => "none") }));

import { AccountScreen } from "./AccountScreen";
import { RoomScreen } from "./RoomScreen";

type Element = React.ReactElement<Record<string, any>>;

const readyFeed: RoomFeed = {
  status: "ready",
  error: null,
  info: {
    roomName: "This computer",
    members: [
      { memberId: 0, name: "This computer", kind: "host" },
      { memberId: 1, name: "Paired phone", kind: "phone" },
    ],
    ai: { busy: false, running: null, queue: [], youPending: false },
    you: 1,
    roomId: "room-1",
    epoch: "epoch-1",
  },
  epoch: "epoch-1",
  entries: [],
  hasOlder: false,
  sent: [],
  queue: [],
  live: null,
  noteCode: null,
  callRefusalCode: null,
  reconnecting: false,
};

const oneRow: RoomRow[] = [
  {
    seq: 7,
    time: 1_759_600_000,
    text: "the words the reader could not see",
    callAi: false,
    former: false,
    name: "This computer",
    own: false,
    kalsa: false,
  },
];

function roomView(overrides: Partial<RoomFeed>): RoomView {
  return {
    feed: { ...readyFeed, ...overrides },
    rows: oneRow,
    pending: [],
    nameErrorCode: null,
    sendErrorCode: null,
    pageErrorCode: null,
    loadingOlder: false,
    setName: async () => undefined,
    send: async () => true,
    retry: async () => undefined,
    discard: async () => undefined,
    loadOlder: async () => undefined,
    reload: () => undefined,
  };
}

beforeEach(() => {
  mockRoom = roomView({});
  mockKeyboardHeight = 0;
  mockInsets.bottom = 12;
  mockEffects = [];
  mockCleanups = [];
  mockBackListeners = [];
  mockBackRemoved = 0;
});

/** Mount: run what the stubbed `useEffect` deferred, and keep the cleanups. */
function mountEffects(): void {
  for (const effect of mockEffects.splice(0)) {
    const cleanup = effect();
    if (cleanup) mockCleanups.push(cleanup);
  }
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

/** The children a View draws itself, without its descendants. */
function directChildren(element: Element): Element[] {
  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
  return children.filter((child: unknown): child is Element => React.isValidElement(child));
}

/** The room's tree with the two pieces it composes expanded: the members
 *  block and the transcript are components, so the list's flex lives one
 *  call deeper than the screen's own elements. */
function expand(tree: Element): Element[] {
  return elements(tree).flatMap((element) =>
    element.type === RoomTranscript || element.type === RoomPeople
      ? [element, ...elements((element.type as (props: any) => React.ReactNode)(element.props))]
      : [element],
  );
}

/** The View a screen paints in. One call deeper for a screen that draws its
 *  frame through a helper — the Room's `Page` for its loading/removed/error
 *  states, which is still the same frame. */
function root(rendered: Element): Element {
  let element = rendered;
  while (typeof element.type === "function") {
    element = (element.type as (props: any) => React.ReactNode)(element.props) as Element;
  }
  return element;
}

function renderRoom(overrides: Partial<RoomFeed> = {}, keyboard = 0): Element {
  mockKeyboardHeight = keyboard;
  mockRoom = roomView(overrides);
  return RoomScreen({ localId: "p-lid-1", onBack: jest.fn() }) as Element;
}

/** The View below a room state's header: what the loading, removed and error
 *  pages hang their own words and the pending shelf in. */
function pageContent(status: RoomFeed["status"], keyboard: number): Element {
  const content = directChildren(root(renderRoom({ status }, keyboard))).find(
    (child) => child.type === "View",
  );
  expect(content).toBeDefined();
  return content!;
}

/** The frame the pre-existing full-screen overlays paint in, read off a
 *  sibling overlay instead of copied here. */
function accountFrame(): Record<string, unknown> {
  const account = AccountScreen({ onBack: jest.fn(), onOpenPro: jest.fn() }) as Element;
  return account.props.style;
}

describe("where the room is mounted", () => {
  it("paints in the same frame as the other full-screen overlays", () => {
    const room = root(renderRoom());
    expect(room.type).toBe("View");
    expect(room.props.style).toEqual(accountFrame());
  });

  it("paints every room state in that frame, not only the one with words", () => {
    const frame = accountFrame();
    const states = ["loading", "removed", "error", "ready"] as const;
    expect(states.map((status) => root(renderRoom({ status })).props.style)).toEqual(
      states.map(() => frame),
    );
  });

  it("gives the transcript the height the members block and the composer leave", () => {
    const tree = expand(renderRoom());
    const list = tree.find((element) => element.type === "FlatList");
    const composer = tree.find((element) => element.props.testID === "room.composer");
    expect(list).toBeDefined();
    expect(composer).toBeDefined();
    expect(list!.props.style).toEqual({ flex: 1 });
    // Above the composer: the list is the column's one growing child, so the
    // words sit between the members block and the field, not under either.
    expect(tree.indexOf(list!)).toBeLessThan(tree.indexOf(composer!));
  });

  it("pays the settled keyboard height under the composer, so the field rides the IME", () => {
    const keyboard = 312;
    const tree = expand(renderRoom({}, keyboard));
    const band = tree.find(
      (element) =>
        element.type === "View" &&
        directChildren(element).some((child) => child.props.testID === "room.ask"),
    );
    expect(band).toBeDefined();
    const bandChildren = elements(band!.props.children);
    expect(bandChildren.some((child) => child.props.testID === "room.ask")).toBe(true);
    expect(bandChildren.some((child) => child.props.testID === "room.composer")).toBe(true);
    // The larger of the gesture bar and the IME, plus the band's own gap —
    // the same rule the shell's own composer follows (`bottomInsetFor`).
    expect(band!.props.style.paddingBottom).toBe(keyboard + space.sm);
  });

  it("pays the settled bottom inset on the states that carry the pending shelf", () => {
    mockInsets.bottom = 48;
    const states = ["loading", "removed", "error"] as const;
    expect(states.map((status) => pageContent(status, 0).props.style.paddingBottom)).toEqual(
      states.map(() => 48 + space.md),
    );
    // The same rule the ready band follows: the larger of the gesture bar and
    // the IME, so an unsent message never sits under either.
    expect(pageContent("error", 312).props.style.paddingBottom).toBe(312 + space.md);
  });

  it("closes the room on the hardware back, and unsubscribes when it goes away", () => {
    const onBack = jest.fn();
    RoomScreen({ localId: "p-lid-1", onBack });
    mountEffects();

    expect(mockBackListeners).toHaveLength(1);
    // True: the back belongs to the room, not to the app's exit.
    expect(mockBackListeners[0]!()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(mockBackRemoved).toBe(0);
    for (const cleanup of mockCleanups) cleanup();
    expect(mockBackRemoved).toBe(1);
  });
});
