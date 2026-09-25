export type Role = "user" | "assistant";

/**
 * One call the model made, kept beside the assistant's answer so the thread can
 * say what was searched and what came back. The transcript has no `tool` role:
 * these expand into `role: "tool"` wire messages only when the next request is
 * built (see `attachments.ts`), and the reload validator never has to know a
 * third role exists.
 */
export interface ToolRun {
  /** The call's id on the wire, so a running entry becomes the answered one. */
  id: string;
  name: string;
  /** The arguments as the model sent them, as JSON text. */
  arguments: string;
  /** What the tool answered — this is what the model read. Bounded upstream. */
  result: string;
  /**
   * `refused` is a call that never became an exchange on the wire: one the
   * stream never named, one whose turn ended for another reason, or one with no
   * round left to run in. It is shown to the reader and must never be rebuilt
   * into an assistant `tool_calls` message — the server never saw it, and an
   * unnamed one is a malformed request.
   */
  state: "running" | "ok" | "failed" | "refused";
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** True when generation was stopped by the user; content is partial. */
  stopped?: boolean;
  /** The model's thinking, kept apart from the answer. Never rendered inline. */
  reasoning?: string;
  /** First reasoning delta to first answer delta, milliseconds. Measured, not set. */
  reasoningMs?: number;
  /** Tools this answer used, in the order they were called. */
  toolRuns?: ToolRun[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Capped excerpt of recent text for list display. */
  preview: string;
  /** Capped searchable text (title + recent messages). */
  search: string;
  hasMessages: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatSettings {
  model: string;
  /**
   * Whether the assistant may search the web and open pages. The query and the
   * address leave this computer for a search service on the internet; the
   * answer comes back into the conversation. On by default, like the phone
   * (kalsa `src/agent/toolRegistry.ts`), and off means no tools are offered to
   * the model at all.
   */
  webTools: boolean;
}

/** The stored settings plus this computer's own door — the only endpoint
    and token there are. A brain that is not serving leaves the empty
    strings: "nowhere to send" is a fact the pages must see as a value, not
    an optional field every caller would have to guard. */
export interface LiveSettings extends ChatSettings {
  endpoint: string;
  token: string;
}
