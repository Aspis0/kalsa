import type { ConversationsState } from "../conversations/ConversationsStore";
import {
  createConversation,
  deleteConversation,
  findIdleConversation,
  listConversations,
  readConversations,
  switchConversation,
  touchConversation,
  type ConversationIndexStore,
} from "./conversations";

function meta(id: string, updatedAt: number) {
  return {
    id,
    title: `title-${id}`,
    updatedAt,
    preview: `preview-${id}`,
    searchBlob: `blob-${id}`,
    hasMessages: true,
  };
}

function state(activeId: string, items: ConversationsState["items"]): ConversationsState {
  return { activeId, items };
}

function fakeStore(initial: ConversationsState) {
  const order: string[] = [];
  let current = initial;
  let deleteResult = true;
  const store: ConversationIndexStore = {
    async read() {
      order.push("read");
      return current;
    },
    async write(next) {
      order.push("write");
      current = next;
    },
    async deleteMessages() {
      order.push("deleteMessages");
      return deleteResult;
    },
  };
  return {
    store,
    order,
    current: () => current,
    setDeleteResult: (value: boolean) => {
      deleteResult = value;
    },
  };
}

describe("conversations — delete", () => {
  it("deleting the active conversation activates the most recent survivor (prevents: drawer active id pointing at a deleted conversation)", async () => {
    const h = fakeStore(state("b", [meta("a", 100), meta("b", 200), meta("c", 300)]));

    const { state: next, deleteIncomplete } = await deleteConversation(h.store, h.current(), "b");

    expect(next.activeId).toBe("c");
    expect(next.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(deleteIncomplete).toBe(false);
  });

  it("deleting the last conversation leaves no active id (prevents: a ghost active row over an empty index)", async () => {
    const h = fakeStore(state("only", [meta("only", 100)]));

    const { state: next } = await deleteConversation(h.store, h.current(), "only");

    expect(next).toEqual({ activeId: "", items: [] });
  });

  it("deleting an inactive conversation keeps the active id (prevents: unrelated chat switch when deleting a background chat)", async () => {
    const h = fakeStore(state("a", [meta("a", 100), meta("b", 200)]));

    const { state: next } = await deleteConversation(h.store, h.current(), "b");

    expect(next.activeId).toBe("a");
    expect(next.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("writes the index before removing the messages key (prevents: an index row pointing at a wiped key)", async () => {
    const h = fakeStore(state("b", [meta("a", 100), meta("b", 200)]));

    await deleteConversation(h.store, h.current(), "b");

    expect(h.order).toEqual(["write", "deleteMessages"]);
  });

  it("an unknown id deletes nothing and writes nothing (prevents: index churn on a double delete)", async () => {
    const h = fakeStore(state("a", [meta("a", 100)]));

    const { state: next } = await deleteConversation(h.store, h.current(), "missing");

    expect(next).toBe(h.current());
    expect(h.order).toEqual([]);
  });

  it("reports an incomplete sweep instead of throwing (prevents: quarantine slots surviving a delete unnoticed)", async () => {
    const h = fakeStore(state("a", [meta("a", 100), meta("b", 200)]));
    h.setDeleteResult(false);

    const { deleteIncomplete } = await deleteConversation(h.store, h.current(), "b");

    expect(deleteIncomplete).toBe(true);
  });
});

describe("conversations — touch", () => {
  it("touching does not reorder the list (prevents: the drawer reshuffling under the user's finger)", () => {
    const before = state("b", [meta("a", 100), meta("b", 200), meta("c", 300)]);

    const after = touchConversation(
      before,
      { title: "", preview: "new preview", searchBlob: "new blob" },
      400,
    );

    expect(after.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    const touched = after.items[1];
    // Fresh content on the active row, everything else untouched.
    expect(touched).toEqual({
      ...before.items[1],
      title: "title-b",
      updatedAt: 400,
      preview: "new preview",
      searchBlob: "new blob",
      hasMessages: true,
    });
    expect(after.items[0]).toBe(before.items[0]);
    expect(after.items[2]).toBe(before.items[2]);
  });

  it("touch with no active id or an active id outside the index changes nothing (prevents: touch writing to a ghost id)", () => {
    const noActive = state("", [meta("a", 100)]);
    expect(touchConversation(noActive, { title: "t", preview: "p", searchBlob: "s" })).toBe(noActive);

    const ghost = state("gone", [meta("a", 100)]);
    expect(touchConversation(ghost, { title: "t", preview: "p", searchBlob: "s" })).toBe(ghost);
  });
});

describe("conversations — create", () => {
  it("creating never reuses a deleted key (prevents: a new chat resurrecting a deleted conversation's messages under an old id)", async () => {
    let working = state("", []);
    const used = new Set<string>();
    const deleted = new Set<string>();

    for (let i = 0; i < 40; i += 1) {
      working = createConversation(working, { now: 1000 + i });
      const created = working.activeId;
      expect(used.has(created)).toBe(false);
      used.add(created);
      deleted.add(created);
      const h = fakeStore(working);
      working = (await deleteConversation(h.store, working, created)).state;
    }

    for (const id of used) expect(deleted.has(id)).toBe(true);
    // Fresh ids keep coming after deletions — the pool is never refilled.
    working = createConversation(working);
    expect(used.has(working.activeId)).toBe(false);
  });

  it("an injected id factory is used verbatim (deterministic create for callers that mint their own keys)", () => {
    const before = state("a", [meta("a", 100)]);

    const after = createConversation(before, { now: 500, newId: () => "conv-custom" });

    expect(after).toEqual({
      activeId: "conv-custom",
      items: [
        before.items[0],
        { id: "conv-custom", title: "", updatedAt: 500, preview: "", searchBlob: "", hasMessages: false },
      ],
    });
  });

  it("findIdleConversation skips the active chat and occupied threads (prevents: New chat reusing a conversation that has messages)", async () => {
    const before = state("a", [meta("a", 100), meta("b", 200), meta("c", 300)]);
    const occupied = new Set(["a", "c"]);

    const idle = await findIdleConversation(before, async (id) => occupied.has(id));

    expect(idle).toBe("b");
    // Active chat unoccupied is still never a candidate (AppShell:2428).
    expect(await findIdleConversation(state("a", [meta("a", 100)]), async () => false)).toBeNull();
  });
});

describe("conversations — list, switch, read", () => {
  it("switching to an unknown or empty id leaves the active id unchanged (prevents: active id outside the index)", () => {
    const before = state("a", [meta("a", 100), meta("b", 200)]);

    expect(switchConversation(before, "missing").activeId).toBe("a");
    expect(switchConversation(before, "").activeId).toBe("a");
    expect(switchConversation(before, "b").activeId).toBe("b");
  });

  it("list is recency-ordered and query-filtered (prevents: the drawer showing insertion order instead of recency)", () => {
    const before = state("a", [meta("a", 100), meta("c", 300), meta("b", 200)]);

    expect(listConversations(before).map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(listConversations(before, "title-c").map((i) => i.id)).toEqual(["c"]);
  });

  it("a failing store read yields the empty state (prevents: corrupt index crashing boot)", async () => {
    const store: ConversationIndexStore = {
      read: async () => {
        throw new Error("corrupt");
      },
      write: async () => undefined,
      deleteMessages: async () => true,
    };

    expect(await readConversations(store)).toEqual({ activeId: "", items: [] });
  });
});
