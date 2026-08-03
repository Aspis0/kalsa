const CONTENT_FILTER_DECISIONS = Object.freeze({
  allow: "allow",
  block: "block",
  safetyBlock: "safety_block",
  warn: "warn",
});

const UNSAFE_BIO_PATTERNS = [
  /\bweaponi[sz]e\b/i,
  /\baerosoli[sz]e\s+anthrax\b/i,
  /\bincrease\s+virulence\b/i,
  // "gain of function" alone is a legitimate topic to ask about/explain
  // (education, awareness); only block when combined with a clear
  // operational/how-to intent.
  /\b(?:how\s+to\s+|help\s+me\s+|teach\s+me\s+(?:how\s+)?to\s+|show\s+me\s+how\s+to\s+|perform|conduct|carry\s+out)\b[^.?!]{0,30}\bgain[-\s]?of[-\s]?function\b/i,
  /\bmake\s+(?:a\s+)?pathogen\s+more\s+(?:virulent|infectious|deadly)\b/i,
  /\b(?:anthrax|ebola|smallpox|botulinum|ricin)\b.*\b(?:weapon|virulence|aerosoli[sz]e|disseminat)/i,
];

const UNSAFE_CHEM_PATTERNS = [
  /\b(?:synthesi[sz]e|make|extract)\s+(?:sarin|ricin|mustard\s+gas)\b/i,
  /\b(?:sarin|mustard\s+gas)\b/i,
];

const CHILD_EXPLOITATION_PATTERNS = [
  /\bchild\s+porn\b/i,
  /\bchild\s+sexual\s+abuse\s+material\b/i,
  // Bare "csam" alone covers awareness/definition questions ("what is CSAM
  // and how is it detected?"); only block when paired with creation/access
  // intent. Overt requests are still caught by the other patterns below.
  /\b(?:generate|create|make|produce|find|download|access|get|share|distribute|watch|view)\b[^.?!]{0,30}\bcsam\b/i,
  /\bcsam\b[^.?!]{0,30}\b(?:generate|create|make|produce|find|download|access|get|share|distribute|watch|view)\b/i,
  /\bminor\s+nude\b/i,
  /\bunderage\s+sex\b/i,
  /\bsexual\s+exploitation\s+of\s+children\b/i,
  /\bsexual\s+images?\s+of\s+minors?\b/i,
  /\bnude\s+(?:pictures?|images?|photos?)\s+of\s+children\b/i,
  /\bteen\s+sex\s+with\s+a\s+minor\b/i,
  /\blolicon\s+porn\b/i,
  /\bgenerate\s+underage\s+nude\s+image\b/i,
  /\bpedopornografia\b/i,
  /\bmateriale\s+pedopornografico\b/i,
  /\bsfruttamento\s+(?:sessuale\s+)?(?:dei\s+)?minori\b/i,
];

const SEX_CRIME_PATTERNS = [
  /\bnon[-\s]?consensual\b/i,
  /\bdrug\s+someone\b/i,
  /\bdrug\s+a\s+person\s+for\s+sex\b/i,
  /\bspike\s+(?:a\s+)?drink\b/i,
  /\bhow\s+to\s+rape\s+someone\b/i,
  /\bhow\s+to\s+get\s+away\s+with\s+rape\b/i,
  /\bcoerce\s+someone\s+into\s+sex\b/i,
  /\bforce\s+someone\s+sexually\b/i,
  /\bremove\s+consent\s+from\s+this\s+sex\s+scene\b/i,
  /\bviolentare\s+qualcuno\b/i,
  /\bstuprare\s+qualcuno\b/i,
  /\bdrogare\s+qualcuno\b/i,
];

const SELF_HARM_PATTERNS = [
  /\bkill\s+myself\b/i,
  /\bself[-\s]?harm\b/i,
  /\bcut\s+myself\b/i,
  /\boverdose\s+myself\b/i,
  /\bhow\s+to\s+commit\s+suicide\b/i,
  /\bbest\s+way\s+to\s+die\s+by\s+suicide\b/i,
  /\bhow\s+many\s+pills\s+to\s+overdose\b/i,
  /\bways\s+to\s+cut\s+myself\b/i,
  /\bi\s+want\s+to\s+end\s+my\s+life\b/i,
  /\bhelp\s+me\s+harm\s+myself\b/i,
  // Italian.
  /\bfarla\s+finita\b/i,
  /\bammazzarmi\b/i,
  /\bsuicidarmi\b/i,
  /\btogliermi\s+la\s+vita\b/i,
  /\bnon\s+voglio\s+piu\s+vivere\b/i,
];

