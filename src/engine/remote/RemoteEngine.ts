import { getStrings, type Locale } from "../../i18n";
import type {
  EngineCallbacks,
  EngineInitOptions,
  EngineInitResult,
  EngineMessage,
  MemoryExtractResult,
  StreamTurnOptions,
} from "../LlamaService";
import { createThinkStreamCleaner } from "../thinkStream";
import {
  applyMemoryFactsToLastUser,
  buildMemoryFactsBlock,
} from "../memoryFactsTail";
import { planRemoteTurn, remoteChatBodyJson, type RemoteImageRefusal } from "./openaiMessages";
import { buildRemoteSystemPrompt } from "./remotePrompt";
import { streamOpenAiChat } from "./openaiTransport";
import { getRemoteDoorConfig, getRemoteDoorToken } from "./remoteDoorConfig";
import type { RemoteDoorConfig } from "./remoteDoorConfig";
import { doorRequestBase } from "./doorRequestBase";
import { removedRoomError } from "../../room/roomError";
import { doorFetchFor, establishDoorRoad, PROBE_JSON_TIMEOUT_MS, type DoorFetch, type DoorRoad } from "../../remote/doorRoad";
import { fetchJsonOverTunnel } from "../../remote/tunnelFetch";
import { createIrohChatXhr } from "../../remote/irohChatXhr";
import type { IrohTunnel } from "../../remote/irohHttp";
import {
  canSendAuthorization,
  isNonLoopback,
  joinRemoteApiUrl,
  remoteUrlGateError,
} from "./remoteUrl";
import {
  getRemoteContextSize,
  getRemoteMaxTokens,
  getRemoteServerModelId,
  getRemoteTemperature,
  setRemoteContextSize,
  setRemoteConfigChangedHook,
  adoptRemoteServerModelId,
  resolveServedModel,
} from "./remoteSettings";
import { REMOTE_COMPUTER_MODEL_ID } from "./remoteComputerModel";
import { parseServerContext } from "./serverContext";
import { parseModalities, setRemoteVision, type RemoteVisionVerdict } from "./modalities";
import { readRemotePictures, storedPictureSizes } from "./remoteImageBytes";
import { wireBodyBytes } from "./wireBudget";
import { logRemoteBrainFailure, type RemoteBrainFailureRoad } from "./remoteBrainFailureLog";
import type { Road } from "../../remote/road";

let ready = false;
let activeId: string | null = null;
let inFlight = false;
let lastRequestId: string | null = null;
let activeStream: { abort: () => void } | null = null;
let initGeneration = 0;
let streamGeneration = 0;
/** Bumped by the config hook below: the door's address or model changed, so
 *  every verdict read under the previous config describes a server this phone
 *  no longer talks to. A turn compares it across its own awaits. */
let configEpoch = 0;

// A URL/model edit invalidates readiness: the next ensure must re-probe the
// server it will actually talk to, not inherit the ready short-circuit's
// verdict about the previous one.
setRemoteConfigChangedHook(() => {
  // Readiness AND any probe already in flight: initRemoteEngine re-checks its
  // generation after the probe, so an init started before this edit cannot
  // mark ready against the previous server (re-audit 2, R2-2).
  ready = false;
  initGeneration += 1;
  configEpoch += 1;
  // The capability belonged to the server just edited away: until a probe
  // speaks for the new one, no picture may be sent.
  setRemoteVision(false);
});

/**
 * Verdict for an init/stream that lost a race with a newer one (or a dispose).
 * Its result must never be written into UI state as success OR failure: the
 * operation that superseded it owns the screen. Callers ask before reporting.
 */
export function isSupersededRemoteOp(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  // Own property only: an error whose prototype happens to carry `superseded`
  // would otherwise make a current failure invisible.
  if (!Object.prototype.hasOwnProperty.call(value, "superseded")) return false;
  return (value as { superseded?: unknown }).superseded === true;
}

function supersededInitError(): Error {
  const err = new Error("remote_brain_stale_init") as Error & {
    superseded?: true;
  };
  err.superseded = true;
  return err;
}

function authHeaders(url: string, token: string | null): Record<string, string> {
  if (!token || !canSendAuthorization(url)) return {};
  return { Authorization: `Bearer ${token}` };
}

