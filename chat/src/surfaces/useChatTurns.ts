// The chat's turn engine: one assistant turn from its empty placeholder to
// its last byte — the stream, the buffers it fills, the throttled write-back
// to the store, the tool calls it runs, and the failures it lands. It knows
// nothing about which conversation is on screen; the chat (useChat) starts
// turns into this engine and reads the live state back out of it.

import { useCallback, useEffect, useRef, useState } from "react";
import { appendTail } from "../lib/tail";
import { ChatRequestError, completionBody } from "../lib/chat";
import type { ChatErrorKind } from "../lib/chat";
import { streamChatCompletion } from "../lib/toolLoop";
import { loadSampling, samplingWire } from "../lib/sampling";
import { loadThinking } from "../lib/thinking";
import type { LiveSettings, ToolRun } from "../lib/types";
import type { ConversationStore } from "../lib/store";
import { uid } from "../lib/store";
import type { DraftRecord } from "../lib/mail/drafts";
import { buildPinnedContext, CONTEXT_RESERVE_TOKENS, wireSize } from "../lib/attachments";
import type { MediaView } from "../lib/attachments";
import { wireTurns } from "../lib/wireTurns";
import { getImage } from "../lib/imageStore";
import { blobToDataUrl } from "../lib/images";
import { selectWireImages, wireBodyBytes, WIRE_BODY_BUDGET } from "../lib/wireBudget";
import type { WireImage } from "../lib/wireBudget";
import { executeToolCall, offeredTools } from "../lib/tools/registry";
import type { GateCheck } from "../lib/tools/registry";
import { covered, remember } from "../lib/webgate/allowance";
import type { Allowances } from "../lib/webgate/allowance";
import { answerSearchNotice, searchNotice } from "../lib/webgate/searchNotice";
import type { FailedState } from "../components/Thread";
import { useLanguage } from "../i18n/useLanguage";
import { logUiEvent } from "../lib/uiLog";

/** What an ask on screen is: the gate's own question about one call, or the
    one-time notice naming the service a search goes to. The notice is not a
    gate check — nothing is pinned and no string is on show — so it keeps its
    own shape instead of a check with empty fields, and nothing downstream can
    mistake one for the other. */
type Ask = { kind: "gate"; check: GateCheck } | { kind: "notice"; provider: string };

/** One held web call and the one function that ends its wait. The id is the
    ask's identity on screen: an answer carries it back, and settles only the
    ask it names — never whatever happens to be at the queue's head when the
    click lands. */
interface GateAsk {
  id: string;
  conversationId: string;
  ask: Ask;
  settle: (allow: boolean) => void;
}

/** How the turn engine talks to the room around it: the conversation store
    its turns write through, the shell's status line, and the pinned-context
    sizes the send-time decision reads. */
interface TurnEngine {
  store: ConversationStore;
  /** The shell's live status line (waiting, thinking, done, stopped). */
  announce: (message: string) => void;
  /** The per-endpoint context cache send-time reads — never fetched here:
      send-time never waits on /props. */
  contextSizes: { current: Map<string, number> };
  /** Stores the reply a draft run wrote, as the mail card would. */
  saveMailDraft: (replyToId: string, record: DraftRecord) => void;
}

