/**
 * Which mails carry an attachment, as far as this session has seen. A list
 * record does not say (reading every mail to find out would defeat the point of
 * the list), so the card's download button appears once that mail has actually
 * been read. Memory only, like every other part of the envelope.
 */

const byId = new Map<string, string[]>();

export function remember(id: string, names: string[]): void {
  if (names.length > 0) byId.set(id, names);
}

export function count(id: string): number {
  return byId.get(id)?.length ?? 0;
}

export function clear(): void {
  byId.clear();
}