export type Role = "user" | "assistant";

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
  /** Base URL of the server, e.g. https://my-host:8000 */
  endpoint: string;
  token: string;
  model: string;
}
