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

export type MarkdownTextProps = {
  text: string;
  /** Append streaming cursor after the last block (not parsed as markdown). */
  showCursor?: boolean;
  /** Forwarded so long-press still works over tappable links. */
  onLongPress?: () => void;
};

export function MarkdownText({
  text,
  showCursor = false,
  onLongPress,
}: MarkdownTextProps) {
  const { colors } = useLabTheme<{
    colors: {
      ink: string;
      muted: string;
      accent: string;
      line: string;
      surfaceSunken: string;
    };
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
}: {
  block: MdBlock;
  colors: ThemeColors;
  typography: Typo;
  ink: string;
  cursor: string;
  onLongPress?: () => void;
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
    const style =
      block.level === 1
        ? typography.displayMd
        : block.level === 2
          ? typography.displaySm
          : typography.label;
    return (
      <Text
        style={[style, { color: ink, marginTop: spacing.xs }]}
        onLongPress={onLongPress}
      >
        {renderInline(block.inline, colors, ink, onLongPress)}
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
          {renderInline(block.inline, colors, colors.muted, onLongPress)}
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
          {renderInline(block.inline, colors, ink, onLongPress)}
          {cursor}
        </Text>
      </View>
    );
  }

  // paragraph
  return (
    <Text style={[typography.chatBody, { color: ink }]} onLongPress={onLongPress}>
      {renderInline(block.inline, colors, ink, onLongPress)}
      {cursor}
    </Text>
  );
}

function renderInline(
  nodes: InlineNode[],
  colors: ThemeColors,
  baseColor: string,
  onLongPress?: () => void,
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
        // Plus Jakarta Sans has no italic face loaded — weight cue only.
        return (
          <Text
            key={i}
            style={{ color: baseColor, fontFamily: fontFamilies.bodyMedium }}
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
      default:
        return null;
    }
  });
}
