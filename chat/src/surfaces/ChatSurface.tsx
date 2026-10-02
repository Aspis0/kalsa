// The chat's page: the sidebar, the thread, the composer, the files panel —
// everything the chat LOOKS like, rendered from the state `useChat` holds in
// the shell (the hook outlives this page's unmounts; see the draft's note
// there). No chat logic lives here: every handler is the hook's.

import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { Sidebar } from "../components/Sidebar";
import { Thread } from "../components/Thread";
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
    effectiveFailed,
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
            failed={effectiveFailed}
            tails={tails}
            onRetry={retry}
          />
        )}
        {attachStatus ? (
          <p className="attach-status" role="status">
            {attachStatus}
          </p>
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
        />
      </div>
      <Panel
        open={panelOpen && active !== null}
        attachments={attachments}
        contextTokens={ctxInfo && ctxInfo.endpoint === effectiveSettings.endpoint ? ctxInfo.nctx : null}
        historyTokens={convoTokens}
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
