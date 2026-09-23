/**
 * The exclusive overlay union, mounted exactly as the old shell mounted
 * them: Settings (NOT keyed — it owns its draft), Account, Pro, Documents,
 * Notes, Personas, Help (keyed on fontScaleId with the drawer), and the same
 * back wiring (Help returns to Settings; Settings' back refreshes memory
 * facts, tool flags and the context-size preview).
 *
 * Adaptations (reported): the mini-app sheet mounts here as
 * `HostMiniappSheet` — the controller's exclusive union is complete again
 * (the kind was held while no card could open it; see `hostOverlay.ts`);
 * model SELECT, retry and the MODEL download are real (the lifted switchers
 * plus `confirmDownload`), while the voice and embedding download buttons
 * keep serving `shell.notice.voiceDownload` / `shell.notice.embeddingDownload`
 * — held because the voice pipeline does not exist in this build;
 * `onRebuildSemanticIndex` needs the background embed job and answers
 * `{ok:false, reason:"unavailable"}` plus the same notice.
 *
 * The settings-presence scan mirrors `AppShell.tsx:5321-5344` exactly:
 * gated on Settings open (there is NO boot-time rescan in either app) and
 * re-run when `modelState` moves, writing UP into the download host's map.
 */
import { useEffect } from "react";
import { SettingsScreen } from "../screens/SettingsScreen";
import { AccountScreen } from "../screens/AccountScreen";
import { ProScreen } from "../screens/ProScreen";
import { DocumentsScreen } from "../screens/DocumentsScreen";
import { NotesScreen } from "../screens/NotesScreen";
import { PersonasScreen } from "../screens/PersonasScreen";
import { HelpScreen } from "../screens/HelpScreen";
import {
  EMBEDDING_MODEL,
  MODEL_REGISTRY,
  WHISPER_MODEL,
  formatBytes,
  type ModelInfo,
} from "../engine/ModelRegistry";
import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import { modelErrorHint } from "./modelBar";
import type { RebuildSemanticIndexResult } from "../screens/documents/DocumentDetailView";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import type { LibraryDoc, LibraryState } from "../documents/DocumentLibrary";
import type {
  EmbeddingPipelineState,
  ModelPipelineState,
  VoicePipelineState,
} from "../app/AppShell";
import { useLocale, type TranslationKey } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import type { HostOverlay } from "./hostOverlay";
import { HostMiniappSheet } from "./HostMiniappSheet";

export interface OverlaysProps {
  overlay: HostOverlay;
  setOverlay: (overlay: HostOverlay) => void;
  /** Show the one-line reason for a control this build does not wire. */
  onNotice: (key: TranslationKey) => void;
  /** The one-slot notice with a rendered string — the mini-app sheet's block
   *  actions speak strings, not catalogue keys (`miniappActions.ts`). */
  onNoticeText: (value: string) => void;
  refreshMemoryFacts: () => Promise<void>;
  refreshToolFlags: () => Promise<void>;
  webToolsEnabled: boolean;
  toggleWebTools: () => void;
  refreshContextSize: () => Promise<void>;
  currentModel: ModelInfo;
  modelState: ModelPipelineState;
  modelError: string | null;
  modelErrorDetail: string | null;
  modelErrorKind: "download" | "engine" | null;
  deviceBandwidth: DeviceBandwidthCalibration;
  streaming: boolean;
  selectModelById: (modelId: string) => void;
  userReloadModel: (model: ModelInfo) => void;
  /** The real confirm-then-transfer (controller `confirmDownload`, App:7132). */
  confirmDownload: (modelId: string) => void;
  /** 0-100 while downloading; null otherwise (controller App:7128). */
  downloadPercent: number | null;
  /** Presence map owned by the download host; the scan below writes into it. */
  downloadedById: Record<string, boolean>;
  onDownloadedScan: (map: Record<string, boolean>) => void;
  voiceState: VoicePipelineState;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  embeddingState: EmbeddingPipelineState;
  library: LibraryState;
  addDocument: (entry: LibraryDoc) => boolean;
  deleteDocument: (id: string) => Promise<boolean>;
  reorderDocuments: (orderedIds: string[]) => void;
  updateDocumentPreview: (id: string, previewUri: string) => void;
  isDocumentDeleteInFlight: () => boolean;
  setActivePersonaId: (id: string) => void;
  refreshPersonas: () => Promise<void>;
}

