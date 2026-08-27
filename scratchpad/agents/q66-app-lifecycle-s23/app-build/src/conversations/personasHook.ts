/**
 * Personas (Phase 3): user-authored {id,name,instructions} in
 * kalsa.personas.v1. Anyone can type their own; a later "store" is just
 * import-by-URL into that same list. Inject instructions on the last user
 * message (format B), never buildSystemPrompt. Cap ~2k chars.
 *
 * Implementation lives in PersonasStore.ts — this file re-exports the
 * public surface so older import paths stay valid.
 */

export {
  BUILTIN_PERSONA_IDS,
  PERSONAS_ACTIVE_KEY,
  PERSONAS_KEY,
  PERSONA_INSTRUCTIONS_CAP,
  PERSONA_NAME_CAP,
  builtinPersona,
  emptyPersonasPersisted,
  findPersona,
  getDefaultPersonasStorage,
  isBuiltinPersonaId,
  listAllPersonas,
  listVisiblePersonas,
  loadPersonasState,
  nextPersonaId,
  parseActivePersonaId,
  parsePersonasPersisted,
  removeUserPersona,
  sanitizePersonaInstructions,
  sanitizePersonaName,
  saveActivePersonaId,
  savePersonasState,
  serializePersonasPersisted,
  setBuiltinHidden,
  upsertUserPersona,
  type BuiltinCopy,
  type BuiltinPersonaId,
  type Persona,
  type PersonasPersisted,
} from "./PersonasStore";
