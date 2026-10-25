import type { ToolCall } from "./toolCalls";

/** Phrases that say the model cannot do the request, matched in the answer's
    first sentence. Each names the ability or the help that is missing: a bare
    "I can't" or "no puedo" also opens idioms and plain answers. */
const REFUSALS = [
  "i don't have the ability",
  "i don't have the capability",
  "i don't have a tool",
  "i can't help with",
  "i cannot help with",
  "i can't help you",
  "i cannot help you",
  "i can't assist",
  "i cannot assist",
  "i can't create",
  "i cannot create",
  "i can't write",
  "i cannot write",
  "i can't compose",
  "i cannot compose",
  "i can't send",
  "i cannot send",
  "isn't something i can do",
  "is not something i can do",
  "i'm not able to create",
  "i'm not able to write",
  "i'm not able to help",
  "i am not able to create",
  "i am not able to write",
  "i am not able to help",
  "i'm unable to create",
  "i'm unable to write",
  "i'm unable to help",
  "i am unable to create",
  "i am unable to write",
  "i am unable to help",
  "non posso scrivere",
  "non posso creare",
  "non posso comporre",
  "non posso aiutare",
  "non posso aiutarti",
  "non posso inviare",
  "non ho la capacità",
  "non ho uno strumento",
  "non sono in grado di scrivere",
  "non sono in grado di creare",
  "non sono in grado di aiutare",
  "no puedo escribir",
  "no puedo crear",
  "no puedo componer",
  "no puedo ayudar",
  "no puedo ayudarte",
  "no puedo enviar",
  "no tengo la capacidad",
  "no tengo una herramienta",
  "je ne peux pas écrire",
  "je ne peux pas créer",
  "je ne peux pas composer",
  "je ne peux pas aider",
  "je ne peux pas vous aider",
  "je ne peux pas t'aider",
  "je ne peux pas envoyer",
  "je n'ai pas la capacité",
  "je n'ai pas d'outil",
  "我无法写",
  "我无法创作",
  "我无法帮",
  "我无法提供",
  "我无法发送",
  "我不能写",
  "我不能创作",
  "我不能帮",
  "我不能提供",
  "我不能发送",
  "我没有能力",
  "我没有这个工具",
];

/** A refusal is short: past this, a reply is an answer whatever it says. */
const MAX_WORDS = 80;

const CJK = /[㐀-鿿豈-﫿]/g;

const SENTENCE_END = /[.!?。！？\n]/;

/** Whitespace words, with each CJK character counted as half a word. */
function wordCount(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const cjk = (text.match(CJK) ?? []).length;
  return words + Math.round(cjk / 2);
}

/** Whether the text has grown past the length a refusal can have. */
export function isLongerThanRefusal(text: string): boolean {
  return wordCount(text.trim()) > MAX_WORDS;
}

/** The first sentence, folded for matching, and whether its end has arrived. */
export function openingSentence(text: string): { sentence: string; complete: boolean } {
  const folded = text.trim().replace(/[‘’]/g, "'").toLowerCase();
  const end = folded.search(SENTENCE_END);
  return end === -1
    ? { sentence: folded, complete: false }
    : { sentence: folded.slice(0, end), complete: true };
}

/** Whether the first sentence says the model cannot do what was asked. */
export function opensWithRefusal(text: string): boolean {
  const { sentence } = openingSentence(text);
  return REFUSALS.some((phrase) => sentence.includes(phrase));
}

/** A reply that refuses while tools were in the request: no tool call, short,
    and a refusal phrase in its first sentence. */
export function isToolRefusal(text: string, toolCalls: readonly ToolCall[]): boolean {
  return toolCalls.length === 0 && text.trim() !== "" && !isLongerThanRefusal(text) && opensWithRefusal(text);
}
