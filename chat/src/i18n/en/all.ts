// The English source: every other language is typed against this shape.

import { CHROME, SETTINGS } from "./chrome";
import { COMPOSER, BRAIN_BAR } from "./composer";
import { ADVANCED } from "./advanced";
import { ROOM, type RoomTable } from "./room";
import { THREAD } from "./thread";
import { TOOLS } from "./tools";
import { SIDEBAR } from "./sidebar";
import { FILES } from "./files";
import { FIRST_PAGE } from "./firstPage";
import { CRASH } from "./crash";
import { SETUP } from "./setup";
import { MACHINE } from "./machine";
import { SERVER } from "./server";
import { POWER } from "./power";
import { DEVICES } from "./devices";
import { INVITE } from "./invite";
import { SHELL } from "./shell";

export interface English {
  chrome: typeof CHROME;
  settings: typeof SETTINGS;
  composer: typeof COMPOSER;
  brainBar: typeof BRAIN_BAR;
  advanced: typeof ADVANCED;
  room: RoomTable;
  thread: typeof THREAD;
  tools: typeof TOOLS;
  sidebar: typeof SIDEBAR;
  files: typeof FILES;
  firstPage: typeof FIRST_PAGE;
  crash: typeof CRASH;
  setup: typeof SETUP;
  machine: typeof MACHINE;
  server: typeof SERVER;
  power: typeof POWER;
  devices: typeof DEVICES;
  invite: typeof INVITE;
  shell: typeof SHELL;
}

export const ENGLISH: English = {
  chrome: CHROME,
  settings: SETTINGS,
  composer: COMPOSER,
  brainBar: BRAIN_BAR,
  advanced: ADVANCED,
  room: ROOM,
  thread: THREAD,
  tools: TOOLS,
  sidebar: SIDEBAR,
  files: FILES,
  firstPage: FIRST_PAGE,
  crash: CRASH,
  setup: SETUP,
  machine: MACHINE,
  server: SERVER,
  power: POWER,
  devices: DEVICES,
  invite: INVITE,
  shell: SHELL,
};
