// Refusal detector (pure function, no I/O).
// refusal = NO tool call AND <= 80 words AND contains a "cannot do it" marker.
// Curly apostrophes (’ ‘) are folded to ' before matching; matching is case-insensitive.

export const MAX_WORDS = 80;

export const MARKERS = [
  // English
  "i'm sorry, but",
  "i can't help",
  "i cannot",
  "i can't",
  "i don't have the ability",
  "i don't have the capability",
  "isn't supported",
  "not able to",
  // Italian
  "mi dispiace",
  "non posso",
  "non ho la capacità",
  "non sono in grado",
  // Spanish
  "lo siento",
  "no puedo",
  "no tengo la capacidad",
  // French
  "je suis désolé",
  "je ne peux pas",
  "je n'ai pas la capacité",
  // Chinese
  "抱歉",
  "我无法",
  "我不能",
];

const fold = (s) => s.replace(/[‘’]/g, "'").toLowerCase();
const CJK = /[㐀-鿿豈-﫿]/g;

/** Words in a reply: whitespace tokens, with CJK characters counted as half a word each. */
export function wordCount(text) {
  const tokens = text.split(/\s+/).filter(Boolean).length;
  const cjk = (text.match(CJK) || []).length;
  return tokens + Math.round(cjk / 2);
}

/** The first marker the reply contains, or null. */
export function markerHit(text) {
  const t = fold(text);
  return MARKERS.find((m) => t.includes(m)) ?? null;
}

/** True when an assistant message (choices[0].message) is a refusal by this rule. */
export function isRefusal(message) {
  if (!message) return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;
  const text = (message.content ?? "").trim();
  if (text === "") return false;
  if (wordCount(text) > MAX_WORDS) return false;
  return markerHit(text) !== null;
}
