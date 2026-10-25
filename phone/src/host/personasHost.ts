/**
 * Personas: state, the active id and the refresh — lifted from
 * `AppShell.tsx:917-941`. The drawer reads the label and the engine half
 * resolves instructions through `findPersona`; `PersonasScreen` writes the
 * store and reports the active id back through `onActiveChange`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDefaultPersonasStorage,
  loadPersonasState,
  type PersonasPersisted,
} from "../conversations/PersonasStore";

export function usePersonasHost(): {
  personasState: PersonasPersisted;
  personasStateRef: { current: PersonasPersisted };
  activePersonaId: string;
  activePersonaIdRef: { current: string };
  setActivePersonaId: (id: string) => void;
  refreshPersonas: () => Promise<void>;
} {
  const [personasState, setPersonasState] = useState<PersonasPersisted>({
    items: [],
    hiddenBuiltinIds: [],
  });
  const [activePersonaId, setActivePersonaId] = useState("");
  const personasStateRef = useRef(personasState);
  personasStateRef.current = personasState;
  const activePersonaIdRef = useRef(activePersonaId);
  activePersonaIdRef.current = activePersonaId;

  const refreshPersonas = useCallback(async () => {
    try {
      const loaded = await loadPersonasState(getDefaultPersonasStorage());
      setPersonasState(loaded.state);
      setActivePersonaId(loaded.activeId);
    } catch {
      // keep last
    }
  }, []);

  useEffect(() => {
    void refreshPersonas();
  }, [refreshPersonas]);

  return {
    personasState,
    personasStateRef,
    activePersonaId,
    activePersonaIdRef,
    setActivePersonaId,
    refreshPersonas,
  };
}
