/**
 * What the answer stands on: one quiet row per tool call above it (§2.4), and
 * the source chips under it (§2.5) — one file because §1.5 says they are one
 * family (sources are the durable evidence, tools the live half). A leaf: no
 * storage, no subscription, no fetch, no engine; the two decisions it needs
 * are pure functions in `toolLabels.ts` and `sourceLinkPolicy.ts`.
 *
 * The rule this file must keep, and `transcriptNoFetch.test.ts` enforces by
 * reading it: NO network request of any kind. A favicon or preview image would
 * be a request out of the app naming every domain the user searched. A
 * tappable chip hands its address to the system browser on the reader's own
 * tap; it does not open a connection here.
 */
import { Linking, Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { sourceChipDecision } from "./sourceLinkPolicy";
import type { TranscriptStyles } from "./TranscriptParts";
import { toolRowLabel } from "./toolLabels";
import type { TranscriptSource, TranscriptToolCall } from "./transcriptTypes";

/**
 * One line per tool call, in engine order: small, muted, no icon, no container,
 * nothing expandable. A repeated call draws two rows, not one: two searches are
 * two calls, and collapsing them would silently rewrite what the answer stood on.
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
 * host. The index is the 1-based position in the message's own source list —
 * the rule the renderer already uses — so a chip number and a marker number are
 * the same number by construction rather than by agreement.
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
  // The paint, and only the paint. It keeps the mock's ~28 dp height; the 48 dp
  // box the finger lands on is `sourceChipBox` below, and the two are separate on
  // purpose (§2.5): a chip that grew to the box would out-weigh the answer.
  const pill = (
    <View
      style={[
        styles.sourceChip,
        decision.tappable ? styles.sourceChipLink : styles.sourceChipStatic,
      ]}
    >
      <Text style={[styles.sourceIndex, decision.tappable ? null : styles.sourceIndexStatic]}>
        {cite}
      </Text>
      <Text style={[styles.sourceHost, decision.tappable ? null : styles.sourceHostStatic]}>
        {decision.text}
      </Text>
    </View>
  );

  if (!decision.tappable) {
    // Reduced emphasis, no lift: a chip that cannot be opened must not look
    // like the ones that can (§2.5). It wears the same box not for a 48 dp
    // reason — it has nothing to press — but so a row holding both forms keeps
    // one baseline instead of one pill riding high.
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="text"
        style={styles.sourceChipBox}
        testID={`transcript.source.${cite}`}
      >
        {pill}
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
      style={styles.sourceChipBox}
      testID={`transcript.source.${cite}`}
    >
      {pill}
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
