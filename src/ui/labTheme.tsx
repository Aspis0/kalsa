import React, { createContext, useContext } from "react";

export const ThemeContext = createContext<any | null>(null);

export function useLabTheme<T = any>(): T {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useLabTheme must be used inside ThemeContext");
  }
  return theme;
}
