/**
 * Renders parseMarkdownBlocks output with React Native primitives only.
 * Theme tokens for colors/typography; hairline dimensions (height: 1,
 * borderLeftWidth: 3, marginVertical: 1) are intentional literals — RN has no
 * token for sub-spacing hairlines and they must stay device-pixel thin.
 * No numeric fontWeight; no fontStyle italic; no hardcoded hex or font sizes.
 *
 * React.memo is intentionally NOT used on MarkdownText / BlockView: the call
 * site in AiChatPage passes `onLongPress={() => openMessageMenu(...)}`, a fresh
 * arrow every parent render, so memo never skips. The real fix would be a
 * memoized per-message row with a stable handler — out of scope here (long-press
 * is verified working and must not be put at risk). The useMemo around
 * parseMarkdownBlocks still helps: string deps compare by value.
 */
import React, { useMemo } from "react";
import { Linking, Text, View } from "react-native";

import { fontFamilies, useTypography } from "../theme/typography";
import { radius, spacing } from "../theme/tokens";
import { useLabTheme } from "../ui/labTheme";
import {
  type InlineNode,
  type MdBlock,
  isSafeHttpUrl,
  parseMarkdownBlocks,
} from "./markdown";

export type MarkdownSource = {
  url?: string;
  title?: string;
};

export type MarkdownTextProps = {
  text: string;
  /** Append streaming cursor after the last block (not parsed as markdown). */
  showCursor?: boolean;
  /** Forwarded so long-press still works over tappable links. */
  onLongPress?: () => void;
  /**
   * 1-based citation chips map to `sources[N - 1]`. Parser only records the
   * number; missing/out-of-range entries render as literal `[N]` text.
   */
  sources?: MarkdownSource[];
};

export function MarkdownText({
  text,
  showCursor = false,
  onLongPress,
  sources,
}: MarkdownTextProps) {
  const { colors } = useLabTheme<{
    colors: ThemeColors;
  }>();
  const typography = useTypography();

  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  const ink = colors.ink;
  const bodyStyle = [typography.chatBody, { color: ink }];

  if (blocks.length === 0) {
    return (
      <Text style={bodyStyle} onLongPress={onLongPress}>
        {showCursor ? "▋" : ""}
      </Text>
    );
  }

  const lastIsRule = blocks[blocks.length - 1]?.type === "rule";

  return (
    <View>
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        // Rule has no text slot — cursor is rendered after the map when last is rule.
        const cursor = isLast && showCursor && block.type !== "rule" ? "▋" : "";
        return (
          <BlockView
            key={idx}
            block={block}
            colors={colors}
            typography={typography}
            ink={ink}
            cursor={cursor}
            onLongPress={onLongPress}
            sources={sources}
          />
        );
      })}
      {showCursor && lastIsRule ? (
        <Text style={bodyStyle} onLongPress={onLongPress}>
          ▋
        </Text>
      ) : null}
    </View>
  );
}

type ThemeColors = {
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string;
  /** Foreground for text sitting on `accent` — used by the citation chip. */
  primaryText: string;
  line: string;
  surfaceSunken: string;
};

type Typo = Record<string, object>;

function BlockView({
  block,
  colors,
  typography,
  ink,
  cursor,
  onLongPress,
  sources,
}: {
  block: MdBlock;
  colors: ThemeColors;
  typography: Typo;
  ink: string;
  cursor: string;
  onLongPress?: () => void;
  sources?: MarkdownSource[];
}) {
  if (block.type === "rule") {
    return (
      <View
        style={{
          // Hairline literal — see file header.
          height: 1,
          backgroundColor: colors.line,
          marginVertical: spacing.sm,
        }}
      />
    );
  }

  if (block.type === "heading") {
    // Heading scale larger than body (chatBody 16/25) and clearly stepped:
    // H1 displayLg 22/28 ExtraBold, H2 displayMd 18/24 Bold,
    // H3 body size with SemiBold. More space above than below so structure reads.
    const style =
      block.level === 1
        ? typography.displayLg
        : block.level === 2
          ? typography.displayMd
          : [typography.chatBody, { fontFamily: fontFamilies.bodySemi }];
    return (
      <Text
        style={[
          style,
          {
            color: ink,
            marginTop: spacing.lg,
            marginBottom: spacing.xs,
          },
        ]}
        onLongPress={onLongPress}
      >
        {renderInline(block.inline, colors, typography, ink, onLongPress, sources)}
        {cursor}
      </Text>
    );
  }

  if (block.type === "quote") {
    return (
      <View
        style={{
          // Hairline literal — see file header.
          borderLeftWidth: 3,
          borderLeftColor: colors.line,
          paddingLeft: spacing.sm,
          marginVertical: spacing.xxs,
        }}
      >
        <Text
          style={[typography.chatBody, { color: colors.muted }]}
          onLongPress={onLongPress}
        >
          {renderInline(block.inline, colors, typography, colors.muted, onLongPress, sources)}
          {cursor}
        </Text>
      </View>
    );
  }

  if (block.type === "listItem") {
    const indent = block.depth * spacing.md;
    const bullet = block.ordered ? block.marker : "•";
    // Hanging indent: marker column width tracks marker length so "100." does not wrap.
    const markerWidth = block.ordered
      ? Math.max(spacing.xl + spacing.xxs, block.marker.length * spacing.sm)
      : spacing.md;
    return (
      <View
        style={{
          flexDirection: "row",
          paddingLeft: indent,
          // Hairline literal — see file header.
          marginVertical: 1,
        }}
      >
        <Text
          style={[
            typography.chatBody,
            {
              color: colors.muted,
              width: markerWidth,
              fontFamily: fontFamilies.body,
            },
          ]}
          onLongPress={onLongPress}
        >
          {bullet}
        </Text>
        <Text
          style={[typography.chatBody, { color: ink, flex: 1 }]}
          onLongPress={onLongPress}
        >
          {renderInline(block.inline, colors, typography, ink, onLongPress, sources)}
          {cursor}
        </Text>
      </View>
    );
  }

  // paragraph
  return (
    <Text style={[typography.chatBody, { color: ink }]} onLongPress={onLongPress}>
      {renderInline(block.inline, colors, typography, ink, onLongPress, sources)}
      {cursor}
    </Text>
  );
}

