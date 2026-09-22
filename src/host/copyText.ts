/**
 * Copy text to the clipboard, minus the flash state — the flash lives where
 * it is DRAWN (`messageActions.ts` for the menu, `TranscriptTurns.tsx`'s chip
 * for the inline row), because neither may import the other to share a
 * boolean.
 *
 * Returns true only when the clipboard actually took the text: the share-sheet
 * fallback is for a clipboard refusal, and a fallback means the caller must
 * NOT flash "Copied!".
 */
import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";

export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(value);
    return true;
  } catch {
    // Fallback: share sheet if clipboard write fails.
    try {
      await Share.share({ message: value });
    } catch {
      // Dismissing the sheet, or no sheet available — still not a copy.
    }
    return false;
  }
}
