/**
 * The furniture the root arranges around the chat: the exclusive overlay
 * union, the notice toast — extracted from `HostRoot.tsx` (the root may only
 * compose). It returns a FRAGMENT, never a wrapping View, so its children
 * stay direct children of the root's flex column exactly as before: the
 * overlay screens paint over the shell, and the notice keeps its absolute
 * slot. The root's own state (`activeOverlay`, the notice slot) stays in the
 * root; this file only assembles each child's props from the host hooks.
 *
 * It also mounts `PdfTextExtractorHost` — the furniture the OLD root mounted
 * at `AppShell.tsx:7257` and this shell never did, so `requestPdfText`
 * rejected `no_host` and the PDF library import plus `document_chat`'s PDF
 * path failed (PARITY-STATUS gap 12). It takes NO props: it registers its
 * own bridge on mount and sweeps its own stale cache, so here it is one
 * unkeyed line (never keyed: it must survive a font-scale change, the old
 * root's own rule at `AppShell.tsx:6790`).
 */
import { PdfTextExtractorHost } from "../pdf/PdfTextExtractorHost";
import { HostNotice } from "./HostNotice";
import { HostOverlays } from "./HostOverlays";
import type { HostOverlay } from "./hostOverlay";
import type { useConversationHost } from "./useConversationHost";
import type { useLibraryHost } from "./libraryHost";
import type { useMemoryHost } from "./memoryHost";
import type { usePersonasHost } from "./personasHost";
import type { useToolFlags } from "./toolFlags";
import type { useHostEngine } from "./useHostEngine";
import type { TranslationKey } from "../i18n";

type MemoryHost = ReturnType<typeof useMemoryHost>;
type ToolFlags = ReturnType<typeof useToolFlags>;
type LibraryHost = ReturnType<typeof useLibraryHost>;
type PersonasHost = ReturnType<typeof usePersonasHost>;
type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];

export interface HostFurnitureProps {
  overlay: HostOverlay;
  setOverlay: (overlay: HostOverlay) => void;
  onNotice: (key: TranslationKey) => void;
  /** Rendered text of the one-slot notice, or null. */
  notice: string | null;
  memory: MemoryHost;
  flags: ToolFlags;
  library: LibraryHost;
  personas: PersonasHost;
  modelHost: ModelHost;
  streaming: boolean;
}

export function HostFurniture({
  overlay,
  setOverlay,
  onNotice,
  notice,
  memory,
  flags,
  library,
  personas,
  modelHost,
  streaming,
}: HostFurnitureProps) {
  return (
    <>
      <HostOverlays
        overlay={overlay}
        setOverlay={setOverlay}
        onNotice={onNotice}
        refreshMemoryFacts={memory.refreshMemoryFacts}
        refreshToolFlags={flags.refreshToolFlags}
        refreshContextSize={modelHost.refreshContextSize}
        currentModel={modelHost.currentModel}
        modelState={modelHost.modelState}
        modelError={modelHost.modelError}
        modelErrorDetail={modelHost.modelErrorDetail}
        modelErrorKind={modelHost.modelErrorKind}
        deviceBandwidth={modelHost.deviceBandwidth}
        streaming={streaming}
        selectModelById={modelHost.selectModelById}
        userReloadModel={modelHost.userReloadModel}
        voiceState={modelHost.scans.voiceState}
        ttsEnabled={modelHost.scans.ttsEnabled}
        setTtsEnabled={modelHost.scans.setTtsEnabled}
        embeddingState={modelHost.scans.embeddingState}
        library={library.library}
        addDocument={library.addDocument}
        deleteDocument={library.deleteDocument}
        reorderDocuments={library.reorderDocuments}
        updateDocumentPreview={library.updateDocumentPreview}
        isDocumentDeleteInFlight={library.isDocumentDeleteInFlight}
        setActivePersonaId={personas.setActivePersonaId}
        refreshPersonas={personas.refreshPersonas}
      />
      <HostNotice text={notice} />
      {/* Unkeyed furniture, as in the old root (AppShell:7255-7257). */}
      <PdfTextExtractorHost />
    </>
  );
}
