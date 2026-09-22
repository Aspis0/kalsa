/**
 * The shell: three bands, static chrome, no engine calls.
 *
 * Step 2 of the rebuild, with step 3's transcript arriving as `children`. This
 * file places the boxes `shellGeometry.ts` returns and nothing else — it holds
 * no data, fetches nothing, and imports nothing from `src/engine`, `src/app`,
 * `src/screens` or `src/conversations`. The composer is DRAW-ONLY: every
 * decision (draft, hold, face, enabled) arrives through optional props from
 * the host; with none passed the old inert chrome is what renders, which is
 * the preview's contract. Mounting the shell was blocked on exactly this —
 * the draft used to live in component-local state, unreadable by any host.
 *
 * Insets arrive as a prop so `shellGeometry.ts` stays pure and its test honest;
 * width and height default to the live window so the preview can render at any
 * size the emulator reports.
 *
 * The keyboard arrives as its own prop, because with edge-to-edge the window
 * never shrinks when the IME opens: the bands re-partition inside the safe area
 * plus the keyboard (`bottomInsetFor`), and the shell is never lifted as a whole
 * (`docs/DESIGN.md` §2.7).
 */
import { ArrowUp, ChevronDown, Menu, Mic, Plus, Share, Square } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";

import { useLocale, type TranslationKey } from "../../i18n";
import { families, modes, type ThemeMode } from "../../theme/design";
import {
  SHELL_NOTICE_HEIGHT,
  bottomInsetFor,
  shellGeometry,
  type Insets,
} from "./shellGeometry";
import { createShellStyles } from "./shellStyles";

/**
 * The app's logo, and one of the three assets the rebuild keeps (DESIGN.md
 * §1.2): the neural-leaf mark, the same file `app.config.js` ships as the
 * launcher icon and the mock draws as `.pick .mark`. It is `require`d rather
 * than drawn, because the strip's mark is the one place the brand is visible.
 * `shellLogoAsset.test.ts` reads this file, pulls this path out and proves the
 * file exists, so a typo cannot ship the blank disc again.
 */
const LOGO = require("../../../assets/icon.png");

export type ShellProps = {
  /** Safe-area insets, in dp. */
  insets: Insets;
  /** The strip's static text. Translation stays with the caller. */
  modelName: string;
  whereLabel: string;
  /** The keyboard's settled height in dp, 0 while it is down. */
  keyboardHeight?: number;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /**
   * One translated line drawn between the strip and the transcript — the
   * preview's pinned-size notice, and nothing the app draws. It takes
   * `SHELL_NOTICE_HEIGHT` out of the bands, so the transcript yields the line
   * instead of being covered by it; a caller that sets it hands the same
   * reduced height to whatever fills the transcript band (`ShellPreview` does,
   * so the band the shell draws and the band the transcript believes it has
   * cannot drift).
   */
  notice?: string;
  /** The transcript band's content. The shell does not know what it is. */
  children?: React.ReactNode;
  /**
   * The composer, as decided by the host (`composerState.ts` decides holds
   * and faces; this file only draws them). Every prop below is OPTIONAL and
   * defaults to the old non-functional chrome, which is what the preview
   * still passes — the controlled form is the mount fix: the draft lived in
   * component-local state (old Shell:113), so no host could ever read what
   * the user typed or swap the send face for stop.
   */
  draft?: string;
  onDraftChange?: (text: string) => void;
  /** False while the machine refuses input — the field then shows no invite. */
  editable?: boolean;
  /** The invite's catalogue key; only drawn while `editable`. */
  placeholderKey?: TranslationKey;
  /** One translated line of reason between transcript and composer (§2.7). */
  holdReason?: string | null;
  face?: "send" | "stop" | "stopping";
  /** The send control's accessible name (and its visible text when stopping). */
  faceLabel?: string;
  /** False exactly where a tap must do nothing (§2.11). */
  faceEnabled?: boolean;
  /** Machine-yes/no: dims the `send` face while an empty draft cannot go. */
  sendEnabled?: boolean;
  onMenuPress?: () => void;
  onModelPress?: () => void;
  onNewChatPress?: () => void;
  /** Export/share the conversation (D1 row 2): the old nav's share glyph at
   *  `AiChatPage:4757-4769`, here as a real 48 dp strip box — the old
   *  36 dp box rode `hitSlop`, which the project forbids. */
  onExportPress?: () => void;
  onAttachPress?: () => void;
  onMicPress?: () => void;
  onSendPress?: () => void;
};

