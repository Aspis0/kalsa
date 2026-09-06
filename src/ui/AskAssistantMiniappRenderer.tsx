import Ionicons from "@expo/vector-icons/Ionicons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { normalizeMiniappBlock } from "../domain/askAssistant";
import { computeStatistics, convertVolumeDensityToMass, fitRegression } from "../domain/miniappMathCore";
import { evaluateCalculatorFormula } from "../domain/miniappCalculator";
import { getStrings, useLocale, type Locale, type TranslateFn } from "../i18n";
import type { ThemeColors } from "../theme/palettes";
import { QuizBlockView } from "./blocks/QuizBlock";
import { useLabTheme } from "./labTheme";

const MAX_BLOCK_DEPTH = 3;
const MAX_CHILD_BLOCKS = 24;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLUMNS = 12;

type MiniappAction = {
  id?: string;
  label?: string;
  requiresAi?: boolean;
  requiresConfirm?: boolean;
  pattern?: string;
  primary?: boolean;
  advanced?: boolean;
  exportFormat?: "png" | "jpg" | "jpeg" | "svg" | "json" | "csv";
};

type MiniappNavigationItem = {
  id: string;
  label: string;
};

type MiniappNavigation = {
  items?: MiniappNavigationItem[];
  type?: string;
  view?: string;
};

type MiniappBlock = Record<string, unknown> & {
  id?: string;
  title?: string;
  visibleIn?: unknown;
  rows?: unknown;
  columns?: unknown;
  wells?: unknown;
  type?: string;
};

type Miniapp = {
  actions?: MiniappAction[];
  blocks?: MiniappBlock[];
  computed?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  kind: string;
  schema: "miniapp_v1" | "aspis_miniapp_v1";
  state?: {
    activeView?: unknown;
    inputs?: Record<string, unknown>;
    [key: string]: unknown;
  };
  navigation?: MiniappNavigation;
  title: string;
};

type Props = {
  /** Full theme palette — all surface/ink tokens required (no partial fallbacks). */
  colors: ThemeColors;
  glassVariant?: "ios" | "android" | "vision";
  miniapp: Miniapp;
  onAction?: (action: MiniappAction, miniapp: Miniapp) => void;
  styles: Record<string, any>;
};

type ComputedMiniapp = Record<string, unknown>;

type RendererContext = {
  colors: Props["colors"];
  computed: ComputedMiniapp;
  inputs: Record<string, number>;
  index: number;
  locale: Locale;
  t: TranslateFn;
  setInput: (key: string, value: string) => void;
  runAction: (action: MiniappAction) => void;

  styles: Record<string, any>;
};

type MiniappBlockRendererProps = {
  block: MiniappBlock;
  context: RendererContext;
  depth: number;
};

type MiniappBlockCapabilities = {
  aiActionSupport: boolean;
  backendActionSupport: boolean;
  editable: boolean;
  exportSupport: boolean;
  interactive: boolean;
  nestedBlocks: boolean;
  stateful: boolean;
};

type MiniappBlockVisualPreset = {
  accent: "cyan" | "indigo" | "lime" | "rose" | "violet" | "zinc";
  density: "compact" | "comfortable" | "spacious";
  liquidGlassSurface:
    | "command_bar"
    | "data_sheet"
    | "floating_control"
    | "frosted_panel"
    | "hero_glass"
    | "metric_glass"
    | "scientific_canvas"
    | "well_plate";
  motion: "none" | "press" | "scroll" | "state_transition";
  role: string;
};

type BlockRendererProps = MiniappBlockRendererProps & {
  capabilities: MiniappBlockCapabilities;
  visual: MiniappBlockVisualPreset;
};

type MiniappBlockRegistryBaseEntry = {
  aiActionSupport: boolean;
  backendActionSupport: boolean;
  editable: boolean;
  exportSupport: boolean;
  render: (props: BlockRendererProps) => React.ReactElement;
  schemaFields: string[];
};

type MiniappBlockRegistryDefinition = MiniappBlockRegistryBaseEntry & {
  capabilities?: Partial<MiniappBlockCapabilities>;
  visual?: Partial<MiniappBlockVisualPreset>;
};

type MiniappBlockRegistryEntry = MiniappBlockRegistryBaseEntry & {
  capabilities: MiniappBlockCapabilities;
  visual: MiniappBlockVisualPreset;
};

const miniappSurfaceStylesByKind: Record<MiniappBlockVisualPreset["liquidGlassSurface"], string[]> = {
  command_bar: ["miniappSurfaceCommandBar"],
  data_sheet: ["miniappSurfaceDataSheet"],
  floating_control: ["miniappSurfaceFloatingControl"],
  frosted_panel: ["miniappSurfaceFrostedPanel"],
  hero_glass: ["miniappSurfaceHeroGlass"],
  metric_glass: ["miniappSurfaceMetricGlass"],
  scientific_canvas: ["miniappSurfaceScientificCanvas"],
  well_plate: ["miniappSurfaceWellPlate"],
};

const miniappSurfaceDensityStyles: Record<MiniappBlockVisualPreset["density"], string> = {
  compact: "miniappSurfaceDensityCompact",
  comfortable: "miniappSurfaceDensityComfortable",
  spacious: "miniappSurfaceDensitySpacious",
};

const miniappSurfaceAccentStyles: Record<MiniappBlockVisualPreset["accent"], string> = {
  cyan: "miniappSurfaceAccentCyan",
  indigo: "miniappSurfaceAccentIndigo",
  lime: "miniappSurfaceAccentLime",
  rose: "miniappSurfaceAccentRose",
  violet: "miniappSurfaceAccentViolet",
  zinc: "miniappSurfaceAccentZinc",
};

const LOCAL_ACTIONS = {
  EXPORT_PNG: "export_png",
  EXPORT_JPEG: "export_jpeg",
  EXPORT_SVG: "export_svg",
  EXPORT_JSON: "export_json",
  EXPORT_CSV: "export_csv",
  GENERATE_REPORT: "generate_report",
};

const TABLE_ACTION_BLOCK_TYPES = new Set(["table", "data_table", "result_table", "input_table", "editable_table"]);

type MatrixRow = Record<string, unknown> & {
  __index: number;
}

function deriveInitialNavigationView(rawView: unknown, items: MiniappNavigationItem[]): string {
  if (rawView && typeof rawView === "string" && items.some((item) => item.id === rawView)) {
    return rawView;
  }
  if (items.length) return items[0].id;
  return "";
}

function parseNavigationItems(navigation: MiniappNavigation | undefined): MiniappNavigationItem[] {
  const items = asArray<MiniappNavigationItem>(navigation?.items, MAX_CHILD_BLOCKS);
  const mapped = items
    .map((item) => ({
      id: toStringValue(item?.id).trim().toLowerCase(),
      label: toStringValue(item?.label || item?.id).trim(),
    }))
    .filter((item) => item.id);
  if (mapped.length) return mapped;
  const fallbackValue = toStringValue(navigation?.view || navigation?.type).trim().toLowerCase();
  if (!fallbackValue) return [];
  return [{ id: fallbackValue, label: fallbackValue }];
}

/**
 * Recursively coerce nested block arrays so null/string/oversized children never
 * reach renderers. Domain normalizeMiniappBlock already caps strings / size.
 */
function sanitizeRenderBlock(raw: unknown, depth = 0): MiniappBlock {
  if (depth > MAX_BLOCK_DEPTH + 2) return { type: "unknown" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { type: "unknown" };
  const normalized = normalizeMiniappBlock(raw) as MiniappBlock;
  if (!normalized || typeof normalized !== "object") return { type: "unknown" };
  const type = toStringValue(normalized.type, "unknown") || "unknown";
  const out: MiniappBlock = { ...normalized, type };
  // Nested containers (tabs / expandable / generic blocks arrays).
  if (Array.isArray(out.blocks)) {
    out.blocks = (out.blocks as unknown[])
      .slice(0, MAX_CHILD_BLOCKS)
      .map((child) => sanitizeRenderBlock(child, depth + 1));
  }
  if (Array.isArray(out.tabs)) {
    out.tabs = (out.tabs as unknown[]).slice(0, MAX_CHILD_BLOCKS).map((tab) => {
      const record = asRecord(tab);
      const children = Array.isArray(record.blocks)
        ? (record.blocks as unknown[]).slice(0, MAX_CHILD_BLOCKS).map((c) => sanitizeRenderBlock(c, depth + 1))
        : [];
      return { ...record, blocks: children };
    });
  }
  if (Array.isArray(out.items)) {
    // Only rewrite item.blocks when present (tabs alias / timeline items).
    out.items = (out.items as unknown[]).slice(0, MAX_CHILD_BLOCKS).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      if (!Array.isArray(record.blocks)) return record;
      return {
        ...record,
        blocks: (record.blocks as unknown[])
          .slice(0, MAX_CHILD_BLOCKS)
          .map((c) => sanitizeRenderBlock(c, depth + 1)),
      };
    });
  }
  return out;
}

function normalizeMiniappState(miniapp: Miniapp): Miniapp {
  const stateInputs = asRecord(miniapp.state?.inputs);
  const activeView = toStringValue(miniapp.state?.activeView, "");
  const rawBlocks = asArray<unknown>(miniapp.blocks, MAX_CHILD_BLOCKS);
  return {
    ...miniapp,
    blocks: rawBlocks.map((block) => sanitizeRenderBlock(block, 0)),
    actions: asArray(miniapp.actions, MAX_CHILD_BLOCKS),
    state: {
      ...miniapp.state,
      activeView: activeView || undefined,
      inputs: {
        ...stateInputs,
      },
    },
    navigation: miniapp.navigation ? { ...miniapp.navigation, items: parseNavigationItems(miniapp.navigation) } : undefined,
  };
}

