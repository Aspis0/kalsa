/**
 * Named token formats, ported from gitleaks' rule set (config/gitleaks.toml,
 * MIT, https://github.com/gitleaks/gitleaks), thinned to the twenty a private
 * document is most likely to carry: cloud, code hosting, chat, payment and AI
 * keys, plus the PEM header and the JWT shape. Each pattern is gitleaks'
 * own; the trailing boundary gitleaks tests with `[\x60'"\s;]|$` is widened
 * here to a lookahead that also admits the `&`, `)` and angle brackets a
 * query or URL gathers around a value.
 * Entropy is deliberately not per-rule here, the way gitleaks scores its
 * secret groups: the rules below are specific enough to stand alone, and the
 * unnamed-secret catch-all lives in `sensitive.ts` where the runs are found.
 */

export interface SecretRule {
  /** Readable name for the dialog: what the owner is being warned about. */
  kind: string;
  pattern: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  { kind: "AWS access key", pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g },
  { kind: "GitHub personal access token", pattern: /ghp_[0-9a-zA-Z]{36}(?=$|[\s"'`,;)&<>])/g },
  { kind: "GitHub fine-grained personal access token", pattern: /github_pat_\w{82}(?=$|[\s"'`,;)&<>])/g },
  { kind: "GitHub OAuth token", pattern: /gho_[0-9a-zA-Z]{36}(?=$|[\s"'`,;)&<>])/g },
  { kind: "GitHub app token", pattern: /(?:ghu|ghs)_[0-9a-zA-Z]{36}(?=$|[\s"'`,;)&<>])/g },
  { kind: "GitHub refresh token", pattern: /ghr_[0-9a-zA-Z]{36}(?=$|[\s"'`,;)&<>])/g },
  { kind: "Slack bot token", pattern: /xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g },
  { kind: "Slack token", pattern: /xox[ar]-(?:\d-)?[0-9a-zA-Z]{8,48}/g },
  { kind: "Slack webhook URL", pattern: /(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{43,56}/g },
  { kind: "Stripe secret key", pattern: /\b(?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99}(?=$|[\s"'`,;)&<>])/g },
  { kind: "Google API key", pattern: /\bAIza\w{35}(?=$|[\s"'`,;)&<>])/g },
  { kind: "OpenAI API key", pattern: /\b(?:sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?=$|[\s"'`,;)&<>])/g },
  { kind: "Anthropic API key", pattern: /\bsk-ant-api03-[a-zA-Z0-9_-]{93}AA(?=$|[\s"'`,;)&<>])/g },
  { kind: "SendGrid API token", pattern: /\bSG\.[a-z0-9=_.-]{66}(?=$|[\s"'`,;)&<>])/gi },
  { kind: "Twilio API key", pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { kind: "npm access token", pattern: /\bnpm_[a-z0-9]{36}(?=$|[\s"'`,;)&<>])/gi },
  { kind: "Telegram bot token", pattern: /\b[0-9]{5,16}:A[a-z0-9_-]{34}(?=$|[\s"'`,;)&<>])/g },
  { kind: "Hugging Face access token", pattern: /\bhf_[a-z]{34}(?=$|[\s"'`,;)&<>])/gi },
  { kind: "JSON Web Token", pattern: /\bey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/\\_-]{17,}\.[a-zA-Z0-9/\\_-]{10,}={0,2}(?=$|[\s"'`,;)&<>])/g },
  {
    // The header alone is enough to hold the call for a look — carrying the
    // body into the match only makes what the dialog quotes harder to read.
    kind: "private key",
    pattern: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/gi,
  },
];
