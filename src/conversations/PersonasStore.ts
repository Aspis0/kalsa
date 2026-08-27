/**
 * User-authored personas. Builtins are templates to copy, not locked roles.
 *
 * Storage: kalsa.personas.v1 (user items + hidden builtin ids) and
 * kalsa.personas.activeId.
 *
 * Inject instructions on the last user message (format B) via personaTail —
 * never buildSystemPrompt.
 *
 * A persona "store" is import-by-URL into this same list (GET json
 * {name, instructions}, validate length, append). No marketplace UI in v1.
 */

import { PERSONA_INSTRUCTIONS_CAP, sanitizePersonaInstructions } from "../engine/personaTail";
import type { KeyValueStorage } from "./ConversationsStore";

export const PERSONAS_KEY = "kalsa.personas.v1";
export const PERSONAS_ACTIVE_KEY = "kalsa.personas.activeId";
export const PERSONA_NAME_CAP = 48;

export const BUILTIN_PERSONA_IDS = [
  "builtin-assistant",
  "builtin-coder",
  "builtin-translator",
  "builtin-mentor",
] as const;

export type BuiltinPersonaId = (typeof BUILTIN_PERSONA_IDS)[number];

export type Persona = {
  id: string;
  name: string;
  instructions: string;
  builtin?: boolean;
};

export type PersonasPersisted = {
  items: Persona[];
  hiddenBuiltinIds: string[];
};

export type BuiltinCopy = Record<BuiltinPersonaId, { name: string; instructions: string }>;

export function isBuiltinPersonaId(id: string): id is BuiltinPersonaId {
  return (BUILTIN_PERSONA_IDS as readonly string[]).includes(id);
}

export function emptyPersonasPersisted(): PersonasPersisted {
  return { items: [], hiddenBuiltinIds: [] };
}

export function nextPersonaId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `persona-${Date.now()}-${rand}`;
}

export function sanitizePersonaName(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, PERSONA_NAME_CAP);
}

export function sanitizePersonaId(id: string): string {
  if (typeof id !== "string") {
    throw new Error("persona id required");
  }
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) {
    throw new Error("empty persona id");
  }
  return safe;
}

function sanitizeUserPersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (isBuiltinPersonaId(o.id)) return null;
  let id: string;
  try {
    id = sanitizePersonaId(o.id);
  } catch {
    return null;
  }
  if (id !== o.id) return null;
  const name = sanitizePersonaName(typeof o.name === "string" ? o.name : "");
  const instructions = sanitizePersonaInstructions(
    typeof o.instructions === "string" ? o.instructions : "",
  );
  if (!name || !instructions) return null;
  return { id, name, instructions };
}

export function parsePersonasPersisted(raw: string | null | undefined): PersonasPersisted {
  if (!raw || typeof raw !== "string") return emptyPersonasPersisted();
  try {
    const obj = JSON.parse(raw) as { items?: unknown; hiddenBuiltinIds?: unknown };
    if (!obj || typeof obj !== "object") return emptyPersonasPersisted();
    const items: Persona[] = [];
    if (Array.isArray(obj.items)) {
      for (const item of obj.items) {
        const persona = sanitizeUserPersona(item);
        if (persona && !items.some((existing) => existing.id === persona.id)) {
          items.push(persona);
        }
      }
    }
    const hiddenBuiltinIds: string[] = [];
    if (Array.isArray(obj.hiddenBuiltinIds)) {
      for (const id of obj.hiddenBuiltinIds) {
        if (typeof id === "string" && isBuiltinPersonaId(id) && !hiddenBuiltinIds.includes(id)) {
          hiddenBuiltinIds.push(id);
        }
      }
    }
    return { items, hiddenBuiltinIds };
  } catch {
    return emptyPersonasPersisted();
  }
}

export function serializePersonasPersisted(state: PersonasPersisted): string {
  const items = Array.isArray(state?.items)
    ? state.items
        .map((item) => sanitizeUserPersona(item))
        .filter((item): item is Persona => item !== null)
    : [];
  const hiddenBuiltinIds = Array.isArray(state?.hiddenBuiltinIds)
    ? state.hiddenBuiltinIds.filter((id) => isBuiltinPersonaId(id))
    : [];
  return JSON.stringify({ items, hiddenBuiltinIds });
}