function toLowerCase(value: string): string {
  return value.toLowerCase().trim();
}

function normalizeNumber(value: unknown): number {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

const plateToneClassName: Record<string, "standard" | "sample" | "control" | "empty"> = {
  control: "control",
  "negative control": "control",
  negative_control: "control",
  empty: "empty",
  ntc: "control",
  sample: "sample",
  standard: "standard",
  unknown: "sample",
};

function toStringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function asArray<T>(value: unknown, maxItems: number): T[] {
  return Array.isArray(value) ? (value.slice(0, maxItems) as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringList(value: unknown): string[] {
  return asArray<unknown>(value, Number.MAX_SAFE_INTEGER).map((entry) => toStringValue(entry));
}

function formatMiniappNumber(value: unknown, digits = 3): string {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return "--";
  return Number(parsed.toFixed(digits)).toString();
}

function parseNumericCsv(value: string): number[] {
  return value
    .split(/[,\s;]+/)
    .map((entry) => toNumber(entry, Number.NaN))
    .filter((entry) => Number.isFinite(entry));
}

function numericValuesFromBlock(block: MiniappBlock): number[] {
  const values = asArray<unknown>(block.values ?? block.data ?? block.points, MAX_TABLE_ROWS);
  return values
    .map((value) => {
      if (Array.isArray(value)) return toNumber(value[1] ?? value[0], Number.NaN);
      if (value && typeof value === "object") {
        const record = asRecord(value);
        return toNumber(record.value ?? record.y ?? record.measurement, Number.NaN);
      }
      return toNumber(value, Number.NaN);
    })
    .filter((value) => Number.isFinite(value));
}

function csvFromNumericValues(values: number[]): string {
  return values.map((value) => String(value)).join(", ");
}

function plotPointsFromBlock(block: MiniappBlock): Array<[number, number]> {
  const directPoints = asArray<unknown>(block.points, MAX_TABLE_ROWS);
  const series = asArray<unknown>(block.series, MAX_CHILD_BLOCKS);
  const seriesRecord = asRecord(series[0]);
  const rawPoints = directPoints.length ? directPoints : asArray<unknown>(seriesRecord.points, MAX_TABLE_ROWS);
  return rawPoints
    .map((point, index): [number, number] | null => {
      if (Array.isArray(point)) {
        const x = toNumber(point[0], Number.NaN);
        const y = toNumber(point[1], Number.NaN);
        return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
      }
      if (point && typeof point === "object") {
        const record = asRecord(point);
        const x = toNumber(record.x ?? record.label ?? index + 1, Number.NaN);
        const y = toNumber(record.y ?? record.value, Number.NaN);
        return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
      }
      const y = toNumber(point, Number.NaN);
      return Number.isFinite(y) ? [index + 1, y] : null;
    })
    .filter((point): point is [number, number] => Boolean(point));
}

function getChildren(block: MiniappBlock): MiniappBlock[] {
  return asArray(block?.blocks as unknown, MAX_CHILD_BLOCKS);
}

function getActionId(action: MiniappAction) {
  return toLowerCase(toStringValue(action.id));
}

function isMiniappExportAction(action: MiniappAction): boolean {
  const actionId = getActionId(action);
  return (
    actionId === LOCAL_ACTIONS.EXPORT_CSV ||
    actionId === LOCAL_ACTIONS.EXPORT_PNG ||
    actionId === LOCAL_ACTIONS.EXPORT_JPEG ||
    actionId === LOCAL_ACTIONS.EXPORT_SVG ||
    actionId === LOCAL_ACTIONS.EXPORT_JSON
  );
}

function formatDateForExport(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  return `${date}-${time}`;
}

function sanitizeExportName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40) || "miniapp";
}

function buildMiniappExportFileName(miniapp: Miniapp, extension: "csv" | "jpg" | "jpeg" | "json" | "png" | "svg"): string {
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory || "";
  const safeKind = sanitizeExportName(miniapp.kind);
  const safeTitle = sanitizeExportName(miniapp.title || miniapp.kind);
  return `${directory}${safeKind}-${safeTitle}-${formatDateForExport()}.${extension}`;
}

function escapeXmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMiniappSvgText(miniapp: Miniapp): string {
  const title = escapeXmlText(toStringValue(miniapp.title, miniapp.kind));
  const kind = escapeXmlText(toStringValue(miniapp.kind));
  // Title @28, kind @48; block rows start @72, step 24, stay inside 720 viewBox (y ≤ 660).
  const blockStartY = 72;
  const blockStep = 24;
  const maxBlockY = 660;
  const maxBlockRows = Math.floor((maxBlockY - blockStartY) / blockStep) + 1;
  const blocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS).slice(0, maxBlockRows);
  const blockRows = blocks.map((block, index) => {
    const blockType = escapeXmlText(toStringValue(block.type, `block_${index + 1}`));
    const blockTitle = escapeXmlText(toStringValue(block.title, blockType));
    const y = blockStartY + index * blockStep;
    return `<text x="20" y="${y}" fill="#111827" font-size="14">${blockTitle} (${blockType})</text>`;
  });
  // No raw JSON payload — export is title, kind, and block rows only (avoid leaking model/user content).
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="900" height="720" viewBox="0 0 900 720">\n  <rect width="900" height="720" fill="#ffffff"/>\n  <text x="20" y="28" fill="#111827" font-size="20">${title}</text>\n  <text x="20" y="48" fill="#4b5563" font-size="12">kind: ${kind}</text>\n  ${blockRows.join("\n  ")}\n</svg>`;
}

function normalizeVisibleIn(block: MiniappBlock): string[] {
  return asStringList(block.visibleIn).map((entry) => entry.toLowerCase());
}

function isBlockVisibleInActiveView(block: MiniappBlock, activeView: string): boolean {
  const visibleIn = normalizeVisibleIn(block);
  if (!visibleIn.length) return true;
  if (!activeView) return false;
  return visibleIn.includes(activeView.toLowerCase());
}

function seedInputs(miniapp: Miniapp) {
  const seeded: Record<string, number> = {};
  const stateInputs = miniapp.state?.inputs || {};

  for (const [key, value] of Object.entries(stateInputs)) {
    if (typeof value === "number" || typeof value === "string") {
      seeded[key] = toNumber(value);
    }
  }

  for (const block of miniapp.blocks || []) {
    if (block.type !== "input_panel" || !Array.isArray(block.fields)) continue;
    for (const field of block.fields as unknown[]) {
      if (!field || typeof field !== "object") continue;
      const fieldRecord = asRecord(field);
      const fieldId = toStringValue(fieldRecord.id);
      if (!fieldId || seeded[fieldId] !== undefined) continue;
      seeded[fieldId] = toNumber(fieldRecord.value);
    }
  }

  return seeded;
}

function getMetricValue(metric: unknown, computed: ComputedMiniapp): string {
  if (!metric || typeof metric !== "object") return "--";
  const metricRecord = metric as Record<string, unknown>;
  const metricId = toStringValue(metricRecord.id).toLowerCase();
  let computedValue: unknown;
  if (metricId) {
    for (const [key, value] of Object.entries(computed)) {
      if (key.toLowerCase() === metricId) {
        computedValue = value;
        break;
      }
    }
  }
  if (typeof computedValue === "number") return formatMiniappNumber(computedValue);
  const raw = metricRecord.value;
  if (typeof raw === "number") return formatMiniappNumber(raw);
  return toStringValue(raw, "--");
}

function getMetricRows(block: MiniappBlock): MiniappBlock[] {
  const metrics = asArray(block.metrics as unknown, MAX_TABLE_COLUMNS) as MiniappBlock[];
  if (metrics.length) return metrics;
  if (block.label !== undefined || block.value !== undefined || block.id !== undefined) {
    return [block];
  }
  return [];
}

function normalizeTable(block: MiniappBlock) {
  const sourceRows = Array.isArray(block.rows) ? block.rows : [];
  const rawRows = sourceRows.slice(0, MAX_TABLE_ROWS);
  const rawColumns = asArray<unknown>(block.columns, MAX_TABLE_COLUMNS);
  const firstRowRecord = asRecord(rawRows.find((row) => row && typeof row === "object" && !Array.isArray(row)));
  const columns = (
    rawColumns.length
      ? rawColumns.map((column) => {
          const columnRecord = asRecord(column);
          const key = toStringValue(columnRecord.key, toStringValue(columnRecord.id, toStringValue(column)));
          return { key, label: toStringValue(columnRecord.label, key) };
        })
      : Object.keys(firstRowRecord).map((key) => ({ key, label: key }))
  )
    .filter((column) => column.key)
    .slice(0, MAX_TABLE_COLUMNS);
  const rows = rawRows.map((row) => {
    if (Array.isArray(row)) {
      return asArray(row, MAX_TABLE_COLUMNS).map((cell) => toStringValue(cell));
    }
    if (row && typeof row === "object") {
      const rowRecord = asRecord(row);
      return columns.map((column) => toStringValue(rowRecord[column.key]));
    }
    return [toStringValue(row)];
  });
  const cappedRows = rows.map((row) => row.slice(0, MAX_TABLE_COLUMNS));
  return {
    columns,
    rows: cappedRows,
    hasMoreRows: sourceRows.length > MAX_TABLE_ROWS,
    hasMoreColumns: rawColumns.length > MAX_TABLE_COLUMNS,
  };
}

function fallbackDepthBlock(context: RendererContext) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{context.t("renderer.blockedRenderPath")}</Text>
      <Text style={context.styles.miniappFallbackText}>
        {context.t("renderer.nestedDepthCapped", { depth: MAX_BLOCK_DEPTH })}
      </Text>
    </View>
  );
}

function HeroSummaryBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappHeroBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.summary"))}</Text>
      <Text style={context.styles.miniappFallbackText}>
        {toStringValue(block.body, toStringValue(block.text, context.t("renderer.noSummaryYet")))}
      </Text>
    </View>
  );
}

function MetricListBlockView({
  block,
  context,
  wide = false,
}: {
  block: MiniappBlock;
  context: RendererContext;
  wide?: boolean;
}) {
  const metricRows = getMetricRows(block);
  return (
    <View style={context.styles.miniappMetricGrid}>
      {metricRows.map((metric, index) => (
        <Metric
          key={String((metric as Record<string, unknown>).id || metric.label || index)}
          label={toStringValue((metric as Record<string, unknown>).label, toStringValue((metric as Record<string, unknown>).id))}
          styles={context.styles}
          value={getMetricValue(metric, context.computed)}
          wide={wide && index > 0}
        />
      ))}
    </View>
  );
}

function InputPanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fields = asArray(block.fields, MAX_CHILD_BLOCKS);
  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.inputs"))}</Text>
      {fields.map((field, fieldIndex) => {
        if (!field || typeof field !== "object") return null;
        const record = asRecord(field);
        const fieldId = toStringValue(record.id, `field_${fieldIndex}`);
        return (
          <NumberField
            key={fieldId}
            label={toStringValue(record.label, fieldId)}
            onChange={(value) => context.setInput(fieldId, value)}
            styles={context.styles}
            value={context.inputs[fieldId] ?? toNumber(record.value)}
          />
        );
      })}
    </View>
  );
}

function InputNumberBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fieldId = toStringValue(block.id, `input_${context.index}`);
  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.input"))}</Text>
      <NumberField
        label={toStringValue(block.label, fieldId)}
        onChange={(value) => context.setInput(fieldId, value)}
        styles={context.styles}
        value={context.inputs[fieldId] ?? toNumber(block.value)}
      />
    </View>
  );
}

function FormulaResultBlockView({ block, context, label }: { block: MiniappBlock; context: RendererContext; label: string }) {
  return (
    <View style={context.styles.miniappFormulaBox}>
      <Text style={context.styles.miniappFormulaLabel}>{toStringValue(block.title, label)}</Text>
      <Text style={context.styles.miniappFormulaText}>{toStringValue(block.value, context.t("renderer.noResult"))}</Text>
    </View>
  );
}

function FormulaTraceBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappFormulaBox}>
      <Text style={context.styles.miniappFormulaLabel}>{toStringValue(block.title, context.t("renderer.formula"))}</Text>
      {asArray(block.steps, MAX_TABLE_ROWS).map((step, stepIndex) => (
        <Text key={stepIndex} style={context.styles.miniappFormulaText}>
          {toStringValue((step as Record<string, unknown>)?.expr, context.t("renderer.calculationUnavailable"))}
        </Text>
      ))}
    </View>
  );
}

function WarningBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fallbackBody = toStringValue(block.label, toStringValue(block.value, toStringValue(block.status, context.t("renderer.warning"))));
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.warning"))}</Text>
      <Text style={context.styles.miniappFallbackText}>
        {toStringValue(block.body, toStringValue(block.message, toStringValue(block.text, fallbackBody)))}
      </Text>
    </View>
  );
}

function ActionRowBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const actions = asArray(block.actions, MAX_CHILD_BLOCKS).concat(asArray(block.actionItems, MAX_CHILD_BLOCKS));
  return (
    <View style={context.styles.miniappActionRow}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.actions"))}</Text>
      {actions.map((action, actionIndex) => {
        const actionRecord = asRecord(action);
        return (
          <Pressable
            accessibilityRole="button"
            key={String(actionRecord.id || actionRecord.label || actionIndex)}
            onPress={() => context.runAction(actionRecord as MiniappAction)}
            style={({ pressed }) => [context.styles.miniappPrimaryAction, pressed ? context.styles.miniappPrimaryActionPressed : null]}
          >
            <Text style={context.styles.miniappPrimaryActionText}>
              {toStringValue(actionRecord.label, String(actionRecord.id || `Action ${actionIndex + 1}`))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatisticsSummaryBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const initialValues = numericValuesFromBlock(block);
  const [rawValues, setRawValues] = useState(() => csvFromNumericValues(initialValues.length ? initialValues : [1.2, 1.5, 1.1, 1.8, 1.4]));
  const values = parseNumericCsv(rawValues);
  const stats = computeStatistics(values);
  const outlierText = stats.outlier
    ? `${formatMiniappNumber(stats.outlier.value)} (${stats.outlier.isOutlier ? context.t("renderer.flagged") : context.t("renderer.notSignificant")})`
    : context.t("renderer.needThreeValues");

  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.statistics"))}</Text>
      <View style={context.styles.miniappInputCard}>
        <Text style={context.styles.miniappInputLabel}>{context.t("renderer.values")}</Text>
        <TextInput
          keyboardType="numbers-and-punctuation"
          onChangeText={setRawValues}
          selectTextOnFocus
          style={context.styles.miniappInput}
          value={rawValues}
        />
      </View>
      <View style={context.styles.miniappMetricGrid}>
        <Metric label={context.t("renderer.mean")} styles={context.styles} value={formatMiniappNumber(stats.mean, 4)} />
        <Metric label={context.t("renderer.sampleSd")} styles={context.styles} value={formatMiniappNumber(stats.sampleStdDev, 4)} />
        <Metric label={context.t("renderer.outlier")} styles={context.styles} value={outlierText} wide />
      </View>
      <Text style={context.styles.miniappFallbackText}>
        Grubbs alpha 0.05: G {formatMiniappNumber(stats.outlier?.gStatistic)} / critical {formatMiniappNumber(stats.outlier?.criticalValue)}
      </Text>
    </View>
  );
}

function UnitConverterBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fields = asArray(block.fields, MAX_CHILD_BLOCKS).map(asRecord);
  const descriptor = [
    block.title,
    block.mode,
    block.from,
    block.to,
    block.kind,
    ...fields.flatMap((field) => [field.id, field.label, field.unit]),
  ]
    .map((value) => toStringValue(value).toLowerCase())
    .join(" ");
  const isDensityMassConversion =
    block.density !== undefined ||
    block.volume !== undefined ||
    /\b(density|mass|grams?|g\/ml|ethanol|volume_ml)\b/.test(descriptor);
  if (!isDensityMassConversion) {
    return <InputPanelBlockView block={block} context={context} />;
  }

  const fieldValue = (candidateIds: string[], fallback: number) => {
    const match = fields.find((field) => candidateIds.includes(toStringValue(field.id).toLowerCase()));
    return toNumber(match?.value ?? block[candidateIds[0]], fallback);
  };
  const [volume, setVolume] = useState(() => fieldValue(["volume", "volume_ml", "ml"], 500));
  const [density, setDensity] = useState(() => fieldValue(["density", "density_g_per_ml"], 0.789));
  const result = convertVolumeDensityToMass({
    density,
    densityUnit: toStringValue(block.densityUnit, "g/mL"),
    volume,
    volumeUnit: toStringValue(block.volumeUnit, "mL"),
  });

  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.massFromDensity"))}</Text>
      <NumberField label={context.t("renderer.volumeMl")} onChange={(value) => setVolume(toNumber(value, volume))} styles={context.styles} value={volume} />
      <NumberField label={context.t("renderer.densityGml")} onChange={(value) => setDensity(toNumber(value, density))} styles={context.styles} value={density} />
      <View style={context.styles.miniappFormulaBox}>
        <Text style={context.styles.miniappFormulaLabel}>{context.t("renderer.mass")}</Text>
        <Text style={context.styles.miniappMetricValue}>{result.ok ? `${formatMiniappNumber(result.mass, 4)} ${result.massUnit}` : context.t("renderer.unsupportedUnit")}</Text>
        <Text style={context.styles.miniappFormulaText}>{result.formula}</Text>
        {result.error ? <Text style={context.styles.miniappFallbackText}>{result.error.replace(/_/g, " ")}</Text> : null}
      </View>
    </View>
  );
}

function ScientificPlotBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const points = plotPointsFromBlock(block);
  const defaultFitType = toStringValue(block.fitType, "linear") === "quadratic" ? "quadratic" : "linear";
  const [fitType, setFitType] = useState<"linear" | "quadratic">(defaultFitType);
  const regression = fitRegression(points, fitType);
  const maxY = Math.max(...regression.points.map((point) => point.y), 1);

  return (
    <View style={context.styles.miniappPlotBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.chart"))}</Text>
      <View style={context.styles.miniappSegmentRow}>
        {(["linear", "quadratic"] as const).map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setFitType(option)}
            style={[context.styles.miniappSegment, fitType === option ? context.styles.miniappSegmentActive : null]}
          >
            <Text style={[context.styles.miniappSegmentText, fitType === option ? context.styles.miniappSegmentTextActive : null]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[context.styles.miniappPlotFrame, { alignItems: "flex-end", flexDirection: "row" }]}>
        {regression.points.map((point, index) => (
          <View
            key={`${point.x}-${point.y}-${index}`}
            style={[
              context.styles.miniappPlotLine,
              {
                height: Math.max(8, Math.round((point.y / maxY) * 88)),
                marginLeft: index === 0 ? 0 : 8,
                marginTop: 0,
                transform: [{ rotate: "0deg" }],
                width: 10,
              },
            ]}
          />
        ))}
      </View>
      <Text style={context.styles.miniappPlotText}>{regression.equation}</Text>
      <Text style={context.styles.miniappFallbackText}>R2 {formatMiniappNumber(regression.r2, 4)} from {regression.points.length} points.</Text>
    </View>
  );
}

function TableBlockView({ block, rows, context }: { block: MiniappBlock; rows: ReturnType<typeof normalizeTable>; context: RendererContext }) {
  return (
    <View style={context.styles.miniappTableBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.table"))}</Text>
      {rows.columns.length ? (
        <View style={context.styles.miniappTableHeaderRow}>
          {rows.columns.map((column, index) => (
            <Text key={index} numberOfLines={1} style={[context.styles.miniappTableCell, context.styles.miniappTableHeaderCell]}>
              {column.label}
            </Text>
          ))}
        </View>
      ) : null}
      {rows.rows.length ? (
        rows.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={context.styles.miniappTableRow}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} numberOfLines={1} style={context.styles.miniappTableCell}>
                {cell}
              </Text>
            ))}
          </View>
        ))
      ) : (
        <Text style={context.styles.miniappFallbackText}>{context.t("renderer.noRowsYet")}</Text>
      )}
      {rows.hasMoreRows || rows.hasMoreColumns ? (
        <Text style={context.styles.miniappTableOverflowNotice}>
          {context.t("renderer.showingUpTo", {
            rows: Math.min(rows.rows.length, MAX_TABLE_ROWS),
            cols: Math.min(rows.columns.length, MAX_TABLE_COLUMNS),
          })}
        </Text>
      ) : null}
    </View>
  );
}

function EvidencePanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const items = asArray(block.items, MAX_CHILD_BLOCKS);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.evidencePanel"))}</Text>
      <View style={context.styles.miniappEvidencePanel}>
        {items.length ? (
          items.map((entry, index) => {
            const record = asRecord(entry);
            const source = toStringValue(record.source, toStringValue(record.sourceText));
            const note = toStringValue(record.note, toStringValue(record.summary, toStringValue(record.text)));
            const statement = toStringValue(record.statement, toStringValue(record.title, toStringValue(entry, "")));
            return (
              <View key={`${record.id || index}`} style={context.styles.miniappEvidenceItem}>
                <Text style={context.styles.miniappFallbackText}>
                  <Text style={context.styles.miniappBlockTitle}>{statement}</Text>
                </Text>
                {source ? (
                  <Text style={context.styles.miniappFallbackText}>
                    {context.t("renderer.source")}: {source}
                  </Text>
                ) : null}
                {note ? <Text style={context.styles.miniappFallbackText}>{note}</Text> : null}
              </View>
            );
          })
        ) : (
          <Text style={context.styles.miniappFallbackText}>{context.t("renderer.noEvidenceNotes")}</Text>
        )}
      </View>
    </View>
  );
}

function HypothesisCardBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const statement = toStringValue(block.statement, toStringValue(block.hypothesis, "Untitled hypothesis"));
  const assumptions = asArray(block.assumptions, MAX_CHILD_BLOCKS);
  const prediction = toStringValue(block.prediction, toStringValue(block.expectedOutcome, "No measurable prediction provided."));
  return (
    <View style={context.styles.miniappHypothesisCard}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Hypothesis card")}</Text>
      <Text style={context.styles.miniappHypothesisStatement}>{statement}</Text>
      <Text style={context.styles.miniappFallbackText}>Prediction: {prediction}</Text>
      <View>
        {assumptions.length ? <Text style={context.styles.miniappBlockTitle}>Assumptions:</Text> : null}
        {assumptions.map((assumption, index) => (
          <Text key={index} numberOfLines={2} style={context.styles.miniappFallbackText}>
            • {toStringValue(assumption)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ExperimentMatrixBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const groupLabels = asStringList(block.groups).slice(0, MAX_CHILD_BLOCKS);
  const readoutLabels = asStringList(block.readouts).slice(0, MAX_CHILD_BLOCKS);
  const columns = groupLabels.length ? groupLabels : asStringList(block.columns).slice(0, MAX_CHILD_BLOCKS);
  const rows = asArray(block.rows, MAX_TABLE_ROWS).map((entry, rowIndex) => ({
    ...asRecord(entry),
    __index: rowIndex,
  })) as MatrixRow[];
  const headerValues = columns.length ? columns : readoutLabels.length ? readoutLabels : ["Condition", ...asStringList(block.conditions)];

  return (
    <View style={context.styles.miniappExperimentMatrix}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Experiment matrix")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={context.styles.miniappExperimentMatrixScroll}>
        <View>
          <View style={context.styles.miniappTableRow}>
            <Text style={[context.styles.miniappExperimentMatrixHeader, context.styles.miniappTableCell]}>Condition</Text>
            {headerValues.map((column) => (
              <Text
                key={`header-${column}`}
                style={[context.styles.miniappExperimentMatrixHeader, context.styles.miniappTableCell]}
              >
                {column}
              </Text>
            ))}
          </View>
            {rows.length ? (
              rows.map((row, rowIndex) => {
                const condition = toStringValue(row.condition, toStringValue(row.group, toStringValue(row.label, `Condition ${rowIndex + 1}`)));
                return (
                <View key={`row-${row.__index}`} style={context.styles.miniappTableRow}>
                  <Text style={[context.styles.miniappExperimentMatrixCell, context.styles.miniappTableCell]} numberOfLines={1}>
                    {condition}
                  </Text>
                    {headerValues.map((header) => (
                      <Text
                        key={`${row.__index}-${header}`}
                        numberOfLines={2}
                        style={[context.styles.miniappExperimentMatrixCell, context.styles.miniappTableCell]}
                      >
                        {toStringValue(row[header.toLowerCase()], toStringValue(row[header], "--"))}
                      </Text>
                    ))}
                </View>
              );
            })
          ) : (
            <Text style={context.styles.miniappFallbackText}>No matrix rows yet.</Text>
          )}
          {readoutLabels.length ? <Text style={context.styles.miniappFallbackText}>Readouts: {readoutLabels.join(", ")}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function WorkflowTimelineBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const items = asArray(block.items, MAX_TABLE_ROWS);
  const steps = items.length ? items : asArray(block.steps, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappPlannerTimeline}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Workflow timeline")}</Text>
      <View>
        {steps.length ? (
          steps.map((entry, index) => {
            const record = asRecord(entry);
            return (
              <View key={`${record.id || index}`} style={context.styles.miniappPlannerTimelineItem}>
                <Text style={context.styles.miniappFallbackText}>
                  <Text style={context.styles.miniappBlockTitle}>Day {index + 1}</Text>
                  {toStringValue(record.time, toStringValue(record.when)) ? ` • ${toStringValue(record.time, toStringValue(record.when))}` : ""}
                </Text>
                <Text numberOfLines={2} style={context.styles.miniappFallbackText}>
                  {toStringValue(record.action, toStringValue(record.title, toStringValue(record.label, "Pending action")))}
                </Text>
                {toStringValue(record.output) ? <Text style={context.styles.miniappFallbackText}>{toStringValue(record.output)}</Text> : null}
              </View>
            );
          })
        ) : (
          <Text style={context.styles.miniappFallbackText}>No timeline steps configured.</Text>
        )}
      </View>
    </View>
  );
}

function DecisionTreeBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const nodes = asArray(block.nodes, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappDecisionTree}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Decision tree")}</Text>
      {nodes.length ? (
        nodes.map((entry, index) => {
          const record = asRecord(entry);
          const title = toStringValue(record.title, toStringValue(record.when, `Node ${index + 1}`));
          const thenText = toStringValue(record.then, toStringValue(record.action, "Review output"));
          const tone = toLowerCase(toStringValue(record.tone, "normal"));
          const branchStyle =
            tone === "danger"
              ? context.styles.miniappRiskChipDanger
              : tone === "success"
                ? context.styles.miniappRiskChipGood
                : context.styles.miniappRiskChip;
          return (
            <View key={`${title}-${index}`} style={[context.styles.miniappDecisionTreeBranch, branchStyle]}>
              <Text numberOfLines={2} style={context.styles.miniappFallbackText}>
                if {title}
              </Text>
              <Text numberOfLines={2} style={context.styles.miniappFallbackText}>
                then {thenText}
              </Text>
            </View>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>No decision nodes yet.</Text>
      )}
    </View>
  );
}

function RiskPanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const items = asArray(block.items, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappRiskPanel}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Risk panel")}</Text>
      <View style={context.styles.miniappSegmentRow}>
        {items.length ? (
          items.map((entry, index) => {
            const record = asRecord(entry);
            const tone = toLowerCase(toStringValue(record.tone, "normal"));
            const chipStyle =
              tone === "danger"
                ? context.styles.miniappRiskChipDanger
                : tone === "warning"
                  ? context.styles.miniappRiskChipWarning
                  : context.styles.miniappRiskChipGood;
            return (
              <View key={`${record.id || index}`} style={[context.styles.miniappRiskChip, chipStyle]}>
                <Text style={context.styles.miniappFallbackText}>
                  {toStringValue(record.label, `risk-${index + 1}`)}
                </Text>
              </View>
            );
          })
        ) : (
          <Text style={context.styles.miniappFallbackText}>No risks identified.</Text>
        )}
      </View>
      {items.length ? (
        <Text style={context.styles.miniappFallbackText}>{items.length} check{items.length === 1 ? "" : "s"} available.</Text>
      ) : null}
    </View>
  );
}

function SegmentControlBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const optionLabels = asArray<unknown>(block.options, MAX_CHILD_BLOCKS).map((option) => {
    const optionRecord = asRecord(option);
    return toStringValue(optionRecord.label, toStringValue(optionRecord.value, toStringValue(option)));
  });
  const segmentLabels = asArray<unknown>(block.segments, MAX_CHILD_BLOCKS).map((segment) => {
    const segmentRecord = asRecord(segment);
    return toStringValue(segmentRecord.label, toStringValue(segmentRecord.value, toStringValue(segment)));
  });
  const segments = optionLabels.concat(segmentLabels);
  const visible = segments.slice(0, MAX_CHILD_BLOCKS);

  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Segmented control")}</Text>
      <View style={context.styles.miniappSegmentRow}>
        {visible.map((label, index) => (
          <View key={`${label}-${index}`} style={context.styles.miniappSegment}>
            <Text style={context.styles.miniappSegmentText}>{label || `Option ${index + 1}`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TabsBlockView({ block, context, depth }: { block: MiniappBlock; context: RendererContext; depth: number }) {
  const rawTabs = asArray(block.tabs, MAX_CHILD_BLOCKS).concat(asArray(block.items, MAX_CHILD_BLOCKS));
  const tabs = rawTabs.slice(0, MAX_CHILD_BLOCKS);
  const [activeIndex, setActiveIndex] = useState(0);

  if (depth >= MAX_BLOCK_DEPTH) {
    return fallbackDepthBlock(context);
  }
  if (!tabs.length) return <EmptyBlockFallback context={context} />;

  const safeIndex = Math.max(0, Math.min(activeIndex, tabs.length - 1));
  const activeTab = asRecord(tabs[safeIndex]);
  const activeChildren = getChildren(activeTab);

  return (
    <View style={context.styles.miniappTabBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, context.t("renderer.tabs"))}</Text>
      <View accessibilityRole="tablist" style={context.styles.miniappSegmentRow}>
        {tabs.map((item, index) => {
          const tabRecord = asRecord(item);
          const title = toStringValue(tabRecord.title, toStringValue(tabRecord.label, context.t("renderer.tabN", { n: index + 1 })));
          const selected = index === safeIndex;
          return (
            <Pressable
              accessibilityLabel={title}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={toStringValue(tabRecord.id, `tab-${index}`)}
              onPress={() => setActiveIndex(index)}
              style={[context.styles.miniappSegment, selected ? context.styles.miniappSegmentActive : null]}
            >
              <Text style={[context.styles.miniappSegmentText, selected ? context.styles.miniappSegmentTextActive : null]}>{title}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={context.styles.miniappTabPanel}>
        {activeChildren.length ? (
          activeChildren.map((child, childIndex) => (
            <MiniappBlockRenderer
              key={`tab-${safeIndex}-${childIndex}`}
              block={child}
              context={{ ...context, index: childIndex }}
              depth={depth + 1}
            />
          ))
        ) : (
          <EmptyBlockFallback context={context} />
        )}
      </View>
    </View>
  );
}

function ExpandableBlockView({ block, context, depth }: { block: MiniappBlock; context: RendererContext; depth: number }) {
  const children = getChildren(block);
  const initiallyOpen = block.initiallyOpen === undefined ? true : Boolean(block.initiallyOpen);
  const [open, setOpen] = useState(initiallyOpen);

  if (depth >= MAX_BLOCK_DEPTH) {
    return fallbackDepthBlock(context);
  }

  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <Text style={context.styles.miniappBlockTitle}>
          {toStringValue(block.title, context.t("renderer.details"))}
        </Text>
        <Text style={context.styles.miniappFallbackText}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? (
        children.length ? (
          children.map((child, childIndex) => (
            <MiniappBlockRenderer
              key={`${block.type || "expandable"}-${childIndex}`}
              block={child}
              context={{ ...context, index: childIndex }}
              depth={depth + 1}
            />
          ))
        ) : (
          <Text style={context.styles.miniappFallbackText}>{context.t("renderer.noDetailsYet")}</Text>
        )
      ) : null}
    </View>
  );
}

function CalculatorBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fields = asArray(block.fields, MAX_CHILD_BLOCKS).map(asRecord);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    fields.forEach((field, index) => {
      const id = toStringValue(field.id, `field_${index}`);
      seed[id] = toNumber(field.value);
    });
    return seed;
  });
  const formula = toStringValue(block.formula ?? block.expr, "");
  const live = formula ? evaluateCalculatorFormula(formula, values) : null;
  let displayValue: string;
  if (live && live.ok) {
    displayValue = formatMiniappNumber(live.value, 4);
  } else if (live && !live.ok) {
    displayValue = context.t("renderer.formulaUnsupported");
  } else {
    displayValue = toStringValue(block.value ?? block.result, context.t("renderer.noResult"));
  }

  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>
        {toStringValue(block.title, context.t("renderer.calculator"))}
      </Text>
      {fields.map((field, fieldIndex) => {
        const fieldId = toStringValue(field.id, `field_${fieldIndex}`);
        const unit = toStringValue(field.unit);
        const label = toStringValue(field.label, fieldId) + (unit ? ` (${unit})` : "");
        return (
          <NumberField
            key={fieldId}
            label={label}
            onChange={(value) =>
              setValues((current) => ({
                ...current,
                [fieldId]: toNumber(value, current[fieldId]),
              }))
            }
            styles={context.styles}
            value={values[fieldId] ?? toNumber(field.value)}
          />
        );
      })}
      {formula ? (
        <View style={context.styles.miniappFormulaBox}>
          <Text style={context.styles.miniappFormulaLabel}>{context.t("renderer.formula")}</Text>
          <Text style={context.styles.miniappFormulaText}>{formula}</Text>
        </View>
      ) : null}
      <View style={context.styles.miniappFormulaBox}>
        <Text style={context.styles.miniappFormulaLabel}>
          {toStringValue(block.label, context.t("renderer.result"))}
        </Text>
        <Text style={context.styles.miniappMetricValue}>{displayValue}</Text>
      </View>
    </View>
  );
}

function TimelineBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const entries = asArray(block.items, MAX_TABLE_ROWS)
    .concat(asArray(block.steps, MAX_TABLE_ROWS))
    .concat(asArray(block.events, MAX_TABLE_ROWS))
    .slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappPlannerTimeline}>
      <Text style={context.styles.miniappBlockTitle}>{context.t("miniapp.timelineTitle")}</Text>
      {entries.length ? (
        entries.map((entry, index) => {
          const record = asRecord(entry);
          return (
            <View key={`${record.id || index}`} style={context.styles.miniappPlannerTimelineItem}>
              <Text style={context.styles.miniappFallbackText}>
                <Text style={context.styles.miniappBlockTitle}>{context.t("miniapp.stepN", { n: index + 1 })}</Text>
                {toStringValue(record.time, toStringValue(record.when)) ? ` • ${toStringValue(record.time, toStringValue(record.when))}` : ""}
              </Text>
              <Text numberOfLines={2} style={context.styles.miniappFallbackText}>
                {toStringValue(record.title, toStringValue(record.label, ""))}
              </Text>
              {toStringValue(record.output) ? <Text style={context.styles.miniappFallbackText}>{toStringValue(record.output)}</Text> : null}
            </View>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>{context.t("miniapp.timelineEmpty")}</Text>
      )}
    </View>
  );
}

function QualityPanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const metrics = asArray(block.checks, MAX_TABLE_ROWS).concat(asArray(block.metrics, MAX_TABLE_ROWS)).slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappPlannerTimeline}>
      <Text style={context.styles.miniappBlockTitle}>{context.t("miniapp.qualityTitle")}</Text>
      {metrics.length ? (
        metrics.map((entry, index) => {
          const entryRecord = asRecord(entry);
          return (
            <View key={`${entryRecord.id || index}`} style={context.styles.miniappPlannerTimelineItem}>
              <Text numberOfLines={2} style={context.styles.miniappFallbackText}>
                {toStringValue(entryRecord.label, `metric-${index}`)}: {toStringValue(entryRecord.value, "--")}
              </Text>
            </View>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>{context.t("miniapp.qualityEmpty")}</Text>
      )}
    </View>
  );
}

function CitationsBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const citations = asArray(block.items, MAX_TABLE_ROWS).concat(asArray(block.citations, MAX_TABLE_ROWS)).slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappPlannerTimeline}>
      <Text style={context.styles.miniappBlockTitle}>{context.t("miniapp.citationsTitle")}</Text>
      {citations.length ? (
        citations.map((citation, citationIndex) => {
          const citationRecord = asRecord(citation);
          const statement = toStringValue(citationRecord.title, toStringValue(citationRecord.id, ""));
          const source = toStringValue(citationRecord.source, toStringValue(citationRecord.url, toStringValue(citationRecord.text)));
          const note = toStringValue(citationRecord.note, toStringValue(citationRecord.summary));
          return (
            <View key={`${citationRecord.id || citationIndex}`} style={context.styles.miniappEvidenceItem}>
              <Text style={context.styles.miniappFallbackText}>
                <Text style={context.styles.miniappBlockTitle}>{statement}</Text>
              </Text>
              {source ? (
                <Text style={context.styles.miniappFallbackText}>
                  {context.t("renderer.source")}: {source}
                </Text>
              ) : null}
              {note ? <Text style={context.styles.miniappFallbackText}>{note}</Text> : null}
            </View>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>{context.t("miniapp.citationsEmpty")}</Text>
      )}
    </View>
  );
}

function InsightBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "AI insight")}</Text>
      <Text style={context.styles.miniappFallbackText}>
        {toStringValue(block.body, toStringValue(block.summary, toStringValue(block.text, "No insight yet.")))}
      </Text>
    </View>
  );
}

function TableCellFallback({ children, context }: { children: string; context: RendererContext }) {
  return <Text style={context.styles.miniappFallbackText}>{children}</Text>;
}

function EmptyBlockFallback({ context }: { context: RendererContext }) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappFallbackText}>{context.t("renderer.noContentInBlock")}</Text>
    </View>
  );
}

function tableBlockRenderer({ block, context }: BlockRendererProps) {
    const rows = normalizeTable(block);
    return <TableBlockView block={block} context={context} rows={rows} />;
}

const DEFAULT_BLOCK_VISUAL: MiniappBlockVisualPreset = {
  accent: "zinc",
  density: "comfortable",
  liquidGlassSurface: "frosted_panel",
  motion: "none",
  role: "passive_content",
};

function defineMiniappBlock(entry: MiniappBlockRegistryDefinition): MiniappBlockRegistryEntry {
  return {
    ...entry,
    capabilities: {
      aiActionSupport: entry.aiActionSupport,
      backendActionSupport: entry.backendActionSupport,
      editable: entry.editable,
      exportSupport: entry.exportSupport,
      interactive: entry.editable || entry.aiActionSupport || entry.backendActionSupport,
      nestedBlocks: false,
      stateful: entry.editable,
      ...entry.capabilities,
    },
    visual: {
      ...DEFAULT_BLOCK_VISUAL,
      ...entry.visual,
    },
  };
}

export const ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY: Record<string, MiniappBlockRegistryEntry> = {
  action_bar: defineMiniappBlock({
    schemaFields: ["actions", "actionItems", "title"],
    exportSupport: false,
    editable: true,
    aiActionSupport: true,
    // No backend exists anymore (100% local app): don't advertise a backend-routed
    // capability that isn't real. Unhandled action ids still surface feedback via the
    // fallthrough in handleAskAssistantMiniappAction (miniappActions.ts).
    backendActionSupport: false,
    capabilities: { aiActionSupport: true, backendActionSupport: false, interactive: true, stateful: true },
    visual: { accent: "indigo", density: "compact", liquidGlassSurface: "command_bar", motion: "press", role: "command_bar" },
    render: ({ block, context }) => <ActionRowBlockView block={block} context={context} />,
  }),
  action_row: defineMiniappBlock({
    schemaFields: ["actions", "actionItems", "title"],
    exportSupport: false,
    editable: true,
    aiActionSupport: true,
    // See action_bar above: no backend to route to anymore.
    backendActionSupport: false,
    visual: { accent: "indigo", density: "compact", liquidGlassSurface: "command_bar", motion: "press", role: "inline_actions" },
    render: ({ block, context }) => <ActionRowBlockView block={block} context={context} />,
  }),
  ai_insight: defineMiniappBlock({
    schemaFields: ["body", "confidence", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "violet", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "ai_explanation" },
    render: ({ block, context }) => <InsightBlockView block={block} context={context} />,
  }),
  insight: defineMiniappBlock({
    schemaFields: ["body", "summary", "text", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "violet", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "insight" },
    render: ({ block, context }) => <InsightBlockView block={block} context={context} />,
  }),
  calculator: defineMiniappBlock({
    schemaFields: ["fields", "formula", "expr", "label", "title", "value", "result"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { editable: true, interactive: true, stateful: true },
    visual: { accent: "cyan", density: "comfortable", liquidGlassSurface: "floating_control", motion: "state_transition", role: "calculator" },
    render: ({ block, context }) => <CalculatorBlockView block={block} context={context} />,
  }),
  chart: defineMiniappBlock({
    schemaFields: ["fit", "kind", "points", "series", "title", "x", "y"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "spacious", liquidGlassSurface: "scientific_canvas", motion: "scroll", role: "scientific_plot" },
    render: ({ block, context }) => <ScientificPlotBlockView block={block} context={context} />,
  }),
  citations: defineMiniappBlock({
    schemaFields: ["citations", "items", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "zinc", density: "compact", liquidGlassSurface: "frosted_panel", motion: "none", role: "source_list" },
    render: ({ block, context }) => <CitationsBlockView block={block} context={context} />,
  }),
  data_table: defineMiniappBlock({
    schemaFields: ["columns", "rows", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "data_sheet", motion: "scroll", role: "data_table" },
    render: tableBlockRenderer,
  }),
  editable_table: defineMiniappBlock({
    schemaFields: ["columns", "rows", "title"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "data_sheet", motion: "state_transition", role: "editable_data_table" },
    render: tableBlockRenderer,
  }),
  expandable: defineMiniappBlock({
    schemaFields: ["blocks", "initiallyOpen", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { interactive: true, nestedBlocks: true, stateful: true },
    visual: { accent: "zinc", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "state_transition", role: "collapsible_section" },
    render: ({ block, context, depth }) => <ExpandableBlockView block={block} context={context} depth={depth} />,
  }),
  formula_result: defineMiniappBlock({
    schemaFields: ["formula", "label", "title", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "calculated_result" },
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label={context.t("renderer.formula")} />,
  }),
  formula_trace: defineMiniappBlock({
    schemaFields: ["steps", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "calculation_trace" },
    render: ({ block, context }) => <FormulaTraceBlockView block={block} context={context} />,
  }),
  formula: defineMiniappBlock({
    schemaFields: ["expr", "formula", "label", "title", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "formula" },
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label={context.t("renderer.formula")} />,
  }),
  hero_summary: defineMiniappBlock({
    schemaFields: ["body", "eyebrow", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "indigo", density: "spacious", liquidGlassSurface: "hero_glass", motion: "none", role: "hero_summary" },
    render: ({ block, context }) => <HeroSummaryBlockView block={block} context={context} />,
  }),
  input_panel: defineMiniappBlock({
    schemaFields: ["fields", "layout", "liveRecompute", "title"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "state_transition", role: "input_panel" },
    render: ({ block, context }) => <InputPanelBlockView block={block} context={context} />,
  }),
  input_table: defineMiniappBlock({
    schemaFields: ["columns", "rows", "title"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "data_sheet", motion: "state_transition", role: "input_table" },
    render: tableBlockRenderer,
  }),
  input_number: defineMiniappBlock({
    schemaFields: ["id", "label", "max", "min", "unit", "value"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "floating_control", motion: "state_transition", role: "number_input" },
    render: ({ block, context }) => <InputNumberBlockView block={block} context={context} />,
  }),
  metric: defineMiniappBlock({
    schemaFields: ["caption", "label", "tone", "unit", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "metric" },
    render: ({ block, context }) => <MetricListBlockView block={block} context={context} />,
  }),
  metric_strip: defineMiniappBlock({
    schemaFields: ["metrics", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "spacious", liquidGlassSurface: "metric_glass", motion: "none", role: "metric_strip" },
    render: ({ block, context }) => <MetricListBlockView block={block} context={context} wide />,
  }),
  // plate_grid rimosso: blocco bio legacy (well-plate designer). Non fa più parte
  // del formato miniapp generale; un blocco ricevuto con quel tipo cadrà nel
  // fallback "Unsupported miniapp block".
  quiz: defineMiniappBlock({
    schemaFields: ["answerIndex", "explanation", "options", "question", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { interactive: true, stateful: true },
    visual: { accent: "indigo", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "state_transition", role: "quiz" },
    render: ({ block, context }) => (
      <QuizBlockView block={block} styles={context.styles} t={context.t} />
    ),
  }),
  quality_panel: defineMiniappBlock({
    schemaFields: ["checks", "metrics", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "quality_checks" },
    render: ({ block, context }) => <QualityPanelBlockView block={block} context={context} />,
  }),
  result_card: defineMiniappBlock({
    schemaFields: ["caption", "formula", "label", "title", "tone", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "result_card" },
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label={context.t("renderer.formula")} />,
  }),
  result_table: defineMiniappBlock({
    schemaFields: ["columns", "rows", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "data_sheet", motion: "scroll", role: "result_table" },
    render: tableBlockRenderer,
  }),
  scientific_plot: defineMiniappBlock({
    schemaFields: ["fit", "fitType", "height", "kind", "points", "series", "title", "x", "y"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { editable: true, interactive: true, stateful: true },
    visual: { accent: "cyan", density: "spacious", liquidGlassSurface: "scientific_canvas", motion: "scroll", role: "scientific_plot" },
    render: ({ block, context }) => <ScientificPlotBlockView block={block} context={context} />,
  }),
  statistics_summary: defineMiniappBlock({
    schemaFields: ["data", "method", "title", "values"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { editable: true, interactive: true, stateful: true },
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "state_transition", role: "statistics_summary" },
    render: ({ block, context }) => <StatisticsSummaryBlockView block={block} context={context} />,
  }),
  segmented_control: defineMiniappBlock({
    schemaFields: ["id", "label", "options", "value"],
    exportSupport: false,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "indigo", density: "compact", liquidGlassSurface: "floating_control", motion: "state_transition", role: "segmented_control" },
    render: ({ block, context }) => <SegmentControlBlockView block={block} context={context} />,
  }),
  table: defineMiniappBlock({
    schemaFields: ["columns", "rows", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "compact", liquidGlassSurface: "data_sheet", motion: "scroll", role: "table" },
    render: tableBlockRenderer,
  }),
  tabs: defineMiniappBlock({
    schemaFields: ["id", "items", "tabs", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { interactive: true, nestedBlocks: true, stateful: true },
    visual: { accent: "indigo", density: "compact", liquidGlassSurface: "floating_control", motion: "state_transition", role: "same_miniapp_tabs" },
    render: ({ block, context, depth }) => <TabsBlockView block={block} context={context} depth={depth} />,
  }),
  timeline: defineMiniappBlock({
    schemaFields: ["items", "steps", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "violet", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "timeline" },
    render: ({ block, context }) => <TimelineBlockView block={block} context={context} />,
  }),
  // pathway_graph, mechanism_legend e legend_editor rimossi: blocchi bio legacy.
  // Il codice dell'editor (funzioni *Pathway*) resta dormiente nel file ma non è
  // più raggiungibile dal registro; cleanup completo in una passata futura.
  evidence_panel: defineMiniappBlock({
    schemaFields: ["items", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "violet", density: "spacious", liquidGlassSurface: "frosted_panel", motion: "none", role: "evidence_panel" },
    render: ({ block, context }) => <EvidencePanelBlockView block={block} context={context} />,
  }),
  hypothesis_card: defineMiniappBlock({
    schemaFields: ["assumptions", "hypothesis", "prediction", "statement", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "lime", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "hypothesis_card" },
    render: ({ block, context }) => <HypothesisCardBlockView block={block} context={context} />,
  }),
  experiment_matrix: defineMiniappBlock({
    schemaFields: ["columns", "groups", "readouts", "rows", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "cyan", density: "spacious", liquidGlassSurface: "data_sheet", motion: "scroll", role: "experiment_matrix" },
    render: ({ block, context }) => <ExperimentMatrixBlockView block={block} context={context} />,
  }),
  workflow_timeline: defineMiniappBlock({
    schemaFields: ["items", "steps", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "indigo", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "workflow_timeline" },
    render: ({ block, context }) => <WorkflowTimelineBlockView block={block} context={context} />,
  }),
  decision_tree: defineMiniappBlock({
    schemaFields: ["nodes", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "rose", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "state_transition", role: "decision_tree" },
    render: ({ block, context }) => <DecisionTreeBlockView block={block} context={context} />,
  }),
  decision_banner: defineMiniappBlock({
    schemaFields: ["body", "label", "status", "title", "tone", "value"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "rose", density: "comfortable", liquidGlassSurface: "metric_glass", motion: "none", role: "decision_banner" },
    render: ({ block, context }) => <WarningBlockView block={block} context={context} />,
  }),
  risk_panel: defineMiniappBlock({
    schemaFields: ["items", "title", "type"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "violet", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "risk_panel" },
    render: ({ block, context }) => <RiskPanelBlockView block={block} context={context} />,
  }),
  unit_converter: defineMiniappBlock({
    schemaFields: ["density", "densityUnit", "fields", "from", "options", "title", "to", "value", "volume", "volumeUnit"],
    exportSupport: true,
    editable: true,
    aiActionSupport: false,
    backendActionSupport: false,
    capabilities: { editable: true, interactive: true, stateful: true },
    visual: { accent: "cyan", density: "comfortable", liquidGlassSurface: "floating_control", motion: "state_transition", role: "unit_converter" },
    render: ({ block, context }) => <UnitConverterBlockView block={block} context={context} />,
  }),
  warning: defineMiniappBlock({
    schemaFields: ["body", "title", "tone"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "rose", density: "comfortable", liquidGlassSurface: "frosted_panel", motion: "none", role: "warning" },
    render: ({ block, context }) => <WarningBlockView block={block} context={context} />,
  }),
  html: defineMiniappBlock({
    schemaFields: ["height", "html", "source", "title"],
    exportSupport: true,
    editable: false,
    aiActionSupport: false,
    backendActionSupport: false,
    visual: { accent: "zinc", density: "spacious", liquidGlassSurface: "frosted_panel", motion: "none", role: "html_document" },
    render: ({ block, context }) => <HtmlBlockView block={block} context={context} />,
  }),
};

export const ASK_ASSISTANT_MINIAPP_SUPPORTED_BLOCK_TYPES = Object.freeze(Object.keys(ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY));

// ── Generic block: html ──────────────────────────────────────────────────
// Renderizza un documento HTML generato dal modello in una WebView sandbox.
// Sicurezza (Phase 0): JavaScript disabilitato, nessun accesso ai file,
// nessuno storage, nessuna navigazione esterna e CSP rigida (niente risorse
// remote, solo data: per le immagini). Fase 3: se serviranno HTML interattivi
// (chart JS), abilitare con una policy rivista + consenso esplicito.
/** Allow only opaque 6-digit hex into the HTML wrapper style block (no rgb/rgba). */
function sanitizeCssColor(value: string, fallback: string): string {
  const v = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return fallback;
}

// CSP must stay byte-identical (audit-verified end-to-end). Only theme colours in <style> change.
const HTML_BLOCK_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'";

function HtmlBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const html = toStringValue(block.html ?? block.source ?? "");
  const height = Math.max(160, Math.min(1200, Math.floor(Number(block.height) || 480)));
  // Opaque tokens only — translucent panel/line composite to white under WebView's canvas.
  const pageBg = sanitizeCssColor(context.colors.panelSolid, "#FFFFFF");
  const textColor = sanitizeCssColor(context.colors.ink, "#17201C");
  const linkColor = sanitizeCssColor(context.colors.accent, "#1F5F4E");
  const preBg = sanitizeCssColor(context.colors.surfaceSunken, "#D8E0D7");
  // line is translucent in dark; muted is opaque hex in both palettes.
  const borderColor = sanitizeCssColor(context.colors.muted, "#58615B");
  const backgroundColor = pageBg;
  const wrapped = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}"><style>html,body{margin:0;padding:12px;background:${pageBg};color:${textColor};font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55}img{max-width:100%}a{color:${linkColor}}pre{white-space:pre-wrap;background:${preBg};padding:10px;border-radius:10px;overflow-x:auto}table{border-collapse:collapse}td,th{border:1px solid ${borderColor};padding:6px 10px}</style></head><body>${html}</body></html>`;
  // Navigation lock: permit about:/data: only while the initial source.html is
  // bootstrapping (RN may hit about:blank then data:). Once the document has
  // loaded (or a data: body was accepted), EVERY further request is denied —
  // including later data: navigations, javascript:, http(s), file. JS is off so
  // iframes/popups cannot open; CSP remains in the injected head.
  const navigationLockedRef = useRef(false);

  if (!html.trim()) {
    return <Text style={context.styles.miniappFallbackText}>{context.t("renderer.emptyHtmlBlock")}</Text>;
  }

  return (
    <View style={{ borderRadius: 14, overflow: "hidden", alignSelf: "stretch" }}>
      <WebView
        originWhitelist={["about:", "data:"]}
        source={{ html: wrapped }}
        style={{ height, backgroundColor }}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        onLoadEnd={() => {
          navigationLockedRef.current = true;
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (navigationLockedRef.current) return false;
          const url = request.url || "";
          if (url.startsWith("about:") || url.startsWith("data:")) {
            // Accept bootstrap; lock as soon as real content (data:) is requested.
            if (url.startsWith("data:")) navigationLockedRef.current = true;
            return true;
          }
          return false;
        }}
      />
    </View>
  );
}

