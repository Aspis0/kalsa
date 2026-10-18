/**
 * The turn's one line about what Kalsa did (PHONE-CHAT-PROTOCOL §3.2), drawn under the
 * answer in the quiet tone of the stop line: the same look as the other sentence the
 * computer says about a turn, and nothing louder. The text is drawn as it is.
 */
import { Text } from "react-native";

import type { TranscriptStyles } from "./TranscriptParts";

export function RecapLine({ id, styles, text }: { id: string; styles: TranscriptStyles; text: string }) {
  return (
    <Text style={styles.stopLine} testID={`transcript.recap.${id}`}>
      {text}
    </Text>
  );
}
