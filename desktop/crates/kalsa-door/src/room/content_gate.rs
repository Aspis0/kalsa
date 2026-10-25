//! The Room's pre-send content gate: the phone's classifier, run on the words
//! of a call before the model is asked. A blocked call is answered with its
//! decline, and the engine is never called.

use std::sync::OnceLock;

use regex::{Regex, RegexBuilder};
use unicode_normalization::UnicodeNormalization;

const SELF_HARM: &str = "I can't help with self-harm instructions. If this is urgent, contact local emergency services or a crisis support line now.";
const SEXUAL_ABUSE: &str = "I can't help with sexual abuse or exploitation content.";
const UNSAFE_SCIENCE: &str = "I can't help with unsafe biological or chemical instructions.";
const PRIVACY: &str = "I can't help extract or expose secrets, credentials, or personal data.";
const PROMPT_INJECTION: &str = "I can't help bypass app, model, or safety instructions.";
const ILLEGAL_ACTIVITY: &str = "I can't help with instructions for illegal or harmful activity.";
const GENERIC: &str =
    "I can't help with that. Please keep the chat focused on safe, everyday topics.";

/// The decline a blocked call gets, or `None` when the model may answer.
/// Mild profanity is a warning, not a block, so it answers as a clean call.
pub(crate) fn decline_for(words: &str) -> Option<&'static str> {
    let text = normalize(words);
    if text.is_empty() {
        return None;
    }
    let p = patterns();
    if any(&p.child_exploitation, &text) || any(&p.sex_crimes, &text) {
        return Some(SEXUAL_ABUSE);
    }
    if any(&p.self_harm, &text) {
        return Some(SELF_HARM);
    }
    if any(&p.unsafe_science, &text) {
        return Some(UNSAFE_SCIENCE);
    }
    if any(&p.violent, &text) || p.unless.iter().any(|rule| rule.blocks(&text)) {
        return Some(ILLEGAL_ACTIVITY);
    }
    if p.privacy_victim.is_match(&text)
        && (p.privacy_verb_object.is_match(&text) || p.privacy_object_verb.is_match(&text))
    {
        return Some(PRIVACY);
    }
    if any(&p.non_violent_crime, &text) {
        return Some(ILLEGAL_ACTIVITY);
    }
    if any(&p.prompt_injection, &text) {
        return Some(PROMPT_INJECTION);
    }
    if any(&p.explicit_sexual, &text) || any(&p.abuse, &text) {
        return Some(GENERIC);
    }
    None
}

/// The phone's normalizer: accents folded, anything but letters, digits,
/// spaces, apostrophes and hyphens turned into a space, runs collapsed.
fn normalize(input: &str) -> String {
    let p = patterns();
    let folded: String = input
        .nfkd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect();
    let cleaned = p.junk.replace_all(&folded, " ");
    p.spaces.replace_all(&cleaned, " ").trim().to_lowercase()
}

fn any(patterns: &[Regex], text: &str) -> bool {
    patterns.iter().any(|pattern| pattern.is_match(text))
}

/// A harm phrase that stops being harm when its object is one the exemption
/// names. Rust's regex has no negative lookahead, so the rule is searched as
/// a lead whose tail does not start with the exemption.
struct Unless {
    lead: Regex,
    exempt: Regex,
}

impl Unless {
    fn blocks(&self, text: &str) -> bool {
        self.lead
            .find_iter(text)
            .any(|lead| !self.exempt.is_match(&text[lead.end()..]))
    }
}

struct Patterns {
    child_exploitation: Vec<Regex>,
    sex_crimes: Vec<Regex>,
    self_harm: Vec<Regex>,
    unsafe_science: Vec<Regex>,
    violent: Vec<Regex>,
    unless: Vec<Unless>,
    privacy_victim: Regex,
    privacy_verb_object: Regex,
    privacy_object_verb: Regex,
    non_violent_crime: Vec<Regex>,
    prompt_injection: Vec<Regex>,
    explicit_sexual: Vec<Regex>,
    abuse: Vec<Regex>,
    junk: Regex,
    spaces: Regex,
}

fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(Patterns::build)
}

