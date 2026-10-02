// The chat: its store, its door gate, and every flow a message takes —
// sending into a fresh or an open chat, selecting and removing conversations,
// pinning documents, retrying, stopping. The shell renders what this returns
// (surfaces/ChatSurface.tsx) and keeps only what outlives the chat's own
// unmount: the draft survives it because THIS hook lives in the shell, not
// because the state lives in any particular file.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createStore, titleFor, uid } from "../lib/store";
import { activateChat, eraseChat, fetchContextSize, serverBase } from "../lib/chat";
import { ensureContextSize, hasContextSize } from "../lib/contextSize";
import { createSlotGate } from "../lib/slotGate";
import type { ActiveChat, DoorAccess, SlotNotice } from "../lib/slotGate";
import { loadThinking, saveThinking, thinkingSupport } from "../lib/thinking";
import type { ChatSettings, Conversation, ConversationMeta } from "../lib/types";
import type { FailedState } from "../components/Thread";
import type { Attachment } from "../lib/attachments";
import { AttachmentError, buildPinnedContext, extractAttachment, historyTokens } from "../lib/attachments";
import { filesRead } from "../lib/files";
import type { SurfaceKey } from "../app/surfaces";
import { arrivingIn, handoff, leavingGhost } from "../app/handoff";
import { useLanguage } from "../i18n/useLanguage";
import { rustSentence } from "../lib/rustText";
import { useBrain, useBrainServer, useDoorStanding, withBrainDefaults } from "./useBrain";
import { useServerFacts } from "./useServerFacts";
import { setupArm } from "../components/EmptyState";
import { useChatTurns } from "./useChatTurns";

export const store = createStore();
// One gate for the window, beside the one store: it holds which chat is active,
// so it must outlive every render. A `useMemo` would let React discard it.
const gate = createSlotGate();

/** The gate's snapshot, wherever a renderer needs it: the shell reads the
    slot's notice, the chat reads whose turn it is and whether sends freeze. */
function useSlot() {
  return useSyncExternalStore(gate.subscribe, gate.getSnapshot);
}

interface Refusal {
  names: string;
  docTokens: number;
  historyTokens: number;
  need: number;
  have: number;
}

/** What the chat needs from the room around it: the shell's navigation (a
    send lands the owner on the chat), the shell's status line, the shell's
    slot banner, and the settings the app's own surfaces write. */
interface ChatShell {
  openSurface: (next: SurfaceKey) => void;
  announce: (message: string) => void;
  setSlotNotice: (notice: SlotNotice | null) => void;
  settings: ChatSettings;
}

