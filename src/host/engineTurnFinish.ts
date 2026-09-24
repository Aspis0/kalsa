import type { LocalAttachment } from "./hostMessage";

export interface EngineTurnFinishDeps {
  isTurnOwner: () => boolean;
  activeDocumentAttachmentRef: { current: LocalAttachment | null };
  streamInFlightRef: { current: boolean };
  setStreaming: (streaming: boolean) => void;
  onMiniappRef: { current: (miniapp: unknown) => void };
  onFinished: () => void;
}

/** Settle one engine invocation while releasing shared state only for its owner. */
export function createEngineTurnFinish(deps: EngineTurnFinishDeps): () => void {
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    if (deps.isTurnOwner()) {
      deps.activeDocumentAttachmentRef.current = null;
      deps.streamInFlightRef.current = false;
      deps.setStreaming(false);
      // A stale completion must not clear a newer turn's miniapp callback.
      deps.onMiniappRef.current = () => {};
    }
    // Resolve the retired invocation even when it no longer owns host state.
    deps.onFinished();
  };
}
