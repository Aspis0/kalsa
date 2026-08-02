import Ionicons from "@expo/vector-icons/Ionicons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { computeStatistics, convertVolumeDensityToMass, fitRegression } from "../domain/miniappMathCore";

const MAX_BLOCK_DEPTH = 3;
const MAX_CHILD_BLOCKS = 24;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLUMNS = 12;
const MAX_WELLS = 384;
const MAX_PATHWAY_NODES = 40;
const MAX_PATHWAY_EDGES = 80;

type MiniappAction = {
  id?: string;
  label?: string;
  requiresAi?: boolean;
  requiresConfirm?: boolean;
  pattern?: string;
  primary?: boolean;
  advanced?: boolean;
  exportFormat?: "png" | "jpg" | "jpeg" | "svg" | "json" | "csv";
  resultUri?: string;
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
  colors: {
    ink?: string;
    primaryText: string;
  };
  glassVariant?: "ios" | "android" | "vision";
  miniapp: Miniapp;
  onAction?: (action: MiniappAction, miniapp: Miniapp) => void;
  styles: Record<string, any>;
};

type ComputedMiniapp = Record<string, unknown>;

type PathwayViewport = {
  canvasPadding: number;
  fontScale: number;
  graphMaxHeight: number;
  graphMinHeight: number;
  height: number;
  isLandscape: boolean;
  isPhone: boolean;
  isSmallPhone: boolean;
  isTablet: boolean;
  layerWidth: number;
  nodeGapY: number;
  nodeHeight: number;
  nodeWidth: number;
  width: number;
};

type RendererContext = {
  computed: ComputedMiniapp;
  inputs: Record<string, number>;
  index: number;
  pathwayViewport: PathwayViewport;
  runAction: (action: MiniappAction) => void;
  setInput: (key: string, value: string) => void;
  selectedPathwayNodeId: string | null;
  selectedPathwayEdgeId: string | null;
  pathwayEditor: {
    pathwayAddSourceId: string | null;
    pathwayAddTargetId: string | null;
    addEdge: () => void;
    addNode: () => void;
    deleteSelected: () => void;
    moveSelectedNode: (direction: "down" | "left" | "right" | "up") => void;
    setDraftEndpoint: (key: "fromId" | "toId", value: string) => void;
    setEdgeLabel: (value: string) => void;
    setEdgeKind: (kind: string) => void;
    setNodeLabel: (value: string) => void;
    setNodeKind: (kind: string) => void;
    onSelectNode: (nodeId: string) => void;
    onSelectEdge: (edgeId: string) => void;
  };
  styles: Record<string, any>;
};

type PathwayNode = {
  id: string;
  label: string;
  kind?: "gene" | "protein" | "drug" | "process" | "phenotype" | "sample" | string;
  layer?: number;
  slot?: number;
};

type PathwayEdge = {
  id: string;
  from: string;
  to: string;
  kind?: "activation" | "inhibition" | "binding" | "phosphorylation" | "transcription" | "unknown";
  label?: string;
};

type PathwayEditorActionResult = {
  selectedPathwayNodeId?: string | null;
  selectedPathwayEdgeId?: string | null;
  pathwayAddSourceId?: string | null;
  pathwayAddTargetId?: string | null;
};

type PathwayDraftEndpoint = "fromId" | "toId";

type ActionResult = {
  miniapp: Miniapp;
  status: string;
} & PathwayEditorActionResult;

const PATHWAY_NODE_KIND_OPTIONS = ["gene", "protein", "drug", "process", "phenotype", "sample"] as const;
const PATHWAY_EDGE_KIND_OPTIONS = ["activation", "inhibition", "binding", "phosphorylation", "transcription", "unknown"] as const;

type PathwayNodeKind = (typeof PATHWAY_NODE_KIND_OPTIONS)[number];
type PathwayEdgeKind = (typeof PATHWAY_EDGE_KIND_OPTIONS)[number];

