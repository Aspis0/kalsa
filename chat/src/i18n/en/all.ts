// The English source. English is the only language this build ships.

import { CHROME, SETTINGS } from "./chrome";
import { COMPOSER } from "./composer";
import { FIRST_PAGE } from "./firstPage";
import { MACHINE } from "./machine";
import { MARKDOWN } from "./markdown";
import { SETUP } from "./setup";
import { SHELL } from "./shell";
import { SIDEBAR } from "./sidebar";
import { THREAD } from "./thread";

export interface English {
  chrome: typeof CHROME;
  settings: typeof SETTINGS;
  composer: typeof COMPOSER;
  firstPage: typeof FIRST_PAGE;
  machine: typeof MACHINE;
  markdown: typeof MARKDOWN;
  setup: typeof SETUP;
  shell: typeof SHELL;
  sidebar: typeof SIDEBAR;
  thread: typeof THREAD;
}

export const ENGLISH: English = {
  chrome: CHROME,
  settings: SETTINGS,
  composer: COMPOSER,
  firstPage: FIRST_PAGE,
  machine: MACHINE,
  markdown: MARKDOWN,
  setup: SETUP,
  shell: SHELL,
  sidebar: SIDEBAR,
  thread: THREAD,
};