function UnsupportedBlock({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappFallbackText}>
        {context.t("renderer.unsupportedBlock", { type: toStringValue(block.type, "unknown") })}
      </Text>
    </View>
  );
}

function MiniappBlockSurface({
  capabilities,
  children,
  context,
  visual,
}: {
  capabilities: MiniappBlockCapabilities;
  children: React.ReactElement;
  context: RendererContext;
  visual: MiniappBlockVisualPreset;
}) {
  const styleNames = [
    "miniappBlockSurfaceBase",
    ...(miniappSurfaceStylesByKind[visual.liquidGlassSurface] ?? miniappSurfaceStylesByKind.frosted_panel),
    miniappSurfaceDensityStyles[visual.density],
    miniappSurfaceAccentStyles[visual.accent],
    capabilities.interactive ? "miniappSurfaceInteractive" : null,
    capabilities.stateful ? "miniappSurfaceStateful" : null,
  ];
  const surfaceStyles = styleNames
    .map((styleName) => (styleName ? context.styles[styleName] : null))
    .filter(Boolean);

  return <View style={surfaceStyles}>{children}</View>;
}

function MiniappBlockRenderer({ block, depth, context }: MiniappBlockRendererProps) {
  // Final defense: coerce null/string/corrupt blocks before registry lookup.
  const safeBlock = sanitizeRenderBlock(block, depth);
  const blockType = toStringValue(safeBlock.type, "unknown") || "unknown";
  const registryEntry = ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY[blockType];
  if (!registryEntry) {
    return <UnsupportedBlock block={safeBlock} context={context} />;
  }
  const content = registryEntry.render({
    block: safeBlock,
    capabilities: registryEntry.capabilities,
    context,
    depth,
    visual: registryEntry.visual
  });

  return (
    <MiniappBlockSurface
      capabilities={registryEntry.capabilities}
      context={context}
      visual={registryEntry.visual}
    >
      {content}
    </MiniappBlockSurface>
  );
}