type PathwayEditorState = {
  selectedPathwayNodeId: string | null;
  selectedPathwayEdgeId: string | null;
  pathwayAddSourceId: string | null;
  pathwayAddTargetId: string | null;
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

const LETTER_ROWS = "ABCDEFGHIJKLMNOP";
const LOCAL_ACTIONS = {
  ADD_SAMPLE: "add_sample",
  AUTO_FILL_REPLICATES: "auto_fill_replicates",
  CLEAR_PLATE: "clear_plate",
  ADD_NODE: "add_node",
  ADD_EDGE: "add_edge",
  RENAME_NODE: "rename_node",
  SET_NODE_KIND: "set_node_kind",
  SET_EDGE_KIND: "set_edge_kind",
  MOVE_NODE: "move_node",
  DELETE_SELECTED: "delete_selected",
  EXPORT_PNG: "export_png",
  EXPORT_JPEG: "export_jpeg",
  EXPORT_SVG: "export_svg",
  EXPORT_JSON: "export_json",
  EXPORT_CSV: "export_csv",
  EXPORT_PLATE_MAP: "export_plate_map",
  GENERATE_REPORT: "generate_report",
};

const TABLE_ACTION_BLOCK_TYPES = new Set(["table", "data_table", "result_table", "input_table", "editable_table"]);
const WELL_CELL_CANDIDATE_KEYS = ["well", "well_id", "well-id", "wellid"];
const SAMPLE_FIELD_CANDIDATES = ["sample", "sample_name", "sampleid", "sample_id", "sampleid", "sample name", "sample-name", "sample-id"];
const REPLICATE_COLUMN_CANDIDATES = ["biological_replicate", "technical_replicate", "replicate", "replicate_number", "replicate-number"];
const STATUS_HIDE_TIMEOUT_MS = 3000;

type PlateMapState = {
  columns: string[];
  rows: string[];
};

type PlateWell = {
  col: string;
  id: string;
  label: string;
  row: string;
  rowLabel: string;
  sample: string;
  well: string;
  wellLabel: string;
};

type MatrixRow = Record<string, unknown> & {
  __index: number;
};

function derivePathwayViewport(width: number, height: number, fontScale = 1): PathwayViewport {
  const isSmallPhone = width < 380;
  const isPhone = width < 768;
  const isTablet = width >= 768;
  const isLandscape = width > height;
  const compactScale = Math.min(Math.max(fontScale, 1), 1.25);
  const fontScaleBoost = Math.round((compactScale - 1) * 28);
  return {
    canvasPadding: isSmallPhone ? 8 : 12,
    fontScale: compactScale,
    graphMaxHeight: (isTablet ? 520 : isLandscape ? 300 : isSmallPhone ? 280 : 340) + fontScaleBoost * 2,
    graphMinHeight: (isSmallPhone ? 170 : 190) + fontScaleBoost,
    height,
    isLandscape,
    isPhone,
    isSmallPhone,
    isTablet,
    layerWidth: isTablet ? 230 : isSmallPhone ? 154 : 190,
    nodeGapY: isSmallPhone ? 10 : 12,
    nodeHeight: (isTablet ? 86 : isSmallPhone ? 72 : 76) + fontScaleBoost,
    nodeWidth: isTablet ? 164 : isSmallPhone ? 120 : 132,
    width,
  };
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

function normalizeMiniappState(miniapp: Miniapp): Miniapp {
  const stateInputs = asRecord(miniapp.state?.inputs);
  const activeView = toStringValue(miniapp.state?.activeView, "");
  return {
    ...miniapp,
    blocks: asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS),
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

function axisLabelsFromValue(value: unknown, axis: "columns" | "rows", fallbackCount: number): string[] {
  const explicit = asStringList(value).filter(Boolean);
  if (explicit.length) return explicit;
  const numeric = toNumber(value, fallbackCount);
  const count = Math.max(1, Math.min(axis === "rows" ? 16 : 24, Math.round(numeric)));
  if (axis === "rows") return LETTER_ROWS.slice(0, count).split("");
  return Array.from({ length: count }, (_, index) => String(index + 1));
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
    actionId === LOCAL_ACTIONS.EXPORT_PLATE_MAP ||
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
  const blocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS).slice(0, 80);
  const blockRows = blocks.map((block, index) => {
    const blockType = escapeXmlText(toStringValue(block.type, `block_${index + 1}`));
    const blockTitle = escapeXmlText(toStringValue(block.title, blockType));
    const y = 48 + index * 24;
    return `<text x="20" y="${y}" fill="#111827" font-size="14">${blockTitle} (${blockType})</text>`;
  });
  const summary = escapeXmlText(JSON.stringify(miniapp, null, 2));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="900" height="720" viewBox="0 0 900 720">\n  <rect width="900" height="720" fill="#ffffff"/>\n  <text x="20" y="28" fill="#111827" font-size="20">${title}</text>\n  <text x="20" y="48" fill="#4b5563" font-size="12">kind: ${kind}</text>\n  ${blockRows.join("\\n  ")}\n  <text x="20" y="660" fill="#6b7280" font-size="10">${summary}</text>\n</svg>`;
}

function normalizePathwayNode(raw: unknown): PathwayNode | null {
  const record = asRecord(raw);
  const id = toStringValue(record.id, toStringValue(record.label, ""));
  if (!id) return null;
  return {
    id,
    label: toStringValue(record.label, id),
    kind: PATHWAY_NODE_KIND_OPTIONS.includes(toStringValue(record.kind || "protein").toLowerCase() as PathwayNodeKind)
      ? (toStringValue(record.kind).toLowerCase() as PathwayNodeKind)
      : "protein",
    layer: Number.isFinite(toNumber(record.layer)) ? clampRange(toNumber(record.layer), 0, 4) : 0,
    slot: Number.isFinite(toNumber(record.slot, -1)) ? clampRange(toNumber(record.slot), 0, 15) : 0,
  };
}

function normalizePathwayEdge(raw: unknown, fallbackId: string): PathwayEdge | null {
  const record = asRecord(raw);
  const from = toStringValue(record.from);
  const to = toStringValue(record.to);
  if (!from || !to) return null;
  const kind = toStringValue(record.kind, "unknown").toLowerCase();
  return {
    id: toStringValue(record.id, fallbackId),
    from,
    to,
    label: toStringValue(record.label),
    kind: (kind === "activation" || kind === "inhibition" || kind === "binding" || kind === "phosphorylation" || kind === "transcription" || kind === "unknown")
      ? kind
      : "unknown",
  };
}

function getPathwayGraphBlock(miniapp: Miniapp): MiniappBlock | null {
  const blocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS);
  return blocks.find((block) => block.type === "pathway_graph") || null;
}

function getPathwayEdgeId(edge: PathwayEdge, fallbackIndex = 0): string {
  return toStringValue(edge.id, `edge_${fallbackIndex}`);
}

function parsePathwayGraphNodes(block: MiniappBlock): PathwayNode[] {
  return asArray(block.nodes, MAX_PATHWAY_NODES)
    .map(normalizePathwayNode)
    .filter((node): node is PathwayNode => Boolean(node))
    .map((node) => ({
      ...node,
      kind: toLowerCase(node.kind || "protein") || "protein",
      layer: clampRange(node.layer ?? 0, 0, 4),
      slot: clampRange(node.slot ?? 0, 0, 15),
    }));
}

function canonicalizePathwayNodeLabel(label: string, existingIds: Set<string>, index: number): string {
  const trimmed = toStringValue(label, `Node ${index + 1}`);
  if (!existingIds.has(trimmed.toLowerCase())) return trimmed;
  let suffix = 2;
  while (existingIds.has(`${trimmed} ${suffix}`.toLowerCase())) suffix += 1;
  return `${trimmed} ${suffix}`;
}

function parsePathwayGraphEdges(block: MiniappBlock): PathwayEdge[] {
  return asArray(block.edges, MAX_PATHWAY_EDGES)
    .map((entry, index) => normalizePathwayEdge(entry, `edge_${index}`))
    .filter((edge): edge is PathwayEdge => Boolean(edge));
}

function canonicalizePathwayNodeId(existingIds: Set<string>, hint = "node"): string {
  let index = existingIds.size + 1;
  let candidate = `${hint}_${index}`;
  while (existingIds.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${hint}_${index}`;
  }
  return candidate;
}

function canonicalizePathwayEdgeId(edges: PathwayEdge[]): string {
  const taken = new Set(edges.map((edge) => toStringValue(edge.id).toLowerCase()));
  let index = taken.size + 1;
  let candidate = `edge_${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `edge_${index}`;
  }
  return candidate;
}

function updatePathwayGraphBlock(
  miniapp: Miniapp,
  nodes: PathwayNode[],
  edges: PathwayEdge[],
  status: string,
): ActionResult {
  const blocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS);
  const nextNodes = dedupePathwayNodes(nodes);
  const nextEdges = dedupePathwayEdges(edges);
  const nextBlocks = blocks.map((block) => {
    if (block.type !== "pathway_graph") return block;
    return {
      ...block,
      nodes: nextNodes,
      edges: nextEdges,
    };
  });
  return {
    miniapp: {
      ...miniapp,
      blocks: nextBlocks,
    },
    status,
  };
}

function buildPathwayGraphLayers(nodes: PathwayNode[], edges: PathwayEdge[]): PathwayNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id.toLowerCase(), { ...node }]));
  const layeredNodes = Array.from(nodesById.values()).map((node) => ({
    ...node,
    layer: clampRange(node.layer ?? 0, 0, 4),
    slot: clampRange(node.slot ?? 0, 0, 15),
  }));

  const pending = new Map<string, PathwayNode>();
  const toIndex = new Map<string, number>();
  layeredNodes.forEach((node, index) => {
    pending.set(node.id.toLowerCase(), { ...node });
    toIndex.set(node.id.toLowerCase(), index);
  });
  for (const [key, node] of pending) {
    const nodeLayer = node.layer ?? -1;
    if (Number.isFinite(nodeLayer) && nodeLayer >= 0) continue;
    const index = toIndex.get(key) ?? 0;
    pending.set(key, { ...node, layer: index % 5, slot: clampRange(node.slot ?? 0, 0, 15) });
  }

  for (let pass = 0; pass < layeredNodes.length; pass += 1) {
    let updated = false;
    for (const edge of edges) {
      const source = pending.get(edge.from.toLowerCase());
      const target = pending.get(edge.to.toLowerCase());
      if (!source || !target) continue;
      const sourceLayer = source.layer ?? 0;
      const targetLayer = target.layer ?? 0;
      if (Number.isFinite(sourceLayer) && targetLayer <= sourceLayer) {
        pending.set(edge.to.toLowerCase(), { ...target, layer: clampRange(sourceLayer + 1, 0, 4) });
        updated = true;
      }
    }
    if (!updated) break;
  }

  const byLayer = new Map<number, Set<number>>();
  for (const node of pending.values()) {
    const layer = clampRange(node.layer ?? 0, 0, 4);
    const usedSlots = byLayer.get(layer) || new Set<number>();
    const proposedSlot = clampRange(node.slot ?? 0, 0, 15);
    const finalSlot = usedSlots.has(proposedSlot) ? findOpenSlot(usedSlots) : proposedSlot;
    usedSlots.add(finalSlot);
    byLayer.set(layer, usedSlots);
    pending.set(node.id.toLowerCase(), { ...node, layer, slot: finalSlot });
  }

  return Array.from(pending.values()).map((node) => ({
    ...node,
    layer: clampRange(node.layer ?? 0, 0, 4),
    slot: clampRange(node.slot ?? 0, 0, 15),
  }));
}

function findOpenSlot(usedSlots: Set<number>): number {
  for (let slot = 0; slot <= 15; slot += 1) {
    if (!usedSlots.has(slot)) return slot;
  }
  return 0;
}

function getPathwayNodeById(nodes: PathwayNode[], nodeId: string | null): PathwayNode | null {
  if (!nodeId) return null;
  const normalized = toStringValue(nodeId).toLowerCase();
  return nodes.find((node) => node.id.toLowerCase() === normalized) || null;
}

function getPathwayEdgeById(edges: PathwayEdge[], edgeId: string | null): PathwayEdge | null {
  if (!edgeId) return null;
  const normalized = toStringValue(edgeId).toLowerCase();
  return edges.find((edge) => edge.id.toLowerCase() === normalized) || null;
}

function dedupePathwayNodes(nodes: PathwayNode[]): PathwayNode[] {
  const byId = new Map<string, PathwayNode>();
  for (const node of nodes) {
    const id = toStringValue(node.id).toLowerCase();
    if (!id || byId.has(id)) continue;
    byId.set(id, node);
  }
  return Array.from(byId.values());
}

function dedupePathwayEdges(edges: PathwayEdge[]): PathwayEdge[] {
  const byId = new Map<string, PathwayEdge>();
  for (const edge of edges) {
    const key = toStringValue(edge.id).toLowerCase();
    if (!key) continue;
    byId.set(key, { ...edge, id: key });
  }
  return Array.from(byId.values());
}

function nextPathwayNodeLocation(nodes: PathwayNode[], anchorLayer: number | null): { layer: number; slot: number } {
  const targetLayer = Number.isFinite(anchorLayer as number) ? clampRange(anchorLayer as number, 0, 4) : nodes.length % 5;
  const occupied = new Map<number, Set<number>>();
  for (const node of nodes) {
    const layer = clampRange(node.layer ?? 0, 0, 4);
    const bucket = occupied.get(layer) || new Set<number>();
    bucket.add(clampRange(node.slot ?? 0, 0, 15));
    occupied.set(layer, bucket);
  }
  const prioritizedLayers = [
    targetLayer,
    (targetLayer + 1) % 5,
    (targetLayer + 2) % 5,
    (targetLayer + 3) % 5,
    (targetLayer + 4) % 5,
  ];
  for (const layer of prioritizedLayers) {
    const bucket = occupied.get(layer) || new Set<number>();
    const slot = findOpenSlot(bucket);
    if (slot < 16) {
      return { layer, slot };
    }
  }
  return { layer: targetLayer, slot: findOpenSlot(occupied.get(targetLayer) || new Set<number>()) };
}

function addPathwayNode(miniapp: Miniapp, selectionState: PathwayEditorState): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) {
    return { miniapp, status: "No pathway graph block is available." };
  }
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  if (nodes.length >= MAX_PATHWAY_NODES) {
    return { miniapp, status: "Maximum pathway nodes reached." };
  }

  const selectedNode = getPathwayNodeById(nodes, selectionState.selectedPathwayNodeId);
  const nextLocation = nextPathwayNodeLocation(nodes, selectedNode?.layer ?? null);
  const existingNodeIds = new Set(nodes.map((node) => node.id.toLowerCase()));
  const existingLabels = new Set(nodes.map((node) => toStringValue(node.label).toLowerCase()));
  const nextIndex = nodes.length + 1;
  const nextId = canonicalizePathwayNodeId(existingNodeIds, "node");
  const nextNode: PathwayNode = {
    id: nextId,
    label: canonicalizePathwayNodeLabel(`Node ${nextIndex}`, existingLabels, nextIndex - 1),
    kind: "protein",
    layer: nextLocation.layer,
    slot: nextLocation.slot,
  };
  return {
    ...updatePathwayGraphBlock(miniapp, [...nodes, nextNode], edges, `Added pathway node ${nextIndex}.`),
    selectedPathwayNodeId: nextNode.id,
    selectedPathwayEdgeId: null,
    pathwayAddSourceId: null,
    pathwayAddTargetId: null,
  };
}

function selectPathwayEdgeNodes(
  nodes: PathwayNode[],
  state: PathwayEditorState,
): { from: string; to: string } | null {
  const sourceCandidate = getPathwayNodeById(nodes, state.pathwayAddSourceId);
  const targetCandidate = getPathwayNodeById(nodes, state.pathwayAddTargetId);

  const ordered = nodes.filter((node) => Boolean(node.id));
  if (ordered.length < 2) return null;
  if (!sourceCandidate || !targetCandidate) return null;
  const from = sourceCandidate.id;
  const to = targetCandidate.id;
  if (from === to) return null;
  return { from, to };
}

function addPathwayEdge(miniapp: Miniapp, selectionState: PathwayEditorState): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) {
    return { miniapp, status: "No pathway graph block is available." };
  }
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  if (nodes.length < 2) {
    return { miniapp, status: "Add at least two nodes before adding an edge." };
  }
  if (edges.length >= MAX_PATHWAY_EDGES) {
    return { miniapp, status: "Maximum pathway edges reached." };
  }

  const selectionForEdge = selectPathwayEdgeNodes(nodes, selectionState);
  if (!selectionForEdge) {
    return { miniapp, status: "Select a source and target node to add an edge." };
  }

  const duplicateExists = edges.some(
    (edge) => edge.from.toLowerCase() === selectionForEdge.from.toLowerCase() && edge.to.toLowerCase() === selectionForEdge.to.toLowerCase(),
  );
  if (duplicateExists) {
    return {
      miniapp,
      status: "Pathway edge already exists.",
      pathwayAddSourceId: null,
      pathwayAddTargetId: null,
    };
  }

  const nextEdge: PathwayEdge = {
    id: canonicalizePathwayEdgeId(edges),
    from: selectionForEdge.from,
    to: selectionForEdge.to,
    kind: "activation",
    label: "",
  };
  return {
    ...updatePathwayGraphBlock(miniapp, nodes, [...edges, nextEdge], "Added pathway edge."),
    status: "Added pathway edge.",
    pathwayAddSourceId: null,
    pathwayAddTargetId: null,
    selectedPathwayEdgeId: nextEdge.id,
    selectedPathwayNodeId: null,
  };
}

function updateSelectedPathwayNodeLabel(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
  nextLabel: string,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedNodeId = selectionState.selectedPathwayNodeId;
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  if (!selectedNodeId) return { miniapp, status: "Select a pathway node before renaming." };
  const cleanedLabel = toStringValue(nextLabel, `Node ${selectedNodeId}`);
  if (!cleanedLabel) return { miniapp, status: "Node label cannot be empty." };
  const nextNodes = nodes.map((node) => (node.id.toLowerCase() === selectedNodeId.toLowerCase() ? { ...node, label: cleanedLabel } : node));
  return updatePathwayGraphBlock(miniapp, nextNodes, edges, "Updated selected pathway node label.");
}

function updateSelectedPathwayNodeKind(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
  nextKind: string,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedNodeId = selectionState.selectedPathwayNodeId;
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  const normalizedKind = toStringValue(nextKind).toLowerCase() as PathwayNodeKind;
  if (!PATHWAY_NODE_KIND_OPTIONS.includes(normalizedKind)) {
    return { miniapp, status: "Unsupported pathway node kind." };
  }
  if (!selectedNodeId) return { miniapp, status: "Select a pathway node before changing its kind." };
  return updatePathwayGraphBlock(
    miniapp,
    nodes.map((node) => (node.id.toLowerCase() === selectedNodeId.toLowerCase() ? { ...node, kind: normalizedKind } : node)),
    edges,
    "Updated selected pathway node kind.",
  );
}

function updateSelectedPathwayEdgeKind(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
  nextKind: string,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedEdgeId = selectionState.selectedPathwayEdgeId;
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  const normalizedKind = toStringValue(nextKind).toLowerCase() as PathwayEdgeKind;
  if (!PATHWAY_EDGE_KIND_OPTIONS.includes(normalizedKind)) {
    return { miniapp, status: "Unsupported pathway edge kind." };
  }
  if (!selectedEdgeId) return { miniapp, status: "Select a pathway edge before changing its kind." };
  const nextEdges = edges.map((edge) => (edge.id.toLowerCase() === selectedEdgeId.toLowerCase() ? { ...edge, kind: normalizedKind } : edge));
  return updatePathwayGraphBlock(miniapp, nodes, nextEdges, "Updated selected pathway edge kind.");
}

function updateSelectedPathwayEdgeLabel(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
  nextLabel: string,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedEdgeId = selectionState.selectedPathwayEdgeId;
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  if (!selectedEdgeId) return { miniapp, status: "Select a pathway edge before renaming." };
  const nextEdges = edges.map((edge) =>
    edge.id.toLowerCase() === selectedEdgeId.toLowerCase() ? { ...edge, label: toStringValue(nextLabel) } : edge,
  );
  return updatePathwayGraphBlock(miniapp, nodes, nextEdges, "Updated selected pathway edge label.");
}

function moveSelectedPathwayNode(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
  layerDelta: number,
  slotDelta: number,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  const selectedNodeId = selectionState.selectedPathwayNodeId;
  if (!selectedNodeId) return { miniapp, status: "Select a pathway node before moving it." };
  const selected = getPathwayNodeById(nodes, selectedNodeId);
  if (!selected) return { miniapp, status: "Selected pathway node is no longer available." };
  const nextNodes = nodes.map((node) =>
    node.id.toLowerCase() === selected.id.toLowerCase()
      ? {
          ...node,
          layer: clampRange((node.layer ?? 0) + layerDelta, 0, 4),
          slot: clampRange((node.slot ?? 0) + slotDelta, 0, 15),
        }
      : node,
  );
  return updatePathwayGraphBlock(miniapp, nextNodes, edges, "Moved selected pathway node.");
}

function deleteSelectedPathwayEdge(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedEdgeId = selectionState.selectedPathwayEdgeId;
  if (!selectedEdgeId) return { miniapp, status: "Select a pathway edge before deleting." };
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  const nextEdges = edges.filter((edge) => edge.id.toLowerCase() !== selectedEdgeId.toLowerCase());
  if (nextEdges.length === edges.length) {
    return { miniapp, status: "Selected pathway edge was not found." };
  }
  return {
    ...updatePathwayGraphBlock(miniapp, nodes, nextEdges, "Deleted selected pathway edge."),
    selectedPathwayEdgeId: null,
  };
}

function deleteSelectedPathwayNode(
  miniapp: Miniapp,
  selectionState: PathwayEditorState,
): ActionResult {
  const graphBlock = getPathwayGraphBlock(miniapp);
  if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
  const selectedNodeId = selectionState.selectedPathwayNodeId;
  const selectedEdgeId = selectionState.selectedPathwayEdgeId;
  if (!selectedNodeId && selectedEdgeId) {
    const edgeDelete = deleteSelectedPathwayEdge(miniapp, selectionState);
    return { ...edgeDelete, status: edgeDelete.status };
  }
  if (!selectedNodeId) return { miniapp, status: "Select a pathway node before deleting." };
  const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock));
  const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock));
  const remainingNodes = nodes.filter((node) => node.id.toLowerCase() !== selectedNodeId.toLowerCase());
  if (!remainingNodes.length) {
    return { miniapp, status: "At least one pathway node is required." };
  }
  const remainingIds = new Set(remainingNodes.map((node) => node.id.toLowerCase()));
  const remainingEdges = edges.filter((edge) => remainingIds.has(edge.from.toLowerCase()) && remainingIds.has(edge.to.toLowerCase()));
  return {
    ...updatePathwayGraphBlock(miniapp, remainingNodes, remainingEdges, "Deleted selected pathway node."),
    selectedPathwayNodeId: null,
    selectedPathwayEdgeId: null,
  };
}

function renamePathwayNode(miniapp: Miniapp, selectionState: PathwayEditorState, pattern: string): ActionResult {
  const nextLabel = toStringValue(pattern, "Node").trim();
  return updateSelectedPathwayNodeLabel(miniapp, selectionState, nextLabel || "Node");
}

function parseMovePattern(pattern: string): { layerDelta: number; slotDelta: number } {
  const normalized = toLowerCase(pattern);
  if (normalized.includes("left")) return { layerDelta: -1, slotDelta: 0 };
  if (normalized.includes("right")) return { layerDelta: 1, slotDelta: 0 };
  if (normalized.includes("up")) return { layerDelta: 0, slotDelta: -1 };
  if (normalized.includes("down")) return { layerDelta: 0, slotDelta: 1 };
  const layerMatch = normalized.match(/layer\s*[:=]\s*(-?\d+)/);
  const slotMatch = normalized.match(/slot\s*[:=]\s*(-?\d+)/);
  const layerDelta = layerMatch ? toNumber(layerMatch[1]) : 0;
  const slotDelta = slotMatch ? toNumber(slotMatch[1]) : 0;
  return { layerDelta, slotDelta };
}

function normalizeRequestedKind(value: string): string {
  return toLowerCase(value);
}

function nextInSet(current: string, options: readonly string[]): string {
  const safeCurrent = normalizeRequestedKind(current) || options[0];
  const currentIndex = options.findIndex((option) => option === safeCurrent);
  return options[(currentIndex + 1) % options.length];
}

function pickNodeKind(current: string, requested: string): string {
  const normalized = normalizeRequestedKind(requested);
  if (PATHWAY_NODE_KIND_OPTIONS.includes(normalized as PathwayNodeKind)) return normalized;
  return nextInSet(current, PATHWAY_NODE_KIND_OPTIONS);
}

function pickEdgeKind(current: string, requested: string): string {
  const normalized = normalizeRequestedKind(requested);
  if (PATHWAY_EDGE_KIND_OPTIONS.includes(normalized as PathwayEdgeKind)) return normalized;
  return nextInSet(current, PATHWAY_EDGE_KIND_OPTIONS);
}

function parseNodeLabelFromAction(action: MiniappAction): string {
  if (toStringValue(action.pattern)) return toStringValue(action.pattern);
  const actionLabel = toStringValue(action.label);
  if (actionLabel === "Rename Node" || actionLabel === "Set Node Type" || actionLabel === "Set Edge Type" || actionLabel === "Move Node") return "";
  return actionLabel;
}

function createPlaceholderAssignment(index: number): Record<string, unknown> {
  return {
    well: `A${Math.min(index + 1, 12)}`,
    sample: `Sample ${index + 1}`,
    group: "Sample",
    replicate: 1,
    volume: 20,
  };
}

function findNextAvailableWell(block: MiniappBlock, wells: Array<Record<string, unknown>>): string | null {
  const dimensions = getPlateDimensions(block);
  const used = new Set(
    wells
      .map((well) => {
        const direct = parsePlateCoordinates(toStringValue(well.id ?? well.well), dimensions.rows, dimensions.columns);
        if (direct) return direct;
        if (well.row || well.col) return parsePlateCoordinates(`${toStringValue(well.row)}${toStringValue(well.col)}`, dimensions.rows, dimensions.columns);
        return null;
      })
      .filter((coords): coords is { row: string; column: string } => Boolean(coords))
      .map((coords) => `${coords.row}${coords.column}`.toUpperCase()),
  );
  for (const row of dimensions.rows) {
    for (const column of dimensions.columns) {
      const well = `${row}${column}`.toUpperCase();
      if (!used.has(well)) return well;
    }
  }
  return null;
}

function addSampleToMiniapp(miniapp: Miniapp): ActionResult {
  let changed = false;
  let nextIndex = 1;
  const nextBlocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS).map((block) => {
    if (block.type === "plate_grid") {
      const wells = asArray<Record<string, unknown>>(block.wells, MAX_WELLS);
      nextIndex = Math.max(nextIndex, wells.length + 1);
      if (wells.length >= MAX_WELLS) return block;
      const nextWell = findNextAvailableWell(block, wells);
      if (!nextWell) return block;
      changed = true;
      return {
        ...block,
        wells: [
          ...wells,
          { well: nextWell, label: `Sample ${wells.length + 1}`, sample: `Sample ${wells.length + 1}`, tone: "sample" },
        ],
      };
    }
    if (TABLE_ACTION_BLOCK_TYPES.has(toStringValue(block.type))) {
      const rows = asArray(block.rows, MAX_TABLE_ROWS);
      if (rows.length >= MAX_TABLE_ROWS) return block;
      changed = true;
      return { ...block, rows: [...rows, createPlaceholderAssignment(rows.length)] };
    }
    return block;
  });
  return {
    miniapp: { ...miniapp, blocks: nextBlocks },
    status: changed ? `Added Sample ${nextIndex}.` : "No editable plate or table was available.",
  };
}

function autoFillReplicatesInMiniapp(miniapp: Miniapp): ActionResult {
  let added = 0;
  const nextBlocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS).map((block) => {
    if (!TABLE_ACTION_BLOCK_TYPES.has(toStringValue(block.type))) return block;
    const rows = asArray(block.rows, MAX_TABLE_ROWS);
    const objectRows = rows.map((row) => asRecord(row)).filter((row) => Object.keys(row).length);
    const seen = new Set(objectRows.map((row) => toStringValue(row.sample || row.label || row.well)));
    const nextRows = [...rows];
    for (const row of objectRows) {
      if (nextRows.length >= MAX_TABLE_ROWS) break;
      const sample = toStringValue(row.sample || row.label || row.well);
      if (!sample || seen.has(`${sample}:rep2`)) continue;
      const replicate = toNumber(row.replicate, 1);
      if (replicate >= 2) continue;
      nextRows.push({ ...row, replicate: 2 });
      seen.add(`${sample}:rep2`);
      added += 1;
    }
    return added ? { ...block, rows: nextRows } : block;
  });
  return {
    miniapp: { ...miniapp, blocks: nextBlocks },
    status: added ? `Auto-filled ${added} replicate assignment${added === 1 ? "" : "s"}.` : "Replicates already look complete.",
  };
}

function clearPlateInMiniapp(miniapp: Miniapp): ActionResult {
  const nextBlocks = asArray<MiniappBlock>(miniapp.blocks, MAX_CHILD_BLOCKS).map((block) => {
    if (block.type === "plate_grid") return { ...block, wells: [] };
    if (TABLE_ACTION_BLOCK_TYPES.has(toStringValue(block.type))) return { ...block, rows: [] };
    return block;
  });
  return { miniapp: { ...miniapp, blocks: nextBlocks }, status: "Plate assignments cleared." };
}

function applyLocalAction(
  action: MiniappAction,
  miniapp: Miniapp,
  pathwaySelectionState: PathwayEditorState,
): ActionResult | null {
  const actionId = getActionId(action);
  if (actionId === LOCAL_ACTIONS.ADD_SAMPLE) return addSampleToMiniapp(miniapp);
  if (actionId === LOCAL_ACTIONS.AUTO_FILL_REPLICATES) return autoFillReplicatesInMiniapp(miniapp);
  if (actionId === LOCAL_ACTIONS.CLEAR_PLATE) return clearPlateInMiniapp(miniapp);
  if (actionId === LOCAL_ACTIONS.ADD_NODE) return addPathwayNode(miniapp, pathwaySelectionState);
  if (actionId === LOCAL_ACTIONS.ADD_EDGE) return addPathwayEdge(miniapp, pathwaySelectionState);
  if (actionId === LOCAL_ACTIONS.RENAME_NODE) return renamePathwayNode(miniapp, pathwaySelectionState, parseNodeLabelFromAction(action));
  if (actionId === LOCAL_ACTIONS.SET_NODE_KIND) {
    const graphBlock = getPathwayGraphBlock(miniapp);
    if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
    const selectedNode = getPathwayNodeById(parsePathwayGraphNodes(graphBlock), pathwaySelectionState.selectedPathwayNodeId);
    const nextKind = pickNodeKind(toStringValue(selectedNode?.kind, "protein"), parseNodeLabelFromAction(action));
    return updateSelectedPathwayNodeKind(miniapp, pathwaySelectionState, nextKind);
  }
  if (actionId === LOCAL_ACTIONS.SET_EDGE_KIND) {
    const graphBlock = getPathwayGraphBlock(miniapp);
    if (!graphBlock) return { miniapp, status: "No pathway graph block is available." };
    const selectedEdge = getPathwayEdgeById(parsePathwayGraphEdges(graphBlock), pathwaySelectionState.selectedPathwayEdgeId);
    const nextKind = pickEdgeKind(toStringValue(selectedEdge?.kind, "activation"), parseNodeLabelFromAction(action));
    return updateSelectedPathwayEdgeKind(miniapp, pathwaySelectionState, nextKind);
  }
  if (actionId === LOCAL_ACTIONS.MOVE_NODE) {
    const { layerDelta, slotDelta } = parseMovePattern(parseNodeLabelFromAction(action));
    return moveSelectedPathwayNode(miniapp, pathwaySelectionState, layerDelta, slotDelta);
  }
  if (actionId === LOCAL_ACTIONS.DELETE_SELECTED) return deleteSelectedPathwayNode(miniapp, pathwaySelectionState);
  return null;
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

function parsePlateRowsAndColumns(block: MiniappBlock): { columns: string[]; rows: string[] } {
  return getPlateDimensions(block);
}

function qpcrEfficiencyPercent(slope: number): number {
  if (!Number.isFinite(slope) || slope === 0) return 0;
  return (Math.pow(10, -1 / slope) - 1) * 100;
}

function normalizePlateTone(raw: unknown): "standard" | "sample" | "control" | "empty" {
  return plateToneClassName[toStringValue(raw).toLowerCase()] ?? "empty";
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
  const computedValue = metricId ? computed[metricId] : undefined;
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

function parsePlateCoordinates(
  value: unknown,
  rows: string[],
  columns: string[],
): { row: string; column: string } | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const compact = normalized.match(/^([A-Z]+)(\d+)$/);
  if (!compact) return null;

  const rawRow = compact[1];
  const rawCol = String(Number(compact[2]));
  const rowIndex = rows.findIndex((entry) => entry.toUpperCase() === rawRow);
  const columnIndex = columns.findIndex(
    (entry) => entry.toUpperCase().replace(/^0+/, "") === rawCol || String(Number(entry)) === rawCol,
  );
  if (rowIndex < 0 || columnIndex < 0) return null;
  return { row: rows[rowIndex], column: columns[columnIndex] };
}

function getPlateDimensions(block: MiniappBlock) {
  const format = toStringValue(block.format).toLowerCase();
  const inferredRows = format.includes("384") ? 16 : 8;
  const inferredCols = format.includes("384") ? 24 : 12;
  const rows = axisLabelsFromValue(block.rowLabels ?? block.rows, "rows", inferredRows);
  const columns = axisLabelsFromValue(block.columnLabels ?? block.columns, "columns", inferredCols);
  return { rows, columns };
}

function getPlateWellMap(block: MiniappBlock, rows: string[], columns: string[]) {
  const map = new Map<string, "standard" | "sample" | "control" | "empty">();
  const wells = asArray(block.wells, MAX_WELLS);
  for (const well of wells) {
    if (!well || typeof well !== "object") continue;
    const wellRecord = asRecord(well);
    const byId = parsePlateCoordinates(toStringValue(wellRecord.id ?? wellRecord.well), rows, columns);
    const byCoords =
      byId ??
      (typeof wellRecord.row === "string" && wellRecord.col
        ? parsePlateCoordinates(`${wellRecord.row}${wellRecord.col}`, rows, columns)
        : null);

    if (!byCoords) continue;
    map.set(`${byCoords.row}-${byCoords.column}`, normalizePlateTone(wellRecord.tone ?? wellRecord.group ?? wellRecord.role ?? wellRecord.kind));
  }
  return map;
}

function fallbackDepthBlock(context: RendererContext) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>Blocked render path</Text>
      <Text style={context.styles.miniappFallbackText}>Nested content is capped at {MAX_BLOCK_DEPTH} levels.</Text>
    </View>
  );
}

function HeroSummaryBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappHeroBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Summary")}</Text>
      <Text style={context.styles.miniappFallbackText}>
        {toStringValue(block.body, toStringValue(block.text, "No summary yet."))}
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Inputs")}</Text>
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Input")}</Text>
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
      <Text style={context.styles.miniappFormulaText}>{toStringValue(block.value, "No result.")}</Text>
    </View>
  );
}

function FormulaTraceBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappFormulaBox}>
      <Text style={context.styles.miniappFormulaLabel}>{toStringValue(block.title, "Formula")}</Text>
      {asArray(block.steps, MAX_TABLE_ROWS).map((step, stepIndex) => (
        <Text key={stepIndex} style={context.styles.miniappFormulaText}>
          {toStringValue((step as Record<string, unknown>)?.expr, "E = 10^(-1 / slope) - 1")}
        </Text>
      ))}
    </View>
  );
}

function WarningBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const fallbackBody = toStringValue(block.label, toStringValue(block.value, toStringValue(block.status, "Warning")));
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Warning")}</Text>
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Actions")}</Text>
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
    ? `${formatMiniappNumber(stats.outlier.value)} (${stats.outlier.isOutlier ? "flagged" : "not significant"})`
    : "Need at least 3 values";

  return (
    <View style={context.styles.miniappInputGrid}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Statistics")}</Text>
      <View style={context.styles.miniappInputCard}>
        <Text style={context.styles.miniappInputLabel}>Values</Text>
        <TextInput
          keyboardType="numbers-and-punctuation"
          onChangeText={setRawValues}
          selectTextOnFocus
          style={context.styles.miniappInput}
          value={rawValues}
        />
      </View>
      <View style={context.styles.miniappMetricGrid}>
        <Metric label="Mean" styles={context.styles} value={formatMiniappNumber(stats.mean, 4)} />
        <Metric label="Sample SD" styles={context.styles} value={formatMiniappNumber(stats.sampleStdDev, 4)} />
        <Metric label="Outlier" styles={context.styles} value={outlierText} wide />
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Mass from density")}</Text>
      <NumberField label="Volume (mL)" onChange={(value) => setVolume(toNumber(value, volume))} styles={context.styles} value={volume} />
      <NumberField label="Density (g/mL)" onChange={(value) => setDensity(toNumber(value, density))} styles={context.styles} value={density} />
      <View style={context.styles.miniappFormulaBox}>
        <Text style={context.styles.miniappFormulaLabel}>Mass</Text>
        <Text style={context.styles.miniappMetricValue}>{result.ok ? `${formatMiniappNumber(result.mass, 4)} ${result.massUnit}` : "Unsupported unit"}</Text>
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Chart")}</Text>
      <View style={context.styles.miniappSegmentRow}>
        {(["linear", "quadratic"] as const).map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setFitType(option)}
            style={[context.styles.miniappSegment, fitType === option ? context.styles.miniappSegmentActive : null]}
          >
            <Text style={context.styles.miniappSegmentText}>{option}</Text>
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
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Table")}</Text>
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
        <Text style={context.styles.miniappFallbackText}>No rows yet.</Text>
      )}
      {rows.hasMoreRows || rows.hasMoreColumns ? (
        <Text style={context.styles.miniappTableOverflowNotice}>
          Showing up to {Math.min(rows.rows.length, MAX_TABLE_ROWS)} rows and {Math.min(rows.columns.length, MAX_TABLE_COLUMNS)} columns.
        </Text>
      ) : null}
    </View>
  );
}

function PathwayGraphBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const nodes = parsePathwayGraphNodes(block);
  const edges = parsePathwayGraphEdges(block);
  const selectedNodeId = context.selectedPathwayNodeId;
  const selectedEdgeId = context.selectedPathwayEdgeId;
  const pathwayViewport = context.pathwayViewport;
  const layeredNodes = buildPathwayGraphLayers(nodes, edges);
  const layerBuckets: Record<number, PathwayNode[]> = {};
  for (const node of layeredNodes) {
    const layer = Number.isFinite(toNumber(node.layer, 0)) ? Math.max(0, Math.min(4, Math.floor(node.layer || 0))) : 0;
    (layerBuckets[layer] ||= []).push(node);
  }
  const layers = Object.entries(layerBuckets)
    .map(([rawLayer, layerNodes]) => ({
      nodes: layerNodes.sort((first, second) => {
        const slotDelta = clampRange(first.slot ?? 0, 0, 15) - clampRange(second.slot ?? 0, 0, 15);
        return slotDelta || toStringValue(first.id).localeCompare(toStringValue(second.id));
      }),
      layer: Number(rawLayer),
    }))
    .sort((a, b) => a.layer - b.layer);

  const layerWidth = pathwayViewport.layerWidth;
  const nodeHeight = pathwayViewport.nodeHeight;
  const nodeGapY = pathwayViewport.nodeGapY;
  const yBase = pathwayViewport.canvasPadding;
  const xBase = pathwayViewport.canvasPadding;
  const maxRows = Math.max(...layers.map((layer) => layer.nodes.length), 1);
  const graphHeight = Math.max(pathwayViewport.graphMinHeight, yBase + maxRows * (nodeHeight + nodeGapY) + nodeHeight / 2);
  const graphWidth = Math.max(pathwayViewport.isSmallPhone ? 230 : 260, layers.length * layerWidth + 70);
  const nodeLayout: Record<string, { node: PathwayNode; left: number; top: number; width: number; height: number }> = {};

  for (const { nodes: layerNodes, layer } of layers) {
    const left = xBase + layer * layerWidth;
    layerNodes.forEach((node, index) => {
      const top = yBase + clampRange(node.slot ?? index, 0, 15) * (nodeHeight + nodeGapY);
      nodeLayout[node.id.toLowerCase()] = { node, left, top, width: pathwayViewport.nodeWidth, height: nodeHeight };
    });
  }

  const edgeKindStyles = {
    activation: "miniappPathwayEdgeActivation",
    inhibition: "miniappPathwayEdgeInhibition",
    unknown: "miniappPathwayEdgeUnknown",
    binding: "miniappPathwayEdgeBinding",
    phosphorylation: "miniappPathwayEdgeBinding",
    transcription: "miniappPathwayEdgeUnknown",
  };

  const nodeTypeStyles = {
    gene: "miniappPathwayNodeGene",
    protein: "miniappPathwayNodeProtein",
    drug: "miniappPathwayNodeDrug",
    process: "miniappPathwayNodeProcess",
    phenotype: "miniappPathwayNodePhenotype",
    sample: "miniappPathwayNodeProcess",
  };

  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Mechanism graph")}</Text>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={[
          context.styles.miniappPathwayGraphViewport,
          pathwayViewport.isSmallPhone ? context.styles.miniappPathwayGraphViewportCompact : null,
          pathwayViewport.isTablet ? context.styles.miniappPathwayGraphViewportTablet : null,
          { maxHeight: pathwayViewport.graphMaxHeight },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={context.styles.miniappPathwayScroller}>
          <View style={[context.styles.miniappPathwayCanvas, { height: graphHeight, width: graphWidth }]}>
            {edges.map((edge, edgeIndex) => {
            const source = nodeLayout[edge.from.toLowerCase()];
            const target = nodeLayout[edge.to.toLowerCase()];
            if (!source || !target) return null;
            const sourceX = source.left + source.width;
            const sourceY = source.top + source.height / 2;
            const targetX = target.left;
            const targetY = target.top + target.height / 2;
            const dx = targetX - sourceX;
            const dy = targetY - sourceY;
            const distance = Math.max(Math.hypot(dx, dy), 1);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            const edgeId = getPathwayEdgeId(edge, edgeIndex);
            const isSelected = selectedEdgeId && selectedEdgeId.toLowerCase() === edgeId.toLowerCase();
            const kindClass = edgeKindStyles[edge.kind as keyof typeof edgeKindStyles] || "miniappPathwayEdgeUnknown";
            const label = toStringValue(edge.label);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select pathway edge ${edgeId}`}
                hitSlop={{ bottom: 16, left: 16, right: 16, top: 16 }}
                key={edgeId}
                onPress={() => context.pathwayEditor.onSelectEdge(edgeId)}
                style={[
                  context.styles.miniappPathwayEdgePressable,
                  context.styles.miniappPathwayEdge,
                  context.styles[kindClass],
                  isSelected ? context.styles.miniappPathwaySelectedEdge : null,
                  {
                    left: sourceX,
                    top: sourceY,
                    width: distance,
                    transform: [{ rotate: `${angle}deg` }],
                  },
                ]}
              >
                {edge.kind === "inhibition" ? (
                  <View
                    style={[
                      context.styles.miniappPathwayEdgeTerminus,
                      {
                        left: distance - 8,
                      },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      context.styles.miniappPathwayEdgeArrow,
                      {
                        left: distance - 12,
                      },
                    ]}
                  />
                )}
                {label ? (
                  <Text
                    numberOfLines={1}
                    style={[context.styles.miniappPathwayEdgeLabel, { left: Math.max(4, distance * 0.55), top: -18, transform: [{ rotate: `${-angle}deg` }] }]}
                  >
                    {label}
                  </Text>
                ) : null}
              </Pressable>
            );
            })}
            {layeredNodes.map((node) => {
            const layout = nodeLayout[node.id.toLowerCase()];
            if (!layout) return null;
            const nodeType = node.kind?.toLowerCase() as keyof typeof nodeTypeStyles;
            const isSelected = selectedNodeId && selectedNodeId.toLowerCase() === node.id.toLowerCase();
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select pathway node ${node.id}`}
                key={node.id}
                onPress={() => context.pathwayEditor.onSelectNode(node.id)}
                style={[
                  context.styles.miniappPathwayNode,
                  pathwayViewport.isSmallPhone ? context.styles.miniappPathwayNodeCompact : null,
                  pathwayViewport.isTablet ? context.styles.miniappPathwayNodeTablet : null,
                  context.styles[nodeTypeStyles[nodeType] || "miniappPathwayNodeGene"],
                  isSelected ? context.styles.miniappPathwaySelectedNode : null,
                  { height: pathwayViewport.nodeHeight, left: layout.left, top: layout.top, width: pathwayViewport.nodeWidth },
                ]}
              >
                <Text numberOfLines={1} style={context.styles.miniappFallbackText} ellipsizeMode="tail">
                  {toStringValue(node.id)}
                </Text>
                <Text numberOfLines={2} style={context.styles.miniappPathwayNodeLabel} ellipsizeMode="tail">
                  {toStringValue(node.label, node.id)}
                </Text>
                <Text style={context.styles.miniappPathwayNodeKind}>
                  {toStringValue(node.kind, "protein")}
                </Text>
              </Pressable>
            );
            })}
          </View>
        </ScrollView>
      </ScrollView>
      <PathwayEditorPanel context={context} nodes={nodes} edges={edges} />
    </View>
  );
}

function PathwayEditorPanel({
  context,
  edges,
  nodes,
}: {
  context: RendererContext;
  edges: PathwayEdge[];
  nodes: PathwayNode[];
}) {
  const pathwayViewport = context.pathwayViewport;
  const selectedNode = getPathwayNodeById(nodes, context.selectedPathwayNodeId);
  const selectedEdge = getPathwayEdgeById(edges, context.selectedPathwayEdgeId);
  const draftSourceId = context.pathwayEditor.pathwayAddSourceId;
  const draftTargetId = context.pathwayEditor.pathwayAddTargetId;
  const selectedNodeId = selectedNode?.id;
  const nodeType = selectedNode?.kind || "protein";
  const edgeSourceId = selectedEdge ? selectedEdge.from : null;
  const edgeTargetId = selectedEdge ? selectedEdge.to : null;
  const edgeSource = edgeSourceId ?? draftSourceId;
  const edgeTarget = edgeTargetId ?? draftTargetId;

  const renderChip = (id: string, selected: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      key={id}
      onPress={onPress}
      style={[context.styles.miniappPathwayChip, selected ? context.styles.miniappPathwayChipActive : null]}
    >
      <Text style={context.styles.miniappFallbackText}>{id}</Text>
    </Pressable>
  );

  const renderSourceTargetChips = (kind: "fromId" | "toId", sourceOrTarget: string | null, fallback: string | null) => {
    const activeId = sourceOrTarget || fallback;
    return (
      <View style={context.styles.miniappPathwayChipRow}>
        {nodes.length ? (
          nodes.map((node) =>
            renderChip(
              node.id,
              Boolean(activeId) && toStringValue(activeId).toLowerCase() === node.id.toLowerCase(),
              () => context.pathwayEditor.setDraftEndpoint(kind, node.id),
            ),
          )
        ) : (
          <Text style={context.styles.miniappFallbackText}>No nodes available.</Text>
        )}
      </View>
    );
  };

  const selectedNodeTitle = selectedNode ? toStringValue(selectedNode.label, selectedNode.id) : "No node selected";
  const selectedEdgeTitle = selectedEdge ? toStringValue(selectedEdge.label, `${toStringValue(selectedEdge.from)} → ${toStringValue(selectedEdge.to)}`) : "No edge selected";
  const safeLayer = Number.isFinite(toNumber(selectedNode?.layer)) ? clampRange(toNumber(selectedNode?.layer), 0, 4) : 0;
  const safeSlot = Number.isFinite(toNumber(selectedNode?.slot)) ? clampRange(toNumber(selectedNode?.slot), 0, 15) : 0;

  return (
    <View
      style={[
        context.styles.miniappPathwayEditorPanel,
        pathwayViewport.isSmallPhone ? context.styles.miniappPathwayEditorPanelCompact : null,
        pathwayViewport.isTablet ? context.styles.miniappPathwayEditorPanelTablet : null,
      ]}
    >
      <Text style={context.styles.miniappBlockTitle}>Pathway editor</Text>
      <View style={[context.styles.miniappPathwayEditorSection, pathwayViewport.isTablet ? context.styles.miniappPathwayEditorSectionTablet : null]}>
        <Text style={context.styles.miniappPathwayEditorLabel}>Node: {selectedNodeTitle}</Text>
        <TextInput
          editable={Boolean(selectedNode)}
          onChangeText={context.pathwayEditor.setNodeLabel}
          placeholder="Rename node"
          selectTextOnFocus
          style={context.styles.miniappPathwayEditorInput}
          value={selectedNode ? selectedNode.label : ""}
        />
        <Text style={context.styles.miniappPathwayEditorSmallLabel}>Node kind</Text>
        <View style={context.styles.miniappPathwayChipRow}>
          {PATHWAY_NODE_KIND_OPTIONS.map((kind) => (
            <Pressable
              accessibilityRole="button"
              key={`node-kind-${kind}`}
              onPress={() => context.pathwayEditor.setNodeKind(kind)}
              style={[context.styles.miniappPathwayChip, nodeType === kind ? context.styles.miniappPathwayChipActive : null]}
            >
              <Text style={context.styles.miniappFallbackText}>{kind}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={context.styles.miniappPathwayEditorSmallLabel}>Location</Text>
        <Text style={context.styles.miniappFallbackText}>
          layer {safeLayer} • slot {safeSlot}
        </Text>
        <View style={context.styles.miniappPathwayMoveControls}>
          <View style={context.styles.miniappPathwayMoveRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => context.pathwayEditor.moveSelectedNode("up")}
              style={[context.styles.miniappPathwayMoveButton, context.styles.miniappPathwayChip]}
            >
              <Ionicons color="white" name="chevron-up" size={13} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => context.pathwayEditor.moveSelectedNode("down")}
              style={[context.styles.miniappPathwayMoveButton, context.styles.miniappPathwayChip]}
            >
              <Ionicons color="white" name="chevron-down" size={13} />
            </Pressable>
          </View>
          <View style={context.styles.miniappPathwayMoveRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => context.pathwayEditor.moveSelectedNode("left")}
              style={[context.styles.miniappPathwayMoveButton, context.styles.miniappPathwayChip]}
            >
              <Ionicons color="white" name="chevron-back" size={13} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => context.pathwayEditor.moveSelectedNode("right")}
              style={[context.styles.miniappPathwayMoveButton, context.styles.miniappPathwayChip]}
            >
              <Ionicons color="white" name="chevron-forward" size={13} />
            </Pressable>
          </View>
        </View>
      </View>
      <View style={[context.styles.miniappPathwayEditorSection, pathwayViewport.isTablet ? context.styles.miniappPathwayEditorSectionTablet : null]}>
        <Text style={context.styles.miniappPathwayEditorLabel}>Edge: {selectedEdgeTitle}</Text>
        <Text style={context.styles.miniappPathwayEditorSmallLabel}>Source</Text>
        {renderSourceTargetChips(
          "fromId",
          edgeSource,
          selectedNodeId && selectedEdge ? selectedNodeId : null,
        )}
        <Text style={context.styles.miniappPathwayEditorSmallLabel}>Target</Text>
        {renderSourceTargetChips(
          "toId",
          edgeTarget,
          selectedNodeId && selectedEdge ? selectedNodeId : null,
        )}
        <TextInput
          editable={Boolean(selectedEdge)}
          onChangeText={context.pathwayEditor.setEdgeLabel}
          placeholder="Edge label"
          selectTextOnFocus
          style={context.styles.miniappPathwayEditorInput}
          value={selectedEdge ? toStringValue(selectedEdge.label) : ""}
        />
        <Text style={context.styles.miniappPathwayEditorSmallLabel}>Edge kind</Text>
        <View style={context.styles.miniappPathwayChipRow}>
          {PATHWAY_EDGE_KIND_OPTIONS.map((kind) => (
            <Pressable
              accessibilityRole="button"
              key={`edge-kind-${kind}`}
              onPress={() => context.pathwayEditor.setEdgeKind(kind)}
              style={[context.styles.miniappPathwayChip, toStringValue(selectedEdge?.kind, "activation") === kind ? context.styles.miniappPathwayChipActive : null]}
            >
              <Text style={context.styles.miniappFallbackText}>{kind}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={[context.styles.miniappPathwayEditorSection, pathwayViewport.isTablet ? context.styles.miniappPathwayEditorSectionTablet : null]}>
        <Pressable accessibilityRole="button" onPress={() => context.pathwayEditor.addNode()} style={context.styles.miniappPrimaryAction}>
          <Text style={context.styles.miniappPrimaryActionText}>Add node</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => context.pathwayEditor.addEdge()} style={context.styles.miniappPrimaryAction}>
          <Text style={context.styles.miniappPrimaryActionText}>Add edge</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => context.pathwayEditor.deleteSelected()}
          style={context.styles.miniappPathwayDangerAction}
        >
          <Text style={context.styles.miniappFallbackText}>Delete selected</Text>
        </Pressable>
      </View>
      <Text style={context.styles.miniappFallbackText}>Tap a node or edge to select it. Node changes then affect local actions.</Text>
    </View>
  );
}

function MechanismLegendBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const items = asArray(block.items, MAX_CHILD_BLOCKS)
    .concat(asArray(block.groups, MAX_CHILD_BLOCKS))
    .concat(asArray(block.legend, MAX_CHILD_BLOCKS));
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Mechanism legend")}</Text>
      <View style={context.styles.miniappMechanismLegend}>
        {items.length ? (
          items.map((entry, index) => {
            const record = asRecord(entry);
            const kind = toStringValue(record.kind, "unknown");
            const glyph = toStringValue(record.glyph, kind);
            const label = toStringValue(record.label, kind);
            return (
              <View key={`${kind}-${index}`} style={context.styles.miniappMechanismLegendItem}>
                <Text style={context.styles.miniappFallbackText}>
                  {glyph} {label}
                </Text>
              </View>
            );
          })
        ) : (
          <Text style={context.styles.miniappFallbackText}>No mechanism legend configured.</Text>
        )}
      </View>
    </View>
  );
}

function EvidencePanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const items = asArray(block.items, MAX_CHILD_BLOCKS);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Evidence panel")}</Text>
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
                {source ? <Text style={context.styles.miniappFallbackText}>Source: {source}</Text> : null}
                {note ? <Text style={context.styles.miniappFallbackText}>{note}</Text> : null}
              </View>
            );
          })
        ) : (
          <Text style={context.styles.miniappFallbackText}>No evidence notes available.</Text>
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
        {assumptions.length ? <Text>Assumptions:</Text> : null}
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
  if (depth >= MAX_BLOCK_DEPTH) {
    return fallbackDepthBlock(context);
  }

  const rawTabs = asArray(block.tabs, MAX_CHILD_BLOCKS).concat(asArray(block.items, MAX_CHILD_BLOCKS));
  const tabs = rawTabs.slice(0, MAX_CHILD_BLOCKS);
  if (!tabs.length) return <EmptyBlockFallback context={context} />;

  return (
    <View style={context.styles.miniappTabBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Tabs")}</Text>
      {tabs.map((item, index) => {
        const tabRecord = asRecord(item);
        const title = toStringValue(tabRecord.title, toStringValue(tabRecord.label, `Tab ${index + 1}`));
        const children = getChildren(tabRecord);
        return (
          <View key={toStringValue(tabRecord.id, `tab-${index}`)} style={context.styles.miniappTabPanel}>
            <Text style={context.styles.miniappBlockTitle}>{title}</Text>
            {children.map((child, childIndex) => (
              <MiniappBlockRenderer
                key={`${title}-${childIndex}`}
                block={child}
                context={{ ...context, index: childIndex }}
                depth={depth + 1}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function ExpandableBlockView({ block, context, depth }: { block: MiniappBlock; context: RendererContext; depth: number }) {
  if (depth >= MAX_BLOCK_DEPTH) {
    return fallbackDepthBlock(context);
  }

  const children = getChildren(block);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Details")}</Text>
      {children.length ? (
        children.map((child, childIndex) => (
          <MiniappBlockRenderer
            key={`${block.type || "expandable"}-${childIndex}`}
            block={child}
            context={{ ...context, index: childIndex }}
            depth={depth + 1}
          />
        ))
      ) : (
        <Text style={context.styles.miniappFallbackText}>No details yet.</Text>
      )}
    </View>
  );
}

function TimelineBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const entries = asArray(block.items, MAX_TABLE_ROWS)
    .concat(asArray(block.steps, MAX_TABLE_ROWS))
    .concat(asArray(block.events, MAX_TABLE_ROWS))
    .slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Timeline")}</Text>
      {entries.length ? (
        entries.map((entry, index) => {
          const record = asRecord(entry);
          return (
            <Text key={index} style={context.styles.miniappFallbackText}>
              {toStringValue(record.title, toStringValue(record.label, `Step ${index + 1}`))}
              {record.time ? ` • ${toStringValue(record.time)}` : ""}
            </Text>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>No timeline entries yet.</Text>
      )}
    </View>
  );
}

function QualityPanelBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const metrics = asArray(block.checks, MAX_TABLE_ROWS).concat(asArray(block.metrics, MAX_TABLE_ROWS)).slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Quality panel")}</Text>
      {metrics.length ? (
        metrics.map((entry, index) => {
          const entryRecord = asRecord(entry);
          return (
            <Text key={index} style={context.styles.miniappFallbackText}>
              {toStringValue(entryRecord.label, `metric-${index}`)}: {toStringValue(entryRecord.value, "--")}
            </Text>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>No quality entries yet.</Text>
      )}
    </View>
  );
}

function CitationsBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const citations = asArray(block.items, MAX_TABLE_ROWS).concat(asArray(block.citations, MAX_TABLE_ROWS)).slice(0, MAX_TABLE_ROWS);
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Citations")}</Text>
      {citations.length ? (
        citations.map((citation, citationIndex) => {
          const citationRecord = asRecord(citation);
          return (
            <Text key={citationIndex} style={context.styles.miniappFallbackText}>
              {(citationIndex + 1).toString()}. {toStringValue(citationRecord.title, toStringValue(citationRecord.id, ""))}
            </Text>
          );
        })
      ) : (
        <Text style={context.styles.miniappFallbackText}>No citations yet.</Text>
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

function PlateGridBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const dimensions = getPlateDimensions(block);
  const rows = dimensions.rows.slice(0, 16); // explicit cap by layout shape
  const columns = dimensions.columns.slice(0, 24);
  const capCells = Math.min(rows.length * columns.length, MAX_WELLS);
  const renderRows = Math.min(rows.length, Math.ceil(capCells / columns.length));
  const renderCols = Math.min(columns.length, 24);
  const rowLabels = rows.slice(0, renderRows);
  const columnLabels = columns.slice(0, renderCols);
  const wellMap = getPlateWellMap(block, rowLabels, columnLabels);

  return (
    <View style={context.styles.miniappPlateGridBlock}>
      <Text style={context.styles.miniappBlockTitle}>{toStringValue(block.title, "Plate Grid")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={context.styles.miniappPlateGridScroller}>
        <View style={context.styles.miniappPlateGridContent}>
          <View style={context.styles.miniappPlateGridRow}>
            <Text style={context.styles.miniappPlateAxisLabel}> </Text>
            {columnLabels.map((columnLabel) => (
              <Text key={columnLabel} style={context.styles.miniappPlateColumnHeader}>
                {columnLabel}
              </Text>
            ))}
          </View>
          {rowLabels.map((rowLabel, rowIndex) => (
            <View key={rowLabel} style={context.styles.miniappPlateGridRow}>
              <Text style={context.styles.miniappPlateAxisLabel}>{rowLabel}</Text>
              {columnLabels.map((columnLabel, columnIndex) => {
                const visibleIndex = rowIndex * columnLabels.length + columnIndex;
                if (visibleIndex >= capCells) return <View key={`${rowLabel}-${columnLabel}`} style={context.styles.miniappPlateGridCell} />;
                const tone = wellMap.get(`${rowLabel}-${columnLabel}`) || "empty";
                return (
                  <View key={`${rowLabel}-${columnLabel}`} style={[context.styles.miniappPlateGridCell, context.styles[`miniappPlateGridCell${tone[0].toUpperCase()}${tone.slice(1)}`]]}>
                    <Text style={context.styles.miniappPlateGridCellText}>{/* well label intentionally omitted */}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={context.styles.miniappFallbackText}>Plate wells are capped at {MAX_WELLS} cells.</Text>
    </View>
  );
}

function TableCellFallback({ children, context }: { children: string; context: RendererContext }) {
  return <Text style={context.styles.miniappFallbackText}>{children}</Text>;
}

function EmptyBlockFallback({ context }: { context: RendererContext }) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappFallbackText}>No content in this block.</Text>
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
    backendActionSupport: true,
    capabilities: { aiActionSupport: true, backendActionSupport: true, interactive: true, stateful: true },
    visual: { accent: "indigo", density: "compact", liquidGlassSurface: "command_bar", motion: "press", role: "command_bar" },
    render: ({ block, context }) => <ActionRowBlockView block={block} context={context} />,
  }),
  action_row: defineMiniappBlock({
    schemaFields: ["actions", "actionItems", "title"],
    exportSupport: false,
    editable: true,
    aiActionSupport: true,
    backendActionSupport: true,
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
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label="Formula result" />,
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
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label="Formula" />,
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
    render: ({ block, context }) => <FormulaResultBlockView block={block} context={context} label="Result" />,
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
// La navigazione esterna è bloccata: i link non aprono nulla in Fase 0
// (follow-up: aprire nel browser di sistema con consenso esplicito).
function HtmlBlockView({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  const html = toStringValue(block.html ?? block.source ?? "");
  const height = Math.max(160, Math.min(1200, Math.floor(Number(block.height) || 480)));
  const backgroundColor = "#0b1512";
  const wrapped = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:12px;background:${backgroundColor};color:#e6f0ec;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55}img{max-width:100%}a{color:#5eead4}pre{white-space:pre-wrap;background:rgba(255,255,255,.06);padding:10px;border-radius:10px;overflow-x:auto}table{border-collapse:collapse}td,th{border:1px solid rgba(255,255,255,.18);padding:6px 10px}</style></head><body>${html}</body></html>`;

  if (!html.trim()) {
    return <Text style={context.styles.miniappFallbackText}>Empty html block</Text>;
  }

  return (
    <View style={{ borderRadius: 14, overflow: "hidden", alignSelf: "stretch" }}>
      <WebView
        originWhitelist={["about:", "data:"]}
        source={{ html: wrapped }}
        style={{ height, backgroundColor }}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => {
          const url = request.url;
          return url.startsWith("about:") || url.startsWith("data:") || url.startsWith("file:");
        }}
      />
    </View>
  );
}

function UnsupportedBlock({ block, context }: { block: MiniappBlock; context: RendererContext }) {
  return (
    <View style={context.styles.miniappFallbackBlock}>
      <Text style={context.styles.miniappFallbackText}>Unsupported miniapp block: {toStringValue(block.type, "unknown")}</Text>
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
  const blockType = toStringValue(block.type);
  const registryEntry = ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY[blockType];
  if (!registryEntry) {
    return <UnsupportedBlock block={block} context={context} />;
  }
  const content = registryEntry.render({
    block,
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
  styles,
  variant,
}: {
  children: React.ReactNode;
  styles: Record<string, any>;
  variant?: "ios" | "android" | "vision";
}) {
  const resolvedVariant = variant || Platform.select({ ios: "ios", android: "android", default: "android" });

  if (resolvedVariant === "vision") {
    return (
      <BlurView intensity={52} tint="light" style={styles.miniappVisionShell}>
        <LinearGradient
          colors={["rgba(255,255,255,0.7)", "rgba(255,255,255,0.26)", "rgba(255,255,255,0.14)"]}
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
      <BlurView intensity={40} tint="light" style={styles.miniappIosShell}>
        <LinearGradient
          colors={["rgba(255,255,255,0.44)", "rgba(255,255,255,0.18)", "rgba(255,255,255,0.10)"]}
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
        colors={["rgba(255,255,255,0.24)", "rgba(255,255,255,0.10)", "rgba(255,255,255,0.06)"]}
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
  const windowDimensions = useWindowDimensions();
  const [localMiniapp, setLocalMiniapp] = useState<Miniapp>(() => normalizeMiniappState(miniapp));
  const [inputs, setInputs] = useState<Record<string, number>>(() => seedInputs(miniapp));
  const [pathwaySelectionState, setPathwaySelectionState] = useState<PathwayEditorState>({
    selectedPathwayNodeId: null,
    selectedPathwayEdgeId: null,
    pathwayAddSourceId: null,
    pathwayAddTargetId: null,
  });
  const miniappExportSurfaceRef = useRef<View>(null);
  const navigationItems = useMemo(() => parseNavigationItems(localMiniapp.navigation), [localMiniapp.navigation]);
  const [activeView, setActiveView] = useState(() => deriveInitialNavigationView(localMiniapp.state?.activeView, navigationItems));
  const [statusText, setStatusText] = useState("");
  const pathwayViewport = useMemo(
    () => derivePathwayViewport(windowDimensions.width, windowDimensions.height, windowDimensions.fontScale),
    [windowDimensions.fontScale, windowDimensions.height, windowDimensions.width],
  );

  const syncPathwaySelectionState = (nextMiniapp: Miniapp, patch: Partial<PathwayEditorState> = {}) => {
    setPathwaySelectionState((current) => {
      const graphBlock = getPathwayGraphBlock(nextMiniapp);
      if (!graphBlock) {
        return {
          selectedPathwayNodeId: null,
          selectedPathwayEdgeId: null,
          pathwayAddSourceId: null,
          pathwayAddTargetId: null,
        };
      }
      const nodes = dedupePathwayNodes(parsePathwayGraphNodes(graphBlock)).map((node) => node.id.toLowerCase());
      const edges = dedupePathwayEdges(parsePathwayGraphEdges(graphBlock)).map((edge) => edge.id.toLowerCase());
      const nextState: PathwayEditorState = { ...current, ...patch };
      const nodeSet = new Set(nodes);
      const edgeSet = new Set(edges);
      const selectedPathwayNodeId = nextState.selectedPathwayNodeId && nodeSet.has(nextState.selectedPathwayNodeId.toLowerCase())
        ? nextState.selectedPathwayNodeId
        : null;
      const selectedPathwayEdgeId = nextState.selectedPathwayEdgeId && edgeSet.has(nextState.selectedPathwayEdgeId.toLowerCase())
        ? nextState.selectedPathwayEdgeId
        : null;
      const pathwayAddSourceId = nextState.pathwayAddSourceId && nodeSet.has(nextState.pathwayAddSourceId.toLowerCase())
        ? nextState.pathwayAddSourceId
        : null;
      const pathwayAddTargetId = nextState.pathwayAddTargetId && nodeSet.has(nextState.pathwayAddTargetId.toLowerCase())
        ? nextState.pathwayAddTargetId
        : null;
      return {
        selectedPathwayNodeId,
        selectedPathwayEdgeId: selectedPathwayEdgeId && !selectedPathwayNodeId ? selectedPathwayEdgeId : null,
        pathwayAddSourceId,
        pathwayAddTargetId,
      };
    });
  };

  const applyPathwayActionLocally = (action: MiniappAction) => {
    const localResult = applyLocalAction(action, localMiniapp, pathwaySelectionState);
    if (!localResult) return false;
    const nextMiniapp = localResult.miniapp;
    setLocalMiniapp(nextMiniapp);
    setStatusText(localResult.status);
    syncPathwaySelectionState(nextMiniapp, {
      selectedPathwayNodeId: localResult.selectedPathwayNodeId ?? pathwaySelectionState.selectedPathwayNodeId,
      selectedPathwayEdgeId: localResult.selectedPathwayEdgeId ?? pathwaySelectionState.selectedPathwayEdgeId,
      pathwayAddSourceId: localResult.pathwayAddSourceId,
      pathwayAddTargetId: localResult.pathwayAddTargetId,
    });
    return true;
  };

  useEffect(() => {
    const normalized = normalizeMiniappState(miniapp);
    const items = parseNavigationItems(normalized.navigation);
    setLocalMiniapp(normalized);
    setInputs(seedInputs(normalized));
    setActiveView(deriveInitialNavigationView(normalized.state?.activeView, items));
    setPathwaySelectionState({
      selectedPathwayNodeId: null,
      selectedPathwayEdgeId: null,
      pathwayAddSourceId: null,
      pathwayAddTargetId: null,
    });
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
      const actionId = getActionId(action);
      if (
        actionId === LOCAL_ACTIONS.EXPORT_PNG ||
        actionId === LOCAL_ACTIONS.EXPORT_JPEG ||
        actionId === LOCAL_ACTIONS.EXPORT_SVG ||
        actionId === LOCAL_ACTIONS.EXPORT_JSON
      ) {
        try {
          if (!miniappExportSurfaceRef.current || Platform.OS === "web") {
            setStatusText("Export is currently available on native platforms only.");
            return;
          }

          if (actionId === LOCAL_ACTIONS.EXPORT_PNG || actionId === LOCAL_ACTIONS.EXPORT_JPEG) {
            const format = actionId === LOCAL_ACTIONS.EXPORT_JPEG ? "jpg" : "png";
            const imageUri = await captureRef(miniappExportSurfaceRef.current, {
              format,
              quality: 1,
              result: "tmpfile",
            });
            if (onAction) onAction({ ...action, resultUri: imageUri }, localMiniapp);
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(imageUri, {
                dialogTitle: `Export miniapp ${format.toUpperCase()}`,
                mimeType: format === "png" ? "image/png" : "image/jpeg",
              });
            }
            setStatusText(`Miniapp exported as ${format.toUpperCase()}.`);
            return;
          }

          const extension = actionId === LOCAL_ACTIONS.EXPORT_SVG ? "svg" : actionId === LOCAL_ACTIONS.EXPORT_JPEG ? "jpg" : "json";
          const targetUri = buildMiniappExportFileName(localMiniapp, extension);
          const payload = actionId === LOCAL_ACTIONS.EXPORT_SVG ? buildMiniappSvgText(localMiniapp) : JSON.stringify(localMiniapp, null, 2);
          await FileSystem.writeAsStringAsync(targetUri, payload, { encoding: "utf8" });
          if (onAction) onAction({ ...action, resultUri: targetUri }, localMiniapp);
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(targetUri, {
              dialogTitle: `Export miniapp ${extension.toUpperCase()}`,
                mimeType: extension === "json"
                  ? "application/json"
                  : extension === "svg"
                    ? "image/svg+xml"
                    : "image/jpeg",
            });
          }
          setStatusText(`Miniapp exported as ${extension.toUpperCase()}.`);
        } catch {
          setStatusText("Could not export miniapp.");
        }
        return;
      }

      if (applyPathwayActionLocally(action)) {
        return;
      }
      if (isMiniappExportAction(action) || getActionId(action) === LOCAL_ACTIONS.GENERATE_REPORT) {
        setStatusText("Preparing action...");
      }
      onAction?.(action, localMiniapp);
    };
    if (action.requiresConfirm) {
      Alert.alert(
        action.label || "Run action",
        "This action may use AI to generate a result from your current calculator values.",
        [
          { style: "cancel", text: "Cancel" },
          { onPress: () => { void execute(); }, text: "Continue" },
        ],
      );
      return;
    }
    void execute();
  };

  const blockContext: RendererContext = {
    computed,
    index: 0,
    inputs,
    pathwayViewport,
    runAction,
    setInput,
    selectedPathwayNodeId: pathwaySelectionState.selectedPathwayNodeId,
    selectedPathwayEdgeId: pathwaySelectionState.selectedPathwayEdgeId,
    pathwayEditor: {
      pathwayAddSourceId: pathwaySelectionState.pathwayAddSourceId,
      pathwayAddTargetId: pathwaySelectionState.pathwayAddTargetId,
      addEdge: () => applyPathwayActionLocally({ id: LOCAL_ACTIONS.ADD_EDGE }),
      addNode: () => applyPathwayActionLocally({ id: LOCAL_ACTIONS.ADD_NODE }),
      deleteSelected: () => applyPathwayActionLocally({ id: LOCAL_ACTIONS.DELETE_SELECTED }),
      moveSelectedNode: (direction) => {
        const directionToPattern = {
          left: "left",
          right: "right",
          up: "up",
          down: "down",
        }[direction];
        applyPathwayActionLocally({ id: LOCAL_ACTIONS.MOVE_NODE, pattern: directionToPattern });
      },
      setDraftEndpoint: (key, value) => syncPathwaySelectionState(localMiniapp, { [key]: value }),
      setEdgeLabel: (value) => {
        const localResult = updateSelectedPathwayEdgeLabel(localMiniapp, pathwaySelectionState, value);
        setLocalMiniapp(localResult.miniapp);
        setStatusText(localResult.status);
        syncPathwaySelectionState(localResult.miniapp, {
          selectedPathwayNodeId: localResult.selectedPathwayNodeId ?? pathwaySelectionState.selectedPathwayNodeId,
          selectedPathwayEdgeId: localResult.selectedPathwayEdgeId ?? pathwaySelectionState.selectedPathwayEdgeId,
          pathwayAddSourceId: localResult.pathwayAddSourceId,
          pathwayAddTargetId: localResult.pathwayAddTargetId,
        });
      },
      setEdgeKind: (kind) => applyPathwayActionLocally({ id: LOCAL_ACTIONS.SET_EDGE_KIND, pattern: kind }),
      setNodeLabel: (value) => applyPathwayActionLocally({ id: LOCAL_ACTIONS.RENAME_NODE, pattern: value }),
      setNodeKind: (kind) => applyPathwayActionLocally({ id: LOCAL_ACTIONS.SET_NODE_KIND, pattern: kind }),
      onSelectNode: (nodeId) => {
        syncPathwaySelectionState(localMiniapp, {
          selectedPathwayNodeId: nodeId,
          selectedPathwayEdgeId: null,
          pathwayAddSourceId: null,
          pathwayAddTargetId: null,
        });
      },
      onSelectEdge: (edgeId) => {
        syncPathwaySelectionState(localMiniapp, {
          selectedPathwayEdgeId: edgeId,
          selectedPathwayNodeId: null,
        });
      },
    },
    styles,
  };
  const visibleBlocks = asArray<MiniappBlock>(localMiniapp.blocks, MAX_CHILD_BLOCKS).filter((block) =>
    isBlockVisibleInActiveView(block, activeView),
  );

  return (
    <GlassSurface styles={styles} variant={glassVariant}>
      <View accessibilityLabel={`Interactive miniapp: ${localMiniapp.title}`} ref={miniappExportSurfaceRef}>
        <View style={styles.miniappHeader}>
          <View style={styles.miniappIconBadge}>
            <Ionicons color={colors.primaryText} name="flask-outline" size={18} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.miniappEyebrow}>Interactive lab miniapp</Text>
            <Text style={styles.miniappTitle}>{localMiniapp.title}</Text>
            <Text style={styles.miniappSubtitle}>{localMiniapp.kind.replace(/_/g, " ")}</Text>
          </View>
        </View>

        {navigationItems.length ? (
          <View style={styles.miniappSegmentRow}>
            {navigationItems.map((item) => {
              const selected = item.id === activeView;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={item.id}
                  onPress={() => setActiveView(item.id)}
                  style={[styles.miniappSegment, selected ? styles.miniappSegmentActive : null]}
                >
                  <Text style={styles.miniappSegmentText}>{item.label}</Text>
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
                <Text style={styles.miniappPrimaryActionText}>{String(action.label || action.id || "Run")}</Text>
                {action.requiresAi ? <Ionicons color={colors.ink ?? colors.primaryText} name="sparkles-outline" size={14} /> : null}
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
