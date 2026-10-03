// The Advanced panel's own words: everything around the knobs, and the
// model-name field. The knob words live in `knobs`.

export const ADVANCED = {
  modelName: "Model name",
  modelNamePlaceholder: "my-model",
  modelNameError: "Enter the model's name.",
  // The first page's arm when no name is stored. The words live here, not on
  // the first page, because the button opens this panel.
  noModelYet: "This computer has no model name yet.",
  addModelName: "Add the model name",
  eyebrow: "ADVANCED",
  title: "Server settings",
  noteRunning: "The current server stays as it is. Changes apply next time you turn on.",
  noteStopped: "Changes apply next time you turn on.",
  noteNoApp: "These settings are available inside the Kalsa app.",
  automatic: "Automatic",
  automaticWith: (value: string) => `Automatic — ${value}`,
  automaticBare: "automatic",
  maximumWith: (value: string) => `Maximum — ${value}`,
  presetsAria: "Context size",
  // The context field's help, by what the machine has answered.
  contextNoMaximum: "The app reads the machine before choosing a context. The bigger f16 cache roughly halves it.",
  contextNoAutomatic: (maximum: string) => `Up to ${maximum} on this computer. A smaller value uses less memory.`,
  contextFull: (automatic: string, automaticTokens: string, maximum: string) =>
    `Automatic is ${automatic} (${automaticTokens} tokens). Up to ${maximum} on this computer.`,
  contextCost: (tokens: string, bytes: string) => ` The KV cache for ${tokens} tokens uses ${bytes}.`,
  // The other fields' help lines.
  automaticNumber: (value: string) => `Automatic is ${value}.`,
  automaticReadLater: (label: string) => `The app will read the machine before choosing a ${label}.`,
  batchSizeName: "batch size",
  ubatchSizeName: "micro-batch size",
  cacheAutomatic: (value: string) => `Automatic is ${value}.`,
  cacheReadLater: "The app will read the machine before choosing a cache type.",
  cacheLessMemory: "q8_0 — less memory",
  cacheMorePrecision: "f16 — more cache precision",
  idleHelp: "The model is released from memory after this much sitting idle, so an ordinary pause does not reload it. The running server keeps the time it started with, so this takes effect the next time you turn on.",
  idleOneMinute: "1 minute",
  idleMinutes: (count: string) => `${count} minutes`,
  idleSeconds: (count: string) => `${count} seconds`,
  roadWaiting: "The internet road is waiting for the server to run.",
  roadPermissionNote: "Kalsa will ask to find devices on your local network, so your phone can reach this computer at home.",
  // The values line and the connection note. The engine's own words (a tune
  // line, a cache type) pass through as they arrive.
  valuesInForce: (parts: { lead: string; context: string; batch: string; ubatch: string; kv: string; flash: string; gpu: string; threads: string; idle: string; tune: string | null }) =>
    `${parts.lead}: context ${parts.context}; batch ${parts.batch}; micro-batch ${parts.ubatch}; KV ${parts.kv}; flash attention ${parts.flash}; GPU layers ${parts.gpu}; threads ${parts.threads}; idle unload ${parts.idle}.${parts.tune}`,
  valuesWaiting: "The values in force will appear here when the app is open.",
  inForce: "In force",
  nextStart: "Next start",
  secondsWord: "seconds",
  automaticWord: "automatic",
  tuneWord: "tune",
  doorLocal: (port: string) => `Local door: ${port}.`,
  doorNotUp: "not up yet",
  runForTailscale: (commands: string) => `Run for Tailscale: ${commands}.`,
  chatsAt: "The phone chats at this computer's tailnet name.",
  pairsAt: "The phone pairs at this computer's tailnet name with :8443.",
  chatsAndPairs: "The phone chats at this computer's tailnet name and pairs at that name with :8443.",
  deskMoved: (port: number) => ` The pairing desk is on ${port} this time — point the desk command at this number.`,
  doorWaiting: "The local door is waiting for the server to run.",
  saveButton: "Save settings",
  saveOk: "Saved for the next start.",
  enterNumber: "Enter a number.",
  // The info popover beside a knob's label. The knob's own words (label,
  // what it is, what it's for) come with the knob, not from here.
  whatItDoes: (label: string) => `What ${label} does`,
  explanationAria: (label: string) => `${label} explanation`,
  whatItIs: "What it is",
  whatItsFor: "What it’s for",
  usualValues: "Usual values",
  noUsualValue: "There is no widely agreed value for this one.",
};
