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
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { ArrowUp, Mic, Plus, Square } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { families, space, type DesignColors } from "../../theme/design";
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
  face: ComposerFace;
  faceLabel?: string;
  faceEnabled: boolean;
  sendEnabled: boolean;
  onAttachPress?: () => void;
  /** False while the machine refuses an attach (the controller's
   *  `attachDisabled = sending || voiceBlocksComposer || pdfBlocked`,
   *  `AiChatPage.tsx:4810`): disabled means no press, not an inert face. */
  attachDisabled?: boolean;
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
  face,
  faceLabel,
  faceEnabled,
  sendEnabled,
  onAttachPress,
  onMicPress,
  onSendPress,
  fieldRef,
  attachDisabled = false,
}: ShellComposerProps) {
  const { t } = useLocale();
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  const inputRef = useRef<TextInput | null>(null);
  const canActivate = faceEnabled && (face !== "send" || sendEnabled);
  const faceColor = canActivate ? colors.onBrand : colors.ink3;

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
          accessibilityState={{ disabled: attachDisabled }}
          onPress={onAttachPress}
          disabled={attachDisabled}
          style={({ pressed }) => [
            styles.fieldIcon,
            pressed ? { backgroundColor: colors.tint } : null,
            attachDisabled ? { opacity: 0.45 } : null,
          ]}
        >
          <Plus size={20} color={colors.ink3} strokeWidth={1.75} />
        </Pressable>

        {/* Tap the field area focuses it — the controller's own wrapper
            (`AiChatPage.tsx:4329`), kept so the focus path exists in source
            and does not depend on any native default. */}
        <Pressable
          testID="shell.composer.fieldArea"
          accessibilityLabel={t("shell.a11y.field")}
          onPress={() => inputRef.current?.focus()}
          style={{ flex: 1, minWidth: 0, marginHorizontal: space.xxs }}
        >
          <TextInput
            ref={(node) => {
              inputRef.current = node;
              if (fieldRef) fieldRef.current = node;
            }}
            testID="shell.composer.field"
            accessibilityLabel={t("shell.a11y.field")}
            placeholderTextColor={colors.ink3}
            value={draft}
            onChangeText={onDraftChange}
            editable={editable}
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={() => {
              // The IME's Send key goes through the button's own gate and its
              // own wiring, never a parallel send: the old composer's
              // `onSubmitEditing` sent the same draft (`AiChatPage.tsx:4370-4375`).
              if (canActivate) onSendPress?.();
            }}
          />
        </Pressable>

        <Pressable
          testID="shell.composer.mic"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.mic")}
          onPress={onMicPress}
          style={({ pressed }) => [styles.fieldIcon, pressed ? { backgroundColor: colors.tint } : null]}
        >
          <Mic size={20} color={colors.ink3} strokeWidth={1.75} />
        </Pressable>

        <Pressable
          testID="shell.composer.send"
          accessibilityRole="button"
          accessibilityLabel={faceLabel ?? t(face === "send" ? "shell.a11y.send" : "shell.a11y.stop")}
          accessibilityState={{ disabled: !canActivate }}
          onPress={onSendPress}
          disabled={!canActivate}
          style={({ pressed }) => [styles.send, pressed ? { opacity: 0.78 } : null]}
        >
          <View style={[styles.sendCircle, { backgroundColor: canActivate ? colors.brand : colors.tint }]}>
            {face === "stopping" ? (
              <ActivityIndicator size="small" color={faceColor} />
            ) : face === "stop" ? (
              <Square size={16} color={faceColor} strokeWidth={2.5} fill={faceColor} />
            ) : (
              <ArrowUp size={18} color={faceColor} strokeWidth={2.5} />
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}
