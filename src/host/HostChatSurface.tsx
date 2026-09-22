/**
 * The chat surface: the strip, the composer band and the transcript, wired to
 * the host — extracted from `HostRoot.tsx` under the owner's rule that the
 * root may only COMPOSE. This is the same JSX the root used to render, moved
 * not re-thought:
 *
 * - the strip's model-pill tap semantics, with the missing-download path
 *   serving `shell.notice.download` (§2.7);
 * - the attach / mic stubs, which answer with their toast (§2.7);
 * - the send ⇄ stop wiring of §2.8's one control: `stop` while the face says
 *   stop, otherwise a send of the draft the root owns.
 *
 * The theme, the keyboard height and the band insets live here because only
 * this subtree consumes them; the root keeps the safe-area insets (the drawer
 * needs the strip's top).
 */
import { isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, isEngineReady } from "../engine/LlamaService";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";
import { QuickActionSheet } from "../theme/components/QuickActionSheet";
import { useLocale, type TranslationKey } from "../i18n";
import type { ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { bottomInsetFor } from "../ui/shell/shellGeometry";
import { MessageMenu } from "../ui/shell/MessageMenu";
import { Shell } from "../ui/shell/Shell";
import { Transcript } from "../ui/shell/Transcript";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import type { ComposerToolbarProps } from "../ui/shell/ComposerToolbar";
import type { ComposerArms } from "./composerArms";
import type { ComposerView } from "./composerView";
import type { useMessageActions } from "./messageActions";
import type { SendHost } from "./sendHost";
import type { useToolFlags } from "./toolFlags";
import { useHostEngine } from "./useHostEngine";
import { WelcomeBlock } from "./welcomeBlock";
import { welcomeVisible } from "./welcomeCopy";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];
type ToolFlags = ReturnType<typeof useToolFlags>;
/** The message menu's bundle, created by the root beside the send/history it
 *  borrows (`src/host/messageActions.ts`). */
type MessageActionsBundle = ReturnType<typeof useMessageActions>;

export interface ChatSurfaceProps {
  /** Safe-area insets: `top` paints the strip below the notch, `bottom` feeds
   *  the band partition with the keyboard. */
  insets: { top: number; bottom: number };
  draft: string;
  onDraftChange: (text: string) => void;
  /** The composer's decision + the mapped transcript (one render's view). */
  view: ComposerView;
  modelHost: ModelHost;
  /** The one-slot notice (§2.7 stub reasons ride it). */
  showNoticeKey: (key: TranslationKey) => void;
  sendHost: SendHost;
  onMenuPress: () => void;
  onNewChatPress: () => void;
  /** The strip's Web switch (D1 row 5): the host's persisted flag + its flip. */
  flags: ToolFlags;
  /** The research/notes one-shot arms behind the toolbar chips (D1 row 14). */
  arms: ComposerArms;
  /** The long-press menu + copy chip (PARITY-STATUS gap 1): the menu's view,
   *  the press handler for the transcript and the copy both chips use. */
  actions: MessageActionsBundle;
}

