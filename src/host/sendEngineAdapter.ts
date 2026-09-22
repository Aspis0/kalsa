/**
 * The engine adapter of one send: the closure `runSendStream` drives —
 * MOVED OUT of `sendHost.ts`, which the attachment snapshot pushed past its
 * 350-line ratchet (`fileSize.test.ts`): a seam, not a redesign. Every
 * argument below is the one the send file used to inline, including the
 * frozen attachment snapshot handed to the lifted engine half.
 *
 * The history handed to assembly is the PRE-append snapshot: the just-sent
 * turn is appended by the engine half itself (`request.history`) and must
 * not be double-counted by the caller.
 */
import { handleSendStream } from "./engineTurn";
import type { EngineTurnCallbacks, EngineTurnDeps } from "./engineTurnDeps";
import type { RichCallbacks } from "./sendCallbacks";
import type { SendEngine } from "./sendStream";
import type { LocalAttachment } from "./hostMessage";

export interface SendEngineAdapter {
  engineDeps: EngineTurnDeps;
  rich: RichCallbacks;
  /** The frozen snapshot as the engine half's fifth argument: images and
   *  PDF pages for vision, the library document for `document_chat`
   *  (`engineTurn.ts` sets `activeDocumentAttachmentRef` from it). */
  attachments: LocalAttachment[];
}

export function createSendEngine(adapter: SendEngineAdapter): SendEngine {
  const { engineDeps, rich, attachments } = adapter;
  return (request, emit, signal) =>
    handleSendStream(
      engineDeps,
      request.text,
      {
        ...rich.callbacks,
        onDelta: (delta, full) => emit.onDelta(delta, full),
        onFailed: (reasonKey) => emit.onFailed?.(reasonKey),
        // Sources ride the emit path so the run layer drops them after
        // the terminal result; the rich copy is not called twice.
        onSources: (sources) => emit.onSources?.(sources),
      } as EngineTurnCallbacks,
      signal,
      attachments,
      request.history as unknown[] | undefined,
      undefined,
      request.options
        ? {
            research: request.options.research,
            notes: request.options.notes,
            onNotice: request.options.onNotice,
          }
        : undefined,
    );
}
