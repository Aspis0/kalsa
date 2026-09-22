/**
 * The chat surface: the strip, the composer band and the transcript, wired to
 * the host — the root's main child (the drawer, overlays and notice live in
 * `HostLayout.tsx` beside it). This is the JSX the root used to render, moved
 * not re-thought:
 *
 * - the strip's model-pill tap semantics, with the missing-download path
 *   serving `shell.notice.download` (§2.7);
 * - the attach flow (sheet, pickers, PDF conversion, §2.7 chip row) and the
 *   mic, still a stub that answers with its toast (§2.7);
 * - the send ⇄ stop wiring of §2.8's one control: `stop` while the face says
 *   stop, otherwise a send of the draft the root owns;
 * - the message menu, the edit modal and the transcript's live interactions
 *   (translate, read-aloud), all through the root's `actions` bundle.
 *
 * The theme, the keyboard height and the band insets live here because only
 * this subtree consumes them; the root keeps the safe-area insets (the drawer
 * needs the strip's top).
 */
import { isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, isEngineReady } from "../engine/LlamaService";
import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import { shouldShowLongChatNudge } from "../chat/longChatEstimate";
import { PdfToImages } from "../components/PdfToImages";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TextInput } from "react-native";
import { QuickActionSheet } from "../theme/components/QuickActionSheet";
import { useLocale, type TranslationKey } from "../i18n";
import { modes, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { bottomInsetFor } from "../ui/shell/shellGeometry";
import { MessageMenu } from "../ui/shell/MessageMenu";
import { EditMessageModal } from "../ui/shell/EditMessageModal";
import { Shell } from "../ui/shell/Shell";
import { Transcript } from "../ui/shell/Transcript";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import type { ComposerToolbarProps } from "../ui/shell/ComposerToolbar";
import type { TranscriptMiniapp } from "../ui/shell/transcriptTypes";
import type { ComposerArms } from "./composerArms";
import type { ComposerView } from "./composerView";
import { HostAttachSheet, type AttachAction } from "./HostAttachSheet";
import { LongChatNudgeRow } from "./LongChatNudgeRow";
import type { useMessageActions } from "./messageActions";
import type { SendHost } from "./sendHost";
import type { AttachmentsHost } from "./useAttachments";
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
  /** The live conversation the surface draws: the long-chat nudge's
   *  once-per-conversation reset. `HostLayout` derives it from the drawer's
   *  copy of the store — the same expression the root passes to its own
   *  effects, so the root's file stays at its ratchet. */
  conversationId: string | undefined;
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
  /** The staged attachments and the pickers behind the attach control
   *  (D1 row 43). */
  attachments: AttachmentsHost;
  /** The library for the sheet's document list (D1 row 43). */
  libraryDocs: readonly LibraryDoc[];
  /** Empty library → the controller's `onOpenDocuments` fallback
   *  (`Chat:3664-3669`). */
  onOpenDocuments: () => void;
  /** The long-press menu + copy chip (PARITY-STATUS gap 1): the menu's view,
   *  the press handler for the transcript and the copy both chips use. */
  actions: MessageActionsBundle;
  /** The mini-app card's open (D1 row 4/28): the host applies the
   *  controller's open policy and owns the overlay (`AppShell.tsx:7035-7046`). */
  onMiniappOpen: (miniapp: TranscriptMiniapp) => void;
}