const VIOLENT_CRIME_PATTERNS = [
  // Require a harm-shaped object: excludes "how to kill a background
  // process/task/daemon" (dev question) while still catching "how to kill
  // someone/a person/him/her/etc.".
  /\bhow\s+to\s+kill\s+(?!(?:a\s+|an\s+|the\s+|my\s+)?(?:background\s+)?(?:process|task|daemon|thread|program|application|app|job|service)\b)/i,
  /\bhide\s+a\s+body\b/i,
  /\bmake\s+a\s+bomb\b/i,
  /\bstab\s+someone\b/i,
  /\bpoison\s+someone\b/i,
  // Italian.
  /\bcome\s+uccidere\s+(?!(?:un\s+)?(?:processo|programma|servizio|applicazione)\b)/i,
  /\bnascondere\s+un\s+cadavere\b/i,
  /\bcome\s+fare\s+una\s+bomba\b/i,
];

// A "victim" marker distinguishes exfiltration intent ("extract the user's
// password") from generic dev/UI questions ("extract access token from url",
// "show password checkbox in html") which must not be blocked.
const PRIVACY_VICTIM_MARKER =
  "(?:someone|somebody|another\\s+person|other\\s+people|a\\s+user|the\\s+user|other\\s+users|an?\\s+admin|the\\s+admin|a\\s+customer|the\\s+customer|a\\s+patient|the\\s+patient|a\\s+victim|their|his|her|the\\s+database|the\\s+server|the\\s+system|a\\s+company|an?\\s+employee)";

const PRIVACY_EXFILTRATION_PATTERNS = [
  new RegExp(
    `(?=.*\\b${PRIVACY_VICTIM_MARKER}\\b).*\\b(?:reveal|extract|dump|show|steal|leak)\\b.*\\b(?:api\\s+key|access\\s+token|password|private\\s+key|secret\\s+key|patient\\s+name|patient\\s+email|social\\s+security\\s+number)\\b`,
    "i",
  ),
  new RegExp(
    `(?=.*\\b${PRIVACY_VICTIM_MARKER}\\b).*\\b(?:api\\s+key|access\\s+token|password|private\\s+key|secret\\s+key|patient\\s+name|patient\\s+email|social\\s+security\\s+number)\\b.*\\b(?:reveal|extract|dump|show|steal|leak)\\b`,
    "i",
  ),
];

const NON_VIOLENT_CRIME_PATTERNS = [
  /\bsteal\s+credit\s+card\b/i,
  /\bfake\s+passport\b/i,
  /\bforge\s+signature\b/i,
  // "bypass paywall" / "phishing email" alone are pass-through (questions
  // about legality, spotting phishing, etc.) — only block with clear
  // perpetration intent.
  /\b(?:how\s+to\s+bypass|help\s+me\s+bypass|show\s+me\s+how\s+to\s+bypass|write\s+(?:me\s+)?(?:a\s+)?(?:script|code)\s+to\s+bypass)\s+(?:a\s+|the\s+|this\s+)?paywall\b/i,
  /\b(?:create|write|craft|build|design|generate|make|send|set\s+up)\s+(?:a\s+|an\s+)?phishing\b/i,
  /\bhelp\s+me\s+phish\b/i,
  /\bphish\s+someone\b/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+previous\s+instructions\b/i,
  /\bignore\s+system\s+prompt\b/i,
  /\breveal\s+system\s+prompt\b/i,
  /\bdeveloper\s+message\b/i,
  // Bare "jailbreak" also matches unrelated topics (phone jailbreaking);
  // only block when it targets the model/assistant itself.
  /\bjailbreak\s+(?:this\s+|the\s+|your\s+)?(?:model|ai|assistant|chatbot|gpt|bot|system|you)\b/i,
  /\bhelp\s+me\s+jailbreak\b/i,
  /\bhow\s+to\s+jailbreak\s+(?:this|you|the\s+model|the\s+ai|chatgpt|an?\s+ai)\b/i,
  /\bbypass\s+safety\b/i,
  /\bact\s+as\s+dan\b/i,
];

const ABUSE_PATTERNS = [
  /\bfuck(?:ing|er)?\b.*\b(?:idiot|moron|stupid|dumb)\b/i,
  /\b(?:idiot|moron|stupid|dumb)\b.*\bfuck(?:ing|er)?\b/i,
  /\bcoglione\b/i,
  /\bcabron\b/i,
  /\barschloch\b/i,
  /\bsalope\b/i,
];

