// The English source: every other language is typed against this shape.

import { CHROME, SETTINGS } from "./chrome";
import { COMPOSER, BRAIN_BAR } from "./composer";
import { ROOM, type RoomTable } from "./room";

export interface English {
  chrome: typeof CHROME;
  settings: typeof SETTINGS;
  composer: typeof COMPOSER;
  brainBar: typeof BRAIN_BAR;
  room: RoomTable;
}

export const ENGLISH: English = {
  chrome: CHROME,
  settings: SETTINGS,
  composer: COMPOSER,
  brainBar: BRAIN_BAR,
  room: ROOM,
};