function GlassSurface({
  children,
  colors,
  styles,
  variant,
}: {
  children: React.ReactNode;
  colors: Props["colors"];
  styles: Record<string, any>;
  variant?: "ios" | "android" | "vision";
}) {
  const resolvedVariant = variant || Platform.select({ ios: "ios", android: "android", default: "android" });
  const { palette } = useLabTheme<{ palette?: { blurTint?: "light" | "dark" } }>();
  const blurTint: "light" | "dark" = palette?.blurTint === "dark" ? "dark" : "light";
  const { panelBright, panel, panelSoft } = colors;

  if (resolvedVariant === "vision") {
    return (
      <BlurView intensity={52} tint={blurTint} style={styles.miniappVisionShell}>
        <LinearGradient
          colors={[panelBright, panel, panelSoft]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.miniappGlassOverlay}
        />
        <View style={styles.miniappVisionHighlight} />
        <View style={styles.miniappVisionInner}>{children}</View>
      </BlurView>
    );
  }

  if (resolvedVariant === "ios") {
    return (
      <BlurView intensity={40} tint={blurTint} style={styles.miniappIosShell}>
        <LinearGradient
          colors={[panelBright, panel, panelSoft]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.miniappGlassOverlay}
        />
        <View style={styles.miniappIosInner}>{children}</View>
      </BlurView>
    );
  }

  return (
    <View style={styles.miniappAndroidShell}>
      <LinearGradient
        colors={[panel, panelSoft, panelSoft]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.miniappGlassOverlay}
      />
      <View style={styles.miniappAndroidGlow} />
      <View style={styles.miniappAndroidInner}>{children}</View>
    </View>
  );
}

