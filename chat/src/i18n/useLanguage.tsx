// The chosen language, as React state: Settings changes it and every
// reader re-renders at once. The override persists beside the app's other
// settings; without one, the system's best language among the five wins.

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { TABLES, systemLanguage, type Language, type Table } from ".";

export const LANGUAGE_KEY = "crescent-chat.language.v1";

type Stored = Language | "system";

function readOverride(): Stored | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === "system" || saved === "en" || saved === "it" || saved === "es" || saved === "fr" || saved === "zh") {
      return saved;
    }
  } catch {
    // No storage: the system language decides.
  }
  return null;
}

function writeOverride(choice: Stored): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, choice);
  } catch {
    // The session keeps the choice in memory.
  }
}

interface LanguageChoice {
  language: Language;
  table: Table;
  /** The override as stored: "system" or a language code. */
  override: Stored;
  choose: (choice: Stored) => void;
}

const LanguageContext = createContext<LanguageChoice | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<Stored>(() => readOverride() ?? "system");
  const value = useMemo<LanguageChoice>(() => {
    const language = override === "system" ? systemLanguage() : override;
    return {
      language,
      table: TABLES[language],
      override,
      choose: (choice) => {
        writeOverride(choice);
        setOverride(choice);
      },
    };
  }, [override]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageChoice {
  const choice = useContext(LanguageContext);
  if (choice === null) throw new Error("useLanguage needs the LanguageProvider");
  return choice;
}

/** For the bench, which mounts surfaces without the provider: the English
    table read directly. */
export function english(): Table {
  return TABLES.en;
}