export function HostChatSurface({
  insets,
  draft,
  onDraftChange,
  conversationId,
  view,
  modelHost,
  showNoticeKey,
  sendHost,
  onMenuPress,
  onNewChatPress,
  flags,
  arms,
  attachments,
  libraryDocs,
  onOpenDocuments,
  actions,
  onMiniappOpen,
}: ChatSurfaceProps) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const keyboardHeight = useKeyboardHeight();
  const [quickSheetVisible, setQuickSheetVisible] = useState(false);
  // The attach sheet and its nested document picker (the controller's
  // `attachSheetOpen` / `docPickOpen`, `Chat:1273-1276`) — surface-local like
  // the quick sheet, closed on a conversation change (`Chat:1889`).
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [docPickOpen, setDocPickOpen] = useState(false);
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
  const colors = modes[mode];

  // Every keystroke bumps the foreground-idle clock — the controller's
  // `Chat:4335` site (template fills skip it there, and they skip it here:
  // the sheet keeps calling `onDraftChange` directly below).
  const bumpDraftOnType = (text: string) => {
    onDraftChange(text);
    bumpForegroundIdleRef.current();
  };

  // ── The long-chat nudge (controller `Chat:921-922, 1314-1327`) ──
  // One-shot per conversation (V4.2 §Fase 3.5): the latch fires the first
  // time THIS conversation crosses the estimate; the conversation change IS
  // the controller's two resets (clearChat and load both arrive as one id
  // change here); the render gate keeps the previous conversation's row out
  // while a switch's history load is still in flight.
  const [longChatNudgeShown, setLongChatNudgeShown] = useState(false);
  // Recompute on length, resolved n_ctx and the last turn's (de)finalize —
  // NOT per token (`Chat:1318-1322`); the mapped band carries that flip as
  // `caret`/`stop` instead of the raw `streaming` flag.
  const longChat = useMemo(
    () => shouldShowLongChatNudge(view.transcript, modelHost.chatEngineCtx),
    [
      view.transcript.length,
      modelHost.chatEngineCtx,
      view.transcript[view.transcript.length - 1]?.caret,
      view.transcript[view.transcript.length - 1]?.stop,
    ],
  );
  useEffect(() => {
    if (longChat && !longChatNudgeShown) setLongChatNudgeShown(true);
  }, [longChat, longChatNudgeShown]);
  useEffect(() => {
    setLongChatNudgeShown(false);
    setAttachSheetOpen(false);
    setDocPickOpen(false);
  }, [conversationId]);

  // One row of the attach sheet: each press runs the hook's flow and closes
  // only when the controller did (cancel and refusals keep the sheet up).
  const handleAttachAction = (action: AttachAction) => {
    if (action === "library" || action === "camera") {
      void attachments.beginImagePick(action).then((close) => {
        if (close) setAttachSheetOpen(false);
      });
      return;
    }
    if (action === "document") {
      void attachments.beginDocumentPick().then((close) => {
        if (close) setAttachSheetOpen(false);
      });
      return;
    }
    setAttachSheetOpen(false);
    // The controller's `onComposerDocument` (`Chat:3662-3669`): an empty
    // library opens Documents, a stocked one opens the picker.
    if (libraryDocs.length === 0) onOpenDocuments();
    else setDocPickOpen(true);
  };

  // The toolbar's chips arm the NEXT send (one-shot; the arms clear on send,
  // on an emptied draft and on conversation change — `composerArms.ts`). The
  // machine's own answer gates them: while the face says stop no arm flips.
  const toolbar: ComposerToolbarProps = {
    onTemplatesPress: () => setQuickSheetVisible(true),
    researchActive: arms.research,
    onResearchPress: arms.toggleResearch,
    notesActive: arms.notes,
    onNotesPress: arms.toggleNotes,
    // The library-document ENTRY moved to the attach sheet (the row cannot
    // hold a third chip — `composerToolbarWidth.test.ts`); the machine still
    // gates what is here, now including a live PDF conversion.
    disabled: view.composer.face !== "send" || attachments.converting !== null,
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
      onDraftChange={bumpDraftOnType}
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
      onAttachPress={() => setAttachSheetOpen(true)}
      attachDisabled={view.composer.face !== "send" || attachments.converting !== null}
      onMicPress={() => showNoticeKey("shell.notice.mic")}
      fieldRef={fieldRef}
      webEnabled={flags.webToolsEnabled}
      onWebPress={flags.toggleWebTools}
      toolbar={toolbar}
      attachments={{
        chips: view.attachmentChips,
        onRemove: attachments.removeIndex,
        // The controller's `PdfToImages` mount (`Chat:4174-4185`), keyed on
        // the URI so a re-selection never reuses a finished conversion.
        job: attachments.converting ? (
          <PdfToImages
            key={attachments.converting.uri}
            pdfUri={attachments.converting.uri}
            onPage={attachments.pdf.onPage}
            onDone={attachments.pdf.onDone}
            onError={attachments.pdf.onError}
          />
        ) : undefined,
      }}
      onSendPress={() => {
        if (view.composer.face === "stop") sendHost.stop();
        else void sendHost.send(draft);
      }}
    >
      {/* The long-chat nudge (controller `Chat:3987-4006`): the row is
          `LongChatNudgeRow.tsx` — cut out so the attach sheet could land
          under this file's ratchet; the latch stays here. */}
      {longChat && longChatNudgeShown ? (
        <LongChatNudgeRow colors={colors} onNewChatPress={onNewChatPress} />
      ) : null}
      <Transcript
        insets={bandInsets}
        messages={view.transcript}
        mode={mode}
        empty={empty}
        onMessageLongPress={actions.onMessageLongPress}
        onCopy={actions.onCopy}
        onMiniappOpen={onMiniappOpen}
        translate={actions.translate}
        speakingId={actions.speakingId}
        onSpeak={actions.onSpeak}
      />
    </Shell>
    {/* The controller's message sheet, CALLED with the rows the host's pure
        builder allows (`messageMenuRows.ts`): copy, notes, translate, edit,
        regenerate — each with a system behind it. Android back and the
        backdrop both cancel. */}
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
    {/* The controller's edit modal (`AiChatPage.tsx:4500-4581`), mounted on
        the host's edit state: Save enters the shared resend handoff and the
        modal closes only when the claim took. */}
    <EditMessageModal
      visible={actions.edit !== null}
      mode={mode}
      draft={actions.edit?.draft ?? ""}
      onChange={actions.onEditDraftChange}
      onSubmit={actions.onEditSubmit}
      onClose={actions.onEditClose}
    />
    {/* The controller's attach sheet and nested document picker
        (`AiChatPage.tsx:4584-4663`), one component over row data. */}
    <HostAttachSheet
      open={attachSheetOpen ? "actions" : docPickOpen ? "documents" : null}
      colors={colors}
      docs={libraryDocs}
      onAction={handleAttachAction}
      onDocumentPick={(doc) => {
        attachments.addLibraryDocumentRow(doc);
        setDocPickOpen(false);
        setAttachSheetOpen(false);
      }}
      onClose={() => {
        setAttachSheetOpen(false);
        setDocPickOpen(false);
      }}
    />
    </>
  );
}
