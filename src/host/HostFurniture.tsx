/**
 * The furniture the root arranges around the chat: the exclusive overlay
 * union, the notice toast. Returns a FRAGMENT, never a wrapping View, so its
 * children stay direct children of the root's flex column: the overlay
 * screens paint over the shell, and the notice keeps its absolute slot. The
 * root's own state stays in the root; this file only assembles each child's
 * props from the host hooks.
 *
 * It also mounts `PdfTextExtractorHost` — the furniture the OLD root mounted
 * and this shell never did, so `requestPdfText` rejected `no_host` and the
 * PDF library import plus `document_chat`'s PDF path failed (PARITY-STATUS
 * gap 12). It takes NO props: it registers its own bridge on mount and sweeps
 * its own stale cache, so here it is one unkeyed line (never keyed: it must
 * survive a font-scale change).
 */
import { PdfTextExtractorHost } from "../pdf/PdfTextExtractorHost";
import { progressPercent } from "./modelBar";
import { HostNotice } from "./HostNotice";
import { HostOverlays } from "./HostOverlays";
import type { HostOverlay } from "./hostOverlay";
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
  /** The one-slot notice with a rendered string (the mini-app sheet's block
   *  actions speak strings, not catalogue keys). */
  onNoticeText: (value: string) => void;
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
  onNoticeText,
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
        onNoticeText={onNoticeText}
        refreshMemoryFacts={memory.refreshMemoryFacts}
        refreshToolFlags={flags.refreshToolFlags}
        webToolsEnabled={flags.webToolsEnabled}
        toggleWebTools={flags.toggleWebTools}
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
        confirmDownload={modelHost.confirmDownload}
        downloadPercent={
          modelHost.modelState === "downloading"
            ? progressPercent(modelHost.download?.progress ?? null)
            : null
        }
        downloadedById={modelHost.downloadedById}
        onDownloadedScan={modelHost.applyDownloadedScan}
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
      {/* Unkeyed: must survive a font-scale change. */}
      <PdfTextExtractorHost />
    </>
  );
}