export function useChatTurns({ store, announce, contextSizes, saveMailDraft }: TurnEngine) {
  const { table, language } = useLanguage();
  // The stable callbacks below read the table through this ref, so a
  // language chosen mid-session reaches the next turn's words.
  const words = useRef(table);
  words.current = table;

  // One entry per generating conversation (conversation id -> assistant id).
  // Streams are independent: answering in A never blocks sending in B.
  const [streamingByConv, setStreamingByConv] = useState<Record<string, string>>({});
  const [failedById, setFailedById] = useState<Record<string, FailedState>>({});
  const controllers = useRef(new Map<string, AbortController>());
  // In-flight stream buffers, keyed by assistant message id. Text lives here
  // while streaming and renders from here; the disk is written on a throttle
  // plus once at the end — never per token. The stored copy always trails
  // the buffer, so the buffer is authoritative until the run finishes.
  const bufs = useRef(
    new Map<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[]; timer: ReturnType<typeof setTimeout> | undefined }>(),
  );
  const [live, setLiveState] = useState<Record<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[] }>>({});

  // What the owner is asked before a web call leaves: the gate's own question
  // while documents are pinned or mail is in the chat, and the one-time notice
  // before this install's first search of all. They share one queue, so a
  // plain conversation with nothing attached still asks about the provider and
  // then, if it was answered and the gate is armed, about the call itself.
  // Streams in different conversations run at once, so asks can too: they
  // queue in arrival order and the dialog shows the head alone — one clean
  // question at a time rather than a batch that invites a careless yes, with
  // a line saying more are waiting and each taking the screen the moment the
  // one before it is answered or stopped. Every ask settles exactly once, by
  // its own dialog answer or its own turn's Stop — never by another
  // conversation's — so no turn is left waiting on a promise nobody holds. And
  // an answer names the ask it was shown: the queue mutates the moment an ask
  // settles, while the dialog re-renders on React's schedule, so a click on a
  // dialog whose ask is already gone must do nothing rather than approve
  // whatever took its place — for this feature, "the owner approved something
  // they were not shown" is the worst failure available, and identity removes
  // the question.
  const [gateShown, setGateShown] = useState<GateAsk | null>(null);
  const [gateWaiting, setGateWaiting] = useState(0);
  const gateAsks = useRef<GateAsk[]>([]);
  // What the owner has allowed per conversation, so a later call the allowance
  // covers goes out without a second question. Memory only: a restart forgets it.
  const allowances = useRef<Allowances>(new Map());

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

  // Settles the queued asks of this conversation that an allowance now covers:
  // they go out without ever being shown. The notice is never covered: it is
  // about the provider, not about this conversation's documents, and what an
  // allowance remembers says nothing about whether it was answered.
  function sweep(conversationId: string): void {
    for (const queued of [...gateAsks.current]) {
      const ask = queued.ask;
      const covers =
        ask.kind === "gate" &&
        queued.conversationId === conversationId &&
        covered(allowances.current, conversationId, ask.check);
      if (covers && gateAsks.current.includes(queued)) queued.settle(true);
    }
  }

  // Hold one ask for the owner, unless what this conversation already
  // allowed covers it. The ask joins the queue's tail; whatever is at the head
  // is what the dialog shows. Stop ends that conversation's
  // own wait as a refusal — the turn is gone, so the call must not leave
  // after it — and advances the queue to the next ask, if any.
  function hold(conversationId: string, ask: Ask, signal: AbortSignal): Promise<boolean> {
    if (ask.kind === "gate" && covered(allowances.current, conversationId, ask.check)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let queued: GateAsk;
      const settle = (allowed: boolean) => {
        signal.removeEventListener("abort", onAbort);
        const at = gateAsks.current.indexOf(queued);
        if (at !== -1) gateAsks.current.splice(at, 1);
        setGateShown(gateAsks.current[0] ?? null);
        setGateWaiting(Math.max(0, gateAsks.current.length - 1));
        if (allowed && ask.kind === "gate") {
          remember(allowances.current, conversationId, ask.check);
          sweep(conversationId);
        }
        resolve(allowed);
      };
      const onAbort = () => settle(false);
      queued = { id: uid(), conversationId, ask, settle };
      gateAsks.current.push(queued);
      setGateShown(gateAsks.current[0] ?? null);
      setGateWaiting(Math.max(0, gateAsks.current.length - 1));
      announce(table.shell.gateWaiting);
      if (signal.aborted) {
        settle(false);
        return;
      }
      signal.addEventListener("abort", onAbort);
    });
  }

  // The one-time notice in front of this install's first search, on the same
  // queue as the gate's own question so only one dialog is ever up. "Search"
  // keeps the answer for good; "Not now" keeps nothing, and the next search
  // asks again.
  async function firstSearchAsk(conversationId: string, signal: AbortSignal): Promise<boolean> {
    const state = await searchNotice();
    // No name means no notice can be shown, so the search does not go out: the
    // owner would never be told who receives it. Refused in the gate's own
    // words, exactly as "Not now" is.
    if (state.provider === "") return false;
    if (state.answered) return true;
    const allowed = await hold(conversationId, { kind: "notice", provider: state.provider }, signal);
    // Two conversations can reach this install's first search together, and the
    // second queues behind the first. The answer the owner gave the first is an
    // answer about the install, so re-read it here rather than ask again what
    // they have just been told — and settle whatever else is queued behind on
    // the same question, which would otherwise wait for a second click on a
    // question that has already been answered.
    if (state.answered) return true;
    if (allowed) {
      await answerSearchNotice();
      for (const queued of [...gateAsks.current]) {
        if (queued.ask.kind === "notice" && gateAsks.current.includes(queued)) queued.settle(true);
      }
    }
    return allowed;
  }

  // Answers the ask it names — the one the dialog was showing. If that ask is
  // already gone, settled by another path between render and click, the
  // answer finds nothing and does nothing; falling through to the head would
  // approve a call the owner may never have been shown.
  function answerGate(id: string, allow: boolean): void {
    gateAsks.current.find((ask) => ask.id === id)?.settle(allow);
  }

  // A widget's state edit on a turn that is still streaming. The live buffer
  // is authoritative until the run ends — the screen overlays it and
  // persistLive writes its toolRuns back — so an edit that only reached the
  // store would be reverted by the next persist and lost. It must land in the
  // buffer too, and the snapshot with it, or the overlay would keep hiding it.
  function patchMiniappState(
    messageId: string,
    runId: string,
    state: Record<string, unknown>,
  ): void {
    const b = bufs.current.get(messageId);
    if (!b || !b.toolRuns.some((run) => run.id === runId && run.miniapp)) return;
    b.toolRuns = b.toolRuns.map((run) =>
      run.id === runId && run.miniapp ? { ...run, miniapp: { ...run.miniapp, state } } : run,
    );
    setLiveState((prev) => {
      const entry = prev[messageId];
      if (!entry) return prev;
      return { ...prev, [messageId]: { ...entry, toolRuns: b.toolRuns } };
    });
  }

  const runAssistant = useCallback(
    async (
      conversationId: string,
      assistantId: string,
      currentSettings: LiveSettings,
      vision: boolean,
      think: boolean,
    ) => {
      const shell = words.current.shell;
      const conv = store.get(conversationId);
      if (!conv) return;
      // A retry of an older row regenerates THAT turn: its wire is what came
      // before the row, never the turns after it, which answered a different
      // prompt. A normal send's placeholder is the last message, so the slice
      // is the whole history.
      const at = conv.messages.findIndex((m) => m.id === assistantId);
      const before = at === -1 ? conv.messages : conv.messages.slice(0, at);
      const turns = wireTurns(before);
      // The mail this turn was opened for, if it was: a reply written for
      // another one is refused however the model names it.
      const openedFor = [...before].reverse().find((m) => m.role === "user")?.mailId;
      // The whole store of attachments rides the build: the pinned ones as
      // the system message's block, the per-turn ones through the ids their
      // messages bound.
      const all = store.getAttachments(conversationId);
      // The gate is armed on what this turn's model can quote — the pinned
      // actives plus every document bound to a kept message, whether it is
      // still the composer's own set or long since sent.
      const gateDocs = new Map(
        all.filter((a) => a.active).map((a) => [a.id, a] as const),
      );
      for (const message of turns) {
        for (const id of message.docs ?? []) {
          const found = all.find((a) => a.id === id);
          if (found) gateDocs.set(id, found);
        }
      }
      const docs = [...gateDocs.values()];
      // Send-time never fetches: the cached size (or unknown) decides, so a
      // request never waits on /props. Unknown means unpruned, never refused.
      const known = contextSizes.current.get(currentSettings.endpoint) ?? null;
      // The token fit is answered once, on the wire where every picture is
      // the placeholder sentence: each stored picture costs IMAGE_TOKENS
      // whether it rides or not, so the fit is the same for both shapes.
      const dry = buildPinnedContext(turns, all, known, { vision, think, url: () => null });

      function refuseOversize(code: string): void {
        // History outgrew the context after attaching — or the pictures the
        // person just attached cannot fit the door's body at all: keep the
        // empty placeholder so the error has a place to live, and log the
        // one code that says which.
        persistLive({ failed: "oversize" });
        setFailedById((prev) => ({
          ...prev,
          [assistantId]: { messageId: assistantId, kind: "oversize" },
        }));
        logUiEvent(code);
        announce(shell.tooMuchAtOnce);
      }

      if (dry.status === "refused") {
        refuseOversize("chat.turn_oversize");
        return;
      }
      // The door holds 16 MiB of body and answers 413 past it, so the wire
      // is packed under its own budget before it leaves: pictures ride
      // newest-first until the budget is spent and the oldest become the
      // placeholder sentence. The current turn's own pictures always ride —
      // a send they cannot fit is refused above their heads, never trimmed
      // out silently.
      const blobs = new Map<string, Blob>();
      const wire: WireImage[] = [];
      // A video's frames are images to this road — loaded, budgeted and
      // demoted by the same rules — and the current turn's own frames are
      // as protected as its own pictures.
      let currentTurnImages: string[] = [];
      if (vision) {
        for (const message of turns) {
          if (message.role !== "user") continue;
          const found: string[] = [];
          const wanted = [
            ...(message.images ?? []).map((image) => image.id),
            ...(message.videos ?? []).flatMap((video) => video.frames.map((frame) => frame.id)),
          ];
          const pendingLoads = new Map<string, Blob>();
          for (const id of wanted) {
            if (blobs.has(id) || pendingLoads.has(id)) continue;
            const blob = await getImage(id);
            if (blob) pendingLoads.set(id, blob);
          }
          const admit = (id: string): void => {
            if (blobs.has(id)) {
              found.push(id);
              return;
            }
            const blob = pendingLoads.get(id);
            if (blob === undefined) return;
            blobs.set(id, blob);
            wire.push({ id, bytes: blob.size });
            found.push(id);
          };
          for (const id of wanted) admit(id);
          currentTurnImages = found;
        }
      }
      const dryBody = JSON.stringify(
        completionBody(
          currentSettings.model,
          dry.wire,
          samplingWire(loadSampling()),
          offeredTools(currentSettings.webTools, language, currentSettings.model),
          "auto",
          loadThinking(currentSettings.model),
        ),
      );
      const dryBytes = wireBodyBytes(dryBody);
      const pick = selectWireImages(wire, dryBytes, currentTurnImages.length);
      if (dryBytes + pick.imageBytes > WIRE_BODY_BUDGET) {
        refuseOversize("chat.wire_oversize");
        return;
      }
      if (wire.length - pick.rides.size > 0) logUiEvent("chat.wire_image_placeholder");
      const urlMap = new Map<string, string>();
      for (const image of wire) {
        if (pick.rides.has(image.id)) {
          urlMap.set(image.id, await blobToDataUrl(blobs.get(image.id) ?? new Blob()));
        }
      }
      const media: MediaView = { vision, think, url: (id) => urlMap.get(id) ?? null };
      const ctx = buildPinnedContext(turns, all, known, media);
      // Unreachable by construction: this build spends the same tokens the
      // dry one already passed above (a picture costs IMAGE_TOKENS riding
      // or not), so the check exists to hand the type that invariant.
      if (ctx.status === "refused") return;
      const history = ctx.wire;
      const controller = new AbortController();
      controllers.current.set(assistantId, controller);
      setStreamingByConv((prev) => ({ ...prev, [conversationId]: assistantId }));
      const storedFailure = store
        .get(conversationId)
        ?.messages.find((m) => m.id === assistantId)?.failed;
      if (storedFailure) persistLive({ failed: undefined });
      setFailedById((prev) => {
        if (!(assistantId in prev)) return prev;
        const next = { ...prev };
        delete next[assistantId];
        return next;
      });
      announce(shell.waitingFirstWord);
      let firstToken = true;
      let thoughtStartedAt: number | null = null;
      let answerStartedAt: number | null = null;

      function persistLive(extra?: { stopped?: boolean; reasoningMs?: number; failed?: ChatErrorKind | undefined }): void {
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

      function publish(): void {
        const b = bufs.current.get(assistantId);
        if (!b) return;
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail, toolRuns: b.toolRuns };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }

      // The refused round is the turn's first, so its reasoning is the buffer's
      // whole reasoning. It leaves by exact suffix and is persisted now, not on
      // the debounce. The refused answer text was never published.
      function withdraw(reasoning: string): void {
        const b = bufs.current.get(assistantId);
        if (!b || !b.reasoning.endsWith(reasoning)) return;
        b.reasoning = b.reasoning.slice(0, b.reasoning.length - reasoning.length);
        b.tail = appendTail("", b.reasoning);
        publish();
        persistLive();
      }

      function ingest(kind: "content" | "reasoning", text: string): void {
        let b = bufs.current.get(assistantId);
        if (!b) {
          b = { convId: conversationId, content: "", reasoning: "", tail: "", toolRuns: [], timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b[kind] += text;
        if (kind === "reasoning") b.tail = appendTail(b.tail, text);
        publish();
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
        publish();
        // A newly written draft replaces the stored one for its mail: the card
        // is only ever drawn from the store, so this is how the new words show.
        if (run.mail?.kind === "draft") {
          saveMailDraft(run.mail.replyToId, { to: run.mail.to, subject: run.mail.subject, body: run.mail.body });
        }
      }
      try {
        await streamChatCompletion({
          endpoint: currentSettings.endpoint,
          token: currentSettings.token,
          model: currentSettings.model,
          messages: history,
          // The same room `buildPinnedContext` fit this wire to: the window
          // less the answer's reserve, and the one estimator that measures
          // it. The tool loop re-checks each follow-up round against both
          // (`toolLoop.ts`); unknown stays null, and nothing is pruned on a
          // guess.
          contextFit:
            known === null
              ? null
              : { budget: Math.max(0, known - CONTEXT_RESERVE_TOKENS), size: wireSize },
          sampling: samplingWire(loadSampling()),
          signal: controller.signal,
          tools: offeredTools(currentSettings.webTools, language, currentSettings.model),
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
          runTool: (name, args, runSignal, conversation) =>
            executeToolCall(
              name,
              args,
              runSignal,
              {
                documents: () => docs,
                confirm: (check) => hold(conversationId, { kind: "gate", check }, runSignal),
                firstSearch: () => firstSearchAsk(conversationId, runSignal),
              },
              conversation,
              currentSettings.model,
              openedFor,
            ),
          onToolRun: ingestToolRun,
          onWithdraw: withdraw,
          toolPhrases: words.current.tools,
          onReasoning: (text) => {
            if (thoughtStartedAt === null) {
              thoughtStartedAt = performance.now();
              announce(shell.thinking);
            }
            ingest("reasoning", text);
          },
          onToken: (token) => {
            if (firstToken) {
              firstToken = false;
              answerStartedAt = performance.now();
              announce(shell.waitingFirstWord);
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
        announce(!hasAnswer && hasThought ? shell.thinkingComplete : shell.responseComplete);
      } catch (error) {
        if (error instanceof ChatRequestError && error.kind === "aborted") {
          persistLive({ stopped: true });
          announce(shell.responseStopped);
        } else {
          const kind: ChatErrorKind =
            error instanceof ChatRequestError ? error.kind : "network";
          const state: FailedState = { messageId: assistantId, kind, at: Date.now() };
          persistLive({ failed: kind });
          setFailedById((prev) => ({ ...prev, [assistantId]: state }));
          // The kind is the code's tail; the hyphen in `bad-response` is not
          // a character the log writes, so it leaves as an underscore.
          logUiEvent(`chat.turn_${kind.replace(/-/g, "_")}`);
          announce(shell.stoppedBeforeFinishing);
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
    // The engine reads the table and the room only through refs, and the two
    // injected pieces are stable (a state setter and a ref), so the callback
    // never goes stale.
    [announce, contextSizes],
  );

  // Aborts one conversation's running turn, if it has one — the visible
  // conversation's Stop, and the delete flow's quiet abort.
  function stopFor(conversationId: string): void {
    const assistantId = streamingByConv[conversationId];
    if (assistantId) controllers.current.get(assistantId)?.abort();
  }

  return {
    live,
    streamingByConv,
    failedById,
    gateShown,
    gateWaiting,
    answerGate,
    runAssistant,
    stopFor,
    patchMiniappState,
  };
}
