import { logUiEvent } from "../uiLog";

// The closed set of ways a browser call fails, and the fixed code each one
// writes: the log takes codes only, so a category never carries the reason.
export type BrowserFailure =
  | "arguments_cut"
  | "arguments_json"
  | "arguments_schema"
  | "auto_shot"
  | "open_empty"
  | "open_unseen"
  | "open_userinfo"
  | "open_credential"
  | "open_provenance"
  | "open_gate"
  | "open_uncoded";

const CODES: Record<BrowserFailure, string> = {
  arguments_cut: "chat.browser_failure.arguments_cut",
  arguments_json: "chat.browser_failure.arguments_json",
  arguments_schema: "chat.browser_failure.arguments_schema",
  auto_shot: "chat.browser_failure.auto_shot",
  open_empty: "chat.browser_failure.open_empty",
  open_unseen: "chat.browser_failure.open_unseen",
  open_userinfo: "chat.browser_failure.open_userinfo",
  open_credential: "chat.browser_failure.open_credential",
  open_provenance: "chat.browser_failure.open_provenance",
  open_gate: "chat.browser_failure.open_gate",
  open_uncoded: "chat.browser_failure.open_uncoded",
};

const PROVENANCE = new Map<string, BrowserFailure>([
  ["web.link_unseen", "open_unseen"],
  ["web.link_userinfo", "open_userinfo"],
  ["web.link_credential", "open_credential"],
]);

export function logBrowserFailure(failure: BrowserFailure): void {
  logUiEvent(CODES[failure]);
}

export function logProvenanceFailure(code: string): void {
  // A refusal the rule has not named yet is still a refusal: the fallback is a
  // fixed category, and the rule's own code never reaches the log.
  logBrowserFailure(PROVENANCE.get(code) ?? "open_provenance");
}
