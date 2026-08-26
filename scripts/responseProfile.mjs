/**
 * Deterministic response-profile metrics on an assistant reply.
 * Marker rates are per 100 tokens. Numeric claims = numeral tokens absent
 * from the conversation's own prior text (not world-knowledge).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IT_FN = /\b(che|non|per|una|con|sono|come|questo|della|anche)\b/gi;
const EN_FN = /\b(the|is|you|and|what|this|that|with|from|have)\b/gi;
const FR_FN = /\b(je|vous|est|une|les|comment|pas|pour|dans|avec)\b/gi;
const USER_2P = /\b(tu|te|ti|tuo|tua|tuoi|tue|lei|l'utente|il tuo|la tua)\b/gi;
const CITE = /[«""].{2,80}[»""]|hai detto|mi hai detto|secondo quanto|nel contesto/i;
const QBACK = /[?？]/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/m;
const HEADING = /^\s*#{1,3}\s+\S+/m;
const NUM = /\d+(?:[.,]\d+)?/g;
const FP_USER = /\b(io|mi chiamo|il mio|la mia|sono Elisabetta)\b/gi;

export function tokenize(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function sentenceCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/[.!?…]+/).filter((s) => s.trim()).length || 1;
}

export function syllableCount(text) {
  const m = String(text || "").toLowerCase().match(/[aeiouàèéìíòóùúy]+/g);
  return m ? m.length : 0;
}

export function countMarkers(text, list) {
  const lower = String(text || "").toLowerCase();
  let n = 0;
  for (const m of list || []) {
    const needle = m.toLowerCase();
    let from = 0;
    while (needle && lower.indexOf(needle, from) !== -1) {
      n += 1;
      from = lower.indexOf(needle, from) + needle.length;
    }
  }
  return n;
}

export function echoHits(text, tokens) {
  const hay = String(text || "");
  const hits = [];
  for (const tok of tokens || []) {
    if (tok && hay.includes(tok)) hits.push(tok);
  }
  return hits;
}

export function detectLang(text) {
  const s = String(text || "");
  const it = (s.match(IT_FN) || []).length;
  const en = (s.match(EN_FN) || []).length;
  const fr = (s.match(FR_FN) || []).length;
  if (en > it && en > fr && en >= 2) return "en";
  if (fr > it && fr > en && fr >= 2) return "fr";
  if (it === 0 && en === 0 && fr === 0) return "und";
  return "it";
}

export function numericAbsentFromPrior(reply, priorText) {
  const prior = String(priorText || "");
  const found = String(reply || "").match(NUM) || [];
  return found.filter((n) => !prior.includes(n));
}

function per100(count, tokens) {
  return tokens > 0 ? (100 * count) / tokens : 0;
}

export function extractProfile(reply, opts = {}) {
  const text = String(reply || "");
  const tokens = tokenize(text);
  const nTok = tokens.length;
  const lexicon = opts.lexicon || { hedge: [], refusal: [], apology: [] };
  const planted = opts.plantedTokens || [];
  const userText = opts.userText || "";
  const prior = opts.priorText || "";
  const promptLang = opts.promptLang || detectLang(userText);
  const replyLang = detectLang(text);
  const hedge = countMarkers(text, lexicon.hedge);
  const refusal = countMarkers(text, lexicon.refusal);
  const apology = countMarkers(text, lexicon.apology);
  const echo = echoHits(text, planted);
  const numeric = numericAbsentFromPrior(text, `${prior}\n${userText}`);
  const empty = nTok === 0;
  return {
    tokenCount: nTok,
    sentenceCount: sentenceCount(text),
    syllableCount: syllableCount(text),
    hedgeCount: hedge,
    hedgePer100: per100(hedge, nTok),
    refusalCount: refusal,
    refusalPer100: per100(refusal, nTok),
    apologyCount: apology,
    apologyPer100: per100(apology, nTok),
    echoTokens: echo,
    echoRate: planted.length ? echo.length / planted.length : 0,
    firstPersonUserRefs: (text.match(USER_2P) || []).length + (text.match(FP_USER) || []).length,
    promptLang,
    replyLang,
    languageDrift: replyLang !== "und" && promptLang !== "und" && replyLang !== promptLang,
    empty,
    bullets: BULLET.test(text),
    headings: HEADING.test(text),
    numericAbsentFromContext: numeric,
    numericClaimCount: numeric.length,
    lengthRatio: tokenize(userText).length ? nTok / tokenize(userText).length : 0,
    citationOfContext: CITE.test(text) || echo.length > 0,
    questionAskingBack: QBACK.test(text),
  };
}

export function profileJsonl(file, opts = {}) {
  const lines = readFileSync(file, "utf8").split(/\n/).filter((l) => l.trim());
  const turns = lines.map((l) => JSON.parse(l));
  let prior = "";
  const perTurn = [];
  for (const rec of turns) {
    const user = rec.user || rec.transcript?.user || "";
    const asst = rec.assistant || rec.transcript?.assistant || "";
    const planted = rec.planted || rec.script?.planted || opts.plantedTokens || [];
    const prof = extractProfile(asst, {
      lexicon: opts.lexicon,
      plantedTokens: planted,
      userText: user,
      priorText: prior,
      promptLang: rec.promptLang || rec.script?.lang || detectLang(user),
    });
    perTurn.push({ i: rec.i ?? rec.turn, tokenCount: prof.tokenCount, profile: prof });
    prior += `\n${user}\n${asst}`;
  }
  return {
    source: file,
    turns: perTurn,
    lengthByTurn: perTurn.map((t) => t.tokenCount),
  };
}

function selftest() {
  const lex = {
    hedge: ["potrebbe", "non sono sicuro", "credo", "forse"],
    refusal: ["non posso"],
    apology: ["mi dispiace"],
  };
  const hedge = extractProfile("Forse potrebbe funzionare, credo.", { lexicon: lex });
  if (hedge.hedgeCount < 3) throw new Error(`hedge ${hedge.hedgeCount}`);
  if (hedge.hedgePer100 <= 0) throw new Error("hedge per100");
  const echo = extractProfile("Elisabetta Quirino beve caffè d'orzo.", {
    plantedTokens: ["Elisabetta Quirino", "caffè d'orzo"],
  });
  if (echo.echoTokens.length !== 2) throw new Error(`echo ${echo.echoTokens}`);
  const en = extractProfile("This is the job you have and what that means from the start.", {
    userText: "What is my job, in one sentence? Answer in the language of this question.",
  });
  if (en.replyLang !== "en" || en.promptLang !== "en" || en.languageDrift) {
    throw new Error(`en drift ${en.replyLang}/${en.promptLang}/${en.languageDrift}`);
  }
  const drift = extractProfile("This is the job you have and what that means from the start.", {
    userText: "Qual è il mio lavoro, una frase?",
  });
  if (!drift.languageDrift) throw new Error("expected EN vs IT drift");
  const num = extractProfile("Il prezzo è 999 euro e 3.14.", {
    priorText: "parliamo di restauro",
    userText: "quanto costa?",
  });
  if (!num.numericAbsentFromContext.includes("999")) throw new Error(`numeric ${num.numericAbsentFromContext}`);
  const present = extractProfile("Zaffiro-17 resta 17.", { priorText: "codice Zaffiro-17", userText: "ripeti 17" });
  if (present.numericAbsentFromContext.includes("17")) throw new Error("17 is in prior");
  const rates = extractProfile("forse forse forse", { lexicon: lex });
  if (Math.abs(rates.hedgePer100 - 100) > 1e-9) throw new Error(`rate ${rates.hedgePer100}`);
  console.log("responseProfile selftest ok");
}

function parseCli(args) {
  const out = { lexicon: null, file: null, selftest: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--selftest") out.selftest = true;
    else if (args[i] === "--lexicon") out.lexicon = args[++i];
    else if (!args[i].startsWith("-")) out.file = args[i];
  }
  return out;
}

function main(argv) {
  const opts = parseCli(argv.slice(2));
  if (argv.length <= 2 || opts.selftest) {
    selftest();
    if (!opts.file) return;
  }
  if (!opts.file || !existsSync(opts.file)) throw new Error(`missing jsonl ${opts.file || ""}`);
  let lexicon;
  if (opts.lexicon) {
    if (!existsSync(opts.lexicon)) throw new Error(`missing lexicon ${opts.lexicon}`);
    lexicon = JSON.parse(readFileSync(opts.lexicon, "utf8"));
  }
  const out = profileJsonl(opts.file, { lexicon });
  const dest = opts.file.replace(/\.jsonl$/i, "") + ".profile.json";
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(dest);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main(process.argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
