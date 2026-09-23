/**
 * The shell: three bands, static chrome, no engine calls.
 *
 * This file places the boxes `shellGeometry.ts` returns and nothing else — it
 * holds no data, fetches nothing, and imports nothing from `src/engine`,
 * `src/app`, `src/screens` or `src/conversations`. The composer is DRAW-ONLY:
 * every decision (draft, hold, face, enabled) arrives through optional props
 * from the host; with none passed the old inert chrome renders, which is the
 * preview's contract. Insets are a prop so `shellGeometry` stays pure and its
 * test honest; width/height default to the live window.
 *
 * The keyboard is its own prop because with edge-to-edge the window never
 * shrinks when the IME opens: the bands re-partition inside safe area plus
 * keyboard (`bottomInsetFor`), and the shell is never lifted as a whole
 * (`docs/DESIGN.md` §2.7).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Text, View, useWindowDimensions, type TextInput } from "react-native";

import { useLocale, type TranslationKey } from "../../i18n";
import { modes, type ThemeMode } from "../../theme/design";
import { ComposerAttachments, type ComposerAttachmentsProps } from "./ComposerAttachments";
import { ShellComposer } from "./ShellComposer";
import type { ModelBarView } from "./ModelBar";
import { ShellStrip } from "./ShellStrip";
import {
  COMPOSER_ATTACHMENTS_HEIGHT,
  SHELL_NOTICE_HEIGHT,
  bottomInsetFor,
  shellGeometry,
  type Insets,
} from "./shellGeometry";
import { createShellStyles } from "./shellStyles";

export type ShellProps = {
  /** Safe-area insets, in dp. */
  insets: Insets;
  /** The model's short name and the place it runs. */
  modelName: string;
  location?: "phone" | "server";
  /** Refusal-aware where-line from the model pipeline. */
  whereLabel?: string;
  /** The keyboard's settled height in dp, 0 while it is down. */
  keyboardHeight?: number;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The transcript band's content. The shell does not know what it is. */
  children?: ReactNode;
  /**
   * The composer, as decided by the host (`composerState.ts` decides holds and
   * faces; this file only draws them). Every prop below is OPTIONAL and defaults
   * to the old non-functional chrome — the controlled form is the mount fix:
   * a component-local draft was unreadable by any host.
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
  onAttachPress?: () => void;
  /** False while the machine refuses an attach (controller `Chat:4810`). */
  attachDisabled?: boolean;
  onMicPress?: () => void;
  onSendPress?: () => void;
  /** The host's handle on the field, handed straight to the composer — focus
   *  after a template is chosen (the controller's `inputRef`, Chat:3637). */
  fieldRef?: { current: TextInput | null };
  /**
   * The staged attachments (D1 row 43): §2.7's chip row plus the live PDF
   * conversion's status line, drawn BELOW the toolbar (the controller put
   * its thumbnail strip below its context chips, `AiChatPage.tsx:4238+`) and
   * costing one 48 dp row out of the bands ONLY while something is staged.
   * `colors` is the shell's own, added on render — a caller that passed one
   * would be describing a different palette than the band it sits in.
   */
  attachments?: Omit<ComposerAttachmentsProps, "colors">;
  modelBar?: ModelBarView;
};

export function Shell({
  insets,
  modelName,
  location = "phone",
  whereLabel,
  keyboardHeight = 0,
  width,
  height,
  mode = "light",
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
  onAttachPress,
  attachDisabled = false,
  onMicPress,
  onSendPress,
  fieldRef,
  attachments,
  modelBar,
}: ShellProps) {
  const { t } = useLocale();
  const window = useWindowDimensions();
  const colors = modes[mode];
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  // The notice and the hold line are rows of their own, so they come out of
  // the height the bands partition rather than being drawn over the transcript.
  const attachmentsRowVisible =
    attachments !== undefined && (attachments.job !== undefined || attachments.chips.length > 0);
  const extraRows =
    (holdReason === null ? 0 : SHELL_NOTICE_HEIGHT) +
    (attachmentsRowVisible ? COMPOSER_ATTACHMENTS_HEIGHT : 0);
  const layoutHeight = (height ?? window.height) - extraRows;
  // One combined inset for BOTH uses: the geometry partitions with it and the
  // composer's bottom offset anchors to it. Computing them separately anchors
  // the composer to the raw safe-area inset and puts it under the keyboard,
  // because the keyboard covers the navigation bar rather than sitting above it.
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

  return (
    <View style={styles.root} testID="shell.root">
      <ShellStrip
        insets={insets}
        modelName={modelName}
        location={location}
        whereLabel={whereLabel}
        mode={mode}
        modelBar={modelBar}
        onMenuPress={onMenuPress}
        onModelAction={onModelPress}
      />

      <View
        style={[styles.transcript, { height: geometry.transcript.height }]}
        testID="shell.transcript"
        accessibilityLabel={t("shell.a11y.transcript")}
      >
        {children}
      </View>

      {holdReason === null ? null : (
        <View style={styles.holdLine} testID="shell.composer.hold">
          <Text numberOfLines={1} style={styles.holdLabel}>
            {holdReason}
          </Text>
        </View>
      )}

      {attachmentsRowVisible && attachments ? (
        <ComposerAttachments {...attachments} colors={colors} />
      ) : null}

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
        attachDisabled={attachDisabled}
        onMicPress={onMicPress}
        onSendPress={onSendPress}
        fieldRef={fieldRef}
      />
    </View>
  );
}
