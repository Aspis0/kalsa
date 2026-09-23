import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import { Check, ChevronRight, CircleQuestionMark, Pencil, Trash2, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  EmbeddingPipelineState,
  ModelPipelineState,
  VoicePipelineState,
} from "../app/AppShell";
import { useLocale, type TranslationKey } from "../i18n";
import {
  getActiveProviderId,
  getSecret,
  PROVIDER_IDS,
  PROVIDERS,
  setActiveProviderId,
  setSecret,
  type SearchProviderId,
} from "../search";
import {
  MODEL_REGISTRY,
  formatBytes,
  type ModelInfo,
} from "../engine/ModelRegistry";
import { isEmbedderHung } from "../engine/EmbeddingService";
import {
  getDeviceTotalMemoryBytes,
  getRamTier,
  ramTierMeets,
  recommendedModelId,
  resolveContextProfile,
} from "../engine/contextProfile";
import {
  diskRequirementBytes,
  evaluateModelFit,
  getCachedDeviceProfile,
  getFreeDiskBytes,
  modelGateVerdict,
  type DeviceProfile,
  type ModelGateVerdict,
} from "../engine/deviceProfile";
import { gateCacheOptionFit, gateContextOptionFit, gateNonEvictableMiB, optionAvailability } from "../engine/modelGateRAM";
import { resolveGateLoadPolicy } from "../engine/loadPolicy";
import { readGovernorEnabled, writeGovernorEnabled } from "../engine/governorRuntime";
import { resolveEngineTuningSync } from "../engine/deviceTuning";
import { kvBytesPerTokenAtProfile, modelAtKvProfile } from "../engine/kvQuantCost";
import {
  contextSizeChoices,
  contextSizeOutcome,
  readUserContextSize,
  resolveRequestedContextTokens,
  writeUserContextSize,
} from "../engine/contextSizePref";
import {
  KV_CACHE_CHOICES,
  kvCacheChoiceById,
  readKvCacheChoice,
  writeKvCacheChoice,
  type KvCacheChoiceId,
} from "../engine/kvCachePref";
import {
  deviceBandwidthForModel,
  type DeviceBandwidthCalibration,
} from "../engine/deviceThroughput";
import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { useProcessHealth } from "../hooks/useProcessHealth";
import { useThermalMonitor } from "../hooks/useThermalMonitor";
import * as MemoryStore from "../memory/MemoryStore";
import type { MemoryFact } from "../memory/MemoryStore";
import { PROMPT_FACT_CHARS } from "../memory/dnaBounding";
import {
  CISWIRE_TOOLHELP_KEY,
  COMPACTION_CHOICE_KEY,
  COMPACTION_ENABLED_KEY,
  parseContextMode,
  type ContextMode,
} from "../context/compactor";
import {
  COMPACTION_ENABLED_DEFAULT,
  getCiswireToolHelp,
  parseCompactionEnabled,
} from "../engine/ttftFlags";
import {
  DEFAULT_SESSION_POOL_CONVERSATIONS,
  parseSessionPoolConversations,
  SESSION_POOL_CONVERSATION_OPTIONS,
  SESSION_POOL_STORAGE_KEY,
  type SessionPoolConversationOption,
} from "../engine/sessionBudget";
import {
  CALENDAR_TOOLS_KEY,
  DEVICE_TOOLS_KEY,
  parseToolToggle,
} from "../agent/toolToggles";
import { getBenchNCtx, getBenchNoRepack, getEngineOverride, getThinkingMode, setThinkingMode, type ThinkingMode } from "../bench/benchConfig";
import { GlassPanel2 } from "../theme/components";
import { OrphanModelMigrationBanner } from "../components/OrphanModelMigrationBanner";
import { radius, spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { SettingsHomeScreen } from "./SettingsHomeScreen";

export type SettingsModelProps = {
  currentModelId: string;
  modelState: ModelPipelineState;
  /** 0–100 while downloading; null otherwise. */
  downloadPercent: number | null;
  modelError: string | null;
  /** Extra guidance for connectivity-shaped failures (e.g. "keep the app open"); null otherwise. */
  modelErrorHint: string | null;
  /** Discriminates download vs engine-init errors when modelState === "error". */
  modelErrorKind: "download" | "engine" | null;
  /** True while an assistant stream is in flight — Select is disabled. */
  streaming: boolean;
  /** Presence map from a one-shot disk scan (keys appear after scan). */
  downloadedById: Record<string, boolean>;
  /** Per-quant device calibration; empty means speed is unknown. */
  deviceBandwidth: DeviceBandwidthCalibration;
  onSelectModel: (modelId: string) => void;
  onDownloadModel: (modelId: string) => void;
  /** Retry engine init when the bundle is already on disk. */
  onRetryLoad: () => void;
};

export type SettingsVoiceProps = {
  state: VoicePipelineState;
  /** 0–100 while downloading; null otherwise. */
  downloadPercent: number | null;
  error: string | null;
  ttsEnabled: boolean;
  modelName: string;
  modelSizeLabel: string;
  onDownload: () => void;
  onToggleTts: (enabled: boolean) => void;
};

/** Optional embedding model (hybrid document search) — download only. */
export type SettingsEmbeddingProps = {
  state: EmbeddingPipelineState;
  /** 0–100 while downloading; null otherwise. */
  downloadPercent: number | null;
  error: string | null;
  modelName: string;
  modelSizeLabel: string;
  onDownload: () => void;
};

type Props = {
  onBack: () => void;
  /** Open Help overlay (AppShell sets activeOverlay to { kind: "help" }). */
  onOpenHelp: () => void;
  /** Open the Kalsa Pro overlay from the Settings home page. */
  onOpenPro?: () => void;
  webToolsEnabled?: boolean;
  onToggleWebTools?: () => void;
  model: SettingsModelProps;
  voice: SettingsVoiceProps;
  embedding: SettingsEmbeddingProps;
};

/** App version from Expo config; fallback keeps the Kalsa card usable in tests. */
const APP_VERSION = Constants.expoConfig?.version ?? "0.1.0";

const PROVIDER_LABEL_KEYS: Record<SearchProviderId, TranslationKey> = {
  "exa-mcp": "settings.providerExaMcp",
  exa: "settings.providerExa",
  brave: "settings.providerBrave",
  tavily: "settings.providerTavily",
};

function modelBundleSize(model: ModelInfo): number {
  return model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
}

type MemoryNotice = {
  message: string;
  kind: "success" | "warning";
};

/**
 * Settings — full-screen View overlay opened from the drawer.
 * Not a Modal: Android hardware back is handled here (dirty confirm for websearch).
 */
export function SettingsScreen({ onBack, onOpenHelp, onOpenPro, webToolsEnabled, onToggleWebTools, model, voice, embedding }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocale();
  const [page, setPage] = useState<"home" | "advanced">("home");

  // Production "default" is thinking-on with the model's short budget.
  // The picker shows the two user-facing live budgets.
  const thinkingOptions: Array<{ id: ThinkingMode; label: string }> = [
    { id: "budget256", label: t("settings.thinkingShort") },
    { id: "budget512", label: t("settings.thinkingExtended") },
  ];

  const [providerId, setProviderId] = useState<SearchProviderId>("exa-mcp");
  const [apiKey, setApiKey] = useState("");
  /** Last successfully saved snapshot — used for dirty detection. */
  const [savedProviderId, setSavedProviderId] = useState<SearchProviderId>("exa-mcp");
  const [savedApiKey, setSavedApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  // ── Context compaction (ConversationCompactor — default ON) ─────────────
  const [compactionEnabled, setCompactionEnabled] = useState(COMPACTION_ENABLED_DEFAULT);
  const [compactionMode, setCompactionMode] = useState<ContextMode>("anchored");

  // ── KV session pool size (conversation count, not megabytes) ─────────────
  const [sessionPoolChats, setSessionPoolChats] = useState<SessionPoolConversationOption>(
    DEFAULT_SESSION_POOL_CONVERSATIONS,
  );

  // ── Engine memory choices (context size + KV cache precision) ────────────
  // Both are init inputs: the next load reads them, so a change applies then.
  const [userContextSize, setUserContextSize] = useState<number | null>(null);
  const [kvCacheChoiceId, setKvCacheChoiceId] = useState<KvCacheChoiceId | null>(null);
  /** kalsa.bench.nctx: a dev lever that outranks the setting — grade what loads. */
  const [benchNCtx, setBenchNCtx] = useState<number | null>(null);
  /** Dev load-mode levers, read once: the panel prices the mode init will use. */
  const [benchNoRepack, setBenchNoRepack] = useState<boolean | undefined>(undefined);
  const [benchUseMmap, setBenchUseMmap] = useState<boolean | undefined>(undefined);

  // ── Telemetry opt-in (default OFF) ───────────────────────────────────────
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [telemetryBusy, setTelemetryBusy] = useState(false);

  // ── Per-phase thermal governor (experimental; consulted at model load) ────
  const [governorEnabled, setGovernorEnabled] = useState(false);

  // ── Thinking mode (bench/benchConfig — same storage key as /bench thinking) ──
  const [thinkingMode, setThinkingModeState] = useState<ThinkingMode>("default");

  // ── Local memory (facts) ─────────────────────────────────────────────────
  // OPT-IN: default off until storage says otherwise.
  const [deviceToolsEnabled, setDeviceToolsEnabled] = useState(true);
  const [calendarToolsEnabled, setCalendarToolsEnabled] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [ciswireToolHelpEnabled, setCiswireToolHelpEnabled] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState<MemoryNotice | null>(null);
  const mountedRef = useRef(true);
  const memoryAddInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reloadMemory = useCallback(async () => {
    try {
      const [enabled, facts] = await Promise.all([
        MemoryStore.getEnabled(),
        MemoryStore.listFacts(),
      ]);
      if (!mountedRef.current) return;
      setMemoryEnabled(enabled);
      setMemoryFacts(facts);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void reloadMemory();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void reloadMemory();
    });
    return () => subscription.remove();
  }, [reloadMemory]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tel = require("../telemetry/telemetry") as {
          getTelemetryEnabled: () => Promise<boolean>;
        };
        const on = await tel.getTelemetryEnabled();
        if (mounted) setTelemetryEnabled(on);
      } catch {
        if (mounted) setTelemetryEnabled(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggleTelemetry = useCallback(
    (next: boolean) => {
      if (telemetryBusy) return;
      if (!next) {
        setTelemetryBusy(true);
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const tel = require("../telemetry/telemetry") as {
              setTelemetryEnabled: (v: boolean) => Promise<boolean>;
            };
            await tel.setTelemetryEnabled(false);
            if (mountedRef.current) setTelemetryEnabled(false);
          } catch {
            if (mountedRef.current) setTelemetryEnabled(false);
          } finally {
            if (mountedRef.current) setTelemetryBusy(false);
          }
        })();
        return;
      }
      // Opt-in Alert with honest copy
      Alert.alert(
        t("settings.telemetryOptInTitle"),
        t("settings.telemetryOptInBody"),
        [
          {
            text: t("settings.telemetryOptInCancel"),
            style: "cancel",
            onPress: () => {
              setTelemetryEnabled(false);
            },
          },
          {
            text: t("settings.telemetryOptInConfirm"),
            onPress: () => {
              setTelemetryBusy(true);
              void (async () => {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const tel = require("../telemetry/telemetry") as {
                    setTelemetryEnabled: (v: boolean) => Promise<boolean>;
                  };
                  const ok = await tel.setTelemetryEnabled(true);
                  if (mountedRef.current) setTelemetryEnabled(ok);
                } catch {
                  if (mountedRef.current) setTelemetryEnabled(false);
                } finally {
                  if (mountedRef.current) setTelemetryBusy(false);
                }
              })();
            },
          },
        ],
      );
    },
    [t, telemetryBusy],
  );

  const handleReportProblem = useCallback(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tel = require("../telemetry/telemetry") as {
        buildManualReportPreview: () => unknown;
        formatManualReportPreview: (r: unknown) => string;
        GITHUB_ISSUE_CHOOSE_URL: string;
      };
      const report = tel.buildManualReportPreview();
      const preview = report
        ? tel.formatManualReportPreview(report as never)
        : "(no report)";
      Alert.alert(
        t("settings.reportProblem"),
        t("settings.reportProblemBody") + "\n\n" + preview.slice(0, 900),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("settings.reportCopy"),
            onPress: () => {
              void Clipboard.setStringAsync(preview)
                .then(() => {
                  Alert.alert(t("settings.reportCopied"));
                })
                .catch(() => undefined);
            },
          },
          {
            text: t("settings.reportOpenGitHub"),
            onPress: () => {
              void Linking.openURL(tel.GITHUB_ISSUE_CHOOSE_URL).catch(
                () => undefined,
              );
            },
          },
        ],
      );
    } catch {
      /* ignore */
    }
  }, [t]);

  useEffect(() => {
    let mounted = true;
    // Read only — never persist visual-off as "0" on first paint.
    void Promise.all([
      AsyncStorage.getItem(COMPACTION_ENABLED_KEY),
      AsyncStorage.getItem(COMPACTION_CHOICE_KEY),
      getCiswireToolHelp(),
    ])
      .then(([raw, choice, toolHelp]) => {
        if (!mounted) return;
        setCompactionMode(parseContextMode(raw));
        setCompactionEnabled(parseCompactionEnabled(raw, choice === "1"));
        setCiswireToolHelpEnabled(toolHelp);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      AsyncStorage.getItem(DEVICE_TOOLS_KEY),
      AsyncStorage.getItem(CALENDAR_TOOLS_KEY),
    ])
      .then(([deviceRaw, calendarRaw]) => {
        if (!mounted) return;
        setDeviceToolsEnabled(parseToolToggle(deviceRaw, true));
        setCalendarToolsEnabled(parseToolToggle(calendarRaw, false));
      })
      .catch(() => undefined);
    // readGovernorEnabled never rejects (it catches internally).
    void readGovernorEnabled().then((on) => {
      if (mounted) setGovernorEnabled(on);
    });
    void readUserContextSize().then((nCtx) => {
      if (mounted) setUserContextSize(nCtx);
    });
    void readKvCacheChoice().then((choice) => {
      if (mounted) setKvCacheChoiceId(choice?.id ?? null);
    });
    void getBenchNCtx().then((nCtx) => {
      if (mounted) setBenchNCtx(nCtx);
    });
    void getBenchNoRepack().then((flag) => {
      if (mounted) setBenchNoRepack(flag);
    });
    void getEngineOverride().then((override) => {
      if (mounted) setBenchUseMmap(override?.useMmap);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggleDeviceTools = useCallback((next: boolean) => {
    const previous = deviceToolsEnabled;
    setDeviceToolsEnabled(next);
    void AsyncStorage.setItem(DEVICE_TOOLS_KEY, next ? "1" : "0").catch(() => {
      if (mountedRef.current) setDeviceToolsEnabled(previous);
    });
  }, [deviceToolsEnabled]);

  const handleToggleCalendarTools = useCallback((next: boolean) => {
    const previous = calendarToolsEnabled;
    setCalendarToolsEnabled(next);
    void AsyncStorage.setItem(CALENDAR_TOOLS_KEY, next ? "1" : "0").catch(() => {
      if (mountedRef.current) setCalendarToolsEnabled(previous);
    });
  }, [calendarToolsEnabled]);

  // writeGovernorEnabled never rejects; it reports whether the write persisted,
  // so the switch rolls back when persistence failed.
  const handleToggleGovernor = useCallback((next: boolean) => {
    setGovernorEnabled(next);
    void writeGovernorEnabled(next).then((persisted) => {
      if (!persisted && mountedRef.current) setGovernorEnabled(!next);
    });
  }, []);

  // Single writer of COMPACTION_ENABLED_KEY (raw 'off' | 'anchored' | 'ciswire').
  // Also stamps COMPACTION_CHOICE_KEY='1'; on failure rolls back all affected state.
  const handleSelectCompactionMode = useCallback(
    (next: ContextMode) => {
      const previousMode = compactionMode;
      const previousEnabled = compactionEnabled;
      setCompactionMode(next);
      setCompactionEnabled(next !== "off");
      void AsyncStorage.multiSet([
        [COMPACTION_ENABLED_KEY, next],
        [COMPACTION_CHOICE_KEY, "1"],
      ]).catch(() => {
        if (!mountedRef.current) return;
        setCompactionMode(previousMode);
        setCompactionEnabled(previousEnabled);
      });
    },
    [compactionEnabled, compactionMode],
  );

  const handleToggleCiswireToolHelp = useCallback(
    (next: boolean) => {
      const previous = ciswireToolHelpEnabled;
      setCiswireToolHelpEnabled(next);
      void AsyncStorage.setItem(CISWIRE_TOOLHELP_KEY, next ? "1" : "0").catch(() => {
        if (mountedRef.current) setCiswireToolHelpEnabled(previous);
      });
    },
    [ciswireToolHelpEnabled],
  );

  // Both writers report whether the write landed; a failed write rolls the
  // selection back, so the row never shows a choice that was not persisted.
  const handleSelectContextSize = useCallback(
    (nCtx: number, modelContextLength?: number | null) => {
      const previous = userContextSize;
      setUserContextSize(nCtx);
      void writeUserContextSize(nCtx, modelContextLength).then((persisted) => {
        if (!persisted && mountedRef.current) setUserContextSize(previous);
      });
    },
    [userContextSize],
  );

  const handleSelectKvCache = useCallback(
    (id: KvCacheChoiceId) => {
      const previous = kvCacheChoiceId;
      setKvCacheChoiceId(id);
      void writeKvCacheChoice(id).then((persisted) => {
        if (!persisted && mountedRef.current) setKvCacheChoiceId(previous);
      });
    },
    [kvCacheChoiceId],
  );

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(SESSION_POOL_STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        setSessionPoolChats(parseSessionPoolConversations(raw));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectSessionPoolChats = useCallback(
    (next: SessionPoolConversationOption) => {
      const previous = sessionPoolChats;
      setSessionPoolChats(next);
      void AsyncStorage.setItem(SESSION_POOL_STORAGE_KEY, String(next)).catch(() => {
        if (mountedRef.current) setSessionPoolChats(previous);
      });
    },
    [sessionPoolChats],
  );

  useEffect(() => {
    let mounted = true;
    getThinkingMode()
      .then((mode) => {
        if (!mounted) return;
        setThinkingModeState(mode);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  // "default" renders as Short (production = model's short budget).
  const effectiveThinkingSelection: ThinkingMode =
    thinkingMode === "default" ? "budget256" : thinkingMode;

  const handleSelectThinkingMode = useCallback(
    (mode: ThinkingMode) => {
      if (mode === effectiveThinkingSelection) return;
      const previous = thinkingMode;
      setThinkingModeState(mode);
      void (async () => {
        try {
          const ok = await setThinkingMode(mode);
          if (!ok && mountedRef.current) setThinkingModeState(previous);
        } catch {
          if (mountedRef.current) setThinkingModeState(previous);
        }
      })();
    },
    [effectiveThinkingSelection, thinkingMode],
  );

  const handleToggleMemory = useCallback(
    (next: boolean) => {
      const previous = memoryEnabled;
      setMemoryEnabled(next);
      setMemoryNotice(null);
      void (async () => {
        try {
          await MemoryStore.setEnabled(next);
        } catch {
          if (!mountedRef.current) return;
          setMemoryEnabled(previous);
          setMemoryNotice({ message: t("memory.saveError"), kind: "warning" });
        }
      })();
    },
    [memoryEnabled, t],
  );

  const handleAddMemoryFact = useCallback(async () => {
    const text = memoryDraft.trim();
    if (!text || memoryAddInFlightRef.current) return;
    memoryAddInFlightRef.current = true;
    setMemoryBusy(true);
    setMemoryNotice(null);
    try {
      await MemoryStore.addFact(text);
      if (!mountedRef.current) return;
      setMemoryDraft("");
      await reloadMemory();
      if (!mountedRef.current) return;
      setMemoryNotice({ message: t("memory.addDone"), kind: "success" });
    } catch (error) {
      if (!mountedRef.current) return;
      setMemoryNotice({
        message:
          error instanceof MemoryStore.MemoryCapacityError
            ? t("memory.full", { count: MemoryStore.MAX_FACTS })
            : t("memory.saveError"),
        kind: "warning",
      });
    } finally {
      memoryAddInFlightRef.current = false;
      if (mountedRef.current) setMemoryBusy(false);
    }
  }, [memoryDraft, reloadMemory, t]);

  const handleStartEditingMemoryFact = useCallback(
    (fact: MemoryFact) => {
      if (memoryBusy) return;

      if (editingFactId === fact.id) return;

      const currentFact = memoryFacts.find((candidate) => candidate.id === editingFactId);
      if (currentFact && editingText.trim() !== currentFact.text) {
        Alert.alert(t("settings.unsavedTitle"), t("settings.unsavedBody"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("settings.discard"),
            style: "destructive",
            onPress: () => {
              setEditingFactId(fact.id);
              setEditingText(fact.text);
              setMemoryNotice(null);
            },
          },
        ]);
        return;
      }

      setEditingFactId(fact.id);
      setEditingText(fact.text);
      setMemoryNotice(null);
    },
    [editingFactId, editingText, memoryBusy, memoryFacts, t],
  );

  const handleCancelEditingMemoryFact = useCallback(() => {
    if (memoryBusy) return;
    setEditingFactId(null);
    setEditingText("");
  }, [memoryBusy]);

  const handleSaveMemoryFact = useCallback(
    async (fact: MemoryFact) => {
      if (editingFactId !== fact.id || memoryBusy) return;
      if (!editingText.trim()) {
        handleCancelEditingMemoryFact();
        setMemoryNotice({ message: t("memory.editEmpty"), kind: "warning" });
        return;
      }

      setMemoryBusy(true);
      setMemoryNotice(null);
      try {
        await MemoryStore.updateFact(fact.id, editingText);
        if (!mountedRef.current) return;
        await reloadMemory();
        if (!mountedRef.current) return;
        setEditingFactId(null);
        setEditingText("");
        setMemoryNotice({ message: t("memory.editDone"), kind: "success" });
      } catch (error) {
        if (!mountedRef.current) return;
        setMemoryNotice({
          message:
            error instanceof MemoryStore.MemoryDuplicateError
              ? t("memory.editDuplicate")
              : t("memory.saveError"),
          kind: "warning",
        });
      } finally {
        if (mountedRef.current) setMemoryBusy(false);
      }
    },
    [editingFactId, editingText, handleCancelEditingMemoryFact, memoryBusy, reloadMemory, t],
  );

  const handleDeleteMemoryFact = useCallback(
    (fact: MemoryFact) => {
      if (memoryBusy) return;
      Alert.alert(t("memory.deleteFact"), fact.text, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("memory.deleteFact"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await MemoryStore.removeFact(fact.id);
                await reloadMemory();
                if (!mountedRef.current) return;
                setEditingFactId(null);
                setEditingText("");
                setMemoryNotice(null);
              } catch {
                if (!mountedRef.current) return;
                setMemoryNotice({ message: t("memory.saveError"), kind: "warning" });
              }
            })();
          },
        },
      ]);
    },
    [memoryBusy, reloadMemory, t],
  );

  const handleClearMemory = useCallback(() => {
    Alert.alert(t("memory.clear"), t("memory.clearConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("memory.clear"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await MemoryStore.clearFacts();
              await reloadMemory();
              if (!mountedRef.current) return;
              setMemoryNotice({ message: t("memory.clearDone"), kind: "success" });
            } catch {
              if (!mountedRef.current) return;
              setMemoryNotice({ message: t("memory.saveError"), kind: "warning" });
            }
          })();
        },
      },
    ]);
  }, [reloadMemory, t]);

  /** Generation counter: ignore out-of-order SecureStore reads after rapid provider switches. */
  const loadGen = useRef(0);
  /** Locale ref so load helpers always use the latest locale without re-running effects. */
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const meta = PROVIDERS[providerId];
  const needsKey = meta.needsKey;
  const busy = loading || saving;
  const modelBusy =
    model.modelState === "downloading" ||
    model.modelState === "loading" ||
    model.modelState === "checking" ||
    model.streaming;

  const dirty = useMemo(() => {
    if (providerId !== savedProviderId) return true;
    if (needsKey && apiKey !== savedApiKey) return true;
    return false;
  }, [apiKey, needsKey, providerId, savedApiKey, savedProviderId]);

  /** Load API key for a provider; does NOT re-run on locale change. */
  const loadKeyForProvider = useCallback(async (id: SearchProviderId) => {
    const gen = ++loadGen.current;
    setLoading(true);
    setStatus("idle");
    setStatusMessage("");
    try {
      if (PROVIDERS[id].needsKey) {
        const secret = await getSecret(id, localeRef.current);
        if (gen !== loadGen.current) return;
        setApiKey(secret ?? "");
      } else {
        if (gen !== loadGen.current) return;
        setApiKey("");
      }
    } catch (err) {
      if (gen !== loadGen.current) return;
      setStatus("error");
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  // Mount-only: resolve active provider + its key once.
  // Locale changes must NOT re-read SecureStore (would wipe an unsaved draft key).
  useEffect(() => {
    let mounted = true;
    const gen = ++loadGen.current;
    (async () => {
      setLoading(true);
      try {
        const active = await getActiveProviderId(localeRef.current);
        if (!mounted || gen !== loadGen.current) return;
        setProviderId(active);
        setSavedProviderId(active);
        if (PROVIDERS[active].needsKey) {
          const secret = await getSecret(active, localeRef.current);
          if (!mounted || gen !== loadGen.current) return;
          setApiKey(secret ?? "");
          setSavedApiKey(secret ?? "");
        } else {
          setApiKey("");
          setSavedApiKey("");
        }
      } catch (err) {
        if (!mounted || gen !== loadGen.current) return;
        setStatus("error");
        setStatusMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted && gen === loadGen.current) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectProvider = useCallback(
    async (id: SearchProviderId) => {
      if (id === providerId || busy) return;
      setShowKey(false);
      setProviderId(id);
      setStatus("idle");
      setStatusMessage("");
      // Load the stored key for the newly selected provider (draft for that provider).
      // Does not touch saved* until Save.
      await loadKeyForProvider(id);
    },
    [busy, loadKeyForProvider, providerId],
  );

  const handleSave = useCallback(async () => {
    if (busy) return;
    const targetId = providerId;
    const targetKey = apiKey;
    const targetNeedsKey = PROVIDERS[targetId].needsKey;

    setSaving(true);
    setStatus("idle");
    setStatusMessage("");
    try {
      // Key first for keyed providers: if setSecret fails, provider selection stays unchanged.
      if (targetNeedsKey) {
        await setSecret(targetId, targetKey, locale);
      }
      // Only update active provider after key success (and only if selection is still the same).
      if (providerId === targetId) {
        await setActiveProviderId(targetId);
      }
      setSavedProviderId(targetId);
      setSavedApiKey(targetNeedsKey ? targetKey : "");
      setStatus("saved");
      setStatusMessage(t("settings.saved"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus("error");
      setStatusMessage(t("settings.saveFailed", { message }));
    } finally {
      setSaving(false);
    }
  }, [apiKey, busy, locale, providerId, t]);

  const handleBack = useCallback(() => {
    if (busy) return;
    if (!dirty) {
      onBack();
      return;
    }
    Alert.alert(t("settings.unsavedTitle"), t("settings.unsavedBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.discard"),
        style: "destructive",
        onPress: onBack,
      },
    ]);
  }, [busy, dirty, onBack, t]);

  const handlePageBack = useCallback(() => {
    if (page === "advanced") {
      setPage("home");
      return;
    }
    handleBack();
  }, [handleBack, page]);

  /** Guards double-tap: two rapid Help taps must not stack two discard Alerts. */
  const helpConfirmPendingRef = useRef(false);

  /**
   * Help leaves Settings (exclusive overlay). If websearch edits are dirty,
   * confirm discard first so the draft key is not silently lost on unmount.
   */
  const handleOpenHelp = useCallback(() => {
    if (busy) return;
    if (!dirty) {
      onOpenHelp();
      return;
    }
    if (helpConfirmPendingRef.current) return;
    helpConfirmPendingRef.current = true;
    Alert.alert(
      t("settings.unsavedTitle"),
      t("settings.unsavedBody"),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
          onPress: () => {
            helpConfirmPendingRef.current = false;
          },
        },
        {
          text: t("settings.discard"),
          style: "destructive",
          onPress: () => {
            helpConfirmPendingRef.current = false;
            onOpenHelp();
          },
        },
      ],
      {
        onDismiss: () => {
          helpConfirmPendingRef.current = false;
        },
      },
    );
  }, [busy, dirty, onOpenHelp, t]);

  // Android hardware back: consume here so dirty confirmation is not skipped by AppShell.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handlePageBack();
      return true;
    });
    return () => sub.remove();
  }, [handlePageBack]);

  const keyPlaceholder = useMemo(
    () => meta.keyPlaceholder ?? t("settings.apiKeyPlaceholder"),
    [meta.keyPlaceholder, t],
  );

  const activeStatusLabel = useMemo(() => {
    switch (model.modelState) {
      case "checking":
        return t("settings.modelChecking");
      case "missing":
        return t("settings.modelMissing");
      case "downloading":
        return t("settings.modelDownloading", {
          percent: model.downloadPercent ?? 0,
        });
      case "loading":
        return t("settings.modelLoading");
      case "ready":
        return t("settings.modelReady");
      case "error":
        return t("settings.modelError");
    }
  }, [model.downloadPercent, model.modelState, t]);

  // ── Device RAM tier (Settings → Models: advisory recommendation only) ────
  // Stable for the process lifetime — computed once, never re-read.
  const deviceTotalMemoryBytes = useMemo(() => getDeviceTotalMemoryBytes(), []);
  const deviceRamGb = useMemo(
    () =>
      deviceTotalMemoryBytes !== null
        ? Math.round(deviceTotalMemoryBytes / 1_000_000_000)
        : null,
    [deviceTotalMemoryBytes],
  );
  // null when RAM is unknown: skip recommendation/warning UI entirely rather
  // than guessing (getRamTier(null) is conservative "low" for engine use,
  // but showing "recommended for your device" when the device is unknown
  // would be misleading).
  const deviceRamTier = deviceTotalMemoryBytes !== null ? getRamTier(deviceTotalMemoryBytes) : null;
  const recommendedModel = deviceRamTier !== null ? recommendedModelId(deviceRamTier) : null;

  // Hard gate inputs: DeviceProfile (process-cached) + free disk (best-effort).
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [freeDiskBytes, setFreeDiskBytes] = useState<number | null>(null);
  const [memoryUnknownBanner, setMemoryUnknownBanner] = useState(false);
  const processHealth = useProcessHealth({
    totalMemoryBytes: deviceProfile?.totalMemoryBytes ?? null,
  });
  // "free" above is MemAvailable, which counts a resident model's own mapped
  // weights as headroom (HARNESS_FINDINGS §7.44). "headroom" is that minus this
  // process's RssFile — what is actually reclaimable elsewhere. Swap shows only
  // once it has grown past the distress threshold, because growth there means
  // the system is paying for memory this process does not appear to hold.
  const processMemorySuffix = `${
    processHealth.residentHeadroomBytes != null
      ? ` · ${Math.round(processHealth.residentHeadroomBytes / (1024 * 1024))} MiB headroom`
      : ""
  }${
    processHealth.swapDistressed && processHealth.swapGrownBytes != null
      ? ` · swap +${Math.round(processHealth.swapGrownBytes / (1024 * 1024))} MiB`
      : ""
  }${
    processHealth.majfltGrown != null
      ? ` · majflt +${Math.round(processHealth.majfltGrown)}`
      : ""
  }`;
  const thermal = useThermalMonitor();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [profile, free] = await Promise.all([
          getCachedDeviceProfile(),
          getFreeDiskBytes(),
        ]);
        if (cancelled) return;
        setDeviceProfile(profile);
        setFreeDiskBytes(free);
        // Live uncached sample for memoryUnknown banner on active model.
        try {
          const available = await getAvailableMemoryBytesUncached();
          const active = MODEL_REGISTRY.find((m) => m.id === model.currentModelId);
          if (active) {
            // Same KV pricing as the load path: the catalog number is derived at
            // q8_0/q4_0, so a High choice must be re-priced before judging fit.
            const priced = modelAtKvProfile(
              active,
              kvCacheChoice?.k ?? active.kvCache?.k ?? "q8_0",
              kvCacheChoice?.v ?? active.kvCache?.v ?? "q4_0",
            );
            const fit = evaluateModelFit(
              {
                sizeBytes: active.sizeBytes,
                engineCtx: active.engineCtx,
                kvBytesPerToken: priced.kvBytesPerToken,
                mmproj: active.mmproj
                  ? { sizeBytes: active.mmproj.sizeBytes }
                  : null,
              },
              available,
            );
            if (!cancelled) {
              setMemoryUnknownBanner(fit.verdict === "unknown");
            }
          }
        } catch {
          // ignore
        }
      } catch {
        // Leave null — soft UI only; AppShell re-checks before download/load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.currentModelId, kvCacheChoiceId]);

  /** Localized hard-gate reason; null when allowed / unknown / no profile yet. */
  const gateReasonLabel = useCallback(
    (gate: ModelGateVerdict | null): string | null => {
      if (!gate || gate.allowed) return null;
      switch (gate.reason) {
        case "blocked_tier":
          return t("models.blockedTier");
        case "blocked_ram":
          return t("models.blockedRam");
        case "blocked_disk":
          return t("models.blockedDisk");
        default:
          return null;
      }
    },
    [t],
  );

  // ── Context size + KV cache precision (priced, not asserted) ──────────────
  // Every number below comes from the load path's own resolver
  // (resolveEngineTuningSync → resolveContextBudget) or from the model gate's own
  // estimator (gateContextOptionFit / gateCacheOptionFit → gateNonEvictableMiB).
  // Nothing here re-derives a
  // budget, so a figure shown in Settings cannot disagree with what the engine
  // allocates.
  const activeModelForMemory = useMemo(
    () => MODEL_REGISTRY.find((entry) => entry.id === model.currentModelId) ?? null,
    [model.currentModelId],
  );
  const kvCacheChoice = kvCacheChoiceById(kvCacheChoiceId);
  /** Standard is the shipped default, so unset and Standard render the same. */
  const effectiveKvCacheChoiceId: KvCacheChoiceId = kvCacheChoiceId ?? "standard";

  const catalogContextTokens = useMemo(
    () =>
      activeModelForMemory
        ? resolveContextProfile({
            hybrid: activeModelForMemory.hybrid,
            kvCache: activeModelForMemory.kvCache,
            catalogCtx: activeModelForMemory.engineCtx,
            totalMemoryBytes: deviceProfile?.totalMemoryBytes ?? deviceTotalMemoryBytes,
          }).nCtx
        : null,
    [activeModelForMemory, deviceProfile?.totalMemoryBytes, deviceTotalMemoryBytes],
  );
  /**
   * What the engine will be asked for: the bench lever first, then the user's
   * stored size (clamped to a size this model offers), then the catalog/device
   * value. Same precedence AppShell resolves, so the grading and the shown
   * context are the ones that load.
   */
  const requestedContextTokens = resolveRequestedContextTokens({
    benchNCtx,
    storedUserContextSize: userContextSize,
    catalogContextTokens,
    modelContextLength: activeModelForMemory?.contextLength,
  });

  /**
   * The load mode init will use for this model, bench levers included: the
   * same resolution LlamaService runs (resolveLoadPolicy, streamExperts:false).
   */
  const gateLoadMode = useMemo(
    () =>
      activeModelForMemory
        ? resolveGateLoadPolicy({
            policy: activeModelForMemory.loadPolicy,
            benchNoRepack,
            benchUseMmap,
          })
        : null,
    [activeModelForMemory, benchNoRepack, benchUseMmap],
  );

  const contextResolution = useMemo(() => {
    if (!activeModelForMemory || !deviceProfile || requestedContextTokens == null) {
      return null;
    }
    const kv = kvCacheChoice ?? activeModelForMemory.kvCache;
    const tuning = resolveEngineTuningSync({
      // KV priced at the chosen quant, exactly as LlamaService.initEngine prices
      // the tuning request — a q8_0 V cache is 31% larger than the catalog's.
      model: modelAtKvProfile(activeModelForMemory, kv?.k ?? "q8_0", kv?.v ?? "q4_0"),
      profile: deviceProfile,
      request: {
        contextBudget: requestedContextTokens,
        // The load mode init will use, dev levers included: without it the
        // panel prices a repack/mmap configuration the engine may not use.
        repack: gateLoadMode?.repack ?? true,
        mmap: gateLoadMode?.mmap ?? true,
      },
    });
    return {
      requested: requestedContextTokens,
      loaded: tuning.context.n_ctx,
      outcome: contextSizeOutcome({
        requested: requestedContextTokens,
        loaded: tuning.context.n_ctx,
        ctxSource: tuning.context.ctxSource,
        nonEvictableMiB: tuning.memory.nonEvictableMiB,
        availableMiB: tuning.memory.availableMiB,
      }),
    };
  }, [
    activeModelForMemory,
    deviceProfile,
    requestedContextTokens,
    kvCacheChoice,
    gateLoadMode,
  ]);

  /** What the row says the engine resolved to, and why it is not the request. */
  const contextStatusLabel = useMemo(() => {
    const outcome = contextResolution?.outcome;
    if (!outcome) return t("settings.contextSizeAuto");
    if (outcome.kind === "phone-could-not-hold") {
      return t("settings.contextSizeDowngraded", {
        requested: outcome.requested,
        loaded: outcome.loaded,
        needed: outcome.neededMiB,
        // A memory-budget shrink always carries a reading; "?" only guards a
        // malformed profile.
        available:
          outcome.availableMiB != null ? Math.round(outcome.availableMiB) : "?",
      });
    }
    if (outcome.kind === "model-max") {
      return t("settings.contextSizeModelMax", {
        requested: outcome.requested,
        loaded: outcome.loaded,
        model: activeModelForMemory?.name ?? "",
      });
    }
    return t("settings.contextSizeResolved", { tokens: outcome.loaded });
  }, [contextResolution, activeModelForMemory, t]);

  // One row per offered context size, each resolved the way the load resolves
  // it. A size the phone cannot hold stays SELECTABLE and reports the context
  // it will load at instead: the budget degrades a context, it does not refuse
  // one. Only a size whose even-the-floor cannot load is unselectable.
  const contextSizeOptionRows = useMemo(() => {
    if (!activeModelForMemory) return [];
    const kv = kvCacheChoice ?? activeModelForMemory.kvCache;
    const priced = modelAtKvProfile(
      activeModelForMemory,
      kv?.k ?? "q8_0",
      kv?.v ?? "q4_0",
    );
    return contextSizeChoices(activeModelForMemory.contextLength).map((tokens) => {
      const fit = gateContextOptionFit({
        model: priced,
        requestedContextTokens: tokens,
        profile: deviceProfile,
        availableMemoryBytes: deviceProfile?.availableMemoryBytes ?? null,
        benchNoRepack,
        benchUseMmap,
      });
      return { tokens, ...fit, availability: optionAvailability(fit.status) };
    });
  }, [
    activeModelForMemory,
    kvCacheChoice,
    deviceProfile,
    benchNoRepack,
    benchUseMmap,
  ]);

  // Same pricing for the two cache qualities, at the context each candidate
  // would ITSELF resolve to: the larger cache can force a further downgrade, so
  // judging it at the context the current profile resolved to hides what it
  // costs. gateCacheOptionFit does both resolutions in one call.
  const kvCacheOptionRows = useMemo(() => {
    if (!activeModelForMemory || !deviceProfile || requestedContextTokens == null) {
      return [];
    }
    return KV_CACHE_CHOICES.map((choice) => {
      const fit = gateCacheOptionFit({
        model: activeModelForMemory,
        choice: { k: choice.k, v: choice.v },
        profile: deviceProfile,
        requestedContextTokens,
        availableMemoryBytes: deviceProfile.availableMemoryBytes,
        benchNoRepack,
        benchUseMmap,
      });
      return { choice, ...fit, availability: optionAvailability(fit.status) };
    });
  }, [
    activeModelForMemory,
    requestedContextTokens,
    deviceProfile,
    benchNoRepack,
    benchUseMmap,
  ]);

  /** KV bytes High costs over Standard at the context the user asked for. */
  const kvCacheHighCostMiB = useMemo(() => {
    if (!activeModelForMemory || requestedContextTokens == null) return null;
    const base = activeModelForMemory.kvBytesPerToken;
    const high = kvBytesPerTokenAtProfile(base, "q8_0", "q8_0");
    if (typeof base !== "number" || high === null) return null;
    return Math.round(((high - base) * requestedContextTokens) / (1024 * 1024));
  }, [activeModelForMemory, requestedContextTokens]);

  /** Compact device line: brand model · N GB RAM · M cores (null parts omitted). */
  const deviceLineLabel = useMemo(() => {
    if (!deviceProfile) return null;
    const brand = deviceProfile.brand ?? "";
    const model = deviceProfile.modelName ?? "";
    const parts: string[] = [];
    if (brand || model) {
      parts.push(t("settings.deviceLine", { brand, model }).trim());
    }
    const gb =
      deviceProfile.totalMemoryBytes != null
        ? Math.round(deviceProfile.totalMemoryBytes / 1_000_000_000)
        : deviceRamGb;
    if (gb != null) parts.push(`${gb} GB RAM`);
    if (deviceProfile.cpuCoreCount != null) {
      parts.push(`${deviceProfile.cpuCoreCount} cores`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [deviceProfile, deviceRamGb, t]);

  const voiceStatusLabel = useMemo(() => {
    switch (voice.state) {
      case "checking":
        return t("settings.modelChecking");
      case "missing":
        return t("voice.missing");
      case "downloading":
        return t("voice.downloading", { percent: voice.downloadPercent ?? 0 });
      case "ready":
        return t("voice.ready");
      case "error":
        return t("settings.modelError");
    }
  }, [voice.downloadPercent, voice.state, t]);

  const embeddingStatusLabel = useMemo(() => {
    // Round 7 hung visibility: process-wide hung flag wins over pipeline state.
    // Round 8 FIX 3: include isEmbedderHung() in deps so a hang declared while
    // Settings is mounted re-evaluates the label (module flag is not reactive;
    // any dep change re-reads it — acceptable minimal approach).
    if (isEmbedderHung()) {
      return t("embedding.hung");
    }
    switch (embedding.state) {
      case "checking":
        return t("settings.modelChecking");
      case "missing":
        return t("embedding.statusNotDownloaded");
      case "downloading":
        return t("embedding.downloading", {
          percent: embedding.downloadPercent ?? 0,
        });
      case "ready":
        return t("embedding.statusDownloaded");
      case "error":
        return t("settings.modelError");
    }
  }, [embedding.downloadPercent, embedding.state, t, isEmbedderHung()]);

  const memoryAtCapacity = memoryFacts.length >= MemoryStore.MAX_FACTS;
  const hasTruncatedReplyFacts =
    memoryEnabled &&
    memoryFacts.some((fact) => fact.text.length > PROMPT_FACT_CHARS);
  // The compact model picker uses the same memory and disk gate as Advanced.
  const modelChoices = MODEL_REGISTRY.map((entry) => {
    const active = entry.id === model.currentModelId;
    const profilePending = deviceProfile === null || freeDiskBytes === null;
    const gate: ModelGateVerdict | null = deviceProfile
      ? modelGateVerdict({
          totalMemoryBytes: deviceProfile.totalMemoryBytes,
          availableMemoryBytes: deviceProfile.availableMemoryBytes,
          freeDiskBytes,
          ramTier: deviceProfile.ramTier,
          modelMinRamTier: entry.minRamTier,
          modelNonEvictableMiB: gateNonEvictableMiB({
            model: modelAtKvProfile(
              entry,
              kvCacheChoice?.k ?? entry.kvCache?.k ?? "q8_0",
              kvCacheChoice?.v ?? entry.kvCache?.v ?? "q4_0",
            ),
            contextTokens: resolveContextProfile({
              hybrid: entry.hybrid,
              kvCache: kvCacheChoice ?? entry.kvCache,
              catalogCtx: entry.engineCtx,
              totalMemoryBytes: deviceProfile.totalMemoryBytes,
              explicitNCtx: active && contextResolution ? contextResolution.loaded : undefined,
            }).nCtx,
            availableMemoryBytes: deviceProfile.availableMemoryBytes,
          }),
          modelWeightsBytesPerToken: entry.weightsBytesPerToken,
          deviceBandwidthBytesPerSecond: deviceBandwidthForModel(model.deviceBandwidth, entry),
          modelSizeBytes: diskRequirementBytes(entry.sizeBytes + (entry.mmproj?.sizeBytes ?? 0)),
        }, { checkVolatileMemory: false })
      : null;
    const hardBlocked = gate?.allowed === false && !active;
    return {
      entry,
      active,
      profilePending,
      gate,
      hardBlocked,
      hardBlockLabel: hardBlocked ? gateReasonLabel(gate) : null,
      selectDisabled: modelBusy || hardBlocked || profilePending,
    };
  });

  if (page === "home") {
    return (
      <SettingsHomeScreen
        onBack={handlePageBack}
        onOpenAdvanced={() => setPage("advanced")}
        onOpenHelp={handleOpenHelp}
        onOpenPro={onOpenPro}
        modelOptions={modelChoices.map(({ entry, selectDisabled }) => ({
          id: entry.id,
          label: entry.name,
          detail: entry.quant,
          sizeClass: entry.sizeClass,
          disabled: selectDisabled,
        }))}
        currentModelId={model.currentModelId}
        modelBusy={modelBusy}
        onSelectModel={model.onSelectModel}
        webEnabled={webToolsEnabled ?? false}
        onToggleWeb={onToggleWebTools}
        telemetryEnabled={telemetryEnabled}
        telemetryBusy={telemetryBusy}
        onToggleTelemetry={handleToggleTelemetry}
        deviceToolsEnabled={deviceToolsEnabled}
        onToggleDeviceTools={handleToggleDeviceTools}
        calendarToolsEnabled={calendarToolsEnabled}
        onToggleCalendarTools={handleToggleCalendarTools}
        appVersion={APP_VERSION}
      />
    );
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.shell,
        zIndex: 50,
      }}
    >
      <SettingsHeader title={t("settings.advanced")} onBack={() => setPage("home")} backLabel={t("common.back")} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── CisWire flags ───────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.ciswire")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("settings.ciswireHint")}
          </Text>
          <Text style={[typography.bodySm, { color: colors.ink, marginTop: spacing.xs }]}>
            {t("settings.ciswireCompaction")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {(
              [
                ["off", t("settings.ciswireOff")],
                ["anchored", t("settings.ciswireStandard")],
                ["ciswire", t("settings.ciswireMode")],
              ] as const
            ).map(([id, label]) => {
              const selected = compactionMode === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => handleSelectCompactionMode(id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  style={{
                    flex: 1,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: selected ? colors.accent : colors.ink,
                        fontFamily: selected ? fontFamilies.displayBold : fontFamilies.bodyMedium,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
            }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, flex: 1 }]}>
              {t("settings.ciswireToolHelp")}
            </Text>
            <Switch
              value={ciswireToolHelpEnabled}
              onValueChange={handleToggleCiswireToolHelp}
              trackColor={{ false: colors.line, true: `${colors.accent}88` }}
              thumbColor={ciswireToolHelpEnabled ? colors.accent : colors.muted}
              accessibilityLabel={t("settings.ciswireToolHelp")}
            />
          </View>
        </GlassPanel2>

        {/* ── Context size (init input; the next load applies it) ───────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.contextSize")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("settings.contextSizeHint")}
          </Text>
          <View style={{ gap: spacing.xs }}>
            {contextSizeOptionRows.map((option) => {
              const selected = contextResolution?.requested === option.tokens;
              // Only a genuine no-load blocks (even the floor does not fit).
              const blocked = !option.selectable;
              return (
                <Pressable
                  key={option.tokens}
                  onPress={() =>
                    handleSelectContextSize(
                      option.tokens,
                      activeModelForMemory?.contextLength,
                    )
                  }
                  disabled={blocked || busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: blocked }}
                  accessibilityLabel={t("settings.contextSizeOption", {
                    tokens: option.tokens,
                  })}
                  style={{
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    opacity: blocked ? 0.5 : 1,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: spacing.sm,
                    }}
                  >
                    <Text
                      style={[
                        typography.bodySm,
                        {
                          color: selected ? colors.accent : colors.ink,
                          fontFamily: selected
                            ? fontFamilies.displayBold
                            : fontFamilies.bodyMedium,
                        },
                      ]}
                    >
                      {t("settings.contextSizeOption", { tokens: option.tokens })}
                    </Text>
                    {option.nonEvictableMiB != null ? (
                      <Text style={[typography.bodyXs, { color: colors.muted }]}>
                        {Math.round(option.nonEvictableMiB)} MiB
                      </Text>
                    ) : null}
                  </View>
                  {option.downgradesTo != null ? (
                    <Text
                      style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}
                    >
                      {t("settings.optionDowngradesTo", { tokens: option.downgradesTo })}
                    </Text>
                  ) : null}
                  {blocked ? (
                    <Text
                      style={[
                        typography.bodyXs,
                        { color: colors.bad ?? colors.muted, marginTop: 2 },
                      ]}
                    >
                      {t("models.blockedRam")}
                    </Text>
                  ) : option.availability === "tight" ? (
                    <Text
                      style={[typography.bodyXs, { color: colors.warn, marginTop: 2 }]}
                    >
                      {t("settings.optionTight")}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {contextStatusLabel}
          </Text>
        </GlassPanel2>

        {/* ── KV cache precision (init input; the next load applies it) ─── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.kvCache")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("settings.kvCacheHint")}
          </Text>
          <View style={{ gap: spacing.xs }}>
            {kvCacheOptionRows.map((row) => {
              const selected = effectiveKvCacheChoiceId === row.choice.id;
              const blocked = row.availability === "blocked";
              const label =
                row.choice.id === "standard"
                  ? t("settings.kvCacheStandard")
                  : t("settings.kvCacheHigh");
              return (
                <Pressable
                  key={row.choice.id}
                  onPress={() => handleSelectKvCache(row.choice.id)}
                  disabled={blocked || busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: blocked }}
                  accessibilityLabel={label}
                  style={{
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    opacity: blocked ? 0.5 : 1,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: spacing.sm,
                    }}
                  >
                    <Text
                      style={[
                        typography.bodySm,
                        {
                          color: selected ? colors.accent : colors.ink,
                          fontFamily: selected
                            ? fontFamilies.displayBold
                            : fontFamilies.bodyMedium,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                    {row.nonEvictableMiB != null ? (
                      <Text style={[typography.bodyXs, { color: colors.muted }]}>
                        {Math.round(row.nonEvictableMiB)} MiB
                      </Text>
                    ) : null}
                  </View>
                  {row.choice.id === "high" && kvCacheHighCostMiB != null ? (
                    <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                      {t("settings.kvCacheHighCost", {
                        mib: kvCacheHighCostMiB,
                        tokens: requestedContextTokens ?? "",
                      })}
                    </Text>
                  ) : null}
                  {requestedContextTokens != null &&
                  row.contextTokens < requestedContextTokens ? (
                    <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                      {t("settings.optionDowngradesTo", { tokens: row.contextTokens })}
                    </Text>
                  ) : null}
                  {blocked ? (
                    <Text
                      style={[
                        typography.bodyXs,
                        { color: colors.bad ?? colors.muted, marginTop: 2 },
                      ]}
                    >
                      {t("models.blockedRam")}
                    </Text>
                  ) : row.availability === "tight" ? (
                    <Text
                      style={[typography.bodyXs, { color: colors.warn, marginTop: 2 }]}
                    >
                      {t("settings.optionTight")}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </GlassPanel2>

        {/* ── Instant chat reopen (UFS KV pool) ────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.sessionPool")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.sessionPoolHint")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {SESSION_POOL_CONVERSATION_OPTIONS.map((count) => {
              const selected = sessionPoolChats === count;
              return (
                <Pressable
                  key={count}
                  onPress={() => handleSelectSessionPoolChats(count)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t("settings.sessionPoolChats", { count })}
                  style={{
                    flex: 1,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    alignItems: "center",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: selected ? colors.accent : colors.ink,
                        fontFamily: selected ? fontFamilies.displayBold : fontFamilies.bodyMedium,
                      },
                    ]}
                  >
                    {String(count)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassPanel2>

        {/* ── Thinking ─────────────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.thinking")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.thinkingHint")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {thinkingOptions.map((option) => {
              const selected = effectiveThinkingSelection === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => handleSelectThinkingMode(option.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  style={{
                    flex: 1,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    alignItems: "center",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: selected ? colors.accent : colors.ink,
                        fontFamily: selected ? fontFamilies.displayBold : fontFamilies.bodyMedium,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassPanel2>

        {/* ── Memory ───────────────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("memory.title")}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
            }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, flex: 1 }]}>
              {t("memory.enabled")}
            </Text>
            <Switch
              value={memoryEnabled}
              onValueChange={handleToggleMemory}
              disabled={memoryBusy}
              trackColor={{ false: colors.line, true: `${colors.accent}88` }}
              thumbColor={memoryEnabled ? colors.accent : colors.muted}
              accessibilityLabel={t("memory.enabled")}
            />
          </View>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("memory.capHint", {
              count: memoryFacts.length,
              max: MemoryStore.MAX_FACTS,
            })}
            {memoryEnabled
              ? ` — ${t("memory.capReplyHint", { chars: PROMPT_FACT_CHARS })}`
              : null}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("memory.note")}
          </Text>

          {hasTruncatedReplyFacts ? (
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("memory.truncNote", { chars: PROMPT_FACT_CHARS })}
            </Text>
          ) : null}

          {!memoryEnabled ? (
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("memory.disabledNote")}
            </Text>
          ) : null}

          {/* List + clear stay visible even when memory is off so deletion is always possible. */}
          <Text
            style={[
              typography.bodyXs,
              { color: colors.muted, marginTop: spacing.xs },
            ]}
          >
            {t("memory.facts")}
          </Text>

          {memoryFacts.length === 0 ? (
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("memory.empty")}
            </Text>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {memoryFacts.map((fact) => (
                <View
                  key={fact.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  {editingFactId === fact.id ? (
                    <View
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.xs,
                      }}
                    >
                      <TextInput
                        value={editingText}
                        onChangeText={setEditingText}
                        placeholder={t("memory.editPlaceholder")}
                        placeholderTextColor={colors.muted}
                        editable={!memoryBusy}
                        maxLength={200}
                        autoFocus
                        onSubmitEditing={() => {
                          void handleSaveMemoryFact(fact);
                        }}
                        returnKeyType="done"
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: colors.line,
                          borderRadius: radius.md,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs,
                          color: colors.ink,
                          fontSize: (typography.bodySm.fontSize as number) ?? 14,
                        }}
                      />
                      <Pressable
                        onPress={() => {
                          void handleSaveMemoryFact(fact);
                        }}
                        disabled={memoryBusy}
                        hitSlop={8}
                        accessibilityLabel={t("common.save")}
                        style={{
                          padding: spacing.xs,
                          borderRadius: radius.sm,
                          opacity: memoryBusy ? 0.5 : 1,
                        }}
                      >
                        <Check size={16} color={colors.good} />
                      </Pressable>
                      <Pressable
                        onPress={handleCancelEditingMemoryFact}
                        disabled={memoryBusy}
                        hitSlop={8}
                        accessibilityLabel={t("common.cancel")}
                        style={{
                          padding: spacing.xs,
                          borderRadius: radius.sm,
                          opacity: memoryBusy ? 0.5 : 1,
                        }}
                      >
                        <X size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <Text
                        style={[typography.bodySm, { color: colors.ink, flex: 1 }]}
                        numberOfLines={3}
                      >
                        {fact.text}
                      </Text>
                      <Pressable
                        onPress={() => handleStartEditingMemoryFact(fact)}
                        disabled={memoryBusy}
                        hitSlop={8}
                        accessibilityLabel={t("memory.editFact")}
                        style={{
                          padding: spacing.xs,
                          borderRadius: radius.sm,
                          opacity: memoryBusy ? 0.5 : 1,
                        }}
                      >
                        <Pencil size={16} color={colors.muted} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteMemoryFact(fact)}
                        disabled={memoryBusy}
                        hitSlop={8}
                        accessibilityLabel={t("memory.deleteFact")}
                        style={{
                          padding: spacing.xs,
                          borderRadius: radius.sm,
                          opacity: memoryBusy ? 0.5 : 1,
                        }}
                      >
                        <Trash2 size={16} color={colors.bad ?? colors.muted} />
                      </Pressable>
                    </>
                  )}
                </View>
              ))}
            </View>
          )}

          {memoryEnabled ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.xs,
              }}
            >
              <TextInput
                value={memoryDraft}
                onChangeText={setMemoryDraft}
                placeholder={t("memory.addPlaceholder")}
                placeholderTextColor={colors.muted}
                editable={!memoryBusy && !memoryAtCapacity}
                maxLength={200}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.sm,
                  color: colors.ink,
                  fontSize: (typography.bodyMd.fontSize as number) ?? 14,
                }}
                onSubmitEditing={() => {
                  void handleAddMemoryFact();
                }}
                returnKeyType="done"
              />
              <Pressable
                onPress={() => {
                  void handleAddMemoryFact();
                }}
                disabled={memoryBusy || memoryAtCapacity || !memoryDraft.trim()}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.accent,
                  opacity: memoryBusy || memoryAtCapacity || !memoryDraft.trim() ? 0.5 : 1,
                }}
                accessibilityLabel={t("memory.addFact")}
              >
                <Text style={[typography.bodySm, { color: colors.primaryText, fontFamily: fontFamilies.bodySemi }]}>
                  {t("memory.addFact")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {memoryFacts.length > 0 ? (
            <Pressable
              onPress={handleClearMemory}
              disabled={memoryBusy}
              style={{
                marginTop: spacing.xs,
                paddingVertical: spacing.sm,
                alignItems: "center",
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.line,
                opacity: memoryBusy ? 0.5 : 1,
              }}
              accessibilityLabel={t("memory.clear")}
            >
              <Text style={[typography.bodySm, { color: colors.bad ?? colors.muted }]}>
                {t("memory.clear")}
              </Text>
            </Pressable>
          ) : null}

          {memoryNotice ? (
            <Text
              style={[
                typography.bodyXs,
                {
                  color:
                    memoryNotice.kind === "warning"
                      ? colors.bad ?? colors.muted
                      : colors.accent,
                },
              ]}
              accessibilityLiveRegion="polite"
            >
              {memoryNotice.message}
            </Text>
          ) : null}
        </GlassPanel2>

        {/* ── Web search ───────────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.webSearch")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.webSearchHint")}
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {t("settings.provider")}
              </Text>
              <View style={{ gap: spacing.xs }}>
                {PROVIDER_IDS.map((id) => {
                  const selected = providerId === id;
                  const labelKey = PROVIDER_LABEL_KEYS[id];
                  return (
                    <Pressable
                      key={id}
                      onPress={() => selectProvider(id)}
                      disabled={busy}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.line,
                        backgroundColor: selected ? `${colors.accent}22` : "transparent",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color: selected ? colors.accent : colors.ink,
                            fontFamily: selected ? fontFamilies.displayBold : fontFamilies.bodyMedium,
                          },
                        ]}
                      >
                        {t(labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {needsKey ? (
                <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[typography.bodyXs, { color: colors.muted }]}>
                      {t("settings.apiKey")}
                    </Text>
                    <Pressable
                      onPress={() => setShowKey((v) => !v)}
                      hitSlop={8}
                      disabled={busy}
                    >
                      <Text style={[typography.bodyXs, { color: colors.accent, fontFamily: fontFamilies.bodySemi }]}>
                        {showKey ? t("settings.hideKey") : t("settings.showKey")}
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={apiKey}
                    onChangeText={(text) => {
                      setApiKey(text);
                      setStatus("idle");
                    }}
                    editable={!busy}
                    placeholder={keyPlaceholder}
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="password"
                    importantForAutofill="no"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      color: colors.ink,
                      fontSize: (typography.bodyMd.fontSize as number) ?? 14,
                      opacity: busy ? 0.6 : 1,
                    }}
                  />
                  <Text style={[typography.bodyXs, { color: colors.muted }]}>
                    {t("settings.apiKeyHint")}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, marginTop: spacing.sm },
                  ]}
                >
                  {t("settings.keyNotNeeded")}
                </Text>
              )}

              {dirty ? (
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, marginTop: spacing.xs, fontStyle: "italic" },
                  ]}
                >
                  {t("settings.unsavedChanges")}
                </Text>
              ) : null}

              <Pressable
                onPress={handleSave}
                disabled={busy}
                style={{
                  marginTop: spacing.sm,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={[typography.bodySm, { color: colors.primaryText, fontFamily: fontFamilies.displayBold }]}>
                  {saving ? t("settings.saving") : t("common.save")}
                </Text>
              </Pressable>

              {status !== "idle" && statusMessage ? (
                <Text
                  style={[
                    typography.bodyXs,
                    {
                      color: status === "error" ? colors.bad : colors.accent,
                      marginTop: spacing.xs,
                    },
                  ]}
                >
                  {statusMessage}
                </Text>
              ) : null}
            </>
          )}
        </GlassPanel2>

        {/* ── Voice (ASR + TTS) ────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("voice.title")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("voice.hint")}
          </Text>

          <View
            style={{
              marginTop: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
              gap: spacing.xs,
            }}
          >
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("voice.asrModel")}
            </Text>
            <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
              {t("voice.asrModelName")}
            </Text>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {voice.modelName} · {voice.modelSizeLabel}
            </Text>
            <Text
              style={[
                typography.bodyXs,
                {
                  color:
                    voice.state === "error"
                      ? colors.bad
                      : voice.state === "ready"
                        ? colors.good
                        : colors.muted,
                },
              ]}
            >
              {voiceStatusLabel}
            </Text>

            {voice.state === "downloading" && voice.downloadPercent != null ? (
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.line,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: 4,
                    width: `${voice.downloadPercent}%`,
                    backgroundColor: colors.accent,
                  }}
                />
              </View>
            ) : null}

            {voice.error ? (
              <Text style={[typography.bodyXs, { color: colors.bad }]} numberOfLines={2}>
                {voice.error}
              </Text>
            ) : null}

            {voice.state === "missing" || voice.state === "error" ? (
              <Pressable
                onPress={voice.onDownload}
                style={{
                  marginTop: 2,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                }}
                accessibilityLabel={t("voice.download")}
              >
                <Text style={[typography.bodySm, { color: colors.primaryText, fontFamily: fontFamilies.displayBold }]}>
                  {t("voice.download")}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
              marginTop: spacing.xs,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodySm, { color: colors.ink }]}>
                {t("voice.tts")}
              </Text>
              <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                {t("voice.ttsHint")}
              </Text>
            </View>
            <Switch
              value={voice.ttsEnabled}
              onValueChange={voice.onToggleTts}
              trackColor={{ false: colors.line, true: `${colors.accent}88` }}
              thumbColor={voice.ttsEnabled ? colors.accent : colors.muted}
              accessibilityLabel={t("voice.tts")}
            />
          </View>
        </GlassPanel2>

        {/* ── Embedding model (optional hybrid document search) ─────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("embedding.title")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("embedding.hint")}
          </Text>

          <View
            style={{
              marginTop: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
              gap: spacing.xs,
            }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
              {embedding.modelName}
            </Text>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("embedding.sizeLabel", { size: embedding.modelSizeLabel })}
            </Text>
            <Text
              style={[
                typography.bodyXs,
                {
                  color:
                    isEmbedderHung() || embedding.state === "error"
                      ? colors.bad
                      : embedding.state === "ready"
                        ? colors.good
                        : colors.muted,
                },
              ]}
            >
              {embeddingStatusLabel}
            </Text>

            {embedding.state === "downloading" && embedding.downloadPercent != null ? (
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.line,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: 4,
                    width: `${embedding.downloadPercent}%`,
                    backgroundColor: colors.accent,
                  }}
                />
              </View>
            ) : null}

            {embedding.error ? (
              <Text style={[typography.bodyXs, { color: colors.bad }]} numberOfLines={2}>
                {embedding.error}
              </Text>
            ) : null}

            {embedding.state === "missing" || embedding.state === "error" ? (
              <Pressable
                onPress={embedding.onDownload}
                style={{
                  marginTop: 2,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                }}
                accessibilityLabel={t("embedding.download")}
              >
                <Text style={[typography.bodySm, { color: colors.primaryText, fontFamily: fontFamilies.displayBold }]}>
                  {t("embedding.download")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </GlassPanel2>

        {/* ── Models ───────────────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <OrphanModelMigrationBanner />
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.models")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.modelsHint")}
          </Text>
          {deviceRamGb !== null ? (
            <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
              {t("models.deviceRam", { gb: deviceRamGb })}
            </Text>
          ) : null}
          {deviceLineLabel ? (
            <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
              {deviceLineLabel}
            </Text>
          ) : null}
          {memoryUnknownBanner ? (
            <Text
              style={[
                typography.bodyXs,
                { color: colors.bad ?? colors.muted, marginBottom: spacing.xs },
              ]}
            >
              {t("model.memoryUnknown")}
            </Text>
          ) : null}
          {processHealth.unloadedReason ? (
            <Text
              style={[
                typography.bodyXs,
                { color: colors.muted, marginBottom: spacing.xs },
              ]}
            >
              {t("chat.unloaded")}
              {processHealth.availableMemoryBytes != null
                ? ` · ${Math.round(processHealth.availableMemoryBytes / (1024 * 1024))} MiB free`
                : ""}
              {processMemorySuffix}
              {processHealth.fitTier ? ` · tier ${processHealth.fitTier}` : ""}
            </Text>
          ) : processHealth.availableMemoryBytes != null ? (
            <Text
              style={[
                typography.bodyXs,
                { color: colors.muted, marginBottom: spacing.xs },
              ]}
            >
              {`${Math.round(processHealth.availableMemoryBytes / (1024 * 1024))} MiB free`}
              {processMemorySuffix}
              {processHealth.fitTier ? ` · tier ${processHealth.fitTier}` : ""}
            </Text>
          ) : null}
          {thermal.status === "warm" || thermal.status === "hot" || thermal.status === "critical" ? (
            <Text
              style={[
                typography.bodyXs,
                { color: colors.bad ?? colors.muted, marginBottom: spacing.xs },
              ]}
            >
              {t(
                thermal.status === "critical"
                  ? "chat.thermalCritical"
                  : thermal.status === "hot"
                    ? "chat.thermalHot"
                    : "chat.thermalWarm",
              )}
              {thermal.currentTempC != null
                ? ` · ${Math.round(thermal.currentTempC)}°C`
                : ""}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typography.bodySm, { color: colors.ink }]}>
                {t("settings.governor")}
              </Text>
              <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                {t("settings.governorBody")}
              </Text>
            </View>
            <Switch
              value={governorEnabled}
              onValueChange={handleToggleGovernor}
              trackColor={{ false: colors.line, true: `${colors.accent}88` }}
              thumbColor={governorEnabled ? colors.accent : colors.muted}
              accessibilityLabel={t("settings.governor")}
            />
          </View>

          <View style={{ gap: spacing.sm }}>
            {modelChoices.map(({ entry, active, profilePending, gate, hardBlocked, hardBlockLabel, selectDisabled }) => {
              const sizeLabel = formatBytes(modelBundleSize(entry));
              const downloaded = model.downloadedById[entry.id];
              const ramBadgeLabel = entry.ramBadgeKey ? t(entry.ramBadgeKey) : null;
              const isRecommended = recommendedModel !== null && entry.id === recommendedModel;
              const exceedsDeviceTier =
                deviceRamTier !== null &&
                entry.minRamTier !== undefined &&
                !ramTierMeets(deviceRamTier, entry.minRamTier);
              return (
                <View
                  key={entry.id}
                  style={{
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.line,
                    backgroundColor: active ? `${colors.accent}14` : "transparent",
                    gap: spacing.xs,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing.sm,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color: colors.ink,
                            fontFamily: active ? fontFamilies.displayBold : fontFamilies.bodySemi,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {entry.name}
                      </Text>
                      <Text style={[typography.bodyXs, { color: colors.muted }]} numberOfLines={1}>
                        {entry.quant} · {sizeLabel}
                        {ramBadgeLabel ? ` · ${ramBadgeLabel}` : ""}
                      </Text>
                      <Text
                        style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}
                        numberOfLines={3}
                      >
                        {t(entry.descriptionKey)}
                      </Text>
                      {isRecommended ? (
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.good, fontFamily: fontFamilies.bodySemi, marginTop: 2 },
                          ]}
                          numberOfLines={1}
                        >
                          {t("models.recommended")}
                        </Text>
                      ) : null}
                      {hardBlockLabel ? (
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.bad ?? colors.muted, marginTop: 2 },
                          ]}
                          numberOfLines={2}
                        >
                          {hardBlockLabel}
                        </Text>
                      ) : exceedsDeviceTier ? (
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.bad ?? colors.muted, marginTop: 2 },
                          ]}
                          numberOfLines={2}
                        >
                          {t("models.mayNotFit")}
                        </Text>
                      ) : null}
                      {typeof downloaded === "boolean" ? (
                        <Text
                          style={[
                            typography.bodyXs,
                            {
                              color: downloaded ? colors.good : colors.muted,
                              marginTop: 2,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {downloaded
                            ? t("settings.modelDownloadedBadge")
                            : t("settings.modelNotDownloadedBadge")}
                        </Text>
                      ) : null}
                    </View>

                    {active ? (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 999,
                          backgroundColor: `${colors.accent}22`,
                        }}
                      >
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.accent, fontFamily: fontFamilies.displayBold },
                          ]}
                        >
                          {t("settings.modelActive")}
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => model.onSelectModel(entry.id)}
                        disabled={selectDisabled}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: colors.line,
                          opacity: selectDisabled ? 0.5 : 1,
                        }}
                      >
                        <Text
                          style={[
                            typography.bodyXs,
                            {
                              color:
                                hardBlocked || profilePending
                                  ? colors.muted
                                  : colors.ink,
                              fontFamily: fontFamilies.bodySemi,
                            },
                          ]}
                        >
                          {t("settings.modelSelect")}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {active ? (
                    <View style={{ gap: spacing.xs }}>
                      <Text
                        style={[
                          typography.bodyXs,
                          {
                            color:
                              model.modelState === "error"
                                ? colors.bad
                                : model.modelState === "ready"
                                  ? colors.good
                                  : colors.muted,
                          },
                        ]}
                      >
                        {activeStatusLabel}
                      </Text>

                      {model.modelState === "downloading" && model.downloadPercent != null ? (
                        <View
                          style={{
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: colors.line,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height: 4,
                              width: `${model.downloadPercent}%`,
                              backgroundColor: colors.accent,
                            }}
                          />
                        </View>
                      ) : null}

                      {model.modelError ? (
                        <Text
                          style={[typography.bodyXs, { color: colors.bad }]}
                          numberOfLines={2}
                        >
                          {model.modelError}
                        </Text>
                      ) : null}

                      {model.modelErrorHint ? (
                        <Text
                          style={[typography.bodyXs, { color: colors.muted }]}
                          numberOfLines={8}
                        >
                          {model.modelErrorHint}
                        </Text>
                      ) : null}

                      {model.modelState === "missing" || model.modelState === "error" ? (
                        <Pressable
                          onPress={() => {
                            const engineRetry =
                              model.modelState === "error" &&
                              (model.modelErrorKind === "engine" ||
                                model.downloadedById[entry.id] === true);
                            if (engineRetry) model.onRetryLoad();
                            else model.onDownloadModel(entry.id);
                          }}
                          disabled={selectDisabled}
                          style={{
                            marginTop: 2,
                            paddingVertical: spacing.sm,
                            borderRadius: radius.md,
                            backgroundColor: colors.accent,
                            alignItems: "center",
                            opacity: selectDisabled ? 0.6 : 1,
                          }}
                        >
                          <Text
                            style={[
                              typography.bodySm,
                              { color: colors.primaryText, fontFamily: fontFamilies.displayBold },
                            ]}
                          >
                            {model.modelState === "error" &&
                            (model.modelErrorKind === "engine" ||
                              model.downloadedById[entry.id] === true)
                              ? t("settings.modelRetryLoad")
                              : t("settings.modelDownload")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </GlassPanel2>

        {/* ── Diagnostics ──────────────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("settings.diagnostics")}
          </Text>
          <Pressable
            onPress={handleReportProblem}
            accessibilityRole="button"
            accessibilityLabel={t("settings.reportProblem")}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
              {t("settings.reportProblem")}
            </Text>
            <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
              {t("settings.reportProblemBody")}
            </Text>
          </Pressable>
        </GlassPanel2>

        {/* ── Help (before About) ──────────────────────────────────────── */}
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Pressable
            onPress={handleOpenHelp}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("settings.openHelp")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <CircleQuestionMark size={18} color={colors.accent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
                {t("settings.help")}
              </Text>
              <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                {t("settings.helpSubtitle")}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        </GlassPanel2>

      </ScrollView>
    </View>
  );
}
