// The chat: its store, its door gate, and every flow a message takes —
// sending into a fresh or an open chat, selecting and removing conversations,
// pinning documents, retrying, stopping. The shell renders what this returns
// (surfaces/ChatSurface.tsx) and keeps only what outlives the chat's own
// unmount: the draft survives it because THIS hook lives in the shell, not
// because the state lives in any particular file.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createStore, firstCharacters, titleFor, uid } from "../lib/store";
import { activateChat, eraseChat, fetchContextSize, serverBase } from "../lib/chat";
import { ensureContextSize, hasContextSize } from "../lib/contextSize";
import { createSlotGate } from "../lib/slotGate";
import type { ActiveChat, DoorAccess, SlotNotice } from "../lib/slotGate";
import { loadThinking, saveThinking, thinkingSupport } from "../lib/thinking";
import type { ChatSettings, Conversation, ConversationMeta } from "../lib/types";
import type { FailedState } from "../components/Thread";
import { createAttachGate, NEW_CHAT } from "../lib/attachGate";
import type { Attachment } from "../lib/attachments";
import {
  AttachmentError,
  buildPinnedContext,
  estTokens,
  extractAttachment,
  IMAGE_TOKENS,
  turnDocBlock,
  wireTokens,
} from "../lib/attachments";
import { isImageFile, prepareImage } from "../lib/images";
import type { PreparedImage } from "../lib/images";
import { isVideoFile, prepareVideo, VideoCanceled } from "../lib/video";
import { deleteConversationImages, deleteImage, putImage } from "../lib/imageStore";
import { ATTACH_IMAGE_CEILING, wireImageBytes } from "../lib/wireBudget";
import { filesRead } from "../lib/files";
import type { SurfaceKey } from "../app/surfaces";
import { arrivingIn, handoff, leavingGhost } from "../app/handoff";
import { useLanguage } from "../i18n/useLanguage";
import { rustSentence } from "../lib/rustText";
import { contentDecline } from "../lib/contentFilterCopy";
import { logUiEvent } from "../lib/uiLog";
import { useBrain, useBrainServer, useDoorStanding, withBrainDefaults } from "./useBrain";
import { useServerFacts } from "./useServerFacts";
import { useVisionOffer } from "./useVisionOffer";
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

/** A picture attached but not yet sent: the stored reference plus the object
    URL the chip shows, which dies the moment the chip does. */
interface PendingImage extends PreparedImage {
  kind: "image";
  url: string;
}

/** A video attached but not yet sent: the frames (stored, sendable), the
    compressed MP4 (stored when the shelf had room — `notKept` says when it
    did not), and the chip's own object URL when there is one to show. */
interface PendingVideo {
  kind: "video";
  id: string;
  width: number;
  height: number;
  durationMs: number;
  notKept: boolean;
  frames: PreparedImage[];
  blob: Blob | null;
  url: string | null;
  /** True while the compress road is still running: the chip shows its
      progress and its × cancels the work. */
  compressing: boolean;
  progress: number;
}

type PendingChip = PendingImage | PendingVideo;

/** What the chat needs from the room around it: the shell's navigation (a
    send lands the owner on the chat), the shell's status line, the shell's
    slot banner, and the settings the app's own surfaces write. */
interface ChatShell {
  openSurface: (next: SurfaceKey) => void;
  announce: (message: string) => void;
  setSlotNotice: (notice: SlotNotice | null) => void;
  settings: ChatSettings;
}

/** The stable code behind a slot notice. The gate's own words name their own
    case; a notice that arrived with the door's sentence logs the UI fact alone,
    because `slotRoute` already logged the door's own code for that refusal. */
function slotCode(notice: SlotNotice): string {
  switch (notice.own) {
    case "hold-waiting":
      return "chat.slot_hold_waiting";
    case "hold-expired":
      return "chat.slot_hold_expired";
    case "door-silent":
      return "chat.slot_door_silent";
    default:
      return notice.failed ? "chat.slot_refused" : "chat.slot_no_tier";
  }
}

