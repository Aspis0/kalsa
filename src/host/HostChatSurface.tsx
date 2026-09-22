/**
 * The chat surface: the strip, the composer band and the transcript, wired to
 * the host — extracted from `HostRoot.tsx` under the owner's rule that the
 * root may only COMPOSE (`src/host/fileSize.test.ts`). This is the same JSX
 * the root used to render, moved not re-thought:
 *
 * - the strip's model-pill tap semantics (old `AppShell.tsx:6879-6911`), with
 *   the missing-download path serving `shell.notice.download` (§2.7);
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
import { useLocale, type TranslationKey } from "../i18n";
import type { ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { bottomInsetFor } from "../ui/shell/shellGeometry";
import { Shell } from "../ui/shell/Shell";
import { Transcript } from "../ui/shell/Transcript";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import type { ComposerView } from "./composerView";
import type { SendHost } from "./sendHost";
import type { useHostEngine } from "./useHostEngine";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];

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
  /** Export/share of the live conversation (D1 row 2), built by the root. */
  onExportPress?: () => void;
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
  onExportPress,
}: ChatSurfaceProps) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const keyboardHeight = useKeyboardHeight();

  // Strip pill, old chip semantics (AppShell:6879-6911): load when the bundle
  // is on disk but unloaded, retry an engine error, no-op while busy or
  // already resident (the old chip was disabled there); a missing bundle has
  // no download path in this build and says so (§2.7).
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

  return (
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
      onExportPress={onExportPress}
      onAttachPress={() => showNoticeKey("shell.notice.attach")}
      onMicPress={() => showNoticeKey("shell.notice.mic")}
      onSendPress={() => {
        if (view.composer.face === "stop") sendHost.stop();
        else void sendHost.send(draft);
      }}
    >
      <Transcript insets={bandInsets} messages={view.transcript} mode={mode} />
    </Shell>
  );
}
