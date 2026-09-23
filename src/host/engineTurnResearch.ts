import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { EngineTurnOptions } from "../engine/LlamaService";
import { getStrings, type Locale } from "../i18n";
import { runDeepResearch, type DeepResearchCompleteOnce } from "../research/deepResearch";
import type { LocalAttachment } from "./hostMessage";

export interface EngineResearchTurnInput {
  requested: boolean | undefined;
  remoteBackend: boolean;
  locale: Locale;
  text: string;
  attachments?: LocalAttachment[];
  docs: LibraryDoc[];
  executeTool?: EngineTurnOptions["executeTool"];
  completeOnce: DeepResearchCompleteOnce;
  nCtx: number;
  signal: AbortSignal;
  currentModelId: string;
  refuseRemote: () => void;
  onStatus: (status: { label: string }) => void;
  onDelta: (delta: string, full: string) => void;
  finish: () => void;
  invalidateSession: (modelId: string) => void;
}

/** Run the engine's research phase only for a local turn; remote tools stay unreachable. */
export async function runEngineResearchTurn(
  input: EngineResearchTurnInput,
): Promise<boolean> {
  if (!input.requested) return false;
  if (input.remoteBackend) {
    input.refuseRemote();
    input.finish();
    return true;
  }

  const libraryDocs = input.docs;
  const attachedDocIds = (input.attachments ?? [])
    .filter((attachment) => attachment.kind === "document" && typeof attachment.libraryDocId === "string" && attachment.libraryDocId)
    .map((attachment) => attachment.libraryDocId as string);
  const filtered = attachedDocIds.length
    ? libraryDocs.filter((doc) => attachedDocIds.includes(doc.id) || attachedDocIds.includes(doc.sourceId))
    : [];
  if (attachedDocIds.length > 0 && filtered.length === 0) {
    const missing = getStrings(input.locale).errors.deepResearchAttachedMissing ??
      "The attached documents are no longer in the library. Add them back and send again.";
    input.onDelta(missing, missing);
    input.finish();
    return true;
  }

  const question = String(input.text ?? "")
    .replace(/\[document:[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const outcome = await runDeepResearch({
    question,
    locale: input.locale,
    docs: filtered.length > 0 ? filtered : libraryDocs,
    execute: (name, args, toolSignal) => input.executeTool
      ? input.executeTool(name, args, toolSignal, input.text)
      : Promise.resolve({ strategy: "error", error: "no executor" }),
    completeOnce: input.completeOnce,
    nCtx: input.nCtx,
    signal: input.signal,
    callbacks: {
      onStatus: input.onStatus,
      onDelta: input.onDelta,
    },
  });
  if (outcome.kind !== "aborted" && !input.signal.aborted) {
    input.invalidateSession(input.currentModelId);
  }
  input.finish();
  return true;
}
