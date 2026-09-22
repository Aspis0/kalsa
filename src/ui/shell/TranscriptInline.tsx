/**
 * The answer's inline spans: bold, italic, inline code, links and the `[N]`
 * citation marker (the new shell had no inline markdown before this file).
 *
 * Four decisions the code keeps:
 *
 * 1. **Bold and italic take the READING face's own weights** — SourceSerif4
 *    semibold and italic — never the sans ones: a body in one family whose
 *    italic jumps to another reads as one word changing typeface mid-sentence.
 *    Weight lives in the face name; no numeric `fontWeight` appears here,
 *    because Android ignores it beside a custom family.
 * 2. **A link is a link only where `sourceChipDecision` says so** — a public
 *    `http(s)` address, not this machine's own network. Asking only
 *    `isSafeHttpUrl` would make the reader's own Kalsa Brain box or a
 *    `localhost:8080` dev server tappable (§2.5's criticism, applied to prose).
 * 3. **The `[N]` marker is not tappable**: ~16 dp in a sentence, and this
 *    project forbids `hitSlop` and boxes under 48 dp, while a real 48 dp box
 *    inside a sentence would push the lines apart. Nothing is lost — the same
 *    source is a 48 dp chip under the answer with the same citation number,
 *    host and accessible name, which the marker keeps so a screen reader still
 *    hears what it points at.
 * 4. **A prose LINK stays tappable under 48 dp — named here, not left for an
 *    audit to find**: WCAG 2.5.8's own "Inline" exception (a target in a
 *    sentence is exempt; its size is set by the line height), and the
 *    alternative leaves the address with no route at all. Making it inert like
 *    the marker is an open owner decision, not a silent one.
 */
import type React from "react";
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
        // The thin spaces buy the pill breathing room on Android, where padding
        // and a radius on a nested Text span are ignored (kept for that reason).
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
        // The source number alone gave `[2] … [2]` one testID for two nodes in
        // one paragraph; the run position fixes that and stays fully determined
        // by the parsed document.
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
