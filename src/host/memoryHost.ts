/**
 * User memory as the send path sees it: the facts snapshot, the enabled
 * mirror and the refresh. The facts feed the prompt (bound at send, inside
 * the engine half); nothing renders them in this slice — the old
 * `memoryBannerKey` was set-only (PARITY D2 row 18) and is dropped with a
 * report, not revived.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as MemoryStore from "../memory/MemoryStore";

export function useMemoryHost(): {
  memoryFacts: MemoryStore.MemoryFact[];
  setMemoryFacts: (facts: MemoryStore.MemoryFact[]) => void;
  memoryFactsRef: { current: MemoryStore.MemoryFact[] };
  memoryEnabledRef: { current: boolean };
  injectedFactsRef: { current: string[] };
  refreshMemoryFacts: () => Promise<void>;
} {
  const memoryFactsRef = useRef<MemoryStore.MemoryFact[]>([]);
  /** Mirror of MemoryStore.getEnabled — never inject facts when false. */
  const memoryEnabledRef = useRef(false);
  /**
   * Facts actually injected this turn (last-user tail). Captured at send time
   * so the search echo guard still matches them if the user disables memory
   * mid-turn.
   */
  const injectedFactsRef = useRef<string[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryStore.MemoryFact[]>([]);
  memoryFactsRef.current = memoryFacts;

  const refreshMemoryFacts = useCallback(async () => {
    try {
      const enabled = await MemoryStore.getEnabled();
      memoryEnabledRef.current = enabled;
      if (!enabled) {
        setMemoryFacts([]);
        return;
      }
      const facts = await MemoryStore.listFacts();
      setMemoryFacts(facts);
    } catch {
      // best-effort; never block UI, never log contents
    }
  }, []);

  useEffect(() => {
    void refreshMemoryFacts();
  }, [refreshMemoryFacts]);

  return {
    memoryFacts,
    setMemoryFacts,
    memoryFactsRef,
    memoryEnabledRef,
    injectedFactsRef,
    refreshMemoryFacts,
  };
}
