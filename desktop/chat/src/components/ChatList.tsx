import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMeta } from "../lib/types";
import { useLanguage } from "../i18n/useLanguage";
import { searchShortcutLabel } from "../lib/shortcut";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import "./ChatList.css";

interface ChatListProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  conversations: ConversationMeta[];
  activeId: string | null;
  streamingIds: string[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

const RENDER_CAP = 150;

/** The popover and the Chats button that opens it, tied by aria-controls. */
export const CHAT_LIST_ID = "chat-list";
export const CHAT_LIST_TOGGLE_ID = "chat-list-toggle";

function focusToggle(): void {
  document.getElementById(CHAT_LIST_TOGGLE_ID)?.focus();
}

function dayStart(when: number): number {
  const d = new Date(when);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// The group names are table keys, not words: the words come from the chosen language.
function groupOf(updatedAt: number, today: number): string {
  const day = 86_400_000;
  const age = today - dayStart(updatedAt);
  if (age < day) return "today";
  if (age < 2 * day) return "yesterday";
  if (age < 7 * day) return "thisWeek";
  return "earlier";
}

/** The chat list (RULES.md "Chat list"): a popover under the Chats button, never
    a second permanent column. The component stays mounted while the popover is
    closed, so its ⌘K listener and a pending delete dialog outlive it. */
export function ChatList({
  open,
  onOpen,
  onClose,
  conversations,
  activeId,
  streamingIds,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ChatListProps) {
  const { table } = useLanguage();
  const t = table.sidebar;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [deleting, setDeleting] = useState<ConversationMeta | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(open);
  // Read by the one ⌘K listener, so it is added once and never sees a stale value.
  const latest = useRef({ onOpen, deleting });
  latest.current = { onOpen, deleting };

  // ⌘K / Ctrl+K opens the list from anywhere in the chat and puts the cursor in
  // search — never behind an open delete dialog, which owns the keyboard.
  useEffect(() => {
    const jump = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (latest.current.deleting === null) latest.current.onOpen();
    };
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  }, []);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      setEditing(null);
      // Focus that lived in the list goes back to the button that opened it,
      // unless something newer (the delete dialog) has already taken it.
      if (wasOpen.current && document.activeElement === document.body) focusToggle();
    }
    wasOpen.current = open;
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.search.toLowerCase().includes(q)) : conversations;
    return { rows: filtered.slice(0, RENDER_CAP), total: filtered.length };
  }, [conversations, query]);

  function commitRename(): void {
    if (!editing) return;
    const title = editing.draft.trim();
    if (title) onRename(editing.id, title.slice(0, 80));
    setEditing(null);
  }

  const today = dayStart(Date.now());

  return (
    <>
      {open ? (
        <>
          <div className="chat-list-scrim" aria-hidden="true" onClick={onClose} />
          <div id={CHAT_LIST_ID} className="chat-list" role="dialog" aria-label={t.aria}>
            <button type="button" className="chat-list-new" onClick={onNew}>
              <Icon name="plus" size={19} stroke={2.2} />
              {t.newChat}
            </button>
            <div className="chat-list-search">
              <Icon name="search" size={16} />
              <label className="visually-hidden" htmlFor="conversation-search">
                {t.searchAria}
              </label>
              <input
                id="conversation-search"
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.searchPlaceholder}
                autoComplete="off"
              />
              <kbd title={t.focusSearch}>{searchShortcutLabel(navigator.platform)}</kbd>
            </div>
            <div className="chat-list-rows">
              {query.trim() && shown.total === 0 ? <p className="chat-list-none">{t.noMatch(query.trim())}</p> : null}
              {shown.rows.map((conv) => {
                const when = t.groups[groupOf(conv.updatedAt, today)];
                if (editing?.id === conv.id) {
                  return (
                    <div key={conv.id} className="chat-list-row chat-list-editing">
                      <Icon name="pencil" size={17} />
                      <input
                        className="chat-list-rename"
                        autoFocus
                        defaultValue={editing.draft}
                        placeholder={table.shell.untitled}
                        aria-label={t.titleAria}
                        maxLength={80}
                        onChange={(event) => setEditing({ id: conv.id, draft: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") {
                            // Leaves the rename, not the list.
                            event.preventDefault();
                            setEditing(null);
                          }
                        }}
                        onBlur={commitRename}
                      />
                      <em>{t.enterToSave}</em>
                    </div>
                  );
                }
                const isActive = conv.id === activeId;
                return (
                  <div key={conv.id} className={`chat-list-row${isActive ? " chat-list-active" : ""}`}>
                    <button
                      type="button"
                      className="chat-list-open"
                      aria-current={isActive ? "true" : undefined}
                      title={conv.preview || conv.title || table.shell.untitled}
                      onClick={() => onSelect(conv.id)}
                    >
                      <Icon name="chat" size={17} />
                      {streamingIds.includes(conv.id) ? (
                        <span className="chat-list-live" aria-label={t.liveAria}>
                          <span aria-hidden="true" />
                        </span>
                      ) : null}
                      <span className="chat-list-title">{conv.title || table.shell.untitled}</span>
                      <em>{when}</em>
                    </button>
                    <span className="chat-list-actions">
                      <button type="button" onClick={() => setEditing({ id: conv.id, draft: conv.title })}>
                        <Icon name="pencil" size={13} />
                        {t.rename}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleting(conv);
                          onClose();
                        }}
                      >
                        <Icon name="trash" size={13} />
                        {t.delete}
                      </button>
                    </span>
                  </div>
                );
              })}
              {shown.total > RENDER_CAP ? <p className="chat-list-none">{t.capped(RENDER_CAP, shown.total)}</p> : null}
            </div>
          </div>
        </>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          icon="trash"
          tone="danger"
          title={t.sure}
          body={t.deleteBody(deleting.title || table.shell.untitled)}
          cancel={t.cancel}
          confirm={t.delete}
          onCancel={() => {
            setDeleting(null);
            focusToggle();
          }}
          onConfirm={() => {
            setDeleting(null);
            onDelete(deleting.id);
            focusToggle();
          }}
        />
      ) : null}
    </>
  );
}
