/**
 * The answer's inline spans: bold, italic, inline code, links and the `[N]`
 * citation marker, drawn with `design.ts` rather than with the `ThemeColors` the
 * interface being replaced passes around (`src/chat/MarkdownText.tsx`, whose only
 * consumer is `AiChatPage.tsx`). Step 3b: the new shell had no inline markdown at
 * all before this file, so this is the parity half of the step.
 *
 * Three decisions are worth reading before the code.
 *
 * 1. **Bold and italic take the READING face's own weights** — SourceSerif4
 *    semibold and the SourceSerif4 italic — never the sans ones. Step 1 found the
 *    opposite defect in the old type layer: a body in one family whose italic
 *    jumped to another family's serif, which a reader sees as one word changing
 *    typeface mid-sentence. Weight lives in the face name; no numeric
 *    `fontWeight` appears here, because Android ignores it beside a custom family.
 * 2. **A link is a link only where `sourceChipDecision` says so** — a public
 *    `http(s)` address, not this machine's own network. The old renderer asked
 *    only `isSafeHttpUrl`, which would have made the reader's own Kalsa Brain box
 *    or a `localhost:8080` dev server tappable; that is the same criticism
 *    `sourceLinkPolicy.ts` records for the chips (§2.5), applied to prose.
 * 3. **The `[N]` marker is not tappable**, and that is a deliberate difference
 *    from the old renderer, which opened the source on a tap. In running text the
 *    painted marker is about 16 dp tall; this project forbids buying a touch box
 *    back with `hitSlop` and forbids an interactive box under 48 dp, and a real
 *    48 dp box inside a sentence would push the lines apart. Nothing is lost: the
 *    same source is a 48 dp chip under the answer (`TranscriptEvidence.tsx`),
 *    carrying the same citation number, the same host and the same accessible
 *    name. The marker keeps that name so a screen reader still hears what it
 *    points at.
 *
 *    A prose LINK below stays tappable, which is the one interactive thing in this
 *    file that is under 48 dp, and it is named here rather than left for an audit
 *    to find. It is WCAG 2.5.8's own "Inline" exception: a target in a sentence
 *    is exempt from the minimum because its size is set by the line height of the
 *    text around it, and the alternative is worse than the exception — the address
 *    would have no route at all, since nothing else in the shell renders it. The
 *    crop of this step that a reviewer may prefer is to make a prose link inert
 *    like the marker; that is a decision for the owner, not a silent one here.
 */
import React from "react";
import { Linking, Text } from "react-native";

import type { InlineNode } from "../../chat/markdown";
import type { TranslateFn } from "../../i18n";
import { sourceChipDecision } from "./sourceLinkPolicy";
import type { TranscriptStyles } from "./TranscriptParts";
import type { TranscriptSource } from "./transcriptTypes";

export type InlineContext = {
  /** The colour this run sits in: ink in the answer, silence in a quote. */
  color: string;
  /** `transcript.answer.<id>.b<block>` — the path a link's testID extends. */
  idPrefix: string;
  sources?: readonly TranscriptSource[];
  styles: TranscriptStyles;
  t: TranslateFn;
};

/** One inline node per element. A plain function, not a component: the spans are
 *  children of a `Text`, and a nested component would break the run. */
export function renderInline(
  nodes: readonly InlineNode[],
  context: InlineContext,
): React.ReactNode[] {
  const { color, idPrefix, sources, styles, t } = context;
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return (
          <Text key={index} style={{ color }}>
            {node.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={index} style={[styles.inlineBold, { color }]}>
            {node.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={index} style={[styles.inlineItalic, { color }]}>
            {node.text}
          </Text>
        );
      case "code":
        // The thin spaces buy the pill its breathing room on Android, where
        // padding and a radius on a nested Text span are ignored. Kept from the
        // old renderer for the same reason.
        return (
          <Text key={index} style={[styles.inlineCode, { color }]}>
            {"\u2009"}
            {node.text}
            {"\u2009"}
          </Text>
        );
      case "link": {
        // An empty label would be a zero-width tap target.
        if (!node.text) return null;
        if (!sourceChipDecision(node.href).tappable) {
          return (
            <Text key={index} style={{ color }}>
              {node.text}
            </Text>
          );
        }
        const href = node.href.trim();
        return (
          <Text
            accessibilityLabel={node.text}
            accessibilityRole="link"
            key={index}
            onPress={() => {
              // The reader's own tap hands the address to the system browser;
              // nothing is fetched here (§2.5).
              void Linking.openURL(href).catch(() => undefined);
            }}
            style={styles.inlineLink}
            testID={`${idPrefix}.link.${index}`}
          >
            {node.text}
          </Text>
        );
      }
      case "citation": {
        // 1-based into the message's own sources, the rule the old renderer and
        // the chips below both use. A source this message does not carry is
        // literal text, never a chip pointing nowhere.
        const source = sources?.[node.index - 1];
        if (!source) {
          return (
            <Text key={index} style={{ color }}>
              {node.text}
            </Text>
          );
        }
        const decision = sourceChipDecision(source.url, source.title);
        // Unique per node: `<idPrefix>.cite.<sourceNumber>.<positionInRun>`.
        // The source number alone (the audit's F4) gave `[2] … [2]` in one
        // paragraph two nodes with one testID; the run position is appended,
        // the same suffix the link above already uses, so the harness gets a
        // name that is unique yet fully determined by the parsed document.
        return (
          <Text
            accessibilityLabel={t("shell.transcript.a11y.source", {
              index: node.index,
              text: decision.text,
            })}
            key={index}
            style={styles.inlineCitation}
            testID={`${idPrefix}.cite.${node.index}.${index}`}
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
