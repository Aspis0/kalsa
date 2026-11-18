import { ENGLISH } from "./en/all";

/** This build ships one language. The hook keeps the components unchanged
    when a second table is added later. */
export function useLanguage() {
  return { table: ENGLISH, tag: "en" };
}
