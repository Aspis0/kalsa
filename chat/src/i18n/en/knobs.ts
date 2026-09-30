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
  autoUnreadable: "Automatic could not be read because the server did not answer.",
  autoRefused: "Automatic could not be read because the server refused the request.",
  autoInvalid: "Automatic could not be read because the server returned an unexpected response.",
  autoNotConfigured: "Automatic will appear after a server is configured.",
  autoLoading: "Automatic is being read from the server.",
  autoRandom: "Automatic picks a new seed for every message, so the same question can get a different answer.",
  autoServerDecides: "Automatic leaves it to the server, which has not said which value it uses.",
  autoIs: (value: string) => `Automatic is ${value} — the server's own value.`,
  // The validation sentences, one per way a value can be wrong.
  mustBeFinite: (label: string, value: string) => `${label} must be a finite number; got ${value}.`,
  mustBeWhole: (label: string, value: string) => `${label} must be a whole number; got ${value}.`,
  mustBeBetween: (label: string, low: string, high: string, value: string) =>
    `${label} must be between ${low} and ${high}; got ${value}.`,
  saveOk: "Saved. Your next message uses it.",
  saveFailed: "Could not save. Your next message still uses the previously saved values.",
  // Temperature
  "temperature.label": "Temperature",
  "temperature.whatItIs": "Temperature controls how freely the model chooses among possible next pieces of text.",
  "temperature.whatItsFor": "Higher values make replies more varied and less predictable; lower values make them steadier and more repeatable.",
  "temperature.usualValues": "0.8 is the current llama.cpp starting point; lower values suit steadier answers.",
  // dynatemp_range
  "dynatemp_range.label": "Dynamic temperature range",
  "dynatemp_range.whatItIs": "This is the most temperature may move up or down when the model judges the next choice more or less predictable.",
  "dynatemp_range.whatItsFor": "It can add variety when the model is confident and restraint when it is uncertain; zero leaves temperature fixed.",
  // dynatemp_exponent
  "dynatemp_exponent.label": "Dynamic temperature exponent",
  "dynatemp_exponent.whatItIs": "This controls how strongly the model’s uncertainty changes the dynamic temperature.",
  "dynatemp_exponent.whatItsFor": "It changes where the adjustment sits between the lower and upper temperature limits; it does not itself set the limits.",
  // top_k
  "top_k.label": "Top K",
  "top_k.whatItIs": "Top K limits the next choice to the K most likely pieces of text.",
  "top_k.whatItsFor": "Lower values make answers more predictable; higher values leave more alternatives, which can add variety and mistakes.",
  "top_k.usualValues": "40 is the llama.cpp starting point; 0 disables this limit.",
  // top_p
  "top_p.label": "Top P",
  "top_p.whatItIs": "Top P keeps the smallest group of likely next choices whose combined probability reaches P.",
  "top_p.whatItsFor": "Lower values narrow the answer towards likely wording; higher values allow more unusual wording and ideas.",
  "top_p.usualValues": "0.9 is used in Llama 2; current llama.cpp uses 0.95 as its baseline.",
  // min_p
  "min_p.label": "Minimum probability",
  "min_p.whatItIs": "Minimum probability removes a choice that is below P times the probability of the most likely choice.",
  "min_p.whatItsFor": "It filters out weak alternatives while keeping the cutoff relative to the model’s confidence, so answers can stay varied without wandering.",
  "min_p.usualValues": "0.05 is the llama.cpp starting point; 0 disables this filter.",
  // typical_p
  "typical_p.label": "Typical probability",
  "typical_p.whatItIs": "Typical probability favours choices whose likelihood is close to the model’s usual likelihood for this point in the answer.",
  "typical_p.whatItsFor": "It can reduce dull loops while keeping natural alternatives; 1.0 leaves this sampler disabled.",
  // top_n_sigma
  "top_n_sigma.label": "Top N spread",
  "top_n_sigma.whatItIs": "Top N spread keeps choices within N measures of score spread from the best choice.",
  "top_n_sigma.whatItsFor": "It removes choices far below the best score; negative values disable this filter.",
  // xtc_probability
  "xtc_probability.label": "Exclude top choices chance",
  "xtc_probability.whatItIs": "XTC, or Exclude Top Choices, is the chance of removing some of the most likely choices.",
  "xtc_probability.whatItsFor": "It can break predictable wording and repeated patterns; higher values make that intervention happen more often.",
  // xtc_threshold
  "xtc_threshold.label": "Exclude top choices threshold",
  "xtc_threshold.whatItIs": "This is the minimum probability a choice must have before XTC may remove it.",
  "xtc_threshold.whatItsFor": "Lower values let XTC affect more choices; values above 0.5 turn XTC off in this server.",
  // min_keep
  "min_keep.label": "Minimum kept choices",
  "min_keep.whatItIs": "Minimum kept choices prevents the other samplers from reducing the possible next choices below this number.",
  "min_keep.whatItsFor": "It provides a safety floor when several filters are combined; 0 lets each sampler decide freely.",
  "min_keep.usualValues": "0 is the baseline; active values are normally chosen only for a specific sampler setup.",
  // repeat_penalty
  "repeat_penalty.label": "Repetition penalty",
  "repeat_penalty.whatItIs": "Repetition penalty lowers the chance of text pieces already used in the recent answer.",
  "repeat_penalty.whatItsFor": "Values above 1 can reduce repeated phrases; 1 leaves the penalty disabled, while values below 1 can encourage repetition.",
  "repeat_penalty.usualValues": "1.0 is the llama.cpp baseline; some llama.cpp examples use 1.1.",
  // repeat_last_n
  "repeat_last_n.label": "Repetition lookback",
  "repeat_last_n.whatItIs": "Repetition lookback says how many recent text pieces the repetition penalty can inspect.",
  "repeat_last_n.whatItsFor": "A larger lookback catches older repeated wording but can make a reply less faithful to its own established phrasing; 0 disables it.",
  "repeat_last_n.usualValues": "64 is the llama.cpp baseline; 0 disables the penalty.",
  // frequency_penalty
  "frequency_penalty.label": "Frequency penalty",
  "frequency_penalty.whatItIs": "Frequency penalty lowers a choice more each time the same text piece has already appeared.",
  "frequency_penalty.whatItsFor": "It can discourage repeated words and phrases; 0 leaves it disabled.",
  "frequency_penalty.usualValues": "0 is the llama.cpp baseline; active values depend on the model and task.",
  // presence_penalty
  "presence_penalty.label": "Presence penalty",
  "presence_penalty.whatItIs": "Presence penalty lowers a choice simply because the same text piece has appeared before.",
  "presence_penalty.whatItsFor": "It can encourage the answer to introduce different words and topics; 0 leaves it disabled.",
  "presence_penalty.usualValues": "0 is the llama.cpp baseline; active values depend on the model and task.",
  // dry_multiplier
  "dry_multiplier.label": "DRY repetition multiplier",
  "dry_multiplier.whatItIs": "DRY, or Don’t Repeat Yourself, controls the strength of a penalty for extending repeated text sequences.",
  "dry_multiplier.whatItsFor": "It targets longer repeated phrases, including repetitions that ordinary recent-word penalties may miss; 0 disables it.",
  // dry_base
  "dry_base.label": "DRY base",
  "dry_base.whatItIs": "DRY base controls how quickly the DRY penalty grows as a repeated sequence gets longer.",
  "dry_base.whatItsFor": "A larger base makes long repetitions increasingly costly; values below 1 are replaced by the build’s default.",
  "dry_base.usualValues": "1.75 is the llama.cpp baseline; no broader active value is established.",
  // dry_allowed_length
  "dry_allowed_length.label": "DRY allowed length",
  "dry_allowed_length.whatItIs": "DRY allowed length is how long a repeated sequence may become before the DRY penalty starts.",
  "dry_allowed_length.whatItsFor": "Raising it tolerates longer repeated phrases; lowering it reacts sooner and can make wording less natural.",
  "dry_allowed_length.usualValues": "2 is the llama.cpp baseline; task-specific tuning has no agreed standard.",
  // dry_penalty_last_n
  "dry_penalty_last_n.label": "DRY lookback",
  "dry_penalty_last_n.whatItIs": "DRY lookback says how many recent text pieces DRY scans for repeated sequences.",
  "dry_penalty_last_n.whatItsFor": "A larger lookback can catch older repetitions but costs more attention to history; 0 disables DRY’s penalty.",
  "dry_penalty_last_n.usualValues": "64 is the llama.cpp baseline; 0 disables the penalty.",
  // mirostat
  "mirostat.label": "Mirostat mode",
  "mirostat.whatItIs": "Mirostat adjusts its choices while writing to keep the answer near a chosen level of surprise.",
  "mirostat.whatItsFor": "It can balance predictable and varied writing over time; 0 disables it, while 1 and 2 select its two versions.",
  "mirostat.usualValues": "0 is the baseline; there is no agreed enabled choice for every model.",
  // mirostat_tau
  "mirostat_tau.label": "Mirostat target",
  "mirostat_tau.whatItIs": "Mirostat target is the desired average surprise of the model’s choices, measured by how unexpected they are.",
  "mirostat_tau.whatItsFor": "Higher values aim for more surprising, varied answers; lower values aim for more predictable answers.",
  "mirostat_tau.usualValues": "5.0 is the llama.cpp baseline; there is no universal target across models.",
  // mirostat_eta
  "mirostat_eta.label": "Mirostat learning rate",
  "mirostat_eta.whatItIs": "Mirostat learning rate controls how quickly Mirostat reacts when its recent surprise differs from the target.",
  "mirostat_eta.whatItsFor": "Higher values react faster and can vary more; lower values react more gently and can take longer to settle.",
  "mirostat_eta.usualValues": "0.1 is the llama.cpp baseline; there is no universal rate across models.",
  // adaptive_target
  "adaptive_target.label": "Adaptive target",
  "adaptive_target.whatItIs": "Adaptive target asks the sampler to favour choices near a chosen probability, adapting that target as the answer continues.",
  "adaptive_target.whatItsFor": "It is intended to balance variety and predictability over time; negative values disable adaptive sampling.",
  // adaptive_decay
  "adaptive_decay.label": "Adaptive decay",
  "adaptive_decay.whatItIs": "Adaptive decay controls how much recent choices outweigh older choices when adaptive sampling updates its target.",
  "adaptive_decay.whatItsFor": "Higher values remember more history and change gently; lower values respond more quickly to the latest choices.",
  // seed
  "seed.label": "Random seed",
  "seed.whatItIs": "The random seed starts the choices used when more than one answer is possible.",
  "seed.whatItsFor": "A fixed seed can repeat a run with the same inputs; the random setting avoids making every run follow the same choices.",
  "seed.usualValues": "Random is usual; use a fixed integer when you need repeatable tests.",
  // max_tokens
  "max_tokens.label": "Maximum new tokens",
  "max_tokens.whatItIs": "This is the maximum amount of new text the assistant may produce for one message.",
  "max_tokens.whatItsFor": "A smaller limit ends long replies sooner; leaving it automatic lets the server's output length remain unlimited.",
  // Launch knobs.
  "ctx-size.label": "Context size",
  "ctx-size.whatItIs": "Context size is how much of the conversation the model can hold while answering.",
  "ctx-size.whatItsFor": "A larger context can keep more earlier conversation available but uses more memory; this app calculates the safe automatic value for the chosen model and computer.",
  "ctx-size.usualValues": "A chat-sized default is usual here — 64k where this computer funds it. The panel shows what the KV cache costs for the value chosen, and the machine's maximum is one click away.",
  "batch-size.label": "Batch size",
  "batch-size.whatItIs": "Batch size is how many prompt pieces the server groups into one logical processing job.",
  "batch-size.whatItsFor": "Larger batches can process the prompt faster but need more working memory; this setting affects start-up processing, not the assistant’s wording.",
  "batch-size.usualValues": "2048 here; the shipped run reached 1883 tokens/s versus 1151 at the old 512.",
  "ubatch-size.label": "Micro-batch size",
  "ubatch-size.whatItIs": "Micro-batch size is how many prompt pieces the server handles in one physical memory step.",
  "ubatch-size.whatItsFor": "Larger steps can improve prompt speed but use more compute-buffer memory; this computer’s measured budget limits the useful setting.",
  "ubatch-size.usualValues": "512 default; 1024 fits at 346.6–414.0 MiB at 16k; 2048 costs 602.7 MiB at 4096.",
  "cache-type-k/cache-type-v.label": "KV cache type",
  "cache-type-k/cache-type-v.whatItIs": "KV cache type chooses the precision used to remember earlier conversation inside the model.",
  "cache-type-k/cache-type-v.whatItsFor": "q8_0 uses less memory but can lose a little cache precision; f16 keeps more precision but costs twice per cache element and roughly halves this computer’s funded context.",
  "cache-type-k/cache-type-v.usualValues": "q8_0 is usual here; choose f16 when preserving cache precision matters more than context length.",
  "sleep-idle-seconds.label": "Unload after idle",
  "sleep-idle-seconds.whatItIs": "This is how long the unused model and its conversation cache stay loaded before the server releases them.",
  "sleep-idle-seconds.whatItsFor": "A shorter time frees memory sooner but reloads more often; a longer time keeps the next message ready but holds memory while idle. Either way the next message loads the model back.",
  "sleep-idle-seconds.usualValues": "5 minutes is the app default. The choices are 1 minute, 5 minutes and 1 hour.",
  "internet_road.label": "Internet road",
  "internet_road.whatItIs": "Internet road is this app’s optional iroh connection that gives the phone a second way to reach the computer.",
  "internet_road.whatItsFor": "Turn it on only when the phone cannot use the other road; it announces the computer on a public directory service, while the door still checks its password.",
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