export function useChat(shell: ChatShell) {
  const { openSurface, announce, setSlotNotice, settings } = shell;
  const { table, tag } = useLanguage();
  const t = table.shell;

  /** The slot sentence on screen, and its code on the log: the person reads the
      door's words (or the gate's), the report reads which failure it was. */
  function noteSlot(notice: SlotNotice | null): void {
    if (notice) logUiEvent(slotCode(notice));
    setSlotNotice(notice);
  }
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
  // The attach gate and the render bump that follows it: the gate is the
  // synchronous truth, keyed by conversation, that every send asks at Enter;
  // the bump only re-renders so `attachBusy` can be asked fresh of it.
  const attachGate = useState(createAttachGate)[0];
  const [, bumpAttach] = useState(0);
  const syncAttach = (): void => bumpAttach((n) => n + 1);
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
  // Pictures attached but not yet sent, per conversation. The bytes are in
  // IndexedDB the moment the chip exists; this map holds only the reference
  // and the chip's object URL, and follows the draft's own durability.
  const [pendingImages, setPendingImages] = useState<Record<string, PendingChip[]>>({});
  // A compression in flight can be canceled from its chip: the gate is the
  // word the chip's × writes and the video road reads between frames.
  const cancelGates = useRef(new Map<string, { canceled: boolean }>());

  useEffect(() => {
    // Whether the last write failure was already reported: the subscription
    // fires on every write, the line is once per failure episode.
    let storageFullSeen = false;
    return store.subscribe(() => {
      setConversations(store.list());
      // A code, not a sentence — the words are the table's below.
      const full = store.getWriteError() === "storage-full";
      if (full && !storageFullSeen) logUiEvent("chat.storage_full");
      storageFullSeen = full;
      setStorageFull(full);
    });
  }, []);

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
  // The same body says what the model can receive: vision gates every image
  // road below, and the read follows the model (`useServerFacts` re-asks when
  // it changes). The same answer fills the context cache above, so the send's
  // fit knows the window even in a chat that never attached anything.
  const { chatTemplate, modalities } = useServerFacts(
    effectiveSettings.endpoint,
    effectiveSettings.token,
    effectiveSettings.model,
    nctxCache,
  );
  const vision = modalities.vision;
  // The projector offer: what the brain has on the shelf, the ask, the
  // download and its progress, and the refusal that follows a failure. Its
  // own hook, because it is its own flow — the chat only wires it to the
  // composer and to the image road below.
  const visionOffer = useVisionOffer();
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

  const convoTokens = useMemo(
    () => wireTokens(active?.messages ?? [], vision),
    [active, vision],
  );

  const tails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(live)) out[id] = entry.tail;
    return out;
  }, [live]);

  const streaming = activeId !== null && streamingByConv[activeId] !== undefined;
  const streamingAny = Object.keys(streamingByConv).length > 0;

  // The thread's failures, one entry per message. A response that never
  // arrived (failed before, app reloaded since) is one more entry — an empty
  // assistant tail must never render as a blank row — and one turn's failure
  // never hides another's: each row shows its own sentence and its own retry.
  const failures: Record<string, FailedState> = useMemo(() => {
    const out: Record<string, FailedState> = {};
    if (!active) return out;
    for (const message of active.messages) {
      const live = failedById[message.id];
      if (live) out[message.id] = live;
      else if (message.role === "assistant" && message.failed) {
        out[message.id] = { messageId: message.id, kind: message.failed };
      }
    }
    const last = active.messages.at(-1);
    // A thinking-only tail is not a failure: the no-answer note owns it.
    if (
      !streaming &&
      last &&
      last.role === "assistant" &&
      last.content === "" &&
      !last.stopped &&
      !last.reasoning &&
      out[last.id] === undefined
    ) {
      out[last.id] = { messageId: last.id, kind: "network" };
    }
    return out;
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

  // Chips of one conversation leave (send, remove, delete): their object
  // URLs die with them. The bytes themselves are the caller's to place or
  // drop in IndexedDB.
  /** Releases the chips NAMED — the ones a send carried. Their object URLs
      die with them; bytes stay (the message references them now). */
  function releasePendingIds(convId: string, ids: string[]): void {
    if (ids.length === 0) return;
    setPendingImages((prev) => {
      const chips = prev[convId];
      if (!chips) return prev;
      for (const chip of chips) {
        if (ids.includes(chip.id) && chip.url) URL.revokeObjectURL(chip.url);
      }
      return { ...prev, [convId]: chips.filter((chip) => !ids.includes(chip.id)) };
    });
  }

  function releasePending(convId: string): void {
    setPendingImages((prev) => {
      const chips = prev[convId];
      if (!chips) return prev;
      for (const chip of chips) if (chip.url) URL.revokeObjectURL(chip.url);
      const next = { ...prev };
      delete next[convId];
      return next;
    });
  }

  async function attachFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setRefusal(null);
    // A picture or a video while this model is blind and a projector is
    // only an offer: the ask comes instead of the extractor's not-readable
    // sentence, which would state a limit the owner can lift in one press.
    if (visionOffer.offerBytes !== null && !vision && list.some((file) => isImageFile(file) || isVideoFile(file))) {
      visionOffer.ask();
      return;
    }
    setAttachStatus(list.length === 1 ? t.readingOne(list[0].name) : t.readingMany(list.length));
    // The gate closes only when this settles, whatever the settle is: a send
    // that lands mid-attach must wait, because the documents it should carry
    // are still nowhere to read. The hold is this conversation's alone — a
    // chat still to be created holds the new-chat key.
    const holdKey = activeId ?? NEW_CHAT;
    attachGate.hold(holdKey);
    syncAttach();
    const prepared: PendingImage[] = [];
    const preparedVideos: PendingVideo[] = [];
    const extracted: Attachment[] = [];
    // Set once the conversation exists; while it is empty no document has
    // landed, so the catch below has nothing to walk back.
    let target = "";
    let extraHold: string | null = null;
    try {
      let convId = activeId;
      if (!convId) {
        const fresh: Conversation = {
          id: uid(),
          title: firstCharacters(list[0].name, 46),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        // The conversation exists before the door answers, so the moment the
        // gate makes it active there is something to show. The door decides
        // whether it becomes active, and on a refusal it must not — the attach
        // below refuses visibly rather than park documents on a chat no panel
        // shows and no send carries.
        store.put(fresh);
        const result = await gate.create(fresh.id);
        if (result === null) {
          // A creation is already in flight and this one never reached the
          // door: refusing visibly beats a file that silently never lands.
          store.remove(fresh.id);
          setAttachStatus(t.attachmentFailed);
          logUiEvent("chat.attach_create_busy");
          announce(t.attachmentFailed);
          return;
        }
        noteSlot(result.notice);
        if (!result.opened) {
          // The door refused the chat this attach was making: the slot notice
          // says why, and the attachment says what that leaves — nothing
          // stored, nothing silent.
          store.remove(fresh.id);
          setAttachStatus(t.attachmentFailed);
          logUiEvent("chat.attach_no_chat");
          return;
        }
        convId = fresh.id;
        // The chat exists and is on screen now: a send from it would read the
        // same not-yet-stored documents, so it is held under its own key too.
        attachGate.hold(fresh.id);
        extraHold = fresh.id;
        syncAttach();
      }
      target = convId;
      // Pictures and videos take their roads only under a seeing model: VISION
      // is the gate for both because a video reaches the model as FRAMES —
      // images — and a `video` modality would matter only to an engine taking
      // video parts, which this app never sends. Blind, they are files like
      // any other, and the extractor gives the honest not-readable refusal
      // rather than silently eating pixels.
      const imageFiles = vision ? list.filter(isImageFile) : [];
      const videoFiles = vision ? list.filter((file) => !imageFiles.includes(file) && isVideoFile(file)) : [];
      const docFiles = list.filter(
        (file) => !imageFiles.includes(file) && !videoFiles.includes(file),
      );
      for (const file of docFiles) {
        extracted.push(await extractAttachment(file));
      }
      // The documents land while they are fresh: the context fetch below may
      // spend its whole ceiling on a sleeping engine, and a send this attach
      // held waits on the gate, which opens only after these rows exist. A fit
      // refused below walks them back — nothing rides that the fit refused.
      for (const attachment of extracted) store.putAttachment(target, attachment);
      for (const file of imageFiles) {
        const image = await prepareImage(file);
        prepared.push({ ...image, kind: "image", url: URL.createObjectURL(image.blob) });
      }
      // The chip appears the moment the work starts, not when it ends: its
      // × is the cancel the compress road reads between frames — a chip
      // that only exists afterwards can never be canceled.
      const patchChip = (id: string, patch: Partial<PendingVideo>): void => {
        setPendingImages((prev) => ({
          ...prev,
          [target]: (prev[target] ?? []).map((chip) =>
            chip.kind === "video" && chip.id === id ? { ...chip, ...patch } : chip,
          ),
        }));
      };
      const dropChip = (id: string): void => {
        setPendingImages((prev) => ({
          ...prev,
          [target]: (prev[target] ?? []).filter((chip) => chip.id !== id),
        }));
      };
      const videoChipIds = new Set<string>();
      for (const file of videoFiles) {
        const gate = { canceled: false };
        const id = uid();
        cancelGates.current.set(id, gate);
        videoChipIds.add(id);
        setPendingImages((prev) => ({
          ...prev,
          [target]: [
            ...(prev[target] ?? []),
            {
              kind: "video",
              id,
              width: 0,
              height: 0,
              durationMs: 0,
              notKept: false,
              frames: [],
              blob: null,
              url: null,
              compressing: true,
              progress: 0,
            },
          ],
        }));
        try {
          const video = await prepareVideo(
            file,
            (fraction) => patchChip(id, { progress: fraction }),
            gate,
          );
          if (gate.canceled) {
            dropChip(id);
            continue;
          }
          patchChip(id, {
            width: video.width,
            height: video.height,
            durationMs: video.durationMs,
            frames: video.frames,
            blob: video.blob,
            compressing: false,
            progress: 1,
          });
          preparedVideos.push({
            kind: "video",
            id,
            width: video.width,
            height: video.height,
            durationMs: video.durationMs,
            notKept: false,
            frames: video.frames,
            blob: video.blob,
            url: null,
            compressing: false,
            progress: 1,
          });
        } catch (error) {
          dropChip(id);
          // The chip's × is the owner's own word: it leaves quietly.
          if (error instanceof VideoCanceled || gate.canceled) continue;
          throw error;
        } finally {
          cancelGates.current.delete(id);
        }
      }
      const nctx = await ensureCtx();
      const history = store.get(target)?.messages ?? [];
      // A video weighs as its frames — four stills of IMAGE_TOKENS each —
      // plus whatever pictures sit beside it.
      const heldTokens = (chip: PendingChip): number =>
        chip.kind === "image" ? IMAGE_TOKENS : chip.frames.length * IMAGE_TOKENS;
      const pendingTokens =
        IMAGE_TOKENS * prepared.length +
        preparedVideos.reduce((sum, chip) => sum + chip.frames.length * IMAGE_TOKENS, 0) +        (pendingImages[target] ?? []).reduce((sum, chip) => sum + heldTokens(chip), 0);
      // The trial weighs what the next send will actually bind: every active
      // unpinned document — what was already staged and this new batch
      // together — measured as the block they render into, so the attach's
      // fit and the send's fit agree on the same number.
      const riding = store.getAttachments(target).filter((a) => a.active && !(a.pinned ?? true));
      const trial = buildPinnedContext(
        history,
        store.getAttachments(target),
        nctx,
        { vision, url: () => null },
        pendingTokens,
        estTokens(turnDocBlock([...riding, ...extracted])),
      );
      if (trial.status === "refused") {
        // The documents landed early; a refused fit walks them back — detached,
        // not erased, so the read work survives for one re-attach once room is
        // made. The banner names the batch as the picker saw it; a picture or
        // a video keeps the name of the file it came from, since none is
        // stored.
        for (const attachment of extracted) store.removeAttachment(target, attachment.id);
        const names = [
          ...extracted.map((a) => a.name),
          ...imageFiles.map((f) => f.name),
          ...videoFiles.map((f) => f.name),
        ];
        setRefusal({
          names: names.length === 1 ? (names[0] ?? "") : names.join(", "),
          docTokens: trial.docTokens,
          historyTokens: trial.historyTokens,
          need: trial.need,
          have: trial.have,
        });
        setAttachStatus(null);
        logUiEvent("chat.attach_refused");
        announce(t.tooMuchAtOnce);
        for (const chip of prepared) URL.revokeObjectURL(chip.url);
        for (const id of videoChipIds) dropChip(id);
        return;
      }
      // The door's own ceiling, asked while the chips are still only these
      // bytes: the pictures this conversation would send together (the chips
      // already sat plus these) must fit the wire as one body, or the send
      // that carries them would leave refused — better refused here, where
      // nothing has landed in storage yet.
      const names = [
        ...extracted.map((a) => a.name),
        ...imageFiles.map((f) => f.name),
        ...videoFiles.map((f) => f.name),
      ];
      // The wire carries the frames, never the video itself: the bytes that
      // count are every still this conversation would send.
      const heldBytes = (chip: PendingChip): number =>
        chip.kind === "image"
          ? wireImageBytes(chip.blob.size)
          : chip.frames.reduce((sum, frame) => sum + wireImageBytes(frame.blob.size), 0);
      const pendingWireBytes =
        (pendingImages[target] ?? []).reduce((sum, chip) => sum + heldBytes(chip), 0) +
        prepared.reduce((sum, chip) => sum + wireImageBytes(chip.blob.size), 0) +
        preparedVideos.reduce((sum, chip) => sum + heldBytes(chip), 0);
      if (pendingWireBytes > ATTACH_IMAGE_CEILING) {
        // This refusal is the pictures' body, but nothing lands partial: the
        // documents landed early and walk back with the batch.
        for (const attachment of extracted) store.removeAttachment(target, attachment.id);
        setRefusal({
          names: names.length === 1 ? (names[0] ?? "") : names.join(", "),
          docTokens: 0,
          historyTokens: 0,
          need: pendingWireBytes,
          have: ATTACH_IMAGE_CEILING,
        });
        setAttachStatus(null);
        logUiEvent("chat.attach_wire_refused");
        announce(t.tooMuchAtOnce);
        for (const chip of prepared) URL.revokeObjectURL(chip.url);
        for (const id of videoChipIds) dropChip(id);
        return;
      }
      // Bytes first, chip second: a refusal from IndexedDB is an attach
      // failure, not a chip that shows a picture nothing can send. A video's
      // own bytes are the one thing a full shelf may refuse: the frames are
      // the message to the model, so they must land — the video is kept for
      // replay when it can be, and the chip says so when it cannot.
      for (const chip of prepared) await putImage(target, chip.id, chip.mime, chip.blob);
      for (const video of preparedVideos) {
        for (const frame of video.frames) {
          await putImage(target, frame.id, frame.mime, frame.blob);
        }
        if (video.blob !== null) {
          try {
            await putImage(target, video.id, "video/mp4", video.blob);
          } catch {
            video.notKept = true;
          }
        } else {
          video.notKept = true;
        }
        // The chip's face is the glyph, so no object URL is minted here —
        // the bubble reads the bytes back when it renders.
        patchChip(video.id, { notKept: video.notKept });
      }
      if (prepared.length > 0) {
        setPendingImages((prev) => ({
          ...prev,
          [target]: [...(prev[target] ?? []), ...prepared],
        }));
      }
      setAttachStatus(null);
      if (extracted.length > 0) setPanelOpen(true);
      const chipCount = prepared.length + preparedVideos.length + extracted.length;
      announce(chipCount === 1 ? t.attachedOne(list[0].name) : t.attachedMany(chipCount));
    } catch (error) {
      // A failed attach leaves nothing half-landed: whatever documents were
      // stored early walk back with the batch that failed.
      for (const attachment of extracted) store.removeAttachment(target, attachment.id);
      for (const chip of prepared) URL.revokeObjectURL(chip.url);
      setAttachStatus(error instanceof AttachmentError ? refusalSentence(error) : filesSentence(error));
      logUiEvent(
        error instanceof AttachmentError
          ? `chat.attach_failed.${error.reason}`
          : "chat.attach_failed.unknown",
      );
      announce(t.attachmentFailed);
    } finally {
      attachGate.release(holdKey);
      if (extraHold !== null) attachGate.release(extraHold);
      syncAttach();
    }
  }

  // The files panel's Attach: Rust reads the bytes, the page wraps them in a
  // File with the row's name, and everything downstream — extraction, token
  // accounting, the store — is the composer's clip path, shared not copied.
  async function attachFromDisk(path: string, name: string): Promise<void> {
    setRefusal(null);
    setAttachStatus(t.readingOne(name));
    // The hold opens here, not inside attachFiles: reading the bytes is work
    // a send must wait for too. One attach is one hold on one key —
    // attachFiles holds the same key beside it, and a set releases once.
    const holdKey = activeId ?? NEW_CHAT;
    attachGate.hold(holdKey);
    syncAttach();
    try {
      const bytes = await filesRead(path);
      await attachFiles([new File([bytes], name)]);
    } catch (error) {
      setAttachStatus(
        error instanceof AttachmentError ? refusalSentence(error) : filesSentence(error),
      );
      logUiEvent("chat.attach_failed.read");
    } finally {
      attachGate.release(holdKey);
      syncAttach();
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
        return files.emptyFile;
      case "no-text":
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
    // The one funnel every send passes — composer, brain bar, retry — and
    // with it the attach gate: a document still reading is in no wire yet,
    // and the chat still to be created is held by the attach making one.
    return attachGate.run(opened !== null ? opened.id : (active?.id ?? null), () =>
      sendNow(text, opened),
    );
  }

  function sendNow(text: string, opened: ActiveChat | null): string | null {
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
    // Whatever chips this conversation holds ride the new user turn as
    // references; the pixels stay in IndexedDB under their own ids.
    const chips = (pendingImages[conv.id] ?? []).filter(
      (chip) => chip.kind === "image" || !chip.compressing,
    );
    const images = chips.flatMap((chip) =>
      chip.kind === "image" ? [{ id: chip.id, width: chip.width, height: chip.height, mime: chip.mime }] : [],
    );
    const videos = chips.flatMap((chip) =>
      chip.kind === "video"
        ? [
            {
              id: chip.id,
              width: chip.width,
              height: chip.height,
              durationMs: chip.durationMs,
              ...(chip.notKept ? { notKept: true as const } : {}),
              frames: chip.frames.map(({ id, width, height, mime }) => ({ id, width, height, mime })),
            },
          ]
        : [],
    );
    // The documents riding THIS message alone: bound to it by id, and their
    // block's weight taken once, at binding, so the fit counts them as
    // history without re-reading the attachments on every turn.
    const bindable = store.getAttachments(conv.id).filter((a) => a.active && !(a.pinned ?? true));
    const boundBlock = turnDocBlock(bindable);
    // Blocked words never reach the model: the decline is the answer instead.
    const decline = contentDecline(text, table.contentFilter);
    const updated: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFor(text, t.newConversation) : conv.title,
      updatedAt: Date.now(),
      messages: [
        ...conv.messages,
        {
          id: userId,
          role: "user",
          content: text,
          createdAt: Date.now(),
          ...(images.length > 0 ? { images } : {}),
          ...(videos.length > 0 ? { videos } : {}),
          ...(bindable.length > 0
            ? { docs: bindable.map((a) => a.id), docTokens: estTokens(boundBlock) }
            : {}),
        },
        { id: assistantId, role: "assistant", content: decline ?? "", createdAt: Date.now() },
      ],
    };
    store.put(updated);
    // The bound documents leave the composer's set: the next message starts
    // clean, and the sent ones sit under "Previously attached" until they are
    // re-attached. The binding above already holds their text to this turn.
    for (const doc of bindable) store.putAttachment(conv.id, { ...doc, active: false });
    // Everything that rode is released — a video-only send as surely as a
    // picture one: a chip left pending could be sent again, and its × would
    // delete bytes this SENT message now references. A chip still
    // compressing did not ride and stays for the next send.
    if (images.length > 0 || videos.length > 0) {
      releasePendingIds(
        conv.id,
        chips.map((chip) => chip.id),
      );
    }
    // Writing from the brain's bar lands here too: the chat opens with the
    // text already in the thread.
    openSurface("chat");
    if (decline === null) void turns.runAssistant(updated.id, assistantId, effectiveSettings, vision);
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
      noteSlot(result.notice);
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
        flushSync(() => noteSlot(result.notice));
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
    attachGate.run(active.id, () => {
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
      void turns.runAssistant(active.id, messageId, effectiveSettings, vision);
    });
  }

  // A mini app widget's next state — ticked checklist items, a picked quiz
  // answer, edited calculator fields — into the run that drew it. It goes to
  // the live buffer FIRST when the turn is still streaming: the buffer is
  // what the next persist writes back, so an edit that only reached the
  // store would be reverted mid-stream. Then the store's own copy: its
  // notification is what renders the tick, and the disk copy is what a
  // reload reads it back from.
  function saveMiniappState(messageId: string, runId: string, state: Record<string, unknown>): void {
    if (!activeId) return;
    turns.patchMiniappState(messageId, runId, state);
    const latest = store.get(activeId);
    if (!latest) return;
    store.put({
      ...latest,
      messages: latest.messages.map((m) =>
        m.id !== messageId
          ? m
          : {
              ...m,
              toolRuns: (m.toolRuns ?? []).map((run) =>
                run.id !== runId || !run.miniapp
                  ? run
                  : { ...run, miniapp: { ...run.miniapp, state } },
              ),
            },
      ),
    });
  }

  function removeConversation(id: string): void {
    turns.stopFor(id);
    store.remove(id);
    // The conversation's pictures go with it: nothing names their bytes after
    // this, so leaving them in IndexedDB would be weight nobody can reach.
    void deleteConversationImages(id);
    releasePending(id);
    // The gate's own active chat, not the rendered one: an open of this chat can
    // be in flight, and the render still names the previous chat while it is.
    gate.clearIf(id);
    // A chat the door kept leaves two things behind — its file, and the state
    // in the slot when that slot holds it — and this is the one call that takes
    // them. `no-tier` says nothing here: a door without the tier kept no file,
    // so there is nothing of this chat left to remove.
    if (!door) return;
    void eraseChat(door.endpoint, door.token, id).then((answer) => {
      if (answer.kind === "refused") noteSlot({ failed: true, message: answer.message });
    });
  }

  function newConversation(): void {
    gate.clear();
    setDrawerOpen(false);
  }

  // A chip removed before its send: a compression still running is canceled
  // through its gate, and the bytes a stored chip named — its own, and a
  // video's frames' — leave IndexedDB too.
  function removePendingImage(imageId: string): void {
    if (!activeId) return;
    const target = activeId;
    const gate = cancelGates.current.get(imageId);
    if (gate) gate.canceled = true;
    let stored: string[] = [imageId];
    setPendingImages((prev) => {
      const chips = prev[target];
      if (!chips) return prev;
      const chip = chips.find((c) => c.id === imageId);
      if (chip === undefined) return prev;
      if (chip.url) URL.revokeObjectURL(chip.url);
      if (chip.kind === "video") {
        stored = [imageId, ...chip.frames.map((frame) => frame.id)];
      }
      return { ...prev, [target]: chips.filter((c) => c.id !== imageId) };
    });
    for (const id of stored) void deleteImage(id);
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
      noteSlot(result.notice);
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
    failures,
    tails,
    drawerOpen,
    setDrawerOpen,
    dragging,
    setDragging,
    attachFiles,
    attachFromDisk,
    attachStatus,
    // The attach gate asked for the conversation on screen: the composer's
    // sendBlocked derives from it. A hold on another conversation never
    // shows here.
    attachBusy: attachGate.busy(activeId ?? null),
    refusal,
    setRefusal,
    setup,
    credentialMessage,
    effectiveSettings,
    thinkingSupported,
    thinking,
    // The served model's own word about itself: every image road below it.
    vision,
    // The projector the brain has on the shelf — the composer's one quiet
    // affordance — and what the offer is doing on screen right now.
    visionOfferBytes: visionOffer.offerBytes,
    visionFlow: visionOffer.flow,
    visionStep: visionOffer.step,
    askVision: visionOffer.ask,
    dismissVision: visionOffer.dismiss,
    enableVision: visionOffer.enable,
    // This conversation's attached-but-unsent pictures, chip-ready.
    pendingImages: activeId ? (pendingImages[activeId] ?? []) : [],
    removeImage: removePendingImage,
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
    saveMiniappState,
    selectConversation,
    newConversation,
    removeConversation,
    renameConversation: (id: string, title: string) => store.rename(id, title),
    removeAttachment: (attachmentId: string) => {
      if (activeId) store.removeAttachment(activeId, attachmentId);
    },
    // The owner's own pin: a pinned document rides the system message on
    // every turn; an unpinned one rides only the message it is sent with.
    setAttachmentPinned: (attachmentId: string, pinned: boolean) => {
      if (!activeId) return;
      const found = store.getAttachments(activeId).find((a) => a.id === attachmentId);
      if (found) store.putAttachment(activeId, { ...found, pinned });
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
