import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createStore, titleFor, uid } from "./lib/store";
import { appendTail } from "./lib/tail";
import { isConfigured, loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatRequestError, activateChat, eraseChat, fetchContextSize, serverBase } from "./lib/chat";
import { ensureContextSize, hasContextSize } from "./lib/contextSize";
import { createSlotGate } from "./lib/slotGate";
import type { ActiveChat, DoorAccess } from "./lib/slotGate";
import { streamChatCompletion } from "./lib/toolLoop";
import type { ChatErrorKind } from "./lib/chat";
import { loadSampling, samplingWire } from "./lib/sampling";
import { loadThinking, saveThinking, thinkingSupport } from "./lib/thinking";
import type { ChatSettings, Conversation, ConversationMeta, ToolRun } from "./lib/types";
import type { Attachment } from "./lib/attachments";
import { AttachmentError, CONTEXT_RESERVE_TOKENS, buildPinnedContext, extractAttachment, historyTokens } from "./lib/attachments";
import { filesRead } from "./lib/files";
import type { SurfaceKey } from "./app/surfaces";
import { SURFACES } from "./app/surfaces";
import { arrivingIn, handoff, leavingGhost } from "./app/handoff";
import { CrescentNav } from "./components/CrescentNav";
import type { CrescentEntry } from "./components/CrescentNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Composer } from "./components/Composer";
import { Thread } from "./components/Thread";
import type { FailedState } from "./components/Thread";
import { Sidebar } from "./components/Sidebar";
import { Panel } from "./components/Panel";
import { SettingsForm } from "./components/SettingsForm";
import { BrainSurface } from "./surfaces/BrainSurface";
import { useBrainServer, useDoorStanding, withBrainDefaults } from "./surfaces/useBrain";
import { useServerFacts } from "./surfaces/useServerFacts";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { ServerSurface } from "./surfaces/ServerSurface";
import { DevicesSurface } from "./surfaces/DevicesSurface";
import { AdvancedSurface } from "./surfaces/AdvancedSurface";
import { EmptyState } from "./components/EmptyState";
import { executeToolCall, offeredTools } from "./lib/tools/registry";
import type { GateCheck } from "./lib/tools/registry";
import { WebGateDialog } from "./components/WebGateDialog";
import "./App.css";

const store = createStore();
// One gate for the window, beside the one store: it holds which chat is active,
// so it must outlive every render. A `useMemo` would let React discard it.
const gate = createSlotGate();

// How far the settings path may grow before the oldest step falls off. The
// surfaces' own hops are shallow; the bound is for the general case.
const PATH_LIMIT = 8;

interface Refusal {
  names: string;
  docTokens: number;
  historyTokens: number;
  need: number;
  have: number;
}

/** One held web call and the one function that ends its wait. The id is the
    ask's identity on screen: an answer carries it back, and settles only the
    ask it names — never whatever happens to be at the queue's head when the
    click lands. */
interface GateAsk {
  id: string;
  check: GateCheck;
  settle: (allow: boolean) => void;
}

function surfaceLabel(surface: SurfaceKey): string {
  if (surface === "brain") return "Home";
  return SURFACES.find((s) => s.key === surface)?.label ?? "Chat";
}

