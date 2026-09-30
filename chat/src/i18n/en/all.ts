// The English source: every other language is typed against this shape.

import { CHROME, SETTINGS } from "./chrome";
import { COMPOSER, BRAIN_BAR } from "./composer";
import { ADVANCED } from "./advanced";
import { ROOM, type RoomTable } from "./room";

export interface English {
  chrome: typeof CHROME;
  settings: typeof SETTINGS;
  composer: typeof COMPOSER;
  brainBar: typeof BRAIN_BAR;
  advanced: typeof ADVANCED;
  room: RoomTable;
}

export const ENGLISH: English = {
  chrome: CHROME,
  settings: SETTINGS,
  composer: COMPOSER,
  brainBar: BRAIN_BAR,
  advanced: ADVANCED,
  room: ROOM,
};
