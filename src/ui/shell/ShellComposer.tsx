/**
 * The composer band: the field, the three in-field controls and the send face's
 * three states. A MOVE out of `Shell.tsx` (to cut a seam under that file's
 * ratchet), not a redesign: the JSX, the styles and every decision it draws are
 * the shell's own, still arriving as props from the host (`composerState.ts`
 * decides, this file only places).
 *
 * Leaf rules from the shell's own header hold: no state beyond the internal
 * draft fallback, no engine calls, no `src/engine` / `src/app` / `src/screens`
 * imports, real 48 dp boxes and never `hitSlop`.
 */
import { useMemo, useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ArrowUp, Mic, Plus, Square } from "lucide-react-native";

import { useLocale, type TranslationKey } from "../../i18n";
import { families, type DesignColors } from "../../theme/design";
import { createShellStyles } from "./shellStyles";
import type { ComposerFace } from "./composerState";

export interface ShellComposerProps {
  /** The band's height and its bottom offset — `shellGeometry`'s numbers. */
  height: number;
  bottomOffset: number;
  colors: DesignColors;
  draft: string;
  onDraftChange?: (text: string) => void;
  editable: boolean;
  placeholderKey?: TranslationKey;
  face: ComposerFace;
  faceLabel?: string;
  faceEnabled: boolean;
  sendEnabled: boolean;
  onAttachPress?: () => void;
  onMicPress?: () => void;
  onSendPress?: () => void;
  /** The host's handle on the field, filled here — so a chosen template can
   *  focus it (the controller's `inputRef.current?.focus()`, Chat:3637). */
  fieldRef?: { current: TextInput | null };
}

export function ShellComposer({
  height,
  bottomOffset,
  colors,
  draft,
  onDraftChange,
  editable,
  placeholderKey,
  face,
  faceLabel,
  faceEnabled,
  sendEnabled,
  onAttachPress,
  onMicPress,
  onSendPress,
  fieldRef,
}: ShellComposerProps) {
  const { t } = useLocale();
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  const inputRef = useRef<TextInput | null>(null);

  return (
    <View
      style={[styles.composerBand, { height, marginBottom: bottomOffset }]}
      testID="shell.composer"
    >
      <View style={styles.field}>
        <Pressable
          testID="shell.composer.attach"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.attach")}
          onPress={onAttachPress}
          style={styles.fieldIcon}
        >
          <Plus size={19} color={colors.silence} strokeWidth={1.9} />
        </Pressable>

        {/* Tap the field area focuses it — the controller's own wrapper
            (`AiChatPage.tsx:4329`), kept so the focus path exists in source
            and does not depend on any native default. */}
        <Pressable
          testID="shell.composer.fieldArea"
          accessibilityLabel={t("shell.a11y.field")}
          onPress={() => inputRef.current?.focus()}
          style={{ flex: 1, minWidth: 0 }}
        >
          <TextInput
            ref={(node) => {
              inputRef.current = node;
              if (fieldRef) fieldRef.current = node;
            }}
            testID="shell.composer.field"
            accessibilityLabel={t("shell.a11y.field")}
            placeholder={editable ? t(placeholderKey ?? "shell.composer.placeholder") : undefined}
            placeholderTextColor={colors.silence}
            value={draft}
            onChangeText={onDraftChange}
            editable={editable}
            style={styles.input}
            returnKeyType="send"
          />
        </Pressable>

        <Pressable
          testID="shell.composer.mic"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.mic")}
          onPress={onMicPress}
          style={styles.fieldIcon}
        >
          <Mic size={19} color={colors.silence} strokeWidth={1.9} />
        </Pressable>

        <Pressable
          testID="shell.composer.send"
          accessibilityRole="button"
          accessibilityLabel={faceLabel ?? t(face === "send" ? "shell.a11y.send" : "shell.a11y.stop")}
          accessibilityState={{ disabled: !(faceEnabled && (face !== "send" || sendEnabled)) }}
          onPress={onSendPress}
          disabled={!(faceEnabled && (face !== "send" || sendEnabled))}
          style={[
            styles.send,
            face === "send" && !sendEnabled ? { opacity: 0.45 } : null,
            face === "stopping" ? { width: 96, borderRadius: 24 } : null,
          ]}
        >
          {face === "stopping" ? (
            <Text
              numberOfLines={1}
              style={{ color: colors.onAccent, fontFamily: families.sansSemi, fontSize: 13 }}
            >
              {faceLabel ?? t("shell.composer.stopping")}
            </Text>
          ) : face === "stop" ? (
            <Square size={16} color={colors.onAccent} strokeWidth={2.6} fill={colors.onAccent} />
          ) : (
            <ArrowUp size={18} color={colors.onAccent} strokeWidth={2.6} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
