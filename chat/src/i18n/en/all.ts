import { TELEMETRY } from "./telemetry";
import { UPDATES } from "./updates";
import { HELP } from "./help";
// The English source: every other language is typed against this shape.

import { CHROME, SETTINGS } from "./chrome";
import { COMPOSER } from "./composer";
import { HOME } from "./home";
import { ADVANCED } from "./advanced";
import { ROOM, type RoomTable } from "./room";
import { THREAD } from "./thread";
import { VIEWER } from "./viewer";
import { TOOLS } from "./tools";
import { MINIAPP } from "./miniapp";
import { SIDEBAR } from "./sidebar";
import { FILES } from "./files";
import { FIRST_PAGE } from "./firstPage";
import { CRASH } from "./crash";
import { REPORT } from "./report";
import { SETUP } from "./setup";
import { MACHINE } from "./machine";
import { POWER } from "./power";
import { DEVICES } from "./devices";
import { INVITE } from "./invite";
import { SHELL } from "./shell";
import { KNOBS } from "./knobs";
import { SAMPLING } from "./sampling";
import { BROWSER } from "./browser";
import { MARKDOWN } from "./markdown";
import { VISION } from "./vision";
import { RUST } from "./rust";
import { CONTENT_FILTER } from "./contentFilter";

export interface English {
  telemetry: typeof TELEMETRY;
  updates: typeof UPDATES;
  help: typeof HELP;
  chrome: typeof CHROME;
  settings: typeof SETTINGS;
  composer: typeof COMPOSER;
  home: typeof HOME;
  advanced: typeof ADVANCED;
  room: RoomTable;
  thread: typeof THREAD;
  viewer: typeof VIEWER;
  tools: typeof TOOLS;
  miniapp: typeof MINIAPP;
  sidebar: typeof SIDEBAR;
  files: typeof FILES;
  firstPage: typeof FIRST_PAGE;
  crash: typeof CRASH;
  report: typeof REPORT;
  setup: typeof SETUP;
  machine: typeof MACHINE;
  power: typeof POWER;
  devices: typeof DEVICES;
  invite: typeof INVITE;
  shell: typeof SHELL;
  knobs: typeof KNOBS;
  sampling: typeof SAMPLING;
  browser: typeof BROWSER;
  markdown: typeof MARKDOWN;
  vision: typeof VISION;
  rust: {
    startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    update: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    road: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    files: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    vision: Record<string, (params: Record<string, unknown>, tag: string) => string>;
    web: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  };
  contentFilter: typeof CONTENT_FILTER;
}

export const ENGLISH: English = {
  telemetry: TELEMETRY,
  updates: UPDATES,
  help: HELP,
  chrome: CHROME,
  settings: SETTINGS,
  composer: COMPOSER,
  home: HOME,
  advanced: ADVANCED,
  room: ROOM,
  thread: THREAD,
  viewer: VIEWER,
  tools: TOOLS,
  miniapp: MINIAPP,
  sidebar: SIDEBAR,
  files: FILES,
  firstPage: FIRST_PAGE,
  crash: CRASH,
  report: REPORT,
  setup: SETUP,
  machine: MACHINE,
  power: POWER,
  devices: DEVICES,
  invite: INVITE,
  shell: SHELL,
  knobs: KNOBS,
  sampling: SAMPLING,
  browser: BROWSER,
  markdown: MARKDOWN,
  vision: VISION,
  rust: RUST,
  contentFilter: CONTENT_FILTER,
};
