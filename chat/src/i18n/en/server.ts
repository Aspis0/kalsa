// The Server page: its own metrics grid and the disk tier's rows.

export const SERVER = {
  eyebrow: "STATUS",
  notMeasuredYet: "Not measured yet",
  tokensPerSecond: (rate: string) => `${rate} tokens/s`,
  connected: "Connected",
  notConnected: "Not connected",
  decode: "Decode",
  measuredByServer: "Measured by the server",
  devices: "Devices",
  liveConnection: "Live connection",
  throttled: "This computer is running slower on purpose, to protect itself. Answers take longer than usual.",
  // The tier's rows, each value and detail a whole message.
  residentChats: "Resident chats",
  residentsOfCapacity: (residents: number, capacity: number) => `${residents} of ${capacity}`,
  inDoorSlotMap: "In the door's slot map",
  savedOnDisk: "Saved on disk",
  filesUnreadable: (files: number, unreadable: number) => `${files} files read, ${unreadable} unreadable — total incomplete`,
  filesFromScan: (files: number) => `${files} files, from a scan of the save directory`,
  twoDevices: "Two devices decoding",
  eachX: (rate: string) => `${rate}x each`,
  perSlot: (a: string, b: string) => `${a}x / ${b}x per slot`,
  together: (per: string, aggregate: string) => `${per}, ${aggregate}x together`,
  concurrencyDetail: (tag: string, platform: string) => `Decode rate vs one device, not wall time — measured on ${tag}, ${platform}`,
};
