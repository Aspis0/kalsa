/**
 * The six templates `create_miniapp` accepts. One list, read by the tool
 * schema and by the dispatch in `build.ts`, so the enum the model sees and
 * the builders that can run cannot drift apart.
 */
export type MiniappTemplateId =
  | "compare_data"
  | "quick_calculator"
  | "reading_quiz"
  | "kpi_strip"
  | "checklist"
  | "pros_cons";

export const MINIAPP_TEMPLATE_IDS: ReadonlyArray<MiniappTemplateId> = Object.freeze([
  "compare_data",
  "quick_calculator",
  "reading_quiz",
  "kpi_strip",
  "checklist",
  "pros_cons",
]);
