/**
 * The chat surface: the strip, the composer band and the transcript, wired to
 * the host — the root's main child (the drawer, overlays and notice live in
 * `HostLayout.tsx` beside it). This is the JSX the root used to render, moved
 * not re-thought:
 *
 * - the strip's model-pill tap semantics (D1 row 33: download if missing,
 *   retry if error, load if ready; disabled while busy, inert when the
 *   embedder is hung) and the model bar's rows under the strip (rows 34-36),
 *   both decided in `useModelBar`;
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
import { PdfToImages } from "../components/PdfToImages";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TextInput } from "react-native";
import { useLocale, type TranslationKey } from "../i18n";
import { modes, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { bottomInsetFor } from "../ui/shell/shellGeometry";
import { Shell } from "../ui/shell/Shell";
import { Transcript } from "../ui/shell/Transcript";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import type { TranscriptMiniapp } from "../ui/shell/transcriptTypes";
import type { ComposerArms } from "./composerArms";
import type { ComposerView } from "./composerView";
import { type AttachAction } from "./HostAttachSheet";
import { HostChatSurfaceOverlays } from "./HostChatSurfaceOverlays";
import { LongChatNudgeRow } from "./LongChatNudgeRow";
import type { useMessageActions } from "./messageActions";
import type { SendHost } from "./sendHost";
import type { AttachmentsHost } from "./useAttachments";
import { useHostEngine } from "./useHostEngine";
import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import { shouldShowLongChatNudge } from "../chat/longChatEstimate";
import { useModelBar } from "./useModelBar";
import { WelcomeBlock } from "./welcomeBlock";
import { welcomeVisible } from "./welcomeGate";
import { runHostAttachment } from "./remoteAttachmentGate";
import { hostModelLocation } from "./hostModelLocation";
import { researchChipVisible } from "./composerArms";
import { runHostLocalAction } from "./remoteLocalAction";
import { remoteAttachmentChips } from "./remoteAttachmentChips";
import { applyTemplateSelection } from "./templateSelection";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];
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
  arms,
  attachments,
  libraryDocs,
  onOpenDocuments,
  actions,
  onMiniappOpen,
}: ChatSurfaceProps) {
  const { t } = useLocale();
  const location = hostModelLocation({
    remote: modelHost.remoteActive,
    modelState: modelHost.modelState,
    modelError: modelHost.modelError,
    t,
  });
  const whereLabel = location.label;
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

  // Strip pill semantics and the rows beneath it (D1 rows 33-36): one hook
  // owns the decision table, the derived labels and the battery sampling —
  // the controller computed these in render (`AppShell.tsx:6720-6788`).
  const modelBar = useModelBar(modelHost);

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
  const refuseRemoteAttachment = () => showNoticeKey("settings.remoteGated");
  useEffect(() => {
    if (modelHost.remoteActive) arms.clearResearch();
  }, [modelHost.remoteActive, arms.clearResearch]);
  const handleAttachAction = (action: AttachAction) => {
    if (action === "templates") {
      setAttachSheetOpen(false);
      setQuickSheetVisible(true);
      return;
    }
    if (action === "research") {
      runHostLocalAction(modelHost.remoteActiveRef.current, refuseRemoteAttachment, arms.toggleResearch);
      return;
    }
    if (action === "notes") {
      arms.toggleNotes();
      return;
    }
    if (action === "library" || action === "camera") {
      runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => {
        void attachments.beginImagePick(action).then((close) => {
          if (close) setAttachSheetOpen(false);
        });
      });
      return;
    }
    if (action === "document") {
      runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => {
        void attachments.beginDocumentPick().then((close) => {
          if (close) setAttachSheetOpen(false);
        });
      });
      return;
    }
    setAttachSheetOpen(false);
    // The controller's `onComposerDocument` (`Chat:3662-3669`): an empty
    // library opens Documents, a stocked one opens the picker.
    if (libraryDocs.length === 0) onOpenDocuments();
    else setDocPickOpen(true);
  };

  // Nothing shows until the history load has settled; then, on an empty
  // conversation, the welcome block rides INSIDE the transcript's own
  // scrolling content (D1 row 12).
  const empty = welcomeVisible(view.historyLoaded, view.transcript.length) ? <WelcomeBlock mode={mode} /> : undefined;

  return (
    <>
    <Shell
      insets={insets}
      modelName={modelHost.remoteActive ? t("settings.remoteComputer") : modelHost.currentModel.name}
      location={location.location}
      whereLabel={whereLabel}
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
      onModelPress={modelBar.onPress}
      modelBar={modelBar.view}
      onAttachPress={() => runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => setAttachSheetOpen(true))}
      attachDisabled={view.composer.face !== "send" || attachments.converting !== null}
      onMicPress={() => showNoticeKey("shell.notice.mic")}
      fieldRef={fieldRef}
      attachments={{
        chips: remoteAttachmentChips(view.attachmentChips, attachments.items, modelHost.remoteActive),
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
    <HostChatSurfaceOverlays
      bottomInset={insets.bottom}
      mode={mode}
      colors={colors}
      actions={actions}
      quickSheetVisible={quickSheetVisible}
      onQuickSheetClose={() => setQuickSheetVisible(false)}
      onChooseTemplate={(template) => {
        applyTemplateSelection(
          t(template.promptKey),
          onDraftChange,
          () => fieldRef.current?.focus(),
        );
      }}
      editDraft={actions.edit?.draft ?? ""}
      onEditDraftChange={actions.onEditDraftChange}
      onEditSubmit={actions.onEditSubmit}
      onEditClose={actions.onEditClose}
      attachSheetOpen={attachSheetOpen}
      docPickOpen={docPickOpen}
      docs={libraryDocs}
      researchActive={researchChipVisible(modelHost.remoteActive, arms.research)}
      notesActive={arms.notes}
      actionsDisabled={view.composer.face !== "send" || attachments.converting !== null}
      onAttachAction={handleAttachAction}
      onDocumentPick={(doc) => runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => {
        attachments.addLibraryDocumentRow(doc);
        setDocPickOpen(false);
        setAttachSheetOpen(false);
      })}
      onAttachClose={() => {
        setAttachSheetOpen(false);
        setDocPickOpen(false);
      }}
    />
    </>
  );
}
