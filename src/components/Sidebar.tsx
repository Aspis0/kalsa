import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMeta } from "../lib/types";
import "./Sidebar.css";

interface SidebarProps {
  conversations: ConversationMeta[];
  activeId: string | null;
  streamingIds: string[];
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

const RENDER_CAP = 150;

function dayStart(when: number): number {
  const d = new Date(when);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupOf(updatedAt: number, today: number): string {
  const day = 86_400_000;
  const age = today - dayStart(updatedAt);
  if (age < day) return "Today";
  if (age < 2 * day) return "Yesterday";
  if (age < 7 * day) return "This week";
  return "Earlier";
}

const GROUP_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

function stamp(when: number): string {
  try {
    return new Date(when).toLocaleString();
  } catch {
    return "";
  }
}

export function Sidebar({
  conversations,
  activeId,
  streamingIds,
  drawerOpen,
  onCloseDrawer,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [armingDelete, setArmingDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K jumps to search from anywhere.
  useEffect(() => {
    const jump = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.search.toLowerCase().includes(q))
      : conversations;
    const today = dayStart(Date.now());
    const map = new Map<string, ConversationMeta[]>();
    for (const c of filtered) {
      const g = groupOf(c.updatedAt, today);
      if (!map.has(g)) map.set(g, []);
      map.get(g)?.push(c);
    }
    return { map, total: filtered.length };
  }, [conversations, query]);

  function commitRename(): void {
    if (!editing) return;
    const title = editing.draft.trim();
    if (title) onRename(editing.id, title.slice(0, 80));
    setEditing(null);
  }

  let rendered = 0;
  const capped = groups.total > RENDER_CAP;

  return (
    <>
      {drawerOpen ? (
        <div className="drawer-backdrop" aria-hidden="true" onClick={onCloseDrawer} />
      ) : null}
      <aside className={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label="Conversations">
        <div className="sidebar-search">
          <label className="visually-hidden" htmlFor="conversation-search">
            Search conversations
          </label>
          <input
            id="conversation-search"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            autoComplete="off"
          />
          <kbd title="Focus search">⌘K</kbd>
        </div>

        <button type="button" className="sidebar-new" onClick={onNew}>
          + New chat
        </button>

        <div className="sidebar-list">
          {query.trim() && groups.total === 0 ? (
            <p className="sidebar-no-match">No conversations match “{query.trim()}”.</p>
          ) : null}
          {GROUP_ORDER.map((group) => {
            const items = groups.map.get(group) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={group} aria-label={group}>
                <h3 className="sidebar-group">{group}</h3>
                {items.map((conv) => {
                  if (rendered >= RENDER_CAP) return null;
                  rendered++;
                  const isActive = conv.id === activeId;
                  const isStreaming = streamingIds.includes(conv.id);
                  if (editing?.id === conv.id) {
                    return (
                      <input
                        key={conv.id}
                        className="sidebar-rename"
                        autoFocus
                        defaultValue={editing.draft}
                        aria-label="Conversation title"
                        maxLength={80}
                        onChange={(event) =>
                          setEditing({ id: conv.id, draft: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setEditing(null);
                        }}
                        onBlur={commitRename}
                      />
                    );
                  }
                  return (
                    <div key={conv.id} className={`sidebar-row${isActive ? " sidebar-row-active" : ""}`}>
                      <button
                        type="button"
                        className="sidebar-open-conv"
                        aria-current={isActive ? "true" : undefined}
                        title={conv.preview || conv.title}
                        onClick={() => onSelect(conv.id)}
                      >
                        <span className="sidebar-row-top">
                          {isStreaming ? (
                            <span className="sidebar-live" aria-label=" (generating)">
                              <span aria-hidden="true" />
                            </span>
                          ) : null}
                          <span className="sidebar-title">{conv.title}</span>
                        </span>
                        {conv.preview ? (
                          <span className="sidebar-preview">{conv.preview}</span>
                        ) : null}
                      </button>
                      <span className="sidebar-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setArmingDelete(null);
                            setEditing({ id: conv.id, draft: conv.title });
                          }}
                        >
                          Rename
                        </button>
                        {armingDelete === conv.id ? (
                          <button
                            type="button"
                            className="sidebar-danger-armed"
                            onClick={() => {
                              setArmingDelete(null);
                              onDelete(conv.id);
                            }}
                            onBlur={() => setArmingDelete(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setArmingDelete(null);
                            }}
                          >
                            Sure?
                          </button>
                        ) : (
                          <button type="button" onClick={() => setArmingDelete(conv.id)}>
                            Delete
                          </button>
                        )}
                      </span>
                      <span className="visually-hidden">{stamp(conv.updatedAt)}</span>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {capped ? (
            <p className="sidebar-capped">
              Showing the first {RENDER_CAP} of {groups.total} matches.
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
