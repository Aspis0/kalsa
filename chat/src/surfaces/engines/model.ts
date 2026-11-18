import type { Engine, EnginesView, EngineKind } from "./types";

export type ViewKey =
  | "rec"
  | "runs"
  | "all"
  | "off"
  | `hw:${string}`
  | `kind:${EngineKind}`
  | "badge:reviewed"
  | "badge:not-reviewed";

export interface ViewDef {
  title: string;
  all: boolean;
  hardware?: string;
  kind?: EngineKind;
  reviewed?: boolean;
  off?: boolean;
}

export const VIEWS: Record<ViewKey, ViewDef> = {
  rec: { title: "Recommended", all: false },
  runs: { title: "Runs on this Mac", all: false },
  all: { title: "All engines", all: true },
  "hw:apple": { title: "Apple Silicon", all: true, hardware: "apple" },
  "hw:nvidia": { title: "NVIDIA", all: true, hardware: "nvidia" },
  "hw:amd": { title: "AMD", all: true, hardware: "amd" },
  "hw:intel": { title: "Intel", all: true, hardware: "intel" },
  "hw:cpu": { title: "CPU", all: true, hardware: "cpu" },
  "kind:reference": { title: "Reference engines", all: true, kind: "reference" },
  "kind:fork": { title: "Forks", all: true, kind: "fork" },
  "kind:engine": { title: "Engines", all: true, kind: "engine" },
  "badge:reviewed": { title: "Reviewed", all: true, reviewed: true },
  "badge:not-reviewed": { title: "Not reviewed", all: true, reviewed: false },
  off: { title: "Not for this Mac", all: true, off: true },
};

export interface FilterState {
  query: string;
  license: string;
  sort: "rank" | "name";
}

export const emptyFilter = (): FilterState => ({ query: "", license: "all", sort: "rank" });

/** A tok/s figure the way the mock shows it: whole numbers keep one decimal. */
export const fmt = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

export const runsOnMac = (engine: Engine, tag: string): boolean => engine.hardware.includes(tag);

export function chipGeneration(tag: string): number | null {
  return tag.startsWith("apple-m") ? Number(tag.slice(7)) : null;
}

export function hardwareText(tags: string[]): string[] {
  const generations = tags
    .map(chipGeneration)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const out: string[] = [];
  if (generations.length) {
    const run =
      generations.length > 2
        && generations[generations.length - 1] - generations[0] === generations.length - 1;
    out.push(
      `Apple ${run ? `M${generations[0]}–M${generations[generations.length - 1]}` : generations.map((g) => `M${g}`).join(", ")}`,
    );
  }
  for (const [tag, label] of Object.entries({ nvidia: "NVIDIA", amd: "AMD", intel: "Intel", cpu: "CPU" })) {
    if (tags.includes(tag)) out.push(label);
  }
  return out;
}

export function authorName(engine: Engine): string {
  return engine.author.replace(/\s*\(org\)/, "");
}

export function isOrganisation(engine: Engine): boolean {
  return /\(org\)/.test(engine.author);
}

export function notForText(engine: Engine, tag: string): string {
  if (runsOnMac(engine, tag)) return "";
  const apple = engine.hardware.filter((value) => chipGeneration(value) !== null);
  if (!apple.length) return `Built for ${hardwareText(engine.hardware).join(", ")}, not Apple Silicon`;
  const generations = apple.map(chipGeneration).filter((value): value is number => value !== null);
  if (generations.length === 1) return `Built for Apple M${generations[0]} only`;
  const contiguous = generations[generations.length - 1] - generations[0] === generations.length - 1;
  if (contiguous) return `Needs Apple M${generations[0]} or newer`;
  const names = generations.map((generation) => `M${generation}`);
  return `Built for Apple ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function offReasonCounts(view: EnginesView): { vendor: number; apple: number } {
  let vendor = 0;
  let apple = 0;
  for (const engine of view.engines) {
    if (runsOnMac(engine, view.machine.chipTag)) continue;
    if (engine.hardware.some((tag) => chipGeneration(tag) !== null)) apple += 1;
    else vendor += 1;
  }
  return { vendor, apple };
}

export function memoryText(bytes: number): string {
  return bytes > 0 ? `${Math.round(bytes / 1024 ** 3)} GB` : "unknown";
}

export function viewCount(key: ViewKey, view: EnginesView): number {
  if (key === "rec") return Math.min(3, view.picks.length);
  const def = VIEWS[key];
  const list = filteredEngines(view, { ...emptyFilter(), license: "all" }, key);
  return list.filter((engine) => (def.off ? !runsOnMac(engine, view.machine.chipTag) : true)).length;
}

function rustOrderedEngines(view: EnginesView): Engine[] {
  const byId = new Map(view.engines.map((engine) => [engine.id, engine]));
  const ranked = view.picks
    .map((pick) => byId.get(pick.engineId))
    .filter((engine): engine is Engine => engine !== undefined);
  const seen = new Set(ranked.map((engine) => engine.id));
  const rest = view.engines
    .filter((engine) => !seen.has(engine.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...rest];
}

function filteredEngines(view: EnginesView, filter: FilterState, key: ViewKey): Engine[] {
  const def = VIEWS[key];
  const query = filter.query.trim().toLowerCase();
  return rustOrderedEngines(view).filter((engine) => {
    if (!def.all && !runsOnMac(engine, view.machine.chipTag)) return false;
    if (def.kind && engine.kind !== def.kind) return false;
    if (def.reviewed !== undefined && (engine.reviewed !== null) !== def.reviewed) return false;
    if (def.hardware === "apple" ? !engine.hardware.some((tag) => chipGeneration(tag) !== null)
      : def.hardware && !engine.hardware.includes(def.hardware)) return false;
    if (filter.license !== "all" && engine.license !== filter.license) return false;
    if (!query) return true;
    const haystack = [
      engine.name, engine.repo, engine.author, engine.summary, engine.license,
      ...engine.benchmark.map((benchmark) => benchmark.model),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

/** "For this Mac" is the order Rust's `recommend` gives; "Name, A to Z" is the only other order. */
export function visibleEngines(
  view: EnginesView,
  key: ViewKey,
  filter: FilterState,
): Engine[] {
  const list = viewCountSource(view, key, filter);
  if (filter.sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function viewCountSource(view: EnginesView, key: ViewKey, filter: FilterState): Engine[] {
  const def = VIEWS[key];
  const list = filteredEngines(view, filter, key);
  const afterOff = def.off ? list.filter((engine) => !runsOnMac(engine, view.machine.chipTag)) : list;
  return afterOff;
}
