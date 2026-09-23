/**
 * The composer's one-shot mode arms — research and notes (D1 row 14): the
 * state + draft-empty auto-clear, the toggles, the capture-and-clear inside a
 * send (`sendHost.ts` through `armsSendOptions`) and the clear on
 * conversation change (the root's `onConversationEnter`).
 *
 * The third chip of that row — the library document — is not here: the
 * attach flow landed and its ENTRY moved to the attach sheet
 * (`HostAttachSheet.tsx`), because the row's arithmetic holds exactly two
 * chips (`composerToolbarWidth.test.ts`).
 *
 * The draft rule is a pure predicate so the semantics are testable without a
 * render harness: a draft that HAD content and now has none drops both arms —
 * clearing the field is not consent to keep research riding the next send.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Had content, now blank → clear both arms. */
export function armsShouldClearOnDraft(draft: string, hadContent: boolean): boolean {
  return hadContent && draft.trim().length === 0;
}

/** The research branch invokes app-side tools, so it is local-only. */
export function researchIntentForBackend(remoteBackend: boolean, requested: boolean): boolean {
  return !remoteBackend && requested;
}

export function shouldRefuseRemoteResearch(remoteBackend: boolean, requested: boolean): boolean {
  return remoteBackend && requested;
}

export function researchChipVisible(remoteBackend: boolean, armed: boolean): boolean {
  return armed && !remoteBackend;
}

/**
 * The options one send builds from the arms plus the typed deep-research
 * trigger: `null` means nothing changes and no `options` object is handed to
 * the engine half.
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
  clearResearch: () => void;
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
  const clearResearch = useCallback(() => {
    researchRef.current = false;
    setResearch(false);
  }, []);
  const clear = useCallback(() => {
    clearResearch();
    notesRef.current = false;
    setNotes(false);
  }, [clearResearch]);

  return { research, notes, researchRef, notesRef, toggleResearch, toggleNotes, clearResearch, clear };
}
