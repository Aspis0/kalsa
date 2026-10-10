/**
 * The page's two languages: which one a request gets, and the page's own words in each.
 */
import { GUIDE_HTML, GUIDE_HTML_IT } from "./guide";

export type Lang = "en" | "it";

export interface PageCopy {
  lead: string;
  windows: string;
  mac: string;
  comingSoon: string;
  readFirst: string;
  guideTitle: string;
  guide: string;
  switchTo: { lang: Lang; label: string };
}

export const COPY: Record<Lang, PageCopy> = {
  en: {
    lead: "An AI that runs on your own computer: your messages are answered there, not in the cloud.",
    windows: "Download for Windows",
    mac: "Download for Mac (Apple silicon)",
    comingSoon: "coming soon",
    readFirst: "Read this first",
    guideTitle: "Tester guide",
    guide: GUIDE_HTML,
    switchTo: { lang: "it", label: "Italiano" },
  },
  it: {
    lead: "Un'intelligenza artificiale che lavora sul tuo computer: le risposte nascono lì, non nel cloud.",
    windows: "Scarica per Windows",
    mac: "Scarica per Mac (Apple silicon)",
    comingSoon: "in arrivo",
    readFirst: "Prima di installare, leggi la guida",
    guideTitle: "Guida per chi prova l'alpha",
    guide: GUIDE_HTML_IT,
    switchTo: { lang: "en", label: "English" },
  },
};

/** `?lang=` wins; otherwise the browser's first preferred language; otherwise English. */
export function pickLang(url: URL, acceptLanguage: string | null): Lang {
  const asked = url.searchParams.get("lang");
  if (asked === "en" || asked === "it") return asked;
  const first = (acceptLanguage ?? "").split(",")[0].trim().toLowerCase();
  return first === "it" || first.startsWith("it-") || first.startsWith("it;") ? "it" : "en";
}
