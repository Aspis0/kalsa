import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMeta } from "../lib/types";
import { useLanguage } from "../i18n/useLanguage";
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

// The group names are table keys, not words: the map below is keyed by them
// and the words come from the chosen language.
function groupOf(updatedAt: number, today: number): string {
  const day = 86_400_000;
  const age = today - dayStart(updatedAt);
  if (age < day) return "today";
  if (age < 2 * day) return "yesterday";
  if (age < 7 * day) return "thisWeek";
  return "earlier";
}

const GROUP_ORDER = ["today", "yesterday", "thisWeek", "earlier"];

function stamp(when: number, tag: string): string {
  try {
    return new Intl.DateTimeFormat(tag).format(when);
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
  const { table, tag } = useLanguage();
  const t = table.sidebar;
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
    // The words for the groups come from the table at render, so the memo
    // does not depend on the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <aside className={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label={t.aria}>
        <div className="sidebar-search">
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
          <kbd title={t.focusSearch}>⌘K</kbd>
        </div>

        <button type="button" className="sidebar-new" onClick={onNew}>
          {t.newChat}
        </button>

        <div className="sidebar-list">
          {query.trim() && groups.total === 0 ? (
            <p className="sidebar-no-match">{t.noMatch(query.trim())}</p>
          ) : null}
          {GROUP_ORDER.map((group) => {
            const items = groups.map.get(group) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={group} aria-label={t.groups[group] ?? group}>
                <h3 className="sidebar-group">{t.groups[group] ?? group}</h3>
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
                        aria-label={t.titleAria}
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
                        title={conv.preview || conv.title || table.shell.untitled}
                        onClick={() => onSelect(conv.id)}
                      >
                        <span className="sidebar-row-top">
                          {isStreaming ? (
                            <span className="sidebar-live" aria-label={t.liveAria}>
                              <span aria-hidden="true" />
                            </span>
                          ) : null}
                          <span className="sidebar-title">{conv.title || table.shell.untitled}</span>
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
                          {t.rename}
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
                            {t.sure}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setArmingDelete(conv.id)}>
                            {t.delete}
                          </button>
                        )}
                      </span>
                      <span className="visually-hidden">{stamp(conv.updatedAt, tag)}</span>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {capped ? (
            <p className="sidebar-capped">{t.capped(RENDER_CAP, groups.total)}</p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
