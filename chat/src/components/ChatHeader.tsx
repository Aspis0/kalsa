import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import { CHAT_LIST_ID, CHAT_LIST_TOGGLE_ID } from "./ChatList";
import "./ChatHeader.css";

/** The chat's own bar (mockup 02-chat): the list on the left, the title in the
    middle, Files and New chat on the right. */
export function ChatHeader({
  title,
  listOpen,
  onToggleList,
  filesOpen,
  onToggleFiles,
  onNew,
}: {
  title: string;
  listOpen: boolean;
  onToggleList: () => void;
  /** Null while no conversation is open: there is nothing to attach to yet,
      so Files stands where the mockups draw it, disabled. */
  filesOpen: boolean | null;
  onToggleFiles: () => void;
  onNew: () => void;
}) {
  const { table } = useLanguage();
  const t = table.shell;
  return (
    <header className="chat-head">
      <button
        type="button"
        id={CHAT_LIST_TOGGLE_ID}
        className={`chat-head-btn${listOpen ? " is-open" : ""}`}
        onClick={onToggleList}
        aria-expanded={listOpen}
        aria-controls={CHAT_LIST_ID}
        aria-label={table.chrome.showConversations}
      >
        <Icon name="sidebar" size={18} />
        {t.conversations}
        <Icon name="down" size={15} stroke={2.2} />
      </button>
      <h1 className="chat-head-title">{title}</h1>
      <button
        type="button"
        className={`chat-head-btn${filesOpen ? " is-open" : ""}`}
        onClick={onToggleFiles}
        disabled={filesOpen === null}
        aria-expanded={filesOpen ?? false}
        aria-label={t.toggleFilesAria}
      >
        <Icon name="file" size={18} />
        {t.files}
      </button>
      <button type="button" className="chat-head-btn" onClick={onNew}>
        <Icon name="plus" size={18} stroke={2.2} />
        {table.sidebar.newChat}
      </button>
    </header>
  );
}
