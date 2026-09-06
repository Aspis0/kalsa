// Miniapp templates offered inside the QuickActionSheet "miniapp" action.
// Labels, subtitles and the prefilled-chat prompt are resolved from i18n
// (see src/i18n/en.ts and src/i18n/it.ts under `quickActions.*`).

import { type TranslationKey } from "../i18n";

export type MiniappTemplateId =
  | "compare_data"
  | "quick_calculator"
  | "reading_quiz"
  | "kpi_strip"
  | "checklist"
  | "pros_cons";

export type MiniappTemplate = {
  id: MiniappTemplateId;
  /** i18n key for the human-readable label. */
  labelKey: TranslationKey;
  /** i18n key for the short subtitle. */
  subKey: TranslationKey;
  /** i18n key for the prompt that prefills the chat when the template is chosen. */
  promptKey: TranslationKey;
};

export const MINIAPP_TEMPLATES: MiniappTemplate[] = [
  {
    id: "compare_data",
    labelKey: "quickActions.compareData",
    subKey: "quickActions.compareDataSub",
    promptKey: "quickActions.compareDataPrompt",
  },
  {
    id: "quick_calculator",
    labelKey: "quickActions.quickCalculator",
    subKey: "quickActions.quickCalculatorSub",
    promptKey: "quickActions.quickCalculatorPrompt",
  },
  {
    id: "reading_quiz",
    labelKey: "quickActions.readingQuiz",
    subKey: "quickActions.readingQuizSub",
    promptKey: "quickActions.readingQuizPrompt",
  },
  {
    id: "kpi_strip",
    labelKey: "quickActions.kpiStrip",
    subKey: "quickActions.kpiStripSub",
    promptKey: "quickActions.kpiStripPrompt",
  },
  {
    id: "checklist",
    labelKey: "quickActions.checklist",
    subKey: "quickActions.checklistSub",
    promptKey: "quickActions.checklistPrompt",
  },
  {
    id: "pros_cons",
    labelKey: "quickActions.prosCons",
    subKey: "quickActions.prosConsSub",
    promptKey: "quickActions.prosConsPrompt",
  },
];

export const MINIAPP_TEMPLATE_IDS: ReadonlyArray<MiniappTemplateId> = Object.freeze([
  "compare_data",
  "quick_calculator",
  "reading_quiz",
  "kpi_strip",
  "checklist",
  "pros_cons",
]);