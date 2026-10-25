import { MAIL_TOOLS } from "../tools/definitions";

/**
 * Which tool runs belong to the mailbox, by name. `mail_show` is not one of
 * MAIL_TOOLS because it is built per language, so it is named here: a run this
 * misses would keep a stranger's words on disk.
 */
export function isMailRun(name: string): boolean {
  return name === "mail_show" || MAIL_TOOLS.some((tool) => tool.function.name === name);
}