export function HostOverlays(props: OverlaysProps) {
  const {
    overlay,
    setOverlay,
    onNotice,
    onNoticeText,
    refreshMemoryFacts,
    refreshToolFlags,
    webToolsEnabled,
    toggleWebTools,
    refreshContextSize,
    currentModel,
    modelState,
    modelError,
    modelErrorDetail,
    modelErrorKind,
    deviceBandwidth,
    streaming,
    selectModelById,
    userReloadModel,
    confirmDownload,
    downloadPercent,
    downloadedById,
    onDownloadedScan,
    voiceState,
    ttsEnabled,
    setTtsEnabled,
    embeddingState,
    library,
    addDocument,
    deleteDocument,
    reorderDocuments,
    updateDocumentPreview,
    isDocumentDeleteInFlight,
    setActivePersonaId,
    refreshPersonas,
  } = props;
  const { t } = useLocale();
  const { fontScaleId } = useLabTheme<{ fontScaleId: string }>();

  // When Settings opens, scan which models are fully on disk — once per open
  // AND on every state change while open, the controller's deps
  // (`activeOverlay?.kind, modelState`, `App:5343`), writing up into the
  // download host so strip and Settings read one map.
  useEffect(() => {
    if (overlay?.kind !== "settings") return;
    let mounted = true;
    void (async () => {
      const entries = await Promise.all(
        MODEL_REGISTRY.map(async (m) => {
          try {
            const ok = await isModelBundleDownloaded(m);
            return [m.id, ok] as const;
          } catch {
            return [m.id, false] as const;
          }
        }),
      );
      const map: Record<string, boolean> = Object.fromEntries(entries);
      if (mounted) onDownloadedScan(map);
    })();
    return () => {
      mounted = false;
    };
  }, [overlay, modelState, onDownloadedScan]);

  // Extra guidance for connectivity-shaped failures plus the raw diagnostic
  // — the controller's single builder (`App:6725-6745`), shared with the
  // strip's hint row (`modelBar.ts`).
  const hint = modelErrorHint({ modelState, modelError, modelErrorDetail, t });

  if (overlay?.kind === "settings") {
    return (
      <SettingsScreen
        webToolsEnabled={webToolsEnabled}
        onToggleWebTools={toggleWebTools}
        onBack={() => {
          setOverlay(null);
          // Settings may have edited memory — refresh facts for the next turn.
          void refreshMemoryFacts();
          void refreshToolFlags();
          // The context size is an init input: pull it out of storage so the
          // pre-init estimate agrees with what the next load will pass.
          void refreshContextSize();
        }}
        onOpenHelp={() => setOverlay({ kind: "help" })}
        model={{
          currentModelId: currentModel.id,
          modelState,
          downloadPercent,
          modelError,
          modelErrorHint: hint,
          modelErrorKind,
          streaming,
          downloadedById,
          deviceBandwidth,
          onSelectModel: selectModelById,
          onDownloadModel: confirmDownload,
          onRetryLoad: () => {
            userReloadModel(currentModel);
          },
        }}
        voice={{
          state: voiceState,
          downloadPercent: null,
          error: null,
          ttsEnabled,
          modelName: WHISPER_MODEL.name,
          modelSizeLabel: formatBytes(WHISPER_MODEL.sizeBytes),
          onDownload: () => onNotice("shell.notice.voiceDownload"),
          onToggleTts: setTtsEnabled,
        }}
        embedding={{
          state: embeddingState,
          downloadPercent: null,
          error: null,
          modelName: EMBEDDING_MODEL.name,
          modelSizeLabel: formatBytes(EMBEDDING_MODEL.sizeBytes),
          onDownload: () => onNotice("shell.notice.embeddingDownload"),
        }}
      />
    );
  }
  if (overlay?.kind === "account") {
    return (
      <AccountScreen
        onBack={() => setOverlay(null)}
        onOpenPro={() => setOverlay({ kind: "pro" })}
      />
    );
  }
  if (overlay?.kind === "pro") {
    return <ProScreen onBack={() => setOverlay({ kind: "account" })} />;
  }
  if (overlay?.kind === "documents") {
    return (
      <DocumentsScreen
        key={fontScaleId}
        library={library}
        onAddDocument={addDocument}
        onDeleteDocument={deleteDocument}
        onRebuildSemanticIndex={async (): Promise<RebuildSemanticIndexResult> => {
          onNotice("shell.notice.semanticRebuild");
          return { ok: false, reason: "unavailable" };
        }}
        isSemanticRebuildBusy={false}
        onReorderDocuments={reorderDocuments}
        onUpdateDocumentPreview={updateDocumentPreview}
        isDocumentDeleteInFlight={isDocumentDeleteInFlight}
        onBack={() => setOverlay(null)}
      />
    );
  }
  if (overlay?.kind === "notes") {
    return (
      <NotesScreen
        key={fontScaleId}
        focusId={overlay.focusId}
        onBack={() => setOverlay(null)}
      />
    );
  }
  if (overlay?.kind === "personas") {
    return (
      <PersonasScreen
        key={fontScaleId}
        onBack={() => {
          setOverlay(null);
          void refreshPersonas();
        }}
        onActiveChange={setActivePersonaId}
      />
    );
  }
  if (overlay?.kind === "help") {
    return (
      <HelpScreen
        key={fontScaleId}
        // Back from Help returns to Settings (Help is opened from Settings).
        onBack={() => setOverlay({ kind: "settings" })}
      />
    );
  }
  if (overlay?.kind === "miniapp") {
    return (
      <HostMiniappSheet
        miniapp={overlay.miniapp}
        onClose={() => setOverlay(null)}
        onNoticeText={onNoticeText}
      />
    );
  }
  return null;
}
