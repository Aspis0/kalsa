/**
 * What the answer stands on: one quiet row per tool call above it (§2.4), and
 * the source chips under it (§2.5).
 *
 * Both live in one file because §1.5 says they are one family — "the durable
 * evidence of what an answer stands on is the sources, and the tools are the
 * live half of it" — and because the two are the only parts of the transcript
 * that borrow something from outside the message text.
 *
 * A leaf, like the rest of the band: it reads no storage, subscribes to nothing,
 * fetches nothing, and knows no engine. The two decisions it needs are pure
 * functions in `toolLabels.ts` and `sourceLinkPolicy.ts`, so the node jest stack
 * can prove them without a render harness (DESIGN.md, "proof regime").
 *
 * The rule this file must keep, and `transcriptNoFetch.test.ts` enforces by
 * reading it: NO network request of any kind. A favicon or a preview image would
 * be a request out of the app naming every domain the user searched — the
 * desktop's stated rule, and it holds twice as hard on a phone. A tappable chip
 * hands its address to the system browser on the reader's own tap; it does not
 * open a connection here.
 */
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { sourceChipDecision } from "./sourceLinkPolicy";
import type { TranscriptStyles } from "./TranscriptParts";
import { toolRowLabel } from "./toolLabels";
import type { TranscriptSource, TranscriptToolCall } from "./transcriptTypes";

/**
 * One line per tool call, in the order the engine made them: small, muted, no
 * icon and no container. Nothing here is expandable in this step, so a row
 * carries the label and nothing else.
 *
 * A repeated call draws two rows and not one: two searches are two calls, and
 * collapsing them would silently rewrite what the answer stood on.
 */
export function ToolRows({
  styles,
  tools,
}: {
  styles: TranscriptStyles;
  tools: readonly TranscriptToolCall[];
}) {
  const { t } = useLocale();
  if (tools.length === 0) return null;
  return (
    <View style={styles.toolRows} testID="transcript.tools">
      {tools.map((tool, index) => {
        // An unknown name is not dropped: `toolRowLabel` returns the honest
        // "Tool: <name>" row with the engine's own spelling in it.
        const label = toolRowLabel(tool.name);
        return (
          <Text
            key={`${tool.name}-${index}`}
            style={styles.toolRow}
            testID={`transcript.tool.${index}`}
          >
            {t(label.key, label.params)}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * One chip: the citation index the answer's `[N]` markers point at, and the
 * host. The index is the 1-based position in the message's own source list,
 * which is the rule the renderer already uses (`MarkdownText` reads
 * `sources[N - 1]`), so a chip number and a marker number are the same number by
 * construction rather than by agreement.
 */
function SourceChip({
  cite,
  source,
  styles,
}: {
  cite: number;
  source: TranscriptSource;
  styles: TranscriptStyles;
}) {
  const { t } = useLocale();
  // The policy, not the component: a public http(s) address is a link, and
  // anything pointing at this machine or its network stays text.
  const decision = sourceChipDecision(source.url, source.title);
  const label = t("shell.transcript.a11y.source", { index: cite, text: decision.text });
  const body = (
    <>
      <Text style={[styles.sourceIndex, decision.tappable ? null : styles.sourceIndexStatic]}>
        {cite}
      </Text>
      <Text style={[styles.sourceHost, decision.tappable ? null : styles.sourceHostStatic]}>
        {decision.text}
      </Text>
    </>
  );

  if (!decision.tappable) {
    // Reduced emphasis, no lift: a chip that cannot be opened must not look like
    // the ones that can (§2.5).
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="text"
        style={[styles.sourceChip, styles.sourceChipStatic]}
        testID={`transcript.source.${cite}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => {
        // The reader's own tap, handed to the system browser. Nothing is
        // fetched here (§2.5), and the address was already cleared by the policy.
        void Linking.openURL(source.url.trim()).catch(() => undefined);
      }}
      style={[styles.sourceChip, styles.sourceChipLink]}
      testID={`transcript.source.${cite}`}
    >
      {body}
    </Pressable>
  );
}

/** The chips under an answer, in source order. Nothing when there are none. */
export function SourceChips({
  sources,
  styles,
}: {
  sources: readonly TranscriptSource[];
  styles: TranscriptStyles;
}) {
  if (sources.length === 0) return null;
  return (
    <View style={styles.sourceChips} testID="transcript.sources">
      {sources.map((source, index) => (
        <SourceChip
          key={`${source.url}-${index}`}
          cite={index + 1}
          source={source}
          styles={styles}
        />
      ))}
    </View>
  );
}
