import { useEffect, useState } from "react";
import { createStore, uid } from "../lib/store";
import type { Conversation, ConversationMeta } from "../lib/types";

const store = createStore();

export interface Chat {
  conversations: ConversationMeta[];
  active: Conversation | undefined;
  activeId: string | null;
  listOpen: boolean;
  setListOpen: (open: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string) => boolean;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  removeConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
}

function newConversation(): Conversation {
  const now = Date.now();
  return { id: uid(), title: "", preview: "", updatedAt: now, search: "", messages: [] };
}

function titleOf(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
}

/** The chat's local state. M0 stores turns on this machine; an engine's
    endpoint will replace `send` when chat is wired to one. */
export function useChat(): Chat {
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => store.list());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Conversation | undefined>(undefined);
  const [listOpen, setListOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => store.subscribe(() => setConversations(store.list())), []);

  function open(conversation: Conversation): void {
    store.put(conversation);
    setActive(conversation);
    setActiveId(conversation.id);
  }

  function send(text: string): boolean {
    const words = text.trim();
    if (!words) return false;
    const conversation = active ?? newConversation();
    const message = { id: uid(), role: "user" as const, content: words, createdAt: Date.now() };
    const next: Conversation = {
      ...conversation,
      title: conversation.title || titleOf(words),
      preview: words,
      search: `${conversation.search} ${words}`.trim(),
      updatedAt: message.createdAt,
      messages: [...conversation.messages, message],
    };
    open(next);
    return true;
  }

  return {
    conversations,
    active,
    activeId,
    listOpen,
    setListOpen,
    panelOpen,
    setPanelOpen,
    draft,
    setDraft,
    send,
    newConversation() {
      setActive(undefined);
      setActiveId(null);
      setListOpen(false);
    },
    selectConversation(id) {
      const found = store.get(id);
      if (found) {
        setActive(found);
        setActiveId(id);
        setListOpen(false);
      }
    },
    removeConversation(id) {
      store.remove(id);
      if (id === activeId) {
        setActive(undefined);
        setActiveId(null);
      }
    },
    renameConversation(id, title) {
      const found = store.get(id);
      if (found) store.put({ ...found, title, search: `${title} ${found.search}`.trim() });
      if (id === activeId) setActive((current) => (current ? { ...current, title } : current));
    },
  };
}
