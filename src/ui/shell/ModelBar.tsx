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
import { Pressable, Text, View } from "react-native";

import { modes, type, type ThemeMode } from "../../theme/design";
import { MIN_TOUCH_TARGET, SHELL_NOTICE_GAP, SHELL_NOTICE_HEIGHT, STRIP_SIDE_PADDING } from "./shellGeometry";

export type ModelBarTone = "muted" | "accent" | "bad" | "good";
/** The pill's control state, decided by the host (`modelBarPress.ts`):
 *  `inert` is the hung embedder — disabled AND off the pointer channel. */
export type ModelPressState = "enabled" | "disabled" | "inert";

export type ModelBarView = {
  control: ModelPressState;
  status: {
    label: string;
    tone: ModelBarTone;
    /** Present exactly on a sentence that promises a tap: the row then draws
     *  as that control — its accessible name, never the sentence itself. */
    retryLabel?: string;
  };
  /** 0-100 while downloading, null otherwise — the bar draws iff this is set. */
  percent: number | null;
  error: string | null;
  hint: string | null;
  battery: ReadonlyArray<{ text: string; tone: ModelBarTone }>;
};

/** One clipped line, the notice row's own box. */
const ONE_LINE = SHELL_NOTICE_HEIGHT;
/**
 * The status row's height: a real 48 dp finger box while the row IS the
 * retry control it names (`retryLabel`), the clipped one-line row otherwise.
 * The promise in "tap to retry" is a promise about a tap target — the only
 * one on the screen while the engine has refused this model.
 */
function statusRowHeight(view: ModelBarView): number {
  return view.status.retryLabel !== undefined ? MIN_TOUCH_TARGET : ONE_LINE;
}
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
    statusRowHeight(view) +
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

export function ModelBar({
  view,
  mode,
  onRetryPress,
}: {
  view: ModelBarView;
  mode: ThemeMode;
  /** The pill's own press (`Shell.tsx` passes `onModelPress`), so the retry
   *  sentence does exactly what the pill does — required whenever the view's
   *  status carries a `retryLabel`. */
  onRetryPress?: () => void;
}) {
  const colors = modes[mode];
  return (
    <View testID="shell.modelBar">
      {view.status.retryLabel !== undefined ? (
        <Pressable
          testID="shell.modelBar.retry"
          accessibilityRole="button"
          accessibilityLabel={view.status.retryLabel}
          onPress={onRetryPress}
          style={({ pressed }) => [
            ROW,
            { height: statusRowHeight(view), justifyContent: "center", opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {/* Underline + box, same red: the sentence keeps its tone and
              becomes visibly the control it already claimed to be. */}
          <Text
            numberOfLines={1}
            style={[
              type.meta,
              { color: toneColor(view.status.tone, colors), textDecorationLine: "underline" },
            ]}
          >
            {view.status.label}
          </Text>
        </Pressable>
      ) : (
        <View style={[ROW, { height: statusRowHeight(view) }]} testID="shell.modelBar.status">
          <Text numberOfLines={1} style={[type.meta, { color: toneColor(view.status.tone, colors) }]}>
            {view.status.label}
          </Text>
        </View>
      )}

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
          {/* The cause reads subordinate to the failure above: while the status
              carries the alarm (bad), this line is the EXPLANATION — two
              identical red lines could not tell cause from consequence. */}
          <Text
            numberOfLines={1}
            style={[
              type.meta,
              { color: toneColor(view.status.tone === "bad" ? "muted" : "bad", colors) },
            ]}
          >
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