const MILD_PROFANITY_PATTERNS = [
  /\bdamn\b/i,
  /\bfuck(?:ing)?\b/i,
  /\bshit\b/i,
  /\bhell\b/i,
  /\bcrap\b/i,
  /\bmerda\b/i,
];

const EXPLICIT_SEXUAL_PATTERNS = [
  /\b(?:porn|pornographic|erotic)\b/i,
  /\b(?:dirty|erotic|porn|pornographic|sexual)\s+(?:fantasy|story|roleplay|scene)\b/i,
  /\bexplicit\s+(?:nude|sexual|sex)\b/i,
  /\bnude\s+(?:details|photos?|images?|body)\b/i,
  /\b(?:blowjob|handjob|cum|orgasm|masturbat(?:e|ion)|fuck\s+me)\b/i,
];

function classifyChatContent(input) {
  const text = normalizeFilterText(input);
  const categories = [];

  if (!text) {
    return buildDecision(CONTENT_FILTER_DECISIONS.allow, null, categories, true);
  }

  if (matchesAny(CHILD_EXPLOITATION_PATTERNS, text)) {
    categories.push("child_exploitation");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "child_exploitation", categories, false);
  }

  if (matchesAny(SEX_CRIME_PATTERNS, text)) {
    categories.push("sex_crimes");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "sex_crimes", categories, false);
  }

  if (matchesAny(SELF_HARM_PATTERNS, text)) {
    categories.push("self_harm");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "self_harm", categories, false);
  }

  if (matchesAny(UNSAFE_BIO_PATTERNS, text)) {
    categories.push("unsafe_bio");
    return buildDecision(CONTENT_FILTER_DECISIONS.safetyBlock, "unsafe_bio", categories, false);
  }

  if (matchesAny(UNSAFE_CHEM_PATTERNS, text)) {
    categories.push("unsafe_chem");
    return buildDecision(CONTENT_FILTER_DECISIONS.safetyBlock, "unsafe_chem", categories, false);
  }

  if (matchesAny(VIOLENT_CRIME_PATTERNS, text)) {
    categories.push("violent_crime");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "violent_crime", categories, false);
  }

  if (matchesAny(PRIVACY_EXFILTRATION_PATTERNS, text)) {
    categories.push("privacy");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "privacy", categories, false);
  }

  if (matchesAny(NON_VIOLENT_CRIME_PATTERNS, text)) {
    categories.push("non_violent_crime");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "non_violent_crime", categories, false);
  }

  if (matchesAny(PROMPT_INJECTION_PATTERNS, text)) {
    categories.push("prompt_injection");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "prompt_injection", categories, false);
  }

  if (matchesAny(EXPLICIT_SEXUAL_PATTERNS, text)) {
    categories.push("sexual_explicit");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "sexual_explicit", categories, false);
  }

  if (matchesAny(ABUSE_PATTERNS, text)) {
    categories.push("abuse");
    return buildDecision(CONTENT_FILTER_DECISIONS.block, "abuse", categories, false);
  }

  if (matchesAny(MILD_PROFANITY_PATTERNS, text)) {
    categories.push("mild_profanity");
    return buildDecision(CONTENT_FILTER_DECISIONS.warn, "mild_profanity", categories, true);
  }

  return buildDecision(CONTENT_FILTER_DECISIONS.allow, null, categories, true);
}

function formatChatContentFilterMessage(result = {}) {
  const reason = typeof result === "string" ? result : result.reason;
  if (reason === "self_harm") {
    return "I can't help with self-harm instructions. If this is urgent, contact local emergency services or a crisis support line now.";
  }
  if (reason === "child_exploitation" || reason === "sex_crimes") {
    return "I can't help with sexual abuse or exploitation content.";
  }
  if (reason === "unsafe_bio" || reason === "unsafe_chem") {
    return "I can't help with unsafe biological or chemical instructions.";
  }
  if (reason === "privacy") {
    return "I can't help extract or expose secrets, credentials, or personal data.";
  }
  if (reason === "prompt_injection") {
    return "I can't help bypass app, model, or safety instructions.";
  }
  if (reason === "non_violent_crime" || reason === "violent_crime") {
    return "I can't help with instructions for illegal or harmful activity.";
  }
  return "I can't help with that. Please keep the chat focused on safe, everyday topics.";
}

function normalizeFilterText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function buildDecision(decision, reason, categories, shouldCallProvider) {
  return Object.freeze({
    categories: Object.freeze([...categories]),
    decision,
    reason,
    shouldCallProvider,
  });
}

module.exports = {
  CONTENT_FILTER_DECISIONS,
  classifyChatContent,
  formatChatContentFilterMessage,
};
