// The chat's page: the sidebar, the thread, the composer, the files panel —
// everything the chat LOOKS like, rendered from the state `useChat` holds in
// the shell (the hook outlives this page's unmounts; see the draft's note
// there). No chat logic lives here: every handler is the hook's.

import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { IMAGE_TOKENS } from "../lib/attachments";
import { Panel } from "../components/Panel";
import { Sidebar } from "../components/Sidebar";
import { Thread } from "../components/Thread";
import { VisionOffer } from "../components/VisionOffer";
import { useLanguage } from "../i18n/useLanguage";
import type { Chat } from "./useChat";

export function ChatSurface({ chat }: { chat: Chat }) {
  const { table } = useLanguage();
  const t = table.shell;
  const {
    active,
    activeId,
    conversations,
    streamingIds,
    streaming,
    failures,
    tails,
    drawerOpen,
    setDrawerOpen,
    dragging,
    setDragging,
    attachFiles,
    attachFromDisk,
    attachStatus,
    refusal,
    setRefusal,
    setup,
    credentialMessage,
    effectiveSettings,
    thinking,
    thinkingSupported,
    saveThinking,
    vision,
    visionOfferBytes,
    visionFlow,
    visionStep,
    askVision,
    dismissVision,
    enableVision,
    pendingImages,
    removeImage,
    draft,
    setDraft,
    send,
    stop,
    retry,
    selectConversation,
    newConversation,
    removeConversation,
    renameConversation,
    removeAttachment,
    pending,
    creating,
    attachments,
    ctxInfo,
    convoTokens,
    panelOpen,
    setPanelOpen,
    openSurface,
  } = chat;
  const empty = !active || active.messages.length === 0;

  return (
    <div className="chat-layout">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        streamingIds={streamingIds}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        onSelect={selectConversation}
        onNew={newConversation}
        onRename={renameConversation}
        onDelete={removeConversation}
      />
      <div
        className="main-col"
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer?.files.length) void attachFiles(event.dataTransfer.files);
        }}
      >
        {dragging ? (
          <div className="drop-overlay" aria-hidden="true">
            <span>{t.dropToAttach}</span>
          </div>
        ) : null}
        {refusal ? (
          <div className="refusal-banner" role="alert">
            <span>
              <strong>
                {refusal.names.includes(",")
                  ? t.tooMuchPlural(refusal.names)
                  : t.tooMuchSingular(refusal.names)}
              </strong>
              {` ${t.refusalBody}`}
            </span>
            <button type="button" onClick={() => setRefusal(null)}>
              {t.dismiss}
            </button>
          </div>
        ) : null}
        {empty ? (
          <EmptyState
            setup={setup}
            credentialMessage={credentialMessage}
            onOpenModels={() => openSurface("models")}
            onOpenServer={() => openSurface("server")}
            onOpenDevices={() => openSurface("devices")}
          />
        ) : (
          <Thread
            messages={active.messages}
            streaming={streaming}
            failures={failures}
            tails={tails}
            onRetry={retry}
            onMiniappState={chat.saveMiniappState}
          />
        )}
        {attachStatus ? (
          <p className="attach-status" role="status">
            {attachStatus}
          </p>
        ) : null}
        {visionFlow ? (
          <VisionOffer
            phase={visionFlow}
            step={visionStep}
            onDownload={() => void enableVision()}
            onNotNow={dismissVision}
            onRetry={() => void enableVision()}
          />
        ) : null}
        <Composer
          thinking={thinkingSupported ? thinking : null}
          onThinking={saveThinking}
          streaming={streaming}
          opening={pending || creating}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          onStop={stop}
          onAttach={(files) => void attachFiles(files)}
          acceptsImages={vision}
          acceptsVideos={vision}
          visionOfferBytes={visionOfferBytes}
          onOfferVision={askVision}
          images={pendingImages.map((chip) => ({
            id: chip.id,
            url: chip.url,
            kind: chip.kind,
            ...(chip.kind === "video" && chip.compressing
              ? { label: table.composer.compressing(Math.round(chip.progress * 100)) }
              : {}),
          }))}
          onRemoveImage={removeImage}
        />
      </div>
      <Panel
        open={panelOpen && active !== null}
        attachments={attachments}
        contextTokens={ctxInfo && ctxInfo.endpoint === effectiveSettings.endpoint ? ctxInfo.nctx : null}
        historyTokens={convoTokens}
        imageCount={
          pendingImages.length +
          pendingImages.reduce(
            (sum, chip) => sum + (chip.kind === "video" ? chip.frames.length : 0),
            0,
          )
        }
        imageTokens={
          (pendingImages.length +
            pendingImages.reduce(
              (sum, chip) => sum + (chip.kind === "video" ? chip.frames.length : 0),
              0,
            )) *
          IMAGE_TOKENS
        }
        onRemove={removeAttachment}
        onReattach={(id) => {
          if (!activeId) return;
          const found = attachments.find((a) => a.id === id);
          if (found) chat.reattachAttachment(activeId, id);
        }}
        onAttachFile={(path, name) => void attachFromDisk(path, name)}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
