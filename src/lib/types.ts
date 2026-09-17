export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** True when generation was stopped by the user; content is partial. */
  stopped?: boolean;
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
