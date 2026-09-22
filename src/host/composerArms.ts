/**
 * The composer's one-shot mode arms — research and notes (D1 row 14) — lifted
 * from `AiChatPage.tsx:1251-1273` (state + the draft-empty auto-clear),
 * `:3642-3653` (the toggles), `:2454-2463` (capture-and-clear inside a send,
 * done in `sendHost.ts` through `armsSendOptions`) and `:1894-1897` (the clear
 * on conversation change, which the root's `onConversationEnter` calls).
 *
 * The third chip of that row — the library document — needs `attachedItems`
 * and the picker sheet (D1 row 43 / gap 5), which this slice does not build;
 * it ships as a §2.7 stub that says why when pressed (`HostChatSurface`), not
 * as a chip that would sit there inactive and lie.
 *
 * The draft rule is a pure predicate so the semantics are testable without a
 * render harness (DESIGN.md, "proof regime"): a draft that HAD content and now
 * has none drops both arms — clearing the field is not consent to keep research
 * riding the next send.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Old `AiChatPage:1266-1271`: had content, now blank → clear both arms. */
export function armsShouldClearOnDraft(draft: string, hadContent: boolean): boolean {
  return hadContent && draft.trim().length === 0;
}

/**
 * The options one send builds from the arms plus the typed deep-research
 * trigger (old `AiChatPage:2454-2463`): `null` means nothing changes and no
 * `options` object is handed to the engine half.
 */
export function armsSendOptions(
  armedResearch: boolean,
  armedNotes: boolean,
  keywordResearch: boolean,
): { research: boolean; notes: boolean } | null {
  const research = armedResearch || keywordResearch;
  if (!research && !armedNotes) return null;
  return { research, notes: armedNotes };
}

export type ComposerArms = {
  /** For the chips' active paint. */
  research: boolean;
  notes: boolean;
  /** The mid-send read side: the engine half's request reads the refs, so a
   *  send never sees the render's snapshot (the controller's own idiom). */
  researchRef: { current: boolean };
  notesRef: { current: boolean };
  toggleResearch: () => void;
  toggleNotes: () => void;
  /** Send / conversation change both drop the arms. */
  clear: () => void;
};

export function useComposerArms(draft: string): ComposerArms {
  const [research, setResearch] = useState(false);
  const [notes, setNotes] = useState(false);
  const researchRef = useRef(false);
  researchRef.current = research;
  const notesRef = useRef(false);
  notesRef.current = notes;

  const draftHadContentRef = useRef(false);
  useEffect(() => {
    if (armsShouldClearOnDraft(draft, draftHadContentRef.current)) {
      notesRef.current = false;
      setNotes(false);
      researchRef.current = false;
      setResearch(false);
    }
    draftHadContentRef.current = draft.trim().length > 0;
  }, [draft]);

  const toggleResearch = useCallback(() => {
    researchRef.current = !researchRef.current;
    setResearch(researchRef.current);
  }, []);
  const toggleNotes = useCallback(() => {
    notesRef.current = !notesRef.current;
    setNotes(notesRef.current);
  }, []);
  const clear = useCallback(() => {
    researchRef.current = false;
    setResearch(false);
    notesRef.current = false;
    setNotes(false);
  }, []);

  return { research, notes, researchRef, notesRef, toggleResearch, toggleNotes, clear };
}