const PROBE_TIMEOUT_MS = 10_000;

/**
 * The 401 code for THIS door: a paired desk answering 401 has forgotten
 * (or revoked) this phone; a manual URL/token server answering 401 was
 * handed a wrong token. Two different sentences, decided where the door
 * is known — the transport itself is authorization-blind.
 */
function unauthorizedCode(source: RemoteDoorConfig["source"]): string {
  return source === "pairing"
    ? "remote_brain_http_401"
    : "remote_brain_token_refused";
}

async function jsonGet(
  base: string,
  path: string,
  token: string | null,
  fetcher: DoorFetch,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = joinRemoteApiUrl(base, path);
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders(url, token) },
    signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function testRemoteConnection(): Promise<{
  ok: boolean;
  modelId: string | null;
  models?: string[];
  error?: string;
  /** The road the probe rode; absent when it died before the dial. */
  road?: Road;
}> {
  const configured = getRemoteServerModelId();
  const probe = new AbortController();
  const probeTimer = setTimeout(() => probe.abort(), PROBE_TIMEOUT_MS);
  try {
    const door = await getRemoteDoorConfig();
    if (door.pairing?.removed) {
      // The room already refused this phone: its bearer does not go on a
      // chat request either — the same verdict the room routes give.
      return { ok: false, modelId: configured || null, error: removedRoomError().code };
    }
    // A pairing that saved no address names the iroh stand-in origin —
    // or fails here with the code for a road this phone no longer has.
    const resolvedBase = doorRequestBase(door);
    if (!resolvedBase.ok) {
      return {
        ok: false,
        modelId: configured || null,
        error: resolvedBase.error,
      };
    }
    const base = resolvedBase.base;
    const urlGate = remoteUrlGateError(base);
    if (urlGate) {
      return {
        ok: false,
        modelId: configured || null,
        error: urlGate,
      };
    }
    const token = await getRemoteDoorToken(door);
    if (isNonLoopback(base) && !token) {
      return {
        ok: false,
        modelId: configured || null,
        error: "remote_brain_token_required",
      };
    }
    // One road decision for the whole probe, established before any of its
    // requests carries the paired credential; the probe's abort window
    // covers the dial too.
    const road = await establishDoorRoad(door, probe.signal);
    const doorFetch = doorFetchFor(road);
    // The window the server will actually answer within: we send no context
    // length, so its setting decides, and sizing prompts beyond it fails with
    // something the user cannot act on. Best effort and backend-agnostic: a
    // server that does not expose /props keeps our conservative default.
    const props = await jsonGet(base, "/props", token, doorFetch, probe.signal);
    // The desk's own word on what it can receive, kept for the composer's
    // chips. It describes THIS server, so a probe that could not read it
    // leaves "cannot" standing.
    setRemoteVision(props.ok ? parseModalities(props.body).vision : false);
    const serverContext = props.ok ? parseServerContext(props.body) : null;
    if (serverContext !== null && serverContext !== getRemoteContextSize()) {
      await setRemoteContextSize(serverContext);
    }

    const models = await jsonGet(base, "/v1/models", token, doorFetch, probe.signal);
    let ids: string[] = [];
    if (models.ok) {
      const data = (models.body as { data?: Array<{ id?: string }> } | null)?.data;
      // Trimmed and deduplicated at the source: ["m","m"] or [" m "] must
      // count as ONE id, or a duplicate list defeats the single-id adoption
      // and the stale-id bug survives.
      ids = Array.isArray(data)
        ? [
            ...new Set(
              data
                .map((row) => row?.id)
                .filter((id): id is string => typeof id === "string")
                .map((id) => id.trim())
                .filter((id) => id.length > 0),
            ),
          ]
        : [];
    } else {
      // A 401 from the models read is an authorization verdict no /health
      // answer can upgrade — a healthy server still refused the credential.
      // It is decided here, before health is ever consulted.
      if (models.status === 401) {
        return {
          ok: false,
          modelId: configured || null,
          road: road.road,
          error: unauthorizedCode(door.source),
        };
      }
      const health = await jsonGet(base, "/health", token, doorFetch, probe.signal);
      if (!health.ok) {
        return {
          ok: false,
          modelId: configured || null,
          road: road.road,
          error:
            health.status === 401
              ? unauthorizedCode(door.source)
              : `models HTTP ${models.status}`,
        };
      }
    }
    const decision = resolveServedModel(configured, ids);
    if (decision.kind === "adopt") {
      // The desk serves exactly one id: it IS the model (a path today, an
      // alias later). Persisting what THIS probe saw must not trip the
      // config-changed hook — the init in flight would supersede itself.
      await adoptRemoteServerModelId(decision.modelId);
      return { ok: true, modelId: decision.modelId, models: ids, road: road.road };
    }
    if (decision.kind === "error") {
      return {
        ok: false,
        modelId: configured || null,
        models: ids,
        road: road.road,
        error: decision.code,
      };
    }
    return { ok: true, modelId: decision.modelId, models: ids, road: road.road };
  } catch (err) {
    return {
      ok: false,
      modelId: configured || null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(probeTimer);
  }
}

/**
 * The desk's `/props`, re-read NOW: the image picker asks before it opens and
 * a send that carries pictures asks again, because the computer may have
 * restarted or switched model since the last probe. "cannot" and
 * "unreachable" are kept apart — the picker's refusal says which one it is —
 * and BOTH leave the remembered verdict false: a capability that could not be
 * read never lets a picture through. The answer replaces the remembered one,
 * so the chips read what the last look at the desk saw.
 */
export async function refreshRemoteVision(): Promise<RemoteVisionVerdict> {
  const probe = new AbortController();
  const probeTimer = setTimeout(() => probe.abort(), PROBE_TIMEOUT_MS);
  const answer = (verdict: RemoteVisionVerdict) => {
    setRemoteVision(verdict === "sees");
    return verdict;
  };
  try {
    const door = await getRemoteDoorConfig();
    if (door.pairing?.removed) return answer("unreachable");
    const resolvedBase = doorRequestBase(door);
    if (!resolvedBase.ok) return answer("unreachable");
    const base = resolvedBase.base;
    if (remoteUrlGateError(base)) return answer("unreachable");
    const token = await getRemoteDoorToken(door);
    if (isNonLoopback(base) && !token) return answer("unreachable");
    const road = await establishDoorRoad(door, probe.signal);
    const props = await jsonGet(base, "/props", token, doorFetchFor(road), probe.signal);
    if (!props.ok) return answer("unreachable");
    return answer(parseModalities(props.body).vision ? "sees" : "cannot");
  } catch {
    return answer("unreachable");
  } finally {
    clearTimeout(probeTimer);
  }
}

/**
 * What each picture refusal the plan can reach says to the user: the body
 * ceiling, a picture this phone could not read, and a model that cannot see
 * the one just attached. The last two are the turn's own picture failing —
 * the user is looking at it in the composer and must be told, not sent
 * blind.
 */
const PICTURE_REFUSAL_CODES: Record<RemoteImageRefusal, string> = {
  images_too_big: "remote_brain_images_too_big",
  image_unreadable: "remote_brain_image_unreadable",
  vision_off: "remote_brain_no_vision",
};

export async function initRemoteEngine(
  _modelPath: string,
  modelId: string,
  options: EngineInitOptions,
): Promise<EngineInitResult> {
  const gen = ++initGeneration;
  const probe = await testRemoteConnection();
  if (gen !== initGeneration) {
    throw supersededInitError();
  }
  if (!probe.ok) {
    ready = false;
    activeId = null;
    // Success logs (remote.brain.init); so must failure, or a dead probe is
    // invisible in logcat — tonight's "Could not reach your computer" with
    // no line at all.
    logRemoteBrainFailure("init", probe.road ?? "unknown", new Error(probe.error ?? ""));
    const strings = getStrings(options.locale);
    throw new Error(probe.error || strings.errors.modelNotLoaded);
  }
  ready = true;
  activeId = REMOTE_COMPUTER_MODEL_ID;
  // Deliberately no serverModelId here: the desk's id can be a file path
  // naming its user, and no log line may carry it — KALSA_ROAD,
  // KALSA_PAIRING_FAIL and telemetry all stay id-free (the telemetry
  // categories only map KNOWN registry ids, src/telemetry/pure.ts:87).
  console.log(
    "remote.brain.init",
    JSON.stringify({
      ok: true,
      modelId: activeId,
    }),
  );
  return { effectiveNCtx: getRemoteContextSize() };
}

export async function disposeRemoteEngine(): Promise<void> {
  initGeneration += 1;
  streamGeneration += 1;
  try {
    activeStream?.abort();
  } catch {
    // ignore
  }
  activeStream = null;
  ready = false;
  activeId = null;
  inFlight = false;
  // Leaving the remote brain leaves its capability behind: a local model's
  // own mmproj decides from here on, and the chips must not read a stale
  // verdict about a door this engine no longer talks to.
  setRemoteVision(false);
}

export function isRemoteEngineReady(): boolean {
  return ready;
}

export function getRemoteActiveModelId(): string | null {
  return activeId;
}

export function remoteNativeWorkInFlight(): boolean {
  return inFlight;
}

export function getLastRemoteRequestId(): string | null {
  return lastRequestId;
}

export async function streamRemoteAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal: AbortSignal | undefined,
  options: StreamTurnOptions,
): Promise<void> {
  const locale: Locale = options.locale;
  const strings = getStrings(locale);
  // A pairing is the active door credential/address pair when present; a
  // manual URL and token remain the fallback for users who have not paired.
  const serverModel = getRemoteServerModelId();
  if (inFlight) {
    logRemoteBrainFailure("stream", "unknown", new Error("remote_brain_busy"));
    callbacks.onError(new Error("remote_brain_busy"));
    return;
  }
  const myGen = ++streamGeneration;
  const stillMine = () => myGen === streamGeneration;
  inFlight = true;
  // The road the turn ended on, for its one failure line: "unknown" until
  // the dial answers, the chosen road after.
  let turnRoad: RemoteBrainFailureRoad = "unknown";
  const reportPreStreamError = (err: unknown) => {
    if (!stillMine()) return;
    inFlight = false;
    logRemoteBrainFailure("stream", turnRoad, err);
    const failure = err instanceof Error ? err : new Error(String(err));
    const control = failure as { code?: string; superseded?: boolean };
    const ours =
      failure.message.startsWith("remote_brain_") ||
      control.code === "interrupted" ||
      control.code === "removed" ||
      control.superseded === true;
    callbacks.onError(ours ? failure : new Error("remote_brain_internal"));
  };
  let door: Awaited<ReturnType<typeof getRemoteDoorConfig>>;
  try {
    door = await getRemoteDoorConfig();
  } catch (error) {
    reportPreStreamError(error);
    return;
  }
  if (!stillMine()) return;
  if (door.pairing !== null && door.pairing.removed) {
    // The room's own verdict, before any byte or bearer: the UI reads the
    // same "removed" the room client would have answered.
    const removed = removedRoomError();
    const err = new Error(removed.message) as Error & { code: string };
    err.code = removed.code;
    reportPreStreamError(err);
    return;
  }
  const resolvedBase = doorRequestBase(door);
  if (!resolvedBase.ok) {
    reportPreStreamError(new Error(resolvedBase.error));
    return;
  }
  const base = resolvedBase.base;
  const urlGate = remoteUrlGateError(base);
  if (urlGate) {
    reportPreStreamError(new Error(urlGate));
    return;
  }
  if (!ready) {
    reportPreStreamError(new Error(strings.errors.modelNotLoaded));
    return;
  }
  // URL, credential and model identify one door for the whole turn.
  let token: string | null;
  try {
    token = await getRemoteDoorToken(door);
  } catch (error) {
    reportPreStreamError(error);
    return;
  }
  if (!stillMine()) return;
  if (isNonLoopback(base) && !token) {
    reportPreStreamError(new Error("remote_brain_token_required"));
    return;
  }
  // One road decision for the whole turn, before any request byte exists.
  let road: DoorRoad;
  try {
    road = await establishDoorRoad(door, signal);
  } catch (error) {
    if ((error as { code?: string }).code !== "interrupted") {
      reportPreStreamError(error);
      return;
    }
    // The turn's own signal killed the dial: interrupted copy, like any
    // abort this engine reports.
    const err = new Error(strings.chat.interrupted);
    (err as { code?: string }).code = "interrupted";
    (err as { preservePartial?: boolean }).preservePartial = true;
    reportPreStreamError(err);
    return;
  }
  // The turn's iroh tunnel is released only while it is still ours: once
  // send() takes it, the chat XHR shim owns its close.
  turnRoad = road.road;
  let turnTunnel: IrohTunnel | null = road.road === "iroh" ? road.firstTunnel : null;
  const releaseTurnTunnel = () => {
    const tunnel = turnTunnel;
    turnTunnel = null;
    if (tunnel !== null) void tunnel.shutdown().catch(() => undefined);
  };
  if (!stillMine()) {
    releaseTurnTunnel();
    return;
  }
  let visible = "";
  let emitted = "";
  let thinking = false;
  let writing = false;
  const think = createThinkStreamCleaner();
  let closed = false;
  const flushEveryMs = 32;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const safeDelta = (chunk: string, full: string) => {
    try {
      callbacks.onDelta(chunk, full);
    } catch {
      // never wedge the stream on a UI throw
    }
  };
  const safeStatus = (label: string) => {
    try {
      callbacks.onStatus?.({ label });
    } catch {
      // ignore
    }
  };

  const flush = () => {
    if (!pending) return;
    const chunk = pending;
    pending = "";
    visible += chunk;
    safeDelta(chunk, visible);
  };

  const queue = (text: string) => {
    if (!text) return;
    pending += text;
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        flush();
      } catch {
        // ignore
      }
    }, flushEveryMs);
  };

  const finishOnce = (err?: Error) => {
    if (closed) return;
    closed = true;
    if (err) logRemoteBrainFailure("stream", turnRoad, err);
    releaseTurnTunnel();
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const mine = stillMine();
    if (!mine && err) {
      // A newer turn or a dispose owns the UI now. The failure is still
      // delivered (it may carry "your partial reply was interrupted", which
      // only the caller can mark) but flagged, so the caller does not report it
      // as the failure of the conversation that replaced this one.
      (err as Error & { superseded?: true }).superseded = true;
    }
    if (mine) {
      inFlight = false;
      activeStream = null;
    }
    if (mine) {
      try {
        flush();
        const finalVisible = think.finalize(emitted);
        if (finalVisible !== visible) {
          visible = finalVisible;
          safeDelta("", visible);
        }
      } catch {
        // finalize must not suppress terminal dispatch
      }
      try {
        // EmissionSource by outcome, mirroring the local paths: only a
        // completed turn is "parsed"; interrupted / truncated / error
        // partials are raw accumulation. `emitted` is raw delta.content —
        // think tags are stripped only for display (onDelta), never here.
        if (emitted.length > 0) {
          callbacks.onModelEmittedText?.(emitted, err ? "raw" : "parsed");
        }
      } catch {
        // ignore
      }
    }
    // A dead turn writes no success: the operation that replaced it owns the UI,
    // and the awaiting caller still unwinds the turn on its own.
    try {
      if (err) {
        callbacks.onError(err);
      } else if (mine) {
        callbacks.onDone();
      }
    } catch {
      // terminal attempted
    }
  };

  safeStatus(strings.chat.thinkingStatus);

  let streamStarted = false;
  try {
  if (!stillMine()) {
    releaseTurnTunnel();
    return;
  }
  if (signal?.aborted) {
    const err = new Error(strings.chat.interrupted);
    (err as { code?: string; preservePartial?: boolean }).code = "interrupted";
    (err as { preservePartial?: boolean }).preservePartial = true;
    finishOnce(err);
    return;
  }
  if (!stillMine()) {
    releaseTurnTunnel();
    return;
  }
  // Format B, local parity (ttftFlags.ts:26): facts ride the last user turn,
  // never the system prompt — a fact edit must not rewrite prompt position 0.
  const factsTail = buildMemoryFactsBlock(locale, options.memoryFacts);
  const turnMessages = factsTail
    ? applyMemoryFactsToLastUser(messages, factsTail)
    : messages;
  streamStarted = true;
  // The desk's own word on seeing, re-read for a turn that carries pictures:
  // it may have restarted or switched model since the picker's probe, and a
  // picture handed to a model without a projector fails the turn. The read is
  // bounded by its own deadline as well as the turn's signal — a desk that
  // accepts the connection and then says nothing must not hold the send — and
  // it never steals the establishment tunnel the chat request rides: on the
  // iroh road it opens its own.
  const configEpochAtProbe = configEpoch;
  const pictureUris = turnMessages.flatMap((message) => message.images ?? []);
  const currentTurn = turnMessages[turnMessages.length - 1];
  const currentTurnPictures = currentTurn?.role === "user" ? currentTurn.images ?? [] : [];
  let verdict: RemoteVisionVerdict = "unreachable";
  if (pictureUris.length > 0) {
    const probeFetch: DoorFetch =
      road.road === "https"
        ? doorFetchFor(road)
        : async (url, init) =>
            fetchJsonOverTunnel(await road.openTunnel(init.signal), url, init, {
              timeoutMs: PROBE_JSON_TIMEOUT_MS,
              signal: init.signal,
            });
    const probe = new AbortController();
    const probeTimer = setTimeout(() => probe.abort(), PROBE_JSON_TIMEOUT_MS);
    const onTurnAbort = () => probe.abort();
    signal?.addEventListener("abort", onTurnAbort);
    try {
      const props = await jsonGet(base, "/props", token, probeFetch, probe.signal);
      verdict = !props.ok ? "unreachable" : parseModalities(props.body).vision ? "sees" : "cannot";
    } catch {
      verdict = "unreachable";
    } finally {
      clearTimeout(probeTimer);
      signal?.removeEventListener("abort", onTurnAbort);
    }
    if (signal?.aborted) {
      const err = new Error(strings.chat.interrupted);
      (err as { code?: string; preservePartial?: boolean }).code = "interrupted";
      (err as { preservePartial?: boolean }).preservePartial = true;
      finishOnce(err);
      return;
    }
    if (verdict === "unreachable" && currentTurnPictures.length > 0) {
      // The picture the person is waiting on cannot be verified as
      // deliverable: the send is refused rather than made blind.
      releaseTurnTunnel();
      reportPreStreamError(new Error("remote_brain_network"));
      return;
    }
  }
  const maxTokens = getRemoteMaxTokens();
  const temperature = getRemoteTemperature();
  // The stored sizes cost one stat per picture and are only worth asking for
  // when the desk can actually be shown one.
  const sizes =
    verdict === "sees"
      ? await storedPictureSizes(pictureUris)
      : new Map<string, number>();
  const plan = await planRemoteTurn({
    messages: turnMessages,
    system: buildRemoteSystemPrompt({
      locale,
      operativeContext: options.operativeContext,
    }),
    vision: verdict === "sees",
    sizes,
    readPictures: readRemotePictures,
    // The budget measures the very JSON the transport sends: one constructor
    // for both, so the two cannot drift apart.
    bodyBytes: (mapped) =>
      wireBodyBytes(
        remoteChatBodyJson({ model: serverModel, messages: mapped, maxTokens, temperature }),
      ),
  });
  // The door may have been edited while /props was read and the pictures were
  // prepared: that verdict, and this plan, describe a server the turn has no
  // business posting pictures to now — and the verdict must not be remembered
  // as this phone's capability either. A text-only turn is left alone: it has
  // no verdict to be wrong about.
  if (pictureUris.length > 0 && configEpoch !== configEpochAtProbe) {
    releaseTurnTunnel();
    reportPreStreamError(new Error("remote_brain_stale_init"));
    return;
  }
  if (!stillMine()) {
    releaseTurnTunnel();
    return;
  }
  if (pictureUris.length > 0) setRemoteVision(verdict === "sees");
  if (!plan.ok) {
    releaseTurnTunnel();
    reportPreStreamError(new Error(PICTURE_REFUSAL_CODES[plan.reason]));
    return;
  }
  await new Promise<void>((resolve) => {
    const settle = (err?: Error) => {
      try {
        finishOnce(err);
      } finally {
        resolve();
      }
    };
    if (!stillMine()) {
      releaseTurnTunnel();
      resolve();
      return;
    }
    const handle = streamOpenAiChat(
      {
        completionsUrl: joinRemoteApiUrl(base, "/v1/chat/completions"),
        model: serverModel,
        messages: plan.messages,
        maxTokens,
        temperature,
        token: token && canSendAuthorization(base) ? token : null,
        signal,
      },
      {
        onDelta: (delta) => {
          if (delta.reasoning && !thinking && !writing) {
            thinking = true;
            safeStatus(strings.chat.thinkingStatus);
          }
          if (delta.content) {
            emitted += delta.content;
            const visibleChunk = think.cleanDelta(delta.content);
            if (!writing && visibleChunk) {
              writing = true;
              safeStatus(strings.chat.writingStatus);
              console.log(
                "remote.brain.token",
                JSON.stringify({ n: visibleChunk.length }),
              );
            }
            if (visibleChunk) queue(visibleChunk);
          }
        },
        onFinish: (finish) => {
          if (finish.kind === "complete") {
            settle();
            return;
          }
          // The transport's 401 is authorization-blind: the door the turn
          // rode decides which failure — and which sentence — it earns.
          const raw =
            finish.kind === "truncated"
              ? strings.chat.truncated
              : finish.kind === "interrupted"
                ? strings.chat.interrupted
                : finish.error?.message || strings.chat.serviceUnreachable;
          const err = new Error(
            raw === "remote_brain_http_401" && door.source === "manual"
              ? "remote_brain_token_refused"
              : raw,
          );
          (err as { code?: string; preservePartial?: boolean }).code =
            finish.kind;
          (err as { preservePartial?: boolean }).preservePartial =
            finish.kind === "interrupted" || finish.kind === "truncated";
          settle(err);
        },
      },
      road.road === "iroh"
        ? () =>
            createIrohChatXhr(() => {
              const tunnel = turnTunnel;
              turnTunnel = null;
              if (tunnel === null) throw new Error("iroh door tunnel already consumed");
              return tunnel;
            })
        : undefined,
    );
    if (handle.isClosed()) {
      // The transport finished before send(): whatever the shim did not take
      // is still ours to close.
      releaseTurnTunnel();
      return;
    }
    if (!stillMine()) {
      handle.abort();
      resolve();
      return;
    }
    lastRequestId = handle.requestId;
    activeStream = handle;
    console.log(
      "remote.brain.stream",
      JSON.stringify({ requestId: lastRequestId, model: activeId }),
    );
    if (signal?.aborted) handle.abort();
  });
  } catch (err) {
    if (!closed) {
      // Boundary pass-through: only our own codes and the control signals
      // AppShell must see unchanged — the "interrupted" code marker, the
      // "removed" verdict of a room that refused this phone, and the
      // superseded flag — may cross verbatim. Anything else (any snake_case
      // token a dependency might throw) becomes remote_brain_internal, so the
      // UI can only ever render human copy (re-audit 2, R2-1).
      const failure = err instanceof Error ? err : new Error(String(err));
      const control = failure as { code?: string; superseded?: boolean };
      const ours =
        failure.message.startsWith("remote_brain_") ||
        control.code === "interrupted" ||
        control.code === "removed" ||
        control.superseded === true;
      finishOnce(ours ? failure : new Error("remote_brain_internal"));
    }
  } finally {
    if (!streamStarted && stillMine()) inFlight = false;
  }
}

export async function remoteSaveEngineSession(): Promise<boolean> {
  return false;
}

export async function remoteRestoreEngineSession(): Promise<boolean> {
  return false;
}

export async function remoteInvalidateEngineSession(): Promise<void> {
  return;
}

export async function remoteInvalidateConversationSessions(): Promise<void> {
  return;
}

export function remoteExtractMemory(): MemoryExtractResult {
  return {
    add: [],
    remove: [],
    parseOutcome: 0,
    durationMs: 0,
    timeoutMs: 0,
    stopReason: "skipped_no_snapshot",
  };
}

export async function remoteTranslateText(): Promise<{
  text: string;
  truncated: boolean;
}> {
  return { text: "", truncated: false };
}

export async function remoteCompleteOnce(): Promise<{
  text: string;
  aborted: boolean;
}> {
  return { text: "", aborted: true };
}
