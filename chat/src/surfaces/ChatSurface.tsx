import type { SurfaceKey } from "../app/surfaces";
import { ChatHeader } from "../components/ChatHeader";
import { ChatList } from "../components/ChatList";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { Thread } from "../components/Thread";
import { useLanguage } from "../i18n/useLanguage";
import type { Chat } from "./useChat";

/** The chat page: header, conversation list, transcript, writing box and the
    side panel. All state comes from the hook held by the shell. */
export function ChatSurface({ chat, onNavigate }: { chat: Chat; onNavigate: (surface: SurfaceKey) => void }) {
  const { table } = useLanguage();
  const t = table.shell;
  const title = chat.active?.title || t.newConversation;

  return (
    <div className="chat-page">
      <ChatHeader
        title={title}
        listOpen={chat.listOpen}
        onToggleList={() => chat.setListOpen(!chat.listOpen)}
        filesOpen={chat.active ? chat.panelOpen : null}
        onToggleFiles={() => chat.setPanelOpen(!chat.panelOpen)}
        onNew={chat.newConversation}
      />
      <ChatList
        open={chat.listOpen}
        onOpen={() => chat.setListOpen(true)}
        onClose={() => chat.setListOpen(false)}
        conversations={chat.conversations}
        activeId={chat.activeId}
        streamingIds={[]}
        onSelect={chat.selectConversation}
        onNew={chat.newConversation}
        onRename={chat.renameConversation}
        onDelete={chat.removeConversation}
      />
      <div className="chat-layout">
        <div className="main-col">
          {chat.active && chat.active.messages.length > 0 ? (
            <Thread messages={chat.active.messages} />
          ) : (
            <EmptyState onOpenEngines={() => onNavigate("models")} />
          )}
          <Composer draft={chat.draft} onDraftChange={chat.setDraft} onSend={chat.send} />
        </div>
        <Panel open={chat.panelOpen && chat.active !== undefined} onClose={() => chat.setPanelOpen(false)} />
      </div>
    </div>
  );
}
