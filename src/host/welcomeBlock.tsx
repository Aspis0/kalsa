/**
 * The blank first-open screen: the sage raster, the hour greeting, the welcome
 * line and the four suggestion cards (D1 row 12 / gap 1), lifted block-for-block
 * from `AiChatPage.tsx:4017-4131`, with `buildSuggestions` and
 * `greetingForHour` beside it in `welcomeCopy.ts`.
 *
 * Three rules, two the controller states and one the rebuild adds:
 *
 * 1. **The gate is not here.** The controller rendered this block only after
 *    `historyLoaded` (`AiChatPage:4015-4016`); the host applies the same
 *    condition (`welcomeVisible`) and hands `Transcript` either this block or
 *    nothing, so nothing can flash while history is still unknown.
 * 2. **A card SENDS.** `onPress` fires `onSend(text)` — the host wires it to
 *    `sendHost.send`, the real send path (the controller's cards called
 *    `handleSendTracked(s.text, attachedItems)` at `:4095-4096`; the attachments
 *    this slice does not have were empty in that call too).
 * 3. **It is not a band.** The host passes this as `Transcript`'s `empty`
 *    content, so it scrolls inside the transcript band and `shellGeometry.ts`'s
 *    three-band contract stands untouched.
 *
 * The raster loads through `tryRequireAsset`, the controller's own loader
 * (`AiChatPage:182-194`): a missing file degrades to the block WITHOUT the
 * image instead of a broken one, and an `onError` at runtime does the same for
 * a file Metro found but the decoder could not paint. `welcomeBlock.test.ts`
 * proves the path is on disk, so the degrade path never ships by accident.
 */
import React, { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { BarChart2, BookOpen, ChevronRight, Globe, Sparkles } from "lucide-react-native";

import { useLocale } from "../i18n";
import { modes, radius, spacing, type, type ThemeMode } from "../theme/design";
import { buildSuggestions, greetingForHour } from "./welcomeCopy";

function tryRequireAsset(load: () => unknown): number | undefined {
  try {
    const value = load();
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

const EMPTY_STATE_RASTER = tryRequireAsset(
  () => require("../../assets/brand/light/empty-state.jpg"),
);

/** Controller order: `buildSuggestions`' Sparkles / Globe / BarChart2 / BookOpen. */
const SUGGESTION_ICONS = [Sparkles, Globe, BarChart2, BookOpen];

export interface WelcomeBlockProps {
  mode: ThemeMode;
  /** The real send: the host wires this to `sendHost.send`. */
  onSend: (text: string) => void;
}

export function WelcomeBlock({ mode, onSend }: WelcomeBlockProps) {
  const { t } = useLocale();
  const colors = modes[mode];
  const [artFailed, setArtFailed] = useState(false);
  // Chat:967 — the raster is optional; a failed decode renders the block
  // without it rather than a broken image (and is reported, not hidden).
  const showArt = EMPTY_STATE_RASTER != null && !artFailed;
  const greeting = greetingForHour(new Date().getHours(), t);
  const suggestions = useMemo(() => buildSuggestions(t), [t]);

  return (
    <View style={{ paddingTop: spacing.xl }} testID="chat.welcome">
      {/* Greeting — optional sage plate (the raster carries no letters).

          The box carries NEITHER margin NOR padding, and that is a measured
          decision, not a style preference (`host3-firstopen.png`; both traps
          reproduced against the Yoga React Native 0.86 vendors, in
          `welcomeBlock.test.ts`'s pins):

          1. a `marginBottom` on an `aspectRatio` node makes the box resolve
             BELOW its column — a 441 px column lays out a 430.67 px box
             (aspect intact), 8 dp of the card column missing on the right;
          2. React Native paints an absolutely-positioned image at the box's
             CONTENT size, anchored at the box origin, so the plate's own
             `paddingHorizontal` pulled another 38.5 px (28 dp) off the
             photograph's right edge. Stack 1 + 2 and the capture's plate ends
             36 dp short of the cards — the ragged edge the vision pass saw.

          Both insets still exist, in the controller's own values, on nodes
          that cannot trigger the traps: the md inset is on the greeting text
          (with its 70% cap) and the xs gap is the prompt's marginTop. The
          proportions a reader sees — a 4:3 plate spanning the card column,
          text inset 14 dp, 6 dp to the prompt — are AiChatPage:4033-4047's. */}
      <View
        style={
          showArt
            ? {
                borderRadius: radius.lg,
                overflow: "hidden",
                aspectRatio: 4 / 3,
                justifyContent: "center",
              }
            : undefined
        }
      >
        {showArt ? (
          <Image
            source={EMPTY_STATE_RASTER}
            style={{ position: "absolute", width: "100%", height: "100%" }}
            resizeMode="cover"
            resizeMethod="resize"
            accessible={false}
            importantForAccessibility="no"
            onError={() => setArtFailed(true)}
          />
        ) : null}
        {showArt && mode === "dark" ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              backgroundColor: colors.page,
              opacity: 0.78,
            }}
          />
        ) : null}
        <Text
          style={[
            type.display,
            {
              color: colors.ink,
              maxWidth: showArt ? "70%" : undefined,
              // The plate's inset, moved onto the text (trap 2 above): same
              // 14 dp from every edge, but the photograph now fills the box.
              padding: showArt ? spacing.md : 0,
            },
          ]}
        >
          {greeting}.
        </Text>
      </View>
      <Text
        style={[
          type.label,
          // The plate's 6 dp gap, moved here as its own margin-top: a margin on
          // the aspect-ratio box is trap 1, and the reader sees the same 6 dp
          // either way. Controller: plate `marginBottom: spacing.xs`.
          { color: colors.silence, marginTop: spacing.xs, marginBottom: spacing.xl },
        ]}
      >
        {t("chat.welcomePrompt")}
      </Text>

      {/* Suggestion cards — each one sends for real (see the header). */}
      {suggestions.map((suggestion, index) => {
        const compute = suggestion.colorKey === "compute";
        const iconColor = compute ? colors.inkSoft : colors.accent;
        const iconBg = compute ? colors.surfaceMuted : `${colors.accent}22`;
        const Icon = SUGGESTION_ICONS[index] ?? Sparkles;
        return (
          <Pressable
            key={suggestion.text}
            testID={`chat.welcome.suggestion${index + 1}`}
            accessibilityRole="button"
            accessibilityLabel={`${suggestion.text} — ${suggestion.sub}`}
            onPress={() => onSend(suggestion.text)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              // Real box: 12 + 12 padding over a 32 dp tile is 56 dp tall, well
              // past the 48 dp floor — no hitSlop anywhere in this block.
              paddingVertical: spacing.sm + 2,
              paddingHorizontal: spacing.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
              marginBottom: spacing.xs,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.sm,
                backgroundColor: iconBg,
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon size={16} color={iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{suggestion.text}</Text>
              <Text style={[type.meta, { color: colors.silence, marginTop: 1 }]}>
                {suggestion.sub}
              </Text>
            </View>
            <ChevronRight color={colors.silence} size={14} />
          </Pressable>
        );
      })}
    </View>
  );
}