impl Patterns {
    fn build() -> Self {
        const VICTIM: &str = r"(?:someone|somebody|another\s+person|other\s+people|a\s+user|the\s+user|other\s+users|an?\s+admin|the\s+admin|a\s+customer|the\s+customer|a\s+patient|the\s+patient|a\s+victim|their|his|her|the\s+database|the\s+server|the\s+system|a\s+company|an?\s+employee)";
        const VERBS: &str = r"(?:reveal|extract|dump|show|steal|leak)";
        const OBJECTS: &str = r"(?:api\s+key|access\s+token|password|private\s+key|secret\s+key|patient\s+name|patient\s+email|social\s+security\s+number)";
        Self {
            child_exploitation: compile_all(&[
                r"\bchild\s+porn\b",
                r"\bchild\s+sexual\s+abuse\s+material\b",
                r"\b(?:generate|create|make|produce|find|download|access|get|share|distribute|watch|view)\b[^.?!]{0,30}\bcsam\b",
                r"\bcsam\b[^.?!]{0,30}\b(?:generate|create|make|produce|find|download|access|get|share|distribute|watch|view)\b",
                r"\bminor\s+nude\b",
                r"\bunderage\s+sex\b",
                r"\bsexual\s+exploitation\s+of\s+children\b",
                r"\bsexual\s+images?\s+of\s+minors?\b",
                r"\bnude\s+(?:pictures?|images?|photos?)\s+of\s+children\b",
                r"\bteen\s+sex\s+with\s+a\s+minor\b",
                r"\blolicon\s+porn\b",
                r"\bgenerate\s+underage\s+nude\s+image\b",
                r"\bpedopornografia\b",
                r"\bmateriale\s+pedopornografico\b",
                r"\bsfruttamento\s+(?:sessuale\s+)?(?:dei\s+)?minori\b",
            ]),
            sex_crimes: compile_all(&[
                r"\bnon[-\s]?consensual\b",
                r"\bdrug\s+someone\b",
                r"\bdrug\s+a\s+person\s+for\s+sex\b",
                r"\bspike\s+(?:a\s+)?drink\b",
                r"\bhow\s+to\s+rape\s+someone\b",
                r"\bhow\s+to\s+get\s+away\s+with\s+rape\b",
                r"\bcoerce\s+someone\s+into\s+sex\b",
                r"\bforce\s+someone\s+sexually\b",
                r"\bremove\s+consent\s+from\s+this\s+sex\s+scene\b",
                r"\bviolentare\s+qualcuno\b",
                r"\bstuprare\s+qualcuno\b",
                r"\bdrogare\s+qualcuno\b",
            ]),
            self_harm: compile_all(&[
                r"\bkill\s+myself\b",
                r"\bself[-\s]?harm\b",
                r"\bcut\s+myself\b",
                r"\boverdose\s+myself\b",
                r"\bhow\s+to\s+commit\s+suicide\b",
                r"\bbest\s+way\s+to\s+die\s+by\s+suicide\b",
                r"\bhow\s+many\s+pills\s+to\s+overdose\b",
                r"\bways\s+to\s+cut\s+myself\b",
                r"\bi\s+want\s+to\s+end\s+my\s+life\b",
                r"\bhelp\s+me\s+harm\s+myself\b",
                r"\bfarla\s+finita\b",
                r"\bammazzarmi\b",
                r"\bsuicidarmi\b",
                r"\btogliermi\s+la\s+vita\b",
                r"\bnon\s+voglio\s+piu\s+vivere\b",
            ]),
            unsafe_science: compile_all(&[
                r"\bweaponi[sz]e\b",
                r"\baerosoli[sz]e\s+anthrax\b",
                r"\bincrease\s+virulence\b",
                // "gain of function" alone is a legitimate topic to ask about;
                // only a clear operational or how-to intent is blocked.
                r"\b(?:how\s+to\s+|help\s+me\s+|teach\s+me\s+(?:how\s+)?to\s+|show\s+me\s+how\s+to\s+|perform|conduct|carry\s+out)\b[^.?!]{0,30}\bgain[-\s]?of[-\s]?function\b",
                r"\bmake\s+(?:a\s+)?pathogen\s+more\s+(?:virulent|infectious|deadly)\b",
                r"\b(?:anthrax|ebola|smallpox|botulinum|ricin)\b.*\b(?:weapon|virulence|aerosoli[sz]e|disseminat)",
                r"\b(?:synthesi[sz]e|make|extract)\s+(?:sarin|ricin|mustard\s+gas)\b",
                r"\b(?:sarin|mustard\s+gas)\b",
            ]),
            violent: compile_all(&[
                r"\bhide\s+a\s+body\b",
                r"\bmake\s+a\s+bomb\b",
                r"\bstab\s+someone\b",
                r"\bpoison\s+someone\b",
                r"\bnascondere\s+un\s+cadavere\b",
                r"\bcome\s+fare\s+una\s+bomba\b",
            ]),
            // Require a harm-shaped object: "how to kill a background
            // process" is a dev question, "how to kill someone" is not.
            unless: vec![
                Unless {
                    lead: compile(r"\bhow\s+to\s+kill\s+"),
                    exempt: compile(
                        r"^(?:a\s+|an\s+|the\s+|my\s+)?(?:background\s+)?(?:process|task|daemon|thread|program|application|app|job|service)\b",
                    ),
                },
                Unless {
                    lead: compile(r"\bcome\s+uccidere\s+"),
                    exempt: compile(r"^(?:un\s+)?(?:processo|programma|servizio|applicazione)\b"),
                },
            ],
            // A victim marker separates exfiltration ("extract the user's
            // password") from dev questions ("extract access token from url").
            privacy_victim: compile(&format!(r"\b{VICTIM}\b")),
            privacy_verb_object: compile(&format!(r"\b{VERBS}\b.*\b{OBJECTS}\b")),
            privacy_object_verb: compile(&format!(r"\b{OBJECTS}\b.*\b{VERBS}\b")),
            non_violent_crime: compile_all(&[
                r"\bsteal\s+credit\s+card\b",
                r"\bfake\s+passport\b",
                r"\bforge\s+signature\b",
                r"\b(?:how\s+to\s+bypass|help\s+me\s+bypass|show\s+me\s+how\s+to\s+bypass|write\s+(?:me\s+)?(?:a\s+)?(?:script|code)\s+to\s+bypass)\s+(?:a\s+|the\s+|this\s+)?paywall\b",
                r"\b(?:create|write|craft|build|design|generate|make|send|set\s+up)\s+(?:a\s+|an\s+)?phishing\b",
                r"\bhelp\s+me\s+phish\b",
                r"\bphish\s+someone\b",
            ]),
            prompt_injection: compile_all(&[
                r"\bignore\s+previous\s+instructions\b",
                r"\bignore\s+system\s+prompt\b",
                r"\breveal\s+system\s+prompt\b",
                r"\bdeveloper\s+message\b",
                r"\bjailbreak\s+(?:this\s+|the\s+|your\s+)?(?:model|ai|assistant|chatbot|gpt|bot|system|you)\b",
                r"\bhelp\s+me\s+jailbreak\b",
                r"\bhow\s+to\s+jailbreak\s+(?:this|you|the\s+model|the\s+ai|chatgpt|an?\s+ai)\b",
                r"\bbypass\s+safety\b",
                r"\bact\s+as\s+dan\b",
            ]),
            explicit_sexual: compile_all(&[
                r"\b(?:porn|pornographic|erotic)\b",
                r"\b(?:dirty|erotic|porn|pornographic|sexual)\s+(?:fantasy|story|roleplay|scene)\b",
                r"\bexplicit\s+(?:nude|sexual|sex)\b",
                r"\bnude\s+(?:details|photos?|images?|body)\b",
                r"\b(?:blowjob|handjob|cum|orgasm|masturbat(?:e|ion)|fuck\s+me)\b",
            ]),
            abuse: compile_all(&[
                r"\bfuck(?:ing|er)?\b.*\b(?:idiot|moron|stupid|dumb)\b",
                r"\b(?:idiot|moron|stupid|dumb)\b.*\bfuck(?:ing|er)?\b",
                r"\bcoglione\b",
                r"\bcabron\b",
                r"\barschloch\b",
                r"\bsalope\b",
            ]),
            junk: Regex::new(r"[^\p{L}\p{N}\s'-]").expect("the normalizer compiles"),
            spaces: Regex::new(r"\s+").expect("the normalizer compiles"),
        }
    }
}

/// The phone's patterns are JavaScript: their `\b` is ASCII-only, while Rust's
/// is Unicode, so the boundary is pinned to ASCII to decide the same words.
fn compile(pattern: &str) -> Regex {
    RegexBuilder::new(&pattern.replace(r"\b", r"(?-u:\b)"))
        .case_insensitive(true)
        .build()
        .expect("the gate's patterns compile")
}

fn compile_all(patterns: &[&str]) -> Vec<Regex> {
    patterns.iter().map(|pattern| compile(pattern)).collect()
}