/** Host for a11y labels — hand-parsed (same RN URL-polyfill caveats as isSafeHttpUrl). */
function hostLabelFromUrl(url: string): string {
  const m = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(url.trim());
  return m?.[1] ?? url.trim();
}

function renderInline(
  nodes: InlineNode[],
  colors: ThemeColors,
  typography: Typo,
  baseColor: string,
  onLongPress?: () => void,
  sources?: MarkdownSource[],
): React.ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return (
          <Text key={i} style={{ color: baseColor }} onLongPress={onLongPress}>
            {node.text}
          </Text>
        );
      case "bold":
        return (
          <Text
            key={i}
            style={{ color: baseColor, fontFamily: fontFamilies.bodySemi }}
            onLongPress={onLongPress}
          >
            {node.text}
          </Text>
        );
      case "italic":
        // Real italic face (PlusJakartaSans_400Regular_Italic) — family name
        // carries the slant; never use fontStyle: "italic" (Android synthesizes
        // neither for custom families).
        return (
          <Text
            key={i}
            style={{ color: baseColor, fontFamily: fontFamilies.bodyItalic }}
            onLongPress={onLongPress}
          >
            {node.text}
          </Text>
        );
      case "code":
        // Thin space (\u2009) on each side: Android ignores paddingHorizontal /
        // borderRadius on nested Text spans, so this gives visual breathing room
        // on both platforms while iOS still gets the style props.
        return (
          <Text
            key={i}
            style={{
              fontFamily: fontFamilies.mono,
              backgroundColor: colors.surfaceSunken,
              color: baseColor,
              borderRadius: radius.xs,
              paddingHorizontal: spacing.xxs,
            }}
            onLongPress={onLongPress}
          >
            {"\u2009"}
            {node.text}
            {"\u2009"}
          </Text>
        );
      case "link": {
        // Empty label → nothing tappable (zero-width hit target is a footgun).
        if (!node.text) {
          return null;
        }
        if (!isSafeHttpUrl(node.href)) {
          // Unsafe / scheme-less: plain non-tappable text (label only).
          return (
            <Text key={i} style={{ color: baseColor }} onLongPress={onLongPress}>
              {node.text}
            </Text>
          );
        }
        const href = node.href.trim();
        return (
          <Text
            key={i}
            style={{ color: colors.accent, fontFamily: fontFamilies.body }}
            onPress={() => {
              void Linking.openURL(href).catch(() => undefined);
            }}
            onLongPress={onLongPress}
          >
            {node.text}
          </Text>
        );
      }
      case "citation": {
        // 1-based index into sources; missing/out-of-range → literal text (no dead chip).
        const source = sources?.[node.index - 1];
        if (!source) {
          return (
            <Text key={i} style={{ color: baseColor }} onLongPress={onLongPress}>
              {node.text}
            </Text>
          );
        }
        const rawUrl = typeof source.url === "string" ? source.url.trim() : "";
        const safe = rawUrl.length > 0 && isSafeHttpUrl(rawUrl);
        const host =
          safe
            ? hostLabelFromUrl(rawUrl)
            : typeof source.title === "string" && source.title.trim()
              ? source.title.trim()
              : String(node.index);
        const a11y = `Source ${node.index}, ${host}`;
        // Solid accent, not an accentSoft tint: a citation sits inline in running
        // text, and accentSoft measures 1.09:1 against the page — the chip read as
        // a stray character rather than a marker. A filled pill with primaryText
        // is 7.49:1 and unmistakably a control.
        const chipStyle = {
          color: colors.primaryText,
          backgroundColor: colors.accent,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xs,
          overflow: "hidden" as const,
          ...(typography.bodyXs as object),
        };
        if (!safe) {
          // Known source but unsafe/missing URL — styled chip, not tappable.
          return (
            <Text
              key={i}
              style={chipStyle}
              onLongPress={onLongPress}
              accessibilityLabel={a11y}
            >
              {"\u2009"}
              {String(node.index)}
              {"\u2009"}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={chipStyle}
            onPress={() => {
              void Linking.openURL(rawUrl).catch(() => undefined);
            }}
            onLongPress={onLongPress}
            accessibilityLabel={a11y}
            accessibilityRole="link"
          >
            {"\u2009"}
            {String(node.index)}
            {"\u2009"}
          </Text>
        );
      }
      default:
        return null;
    }
  });
}
