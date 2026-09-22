/**
 * The volatile tool rows (D1 row 23: never persisted), keyed by assistant
 * message — the state `HostRoot.tsx` held inline until the attach flow
 * needed the root's lines: state the root owns, expressed by a hook it
 * calls, so the root stays a composer (`fileSize.test.ts`'s root ratchet).
 *
 * The append is a PURE function beside the hook so the map's rule (never
 * mutate, never touch another message's rows) is testable without a render
 * harness; clear points are the caller's: per conversation change (the
 * root's `handleConversationEnter`) and per abort-handoff
 * (`useHostEffects`), same as the lifted block it replaces.
 */
import { useCallback, useState } from "react";

export type ToolCaptureMap = ReadonlyMap<string, { name: string }[]>;

/** One tool row appended under its assistant message; other keys keep their
 *  array identity (a patch to message A must not re-render message B's row). */
export function appendToolCapture(
  map: ToolCaptureMap,
  assistantId: string,
  name: string,
): ToolCaptureMap {
  const rows = map.get(assistantId) ?? [];
  return new Map(map).set(assistantId, [...rows, { name }]);
}

export function useToolCapture(): {
  toolsById: ToolCaptureMap;
  onToolCapture: (assistantId: string, name: string) => void;
  clearTools: () => void;
} {
  const [toolsById, setToolsById] = useState<ToolCaptureMap>(new Map());
  const onToolCapture = useCallback((assistantId: string, name: string) => {
    setToolsById((prev) => appendToolCapture(prev, assistantId, name));
  }, []);
  const clearTools = useCallback(() => setToolsById(new Map()), []);
  return { toolsById, onToolCapture, clearTools };
}
