/**
 * Android SoC codes (`SM8550`, from the device profile) → marketing names
 * that the Worker's cpuModel pattern accepts. Unknown codes return undefined
 * and the field is omitted rather than sent as a raw code.
 */

const SNAPDRAGON_BY_CODE: Readonly<Record<string, string>> = {
  SM7475: "Snapdragon 7+ Gen 2",
  SM7550: "Snapdragon 7 Gen 3",
  SM8450: "Snapdragon 8 Gen 1",
  SM8475: "Snapdragon 8+ Gen 1",
  SM8550: "Snapdragon 8 Gen 2",
  SM8650: "Snapdragon 8 Gen 3",
  // SM8750 ("Snapdragon 8 Elite") is absent: the Worker pattern has no
  // "8 Elite" form yet, so naming it would only get the field dropped.
};

export function snapdragonMarketingName(socModel: string | null | undefined): string | undefined {
  if (typeof socModel !== "string") return undefined;
  const code = /\bSM\d{4}\b/i.exec(socModel)?.[0].toUpperCase();
  return code === undefined ? undefined : SNAPDRAGON_BY_CODE[code];
}