export function builtinPersona(
  id: BuiltinPersonaId,
  copy: { name: string; instructions: string },
): Persona {
  return {
    id,
    name: sanitizePersonaName(copy.name) || id,
    instructions: sanitizePersonaInstructions(copy.instructions),
    builtin: true,
  };
}

export function listVisiblePersonas(state: PersonasPersisted, builtins: BuiltinCopy): Persona[] {
  const hidden = new Set(state.hiddenBuiltinIds);
  const templates = BUILTIN_PERSONA_IDS.filter((id) => !hidden.has(id)).map((id) =>
    builtinPersona(id, builtins[id]),
  );
  return [...templates, ...state.items];
}

export function listAllPersonas(state: PersonasPersisted, builtins: BuiltinCopy): Persona[] {
  const templates = BUILTIN_PERSONA_IDS.map((id) => builtinPersona(id, builtins[id]));
  return [...templates, ...state.items];
}

export function findPersona(
  state: PersonasPersisted,
  id: string,
  builtins: BuiltinCopy,
): Persona | null {
  if (!id) return null;
  if (isBuiltinPersonaId(id)) {
    return builtinPersona(id, builtins[id]);
  }
  return state.items.find((item) => item.id === id) ?? null;
}

export function upsertUserPersona(state: PersonasPersisted, persona: Persona): PersonasPersisted {
  const cleaned = sanitizeUserPersona(persona);
  if (!cleaned) return { items: state.items.slice(), hiddenBuiltinIds: state.hiddenBuiltinIds.slice() };
  const items = state.items.filter((item) => item.id !== cleaned.id);
  items.push(cleaned);
  return { items, hiddenBuiltinIds: state.hiddenBuiltinIds.slice() };
}

export function removeUserPersona(state: PersonasPersisted, id: string): PersonasPersisted {
  if (!id || isBuiltinPersonaId(id)) {
    return { items: state.items.slice(), hiddenBuiltinIds: state.hiddenBuiltinIds.slice() };
  }
  return {
    items: state.items.filter((item) => item.id !== id),
    hiddenBuiltinIds: state.hiddenBuiltinIds.slice(),
  };
}

export function setBuiltinHidden(
  state: PersonasPersisted,
  id: string,
  hidden: boolean,
): PersonasPersisted {
  if (!isBuiltinPersonaId(id)) {
    return { items: state.items.slice(), hiddenBuiltinIds: state.hiddenBuiltinIds.slice() };
  }
  const next = state.hiddenBuiltinIds.filter((item) => item !== id);
  if (hidden) next.push(id);
  return { items: state.items.slice(), hiddenBuiltinIds: next };
}

export function parseActivePersonaId(
  raw: string | null | undefined,
  state: PersonasPersisted,
): string {
  if (!raw || typeof raw !== "string") return "";
  if (isBuiltinPersonaId(raw)) {
    return state.hiddenBuiltinIds.includes(raw) ? "" : raw;
  }
  return state.items.some((item) => item.id === raw) ? raw : "";
}

export async function loadPersonasState(
  storage: KeyValueStorage,
): Promise<{ state: PersonasPersisted; activeId: string }> {
  let persistedRaw: string | null = null;
  let activeRaw: string | null = null;
  try {
    persistedRaw = await storage.getItem(PERSONAS_KEY);
  } catch {
    persistedRaw = null;
  }
  try {
    activeRaw = await storage.getItem(PERSONAS_ACTIVE_KEY);
  } catch {
    activeRaw = null;
  }
  const state = parsePersonasPersisted(persistedRaw);
  return { state, activeId: parseActivePersonaId(activeRaw, state) };
}

export async function savePersonasState(
  storage: KeyValueStorage,
  state: PersonasPersisted,
): Promise<void> {
  await storage.setItem(PERSONAS_KEY, serializePersonasPersisted(state));
}

export async function saveActivePersonaId(
  storage: KeyValueStorage,
  id: string,
): Promise<void> {
  const value = typeof id === "string" ? id : "";
  await storage.setItem(PERSONAS_ACTIVE_KEY, value);
}

export function getDefaultPersonasStorage(): KeyValueStorage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage")
    .default as KeyValueStorage;
  return AsyncStorage;
}

export { PERSONA_INSTRUCTIONS_CAP, sanitizePersonaInstructions };
