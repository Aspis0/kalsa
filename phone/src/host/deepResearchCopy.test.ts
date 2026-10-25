jest.mock("react-native", () => ({}));
jest.mock("lucide-react-native", () => ({
  BookOpen: "BookOpen",
  Camera: "Camera",
  FileText: "FileText",
  Image: "Image",
  Search: "Search",
  Share2: "Share2",
  Sparkles: "Sparkles",
  StickyNote: "StickyNote",
  Trash2: "Trash2",
  X: "X",
}));

import { makeT } from "../i18n";
import { buildHostAttachActionRows } from "./HostAttachSheet";

const cases = [
  {
    locale: "it" as const,
    title: "Report dai documenti",
    active: "Report dai documenti attivo — tocca per disattivare",
    planning: "Pianifico il report…",
    query: "Cerco nei documenti 2/4…",
    writing: "Scrivo il report…",
    noResults: "Non ho trovato passaggi rilevanti nei documenti per questa domanda.",
    partial: " (parziale — alcuni documenti non erano disponibili)",
    needsQuestion: "Scrivi una domanda per cercare nei tuoi documenti.",
    ignoringImages: "Il report usa i documenti di testo — le immagini di questo messaggio non verranno usate.",
    writerFailed: "Il report dai documenti non è stato completato — i passaggi trovati sono qui sotto.",
    interrupted: "Report interrotto perché il motore del modello è cambiato. Invia di nuovo per riprovare.",
    emptyLibrary: "Nessun documento in libreria da ricercare. Aggiungi prima dei documenti.",
    attachedMissing: "I documenti allegati non sono più in libreria. Aggiungili di nuovo e reinvia.",
  },
  {
    locale: "en" as const,
    title: "Report from documents",
    active: "Report from documents on — tap to disable",
    planning: "Planning the report…",
    query: "Searching documents 2/4…",
    writing: "Writing report…",
    noResults: "No relevant passages were found in the documents for this question.",
    partial: " (partial — some documents were unavailable)",
    needsQuestion: "Write a question to search your documents.",
    ignoringImages: "The report uses text documents — images in this message won't be used.",
    writerFailed: "The document report could not be completed — the passages found are below.",
    interrupted: "The report was interrupted because the model engine changed. Send again to retry.",
    emptyLibrary: "No documents in the library to research. Add documents first.",
    attachedMissing: "The attached documents are no longer in the library. Add them back and send again.",
  },
];

describe("document report copy", () => {
  it.each(cases)("uses document-source wording in $locale", (copy) => {
    const t = makeT(copy.locale);
    expect(t("chat.deepResearch")).toBe(copy.title);
    expect(t("chat.deepResearchPlanning")).toBe(copy.planning);
    expect(t("chat.deepResearchQuery", { n: 2, total: 4 })).toBe(copy.query);
    expect(t("chat.deepResearchWriting")).toBe(copy.writing);
    expect(t("chat.deepResearchNoResults")).toBe(copy.noResults);
    expect(t("chat.deepResearchPartial")).toBe(copy.partial);
    expect(t("chat.deepResearchNeedsQuestion")).toBe(copy.needsQuestion);
    expect(t("chat.deepResearchIgnoringImages")).toBe(copy.ignoringImages);
    expect(t("chat.deepResearchWriterFailed")).toBe(copy.writerFailed);
    expect(t("chat.deepResearchInterrupted")).toBe(copy.interrupted);
    expect(t("errors.deepResearchEmptyLibrary")).toBe(copy.emptyLibrary);
    expect(t("errors.deepResearchAttachedMissing")).toBe(copy.attachedMissing);
  });

  it.each(cases)("keeps the attach row a switch and names its active state in $locale", (copy) => {
    const t = makeT(copy.locale);
    const inactiveAction = jest.fn();
    const inactive = buildHostAttachActionRows({
      researchActive: false,
      notesActive: false,
      actionsDisabled: false,
      onAction: inactiveAction,
    }, t).find((row) => row.testID === "shell.attach.research");
    expect(inactive).toMatchObject({
      label: copy.title,
      role: "switch",
      selected: false,
    });
    inactive?.onPress();
    expect(inactiveAction).toHaveBeenCalledWith("research");

    const active = buildHostAttachActionRows({
      researchActive: true,
      notesActive: false,
      actionsDisabled: false,
      onAction: jest.fn(),
    }, t).find((row) => row.testID === "shell.attach.research");
    expect(active).toMatchObject({
      label: copy.active,
      role: "switch",
      selected: true,
    });
    expect(active?.accessibilityLabel ?? active?.label).toBe(copy.active);
  });
});
