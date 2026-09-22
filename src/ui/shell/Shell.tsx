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
import { ChevronDown, Globe, Menu, Plus } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";

import { useLocale, type TranslationKey } from "../../i18n";
import { modes, type, type ThemeMode } from "../../theme/design";
import { ComposerToolbar, type ComposerToolbarProps } from "./ComposerToolbar";
import { ShellComposer } from "./ShellComposer";
import {
  COMPOSER_TOOLBAR_HEIGHT,
  SHELL_NOTICE_HEIGHT,
  STRIP_CHEVRON_SIZE,
  bottomInsetFor,
  shellGeometry,
  type Insets,
} from "./shellGeometry";
import { createShellStyles } from "./shellStyles";

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
  /** The Web permission switch in the strip (D1 row 5 / §2.9: Web lives here,
   *  device and calendar stay in Settings). The host persists it under the
   *  controller's own key (`toolFlags.ts`); `true` is the controller's default
   *  ON, so the preview draws the switch the app boots with. */
  webEnabled?: boolean;
  onWebPress?: () => void;
  onAttachPress?: () => void;
  onMicPress?: () => void;
  onSendPress?: () => void;
  /**
   * The toolbar row above the field — templates ✦ + the research/notes chips
   * (D1 rows 13/14). Absent in the preview: the row costs the bands height, so
   * without it the preview's geometry is exactly the one `shellGeometry.test.ts`
   * partitions directly; when present, `Shell.tsx` subtracts it like the notice
   * rows and draws it between the hold line and the field.
   */
  toolbar?: ComposerToolbarProps;
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
  webEnabled = true,
  onWebPress,
  onAttachPress,
  onMicPress,
  onSendPress,
  toolbar,
}: ShellProps) {
  const { t } = useLocale();
  const window = useWindowDimensions();
  const colors = modes[mode];
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  // The notice and the hold line are rows of their own, so they come out of
  // the height the bands partition rather than being drawn over the transcript.
  const extraRows =
    (notice === undefined ? 0 : SHELL_NOTICE_HEIGHT) +
    (holdReason === null ? 0 : SHELL_NOTICE_HEIGHT) +
    (toolbar === undefined ? 0 : COMPOSER_TOOLBAR_HEIGHT);
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
          {/* No picture in here, and that is the point of this slice. The pill
              is 154 dp and used to spend 28 dp on the logo's clip, 20 dp on two
              gaps, 20 dp of padding and 6+4 dp on the where-dot, leaving the
              MODEL'S OWN NAME a 71 dp column against the ~105 dp `LFM2.5 2.6B`
              measures: the capture read `LFM2.5 …` over `On this ph…`, the
              second cut mid-word. The name is the information; the mark was
              not, so the mark and the dot are gone (the logo still ships as the
              launcher icon) and what the pill draws is budgeted in
              `shellGeometry.stripPillTextColumn`, held against the real strings
              by `stripTextBudget.test.ts`. The chevron stays — it says the pill
              is tappable. */}
          <View style={styles.pillText}>
            <Text style={styles.modelName} numberOfLines={1}>
              {modelName}
            </Text>
            {geometry.stripCollapsed ? null : (
              <Text style={styles.where} numberOfLines={1}>
                {whereLabel}
              </Text>
            )}
          </View>
          <ChevronDown
            size={STRIP_CHEVRON_SIZE}
            color={colors.silence}
            strokeWidth={2.4}
          />
        </Pressable>

        {/* D1 row 5: the Web permission switch. The old chip was 36×22 riding
            `hitSlop` (`AppShell:6926-6959`) — here a real 48 dp box with the
            controller's own label and hints; the line-through while off is the
            controller's own signal. */}
        <Pressable
          testID="shell.strip.web"
          accessibilityRole="switch"
          accessibilityState={{ checked: webEnabled }}
          accessibilityLabel={t("common.web")}
          accessibilityHint={webEnabled ? t("common.webOnHint") : t("common.webOffHint")}
          onPress={onWebPress}
          style={[
            styles.iconButton,
            webEnabled ? { backgroundColor: `${colors.accent}1f` } : null,
          ]}
        >
          <Globe
            size={13}
            color={webEnabled ? colors.accent : colors.silence}
            strokeWidth={2.2}
          />
          <Text
            numberOfLines={1}
            style={[
              type.meta,
              {
                color: webEnabled ? colors.accent : colors.silence,
                textDecorationLine: webEnabled ? "none" : "line-through",
              },
            ]}
          >
            {t("common.web")}
          </Text>
        </Pressable>

        {/* Export left the strip for the drawer (see `shellGeometry.ts`'s pill
            arithmetic: five controls gave the model name a 14 dp column and
            the name cannot be the thing that shrinks). The row it joined is
            `HostDrawer`'s, on the same 48 dp tile grammar as its neighbours. */}
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

      {toolbar === undefined ? null : <ComposerToolbar {...toolbar} colors={colors} />}

      <ShellComposer
        height={geometry.composer.height}
        bottomOffset={layoutInsets.bottom}
        colors={colors}
        draft={draft}
        onDraftChange={changeDraft}
        editable={editable}
        placeholderKey={placeholderKey}
        face={face}
        faceLabel={faceLabel}
        faceEnabled={faceEnabled}
        sendEnabled={sendEnabled}
        onAttachPress={onAttachPress}
        onMicPress={onMicPress}
        onSendPress={onSendPress}
      />
    </View>
  );
}
