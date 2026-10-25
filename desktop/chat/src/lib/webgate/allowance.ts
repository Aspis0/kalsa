import type { GateCheck } from "../tools/registry";

/**
 * What the owner has allowed in one conversation: the ids of the documents the
 * allowed checks carried, and whether they carried mail. Keyed by id, so a new
 * document with the same name asks again. Memory only — a restart forgets it,
 * and a refusal never adds to it.
 */
export interface Allowance {
  documentIds: Set<string>;
  mail: boolean;
}

export type Allowances = Map<string, Allowance>;

/**
 * A check the owner need not be asked about again: nothing was flagged, and
 * everything it carries was allowed in this conversation before. A finding is
 * always asked about, because the words it flags are new.
 */
export function covered(allowances: Allowances, conversationId: string, check: GateCheck): boolean {
  const allowed = allowances.get(conversationId);
  if (allowed === undefined || check.findings.length > 0) return false;
  return check.documentIds.every((id) => allowed.documentIds.has(id)) && (!check.mail || allowed.mail);
}

/** Widens what the conversation allows by what an allowed check carried. */
export function remember(allowances: Allowances, conversationId: string, check: GateCheck): void {
  const allowed = allowances.get(conversationId) ?? { documentIds: new Set<string>(), mail: false };
  for (const id of check.documentIds) allowed.documentIds.add(id);
  allowed.mail = allowed.mail || check.mail;
  allowances.set(conversationId, allowed);
}