export function AskAssistantMiniappRenderer({
  colors,
  glassVariant,
  miniapp,
  onAction,
  styles,
}: Props) {
  const { t, locale } = useLocale();
  const windowDimensions = useWindowDimensions();
  const [localMiniapp, setLocalMiniapp] = useState<Miniapp>(() => normalizeMiniappState(miniapp));
  const [inputs, setInputs] = useState<Record<string, number>>(() => seedInputs(miniapp));
  const miniappExportSurfaceRef = useRef<View>(null);
  const navigationItems = useMemo(() => parseNavigationItems(localMiniapp.navigation), [localMiniapp.navigation]);
  const [activeView, setActiveView] = useState(() => deriveInitialNavigationView(localMiniapp.state?.activeView, navigationItems));
  const [statusText, setStatusText] = useState("");
  useEffect(() => {
    const normalized = normalizeMiniappState(miniapp);
    const items = parseNavigationItems(normalized.navigation);
    setLocalMiniapp(normalized);
    setInputs(seedInputs(normalized));
    setActiveView(deriveInitialNavigationView(normalized.state?.activeView, items));
    setStatusText("");
  }, [miniapp]);

  const computed = useMemo<ComputedMiniapp>(
    () => {
      const merged: ComputedMiniapp = { ...((localMiniapp.computed ?? {}) as ComputedMiniapp) };
      for (const [key, value] of Object.entries(inputs)) {
        if (typeof value === "number") merged[key] = value;
      }
      return merged;
    },
    [inputs, localMiniapp.computed],
  );

  const setInput = (key: string, value: string) => {
    setInputs((current) => ({
      ...current,
      [key]: toNumber(value, current[key]),
    }));
  };

  const runAction = (action: MiniappAction) => {
    const execute = async () => {
      // requiresAi actions run on the chat side: surface the i18n hint instead of
      // the generic "not supported" fallback. No local AI backend here.
      if (action.requiresAi) {
        setStatusText(t("miniapp.actionRequiresAi"));
        return;
      }
      const actionId = getActionId(action);
      if (
        actionId === LOCAL_ACTIONS.EXPORT_PNG ||
        actionId === LOCAL_ACTIONS.EXPORT_JPEG ||
        actionId === LOCAL_ACTIONS.EXPORT_SVG ||
        actionId === LOCAL_ACTIONS.EXPORT_JSON
      ) {
        try {
          if (!miniappExportSurfaceRef.current || Platform.OS === "web") {
            setStatusText(t("miniapp.exportNativeOnly"));
            return;
          }

          if (actionId === LOCAL_ACTIONS.EXPORT_PNG || actionId === LOCAL_ACTIONS.EXPORT_JPEG) {
            const format = actionId === LOCAL_ACTIONS.EXPORT_JPEG ? "jpg" : "png";
            const imageUri = await captureRef(miniappExportSurfaceRef.current, {
              format,
              quality: 1,
              result: "tmpfile",
            });
            // PNG/JPEG are fully handled here (capture + share): do not also notify
            // onAction, which would route to handleAskAssistantMiniappAction and could
            // double-handle the export if a handler is ever added there.
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(imageUri, {
                dialogTitle: t("miniapp.exportDialogTitle", { format: format.toUpperCase() }),
                mimeType: format === "png" ? "image/png" : "image/jpeg",
              });
            }
            setStatusText(t("miniapp.exportedAs", { format: format.toUpperCase() }));
            return;
          }

          // Only SVG/JSON reach here: PNG/JPEG already returned in the branch above.
          const extension = actionId === LOCAL_ACTIONS.EXPORT_SVG ? "svg" : "json";
          const targetUri = buildMiniappExportFileName(localMiniapp, extension);
          const payload = actionId === LOCAL_ACTIONS.EXPORT_SVG ? buildMiniappSvgText(localMiniapp) : JSON.stringify(localMiniapp, null, 2);
          await FileSystem.writeAsStringAsync(targetUri, payload, { encoding: "utf8" });
          // SVG/JSON are fully handled here (write + share): do not also notify onAction,
          // which routes to handleAskAssistantMiniappAction and (for JSON) used to
          // re-derive a filename, re-write the file, and re-open the share sheet.
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(targetUri, {
              dialogTitle: t("miniapp.exportDialogTitle", { format: extension.toUpperCase() }),
              mimeType: extension === "svg" ? "image/svg+xml" : "application/json",
            });
          }
          setStatusText(t("miniapp.exportedAs", { format: extension.toUpperCase() }));
        } catch {
          setStatusText(t("miniapp.couldNotExport"));
        }
        return;
      }

      if (isMiniappExportAction(action) || getActionId(action) === LOCAL_ACTIONS.GENERATE_REPORT) {
        setStatusText(t("miniapp.preparingAction"));
      }
      onAction?.(action, localMiniapp);
    };
    if (action.requiresConfirm) {
      Alert.alert(
        action.label || t("miniapp.runAction"),
        t("miniapp.confirmAction"),
        [
          { style: "cancel", text: t("common.cancel") },
          { onPress: () => { void execute(); }, text: t("common.continue") },
        ],
      );
      return;
    }
    void execute();
  };

  const blockContext: RendererContext = {
    colors,
    computed,
    index: 0,
    inputs,
    locale,
    t,
    runAction,
    setInput,
    styles,
  };
  const visibleBlocks = asArray<MiniappBlock>(localMiniapp.blocks, MAX_CHILD_BLOCKS).filter((block) =>
    isBlockVisibleInActiveView(block, activeView),
  );

  return (
    <GlassSurface colors={colors} styles={styles} variant={glassVariant}>
      <View accessibilityLabel={t("renderer.interactiveMiniappA11y", { title: localMiniapp.title })} ref={miniappExportSurfaceRef}>
        <View style={styles.miniappHeader}>
          <View style={styles.miniappIconBadge}>
            <Ionicons color={colors.ink} name="sparkles-outline" size={18} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.miniappEyebrow}>{t("renderer.interactiveMiniapp")}</Text>
            <Text style={styles.miniappTitle}>{localMiniapp.title}</Text>
            <Text style={styles.miniappSubtitle}>{String(localMiniapp.kind || "").replace(/_/g, " ")}</Text>
          </View>
        </View>

        {navigationItems.length ? (
          <View style={styles.miniappSegmentRow}>
            {navigationItems.map((item) => {
              const selected = item.id === activeView;
              return (
                <Pressable
                  accessibilityLabel={item.label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={item.id}
                  onPress={() => setActiveView(item.id)}
                  style={[styles.miniappSegment, selected ? styles.miniappSegmentActive : null]}
                >
                  <Text style={[styles.miniappSegmentText, selected ? styles.miniappSegmentTextActive : null]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {visibleBlocks.map((block, index) => (
          <MiniappBlockRenderer key={`${toStringValue(block.type, "block")}-${index}`} block={asRecord(block)} context={{ ...blockContext, index }} depth={0} />
        ))}

        {statusText ? (
          <View style={styles.miniappFallbackBlock}>
            <Text style={styles.miniappFallbackText}>{statusText}</Text>
          </View>
        ) : null}

        {localMiniapp.actions?.length ? (
          <View style={styles.miniappActionRow}>
            {localMiniapp.actions.map((action, actionIndex) => (
              <Pressable
                accessibilityRole="button"
                key={String(action.id || action.label || actionIndex)}
                onPress={() => runAction(action)}
                style={({ pressed }) => [styles.miniappPrimaryAction, pressed ? styles.miniappPrimaryActionPressed : null]}
              >
                <Text style={styles.miniappPrimaryActionText}>{String(action.label || action.id || t("renderer.run"))}</Text>
                {action.requiresAi ? <Ionicons color={colors.ink} name="sparkles-outline" size={14} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </GlassSurface>
  );
}

function Metric({
  label,
  styles,
  value,
  wide = false,
}: {
  label: string;
  styles: Record<string, any>;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={wide ? styles.miniappMetricCardWide : styles.miniappMetricCard}>
      <Text style={styles.miniappMetricLabel}>{label}</Text>
      <Text style={styles.miniappMetricValue}>{value}</Text>
    </View>
  );
}

function NumberField({
  label,
  onChange,
  styles,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  styles: Record<string, any>;
  value: number;
}) {
  return (
    <View style={styles.miniappInputCard}>
      <Text style={styles.miniappInputLabel}>{label}</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={onChange}
        selectTextOnFocus
        value={String(value)}
        style={styles.miniappInput}
      />
    </View>
  );
}
