import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import type { AskAssistantMiniapp } from "../domain/askAssistant";

/**
 * Helper ed export dei miniapp, estratti dal monolite App.tsx originale.
 * Generalizzati: niente plate_grid / SVG bio — solo CSV e JSON generici.
 */

function asMiniappRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .map((row) =>
      row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null,
    )
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

export function quoteMiniappCsvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function flattenMiniappBlocks(blocks: unknown, limit = 160): Array<Record<string, unknown>> {
  const queue = Array.isArray(blocks) ? [...blocks] : [];
  const flattened: Array<Record<string, unknown>> = [];
  while (queue.length && flattened.length < limit) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const block = item as Record<string, unknown>;
    flattened.push(block);
    for (const childKey of ["blocks", "children"]) {
      const children = block[childKey];
      if (Array.isArray(children)) queue.push(...children.slice(0, 40));
    }
    for (const groupKey of ["tabs", "items"]) {
      const groups = block[groupKey];
      if (!Array.isArray(groups)) continue;
      for (const group of groups.slice(0, 24)) {
        if (!group || typeof group !== "object" || Array.isArray(group)) continue;
        const groupBlocks = (group as Record<string, unknown>).blocks;
        if (Array.isArray(groupBlocks)) queue.push(...groupBlocks.slice(0, 40));
      }
    }
  }
  return flattened;
}

export function summarizeMiniappForPrompt(miniapp: AskAssistantMiniapp): string {
  const blocks = flattenMiniappBlocks(miniapp.blocks, 80);
  const summary = {
    actions: Array.isArray(miniapp.actions) ? miniapp.actions.slice(0, 12) : [],
    blocks: blocks.map((block) => ({
      checks: Array.isArray(block.checks) ? block.checks.slice(0, 24) : undefined,
      columns: Array.isArray(block.columns) ? block.columns.slice(0, 24) : undefined,
      metrics: Array.isArray(block.metrics) ? block.metrics.slice(0, 24) : undefined,
      rows: Array.isArray(block.rows) ? block.rows.slice(0, 80) : undefined,
      title: block.title,
      type: block.type,
      visibleIn: block.visibleIn,
    })),
    computed: miniapp.computed,
    kind: miniapp.kind,
    state: miniapp.state,
    title: miniapp.title,
  };
  const json = JSON.stringify(summary);
  return json.length > 12000 ? `${json.slice(0, 12000)}... [truncated]` : json;
}

export function buildMiniappCsv(miniapp: AskAssistantMiniapp): string {
  const blocks = flattenMiniappBlocks(miniapp.blocks);
  const tableBlock = blocks.find((block) =>
    ["data_table", "result_table", "table", "input_table", "editable_table"].includes(String(block.type || "")),
  );
  const rows = asMiniappRows(tableBlock?.rows);
  if (!rows.length) return "message\nNo exportable rows in this miniapp.\n";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 24);
  return [
    columns.map(quoteMiniappCsvCell).join(","),
    ...rows.map((row) => columns.map((column) => quoteMiniappCsvCell(row[column])).join(",")),
  ].join("\n");
}

export function miniappExportFileName(miniapp: AskAssistantMiniapp, extension: string): string {
  const slug =
    String(miniapp.kind || miniapp.title || "miniapp")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "miniapp";
  return `ai-chat-${slug}-${Date.now()}.${extension}`;
}

export type MiniappActionCallbacks = {
  setAskAssistantDraft: (value: string) => void;
  setFeedback: (value: string) => void;
  setMobileError: (value: string) => void;
};

export async function handleAskAssistantMiniappAction(
  action: Record<string, unknown>,
  miniapp: AskAssistantMiniapp,
  callbacks: MiniappActionCallbacks,
): Promise<void> {
  const actionId = String(action.id || "").trim().toLowerCase();

  if (actionId === "generate_report") {
    const prompt = [
      `Generate a concise report from the current ${miniapp.title || miniapp.kind} miniapp state.`,
      "Use only the miniapp JSON below. Include assumptions, calculations, and export-ready notes.",
      summarizeMiniappForPrompt(miniapp),
    ].join("\n\n");
    callbacks.setAskAssistantDraft(prompt);
    callbacks.setFeedback("AI report prompt prepared in Ask AI");
    return;
  }

  if (actionId === "export_csv") {
    try {
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) throw new Error("missing_export_directory");
      const uri = `${directory}${miniappExportFileName(miniapp, "csv")}`;
      await FileSystem.writeAsStringAsync(uri, buildMiniappCsv(miniapp), { encoding: "utf8" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: "Export miniapp CSV", mimeType: "text/csv" });
      }
      callbacks.setFeedback("Miniapp CSV exported");
    } catch {
      callbacks.setMobileError("Could not export the miniapp result.");
    }
    return;
  }

  if (actionId === "export_json") {
    try {
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) throw new Error("missing_export_directory");
      const uri = `${directory}${miniappExportFileName(miniapp, "json")}`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(miniapp, null, 2), { encoding: "utf8" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: "Export miniapp JSON", mimeType: "application/json" });
      }
      callbacks.setFeedback("Miniapp JSON exported");
    } catch {
      callbacks.setMobileError("Could not export the miniapp result.");
    }
    return;
  }

  // Azioni bio legacy (plate maps) rifiutate esplicitamente.
  if (actionId === "export_plate_map") {
    callbacks.setMobileError("Plate maps are not part of the general miniapp format.");
  }
}