export function Shell({
  insets,
  modelName,
  whereLabel,
  keyboardHeight = 0,
  width,
  height,
  mode = "light",
  notice,
  children,
  draft: draftProp,
  onDraftChange: onDraftChangeProp,
  editable = true,
  placeholderKey,
  holdReason = null,
  face = "send",
  faceLabel,
  faceEnabled = true,
  sendEnabled = true,
  onMenuPress,
  onModelPress,
  onNewChatPress,
  onExportPress,
  onAttachPress,
  onMicPress,
  onSendPress,
}: ShellProps) {
  const { t } = useLocale();
  const window = useWindowDimensions();
  const colors = modes[mode];
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  // The notice and the hold line are rows of their own, so they come out of
  // the height the bands partition rather than being drawn over the transcript.
  const extraRows =
    (notice === undefined ? 0 : SHELL_NOTICE_HEIGHT) +
    (holdReason === null ? 0 : SHELL_NOTICE_HEIGHT);
  const layoutHeight = (height ?? window.height) - extraRows;
  // One combined inset for BOTH uses. The geometry partitions the height with it
  // and the composer's own bottom offset uses it: computing it for the geometry
  // and then anchoring the composer to the raw safe-area inset puts the composer
  // under the keyboard, because the keyboard covers the navigation bar rather
  // than sitting above it (2026-09-21: that is exactly what shipped for an hour).
  const layoutInsets = useMemo(
    () => bottomInsetFor(insets, keyboardHeight),
    [insets.top, insets.bottom, keyboardHeight],
  );
  const geometry = useMemo(
    () => shellGeometry(width ?? window.width, layoutHeight, layoutInsets),
    [width, window.width, layoutHeight, layoutInsets],
  );
  const [internalDraft, setInternalDraft] = useState("");
  const draft = draftProp ?? internalDraft;
  const changeDraft = (text: string) => {
    if (onDraftChangeProp) onDraftChangeProp(text);
    else setInternalDraft(text);
  };

  const iconColor = colors.inkSoft;

  return (
    <View style={styles.root} testID="shell.root">
      <View
        style={[styles.strip, { height: geometry.strip.height, marginTop: insets.top }]}
        testID="shell.strip"
        accessibilityRole="header"
        accessibilityLabel={t("shell.a11y.band")}
      >
        <Pressable
          testID="shell.strip.menu"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.menu")}
          onPress={onMenuPress}
          style={styles.iconButton}
        >
          <Menu size={18} color={iconColor} strokeWidth={2.1} />
        </Pressable>

        <Pressable
          testID="shell.strip.model"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.modelSwitcher", { model: modelName, where: whereLabel })}
          onPress={onModelPress}
          style={styles.pill}
        >
          <View
            accessibilityElementsHidden
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.mark}
          >
            <Image resizeMode="cover" source={LOGO} style={styles.markImage} />
          </View>
          <View style={styles.pillText}>
            <Text style={styles.modelName} numberOfLines={1}>
              {modelName}
            </Text>
            {geometry.stripCollapsed ? null : (
              <View style={styles.whereRow}>
                <View style={styles.whereDot} />
                <Text style={styles.where} numberOfLines={1}>
                  {whereLabel}
                </Text>
              </View>
            )}
          </View>
          <ChevronDown size={15} color={colors.silence} strokeWidth={2.4} />
        </Pressable>

        <Pressable
          testID="shell.strip.export"
          accessibilityRole="button"
          accessibilityLabel={t("chat.a11yExport")}
          onPress={onExportPress}
          style={styles.iconButton}
        >
          <Share size={18} color={iconColor} strokeWidth={2.1} />
        </Pressable>

        <Pressable
          testID="shell.strip.newChat"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.newChat")}
          onPress={onNewChatPress}
          style={styles.iconButton}
        >
          <Plus size={18} color={iconColor} strokeWidth={2.1} />
        </Pressable>
      </View>

      {/* The preview's mismatch notice: a row of its own, directly under the
          strip and above the transcript, so it can never be drawn over the
          conversation. `styles.notice` is `SHELL_NOTICE_HEIGHT` tall and clips,
          which is why a long string cannot wrap into the transcript; the
          height also left the bands in `layoutHeight`. */}
      {notice === undefined ? null : (
        <View style={styles.notice} testID="shell.notice">
          <Text numberOfLines={1} style={styles.noticeLabel}>
            {notice}
          </Text>
        </View>
      )}

      <View
        style={[styles.transcript, { height: geometry.transcript.height }]}
        testID="shell.transcript"
        accessibilityLabel={t("shell.a11y.transcript")}
      >
        {children}
      </View>

      {holdReason === null ? null : (
        <View style={styles.notice} testID="shell.composer.hold">
          <Text numberOfLines={1} style={[styles.noticeLabel, { color: colors.accent }]}>
            {holdReason}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.composerBand,
          { height: geometry.composer.height, marginBottom: layoutInsets.bottom },
        ]}
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

          <TextInput
            testID="shell.composer.field"
            accessibilityLabel={t("shell.a11y.field")}
            placeholder={editable ? t(placeholderKey ?? "shell.composer.placeholder") : undefined}
            placeholderTextColor={colors.silence}
            value={draft}
            onChangeText={changeDraft}
            editable={editable}
            style={styles.input}
            returnKeyType="send"
          />

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
    </View>
  );
}