export function HostChatSurface({
  insets,
  draft,
  onDraftChange,
  view,
  modelHost,
  showNoticeKey,
  sendHost,
  onMenuPress,
  onNewChatPress,
  flags,
  arms,
  actions,
}: ChatSurfaceProps) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const keyboardHeight = useKeyboardHeight();
  const [quickSheetVisible, setQuickSheetVisible] = useState(false);
  // The field's handle: a chosen template fills the draft AND focuses the
  // field, exactly as the controller's `handleChooseTemplate` (Chat:3636-3637).
  const fieldRef = useRef<TextInput | null>(null);

  // Strip pill semantics: load when the bundle is on disk but unloaded, retry
  // an engine error, no-op while busy or already resident (the old chip was
  // disabled there); a missing bundle has no download path in this build and
  // says so (§2.7).
  const onModelPress = () => {
    if (isEmbedderHung()) return;
    const resident = isEngineReady() && getActiveModelId() === modelHost.currentModel.id;
    if (modelHost.modelState === "missing" || modelHost.modelErrorKind === "download") {
      showNoticeKey("shell.notice.download");
      return;
    }
    if (modelHost.modelState === "checking" || modelHost.modelState === "loading") return;
    if (modelHost.modelState === "ready" && resident) return;
    modelHost.userReloadModel(modelHost.currentModel);
  };

  const bandInsets = bottomInsetFor(insets, keyboardHeight);

  // The toolbar's chips arm the NEXT send (one-shot; the arms clear on send,
  // on an emptied draft and on conversation change — `composerArms.ts`). The
  // machine's own answer gates them: while the face says stop no arm flips.
  const toolbar: ComposerToolbarProps = {
    onTemplatesPress: () => setQuickSheetVisible(true),
    researchActive: arms.research,
    onResearchPress: arms.toggleResearch,
    notesActive: arms.notes,
    onNotesPress: arms.toggleNotes,
    // The library-document chip is GONE from the row (it could not do its job
    // without the attachment flow — see `ComposerToolbar.tsx`'s header). The
    // attach BUTTON still carries the same hold sentence
    // (`shell.notice.attach`), which is why that key stays.
    disabled: view.composer.face !== "send",
  };
  // Nothing shows until the history load has settled; then, on an empty
  // conversation, the welcome block rides INSIDE the transcript's own
  // scrolling content (D1 row 12).
  const empty = welcomeVisible(view.historyLoaded, view.transcript.length) ? (
    <WelcomeBlock mode={mode} onSend={(text) => void sendHost.send(text)} />
  ) : undefined;

  return (
    <>
    <Shell
      insets={insets}
      modelName={modelHost.currentModel.name}
      whereLabel={t("shell.where.thisPhone")}
      keyboardHeight={keyboardHeight}
      mode={mode}
      draft={draft}
      onDraftChange={onDraftChange}
      editable={view.composer.field.editable}
      placeholderKey={view.composer.field.placeholder ?? undefined}
      holdReason={view.composer.hold === null ? null : t(view.composer.hold)}
      face={view.composer.face}
      faceLabel={t(view.composer.faceLabel)}
      faceEnabled={view.composer.faceEnabled}
      sendEnabled={view.sendEnabled}
      onMenuPress={onMenuPress}
      onModelPress={onModelPress}
      onNewChatPress={onNewChatPress}
      onAttachPress={() => showNoticeKey("shell.notice.attach")}
      onMicPress={() => showNoticeKey("shell.notice.mic")}
      fieldRef={fieldRef}
      webEnabled={flags.webToolsEnabled}
      onWebPress={flags.toggleWebTools}
      toolbar={toolbar}
      onSendPress={() => {
        if (view.composer.face === "stop") sendHost.stop();
        else void sendHost.send(draft);
      }}
    >
      <Transcript
        insets={bandInsets}
        messages={view.transcript}
        mode={mode}
        empty={empty}
        onMessageLongPress={actions.onMessageLongPress}
        onCopy={actions.onCopy}
      />
    </Shell>
    {/* The controller's message sheet, CALLED with the rows the host's pure
        builder allows (`messageMenuRows.ts`); translate, edit and read-aloud
        are absent until their systems exist, not rows that do nothing.
        Android back and the backdrop both cancel. */}
    <MessageMenu
      mode={mode}
      visible={actions.menu !== null}
      caption={actions.menu?.caption ?? ""}
      rows={actions.menu?.rows ?? []}
      bottomInset={insets.bottom}
      onRowPress={actions.onMenuRow}
      onRequestClose={actions.closeMenu}
    />
    {/* The controller's template sheet, CALLED not rebuilt; choosing one
        replaces the draft and focuses the field, as the old handler did
        (`AiChatPage.tsx:3636-3637`). */}
    <QuickActionSheet
      onlyTemplates
      visible={quickSheetVisible}
      onClose={() => setQuickSheetVisible(false)}
      onChooseTemplate={(template) => {
        onDraftChange(t(template.promptKey));
        fieldRef.current?.focus();
      }}
    />
    </>
  );
}
