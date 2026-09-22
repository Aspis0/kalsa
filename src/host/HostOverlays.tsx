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
 * model SELECT and retry
 * are real (the lifted switchers), while the three DOWNLOAD buttons serve
 * `shell.notice.*` — the download paths stayed behind with a report;
 * `onRebuildSemanticIndex` needs the background embed job and answers
 * `{ok:false, reason:"unavailable"}` plus the same notice.
 */
import { useEffect, useState } from "react";
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
  const [downloadedById, setDownloadedById] = useState<Record<string, boolean>>({});

  // When Settings opens, scan which models are fully on disk (once per open).
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
      if (mounted) setDownloadedById(Object.fromEntries(entries));
    })();
    return () => {
      mounted = false;
    };
  }, [overlay]);

  // Extra guidance for connectivity-shaped failures (keep-open hint), plus the
  // raw download error as an untranslated diagnostic when it differs from the
  // friendly message.
  const modelErrorHint = (() => {
    if (modelState !== "error") return null;
    const isConnectivity =
      !!modelError &&
      (modelError === t("errors.connectionLost") ||
        modelError === t("errors.networkUnreachable"));
    const detailBody = modelErrorDetail
      ? modelErrorDetail.replace(/^(?:[A-Za-z]+Error?|Error):\s*/, "")
      : null;
    const raw =
      modelErrorDetail && detailBody !== modelError ? modelErrorDetail : null;
    if (isConnectivity) {
      const keepOpen = t("download.keepOpenHint");
      return raw ? `${raw} — ${keepOpen}` : keepOpen;
    }
    return raw;
  })();

  if (overlay?.kind === "settings") {
    return (
      <SettingsScreen
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
          // No download pipeline in this build: never mid-download.
          downloadPercent: null,
          modelError,
          modelErrorHint,
          modelErrorKind,
          streaming,
          downloadedById,
          deviceBandwidth,
          onSelectModel: selectModelById,
          onDownloadModel: () => onNotice("shell.notice.download"),
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