export function App() {
  // The brain is the home: the app opens on it, and the chat is reached by
  // writing in its bar — never by selecting a tab (THE-BRAIN-IS-THE-HOME.md).
  const [surface, setSurface] = useState<SurfaceKey>("brain");
  // The walk of settings surfaces taken to arrive at this one — the brain
  // is the path's root — so back can mean one step, not the whole way home.
  // The chat is not part of the path: leaving it is the crescent's job.
  const [path, setPath] = useState<SurfaceKey[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => store.list());
  const [writeError, setWriteError] = useState<string | null>(null);
  // What the door answered about a slot, when the answer is not a plain
  // success. `failed` is the difference between a warning and a refusal: a door
  // built without the disk tier (501) leaves the chat open and only says so,
  // while a refusal means the chat was NOT opened and the sentence it came with
  // must be read as the door wrote it — never softened, and never turned into
  // "the slot is empty", which the door reserves for the one case it knows
  // that about.
  const [slotNotice, setSlotNotice] = useState<{ failed: boolean; message: string } | null>(null);
  // The disk tier's one road to an active chat: the gate owns which chat is
  // active, and it changes only after the door has answered.
  // `useSyncExternalStore` is what removes the setter — there is no state here
  // for another path to bypass the door with. See `lib/slotGate.ts` for the
  // four races this closes.
  const slot = useSyncExternalStore(gate.subscribe, gate.getSnapshot);
  const activeId = slot.active?.id ?? null;
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  // One entry per generating conversation (conversation id -> assistant id).
  // Streams are independent: answering in A never blocks sending in B.
  const [streamingByConv, setStreamingByConv] = useState<Record<string, string>>({});
  const [failedById, setFailedById] = useState<Record<string, FailedState>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const [panelOpen, setPanelOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // The web-call gate: while documents are pinned, every outgoing web call is
  // held here until the owner sends it or refuses it. Streams in different
  // conversations run at once, so asks can too: they queue in arrival order
  // and the dialog shows the head alone — one clean question at a time rather
  // than a batch that invites a careless yes, with a line saying more are
  // waiting and each taking the screen the moment the one before it is
  // answered or stopped. Every ask settles exactly once, by its own dialog
  // answer or its own turn's Stop — never by another conversation's — so no
  // turn is left waiting on a promise nobody holds. And an answer names the
  // ask it was shown: the queue mutates the moment an ask settles, while the
  // dialog re-renders on React's schedule, so a click on a dialog whose ask
  // is already gone must do nothing rather than approve whatever took its
  // place — for this feature, "the owner approved something they were not
  // shown" is the worst failure available, and identity removes the question.
  const [gateShown, setGateShown] = useState<GateAsk | null>(null);
  const [gateWaiting, setGateWaiting] = useState(0);
  const gateAsks = useRef<GateAsk[]>([]);
  const [ctxInfo, setCtxInfo] = useState<{ endpoint: string; nctx: number | null } | null>(null);
  // Numbers only, and that IS the healing rule: an unknown answer is never
  // stored (the choice and its cost are declared at `ensureContextSize` in
  // lib/contextSize.ts), so a `null` cannot be memoized here until the user
  // happens to save settings — which was the defect. Clearing on save below
  // stays correct (the endpoint or token may have changed); it is simply no
  // longer the only road out.
  const nctxCache = useRef(new Map<string, number>());
  // In-flight stream buffers, keyed by assistant message id. Text lives here
  // while streaming and renders from here; the disk is written on a throttle
  // plus once at the end — never per token. The stored copy always trails
  // the buffer, so the buffer is authoritative until the run finishes.
  const bufs = useRef(
    new Map<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[]; timer: ReturnType<typeof setTimeout> | undefined }>(),
  );
  const [live, setLiveState] = useState<Record<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[] }>>({});
  const [liveMessage, setLiveMessage] = useState("");
  // The message the brain's writing bar became, for the one open move.
  // The composer's unsent text. Going home unmounts the chat, and the
  // draft must survive that round trip, so it lives here.
  const [draft, setDraft] = useState("");

  useEffect(
    () =>
      store.subscribe(() => {
        setConversations(store.list());
        setWriteError(store.getWriteError());
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Leaving with a turn in flight must not leave callbacks writing into a dead
  // tree, or a throttle timer firing after the page is gone. Rust is told to
  // stop separately, by the abort hooks the tool calls installed.
  useEffect(
    () => () => {
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
      bufs.current.forEach((buffer) => {
        if (buffer.timer !== undefined) clearTimeout(buffer.timer);
      });
      bufs.current.clear();
    },
    [],
  );

  // No explicit choice yet: follow the operating system while it changes.
  useEffect(() => {
    if (themeChoiceMade()) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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

  const tails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(live)) out[id] = entry.tail;
    return out;
  }, [live]);

  const streaming = activeId !== null && streamingByConv[activeId] !== undefined;
  const streamingAny = Object.keys(streamingByConv).length > 0;
  // The owner's typed settings win; the brain's own server fills the
  // blanks, so the chat never calls itself unconfigured while the machine
  // is serving.
  const brainServer = useBrainServer();
  const effectiveSettings = useMemo(
    () => withBrainDefaults(settings, brainServer),
    [settings, brainServer],
  );
  const configured = isConfigured(effectiveSettings);
  // The disk tier's door, when this window is talking to one: `withBrainDefaults`
  // puts this computer's own door in front of the owner's saved server while the
  // brain runs, so a running brain is the fact that makes the endpoint the door
  // and the token this device's credential. With no door there is no tier to
  // ask: `/kalsa/chat/activate` on somebody else's server is not a request that
  // server ever agreed to read.
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
  const convoTokens = useMemo(() => historyTokens(active?.messages ?? []), [active]);

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
  async function ensureCtx(announce = true): Promise<number | null> {
    const endpoint = effectiveSettings.endpoint;
    const known = nctxCache.current.get(endpoint);
    if (known !== undefined) {
      setCtxInfo({ endpoint, nctx: known });
      return known;
    }
    if (announce) setAttachStatus("Checking context size…");
    const nctx = await ensureContextSize(nctxCache.current, endpoint, () =>
      fetchContextSize(serverBase(endpoint), 8000, effectiveSettings.token),
    );
    setCtxInfo({ endpoint, nctx });
    if (announce) setAttachStatus(null);
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
    setAttachStatus(
      list.length === 1 ? `Reading ${list[0].name}…` : `Reading ${list.length} files…`,
    );
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
        setLiveMessage("Attachment refused: it does not fit the context.");
        return;
      }
      for (const attachment of extracted) store.putAttachment(target, attachment);
      setAttachStatus(null);
      setPanelOpen(true);
      setLiveMessage(
        extracted.length === 1
          ? `${extracted[0].name} attached.`
          : `${extracted.length} files attached.`,
      );
    } catch (error) {
      if (error instanceof AttachmentError) {
        setAttachStatus(error.message);
      } else {
        setAttachStatus("That file could not be read.");
      }
      setLiveMessage("Attachment failed.");
    }
  }

  // The files panel's Attach: Rust reads the bytes, the page wraps them in a
  // File with the row's name, and everything downstream — extraction, token
  // accounting, the store — is the composer's clip path, shared not copied.
  async function attachFromDisk(path: string, name: string): Promise<void> {
    setRefusal(null);
    setAttachStatus(`Reading ${name}…`);
    try {
      const bytes = await filesRead(path);
      await attachFiles([new File([bytes], name)]);
    } catch (error) {
      setAttachStatus(
        error instanceof AttachmentError
          ? error.message
          : `${name} could not be read from this computer.`,
      );
    }
  }

  // Hold one web call for the owner. The ask joins the queue's tail; whatever
  // is at the head is what the dialog shows. Stop ends that conversation's
  // own wait as a refusal — the turn is gone, so the call must not leave
  // after it — and advances the queue to the next ask, if any.
  function askOwner(check: GateCheck, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let ask: GateAsk;
      const settle = (allow: boolean) => {
        signal.removeEventListener("abort", onAbort);
        const at = gateAsks.current.indexOf(ask);
        if (at !== -1) gateAsks.current.splice(at, 1);
        setGateShown(gateAsks.current[0] ?? null);
        setGateWaiting(Math.max(0, gateAsks.current.length - 1));
        resolve(allow);
      };
      const onAbort = () => settle(false);
      ask = { id: uid(), check, settle };
      gateAsks.current.push(ask);
      setGateShown(gateAsks.current[0] ?? null);
      setGateWaiting(Math.max(0, gateAsks.current.length - 1));
      setLiveMessage("A web call is waiting for your say-so.");
      if (signal.aborted) {
        settle(false);
        return;
      }
      signal.addEventListener("abort", onAbort);
    });
  }

  // Answers the ask it names — the one the dialog was showing. If that ask is
  // already gone, settled by another path between render and click, the
  // answer finds nothing and does nothing; falling through to the head would
  // approve a call the owner may never have been shown.
  function answerGate(id: string, allow: boolean): void {
    gateAsks.current.find((ask) => ask.id === id)?.settle(allow);
  }

  const runAssistant = useCallback(
    async (conversationId: string, assistantId: string, currentSettings: ChatSettings) => {
      const conv = store.get(conversationId);
      if (!conv) return;
      const turns = conv.messages
        .filter((m) => m.id !== assistantId && !(m.role === "assistant" && m.content === ""))
        .filter((m) => m.content.length > 0 || m.role === "user");
      const docs = store.getAttachments(conversationId).filter((a) => a.active);
      // Send-time never fetches: the cached size (or unknown) decides, so a
      // request never waits on /props. Unknown means unpruned, never refused.
      const known = nctxCache.current.get(currentSettings.endpoint) ?? null;
      const ctx = buildPinnedContext(turns, docs, known);
      if (ctx.status === "refused") {
        // History outgrew the context after attaching: keep the empty
        // placeholder so the error has a place to live, and say the numbers.
        setFailedById((prev) => ({
          ...prev,
          [assistantId]: {
            messageId: assistantId,
            kind: "oversize",
            detail: `≈${ctx.docTokens.toLocaleString()} file + ≈${ctx.historyTokens.toLocaleString()} history + ≈${CONTEXT_RESERVE_TOKENS.toLocaleString()} kept free for the answer = ≈${ctx.need.toLocaleString()} of ≈${ctx.have.toLocaleString()} context tokens.`,
          },
        }));
        setLiveMessage("The message no longer fits the context.");
        return;
      }
      const history = ctx.wire;
      const controller = new AbortController();
      controllers.current.set(assistantId, controller);
      setStreamingByConv((prev) => ({ ...prev, [conversationId]: assistantId }));
      setFailedById((prev) => {
        if (!(assistantId in prev)) return prev;
        const next = { ...prev };
        delete next[assistantId];
        return next;
      });
      setLiveMessage("Responding. Waiting for the first word.");
      let firstToken = true;
      let thoughtStartedAt: number | null = null;
      let answerStartedAt: number | null = null;

      function persistLive(extra?: { stopped?: boolean; reasoningMs?: number }): void {
        const b = bufs.current.get(assistantId);
        const latest = store.get(conversationId);
        if (!latest) return;
        store.put({
          ...latest,
          updatedAt: Date.now(),
          messages: latest.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: b ? b.content : m.content,
                  reasoning: b ? b.reasoning : m.reasoning,
                  toolRuns: b ? b.toolRuns : m.toolRuns,
                  ...extra,
                }
              : m,
          ),
        });
      }

      function schedulePersist(): void {
        const b = bufs.current.get(assistantId);
        if (!b || b.timer !== undefined) return;
        b.timer = setTimeout(() => {
          b.timer = undefined;
          persistLive();
        }, 500);
      }

      function dropLive(): void {
        const b = bufs.current.get(assistantId);
        if (b?.timer !== undefined) clearTimeout(b.timer);
        bufs.current.delete(assistantId);
        setLiveState((prev) => {
          if (!(assistantId in prev)) return prev;
          const next = { ...prev };
          delete next[assistantId];
          return next;
        });
      }

      function ingest(kind: "content" | "reasoning", text: string): void {
        let b = bufs.current.get(assistantId);
        if (!b) {
          b = { convId: conversationId, content: "", reasoning: "", tail: "", toolRuns: [], timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b[kind] += text;
        if (kind === "reasoning") b.tail = appendTail(b.tail, text);
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail, toolRuns: b.toolRuns };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }

      // A running tool is replaced by its answer, matched by the call's id:
      // the thread shows the call once, not twice.
      function ingestToolRun(run: ToolRun): void {
        let b = bufs.current.get(assistantId);
        if (!b) {
          b = { convId: conversationId, content: "", reasoning: "", tail: "", toolRuns: [], timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b.toolRuns = b.toolRuns.some((existing) => existing.id === run.id)
          ? b.toolRuns.map((existing) => (existing.id === run.id ? run : existing))
          : [...b.toolRuns, run];
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail, toolRuns: b.toolRuns };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }
      try {
        await streamChatCompletion({
          endpoint: currentSettings.endpoint,
          token: currentSettings.token,
          model: currentSettings.model,
          messages: history,
          sampling: samplingWire(loadSampling()),
          signal: controller.signal,
          tools: offeredTools(currentSettings.webTools),
          // Read at send time, so the control takes effect on the very next
          // message with no reload.
          thinking: loadThinking(currentSettings.model),
          // The gate is armed per turn, on the documents the wire pinned at
          // send time — exactly the set this turn's model can quote, and the
          // read `runAssistant` already made, so no web call re-parses the
          // attachment store. A document detached mid-turn still gates the
          // turn's later calls (it was in context); one attached mid-turn
          // does not (the model first sees it next turn). Per conversation
          // for the same reason: B's model was never sent A's document, so
          // A's attachment must not put a question into B's turn — noise is
          // what teaches the owner to click through.
          runTool: (name, args, runSignal) =>
            executeToolCall(name, args, runSignal, {
              documents: () => docs,
              confirm: (check) => askOwner(check, runSignal),
            }),
          onToolRun: ingestToolRun,
          onReasoning: (text) => {
            if (thoughtStartedAt === null) {
              thoughtStartedAt = performance.now();
              setLiveMessage("Thinking.");
            }
            ingest("reasoning", text);
          },
          onToken: (token) => {
            if (firstToken) {
              firstToken = false;
              answerStartedAt = performance.now();
              setLiveMessage("Responding.");
            }
            ingest("content", token);
          },
        });
        const b = bufs.current.get(assistantId);
        const hasThought = (b?.reasoning ?? "") !== "";
        const hasAnswer = (b?.content ?? "") !== "";
        const ms =
          thoughtStartedAt !== null
            ? Math.max(0, Math.round((answerStartedAt ?? performance.now()) - thoughtStartedAt))
            : undefined;
        persistLive(ms !== undefined ? { reasoningMs: ms } : undefined);
        setLiveMessage(
          !hasAnswer && hasThought ? "Thinking complete, no answer arrived." : "Response complete.",
        );
      } catch (error) {
        if (error instanceof ChatRequestError && error.kind === "aborted") {
          persistLive({ stopped: true });
          setLiveMessage("Response stopped. Partial text kept.");
        } else {
          const kind: ChatErrorKind =
            error instanceof ChatRequestError ? error.kind : "network";
          const state: FailedState = {
            messageId: assistantId,
            kind,
            ...(error instanceof ChatRequestError && error.status !== undefined
              ? { status: error.status }
              : {}),
            ...(error instanceof ChatRequestError && error.url ? { url: error.url } : {}),
          };
          persistLive();
          setFailedById((prev) => ({ ...prev, [assistantId]: state }));
          setLiveMessage(
            kind === "truncated"
              ? "The answer stopped halfway. Details shown in the conversation."
              : "The response failed. Error details shown in the conversation.",
          );
        }
      } finally {
        dropLive();
        controllers.current.delete(assistantId);
        setStreamingByConv((prev) => {
          if (prev[conversationId] !== assistantId) return prev;
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
      }
    },
    [],
  );

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
        title: titleFor(text),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }
    const assistantId = uid();
    const userId = uid();
    const updated: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFor(text) : conv.title,
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
    void runAssistant(updated.id, assistantId, effectiveSettings);
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
    const assistantId = activeId ? streamingByConv[activeId] : undefined;
    if (assistantId) controllers.current.get(assistantId)?.abort();
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
    void runAssistant(active.id, messageId, effectiveSettings);
  }

  /** Appearance is a preference of the app, not a command in every header:
      it is chosen where the app's other settings are, and applied at once. */
  function chooseTheme(next: Theme): void {
    saveTheme(next);
    setTheme(next);
  }

  function removeConversation(id: string): void {
    const assistantId = streamingByConv[id];
    if (assistantId) controllers.current.get(assistantId)?.abort();
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

  // One hop along the surfaces. Hops between settings surfaces extend the
  // walk so back can retrace it one step at a time; the chat is not on the
  // path, so arriving from it the walk starts at the brain.
  function openSurface(next: SurfaceKey): void {
    if (next === surface) return;
    if (next === "brain") {
      setPath([]);
    } else if (next !== "chat") {
      setPath((prev) => {
        if (surface === "chat") return [];
        const grown = [...prev, surface];
        return grown.length > PATH_LIMIT ? grown.slice(grown.length - PATH_LIMIT) : grown;
      });
    }
    setSurface(next);
  }

  // The reverse of a hop: pop the walk's top. Bouncing between two pages
  // therefore never grows it.
  function goBack(): void {
    if (path.length === 0) {
      setSurface("brain");
      return;
    }
    setSurface(path[path.length - 1]);
    setPath(path.slice(0, -1));
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

  const empty = !active || active.messages.length === 0;
  const title = surface === "chat" ? (active ? active.title : "Crescent Chat") : surfaceLabel(surface);
  // One step back from here: the hop's origin, or the brain from the root.
  const backTarget: SurfaceKey = path.length > 0 ? path[path.length - 1] : "brain";

  // The gate's own sentence, when it owes one: only a hand-over the door
  // refused, which has no caller to return its answer to. Shown through the same
  // banner as the opens this shell asked for.
  const notice = slotNotice ?? slot.notice;

  // The crescent lives in the chat alone. Its entries are destinations, and
  // the component drops the page you are on and anything that page already
  // offers — see the rule in `CrescentNav`.
  const chatEntries: CrescentEntry[] = [
    { key: "brain", label: "Home", onSelect: () => openSurface("brain") },
    { key: "settings", label: "Settings", onSelect: () => openSurface("settings") },
  ];

  return (
    <div
      className={`shell${streamingAny ? " is-streaming" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Escape over a held call refuses it: the safest reading of a slam
          // on Escape is "no", never "send it".
          if (gateShown) answerGate(gateShown.id, false);
          else if (navOpen) setNavOpen(false);
          else if (drawerOpen) setDrawerOpen(false);
          else if (surface === "chat") openSurface("brain");
        }
      }}
    >
      {/* The crescent lives in the chat alone, overlaid at the shell's
          level: an open menu dims the page beneath it, so it must not sit
          inside what gets dimmed. It is a way between pages: the chat's own
          drawer already offers a new conversation and the history, so neither
          is repeated here. */}
      {surface === "chat" ? (
        <CrescentNav
          entries={chatEntries}
          current="chat"
          open={navOpen}
          onOpenChange={setNavOpen}
        />
      ) : null}

      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="topbar-btn topbar-drawer-toggle"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-expanded={drawerOpen}
            aria-label="Show conversations"
          >
            Conversations
          </button>
          <span className="topbar-mark" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          {/* The app's own settings, in the app's own strip. The row below the
              bar on the home is the machine's (what runs on it, who can reach
              it, how it is launched); this is the door to the app's. One door
              per surface, by the same rule the crescent follows: not on
              Settings itself, where it would do nothing, and not on the chat,
              whose own menu already carries it. */}
          {surface !== "settings" && surface !== "chat" ? (
            <button
              type="button"
              className="topbar-btn topbar-settings"
              onClick={() => openSurface("settings")}
              aria-label="Settings"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              Settings
            </button>
          ) : null}
          {surface !== "brain" && surface !== "chat" ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={goBack}
              aria-label={`Back to ${surfaceLabel(backTarget)}`}
            >
              {surfaceLabel(backTarget)}
            </button>
          ) : null}
          {surface === "chat" && active ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              aria-label="Toggle the files panel"
            >
              Files
            </button>
          ) : null}
        </div>
      </header>

      <main className="stage">
        {writeError ? (
          <div className="storage-banner" role="alert">
            <span>{writeError}</span>
            <button type="button" onClick={() => store.clearWriteError()}>
              Dismiss
            </button>
          </div>
        ) : null}
        {/* The door's own sentence about this device's slot, where it arrived.
            A refusal is an alert — the chat it names did not open — while a
            door built without the tier is a status: the chat opened, and the
            sentence only says what the door cannot do. Neither is rewritten
            here: the door distinguishes a slot that is empty from one whose
            state is unknown, and a friendlier sentence would lose that. */}
        {notice ? (
          <div
            className={notice.failed ? "storage-banner" : "refusal-banner"}
            role={notice.failed ? "alert" : "status"}
          >
            <span>{notice.message}</span>
            <button
              type="button"
              onClick={() => {
                setSlotNotice(null);
                gate.dismissNotice();
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {/* The ask lives at the stage's level, not inside the chat layout: a
            call can still be held after the owner navigates home, and the ask
            must stay on screen and answerable until it is answered. */}
        {gateShown ? (
          <WebGateDialog id={gateShown.id} check={gateShown.check} waiting={gateWaiting} onAnswer={answerGate} />
        ) : null}
        <ErrorBoundary>
          {surface === "brain" ? (
            <BrainSurface
              onNavigate={openSurface}
              onWrite={writeFromBrain}
              onOpenChat={() => openSurface("chat")}
            />
          ) : surface === "chat" ? (
            <div className="chat-layout">
              <Sidebar
                conversations={conversations}
                activeId={activeId}
                streamingIds={Object.keys(streamingByConv)}
                drawerOpen={drawerOpen}
                onCloseDrawer={() => setDrawerOpen(false)}
                onSelect={selectConversation}
                onNew={newConversation}
                onRename={(id, newTitle) => store.rename(id, newTitle)}
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
                    <span>Drop files to attach them to this conversation</span>
                  </div>
                ) : null}
                {refusal ? (
                  <div className="refusal-banner" role="alert">
                    <span>
                      <strong>{refusal.names} {refusal.names.includes(",") ? "don't" : "doesn't"} fit.</strong>
                      {` File ≈${refusal.docTokens.toLocaleString()} + history ≈${refusal.historyTokens.toLocaleString()} + ≈${CONTEXT_RESERVE_TOKENS.toLocaleString()} kept free for the answer = ≈${refusal.need.toLocaleString()} of ≈${refusal.have.toLocaleString()} context tokens. Nothing was attached or cut.`}
                    </span>
                    <button type="button" onClick={() => setRefusal(null)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}
                {empty ? (
                  <EmptyState
                    needsSetup={!configured}
                    onOpenSettings={() => openSurface("settings")}
                  />
                ) : (
                  <Thread
                    messages={active.messages}
                    streaming={streaming}
                    failed={effectiveFailed}
                    tails={tails}
                    onRetry={retry}
                    onOpenSettings={() => openSurface("settings")}
                  />
                )}
                {attachStatus ? (
                  <p className="attach-status" role="status">
                    {attachStatus}
                  </p>
                ) : null}
                <Composer
                  thinking={thinkingSupported ? thinking : null}
                  onThinking={(enabled) => {
                    // Saved at once and read at send time: the next message uses
                    // it, with no reload.
                    saveThinking(effectiveSettings.model, enabled);
                    setThinking(enabled);
                  }}
                  streaming={streaming}
                  opening={slot.pending || slot.creating}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={send}
                  onStop={stop}
                  onAttach={(files) => void attachFiles(files)}
                />
              </div>
              <Panel
                open={panelOpen && surface === "chat" && active !== null}
                attachments={attachments}
                contextTokens={ctxInfo && ctxInfo.endpoint === effectiveSettings.endpoint ? ctxInfo.nctx : null}
                historyTokens={convoTokens}
                onRemove={(id) => activeId && store.removeAttachment(activeId, id)}
                onReattach={(id) => {
                  if (!activeId) return;
                  const found = store.getAttachments(activeId).find((a) => a.id === id);
                  if (found) store.putAttachment(activeId, { ...found, active: true });
                }}
                onAttachFile={(path, name) => void attachFromDisk(path, name)}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          ) : surface === "settings" ? (
            <SettingsForm
              initial={settings}
              theme={theme}
              onTheme={chooseTheme}
              onWebTools={(webTools) => {
                // Writes only itself, from the settings that are already
                // stored: the text sitting unsaved in the connection fields is
                // neither committed nor wiped by touching this.
                const next = { ...settings, webTools };
                setSettings(next);
                saveSettings(next);
              }}
              onSave={(next) => {
                setSettings(next);
                saveSettings(next);
                nctxCache.current.clear();
                setCtxInfo(null);
              }}
            />
          ) : surface === "models" ? (
            <ModelsSurface onNavigate={openSurface} />
          ) : surface === "server" ? (
            <ServerSurface />
          ) : surface === "devices" ? (
            <DevicesSurface onNavigate={openSurface} />
          ) : surface === "advanced" ? (
            <AdvancedSurface />
          ) : null}
        </ErrorBoundary>
      </main>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
