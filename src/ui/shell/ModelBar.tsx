/**
 * The model bar's rows under the strip (D1 rows 34-36): status, the advisory
 * battery line, the thin progress bar, the error and hint lines. Draw-only —
 * every string and tone arrives in `view` from the host
 * (`useModelBar.ts` assembles it from the controller's own derivations,
 * `AppShell.tsx:6720-6788, 2793-2830`).
 *
 * The rows sit BELOW the strip band and are carved out of the transcript's
 * height before `shellGeometry` partitions (`Shell.tsx` adds
 * `modelBarHeight(view)` to `extraRows`), the same way the notice row is —
 * so the three bands still sum exactly. They live out here because the pill's
 * 121 dp text column cannot hold the status strings without clipping them
 * (`stripTextBudget.test.ts` measures the identity lines only): the longest
 * Italian retry label is 256 dp, and a clipped "tap to retry" is the defect
 * the pill was rebuilt to kill. The strip says the name and where; these rows
 * say what the machine is doing (`docs/DESIGN.md` §2.1).
 */
import { Text, View } from "react-native";

import { modes, type, type ThemeMode } from "../../theme/design";
import { SHELL_NOTICE_GAP, SHELL_NOTICE_HEIGHT, STRIP_SIDE_PADDING } from "./shellGeometry";

export type ModelBarTone = "muted" | "accent" | "bad" | "good";
/** The pill's control state, decided by the host (`modelBarPress.ts`):
 *  `inert` is the hung embedder — disabled AND off the pointer channel. */
export type ModelPressState = "enabled" | "disabled" | "inert";

export type ModelBarView = {
  control: ModelPressState;
  status: { label: string; tone: ModelBarTone };
  /** 0-100 while downloading, null otherwise — the bar draws iff this is set. */
  percent: number | null;
  error: string | null;
  hint: string | null;
  battery: ReadonlyArray<{ text: string; tone: ModelBarTone }>;
};

/** One clipped line, the notice row's own box. */
const ONE_LINE = SHELL_NOTICE_HEIGHT;
/** The controller's hint is `numberOfLines={4}` (`AppShell.tsx:7005`). */
const HINT_LINES = 4;
const HINT_ROW = 2 * SHELL_NOTICE_GAP + HINT_LINES * type.meta.lineHeight;
/** Chosen, like the notice's gap: 4 above + 4 dp bar + 4 below. */
const PROGRESS_ROW = 12;

function batteryHeight(count: number): number {
  return count > 0 ? 2 * SHELL_NOTICE_GAP + count * type.meta.lineHeight : 0;
}

/** The height `Shell.tsx` subtracts before the bands partition. */
export function modelBarHeight(view: ModelBarView): number {
  return (
    ONE_LINE +
    batteryHeight(view.battery.length) +
    (view.percent !== null ? PROGRESS_ROW : 0) +
    (view.error !== null ? ONE_LINE : 0) +
    (view.hint !== null ? HINT_ROW : 0)
  );
}

function toneColor(
  tone: ModelBarTone,
  colors: (typeof modes)["light"],
): string {
  // The old palette's good/muted/bad map onto this one: the brand green IS
  // the accent, so "ready" takes settled ink instead of sharing the accent
  // that marks an actionable state (missing/downloading/reload).
  switch (tone) {
    case "accent":
      return colors.accent;
    case "bad":
      return colors.danger;
    case "good":
      return colors.ink;
    case "muted":
      return colors.silence;
  }
}

const ROW = { paddingHorizontal: STRIP_SIDE_PADDING } as const;

export function ModelBar({ view, mode }: { view: ModelBarView; mode: ThemeMode }) {
  const colors = modes[mode];
  return (
    <View testID="shell.modelBar">
      <View style={[ROW, { height: ONE_LINE }]} testID="shell.modelBar.status">
        <Text numberOfLines={1} style={[type.meta, { color: toneColor(view.status.tone, colors) }]}>
          {view.status.label}
        </Text>
      </View>

      {view.battery.length > 0 ? (
        <View
          style={[ROW, { height: batteryHeight(view.battery.length), paddingVertical: SHELL_NOTICE_GAP }]}
          testID="shell.modelBar.battery"
        >
          {view.battery.map((line, index) => (
            <Text
              key={index}
              numberOfLines={1}
              style={[type.meta, { color: toneColor(line.tone, colors) }]}
            >
              {line.text}
            </Text>
          ))}
        </View>
      ) : null}

      {view.percent !== null ? (
        <View
          style={[ROW, { height: PROGRESS_ROW, justifyContent: "center" }]}
          testID="shell.modelBar.progress"
          accessibilityLabel={`${view.percent}%`}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 4,
                width: `${view.percent}%`,
                backgroundColor: colors.accent,
              }}
            />
          </View>
        </View>
      ) : null}

      {view.error !== null ? (
        <View style={[ROW, { height: ONE_LINE }]} testID="shell.modelBar.error">
          <Text numberOfLines={1} style={[type.meta, { color: toneColor("bad", colors) }]}>
            {view.error}
          </Text>
        </View>
      ) : null}

      {view.hint !== null ? (
        <View style={[ROW, { height: HINT_ROW }]} testID="shell.modelBar.hint">
          <Text numberOfLines={HINT_LINES} style={[type.meta, { color: toneColor("muted", colors) }]}>
            {view.hint}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
