// Knob names and their explanations, by each knob's wire name. The names may
// stay technical (the owner's exemption); the explanations are plain and say
// why. One record per knob keeps a language's words beside each other.

export const KNOBS = {
  groups: {
    randomness: "Randomness",
    trimming: "How much it trims",
    repetition: "Repetition",
    alternative: "Alternative samplers",
    thisAnswer: "This answer",
    start: "Start settings",
  },
  automaticPlaceholder: "Automatic",
  // The sampling rows' automatic line, by the read's state.
  autoUnreadable: "The automatic value is unavailable because the server did not answer.",
  autoRefused: "The automatic value is unavailable because the server refused the request.",
  autoInvalid: "The automatic value is unavailable because the server gave an unexpected response.",
  autoNotConfigured: "Automatic will appear after a server is configured.",
  autoLoading: "Getting the automatic value from the server…",
  autoRandom: "Automatic picks a new seed for every message, so the same question can get a different answer.",
  autoServerDecides: "Automatic leaves it to the server, which has not said which value it uses.",
  autoIs: (value: string) => `Automatic is ${value}: the server's own value.`,
  // The validation sentences, one per way a value can be wrong.
  mustBeFinite: (label: string, value: string) => `${label} must be a finite number; got ${value}.`,
  mustBeWhole: (label: string, value: string) => `${label} must be a whole number; got ${value}.`,
  mustBeBetween: (label: string, low: string, high: string, value: string) =>
    `${label} must be between ${low} and ${high}; got ${value}.`,
  saveOk: "Saved. It applies to your next message.",
  saveFailed: "Could not save. Your next message uses the values saved before.",
  // Temperature
  "temperature.label": "Temperature",
  "temperature.whatItIs": "How freely the model picks the next word.",
  "temperature.whatItsFor": "Higher values give more varied, less predictable replies. Lower values give steadier, more repeatable ones.",
  "temperature.usualValues": "0.8 is the llama.cpp default. Lower values suit steadier answers.",
  // dynatemp_range
  "dynatemp_range.label": "Dynamic temperature range",
  "dynatemp_range.whatItIs": "The most the temperature may move up or down, depending on how predictable the next choice looks.",
  "dynatemp_range.whatItsFor": "Adds variety when the model is sure and restraint when it is not. Zero keeps the temperature fixed.",
  // dynatemp_exponent
  "dynatemp_exponent.label": "Dynamic temperature exponent",
  "dynatemp_exponent.whatItIs": "How strongly the model’s uncertainty moves the dynamic temperature.",
  "dynatemp_exponent.whatItsFor": "Sets where the adjustment falls between the lower and upper temperature limits. It does not set the limits.",
  // top_k
  "top_k.label": "Top K",
  "top_k.whatItIs": "Limits the next choice to the K most likely words.",
  "top_k.whatItsFor": "Lower values make answers more predictable. Higher values leave more alternatives, which adds variety and mistakes.",
  "top_k.usualValues": "40 is the llama.cpp default. 0 removes the limit.",
  // top_p
  "top_p.label": "Top P",
  "top_p.whatItIs": "Keeps the smallest group of likely choices whose combined probability reaches P.",
  "top_p.whatItsFor": "Lower values keep to likely wording. Higher values allow more unusual wording and ideas.",
  "top_p.usualValues": "Llama 2 used 0.9. Current llama.cpp uses 0.95.",
  // min_p
  "min_p.label": "Minimum probability",
  "min_p.whatItIs": "Drops any choice that is less likely than P times the most likely choice.",
  "min_p.whatItsFor": "Removes weak alternatives relative to the model’s confidence, so answers stay varied without wandering.",
  "min_p.usualValues": "0.05 is the llama.cpp default. 0 turns the filter off.",
  // typical_p
  "typical_p.label": "Typical probability",
  "typical_p.whatItIs": "Favours choices whose likelihood is close to what the model usually expects at this point in the answer.",
  "typical_p.whatItsFor": "Can reduce dull loops while keeping natural alternatives. 1.0 turns it off.",
  // top_n_sigma
  "top_n_sigma.label": "Top N spread",
  "top_n_sigma.whatItIs": "Keeps the choices within N standard deviations of the best score.",
  "top_n_sigma.whatItsFor": "Removes choices far below the best score. Negative values turn the filter off.",
  // xtc_probability
  "xtc_probability.label": "Exclude top choices chance",
  "xtc_probability.whatItIs": "XTC (Exclude Top Choices) is the chance of removing some of the most likely choices.",
  "xtc_probability.whatItsFor": "Breaks up predictable wording and repeated patterns. Higher values do it more often.",
  // xtc_threshold
  "xtc_threshold.label": "Exclude top choices threshold",
  "xtc_threshold.whatItIs": "The minimum probability a choice needs before XTC may remove it.",
  "xtc_threshold.whatItsFor": "Lower values let XTC affect more choices. Values above 0.5 turn XTC off on this server.",
  // min_keep
  "min_keep.label": "Minimum kept choices",
  "min_keep.whatItIs": "The fewest choices the other filters may leave.",
  "min_keep.whatItsFor": "A safety floor when several filters are combined. 0 lets each filter decide.",
  "min_keep.usualValues": "0 is the default. Other values are normally chosen only for a specific setup.",
  // repeat_penalty
  "repeat_penalty.label": "Repetition penalty",
  "repeat_penalty.whatItIs": "Lowers the chance of words already used in the recent answer.",
  "repeat_penalty.whatItsFor": "Values above 1 reduce repeated phrases. 1 turns the penalty off. Values below 1 encourage repetition.",
  "repeat_penalty.usualValues": "1.0 is the llama.cpp default. Some examples use 1.1.",
  // repeat_last_n
  "repeat_last_n.label": "Repetition lookback",
  "repeat_last_n.whatItIs": "How many recent words the repetition penalty looks at.",
  "repeat_last_n.whatItsFor": "A longer lookback catches older repetition but can make a reply drift from its own wording. 0 turns it off.",
  "repeat_last_n.usualValues": "64 is the llama.cpp default. 0 turns the penalty off.",
  // frequency_penalty
  "frequency_penalty.label": "Frequency penalty",
  "frequency_penalty.whatItIs": "Lowers a choice more each time the same word has already appeared.",
  "frequency_penalty.whatItsFor": "Discourages repeated words and phrases. 0 turns it off.",
  "frequency_penalty.usualValues": "0 is the llama.cpp default. Other values depend on the model and the task.",
  // presence_penalty
  "presence_penalty.label": "Presence penalty",
  "presence_penalty.whatItIs": "Lowers a choice once its word has appeared at all.",
  "presence_penalty.whatItsFor": "Encourages new words and topics. 0 turns it off.",
  "presence_penalty.usualValues": "0 is the llama.cpp default. Other values depend on the model and the task.",
  // dry_multiplier
  "dry_multiplier.label": "DRY repetition multiplier",
  "dry_multiplier.whatItIs": "DRY (Don’t Repeat Yourself) sets how strong the penalty is for extending a repeated sequence.",
  "dry_multiplier.whatItsFor": "Targets longer repeated phrases that ordinary recent-word penalties miss. 0 turns it off.",
  // dry_base
  "dry_base.label": "DRY base",
  "dry_base.whatItIs": "How fast the DRY penalty grows as a repeated sequence gets longer.",
  "dry_base.whatItsFor": "A larger base makes long repetitions increasingly costly. Values below 1 are replaced by the default.",
  "dry_base.usualValues": "1.75 is the llama.cpp default. No other value is widely used.",
  // dry_allowed_length
  "dry_allowed_length.label": "DRY allowed length",
  "dry_allowed_length.whatItIs": "How long a repeated sequence may grow before the DRY penalty starts.",
  "dry_allowed_length.whatItsFor": "Raising it tolerates longer repeats. Lowering it reacts sooner and can make wording less natural.",
  "dry_allowed_length.usualValues": "2 is the llama.cpp default. There is no agreed standard for tuning it.",
  // dry_penalty_last_n
  "dry_penalty_last_n.label": "DRY lookback",
  "dry_penalty_last_n.whatItIs": "How many recent words DRY scans for repeated sequences.",
  "dry_penalty_last_n.whatItsFor": "A longer lookback catches older repetition but costs more processing. 0 turns the DRY penalty off.",
  "dry_penalty_last_n.usualValues": "64 is the llama.cpp default. 0 turns the penalty off.",
  // mirostat
  "mirostat.label": "Mirostat mode",
  "mirostat.whatItIs": "Adjusts its choices while writing to keep the answer near a chosen level of surprise.",
  "mirostat.whatItsFor": "Balances predictable and varied writing over time. 0 turns it off; 1 and 2 are its two versions.",
  "mirostat.usualValues": "0 is the default. No setting suits every model.",
  // mirostat_tau
  "mirostat_tau.label": "Mirostat target",
  "mirostat_tau.whatItIs": "The average surprise Mirostat aims for, measured by how unexpected the choices are.",
  "mirostat_tau.whatItsFor": "Higher values aim for more surprising, varied answers. Lower values aim for more predictable ones.",
  "mirostat_tau.usualValues": "5.0 is the llama.cpp default. No target suits every model.",
  // mirostat_eta
  "mirostat_eta.label": "Mirostat learning rate",
  "mirostat_eta.whatItIs": "How quickly Mirostat reacts when its recent surprise differs from the target.",
  "mirostat_eta.whatItsFor": "Higher values react faster and vary more. Lower values react gently and take longer to settle.",
  "mirostat_eta.usualValues": "0.1 is the llama.cpp default. No rate suits every model.",
  // adaptive_target
  "adaptive_target.label": "Adaptive target",
  "adaptive_target.whatItIs": "The probability the sampler favours, adjusted as the answer goes on.",
  "adaptive_target.whatItsFor": "Balances variety and predictability over time. Negative values turn adaptive sampling off.",
  // adaptive_decay
  "adaptive_decay.label": "Adaptive decay",
  "adaptive_decay.whatItIs": "How much recent choices count for more than older ones when the target is updated.",
  "adaptive_decay.whatItsFor": "Higher values remember more history and change gently. Lower values follow the latest choices more quickly.",
  // seed
  "seed.label": "Random seed",
  "seed.whatItIs": "The starting point for the random choices made when more than one answer is possible.",
  "seed.whatItsFor": "A fixed seed repeats a run with the same input. Random avoids following the same choices every time.",
  "seed.usualValues": "Random is usual. Use a fixed number when you need repeatable tests.",
  // max_tokens
  "max_tokens.label": "Maximum new tokens",
  "max_tokens.whatItIs": "The most new text the assistant may write for one message.",
  "max_tokens.whatItsFor": "A smaller limit ends long replies sooner. Automatic leaves the length unlimited.",
  // Launch knobs.
  "ctx-size.label": "Context size",
  "ctx-size.whatItIs": "How much of the conversation the model can keep in view while answering.",
  "ctx-size.whatItsFor": "A larger context keeps more of the conversation available but uses more memory. Kalsa works out a safe automatic value for the chosen model and computer.",
  "ctx-size.usualValues": "64k where this computer can afford it. The panel shows the KV cache cost of the chosen value, and this computer’s maximum is one click away.",
  "batch-size.label": "Batch size",
  "batch-size.whatItIs": "How many pieces of the prompt the server processes together as one job.",
  "batch-size.whatItsFor": "Larger batches process the prompt faster but need more working memory. It affects start-up speed, not the wording.",
  "batch-size.usualValues": "2048 here; the shipped run reached 1883 tokens/s versus 1151 at the old 512.",
  "ubatch-size.label": "Micro-batch size",
  "ubatch-size.whatItIs": "How many pieces of the prompt the server handles in one memory step.",
  "ubatch-size.whatItsFor": "Larger steps can speed up the prompt but use more buffer memory. This computer’s measured budget limits the useful value.",
  "ubatch-size.usualValues": "512 default; 1024 fits at 346.6–414.0 MiB at 16k; 2048 costs 602.7 MiB at 4096.",
  "cache-type-k/cache-type-v.label": "KV cache type",
  "cache-type-k/cache-type-v.whatItIs": "The precision used to remember the earlier conversation inside the model.",
  "cache-type-k/cache-type-v.whatItsFor": "q8_0 uses less memory and can lose a little precision. f16 keeps more precision but costs twice as much per entry and roughly halves the context this computer can afford.",
  "cache-type-k/cache-type-v.usualValues": "q8_0 is usual here. Choose f16 when precision matters more than context length.",
  "sleep-idle-seconds.label": "Unload after idle",
  "sleep-idle-seconds.whatItIs": "How long the unused model and its conversation cache stay loaded before the server releases them.",
  "sleep-idle-seconds.whatItsFor": "A shorter time frees memory sooner but reloads more often. A longer time keeps the next message ready but holds memory while idle.",
  "sleep-idle-seconds.usualValues": "5 minutes is the default. The choices are 1 minute, 5 minutes and 1 hour.",
  "internet_road.label": "Connect over the internet",
  "internet_road.whatItIs": "An optional iroh connection that gives the phone a second way to reach this computer.",
  "internet_road.whatItsFor": "Turn it on only when the phone cannot connect the usual way. It lists this computer in a public directory; the connection still requires its password.",
  "internet_road.usualValues": "Off, unless the phone cannot reach the computer another way.",
};

/** A knob's words, or English when the table has none — a knob added in
    Rust without a row here must still show its label. The dotted keys sit
    beside the named groups in one object, so the lookup goes through a
    string view of it. */
export function knobWords(knobs: unknown, wire: string, field: "label" | "whatItIs" | "whatItsFor" | "usualValues", fallback: string): string {
  const flat = knobs as Record<string, string>;
  return flat[`${wire}.${field}`] ?? fallback;
}