export function useChat(shell: ChatShell) {
  const { openSurface, announce, setSlotNotice, settings } = shell;
  const { table, tag } = useLanguage();
  const t = table.shell;
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => store.list());
  const [storageFull, setStorageFull] = useState(false);
  // What the door answered about a slot, when the answer is not a plain
  // success. `failed` is the difference between a warning and a refusal: a door
  // built without the disk tier (501) leaves the chat open and only says so,
  // while a refusal means the chat was NOT opened and the sentence it came with
  // must be read as the door wrote it — never softened, and never turned into
  // "the slot is empty", which the door reserves for the one case it knows
  // that about.
  // The disk tier's one road to an active chat: the gate owns which chat is
  // active, and it changes only after the door has answered.
  // `useSyncExternalStore` is what removes the setter — there is no state here
  // for another path to bypass the door with. See `lib/slotGate.ts` for the
  // four races this closes.
  const slot = useSlot();
  const activeId = slot.active?.id ?? null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [ctxInfo, setCtxInfo] = useState<{ endpoint: string; nctx: number | null } | null>(null);
  // Numbers only, and that IS the healing rule: an unknown answer is never
  // stored (the choice and its cost are declared at `ensureContextSize` in
  // lib/contextSize.ts), so a `null` cannot be memoized here until the user
  // happens to save settings — which was the defect. Clearing on save below
  // stays correct (the endpoint or token may have changed); it is simply no
  // longer the only road out.
  const nctxCache = useRef(new Map<string, number>());
  // The message the brain's writing bar became, for the one open move.
  // The composer's unsent text. Going home unmounts the chat, and the
  // draft must survive that round trip, so it lives in the hook the shell
  // holds — the hook does not unmount when the chat does.
  const [draft, setDraft] = useState("");

  useEffect(
    () =>
      store.subscribe(() => {
        setConversations(store.list());
        // A code, not a sentence — the words are the table's below.
        setStorageFull(store.getWriteError() === "storage-full");
      }),
    [],
  );

  // The brain's own server fills the blanks, so the chat never calls itself
  // unconfigured while the machine is serving; with the machine off the
  // blanks stand, and the first page says which page fixes that.
  const brainServer = useBrainServer();
  const effectiveSettings = useMemo(
    () => withBrainDefaults(settings, brainServer),
    [settings, brainServer],
  );
  // Why the first page has nothing to offer, in the words of the page that
  // fixes it: `setupArm` maps this machine's own state onto those arms — an
  // off machine lands on the Server page, a starting one says so, a refused
  // key lands where the key is re-minted, a nameless model on Settings.
  // The door comes from the STATE's own address: the credential read is
  // gated on that address, so "no door" must never be confused with "the
  // credential has not answered yet".
  const { state, credential, credentialMessage } = useBrain();
  const setup = setupArm(
    state?.kind ?? null,
    credential,
    Boolean(state?.endpoint),
    effectiveSettings.model,
  );
  // The disk tier's door, when this window is talking to one: a running
  // brain is the fact that makes the endpoint the door and the token this
  // device's credential (`withBrainDefaults`). With no door there is no tier
  // to ask: there is no other server this page can name.
  const door = useMemo(
    () =>
      brainServer ? { endpoint: brainServer.endpoint, token: brainServer.credential } : null,
    [brainServer],
  );
  // The door's own standing, from the same poll: `absent` is the only one in
  // which an open may settle locally, and "this window cannot call the door
  // yet" is a different fact that holds the open instead.
  const standing = useDoorStanding();
  // What the gate is allowed to do, in one place, told to the gate whenever it
  // changes. It is the gate's own state and not a parameter of each open: the
  // open that is held has to be retried when the door becomes callable, and
  // only the gate can see that happen.
  // LAYOUT, not passive: the render that first sees the door's endpoint must
  // not be observable by a queued send before the gate has been told. A
  // passive effect is a scheduler task away, and in that task the composer is
  // already pointed at the door while the gate still holds the chat as locally
  // minted — the completion would reach the door before the hand-over is
  // queued: the fifth way's shape, one task wide.
  useLayoutEffect(() => {
    const next: DoorAccess =
      standing === "ready" && door
        ? { kind: "ready", activate: (id: string) => activateChat(door.endpoint, door.token, id) }
        : standing === "unready"
          ? { kind: "unready" }
          : { kind: "absent" };
    void gate.setAccess(next);
  }, [standing, door]);
  // The model's own chat template decides whether a thinking switch may be
  // offered at all, and it is read from the one road to `/props`
  // (`useServerFacts`) — the sampler panel reads the same fact the same way.
  const { chatTemplate } = useServerFacts(effectiveSettings.endpoint, effectiveSettings.token);
  const thinkingSupported = thinkingSupport(chatTemplate).enableThinking;
  // Per model, and it follows the model this request will name: the brain's own
  // fills the blank while the machine is serving.
  const [thinking, setThinking] = useState(() => loadThinking(effectiveSettings.model));
  useEffect(() => {
    setThinking(loadThinking(effectiveSettings.model));
  }, [effectiveSettings.model]);
  const attachments: Attachment[] = useMemo(
    () => (activeId ? store.getAttachments(activeId) : []),
    // conversations refreshes on every store notification (index is small).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, activeId],
  );

  const turns = useChatTurns({ store, announce, contextSizes: nctxCache });
  const { live, streamingByConv, failedById } = turns;

  const active = useMemo(() => {
    const conv = activeId ? (store.get(activeId) ?? null) : null;
    if (!conv) return null;
    let changed = false;
    const messages = conv.messages.map((m) => {
      const l = live[m.id];
      if (!l || l.convId !== conv.id) return m;
      changed = true;
      return { ...m, content: l.content, reasoning: l.reasoning, toolRuns: l.toolRuns };
    });
    return changed ? { ...conv, messages } : conv;
    // conversations refreshes on every store notification (index is small).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeId, live]);

  const convoTokens = useMemo(() => historyTokens(active?.messages ?? []), [active]);

  const tails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(live)) out[id] = entry.tail;
    return out;
  }, [live]);

  const streaming = activeId !== null && streamingByConv[activeId] !== undefined;
  const streamingAny = Object.keys(streamingByConv).length > 0;

  // An empty assistant message with no stream behind it is a response that
  // never arrived (failed before, app reloaded since). It must never render
  // as a blank row: surface it as retryable, whatever the original cause —
  // retrying re-runs the request, so a stale cause would only mislead.
  const effectiveFailed: FailedState | null = useMemo(() => {
    if (!active) return null;
    const direct = active.messages.map((m) => failedById[m.id]).find((f) => f !== undefined);
    if (direct) return direct;
    if (streaming) return null;
    const last = active.messages.at(-1);
    // A thinking-only tail is not a failure: the no-answer note owns it.
    if (
      last &&
      last.role === "assistant" &&
      last.content === "" &&
      !last.stopped &&
      !last.reasoning
    ) {
      return { messageId: last.id, kind: "network" };
    }
    return null;
  }, [failedById, active, streaming]);

  // `announce` is for the attach flow, which is the only caller a human is
  // waiting inside of: it may own the status line. The panel's refresh passes
  // call `ensureCtx(false)` — while the size is unknown they re-run at store-
  // notification rate (the healing cost declared at `ensureContextSize`), and
  // announcing each one would strobe this line and could clear an attach's
  // own "Reading…" message mid-extraction.
  async function ensureCtx(announceCtx = true): Promise<number | null> {
    const endpoint = effectiveSettings.endpoint;
    const known = nctxCache.current.get(endpoint);
    if (known !== undefined) {
      setCtxInfo({ endpoint, nctx: known });
      return known;
    }
    if (announceCtx) setAttachStatus(t.checkingContext);
    const nctx = await ensureContextSize(nctxCache.current, endpoint, () =>
      fetchContextSize(serverBase(endpoint), 8000, effectiveSettings.token),
    );
    setCtxInfo({ endpoint, nctx });
    if (announceCtx) setAttachStatus(null);
    return nctx;
  }

  // Refresh the panel's context line when it opens over pinned files.
  useEffect(() => {
    if (!panelOpen || !activeId) return;
    if (store.getAttachments(activeId).every((a) => !a.active)) return;
    if (hasContextSize(ctxInfo, effectiveSettings.endpoint)) return;
    // Only a NUMBER settles this line: an endpoint currently holding an
    // unknown asks again on the next pass — that is how the panel heals
    // after the engine starts answering, with no settings save involved.
    // The cost (declared at `ensureContextSize`): one silent GET /props per
    // pass while the size stays unknown; once a number lands, this returns
    // above and the asking stops.
    void ensureCtx(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, activeId, effectiveSettings.endpoint, conversations]);

  async function attachFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setRefusal(null);
    let convId = activeId;
    if (!convId) {
      const fresh: Conversation = {
        id: uid(),
        title: list[0].name.slice(0, 46),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      // The conversation exists before the door answers, so the moment the gate
      // makes it active there is something to show. The door decides whether it
      // becomes active, and on a refusal it must not — but the conversation
      // stays, with the attachment on it below, so nothing the person chose is
      // lost and the warning says why.
      store.put(fresh);
      const result = await gate.create(fresh.id);
      if (result === null) {
        // A creation is already in flight; this one never reached the door.
        store.remove(fresh.id);
        return;
      }
      setSlotNotice(result.notice);
      convId = fresh.id;
    }
    const target = convId;
    setAttachStatus(list.length === 1 ? t.readingOne(list[0].name) : t.readingMany(list.length));
    try {
      const extracted: Attachment[] = [];
      for (const file of list) {
        extracted.push(await extractAttachment(file));
      }
      const nctx = await ensureCtx();
      const history = store.get(target)?.messages ?? [];
      const trial = buildPinnedContext(history, extracted, nctx);
      if (trial.status === "refused") {
        setRefusal({
          names: extracted.map((a) => a.name).join(", "),
          docTokens: trial.docTokens,
          historyTokens: trial.historyTokens,
          need: trial.need,
          have: trial.have,
        });
        setAttachStatus(null);
        announce(t.tooMuchAtOnce);
        return;
      }
      for (const attachment of extracted) store.putAttachment(target, attachment);
      setAttachStatus(null);
      setPanelOpen(true);
      announce(
        extracted.length === 1 ? t.attachedOne(extracted[0].name) : t.attachedMany(extracted.length),
      );
    } catch (error) {
      setAttachStatus(error instanceof AttachmentError ? refusalSentence(error) : filesSentence(error));
      announce(t.attachmentFailed);
    }
  }

  // The files panel's Attach: Rust reads the bytes, the page wraps them in a
  // File with the row's name, and everything downstream — extraction, token
  // accounting, the store — is the composer's clip path, shared not copied.
  async function attachFromDisk(path: string, name: string): Promise<void> {
    setRefusal(null);
    setAttachStatus(t.readingOne(name));
    try {
      const bytes = await filesRead(path);
      await attachFiles([new File([bytes], name)]);
    } catch (error) {
      setAttachStatus(
        error instanceof AttachmentError ? refusalSentence(error) : filesSentence(error),
      );
    }
  }

  // A files-command refusal carries a code; the sentence is the table's,
  // and a plain string (an unexpected helper) shows as it came.
  function filesSentence(error: unknown): string {
    return rustSentence(table.rust, error, tag);
  }

  // The extractor reports a code; the sentence is the table's.
  function refusalSentence(error: AttachmentError): string {
    const files = table.files;
    switch (error.failure) {
      case "unsupported":
        return error.refusal.app ? files.unsupportedLegacy(error.refusal.app) : files.unsupportedKind;
      case "too-big":
        return files.tooBig;
      case "unreadable":
        return files.unreadable;
      case "empty":
        return files.noText;
    }
  }

  // Creates the turn and starts the stream, configured or not — the bubble
  // belongs to the person, and an answer with nowhere to go fails under it
  // with the error and a way to Settings. Returns the user message's id.
  //
  // `opened` is the chat the gate has just taken from the door, and only the
  // gate can mint one: a chat that is already open never takes this path,
  // because it was offered when it was selected.
  function sendMessage(text: string, opened: ActiveChat | null = null): string | null {
    // The brand bites here. An `ActiveChat` is the door's answer for one chat,
    // so it is used for that chat or refused — never passed over in favour of
    // whatever this render happened to call active. The render's chat is
    // trusted only when it *is* the chat the door minted.
    if (opened !== null && !gate.isCurrent(opened)) return null;
    let conv = opened !== null && active?.id !== opened.id ? null : active;
    if (!conv) {
      conv = {
        id: opened ? opened.id : uid(),
        title: titleFor(text, t.newConversation),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }
    const assistantId = uid();
    const userId = uid();
    const updated: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFor(text, t.newConversation) : conv.title,
      updatedAt: Date.now(),
      messages: [
        ...conv.messages,
        { id: userId, role: "user", content: text, createdAt: Date.now() },
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
      ],
    };
    store.put(updated);
    // Writing from the brain's bar lands here too: the chat opens with the
    // text already in the thread.
    openSurface("chat");
    void turns.runAssistant(updated.id, assistantId, effectiveSettings);
    return userId;
  }

  // A stream in ANOTHER conversation never blocks this one; the composer
  // shows Stop (not Send) while its own conversation is generating.
  function send(text: string): boolean {
    // The freeze is the gate's `pending`, applied here as well as in the
    // composer — and reread from the gate, not taken from this render's
    // snapshot: the freeze must be the gate's word at the moment Enter lands.
    // A send into the outgoing chat during a switch is the race C4 closes,
    // whichever control produced it.
    if (gate.getSnapshot().pending) return false;
    if (active) return sendMessage(text) !== null;
    // The first message of a chat that does not exist yet waits for the door,
    // and the words stay in the box until it answers: a refusal has to leave
    // them where the person wrote them, not swallow them. `false` is "do not
    // clear the box" — this path clears it itself, on the one answer that opens
    // the chat.
    const id = uid();
    void (async () => {
      const result = await gate.create(id);
      // A creation already in flight: this Enter is ignored, not a second chat.
      if (result === null) return;
      setSlotNotice(result.notice);
      // The task can land after the person chose another chat, and a chat that
      // is no longer current must not be sent into.
      if (!result.opened || !gate.isCurrent(result.opened)) return;
      // Only if the box still holds what was sent: the wait is a round trip,
      // and the next message may already be in it.
      setDraft((current) => (current.trim() === text ? "" : current));
      sendMessage(text, result.opened);
    })();
    return false;
  }

  // Enter in the brain's bar: the chat opens with the text as the first
  // message, and the bar itself becomes that message (§3) — the move is a FLIP
  // in `app/handoff.ts`, measured before and after the state change. Being
  // unconfigured is a reason the ANSWER will fail, not a reason the bar should
  // not become the message, so there is no fallback here on that account; under
  // reduced motion the same state change happens plainly and nothing moves.
  function writeFromBrain(text: string): void {
    // The outgoing chat is frozen while a switch is in flight, and the brain's
    // bar is one more way into it — and the gate is reread, as in `send`, not
    // the render's snapshot. The words stay in the bar — this returns
    // before the surface changes — so the freeze costs nothing here.
    if (gate.getSnapshot().pending) return;
    const calm =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The chat this becomes does not exist yet, so the door is asked before the
    // bar is measured or moved: the flight aims at where the bar really stands,
    // and the first message must not reach the engine ahead of the slot.
    const fresh = active === null ? uid() : null;
    if (fresh !== null) {
      void (async () => {
        const result = await gate.create(fresh);
        if (result === null || !result.opened || !gate.isCurrent(result.opened)) return;
        // Committed before the measurement below: the slot sentence sits above
        // the bar the flight aims at.
        flushSync(() => setSlotNotice(result.notice));
        flyBarInto(text, result.opened, calm);
      })();
      return;
    }
    flyBarInto(text, null, calm);
  }

  /** The rest of `writeFromBrain`, once the door has taken the chat: measure the
      bar, start the room's change, commit the bubble, aim the flight at it. */
  function flyBarInto(text: string, opened: ActiveChat | null, calm: boolean): void {
    const bar = calm ? null : document.querySelector(".brain-bar");
    const before = bar ? bar.getBoundingClientRect() : null;
    // The whole screen changes, and the bar's flight is part of that change:
    // the room here leaves on a copy of itself while the next one arrives.
    if (!calm) leavingGhost(document.querySelector(".stage"));

    let openedId: string | null = null;
    // The commit has to be in the DOM before the bubble can be measured, which
    // is what flushSync is for: not the animation, the measurement.
    flushSync(() => {
      openedId = sendMessage(text, opened);
    });
    if (openedId === null) return;
    // The bubble is in the DOM by now — flushSync committed it — and it is
    // found by its message id, so no state has to be held for the move.
    // The flight is measured and started first: the room's own entrance shifts
    // it down a few pixels, and the mover has to aim at where the bubble will
    // really be, not at where it is passing through. Both start in the same
    // task, so they are one movement on screen.
    handoff(before, document.querySelector(`[data-message-id="${openedId}"]`));
    if (!calm) arrivingIn(document.querySelector(".stage > *"));
  }

  function stop(): void {
    // Only the visible conversation's stream: a sibling keeps generating.
    turns.stopFor(activeId ?? "");
  }

  function retry(messageId: string): void {
    if (!active) return;
    // The outgoing chat is frozen while a switch is in flight: a completion
    // here would not pass the door's gate — the same race, from the other side.
    // Reread from the gate, as in `send`.
    if (gate.getSnapshot().pending) return;
    if (streamingByConv[active.id] !== undefined) return;
    const latest = store.get(active.id);
    if (!latest) return;
    store.put({
      ...latest,
      messages: latest.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: "", stopped: false, reasoning: "", reasoningMs: undefined }
          : m,
      ),
    });
    void turns.runAssistant(active.id, messageId, effectiveSettings);
  }

  function removeConversation(id: string): void {
    turns.stopFor(id);
    store.remove(id);
    // The gate's own active chat, not the rendered one: an open of this chat can
    // be in flight, and the render still names the previous chat while it is.
    gate.clearIf(id);
    // A chat the door kept leaves two things behind — its file, and the state
    // in the slot when that slot holds it — and this is the one call that takes
    // them. `no-tier` says nothing here: a door without the tier kept no file,
    // so there is nothing of this chat left to remove.
    if (!door) return;
    void eraseChat(door.endpoint, door.token, id).then((answer) => {
      if (answer.kind === "refused") setSlotNotice({ failed: true, message: answer.message });
    });
  }

  function newConversation(): void {
    gate.clear();
    setDrawerOpen(false);
  }

  // The disk tier's one seam: the door is told which chat this device is
  // opening, and the chat becomes the active one only once the door has
  // answered. The order is the point, not a formality — the door serialises the
  // actions of one slot but not a completion against them, so a message that
  // reached the engine first would build the new chat's state and have an erase
  // or a restore thrown over it: the warmth this tier exists for, spent for
  // nothing. Cost, accepted and named: a switch waits for a save and a restore,
  // and the save writes the resident chat's whole state even when nothing has
  // changed since the last one. That save can be skipped later — the door knows
  // the token count it wrote and would only need the slot's current count,
  // which nothing reports yet.
  //
  // The ordering, the single flight and the late-resolver guard are the gate's
  // (`lib/slotGate.ts`), so a fake door can test them; this only reads the
  // answer and puts the door's own sentence on screen.
  function selectConversation(id: string): void {
    // The chat that is already active is not asked about again: the door would
    // no-op it, and nothing on screen changes either way. The question is asked
    // of the gate and not of the rendered active id, because during a switch
    // that id is the outgoing chat: swallowing a click on that basis is how the
    // first of two quick switches wins.
    if (gate.isSettled(id)) {
      openSurface("chat");
      setDrawerOpen(false);
      return;
    }
    void (async () => {
      // A chat the door refused to open does not become the active one: the
      // door has already put back what its slot held, and a UI that moved on
      // anyway would be showing a chat the slot does not hold while the next
      // switch saves that slot under this chat's name.
      const result = await gate.open(id);
      setSlotNotice(result.notice);
      if (!result.opened || !gate.isCurrent(result.opened)) return;
      openSurface("chat");
      setDrawerOpen(false);
    })();
  }

  return {
    // The slot's snapshot, the ONE subscription: the shell reads the
    // banner's notice from it, the page reads the send freeze.
    slot,
    pending: slot.pending,
    creating: slot.creating,
    // The shell reads these without rendering the chat: the topbar's title,
    // the stream class, the stage-level web-call dialog, the files toggle.
    active,
    streamingAny,
    gateShown: turns.gateShown,
    gateWaiting: turns.gateWaiting,
    answerGate: turns.answerGate,
    panelOpen,
    setPanelOpen,
    storageFull,
    dismissStorageFull: () => store.clearWriteError(),
    // The brain's bar becomes the chat's first message (the shell renders
    // BrainSurface, but the words are the chat's).
    writeFromBrain,
    // The slot banner's dismissal and the context cache a settings save
    // clears — both the shell's to call, the chat's to answer.
    dismissSlotNotice: () => gate.dismissNotice(),
    clearContextCache: () => {
      nctxCache.current.clear();
      setCtxInfo(null);
    },
    // The chat's own render.
    conversations,
    activeId,
    streamingIds: Object.keys(streamingByConv),
    streaming,
    effectiveFailed: effectiveFailed,
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
    thinkingSupported,
    thinking,
    saveThinking: (enabled: boolean) => {
      // Saved at once and read at send time: the next message uses
      // it, with no reload.
      saveThinking(effectiveSettings.model, enabled);
      setThinking(enabled);
    },
    draft,
    setDraft,
    send,
    stop,
    retry,
    selectConversation,
    newConversation,
    removeConversation,
    renameConversation: (id: string, title: string) => store.rename(id, title),
    removeAttachment: (attachmentId: string) => {
      if (activeId) store.removeAttachment(activeId, attachmentId);
    },
    reattachAttachment: (conversationId: string, attachmentId: string) => {
      const found = store.getAttachments(conversationId).find((a) => a.id === attachmentId);
      if (found) store.putAttachment(conversationId, { ...found, active: true });
    },
    attachments,
    ctxInfo,
    convoTokens,
    openSurface,
  };
}

export type Chat = ReturnType<typeof useChat>;
