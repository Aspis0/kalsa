/**
 * Leaving the chat for a drawer or an overlay drops the composer field's focus.
 * iOS keeps the keyboard up for a first responder that is merely covered, so
 * the blur is what takes the keyboard away with the chat.
 */
import { useEffect } from "react";
import type { TextInput } from "react-native";

export function useFieldBlur(
  fieldRef: { readonly current: TextInput | null },
  blocked: boolean,
): void {
  useEffect(() => {
    if (blocked) fieldRef.current?.blur();
  }, [blocked]);
}
